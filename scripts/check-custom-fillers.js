/**
 * Check Custom Fillers in Database
 * Diagnostic script to see what's actually saved
 */

require('dotenv').config();
const mongoose = require('mongoose');
const v2Company = require('../models/v2Company');

async function checkCustomFillers() {
    try {
        console.log('🔍 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected!\n');
        
        const companyId = '68e3f77a9d623b8058c700c4'; // Royal Plumbing
        
        console.log(`📊 Checking company: ${companyId}\n`);
        
        const company = await v2Company.findById(companyId);
        
        if (!company) {
            console.log('❌ Company not found!');
            process.exit(1);
        }
        
        console.log('✅ Company found:', company.companyName);
        console.log('\n📋 FULL aiAgentSettings OBJECT:');
        console.log(JSON.stringify(company.aiAgentSettings, null, 2));
        
        console.log('\n🔍 FILLER WORDS SPECIFIC:');
        console.log('aiAgentSettings exists?', !!company.aiAgentSettings);
        console.log('aiAgentSettings.fillerWords exists?', !!company.aiAgentSettings?.fillerWords);
        console.log('aiAgentSettings.fillerWords.custom:', company.aiAgentSettings?.fillerWords?.custom);
        console.log('aiAgentSettings.fillerWords.inherited:', company.aiAgentSettings?.fillerWords?.inherited);
        
        console.log('\n✅ Diagnostic complete!');
        
        await mongoose.connection.close();
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

checkCustomFillers();

