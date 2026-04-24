/**
 * MediaStreamServer.js — Twilio ↔ Deepgram live bridge
 *
 * Mounts a WebSocket server under /api/twilio/media-stream on the existing
 * http.Server (same pattern as services/stt/TestConsoleASRServer.js).
 *
 * Lifecycle (per connection):
 *   1. Twilio opens WS with CustomParameters { companyId, callSid, ... }
 *   2. We wait for the Twilio 'start' event to get streamSid + params
 *   3. Load company (lean) → resolve config + vocabulary (C2 resolvers)
 *   4. Check DeepgramCircuitBreaker — if open, close WS + REST fallback
 *   5. Open Deepgram live stream with resolved model + keywords
 *   6. Initialise call state + play greeting via OutboundAudioPlayer (C4)
 *   7. Pipe mulaw frames: Twilio 'media' → base64-decode → DG.send()
 *   8. Feed Deepgram events into TurnLifecycleAdapter
 *   9. On adapter onFinal → load state → CallRuntime.processTurn →
 *      persist state → OutboundAudioPlayer.play(response) (C4)
 *  10. On adapter onBargeIn → OutboundAudioPlayer.clearPlayback() + cancel
 *      the current synth (C4)
 *  11. On Twilio 'stop' or any error → close both WS ends; if mid-call error,
 *      REST-redirect the call to the Gather fallback route (C4)
 *
 * Multi-tenant: every per-call field (model, keywords, voice, greeting,
 * state) resolves from company.aiAgentSettings via the shared resolvers.
 * Nothing hardcoded.
 *
 * @module services/mediaStream/MediaStreamServer
 * @version 2.0.0  (C4 — live wiring)
 */

'use strict';

const logger = require('../../utils/logger');
const { WebSocketServer } = require('ws');
const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');

const ConfigResolver = require('./ConfigResolver');
const VocabularyResolver = require('./VocabularyResolver');
const DeepgramCircuitBreaker = require('./DeepgramCircuitBreaker');
const MSHealth = require('../../utils/mediaStreamHealthMonitor');
const TurnLifecycleAdapter = require('./TurnLifecycleAdapter');
const OutboundAudioPlayer = require('./OutboundAudioPlayer');

// Lazy-load heavy deps so this file can be required in unit tests without a
// DB connection or the full engine graph. Resolution happens per-connection
// on first use.
function _loadCompanyModel() {
    return require('../../models/v2Company');
}
function _loadAdminSettingsModel() {
    return require('../../models/AdminSettings');
}
function _loadCallRuntime() {
    return require('../engine/CallRuntime').CallRuntime;
}
function _loadV2AIAgentRuntime() {
    return require('../v2AIAgentRuntime');
}
function _loadStateStore() {
    return require('../engine/StateStore').StateStore;
}
function _loadRedis() {
    try {
        return require('../../clients').redisClient || null;
    } catch (_e) {
        return null;
    }
}
function _loadCallTranscriptV2() {
    try {
        return require('../../models/CallTranscriptV2');
    } catch (_e) {
        return null;
    }
}
function _loadCallSummary() {
    try {
        return require('../../models/CallSummary');
    } catch (_e) {
        return null;
    }
}

/**
 * Stamp the STT provider on both CallTranscriptV2 and CallSummary.
 * Fire-and-forget; never blocks the call.
 *
 * @param {string} provider — 'media-streams' | 'mixed'
 */
function _stampSttProvider(companyId, callSid, provider) {
    const CallTranscriptV2 = _loadCallTranscriptV2();
    const CallSummary = _loadCallSummary();
    if (CallTranscriptV2 && companyId && callSid) {
        try {
            CallTranscriptV2.setSttProvider(companyId, callSid, provider)
                .catch(() => { /* advisory — never block */ });
        } catch (_e) { /* noop */ }
    }
    if (CallSummary && callSid) {
        try {
            CallSummary.setSttProvider(callSid, provider)
                .catch(() => { /* advisory — never block */ });
        } catch (_e) { /* noop */ }
    }
}

// Path Twilio will stream to (emitted by /voice TwiML branch + route).
const MS_PATH = '/api/twilio/media-stream';

// Hard safety ceiling — if a turn doesn't resolve within this many ms,
// we bail out and REST-redirect the call to Gather. Platform default;
// tenants can tune via adminSettings.globalHub.mediaStreams (future).
const DEFAULT_MAX_TURN_MS = 15000;

