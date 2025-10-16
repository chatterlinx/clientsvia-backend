#!/usr/bin/env node

/**
 * 🔧 VOICE SETTINGS SCHEMA MIGRATION
 * 
 * Fixes legacy string values → object structure
 * Covers ALL possible legacy locations
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function migrateVoiceSettings() {
    try {
        console.log('\n🔧 VOICE SETTINGS SCHEMA MIGRATION');
        console.log('═'.repeat(80));
        
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');
        
        const db = mongoose.connection.db;
        const companies = db.collection('v2companies');
        
        const results = {
            totalScanned: 0,
            fixed: {
                aiVoiceProvider: 0,
                aiVoice: 0,
                aiAgentLogicVoiceSettings: 0
            }
        };
        
        // A) Fix ai.voice.provider (if it's a string)
        console.log('🔍 Checking ai.voice.provider...');
        const fixA = await companies.updateMany(
            { "ai.voice.provider": { $type: "string" } },
            [
                {
                    $set: {
                        "ai.voice.provider": {
                            name: "$ai.voice.provider",
                            enabled: true,
                            model: "eleven_multilingual_v2",
                            voiceId: "",
                            stability: 0.5,
                            similarity: 0.75,
                            style: 0,
                            useSpeakerBoost: true
                        }
                    }
                }
            ]
        );
        results.fixed.aiVoiceProvider = fixA.modifiedCount;
        console.log(`   Fixed ${fixA.modifiedCount} documents`);
        
        // B) Fix ai.voice (if it's a string)
        console.log('🔍 Checking ai.voice...');
        const fixB = await companies.updateMany(
            { "ai.voice": { $type: "string" } },
            [
                {
                    $set: {
                        "ai.voice": {
                            provider: {
                                name: "$ai.voice",
                                enabled: true,
                                model: "eleven_multilingual_v2",
                                voiceId: "",
                                stability: 0.5,
                                similarity: 0.75,
                                style: 0,
                                useSpeakerBoost: true
                            },
                            testMessage: "Hello! Thanks for calling. How can I help you today?"
                        }
                    }
                }
            ]
        );
        results.fixed.aiVoice = fixB.modifiedCount;
        console.log(`   Fixed ${fixB.modifiedCount} documents`);
        
        // C) Fix aiAgentLogic.voiceSettings (if it's a string)
        console.log('🔍 Checking aiAgentLogic.voiceSettings...');
        const fixC = await companies.updateMany(
            { "aiAgentLogic.voiceSettings": { $type: "string" } },
            [
                {
                    $set: {
                        "aiAgentLogic.voiceSettings": {
                            apiSource: "clientsvia",
                            apiKey: null,
                            voiceId: null,
                            stability: 0.5,
                            similarityBoost: 0.7,
                            styleExaggeration: 0.0,
                            speakerBoost: true,
                            aiModel: "eleven_turbo_v2_5",
                            outputFormat: "mp3_44100_128",
                            streamingLatency: 0,
                            enabled: true,
                            lastUpdated: new Date(),
                            version: "2.0"
                        }
                    }
                }
            ]
        );
        results.fixed.aiAgentLogicVoiceSettings = fixC.modifiedCount;
        console.log(`   Fixed ${fixC.modifiedCount} documents`);
        
        // Summary
        results.totalScanned = await companies.countDocuments({});
        
        console.log('\n' + '═'.repeat(80));
        console.log('📊 MIGRATION SUMMARY');
        console.log('═'.repeat(80));
        console.log(`Total companies:                      ${results.totalScanned}`);
        console.log(`Fixed ai.voice.provider:              ${results.fixed.aiVoiceProvider}`);
        console.log(`Fixed ai.voice:                       ${results.fixed.aiVoice}`);
        console.log(`Fixed aiAgentLogic.voiceSettings:     ${results.fixed.aiAgentLogicVoiceSettings}`);
        console.log(`Total fixed:                          ${Object.values(results.fixed).reduce((a, b) => a + b, 0)}`);
        console.log('═'.repeat(80));
        
        await mongoose.disconnect();
        console.log('\n✅ Migration complete!\n');
        process.exit(0);
        
    } catch (error) {
        console.error('\n❌ MIGRATION ERROR:', error);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

migrateVoiceSettings();

