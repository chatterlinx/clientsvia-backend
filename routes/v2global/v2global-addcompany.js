/**
 * V2 GLOBAL ADD COMPANY ROUTES - Enterprise Company Creation
 * 
 * V2 GLOBAL ADD COMPANY - ENTERPRISE ARCHITECTURE:
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║ COMPANY CREATION V2 - MULTI-TENANT PLATFORM MANAGEMENT          ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║ Features: Streamlined Company Creation, Validation, Defaults     ║
 * ║ Security: JWT Authentication + Admin Role Required               ║
 * ║ Performance: Optimized Creation + Auto-defaults + Redis Cache    ║
 * ║ Architecture: V2 Global Structure - No Legacy Dependencies      ║
 * ╚══════════════════════════════════════════════════════════════════╝
 * 
 * V2 Global Add Company Features:
 * - Streamlined 3-field creation (Name, Phone, Address)
 * - Auto-generated enterprise defaults
 * - Comprehensive validation with helpful error messages
 * - Automatic AI Agent Logic initialization
 * - Trade category suggestions
 * - Timezone detection
 * - Profile completion tracking
 * 
 * This V2 version provides enterprise-grade company creation
 * with intelligent defaults and complete legacy elimination.
 */

const express = require('express');
const router = express.Router();
const Company = require('../../models/Company');
const TradeCategory = require('../../models/TradeCategory');
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const { redisClient } = require('../../clients');
const logger = require('../../utils/logger');

/**
 * 🏢 POST CREATE COMPANY - V2 Global Add Company
 * Streamlined company creation with enterprise defaults
 */
