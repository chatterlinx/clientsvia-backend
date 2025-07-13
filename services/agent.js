console.log('--- FINGERPRINT: EXECUTING services/agent.js ---'); // Added a comment to trigger re-deployment

const KnowledgeEntry = require('../models/KnowledgeEntry');
const { getDB } = require('../db');

const { google } = require('googleapis');
const { VertexAI } = require('@google-cloud/vertexai');
const { stripMarkdown } = require('../utils/textUtils');
const { findCachedAnswer } = require('../utils/aiAgent');
const { getRandomPersonalityResponse, getPersonalityResponse } = require('../utils/personalityResponses_enhanced');
const { applyPlaceholders } = require('../utils/placeholders');


// In-memory cache for parsed Category Q&A by company ID
const categoryQACache = new Map();

function parseCategoryQAs(text = '') {
  const pairs = [];
  const blocks = text.split('\n\n').filter(b => b.trim() !== '');
  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map(l => l.trim())
      .filter(l => l !== '');
    if (lines.length >= 2) {
      const q = stripMarkdown(lines[0].replace(/^(Q:|Question:)\s*/i, ''));
      const a = lines
        .slice(1)
        .join(' ')
        .replace(/^(A:|Answer:)\s*/i, '');
      pairs.push({ question: q, answer: a });
    }
  }
  return pairs;
}

function loadCompanyQAs(company) {
  if (!company || !company._id) return;
  const companyId = company._id.toString();
  const qaText = company.agentSetup?.categoryQAs || '';
  if (qaText) {
    categoryQACache.set(companyId, parseCategoryQAs(qaText));
  } else {
    categoryQACache.delete(companyId);
  }
}


// The explicit initialization using your Render Environment Variables
const vertex_ai = new VertexAI({
    project: process.env.GCLOUD_PROJECT_ID, 
    location: process.env.GCLOUD_LOCATION 
});

// Gemini Flash model
const MODEL_ID = process.env.MODEL_ID || 'gemini-1.5-flash-002'; // Use env or default to stable version
const MODEL_NAME = MODEL_ID;

// Default model used when a configured one fails with a not found error
const FALLBACK_MODEL = MODEL_NAME;

// Call the Gemini model via Vertex AI
async function callModel(company, prompt) {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  });
  const authClient = await auth.getClient();
  const projectId = process.env.GCLOUD_PROJECT_ID || await auth.getProjectId();
  const aiplatform = google.aiplatform({ version: 'v1beta1', auth: authClient });    const invoke = async (modelName) => {
      const model = `projects/${projectId}/locations/us-central1/publishers/google/models/${modelName}`;
      try {
        const vertexStartTime = Date.now();
        console.log(`[TIMING] VertexAI API call started at: ${vertexStartTime}`);
        console.log(`[VertexAI] Sending prompt to ${modelName}:`, prompt.substring(0, 200) + '...');
        const res = await aiplatform.projects.locations.publishers.models.generateContent({
          model,
          requestBody: {
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.3, // Further reduced for more consistent, concise responses
              topK: 5, // Reduced for faster, more focused responses
              topP: 0.6, // Reduced for more deterministic, shorter responses
              maxOutputTokens: 75, // Significantly reduced for ultra-concise responses
            }
          }
        });
        const vertexEndTime = Date.now();
        console.log(`[TIMING] VertexAI API call completed at: ${vertexEndTime}, took: ${vertexEndTime - vertexStartTime}ms`);
        const responseText = res.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        console.log(`[VertexAI] Received response from ${modelName}:`, responseText);
      
      // Check for potential issues with the response
      if (!responseText || responseText.trim() === '') {
        console.log(`[VertexAI] WARNING: Empty response from ${modelName}`);
        return 'I apologize, but I\'m having trouble processing your request right now. Let me connect you with a team member who can help.';
      }
      
      return responseText;
    } catch (err) {
      console.error(`[VertexAI] Error invoking model ${modelName}:`, err.response?.data || err.message, err.stack);
      throw err;
    }
  };

  const initialModel = company?.aiSettings?.model || FALLBACK_MODEL;

  try {
    return await invoke(initialModel);
  } catch (err) {
    const status = err?.response?.status;
    const msg = err?.message || '';
    if (status === 404 || msg.includes('not found')) {
      console.warn(`[VertexAI] Model not found: ${initialModel}, falling back to ${FALLBACK_MODEL}`);
      // Self-healing: Update the database with the fallback model
      if (company && company._id) {
        const db = getDB();
        db.collection('companiesCollection').updateOne(
          { _id: company._id },
          { $set: { 'aiSettings.model': FALLBACK_MODEL } }
        ).then(() => {
          console.log(`[VertexAI] Updated company ${company._id} to use model ${FALLBACK_MODEL}`);
        }).catch(err => {
          console.error(`[VertexAI] Error updating company ${company._id}:`, err);
        });
      }
      return await invoke(FALLBACK_MODEL);
    }
    throw err;
  }
}

const { ObjectId } = require('mongodb');
const SuggestedKnowledgeEntry = require('../models/SuggestedKnowledgeEntry');

