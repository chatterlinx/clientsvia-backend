console.log('--- FINGERPRINT: EXECUTING services/agent.js ---'); // Added a comment to trigger re-deployment

const CompanyQnA = require('../models/knowledge/CompanyQnA');
const { getDB } = require('../db');

const { google } = require('googleapis');
const { VertexAI } = require('@google-cloud/vertexai');
const { stripMarkdown } = require('../utils/textUtils');
const { findCachedAnswer } = require('../utils/aiAgent');
const { getRandomPersonalityResponse, getPersonalityResponse } = require('../utils/personalityResponses_enhanced');
const { applyPlaceholders } = require('../utils/placeholders');

// Import Service Issue Handler for booking flow
const ServiceIssueHandler = require('./serviceIssueHandler');
const serviceIssueHandler = new ServiceIssueHandler();

// 🧠 Import AI Intelligence Engine
const aiIntelligenceEngine = require('./aiIntelligenceEngine');

// Import the custom KB checker
const { checkCustomKB } = require('../middleware/checkCustomKB');

// Import ClientsVia Intelligence Engine (replaces old inHouse engine)
const ClientsViaIntelligenceEngine = require('./clientsViaIntelligenceEngine');

// Import Template Intelligence Engine
const TemplateIntelligenceEngine = require('./templateIntelligenceEngine');

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
// Initialize VertexAI only when needed and with proper error handling
let vertex_ai;
function getVertexAI() {
  if (!vertex_ai) {
    const projectId = process.env.GCLOUD_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
    if (!projectId) {
      throw new Error('Google Cloud Project ID not configured. Set GCLOUD_PROJECT_ID or GOOGLE_CLOUD_PROJECT environment variable.');
    }
    vertex_ai = new VertexAI({
        project: projectId, 
        location: process.env.GCLOUD_LOCATION || 'us-central1'
    });
  }
  return vertex_ai;
}

// Gemini Flash model
const MODEL_ID = process.env.MODEL_ID || 'gemini-1.5-flash-002'; // Use env or default to stable version
const MODEL_NAME = MODEL_ID;

// Default model used when a configured one fails with a not found error
const FALLBACK_MODEL = MODEL_NAME;

