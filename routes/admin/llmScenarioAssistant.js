/**
 * ============================================================================
 * LLM SCENARIO ASSISTANT - ADMIN ROUTE
 * ============================================================================
 * 
 * Purpose: Help admins draft scenarios using LLM intelligence
 * 
 * Endpoint: POST /api/admin/scenario-assistant/draft
 * 
 * Flow:
 * 1. Admin enters description of what scenario should do
 * 2. LLM generates: triggers, user phrases, replies, type, strategy, follow-ups
 * 3. Frontend applies draft to form fields for review/editing
 * 4. Admin saves scenario normally
 * 
 * No impact on live calls; purely admin-side tooling.
 * ============================================================================
 */

const express = require('express');
const logger = require('../../utils/logger');
const openaiClient = require('../../config/openai');
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const { getSettings } = require('../../services/llmSettingsService');
const {
  DEFAULT_LLM_ENTERPRISE_SETTINGS,
  buildScenarioArchitectSystemPromptFromSettings,
  getEffectiveModelParams
} = require('../../config/llmScenarioPrompts');
const GlobalAIBehaviorTemplate = require('../../models/GlobalAIBehaviorTemplate');
const { CANONICAL_SCENARIO_TYPES } = require('../../utils/scenarioTypes');

const SCENARIO_TYPE_OPTIONS = CANONICAL_SCENARIO_TYPES.filter(type => type !== 'UNKNOWN');

const router = express.Router();

// ============================================================================
// ADMIN-ONLY PROTECTION
// ============================================================================
// Apply JWT auth + admin role requirement to ALL routes in this file
router.use(authenticateJWT);
router.use(requireRole('admin'));

// LLM Settings helpers are now in config/llmScenarioPrompts.js
// This keeps all prompt text and configuration in one place

/**
 * ============================================================================
 * EXTENDED: Sanitize & normalize RICH draft scenario (Phase C.1)
 * ============================================================================
 * Now handles full scenario shape including entities, variables, advanced settings.
 */
function sanitizeScenarioDraft(raw) {
  const draft = {
    // BASIC
    name: (raw.name || raw.scenarioName || 'Untitled Scenario').trim(),
    scenarioType: SCENARIO_TYPE_OPTIONS.includes(raw.scenarioType)
      ? raw.scenarioType
      : 'FAQ',
    replyStrategy: ['AUTO', 'FULL_ONLY', 'QUICK_ONLY', 'QUICK_THEN_FULL', 'LLM_WRAP', 'LLM_CONTEXT'].includes(raw.replyStrategy)
      ? raw.replyStrategy
      : 'AUTO',

    // TRIGGERS & PHRASES
    triggerPhrases: Array.isArray(raw.triggerPhrases) 
      ? raw.triggerPhrases.filter(t => t && typeof t === 'string').slice(0, 20)
      : [],
    negativeTriggers: Array.isArray(raw.negativeTriggers)
      ? raw.negativeTriggers.filter(t => t && typeof t === 'string').slice(0, 15)
      : [],
    regexTriggers: Array.isArray(raw.regexTriggers)
      ? raw.regexTriggers.filter(t => t && typeof t === 'string').slice(0, 10)
      : [],

    // REPLIES (weighted) - Generate many variations to sound natural, not robotic
    quickReplies: normalizeWeightedReplies(raw.quickReplies, 7, 12),
    fullReplies: normalizeWeightedReplies(raw.fullReplies, 7, 12),
    followUpPrompts: normalizeWeightedReplies(raw.followUpPrompts, 3, 6),

    // FOLLOW-UP BEHAVIOR
    followUpMode: ['NONE', 'ASK_IF_BOOK', 'ASK_FOLLOWUP_QUESTION', 'TRANSFER'].includes(raw.followUpMode)
      ? raw.followUpMode
      : 'NONE',
    followUpQuestionText: (raw.followUpQuestionText && typeof raw.followUpQuestionText === 'string')
      ? raw.followUpQuestionText.trim()
      : null,
    transferTarget: (raw.transferTarget && typeof raw.transferTarget === 'string')
      ? raw.transferTarget.trim()
      : null,

    // ENTITIES & VARIABLES
    entities: Array.isArray(raw.entities)
      ? raw.entities.filter(e => e && typeof e === 'string').slice(0, 20)
      : [],
    dynamicTemplateVariables: normalizeVariables(raw.dynamicTemplateVariables),
    entityValidationRules: normalizeEntityValidationRules(raw.entityValidationRules),

    // CONFIDENCE & PRIORITY
    minConfidence: clampNumber(raw.minConfidence, 0.5, 0.9, 0.7),
    priority: clampNumber(raw.priority, -10, 10, 0),

    // ADVANCED BEHAVIOR
    cooldownSeconds: typeof raw.cooldownSeconds === 'number' ? Math.max(0, raw.cooldownSeconds) : 0,
    handoffPolicy: ['NEVER', 'LOW_CONFIDENCE_ONLY', 'ALWAYS_IF_REQUESTED'].includes(raw.handoffPolicy)
      ? raw.handoffPolicy
      : 'NEVER',

    // SILENCE POLICY
    silencePolicy: normalizeSilencePolicy(raw.silencePolicy),

    // TIMED FOLLOW-UP
    timedFollowup: normalizeTimedFollowup(raw.timedFollowup),

    // HOOKS & TESTS
    actionHooks: Array.isArray(raw.actionHooks)
      ? raw.actionHooks.filter(h => h && typeof h === 'string').slice(0, 20)
      : [],
    testPhrases: Array.isArray(raw.testPhrases)
      ? raw.testPhrases.filter(p => p && typeof p === 'string').slice(0, 10)
      : [],

    // NLP SUGGESTIONS
    suggestedFillerWords: Array.isArray(raw.suggestedFillerWords)
      ? raw.suggestedFillerWords.filter(w => w && typeof w === 'string').slice(0, 30)
      : [],
    suggestedSynonyms: normalizeSynonyms(raw.suggestedSynonyms),

    // AI INTELLIGENCE FIELDS
    behavior: (raw.behavior && typeof raw.behavior === 'string') ? raw.behavior.trim() : null,
    
    keywords: Array.isArray(raw.keywords)
      ? raw.keywords.filter(k => k && typeof k === 'string').map(k => k.toLowerCase().trim()).slice(0, 30)
      : [],
    
    negativeKeywords: Array.isArray(raw.negativeKeywords)
      ? raw.negativeKeywords.filter(k => k && typeof k === 'string').map(k => k.toLowerCase().trim()).slice(0, 20)
      : [],
    
    qnaPairs: Array.isArray(raw.qnaPairs)
      ? raw.qnaPairs
          .filter(pair => pair && pair.question && pair.answer)
          .map(pair => ({
            question: String(pair.question).trim(),
            answer: String(pair.answer).trim(),
            confidence: typeof pair.confidence === 'number' 
              ? Math.min(1, Math.max(0, pair.confidence))
              : 0.85
          }))
          .slice(0, 20)
      : [],
    
    testPhrases: Array.isArray(raw.testPhrases)
      ? raw.testPhrases.filter(p => p && typeof p === 'string').map(p => p.trim()).slice(0, 20)
      : [],
    
    examples: Array.isArray(raw.examples)
      ? raw.examples
          .filter(ex => ex && ex.caller && ex.ai)
          .map(ex => ({
            caller: String(ex.caller).trim(),
            ai: String(ex.ai).trim()
          }))
          .slice(0, 10)
      : [],
    
    escalationFlags: Array.isArray(raw.escalationFlags)
      ? raw.escalationFlags.filter(f => f && typeof f === 'string').map(f => f.trim()).slice(0, 10)
      : [],

    // NOTES
    notes: (raw.notes && typeof raw.notes === 'string') ? raw.notes.trim() : '',
  };

  return draft;
}

