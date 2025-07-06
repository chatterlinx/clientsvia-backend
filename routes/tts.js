const express = require('express');
const fetch = require('node-fetch');
const { getAvailableVoices } = require('../services/elevenLabsService');
const router = express.Router();
const { getDB } = require('../db');
const { ObjectId } = require('mongodb');

async function getVoices(req, res) {
    const { provider, companyId, apiKey } = req.query;

    if (provider === 'google') {
        try {
            const googleVoices = [
                { id: 'en-US-Wavenet-A', displayName: 'Google WaveNet A (Female)' },
                { id: 'en-US-Wavenet-B', displayName: 'Google WaveNet B (Male)' },
                { id: 'en-US-Wavenet-C', displayName: 'Google WaveNet C (Female)' },
                { id: 'en-US-Wavenet-D', displayName: 'Google WaveNet D (Male)' },
                { id: 'en-US-Studio-M', displayName: 'Google Studio M (Male)' },
                { id: 'en-US-Studio-O', displayName: 'Google Studio O (Female)' },
            ];
            return res.status(200).json(googleVoices);
        } catch (error) {
            return res.status(500).json({ message: 'Failed to fetch Google voices.' });
        }
    } else if (provider === 'elevenlabs') {
        try {
            const db = getDB();
            const company = await db.collection('companiesCollection').findOne({ _id: new ObjectId(companyId) });
            const voices = await getAvailableVoices({ apiKey, company });
            const formattedVoices = voices.map(v => ({ id: v.voice_id, displayName: `${v.name} (${v.labels?.gender || 'N/A'})` }));
            return res.status(200).json(formattedVoices);
        } catch (error) {
            console.error('ElevenLabs API Error:', error.message);
            return res.status(500).json({ message: 'Failed to fetch ElevenLabs voices.' });
        }
    }

    return res.status(400).json({ message: 'Invalid TTS provider specified.' });
}

router.get('/voices', getVoices);

async function postVoices(req, res) {
    const { provider, companyId, apiKey } = req.body || {};

    if (provider === 'google') {
        try {
            const googleVoices = [
                { id: 'en-US-Wavenet-A', displayName: 'Google WaveNet A (Female)' },
                { id: 'en-US-Wavenet-B', displayName: 'Google WaveNet B (Male)' },
                { id: 'en-US-Wavenet-C', displayName: 'Google WaveNet C (Female)' },
                { id: 'en-US-Wavenet-D', displayName: 'Google WaveNet D (Male)' },
                { id: 'en-US-Studio-M', displayName: 'Google Studio M (Male)' },
                { id: 'en-US-Studio-O', displayName: 'Google Studio O (Female)' },
            ];
            return res.status(200).json(googleVoices);
        } catch (error) {
            return res.status(500).json({ message: 'Failed to fetch Google voices.' });
        }
    } else if (provider === 'elevenlabs') {
        try {
            const db = getDB();
            const company = companyId ? await db.collection('companiesCollection').findOne({ _id: new ObjectId(companyId) }) : null;
            const voices = await getAvailableVoices({ apiKey, company });
            const formattedVoices = voices.map(v => ({ id: v.voice_id, displayName: `${v.name} (${v.labels?.gender || 'N/A'})` }));
            return res.status(200).json(formattedVoices);
        } catch (error) {
            console.error('ElevenLabs API Error:', error.message);
            return res.status(500).json({ message: 'Failed to fetch ElevenLabs voices.' });
        }
    }

    return res.status(400).json({ message: 'Invalid TTS provider specified.' });
}

router.post('/voices', postVoices);

module.exports = router;

