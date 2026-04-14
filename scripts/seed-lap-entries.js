'use strict';

/**
 * ============================================================================
 * RENDER SHELL SEED — LAP Entries (Phrase-Response Table)
 * ============================================================================
 *
 * Writes LAP phrase-response entries into AdminSettings.globalHub.lapEntries
 * and syncs them to Redis.
 *
 * Each entry = one phrase + 1-3 response texts (rotated randomly at runtime).
 * Three categories: hold requests, connection distress, repeat requests.
 *
 * Uses raw `mongodb` driver (no mongoose, no dotenv) — runs cleanly in
 * the Render Shell where MONGODB_URI + REDIS_URL are already set.
 *
 * Usage — paste into Render Shell:
 *   node scripts/seed-lap-entries.js
 *
 * Idempotent — safe to re-run. Replaces existing lapEntries with these.
 *
 * ============================================================================
 */

const { MongoClient } = require('mongodb');
const crypto = require('crypto');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI is not set. Run this in the Render Shell.');
  process.exit(1);
}

function uuid() { return crypto.randomUUID(); }

// ── LAP Entries ──────────────────────────────────────────────────────────────

const LAP_ENTRIES = [
  // ── Hold Request phrases ──────────────────────────────────────────────────
  {
    id: uuid(), phrase: 'hold on', action: 'hold', sortOrder: 0, enabled: true,
    responses: [
      "Of course, take your time.",
      "Sure thing, I'll be right here.",
      "No problem, whenever you're ready.",
    ],
    holdConfig: { maxHoldSeconds: 60, deadAirCheckSeconds: 15, deadAirPrompt: "Are you still there?", resumeKeywords: ['ok','back','ready','yes',"i'm here",'continue','go ahead'] },
  },
  {
    id: uuid(), phrase: 'wait', action: 'hold', sortOrder: 1, enabled: true,
    responses: [
      "Sure, take your time.",
      "Of course, I'll wait.",
    ],
    holdConfig: { maxHoldSeconds: 60, deadAirCheckSeconds: 15, deadAirPrompt: "Still there?", resumeKeywords: ['ok','back','ready','yes',"i'm here",'continue'] },
  },
  {
    id: uuid(), phrase: 'wait a minute', action: 'hold', sortOrder: 2, enabled: true,
    responses: [
      "Absolutely, take as long as you need.",
      "No rush at all, I'll be here.",
    ],
    holdConfig: { maxHoldSeconds: 90, deadAirCheckSeconds: 20, deadAirPrompt: "Take your time — are you still there?", resumeKeywords: ['ok','back','ready','yes',"i'm here",'continue'] },
  },
  {
    id: uuid(), phrase: 'give me a second', action: 'hold', sortOrder: 3, enabled: true,
    responses: [
      "Of course, take your time.",
      "Sure, I'll wait.",
    ],
    holdConfig: { maxHoldSeconds: 60, deadAirCheckSeconds: 15, deadAirPrompt: "Are you still there?", resumeKeywords: ['ok','back','ready','yes',"i'm here"] },
  },
  {
    id: uuid(), phrase: 'one moment', action: 'hold', sortOrder: 4, enabled: true,
    responses: [
      "Sure thing, take your time.",
      "Of course, I'm right here.",
    ],
    holdConfig: { maxHoldSeconds: 60, deadAirCheckSeconds: 15, deadAirPrompt: "Still with me?", resumeKeywords: ['ok','back','ready','yes',"i'm here"] },
  },
  {
    id: uuid(), phrase: 'hang on', action: 'hold', sortOrder: 5, enabled: true,
    responses: [
      "No problem, take your time.",
      "Sure, I'll be right here.",
    ],
    holdConfig: { maxHoldSeconds: 60, deadAirCheckSeconds: 15, deadAirPrompt: "Are you still there?", resumeKeywords: ['ok','back','ready','yes',"i'm here",'continue'] },
  },
  {
    id: uuid(), phrase: 'one second', action: 'hold', sortOrder: 6, enabled: true,
    responses: [
      "Sure thing.",
      "Of course, no rush.",
    ],
    holdConfig: { maxHoldSeconds: 60, deadAirCheckSeconds: 15, deadAirPrompt: "Take your time — are you still there?", resumeKeywords: ['ok','back','ready','yes',"i'm here"] },
  },

  // ── Connection Distress phrases ───────────────────────────────────────────
  {
    id: uuid(), phrase: 'are you there', action: 'respond', sortOrder: 7, enabled: true,
    responses: [
      "Yes, I'm right here. How can I help?",
      "I'm here! What can I do for you?",
      "Absolutely, I'm listening. Go ahead.",
    ],
    holdConfig: null,
  },
  {
    id: uuid(), phrase: 'can you hear me', action: 'respond', sortOrder: 8, enabled: true,
    responses: [
      "Yes, I can hear you perfectly. Go ahead.",
      "Loud and clear! How can I help?",
      "I can hear you just fine. What do you need?",
    ],
    holdConfig: null,
  },
  {
    id: uuid(), phrase: 'hello', action: 'respond', sortOrder: 9, enabled: true,
    responses: [
      "Hi there! I'm here. How can I help you?",
      "Hello! Yes, I'm right here. What can I do for you?",
    ],
    holdConfig: null,
  },

  // ── Repeat Request phrases ────────────────────────────────────────────────
  {
    id: uuid(), phrase: 'what did you say', action: 'repeat_last', sortOrder: 10, enabled: true,
    responses: [],  // empty = repeat_last action reads lastResponse
    holdConfig: null,
  },
  {
    id: uuid(), phrase: 'come again', action: 'repeat_last', sortOrder: 11, enabled: true,
    responses: [],
    holdConfig: null,
  },
  {
    id: uuid(), phrase: 'repeat that', action: 'repeat_last', sortOrder: 12, enabled: true,
    responses: [],
    holdConfig: null,
  },
  {
    id: uuid(), phrase: 'say that again', action: 'repeat_last', sortOrder: 13, enabled: true,
    responses: [],
    holdConfig: null,
  },
  {
    id: uuid(), phrase: 'what was that', action: 'repeat_last', sortOrder: 14, enabled: true,
    responses: [],
    holdConfig: null,
  },
];

// ── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('Seeding LAP entries into AdminSettings.globalHub.lapEntries...\n');

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db   = client.db('clientsvia');
    const coll = db.collection('adminsettings');

    const result = await coll.findOneAndUpdate(
      {},
      {
        $set: {
          'globalHub.lapEntries':          LAP_ENTRIES,
          'globalHub.lapEntriesUpdatedAt': new Date(),
          'globalHub.lapEntriesUpdatedBy': 'seed-lap-entries.js',
        }
      },
      { upsert: true, returnDocument: 'after' }
    );

    const saved = result?.value ?? result;
    const count = saved?.globalHub?.lapEntries?.length ?? LAP_ENTRIES.length;

    console.log(`AdminSettings updated — ${count} LAP entries saved`);
    LAP_ENTRIES.forEach(e => {
      console.log(`   [${e.action.padEnd(11)}] "${e.phrase}" — ${e.responses.length} responses`);
    });

    // ── Sync to Redis ─────────────────────────────────────────────────────
    const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_TLS_URL;
    if (REDIS_URL) {
      try {
        const { createClient } = require('redis');
        const redis = createClient({ url: REDIS_URL });
        await redis.connect();
        await redis.set('globalHub:lapEntries', JSON.stringify(LAP_ENTRIES));
        await redis.quit();
        console.log('\nRedis synced — globalHub:lapEntries updated');
      } catch (redisErr) {
        console.warn('\nRedis sync skipped:', redisErr.message);
      }
    } else {
      console.log('\nREDIS_URL not set — Redis sync skipped');
    }

    console.log('\nDone! LAP entries are ready.');
    console.log('   Next: open Agent Console → LAP to see the phrase-response table.');

  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

run();
