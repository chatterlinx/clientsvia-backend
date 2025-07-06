const axios = require('axios');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://api.elevenlabs.io/v1';

function getElevenLabsApiKey(company) {
  return (company?.aiSettings?.elevenLabs?.apiKey && company.aiSettings.elevenLabs.apiKey.trim())
    ? company.aiSettings.elevenLabs.apiKey.trim()
    : process.env.ELEVENLABS_API_KEY;
}

function getApiKey({ apiKey, company } = {}) {
  const key = apiKey ? apiKey.trim() : getElevenLabsApiKey(company);
  if (!key) throw new Error('ElevenLabs API key not configured');
  return key;
}

async function getAvailableVoices({ apiKey, company } = {}) {
  const key = getApiKey({ apiKey, company });
  const res = await axios.get(`${BASE_URL}/voices`, {
    headers: { 'xi-api-key': key }
  });
  return res.data.voices || [];
}

async function synthesizeSpeech({ text, voiceId, stability, similarity_boost, style, model_id, apiKey, company } = {}) {
  const key = getApiKey({ apiKey, company });
  if (!text || !voiceId) throw new Error('text and voiceId are required');
  const res = await axios.post(
    `${BASE_URL}/text-to-speech/${voiceId}`,
    {
      text,
      model_id,
      voice_settings: {
        stability,
        similarity_boost,
        style
      }
    },
    {
      headers: {
        'xi-api-key': key,
        'Content-Type': 'application/json'
      },
      responseType: 'arraybuffer'
    }
  );
  return res.data; // Buffer of MP3 audio
}

async function generateStaticPrompt({ text, voiceId, stability, similarity_boost, style, model_id, fileName, apiKey, company } = {}) {
  const buffer = await synthesizeSpeech({ text, voiceId, stability, similarity_boost, style, model_id, apiKey, company });
  const audioDir = path.join(__dirname, '../public/audio');
  if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
  const name = fileName || `prompt_${Date.now()}.mp3`;
  const filePath = path.join(audioDir, name);
  fs.writeFileSync(filePath, buffer);
  return `/audio/${name}`;
}

module.exports = { getAvailableVoices, synthesizeSpeech, generateStaticPrompt };
