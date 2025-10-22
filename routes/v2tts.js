const express = require('express');
const { getAvailableVoices } = require('../services/v2elevenLabsService');
const router = express.Router();
const { getDB } = require('../db');
const { ObjectId } = require('mongodb');

async function getVoices(req, res) {
    // Get parameters from either query params (GET) or body (POST)
    const params = req.method === 'GET' ? req.query : req.body;
    const { companyId, apiKey, provider = 'elevenlabs' } = params;
    
    console.log(`TTS Voices Request - Method: ${req.method}, Provider: ${provider}, CompanyId: ${companyId}`);

    try {
        const db = getDB();
        const company = await db.collection('companiesCollection').findOne({ _id: new ObjectId(companyId) });
        
        // Check for available API keys from different sources
        const companyKey = company?.aiSettings?.elevenLabs?.apiKey;
        const envKey = process.env.ELEVENLABS_API_KEY;
        
        console.log(`API Key sources - Request: ${Boolean(apiKey)}, Company: ${Boolean(companyKey)}, Env: ${Boolean(envKey)}`);
        
        if (!apiKey && !companyKey && !envKey) {
            console.log('No ElevenLabs API key found from any source');
            return res.status(503).json({ 
                message: 'ElevenLabs API key not configured. Please enter your API key to load voices.',
                error: 'API_KEY_REQUIRED'
            });
        }
        
        const voices = await getAvailableVoices({ apiKey, company });
        const formattedVoices = voices.map(v => ({ id: v.voice_id, displayName: `${v.name} (${v.labels?.gender || 'N/A'})` }));
        return res.status(200).json(formattedVoices);
    } catch (error) {
        console.error('ElevenLabs API Error:', error.message);
        
        // Check if it's an authentication error
        if (error.message.includes('not configured') || error.message.includes('API key')) {
            return res.status(503).json({ 
                message: 'ElevenLabs API key not configured. Please enter your API key to load voices.',
                error: 'API_KEY_REQUIRED'
            });
        }
        
        return res.status(500).json({ message: 'Failed to fetch ElevenLabs voices.' });
    }
}

router.get('/voices', getVoices);
router.post('/voices', getVoices); // Use same handler for POST requests

async function postVoices(req, res) {
    const { companyId, apiKey } = req.body || {};

    try {
        const db = getDB();
        const company = companyId ? await db.collection('companiesCollection').findOne({ _id: new ObjectId(companyId) }) : null;
        
        // Check if API key is available
        if (!apiKey && (!company || !company.aiSettings?.elevenLabs?.apiKey)) {
            return res.status(503).json({ 
                message: 'ElevenLabs API key not configured. Please enter your API key to load voices.',
                error: 'API_KEY_REQUIRED'
            });
        }
        
        const voices = await getAvailableVoices({ apiKey, company });
        const formattedVoices = voices.map(v => ({ id: v.voice_id, displayName: `${v.name} (${v.labels?.gender || 'N/A'})` }));
        return res.status(200).json(formattedVoices);
    } catch (error) {
        console.error('ElevenLabs API Error:', error.message);
        
        // Check if it's an authentication error
        if (error.message.includes('not configured') || error.message.includes('API key')) {
            return res.status(503).json({ 
                message: 'ElevenLabs API key not configured. Please enter your API key to load voices.',
                error: 'API_KEY_REQUIRED'
            });
        }
        
        return res.status(500).json({ message: 'Failed to fetch ElevenLabs voices.' });
    }
}

router.post('/voices', postVoices);

module.exports = router;

