// config/llmScenarioPrompts.js

//
//  LLM Scenario Architect – Central Config
//  ========================================
//  - All system prompt text (base + profiles + domain safety)
//  - All profile numeric defaults (model, temperature, top_p, max_tokens)
//  - Helper to build the final system prompt from Enterprise LLM settings
//

// ============================================================================
// 1. BASE PROMPT – ALWAYS APPLIED
// ============================================================================
const BASE_SCENARIO_ARCHITECT_PROMPT = `You are the AI Scenario Architect for ClientVia.ai.

Your job is to help admins configure phone call scenarios for real businesses.
You do NOT talk directly to end users. You only produce structured JSON drafts
that describe how the call-handling AI should behave.

ALWAYS follow these rules:

1) Output format
- You MUST respond with VALID JSON ONLY.
- No prose, no markdown, no comments, no explanations outside the JSON.
- The JSON must match the expected "scenarioDraft" schema exactly.

2) Role and perspective
- You are a senior contact-center architect, not a sales or marketing bot.
- Think like someone designing flows for thousands of calls per day.
- Prioritize clarity, safety, caller experience, and easy maintenance.

3) Scenario coverage
- Design for what MOST callers will say, but also include edge cases.
- Include strong trigger phrases, negative triggers, and test phrases.
- Always consider: recognition (triggers), response (replies), follow-up,
  escalation/handoff, silence handling, and QA testing.

4) No real-world actions
- You never book real appointments or change any external system.
- You only design the SCRIPT and SETTINGS for another AI to follow.

5) Company-specific facts
- Do NOT invent prices, policies, guarantees, legal terms, or service areas.
- When details are missing, either:
  - Ask clarifying questions (if allowed), or
  - Use neutral wording and mark the assumption in the checklistSummary.

6) Safety
- Avoid medical, legal, and financial advice unless explicitly scoped and
  covered by domain safety instructions.
- Never collect highly sensitive data unless explicitly allowed by a
  domain safety mode and clearly documented in the checklistSummary.

Your output must always include a checklistSummary explaining key assumptions,
risks, and anything the human admin should double-check before going live.`.trim();

// ============================================================================
// 2. PROFILE-SPECIFIC PROMPT BLOCKS
// ============================================================================

const PROFILE_PROMPT_COMPLIANCE_SAFE = `PROFILE: COMPLIANCE-SAFE

Behavior:
- Be conservative and low-creativity.
- Ask clarifying questions instead of guessing when requirements are unclear.
- Avoid strong claims or promises on behalf of the business.
- Prefer neutral, professional, and respectful language.

Scenario design rules:
- Use modest priority values. This profile is for stable, non-emergency flows.
- Choose minConfidence between 0.60 and 0.90.
- Prefer shorter lists of well-chosen triggers and replies over huge lists.
- Encourage clear escalation paths instead of trying to handle everything with automation.

Sensitive areas:
- DO NOT provide medical, legal, or investment advice.
- DO NOT invent policies, guarantees, or fees.
- DO NOT design flows that handle emergencies solely by AI; always escalate or
  instruct callers to use official emergency channels when appropriate.`.trim();

const PROFILE_PROMPT_CALL_CENTER = `PROFILE: CALL CENTER OPTIMIZED

Behavior:
- Balanced creativity with strong structure.
- Generate richer trigger phrases and reply variations that sound natural on the phone.
- Keep tone friendly, courteous, and concise.

Scenario design rules:
- Use moderate priorities when appropriate so high-traffic intents are recognized.
- Generate more testPhrases to support QA and regression tests.
- Design replies that sound like live agents: short, direct, with clear next steps.

Sensitive areas:
- Still avoid medical/legal/financial advice.
- Still do not invent specific policies, fees, or guarantees; ask the admin to confirm.`.trim();

const PROFILE_PROMPT_CREATIVE = `PROFILE: CREATIVE EXPLORATION (INTERNAL USE ONLY)

Behavior:
- High creativity and breadth. Generate many alternative phrasings and ideas.
- This profile is for brainstorming and internal review, NOT direct production.
- You may propose unconventional flows and conversation styles,
  but they must still be safe and respectful.

Scenario design rules:
- Emphasize variety in triggers, replies, and test phrases.
- Include more notes and suggestions in the checklistSummary for the admin
  to review before turning anything live.

Safety:
- All safety and compliance rules still apply.
- Flag anything that might be risky, confusing, or too informal for production.`.trim();

