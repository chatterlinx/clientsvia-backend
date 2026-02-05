/**
 * ============================================================================
 * FIX DIRECT INTENT PATTERNS - Critical Booking Flow Configuration
 * ============================================================================
 * 
 * This script fixes the CRITICAL MISCONFIGURED field identified by the Wiring Report:
 * 
 * Field: booking.directIntentPatterns
 * DB Path: aiAgentSettings.frontDeskBehavior.bookingFlow.directIntentPatterns
 * Issue: Required field is UNDEFINED in database
 * 
 * Without this array, phrases like:
 *   - "How soon can you get somebody out here?"
 *   - "Send someone out today"
 *   - "When can you come?"
 * ...will NOT trigger direct booking intent and get stuck in normal conversation.
 * 
 * Run with: node scripts/fix-direct-intent-patterns.js --dry-run
 * Apply with: node scripts/fix-direct-intent-patterns.js --apply
 * Check with: node scripts/fix-direct-intent-patterns.js --check
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const Company = require('../models/v2Company');

const COMPANY_ID = '68e3f77a9d623b8058c700c4'; // Penguin Air

// ============================================================================
// DIRECT INTENT PATTERNS - Triggers immediate booking flow
// ============================================================================
// These patterns are matched using substring/contains on normalized text.
// When detected, the system skips the consent question and enters booking directly.
// ============================================================================

const DIRECT_INTENT_PATTERNS = [
    // Explicit service requests
    'get somebody out',
    'get someone out',
    'get a tech out',
    'get a technician out',
    'send someone',
    'send somebody out',
    'send a tech',
    'need someone out',
    
    // Timing/urgency requests
    'when can you come',
    'can you come out',
    'how soon can you',
    'come out today',
    'come out tomorrow',
    
    // Urgency indicators
    'asap',
    'soonest',
    'earliest',
    'first available'
];

async function run(dryRun) {
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log(`🔧 FIX DIRECT INTENT PATTERNS: ${dryRun ? 'DRY RUN' : 'APPLYING CHANGES'}`);
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log(`Company ID: ${COMPANY_ID}`);
    console.log(`DB Path: aiAgentSettings.frontDeskBehavior.bookingFlow.directIntentPatterns`);
    console.log('');

    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        console.error('❌ MONGODB_URI environment variable not set');
        console.error('');
        console.error('To run against production, set the MONGODB_URI:');
        console.error('  MONGODB_URI="mongodb+srv://..." node scripts/fix-direct-intent-patterns.js --apply');
        process.exit(1);
    }

    // Show which database we're connecting to (mask credentials)
    const maskedUri = mongoUri.replace(/:\/\/[^@]+@/, '://***:***@');
    console.log(`🔌 Connecting to: ${maskedUri}\n`);

    try {
        await mongoose.connect(mongoUri);
        console.log(`✅ Connected to MongoDB (database: ${mongoose.connection.name})\n`);

        // Load company
        const company = await Company.findById(COMPANY_ID);
        if (!company) {
            console.error(`❌ Company not found: ${COMPANY_ID}`);
            console.error('');
            console.error('Verify you are connected to the correct database.');
            console.error(`Current database: ${mongoose.connection.name}`);
            process.exit(1);
        }
        console.log(`✅ Found company: ${company.companyName || company.businessName}`);
        console.log('');

        // ====================================================================
        // SHOW CURRENT STATE
        // ====================================================================
        console.log('📋 CURRENT STATE');
        console.log('────────────────────────────────────────────────────────────');

        const frontDeskBehavior = company.aiAgentSettings?.frontDeskBehavior || {};
        const bookingFlow = frontDeskBehavior.bookingFlow || {};
        const currentPatterns = bookingFlow.directIntentPatterns;

        if (currentPatterns === undefined) {
            console.log('directIntentPatterns: undefined (MISCONFIGURED - Critical!)');
        } else if (Array.isArray(currentPatterns)) {
            console.log(`directIntentPatterns: [${currentPatterns.length} patterns]`);
            currentPatterns.forEach((p, i) => console.log(`  ${i + 1}. "${p}"`));
        } else {
            console.log(`directIntentPatterns: ${typeof currentPatterns} (invalid type)`);
        }
        console.log('');

        // If check-only mode, exit here
        if (checkOnly) {
            const isConfigured = Array.isArray(currentPatterns) && currentPatterns.length > 0;
            console.log(`✅ CHECK RESULT: ${isConfigured ? 'CONFIGURED' : 'MISCONFIGURED'}`);
            process.exit(isConfigured ? 0 : 1);
        }

        // ====================================================================
        // SHOW NEW STATE
        // ====================================================================
        console.log('📋 NEW STATE (after fix)');
        console.log('────────────────────────────────────────────────────────────');
        console.log(`directIntentPatterns: [${DIRECT_INTENT_PATTERNS.length} patterns]`);
        DIRECT_INTENT_PATTERNS.forEach((p, i) => console.log(`  ${i + 1}. "${p}"`));
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
            if (!company.aiAgentSettings.frontDeskBehavior.bookingFlow) {
                company.aiAgentSettings.frontDeskBehavior.bookingFlow = {};
            }

            // Apply the fix
            company.aiAgentSettings.frontDeskBehavior.bookingFlow.directIntentPatterns = DIRECT_INTENT_PATTERNS;

            // Mark modified (required for nested objects in Mongoose)
            company.markModified('aiAgentSettings');

            await company.save();
            console.log('✅ Changes saved to database\n');

            // Verify the save
            const verification = await Company.findById(COMPANY_ID);
            const savedPatterns = verification.aiAgentSettings?.frontDeskBehavior?.bookingFlow?.directIntentPatterns;
            
            if (Array.isArray(savedPatterns) && savedPatterns.length === DIRECT_INTENT_PATTERNS.length) {
                console.log(`✅ Verified: ${savedPatterns.length} patterns saved correctly\n`);
            } else {
                console.error('❌ Verification failed! Patterns may not have saved correctly.');
                console.error('Saved value:', savedPatterns);
            }

            // Clear Redis cache for this company
            try {
                const redisFactory = require('../utils/redisFactory');
                const redis = redisFactory.getClient();
                if (redis) {
                    // Clear scenario pool cache
                    await redis.del(`scenario-pool:${COMPANY_ID}`);
                    // Clear company config cache
                    await redis.del(`company:${COMPANY_ID}`);
                    await redis.del(`company-config:${COMPANY_ID}`);
                    console.log(`✅ Cleared Redis cache for company ${COMPANY_ID}`);
                }
            } catch (e) {
                console.log(`⚠️  Could not clear Redis cache: ${e.message}`);
                console.log('   You may need to restart the server or wait for cache expiry.');
            }

        } else {
            console.log('🔍 DRY RUN - No changes written');
            console.log('');
            console.log('To apply these changes, run:');
            console.log('  MONGODB_URI="your-production-uri" node scripts/fix-direct-intent-patterns.js --apply');
        }

        console.log('');
        console.log('═══════════════════════════════════════════════════════════════════════════');
        console.log('📊 SUMMARY');
        console.log('═══════════════════════════════════════════════════════════════════════════');
        console.log(`Before: ${currentPatterns === undefined ? 'undefined (MISCONFIGURED)' : `${currentPatterns?.length || 0} patterns`}`);
        console.log(`After:  ${DIRECT_INTENT_PATTERNS.length} patterns configured`);
        console.log('');
        console.log('🧪 VERIFICATION STEPS:');
        console.log('────────────────────────────────────────────────────────────');
        console.log('1. Make a test call saying: "How soon can you get somebody out?"');
        console.log('2. Upload the raw-events file');
        console.log('3. Verify these 4 proof points in raw-events:');
        console.log('   ✅ bookingFlow.directIntentPatterns resolvedFrom=companyConfig');
        console.log('   ✅ directIntent.matched=true (or wantsBooking matched)');
        console.log('   ✅ bookingModeLocked flips to true');
        console.log('   ✅ BookingFlowRunner owns the response (asks booking prompt)');
        console.log('');
        console.log('After applying, re-run the Wiring Report to verify:');
        console.log('  - booking.directIntentPatterns: should be GREEN (no longer MISCONFIGURED)');
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
const checkOnly = args.includes('--check');

run(dryRun);
