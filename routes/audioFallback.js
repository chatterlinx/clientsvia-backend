/**
 * ============================================================================
 * AUDIO FALLBACK ROUTE - MongoDB-backed audio serving
 * ============================================================================
 * 
 * PROBLEM:
 * Render uses ephemeral storage - audio files wiped on redeploy
 * With 100+ clients, losing all audio on every deploy is unacceptable
 * 
 * SOLUTION:
 * Bulletproof 2-tier audio serving:
 * 1. Try disk first (fast - cached)
 * 2. Fallback to MongoDB if missing (permanent storage)
 * 3. Restore disk cache from MongoDB (rebuild cache)
 * 
 * This ensures 100% audio availability even after deploys.
 * 
 * ROUTES:
 * - GET /audio-safe/instant-lines/:filename
 * - GET /audio-safe/greetings/:filename
 * - GET /audio-safe/:filename
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

// Models that store audio in MongoDB
const TriggerAudio = require('../models/TriggerAudio');
const GreetingAudio = require('../models/GreetingAudio');

const PUBLIC_AUDIO_DIR = path.join(__dirname, '../public/audio');
const INSTANT_LINES_DIR = path.join(PUBLIC_AUDIO_DIR, 'instant-lines');

function normalizeAudioBuffer(audioData) {
  if (!audioData) return null;
  if (Buffer.isBuffer(audioData)) return audioData;
  if (audioData instanceof Uint8Array) return Buffer.from(audioData);
  if (audioData instanceof ArrayBuffer) return Buffer.from(audioData);
  if (audioData.buffer) {
    if (Buffer.isBuffer(audioData.buffer)) return audioData.buffer;
    if (audioData.buffer instanceof ArrayBuffer) return Buffer.from(audioData.buffer);
  }
  return null;
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * BULLETPROOF AUDIO SERVING - Disk + MongoDB Fallback
 * ════════════════════════════════════════════════════════════════════════════
 */
