#!/usr/bin/env node
/**
 * Fix Trigger State - Publish all enabled triggers
 * 
 * PROBLEM: Triggers are invisible at runtime because state != 'published'
 * SOLUTION: Update all enabled triggers to state: 'published'
 * 
 * Usage:
 *   node scripts/fix-trigger-state.js [companyId]
 *   
 * If companyId not provided, will show stats for all companies
 */

require('dotenv').config();
const mongoose = require('mongoose');
const CompanyLocalTrigger = require('../models/CompanyLocalTrigger');

async function checkTriggerStates(companyId = null) {
  console.log('🔍 Checking trigger states...\n');
  
  const query = companyId ? { companyId } : {};
  const allTriggers = await CompanyLocalTrigger.find(query);
  
  const stats = {
    total: allTriggers.length,
    published: allTriggers.filter(t => t.state === 'published').length,
    draft: allTriggers.filter(t => t.state === 'draft').length,
    null: allTriggers.filter(t => !t.state || t.state === null).length,
    enabled: allTriggers.filter(t => t.enabled === true).length,
    enabledButNotPublished: allTriggers.filter(t => t.enabled === true && t.state !== 'published').length
  };
  
  console.log('📊 Current State:');
  console.log(`   Total triggers: ${stats.total}`);
  console.log(`   - Published: ${stats.published}`);
  console.log(`   - Draft: ${stats.draft}`);
  console.log(`   - Null/Missing state: ${stats.null}`);
  console.log(`   - Enabled: ${stats.enabled}`);
  console.log(`   🚨 Enabled but NOT published: ${stats.enabledButNotPublished}\n`);
  
  if (stats.enabledButNotPublished > 0) {
    console.log('❌ PROBLEM FOUND:');
    console.log(`   ${stats.enabledButNotPublished} triggers are ENABLED but not PUBLISHED`);
    console.log('   These triggers are INVISIBLE at runtime!\n');
    
    const problematic = allTriggers.filter(t => t.enabled === true && t.state !== 'published');
    console.log('   Problematic triggers:');
    problematic.slice(0, 10).forEach(t => {
      console.log(`   - ${t.ruleId} (${t.label}) - state: ${t.state || 'null'}`);
    });
    if (problematic.length > 10) {
      console.log(`   ... and ${problematic.length - 10} more\n`);
    }
    
    return problematic;
  }
  
  console.log('✅ All enabled triggers are published!\n');
  return [];
}

async function fixTriggerStates(companyId = null) {
  console.log('🔧 Fixing trigger states...\n');
  
  // Find all enabled triggers that are NOT published
  const query = {
    enabled: true,
    state: { $ne: 'published' }
  };
  
  if (companyId) {
    query.companyId = companyId;
  }
  
  const triggers = await CompanyLocalTrigger.find(query);
  
  if (triggers.length === 0) {
    console.log('✅ No triggers need fixing!\n');
    return { modified: 0, triggers: [] };
  }
  
  console.log(`Found ${triggers.length} enabled triggers to publish:`);
  triggers.forEach(t => {
    console.log(`   - ${t.ruleId} (${t.label}) - state: ${t.state || 'null'} → 'published'`);
  });
  
  // Update all to published
  const result = await CompanyLocalTrigger.updateMany(
    query,
    { $set: { state: 'published' } }
  );
  
  console.log(`\n✅ Updated ${result.modifiedCount} triggers to state: 'published'\n`);
  
  return { modified: result.modifiedCount, triggers };
}

async function invalidateCache(companyId) {
  console.log('🧹 Invalidating trigger cache...');
  
  const TriggerService = require('../services/engine/agent2/TriggerService');
  TriggerService.invalidateCacheForCompany(companyId);
  
  console.log('✅ Cache invalidated\n');
}

async function main() {
  const companyId = process.argv[2];
  
  if (!companyId) {
    console.log('Usage: node scripts/fix-trigger-state.js [companyId]\n');
    console.log('Checking all companies...\n');
  } else {
    console.log(`Company ID: ${companyId}\n`);
  }
  
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    // Check current state
    const problematic = await checkTriggerStates(companyId);
    
    if (problematic.length === 0) {
      console.log('Nothing to fix. Exiting.');
      process.exit(0);
    }
    
    // Confirm before fixing
    console.log('─────────────────────────────────────────────────────────');
    console.log('Do you want to fix these triggers? (y/n)');
    console.log('This will set state: "published" for all enabled triggers');
    console.log('─────────────────────────────────────────────────────────\n');
    
    // For non-interactive mode (when run in scripts)
    const shouldFix = process.argv.includes('--fix') || process.argv.includes('-y');
    
    if (shouldFix) {
      const result = await fixTriggerStates(companyId);
      
      if (companyId && result.modified > 0) {
        await invalidateCache(companyId);
      }
      
      console.log('✅ DONE!\n');
      console.log('Next steps:');
      console.log('1. Test a call to verify triggers are now visible');
      console.log('2. Check Call Console for "Trigger Pool Source" event');
      console.log('3. Should see LOCAL triggers instead of EMPTY pool\n');
    } else {
      console.log('Run with --fix or -y flag to apply changes');
      console.log(`Example: node scripts/fix-trigger-state.js ${companyId || ''} --fix\n`);
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { checkTriggerStates, fixTriggerStates };
