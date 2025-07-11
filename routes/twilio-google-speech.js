// SIMPLE SOLUTION: Replace Twilio Speech Recognition with Google Speech-to-Text
// This keeps everything else the same, just swaps the speech recognition engine

const express = require('express');
const twilio = require('twilio');
const Company = require('../models/Company');
const { answerQuestion, loadCompanyQAs } = require('../services/agent');
const { findCachedAnswer } = require('../utils/aiAgent');
const KnowledgeEntry = require('../models/KnowledgeEntry');
const fs = require('fs');
const path = require('path');
const { synthesizeSpeech } = require('../services/elevenLabsService');
const { redisClient } = require('../clients');
const { normalizePhoneNumber, extractDigits, numbersMatch, } = require('../utils/phone');
const { stripMarkdown, cleanTextForTTS } = require('../utils/textUtils');
const { getRandomPersonalityResponse, getPersonalityResponse, fetchCompanyResponses } = require('../utils/personalityResponses_enhanced');

const router = express.Router();

// Helper function to escape text for TwiML Say verb
function escapeTwiML(text) {
  if (!text) return '';
  
  // For TTS, we want clean text without HTML entities
  // Only do minimal escaping for XML structure
  return text.replace(/&/g, '&amp;')
             .replace(/</g, '&lt;')
             .replace(/>/g, '&gt;');
}

// Helper function to get company data, with caching
async function getCompanyByPhoneNumber(phoneNumber) {
  const cacheKey = `company-phone:${phoneNumber}`;
  let company = null;

  try {
    const cachedCompany = await redisClient.get(cacheKey);
    if (cachedCompany) {
      console.log(`[Redis] Cache HIT for company-phone: ${phoneNumber}`);
      company = JSON.parse(cachedCompany);
    } else {
      console.log(`[Redis] Cache MISS for company-phone: ${phoneNumber}. Fetching from DB.`);
      const digits = extractDigits(phoneNumber);
      const digitsNoCountry = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
      const searchNumbers = [phoneNumber, digits, digitsNoCountry].filter(Boolean);

      company = await Company.findOne({ 'twilioConfig.phoneNumber': { $in: searchNumbers } }).exec();
      if (!company) {
        const all = await Company.find({ 'twilioConfig.phoneNumber': { $ne: null } }).exec();
        console.log(`Available companies: ${all.map(c => `${c.name}: ${c.twilioConfig.phoneNumber}`).join(', ')}`);
        
        for (const comp of all) {
          if (numbersMatch(phoneNumber, comp.twilioConfig.phoneNumber)) {
            company = comp;
            break;
          }
        }
      }

      if (company) {
        await redisClient.setEx(cacheKey, 3600, JSON.stringify(company)); // Cache for 1 hour
      }
    }
  } catch (error) {
    console.error('Error getting cached company:', error);
    company = await Company.findOne({ 'twilioConfig.phoneNumber': { $in: searchNumbers } }).exec();
    if (!company) {
      const all = await Company.find({ 'twilioConfig.phoneNumber': { $ne: null } }).exec();
      for (const comp of all) {
        if (numbersMatch(phoneNumber, comp.twilioConfig.phoneNumber)) {
          company = comp;
          break;
        }
      }
    }
  }
  
  return company;
}

// MAIN CHANGE: Use recording + Google Speech instead of Twilio Speech Recognition
router.post('/voice', async (req, res) => {
  const calledNumber = req.body.To;
  const fromNumber = req.body.From;
  const callSid = req.body.CallSid;
  
  console.log(`[GOOGLE-SPEECH] Incoming call: ${fromNumber} → ${calledNumber} (${callSid})`);
  
  try {
    let company = await getCompanyByPhoneNumber(calledNumber);
    
    if (!company) {
      console.log(`[GOOGLE-SPEECH] No company found for ${calledNumber}`);
      const msg = await getRandomPersonalityResponse(null, 'connectionTrouble');
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say(msg);
      twiml.hangup();
      return res.type('text/xml').send(twiml.toString());
    }
    
    console.log(`[GOOGLE-SPEECH] Found company: ${company.name}`);
    
    const twiml = new twilio.twiml.VoiceResponse();
    
    // Greeting
    const greetingType = company.agentSetup?.greetingType || 'tts';
    const greetingAudioUrl = company.agentSetup?.greetingAudioUrl;
    const agentGreeting = company.agentSetup?.agentGreeting || `Hello! You've reached ${company.name}. How can I help you today?`;
    
    // Use recording instead of speech recognition for speed
    if (greetingType === 'audio' && greetingAudioUrl) {
      twiml.play(greetingAudioUrl);
    } else {
      twiml.say(agentGreeting);
    }
    
    // Record audio for processing with Google Speech-to-Text
    twiml.record({
      action: '/api/twilio-google-speech/process-recording',
      method: 'POST',
      maxLength: 30,
      timeout: 3, // End recording after 3 seconds of silence
      playBeep: true,
      transcribe: false // Don't use Twilio's slow transcription
    });
    
    res.type('text/xml').send(twiml.toString());
    
  } catch (error) {
    console.error('[GOOGLE-SPEECH] Error in voice handler:', error);
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Sorry, there was an error. Please try again.');
    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
  }
});

