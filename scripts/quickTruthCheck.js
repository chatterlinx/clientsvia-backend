/**
 * ============================================================================
 * QUICK TRUTH CHECK - Direct MongoDB Native Driver
 * ============================================================================
 * 
 * Uses MongoDB native driver (lighter than Mongoose) to quickly check where
 * the 5 fake triggers are stored.
 * 
 * USAGE:
 *   MONGODB_URI="mongodb+srv://..." node scripts/quickTruthCheck.js
 * 
 * ============================================================================
 */

'use strict';

const { MongoClient } = require('mongodb');

const PENGUIN_ID = '68e3f77a9d623b8058c700c4';
const FAKE_IDS = [
  'pricing.service_call',
  'problem.thermostat',
  'problem.not_cooling',
  'problem.system_not_running',
  'problem.water_leak'
];

async function quickCheck() {
  const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
  
  if (!MONGO_URI) {
    console.error('❌ MONGODB_URI not set');
    console.error('   Run: MONGODB_URI="mongodb+srv://..." node scripts/quickTruthCheck.js');
    process.exit(1);
  }

  console.log('Connecting...');
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  console.log('✅ Connected\n');

  const db = client.db();
  
  console.log('═'.repeat(80));
  console.log('QUICK TRUTH CHECK: Where Are The 5 Fake Triggers?');
  console.log('═'.repeat(80));
  console.log();

  let source = null;

  // ──────────────────────────────────────────────────────────────────────────
  // CHECK 1: company.aiAgentSettings.agent2.discovery.playbook.rules
  // ──────────────────────────────────────────────────────────────────────────
  console.log('CHECK 1: playbook.rules (legacy in-document array)');
  console.log('─'.repeat(80));
  
  const company = await db.collection('companies').findOne(
    { _id: PENGUIN_ID },
    { projection: { 
      businessName: 1,
      'aiAgentSettings.agent2.discovery.playbook.rules': 1 
    }}
  );
  
  if (!company) {
    console.log('❌ Company not found!');
    await client.close();
    process.exit(1);
  }
  
  const legacyRules = company?.aiAgentSettings?.agent2?.discovery?.playbook?.rules || [];
  
  console.log(`Company: ${company.businessName || PENGUIN_ID}`);
  console.log(`playbook.rules count: ${legacyRules.length}`);
  
  if (legacyRules.length > 0) {
    console.log('\nCards in playbook.rules:');
    const matches = [];
    legacyRules.forEach((card, i) => {
      const cardId = card.id || card.ruleId || 'NO_ID';
      const isFake = FAKE_IDS.includes(cardId);
      console.log(`  ${i+1}. ${cardId.padEnd(40)} ${isFake ? '🎯 MATCH!' : ''}`);
      if (isFake) matches.push(cardId);
    });
    
    if (matches.length === 5) {
      console.log(`\n✅ ALL 5 FOUND! Source: playbook.rules`);
      source = 'playbook.rules';
    } else if (matches.length > 0) {
      console.log(`\n⚠️  Partial: ${matches.length}/5 found here`);
    }
  } else {
    console.log('   Empty or doesn\'t exist');
  }
  console.log();

  // ──────────────────────────────────────────────────────────────────────────
  // CHECK 2: companyLocalTriggers collection
  // ──────────────────────────────────────────────────────────────────────────
  console.log('CHECK 2: companyLocalTriggers collection');
  console.log('─'.repeat(80));
  
  const localTriggers = await db.collection('companyLocalTriggers')
    .find({ companyId: PENGUIN_ID })
    .toArray();
  
  console.log(`Found ${localTriggers.length} local triggers`);
  
  if (localTriggers.length > 0) {
    console.log('\nLocal triggers:');
    const matches = [];
    localTriggers.forEach((t, i) => {
      const isFake = FAKE_IDS.includes(t.ruleId);
      console.log(`  ${i+1}. ${(t.ruleId || 'NO_ID').padEnd(40)} ${isFake ? '🎯 MATCH!' : ''}`);
      if (isFake) matches.push(t.ruleId);
    });
    
    if (matches.length === 5 && !source) {
      console.log(`\n✅ ALL 5 FOUND! Source: CompanyLocalTrigger`);
      source = 'CompanyLocalTrigger';
    }
  } else {
    console.log('   Collection empty');
  }
  console.log();

  // ──────────────────────────────────────────────────────────────────────────
  // CHECK 3: CompanyTriggerSettings
  // ──────────────────────────────────────────────────────────────────────────
  console.log('CHECK 3: CompanyTriggerSettings');
  console.log('─'.repeat(80));
  
  const settings = await db.collection('companyTriggerSettings')
    .findOne({ companyId: PENGUIN_ID });
  
  if (!settings) {
    console.log('❌ CompanyTriggerSettings NOT FOUND');
  } else {
    console.log('✅ CompanyTriggerSettings exists');
    console.log(`   activeGroupId: ${settings.activeGroupId || 'null ❌'}`);
    console.log(`   strictMode: ${settings.strictMode !== false ? 'true' : 'false'}`);
  }
  console.log();

  // ──────────────────────────────────────────────────────────────────────────
  // CHECK 4: GlobalTriggerGroup
  // ──────────────────────────────────────────────────────────────────────────
  console.log('CHECK 4: GlobalTriggerGroup (hvac-master-v1)');
  console.log('─'.repeat(80));
  
  const group = await db.collection('globalTriggerGroups')
    .findOne({ groupId: 'hvac-master-v1' });
  
  if (!group) {
    console.log('❌ Global group NOT FOUND');
    console.log('   Official library has never been seeded!');
  } else {
    console.log('✅ Global group exists');
    console.log(`   publishedVersion: ${group.publishedVersion}`);
    console.log(`   triggerCount: ${group.triggerCount}`);
    
    const publishedCount = await db.collection('globalTriggers')
      .countDocuments({ groupId: 'hvac-master-v1', state: 'published' });
    console.log(`   Triggers in DB: ${publishedCount}`);
  }
  console.log();

  // ──────────────────────────────────────────────────────────────────────────
  // VERDICT
  // ──────────────────────────────────────────────────────────────────────────
  console.log('═'.repeat(80));
  console.log('VERDICT');
  console.log('═'.repeat(80));
  console.log();
  
  if (source) {
    console.log(`🎯 FAKE TRIGGERS FOUND IN: ${source}`);
    console.log();
    console.log('🔧 CLEANUP COMMAND:');
    
    if (source === 'playbook.rules') {
      console.log('   db.companies.updateOne(');
      console.log(`     { _id: "${PENGUIN_ID}" },`);
      console.log('     { $set: { "aiAgentSettings.agent2.discovery.playbook.rules": [] } }');
      console.log('   )');
    } else if (source === 'CompanyLocalTrigger') {
      console.log('   db.companyLocalTriggers.deleteMany({ companyId: "' + PENGUIN_ID + '" })');
    }
    
    console.log();
    console.log('   OR run full cleanup:');
    console.log('   node scripts/nuclearCleanupTriggers.js');
  } else {
    console.log('⚠️  Fake triggers source NOT identified');
    console.log('   They may be coming from a different source or caching issue');
  }
  
  await client.close();
  console.log('\n✅ Check complete');
}

quickCheck().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
