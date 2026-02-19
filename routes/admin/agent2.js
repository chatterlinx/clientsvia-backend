/**
 * ============================================================================
 * AGENT 2.0 - Admin API Routes (UI-CONTROLLED, ISOLATED NAMESPACE)
 * ============================================================================
 *
 * This module is intentionally isolated from legacy Front Desk Behavior configs.
 * Storage: company.aiAgentSettings.agent2
 *
 * Contract:
 * - UI is law: if it's not in the UI, it does not exist.
 * - This route only reads/writes agent2 config. No runtime behavior changes here.
 *
 * ENDPOINTS:
 * - GET   /:companyId  - Read Agent 2.0 config (defaults if missing)
 * - PATCH /:companyId  - Update Agent 2.0 config (partial update)
 *
 * ============================================================================
 */
const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');
const v2Company = require('../../models/v2Company');
const { authenticateJWT } = require('../../middleware/auth');
const { requirePermission, PERMISSIONS } = require('../../middleware/rbac');
const ConfigAuditService = require('../../services/ConfigAuditService');
const BlackBoxLogger = require('../../services/BlackBoxLogger');
const openaiClient = require('../../config/openai');

const UI_BUILD = 'AGENT2_UI_V0.8';

function defaultAgent2Config() {
  return {
    enabled: false,
    discovery: {
      enabled: false,
      style: {
        ackWord: 'Ok.',
        forbidPhrases: ['Got it'],
        bridge: {
          enabled: false,
          maxPerTurn: 1,
          lines: ['Ok — one second.']
        },
        systemDelay: {
          enabled: true,
          firstLine: "I'm sorry — looks like my system’s moving a little slow. Thanks for your patience!",
          transferLine: "I'm so sorry — looks like my system isn't responding. Let me transfer you to a service advisor right away."
        },
        robotChallenge: {
          enabled: true,
          line: "Please, I am here to help you! You can speak to me naturally and ask anything you need — How can I help you?"
        },
        whenInDoubt: {
          enabled: true,
          transferLine: "Ok, to ensure you get the best help, I’m transferring you to a service advisor who can assist with your service needs. Please hold."
        }
      },
      playbook: {
        version: 'v2',
        // V119: ScenarioEngine is OFF by default. Trigger Cards are the primary path.
        useScenarioFallback: false,
        allowedScenarioTypes: ['FAQ', 'TROUBLESHOOT', 'PRICING', 'SERVICE', 'UNKNOWN'],
        minScenarioScore: 0.72,
        fallback: {
          // V119: DISTINCT FALLBACK PATHS
          // noMatchAnswer: Used when NO reason captured (OK to ask "how can I help?")
          noMatchAnswer: "Ok. How can I help you today?",
          // noMatchWhenReasonCaptured: Used when reason IS captured (NEVER restart conversation)
          noMatchWhenReasonCaptured: "Ok. I'm sorry to hear that.",
          // noMatchClarifierQuestion: Optional clarifying question when reason captured
          noMatchClarifierQuestion: "Just so I help you the right way — is the system not running at all right now, or is it running but not cooling?",
          // afterAnswerQuestion: Append after successful card/scenario answer
          afterAnswerQuestion: "Would you like to schedule a visit, or do you have a question I can help with?"
        },
        rules: [
          {
            id: 'pricing.service_call',
            enabled: true,
            priority: 10,
            label: 'Service call pricing',
            match: {
              keywords: ['service call', 'diagnostic fee', 'trip charge'],
              phrases: ['how much is', 'what does it cost'],
              negativeKeywords: ['cancel', 'refund'],
              scenarioTypeAllowlist: ['PRICING']
            },
            answer: {
              answerText: 'Our service call is $89, which includes the diagnostic. If we do the repair, the diagnostic fee is waived.',
              audioUrl: ''
            },
            followUp: {
              question: 'Would you like to schedule a repair visit, or were you looking for a maintenance tune-up?',
              nextAction: 'OFFER_REPAIR_VS_MAINTENANCE'
            }
          },
          {
            id: 'problem.water_leak',
            enabled: true,
            priority: 15,
            label: 'Water leak / dripping',
            match: {
              keywords: ['water leak', 'leaking water', 'dripping', 'water dripping', 'water in garage', 'water on floor', 'puddle', 'condensation leak', 'drain line', 'overflow'],
              phrases: ['water coming from', 'dripping from ceiling', 'water in my'],
              negativeKeywords: [],
              scenarioTypeAllowlist: ['TROUBLESHOOT', 'EMERGENCY']
            },
            answer: {
              answerText: 'Water leaking from an AC unit is often caused by a clogged drain line or a frozen evaporator coil. If you see a lot of water, turn the system off to prevent damage.',
              audioUrl: ''
            },
            followUp: {
              question: 'Is the water actively dripping right now, or have you noticed it pooling over time?',
              nextAction: 'DIAGNOSE_WATER_LEAK'
            }
          },
          {
            id: 'problem.not_cooling',
            enabled: true,
            priority: 12,
            label: 'AC not cooling',
            match: {
              keywords: ['not cooling', 'not cold', 'blowing warm', 'warm air', 'hot air', 'no cold air', 'system running but'],
              phrases: ['running but not cooling', 'blowing but not cold'],
              negativeKeywords: [],
              scenarioTypeAllowlist: ['TROUBLESHOOT']
            },
            answer: {
              answerText: 'If your system is running but not cooling, it could be a refrigerant issue, a dirty filter, or a problem with the compressor. Check your filter first — a clogged filter can restrict airflow.',
              audioUrl: ''
            },
            followUp: {
              question: 'When did you last change the filter?',
              nextAction: 'DIAGNOSE_NOT_COOLING'
            }
          },
          {
            id: 'problem.system_not_running',
            enabled: true,
            priority: 14,
            label: 'System not running',
            match: {
              keywords: ['not running', 'wont turn on', 'wont start', 'dead', 'nothing happening', 'not working', 'stopped working'],
              phrases: ['system is not', 'ac is not', 'wont come on'],
              negativeKeywords: [],
              scenarioTypeAllowlist: ['TROUBLESHOOT', 'EMERGENCY']
            },
            answer: {
              answerText: 'If your system is not running at all, check your thermostat batteries and make sure the breaker has not tripped. Sometimes a simple reset fixes the issue.',
              audioUrl: ''
            },
            followUp: {
              question: 'Is your thermostat screen on, or is it completely blank?',
              nextAction: 'DIAGNOSE_SYSTEM_DOWN'
            }
          },
          {
            id: 'problem.thermostat',
            enabled: true,
            priority: 11,
            label: 'Thermostat issue',
            match: {
              keywords: ['thermostat', 'thermostat blank', 'thermostat not working', 'display blank', 'screen blank'],
              phrases: ['thermostat is', 'thermostat shows'],
              negativeKeywords: [],
              scenarioTypeAllowlist: ['TROUBLESHOOT']
            },
            answer: {
              answerText: 'Thermostat issues can be as simple as dead batteries or as complex as wiring problems. Check the batteries first — if that doesn\'t help, we can send someone out.',
              audioUrl: ''
            },
            followUp: {
              question: 'Is the thermostat screen blank, or is it showing something but the system is not responding?',
              nextAction: 'DIAGNOSE_THERMOSTAT'
            }
          }
        ]
      },
      updatedAt: null
    },
    meta: { uiBuild: UI_BUILD }
  };
}

function safeObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function mergeAgent2Config(saved) {
  const defaults = defaultAgent2Config();
  const src = safeObject(saved, {});

  const merged = {
    ...defaults,
    ...src,
    discovery: {
      ...defaults.discovery,
      ...safeObject(src.discovery, {}),
      style: {
        ...defaults.discovery.style,
        ...safeObject(src.discovery?.style, {}),
        bridge: {
          ...defaults.discovery.style.bridge,
          ...safeObject(src.discovery?.style?.bridge, {})
        },
        systemDelay: {
          ...defaults.discovery.style.systemDelay,
          ...safeObject(src.discovery?.style?.systemDelay, {})
        },
        robotChallenge: {
          ...defaults.discovery.style.robotChallenge,
          ...safeObject(src.discovery?.style?.robotChallenge, {})
        },
        whenInDoubt: {
          ...defaults.discovery.style.whenInDoubt,
          ...safeObject(src.discovery?.style?.whenInDoubt, {})
        }
      },
      playbook: {
        ...defaults.discovery.playbook,
        ...safeObject(src.discovery?.playbook, {})
      }
    },
    meta: { ...defaults.meta, ...safeObject(src.meta, {}) }
  };

  // Guardrails: ensure arrays are arrays (UI expects stable types).
  if (!Array.isArray(merged.discovery.playbook.allowedScenarioTypes)) {
    merged.discovery.playbook.allowedScenarioTypes = defaults.discovery.playbook.allowedScenarioTypes;
  }
  if (!merged.discovery.playbook.fallback || typeof merged.discovery.playbook.fallback !== 'object') {
    merged.discovery.playbook.fallback = defaults.discovery.playbook.fallback;
  } else {
    merged.discovery.playbook.fallback = {
      ...defaults.discovery.playbook.fallback,
      ...safeObject(merged.discovery.playbook.fallback, {})
    };
  }
  if (!Array.isArray(merged.discovery.playbook.rules)) {
    merged.discovery.playbook.rules = defaults.discovery.playbook.rules;
  }

  return merged;
}

