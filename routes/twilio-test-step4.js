const express = require('express');
const twilio = require('twilio');
const { redisClient } = require('../clients');
const { normalizePhoneNumber } = require('../utils/phone');
const { answerQuestion } = require('../services/agent');
const { synthesizeSpeech } = require('../services/elevenLabsService');
const { getCompanyByPhoneNumber } = require('./twilio');

const router = express.Router();

/**
 * @route POST /api/twilio-test-step4/voice
 * @description Initial endpoint for the full AI + TTS pipeline test.
 */
router.post('/voice', async (req, res) => {
  console.log(`[Twilio Test Step 4] Initializing call.`);
  const twiml = new twilio.twiml.VoiceResponse();

  const gather = twiml.gather({
    input: 'speech',
    action: '/api/twilio-test-step4/handle-speech',
    method: 'POST',
  });
  gather.say('Step 4 test. Ask a question that will NOT match Q&A entries.');

  twiml.hangup();
  res.type('text/xml');
  res.send(twiml.toString());
});

/**
 * @route POST /api/twilio-test-step4/handle-speech
 * @description Tests the full AI + TTS pipeline timing.
 */
router.post('/handle-speech', async (req, res) => {
    const fullStartTime = Date.now();
    console.log(`[Twilio Test Step 4] Received speech: "${req.body.SpeechResult}"`);
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
            console.log(`[Twilio Test Step 4] Company not found for ${calledNumber}, using fallback test company`);
            // Use a fallback company for testing - find any company in the database
            const Company = require('../models/Company');
            company = await Company.findOne({ 'aiSettings.elevenLabs.voiceId': { $exists: true } }).lean().exec();
            
            if (!company) {
                twiml.say("No companies with ElevenLabs configuration found. Test ended.");
                twiml.hangup();
                res.type('text/xml');
                return res.send(twiml.toString());
            }
        }

        console.log(`[Twilio Test Step 4] Company found: ${company.companyName}`);

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

        console.log(`[Twilio Test Step 4] AI processing took ${aiDuration}ms.`);

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

            console.log(`[Twilio Test Step 4] TTS processing took ${ttsDuration}ms.`);
            
            const totalDuration = Date.now() - fullStartTime;
            console.log(`[Twilio Test Step 4] Total pipeline took ${totalDuration}ms.`);

            twiml.say(`AI took ${Math.round(aiDuration/1000*10)/10} seconds. TTS took ${Math.round(ttsDuration/1000*10)/10} seconds. Total ${Math.round(totalDuration/1000*10)/10} seconds.`);
        } else {
            twiml.say("No ElevenLabs voice configured. Test ended.");
        }

    } catch (error) {
        console.error('[Twilio Test Step 4] An error occurred:', error);
        twiml.say('An error occurred during the full pipeline test.');
    }

    twiml.hangup();
    res.type('text/xml');
    res.send(twiml.toString());
    
    const finalTime = Date.now() - fullStartTime;
    console.log(`[Twilio Test Step 4] Response sent. Final processing time: ${finalTime}ms.`);
});

module.exports = router;
