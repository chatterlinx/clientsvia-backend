require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/v2Company');
const { redisClient } = require('../clients/index');

async function updateRoyalGreeting() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');
        
        console.log('🔄 Updating Royal Plumbing greeting...\n');
        
        const company = await Company.findById('68eeaf924e989145e9d46c12');
        
        if (!company) {
            console.log('❌ Royal Plumbing not found!');
            process.exit(1);
        }
        
        // Initialize connectionMessages if it doesn't exist
        if (!company.aiAgentLogic.connectionMessages) {
            company.aiAgentLogic.connectionMessages = {};
        }
        if (!company.aiAgentLogic.connectionMessages.voice) {
            company.aiAgentLogic.connectionMessages.voice = {};
        }
        
        // Set the PRIMARY greeting text
        company.aiAgentLogic.connectionMessages.voice.text = 'Thank you for calling Royal Plumbing. How may I assist you today?';
        company.aiAgentLogic.connectionMessages.voice.mode = 'realtime';
        
        // Also update twilioConfig phone number
        if (!company.twilioConfig) {
            company.twilioConfig = {};
        }
        if (!company.twilioConfig.phoneNumbers) {
            company.twilioConfig.phoneNumbers = [];
        }
        if (company.twilioConfig.phoneNumbers.length === 0) {
            company.twilioConfig.phoneNumbers.push({
                phoneNumber: '+12392322030',
                friendlyName: 'Primary Number',
                isActive: true,
                isPrimary: true
            });
        }
        
        await company.save();
        console.log('✅ Saved to MongoDB!\n');
        
        // Clear Redis cache to force fresh load
        if (redisClient && redisClient.isOpen) {
            await redisClient.del(`company:68eeaf924e989145e9d46c12`);
            console.log('✅ Cleared Redis cache!\n');
        }
        
        // Verify
        const updated = await Company.findById('68eeaf924e989145e9d46c12').lean();
        
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('✅ ROYAL PLUMBING UPDATED');
        console.log('═══════════════════════════════════════════════════════════════\n');
        console.log('Company:', updated.companyName);
        console.log('Phone:', updated.twilioConfig?.phoneNumbers?.[0]?.phoneNumber || 'NOT SET');
        console.log('Greeting:', updated.aiAgentLogic.connectionMessages.voice.text);
        console.log('Mode:', updated.aiAgentLogic.connectionMessages.voice.mode);
        console.log('\n🎯 READY TO TEST: Call +12392322030');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        await mongoose.disconnect();
        if (redisClient && redisClient.isOpen) {
            await redisClient.quit();
        }
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

updateRoyalGreeting();

