const express = require('express');
const twilio = require('twilio');
const Company = require('../models/Company');
const { redisClient } = require('../clients');
const { normalizePhoneNumber } = require('../utils/phone');
const { answerQuestion } = require('../services/agent');
const { getCompanyByPhoneNumber } = require('./twilio');

const router = express.Router();

/**
 * @route POST /api/twilio-test-step3/voice
 * @description Initial endpoint for the AI response time test.
 */
router.post('/voice', async (req, res) => {
  console.log(`[Twilio Test Step 3] Initializing call.`);
  const twiml = new twilio.twiml.VoiceResponse();

  // Use <Gather> to collect speech
  const gather = twiml.gather({
    input: 'speech',
    action: '/api/twilio-test-step3/handle-speech',
    method: 'POST',
  });
  gather.say('Step 3 test. Please ask a question after the beep.');

  // If the user doesn't say anything, hang up.
  twiml.hangup();

  res.type('text/xml');
  res.send(twiml.toString());
});

/**
 * @route POST /api/twilio-test-step3/handle-speech
 * @description Measures the time taken by the answerQuestion service.
 */
router.post('/handle-speech', async (req, res) => {
    const startTime = Date.now();
    console.log(`[Twilio Test Step 3] Received speech: "${req.body.SpeechResult}"`);
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
        const company = await getCompanyByPhoneNumber(calledNumber);

        if (!company) {
            twiml.say("Could not find company for this number. Test ended.");
            twiml.hangup();
            res.type('text/xml');
            return res.send(twiml.toString());
        }
        console.log(`[Twilio Test Step 3] Company found: ${company.companyName}`);

        // --- TIMING THE AI SERVICE ---
        const aiStartTime = Date.now();
        const answerObj = await answerQuestion(
            company._id.toString(),
            speechText,
            company.aiSettings?.responseLength || 'concise',
            [{ role: 'user', text: speechText }], // Simplified history
            company.agentSetup?.mainAgentScript || '',
            company.aiSettings?.personality || 'friendly',
            company.agentSetup?.companySpecialties || '',
            company.agentSetup?.categoryQAs || '',
            req.body.CallSid
        );
        const aiEndTime = Date.now();
        const aiDuration = (aiEndTime - aiStartTime) / 1000; // in seconds
        // -----------------------------

        console.log(`[Twilio Test Step 3] AI processing took ${aiDuration.toFixed(2)} seconds.`);
        console.log(`[Twilio Test Step 3] AI Response: "${answerObj.text}"`);

        twiml.say(`AI processing took ${aiDuration.toFixed(2)} seconds.`);
        twiml.hangup();

    } catch (error) {
        console.error('[Twilio Test Step 3] An error occurred:', error);
        twiml.say('An error occurred during the AI test.');
        twiml.hangup();
    }

    res.type('text/xml');
    res.send(twiml.toString());
    const totalTime = Date.now() - startTime;
    console.log(`[Twilio Test Step 3] Sent TwiML response. Total processing time: ${totalTime}ms.`);
});

module.exports = router;
