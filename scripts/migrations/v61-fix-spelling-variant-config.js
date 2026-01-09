/**
 * V61: Fix Spelling Variant Configuration
 * 
 * ISSUE: Spelling variants not being triggered because:
 * 1. Slot-level `confirmSpelling` field missing or false
 * 2. Global `nameSpellingVariants.enabled` missing or false
 * 
 * THIS SCRIPT:
 * - Finds the name slot in bookingSlots and sets confirmSpelling: true
 * - Sets nameSpellingVariants.enabled: true at global level
 * - Only updates if not already correctly configured
 * 
 * SAFE TO RUN MULTIPLE TIMES (idempotent)
 * 
 * RUN: node scripts/migrations/v61-fix-spelling-variant-config.js
 * ENV: Requires MONGODB_URI and REDIS_URL
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Pre-built variant pairs for enterprise quality
const DEFAULT_VARIANT_GROUPS = [
    { base: 'Mark', variants: ['Marc'] },
    { base: 'Brian', variants: ['Bryan', 'Bryon'] },
    { base: 'Eric', variants: ['Erik'] },
    { base: 'Steven', variants: ['Stephen'] },
    { base: 'Sara', variants: ['Sarah'] },
    { base: 'John', variants: ['Jon'] },
    { base: 'Kristina', variants: ['Christina'] },
    { base: 'Catherine', variants: ['Katherine', 'Kathryn'] },
    { base: 'Philip', variants: ['Phillip'] },
    { base: 'Jeffrey', variants: ['Geoffrey'] },
    { base: 'Allan', variants: ['Alan', 'Allen'] },
    { base: 'Anne', variants: ['Ann'] }
];

async function run() {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('V61: Fix Spelling Variant Configuration');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        console.error('❌ MONGODB_URI not set');
        process.exit(1);
    }
    
    console.log('📦 Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');
    
    // Get the Company model
    const Company = mongoose.model('Company', new mongoose.Schema({}, { strict: false }), 'companiesCollection');
    
    // Find all companies with bookingSlots
    const companies = await Company.find({
        'aiAgentSettings.frontDeskBehavior.bookingSlots': { $exists: true, $ne: [] }
    }).lean();
    
    console.log(`📊 Found ${companies.length} companies with booking slots\n`);
    
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const company of companies) {
        const companyId = company._id;
        const companyName = company.companyName || company.name || companyId;
        
        console.log(`\n─────────────────────────────────────────────────────────────`);
        console.log(`🏢 Processing: ${companyName}`);
        console.log(`   ID: ${companyId}`);
        
        try {
            const frontDesk = company.aiAgentSettings?.frontDeskBehavior || {};
            const bookingSlots = frontDesk.bookingSlots || [];
            const nameSpelling = frontDesk.nameSpellingVariants || {};
            
            // Check current state
            const nameSlot = bookingSlots.find(s => s.type === 'name' || s.id === 'name' || s.slotId === 'name');
            const hasConfirmSpelling = nameSlot?.confirmSpelling === true;
            const hasGlobalEnabled = nameSpelling.enabled === true;
            
            console.log(`   Current state:`);
            console.log(`     - Name slot found: ${nameSlot ? 'YES' : 'NO'}`);
            console.log(`     - confirmSpelling: ${hasConfirmSpelling ? '✅ TRUE' : '❌ FALSE/MISSING'}`);
            console.log(`     - nameSpellingVariants.enabled: ${hasGlobalEnabled ? '✅ TRUE' : '❌ FALSE/MISSING'}`);
            
            // Skip if already correctly configured
            if (hasConfirmSpelling && hasGlobalEnabled) {
                console.log(`   ⏭️  Already correctly configured - skipping`);
                skipped++;
                continue;
            }
            
            // Build the update
            const updateOps = {};
            
            // Fix 1: Set confirmSpelling on name slot
            if (!hasConfirmSpelling && nameSlot) {
                const slotIndex = bookingSlots.findIndex(s => s.type === 'name' || s.id === 'name' || s.slotId === 'name');
                if (slotIndex >= 0) {
                    updateOps[`aiAgentSettings.frontDeskBehavior.bookingSlots.${slotIndex}.confirmSpelling`] = true;
                    console.log(`   📝 Will set confirmSpelling: true on slot index ${slotIndex}`);
                }
            }
            
            // Fix 2: Set global nameSpellingVariants config
            if (!hasGlobalEnabled) {
                updateOps['aiAgentSettings.frontDeskBehavior.nameSpellingVariants'] = {
                    enabled: true,
                    source: 'auto_scan',
                    checkMode: '1_char_only',
                    maxAsksPerCall: 1,
                    variantGroups: DEFAULT_VARIANT_GROUPS
                };
                console.log(`   📝 Will set nameSpellingVariants.enabled: true`);
            }
            
            if (Object.keys(updateOps).length === 0) {
                console.log(`   ⏭️  No updates needed`);
                skipped++;
                continue;
            }
            
            // Apply the update
            await Company.updateOne(
                { _id: companyId },
                { $set: updateOps }
            );
            
            console.log(`   ✅ Updated successfully`);
            updated++;
            
        } catch (err) {
            console.error(`   ❌ Error: ${err.message}`);
            errors++;
        }
    }
    
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('MIGRATION COMPLETE');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`✅ Updated: ${updated}`);
    console.log(`⏭️  Skipped (already correct): ${skipped}`);
    console.log(`❌ Errors: ${errors}`);
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    // Clear Redis cache for all updated companies
    if (updated > 0 && process.env.REDIS_URL) {
        console.log('🗑️  Clearing Redis cache...');
        const Redis = require('ioredis');
        const redis = new Redis(process.env.REDIS_URL);
        
        for (const company of companies) {
            try {
                await redis.del(`company:${company._id}`);
            } catch (e) {
                // Ignore
            }
        }
        
        await redis.quit();
        console.log('✅ Redis cache cleared\n');
    }
    
    await mongoose.disconnect();
    console.log('👋 Disconnected from MongoDB');
    process.exit(0);
}

run().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});

