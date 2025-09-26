/**
 * 🚨 HAHA GHOST KILLER V2 - Update Atlas Air with clean V2 personality
 * This script will overwrite ALL legacy greeting data with clean V2 data
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('./models/Company');
const { redisClient } = require('./clients');

async function killHahaGhost() {
    try {
        console.log('🔍 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');
        
        console.log('🎯 Loading Atlas Air company...');
        const company = await Company.findById('68813026dd95f599c74e49c7');
        
        if (!company) {
            console.log('❌ Company not found!');
            return;
        }
        
        console.log(`✅ Found company: ${company.businessName || company.companyName}`);
        
        // 🚨 STEP 1: CLEAN V2 PERSONALITY DATA
        console.log('\n🧹 STEP 1: Creating clean V2 personality data...');
        
        const cleanV2Personality = {
            enabled: true,
            version: "2.0",
            lastUpdated: new Date(),
            
            // ✅ CLEAN RESPONSE CATEGORIES - NO HAHA!
            responseCategories: {
                core: {
                    'greeting-response': `Thanks for calling ${company.businessName || company.companyName}. How can I help you today?`,
                    'hold-message': `Please hold while I look that up for you.`,
                    'transfer-message': `Let me connect you with someone who can help you better.`,
                    'goodbye-message': `Thank you for calling ${company.businessName || company.companyName}. Have a great day!`,
                    'clarification-request': `I want to make sure I understand correctly. Could you please clarify that for me?`,
                    'escalation-message': `Let me connect you to a team member who can assist you further.`,
                    'repeat-escalation-message': `I'm having trouble understanding. Let me connect you to a team member.`,
                    'no-match-found': `I don't have specific information about that, but let me connect you with someone who can help.`,
                    'system-error': `I'm experiencing a technical issue. Let me connect you to a team member right away.`,
                    'booking-confirmation': `Great! I've got all your information. Let me connect you to schedule your appointment.`
                },
                greeting: {
                    template: `Thanks for calling ${company.businessName || company.companyName}. How can I help you today?`,
                    enabled: true
                }
            },
            
            // ✅ CLEAN AGENT PERSONALITY - PROFESSIONAL
            agentPersonality: {
                tone: 'professional',
                style: 'helpful',
                personality: 'friendly',
                voice: {
                    tone: 'natural',
                    speed: 'normal'
                }
            },
            
            // ✅ CLEAN VOICE SETTINGS
            voiceSettings: {
                voiceId: 'pNInz6obpgDQGcFmaJgB', // Adam voice
                stability: 0.5,
                similarityBoost: 0.8,
                styleExaggeration: 0.0,
                aiModel: 'eleven_multilingual_v2'
            },
            
            // ✅ CLEAN THRESHOLDS
            thresholds: {
                companyQnA: 0.8,
                tradeQnA: 0.75,
                templates: 0.7,
                inHouseFallback: 0.5
            },
            
            // ✅ CLEAN MEMORY SETTINGS
            memorySettings: {
                useConversationContext: true,
                contextWindow: 5,
                personalizeResponses: true,
                contextRetention: 50
            },
            
            // ✅ CLEAN FALLBACK BEHAVIOR
            fallbackBehavior: {
                noMatchFound: 'use_in_house_fallback',
                lowConfidence: 'escalate_or_fallback',
                systemError: 'emergency_fallback'
            }
        };
        
        // 🚨 STEP 2: NUCLEAR OPTION - OVERWRITE ALL LEGACY DATA
        console.log('\n💥 STEP 2: NUCLEAR CLEANUP - Removing ALL legacy greeting sources...');
        
        // Remove ALL possible legacy greeting sources
        company.agentGreeting = undefined;
        company.agentPersonality = undefined;
        if (company.aiSettings) {
            company.aiSettings.greeting = undefined;
        }
        if (company.agentSetup) {
            company.agentSetup.agentGreeting = undefined;
        }
        
        // 🚨 STEP 3: INSTALL CLEAN V2 DATA
        console.log('\n✅ STEP 3: Installing clean V2 AI Agent Logic...');
        company.aiAgentLogic = cleanV2Personality;
        
        // 🚨 STEP 4: SAVE TO DATABASE
        console.log('\n💾 STEP 4: Saving to database...');
        await company.save();
        console.log('✅ Database updated successfully!');
        
        // 🚨 STEP 5: CLEAR ALL CACHES
        console.log('\n🗑️ STEP 5: Clearing ALL caches...');
        
        // Clear Redis cache
        try {
            if (redisClient) {
                await redisClient.del(`company:${company._id}`);
                await redisClient.del(`ai_config_${company._id}`);
                console.log('✅ Redis cache cleared');
            }
        } catch (redisError) {
            console.log('⚠️ Redis cache clear failed (this is OK):', redisError.message);
        }
        
        console.log('\n🎉 HAHA GHOST ELIMINATED! 🎉');
        console.log('✅ Clean V2 personality installed');
        console.log('✅ All legacy greeting sources removed');
        console.log('✅ All caches cleared');
        console.log('\n🔥 The next call should use the clean greeting!');
        
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Disconnected from MongoDB');
    }
}

killHahaGhost();