/**
 * Build the Deepgram live client. One per process — same connection pool
 * is used for every concurrent call.
 */
function _buildDeepgramClient() {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) throw new Error('DEEPGRAM_API_KEY not configured');
    return createClient(apiKey);
}

/**
 * Load company + AdminSettings. Returns nulls on error — caller handles.
 */
async function _loadTenantContext(companyId) {
    let company = null;
    let adminSettings = null;
    try {
        const Company = _loadCompanyModel();
        // Include fields CallRuntime + OutboundAudioPlayer need: voice
        // settings, twilioConfig for mid-call redirect, personality for
        // engine, etc. Trade the slight memory for a cleaner single load.
        company = await Company.findById(companyId)
            .select('_id companyName businessName trade aiAgentSettings twilioConfig')
            .lean();
    } catch (err) {
        logger.warn('[MS] Failed to load company', { companyId, error: err.message });
    }
    try {
        const AdminSettings = _loadAdminSettingsModel();
        adminSettings = await AdminSettings.findOne({}).lean();
    } catch (err) {
        logger.warn('[MS] Failed to load AdminSettings', { error: err.message });
    }
    return { company, adminSettings };
}

/**
 * Persist a conversation turn (caller or agent) to CallTranscriptV2.
 * Fire-and-forget; mirrors the shape the Gather path writes at
 * routes/v2twilio.js so Call Intelligence renders MS turns identically.
 *
 * Caller turns carry `trace.inputTextSource: 'deepgram_live'` — the Call
 * Intelligence API derives a per-turn STT provider from this, which the
 * UI uses to render a green DEEPGRAM pill on the caller row.
 */
function _appendConversationTurn(companyId, callSid, turn) {
    const CallTranscriptV2 = _loadCallTranscriptV2();
    if (!CallTranscriptV2 || !companyId || !callSid || !turn) return;
    try {
        CallTranscriptV2.appendTurns(companyId, callSid, [turn])
            .catch((err) => {
                logger.warn('[MS] appendTurns failed (non-blocking)', {
                    callSid: `${callSid}`.slice(-8),
                    speaker: turn.speaker,
                    turnNumber: turn.turnNumber,
                    error: err.message
                });
            });
    } catch (_e) { /* never block */ }
}

/**
 * Persist a single trace entry to CallTranscriptV2. Fire-and-forget;
 * never blocks the call. Matches the shape used by the Gather path.
 */
function _appendTrace(companyId, callSid, kind, payload, turn = 0) {
    const CallTranscriptV2 = _loadCallTranscriptV2();
    if (!CallTranscriptV2 || !companyId || !callSid) return;
    try {
        CallTranscriptV2.appendTrace(companyId, callSid, [{
            kind,
            turnNumber: Number.isFinite(turn) ? turn : 0,
            ts: new Date().toISOString(),
            payload: payload || {}
        }]).catch(() => { /* never block — trace is advisory */ });
    } catch (_e) { /* noop */ }
}

/**
 * Mid-call fallback: ask Twilio to redirect the live call to the
 * /fallback TwiML route. That route returns a <Redirect> into the
 * existing Gather loop so the call lives on. Required when WS or DG
 * fails mid-call — <Connect> is terminal, so only a REST update can
 * rescue the call.
 */
async function _redirectCallToFallback(company, callSid, hostHint = null) {
    if (!callSid) return false;
    const twilioCfg = company?.twilioConfig;
    if (!twilioCfg?.accountSid || !twilioCfg?.authToken) {
        logger.warn('[MS] Cannot redirect — no twilioConfig on company', {
            callSid: callSid.slice(-8),
            companyId: company?._id?.toString?.()
        });
        return false;
    }
    try {
        const twilio = require('twilio');
        const client = twilio(twilioCfg.accountSid, twilioCfg.authToken);
        // Build absolute URL. hostHint preferred (captured at connection
        // time from req.headers.host); otherwise we rely on env.
        const host = hostHint || process.env.PUBLIC_APP_HOST || null;
        if (!host) {
            logger.warn('[MS] Cannot build fallback URL — no host hint');
            return false;
        }
        const fallbackUrl = `https://${host}/api/twilio/media-stream/${company._id}/fallback`;
        await client.calls(callSid).update({ url: fallbackUrl, method: 'POST' });
        logger.info('[MS] 🛟 mid-call fallback redirect issued', {
            callSid: callSid.slice(-8),
            fallbackUrl
        });
        return true;
    } catch (err) {
        logger.error('[MS] fallback redirect failed', {
            callSid: callSid.slice(-8),
            error: err.message
        });
        return false;
    }
}

