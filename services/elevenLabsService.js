const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
const fs = require('fs');
const path = require('path');

const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1';

function getElevenLabsApiKey(company) {
  // First check company settings - but verify it's not empty after trimming
  const companyKey = company?.aiSettings?.elevenLabs?.apiKey;
  if (companyKey && companyKey.trim()) {
    return companyKey.trim();
  }
  
  // Fall back to environment variable
  if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_API_KEY.trim()) {
    return process.env.ELEVENLABS_API_KEY.trim();
  }
  
  // No valid key found
  return null;
}

function getApiKey({ apiKey, company } = {}) {
  const key = apiKey ? apiKey.trim() : getElevenLabsApiKey(company);
  if (!key) throw new Error('ElevenLabs API key not configured');
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
  try {
    const client = createClient({ apiKey, company });
    const response = await client.voices.getAll();
    
    // Enhanced voice data with additional metadata
    return response.voices.map(voice => ({
      voice_id: voice.voice_id,
      name: voice.name,
      category: voice.category || 'uncategorized',
      description: voice.description || '',
      gender: voice.labels?.gender || 'unknown',
      age: voice.labels?.age || 'unknown',
      accent: voice.labels?.accent || 'unknown',
      use_case: voice.labels?.['use case'] || 'general',
      preview_url: voice.preview_url,
      available_for_tiers: voice.available_for_tiers || [],
      settings: voice.settings || {
        stability: 0.5,
        similarity_boost: 0.7,
        style: 0.0,
        use_speaker_boost: true
      }
    }));
  } catch (error) {
    console.error('❌ ElevenLabs getAvailableVoices error:', error);
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

module.exports = { 
  getAvailableVoices, 
  getAvailableModels,
  synthesizeSpeech, 
  streamSpeech,
  analyzeVoice,
  generateStaticPrompt,
  getUserInfo
};
