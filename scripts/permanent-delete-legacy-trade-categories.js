/**
 * 💀 PERMANENT DELETE LEGACY TRADE CATEGORIES
 * ============================================
 * NUCLEAR OPTION: Permanently deletes legacy collections
 * NO ARCHIVES - COMPLETE ELIMINATION
 * 
 * CURRENT V2 SYSTEM: enterpriseTradeCategories
 * LEGACY TO NUKE: tradecategories, tradeCategories, and ANY archived versions
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function permanentDeleteLegacy() {
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        const db = mongoose.connection.db;

        // ═══════════════════════════════════════════════════════════
        // STEP 1: VERIFY V2 COLLECTION EXISTS
        // ═══════════════════════════════════════════════════════════
        console.log('═══════════════════════════════════════════════════════════');
        console.log('📊 STEP 1: Verifying V2 System is Safe');
        console.log('═══════════════════════════════════════════════════════════\n');

        const v2Count = await db.collection('enterpriseTradeCategories').countDocuments();
        console.log(`✅ V2 Collection (enterpriseTradeCategories): ${v2Count} documents\n`);

        if (v2Count === 0) {
            console.error('❌ ERROR: V2 collection is empty! Aborting.\n');
            process.exit(1);
        }

        // ═══════════════════════════════════════════════════════════
        // STEP 2: FIND ALL LEGACY COLLECTIONS (including archived)
        // ═══════════════════════════════════════════════════════════
        console.log('═══════════════════════════════════════════════════════════');
        console.log('🔍 STEP 2: Finding ALL Legacy Collections');
        console.log('═══════════════════════════════════════════════════════════\n');

        const allCollections = await db.listCollections().toArray();
        const legacyCollections = allCollections.filter(c => {
            const name = c.name;
            return (
                name === 'tradecategories' ||
                name === 'tradeCategories' ||
                name.includes('_LEGACY_DELETED_tradecategories') ||
                name.includes('_LEGACY_DELETED_tradeCategories') ||
                name.includes('_ARCHIVED') && name.toLowerCase().includes('trade')
            );
        }).map(c => c.name);

        console.log(`Found ${legacyCollections.length} legacy collections to delete:\n`);
        
        for (const collName of legacyCollections) {
            const count = await db.collection(collName).countDocuments();
            console.log(`   💀 ${collName} (${count} documents) - WILL BE DELETED`);
        }

        if (legacyCollections.length === 0) {
            console.log('   ✅ No legacy collections found. Already clean!\n');
            await mongoose.connection.close();
            return;
        }

        // ═══════════════════════════════════════════════════════════
        // STEP 3: PERMANENT DELETION
        // ═══════════════════════════════════════════════════════════
        console.log('\n═══════════════════════════════════════════════════════════');
        console.log('💀 STEP 3: PERMANENT DELETION IN PROGRESS');
        console.log('═══════════════════════════════════════════════════════════\n');

        let deletedCount = 0;
        let totalDocsDeleted = 0;

        for (const collName of legacyCollections) {
            try {
                const count = await db.collection(collName).countDocuments();
                await db.collection(collName).drop();
                console.log(`   ✅ DELETED: ${collName} (${count} documents removed)`);
                deletedCount++;
                totalDocsDeleted += count;
            } catch (err) {
                console.error(`   ❌ Error deleting ${collName}:`, err.message);
            }
        }

        // ═══════════════════════════════════════════════════════════
        // STEP 4: FINAL VERIFICATION
        // ═══════════════════════════════════════════════════════════
        console.log('\n═══════════════════════════════════════════════════════════');
        console.log('✅ STEP 4: Final State');
        console.log('═══════════════════════════════════════════════════════════\n');

        const remainingCollections = await db.listCollections().toArray();
        const remainingTrade = remainingCollections.filter(c => c.name.toLowerCase().includes('trade'));

        console.log('📊 Remaining Trade Collections:');
        for (const coll of remainingTrade) {
            const count = await db.collection(coll.name).countDocuments();
            console.log(`   ✅ ${coll.name}: ${count} documents`);
        }

        console.log('\n═══════════════════════════════════════════════════════════');
        console.log('💀 LEGACY PERMANENTLY DELETED - NO TRACES LEFT');
        console.log('═══════════════════════════════════════════════════════════\n');

        console.log(`📊 Deletion Summary:`);
        console.log(`   💀 Collections Deleted: ${deletedCount}`);
        console.log(`   💀 Total Documents Removed: ${totalDocsDeleted}`);
        console.log(`   ✅ V2 System Intact: ${v2Count} documents\n`);

    } catch (error) {
        console.error('❌ FATAL ERROR:', error.message);
        console.error(error.stack);
    } finally {
        await mongoose.connection.close();
        console.log('🔌 Disconnected from MongoDB');
    }
}

// Execute permanent deletion
permanentDeleteLegacy();

