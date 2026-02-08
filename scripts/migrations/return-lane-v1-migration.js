#!/usr/bin/env node
/**
 * Return Lane V1 Migration Script
 * ================================
 * 
 * PURPOSE:
 * - Set returnConfig.enabled = false on ALL existing TriageCards (safe rollout)
 * - Set returnLane.enabled = false on ALL companies (feature flag OFF by default)
 * - Ensures no "surprise pushes" on day one
 * 
 * SAFE TO RUN MULTIPLE TIMES: Uses $exists checks to avoid overwriting existing configs
 * 
 * ROLLBACK: The feature flag (returnLane.enabled) controls runtime behavior.
 *           Setting it to false disables the system entirely.
 * 
 * USAGE:
 *   node scripts/migrations/return-lane-v1-migration.js
 *   node scripts/migrations/return-lane-v1-migration.js --dry-run
 * 
 * @version 1.0.0
 * @date 2026-02-05
 */

require('dotenv').config();
const mongoose = require('mongoose');
const TriageCard = require('../../models/TriageCard');
const v2Company = require('../../models/v2Company');

const DRY_RUN = process.argv.includes('--dry-run');

async function migrateTriageCards() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('PHASE 1: Migrating TriageCards');
  console.log('═══════════════════════════════════════════════════════════════');
  
  // Find cards that don't have returnConfig.enabled set
  const cardsWithoutConfig = await TriageCard.countDocuments({
    'returnConfig.enabled': { $exists: false }
  });
  
  console.log(`Found ${cardsWithoutConfig} cards without returnConfig.enabled`);
  
  if (DRY_RUN) {
    console.log('[DRY RUN] Would set returnConfig.enabled = false on these cards');
    return { updated: 0, wouldUpdate: cardsWithoutConfig };
  }
  
  // Set returnConfig.enabled = false for all cards without it
  const result = await TriageCard.updateMany(
    { 'returnConfig.enabled': { $exists: false } },
    { 
      $set: { 
        'returnConfig.enabled': false,
        'returnConfig.lane': 'UNKNOWN',
        'returnConfig.postResponseAction': 'NONE'
      } 
    }
  );
  
  console.log(`✅ Updated ${result.modifiedCount} TriageCards`);
  return { updated: result.modifiedCount };
}

async function migrateCompanies() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('PHASE 2: Migrating Companies');
  console.log('═══════════════════════════════════════════════════════════════');
  
  // Find companies that don't have returnLane.enabled set
  const companiesWithoutConfig = await v2Company.countDocuments({
    'aiAgentSettings.returnLane.enabled': { $exists: false }
  });
  
  console.log(`Found ${companiesWithoutConfig} companies without returnLane.enabled`);
  
  if (DRY_RUN) {
    console.log('[DRY RUN] Would set returnLane.enabled = false on these companies');
    return { updated: 0, wouldUpdate: companiesWithoutConfig };
  }
  
  // Set returnLane.enabled = false for all companies without it
  const result = await v2Company.updateMany(
    { 'aiAgentSettings.returnLane.enabled': { $exists: false } },
    { 
      $set: { 
        'aiAgentSettings.returnLane.enabled': false,
        'aiAgentSettings.returnLane.defaults.lane': 'UNKNOWN',
        'aiAgentSettings.returnLane.defaults.postResponseAction': 'CONTINUE_DISCOVERY',
        'aiAgentSettings.returnLane.defaults.pushPromptKey': 'default',
        'aiAgentSettings.returnLane.configuredAt': new Date(),
        'aiAgentSettings.returnLane.configuredBy': 'return-lane-v1-migration'
      } 
    }
  );
  
  console.log(`✅ Updated ${result.modifiedCount} companies`);
  return { updated: result.modifiedCount };
}

async function generateSummaryReport() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('SUMMARY REPORT');
  console.log('═══════════════════════════════════════════════════════════════');
  
  // Count cards by returnConfig.enabled status
  const enabledCards = await TriageCard.countDocuments({ 'returnConfig.enabled': true });
  const disabledCards = await TriageCard.countDocuments({ 'returnConfig.enabled': false });
  const noConfigCards = await TriageCard.countDocuments({ 'returnConfig.enabled': { $exists: false } });
  
  console.log('\nTriageCards:');
  console.log(`  - returnConfig.enabled = true:  ${enabledCards}`);
  console.log(`  - returnConfig.enabled = false: ${disabledCards}`);
  console.log(`  - returnConfig.enabled missing: ${noConfigCards}`);
  
  // Count companies by returnLane.enabled status
  const enabledCompanies = await v2Company.countDocuments({ 'aiAgentSettings.returnLane.enabled': true });
  const disabledCompanies = await v2Company.countDocuments({ 'aiAgentSettings.returnLane.enabled': false });
  const noLaneCompanies = await v2Company.countDocuments({ 'aiAgentSettings.returnLane.enabled': { $exists: false } });
  
  console.log('\nCompanies:');
  console.log(`  - returnLane.enabled = true:  ${enabledCompanies}`);
  console.log(`  - returnLane.enabled = false: ${disabledCompanies}`);
  console.log(`  - returnLane.enabled missing: ${noLaneCompanies}`);
  
  return {
    triageCards: { enabled: enabledCards, disabled: disabledCards, missing: noConfigCards },
    companies: { enabled: enabledCompanies, disabled: disabledCompanies, missing: noLaneCompanies }
  };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('RETURN LANE V1 MIGRATION');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Mode: ${DRY_RUN ? '🔍 DRY RUN (no changes will be made)' : '🚀 LIVE RUN'}`);
  console.log(`Started: ${new Date().toISOString()}`);
  
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI or MONGO_URI environment variable not set');
    }
    
    console.log('\nConnecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');
    
    // Run migrations
    const cardResults = await migrateTriageCards();
    const companyResults = await migrateCompanies();
    
    // Generate summary
    const summary = await generateSummaryReport();
    
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('MIGRATION COMPLETE');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`Finished: ${new Date().toISOString()}`);
    
    if (summary.triageCards.missing > 0 || summary.companies.missing > 0) {
      console.log('\n⚠️  WARNING: Some documents still missing returnConfig/returnLane');
      console.log('    Run migration again without --dry-run to fix');
    }
    
    if (!DRY_RUN) {
      console.log('\n✅ Return Lane V1 migration complete. All cards/companies default OFF.');
      console.log('   To enable for a company, set aiAgentSettings.returnLane.enabled = true');
    }
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  }
}

main();
