/**
 * Verify all companies have clean fallback format
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/v2Company');

async function verifyClean() {
    console.log('🔍 Verifying Fallback Format...\n');

    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        // Check Royal Plumbing specifically
        const royal = await Company.findOne({ companyName: 'Royal Plumbing' });
        
        if (royal) {
            console.log('📋 Royal Plumbing Fallback Structure:');
            console.log('=====================================');
            const fallback = royal.aiAgentLogic?.connectionMessages?.voice?.fallback;
            console.log('Type:', typeof fallback);
            console.log('Value:', JSON.stringify(fallback, null, 2));
            console.log('=====================================\n');
            
            if (typeof fallback === 'object' && fallback !== null && !Array.isArray(fallback)) {
                console.log('✅ CLEAN! Using new object format');
                console.log('✅ Has enabled:', fallback.hasOwnProperty('enabled'));
                console.log('✅ Has voiceMessage:', fallback.hasOwnProperty('voiceMessage'));
                console.log('✅ Has adminPhone:', fallback.hasOwnProperty('adminPhone'));
                console.log('✅ Has adminSmsMessage:', fallback.hasOwnProperty('adminSmsMessage'));
            } else {
                console.log('❌ LEGACY! Still using old format:', fallback);
            }
        } else {
            console.log('⚠️ Royal Plumbing not found');
        }

        // Check all companies
        const allCompanies = await Company.find({}).select('companyName aiAgentLogic.connectionMessages.voice.fallback');
        console.log(`\n📊 Checking ${allCompanies.length} total companies...\n`);
        
        let cleanCount = 0;
        let legacyCount = 0;
        let missingCount = 0;

        for (const company of allCompanies) {
            const fallback = company.aiAgentLogic?.connectionMessages?.voice?.fallback;
            
            if (!fallback) {
                missingCount++;
            } else if (typeof fallback === 'string') {
                console.log(`❌ LEGACY: ${company.companyName} - "${fallback}"`);
                legacyCount++;
            } else if (typeof fallback === 'object') {
                cleanCount++;
            }
        }

        console.log('\n========================================');
        console.log('📊 VERIFICATION SUMMARY');
        console.log('========================================');
        console.log(`✅ Clean (object): ${cleanCount}`);
        console.log(`❌ Legacy (string): ${legacyCount}`);
        console.log(`⚠️ Missing: ${missingCount}`);
        console.log(`📈 Total: ${allCompanies.length}`);
        console.log('========================================\n');

        if (legacyCount === 0) {
            console.log('🎉 ALL COMPANIES CLEAN!');
            console.log('☢️ ZERO LEGACY CODE IN DATABASE!\n');
        } else {
            console.log('⚠️ Legacy code still exists. Run migration script.\n');
        }

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

verifyClean();

