/**
 * routes/voicePreview.js
 *
 * POST /api/voice/polly-preview
 *
 * Server-side synthesis of a short sample using Amazon Polly so the admin UI
 * can preview the selected voice BEFORE saving or making a test call.
 *
 * Design notes (Apr 24, 2026):
 * - The live call path does NOT need AWS credentials: Twilio renders Polly
 *   server-side via <Say voice="Polly.X-Neural">. This preview endpoint is
 *   independent — it uses the AWS SDK to synthesize directly.
 * - If AWS credentials are NOT configured on Render, this endpoint returns
 *   503 with a clear message. The live call path is unaffected.
 * - We return audio/mpeg (MP3) buffered — ~30KB for a one-sentence preview,
 *   no streaming needed.
 *
 * Auth:
 * - Requires the authed admin session (same middleware as every other
 *   /api/company/* route). We don't gate by tenant here because preview
 *   doesn't touch any tenant data.
 *
 * Request body: { voiceId: "Polly.Matthew-Neural", engine: "neural", text: "..." }
 *   voiceId  — must match the platform Polly catalog (config/pollyVoiceCatalog.js)
 *   engine   — "neural" | "standard"
 *   text     — 1–400 chars, plain text (no SSML in this iteration)
 *
 * Response: audio/mpeg body on success; JSON error on failure.
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { isValidPollyVoice, resolvePollyVoice } = require('../config/pollyVoiceCatalog');

// Lazy-load the SDK so missing creds don't crash app boot; surface the error
// only when a preview is actually requested.
let _pollyClientPromise = null;
function _getPollyClient() {
    if (_pollyClientPromise) return _pollyClientPromise;
    _pollyClientPromise = (async () => {
        const { PollyClient } = require('@aws-sdk/client-polly');
        const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
        // The default credential provider chain picks up env vars,
        // ~/.aws/credentials, or IAM role automatically. No need to hand-feed.
        return new PollyClient({ region });
    })();
    return _pollyClientPromise;
}

function _awsConfigured() {
    return !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

router.post('/polly-preview', express.json({ limit: '10kb' }), async (req, res) => {
    try {
        const body = req.body || {};
        const voiceId = String(body.voiceId || '').trim();
        const engine  = String(body.engine || 'neural').trim();
        const text    = String(body.text || '').trim();

        // ── Validate ────────────────────────────────────────────────────
        if (!voiceId || !isValidPollyVoice(voiceId)) {
            return res.status(400).json({
                error: 'invalid_voice',
                message: `voiceId '${voiceId}' is not in the platform Polly catalog.`
            });
        }
        if (!['neural', 'standard'].includes(engine)) {
            return res.status(400).json({
                error: 'invalid_engine',
                message: `engine must be 'neural' or 'standard', got '${engine}'.`
            });
        }
        if (!text || text.length < 1) {
            return res.status(400).json({
                error: 'invalid_text',
                message: 'text is required.'
            });
        }
        if (text.length > 400) {
            return res.status(400).json({
                error: 'text_too_long',
                message: 'Preview text must be 400 characters or fewer.'
            });
        }

        // ── AWS creds check (graceful degrade) ──────────────────────────
        if (!_awsConfigured()) {
            return res.status(503).json({
                error: 'aws_not_configured',
                message: 'Voice preview requires AWS Polly credentials on the server. Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_REGION in the Render environment to enable preview. (Live calls still work — Twilio renders Polly independently.)'
            });
        }

        // ── Resolve the catalog entry to get the bare Polly VoiceId ─────
        // Our catalog ids are like "Polly.Matthew-Neural"; AWS expects just "Matthew"
        // plus Engine='neural' as a separate field.
        const entry = resolvePollyVoice(voiceId);
        if (!entry) {
            return res.status(400).json({
                error: 'invalid_voice',
                message: `Could not resolve catalog entry for '${voiceId}'.`
            });
        }
        // Extract bare voice name: "Polly.Matthew-Neural" → "Matthew"
        const bareVoice = voiceId.replace(/^Polly\./, '').replace(/-(Neural|Standard)$/i, '');

        // ── Synthesize ─────────────────────────────────────────────────
        const { SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');
        const client = await _getPollyClient();

        // AWS LanguageCode uses BCP-47 form ("en-US", "en-IN"); our catalog
        // stores this under `accent`. Fall back to en-US if missing.
        const languageCode = (entry.accent && /^[a-z]{2}-[A-Z]{2}$/.test(entry.accent))
            ? entry.accent : 'en-US';

        const cmd = new SynthesizeSpeechCommand({
            Text: text,
            TextType: 'text',
            VoiceId: bareVoice,
            OutputFormat: 'mp3',
            Engine: engine,
            LanguageCode: languageCode
        });

        const synthRes = await client.send(cmd);
        if (!synthRes.AudioStream) {
            return res.status(502).json({
                error: 'polly_no_audio',
                message: 'Polly returned no audio stream.'
            });
        }

        // Stream → Buffer (AudioStream is a Node.js Readable in the SDK v3)
        const chunks = [];
        for await (const chunk of synthRes.AudioStream) {
            chunks.push(chunk);
        }
        const audio = Buffer.concat(chunks);

        res.set('Content-Type', 'audio/mpeg');
        res.set('Content-Length', String(audio.length));
        res.set('Cache-Control', 'no-store');
        return res.status(200).send(audio);

    } catch (err) {
        // Classify common AWS errors for friendlier UI messages.
        const name = err?.name || err?.Code || '';
        const msg  = err?.message || String(err);
        console.error('[voicePreview] synth failed:', name, msg);

        if (/InvalidSignatureException|UnrecognizedClientException|SignatureDoesNotMatch/i.test(name)) {
            return res.status(401).json({
                error: 'aws_auth_failed',
                message: 'AWS credentials are invalid or expired. Check AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY on Render.'
            });
        }
        if (/AccessDenied/i.test(name)) {
            return res.status(403).json({
                error: 'aws_access_denied',
                message: 'The AWS IAM user/role lacks polly:SynthesizeSpeech permission.'
            });
        }
        if (/ThrottlingException|TooManyRequests/i.test(name)) {
            return res.status(429).json({
                error: 'aws_throttled',
                message: 'AWS Polly is throttling this request. Retry in a moment.'
            });
        }
        return res.status(500).json({
            error: 'synth_failed',
            message: msg || 'Unknown synthesis error.'
        });
    }
});

module.exports = router;
