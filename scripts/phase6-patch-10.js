#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * PHASE 6: PATCH 10 SCENARIOS (BOOKING + THERMOSTAT BATCH)
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Scenarios in this batch:
 * - Non-HVAC Request (SMALL_TALK) - CRITICAL: polite redirect, no non-HVAC advice
 * - Ready to Schedule Appointment (BOOKING)
 * - Reschedule or Cancel Appointment (BOOKING)
 * - Thermostat Firmware Update Assistance (TROUBLESHOOT) - needs negatives only
 * - Thermostat Not Turning On (EMERGENCY) - needs negatives only
 * - Inaccurate Temperature Display Assistance (FAQ) - needs negatives only
 * - Thermostat Communication Troubleshooting (TROUBLESHOOT) - needs negatives only
 * - Thermostat Upgrade Inquiry and Scheduling (BOOKING) - needs negatives only
 * - Thermostat Not Turning On System (EMERGENCY) - needs negatives only
 * - Thermostat Scheduling Setup (BOOKING) - needs negatives only
 * 
 * USAGE:
 *   DRY RUN:  node scripts/phase6-patch-10.js --dry-run
 *   APPLY:    node scripts/phase6-patch-10.js --apply
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const mongoose = require('mongoose');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');

const TEMPLATE_ID = '68fb535130d19aec696d8123';

const PHASE6_SCENARIOS = [
    'scenario-1766497692378-w082my6vu',  // Non-HVAC Request
    'scenario-1766498036648-0i4ozjq0d',  // Ready to Schedule Appointment
    'scenario-1766498037158-97yvi84s8',  // Reschedule or Cancel Appointment
    'scenario-1764756325353-tilx1716w',  // Thermostat Firmware Update Assistance
    'scenario-1764756671406-j3641wi59',  // Thermostat Not Turning On
    'scenario-1764756977437-i41voveuj',  // Inaccurate Temperature Display Assistance
    'scenario-1764757217340-pn3kgic90',  // Thermostat Communication Troubleshooting
    'scenario-1764757663200-zvt7mv1m0',  // Thermostat Upgrade Inquiry and Scheduling
    'scenario-1764757803076-b3l93jn6r',  // Thermostat Not Turning On System
    'scenario-1764757975475-ueifd0x5y',  // Thermostat Scheduling Setup
];

const MINIMUMS = {
    triggers: 8,
    negativeUserPhrases: 3,
    quickReplies: 7,
    fullReplies: 7
};

// ═══════════════════════════════════════════════════════════════════════════════
// GOLD STANDARD CONTENT
// ═══════════════════════════════════════════════════════════════════════════════