// Call the model - CLOUD-ONLY (local LLM disabled)
async function callModel(company, prompt) {
  const ResponseTraceLogger = require('../utils/responseTraceLogger');
  
  // Cloud-only approach - local LLM disabled
  console.log(`[CloudAPI] 🌐 Using cloud API (local LLM disabled)...`);
  
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
const agentPerformanceTracker = require('./agentPerformanceTracker');

async function answerQuestion(companyId, question, responseLength = 'concise', conversationHistory = [], mainAgentScriptParam = '', personality = 'friendly', companySpecialties = '', categoryQAs = '', originalCallSid = null) {
  const startTime = Date.now();
  let responseMethod = 'unknown';
  let confidence = 0;
  let debugInfo = {};
  
  const db = getDB();
  const company = await db.collection('companiesCollection').findOne({ _id: new ObjectId(companyId) });
  const categories = company?.agentSetup?.categories || company?.tradeTypes || [];
  const { llmFallbackEnabled, customEscalationMessage } = company?.aiSettings || {};
  const placeholders = company?.agentSetup?.placeholders || [];
  
  // DYNAMIC TRADE CATEGORIES: Use the company's selected trade categories for AI agent context
  const selectedTradeCategories = company?.tradeTypes || [];
  console.log(`[Agent] Company ${companyId} - Using Selected Trade Categories: [${selectedTradeCategories.join(', ')}]`);
  
  // USE SCRIPT FROM COMPANY OBJECT, NOT PARAMETER
  const mainAgentScript = company?.agentSetup?.mainAgentScript || mainAgentScriptParam || '';
  
  // REPEAT ANSWER PREVENTION - Check if we've recently given similar responses
  const recentResponses = conversationHistory.filter(entry => entry.role === 'agent').slice(-3); // Last 3 agent responses
  
  // Extract key topics from customer's rambling (enhanced keyword extraction)
  const customerKeywords = extractKeyTopicsFromRambling(question, conversationHistory);
  console.log(`[Agent] Extracted key topics from customer: ${customerKeywords.join(', ')}`);
  
  // Enhanced question for better matching (combine original + extracted keywords)
  const enhancedQuestion = question + ' ' + customerKeywords.join(' ');
  
  // Define fuzzy threshold for Q&A matching (lower for better matching)
  const fuzzyThreshold = company?.aiSettings?.fuzzyMatchThreshold ?? 0.15; // Lowered from 0.25 to 0.15 for better Q&A matching

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
  
  // NEW STEP 1: Check for Service Issues that require booking flow (highest priority for service calls)
  const serviceIssueResult = await serviceIssueHandler.handleServiceIssue(question, companyId, { 
    conversationHistory, 
    callSid: originalCallSid 
  });
  
  if (serviceIssueResult) {
    console.log(`[Agent] Service Issue Detected - Source: ${serviceIssueResult.source}`);
    responseMethod = 'service-issue-booking';
    confidence = 0.95;
    debugInfo = { 
      section: 'service-issue', 
      source: serviceIssueResult.source,
      proceedToBooking: serviceIssueResult.proceedToBooking 
    };
    
    // Track performance
    await trackPerformance(companyId, originalCallSid, question, serviceIssueResult.response, responseMethod, confidence, debugInfo, startTime);
    
    return { 
      text: serviceIssueResult.response, 
      escalate: serviceIssueResult.shouldEscalate,
      bookingFlow: serviceIssueResult.bookingFlow,
      proceedToBooking: serviceIssueResult.proceedToBooking
    };
  }

  // NEW STEP 1.5: CHECK CUSTOM KNOWLEDGE BASE WITH CLOUD FALLBACK
  console.log(`[Custom KB] Checking knowledge base for: "${question}"`);

  const TraceLogger = require('../utils/traceLogger');
  const traceLogger = new TraceLogger();
  
  // Use standard KB (cloud fallback disabled)
  const customKBResult = await checkCustomKB(question, companyId, traceLogger, {
    selectedTradeCategories: selectedTradeCategories // Pass selected trade categories for dynamic Q&A lookup
  });

  if (customKBResult && customKBResult.answer) {
    console.log(`[Custom KB] Found match using trade categories [${selectedTradeCategories.join(', ')}]: "${customKBResult.answer.substring(0, 100)}..."`);
    
    responseMethod = 'custom-trade-kb';
    confidence = customKBResult.confidence;
    debugInfo = {
      section: 'custom-trade-kb',
      source: customKBResult.source,
      fallbackUsed: customKBResult.fallbackUsed,
      cloudModel: customKBResult.cloudModel,
      responseTime: customKBResult.responseTime,
      trace: customKBResult.trace,
      tradeCategories: selectedTradeCategories
    };
    
    await trackPerformance(companyId, originalCallSid, question, customKBResult.answer, responseMethod, confidence, debugInfo, startTime);
    
    return {
      text: customKBResult.answer,
      escalate: false,
      responseMethod: responseMethod,
      trace: customKBResult.trace,
      cloudFallbackUsed: customKBResult.fallbackUsed
    };
  }

  // 🧠 NEW STEP 2: AI INTELLIGENCE ENGINE PROCESSING
  console.log(`[AI Intelligence] Processing query with Super-Intelligent AI Engine...`);
  
  // Get contextual memory for personalization
  const callerId = originalCallSid || 'anonymous';
  const contextualMemory = await aiIntelligenceEngine.getContextualMemory(callerId, companyId, company);
  
  // Check for semantic knowledge match
  const semanticResult = await aiIntelligenceEngine.processSemanticKnowledge(question, companyId, company);
  
  if (semanticResult && semanticResult.confidence >= (company?.aiSettings?.semanticKnowledge?.confidenceThreshold || 0.87)) {
    console.log(`[AI Intelligence] High-confidence semantic match found: ${(semanticResult.confidence * 100).toFixed(1)}%`);
    
    // Store interaction in contextual memory
    await aiIntelligenceEngine.storeContextualMemory(callerId, companyId, {
      query: question,
      response: semanticResult.answer,
      source: 'semantic_knowledge',
      confidence: semanticResult.confidence
    }, company);
    
    responseMethod = 'ai-semantic-knowledge';
    confidence = semanticResult.confidence;
    debugInfo = { 
      section: 'ai-intelligence', 
      source: 'semantic_knowledge',
      confidence: semanticResult.confidence,
      category: semanticResult.category
    };
    
    // Track performance
    await trackPerformance(companyId, originalCallSid, question, semanticResult.answer, responseMethod, confidence, debugInfo, startTime);
    
    return { 
      text: semanticResult.answer,
      responseMethod: responseMethod,
      confidence: confidence,
      debugInfo: debugInfo,
      aiIntelligence: {
        semanticMatch: true,
        confidence: semanticResult.confidence,
        source: semanticResult.source
      }
    };
  }

  // Check for smart escalation triggers
  const escalationCheck = await aiIntelligenceEngine.checkSmartEscalation(
    question, 
    { conversationHistory, contextualMemory }, 
    companyId, 
    company
  );
  
  if (escalationCheck.shouldEscalate) {
    console.log(`[AI Intelligence] Smart escalation triggered: ${escalationCheck.reasons.join(', ')}`);
    
    responseMethod = 'ai-smart-escalation';
    confidence = escalationCheck.confidence;
    debugInfo = { 
      section: 'ai-intelligence', 
      source: 'smart_escalation',
      reasons: escalationCheck.reasons
    };
    
    const escalationMessage = customEscalationMessage || 
      "I understand this requires specialized attention. Let me connect you with one of our experts who can provide the detailed assistance you need.";
    
    // Track performance
    await trackPerformance(companyId, originalCallSid, question, escalationMessage, responseMethod, confidence, debugInfo, startTime);
    
    return { 
      text: escalationMessage,
      responseMethod: responseMethod,
      confidence: confidence,
      debugInfo: debugInfo,
      shouldEscalate: true,
      aiIntelligence: {
        smartEscalation: true,
        confidence: escalationCheck.confidence,
        reasons: escalationCheck.reasons
      }
    };
  }

  // Try dynamic reasoning for complex queries
  if (company?.aiSettings?.dynamicReasoning?.enabled !== false) {
    const reasoningResult = await aiIntelligenceEngine.processWithDynamicReasoning(
      question, 
      { conversationHistory, contextualMemory }, 
      companyId, 
      company
    );
    
    if (reasoningResult && reasoningResult.answer) {
      console.log(`[AI Intelligence] Dynamic reasoning provided answer in ${reasoningResult.stepsUsed} steps`);
      
      // Store interaction in contextual memory
      await aiIntelligenceEngine.storeContextualMemory(callerId, companyId, {
        query: question,
        response: reasoningResult.answer,
        source: 'dynamic_reasoning',
        stepsUsed: reasoningResult.stepsUsed
      }, company);
      
      responseMethod = 'ai-dynamic-reasoning';
      confidence = 0.85;
      debugInfo = { 
        section: 'ai-intelligence', 
        source: 'dynamic_reasoning',
        stepsUsed: reasoningResult.stepsUsed
      };
      
      // Track performance
      await trackPerformance(companyId, originalCallSid, question, reasoningResult.answer, responseMethod, confidence, debugInfo, startTime);
      
      return { 
        text: reasoningResult.answer,
        responseMethod: responseMethod,
        confidence: confidence,
        debugInfo: debugInfo,
        aiIntelligence: {
          dynamicReasoning: true,
          stepsUsed: reasoningResult.stepsUsed,
          reasoningSteps: reasoningResult.reasoningSteps
        }
      };
    }
  }

  // 🎨 STEP 3: TEMPLATE INTELLIGENCE ENGINE (Answer Priority Flow Tier 3)
  console.log(`[Template Intelligence] Processing with Template Intelligence Engine...`);
  
  const templateEngine = new TemplateIntelligenceEngine();
  const templateResult = await templateEngine.processQuery(question, companyId, {
    conversationHistory,
    callSid: originalCallSid,
    callerName: context?.callerName,
    departmentName: context?.departmentName
  });
  
  if (templateResult && templateResult.confidence >= 0.65) {
    console.log(`[Template Intelligence] Generated ${templateResult.category} response: ${(templateResult.confidence * 100).toFixed(1)}%`);
    
    responseMethod = `template-${templateResult.category}`;
    confidence = templateResult.confidence;
    debugInfo = { 
      section: 'template-intelligence', 
      category: templateResult.category,
      templateUsed: templateResult.templateUsed,
      personalityApplied: templateResult.personalityApplied
    };
    
    // Track performance
    await trackPerformance(companyId, originalCallSid, question, templateResult.response, responseMethod, confidence, debugInfo, startTime);
    
    return { 
      text: templateResult.response,
      responseMethod: responseMethod,
      confidence: confidence,
      debugInfo: debugInfo,
      templateIntelligence: {
        category: templateResult.category,
        confidence: templateResult.confidence,
        templateUsed: templateResult.templateUsed,
        personalityApplied: templateResult.personalityApplied
      }
    };
  }

  // STEP 4: Check for specific scenario protocols (moved to lower priority)
  const protocols = company?.agentSetup?.protocols || {};
  const protocolResponse = checkSpecificProtocols(protocols, question, conversationHistory, placeholders);
  if (protocolResponse) {
    console.log(`[Agent] Using specific scenario protocol`);
    responseMethod = 'script';
    confidence = 0.95;
    debugInfo = { section: 'protocols', matchType: 'exact' };
    
    // Track performance
    await trackPerformance(companyId, originalCallSid, question, protocolResponse, responseMethod, confidence, debugInfo, startTime);
    
    return { text: protocolResponse, escalate: false };
  }

  // STEP 5: Check personality responses for common scenarios
  const personalityResponse = await checkPersonalityScenarios(companyId, enhancedQuestion.toLowerCase(), conversationHistory, company);
  if (personalityResponse) {
    console.log(`[Agent] Using personality response: ${personalityResponse.category}`);
    responseMethod = 'script';
    confidence = 0.85;
    debugInfo = { section: 'personality', category: personalityResponse.category };
    
    const finalText = applyPlaceholders(personalityResponse.text, placeholders);
    
    // Check for repetitive response
    if (isRepetitiveResponse(finalText, recentResponses)) {
      console.log(`[Agent] Personality response was repetitive, trying alternative approach`);
    } else {
      await trackPerformance(companyId, originalCallSid, question, finalText, responseMethod, confidence, debugInfo, startTime);
      return { text: finalText, escalate: false };
    }
  }

  // STEP 6: Check CompanyQnA (Priority #1 Knowledge Source)
  const entry = await CompanyQnA.findOne({ 
    companyId, 
    isActive: true,
    $or: [
      { question: { $regex: new RegExp(question, 'i') } },
      { keywords: { $in: question.split(' ').map(word => new RegExp(word, 'i')) } }
    ]
  }).exec();

  if (entry) {
    console.log(`[CompanyQnA] ✅ Found answer in Company Q&A Priority #1 Source for: ${question}`);
    responseMethod = 'company-qa-priority-1';
    confidence = entry.confidence || 0.95;
    debugInfo = { section: 'company-qna-priority-1', entryId: entry._id };
    
    const finalText = applyPlaceholders(entry.answer, placeholders);
    await trackPerformance(companyId, originalCallSid, question, finalText, responseMethod, confidence, debugInfo, startTime);
    
    return { text: finalText, escalate: false };
  }

  // STEP 7: Try quick Q&A reference (cheat sheet approach) with enhanced question
  const quickQAAnswer = extractQuickAnswerFromQA(await CompanyQnA.find({ companyId, isActive: true }).exec(), enhancedQuestion, fuzzyThreshold);
  if (quickQAAnswer) {
    console.log(`[Agent] Found quick Q&A reference for: ${enhancedQuestion}`);
    responseMethod = 'qa-intelligent';
    confidence = 0.75;
    debugInfo = { section: 'quick-qa', threshold: fuzzyThreshold };
    
    const conversationalAnswer = generateShortConversationalResponse(enhancedQuestion, quickQAAnswer, company?.companyName);
    const finalText = applyPlaceholders(conversationalAnswer, placeholders);
    
    // Check for repetitive response
    if (isRepetitiveResponse(finalText, recentResponses)) {
      console.log(`[Agent] Q&A response was repetitive, enhancing with personality`);
      const enhancedAnswer = await enhanceResponseWithPersonality(finalText, personality, customerKeywords);
      if (enhancedAnswer && !isRepetitiveResponse(enhancedAnswer, recentResponses)) {
        await trackPerformance(companyId, originalCallSid, question, enhancedAnswer, responseMethod, confidence, debugInfo, startTime);
        return { text: enhancedAnswer, escalate: false };
      }
    } else {
      await trackPerformance(companyId, originalCallSid, question, finalText, responseMethod, confidence, debugInfo, startTime);
      return { text: finalText, escalate: false };
    }
  }

  // STEP 8: Try company Q&A from agentSetup.categoryQAs (also as quick reference)
  const companyQAs = categoryQACache.get(companyId) || [];
  if (companyQAs.length > 0) {
    const quickCompanyAnswer = extractQuickAnswerFromQA(companyQAs, question, fuzzyThreshold);
    if (quickCompanyAnswer) {
      console.log(`[Agent] Found quick company Q&A reference for: ${question}`);
      responseMethod = 'qa-intelligent';
      confidence = 0.8;
      debugInfo = { section: 'company-qa', threshold: fuzzyThreshold };
      
      const conversationalAnswer = generateShortConversationalResponse(question, quickCompanyAnswer, company?.companyName);
      const finalText = applyPlaceholders(conversationalAnswer, placeholders);
      await trackPerformance(companyId, originalCallSid, question, finalText, responseMethod, confidence, debugInfo, startTime);
      
      return { text: finalText, escalate: false };
    }
  }

  // STEP 9: SMART CONVERSATIONAL BRAIN - NEW INTELLIGENT PROCESSING
  const smartResponse = await generateSmartConversationalResponse(company, question, conversationHistory, categories, companySpecialties, placeholders);
  if (smartResponse) {
    console.log(`[Agent] Generated smart conversational response for: ${question}`);
    responseMethod = 'smart-conversation';
    confidence = 0.7;
    debugInfo = { section: 'smart-conversation', categories: categories.join(',') };
    
    await trackPerformance(companyId, originalCallSid, question, smartResponse, responseMethod, confidence, debugInfo, startTime);
    
    return { text: smartResponse, escalate: false };
  }

  // STEP 10: PRIMARY SCRIPT CONTROLLER - mainAgentScript drives responses
  const scriptResponse = await processMainAgentScript(company, question, conversationHistory, placeholders);
  if (scriptResponse) {
    console.log(`[Agent] PRIMARY SCRIPT RESPONSE for: ${question}`);
    console.log(`[Script Debug] Used script section: ${scriptResponse.debugInfo?.section || 'unknown'}`);
    console.log(`[Script Debug] Match type: ${scriptResponse.debugInfo?.matchType || 'unknown'}`);
    return { text: scriptResponse.text, escalate: scriptResponse.escalate || false, debugInfo: scriptResponse.debugInfo };
  }

  // STEP 11: Try to understand the context and provide intelligent responses
  const parsedCompanyQAs = categoryQACache.get(companyId) || [];
  const intelligentResponse = await generateIntelligentResponse(company, question, conversationHistory, categories, companySpecialties, parsedCompanyQAs);
  if (intelligentResponse) {
    console.log(`[Agent] Generated intelligent response for: ${question}`);
    responseMethod = 'qa-intelligent';
    confidence = 0.65;
    debugInfo = { section: 'intelligent-response', qaCount: parsedCompanyQAs.length };
    
    const finalText = applyPlaceholders(intelligentResponse, placeholders);
    await trackPerformance(companyId, originalCallSid, question, finalText, responseMethod, confidence, debugInfo, startTime);
    
    return { text: finalText, escalate: false };
  }


  // If no direct answer found, construct prompt for Gemini
  const agentSetup = company?.agentSetup || {};

  let fullPrompt = `You are an AI assistant for ${company?.companyName}. Your name is The Agent. Your personality is ${personality}.`;

  // Add company specialties and services
  if (companySpecialties) {
    fullPrompt += `\n\n**Company Specialties:**\n${companySpecialties}`;
  }

  // Add DYNAMIC trade categories/services - prioritize selected trade categories
  if (selectedTradeCategories && selectedTradeCategories.length > 0) {
    fullPrompt += `\n\n**Your Selected Trade Categories (Your Areas of Expertise):**\n${selectedTradeCategories.join(', ')}`;
    fullPrompt += `\n**Note:** You specialize in these areas and should focus Q&A responses from these categories.`;
  } else if (categories && categories.length > 0) {
    fullPrompt += `\n\n**Services We Offer:**\n${categories.join(', ')}`;
  }

  // Add main agent script if available
  if (mainAgentScript) {
    fullPrompt += `\n\n**Your Instructions:**\n${mainAgentScript}`;
  }

  // Add category Q&As for context with intelligent usage instructions
  if (categoryQAs) {
    fullPrompt += `\n\n**Knowledge Base (Q&As):**\n${categoryQAs}`;
    fullPrompt += `\n\n**CRITICAL: How to Use Q&A Knowledge:**`;
    fullPrompt += `\n- If the customer's question relates to any Q&A above, extract ONLY the essential information needed`;
    fullPrompt += `\n- DON'T read the entire answer - pick the most relevant 1-2 key facts`;
    fullPrompt += `\n- For pricing: extract specific dollar amounts and offer quotes`;
    fullPrompt += `\n- For services: confirm "Yes, we do that" + next action`;
    fullPrompt += `\n- For hours: give specific times, not full explanations`;
    fullPrompt += `\n- Transform Q&A content into natural, conversational responses`;
    fullPrompt += `\n- Example: Q&A says "We service all major brands including..." → You say "Yes, we service that brand. Schedule a repair?"`;
  }

  // Add conversation history (increased from 2 to 8 for better context understanding)
  if (conversationHistory.length > 8) {
    conversationHistory = conversationHistory.slice(-8); // Keep last 8 exchanges for better context
  }

  if (conversationHistory.length > 0) {
    fullPrompt += "\n\n**Conversation History:**\n";
    conversationHistory.forEach(entry => {
      fullPrompt += `${entry.role}: ${entry.text}\n`;
    });
  }

  fullPrompt += `\n\n**Current Question:** ${question}`;

  // Add targeted Q&A context for the specific question
  const parsedQAs = categoryQACache.get(companyId) || [];
  if (parsedQAs.length > 0) {
    const relevantQAs = findMostRelevantQAs(question, parsedQAs, 2); // Get top 2 most relevant
    if (relevantQAs.length > 0) {
      fullPrompt += `\n\n**Most Relevant Q&As for This Question:**`;
      relevantQAs.forEach((qa, index) => {
        fullPrompt += `\n${index + 1}. Q: ${qa.question}`;
        fullPrompt += `\n   A: ${qa.answer}`;
      });
      fullPrompt += `\n\n**REMEMBER:** Extract only the essential information from these Q&As that directly answers their question. Don't repeat entire answers.`;
    }
  }

  // Check if this appears to be unclear speech or rambling
  const isUnclearSpeech = question.includes('[Speech unclear/low confidence:') || 
                         question.length < 5 || 
                         /^[a-z]{1,3}\.?$/i.test(question.trim());
                         
  const isRambling = question.length > 300 || 
                    question.split(' ').length > 50 ||
                    (question.match(/\b(and|then|so|but|also|actually|basically)\b/gi) || []).length > 5;

  fullPrompt += `\n\n**Response Guidelines:**`;
  fullPrompt += `\n- ULTRA-CONCISE: Maximum 1-2 sentences. Get to the point immediately.`;
  fullPrompt += `\n- SMART Q&A USAGE: If any Knowledge Base Q&A relates to their question, extract only the essential facts needed to help them`;
  fullPrompt += `\n- Don't recite full Q&A answers - distill them into the specific information the customer needs`;
  fullPrompt += `\n- Prioritize actionable responses: "Yes, we do that. When works for you?" over explanatory paragraphs`;
  fullPrompt += `\n- You are The Agent for ${company?.companyName} - be natural but brief`;
  fullPrompt += `\n- Don't repeat what the caller said - acknowledge briefly and offer next steps`;
  fullPrompt += `\n- Skip pleasantries unless they're greeting you - focus on solutions`;
  fullPrompt += `\n- If they need service: offer to schedule. If they have questions: answer directly.`;
  fullPrompt += `\n- NO rambling, NO lengthy explanations, NO unnecessary details`;
  fullPrompt += `\n- Examples of good responses: "Yes, we fix that. Schedule a visit?" or "Starts at $89. Want a quote?"`;
  
  // Add specific Q&A processing examples
  fullPrompt += `\n\n**Smart Q&A Processing Examples:**`;
  fullPrompt += `\n- If Q&A has pricing info: Extract dollar amount → "Repair starts at $X. Want a quote?"`;
  fullPrompt += `\n- If Q&A lists services: Confirm briefly → "Yes, we handle that. Available today?"`;
  fullPrompt += `\n- If Q&A has hours: Give specific times → "Open 8am-5pm weekdays. Need same-day service?"`;
  fullPrompt += `\n- If Q&A has warranty info: Extract key terms → "2-year warranty included. Ready to schedule?"`;
  fullPrompt += `\n- Transform long Q&A explanations into actionable responses that move the conversation forward`;
  
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
    // Use configurable response instead of legacy personality system [[memory:8276820]]
    const configResponse = company?.aiAgentLogic?.responseCategories?.core?.['transfer-response'] || 
      customEscalationMessage || 
      "I understand you're looking for service. Let me connect you with one of our technicians who can help you right away.";
    const message = applyPlaceholders(configResponse.trim(), placeholders);
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
    // Use configurable response instead of legacy personality system [[memory:8276820]]
    const configResponse = company?.aiAgentLogic?.responseCategories?.core?.['transfer-response'] || 
      customEscalationMessage || 
      "I understand you're looking for service. Let me connect you with one of our technicians who can help you right away.";
    const message = applyPlaceholders(configResponse.trim(), placeholders);
    return { text: message, escalate: true };
  }

  // Track agent performance metrics for LLM fallback
  responseMethod = 'llm-fallback';
  confidence = 0.5; // LLM fallback has moderate confidence
  debugInfo = { 
    section: 'llm-fallback', 
    originalLength: aiResponse?.length || 0,
    finalLength: finalResponse?.length || 0,
    wasShortened: aiResponse !== finalResponse
  };
  
  if (finalResponse) {
    try {
      // Note: In the new Company Q&A system, learning/suggestions are handled
      // by the CompanyKnowledgeService rather than storing directly here
      console.log(`[Agent] AI fallback response generated for: "${question}"`);
      console.log(`[Agent] Consider adding this Q&A to Company Knowledge Base for better future responses`);
    } catch (suggestErr) {
      console.error(`[Agent] Error in AI fallback logging:`, suggestErr.message);
    }
    
    // Track the LLM fallback performance
    await trackPerformance(companyId, originalCallSid, question, finalResponse, responseMethod, confidence, debugInfo, startTime);
  }

  return { text: applyPlaceholders(finalResponse, placeholders), escalate: false };
}

