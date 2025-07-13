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
              temperature: 0.5, // Reduced from 0.7 for faster, more consistent responses
              topK: 10, // Reduced from 20 for faster responses
              topP: 0.7, // Reduced from 0.8 for faster responses
              maxOutputTokens: 100, // Reduced from 150 for faster responses
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

  // STEP 4: Try fuzzy matching on Q&A entries
  const fuzzyThreshold = company?.aiSettings?.fuzzyMatchThreshold || 0.3;
  const cachedAnswer = findCachedAnswer(await KnowledgeEntry.find({ companyId }).exec(), question, fuzzyThreshold);
  if (cachedAnswer) {
    console.log(`[Agent] Found Q&A match via fuzzy matching for: ${question}`);
    return { text: applyPlaceholders(cachedAnswer, placeholders), escalate: false };
  }

  // STEP 5: Try company Q&A from agentSetup.categoryQAs
  const companyQAs = categoryQACache.get(companyId) || [];
  if (companyQAs.length > 0) {
    const companyQAAnswer = findCachedAnswer(companyQAs, question, fuzzyThreshold);
    if (companyQAAnswer) {
      console.log(`[Agent] Found match in company categoryQAs for: ${question}`);
      return { text: applyPlaceholders(companyQAAnswer, placeholders), escalate: false };
    }
  }

  // STEP 6: Try structured conversational script processing
  const scriptResponse = await processConversationalScriptEnhanced(company, question, conversationHistory, placeholders);
  if (scriptResponse) {
    console.log(`[Agent] Generated script-based response for: ${question}`);
    return { text: scriptResponse, escalate: false };
  }

  // STEP 7: Try to understand the context and provide intelligent responses
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
  fullPrompt += `\n- You are The Agent for ${company?.companyName} - be natural and conversational`;
  fullPrompt += `\n- Keep your ${personality} personality but don't be robotic`;
  fullPrompt += `\n- Don't repeat everything the caller says - acknowledge and move forward`;
  fullPrompt += `\n- Be concise but helpful - avoid overly long explanations unless asked`;
  fullPrompt += `\n- If they ask about something you can help with, focus on solutions`;
  fullPrompt += `\n- Ask ONE clarifying question if needed, but don't interrogate`;
  fullPrompt += `\n- If it's clear what they need, offer to help or schedule service`;
  
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
  
  fullPrompt += `\n\nRespond naturally to: ${promptQuestion} - Keep it conversational and move the call forward.`;

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

  // Check if the response seems to be a debug message
  if (aiResponse && aiResponse.includes('reading this from') && aiResponse.includes('LLM Message')) {
    console.log(`[LLM] DEBUG: Detected debug message from LLM, replacing with escalation message`);
    const personality = company?.aiSettings?.personality || 'friendly';
    const message = applyPlaceholders((customEscalationMessage || await getPersonalityResponse(companyId, 'transferToRep', personality)).trim(), placeholders);
    return { text: message, escalate: true };
  }

  // Logic to create a suggested knowledge entry
  if (aiResponse) {
    try {
      const newSuggestedEntry = new SuggestedKnowledgeEntry({
        question: question,
        suggestedAnswer: aiResponse,
        category: categories.length > 0 ? categories[0] : 'General', // Assign a category, perhaps the first one or 'General'
        status: 'pending',
        originalCallSid: originalCallSid // Store the CallSid for traceability
      });
      await newSuggestedEntry.save();
      console.log(`[SuggestedKB] Created new pending suggestion for question: "${question}"`);
    } catch (suggestErr) {
      console.error(`[SuggestedKB] Error saving suggested knowledge entry:`, suggestErr.message);
    }
  }

  return { text: applyPlaceholders(aiResponse, placeholders), escalate: false };
}

// Generate intelligent responses based on context and common patterns
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
  
  // PRIORITY 2: Handle customer frustration and repetition complaints FIRST
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

