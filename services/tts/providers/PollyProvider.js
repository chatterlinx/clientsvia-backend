'use strict';

/**
 * ============================================================================
 * POLLY PROVIDER — Twilio-rendered Amazon Polly synthesis
 * ============================================================================
 *
 * Unlike ElevenLabs (which returns an MP3 buffer we save to disk and serve
 * via /audio-safe/), Polly is rendered by Twilio directly on the call leg
 * via the <Say voice="Polly.X"> TwiML verb. We never call the AWS SDK at
 * runtime — Twilio handles that and pays for the synthesis.
 *
 * So this provider doesn't return audio bytes. It returns a "descriptor"
 * the call site uses to emit <Say> TwiML:
 *
 *   { kind: 'polly', voice: 'Polly.Joanna-Neural', sourceProvider: 'polly' }
 *
 * The call site branches on `kind`:
 *   - 'buffer' → existing /audio-safe/ path
 *   - 'polly'  → twiml.say({ voice }, text)
 *
 * This keeps Polly ~100% reliable (Twilio's side, no breaker needed) and
 * zero-latency (no HTTP round-trip for synthesis).
 *
 * @module services/tts/providers/PollyProvider
 */

const { getPollyFallbackVoice } = require('../pollyHelpers');

/**
 * Synthesize via Polly (returns a TwiML descriptor, not bytes).
 * Never throws — Polly via Twilio has no failure mode worth catching here.
 *
 * @param {Object}  params
 * @param {string}  params.text         — text to speak (not used here, caller passes to TwiML)
 * @param {Object}  params.company      — tenant doc
 * @param {string}  [params.reason]     — 'primary' | 'elevenlabs_fallback' | ... for telemetry
 * @returns {{ kind: 'polly', voice: string, sourceProvider: 'polly', fallbackReason?: string }}
 */
async function synthesize({ company, reason = 'primary' } = {}) {
    const voice = getPollyFallbackVoice(company);

    return {
        kind: 'polly',
        voice,
        sourceProvider: reason === 'primary' ? 'polly' : 'polly-fallback',
        fallbackReason: reason === 'primary' ? undefined : reason
    };
}

module.exports = {
    synthesize
};