/**
 * Normalize array of weighted replies or strings into { text, weight }[] format.
 */
function normalizeWeightedReplies(input, minTarget, maxTarget) {
  if (!Array.isArray(input)) return [];

  let items = input
    .filter(item => {
      if (!item) return false;
      if (typeof item === 'string') return item.trim().length > 0;
      if (typeof item === 'object' && item.text) return String(item.text).trim().length > 0;
      return false;
    })
    .map(item => {
      if (typeof item === 'string') {
        return { text: item.trim(), weight: 3 };
      }
      const weight = typeof item.weight === 'number' && item.weight > 0 ? item.weight : 3;
      return { text: String(item.text).trim(), weight: Math.min(5, Math.max(1, weight)) };
    })
    .slice(0, maxTarget);

  return items;
}

/**
 * Clamp a number to [min, max] with a default fallback.
 */
function clampNumber(value, min, max, defaultValue) {
  if (typeof value !== 'number') return defaultValue;
  return Math.min(max, Math.max(min, value));
}

/**
 * Normalize dynamic template variables (keys must not contain {})
 */
function normalizeVariables(input) {
  if (!input || typeof input !== 'object') return {};
  
  const normalized = {};
  Object.keys(input).forEach(key => {
    const cleanKey = key.trim().replace(/[{}]/g, '');
    if (cleanKey && typeof input[key] === 'string') {
      normalized[cleanKey] = input[key].trim();
    }
  });
  
  return normalized;
}

/**
 * Normalize entity validation rules
 */
function normalizeEntityValidationRules(input) {
  if (!input || typeof input !== 'object') return {};
  
  const normalized = {};
  Object.keys(input).forEach(entityName => {
    const rule = input[entityName];
    if (rule && typeof rule === 'object' && rule.pattern) {
      normalized[entityName.trim().toLowerCase()] = {
        pattern: String(rule.pattern).trim(),
        prompt: rule.prompt && typeof rule.prompt === 'string' 
          ? rule.prompt.trim() 
          : `Please provide a valid ${entityName}`
      };
    }
  });
  
  return normalized;
}

/**
 * Normalize silence policy object
 */
function normalizeSilencePolicy(input) {
  if (!input || typeof input !== 'object') {
    return { 
      enabled: false,
      prompts: [],
      maxPrompts: 3,
      delaySeconds: 50,
      extensionSeconds: 30
    };
  }

  // Handle both old format (firstPrompt/repeatPrompt) and new format (prompts array)
  let prompts = [];
  if (Array.isArray(input.prompts)) {
    prompts = input.prompts
      .filter(p => p && typeof p === 'string')
      .map(p => p.trim())
      .slice(0, 10); // Max 10 variations
  } else if (input.firstPrompt || input.repeatPrompt) {
    // Legacy format - convert to array
    if (input.firstPrompt) prompts.push(input.firstPrompt.trim());
    if (input.repeatPrompt) prompts.push(input.repeatPrompt.trim());
  }

  // Ensure we have at least one prompt
  if (prompts.length === 0) {
    prompts = ['Are you still there?'];
  }

  return {
    enabled: !!input.enabled,
    prompts: prompts,
    maxPrompts: typeof input.maxPrompts === 'number' ? Math.max(1, input.maxPrompts) : 3,
    delaySeconds: typeof input.delaySeconds === 'number' ? Math.max(0, input.delaySeconds) : 50,
    extensionSeconds: typeof input.extensionSeconds === 'number' ? Math.max(0, input.extensionSeconds) : 30,
  };
}

/**
 * Normalize timed followup object
 */
