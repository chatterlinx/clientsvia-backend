#!/usr/bin/env node

require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/v2Company');

async function checkLegacyGreeting(companyId) {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        const company = await Company.findById(companyId).select('companyName aiAgentLogic');
        
        if (!company) {
            console.log('❌ Company not found');
            return;
        }

        console.log(`📊 Company: ${company.companyName}`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
        
        const aiLogic = company.aiAgentLogic || {};
        
        // Check LEGACY initialGreeting
        console.log('🔴 LEGACY GREETING (initialGreeting):');
        if (aiLogic.initialGreeting) {
            console.log(`   ✅ EXISTS: "${aiLogic.initialGreeting}"`);
            console.log(`   ⚠️ This is being used by Twilio right now!\n`);
        } else {
            console.log(`   ✅ NOT SET\n`);
        }

        // Check NEW connectionMessages
        console.log('🟢 NEW GREETING (connectionMessages.voice.text):');
        if (aiLogic.connectionMessages?.voice?.text) {
            console.log(`   ✅ EXISTS: "${aiLogic.connectionMessages.voice.text}"`);
            console.log(`   ✅ This should be used by Twilio!\n`);
        } else {
            console.log(`   ❌ NOT SET`);
            console.log(`   ⚠️ That's why legacy greeting is still playing!\n`);
        }

        // Show what Twilio will use
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`\n🎤 WHAT TWILIO WILL USE:\n`);
        
        if (aiLogic.connectionMessages?.voice?.text && aiLogic.connectionMessages.voice.text.trim()) {
            console.log(`   ✅ NEW: "${aiLogic.connectionMessages.voice.text}"`);
        } else if (aiLogic.initialGreeting && aiLogic.initialGreeting.trim()) {
            console.log(`   🔴 LEGACY: "${aiLogic.initialGreeting}"`);
            console.log(`   ⚠️ WARNING: Using legacy field because connectionMessages.voice.text is not set!`);
        } else {
            console.log(`   ⚠️ DEFAULT FALLBACK`);
        }

        console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

        await mongoose.disconnect();
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

const companyId = process.argv[2];

if (!companyId) {
    console.error('Usage: node check-legacy-greeting.js <companyId>');
    process.exit(1);
}

checkLegacyGreeting(companyId);

