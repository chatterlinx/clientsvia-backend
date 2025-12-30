/**
 * ============================================================================
 * ADMIN SCENARIO DIAGNOSTICS (Proof, not vibes)
 * ============================================================================
 *
 * Purpose:
 * - Eliminate "templates exist but runtime isn't using them" confusion.
 * - Provide deterministic, auditable proof for:
 *   A) company ↔ template linkage
 *   B) effective scenario pool counts
 *   C) scenario selection trace for a given prompt
 *
 * Endpoints:
 * - GET  /api/admin/scenario-diagnostics/link-check/:companyId
 * - POST /api/admin/scenario-diagnostics/trace
 *
 * Security:
 * - JWT required
 * - Admin role required
 */

const express = require('express');
const router = express.Router();

const { authenticateJWT, requireRole } = require('../../middleware/auth');
const logger = require('../../utils/logger');

const Company = require('../../models/v2Company');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
const ScenarioPoolService = require('../../services/ScenarioPoolService');
const HybridScenarioSelector = require('../../services/HybridScenarioSelector');
const { computeEffectiveConfigVersion } = require('../../utils/effectiveConfigVersion');

router.use(authenticateJWT);
router.use(requireRole('admin'));

const SCHEMA_VERSION = 'SCENARIO_DIAGNOSTICS_V1';