function normalizeTimedFollowup(input) {
  if (!input || typeof input !== 'object') {
    return { 
      enabled: false,
      delaySeconds: 50,
      extensionSeconds: 30,
      messages: []
    };
  }

  // Extract messages array
  let messages = [];
  if (Array.isArray(input.messages)) {
    messages = input.messages
      .filter(m => m && typeof m === 'string')
      .map(m => m.trim())
      .slice(0, 10); // Max 10 variations
  }

  // Ensure we have at least one message if enabled
  if (input.enabled && messages.length === 0) {
    messages = ['Are you still there?'];
  }

  return {
    enabled: !!input.enabled,
    delaySeconds: typeof input.delaySeconds === 'number' ? Math.max(0, input.delaySeconds) : 50,
    extensionSeconds: typeof input.extensionSeconds === 'number' ? Math.max(0, input.extensionSeconds) : 30,
    messages: messages,
  };
}

/**
 * Normalize synonyms object { base: [variants...] }
 */
function normalizeSynonyms(input) {
  if (!input || typeof input !== 'object') return {};

  const normalized = {};
  Object.keys(input).forEach(base => {
    const variants = input[base];
    if (Array.isArray(variants)) {
      const cleanVariants = variants
        .filter(v => v && typeof v === 'string')
        .map(v => v.trim())
        .slice(0, 10);
      if (cleanVariants.length > 0) {
        normalized[base.trim()] = cleanVariants;
      }
    }
  });

  return normalized;
}

/**
 * POST /api/admin/scenario-assistant/draft
 * 
 * Generate a full-form scenario draft from admin description using LLM
 * Supports clarifying questions for nuanced scenarios
 * 
 * PHASE C.1: Full-form scenario architect with conversational questions
 * 
 * Request Body:
 *  - description: string (REQUIRED - admin's description of scenario)
 *  - channel: string (default 'voice')
 *  - templateVariables: string[] (list of available variables like {companyname}, {phone})
 * 
 * Response:
 *  - status: "ready" | "needs_clarification"
 *  - questions: string[] (only if needs_clarification)
 *  - draft: object (only if status === "ready")
 */
