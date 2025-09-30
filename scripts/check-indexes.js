/**
 * 🔍 DIAGNOSTIC: Check v2TradeCategory indexes
 * =============================================
 * This script checks what indexes actually exist in production
 */

require('dotenv').config();
const mongoose = require('mongoose');
const v2TradeCategory = require('../models/v2TradeCategory');
const { connectDB } = require('../db');

async function checkIndexes() {
    try {
        console.log('🔍 [DIAGNOSTIC-1] Connecting to MongoDB...');
        await connectDB();
        console.log('🔍 [DIAGNOSTIC-2] ✅ Connected to MongoDB');

        // Get current indexes
        console.log('🔍 [DIAGNOSTIC-3] Fetching all indexes from tradecategories collection...');
        const indexes = await v2TradeCategory.collection.getIndexes();
        
        console.log('🔍 [DIAGNOSTIC-4] ========================================');
        console.log('📊 CURRENT INDEXES IN PRODUCTION:');
        console.log('🔍 [DIAGNOSTIC-4] ========================================');
        console.log(JSON.stringify(indexes, null, 2));
        console.log('🔍 [DIAGNOSTIC-5] ========================================');

        // Check for specific problematic index
        if (indexes.name_1) {
            console.log('❌ [DIAGNOSTIC-6] PROBLEM FOUND: Old name_1 index still exists!');
            console.log('   This index enforces uniqueness on name alone (bad for multi-tenancy)');
        } else {
            console.log('✅ [DIAGNOSTIC-6] Good: Old name_1 index does NOT exist');
        }

        // Check for correct compound index
        if (indexes.v2_company_name_unique) {
            console.log('✅ [DIAGNOSTIC-7] Good: v2_company_name_unique compound index exists');
            console.log('   Index definition:', JSON.stringify(indexes.v2_company_name_unique, null, 2));
        } else {
            console.log('❌ [DIAGNOSTIC-7] PROBLEM: v2_company_name_unique compound index is MISSING!');
        }

        // Check for any categories named "dentist"
        console.log('🔍 [DIAGNOSTIC-8] Checking for existing "dentist" categories...');
        const dentistCategories = await v2TradeCategory.find({ name: 'dentist' }).lean();
        console.log(`🔍 [DIAGNOSTIC-9] Found ${dentistCategories.length} "dentist" categories:`);
        dentistCategories.forEach(cat => {
            console.log(`   - ID: ${cat._id}, companyId: ${cat.companyId}, name: "${cat.name}"`);
        });

        console.log('🔍 [DIAGNOSTIC-10] ✅ Diagnostic complete!');

    } catch (error) {
        console.error('❌ [DIAGNOSTIC-ERROR] Error checking indexes:', error);
    } finally {
        await mongoose.disconnect();
        console.log('🔍 [DIAGNOSTIC-END] Disconnected from MongoDB');
    }
}

checkIndexes();

