// routes/aiAgentPersonality.js
// 🎭 World-Class AI Agent Personality System API
// Enterprise-grade personality configuration with Mongoose + Redis

const express = require('express');
const router = express.Router();
const Company = require('../models/Company');
const { requireAuth } = require('../middleware/auth');

// Redis client for caching
let redisClient;
try {
    redisClient = require('../db').redisClient;
} catch (error) {
    console.warn('⚠️ Redis not available for personality caching:', error.message);
}

// 🎭 GET /api/ai-agent/personality/:companyId
// Retrieve comprehensive personality configuration for a company
router.get('/personality/:companyId', requireAuth, async (req, res) => {
    try {
        const { companyId } = req.params;
        
        console.log(`🎭 PERSONALITY API: Loading configuration for company ${companyId}`);
        
        // Try Redis cache first for sub-50ms performance
        if (redisClient) {
            try {
                const cachedPersonality = await redisClient.get(`personality:${companyId}`);
                if (cachedPersonality) {
                    console.log(`⚡ PERSONALITY CACHE HIT: Company ${companyId}`);
                    return res.json({
                        success: true,
                        data: JSON.parse(cachedPersonality),
                        source: 'cache'
                    });
                }
            } catch (cacheError) {
                console.warn('⚠️ Redis cache read error:', cacheError.message);
            }
        }
        
        // Fetch from MongoDB
        const company = await Company.findById(companyId).select('aiAgentLogic.personalitySystem companyName');
        
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found',
                companyId
            });
        }
        
        // Get personality system or initialize with defaults
        const personalitySystem = company.aiAgentLogic?.personalitySystem || {
            corePersonality: {
                voiceTone: 'friendly',
                speechPace: 'normal',
                formalityLevel: 'business',
                empathyLevel: 4,
                technicalDepth: 'moderate',
                useCustomerName: true
            },
            emotionalIntelligence: {
                frustratedResponse: 'I understand this is frustrating. Let me help you right away.',
                urgentResponse: 'I can hear this is urgent. Let me get you immediate assistance.',
                confusedResponse: 'No worries, let me explain this more clearly.',
                acknowledgeEmotion: true,
                mirrorTone: true,
                offerReassurance: true,
                reassurancePhrase: 'We\'ll definitely get this sorted out for you.'
            },
            conversationPatterns: {
                openingPhrases: [
                    'How can I help you today?',
                    'What\'s going on with your system?',
                    'Tell me what\'s happening.',
                    'What brings you to us today?'
                ],
                clarifyingQuestions: [
                    'Can you tell me more about that?',
                    'When did this first start happening?',
                    'What exactly are you experiencing?'
                ],
                closingPhrases: [
                    'Is there anything else I can help you with?',
                    'Does that take care of everything?',
                    'Perfect, you\'re all set!'
                ],
                useFillerPhrases: true,
                acknowledgeWaiting: true,
                summarizeUnderstanding: true,
                responseDelay: 'natural'
            },
            contextMemory: {
                memorySpan: 'week',
                rememberName: true,
                rememberIssues: true,
                rememberPreferences: true,
                referToPrevious: true,
                followUpReminders: true,
                returningGreeting: 'Good to hear from you again! How did that repair work out?',
                contextTransitions: [
                    'Last time we spoke about...',
                    'Following up on our previous conversation...'
                ]
            },
            proactiveIntelligence: {
                anticipateNeeds: true,
                preventiveAdvice: true,
                seasonalReminders: true,
                proactivePhrases: [
                    'While I have you, you might also want to consider...',
                    'Since we\'re talking about that, have you thought about...',
                    'This would be a great time to also check...'
                ],
                admitUncertainty: true,
                escalateGracefully: true,
                uncertaintyPhrases: [
                    'I want to make sure I give you the right information. Let me connect you with a specialist.'
                ],
                escalationPhrases: [
                    'This sounds like something our expert technician should handle directly.'
                ]
            },
            systemConfig: {
                enabled: true,
                version: '1.0.0',
                lastUpdated: new Date(),
                updatedBy: 'system'
            }
        };
        
        // Cache in Redis for future requests
        if (redisClient) {
            try {
                await redisClient.setex(`personality:${companyId}`, 3600, JSON.stringify(personalitySystem)); // 1 hour cache
                console.log(`💾 PERSONALITY CACHED: Company ${companyId}`);
            } catch (cacheError) {
                console.warn('⚠️ Redis cache write error:', cacheError.message);
            }
        }
        
        console.log(`✅ PERSONALITY LOADED: Company ${company.companyName} (${companyId})`);
        
        res.json({
            success: true,
            data: personalitySystem,
            companyName: company.companyName,
            source: 'database'
        });
        
    } catch (error) {
        console.error('❌ PERSONALITY API ERROR:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load personality configuration',
            details: error.message
        });
    }
});

