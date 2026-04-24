'use strict';

/**
 * ============================================================================
 * ELEVENLABS PROVIDER — Thin wrapper around v2elevenLabsService.synthesizeSpeech
 * ============================================================================
 *
 * Adapts the ElevenLabs synthesizer to the TTSProviderRouter contract.
 * Returns a buffer descriptor on success; throws on failure (router catches
 * and falls through to PollyProvider with reason='elevenlabs_fallback').
 *
 * Reads voice settings straight from company.aiAgentSettings.voiceSettings —
 * same fields the 13+ legacy call sites in v2twilio.js currently pass one at
 * a time. Centralising here means future voiceSettings additions don't need
 * to touch 13 call sites.
 *
 * Circuit breaker is inside synthesizeSpeech itself; we don't need to check
 * here — it'll throw CircuitBreakerOpenError which we let propagate.
 *
 * @module services/tts/providers/ElevenLabsProvider
 */

const { synthesizeSpeech } = require('../../v2elevenLabsService');

/**
 * Synthesize via ElevenLabs. Returns a buffer descriptor.
 *
 * @param {Object} params
 * @param {string} params.text
 * @param {Object} params.company
 * @param {string} [params.ttsSource]   — 'greeting' | 'answer' | etc. for qaLog
 * @param {string} [params.callSid]
 * @returns {Promise<{ kind: 'buffer', audio: Buffer, mime: string, sourceProvider: 'elevenlabs' }>}
 */
async function synthesize({ text, company, ttsSource, callSid } = {}) {
    if (!text) throw new Error('text is required');
    if (!company) throw new Error('company is required');

    const vs = company?.aiAgentSettings?.voiceSettings || {};
    const voiceId = vs.voiceId;

    if (!voiceId) {
        const err = new Error('ElevenLabs voiceId not configured for tenant');
        err.code = 'NO_VOICE_ID';
        throw err;
    }

    const audio = await synthesizeSpeech({
        text,
        voiceId,
        stability: vs.stability,
        similarity_boost: vs.similarityBoost,
        style: vs.styleExaggeration,
        use_speaker_boost: vs.speakerBoost,
        model_id: vs.aiModel,
        output_format: vs.outputFormat,
        optimize_streaming_latency: vs.streamingLatency,
        company,
        callSid,
        ttsSource
    });

    return {
        kind: 'buffer',
        audio,
        mime: 'audio/mpeg',
        sourceProvider: 'elevenlabs'
    };
}

module.exports = {
    synthesize
};