// Helper function to track agent performance
async function trackPerformance(companyId, callSid, question, responseText, responseMethod, confidence, debugInfo, startTime) {
  const responseTime = Date.now() - startTime;
  
  try {
    await agentPerformanceTracker.trackAgentResponse({
      companyId,
      callSid: callSid || 'test-call',
      question,
      responseMethod,
      responseTime,
      responseText,
      confidence,
      debugInfo
    });
  } catch (error) {
    console.error('[Performance] Error tracking response:', error.message);
  }
}

// Generate intelligent responses by analyzing Q&A data contextually
async function generateIntelligentResponse(company, question, conversationHistory, categories, companySpecialties, categoryQAs) {
  if (!categoryQAs || categoryQAs.length === 0) return null;
  
  const qLower = question.toLowerCase();
  const companyId = company?._id?.toString();
  
  // Look for Q&A entries that might be contextually relevant
  const relevantQAs = categoryQAs.filter(qa => {
    const qText = qa.question.toLowerCase();
    const aText = qa.answer.toLowerCase();
    
    // Check if the question contains keywords from the Q&A
    const questionWords = qLower.split(/\s+/).filter(word => word.length > 3);
    const qaWords = (qText + ' ' + aText).split(/\s+/).filter(word => word.length > 3);
    
    // Find common words between customer question and Q&A content
    const commonWords = questionWords.filter(word => 
      qaWords.some(qaWord => qaWord.includes(word) || word.includes(qaWord))
    );
    
    return commonWords.length >= 1;
  });
  
  if (relevantQAs.length === 0) return null;
  
  // Find the most relevant Q&A based on content overlap
  let bestMatch = null;
  let bestScore = 0;
  
  for (const qa of relevantQAs) {
    const qText = qa.question.toLowerCase();
    const aText = qa.answer.toLowerCase();
    const fullQAText = qText + ' ' + aText;
    
    // Score based on keyword matches
    const questionWords = qLower.split(/\s+/).filter(word => word.length > 3);
    const matches = questionWords.filter(word => fullQAText.includes(word));
    const score = matches.length / questionWords.length;
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = qa;
    }
  }
  
  // If we found a decent match (20% or better), process it intelligently
  if (bestMatch && bestScore >= 0.2) { // Lowered from 0.3 to 0.2
    console.log(`[Intelligent Response] Found contextual Q&A match (${Math.round(bestScore * 100)}% relevance)`);
    return generateSmartAnswerFromQA(question, bestMatch.answer, company?.companyName);
  }
  
  return null;
}