router.post('/companies', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const startTime = Date.now();
        const {
            companyName,
            companyPhone,
            companyAddress,
            // Optional fields for enhanced creation
            businessEmail,
            businessWebsite,
            serviceArea,
            description,
            tradeCategories = [],
            timezone
        } = req.body;

        logger.info(`🏢 V2 GLOBAL ADD COMPANY: Creating company by admin:`, {
            adminUser: req.user.email,
            companyName,
            companyPhone: companyPhone ? 'provided' : 'missing',
            companyAddress: companyAddress ? 'provided' : 'missing'
        });

        // 🔍 Enhanced Validation
        const validationErrors = [];
        
        if (!companyName || companyName.trim().length === 0) {
            validationErrors.push('Company Name is required and cannot be empty');
        } else if (companyName.trim().length < 2) {
            validationErrors.push('Company Name must be at least 2 characters long');
        } else if (companyName.trim().length > 100) {
            validationErrors.push('Company Name cannot exceed 100 characters');
        }

        if (!companyPhone || companyPhone.trim().length === 0) {
            validationErrors.push('Primary Phone Number is required for AI agent functionality');
        } else if (!/^[\+]?[1-9][\d]{0,15}$/.test(companyPhone.replace(/[\s\-\(\)]/g, ''))) {
            validationErrors.push('Primary Phone Number must be a valid phone number format');
        }

        if (!companyAddress || companyAddress.trim().length === 0) {
            validationErrors.push('Company Address is required');
        } else if (companyAddress.trim().length < 10) {
            validationErrors.push('Company Address must include street, city, state, and zip code');
        } else if (companyAddress.trim().length > 500) {
            validationErrors.push('Company Address cannot exceed 500 characters');
        }

        // Check for duplicate company name
        const existingCompany = await Company.findOne({ 
            companyName: { $regex: new RegExp(`^${companyName.trim()}$`, 'i') }
        });
        
        if (existingCompany) {
            validationErrors.push('A company with this name already exists. Please choose a different name.');
        }

        // Check for duplicate phone number
        const existingPhone = await Company.findOne({ 
            businessPhone: companyPhone.trim()
        });
        
        if (existingPhone) {
            validationErrors.push('This phone number is already associated with another company.');
        }

        if (validationErrors.length > 0) {
            logger.warn(`🚫 V2 GLOBAL ADD COMPANY: Validation failed:`, validationErrors);
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                details: validationErrors,
                source: 'v2-global-addcompany'
            });
        }

        // 🚀 Auto-detect timezone based on phone number area code (basic implementation)
        let detectedTimezone = timezone || 'America/New_York';
        if (!timezone && companyPhone) {
            const areaCode = companyPhone.replace(/\D/g, '').substring(1, 4);
            detectedTimezone = getTimezoneFromAreaCode(areaCode) || 'America/New_York';
        }

        // 🏗️ Build comprehensive company data with V2 enterprise defaults
        const newCompanyData = {
            // Basic Information
            companyName: companyName.trim(),
            businessPhone: companyPhone.trim(),
            businessAddress: companyAddress.trim(),
            businessEmail: businessEmail?.trim() || null,
            businessWebsite: businessWebsite?.trim() || null,
            serviceArea: serviceArea?.trim() || 'Local Area',
            description: description?.trim() || `Professional services provided by ${companyName.trim()}`,
            
            // Trade Categories
            tradeCategories: Array.isArray(tradeCategories) ? tradeCategories : [],
            
            // System Configuration
            timezone: detectedTimezone,
            isActive: true,
            status: 'active',
            profileComplete: false, // Will be true once additional details are added
            
            // V2 AI Agent Logic - Enterprise Defaults
            aiAgentLogic: {
                // Knowledge Source Thresholds
                thresholds: {
                    companyQnA: 0.84,
                    tradeQnA: 0.75,
                    templates: 0.7,
                    inHouseFallback: 0.5
                },
                
                // Memory Settings
                memorySettings: {
                    memoryMode: 'conversational',
                    contextRetention: 50
                },
                
                // Fallback Behavior
                fallbackBehavior: {
                    message: 'I want to make sure I give you accurate information. Let me connect you with a specialist who can help.',
                    escalateOnNoMatch: true,
                    rejectLowConfidence: true
                },
                
                // Knowledge Management Structure
                knowledgeManagement: {
                    companyQnA: [],
                    tradeQnA: [],
                    templates: [],
                    inHouseFallback: {
                        enabled: true,
                        responses: [
                            `Thank you for calling ${companyName.trim()}. How can I help you today?`,
                            `Hi! This is ${companyName.trim()}'s AI assistant. What can I do for you?`,
                            `Welcome to ${companyName.trim()}. I'm here to help with your questions.`
                        ]
                    },
                    statistics: {
                        totalQuestions: 0,
                        averageConfidence: 0,
                        lastUpdated: new Date()
                    },
                    version: 1,
                    lastUpdated: new Date()
                },
                
                // Personality System
                personalitySystem: {
                    corePersonality: {
                        voiceTone: 'professional',
                        communicationStyle: 'helpful',
                        responseLength: 'concise',
                        formalityLevel: 'professional'
                    },
                    emotionalIntelligence: {
                        empathyLevel: 'high',
                        adaptability: 'medium',
                        patience: 'high'
                    },
                    brandAlignment: {
                        companyValues: [],
                        keyMessages: [],
                        avoidTopics: []
                    }
                },
                
                // Call Transfer Configuration
                callTransferConfig: {
                    dialOutEnabled: false,
                    dialOutNumber: null,
                    transferMessage: 'Let me connect you with someone who can better assist you.'
                },
                
                // Analytics
                analytics: {
                    enabled: true,
                    realTimeUpdates: true,
                    retentionDays: 90,
                    metrics: {
                        callVolume: 0,
                        averageCallDuration: 0,
                        resolutionRate: 0,
                        customerSatisfaction: 0
                    },
                    autoExports: {
                        enabled: false,
                        frequency: 'weekly',
                        recipients: []
                    }
                },
                
                // Voice Settings (ElevenLabs Integration)
                voiceSettings: {
                    apiSource: 'clientsvia',
                    apiKey: null,
                    voiceId: null,
                    stability: 0.5,
                    similarityBoost: 0.7,
                    styleExaggeration: 0.0,
                    speakerBoost: true,
                    aiModel: 'eleven_turbo_v2_5',
                    outputFormat: 'mp3_44100_128',
                    streamingLatency: 0,
                    enabled: true,
                    version: '2.0',
                    lastUpdated: new Date()
                }
            },
            
            // Legacy compatibility fields (will be removed in future versions)
            companyPhone: companyPhone.trim(), // Duplicate for legacy compatibility
            companyAddress: companyAddress.trim(), // Duplicate for legacy compatibility
            
            // Timestamps
            createdAt: new Date(),
            updatedAt: new Date()
        };

        // 🚀 Create company with Mongoose
        const newCompany = new Company(newCompanyData);
        const savedCompany = await newCompany.save();

        // 🗑️ Clear related caches
        try {
            await redisClient.del('v2-global-directory:trade-categories');
            await redisClient.del('v2-global-directory:statistics');
        } catch (cacheError) {
            logger.warn('⚠️ Cache clear failed:', cacheError.message);
        }

        const responseTime = Date.now() - startTime;
        
        logger.info(`✅ V2 GLOBAL ADD COMPANY: Company created successfully in ${responseTime}ms`, {
            companyId: savedCompany._id,
            companyName: savedCompany.companyName,
            adminUser: req.user.email
        });

        res.status(201).json({
            success: true,
            data: {
                _id: savedCompany._id,
                companyName: savedCompany.companyName,
                businessPhone: savedCompany.businessPhone,
                businessAddress: savedCompany.businessAddress,
                businessEmail: savedCompany.businessEmail,
                businessWebsite: savedCompany.businessWebsite,
                serviceArea: savedCompany.serviceArea,
                description: savedCompany.description,
                tradeCategories: savedCompany.tradeCategories,
                timezone: savedCompany.timezone,
                isActive: savedCompany.isActive,
                profileComplete: savedCompany.profileComplete,
                createdAt: savedCompany.createdAt
            },
            meta: {
                responseTime,
                source: 'v2-global-addcompany',
                aiAgentLogicInitialized: true,
                profileCompletionUrl: `/company-profile.html?id=${savedCompany._id}`
            },
            message: `Company "${savedCompany.companyName}" created successfully with enterprise AI Agent Logic defaults`
        });

    } catch (error) {
        logger.error('❌ V2 GLOBAL ADD COMPANY: Error creating company:', error);
        
        // Handle specific MongoDB errors
        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern)[0];
            return res.status(400).json({
                success: false,
                error: 'Duplicate entry',
                details: [`A company with this ${field} already exists`],
                source: 'v2-global-addcompany'
            });
        }
        
        res.status(500).json({
            success: false,
            error: 'Failed to create company',
            details: error.message,
            source: 'v2-global-addcompany'
        });
    }
});

