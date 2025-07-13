// services/agentCompetitive.js - HighLevel Competitive Mode
// Streamlined agent designed to match HighLevel's effectiveness

const { getDB } = require('../db');
const { ObjectId } = require('mongodb');
const { applyPlaceholders } = require('../utils/placeholders');

// Import needed functions from agent service
const { google } = require('googleapis');
const { VertexAI } = require('@google-cloud/vertexai');

// Initialize VertexAI (same as main agent)
const vertex_ai = new VertexAI({
    project: process.env.GCLOUD_PROJECT_ID, 
    location: process.env.GCLOUD_LOCATION 
});
const model = vertex_ai.preview.getGenerativeModel({
    model: 'gemini-1.5-flash',
    generationConfig: {
        maxOutputTokens: 50, // Even more concise for competitive mode
        temperature: 0.2,    // More deterministic
        topK: 3,
        topP: 0.5
    }
});

/**
 * HIGHLEVEL COMPETITIVE MODE
 * 
 * Simplified 4-step response system designed for maximum effectiveness:
 * 1. Quick Q&A lookup (no fuzzy matching complexity)
 * 2. Pattern-based responses (proven scenarios)
 * 3. Simple LLM call (streamlined prompting)
 * 4. Fallback to human (clean escalation)
 */

async function answerQuestionCompetitive(companyId, question, personality = 'friendly') {
  const startTime = Date.now();
  
  try {
    const db = getDB();
    const company = await db.collection('companiesCollection').findOne({ 
      _id: new ObjectId(companyId) 
    });
    
    if (!company) {
      return { text: "I apologize, but I'm having technical difficulties. Let me connect you with someone who can help.", escalate: true };
    }

    const placeholders = company?.agentSetup?.placeholders || [];
    const companyName = company?.companyName || 'our company';
    
    // STEP 1: EXACT Q&A MATCH (no fuzzy logic - keep it simple)
    const exactAnswer = findExactQAMatch(company, question);
    if (exactAnswer) {
      console.log(`[Competitive] Exact Q&A match found`);
      return { 
        text: applyPlaceholders(exactAnswer, placeholders), 
        escalate: false,
        responseTime: Date.now() - startTime
      };
    }

    // STEP 2: PROVEN PATTERN RESPONSES (high-confidence scenarios)
    const patternResponse = getProvenPatternResponse(question, companyName, personality);
    if (patternResponse) {
      console.log(`[Competitive] Pattern response used`);
      return { 
        text: applyPlaceholders(patternResponse, placeholders), 
        escalate: false,
        responseTime: Date.now() - startTime
      };
    }

    // STEP 3: SIMPLIFIED LLM CALL (no complex prompting)
    if (company?.aiSettings?.llmFallbackEnabled !== false) {
      const llmResponse = await callSimplifiedModel(company, question, personality);
      if (llmResponse && llmResponse.length > 5) {
        console.log(`[Competitive] LLM response generated`);
        return { 
          text: applyPlaceholders(llmResponse, placeholders), 
          escalate: false,
          responseTime: Date.now() - startTime
        };
      }
    }

    // STEP 4: CLEAN ESCALATION
    console.log(`[Competitive] Escalating to human`);
    return { 
      text: applyPlaceholders(getEscalationMessage(personality), placeholders), 
      escalate: true,
      responseTime: Date.now() - startTime
    };

  } catch (error) {
    console.error('[Competitive] Error:', error);
    return { 
      text: "I apologize for the technical difficulty. Let me connect you with a team member right away.", 
      escalate: true,
      responseTime: Date.now() - startTime
    };
  }
}

// Find exact matches in Q&A (no fuzzy matching complexity)
function findExactQAMatch(company, question) {
  const qLower = question.toLowerCase().trim();
  
  // Check category Q&As for exact keyword matches
  const categoryQAs = company?.agentSetup?.categoryQAs || '';
  if (categoryQAs) {
    const qaLines = categoryQAs.split('\n');
    for (const line of qaLines) {
      if (line.includes('Q:') && line.includes('A:')) {
        const [qPart, aPart] = line.split('A:');
        const qaQuestion = qPart.replace('Q:', '').trim().toLowerCase();
        
        // Simple keyword matching - if 2+ important words match
        const qaWords = qaQuestion.split(' ').filter(w => w.length > 3);
        const questionWords = qLower.split(' ').filter(w => w.length > 3);
        const matches = qaWords.filter(w => questionWords.includes(w));
        
        if (matches.length >= 2 || qaWords.some(w => qLower.includes(w) && w.length > 5)) {
          return aPart.trim();
        }
      }
    }
  }
  
  return null;
}

// Proven pattern responses (based on HighLevel's likely approach)
function getProvenPatternResponse(question, companyName, personality) {
  const qLower = question.toLowerCase();
  
  // Scheduling requests (most common)
  if (qLower.includes('schedule') || qLower.includes('appointment') || qLower.includes('book')) {
    return "I'd be happy to help you schedule an appointment. What type of service do you need, and what day and time works best for you?";
  }
  
  // Emergency situations (high priority)
  if (qLower.includes('emergency') || qLower.includes('urgent') || qLower.includes('asap')) {
    return "I understand this is urgent. Let me connect you with our emergency team right away to get someone out to help you immediately.";
  }
  
  // Pricing questions (very common)
  if (qLower.includes('cost') || qLower.includes('price') || qLower.includes('how much')) {
    return "I'd be happy to help with pricing information. The cost depends on the specific service needed. Would you like me to schedule a free estimate for you?";
  }
  
  // Hours/availability
  if (qLower.includes('hour') || qLower.includes('open') || qLower.includes('available')) {
    return "We're open Monday through Friday, 8 AM to 6 PM. We also offer emergency service 24/7. What can I help you with today?";
  }
  
  // Simple yes/no responses
  if (qLower === 'yes' || qLower === 'yeah' || qLower === 'yep') {
    return "Perfect! Let me help you with that. What information do you need from me?";
  }
  
  if (qLower === 'no' || qLower === 'nope') {
    return "No problem at all. Is there anything else I can help you with today?";
  }
  
  return null;
}

// Simplified LLM call (minimal prompting for reliability)
async function callSimplifiedModel(company, question, personality) {
  const companyName = company?.companyName || 'our company';
  const services = company?.agentSetup?.categories?.join(', ') || 'our services';
  
  // Simple, proven prompt structure
  const prompt = `You are a helpful AI assistant for ${companyName}. We provide ${services}.

Customer question: "${question}"

Respond in 1-2 sentences maximum. Be ${personality}, helpful, and direct. If you can't answer, suggest they speak with a team member.

Response:`;

  try {
    const result = await model.generateContent(prompt);
    const response = result.response.text();
    
    // Ensure response is concise (HighLevel-style)
    if (response && response.length > 150) {
      return response.split('.')[0] + '.';
    }
    
    return response;
  } catch (error) {
    console.error('[Competitive] LLM call failed:', error);
    return null;
  }
}

// Simple escalation messages
function getEscalationMessage(personality) {
  const messages = {
    friendly: "I want to make sure you get exactly the help you need. Let me connect you with one of our team members who can assist you right away!",
    professional: "I'd like to connect you with one of our specialists who can provide you with detailed assistance for your specific needs.",
    casual: "Let me get one of the team to help you out - they'll have all the answers you need!"
  };
  
  return messages[personality] || messages.friendly;
}

module.exports = {
  answerQuestionCompetitive
};
