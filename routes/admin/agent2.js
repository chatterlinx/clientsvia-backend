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
const openaiClient = require('../../config/openai');

// Agent 2.0 uses CallLogger/CallRecording (not legacy BlackBox names)
const CallLogger = require('../../services/CallLogger');
const CallRecording = require('../../models/CallRecording');
const LLMFallbackUsage = require('../../models/LLMFallbackUsage');

const UI_BUILD = 'AGENT2_UI_V1.0';

// ════════════════════════════════════════════════════════════════════════════════
// AGENT 2.0 PERMANENT DEFAULT POLICY
// ════════════════════════════════════════════════════════════════════════════════
// Agent 2.0 is the ONLY Discovery system. Legacy discovery is deprecated.
// - enabled and discovery.enabled are ALWAYS true
// - UI cannot turn Agent2 off
// - Runtime enforces Agent2 even if config is missing/wrong
// - Break-glass only via AGENT2_FORCE_DISABLE_ALLOWLIST env var
// ════════════════════════════════════════════════════════════════════════════════

function defaultAgent2Config() {
  return {
    enabled: true,  // V1.0: PERMANENT DEFAULT - Agent 2.0 is always on
    // Global negative keywords that block ALL trigger cards (V4)
    // Intentionally empty by default to avoid accidental suppression.
    globalNegativeKeywords: [],
    // V129: Real bridge (latency filler)
    // Two-phase TwiML: if processing exceeds thresholdMs, return a short bridge line
    // and Redirect to a continuation endpoint that serves the real answer.
    bridge: {
      enabled: false,
      thresholdMs: 1100,
      hardCapMs: 6000,
      maxBridgesPerCall: 2,
      maxRedirectAttempts: 2,
      lines: [
        'Ok — one moment.',
        'Got it — give me just a second.',
        "One sec — I’m pulling that up now.",
        'Alright — hang with me for a moment.'
      ]
    },
    discovery: {
      enabled: true,  // V1.0: PERMANENT DEFAULT - Discovery is always on
      style: {
        ackWord: 'Ok.',
        robotChallenge: {
          enabled: true,
          line: "Please, I am here to help you! You can speak to me naturally and ask anything you need — How can I help you?"
        }
      },
      // ═══════════════════════════════════════════════════════════════════════
      // VOCABULARY SYSTEM (UI-controlled normalization + hints)
      // ═══════════════════════════════════════════════════════════════════════
      // Types:
      //   HARD_NORMALIZE: Replace mishears/misspellings (e.g., "acee" → "ac")
      //   SOFT_HINT: Add hints without modifying text (e.g., "thingy on wall" → maybe_thermostat)
      // Match modes:
      //   EXACT: Word boundary match
      //   CONTAINS: Substring match (default)
      // ═══════════════════════════════════════════════════════════════════════
      vocabulary: {
        enabled: false,
        entries: [
          // Example HARD_NORMALIZE entries (common mishears)
          { enabled: true, priority: 10, type: 'HARD_NORMALIZE', matchMode: 'EXACT', from: 'acee', to: 'ac', notes: 'Common STT mishear' },
          { enabled: true, priority: 11, type: 'HARD_NORMALIZE', matchMode: 'EXACT', from: 'a/c', to: 'ac', notes: 'Normalize spelling' },
          { enabled: true, priority: 12, type: 'HARD_NORMALIZE', matchMode: 'EXACT', from: 'tstat', to: 'thermostat', notes: 'Abbreviation' },
          { enabled: true, priority: 13, type: 'HARD_NORMALIZE', matchMode: 'EXACT', from: 'thermo stat', to: 'thermostat', notes: 'Spaced version' },
          // Example SOFT_HINT entries (ambiguous phrases)
          { enabled: true, priority: 50, type: 'SOFT_HINT', matchMode: 'CONTAINS', from: 'thingy on the wall', to: 'maybe_thermostat', notes: 'Ambiguous thermostat reference' },
          { enabled: true, priority: 51, type: 'SOFT_HINT', matchMode: 'CONTAINS', from: 'box outside', to: 'maybe_outdoor_unit', notes: 'Ambiguous outdoor unit reference' },
          { enabled: true, priority: 52, type: 'SOFT_HINT', matchMode: 'CONTAINS', from: 'thing in the attic', to: 'maybe_air_handler', notes: 'Ambiguous air handler reference' }
        ]
      },
      // ═══════════════════════════════════════════════════════════════════════
      // CLARIFIER SYSTEM (UI-controlled disambiguation questions)
      // ═══════════════════════════════════════════════════════════════════════
      // Used when SOFT_HINT is triggered but no strong trigger card match.
      // Asks a clarifying question instead of guessing wrong.
      // ═══════════════════════════════════════════════════════════════════════
      clarifiers: {
        enabled: true,
        maxAsksPerCall: 2,
        entries: [
          {
            id: 'clarify.thermostat',
            enabled: true,
            hintTrigger: 'maybe_thermostat',
            question: "Ok. When you say the thing on the wall, do you mean the thermostat screen where you set the temperature?",
            locksTo: 'thermostat',
            priority: 10
          },
          {
            id: 'clarify.outdoor_unit',
            enabled: true,
            hintTrigger: 'maybe_outdoor_unit',
            question: "Ok. When you say the box outside, do you mean the outdoor AC unit — the big unit with the fan?",
            locksTo: 'outdoor_unit',
            priority: 11
          },
          {
            id: 'clarify.air_handler',
            enabled: true,
            hintTrigger: 'maybe_air_handler',
            question: "Ok. When you say the thing in the attic, do you mean the air handler — the indoor unit that blows the air?",
            locksTo: 'air_handler',
            priority: 12
          }
        ]
      },
      // Pending Question Responses (V128)
      // Single owner namespace for YES/NO/REPROMPT lines used by the pending-question state machine.
      pendingQuestionResponses: {
        yes: 'Great! Let me help you with that.',
        no: 'No problem. Is there anything else I can help you with?',
        reprompt: 'Sorry, I missed that. Could you say yes or no?'
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
    // ═══════════════════════════════════════════════════════════════════════
    // GREETINGS SYSTEM (Agent 2.0 owned — ignores legacy when enabled)
    // ═══════════════════════════════════════════════════════════════════════
    // When agent2.enabled && agent2.discovery.enabled:
    //   - ONLY agent2.greetings is used
    //   - Legacy greeting rules are IGNORED
    // ═══════════════════════════════════════════════════════════════════════
    greetings: {
      // ─────────────────────────────────────────────────────────────────────
      // CALL START GREETING (first thing agent says when call connects)
      // ─────────────────────────────────────────────────────────────────────
      callStart: {
        enabled: true,
        text: "Thank you for calling. How can I help you today?",
        audioUrl: ''  // If present, play audio instead of TTS
      },
      // ─────────────────────────────────────────────────────────────────────
      // GREETING INTERCEPTOR (reply when caller says "hi", "good morning")
      // ─────────────────────────────────────────────────────────────────────
      // Fires BEFORE trigger cards. Short-only gate prevents hijacking.
      // ─────────────────────────────────────────────────────────────────────
      interceptor: {
        enabled: true,
        maxWordsToQualify: 2,  // Greeting only fires if input ≤ this many words
        blockIfContainsIntentWords: true,
        intentWords: [
          'repair', 'maintenance', 'tune-up', 'not cooling', 'no cool', 'no heat',
          'leak', 'water', 'dripping', 'thermostat', 'blank', 'schedule',
          'appointment', 'price', 'cost', 'how much', 'service call',
          'diagnostic', 'emergency'
        ],
        rules: [
          {
            id: 'greeting.hi',
            enabled: true,
            priority: 10,
            matchMode: 'EXACT',
            triggers: ['hi', 'hello', 'hey'],
            responseText: "Hi! How can I help you today?",
            audioUrl: ''
          },
          {
            id: 'greeting.morning',
            enabled: true,
            priority: 11,
            matchMode: 'EXACT',
            triggers: ['good morning'],
            responseText: "Good morning! How can I help you today?",
            audioUrl: ''
          },
          {
            id: 'greeting.afternoon',
            enabled: true,
            priority: 12,
            matchMode: 'EXACT',
            triggers: ['good afternoon'],
            responseText: "Good afternoon! How can I help you today?",
            audioUrl: ''
          },
          {
            id: 'greeting.evening',
            enabled: true,
            priority: 13,
            matchMode: 'EXACT',
            triggers: ['good evening'],
            responseText: "Good evening! How can I help you today?",
            audioUrl: ''
          }
        ]
      }
    },
    // ═══════════════════════════════════════════════════════════════════════
    // LLM FALLBACK SETTINGS (UI-controlled ASSIST-ONLY mode)
    // ═══════════════════════════════════════════════════════════════════════
    // LLM is NOT a responder — it's a helper. Decision order:
    //   1. Greetings (turn 0)
    //   2. Greeting Interceptor (short hi/hello only)
    //   3. Trigger Cards (PRIMARY)
    //   4. Deterministic Discovery / Booking
    //   5. LLM Fallback (ONLY if 2-4 failed, max 1 turn)
    //   6. Emergency Fallback Line (if LLM fails/blocked)
    // LLM NEVER offers time slots — only confirms service intent + hands off
    // ═══════════════════════════════════════════════════════════════════════
    llmFallback: {
      enabled: false,  // Master kill switch - if OFF, LLM NEVER runs
      
      // ─────────────────────────────────────────────────────────────────────
      // V5: MODE SELECTOR (Guided vs Answer+Return)
      // Both modes are ASSIST-ONLY. Deterministic owns the mic. LLM never takes over.
      // Default: answer_return (safe default - just answers, no booking push)
      // ─────────────────────────────────────────────────────────────────────
      mode: 'answer_return',  // 'guided' | 'answer_return'
      
      // ─────────────────────────────────────────────────────────────────────
      // V5: ANSWER + RETURN MODE (one-shot answer, no question, back to deterministic)
      // This is the DEFAULT mode - enabled by default
      // ─────────────────────────────────────────────────────────────────────
      answerReturn: {
        enabled: true,  // Default ON since answer_return is the default mode
        model: 'gpt-4.1-mini',
        customModelOverride: '',
        maxSentences: 2,
        maxOutputTokens: 140,
        temperature: 0.2,
        forbidBookingTimes: true,
        forbiddenBookingPatterns: [],  // Uses same default patterns as guided if empty
        cooldownTurns: 1,              // After LLM fires, wait N turns before allowing again
        maxUsesPerCall: 2,             // Hard cap per call
        resetDeterministicNextTurn: true,  // LOCKED TRUE - next turn always deterministic
        systemPrompt: ''               // Custom system prompt (optional)
      },
      
      // ─────────────────────────────────────────────────────────────────────
      // MODEL SELECTION (for Guided mode)
      // ─────────────────────────────────────────────────────────────────────
      provider: 'openai',
      model: 'gpt-4.1-mini',
      customModelOverride: '',  // Advanced: override with custom model string
      
      // ─────────────────────────────────────────────────────────────────────
      // TRIGGER CONDITIONS (ONLY WHEN ALL ELSE FAILS)
      // ─────────────────────────────────────────────────────────────────────
      triggers: {
        noMatchCountThreshold: 2,      // Call LLM after N failed matches
        complexityThreshold: 0.65,     // Call LLM when complexity score >= X
        enableOnNoTriggerCardMatch: true,
        enableOnComplexQuestions: true,
        blockedWhileBooking: true,     // NEVER call LLM during booking steps
        blockedWhileDiscoveryCriticalStep: true,  // Block during name/address/phone capture
        maxLLMFallbackTurnsPerCall: 1, // LLM gets ONE shot, then funnel
        complexQuestionKeywords: [
          'why', 'how', 'warranty', 'covered', 'dangerous', 'safe',
          'thermostat blank', 'is it normal', 'should i', 'can i',
          'is this covered', 'how long', 'how much longer'
        ]
      },
      
      // ─────────────────────────────────────────────────────────────────────
      // OUTPUT CONSTRAINTS (hard enforcement)
      // ─────────────────────────────────────────────────────────────────────
      constraints: {
        maxSentences: 2,
        mustEndWithFunnelQuestion: true,
        maxOutputTokens: 160,
        temperature: 0.2,
        antiParrotGuard: true,         // Don't repeat caller input >8 consecutive words
        antiParrotMaxWords: 8,
        blockTimeSlots: true,          // NEVER offer times/dates/scheduling windows
        forbidBookingTimes: true,      // Hard block booking time language until Booking tab exists
        forbiddenBookingPatterns: [    // UI-configurable list of forbidden booking patterns
          // Time windows
          'morning', 'afternoon', 'evening', 'this morning', 'this afternoon',
          'tomorrow morning', 'tomorrow afternoon', 'later today',
          '8-10', '8–10', '10-12', '10–12', '12-2', '12–2', '2-4', '2–4',
          // Week references
          'this week', 'next week', 'this weekend',
          // Scheduling language
          'time slot', 'appointment time', 'schedule you for', 'what time works',
          'morning or afternoon', 'today or tomorrow',
          // Availability language
          'when would you like', 'what time is good', 'when works for you',
          'earliest available', 'next available', 'soonest available',
          'availability', 'openings', 'get you in',
          // Scheduling verbs
          'i can schedule', 'let me schedule', 'we can schedule',
          'i can book', 'let me book', 'we can book'
        ],
        allowedTasks: {
          clarifyProblem: true,
          basicSafeGuidance: true,
          deescalation: true,
          pricing: false,
          guarantees: false,
          legal: false,
          timeSlots: false             // Explicitly blocked
        }
      },
      
      // ─────────────────────────────────────────────────────────────────────
      // HANDOFF MODE (how LLM returns control to deterministic flow)
      // ─────────────────────────────────────────────────────────────────────
      // LLM confirms service intent, then hands off — NEVER schedules itself
      handoff: {
        mode: 'confirmService',  // 'confirmService' | 'takeMessage' | 'offerForward'
        
        // Mode A: Confirm Service Request → Return to Discovery
        confirmService: {
          question: "Would you like to get a technician out to take a look?",
          yesResponse: "Perfect — I'm going to grab a few details so we can get this scheduled.",
          noResponse: "No problem. Is there anything else I can help you with today?"
        },
        
        // Mode B: Take a Message
        takeMessage: {
          question: "Would you like me to take a message for a callback?",
          yesResponse: "Great, I'll get some info for the callback. What's the best number to reach you?",
          noResponse: "No problem. Is there anything else I can help you with?"
        },
        
        // Mode C: Offer Call Forward (requires explicit consent)
        offerForward: {
          enabled: false,  // Must be explicitly enabled
          question: "Would you like me to connect you to a team member now?",
          yesResponse: "Connecting you now — one moment please.",
          noResponse: "No problem. Is there something else I can help with?",
          consentRequired: true
        }
      },
      
      // ─────────────────────────────────────────────────────────────────────
      // CALL FORWARDING SETTINGS (UI-owned, no hidden code)
      // ─────────────────────────────────────────────────────────────────────
      callForwarding: {
        enabled: false,
        numbers: [],  // Array of { label, number, priority }
        whenAllowed: 'businessHours',  // 'always' | 'businessHours' | 'afterHours'
        businessHours: { start: '08:00', end: '17:00', timezone: 'America/New_York' },
        consentScript: "Would you like me to connect you to a team member now?",
        failureScript: "I wasn't able to connect you — would you like me to take a message instead?"
      },
      
      // ─────────────────────────────────────────────────────────────────────
      // UI-OWNED PROMPTS (editable in UI)
      // ─────────────────────────────────────────────────────────────────────
      prompts: {
        system: `You are a calm HVAC service coordinator. Your goal is to keep the caller informed and in control, and guide them to service intake. Do not provide pricing, guarantees, or scheduling times.`,
        
        format: `Write max 2 sentences.
Sentence 1: empathy + reassurance.
Sentence 2: ask one question to confirm service intent or clarify one missing detail.
Never offer appointment times or time windows. Never repeat the caller's wording verbatim.`,
        
        safety: `SAFETY OVERRIDE: If the caller mentions burning smell, smoke, electrical sparks, gas smell, or carbon monoxide:
1. Tell them to shut off the system immediately
2. If gas/CO: tell them to leave the house and call 911
3. Offer emergency service
Do NOT troubleshoot electrical or gas issues over the phone.`,
        
        // Optional intro line before LLM response
        introLine: "Give me one second — I'm going to help you get this handled quickly."
      },
      
      // ─────────────────────────────────────────────────────────────────────
      // EMERGENCY FALLBACK LINE (last resort if LLM fails)
      // ─────────────────────────────────────────────────────────────────────
      emergencyFallbackLine: {
        text: "Sorry — I'm having trouble for a moment. Are you calling to request service?",
        enabled: true
      },
      
      // ─────────────────────────────────────────────────────────────────────
      // USAGE TRACKING SETTINGS
      // ─────────────────────────────────────────────────────────────────────
      usage: {
        trackTokens: true,
        showCost: true,
        currency: 'USD'
      }
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
    globalNegativeKeywords: Array.isArray(src.globalNegativeKeywords) ? src.globalNegativeKeywords : defaults.globalNegativeKeywords,
    bridge: {
      ...defaults.bridge,
      ...safeObject(src.bridge, {})
    },
    discovery: {
      ...defaults.discovery,
      ...safeObject(src.discovery, {}),
      style: {
        ...defaults.discovery.style,
        ...safeObject(src.discovery?.style, {}),
        robotChallenge: {
          ...defaults.discovery.style.robotChallenge,
          ...safeObject(src.discovery?.style?.robotChallenge, {})
        }
      },
      playbook: {
        ...defaults.discovery.playbook,
        ...safeObject(src.discovery?.playbook, {})
      },
      // Vocabulary system
      vocabulary: {
        ...defaults.discovery.vocabulary,
        ...safeObject(src.discovery?.vocabulary, {})
      },
      // Clarifier system
      clarifiers: {
        ...defaults.discovery.clarifiers,
        ...safeObject(src.discovery?.clarifiers, {})
      }
    },
    // Greetings system (Agent 2.0 owned)
    greetings: {
      ...defaults.greetings,
      ...safeObject(src.greetings, {}),
      callStart: {
        ...defaults.greetings.callStart,
        ...safeObject(src.greetings?.callStart, {})
      },
      interceptor: {
        ...defaults.greetings.interceptor,
        ...safeObject(src.greetings?.interceptor, {})
      }
    },
    meta: { ...defaults.meta, ...safeObject(src.meta, {}) },
    // LLM Fallback settings (UI-controlled ASSIST-ONLY mode)
    llmFallback: {
      ...defaults.llmFallback,
      ...safeObject(src.llmFallback, {}),
      // V5: Preserve mode - default to answer_return if not set
      mode: src.llmFallback?.mode || 'answer_return',
      // V5: Answer+Return config (enabled by default since it's the default mode)
      answerReturn: {
        ...defaults.llmFallback.answerReturn,
        ...safeObject(src.llmFallback?.answerReturn, {}),
        // Always enforce resetDeterministicNextTurn = true
        resetDeterministicNextTurn: true
      },
      triggers: {
        ...defaults.llmFallback.triggers,
        ...safeObject(src.llmFallback?.triggers, {})
      },
      constraints: {
        ...defaults.llmFallback.constraints,
        ...safeObject(src.llmFallback?.constraints, {}),
        allowedTasks: {
          ...defaults.llmFallback.constraints.allowedTasks,
          ...safeObject(src.llmFallback?.constraints?.allowedTasks, {})
        }
      },
      handoff: {
        ...defaults.llmFallback.handoff,
        ...safeObject(src.llmFallback?.handoff, {}),
        confirmService: {
          ...defaults.llmFallback.handoff.confirmService,
          ...safeObject(src.llmFallback?.handoff?.confirmService, {})
        },
        takeMessage: {
          ...defaults.llmFallback.handoff.takeMessage,
          ...safeObject(src.llmFallback?.handoff?.takeMessage, {})
        },
        offerForward: {
          ...defaults.llmFallback.handoff.offerForward,
          ...safeObject(src.llmFallback?.handoff?.offerForward, {})
        }
      },
      callForwarding: {
        ...defaults.llmFallback.callForwarding,
        ...safeObject(src.llmFallback?.callForwarding, {})
      },
      prompts: {
        ...defaults.llmFallback.prompts,
        ...safeObject(src.llmFallback?.prompts, {})
      },
      emergencyFallbackLine: {
        ...defaults.llmFallback.emergencyFallbackLine,
        ...safeObject(src.llmFallback?.emergencyFallbackLine, {})
      },
      usage: {
        ...defaults.llmFallback.usage,
        ...safeObject(src.llmFallback?.usage, {})
      }
    }
  };

  // ════════════════════════════════════════════════════════════════════════════
  // V1.0: AGENT 2.0 PERMANENT DEFAULT ENFORCEMENT
  // ════════════════════════════════════════════════════════════════════════════
  // Regardless of what's in the DB, Agent 2.0 is ALWAYS enabled.
  // This enforcement prevents "why is it acting different today?" chaos.
  // ════════════════════════════════════════════════════════════════════════════
  merged.enabled = true;
  merged.discovery.enabled = true;

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
  
  // Vocabulary guardrails
  if (!Array.isArray(merged.discovery.vocabulary.entries)) {
    merged.discovery.vocabulary.entries = defaults.discovery.vocabulary.entries;
  }
  
  // Clarifiers guardrails
  if (!Array.isArray(merged.discovery.clarifiers.entries)) {
    merged.discovery.clarifiers.entries = defaults.discovery.clarifiers.entries;
  }

  // Bridge guardrails
  if (!merged.bridge || typeof merged.bridge !== 'object') {
    merged.bridge = { ...defaults.bridge };
  } else {
    merged.bridge = {
      ...defaults.bridge,
      ...safeObject(merged.bridge, {})
    };
  }
  if (!Array.isArray(merged.bridge.lines)) {
    merged.bridge.lines = defaults.bridge.lines;
  } else {
    merged.bridge.lines = merged.bridge.lines
      .map(s => (typeof s === 'string' ? s.trim() : ''))
      .filter(Boolean)
      .slice(0, 12);
  }
  if (typeof merged.bridge.thresholdMs !== 'number' || !Number.isFinite(merged.bridge.thresholdMs) || merged.bridge.thresholdMs < 0) {
    merged.bridge.thresholdMs = defaults.bridge.thresholdMs;
  }
  if (typeof merged.bridge.hardCapMs !== 'number' || !Number.isFinite(merged.bridge.hardCapMs) || merged.bridge.hardCapMs < merged.bridge.thresholdMs) {
    merged.bridge.hardCapMs = Math.max(defaults.bridge.hardCapMs, merged.bridge.thresholdMs);
  }
  if (typeof merged.bridge.maxBridgesPerCall !== 'number' || !Number.isFinite(merged.bridge.maxBridgesPerCall) || merged.bridge.maxBridgesPerCall < 0) {
    merged.bridge.maxBridgesPerCall = defaults.bridge.maxBridgesPerCall;
  }
  if (typeof merged.bridge.maxRedirectAttempts !== 'number' || !Number.isFinite(merged.bridge.maxRedirectAttempts) || merged.bridge.maxRedirectAttempts < 0) {
    merged.bridge.maxRedirectAttempts = defaults.bridge.maxRedirectAttempts;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // V128: Pending Question Responses
  // - Ensure stable object shape
  // - Backward compatible migration from legacy keys in playbook.fallback
  // - Remove dead legacy keys from merged output
  // ──────────────────────────────────────────────────────────────────────────
  const legacyFallback = safeObject(merged.discovery?.playbook?.fallback, {});
  const legacyYes = typeof legacyFallback.pendingYesResponse === 'string' ? legacyFallback.pendingYesResponse.trim() : '';
  const legacyNo = typeof legacyFallback.pendingNoResponse === 'string' ? legacyFallback.pendingNoResponse.trim() : '';
  const legacyReprompt = typeof legacyFallback.pendingReprompt === 'string' ? legacyFallback.pendingReprompt.trim() : '';

  merged.discovery.pendingQuestionResponses = {
    ...defaults.discovery.pendingQuestionResponses,
    ...safeObject(src.discovery?.pendingQuestionResponses, {})
  };

  // If new namespace missing values but legacy exists, adopt legacy (migration on read/save)
  if (!merged.discovery.pendingQuestionResponses.yes && legacyYes) merged.discovery.pendingQuestionResponses.yes = legacyYes;
  if (!merged.discovery.pendingQuestionResponses.no && legacyNo) merged.discovery.pendingQuestionResponses.no = legacyNo;
  if (!merged.discovery.pendingQuestionResponses.reprompt && legacyReprompt) merged.discovery.pendingQuestionResponses.reprompt = legacyReprompt;

  // Drop legacy keys from output (dead knobs / wrong namespace)
  if (merged.discovery.playbook?.fallback && typeof merged.discovery.playbook.fallback === 'object') {
    delete merged.discovery.playbook.fallback.pendingYesResponse;
    delete merged.discovery.playbook.fallback.pendingNoResponse;
    delete merged.discovery.playbook.fallback.pendingReprompt;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Remove dead style knobs from output (fight-for-existence enforcement)
  // ──────────────────────────────────────────────────────────────────────────
  if (merged.discovery?.style && typeof merged.discovery.style === 'object') {
    delete merged.discovery.style.forbidPhrases;
    delete merged.discovery.style.bridge;
    delete merged.discovery.style.systemDelay;
    delete merged.discovery.style.whenInDoubt;
  }
  
  // ──────────────────────────────────────────────────────────────────────────
  // Remove dead/config-theater knobs from output
  // ──────────────────────────────────────────────────────────────────────────
  if (merged.discovery?.intentGate && typeof merged.discovery.intentGate === 'object') {
    delete merged.discovery.intentGate.emergencyFullDisqualify;
  }
  if (merged.discovery?.discoveryHandoff && typeof merged.discovery.discoveryHandoff === 'object') {
    delete merged.discovery.discoveryHandoff.forbidBookingTimes;
  }
  if (merged.discovery?.humanTone?.templates && typeof merged.discovery.humanTone.templates === 'object') {
    delete merged.discovery.humanTone.templates.angry;
    delete merged.discovery.humanTone.templates.afterHours;
  }

  // Greetings guardrails
  if (!Array.isArray(merged.greetings.interceptor.rules)) {
    merged.greetings.interceptor.rules = defaults.greetings.interceptor.rules;
  }
  if (!Array.isArray(merged.greetings.interceptor.intentWords)) {
    merged.greetings.interceptor.intentWords = defaults.greetings.interceptor.intentWords;
  }

  // LLM Fallback guardrails
  if (!Array.isArray(merged.llmFallback.triggers.complexQuestionKeywords)) {
    merged.llmFallback.triggers.complexQuestionKeywords = defaults.llmFallback.triggers.complexQuestionKeywords;
  }
  if (!Array.isArray(merged.llmFallback.callForwarding.numbers)) {
    merged.llmFallback.callForwarding.numbers = defaults.llmFallback.callForwarding.numbers;
  }
  
  // CRITICAL: If forbidBookingTimes=true but patterns array is empty, auto-fill defaults
  // Empty patterns with forbidBookingTimes=true is dangerous - must enforce UI truth
  const patterns = merged.llmFallback.constraints.forbiddenBookingPatterns;
  const forbidBookingTimes = merged.llmFallback.constraints.forbidBookingTimes;
  if (!Array.isArray(patterns) || (forbidBookingTimes !== false && patterns.length === 0)) {
    merged.llmFallback.constraints.forbiddenBookingPatterns = defaults.llmFallback.constraints.forbiddenBookingPatterns;
    // Flag that we auto-applied defaults (can be logged in runtime)
    merged.llmFallback.constraints._autoAppliedDefaultPatterns = true;
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

    // ════════════════════════════════════════════════════════════════════════
    // V1.0: LAZY MIGRATION - Persist corrected config if it was missing/wrong
    // ════════════════════════════════════════════════════════════════════════
    // If the saved config had enabled=false or discovery.enabled=false,
    // we've corrected it in mergeAgent2Config. Now persist the fix.
    const needsMigration = 
      saved?.enabled !== true || 
      saved?.discovery?.enabled !== true;
    
    if (needsMigration) {
      try {
        await v2Company.updateOne(
          { _id: companyId },
          { $set: { 'aiAgentSettings.agent2': data } }
        );
        logger.info('[AGENT2] V1.0 lazy migration: Enforced permanent default', {
          companyId,
          previousEnabled: saved?.enabled,
          previousDiscoveryEnabled: saved?.discovery?.enabled,
          migratedTo: { enabled: true, discoveryEnabled: true }
        });
        
        // Log migration event (non-blocking)
        try {
          await CallLogger.logEvent('AGENT2_LAZY_MIGRATION', {
            companyId,
            previousConfig: {
              enabled: saved?.enabled,
              discoveryEnabled: saved?.discovery?.enabled
            },
            migratedTo: { enabled: true, discoveryEnabled: true },
            reason: 'V1.0 permanent default enforcement',
            ts: new Date().toISOString()
          });
        } catch (e) { /* non-blocking */ }
      } catch (migrationErr) {
        logger.warn('[AGENT2] Lazy migration failed (non-blocking)', { 
          companyId, 
          error: migrationErr.message 
        });
      }
    }

    return res.json({
      success: true,
      data,
      meta: {
        uiBuild: UI_BUILD,
        effectiveConfigVersion: company.effectiveConfigVersion || company.updatedAt || null,
        lazyMigrated: needsMigration
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
      .select('aiAgentSettings agentSettings twilioConfig')
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
    
    // ═══════════════════════════════════════════════════════════════════════
    // CRITICAL: Invalidate Redis cache so Twilio picks up new config
    // ═══════════════════════════════════════════════════════════════════════
    try {
      const { redisClient } = require('../../db');
      if (redisClient) {
        // Get all phone numbers associated with this company
        const phoneNumbers = [];
        if (beforeCompany.twilioConfig?.phoneNumber) {
          phoneNumbers.push(beforeCompany.twilioConfig.phoneNumber);
        }
        if (beforeCompany.twilioConfig?.phoneNumbers?.length) {
          beforeCompany.twilioConfig.phoneNumbers.forEach(p => {
            if (p.phoneNumber) phoneNumbers.push(p.phoneNumber);
          });
        }
        
        // Delete cache for each phone number
        for (const phone of phoneNumbers) {
          const cacheKey = `company-phone:${phone}`;
          await redisClient.del(cacheKey);
          logger.info(`[AGENT2] 🗑️ Cache invalidated for ${cacheKey}`);
        }
        
        if (phoneNumbers.length === 0) {
          logger.warn(`[AGENT2] No phone numbers found for company ${companyId} - cache not invalidated`);
        }
      }
    } catch (cacheErr) {
      logger.warn('[AGENT2] Cache invalidation failed (non-blocking)', { error: cacheErr.message });
    }

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
      await CallLogger.logEvent('CONFIG_WRITE', {
        companyId,
        module: 'AGENT2',
        uiBuild: UI_BUILD,
        path: 'aiAgentSettings.agent2',
        keysUpdated: Object.keys(updates || {}),
        ts: new Date().toISOString()
      });
    } catch (e) {
      logger.warn('[AGENT2] CallLogger CONFIG_WRITE failed (non-blocking)', { error: e.message });
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

// ═══════════════════════════════════════════════════════════════════════════
// GREETINGS - SEED FROM GLOBAL
// ═══════════════════════════════════════════════════════════════════════════
/**
 * POST /:companyId/greetings/seed-from-global
 * Copies legacy greeting rules into agent2.greetings.interceptor.rules
 * 
 * Query params:
 *   - mode: 'merge' (add to existing) or 'replace' (overwrite)
 */
router.post('/:companyId/greetings/seed-from-global',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_WRITE),
  async (req, res) => {
    try {
      const { companyId } = req.params;
      const mode = req.query.mode === 'replace' ? 'replace' : 'merge';

      const company = await v2Company.findById(companyId)
        .select('aiAgentSettings connectionMessages')
        .lean();

      if (!company) {
        return res.status(404).json({ success: false, message: 'Company not found' });
      }

      // Get current Agent 2.0 config
      const current = mergeAgent2Config(company.aiAgentSettings?.agent2 || null);
      
      // Get legacy greeting rules
      const legacyRules = company.aiAgentSettings?.frontDeskBehavior?.conversationStages?.greetingRules || [];
      
      // Get connection messages for call start greeting
      const connectionMessages = company.connectionMessages?.voice || {};

      // Convert legacy rules to Agent 2.0 format
      const convertedRules = legacyRules
        .filter(rule => rule && rule.trigger && rule.response)
        .map((rule, idx) => ({
          id: `greeting.seeded.${idx}`,
          enabled: true,
          priority: 20 + idx,  // Start after default rules
          matchMode: rule.fuzzy === true ? 'FUZZY' : 'EXACT',
          triggers: [rule.trigger.toLowerCase().trim()],
          responseText: rule.response,
          audioUrl: ''
        }));

      // Prepare updated greetings config
      const updatedGreetings = { ...current.greetings };

      // Seed call start from connection messages
      if (connectionMessages.text) {
        updatedGreetings.callStart = {
          ...updatedGreetings.callStart,
          text: connectionMessages.text,
          audioUrl: connectionMessages.prerecorded?.activeFileUrl || ''
        };
      }

      // Seed interceptor rules
      if (mode === 'replace') {
        updatedGreetings.interceptor.rules = convertedRules;
      } else {
        // Merge: add converted rules that don't duplicate existing triggers
        const existingTriggers = new Set();
        for (const rule of updatedGreetings.interceptor.rules) {
          for (const t of (rule.triggers || [])) {
            existingTriggers.add(t.toLowerCase().trim());
          }
        }
        const newRules = convertedRules.filter(rule => {
          return !rule.triggers.some(t => existingTriggers.has(t));
        });
        updatedGreetings.interceptor.rules = [
          ...updatedGreetings.interceptor.rules,
          ...newRules
        ];
      }

      // Save
      const next = { ...current, greetings: updatedGreetings };
      next.meta.uiBuild = UI_BUILD;

      await v2Company.updateOne(
        { _id: companyId },
        { $set: { 'aiAgentSettings.agent2': next } }
      );

      logger.info('[AGENT2] Greetings seeded from global', {
        companyId,
        mode,
        legacyRulesCount: legacyRules.length,
        convertedCount: convertedRules.length,
        finalRulesCount: updatedGreetings.interceptor.rules.length
      });

      return res.json({
        success: true,
        data: updatedGreetings,
        meta: {
          mode,
          legacyRulesImported: convertedRules.length,
          totalRules: updatedGreetings.interceptor.rules.length
        }
      });
    } catch (error) {
      logger.error('[AGENT2] Seed greetings error', { error: error.message });
      return res.status(500).json({ success: false, message: error.message });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// CALL REVIEW ENDPOINTS (V119 - Enterprise Call Console)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/calls/:companyId
 * List recent calls for Call Review tab
 */
router.get('/calls/:companyId',
  authenticateJWT,
  requirePermission(PERMISSIONS.VIEW_COMPANY),
  async (req, res) => {
    const { companyId } = req.params;
    const { limit = 50, skip = 0, source, fromDate, toDate } = req.query;

    try {
      const options = {
        limit: Math.min(Number(limit) || 50, 100),
        skip: Number(skip) || 0,
        source: source || undefined,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined
      };

      const result = await CallRecording.getCallList(companyId, options);

      // Transform for UI
      const calls = result.calls.map(call => ({
        callSid: call.callId,
        from: call.from,
        to: call.to,
        startTime: call.startedAt,
        duration: call.durationMs ? Math.round(call.durationMs / 1000) : null,
        turnCount: call.performance?.totalTurns || null,
        status: call.callOutcome?.toLowerCase() || 'completed',
        source: call.source || 'voice',
        flags: call.flags || {},
        bookingCompleted: call.booking?.completed === true,
        primaryIntent: call.primaryIntent,
        diagnosis: call.diagnosis,
        // LLM usage stats
        llmCalls: call.performance?.llmCalls?.count || 0,
        llmCostUsd: call.performance?.llmCalls?.totalCostUsd || 0,
        llmTotalMs: call.performance?.llmCalls?.totalMs || 0
      }));

      return res.json({ success: true, data: calls, total: result.total });
    } catch (error) {
      logger.error('[AGENT2] Call list error', { companyId, error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * GET /api/admin/calls/:companyId/:callSid/events
 * Get raw events for a specific call
 */
router.get('/calls/:companyId/:callSid/events',
  authenticateJWT,
  requirePermission(PERMISSIONS.VIEW_COMPANY),
  async (req, res) => {
    const { companyId, callSid } = req.params;

    try {
      const recording = await CallRecording.getCallDetail(companyId, callSid);

      if (!recording) {
        return res.status(404).json({ success: false, error: 'Call not found' });
      }

      // Return events with call metadata
      return res.json({
        success: true,
        data: recording.events || [],
        meta: {
          callSid: recording.callId,
          from: recording.from,
          to: recording.to,
          startedAt: recording.startedAt,
          endedAt: recording.endedAt,
          durationMs: recording.durationMs,
          source: recording.source,
          callOutcome: recording.callOutcome,
          transcript: recording.transcript,
          flags: recording.flags,
          diagnosis: recording.diagnosis,
          performance: recording.performance,
          awHash: recording.awHash,
          traceRunId: recording.traceRunId
        }
      });
    } catch (error) {
      logger.error('[AGENT2] Call events error', { companyId, callSid, error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// LLM FALLBACK SETTINGS - MODEL LIST & PRICING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/agent2/llmFallback/models
 * Returns curated allowed models + pricing table (NO live OpenAI API calls)
 */
router.get('/llmFallback/models',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_READ),
  async (req, res) => {
    try {
      // Curated model list - stable, no live API calls
      const allowedModels = [
        { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', description: 'Fast, cost-effective (recommended)', tier: 'standard' },
        { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', description: 'Ultra-fast, lowest cost', tier: 'economy' },
        { id: 'gpt-4.1', name: 'GPT-4.1', description: 'Most capable, higher cost', tier: 'premium' },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast multimodal', tier: 'standard' },
        { id: 'gpt-4o', name: 'GPT-4o', description: 'Premium multimodal', tier: 'premium' }
      ];

      // Pricing per 1M tokens (USD)
      const pricingTable = {
        'gpt-4.1-mini': { input: 0.40, output: 1.60 },
        'gpt-4.1-nano': { input: 0.10, output: 0.40 },
        'gpt-4.1': { input: 2.00, output: 8.00 },
        'gpt-4o-mini': { input: 0.15, output: 0.60 },
        'gpt-4o': { input: 2.50, output: 10.00 }
      };

      return res.json({
        success: true,
        data: {
          allowedModels,
          pricingTable,
          defaultModel: 'gpt-4.1-mini',
          customOverrideWarning: 'Custom models may have unknown pricing. Cost tracking will use default rates.'
        }
      });
    } catch (error) {
      logger.error('[AGENT2] LLM models endpoint error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// LLM FALLBACK USAGE STATS (Today + MTD)
// ═══════════════════════════════════════════════════════════════════════════

// In-memory cache for usage stats (per companyId)
const usageStatsCache = new Map();
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

/**
 * GET /api/admin/agent2/llmFallback/usage/:companyId
 * Returns Today + MTD token/cost stats with caching
 */
router.get('/llmFallback/usage/:companyId',
  authenticateJWT,
  requirePermission(PERMISSIONS.VIEW_COMPANY),
  async (req, res) => {
    const { companyId } = req.params;
    const { refresh } = req.query;

    try {
      const cacheKey = `usage_${companyId}`;
      const cached = usageStatsCache.get(cacheKey);
      const now = Date.now();

      // Return cached if valid and not forcing refresh
      if (cached && (now - cached.timestamp) < CACHE_TTL_MS && refresh !== 'true') {
        return res.json({
          success: true,
          data: cached.data,
          cached: true,
          cacheAge: Math.round((now - cached.timestamp) / 1000)
        });
      }

      // Fetch fresh stats
      const stats = await LLMFallbackUsage.getUsageStats(companyId);

      // Update cache
      usageStatsCache.set(cacheKey, {
        data: stats,
        timestamp: now
      });

      return res.json({
        success: true,
        data: stats,
        cached: false
      });
    } catch (error) {
      logger.error('[AGENT2] LLM usage stats error', { companyId, error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * GET /api/admin/agent2/llmFallback/usage/:companyId/calls
 * Returns recent LLM fallback calls for detailed review
 */
router.get('/llmFallback/usage/:companyId/calls',
  authenticateJWT,
  requirePermission(PERMISSIONS.VIEW_COMPANY),
  async (req, res) => {
    const { companyId } = req.params;
    const { limit = 50, skip = 0 } = req.query;

    try {
      const calls = await LLMFallbackUsage.find({ companyId })
        .sort({ createdAt: -1 })
        .skip(Number(skip) || 0)
        .limit(Math.min(Number(limit) || 50, 100))
        .lean();

      const total = await LLMFallbackUsage.countDocuments({ companyId });

      return res.json({
        success: true,
        data: calls.map(c => ({
          callSid: c.callSid,
          model: c.model,
          tokens: c.tokens,
          costUsd: c.costUsd,
          trigger: c.trigger,
          result: {
            success: c.result?.success,
            responsePreview: c.result?.responsePreview,
            hadFunnelQuestion: c.result?.hadFunnelQuestion,
            constraintViolations: c.result?.constraintViolations,
            usedEmergencyFallback: c.result?.usedEmergencyFallback
          },
          createdAt: c.createdAt
        })),
        total
      });
    } catch (error) {
      logger.error('[AGENT2] LLM calls list error', { companyId, error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

module.exports = router;