const PROFILE_PROMPTS = {
  compliance_safe: PROFILE_PROMPT_COMPLIANCE_SAFE,
  call_center_optimized: PROFILE_PROMPT_CALL_CENTER,
  creative_exploration: PROFILE_PROMPT_CREATIVE
};

// ============================================================================
// 3. DOMAIN SAFETY BLOCKS
// ============================================================================

const DOMAIN_PROMPT_MEDICAL = `DOMAIN SAFETY: MEDICAL OFFICE

You are configuring scenarios for medical, dental, or healthcare contexts.

Hard rules:
- DO NOT provide medical advice, diagnosis, or treatment recommendations.
- DO NOT interpret symptoms, lab results, or imaging.
- DO NOT suggest medications, dosages, or changes to treatment plans.
- DO NOT triage emergencies or decide if a situation is urgent.

Allowed:
- You may help with logistics: scheduling, rescheduling, canceling appointments,
  collecting basic contact information, and routing calls.
- You may provide generic, non-clinical information such as office hours,
  directions, parking, and which departments handle which issues.

Emergency handling:
- If callers describe severe symptoms or emergencies, the scenario MUST instruct them
  to contact local emergency services or their clinician directly. Do not attempt
  to assess or resolve the situation in the call script.`.trim();

const DOMAIN_PROMPT_FINANCIAL = `DOMAIN SAFETY: FINANCIAL & BILLING

You are configuring scenarios for billing, payments, or financial questions.

Hard rules:
- DO NOT provide investment advice, tax advice, or legal opinions.
- DO NOT promise eligibility, approval, refunds, or fee waivers.
- DO NOT quote exact prices, interest rates, or balances unless explicitly provided
  as variables by the admin.

Allowed:
- You may help with logistics: checking status (in generic language), routing calls
  to billing teams, explaining how to contact support, and capturing contact details.

Language:
- Use cautious phrasing: "our team can review this", "we can check the status for you",
  "a representative will confirm the details", rather than hard guarantees.`.trim();

const DOMAIN_PROMPT_EMERGENCY = `DOMAIN SAFETY: EMERGENCY SERVICES

You are configuring scenarios where callers may be in active danger or urgent need.

Hard rules:
- The AI scenario must NOT attempt to diagnose or triage emergencies.
- The AI must NEVER delay or discourage contacting official emergency services.
- For any description of immediate danger to life, health, or property, the scenario
  should quickly instruct the caller to hang up and dial the local emergency number.

Design:
- Keep scripts extremely clear and short.
- Avoid jokes, small talk, or anything that could be perceived as minimizing the situation.
- Ensure escalation/handoff to human responders is built into the scenario where applicable.`.trim();

const DOMAIN_PROMPTS = {
  medicalOfficeMode: DOMAIN_PROMPT_MEDICAL,
  financialMode: DOMAIN_PROMPT_FINANCIAL,
  emergencyServicesMode: DOMAIN_PROMPT_EMERGENCY
};

// ============================================================================
// 4. STRICT COMPLIANCE GLOBAL OVERRIDE
// ============================================================================

const GLOBAL_STRICT_COMPLIANCE_ADDON = `GLOBAL OVERRIDE: STRICT COMPLIANCE MODE IS ON.

When in doubt, behave like the Compliance-Safe profile and ask clarifying questions
instead of guessing. Avoid strong promises, avoid risky or ambiguous flows, and
prefer escalation or neutral wording when requirements are unclear.`.trim();

// ============================================================================
// 5. PROFILE NUMERIC CONFIGS (MODELS + DEFAULTS)
// ============================================================================

