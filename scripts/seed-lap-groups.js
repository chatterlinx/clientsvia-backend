'use strict';

/**
 * ============================================================================
 * RENDER SHELL SEED — LAP Keyword Groups (3 system defaults)
 * ============================================================================
 *
 * Writes the 3 default LAP (ListenerActParser) system groups into
 * AdminSettings.globalHub.lapGroups and syncs them to Redis.
 *
 * Uses raw `mongodb` driver (no mongoose, no dotenv) — runs cleanly in
 * the Render Shell where MONGODB_URI + REDIS_URL are already set.
 *
 * Usage — paste into Render Shell:
 *   node scripts/seed-lap-groups.js
 *
 * Idempotent — safe to re-run. Replaces existing lapGroups with these 3.
 *
 * ============================================================================
 */

const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is not set. Run this in the Render Shell.');
  process.exit(1);
}

// ── 3 system LAP groups ──────────────────────────────────────────────────────

const LAP_GROUPS = [
  {
    id:   'connection_distress',
    name: 'Connection Distress',
    action: 'respond',
    systemKeywords: [
      'are you there', 'can you hear me',
      'anyone there', 'hello hello', 'is anyone there', 'testing testing',
      'can you hear me now', 'hello are you there'
    ],
    defaultClosedQuestion: "Yes, I'm right here — can you hear me okay?",
    defaultHoldConfig: null,
  },
  {
    id:   'hold_request',
    name: 'Hold Request',
    action: 'hold',
    systemKeywords: [
      'wait', 'hold on', 'one second', 'one sec', 'hold please',
      'hold up', 'just a minute', 'hold for a second', 'wait a second',
      'give me a moment', 'just a sec', 'bear with me', 'hang on'
    ],
    defaultClosedQuestion: "Of course — take your time. Ready when you are.",
    defaultHoldConfig: {
      maxHoldSeconds:      30,
      deadAirCheckSeconds: 8,
      deadAirPrompt:       "Do you need more time or should we continue?",
      resumeKeywords:      [
        'ready', 'ok', 'continue', 'go ahead', "i'm back",
        "let's go", 'yes', 'sure', 'done', 'back'
      ],
    },
  },
  {
    id:   'repeat_request',
    name: 'Repeat Request',
    action: 'repeat_last',
    systemKeywords: [
      'repeat that',
      'what did you say', 'pardon', 'what was that', 'could you repeat',
      'say again', 'excuse me', 'i didn\'t catch that', 'i didn\'t hear you',
      'can you repeat', 'what was the question'
    ],
    defaultClosedQuestion: null,   // null = repeat_last reads lastResponse
    defaultHoldConfig: null,
  },
];

// ── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('🎧 Seeding LAP groups into AdminSettings.globalHub.lapGroups...\n');

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db   = client.db('clientsvia');
    const coll = db.collection('adminsettings');

    // Upsert: set lapGroups on the single AdminSettings document
    const result = await coll.findOneAndUpdate(
      {},
      {
        $set: {
          'globalHub.lapGroups':          LAP_GROUPS,
          'globalHub.lapGroupsUpdatedAt': new Date(),
          'globalHub.lapGroupsUpdatedBy': 'seed-lap-groups.js',
        }
      },
      { upsert: true, returnDocument: 'after' }
    );

    const saved = result?.value ?? result;
    const count = saved?.globalHub?.lapGroups?.length ?? LAP_GROUPS.length;

    console.log(`✅ AdminSettings updated — ${count} LAP groups saved`);
    LAP_GROUPS.forEach(g => {
      console.log(`   • ${g.id} (${g.action}) — ${g.systemKeywords.length} keywords`);
    });

    // ── Sync to Redis (optional but recommended) ───────────────────────────
    const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_TLS_URL;
    if (REDIS_URL) {
      try {
        const { createClient } = require('redis');
        const redis = createClient({ url: REDIS_URL });
        await redis.connect();
        await redis.set('globalHub:lapGroups', JSON.stringify(LAP_GROUPS));
        await redis.quit();
        console.log('\n✅ Redis synced — globalHub:lapGroups updated');
      } catch (redisErr) {
        console.warn('\n⚠️  Redis sync skipped (will populate on next GET):', redisErr.message);
      }
    } else {
      console.log('\n⚠️  REDIS_URL not set — Redis sync skipped (will populate on first GET)');
    }

    console.log('\n🎉 Done! LAP is ready.');
    console.log('   Next: open GlobalShare → LAP Keyword Groups to verify keywords.');
    console.log('   Next: open UAP → 🎧 LAP tab to configure per-company responses.');

  } catch (err) {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

run();