// Generate smart answer from Q&A data by extracting key information
function generateSmartAnswerFromQA(question, qaAnswer, companyName) {
  const qLower = question.toLowerCase();
  
  // For pricing questions, extract specific costs
  if (qLower.includes('cost') || qLower.includes('price') || qLower.includes('how much') || qLower.includes('charge')) {
    const priceMatches = qaAnswer.match(/\$\d+(?:\.\d{2})?/g);
    if (priceMatches && priceMatches.length > 0) {
      const prices = priceMatches.slice(0, 2); // Take up to 2 prices
      if (prices.length === 1) {
        return `${prices[0]} for that service. Want a detailed quote?`;
      } else {
        return `${prices[0]}-${prices[prices.length - 1]} depending on the work. Need an estimate?`;
      }
    }
    
    // Look for cost-related keywords
    if (qaAnswer.toLowerCase().includes('free estimate') || qaAnswer.toLowerCase().includes('no charge')) {
      return `Free estimates. When would you like us to take a look?`;
    }
  }
  
  // For service availability questions
  if (qLower.includes('do you') || qLower.includes('can you') || qLower.includes('service')) {
    const keywords = ['repair', 'fix', 'install', 'replace', 'maintain', 'service'];
    const hasServiceKeyword = keywords.some(keyword => qLower.includes(keyword));
    
    if (hasServiceKeyword) {
      // Look for affirmative indicators in the answer
      const affirmatives = ['yes', 'we do', 'we can', 'we offer', 'we provide', 'we handle', 'available'];
      const hasAffirmative = affirmatives.some(phrase => qaAnswer.toLowerCase().includes(phrase));
      
      if (hasAffirmative) {
        return `Yes, we handle that. Available today?`;
      }
    }
  }
  
  // For hours/scheduling questions
  if (qLower.includes('hour') || qLower.includes('open') || qLower.includes('when') || qLower.includes('available')) {
    const timePattern = /\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)/g;
    const times = qaAnswer.match(timePattern);
    
    if (times && times.length >= 2) {
      return `${times[0]} to ${times[times.length - 1]}, weekdays. Same-day service available.`;
    }
    
    if (qaAnswer.toLowerCase().includes('24') || qaAnswer.toLowerCase().includes('emergency')) {
      return `24/7 emergency service available. Need immediate help?`;
    }
    
    if (qaAnswer.toLowerCase().includes('monday') && qaAnswer.toLowerCase().includes('friday')) {
      return `Monday through Friday. Available today?`;
    }
  }
  
  // For warranty/guarantee questions
  if (qLower.includes('warrant') || qLower.includes('guarant') || qLower.includes('cover')) {
    const warrantyPattern = /\d+\s*(?:year|month|day)/gi;
    const warranty = qaAnswer.match(warrantyPattern);
    
    if (warranty && warranty.length > 0) {
      return `${warranty[0]} warranty on all work. Ready to schedule?`;
    }
    
    if (qaAnswer.toLowerCase().includes('guarantee') || qaAnswer.toLowerCase().includes('covered')) {
      return `All work is guaranteed. Want to schedule a service?`;
    }
  }
  
  // For emergency/urgent questions
  if (qLower.includes('emergency') || qLower.includes('urgent') || qLower.includes('immediate')) {
    if (qaAnswer.toLowerCase().includes('24') || qaAnswer.toLowerCase().includes('emergency') || qaAnswer.toLowerCase().includes('same day')) {
      return `Emergency service available now. What's the issue?`;
    }
  }
  
  // For appointment/booking questions
  if (qLower.includes('appointment') || qLower.includes('schedule') || qLower.includes('book')) {
    return `We can schedule you today. What time works best?`;
  }
  
  // Fallback: Extract the most actionable part of the answer
  const sentences = qaAnswer.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10);
  if (sentences.length > 0) {
    // Find sentences with actionable words
    const actionWords = ['call', 'schedule', 'contact', 'visit', 'available', 'book', 'appointment'];
    const actionableSentence = sentences.find(sentence => 
      actionWords.some(word => sentence.toLowerCase().includes(word))
    );
    
    if (actionableSentence && actionableSentence.length < 100) {
      return actionableSentence + '.';
    }
    
    // Return the shortest meaningful sentence
    const shortestSentence = sentences.reduce((shortest, current) => 
      current.length < shortest.length ? current : shortest
    );
    
    if (shortestSentence.length < 80) {
      return shortestSentence + '.';
    }
  }
  
  // Final fallback: ultra-concise extraction
  return extractConciseAnswer(qaAnswer);
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
async function checkPersonalityScenarios(companyId, question, conversationHistory, company) {
  const qLower = question.toLowerCase().trim();
  
  // Handle customer frustration and repetition complaints (PRIORITY 1)
  if (qLower.includes('repeating') || qLower.includes('same thing') || qLower.includes('over and over')) {
    // Use configurable response instead of legacy personality system [[memory:8276820]]
    const configResponse = company?.aiAgentLogic?.responseCategories?.core?.['frustrated-caller-response'] || 
      "I understand your frustration, and I want to make sure you get the help you need. Let me connect you with one of our experienced technicians.";
    return {
      category: 'repetitionComplaint',
      text: configResponse
    };
  }
  
  if (qLower.includes('not helping') || qLower.includes('frustrat') || qLower.includes('annoyed')) {
    // Use configurable response instead of legacy personality system [[memory:8276820]]
    const configResponse = company?.aiAgentLogic?.responseCategories?.core?.['frustrated-caller-response'] || 
      "I understand your frustration, and I want to make sure you get the help you need. Let me connect you with one of our experienced technicians.";
    return {
      category: 'customerFrustration', 
      text: configResponse
    };
  }
  
  // Handle appreciation
  if (qLower.includes('thank you') && !qLower.includes('no')) {
    // Use configurable response instead of legacy personality system [[memory:8276820]]
    const configResponse = company?.aiAgentLogic?.responseCategories?.core?.['gratitude-response'] || 
      "You're very welcome! I'm happy to help. What else can I do for you today?";
    return {
      category: 'gratitude',
      text: configResponse
    };
  }
  
  // Handle urgent situations  
  if (qLower.includes('asap') || qLower.includes('urgent') || qLower.includes('emergency')) {
    // Use configurable response instead of legacy personality system [[memory:8276820]]
    const configResponse = company?.aiAgentLogic?.responseCategories?.core?.['urgency-response'] || 
      "I understand this is urgent. Let me get you connected with our emergency team right away. What's the situation?";
    return {
      category: 'urgency',
      text: configResponse
    };
  }
  
  // Handle connection issues
  if (qLower.includes('can you hear') || qLower.includes('connection') || qLower.includes('breaking up')) {
    // Use configurable response instead of legacy personality system [[memory:8276820]]
    const configResponse = company?.aiAgentLogic?.responseCategories?.core?.['connection-trouble-response'] || 
      "It sounds like the line is breaking up. Can you still hear me clearly?";
    return {
      category: 'connection',
      text: configResponse
    };
  }
  
  // Handle confusion/unclear requests
  if (qLower.includes('confused') || qLower.includes('not sure') || qLower.includes('unclear')) {
    // Use configurable response instead of legacy personality system [[memory:8276820]]
    const configResponse = company?.aiAgentLogic?.responseCategories?.core?.['cant-understand-response'] || 
      "I want to make sure I understand what you need help with. Could you tell me a bit more about what's going on?";
    return {
      category: 'confusion',
      text: configResponse
    };
  }
  
  return null; // No specific scenario matched;
}

