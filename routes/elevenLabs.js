const express = require('express');
const router = express.Router();
const { 
  getAvailableVoices, 
  getAvailableModels,
  synthesizeSpeech, 
  streamSpeech,
  analyzeVoice,
  generateStaticPrompt,
  getUserInfo
} = require('../services/elevenLabsService');

/**
 * GET /api/elevenlabs/voices - Get all available voices
 */
async function listVoices(req, res) {
  try {
    const voices = await getAvailableVoices();
    res.json({ success: true, voices, count: voices.length });
  } catch (err) {
    console.error('[GET /api/elevenlabs/voices] Error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch voices', error: err.message });
  }
}

/**
 * GET /api/elevenlabs/models - Get all available models
 */
async function listModels(req, res) {
  try {
    const models = await getAvailableModels();
    res.json({ success: true, models, count: models.length });
  } catch (err) {
    console.error('[GET /api/elevenlabs/models] Error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch models', error: err.message });
  }
}

/**
 * GET /api/elevenlabs/voice/:voiceId - Analyze specific voice
 */
async function getVoiceAnalysis(req, res) {
  try {
    const { voiceId } = req.params;
    const analysis = await analyzeVoice({ voiceId });
    res.json({ success: true, voice: analysis });
  } catch (err) {
    console.error('[GET /api/elevenlabs/voice/:voiceId] Error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to analyze voice', error: err.message });
  }
}

/**
 * GET /api/elevenlabs/user - Get user subscription info
 */
async function getUserSubscription(req, res) {
  try {
    const userInfo = await getUserInfo();
    res.json({ success: true, user: userInfo });
  } catch (err) {
    console.error('[GET /api/elevenlabs/user] Error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to get user info', error: err.message });
  }
}

/**
 * POST /api/elevenlabs/synthesize - Standard text-to-speech
 */
async function synthesize(req, res) {
  const { 
    text, 
    voiceId, 
    stability, 
    similarity_boost, 
    style, 
    use_speaker_boost,
    model_id,
    output_format,
    optimize_streaming_latency
  } = req.body || {};
  
  try {
    const buffer = await synthesizeSpeech({
      text,
      voiceId,
      stability,
      similarity_boost,
      style,
      use_speaker_boost,
      model_id,
      output_format,
      optimize_streaming_latency
    });
    
    res.json({ 
      success: true, 
      audioContent: Buffer.from(buffer).toString('base64'),
      size: buffer.length,
      format: output_format || 'mp3_44100_128'
    });
  } catch (err) {
    console.error('[POST /api/elevenlabs/synthesize] Error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to synthesize speech', error: err.message });
  }
}

/**
 * POST /api/elevenlabs/stream - Real-time streaming synthesis
 */
async function streamSynthesis(req, res) {
  const { 
    text, 
    voiceId, 
    stability, 
    similarity_boost, 
    style, 
    use_speaker_boost,
    model_id,
    output_format,
    optimize_streaming_latency = 4 // Max optimization for streaming
  } = req.body || {};
  
  try {
    const audioStream = await streamSpeech({
      text,
      voiceId,
      stability,
      similarity_boost,
      style,
      use_speaker_boost,
      model_id,
      output_format,
      optimize_streaming_latency
    });

    // Set appropriate headers for streaming
    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    // Stream the audio data
    for await (const chunk of audioStream) {
      res.write(chunk);
    }
    
    res.end();
  } catch (err) {
    console.error('[POST /api/elevenlabs/stream] Error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Failed to stream speech', error: err.message });
    }
  }
}

/**
 * POST /api/elevenlabs/static - Generate static audio file
 */
async function generateStatic(req, res) {
  const { 
    text, 
    voiceId, 
    stability, 
    similarity_boost, 
    style, 
    use_speaker_boost,
    model_id,
    output_format,
    filename 
  } = req.body || {};
  
  try {
    const url = await generateStaticPrompt({
      text,
      voiceId,
      stability,
      similarity_boost,
      style,
      use_speaker_boost,
      model_id,
      output_format,
      fileName: filename
    });
    
    res.json({ success: true, url, filename: filename || 'generated audio' });
  } catch (err) {
    console.error('[POST /api/elevenlabs/static] Error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to generate static audio', error: err.message });
  }
}

// Route definitions
router.get('/voices', listVoices);
router.get('/models', listModels);
router.get('/voice/:voiceId', getVoiceAnalysis);
router.get('/user', getUserSubscription);
router.post('/synthesize', synthesize);
router.post('/stream', streamSynthesis);
router.post('/static', generateStatic);

module.exports = router;
