'use strict';

/**
 * ============================================================================
 * AGENT LAB — Live Testing Platform
 * ============================================================================
 *
 * Real-call testing environment for KC/Groq validation. Callers dial their
 * company's Twilio number from a cell phone; the lab intercepts turns from
 * the live pipeline and displays an X-ray of KC routing in real-time.
 *
 * ENDPOINTS:
 *   POST /:companyId/agentlab/scenarios         — AI scenario generation (any trade)
 *   POST /:companyId/agentlab/session/start     — register test session in Redis
 *   GET  /:companyId/agentlab/session/:id/poll  — poll live turns (browser → Redis)
 *   POST /:companyId/agentlab/session/:id/end   — analyze session, push failures to KC Intelligence
 *   GET  /:companyId/agentlab/session/:id       — get session metadata
 *
 * REDIS KEY SCHEME:
 *   agentlab:session:{companyId}:{sessionId}     → session metadata (TTL 4h)
 *   agentlab:phone:{companyId}:{normalizedPhone} → sessionId (TTL 4h)
 *   agentlab:turns:{sessionId}                  → Redis list, one JSON entry per turn
 *
 * MOUNTED AT: /api/admin/agent2/company
 * ============================================================================
 */

const express      = require('express');
const router       = express.Router();
const { v4: uuidv4 } = require('uuid');
const logger       = require('../../utils/logger');
const { authenticateJWT }  = require('../../middleware/auth');
const v2Company    = require('../../models/v2Company');
const CompanyKnowledgeContainer = require('../../models/CompanyKnowledgeContainer');
const KCIntelligenceReport      = require('../../models/KCIntelligenceReport');
const GroqStreamAdapter          = require('../../services/streaming/adapters/GroqStreamAdapter');
const { getSharedRedisClient }   = require('../../services/redisClientFactory');

router.use(authenticateJWT);

