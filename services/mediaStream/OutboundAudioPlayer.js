/**
 * OutboundAudioPlayer.js — TTS → Twilio Media Streams outbound audio
 *
 * Converts an utterance (text + voice settings) into a stream of Twilio
 * Media Streams `media` events that the caller hears in real time.
 *
 * Pipeline:
 *   text → v2elevenLabsService.synthesizeSpeech({output_format: 'ulaw_8000'})
 *     → ulaw 8kHz mono buffer
 *     → chunk into 160-byte frames (20ms @ 8kHz ulaw)
 *     → base64-encode each chunk
 *     → send as {event:'media', streamSid, media:{payload}}
 *     → finish with {event:'mark', streamSid, mark:{name:<markName>}}
 *
 * Why ulaw_8000 directly:
 *   ElevenLabs natively supports the output_format 'ulaw_8000'. Twilio's
 *   media stream payload format for inbound AND outbound is exactly that:
 *   8kHz G.711 mulaw mono, base64-encoded. Requesting it directly means
 *   zero transcoding — no ffmpeg dependency, no resample, no PCM→ulaw
 *   table. The buffer we receive is already in the wire format.
 *
 * Barge-in:
 *   The player reads a shared `cancelToken` each frame. If set, the
 *   send loop stops immediately (no more frames go out) and a cancel
 *   mark is emitted so downstream knows playback was interrupted.
 *
 * Greeting special case:
 *   The first TTS of a call (the greeting) goes through the same path.
 *   Caller will not hear anything until the WS is up and the first
 *   ulaw frame arrives — typical lag is <500ms after Twilio opens the
 *   stream.
 *
 * Platform rule: voice settings (voiceId, stability, etc.) come from
 * company.aiAgentSettings.voiceSettings. No hardcoded voice/model here.
 *
 * @module services/mediaStream/OutboundAudioPlayer
 * @version 1.0.0
 */

'use strict';

const logger = require('../../utils/logger');

// 20ms @ 8kHz mulaw = 160 bytes per frame. Twilio expects frames at
// roughly this cadence. We ship them as fast as the SDK accepts but
// pace with a lightweight setImmediate yield so the event loop keeps
// breathing for DG transcript handling.
const FRAME_BYTES = 160;

// Lazy-loaded to keep OutboundAudioPlayer unit-testable without the
// full ElevenLabs SDK (tests inject their own `synth` function).
let _synthesizeSpeech;
function _loadSynth() {
    if (_synthesizeSpeech) return _synthesizeSpeech;
    try {
        _synthesizeSpeech = require('../v2elevenLabsService').synthesizeSpeech;
    } catch (err) {
        logger.warn('[MS-AUDIO] v2elevenLabsService not loadable', { error: err.message });
        _synthesizeSpeech = null;
    }
    return _synthesizeSpeech;
}

/**
 * Read effective voice settings from a company doc. Returns a shape
 * compatible with synthesizeSpeech's kwargs. Follows the same precedence
 * agent2.* → voiceSettings that the rest of the codebase uses.
 */
function _extractVoiceSettings(company) {
    const agent2 = company?.aiAgentSettings?.agent2 || {};
    const legacy = company?.aiAgentSettings?.voiceSettings || {};

    // Voice ID comes from agent2.voice or legacy voiceSettings.voiceId.
    const voiceId = agent2.voice?.voiceId
        || legacy.voiceId
        || null;

    const stability = agent2.voice?.stability
        ?? legacy.stability
        ?? 0.5;

    const similarityBoost = agent2.voice?.similarityBoost
        ?? legacy.similarityBoost
        ?? 0.7;

    const style = agent2.voice?.styleExaggeration
        ?? legacy.styleExaggeration
        ?? 0;

    const modelId = agent2.voice?.modelId
        || legacy.modelId
        || 'eleven_turbo_v2_5';

    return { voiceId, stability, similarityBoost, style, modelId };
}

/**
 * Build a Twilio media event payload for a single ulaw frame.
 * Twilio shape: { event: 'media', streamSid, media: { payload (base64) } }
 */
function _buildMediaEvent(streamSid, payloadBase64) {
    return JSON.stringify({
        event: 'media',
        streamSid,
        media: { payload: payloadBase64 }
    });
}

/**
 * Build a Twilio mark event payload. Useful for tracking playback
 * completion (Twilio echoes marks back on outbound playback).
 */
function _buildMarkEvent(streamSid, markName) {
    return JSON.stringify({
        event: 'mark',
        streamSid,
        mark: { name: markName }
    });
}

/**
 * Chunk a ulaw buffer into FRAME_BYTES-sized base64 strings. The last
 * frame may be smaller; Twilio tolerates that.
 */
function _chunkToBase64Frames(buffer) {
    const frames = [];
    for (let offset = 0; offset < buffer.length; offset += FRAME_BYTES) {
        const slice = buffer.subarray(offset, Math.min(offset + FRAME_BYTES, buffer.length));
        frames.push(slice.toString('base64'));
    }
    return frames;
}

