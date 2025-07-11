// SOLUTION: Hybrid DTMF + Speech for instant responses
const express = require('express');
const twilio = require('twilio');
const Company = require('../models/Company');
const { answerQuestion } = require('../services/agent');
const { redisClient } = require('../clients');
const { stripMarkdown, cleanTextForTTS } = require('../utils/textUtils');
const { getPersonalityResponse } = require('../utils/personalityResponses_enhanced');

const router = express.Router();

// Helper function to escape text for TwiML
function escapeTwiML(text) {
  if (!text) return '';
  return text.replace(/&/g, '&amp;')
             .replace(/</g, '&lt;')
             .replace(/>/g, '&gt;');
}

// Helper function to get company data
async function getCompanyByPhoneNumber(phoneNumber) {
  // Same logic as original twilio.js
  const cacheKey = `company-phone:${phoneNumber}`;
  try {
    const cachedCompany = await redisClient.get(cacheKey);
    if (cachedCompany) {
      return JSON.parse(cachedCompany);
    }
    
    const company = await Company.findOne({ 'twilioConfig.phoneNumber': phoneNumber }).exec();
    if (company) {
      await redisClient.setEx(cacheKey, 3600, JSON.stringify(company));
    }
    return company;
  } catch (error) {
    console.error('Error getting company:', error);
    return null;
  }
}

// FAST INITIAL RESPONSE: DTMF Menu
router.post('/voice', async (req, res) => {
  const calledNumber = req.body.To;
  const fromNumber = req.body.From;
  const callSid = req.body.CallSid;
  
  console.log(`[FAST-TWILIO] Call received: ${fromNumber} → ${calledNumber} (${callSid})`);
  
  try {
    let company = await getCompanyByPhoneNumber(calledNumber);
    
    if (!company) {
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say('Sorry, this number is not configured. Please contact support.');
      twiml.hangup();
      return res.type('text/xml').send(twiml.toString());
    }
    
    const twiml = new twilio.twiml.VoiceResponse();
    
    // INSTANT DTMF MENU (No delay!)
    const gather = twiml.gather({
      input: 'dtmf',
      action: '/api/twilio-fast/handle-selection',
      method: 'POST',
      timeout: 15,
      numDigits: 1
    });
    
    // Greeting + instant menu
    const greeting = company.agentSetup?.agentGreeting || 
      `Hello! You've reached ${company.name}. For faster service, please select:`;
    
    gather.say(`${greeting} Press 1 for sales, 2 for support, 3 for scheduling, or 9 to speak naturally with our AI assistant.`);
    
    // Fallback if no selection
    twiml.redirect('/api/twilio-fast/handle-selection?Digits=9');
    
    res.type('text/xml').send(twiml.toString());
    
  } catch (error) {
    console.error('[FAST-TWILIO] Error in voice handler:', error);
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Sorry, there was an error. Please try again.');
    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
  }
});

// HANDLE DTMF SELECTION (Still fast!)
router.post('/handle-selection', async (req, res) => {
  const selection = req.body.Digits;
  const calledNumber = req.body.To;
  const callSid = req.body.CallSid;
  
  console.log(`[FAST-TWILIO] Selection received: ${selection} for ${callSid}`);
  
  try {
    const company = await getCompanyByPhoneNumber(calledNumber);
    const twiml = new twilio.twiml.VoiceResponse();
    
    switch(selection) {
      case '1': // Sales
        twiml.say('Connecting you to our sales team. Please hold.');
        // Add your transfer logic here
        if (company.agentSetup?.onCallForwardingNumber) {
          twiml.dial(company.agentSetup.onCallForwardingNumber);
        } else {
          twiml.say('Please call back during business hours or leave a message after the beep.');
          twiml.record({ timeout: 30, transcribe: true });
        }
        break;
        
      case '2': // Support
        twiml.say('Connecting you to technical support. Please hold.');
        if (company.agentSetup?.onCallForwardingNumber) {
          twiml.dial(company.agentSetup.onCallForwardingNumber);
        } else {
          twiml.say('Please leave a detailed message after the beep.');
          twiml.record({ timeout: 30, transcribe: true });
        }
        break;
        
      case '3': // Scheduling
        twiml.say('For scheduling, please visit our website or call during business hours.');
        twiml.hangup();
        break;
        
      case '9': // AI Assistant (This will use speech recognition)
      default:
        const gather = twiml.gather({
          input: 'speech',
          action: '/api/twilio-fast/handle-speech',
          method: 'POST',
          timeout: 8,
          language: 'en-US'
        });
        
        gather.say('You can now speak naturally. What can I help you with?');
        twiml.redirect('/api/twilio-fast/handle-selection?Digits=0'); // Fallback
        break;
    }
    
    res.type('text/xml').send(twiml.toString());
    
  } catch (error) {
    console.error('[FAST-TWILIO] Error in selection handler:', error);
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Sorry, there was an error. Please try again.');
    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
  }
});

// SPEECH HANDLER (Only used if user selects option 9)
router.post('/handle-speech', async (req, res) => {
  const speechResult = req.body.SpeechResult;
  const calledNumber = req.body.To;
  const callSid = req.body.CallSid;
  
  console.log(`[FAST-TWILIO] Speech received: "${speechResult}" for ${callSid}`);
  
  try {
    const company = await getCompanyByPhoneNumber(calledNumber);
    
    if (!speechResult || speechResult.trim() === '') {
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say('I didn\'t hear anything. Please call back or press 0 to speak with someone.');
      twiml.hangup();
      return res.type('text/xml').send(twiml.toString());
    }
    
    // Process with AI (this part will still take 1-2 seconds, but only for users who choose speech)
    const answerObj = await answerQuestion(
      company._id.toString(),
      speechResult,
      [],
      company.agentSetup?.categories || [],
      company.agentSetup?.companySpecialties || '',
      callSid
    );
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({
      input: 'speech',
      action: '/api/twilio-fast/handle-speech',
      method: 'POST',
      timeout: 8,
      language: 'en-US'
    });
    
    const cleanAnswer = cleanTextForTTS(stripMarkdown(answerObj.text));
    gather.say(escapeTwiML(cleanAnswer));
    
    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
    
  } catch (error) {
    console.error('[FAST-TWILIO] Error in speech handler:', error);
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Sorry, there was an error processing your request.');
    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
  }
});

module.exports = router;
