#!/usr/bin/env node
/**
 * ============================================================================
 * CHECK TRIGGER GROUPS - Diagnostic Script
 * ============================================================================
 * 
 * This script checks what GlobalTriggerGroups actually exist in the database
 * and shows detailed information about each one.
 * 
 * USAGE:
 *   node scripts/check-trigger-groups.js
 * 
 * ============================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');

const GlobalTriggerGroup = require('../models/GlobalTriggerGroup');
const GlobalTrigger = require('../models/GlobalTrigger');
const CompanyTriggerSettings = require('../models/CompanyTriggerSettings');

async function main() {
  try {
    // Try multiple env var names
    const MONGO_URI = process.env.MONGODB_URI || 
                      process.env.MONGO_URI || 
                      process.env.MONGODB_CONNECTION_STRING;
    
    if (!MONGO_URI) {
      console.error('❌ No MongoDB connection string found.');
      console.error('   Tried: MONGODB_URI, MONGO_URI, MONGODB_CONNECTION_STRING');
      console.error('   Please set one of these in your .env file');
      process.exit(1);
    }

    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI, { 
      serverSelectionTimeoutMS: 10000 
    });
    console.log('✅ Connected\n');

    // ═══════════════════════════════════════════════════════════════════════
    // 1. List all GlobalTriggerGroups
    // ═══════════════════════════════════════════════════════════════════════
    console.log('═'.repeat(80));
    console.log('GLOBAL TRIGGER GROUPS');
    console.log('═'.repeat(80));
    
    const groups = await GlobalTriggerGroup.find({})
      .select('groupId name icon description triggerCount companyCount publishedVersion isActive createdAt createdBy')
      .sort({ createdAt: -1 })
      .lean();
    
    if (groups.length === 0) {
      console.log('❌ No global trigger groups found!\n');
    } else {
      console.log(`Found ${groups.length} group(s):\n`);
      
      for (const group of groups) {
        console.log(`📦 ${group.name} (${group.groupId})`);
        console.log(`   Icon: ${group.icon || 'none'}`);
        console.log(`   Active: ${group.isActive !== false ? 'Yes' : 'No'}`);
        console.log(`   Published Version: ${group.publishedVersion || 'none'}`);
        console.log(`   Trigger Count: ${group.triggerCount || 0}`);
        console.log(`   Company Count: ${group.companyCount || 0}`);
        console.log(`   Created: ${group.createdAt?.toISOString() || 'unknown'}`);
        console.log(`   Created By: ${group.createdBy || 'unknown'}`);
        
        // Check actual trigger count in DB
        const publishedCount = await GlobalTrigger.countDocuments({
          groupId: group.groupId,
          state: 'published',
          isDeleted: { $ne: true }
        });
        
        const draftCount = await GlobalTrigger.countDocuments({
          groupId: group.groupId,
          state: 'draft',
          isDeleted: { $ne: true }
        });
        
        console.log(`   Actual Triggers: ${publishedCount} published, ${draftCount} draft`);
        
        // Check if counts match
        if (publishedCount !== group.triggerCount) {
          console.log(`   ⚠️  WARNING: triggerCount mismatch! (${group.triggerCount} in group doc vs ${publishedCount} in DB)`);
        }
        
        console.log('');
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 2. Check which companies use which groups
    // ═══════════════════════════════════════════════════════════════════════
    console.log('═'.repeat(80));
    console.log('COMPANY GROUP ASSIGNMENTS');
    console.log('═'.repeat(80));
    
    const settings = await CompanyTriggerSettings.find({})
      .select('companyId activeGroupId groupSelectedAt groupSelectedBy strictMode')
      .lean();
    
    if (settings.length === 0) {
      console.log('❌ No company trigger settings found!\n');
    } else {
      console.log(`Found ${settings.length} company setting(s):\n`);
      
      const groupUsage = {};
      
      for (const setting of settings) {
        const groupId = setting.activeGroupId || 'NONE';
        if (!groupUsage[groupId]) {
          groupUsage[groupId] = [];
        }
        groupUsage[groupId].push({
          companyId: setting.companyId,
          selectedAt: setting.groupSelectedAt,
          selectedBy: setting.groupSelectedBy,
          strictMode: setting.strictMode !== false
        });
      }
      
      for (const [groupId, companies] of Object.entries(groupUsage)) {
        console.log(`Group: ${groupId}`);
        console.log(`  Used by ${companies.length} company(ies):`);
        for (const c of companies) {
          console.log(`    - ${c.companyId}`);
          console.log(`      Selected: ${c.selectedAt?.toISOString() || 'unknown'}`);
          console.log(`      Selected By: ${c.selectedBy || 'unknown'}`);
          console.log(`      Strict Mode: ${c.strictMode ? 'ON' : 'OFF'}`);
        }
        console.log('');
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 3. Summary and recommendations
    // ═══════════════════════════════════════════════════════════════════════
    console.log('═'.repeat(80));
    console.log('SUMMARY');
    console.log('═'.repeat(80));
    
    const activeGroups = groups.filter(g => g.isActive !== false);
    console.log(`Total groups: ${groups.length}`);
    console.log(`Active groups: ${activeGroups.length}`);
    console.log(`Companies with assignments: ${settings.filter(s => s.activeGroupId).length}`);
    console.log('');
    
    if (activeGroups.length > 1) {
      console.log('⚠️  WARNING: Multiple active groups detected!');
      console.log('   This may cause confusion. Consider consolidating to one group.');
      console.log('   Groups:');
      for (const g of activeGroups) {
        console.log(`   - ${g.groupId} (${g.companyCount || 0} companies)`);
      }
      console.log('');
    }
    
    if (activeGroups.length === 0) {
      console.log('❌ CRITICAL: No active groups found!');
      console.log('   You should run: node scripts/seedTriggerGroupV1.js');
      console.log('');
    }
    
    const unassignedCompanies = settings.filter(s => !s.activeGroupId);
    if (unassignedCompanies.length > 0) {
      console.log(`⚠️  WARNING: ${unassignedCompanies.length} companies have no active group!`);
      console.log('   These companies may fall back to legacy triggers.');
      console.log('');
    }

    await mongoose.disconnect();
    console.log('✅ Check complete\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
