const { getDB } = require('../db');
const { ObjectId } = require('mongodb');
const { redisClient } = require('../clients');

// In-memory cache so each company's responses are only loaded once per session
const companyResponsesCache = new Map();

const defaultResponses = {
  cantUnderstand: [
    "I'm sorry, I didn't quite catch that. Could you repeat it?",
    "Apologies, could you say that again?",
    "Pardon me, could you rephrase that?",
    "I missed that; would you mind repeating?",
    "Sorry, I didn't understand. Can you say it another way?"
  ],
  speakClearly: [
    "Could you speak a bit more clearly, please?",
    "I want to make sure I get this right—could you rephrase?",
    "Would you mind speaking up a little?",
    "I'm having trouble hearing; could you say that slower?",
    "Can you please clarify your request?"
  ],
  outOfCategory: [
    "That's outside what we typically handle, but I can find out who does.",
    "Let me connect you with the right person for that question.",
    "I'm not sure about that, but someone else can assist you.",
    "I'll transfer you to a team member who can help.",
    "That's beyond my scope. Hold on while I get someone."
  ],
  transferToRep: [
    "One moment while I transfer you to a live agent who can assist.",
    "Let me get someone on the line who can help you right away.",
    "I'll connect you with a representative now.",
    "Please hold while I transfer your call.",
    "I'm handing you off to a colleague who can assist."
  ],
  calendarHesitation: [
    "If you'd like, I can pencil you in and you can confirm later—no obligation.",
    "We can schedule now and you can always reschedule if needed.",
    "No worries—would a different time work better?",
    "I can check other slots if that helps.",
    "Feel free to pick a time; we can adjust if necessary."
  ],
  businessClosed: [
    "Thanks for calling! Have a wonderful day.",
    "I appreciate your time. Goodbye!",
    "We're closing our call now. Take care!",
    "Have a great day, and thanks for calling.",
    "Goodbye! Reach out if you need anything else."
  ],
  frustratedCaller: [
    "I'm sorry for the trouble. Let's see how we can fix this.",
    "I understand this is frustrating. I'm here to help.",
    "I apologize for the inconvenience. Let me try to assist.",
    "I know this situation isn't ideal; I'll do my best to resolve it.",
    "I hear your concern and want to make it right."
  ],
  businessHours: [
    "Our normal hours are 8am to 5pm, Monday through Friday.",
    "We're open weekdays 8 to 5 if that helps plan your visit.",
    "We operate from 8 in the morning until 5 in the evening, Monday through Friday.",
    "Business hours are Monday through Friday, 8am to 5pm.",
    "You can reach us on weekdays between 8am and 5pm."
  ],
  connectionTrouble: [
    "It sounds like the line is breaking up—can you still hear me?",
    "I'm having trouble hearing you. Let's try again or I can call back.",
    "Seems the connection isn't great. Do you want to reconnect?",
    "I'm losing you a bit; should we try again?",
    "The call quality is poor; we might need to reconnect."
  ],
  agentNotUnderstood: [
    "Let me double-check that and get right back to you.",
    "I'm not certain about that—give me a second to verify.",
    "I didn't get that. Let me confirm and I'll return.",
    "I'll check on that and respond shortly.",
    "Give me a moment to verify; I'll update you."
  ],
  
  // NEW: Professional Humor & Engagement Categories - EXPANDED TO 5+ RESPONSES EACH
  lightHumor: [
    "Ha! I hear that one a lot. Let me help you out.",
    "You're not wrong there! How can I assist you today?",
    "That's a good one! Now, what can I do for you?",
    "I appreciate the humor! Let's get you taken care of.",
    "You've got a point there! What brings you in today?",
    "I like your style! How can we help you out?",
    "You're keeping it real! What's going on with your system?",
    "That made me smile! Now let's solve your problem.",
    "I hear you on that one! What can we fix for you today?"
  ],
  
  customerJoke: [
    "That's funny! You've got a good sense of humor.",
    "Haha, I like that! Now let's get you what you need.",
    "You're keeping things light - I appreciate that!",
    "That made me chuckle! How can I help you?",
    "Good one! What can I do for you today?",
    "You're cracking me up! Let's take care of your issue.",
    "I needed that laugh! Now, what's the problem we're solving?",
    "You're hilarious! How can we help you out?",
    "That's a good one! Let's get your system running smoothly."
  ],
  
  weatherSmallTalk: [
    "I hear you! Weather can definitely affect things. How can I help?",
    "Tell me about it! Speaking of comfort, what can we do for you?",
    "Absolutely! That's exactly why we're here. What's going on?",
    "I know what you mean! Let's see how we can help you out.",
    "Weather's been something else lately! What brings you in?",
    "No kidding! Makes you appreciate good HVAC, right? What's up?",
    "You're not wrong! Perfect day to get your system checked. What's the issue?",
    "I feel you on that! Good thing we can control the indoor climate. What's happening?",
    "Crazy weather we're having! How's your system handling it?"
  ],
  
  complimentResponse: [
    "Well, thank you! That's very kind of you to say.",
    "I appreciate that! Now, how can I help you today?",
    "That's so nice to hear! What can I do for you?",
    "Thank you! I'm here to help - what's going on?",
    "You're too kind! Let's get you taken care of.",
    "That really means a lot! How can we assist you?",
    "You just made my day! What brings you in?",
    "Thank you so much! What can we help you with?",
    "That's really sweet of you to say! What's the issue today?"
  ],
  
  casualGreeting: [
    "Hey there! Thanks for calling. What's up?",
    "Hi! Great to hear from you. How's your day going?",
    "Hello! Hope you're having a good one. What can I do for you?",
    "Hey! Thanks for reaching out. What brings you in today?",
    "Hi there! How can I help make your day better?",
    "Good to hear from you! What's going on with your system?",
    "Hey! Hope you're doing well. What can we fix for you?",
    "Hi! Thanks for calling in. What's the situation?",
    "Hey there! Ready to solve whatever's bugging you. What's up?"
  ],
  
  empathyResponse: [
    "I completely understand - that sounds frustrating.",
    "Oh no, I can imagine how inconvenient that must be!",
    "That's definitely not ideal - let's see what we can do.",
    "I hear you - nobody wants to deal with that.",
    "That sounds like a real headache! Let me help you out.",
    "Ugh, that's the worst! Let's get this sorted for you.",
    "I feel for you - that's so annoying when that happens.",
    "Oh man, that's really inconvenient! We'll take care of it.",
    "That's got to be stressful! Let me see how we can help."
  ]
};

