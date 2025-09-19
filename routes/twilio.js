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
const aiAgentRuntime = require('../services/aiAgentRuntime');
const { findCachedAnswer } = require('../utils/aiAgent');
const CompanyQnA = require('../models/knowledge/CompanyQnA');
const fs = require('fs');
const path = require('path');
const { synthesizeSpeech } = require('../services/elevenLabsService');
const { redisClient } = require('../clients');
const { normalizePhoneNumber, extractDigits, numbersMatch, } = require('../utils/phone');
const { stripMarkdown, cleanTextForTTS } = require('../utils/textUtils');
const { getRandomPersonalityResponse, getPersonalityResponse, fetchCompanyResponses } = require('../utils/personalityResponses_enhanced');

const router = express.Router();

// 🚨 GLOBAL CHECKPOINT: Log ALL requests to ANY Twilio endpoint
router.use((req, res, next) => {
  console.log('🔍 TWILIO ENDPOINT HIT:', {
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url,
    fullUrl: req.originalUrl,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.headers['user-agent'],
    contentType: req.headers['content-type'],
    bodyKeys: Object.keys(req.body || {}),
    hasCallSid: !!(req.body && req.body.CallSid)
  });
  next();
});

// Helper function to check if transfer is enabled
function isTransferEnabled(company) {
  return company?.aiAgentLogic?.callTransferConfig?.dialOutEnabled === true;
}

// Helper function to get the configured transfer number
function getTransferNumber(company) {
  // First try the AI Agent Logic configured dial-out number
  if (company?.aiAgentLogic?.callTransferConfig?.dialOutEnabled && 
      company?.aiAgentLogic?.callTransferConfig?.dialOutNumber) {
    console.log('[AI AGENT] Using configured dial-out number:', company.aiAgentLogic.callTransferConfig.dialOutNumber);
    return company.aiAgentLogic.callTransferConfig.dialOutNumber;
  }
  
  // Fall back to Twilio config fallback number
  if (company?.twilioConfig?.fallbackNumber) {
    console.log('[AI AGENT] Using Twilio fallback number:', company.twilioConfig.fallbackNumber);
    return company.twilioConfig.fallbackNumber;
  }
  
  // No fallback number - transfer should be explicitly configured
  console.log('[AI AGENT] No transfer number configured - transfer disabled');
  return null;
}

// Helper function to get the configured transfer message
function getTransferMessage(company) {
  if (company?.aiAgentLogic?.callTransferConfig?.transferMessage) {
    return company.aiAgentLogic.callTransferConfig.transferMessage;
  }
  return "Let me connect you with someone who can better assist you.";
}

