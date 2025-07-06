const express = require('express');
const router = express.Router();
const { getAvailableVoices, synthesizeSpeech, generateStaticPrompt } = require('../services/elevenLabsService');

async function listVoices(req, res) {
  try {
    const voices = await getAvailableVoices();
    res.json(voices);
  } catch (err) {
    console.error('[GET /api/elevenlabs/voices] Error:', err.message);
    res.status(500).json({ message: 'Failed to fetch voices' });
  }
}

router.get('/voices', listVoices);

async function synthesize(req, res) {
  const { text, voiceId, stability, similarityBoost, style, modelId } = req.body || {};
  try {
    const buffer = await synthesizeSpeech({
      text,
      voiceId,
      stability,
      similarity_boost: similarityBoost,
      style,
      model_id: modelId
    });
    res.json({ audioContent: Buffer.from(buffer).toString('base64') });
  } catch (err) {
    console.error('[POST /api/elevenlabs/synthesize] Error:', err.message);
    res.status(500).json({ message: 'Failed to synthesize speech' });
  }
}

router.post('/synthesize', synthesize);

async function generateStatic(req, res) {
  const { text, voiceId, stability, similarityBoost, style, modelId, filename } = req.body || {};
  try {
    const url = await generateStaticPrompt({
      text,
      voiceId,
      stability,
      similarity_boost: similarityBoost,
      style,
      model_id: modelId,
      fileName: filename
    });
    res.json({ url });
  } catch (err) {
    console.error('[POST /api/elevenlabs/static] Error:', err.message);
    res.status(500).json({ message: 'Failed to generate prompt' });
  }
}

router.post('/static', generateStatic);

module.exports = router;
