// Bypass Twilio Speech Recognition - Use Audio Recording + OpenAI Whisper
const express = require('express');
const twilio = require('twilio');
const axios = require('axios');
const FormData = require('form-data');
const Company = require('../models/Company');
const { answerQuestion } = require('../services/agent');
const { stripMarkdown, cleanTextForTTS } = require('../utils/textUtils');
const { redisClient } = require('../clients');
const router = express.Router();

// Helper functions
function escapeTwiML(text) {
  if (!text) return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function getCompanyByPhoneNumber(phoneNumber) {
  try {
    return await Company.findOne({ 'twilioConfig.phoneNumber': phoneNumber }).exec();
  } catch (error) {
    console.error('Error getting company:', error);
    return null;
  }
}

// Step 1: Initial call - start recording immediately
router.post('/voice', async (req, res) => {
  const calledNumber = req.body.To;
  const callSid = req.body.CallSid;
  
  console.log(`[WHISPER-BYPASS] Call received: ${callSid} at ${new Date().toISOString()}`);
  
  try {
    const company = await getCompanyByPhoneNumber(calledNumber);
    
    if (!company) {
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say('Sorry, this number is not configured.');
      twiml.hangup();
      return res.type('text/xml').send(twiml.toString());
    }
    
    const twiml = new twilio.twiml.VoiceResponse();
    
    // Greeting + immediate recording (no delay!)
    const greeting = company.agentSetup?.agentGreeting || `Hello! You've reached ${company.name}.`;
    twiml.say(`${greeting} Please tell me how I can help you.`);
    
    // Start recording immediately - this is instant!
    twiml.record({
      action: '/api/bypass-speech/process-audio',
      method: 'POST',
      maxLength: 30, // Max 30 seconds
      playBeep: true,
      timeout: 3, // Stop after 3 seconds of silence
      transcribe: false, // Don't use Twilio's slow transcription
      recordingStatusCallback: '/api/bypass-speech/recording-status'
    });
    
    res.type('text/xml').send(twiml.toString());
    
  } catch (error) {
    console.error('[WHISPER-BYPASS] Error in voice handler:', error);
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Sorry, there was an error. Please try again.');
    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
  }
});

// Step 2: Process recorded audio with OpenAI Whisper
router.post('/process-audio', async (req, res) => {
  const recordingUrl = req.body.RecordingUrl;
  const calledNumber = req.body.To;
  const callSid = req.body.CallSid;
  
  console.log(`[WHISPER-BYPASS] Processing audio for ${callSid} at ${new Date().toISOString()}`);
  console.log(`[WHISPER-BYPASS] Recording URL: ${recordingUrl}`);
  
  try {
    const company = await getCompanyByPhoneNumber(calledNumber);
    
    if (!recordingUrl) {
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say('I didn\'t receive any audio. Please try calling again.');
      twiml.hangup();
      return res.type('text/xml').send(twiml.toString());
    }
    
    // Transcribe with OpenAI Whisper (should be <1 second!)
    console.log(`[WHISPER-BYPASS] Starting Whisper transcription...`);
    const transcriptionStart = Date.now();
    
    let transcription;
    try {
      transcription = await transcribeWithWhisper(recordingUrl);
    } catch (transcriptionError) {
      console.error('[WHISPER-BYPASS] Whisper failed:', transcriptionError);
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say('I had trouble understanding your audio. Please try speaking more clearly and call back.');
      twiml.hangup();
      return res.type('text/xml').send(twiml.toString());
    }
    
    const transcriptionTime = Date.now() - transcriptionStart;
    console.log(`[WHISPER-BYPASS] Whisper transcription completed in ${transcriptionTime}ms: "${transcription}"`);
    
    if (!transcription || transcription.trim() === '' || transcription.trim().length < 3) {
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say('I couldn\'t understand what you said. Please try speaking more clearly and call back.');
      twiml.hangup();
      return res.type('text/xml').send(twiml.toString());
    }
    
    // Process with AI
    console.log(`[WHISPER-BYPASS] Starting AI processing for: "${transcription}"`);
    const aiStart = Date.now();
    
    let answerObj;
    try {
      answerObj = await answerQuestion(
        company._id.toString(),
        transcription,
        [],
        company.agentSetup?.categories || [],
        company.agentSetup?.companySpecialties || '',
        callSid
      );
    } catch (aiError) {
      console.error('[WHISPER-BYPASS] AI processing failed:', aiError);
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say('I\'m having trouble processing your question right now. Please try calling back in a moment.');
      twiml.hangup();
      return res.type('text/xml').send(twiml.toString());
    }
    
    const aiTime = Date.now() - aiStart;
    console.log(`[WHISPER-BYPASS] AI processing completed in ${aiTime}ms`);
    
    // Respond with AI answer using ElevenLabs TTS
    const twiml = new twilio.twiml.VoiceResponse();
    
    // Clean the answer text properly
    let cleanAnswer = cleanTextForTTS(stripMarkdown(answerObj.text));
    
    // Remove any remaining placeholders
    cleanAnswer = cleanAnswer
      .replace(/\{\{[^}]+\}\}/g, '') // Remove {{placeholder}} patterns
      .replace(/\[[^\]]+\]/g, '') // Remove [placeholder] patterns
      .replace(/\s+/g, ' ') // Clean up extra spaces
      .trim();
    
    console.log(`[WHISPER-BYPASS] Clean answer: "${cleanAnswer}"`);
    
    // Use ElevenLabs TTS if available, otherwise Twilio Say
    const elevenLabsVoice = company.aiSettings?.elevenLabs?.voiceId;
    
    if (elevenLabsVoice) {
      try {
        const { synthesizeSpeech } = require('../services/elevenLabsService');
        
        const audioBuffer = await synthesizeSpeech({
          text: cleanAnswer,
          voiceId: elevenLabsVoice,
          stability: company.aiSettings?.elevenLabs?.stability || 0.5,
          similarity_boost: company.aiSettings?.elevenLabs?.similarityBoost || 0.8,
          style: company.aiSettings?.elevenLabs?.style || 0.0,
          model_id: company.aiSettings?.elevenLabs?.modelId || 'eleven_monolingual_v1',
          apiKey: company.aiSettings?.elevenLabs?.apiKey,
          company: company
        });
        
        // Serve the audio file
        const audioKey = `audio-${callSid}-${Date.now()}`;
        const { redisClient } = require('../clients');
        await redisClient.setEx(audioKey, 300, audioBuffer.toString('base64'));
        
        const audioUrl = `https://${req.get('host')}/api/tts/serve-audio/${audioKey}`;
        twiml.play(audioUrl);
        
        console.log(`[WHISPER-BYPASS] Using ElevenLabs TTS: ${audioUrl}`);
        
      } catch (ttsError) {
        console.error('[WHISPER-BYPASS] ElevenLabs TTS error:', ttsError);
        // Fallback to Twilio Say
        twiml.say(escapeTwiML(cleanAnswer));
      }
    } else {
      // Use Twilio Say as fallback
      twiml.say(escapeTwiML(cleanAnswer));
      console.log(`[WHISPER-BYPASS] Using Twilio Say (no ElevenLabs configured)`);
    }
    
    // Option to continue conversation with simple prompt
    const gather = twiml.gather({
      input: 'dtmf',
      action: '/api/bypass-speech/continue',
      method: 'POST',
      timeout: 5,
      numDigits: 1
    });
    
    gather.say('Press 1 for another question, or hang up if you\'re done.');
    twiml.hangup(); // Hang up if no input
    
    const totalTime = Date.now() - transcriptionStart;
    console.log(`[WHISPER-BYPASS] Total processing time: ${totalTime}ms (Transcription: ${transcriptionTime}ms, AI: ${aiTime}ms)`);
    
    res.type('text/xml').send(twiml.toString());
    
  } catch (error) {
    console.error('[WHISPER-BYPASS] Error processing audio:', error);
    
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Sorry, I had trouble processing your request. Please try again.');
    twiml.hangup();
    
    res.type('text/xml').send(twiml.toString());
  }
});

