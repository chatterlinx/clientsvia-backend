// Simple Fast STT - Replace Twilio STT with Google STT
// Keep everything else exactly the same as original
const express = require('express');
const twilio = require('twilio');
const Company = require('../models/Company');
const { answerQuestion, loadCompanyQAs } = require('../services/agent');
const { synthesizeSpeech } = require('../services/elevenLabsService');
const { normalizePhoneNumber, extractDigits, numbersMatch } = require('../utils/phone');
const { applyPlaceholders } = require('../utils/placeholders');
const { getRandomPersonalityResponse, getPersonalityResponse } = require('../utils/personalityResponses_enhanced');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Helper function to get company data (same as original)
async function getCompanyByPhoneNumber(phoneNumber) {
  try {
    const digits = extractDigits(phoneNumber);
    const digitsNoCountry = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    const searchNumbers = [phoneNumber, digits, digitsNoCountry].filter(Boolean);

    let company = await Company.findOne({ 'twilioConfig.phoneNumber': { $in: searchNumbers } }).exec();
    if (!company) {
      const all = await Company.find({ 'twilioConfig.phoneNumber': { $ne: null } }).exec();
      company = all.find((c) => numbersMatch(c.twilioConfig.phoneNumber, phoneNumber));
    }
    return company;
  } catch (err) {
    console.error('Error fetching company:', err);
    return null;
  }
}

// Helper function to escape text for TwiML Say verb (same as original)
function escapeTwiML(text) {
  if (!text) return '';
  return text.replace(/&/g, '&amp;')
             .replace(/</g, '&lt;')
             .replace(/>/g, '&gt;');
}

