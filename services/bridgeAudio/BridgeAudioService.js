/**
 * ============================================================================
 * BRIDGE AUDIO SERVICE
 * ============================================================================
 *
 * Pre-generates and serves cached ElevenLabs MP3 files for bridge filler lines
 * so the runtime can use Twilio <Play> instead of <Say>, ensuring voice
 * consistency between bridge fillers and real agent responses.
 *
 * STORAGE:
 *   public/audio/bridge-lines/*.mp3  (served at GET /audio/bridge-lines/<file>.mp3)
 *
 * DESIGN:
 *   - Deterministic filename: hash of (companyId + text + voice fingerprint)
 *   - File existence = cache hit (no DB storage needed)
 *   - If cached MP3 missing at call-time, runtime falls back to <Pause> (silence)
 *     — never <Say> — to avoid voice mismatch
 *
 * LIFECYCLE:
 *   - Pre-generated when admin saves bridge lines (PATCH agent2 config)
 *   - Regenerated on-demand via admin endpoint
 *   - Invalidated when voice settings change
 *
 * ============================================================================
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { cleanTextForTTS } = require('../../utils/textUtils');
const { synthesizeSpeech } = require('../v2elevenLabsService');
const logger = require('../../utils/logger');

const AUDIO_SUBDIR = 'bridge-lines';
const AUDIO_DIR = path.join(__dirname, '../../public/audio', AUDIO_SUBDIR);

function ensureAudioDir() {
  if (!fs.existsSync(AUDIO_DIR)) {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
  }
}

function normalizeText(text) {
  const cleaned = cleanTextForTTS(`${text || ''}`);
  return cleaned.replace(/\s+/g, ' ').trim();
}

function voiceFingerprint(voiceSettings = {}) {
  return {
    voiceId: voiceSettings.voiceId || null,
    stability: voiceSettings.stability ?? null,
    similarityBoost: voiceSettings.similarityBoost ?? null,
    styleExaggeration: voiceSettings.styleExaggeration ?? null,
    aiModel: voiceSettings.aiModel || null
  };
}

function computeHash({ companyId, text, voiceSettings }) {
  const payload = {
    v: 1,
    companyId: `${companyId || ''}`.trim(),
    text: normalizeText(text),
    voice: voiceFingerprint(voiceSettings)
  };
  const stable = JSON.stringify(payload);
  return crypto.createHash('sha256').update(stable).digest('hex');
}

function buildFileName({ companyId, hash }) {
  const safeCompany = `${companyId || 'unknown'}`.replace(/[^a-zA-Z0-9]/g, '').slice(0, 24) || 'unknown';
  const short = `${hash}`.slice(0, 16);
  return `bridge_${safeCompany}_${short}.mp3`;
}

function buildRelativeUrl(fileName) {
  return `/audio/${AUDIO_SUBDIR}/${fileName}`;
}

function getFilePath(fileName) {
  return path.join(AUDIO_DIR, fileName);
}

/**
 * Check whether a cached MP3 exists for a given bridge line + voice combo.
 * Returns { exists, hash, fileName, filePath, url, normalizedText }.
 */
function getStatus({ companyId, text, voiceSettings }) {
  ensureAudioDir();
  const hash = computeHash({ companyId, text, voiceSettings });
  const fileName = buildFileName({ companyId, hash });
  const filePath = getFilePath(fileName);
  const exists = fs.existsSync(filePath);
  return {
    exists,
    hash,
    fileName,
    filePath,
    url: buildRelativeUrl(fileName),
    normalizedText: normalizeText(text)
  };
}

/**
 * Generate a single bridge line MP3 via ElevenLabs and cache it to disk.
 * No-ops if file already exists (unless force=true).
 */
async function generate({ companyId, text, company, voiceSettings, force = false }) {
  if (!companyId) throw new Error('companyId required');
  if (!company) throw new Error('company required');

  const status = getStatus({ companyId, text, voiceSettings });
  if (status.exists && !force) {
    return { ...status, generated: false };
  }

  if (!voiceSettings?.voiceId) {
    const err = new Error('No ElevenLabs voiceId configured — cannot generate bridge audio');
    err.code = 'VOICE_NOT_CONFIGURED';
    throw err;
  }

  const normalizedText = status.normalizedText;
  if (!normalizedText) {
    const err = new Error('Bridge line text is empty');
    err.code = 'TEXT_REQUIRED';
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

/**
 * Generate MP3s for ALL bridge lines of a company (batch).
 * Skips lines that already have a cached file (unless force=true).
 * Returns per-line results so the caller can report partial failures.
 */
async function generateAll({ companyId, lines, company, voiceSettings, force = false }) {
  if (!companyId || !company) {
    throw new Error('companyId and company required');
  }

  const cleanLines = (Array.isArray(lines) ? lines : [])
    .map(s => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean);

  if (cleanLines.length === 0) {
    return { total: 0, generated: 0, skipped: 0, failed: 0, results: [] };
  }

  const results = [];
  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const line of cleanLines) {
    try {
      const result = await generate({ companyId, text: line, company, voiceSettings, force });
      results.push({ line, ...result, error: null });
      if (result.generated) generated++;
      else skipped++;
    } catch (err) {
      failed++;
      results.push({
        line,
        generated: false,
        error: err.message,
        code: err.code || null
      });
      logger.warn('[BridgeAudio] Failed to generate bridge line', {
        companyId: `${companyId}`.slice(-8),
        line: line.substring(0, 60),
        error: err.message
      });
    }
  }

  return { total: cleanLines.length, generated, skipped, failed, results };
}

/**
 * Build a full absolute audio URL for a bridge line (for TwiML <Play>).
 * Returns null if no cached file exists.
 */
function getAudioUrl({ companyId, text, voiceSettings, hostHeader }) {
  const status = getStatus({ companyId, text, voiceSettings });
  if (!status.exists) return null;
  return `https://${hostHeader}${status.url}`;
}

/**
 * Remove all cached bridge audio for a company.
 * Used when voice settings change (voice ID, stability, etc.).
 */
function purgeCompany(companyId) {
  ensureAudioDir();
  const prefix = `bridge_${`${companyId || ''}`.replace(/[^a-zA-Z0-9]/g, '').slice(0, 24)}_`;
  let removed = 0;
  try {
    const files = fs.readdirSync(AUDIO_DIR);
    for (const f of files) {
      if (f.startsWith(prefix) && f.endsWith('.mp3')) {
        fs.unlinkSync(path.join(AUDIO_DIR, f));
        removed++;
      }
    }
  } catch (err) {
    logger.warn('[BridgeAudio] purgeCompany failed', { companyId, error: err.message });
  }
  return { removed };
}

module.exports = {
  AUDIO_SUBDIR,
  getStatus,
  generate,
  generateAll,
  getAudioUrl,
  purgeCompany
};