/**
 * Attach the Media Streams WebSocket server to the given http.Server.
 * Idempotent: safe to call once at boot. Platform-wide — serves every
 * tenant; per-connection company is resolved from the Twilio 'start' event.
 *
 * @param {import('http').Server} server
 */
function attachMediaStreamServer(server) {
    if (!process.env.DEEPGRAM_API_KEY) {
        logger.warn('[MS] DEEPGRAM_API_KEY missing — Media Streams endpoint NOT registered');
        return;
    }

    let dgClient;
    try {
        dgClient = _buildDeepgramClient();
    } catch (err) {
        logger.error('[MS] Failed to build Deepgram client', { error: err.message });
        return;
    }

    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
        try {
            const url = new URL(req.url, 'http://localhost');
            if (url.pathname !== MS_PATH) return;
            wss.handleUpgrade(req, socket, head, (ws) => {
                wss.emit('connection', ws, req);
            });
        } catch (err) {
            logger.error('[MS] Upgrade failed', { error: err.message });
            try { socket.destroy(); } catch (_e) { /* noop */ }
        }
    });

    wss.on('connection', (ws, req) => {
        _handleConnection(ws, req, dgClient).catch((err) => {
            logger.error('[MS] Connection handler crashed', { error: err.message, stack: err.stack });
            try { ws.close(); } catch (_e) { /* noop */ }
        });
    });

    logger.info(`[MS] Media Streams WebSocket endpoint registered at ${MS_PATH}`);
}

/**
 * Per-connection handler. Waits for Twilio 'start', resolves tenant,
 * opens Deepgram, drives adapter and engine.
 */
