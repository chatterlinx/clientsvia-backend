'use strict';

/**
 * ============================================================================
 * POLLY HELPERS — Tenant-owned fallback voice resolution
 * ============================================================================
 *
 * Replaces the hardcoded 'Polly.Matthew-Neural' literal that appears 50+
 * times across routes/v2twilio.js emergency fallback sites. Every site
 * should now call getPollyFallbackVoice(company) so the TENANT's chosen
 * Polly voice plays when ElevenLabs fails — not a brand-neutral default.
 *
 * The hardcoded DEFAULT_POLLY_VOICE_ID is used ONLY in two cases:
 *   1. The company object is null/undefined (pre-load crashes)
 *   2. The tenant has never picked a Polly voice AND the catalog entry
 *      for their pollyVoiceId is not found (invalid/stale value)
 *
 * @module services/tts/pollyHelpers
 */

const {
    DEFAULT_POLLY_VOICE_ID,
    isValidPollyVoice
} = require('../../config/pollyVoiceCatalog');

/**
 * Get the tenant's chosen Polly fallback voice, with last-resort default.
 * ALWAYS safe to call — never throws, never returns null.
 *
 * @param {Object|null} company — Mongoose doc or plain object
 * @returns {string} Twilio <Say> voice attribute, e.g. 'Polly.Joanna-Neural'
 */
function getPollyFallbackVoice(company) {
    const voiceId = company?.aiAgentSettings?.voiceSettings?.pollyVoiceId;
    if (isValidPollyVoice(voiceId)) return voiceId;
    return DEFAULT_POLLY_VOICE_ID;
}

/**
 * Shortcut for the question: which provider does this tenant want as primary?
 * Returns 'elevenlabs' | 'polly'. Defaults to 'elevenlabs' when unset.
 *
 * @param {Object|null} company
 * @returns {'elevenlabs' | 'polly'}
 */
function getPrimaryProvider(company) {
    const p = company?.aiAgentSettings?.voiceSettings?.provider;
    return p === 'polly' ? 'polly' : 'elevenlabs';
}

module.exports = {
    getPollyFallbackVoice,
    getPrimaryProvider,
    DEFAULT_POLLY_VOICE_ID
};
