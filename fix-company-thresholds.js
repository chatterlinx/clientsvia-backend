#!/usr/bin/env node

// Fix company thresholds to use single source of truth
require('dotenv').config();
const mongoose = require('mongoose');

async function fixCompanyThresholds() {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/clientsvia');
        console.log('✅ Connected to MongoDB');

        const companyId = '68813026dd95f599c74e49c7'; // Your company ID
        
        // Import models
        const Company = require('./models/v2Company');
        
        console.log('\n🎯 FIXING: Single Source of Truth for Thresholds');
        console.log('Company ID:', companyId);
        
        // Update company thresholds to working values
        const result = await Company.findByIdAndUpdate(
            companyId,
            {
                $set: {
                    'aiAgentLogic.thresholds.companyQnA': 0.55,
                    'aiAgentLogic.thresholds.tradeQnA': 0.75,
                    'aiAgentLogic.thresholds.templates': 0.7,
                    'aiAgentLogic.thresholds.inHouseFallback': 0.5,
                    'aiAgentLogic.lastUpdated': new Date()
                }
            },
            { new: true, upsert: false }
        );
        
        if (result) {
            console.log('✅ Updated company thresholds:');
            console.log('  Company Q&A:', result.aiAgentLogic.thresholds.companyQnA);
            console.log('  Trade Q&A:', result.aiAgentLogic.thresholds.tradeQnA);
            console.log('  Templates:', result.aiAgentLogic.thresholds.templates);
            console.log('  In-House Fallback:', result.aiAgentLogic.thresholds.inHouseFallback);
            
            console.log('\n🎯 SINGLE SOURCE OF TRUTH ESTABLISHED!');
            console.log('All threshold changes now happen in Company.aiAgentLogic.thresholds');
        } else {
            console.log('❌ Company not found or update failed');
        }
        
    } catch (error) {
        console.error('❌ Fix failed:', error);
    } finally {
        await mongoose.disconnect();
        console.log('\n✅ Disconnected from MongoDB');
    }
}

fixCompanyThresholds();