// 🎭 PUT /api/ai-agent/personality/:companyId
// Save comprehensive personality configuration for a company
router.put('/personality/:companyId', requireAuth, async (req, res) => {
    try {
        const { companyId } = req.params;
        const personalityConfig = req.body;
        
        console.log(`🎭 PERSONALITY API: Saving configuration for company ${companyId}`);
        console.log(`📊 PERSONALITY CONFIG: ${Object.keys(personalityConfig).length} settings received`);
        
        // Validate required fields
        if (!personalityConfig || typeof personalityConfig !== 'object') {
            return res.status(400).json({
                success: false,
                error: 'Invalid personality configuration data'
            });
        }
        
        // Structure the personality data for MongoDB
        const personalitySystemUpdate = {
            corePersonality: {
                voiceTone: personalityConfig.voiceTone || 'friendly',
                speechPace: personalityConfig.speechPace || 'normal',
                formalityLevel: personalityConfig.formalityLevel || 'business',
                empathyLevel: parseInt(personalityConfig.empathyLevel) || 4,
                technicalDepth: personalityConfig.technicalDepth || 'moderate',
                useCustomerName: personalityConfig.useCustomerName === true
            },
            emotionalIntelligence: {
                frustratedResponse: personalityConfig.frustratedResponse || 'I understand this is frustrating. Let me help you right away.',
                urgentResponse: personalityConfig.urgentResponse || 'I can hear this is urgent. Let me get you immediate assistance.',
                confusedResponse: personalityConfig.confusedResponse || 'No worries, let me explain this more clearly.',
                acknowledgeEmotion: personalityConfig.acknowledgeEmotion === true,
                mirrorTone: personalityConfig.mirrorTone === true,
                offerReassurance: personalityConfig.offerReassurance === true,
                reassurancePhrase: personalityConfig.reassurancePhrase || 'We\'ll definitely get this sorted out for you.'
            },
            conversationPatterns: {
                openingPhrases: Array.isArray(personalityConfig.openingPhrases) ? personalityConfig.openingPhrases : [
                    'How can I help you today?',
                    'What\'s going on with your system?',
                    'Tell me what\'s happening.',
                    'What brings you to us today?'
                ],
                clarifyingQuestions: Array.isArray(personalityConfig.clarifyingQuestions) ? personalityConfig.clarifyingQuestions : [
                    'Can you tell me more about that?',
                    'When did this first start happening?',
                    'What exactly are you experiencing?'
                ],
                closingPhrases: Array.isArray(personalityConfig.closingPhrases) ? personalityConfig.closingPhrases : [
                    'Is there anything else I can help you with?',
                    'Does that take care of everything?',
                    'Perfect, you\'re all set!'
                ],
                useFillerPhrases: personalityConfig.useFillerPhrases === true,
                acknowledgeWaiting: personalityConfig.acknowledgeWaiting === true,
                summarizeUnderstanding: personalityConfig.summarizeUnderstanding === true,
                responseDelay: personalityConfig.responseDelay || 'natural'
            },
            contextMemory: {
                memorySpan: personalityConfig.memorySpan || 'week',
                rememberName: personalityConfig.rememberName === true,
                rememberIssues: personalityConfig.rememberIssues === true,
                rememberPreferences: personalityConfig.rememberPreferences === true,
                referToPrevious: personalityConfig.referToPrevious === true,
                followUpReminders: personalityConfig.followUpReminders === true,
                returningGreeting: personalityConfig.returningGreeting || 'Good to hear from you again! How did that repair work out?',
                contextTransitions: Array.isArray(personalityConfig.contextTransitions) ? personalityConfig.contextTransitions : [
                    'Last time we spoke about...',
                    'Following up on our previous conversation...'
                ]
            },
            proactiveIntelligence: {
                anticipateNeeds: personalityConfig.anticipateNeeds === true,
                preventiveAdvice: personalityConfig.preventiveAdvice === true,
                seasonalReminders: personalityConfig.seasonalReminders === true,
                proactivePhrases: Array.isArray(personalityConfig.proactivePhrases) ? personalityConfig.proactivePhrases : [
                    'While I have you, you might also want to consider...',
                    'Since we\'re talking about that, have you thought about...',
                    'This would be a great time to also check...'
                ],
                admitUncertainty: personalityConfig.admitUncertainty === true,
                escalateGracefully: personalityConfig.escalateGracefully === true,
                uncertaintyPhrases: Array.isArray(personalityConfig.uncertaintyPhrases) ? personalityConfig.uncertaintyPhrases : [
                    'I want to make sure I give you the right information. Let me connect you with a specialist.'
                ],
                escalationPhrases: Array.isArray(personalityConfig.escalationPhrases) ? personalityConfig.escalationPhrases : [
                    'This sounds like something our expert technician should handle directly.'
                ]
            },
            systemConfig: {
                enabled: true,
                version: '1.0.0',
                lastUpdated: new Date(),
                updatedBy: req.user?.email || 'system'
            }
        };
        
        // Update MongoDB with Mongoose
        const updatedCompany = await Company.findByIdAndUpdate(
            companyId,
            {
                $set: {
                    'aiAgentLogic.personalitySystem': personalitySystemUpdate,
                    'aiAgentLogic.lastUpdated': new Date()
                }
            },
            { 
                new: true, 
                runValidators: true,
                select: 'companyName aiAgentLogic.personalitySystem'
            }
        );
        
        if (!updatedCompany) {
            return res.status(404).json({
                success: false,
                error: 'Company not found',
                companyId
            });
        }
        
        // Clear Redis cache to ensure fresh data on next request
        if (redisClient) {
            try {
                await redisClient.del(`personality:${companyId}`);
                console.log(`🗑️ PERSONALITY CACHE CLEARED: Company ${companyId}`);
            } catch (cacheError) {
                console.warn('⚠️ Redis cache clear error:', cacheError.message);
            }
        }
        
        // Count enabled features for response
        const enabledFeatures = Object.values(personalityConfig).filter(v => 
            v === true || (Array.isArray(v) && v.length > 0) || (typeof v === 'string' && v.trim())
        ).length;
        
        console.log(`✅ PERSONALITY SAVED: Company ${updatedCompany.companyName} (${companyId})`);
        console.log(`📊 FEATURES ENABLED: ${enabledFeatures} intelligent features configured`);
        
        res.json({
            success: true,
            message: 'World-class AI personality configuration saved successfully',
            companyName: updatedCompany.companyName,
            settingsCount: Object.keys(personalityConfig).length,
            enabledFeatures,
            data: updatedCompany.aiAgentLogic.personalitySystem,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ PERSONALITY SAVE ERROR:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to save personality configuration',
            details: error.message
        });
    }
});

