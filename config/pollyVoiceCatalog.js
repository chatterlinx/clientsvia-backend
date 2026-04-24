'use strict';

/**
 * ============================================================================
 * POLLY VOICE CATALOG — The 8 neural voices supported in v1
 * ============================================================================
 *
 * Single source of truth for Amazon Polly voice selection. Used by:
 *   - TTSProviderRouter.js (validates tenant's pollyVoiceId against this list)
 *   - PollyProvider.js (resolves tenant voice → Twilio <Say> voice attribute)
 *   - VoiceSettingsManager.js (renders the voice grid in the Polly card modal)
 *   - scripts/generate-polly-previews.js (renders the preview MP3s once)
 *
 * NAMING CONTRACT:
 *   - `id` is the Twilio <Say> voice attribute verbatim, e.g. 'Polly.Matthew-Neural'.
 *   - Twilio expects the 'Polly.' prefix + '-Neural' suffix for NTTS voices.
 *
 * WHY EIGHT:
 *   Covers the most common US English personas (2 male, 2 female, 1 child voice,
 *   1 older male, 1 Indian-English for multilingual tenants, 1 "authoritative
 *   female" Ruth). Adding more is a matter of adding the row AND generating a
 *   new preview MP3 — both are one-off ops, no code changes elsewhere.
 *
 * PREVIEW URLS:
 *   Static 5-second MP3s committed under public/audio-previews/polly/.
 *   Same sentence in every voice for easy A/B: "Hi, I'm {Name}. I'll be
 *   handling your call today."
 *
 * FALLBACK DEFAULT:
 *   'Polly.Matthew-Neural' is the hardcoded default if a tenant has not
 *   chosen a voice AND the primary provider fails. This is the ONE place
 *   in the platform where that string lives as a default — everywhere else
 *   reads company.aiAgentSettings.voiceSettings.pollyVoiceId.
 *
 * ============================================================================
 */

const POLLY_VOICES = Object.freeze([
    {
        id: 'Polly.Matthew-Neural',
        label: 'Matthew',
        gender: 'male',
        accent: 'en-US',
        description: 'Warm, conversational American male — platform default',
        previewUrl: '/audio-previews/polly/matthew.mp3',
        isDefault: true
    },
    {
        id: 'Polly.Joanna-Neural',
        label: 'Joanna',
        gender: 'female',
        accent: 'en-US',
        description: 'Clear, professional American female',
        previewUrl: '/audio-previews/polly/joanna.mp3'
    },
    {
        id: 'Polly.Stephen-Neural',
        label: 'Stephen',
        gender: 'male',
        accent: 'en-US',
        description: 'Authoritative, deeper American male',
        previewUrl: '/audio-previews/polly/stephen.mp3'
    },
    {
        id: 'Polly.Ruth-Neural',
        label: 'Ruth',
        gender: 'female',
        accent: 'en-US',
        description: 'Confident, authoritative American female',
        previewUrl: '/audio-previews/polly/ruth.mp3'
    },
    {
        id: 'Polly.Danielle-Neural',
        label: 'Danielle',
        gender: 'female',
        accent: 'en-US',
        description: 'Friendly, youthful American female',
        previewUrl: '/audio-previews/polly/danielle.mp3'
    },
    {
        id: 'Polly.Gregory-Neural',
        label: 'Gregory',
        gender: 'male',
        accent: 'en-US',
        description: 'Mature, older American male',
        previewUrl: '/audio-previews/polly/gregory.mp3'
    },
    {
        id: 'Polly.Ivy-Neural',
        label: 'Ivy',
        gender: 'female',
        accent: 'en-US',
        description: 'Youthful, bright American female (sounds younger)',
        previewUrl: '/audio-previews/polly/ivy.mp3'
    },
    {
        id: 'Polly.Kajal-Neural',
        label: 'Kajal',
        gender: 'female',
        accent: 'en-IN',
        description: 'Indian-English female — for multilingual tenants',
        previewUrl: '/audio-previews/polly/kajal.mp3'
    }
]);

// Fast lookup by id for validation
const POLLY_VOICES_BY_ID = Object.freeze(
    POLLY_VOICES.reduce((acc, v) => {
        acc[v.id] = v;
        return acc;
    }, {})
);

const DEFAULT_POLLY_VOICE_ID = 'Polly.Matthew-Neural';

/**
 * Validate that a voice id is in the supported catalog.
 * @param {string} voiceId — e.g. 'Polly.Joanna-Neural'
 * @returns {boolean}
 */
function isValidPollyVoice(voiceId) {
    return typeof voiceId === 'string' && Object.prototype.hasOwnProperty.call(POLLY_VOICES_BY_ID, voiceId);
}

/**
 * Resolve a tenant's chosen Polly voice to an entry in the catalog,
 * falling back to the platform default if invalid or unset.
 * @param {string | null | undefined} voiceId
 * @returns {Object} catalog entry
 */
function resolvePollyVoice(voiceId) {
    if (isValidPollyVoice(voiceId)) return POLLY_VOICES_BY_ID[voiceId];
    return POLLY_VOICES_BY_ID[DEFAULT_POLLY_VOICE_ID];
}

module.exports = {
    POLLY_VOICES,
    POLLY_VOICES_BY_ID,
    DEFAULT_POLLY_VOICE_ID,
    isValidPollyVoice,
    resolvePollyVoice
};
