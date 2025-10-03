/**
 * 🧪 TEST SCRIPT: Manually save voice settings to database
 * This will help us see if the save is working at all
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('./models/v2Company');

const COMPANY_ID = '68813026dd95f599c74e49c7'; // Atlas Air

async function testVoiceSave() {
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');

        console.log(`\n📦 Loading company ${COMPANY_ID}...`);
        const company = await Company.findById(COMPANY_ID);
        
        if (!company) {
            console.error('❌ Company not found!');
            process.exit(1);
        }

        console.log(`✅ Company found: ${company.companyName}`);
        console.log(`\n🔍 Current aiAgentLogic structure:`, JSON.stringify(company.aiAgentLogic, null, 2));
        console.log(`\n🔍 Current voiceSettings:`, JSON.stringify(company.aiAgentLogic?.voiceSettings, null, 2));

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

        console.log(`\n💾 Attempting to save voice settings...`);
        console.log('Voice settings to save:', JSON.stringify(voiceSettings, null, 2));

        // Initialize aiAgentLogic if not exists
        if (!company.aiAgentLogic) {
            console.log('⚠️ aiAgentLogic does not exist, creating...');
            company.aiAgentLogic = {};
        }

        // Set voice settings
        company.aiAgentLogic.voiceSettings = voiceSettings;
        
        console.log('\n🔍 Company object BEFORE save:', JSON.stringify({
            _id: company._id,
            companyName: company.companyName,
            aiAgentLogic: company.aiAgentLogic
        }, null, 2));

        // Save using Mongoose save()
        console.log('\n💾 Saving with company.save()...');
        await company.save();
        console.log('✅ Save completed!');

        // Verify by re-loading from database
        console.log('\n🔍 Verifying by re-loading from database...');
        const verifyCompany = await Company.findById(COMPANY_ID);
        console.log('Voice settings in DB:', JSON.stringify(verifyCompany.aiAgentLogic?.voiceSettings, null, 2));

        if (verifyCompany.aiAgentLogic?.voiceSettings?.voiceId) {
            console.log('\n✅ ✅ ✅ SUCCESS! Voice settings saved and verified! ✅ ✅ ✅');
        } else {
            console.log('\n❌ ❌ ❌ FAILED! Voice settings NOT in database! ❌ ❌ ❌');
        }

        process.exit(0);

    } catch (error) {
        console.error('\n❌ ERROR:', error);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

testVoiceSave();