// NEW: Check personality response scenarios
async function checkPersonalityScenarios(companyId, qLower, conversationHistory) {
  try {
    // Check for unclear speech or understanding issues
    if (qLower.includes('what') && qLower.includes('say') || qLower.includes('repeat') || 
        qLower.includes('hear') || qLower.includes('understand') || qLower.length < 5) {
      const response = await getPersonalityResponse(companyId, 'cantUnderstand');
      if (response) return { category: 'cantUnderstand', text: response };
    }
    
    // Check for requests to speak clearly
    if (qLower.includes('speak up') || qLower.includes('louder') || qLower.includes('clear') || 
        qLower.includes('can\'t hear')) {
      const response = await getPersonalityResponse(companyId, 'speakClearly');
      if (response) return { category: 'speakClearly', text: response };
    }
    
    // Check for out-of-category requests
    if (qLower.includes('don\'t handle') || qLower.includes('not your') || qLower.includes('wrong') || 
        qLower.includes('different service')) {
      const response = await getPersonalityResponse(companyId, 'outOfCategory');
      if (response) return { category: 'outOfCategory', text: response };
    }
    
    // Check for calendar/booking hesitation
    if (qLower.includes('not sure') && (qLower.includes('book') || qLower.includes('schedule') || 
        qLower.includes('appointment')) || qLower.includes('maybe later') || qLower.includes('think about')) {
      const response = await getPersonalityResponse(companyId, 'calendarHesitation');
      if (response) return { category: 'calendarHesitation', text: response };
    }
    
    // Check for business closure/goodbye scenarios
    if (qLower.includes('thank you') && (qLower.includes('bye') || qLower.includes('goodbye') || 
        qLower.includes('have a') || qLower.includes('that\'s all'))) {
      const response = await getPersonalityResponse(companyId, 'businessClosed');
      if (response) return { category: 'businessClosed', text: response };
    }
    
    // Check for frustrated caller scenarios
    if (qLower.includes('frustrat') || qLower.includes('angry') || qLower.includes('upset') || 
        qLower.includes('terrible') || qLower.includes('horrible')) {
      const response = await getPersonalityResponse(companyId, 'frustratedCaller');
      if (response) return { category: 'frustratedCaller', text: response };
    }
    
    // Check for business hours inquiries
    if (qLower.includes('hours') || qLower.includes('open') || qLower.includes('close') || 
        qLower.includes('when do you')) {
      const response = await getPersonalityResponse(companyId, 'businessHours');
      if (response) return { category: 'businessHours', text: response };
    }
    
    // Check for connection trouble
    if (qLower.includes('breaking up') || qLower.includes('can\'t hear') || qLower.includes('static') || 
        qLower.includes('bad connection') || qLower.includes('cutting out')) {
      const response = await getPersonalityResponse(companyId, 'connectionTrouble');
      if (response) return { category: 'connectionTrouble', text: response };
    }
    
    // Check for agent not understood scenarios
    if (qLower.includes('what did you say') || qLower.includes('didn\'t catch') || 
        qLower.includes('say again') || qLower.includes('repeat that')) {
      const response = await getPersonalityResponse(companyId, 'agentNotUnderstood');
      if (response) return { category: 'agentNotUnderstood', text: response };
    }
    
    // NEW: Professional Humor & Engagement Detection
    
    // Detect customer jokes, playfulness, or humor
    if (qLower.includes('just kidding') || qLower.includes('joking') || qLower.includes('haha') || 
        qLower.includes('lol') || qLower.includes('funny') || qLower.includes('joke') ||
        (qLower.includes('you') && (qLower.includes('smart') || qLower.includes('good'))) ||
        qLower.includes('clever')) {
      const response = await getPersonalityResponse(companyId, 'customerJoke');
      if (response) return { category: 'customerJoke', text: response };
    }
    
    // Detect weather or casual small talk
    if (qLower.includes('weather') || qLower.includes('hot') || qLower.includes('cold') || 
        qLower.includes('raining') || qLower.includes('sunny') || qLower.includes('snow') ||
        qLower.includes('nice day') || qLower.includes('beautiful day') || qLower.includes('crazy weather')) {
      const response = await getPersonalityResponse(companyId, 'weatherSmallTalk');
      if (response) return { category: 'weatherSmallTalk', text: response };
    }
    
    // Detect compliments to the agent/company
    if ((qLower.includes('you') || qLower.includes('service')) && 
        (qLower.includes('great') || qLower.includes('excellent') || qLower.includes('amazing') || 
         qLower.includes('awesome') || qLower.includes('wonderful') || qLower.includes('fantastic') ||
         qLower.includes('helpful') || qLower.includes('good job'))) {
      const response = await getPersonalityResponse(companyId, 'complimentResponse');
      if (response) return { category: 'complimentResponse', text: response };
    }
    
    // Detect casual, friendly greetings that deserve warm responses
    if ((qLower.includes('hey') || qLower.includes('hi there') || qLower.includes('what\'s up') || 
         qLower.includes('howdy') || qLower.includes('good morning') || qLower.includes('good afternoon')) &&
         qLower.length < 20) // Keep it short and casual
    {
      const response = await getPersonalityResponse(companyId, 'casualGreeting');
      if (response) return { category: 'casualGreeting', text: response };
    }
    
    // Detect situations that call for empathy (customer expressing inconvenience/problems)
    if (qLower.includes('broken') && (qLower.includes('again') || qLower.includes('always')) ||
        qLower.includes('third time') || qLower.includes('keep') && qLower.includes('happening') ||
        qLower.includes('so frustrating') || qLower.includes('this is ridiculous') ||
        qLower.includes('can\'t believe') || qLower.includes('nightmare')) {
      const response = await getPersonalityResponse(companyId, 'empathyResponse');
      if (response) return { category: 'empathyResponse', text: response };
    }
    
  } catch (error) {
    console.error('[Personality Response] Error checking scenarios:', error);
  }
  
  return null; // No personality response match
}

