const { getDB } = require('../db');
const { ObjectId } = require('mongodb');
const { redisClient } = require('../clients');

// In-memory cache so each company\'s responses are only loaded once per session
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
    "That’s outside what we typically handle, but I can find out who does.",
    "Let me connect you with the right person for that question.",
    "I’m not sure about that, but someone else can assist you.",
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
    "If you’d like, I can pencil you in and you can confirm later—no obligation.",
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
    "I’m sorry for the trouble. Let’s see how we can fix this.",
    "I understand this is frustrating. I’m here to help.",
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
    "I’m having trouble hearing you. Let’s try again or I can call back.",
    "Seems the connection isn't great. Do you want to reconnect?",
    "I’m losing you a bit; should we try again?",
    "The call quality is poor; we might need to reconnect."
  ],
  agentNotUnderstood: [
    "Let me double-check that and get right back to you.",
    "I’m not certain about that—give me a second to verify.",
    "I didn't get that. Let me confirm and I'll return.",
    "I'll check on that and respond shortly.",
    "Give me a moment to verify; I'll update you."
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
  defaultResponses,
  fetchCompanyResponses,
  clearCompanyResponsesCache,
};
