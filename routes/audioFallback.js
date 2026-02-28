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
    
    if (audioData && Buffer.isBuffer(audioData)) {
      logger.info('[AudioFallback] ✅ Restored from MongoDB', {
        path: audioPath,
        sizeBytes: audioData.length
      });
      
      // Restore disk cache (so next request is fast)
      try {
        const dir = path.dirname(audioPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(audioPath, audioData);
        logger.info('[AudioFallback] ✅ Disk cache restored', { path: audioPath });
      } catch (cacheErr) {
        // Non-blocking - can still serve from memory
        logger.warn('[AudioFallback] Failed to restore disk cache (non-blocking)', {
          error: cacheErr.message
        });
      }
      
      // Serve from MongoDB
      res.set('Content-Type', 'audio/mpeg');
      res.set('Content-Length', audioData.length);
      res.set('X-Audio-Source', 'mongodb-fallback');
      return res.send(audioData);
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
  
  // Extract trigger info from filename
  // Format: TRIGGER_CARD_ANSWER_COMPANYID_RULEID.mp3
  const match = filename.match(/TRIGGER_CARD_ANSWER_([^_]+)_(.+)\.mp3$/);
  
  if (!match) {
    logger.warn('[AudioFallback] Invalid trigger filename format', { filename });
    return res.status(404).json({ error: 'Invalid filename format' });
  }
  
  const companyId = match[1];
  const ruleId = match[2];
  
  await serveAudioWithFallback(req, res, audioPath, async () => {
    // MongoDB fallback
    const audioDoc = await TriggerAudio.findOne({
      companyId,
      ruleId,
      isValid: true
    }).select('audioData').lean();
    
    return audioDoc?.audioData || null;
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
    
    if (audioDoc) {
      logger.info('[AudioFallback] Found via exact /audio-safe URL match', { filename });
      return audioDoc.audioData;
    }
    
    // Try 2: Exact audioUrl match with old /audio
    const fullUrlOld = `/audio/greetings/${filename}`;
    audioDoc = await GreetingAudio.findOne({
      audioUrl: fullUrlOld
    }).select('audioData').lean();
    
    if (audioDoc) {
      logger.info('[AudioFallback] Found via exact /audio URL match (old format)', { filename });
      return audioDoc.audioData;
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
