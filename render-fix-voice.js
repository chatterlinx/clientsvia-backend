/**
 * 🚀 RENDER FIX: Save default ElevenLabs voice settings
 * Run this on Render Shell to bypass the UI
 */

require('dotenv').config();
const mongoose = require('mongoose');

// Use Render's MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI;
const COMPANY_ID = '68813026dd95f599c74e49c7'; // Atlas Air

async function fixVoiceSettings() {
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Connected\n');

        const Company = mongoose.model('Company', mongoose.Schema({}, { strict: false }), 'companies');

        console.log('💾 Setting default ElevenLabs voice settings...');
        
        const result = await Company.findByIdAndUpdate(
            COMPANY_ID,
            {
                $set: {
                    'aiAgentLogic.voiceSettings': {
                        apiSource: 'clientsvia',
                        apiKey: null,
                        voiceId: 'pNInz6obpgDQGcFmaJgB', // Adam - Natural, friendly
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
                    }
                }
            },
            { new: true }
        );

        if (!result) {
            console.error('❌ Company not found!');
            process.exit(1);
        }

        console.log('✅ Voice settings saved!');
        console.log('\n🎤 Voice ID: pNInz6obpgDQGcFmaJgB (Adam)');
        console.log('🎤 API Source: clientsvia (global)');
        console.log('🎤 Model: eleven_turbo_v2_5\n');
        console.log('✅ Make a test call now!\n');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

fixVoiceSettings();

