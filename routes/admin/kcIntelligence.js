'use strict';

/**
 * ============================================================================
 * KC INTELLIGENCE — Knowledge Base Health & Gap Detection
 * ============================================================================
 *
 * Scans the company's knowledge base against real call history to surface:
 *   1. GAP MINING     — topics callers asked about that the agent couldn't answer
 *   2. CONFLICT MAP   — KC pairs with overlapping keywords (wrong card may fire)
 *   3. KC HEALTH      — per-card scoring: content depth, keywords, age
 *   4. TODO LIST      — prioritised action queue (P1/P2/P3), auto-resolving
 *
 * ENDPOINTS:
 *   GET  /:companyId/knowledge/intelligence         — latest report (or null)
 *   POST /:companyId/knowledge/intelligence/scan    — run full scan (~30-60s)
 *   POST /:companyId/knowledge/intelligence/todos/:stableId/dismiss — dismiss item
 *
 * MOUNTED AT: /api/admin/agent2/company
 * ============================================================================
 */

const express                   = require('express');
const router                    = express.Router();
const mongoose                  = require('mongoose');
const logger                    = require('../../utils/logger');
const { authenticateJWT }       = require('../../middleware/auth');
const v2Company                 = require('../../models/v2Company');
const CompanyKnowledgeContainer = require('../../models/CompanyKnowledgeContainer');
const Customer                  = require('../../models/Customer');
const KCIntelligenceReport      = require('../../models/KCIntelligenceReport');
const GroqStreamAdapter         = require('../../services/streaming/adapters/GroqStreamAdapter');
const KCKeywordHealthService    = require('../../services/kc/KCKeywordHealthService');

router.use(authenticateJWT);

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function _validateAccess(req, res, companyId) {
  if (!companyId) { res.status(400).json({ success: false, error: 'companyId required' }); return false; }
  const user    = req.user || {};
  const isAdmin = ['admin', 'super_admin', 'platform_admin'].includes(user.role);
  if (!isAdmin && user.companyId !== companyId) { res.status(403).json({ success: false, error: 'Access denied' }); return false; }
  return true;
}

function _wordCount(text) {
  if (!text || typeof text !== 'string') return 0;
  return text.trim().split(/\s+/).filter(w => w).length;
}

function _slugify(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
}

