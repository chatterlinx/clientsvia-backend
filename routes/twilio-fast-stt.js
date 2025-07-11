// Fast STT Replacement for Twilio Speech Recognition
// Uses Google Speech-to-Text instead of slow Twilio speech recognition
// Keeps existing ElevenLabs TTS and all other functionality
const express = require('express');
const twilio = require('twilio');
const speech = require('@google-cloud/speech');
const axios = require('axios');
const Company = require('../models/Company');
const { answerQuestion, loadCompanyQAs } = require('../services/agent');
const { synthesizeSpeech } = require('../services/elevenLabsService');
const { normalizePhoneNumber, extractDigits, numbersMatch } = require('../utils/phone');
const { applyPlaceholders } = require('../utils/placeholders');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Initialize Google Speech client
const speechClient = new speech.SpeechClient();

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

// Initial voice endpoint - streams audio to Google STT
router.post('/voice', async (req, res) => {
  try {
    console.log('[FAST-STT] Incoming call:', req.body);
    const calledNumber = normalizePhoneNumber(req.body.To);
    const company = await getCompanyByPhoneNumber(calledNumber);

    const twiml = new twilio.twiml.VoiceResponse();

    if (!company) {
      twiml.say('Sorry, we are experiencing technical difficulties. Please try again later.');
      twiml.hangup();
      res.type('text/xml');
      res.send(twiml.toString());
      return;
    }

    // Play greeting with ElevenLabs (same as your current system)
    const greetingType = company.agentSetup?.greetingType || 'tts';
    const placeholders = company.agentSetup?.placeholders || [];
    let rawGreeting = company.agentSetup?.agentGreeting || "Hello, thank you for calling. How can I help you today?";
    let greeting = applyPlaceholders(rawGreeting, placeholders);

    if (greetingType === 'audio' && company.agentSetup?.greetingAudioUrl) {
      twiml.play(company.agentSetup.greetingAudioUrl);
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
          twiml.say(greeting);
        }
      } else {
        twiml.say(greeting);
      }
    }

    // Start recording to capture speech for STT processing
    twiml.record({
      action: `https://${req.get('host')}/api/twilio-fast/handle-recording`,
      method: 'POST',
      maxLength: 30,
      timeout: 5,
      playBeep: false,
      transcribe: false
    });

    res.type('text/xml');
    res.send(twiml.toString());
  } catch (err) {
    console.error('[FAST-STT] Error:', err);
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Sorry, we are experiencing technical difficulties.');
    twiml.hangup();
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

// Handle recording and process with Google STT
router.post('/handle-recording', async (req, res) => {
  try {
    console.log('[FAST-STT] Recording received:', req.body);
    const recordingUrl = req.body.RecordingUrl;
    const calledNumber = normalizePhoneNumber(req.body.To);
    const company = await getCompanyByPhoneNumber(calledNumber);

    const twiml = new twilio.twiml.VoiceResponse();

    if (!recordingUrl) {
      twiml.say("I didn't hear anything. Please try again.");
      twiml.redirect(`https://${req.get('host')}/api/twilio-fast/voice`);
      res.type('text/xml');
      res.send(twiml.toString());
      return;
    }

    if (!company) {
      twiml.say('Sorry, we are experiencing technical difficulties.');
      twiml.hangup();
      res.type('text/xml');
      res.send(twiml.toString());
      return;
    }

    try {
      // Download and transcribe the recording with Google STT
      const axios = require('axios');
      const audioResponse = await axios.get(recordingUrl, { responseType: 'arraybuffer' });
      const audioBuffer = Buffer.from(audioResponse.data);

      console.log('[FAST-STT] Processing audio with Google STT...');
      const startTime = Date.now();

      const [response] = await speechClient.recognize({
        config: {
          encoding: 'MULAW',
          sampleRateHertz: 8000,
          languageCode: 'en-US',
          model: 'phone_call'
        },
        audio: {
          content: audioBuffer.toString('base64')
        }
      });

      const transcript = response.results
        .map(result => result.alternatives[0].transcript)
        .join('\n');

      const sttTime = Date.now() - startTime;
      console.log(`[FAST-STT] Transcript: "${transcript}" (${sttTime}ms)`);

      if (!transcript || !transcript.trim()) {
        twiml.say("I didn't catch that. Could you please repeat?");
        twiml.record({
          action: `https://${req.get('host')}/api/twilio-fast/handle-recording`,
          method: 'POST',
          maxLength: 30,
          timeout: 5,
          playBeep: false,
          transcribe: false
        });
        res.type('text/xml');
        res.send(twiml.toString());
        return;
      }

      // Process with AI (same logic as original)
      await loadCompanyQAs(company);
      const aiResponse = await answerQuestion(transcript, company);
      const aiTime = Date.now() - startTime;
      console.log(`[FAST-STT] AI response: "${aiResponse}" (${aiTime}ms)`);

      // Generate TTS with ElevenLabs
      const elevenLabsVoice = company.aiSettings?.elevenLabs?.voiceId;
      if (elevenLabsVoice) {
        try {
          const buffer = await synthesizeSpeech({
            text: aiResponse,
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
          console.log(`[FAST-STT] Total response time: ${totalTime}ms`);
        } catch (err) {
          console.error('[FAST-STT] TTS error:', err);
          twiml.say(aiResponse);
        }
      } else {
        twiml.say(aiResponse);
      }

      // Continue the conversation
      twiml.record({
        action: `https://${req.get('host')}/api/twilio-fast/handle-recording`,
        method: 'POST',
        maxLength: 30,
        timeout: 5,
        playBeep: false,
        transcribe: false
      });

    } catch (err) {
      console.error('[FAST-STT] Processing error:', err);
      twiml.say("I'm sorry, I'm having trouble understanding. Could you please try again?");
      twiml.record({
        action: `https://${req.get('host')}/api/twilio-fast/handle-recording`,
        method: 'POST',
        maxLength: 30,
        timeout: 5,
        playBeep: false,
        transcribe: false
      });
    }

    res.type('text/xml');
    res.send(twiml.toString());
  } catch (err) {
    console.error('[FAST-STT] Error:', err);
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Sorry, we are experiencing technical difficulties.');
    twiml.hangup();
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

module.exports = router;
