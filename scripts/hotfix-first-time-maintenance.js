#!/usr/bin/env node
/**
 * HOTFIX: First Time Maintenance - Add 1 trigger to reach 8 minimum
 */

require('dotenv').config();
const mongoose = require('mongoose');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');

const TEMPLATE_ID = '68fb535130d19aec696d8123';
const SCENARIO_ID = 'scenario-1766497677582-hcdl24jv3';

async function main() {
    const args = process.argv.slice(2);
    const isDryRun = args.includes('--dry-run');
    const isApply = args.includes('--apply');

    if (!isDryRun && !isApply) {
        console.log('Usage:');
        console.log('  node scripts/hotfix-first-time-maintenance.js --dry-run');
        console.log('  node scripts/hotfix-first-time-maintenance.js --apply');
        process.exit(1);
    }

    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log('🔧 HOTFIX: First Time Maintenance - Adding trigger to reach 8');
    console.log('═══════════════════════════════════════════════════════════════════════════\n');

    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    try {
        const template = await GlobalInstantResponseTemplate.findById(TEMPLATE_ID);
        if (!template) {
            console.error('❌ Template not found');
            process.exit(1);
        }

        // Find the scenario
        let scenario = null;
        let catIdx = -1, scenIdx = -1;
        
        for (let ci = 0; ci < template.categories.length; ci++) {
            for (let si = 0; si < (template.categories[ci].scenarios || []).length; si++) {
                if (template.categories[ci].scenarios[si].scenarioId === SCENARIO_ID) {
                    scenario = template.categories[ci].scenarios[si];
                    catIdx = ci;
                    scenIdx = si;
                    break;
                }
            }
            if (scenario) break;
        }

        if (!scenario) {
            console.error('❌ Scenario not found');
            process.exit(1);
        }

        console.log(`Scenario: ${scenario.name}`);
        console.log(`Current triggers: ${scenario.triggers?.length || 0}`);
        
        // New trigger that's definitely unique
        const newTrigger = 'first time getting hvac serviced';
        
        const currentTriggers = scenario.triggers || [];
        if (currentTriggers.includes(newTrigger)) {
            console.log('⚠️ Trigger already exists, trying alternate...');
            const altTrigger = 'brand new to hvac maintenance';
            if (!currentTriggers.includes(altTrigger)) {
                currentTriggers.push(altTrigger);
            }
        } else {
            currentTriggers.push(newTrigger);
        }

        console.log(`New triggers count: ${currentTriggers.length}`);

        if (isApply) {
            template.categories[catIdx].scenarios[scenIdx].triggers = currentTriggers;
            template.categories[catIdx].scenarios[scenIdx].updatedAt = new Date();
            await template.save();
            console.log('\n✅ APPLIED - Trigger added');
        } else {
            console.log('\n🔍 DRY RUN - No changes made');
            console.log('Run with --apply to save changes');
        }

    } finally {
        await mongoose.disconnect();
        console.log('✅ Disconnected from MongoDB');
    }
}

main().catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
});

