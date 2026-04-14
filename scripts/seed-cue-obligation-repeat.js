/**
 * seed-cue-obligation-repeat.js — Add obligation + repeat/recurrence cue patterns
 *
 * Run on Render Shell:
 *   node scripts/seed-cue-obligation-repeat.js
 *
 * WHY:
 *   "how much is your service call fee" and "do I have to pay for another
 *   service call fee" share vocabulary but have completely different intents.
 *   Without obligation cues (permissionCue: "do i have to") and repeat
 *   indicators (modifierCore: "another", "again"), the CueExtractor can't
 *   differentiate them — falls through to semantic match which sees 89%
 *   similarity and routes to the wrong section.
 *
 * ADDS:
 *   permissionCue — obligation patterns ("do i have to", "will i need to")
 *   modifierCore  — repeat/recurrence ("another", "again", "still", "already")
 *   actionCore    — financial actions ("pay", "charge", "cost")
 *
 * Merges with existing cuePhrases (no duplicates). Safe to run multiple times.
 */
const { MongoClient } = require('mongodb');

const NEW_PATTERNS = [
  // ── permissionCue — obligation / duty patterns ──────────────────────────
  // "do I have to pay again?" "will I need to schedule?" "am I required to?"
  // These are structurally different from request cues ("can you", "would you")
  // and existing permission cues ("can i", "may i"). Obligation = caller asking
  // whether they MUST do something, not whether they're ALLOWED to.
  { pattern: 'do i have to',           token: 'permissionCue' },
  { pattern: 'will i have to',         token: 'permissionCue' },
  { pattern: 'am i going to have to',  token: 'permissionCue' },
  { pattern: 'will i need to',         token: 'permissionCue' },
  { pattern: 'do i need to',           token: 'permissionCue' },
  { pattern: 'am i required to',       token: 'permissionCue' },
  { pattern: 'am i supposed to',       token: 'permissionCue' },
  { pattern: 'am i expected to',       token: 'permissionCue' },
  { pattern: 'is it required',         token: 'permissionCue' },
  { pattern: 'is it mandatory',        token: 'permissionCue' },
  { pattern: 'is it necessary',        token: 'permissionCue' },
  { pattern: 'are we required',        token: 'permissionCue' },
  { pattern: 'do we have to',          token: 'permissionCue' },
  { pattern: 'do we need to',          token: 'permissionCue' },
  { pattern: 'am i gonna have to',     token: 'permissionCue' },
  { pattern: 'will there be a',        token: 'permissionCue' },

  // ── modifierCore — repeat / recurrence indicators ───────────────────────
  // "another service call" vs "a service call" — the word "another" changes
  // the entire intent from new-inquiry to repeat-visit/warranty territory.
  // These combine with other cues to create distinct signatures:
  //   ACT(pay) + TRADE(service) + MOD(another) + PERM(do i have to) = warranty
  //   ACT(service) + TRADE(service) + REQ(how much) = pricing
  { pattern: 'another',         token: 'modifierCore' },
  { pattern: 'again',           token: 'modifierCore' },
  { pattern: 'still',           token: 'modifierCore' },
  { pattern: 'same problem',    token: 'modifierCore' },
  { pattern: 'same issue',      token: 'modifierCore' },
  { pattern: 'same thing',      token: 'modifierCore' },
  { pattern: 'keep having',     token: 'modifierCore' },
  { pattern: 'keeps happening', token: 'modifierCore' },
  { pattern: 'came back',       token: 'modifierCore' },
  { pattern: 'coming back',     token: 'modifierCore' },
  { pattern: 'back again',      token: 'modifierCore' },
  { pattern: 'once more',       token: 'modifierCore' },
  { pattern: 'one more time',   token: 'modifierCore' },
  { pattern: 'already',         token: 'modifierCore' },
  { pattern: 'last time',       token: 'modifierCore' },
  { pattern: 'previously',      token: 'modifierCore' },

  // ── actionCore — financial action verbs ────────────────────────────────
  // "pay" and "charge" are actions that shift intent toward billing/warranty.
  // Without these, "do I have to pay" only gets PERM — adding ACT gives 2+ fields.
  { pattern: 'pay',      token: 'actionCore' },
  { pattern: 'charge',   token: 'actionCore' },
  { pattern: 'cost',     token: 'actionCore' },
  { pattern: 'cover',    token: 'actionCore' },
  { pattern: 'refund',   token: 'actionCore' },
  { pattern: 'reimburse', token: 'actionCore' },
  { pattern: 'bill',     token: 'actionCore' },
  { pattern: 'invoice',  token: 'actionCore' },
  { pattern: 'owe',      token: 'actionCore' },
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
    console.log(`✅ Added ${added} new patterns. Total cuePhrases: ${existing.length}`);
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

  // Show what was added
  if (added > 0) {
    console.log(`\nNew patterns added:`);
    for (const p of NEW_PATTERNS) {
      const key = `${p.pattern.toLowerCase().trim()}|${p.token}`;
      // Check if this one was newly added (not in original set)
      console.log(`  ${p.token}: "${p.pattern}"`);
    }
  }

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
