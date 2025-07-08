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
    let voice = company?.aiSettings?.googleVoice
      ? `Google.${company.aiSettings.googleVoice}`
      : 'Google.en-US-Wavenet-A';

    if (!company) {
      const msg = await getRandomPersonalityResponse(null, 'connectionTrouble');
      twiml.say({ voice }, escapeTwiML(msg));
      twiml.hangup();
    } else {
      const greetingType = company.agentSetup?.greetingType || 'tts';
      const greetingAudioUrl = company.agentSetup?.greetingAudioUrl || '';
      let greeting = company.agentSetup?.agentGreeting || "Hello, thank you for calling. How can I help you today?";
      console.log(`[Twilio Voice] Greeting type: ${greetingType}`);

      const gather = twiml.gather({
        input: 'speech',
        action: `https://${req.get('host')}/api/twilio/handle-speech`,
        method: 'POST',
        bargeIn: company.aiSettings?.bargeIn ?? false, // Let agent finish greeting for natural flow
        timeout: company.aiSettings?.silenceTimeout ?? 8
      });

      const elevenLabsVoice = company.aiSettings?.elevenLabs?.voiceId;
      if (greetingType === 'audio' && greetingAudioUrl) {
        gather.play(greetingAudioUrl);
      } else if (company.aiSettings?.ttsProvider === 'elevenlabs' && elevenLabsVoice) {
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
          console.error('ElevenLabs TTS failed, falling back to Google TTS:', err);
          gather.say({ voice }, escapeTwiML(greeting));
        }
      } else {
        gather.say({ voice }, escapeTwiML(greeting));
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
    twiml.say({ voice: 'Google.en-US-Wavenet-A' }, escapeTwiML(msg));
    twiml.hangup();
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

router.post('/handle-speech', async (req, res) => {
  try {
    console.log('[POST /api/twilio/handle-speech] Incoming speech:', req.body);
    const speechText = req.body.SpeechResult || '';
    const twiml = new twilio.twiml.VoiceResponse();
    let voice = 'Google.en-US-Wavenet-A';
    const callSid = req.body.CallSid;
    const repeatKey = `twilio-repeats:${callSid}`;

    if (!speechText) {
      const msg = await getRandomPersonalityResponse(null, 'cantUnderstand');
      twiml.say({ voice: 'Google.en-US-Wavenet-A' }, escapeTwiML(msg));
      twiml.hangup();
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    const calledNumber = normalizePhoneNumber(req.body.To);
    let company = await getCompanyByPhoneNumber(calledNumber);
    if (!company) {
      const msg = await getRandomPersonalityResponse(null, 'connectionTrouble');
      twiml.say({ voice }, escapeTwiML(msg));
      twiml.hangup();
    } else {
      if (company.aiSettings?.logCalls) {
        console.log(`[Call Log] CallSid ${req.body.CallSid} Speech: ${speechText}`);
      }
      voice = company.aiSettings?.googleVoice
        ? `Google.${company.aiSettings.googleVoice}`
        : voice;

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
          twiml.say({ voice }, escapeTwiML(msg));
          twiml.hangup();
          await redisClient.del(repeatKey);
          res.type('text/xml');
          return res.send(twiml.toString());
        }
        const gather = twiml.gather({
          input: 'speech',
          action: `https://${req.get('host')}/api/twilio/handle-speech`,
          method: 'POST',
          bargeIn: company.aiSettings?.bargeIn ?? false, // Let agent finish speaking
          timeout: company.aiSettings?.silenceTimeout ?? 8
        });
        const personality = company.aiSettings?.personality || 'friendly';
        const retryMsg = await getPersonalityResponse(company._id.toString(), 'cantUnderstand', personality);
        gather.say({ voice }, escapeTwiML(retryMsg));
        res.type('text/xml');
        return res.send(twiml.toString());
      }
      await redisClient.del(repeatKey);

      // callSid already defined earlier
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
        const gather = twiml.gather({
          input: 'speech',
          action: `https://${req.get('host')}/api/twilio/handle-speech`,
          method: 'POST',
          bargeIn: company.aiSettings?.bargeIn ?? false, // Let agent finish speaking
          timeout: company.aiSettings?.silenceTimeout ?? 8
        });
        gather.say({ voice }, escapeTwiML(cachedAnswer));
        res.type('text/xml');
        return res.send(twiml.toString());
      }
      const mainAgentScript = company.agentSetup?.mainAgentScript || '';
      const personality = company.aiSettings?.personality || 'friendly';
      const responseLength = company.aiSettings?.responseLength || 'concise';
      const companySpecialties = company.agentSetup?.companySpecialties || '';
      const categoryQAs = company.agentSetup?.categoryQAs || '';

      // Retrieve conversation history from Redis
      let conversationHistory = [];
      const historyKey = `conversation-history:${callSid}`;
      const storedHistory = await redisClient.get(historyKey);
      if (storedHistory) {
        conversationHistory = JSON.parse(storedHistory);
      }

      // Add current user speech to history
      conversationHistory.push({ role: 'user', text: speechText });

      // Store context in Redis for asynchronous processing
      const context = {
        speechText: speechText,
        companyId: companyId,
        companyName: company.companyName,
        voice: voice,
        ttsProvider: company.aiSettings?.ttsProvider || 'elevenlabs',
        elevenLabs: company.aiSettings?.elevenLabs || {},
        calledNumber: req.body.To,
        fromNumber: req.body.From,
        mainAgentScript: mainAgentScript,
        personality: personality,
        responseLength: responseLength,
        conversationHistory: conversationHistory, // Store updated history
        responseDelayMs: company.aiSettings?.responseDelayMs || 0,
        logCalls: company.aiSettings?.logCalls || false,
        bargeIn: company.aiSettings?.bargeIn ?? false, // Let agent finish speaking
        silenceTimeout: company.aiSettings?.silenceTimeout ?? 3, // Faster timeout
        fillersEnabled: company.aiSettings?.humanLikeFillers || false,
        fillerPhrases: company.aiSettings?.fillerPhrases || []
      };
      
      console.log(`[Context Debug] TTS Provider: ${context.ttsProvider}, ElevenLabs VoiceId: ${context.elevenLabs?.voiceId}`);
      
      await redisClient.setEx(`twilio-context:${callSid}`, 60, JSON.stringify(context));
      console.log(`[Redis] Stored context for CallSid: ${callSid}`);

      // Process AI response in a dedicated async function
      const processAiResponse = async () => {
        try {
          const answerObj = await answerQuestion(
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
          await redisClient.setEx(`twilio-answer:${callSid}`, 60, JSON.stringify(answerObj));
          console.log(`[Redis] Stored answer for CallSid: ${callSid}`, answerObj);

          // Add AI response to history and store back in Redis
          conversationHistory.push({ role: 'assistant', text: answerObj.text });
          await redisClient.setEx(historyKey, 60, JSON.stringify(conversationHistory));
          console.log(`[Redis] Updated conversation history for CallSid: ${callSid}`);

        } catch (err) {
          console.error(`[AI Processing Error for CallSid: ${callSid}]`, err.message, err.stack);
          const personality = company.aiSettings?.personality || 'friendly';
          const fallback = await getPersonalityResponse(company._id.toString(), 'connectionTrouble', personality);
          await redisClient.setEx(`twilio-answer:${callSid}`, 60, JSON.stringify({ text: fallback, escalate: false }));
        }
      };
      
      // Call the processing function without awaiting it directly here
      // The polling mechanism in /process-ai-response will pick up the answer
      processAiResponse();

      // Respond with a brief, natural thinking pause (like a human would)
      // Then immediately redirect to get the response
      twiml.pause({ length: 1 }); // 1 second natural thinking pause
      twiml.redirect('/api/twilio/process-ai-response');
    }

    res.type('text/xml');
    res.send(twiml.toString());
  } catch (err) {
    console.error('[POST /api/twilio/handle-speech] Error:', err.message, err.stack);
    const twiml = new twilio.twiml.VoiceResponse();
    const msg = await getRandomPersonalityResponse(null, 'connectionTrouble');
    twiml.say({ voice: 'Google.en-US-Wavenet-A' }, escapeTwiML(msg));
    twiml.hangup();
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

router.post('/process-ai-response', async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  let voice = 'Google.en-US-Wavenet-A'; // Default voice

  try {
    const callSid = req.body.CallSid;
    const attemptsKey = `twilio-attempts:${callSid}`;
    const answerString = await redisClient.get(`twilio-answer:${callSid}`);
    const answerObj = answerString ? JSON.parse(answerString) : null;
    console.log(`[Twilio Process AI] Retrieved answerObj for ${callSid}:`, answerObj);
    const contextString = await redisClient.get(`twilio-context:${callSid}`);
    const context = contextString ? JSON.parse(contextString) : null;

    const attempts = await redisClient.incr(attemptsKey);
    if (attempts === 1) {
      await redisClient.expire(attemptsKey, 60);
    }

    if (context && context.voice) {
      voice = context.voice; // Use the company's configured voice
    }

    if (answerObj && answerObj.text) {
      console.log(`[Twilio Process AI] Answer found for CallSid: ${callSid}`);
      const delay = context?.responseDelayMs || 0;
      if (delay > 0) {
        await new Promise(res => setTimeout(res, delay));
      }
      if (answerObj.escalate) {
        const gather = twiml.gather({
          input: 'speech',
          action: '/api/twilio/handle-speech',
          method: 'POST',
          bargeIn: context?.bargeIn ?? false, // Let agent finish speaking
          timeout: context?.silenceTimeout ?? 8
        });
        const cleanedText = cleanTextForTTS(stripMarkdown(answerObj.text));
        gather.say(
          { voice },
          cleanedText // Don't escape - already cleaned
        );
      } else {
        const gather = twiml.gather({
          input: 'speech',
          action: '/api/twilio/handle-speech',
          method: 'POST',
          bargeIn: context?.bargeIn ?? false, // Let agent finish speaking
          timeout: context?.silenceTimeout ?? 8
        });
        const strippedAnswer = cleanTextForTTS(stripMarkdown(answerObj.text));
        console.log(`[Twilio Process AI] Cleaned Answer: ${strippedAnswer}`);
        console.log(`[Twilio Process AI] TTS Provider: ${context.ttsProvider}, ElevenLabs VoiceId: ${context.elevenLabs?.voiceId}`);
        
        if (context.ttsProvider === 'elevenlabs' && context.elevenLabs?.voiceId) {
          try {
            console.log(`[Twilio Process AI] Using ElevenLabs TTS with voice: ${context.elevenLabs.voiceId}`);
            
            // Reconstruct company object for ElevenLabs API key lookup
            const companyObj = {
              _id: context.companyId,
              companyName: context.companyName,
              aiSettings: {
                elevenLabs: context.elevenLabs
              }
            };
            
            const buffer = await synthesizeSpeech({
              text: strippedAnswer,
              voiceId: context.elevenLabs.voiceId,
              stability: context.elevenLabs.stability,
              similarity_boost: context.elevenLabs.similarityBoost,
              style: context.elevenLabs.style,
              model_id: context.elevenLabs.modelId,
              company: companyObj
            });
            const fileName = `tts_${callSid}_${Date.now()}.mp3`;
            const audioDir = path.join(__dirname, '../public/audio');
            if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
            const filePath = path.join(audioDir, fileName);
            fs.writeFileSync(filePath, buffer);
            gather.play(`https://${req.get('host')}/audio/${fileName}`);
            console.log(`[Twilio Process AI] ElevenLabs TTS succeeded, playing audio file`);
          } catch (err) {
            console.error('ElevenLabs synthesis failed, falling back to Google TTS:', err.message);
            console.log(`[Twilio Process AI] Fallback - Using Google TTS`);
            gather.say({ voice }, strippedAnswer); // Don't escape - already cleaned
          }
        } else {
          console.log(`[Twilio Process AI] Using Google TTS - ttsProvider: ${context.ttsProvider}, elevenLabs voiceId: ${context.elevenLabs?.voiceId}`);
          gather.say({ voice }, strippedAnswer); // Don't escape - already cleaned
        }
      }
      await redisClient.del(`twilio-context:${callSid}`); // Clean up context
      await redisClient.del(`twilio-answer:${callSid}`); // Clean up answer
      await redisClient.del(attemptsKey); // reset polling attempts
      console.log(`[Redis] Deleted context and answer for CallSid: ${callSid}`);
    } else {
      if (attempts > 4) {
        console.log(`[Twilio Process AI] Exceeded polling attempts for CallSid: ${callSid}. Sending fallback.`);
        const gather = twiml.gather({
          input: 'speech',
          action: '/api/twilio/handle-speech',
          method: 'POST',
          bargeIn: context?.bargeIn ?? false, // Let agent finish speaking
          timeout: context?.silenceTimeout ?? 8
        });
        const msg = await getRandomPersonalityResponse(context?.companyId || null, 'connectionTrouble');
        gather.say({ voice }, escapeTwiML(msg));
        await redisClient.del(`twilio-context:${callSid}`);
        await redisClient.del(`twilio-answer:${callSid}`);
        await redisClient.del(attemptsKey);
      } else {
        console.log(`[Twilio Process AI] Answer not yet ready for CallSid: ${callSid}. Polling again.`);
        // Answer not ready, poll again with minimal delay
        if (attempts <= 2) {
          // Fast polling for first 2 attempts (immediate response expected)
          twiml.redirect({ method: 'POST' }, `https://${req.get('host')}/api/twilio/process-ai-response`);
        } else {
          // Slightly longer pause after 2 attempts to avoid overwhelming
          twiml.pause({ length: 0.5 });
          twiml.redirect({ method: 'POST' }, `https://${req.get('host')}/api/twilio/process-ai-response`);
        }
      }
    }

  } catch (err) {
    console.error('[POST /api/twilio/process-ai-response] Error:', err.message, err.stack);
    const gather = twiml.gather({
      input: 'speech',
      action: '/api/twilio/handle-speech',
      method: 'POST',
      bargeIn: context?.bargeIn ?? false, // Let agent finish speaking
      timeout: context?.silenceTimeout ?? 8
    });
    const msg = await getRandomPersonalityResponse(context?.companyId || null, 'connectionTrouble');
    gather.say({ voice }, escapeTwiML(msg));
  }

  res.type('text/xml');
  const twimlString = twiml.toString();
  console.log(`[Twilio Process AI] Sending TwiML: ${twimlString}`);
  res.send(twimlString);
});

// 🎛️ AGENT PERFORMANCE CONTROLS - LIVE TUNING DASHBOARD
// These values come from company.aiSettings - adjust via UI, not code
// For optimization: use company profile → AI Voice Settings → Agent Performance Controls
// NO HARDCODING - all tuning happens through the live dashboard

module.exports = router;