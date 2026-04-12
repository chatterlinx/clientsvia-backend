const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
const logger = require('../utils/logger.js');
const AdminNotificationService = require('./AdminNotificationService'); // P1 monitoring

const fs = require('fs');
const path = require('path');

const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1';

// ═══════════════════════════════════════════════════════════════════════════
// CIRCUIT BREAKER: Skip ElevenLabs entirely when quota is exhausted.
// When quota_exceeded fires, we cache that fact in Redis for 1 hour.
// All subsequent calls skip the ElevenLabs API and fall back to Twilio <Say>
// instantly — no wasted time, no "application error" from webhook timeout.
// ═══════════════════════════════════════════════════════════════════════════
const CIRCUIT_BREAKER_TTL = 3600; // 1 hour
let _redis = null;

function _getRedis() {
  if (_redis) return _redis;
  try { _redis = require('../config/redis'); } catch (e) { /* no redis */ }
  return _redis;
}

async function isCircuitOpen(apiKey) {
  const redis = _getRedis();
  if (!redis) return false;
  try {
    const key = `elevenlabs:circuit:${(apiKey || 'global').slice(-8)}`;
    return Boolean(await redis.get(key));
  } catch (e) { return false; }
}

async function openCircuit(apiKey, reason) {
  const redis = _getRedis();
  if (!redis) return;
  try {
    const key = `elevenlabs:circuit:${(apiKey || 'global').slice(-8)}`;
    await redis.set(key, reason || 'quota_exceeded', 'EX', CIRCUIT_BREAKER_TTL);
    logger.warn(`🔌 [ELEVENLABS CIRCUIT BREAKER] OPEN — skipping ElevenLabs for ${CIRCUIT_BREAKER_TTL}s`, { reason });
  } catch (e) { /* best effort */ }
}

function getElevenLabsApiKey(company) {
  logger.debug(`🔍 [API KEY CHECK] Starting API key detection for company: ${company?._id || 'unknown'}`);
  
  // V2 VOICE SETTINGS: Check new aiAgentSettings.voiceSettings path first
  const v2VoiceSettings = company?.aiAgentSettings?.voiceSettings;
  logger.debug(`🔍 [API KEY CHECK] Has voiceSettings: ${Boolean(v2VoiceSettings)}`);
  logger.debug(`🔍 [API KEY CHECK] API Source: ${v2VoiceSettings?.apiSource || 'NOT SET'}`);
  logger.debug(`🔍 [API KEY CHECK] Has company API key: ${Boolean(v2VoiceSettings?.apiKey)}`);
  logger.debug(`🔍 [API KEY CHECK] Has global ELEVENLABS_API_KEY env: ${Boolean(process.env.ELEVENLABS_API_KEY)}`);
  
  if (v2VoiceSettings) {
    const useOwnApi = v2VoiceSettings.apiSource === 'own';
    const companyKey = v2VoiceSettings.apiKey;
    
    if (useOwnApi && companyKey && companyKey.trim()) {
      logger.info(`🔑 V2: Company ${company._id || 'unknown'} using OWN ElevenLabs API (last 4: ...${companyKey.slice(-4)})`);
      return companyKey.trim();
    }
    
    // V2 system defaults to ClientsVia global API when apiSource = 'clientsvia'
    if (v2VoiceSettings.apiSource === 'clientsvia' || !useOwnApi) {
      if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_API_KEY.trim()) {
        const globalKey = process.env.ELEVENLABS_API_KEY.trim();
        logger.debug(`🏢 V2: Using ClientsVia GLOBAL ElevenLabs API for company ${company?._id || 'global'} (last 4: ...${globalKey.slice(-4)})`);
        return globalKey;
      } 
        logger.error(`❌ V2: API Source is 'clientsvia' but ELEVENLABS_API_KEY env variable is NOT SET!`);
      
    }
  }
  
  // V2 ONLY: No legacy support - use ClientsVia global API as fallback
  if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_API_KEY.trim()) {
    const globalKey = process.env.ELEVENLABS_API_KEY.trim();
    logger.debug(`🏢 V2: Using ClientsVia GLOBAL ElevenLabs API (fallback) for company ${company?._id || 'global'} (last 4: ...${globalKey.slice(-4)})`);
    return globalKey;
  }
  
  // No valid key found
  logger.error(`⚠️ No ElevenLabs API key configured for company ${company?._id || 'global'}`);
  logger.error(`⚠️ Checked: voiceSettings.apiKey (company-specific), process.env.ELEVENLABS_API_KEY (global)`);
  return null;
}