async function _handleConnection(ws, req, dgClient) {
    const state = {
        streamSid: null,
        callSid: null,
        companyId: null,
        company: null,
        adminSettings: null,
        config: null,
        dgLive: null,
        adapter: null,
        callState: null,
        turnCount: 0,
        audioFrames: 0,
        openedAt: Date.now(),
        closed: false,
        // Capture host at upgrade so mid-call redirects can build a URL
        hostHint: req.headers?.host || null,
        // Barge-in / playback cancellation — each playback reads this
        playbackCancel: null,
        // Serialise turn processing so a long turn doesn't overlap the next
        turnLock: Promise.resolve(),
        // Track whether we've already issued a REST-fallback so we don't
        // loop on repeated errors
        fallbackIssued: false
    };

    const ctx = { remote: req.socket?.remoteAddress || 'unknown' };
    logger.info('[MS] Connection opened', ctx);
    // C5 metric — increment platform-wide active WS count. Decrement in closeAll.
    try { MSHealth.recordStreamOpened(); } catch (_e) { /* health never blocks */ }

    // Always define a single safe close path.
    const closeAll = (reason) => {
        if (state.closed) return;
        state.closed = true;
        // C5 metric — always balance open/close. Done before dg.finish() so
        // an exception mid-cleanup still updates the gauge.
        try { MSHealth.recordStreamClosed(); } catch (_e) { /* noop */ }
        // Cancel any in-flight playback
        if (state.playbackCancel) state.playbackCancel.cancelled = true;
        try { state.dgLive?.finish(); } catch (_e) { /* noop */ }
        try {
            if (ws.readyState === ws.OPEN) ws.close();
        } catch (_e) { /* noop */ }
        _appendTrace(state.companyId, state.callSid, 'MS_STREAM_CLOSED', {
            reason,
            audioFrames: state.audioFrames,
            turnCount: state.turnCount,
            durationMs: Date.now() - state.openedAt
        }, state.turnCount);
        logger.info('[MS] Connection closed', {
            reason,
            streamSid: state.streamSid,
            callSid: state.callSid,
            companyId: state.companyId,
            audioFrames: state.audioFrames,
            turnCount: state.turnCount,
            durationMs: Date.now() - state.openedAt
        });
    };

    // Mid-call bail — REST-redirect the call then close everything.
    const bailToFallback = async (reason) => {
        if (state.fallbackIssued) return;
        state.fallbackIssued = true;
        logger.warn('[MS] 🛟 bailing to fallback', {
            callSid: state.callSid?.slice?.(-8),
            reason
        });
        _appendTrace(state.companyId, state.callSid, 'MS_MIDCALL_FALLBACK', {
            reason
        }, state.turnCount);
        // C5 metric — ring-buffer the fallback so /health/media-streams can
        // report 24h counts without reading CallTranscriptV2.
        try {
            MSHealth.recordMidcallFallback({
                companyId: state.companyId,
                callSid: state.callSid,
                reason
            });
        } catch (_e) { /* noop */ }
        // C6 observability — sticky flip to 'mixed' (only takes effect if
        // sttProvider was already 'media-streams' — if we failed before DG
        // Open fired, this is a no-op and Gather takes the call cleanly).
        _stampSttProvider(state.companyId, state.callSid, 'mixed');
        await _redirectCallToFallback(state.company, state.callSid, state.hostHint);
        closeAll(`fallback:${reason}`);
    };

    // Circuit breaker check (short-circuit before any work)
    if (await DeepgramCircuitBreaker.isOpen()) {
        logger.warn('[MS] Circuit is OPEN — rejecting connection');
        try { ws.send(JSON.stringify({ event: 'error', reason: 'circuit_open' })); } catch (_e) { /* noop */ }
        closeAll('circuit_open');
        return;
    }

    ws.on('message', async (raw) => {
        let msg;
        try {
            msg = JSON.parse(raw.toString('utf8'));
        } catch (_e) {
            return; // Not JSON — ignore
        }

        switch (msg.event) {
            case 'connected':
                // Protocol handshake from Twilio; no work needed yet.
                break;

            case 'start':
                await _handleStart(msg, state, ws, dgClient, bailToFallback);
                break;

            case 'media':
                _handleMedia(msg, state);
                break;

            case 'mark':
                // Twilio echoes back mark events we sent to track TTS
                // playback completion. We currently log only; C5 will
                // track playback latency here.
                break;

            case 'dtmf':
                logger.debug('[MS] DTMF received', { digit: msg.dtmf?.digit, callSid: state.callSid });
                break;

            case 'stop':
                closeAll('twilio_stop');
                break;

            default:
                // Unknown event type — ignore silently
        }
    });

    ws.on('close', () => closeAll('client_close'));
    ws.on('error', (err) => {
        logger.error('[MS] WS error', { error: err.message });
        closeAll('ws_error');
    });
}

/**
 * Handle Twilio 'start' event — carries CustomParameters we need. Opens
 * Deepgram, plays greeting, wires engine turn handler.
 */
