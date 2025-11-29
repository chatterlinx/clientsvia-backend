/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BEHAVIOR PROFILE TEMPLATES - V23 Trade-Agnostic Personality System
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE: Canonical templates for company behavior profiles
 * USAGE: Copy into company.aiAgentSettings.behaviorProfile
 * 
 * These templates define HOW the AI agent talks, not WHAT it says.
 * The BehaviorEngine uses these to decide tone based on caller signals.
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════
// MASTER TEMPLATE - Full structure with all fields
// ═══════════════════════════════════════════════════════════════════════════

const MASTER_TEMPLATE = {
  mode: 'HYBRID',                    // 'OFF' | 'HYBRID' | future: 'CSR', 'PRO'
  humorLevel: 0.6,                   // 0-1, how often humor is allowed when safe
  empathyLevel: 0.8,                 // 0-1, how soft/understanding the tone is
  directnessLevel: 0.7,              // 0-1, higher = shorter, more direct replies
  maxHumorPerReply: 1,               // max playful lines per reply
  allowSmallTalkSeconds: 15,         // how long small talk is tolerated
  safetyStrictness: 1.0,             // 1.0 = never relax safety messaging

  globalEmergencyKeywords: [
    'burning smell',
    'smoke',
    'sparks',
    'fire',
    'gas smell',
    'leaking into ceiling',
    'water pouring',
    'flooding',
    'unconscious',
    'chest pain',
    'bleeding a lot'
  ],

  globalBillingConflictKeywords: [
    'you charged',
    'my bill',
    'refund',
    'dispute',
    'overcharged',
    'chargeback',
    'billing error',
    'invoice is wrong'
  ],

  globalJokePatterns: [
    'lol',
    'lmao',
    'haha',
    'this thing is dead',
    "i'm dying here",
    'this is killing me',
    'my house is an oven',
    "i'm melting"
  ],

  tradeOverrides: {
    HVAC: {
      emergencyKeywords: [
        'ac is smoking',
        'smoke from vent',
        'smoke from vents',
        'water coming through ceiling',
        'water dripping from vent',
        'ac caught fire',
        'unit on fire',
        'smell of burning plastic'
      ],
      billingConflictKeywords: [],
      jokePatterns: [
        'house is an oven',
        "i'm melting",
        'my ac is dead',
        'it needs a priest'
      ]
    },
    PLUMBING: {
      emergencyKeywords: [
        'sewage backing up',
        'sewer backing up',
        'toilet overflowing',
        'toilet is overflowing',
        'burst pipe',
        'pipe burst',
        'water main broke',
        'water main is broken',
        'water all over the floor'
      ],
      billingConflictKeywords: [],
      jokePatterns: [
        'my bathroom is a swimming pool',
        'indoor pool now',
        'feels like a water park'
      ]
    },
    DENTAL: {
      emergencyKeywords: [
        "bleeding won't stop",
        'bleeding will not stop',
        'face is swelling',
        'face is swelling up',
        'severe tooth pain',
        'unbearable tooth pain',
        'jaw is swelling',
        'infection spreading'
      ],
      billingConflictKeywords: [],
      jokePatterns: [
        'i need new teeth already',
        'my teeth hate me'
      ]
    },
    ELECTRICAL: {
      emergencyKeywords: [
        'outlet is smoking',
        'outlet is sparking',
        'sparks from outlet',
        'breaker keeps tripping',
        'panel is hot',
        'electrical burning smell'
      ],
      billingConflictKeywords: [],
      jokePatterns: [
        'house is trying to electrocute me'
      ]
    }
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GENERIC DEFAULT - For new companies without specific trade tuning
// ═══════════════════════════════════════════════════════════════════════════

const GENERIC_DEFAULT = {
  mode: 'HYBRID',
  humorLevel: 0.4,
  empathyLevel: 0.8,
  directnessLevel: 0.7,
  maxHumorPerReply: 1,
  allowSmallTalkSeconds: 10,
  safetyStrictness: 1.0,

  globalEmergencyKeywords: [
    'burning smell',
    'smoke',
    'sparks',
    'fire',
    'gas smell',
    'leaking into ceiling',
    'water pouring',
    'flooding',
    'unconscious',
    'chest pain',
    'bleeding a lot'
  ],

  globalBillingConflictKeywords: [
    'you charged',
    'my bill',
    'refund',
    'dispute',
    'overcharged',
    'chargeback',
    'billing error',
    'invoice is wrong'
  ],

  globalJokePatterns: [
    'lol',
    'lmao',
    'haha',
    'this thing is dead',
    "i'm dying here",
    'this is killing me'
  ],

  tradeOverrides: {}
};

// ═══════════════════════════════════════════════════════════════════════════
// HVAC PROFILE - Hot climate, friendly, allows AC humor
// ═══════════════════════════════════════════════════════════════════════════

const HVAC_PROFILE = {
  mode: 'HYBRID',
  humorLevel: 0.6,
  empathyLevel: 0.8,
  directnessLevel: 0.7,
  maxHumorPerReply: 1,
  allowSmallTalkSeconds: 15,
  safetyStrictness: 1.0,

  globalEmergencyKeywords: [
    'burning smell',
    'smoke',
    'sparks',
    'fire',
    'gas smell',
    'leaking into ceiling',
    'water pouring',
    'flooding'
  ],

  globalBillingConflictKeywords: [
    'you charged',
    'my bill',
    'refund',
    'dispute',
    'overcharged',
    'chargeback',
    'billing error',
    'invoice is wrong'
  ],

  globalJokePatterns: [
    'lol',
    'lmao',
    'haha',
    'this thing is dead',
    'this unit is dead',
    "i'm dying here",
    'this is killing me',
    'my ac is dead',
    'my house is an oven',
    "i'm melting"
  ],

  tradeOverrides: {
    HVAC: {
      emergencyKeywords: [
        'ac is smoking',
        'smoke from vent',
        'smoke from vents',
        'smoke from the ac',
        'ac caught fire',
        'unit on fire',
        'burning plastic smell from vents',
        'water coming through ceiling',
        'water dripping from vent',
        'water leaking from the ac'
      ],
      billingConflictKeywords: [],
      jokePatterns: [
        'house is an oven',
        "i'm melting",
        'my ac is dead',
        'feels like hell in here',
        'sauna in my house'
      ]
    }
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// PLUMBING PROFILE - High empathy for mess situations
// ═══════════════════════════════════════════════════════════════════════════

const PLUMBING_PROFILE = {
  mode: 'HYBRID',
  humorLevel: 0.5,
  empathyLevel: 0.9,
  directnessLevel: 0.7,
  maxHumorPerReply: 1,
  allowSmallTalkSeconds: 15,
  safetyStrictness: 1.0,

  globalEmergencyKeywords: [
    'leaking into ceiling',
    'water pouring',
    'flooding',
    'sewage',
    'sewer'
  ],

  globalBillingConflictKeywords: [
    'you charged',
    'my bill',
    'refund',
    'dispute',
    'overcharged',
    'chargeback',
    'billing error',
    'invoice is wrong'
  ],

  globalJokePatterns: [
    'lol',
    'lmao',
    'haha',
    'this thing is dead',
    'this is killing me'
  ],

  tradeOverrides: {
    PLUMBING: {
      emergencyKeywords: [
        'sewage backing up',
        'sewer backing up',
        'toilet overflowing',
        'toilet is overflowing',
        'burst pipe',
        'pipe burst',
        'pipe exploded',
        'water main broke',
        'water main is broken',
        'water all over the floor',
        'water everywhere',
        'basement is flooded'
      ],
      billingConflictKeywords: [],
      jokePatterns: [
        'my bathroom is a swimming pool',
        'indoor pool now',
        'feels like a water park in here'
      ]
    }
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// DENTAL PROFILE - Very low humor, high empathy, calm and reassuring
// ═══════════════════════════════════════════════════════════════════════════

const DENTAL_PROFILE = {
  mode: 'HYBRID',
  humorLevel: 0.2,
  empathyLevel: 0.95,
  directnessLevel: 0.6,
  maxHumorPerReply: 0,               // No humor in dental - pain situations
  allowSmallTalkSeconds: 5,
  safetyStrictness: 1.0,

  globalEmergencyKeywords: [
    "bleeding won't stop",
    'bleeding will not stop',
    'bleeding a lot',
    'severe tooth pain',
    'unbearable tooth pain',
    'face is swelling',
    'jaw is swelling',
    'infection spreading',
    'swelling getting worse'
  ],

  globalBillingConflictKeywords: [
    'you charged',
    'my bill',
    'refund',
    'dispute',
    'overcharged',
    'chargeback',
    'billing error',
    'invoice is wrong',
    "insurance didn't cover"
  ],

  globalJokePatterns: [
    'lol',
    'haha'
  ],

  tradeOverrides: {
    DENTAL: {
      emergencyKeywords: [
        'severe tooth pain',
        'pain is unbearable',
        "bleeding won't stop",
        'bleeding will not stop',
        'face is swelling',
        'cheek is swelling',
        'swelling around tooth',
        'infection getting worse'
      ],
      billingConflictKeywords: [],
      jokePatterns: [
        'my teeth hate me',
        'i need new teeth already'
      ]
    }
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// ELECTRICAL PROFILE - Safety-first, moderate humor, high directness
// ═══════════════════════════════════════════════════════════════════════════

const ELECTRICAL_PROFILE = {
  mode: 'HYBRID',
  humorLevel: 0.3,
  empathyLevel: 0.8,
  directnessLevel: 0.8,              // Electrical = be direct about safety
  maxHumorPerReply: 1,
  allowSmallTalkSeconds: 10,
  safetyStrictness: 1.0,

  globalEmergencyKeywords: [
    'burning smell',
    'electrical burning smell',
    'smoke',
    'sparks',
    'fire',
    'gas smell'
  ],

  globalBillingConflictKeywords: [
    'you charged',
    'my bill',
    'refund',
    'dispute',
    'overcharged',
    'chargeback',
    'billing error',
    'invoice is wrong'
  ],

  globalJokePatterns: [
    'lol',
    'haha',
    'this is killing me'
  ],

  tradeOverrides: {
    ELECTRICAL: {
      emergencyKeywords: [
        'outlet is smoking',
        'outlet is sparking',
        'sparks from outlet',
        'sparks from socket',
        'breaker keeps tripping',
        'panel is hot',
        'electrical burning smell',
        'smoke coming from panel',
        'smoke coming from outlet'
      ],
      billingConflictKeywords: [],
      jokePatterns: [
        'house is trying to electrocute me'
      ]
    }
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// DISABLED PROFILE - For companies that want no behavior styling
// ═══════════════════════════════════════════════════════════════════════════

const DISABLED_PROFILE = {
  mode: 'OFF',
  humorLevel: 0,
  empathyLevel: 0.7,
  directnessLevel: 0.7,
  maxHumorPerReply: 0,
  allowSmallTalkSeconds: 0,
  safetyStrictness: 1.0,
  globalEmergencyKeywords: [],
  globalBillingConflictKeywords: [],
  globalJokePatterns: [],
  tradeOverrides: {}
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Get profile by trade key
// ═══════════════════════════════════════════════════════════════════════════

function getProfileByTrade(tradeKey) {
  const trade = (tradeKey || '').toUpperCase();
  
  switch (trade) {
    case 'HVAC':
      return { ...HVAC_PROFILE };
    case 'PLUMBING':
      return { ...PLUMBING_PROFILE };
    case 'DENTAL':
      return { ...DENTAL_PROFILE };
    case 'ELECTRICAL':
      return { ...ELECTRICAL_PROFILE };
    default:
      return { ...GENERIC_DEFAULT };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Validate profile structure
// ═══════════════════════════════════════════════════════════════════════════

function validateProfile(profile) {
  const errors = [];
  
  if (!profile) {
    return { valid: false, errors: ['Profile is null or undefined'] };
  }
  
  // Check mode
  if (!['OFF', 'HYBRID'].includes(profile.mode)) {
    errors.push(`Invalid mode: ${profile.mode}. Must be 'OFF' or 'HYBRID'`);
  }
  
  // Check numeric ranges
  const numericFields = [
    'humorLevel', 'empathyLevel', 'directnessLevel', 'safetyStrictness'
  ];
  
  for (const field of numericFields) {
    const val = profile[field];
    if (typeof val !== 'number' || val < 0 || val > 1) {
      errors.push(`${field} must be a number between 0 and 1`);
    }
  }
  
  // Check arrays
  const arrayFields = [
    'globalEmergencyKeywords',
    'globalBillingConflictKeywords', 
    'globalJokePatterns'
  ];
  
  for (const field of arrayFields) {
    if (!Array.isArray(profile[field])) {
      errors.push(`${field} must be an array`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  // Templates
  MASTER_TEMPLATE,
  GENERIC_DEFAULT,
  HVAC_PROFILE,
  PLUMBING_PROFILE,
  DENTAL_PROFILE,
  ELECTRICAL_PROFILE,
  DISABLED_PROFILE,
  
  // Helpers
  getProfileByTrade,
  validateProfile
};

