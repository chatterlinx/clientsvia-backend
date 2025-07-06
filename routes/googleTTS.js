const express = require('express');
const router = express.Router();
const { google } = require('googleapis');

async function getClient() {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  });
  const authClient = await auth.getClient();
  return google.texttospeech({ version: 'v1', auth: authClient });
}

async function listVoices(req, res) {
  try {
    const client = await getClient();
    // Fetch all available voices from Google with an empty request object
    const result = await client.voices.list({});
    const voices = (result.data.voices || []).map((voice) => {
      const language = Array.isArray(voice.languageCodes) && voice.languageCodes.length
        ? voice.languageCodes[0]
        : '';
      const name = voice.name || '';
      const gender = voice.ssmlGender || '';

      // Build a friendly display name e.g. "[en-US] WaveNet F (FEMALE)"
      let remainder = name.startsWith(`${language}-`)
        ? name.slice(language.length + 1)
        : name;
      const parts = remainder.split('-');
      const letter = parts.pop();
      const modelPart = parts.join(' ');

      const formatModel = (model) => {
        const lower = model.toLowerCase();
        if (lower === 'wavenet') return 'WaveNet';
        if (lower === 'standard') return 'Standard';
        if (lower === 'neural2') return 'Neural2';
        if (lower === 'polyglot') return 'Polyglot';
        return model.charAt(0).toUpperCase() + model.slice(1);
      };

      const displayNameModel = modelPart
        .split(' ')
        .filter(Boolean)
        .map(formatModel)
        .join(' ');

    const displayName = `[${language}] ${displayNameModel} ${letter} (${gender})`;

    return { name, language, gender, displayName };
  });
    res.json(voices);
  } catch (err) {
    console.error('[GET /api/google-tts/voices] Error:', err.message);
    res.status(500).json({ message: 'Failed to fetch voices' });
  }
}

router.get('/voices', listVoices);

async function synthesize(req, res) {
  const { text, voiceName, languageCode, pitch = 0, speed = 1 } = req.body || {};
  if (!text || !voiceName) {
    return res.status(400).json({ message: 'text and voiceName are required' });
  }
  try {
    const client = await getClient();
    const response = await client.text.synthesize({
      requestBody: {
        input: { text },
        voice: { name: voiceName, languageCode },
        audioConfig: { audioEncoding: 'MP3', pitch: Number(pitch), speakingRate: Number(speed) }
      }
    });
    res.json({ audioContent: response.data.audioContent });
  } catch (err) {
    console.error('[POST /api/google-tts/synthesize] Error:', err.message);
    res.status(500).json({ message: 'Failed to synthesize speech' });
  }
}

router.post('/synthesize', synthesize);

module.exports = router;