// ── Per-KC health score (deterministic — no Groq) ────────────────────────────
function _scoreKC(kc) {
  let score       = 100;
  const issues    = [];
  const sections  = kc.sections || [];

  // ── Content depth ──────────────────────────────────────────────────────────
  const wordCount = sections.reduce((sum, s) => sum + _wordCount(s.content), 0);
  if (wordCount < 30) {
    score -= 35;
    issues.push({ type: 'THIN_CONTENT', message: `Only ${wordCount} words — too thin for Groq to answer caller questions` });
  } else if (wordCount < 100) {
    score -= 15;
    issues.push({ type: 'SPARSE_CONTENT', message: `${wordCount} words — consider expanding for richer agent answers` });
  }

  // ── Keyword coverage ───────────────────────────────────────────────────────
  const kwCount = (kc.keywords || []).length;
  if (kwCount < 3) {
    score -= 25;
    issues.push({ type: 'FEW_KEYWORDS', message: `Only ${kwCount} keyword${kwCount !== 1 ? 's' : ''} — callers using different phrases won't reach this KC` });
  } else if (kwCount < 6) {
    score -= 10;
    issues.push({ type: 'SPARSE_KEYWORDS', message: `${kwCount} keywords — add phrase variations to improve routing accuracy` });
  }

  // ── Content age ────────────────────────────────────────────────────────────
  const daysSinceUpdated = kc.updatedAt
    ? Math.floor((Date.now() - new Date(kc.updatedAt)) / 86_400_000)
    : null;
  if (daysSinceUpdated !== null && daysSinceUpdated > 180) {
    score -= 20;
    issues.push({ type: 'STALE_CONTENT', message: `Not updated in ${daysSinceUpdated} days — pricing and policies may be outdated` });
  } else if (daysSinceUpdated !== null && daysSinceUpdated > 90) {
    score -= 8;
    issues.push({ type: 'AGING_CONTENT', message: `Last updated ${daysSinceUpdated} days ago — worth a quick review` });
  }

  // ── UAP classification ─────────────────────────────────────────────────────
  const classificationStatus = kc.classificationStatus || 'UNCLASSIFIED';
  const uapLinked = !!(kc.daType && classificationStatus !== 'UNCLASSIFIED');
  if (!uapLinked) {
    issues.push({ type: 'UNCLASSIFIED_KC', message: 'No UAP array type set — routing falls back to keyword scoring only; intent-based routing not active' });
  } else if (classificationStatus === 'PENDING') {
    issues.push({ type: 'UAP_PENDING', message: `UAP classification is pending review — confirm it in the UAP console to activate intent routing` });
  }

  // ── Section sub-type completeness ─────────────────────────────────────────
  const sectionCount         = sections.length;
  const classifiedSections   = sections.filter(s => s.daSubTypeKey?.trim()).length;
  if (uapLinked && sectionCount > 0 && classifiedSections < sectionCount) {
    const missing = sectionCount - classifiedSections;
    issues.push({
      type:    'UNCLASSIFIED_SECTIONS',
      message: `${classifiedSections}/${sectionCount} sections have a UAP sub-type key — ${missing} section${missing !== 1 ? 's' : ''} can't be routed precisely`,
    });
  }

  // ── Pre-qualify completeness ───────────────────────────────────────────────
  let prequal = { sections: 0, incomplete: 0 };
  for (const s of sections) {
    const pq = s.preQualifyQuestion;
    if (pq?.enabled && pq.text?.trim()) {
      prequal.sections++;
      const incompleteOpts = (pq.options || []).filter(o => !o.label?.trim() || !o.value?.trim()).length;
      prequal.incomplete += incompleteOpts;
    }
  }
  if (prequal.incomplete > 0) {
    issues.push({
      type:    'PREQUAL_INCOMPLETE',
      message: `${prequal.incomplete} pre-qualify option${prequal.incomplete !== 1 ? 's' : ''} missing label or value — caller will see incomplete choices`,
    });
  }

  // ── Upsell chain count ─────────────────────────────────────────────────────
  const upsellChainCount = sections.reduce(
    (sum, s) => sum + (s.upsellChain || []).filter(u => u.offerScript?.trim()).length, 0
  );

  const clamped = Math.max(0, Math.min(100, score));
  const grade   = clamped >= 85 ? 'A' : clamped >= 70 ? 'B' : clamped >= 55 ? 'C' : clamped >= 40 ? 'D' : 'F';
  return {
    score: clamped, grade, wordCount, keywordCount: kwCount, daysSinceUpdated, issues,
    // ── New routing/completeness fields ──
    sectionCount, classifiedSections, uapLinked, classificationStatus,
    prequal, upsellChainCount,
  };
}

// ── Overall health score from parts ─────────────────────────────────────────
function _calculateOverallHealth(kcHealthResults, missingGaps, conflictPairs) {
  const scores      = kcHealthResults.map(r => r.score);
  const avgKC       = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 100;

  const coveragePenalty  = Math.min(30, missingGaps.filter(g => g.callerCount >= 3).length * 10);
  const conflictPenalty  = Math.min(15, conflictPairs.filter(p => p.severity === 'high').length * 8);
  const overall          = Math.max(0, Math.round(avgKC - coveragePenalty - conflictPenalty));

  const totalKCs   = kcHealthResults.length;
  const coverage   = totalKCs > 0
    ? Math.max(0, 100 - missingGaps.filter(g => g.callerCount >= 2).length * 15)
    : 100;
  const kwHealth   = totalKCs > 0
    ? Math.round(kcHealthResults.filter(r => !r.issues.some(i => i.type === 'FEW_KEYWORDS')).length / totalKCs * 100)
    : 100;
  const contentQ   = Math.round(avgKC);

  return { overall, coverage: Math.min(100, coverage), keywordHealth: kwHealth, contentQuality: contentQ };
}

