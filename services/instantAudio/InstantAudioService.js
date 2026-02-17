/**
 * ============================================================================
 * INSTANT AUDIO SERVICE (V1)
 * ============================================================================
 *
 * PURPOSE:
 * Generate and serve pre-built MP3 files for "instant response" lines so the
 * runtime can use Twilio <Play> without paying ElevenLabs latency each time.
 *
 * INITIAL USE CASE:
 * - GreetingInterceptor responses (Front Desk Behavior → Greeting Rules)
 *
 * DESIGN:
 * - Deterministic filename based on (companyId + kind + cleanedText + voice fingerprint)
 * - No DB storage required; file existence is the cache.
 * - Safe fallback: runtime should still synthesize if file missing.
 *
 * STORAGE:
 * - public/audio/instant-lines/*.mp3  (served at GET /audio/instant-lines/<file>.mp3)
 *
 * ============================================================================
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { cleanTextForTTS } = require('../../utils/textUtils');
const { synthesizeSpeech } = require('../v2elevenLabsService');

const AUDIO_SUBDIR = 'instant-lines';
const AUDIO_DIR = path.join(__dirname, '../../public/audio', AUDIO_SUBDIR);

function ensureAudioDir() {
  if (!fs.existsSync(AUDIO_DIR)) {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
  }
}

function normalizeKind(kind) {
  return `${kind || ''}`.trim().toUpperCase();
}

function normalizeText(text) {
  const cleaned = cleanTextForTTS(`${text || ''}`);
  return cleaned.replace(/\s+/g, ' ').trim();
}

function voiceFingerprint(voiceSettings = {}) {
  // Only include fields that materially change synthesized audio output.
  return {
    voiceId: voiceSettings.voiceId || null,
    stability: voiceSettings.stability ?? null,
    similarityBoost: voiceSettings.similarityBoost ?? null,
    styleExaggeration: voiceSettings.styleExaggeration ?? null,
    aiModel: voiceSettings.aiModel || null
  };
}

function computeHash({ companyId, kind, text, voiceSettings }) {
  const payload = {
    v: 1,
    companyId: `${companyId || ''}`.trim(),
    kind: normalizeKind(kind),
    text: normalizeText(text),
    voice: voiceFingerprint(voiceSettings)
  };
  const stable = JSON.stringify(payload);
  return crypto.createHash('sha256').update(stable).digest('hex');
}

function buildFileName({ companyId, kind, hash }) {
  const safeCompany = `${companyId || 'unknown'}`.replace(/[^a-zA-Z0-9]/g, '').slice(0, 24) || 'unknown';
  const safeKind = normalizeKind(kind).replace(/[^A-Z0-9_]/g, '').slice(0, 40) || 'LINE';
  const short = `${hash}`.slice(0, 16);
  return `fd_${safeKind}_${safeCompany}_${short}.mp3`;
}

function buildRelativeUrl(fileName) {
  return `/audio/${AUDIO_SUBDIR}/${fileName}`;
}

function getFilePath(fileName) {
  return path.join(AUDIO_DIR, fileName);
}

function getStatus({ companyId, kind, text, voiceSettings }) {
  ensureAudioDir();
  const hash = computeHash({ companyId, kind, text, voiceSettings });
  const fileName = buildFileName({ companyId, kind, hash });
  const filePath = getFilePath(fileName);
  const exists = fs.existsSync(filePath);
  return { exists, hash, fileName, filePath, url: buildRelativeUrl(fileName), normalizedText: normalizeText(text), kind: normalizeKind(kind) };
}

async function generate({ companyId, kind, text, company, voiceSettings, force = false }) {
  if (!companyId) {
    throw new Error('companyId required');
  }
  if (!company) {
    throw new Error('company required');
  }

  const status = getStatus({ companyId, kind, text, voiceSettings });
  if (status.exists && !force) {
    return { ...status, generated: false };
  }

  if (!voiceSettings?.voiceId) {
    const err = new Error('No ElevenLabs voiceId configured for this company');
    err.code = 'VOICE_NOT_CONFIGURED';
    throw err;
  }

  const normalizedText = status.normalizedText;
  if (!normalizedText) {
    const err = new Error('Text is required');
    err.code = 'TEXT_REQUIRED';
    throw err;
  }

  if (normalizedText.length > 420) {
    const err = new Error('Text too long for instant audio (max 420 chars)');
    err.code = 'TEXT_TOO_LONG';
    throw err;
  }

  ensureAudioDir();

  const buffer = await synthesizeSpeech({
    text: normalizedText,
    voiceId: voiceSettings.voiceId,
    stability: voiceSettings.stability,
    similarity_boost: voiceSettings.similarityBoost,
    style: voiceSettings.styleExaggeration,
    model_id: voiceSettings.aiModel,
    company,
    output_format: 'mp3_44100_128'
  });

  fs.writeFileSync(status.filePath, buffer);

  return {
    ...status,
    generated: true,
    bytes: buffer?.length || null
  };
}

function remove({ companyId, kind, text, voiceSettings }) {
  const status = getStatus({ companyId, kind, text, voiceSettings });
  if (status.exists) {
    fs.unlinkSync(status.filePath);
    return { ...status, removed: true };
  }
  return { ...status, removed: false };
}

module.exports = {
  AUDIO_SUBDIR,
  getStatus,
  generate,
  remove
};