async function _handleStart(msg, state, ws, dgClient, bailToFallback) {
    state.streamSid = msg.start?.streamSid || null;
    state.callSid = msg.start?.callSid || null;

    const params = msg.start?.customParameters || {};
    state.companyId = params.companyId || null;
    const callerPhone = params.from || null;
    const calledPhone = params.to || null;

    if (!state.companyId) {
        logger.warn('[MS] start event missing companyId', { streamSid: state.streamSid });
        try { ws.send(JSON.stringify({ event: 'error', reason: 'missing_companyId' })); } catch (_e) { /* noop */ }
        try { ws.close(); } catch (_e) { /* noop */ }
        return;
    }

    logger.info('[MS] Twilio stream started', {
        streamSid: state.streamSid,
        callSid: state.callSid,
        companyId: state.companyId,
        from: callerPhone,
        to: calledPhone
    });
    _appendTrace(state.companyId, state.callSid, 'MS_STREAM_OPENED', {
        streamSid: state.streamSid,
        from: callerPhone,
        to: calledPhone
    }, 0);

    // Load tenant context
    const ctx = await _loadTenantContext(state.companyId);
    state.company = ctx.company;
    state.adminSettings = ctx.adminSettings;

    if (!state.company) {
        logger.error('[MS] Company not found', { companyId: state.companyId });
        try { ws.send(JSON.stringify({ event: 'error', reason: 'company_not_found' })); } catch (_e) { /* noop */ }
        try { ws.close(); } catch (_e) { /* noop */ }
        return;
    }

    // Resolve config + keywords
    state.config = ConfigResolver.resolveMediaStreamConfig(state.company, state.adminSettings);
    const keywords = VocabularyResolver.resolveKeywords(state.company, state.adminSettings);

    logger.info('[MS] Resolved tenant config', {
        companyId: state.companyId,
        model: state.config.model,
        language: state.config.language,
        endpointingMs: state.config.endpointingMs,
        keywordCount: keywords.length,
        sources: state.config.source
    });

    // Open Deepgram live stream
    try {
        state.dgLive = dgClient.listen.live({
            model: state.config.model,
            language: state.config.language,
            smart_format: true,
            punctuate: true,
            interim_results: true,
            endpointing: state.config.endpointingMs,
            utterance_end_ms: state.config.utteranceEndMs,
            vad_events: true,
            encoding: 'mulaw',
            sample_rate: 8000,
            channels: 1,
            keywords
        });
    } catch (err) {
        logger.error('[MS] Failed to open Deepgram stream', { error: err.message });
        await DeepgramCircuitBreaker.recordFailure(`open_failed:${err.message}`);
        // C5 metric — synchronous-open path failed.
        try { MSHealth.recordDeepgramAttempt(false); } catch (_e) { /* noop */ }
        await bailToFallback(`dg_open_failed:${err.message}`);
        return;
    }

    // Build adapter + wire Deepgram events → adapter → engine
    state.adapter = new TurnLifecycleAdapter({ logger });

    state.adapter.on('onPartial', (payload) => {
        if (payload.kind === 'interim_committed') {
            logger.debug('[MS] partial committed', {
                callSid: state.callSid?.slice?.(-8),
                text: payload.text?.slice(0, 60)
            });
        }
    });

    state.adapter.on('onFinal', (payload) => {
        // Serialise turns — never overlap engine runs for the same call
        state.turnLock = state.turnLock
            .then(() => _runTurn(state, ws, payload, callerPhone, bailToFallback))
            .catch((err) => {
                logger.error('[MS] _runTurn crashed', {
                    callSid: state.callSid?.slice?.(-8),
                    error: err.message,
                    stack: err.stack
                });
            });
    });

    state.adapter.on('onBargeIn', (_payload) => {
        logger.info('[MS] 🎤 barge-in detected — clearing playback', {
            callSid: state.callSid?.slice?.(-8)
        });
        if (state.playbackCancel) state.playbackCancel.cancelled = true;
        OutboundAudioPlayer.clearPlayback(ws, state.streamSid);
    });

    // Deepgram event handlers
    state.dgLive.addListener(LiveTranscriptionEvents.Open, async () => {
        logger.info('[MS] Deepgram stream open', { callSid: state.callSid?.slice?.(-8), companyId: state.companyId });
        _appendTrace(state.companyId, state.callSid, 'MS_DEEPGRAM_CONNECTED', {
            model: state.config.model,
            language: state.config.language
        }, 0);
        await DeepgramCircuitBreaker.recordSuccess();
        // C5 metric — live WebSocket handshake succeeded.
        try { MSHealth.recordDeepgramAttempt(true); } catch (_e) { /* noop */ }
        // C6 observability — this call is now officially on Media Streams.
        // Stamp both CallTranscriptV2 and CallSummary so Call Intelligence
        // UI can badge the row without scanning trace[].
        _stampSttProvider(state.companyId, state.callSid, 'media-streams');

        // First-turn setup: init callState + play greeting via OutboundAudioPlayer
        try {
            await _initCallAndGreet(state, ws, callerPhone, calledPhone);
        } catch (err) {
            logger.error('[MS] initCallAndGreet failed', {
                callSid: state.callSid?.slice?.(-8),
                error: err.message,
                stack: err.stack
            });
            // Greeting failure is non-fatal — caller hears silence briefly
            // then Deepgram waits for their speech. We don't bail for this.
        }
    });

    state.dgLive.addListener(LiveTranscriptionEvents.Transcript, (dg) => {
        state.adapter.handleTranscript(dg);
    });

    if (LiveTranscriptionEvents.SpeechStarted) {
        state.dgLive.addListener(LiveTranscriptionEvents.SpeechStarted, (dg) => {
            state.adapter.handleSpeechStarted(dg);
        });
    }

    if (LiveTranscriptionEvents.UtteranceEnd) {
        state.dgLive.addListener(LiveTranscriptionEvents.UtteranceEnd, (dg) => {
            state.adapter.handleUtteranceEnd(dg);
        });
    }

    state.dgLive.addListener(LiveTranscriptionEvents.Error, async (err) => {
        logger.error('[MS] Deepgram error', { error: err?.message || String(err), callSid: state.callSid?.slice?.(-8) });
        _appendTrace(state.companyId, state.callSid, 'MS_DEEPGRAM_ERROR', {
            error: err?.message || String(err)
        }, state.turnCount);
        await DeepgramCircuitBreaker.recordFailure(`dg_error:${err?.message || 'unknown'}`);
        // C5 metric — count mid-stream error as a failed attempt for
        // success-rate tracking. This biases the window a little pessimistic
        // (it counts both "never connected" and "disconnected mid-call"),
        // which matches the operational question we want to answer: how
        // often is the DG path actually usable end-to-end?
        try { MSHealth.recordDeepgramAttempt(false); } catch (_e) { /* noop */ }
        await bailToFallback(`dg_error:${err?.message || 'unknown'}`);
    });

    state.dgLive.addListener(LiveTranscriptionEvents.Close, () => {
        logger.info('[MS] Deepgram stream closed', { callSid: state.callSid?.slice?.(-8) });
        _appendTrace(state.companyId, state.callSid, 'MS_DEEPGRAM_DISCONNECTED', {}, state.turnCount);
    });
}

