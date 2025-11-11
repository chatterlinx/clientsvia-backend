// config/llmDefaultSettings.js
// DEPRECATED: Use llmScenarioPrompts.js instead
// This file is kept for backwards compatibility only

const { DEFAULT_LLM_ENTERPRISE_SETTINGS } = require('./llmScenarioPrompts');

// Re-export for backwards compatibility
const DEFAULT_LLM_SETTINGS = DEFAULT_LLM_ENTERPRISE_SETTINGS;

module.exports = { DEFAULT_LLM_SETTINGS };