/**
 * 🌍 GET TIMEZONE SUGGESTIONS - V2 Global Add Company Helper
 * Get timezone suggestions based on location or area code
 */
router.get('/timezone-suggestions', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { areaCode, location } = req.query;
        
        let suggestions = [];
        
        if (areaCode) {
            const timezone = getTimezoneFromAreaCode(areaCode);
            if (timezone) {
                suggestions.push({
                    timezone,
                    description: `Detected from area code ${areaCode}`,
                    confidence: 'high'
                });
            }
        }
        
        // Add common timezone options
        const commonTimezones = [
            { timezone: 'America/New_York', description: 'Eastern Time (ET)', confidence: 'medium' },
            { timezone: 'America/Chicago', description: 'Central Time (CT)', confidence: 'medium' },
            { timezone: 'America/Denver', description: 'Mountain Time (MT)', confidence: 'medium' },
            { timezone: 'America/Los_Angeles', description: 'Pacific Time (PT)', confidence: 'medium' },
            { timezone: 'America/Phoenix', description: 'Arizona Time (MST)', confidence: 'medium' },
            { timezone: 'America/Anchorage', description: 'Alaska Time (AKST)', confidence: 'medium' },
            { timezone: 'Pacific/Honolulu', description: 'Hawaii Time (HST)', confidence: 'medium' }
        ];
        
        // Add common timezones if not already suggested
        commonTimezones.forEach(tz => {
            if (!suggestions.find(s => s.timezone === tz.timezone)) {
                suggestions.push(tz);
            }
        });
        
        res.json({
            success: true,
            data: suggestions,
            meta: {
                source: 'v2-global-addcompany-timezone'
            }
        });
        
    } catch (error) {
        logger.error('❌ V2 GLOBAL ADD COMPANY: Error getting timezone suggestions:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get timezone suggestions',
            details: error.message
        });
    }
});

/**
 * 🏷️ Helper function to detect timezone from area code
 * Basic implementation - can be enhanced with more comprehensive mapping
 */
function getTimezoneFromAreaCode(areaCode) {
    const timezoneMap = {
        // Eastern Time
        '212': 'America/New_York', '646': 'America/New_York', '917': 'America/New_York',
        '201': 'America/New_York', '973': 'America/New_York', '732': 'America/New_York',
        '215': 'America/New_York', '267': 'America/New_York', '445': 'America/New_York',
        '404': 'America/New_York', '678': 'America/New_York', '770': 'America/New_York',
        '305': 'America/New_York', '786': 'America/New_York', '954': 'America/New_York',
        
        // Central Time
        '312': 'America/Chicago', '773': 'America/Chicago', '872': 'America/Chicago',
        '214': 'America/Chicago', '469': 'America/Chicago', '972': 'America/Chicago',
        '713': 'America/Chicago', '281': 'America/Chicago', '832': 'America/Chicago',
        '512': 'America/Chicago', '737': 'America/Chicago',
        
        // Mountain Time
        '303': 'America/Denver', '720': 'America/Denver', '970': 'America/Denver',
        '801': 'America/Denver', '385': 'America/Denver',
        
        // Pacific Time
        '213': 'America/Los_Angeles', '323': 'America/Los_Angeles', '424': 'America/Los_Angeles',
        '310': 'America/Los_Angeles', '818': 'America/Los_Angeles', '747': 'America/Los_Angeles',
        '415': 'America/Los_Angeles', '628': 'America/Los_Angeles', '650': 'America/Los_Angeles',
        '206': 'America/Los_Angeles', '253': 'America/Los_Angeles', '425': 'America/Los_Angeles',
        
        // Arizona (no DST)
        '480': 'America/Phoenix', '602': 'America/Phoenix', '623': 'America/Phoenix',
        
        // Alaska
        '907': 'America/Anchorage',
        
        // Hawaii
        '808': 'Pacific/Honolulu'
    };
    
    return timezoneMap[areaCode] || null;
}

module.exports = router;
