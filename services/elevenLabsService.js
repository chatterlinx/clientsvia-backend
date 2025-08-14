const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
const fs = require('fs');
const path = require('path');
const { redisClient } = require('../clients');

const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1';

function getElevenLabsApiKey(company) {
  // Check if company has toggled to use their own API key
  const useOwnApi = company?.aiSettings?.elevenLabs?.useOwnApiKey;
  const companyKey = company?.aiSettings?.elevenLabs?.apiKey;
  
  if (useOwnApi && companyKey && companyKey.trim()) {
    // Company has opted to use their own API key
    console.log(`🔑 Company ${company._id || 'unknown'} using own ElevenLabs API`);
    return companyKey.trim();
  }
  
  // Default: Use ClientsVia global API key
  if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_API_KEY.trim()) {
    console.log(`🏢 Using ClientsVia global ElevenLabs API for company ${company?._id || 'global'}`);
    return process.env.ELEVENLABS_API_KEY.trim();
  }
  
  // No valid key found
  console.warn(`⚠️ No ElevenLabs API key configured for company ${company?._id || 'global'}`);
  return null;
}

function getApiKey({ apiKey, company } = {}) {
  // If explicit API key provided, use it
  if (apiKey && apiKey.trim()) {
    return apiKey.trim();
  }
  
  // Otherwise use company-aware key logic
  const key = getElevenLabsApiKey(company);
  if (!key) throw new Error('ElevenLabs API key not configured. Please add ELEVENLABS_API_KEY to environment variables or configure company-specific API key.');
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
  console.log('🎙️ getAvailableVoices called with:', { 
    hasApiKey: !!apiKey, 
    companyId: company?._id,
    useOwnApi: company?.aiSettings?.elevenLabs?.useOwnApiKey 
  });
  
  try {
    const client = createClient({ apiKey, company });
    const response = await client.voices.getAll();
    
    console.log('✅ ElevenLabs API response received:', {
      voicesCount: response.voices?.length || 0,
      firstVoiceSample: response.voices?.[0] ? {
        name: response.voices[0].name,
        voice_id: response.voices[0].voice_id,
        id: response.voices[0].id,
        keys: Object.keys(response.voices[0])
      } : null
    });
    
    // Enhanced voice data with additional metadata
    return response.voices.map((voice, index) => {
      // Handle different possible field names for voice ID
      const voiceId = voice.voice_id || voice.id || voice.voiceId || `${voice.name}-generated-id-${index}`;
      
      if (index < 3) {
        console.log(`🎙️ Processing voice ${index}: ${voice.name}, ID fields:`, {
          voice_id: voice.voice_id,
          id: voice.id,
          voiceId: voice.voiceId,
          finalId: voiceId
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
        preview_url: voice.preview_url,
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
    console.error('❌ ElevenLabs getAvailableVoices error:', error);
    
    // Check if it's an API key error - use mock data for testing
    if (error.statusCode === 401 || 
        error.message.includes('invalid_api_key') || 
        error.message.includes('API key') ||
        error.body?.detail?.status === 'invalid_api_key') {
      console.log('🎭 Using mock voice data for testing (invalid API key)');
      const mockVoices = getMockVoices();
      console.log('🎭 Mock voices created:', mockVoices.length, 'voices');
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
    console.error('❌ ElevenLabs getAvailableModels error:', error);
    throw new Error(`Failed to fetch models: ${error.message}`);
  }
}

/**
 * Enhanced text-to-speech synthesis with latest features
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

  try {
    const client = createClient({ apiKey, company });
    
    const audioStream = await client.textToSpeech.convert(voiceId, {
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

    // Convert stream to buffer
    const chunks = [];
    for await (const chunk of audioStream) {
      chunks.push(chunk);
    }
    
    return Buffer.concat(chunks);
  } catch (error) {
    console.error('❌ ElevenLabs synthesizeSpeech error:', error);
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
    console.error('❌ ElevenLabs streamSpeech error:', error);
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
    console.error('❌ ElevenLabs analyzeVoice error:', error);
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
  if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
  
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
    console.error('❌ ElevenLabs getUserInfo error:', error);
    throw new Error(`Failed to get user info: ${error.message}`);
  }
}

/**
 * Get fallback message URL for a company (cached)
 * Cache key: tenants:{companyID}:tts:fallback:v{configVersion}
 */
async function getFallbackMessageUrl(company, fallbackText = "I apologize, but I cannot assist further at this time. Please try calling back later.") {
  if (!company?._id) {
    console.warn('[TTS] No company ID provided for fallback TTS');
    return null;
  }

  const companyId = company._id.toString();
  const configVersion = company.aiAgentLogic?.version || 1;
  const cacheKey = `tenants:${companyId}:tts:fallback:v${configVersion}`;

  try {
    // Check cache first
    const cachedUrl = await redisClient.get(cacheKey);
    if (cachedUrl) {
      console.log(`[TTS CACHE] Fallback URL found in cache for company ${companyId}`);
      return cachedUrl;
    }

    // Generate and cache new fallback
    const voiceId = company.aiSettings?.elevenLabs?.voiceId;
    if (!voiceId) {
      console.warn(`[TTS] No ElevenLabs voice configured for company ${companyId}, cannot generate fallback`);
      return null;
    }

    console.log(`[TTS GENERATE] Creating fallback TTS for company ${companyId}`);
    const buffer = await synthesizeSpeech({
      text: fallbackText,
      voiceId: voiceId,
      stability: company.aiSettings?.elevenLabs?.stability,
      similarity_boost: company.aiSettings?.elevenLabs?.similarityBoost,
      style: company.aiSettings?.elevenLabs?.style,
      model_id: company.aiSettings?.elevenLabs?.modelId,
      company
    });

    // Save to audio directory
    const audioDir = path.join(__dirname, '..', 'public', 'audio');
    if (!fs.existsSync(audioDir)) {
      fs.mkdirSync(audioDir, { recursive: true });
    }

    const filename = `fallback_${companyId}_v${configVersion}.mp3`;
    const filepath = path.join(audioDir, filename);
    fs.writeFileSync(filepath, buffer);

    const fallbackUrl = `/audio/${filename}`;
    
    // Cache for 24 hours
    await redisClient.setEx(cacheKey, 86400, fallbackUrl);
    console.log(`[TTS CACHE] Fallback URL cached for company ${companyId}: ${fallbackUrl}`);

    return fallbackUrl;
  } catch (error) {
    console.error(`[TTS ERROR] Failed to generate fallback for company ${companyId}:`, error);
    return null;
  }
}

/**
 * Get company TTS configuration
 */
function getCompanyTTSConfig(company) {
  if (!company) {
    return { provider: 'twilio', twilioVoice: 'man' };
  }

  const ttsProvider = company.aiSettings?.tts?.provider || 'elevenlabs';
  
  return {
    provider: ttsProvider,
    voiceId: company.aiSettings?.elevenLabs?.voiceId,
    twilioVoice: company.aiSettings?.tts?.twilioVoice || 'man',
    greetingUrl: company.aiSettings?.tts?.greetingUrl,
    fallbackUrl: company.aiSettings?.tts?.fallbackUrl
  };
}

/**
 * Generate TTS response for Twilio with company voice consistency
 */
async function generateTTSResponse(company, text, fallbackText = null) {
  const config = getCompanyTTSConfig(company);
  
  if (config.provider === 'elevenlabs' && config.voiceId) {
    try {
      const buffer = await synthesizeSpeech({
        text: text,
        voiceId: config.voiceId,
        stability: company.aiSettings?.elevenLabs?.stability,
        similarity_boost: company.aiSettings?.elevenLabs?.similarityBoost,
        style: company.aiSettings?.elevenLabs?.style,
        model_id: company.aiSettings?.elevenLabs?.modelId,
        company
      });

      // Save to temp audio file
      const audioDir = path.join(__dirname, '..', 'public', 'audio');
      if (!fs.existsSync(audioDir)) {
        fs.mkdirSync(audioDir, { recursive: true });
      }

      const filename = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp3`;
      const filepath = path.join(audioDir, filename);
      fs.writeFileSync(filepath, buffer);

      return {
        type: 'play',
        url: `/audio/${filename}`
      };
    } catch (error) {
      console.error('[TTS ERROR] ElevenLabs synthesis failed, falling back to Twilio:', error);
      return {
        type: 'say',
        text: fallbackText || text,
        voice: config.twilioVoice
      };
    }
  }

  // Twilio TTS fallback
  return {
    type: 'say',
    text: text,
    voice: config.twilioVoice
  };
}

/**
 * Bust TTS cache for a company (call when config is published)
 */
async function bustCompanyTTSCache(companyId) {
  try {
    const pattern = `tenants:${companyId}:tts:*`;
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
      await redisClient.del(keys);
      console.log(`[TTS CACHE] Busted ${keys.length} cached TTS entries for company ${companyId}`);
    }
  } catch (error) {
    console.error(`[TTS CACHE] Failed to bust cache for company ${companyId}:`, error);
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
      preview_url: null
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
      preview_url: null
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
      preview_url: null
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
      preview_url: null
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
      preview_url: null
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
  getFallbackMessageUrl,
  getCompanyTTSConfig,
  generateTTSResponse,
  bustCompanyTTSCache
};