// Voice endpoint - exactly like original but with recording instead of speech
router.post('/voice', async (req, res) => {
  try {
    console.log('[SIMPLE-FAST] Incoming call:', req.body);
    const calledNumber = normalizePhoneNumber(req.body.To);
    let company = await getCompanyByPhoneNumber(calledNumber);

    const twiml = new twilio.twiml.VoiceResponse();

    if (!company) {
      const msg = await getRandomPersonalityResponse(null, 'connectionTrouble');
      twiml.say(escapeTwiML(msg));
      twiml.hangup();
      res.type('text/xml');
      res.send(twiml.toString());
      return;
    }

    const greetingType = company.agentSetup?.greetingType || 'tts';
    const greetingAudioUrl = company.agentSetup?.greetingAudioUrl || '';
    
    const placeholders = company.agentSetup?.placeholders || [];
    let rawGreeting = company.agentSetup?.agentGreeting || "Hello, thank you for calling. How can I help you today?";
    let greeting = applyPlaceholders(rawGreeting, placeholders);
    
    console.log(`[SIMPLE-FAST] Greeting type: ${greetingType}`);

    // Play greeting exactly like original
    if (greetingType === 'audio' && greetingAudioUrl) {
      twiml.play(greetingAudioUrl);
    } else {
      const elevenLabsVoice = company.aiSettings?.elevenLabs?.voiceId;
      if (elevenLabsVoice) {
        try {
          const buffer = await synthesizeSpeech({
            text: greeting,
            voiceId: elevenLabsVoice,
            stability: company.aiSettings.elevenLabs?.stability,
            similarity_boost: company.aiSettings.elevenLabs?.similarityBoost,
            style: company.aiSettings.elevenLabs?.style,
            model_id: company.aiSettings.elevenLabs?.modelId,
            company
          });
          const fileName = `greet_${Date.now()}.mp3`;
          const audioDir = path.join(__dirname, '../public/audio');
          if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
          const filePath = path.join(audioDir, fileName);
          fs.writeFileSync(filePath, buffer);
          twiml.play(`${req.protocol}://${req.get('host')}/audio/${fileName}`);
        } catch (err) {
          console.error('ElevenLabs TTS failed:', err);
          twiml.say(escapeTwiML(greeting));
        }
      } else {
        twiml.say(escapeTwiML(greeting));
      }
    }

    // Use simple recording instead of speech recognition
    twiml.record({
      action: `https://${req.get('host')}/api/twilio-simple/handle-recording`,
      method: 'POST',
      maxLength: 30,
      timeout: 8,
      playBeep: false,
      transcribe: false
    });

    res.type('text/xml');
    res.send(twiml.toString());
  } catch (err) {
    console.error('[SIMPLE-FAST] Error:', err);
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Sorry, we are experiencing technical difficulties.');
    twiml.hangup();
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

// Handle recording - process with OpenAI Whisper instead of Google STT
router.post('/handle-recording', async (req, res) => {
  const startTime = Date.now();
  try {
    console.log('[SIMPLE-FAST] Recording received:', req.body);
    const recordingUrl = req.body.RecordingUrl;
    const calledNumber = normalizePhoneNumber(req.body.To);
    let company = await getCompanyByPhoneNumber(calledNumber);

    const twiml = new twilio.twiml.VoiceResponse();

    if (!recordingUrl) {
      console.log('[SIMPLE-FAST] No recording URL received');
      const msg = await getRandomPersonalityResponse(null, 'cantUnderstand');
      twiml.say(escapeTwiML(msg));
      twiml.record({
        action: `https://${req.get('host')}/api/twilio-simple/handle-recording`,
        method: 'POST',
        maxLength: 30,
        timeout: 8,
        playBeep: false,
        transcribe: false
      });
      res.type('text/xml');
      res.send(twiml.toString());
      return;
    }

    if (!company) {
      const msg = await getRandomPersonalityResponse(null, 'connectionTrouble');
      twiml.say(escapeTwiML(msg));
      twiml.hangup();
      res.type('text/xml');
      res.send(twiml.toString());
      return;
    }

    try {
      // Use OpenAI Whisper for transcription (faster setup than Google)
      const OpenAI = require('openai');
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const axios = require('axios');

      console.log('[SIMPLE-FAST] Downloading recording...');
      const audioResponse = await axios.get(recordingUrl, { responseType: 'stream' });
      
      console.log('[SIMPLE-FAST] Transcribing with Whisper...');
      const transcription = await openai.audio.transcriptions.create({
        file: audioResponse.data,
        model: 'whisper-1'
      });

      const speechText = transcription.text;
      const transcribeTime = Date.now() - startTime;
      console.log(`[SIMPLE-FAST] Transcript: "${speechText}" (${transcribeTime}ms)`);

      if (!speechText || !speechText.trim()) {
        const msg = await getRandomPersonalityResponse(null, 'cantUnderstand');
        twiml.say(escapeTwiML(msg));
        twiml.record({
          action: `https://${req.get('host')}/api/twilio-simple/handle-recording`,
          method: 'POST',
          maxLength: 30,
          timeout: 8,
          playBeep: false,
          transcribe: false
        });
        res.type('text/xml');
        res.send(twiml.toString());
        return;
      }

      // Process with AI (same as original)
      await loadCompanyQAs(company);
      const response = await answerQuestion(speechText, company);
      const aiTime = Date.now() - startTime;
      console.log(`[SIMPLE-FAST] AI response generated in ${aiTime}ms`);

      // Generate TTS with ElevenLabs (same as original)
      const elevenLabsVoice = company.aiSettings?.elevenLabs?.voiceId;
      if (elevenLabsVoice) {
        try {
          const buffer = await synthesizeSpeech({
            text: response,
            voiceId: elevenLabsVoice,
            stability: company.aiSettings.elevenLabs?.stability,
            similarity_boost: company.aiSettings.elevenLabs?.similarityBoost,
            style: company.aiSettings.elevenLabs?.style,
            model_id: company.aiSettings.elevenLabs?.modelId,
            company
          });
          const fileName = `response_${Date.now()}.mp3`;
          const audioDir = path.join(__dirname, '../public/audio');
          if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
          const filePath = path.join(audioDir, fileName);
          fs.writeFileSync(filePath, buffer);
          twiml.play(`${req.protocol}://${req.get('host')}/audio/${fileName}`);
          
          const totalTime = Date.now() - startTime;
          console.log(`[SIMPLE-FAST] Total response time: ${totalTime}ms`);
        } catch (err) {
          console.error('ElevenLabs TTS failed:', err);
          twiml.say(escapeTwiML(response));
        }
      } else {
        twiml.say(escapeTwiML(response));
      }

      // Continue conversation
      twiml.record({
        action: `https://${req.get('host')}/api/twilio-simple/handle-recording`,
        method: 'POST',
        maxLength: 30,
        timeout: 8,
        playBeep: false,
        transcribe: false
      });

    } catch (err) {
      console.error('[SIMPLE-FAST] Transcription error:', err);
      const msg = await getRandomPersonalityResponse(null, 'cantUnderstand');
      twiml.say(escapeTwiML(msg));
      twiml.record({
        action: `https://${req.get('host')}/api/twilio-simple/handle-recording`,
        method: 'POST',
        maxLength: 30,
        timeout: 8,
        playBeep: false,
        transcribe: false
      });
    }

    res.type('text/xml');
    res.send(twiml.toString());
    
    const endTime = Date.now();
    console.log(`[SIMPLE-FAST] Total processing time: ${endTime - startTime}ms`);
  } catch (err) {
    console.error('[SIMPLE-FAST] Error:', err);
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Sorry, we are experiencing technical difficulties.');
    twiml.hangup();
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

module.exports = router;