// Standard personality response categories that auto-populate for new companies
const standardPersonalityCategories = [
  'lightHumor',
  'customerJoke', 
  'weatherSmallTalk',
  'complimentResponse',
  'casualGreeting',
  'empathyResponse'
];

// Initialize standard personality responses for a new company
async function initializeStandardPersonalityResponses(companyId) {
  const db = getDB();
  const personalityResponsesCollection = db.collection('personalityResponses');
  
  console.log(`[PersonalityInit] Initializing standard responses for company: ${companyId}`);
  
  const standardResponses = [];
  
  for (const category of standardPersonalityCategories) {
    if (defaultResponses[category]) {
      // Mark each response as "standard" (not custom)
      for (const response of defaultResponses[category]) {
        standardResponses.push({
          companyId: new ObjectId(companyId),
          category: category,
          response: response,
          isStandard: true, // This marks it as a default response
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }
    }
  }
  
  if (standardResponses.length > 0) {
    try {
      await personalityResponsesCollection.insertMany(standardResponses);
      console.log(`[PersonalityInit] Added ${standardResponses.length} standard responses for company ${companyId}`);
      
      // Clear cache for this company
      clearCompanyResponsesCache(companyId);
      
      return standardResponses.length;
    } catch (error) {
      console.error(`[PersonalityInit] Error initializing responses for company ${companyId}:`, error);
      return 0;
    }
  }
  
  return 0;
}

// Check if a company has personality responses, if not initialize them
async function ensurePersonalityResponsesExist(companyId) {
  const db = getDB();
  const personalityResponsesCollection = db.collection('personalityResponses');
  
  const existingCount = await personalityResponsesCollection.countDocuments({ 
    companyId: new ObjectId(companyId) 
  });
  
  if (existingCount === 0) {
    console.log(`[PersonalityInit] No responses found for company ${companyId}, initializing...`);
    return await initializeStandardPersonalityResponses(companyId);
  }
  
  return existingCount;
}

async function fetchCompanyResponses(companyId, forceRefresh = false) {
  if (!ObjectId.isValid(companyId)) return {};
  if (!forceRefresh && companyResponsesCache.has(companyId)) {
    return companyResponsesCache.get(companyId);
  }
  const db = getDB();
  if (!db) return {};
  const company = await db.collection('companiesCollection').findOne(
    { _id: new ObjectId(companyId) },
    { projection: { personalityResponses: 1 } }
  );
  const responses = company?.personalityResponses || {};
  companyResponsesCache.set(companyId, responses);
  return responses;
}

function clearCompanyResponsesCache(companyId) {
  if (companyId) companyResponsesCache.delete(companyId);
}

// Enhanced function to get personality-specific responses
async function getPersonalityResponse(companyId, category, personality = 'friendly') {
  const companyResponses = companyId ? await fetchCompanyResponses(companyId) : {};
  
  // Try personality-specific category first (e.g., 'greeting_friendly')
  const personalityCategory = `${category}_${personality}`;
  let responses = companyResponses[personalityCategory] || defaultResponses[personalityCategory];
  
  // Fallback to generic category if personality-specific doesn't exist
  if (!responses || !responses.length) {
    responses = companyResponses[category] || defaultResponses[category] || [];
  }
  
  if (!responses.length) return '';
  
  const key = `lastResp:${companyId || 'global'}:${personalityCategory}`;
  let lastIndex = parseInt(await redisClient.get(key) || '-1', 10);
  let idx = Math.floor(Math.random() * responses.length);
  if (responses.length > 1 && idx === lastIndex) {
    idx = (idx + 1) % responses.length;
  }
  await redisClient.setEx(key, 3600, String(idx));
  return responses[idx];
}

async function getRandomPersonalityResponse(companyId, category) {
  const companyResponses = companyId ? await fetchCompanyResponses(companyId) : {};
  const responses = companyResponses[category] || defaultResponses[category] || [];
  if (!responses.length) return '';
  const key = `lastResp:${companyId || 'global'}:${category}`;
  let lastIndex = parseInt(await redisClient.get(key) || '-1', 10);
  let idx = Math.floor(Math.random() * responses.length);
  if (responses.length > 1 && idx === lastIndex) {
    idx = (idx + 1) % responses.length;
  }
  await redisClient.setEx(key, 3600, String(idx));
  return responses[idx];
}

module.exports = {
  getRandomPersonalityResponse,
  getPersonalityResponse, // New enhanced function
  defaultResponses,
  fetchCompanyResponses,
  clearCompanyResponsesCache,
  initializeStandardPersonalityResponses,
  ensurePersonalityResponsesExist,
  standardPersonalityCategories
};