async function answerQuestion(companyId, question, responseLength = 'concise', conversationHistory = [], mainAgentScript = '', personality = 'friendly', companySpecialties = '', categoryQAs = '', originalCallSid = null) {
  const db = getDB();
  const company = await db.collection('companiesCollection').findOne({ _id: new ObjectId(companyId) });
  const categories = company?.agentSetup?.categories || company?.tradeTypes || [];
  const { llmFallbackEnabled, customEscalationMessage } = company?.aiSettings || {};
  const placeholders = company?.agentSetup?.placeholders || [];

  console.log(`[Agent] Company ${companyId} - LLM Fallback Enabled: ${llmFallbackEnabled}`);
  console.log(`[Agent] Company ${companyId} - Custom Escalation Message: ${customEscalationMessage}`);
  console.log(`[Agent] Company ${companyId} - Categories: [${categories.join(', ')}]`);
  console.log(`[Agent] Company ${companyId} - Available Protocols: [${Object.keys(company?.agentSetup?.protocols || {}).join(', ')}]`);
  console.log(`[Agent] Company ${companyId} - Available Placeholders: [${placeholders.map(p => p.name).join(', ')}]`);
  console.log(`[Agent] Company ${companyId} - Main Script Length: ${company?.agentSetup?.mainAgentScript?.length || 0} chars`);
  console.log(`[Agent] Company ${companyId} - Category Q&As Length: ${company?.agentSetup?.categoryQAs?.length || 0} chars`);

  // keep parsed Q&A cached
  loadCompanyQAs(company);

  console.log(`[Agent Response Chain] Starting for company ${companyId}, question: "${question.substring(0, 100)}..."`);
  
  // STEP 1: Check for specific scenario protocols FIRST (highest priority)
  const protocols = company?.agentSetup?.protocols || {};
  const protocolResponse = checkSpecificProtocols(protocols, question, conversationHistory, placeholders);
  if (protocolResponse) {
    console.log(`[Agent] Using specific scenario protocol`);
    return { text: protocolResponse, escalate: false };
  }

  // STEP 2: Check personality responses for common scenarios
  const personalityResponse = await checkPersonalityScenarios(companyId, question.toLowerCase(), conversationHistory);
  if (personalityResponse) {
    console.log(`[Agent] Using personality response: ${personalityResponse.category}`);
    return { text: applyPlaceholders(personalityResponse.text, placeholders), escalate: false };
  }

  // STEP 3: Check KnowledgeEntry (approved Q&A entries)
  const entry = await KnowledgeEntry.findOne({ companyId, 
    category: { $in: categories },
    question: { $regex: new RegExp(question, 'i') },
    approved: true
  }).exec();

  if (entry) {
    console.log(`[KnowledgeBase] Found answer in KnowledgeEntry for: ${question}`);
    return { text: applyPlaceholders(entry.answer, placeholders), escalate: false };
  }

  // STEP 4: Try quick Q&A reference (cheat sheet approach)
  const quickQAAnswer = extractQuickAnswerFromQA(await KnowledgeEntry.find({ companyId }).exec(), question, fuzzyThreshold);
  if (quickQAAnswer) {
    console.log(`[Agent] Found quick Q&A reference for: ${question}`);
    const conversationalAnswer = generateShortConversationalResponse(question, quickQAAnswer, company?.companyName);
    return { text: applyPlaceholders(conversationalAnswer, placeholders), escalate: false };
  }

  // STEP 5: Try company Q&A from agentSetup.categoryQAs (also as quick reference)
  const companyQAs = categoryQACache.get(companyId) || [];
  if (companyQAs.length > 0) {
    const quickCompanyAnswer = extractQuickAnswerFromQA(companyQAs, question, fuzzyThreshold);
    if (quickCompanyAnswer) {
      console.log(`[Agent] Found quick company Q&A reference for: ${question}`);
      const conversationalAnswer = generateShortConversationalResponse(question, quickCompanyAnswer, company?.companyName);
      return { text: applyPlaceholders(conversationalAnswer, placeholders), escalate: false };
    }
  }

  // STEP 6: SMART CONVERSATIONAL BRAIN - NEW INTELLIGENT PROCESSING
  const smartResponse = await generateSmartConversationalResponse(company, question, conversationHistory, categories, companySpecialties, placeholders);
  if (smartResponse) {
    console.log(`[Agent] Generated smart conversational response for: ${question}`);
    return { text: smartResponse, escalate: false };
  }

  // STEP 7: Try structured conversational script processing
  const scriptResponse = await processConversationalScriptEnhanced(company, question, conversationHistory, placeholders);
  if (scriptResponse) {
    console.log(`[Agent] Generated script-based response for: ${question}`);
    return { text: scriptResponse, escalate: false };
  }

  // STEP 8: Try to understand the context and provide intelligent responses
  const intelligentResponse = await generateIntelligentResponse(company, question, conversationHistory, categories, companySpecialties, categoryQAs);
  if (intelligentResponse) {
    console.log(`[Agent] Generated intelligent response for: ${question}`);
    return { text: applyPlaceholders(intelligentResponse, placeholders), escalate: false };
  }


  // If no direct answer found, construct prompt for Gemini
  const agentSetup = company?.agentSetup || {};

  let fullPrompt = `You are an AI assistant for ${company?.companyName}. Your name is The Agent. Your personality is ${personality}.`;

  // Add company specialties and services
  if (companySpecialties) {
    fullPrompt += `\n\n**Company Specialties:**\n${companySpecialties}`;
  }

  // Add categories/trade types
  if (categories && categories.length > 0) {
    fullPrompt += `\n\n**Services We Offer:**\n${categories.join(', ')}`;
  }

  // Add main agent script if available
  if (mainAgentScript) {
    fullPrompt += `\n\n**Your Instructions:**\n${mainAgentScript}`;
  }

  // Add category Q&As for context
  if (categoryQAs) {
    fullPrompt += `\n\n**Common Questions & Answers:**\n${categoryQAs}`;
  }

  // Add conversation history
  if (conversationHistory.length > 2) {
    conversationHistory = conversationHistory.slice(-2);
  }

  if (conversationHistory.length > 0) {
    fullPrompt += "\n\n**Conversation History:**\n";
    conversationHistory.forEach(entry => {
      fullPrompt += `${entry.role}: ${entry.text}\n`;
    });
  }

  fullPrompt += `\n\n**Current Question:** ${question}`;

  // Check if this appears to be unclear speech or rambling
  const isUnclearSpeech = question.includes('[Speech unclear/low confidence:') || 
                         question.length < 5 || 
                         /^[a-z]{1,3}\.?$/i.test(question.trim());
                         
  const isRambling = question.length > 300 || 
                    question.split(' ').length > 50 ||
                    (question.match(/\b(and|then|so|but|also|actually|basically)\b/gi) || []).length > 5;

  fullPrompt += `\n\n**Response Guidelines:**`;
  fullPrompt += `\n- ULTRA-CONCISE: Maximum 1-2 sentences. Get to the point immediately.`;
  fullPrompt += `\n- You are The Agent for ${company?.companyName} - be natural but brief`;
  fullPrompt += `\n- Don't repeat what the caller said - acknowledge briefly and offer next steps`;
  fullPrompt += `\n- Skip pleasantries unless they're greeting you - focus on solutions`;
  fullPrompt += `\n- If they need service: offer to schedule. If they have questions: answer directly.`;
  fullPrompt += `\n- NO rambling, NO lengthy explanations, NO unnecessary details`;
  fullPrompt += `\n- Examples of good responses: "Yes, we fix that. Schedule a visit?" or "Starts at $89. Want a quote?"`;
  
  if (isUnclearSpeech) {
    fullPrompt += `\n- IMPORTANT: The caller's speech was unclear or garbled. Ask them to clarify what they need help with in a friendly way.`;
    fullPrompt += `\n- Example: "I'm having trouble understanding you clearly. Could you tell me what you need help with today?"`;
  }
  
  if (isRambling) {
    fullPrompt += `\n- IMPORTANT: The caller gave a very long explanation. Politely summarize what you heard and focus on the main issue.`;
    fullPrompt += `\n- Example: "I understand you're having an issue with [main problem]. Let me help you with that. Would you like to schedule a service call?"`;
    fullPrompt += `\n- Don't repeat their entire story back - acknowledge the key issue and offer next steps.`;
  }

  if (responseLength === 'concise') {
    fullPrompt += '\n- Keep responses to 1-2 sentences maximum.';
  } else if (responseLength === 'detailed') {
    fullPrompt += '\n- Provide helpful details but stay focused on their specific need.';
  }

  let promptQuestion;
  if (isUnclearSpeech) {
    promptQuestion = "The caller said something unclear - ask them to clarify what they need help with";
  } else if (isRambling) {
    promptQuestion = `The caller gave a long explanation about: "${question.substring(0, 150)}..." - summarize their main issue and offer help`;
  } else {
    promptQuestion = `"${question}"`;
  }
  
  fullPrompt += `\n\nRespond in 1-2 sentences maximum to: ${promptQuestion} - Be direct, actionable, and move the call forward.`;

  if (!llmFallbackEnabled) {
    const personality = company?.aiSettings?.personality || 'friendly';
    const message = applyPlaceholders((customEscalationMessage || await getPersonalityResponse(companyId, 'transferToRep', personality)).trim(), placeholders);
    try {
      const { logEscalationEvent } = require('../utils/escalationLogger');
      await logEscalationEvent(originalCallSid, companyId, question);
    } catch (err) {
      console.error('Failed to log escalation:', err.message);
    }
    return { text: message, escalate: true };
  }

  const aiResponse = await (async () => {
    const llmStartTime = Date.now();
    console.log(`[TIMING] LLM call started at: ${llmStartTime}`);
    console.log(`[LLM] Sending prompt to ${company?.companyName}:`, fullPrompt);
    const response = await callModel(company, fullPrompt);
    const llmEndTime = Date.now();
    console.log(`[TIMING] LLM call completed at: ${llmEndTime}, took: ${llmEndTime - llmStartTime}ms`);
    return response;
  })();

  console.log(`[LLM] Received response:`, aiResponse);

  // Post-process AI response to ensure it's ultra-concise
  let finalResponse = aiResponse;
  if (aiResponse && aiResponse.length > 150) {
    console.log(`[LLM] Response too long (${aiResponse.length} chars), making it concise...`);
    finalResponse = extractConciseAnswer(aiResponse);
    if (finalResponse.length > 100) {
      // Even more aggressive shortening if still too long
      const sentences = finalResponse.split(/[.!?]+/).filter(s => s.trim().length > 5);
      if (sentences.length > 1) {
        finalResponse = sentences[0].trim() + '.';
      }
    }
    console.log(`[LLM] Shortened response: "${finalResponse}"`);
  }

  // Check if the response seems to be a debug message
  if (finalResponse && finalResponse.includes('reading this from') && finalResponse.includes('LLM Message')) {
    console.log(`[LLM] DEBUG: Detected debug message from LLM, replacing with escalation message`);
    const personality = company?.aiSettings?.personality || 'friendly';
    const message = applyPlaceholders((customEscalationMessage || await getPersonalityResponse(companyId, 'transferToRep', personality)).trim(), placeholders);
    return { text: message, escalate: true };
  }

  // Logic to create a suggested knowledge entry
  if (finalResponse) {
    try {
      const newSuggestedEntry = new SuggestedKnowledgeEntry({
        question: question,
        suggestedAnswer: finalResponse, // Use the final concise response
        category: categories.length > 0 ? categories[0] : 'General',
        status: 'pending',
        originalCallSid: originalCallSid
      });
      await newSuggestedEntry.save();
      console.log(`[SuggestedKB] Created new pending suggestion for question: "${question}"`);
    } catch (suggestErr) {
      console.error(`[SuggestedKB] Error saving suggested knowledge entry:`, suggestErr.message);
    }
  }

  return { text: applyPlaceholders(finalResponse, placeholders), escalate: false };
}

