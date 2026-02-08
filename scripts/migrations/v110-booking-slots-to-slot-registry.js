#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * V110 MIGRATION: Legacy bookingSlots → slotRegistry + bookingFlow
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE:
 * Converts legacy aiAgentSettings.frontDeskBehavior.bookingSlots to the new
 * V110 architecture:
 * - slotRegistry: Single source of truth for slot definitions
 * - bookingFlow: Step-by-step prompts and confirmation flows
 * 
 * WHAT IT DOES:
 * 1. Reads each company's legacy bookingSlots
 * 2. Creates slotRegistry.slots from slot definitions
 * 3. Creates bookingFlow.steps from slot prompts
 * 4. Preserves all existing prompts, reprompts, confirmPrompts
 * 5. Sets _v110Migrated flag to track migration status
 * 
 * USAGE:
 *   node scripts/migrations/v110-booking-slots-to-slot-registry.js --dry-run
 *   node scripts/migrations/v110-booking-slots-to-slot-registry.js
 *   node scripts/migrations/v110-booking-slots-to-slot-registry.js --company-id=<id>
 * 
 * OPTIONS:
 *   --dry-run       Preview changes without writing to database
 *   --company-id    Migrate a single company (for testing)
 *   --force         Migrate even if already migrated
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const mongoose = require('mongoose');
require('dotenv').config();

// ═══════════════════════════════════════════════════════════════════════════════
// CLI ARGS
// ═══════════════════════════════════════════════════════════════════════════════
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');
const companyIdArg = args.find(a => a.startsWith('--company-id='));
const SINGLE_COMPANY_ID = companyIdArg ? companyIdArg.split('=')[1] : null;

console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('V110 MIGRATION: Legacy bookingSlots → slotRegistry + bookingFlow');
console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log(`Mode: ${DRY_RUN ? '🔍 DRY RUN (no changes will be made)' : '💾 LIVE (changes will be written)'}`);
if (SINGLE_COMPANY_ID) console.log(`Target: Single company ${SINGLE_COMPANY_ID}`);
if (FORCE) console.log('Force: Will re-migrate even if already migrated');
console.log('═══════════════════════════════════════════════════════════════════════════════\n');

// ═══════════════════════════════════════════════════════════════════════════════
// MIGRATION LOGIC
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Convert a legacy bookingSlot to V110 slot registry entry
 */
function convertToSlotRegistryEntry(legacySlot, index) {
    const slotId = legacySlot.slotId || legacySlot.id || legacySlot.key || `slot_${index}`;
    
    return {
        id: slotId,
        type: mapLegacyTypeToV110(legacySlot.type, slotId),
        label: legacySlot.label || slotId,
        required: legacySlot.required !== false,
        discoveryFillAllowed: legacySlot.discoveryFillAllowed !== false,
        bookingConfirmRequired: legacySlot.bookingConfirmRequired !== false,
        extraction: {
            source: ['utterance'],
            confidenceMin: 0.70,
            ...legacySlot.extraction
        },
        // Preserve any additional legacy config
        ...(legacySlot.addressPolicy && { addressPolicy: legacySlot.addressPolicy }),
        ...(legacySlot.options && { options: legacySlot.options }),
        ...(legacySlot.nameOptions && { nameOptions: legacySlot.nameOptions }),
        ...(legacySlot.confirmSpelling !== undefined && { confirmSpelling: legacySlot.confirmSpelling }),
        ...(legacySlot.askFullName !== undefined && { askFullName: legacySlot.askFullName }),
        ...(legacySlot.askMissingNamePart !== undefined && { askMissingNamePart: legacySlot.askMissingNamePart })
    };
}

/**
 * Map legacy slot types to V110 types
 */
function mapLegacyTypeToV110(legacyType, slotId) {
    const typeMap = {
        'text': 'text',
        'name': 'name_first',
        'name_first': 'name_first',
        'name_last': 'name_last',
        'phone': 'phone',
        'address': 'address',
        'time': 'time',
        'email': 'email',
        'date': 'date'
    };
    
    // If type is explicitly set, use it
    if (legacyType && typeMap[legacyType]) {
        return typeMap[legacyType];
    }
    
    // Infer from slotId
    if (slotId === 'name' || slotId === 'firstName') return 'name_first';
    if (slotId === 'lastName') return 'name_last';
    if (slotId === 'phone') return 'phone';
    if (slotId === 'address') return 'address';
    if (slotId === 'time') return 'time';
    if (slotId === 'email') return 'email';
    
    return 'text';
}

