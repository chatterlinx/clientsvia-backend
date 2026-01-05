/**
 * ============================================================================
 * FIX PENGUIN AIR WIRING - Enable Scenarios + Fix Booking Slots
 * ============================================================================
 * 
 * This script fixes the two critical blockers identified by the Wiring Tab:
 * 
 * 1. KILL SWITCHES: Set forceLLMDiscovery=false, disableScenarioAutoResponses=false
 * 2. BOOKING SLOTS: Add missing 'question' field to all slots
 * 
 * Run with: node scripts/fix-penguin-air-wiring.js --dry-run
 * Apply with: node scripts/fix-penguin-air-wiring.js --apply
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const Company = require('../models/v2Company');

const COMPANY_ID = '68e3f77a9d623b8058c700c4'; // Penguin Air

// ============================================================================
// BOOKING SLOT QUESTIONS (the missing piece)
// ============================================================================

const SLOT_QUESTIONS = {
    'firstName': "What's your first name?",
    'lastName': "And your last name?",
    'name': "May I have your name please?",
    'phone': "What's the best phone number for the technician to reach you?",
    'address': "What's the service address?",
    'serviceType': "Is this for repair, maintenance, or a new installation?",
    'problemDescription': "Can you briefly describe what the system is doing?",
    'timeWindow': "Do you prefer morning (8-12) or afternoon (12-5)?",
    'email': "What's your email address for the confirmation?",
    'preferredDate': "What day works best for you?",
    // Fallback for any unknown slot type
    'default': "Could you please provide that information?"
};

async function run(dryRun) {
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log(`🔧 FIX PENGUIN AIR WIRING: ${dryRun ? 'DRY RUN' : 'APPLYING CHANGES'}`);
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log(`Company ID: ${COMPANY_ID}`);
    console.log('');

    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        console.error('❌ MONGODB_URI environment variable not set');
        process.exit(1);
    }

    try {
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB\n');

        // Load company
        const company = await Company.findById(COMPANY_ID);
        if (!company) {
            console.error(`❌ Company not found: ${COMPANY_ID}`);
            process.exit(1);
        }
        console.log(`✅ Loaded company: ${company.companyName || company.businessName}\n`);

        const changes = {
            killSwitches: { before: {}, after: {} },
            bookingSlots: { before: [], after: [] }
        };

        // ====================================================================
        // FIX 1: KILL SWITCHES
        // ====================================================================
        console.log('📋 FIX 1: KILL SWITCHES');
        console.log('────────────────────────────────────────────────────────────');

        const discoveryConsent = company.aiAgentSettings?.frontDeskBehavior?.discoveryConsent || {};
        
        changes.killSwitches.before = {
            forceLLMDiscovery: discoveryConsent.forceLLMDiscovery ?? 'undefined',
            disableScenarioAutoResponses: discoveryConsent.disableScenarioAutoResponses ?? 'undefined'
        };

        console.log('Before:');
        console.log(`  forceLLMDiscovery: ${changes.killSwitches.before.forceLLMDiscovery}`);
        console.log(`  disableScenarioAutoResponses: ${changes.killSwitches.before.disableScenarioAutoResponses}`);

        changes.killSwitches.after = {
            forceLLMDiscovery: false,
            disableScenarioAutoResponses: false
        };

        console.log('After:');
        console.log(`  forceLLMDiscovery: ${changes.killSwitches.after.forceLLMDiscovery}`);
        console.log(`  disableScenarioAutoResponses: ${changes.killSwitches.after.disableScenarioAutoResponses}`);
        console.log('');

        // ====================================================================
        // FIX 2: BOOKING SLOTS
        // ====================================================================
        console.log('📋 FIX 2: BOOKING SLOTS');
        console.log('────────────────────────────────────────────────────────────');

        const bookingSlots = company.aiAgentSettings?.frontDeskBehavior?.bookingSlots || [];
        console.log(`Found ${bookingSlots.length} booking slots\n`);

        const updatedSlots = [];
        let fixedCount = 0;

        for (const slot of bookingSlots) {
            const slotId = slot.id || slot.slotId || slot.type || 'unknown';
            const hadQuestion = !!(slot.question || slot.prompt);
            
            changes.bookingSlots.before.push({
                id: slotId,
                type: slot.type,
                hasQuestion: hadQuestion,
                question: slot.question || slot.prompt || null
            });

            // Create updated slot
            const updatedSlot = { ...slot.toObject ? slot.toObject() : slot };
            
            if (!updatedSlot.question && !updatedSlot.prompt) {
                // Add question based on slot id/type
                const question = SLOT_QUESTIONS[slotId] || 
                                SLOT_QUESTIONS[slot.type] || 
                                SLOT_QUESTIONS['default'];
                updatedSlot.question = question;
                fixedCount++;
                console.log(`✏️  ${slotId}: Added question "${question}"`);
            } else {
                console.log(`✓  ${slotId}: Already has question`);
            }

            updatedSlots.push(updatedSlot);
            
            changes.bookingSlots.after.push({
                id: slotId,
                type: slot.type,
                hasQuestion: true,
                question: updatedSlot.question || updatedSlot.prompt
            });
        }

        console.log(`\nSlots fixed: ${fixedCount}/${bookingSlots.length}`);
        console.log('');

        // ====================================================================
        // APPLY CHANGES
        // ====================================================================
        if (!dryRun) {
            console.log('💾 APPLYING CHANGES...');
            console.log('────────────────────────────────────────────────────────────');

            // Initialize nested paths if they don't exist
            if (!company.aiAgentSettings) {
                company.aiAgentSettings = {};
            }
            if (!company.aiAgentSettings.frontDeskBehavior) {
                company.aiAgentSettings.frontDeskBehavior = {};
            }
            if (!company.aiAgentSettings.frontDeskBehavior.discoveryConsent) {
                company.aiAgentSettings.frontDeskBehavior.discoveryConsent = {};
            }

            // Apply kill switch fixes
            company.aiAgentSettings.frontDeskBehavior.discoveryConsent.forceLLMDiscovery = false;
            company.aiAgentSettings.frontDeskBehavior.discoveryConsent.disableScenarioAutoResponses = false;

            // Apply booking slot fixes
            company.aiAgentSettings.frontDeskBehavior.bookingSlots = updatedSlots;

            // Mark modified
            company.markModified('aiAgentSettings');

            await company.save();
            console.log('✅ Changes saved to database\n');

            // Clear Redis cache for this company
            try {
                const redisFactory = require('../utils/redisFactory');
                const redis = redisFactory.getClient();
                if (redis) {
                    const cacheKey = `scenario-pool:${COMPANY_ID}`;
                    await redis.del(cacheKey);
                    console.log(`✅ Cleared Redis cache: ${cacheKey}`);
                }
            } catch (e) {
                console.log(`⚠️  Could not clear Redis cache: ${e.message}`);
            }

        } else {
            console.log('🔍 DRY RUN - No changes written');
            console.log('To apply these changes, run:');
            console.log('  node scripts/fix-penguin-air-wiring.js --apply');
        }

        console.log('');
        console.log('═══════════════════════════════════════════════════════════════════════════');
        console.log('📊 SUMMARY');
        console.log('═══════════════════════════════════════════════════════════════════════════');
        console.log(`Kill Switches: ${changes.killSwitches.before.forceLLMDiscovery} → false`);
        console.log(`               ${changes.killSwitches.before.disableScenarioAutoResponses} → false`);
        console.log(`Booking Slots: ${fixedCount} slots fixed (added question field)`);
        console.log('');
        console.log('After applying, re-run the Wiring Report to verify:');
        console.log('  - Kill Switches: should be GREEN (SCENARIOS_ENABLED)');
        console.log('  - Booking Slots: should be GREEN (ALL_VALID)');
        console.log('');

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('✅ Disconnected from MongoDB');
    }
}

// Parse arguments
const args = process.argv.slice(2);
const dryRun = !args.includes('--apply');

run(dryRun);