// Parse and structure the main conversational script
function parseMainScript(mainScript) {
    if (!mainScript || mainScript.trim() === '') return null;
    
    const script = {
        greeting: null,
        serviceBooking: [],
        transferHandling: [],
        informationResponses: {},
        escalationTriggers: [],
        closing: null,
        sections: {} // NEW: Store all structured sections
    };
    
    const lines = mainScript.split('\n').filter(line => line.trim() !== '');
    let currentSection = null;
    let currentSectionContent = [];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();
        
        // Detect section headers (more comprehensive detection)
        const sectionMatch = trimmedLine.match(/^([^:]+):\s*$/);
        if (sectionMatch || 
            trimmedLine.toLowerCase().includes('greeting') || 
            trimmedLine.toLowerCase().includes('identification') ||
            trimmedLine.toLowerCase().includes('booking') || 
            trimmedLine.toLowerCase().includes('appointment') ||
            trimmedLine.toLowerCase().includes('schedule') ||
            trimmedLine.toLowerCase().includes('transfer') || 
            trimmedLine.toLowerCase().includes('technician') ||
            trimmedLine.toLowerCase().includes('speak') ||
            trimmedLine.toLowerCase().includes('closing') || 
            trimmedLine.toLowerCase().includes('end call') ||
            trimmedLine.toLowerCase().includes('information') ||
            trimmedLine.toLowerCase().includes('responses') ||
            trimmedLine.toLowerCase().includes('questions')) {
            
            // Save previous section
            if (currentSection && currentSectionContent.length > 0) {
                script.sections[currentSection] = currentSectionContent.join('\n');
            }
            
            // Start new section
            if (sectionMatch) {
                currentSection = sectionMatch[1].toLowerCase().trim();
            } else {
                if (trimmedLine.toLowerCase().includes('greeting') || 
                    trimmedLine.toLowerCase().includes('identification')) {
                    currentSection = 'greeting';
                } else if (trimmedLine.toLowerCase().includes('booking') || 
                           trimmedLine.toLowerCase().includes('appointment') ||
                           trimmedLine.toLowerCase().includes('schedule')) {
                    currentSection = 'service_booking';
                } else if (trimmedLine.toLowerCase().includes('transfer') || 
                           trimmedLine.toLowerCase().includes('technician') ||
                           trimmedLine.toLowerCase().includes('speak')) {
                    currentSection = 'transfer_handling';
                } else if (trimmedLine.toLowerCase().includes('closing') || 
                           trimmedLine.toLowerCase().includes('end call')) {
                    currentSection = 'closing';
                } else if (trimmedLine.toLowerCase().includes('information') ||
                           trimmedLine.toLowerCase().includes('responses') ||
                           trimmedLine.toLowerCase().includes('questions')) {
                    currentSection = 'information_responses';
                }
            }
            currentSectionContent = [];
            continue;
        }
        
        // Add content to current section
        if (currentSection) {
            currentSectionContent.push(trimmedLine);
        }
        
        // Legacy parsing for backwards compatibility
        if (currentSection === 'greeting' && trimmedLine.toLowerCase().includes('agent:')) {
            script.greeting = trimmedLine.replace(/agent:\s*/i, '');
        }
        
        if (currentSection === 'service_booking' && trimmedLine.toLowerCase().includes('agent:')) {
            script.serviceBooking.push(trimmedLine.replace(/agent:\s*/i, ''));
        }
        
        if (currentSection === 'transfer_handling' && trimmedLine.toLowerCase().includes('agent:')) {
            script.transferHandling.push(trimmedLine.replace(/agent:\s*/i, ''));
        }
        
        if (currentSection === 'closing' && trimmedLine.toLowerCase().includes('agent:')) {
            script.closing = trimmedLine.replace(/agent:\s*/i, '');
        }
        
        // Enhanced Q&A parsing
        if (trimmedLine.includes('?') && !trimmedLine.toLowerCase().includes('agent:')) {
            // Look for answer in next lines
            let answerLines = [];
            for (let j = i + 1; j < lines.length && j < i + 5; j++) {
                const nextLine = lines[j].trim();
                if (nextLine && !nextLine.includes('?') && !nextLine.toLowerCase().includes('agent:')) {
                    answerLines.push(nextLine);
                } else {
                    break;
                }
            }
            if (answerLines.length > 0) {
                const questionKey = trimmedLine.toLowerCase().replace(/[^\w\s]/g, '').trim();
                script.informationResponses[questionKey] = answerLines.join(' ');
            }
        }
    }
    
    // Save final section
    if (currentSection && currentSectionContent.length > 0) {
        script.sections[currentSection] = currentSectionContent.join('\n');
    }
    
    console.log(`[Script Parser] Parsed sections:`, Object.keys(script.sections));
    console.log(`[Script Parser] Found ${Object.keys(script.informationResponses).length} Q&A pairs`);
    
    return script;
}

