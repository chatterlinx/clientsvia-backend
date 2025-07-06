// Test endpoints for Google TTS and Vertex AI connectivity
const express = require('express');
const { google } = require('googleapis');
const axios = require('axios');
const { TextToSpeechClient } = require('@google-cloud/text-to-speech');
const router = express.Router();
const { synthesizeSpeech } = require('../services/elevenLabsService');

// Initialize the Google TTS Client. It will automatically find your credentials.
const googleTtsClient = new TextToSpeechClient();

// Test Vertex AI model call
router.get('/vertex-ai', async (req, res) => {
  try {
    const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const authClient = await auth.getClient();
    const projectId = await auth.getProjectId();
    const aiplatform = google.aiplatform({ version: 'v1beta1', auth: authClient });
    const model = `projects/${projectId}/locations/us-central1/publishers/google/models/gemini-2.5-flash`; // Use the correct model
    const prompt = req.query.prompt || 'Say hello from Vertex AI!'; // Allow custom prompt
    const result = await aiplatform.projects.locations.publishers.models.generateContent({
      model,
      requestBody: {
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      }
    });
    res.json({ success: true, result: result.data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response' });
  } catch (err) {
    console.error('Vertex AI test error:', err.response?.data || err.message);
    res.status(500).json({ error: err.message, details: err.response?.data });
  }
});

// New route for direct Gemini testing
router.get('/gemini', async (req, res) => {
  try {
    const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const authClient = await auth.getClient();
    const projectId = await auth.getProjectId();
    const aiplatform = google.aiplatform({ version: 'v1beta1', auth: authClient });
    const model = `projects/${projectId}/locations/us-central1/publishers/google/models/gemini-2.5-flash`; // Use the correct model
    const prompt = req.query.prompt || 'What is the capital of France?'; // Default prompt

    console.log(`[Test Gemini] Sending prompt: ${prompt} to model: ${model}`);

    const result = await aiplatform.projects.locations.publishers.models.generateContent({
      model,
      requestBody: {
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      }
    });

    const geminiResponse = result.data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response from Gemini.';
    console.log(`[Test Gemini] Received response: ${geminiResponse}`);
    res.json({ success: true, response: geminiResponse });
  } catch (err) {
    console.error('Direct Gemini test error:', err.response?.data || err.message);
    res.status(500).json({ error: err.message, details: err.response?.data });
  }
});

// Test Google TTS call
router.get('/google-tts', async (req, res) => {
  try {
    const textToSynthesize = req.query.text || 'Hello from Google TTS!';
    const voiceName = req.query.voice || 'en-US-Wavenet-A'; // Use voice from query
    const pitch = parseFloat(req.query.pitch) || 0; // Use pitch from query
    const speakingRate = parseFloat(req.query.speed) || 1; // Use speed from query

    const request = {
      input: { text: textToSynthesize },
      voice: { languageCode: voiceName.substring(0, 5), name: voiceName }, // Extract languageCode and use voiceName
      audioConfig: { audioEncoding: 'MP3', pitch: pitch, speakingRate: speakingRate }, // Use pitch and speakingRate
    };

    const [response] = await googleTtsClient.synthesizeSpeech(request); // Use the initialized client
    res.json({ success: true, audioContent: response.audioContent.toString('base64') }); // Convert to base64
  } catch (err) {
    console.error('Google TTS test error:', err.response?.data || err.message);
    res.status(500).json({ error: err.message, details: err.response?.data });
  }
});

// POST /tts endpoint for Google and ElevenLabs TTS
router.post('/tts', async (req, res) => {
    // The frontend sends the provider, text, settings, and optional apiKey
    const { provider, text, settings, apiKey: suppliedKey } = req.body;

    const apiKey = suppliedKey || process.env.ELEVENLABS_API_KEY;

    if (!provider || !text || !settings) {
        return res.status(400).json({ message: 'Missing required parameters: provider, text, or settings.' });
    }

    try {
        let audioBuffer; // We will store the raw audio data here

        // --- GOOGLE TTS LOGIC ---
        if (provider === 'google') {
            console.log('Synthesizing with Google TTS with settings:', settings);
            const request = {
                input: { text: text },
                voice: { 
                    languageCode: 'en-US', // You can make this dynamic later if needed
                    name: settings.voiceName 
                },
                audioConfig: { 
                    audioEncoding: 'MP3',
                    speakingRate: settings.speed,
                    pitch: settings.pitch
                },
            };
            
            const [response] = await googleTtsClient.synthesizeSpeech(request);
            audioBuffer = response.audioContent;
        } 
        
        // --- ELEVENLABS TTS LOGIC ---
        else if (provider === 'elevenlabs') {
            console.log('Synthesizing with ElevenLabs with settings:', settings);
            if (!settings.voiceId) {
                return res.status(400).json({ message: 'Voice ID is required for ElevenLabs.' });
            }

            const buffer = await synthesizeSpeech({
                text,
                voiceId: settings.voiceId,
                stability: settings.stability,
                similarity_boost: settings.clarity,
                style: settings.style,
                model_id: settings.modelId,
                apiKey
            });
            audioBuffer = Buffer.from(buffer);
        }

        else {
            return res.status(400).json({ message: 'Invalid TTS provider specified.' });
        }

        // Send the audio content back to the frontend as raw MP3 data
        res.set('Content-Type', 'audio/mpeg');
        res.status(200).send(audioBuffer);

    } catch (error) {
        // Log the detailed error on the server
        const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error(`Error in /api/test/tts for provider ${provider}:`, errorMessage);
        
        // Send a generic error message to the client
        res.status(500).json({ message: `Failed to synthesize speech. ${errorMessage}` });
    }
});

module.exports = router;
