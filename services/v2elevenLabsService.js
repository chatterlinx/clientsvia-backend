const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
const logger = require('../utils/logger.js');

const fs = require('fs');
const path = require('path');

const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1';

function getElevenLabsApiKey(company) {
  logger.debug(`🔍 [API KEY CHECK] Starting API key detection for company: ${company?._id || 'unknown'}`);
  
  // V2 VOICE SETTINGS: Check new aiAgentLogic.voiceSettings path first
  const v2VoiceSettings = company?.aiAgentLogic?.voiceSettings;
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
    const response = await client.voices.getAll();
    
    logger.info('✅ ElevenLabs API response received:', {
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
        logger.debug(`🎙️ Processing voice ${index}: ${voice.name}, ID fields:`, {
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
    logger.error('❌ ElevenLabs getAvailableVoices error:', error);
    
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
    logger.error('❌ ElevenLabs synthesizeSpeech error:', error);
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
  getMockVoices
};
