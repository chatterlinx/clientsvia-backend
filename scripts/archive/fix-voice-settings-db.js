/**
 * 🔧 FIX: Manually set ElevenLabs voice settings in database
 * 
 * This script directly updates the voice settings for a company
 * when the UI save is not working.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('./models/v2Company');

const COMPANY_ID = '68813026dd95f599c74e49c7'; // Atlas Air

async function fixVoiceSettings() {
    try {
        console.log('🔧 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('✅ Connected to MongoDB');

        console.log(`\n🔍 Loading company ${COMPANY_ID}...`);
        const company = await Company.findById(COMPANY_ID);
        
        if (!company) {
            console.error(`❌ Company ${COMPANY_ID} not found`);
            process.exit(1);
        }

        console.log(`✅ Found company: ${company.companyName || company.businessName}`);
        console.log(`\n📊 Current voice settings:`, company.aiAgentLogic?.voiceSettings || 'NONE');

        // Set default ElevenLabs voice settings
        const defaultVoiceSettings = {
            apiSource: 'clientsvia',  // Use ClientsVia global API
            apiKey: null,             // No custom API key
            voiceId: 'pNInz6obpgDQGcFmaJgB',  // Adam (default male voice)
            
            // Voice Quality Controls
            stability: 0.5,
            similarityBoost: 0.7,
            styleExaggeration: 0.0,
            
            // Performance & Output
            speakerBoost: true,
            aiModel: 'eleven_turbo_v2_5',
            outputFormat: 'mp3_44100_128',
            streamingLatency: 0,
            
            // Metadata
            enabled: true,
            lastUpdated: new Date(),
            version: '2.0'
        };

        console.log(`\n🎤 Setting voice settings:`, defaultVoiceSettings);

        // Use findByIdAndUpdate for direct database update
        const updateResult = await Company.findByIdAndUpdate(
            COMPANY_ID,
            {
                $set: {
                    'aiAgentLogic.voiceSettings': defaultVoiceSettings
                }
            },
            { new: true, runValidators: true }
        );

        console.log(`\n✅ Voice settings saved to database!`);
        console.log(`📊 Update result exists:`, !!updateResult);
        console.log(`\n📊 Verification - Reading back from DB...`);
        
        const verifyCompany = await Company.findById(COMPANY_ID);
        console.log(`✅ Voice settings in DB:`, verifyCompany.aiAgentLogic?.voiceSettings);

        console.log(`\n🎉 SUCCESS! Voice settings are now configured.`);
        console.log(`\n🎯 Next steps:`);
        console.log(`   1. Make a test call to: ${company.companyPhone}`);
        console.log(`   2. Check Render logs for: "Using ElevenLabs voice pNInz6obpgDQGcFmaJgB"`);
        console.log(`   3. You should hear Adam's voice (male, natural)`);

    } catch (error) {
        console.error('❌ Error fixing voice settings:', error);
    } finally {
        await mongoose.connection.close();
        console.log('\n✅ MongoDB connection closed');
        process.exit(0);
    }
}

fixVoiceSettings();

