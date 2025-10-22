#!/usr/bin/env node

/**
 * 🔍 DETAILED VOICE SETTINGS INSPECTION
 * 
 * Check the actual structure of voiceSettings for ALL companies
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function inspectVoiceSettings() {
    try {
        console.log('\n🔍 DETAILED VOICE SETTINGS INSPECTION');
        console.log('═'.repeat(80));
        
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');
        
        const db = mongoose.connection.db;
        const companiesCollection = db.collection('v2companies');
        
        // Get ALL companies
        const companies = await companiesCollection.find({}).toArray();
        
        console.log(`Found ${companies.length} total companies\n`);
        console.log('═'.repeat(80));
        
        companies.forEach((company, index) => {
            console.log(`\n${index + 1}. ${company.companyName} (${company._id})`);
            console.log(`   Has aiAgentLogic: ${Boolean(company.aiAgentLogic)}`);
            
            if (company.aiAgentLogic) {
                const vs = company.aiAgentLogic.voiceSettings;
                console.log(`   voiceSettings type: ${typeof vs}`);
                console.log(`   voiceSettings is null: ${vs === null}`);
                console.log(`   voiceSettings is undefined: ${vs === undefined}`);
                console.log(`   voiceSettings is array: ${Array.isArray(vs)}`);
                
                if (vs) {
                    console.log(`   voiceSettings value:`, JSON.stringify(vs, null, 2));
                } else {
                    console.log(`   voiceSettings value: ${vs}`);
                }
            } else {
                console.log(`   ⚠️ No aiAgentLogic field!`);
            }
        });
        
        console.log(`\n${  '═'.repeat(80)}`);
        await mongoose.disconnect();
        console.log('✅ Done');
        process.exit(0);
        
    } catch (error) {
        console.error('❌ ERROR:', error);
        process.exit(1);
    }
}

inspectVoiceSettings();

