/**
 * Fix Voice Settings for Atlas Air
 * Checks and sets voice settings if missing
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('./models/v2Company');

const ATLAS_AIR_ID = '68813026dd95f599c74e49c7';

async function fixVoiceSettings() {
    try {
        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/clientsvia-test';
        console.log(`🔌 Connecting to MongoDB: ${mongoUri}`);
        
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB');

        // Find Atlas Air company
        const company = await Company.findById(ATLAS_AIR_ID);
        
        if (!company) {
            console.error(`❌ Company ${ATLAS_AIR_ID} not found`);
            process.exit(1);
        }

        console.log(`\n📊 CURRENT STATE for ${company.companyName}:`);
        console.log(`Has aiAgentLogic: ${!!company.aiAgentLogic}`);
        console.log(`Has voiceSettings: ${!!company.aiAgentLogic?.voiceSettings}`);
        console.log(`Voice ID: ${company.aiAgentLogic?.voiceSettings?.voiceId || 'NOT SET'}`);
        console.log(`API Source: ${company.aiAgentLogic?.voiceSettings?.apiSource || 'NOT SET'}`);
        
        // Initialize aiAgentLogic if not exists
        if (!company.aiAgentLogic) {
            company.aiAgentLogic = { enabled: true };
        }

        // Check if voice settings are missing or incomplete
        if (!company.aiAgentLogic.voiceSettings || !company.aiAgentLogic.voiceSettings.voiceId) {
            console.log(`\n🔧 Setting default voice settings...`);
            
            // Set default voice settings
            company.aiAgentLogic.voiceSettings = {
                apiSource: 'clientsvia', // Use global ClientsVia API
                apiKey: null, // Not using own API
                voiceId: 'pNInz6obpgDQGcFmaJgB', // Adam - Default ElevenLabs voice
                
                // Voice Quality Controls
                stability: 0.5,
                similarityBoost: 0.7,
                styleExaggeration: 0.0,
                
                // Performance & Output
                speakerBoost: true,
                aiModel: 'eleven_turbo_v2_5',
                outputFormat: 'mp3_44100_128',
                streamingLatency: 0,
                
                // V2 Metadata
                enabled: true,
                lastUpdated: new Date(),
                version: '2.0'
            };

            // Save to database
            await company.save();
            
            console.log(`✅ Voice settings saved successfully!`);
            console.log(`\n📊 NEW STATE:`);
            console.log(`Voice ID: ${company.aiAgentLogic.voiceSettings.voiceId}`);
            console.log(`API Source: ${company.aiAgentLogic.voiceSettings.apiSource}`);
            console.log(`Model: ${company.aiAgentLogic.voiceSettings.aiModel}`);
            console.log(`Stability: ${company.aiAgentLogic.voiceSettings.stability}`);
            console.log(`Similarity Boost: ${company.aiAgentLogic.voiceSettings.similarityBoost}`);
            
        } else {
            console.log(`\n✅ Voice settings already configured!`);
            console.log(`Voice ID: ${company.aiAgentLogic.voiceSettings.voiceId}`);
            console.log(`API Source: ${company.aiAgentLogic.voiceSettings.apiSource}`);
        }

        console.log(`\n✅ Fix complete!`);
        console.log(`\n📝 NEXT STEPS:`);
        console.log(`1. Make a test call to verify ElevenLabs voice is working`);
        console.log(`2. Check Render logs for: "🏢 V2: Using ClientsVia GLOBAL ElevenLabs API"`);
        console.log(`3. You should hear the Adam voice (natural male voice)`);
        console.log(`4. You can change the voice in the UI (AI Voice Settings tab) anytime`);

    } catch (error) {
        console.error('❌ Error:', error);
        console.error('Stack:', error.stack);
    } finally {
        await mongoose.disconnect();
        console.log('\n🔌 Disconnected from MongoDB');
    }
}

fixVoiceSettings();

