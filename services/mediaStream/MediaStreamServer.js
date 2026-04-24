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
 *   4. Check DeepgramCircuitBreaker — if open, close WS (Twilio falls back)
 *   5. Open Deepgram live stream with resolved model + keywords
 *   6. Pipe mulaw frames: Twilio 'media' → base64-decode → DG.send()
 *   7. Feed Deepgram events into TurnLifecycleAdapter
 *   8. On adapter onFinal → log event (C3 stops here; C4 wires CallRuntime)
 *   9. On Twilio 'stop' or any error → close both WS ends, record state
 *
 * This commit (C3) is wiring-only. It does NOT yet change any TwiML and is
 * NOT yet reachable from a real call — no route emits <Connect><Stream> to
 * this WSS endpoint until C4. This keeps the commit safe to deploy.
 *
 * @module services/mediaStream/MediaStreamServer
 * @version 1.0.0
 */

'use strict';

const logger = require('../../utils/logger');
const { WebSocketServer } = require('ws');
const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');

const DeepgramService = require('../stt/DeepgramService');
const ConfigResolver = require('./ConfigResolver');
const VocabularyResolver = require('./VocabularyResolver');
const DeepgramCircuitBreaker = require('./DeepgramCircuitBreaker');
const TurnLifecycleAdapter = require('./TurnLifecycleAdapter');

// Lazy-load models so this file can be required in unit tests without a DB
// connection. Resolution happens per-connection on first use.
function _loadCompanyModel() {
    return require('../../models/v2Company');
}
function _loadAdminSettingsModel() {
    return require('../../models/AdminSettings');
}

// Path Twilio will stream to (wired in C4's route emitter).
const MS_PATH = '/api/twilio/media-stream';

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
        company = await Company.findById(companyId)
            .select('_id companyName trade aiAgentSettings.agent2')
            .lean();
    } catch (err) {
        logger.warn('[MS] Failed to load company', { companyId, error: err.message });
    }
    try {
        const AdminSettings = _loadAdminSettingsModel();
        // AdminSettings is a singleton doc pattern — same as other services
        // that read globalHub. Use lean() for speed.
        adminSettings = await AdminSettings.findOne({}).lean();
    } catch (err) {
        logger.warn('[MS] Failed to load AdminSettings', { error: err.message });
    }
    return { company, adminSettings };
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
 * opens Deepgram, drives adapter.
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
        audioFrames: 0,
        openedAt: Date.now(),
        closed: false
    };

    const ctx = { remote: req.socket?.remoteAddress || 'unknown' };
    logger.info('[MS] Connection opened', ctx);

    // Always define a single safe close path.
    const closeAll = (reason) => {
        if (state.closed) return;
        state.closed = true;
        try { state.dgLive?.finish(); } catch (_e) { /* noop */ }
        try {
            if (ws.readyState === ws.OPEN) ws.close();
        } catch (_e) { /* noop */ }
        logger.info('[MS] Connection closed', {
            reason,
            streamSid: state.streamSid,
            callSid: state.callSid,
            companyId: state.companyId,
            audioFrames: state.audioFrames,
            durationMs: Date.now() - state.openedAt
        });
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
                await _handleStart(msg, state, ws, dgClient);
                break;

            case 'media':
                _handleMedia(msg, state);
                break;

            case 'mark':
                // Twilio echoes back mark events we sent to track TTS playback completion (C4).
                break;

            case 'dtmf':
                // Caller pressed a key. Not wired in C3 — logged for observability.
                logger.debug('[MS] DTMF received', { digit: msg.dtmf?.digit, callSid: state.callSid });
                break;

            case 'stop':
                closeAll('twilio_stop');
                break;

            default:
                // Unknown event type — ignore silently (Twilio may add new ones).
        }
    });

    ws.on('close', () => closeAll('client_close'));
    ws.on('error', (err) => {
        logger.error('[MS] WS error', { error: err.message });
        closeAll('ws_error');
    });
}