// ============================================================================
// GET - Read Agent 2.0 config
// ============================================================================
router.get('/:companyId', authenticateJWT, requirePermission(PERMISSIONS.CONFIG_READ), async (req, res) => {
  try {
    const { companyId } = req.params;
    const company = await v2Company.findById(companyId)
      .select('aiAgentSettings.agent2 effectiveConfigVersion updatedAt')
      .lean();

    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const saved = company.aiAgentSettings?.agent2 || null;
    const data = mergeAgent2Config(saved);

    return res.json({
      success: true,
      data,
      meta: {
        uiBuild: UI_BUILD,
        effectiveConfigVersion: company.effectiveConfigVersion || company.updatedAt || null
      }
    });
  } catch (error) {
    logger.error('[AGENT2] GET error', { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================================================
// PATCH - Update Agent 2.0 config (partial)
// ============================================================================
router.patch('/:companyId', authenticateJWT, requirePermission(PERMISSIONS.CONFIG_WRITE), async (req, res) => {
  try {
    const { companyId } = req.params;
    const updates = safeObject(req.body, {});

    const beforeCompany = await v2Company.findById(companyId)
      .select('aiAgentSettings agentSettings')
      .lean();

    if (!beforeCompany) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const before = mergeAgent2Config(beforeCompany.aiAgentSettings?.agent2 || null);
    const next = mergeAgent2Config({ ...before, ...updates, meta: { ...(before.meta || {}), uiBuild: UI_BUILD } });
    next.discovery.updatedAt = new Date();

    const updateObj = {
      'aiAgentSettings.agent2': next
    };

    await v2Company.updateOne({ _id: companyId }, { $set: updateObj });

    const afterCompany = await v2Company.findById(companyId)
      .select('aiAgentSettings agentSettings')
      .lean();

    // Immutable audit trail (company-scoped)
    try {
      await ConfigAuditService.logConfigChange({
        req,
        companyId,
        action: 'agent2.patch',
        updatedPaths: ['aiAgentSettings.agent2'],
        beforeCompanyDoc: beforeCompany,
        afterCompanyDoc: afterCompany
      });
    } catch (e) {
      logger.warn('[AGENT2] ConfigAuditService failed (non-blocking)', { error: e.message });
    }

    // BlackBox proof event (CONFIG_WRITE)
    try {
      await BlackBoxLogger.logEvent('CONFIG_WRITE', {
        companyId,
        module: 'AGENT2',
        uiBuild: UI_BUILD,
        path: 'aiAgentSettings.agent2',
        keysUpdated: Object.keys(updates || {}),
        ts: new Date().toISOString()
      });
    } catch (e) {
      logger.warn('[AGENT2] BlackBoxLogger CONFIG_WRITE failed (non-blocking)', { error: e.message });
    }

    return res.json({ success: true, data: next, meta: { uiBuild: UI_BUILD } });
  } catch (error) {
    logger.error('[AGENT2] PATCH error', { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================================================
// GPT-4 PREFILL - Auto-generate trigger card fields from keywords
// ============================================================================

/**
 * POST /:companyId/gpt-prefill
 * Body: { keywords: "service call, diagnostic fee, trip charge" }
 * Returns: { success, data: { label, phrases, negativeKeywords, answerText, followUpQuestion } }
 */
router.post('/:companyId/gpt-prefill', authenticateJWT, requirePermission(PERMISSIONS.CONFIG_WRITE), async (req, res) => {
  try {
    const { companyId } = req.params;
    const keywords = (req.body?.keywords || '').trim();

    if (!keywords) {
      return res.status(400).json({ success: false, error: 'Keywords required' });
    }

    if (!openaiClient) {
      return res.status(503).json({ success: false, error: 'OpenAI not configured' });
    }

    const company = await v2Company.findById(companyId).select('companyName').lean();
    if (!company) {
      return res.status(404).json({ success: false, error: 'Company not found' });
    }

    const companyName = company.companyName || 'our company';

    const systemPrompt = `You are an HVAC/home service business assistant helping create trigger cards for an AI phone agent.

Given a set of keywords, generate:
1. label: A short display name (2-4 words)
2. phrases: 3-5 common phrases callers might say (natural language)
3. negativeKeywords: 1-3 words that would indicate a different intent (to avoid false matches)
4. answerText: A helpful, conversational answer (1-3 sentences, friendly tone, include specifics if the keywords suggest pricing use realistic HVAC prices)
5. followUpQuestion: A natural follow-up to keep the conversation going

The business is: ${companyName}

Respond ONLY with valid JSON, no markdown, no explanation:
{
  "label": "...",
  "phrases": ["...", "..."],
  "negativeKeywords": ["...", "..."],
  "answerText": "...",
  "followUpQuestion": "..."
}`;

    const userPrompt = `Keywords: ${keywords}`;

    logger.info('[AGENT2] GPT-4 prefill request', { companyId, keywords });

    const response = await openaiClient.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 500
    });

    const content = response.choices?.[0]?.message?.content || '';

    let parsed;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in response');
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      logger.error('[AGENT2] GPT-4 prefill parse error', { content, error: parseErr.message });
      return res.status(500).json({ success: false, error: 'Failed to parse GPT response' });
    }

    logger.info('[AGENT2] GPT-4 prefill success', { companyId, keywords, label: parsed.label });

    return res.json({
      success: true,
      data: {
        label: parsed.label || '',
        phrases: Array.isArray(parsed.phrases) ? parsed.phrases : [],
        negativeKeywords: Array.isArray(parsed.negativeKeywords) ? parsed.negativeKeywords : [],
        answerText: parsed.answerText || '',
        followUpQuestion: parsed.followUpQuestion || ''
      }
    });
  } catch (error) {
    logger.error('[AGENT2] GPT-4 prefill error', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

