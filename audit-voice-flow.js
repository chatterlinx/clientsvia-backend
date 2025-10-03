/**
 * 🔍 COMPLETE AUDIT: Voice Settings Flow from Database → Twilio Call
 * This traces the ENTIRE path to identify where the disconnect is
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('./models/v2Company');

const COMPANY_ID = '68813026dd95f599c74e49c7'; // Atlas Air

async function auditVoiceFlow() {
    try {
        console.log('🔌 Connecting to MongoDB...\n');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        console.log('='.repeat(80));
        console.log('📋 STEP 1: CHECK DATABASE SCHEMA');
        console.log('='.repeat(80));
        
        const schemaPath = Company.schema.paths['aiAgentLogic.voiceSettings'];
        console.log('Schema path exists:', !!schemaPath);
        if (schemaPath) {
            console.log('Schema type:', schemaPath.instance);
            console.log('Schema options:', schemaPath.options);
        } else {
            console.error('❌ CRITICAL: voiceSettings not in schema!');
        }

        console.log('\n' + '='.repeat(80));
        console.log('📋 STEP 2: LOAD COMPANY FROM DATABASE');
        console.log('='.repeat(80));
        
        const company = await Company.findById(COMPANY_ID);
        if (!company) {
            console.error('❌ Company not found!');
            process.exit(1);
        }

        console.log('✅ Company found:', company.companyName);
        console.log('Company ID:', company._id);

        console.log('\n' + '='.repeat(80));
        console.log('📋 STEP 3: CHECK aiAgentLogic STRUCTURE');
        console.log('='.repeat(80));
        
        console.log('aiAgentLogic exists:', !!company.aiAgentLogic);
        console.log('aiAgentLogic keys:', company.aiAgentLogic ? Object.keys(company.aiAgentLogic._doc || company.aiAgentLogic) : 'N/A');

        console.log('\n' + '='.repeat(80));
        console.log('📋 STEP 4: CHECK voiceSettings');
        console.log('='.repeat(80));
        
        console.log('voiceSettings exists:', !!company.aiAgentLogic?.voiceSettings);
        console.log('voiceSettings value:', company.aiAgentLogic?.voiceSettings);
        console.log('voiceSettings type:', typeof company.aiAgentLogic?.voiceSettings);

        if (company.aiAgentLogic?.voiceSettings) {
            console.log('\n✅ Voice Settings Found:');
            console.log(JSON.stringify(company.aiAgentLogic.voiceSettings, null, 2));
        } else {
            console.log('\n❌ Voice Settings NOT FOUND in database!');
        }

        console.log('\n' + '='.repeat(80));
        console.log('📋 STEP 5: TEST MANUAL SAVE');
        console.log('='.repeat(80));
        
        const testVoiceSettings = {
            apiSource: 'clientsvia',
            apiKey: null,
            voiceId: 'UgBBYS2sOqTuMpoF3BR0', // Mark - Natural Conversations (ElevenLabs voice)
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

        console.log('Attempting to save voice settings...');
        console.log('Settings to save:', JSON.stringify(testVoiceSettings, null, 2));

        // Use findByIdAndUpdate to bypass any schema issues
        const updateResult = await Company.findByIdAndUpdate(
            COMPANY_ID,
            {
                $set: {
                    'aiAgentLogic.voiceSettings': testVoiceSettings
                }
            },
            {
                new: true,
                runValidators: true
            }
        );

        if (!updateResult) {
            console.error('❌ Update failed - company not found');
            process.exit(1);
        }

        console.log('✅ Update command executed');

        console.log('\n' + '='.repeat(80));
        console.log('📋 STEP 6: VERIFY SAVE (Re-load from database)');
        console.log('='.repeat(80));
        
        const verifyCompany = await Company.findById(COMPANY_ID);
        console.log('voiceSettings after save:', verifyCompany.aiAgentLogic?.voiceSettings);

        if (verifyCompany.aiAgentLogic?.voiceSettings?.voiceId) {
            console.log('\n✅ ✅ ✅ SUCCESS! Voice settings are now in database!');
            console.log('\nSaved settings:');
            console.log(JSON.stringify(verifyCompany.aiAgentLogic.voiceSettings, null, 2));
        } else {
            console.log('\n❌ ❌ ❌ FAILED! Voice settings did NOT persist!');
            console.log('\nThis indicates a MONGOOSE SCHEMA PROBLEM.');
            console.log('The voiceSettings field is not properly defined in the schema.');
        }

        console.log('\n' + '='.repeat(80));
        console.log('📋 STEP 7: CHECK GLOBAL ELEVENLABS API KEY');
        console.log('='.repeat(80));
        
        const globalKey = process.env.ELEVENLABS_API_KEY;
        if (globalKey) {
            console.log('✅ Global ElevenLabs API key found in environment');
            console.log(`   Key length: ${globalKey.length}`);
            console.log(`   Last 4 chars: ...${globalKey.slice(-4)}`);
        } else {
            console.log('❌ Global ElevenLabs API key NOT found in environment!');
            console.log('   This will cause calls to fail even if voiceSettings are saved.');
        }

        console.log('\n' + '='.repeat(80));
        console.log('📋 AUDIT COMPLETE');
        console.log('='.repeat(80));
        
        console.log('\n✅ Next Steps:');
        console.log('1. If voiceSettings are NOT saved: FIX THE SCHEMA (indentation issue)');
        console.log('2. If voiceSettings ARE saved but calls still use Twilio: Check Twilio route logic');
        console.log('3. Make a test call and check Render logs for voice settings loading\n');

        process.exit(0);

    } catch (error) {
        console.error('\n❌ AUDIT ERROR:', error);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

auditVoiceFlow();

