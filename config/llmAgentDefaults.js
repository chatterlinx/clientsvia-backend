// config/llmAgentDefaults.js
//
// LLM Agent — Discovery + Answer-from-KB Configuration Defaults
// =============================================================
// Every field is UI-configurable via services.html (Agent Studio tabs:
// Behavior / Intake / Model / System Prompt).
// Code reads these as fallbacks when a company has no saved config.
// Rule: "If it's not UI, it does not exist."
//

const DEFAULT_LLM_AGENT_SETTINGS = {
  enabled: false,

  // ── Model & Persona ──────────────────────────────────────────────────────
  model: {
    provider: 'anthropic',
    modelId: 'claude-haiku-4-5-20251001',   // Haiku 4.5 — fast, affordable, ideal for receptionist work
    temperature: 0.7,
    maxTokens: 300                            // Keep voice responses short
  },

  persona: {
    name: '',                                 // e.g. "Sarah" — empty = no name used
    role: 'receptionist',                     // receptionist | assistant | concierge
    chattiness: 3,                            // 1=terse  2=brief  3=balanced  4=conversational  5=chatty
    tone: 'friendly-professional',            // friendly-professional | formal | casual | warm
    language: 'en'                            // BCP-47 language tag
  },

  // ── Activation Rules ─────────────────────────────────────────────────────
  activation: {
    channels: {
      call: true,
      sms: true,
      webchat: true
    },
    triggerFallback: true,                    // Step in when trigger matching fails
    followUpRescue: true,                     // Handle broken follow-up conversation context
    lowConfidenceThreshold: 0.4,              // Take over when trigger confidence below this
    maxTurnsPerSession: 10,                   // Max agent turns before forced escalation
    silenceTimeoutMs: 8000                    // Silence before agent prompts caller
  },

  // ── Backup Model (Package 5: 123RP resilience) ──────────────────────────
  // If primary model fails (API error, not timeout), retry with faster backup.
  // Only triggers on retryable failures — timeouts mean model was working.
  backupModel: {
    enabled: true,
    modelId: 'claude-haiku-4-5-20251001',     // Same as primary default — fast, reliable
    temperature: 0.5,                           // Slightly lower for reliability
    maxTokens: 200                              // Shorter to ensure faster response
  },

  // ── Guardrails ───────────────────────────────────────────────────────────
  guardrails: {
    noPiiCollection: true,                    // Agent must NOT collect PII
    noScheduling: true,                       // Agent must NOT book/schedule appointments
    noPricing: true,                          // Agent must NOT quote prices or fees
    noMedicalAdvice: true,                    // Agent must NOT give medical advice
    noLegalAdvice: true,                      // Agent must NOT give legal advice
    customRules: []                           // [{rule: 'Never promise same-day service'}]
  },

  // ── Handoff Configuration ────────────────────────────────────────────────
  handoff: {
    mode: 'auto',                             // auto | manual | disabled
    passIntent: true,                         // Include discovered intent in handoff
    passContext: true,                         // Include conversation context
    passSentiment: true,                      // Include caller sentiment analysis
    passConversationHistory: true,            // Include full conversation history
    escalationMessage: 'Let me connect you with someone who can help with that.'
  },

  // ── Behavior Rules ──────────────────────────────────────────────────────
  // Each rule: { id, title, rule, category, enabled, isDefault, priority, createdAt, updatedAt }
  //   category: 'emotional' — handling caller emotions (anger, frustration, hesitation)
  //             'language'  — language switching, communication barriers
  //             'intent'    — multiple intents, topic changes, ambiguity
  //             'flow'      — conversational flow edge cases
  //             'custom'    — admin-created rules
  //
  // Pre-seeded with DEFAULT_BEHAVIOR_RULES on first load (onboarding-ready)
  behaviorRules: [],

  // ── Knowledge Source ─────────────────────────────────────────────────────
  // DEPRECATED (removed April 2026): `knowledgeCards` field is no longer part
  // of the LLM agent config. KC containers (services.html) are the single
  // source of truth for company knowledge. At runtime, kcContext is built
  // from live-ranked KC sections and injected into composeSystemPrompt's
  // KNOWLEDGE BASE block. See UAP/v1.md §17 (Agent Studio) for full design.
  //
  // If a legacy company has `knowledgeCards[]` populated in Mongo, it will
  // be IGNORED by the runtime. A one-time audit script logs any such data:
  //   scripts/audit-knowledge-cards.js

  // ── System Prompt Override ───────────────────────────────────────────────
  // Empty = use built-in default template (composed from persona + guardrails + KC)
  // Non-empty = full override — replaces the entire system prompt
  systemPrompt: ''
};

// ── Turn-1 LLM Intake Defaults ────────────────────────────────────────────
// Structured entity extraction + warm acknowledgment on the caller's first utterance.
// Bypasses ScrabEngine and triggers. Writes extracted entities into ScrabEngine state format.
const DEFAULT_INTAKE_SETTINGS = {
  enabled: false,

  model: {
    provider: 'anthropic',
    modelId: 'claude-haiku-4-5-20251001',
    temperature: 0.3,       // Lower temp for extraction accuracy
    maxTokens: 600          // JSON output needs more tokens than voice-only
  },

  // Controls which turn this fires on (always 1 for now, future-proofed)
  triggerOnTurn: 1,

  // Entity extraction targets — toggle which fields to attempt
  extract: {
    firstName: true,
    lastName: true,
    phone: true,
    email: false,           // Rarely given on turn 1 in phone calls
    address: true,
    callReason: true,
    employeeMentioned: true,
    priorVisit: true,
    urgency: true,
    sameDayRequested: true
  },

  // Response behavior
  response: {
    maxSentences: 3,      // 3 sentences: (1) greet by name, (2) acknowledge issue + tech mention, (3) solution offer
    includeConfirmation: true,
    includeForwardMove: true
  },

  // Confidence thresholds for accepting extracted values
  confidence: {
    nameThreshold: 0.70,
    phoneThreshold: 0.80,
    addressThreshold: 0.60,
    reasonThreshold: 0.50
  },

  // ── Split-Call Architecture ────────────────────────────────────────────────
  // When enabled: Call 1 (8b, ~30ms) extracts entities as JSON,
  // Call 2 (70b, streaming) generates the plain-text response with entities known.
  // Benefit: 70b speaks naturally without JSON constraints; onSentence fires
  // on the first plain-text token — no {"responseText": "..."} prefix overhead.
  splitCalls: {
    enabled:         true,                       // DEFAULT ON — Groq two-call path for all companies
    extractionModel: 'llama-3.1-8b-instant',     // hardcoded: always right for structured JSON extraction
    responseModel:   'llama-3.3-70b-versatile',  // configurable per company if needed
  }
};

