const express = require('express');
const twilio = require('twilio');
const { redisClient } = require('../clients');
const { normalizePhoneNumber } = require('../utils/phone');
const { answerQuestion } = require('../services/agent');
const { synthesizeSpeech } = require('../services/elevenLabsService');
const { getCompanyByPhoneNumber } = require('./twilio');
const path = require('path');
const fs = require('fs');

const router = express.Router();

/**
 * @route POST /api/twilio-test-step5/voice
 * @description Initial endpoint for the audio serving test.
 */
router.post('/voice', async (req, res) => {
  console.log(`[Twilio Test Step 5] Initializing call.`);
  const twiml = new twilio.twiml.VoiceResponse();

  const gather = twiml.gather({
    input: 'speech',
    action: '/api/twilio-test-step5/handle-speech',
    method: 'POST',
  });
  gather.say('Step 5 test. Ask a question to test audio serving speed.');

  twiml.hangup();
  res.type('text/xml');
  res.send(twiml.toString());
});

/**
 * @route POST /api/twilio-test-step5/handle-speech
 * @description Tests the complete pipeline including audio serving.
 */
router.post('/handle-speech', async (req, res) => {
    const fullStartTime = Date.now();
    console.log(`[Twilio Test Step 5] Received speech: "${req.body.SpeechResult}"`);
    const twiml = new twilio.twiml.VoiceResponse();

    try {
        const speechText = req.body.SpeechResult || '';
        if (!speechText) {
            twiml.say("No speech detected. Test ended.");
            twiml.hangup();
            res.type('text/xml');
            return res.send(twiml.toString());
        }

        const calledNumber = normalizePhoneNumber(req.body.To);
        let company = await getCompanyByPhoneNumber(calledNumber);

        if (!company) {
            console.log(`[Twilio Test Step 5] Company not found for ${calledNumber}, using fallback test company`);
            const Company = require('../models/Company');
            company = await Company.findOne({ 'aiSettings.elevenLabs.voiceId': { $exists: true } }).lean().exec();
            
            if (!company) {
                twiml.say("No companies with ElevenLabs configuration found. Test ended.");
                twiml.hangup();
                res.type('text/xml');
                return res.send(twiml.toString());
            }
        }

        console.log(`[Twilio Test Step 5] Company found: ${company.companyName}`);

        // Step 1: AI Response Generation
        const aiStartTime = Date.now();
        const answerObj = await answerQuestion(
            company._id.toString(),
            speechText,
            company.aiSettings?.responseLength || 'concise',
            [{ role: 'user', text: speechText }],
            company.agentSetup?.mainAgentScript || '',
            company.aiSettings?.personality || 'friendly',
            company.agentSetup?.companySpecialties || '',
            company.agentSetup?.categoryQAs || '',
            req.body.CallSid
        );
        const aiEndTime = Date.now();
        const aiDuration = aiEndTime - aiStartTime;

        console.log(`[Twilio Test Step 5] AI processing took ${aiDuration}ms.`);

        // Step 2: TTS Generation
        const ttsStartTime = Date.now();
        const elevenLabsVoice = company.aiSettings?.elevenLabs?.voiceId;
        
        if (elevenLabsVoice) {
            const buffer = await synthesizeSpeech({
                text: answerObj.text,
                voiceId: elevenLabsVoice,
                stability: company.aiSettings.elevenLabs?.stability,
                similarity_boost: company.aiSettings.elevenLabs?.similarityBoost,
                style: company.aiSettings.elevenLabs?.style,
                model_id: company.aiSettings.elevenLabs?.modelId,
                company
            });
            const ttsEndTime = Date.now();
            const ttsDuration = ttsEndTime - ttsStartTime;

            console.log(`[Twilio Test Step 5] TTS processing took ${ttsDuration}ms.`);
            
            // Step 3: Audio File Storage (Test Both Methods)
            const storageStartTime = Date.now();
            
            // Method 1: Redis Cache (Fast)
            const audioKey = `audio:test:${req.body.CallSid}`;
            await redisClient.setEx(audioKey, 300, buffer.toString('base64'));
            
            // Method 2: File System (Slower)
            const fileName = `test_${req.body.CallSid}.mp3`;
            const audioDir = path.join(__dirname, '../public/audio');
            if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
            const filePath = path.join(audioDir, fileName);
            fs.writeFileSync(filePath, buffer);
            
            const storageEndTime = Date.now();
            const storageDuration = storageEndTime - storageStartTime;
            
            console.log(`[Twilio Test Step 5] Audio storage took ${storageDuration}ms.`);
            
            // Step 4: Tell Twilio to Play Audio (This is where the delay might be)
            const playStartTime = Date.now();
            console.log(`[Twilio Test Step 5] Telling Twilio to play audio at ${new Date().toISOString()}`);
            
            const gather = twiml.gather({
                input: 'speech',
                action: '/api/twilio-test-step5/audio-played',
                method: 'POST',
                timeout: 2
            });
            
            // Test the Redis-served audio (should be faster)
            const audioUrl = `https://${req.get('host')}/api/twilio/audio/test/${req.body.CallSid}`;
            console.log(`[Twilio Test Step 5] Audio URL: ${audioUrl}`);
            gather.play(audioUrl);
            
            // If no speech after the audio, say timing results
            const totalDuration = Date.now() - fullStartTime;
            console.log(`[Twilio Test Step 5] Total pipeline took ${totalDuration}ms.`);
            
            twiml.say(`Pipeline completed in ${Math.round(totalDuration/1000*10)/10} seconds. If audio played quickly, the delay is elsewhere.`);

        } else {
            twiml.say("No ElevenLabs voice configured. Test ended.");
        }

    } catch (error) {
        console.error('[Twilio Test Step 5] An error occurred:', error);
        twiml.say('An error occurred during the audio serving test.');
    }

    twiml.hangup();
    res.type('text/xml');
    res.send(twiml.toString());
    
    const finalTime = Date.now() - fullStartTime;
    console.log(`[Twilio Test Step 5] Response sent. Final processing time: ${finalTime}ms.`);
});

/**
 * @route POST /api/twilio-test-step5/audio-played
 * @description Called when the audio has been played or timeout reached.
 */
router.post('/audio-played', async (req, res) => {
    console.log(`[Twilio Test Step 5] Audio play completed or timed out at ${new Date().toISOString()}`);
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say("Audio test completed. Check logs for timing details.");
    twiml.hangup();
    res.type('text/xml');
    res.send(twiml.toString());
});

module.exports = router;
