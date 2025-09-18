#!/usr/bin/env node

/**
 * Check Atlas Air Company Configuration
 * This will show us exactly what's configured that could cause transfers
 */

const mongoose = require('mongoose');
const Company = require('../models/Company');

async function checkAtlasAirConfig() {
    try {
        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI || 'mongodb+srv://marcperez:Chatterlinx2024@cluster0.fqzwu.mongodb.net/clientsvia?retryWrites=true&w=majority&appName=Cluster0';
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB');

        // Find Atlas Air company
        const company = await Company.findOne({ 
            companyName: { $regex: /atlas air/i } 
        }).lean();

        if (!company) {
            console.log('❌ Atlas Air company not found');
            process.exit(1);
        }

        console.log('\n' + '='.repeat(80));
        console.log('🚨 ATLAS AIR CONFIGURATION ANALYSIS');
        console.log('='.repeat(80));
        
        console.log('\n📋 BASIC INFO:');
        console.log(`Company ID: ${company._id}`);
        console.log(`Company Name: ${company.companyName}`);
        console.log(`Company Phone: ${company.companyPhone}`);
        
        console.log('\n📞 TWILIO CONFIG:');
        console.log('twilioConfig:', JSON.stringify(company.twilioConfig, null, 2));
        
        console.log('\n🤖 AI AGENT LOGIC:');
        console.log('aiAgentLogic.enabled:', company.aiAgentLogic?.enabled);
        console.log('aiAgentLogic.callTransferConfig:', JSON.stringify(company.aiAgentLogic?.callTransferConfig, null, 2));
        
        console.log('\n🔍 POTENTIAL TRANSFER SOURCES:');
        
        // Check for fallback number in twilioConfig
        if (company.twilioConfig?.fallbackNumber) {
            console.log('🚨 FOUND: twilioConfig.fallbackNumber =', company.twilioConfig.fallbackNumber);
        } else {
            console.log('✅ No twilioConfig.fallbackNumber');
        }
        
        // Check for dial-out configuration
        if (company.aiAgentLogic?.callTransferConfig?.dialOutEnabled) {
            console.log('🚨 FOUND: callTransferConfig.dialOutEnabled = true');
            console.log('🚨 FOUND: callTransferConfig.dialOutNumber =', company.aiAgentLogic.callTransferConfig.dialOutNumber);
        } else {
            console.log('✅ Call transfer is disabled');
        }
        
        // Check for any other phone numbers
        console.log('\n📱 ALL PHONE NUMBERS:');
        if (company.twilioConfig?.phoneNumbers) {
            console.log('twilioConfig.phoneNumbers:', JSON.stringify(company.twilioConfig.phoneNumbers, null, 2));
        }
        
        console.log('\n🔧 AI SETTINGS:');
        console.log('aiSettings.customEscalationMessage:', company.aiSettings?.customEscalationMessage);
        console.log('aiSettings.repeatEscalationMessage:', company.aiSettings?.repeatEscalationMessage);
        
        console.log('\n' + '='.repeat(80));
        console.log('🚨 ANALYSIS COMPLETE');
        console.log('='.repeat(80));

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

if (require.main === module) {
    checkAtlasAirConfig();
}

module.exports = { checkAtlasAirConfig };

