// services/llmSettingsService.js
const LLMSettings = require('../models/LLMSettings');
const { DEFAULT_LLM_ENTERPRISE_SETTINGS } = require('../config/llmScenarioPrompts');

const GLOBAL_SCOPE = 'global';
const DEFAULT_LLM_SETTINGS = DEFAULT_LLM_ENTERPRISE_SETTINGS; // Alias for backwards compat

async function getSettings(scope = GLOBAL_SCOPE) {
  let doc = await LLMSettings.findOne({ scope }).lean();
  if (!doc) {
    // not created yet, return defaults
    return DEFAULT_LLM_SETTINGS;
  }
  // merge defaults with stored (in case you add new fields later)
  return {
    ...DEFAULT_LLM_SETTINGS,
    ...doc.settings,
    profiles: {
      ...DEFAULT_LLM_SETTINGS.profiles,
      ...(doc.settings.profiles || {})
    },
    defaults: {
      ...DEFAULT_LLM_SETTINGS.defaults,
      ...(doc.settings.defaults || {})
    },
    compliance: {
      ...DEFAULT_LLM_SETTINGS.compliance,
      ...(doc.settings.compliance || {})
    },
    overrides: {
      ...DEFAULT_LLM_SETTINGS.overrides,
      ...(doc.settings.overrides || {})
    },
    promptText: {
      ...DEFAULT_LLM_SETTINGS.promptText,
      ...(doc.settings.promptText || {}),
      profiles: {
        ...DEFAULT_LLM_SETTINGS.promptText.profiles,
        ...(doc.settings.promptText?.profiles || {})
      },
      domainSafety: {
        ...DEFAULT_LLM_SETTINGS.promptText.domainSafety,
        ...(doc.settings.promptText?.domainSafety || {})
      }
    }
  };
}

async function saveSettings(partialSettings, scope = GLOBAL_SCOPE) {
  const existing = await getSettings(scope);
  const merged = {
    ...existing,
    ...partialSettings,
    profiles: {
      ...existing.profiles,
      ...(partialSettings.profiles || {})
    },
    defaults: {
      ...existing.defaults,
      ...(partialSettings.defaults || {})
    },
    compliance: {
      ...existing.compliance,
      ...(partialSettings.compliance || {})
    },
    overrides: {
      ...existing.overrides,
      ...(partialSettings.overrides || {})
    },
    promptText: {
      ...existing.promptText,
      ...(partialSettings.promptText || {}),
      profiles: {
        ...existing.promptText.profiles,
        ...(partialSettings.promptText?.profiles || {})
      },
      domainSafety: {
        ...existing.promptText.domainSafety,
        ...(partialSettings.promptText?.domainSafety || {})
      }
    }
  };

  await LLMSettings.findOneAndUpdate(
    { scope },
    { scope, settings: merged },
    { upsert: true }
  );

  return merged;
}

async function resetSettings(scope = GLOBAL_SCOPE, section = 'all') {
  let settings = await getSettings(scope); // to keep shape consistent
  switch (section) {
    case 'profiles':
      settings.profiles = DEFAULT_LLM_SETTINGS.profiles;
      settings.overrides = DEFAULT_LLM_SETTINGS.overrides;
      break;
    case 'compliance':
      settings.compliance = DEFAULT_LLM_SETTINGS.compliance;
      break;
    case 'generation':
      settings.defaults = DEFAULT_LLM_SETTINGS.defaults;
      break;
    case 'advanced':
      settings.overrides = DEFAULT_LLM_SETTINGS.overrides;
      // Also reset model override to use profile default
      settings.defaults = {
        ...settings.defaults,
        modelOverride: null
      };
      break;
    case 'promptText':
      // Reset all prompt text to defaults
      settings.promptText = DEFAULT_LLM_SETTINGS.promptText;
      break;
    case 'all':
    default:
      settings = DEFAULT_LLM_SETTINGS;
  }

  await LLMSettings.findOneAndUpdate(
    { scope },
    { scope, settings },
    { upsert: true }
  );

  return settings;
}

module.exports = {
  getSettings,
  saveSettings,
  resetSettings
};

