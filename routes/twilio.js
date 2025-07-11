// Twilio Webhook Router - V3
// 🌍 GLOBAL MULTI-TENANT PLATFORM
// All changes affect ALL companies - no company-specific hardcoding
// Use company.aiSettings for per-company configuration
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
        company = all.find((c) => numbersMatch(c.twilioConfig.phoneNumber, phoneNumber));
      }

      if (company) {
        await redisClient.setEx(cacheKey, 3600, JSON.stringify(company)); // Cache for 1 hour
        console.log(`[Redis] Cached company for phone: ${phoneNumber}`);
      }
    }
  } catch (err) {
    console.error(`[Redis/DB] Error fetching company by phone ${phoneNumber}:`, err.message, err.stack);
    // Fallback to direct DB fetch if Redis fails
    const digits = extractDigits(phoneNumber);
    const digitsNoCountry = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    const searchNumbers = [phoneNumber, digits, digitsNoCountry].filter(Boolean);
    company = await Company.findOne({ 'twilioConfig.phoneNumber': { $in: searchNumbers } }).exec();
    if (!company) {
      const all = await Company.find({ 'twilioConfig.phoneNumber': { $ne: null } }).exec();
      company = all.find((c) => numbersMatch(c.twilioConfig.phoneNumber, phoneNumber));
    }
  }
  if (company) {
    loadCompanyQAs(company);
    if (company._id) {
      fetchCompanyResponses(company._id.toString()).catch((e) =>
        console.error('Error loading personality responses:', e)
      );
    }
  }
  return company;
}

