// config/llmAgentDefaults.js
//
// LLM Agent — Discovery Configuration Defaults
// ==============================================
// Every field is UI-configurable via llmagent.html.
// Code reads these as fallbacks when company has no saved config.
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

  // ── Knowledge Cards ──────────────────────────────────────────────────────
  // Each card: { id, type, title, content, enabled, priority, createdAt, updatedAt }
  //   type: 'trigger' — auto-synced from trigger cards
  //         'company' — manual company info (hours, services, policies)
  //         'website' — scraped from URL
  //         'custom'  — free-form knowledge
  //
  // Trigger cards additionally have: { triggerId, triggerName, autoSynced: true }
  // Website cards additionally have: { sourceUrl, scrapedAt }
  knowledgeCards: [],

  // ── System Prompt Override ───────────────────────────────────────────────
  // Empty = use built-in default template (composed from persona + guardrails + cards)
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
    technicianMentioned: true,
    priorVisit: true,
    urgency: true,
    sameDayRequested: true
  },

  // Response behavior
  response: {
    maxSentences: 2,
    includeConfirmation: true,
    includeForwardMove: true
  },

  // Confidence thresholds for accepting extracted values
  confidence: {
    nameThreshold: 0.70,
    phoneThreshold: 0.80,
    addressThreshold: 0.60,
    reasonThreshold: 0.50
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

// ── Available Models ──────────────────────────────────────────────────────
const AVAILABLE_MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5',  description: 'Fast & affordable — ideal for receptionist work', tier: 'default' },
  { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6', description: 'Smarter — for complex industries (dental, legal)', tier: 'advanced' },
  { id: 'claude-opus-4-6',           label: 'Claude Opus 4.6',   description: 'Most capable — for highest accuracy needs', tier: 'premium' }
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
 * @param {Object} settings - Merged LLM agent settings
 * @param {string} channel  - 'call' | 'sms' | 'webchat'
 * @returns {string}
 */
function composeSystemPrompt(settings, channel = 'call') {
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

  // 6. Purpose — discovery only
  parts.push(
    'Your PRIMARY PURPOSE is DISCOVERY — find out why the customer is calling and route them to the right help.',
    'You do NOT book appointments. You do NOT collect personal information. You do NOT quote prices.',
    'Once you understand the caller\'s intent, hand off to the appropriate department or booking system.'
  );

  // 7. Guardrails
  const guardrails = settings.guardrails || {};
  const rules = [];
  if (guardrails.noPiiCollection)  rules.push('NEVER collect personal identifying information (SSN, DOB, full address, credit cards).');
  if (guardrails.noScheduling)     rules.push('NEVER schedule, book, or confirm appointments. Inform the caller they will be connected to scheduling.');
  if (guardrails.noPricing)        rules.push('NEVER quote prices, fees, or estimates. Say "I\'d be happy to connect you with someone who can discuss pricing."');
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

  // 9. Knowledge cards
  const cards = (settings.knowledgeCards || []).filter(c => c.enabled !== false);
  if (cards.length > 0) {
    parts.push('\n=== KNOWLEDGE BASE ===');
    for (const card of cards) {
      parts.push(`\n--- ${card.title || 'Untitled'} ---`);
      parts.push(card.content || '');
    }
    parts.push('\n=== END KNOWLEDGE BASE ===');
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
  if (extract.technicianMentioned !== false) parts.push('- technicianMentioned: Name of a specific technician if they asked for one by name');
  if (extract.priorVisit !== false)         parts.push('- priorVisit: true if they mention a previous visit/appointment, false if they explicitly say first time, null if not mentioned');
  if (extract.urgency !== false)            parts.push('- urgency: "emergency" if life/safety/flooding/fire, "high" if same-day/urgent language, "normal" otherwise');
  if (extract.sameDayRequested !== false)   parts.push('- sameDayRequested: true if they explicitly ask for today/ASAP/same-day, false otherwise');

  parts.push(
    '',
    'For each extracted field, also provide a confidence score (0.0 to 1.0):',
    '- 1.0 = explicitly stated ("My name is John")',
    '- 0.7-0.9 = strongly implied ("Hey this is John calling about my AC")',
    '- 0.5-0.7 = inferred ("the unit John installed" — John might be caller or technician)',
    '- Below 0.5 = do not extract, leave as null',
    '=== END EXTRACTION RULES ==='
  );

  // 6. Response generation rules
  const maxSentences = intakeSettings.response?.maxSentences || 2;
  parts.push(
    '',
    '=== RESPONSE RULES ===',
    `Generate a responseText that is ${maxSentences} sentence(s) MAX (this is a phone call).`,
    'Your response MUST:',
    '- Warmly acknowledge what the caller said',
    '- Confirm the MOST IMPORTANT extracted detail (usually callReason or name)',
    '- End with a forward-moving statement ("Let me pull up your information" or "I can help with that")',
    'Your response MUST NOT:',
    '- Ask more than ONE question',
    '- Mention booking, scheduling, or pricing',
    '- Collect PII beyond what was volunteered',
    '- Be longer than 2 sentences',
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

  // 10. Knowledge cards (brief context — limit to 5 for intake)
  const cards = (settings.knowledgeCards || []).filter(c => c.enabled !== false);
  if (cards.length > 0) {
    parts.push('\n=== COMPANY CONTEXT (for understanding caller references) ===');
    for (const card of cards.slice(0, 5)) {
      parts.push(`- ${card.title}: ${(card.content || '').substring(0, 200)}`);
    }
    parts.push('=== END COMPANY CONTEXT ===');
  }

  // 11. JSON output format
  parts.push(
    '',
    '=== OUTPUT FORMAT ===',
    'You MUST respond with ONLY a JSON object. No markdown, no backticks, no explanation.',
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
    '    "technicianMentioned": "string|null",',
    '    "priorVisit": "boolean|null",',
    '    "urgency": "\\"normal\\"|\\"high\\"|\\"emergency\\"|null",',
    '    "sameDayRequested": "boolean|null"',
    '  },',
    '  "confidence": {',
    '    "firstName": "number|null (0.0-1.0)",',
    '    "lastName": "number|null",',
    '    "phone": "number|null",',
    '    "address": "number|null",',
    '    "callReason": "number|null"',
    '  },',
    '  "nextLane": "\\"BOOKING_HANDOFF\\"|\\"DISCOVERY_CONTINUE\\"|\\"TRANSFER\\"|\\"UNKNOWN\\"",',
    '  "doNotReask": ["array of field names already provided by caller"]',
    '}',
    '=== END OUTPUT FORMAT ==='
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
  AVAILABLE_MODELS,
  composeSystemPrompt,
  composeIntakeSystemPrompt
};