// Generate intelligent responses based on context and common patterns - ENHANCED VERSION
async function generateIntelligentResponse(company, question, conversationHistory, categories, companySpecialties, categoryQAs) {
  const qLower = question.toLowerCase();
  const companyName = company?.companyName || 'our company';
  const companyId = company?._id?.toString();
  
  // PRIORITY 1: Use personality responses for specific scenarios
  const personalityResponse = await checkPersonalityScenarios(companyId, qLower, conversationHistory);
  if (personalityResponse) {
    console.log(`[Intelligent Response] Using personality response: ${personalityResponse.category}`);
    return personalityResponse.text;
  }
  
  // PRIORITY 2: Smart contextual understanding
  
  // Handle customer expressing satisfaction or completion
  if ((qLower.includes('thank') || qLower.includes('perfect') || qLower.includes('great')) && 
      (qLower.includes('that') || qLower.includes('it') || qLower.includes('you'))) {
    return `You're very welcome! I'm so glad I could help you get that sorted out. Feel free to call us anytime if you need anything else with your system. Have a wonderful day!`;
  }
  
  // Handle follow-up questions with intelligence
  if (conversationHistory.length > 2) {
    const lastAgentResponse = conversationHistory.filter(h => h.role === 'agent').slice(-1)[0];
    if (lastAgentResponse && lastAgentResponse.text.includes('schedule') && 
        (qLower.includes('yes') || qLower.includes('sure') || qLower.includes('okay'))) {
      return `Excellent! I'm ready to get that scheduled for you. What's your address, and what day and time would work best for your schedule? We typically have availability Monday through Friday between 8am and 5pm.`;
    }
  }

  // Enhanced conversation flow understanding
  if (qLower.includes('also') || qLower.includes('and') || qLower.includes('plus')) {
    return `I see there's more to it. Tell me about the additional issue you're experiencing, and I'll make sure we address everything during the visit.`;
  }

  // Smart problem escalation detection
  if ((qLower.includes('keep') || qLower.includes('still') || qLower.includes('again')) && 
      (qLower.includes('problem') || qLower.includes('issue') || qLower.includes('broken'))) {
    return `It sounds like this is an ongoing issue that hasn't been properly resolved yet. That's really frustrating, and I want to make sure we get it fixed right this time. Let me schedule you with one of our senior technicians who can do a comprehensive diagnostic to find the root cause, not just treat the symptoms. When would work for you?`;
  }

  // PRIORITY 3: Handle customer frustration and repetition complaints
  if (qLower.includes('repeating') || qLower.includes('same thing') || qLower.includes('over and over')) {
    return `I apologize for the confusion. Let me connect you directly with one of our specialists who can give you the specific information you need right away. Please hold for just a moment.`;
  }
  
  if (qLower.includes('not helping') || qLower.includes('frustrat') || qLower.includes('annoyed')) {
    return `I understand your frustration, and I want to make sure you get the help you need. Let me transfer you to one of our experienced technicians who can provide you with the exact answers you're looking for.`;
  }

  // NEW: PRIORITY 1.5: Add Human Engagement and Light Humor
  
  // Handle customer appreciation with warmth
  if (qLower.includes('thank you') && !qLower.includes('no')) {
    return `You're very welcome! I'm happy to help. What else can I do for you today?`;
  }
  
  // Professional humor for common HVAC situations
  if (qLower.includes('hot') && (qLower.includes('house') || qLower.includes('inside'))) {
    return `I bet it is! Nobody wants to be uncomfortable in their own home. Let's get your cooling system back on track. What's going on with your AC?`;
  }
  
  if (qLower.includes('cold') && (qLower.includes('house') || qLower.includes('inside'))) {
    return `Brrr! That's no fun, especially when you should be cozy at home. Let's figure out what's going on with your heating. What seems to be the issue?`;
  }
  
  // Engaging responses to common customer expressions
  if (qLower.includes('of course') || qLower.includes('figures') || qLower.includes('typical')) {
    return `I hear you! These things always seem to happen at the worst times, don't they? Let's get this sorted out for you. What's going on?`;
  }
  
  // Warm response to urgency
  if (qLower.includes('asap') || qLower.includes('urgent') || qLower.includes('emergency')) {
    return `I understand this is urgent - nobody wants to deal with that stress! Let me get you connected with our emergency team right away. What's the situation?`;
  }

  // PRIORITY 2: Handle pricing questions (was missing - major issue!)
  if (qLower.includes('price') || qLower.includes('cost') || qLower.includes('pricing') || 
      qLower.includes('how much') || qLower.includes('fee') || qLower.includes('charge')) {
    return `For pricing, our service call fee starts at $89, which includes a thorough diagnostic. If you decide to proceed with the repair, that fee goes toward the total cost. The final price depends on what needs to be done. Would you like me to schedule a technician to come out and give you an exact quote?`;
  }

  // PRIORITY 2.5: Handle SPECIFIC HVAC issues with targeted responses
  
  // Water leakage issues - CONCISE FIX
  if (qLower.includes('water') && (qLower.includes('leak') || qLower.includes('leaking') || qLower.includes('leakage'))) {
    if (qLower.includes('regular') || qLower.includes('often') || qLower.includes('always') || qLower.includes('again')) {
      return `Recurring water leaks need immediate attention. Usually a drain line or refrigerant issue. When can we come diagnose it?`;
    }
    return `Water leaks need quick attention. Could be drain line, frozen coil, or other issues. Want me to schedule a visit?`;
  }
  
  // Refrigerant leak issues
  if (qLower.includes('refrigerant') && (qLower.includes('leak') || qLower.includes('leaking') || qLower.includes('low'))) {
    return `Refrigerant leaks are emergency repairs. Our certified techs can locate and fix it safely. Should I get someone out today?`;
  }
  
  // Ice/freezing issues
  if (qLower.includes('ice') || qLower.includes('frozen') || qLower.includes('freezing')) {
    return `Ice on your system means something's wrong. Turn it off to let it thaw. When can we diagnose the cause?`;
  }
  
  // Strange noises
  if (qLower.includes('noise') || qLower.includes('sound') || qLower.includes('loud') || 
      qLower.includes('grinding') || qLower.includes('squealing') || qLower.includes('banging')) {
    return `Strange noises usually mean something needs attention before it gets worse. Want me to schedule a diagnostic?`;
  }
  
  // PRIORITY 3: Handle customer closures and polite declines
  if (qLower.includes('no') && (qLower.includes('thank you') || qLower.includes('thanks'))) {
    return `You're very welcome! Have a great day, and please don't hesitate to call us if you need anything in the future.`;
  }
  
  if (qLower.includes('not right now') || qLower.includes('not now') || qLower.includes('maybe later')) {
    return `No problem at all! I understand. Feel free to call us whenever you're ready, and we'll be happy to help. Have a wonderful day!`;
  }
  
  if ((qLower.includes('no') || qLower.includes('nope')) && 
      (qLower.includes('bye') || qLower.includes('goodbye') || qLower.includes('have a') || qLower.length < 10)) {
    return `Thank you for calling ${companyName}! Have a great day and feel free to call us anytime you need assistance.`;
  }
  
  // HVAC/Thermostat related responses
  if (qLower.includes('thermostat') || qLower.includes('temperature') || qLower.includes('heating') || qLower.includes('cooling')) {
    if (qLower.includes('blank') || qLower.includes('not working') || qLower.includes('broken')) {
      return `Oh, that's frustrating! A blank thermostat can definitely throw off your whole day. This could be a few different things - maybe a power issue, wiring problem, or the thermostat itself might need replacing. I'd love to have one of our HVAC experts take a look and get you back to being comfortable. What works best for your schedule?`;
    }
    if (qLower.includes('program') || qLower.includes('schedule')) {
      return `Ah, thermostat programming - it can be tricky! You're definitely not alone in that. Our technicians are great at getting these systems set up just right for your lifestyle. Would you like me to schedule someone to come out and get that sorted for you?`;
    }
    return `I can absolutely help with thermostat issues! Our HVAC specialists handle everything from simple fixes to complete replacements. What's your thermostat doing - or not doing - that's causing trouble?`;
  }
  
  // Filter maintenance questions
  if (qLower.includes('filter') || qLower.includes('air filter')) {
    if (qLower.includes('change') || qLower.includes('replace') || qLower.includes('how often')) {
      return `Great question! Most folks don't realize how important this is. Generally, you'll want to change your filter every 1-3 months, but it really depends on your specific system and how much it's running. If you have pets or allergies, you might need to swap it out more often. Our techs can definitely show you exactly what you need and help set up a schedule that makes sense for your home. Want me to get someone out there?`;
    }
    if (qLower.includes('dirty') || qLower.includes('clogged') || qLower.includes('clean')) {
      return `Oh yeah, a dirty filter can really mess with your system's efficiency - and your air quality too! If it looks gray or you can't see through it, it's definitely time for a fresh one. Our team can help you pick the right filter and show you the easiest way to stay on top of it. Should I schedule a visit?`;
    }
    return `Filter questions are always smart! Keeping up with filter maintenance is one of the best things you can do for your system. What specifically would you like to know about your air filter?`;
  }
  
  // AC/Air Conditioning related
  if (qLower.includes('ac ') || qLower.includes('air condition') || qLower.includes('cool') || qLower.includes('cold')) {
    if (qLower.includes('not working') || qLower.includes('broken') || qLower.includes('repair')) {
      return `AC problems can be really frustrating, especially when you need cooling the most. Our technicians can diagnose and fix most AC issues same-day. Are you getting any airflow at all, or is it completely not working?`;
    }
    if (qLower.includes('service') || qLower.includes('maintenance') || qLower.includes('clean') || qLower.includes('tune')) {
      return `Regular AC maintenance is so important for keeping your system running efficiently. We offer comprehensive AC service including cleaning, tune-ups, and preventive maintenance. Would you like to schedule a service visit?`;
    }
    return `I can help you with AC issues. Our HVAC team handles everything from basic maintenance to emergency repairs. What's going on with your air conditioning?`;
  }
  
  // Heating related
  if (qLower.includes('heat') || qLower.includes('furnace') || qLower.includes('warm')) {
    return `Heating issues can make your home really uncomfortable. Our heating specialists can help with furnace repairs, maintenance, and replacements. What type of heating problem are you experiencing?`;
  }
  
  // General service requests
  if (qLower.includes('service') || qLower.includes('appointment') || qLower.includes('schedule') || qLower.includes('visit')) {
    return `I'd be happy to help you schedule a service appointment. Our technicians are available for both routine maintenance and emergency repairs. What type of service do you need, and what's your preferred time?`;
  }
  
  // Emergency/urgent situations
  if (qLower.includes('emergency') || qLower.includes('urgent') || qLower.includes('asap') || qLower.includes('immediately')) {
    return `I understand this is urgent. We offer emergency service for situations like this. Let me get you connected with our emergency dispatch team right away so we can get someone out to help you.`;
  }
  
  // Pricing/cost related
  if (qLower.includes('cost') || qLower.includes('price') || qLower.includes('how much') || qLower.includes('estimate')) {
    return `I understand you'd like to know about pricing. Our costs vary depending on the specific service needed. I can have one of our technicians provide you with a free estimate. Would you like to schedule an assessment?`;
  }
  
  // General confusion or unclear speech
  if (qLower.includes('i have a') || qLower.includes('there is a') || qLower.includes('something') || qLower.includes('issue') || qLower.includes('problem')) {
    return `I want to make sure I understand your situation correctly. It sounds like you're experiencing some kind of issue. Could you tell me a bit more about what's happening so I can better assist you?`;
  }
  
  // If we can't understand or classify the request
  if (qLower.length < 10 || qLower.includes('let you know') || qLower.includes('blank')) {
    return `I want to make sure I understand what you need help with. Could you tell me a bit more about the issue you're experiencing? I'm here to help with any ${categories.join(', ')} needs you might have.`;
  }
  
  return null; // No intelligent response found
}