/**
 * One-shot first-turn setup. Initialises call state (so BookingTriggerMatcher
 * + DiscoveryNotes see the same shape Gather would produce) and plays the
 * configured greeting via OutboundAudioPlayer.
 */
async function _initCallAndGreet(state, ws, callerPhone, calledPhone) {
    const { initializeCall } = _loadV2AIAgentRuntime();
    const redis = _loadRedis();
    const StateStore = _loadStateStore();

    // Initialise — returns { greeting, callState, voiceSettings, greetingConfig }
    const initResult = await initializeCall(
        state.companyId,
        state.callSid,
        callerPhone,
        calledPhone,
        'production',  // callSource
        false          // isTest
    );

    const initial = initResult?.callState || {};
    const redisKey = state.callSid ? `call:${state.callSid}` : null;

    // Persist initial state so the first onFinal turn reads a consistent shape
    if (redis && redisKey) {
        try {
            const persisted = StateStore.persist(initial, StateStore.load(initial));
            persisted._lastUpdatedTs = new Date().toISOString();
            persisted._stateKey = redisKey;
            await redis.set(redisKey, JSON.stringify(persisted), { EX: 60 * 60 * 4 });
            state.callState = persisted;
        } catch (err) {
            logger.warn('[MS] failed to persist initial state', { error: err.message });
            state.callState = initial;
        }
    } else {
        state.callState = initial;
    }

    // Play greeting (if any). Use /audio-safe/ path would require serving an
    // audio file; for simplicity C4 routes greeting text through TTS the same
    // way every other turn does. Caller hears the greeting within ~400-600ms
    // of answering.
    const greetingText = initResult?.greeting;
    if (greetingText && typeof greetingText === 'string' && greetingText.trim().length > 0) {
        state.playbackCancel = { cancelled: false };
        try {
            const result = await OutboundAudioPlayer.play({
                ws,
                streamSid: state.streamSid,
                text: greetingText,
                company: state.company,
                callSid: state.callSid,
                ttsSource: 'greeting',
                cancelToken: state.playbackCancel
            });
            _appendTrace(state.companyId, state.callSid, 'MS_GREETING_PLAYED', {
                textPreview: greetingText.slice(0, 100),
                framesSent: result.framesSent,
                cancelled: result.cancelled,
                synthMs: result.synthMs
            }, 0);
        } catch (err) {
            logger.error('[MS] greeting play failed', {
                callSid: state.callSid?.slice?.(-8),
                error: err.message
            });
        } finally {
            state.playbackCancel = null;
        }
    }
}

/**
 * Run one turn end-to-end: load state → CallRuntime.processTurn → save →
 * play response. Serialised via state.turnLock so a slow turn never
 * overlaps the next. Hard timeout via DEFAULT_MAX_TURN_MS.
 */
