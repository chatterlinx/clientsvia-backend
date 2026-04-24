/**
 * TurnLifecycleAdapter.js — Deepgram events → turn payloads
 *
 * Converts a stream of Deepgram live events into discrete "turn" emissions
 * that match the shape CallRuntime.processTurn() already consumes from the
 * Gather path. This is the seam that lets C4 plug Media Streams into the
 * existing engine with zero engine changes.
 *
 * Event sources (Deepgram live SDK):
 *   - Transcript    (alternatives[0].transcript, is_final, speech_final, confidence)
 *   - SpeechStarted (caller started speaking — used for barge-in)
 *   - UtteranceEnd  (Deepgram's VAD-based end of utterance)
 *
 * Emissions (on register handlers):
 *   - onPartial({ text, confidence })
 *   - onFinal({ text, confidence })              // full utterance, committed
 *   - onBargeIn({ at })                          // SpeechStarted while TTS playing
 *   - onIdle({ silentMs })                       // only when explicitly called via tick()
 *
 * Pure: no network, no timers, no Deepgram SDK coupling. MediaStreamServer
 * pipes events in, adapter emits turns out.
 *
 * Design notes:
 *   - Deepgram may emit many interims then a speech_final. We aggregate
 *     interims into a running buffer, and only fire onFinal when either
 *     speech_final=true OR UtteranceEnd is received.
 *   - Confidence is the confidence of the last final segment (or last
 *     interim if no finals arrived).
 *   - Barge-in uses a caller-set flag "isTtsPlaying". If TTS is not playing,
 *     SpeechStarted is a no-op (we only care about bargein signals).
 *
 * @module services/mediaStream/TurnLifecycleAdapter
 * @version 1.0.0
 */

'use strict';

class TurnLifecycleAdapter {
    constructor(options = {}) {
        this._log = options.logger || null;
        this._handlers = {
            onPartial: null,
            onFinal:   null,
            onBargeIn: null,
            onIdle:    null
        };
        this._state = {
            buffer: '',              // running concatenation of final segments
            lastInterim: '',         // latest interim transcript (not yet committed)
            lastConfidence: null,
            lastSegmentAt: 0,        // epoch ms of last incoming event
            isTtsPlaying: false,     // caller toggles this
            committedAt: 0,
            turnCount: 0
        };
    }

    /**
     * Register a handler. Returns `this` for chaining.
     * @param {'onPartial'|'onFinal'|'onBargeIn'|'onIdle'} event
     * @param {Function} fn
     */
    on(event, fn) {
        if (!(event in this._handlers)) throw new Error(`Unknown event: ${event}`);
        if (typeof fn !== 'function') throw new TypeError(`Handler for ${event} must be a function`);
        this._handlers[event] = fn;
        return this;
    }

    /**
     * Called by MediaStreamServer when TTS playback starts/stops. Used only
     * for barge-in detection (SpeechStarted while TTS is playing).
     * @param {boolean} playing
     */
    setTtsPlaying(playing) {
        this._state.isTtsPlaying = Boolean(playing);
    }

    /**
     * Handle a Deepgram Transcript event.
     * @param {Object} dgData  Payload from LiveTranscriptionEvents.Transcript
     */
    handleTranscript(dgData) {
        const alt = dgData?.channel?.alternatives?.[0];
        const text = (alt?.transcript || '').trim();
        const confidence = typeof alt?.confidence === 'number' ? alt.confidence : null;
        const isFinal = dgData?.is_final === true;
        const isSpeechFinal = dgData?.speech_final === true;

        this._state.lastSegmentAt = Date.now();

        if (!text) return;

        if (isFinal) {
            // Commit this segment to the buffer. Deepgram may emit multiple
            // is_final segments within a single utterance; speech_final is
            // the real boundary.
            this._state.buffer = this._state.buffer
                ? `${this._state.buffer} ${text}`
                : text;
            this._state.lastInterim = '';
            this._state.lastConfidence = confidence;

            if (isSpeechFinal) {
                this._commit('speech_final');
            } else {
                // Emit progress partial (the current buffer so far).
                this._emit('onPartial', {
                    text: this._state.buffer,
                    confidence,
                    kind: 'interim_committed'
                });
            }
        } else {
            // Interim — running partial.
            this._state.lastInterim = text;
            this._state.lastConfidence = confidence;

            const combined = this._state.buffer
                ? `${this._state.buffer} ${text}`
                : text;
            this._emit('onPartial', {
                text: combined,
                confidence,
                kind: 'interim'
            });
        }
    }

    /**
     * Handle a Deepgram SpeechStarted event. Used for barge-in if TTS is
     * currently playing.
     * @param {Object} _dgData
     */
    handleSpeechStarted(_dgData) {
        this._state.lastSegmentAt = Date.now();
        if (this._state.isTtsPlaying) {
            this._emit('onBargeIn', { at: this._state.lastSegmentAt });
        }
    }

    /**
     * Handle a Deepgram UtteranceEnd event — Deepgram's VAD says the
     * caller has stopped speaking. Commit whatever buffer exists.
     * @param {Object} _dgData
     */
    handleUtteranceEnd(_dgData) {
        this._state.lastSegmentAt = Date.now();
        if (this._state.buffer || this._state.lastInterim) {
            // If there was an interim never committed, fold it in before emitting.
            if (!this._state.buffer && this._state.lastInterim) {
                this._state.buffer = this._state.lastInterim;
            }
            this._commit('utterance_end');
        }
    }

    /**
     * Idle check — call periodically from MediaStreamServer (e.g. every
     * 500ms) to detect sustained silence. Emits onIdle with silentMs.
     * Callers decide what to do (prompt, close, nothing).
     * @param {number} [nowMs] - injected for tests
     */
    tick(nowMs) {
        const now = typeof nowMs === 'number' ? nowMs : Date.now();
        const silentMs = this._state.lastSegmentAt
            ? now - this._state.lastSegmentAt
            : 0;
        this._emit('onIdle', { silentMs });
    }

    /**
     * Reset internal state after a turn is consumed.
     */
    reset() {
        this._state.buffer = '';
        this._state.lastInterim = '';
        this._state.lastConfidence = null;
    }

    /**
     * Diagnostic snapshot.
     */
    getState() {
        return { ...this._state };
    }

    // ── private ───────────────────────────────────────────────────────────

    _emit(handlerName, payload) {
        const fn = this._handlers[handlerName];
        if (!fn) return;
        try {
            fn(payload);
        } catch (err) {
            // Never let a handler crash the adapter. Log via injected logger
            // if available; otherwise stay silent.
            if (this._log) {
                this._log.error('[MS-ADAPTER] handler crashed', {
                    event: handlerName,
                    error: err?.message
                });
            }
        }
    }

    _commit(reason) {
        const text = this._state.buffer.trim();
        const confidence = this._state.lastConfidence;
        if (!text) return;
        this._state.turnCount += 1;
        this._state.committedAt = Date.now();
        this._emit('onFinal', {
            text,
            confidence,
            turnIndex: this._state.turnCount,
            reason
        });
        this.reset();
    }
}

module.exports = TurnLifecycleAdapter;
