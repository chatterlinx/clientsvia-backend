/**
 * ============================================================================
 * MIGRATION: Add displayId to existing triggers
 * ============================================================================
 * 
 * This script assigns sequential displayId values to all existing triggers
 * that don't have one. Uses a SINGLE GLOBAL COUNTER so IDs are unique
 * across ALL companies and groups - no collisions ever.
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

const GLOBAL_COUNTER_KEY = 'trigger_displayId_global';

async function migrate() {
  console.log('🚀 Starting displayId migration (SINGLE GLOBAL COUNTER)...\n');
  
  // Connect to MongoDB
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('❌ No MongoDB URI found in environment');
    process.exit(1);
  }
  
  await mongoose.connect(mongoUri);
  console.log('✅ Connected to MongoDB\n');
  
  // Get current counter value
  const currentSeq = await Counter.getCurrentSequence(GLOBAL_COUNTER_KEY);
  console.log(`📊 Current global counter value: ${currentSeq}\n`);
  
  // ─────────────────────────────────────────────────────────────────────────
  // COLLECT ALL TRIGGERS WITHOUT displayId
  // ─────────────────────────────────────────────────────────────────────────
  
  const localTriggers = await CompanyLocalTrigger.find({ 
    $or: [
      { displayId: { $exists: false } },
      { displayId: null }
    ],
    isDeleted: { $ne: true }
  }).sort({ createdAt: 1 }).lean();
  
  const globalTriggers = await GlobalTrigger.find({ 
    $or: [
      { displayId: { $exists: false } },
      { displayId: null }
    ],
    state: 'draft',
    isDeleted: { $ne: true }
  }).sort({ createdAt: 1 }).lean();
  
  console.log(`📋 Found ${localTriggers.length} local triggers without displayId`);
  console.log(`📋 Found ${globalTriggers.length} global triggers (draft) without displayId\n`);
  
  // ─────────────────────────────────────────────────────────────────────────
  // COMBINE AND SORT BY CREATION DATE (oldest first)
  // ─────────────────────────────────────────────────────────────────────────
  
  const allTriggers = [
    ...localTriggers.map(t => ({ ...t, _type: 'local' })),
    ...globalTriggers.map(t => ({ ...t, _type: 'global' }))
  ].sort((a, b) => {
    const dateA = a.createdAt ? new Date(a.createdAt) : new Date(0);
    const dateB = b.createdAt ? new Date(b.createdAt) : new Date(0);
    return dateA - dateB;
  });
  
  console.log(`📋 Total triggers to migrate: ${allTriggers.length}\n`);
  
  if (allTriggers.length === 0) {
    console.log('✅ No triggers need migration!\n');
    await mongoose.disconnect();
    process.exit(0);
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // ASSIGN displayId FROM SINGLE GLOBAL COUNTER
  // ─────────────────────────────────────────────────────────────────────────
  
  let localUpdated = 0;
  let globalUpdated = 0;
  
  for (const trigger of allTriggers) {
    const nextId = await Counter.getNextSequence(GLOBAL_COUNTER_KEY);
    
    if (trigger._type === 'local') {
      await CompanyLocalTrigger.updateOne(
        { _id: trigger._id },
        { $set: { displayId: nextId } }
      );
      localUpdated++;
      console.log(`   ✅ Local #${String(nextId).padStart(3, '0')}: ${trigger.ruleId} (${trigger.companyId.slice(0, 8)}...)`);
    } else {
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
      console.log(`   ✅ Global #${String(nextId).padStart(3, '0')}: ${trigger.ruleId} (group: ${trigger.groupId})`);
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────────────────────────────────
  const finalSeq = await Counter.getCurrentSequence(GLOBAL_COUNTER_KEY);
  
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('✅ Migration complete!');
  console.log(`   Local triggers updated:  ${localUpdated}`);
  console.log(`   Global triggers updated: ${globalUpdated}`);
  console.log(`   Counter before: ${currentSeq}`);
  console.log(`   Counter after:  ${finalSeq}`);
  console.log('═══════════════════════════════════════════════════════════════');
  
  await mongoose.disconnect();
  process.exit(0);
}

migrate().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