function getApiKey({ apiKey, company } = {}) {
  // If explicit API key provided, use it
  if (apiKey && apiKey.trim()) {
    return apiKey.trim();
  }
  
  // Otherwise use company-aware key logic
  const key = getElevenLabsApiKey(company);
  if (!key) {throw new Error('ElevenLabs API key not configured. Please add ELEVENLABS_API_KEY to environment variables or configure company-specific API key.');}
  return key;
}

function createClient({ apiKey, company } = {}) {
  const key = getApiKey({ apiKey, company });
  return new ElevenLabsClient({ apiKey: key });
}

/**
 * Get all available voices from ElevenLabs
 */
async function getAvailableVoices({ apiKey, company } = {}) {
  logger.info('🎙️ getAvailableVoices called with:', { 
    hasApiKey: Boolean(apiKey), 
    companyId: company?._id,
    useOwnApi: company?.aiSettings?.elevenLabs?.useOwnApiKey 
  });
  
  try {
    const client = createClient({ apiKey, company });
    // ✅ FIX: Include show_legacy parameter to get preview audio URLs
    const response = await client.voices.getAll({ show_legacy: true });
    
    logger.info('✅ ElevenLabs API response received:', {
      voicesCount: response.voices?.length || 0,
      firstVoiceSample: response.voices?.[0] ? {
        name: response.voices[0].name,
        voice_id: response.voices[0].voice_id,
        id: response.voices[0].id,
        keys: Object.keys(response.voices[0]),
        hasSamples: Boolean(response.voices[0].samples),
        samplesCount: response.voices[0].samples?.length || 0,
        preview_url: response.voices[0].preview_url,
        samplePreviewUrl: response.voices[0].samples?.[0]?.audio_url
      } : null
    });
    
    // Enhanced voice data with additional metadata
    return response.voices.map((voice, index) => {
      // Handle different possible field names for voice ID
      const voiceId = voice.voice_id || voice.id || voice.voiceId || `${voice.name}-generated-id-${index}`;
      
      // Extract preview URL from samples array (ElevenLabs API structure)
      let previewUrl = voice.preview_url; // Try direct field first
      
      if (!previewUrl && voice.samples && voice.samples.length > 0) {
        // Check first sample's audio_url field
        const firstSample = voice.samples[0];
        previewUrl = firstSample.audio_url || firstSample.preview_url || null;
      }
      
      if (index < 3) {
        logger.debug(`🎙️ Processing voice ${index}: ${voice.name}, preview extraction:`, {
          voice_id: voice.voice_id,
          finalId: voiceId,
          directPreviewUrl: voice.preview_url,
          hasSamples: Boolean(voice.samples),
          extractedPreviewUrl: previewUrl,
          constructedFallback: !voice.preview_url && !voice.samples
        });
      }
      
      return {
        voice_id: voiceId,
        name: voice.name,
        category: voice.category || 'uncategorized',
        description: voice.description || '',
        labels: {
          gender: voice.labels?.gender || 'unknown',
          age: voice.labels?.age || 'unknown',
          accent: voice.labels?.accent || 'unknown',
          category: voice.labels?.['use case'] || voice.category || 'general',
          description: voice.description || `${voice.name} voice`
        },
        preview_url: previewUrl,
        available_for_tiers: voice.available_for_tiers || [],
        settings: voice.settings || {
          stability: 0.5,
          similarity_boost: 0.7,
          style: 0.0,
          use_speaker_boost: true
        }
      };
    });
  } catch (error) {
    // Enhanced error reporting with company context
    if (company) {
      logger.companyError({
        companyId: company._id,
        companyName: company.businessName || company.companyName || 'Unknown',
        code: 'ELEVENLABS_VOICE_FETCH_FAILURE',
        message: 'Failed to fetch ElevenLabs voices',
        severity: error.statusCode === 401 ? 'WARNING' : 'CRITICAL',
        error,
        meta: {
          apiSource: company?.aiAgentSettings?.voiceSettings?.apiSource,
          hasApiKey: Boolean(apiKey)
        }
      });
    } else {
      logger.error('❌ ElevenLabs getAvailableVoices error:', error);
    }
    
    // Check if it's an API key error - use mock data for testing
    if (error.statusCode === 401 || 
        error.message.includes('invalid_api_key') || 
        error.message.includes('API key') ||
        error.body?.detail?.status === 'invalid_api_key') {
      logger.info('🎭 Using mock voice data for testing (invalid API key)');
      const mockVoices = getMockVoices();
      logger.debug('🎭 Mock voices created:', mockVoices.length, 'voices');
      return mockVoices;
    }
    
    throw new Error(`Failed to fetch voices: ${error.message}`);
  }
}

