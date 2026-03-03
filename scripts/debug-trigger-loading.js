#!/usr/bin/env node
/**
 * DEBUG SCRIPT: Trigger Loading Diagnostics
 * 
 * This script diagnoses why triggers are not loading for a specific company
 * by checking each step of the loading process.
 * 
 * Usage: node scripts/debug-trigger-loading.js <companyId>
 * Example: node scripts/debug-trigger-loading.js 68e3f77a9d623b8058c700c4
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

// Models
const CompanyLocalTrigger = require('../models/CompanyLocalTrigger');
const CompanyTriggerSettings = require('../models/CompanyTriggerSettings');
const GlobalTriggerGroup = require('../models/GlobalTriggerGroup');
const GlobalTrigger = require('../models/GlobalTrigger');
const Company = require('../models/v2Company');

async function debugTriggerLoading(companyId) {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('🔍 TRIGGER LOADING DIAGNOSTICS');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  console.log(`Company ID: ${companyId}\n`);

  try {
    // ═════════════════════════════════════════════════════════════
    // STEP 1: Verify Company Exists
    // ═════════════════════════════════════════════════════════════
    console.log('─────────────────────────────────────────────────────────');
    console.log('STEP 1: Verify Company Exists');
    console.log('─────────────────────────────────────────────────────────');
    
    const company = await Company.findById(companyId);
    if (!company) {
      console.error(`❌ Company not found with ID: ${companyId}`);
      return;
    }
    
    console.log(`✅ Company found: ${company.name}`);
    console.log(`   Business Type: ${company.businessType || 'N/A'}`);
    console.log(`   Phone: ${company.mainPhone || 'N/A'}`);
    console.log();

    // ═════════════════════════════════════════════════════════════
    // STEP 2: Check CompanyTriggerSettings
    // ═════════════════════════════════════════════════════════════
    console.log('─────────────────────────────────────────────────────────');
    console.log('STEP 2: Check CompanyTriggerSettings');
    console.log('─────────────────────────────────────────────────────────');
    
    const settings = await CompanyTriggerSettings.findByCompanyId(companyId);
    if (!settings) {
      console.log('⚠️  No CompanyTriggerSettings found - will use defaults');
      console.log('   This means: No global group assigned, only local triggers will be used');
    } else {
      console.log('✅ CompanyTriggerSettings found:');
      console.log(`   Active Group ID: ${settings.activeGroupId || 'NONE'}`);
      console.log(`   Strict Mode: ${settings.strictMode}`);
      console.log(`   Expected Min Local Triggers: ${settings.expectedLocalTriggersMin || 'N/A'}`);
      console.log(`   Hidden Trigger IDs: ${settings.hiddenTriggerIds?.length || 0}`);
    }
    console.log();

    // ═════════════════════════════════════════════════════════════
    // STEP 3: Check Global Trigger Group (if assigned)
    // ═════════════════════════════════════════════════════════════
    if (settings?.activeGroupId) {
      console.log('─────────────────────────────────────────────────────────');
      console.log('STEP 3: Check Global Trigger Group');
      console.log('─────────────────────────────────────────────────────────');
      
      const group = await GlobalTriggerGroup.findByGroupId(settings.activeGroupId);
      if (!group) {
        console.error(`❌ Global Trigger Group NOT FOUND: ${settings.activeGroupId}`);
        console.error('   This is a configuration error - the assigned group does not exist!');
      } else {
        console.log(`✅ Global Trigger Group found: ${group.name}`);
        console.log(`   Group ID: ${group.groupId}`);
        console.log(`   Published Version: ${group.publishedVersion}`);
        console.log(`   Is Draft: ${group.isDraft}`);
        console.log(`   Is Published: ${group.publishedVersion > 0}`);
        
        if (group.publishedVersion === 0) {
          console.log('\n   ⚠️  WARNING: Group is NOT published (publishedVersion = 0)');
          console.log('   Global triggers will NOT be loaded until group is published!');
        }
      }
      console.log();

      // ═════════════════════════════════════════════════════════════
      // STEP 4: Query Global Triggers
      // ═════════════════════════════════════════════════════════════
      console.log('─────────────────────────────────────────────────────────');
      console.log('STEP 4: Query Global Triggers (Published Only)');
      console.log('─────────────────────────────────────────────────────────');
      
      const isGroupPublished = group && group.publishedVersion > 0;
      
      if (!isGroupPublished) {
        console.log('⏭️  SKIPPED - Group is not published, so query would return 0 results');
      } else {
        console.log(`Query: GlobalTrigger.find({`);
        console.log(`  groupId: "${settings.activeGroupId.toLowerCase()}",`);
        console.log(`  state: "published",`);
        console.log(`  enabled: true,`);
        console.log(`  isDeleted: { $ne: true }`);
        console.log(`})\n`);
        
        const globalTriggers = await GlobalTrigger.findPublishedByGroupId(settings.activeGroupId);
        console.log(`✅ Global Triggers Found: ${globalTriggers.length}`);
        
        if (globalTriggers.length > 0) {
          console.log('\n   First 5 Global Triggers:');
          globalTriggers.slice(0, 5).forEach((t, idx) => {
            console.log(`   ${idx + 1}. [${t.ruleId}] ${t.label}`);
            console.log(`      Priority: ${t.priority}, Enabled: ${t.enabled}, State: ${t.state}`);
            console.log(`      Keywords: ${(t.keywords || []).join(', ') || 'NONE'}`);
          });
          if (globalTriggers.length > 5) {
            console.log(`   ... and ${globalTriggers.length - 5} more`);
          }
        } else {
          console.log('\n   ⚠️  No global triggers found!');
          console.log('   Possible reasons:');
          console.log('   - All triggers in group are in "draft" state (not "published")');
          console.log('   - All triggers are disabled (enabled: false)');
          console.log('   - All triggers are soft-deleted (isDeleted: true)');
        }
      }
      console.log();
    } else {
      console.log('─────────────────────────────────────────────────────────');
      console.log('STEP 3-4: Global Triggers');
      console.log('─────────────────────────────────────────────────────────');
      console.log('⏭️  SKIPPED - No global trigger group assigned to this company');
      console.log();
    }

    // ═════════════════════════════════════════════════════════════
    // STEP 5: Query Local Triggers
    // ═════════════════════════════════════════════════════════════
    console.log('─────────────────────────────────────────────────────────');
    console.log('STEP 5: Query Local Triggers (Active Only)');
    console.log('─────────────────────────────────────────────────────────');
    
    console.log(`Query: CompanyLocalTrigger.find({`);
    console.log(`  companyId: "${companyId}",`);
    console.log(`  enabled: true,`);
    console.log(`  isDeleted: { $ne: true }`);
    console.log(`})\n`);
    
    const localTriggers = await CompanyLocalTrigger.findActiveByCompanyId(companyId);
    console.log(`✅ Local Triggers Found: ${localTriggers.length}`);
    
    if (localTriggers.length > 0) {
      console.log('\n   First 5 Local Triggers:');
      localTriggers.slice(0, 5).forEach((t, idx) => {
        console.log(`   ${idx + 1}. [${t.ruleId}] ${t.label}`);
        console.log(`      Priority: ${t.priority}, Enabled: ${t.enabled}`);
        console.log(`      Keywords: ${(t.keywords || []).join(', ') || 'NONE'}`);
      });
      if (localTriggers.length > 5) {
        console.log(`   ... and ${localTriggers.length - 5} more`);
      }
    } else {
      console.log('\n   ⚠️  No local triggers found!');
      console.log('   This is OK if company uses global-only triggers.');
      console.log('   But if you expect local triggers, check:');
      console.log(`   - Does companyId match? (querying: ${companyId})`);
      console.log('   - Are triggers disabled (enabled: false)?');
      console.log('   - Are triggers soft-deleted (isDeleted: true)?');
    }
    console.log();

    // Also check ALL local triggers (including disabled/deleted) for debugging
    const allLocalTriggers = await CompanyLocalTrigger.find({ companyId });
    if (allLocalTriggers.length > localTriggers.length) {
      console.log(`   📊 Total Local Triggers (including disabled/deleted): ${allLocalTriggers.length}`);
      const disabled = allLocalTriggers.filter(t => !t.enabled).length;
      const deleted = allLocalTriggers.filter(t => t.isDeleted).length;
      console.log(`      - Disabled: ${disabled}`);
      console.log(`      - Soft-deleted: ${deleted}`);
      console.log(`      - Active: ${localTriggers.length}`);
      console.log();
    }

    // ═════════════════════════════════════════════════════════════
    // STEP 6: Final Assessment
    // ═════════════════════════════════════════════════════════════
    console.log('─────────────────────────────────────────────────────────');
    console.log('STEP 6: Final Assessment');
    console.log('─────────────────────────────────────────────────────────');
    
    let globalCount = 0;
    if (settings?.activeGroupId) {
      const group = await GlobalTriggerGroup.findByGroupId(settings.activeGroupId);
      if (group && group.publishedVersion > 0) {
        const globalTriggers = await GlobalTrigger.findPublishedByGroupId(settings.activeGroupId);
        globalCount = globalTriggers.length;
      }
    }
    
    const totalTriggers = globalCount + localTriggers.length;
    
    console.log(`Total Triggers at Runtime: ${totalTriggers}`);
    console.log(`  - Global: ${globalCount}`);
    console.log(`  - Local:  ${localTriggers.length}`);
    console.log();
    
    if (totalTriggers === 0) {
      console.log('❌ PROBLEM IDENTIFIED: Zero triggers will be loaded at runtime!');
      console.log();
      console.log('Root Cause Analysis:');
      
      if (!settings?.activeGroupId) {
        console.log('  1. No global trigger group assigned');
        console.log('     → Assign a group in CompanyTriggerSettings.activeGroupId');
      } else {
        const group = await GlobalTriggerGroup.findByGroupId(settings.activeGroupId);
        if (!group) {
          console.log(`  1. Global group assigned but does NOT exist: ${settings.activeGroupId}`);
          console.log('     → Fix the activeGroupId or create the missing group');
        } else if (group.publishedVersion === 0) {
          console.log('  1. Global group exists but is NOT published');
          console.log('     → Publish the group to activate global triggers');
        } else {
          console.log('  1. Global group is published but contains 0 enabled triggers');
          console.log('     → Add triggers to the group or enable existing ones');
        }
      }
      
      if (localTriggers.length === 0) {
        console.log('  2. No local triggers found');
        if (allLocalTriggers.length > 0) {
          console.log('     → Local triggers exist but are disabled or deleted - re-enable them');
        } else {
          console.log('     → Create local triggers for this company');
        }
      }
    } else {
      console.log(`✅ SUCCESS: ${totalTriggers} trigger(s) will be loaded at runtime`);
    }
    console.log();
    
  } catch (error) {
    console.error('\n❌ ERROR during diagnostics:');
    console.error(error);
  }
  
  console.log('═══════════════════════════════════════════════════════════\n');
}

// Main execution
async function main() {
  const companyId = process.argv[2];
  
  if (!companyId) {
    console.error('Usage: node scripts/debug-trigger-loading.js <companyId>');
    console.error('Example: node scripts/debug-trigger-loading.js 68e3f77a9d623b8058c700c4');
    process.exit(1);
  }
  
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL;
  
  if (!mongoUri) {
    console.error('❌ No MongoDB URI found in environment variables');
    console.error('   Set MONGODB_URI, MONGO_URI, or DATABASE_URL');
    process.exit(1);
  }
  
  console.log('\nConnecting to MongoDB...');
  await mongoose.connect(mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });
  console.log(`✅ Connected to MongoDB: ${mongoose.connection.name}\n`);
  
  await debugTriggerLoading(companyId);
  
  await mongoose.connection.close();
  console.log('Disconnected from MongoDB\n');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