// Basic conversational script handler
async function processConversationalScript(company, question, conversationHistory, placeholders) {
    const agentSetup = company?.agentSetup || {};
    const personality = company?.aiSettings?.personality || 'friendly';
    const companySpecialties = agentSetup.companySpecialties || '';
    
    // Simple text-based response generation without complex script parsing
    if (!question || question.trim() === '') {
        return handleGreeting(company, question, personality, placeholders);
    }
    
    // Very basic intent detection
    const lowerQuestion = question.toLowerCase();
    
    // Check for scheduling/booking intents
    if (lowerQuestion.includes('schedule') || lowerQuestion.includes('appoint') || 
        lowerQuestion.includes('book') || lowerQuestion.includes('set up') ||
        lowerQuestion.includes('come out') || lowerQuestion.includes('come to') ||
        lowerQuestion.includes('visit') || lowerQuestion.includes('available')) {
        return `I'd be happy to schedule a service appointment for you. What day and time would work best for you? Our technicians are usually available Monday through Friday between 8am and 5pm.`;
    }
    
    // Check for pricing/quote intents
    if (lowerQuestion.includes('cost') || lowerQuestion.includes('price') || 
        lowerQuestion.includes('quote') || lowerQuestion.includes('estimate') ||
        lowerQuestion.includes('how much') || lowerQuestion.includes('fee')) {
        return `The cost will depend on the specific service needed. For ${companySpecialties}, our service call fee starts at $89, and we can provide a more accurate quote once our technician assesses your system. Would you like to schedule a service call?`;
    }
    
    // Check for service/repair intents
    if (lowerQuestion.includes('repair') || lowerQuestion.includes('fix') || 
        lowerQuestion.includes('broken') || lowerQuestion.includes('not working') ||
        lowerQuestion.includes('service') || lowerQuestion.includes('maintain') ||
        lowerQuestion.includes('problem') || lowerQuestion.includes('issue')) {
        return `I understand you're having an issue with your system. To best help you, could you tell me a bit more about what's happening? This will help us make sure we send a technician with the right expertise and parts.`;
    }
    
    // For name or contact collection
    if (lowerQuestion.includes('name is') || lowerQuestion.includes('this is') || 
        lowerQuestion.includes('speaking') || lowerQuestion.includes('number is') ||
        lowerQuestion.includes('call me') || lowerQuestion.includes('reach me')) {
        return `Thank you for sharing that information. I've got your details. Now, how can we help you today with your ${companySpecialties.split(',')[0].trim()} needs?`;
    }
    
    // Default response for unclassified intents
    return `I understand you're inquiring about our ${companySpecialties.split(',')[0].trim()} services. Could you provide a bit more detail about what specific help you're looking for today?`;
}