const SESSION_TTL = 4 * 60 * 60; // 4 hours in seconds

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE: GET /:companyId/agentlab/company-info
// Lightweight company info for the lab UI (name + Twilio phone)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/:companyId/agentlab/company-info', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateAccess(req, res, companyId)) return;
  try {
    const company = await v2Company.findById(companyId)
      .select('companyName twilioConfig.phoneNumber twilioConfig.phoneNumbers tradeCategories')
      .lean();
    if (!company) return res.status(404).json({ success: false, error: 'Company not found' });

    // Resolve primary active phone — prefer phoneNumbers array, fall back to phoneNumber
    let companyPhone = company.twilioConfig?.phoneNumber || null;
    if (company.twilioConfig?.phoneNumbers?.length) {
      const primary = company.twilioConfig.phoneNumbers.find(p => p.isPrimary && p.status === 'active')
        || company.twilioConfig.phoneNumbers.find(p => p.status === 'active');
      if (primary?.phoneNumber) companyPhone = primary.phoneNumber;
    }

    return res.json({
      success: true,
      companyName:    company.companyName || 'Company',
      companyPhone,
      tradeCategories: company.tradeCategories || [],
    });
  } catch (err) {
    logger.error('[AgentLab] /company-info error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

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

function _normalizePhone(phone) {
  if (!phone) return null;
  return (phone + '').replace(/\D/g, '');
}

async function _getRedis() {
  try { return await getSharedRedisClient(); } catch { return null; }
}

// ── KC readiness scoring (deterministic, no Groq) ────────────────────────────
function _kcReadiness(kc) {
  const sections  = kc.sections || [];
  const wordCount = sections.reduce((s, sec) => s + (sec.content || '').trim().split(/\s+/).filter(Boolean).length, 0);

  // Count callerPhrases + contentKeywords across all sections (replaced dead container.keywords + daType)
  const phraseCount  = sections.reduce((s, sec) => s + (sec.callerPhrases || []).length, 0);
  const kwCount      = sections.reduce((s, sec) => s + (sec.contentKeywords || []).length, 0);
  const hasRouting   = phraseCount > 0 || kwCount > 0;
  const hasAction    = !!(kc.bookingAction) || sections.some(s => s.bookingAction);

  const issues = [];
  if (wordCount < 30)   issues.push(`thin content (${wordCount} words)`);
  if (phraseCount < 1)  issues.push(`no caller phrases (add phrases so callers can find this topic)`);
  if (!hasRouting && !hasAction) issues.push('no matching phrases or booking action');

  // Build a brief content excerpt for Groq (foundation mode)
  const contentExcerpt = sections
    .map(s => s.content || '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);

  const status = issues.length === 0 ? 'READY'
    : issues.length <= 1             ? 'PARTIAL'
    : 'NOT_READY';

  // Collect sample callerPhrases for display
  const samplePhrases = [];
  for (const s of sections) {
    for (const cp of (s.callerPhrases || [])) {
      if (cp.text && samplePhrases.length < 6) samplePhrases.push(cp.text);
    }
  }

  return {
    id:             kc._id?.toString(),
    title:          kc.title || '(untitled)',
    status,
    issues,
    wordCount,
    phraseCount,
    kwCount,
    hasRouting,
    hasAction,
    contentExcerpt,
    samplePhrases,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DIFFICULTY DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

const DIFFICULTY_CONFIG = {
  1: { label: 'VERIFY',        description: 'Direct questions straight from loaded KCs — pure validation'           },
  2: { label: 'REAL LANGUAGE', description: 'How a real caller phrases it — casual, imprecise, regional'            },
  3: { label: 'COMPLEX',       description: 'Multi-part questions, comparisons, edge cases'                         },
  4: { label: 'TOUGH',         description: 'Skeptical callers, objections, pricing pressure, competitor mentions'  },
  5: { label: 'BLIND',         description: 'Topics adjacent to KCs — agent must know what it doesn\'t know'       },
  6: { label: 'REALITY',       description: 'Real call chaos — confused callers, angry customers, out-of-scope asks'},
};

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE: GET /:companyId/agentlab/readiness
// Deterministic KC readiness scan — no Groq, instant.
// Returns ready/partial/not-ready KCs so the owner knows what's safe to test.
// ─────────────────────────────────────────────────────────────────────────────

router.get('/:companyId/agentlab/readiness', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateAccess(req, res, companyId)) return;

  try {
    const kcs = await CompanyKnowledgeContainer.find({ companyId, isActive: { $ne: false } })
      .select('title category sections.label sections.content sections.callerPhrases.text sections.contentKeywords sections.bookingAction bookingAction')
      .lean();

    const scored = kcs.map(_kcReadiness);
    const ready    = scored.filter(k => k.status === 'READY');
    const partial  = scored.filter(k => k.status === 'PARTIAL');
    const notReady = scored.filter(k => k.status === 'NOT_READY');

    return res.json({
      success: true,
      total:      scored.length,
      readyCount: ready.length,
      ready,
      partial,
      notReady,
      foundationSafe: ready.length > 0, // true = foundation check can proceed
    });
  } catch (err) {
    logger.error('[AgentLab] /readiness error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE: POST /:companyId/agentlab/scenarios
// Generate AI scenario scripts for a given difficulty + company
// ─────────────────────────────────────────────────────────────────────────────

router.post('/:companyId/agentlab/scenarios', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateAccess(req, res, companyId)) return;

  const { difficulty = 1, count = 3, foundation = false, readyKcIds = [] } = req.body;

  try {
    const company = await v2Company.findById(companyId).lean();
    if (!company) return res.status(404).json({ success: false, error: 'Company not found' });

    const kcs = await CompanyKnowledgeContainer.find({ companyId, isActive: { $ne: false } })
      .select('title category sections.label sections.content sections.callerPhrases.text sections.contentKeywords sections.bookingAction bookingAction')
      .lean();

    const diffConfig   = DIFFICULTY_CONFIG[foundation ? 1 : difficulty] || DIFFICULTY_CONFIG[1];
    const tradeContext = (company.tradeCategories || []).join(', ') || 'general service business';
    const companyName  = company.companyName || 'the company';

    let systemPrompt;
    let scenarioCount = count; // may be overridden in foundation mode

    if (foundation) {
      // ── FOUNDATION MODE: questions come verbatim FROM KC content ─────────────
      // Only use ready KCs (or all if no filter passed)
      const scored = kcs.map(_kcReadiness);
      const targetKcs = readyKcIds.length
        ? scored.filter(k => readyKcIds.includes(k.id) && k.status !== 'NOT_READY')
        : scored.filter(k => k.status === 'READY');

      if (targetKcs.length === 0) {
        return res.status(400).json({ success: false, error: 'No ready KCs to generate foundation tests from — add content and keywords first' });
      }

      // Cap at 5 to stay within token budget — prevents overload when many KCs are ready
      scenarioCount = Math.min(targetKcs.length, 5);

      // Build rich KC blocks with content excerpts (excerpts already sanitized in _kcReadiness)
      const kcBlocks = targetKcs.slice(0, scenarioCount).map((k, i) =>
        `KC ${i + 1}: "${k.title}"\nKeywords: ${k.keywords.join(', ')}\nContent: ${k.contentExcerpt}`
      ).join('\n\n---\n\n');

      systemPrompt = `You are generating FOUNDATION verification questions for an AI phone agent at a ${tradeContext} company called "${companyName}".

PURPOSE: Each question must be something the agent SHOULD be able to answer using only the KC content provided. These are the easiest possible tests — if the agent fails these, the foundation is broken.

RULES:
- Each question MUST be directly answerable from the KC content shown
- Use a natural caller voice (not robotic, not formal)
- The caller's opening must include at least one of the KC's keywords naturally
- Do NOT invent information not in the KC content
- Keep it simple — no trick questions, no edge cases — just "does the basic routing work?"

KNOWLEDGE CARDS TO TEST:
${kcBlocks}

OUTPUT FORMAT — return a valid JSON array only, no prose, no markdown fences:
[
  {
    "id": "f1",
    "title": "Foundation: [KC title]",
    "persona": "Caller type",
    "situation": "Simple: caller needs info about [topic]",
    "opening": "exact first thing caller says — must include a KC keyword naturally",
    "follow_ups": ["natural follow-up if agent answers correctly"],
    "expected_kc": "[exact KC title from above]",
    "success_criteria": "Agent answers using the KC content — no fallback, no transfer",
    "difficulty": 1,
    "foundation": true,
    "kcId": "[KC id from above]"
  }
]`;
    } else {
      // ── STANDARD MODE: difficulty-based creative scenarios ────────────────────
      const kcSummary = kcs.slice(0, 20).map(kc => {
        const labels   = (kc.sections || []).map(s => s.label).filter(Boolean).join(', ');
        // Collect sample callerPhrases from sections for scenario context
        const phrases  = [];
        for (const s of (kc.sections || [])) {
          for (const cp of (s.callerPhrases || [])) {
            if (cp.text && phrases.length < 5) phrases.push(cp.text);
          }
        }
        const phraseSample = phrases.join(', ');
        return `• ${kc.title}${labels ? ` (subtopics: ${labels})` : ''}${phraseSample ? ` [phrases: ${phraseSample}]` : ''}`;
      }).join('\n');

      systemPrompt = `You are a master call scenario writer for a ${tradeContext} company called "${companyName}".

Your job: write ${count} realistic caller test scenarios at difficulty level ${difficulty} — ${diffConfig.label}.
Difficulty description: ${diffConfig.description}

COMPANY KNOWLEDGE BASE (what the agent knows):
${kcSummary || '(no KCs loaded yet)'}

DIFFICULTY GUIDE:
Level 1 (VERIFY): "How much does a tune-up cost?" — direct from KC content
Level 2 (REAL LANGUAGE): "Hey so like, what would it run me to get my AC checked out?" — natural speech
Level 3 (COMPLEX): "I need the leak fixed AND want to know if I should replace the whole unit vs repair" — multi-part
Level 4 (TOUGH): "Your competitor quoted me $50 less — why should I go with you?" — pressure / objection
Level 5 (BLIND): "Do you do commercial refrigeration units?" — adjacent topic, agent must gracefully decline or escalate
Level 6 (REALITY): "I'm SO angry, your tech left a mess and now my thermostat is broken" — emotional, complex, real

OUTPUT FORMAT — return a valid JSON array only, no prose, no markdown fences:
[
  {
    "id": "s1",
    "title": "short scenario title",
    "persona": "who is calling (e.g. First-time homeowner, frustrated repeat customer)",
    "situation": "1-2 sentence setup — what happened that made them call",
    "opening": "exact first thing caller says when agent picks up",
    "follow_ups": ["second thing they say if agent answers", "what they say if agent asks a clarifying question"],
    "expected_kc": "KC title or null if out-of-scope",
    "success_criteria": "what a perfect agent response includes",
    "difficulty": ${difficulty}
  }
]`;
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return res.status(503).json({ success: false, error: 'GROQ_API_KEY not configured' });

    const groqResult = await GroqStreamAdapter.streamFull({
      apiKey,
      model:       'llama-3.3-70b-versatile',
      messages:    [{ role: 'user', content: `Generate ${scenarioCount} scenarios. Return JSON only.` }],
      system:      systemPrompt,
      maxTokens:   foundation ? 3000 : 2000, // foundation needs more room — KC blocks are long
      temperature: foundation ? 0.3 : 0.85,  // lower temp for foundation = more literal/reliable
    });

    const rawText = groqResult?.response || '';
    logger.debug('[AgentLab] Groq scenario raw', { companyId, chars: rawText.length, failureReason: groqResult?.failureReason });

    // Parse JSON — strip markdown fences if Groq wraps it
    let scenarios = [];
    try {
      if (!rawText) throw new Error(groqResult?.failureReason || 'Empty Groq response');
      const cleaned = rawText.replace(/```json\n?|```\n?/g, '').trim();
      const match   = cleaned.match(/\[[\s\S]*\]/);
      scenarios     = JSON.parse(match ? match[0] : cleaned);
      if (!Array.isArray(scenarios)) throw new Error('not array');
    } catch (parseErr) {
      logger.warn('[AgentLab] Scenario parse failed', { companyId, foundation, parseErr: parseErr.message, rawText: rawText.slice(0, 800) });
      return res.status(502).json({ success: false, error: 'Scenario generation failed — retry' });
    }

    return res.json({
      success: true,
      foundation:          !!foundation,
      difficulty:          foundation ? 1 : difficulty,
      difficultyLabel:     foundation ? 'FOUNDATION' : diffConfig.label,
      difficultyDescription: foundation
        ? 'Direct questions from your loaded KCs — confirms the base routing is working'
        : diffConfig.description,
      scenarios,
      kcCount: kcs.length,
      generatedAt: new Date().toISOString(),
    });

  } catch (err) {
    logger.error('[AgentLab] /scenarios error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE: POST /:companyId/agentlab/session/start
// Register a test session — store in Redis for v2twilio hook to find
// Body: { callerPhone, channel: 'voice'|'sms', difficulty, scenarioId, scenarioTitle }
// ─────────────────────────────────────────────────────────────────────────────

router.post('/:companyId/agentlab/session/start', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateAccess(req, res, companyId)) return;

  const { callerPhone, channel = 'voice', difficulty = 1, scenarioId, scenarioTitle } = req.body;

  if (!callerPhone) return res.status(400).json({ success: false, error: 'callerPhone required' });

  try {
    const company = await v2Company.findById(companyId).lean();
    if (!company) return res.status(404).json({ success: false, error: 'Company not found' });

    const redis = await _getRedis();
    if (!redis) return res.status(503).json({ success: false, error: 'Redis unavailable — cannot start session' });

    const sessionId  = uuidv4();
    const normalized = _normalizePhone(callerPhone);
    const diffConfig = DIFFICULTY_CONFIG[difficulty] || DIFFICULTY_CONFIG[1];

    // Determine company phone to display
    const companyPhone = company.twilioConfig?.phoneNumber || null;

    const sessionData = {
      sessionId,
      companyId,
      companyName:    company.companyName,
      companyPhone,
      callerPhone:    normalized,
      channel,
      difficulty,
      difficultyLabel: diffConfig.label,
      scenarioId:     scenarioId || null,
      scenarioTitle:  scenarioTitle || null,
      status:         'WAITING', // WAITING → ACTIVE → ENDED
      startedAt:      new Date().toISOString(),
      endedAt:        null,
      callSid:        null,
      turnCount:      0,
    };

    // Store session metadata
    await redis.set(
      `agentlab:session:${companyId}:${sessionId}`,
      JSON.stringify(sessionData),
      'EX', SESSION_TTL
    );

    // Register phone → sessionId mapping (v2twilio hook uses this to match inbound call)
    if (normalized) {
      await redis.set(
        `agentlab:phone:${companyId}:${normalized}`,
        sessionId,
        'EX', SESSION_TTL
      );
    }

    logger.info('[AgentLab] Session started', { companyId, sessionId, callerPhone: normalized, channel, difficulty });

    return res.json({
      success: true,
      sessionId,
      companyPhone,
      channel,
      difficulty,
      difficultyLabel: diffConfig.label,
      instructions: channel === 'voice'
        ? `Call ${companyPhone} from ${callerPhone} — the lab will connect automatically`
        : `Send a text to ${companyPhone} from ${callerPhone}`,
    });

  } catch (err) {
    logger.error('[AgentLab] /session/start error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE: GET /:companyId/agentlab/session/:sessionId
// Get current session metadata
// ─────────────────────────────────────────────────────────────────────────────

router.get('/:companyId/agentlab/session/:sessionId', async (req, res) => {
  const { companyId, sessionId } = req.params;
  if (!_validateAccess(req, res, companyId)) return;

  try {
    const redis = await _getRedis();
    if (!redis) return res.status(503).json({ success: false, error: 'Redis unavailable' });

    const raw = await redis.get(`agentlab:session:${companyId}:${sessionId}`);
    if (!raw) return res.status(404).json({ success: false, error: 'Session not found or expired' });

    return res.json({ success: true, session: JSON.parse(raw) });
  } catch (err) {
    logger.error('[AgentLab] /session GET error', { companyId, sessionId, err: err.message });
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE: GET /:companyId/agentlab/session/:sessionId/poll
// Long-poll: returns latest turns since `since` index
// Query: ?since=N (default 0)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/:companyId/agentlab/session/:sessionId/poll', async (req, res) => {
  const { companyId, sessionId } = req.params;
  if (!_validateAccess(req, res, companyId)) return;

  const since = parseInt(req.query.since || '0', 10);

  try {
    const redis = await _getRedis();
    if (!redis) return res.json({ success: true, turns: [], session: null });

    // Get session metadata
    const rawSession = await redis.get(`agentlab:session:${companyId}:${sessionId}`);
    const session    = rawSession ? JSON.parse(rawSession) : null;

    // Get turns from Redis list starting at `since`
    const rawTurns = await redis.lrange(`agentlab:turns:${sessionId}`, since, -1);
    const turns    = rawTurns.map(t => { try { return JSON.parse(t); } catch { return null; } }).filter(Boolean);

    return res.json({ success: true, turns, session, nextIndex: since + turns.length });

  } catch (err) {
    logger.error('[AgentLab] /poll error', { companyId, sessionId, err: err.message });
    return res.json({ success: true, turns: [], session: null });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE: POST /:companyId/agentlab/session/:sessionId/end
// Close session — run Groq analysis on failed turns → push todos to KC Intelligence
// ─────────────────────────────────────────────────────────────────────────────

router.post('/:companyId/agentlab/session/:sessionId/end', async (req, res) => {
  const { companyId, sessionId } = req.params;
  if (!_validateAccess(req, res, companyId)) return;

  try {
    const redis = await _getRedis();
    if (!redis) return res.status(503).json({ success: false, error: 'Redis unavailable' });

    const rawSession = await redis.get(`agentlab:session:${companyId}:${sessionId}`);
    if (!rawSession) return res.status(404).json({ success: false, error: 'Session not found' });

    const session = JSON.parse(rawSession);

    // Get all turns
    const rawTurns = await redis.lrange(`agentlab:turns:${sessionId}`, 0, -1);
    const turns    = rawTurns.map(t => { try { return JSON.parse(t); } catch { return null; } }).filter(Boolean);

    // Identify failed turns (no KC match or graceful ack)
    const failedTurns = turns.filter(t =>
      t.matchSource === 'KC_GRACEFUL_ACK' ||
      t.matchSource === 'KC_LLM_FALLBACK' ||
      t.lane === 'FALLBACK' ||
      t.noKcMatch === true
    );

    // Mark session ended
    session.status   = 'ENDED';
    session.endedAt  = new Date().toISOString();
    session.turnCount = turns.length;
    session.failedCount = failedTurns.length;
    await redis.set(`agentlab:session:${companyId}:${sessionId}`, JSON.stringify(session), 'EX', SESSION_TTL);

    // ── Push test failures to KC Intelligence as todos ────────────────────────
    let todosCreated = 0;
    if (failedTurns.length > 0) {
      try {
        let report = await KCIntelligenceReport.findOne({ companyId });
        if (!report) {
          report = new KCIntelligenceReport({ companyId, todos: [], kcHealth: [], gapTopics: [], conflictMap: [] });
        }

        for (const turn of failedTurns) {
          const question = turn.speechText || turn.smsText || turn.utterance || '(unknown caller utterance)';
          const stableId = `test_gap_${companyId}_${_slugify(question).slice(0, 40)}`;

          // Skip if already present and not dismissed
          const existing = (report.todos || []).find(t => t.stableId === stableId && !t.dismissedAt);
          if (existing) continue;

          report.todos = report.todos || [];
          report.todos.push({
            stableId,
            type:       'CONTENT_GAP',
            priority:   'P2',
            title:      `Agent couldn't answer: "${question.slice(0, 80)}"`,
            detail:     `Detected during Agent Lab test session (${session.difficultyLabel || `Level ${session.difficulty}`}) on ${new Date().toLocaleDateString()}. The agent returned a fallback response instead of a KC match.`,
            kcId:       null,
            kcTitle:    null,
            source:     'test',
            createdAt:  new Date(),
            dismissedAt: null,
            resolvedAt:  null,
          });
          todosCreated++;
        }

        if (todosCreated > 0) {
          report.lastScannedAt = new Date();
          await report.save();
        }
      } catch (todoErr) {
        logger.warn('[AgentLab] Failed to push todos to KC Intelligence', { companyId, sessionId, err: todoErr.message });
      }
    }

    // ── Groq analysis of the session ─────────────────────────────────────────
    let analysis = null;
    if (turns.length > 0) {
      try {
        const turnSummary = turns.slice(0, 30).map((t, i) =>
          `Turn ${i + 1}: CALLER: "${(t.speechText || t.smsText || t.utterance || '').slice(0, 120)}" → MATCHED: ${t.kcTitle || t.matchSource || 'none'} (lane: ${t.lane || '?'})`
        ).join('\n');

        const _analysisApiKey = process.env.GROQ_API_KEY;
        const groqResult = _analysisApiKey ? await GroqStreamAdapter.streamFull({
          apiKey:    _analysisApiKey,
          model:     'llama-3.3-70b-versatile',
          messages:  [{ role: 'user', content: `Analyze this test session and give a short report.` }],
          system:    `You are an AI receptionist QA analyst. The following is a transcript of a test call session for "${session.companyName}" (${session.difficultyLabel || `Level ${session.difficulty}`} difficulty).

SESSION TURNS:
${turnSummary}

Write a concise performance report with:
1. Overall score (A/B/C/D/F) and one-sentence verdict
2. What the agent handled well (max 3 bullets)
3. What the agent missed or fumbled (max 3 bullets)
4. Top 1-2 recommended KC improvements

Be specific. Use the actual questions and KC names. Keep it under 200 words. No markdown.`,
          maxTokens: 400,
          temperature: 0.3,
        }) : null;
        analysis = groqResult?.response || null;
      } catch (analysisErr) {
        logger.warn('[AgentLab] Groq analysis failed', { companyId, sessionId, err: analysisErr.message });
      }
    }

    logger.info('[AgentLab] Session ended', { companyId, sessionId, turns: turns.length, failed: failedTurns.length, todosCreated });

    return res.json({
      success: true,
      sessionId,
      turnCount:   turns.length,
      failedCount: failedTurns.length,
      todosCreated,
      analysis,
      session,
    });

  } catch (err) {
    logger.error('[AgentLab] /session/end error', { companyId, sessionId, err: err.message });
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS (private)
// ─────────────────────────────────────────────────────────────────────────────

function _slugify(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
}

module.exports = router;