// SMART CONVERSATIONAL BRAIN - Advanced AI reasoning and context understanding
async function generateSmartConversationalResponse(company, question, conversationHistory, categories, companySpecialties, placeholders) {
  const qLower = question.toLowerCase().trim();
  const companyName = company?.companyName || 'our company';
  
  // Analyze conversation context and history
  const context = analyzeConversationContext(conversationHistory, question);
  console.log(`[Smart Brain] Context analysis:`, context);
  
  // SMART REASONING: Multi-layered understanding
  
  // 1. CONTINUATION DETECTION - Is this continuing a previous topic?
  if (context.isContinuation) {
    return handleConversationContinuation(context, question, company, placeholders);
  }
  
  // 2. TECHNICAL DIAGNOSIS - Smart problem assessment
  const technicalResponse = diagnoseHVACIssue(question, companySpecialties, companyName);
  if (technicalResponse) {
    return applyPlaceholders(technicalResponse, placeholders);
  }
  
  // 3. CONVERSATIONAL INTELLIGENCE - Natural dialogue management
  const conversationalResponse = handleNaturalConversation(question, conversationHistory, companyName);
  if (conversationalResponse) {
    return applyPlaceholders(conversationalResponse, placeholders);
  }
  
  // 4. CONTEXT-AWARE SCHEDULING - Smart appointment handling
  const schedulingResponse = handleIntelligentScheduling(question, context, companyName);
  if (schedulingResponse) {
    return applyPlaceholders(schedulingResponse, placeholders);
  }
  
  // 5. EMOTIONAL INTELLIGENCE - Read customer mood and respond appropriately
  const emotionalResponse = handleEmotionalIntelligence(question, conversationHistory, companyName);
  if (emotionalResponse) {
    return applyPlaceholders(emotionalResponse, placeholders);
  }
  
  return null; // Let other systems handle if smart brain can't process
}