router.post('/draft', async (req, res) => {
  try {
    // Check if OpenAI is available
    if (!openaiClient) {
      return res.status(503).json({
        success: false,
        error: 'OpenAI service is not configured. Please set OPENAI_API_KEY environment variable.',
      });
    }
    
    const {
      description,
      conversationLog = [],
      channel = 'voice',
      templateVariables = [],
    } = req.body || {};

    // Validate required input
    if (!description || !description.trim()) {
      return res.status(400).json({
        success: false,
        error: 'description is required - describe what this scenario should do',
      });
    }

    // Load enterprise LLM settings
    let llmSettings;
    try {
      llmSettings = await getSettings('global');
      logger.debug('[LLM SCENARIO ASSISTANT] Loaded LLM enterprise settings', {
        activeProfile: llmSettings.defaults?.activeProfile,
        strictCompliance: llmSettings.compliance?.strictComplianceMode,
      });
    } catch (err) {
      logger.warn('[LLM SCENARIO ASSISTANT] Failed to load settings, using defaults', {
        error: err.message,
      });
      llmSettings = DEFAULT_LLM_ENTERPRISE_SETTINGS;
    }

    // Get effective model parameters based on active profile
    const modelParams = getEffectiveModelParams(llmSettings);

    // Fetch available AI behaviors for LLM to select from
    let behaviors = [];
    try {
      behaviors = await GlobalAIBehaviorTemplate.getActiveBehaviors();
      logger.debug('[LLM SCENARIO ASSISTANT] Loaded AI behaviors', {
        behaviorCount: behaviors.length
      });
    } catch (err) {
      logger.warn('[LLM SCENARIO ASSISTANT] Failed to load behaviors', {
        error: err.message
      });
    }

    logger.info('[LLM SCENARIO ASSISTANT] Processing scenario request with LLM settings', {
      descriptionLength: description.length,
      channel,
      templateVarCount: templateVariables.length,
      conversationTurns: Array.isArray(conversationLog) ? conversationLog.length : 0,
      profile: modelParams.profileKey,
      model: modelParams.model,
      temperature: modelParams.temperature,
      behaviorCount: behaviors.length
    });

    // Build system prompt using centralized function (includes base + profile + compliance)
    let systemPrompt = buildScenarioArchitectSystemPromptFromSettings(llmSettings);

    // Append the scenario-specific instructions (output format, rules, etc.)
    systemPrompt += `\n\n===== SCENARIO DRAFTING INSTRUCTIONS =====

Your specific task:
- Help admins design WORLD-CLASS call-handling scenarios
- Ask THOROUGH clarifying questions (never lazy, never skip)
- Validate settings against scenario type and reply strategy
- Cross-check confidence thresholds, entity captures, follow-up modes
- Generate comprehensive scenario drafts with all 30+ fields
- ACT LIKE A CODE REVIEWER — verify every detail before sign-off

ENTERPRISE-GRADE VALIDATION CHECKLIST (YOUR INTERNAL PROCESS):
Before generating a draft, mentally verify:
1. ✓ Is scenarioType aligned with the described intent?
2. ✓ Does replyStrategy match the scenarioType (e.g., BOOKING/EMERGENCY/TRANSFER → QUICK_THEN_FULL)?
3. ✓ Is minConfidence appropriate for the scenario specificity?
4. ✓ Are entities captured if the scenario needs data (booking, rescheduling)?
5. ✓ Is followUpMode set correctly (TRANSFER for escalations, ASK_IF_BOOK for bookings)?
6. ✓ Are all required trigger phrases covered (12–18 variants)?
7. ✓ Are negative triggers preventing false matches?
8. ✓ Are replies natural and spoken-friendly?
9. ✓ Is priority set correctly (high for urgent, low for fallback)?
10. ✓ Do NLP suggestions (filler words, synonyms) make sense?

IF ANY CHECKLIST ITEM SEEMS QUESTIONABLE:
Ask clarifying questions to resolve it. NEVER assume. NEVER take shortcuts.

RESPONSE FORMAT:
You MUST respond with ONLY valid JSON. No markdown, no explanations.

{
  "status": "ready" | "needs_clarification",
  "questions": [ "question1?", "question2?" ],   // ONLY if status === "needs_clarification"
  "draft": { ... }                               // ONLY if status === "ready"
}

WHEN TO ASK CLARIFYING QUESTIONS:
Set status="needs_clarification" if ANY of these apply:
1. The description is vague or missing key details
2. Scenario type seems misaligned with the intent
3. You're unsure about entity capture needs
4. Follow-up behavior is unclear (escalate vs. ask question?)
5. Settings alignment needs verification (e.g., BOOKING/EMERGENCY + confidence level)
6. Negative triggers seem insufficient to prevent false matches
7. Priority or minConfidence need admin guidance
8. The scenario needs data capture but no entities defined

Return 1–4 FOCUSED questions. Be specific.
Set draft=null in this case.

WHEN TO GENERATE A FULL DRAFT:
ONLY when you're 100% confident about ALL checklist items.
If ANY doubt remains, ask questions instead.
Set status="ready" and return a complete "draft" object.

🎭 AVAILABLE AI BEHAVIORS (SELECT ONE):
${behaviors.length > 0 ? behaviors.map(b => 
  `- "${b.behaviorId}": ${b.name} (${b.bestFor || b.instructions.substring(0, 80)}...)`
).join('\n') : '- No behaviors loaded (use null)'}

Select the MOST APPROPRIATE behavior based on the scenario's emotional tone and use case.
Examples:
- Empathetic scenarios → use empathetic/reassuring behavior
- Business queries → use professional/efficient behavior
- Urgent situations → use urgent/action-oriented behavior

FULL DRAFT SPECIFICATION (Phase C.1):
{
  "name": "Human-readable scenario name",

  "scenarioType": "FAQ" | "TROUBLESHOOT" | "BOOKING" | "EMERGENCY" | "TRANSFER" | "BILLING" | "SYSTEM" | "SMALL_TALK",
  "replyStrategy": "AUTO" | "FULL_ONLY" | "QUICK_ONLY" | "QUICK_THEN_FULL" | "LLM_WRAP" | "LLM_CONTEXT",

  // 🎭 AI BEHAVIOR (SELECT FROM LIST ABOVE)
  "behavior": "behavioral-id-string",  // REQUIRED: Select from available behaviors list above

  // 1. TRIGGERS & EXAMPLES (many variants for matching robustness)
  "triggerPhrases": [ "phrase1", ... ],          // 12–18 natural caller phrases
  "negativeTriggers": [ "phrase1", ... ],        // 5–10 phrases that should NOT match
  "regexTriggers": [ "pattern1", ... ],          // Optional regex patterns

  // 2. REPLIES (weighted for selective delivery)
  "quickReplies": [
    { "text": "short acknowledgement", "weight": 3 },
    { "text": "another variant", "weight": 2 }
  ],
  "fullReplies": [
    { "text": "complete answer with all details", "weight": 4 },
    { "text": "alternative full response", "weight": 3 }
  ],
  "followUpPrompts": [
    { "text": "follow-up question or suggestion", "weight": 3 }
  ],

  // 3. FOLLOW-UP BEHAVIOR (shape next interaction)
  "followUpMode": "NONE" | "ASK_IF_BOOK" | "ASK_FOLLOWUP_QUESTION" | "TRANSFER",
  "followUpQuestionText": "Will you be scheduling a visit?" | null,
  "transferTarget": "+15551234567" | "sales_queue" | null,

  // 4. ENTITIES & VARIABLES (capture caller data)
  "entities": [ "name: PERSON", "phone: PHONE", "date: DATE", "time: TIME" ],  // What to capture from caller
  "entityValidationRules": {
    "phone": { "pattern": "^[0-9]{10}$", "prompt": "Please provide a 10-digit phone number" },
    "email": { "pattern": "@", "prompt": "Please provide a valid email address" },
    "date": { "pattern": "^\\d{4}-\\d{2}-\\d{2}$", "prompt": "Please provide a date (YYYY-MM-DD)" }
  },
  "dynamicTemplateVariables": {
    "companyname": "Your service provider's name",
    "phone": "Your main phone number",
    "office_city": "City where you're located"
  },
  // NOTE: ALWAYS use templates like {companyname}, {phone}, {office_city}.
  // NEVER insert real values. The template will substitute them per company.

  // 5. CONFIDENCE & PRIORITY
  "minConfidence": 0.7,                          // 0.5–0.9: when to accept this scenario
  "priority": 0,                                 // -10..+10: tiebreaker preference

  // 6. ADVANCED BEHAVIOR
  "cooldownSeconds": 30,                         // Avoid repeating this scenario too soon
  "handoffPolicy": "NEVER" | "LOW_CONFIDENCE_ONLY" | "ALWAYS_IF_REQUESTED",

  "silencePolicy": {
    "enabled": false,
    "maxConsecutive": 2,
    "finalWarning": "Hello? Did I lose you?"
  },

  "timedFollowup": {
    "enabled": true,
    "delaySeconds": 50,
    "extensionSeconds": 30,
    "messages": [  // Generate 3-5 variations (system will rotate randomly)
      "Are you still there?",
      "Just checking in...",
      "Hello? I'm still here if you need me.",
      "Take your time—I'm here when you're ready.",
      "Still on the line? Let me know if you need anything."
    ]
  },

  // 7. ACTION HOOKS & TESTING
  "actionHooks": [ "offer_scheduling", "capture_email" ],  // Backend triggers
  "testPhrases": [ "Can I reschedule my appointment?", "I need to move my visit", ... ],  // 5–10 phrases

  // 8. AI INTELLIGENCE & MATCHING (CRITICAL - DO NOT SKIP)
  "keywords": [ "appointment", "schedule", "book", "visit", ... ],  // REQUIRED: 10-20 keywords extracted from triggers
  "negativeKeywords": [ "don't", "not", "never", "cancel", ... ],  // REQUIRED: 5-10 words that VETO this scenario
  
  "qnaPairs": [  // REQUIRED: Generate 8-15 Q&A pairs from triggers + replies
    {
      "question": "How do I book an appointment?",
      "answer": "I'd be happy to help you schedule an appointment. What day works best?",
      "confidence": 0.92
    },
    {
      "question": "Can I schedule a visit?",
      "answer": "Of course! Let's get you scheduled.",
      "confidence": 0.88
    }
    // ... more Q&A pairs
  ],
  
  "escalationFlags": [ "angry", "confused", "frustrated", "urgent" ],  // When to escalate to human
  
  "examples": [  // Training examples (2-4 sample conversations)
    {
      "caller": "I need to reschedule my appointment",
      "ai": "I'd be happy to help you move your appointment. What's your current appointment date?"
    }
  ],

  // 9. NLP SUGGESTIONS (for template-level learning)
  "suggestedFillerWords": [ "uh", "like", "you know", ... ],
  "suggestedSynonyms": {
    "appointment": [ "visit", "meeting", "consultation", "session" ],
    "cancel": [ "reschedule", "change", "move", "delay" ]
  },

  "notes": "Internal note for admins (e.g., 'High-volume scenario, needs robust triggers')"
}

GUIDELINES:

1. TRIGGERS & EXAMPLES:
   - Provide 12–18 triggerPhrases covering realistic caller language
   - Provide 5–10 negativeTriggers to prevent false matches
   - Use natural, conversational phrases, not formal business-speak

2. REPLIES (CRITICAL: GENERATE MANY VARIATIONS TO SOUND NATURAL, NOT ROBOTIC):
   
   ⚠️ MANDATORY MINIMUMS (DO NOT GENERATE FEWER):
   - quickReplies: MINIMUM 7, TARGET 10 (Brief acknowledgements, 5–15 words each)
   - fullReplies: MINIMUM 7, TARGET 10 (Complete answers, 2–5 sentences each)
   - followUpPrompts: MINIMUM 3, TARGET 5 (Gentle next-step invitations)
   
   WHY SO MANY? The AI agent rotates these randomly during live calls. With only 2-3 variations,
   callers will hear the SAME replies repeatedly and it sounds ROBOTIC. With 7-10 variations,
   every call feels unique and human-like.
   
   RULES:
   - Each variation must be DISTINCT in phrasing and tone (not just word swaps)
   - Mix formal/casual, short/long, direct/warm styles
   - Balance weights so no single reply dominates (use weight: 3 for most)
   - Use natural, spoken language (contractions, casual phrases)
   
   EXAMPLE (Full Replies for "Blank Thermostat"):
   [
     {text: "Your thermostat display might be blank due to several reasons. Would you like to try some preliminary checks or schedule a technician?", weight: 3},
     {text: "A blank thermostat display can be caused by various issues like power supply problems. Would you like to go through some checks or have a technician visit?", weight: 3},
     {text: "I can help with that blank screen issue. Let's see what we can do to get it working again.", weight: 3},
     {text: "No worries, blank thermostats are pretty common and often have simple fixes. Want to troubleshoot together or book a tech?", weight: 3},
     {text: "Let's figure out what's going on with your thermostat. We can either walk through some quick checks or I can send someone out.", weight: 3},
     {text: "That blank display is definitely frustrating! I've got a few things we can try, or I can schedule a service call for you.", weight: 3},
     {text: "Blank thermostat? That's a common issue. We can troubleshoot it right now or get a technician scheduled if you prefer.", weight: 3},
     {text: "I understand how annoying that blank screen can be. Would you like me to guide you through some fixes or arrange a visit?", weight: 3},
     {text: "There are several reasons your thermostat might be blank. Happy to help you check a few things or book an appointment.", weight: 3},
     {text: "Let me help you with that thermostat. We have a couple of options: quick troubleshooting now or scheduling a pro to come out.", weight: 3}
   ]
   
   ↑ THIS IS WHAT 10 VARIATIONS LOOKS LIKE. Generate this many for EVERY scenario.

3. ENTITIES & VALIDATION (CRITICAL: Generate validation rules for data quality):
   
   ⚠️ TWO-PART REQUIREMENT:
   
   A) entities[] - List what data to capture (formatted as "entity_name: TYPE"):
      Examples:
      - "name: PERSON"
      - "phone: PHONE"
      - "email: EMAIL"
      - "date: DATE"
      - "time: TIME"
      - "address: ADDRESS"
      - "issue: TEXT"
   
   B) entityValidationRules{} - Define validation patterns for each entity:
      Format: JSON object where each key matches an entity name
      
      EXAMPLE:
      {
        "phone": {
          "pattern": "^[0-9]{10}$",
          "prompt": "Please provide a 10-digit phone number"
        },
        "email": {
          "pattern": "@",
          "prompt": "Please provide a valid email address"
        },
        "date": {
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$|^\\d{1,2}/\\d{1,2}/\\d{4}$",
          "prompt": "Please provide a date (e.g., 2025-11-15 or 11/15/2025)"
        },
        "time": {
          "pattern": "^\\d{1,2}:\\d{2}|^\\d{1,2}(am|pm)$",
          "prompt": "Please provide a time (e.g., 2:00 PM or 14:00)"
        }
      }
      
   COMMON PATTERNS:
   - phone: "^[0-9]{10}$" (10 digits)
   - email: "@" (contains @)
   - date: "^\\d{4}-\\d{2}-\\d{2}$" (YYYY-MM-DD)
   - time: "^\\d{1,2}:\\d{2}" (HH:MM)
   - zip: "^\\d{5}$" (5 digits)
   - name: "^[A-Za-z\\s]{2,}$" (letters and spaces, 2+ chars)
   
   WHY? The AI agent will validate captured data during calls and re-prompt if invalid,
   ensuring data quality before saving.

4. VARIABLES:
   - Use ONLY template placeholders: {companyname}, {phone}, {address}, {website_url}, etc.
   - NEVER insert real values
   - Provide descriptions so the template admin understands what should be filled

5. SCENARIO TYPE DEFAULTS:
   - FAQ (facts): replyStrategy often "AUTO" or "FULL_ONLY"
   - BOOKING/EMERGENCY/TRANSFER (action): replyStrategy often "QUICK_THEN_FULL"
   - SYSTEM (internal): replyStrategy often "QUICK_ONLY"
   - SMALL_TALK: replyStrategy often "QUICK_ONLY"

6. FOLLOW-UP MODES (CRITICAL: ALWAYS SET followUpMode AND GENERATE followUpQuestionText):
   
   ⚠️ MANDATORY: Every scenario MUST have a follow-up strategy!
   
   OPTIONS:
   - ASK_FOLLOWUP_QUESTION: Append followUpQuestionText after the main reply
     → ALWAYS generate a custom followUpQuestionText for this scenario
     → Examples: "Is there anything else I can help you with?", 
                 "Would you like to schedule a service call?",
                 "Do you have any other HVAC questions?"
     → Make it relevant to THIS scenario (not generic)
   
   - ASK_IF_BOOK: Offer booking automatically (for service/appointment scenarios)
     → System will append: "Would you like to schedule an appointment?"
     → Set followUpQuestionText to null for this mode
   
   - TRANSFER: Hand off to agent/queue
     → Set transferTarget to the agent name or queue (e.g., "scheduling_team", "customer_service")
     → Set followUpQuestionText to null for this mode
   
   - NONE: Scenario ends, no further prompting (rare - only for confirmations/acknowledgments)
   
   DEFAULT: Most scenarios should use ASK_FOLLOWUP_QUESTION with a custom, relevant question.

7. TIMED FOLLOW-UP (AUTO-PROMPT WHEN CALLER IS SILENT):
   - ALWAYS enable timedFollowup (set enabled: true)
   - Generate 3-5 varied "Are you still there?" messages in timedFollowup.messages[]
   - Make them natural, friendly, and conversational
   - Avoid sounding robotic or impatient
   - Examples: "Are you still there?", "Just checking in...", "Hello? I'm still here if you need me."
   - The system will rotate these randomly so the AI doesn't repeat the same phrase
   - Set reasonable defaults: delaySeconds: 50, extensionSeconds: 30

8. BEHAVIOR SELECTION (REQUIRED - NEVER LEAVE NULL):
   - Review the AVAILABLE AI BEHAVIORS list above
   - Select the MOST APPROPRIATE behaviorId for this scenario's emotional tone
   - Examples:
     * Troubleshooting → "Professional & Helpful" or "Patient & Reassuring"
     * Urgent/Emergency → "Urgent & Action-Oriented"
     * Sales/Marketing → "Friendly & Enthusiastic"
     * Technical Support → "Technical & Precise"
   - NEVER set behavior to null - always select one from the available list

9. CONFIDENCE & PRIORITY:
   - minConfidence: 0.5–0.9 (higher for specific, lower for generic)
   - priority: -10 to +10 (higher priority wins ties)
   - Use minConfidence 0.8–0.9 for critical scenarios (emergencies, account cancellation)
   - Use priority +5 to +10 for high-urgency scenarios

10. AI INTELLIGENCE FIELDS (CRITICAL - ALWAYS GENERATE):
   - keywords: Extract 10-20 single words from triggerPhrases (lowercase, no duplicates)
     Example: ["appointment", "schedule", "book", "visit", "reschedule", "time", "date"]
   
   - negativeKeywords: Extract 5-10 words from negativeTriggers that VETO matches
     Example: ["don't", "not", "never", "won't", "cancel", "refuse"]
   
   - qnaPairs: Generate 8-15 Q&A pairs combining triggers with replies
     Each pair needs: question (natural), answer (from replies), confidence (0.8-0.95)
     Vary the questions to cover different phrasings
   
   - escalationFlags: List 3-6 sentiment/situation triggers for human handoff
     Example: ["angry", "confused", "frustrated", "technical_issue", "urgent", "vip"]
   
   - examples: Provide 2-4 sample conversations showing expected flow
     Keep caller phrases natural, AI responses from the fullReplies you generated

11. ENTITY FORMATTING (IMPORTANT):
   - Format entities as: "entity_name: ENTITY_TYPE"
   - Examples:
     * "name: PERSON" (not just "name")
     * "phone: PHONE_NUMBER" (not just "phone")
     * "preferred_date: DATE" (not just "preferred_date")
     * "preferred_time: TIME" (not just "time")
   - This helps the frontend display them correctly

12. NLP SUGGESTIONS:
   - suggestedFillerWords: junk phrases to strip from caller input
   - suggestedSynonyms: colloquial phrases → normalized terms for matching
   - These improve Tier 1 (rule-based) matching over time

OUTPUT RULES:
- ALWAYS respond with valid JSON only.
- If questions are needed, set status="needs_clarification" and draft=null.
- If ready, set status="ready" and populate draft completely.
- CRITICAL: When status="ready", ALSO include a "checklistSummary" object:
  {
    "coverageScore": 0.85,                           // 0–1: how complete is the form
    "settingsNeedingAttention": [
      {
        "field": "handoffPolicy",
        "reason": "Not mentioned; defaulting to LOW_CONFIDENCE_ONLY. Verify this is correct."
      },
      {
        "field": "silencePolicy",
        "reason": "No mention of dead air handling; set to conservative defaults."
      }
    ]
  }
- Never leave arrays empty; provide at least 1 item per array.
- Never use real company names, phone numbers, or personal data.
- Use {variable} syntax for template placeholders.
- When you make an assumption (e.g., default cooldown, guess at priority), LIST it in checklistSummary.
- This ensures admin can see EXACTLY what you decided and why.`.trim();

    const templateVarList = Array.isArray(templateVariables) && templateVariables.length > 0
      ? `\nKnown template variables (available to use as {variable} placeholders):\n${templateVariables.map(v => `- {${v}}`).join('\n')}`
      : '';

    // Build conversation history for multi-turn (Phase C.1 conversational)
    const conversationHistory = Array.isArray(conversationLog) && conversationLog.length > 0
      ? `\nPrevious conversation:\n${conversationLog.map(msg => `${msg.role === 'assistant' ? 'AI' : 'Admin'}: ${msg.content}`).join('\n')}\n`
      : '';

    const userPrompt = `Channel: ${channel}

Admin's scenario description:
"""
${description.trim()}
"""
${conversationHistory}${templateVarList}

If you need clarification before creating a full-quality scenario, return status="needs_clarification" with 1–3 clear questions.
Otherwise, return status="ready" with a comprehensive "draft" object.`.trim();

    // Call OpenAI with enterprise settings
    logger.debug('[LLM SCENARIO ASSISTANT] Calling OpenAI with enterprise settings', {
      systemPromptLength: systemPrompt.length,
      userPromptLength: userPrompt.length,
      channel,
      model: modelParams.model,
      temperature: modelParams.temperature,
      topP: modelParams.topP,
      maxTokens: modelParams.maxTokens,
      profile: modelParams.profileName,
    });

    const completion = await openaiClient.chat.completions.create({
      model: modelParams.model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: modelParams.temperature,
      top_p: modelParams.topP,
      max_tokens: modelParams.maxTokens,
    });

    // Parse response
    let parsed;
    try {
      const rawContent = completion.choices[0].message.content;
      logger.debug('[LLM SCENARIO ASSISTANT] LLM response received', {
        length: rawContent.length,
        preview: rawContent.substring(0, 150),
      });
      
      parsed = JSON.parse(rawContent);
    } catch (parseErr) {
      logger.error('[LLM SCENARIO ASSISTANT] Failed to parse LLM JSON', {
        error: parseErr.message,
      });
      return res.status(500).json({
        success: false,
        error: 'LLM response was not valid JSON',
      });
    }

    // Route based on status
    const status = parsed.status === 'needs_clarification' ? 'needs_clarification' : 'ready';
    const questions = Array.isArray(parsed.questions) 
      ? parsed.questions.filter(q => q && typeof q === 'string').slice(0, 5)
      : [];

    let draft = null;

    if (status === 'ready' && parsed.draft && typeof parsed.draft === 'object') {
      // Sanitize & normalize the draft (Phase C.1 extended)
      draft = sanitizeScenarioDraft(parsed.draft);

      logger.info('[LLM SCENARIO ASSISTANT] ✅ Full scenario draft generated (Phase C.1)', {
        name: draft.name,
        scenarioType: draft.scenarioType,
        replyStrategy: draft.replyStrategy,
        triggersCount: draft.triggerPhrases.length,
        negativesCount: draft.negativeTriggers.length,
        quickRepliesCount: draft.quickReplies.length,
        fullRepliesCount: draft.fullReplies.length,
        entitiesCount: draft.entities.length,
        variablesCount: Object.keys(draft.dynamicTemplateVariables).length,
      });
    } else if (status === 'needs_clarification') {
      logger.info('[LLM SCENARIO ASSISTANT] Clarifying questions needed', {
        questionCount: questions.length,
      });
    }

    // Extract checklistSummary if LLM provided it
    const checklistSummary = status === 'ready' && parsed.checklistSummary
      ? parsed.checklistSummary
      : {
          coverageScore: draft ? 0.9 : 0.5,
          settingsNeedingAttention: [],
        };

    return res.json({
      success: true,
      status,
      questions: status === 'needs_clarification' ? questions : undefined,
      draft: status === 'ready' ? draft : null,
      checklistSummary: status === 'ready' ? checklistSummary : undefined,
      metadata: {
        model: modelParams.model,
        profile: modelParams.profileKey,
        profileLabel: modelParams.profileLabel,
        temperature: modelParams.temperature,
        topP: modelParams.topP,
        maxTokens: modelParams.maxTokens,
        safetyMode: modelParams.safetyMode,
        tokensUsed: completion.usage.total_tokens,
        generatedAt: new Date().toISOString(),
        phase: 'C.1-full-scenario-architect-with-enterprise-settings',
      },
    });
  } catch (err) {
    logger.error('[LLM SCENARIO ASSISTANT] Error processing scenario request', {
      error: err.message,
      stack: err.stack,
    });
    return res.status(500).json({
      success: false,
      error: 'Internal error processing scenario',
      details: err.message,
    });
  }
});