/**
 * Handle Twilio 'start' event — this carries the CustomParameters we need.
 */
async function _handleStart(msg, state, ws, dgClient) {
    state.streamSid = msg.start?.streamSid || null;
    state.callSid = msg.start?.callSid || null;

    const params = msg.start?.customParameters || {};
    state.companyId = params.companyId || null;

    if (!state.companyId) {
        logger.warn('[MS] start event missing companyId', { streamSid: state.streamSid });
        try { ws.send(JSON.stringify({ event: 'error', reason: 'missing_companyId' })); } catch (_e) { /* noop */ }
        try { ws.close(); } catch (_e) { /* noop */ }
        return;
    }

    logger.info('[MS] Twilio stream started', {
        streamSid: state.streamSid,
        callSid: state.callSid,
        companyId: state.companyId
    });

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
        try { ws.send(JSON.stringify({ event: 'error', reason: 'deepgram_open_failed' })); } catch (_e) { /* noop */ }
        try { ws.close(); } catch (_e) { /* noop */ }
        return;
    }

    // Build adapter + wire Deepgram events → adapter → (C4) engine
    state.adapter = new TurnLifecycleAdapter({ logger });

    state.adapter.on('onPartial', (payload) => {
        // Per-partial logging is too noisy — only log samples. Full
        // debugging visibility happens in the C5 health endpoint.
        if (payload.kind === 'interim_committed') {
            logger.debug('[MS] partial committed', {
                callSid: state.callSid,
                text: payload.text?.slice(0, 60)
            });
        }
    });

    state.adapter.on('onFinal', (payload) => {
        logger.info('[MS] 🎤 Turn finalised', {
            callSid: state.callSid,
            companyId: state.companyId,
            turnIndex: payload.turnIndex,
            reason: payload.reason,
            text: payload.text,
            confidence: payload.confidence
        });
        // C3 stops here. C4 will:
        //   const CallRuntime = require('../engine/CallRuntime');
        //   await CallRuntime.processTurn({ speechText: payload.text, confidence, callState, context });
        //   then send TTS back via OutboundAudioPlayer.
    });

    state.adapter.on('onBargeIn', (_payload) => {
        logger.info('[MS] barge-in detected', { callSid: state.callSid });
        // C4 will cut TTS here.
    });

    // Deepgram event handlers
    state.dgLive.addListener(LiveTranscriptionEvents.Open, async () => {
        logger.info('[MS] Deepgram stream open', { callSid: state.callSid, companyId: state.companyId });
        await DeepgramCircuitBreaker.recordSuccess();
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
        logger.error('[MS] Deepgram error', { error: err?.message || String(err), callSid: state.callSid });
        await DeepgramCircuitBreaker.recordFailure(`dg_error:${err?.message || 'unknown'}`);
        try { ws.close(); } catch (_e) { /* noop */ }
    });

    state.dgLive.addListener(LiveTranscriptionEvents.Close, () => {
        logger.info('[MS] Deepgram stream closed', { callSid: state.callSid });
        try { ws.close(); } catch (_e) { /* noop */ }
    });
}

/**
 * Handle Twilio 'media' event — forward the audio payload to Deepgram.
 * Twilio sends base64-encoded mulaw 8kHz mono.
 */
function _handleMedia(msg, state) {
    if (!state.dgLive) return; // stream not yet open
    const b64 = msg.media?.payload;
    if (!b64) return;
    try {
        const buf = Buffer.from(b64, 'base64');
        state.dgLive.send(buf);
        state.audioFrames += 1;
        if (state.audioFrames === 1 || state.audioFrames % 250 === 0) {
            logger.debug('[MS] audio frames forwarded', {
                callSid: state.callSid,
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
    // for tests
    _internals: {
        _handleConnection,
        _handleStart,
        _handleMedia,
        _loadTenantContext
    }
};