// Analyze conversation context and flow
function analyzeConversationContext(conversationHistory, currentQuestion) {
  const context = {
    isContinuation: false,
    previousTopic: null,
    customerMood: 'neutral',
    conversationStage: 'initial',
    hasGivenInfo: false,
    isRepeating: false
  };
  
  if (!conversationHistory || conversationHistory.length === 0) {
    context.conversationStage = 'greeting';
    return context;
  }
  
  const lastCustomerMessage = conversationHistory
    .filter(msg => msg.role === 'customer')
    .slice(-1)[0];
    
  const lastAgentMessage = conversationHistory
    .filter(msg => msg.role === 'agent')
    .slice(-1)[0];
  
  // Detect continuation patterns
  const continuationPhrases = ['and', 'also', 'plus', 'additionally', 'furthermore', 'regular', 'often'];
  const currentLower = currentQuestion.toLowerCase();
  
  if (continuationPhrases.some(phrase => currentLower.startsWith(phrase))) {
    context.isContinuation = true;
    if (lastCustomerMessage) {
      context.previousTopic = extractTopicFromMessage(lastCustomerMessage.text);
    }
  }
  
  // Detect repetition
  if (lastCustomerMessage && similarity(currentQuestion, lastCustomerMessage.text) > 0.7) {
    context.isRepeating = true;
  }
  
  // Determine conversation stage
  if (conversationHistory.length <= 2) {
    context.conversationStage = 'initial';
  } else if (conversationHistory.length <= 6) {
    context.conversationStage = 'information_gathering';
  } else {
    context.conversationStage = 'resolution';
  }
  
  // Detect customer mood
  if (currentLower.includes('frustrat') || currentLower.includes('angry') || currentLower.includes('terrible')) {
    context.customerMood = 'frustrated';
  } else if (currentLower.includes('thanks') || currentLower.includes('great') || currentLower.includes('perfect')) {
    context.customerMood = 'satisfied';
  } else if (currentLower.includes('urgent') || currentLower.includes('emergency') || currentLower.includes('asap')) {
    context.customerMood = 'urgent';
  }
  
  return context;
}

// Handle conversation continuation intelligently - CONCISE VERSION
function handleConversationContinuation(context, question, company, placeholders) {
  const qLower = question.toLowerCase();
  
  if (context.previousTopic) {
    // Continue the previous topic with brief, actionable responses
    if (context.previousTopic.includes('leak') && qLower.includes('regular')) {
      return `Regular leaks need professional attention. Could be a drain line or refrigerant issue. Want me to schedule a diagnostic visit?`;
    }
    
    if (context.previousTopic.includes('noise') && (qLower.includes('loud') || qLower.includes('getting worse'))) {
      return `Getting worse means we should check it soon before it becomes a bigger problem. When works for you?`;
    }
    
    if (context.previousTopic.includes('temperature') && (qLower.includes('not') || qLower.includes('still'))) {
      return `Still having temperature issues? Could be refrigerant, filter, or airflow. Should I schedule a diagnostic visit?`;
    }
  }
  
  // Generic continuation response
  return `Tell me more about what's happening so I can make sure we address everything.`;
}

// Smart HVAC technical diagnosis
function diagnoseHVACIssue(question, companySpecialties, companyName) {
  const qLower = question.toLowerCase();
  const words = qLower.split(' ');
  
  // Advanced multi-symptom analysis
  const symptoms = {
    cooling: words.some(w => ['cool', 'cold', 'cooling', 'ac', 'air'].includes(w)),
    heating: words.some(w => ['heat', 'heating', 'warm', 'hot', 'furnace'].includes(w)),
    water: words.some(w => ['water', 'leak', 'drip', 'wet', 'moisture'].includes(w)),
    noise: words.some(w => ['noise', 'sound', 'loud', 'quiet', 'silent', 'grinding', 'squealing'].includes(w)),
    electrical: words.some(w => ['power', 'electric', 'breaker', 'fuse', 'voltage', 'wiring'].includes(w)),
    airflow: words.some(w => ['air', 'flow', 'blowing', 'circulation', 'vent', 'duct'].includes(w)),
    frequency: words.some(w => ['regular', 'often', 'always', 'sometimes', 'intermittent', 'constant'].includes(w))
  };
  
  // Smart diagnosis based on symptom combinations - CONCISE RESPONSES
  if (symptoms.water && symptoms.frequency) {
    return `Regular water leaks usually mean drainage or refrigerant issues. Should I schedule a diagnostic visit?`;
  }
  
  if (symptoms.noise && symptoms.frequency) {
    return `Recurring noises mean something's wearing out. Better to catch it early. When can we take a look?`;
  }
  
  if (symptoms.cooling && (qLower.includes('not') || qLower.includes('poor') || qLower.includes('weak'))) {
    return `Poor cooling could be refrigerant, filter, or airflow issues. Want me to schedule a diagnostic?`;
  }
  
  if (symptoms.heating && (qLower.includes('not') || qLower.includes('cold') || qLower.includes('barely'))) {
    return `Heating issues can range from simple to complex, but most are fixable. When can we get someone out?`;
  }
  
  return null; // No specific technical diagnosis
}

