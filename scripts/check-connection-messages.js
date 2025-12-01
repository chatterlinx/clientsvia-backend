#!/usr/bin/env node

/**
 * Check Connection Messages configuration for a company
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/v2Company');

async function checkConnectionMessages(companyId) {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');

        const company = await Company.findById(companyId);
        
        if (!company) {
            console.log('❌ Company not found');
            return;
        }

        console.log(`\n📊 Company: ${company.businessName || company.companyName}`);
        console.log(`📧 ID: ${company._id}`);
        console.log(`\n🎤 CONNECTION MESSAGES CHECK:`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        
        const aiLogic = company.aiAgentSettings || {};
        
        // Check Connection Messages
        console.log(`\n1️⃣ NEW SYSTEM (connectionMessages):`);
        if (aiLogic.connectionMessages?.voice?.text) {
            console.log(`   ✅ CONFIGURED: "${aiLogic.connectionMessages.voice.text}"`);
        } else {
            console.log(`   ❌ NOT SET - Will fall back to legacy`);
        }

        // Check Legacy initialGreeting
        console.log(`\n2️⃣ LEGACY SYSTEM (initialGreeting):`);
        if (aiLogic.initialGreeting) {
            console.log(`   ⚠️ LEGACY PRESENT: "${aiLogic.initialGreeting}"`);
        } else {
            console.log(`   ✅ No legacy greeting`);
        }

        // Check Agent Personality
        console.log(`\n3️⃣ AGENT PERSONALITY (fallback):`);
        if (aiLogic.agentPersonality?.conversationPatterns?.openingPhrases?.length > 0) {
            console.log(`   ✅ Opening phrases configured: ${aiLogic.agentPersonality.conversationPatterns.openingPhrases.length} phrases`);
        } else {
            console.log(`   ❌ No opening phrases`);
        }

        console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`\n🎯 WHAT WILL BE USED:`);
        
        if (aiLogic.connectionMessages?.voice?.text && aiLogic.connectionMessages.voice.text.trim()) {
            console.log(`   ✅ NEW CONNECTION MESSAGE (best!)`);
            console.log(`   Greeting: "${aiLogic.connectionMessages.voice.text}"`);
        } else if (aiLogic.initialGreeting && aiLogic.initialGreeting.trim()) {
            console.log(`   ⚠️ LEGACY initialGreeting (needs migration!)`);
            console.log(`   Greeting: "${aiLogic.initialGreeting}"`);
        } else if (aiLogic.agentPersonality?.conversationPatterns?.openingPhrases?.length > 0) {
            console.log(`   ✅ Agent Personality opening phrase`);
            console.log(`   Greeting: "${aiLogic.agentPersonality.conversationPatterns.openingPhrases[0]}"`);
        } else {
            console.log(`   ⚠️ Default fallback greeting`);
        }

        console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await mongoose.disconnect();
    }
}

// Get company ID from command line
const companyId = process.argv[2];

if (!companyId) {
    console.error('Usage: node check-connection-messages.js <companyId>');
    process.exit(1);
}

checkConnectionMessages(companyId);