// ── Generate todo list from all findings (deterministic) ─────────────────────
function _generateTodos(missingGaps, failingGaps, conflictPairs, kcHealthResults) {
  const todos = [];

  // MISSING KC — no card exists for this caller topic
  for (const gap of missingGaps) {
    const priority = gap.callerCount >= 5 ? 'P1' : gap.callerCount >= 2 ? 'P2' : 'P3';
    todos.push({
      stableId:     `MISSING_KC:${_slugify(gap.topic)}`,
      type:         'MISSING_KC',
      priority,
      title:        `Create KC for "${gap.topic}"`,
      description:  `${gap.callerCount} caller${gap.callerCount !== 1 ? 's' : ''} asked about this topic — your agent had no KC to answer from and had to transfer or lose the lead.`,
      kcIds:        [],
      callerCount:  gap.callerCount,
      impactNote:   `${gap.callerCount} potential lost ${gap.callerCount === 1 ? 'lead' : 'leads'} per month`,
      samplePhrases:gap.samplePhrases.slice(0, 3),
    });
  }

  // FAILING KC — KC exists but callers still getting transferred on this topic
  for (const gap of failingGaps) {
    const priority = gap.callerCount >= 5 ? 'P1' : 'P2';
    todos.push({
      stableId:     `FAILING_KC:${gap.kcId}`,
      type:         'FAILING_KC',
      priority,
      title:        `Fix "${gap.kcTitle}" — callers still getting transferred`,
      description:  `${gap.callerCount} caller${gap.callerCount !== 1 ? 's' : ''} called about this topic but your agent still transferred or lost them even though a KC exists. The content may be incomplete, or keywords aren't matching caller language.`,
      kcIds:        [gap.kcId],
      callerCount:  gap.callerCount,
      impactNote:   `KC exists but failing ${gap.callerCount} real caller${gap.callerCount !== 1 ? 's' : ''}`,
      samplePhrases:gap.samplePhrases.slice(0, 3),
    });
  }

  // KEYWORD CONFLICT — two KCs competing for same utterance
  for (const pair of conflictPairs.filter(p => ['high', 'medium'].includes(p.severity))) {
    const shared = (pair.sharedKeywords || []).slice(0, 3).join(', ');
    todos.push({
      stableId:     `KEYWORD_CONFLICT:${[pair.kcAId, pair.kcBId].sort().join('_')}`,
      type:         'KEYWORD_CONFLICT',
      priority:     pair.severity === 'high' ? 'P2' : 'P3',
      title:        `Keyword conflict: "${pair.kcATitle}" vs "${pair.kcBTitle}"`,
      description:  `These two KCs share ${(pair.sharedKeywords || []).length} keyword${(pair.sharedKeywords || []).length !== 1 ? 's' : ''} — a caller asking the same question may get routed to either card and receive different answers on different calls.`,
      kcIds:        [pair.kcAId, pair.kcBId],
      callerCount:  0,
      impactNote:   shared ? `Shared: ${shared}` : 'Review keyword overlap',
      samplePhrases:[],
    });
  }

  // PER-KC HEALTH ISSUES — thin content, few keywords, stale
  for (const kcH of kcHealthResults) {
    const thinIssue = kcH.issues.find(i => i.type === 'THIN_CONTENT' || i.type === 'SPARSE_CONTENT');
    if (thinIssue) {
      todos.push({
        stableId:     `THIN_CONTENT:${kcH.kcId}`,
        type:         'THIN_CONTENT',
        priority:     thinIssue.type === 'THIN_CONTENT' ? 'P2' : 'P3',
        title:        `Expand "${kcH.kcTitle}" — thin content`,
        description:  thinIssue.message,
        kcIds:        [kcH.kcId],
        callerCount:  0,
        impactNote:   'Groq may struggle to answer caller follow-up questions',
        samplePhrases:[],
      });
    }

    const kwIssue = kcH.issues.find(i => i.type === 'FEW_KEYWORDS');
    if (kwIssue) {
      todos.push({
        stableId:     `FEW_KEYWORDS:${kcH.kcId}`,
        type:         'FEW_KEYWORDS',
        priority:     'P2',
        title:        `Add keywords to "${kcH.kcTitle}"`,
        description:  kwIssue.message,
        kcIds:        [kcH.kcId],
        callerCount:  0,
        impactNote:   'Callers who phrase it differently will miss this KC entirely',
        samplePhrases:[],
      });
    }

    const staleIssue = kcH.issues.find(i => i.type === 'STALE_CONTENT' || i.type === 'AGING_CONTENT');
    if (staleIssue) {
      todos.push({
        stableId:     `STALE_CONTENT:${kcH.kcId}`,
        type:         'STALE_CONTENT',
        priority:     staleIssue.type === 'STALE_CONTENT' ? 'P2' : 'P3',
        title:        `Review "${kcH.kcTitle}" — content aging`,
        description:  staleIssue.message,
        kcIds:        [kcH.kcId],
        callerCount:  0,
        impactNote:   'Outdated pricing or policies could mislead callers',
        samplePhrases:[],
      });
    }

    // UNCLASSIFIED KC — no UAP daType set
    const unclassifiedIssue = kcH.issues.find(i => i.type === 'UNCLASSIFIED_KC');
    if (unclassifiedIssue) {
      todos.push({
        stableId:     `UNCLASSIFIED_KC:${kcH.kcId}`,
        type:         'UNCLASSIFIED_KC',
        priority:     'P3',
        title:        `Classify "${kcH.kcTitle}" in UAP array`,
        description:  unclassifiedIssue.message,
        kcIds:        [kcH.kcId],
        callerCount:  0,
        impactNote:   'Intent routing not active — KC reached by keyword fallback only',
        samplePhrases:[],
      });
    }

    // INCOMPLETE SECTION SUBTYPES — sections missing daSubTypeKey
    const subtypeIssue = kcH.issues.find(i => i.type === 'UNCLASSIFIED_SECTIONS');
    if (subtypeIssue) {
      const missing = (kcH.sectionCount || 0) - (kcH.classifiedSections || 0);
      todos.push({
        stableId:     `INCOMPLETE_SUBTYPES:${kcH.kcId}`,
        type:         'INCOMPLETE_SUBTYPES',
        priority:     'P2',
        title:        `Set UAP sub-type on ${missing} section${missing !== 1 ? 's' : ''} in "${kcH.kcTitle}"`,
        description:  subtypeIssue.message,
        kcIds:        [kcH.kcId],
        callerCount:  0,
        impactNote:   'Agent can\'t route to the right section — all sections treated equally',
        samplePhrases:[],
      });
    }

    // INCOMPLETE PREQUAL OPTIONS
    const prequaIssue = kcH.issues.find(i => i.type === 'PREQUAL_INCOMPLETE');
    if (prequaIssue) {
      todos.push({
        stableId:     `PREQUAL_INCOMPLETE:${kcH.kcId}`,
        type:         'PREQUAL_INCOMPLETE',
        priority:     'P2',
        title:        `Complete pre-qualify options in "${kcH.kcTitle}"`,
        description:  prequaIssue.message,
        kcIds:        [kcH.kcId],
        callerCount:  0,
        impactNote:   'Callers will see incomplete choices — pre-qualify gate may malfunction',
        samplePhrases:[],
      });
    }
  }

  // Sort: P1 → P2 → P3, then callerCount descending within priority
  const order = { P1: 0, P2: 1, P3: 2 };
  todos.sort((a, b) =>
    order[a.priority] !== order[b.priority]
      ? order[a.priority] - order[b.priority]
      : (b.callerCount || 0) - (a.callerCount || 0)
  );

  return todos;
}

