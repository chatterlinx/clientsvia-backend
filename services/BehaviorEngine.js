// services/BehaviorEngine.js
// V23 HYBRID Behavior Engine - Trade-Agnostic Personality System
//
// PURPOSE: Decide HOW the agent talks, not WHAT it says
// FLOW: 3-Tier decides content → BehaviorEngine decides tone → LLM-C rewrites
//
// CRITICAL: This engine is TRADE-AGNOSTIC. All trade-specific keywords
// come from company config, not hardcoded here.
//
// ═══════════════════════════════════════════════════════════════════════════

const logger = require('../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════
// STANDARD INTENT VOCABULARY (Platform-Wide)
// ═══════════════════════════════════════════════════════════════════════════
// 
// These intents are TRADE-AGNOSTIC. Triage cards and 3-Tier scenarios
// should use these standard intents, regardless of trade.
//
const STANDARD_INTENTS = {
  // Service lanes
  SERVICE_REPAIR: 'Something is broken/not working, needs fixing',
  MAINTENANCE: 'Routine preventive service, tune-up, cleaning',
  NEW_SALES_ESTIMATE: 'Quote for new equipment/service, replacement, upgrade',
  INSTALLATION: 'Install new equipment (already decided to buy)',
  
  // Administrative
  BILLING_ISSUE: 'Invoice question, payment dispute, refund request',
  SCHEDULING: 'Reschedule, cancel, confirm existing appointment',
  GENERAL_QUESTION: 'Info request that doesn\'t fit other categories',
  
  // Urgency
  EMERGENCY: 'Safety concern, needs immediate attention',
  FOLLOWUP: 'Callback about previous service or quote',
  
  // Edge cases
  WRONG_NUMBER: 'Caller reached wrong business',
  SOLICITATION: 'Sales call, spam, not a customer',
  MESSAGE_ONLY: 'Just wants to leave a message',
  UNKNOWN: 'Can\'t determine intent, needs clarification'
};

// ═══════════════════════════════════════════════════════════════════════════
// TONE DEFINITIONS (What Each Tone Means for LLM-C)
// ═══════════════════════════════════════════════════════════════════════════

const TONE_DEFINITIONS = {
  EMERGENCY_SERIOUS: {
    description: 'Calm, authoritative, safety-first',
    humorAllowed: false,
    directness: 1.0,
    empathy: 0.7,
    rules: [
      'No humor of any kind.',
      'Be concise, calm, and authoritative.',
      'Give clear safety instructions if needed.',
      'Keep sentences short and focused.',
      'Confirm understanding after important info.',
      'Escalate to human if any doubt about safety.'
    ]
  },
  
  CONFLICT_SERIOUS: {
    description: 'Professional, empathetic, solution-focused',
    humorAllowed: false,
    directness: 0.8,
    empathy: 0.9,
    rules: [
      'No humor.',
      'Acknowledge the concern briefly and sincerely.',
      'Stay calm, professional, and solution-focused.',
      'Avoid defensive language.',
      'Offer next steps or escalation path.',
      'Never argue or dismiss the concern.'
    ]
  },
  
  LIGHT_PLAYFUL: {
    description: 'Friendly with one small playful line',
    humorAllowed: true,
    directness: 0.6,
    empathy: 0.7,
    rules: [
      'You may use ONE short playful line at the beginning.',
      'Then immediately get to the point.',
      'Do not use sarcasm or dark humor.',
      'Never joke about safety, money, health, or emergencies.',
      'Keep the playfulness brief - max one sentence.'
    ]
  },
  
  FRIENDLY_CASUAL: {
    description: 'Warm, relaxed, like a helpful friend',
    humorAllowed: true,
    directness: 0.6,
    empathy: 0.8,
    rules: [
      'Sound like a friendly front-desk person.',
      'Use simple, everyday language.',
      'A tiny bit of warmth is good, but stay professional.',
      'Humor is allowed but not required.',
      'Focus on being helpful and approachable.'
    ]
  },
  
  FRIENDLY_DIRECT: {
    description: 'Friendly but efficient, focused on the task',
    humorAllowed: false,
    directness: 0.8,
    empathy: 0.6,
    rules: [
      'Be friendly but efficient.',
      'Focus on asking the next needed question.',
      'Avoid long explanations unless asked.',
      'Keep replies short and actionable.',
      'Acknowledge what they said, then move forward.'
    ]
  },
  
  CONSULTATIVE: {
    description: 'Helpful advisor, knowledgeable but not pushy',
    humorAllowed: false,
    directness: 0.5,
    empathy: 0.7,
    rules: [
      'Position yourself as a helpful advisor.',
      'Ask questions to understand their needs.',
      'Provide information without being pushy.',
      'Offer options rather than telling them what to do.',
      'Be patient with questions and concerns.'
    ]
  },
  
  NEUTRAL: {
    description: 'Clear, professional, no personality bias',
    humorAllowed: false,
    directness: 0.7,
    empathy: 0.6,
    rules: [
      'Be clear, neutral, and professional.',
      'No humor unless the user is clearly joking and situation is safe.',
      'Focus on getting the information needed.',
      'Keep responses concise and helpful.'
    ]
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT BEHAVIOR PROFILE (Used if company has none configured)
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_BEHAVIOR_PROFILE = {
  mode: 'HYBRID',
  humorLevel: 0.5,
  empathyLevel: 0.7,
  directnessLevel: 0.7,
  maxHumorPerReply: 1,
  allowSmallTalkSeconds: 15,
  safetyStrictness: 1.0,
  
  globalEmergencyKeywords: [
    'burning smell', 'smoke', 'sparks', 'fire', 'on fire',
    'leaking into ceiling', 'water pouring', 'flooding', 'flooded',
    'gas smell', 'smell gas', 'gas leak',
    'bleeding', 'blood', 'chest pain', 'unconscious', 'not breathing',
    'help me', 'emergency', 'urgent', 'right now', 'immediately'
  ],
  
  globalBillingConflictKeywords: [
    'you charged', 'my bill', 'refund', 'dispute', 'overcharged',
    'chargeback', 'invoice wrong', 'billing error', 'double charged',
    'unauthorized charge', 'fraud', 'scam', 'rip off', 'ripoff'
  ],
  
  globalJokePatterns: [
    'lol', 'lmao', 'haha', 'hehe', 'rofl',
    'this thing is dead', 'im dying here', 'this is killing me',
    'lord help me', 'pray for me', 'send help'
  ],
  
  tradeOverrides: {}
};

// ═══════════════════════════════════════════════════════════════════════════
// CORE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get merged behavior config for a company/trade
 */
function getBehaviorConfig(context) {
  const profile = context.company?.aiAgentSettings?.behaviorProfile || {};
  const base = { ...DEFAULT_BEHAVIOR_PROFILE, ...profile };
  
  // Get trade key from context
  const tradeKey = context.tradeKey 
    || context.company?.trade 
    || context.triageDecision?.tradeKey 
    || null;
  
  // Merge trade-specific overrides if present
  const tradeOverride = tradeKey && base.tradeOverrides?.[tradeKey]
    ? base.tradeOverrides[tradeKey]
    : {};
  
  return { base, tradeOverride, tradeKey };
}

/**
 * Detect signals from user input that affect tone
 * @returns {Object} signals including hasEmergency, hasBillingConflict, userIsJoking
 */
function detectSignals(latestUserText, behaviorConfig) {
  if (!latestUserText) {
    return {
      hasEmergency: false,
      hasBillingConflict: false,
      userIsJoking: false,
      sentiment: 'NEUTRAL',
      urgency: 'NORMAL'
    };
  }
  
  const text = latestUserText.toLowerCase();
  
  // Merge global + trade-specific keywords
  const emergencyKeywords = [
    ...(behaviorConfig.base.globalEmergencyKeywords || []),
    ...(behaviorConfig.tradeOverride.emergencyKeywords || [])
  ];
  
  const billingKeywords = [
    ...(behaviorConfig.base.globalBillingConflictKeywords || []),
    ...(behaviorConfig.tradeOverride.billingConflictKeywords || [])
  ];
  
  const jokePatterns = [
    ...(behaviorConfig.base.globalJokePatterns || []),
    ...(behaviorConfig.tradeOverride.jokePatterns || [])
  ];
  
  // Detect signals
  const hasEmergency = emergencyKeywords.some(k => 
    text.includes(k.toLowerCase())
  );
  
  const hasBillingConflict = billingKeywords.some(k => 
    text.includes(k.toLowerCase())
  );
  
  const userIsJoking = jokePatterns.some(k => 
    text.includes(k.toLowerCase())
  );
  
  // Future: plug in sentiment classifier here
  const sentiment = 'NEUTRAL';
  const urgency = hasEmergency ? 'HIGH' : 'NORMAL';
  
  return {
    hasEmergency,
    hasBillingConflict,
    userIsJoking,
    sentiment,
    urgency
  };
}

/**
 * Decide which tone to use based on context and signals
 * @returns {string} tone key from TONE_DEFINITIONS
 */
function decideTone(context, signals, behaviorConfig) {
  // Hard overrides - safety/conflict always win
  if (signals.hasEmergency) {
    logger.info('[BEHAVIOR] Emergency detected → EMERGENCY_SERIOUS');
    return 'EMERGENCY_SERIOUS';
  }
  
  if (signals.hasBillingConflict) {
    logger.info('[BEHAVIOR] Billing conflict detected → CONFLICT_SERIOUS');
    return 'CONFLICT_SERIOUS';
  }
  
  // User is joking and humor is enabled
  const humorLevel = behaviorConfig.base.humorLevel || 0;
  if (signals.userIsJoking && humorLevel > 0.3) {
    logger.info('[BEHAVIOR] User joking + humor enabled → LIGHT_PLAYFUL');
    return 'LIGHT_PLAYFUL';
  }
  
  // Intent-based tone selection (trade-agnostic)
  const intent = context.triageDecision?.intent || 'UNKNOWN';
  
  switch (intent) {
    case 'SERVICE_REPAIR':
      return 'FRIENDLY_DIRECT';
    
    case 'MAINTENANCE':
      return 'FRIENDLY_CASUAL';
    
    case 'NEW_SALES_ESTIMATE':
    case 'INSTALLATION':
      return 'CONSULTATIVE';
    
    case 'EMERGENCY':
      return 'EMERGENCY_SERIOUS';
    
    case 'BILLING_ISSUE':
      return 'CONFLICT_SERIOUS';
    
    case 'SCHEDULING':
    case 'FOLLOWUP':
      return 'FRIENDLY_DIRECT';
    
    case 'GENERAL_QUESTION':
      return 'FRIENDLY_CASUAL';
    
    default:
      return 'NEUTRAL';
  }
}

/**
 * Build style instructions for LLM-C based on tone
 * @returns {Object} styleInstructions for LLM-C prompt
 */
function buildStyleInstructions(tone, behaviorConfig) {
  const toneConfig = TONE_DEFINITIONS[tone] || TONE_DEFINITIONS.NEUTRAL;
  const base = behaviorConfig.base;
  
  return {
    mode: base.mode || 'HYBRID',
    tone,
    description: toneConfig.description,
    
    // Numeric settings (can be used by LLM-C)
    humorLevel: toneConfig.humorAllowed ? (base.humorLevel || 0) : 0,
    empathyLevel: toneConfig.empathy || base.empathyLevel || 0.7,
    directnessLevel: toneConfig.directness || base.directnessLevel || 0.7,
    maxHumorPerReply: toneConfig.humorAllowed ? (base.maxHumorPerReply || 1) : 0,
    safetyStrictness: base.safetyStrictness || 1.0,
    
    // Rules for LLM-C to follow
    rules: toneConfig.rules,
    
    // Hard constraints
    constraints: [
      'Do not invent policies, prices, or offers.',
      'Do not diagnose technical problems.',
      'Do not make promises you cannot keep.',
      'If unsure, say "let me connect you with someone who can help."'
    ]
  };
}

/**
 * Main function: Apply HYBRID behavior styling to a response
 * 
 * @param {Object} context - Execution context with company, triageDecision, etc.
 * @param {string} responseTemplate - The content from 3-Tier scenario
 * @returns {Object} { responseTemplate, styleInstructions, tone, signals }
 */
function applyHybridStyle(context, responseTemplate) {
  const behaviorConfig = getBehaviorConfig(context);
  
  // Check if HYBRID mode is enabled
  const mode = behaviorConfig.base.mode;
  if (mode !== 'HYBRID') {
    logger.debug('[BEHAVIOR] Mode is not HYBRID, skipping styling', { mode });
    return { 
      responseTemplate, 
      styleInstructions: null, 
      tone: 'NEUTRAL',
      signals: null 
    };
  }
  
  // Get latest user message
  const latestUserText = context.latestUserMessage 
    || context.callState?.lastInput 
    || context.userInput 
    || '';
  
  // Detect signals from user input
  const signals = detectSignals(latestUserText, behaviorConfig);
  
  // Decide appropriate tone
  const tone = decideTone(context, signals, behaviorConfig);
  
  // Build style instructions for LLM-C
  const styleInstructions = buildStyleInstructions(tone, behaviorConfig);
  
  logger.info('[BEHAVIOR] Style applied', {
    companyId: context.companyID || context.companyId,
    trade: behaviorConfig.tradeKey,
    tone,
    signals: {
      hasEmergency: signals.hasEmergency,
      hasBillingConflict: signals.hasBillingConflict,
      userIsJoking: signals.userIsJoking
    }
  });
  
  return {
    responseTemplate,
    styleInstructions,
    tone,
    signals
  };
}

/**
 * Format style instructions for LLM-C system prompt
 */
function formatStyleForLLMC(styleInstructions, companyName) {
  if (!styleInstructions) return '';
  
  return `
## Behavior Mode: ${styleInstructions.mode}
## Current Tone: ${styleInstructions.tone} - ${styleInstructions.description}

### Style Settings:
- Humor Level: ${styleInstructions.humorLevel} (${styleInstructions.humorLevel > 0 ? 'allowed' : 'NOT allowed'})
- Empathy Level: ${styleInstructions.empathyLevel}
- Directness Level: ${styleInstructions.directnessLevel}
- Max humor per reply: ${styleInstructions.maxHumorPerReply}

### Rules for this response:
${styleInstructions.rules.map(r => `- ${r}`).join('\n')}

### Hard Constraints (NEVER break):
${styleInstructions.constraints.map(c => `- ${c}`).join('\n')}

You are the AI receptionist for ${companyName}.
Rewrite the response content in natural spoken language that follows these style settings.
Do not add new facts. Do not change meaning. Just adjust the tone and phrasing.
`.trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  // Main function
  applyHybridStyle,
  
  // Helper functions (for testing/debugging)
  getBehaviorConfig,
  detectSignals,
  decideTone,
  buildStyleInstructions,
  formatStyleForLLMC,
  
  // Reference data
  STANDARD_INTENTS,
  TONE_DEFINITIONS,
  DEFAULT_BEHAVIOR_PROFILE
};

