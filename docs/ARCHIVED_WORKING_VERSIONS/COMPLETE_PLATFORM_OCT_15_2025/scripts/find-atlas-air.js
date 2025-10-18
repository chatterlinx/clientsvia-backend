#!/usr/bin/env node

require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/v2Company');

async function findAtlasAir() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        
        // Find all companies with "atlas" in the name
        const companies = await Company.find({
            $or: [
                { companyName: /atlas/i },
                { businessName: /atlas/i }
            ]
        }).select('_id companyName businessName aiAgentLogic.initialGreeting aiAgentLogic.connectionMessages');
        
        console.log(`\n📊 Found ${companies.length} companies with "atlas" in the name:\n`);
        
        companies.forEach(company => {
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            console.log(`Company: ${company.businessName || company.companyName}`);
            console.log(`ID: ${company._id}`);
            console.log(`Legacy greeting: ${company.aiAgentLogic?.initialGreeting ? 'EXISTS' : 'NOT SET'}`);
            if (company.aiAgentLogic?.initialGreeting) {
                console.log(`   "${company.aiAgentLogic.initialGreeting}"`);
            }
            console.log(`New greeting: ${company.aiAgentLogic?.connectionMessages?.voice?.text ? 'EXISTS' : 'NOT SET'}`);
            if (company.aiAgentLogic?.connectionMessages?.voice?.text) {
                console.log(`   "${company.aiAgentLogic.connectionMessages.voice.text}"`);
            }
            console.log();
        });
        
        await mongoose.disconnect();
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

findAtlasAir();