// Extract quick answer from Q&A entries using fuzzy matching
function extractQuickAnswerFromQA(qaEntries, question, threshold = 0.15) { // Lowered from 0.2 to 0.15 for better matching
  if (!qaEntries || qaEntries.length === 0) return null;
  
  const qLower = question.toLowerCase().trim();
  let bestMatch = null;
  let bestScore = 0;
  
  // Enhanced semantic synonym mapping with more thermostat variations
  const synonymMap = {
    'blank': ['not working', 'dead', 'dark', 'empty', 'black', 'screen blank', 'display blank', 'no display', 'off', 'nothing showing'],
    'not working': ['blank', 'broken', 'dead', 'down', 'out', 'failed', 'malfunctioning', 'won\'t work', 'doesn\'t work'],
    'broken': ['not working', 'dead', 'damaged', 'faulty', 'out of order', 'busted', 'messed up'],
    'dead': ['blank', 'not working', 'no power', 'won\'t turn on', 'lifeless', 'unresponsive'],
    'screen': ['display', 'monitor', 'panel', 'interface', 'readout', 'lcd'],
    'thermostat': ['temperature control', 'temp control', 'hvac control', 'climate control', 'stat', 'unit'],
    'fix': ['repair', 'service', 'maintenance', 'troubleshoot', 'check', 'look at'],
    'price': ['cost', 'charge', 'fee', 'rate', 'how much', 'expense', 'bill'],
    'hours': ['schedule', 'time', 'open', 'available', 'when', 'operating hours'],
    'emergency': ['urgent', '24/7', 'after hours', 'weekend', 'immediate', 'asap', 'right now']
  };
  
  for (const entry of qaEntries) {
    const entryQuestion = (entry.question || '').toLowerCase();
    const entryAnswer = entry.answer || '';
    const fullEntryText = entryQuestion + ' ' + entryAnswer.toLowerCase();
    
    // Get question words and expand with synonyms
    const questionWords = qLower.split(' ').filter(word => word.length > 2);
    const expandedWords = new Set(questionWords);
    
    questionWords.forEach(word => {
      if (synonymMap[word]) {
        synonymMap[word].forEach(synonym => expandedWords.add(synonym));
      }
      // Check if word is a synonym of any key
      Object.entries(synonymMap).forEach(([key, synonyms]) => {
        if (synonyms.includes(word)) {
          expandedWords.add(key);
          synonyms.forEach(syn => expandedWords.add(syn));
        }
      });
    });
    
    // Enhanced matching with synonyms and patterns
    let matchCount = 0;
    let bonusScore = 0;
    
    Array.from(expandedWords).forEach(word => {
      if (fullEntryText.includes(word)) {
        matchCount += entryQuestion.includes(word) ? 2 : 1; // Question matches worth more
      }
    });
    
    // Enhanced pattern bonuses for common issues
    const patterns = [
      { pattern: /(my|the)?\s*(thermostat|stat|unit)\s*(is\s*)?(blank|not working|dead|screen|display)/, boost: 4 },
      { pattern: /(blank|dead|not working|dark|empty)\s*(thermostat|screen|display)/, boost: 4 },
      { pattern: /(thermostat|temp|stat)\s*(blank|not working|dead|screen|won't|doesn't)/, boost: 3 },
      { pattern: /(price|cost|charge)\s*(service|repair|call|visit)/, boost: 2 },
      { pattern: /(emergency|urgent|24\/7|after hours|weekend|immediate)/, boost: 2 },
      { pattern: /(blank|dead|not working|dark)\s*(screen|display|panel)/, boost: 3 }
    ];
    
    patterns.forEach(({ pattern, boost }) => {
      if (pattern.test(qLower) && pattern.test(fullEntryText)) {
        bonusScore += boost;
      }
    });
    
    // Calculate final score
    const baseScore = questionWords.length > 0 ? matchCount / questionWords.length : 0;
    const finalScore = baseScore + (bonusScore * 0.1); // Add bonus as percentage
    
    if (finalScore > threshold && finalScore > bestScore && entryAnswer.length > 10) {
      bestScore = finalScore;
      bestMatch = entryAnswer;
      console.log(`[Enhanced Q&A Match] Found match with score ${Math.round(finalScore * 100)}% for: "${entry.question}"`);
    }
  }
  
  return bestMatch;
}