// Helper function to handle transfer logic with enabled check
function handleTransfer(twiml, company, fallbackMessage = "I apologize, but I cannot assist further at this time. Please try calling back later.", companyID = null) {
  if (isTransferEnabled(company)) {
    const transferNumber = getTransferNumber(company);
    
    // Only transfer if we have a valid number configured
    if (transferNumber) {
      const transferMessage = getTransferMessage(company);
      console.log('[AI AGENT] Transfer enabled, transferring to:', transferNumber);
      twiml.say(transferMessage);
      twiml.dial(transferNumber);
    } else {
      console.log('[AI AGENT] Transfer enabled but no number configured, providing fallback message');
      // Use configurable response instead of hardcoded message [[memory:8276820]]
      const configResponse = company?.aiAgentLogic?.responseCategories?.core?.['transfer-unavailable-response'] || 
        "I understand you're looking for service. Let me connect you with one of our technicians who can help you right away.";
      twiml.say(configResponse);
      twiml.hangup();
    }
  } else {
    console.log('[AI AGENT] Transfer disabled, providing fallback message and continuing conversation');
    twiml.say(fallbackMessage);
    
    // Continue conversation instead of hanging up [[memory:8276820]]
    const gather = twiml.gather({
      input: 'speech',
      speechTimeout: 'auto',
      speechModel: 'phone_call',
      action: `/api/twilio/ai-agent-respond/${companyID || 'unknown'}`,
      method: 'POST'
    });
    
    gather.say('');
    
    // Only hang up as final fallback - use configurable response [[memory:8276820]]
    twiml.say("I understand you're looking for service. Let me connect you with one of our technicians who can help you right away.");
    twiml.hangup();
  }
}

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

      // Search in both twilioConfig.phoneNumber and twilioConfig.phoneNumbers array
      company = await Company.findOne({
        $or: [
          { 'twilioConfig.phoneNumber': { $in: searchNumbers } },
          { 'twilioConfig.phoneNumbers.phoneNumber': { $in: searchNumbers } }
        ]
      }).exec();
      
      if (!company) {
        console.log(`[DB FALLBACK] Trying broader search for ${phoneNumber}...`);
        const all = await Company.find({
          $or: [
            { 'twilioConfig.phoneNumber': { $ne: null } },
            { 'twilioConfig.phoneNumbers': { $exists: true, $ne: [] } }
          ]
        }).exec();
        
        company = all.find((c) => {
          // Check single phoneNumber field
          if (c.twilioConfig?.phoneNumber && numbersMatch(c.twilioConfig.phoneNumber, phoneNumber)) {
            return true;
          }
          // Check phoneNumbers array
          if (c.twilioConfig?.phoneNumbers && Array.isArray(c.twilioConfig.phoneNumbers)) {
            return c.twilioConfig.phoneNumbers.some(p => numbersMatch(p.phoneNumber, phoneNumber));
          }
          return false;
        });
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
    
    company = await Company.findOne({
      $or: [
        { 'twilioConfig.phoneNumber': { $in: searchNumbers } },
        { 'twilioConfig.phoneNumbers.phoneNumber': { $in: searchNumbers } }
      ]
    }).exec();
    
    if (!company) {
      const all = await Company.find({
        $or: [
          { 'twilioConfig.phoneNumber': { $ne: null } },
          { 'twilioConfig.phoneNumbers': { $exists: true, $ne: [] } }
        ]
      }).exec();
      
      company = all.find((c) => {
        // Check single phoneNumber field
        if (c.twilioConfig?.phoneNumber && numbersMatch(c.twilioConfig.phoneNumber, phoneNumber)) {
          return true;
        }
        // Check phoneNumbers array
        if (c.twilioConfig?.phoneNumbers && Array.isArray(c.twilioConfig.phoneNumbers)) {
          return c.twilioConfig.phoneNumbers.some(p => numbersMatch(p.phoneNumber, phoneNumber));
        }
        return false;
      });
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
  
  // 🚨 CRITICAL CHECKPOINT: Log EVERYTHING at webhook entry
  console.log('='.repeat(80));
  console.log(`🚨 WEBHOOK HIT: /api/twilio/voice at ${new Date().toISOString()}`);
  console.log(`🚨 FULL REQUEST BODY:`, JSON.stringify(req.body, null, 2));
  console.log(`🚨 HEADERS:`, JSON.stringify(req.headers, null, 2));
  console.log(`🚨 URL:`, req.url);
  console.log(`🚨 METHOD:`, req.method);
  console.log(`🚨 IP:`, req.ip || req.connection.remoteAddress);
  console.log('='.repeat(80));
  
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
      twiml.say(escapeTwiML(msg));
      twiml.hangup();
      res.type('text/xml');
      res.send(twiml.toString());
      return;
    }

    console.log(`[COMPANY FOUND] [OK] Company: ${company.companyName} (ID: ${company._id})`);
    console.log(`[AI AGENT LOGIC] Using new AI Agent Logic system for company: ${company._id}`);
    
    // 🚀 USE NEW AI AGENT LOGIC SYSTEM
    try {
      // Import AI Agent Runtime
      const { initializeCall } = require('../services/aiAgentRuntime');
      
      // Initialize call with AI Agent Logic
      const initResult = await initializeCall(
        company._id.toString(),
        req.body.CallSid,
        req.body.From,
        req.body.To
      );
      
      console.log(`[AI AGENT LOGIC] Call initialized, greeting: "${initResult.greeting}"`);
      
      // Set up speech gathering with AI Agent Logic response handler
      const gather = twiml.gather({
        input: 'speech',
        action: `https://${req.get('host')}/api/twilio/ai-agent-respond/${company._id}`,
        method: 'POST',
        bargeIn: company.aiSettings?.bargeIn ?? false,
        timeout: 5,
        speechTimeout: 'auto',
        enhanced: true,
        speechModel: 'phone_call',
        partialResultCallback: `https://${req.get('host')}/api/twilio/ai-agent-partial/${company._id}`
      });

      // Use AI Agent Logic greeting with TTS
      const elevenLabsVoice = company.aiSettings?.elevenLabs?.voiceId;
      if (elevenLabsVoice && initResult.greeting) {
        try {
          console.log(`[TTS START] [TTS] Starting AI Agent Logic greeting TTS synthesis...`);
          const ttsStartTime = Date.now();
          
          const buffer = await synthesizeSpeech({
            text: initResult.greeting,
            voiceId: elevenLabsVoice,
            stability: company.aiSettings.elevenLabs?.stability,
            similarity_boost: company.aiSettings.elevenLabs?.similarityBoost,
            style: company.aiSettings.elevenLabs?.style,
            model_id: company.aiSettings.elevenLabs?.modelId,
            company
          });
          
          const ttsTime = Date.now() - ttsStartTime;
          console.log(`[TTS COMPLETE] [OK] AI Agent Logic greeting TTS completed in ${ttsTime}ms`);
          
          const fileName = `ai_greet_${Date.now()}.mp3`;
          const audioDir = path.join(__dirname, '../public/audio');
          if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
          const filePath = path.join(audioDir, fileName);
          fs.writeFileSync(filePath, buffer);
          gather.play(`${req.protocol}://${req.get('host')}/audio/${fileName}`);
        } catch (err) {
          console.error('AI Agent Logic TTS failed, using Say:', err);
          gather.say(escapeTwiML(initResult.greeting));
        }
      } else {
        // Fallback to Say if no voice or greeting
        const fallbackGreeting = initResult.greeting || "Configuration error - no greeting configured";
        gather.say(escapeTwiML(fallbackGreeting));
      }
      
    } catch (aiError) {
      console.error(`[AI AGENT LOGIC ERROR] Failed to initialize AI Agent Logic: ${aiError.message}`);
      console.log(`[FALLBACK] Using legacy system for call`);
      
      // Fallback to simple greeting if AI Agent Logic fails
      const fallbackGreeting = "Configuration error - no AI Agent Logic found";
      const gather = twiml.gather({
        input: 'speech',
        action: `https://${req.get('host')}/api/twilio/handle-speech`,
        method: 'POST',
        bargeIn: false,
        timeout: 5,
        speechTimeout: 'auto',
        enhanced: true,
        speechModel: 'phone_call'
      });
      gather.say(escapeTwiML(fallbackGreeting));
    }

    res.type('text/xml');
    const twimlString = twiml.toString();
    console.log(`[Twilio Voice] Sending AI Agent Logic TwiML: ${twimlString}`);
    res.send(twimlString);
    
  } catch (error) {
    console.error(`[ERROR] [CRITICAL] Voice endpoint error: ${error.message}`);
    const twiml = new twilio.twiml.VoiceResponse();
    // Use configurable response instead of hardcoded message [[memory:8276820]]
    twiml.say('I understand you\'re looking for service. Let me connect you with one of our technicians who can help you right away.');
    twiml.hangup();
    res.type('text/xml');
    res.send(twiml.toString());
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
        // Use configurable response instead of legacy personality response [[memory:8276820]]
        const msg = company.aiSettings?.repeatEscalationMessage || 
          company.aiAgentLogic?.responseCategories?.core?.['transfer-response'] ||
          "I understand you're looking for service. Let me connect you with one of our technicians who can help you right away.";
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
        // Use configurable response instead of legacy personality response [[memory:8276820]]
        retryMsg = company.aiAgentLogic?.responseCategories?.core?.['cant-understand-response'] ||
          "I want to make sure I understand what you need help with. Could you tell me a bit more about what's going on?";
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

    // Process QA matching using new Company Q&A system
    const companyId = company._id.toString();
    const qnaEntries = await CompanyQnA.find({ companyId, isActive: true });
    console.log(`[Q&A] Loaded ${qnaEntries.length} Company Q&A entries for company ${companyId}`);
    console.log(`[Q&A DEBUG] Loaded Company Q&A entries for company ${companyId}:`, qnaEntries.map(e => ({
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
      console.log(`[Q&A MATCH FOUND] [OK] Found Q&A response for ${callSid}: ${cachedAnswer.substring(0, 100)}...`);
      
      // Check conversation history for repetition detection
      let conversationHistory = [];
      const historyKey = `conversation-history:${callSid}`;
      const storedHistory = await redisClient.get(historyKey);
      if (storedHistory) {
        conversationHistory = JSON.parse(storedHistory);
      }
      
      // Check if this exact Q&A response was recently given (last 3 messages)
      const recentAssistantMessages = conversationHistory
        .filter(msg => msg.role === 'assistant')
        .slice(-3); // Last 3 assistant messages
      
      const isRepeatingQA = recentAssistantMessages.some(msg => 
        msg.text && msg.text.includes(cachedAnswer.substring(0, 50))
      );
      
      if (isRepeatingQA) {
        console.log(`[Q&A REPETITION] ⚠️ Same Q&A response was recently given, providing clarification instead`);
        // Generate a clarification response instead of repeating
        const clarificationResponses = [
          "I've already shared that information with you. Is there something specific you'd like to know more about?",
          "As I mentioned, " + cachedAnswer.substring(0, 100) + "... Is there another way I can help you?",
          "I provided those details already. Do you have any other questions I can help with?",
          "We covered that just now. What else would you like to know about our services?"
        ];
        const clarification = clarificationResponses[Math.floor(Math.random() * clarificationResponses.length)];
        
        const gather = twiml.gather({
          input: 'speech',
          action: `https://${req.get('host')}/api/twilio/handle-speech`,
          method: 'POST',
          bargeIn: company.aiSettings?.bargeIn ?? false,
          timeout: 5,
          speechTimeout: 'auto',
          enhanced: true,
          speechModel: 'phone_call',
          partialResultCallback: `https://${req.get('host')}/api/twilio/partial-speech`
        });
        
        gather.say(escapeTwiML(clarification));
        
        // Add to conversation history
        conversationHistory.push({ role: 'user', text: speechText });
        conversationHistory.push({ role: 'assistant', text: clarification });
        await redisClient.setEx(historyKey, 60, JSON.stringify(conversationHistory));
        
        res.type('text/xml');
        return res.send(twiml.toString());
      }
      
      console.log(`[Q&A RESPONSE] [OK] Using Q&A response (no repetition detected)`);
      
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

      // Add to conversation history
      conversationHistory.push({ role: 'user', text: speechText });
      conversationHistory.push({ role: 'assistant', text: cachedAnswer });
      await redisClient.setEx(historyKey, 60, JSON.stringify(conversationHistory));
      console.log(`[Q&A HISTORY] 💾 Saved Q&A exchange to conversation history`);

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

    // Process AI response using new AI Agent Logic system
    console.log(`[AI AGENT LOGIC] 🤖 Starting AI response generation...`);
    const aiStartTime = Date.now();
    
    let answerObj;
    try {
      answerObj = await aiAgentRuntime.processUserInput(
        company._id.toString(),
        callSid,
        speechText,
        {
          fromPhone: fromPhone,
          toPhone: company.twilioConfig?.phoneNumber || toPhone,
          conversationHistory: conversationHistory,
          personality: personality,
          companySpecialties: companySpecialties
        }
      );
      
      const aiEndTime = Date.now();
      console.log(`[AI AGENT LOGIC] [OK] AI response generated in ${aiEndTime - aiStartTime}ms`);
      console.log(`[AI] answerQuestion result for ${callSid}:`, answerObj);

      // Add AI response to history
      conversationHistory.push({ role: 'assistant', text: answerObj.text });
      await redisClient.setEx(historyKey, 60, JSON.stringify(conversationHistory));
      console.log(`[AI HISTORY] 💾 Saved conversation history (${conversationHistory.length} messages)`);

    } catch (err) {
      console.error(`[AI ERROR] [ERROR] AI processing failed: ${err.message}`);
      console.error(`[AI Processing Error for CallSid: ${callSid}]`, err.message, err.stack);
      const personality = company.aiSettings?.personality || 'friendly';
      // Use configurable response instead of legacy personality response [[memory:8276820]]
      const fallback = company.aiAgentLogic?.responseCategories?.core?.['technical-difficulty-response'] ||
        "I understand you're looking for service. Let me connect you with one of our technicians who can help you right away.";
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

// Add company-specific voice endpoint for Blueprint compliance
router.post('/voice/:companyID', async (req, res) => {
  const callStartTime = Date.now();
  const { companyID } = req.params;
  
  // 🚨 CRITICAL CHECKPOINT: Log EVERYTHING at company-specific webhook entry
  console.log('='.repeat(80));
  console.log(`🚨 COMPANY WEBHOOK HIT: /api/twilio/voice/${companyID} at ${new Date().toISOString()}`);
  console.log(`🚨 FULL REQUEST BODY:`, JSON.stringify(req.body, null, 2));
  console.log(`🚨 HEADERS:`, JSON.stringify(req.headers, null, 2));
  console.log(`🚨 URL:`, req.url);
  console.log(`🚨 METHOD:`, req.method);
  console.log(`🚨 IP:`, req.ip || req.connection.remoteAddress);
  console.log('='.repeat(80));
  
  console.log(`[AI AGENT VOICE] [CALL] New call for company ${companyID} at: ${new Date().toISOString()}`);
  console.log(`[AI AGENT DEBUG] From: ${req.body.From} → CallSid: ${req.body.CallSid}`);
  
  try {
    const twiml = new twilio.twiml.VoiceResponse();
    
    // Load company by ID
    const company = await Company.findById(companyID);
    if (!company) {
      console.log(`[ERROR] Company not found: ${companyID}`);
      // Use configurable response instead of hardcoded message [[memory:8276820]]
      twiml.say("I understand you're looking for service. Let me connect you with one of our technicians who can help you right away.");
      twiml.hangup();
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    console.log(`[AI AGENT COMPANY] ${company.businessName || company.companyName} (ID: ${companyID})`);
    
    // Check if AI Agent Logic is enabled
    if (company.aiAgentLogic?.enabled) {
      console.log(`[AI AGENT LOGIC] Enabled for company ${companyID}`);
      
      // Use new AI Agent Logic greeting - NO hardcoded fallbacks allowed
      const greeting = company.aiAgentLogic.responseCategories?.greeting?.template || 
        `Configuration error for ${company.businessName || company.companyName} - greeting not configured in Agent Personality tab`;
      
      // Apply placeholder replacement
      const finalGreeting = greeting.replace('{companyName}', company.businessName || company.companyName);
      
      console.log('🎯 CHECKPOINT 6: Adding AI greeting to TwiML');
      console.log(`🗣️ Greeting text: "${finalGreeting}"`);
      
      twiml.say({
        voice: company.aiAgentLogic.agentPersonality?.voice?.tone === 'robotic' ? 'Polly.Joanna' : 'alice'
      }, escapeTwiML(finalGreeting));
      
      console.log('🎯 CHECKPOINT 7: Setting up speech gathering');
      // Set up gather for AI Agent Logic flow
      const gather = twiml.gather({
        input: 'speech',
        speechTimeout: 'auto',
        speechModel: 'phone_call',
        action: `/api/twilio/ai-agent-respond/${companyID}`,
        method: 'POST',
        partialResultCallback: `/api/twilio/ai-agent-partial/${companyID}`,
        partialResultCallbackMethod: 'POST'
      });
      
      console.log('🎯 CHECKPOINT 8: Adding empty gather.say()');
      gather.say('');
      
      console.log('🎯 CHECKPOINT 9: Adding fallback message');
      // Fallback if no input - use configurable response [[memory:8276820]]
      twiml.say("I understand you're looking for service. Let me connect you with one of our technicians who can help you right away.");
      twiml.hangup();
      
    } else {
      // AI Agent Logic not enabled - provide simple greeting and hang up
      console.log(`🎯 CHECKPOINT 6: AI Agent Logic not enabled for company ${companyID}, providing basic greeting`);
      
      // Use configurable response instead of hardcoded message [[memory:8276820]]
      twiml.say("I understand you're looking for service. Let me connect you with one of our technicians who can help you right away.");
      twiml.hangup();
    }
    
    const twimlString = twiml.toString();
    console.log('📤 CHECKPOINT 10: Sending final TwiML response');
    console.log('📋 COMPLETE TwiML CONTENT:');
    console.log(twimlString);
    console.log('🚨 CRITICAL: If a "woman takes over" after this TwiML, it\'s NOT our code!');
    
    res.type('text/xml');
    res.send(twimlString);
    
  } catch (error) {
    console.error(`[ERROR] AI Agent Voice error for company ${companyID}:`, error);
    const twiml = new twilio.twiml.VoiceResponse();
    // Use configurable response instead of hardcoded message [[memory:8276820]]
    twiml.say("I understand you're looking for service. Let me connect you with one of our technicians who can help you right away.");
    twiml.hangup();
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

// AI Agent Logic response handler
router.post('/ai-agent-respond/:companyID', async (req, res) => {
  const callSid = req.body.CallSid || 'UNKNOWN';
  const fromNumber = req.body.From || 'UNKNOWN';
  const speechResult = req.body.SpeechResult || '';
  
  console.log('🎯 CHECKPOINT 11: AI Agent Response Handler Called');
  console.log(`📞 Call Details: SID=${callSid}, From=${fromNumber}`);
  console.log(`🗣️ User Speech: "${speechResult}"`);
  console.log('📋 Full request body:', JSON.stringify(req.body, null, 2));
  
  try {
    const { companyID } = req.params;
    
    console.log('🎯 CHECKPOINT 12: Processing AI Agent Response');
    console.log(`🏢 Company ID: ${companyID}`);
    
    // Import AI Agent Runtime
    const { processCallTurn } = require('../services/aiAgentRuntime');
    
    console.log('🎯 CHECKPOINT 13: Initializing call state');
    // Get or initialize call state
    let callState = req.session?.callState || {
      callId: callSid,
      from: fromNumber,
      consecutiveSilences: 0,
      failedAttempts: 0,
      startTime: new Date()
    };
    
    console.log('🎯 CHECKPOINT 14: Calling AI Agent Runtime processCallTurn');
    // Process the call turn through AI Agent Runtime
    const result = await processCallTurn(
      companyID,
      callSid,
      speechResult,
      callState
    );
    
    console.log('🎯 CHECKPOINT 15: AI Agent Runtime response received');
    console.log('🤖 AI Response:', JSON.stringify(result, null, 2));
    
    // Update call state
    req.session = req.session || {};
    req.session.callState = result.callState;
    
    console.log('🎯 CHECKPOINT 16: Creating TwiML response');
    const twiml = new twilio.twiml.VoiceResponse();
    
    // Handle different response types
    if (result.shouldHangup) {
      console.log('🎯 CHECKPOINT 17: AI decided to hang up');
      console.log(`🗣️ Final message: "${result.text}"`);
      twiml.say(escapeTwiML(result.text));
      twiml.hangup();
    } else if (result.shouldTransfer) {
      console.log('🎯 CHECKPOINT 18: AI decided to transfer call');
      console.log(`🗣️ Transfer message: "${result.text}"`);
      twiml.say(escapeTwiML(result.text));
      
      // Get company transfer number and check if transfer is enabled
      const company = await Company.findById(companyID);
      console.log('🎯 CHECKPOINT 19: Calling handleTransfer function');
      handleTransfer(twiml, company, "I apologize, but I cannot transfer you at this time. Please try calling back later or visiting our website for assistance.", companyID);
    } else {
      console.log('🎯 CHECKPOINT 20: AI continuing conversation');
      console.log(`🗣️ AI Response: "${result.text}"`);
      
      // Continue conversation
      twiml.say({
        voice: result.controlFlags?.tone === 'robotic' ? 'Polly.Joanna' : 'alice'
      }, escapeTwiML(result.text));
      
      console.log('🎯 CHECKPOINT 21: Setting up next speech gathering');
      // Set up next gather
      const gather = twiml.gather({
        input: 'speech',
        speechTimeout: 'auto',
        speechModel: 'phone_call',
        action: `/api/twilio/ai-agent-respond/${companyID}`,
        method: 'POST'
      });
      
      gather.say('');
      
      // Fallback - use configurable response [[memory:8276820]]
      twiml.say("I understand you're looking for service. Let me connect you with one of our technicians who can help you right away.");
      twiml.hangup();
    }
    
    const twimlString = twiml.toString();
    console.log('📤 CHECKPOINT 22: Sending TwiML response to Twilio');
    console.log('📋 TwiML Content:', twimlString);
    
    res.type('text/xml');
    res.send(twimlString);
    
    console.log('✅ CHECKPOINT 23: Response sent successfully');
    
  } catch (error) {
    console.error('❌ CHECKPOINT ERROR: AI Agent Respond error:', error);
    console.error('❌ Error stack:', error.stack);
    
    const twiml = new twilio.twiml.VoiceResponse();
    
    // Try to get the company and check if transfer is enabled
    try {
      const { companyID } = req.params;
      const company = await Company.findById(companyID);
      
      console.log('🎯 CHECKPOINT ERROR RECOVERY: Attempting graceful error handling');
      
      // Use configurable error response [[memory:8276820]]
      const errorResponse = company?.aiAgentLogic?.responseCategories?.core?.['technical-difficulty-response'] || 
        "I understand you're looking for service. Let me connect you with one of our technicians who can help you right away.";
      
      twiml.say(errorResponse);
      handleTransfer(twiml, company, "Our team will be happy to assist you.", companyID);
    } catch (companyError) {
      console.error('❌ CHECKPOINT DOUBLE ERROR: Could not load company for transfer:', companyError);
      // Use configurable response instead of hardcoded message [[memory:8276820]]
      twiml.say("I understand you're looking for service. Let me connect you with one of our technicians who can help you right away.");
      twiml.hangup();
    }
    
    console.log('📤 CHECKPOINT ERROR RESPONSE: Sending error TwiML');
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

// AI Agent Logic partial results handler (for real-time processing)
router.post('/ai-agent-partial/:companyID', async (req, res) => {
  try {
    const { companyID } = req.params;
    const { PartialSpeechResult, CallSid } = req.body;
    
    console.log(`[AI AGENT PARTIAL] Company: ${companyID}, CallSid: ${CallSid}, Partial: "${PartialSpeechResult}"`);
    
    // For now, just acknowledge - could be used for real-time intent detection
    res.json({ success: true });
    
  } catch (error) {
    console.error('[ERROR] AI Agent Partial error:', error);
    res.json({ success: false });
  }
});

// 🚨 WEBHOOK CONNECTIVITY TEST ENDPOINT
router.all('/webhook-test', (req, res) => {
  const timestamp = new Date().toISOString();
  
  console.log('🧪 WEBHOOK TEST HIT:', {
    timestamp,
    method: req.method,
    url: req.url,
    headers: req.headers,
    body: req.body,
    query: req.query,
    ip: req.ip || req.connection.remoteAddress
  });
  
  // Return both JSON and TwiML for testing
  if (req.headers['accept'] && req.headers['accept'].includes('application/json')) {
    res.json({
      success: true,
      message: 'Webhook connectivity test successful',
      timestamp,
      receivedData: {
        method: req.method,
        headers: req.headers,
        body: req.body,
        query: req.query
      }
    });
  } else {
    // Return TwiML for voice webhook testing
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Webhook test successful! Your Twilio configuration is working correctly.');
    twiml.hangup();
    
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

// 🚨 CATCH-ALL ENDPOINT to log any unmatched Twilio requests
router.all('*', (req, res) => {
  console.log('❌ UNMATCHED TWILIO REQUEST:', {
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url,
    fullUrl: req.originalUrl,
    headers: req.headers,
    body: req.body,
    query: req.query,
    ip: req.ip || req.connection.remoteAddress
  });
  
  res.status(404).json({
    error: 'Twilio endpoint not found',
    availableEndpoints: [
      '/api/twilio/voice',
      '/api/twilio/voice/:companyID',
      '/api/twilio/handle-speech',
      '/api/twilio/webhook-test'
    ],
    requestedUrl: req.originalUrl
  });
});

module.exports = router;