// ── Chattiness Level Descriptions (used in system prompt composition) ──────
const CHATTINESS_LEVELS = {
  1: 'Extremely brief. One sentence max. No filler words. Get to the point immediately.',
  2: 'Brief and direct. Short sentences. Minimal pleasantries.',
  3: 'Balanced and natural. Polite but efficient. Like a professional receptionist.',
  4: 'Conversational and warm. Use natural transitions. Show genuine interest.',
  5: 'Chatty and engaging. Build rapport. Use colloquial language. Take your time.'
};

// ── Tone Descriptions (used in system prompt composition) ──────────────────
const TONE_DESCRIPTIONS = {
  'friendly-professional': 'Warm but businesslike. Smile in your voice but stay on task.',
  'formal': 'Professional and courteous. Use proper titles. No slang or contractions.',
  'casual': 'Relaxed and approachable. Use contractions. Like talking to a friend.',
  'warm': 'Empathetic and caring. Show understanding. Patient and supportive.'
};

// ── Role Descriptions (used in system prompt composition) ──────────────────
const ROLE_DESCRIPTIONS = {
  'receptionist': 'You are a receptionist answering incoming calls/messages for the business.',
  'assistant': 'You are a virtual assistant helping customers with their inquiries.',
  'concierge': 'You are a concierge providing personalized guidance and recommendations.'
};

// ── Channel-Specific Instructions ─────────────────────────────────────────
const CHANNEL_INSTRUCTIONS = {
  call: 'This is a PHONE CALL. Keep responses SHORT (1-2 sentences). The caller is listening, not reading. Speak naturally. Avoid lists or URLs.',
  sms: 'This is an SMS conversation. Keep messages concise but complete. You can use light formatting. Include essential details.',
  webchat: 'This is a WEBCHAT conversation. You can be slightly more detailed. Use short paragraphs. Be responsive and helpful.'
};