// Process recorded audio with Google Speech-to-Text
router.post('/process-recording', async (req, res) => {
  const recordingUrl = req.body.RecordingUrl;
  const calledNumber = req.body.To;
  const callSid = req.body.CallSid;
  
  console.log(`[GOOGLE-SPEECH] Processing recording for ${callSid}: ${recordingUrl}`);
  
  try {
    const company = await getCompanyByPhoneNumber(calledNumber);
    
    if (!recordingUrl) {
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say('I didn\'t receive any audio. Please try again.');
      twiml.hangup();
      return res.type('text/xml').send(twiml.toString());
    }
    
    // Transcribe with Google Speech-to-Text (fast!)
    const transcriptionStart = Date.now();
    const transcription = await transcribeWithGoogle(recordingUrl);
    const transcriptionTime = Date.now() - transcriptionStart;
    
    console.log(`[GOOGLE-SPEECH] Transcription (${transcriptionTime}ms): "${transcription}"`);
    
    if (!transcription || transcription.trim().length < 2) {
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say('I couldn\'t understand what you said. Please speak clearly and try again.');
      twiml.hangup();
      return res.type('text/xml').send(twiml.toString());
    }
    
    // Process with AI (same as original)
    const aiStart = Date.now();
    const answerObj = await answerQuestion(
      company._id.toString(),
      transcription,
      [],
      company.agentSetup?.categories || [],
      company.agentSetup?.companySpecialties || '',
      callSid
    );
    const aiTime = Date.now() - aiStart;
    
    console.log(`[GOOGLE-SPEECH] AI processing (${aiTime}ms) completed`);
    
    // Respond with ElevenLabs TTS (same as original)
    const twiml = new twilio.twiml.VoiceResponse();
    const strippedAnswer = cleanTextForTTS(stripMarkdown(answerObj.text));
    const elevenLabsVoice = company.aiSettings?.elevenLabs?.voiceId;
    
    if (elevenLabsVoice) {
      try {
        const buffer = await synthesizeSpeech({
          text: strippedAnswer,
          voiceId: elevenLabsVoice,
          stability: company.aiSettings?.elevenLabs?.stability || 0.5,
          similarity_boost: company.aiSettings?.elevenLabs?.similarityBoost || 0.8,
          style: company.aiSettings?.elevenLabs?.style || 0.0,
          model_id: company.aiSettings?.elevenLabs?.modelId || 'eleven_turbo_v2_5',
          apiKey: company.aiSettings?.elevenLabs?.apiKey,
          company: company
        });
        
        const audioKey = `audio-${callSid}-${Date.now()}`;
        await redisClient.setEx(audioKey, 300, buffer.toString('base64'));
        const audioUrl = `https://${req.get('host')}/api/tts/serve-audio/${audioKey}`;
        
        twiml.play(audioUrl);
        console.log(`[GOOGLE-SPEECH] Using ElevenLabs TTS: ${audioUrl}`);
        
      } catch (ttsError) {
        console.error('[GOOGLE-SPEECH] ElevenLabs error:', ttsError);
        twiml.say(escapeTwiML(strippedAnswer));
      }
    } else {
      twiml.say(escapeTwiML(strippedAnswer));
    }
    
    twiml.hangup();
    
    const totalTime = Date.now() - transcriptionStart;
    console.log(`[GOOGLE-SPEECH] Total time: ${totalTime}ms (Transcription: ${transcriptionTime}ms, AI: ${aiTime}ms)`);
    
    res.type('text/xml').send(twiml.toString());
    
  } catch (error) {
    console.error('[GOOGLE-SPEECH] Error processing recording:', error);
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Sorry, I had trouble processing your request. Please try again.');
    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
  }
});

// Google Speech-to-Text function
async function transcribeWithGoogle(audioUrl) {
  const speech = require('@google-cloud/speech');
  const axios = require('axios');
  
  try {
    const client = new speech.SpeechClient();
    
    // Download audio from Twilio
    const audioResponse = await axios.get(audioUrl, { responseType: 'buffer' });
    
    const request = {
      audio: { content: audioResponse.data.toString('base64') },
      config: {
        encoding: 'WEBM_OPUS', // Twilio's recording format
        sampleRateHertz: 8000,
        languageCode: 'en-US',
        enableAutomaticPunctuation: true,
        model: 'latest_short' // Optimized for short audio
      },
    };
    
    const [response] = await client.recognize(request);
    const transcription = response.results
      .map(result => result.alternatives[0].transcript)
      .join(' ')
      .trim();
    
    return transcription;
    
  } catch (error) {
    console.error('[GOOGLE-SPEECH] Transcription error:', error);
    throw new Error('Failed to transcribe audio with Google Speech');
  }
}

module.exports = router;
