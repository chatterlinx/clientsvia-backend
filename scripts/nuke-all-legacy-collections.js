/**
 * 💀 NUKE ALL LEGACY COLLECTIONS - COMPLETE ELIMINATION
 * ======================================================
 * Traces and permanently deletes ALL legacy collections
 * Based on audit findings from database analysis
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function nukeAllLegacy() {
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        const db = mongoose.connection.db;

        // ═══════════════════════════════════════════════════════════
        // DEFINE V2 COLLECTIONS (KEEP THESE)
        // ═══════════════════════════════════════════════════════════
        const V2_COLLECTIONS = [
            'enterpriseTradeCategories',  // V2 Trade Categories
            'companiesCollection',        // V2 Companies (primary)
            'v2contacts',                 // V2 Contacts
            'agentPerformance',          // V2 Agent Performance (assuming this is current)
            'v2aiagentcalllogs',
            'v2templates',
            'v2users',
            'globalinstantresponsetemplates',
            'globalaibehaviortemplates',
            'globalactionhooks',
            'globalactionhookdirectory',
            'globalindustrytypes',
            'sessions',
            'auditlogs',
            'datacenterauditlogs',
            'idempotencylogs',
            'instantresponsecategories',
            'companyqnacategories',
            'companyqnas',
            'localcompanyqnas',
            'adminsettings',
            'blockedcalllogs',
            'globalspamdatabase',
            'v2notificationlogs'
        ];

        // ═══════════════════════════════════════════════════════════
        // STEP 1: LIST ALL COLLECTIONS
        // ═══════════════════════════════════════════════════════════
        console.log('═══════════════════════════════════════════════════════════');
        console.log('📊 STEP 1: Scanning ALL Collections');
        console.log('═══════════════════════════════════════════════════════════\n');

        const allCollections = await db.listCollections().toArray();
        console.log(`Total collections found: ${allCollections.length}\n`);

        // ═══════════════════════════════════════════════════════════
        // STEP 2: IDENTIFY LEGACY COLLECTIONS
        // ═══════════════════════════════════════════════════════════
        console.log('═══════════════════════════════════════════════════════════');
        console.log('🔍 STEP 2: Identifying Legacy Collections');
        console.log('═══════════════════════════════════════════════════════════\n');

        const legacyCollections = [];

        for (const coll of allCollections) {
            const name = coll.name;
            const nameLower = name.toLowerCase();
            
            // Skip system collections
            if (name.startsWith('system.')) continue;
            
            // Check if it's a known V2 collection
            const isV2 = V2_COLLECTIONS.some(v2 => v2.toLowerCase() === nameLower);
            
            if (isV2) {
                const count = await db.collection(name).countDocuments();
                console.log(`✅ KEEP: ${name} (${count} docs) - V2 System`);
            } else {
                // It's legacy - check if it has data
                const count = await db.collection(name).countDocuments();
                
                // Mark as legacy to delete
                legacyCollections.push({ name, count });
                console.log(`💀 DELETE: ${name} (${count} docs) - LEGACY`);
            }
        }

        if (legacyCollections.length === 0) {
            console.log('\n✅ No legacy collections found. Database is clean!\n');
            await mongoose.connection.close();
            return;
        }

        // ═══════════════════════════════════════════════════════════
        // STEP 3: PERMANENT DELETION
        // ═══════════════════════════════════════════════════════════
        console.log('\n═══════════════════════════════════════════════════════════');
        console.log('💀 STEP 3: PERMANENT DELETION');
        console.log('═══════════════════════════════════════════════════════════\n');

        console.log(`About to DELETE ${legacyCollections.length} collections:\n`);
        legacyCollections.forEach(c => {
            console.log(`   💀 ${c.name} (${c.count} documents)`);
        });

        console.log('\nDeleting in 3 seconds...\n');
        await new Promise(resolve => setTimeout(resolve, 3000));

        let deletedCount = 0;
        let totalDocsDeleted = 0;

        for (const legacy of legacyCollections) {
            try {
                await db.collection(legacy.name).drop();
                console.log(`   ✅ DELETED: ${legacy.name} (${legacy.count} documents removed)`);
                deletedCount++;
                totalDocsDeleted += legacy.count;
            } catch (err) {
                console.error(`   ❌ Error deleting ${legacy.name}:`, err.message);
            }
        }

        // ═══════════════════════════════════════════════════════════
        // STEP 4: FINAL VERIFICATION
        // ═══════════════════════════════════════════════════════════
        console.log('\n═══════════════════════════════════════════════════════════');
        console.log('✅ STEP 4: Final Database State');
        console.log('═══════════════════════════════════════════════════════════\n');

        const finalCollections = await db.listCollections().toArray();
        console.log(`📊 Remaining collections: ${finalCollections.length}\n`);

        for (const coll of finalCollections) {
            if (!coll.name.startsWith('system.')) {
                const count = await db.collection(coll.name).countDocuments();
                console.log(`   ✅ ${coll.name}: ${count} documents`);
            }
        }

        console.log('\n═══════════════════════════════════════════════════════════');
        console.log('💀 ALL LEGACY NUKED - DATABASE CLEAN');
        console.log('═══════════════════════════════════════════════════════════\n');

        console.log(`📊 Deletion Summary:`);
        console.log(`   💀 Collections Deleted: ${deletedCount}`);
        console.log(`   💀 Total Documents Removed: ${totalDocsDeleted}`);
        console.log(`   ✅ V2 Collections Intact: ${finalCollections.length - 2}\n`); // minus system collections

    } catch (error) {
        console.error('❌ FATAL ERROR:', error.message);
        console.error(error.stack);
    } finally {
        await mongoose.connection.close();
        console.log('🔌 Disconnected from MongoDB');
    }
}

// Execute complete legacy nuke
nukeAllLegacy();

