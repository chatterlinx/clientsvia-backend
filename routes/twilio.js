// Twilio Webhook Router - V3
// GLOBAL MULTI-TENANT PLATFORM
// CRITICAL: All changes affect ALL companies - no company-specific hardcoding
// POST-IT REMINDER: Use company.aiSettings for per-company configuration
// NEVER hardcode company IDs or special treatment for any single company
// ALWAYS design for global platform scalability
// TEST: "Would this work for company #1000 tomorrow?" If NO, fix it!
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
    const cacheStartTime = Date.now();
    const cachedCompany = await redisClient.get(cacheKey);
    if (cachedCompany) {
      console.log(`[CACHE HIT] [FAST] Company found in cache for ${phoneNumber} in ${Date.now() - cacheStartTime}ms`);
      company = JSON.parse(cachedCompany);
    } else {
      console.log(`[CACHE MISS] [SEARCH] Company not cached for ${phoneNumber}, querying database...`);
      const dbStartTime = Date.now();
      
      const digits = extractDigits(phoneNumber);
      const digitsNoCountry = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
      const searchNumbers = [phoneNumber, digits, digitsNoCountry].filter(Boolean);

      company = await Company.findOne({ 'twilioConfig.phoneNumber': { $in: searchNumbers } }).exec();
      if (!company) {
        const all = await Company.find({ 'twilioConfig.phoneNumber': { $ne: null } }).exec();
        company = all.find((c) => numbersMatch(c.twilioConfig.phoneNumber, phoneNumber));
      }

      if (company) {
        const dbEndTime = Date.now();
        console.log(`[DB SUCCESS] [OK] Company found in database in ${dbEndTime - dbStartTime}ms`);
        await redisClient.setEx(cacheKey, 3600, JSON.stringify(company)); // Cache for 1 hour
        console.log(`[CACHE SAVE] 💾 Company cached for phone: ${phoneNumber}`);
      } else {
        const dbEndTime = Date.now();
        console.log(`[DB MISS] [ERROR] No company found in database for ${phoneNumber} (${dbEndTime - dbStartTime}ms)`);
      }
    }
  } catch (err) {
    console.error(`[CACHE/DB ERROR] [ERROR] Error fetching company by phone ${phoneNumber}:`, err.message);
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
  const callStartTime = Date.now();
  console.log(`[CALL START] [CALL] New call initiated at: ${new Date().toISOString()}`);
  console.log(`[CALL DEBUG] From: ${req.body.From} → To: ${req.body.To} | CallSid: ${req.body.CallSid}`);
  
  try {
    console.log('[POST /api/twilio/voice] Incoming call:', req.body);
    const calledNumber = normalizePhoneNumber(req.body.To);
    console.log(`[PHONE LOOKUP] [SEARCH] Searching for company with phone: ${calledNumber}`);
    
    let company = await getCompanyByPhoneNumber(calledNumber);

    const twiml = new twilio.twiml.VoiceResponse();

    if (!company) {
      console.log(`[ERROR] [ERROR] No company found for phone number: ${calledNumber}`);
      const msg = await getRandomPersonalityResponse(null, 'connectionTrouble');
      const fallbackMessage = `<Say>${escapeTwiML(msg)}</Say>`;
      twiml.hangup();
      res.type('text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response>${fallbackMessage}</Response>`);
      return;
    }

    console.log(`[COMPANY FOUND] [OK] Company: ${company.companyName} (ID: ${company._id})`);
    console.log(`[AI SETTINGS] Voice ID: ${company.aiSettings?.elevenLabs?.voiceId || 'default'} | Personality: ${company.aiSettings?.personality || 'friendly'}`);
    
    // [TARGET] COMPREHENSIVE PERFORMANCE SETTINGS REPORT
    const speechThreshold = company.aiSettings?.twilioSpeechConfidenceThreshold ?? 0.4;
    const fuzzyThreshold = company.aiSettings?.fuzzyMatchThreshold ?? 0.25; // Lowered for better Q&A matching
    console.log(`[PERFORMANCE SETTINGS] [TARGET] Speech Confidence: ${speechThreshold} | Fuzzy Match: ${fuzzyThreshold}`);
    console.log(`[THRESHOLDS] Confidence: ${speechThreshold}`); // Keep legacy log for compatibility

    // BYPASS: Check for new AI Agent Setup greeting first, then fall back to old agent setup
    let rawGreeting;
    let greetingType = 'tts';
    let greetingAudioUrl = '';
    let placeholders = [];
    
    // Check if company has new AI Agent Setup with greeting
    if (company.aiAgentSetup && (company.aiAgentSetup.agentInitialMessage || company.aiAgentSetup.greeting)) {
        console.log(`[AI AGENT SETUP] Using new AI agent greeting`);
        rawGreeting = company.aiAgentSetup.agentInitialMessage || company.aiAgentSetup.greeting;
        greetingType = company.aiAgentSetup.greetingType || 'tts';
        greetingAudioUrl = company.aiAgentSetup.greetingAudioUrl || '';
        placeholders = company.aiAgentSetup.placeholders || [];
    } else if (company.aiAgentSetup && company.aiAgentSetup.template) {
        // Check if there's a template with a greeting
        console.log(`[AI AGENT SETUP] Using template greeting for template: ${company.aiAgentSetup.template}`);
        const AIAgentSetupService = require('../services/aiAgentSetup');
        const templates = AIAgentSetupService.getBusinessTemplates();
        const template = templates[company.aiAgentSetup.template];
        if (template && template.greeting) {
            rawGreeting = template.greeting;
            greetingType = 'tts';
            greetingAudioUrl = '';
            placeholders = [];
        } else {
            // Template doesn't have greeting, use default
            rawGreeting = "Hello, thank you for calling. How can I help you today?";
        }
    } else {
        console.log(`[LEGACY AGENT SETUP] Using legacy agent setup greeting`);
        greetingType = company.agentSetup?.greetingType || 'tts';
        greetingAudioUrl = company.agentSetup?.greetingAudioUrl || '';
        placeholders = company.agentSetup?.placeholders || [];
        rawGreeting = company.agentSetup?.agentGreeting || "Hello, thank you for calling. How can I help you today?";
    }
    
    console.log(`[GREETING TYPE] [TTS] Type: ${greetingType} | Audio URL: ${greetingAudioUrl || 'none'}`);
    
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
      timeout: 5, // Globally optimized for fast response
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
          console.log(`[TTS START] [TTS] Starting greeting TTS synthesis...`);
          const ttsStartTime = Date.now();
          
          const buffer = await synthesizeSpeech({
            text: greeting,
            voiceId: elevenLabsVoice,
            stability: company.aiSettings.elevenLabs?.stability,
            similarity_boost: company.aiSettings.elevenLabs?.similarityBoost,
            style: company.aiSettings.elevenLabs?.style,
            model_id: company.aiSettings.elevenLabs?.modelId,
            company
          });
          
          const ttsTime = Date.now() - ttsStartTime;
          console.log(`[TTS COMPLETE] [OK] Greeting TTS completed in ${ttsTime}ms`);
          
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
  let confidence = 0;
  let threshold = 0.5;
  
  console.log(`[SPEECH START] [SPEECH] Speech processing started at: ${new Date().toISOString()}`);
  
  try {
    console.log(`[TWILIO TIMING] Speech webhook received at: ${new Date().toISOString()}`);
    console.log(`[TWILIO TIMING] Twilio sent SpeechResult: "${req.body.SpeechResult}" with confidence: ${req.body.Confidence}`);
    console.log('[POST /api/twilio/handle-speech] Incoming speech:', req.body);
    const speechText = req.body.SpeechResult || '';
    const twiml = new twilio.twiml.VoiceResponse();
    const callSid = req.body.CallSid;
    const repeatKey = `twilio-repeats:${callSid}`;

    if (!speechText) {
      console.log(`[SPEECH ERROR] [ERROR] Empty speech result received from Twilio`);
      const msg = await getRandomPersonalityResponse(null, 'cantUnderstand');
      const fallbackText = `<Say>${escapeTwiML(msg)}</Say>`;
      twiml.hangup();
      res.type('text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response>${fallbackText}</Response>`);
      return;
    }

    console.log(`[SPEECH RECEIVED] [TARGET] Processing speech: "${speechText}" (${speechText.length} chars)`);

    // Check for potentially unclear/incomplete speech OR rambling
    const isLikelyUnclear = (
      speechText.length < 3 || 
      /^[a-z]{1,2}\.?$/i.test(speechText.trim()) || // Single/double letters
      speechText.toLowerCase().includes('have on') || // Common misrecognition
      speechText.toLowerCase().includes('hello') && speechText.length < 10 // Just "hello"
    );
    
    const isLikelyRambling = (
      speechText.length > 300 || // Very long speech (300+ chars)
      speechText.split(' ').length > 50 || // 50+ words
      (speechText.match(/\b(and|then|so|but|also|actually|basically)\b/gi) || []).length > 5 // Too many filler words
    );
    
    if (isLikelyUnclear) {
      console.log(`[SPEECH QUALITY] ⚠️ Potentially unclear speech detected: "${speechText}"`);
    }
    
    if (isLikelyRambling) {
      console.log(`[SPEECH QUALITY] 📢 Rambling detected: ${speechText.length} chars, ${speechText.split(' ').length} words`);
    }

    const calledNumber = normalizePhoneNumber(req.body.To);
    console.log(`[COMPANY LOOKUP] [SEARCH] Looking up company for phone: ${calledNumber}`);
    let company = await getCompanyByPhoneNumber(calledNumber);
    if (!company) {
      console.log(`[COMPANY ERROR] [ERROR] No company found for phone: ${calledNumber} during speech processing`);
      const msg = await getRandomPersonalityResponse(null, 'connectionTrouble');
      const fallbackText = `<Say>${escapeTwiML(msg)}</Say>`;
      twiml.hangup();
      res.type('text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response>${fallbackText}</Response>`);
      return;
    }

    console.log(`[COMPANY CONFIRMED] [OK] Processing speech for: ${company.companyName}`);

    confidence = parseFloat(req.body.Confidence || '0');
    threshold = company.aiSettings?.twilioSpeechConfidenceThreshold ?? 0.4;
    
    console.log(`[CONFIDENCE CHECK] Speech: "${speechText}" | Confidence: ${confidence} | Threshold: ${threshold} | ${confidence >= threshold ? 'PASS [OK]' : 'FAIL [ERROR]'}`);
    
    if (confidence < threshold) {
      console.log(`[CONFIDENCE REJECT] Low confidence (${confidence} < ${threshold}) - asking user to repeat`);
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
        timeout: 5, // Globally optimized for fast response
        speechTimeout: 'auto',
        enhanced: true,
        speechModel: 'phone_call',
        partialResultCallback: `https://${req.get('host')}/api/twilio/partial-speech`
      });

      const personality = company.aiSettings?.personality || 'friendly';
      
      // Create a more helpful retry message based on the type of issue
      let retryMsg;
      if (isLikelyUnclear) {
        retryMsg = "I didn't quite catch that. Could you please speak a little louder and clearer? What can I help you with today?";
      } else if (confidence < threshold * 0.6) {
        retryMsg = "I'm having trouble hearing you clearly. Could you please repeat that for me?";
      } else {
        retryMsg = await getPersonalityResponse(company._id.toString(), 'cantUnderstand', personality);
      }
      
      console.log(`[RETRY MESSAGE] Using message: "${retryMsg}" for speech: "${speechText}" (confidence: ${confidence})`);
      
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
          
          // Store audio in Redis for fast serving
          const audioKey = `audio:retry:${callSid}`;
          await redisClient.setEx(audioKey, 300, buffer.toString('base64'));
          
          const audioUrl = `https://${req.get('host')}/api/twilio/audio/retry/${callSid}`;
          gather.play(audioUrl);
        } catch (err) {
          console.error('ElevenLabs TTS failed, falling back to <Say>:', err);
          gather.say(escapeTwiML(retryMsg));
        }
      } else {
        gather.say(escapeTwiML(retryMsg));
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
    
    const fuzzyThreshold = company.aiSettings?.fuzzyMatchThreshold ?? 0.3;
    console.log(`[Q&A MATCHING] [SEARCH] Searching ${qnaEntries.length} Q&A entries with fuzzy threshold: ${fuzzyThreshold}`);
    
    const cachedAnswer = findCachedAnswer(qnaEntries, speechText, fuzzyThreshold);
    console.log(`[Q&A DEBUG] Match result:`, cachedAnswer);
    
    if (cachedAnswer) {
      console.log(`[Q&A MATCH FOUND] [OK] Using Q&A response for ${callSid}: ${cachedAnswer.substring(0, 100)}...`);
      
      const gather = twiml.gather({
        input: 'speech',
        action: `https://${req.get('host')}/api/twilio/handle-speech`,
        method: 'POST',
        bargeIn: company.aiSettings?.bargeIn ?? false,
        timeout: 5, // Globally optimized for fast response
        speechTimeout: 'auto',
        enhanced: true,
        speechModel: 'phone_call',
        partialResultCallback: `https://${req.get('host')}/api/twilio/partial-speech`
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

    // Add current user speech to history with context flags
    let speechContext = speechText;
    if (isLikelyUnclear || confidence < 0.7) {
      speechContext = `[Speech unclear/low confidence: "${speechText}"]`;
    } else if (isLikelyRambling) {
      speechContext = `[Long explanation: "${speechText.substring(0, 200)}..."]`;
    }
    
    conversationHistory.push({ role: 'user', text: speechContext });

    // No need to store context in Redis anymore - processing synchronously

    // Process AI response synchronously (no polling needed)
    console.log(`[AI PROCESSING] 🤖 Starting AI response generation...`);
    const aiStartTime = Date.now();
    
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
      
      const aiEndTime = Date.now();
      console.log(`[AI SUCCESS] [OK] AI response generated in ${aiEndTime - aiStartTime}ms`);
      console.log(`[AI] answerQuestion result for ${callSid}:`, answerObj);

      // Add AI response to history
      conversationHistory.push({ role: 'assistant', text: answerObj.text });
      await redisClient.setEx(historyKey, 60, JSON.stringify(conversationHistory));
      console.log(`[AI HISTORY] 💾 Saved conversation history (${conversationHistory.length} messages)`);

    } catch (err) {
      console.error(`[AI ERROR] [ERROR] AI processing failed: ${err.message}`);
      console.error(`[AI Processing Error for CallSid: ${callSid}]`, err.message, err.stack);
      const personality = company.aiSettings?.personality || 'friendly';
      const fallback = await getPersonalityResponse(company._id.toString(), 'connectionTrouble', personality);
      answerObj = { text: fallback, escalate: false };
    }

    // Generate TTS and respond immediately
    const gather = twiml.gather({
      input: 'speech',
      action: `https://${req.get('host')}/api/twilio/handle-speech`,
      method: 'POST',
      bargeIn: company.aiSettings?.bargeIn ?? false,
      timeout: 5, // Globally optimized for fast response
      speechTimeout: 'auto',
      enhanced: true,
      speechModel: 'phone_call',
      partialResultCallback: `https://${req.get('host')}/api/twilio/partial-speech`
    });

    const strippedAnswer = cleanTextForTTS(stripMarkdown(answerObj.text));
    const elevenLabsVoice = company.aiSettings?.elevenLabs?.voiceId;
    // TTS without artificial timeouts - let it complete naturally
    if (elevenLabsVoice) {
      try {
        console.log(`[TTS START] [TTS] Starting ElevenLabs synthesis for: "${strippedAnswer.substring(0, 50)}..."`);
        const ttsStartTime = Date.now();
        
        // Direct TTS call without timeout interference
        const buffer = await synthesizeSpeech({
          text: strippedAnswer,
          voiceId: elevenLabsVoice,
          stability: company.aiSettings.elevenLabs?.stability,
          similarity_boost: company.aiSettings.elevenLabs?.similarityBoost,
          style: company.aiSettings.elevenLabs?.style,
          model_id: company.aiSettings.elevenLabs?.modelId,
          company
        });
        
        const ttsTime = Date.now() - ttsStartTime;
        console.log(`[TTS COMPLETE] [OK] ElevenLabs synthesis completed in ${ttsTime}ms`);

        // Store audio in Redis for fast serving
        const audioKey = `audio:ai:${callSid}`;
        await redisClient.setEx(audioKey, 300, buffer.toString('base64'));
        
        const audioUrl = `https://${req.get('host')}/api/twilio/audio/ai/${callSid}`;
        gather.play(audioUrl);

      } catch (err) {
        console.error('ElevenLabs synthesis failed, falling back to native TTS:', err.message);
        // Use Twilio's enhanced TTS with voice settings to maintain consistency
        const voice = company.aiSettings?.twilioVoice || 'alice';
        gather.say({ voice: voice }, escapeTwiML(strippedAnswer));
      }
    } else {
      // Use consistent voice even when ElevenLabs is not configured
      const voice = company.aiSettings?.twilioVoice || 'alice';
      gather.say({ voice: voice }, escapeTwiML(strippedAnswer));
    }

    res.type('text/xml');
    const responseXML = twiml.toString();
    const requestEndTime = Date.now();
    console.log(`[TWILIO TIMING] Sending response at: ${new Date().toISOString()}`);
    console.log(`[TWILIO TIMING] Total processing time: ${requestEndTime - requestStartTime}ms`);
    console.log(`[TWILIO TIMING] Response XML length: ${responseXML.length} characters`);
    console.log(`[CONFIDENCE SUMMARY] Successfully processed speech with confidence ${confidence} (threshold: ${threshold})`);
    console.log(`[SPEECH COMPLETE] [OK] Speech processing completed in ${requestEndTime - requestStartTime}ms`);
    res.send(responseXML);
  } catch (err) {
    console.error(`[SPEECH ERROR] [ERROR] Speech processing failed: ${err.message}`);
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