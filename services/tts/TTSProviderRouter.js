'use strict';

/**
 * ============================================================================
 * TTS PROVIDER ROUTER — Single entry point for all call-path synthesis
 * ============================================================================
 *
 * Replaces the pattern where 13+ sites in routes/v2twilio.js each call
 * v2elevenLabsService.synthesizeSpeech() directly with their own arg sprawl,
 * their own try/catch, and their own hardcoded Polly fallback.
 *
 * NEW CONTRACT (what every call site gets back):
 *
 *   { kind: 'buffer', audio: Buffer, mime: 'audio/mpeg', sourceProvider: 'elevenlabs' }
 *   { kind: 'polly',  voice: 'Polly.Joanna-Neural',      sourceProvider: 'polly' | 'polly-fallback', fallbackReason? }
 *
 * Call sites branch on `kind`:
 *   - 'buffer' → save to disk, serve via /audio-safe/
 *   - 'polly'  → twiml.say({ voice }, text) — Twilio renders server-side
 *
 * PROVIDER SELECTION:
 *   1. company.aiAgentSettings.voiceSettings.provider decides primary.
 *      'elevenlabs' (default) or 'polly'.
 *   2. If primary='elevenlabs' and EL throws (quota, 5xx, timeout, circuit
 *      open, NO_VOICE_ID), we fall through to Polly with the tenant's
 *      chosen pollyVoiceId — automatic, no call site logic needed.
 *   3. If primary='polly', we never call EL. Polly all the way.
 *
 * WHAT THIS COMPONENT GUARANTEES:
 *   - Never returns null / undefined. Always a valid descriptor.
 *   - Never throws (except for bad inputs that violate the contract).
 *   - Telemetry events emitted for every synthesis + every fallback.
 *   - Call sites shrink from ~20 lines each to ~6 lines (branch on kind).
 *
 * TELEMETRY:
 *   Emits VOICE_PROVIDER_USED on every synthesis (primary success) and
 *   VOICE_PROVIDER_FALLBACK when primary fails and we fall back to Polly.
 *   Both attach to CallTranscriptV2.trace via the callSid when provided.
 *
 * @module services/tts/TTSProviderRouter
 */

const ElevenLabsProvider = require('./providers/ElevenLabsProvider');
const PollyProvider = require('./providers/PollyProvider');
const { getPrimaryProvider, getPollyFallbackVoice } = require('./pollyHelpers');

/**
 * Emit a telemetry event. Best-effort; never throws / never blocks the call.
 * Hooks into CallTranscriptV2.trace via a simple require. When the model
 * isn't available (e.g. script context), no-ops silently.
 */
async function _emit(event, payload, callSid) {
    if (!callSid) return;
    try {
        // Lazy-load to avoid circular imports & keep startup snappy
        const CallTranscriptV2 = require('../../models/CallTranscriptV2');
        if (CallTranscriptV2 && typeof CallTranscriptV2.updateOne === 'function') {
            await CallTranscriptV2.updateOne(
                { callSid },
                {
                    $push: {
                        trace: {
                            kind: event,
                            at: new Date(),
                            data: payload || {}
                        }
                    }
                }
            ).catch(() => { /* fire-and-forget */ });
        }
    } catch (_) {
        // Never break the call over telemetry
    }
}

/**
 * Main entry point.
 *
 * @param {Object} params
 * @param {string} params.text
 * @param {Object} params.company         — Mongoose doc or plain object
 * @param {string} [params.ttsSource]     — 'greeting' | 'answer' | 'retry' | ...
 * @param {string} [params.callSid]
 * @returns {Promise<Object>} descriptor (see module doc)
 */
async function synthesize({ text, company, ttsSource, callSid } = {}) {
    if (!text || typeof text !== 'string') {
        throw new Error('TTSProviderRouter.synthesize: text is required');
    }
    // company may be null in rare pre-load paths. PollyProvider handles that
    // (getPollyFallbackVoice returns the hardcoded default when company is null).

    const primary = getPrimaryProvider(company);

    // ─── POLLY PRIMARY ──────────────────────────────────────────────────────
    if (primary === 'polly') {
        const result = await PollyProvider.synthesize({ text, company, reason: 'primary' });
        _emit('VOICE_PROVIDER_USED', {
            provider: 'polly',
            voice: result.voice,
            ttsSource
        }, callSid);
        return result;
    }

    // ─── ELEVENLABS PRIMARY → POLLY FALLBACK ON FAILURE ────────────────────
    try {
        const result = await ElevenLabsProvider.synthesize({ text, company, ttsSource, callSid });
        _emit('VOICE_PROVIDER_USED', {
            provider: 'elevenlabs',
            ttsSource
        }, callSid);
        return result;
    } catch (err) {
        // Classify for telemetry — helps distinguish quota from network from config.
        const reason = _classifyElevenLabsError(err);

        const fallback = await PollyProvider.synthesize({
            text,
            company,
            reason: 'elevenlabs_fallback'
        });

        _emit('VOICE_PROVIDER_FALLBACK', {
            fromProvider: 'elevenlabs',
            toProvider: 'polly',
            reason,
            errorMessage: err?.message?.slice(0, 200),
            fallbackVoice: fallback.voice,
            ttsSource
        }, callSid);

        return fallback;
    }
}

/**
 * Internal: bucket an EL error into a telemetry-friendly reason code.
 */
function _classifyElevenLabsError(err) {
    if (!err) return 'unknown';
    if (err.code === 'NO_VOICE_ID') return 'no_voice_id';
    if (err.code === 'CIRCUIT_OPEN' || /circuit/i.test(err.message || '')) return 'circuit_open';
    // Timeout check BEFORE quota — "timeout of 30000ms exceeded" would otherwise
    // match the quota regex on "exceeded".
    if (err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED' || /time.?out|timed out/i.test(err.message || '')) return 'timeout';
    const status = err.statusCode || err.status;
    if (status === 429) return 'rate_limited';
    if (status === 401 || /quota|rate limit/i.test(err.message || '')) return 'quota_exceeded';
    if (status >= 500 && status < 600) return 'server_error';
    return 'unknown';
}

module.exports = {
    synthesize,
    // Exposed for tests + diagnostic tools
    _classifyElevenLabsError
};