// Enhanced conversational script handler that uses parsed script
async function processConversationalScriptEnhanced(company, question, conversationHistory, placeholders) {
    const agentSetup = company?.agentSetup || {};
    const mainScript = agentSetup.mainAgentScript || '';
    const protocols = agentSetup.protocols || {};
    const parsedScript = parseMainScript(mainScript);
    const personality = company?.aiSettings?.personality || 'friendly';
    
    console.log(`[Enhanced Script] Available protocols:`, Object.keys(protocols));
    
    // PRIORITY 1: Check for specific scenario protocols FIRST
    const protocolResponse = checkSpecificProtocols(protocols, question, conversationHistory, placeholders);
    if (protocolResponse) {
        console.log(`[Enhanced Script] Using specific protocol response`);
        return protocolResponse;
    }
    
    if (!parsedScript) {
        // Fall back to original conversational script processing
        return await processConversationalScript(company, question, conversationHistory, placeholders);
    }
    
    // Simple intent analysis based on question content
    function analyzeCallIntent(question, history) {
        question = question.toLowerCase();
        if (question.includes('repair') || question.includes('fix') || question.includes('broken') || 
            question.includes('not working') || question.includes('isn\'t working') || 
            question.includes('stopped working') || question.includes('blank')) {
            return 'repair';
        } else if (question.includes('maintenance') || question.includes('tune') || question.includes('check') || 
                   question.includes('service')) {
            return 'maintenance';
        } else if (question.includes('install') || question.includes('new system') || question.includes('replace')) {
            return 'installation';
        } else if (question.includes('quote') || question.includes('cost') || question.includes('price') || 
                   question.includes('how much')) {
            return 'pricing';
        } else {
            return 'general';
        }
    }
    
    // Determine which stage of the call we're in based on conversation history
    function determineCallStage(history) {
        if (!history || history.length <= 1) {
            return 'greeting';
        } else if (history.length <= 2) {
            return 'initial_question';
        } else if (history.length <= 4) {
            return 'information_gathering';
        } else {
            return 'scheduling';
        }
    }
    
    // Analyze call intent and stage
    const callIntent = analyzeCallIntent(question, conversationHistory);
    const callStage = determineCallStage(conversationHistory);
    
    console.log(`[EnhancedScript] Call Intent: ${callIntent}, Stage: ${callStage}, Has Parsed Script: true`);
    
    // Use parsed script content when available
    switch (callStage) {
        case 'greeting':
            if (parsedScript.greeting) {
                return applyPlaceholders(parsedScript.greeting, placeholders);
            }
            return handleGreeting(company, question, personality, placeholders);
        
        case 'intent_detection':
            if (callIntent === 'booking' && parsedScript.serviceBooking.length > 0) {
                return applyPlaceholders(parsedScript.serviceBooking[0], placeholders);
            }
            if (callIntent === 'transfer' && parsedScript.transferHandling.length > 0) {
                return applyPlaceholders(parsedScript.transferHandling[0], placeholders);
            }
            return handleIntentDetection(company, question, callIntent, personality, placeholders);
        
        case 'closing':
            if (parsedScript.closing) {
                return applyPlaceholders(parsedScript.closing, placeholders);
            }
            return handleClosing(company, question, personality, placeholders);
        
        default:
            // Check for information responses in parsed script
            const lowerQuestion = question.toLowerCase();
            for (const [scriptQuestion, scriptAnswer] of Object.entries(parsedScript.informationResponses)) {
                if (lowerQuestion.includes(scriptQuestion.toLowerCase().replace(/\?/g, '').trim())) {
                    return applyPlaceholders(scriptAnswer, placeholders);
                }
            }
            
            // Fall back to original processing
            return await processConversationalScript(company, question, conversationHistory, placeholders);
    }
}

