#!/usr/bin/env node

require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/v2Company');

async function forceDelete(companyId) {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        
        console.log('\n🗑️  FORCE DELETING legacy initialGreeting...\n');
        
        // Use $unset to completely remove the field
        const result = await Company.updateOne(
            { _id: companyId },
            { $unset: { 'aiAgentLogic.initialGreeting': '' } }
        );
        
        console.log('Result:', result);
        
        // Verify
        const company = await Company.findById(companyId).select('aiAgentLogic.initialGreeting aiAgentLogic.connectionMessages');
        
        console.log('\n✅ VERIFIED:\n');
        console.log('Legacy initialGreeting:', company.aiAgentLogic?.initialGreeting || 'DELETED ✅');
        console.log('New connectionMessages:', company.aiAgentLogic?.connectionMessages || 'NOT SET ❌');
        console.log();
        
        await mongoose.disconnect();
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

forceDelete('68813026dd95f599c74e49c7');