// Handle natural conversation patterns
function handleNaturalConversation(question, conversationHistory, companyName) {
  const qLower = question.toLowerCase().trim();
  
  // Short responses that need clarification
  if (qLower.length < 15 && !qLower.includes('yes') && !qLower.includes('no')) {
    return `I want to make sure I understand what you need help with. Could you tell me a bit more about what's going on with your system?`;
  }
  
  // Yes/No responses
  if (qLower === 'yes' || qLower === 'yeah' || qLower === 'yep') {
    return `Perfect! Let me get that set up for you. What day and time would work best for your schedule?`;
  }
  
  if (qLower === 'no' || qLower === 'nope' || qLower === 'not right now') {
    return `No problem at all! I understand. Feel free to call us back whenever you're ready, and we'll be happy to help. Is there anything else I can answer for you today?`;
  }
  
  // Acknowledgment responses
  if (qLower.includes('okay') || qLower.includes('alright') || qLower.includes('i see')) {
    return `Great! Is there anything specific you'd like me to help you with regarding your HVAC system?`;
  }
  
  // Information requests
  if (qLower.includes('tell me') || qLower.includes('explain') || qLower.includes('how does')) {
    return `I'd be happy to explain that for you. What specifically would you like to know more about?`;
  }
  
  return null;
}

// Smart scheduling with context awareness
function handleIntelligentScheduling(question, context, companyName) {
  const qLower = question.toLowerCase();
  
  if (context.customerMood === 'urgent' && (qLower.includes('today') || qLower.includes('now') || qLower.includes('asap'))) {
    return `I understand this is urgent for you. Let me check our emergency service availability. We prioritize urgent calls and can often get someone out the same day. What's your address, and I'll see what we can do to get you help quickly?`;
  }
  
  if (qLower.includes('schedule') || qLower.includes('appointment') || qLower.includes('when')) {
    if (context.conversationStage === 'resolution') {
      return `Absolutely! Based on what we've discussed, I think scheduling a technician visit is the best next step. Our technicians are typically available Monday through Friday between 8am and 5pm, and we also have Saturday availability. What works better for your schedule - a weekday or weekend appointment?`;
    } else {
      return `I'd be happy to help you schedule an appointment. Before I do that, could you tell me a bit more about what's going on so I can make sure we send the right technician with the right parts?`;
    }
  }
  
  return null;
}

// Emotional intelligence and mood-appropriate responses
function handleEmotionalIntelligence(question, conversationHistory, companyName) {
  const qLower = question.toLowerCase();
  
  // Detect frustration and respond with empathy
  if (qLower.includes('third time') || qLower.includes('keep happening') || qLower.includes('same problem')) {
    return `I can absolutely understand why you'd be frustrated - dealing with the same problem repeatedly is really annoying, especially when it's something that should have been fixed properly the first time. Let's make sure we get this resolved once and for all. I'm going to make a note that this is a recurring issue so our technician comes prepared to do a thorough diagnostic and find the root cause, not just treat the symptoms. When would be a good time for us to come out and get this properly fixed?`;
  }
  
  // Detect appreciation and respond warmly
  if (qLower.includes('thank you') || qLower.includes('appreciate') || qLower.includes('helpful')) {
    return `You're very welcome! I'm really glad I could help. That's exactly why we're here - to make sure you're comfortable and your system is working properly. Is there anything else I can help you with today?`;
  }
  
  // Detect uncertainty and provide reassurance
  if (qLower.includes('not sure') || qLower.includes('don\'t know') || qLower.includes('maybe')) {
    return `That's completely understandable - HVAC systems can be pretty complex, and it's not always obvious what's wrong. The good news is you don't need to figure it out yourself - that's what our trained technicians are for! They can do a thorough diagnostic and explain exactly what's happening and what needs to be done. No pressure at all - would you like me to schedule someone to take a look?`;
  }
  
  return null;
}

// Extract topic from previous message for continuation
function extractTopicFromMessage(text) {
  const keywords = {
    'leak': ['leak', 'leaking', 'water', 'drip'],
    'noise': ['noise', 'sound', 'loud', 'grinding', 'squealing'],
    'temperature': ['hot', 'cold', 'temp', 'heat', 'cool'],
    'power': ['power', 'electric', 'breaker', 'won\'t turn on'],
    'airflow': ['air', 'blow', 'circulation', 'vent']
  };
  
  const textLower = text.toLowerCase();
  
  for (const [topic, words] of Object.entries(keywords)) {
    if (words.some(word => textLower.includes(word))) {
      return topic;
    }
  }
  
  return 'general';
}

// Simple string similarity function
function similarity(str1, str2) {
  const a = str1.toLowerCase();
  const b = str2.toLowerCase();
  
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  
  const pairs1 = [];
  const pairs2 = [];
  
  for (let i = 0; i < a.length - 1; i++) {
    pairs1.push(a.substring(i, i + 2));
  }
  
  for (let i = 0; i < b.length - 1; i++) {
    pairs2.push(b.substring(i, i + 2));
  }
  
  const intersection = pairs1.filter(x => pairs2.includes(x)).length;
  const union = pairs1.length + pairs2.length - intersection;
  
  return intersection / union;
}

// Agent Service - AI Response Generation
//  GLOBAL MULTI-TENANT PLATFORM  
// Serves ALL companies dynamically - no hardcoded company logic
const { GoogleAuth } = require('google-auth-library');

module.exports = {
  answerQuestion,
  FALLBACK_MODEL,
  loadCompanyQAs,
  findCachedAnswer
};

// Enhanced Q&A reference system - use as cheat sheet for concise answers
function extractQuickAnswerFromQA(entries, userQuestion, fuzzyThreshold = 0.3) {
  if (!entries || !Array.isArray(entries) || !userQuestion) return null;
  
  const qNorm = userQuestion.trim().toLowerCase();
  const userWords = qNorm.split(/\s+/).filter(w => w.length > 2);
  
  console.log(`🔍 [QUICK Q&A] Looking for concise answer to: "${userQuestion}"`);

  for (const entry of entries) {
    const questionVariants = [
      (entry.question || '').trim().toLowerCase(),
      ...(Array.isArray(entry.keywords)
        ? entry.keywords.map(k => k.trim().toLowerCase())
        : [])
    ].filter(q => q);
    
    for (const variant of questionVariants) {
      // Check for topic match
      const variantWords = variant.split(/\s+/).filter(w => w.length > 2);
      const matchingWords = userWords.filter(userWord => 
        variantWords.some(variantWord => {
          if (userWord === variantWord) return true;
          
          // Handle word variations
          const userRoot = userWord.replace(/(ing|age|ed|er|ly)$/i, '');
          const variantRoot = variantWord.replace(/(ing|age|ed|er|ly)$/i, '');
          if (userRoot.length > 3 && variantRoot.length > 3 && userRoot === variantRoot) return true;
          
          // Substring matching for longer words
          if (userWord.length > 4 && variantWord.length > 4) {
            if (userWord.includes(variantWord) || variantWord.includes(userWord)) return true;
          }
          
          return false;
        })
      );
      
      // If we have topic overlap, extract concise answer
      if (matchingWords.length > 0) {
        const fullAnswer = entry.answer || '';
        const conciseAnswer = extractConciseAnswer(fullAnswer);
        
        if (conciseAnswer) {
          console.log(`✅ [QUICK Q&A] Found concise answer for: "${entry.question}"`);
          return conciseAnswer;
        }
      }
    }
  }

  return null;
}

