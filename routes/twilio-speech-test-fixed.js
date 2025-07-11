// Fixed speech recognition test routes
const express = require('express');
const twilio = require('twilio');
const router = express.Router();

// Test 1: Basic speech recognition with minimal settings
router.post('/basic', (req, res) => {
  console.log(`[SPEECH-TEST] Basic speech test called at: ${new Date().toISOString()}`);
  
  const twiml = new twilio.twiml.VoiceResponse();
  const gather = twiml.gather({
    input: 'speech',
    action: '/api/twilio-speech-test/result',
    method: 'POST',
    timeout: 3
  });
  
  gather.say('Basic speech test. Say hello quickly.');
  
  res.type('text/xml').send(twiml.toString());
});

// Test 2: Speech with language specified
router.post('/with-language', (req, res) => {
  console.log(`[SPEECH-TEST] Language-specified speech test called at: ${new Date().toISOString()}`);
  
  const twiml = new twilio.twiml.VoiceResponse();
  const gather = twiml.gather({
    input: 'speech',
    action: '/api/twilio-speech-test/result',
    method: 'POST',
    timeout: 5,
    language: 'en-US'
  });
  
  gather.say('Language test. Say hello.');
  
  res.type('text/xml').send(twiml.toString());
});

// Test 3: DTMF only (no speech) - guaranteed fast
router.post('/dtmf-only', (req, res) => {
  console.log(`[SPEECH-TEST] DTMF test called at: ${new Date().toISOString()}`);
  
  const twiml = new twilio.twiml.VoiceResponse();
  const gather = twiml.gather({
    input: 'dtmf',
    action: '/api/twilio-speech-test/result',
    method: 'POST',
    timeout: 10,
    numDigits: 1
  });
  
  gather.say('DTMF test. Press any number key.');
  
  res.type('text/xml').send(twiml.toString());
});

// Result handler
router.post('/result', (req, res) => {
  console.log(`[SPEECH-TEST] Result received at: ${new Date().toISOString()}`);
  console.log(`[SPEECH-TEST] Speech: "${req.body.SpeechResult}"`);
  console.log(`[SPEECH-TEST] Digits: "${req.body.Digits}"`);
  
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say('Test complete. Good bye.');
  
  res.type('text/xml').send(twiml.toString());
});

module.exports = router;
