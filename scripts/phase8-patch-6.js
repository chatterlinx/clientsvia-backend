#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * PHASE 8: FINAL PATCH - 6 SCENARIOS (HEATING - NEGATIVES ONLY)
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * THIS IS THE FINAL PHASE! After this, all 71 scenarios meet enforcement minimums.
 * 
 * All 6 scenarios already have 8/8 triggers, 7/7 quick, 7/7 full.
 * They ONLY need +3 negatives each to meet enforcement minimums.
 * 
 * Scenarios (all Heating / No Heat category):
 * - No ignition or lockout (EMERGENCY)
 * - Heat pump iced over (EMERGENCY)
 * - Burning smell on heat (EMERGENCY) - SAFETY CRITICAL
 * - Heater starts then stops (EMERGENCY)
 * - Heat pump running but no heat (EMERGENCY)
 * - Smell of gas near heater (EMERGENCY) - SAFETY CRITICAL
 * 
 * USAGE:
 *   DRY RUN:  node scripts/phase8-patch-6.js --dry-run
 *   APPLY:    node scripts/phase8-patch-6.js --apply
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const mongoose = require('mongoose');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');

const TEMPLATE_ID = '68fb535130d19aec696d8123';

const PHASE8_SCENARIOS = [
    'scenario-1761398575334-4oik5sh6h',  // No ignition or lockout
    'scenario-1761398575717-qofu6j8aw',  // Heat pump iced over
    'scenario-1761398576092-trnhiyn1e',  // Burning smell on heat
    'scenario-1761398576476-63xbq4r2u',  // Heater starts then stops
    'scenario-1761398577262-fqo17ri2o',  // Heat pump running but no heat
    'scenario-1761398577653-t0fjcqv5e',  // Smell of gas near heater
];

const MINIMUMS = {
    triggers: 8,
    negativeUserPhrases: 3,
    quickReplies: 7,
    fullReplies: 7
};

// ═══════════════════════════════════════════════════════════════════════════════
// GOLD STANDARD NEGATIVES - Heating scenarios
// Smart negatives: opposite condition, different mode, wrong source
// ═══════════════════════════════════════════════════════════════════════════════

