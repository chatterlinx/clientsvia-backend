/**
 * 🔧 FIX TRADE CATEGORY INDEXES
 * ==============================
 * Removes old unique index on 'name' field only
 * Ensures compound unique index on 'companyId + name' exists
 * This allows multiple companies to have the same category names
 */

require('dotenv').config();
const mongoose = require('mongoose');
const v2TradeCategory = require('../models/v2TradeCategory');
const { connectDB } = require('../db');

async function fixIndexes() {
    try {
        console.log('🔧 [INDEX-FIX-1] Connecting to MongoDB via Mongoose...');
        await connectDB();
        console.log('🔧 [INDEX-FIX-2] ✅ Connected to MongoDB');

        // Get current indexes
        console.log('🔧 [INDEX-FIX-3] Checking current indexes...');
        const indexes = await v2TradeCategory.collection.getIndexes();
        console.log('🔧 [INDEX-FIX-4] Current indexes:', Object.keys(indexes));

        // Check for problematic 'name_1' index (unique on name only)
        if (indexes.name_1) {
            console.log('🔧 [INDEX-FIX-5] ❌ Found problematic name_1 index (unique on name only)');
            console.log('🔧 [INDEX-FIX-6] Dropping name_1 index...');
            await v2TradeCategory.collection.dropIndex('name_1');
            console.log('🔧 [INDEX-FIX-7] ✅ Dropped name_1 index');
        } else {
            console.log('🔧 [INDEX-FIX-5] ✅ No problematic name_1 index found');
        }

        // Ensure compound index exists
        console.log('🔧 [INDEX-FIX-8] Ensuring compound index (companyId + name) exists...');
        
        if (!indexes.v2_company_name_unique) {
            console.log('🔧 [INDEX-FIX-9] Creating v2_company_name_unique compound index...');
            await v2TradeCategory.collection.createIndex(
                { companyId: 1, name: 1 }, 
                { unique: true, name: 'v2_company_name_unique' }
            );
            console.log('🔧 [INDEX-FIX-10] ✅ Created v2_company_name_unique index');
        } else {
            console.log('🔧 [INDEX-FIX-9] ✅ v2_company_name_unique index already exists');
        }

        // Verify final state
        console.log('🔧 [INDEX-FIX-11] Verifying final indexes...');
        const finalIndexes = await v2TradeCategory.collection.getIndexes();
        console.log('🔧 [INDEX-FIX-12] Final indexes:', Object.keys(finalIndexes));
        console.log('🔧 [INDEX-FIX-13] ✅ Index fix complete!');

        console.log('\n✅ SUCCESS! Trade category indexes fixed:');
        console.log('   - Removed: name_1 (if it existed)');
        console.log('   - Ensured: v2_company_name_unique (companyId + name)');
        console.log('   - Result: Multiple companies can now have same category names');

        process.exit(0);
    } catch (error) {
        console.error('❌ [INDEX-FIX-ERROR] Error fixing indexes:', error);
        process.exit(1);
    }
}

// Run the fix
fixIndexes();