/**
 * ============================================================================
 * GET /suggestions - Generate scenario suggestions based on category context
 * ============================================================================
 * Purpose: Help admins discover what scenarios they should add to a category
 * 
 * Query Params:
 *  - categoryName: string (e.g., "Appointment Booking")
 *  - categoryDescription: string (optional)
 *  - templateName: string (e.g., "Dental Office Template")
 *  - templateIndustry: string (e.g., "Dental", "HVAC")
 *  - existingScenarios: number (how many scenarios already exist in category)
 * 
 * Response:
 *  - suggestions: string[] (10 scenario ideas)
 */
router.get('/suggestions', async (req, res) => {
  try {
    // Check if OpenAI is available
    if (!openaiClient) {
      return res.status(503).json({
        success: false,
        error: 'OpenAI service is not configured. Please set OPENAI_API_KEY environment variable.',
      });
    }
    
    const {
      categoryName = 'General',
      categoryDescription = '',
      templateName = 'Universal AI Brain',
      templateIndustry = 'All Industries',
      existingScenarios = 0,
    } = req.query;

    logger.info('[LLM SCENARIO SUGGESTIONS] Generating suggestions', {
      categoryName,
      templateIndustry,
      existingScenarios: Number(existingScenarios),
    });

    // Load enterprise LLM settings
    let llmSettings;
    try {
      llmSettings = await getSettings('global');
    } catch (err) {
      logger.warn('[LLM SCENARIO SUGGESTIONS] Failed to load settings, using defaults', {
        error: err.message,
      });
      llmSettings = DEFAULT_LLM_ENTERPRISE_SETTINGS;
    }

    // Get effective model parameters
    const modelParams = getEffectiveModelParams(llmSettings);

    // Build system prompt (use base prompt for consistency)
    const basePrompt = buildScenarioArchitectSystemPromptFromSettings(llmSettings);

    // Build suggestions-specific prompt
    const suggestionsPrompt = `${basePrompt}

===== SCENARIO SUGGESTIONS TASK =====

Your task: Suggest 10 common, practical scenarios that should exist in this category.

CONTEXT:
- Category: "${categoryName}"
- Category Description: "${categoryDescription || 'Not provided'}"
- Template: "${templateName}"
- Industry: "${templateIndustry}"
- Existing Scenarios: ${existingScenarios}

RULES:
1. Suggest scenarios that are COMMON in this industry and category
2. Think about what REAL customers call about
3. Cover the most important 10 use cases
4. Be specific but not too narrow
5. Use natural, human-friendly names (not technical jargon)
6. If existingScenarios > 0, suggest DIFFERENT scenarios (avoid duplicates)
7. Prioritize high-volume, high-impact scenarios

OUTPUT FORMAT (MUST BE VALID JSON):
{
  "suggestions": [
    "Scenario name 1",
    "Scenario name 2",
    "Scenario name 3",
    ...10 total
  ]
}

EXAMPLES FOR CONTEXT:

Category: "Appointment Booking" | Industry: "Dental"
{
  "suggestions": [
    "Schedule Dental Cleaning",
    "Reschedule Existing Appointment",
    "Cancel Appointment",
    "Same-Day Emergency Appointment",
    "New Patient First Visit",
    "Book Root Canal Consultation",
    "Schedule Follow-Up After Procedure",
    "Check Appointment Availability",
    "Confirm Upcoming Appointment",
    "Waitlist for Earlier Slot"
  ]
}

Category: "Emergency Service" | Industry: "HVAC"
{
  "suggestions": [
    "No Heat in Winter",
    "AC Not Cooling in Summer",
    "Furnace Making Loud Noise",
    "Thermostat Not Responding",
    "Water Leaking from AC Unit",
    "Strange Smell from Vents",
    "System Won't Turn On",
    "Frozen AC Coils",
    "Circuit Breaker Keeps Tripping",
    "Emergency After-Hours Service"
  ]
}

Now generate 10 suggestions for:
Category: "${categoryName}"
Industry: "${templateIndustry}"

RESPOND WITH ONLY VALID JSON.`;

    // Call OpenAI
    const completion = await openaiClient.chat.completions.create({
      model: modelParams.model,
      messages: [
        {
          role: 'system',
          content: suggestionsPrompt,
        },
      ],
      temperature: modelParams.temperature,
      top_p: modelParams.topP,
      max_tokens: 1000, // Suggestions are shorter than full drafts
    });

    const rawResponse = completion.choices[0]?.message?.content || '';
    logger.debug('[LLM SCENARIO SUGGESTIONS] Raw LLM response received', {
      length: rawResponse.length,
    });

    // Parse JSON
    let parsed;
    try {
      const cleaned = rawResponse
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      logger.error('[LLM SCENARIO SUGGESTIONS] Failed to parse JSON', {
        error: parseErr.message,
      });
      return res.status(500).json({
        success: false,
        error: 'LLM response was not valid JSON',
      });
    }

    // Validate suggestions
    const suggestions = Array.isArray(parsed.suggestions)
      ? parsed.suggestions.filter(s => s && typeof s === 'string').slice(0, 15)
      : [];

    if (suggestions.length === 0) {
      return res.status(500).json({
        success: false,
        error: 'No valid suggestions generated',
      });
    }

    logger.info('[LLM SCENARIO SUGGESTIONS] ✅ Generated suggestions', {
      count: suggestions.length,
      categoryName,
      templateIndustry,
    });

    return res.json({
      success: true,
      suggestions,
      metadata: {
        model: modelParams.model,
        profile: modelParams.profileKey,
        categoryName,
        templateIndustry,
        tokensUsed: completion.usage.total_tokens,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    logger.error('[LLM SCENARIO SUGGESTIONS] Error generating suggestions', {
      error: err.message,
      stack: err.stack,
    });
    return res.status(500).json({
      success: false,
      error: 'Internal error generating suggestions',
      details: err.message,
    });
  }
});

module.exports = router;