function dedupeStrings(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    const v = String(raw || '').trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function mergeSynonymMaps(templates) {
  // HybridScenarioSelector accepts either Map or object-like; we use Map.
  const effective = new Map();

  const mergeAliases = (term, aliases) => {
    if (!term) return;
    const t = String(term).trim();
    if (!t) return;
    const safeAliases = Array.isArray(aliases) ? aliases.map(a => String(a).trim()).filter(Boolean) : [];
    if (safeAliases.length === 0) return;
    const existing = effective.get(t) || [];
    effective.set(t, [...new Set([...existing, ...safeAliases])]);
  };

  for (const template of templates) {
    const tSyn = template?.synonymMap;
    if (tSyn) {
      if (tSyn instanceof Map) {
        for (const [term, aliases] of tSyn.entries()) mergeAliases(term, aliases);
      } else if (typeof tSyn === 'object') {
        for (const [term, aliases] of Object.entries(tSyn)) mergeAliases(term, aliases);
      }
    }

    for (const cat of (template?.categories || [])) {
      const cSyn = cat?.synonymMap;
      if (!cSyn) continue;
      const catMap = cSyn instanceof Map ? cSyn : new Map(Object.entries(cSyn || {}));
      for (const [term, aliases] of catMap.entries()) mergeAliases(term, aliases);
    }
  }

  return effective;
}

function mergeFillers(templates) {
  const fillers = [];
  for (const template of templates) {
    const templateFillers = Array.isArray(template?.fillerWords) ? template.fillerWords : [];
    fillers.push(...templateFillers);
    for (const cat of (template?.categories || [])) {
      if (Array.isArray(cat?.additionalFillerWords)) fillers.push(...cat.additionalFillerWords);
    }
  }
  return dedupeStrings(fillers);
}

function mergeUrgencyKeywords(templates) {
  const kws = [];
  for (const template of templates) {
    if (Array.isArray(template?.urgencyKeywords)) kws.push(...template.urgencyKeywords);
  }
  return Array.isArray(kws) ? kws : [];
}

/**
 * GET /api/admin/scenario-diagnostics/link-check/:companyId
 */
router.get('/link-check/:companyId', async (req, res) => {
  const { companyId } = req.params;

  try {
    const company = await Company.findById(companyId)
      .select('companyName businessName tradeKey aiAgentSettings.templateReferences aiAgentSettings.scenarioControls configuration.clonedFrom')
      .lean();

    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const templateRefs = Array.isArray(company?.aiAgentSettings?.templateReferences)
      ? company.aiAgentSettings.templateReferences
      : [];

    const enabledRefs = templateRefs.filter(r => r && r.enabled !== false && r.templateId);
    const templateIds = enabledRefs.map(r => String(r.templateId));

    const templates = templateIds.length
      ? await GlobalInstantResponseTemplate.find({ _id: { $in: templateIds } })
        .select('_id name version isPublished isActive isDefaultTemplate templateType industryLabel stats categories')
        .lean()
      : [];

    const templatesById = new Map(templates.map(t => [String(t._id), t]));

    const link = enabledRefs.map(r => {
      const t = templatesById.get(String(r.templateId));
      const categories = Array.isArray(t?.categories) ? t.categories : [];
      const scenarioCount = categories.reduce((sum, c) => sum + (Array.isArray(c?.scenarios) ? c.scenarios.length : 0), 0);
      return {
        templateId: String(r.templateId),
        enabled: r.enabled !== false,
        name: t?.name || null,
        version: t?.version || null,
        isPublished: t?.isPublished ?? null,
        isActive: t?.isActive ?? null,
        templateType: t?.templateType || null,
        industryLabel: t?.industryLabel || null,
        categoriesCount: categories.length,
        scenariosCount: scenarioCount,
        statsTotalScenarios: t?.stats?.totalScenarios ?? null,
        missingTemplateDoc: !t
      };
    });

    const pool = await ScenarioPoolService.getScenarioPoolForCompany(companyId);
    const poolScenarios = pool?.scenarios || [];
    const enabledPool = poolScenarios.filter(s => s?.isEnabledForCompany !== false);

    return res.json({
      success: true,
      data: {
        _meta: {
          schemaVersion: SCHEMA_VERSION,
          effectiveConfigVersion: pool?.effectiveConfigVersion || null
        },
        company: {
          companyId,
          name: company.companyName || company.businessName || null,
          tradeKey: company.tradeKey || null
        },
        templateReferences: {
          total: templateRefs.length,
          enabled: enabledRefs.length,
          link
        },
        scenarioPool: {
          totalScenarios: poolScenarios.length,
          enabledScenarios: enabledPool.length,
          templatesUsed: pool?.templatesUsed || []
        }
      }
    });
  } catch (error) {
    logger.error('[SCENARIO DIAGNOSTICS] link-check failed', { companyId, error: error.message, stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/admin/scenario-diagnostics/trace
 * Body: { companyId, utterance, minConfidence?, returnTopN? }
 */
router.post('/trace', async (req, res) => {
  const { companyId, utterance, minConfidence, returnTopN } = req.body || {};
  const safeCompanyId = String(companyId || '').trim();
  const text = String(utterance || '').trim();

  if (!safeCompanyId) return res.status(400).json({ success: false, message: 'companyId is required' });
  if (!text) return res.status(400).json({ success: false, message: 'utterance is required' });

  try {
    // Load company + enabled templates
    const company = await Company.findById(safeCompanyId)
      .select('tradeKey aiAgentSettings.templateReferences')
      .lean();
    if (!company) return res.status(404).json({ success: false, message: 'Company not found' });

    const refs = Array.isArray(company?.aiAgentSettings?.templateReferences) ? company.aiAgentSettings.templateReferences : [];
    const enabledTemplateIds = refs.filter(r => r && r.enabled !== false && r.templateId).map(r => String(r.templateId));

    const templates = enabledTemplateIds.length
      ? await GlobalInstantResponseTemplate.find({ _id: { $in: enabledTemplateIds } }).lean()
      : [];

    // Effective scenario pool (canonical)
    const pool = await ScenarioPoolService.getScenarioPoolForCompany(safeCompanyId);
    const scenarios = (pool?.scenarios || []).filter(s => s?.isEnabledForCompany !== false);

    // Build selector config from enabled templates (merged)
    const effectiveFillers = mergeFillers(templates);
    const effectiveSynonyms = mergeSynonymMaps(templates);
    const urgencyKeywords = mergeUrgencyKeywords(templates);

    const selector = new HybridScenarioSelector(effectiveFillers, urgencyKeywords, effectiveSynonyms);

    // Provide optional tuning knobs for diagnostics (does not change runtime config)
    const ctx = {};
    if (typeof minConfidence === 'number') ctx.minConfidenceOverride = minConfidence;
    if (typeof returnTopN === 'number') ctx.returnTopN = returnTopN;

    const selection = await selector.selectScenario(text, scenarios, ctx);
    const chosen = selection?.scenario || selection?.match || null;

    return res.json({
      success: true,
      data: {
        _meta: {
          schemaVersion: SCHEMA_VERSION,
          effectiveConfigVersion: pool?.effectiveConfigVersion || null
        },
        companyId: safeCompanyId,
        tradeKey: company.tradeKey || null,
        templatesUsed: pool?.templatesUsed || [],
        poolCounts: {
          total: (pool?.scenarios || []).length,
          enabled: scenarios.length
        },
        selectorConfig: {
          fillerWordsCount: effectiveFillers.length,
          urgencyKeywordsCount: Array.isArray(urgencyKeywords) ? urgencyKeywords.length : 0,
          synonymTermsCount: effectiveSynonyms.size
        },
        input: { utterance: text },
        selected: chosen
          ? {
            scenarioId: chosen.scenarioId || chosen.id || null,
            name: chosen.name || null,
            templateId: chosen.templateId || null,
            categoryName: chosen.categoryName || null,
            confidence: selection?.confidence ?? null,
            score: selection?.score ?? null
          }
          : null,
        trace: selection?.trace || null
      }
    });
  } catch (error) {
    logger.error('[SCENARIO DIAGNOSTICS] trace failed', { companyId: safeCompanyId, error: error.message, stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/admin/scenario-diagnostics/replay-turn
 *
 * Replay skeleton (Phase B):
 * - Verifies the caller-provided effectiveConfigVersion matches current effective config
 * - Runs the same selection trace as /trace
 *
 * Body:
 * {
 *   companyId: string,
 *   utterance: string,
 *   expectedEffectiveConfigVersion?: string
 * }
 */
router.post('/replay-turn', async (req, res) => {
  const { companyId, utterance, expectedEffectiveConfigVersion } = req.body || {};
  const safeCompanyId = String(companyId || '').trim();
  const text = String(utterance || '').trim();
  const expected = expectedEffectiveConfigVersion ? String(expectedEffectiveConfigVersion).trim() : null;

  if (!safeCompanyId) return res.status(400).json({ success: false, message: 'companyId is required' });
  if (!text) return res.status(400).json({ success: false, message: 'utterance is required' });

  try {
    const pool = await ScenarioPoolService.getScenarioPoolForCompany(safeCompanyId);
    const current = pool?.effectiveConfigVersion || null;

    if (expected && current && expected !== current) {
      return res.status(409).json({
        success: false,
        message: 'effectiveConfigVersion mismatch (cannot replay against a different effective config without a snapshot store)',
        data: {
          _meta: { schemaVersion: SCHEMA_VERSION },
          companyId: safeCompanyId,
          expectedEffectiveConfigVersion: expected,
          currentEffectiveConfigVersion: current
        }
      });
    }

    // Reuse /trace logic by calling selector directly against current pool.
    const company = await Company.findById(safeCompanyId).select('tradeKey aiAgentSettings.templateReferences').lean();
    if (!company) return res.status(404).json({ success: false, message: 'Company not found' });

    const scenarios = (pool?.scenarios || []).filter(s => s?.isEnabledForCompany !== false);
    const templateIds = (pool?.templatesUsed || []).map(t => t.templateId);
    const templates = templateIds.length ? await GlobalInstantResponseTemplate.find({ _id: { $in: templateIds } }).lean() : [];

    const effectiveFillers = mergeFillers(templates);
    const effectiveSynonyms = mergeSynonymMaps(templates);
    const urgencyKeywords = mergeUrgencyKeywords(templates);
    const selector = new HybridScenarioSelector(effectiveFillers, urgencyKeywords, effectiveSynonyms);

    const selection = await selector.selectScenario(text, scenarios, {});
    const chosen = selection?.scenario || selection?.match || null;

    return res.json({
      success: true,
      data: {
        _meta: {
          schemaVersion: SCHEMA_VERSION,
          effectiveConfigVersion: current
        },
        companyId: safeCompanyId,
        tradeKey: company.tradeKey || null,
        input: { utterance: text },
        selected: chosen
          ? {
            scenarioId: chosen.scenarioId || chosen.id || null,
            name: chosen.name || null,
            templateId: chosen.templateId || null,
            categoryName: chosen.categoryName || null,
            confidence: selection?.confidence ?? null,
            score: selection?.score ?? null
          }
          : null,
        trace: selection?.trace || null
      }
    });
  } catch (error) {
    logger.error('[SCENARIO DIAGNOSTICS] replay-turn failed', { companyId: safeCompanyId, error: error.message, stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;