// 🎭 POST /api/ai-agent/personality/:companyId/reset
// Reset personality configuration to defaults
router.post('/personality/:companyId/reset', requireAuth, async (req, res) => {
    try {
        const { companyId } = req.params;
        
        console.log(`🔄 PERSONALITY RESET: Company ${companyId}`);
        
        // Reset to default personality configuration
        const defaultPersonalitySystem = {
            corePersonality: {
                voiceTone: 'friendly',
                speechPace: 'normal',
                formalityLevel: 'business',
                empathyLevel: 4,
                technicalDepth: 'moderate',
                useCustomerName: true
            },
            emotionalIntelligence: {
                frustratedResponse: 'I understand this is frustrating. Let me help you right away.',
                urgentResponse: 'I can hear this is urgent. Let me get you immediate assistance.',
                confusedResponse: 'No worries, let me explain this more clearly.',
                acknowledgeEmotion: true,
                mirrorTone: true,
                offerReassurance: true,
                reassurancePhrase: 'We\'ll definitely get this sorted out for you.'
            },
            conversationPatterns: {
                openingPhrases: [
                    'How can I help you today?',
                    'What\'s going on with your system?',
                    'Tell me what\'s happening.',
                    'What brings you to us today?'
                ],
                clarifyingQuestions: [
                    'Can you tell me more about that?',
                    'When did this first start happening?',
                    'What exactly are you experiencing?'
                ],
                closingPhrases: [
                    'Is there anything else I can help you with?',
                    'Does that take care of everything?',
                    'Perfect, you\'re all set!'
                ],
                useFillerPhrases: true,
                acknowledgeWaiting: true,
                summarizeUnderstanding: true,
                responseDelay: 'natural'
            },
            contextMemory: {
                memorySpan: 'week',
                rememberName: true,
                rememberIssues: true,
                rememberPreferences: true,
                referToPrevious: true,
                followUpReminders: true,
                returningGreeting: 'Good to hear from you again! How did that repair work out?',
                contextTransitions: [
                    'Last time we spoke about...',
                    'Following up on our previous conversation...'
                ]
            },
            proactiveIntelligence: {
                anticipateNeeds: true,
                preventiveAdvice: true,
                seasonalReminders: true,
                proactivePhrases: [
                    'While I have you, you might also want to consider...',
                    'Since we\'re talking about that, have you thought about...',
                    'This would be a great time to also check...'
                ],
                admitUncertainty: true,
                escalateGracefully: true,
                uncertaintyPhrases: [
                    'I want to make sure I give you the right information. Let me connect you with a specialist.'
                ],
                escalationPhrases: [
                    'This sounds like something our expert technician should handle directly.'
                ]
            },
            systemConfig: {
                enabled: true,
                version: '1.0.0',
                lastUpdated: new Date(),
                updatedBy: req.user?.email || 'system'
            }
        };
        
        // Update MongoDB
        const updatedCompany = await Company.findByIdAndUpdate(
            companyId,
            {
                $set: {
                    'aiAgentLogic.personalitySystem': defaultPersonalitySystem,
                    'aiAgentLogic.lastUpdated': new Date()
                }
            },
            { 
                new: true, 
                runValidators: true,
                select: 'companyName'
            }
        );
        
        if (!updatedCompany) {
            return res.status(404).json({
                success: false,
                error: 'Company not found',
                companyId
            });
        }
        
        // Clear Redis cache
        if (redisClient) {
            try {
                await redisClient.del(`personality:${companyId}`);
                console.log(`🗑️ PERSONALITY CACHE CLEARED: Company ${companyId}`);
            } catch (cacheError) {
                console.warn('⚠️ Redis cache clear error:', cacheError.message);
            }
        }
        
        console.log(`✅ PERSONALITY RESET: Company ${updatedCompany.companyName} (${companyId})`);
        
        res.json({
            success: true,
            message: 'Personality configuration reset to defaults',
            companyName: updatedCompany.companyName,
            data: defaultPersonalitySystem,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ PERSONALITY RESET ERROR:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to reset personality configuration',
            details: error.message
        });
    }
});

module.exports = router;
