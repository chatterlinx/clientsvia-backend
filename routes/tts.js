const express = require('express');
const { getAvailableVoices } = require('../services/elevenLabsService');
const router = express.Router();
const { getDB } = require('../db');
const { ObjectId } = require('mongodb');

async function getVoices(req, res) {
    const { companyId, apiKey } = req.query;

    try {
        const db = getDB();
        const company = await db.collection('companiesCollection').findOne({ _id: new ObjectId(companyId) });
        
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

router.get('/voices', getVoices);

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

