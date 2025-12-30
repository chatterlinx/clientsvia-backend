const ConfigAuditLog = require('../models/ConfigAuditLog');
const CompanyPlaceholders = require('../models/CompanyPlaceholders');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
const { computeEffectiveConfigVersion } = require('../utils/effectiveConfigVersion');
const { getEffectiveRole } = require('../middleware/rbac');
const { getClientIp, getUserAgent, getRequestId, summarizePaths } = require('../utils/configAudit');
const logger = require('../utils/logger');

async function loadTemplatesMeta(company) {
  const refs = Array.isArray(company?.aiAgentSettings?.templateReferences)
    ? company.aiAgentSettings.templateReferences
    : [];
  const enabledIds = refs.filter(r => r && r.enabled !== false && r.templateId).map(r => String(r.templateId));
  if (enabledIds.length === 0) return [];

  const templates = await GlobalInstantResponseTemplate.find({ _id: { $in: enabledIds } })
    .select('_id version updatedAt isPublished isActive')
    .lean();

  return templates.map(t => ({
    templateId: t._id?.toString?.() || String(t._id),
    version: t.version || null,
    updatedAt: t.updatedAt ? new Date(t.updatedAt).toISOString() : null,
    isPublished: t.isPublished ?? null,
    isActive: t.isActive ?? null
  }));
}

async function loadPlaceholders(companyId) {
  try {
    const doc = await CompanyPlaceholders.findOne({ companyId }).select('placeholders').lean();
    return (doc?.placeholders || []).map(p => ({ key: p.key, value: p.value }));
  } catch (e) {
    // Non-fatal: placeholders missing should not block audit logs.
    return [];
  }
}

async function computeECV({ companyId, companyDoc }) {
  const templatesMeta = await loadTemplatesMeta(companyDoc);
  const placeholders = await loadPlaceholders(companyId);

  return computeEffectiveConfigVersion({
    companyId,
    frontDeskBehavior: companyDoc?.aiAgentSettings?.frontDeskBehavior || null,
    agentSettings: companyDoc?.agentSettings || null,
    templateReferences: companyDoc?.aiAgentSettings?.templateReferences || [],
    scenarioControls: companyDoc?.aiAgentSettings?.scenarioControls || [],
    templatesMeta,
    placeholders,
    providerVersions: {
      configAuditService: 'ConfigAuditService:v1'
    }
  });
}

class ConfigAuditService {
  /**
   * Append an immutable config audit record.
   *
   * @param {object} params
   * @param {import('express').Request} params.req
   * @param {string} params.companyId
   * @param {string} params.action
   * @param {string[]} [params.updatedPaths]
   * @param {object} [params.beforeCompanyDoc] - lean company doc
   * @param {object} [params.afterCompanyDoc] - lean company doc
   */
  static async logConfigChange({ req, companyId, action, updatedPaths = [], beforeCompanyDoc, afterCompanyDoc }) {
    try {
      const requestId = getRequestId(req);
      const user = req.user || {};
      const effectiveRole = getEffectiveRole(user?.role);

      const [beforeECV, afterECV] = await Promise.all([
        beforeCompanyDoc ? computeECV({ companyId, companyDoc: beforeCompanyDoc }) : Promise.resolve(null),
        afterCompanyDoc ? computeECV({ companyId, companyDoc: afterCompanyDoc }) : Promise.resolve(null)
      ]);

      const entry = await ConfigAuditLog.create({
        companyId,
        actor: {
          userId: user?._id?.toString?.() || user?.id || 'unknown',
          email: user?.email || null,
          role: user?.role || null,
          effectiveRole,
          breakGlass: user?.breakGlass === true
        },
        request: {
          requestId,
          method: req.method,
          path: req.originalUrl || req.path,
          ip: getClientIp(req),
          userAgent: getUserAgent(req)
        },
        action,
        effectiveConfigVersionBefore: beforeECV,
        effectiveConfigVersionAfter: afterECV,
        diff: {
          updatedPaths,
          summary: summarizePaths(updatedPaths)
        },
        before: beforeCompanyDoc ? { aiAgentSettings: beforeCompanyDoc.aiAgentSettings, agentSettings: beforeCompanyDoc.agentSettings } : null,
        after: afterCompanyDoc ? { aiAgentSettings: afterCompanyDoc.aiAgentSettings, agentSettings: afterCompanyDoc.agentSettings } : null
      });

      logger.info('[CONFIG AUDIT] Logged config change', {
        companyId,
        action,
        requestId,
        auditId: entry?._id?.toString?.() || null,
        effectiveConfigVersionAfter: afterECV
      });

      return entry;
    } catch (error) {
      logger.error('[CONFIG AUDIT] Failed to log config change (non-fatal)', {
        companyId,
        action,
        error: error.message
      });
      return null;
    }
  }
}

module.exports = ConfigAuditService;


