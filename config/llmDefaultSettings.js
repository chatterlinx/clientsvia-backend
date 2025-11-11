// config/llmDefaultSettings.js

const DEFAULT_LLM_SETTINGS = {
  profiles: {
    compliance_safe: {
      enabled: true,
      label: 'Compliance-Safe (Default)',
      model: 'gpt-4o-mini',
      temperature: 0.2,
      topP: 0.9,
      maxTokens: 2200,
      aggressiveQuestions: false,
      extraVariants: false
    },
    call_center_optimized: {
      enabled: true,
      label: 'Call Center Optimized',
      model: 'gpt-4o-mini',
      temperature: 0.35,
      topP: 0.9,
      maxTokens: 2600,
      aggressiveQuestions: true,
      extraVariants: true
    },
    creative_exploration: {
      enabled: true,
      label: 'Creative Exploration (Internal)',
      model: 'gpt-4o',
      temperature: 0.65,
      topP: 0.95,
      maxTokens: 3000,
      aggressiveQuestions: false,
      extraVariants: true
    }
  },

  defaults: {
    activeProfile: 'compliance_safe', // key in profiles
    generationMode: 'single',         // 'single' | 'multi'
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
    // optional per-profile advanced overrides, null = use profile defaults
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
  }
};

module.exports = { DEFAULT_LLM_SETTINGS };

