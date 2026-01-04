#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * PHASE 1: PATCH 5 WORST SCENARIOS (SCENARIO-OPS COMPLIANT)
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * This script brings the 5 worst scenarios up to enforcement minimums:
 * - triggers: 8 minimum
 * - negativeUserPhrases: 3 minimum
 * - quickReplies: 7 minimum
 * - fullReplies: 7 minimum
 * 
 * USAGE:
 *   DRY RUN:  node scripts/phase1-patch-5-worst.js --dry-run
 *   APPLY:    node scripts/phase1-patch-5-worst.js --apply
 * 
 * REQUIREMENTS:
 *   - MONGODB_URI environment variable set
 *   - Or run from project root with .env file
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const mongoose = require('mongoose');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const TEMPLATE_ID = '68fb535130d19aec696d8123';

const WORST_5_SCENARIOS = [
    'scenario-1761398576855-rreo3z8qk',  // Thermostat heat mode tips
    'scenario-1766497690296-xr652uhx5',  // Caller Vague About Symptoms
    'scenario-1766497690696-t6ba4dew6',  // Needs Repair But Asking for Maintenance
    'scenario-1766497691088-sn21psgwe',  // Needs Maintenance But Describing Like Repair
    'scenario-1766497693608-bjisxlkdp',  // Confirm Appointment
];

// Minimum enforcement requirements
const MINIMUMS = {
    triggers: 8,
    negativeUserPhrases: 3,
    quickReplies: 7,
    fullReplies: 7
};

// ═══════════════════════════════════════════════════════════════════════════════
// GOLD STANDARD CONTENT TO ADD
// (Contextually appropriate for each scenario)
// ═══════════════════════════════════════════════════════════════════════════════

