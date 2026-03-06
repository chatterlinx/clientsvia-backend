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

  // 10. Max turns
  const maxTurns = settings.activation?.maxTurnsPerSession || 10;
  parts.push(`\nYou have a maximum of ${maxTurns} turns in this conversation. If you haven't resolved the caller's needs by then, escalate to a human agent.`);

  return parts.join('\n');
}

module.exports = {
  DEFAULT_LLM_AGENT_SETTINGS,
  CHATTINESS_LEVELS,
  TONE_DESCRIPTIONS,
  ROLE_DESCRIPTIONS,
  CHANNEL_INSTRUCTIONS,
  AVAILABLE_MODELS,
  composeSystemPrompt
};