// NEW: Check specific scenario protocols
function checkSpecificProtocols(protocols, question, conversationHistory, placeholders) {
    const qLower = question.toLowerCase();
    
    // System delay/reboot scenarios
    if ((qLower.includes('wait') || qLower.includes('hold') || qLower.includes('delay') || 
         qLower.includes('slow') || qLower.includes('loading')) && protocols.systemDelay) {
        console.log(`[Protocol] Using systemDelay protocol`);
        return applyPlaceholders(protocols.systemDelay, placeholders);
    }
    
    // Caller frustration / "Are you a robot?" 
    if ((qLower.includes('robot') || qLower.includes('real person') || qLower.includes('human') || 
         qLower.includes('frustrat') || qLower.includes('annoying') || qLower.includes('repeat')) && 
         protocols.callerFrustration) {
        console.log(`[Protocol] Using callerFrustration protocol`);
        return applyPlaceholders(protocols.callerFrustration, placeholders);
    }
    
    // Telemarketer filter
    if ((qLower.includes('sell') || qLower.includes('offer') || qLower.includes('deal') || 
         qLower.includes('promotion') || qLower.includes('save money')) && protocols.telemarketerFilter) {
        console.log(`[Protocol] Using telemarketerFilter protocol`);
        return applyPlaceholders(protocols.telemarketerFilter, placeholders);
    }
    
    // Message taking scenario
    if ((qLower.includes('leave message') || qLower.includes('take message') || qLower.includes('call back') || 
         qLower.includes('not available') || qLower.includes('busy')) && protocols.messageTaking) {
        console.log(`[Protocol] Using messageTaking protocol`);
        return applyPlaceholders(protocols.messageTaking, placeholders);
    }
    
    // Caller reconnect/apology
    if ((qLower.includes('disconnect') || qLower.includes('cut off') || qLower.includes('dropped') || 
         qLower.includes('hung up') || qLower.includes('lost you')) && protocols.callerReconnect) {
        console.log(`[Protocol] Using callerReconnect protocol`);
        return applyPlaceholders(protocols.callerReconnect, placeholders);
    }
    
    // When in doubt / general escalation
    if ((qLower.includes('not sure') || qLower.includes('don\'t know') || qLower.includes('uncertain') || 
         qLower.includes('complicated')) && protocols.whenInDoubt) {
        console.log(`[Protocol] Using whenInDoubt protocol`);
        return applyPlaceholders(protocols.whenInDoubt, placeholders);
    }
    
    // Booking confirmation (when scheduling keywords detected)
    if ((qLower.includes('confirm') || qLower.includes('book') || qLower.includes('schedule') || 
         qLower.includes('appointment')) && protocols.bookingConfirmation) {
        console.log(`[Protocol] Using bookingConfirmation protocol`);
        return applyPlaceholders(protocols.bookingConfirmation, placeholders);
    }
    
    // Text-to-pay scenarios
    if ((qLower.includes('payment') || qLower.includes('pay') || qLower.includes('text to pay') || 
         qLower.includes('invoice')) && protocols.textToPay) {
        console.log(`[Protocol] Using textToPay protocol`);
        return applyPlaceholders(protocols.textToPay, placeholders);
    }
    
    return null; // No protocol match
}

// Helper functions for conversational script processing
function handleGreeting(company, question, personality, placeholders) {
    const agentSetup = company?.agentSetup || {};
    const companyName = company?.companyName || 'our company';
    const greeting = agentSetup.agentGreeting || `Thank you for calling ${companyName}! How can I assist you today?`;
    return applyPlaceholders(greeting, placeholders);
}

function handleIntentDetection(company, question, callIntent, personality, placeholders) {
    const agentSetup = company?.agentSetup || {};
    const companySpecialties = agentSetup.companySpecialties || '';
    
    switch(callIntent) {
        case 'repair':
            return `I understand you need a repair. Could you tell me more about the issue you're experiencing with your system?`;
        case 'maintenance':
            return `I'd be happy to help schedule maintenance. Regular maintenance is important for optimal performance. When was your system last serviced?`;
        case 'installation':
            return `I understand you're interested in a new installation. Our team can definitely help with that. Could you share some details about your needs so we can provide the best solution?`;
        case 'pricing':
            return `I understand you're looking for pricing information. The cost will depend on several factors. Could you tell me more about what specific service you're interested in?`;
        default:
            return `How can we help you with your ${companySpecialties.split(',')[0].trim()} needs today?`;
    }
}

function handleClosing(company, question, personality, placeholders) {
    return `Thank you for calling. Is there anything else I can assist you with today?`;
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