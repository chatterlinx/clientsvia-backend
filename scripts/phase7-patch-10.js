#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * PHASE 7: PATCH 10 SCENARIOS (CORE HVAC - NEGATIVES ONLY)
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * All scenarios in this batch already have 8/8 triggers, 7/7 quick, 7/7 full.
 * They ONLY need +3 negatives each to meet enforcement minimums.
 * 
 * Scenarios:
 * - AC blowing warm air (EMERGENCY)
 * - AC not turning on (EMERGENCY)
 * - Outdoor fan not spinning (TROUBLESHOOT)
 * - AC iced over (EMERGENCY)
 * - AC short cycling (EMERGENCY)
 * - Water leaking from air handler (EMERGENCY)
 * - AC not keeping up (EMERGENCY)
 * - Strange noise from AC (EMERGENCY)
 * - Thermostat Completely Dead (EMERGENCY)
 * - Furnace blowing cold air (EMERGENCY)
 * 
 * USAGE:
 *   DRY RUN:  node scripts/phase7-patch-10.js --dry-run
 *   APPLY:    node scripts/phase7-patch-10.js --apply
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const mongoose = require('mongoose');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');

const TEMPLATE_ID = '68fb535130d19aec696d8123';

const PHASE7_SCENARIOS = [
    'scenario-1761397969597-lhg4k3qhb',  // AC blowing warm air
    'scenario-1761397969945-k1nyik8qm',  // AC not turning on
    'scenario-1761397970305-0ejqojnvy',  // Outdoor fan not spinning
    'scenario-1761397970704-ar2iqosnn',  // AC iced over
    'scenario-1761397971046-e2kd3erhq',  // AC short cycling
    'scenario-1761397971399-6gstammzj',  // Water leaking from air handler
    'scenario-1761397971736-ixkr1hvti',  // AC not keeping up
    'scenario-1761397972083-mxyu5alwx',  // Strange noise from AC
    'scenario-1764758250915-kdda6vguq',  // Thermostat Completely Dead - No Troubleshooting
    'scenario-1761398574849-z408i7poj',  // Furnace blowing cold air
];

const MINIMUMS = {
    triggers: 8,
    negativeUserPhrases: 3,
    quickReplies: 7,
    fullReplies: 7
};

// ═══════════════════════════════════════════════════════════════════════════════
// GOLD STANDARD NEGATIVES - Core HVAC scenarios
// These prevent wrong routing and dangerous advice
// ═══════════════════════════════════════════════════════════════════════════════

const GOLD_STANDARD_ADDITIONS = {
    // 1. AC blowing warm air - EMERGENCY
    'scenario-1761397969597-lhg4k3qhb': {
        triggers: [],
        negativeUserPhrases: [
            'ac is cooling fine now',
            'air is cold again',
            'heating not cooling issue'
        ],
        quickReplies: [],
        fullReplies: []
    },

    // 2. AC not turning on - EMERGENCY
    'scenario-1761397969945-k1nyik8qm': {
        triggers: [],
        negativeUserPhrases: [
            'ac turns on fine',
            'system is running',
            'furnace not ac problem'
        ],
        quickReplies: [],
        fullReplies: []
    },

    // 3. Outdoor fan not spinning - TROUBLESHOOT
    'scenario-1761397970305-0ejqojnvy': {
        triggers: [],
        negativeUserPhrases: [
            'outdoor fan is spinning',
            'condenser fan works fine',
            'indoor fan not outdoor'
        ],
        quickReplies: [],
        fullReplies: []
    },

    // 4. AC iced over - EMERGENCY
    'scenario-1761397970704-ar2iqosnn': {
        triggers: [],
        negativeUserPhrases: [
            'no ice on unit',
            'coils are clear',
            'furnace icing not ac'
        ],
        quickReplies: [],
        fullReplies: []
    },

    // 5. AC short cycling - EMERGENCY
    'scenario-1761397971046-e2kd3erhq': {
        triggers: [],
        negativeUserPhrases: [
            'ac runs continuously',
            'system stays on fine',
            'furnace short cycling not ac'
        ],
        quickReplies: [],
        fullReplies: []
    },

    // 6. Water leaking from air handler - EMERGENCY
    'scenario-1761397971399-6gstammzj': {
        triggers: [],
        negativeUserPhrases: [
            'no water leak',
            'leak is from roof not hvac',
            'outdoor unit leaking not indoor'
        ],
        quickReplies: [],
        fullReplies: []
    },

    // 7. AC not keeping up - EMERGENCY
    'scenario-1761397971736-ixkr1hvti': {
        triggers: [],
        negativeUserPhrases: [
            'ac keeping house cool',
            'temperature is fine',
            'heating not cooling problem'
        ],
        quickReplies: [],
        fullReplies: []
    },

    // 8. Strange noise from AC - EMERGENCY
    'scenario-1761397972083-mxyu5alwx': {
        triggers: [],
        negativeUserPhrases: [
            'ac is quiet',
            'noise from furnace not ac',
            'noise stopped already'
        ],
        quickReplies: [],
        fullReplies: []
    },

    // 9. Thermostat Completely Dead - No Troubleshooting - EMERGENCY
    'scenario-1764758250915-kdda6vguq': {
        triggers: [],
        negativeUserPhrases: [
            'thermostat display is on',
            'thermostat works fine',
            'system responds to thermostat'
        ],
        quickReplies: [],
        fullReplies: []
    },

    // 10. Furnace blowing cold air - EMERGENCY
    'scenario-1761398574849-z408i7poj': {
        triggers: [],
        negativeUserPhrases: [
            'furnace blowing warm air',
            'heat is working fine',
            'ac problem not furnace'
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
        console.log('  node scripts/phase7-patch-10.js --dry-run   Preview changes');
        console.log('  node scripts/phase7-patch-10.js --apply     Apply changes');
        process.exit(1);
    }

    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log(isDryRun ? '🔍 PHASE 7: DRY RUN - 10 CORE HVAC SCENARIOS (NEGATIVES ONLY)' : '🚀 PHASE 7: APPLYING - 10 CORE HVAC SCENARIOS (NEGATIVES ONLY)');
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log(`Template ID: ${TEMPLATE_ID}`);
    console.log(`Scenarios to update: ${PHASE7_SCENARIOS.length}`);
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

        for (const scenarioId of PHASE7_SCENARIOS) {
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
            console.log('  node scripts/phase7-patch-10.js --apply');
        } else {
            console.log('✅ APPLIED - Changes written to database\n');
            console.log('To verify, run:');
            console.log('  node scripts/phase7-patch-10.js --dry-run');
            console.log('  (Should show 0 operations)');
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