// ── Available LLM Providers ────────────────────────────────────────────────
// Returned by GET /llm-agent/config so the UI can populate the provider
// dropdown. providerStatus (which keys are configured on the server) is
// added at the API layer — not here — since it requires env var access.
const AVAILABLE_PROVIDERS = [
  {
    id:          'anthropic',
    label:       'Anthropic (Claude)',
    description: 'Industry-leading accuracy — best for complex reasoning and nuanced conversations',
    envKey:      'ANTHROPIC_API_KEY',
    models:      ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-6'],
  },
  {
    id:          'groq',
    label:       'Groq (Llama)',
    description: 'Ultra-fast LPU inference (~300ms) — eliminates bridge latency on turn 1',
    envKey:      'GROQ_API_KEY',
    models:      ['llama-3.1-70b-versatile', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
  },
];

// ── Available Models ───────────────────────────────────────────────────────
// provider field: UI uses this to filter model list when provider changes.
// Groq model IDs pass through GroqStreamAdapter unchanged (no translation).
const AVAILABLE_MODELS = [
  // ── Anthropic (Claude) ──────────────────────────────────────────────────
  { id: 'claude-haiku-4-5-20251001', provider: 'anthropic', label: 'Claude Haiku 4.5',  description: 'Fast & affordable — ideal for receptionist work', tier: 'default' },
  { id: 'claude-sonnet-4-6',         provider: 'anthropic', label: 'Claude Sonnet 4.6', description: 'Smarter — for complex industries (dental, legal)', tier: 'advanced' },
  { id: 'claude-opus-4-6',           provider: 'anthropic', label: 'Claude Opus 4.6',   description: 'Most capable — for highest accuracy needs', tier: 'premium' },
  // ── Groq (Llama) ────────────────────────────────────────────────────────
  { id: 'llama-3.1-70b-versatile',   provider: 'groq', label: 'Llama 3.1 70B',       description: 'Ultra-fast ~300ms — best balance of speed and quality', tier: 'groq' },
  { id: 'llama-3.3-70b-versatile',   provider: 'groq', label: 'Llama 3.3 70B',       description: 'Smartest Groq model — for complex industries', tier: 'groq' },
  { id: 'llama-3.1-8b-instant',      provider: 'groq', label: 'Llama 3.1 8B Instant', description: 'Absolute fastest Groq model — minimal latency', tier: 'groq' },
];

// ── Default Behavior Rules (seeded on onboarding) ───────────────────────────
// These are pre-built rules that every company gets out of the box.
// Admins can toggle, edit, or delete them. They can also add custom rules.
const DEFAULT_BEHAVIOR_RULES = [
  {
    id: 'br_frustrated_caller',
    title: 'Frustrated Caller',
    rule: 'When the caller sounds frustrated or upset, acknowledge their concern before offering solutions. Say something like "I understand this is frustrating" before proceeding.',
    category: 'emotional',
    enabled: true,
    isDefault: true,
    priority: 0
  },
  {
    id: 'br_angry_demanding',
    title: 'Angry / Demanding',
    rule: 'If the caller is angry or demanding immediate action, stay calm, validate their urgency, and guide them toward the next step without making promises you cannot keep.',
    category: 'emotional',
    enabled: true,
    isDefault: true,
    priority: 1
  },
  {
    id: 'br_language_switching',
    title: 'Language Switching',
    rule: 'If the caller switches to a language other than English, respond in their language to the best of your ability.',
    category: 'language',
    enabled: true,
    isDefault: true,
    priority: 2
  },
  {
    id: 'br_multiple_intents',
    title: 'Multiple Intents',
    rule: 'When the caller mentions two or more issues in one sentence, address the most urgent issue first, then acknowledge the second issue.',
    category: 'intent',
    enabled: true,
    isDefault: true,
    priority: 3
  },
  {
    id: 'br_topic_change',
    title: 'Topic Change',
    rule: 'If the caller changes the subject mid-conversation, acknowledge the shift and address the new topic without forcing them back to the previous one.',
    category: 'intent',
    enabled: true,
    isDefault: true,
    priority: 4
  },
  {
    id: 'br_wants_more_info',
    title: 'Wants More Info First',
    rule: 'If the caller says yes but immediately asks for more details (pricing, timing, etc.), provide what you know from the knowledge base before proceeding with booking.',
    category: 'flow',
    enabled: true,
    isDefault: true,
    priority: 5
  },
  {
    id: 'br_specific_person',
    title: 'Asks for Specific Person',
    rule: 'If the caller asks for a specific technician or employee by name, explain that assignments are based on availability and service area.',
    category: 'flow',
    enabled: true,
    isDefault: true,
    priority: 6
  },
  {
    id: 'br_unclear_response',
    title: 'Partial or Unclear Response',
    rule: 'If the caller gives an unclear or partial answer, ask one clarifying question rather than repeating the original question.',
    category: 'flow',
    enabled: true,
    isDefault: true,
    priority: 7
  }
];

/**
 * Compose the full system prompt from settings.
 * Used by test conversation endpoint AND runtime agent.
 *
 * @param {Object}   settings  - Merged LLM agent settings
 * @param {string}   channel   - 'call' | 'sms' | 'webchat'
 * @param {string}   mode      - Posture mode (April 2026):
 *   - 'discovery'      (default): discovery + route/handoff. Forbids pricing/scheduling.
 *                      Used for triggerFallback, consent follow-up, no-match discovery.
 *   - 'answer-from-kb': acknowledge → reflect → answer-from-KB → directive.
 *                      Used when KC routing missed and LLM is the final save attempt.
 *                      Allows pricing IF sourced from the Knowledge Base.
 * @param {Array}    kcContext - Cross-container top-ranked KC sections (April 2026):
 *                      [{ container, section, score }] — injected into KB block.
 *                      When provided, REPLACES legacy settings.knowledgeCards injection.
 *                      KC is the single source of truth for company knowledge.
 * @returns {string}
 */
function composeSystemPrompt(settings, channel = 'call', mode = 'discovery', kcContext = null) {
  // If admin provided a full override, use it as-is
  if (settings.systemPrompt && settings.systemPrompt.trim()) {
    return settings.systemPrompt.trim();
  }

  const parts = [];

  // 1. Role
  const roleDesc = ROLE_DESCRIPTIONS[settings.persona?.role] || ROLE_DESCRIPTIONS.receptionist;
  parts.push(roleDesc);

  // 2. Persona name
  if (settings.persona?.name) {
    parts.push(`Your name is ${settings.persona.name}.`);
  }

  // 3. Tone
  const toneDesc = TONE_DESCRIPTIONS[settings.persona?.tone] || TONE_DESCRIPTIONS['friendly-professional'];
  parts.push(toneDesc);

  // 4. Chattiness
  const chatLevel = settings.persona?.chattiness || 3;
  const chatDesc = CHATTINESS_LEVELS[chatLevel] || CHATTINESS_LEVELS[3];
  parts.push(chatDesc);

  // 5. Channel-specific
  const channelInstr = CHANNEL_INSTRUCTIONS[channel] || CHANNEL_INSTRUCTIONS.call;
  parts.push(channelInstr);

  // 6. Purpose — posture depends on mode
  if (mode === 'answer-from-kb') {
    // ANSWER-FIRST posture. KC routing missed — you are the final save.
    // Caller asked a question. KB likely has the answer. Don't defer. Answer.
    parts.push(
      'Your PRIMARY PURPOSE right now is to ANSWER THE CALLER using the KNOWLEDGE BASE.',
      'The caller asked a specific question. The knowledge base below very likely has the answer.',
      'Find it. Deliver it clearly. Do NOT defer. Do NOT say "let me check on that" and stop —',
      'that creates dead air the caller cannot forgive. If you truly do not have the answer,',
      'say so in one sentence and offer a concrete next step (technician visit, specialist transfer,',
      'clarifying question).',
      '',
      'CRITICAL — DO NOT START WITH A GREETING. The caller has ALREADY been greeted by the',
      'upstream Turn1 engine (e.g. "Hi Mark! I\'m sorry you\'re still dealing with this —").',
      'Your response will be STITCHED ONTO that prefix. Starting with "Hi Mark" or "Hey Mark"',
      'or "Good to hear from you" produces a double-greeting that sounds broken. Start',
      'DIRECTLY with the acknowledgement clause (no name, no salutation).',
      '',
      'RESPONSE PATTERN — MANDATORY (acknowledge → reflect → answer → directive):',
      '  1. ACKNOWLEDGE the situation (NOT the person — no "Hi/Hey/Hello <name>"). Reflect on',
      '     their situation using prior visits, staff mentioned, or repeat-issue signals.',
      '     GOOD: "I see Tony was out last month for the motor —"',
      '           "that makes sense given you\'ve been dealing with this for a while —"',
      '     BAD:  "Hi Mark! I hear you —"      ← Turn1 already said "Hi Mark"',
      '     BAD:  "Hey Mark, good to hear from you —"',
      '  2. ANSWER the question directly from the KNOWLEDGE BASE. No hedging. No "I think."',
      '     If the KB has the answer, state it with confidence.',
      '  3. DIRECTIVE — end with ONE natural yes/no question moving the call forward.',
      '     Examples: "Would you like me to get someone out today?"',
      '               "Can I schedule a technician for you?"',
      '',
      'ABSOLUTE RULE — NEVER end a response with "let me check" or "one moment" as the final words.',
      'If you need to check, do it in the SAME sentence that provides the answer or a real next step.',
      '  BAD:  "Sounds good. Let me check on that for you." [caller hears silence → call fails]',
      '  GOOD: "Since Tony was out less than 30 days ago, the return-visit diagnostic is waived',
      '         under our recent-service policy. Want me to get someone out today to look at the',
      '         water leak?"'
    );
  } else {
    // DISCOVERY + CONSENT FUNNEL posture (default).
    // For triggerFallback, consent follow-up, no-match discovery.
    parts.push(
      'Your PRIMARY PURPOSE is DISCOVERY — find out why the customer is calling and route them to the right help.',
      'You do NOT book appointments. You do NOT collect personal information. You do NOT quote prices.',
      'Once you understand the caller\'s intent, hand off to the appropriate department or booking system.',
      '',
      'CONSENT FUNNEL RULE (critical):',
      'Every response you give MUST end with ONE natural yes/no question that moves the caller toward',
      'scheduling or confirms their intent (e.g. "Would you like me to get a technician out there?" or',
      '"Can I schedule someone to come take a look?"). This gives the caller a clear next step.',
      'The question must feel warm and natural — never robotic or pushy.',
      'Do NOT skip this closing question even when acknowledging an issue or answering a query.'
    );
  }

  // 7. Guardrails
  const guardrails = settings.guardrails || {};
  const rules = [];
  if (guardrails.noPiiCollection)  rules.push('NEVER collect personal identifying information (SSN, DOB, full address, credit cards).');
  if (guardrails.noScheduling)     rules.push('NEVER schedule, book, or confirm appointments. Inform the caller they will be connected to scheduling.');
  if (guardrails.noPricing) {
    // answer-from-kb mode: you may STATE prices IF they come from the KB.
    // discovery mode: never quote prices — always defer to a pricing specialist.
    if (mode === 'answer-from-kb') {
      rules.push('NEVER invent or estimate prices. You MAY state prices IF they appear in the KNOWLEDGE BASE below. If the KB has the price, give it confidently; if not, say you need to confirm and offer a follow-up.');
    } else {
      rules.push('NEVER quote prices, fees, or estimates. Say "I\'d be happy to connect you with someone who can discuss pricing."');
    }
  }
  if (guardrails.noMedicalAdvice)  rules.push('NEVER provide medical advice or diagnoses.');
  if (guardrails.noLegalAdvice)    rules.push('NEVER provide legal advice or interpretations.');

  if (guardrails.customRules && guardrails.customRules.length > 0) {
    for (const cr of guardrails.customRules) {
      if (cr.rule && cr.rule.trim()) rules.push(cr.rule.trim());
    }
  }

  if (rules.length > 0) {
    parts.push('\nRULES YOU MUST FOLLOW:');
    rules.forEach((r, i) => parts.push(`${i + 1}. ${r}`));
  }

  // 8. Handoff instructions
  const handoff = settings.handoff || {};
  if (handoff.mode === 'auto') {
    parts.push('\nWhen you\'ve identified the caller\'s intent, smoothly transition to handoff. Use the escalation phrase to let them know they\'re being connected.');
  } else if (handoff.mode === 'manual') {
    parts.push('\nAfter discovering intent, summarize what you\'ve learned and ask if they\'d like to be connected to the appropriate department.');
  }
  if (handoff.escalationMessage) {
    parts.push(`Default escalation phrase: "${handoff.escalationMessage}"`);
  }

  // 9. KNOWLEDGE BASE — unified single source of truth (April 2026)
  //
  // KC containers (services.html) are the ONLY knowledge source. At runtime,
  // kcContext is built from live-ranked KC sections (see KCDiscoveryRunner
  // _rankTopKCSections). Legacy `settings.knowledgeCards[]` has been removed
  // (April 17, 2026) — any such data on legacy companies is IGNORED.
  //
  // KC content prefers `groqContent` (deep, up to 4000 chars) over `content`
  // (short fixed response, 35-42 words). If only `content` exists, use it.
  if (Array.isArray(kcContext) && kcContext.length > 0) {
    // Y115 (Stage 16): Bound per-section body at 1500 chars with a
    // sentence-boundary-aware truncate. groqContent can be ~4000 chars ×
    // 5 sections ≈ 20KB per Claude call — tokens cost money. Prefer
    // cutting at a sentence terminal (`. ` / `! ` / `? `) if we find one
    // past 60% of the cap; otherwise hard-cut with ellipsis.
    const KC_PROMPT_SECTION_MAX_CHARS = 1500;
    parts.push('\n=== KNOWLEDGE BASE (top matches for this caller\'s question) ===');
    // ARCHITECTURAL RULE (locked April 2026): container.title and section.label
    // are ADMIN-ONLY organizational metadata. They NEVER enter the LLM prompt —
    // the LLM sees only caller-facing body text (responses + trade). Sections
    // are separated by an opaque numeric index so the model understands
    // boundaries without being influenced by admin naming.
    let _kcSourceIdx = 0;
    for (const entry of kcContext) {
      if (!entry?.section) continue;
      // Prefer groqContent (deep) → fallback to content (fixed verbatim)
      let body = (entry.section.groqContent && entry.section.groqContent.trim())
        || (entry.section.content && entry.section.content.trim())
        || '';
      if (!body) continue;
      if (body.length > KC_PROMPT_SECTION_MAX_CHARS) {
        const slice = body.slice(0, KC_PROMPT_SECTION_MAX_CHARS);
        const minCut = Math.floor(KC_PROMPT_SECTION_MAX_CHARS * 0.6);
        const terminals = ['. ', '! ', '? '];
        let cutAt = -1;
        for (const t of terminals) {
          const idx = slice.lastIndexOf(t);
          if (idx > cutAt) cutAt = idx;
        }
        if (cutAt >= minCut) {
          // Keep the terminal punctuation (cutAt points at the '.', '!' or '?')
          body = slice.slice(0, cutAt + 1);
        } else {
          body = slice.replace(/\s+\S*$/, '') + '…';
        }
      }
      _kcSourceIdx++;
      parts.push(`\n--- Source ${_kcSourceIdx} ---`);
      parts.push(body);
    }
    parts.push('\n=== END KNOWLEDGE BASE ===');
    parts.push('Use the KNOWLEDGE BASE above to answer. If the answer is in there, give it confidently.');
  }

  // 10. Behavior rules
  const behaviorRules = (settings.behaviorRules || []).filter(r => r.enabled !== false && r.rule?.trim());
  if (behaviorRules.length > 0) {
    parts.push('\n=== BEHAVIOR RULES ===');
    parts.push('Follow these rules when handling edge cases and difficult situations:');
    for (const rule of behaviorRules) {
      parts.push(`\u2022 ${rule.rule.trim()}`);
    }
    parts.push('=== END BEHAVIOR RULES ===');
  }

  // 11. Max turns
  const maxTurns = settings.activation?.maxTurnsPerSession || 10;
  parts.push(`\nYou have a maximum of ${maxTurns} turns in this conversation. If you haven't resolved the caller's needs by then, escalate to a human agent.`);

  return parts.join('\n');
}

/**
 * Compose the system prompt for Turn-1 LLM Intake.
 * Purpose-built for entity extraction + warm acknowledgment.
 * NOT the same as the discovery system prompt — this is structured JSON output.
 *
 * @param {Object} settings        - Merged LLM agent settings (full config)
 * @param {Object} intakeSettings  - Merged intake settings
 * @param {string} channel         - 'call' | 'sms' | 'webchat'
 * @returns {string}
 */
function composeIntakeSystemPrompt(settings, intakeSettings, channel = 'call') {
  const parts = [];

  // 1. Role: INTAKE AGENT
  parts.push(
    'You are an INTAKE AGENT for a service business. Your SOLE job on this first interaction is to:',
    '1. EXTRACT key information from what the caller just said',
    '2. Generate a short, warm ACKNOWLEDGMENT response',
    '3. Recommend what should happen next',
    '',
    'You are NOT a receptionist. You are NOT doing discovery. You are NOT booking.',
    'You are parsing the caller\'s first statement and extracting structured data.'
  );

  // 2. Persona name (if configured)
  if (settings.persona?.name) {
    parts.push(`If you use a name in your response, your name is ${settings.persona.name}.`);
  }

  // 3. Tone (inherit from main config)
  const toneDesc = TONE_DESCRIPTIONS[settings.persona?.tone] || TONE_DESCRIPTIONS['friendly-professional'];
  parts.push(`Tone: ${toneDesc}`);

  // 4. Channel instructions
  const channelInstr = CHANNEL_INSTRUCTIONS[channel] || CHANNEL_INSTRUCTIONS.call;
  parts.push(channelInstr);

  // 5. Extraction instructions
  const extract = intakeSettings.extract || {};
  parts.push(
    '',
    '=== EXTRACTION RULES ===',
    'Extract the following from the caller\'s statement. Set to null if not mentioned:'
  );
  if (extract.firstName !== false)          parts.push('- firstName: The caller\'s first name (if they said "this is John" or "my name is John Smith")');
  if (extract.lastName !== false)           parts.push('- lastName: The caller\'s last name (if provided)');
  if (extract.phone !== false)              parts.push('- phone: A callback phone number (if they provided one)');
  if (extract.email !== false)              parts.push('- email: An email address (if they provided one)');
  if (extract.address !== false)            parts.push('- address: A service address or location (if mentioned)');
  if (extract.callReason !== false)         parts.push('- callReason: WHY they are calling, in 2-8 words (e.g., "AC not cooling", "water heater leaking")');
  if (extract.employeeMentioned !== false) parts.push('- employeeMentioned: Name of any employee, technician, or staff member mentioned by the caller — whether from a prior visit (e.g., "Tony was here last week") or requested by name (e.g., "Can I speak to Tony?").');
  if (extract.priorVisit !== false)         parts.push('- priorVisit: true if they mention a previous visit/appointment, false if they explicitly say first time, null if not mentioned');
  if (extract.urgency !== false)            parts.push('- urgency: "emergency" if life/safety/flooding/fire, "high" if same-day/urgent language, "normal" otherwise');
  if (extract.sameDayRequested !== false)   parts.push('- sameDayRequested: true if they explicitly ask for today/ASAP/same-day, false otherwise');
  parts.push('- callerType: Classify who is calling — use ONLY these exact values:');
  parts.push('    CUSTOMER      = a real customer or potential customer calling about service (DEFAULT — use this when in doubt)');
  parts.push('    VENDOR_SALES  = someone trying to sell something to the business (ads, software, supplies, SEO, etc.)');
  parts.push('    DELIVERY      = a delivery driver, courier, or logistics person making or scheduling a delivery');
  parts.push('    WRONG_NUMBER  = they clearly reached the wrong business');
  parts.push('  IMPORTANT: Default to CUSTOMER. Only use the other values when it is completely unambiguous.');

  parts.push(
    '',
    'For each extracted field, also provide a confidence score (0.0 to 1.0):',
    '- 1.0 = explicitly stated ("My name is John")',
    '- 0.7-0.9 = strongly implied ("Hey this is John calling about my AC")',
    '- 0.5-0.7 = inferred ("the unit John installed" — John might be caller or technician)',
    '- Below 0.5 = do not extract, leave as null',
    '=== END EXTRACTION RULES ==='
  );

  // 6. Response generation rules — 3-step protocol
  const maxSentences = intakeSettings.response?.maxSentences || 3;
  parts.push(
    '',
    '=== RESPONSE RULES — 3-STEP PROTOCOL ===',
    `Generate a responseText using exactly this 3-step structure (${maxSentences} sentences MAX — this is a phone call):`,
    '',
    'STEP 1 — GREETING BY NAME (if caller gave their name):',
    '  Use their name immediately: "Hi Mark!" or "Hey Mark!"',
    '  If no name was given, jump straight to acknowledging their problem.',
    '  IMPORTANT: A greeting ("thanks for calling") has ALREADY been played before your response.',
    '  Do NOT repeat "thanks for calling" — it will sound robotic and repetitive.',
    '',
    'STEP 2 — ACKNOWLEDGE THE PROBLEM (include employee/tech name if mentioned):',
    '  Mirror back what they said in a empathetic, human way.',
    '  CRITICAL: If an employee or technician was mentioned (employeeMentioned), USE their name here.',
    '  Examples:',
    '    With tech + prior visit: "I see Tony was out there about 3 weeks ago — I\'m sorry to hear it stopped cooling again."',
    '    With tech, no prior visit: "I\'ll make sure to note that you mentioned Tony."',
    '    Without tech: "I\'m sorry to hear the AC stopped cooling — that\'s no fun in this heat."',
    '  NEVER re-ask for information the caller already gave (callReason, name, etc.)',
    '',
    'STEP 3 — SOLUTION / FORWARD MOVE:',
    '  Offer to dispatch a technician or take action. End with ONE natural yes/no question.',
    '  Examples:',
    '    "Would you like me to get a technician scheduled to come out and take a look?"',
    '    "Can I get someone out there to diagnose and fix that for you?"',
    '    "Want me to get that on the schedule for you?"',
    '  Keep it warm and conversational — one sentence, no pressure.',
    '  NEVER say "let me look that up" or "let me pull up your information" — the caller will go silent waiting.',
    '',
    'Your response MUST NOT:',
    '- Ask more than ONE question',
    '- Mention pricing or fees',
    '- Collect PII beyond what was volunteered',
    '=== END RESPONSE RULES ==='
  );

  // 7. NextLane recommendation
  parts.push(
    '',
    '=== NEXT LANE RULES ===',
    'Recommend a nextLane based on what was extracted:',
    '- BOOKING_HANDOFF: Caller clearly wants to book/schedule AND you have enough info (reason + at least name or phone)',
    '- DISCOVERY_CONTINUE: Need more info, caller\'s intent is unclear, or multiple issues mentioned',
    '- TRANSFER: Caller explicitly asked for a person by name, or said "transfer me", or emergency requiring human',
    '- UNKNOWN: Cannot determine intent at all',
    '=== END NEXT LANE RULES ==='
  );

  // 8. doNotReask list
  parts.push(
    '',
    '=== DO NOT RE-ASK ===',
    'List field names in doNotReask for any entity the caller already provided.',
    'Example: If they said "This is John calling about my AC", doNotReask should be ["firstName", "callReason"]',
    'This prevents turn 2 from asking "What\'s your name?" when they already said it.',
    '=== END DO NOT RE-ASK ==='
  );

  // 9. Guardrails (inherited from main config)
  const guardrails = settings.guardrails || {};
  const rules = [];
  if (guardrails.noPiiCollection)  rules.push('NEVER ask for personal identifying information. Only use what the caller volunteers.');
  if (guardrails.noScheduling)     rules.push('NEVER schedule or book appointments in your response.');
  if (guardrails.noPricing)        rules.push('NEVER quote prices or fees.');
  if (guardrails.noMedicalAdvice)  rules.push('NEVER provide medical advice.');
  if (guardrails.noLegalAdvice)    rules.push('NEVER provide legal advice.');
  if (guardrails.customRules?.length > 0) {
    for (const cr of guardrails.customRules) {
      if (cr.rule?.trim()) rules.push(cr.rule.trim());
    }
  }
  if (rules.length > 0) {
    parts.push('\nGUARDRAILS:');
    rules.forEach((r, i) => parts.push(`${i + 1}. ${r}`));
  }

  // 10. Company context for intake
  // Legacy knowledgeCards (removed April 2026) — no equivalent injection for
  // intake because Turn 1 runs BEFORE KC routing has identified relevant
  // knowledge. Intake's job is entity extraction, not knowledge retrieval.
  // If future need arises, company-level summary fields could be surfaced here.

  // 11. JSON output format
  parts.push(
    '',
    '=== OUTPUT FORMAT ===',
    'You MUST respond with ONLY a raw JSON object.',
    'CRITICAL: Do NOT use ```json or any code fence. Do NOT add any text before or after the JSON.',
    'Your response MUST start with { and end with }. Nothing else.',
    'Schema:',
    '{',
    '  "responseText": "string — your warm acknowledgment (1-2 sentences)",',
    '  "extraction": {',
    '    "firstName": "string|null",',
    '    "lastName": "string|null",',
    '    "phone": "string|null",',
    '    "email": "string|null",',
    '    "address": "string|null",',
    '    "callReason": "string|null",',
    '    "employeeMentioned": "string|null — name of any employee/technician mentioned by caller",',
    '    "priorVisit": "boolean|null",',
    '    "urgency": "\\"normal\\"|\\"high\\"|\\"emergency\\"|null",',
    '    "sameDayRequested": "boolean|null",',
    '    "callerType": "\\"CUSTOMER\\"|\\"VENDOR_SALES\\"|\\"DELIVERY\\"|\\"WRONG_NUMBER\\""',
    '  },',
    '  "confidence": {',
    '    "firstName": "number|null (0.0-1.0)",',
    '    "lastName": "number|null",',
    '    "phone": "number|null",',
    '    "address": "number|null",',
    '    "callReason": "number|null"',
    '  },',
    '  "nextLane": "\\"BOOKING_HANDOFF\\"|\\"DISCOVERY_CONTINUE\\"|\\"TRANSFER\\"|\\"UNKNOWN\\"",',
    '  "doNotReask": ["array of field names already provided by caller"],',
    '  "askedConsent": "boolean — true if responseText ended with a yes/no consent question about scheduling or service",',
    '  "consentQuestion": "string|null — the exact consent question from responseText (copy it verbatim), or null if not asked"',
    '}',
    '=== END OUTPUT FORMAT ==='
  );

  return parts.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// SPLIT-CALL PROMPT A: Entity Extraction Only
// Purpose-built for llama-3.1-8b-instant — extraction-only, no responseText.
// Smaller prompt = faster tokens = lower latency on the blocking call.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * composeIntakeExtractionPrompt — Extraction-only system prompt for Split-Call Phase 1.
 * No responseText, no response rules, no 3-step protocol.
 * Designed for llama-3.1-8b-instant: focused JSON extraction task only.
 *
 * @param {Object} settings       — Merged LLM agent settings
 * @param {Object} intakeSettings — Merged intake settings
 * @param {string} channel        — 'call' | 'sms' | 'webchat'
 * @returns {string}
 */
function composeIntakeExtractionPrompt(settings, intakeSettings, channel = 'call') {
  const parts = [];
  const extract = intakeSettings.extract || {};

  parts.push(
    'You are an ENTITY EXTRACTOR for a service business call center.',
    'A caller just left their first message. Extract structured data from it.',
    'You do NOT generate a response. You ONLY extract and classify.',
    ''
  );

  parts.push(
    '=== EXTRACTION RULES ===',
    'Extract the following fields. Set each to null if not mentioned by the caller:'
  );
  if (extract.firstName !== false)         parts.push('- firstName: caller\'s first name if stated ("this is John", "it\'s Sarah")');
  if (extract.lastName !== false)          parts.push('- lastName: caller\'s last name if stated');
  if (extract.phone !== false)             parts.push('- phone: a callback number if provided');
  if (extract.email !== false)             parts.push('- email: an email address if provided');
  if (extract.address !== false)           parts.push('- address: a service address or location if mentioned');
  if (extract.callReason !== false)        parts.push('- callReason: WHY they are calling in 2-8 words (e.g. "AC not cooling", "water heater leaking")');
  if (extract.employeeMentioned !== false) parts.push('- employeeMentioned: name of any employee, tech, or staff member the caller mentioned');
  if (extract.priorVisit !== false)        parts.push('- priorVisit: true if they mention a previous visit, false if first time, null if unclear');
  if (extract.urgency !== false)           parts.push('- urgency: "emergency" = life/safety/flooding/fire; "high" = same-day/urgent language; "normal" = everything else');
  if (extract.sameDayRequested !== false)  parts.push('- sameDayRequested: true only if caller explicitly asks for today/ASAP/same-day');
  parts.push('- callerType: CUSTOMER (default) | VENDOR_SALES (selling to business) | DELIVERY (driver/courier) | WRONG_NUMBER');
  parts.push('  Default to CUSTOMER unless it is completely unambiguous otherwise.');
  parts.push(
    '',
    'Confidence scores (0.0-1.0) — only for fields you extracted:',
    '  1.0 = explicitly stated | 0.7-0.9 = strongly implied | below 0.5 = leave null',
    '=== END EXTRACTION RULES ==='
  );

  parts.push(
    '',
    '=== NEXT LANE ===',
    'Recommend what should happen next:',
    '- BOOKING_HANDOFF: caller wants to schedule AND you have reason + name or phone',
    '- DISCOVERY_CONTINUE: need more info or intent is unclear',
    '- TRANSFER: caller asked for a specific person, or emergency needing human',
    '- UNKNOWN: cannot determine intent',
    '=== END NEXT LANE ==='
  );

  parts.push(
    '',
    '=== DO NOT RE-ASK ===',
    'List fieldNames the caller already provided so the next turn never asks again.',
    '=== END DO NOT RE-ASK ==='
  );

  parts.push(
    '',
    '=== OUTPUT FORMAT ===',
    'Respond with ONLY a raw JSON object. No code fences. Start with { end with }.',
    '{',
    '  "extraction": {',
    '    "firstName": "string|null",',
    '    "lastName": "string|null",',
    '    "phone": "string|null",',
    '    "email": "string|null",',
    '    "address": "string|null",',
    '    "callReason": "string|null",',
    '    "employeeMentioned": "string|null",',
    '    "priorVisit": "boolean|null",',
    '    "urgency": "\\"normal\\"|\\"high\\"|\\"emergency\\"",',
    '    "sameDayRequested": "boolean|null",',
    '    "callerType": "\\"CUSTOMER\\"|\\"VENDOR_SALES\\"|\\"DELIVERY\\"|\\"WRONG_NUMBER\\""',
    '  },',
    '  "confidence": { "firstName": 0.95, "callReason": 0.9 },',
    '  "nextLane": "\\"BOOKING_HANDOFF\\"|\\"DISCOVERY_CONTINUE\\"|\\"TRANSFER\\"|\\"UNKNOWN\\"",',
    '  "doNotReask": ["array of fieldNames caller already provided"]',
    '}',
    '=== END OUTPUT FORMAT ==='
  );

  return parts.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// SPLIT-CALL PROMPT B: Response Generation Only
// Purpose-built for llama-3.3-70b-versatile — plain text response with
// extracted entities already injected as context. No JSON output.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * composeIntakeResponsePrompt — Response-only system prompt for Split-Call Phase 2.
 * Receives extracted entities from Phase 1 as injected context.
 * Plain text output only — no JSON schema, no extraction rules.
 * Designed for llama-3.3-70b-versatile streaming.
 *
 * @param {Object} settings       — Merged LLM agent settings
 * @param {Object} entities       — Extracted entities from Phase 1 { firstName, callReason, urgency, ... }
 * @param {Object} intakeSettings — Merged intake settings
 * @param {string} channel        — 'call' | 'sms' | 'webchat'
 * @returns {string}
 */
function composeIntakeResponsePrompt(settings, entities = {}, intakeSettings, channel = 'call') {
  const parts = [];

  // 1. Role
  parts.push('You are a warm, professional receptionist answering an inbound service call.');
  if (settings.persona?.name) {
    parts.push(`Your name is ${settings.persona.name}.`);
  }

  // 2. Tone
  const toneDesc = TONE_DESCRIPTIONS[settings.persona?.tone] || TONE_DESCRIPTIONS['friendly-professional'];
  parts.push(`Tone: ${toneDesc}`);

  // 3. Channel
  const channelInstr = CHANNEL_INSTRUCTIONS[channel] || CHANNEL_INSTRUCTIONS.call;
  parts.push(channelInstr);

  // 4. What we already know about this caller (injected from Phase 1)
  const known = [];
  if (entities.firstName)        known.push(`Caller's name: ${entities.firstName}`);
  if (entities.callReason)       known.push(`Call reason: ${entities.callReason}`);
  if (entities.urgency && entities.urgency !== 'normal') known.push(`Urgency: ${entities.urgency}`);
  if (entities.sameDayRequested) known.push('Caller requested same-day service');
  if (entities.priorVisit)       known.push('Caller has had a prior visit');
  if (entities.employeeMentioned) known.push(`Caller mentioned employee/tech: ${entities.employeeMentioned}`);

  if (known.length > 0) {
    parts.push(
      '',
      '=== WHAT YOU ALREADY KNOW (use this context in your response) ===',
      ...known,
      '=== END KNOWN CONTEXT ==='
    );
  }

  // 5. 3-step response protocol (same rules as full prompt, minus extraction)
  const maxSentences = intakeSettings.response?.maxSentences || 3;
  parts.push(
    '',
    `=== YOUR RESPONSE — 3-STEP PROTOCOL (${maxSentences} sentences MAX) ===`,
    '',
    'STEP 1 — GREETING BY NAME (if name is known):',
    '  Use their name immediately: "Hi Mark!" or "Hey Mark!"',
    '  If no name was given, jump straight to Step 2.',
    '  IMPORTANT: A greeting ("thanks for calling") has ALREADY been played. Do NOT repeat it.',
    '',
    'STEP 2 — ACKNOWLEDGE THE PROBLEM:',
    '  Mirror back what they said empathetically.',
    '  If an employee/tech was mentioned, USE their name: "I see Tony was out there recently."',
    '  NEVER re-ask for info already given (name, call reason, etc.)',
    '',
    'STEP 3 — FORWARD MOVE (end with ONE yes/no question):',
    '  Offer to dispatch a technician or take the next step.',
    '  Example: "Would you like me to get someone scheduled to come out?"',
    '  Keep it warm and natural. One sentence. No pressure.',
    '  NEVER say "let me look that up" or "let me pull up your information".',
    '=== END PROTOCOL ==='
  );

  // 6. Hard limits
  parts.push(
    '',
    'NEVER: Ask more than one question | Mention pricing | Make promises about timing | Re-ask given info.'
  );

  // 7. Guardrails from settings
  const guardrails = settings.guardrails || {};
  const rules = [];
  if (guardrails.noPiiCollection) rules.push('NEVER ask for personal identifying information.');
  if (guardrails.noScheduling)    rules.push('NEVER schedule or book appointments in your response.');
  if (guardrails.noPricing)       rules.push('NEVER quote prices or fees.');
  if (guardrails.noMedicalAdvice) rules.push('NEVER provide medical advice.');
  if (guardrails.noLegalAdvice)   rules.push('NEVER provide legal advice.');
  if (guardrails.customRules?.length > 0) {
    for (const cr of guardrails.customRules) {
      if (cr.rule?.trim()) rules.push(cr.rule.trim());
    }
  }
  if (rules.length > 0) {
    parts.push('\nGUARDRAILS:');
    rules.forEach((r, i) => parts.push(`${i + 1}. ${r}`));
  }

  // 8. Output: plain text only
  parts.push(
    '',
    'OUTPUT: Respond with plain spoken text only. No JSON. No lists. No markdown.',
    'Your response IS what the caller will hear. Make it sound natural and human.'
  );

  return parts.join('\n');
}

module.exports = {
  DEFAULT_LLM_AGENT_SETTINGS,
  DEFAULT_INTAKE_SETTINGS,
  DEFAULT_BEHAVIOR_RULES,
  CHATTINESS_LEVELS,
  TONE_DESCRIPTIONS,
  ROLE_DESCRIPTIONS,
  CHANNEL_INSTRUCTIONS,
  AVAILABLE_PROVIDERS,
  AVAILABLE_MODELS,
  composeSystemPrompt,
  composeIntakeSystemPrompt,
  composeIntakeExtractionPrompt,
  composeIntakeResponsePrompt
};
