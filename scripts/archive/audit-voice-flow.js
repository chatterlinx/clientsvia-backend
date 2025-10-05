/**
 * 🔍 COMPLETE AUDIT: Voice Settings Flow from Database → Twilio Call
 * This traces the ENTIRE path to identify where the disconnect is
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('./models/v2Company');
const logger = require('./utils/logger');

const COMPANY_ID = '68813026dd95f599c74e49c7'; // Atlas Air
const SEPARATOR_LENGTH = 80;
const LAST_CHARS_COUNT = 4;

function checkDatabaseSchema() {
    logger.info('📋 STEP 1: CHECK DATABASE SCHEMA');
    logger.info('='.repeat(SEPARATOR_LENGTH));

    const schemaPath = Company.schema.paths['aiAgentLogic.voiceSettings'];
    logger.info(`Schema path exists: ${Boolean(schemaPath)}`);
    if (schemaPath) {
        logger.info(`Schema type: ${schemaPath.instance}`);
        logger.info(`Schema options: ${JSON.stringify(schemaPath.options)}`);
        return true;
    } else {
        logger.error('❌ CRITICAL: voiceSettings not in schema!');
        return false;
    }
}

async function loadCompanyFromDatabase() {
    logger.info('📋 STEP 2: LOAD COMPANY FROM DATABASE');
    logger.info('='.repeat(SEPARATOR_LENGTH));

    const company = await Company.findById(COMPANY_ID);
    if (!company) {
        logger.error('❌ Company not found!');
        process.exit(1);
    }

    logger.info(`✅ Company found: ${company.companyName}`);
    logger.info(`Company ID: ${company._id}`);
    return company;
}

function checkAIAgentLogicStructure(company) {
    logger.info('📋 STEP 3: CHECK aiAgentLogic STRUCTURE');
    logger.info('='.repeat(SEPARATOR_LENGTH));

    logger.info(`aiAgentLogic exists: ${Boolean(company.aiAgentLogic)}`);
    logger.info(`aiAgentLogic keys: ${company.aiAgentLogic ? Object.keys(company.aiAgentLogic._doc || company.aiAgentLogic) : 'N/A'}`);
    return company.aiAgentLogic;
}

function checkVoiceSettings(company) {
    logger.info('📋 STEP 4: CHECK voiceSettings');
    logger.info('='.repeat(SEPARATOR_LENGTH));

    logger.info(`voiceSettings exists: ${Boolean(company.aiAgentLogic?.voiceSettings)}`);
    logger.info(`voiceSettings value: ${JSON.stringify(company.aiAgentLogic?.voiceSettings)}`);
    logger.info(`voiceSettings type: ${typeof company.aiAgentLogic?.voiceSettings}`);

    if (company.aiAgentLogic?.voiceSettings) {
        logger.info('\n✅ Voice Settings Found:');
        logger.info(JSON.stringify(company.aiAgentLogic.voiceSettings, null, 2));
        return company.aiAgentLogic.voiceSettings;
    }

    logger.info('\n❌ Voice Settings NOT FOUND in database!');
    return null;
}

async function testManualSave() {
    logger.info('📋 STEP 5: TEST MANUAL SAVE');
    logger.info('='.repeat(SEPARATOR_LENGTH));

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

    logger.info('Attempting to save voice settings...');
    logger.info(`Settings to save: ${JSON.stringify(testVoiceSettings, null, 2)}`);

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
        logger.error('❌ Update failed - company not found');
        process.exit(1);
    }

    logger.info('✅ Update command executed');
    return updateResult;
}

async function verifySave() {
    logger.info('📋 STEP 6: VERIFY SAVE (Re-load from database)');
    logger.info('='.repeat(SEPARATOR_LENGTH));

    const verifyCompany = await Company.findById(COMPANY_ID);
    logger.info(`voiceSettings after save: ${JSON.stringify(verifyCompany.aiAgentLogic?.voiceSettings)}`);

    if (verifyCompany.aiAgentLogic?.voiceSettings?.voiceId) {
        logger.info('\n✅ ✅ ✅ SUCCESS! Voice settings are now in database!');
        logger.info('\nSaved settings:');
        logger.info(JSON.stringify(verifyCompany.aiAgentLogic.voiceSettings, null, 2));
        return true;
    } else {
        logger.info('\n❌ ❌ ❌ FAILED! Voice settings did NOT persist!');
        logger.info('\nThis indicates a MONGOOSE SCHEMA PROBLEM.');
        logger.info('The voiceSettings field is not properly defined in the schema.');
        return false;
    }
}

function checkElevenLabsAPIKey() {
    logger.info('📋 STEP 7: CHECK GLOBAL ELEVENLABS API KEY');
    logger.info('='.repeat(SEPARATOR_LENGTH));

    const globalKey = process.env.ELEVENLABS_API_KEY;
    if (globalKey) {
        logger.info('✅ Global ElevenLabs API key found in environment');
        logger.info(`   Key length: ${globalKey.length}`);
        logger.info(`   Last ${LAST_CHARS_COUNT} chars: ...${globalKey.slice(-LAST_CHARS_COUNT)}`);
        return true;
    }

    logger.info('❌ Global ElevenLabs API key NOT found in environment!');
    logger.info('   This will cause calls to fail even if voiceSettings are saved.');
    return false;
}

function printAuditSummary() {
    logger.info('📋 AUDIT COMPLETE');
    logger.info('='.repeat(SEPARATOR_LENGTH));

    logger.info('\n✅ Next Steps:');
    logger.info('1. If voiceSettings are NOT saved: FIX THE SCHEMA (indentation issue)');
    logger.info('2. If voiceSettings ARE saved but calls still use Twilio: Check Twilio route logic');
    logger.info('3. Make a test call and check Render logs for voice settings loading\n');
}

async function auditVoiceFlow() {
    try {
        logger.info('🔌 Connecting to MongoDB...\n');
        await mongoose.connect(process.env.MONGODB_URI);
        logger.info('✅ Connected to MongoDB\n');

        // Execute audit steps
        await checkDatabaseSchema();

        const company = await loadCompanyFromDatabase();
        await checkAIAgentLogicStructure(company);
        await checkVoiceSettings(company);
        await testManualSave();
        await verifySave();
        await checkElevenLabsAPIKey();
        await printAuditSummary();

        process.exit(0);

    } catch (error) {
        logger.error('\n❌ AUDIT ERROR', { error: error.message, stack: error.stack });
        process.exit(1);
    }
}

auditVoiceFlow();