const ARCHITECT_LLM_PROFILES = {
  compliance_safe: {
    key: 'compliance_safe',
    label: 'Compliance-Safe (Default)',
    description: 'Conservative, low creativity (temp 0.2). Prioritizes safety, clarity, policy alignment. Best for production.',
    model: 'gpt-4o-mini',
    temperature: 0.2,
    topP: 0.9,
    maxTokens: 2200,
    safetyMode: 'strict',
    // Server-side clamps (enforced even if admin overrides)
    clamps: {
      temperature: { min: 0.1, max: 0.35 },
      topP: { min: 0.7, max: 0.95 },
      maxTokens: { min: 1200, max: 2600 }
    }
  },
  call_center_optimized: {
    key: 'call_center_optimized',
    label: 'Call Center Optimized',
    description: 'Balanced creativity (temp 0.35). Tuned for phone calls with richer triggers, more variants. Production-ready.',
    model: 'gpt-4o',
    temperature: 0.35,
    topP: 0.9,
    maxTokens: 2600,
    safetyMode: 'standard',
    clamps: null // No strict clamps for this profile
  },
  creative_exploration: {
    key: 'creative_exploration',
    label: 'Creative Exploration (Internal)',
    description: 'High creativity (temp 0.65), uses gpt-4o. Generates many variants for brainstorming. Review before production.',
    model: 'gpt-4o',
    temperature: 0.65,
    topP: 0.95,
    maxTokens: 3000,
    safetyMode: 'standard',
    clamps: null // No strict clamps for internal use
  }
};

const DEFAULT_PROFILE_KEY = 'compliance_safe';

// ============================================================================
// 6. DEFAULT ENTERPRISE SETTINGS (USED IF DB RETURNS NOTHING)
// ============================================================================

const DEFAULT_LLM_ENTERPRISE_SETTINGS = {
  profiles: ARCHITECT_LLM_PROFILES,
  
  defaults: {
    activeProfile: DEFAULT_PROFILE_KEY,
    generationMode: 'single', // 'single' | 'multi'
    defaultVariantCount: 1,
    maxVariantCount: 15
  },
  
  compliance: {
    strictComplianceMode: true,
    medicalOfficeMode: false,
    financialMode: false,
    emergencyServicesMode: false,
    notes: ''
  },
  
  overrides: {
    compliance_safe: {
      temperature: null,
      topP: null,
      maxTokens: null
    },
    call_center_optimized: {
      temperature: null,
      topP: null,
      maxTokens: null
    },
    creative_exploration: {
      temperature: null,
      topP: null,
      maxTokens: null
    }
  },

  // ✨ NEW: All prompt text is editable by admin
  // These are the DEFAULTS - admin can customize and reset back to these
  promptText: {
    base: BASE_SCENARIO_ARCHITECT_PROMPT,
    profiles: {
      compliance_safe: PROFILE_PROMPT_COMPLIANCE_SAFE,
      call_center_optimized: PROFILE_PROMPT_CALL_CENTER,
      creative_exploration: PROFILE_PROMPT_CREATIVE
    },
    domainSafety: {
      medicalOffice: DOMAIN_PROMPT_MEDICAL,
      financial: DOMAIN_PROMPT_FINANCIAL,
      emergency: DOMAIN_PROMPT_EMERGENCY
    },
    strictCompliance: GLOBAL_STRICT_COMPLIANCE_ADDON
  }
};

// ============================================================================
// 7. HELPER: BUILD FINAL SYSTEM PROMPT FROM SETTINGS
// ============================================================================

/**
 * Builds the complete system prompt for the Scenario Architect
 * based on the active profile and safety modes.
 * 
 * @param {Object} settings - Enterprise LLM settings
 * @returns {string} - Complete system prompt
 */
