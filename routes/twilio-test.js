const express = require('express');
const twilio = require('twilio');
const router = express.Router();

/**
 * @route POST /api/twilio-test/voice
 * @description A minimal webhook for Twilio to test raw response time.
 * It bypasses all application logic, database lookups, and AI processing.
 */
router.post('/voice', (req, res) => {
  console.log(`[Twilio Test] Received call at ${new Date().toISOString()}`);
  const twiml = new twilio.twiml.VoiceResponse();

  // Use <Gather> to detect when Twilio processes the response.
  // The prompt inside <Gather> is what the user will hear.
  const gather = twiml.gather({
    input: 'speech',
    action: '/api/twilio-test/handle-speech', // This endpoint will handle the user's speech
    method: 'POST',
  });
  gather.say('This is a direct connection test. Please say a few words after the beep.');

  // If the user doesn't say anything, hang up.
  twiml.hangup();

  res.type('text/xml');
  res.send(twiml.toString());
  console.log(`[Twilio Test] Sent TwiML response at ${new Date().toISOString()}`);
});

/**
 * @route POST /api/twilio-test/handle-speech
 * @description Handles the speech input from the /voice test endpoint.
 */
router.post('/handle-speech', (req, res) => {
    console.log(`[Twilio Test] Received speech response at ${new Date().toISOString()}`);
    const speechText = req.body.SpeechResult || 'nothing';
    const twiml = new twilio.twiml.VoiceResponse();

    twiml.say(`Your speech was received. The test is complete. Goodbye.`);
    twiml.hangup();

    res.type('text/xml');
    res.send(twiml.toString());
    console.log(`[Twilio Test] Sent final TwiML at ${new Date().toISOString()}`);
});

module.exports = router;
