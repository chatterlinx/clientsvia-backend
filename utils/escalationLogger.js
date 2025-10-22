const { getDB } = require('../db');

async function logEscalationEvent(callSid, companyId, question) {
  try {
    const db = getDB();
    if (!db) {return;}
    const collection = db.collection('escalationLogs');
    await collection.insertOne({ callSid, companyId, question, timestamp: new Date() });
  } catch (err) {
    console.error('Error logging escalation event:', err.message);
  }
}

module.exports = { logEscalationEvent };
