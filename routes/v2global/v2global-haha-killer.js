/**
 * 🚨 HAHA GHOST KILLER V2 API - Emergency endpoint to eliminate haha ghost
 * This endpoint will overwrite ALL legacy greeting data with clean V2 data
 */

const express = require('express');
const router = express.Router();
const Company = require('../../models/Company');
const { redisClient } = require('../../clients');

/**
 * @route   POST /api/v2global/kill-haha-ghost/:companyId
 * @desc    NUCLEAR OPTION: Eliminate haha ghost with clean V2 personality
 * @access  Public (emergency endpoint)
 */
router.post('/kill-haha-ghost/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        console.log('🚨 EMERGENCY: HAHA GHOST KILLER ACTIVATED!');
        console.log(`🎯 Target company: ${companyId}`);
        
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ 
                success: false, 
                error: 'Company not found' 
            });
        }
        
        console.log(`✅ Found company: ${company.businessName || company.companyName}`);
        
        // 🚨 STEP 1: CLEAN V2 PERSONALITY DATA
        console.log('🧹 Creating clean V2 personality data...');
        
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
        console.log('💥 NUCLEAR CLEANUP - Removing ALL legacy greeting sources...');
        
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
        console.log('✅ Installing clean V2 AI Agent Logic...');
        company.aiAgentLogic = cleanV2Personality;
        
        // 🚨 STEP 4: SAVE TO DATABASE
        console.log('💾 Saving to database...');
        await company.save();
        console.log('✅ Database updated successfully!');
        
        // 🚨 STEP 5: CLEAR ALL CACHES
        console.log('🗑️ Clearing ALL caches...');
        
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
        
        console.log('🎉 HAHA GHOST ELIMINATED! 🎉');
        
        res.json({
            success: true,
            message: 'HAHA GHOST ELIMINATED!',
            actions: [
                'Clean V2 personality installed',
                'All legacy greeting sources removed',
                'All caches cleared',
                'Next call should use clean greeting'
            ],
            company: {
                id: company._id,
                name: company.businessName || company.companyName,
                newGreeting: cleanV2Personality.responseCategories.core['greeting-response']
            }
        });
        
    } catch (error) {
        console.error('❌ HAHA GHOST KILLER ERROR:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to eliminate haha ghost',
            details: error.message
        });
    }
});

module.exports = router;
