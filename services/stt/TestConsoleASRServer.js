const logger = require('../../utils/logger');
const jwt = require('jsonwebtoken');
const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');
const DeepgramService = require('./DeepgramService');
const Company = require('../../models/v2Company');

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

function clampNumber(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
}

async function getEndpointingMs(companyId) {
    if (!companyId) return 300;
    try {
        const company = await Company.findById(companyId)
            .select('callExperienceSettings aiAgentSettings.callExperience')
            .lean();
        const callExperience = company?.callExperienceSettings || company?.aiAgentSettings?.callExperience || {};
        const endSilenceSeconds = Number(callExperience?.endSilenceTimeout);
        if (!Number.isFinite(endSilenceSeconds)) return 300;
        return clampNumber(Math.round(endSilenceSeconds * 1000), 200, 5000);
    } catch (err) {
        logger.warn('[TEST-CONSOLE-ASR] Failed to load callExperience for endpointing', {
            companyId,
            error: err.message
        });
        return 300;
    }
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
        let audioChunks = 0;
        const endpointingMs = await getEndpointingMs(companyId);
        try {
            // Reuse the SAME config as Twilio, only overriding encoding/sample_rate for browser PCM.
            const liveConfig = DeepgramService.getLiveConnectionConfig({
                encoding: 'linear16',
                sample_rate: '16000',
                channels: '1',
                endpointing: String(endpointingMs)
            });
            if (!liveConfig?.url) {
                throw new Error('Deepgram live config missing url');
            }

            dgLive = dgClient.listen.live({
                model: 'nova-2',
                language: 'en-US',
                smart_format: true,
                punctuate: true,
                interim_results: true,
                endpointing: endpointingMs,
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

        dgLive.addListener(LiveTranscriptionEvents.Open, () => {
            logger.info('[TEST-CONSOLE-ASR] Deepgram stream open', { companyId });
        });

        // Deepgram SDK v3 emits transcripts on LiveTranscriptionEvents.Transcript ('Results')
        dgLive.addListener(LiveTranscriptionEvents.Transcript, (dgData) => {
            const alt = dgData?.channel?.alternatives?.[0];
            const transcript = alt?.transcript || '';
            if (!transcript) return;
            // IMPORTANT:
            // - Deepgram can emit `is_final=true` many times within one utterance.
            // - `speech_final=true` indicates endpointing/VAD decided the utterance is complete.
            // For Test Console UX parity (and to avoid cutting users off mid-sentence),
            // only treat `speech_final` as a true "final" that should be sent to the engine.
            const isSpeechFinal = dgData?.speech_final === true;
            const payload = {
                type: isSpeechFinal ? 'final' : 'partial',
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
                    audioChunks += 1;
                    dgLive.send(data);
                    if (audioChunks === 1 || audioChunks % 50 === 0) {
                        logger.debug('[TEST-CONSOLE-ASR] Forwarding audio to Deepgram', { companyId, audioChunks });
                    }
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
