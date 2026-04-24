/**
 * routes/mediaStream.js — HTTP bootstrap for Media Streams (C4/5)
 *
 * TwiML endpoints that emit <Connect><Stream> for Twilio. The WebSocket
 * endpoint itself lives in services/mediaStream/MediaStreamServer.js
 * (mounted on the HTTP upgrade event by index.js).
 *
 * Endpoints:
 *   POST /api/twilio/media-stream/:companyId/bootstrap
 *     → returns <Connect><Stream url="wss://HOST/api/twilio/media-stream">
 *       with CustomParameters {companyId, callSid, from, to}. Used when
 *       the main /voice handler decides to route a call through Media
 *       Streams (flag on + circuit closed).
 *
 *   POST /api/twilio/media-stream/:companyId/fallback
 *     → returns <Redirect> to the standard v2-agent-respond route.
 *       Used as the mid-call safety net when the WebSocket leg errors
 *       out and the call needs to continue via Twilio Gather.
 *
 * Multi-tenant: every TwiML emitted here is per-company via :companyId
 * in the path. Nothing hardcoded.
 *
 * Platform rule: these routes are *thin* — they only emit TwiML. All
 * real work (tenant load, config resolve, Deepgram connect, engine
 * call) happens inside MediaStreamServer on the WS side.
 *
 * @module routes/mediaStream
 * @version 1.0.0
 */

'use strict';

const express = require('express');
const twilio = require('twilio');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * Build the WSS URL for the MediaStreamServer. Reads the incoming request
 * host so it works identically on localhost, Render preview, and prod.
 * No hardcoded hostnames — platform rule.
 */
function _buildWssUrl(req) {
    const host = req.get('host');
    const proto = req.secure || req.get('x-forwarded-proto') === 'https' ? 'wss' : 'ws';
    return `${proto}://${host}/api/twilio/media-stream`;
}

/**
 * POST /api/twilio/media-stream/:companyId/bootstrap
 *
 * Emits <Connect><Stream> TwiML with CustomParameters so the WebSocket
 * handler can load the right tenant when Twilio opens the connection.
 *
 * Twilio semantics: <Connect> is terminal — once Twilio dials the stream,
 * every subsequent media event (inbound audio + TTS responses back) flows
 * through the WebSocket. No Gather runs. Greeting playback happens server-
 * side via OutboundAudioPlayer after the WS handshake completes.
 */
router.post('/:companyId/bootstrap', (req, res) => {
    const { companyId } = req.params;
    const callSid = req.body.CallSid || '';
    const from = req.body.From || '';
    const to = req.body.To || '';

    const twiml = new twilio.twiml.VoiceResponse();
    const wssUrl = _buildWssUrl(req);

    const connect = twiml.connect();
    const stream = connect.stream({ url: wssUrl });
    stream.parameter({ name: 'companyId', value: companyId });
    stream.parameter({ name: 'callSid', value: callSid });
    stream.parameter({ name: 'from', value: from });
    stream.parameter({ name: 'to', value: to });

    logger.info('[MS-ROUTE] bootstrap TwiML emitted', {
        companyId,
        callSid: callSid ? callSid.slice(-8) : null,
        wssUrl
    });

    res.type('text/xml');
    res.send(twiml.toString());
});

/**
 * POST /api/twilio/media-stream/:companyId/fallback
 *
 * Mid-call safety net. When MediaStreamServer detects a condition that
 * makes continuing via WebSocket unsafe (Deepgram circuit opens mid-call,
 * unexpected WS drop, turn latency blown through max_turn_timeout_ms),
 * it closes the WS and Twilio reacts by posting here. We redirect to the
 * existing Gather-based respond route so the call lives on.
 *
 * Caller experience: one unusual pause, then Twilio Gather takes over
 * for the remainder of the call.
 */
router.post('/:companyId/fallback', (req, res) => {
    const { companyId } = req.params;
    const callSid = req.body.CallSid || '';

    logger.warn('[MS-ROUTE] mid-call fallback redirect', {
        companyId,
        callSid: callSid ? callSid.slice(-8) : null
    });

    const twiml = new twilio.twiml.VoiceResponse();
    // Redirect into the existing v2-agent-respond route. That route is the
    // main Gather loop and will emit a fresh <Gather> so the caller keeps
    // talking to the agent without a hang-up.
    twiml.redirect({ method: 'POST' }, `/api/twilio/v2-agent-respond/${companyId}`);

    res.type('text/xml');
    res.send(twiml.toString());
});

module.exports = router;
