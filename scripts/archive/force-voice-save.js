/**
 * 🔥 FORCE VOICE SAVE: Use direct MongoDB update to bypass Mongoose schema cache
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('./models/v2Company');

const COMPANY_ID = '68813026dd95f599c74e49c7'; // Atlas Air

async function forceVoiceSave() {
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        // Set default ElevenLabs voice settings
        const voiceSettings = {
            apiSource: 'clientsvia',
            apiKey: null,
            voiceId: 'pNInz6obpgDQGcFmaJgB', // Adam voice
            stability: 0.5,
            similarityBoost: 0.75,
            styleExaggeration: 0.0,
            speakerBoost: true,
            aiModel: 'eleven_turbo_v2_5',
            outputFormat: 'mp3_44100_128',
            streamingLatency: 0,
            enabled: true,
            lastUpdated: new Date(),
            version: '2.0'
        };

        console.log('💾 FORCE UPDATING voice settings using findByIdAndUpdate...');
        console.log('Voice settings:', JSON.stringify(voiceSettings, null, 2));

        // Use findByIdAndUpdate with $set operator
        const result = await Company.findByIdAndUpdate(
            COMPANY_ID,
            {
                $set: {
                    'aiAgentLogic.voiceSettings': voiceSettings
                }
            },
            {
                new: true, // Return updated document
                runValidators: false // Skip validation for now
            }
        );

        if (!result) {
            console.error('❌ Company not found!');
            process.exit(1);
        }

        console.log('✅ Update completed!\n');

        // Verify by re-loading from database
        console.log('🔍 Verifying by re-loading from database...');
        const verifyCompany = await Company.findById(COMPANY_ID);
        console.log('Voice settings in DB:', JSON.stringify(verifyCompany.aiAgentLogic?.voiceSettings, null, 2));

        if (verifyCompany.aiAgentLogic?.voiceSettings?.voiceId) {
            console.log('\n✅ ✅ ✅ SUCCESS! Voice settings saved and verified! ✅ ✅ ✅');
            console.log(`\n🎤 Voice ID: ${verifyCompany.aiAgentLogic.voiceSettings.voiceId}`);
            console.log(`🎤 API Source: ${verifyCompany.aiAgentLogic.voiceSettings.apiSource}`);
            console.log(`🎤 Model: ${verifyCompany.aiAgentLogic.voiceSettings.aiModel}`);
        } else {
            console.log('\n❌ ❌ ❌ FAILED! Voice settings STILL NOT in database! ❌ ❌ ❌');
            console.log('\nThis means there is a Mongoose schema issue or the field is being stripped.');
        }

        process.exit(0);

    } catch (error) {
        console.error('\n❌ ERROR:', error);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

forceVoiceSave();