/**
 * Convert a legacy bookingSlot to V110 booking flow step
 */
function convertToBookingFlowStep(legacySlot, index) {
    const slotId = legacySlot.slotId || legacySlot.id || legacySlot.key || `slot_${index}`;
    
    return {
        stepId: `b${index + 1}`,
        slotId: slotId,
        order: legacySlot.order || index + 1,
        
        // Primary prompt
        ask: legacySlot.question || legacySlot.prompt || getDefaultPrompt(slotId),
        
        // Confirmation prompt (for values captured in discovery)
        confirmPrompt: legacySlot.confirmPrompt || getDefaultConfirmPrompt(slotId),
        
        // Reprompts for retry
        reprompt: legacySlot.reprompt || legacySlot.question || getDefaultReprompt(slotId),
        repromptVariants: legacySlot.repromptVariants || [],
        
        // Confirmation retry
        confirmRetryPrompt: legacySlot.confirmRetryPrompt || null,
        
        // Correction (user said "no" to confirmation)
        correctionPrompt: legacySlot.correctionPrompt || null,
        
        // Name-specific prompts
        ...(slotId === 'name' && {
            lastNameQuestion: legacySlot.lastNameQuestion || "And what's your last name?",
            firstNameQuestion: legacySlot.firstNameQuestion || legacySlot.question || "What's your first name?"
        })
    };
}

/**
 * Default prompts by slot type (only used if legacy has no prompt)
 */
function getDefaultPrompt(slotId) {
    const defaults = {
        name: "What's your first name?",
        lastName: "And what's your last name?",
        phone: "What's the best phone number to reach you?",
        address: "What's the service address?",
        time: "What time works best for you?",
        email: "What's your email address?"
    };
    return defaults[slotId] || `What is your ${slotId}?`;
}

function getDefaultConfirmPrompt(slotId) {
    const defaults = {
        name: "Ok — I assume {value} is your first name, is that correct?",
        lastName: "I've got {value} as your last name. Is that right?",
        phone: "I have your number as {value}. Is that the best number to reach you?",
        address: "I have your address as {value}. Is that correct?",
        time: "I have your preferred time as {value}. Is that right?"
    };
    return defaults[slotId] || `I have {value} for ${slotId}. Is that correct?`;
}

function getDefaultReprompt(slotId) {
    const defaults = {
        name: "I didn't catch that. What's your first name?",
        lastName: "What's your last name?",
        phone: "Can you repeat your phone number?",
        address: "What's the service address?",
        time: "What time works best for you?"
    };
    return defaults[slotId] || `Could you repeat your ${slotId}?`;
}

/**
 * Migrate a single company
 */
