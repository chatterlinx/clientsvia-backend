/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * MIGRATION: Move businessHours to canonical Front Desk location
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * V109: Business hours migration
 * 
 * OLD LOCATION: aiAgentSettings.businessHours (legacy, outside Front Desk namespace)
 * NEW LOCATION: aiAgentSettings.frontDeskBehavior.businessHours (canonical, Control Plane governed)
 * 
 * This ensures Hours tab writes to the SAME namespace as all other Front Desk
 * settings, so Control Plane can govern it properly.
 * 
 * USAGE:
 *   DRY RUN:  node scripts/migrate-business-hours-to-canonical.js
 *   EXECUTE:  node scripts/migrate-business-hours-to-canonical.js --execute
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const mongoose = require('mongoose');
const v2Company = require('../models/v2Company');

const EXECUTE = process.argv.includes('--execute');

async function migrate() {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('V109: Migrate businessHours to canonical Front Desk location');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`Mode: ${EXECUTE ? '🚀 EXECUTE' : '👀 DRY RUN'}`);
    console.log('');
    
    try {
        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
        if (!mongoUri) {
            throw new Error('MONGODB_URI not configured');
        }
        
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB');
        console.log('');
        
        // Find all companies with businessHours at the legacy location
        const companiesWithLegacyHours = await v2Company.find({
            'aiAgentSettings.businessHours': { $exists: true, $ne: null }
        }).lean();
        
        console.log(`Found ${companiesWithLegacyHours.length} companies with legacy businessHours`);
        console.log('');
        
        let migratedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;
        
        for (const company of companiesWithLegacyHours) {
            const companyId = company._id.toString();
            const companyName = company.name || 'Unnamed';
            const legacyHours = company.aiAgentSettings?.businessHours;
            const canonicalHours = company.aiAgentSettings?.frontDeskBehavior?.businessHours;
            
            console.log(`─────────────────────────────────────────────────────────────`);
            console.log(`Company: ${companyName} (${companyId})`);
            console.log(`  Legacy location: ${JSON.stringify(legacyHours)?.substring(0, 80)}...`);
            console.log(`  Canonical location: ${canonicalHours ? 'EXISTS' : 'empty'}`);
            
            // Skip if canonical already has data (don't overwrite)
            if (canonicalHours && Object.keys(canonicalHours).length > 0) {
                console.log(`  ⏭️  SKIPPED: Canonical location already has data`);
                skippedCount++;
                continue;
            }
            
            if (EXECUTE) {
                try {
                    // Move to canonical location and clear legacy
                    await v2Company.updateOne(
                        { _id: company._id },
                        {
                            $set: {
                                'aiAgentSettings.frontDeskBehavior.businessHours': legacyHours
                            },
                            $unset: {
                                'aiAgentSettings.businessHours': 1
                            }
                        }
                    );
                    
                    console.log(`  ✅ MIGRATED: Copied to canonical, cleared legacy`);
                    migratedCount++;
                } catch (err) {
                    console.log(`  ❌ ERROR: ${err.message}`);
                    errorCount++;
                }
            } else {
                console.log(`  📋 WOULD MIGRATE: Copy to canonical, clear legacy`);
                migratedCount++;
            }
        }
        
        console.log('');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('SUMMARY');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log(`Total companies with legacy hours: ${companiesWithLegacyHours.length}`);
        console.log(`Migrated: ${migratedCount}`);
        console.log(`Skipped (canonical exists): ${skippedCount}`);
        console.log(`Errors: ${errorCount}`);
        console.log('');
        
        if (!EXECUTE && migratedCount > 0) {
            console.log('💡 This was a DRY RUN. To execute, run:');
            console.log('   node scripts/migrate-business-hours-to-canonical.js --execute');
        }
        
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('');
        console.log('Disconnected from MongoDB');
    }
}

migrate();