/**
 * Get available models from ElevenLabs
 */
async function getAvailableModels({ apiKey, company } = {}) {
  try {
    const client = createClient({ apiKey, company });
    const response = await client.models.getAll();
    
    return response.map(model => ({
      model_id: model.model_id,
      name: model.name,
      description: model.description,
      can_be_finetuned: model.can_be_finetuned,
      can_do_text_to_speech: model.can_do_text_to_speech,
      can_do_voice_conversion: model.can_do_voice_conversion,
      can_use_style: model.can_use_style,
      can_use_speaker_boost: model.can_use_speaker_boost,
      serves_pro_voices: model.serves_pro_voices,
      token_cost_factor: model.token_cost_factor,
      max_characters_request_free_tier: model.max_characters_request_free_tier,
      max_characters_request_subscribed_tier: model.max_characters_request_subscribed_tier,
      language: model.language
    }));
  } catch (error) {
    logger.error('❌ ElevenLabs getAvailableModels error:', error);
    throw new Error(`Failed to fetch models: ${error.message}`);
  }
}

/**
 * Enhanced text-to-speech synthesis with latest features
 * 
 * INCLUDES: Phone number and address formatting for natural pronunciation
 * - "239-565-2202" → "2 3 9, 5 6 5, 2 2 zero 2"
 * - "12155 Metro Parkway" → "1 2 1 5 5 Metro Parkway"
 */