// Find the most relevant Q&As for a specific question
function findMostRelevantQAs(question, qas, maxResults = 2) {
  if (!qas || qas.length === 0) return [];
  
  const qLower = question.toLowerCase();
  const questionWords = qLower.split(/\s+/).filter(word => word.length > 2); // Lowered threshold from 3 to 2
  
  // Enhanced semantic synonym mapping
  const synonymMap = {
    'blank': ['not working', 'dead', 'dark', 'empty', 'black', 'screen blank', 'display blank', 'no display'],
    'not working': ['blank', 'broken', 'dead', 'down', 'out', 'failed', 'malfunctioning'],
    'broken': ['not working', 'dead', 'damaged', 'faulty', 'out of order'],
    'dead': ['blank', 'not working', 'no power', 'won\'t turn on'],
    'screen': ['display', 'monitor', 'panel', 'interface'],
    'thermostat': ['temperature control', 'temp control', 'hvac control', 'climate control'],
    'fix': ['repair', 'service', 'maintenance', 'troubleshoot'],
    'price': ['cost', 'charge', 'fee', 'rate', 'how much'],
    'hours': ['schedule', 'time', 'open', 'available', 'when'],
    'emergency': ['urgent', '24/7', 'after hours', 'weekend', 'immediate']
  };
  
  // Expand question words with synonyms
  const expandedWords = new Set(questionWords);
  questionWords.forEach(word => {
    if (synonymMap[word]) {
      synonymMap[word].forEach(synonym => expandedWords.add(synonym));
    }
    // Check if word is a synonym of any key
    Object.entries(synonymMap).forEach(([key, synonyms]) => {
      if (synonyms.includes(word)) {
        expandedWords.add(key);
        synonyms.forEach(syn => expandedWords.add(syn));
      }
    });
  });
  
  // Score each Q&A based on enhanced relevance
  const scoredQAs = qas.map(qa => {
    const qText = qa.question.toLowerCase();
    const aText = qa.answer.toLowerCase();
    const fullText = qText + ' ' + aText;
    
    let score = 0;
    
    // Enhanced word matching with synonyms
    Array.from(expandedWords).forEach(word => {
      if (fullText.includes(word)) {
        score += qText.includes(word) ? 3 : 1; // Higher weight for question matches
      }
    });
    
    // Semantic pattern matching for common issues
    const patterns = [
      // Thermostat issues
      { pattern: /(thermostat|temp).*(blank|not working|dead|screen)/, boost: 5 },
      { pattern: /(blank|dead|not working).*(thermostat|screen|display)/, boost: 5 },
      // Service questions
      { pattern: /(do you|can you).*(service|fix|repair)/, boost: 4 },
      { pattern: /(price|cost|charge).*(service|repair|call)/, boost: 4 },
      // Time/schedule questions
      { pattern: /(what time|when|hours|schedule|available)/, boost: 3 },
      // Emergency patterns
      { pattern: /(emergency|urgent|24\/7|after hours)/, boost: 4 }
    ];
    
    patterns.forEach(({ pattern, boost }) => {
      if (pattern.test(qLower) && pattern.test(fullText)) {
        score += boost;
      }
    });
    
    // Specific question type bonuses (enhanced)
    if (qLower.includes('price') || qLower.includes('cost') || qLower.includes('how much')) {
      if (aText.includes('$') || aText.includes('price') || aText.includes('cost') || aText.includes('charge')) {
        score += 4;
      }
    }
    
    if (qLower.includes('hour') || qLower.includes('open') || qLower.includes('when') || qLower.includes('schedule')) {
      if (aText.includes('am') || aText.includes('pm') || aText.includes('hour') || aText.includes('time')) {
        score += 4;
      }
    }
    
    if (qLower.includes('do you') || qLower.includes('can you') || qLower.includes('service')) {
      if (aText.includes('yes') || aText.includes('we do') || aText.includes('service') || aText.includes('repair')) {
        score += 4;
      }
    }
    
    // Thermostat-specific scoring boost
    if ((qLower.includes('thermostat') || qLower.includes('temp')) && 
        (qText.includes('thermostat') || aText.includes('thermostat'))) {
      score += 6; // High boost for thermostat questions
    }
    
    return { ...qa, score };
  });
  
  // Lower threshold and better sorting
  return scoredQAs
    .filter(qa => qa.score > 2) // Lowered from 0 to 2 for better quality
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
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

// Extract concise answer from longer text
function extractConciseAnswer(text) {
  if (!text) return '';
  
  // Remove markdown and excessive formatting
  const cleaned = text
    .replace(/[*_`#]/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  // If already short, return as is
  if (cleaned.length <= 100) return cleaned;
  
  // Split into sentences and find the most informative one
  const sentences = cleaned.split(/[.!?]/).map(s => s.trim()).filter(s => s.length > 10);
  
  if (sentences.length === 0) return cleaned.substring(0, 100);
  
  // Look for sentences with key information
  const importantWords = ['yes', 'no', 'can', 'will', 'service', 'call', 'schedule', 'available', '$', 'price', 'cost'];
  
  for (const sentence of sentences) {
    const hasImportantInfo = importantWords.some(word => sentence.toLowerCase().includes(word));
    if (hasImportantInfo && sentence.length <= 100) {
      return sentence + '.';
    }
  }
  
  // Return the first sentence if none match criteria
  return sentences[0].substring(0, 100) + (sentences[0].length > 100 ? '...' : '.');
}

// Generate smart conversational responses using multiple AI techniques
async function generateSmartConversationalResponse(company, question, conversationHistory, categories, companySpecialties, placeholders) {
  if (!question || question.trim().length === 0) return null;
  
  const qLower = question.toLowerCase();
  const companyName = company?.companyName || 'our company';
  
  // Handle common service inquiry patterns
  if (qLower.includes('leak') || qLower.includes('leakage') || qLower.includes('dripping')) {
    if (categories.some(cat => cat.toLowerCase().includes('hvac') || cat.toLowerCase().includes('plumbing'))) {
      return `I can help with leak repairs. Where exactly is the leak occurring? Let's get someone out to take a look.`;
    }
  }
  
  // Handle repair/fix inquiries
  if (qLower.includes('repair') || qLower.includes('fix') || qLower.includes('broken') || qLower.includes('not working')) {
    if (categories.length > 0) {
      const service = categories[0].toLowerCase().includes('hvac') ? 'HVAC' : 'service';
      return `I can help with ${service} repairs. What seems to be the issue? Let's schedule a technician to take a look.`;
    }
  }
  
  // Handle maintenance inquiries
  if (qLower.includes('maintenance') || qLower.includes('service') || qLower.includes('check') || qLower.includes('tune')) {
    return `We offer regular maintenance services. When was your last service? I can schedule a maintenance visit for you.`;
  }
  
  // Handle emergency/urgent situations
  if (qLower.includes('emergency') || qLower.includes('urgent') || qLower.includes('immediate')) {
    return `I understand this is urgent. Let me get emergency service dispatched to you right away. What's your address?`;
  }
  
  // Handle pricing inquiries
  if (qLower.includes('cost') || qLower.includes('price') || qLower.includes('how much') || qLower.includes('charge')) {
    return `Service costs depend on the specific work needed. I can schedule a free estimate for you. When would be convenient?`;
  }
  
  // Handle availability/scheduling
  if (qLower.includes('available') || qLower.includes('schedule') || qLower.includes('appointment') || qLower.includes('when')) {
    return `We have availability this week. What day works best for you? I can check our schedule and get you set up.`;
  }
  
  // Handle vague or unclear inquiries
  if (qLower.includes('looking for') || qLower.includes('need help') || qLower.includes('don\'t know')) {
    const serviceType = categories.length > 0 ? categories[0] : 'service';
    return `I'm here to help with ${serviceType}. Can you tell me more about what you need assistance with today?`;
  }
  
  // General fallback for service companies
  if (categories.length > 0) {
    const serviceType = categories[0].toLowerCase().includes('hvac') ? 'HVAC' : categories[0];
    return `I can help you with ${serviceType} services. What specific issue can I assist you with today?`;
  }
  
  return null;
}

// ===== ENHANCED CONVERSATION INTELLIGENCE FUNCTIONS =====

/**
 * Extract key topics from customer rambling - lets customers talk freely while identifying core issues
 */
function extractKeyTopicsFromRambling(question, conversationHistory = []) {
  const text = question.toLowerCase();
  const allCustomerText = conversationHistory
    .filter(entry => entry.role === 'customer')
    .map(entry => entry.text.toLowerCase())
    .join(' ') + ' ' + text;
  
  // 🚨 REMOVED: Hardcoded keywords - All keywords must come from company-specific configuration
  // Keywords are now loaded from company.aiAgentLogic.keywordConfiguration per multi-tenant requirements
  const serviceKeywords = {}; // Empty - keywords must be configured per company
  
  const extractedTopics = [];
  
  // Extract service-related keywords
  Object.entries(serviceKeywords).forEach(([category, keywords]) => {
    keywords.forEach(keyword => {
      if (allCustomerText.includes(keyword)) {
        extractedTopics.push(keyword);
      }
    });
  });
  
  // Extract specific equipment mentions
  const equipmentPatterns = [
    /\b(my|the|our)\s+(thermostat|furnace|ac|air\s+conditioning|water\s+heater|dishwasher)\b/g,
    /\b(upstairs|downstairs|basement|main\s+floor)\s+(thermostat|stat|unit)\b/g,
    /\b(kitchen|bathroom|bedroom|living\s+room)\s+(sink|faucet|toilet|outlet)\b/g
  ];
  
  equipmentPatterns.forEach(pattern => {
    const matches = allCustomerText.match(pattern);
    if (matches) {
      matches.forEach(match => extractedTopics.push(match.replace(/\b(my|the|our)\s+/, '')));
    }
  });
  
  // Remove duplicates and return top keywords
  return [...new Set(extractedTopics)].slice(0, 8);
}

/**
 * Check if response would be repetitive
 */
function isRepetitiveResponse(newResponse, recentResponses) {
  if (!recentResponses || recentResponses.length === 0) return false;
  
  const newResponseLower = newResponse.toLowerCase();
  
  // Check for exact or very similar responses
  for (const recent of recentResponses) {
    const recentLower = recent.text.toLowerCase();
    
    // Calculate similarity (simple approach)
    const similarity = calculateStringSimilarity(newResponseLower, recentLower);
    if (similarity > 0.8) { // 80% similar = repetitive
      console.log(`[Agent] Detected repetitive response (${Math.round(similarity * 100)}% similar)`);
           return true;
    }
    
    // Check for repeated key phrases
    const newPhrases = newResponseLower.split(/[.!?]/).filter(phrase => phrase.length > 10);
    const recentPhrases = recentLower.split(/[.!?]/).filter(phrase => phrase.length > 10);
    
    for (const newPhrase of newPhrases) {
      for (const recentPhrase of recentPhrases) {
        if (calculateStringSimilarity(newPhrase.trim(), recentPhrase.trim()) > 0.9) {
          console.log(`[Agent] Detected repeated phrase: "${newPhrase.trim()}"`);
          return true;
        }
      }
    }
  }
  
  return false;
}

/**
 * Simple string similarity calculation
 */
function calculateStringSimilarity(str1, str2) {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  const editDistance = calculateLevenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

/**
 * Calculate Levenshtein distance between two strings */
function calculateLevenshteinDistance(str1, str2) {
  const matrix = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

/**
 * Enhance response with personality when avoiding repetition
 */
async function enhanceResponseWithPersonality(baseResponse, personality, customerKeywords) {
  try {
    // Get a personality-based variation of the response
    const personalityVariations = {
      'friendly': ['Thanks for your patience!', 'I understand your concern.', 'Let me help you with that.'],
      'professional': ['I can assist you with this matter.', 'Allow me to address your concern.', 'I will help resolve this issue.'],
      'empathetic': ['I know this can be frustrating.', 'I completely understand.', 'That sounds concerning.'],
      'solution-focused': ['Let\'s get this sorted out.', 'Here\'s what we can do.', 'Let me find the best solution.']
    };
    
    const variations = personalityVariations[personality] || personalityVariations['friendly'];
    const randomVariation = variations[Math.floor(Math.random() * variations.length)];
    
    // Combine the variation with focus on customer's key concerns
    const keywordFocus = customerKeywords.length > 0 ? 
      ` Regarding your ${customerKeywords[0]} issue, ` : ' ';
    
    return randomVariation + keywordFocus + baseResponse;
    
  } catch (error) {
    console.error('[Agent] Error enhancing response with personality:', error);
    return null;
  }
}

module.exports = { 
  answerQuestion, 
  loadCompanyQAs,
  extractKeyTopicsFromRambling,
  isRepetitiveResponse
};