// Extract the most important information from a long answer - ULTRA-CONCISE VERSION
function extractConciseAnswer(fullAnswer) {
  if (!fullAnswer || fullAnswer.length < 20) return fullAnswer;
  
  // Remove common filler phrases first
  let cleanAnswer = fullAnswer
    .replace(/Well,?\s*/gi, '')
    .replace(/So,?\s*/gi, '')
    .replace(/Actually,?\s*/gi, '')
    .replace(/Basically,?\s*/gi, '')
    .replace(/You know,?\s*/gi, '')
    .replace(/I mean,?\s*/gi, '')
    .replace(/Let me tell you,?\s*/gi, '')
    .replace(/The thing is,?\s*/gi, '')
    .trim();
  
  // Split into sentences
  const sentences = cleanAnswer.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 5);
  
  if (sentences.length === 0) return fullAnswer;
  if (sentences.length === 1) {
    // Even single sentences can be shortened
    return shortenSentence(sentences[0]);
  }
  
  // Priority keywords for most actionable/informative sentences
  const highPriorityKeywords = [
    'yes', 'no', 'call', 'schedule', 'visit', 'today', 'available', '$', 'cost', 'price',
    'we do', 'we don\'t', 'we can', 'we can\'t', 'emergency', '24/7', 'same day'
  ];
  
  const mediumPriorityKeywords = [
    'technician', 'service', 'repair', 'fix', 'help', 'our', 'we', 'appointment'
  ];
  
  // Score sentences by priority
  const scoredSentences = sentences.map(sentence => {
    const lowerSentence = sentence.toLowerCase();
    let score = 0;
    
    // High priority keywords get double points
    highPriorityKeywords.forEach(keyword => {
      if (lowerSentence.includes(keyword)) score += 2;
    });
    
    // Medium priority keywords get single points
    mediumPriorityKeywords.forEach(keyword => {
      if (lowerSentence.includes(keyword)) score += 1;
    });
    
    // Shorter sentences get bonus points (encourage brevity)
    if (sentence.length < 50) score += 1;
    if (sentence.length < 30) score += 1;
    
    return { sentence, score, length: sentence.length };
  });
  
  // Sort by score (descending) then by length (ascending)
  scoredSentences.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.length - b.length;
  });
  
  // Return the highest scoring, shortest sentence
  const bestSentence = scoredSentences[0].sentence;
  return shortenSentence(bestSentence) + '.';
}

