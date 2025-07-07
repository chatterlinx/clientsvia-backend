console.log('--- FINGERPRINT: EXECUTING services/agent.js ---'); // Added a comment to trigger re-deployment

const KnowledgeEntry = require('../models/KnowledgeEntry');
const { getDB } = require('../db');

const { google } = require('googleapis');
const { VertexAI } = require('@google-cloud/vertexai');
const { stripMarkdown } = require('../utils/textUtils');
const { findCachedAnswer } = require('../utils/aiAgent');
const { getRandomPersonalityResponse } = require('../utils/personalityResponses');
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
const MODEL_ID = process.env.MODEL_ID || 'gemini-2.5-flash'; // Use env or default to latest
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
  const aiplatform = google.aiplatform({ version: 'v1beta1', auth: authClient });

  const invoke = async (modelName) => {
    const model = `projects/${projectId}/locations/us-central1/publishers/google/models/${modelName}`;
    try {
      console.log(`[VertexAI] Sending prompt to ${modelName}: ${prompt}`);
      const res = await aiplatform.projects.locations.publishers.models.generateContent({
        model,
        requestBody: {
          contents: [{ role: 'user', parts: [{ text: prompt }] }]
        }
      });
      const responseText = res.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      console.log(`[VertexAI] Received response from ${modelName}: ${responseText}`);
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

  // keep parsed Q&A cached
  loadCompanyQAs(company);

  // First, check KnowledgeEntry (existing functionality)
  const entry = await KnowledgeEntry.findOne({ companyId, 
    category: { $in: categories },
    question: { $regex: new RegExp(question, 'i') },
    approved: true
  }).exec();

  if (entry) {
    console.log(`[KnowledgeBase] Found answer in KnowledgeEntry for: ${question}`);
    return { text: applyPlaceholders(entry.answer, placeholders), escalate: false };
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

  fullPrompt += `\n\n**Response Guidelines:**`;
  fullPrompt += `\n- Stay in character as The Agent for ${company?.companyName}`;
  fullPrompt += `\n- Be helpful, professional, and maintain your ${personality} personality`;
  fullPrompt += `\n- Use the company information and specialties provided above`;
  fullPrompt += `\n- If you don't know something specific, be honest but offer to help in other ways`;
  fullPrompt += `\n- Keep responses conversational and natural`;
  fullPrompt += `\n- Always try to ask a clarifying question to keep the conversation going, unless the user explicitly ends the conversation or asks for a specific action (like scheduling)`;

  if (responseLength === 'concise') {
    fullPrompt += '\n- Provide a very brief and concise answer, ideally one to two sentences.';
  } else if (responseLength === 'detailed') {
    fullPrompt += '\n- Provide a comprehensive and detailed answer.';
  }

  fullPrompt += `\n\nPlease respond naturally and helpfully to the current question.`;

  if (!llmFallbackEnabled) {
    const message = applyPlaceholders((customEscalationMessage || await getRandomPersonalityResponse(companyId, 'transferToRep')).trim(), placeholders);
    try {
      const { logEscalationEvent } = require('../utils/escalationLogger');
      await logEscalationEvent(originalCallSid, companyId, question);
    } catch (err) {
      console.error('Failed to log escalation:', err.message);
    }
    return { text: message, escalate: true };
  }

  const aiResponse = await (async () => {
    console.log(`[LLM] Sending prompt to ${company?.companyName}:`, fullPrompt);
    return await callModel(company, fullPrompt);
  })();

  console.log(`[LLM] Received response:`, aiResponse);

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

module.exports = {
  answerQuestion,
  FALLBACK_MODEL,
  loadCompanyQAs,
  findCachedAnswer
};