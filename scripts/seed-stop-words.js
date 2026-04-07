/**
 * seed-stop-words.js — One-time migration: populate GlobalShare stop words.
 *
 * The 75 standard English stop words used to be hardcoded in utils/stopWords.js.
 * Now GlobalShare (AdminSettings) is the ONLY source.  This script seeds the
 * defaults so admin can see, edit, and remove them from the UI.
 *
 * Run on Render Shell:
 *   node scripts/seed-stop-words.js
 *
 * Safe to re-run — only writes if the current list is empty.
 */

'use strict';

const { MongoClient } = require('mongodb');

const STOP_WORDS = [
  // Pronouns
  'i', 'me', 'my', 'we', 'us', 'our',
  'you', 'your', 'he', 'him', 'his',
  'she', 'her', 'it', 'its',
  'they', 'them', 'their',
  // Articles
  'a', 'an', 'the',
  // Demonstratives
  'this', 'that', 'these', 'those',
  // Core prepositions
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'from', 'by',
  // Conjunctions
  'and', 'but', 'or', 'so', 'if', 'as', 'than',
  // Auxiliary / copula / modals
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did', 'have', 'has', 'had',
  'will', 'would', 'shall', 'should', 'may', 'might', 'can', 'could',
  // Question words
  'what', 'which', 'who', 'how', 'when', 'where', 'why',
  // Speech fillers
  'um', 'uh', 'ok', 'okay', 'yeah',
];

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db('clientsvia');
    const col = db.collection('adminsettings');

    const doc = await col.findOne({});
    if (!doc) {
      console.error('No AdminSettings document found');
      process.exit(1);
    }

    const existing = doc?.globalHub?.phraseIntelligence?.stopWords || [];
    if (existing.length > 0) {
      console.log(`Stop words already populated (${existing.length} words). No changes made.`);
      process.exit(0);
    }

    await col.updateOne(
      { _id: doc._id },
      { $set: { 'globalHub.phraseIntelligence.stopWords': STOP_WORDS } }
    );

    console.log(`Seeded ${STOP_WORDS.length} stop words into GlobalShare.`);
    console.log('Admin can now manage them from GlobalShare → Phrase Intelligence → Stop Words tab.');
  } finally {
    await client.close();
  }
})();