async function _runTurn(state, ws, payload, callerPhone, bailToFallback) {
    if (state.closed) return;

    const turnStart = Date.now();
    state.turnCount += 1;
    const turnNumber = state.turnCount;

    _appendTrace(state.companyId, state.callSid, 'MS_TURN_EMITTED', {
        turnIndex: payload.turnIndex,
        reason: payload.reason,
        text: payload.text,
        confidence: payload.confidence
    }, turnNumber);

    // Persist the caller's transcribed utterance as a CONVERSATION_CALLER turn
    // so Call Intelligence renders it identically to Gather-path caller rows.
    // `trace.inputTextSource = 'deepgram_live'` tells the API + UI that this
    // turn was transcribed by Deepgram (drives the green DEEPGRAM badge).
    const callerTurnText = typeof payload.text === 'string' ? payload.text.trim() : '';
    if (callerTurnText) {
        _appendConversationTurn(state.companyId, state.callSid, {
            speaker:    'caller',
            kind:       'CONVERSATION_CALLER',
            text:       callerTurnText,
            turnNumber,
            ts:         new Date(),
            sourceKey:  'stt',
            trace: {
                inputTextSource: 'deepgram_live',
                dgConfidence:    typeof payload.confidence === 'number' ? payload.confidence : null,
                dgReason:        payload.reason || null
            }
        });
    }

    logger.info('[MS] 🎤 Turn finalised', {
        callSid: state.callSid?.slice?.(-8),
        companyId: state.companyId,
        turnNumber,
        reason: payload.reason,
        text: payload.text,
        confidence: payload.confidence
    });

    const CallRuntime = _loadCallRuntime();
    const redis = _loadRedis();
    const StateStore = _loadStateStore();
    const redisKey = state.callSid ? `call:${state.callSid}` : null;

    // Load freshest state (engine may have run in another process; be safe)
    let callState = state.callState || {};
    if (redis && redisKey) {
        try {
            const raw = await redis.get(redisKey);
            if (raw) callState = JSON.parse(raw);
        } catch (err) {
            logger.warn('[MS] state load failed, using cached', { error: err.message });
        }
    }
    callState.turnCount = turnNumber;

    // Race the engine against the turn-budget timeout
    let runtimeResult;
    try {
        runtimeResult = await Promise.race([
            CallRuntime.processTurn(
                state.company.aiAgentSettings || {},
                callState,
                payload.text,
                {
                    company: state.company,
                    callSid: state.callSid,
                    companyId: state.companyId,
                    callerPhone,
                    turnCount: turnNumber,
                    inputTextSource: 'deepgram_live',
                    redis
                }
            ),
            new Promise((_resolve, reject) => {
                setTimeout(() => reject(new Error('turn_budget_exceeded')), DEFAULT_MAX_TURN_MS);
            })
        ]);
    } catch (err) {
        logger.error('[MS] CallRuntime.processTurn failed', {
            callSid: state.callSid?.slice?.(-8),
            error: err.message,
            stack: err.stack
        });
        _appendTrace(state.companyId, state.callSid, 'MS_ENGINE_ERROR', {
            error: err.message,
            turnNumber
        }, turnNumber);
        // Engine failure is recoverable via fallback — caller keeps the call
        await bailToFallback(`engine_error:${err.message}`);
        return;
    }

    // Persist state (best-effort, same merge pattern as Gather path)
    const persistedState = runtimeResult.state || StateStore.persist(callState, StateStore.load(callState));
    persistedState._lastUpdatedTs = new Date().toISOString();
    persistedState._stateKey = redisKey;
    persistedState.turnCount = turnNumber;
    state.callState = persistedState;
    if (redis && redisKey) {
        try {
            await redis.set(redisKey, JSON.stringify(persistedState), { EX: 60 * 60 * 4 });
        } catch (err) {
            logger.warn('[MS] state save failed (non-blocking)', { error: err.message });
        }
    }

    // Flush event buffer + persist trace so Call Console sees the turn
    if (runtimeResult.turnEventBuffer?.length) {
        try {
            await CallRuntime.flushEventBuffer(runtimeResult.turnEventBuffer);
        } catch (_e) { /* noop */ }
        const CallTranscriptV2 = _loadCallTranscriptV2();
        if (CallTranscriptV2) {
            try {
                const traceEntries = runtimeResult.turnEventBuffer.map((ev) => ({
                    kind: `${ev.type || ''}`,
                    turnNumber: Number.isFinite(ev.turn) ? ev.turn : turnNumber,
                    ts: ev.ts || new Date().toISOString(),
                    payload: ev.data || {}
                }));
                await CallTranscriptV2.appendTrace(state.companyId, state.callSid, traceEntries);
            } catch (_e) { /* never block */ }
        }
    }

    // Play the response. If engine produced nothing, log and move on —
    // the caller will speak again and we'll try another turn.
    const responseText = runtimeResult.response
        || runtimeResult.primary?.response
        || runtimeResult.text
        || '';

    if (!responseText || typeof responseText !== 'string' || !responseText.trim()) {
        logger.warn('[MS] engine produced empty response — staying silent', {
            callSid: state.callSid?.slice?.(-8),
            turnNumber
        });
        // C5 metric — still record the engine-side latency; the caller just
        // gets silence, but the turn itself completed.
        try { MSHealth.recordTurnLatency(Date.now() - turnStart); } catch (_e) { /* noop */ }
        return;
    }

    state.playbackCancel = { cancelled: false };
    try {
        const playResult = await OutboundAudioPlayer.play({
            ws,
            streamSid: state.streamSid,
            text: responseText,
            company: state.company,
            callSid: state.callSid,
            ttsSource: 'answer',
            cancelToken: state.playbackCancel
        });
        const engineMs = Date.now() - turnStart - (playResult.synthMs || 0);
        const totalMs = Date.now() - turnStart;
        logger.info('[MS] turn complete', {
            callSid: state.callSid?.slice?.(-8),
            turnNumber,
            engineMs,
            synthMs: playResult.synthMs,
            framesSent: playResult.framesSent,
            totalMs
        });

        // Persist the agent's response as a CONVERSATION_AGENT turn so Call
        // Intelligence's transcript + pipeline trace render identically to the
        // Gather path (same kcCard resolution, same provenance fields).
        _appendConversationTurn(state.companyId, state.callSid, {
            speaker:    'agent',
            kind:       'CONVERSATION_AGENT',
            text:       responseText.trim(),
            turnNumber,
            ts:         new Date(),
            sourceKey:  runtimeResult?.matchSource || 'MEDIA_STREAMS',
            trace: {
                provenance:  runtimeResult?.provenance || null,
                matchSource: runtimeResult?.matchSource || null,
                lane:        runtimeResult?.lane || null,
                kcTrace:     runtimeResult?.kcTrace || null,
                // Mark this agent turn as served via Media Streams so the UI
                // can distinguish MS-delivered audio from <Play>/TwiML paths.
                deliveredVia: 'media-streams',
                synthMs:     typeof playResult.synthMs === 'number' ? playResult.synthMs : null,
                totalMs:     totalMs,
                framesSent:  typeof playResult.framesSent === 'number' ? playResult.framesSent : null
            }
        });

        // C5 metric — full turn latency including synth. This is what the
        // caller actually perceives (DG final → caller hears agent).
        try { MSHealth.recordTurnLatency(totalMs); } catch (_e) { /* noop */ }
    } catch (err) {
        logger.error('[MS] play response failed', {
            callSid: state.callSid?.slice?.(-8),
            error: err.message
        });
    } finally {
        state.playbackCancel = null;
    }
}

/**
 * Handle Twilio 'media' event — forward the audio payload to Deepgram.
 * Twilio sends base64-encoded mulaw 8kHz mono.
 */
function _handleMedia(msg, state) {
    if (!state.dgLive) return;
    const b64 = msg.media?.payload;
    if (!b64) return;
    try {
        const buf = Buffer.from(b64, 'base64');
        state.dgLive.send(buf);
        state.audioFrames += 1;
        if (state.audioFrames === 1 || state.audioFrames % 500 === 0) {
            logger.debug('[MS] audio frames forwarded', {
                callSid: state.callSid?.slice?.(-8),
                frames: state.audioFrames
            });
        }
    } catch (err) {
        logger.warn('[MS] failed to forward media frame', { error: err.message });
    }
}

module.exports = {
    attachMediaStreamServer,
    MS_PATH,
    DEFAULT_MAX_TURN_MS,
    // for tests
    _internals: {
        _handleConnection,
        _handleStart,
        _handleMedia,
        _loadTenantContext,
        _runTurn,
        _redirectCallToFallback,
        _appendTrace,
        _stampSttProvider
    }
};
