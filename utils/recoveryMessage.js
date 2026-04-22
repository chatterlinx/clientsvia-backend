'use strict';

/**
 * ============================================================================
 * RECOVERY MESSAGE — Shared UI-owned fallback string loader
 * ============================================================================
 *
 * Single source of truth for "something went wrong, what should the agent say"
 * strings. Previously defined only in routes/v2twilio.js, which meant engine
 * modules (KCDiscoveryRunner, etc.) had to either duplicate the logic or
 * hardcode English — violating the multi-tenant rule.
 *
 * Loads recoveryMessages from the company's LLMSettings via LLM0ControlsLoader
 * (Redis-cached). Handles legacy key aliases. Random selection from variant
 * array for natural sound.
 *
 * MULTI-TENANT RULE:
 *   NO hardcoded English. Every word the agent speaks must be configured in
 *   the UI (Agent Console → Recovery Messages). If a company has not
 *   configured a message, this function returns null — callers can inline a
 *   safety-net string at each call site (rare edge) or skip / transfer.
 *
 * TYPES (keys in recoveryConfig):
 *   - audioUnclear       (legacy alias: choppyConnection)
 *   - silenceRecovery    (legacy alias: noSpeech)
 *   - generalError       (used across KC/ Groq/ runtime fallbacks)
 *
 * SIGNATURE:
 *   getRecoveryMessage(company, type = 'audioUnclear') → Promise<string|null>
 *
 * USAGE PATTERN:
 *   const { getRecoveryMessage } = require('../../../utils/recoveryMessage');
 *   const msg = (await getRecoveryMessage(company, 'generalError').catch(() => null))
 *             || 'last-resort safety-net string';
 *
 * HISTORY:
 *   Extracted from routes/v2twilio.js (Stage 14, Y94 triage) to let engine
 *   modules emit UI-owned recovery copy without importing the full voice route.
 * ============================================================================
 */

const LLM0ControlsLoader = require('../services/LLM0ControlsLoader');
const logger             = require('./logger');

async function getRecoveryMessage(company, type = 'audioUnclear') {
  const companyId = company?._id || company?.companyId || 'unknown';

  // Load from LLMSettings via LLM0ControlsLoader (Redis-cached)
  const recoveryConfig = await LLM0ControlsLoader.loadRecoveryMessages(String(companyId));

  // Handle legacy key aliases
  if (type === 'choppyConnection') type = 'audioUnclear';
  if (type === 'noSpeech')          type = 'silenceRecovery';

  let variants = recoveryConfig[type];

  // Legacy compat: choppyConnection alias
  if (!variants && type === 'audioUnclear') {
    variants = recoveryConfig.choppyConnection;
  }

  // Legacy compat: noSpeech alias
  if (!variants && type === 'silenceRecovery') {
    variants = recoveryConfig.noSpeech;
  }

  // String → array (legacy single-value format)
  if (typeof variants === 'string') {
    variants = variants.trim() ? [variants.trim()] : [];
  }

  // No configured message — log warning, return null (not unapproved speech)
  if (!Array.isArray(variants) || variants.length === 0) {
    logger.warn(`[RecoveryMsg] No UI-configured message for type="${type}" companyId=${companyId}. Configure in LLM Settings → Call Handling.`);
    return null;
  }

  // Random selection for natural sound
  const message = variants[Math.floor(Math.random() * variants.length)];
  return message || null;
}

module.exports = { getRecoveryMessage };