router.post('/voice', async (req, res) => {
  try {
    console.log('[POST /api/twilio/voice] Incoming call:', req.body);
    const calledNumber = normalizePhoneNumber(req.body.To);
    let company = await getCompanyByPhoneNumber(calledNumber);

    const twiml = new twilio.twiml.VoiceResponse();

    if (!company) {
      const msg = await getRandomPersonalityResponse(null, 'connectionTrouble');
      const fallbackMessage = `<Say>${escapeTwiML(msg)}</Say>`;
      twiml.hangup();
      res.type('text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response>${fallbackMessage}</Response>`);
      return;
    }

    const greetingType = company.agentSetup?.greetingType || 'tts';
    const greetingAudioUrl = company.agentSetup?.greetingAudioUrl || '';
    
    // Get placeholders for the company
    const placeholders = company.agentSetup?.placeholders || [];
    
    // Get the raw greeting
    let rawGreeting = company.agentSetup?.agentGreeting || "Hello, thank you for calling. How can I help you today?";
    
    // Import the placeholders utility
    const { applyPlaceholders } = require('../utils/placeholders');
    
    // Apply the placeholders to the greeting
    let greeting = applyPlaceholders(rawGreeting, placeholders);
    
    console.log(`[Twilio Voice] Greeting type: ${greetingType}`);

    const gather = twiml.gather({
      input: 'speech',
      action: `https://${req.get('host')}/api/twilio/handle-speech`,
      method: 'POST',
      bargeIn: company.aiSettings?.bargeIn ?? false,
      timeout: company.aiSettings?.silenceTimeout ?? 5, // Reduced from 8 to 5 seconds for faster response
      speechTimeout: 'auto',
      enhanced: true,
      speechModel: 'phone_call',
      partialResultCallback: `https://${req.get('host')}/api/twilio/partial-speech`
    });

    if (greetingType === 'audio' && greetingAudioUrl) {
      gather.play(greetingAudioUrl);
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
          gather.play(`${req.protocol}://${req.get('host')}/audio/${fileName}`);
        } catch (err) {
          console.error('ElevenLabs TTS failed:', err);
          const fallbackText = `<Say>${escapeTwiML(greeting)}</Say>`;
          res.type('text/xml');
          res.send(`<?xml version="1.0" encoding="UTF-8"?><Response>${fallbackText}</Response>`);
          return;
        }
      } else {
        const fallbackText = `<Say>${escapeTwiML(greeting)}</Say>`;
        res.type('text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?><Response>${fallbackText}</Response>`);
        return;
      }
    }

    res.type('text/xml');
    const twimlString = twiml.toString();
    console.log(`[Twilio Voice] Sending TwiML: ${twimlString}`);
    res.send(twimlString);
  } catch (err) {
    console.error('[POST /api/twilio/voice] Error:', err.message, err.stack);
    const twiml = new twilio.twiml.VoiceResponse();
    const msg = await getRandomPersonalityResponse(null, 'connectionTrouble');
    const fallbackText = `<Say>${escapeTwiML(msg)}</Say>`;
    twiml.hangup();
    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response>${fallbackText}</Response>`);
  }
});

router.post('/handle-speech', async (req, res) => {
  const requestStartTime = Date.now();
  try {
    console.log(`[TWILIO TIMING] Speech webhook received at: ${new Date().toISOString()}`);
    console.log(`[TWILIO TIMING] Twilio sent SpeechResult: "${req.body.SpeechResult}" with confidence: ${req.body.Confidence}`);
    console.log('[POST /api/twilio/handle-speech] Incoming speech:', req.body);
    const speechText = req.body.SpeechResult || '';
    const twiml = new twilio.twiml.VoiceResponse();
    const callSid = req.body.CallSid;
    const repeatKey = `twilio-repeats:${callSid}`;

    if (!speechText) {
      const msg = await getRandomPersonalityResponse(null, 'cantUnderstand');
      const fallbackText = `<Say>${escapeTwiML(msg)}</Say>`;
      twiml.hangup();
      res.type('text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response>${fallbackText}</Response>`);
      return;
    }

    const calledNumber = normalizePhoneNumber(req.body.To);
    let company = await getCompanyByPhoneNumber(calledNumber);
    if (!company) {
      const msg = await getRandomPersonalityResponse(null, 'connectionTrouble');
      const fallbackText = `<Say>${escapeTwiML(msg)}</Say>`;
      twiml.hangup();
      res.type('text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response>${fallbackText}</Response>`);
      return;
    }

    if (company.aiSettings?.logCalls) {
      console.log(`[Call Log] CallSid ${req.body.CallSid} Speech: ${speechText}`);
    }

    const confidence = parseFloat(req.body.Confidence || '0');
    const threshold = company.aiSettings?.twilioSpeechConfidenceThreshold ?? 0.5;
    if (confidence < threshold) {
      const repeats = await redisClient.incr(repeatKey);
      if (repeats === 1) {
        await redisClient.expire(repeatKey, 600);
      }
      if (repeats > (company.aiSettings?.maxRepeats ?? 3)) {
        const personality = company.aiSettings?.personality || 'friendly';
        const msg = company.aiSettings?.repeatEscalationMessage || await getPersonalityResponse(company._id.toString(), 'transferToRep', personality);
        const fallbackText = `<Say>${escapeTwiML(msg)}</Say>`;
        twiml.hangup();
        await redisClient.del(repeatKey);
        res.type('text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?><Response>${fallbackText}</Response>`);
        return;
      }
      const gather = twiml.gather({
        input: 'speech',
        action: `https://${req.get('host')}/api/twilio/handle-speech`,
        method: 'POST',
        bargeIn: company.aiSettings?.bargeIn ?? false,
        timeout: company.aiSettings?.silenceTimeout ?? 5, // Reduced for faster response
        speechTimeout: 'auto',
        enhanced: true,
        speechModel: 'phone_call'
      });

      const personality = company.aiSettings?.personality || 'friendly';
      const retryMsg = await getPersonalityResponse(company._id.toString(), 'cantUnderstand', personality);
      
      // Apply response delay if configured
      const responseDelay = company.aiSettings?.responseDelayMs || 0;
      if (responseDelay > 0) {
        await new Promise(res => setTimeout(res, responseDelay));
      }
      
      const elevenLabsVoice = company.aiSettings?.elevenLabs?.voiceId;

      if (elevenLabsVoice) {
        try {
          const buffer = await synthesizeSpeech({
            text: retryMsg,
            voiceId: elevenLabsVoice,
            stability: company.aiSettings.elevenLabs?.stability,
            similarity_boost: company.aiSettings.elevenLabs?.similarityBoost,
            style: company.aiSettings.elevenLabs?.style,
            model_id: company.aiSettings.elevenLabs?.modelId,
            company
          });
          const fileName = `retry_${Date.now()}.mp3`;
          const audioDir = path.join(__dirname, '../public/audio');
          if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
          const filePath = path.join(audioDir, fileName);
          fs.writeFileSync(filePath, buffer);
          gather.play(`${req.protocol}://${req.get('host')}/audio/${fileName}`);
        } catch (err) {
          console.error('ElevenLabs TTS failed:', err);
          const fallbackText = `<Say>${escapeTwiML(retryMsg)}</Say>`;
          res.type('text/xml');
          res.send(`<?xml version="1.0" encoding="UTF-8"?><Response>${fallbackText}</Response>`);
          return;
        }
      } else {
        const fallbackText = `<Say>${escapeTwiML(retryMsg)}</Say>`;
        res.type('text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?><Response>${fallbackText}</Response>`);
        return;
      }

      res.type('text/xml');
      return res.send(twiml.toString());
    }
    await redisClient.del(repeatKey);

    // Process QA matching
    const companyId = company._id.toString();
    const qnaEntries = await KnowledgeEntry.find({ companyId });
    console.log(`[Q&A] Loaded ${qnaEntries.length} entries for company ${companyId}`);
    console.log(`[Q&A DEBUG] Loaded entries for company ${companyId}:`, qnaEntries.map(e => ({
      question: e.question,
      keywords: e.keywords,
      answer: e.answer
    })));
    console.log(`[Q&A DEBUG] Incoming Speech: "${speechText}"`);
    
    const fuzzyThreshold = company.aiSettings?.fuzzyMatchThreshold ?? 0.5;
    const cachedAnswer = findCachedAnswer(qnaEntries, speechText, fuzzyThreshold);
    console.log(`[Q&A DEBUG] Match result:`, cachedAnswer);
    
    if (cachedAnswer) {
      console.log(`[AI] Q&A match for ${callSid}: ${cachedAnswer}`);
      
      const responseDelay = company.aiSettings?.responseDelayMs || 0;
      if (responseDelay > 0) {
        await new Promise(res => setTimeout(res, responseDelay));
      }
      
      const gather = twiml.gather({
        input: 'speech',
        action: `https://${req.get('host')}/api/twilio/handle-speech`,
        method: 'POST',
        bargeIn: company.aiSettings?.bargeIn ?? false,
        timeout: company.aiSettings?.silenceTimeout ?? 5, // Reduced for faster response
        speechTimeout: 'auto',
        enhanced: true,
        speechModel: 'phone_call'
      });

      const elevenLabsVoice = company.aiSettings?.elevenLabs?.voiceId;
      
      if (elevenLabsVoice) {
        try {
          const buffer = await synthesizeSpeech({
            text: cachedAnswer,
            voiceId: elevenLabsVoice,
            stability: company.aiSettings.elevenLabs?.stability,
            similarity_boost: company.aiSettings.elevenLabs?.similarityBoost,
            style: company.aiSettings.elevenLabs?.style,
            model_id: company.aiSettings.elevenLabs?.modelId,
            company
          });
          
          const audioKey = `audio:qa:${callSid}`;
          await redisClient.setEx(audioKey, 300, buffer.toString('base64'));
          
          const audioUrl = `https://${req.get('host')}/api/twilio/audio/qa/${callSid}`;
          gather.play(audioUrl);
        } catch (err) {
          console.error('ElevenLabs TTS failed, falling back to <Say>:', err);
          gather.say(escapeTwiML(cachedAnswer));
        }
      } else {
        gather.say(escapeTwiML(cachedAnswer));
      }

      res.type('text/xml');
      return res.send(twiml.toString());
    }

    // Continue with AI processing
    const mainAgentScript = company.agentSetup?.mainAgentScript || '';
    const personality = company.aiSettings?.personality || 'friendly';
    const responseLength = company.aiSettings?.responseLength || 'concise';
    const companySpecialties = company.agentSetup?.companySpecialties || '';
    const categoryQAs = company.agentSetup?.categoryQAs || '';

    // Retrieve conversation history
    let conversationHistory = [];
    const historyKey = `conversation-history:${callSid}`;
    const storedHistory = await redisClient.get(historyKey);
    if (storedHistory) {
      conversationHistory = JSON.parse(storedHistory);
    }

    // Add current user speech to history
    conversationHistory.push({ role: 'user', text: speechText });

    // No need to store context in Redis anymore - processing synchronously

    // Process AI response synchronously (no polling needed)
    let answerObj;
    try {
      answerObj = await answerQuestion(
        companyId,
        speechText,
        responseLength,
        conversationHistory,
        mainAgentScript,
        personality,
        companySpecialties,
        categoryQAs,
        callSid
      );
      console.log(`[AI] answerQuestion result for ${callSid}:`, answerObj);

      // Add AI response to history
      conversationHistory.push({ role: 'assistant', text: answerObj.text });
      await redisClient.setEx(historyKey, 60, JSON.stringify(conversationHistory));

    } catch (err) {
      console.error(`[AI Processing Error for CallSid: ${callSid}]`, err.message, err.stack);
      const personality = company.aiSettings?.personality || 'friendly';
      const fallback = await getPersonalityResponse(company._id.toString(), 'connectionTrouble', personality);
      answerObj = { text: fallback, escalate: false };
    }

    // Apply response delay if configured
    const delay = company.aiSettings?.responseDelayMs || 0;
    if (delay > 0) {
      await new Promise(res => setTimeout(res, delay));
    }

    // Generate TTS and respond immediately
    const gather = twiml.gather({
      input: 'speech',
      action: `https://${req.get('host')}/api/twilio/handle-speech`,
      method: 'POST',
      bargeIn: company.aiSettings?.bargeIn ?? false,
      timeout: company.aiSettings?.silenceTimeout ?? 5, // Reduced for faster response
      speechTimeout: 'auto',
      enhanced: true,
      speechModel: 'phone_call'
    });

    const strippedAnswer = cleanTextForTTS(stripMarkdown(answerObj.text));
    const elevenLabsVoice = company.aiSettings?.elevenLabs?.voiceId;
      
    if (elevenLabsVoice) {
      try {
        const buffer = await synthesizeSpeech({
          text: strippedAnswer,
          voiceId: elevenLabsVoice,
          stability: company.aiSettings.elevenLabs?.stability,
          similarity_boost: company.aiSettings.elevenLabs?.similarityBoost,
          style: company.aiSettings.elevenLabs?.style,
          model_id: company.aiSettings.elevenLabs?.modelId,
          company
        });

        // Store audio in Redis for fast serving
        const audioKey = `audio:ai:${callSid}`;
        await redisClient.setEx(audioKey, 300, buffer.toString('base64'));
        
        const audioUrl = `https://${req.get('host')}/api/twilio/audio/ai/${callSid}`;
        gather.play(audioUrl);

      } catch (err) {
        console.error('ElevenLabs synthesis failed:', err.message);
        gather.say(escapeTwiML(strippedAnswer));
      }
    } else {
      gather.say(escapeTwiML(strippedAnswer));
    }

    res.type('text/xml');
    const responseXML = twiml.toString();
    const requestEndTime = Date.now();
    console.log(`[TWILIO TIMING] Sending response at: ${new Date().toISOString()}`);
    console.log(`[TWILIO TIMING] Total processing time: ${requestEndTime - requestStartTime}ms`);
    console.log(`[TWILIO TIMING] Response XML length: ${responseXML.length} characters`);
    res.send(responseXML);
  } catch (err) {
    console.error('[POST /api/twilio/handle-speech] Error:', err.message, err.stack);
    const twiml = new twilio.twiml.VoiceResponse();
    const msg = await getRandomPersonalityResponse(null, 'connectionTrouble');
    const fallbackText = `<Say>${escapeTwiML(msg)}</Say>`;
    twiml.hangup();
    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response>${fallbackText}</Response>`);
  }
});

// Partial speech results for faster response (experimental)
router.post('/partial-speech', async (req, res) => {
  console.log(`[PARTIAL SPEECH] Received at: ${new Date().toISOString()}`);
  console.log(`[PARTIAL SPEECH] Partial result: "${req.body.SpeechResult}" (Stability: ${req.body.Stability})`);
  
  // Just acknowledge - we'll process the final result
  res.status(200).send('OK');
});

// Diagnostic endpoint to measure exact Twilio speech timing
router.post('/speech-timing-test', async (req, res) => {
  const receiveTime = Date.now();
  console.log(`[DIAGNOSTIC] Speech timing test received at: ${new Date().toISOString()}`);
  console.log(`[DIAGNOSTIC] Twilio body:`, req.body);
  
  const twiml = new twilio.twiml.VoiceResponse();
  
  // Immediate response with timing info
  twiml.say(`Speech received at ${new Date().toLocaleTimeString()}. Processing took ${Date.now() - receiveTime} milliseconds.`);
  
  const respondTime = Date.now();
  console.log(`[DIAGNOSTIC] Responding at: ${new Date().toISOString()}`);
  console.log(`[DIAGNOSTIC] Total processing: ${respondTime - receiveTime}ms`);
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// Polling endpoint removed - now processing synchronously

// Direct audio serving endpoint for faster delivery
router.get('/audio/:type/:callSid', async (req, res) => {
  try {
    const { type, callSid } = req.params;
    const audioKey = `audio:${type}:${callSid}`;
    
    const audioBase64 = await redisClient.get(audioKey);
    if (!audioBase64) {
      return res.status(404).send('Audio not found');
    }
    
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    
    // Set optimal headers for Twilio
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=300',
      'X-Robots-Tag': 'noindex'
    });
    
    res.send(audioBuffer);
  } catch (err) {
    console.error('[AUDIO ENDPOINT] Error:', err);
    res.status(500).send('Audio service error');
  }
});

// 🎛️ AGENT PERFORMANCE CONTROLS - LIVE TUNING DASHBOARD
// These values come from company.aiSettings - adjust via UI, not code
// For optimization: use company profile → AI Voice Settings → Agent Performance Controls
// NO HARDCODING - all tuning happens through the live dashboard

module.exports = router;