/**
 * Play an utterance over a Twilio Media Streams WS.
 *
 * @param {Object}   params
 * @param {Object}   params.ws         - Twilio WebSocket (ws.send() used)
 * @param {string}   params.streamSid  - Required — Twilio's streamSid from 'start'
 * @param {string}   params.text       - Utterance text
 * @param {Object}   params.company    - Tenant doc (for voice settings)
 * @param {string}   [params.callSid]  - Optional — passed to synth for qaLog
 * @param {string}   [params.ttsSource]- Optional tag (e.g. 'greeting', 'answer')
 * @param {string}   [params.markName] - Optional name for the completion mark (default: 'utt-<ts>')
 * @param {Object}   [params.cancelToken] - Optional { cancelled: boolean } read each frame
 * @param {Function} [params.synth]    - Optional synth override (for tests)
 * @returns {Promise<{bytesSent: number, framesSent: number, cancelled: boolean, markName: string}>}
 */
async function play({
    ws,
    streamSid,
    text,
    company,
    callSid = null,
    ttsSource = 'ms',
    markName = null,
    cancelToken = null,
    synth = null
} = {}) {
    if (!ws || ws.readyState !== ws.OPEN) {
        logger.warn('[MS-AUDIO] ws not open — skipping play');
        return { bytesSent: 0, framesSent: 0, cancelled: true, markName: null };
    }
    if (!streamSid) {
        throw new Error('OutboundAudioPlayer.play: streamSid is required');
    }
    if (!text || typeof text !== 'string') {
        logger.warn('[MS-AUDIO] empty text — skipping play');
        return { bytesSent: 0, framesSent: 0, cancelled: true, markName: null };
    }

    const synthFn = synth || _loadSynth();
    if (!synthFn) {
        throw new Error('OutboundAudioPlayer.play: synthesizeSpeech unavailable');
    }

    const { voiceId, stability, similarityBoost, style, modelId } = _extractVoiceSettings(company);
    if (!voiceId) {
        throw new Error('OutboundAudioPlayer.play: no voiceId resolved for company');
    }

    const effectiveMarkName = markName || `utt-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    // Synthesize — request mulaw 8kHz natively so we skip all transcoding.
    const t0 = Date.now();
    let audio;
    try {
        audio = await synthFn({
            text,
            voiceId,
            stability,
            similarity_boost: similarityBoost,
            style,
            use_speaker_boost: true,
            model_id: modelId,
            optimize_streaming_latency: 3,
            output_format: 'ulaw_8000',
            company,
            callSid,
            ttsSource
        });
    } catch (err) {
        logger.error('[MS-AUDIO] synth failed', { error: err.message, voiceId });
        throw err;
    }
    const synthMs = Date.now() - t0;

    const buf = Buffer.isBuffer(audio) ? audio : Buffer.from(audio);
    const frames = _chunkToBase64Frames(buf);

    let framesSent = 0;
    let bytesSent = 0;
    let cancelled = false;

    for (let i = 0; i < frames.length; i += 1) {
        if (cancelToken && cancelToken.cancelled) {
            cancelled = true;
            break;
        }
        if (ws.readyState !== ws.OPEN) {
            cancelled = true;
            break;
        }
        try {
            ws.send(_buildMediaEvent(streamSid, frames[i]));
            framesSent += 1;
            bytesSent += Math.floor(frames[i].length * 3 / 4); // base64→bytes approx
        } catch (err) {
            logger.warn('[MS-AUDIO] ws.send failed mid-play', { error: err.message, framesSent });
            cancelled = true;
            break;
        }

        // Yield so the DG transcript listener keeps running; a tiny
        // setImmediate is cheaper than setTimeout(0) and enough to
        // break up cpu-bound loops on larger utterances.
        if (i % 50 === 0 && i > 0) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => setImmediate(resolve));
        }
    }

    // Final mark — Twilio will echo this back on the inbound WS once
    // Twilio finishes actually playing all queued frames to the caller.
    // That echo is our signal that playback truly completed (vs just
    // the server finishing sends).
    if (!cancelled) {
        try {
            ws.send(_buildMarkEvent(streamSid, effectiveMarkName));
        } catch (err) {
            logger.warn('[MS-AUDIO] ws.send mark failed', { error: err.message });
        }
    }

    logger.info('[MS-AUDIO] play complete', {
        streamSid,
        callSid: callSid ? callSid.slice(-8) : null,
        textLen: text.length,
        framesSent,
        bytesSent,
        cancelled,
        synthMs,
        mark: cancelled ? null : effectiveMarkName
    });

    return {
        bytesSent,
        framesSent,
        cancelled,
        markName: cancelled ? null : effectiveMarkName,
        synthMs
    };
}

/**
 * Send a raw clear-queue event so Twilio drops any buffered audio
 * immediately. Used on barge-in to cut off mid-utterance playback.
 */
function clearPlayback(ws, streamSid) {
    if (!ws || ws.readyState !== ws.OPEN || !streamSid) return false;
    try {
        ws.send(JSON.stringify({ event: 'clear', streamSid }));
        return true;
    } catch (err) {
        logger.warn('[MS-AUDIO] clear failed', { error: err.message });
        return false;
    }
}

module.exports = {
    play,
    clearPlayback,
    // For tests
    _internals: {
        _extractVoiceSettings,
        _buildMediaEvent,
        _buildMarkEvent,
        _chunkToBase64Frames,
        FRAME_BYTES
    }
};
