#!/usr/bin/env node

/**
 * 🧹 CLEANUP SCRIPT: Remove hardcoded voice settings from database
 * 
 * This script removes the hardcoded voice ID 'pNInz6obpgDQGcFmaJgB' 
 * that was left in the database from the deleted haha-killer file.
 * 
 * Usage: node scripts/cleanup-hardcoded-voice.js
 */

const mongoose = require('mongoose');
const Company = require('../models/v2Company');
require('dotenv').config();

const HARDCODED_VOICE_ID = 'pNInz6obpgDQGcFmaJgB';

async function cleanupHardcodedVoiceSettings() {
    try {
        console.log('🧹 Starting hardcoded voice settings cleanup...');
        
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');

        // Find companies with the hardcoded voice ID
        const companiesWithHardcodedVoice = await Company.find({
            'aiAgentLogic.voiceSettings.voiceId': HARDCODED_VOICE_ID
        });

        console.log(`🔍 Found ${companiesWithHardcodedVoice.length} companies with hardcoded voice ID`);

        if (companiesWithHardcodedVoice.length === 0) {
            console.log('✅ No companies found with hardcoded voice ID - cleanup not needed');
            return;
        }

        // Show which companies will be affected
        companiesWithHardcodedVoice.forEach(company => {
            console.log(`📋 Company: ${company.companyName} (ID: ${company._id})`);
            console.log(`   Current voice ID: ${company.aiAgentLogic?.voiceSettings?.voiceId}`);
        });

        console.log('\n🚨 This will RESET voice settings to defaults for these companies');
        console.log('   Companies will need to reconfigure their voice in AI Voice Settings tab');

        // Reset voice settings to clean defaults
        const updateResult = await Company.updateMany(
            { 'aiAgentLogic.voiceSettings.voiceId': HARDCODED_VOICE_ID },
            {
                $set: {
                    'aiAgentLogic.voiceSettings': {
                        apiSource: 'clientsvia',
                        apiKey: null,
                        voiceId: null, // Reset to null - must be configured in UI
                        stability: 0.5,
                        similarityBoost: 0.7,
                        styleExaggeration: 0.0,
                        speakerBoost: true,
                        aiModel: 'eleven_turbo_v2_5',
                        outputFormat: 'mp3_44100_128',
                        streamingLatency: 0,
                        enabled: true,
                        lastUpdated: new Date(),
                        version: '2.0'
                    }
                }
            }
        );

        console.log(`✅ Updated ${updateResult.modifiedCount} companies`);
        console.log('🎤 Voice settings have been reset to defaults');
        console.log('📝 Companies must now configure voice in AI Voice Settings tab');

        // Verify cleanup
        const remainingHardcoded = await Company.countDocuments({
            'aiAgentLogic.voiceSettings.voiceId': HARDCODED_VOICE_ID
        });

        if (remainingHardcoded === 0) {
            console.log('✅ Cleanup successful - no hardcoded voice IDs remain');
        } else {
            console.log(`⚠️ Warning: ${remainingHardcoded} companies still have hardcoded voice ID`);
        }

    } catch (error) {
        console.error('❌ Cleanup failed:', error);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Disconnected from MongoDB');
    }
}

// Run cleanup if called directly
if (require.main === module) {
    cleanupHardcodedVoiceSettings()
        .then(() => {
            console.log('🎯 Cleanup complete!');
            process.exit(0);
        })
        .catch(error => {
            console.error('💥 Cleanup failed:', error);
            process.exit(1);
        });
}

module.exports = { cleanupHardcodedVoiceSettings };