const GOLD_STANDARD_ADDITIONS = {
    // 1. Non-HVAC Request - SMALL_TALK (CRITICAL: polite redirect, prevent tenant contamination)
    'scenario-1766497692378-w082my6vu': {
        triggers: [],
        negativeUserPhrases: [
            'hvac heating cooling air',
            'ac heat furnace thermostat',
            'air conditioning ventilation'
        ],
        quickReplies: [
            "We specialize in HVAC — heating and cooling. For other services, you'd need a different company.",
            "That's outside our expertise. We only do heating, cooling, and air quality. Can I help with any of those?"
        ],
        fullReplies: [
            "I appreciate you calling, but that's not something we handle. We're an HVAC company, which means we specialize in heating, air conditioning, and indoor air quality. For plumbing, electrical, or other home services, you'd need to contact a company that specializes in that. Is there anything HVAC-related I can help you with while I have you?",
            "That's outside our area of expertise — we focus specifically on heating and cooling systems. I wouldn't want to give you bad advice on something we don't do. For that type of work, I'd recommend finding a specialist. But if you ever have air conditioning, heating, or thermostat issues, we're your people! Anything like that I can help with today?",
            "We only handle HVAC services — things like air conditioning repair, furnace issues, thermostats, and air quality. What you're describing sounds like it would need a different type of contractor. I wish I could help more! Is there anything heating or cooling related you need assistance with?",
            "I understand, but that's not a service we provide. Our expertise is strictly heating, ventilation, and air conditioning. For other home services, you'll want to call a company that specializes in that area. If you ever have problems with your AC, heater, or indoor air quality though, we'd be happy to help. Anything else I can do for you today?"
        ]
    },

    // 2. Ready to Schedule Appointment - BOOKING
    'scenario-1766498036648-0i4ozjq0d': {
        triggers: [],
        negativeUserPhrases: [
            'just have questions not scheduling',
            'not ready to book yet',
            'calling for information only'
        ],
        quickReplies: [
            "Great! Let's get you scheduled. What day and time work best for you?",
            "Perfect — I'll get you on the calendar. What's a good day for the appointment?"
        ],
        fullReplies: [
            "Wonderful — let's get you on the schedule! I'll need a few pieces of information: your name, address, phone number, and what day and time work best for you. We offer morning and afternoon windows, and we'll call before the technician arrives so you're not waiting around. What day were you thinking?",
            "I'm glad you're ready to schedule! To get you booked, I'll need your name, service address, contact number, and your preferred day and time. Do you have a preference for morning or afternoon? We'll give you a time window and call ahead before arriving.",
            "Let's do it! I'll grab your information and find a time that works. I need your name, the address where service is needed, a good phone number to reach you, and when you'd like us to come out. Any day this week work for you? Morning or afternoon?",
            "Sounds good — let's get this scheduled right now. I'll need your full name, the service address, your phone number, and what day works best. We can usually accommodate same-day or next-day for urgent issues. What's your availability looking like?"
        ]
    },

    // 3. Reschedule or Cancel Appointment - BOOKING
    'scenario-1766498037158-97yvi84s8': {
        triggers: [],
        negativeUserPhrases: [
            'new appointment not reschedule',
            'first time scheduling',
            'dont have existing appointment'
        ],
        quickReplies: [
            "No problem — I can help you reschedule or cancel. What's your name or the appointment date?",
            "Sure thing! Let me pull up your appointment. Can I get your name or address?"
        ],
        fullReplies: [
            "Absolutely, I can help with that! Let me pull up your appointment. Can you give me your name or the address on the account? Once I find it, I can either move it to a different day that works better or cancel it if needed. Which would you prefer?",
            "No problem at all — we understand schedules change. Let me find your appointment. What's the name or address? I can reschedule you to a more convenient time or cancel if necessary. We just ask for as much notice as possible so we can help other customers.",
            "Of course! Life happens, and we're flexible. Give me your name or address and I'll look up your appointment. Would you like to move it to a different day, or do you need to cancel entirely? Either way, I'll take care of it for you.",
            "Happy to help you reschedule or cancel. What's the name on the appointment, or can you give me the service address? Once I pull it up, we can find a new time that works better or cancel if that's what you need. What would you like to do?"
        ]
    },

    // 4. Thermostat Firmware Update Assistance - TROUBLESHOOT (needs negatives only)
    'scenario-1764756325353-tilx1716w': {
        triggers: [],
        negativeUserPhrases: [
            'thermostat hardware broken',
            'need new thermostat not update',
            'thermostat wont turn on at all'
        ],
        quickReplies: [],
        fullReplies: []
    },

    // 5. Thermostat Not Turning On - EMERGENCY (needs negatives only)
    'scenario-1764756671406-j3641wi59': {
        triggers: [],
        negativeUserPhrases: [
            'thermostat turns on fine',
            'display works just not system',
            'thermostat screen is on'
        ],
        quickReplies: [],
        fullReplies: []
    },

    // 6. Inaccurate Temperature Display Assistance - FAQ (needs negatives only)
    'scenario-1764756977437-i41voveuj': {
        triggers: [],
        negativeUserPhrases: [
            'temperature display is accurate',
            'display shows correct temp',
            'thermostat reading is fine'
        ],
        quickReplies: [],
        fullReplies: []
    },

    // 7. Thermostat Communication Troubleshooting - TROUBLESHOOT (needs negatives only)
    'scenario-1764757217340-pn3kgic90': {
        triggers: [],
        negativeUserPhrases: [
            'thermostat connects fine',
            'wifi working on thermostat',
            'communication is not the issue'
        ],
        quickReplies: [],
        fullReplies: []
    },

    // 8. Thermostat Upgrade Inquiry and Scheduling - BOOKING (needs negatives only)
    'scenario-1764757663200-zvt7mv1m0': {
        triggers: [],
        negativeUserPhrases: [
            'dont want new thermostat',
            'keep current thermostat',
            'just repair not replace'
        ],
        quickReplies: [],
        fullReplies: []
    },

    // 9. Thermostat Not Turning On System - EMERGENCY (needs negatives only)
    'scenario-1764757803076-b3l93jn6r': {
        triggers: [],
        negativeUserPhrases: [
            'system turns on fine',
            'thermostat controls system normally',
            'heating cooling works'
        ],
        quickReplies: [],
        fullReplies: []
    },

    // 10. Thermostat Scheduling Setup - BOOKING (needs negatives only)
    'scenario-1764757975475-ueifd0x5y': {
        triggers: [],
        negativeUserPhrases: [
            'dont need schedule setup',
            'scheduling already works',
            'not about thermostat programming'
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
        console.log('  node scripts/phase6-patch-10.js --dry-run   Preview changes');
        console.log('  node scripts/phase6-patch-10.js --apply     Apply changes');
        process.exit(1);
    }

    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log(isDryRun ? '🔍 PHASE 6: DRY RUN - 10 BOOKING/THERMOSTAT SCENARIOS' : '🚀 PHASE 6: APPLYING - 10 BOOKING/THERMOSTAT SCENARIOS');
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log(`Template ID: ${TEMPLATE_ID}`);
    console.log(`Scenarios to update: ${PHASE6_SCENARIOS.length}`);
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

        for (const scenarioId of PHASE6_SCENARIOS) {
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
            console.log('  node scripts/phase6-patch-10.js --apply');
        } else {
            console.log('✅ APPLIED - Changes written to database\n');
            console.log('To verify, run:');
            console.log('  node scripts/phase6-patch-10.js --dry-run');
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