function buildScenarioArchitectSystemPromptFromSettings(settings = {}) {
  const merged = {
    ...DEFAULT_LLM_ENTERPRISE_SETTINGS,
    ...settings,
    defaults: {
      ...DEFAULT_LLM_ENTERPRISE_SETTINGS.defaults,
      ...(settings.defaults || {})
    },
    compliance: {
      ...DEFAULT_LLM_ENTERPRISE_SETTINGS.compliance,
      ...(settings.compliance || {})
    },
    promptText: {
      ...DEFAULT_LLM_ENTERPRISE_SETTINGS.promptText,
      ...(settings.promptText || {}),
      profiles: {
        ...DEFAULT_LLM_ENTERPRISE_SETTINGS.promptText.profiles,
        ...(settings.promptText?.profiles || {})
      },
      domainSafety: {
        ...DEFAULT_LLM_ENTERPRISE_SETTINGS.promptText.domainSafety,
        ...(settings.promptText?.domainSafety || {})
      }
    }
  };

  const profileKey =
    merged.defaults.activeProfile && ARCHITECT_LLM_PROFILES[merged.defaults.activeProfile]
      ? merged.defaults.activeProfile
      : DEFAULT_PROFILE_KEY;

  // Use custom promptText if admin edited it, otherwise fall back to defaults
  let prompt = merged.promptText.base || BASE_SCENARIO_ARCHITECT_PROMPT;

  // Add profile-specific block (use custom text if available)
  const profileBlock = merged.promptText.profiles[profileKey] || PROFILE_PROMPTS[profileKey];
  if (profileBlock) {
    prompt += '\n\n' + profileBlock;
  }

  // Add domain safety blocks (use custom text if available)
  if (merged.compliance.medicalOfficeMode) {
    const medicalBlock = merged.promptText.domainSafety.medicalOffice || DOMAIN_PROMPT_MEDICAL;
    prompt += '\n\n' + medicalBlock;
  }
  if (merged.compliance.financialMode) {
    const financialBlock = merged.promptText.domainSafety.financial || DOMAIN_PROMPT_FINANCIAL;
    prompt += '\n\n' + financialBlock;
  }
  if (merged.compliance.emergencyServicesMode) {
    const emergencyBlock = merged.promptText.domainSafety.emergency || DOMAIN_PROMPT_EMERGENCY;
    prompt += '\n\n' + emergencyBlock;
  }

  // Add strict compliance override (use custom text if available)
  if (merged.compliance.strictComplianceMode && profileKey !== 'compliance_safe') {
    const strictBlock = merged.promptText.strictCompliance || GLOBAL_STRICT_COMPLIANCE_ADDON;
    prompt += '\n\n' + strictBlock;
  }

  return prompt.trim();
}

// ============================================================================
// 8. HELPER: EXPOSE PARTS (FOR UI – SHOW EXACTLY WHAT MODEL SEES)
// ============================================================================

/**
 * Returns the prompt text broken into parts for UI display.
 * This allows the frontend to show exactly what the LLM receives.
 * 
 * @param {Object} settings - Enterprise LLM settings
 * @returns {Object} - Prompt parts (base, profile, domains, strict)
 */
function getScenarioPromptPartsFromSettings(settings = {}) {
  const merged = {
    ...DEFAULT_LLM_ENTERPRISE_SETTINGS,
    ...settings,
    defaults: {
      ...DEFAULT_LLM_ENTERPRISE_SETTINGS.defaults,
      ...(settings.defaults || {})
    },
    compliance: {
      ...DEFAULT_LLM_ENTERPRISE_SETTINGS.compliance,
      ...(settings.compliance || {})
    },
    promptText: {
      ...DEFAULT_LLM_ENTERPRISE_SETTINGS.promptText,
      ...(settings.promptText || {}),
      profiles: {
        ...DEFAULT_LLM_ENTERPRISE_SETTINGS.promptText.profiles,
        ...(settings.promptText?.profiles || {})
      },
      domainSafety: {
        ...DEFAULT_LLM_ENTERPRISE_SETTINGS.promptText.domainSafety,
        ...(settings.promptText?.domainSafety || {})
      }
    }
  };

  const profileKey =
    merged.defaults.activeProfile && ARCHITECT_LLM_PROFILES[merged.defaults.activeProfile]
      ? merged.defaults.activeProfile
      : DEFAULT_PROFILE_KEY;

  return {
    // Use custom text if admin edited it, otherwise use defaults
    base: merged.promptText.base || BASE_SCENARIO_ARCHITECT_PROMPT,
    profileKey,
    profile: merged.promptText.profiles[profileKey] || PROFILE_PROMPTS[profileKey],
    domains: {
      medicalOfficeMode: merged.compliance.medicalOfficeMode 
        ? (merged.promptText.domainSafety.medicalOffice || DOMAIN_PROMPT_MEDICAL)
        : '',
      financialMode: merged.compliance.financialMode 
        ? (merged.promptText.domainSafety.financial || DOMAIN_PROMPT_FINANCIAL)
        : '',
      emergencyServicesMode: merged.compliance.emergencyServicesMode 
        ? (merged.promptText.domainSafety.emergency || DOMAIN_PROMPT_EMERGENCY)
        : ''
    },
    strictCompliance:
      merged.compliance.strictComplianceMode && profileKey !== 'compliance_safe'
        ? (merged.promptText.strictCompliance || GLOBAL_STRICT_COMPLIANCE_ADDON)
        : ''
  };
}

