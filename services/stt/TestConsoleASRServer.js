const logger = require('../../utils/logger');
const jwt = require('jsonwebtoken');
const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');
const DeepgramService = require('./DeepgramService');

// NOTE: ws is a transitive dep of @deepgram/sdk; available at runtime.
const { WebSocketServer } = require('ws');

function verifyAuthToken(token) {
    if (!token) return null;
    try {
        return jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
        logger.warn('[TEST-CONSOLE-ASR] Invalid auth token', { error: err.message });
        return null;
    }
}

function buildDeepgramLiveClient() {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
        throw new Error('DEEPGRAM_API_KEY not configured');
    }

    return createClient(apiKey);
}

/**
 * Attach WebSocket endpoint for Test Console production ASR.
 * Path: /api/test-console/asr
 * - Accepts 16kHz mono PCM (Int16) audio frames.
 * - Streams to Deepgram with the SAME model/config as Twilio (nova-2, smart_format, punctuate, interim).
 * - Emits { type: 'partial'|'final', text, confidence, asrProvider, source } to the browser.
 */
function attachTestConsoleASRServer(server) {
    if (!process.env.DEEPGRAM_API_KEY) {
        logger.warn('[TEST-CONSOLE-ASR] Deepgram disabled (missing DEEPGRAM_API_KEY) - ASR WS will not be registered');
        return;
    }

    const dgClient = buildDeepgramLiveClient();
    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
        try {
            const url = new URL(req.url, 'http://localhost');
            if (url.pathname !== '/api/test-console/asr') {
                return;
            }
            wss.handleUpgrade(req, socket, head, (ws) => {
                wss.emit('connection', ws, req, url.searchParams);
            });
        } catch (err) {
            logger.error('[TEST-CONSOLE-ASR] Upgrade failed', { error: err.message });
            socket.destroy();
        }
    });

    wss.on('connection', async (ws, req, searchParams) => {
        const companyId = searchParams.get('companyId') || null;
        const token = searchParams.get('token') || null;
        const authHeader = req.headers['authorization'] || '';
        const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : null;
        const decoded = verifyAuthToken(token || bearer);

        logger.info('[TEST-CONSOLE-ASR] Connection opened', {
            companyId,
            hasToken: Boolean(token || bearer),
            userId: decoded?.userId || decoded?._id || null
        });

        let dgLive;
        try {
            // Reuse the SAME config as Twilio, only overriding encoding/sample_rate for browser PCM.
            const liveConfig = DeepgramService.getLiveConnectionConfig({
                encoding: 'linear16',
                sample_rate: '16000',
                channels: '1'
            });

            dgLive = dgClient.listen.live({
                model: 'nova-2',
                language: 'en-US',
                smart_format: true,
                punctuate: true,
                interim_results: true,
                endpointing: 300,
                vad_events: true,
                encoding: 'linear16',
                sample_rate: 16000,
                channels: 1
            });
        } catch (err) {
            logger.error('[TEST-CONSOLE-ASR] Failed to start Deepgram stream', { error: err.message });
            ws.send(JSON.stringify({ type: 'error', error: 'Deepgram unavailable' }));
            ws.close();
            return;
        }

        const closeGracefully = (reason) => {
            try { dgLive?.finish(); } catch (e) { /* ignore */ }
            if (ws.readyState === ws.OPEN) {
                ws.close();
            }
            logger.info('[TEST-CONSOLE-ASR] Connection closed', { reason });
        };

        dgLive.addListener(LiveTranscriptionEvents.TranscriptReceived, (dgData) => {
            const alt = dgData?.channel?.alternatives?.[0];
            const transcript = alt?.transcript || '';
            if (!transcript) return;
            const isFinal = dgData?.is_final === true || dgData?.speech_final === true;
            const payload = {
                type: isFinal ? 'final' : 'partial',
                text: transcript,
                confidence: alt?.confidence ?? null,
                asrProvider: 'deepgram',
                source: 'test_console',
                companyId
            };
            if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify(payload));
            }
        });

        dgLive.addListener(LiveTranscriptionEvents.Error, (err) => {
            logger.error('[TEST-CONSOLE-ASR] Deepgram error', { error: err?.message || String(err) });
            if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({ type: 'error', error: err?.message || 'Deepgram error' }));
            }
            closeGracefully('deepgram_error');
        });

        dgLive.addListener(LiveTranscriptionEvents.Close, () => {
            closeGracefully('deepgram_closed');
        });

        ws.on('message', (data) => {
            try {
                if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
                    dgLive.send(data);
                }
            } catch (err) {
                logger.error('[TEST-CONSOLE-ASR] Failed to forward audio chunk', { error: err.message });
            }
        });

        ws.on('close', () => closeGracefully('client_closed'));
        ws.on('error', (err) => {
            logger.error('[TEST-CONSOLE-ASR] WS error', { error: err.message });
            closeGracefully('ws_error');
        });
    });

    logger.info('[TEST-CONSOLE-ASR] WebSocket endpoint registered at /api/test-console/asr');
}

module.exports = { attachTestConsoleASRServer };
