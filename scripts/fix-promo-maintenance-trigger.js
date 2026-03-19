/**
 * One-time migration: fix promo.maintenance_39 booking trigger
 *
 * Changes:
 *   behavior:         REDIRECT → INFO
 *   answerText:       remove "switching you over" redirect language
 *   followUpQuestion: add return-to-booking prompt (123RP)
 *   audioUrl:         cleared (stale cache from old answerText — will regen on next admin save)
 *
 * Run on Render shell: node scripts/fix-promo-maintenance-trigger.js
 */

'use strict';

const { MongoClient } = require('mongodb');

const COMPANY_ID = '68e3f77a9d623b8058c700c4'; // Penguin Air
const RULE_ID    = 'promo.maintenance_39';

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

  const client = new MongoClient(uri);
  await client.connect();
  console.log('Connected to MongoDB');

  const col = client.db('clientsvia').collection('companyBookingTriggers');

  // Show current state
  const before = await col.findOne({ companyId: COMPANY_ID, ruleId: RULE_ID });
  if (!before) {
    console.error(`Trigger not found: companyId=${COMPANY_ID} ruleId=${RULE_ID}`);
    await client.close();
    process.exit(1);
  }
  console.log('\nBEFORE:');
  console.log('  behavior:        ', before.behavior);
  console.log('  answerText:      ', before.answerText);
  console.log('  followUpQuestion:', before.followUpQuestion || '(none)');
  console.log('  audioUrl:        ', before.audioUrl ? '[cached]' : '(none)');

  // Apply the fix
  const result = await col.updateOne(
    { companyId: COMPANY_ID, ruleId: RULE_ID },
    {
      $set: {
        behavior:         'INFO',
        answerText:       'Great news — our $39 maintenance special is running this week!',
        followUpQuestion: 'Shall we get back to getting that scheduled for you?',
        audioUrl:         null,   // clear stale pre-cached audio; regen on next admin save
        updatedAt:        new Date(),
        updatedBy:        'migration:fix-promo-maintenance-trigger'
      }
    }
  );

  console.log('\nResult: matched', result.matchedCount, '| modified', result.modifiedCount);

  // Verify
  const after = await col.findOne({ companyId: COMPANY_ID, ruleId: RULE_ID });
  console.log('\nAFTER:');
  console.log('  behavior:        ', after.behavior);
  console.log('  answerText:      ', after.answerText);
  console.log('  followUpQuestion:', after.followUpQuestion);
  console.log('  audioUrl:        ', after.audioUrl || '(cleared)');

  await client.close();
  console.log('\nDone. Trigger cache will self-expire within 60s.');
})().catch(e => { console.error(e); process.exit(1); });
