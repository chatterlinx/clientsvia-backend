require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/v2Company');
const { redisClient } = require('../clients/index');

async function createRoyalPlumbing() {
    try {
        // Connect to MongoDB
        const MONGO_URI = process.env.MONGODB_URI || process.env.MONGODB_URI_PROD;
        
        if (!MONGO_URI) {
            console.error('❌ MONGODB_URI not found in environment variables');
            process.exit(1);
        }
        
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(MONGO_URI);
        console.log('✅ Connected to MongoDB!\n');
        
        console.log('🔌 Checking Redis connection...');
        if (!redisClient || !redisClient.isOpen) {
            console.log('⚠️  Redis not available - will skip caching');
        } else {
            console.log('✅ Redis ready!\n');
        }
        
        // Check if Royal Plumbing already exists
        const existing = await Company.findOne({ businessName: 'Royal Plumbing' });
        if (existing) {
            console.log('⚠️  Royal Plumbing already exists!');
            console.log('Company ID:', existing._id.toString());
            console.log('Phone:', existing.phoneNumbers?.[0] || 'NOT SET');
            await mongoose.disconnect();
            return;
        }
        
        console.log('🏗️  Creating Royal Plumbing company...\n');
        
        const newCompany = new Company({
            businessName: 'Royal Plumbing',
            companyName: 'Royal Plumbing',
            phoneNumbers: ['+12392322030'],
            status: 'active',
            aiAgentLogic: {
                enabled: true,
                version: '2.0',
                connectionMessages: {
                    voice: {
                        mode: 'realtime',
                        text: 'Thank you for calling Royal Plumbing. How may I assist you today?',
                        fallback: 'inline_tts',
                        realtime: {
                            text: 'Thank you for calling Royal Plumbing. How may I assist you today?'
                        }
                    },
                    sms: {
                        enabled: true,
                        text: 'Thank you for contacting Royal Plumbing. We will respond shortly.'
                    },
                    webChat: {
                        enabled: true,
                        text: 'Welcome to Royal Plumbing! How can we help you today?'
                    },
                    lastUpdated: new Date()
                },
                voiceSettings: {
                    apiSource: 'clientsvia',
                    voiceId: 'UgBBYS2sOqTuMpoF3BR0',
                    stability: 0.5,
                    similarityBoost: 0.7,
                    styleExaggeration: 0,
                    speakerBoost: true,
                    aiModel: 'eleven_turbo_v2_5',
                    outputFormat: 'mp3_44100_128',
                    streamingLatency: 0,
                    enabled: true,
                    version: '2.0',
                    lastUpdated: new Date()
                },
                placeholders: [
                    {
                        id: 'companyname',
                        name: 'companyname',
                        value: 'Royal Plumbing'
                    },
                    {
                        id: 'phonenumber',
                        name: 'phonenumber',
                        value: '+12392322030'
                    },
                    {
                        id: 'email',
                        name: 'email',
                        value: 'info@royalplumbing.com'
                    },
                    {
                        id: 'website',
                        name: 'website',
                        value: 'www.royalplumbing.com'
                    }
                ]
            }
        });
        
        await newCompany.save();
        console.log('💾 Saved to MongoDB!\n');
        
        // CRITICAL: Cache to Redis for sub-50ms performance
        const companyId = newCompany._id.toString();
        const cacheKey = `company:${companyId}`;
        
        if (redisClient && redisClient.isOpen) {
            console.log('💨 Caching to Redis for sub-50ms performance...');
            await redisClient.set(
                cacheKey,
                JSON.stringify(newCompany.toObject()),
                { EX: 3600 } // 1 hour TTL
            );
            console.log('✅ Cached to Redis!\n');
        } else {
            console.log('⚠️  Skipping Redis cache (not connected)\n');
        }
        
        console.log('✅ SUCCESS! Royal Plumbing created in BOTH Mongoose + Redis!\n');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('📋 COMPANY DETAILS:');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('Company Name:', newCompany.businessName);
        console.log('Company ID:', companyId);
        console.log('Phone Number:', newCompany.phoneNumbers[0]);
        console.log('Status:', newCompany.status);
        console.log('');
        console.log('🎤 VOICE GREETING:');
        console.log('"' + newCompany.aiAgentLogic.connectionMessages.voice.text + '"');
        console.log('');
        console.log('🔊 VOICE:');
        console.log('Voice ID:', newCompany.aiAgentLogic.voiceSettings.voiceId);
        console.log('API Source:', newCompany.aiAgentLogic.voiceSettings.apiSource);
        console.log('');
        console.log('💨 REDIS CACHE:');
        console.log('Cache Key:', cacheKey);
        console.log('TTL: 1 hour');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('');
        console.log('🎯 NEXT STEP: Call +12392322030 to test!');
        console.log('   Expected greeting: "Thank you for calling Royal Plumbing. How may I assist you today?"');
        console.log('');
        
        await mongoose.disconnect();
        console.log('✅ Disconnected from MongoDB');
        
        if (redisClient && redisClient.isOpen) {
            await redisClient.quit();
            console.log('✅ Disconnected from Redis');
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

createRoyalPlumbing();