async function serveAudioWithFallback(req, res, audioPath, mongoFallback) {
  try {
    // ════════════════════════════════════════════════════════════════════════
    // TIER 1: Try disk first (fast path)
    // ════════════════════════════════════════════════════════════════════════
    if (fs.existsSync(audioPath)) {
      logger.debug('[AudioFallback] Serving from disk', { path: audioPath });
      return res.sendFile(audioPath);
    }
    
    logger.warn('[AudioFallback] File not on disk, trying MongoDB fallback', { path: audioPath });
    
    // ════════════════════════════════════════════════════════════════════════
    // TIER 2: MongoDB fallback (survives deploys)
    // ════════════════════════════════════════════════════════════════════════
    const audioData = await mongoFallback();
    const buffer = normalizeAudioBuffer(audioData);
    
    if (buffer) {
      logger.info('[AudioFallback] ✅ Restored from MongoDB', {
        path: audioPath,
        sizeBytes: buffer.length
      });
      
      // Restore disk cache (so next request is fast)
      try {
        const dir = path.dirname(audioPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(audioPath, buffer);
        logger.info('[AudioFallback] ✅ Disk cache restored', { path: audioPath });
      } catch (cacheErr) {
        // Non-blocking - can still serve from memory
        logger.warn('[AudioFallback] Failed to restore disk cache (non-blocking)', {
          error: cacheErr.message
        });
      }
      
      // Serve from MongoDB
      res.set('Content-Type', 'audio/mpeg');
      res.set('Content-Length', buffer.length);
      res.set('X-Audio-Source', 'mongodb-fallback');
      return res.send(buffer);
    }
    
    if (audioData) {
      logger.warn('[AudioFallback] Audio data found but not a Buffer', {
        path: audioPath,
        type: typeof audioData,
        constructor: audioData?.constructor?.name
      });
    }
    
    // ════════════════════════════════════════════════════════════════════════
    // TIER 3: Not found anywhere
    // ════════════════════════════════════════════════════════════════════════
    logger.error('[AudioFallback] ❌ Audio not found in disk OR MongoDB', { path: audioPath });
    res.status(404).json({
      error: 'Audio not found',
      path: req.path,
      note: 'File not on disk and not in MongoDB. May need regeneration.'
    });
    
  } catch (error) {
    logger.error('[AudioFallback] Error serving audio', {
      error: error.message,
      path: audioPath
    });
    res.status(500).json({ error: 'Failed to serve audio' });
  }
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ROUTE: Trigger Audio (instant-lines)
 * ════════════════════════════════════════════════════════════════════════════
 */
router.get('/instant-lines/:filename', async (req, res) => {
  const filename = req.params.filename;
  const audioPath = path.join(INSTANT_LINES_DIR, filename);
  
  await serveAudioWithFallback(req, res, audioPath, async () => {
    logger.debug('[AudioFallback] Looking for trigger audio in MongoDB', { filename });
    
    // Try 1: Match by audioUrl (exact - new /audio-safe format)
    let audioDoc = await TriggerAudio.findOne({
      audioUrl: `/audio-safe/instant-lines/${filename}`,
      isValid: true
    }).select('audioData').lean();
    
    if (audioDoc?.audioData) {
      logger.info('[AudioFallback] Found trigger via /audio-safe URL', { filename, bytes: audioDoc.audioData.length });
      return audioDoc.audioData;
    }
    if (audioDoc && !audioDoc.audioData) {
      logger.warn('[AudioFallback] TRIGGER DOC EXISTS but audioData is EMPTY — regenerate audio', { filename });
    }
    
    // Try 2: Match by old audioUrl format (/audio)
    audioDoc = await TriggerAudio.findOne({
      audioUrl: `/audio/instant-lines/${filename}`,
      isValid: true
    }).select('audioData').lean();
    
    if (audioDoc?.audioData) {
      logger.info('[AudioFallback] Found trigger via /audio URL (old format)', { filename, bytes: audioDoc.audioData.length });
      return audioDoc.audioData;
    }
    if (audioDoc && !audioDoc.audioData) {
      logger.warn('[AudioFallback] TRIGGER DOC (old URL) EXISTS but audioData is EMPTY — regenerate audio', { filename });
    }
    
    // Try 3: Regex match on filename in audioUrl
    audioDoc = await TriggerAudio.findOne({
      audioUrl: { $regex: filename.replace('.mp3', '') },
      isValid: true
    }).select('audioData').lean();
    
    if (audioDoc?.audioData) {
      logger.info('[AudioFallback] Found trigger via regex match', { filename });
      return audioDoc.audioData;
    }
    
    // Try 4: Match by textHash from filename
    // Filename: TRIGGER_CARD_ANSWER_68e3f77a9d62_8c32e43a6dbfd96f.mp3
    // The last part before .mp3 is the text hash
    const hashMatch = filename.match(/([a-f0-9]{16})\.mp3$/);
    if (hashMatch) {
      audioDoc = await TriggerAudio.findOne({
        textHash: hashMatch[1],
        isValid: true
      }).select('audioData').lean();
      
      if (audioDoc?.audioData) {
        logger.info('[AudioFallback] Found trigger via textHash', { filename, hash: hashMatch[1] });
        return audioDoc.audioData;
      }
    }
    
    // Try 5: Match by partial companyId (filename has truncated 12-char ID)
    const companyMatch = filename.match(/TRIGGER_CARD_ANSWER_([a-f0-9]+)_/);
    if (companyMatch) {
      const partialCompanyId = companyMatch[1];
      audioDoc = await TriggerAudio.findOne({
        companyId: { $regex: `^${partialCompanyId}` },
        isValid: true,
        audioUrl: { $regex: filename.replace('.mp3', '') }
      }).select('audioData').lean();
      
      if (audioDoc?.audioData) {
        logger.info('[AudioFallback] Found trigger via partial companyId', { filename, partialCompanyId });
        return audioDoc.audioData;
      }
    }
    
    logger.warn('[AudioFallback] Trigger audio not found in MongoDB', { filename });
    return null;
  });
});

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ROUTE: Greeting Audio
 * ════════════════════════════════════════════════════════════════════════════
 */
router.get('/greetings/:filename', async (req, res) => {
  const filename = req.params.filename;
  const audioPath = path.join(PUBLIC_AUDIO_DIR, 'greetings', filename);
  
  await serveAudioWithFallback(req, res, audioPath, async () => {
    logger.debug('[AudioFallback] Looking for greeting audio in MongoDB', { filename });
    
    // Try 1: Exact audioUrl match with /audio-safe
    const fullUrlSafe = `/audio-safe/greetings/${filename}`;
    let audioDoc = await GreetingAudio.findOne({
      audioUrl: fullUrlSafe
    }).select('audioData').lean();
    
    if (audioDoc?.audioData) {
      logger.info('[AudioFallback] Found via exact /audio-safe URL match', { filename, bytes: audioDoc.audioData.length });
      return audioDoc.audioData;
    }
    if (audioDoc && !audioDoc.audioData) {
      logger.warn('[AudioFallback] GREETING DOC EXISTS but audioData is EMPTY — regenerate audio', { filename, url: fullUrlSafe });
    }
    
    // Try 2: Exact audioUrl match with old /audio
    const fullUrlOld = `/audio/greetings/${filename}`;
    audioDoc = await GreetingAudio.findOne({
      audioUrl: fullUrlOld
    }).select('audioData').lean();
    
    if (audioDoc?.audioData) {
      logger.info('[AudioFallback] Found via exact /audio URL match (old format)', { filename, bytes: audioDoc.audioData.length });
      return audioDoc.audioData;
    }
    if (audioDoc && !audioDoc.audioData) {
      logger.warn('[AudioFallback] GREETING DOC (old URL) EXISTS but audioData is EMPTY — regenerate audio', { filename, url: fullUrlOld });
    }
    
    // Try 3: Regex match on filename
    audioDoc = await GreetingAudio.findOne({
      audioUrl: { $regex: filename.replace('.mp3', '') }
    }).select('audioData').lean();
    
    if (audioDoc) {
      logger.info('[AudioFallback] Found via regex match', { filename });
      return audioDoc.audioData;
    }
    
    // Try 4: Find by text hash from filename
    const hashMatch = filename.match(/([a-f0-9]{16})\.mp3$/);
    if (hashMatch) {
      const textHash = hashMatch[1];
      audioDoc = await GreetingAudio.findOne({
        textHash: textHash
      }).select('audioData').lean();
      
      if (audioDoc) {
        logger.info('[AudioFallback] Found via textHash match', { filename, textHash });
        return audioDoc.audioData;
      }
    }
    
    // Not found anywhere
    logger.warn('[AudioFallback] Greeting audio not found in MongoDB', {
      filename,
      triedUrls: [fullUrlSafe, fullUrlOld],
      triedHash: hashMatch ? hashMatch[1] : null
    });
    
    return null;
  });
});

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ROUTE: Generic audio fallback
 * ════════════════════════════════════════════════════════════════════════════
 */
router.get('/:filename', async (req, res) => {
  const filename = req.params.filename;
  const audioPath = path.join(PUBLIC_AUDIO_DIR, filename);
  
  await serveAudioWithFallback(req, res, audioPath, async () => {
    // Try both TriggerAudio and GreetingAudio
    let audioData = await TriggerAudio.findAudioDataByUrl(`/audio/${filename}`);
    
    if (!audioData) {
      const greetingDoc = await GreetingAudio.findOne({
        audioUrl: { $regex: filename }
      }).select('audioData').lean();
      audioData = greetingDoc?.audioData || null;
    }
    
    return audioData;
  });
});

module.exports = router;
