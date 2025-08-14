const twilio = require('twilio');
const logger = require('../utils/logger');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const fromNumber = process.env.TWILIO_NOTIFY_FROM || process.env.TWILIO_CALLER_ID;

async function notifyTargets(targets, payload) {
  // payload: { type, to, from, companyName }
  const msg = buildMessage(payload);
  const tasks = (targets || []).map(t => {
    if (!Array.isArray(t.types) || !t.types.includes(payload.type)) return null;
    return client.messages.create({
      to: t.phone,
      from: fromNumber,
      body: msg,
    }).catch(err => logger.warn('notify sms failed', { err }));
  }).filter(Boolean);
  await Promise.allSettled(tasks);
}

function buildMessage(p = {}) {
  if (p.type === 'transfer') {
    return `[${p.companyName}] Transfer initiated to ${p.to}. Caller: ${p.from || 'unknown'}.`;
  }
  // extend for voicemail/callback later
  return `[${p.companyName}] Event: ${p.type || 'update'}.`;
}

module.exports = { notifyTargets };
