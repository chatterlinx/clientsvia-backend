// Test endpoints for Vertex AI connectivity
const express = require('express');
const { google } = require('googleapis');
const axios = require('axios');
const router = express.Router();
const { synthesizeSpeech } = require('../services/elevenLabsService');

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

// POST /tts endpoint for ElevenLabs TTS
router.post('/tts', async (req, res) => {
    const { text, settings, apiKey: suppliedKey } = req.body;
    const apiKey = suppliedKey || process.env.ELEVENLABS_API_KEY;

    if (!text || !settings) {
        return res.status(400).json({ message: 'Missing required parameters: text or settings.' });
    }

    try {
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

        // Send the audio content back to the frontend as raw MP3 data
        res.set('Content-Type', 'audio/mpeg');
        res.status(200).send(buffer);

    } catch (error) {
        // Log the detailed error on the server
        const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error(`Error in /api/test/tts:`, errorMessage);
        
        // Send a generic error message to the client
        res.status(500).json({ 
            message: 'Error synthesizing speech',
            error: errorMessage
        });
    }
});

module.exports = router;