async function migrateCompany(Company, company) {
    const companyId = company._id.toString();
    const companyName = company.name || 'Unknown';
    
    const frontDesk = company.aiAgentSettings?.frontDeskBehavior || {};
    const legacySlots = frontDesk.bookingSlots || [];
    
    // Check if already migrated
    if (frontDesk.slotRegistry?._v110Migrated && !FORCE) {
        console.log(`  ⏭️  ${companyName} (${companyId}): Already migrated, skipping`);
        return { status: 'skipped', reason: 'already_migrated' };
    }
    
    // Check if has legacy slots to migrate
    if (!legacySlots || legacySlots.length === 0) {
        console.log(`  ⏭️  ${companyName} (${companyId}): No legacy bookingSlots to migrate`);
        return { status: 'skipped', reason: 'no_legacy_slots' };
    }
    
    console.log(`\n  📦 ${companyName} (${companyId}):`);
    console.log(`     Legacy slots: ${legacySlots.length}`);
    legacySlots.forEach((slot, i) => {
        const id = slot.slotId || slot.id || slot.key || `slot_${i}`;
        console.log(`       [${i + 1}] ${id} (type: ${slot.type || 'inferred'})`);
    });
    
    // Convert to V110 structure
    const slotRegistrySlots = legacySlots.map((slot, i) => convertToSlotRegistryEntry(slot, i));
    const bookingFlowSteps = legacySlots.map((slot, i) => convertToBookingFlowStep(slot, i));
    
    const slotRegistry = {
        version: 'v1',
        slots: slotRegistrySlots,
        _v110Migrated: true,
        _migratedAt: new Date().toISOString(),
        _migratedFrom: 'bookingSlots'
    };
    
    const bookingFlow = {
        version: 'v1',
        enabled: true,
        confirmCapturedFirst: true,
        steps: bookingFlowSteps,
        _v110Migrated: true,
        _migratedAt: new Date().toISOString(),
        _migratedFrom: 'bookingSlots'
    };
    
    console.log(`     → V110 slotRegistry: ${slotRegistrySlots.length} slots`);
    console.log(`     → V110 bookingFlow: ${bookingFlowSteps.length} steps`);
    
    if (DRY_RUN) {
        console.log(`     ✅ DRY RUN: Would migrate ${legacySlots.length} slots`);
        return { status: 'dry_run', slotCount: legacySlots.length };
    }
    
    // Apply migration
    try {
        await Company.updateOne(
            { _id: company._id },
            {
                $set: {
                    'aiAgentSettings.frontDeskBehavior.slotRegistry': slotRegistry,
                    'aiAgentSettings.frontDeskBehavior.bookingFlow': bookingFlow
                }
            }
        );
        
        console.log(`     ✅ Migrated ${legacySlots.length} slots to V110`);
        return { status: 'migrated', slotCount: legacySlots.length };
    } catch (err) {
        console.log(`     ❌ ERROR: ${err.message}`);
        return { status: 'error', error: err.message };
    }
}

/**
 * Main migration function
 */
async function runMigration() {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!mongoUri) {
        console.error('❌ ERROR: MONGODB_URI or MONGO_URI environment variable not set');
        process.exit(1);
    }
    
    try {
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB\n');
        
        const Company = require('../../models/v2Company');
        
        // Build query
        let query = { 'aiAgentSettings.frontDeskBehavior.bookingSlots.0': { $exists: true } };
        if (SINGLE_COMPANY_ID) {
            query._id = SINGLE_COMPANY_ID;
        }
        
        // Find companies with legacy booking slots
        const companies = await Company.find(query).lean();
        console.log(`Found ${companies.length} companies with legacy bookingSlots\n`);
        
        if (companies.length === 0) {
            console.log('No companies to migrate. Exiting.');
            await mongoose.disconnect();
            return;
        }
        
        // Track results
        const results = {
            migrated: 0,
            skipped: 0,
            errors: 0,
            dry_run: 0,
            totalSlots: 0
        };
        
        // Migrate each company
        for (const company of companies) {
            const result = await migrateCompany(Company, company);
            
            if (result.status === 'migrated' || result.status === 'dry_run') {
                results[result.status]++;
                results.totalSlots += result.slotCount || 0;
            } else if (result.status === 'skipped') {
                results.skipped++;
            } else if (result.status === 'error') {
                results.errors++;
            }
        }
        
        // Print summary
        console.log('\n═══════════════════════════════════════════════════════════════════════════════');
        console.log('MIGRATION SUMMARY');
        console.log('═══════════════════════════════════════════════════════════════════════════════');
        if (DRY_RUN) {
            console.log(`  Would migrate: ${results.dry_run} companies (${results.totalSlots} total slots)`);
        } else {
            console.log(`  Migrated: ${results.migrated} companies (${results.totalSlots} total slots)`);
        }
        console.log(`  Skipped: ${results.skipped} companies`);
        if (results.errors > 0) {
            console.log(`  Errors: ${results.errors} companies`);
        }
        console.log('═══════════════════════════════════════════════════════════════════════════════');
        
        if (DRY_RUN) {
            console.log('\n💡 This was a dry run. Run without --dry-run to apply changes.');
        }
        
        await mongoose.disconnect();
        console.log('\n✅ Done');
        
    } catch (err) {
        console.error('❌ Migration failed:', err);
        await mongoose.disconnect();
        process.exit(1);
    }
}

// Run the migration
runMigration();
