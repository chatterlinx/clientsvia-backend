const logger = require('../../../utils/logger');
const ScenarioEngine = require('../../ScenarioEngine');

function safeArr(v) {
  return Array.isArray(v) ? v : (v ? [v] : []);
}

function safeObj(v, fallback = {}) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : fallback;
}

function clip(text, n) {
  return `${text || ''}`.substring(0, n);
}

function sanitizeScenarioText(text) {
  const raw = `${text || ''}`.trim();
  if (!raw) return null;

  // Remove booking/CTA sentences so Discovery stays "answer-first" without pushing booking.
  const sentences = raw
    .split(/(?<=[.!?])\s+/)
    .map((s) => `${s}`.trim())
    .filter(Boolean)
    .filter((s) => !/\b(would you like|why don'?t we|can i|get (?:a|the) technician|schedule (?:a|an)|book (?:a|an)|let me get you scheduled|i can get you scheduled)\b/i.test(s));

  const kept = sentences.length > 0 ? sentences.slice(0, 2).join(' ') : raw;
  const clipped = kept.length > 360 ? `${kept.substring(0, 357).trim()}...` : kept;
  return clipped || null;
}

function detectRobotChallenge(text) {
  const t = `${text || ''}`.toLowerCase();
  return /\b(are you real|real person|is this a robot|machine|automated|human)\b/i.test(t);
}

function normalizeScenarioType(scenario) {
  const t = scenario?.type || scenario?.scenarioType || scenario?.categoryType || scenario?.category || scenario?.intentType || null;
  if (!t) return null;
  return `${t}`.trim().toUpperCase();
}

function firstMatchRule(playbookRules, inputTextLower) {
  for (const rule of playbookRules || []) {
    const kws = safeArr(rule?.match?.keywords).map((k) => `${k}`.toLowerCase().trim()).filter(Boolean);
    if (kws.some((k) => inputTextLower.includes(k))) return rule;
  }
  return null;
}

class Agent2DiscoveryRunner {
  static async run({ company, companyId, callSid, userInput, state, emitEvent = null, turn = null }) {
    const emit = (type, data) => {
      try {
        if (typeof emitEvent === 'function') emitEvent(type, data);
      } catch (_e) {
        // Never let observability break the call.
      }
    };

    const agent2 = safeObj(company?.aiAgentSettings?.agent2, {});
    const enabled = agent2.enabled === true && agent2.discovery?.enabled === true;
    const discoveryCfg = safeObj(agent2.discovery, {});
    const style = safeObj(discoveryCfg.style, {});
    const playbook = safeObj(discoveryCfg.playbook, {});
    const fallback = safeObj(playbook.fallback, {});

    const input = `${userInput || ''}`.trim();
    const inputLower = input.toLowerCase();

    const nextState = { ...(state || {}) };
    nextState.lane = 'DISCOVERY';
    nextState.consent = { pending: false, askedExplicitly: false };
    nextState.agent2 = safeObj(nextState.agent2, {});
    nextState.agent2.discovery = safeObj(nextState.agent2.discovery, {});
    nextState.agent2.discovery.turnLastRan = typeof turn === 'number' ? turn : null;

    emit('A2_DISCOVERY_TURN_START', {
      enabled,
      uiBuild: agent2?.meta?.uiBuild || null,
      inputLength: input.length,
      inputPreview: clip(input, 120)
    });

    if (!enabled) {
      emit('A2_DISCOVERY_SKIPPED', { reason: 'DISABLED' });
      return null;
    }

    const ack = `${style.ackWord || 'Ok.'}`.trim() || 'Ok.';

    // Robot challenge (UI-controlled response line)
    if (style?.robotChallenge?.enabled === true && detectRobotChallenge(input)) {
      const line = `${style.robotChallenge?.line || ''}`.trim();
      const response = line ? `${ack} ${line}`.trim() : `${ack} How can I help you today?`;
      nextState.agent2.discovery.lastPath = 'ROBOT_CHALLENGE';
      emit('A2_DISCOVERY_PATH_SELECTED', { path: 'ROBOT_CHALLENGE' });
      emit('A2_DISCOVERY_REPLY_COMPOSED', { responsePreview: clip(response, 160) });
      return { response, matchSource: 'AGENT2_DISCOVERY', state: nextState };
    }

    const rules = safeArr(playbook.rules);
    const matchedRule = firstMatchRule(rules, inputLower);
    const globalAllowedTypes = new Set(safeArr(playbook.allowedScenarioTypes).map((t) => `${t}`.trim().toUpperCase()).filter(Boolean));
    const minScore = Number.isFinite(playbook.minScenarioScore) ? playbook.minScenarioScore : 0.72;

    emit('A2_DISCOVERY_RULE_MATCH', {
      matched: !!matchedRule,
      ruleId: matchedRule?.id || null,
      ruleLabel: matchedRule?.label || null
    });

    let scenarioPicked = null;
    let scenarioConfidence = 0;
    let scenarioCandidates = [];

    // Scenario selection: deterministic, non-LLM
    try {
      const engine = new ScenarioEngine();
      const result = await engine.selectResponse({
        companyId: companyId || company?._id?.toString?.() || null,
        tradeKey: company?.tradeKey || company?.industryType || 'universal',
        text: input,
        session: {
          sessionId: callSid || 'unknown',
          callerPhone: null,
          signals: { lane: 'DISCOVERY', agent2: true }
        },
        options: {
          allowTier3: false,
          maxCandidates: 5
        }
      });

      scenarioConfidence = Number(result?.confidence || 0);
      scenarioPicked = result?.scenario || null;
      scenarioCandidates = safeArr(result?.matchMeta?.tier2?.topCandidates).slice(0, 5).map((c) => ({
        scenarioId: c?.scenarioId || c?._id || null,
        title: c?.title || c?.name || null,
        score: c?.score ?? c?.confidence ?? null,
        type: c?.type || c?.scenarioType || null
      }));
    } catch (e) {
      logger.warn('[AGENT2] Scenario selection failed (non-fatal)', { callSid, error: e.message });
    }

    const scenarioType = normalizeScenarioType(scenarioPicked);
    const ruleAllow = new Set(safeArr(matchedRule?.match?.scenarioTypeAllowlist).map((t) => `${t}`.trim().toUpperCase()).filter(Boolean));
    const typeAllowedByRule = ruleAllow.size === 0 ? true : (scenarioType ? ruleAllow.has(scenarioType) : false);
    const typeAllowedByGlobal = globalAllowedTypes.size === 0 ? true : (scenarioType ? globalAllowedTypes.has(scenarioType) : false);
    const scoreAllowed = scenarioConfidence >= minScore;

    emit('A2_DISCOVERY_SCENARIO_EVAL', {
      minScore,
      confidence: scenarioConfidence,
      scoreAllowed,
      scenarioType,
      typeAllowedByRule,
      typeAllowedByGlobal,
      selectedScenarioId: scenarioPicked?._id?.toString?.() || scenarioPicked?.id || null,
      candidates: scenarioCandidates
    });

    let answerText = null;
    if (scenarioPicked && scoreAllowed && typeAllowedByRule && typeAllowedByGlobal) {
      const rawScenarioResponse =
        scenarioPicked.response ||
        scenarioPicked.responseText ||
        scenarioPicked.answer ||
        scenarioPicked.text ||
        null;
      answerText = sanitizeScenarioText(rawScenarioResponse);
      nextState.agent2.discovery.lastScenarioId = scenarioPicked?._id?.toString?.() || scenarioPicked?.id || null;
    }

    const followUp = `${matchedRule?.followUp?.question || ''}`.trim();
    const defaultAfter = `${fallback.afterAnswerQuestion || ''}`.trim();
    const afterQuestion = followUp || defaultAfter || null;

    let response = null;
    if (answerText) {
      response = afterQuestion ? `${ack} ${answerText} ${afterQuestion}`.trim() : `${ack} ${answerText}`.trim();
      nextState.agent2.discovery.lastPath = 'SCENARIO_ANSWER';
    } else {
      const noMatch = `${fallback.noMatchAnswer || ''}`.trim() || `${ack} How can I help you today?`;
      response = noMatch;
      nextState.agent2.discovery.lastPath = 'FALLBACK_NO_MATCH';
    }

    nextState.agent2.discovery.lastRuleId = matchedRule?.id || null;
    nextState.agent2.discovery.lastNextAction = matchedRule?.followUp?.nextAction || null;

    emit('A2_DISCOVERY_REPLY_COMPOSED', {
      path: nextState.agent2.discovery.lastPath,
      responsePreview: clip(response, 220),
      ackWord: ack,
      hasAnswer: !!answerText,
      hasFollowUp: !!afterQuestion
    });

    return { response, matchSource: 'AGENT2_DISCOVERY', state: nextState };
  }
}

module.exports = { Agent2DiscoveryRunner };