// Handle continuation choice
router.post('/continue', async (req, res) => {
  const choice = req.body.Digits;
  const calledNumber = req.body.To;
  
  console.log(`[WHISPER-BYPASS] Continue choice: ${choice}`);
  
  if (choice === '1') {
    // Start new question
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Please ask your next question.');
    
    twiml.record({
      action: '/api/bypass-speech/process-audio',
      method: 'POST',
      maxLength: 30,
      playBeep: true,
      timeout: 3,
      transcribe: false
    });
    
    res.type('text/xml').send(twiml.toString());
  } else {
    // End call
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Thank you for calling. Goodbye!');
    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
  }
});

// OpenAI Whisper transcription function
async function transcribeWithWhisper(audioUrl) {
  try {
    console.log(`[WHISPER] Downloading audio from: ${audioUrl}`);
    
    // Download the audio file from Twilio
    const audioResponse = await axios({
      method: 'GET',
      url: audioUrl,
      responseType: 'stream',
      timeout: 10000 // 10 second timeout
    });
    
    console.log(`[WHISPER] Audio downloaded, sending to OpenAI...`);
    
    // Create form data for OpenAI
    const formData = new FormData();
    formData.append('file', audioResponse.data, {
      filename: 'recording.wav',
      contentType: 'audio/wav'
    });
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');
    formData.append('response_format', 'text');
    
    // Send to OpenAI Whisper API
    const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        ...formData.getHeaders()
      },
      timeout: 15000, // 15 second timeout
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });
    
    console.log(`[WHISPER] Transcription successful`);
    return response.data.trim();
    
  } catch (error) {
    console.error('[WHISPER] Transcription error:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
      url: audioUrl
    });
    
    if (error.response?.status === 401) {
      throw new Error('OpenAI API key is invalid or missing');
    } else if (error.response?.status === 429) {
      throw new Error('OpenAI API rate limit exceeded');
    } else if (error.code === 'ECONNABORTED') {
      throw new Error('Transcription request timed out');
    } else {
      throw new Error(`Transcription failed: ${error.message}`);
    }
  }
}

// Recording status callback (optional)
router.post('/recording-status', (req, res) => {
  console.log(`[WHISPER-BYPASS] Recording status: ${req.body.RecordingStatus}`);
  res.status(200).send('OK');
});

module.exports = router;