const GOLD_STANDARD_ADDITIONS = {
    // Thermostat heat mode tips - Score 78
    // Current: triggers: 7, negatives: 2, quickReplies: 3, fullReplies: 3
    'scenario-1761398576855-rreo3z8qk': {
        triggers: [
            'change thermostat to heat'  // +1 to reach 8
        ],
        negativeUserPhrases: [
            'cooling mode problem'  // +1 to reach 3
        ],
        quickReplies: [
            "Switch your thermostat to heat mode by pressing the mode button until you see 'Heat' displayed.",
            "Most thermostats have a mode switch - look for Heat, Cool, Auto, and Off options.",
            "If your thermostat is digital, navigate to the main menu and select heating mode.",
            "Make sure the temperature is set higher than the current room temperature for heat to kick on."
        ], // +4 to reach 7
        fullReplies: [
            "To switch your thermostat to heat mode, first locate the mode button or switch on your thermostat. For digital thermostats, press the mode button until 'Heat' appears on the display. For older thermostats, slide the switch from 'Cool' to 'Heat'. Then set your desired temperature a few degrees higher than the current room temperature. The system should start heating within a few minutes. Would you like me to schedule a technician if it doesn't respond?",
            "Great question! Here's how to set your thermostat to heat mode: Look for a mode selector - it might be a button, switch, or touch screen option. Select 'Heat' mode, then adjust the temperature to your comfort level - usually between 68-72°F. If you have a programmable thermostat, you can also set different temperatures for different times of day. Need any help with that?",
            "Setting your thermostat to heat is simple. First, find the mode setting - this is usually labeled 'Heat', 'Cool', 'Auto', or 'Off'. Select 'Heat', then turn the temperature up to your desired setting. Wait about 5 minutes for the system to respond. If you don't feel warm air coming from your vents after 10-15 minutes, there might be an issue we should look at. Should I schedule a diagnostic visit?",
            "I can walk you through that! On most thermostats, you'll find a mode switch or button. Change it from 'Cool' or 'Off' to 'Heat'. Then set your desired temperature - most people find 70-72°F comfortable. Your furnace or heat pump should kick on within a few minutes. If it doesn't respond, it could be a thermostat connection issue or something with the heating system itself. Want me to send a technician to take a look?"
        ] // +4 to reach 7
    },

    // Caller Vague About Symptoms - Score 77
    // Current: triggers: 6, negatives: 2, quickReplies: 5, fullReplies: 3
    'scenario-1766497690296-xr652uhx5': {
        triggers: [
            'something seems different',
            'not performing like before'  // +2 to reach 8
        ],
        negativeUserPhrases: [
            'nothing wrong really'  // +1 to reach 3
        ],
        quickReplies: [
            "Can you tell me more about what feels different? Is it temperature, airflow, or something else?",
            "When did you first notice something wasn't right with your system?"
        ], // +2 to reach 7
        fullReplies: [
            "I understand it can be hard to pinpoint exactly what's wrong. Let's work through this together. When did you first notice something seemed off? Is the system making any unusual sounds? Is the temperature not reaching where you set it? Any details you can share will help me figure out the best next step - whether that's some quick troubleshooting tips or getting a technician out to diagnose it properly.",
            "No worries - sometimes systems just feel 'off' without an obvious issue. A few questions that might help: Is your system running more often than usual? Are some rooms more comfortable than others? Have your energy bills gone up recently? These clues can point us toward what might need attention. If you'd like, I can schedule a diagnostic visit and our technician can do a full system check.",
            "That's actually a common call we get - people sense something's not right even if they can't explain it exactly. Your instincts are usually spot-on! Let's narrow it down: Is the air coming from vents cooler or weaker than normal? Any strange smells or sounds? Is the system cycling on and off frequently? Based on what you tell me, I can either give you some quick checks to try or set up a service call.",
            "I appreciate you calling even when it's hard to describe. Often these 'something's not right' feelings catch problems early before they become bigger issues. Let me ask: How old is your system? When was it last serviced? These factors plus your observations can help us determine if it needs attention. Would you like to schedule a tune-up so we can catch anything that might be developing?"
        ] // +4 to reach 7
    },

    // Needs Repair But Asking for Maintenance - Score 71
    // Current: triggers: 4, negatives: 2, quickReplies: 5, fullReplies: 3
    'scenario-1766497690696-t6ba4dew6': {
        triggers: [
            'tune up but ac is not working',
            'maintenance visit but no cold air',
            'annual service but something is wrong',
            'checkup needed system is loud'  // +4 to reach 8
        ],
        negativeUserPhrases: [
            'everything working fine'  // +1 to reach 3
        ],
        quickReplies: [
            "It sounds like you may need a repair rather than routine maintenance. Let me help you with that.",
            "Based on what you're describing, I'd recommend a diagnostic visit instead of a tune-up."
        ], // +2 to reach 7
        fullReplies: [
            "I hear you - you're calling for a tune-up, but it sounds like there might be an active issue as well. That's actually good timing! When the technician comes out, they can diagnose the problem you're experiencing AND perform the maintenance. We typically recommend addressing the repair first, then doing the maintenance to ensure everything is running smoothly. Should I schedule a diagnostic service call?",
            "Thanks for the details. Since you mentioned the system isn't cooling properly, that goes beyond routine maintenance into repair territory. The good news is our technicians can handle both in one visit. They'll first diagnose and fix the issue, then perform a full system tune-up to make sure everything else is in good shape. This way you get the maintenance you wanted plus get the problem resolved. Would you like me to set that up?",
            "I appreciate you calling for maintenance - that shows you take good care of your system! However, the symptoms you described suggest there's something that needs repair attention first. A tune-up won't fix an active problem, but a service call will. Our tech can diagnose the issue, repair it, and then we can discuss scheduling your maintenance for the future. Does that sound like a good plan?",
            "You're being proactive, which I love! But here's the thing - if your system has an active issue, a standard tune-up won't resolve it. What I recommend is a diagnostic visit where our technician can identify what's causing the problem you described, get it fixed, and then ensure the rest of the system is healthy. This gives you the most value and peace of mind. Want me to schedule that?"
        ] // +4 to reach 7
    },

    // Needs Maintenance But Describing Like Repair - Score 71
    // Current: triggers: 4, negatives: 2, quickReplies: 5, fullReplies: 3
    'scenario-1766497691088-sn21psgwe': {
        triggers: [
            'fix my ac but it works fine',
            'repair needed even though its running',
            'something must be wrong but its cooling',
            'service my system nothing broken'  // +4 to reach 8
        ],
        negativeUserPhrases: [
            'actually broken'  // +1 to reach 3
        ],
        quickReplies: [
            "Since your system is working, it sounds like you're looking for preventive maintenance - great idea!",
            "If everything is running fine, a tune-up is exactly what you need to keep it that way."
        ], // +2 to reach 7
        fullReplies: [
            "I love that you're being proactive! Since your system is actually working fine, what you're describing is preventive maintenance - and that's the best way to keep it running reliably. A tune-up includes cleaning, inspection, and optimization that prevents future problems. It's like an oil change for your car. Would you like to schedule a maintenance visit?",
            "That's smart thinking! If your system is running but you want to make sure it stays that way, preventive maintenance is exactly what you need. Our tune-ups cover cleaning the coils, checking refrigerant levels, inspecting electrical connections, and testing system performance. This keeps your system efficient and helps catch small issues before they become expensive repairs. Should I get you on the schedule?",
            "Good news - since everything is working, you don't need a repair! What you're looking for is a maintenance tune-up, which is actually the smartest thing you can do for your system. Regular maintenance extends the life of your equipment, keeps your energy bills down, and prevents unexpected breakdowns. We recommend twice a year - before summer and before winter. Want me to set that up?",
            "You're ahead of the game! Since your system is functioning properly, preventive maintenance is the way to go. Think of it as a check-up rather than treating an illness. Our technicians will clean, inspect, and optimize your system to ensure it keeps running smoothly. Plus, regular maintenance often catches small issues before they turn into big problems. Would you like to schedule your tune-up?"
        ] // +4 to reach 7
    },

    // Confirm Appointment - Score 79
    // Current: triggers: 7, negatives: 2, quickReplies: 5, fullReplies: 3
    'scenario-1766497693608-bjisxlkdp': {
        triggers: [
            'verify appointment time'  // +1 to reach 8
        ],
        negativeUserPhrases: [
            'need to book new'  // +1 to reach 3
        ],
        quickReplies: [
            "I can look up your appointment right now. Can you give me your name or phone number?",
            "Let me check our schedule for your appointment. What name is it under?"
        ], // +2 to reach 7
        fullReplies: [
            "I'd be happy to confirm your appointment details! To pull up your booking, can you give me your name and the phone number on the account? I'll verify the date, time, and what service is scheduled. If anything needs to change, I can help with that too.",
            "Of course! Let me look that up for you. What's the name and address associated with the appointment? Once I find it, I'll confirm the date, arrival window, and what our technician will be doing. Is there anything specific you wanted to add or change while I have your account up?",
            "Sure thing! I can pull up your appointment right away. What's the phone number or name on the booking? I'll verify all the details for you - the date, the time window you can expect our technician, and the type of service scheduled. Let me know if you need to make any adjustments.",
            "Absolutely! To confirm your appointment, I'll need to look it up in our system. Can you provide the name and phone number you used when booking? I'll give you the full details including your service window and technician information. If the timing no longer works, we can also reschedule while I have you on the line."
        ] // +4 to reach 7
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
        console.log('  node scripts/phase1-patch-5-worst.js --dry-run   Preview changes');
        console.log('  node scripts/phase1-patch-5-worst.js --apply     Apply changes');
        process.exit(1);
    }

    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log(isDryRun ? '🔍 PHASE 1: DRY RUN - 5 WORST SCENARIOS' : '🚀 PHASE 1: APPLYING - 5 WORST SCENARIOS');
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log(`Template ID: ${TEMPLATE_ID}`);
    console.log(`Scenarios to update: ${WORST_5_SCENARIOS.length}`);
    console.log('');

    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        console.error('❌ MONGODB_URI environment variable not set');
        process.exit(1);
    }

    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    try {
        // Load the template
        const template = await GlobalInstantResponseTemplate.findById(TEMPLATE_ID);
        if (!template) {
            console.error(`❌ Template ${TEMPLATE_ID} not found`);
            process.exit(1);
        }

        console.log(`✅ Loaded template: ${template.name}`);
        console.log('');

        // Build patch operations
        const ops = [];
        const report = [];

        for (const scenarioId of WORST_5_SCENARIOS) {
            // Find current scenario
            let currentScenario = null;
            let categoryName = null;

            for (const category of template.categories) {
                const scenario = category.scenarios.find(s => s.scenarioId === scenarioId);
                if (scenario) {
                    currentScenario = scenario;
                    categoryName = category.name;
                    break;
                }
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

            // Calculate what needs to be added
            const setFields = {};
            const changes = [];

            // TRIGGERS
            const currentTriggers = currentScenario.triggers || [];
            if (currentTriggers.length < MINIMUMS.triggers) {
                const newTriggers = [...new Set([...currentTriggers, ...additions.triggers])];
                setFields.triggers = newTriggers;
                changes.push(`triggers: ${currentTriggers.length} → ${newTriggers.length}`);
            }

            // NEGATIVE TRIGGERS
            const currentNegatives = currentScenario.negativeUserPhrases || [];
            if (currentNegatives.length < MINIMUMS.negativeUserPhrases) {
                const newNegatives = [...new Set([...currentNegatives, ...additions.negativeUserPhrases])];
                setFields.negativeUserPhrases = newNegatives;
                changes.push(`negatives: ${currentNegatives.length} → ${newNegatives.length}`);
            }

            // QUICK REPLIES
            const currentQuick = currentScenario.quickReplies || [];
            if (currentQuick.length < MINIMUMS.quickReplies) {
                const newQuick = [...new Set([...currentQuick, ...additions.quickReplies])];
                setFields.quickReplies = newQuick;
                changes.push(`quickReplies: ${currentQuick.length} → ${newQuick.length}`);
            }

            // FULL REPLIES
            const currentFull = currentScenario.fullReplies || [];
            if (currentFull.length < MINIMUMS.fullReplies) {
                const newFull = [...new Set([...currentFull, ...additions.fullReplies])];
                setFields.fullReplies = newFull;
                changes.push(`fullReplies: ${currentFull.length} → ${newFull.length}`);
            }

            if (Object.keys(setFields).length > 0) {
                ops.push({
                    op: 'update',
                    scenarioId,
                    set: setFields
                });

                report.push({
                    scenarioId,
                    name: currentScenario.name,
                    category: categoryName,
                    changes
                });
            } else {
                console.log(`ℹ️  ${currentScenario.name} - already meets minimums`);
            }
        }

        // Display report
        console.log('');
        console.log('📋 PATCH REPORT');
        console.log('─────────────────────────────────────────────────────────────────────────────');
        
        for (const item of report) {
            console.log(`📝 ${item.name}`);
            console.log(`   Category: ${item.category}`);
            console.log(`   Changes:`);
            for (const change of item.changes) {
                console.log(`   • ${change}`);
            }
            console.log('');
        }

        console.log(`Total operations: ${ops.length}`);
        console.log('');

        if (isDryRun) {
            console.log('🔍 DRY RUN - No changes written');
            console.log('');
            console.log('To apply these changes, run:');
            console.log('  node scripts/phase1-patch-5-worst.js --apply');
        } else {
            // Apply changes directly to the template
            console.log('🚀 APPLYING CHANGES...');
            
            for (const op of ops) {
                for (const category of template.categories) {
                    const scenario = category.scenarios.find(s => s.scenarioId === op.scenarioId);
                    if (scenario) {
                        // Apply the set fields
                        for (const [key, value] of Object.entries(op.set)) {
                            scenario[key] = value;
                        }
                        // Enforce GLOBAL scope
                        scenario.scope = 'GLOBAL';
                        scenario.ownerCompanyId = null;
                        scenario.updatedAt = new Date();
                        break;
                    }
                }
            }

            template.updatedAt = new Date();
            template.lastUpdatedBy = 'phase1-patch-script';
            await template.save();

            console.log('');
            console.log('✅ CHANGES APPLIED SUCCESSFULLY');
            console.log('');

            // Verify
            console.log('📊 VERIFICATION - New counts:');
            const verifyTemplate = await GlobalInstantResponseTemplate.findById(TEMPLATE_ID).lean();
            
            for (const scenarioId of WORST_5_SCENARIOS) {
                for (const category of verifyTemplate.categories) {
                    const scenario = category.scenarios.find(s => s.scenarioId === scenarioId);
                    if (scenario) {
                        const meets = 
                            (scenario.triggers?.length || 0) >= MINIMUMS.triggers &&
                            (scenario.negativeUserPhrases?.length || 0) >= MINIMUMS.negativeUserPhrases &&
                            (scenario.quickReplies?.length || 0) >= MINIMUMS.quickReplies &&
                            (scenario.fullReplies?.length || 0) >= MINIMUMS.fullReplies;
                        
                        const status = meets ? '✅' : '⚠️';
                        console.log(`${status} ${scenario.name}`);
                        console.log(`   triggers: ${scenario.triggers?.length || 0}, negatives: ${scenario.negativeUserPhrases?.length || 0}, quickReplies: ${scenario.quickReplies?.length || 0}, fullReplies: ${scenario.fullReplies?.length || 0}`);
                        console.log(`   scope: ${scenario.scope}, ownerCompanyId: ${scenario.ownerCompanyId || 'null'}`);
                        break;
                    }
                }
            }
        }

    } finally {
        await mongoose.disconnect();
        console.log('');
        console.log('✅ Disconnected from MongoDB');
    }
}

main().catch(err => {
    console.error('❌ Script failed:', err);
    process.exit(1);
});

