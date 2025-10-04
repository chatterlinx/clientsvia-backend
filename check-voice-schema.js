/**
 * DIAGNOSTIC SCRIPT: Check Voice Settings Schema and Data
 * Purpose: Verify if voiceSettings schema is properly loaded and data can be saved
 */

const mongoose = require('mongoose');
require('dotenv').config();

const COMPANY_ID = '68813026dd95f599c74e49c7'; // Atlas Air

async function checkVoiceSchema() {
    try {
        console.log('🔍 DIAGNOSTIC: Voice Settings Schema Check');
        console.log('='.repeat(80));
        
        // Connect to database
        console.log('\n[STEP 1] Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');

        // Clear Mongoose model cache to force fresh schema load
        console.log('\n[STEP 2] Clearing Mongoose model cache...');
        delete mongoose.connection.models['Company'];
        console.log('✅ Model cache cleared');

        // Load the Company model fresh
        console.log('\n[STEP 3] Loading Company model...');
        const Company = require('./models/v2Company');
        console.log('✅ Company model loaded');

        // Check the schema definition
        console.log('\n[STEP 4] Checking schema definition...');
        const schema = Company.schema;
        const aiAgentLogicPath = schema.path('aiAgentLogic');
        
        console.log('Schema has aiAgentLogic:', !!aiAgentLogicPath);
        
        if (aiAgentLogicPath && aiAgentLogicPath.schema) {
            const voiceSettingsPath = aiAgentLogicPath.schema.path('voiceSettings');
            console.log('aiAgentLogic has voiceSettings:', !!voiceSettingsPath);
            
            if (voiceSettingsPath && voiceSettingsPath.schema) {
                console.log('\n✅ voiceSettings schema structure:');
                const voiceSettingsSchema = voiceSettingsPath.schema;
                console.log('  - apiSource:', !!voiceSettingsSchema.path('apiSource'));
                console.log('  - apiKey:', !!voiceSettingsSchema.path('apiKey'));
                console.log('  - voiceId:', !!voiceSettingsSchema.path('voiceId'));
                console.log('  - stability:', !!voiceSettingsSchema.path('stability'));
                console.log('  - similarityBoost:', !!voiceSettingsSchema.path('similarityBoost'));
                console.log('  - aiModel:', !!voiceSettingsSchema.path('aiModel'));
            }
        }

        // Fetch the company
        console.log(`\n[STEP 5] Fetching company ${COMPANY_ID}...`);
        const company = await Company.findById(COMPANY_ID);
        
        if (!company) {
            console.log('❌ Company not found!');
            process.exit(1);
        }
        
        console.log('✅ Company found:', company.companyName);

        // Check current data state
        console.log('\n[STEP 6] Current data state:');
        console.log('  - Has aiAgentLogic:', !!company.aiAgentLogic);
        console.log('  - Has voiceSettings:', !!company.aiAgentLogic?.voiceSettings);
        console.log('  - Current voiceSettings:', JSON.stringify(company.aiAgentLogic?.voiceSettings, null, 2));

        // TEST SAVE: Try to save voice settings
        console.log('\n[STEP 7] TEST SAVE: Attempting to save voice settings...');
        
        if (!company.aiAgentLogic) {
            company.aiAgentLogic = {};
        }

        const testVoiceSettings = {
            apiSource: 'clientsvia',
            apiKey: null,
            voiceId: 'TEST_VOICE_ID_12345',
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
        };

        console.log('Test settings to save:', JSON.stringify(testVoiceSettings, null, 2));
        
        company.aiAgentLogic.voiceSettings = testVoiceSettings;
        
        console.log('\n[STEP 8] Saving to database...');
        await company.save();
        console.log('✅ Save completed');

        // Verify the save
        console.log('\n[STEP 9] Verifying save by reloading from database...');
        const verifyCompany = await Company.findById(COMPANY_ID);
        
        console.log('Verification results:');
        console.log('  - Has aiAgentLogic:', !!verifyCompany.aiAgentLogic);
        console.log('  - Has voiceSettings:', !!verifyCompany.aiAgentLogic?.voiceSettings);
        console.log('  - Voice ID matches:', verifyCompany.aiAgentLogic?.voiceSettings?.voiceId === 'TEST_VOICE_ID_12345');
        console.log('  - Full voiceSettings:', JSON.stringify(verifyCompany.aiAgentLogic?.voiceSettings, null, 2));

        if (verifyCompany.aiAgentLogic?.voiceSettings?.voiceId === 'TEST_VOICE_ID_12345') {
            console.log('\n✅ SUCCESS: Voice settings saved and persisted correctly!');
        } else {
            console.log('\n❌ FAILURE: Voice settings did NOT persist!');
        }

        console.log('\n' + '='.repeat(80));
        console.log('DIAGNOSTIC COMPLETE');
        console.log('='.repeat(80));

    } catch (error) {
        console.error('\n❌ ERROR:', error);
        console.error('Stack trace:', error.stack);
    } finally {
        await mongoose.disconnect();
        console.log('\n✅ Disconnected from MongoDB');
    }
}

checkVoiceSchema();

