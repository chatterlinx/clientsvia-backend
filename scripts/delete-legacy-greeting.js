#!/usr/bin/env node

/**
 * Delete legacy initialGreeting field from company
 * This will force the system to use connectionMessages.voice.text
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/v2Company');

async function deleteLegacyGreeting(companyId) {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        const company = await Company.findById(companyId);
        
        if (!company) {
            console.log('❌ Company not found');
            return;
        }

        console.log(`📊 Company: ${company.companyName || company.businessName}`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
        
        // Show current values
        console.log('🔴 BEFORE:');
        console.log(`   Legacy initialGreeting: "${company.aiAgentLogic?.initialGreeting || 'NOT SET'}"`);
        console.log(`   New connectionMessages.voice.text: "${company.aiAgentLogic?.connectionMessages?.voice?.text || 'NOT SET'}"`);
        console.log();

        // Delete legacy field
        if (company.aiAgentLogic && company.aiAgentLogic.initialGreeting) {
            console.log('🗑️  DELETING legacy initialGreeting field...\n');
            
            // Remove the legacy field
            company.aiAgentLogic.initialGreeting = undefined;
            
            await company.save();
            
            console.log('✅ DELETED successfully!\n');
        } else {
            console.log('ℹ️  Legacy field already deleted or not set\n');
        }

        // Show after values
        const updatedCompany = await Company.findById(companyId);
        console.log('🟢 AFTER:');
        console.log(`   Legacy initialGreeting: "${updatedCompany.aiAgentLogic?.initialGreeting || 'NOT SET'}"`);
        console.log(`   New connectionMessages.voice.text: "${updatedCompany.aiAgentLogic?.connectionMessages?.voice?.text || 'NOT SET'}"`);
        console.log();

        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log('\n⚠️  IMPORTANT:');
        console.log('   Now you MUST set a greeting in Messages & Greetings tab!');
        console.log('   Otherwise, the system will use the default fallback.\n');

        await mongoose.disconnect();
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

const companyId = process.argv[2];

if (!companyId) {
    console.error('Usage: node delete-legacy-greeting.js <companyId>');
    process.exit(1);
}

deleteLegacyGreeting(companyId);