// Shorten individual sentences by removing unnecessary words
function shortenSentence(sentence) {
  if (!sentence || sentence.length < 20) return sentence;
  
  return sentence
    // Remove unnecessary articles and adjectives
    .replace(/\b(the|a|an)\s+/gi, '')
    .replace(/\b(very|really|quite|pretty|extremely|absolutely)\s+/gi, '')
    .replace(/\b(definitely|certainly|obviously|clearly)\s+/gi, '')
    
    // Simplify common phrases
    .replace(/would you like me to/gi, 'should I')
    .replace(/I would be happy to/gi, 'I can')
    .replace(/we would be glad to/gi, 'we can')
    .replace(/feel free to/gi, '')
    .replace(/please don\'t hesitate to/gi, '')
    .replace(/if you have any questions/gi, '')
    
    // Remove redundant conjunctions
    .replace(/\s+and\s+/gi, ', ')
    .replace(/,\s*,/g, ',')
    
    // Clean up spacing
    .replace(/\s+/g, ' ')
    .trim();
}

// Generate short, conversational responses using Q&A as reference - ULTRA-CONCISE VERSION
function generateShortConversationalResponse(question, qnaAnswer, companyName) {
  const qLower = question.toLowerCase();
  
  // Get the most concise answer first
  const conciseAnswer = extractConciseAnswer(qnaAnswer);
  
  // For pricing questions, ultra-direct approach
  if (qLower.includes('cost') || qLower.includes('price') || qLower.includes('how much')) {
    const priceMatch = qnaAnswer.match(/\$\d+/);
    if (priceMatch) {
      return `${priceMatch[0]} service call. Want a quote?`;
    }
    return `Depends on the repair. Schedule a quote?`;
  }
  
  // For yes/no service questions, one-word + action
  if (qLower.includes('do you') || qLower.includes('can you')) {
    if (qnaAnswer.toLowerCase().includes('yes') || qnaAnswer.toLowerCase().includes('we do')) {
      return `Yes. Schedule a visit?`;
    }
    if (qnaAnswer.toLowerCase().includes('no') || qnaAnswer.toLowerCase().includes('don\'t')) {
      return `No, but I can connect you with someone who can help.`;
    }
  }
  
  // For hours/availability, extract just the essentials
  if (qLower.includes('hour') || qLower.includes('open') || qLower.includes('when')) {
    const timeMatch = qnaAnswer.match(/\d{1,2}(:\d{2})?\s*(am|pm|AM|PM)/g);
    if (timeMatch && timeMatch.length >= 2) {
      return `${timeMatch[0]}-${timeMatch[timeMatch.length - 1]}, weekdays.`;
    }
    if (qnaAnswer.toLowerCase().includes('monday') && qnaAnswer.toLowerCase().includes('friday')) {
      return `Monday-Friday business hours.`;
    }
  }
  
  // For emergency questions, immediate response
  if (qLower.includes('emergency') || qLower.includes('urgent') || qLower.includes('24')) {
    if (qnaAnswer.toLowerCase().includes('24') || qnaAnswer.toLowerCase().includes('emergency')) {
      return `Yes, 24/7 emergency service. Need someone today?`;
    }
  }
  
  // For warranty/guarantee questions
  if (qLower.includes('warrant') || qLower.includes('guarant')) {
    if (qnaAnswer.toLowerCase().includes('year') || qnaAnswer.toLowerCase().includes('month')) {
      const warrantyMatch = qnaAnswer.match(/\d+\s*(year|month)/i);
      if (warrantyMatch) {
        return `${warrantyMatch[0]} warranty included.`;
      }
    }
    return `Yes, all work is guaranteed.`;
  }
  
  // For appointment/scheduling questions
  if (qLower.includes('appointment') || qLower.includes('schedule') || qLower.includes('available')) {
    return `Available today. When works for you?`;
  }
  
  // Extract the shortest meaningful phrase from the answer
  if (conciseAnswer) {
    // If the concise answer is still long, make it even shorter
    if (conciseAnswer.length > 50) {
      // Look for the core information
      const sentences = conciseAnswer.split(/[.!?]/).map(s => s.trim()).filter(s => s.length > 5);
      if (sentences.length > 0) {
        // Find the shortest sentence with key information
        const keyWords = ['yes', 'no', 'call', 'schedule', 'service', 'repair', 'available', '$'];
        const keyScore = (sentence) => keyWords.filter(word => sentence.toLowerCase().includes(word)).length;
        
        const bestSentence = sentences.reduce((best, current) => {
          const currentScore = keyScore(current);
          const bestScore = keyScore(best);
          
          if (currentScore > bestScore) return current;
          if (currentScore === bestScore && current.length < best.length) return current;
          return best;
        });
        
        return bestSentence + '.';
      }
    }
    return conciseAnswer;
  }
  
  // Fallback: extract first meaningful phrase
  const firstSentence = qnaAnswer.split(/[.!?]/)[0].trim();
  return firstSentence.length > 5 ? firstSentence + '.' : qnaAnswer;
}

// Check specific scenario protocols - handles company-specific response protocols
function checkSpecificProtocols(protocols, question, conversationHistory, placeholders) {
  if (!protocols || typeof protocols !== 'object') return null;
  
  const qLower = question.toLowerCase().trim();
  console.log(`[Protocols] Checking protocols for: "${question.substring(0, 50)}..."`);
  
  // System delay protocol - when system is slow or unresponsive
  if (protocols.systemDelay && 
      (qLower.includes('slow') || qLower.includes('delay') || qLower.includes('taking long') || 
       qLower.includes('wait') || qLower.includes('loading'))) {
    console.log(`[Protocols] Using systemDelay protocol`);
    return applyPlaceholders(protocols.systemDelay, placeholders);
  }
  
  // Message taking protocol - when caller wants to leave a message
  if (protocols.messageTaking && 
      (qLower.includes('message') || qLower.includes('voicemail') || qLower.includes('call back') || 
       qLower.includes('leave a') || qLower.includes('tell them'))) {
    console.log(`[Protocols] Using messageTaking protocol`);
    return applyPlaceholders(protocols.messageTaking, placeholders);
  }
  
  // Caller reconnect protocol - when connection issues
  if (protocols.callerReconnect && 
      (qLower.includes('can you hear') || qLower.includes('connection') || qLower.includes('breaking up') || 
       qLower.includes('static') || qLower.includes('cutting out'))) {
    console.log(`[Protocols] Using callerReconnect protocol`);
    return applyPlaceholders(protocols.callerReconnect, placeholders);
  }
  
  // When in doubt protocol - for unclear or confusing situations
  if (protocols.whenInDoubt && 
      (qLower.includes('confused') || qLower.includes('not sure') || qLower.includes('unclear') || 
       qLower.includes('don\'t understand') || qLower.length < 10)) {
    console.log(`[Protocols] Using whenInDoubt protocol`);
    return applyPlaceholders(protocols.whenInDoubt, placeholders);
  }
  
  // Caller frustration protocol - when customer is frustrated
  if (protocols.callerFrustration && 
      (qLower.includes('frustrat') || qLower.includes('angry') || qLower.includes('upset') || 
       qLower.includes('annoyed') || qLower.includes('terrible') || qLower.includes('worst'))) {
    console.log(`[Protocols] Using callerFrustration protocol`);
    return applyPlaceholders(protocols.callerFrustration, placeholders);
  }
  
  // Telemarketer filter protocol - detecting sales calls
  if (protocols.telemarketerFilter && 
      (qLower.includes('offer') || qLower.includes('deal') || qLower.includes('promotion') || 
       qLower.includes('special') || qLower.includes('save money') || qLower.includes('limited time'))) {
    console.log(`[Protocols] Using telemarketerFilter protocol`);
    return applyPlaceholders(protocols.telemarketerFilter, placeholders);
  }
  
  // Booking confirmation protocol - confirming appointments
  if (protocols.bookingConfirmation && 
      (qLower.includes('confirm') || qLower.includes('appointment') || qLower.includes('scheduled') || 
       qLower.includes('booking') || qLower.includes('reschedule'))) {
    console.log(`[Protocols] Using bookingConfirmation protocol`);
    return applyPlaceholders(protocols.bookingConfirmation, placeholders);
  }
  
  // Text to pay protocol - payment related
  if (protocols.textToPay && 
      (qLower.includes('payment') || qLower.includes('pay') || qLower.includes('bill') || 
       qLower.includes('invoice') || qLower.includes('charge') || qLower.includes('cost'))) {
    console.log(`[Protocols] Using textToPay protocol`);
    return applyPlaceholders(protocols.textToPay, placeholders);
  }
  
  console.log(`[Protocols] No matching protocol found`);
  return null;
}

// Check for specific personality scenarios based on customer input and conversation context
async function checkPersonalityScenarios(companyId, question, conversationHistory) {
  const qLower = question.toLowerCase().trim();
  
  // Handle customer frustration and repetition complaints (PRIORITY 1)
  if (qLower.includes('repeating') || qLower.includes('same thing') || qLower.includes('over and over')) {
    const response = await getPersonalityResponse(companyId, 'frustratedCaller', 'empathetic');
    return {
      category: 'repetitionComplaint',
      text: response || `I apologize for the confusion. Let me connect you directly with one of our specialists who can give you the specific information you need right away.`
    };
  }
  
  if (qLower.includes('not helping') || qLower.includes('frustrat') || qLower.includes('annoyed')) {
    const response = await getPersonalityResponse(companyId, 'frustratedCaller', 'empathetic');
    return {
      category: 'customerFrustration', 
      text: response || `I understand your frustration, and I want to make sure you get the help you need. Let me transfer you to one of our experienced technicians.`
    };
  }
  
  // Handle appreciation
  if (qLower.includes('thank you') && !qLower.includes('no')) {
    const response = await getPersonalityResponse(companyId, 'complimentResponse', 'friendly');
    return {
      category: 'gratitude',
      text: response || `You're very welcome! I'm happy to help. What else can I do for you today?`
    };
  }
  
  // Handle urgent situations  
  if (qLower.includes('asap') || qLower.includes('urgent') || qLower.includes('emergency')) {
    const response = await getPersonalityResponse(companyId, 'empathyResponse', 'professional');
    return {
      category: 'urgency',
      text: response || `I understand this is urgent. Let me get you connected with our emergency team right away. What's the situation?`
    };
  }
  
  // Handle connection issues
  if (qLower.includes('can you hear') || qLower.includes('connection') || qLower.includes('breaking up')) {
    const response = await getPersonalityResponse(companyId, 'connectionTrouble', 'professional');
    return {
      category: 'connection',
      text: response || `It sounds like the line is breaking up. Can you still hear me clearly?`
    };
  }
  
  // Handle confusion/unclear requests
  if (qLower.includes('confused') || qLower.includes('not sure') || qLower.includes('unclear')) {
    const response = await getPersonalityResponse(companyId, 'cantUnderstand', 'helpful');
    return {
      category: 'confusion',
      text: response || `I want to make sure I understand what you need help with. Could you tell me a bit more about what's going on?`
    };
  }
  
  return null; // No specific scenario matched
}