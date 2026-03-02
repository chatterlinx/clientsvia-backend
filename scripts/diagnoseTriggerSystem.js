/**
 * ============================================================================
 * TRIGGER SYSTEM DIAGNOSTIC SCRIPT
 * ============================================================================
 * 
 * Quickly diagnoses why only 5 triggers are loading instead of 43.
 * 
 * USAGE:
 *   node scripts/diagnoseTriggerSystem.js
 * 
 * OUTPUTS:
 *   - Whether GlobalTriggerGroup exists
 *   - Whether GlobalTriggers are seeded
 *   - Whether companies have activeGroupId set
 *   - Specific diagnosis and remediation steps
 * 
 * ============================================================================
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const mongoose = require('mongoose');

const GlobalTriggerGroup = require('../models/GlobalTriggerGroup');
const GlobalTrigger = require('../models/GlobalTrigger');
const CompanyTriggerSettings = require('../models/CompanyTriggerSettings');
const Company = require('../models/v2Company');

const GROUP_ID = 'hvac-master-v1';
const PENGUIN_AIR_ID = '68e3f77a9d623b8058c700c4';

async function diagnose() {
  const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGODB_CONNECTION_STRING;
  
  if (!MONGO_URI) {
    console.error('❌ MONGODB_URI not set in environment');
    console.error('   Set it in .env or run: MONGODB_URI=mongodb+srv://... node scripts/diagnoseTriggerSystem.js');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log('✅ Connected\n');

  console.log('═'.repeat(80));
  console.log('TRIGGER SYSTEM DIAGNOSTIC REPORT');
  console.log('═'.repeat(80));
  console.log();

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Check GlobalTriggerGroup
  // ──────────────────────────────────────────────────────────────────────────
  console.log('1️⃣  GLOBAL TRIGGER GROUP');
  console.log('─'.repeat(80));
  
  const group = await GlobalTriggerGroup.findOne({ groupId: GROUP_ID });
  
  if (!group) {
    console.log('❌ GlobalTriggerGroup NOT FOUND');
    console.log(`   groupId: "${GROUP_ID}" does not exist`);
    console.log();
    console.log('📋 DIAGNOSIS: Global library has never been seeded');
    console.log('🔧 REMEDIATION: Run: node scripts/seedTriggerGroupV1.js');
    console.log();
  } else {
    console.log('✅ GlobalTriggerGroup EXISTS');
    console.log(`   groupId: ${group.groupId}`);
    console.log(`   name: ${group.name}`);
    console.log(`   publishedVersion: ${group.publishedVersion}`);
    console.log(`   isDraft: ${group.isDraft}`);
    console.log(`   triggerCount: ${group.triggerCount}`);
    console.log(`   createdAt: ${group.createdAt}`);
    console.log();
    
    if (group.publishedVersion === 0) {
      console.log('⚠️  WARNING: Group exists but is NOT PUBLISHED');
      console.log('   publishedVersion = 0 means triggers will NOT load at runtime');
      console.log();
      console.log('📋 DIAGNOSIS: Group is in draft mode');
      console.log('🔧 REMEDIATION: Publish the group via admin UI or run:');
      console.log('   db.globalTriggerGroups.updateOne(');
      console.log(`     { groupId: "${GROUP_ID}" },`);
      console.log('     { $set: { publishedVersion: 1, isDraft: false } }');
      console.log('   )');
      console.log();
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Check GlobalTrigger documents
  // ──────────────────────────────────────────────────────────────────────────
  console.log('2️⃣  GLOBAL TRIGGERS');
  console.log('─'.repeat(80));
  
  const publishedCount = await GlobalTrigger.countDocuments({
    groupId: GROUP_ID,
    state: 'published'
  });
  
  const draftCount = await GlobalTrigger.countDocuments({
    groupId: GROUP_ID,
    state: 'draft'
  });
  
  console.log(`Published triggers: ${publishedCount}`);
  console.log(`Draft triggers: ${draftCount}`);
  console.log();
  
  if (publishedCount === 0) {
    console.log('❌ NO PUBLISHED TRIGGERS FOUND');
    console.log('   Expected: 43 triggers from HVAC Master V1 library');
    console.log();
    
    if (draftCount > 0) {
      console.log('📋 DIAGNOSIS: Triggers exist but only in draft state');
      console.log('🔧 REMEDIATION: Publish the group (see step 1)');
    } else {
      console.log('📋 DIAGNOSIS: No triggers have been seeded');
      console.log('🔧 REMEDIATION: Run: node scripts/seedTriggerGroupV1.js');
    }
    console.log();
  } else {
    console.log(`✅ ${publishedCount} triggers are published and ready to use`);
    console.log();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Check Penguin Air CompanyTriggerSettings
  // ──────────────────────────────────────────────────────────────────────────
  console.log('3️⃣  PENGUIN AIR CONFIGURATION');
  console.log('─'.repeat(80));
  
  const penguinSettings = await CompanyTriggerSettings.findOne({
    companyId: PENGUIN_AIR_ID
  });
  
  if (!penguinSettings) {
    console.log('❌ CompanyTriggerSettings NOT FOUND for Penguin Air');
    console.log('   Creating with default settings...');
    console.log();
    console.log('📋 DIAGNOSIS: Settings document missing');
    console.log('🔧 REMEDIATION: Assign group to company (see step 4)');
    console.log();
  } else {
    console.log('✅ CompanyTriggerSettings EXISTS');
    console.log(`   companyId: ${penguinSettings.companyId}`);
    console.log(`   activeGroupId: ${penguinSettings.activeGroupId || 'NOT SET ❌'}`);
    console.log(`   strictMode: ${penguinSettings.strictMode}`);
    console.log(`   disabledTriggerIds: ${penguinSettings.disabledGlobalTriggerIds?.length || 0}`);
    console.log();
    
    if (!penguinSettings.activeGroupId) {
      console.log('❌ NO ACTIVE GROUP ASSIGNED');
      console.log('   This is why only 5 local triggers are loading!');
      console.log();
      console.log('📋 DIAGNOSIS: Company has no trigger group assigned');
      console.log('🔧 REMEDIATION: Run assignment script (see step 4)');
      console.log();
    } else if (penguinSettings.activeGroupId !== GROUP_ID) {
      console.log(`⚠️  WARNING: Different group assigned: ${penguinSettings.activeGroupId}`);
      console.log(`   Expected: ${GROUP_ID}`);
      console.log();
    } else {
      console.log(`✅ Correct group assigned: ${penguinSettings.activeGroupId}`);
      console.log();
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Check ALL companies
  // ──────────────────────────────────────────────────────────────────────────
  console.log('4️⃣  ALL COMPANIES');
  console.log('─'.repeat(80));
  
  const totalCompanies = await Company.countDocuments({});
  const companiesWithGroups = await CompanyTriggerSettings.countDocuments({
    activeGroupId: { $exists: true, $ne: null }
  });
  
  console.log(`Total companies: ${totalCompanies}`);
  console.log(`Companies with activeGroupId: ${companiesWithGroups}`);
  console.log(`Companies WITHOUT activeGroupId: ${totalCompanies - companiesWithGroups} ❌`);
  console.log();
  
  if (companiesWithGroups === 0) {
    console.log('❌ NO COMPANIES have trigger groups assigned!');
    console.log();
    console.log('📋 DIAGNOSIS: Bulk assignment never performed');
    console.log('🔧 REMEDIATION: Run bulk assignment script (see step 4)');
    console.log();
  } else if (companiesWithGroups < totalCompanies) {
    console.log(`⚠️  WARNING: ${totalCompanies - companiesWithGroups} companies still need assignment`);
    console.log();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // FINAL SUMMARY & REMEDIATION
  // ──────────────────────────────────────────────────────────────────────────
  console.log('═'.repeat(80));
  console.log('REMEDIATION STEPS');
  console.log('═'.repeat(80));
  console.log();
  
  const hasGroup = !!group;
  const isPublished = group && group.publishedVersion > 0;
  const hasT riggers = publishedCount > 0;
  const penguinHasGroup = penguinSettings && penguinSettings.activeGroupId;
  
  if (!hasGroup || !hasPublishedTriggers) {
    console.log('🔧 STEP 1: Seed the global trigger library');
    console.log('   node scripts/seedTriggerGroupV1.js');
    console.log();
  }
  
  if (hasGroup && !isPublished) {
    console.log('🔧 STEP 2: Publish the trigger group');
    console.log('   Use admin UI or run MongoDB update');
    console.log();
  }
  
  if (hasGroup && isPublished && !penguinHasGroup) {
    console.log('🔧 STEP 3: Assign group to Penguin Air');
    console.log('   const CompanyTriggerSettings = require("./models/CompanyTriggerSettings");');
    console.log('   await CompanyTriggerSettings.setActiveGroup(');
    console.log(`     "${PENGUIN_AIR_ID}",`);
    console.log(`     "${GROUP_ID}",`);
    console.log('     1,');
    console.log('     "admin"');
    console.log('   );');
    console.log();
  }
  
  if (hasGroup && isPublished && companiesWithGroups < totalCompanies) {
    console.log('🔧 STEP 4: Bulk assign to all companies');
    console.log('   See: scripts/bulkAssignTriggers.js (create if needed)');
    console.log();
  }
  
  if (hasGroup && isPublished && penguinHasGroup) {
    console.log('✅ SYSTEM IS CONFIGURED CORRECTLY!');
    console.log();
    console.log('If triggers still aren\'t loading:');
    console.log('1. Clear cache: TriggerService.invalidateAllCache()');
    console.log('2. Make a test call');
    console.log('3. Check Call Console → TRIGGER_POOL_SOURCE event');
    console.log('   Should show: total: 43+, scopes: { GLOBAL: 43, LOCAL: X }');
    console.log();
  }
  
  await mongoose.disconnect();
  console.log('✅ Diagnostic complete');
}

diagnose().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