// ── Merge new todos with existing (auto-resolve + preserve dismissed) ─────────
function _mergeTodos(newTodos, existingTodos) {
  const now         = new Date();
  const existingMap = {};
  for (const t of (existingTodos || [])) existingMap[t.stableId] = t;

  const newMap      = {};
  const result      = [];

  for (const fresh of newTodos) {
    newMap[fresh.stableId] = true;
    const existing          = existingMap[fresh.stableId];

    if (existing) {
      if (existing.status === 'dismissed') {
        // Admin dismissed — keep dismissed, update description in case count changed
        result.push({ ...existing, description: fresh.description, callerCount: fresh.callerCount, impactNote: fresh.impactNote });
      } else {
        // Open or previously resolved — refresh with latest data
        result.push({ ...fresh, status: 'open', resolvedAt: null, createdAt: existing.createdAt || now, dismissedAt: null });
      }
    } else {
      result.push({ ...fresh, status: 'open', createdAt: now, resolvedAt: null, dismissedAt: null });
    }
  }

  // Auto-resolve open todos from previous scan that are no longer detected
  for (const existing of (existingTodos || [])) {
    if (!newMap[existing.stableId] && existing.status === 'open') {
      result.push({ ...existing, status: 'resolved', resolvedAt: now });
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /:companyId/knowledge/intelligence — latest report
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:companyId/knowledge/intelligence', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateAccess(req, res, companyId)) return;

  try {
    const report = await KCIntelligenceReport.findOne({ companyId }).lean();
    return res.json({ success: true, report: report || null });
  } catch (err) {
    logger.error('[kcIntelligence] GET error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load intelligence report' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:companyId/knowledge/intelligence/scan — run full scan
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:companyId/knowledge/intelligence/scan', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateAccess(req, res, companyId)) return;

  const callDaysBack = parseInt(req.body?.callDaysBack, 10) || 30;
  const apiKey       = process.env.GROQ_API_KEY;

  try {
    logger.info('[kcIntelligence] scan started', { companyId, callDaysBack });

    // ── 1. Load company context ─────────────────────────────────────────────
    const [company, allKCs] = await Promise.all([
      v2Company.findById(companyId, 'companyName tradeCategories').lean(),
      CompanyKnowledgeContainer.find({ companyId, isActive: true }).lean(),
    ]);

    const tradeString = (company?.tradeCategories || []).filter(Boolean).join(', ') || 'service';
    const totalKCs    = allKCs.length;

    // ── 2. Per-KC health scoring ────────────────────────────────────────────
    const kcHealth = allKCs.map(kc => ({
      kcId:    String(kc._id),
      kcTitle: kc.title || 'Untitled',
      daType:  kc.daType || null,        // stored so frontend can show the UAP type name
      ..._scoreKC(kc),
    }));

    // ── 3. Mine call history for gap signals ────────────────────────────────
    const cutoff    = new Date(Date.now() - callDaysBack * 86_400_000);
    let gapSignals  = [];
    let callsAnalyzed = 0;

    try {
      const companyObjId = mongoose.Types.ObjectId.isValid(companyId)
        ? new mongoose.Types.ObjectId(companyId)
        : null;

      if (companyObjId) {
        const rawSignals = await Customer.aggregate([
          { $match: { companyId: companyObjId } },
          { $unwind: '$callHistory' },
          { $match: {
            'callHistory.callDate': { $gte: cutoff },
            $or: [
              { 'callHistory.callOutcome': { $in: ['TRANSFERRED', 'TRANSFER', 'HUMAN_TRANSFER'] } },
              { 'callHistory.isLostLead': true },
            ],
            'callHistory.callReason': { $exists: true, $ne: null, $ne: '' },
          }},
          { $project: { callReason: '$callHistory.callReason', serviceType: '$callHistory.serviceType', _id: 0 } },
          { $limit: 200 },
        ]);
        gapSignals    = rawSignals;
        callsAnalyzed = rawSignals.length;
      }
    } catch (histErr) {
      logger.warn('[kcIntelligence] callHistory query failed — continuing without gap data', { companyId, err: histErr.message });
    }

    // ── 4. Cluster gap signals by topic (Groq) ──────────────────────────────
    let clusteredTopics = [];   // [{ label, count, phrases[] }]

    if (gapSignals.length > 0 && apiKey) {
      const reasons = gapSignals
        .map(s => s.callReason?.trim()).filter(Boolean)
        .slice(0, 80);   // cap prompt size

      try {
        const clusterResult = await GroqStreamAdapter.streamFull({
          apiKey,
          model:       'llama-3.3-70b-versatile',
          maxTokens:   600,
          temperature: 0.2,
          jsonMode:    true,
          system: `You are analysing call logs for a ${tradeString} company's AI phone agent.
These are call reasons from calls that ended in a TRANSFER or LOST LEAD — the agent had no answer.
Group them into distinct topics (max 8 groups). Each topic is a subject callers needed help with.
Use short, plain-English topic names a business owner would understand.
Include the best 2–3 representative phrases per topic.

Return ONLY valid JSON:
{ "topics": [{ "label": "Short topic name", "count": 5, "phrases": ["phrase 1","phrase 2"] }] }`,
          messages: [{ role: 'user', content: `Call reasons:\n${reasons.map(r => `- "${r}"`).join('\n')}` }],
        });

        if (clusterResult.response) {
          const raw   = clusterResult.response.trim();
          const match = raw.match(/\{[\s\S]*\}/);
          const parsed = JSON.parse(match ? match[0] : raw);
          if (Array.isArray(parsed.topics)) clusteredTopics = parsed.topics;
        }
      } catch (groqErr) {
        logger.warn('[kcIntelligence] Groq clustering failed — skipping gap topics', { companyId, err: groqErr.message });
        // Fallback: treat each unique callReason as its own "topic" (capped at 8)
        const seen = new Set();
        for (const s of gapSignals) {
          if (s.callReason && !seen.has(s.callReason) && clusteredTopics.length < 8) {
            seen.add(s.callReason);
            clusteredTopics.push({ label: s.callReason.slice(0, 60), count: 1, phrases: [s.callReason] });
          }
        }
      }
    }

    // ── 5. Classify each cluster: missing KC or failing KC ──────────────────
    const missingGaps = [];
    const failingGaps = [];

    for (const cluster of clusteredTopics) {
      const topicWords = (cluster.label || '').toLowerCase().split(/\s+/).filter(w => w.length > 2);
      const matchingKC = allKCs.find(kc => {
        const kcText = `${kc.title || ''} ${(kc.keywords || []).join(' ')}`.toLowerCase();
        return topicWords.some(w => kcText.includes(w));
      });

      const entry = {
        topic:        cluster.label,
        callerCount:  cluster.count || 1,
        samplePhrases:(cluster.phrases || []).slice(0, 3),
        kcId:         matchingKC ? String(matchingKC._id) : null,
        kcTitle:      matchingKC?.title || null,
      };

      if (matchingKC) failingGaps.push(entry);
      else            missingGaps.push(entry);
    }

    // ── 6. Keyword conflict detection ───────────────────────────────────────
    let conflictPairs = [];
    try {
      const { conflicts = [] } = await KCKeywordHealthService.analyzeConflicts(companyId);
      conflictPairs = (conflicts || []).map(c => ({
        kcAId:          String(c.containerA?._id || c.kcAId || ''),
        kcATitle:       c.containerA?.title || c.kcATitle || '',
        kcBId:          String(c.containerB?._id || c.kcBId || ''),
        kcBTitle:       c.containerB?.title || c.kcBTitle || '',
        conflictType:   c.conflictType || c.type || 'KEYWORD_OVERLAP',
        sharedKeywords: c.sharedKeywords || [],
        severity:       c.severity || 'medium',
      })).filter(c => c.kcAId && c.kcBId);
    } catch (conflictErr) {
      logger.warn('[kcIntelligence] conflict detection failed — continuing', { companyId, err: conflictErr.message });
    }

    // ── 7. Calculate overall health score ───────────────────────────────────
    const healthScore = _calculateOverallHealth(kcHealth, missingGaps, conflictPairs);

    // ── 8. Generate todos ───────────────────────────────────────────────────
    const freshTodos  = _generateTodos(missingGaps, failingGaps, conflictPairs, kcHealth);

    // ── 9. Merge with existing todos (auto-resolve + preserve dismissed) ────
    const existing    = await KCIntelligenceReport.findOne({ companyId }, 'todos').lean();
    const mergedTodos = _mergeTodos(freshTodos, existing?.todos || []);

    // ── 10. Upsert report ───────────────────────────────────────────────────
    const report = await KCIntelligenceReport.findOneAndUpdate(
      { companyId },
      {
        companyId,
        scannedAt:    new Date(),
        callDaysBack,
        callsAnalyzed,
        totalKCs,
        healthScore,
        todos:        mergedTodos,
        gapReport:    { missing: missingGaps, failing: failingGaps },
        conflictPairs,
        kcHealth,
      },
      { upsert: true, new: true }
    ).lean();

    logger.info('[kcIntelligence] scan complete', {
      companyId,
      overall:   healthScore.overall,
      todos:     mergedTodos.filter(t => t.status === 'open').length,
      gaps:      missingGaps.length + failingGaps.length,
      conflicts: conflictPairs.length,
    });

    return res.json({ success: true, report });

  } catch (err) {
    logger.error('[kcIntelligence] scan error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Scan failed: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:companyId/knowledge/intelligence/todos/:stableId/dismiss
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:companyId/knowledge/intelligence/todos/:stableId/dismiss', async (req, res) => {
  const { companyId, stableId } = req.params;
  if (!_validateAccess(req, res, companyId)) return;

  try {
    const decoded = decodeURIComponent(stableId);
    const report  = await KCIntelligenceReport.findOne({ companyId });
    if (!report) return res.status(404).json({ success: false, error: 'No intelligence report found' });

    const todo = report.todos.find(t => t.stableId === decoded);
    if (!todo) return res.status(404).json({ success: false, error: 'Todo not found' });

    todo.status      = 'dismissed';
    todo.dismissedAt = new Date();
    await report.save();

    logger.info('[kcIntelligence] todo dismissed', { companyId, stableId: decoded });
    return res.json({ success: true });
  } catch (err) {
    logger.error('[kcIntelligence] dismiss error', { companyId, stableId, err: err.message });
    return res.status(500).json({ success: false, error: 'Dismiss failed' });
  }
});

module.exports = router;
