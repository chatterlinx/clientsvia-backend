/**
 * Phase 9: Add 1 Missing Negative to 14 Scenarios
 * 
 * These scenarios have 2/3 negatives - need 1 more each
 * All other minimums already met (triggers≥8, quick≥7, full≥7)
 * 
 * Usage:
 *   node scripts/phase9-add-missing-negatives.js --dry-run
 *   node scripts/phase9-add-missing-negatives.js --apply
 */

const mongoose = require('mongoose');
require('dotenv').config();

const TEMPLATE_ID = '68fb535130d19aec696d8123';

// These 14 scenarios need 1 more negative each (currently at 2/3)
const SCENARIOS_NEEDING_NEGATIVES = [
  {
    scenarioId: 'scenario-1761398576855-rreo3z8qk',
    name: 'Thermostat heat mode tips',
    addNegative: 'furnace issue'
  },
  {
    scenarioId: 'scenario-1766497689882-06dn1hgrs',
    name: 'Caller Not Sure What They Need',
    addNegative: 'calling to confirm'
  },
  {
    scenarioId: 'scenario-1766497690296-xr652uhx5',
    name: 'Caller Vague About Symptoms',
    addNegative: 'specific problem known'
  },
  {
    scenarioId: 'scenario-1766497690696-t6ba4dew6',
    name: 'Needs Repair But Asking for Maintenance',
    addNegative: 'routine checkup only'
  },
  {
    scenarioId: 'scenario-1766497691088-sn21psgwe',
    name: 'Needs Maintenance But Describing Like Repair',
    addNegative: 'system is broken'
  },
  {
    scenarioId: 'scenario-1766498032756-tbnham3wq',
    name: 'Water Leaking From Unit',
    addNegative: 'plumbing leak'
  },
  {
    scenarioId: 'scenario-1766497684697-8w6qie0eo',
    name: 'AC Low on Refrigerant',
    addNegative: 'ac working fine'
  },
  {
    scenarioId: 'scenario-1766497686334-vrjjzbxnf',
    name: 'Warranty Coverage Question',
    addNegative: 'out of warranty known'
  },
  {
    scenarioId: 'scenario-1766497686687-hmuy8scbd',
    name: 'Financing Options Available',
    addNegative: 'full payment ready'
  },
  {
    scenarioId: 'scenario-1766497687207-yaaevruve',
    name: 'Payment Methods Accepted',
    addNegative: 'financing needed'
  },
  {
    scenarioId: 'scenario-1766497689400-ua7xkxrq6',
    name: 'Commercial Billing Questions',
    addNegative: 'residential customer'
  },
  {
    scenarioId: 'scenario-1766497688486-gc1d03ii2',
    name: 'Do You Service My Area',
    addNegative: 'already scheduled'
  },
  {
    scenarioId: 'scenario-1766497693608-bjisxlkdp',
    name: 'Confirm Appointment',
    addNegative: 'cancel appointment'
  },
  {
    scenarioId: 'scenario-1766498037158-97yvi84s8',
    name: 'Reschedule or Cancel Appointment',
    addNegative: 'confirm existing time'
  }
];

async function runPhase9(isDryRun) {
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(`🔍 PHASE 9: ${isDryRun ? 'DRY RUN' : 'APPLYING'} - Add 1 Missing Negative to 14 Scenarios`);
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(`Template ID: ${TEMPLATE_ID}`);
  console.log(`Scenarios to update: ${SCENARIOS_NEEDING_NEGATIVES.length}`);
  console.log('');

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  const GlobalInstantResponseTemplate = mongoose.connection.collection('globalinstantresponsetemplates');
  
  const template = await GlobalInstantResponseTemplate.findOne({ _id: new mongoose.Types.ObjectId(TEMPLATE_ID) });
  if (!template) {
    console.error('❌ Template not found!');
    process.exit(1);
  }
  console.log(`✅ Loaded template: ${template.name}`);
  console.log('');

  let updatedCount = 0;
  let skippedCount = 0;
  const changes = [];

  for (const scenarioData of SCENARIOS_NEEDING_NEGATIVES) {
    let scenarioFound = false;
    
    for (const category of template.categories || []) {
      for (const scenario of category.scenarios || []) {
        if (scenario.scenarioId === scenarioData.scenarioId) {
          scenarioFound = true;
          
          const currentNegatives = scenario.negativeUserPhrases || [];
          const currentCount = currentNegatives.length;
          
          // Check if already has 3+ negatives
          if (currentCount >= 3) {
            console.log(`⏭️  ${scenarioData.name}: Already has ${currentCount} negatives (skip)`);
            skippedCount++;
            break;
          }
          
          // Check if the negative already exists
          if (currentNegatives.includes(scenarioData.addNegative)) {
            console.log(`⏭️  ${scenarioData.name}: Negative "${scenarioData.addNegative}" already exists (skip)`);
            skippedCount++;
            break;
          }
          
          // Add the negative
          const newNegatives = [...currentNegatives, scenarioData.addNegative];
          
          changes.push({
            scenarioId: scenarioData.scenarioId,
            name: scenarioData.name,
            category: category.name,
            before: currentCount,
            after: newNegatives.length,
            added: scenarioData.addNegative
          });
          
          if (!isDryRun) {
            scenario.negativeUserPhrases = newNegatives;
            scenario.updatedAt = new Date();
          }
          
          updatedCount++;
          break;
        }
      }
      if (scenarioFound) break;
    }
    
    if (!scenarioFound) {
      console.log(`⚠️  ${scenarioData.name}: NOT FOUND in template`);
    }
  }

  console.log('');
  console.log('📋 PATCH REPORT');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  
  for (const change of changes) {
    console.log(`📝 ${change.name}`);
    console.log(`   Category: ${change.category}`);
    console.log(`   negatives: ${change.before} → ${change.after}`);
    console.log(`   Added: "${change.added}"`);
    console.log('');
  }

  console.log(`Total to update: ${updatedCount}`);
  console.log(`Skipped (already compliant): ${skippedCount}`);
  console.log('');

  if (isDryRun) {
    console.log('🔍 DRY RUN - No changes written');
    console.log('To apply these changes, run:');
    console.log('  node scripts/phase9-add-missing-negatives.js --apply');
  } else if (updatedCount > 0) {
    await GlobalInstantResponseTemplate.updateOne(
      { _id: template._id },
      { $set: { categories: template.categories, updatedAt: new Date() } }
    );
    console.log(`✅ APPLIED - ${updatedCount} scenarios updated`);
  } else {
    console.log('✅ No changes needed - all scenarios already compliant');
  }

  await mongoose.disconnect();
  console.log('✅ Disconnected from MongoDB');
}

// Parse args
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run') || !args.includes('--apply');

runPhase9(isDryRun).catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});

