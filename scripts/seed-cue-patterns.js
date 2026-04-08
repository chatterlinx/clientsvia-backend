/**
 * seed-cue-patterns.js — Seed actionCore, urgencyCore, modifierCore patterns
 *
 * Run on Render Shell:
 *   node scripts/seed-cue-patterns.js
 *
 * Merges new patterns into existing cuePhrases (no duplicates).
 * Safe to run multiple times.
 */
const { MongoClient } = require('mongodb');

const NEW_PATTERNS = [
  // ── actionCore — universal action verbs ────────────────────────────────
  { pattern: 'schedule', token: 'actionCore' },
  { pattern: 'book', token: 'actionCore' },
  { pattern: 'fix', token: 'actionCore' },
  { pattern: 'repair', token: 'actionCore' },
  { pattern: 'clean', token: 'actionCore' },
  { pattern: 'replace', token: 'actionCore' },
  { pattern: 'check', token: 'actionCore' },
  { pattern: 'inspect', token: 'actionCore' },
  { pattern: 'install', token: 'actionCore' },
  { pattern: 'service', token: 'actionCore' },
  { pattern: 'diagnose', token: 'actionCore' },
  { pattern: 'set up', token: 'actionCore' },
  { pattern: 'send someone', token: 'actionCore' },
  { pattern: 'come out', token: 'actionCore' },
  { pattern: 'look at', token: 'actionCore' },
  { pattern: 'get checked', token: 'actionCore' },
  { pattern: 'get fixed', token: 'actionCore' },
  { pattern: 'tune up', token: 'actionCore' },
  { pattern: 'flush', token: 'actionCore' },
  { pattern: 'maintain', token: 'actionCore' },
  { pattern: 'remove', token: 'actionCore' },
  { pattern: 'upgrade', token: 'actionCore' },
  { pattern: 'hook up', token: 'actionCore' },
  { pattern: 'unclog', token: 'actionCore' },
  { pattern: 'estimate', token: 'actionCore' },

  // ── urgencyCore — universal urgency signals ────────────────────────────
  { pattern: 'today', token: 'urgencyCore' },
  { pattern: 'right now', token: 'urgencyCore' },
  { pattern: 'right away', token: 'urgencyCore' },
  { pattern: 'as soon as possible', token: 'urgencyCore' },
  { pattern: 'asap', token: 'urgencyCore' },
  { pattern: 'immediately', token: 'urgencyCore' },
  { pattern: 'urgent', token: 'urgencyCore' },
  { pattern: 'emergency', token: 'urgencyCore' },
  { pattern: 'this morning', token: 'urgencyCore' },
  { pattern: 'this afternoon', token: 'urgencyCore' },
  { pattern: 'tonight', token: 'urgencyCore' },
  { pattern: 'first thing', token: 'urgencyCore' },
  { pattern: 'before the weekend', token: 'urgencyCore' },
  { pattern: 'end of day', token: 'urgencyCore' },
  { pattern: 'same day', token: 'urgencyCore' },

  // ── modifierCore — universal time/scheduling patterns ──────────────────
  { pattern: 'next week', token: 'modifierCore' },
  { pattern: 'tomorrow', token: 'modifierCore' },
  { pattern: 'tomorrow morning', token: 'modifierCore' },
  { pattern: 'tomorrow afternoon', token: 'modifierCore' },
  { pattern: 'this week', token: 'modifierCore' },
  { pattern: 'this weekend', token: 'modifierCore' },
  { pattern: 'next month', token: 'modifierCore' },
  { pattern: 'after hours', token: 'modifierCore' },
  { pattern: 'in the morning', token: 'modifierCore' },
  { pattern: 'in the afternoon', token: 'modifierCore' },
  { pattern: 'in the evening', token: 'modifierCore' },
  { pattern: 'early morning', token: 'modifierCore' },
  { pattern: 'end of the month', token: 'modifierCore' },
  { pattern: 'within the hour', token: 'modifierCore' },
  { pattern: 'next friday', token: 'modifierCore' },
];

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

  const client = await MongoClient.connect(uri);
  const db = client.db('clientsvia');
  const col = db.collection('adminsettings');

  // Load current settings
  const doc = await col.findOne({});
  if (!doc) { console.error('No adminsettings doc found'); process.exit(1); }

  const pi = doc.globalHub?.phraseIntelligence || {};
  const existing = pi.cuePhrases || [];
  const existingSet = new Set(existing.map(c => `${c.pattern.toLowerCase().trim()}|${c.token}`));

  let added = 0;
  for (const p of NEW_PATTERNS) {
    const key = `${p.pattern.toLowerCase().trim()}|${p.token}`;
    if (!existingSet.has(key)) {
      existing.push(p);
      existingSet.add(key);
      added++;
    }
  }

  if (added === 0) {
    console.log('All patterns already exist. Nothing to add.');
  } else {
    await col.updateOne(
      { _id: doc._id },
      { $set: { 'globalHub.phraseIntelligence.cuePhrases': existing } }
    );
    console.log(`Added ${added} new patterns. Total cuePhrases: ${existing.length}`);
  }

  // Summary
  const counts = {};
  for (const c of existing) {
    counts[c.token] = (counts[c.token] || 0) + 1;
  }
  console.log('\nCue phrase counts by type:');
  for (const [type, count] of Object.entries(counts).sort()) {
    console.log(`  ${type}: ${count}`);
  }

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
