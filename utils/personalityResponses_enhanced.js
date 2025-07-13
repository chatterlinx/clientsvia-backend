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
  
  // NEW: Professional Humor & Engagement Categories
  lightHumor: [
    "Ha! I hear that one a lot. Let me help you out.",
    "You're not wrong there! How can I assist you today?",
    "That's a good one! Now, what can I do for you?",
    "I appreciate the humor! Let's get you taken care of.",
    "You've got a point there! What brings you in today?"
  ],
  
  customerJoke: [
    "That's funny! You've got a good sense of humor.",
    "Haha, I like that! Now let's get you what you need.",
    "You're keeping things light - I appreciate that!",
    "That made me chuckle! How can I help you?",
    "Good one! What can I do for you today?"
  ],
  
  weatherSmallTalk: [
    "I hear you! Weather can definitely affect things. How can I help?",
    "Tell me about it! Speaking of comfort, what can we do for you?",
    "Absolutely! That's exactly why we're here. What's going on?",
    "I know what you mean! Let's see how we can help you out.",
    "Weather's been something else lately! What brings you in?"
  ],
  
  complimentResponse: [
    "Well, thank you! That's very kind of you to say.",
    "I appreciate that! Now, how can I help you today?",
    "That's so nice to hear! What can I do for you?",
    "Thank you! I'm here to help - what's going on?",
    "You're too kind! Let's get you taken care of."
  ],
  
  casualGreeting: [
    "Hey there! Thanks for calling. What's up?",
    "Hi! Great to hear from you. How's your day going?",
    "Hello! Hope you're having a good one. What can I do for you?",
    "Hey! Thanks for reaching out. What brings you in today?",
    "Hi there! How can I help make your day better?"
  ],
  
  empathyResponse: [
    "I completely understand - that sounds frustrating.",
    "Oh no, I can imagine how inconvenient that must be!",
    "That's definitely not ideal - let's see what we can do.",
    "I hear you - nobody wants to deal with that.",
    "That sounds like a real headache! Let me help you out."
  ]
};

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
};
