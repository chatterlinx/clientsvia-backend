#!/usr/bin/env node

require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/v2Company');

async function showExactGreeting(companyId) {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        
        const company = await Company.findById(companyId);
        
        console.log('\n🔍 RAW DATABASE VALUES:\n');
        console.log('aiAgentLogic.initialGreeting:');
        console.log(JSON.stringify(company.aiAgentLogic?.initialGreeting, null, 2));
        console.log('\naiAgentLogic.connectionMessages:');
        console.log(JSON.stringify(company.aiAgentLogic?.connectionMessages, null, 2));
        
        await mongoose.disconnect();
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

showExactGreeting('68813026dd95f599c74e49c7');