const GOLD_STANDARD_ADDITIONS = {
    // 1. No ignition or lockout - EMERGENCY
    'scenario-1761398575334-4oik5sh6h': {
        triggers: [],
        negativeUserPhrases: [
            'furnace ignites fine',
            'heat turns on normally',
            'ac issue not furnace'
        ],
        quickReplies: [],
        fullReplies: []
    },

    // 2. Heat pump iced over - EMERGENCY
    'scenario-1761398575717-qofu6j8aw': {
        triggers: [],
        negativeUserPhrases: [
            'no ice on heat pump',
            'outdoor unit is clear',
            'ac iced over not heat pump'
        ],
        quickReplies: [],
        fullReplies: []
    },

    // 3. Burning smell on heat - EMERGENCY (SAFETY CRITICAL)
    'scenario-1761398576092-trnhiyn1e': {
        triggers: [],
        negativeUserPhrases: [
            'no burning smell',
            'smell is musty not burning',
            'gas smell not burning smell'
        ],
        quickReplies: [],
        fullReplies: []
    },

    // 4. Heater starts then stops - EMERGENCY
    'scenario-1761398576476-63xbq4r2u': {
        triggers: [],
        negativeUserPhrases: [
            'heater runs continuously',
            'heat stays on fine',
            'ac short cycling not heater'
        ],
        quickReplies: [],
        fullReplies: []
    },

    // 5. Heat pump running but no heat - EMERGENCY
    'scenario-1761398577262-fqo17ri2o': {
        triggers: [],
        negativeUserPhrases: [
            'heat pump producing heat',
            'house is warming up',
            'ac running not heat pump'
        ],
        quickReplies: [],
        fullReplies: []
    },

    // 6. Smell of gas near heater - EMERGENCY (SAFETY CRITICAL)
    'scenario-1761398577653-t0fjcqv5e': {
        triggers: [],
        negativeUserPhrases: [
            'no gas smell',
            'smell is burning not gas',
            'smell is from stove not heater'
        ],
        quickReplies: [],
        fullReplies: []
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN EXECUTION
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
    const args = process.argv.slice(2);
    const isDryRun = args.includes('--dry-run');
    const isApply = args.includes('--apply');

    if (!isDryRun && !isApply) {
        console.log('Usage:');
        console.log('  node scripts/phase8-patch-6.js --dry-run   Preview changes');
        console.log('  node scripts/phase8-patch-6.js --apply     Apply changes');
        process.exit(1);
    }

    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log(isDryRun ? '🔍 PHASE 8 (FINAL): DRY RUN - 6 HEATING SCENARIOS' : '🚀 PHASE 8 (FINAL): APPLYING - 6 HEATING SCENARIOS');
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log(`Template ID: ${TEMPLATE_ID}`);
    console.log(`Scenarios to update: ${PHASE8_SCENARIOS.length}`);
    console.log('');

    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        console.error('❌ MONGODB_URI environment variable not set');
        process.exit(1);
    }

    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    try {
        const template = await GlobalInstantResponseTemplate.findById(TEMPLATE_ID);
        if (!template) {
            console.error(`❌ Template ${TEMPLATE_ID} not found`);
            process.exit(1);
        }

        console.log(`✅ Loaded template: ${template.name}`);
        console.log('');

        const report = [];
        let opsCount = 0;

        for (const scenarioId of PHASE8_SCENARIOS) {
            let currentScenario = null;
            let categoryName = null;
            let categoryIndex = -1;
            let scenarioIndex = -1;

            for (let ci = 0; ci < template.categories.length; ci++) {
                const cat = template.categories[ci];
                for (let si = 0; si < (cat.scenarios || []).length; si++) {
                    if (cat.scenarios[si].scenarioId === scenarioId) {
                        currentScenario = cat.scenarios[si];
                        categoryName = cat.name;
                        categoryIndex = ci;
                        scenarioIndex = si;
                        break;
                    }
                }
                if (currentScenario) break;
            }

            if (!currentScenario) {
                console.warn(`⚠️  Scenario ${scenarioId} not found - skipping`);
                continue;
            }

            const additions = GOLD_STANDARD_ADDITIONS[scenarioId];
            if (!additions) {
                console.warn(`⚠️  No Gold Standard content for ${scenarioId} - skipping`);
                continue;
            }

            const before = {
                triggers: currentScenario.triggers?.length || 0,
                negatives: currentScenario.negativeUserPhrases?.length || 0,
                quickReplies: currentScenario.quickReplies?.length || 0,
                fullReplies: currentScenario.fullReplies?.length || 0
            };

            const alreadyMeets = 
                before.triggers >= MINIMUMS.triggers &&
                before.negatives >= MINIMUMS.negativeUserPhrases &&
                before.quickReplies >= MINIMUMS.quickReplies &&
                before.fullReplies >= MINIMUMS.fullReplies;

            if (alreadyMeets) {
                report.push({
                    name: currentScenario.name,
                    category: categoryName,
                    status: 'SKIP',
                    reason: 'Already meets minimums',
                    before,
                    after: before
                });
                continue;
            }

            const newTriggers = [...new Set([
                ...(currentScenario.triggers || []),
                ...(additions.triggers || [])
            ])];
            const newNegatives = [...new Set([
                ...(currentScenario.negativeUserPhrases || []),
                ...(additions.negativeUserPhrases || [])
            ])];
            const newQuickReplies = [...new Set([
                ...(currentScenario.quickReplies || []),
                ...(additions.quickReplies || [])
            ])];
            const newFullReplies = [...new Set([
                ...(currentScenario.fullReplies || []),
                ...(additions.fullReplies || [])
            ])];

            const after = {
                triggers: newTriggers.length,
                negatives: newNegatives.length,
                quickReplies: newQuickReplies.length,
                fullReplies: newFullReplies.length
            };

            const hasChanges = 
                after.triggers !== before.triggers ||
                after.negatives !== before.negatives ||
                after.quickReplies !== before.quickReplies ||
                after.fullReplies !== before.fullReplies;

            if (!hasChanges) {
                report.push({
                    name: currentScenario.name,
                    category: categoryName,
                    status: 'SKIP',
                    reason: 'No new content to add',
                    before,
                    after
                });
                continue;
            }

            opsCount++;

            if (isApply) {
                template.categories[categoryIndex].scenarios[scenarioIndex].triggers = newTriggers;
                template.categories[categoryIndex].scenarios[scenarioIndex].negativeUserPhrases = newNegatives;
                template.categories[categoryIndex].scenarios[scenarioIndex].quickReplies = newQuickReplies;
                template.categories[categoryIndex].scenarios[scenarioIndex].fullReplies = newFullReplies;
                template.categories[categoryIndex].scenarios[scenarioIndex].updatedAt = new Date();
            }

            report.push({
                name: currentScenario.name,
                category: categoryName,
                status: isApply ? 'APPLIED' : 'WILL_UPDATE',
                before,
                after
            });
        }

        if (isApply && opsCount > 0) {
            template.updatedAt = new Date();
            await template.save();
            console.log('✅ Template saved');
        }

        console.log('\n📋 PATCH REPORT');
        console.log('─────────────────────────────────────────────────────────────────────────────');

        for (const item of report) {
            console.log(`\n📝 ${item.name}`);
            console.log(`   Category: ${item.category}`);
            console.log(`   Status: ${item.status}${item.reason ? ` (${item.reason})` : ''}`);
            if (item.status !== 'SKIP' || item.reason !== 'Already meets minimums') {
                console.log(`   Changes:`);
                console.log(`   • triggers: ${item.before.triggers} → ${item.after.triggers}`);
                console.log(`   • negatives: ${item.before.negatives} → ${item.after.negatives}`);
                console.log(`   • quickReplies: ${item.before.quickReplies} → ${item.after.quickReplies}`);
                console.log(`   • fullReplies: ${item.before.fullReplies} → ${item.after.fullReplies}`);
            }
        }

        console.log(`\nTotal operations: ${opsCount}`);
        console.log('');

        if (isDryRun) {
            console.log('🔍 DRY RUN - No changes written\n');
            console.log('To apply these changes, run:');
            console.log('  node scripts/phase8-patch-6.js --apply');
        } else {
            console.log('✅ APPLIED - Changes written to database\n');
            console.log('🎉 PHASE 8 COMPLETE - ALL 71 SCENARIOS NOW MEET ENFORCEMENT MINIMUMS!\n');
            console.log('To verify, run:');
            console.log('  node scripts/identify-worst-scenarios.js');
            console.log('  (Should show: Meeting minimums: 71, Below minimums: 0)');
        }

    } finally {
        await mongoose.disconnect();
        console.log('✅ Disconnected from MongoDB');
    }
}

main().catch(err => {
    console.error('❌ Script failed:', err);
    process.exit(1);
});

