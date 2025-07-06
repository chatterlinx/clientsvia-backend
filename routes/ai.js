// AI Model Listing Route
const express = require('express');
const router = express.Router();

// Provide a stable list of supported Gemini models
function listModels(req, res) {
  try {
    const models = [
      { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash (High Speed)' }
    ];
    res.status(200).json(models);
  } catch (error) {
    console.error('Error in /ai/models:', error);
    res.status(500).json({ message: 'Failed to load AI models.' });
  }
}

router.get('/models', listModels);

module.exports = router;
