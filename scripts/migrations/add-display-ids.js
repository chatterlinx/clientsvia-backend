/**
 * ============================================================================
 * MIGRATION: Add displayId to existing triggers
 * ============================================================================
 * 
 * This script assigns sequential displayId values to all existing triggers
 * that don't have one. Run once after deploying the displayId feature.
 * 
 * Usage: node scripts/migrations/add-display-ids.js
 * 
 * ============================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');
const CompanyLocalTrigger = require('../../models/CompanyLocalTrigger');
const GlobalTrigger = require('../../models/GlobalTrigger');
const Counter = require('../../models/Counter');

async function migrate() {
  console.log('🚀 Starting displayId migration...\n');
  
  // Connect to MongoDB
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('❌ No MongoDB URI found in environment');
    process.exit(1);
  }
  
  await mongoose.connect(mongoUri);
  console.log('✅ Connected to MongoDB\n');
  
  // ─────────────────────────────────────────────────────────────────────────
  // MIGRATE LOCAL TRIGGERS (per company)
  // ─────────────────────────────────────────────────────────────────────────
  console.log('📋 Migrating CompanyLocalTrigger displayIds...');
  
  const localTriggers = await CompanyLocalTrigger.find({ 
    displayId: { $exists: false },
    isDeleted: { $ne: true }
  }).sort({ createdAt: 1 });
  
  console.log(`   Found ${localTriggers.length} local triggers without displayId`);
  
  // Group by companyId
  const byCompany = {};
  for (const trigger of localTriggers) {
    if (!byCompany[trigger.companyId]) {
      byCompany[trigger.companyId] = [];
    }
    byCompany[trigger.companyId].push(trigger);
  }
  
  let localUpdated = 0;
  for (const [companyId, triggers] of Object.entries(byCompany)) {
    const counterKey = `trigger_displayId_${companyId}`;
    
    for (const trigger of triggers) {
      const nextId = await Counter.getNextSequence(counterKey);
      await CompanyLocalTrigger.updateOne(
        { _id: trigger._id },
        { $set: { displayId: nextId } }
      );
      localUpdated++;
    }
    
    console.log(`   ✅ Company ${companyId}: assigned ${triggers.length} displayIds`);
  }
  
  console.log(`\n   Total local triggers updated: ${localUpdated}\n`);
  
  // ─────────────────────────────────────────────────────────────────────────
  // MIGRATE GLOBAL TRIGGERS (per group, draft state only)
  // ─────────────────────────────────────────────────────────────────────────
  console.log('📋 Migrating GlobalTrigger displayIds...');
  
  const globalTriggers = await GlobalTrigger.find({ 
    displayId: { $exists: false },
    state: 'draft',
    isDeleted: { $ne: true }
  }).sort({ createdAt: 1 });
  
  console.log(`   Found ${globalTriggers.length} global triggers (draft) without displayId`);
  
  // Group by groupId
  const byGroup = {};
  for (const trigger of globalTriggers) {
    if (!byGroup[trigger.groupId]) {
      byGroup[trigger.groupId] = [];
    }
    byGroup[trigger.groupId].push(trigger);
  }
  
  let globalUpdated = 0;
  for (const [groupId, triggers] of Object.entries(byGroup)) {
    const counterKey = `trigger_displayId_global_${groupId}`;
    
    for (const trigger of triggers) {
      const nextId = await Counter.getNextSequence(counterKey);
      
      // Update draft
      await GlobalTrigger.updateOne(
        { _id: trigger._id },
        { $set: { displayId: nextId } }
      );
      
      // Also update corresponding published version if exists
      await GlobalTrigger.updateOne(
        { groupId: trigger.groupId, ruleId: trigger.ruleId, state: 'published' },
        { $set: { displayId: nextId } }
      );
      
      globalUpdated++;
    }
    
    console.log(`   ✅ Group ${groupId}: assigned ${triggers.length} displayIds`);
  }
  
  console.log(`\n   Total global triggers updated: ${globalUpdated}\n`);
  
  // ─────────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('✅ Migration complete!');
  console.log(`   Local triggers: ${localUpdated}`);
  console.log(`   Global triggers: ${globalUpdated}`);
  console.log('═══════════════════════════════════════════════════════════════');
  
  await mongoose.disconnect();
  process.exit(0);
}

migrate().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
