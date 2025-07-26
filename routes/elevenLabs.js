const express = require('express');
const router = express.Router();
const Company = require('../models/Company');
const { 
  getAvailableVoices, 
  getAvailableModels,
  synthesizeSpeech, 
  streamSpeech,
  analyzeVoice,
  generateStaticPrompt,
  getUserInfo,
  getMockVoices
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
    optimize_streaming_latency,
    companyId
  } = req.body || {};
  
  try {
    let company = null;
    
    // If companyId is provided, fetch company data for API key selection
    if (companyId) {
      const Company = require('../models/Company');
      company = await Company.findById(companyId);
      console.log(`🎙️ [Synthesize] Using company-specific settings for: ${company?.companyName || companyId}`);
    }
    
    const buffer = await synthesizeSpeech({
      text,
      voiceId,
      stability,
      similarity_boost,
      style,
      use_speaker_boost,
      model_id,
      output_format,
      optimize_streaming_latency,
      company
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
    optimize_streaming_latency = 4, // Max optimization for streaming
    companyId
  } = req.body || {};
  
  try {
    let company = null;
    
    // If companyId is provided, fetch company data for API key selection
    if (companyId) {
      const Company = require('../models/Company');
      company = await Company.findById(companyId);
      console.log(`🌊 [Stream] Using company-specific settings for: ${company?.companyName || companyId}`);
    }
    
    const audioStream = await streamSpeech({
      text,
      voiceId,
      stability,
      similarity_boost,
      style,
      use_speaker_boost,
      model_id,
      output_format,
      optimize_streaming_latency,
      company
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

/**
 * GET /api/elevenlabs/companies/:companyId/voices - Get voices for specific company
 */
async function getCompanyVoices(req, res) {
  try {
    const { companyId } = req.params;
    console.log(`🏢 [Company Voices] Request for company ID: ${companyId}`);
    
    // Fetch company data to get API settings
    const company = await Company.findById(companyId);
    if (!company) {
      console.log(`❌ [Company Voices] Company not found: ${companyId}`);
      return res.status(404).json({ success: false, message: 'Company not found' });
    }
    
    console.log(`✅ [Company Voices] Found company: ${company.companyName}`);

    console.log(`🎙️ [Company Voices] Fetching voices for company: ${company.companyName} (${companyId})`);
    
    const voices = await getAvailableVoices({ company });
    
    console.log(`✅ [Company Voices] Found ${voices.length} voices for ${company.companyName}`);
    res.json({ 
      success: true, 
      voices, 
      count: voices.length,
      company: {
        id: company._id,
        name: company.companyName,
        useOwnApi: company.aiSettings?.elevenLabs?.useOwnApiKey || false
      }
    });
  } catch (err) {
    console.error(`❌ [Company Voices] Error for company ${req.params.companyId}:`, err.message);
    
    // Handle API key errors with mock data for testing
    if (err.message.includes('invalid_api_key') || err.message.includes('API key')) {
      console.log('🎭 [Company Voices] Using mock voice data for testing (invalid API key)');
      const mockVoices = getMockVoices();
      
      return res.json({ 
        success: true, 
        voices: mockVoices, 
        count: mockVoices.length,
        isMockData: true,
        company: {
          id: req.params.companyId,
          name: 'Test Company',
          useOwnApi: false
        }
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch voices', 
      error: err.message 
    });
  }
}

/**
 * POST /api/elevenlabs/companies/:companyId/test-connection - Test API connection
 */
async function testCompanyConnection(req, res) {
  try {
    const { companyId } = req.params;
    console.log(`🔧 [Test Connection] Request for company ID: ${companyId}`);
    
    // Fetch company data to get API settings
    const company = await Company.findById(companyId);
    if (!company) {
      console.log(`❌ [Test Connection] Company not found: ${companyId}`);
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    console.log(`🔧 [Test Connection] Testing ElevenLabs connection for: ${company.companyName}`);
    
    // Test connection by fetching user info
    const userInfo = await getUserInfo({ company });
    
    console.log(`✅ [Test Connection] Success for ${company.companyName}`);
    res.json({ 
      success: true, 
      message: 'Connection successful',
      userInfo: {
        subscription: userInfo.subscription?.tier || 'unknown',
        charactersUsed: userInfo.subscription?.character_count || 0,
        charactersLimit: userInfo.subscription?.character_limit || 0
      },
      company: {
        id: company._id,
        name: company.companyName,
        useOwnApi: company.aiSettings?.elevenLabs?.useOwnApiKey || false
      }
    });
  } catch (err) {
    console.error(`❌ [Test Connection] Error for company ${req.params.companyId}:`, err.message);
    res.status(500).json({ 
      success: false, 
      message: 'Connection failed', 
      error: err.message 
    });
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
router.get('/companies/:companyId/voices', getCompanyVoices);
router.post('/companies/:companyId/test-connection', testCompanyConnection);

module.exports = router;
