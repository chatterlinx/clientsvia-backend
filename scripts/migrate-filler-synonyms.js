#!/usr/bin/env node

/**
 * Migration: Backfill fillerWords and synonymMap on existing templates
 * 
 * Problem: Templates created before fillerWords/synonymMap fields existed
 * don't have these properties populated.
 * 
 * Solution: Update all templates that are missing these fields with defaults.
 * 
 * Usage: MONGODB_URI="..." node scripts/migrate-filler-synonyms.js
 */

const mongoose = require('mongoose');

// ============================================================================
// DEFAULT VALUES (must match schema)
// ============================================================================
const DEFAULT_FILLER_WORDS = [
    'um', 'uh', 'like', 'you', 'know', 'i', 'mean', 'basically',
    'actually', 'so', 'well', 'okay', 'alright', 'right', 'the',
    'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
    'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
    'did', 'will', 'would', 'should', 'could', 'can', 'may',
    'might', 'must', 'what', 'when', 'where', 'who', 'how', 'why',
    'please', 'thanks', 'thank', 'yes', 'no', 'yeah', 'yep', 'nope',
    'hi', 'hey', 'hello', 'you guys', 'today', 'there'
];

const DEFAULT_SYNONYM_MAP = {
    'air conditioner': ['ac', 'a/c', 'air', 'cooling', 'cold air', 'system'],
    'furnace': ['heater', 'heat', 'heating', 'hot air'],
    'unit': ['system', 'equipment', 'machine', 'thing outside']
};

// ============================================================================
// MIGRATION
// ============================================================================
async function migrate() {
    const mongoUri = process.env.MONGODB_URI;
    
    if (!mongoUri) {
        console.error('❌ ERROR: MONGODB_URI environment variable not set');
        console.error('Usage: MONGODB_URI="mongodb://..." node scripts/migrate-filler-synonyms.js');
        process.exit(1);
    }
    
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(mongoUri, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        
        const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
        
        console.log('📊 Checking for templates missing fillerWords and/or synonymMap...');
        
        // Check templates that need migration
        const needingMigration = await GlobalInstantResponseTemplate.find({
            $or: [
                { fillerWords: { $exists: false } },
                { fillerWords: null },
                { synonymMap: { $exists: false } },
                { synonymMap: null }
            ]
        });
        
        console.log(`\n📋 Found ${needingMigration.length} templates needing migration:`);
        needingMigration.forEach((t, idx) => {
            console.log(`   ${idx + 1}. ${t.name} (ID: ${t._id})`);
        });
        
        if (needingMigration.length === 0) {
            console.log('✅ All templates already have fillerWords and synonymMap!');
            await mongoose.disconnect();
            process.exit(0);
        }
        
        console.log('\n🔧 Running migration...');
        
        // Update all templates
        const result = await GlobalInstantResponseTemplate.updateMany(
            {
                $or: [
                    { fillerWords: { $exists: false } },
                    { fillerWords: null },
                    { synonymMap: { $exists: false } },
                    { synonymMap: null }
                ]
            },
            {
                $set: {
                    fillerWords: DEFAULT_FILLER_WORDS,
                    synonymMap: DEFAULT_SYNONYM_MAP
                }
            }
        );
        
        console.log(`\n✅ Migration complete!`);
        console.log(`   - Matched: ${result.matchedCount} templates`);
        console.log(`   - Modified: ${result.modifiedCount} templates`);
        console.log(`   - Fillers per template: ${DEFAULT_FILLER_WORDS.length}`);
        console.log(`   - Synonym mappings: ${Object.keys(DEFAULT_SYNONYM_MAP).length}`);
        
        // Verify
        console.log('\n📊 Verification...');
        const afterMigration = await GlobalInstantResponseTemplate.find({
            fillerWords: { $exists: true, $ne: null },
            synonymMap: { $exists: true, $ne: null }
        });
        
        console.log(`✅ Templates with both fields: ${afterMigration.length}`);
        
        console.log('\n🎉 Migration successful!');
        
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        console.error(error);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
    }
}

migrate();