async function synthesizeSpeech({ 
  text, 
  voiceId, 
  stability = 0.5,
  similarity_boost = 0.7,
  style = 0.0,
  use_speaker_boost = true,
  model_id = 'eleven_turbo_v2_5',
  optimize_streaming_latency = 0,
  output_format = 'mp3_44100_128',
  apiKey,
  company 
} = {}) {
  if (!text || !voiceId) {
    throw new Error('text and voiceId are required');
  }

  // ── CIRCUIT BREAKER: skip ElevenLabs entirely when quota is blown ──
  const resolvedApiKey = apiKey || getElevenLabsApiKey(company);
  if (await isCircuitOpen(resolvedApiKey)) {
    throw new Error('ElevenLabs circuit breaker OPEN — quota exhausted, falling back to Twilio <Say>');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // FORMAT TEXT FOR NATURAL PRONUNCIATION
  // ════════════════════════════════════════════════════════════════════════════
  // Apply phone/address formatting so TTS says "zero" instead of "oh"
  // and spells out numbers naturally
  const { formatForTTS } = require('../utils/textUtils');
  const formattedText = formatForTTS(text);

  try {
    const client = createClient({ apiKey, company });
    
    const audioStream = await client.textToSpeech.convert(voiceId, {
      text: formattedText,
      model_id,
      output_format,
      optimize_streaming_latency,
      voice_settings: {
        stability,
        similarity_boost,
        style,
        use_speaker_boost
      }
    });

    // Convert stream to buffer
    const chunks = [];
    for await (const chunk of audioStream) {
      chunks.push(chunk);
    }
    
    return Buffer.concat(chunks);
  } catch (error) {
    // Enhanced error reporting with company context
    if (company) {
      logger.companyError({
        companyId: company._id,
        companyName: company.businessName || company.companyName || 'Unknown',
        code: 'ELEVENLABS_TTS_FAILURE',
        message: 'Text-to-speech synthesis failed',
        severity: 'CRITICAL',
        error,
        meta: {
          voiceId,
          textLength: text?.length || 0,
          modelId: model_id
        }
      });
    } else {
      logger.error('❌ ElevenLabs synthesizeSpeech error:', error);
    }
    
    // 🚨 P1 CHECKPOINT: Voice generation failure alerts
    const companyId = company?._id?.toString() || null;
    const companyName = company?.companyName || company?.businessName || 'Unknown';
    
    // Timeout errors — fire-and-forget (never block the call response)
    if (error.message?.includes('timeout') || error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
      AdminNotificationService.sendAlert({
        code: 'ELEVENLABS_TIMEOUT',
        severity: 'WARNING',
        companyId,
        companyName,
        message: `⚠️ ElevenLabs voice generation timed out for ${companyName}`,
        details: {
          companyId,
          companyName,
          voiceId,
          textLength: text?.length || 0,
          modelId: model_id,
          error: error.message,
          impact: 'Call cannot proceed, caller will hear silence or fallback message',
          suggestedFix: 'Check ElevenLabs API status, verify network connectivity, consider shorter text',
          detectedBy: 'ElevenLabs synthesizeSpeech'
        }
      }).catch(err => logger.error('Failed to send ElevenLabs timeout alert:', err));
    }
    
    // Quota exceeded errors — fire-and-forget (never block the call response)
    // Also OPEN the circuit breaker so all subsequent calls skip ElevenLabs instantly.
    else if (error.statusCode === 429 || error.statusCode === 401 && error.message?.includes('quota') || error.message?.includes('quota') || error.message?.includes('limit') || error.message?.includes('rate')) {
      openCircuit(resolvedApiKey, error.message?.substring(0, 200)).catch(() => {});
      AdminNotificationService.sendAlert({
        code: 'ELEVENLABS_QUOTA_EXCEEDED',
        severity: 'CRITICAL',
        companyId,
        companyName,
        message: `🔴 CRITICAL: ElevenLabs quota exceeded for ${companyName}`,
        details: {
          companyId,
          companyName,
          voiceId,
          apiSource: company?.aiAgentSettings?.voiceSettings?.apiSource || 'unknown',
          error: error.message,
          impact: 'All voice generation stopped, all calls will fail',
          suggestedFix: 'Upgrade ElevenLabs plan, switch to company-owned API key, or wait for quota reset',
          detectedBy: 'ElevenLabs synthesizeSpeech'
        },
        bypassPatternDetection: true // Critical quota issues = immediate alert
      }).catch(err => logger.error('Failed to send ElevenLabs quota alert:', err));
    }
    
    // Voice not found errors — fire-and-forget (never block the call response)
    else if (error.statusCode === 404 || error.message?.includes('voice') || error.message?.includes('not found')) {
      AdminNotificationService.sendAlert({
        code: 'ELEVENLABS_VOICE_NOT_FOUND',
        severity: 'CRITICAL',
        companyId,
        companyName,
        message: `🔴 CRITICAL: ElevenLabs voice "${voiceId}" not found for ${companyName}`,
        details: {
          companyId,
          companyName,
          voiceId,
          error: error.message,
          impact: 'All calls using this voice will fail, company cannot communicate',
          suggestedFix: 'Go to Company Profile → Voice Settings and select a valid voice ID',
          detectedBy: 'ElevenLabs synthesizeSpeech'
        },
        bypassPatternDetection: true // Missing voice = immediate alert
      }).catch(err => logger.error('Failed to send ElevenLabs voice not found alert:', err));
    }
    
    // Generic API errors — fire-and-forget (never block the call response)
    else {
      AdminNotificationService.sendAlert({
        code: 'ELEVENLABS_API_ERROR',
        severity: 'CRITICAL',
        companyId,
        companyName,
        message: `🔴 CRITICAL: ElevenLabs API error for ${companyName}`,
        details: {
          companyId,
          companyName,
          voiceId,
          textLength: text?.length || 0,
          modelId: model_id,
          error: error.message,
          statusCode: error.statusCode || 'unknown',
          impact: 'Voice generation failed, call may fail or use fallback',
          suggestedFix: 'Check ElevenLabs API key, verify API status, review error message',
          detectedBy: 'ElevenLabs synthesizeSpeech'
        },
        stackTrace: error.stack
      }).catch(err => logger.error('Failed to send ElevenLabs API error alert:', err));
    }
    
    throw new Error(`Failed to synthesize speech: ${error.message}`);
  }
}

/**
 * Real-time streaming synthesis (for live applications)
 */
async function streamSpeech({
  text,
  voiceId,
  stability = 0.5,
  similarity_boost = 0.7,
  style = 0.0,
  use_speaker_boost = true,
  model_id = 'eleven_turbo_v2_5',
  optimize_streaming_latency = 4, // Max optimization for real-time
  output_format = 'mp3_44100_128',
  apiKey,
  company
} = {}) {
  if (!text || !voiceId) {
    throw new Error('text and voiceId are required');
  }

  try {
    const client = createClient({ apiKey, company });
    
    return await client.textToSpeech.stream(voiceId, {
      text,
      model_id,
      output_format,
      optimize_streaming_latency,
      voice_settings: {
        stability,
        similarity_boost,
        style,
        use_speaker_boost
      }
    });
  } catch (error) {
    logger.error('❌ ElevenLabs streamSpeech error:', error);
    throw new Error(`Failed to stream speech: ${error.message}`);
  }
}

/**
 * Voice analysis and settings optimization
 */
async function analyzeVoice({ voiceId, apiKey, company } = {}) {
  try {
    const client = createClient({ apiKey, company });
    const voice = await client.voices.get(voiceId);
    
    return {
      voice_id: voice.voice_id,
      name: voice.name,
      category: voice.category,
      description: voice.description,
      gender: voice.labels?.gender,
      age: voice.labels?.age,
      accent: voice.labels?.accent,
      use_case: voice.labels?.['use case'],
      optimal_settings: voice.settings || {
        stability: 0.5,
        similarity_boost: 0.7,
        style: 0.0,
        use_speaker_boost: true
      },
      preview_url: voice.preview_url,
      samples: voice.samples || []
    };
  } catch (error) {
    logger.error('❌ ElevenLabs analyzeVoice error:', error);
    throw new Error(`Failed to analyze voice: ${error.message}`);
  }
}

/**
 * Enhanced static prompt generation with optimized settings
 */
async function generateStaticPrompt({ 
  text, 
  voiceId, 
  stability, 
  similarity_boost, 
  style, 
  use_speaker_boost,
  model_id, 
  output_format,
  fileName, 
  apiKey, 
  company 
} = {}) {
  const buffer = await synthesizeSpeech({ 
    text, 
    voiceId, 
    stability, 
    similarity_boost, 
    style, 
    use_speaker_boost,
    model_id,
    output_format,
    apiKey, 
    company 
  });
  
  const audioDir = path.join(__dirname, '../public/audio');
  if (!fs.existsSync(audioDir)) {fs.mkdirSync(audioDir, { recursive: true });}
  
  const extension = output_format?.includes('mp3') ? 'mp3' : 'wav';
  const name = fileName || `prompt_${Date.now()}.${extension}`;
  const filePath = path.join(audioDir, name);
  
  fs.writeFileSync(filePath, buffer);
  return `/audio/${name}`;
}

/**
 * Get user subscription info and usage
 */
async function getUserInfo({ apiKey, company } = {}) {
  try {
    const client = createClient({ apiKey, company });
    const user = await client.user.get();
    
    return {
      xi_api_key: user.xi_api_key,
      subscription: user.subscription,
      is_new_user: user.is_new_user,
      tier: user.subscription?.tier,
      character_count: user.subscription?.character_count,
      character_limit: user.subscription?.character_limit,
      can_extend_character_limit: user.subscription?.can_extend_character_limit,
      allowed_to_extend_character_limit: user.subscription?.allowed_to_extend_character_limit,
      next_character_count_reset_unix: user.subscription?.next_character_count_reset_unix,
      voice_limit: user.subscription?.voice_limit,
      max_voice_add_edits: user.subscription?.max_voice_add_edits,
      voice_add_edit_counter: user.subscription?.voice_add_edit_counter,
      professional_voice_limit: user.subscription?.professional_voice_limit,
      can_extend_voice_limit: user.subscription?.can_extend_voice_limit,
      can_use_instant_voice_cloning: user.subscription?.can_use_instant_voice_cloning,
      can_use_professional_voice_cloning: user.subscription?.can_use_professional_voice_cloning
    };
  } catch (error) {
    logger.error('❌ ElevenLabs getUserInfo error:', error);
    throw new Error(`Failed to get user info: ${error.message}`);
  }
}

// Mock voice data for testing when API key is invalid or not available
function getMockVoices() {
  return [
    {
      voice_id: 'Aria-mock-id',
      name: 'Aria',
      labels: {
        gender: 'female',
        age: 'young',
        category: 'conversational',
        description: 'Natural and friendly female voice'
      },
      preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/21m00Tcm4TlvDq8ikWAM/preview.mp3'
    },
    {
      voice_id: 'Mark-mock-id',
      name: 'Mark',
      labels: {
        gender: 'male',
        age: 'middle-aged',
        category: 'professional',
        description: 'Clear and professional male voice'
      },
      preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/N2lVS1w4EtoT3dr4eOWO/preview.mp3'
    },
    {
      voice_id: 'Sarah-mock-id',
      name: 'Sarah',
      labels: {
        gender: 'female',
        age: 'adult',
        category: 'narration',
        description: 'Calm and articulate female voice'
      },
      preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/EXAVITQu4vr4xnSDxMaL/preview.mp3'
    },
    {
      voice_id: 'David-mock-id',
      name: 'David',
      labels: {
        gender: 'male',
        age: 'adult',
        category: 'conversational',
        description: 'Warm and engaging male voice'
      },
      preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/onwK4e9ZLuTAKqWW03F9/preview.mp3'
    },
    {
      voice_id: 'Emma-mock-id',
      name: 'Emma',
      labels: {
        gender: 'female',
        age: 'young',
        category: 'energetic',
        description: 'Enthusiastic and vibrant female voice'
      },
      preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/XB0fDUnXU5powFXDhCwa/preview.mp3'
    }
  ];
}

module.exports = {
  getAvailableVoices,
  getAvailableModels,
  synthesizeSpeech,
  streamSpeech,
  analyzeVoice,
  generateStaticPrompt,
  getUserInfo,
  getMockVoices,
  isCircuitOpen
};