// ============================================================================
// 9. HELPER: GET EFFECTIVE MODEL PARAMETERS
// ============================================================================

/**
 * Gets the effective model parameters for OpenAI calls,
 * applying overrides and clamps as needed.
 * 
 * @param {Object} settings - Enterprise LLM settings
 * @returns {Object} - { model, temperature, topP, maxTokens, profileKey }
 */
function getEffectiveModelParams(settings = {}) {
  const merged = {
    ...DEFAULT_LLM_ENTERPRISE_SETTINGS,
    ...settings,
    defaults: {
      ...DEFAULT_LLM_ENTERPRISE_SETTINGS.defaults,
      ...(settings.defaults || {})
    },
    overrides: {
      ...DEFAULT_LLM_ENTERPRISE_SETTINGS.overrides,
      ...(settings.overrides || {})
    }
  };

  const profileKey = merged.defaults.activeProfile || DEFAULT_PROFILE_KEY;
  const profile = ARCHITECT_LLM_PROFILES[profileKey] || ARCHITECT_LLM_PROFILES[DEFAULT_PROFILE_KEY];
  const overrides = merged.overrides[profileKey] || {};

  // Start with profile defaults
  let temperature = profile.temperature;
  let topP = profile.topP;
  let maxTokens = profile.maxTokens;
  const model = profile.model;

  // Apply admin overrides if present
  if (typeof overrides.temperature === 'number') temperature = overrides.temperature;
  if (typeof overrides.topP === 'number') topP = overrides.topP;
  if (typeof overrides.maxTokens === 'number') maxTokens = overrides.maxTokens;

  // Apply clamps if profile has them (Compliance-Safe has strict clamps)
  if (profile.clamps) {
    if (profile.clamps.temperature) {
      temperature = Math.max(
        profile.clamps.temperature.min,
        Math.min(profile.clamps.temperature.max, temperature)
      );
    }
    if (profile.clamps.topP) {
      topP = Math.max(profile.clamps.topP.min, Math.min(profile.clamps.topP.max, topP));
    }
    if (profile.clamps.maxTokens) {
      maxTokens = Math.max(
        profile.clamps.maxTokens.min,
        Math.min(profile.clamps.maxTokens.max, maxTokens)
      );
    }
  }

  return {
    model,
    temperature,
    topP,
    maxTokens,
    profileKey,
    profileLabel: profile.label,
    safetyMode: profile.safetyMode
  };
}

// ============================================================================
// 10. HELPER: GET DEFAULT PROMPT TEXT (FOR RESET BUTTONS)
// ============================================================================

/**
 * Returns the hardcoded default prompt text.
 * Used by the "Reset to Default" buttons in the UI.
 * 
 * @returns {Object} - Default prompt text for all sections
 */
function getDefaultPromptText() {
  return {
    base: BASE_SCENARIO_ARCHITECT_PROMPT,
    profiles: {
      compliance_safe: PROFILE_PROMPT_COMPLIANCE_SAFE,
      call_center_optimized: PROFILE_PROMPT_CALL_CENTER,
      creative_exploration: PROFILE_PROMPT_CREATIVE
    },
    domainSafety: {
      medicalOffice: DOMAIN_PROMPT_MEDICAL,
      financial: DOMAIN_PROMPT_FINANCIAL,
      emergency: DOMAIN_PROMPT_EMERGENCY
    },
    strictCompliance: GLOBAL_STRICT_COMPLIANCE_ADDON
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Prompt text
  BASE_SCENARIO_ARCHITECT_PROMPT,
  PROFILE_PROMPTS,
  DOMAIN_PROMPTS,
  GLOBAL_STRICT_COMPLIANCE_ADDON,

  // Profile configs
  ARCHITECT_LLM_PROFILES,
  DEFAULT_PROFILE_KEY,

  // Default settings
  DEFAULT_LLM_ENTERPRISE_SETTINGS,

  // Helpers
  buildScenarioArchitectSystemPromptFromSettings,
  getScenarioPromptPartsFromSettings,
  getEffectiveModelParams,
  getDefaultPromptText
};

