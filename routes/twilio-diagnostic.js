// DIAGNOSTIC WEBHOOK - Logs exact timing to find delay source
const express = require('express');
const twilio = require('twilio');
const router = express.Router();

// Store timing data
let callTimings = {};

// Initial webhook - logs when Twilio first connects
router.post('/initial', (req, res) => {
  const callSid = req.body.CallSid;
  const timestamp = Date.now();
  
  console.log(`[DIAGNOSTIC] Initial webhook called at ${new Date(timestamp).toISOString()}`);
  console.log(`[DIAGNOSTIC] CallSid: ${callSid}`);
  
  callTimings[callSid] = {
    initialWebhook: timestamp,
    userSpeechStart: null,
    userSpeechEnd: null,
    responseStart: null,
    responseEnd: null
  };
  
  const twiml = new twilio.twiml.VoiceResponse();
  const gather = twiml.gather({
    input: 'speech',
    action: '/api/twilio-diagnostic/speech',
    method: 'POST',
    timeout: 8
  });
  
  gather.say('Diagnostic test. Please say hello.');
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// Speech webhook - logs when user speaks
router.post('/speech', (req, res) => {
  const callSid = req.body.CallSid;
  const timestamp = Date.now();
  
  console.log(`[DIAGNOSTIC] Speech webhook called at ${new Date(timestamp).toISOString()}`);
  console.log(`[DIAGNOSTIC] User said: "${req.body.SpeechResult}"`);
  
  if (callTimings[callSid]) {
    callTimings[callSid].userSpeechEnd = timestamp;
    callTimings[callSid].responseStart = timestamp;
    
    const timeSinceInitial = timestamp - callTimings[callSid].initialWebhook;
    console.log(`[DIAGNOSTIC] Time from initial webhook to speech: ${timeSinceInitial}ms`);
  }
  
  // Respond immediately with simple text
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say('I heard you. Timing test complete.');
  
  if (callTimings[callSid]) {
    callTimings[callSid].responseEnd = Date.now();
    
    const responseTime = callTimings[callSid].responseEnd - callTimings[callSid].responseStart;
    console.log(`[DIAGNOSTIC] Response processing time: ${responseTime}ms`);
    
    // Log complete timing breakdown
    console.log(`[DIAGNOSTIC] COMPLETE TIMING BREAKDOWN for ${callSid}:`);
    console.log(`[DIAGNOSTIC] - Initial webhook: ${new Date(callTimings[callSid].initialWebhook).toISOString()}`);
    console.log(`[DIAGNOSTIC] - Speech received: ${new Date(callTimings[callSid].userSpeechEnd).toISOString()}`);
    console.log(`[DIAGNOSTIC] - Response sent: ${new Date(callTimings[callSid].responseEnd).toISOString()}`);
    console.log(`[DIAGNOSTIC] - Total time: ${callTimings[callSid].responseEnd - callTimings[callSid].initialWebhook}ms`);
  }
  
  res.type('text/xml');
  res.send(twiml.toString());
});

module.exports = router;
