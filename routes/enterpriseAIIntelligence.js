/**
 * Enterprise AI Intelligence Settings API
 * Handles comprehensive AI intelligence configuration including:
 * - Composite confidence scoring
 * - LLM provider routing & circuit breaker
 * - Cost controls & caps
 * - Two-layer memory management
 * - Prompt firewall & security
 * - Enterprise features & compliance
 */

const express = require('express');
const router = express.Router();
const Company = require('../models/Company');
const { ObjectId } = require('mongodb');
const { authenticateJWT, authenticateSingleSession } = require('../middleware/auth');

// ===============================================
// 🚀 GET ENTERPRISE AI INTELLIGENCE SETTINGS
// ===============================================

router.get('/companies/:companyId/enterprise-ai-settings', authenticateJWT, async (req, res) => {
    try {
        console.log('🏢 CHECKPOINT: Enterprise AI settings endpoint called');
        console.log('🏢 CHECKPOINT: Company ID:', req.params.companyId);
        
        const { companyId } = req.params;
        
        if (!ObjectId.isValid(companyId)) {
            console.error('❌ CHECKPOINT: Invalid company ID format for Enterprise AI');
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid company ID format',
                checkpoint: 'Enterprise AI company ID validation failed',
                details: { companyId, expectedFormat: 'MongoDB ObjectId (24 chars)' }
            });
        }

        console.log('🏢 CHECKPOINT: Looking up company for Enterprise AI settings');

        const company = await Company.findById(companyId).select('enterpriseAIIntelligence tradeCategories');

        if (!company) {
            console.error('❌ CHECKPOINT: Company not found for Enterprise AI');
            return res.status(404).json({ 
                success: false, 
                error: 'Company not found',
                checkpoint: 'Enterprise AI company lookup failed',
                details: { companyId }
            });
        }

        console.log('✅ CHECKPOINT: Company found for Enterprise AI:', company.companyName || 'Unnamed');
        console.log('🏢 CHECKPOINT: Has existing Enterprise AI settings:', !!company.enterpriseAIIntelligence);

        // Return enterprise AI settings with production defaults if not set
        const enterpriseSettings = company.enterpriseAIIntelligence || getEnterpriseDefaults();
        
        // Include trade categories for frontend weight configuration
        const tradeCategories = company.tradeCategories || [];

        console.log('✅ CHECKPOINT: Enterprise AI settings prepared successfully');
        console.log('🏢 CHECKPOINT: Settings include', Object.keys(enterpriseSettings).length, 'configuration sections');

        res.json({ 
            success: true, 
            settings: enterpriseSettings,
            tradeCategories: tradeCategories,
            configVersion: enterpriseSettings.configVersion || '1.0.0',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        // NEVER mask errors - enhance with comprehensive checkpoints
        console.error('❌ CRITICAL: Enterprise AI settings endpoint failed - FULL ERROR DETAILS:');
        console.error('❌ CHECKPOINT: Error message:', error.message);
        console.error('❌ CHECKPOINT: Error stack:', error.stack);
        console.error('❌ CHECKPOINT: Error name:', error.name);
        console.error('❌ CHECKPOINT: Request details:', {
            companyId: req.params.companyId,
            method: req.method,
            url: req.originalUrl,
            userAgent: req.headers['user-agent']
        });
        
        res.status(500).json({ 
            success: false, 
            error: 'Failed to get enterprise AI settings',
            details: error.message,
            checkpoint: 'Enterprise AI settings route error - check server logs for full details',
            timestamp: new Date().toISOString()
        });
    }
});

// ===============================================
// 🚀 UPDATE ENTERPRISE AI INTELLIGENCE SETTINGS
// ===============================================

router.put('/companies/:companyId/enterprise-ai-settings', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { enterpriseAISettings } = req.body;
        
        if (!ObjectId.isValid(companyId)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid company ID format' 
            });
        }

        logger.info('Enterprise AI settings update requested', { companyId });
        // Log settings in development only
        if (process.env.NODE_ENV === 'development') {
            logger.debug('Enterprise AI settings', { settings: JSON.stringify(enterpriseAISettings, null, 2) });
        }

        // Validate settings
        const validationResult = validateEnterpriseSettings(enterpriseAISettings);
        if (!validationResult.valid) {
            return res.status(400).json({
                success: false,
                error: 'Invalid settings',
                details: validationResult.errors
            });
        }

        // Prepare the update with enterprise defaults merged
        const updateData = {
            enterpriseAIIntelligence: {
                ...getEnterpriseDefaults(),
                ...enterpriseAISettings,
                lastUpdated: new Date(),
                configVersion: '1.0.0'
            }
        };

        // Update company settings
        const company = await Company.findByIdAndUpdate(
            companyId,
            { $set: updateData },
            { new: true, runValidators: true }
        );

        if (!company) {
            return res.status(404).json({ 
                success: false, 
                error: 'Company not found' 
            });
        }

        // Reset daily usage if it's a new day
        await resetDailyUsageIfNeeded(company);

        console.log(`[Enterprise AI] ✅ Enterprise AI settings updated successfully`);

        res.json({ 
            success: true, 
            message: 'Enterprise AI settings updated successfully',
            settings: company.enterpriseAIIntelligence,
            configVersion: company.enterpriseAIIntelligence.configVersion
        });

    } catch (error) {
        console.error('[Enterprise AI] ❌ Error updating enterprise AI settings:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to update enterprise AI settings',
            details: error.message 
        });
    }
});

// ===============================================
// 🚀 GET COPY-PASTE JSON DEFAULTS
// ===============================================

router.get('/enterprise-ai-defaults', (req, res) => {
    try {
        const defaults = getEnterpriseDefaults();
        
        res.json({
            success: true,
            message: 'Enterprise AI Intelligence default configuration',
            copyPasteJSON: JSON.stringify(defaults, null, 2),
            defaults: defaults,
            documentation: {
                compositeConfidence: 'Weighted scoring system for multiple knowledge sources',
                providerRouter: 'LLM provider routing with circuit breaker failover',
                costControls: 'Daily budget caps and token limits with emergency override',
                memoryManagement: 'Two-layer memory: session + profile with data retention',
                security: 'Prompt firewall, timeouts, data residency, PII protection',
                enterpriseFeatures: 'Audit logging, performance metrics, caching, backups'
            }
        });
    } catch (error) {
        console.error('[Enterprise AI] ❌ Error getting defaults:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to get defaults' 
        });
    }
});

// ===============================================
// 🚀 VALIDATE ENTERPRISE CONFIGURATION
// ===============================================

router.post('/companies/:companyId/validate-ai-config', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { config } = req.body;

        console.log(`[Enterprise AI] 🔍 Validating AI config for company: ${companyId}`);

        const validationResult = validateEnterpriseSettings(config);
        
        if (validationResult.valid) {
            // Run additional business logic validation
            const businessValidation = await validateBusinessLogic(companyId, config);
            
            res.json({
                success: true,
                valid: businessValidation.valid,
                errors: businessValidation.errors,
                warnings: businessValidation.warnings,
                recommendations: businessValidation.recommendations
            });
        } else {
            res.json({
                success: true,
                valid: false,
                errors: validationResult.errors,
                warnings: [],
                recommendations: []
            });
        }

    } catch (error) {
        console.error('[Enterprise AI] ❌ Error validating config:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to validate configuration',
            details: error.message 
        });
    }
});

// ===============================================
// 🚀 RESET TO ENTERPRISE DEFAULTS
// ===============================================

router.post('/companies/:companyId/reset-enterprise-ai', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        
        if (!ObjectId.isValid(companyId)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid company ID format' 
            });
        }

        console.log(`[Enterprise AI] 🔄 Resetting to enterprise defaults for company: ${companyId}`);

        const enterpriseDefaults = getEnterpriseDefaults();
        
        const company = await Company.findByIdAndUpdate(
            companyId,
            { 
                $set: { 
                    enterpriseAIIntelligence: {
                        ...enterpriseDefaults,
                        lastUpdated: new Date(),
                        updatedBy: 'system-reset'
                    }
                }
            },
            { new: true, runValidators: true }
        );

        if (!company) {
            return res.status(404).json({ 
                success: false, 
                error: 'Company not found' 
            });
        }

        console.log(`[Enterprise AI] ✅ Successfully reset to enterprise defaults`);

        res.json({ 
            success: true, 
            message: 'Enterprise AI settings reset to production defaults',
            settings: company.enterpriseAIIntelligence
        });

    } catch (error) {
        console.error('[Enterprise AI] ❌ Error resetting to defaults:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to reset to enterprise defaults',
            details: error.message 
        });
    }
});

// ===============================================
// 🚀 HELPER FUNCTIONS
// ===============================================

/**
 * Get production-ready enterprise defaults
 */
function getEnterpriseDefaults() {
    return {
        compositeConfidence: {
            knowledgeWeights: {
                companyKB: 85,
                clientsViaKB: 75,
                llmFallback: 40
            },
            compositeThreshold: 70,
            negativeKeywords: ['pricing', 'cost', 'quote', 'estimate', 'legal', 'lawsuit', 'refund', 'complaint'],
            synonymGroups: ['repair,fix,broken', 'install,setup,new', 'emergency,urgent,asap', 'appointment,booking,schedule'],
            tradeCategoryWeights: {}
        },
        providerRouter: {
            primaryProvider: 'anthropic-claude',
            fallbackChain: {
                fallback1: 'google-gemini',
                fallback2: 'openai-gpt4'
            },
            circuitBreaker: {
                errorThreshold: 5,
                timeoutSeconds: 30,
                enabled: true
            }
        },
        costControls: {
            dailyLLMBudget: 50,
            maxTokensPerCall: 1000,
            emergencyOverrideEnabled: false,
            currentDayUsage: 0,
            lastResetDate: new Date()
        },
        memoryManagement: {
            sessionTTLMinutes: 30,
            profileMemoryEnabled: false,
            dataRetentionDays: 30
        },
        security: {
            llmTimeoutSeconds: 15,
            totalCallTimeoutSeconds: 45,
            blockedPatterns: [
                'ignore instructions', 'system prompt', 'jailbreak', 
                'act as', 'pretend you are', 'developer mode',
                'admin override', 'bypass security'
            ],
            dataResidency: 'us-east',
            piiDetectionEnabled: true,
            maskSensitiveData: true
        },
        enterpriseFeatures: {
            enableDetailedLogging: true,
            enablePerformanceMetrics: true,
            enableCostTracking: true,
            auditLogEnabled: true,
            dataExportEnabled: true,
            rateLimitPerMinute: 60,
            cachingEnabled: true,
            cacheExpiryMinutes: 30,
            autoBackupEnabled: true,
            backupFrequencyHours: 24
        },
        enabled: true,
        configVersion: '1.0.0',
        lastUpdated: new Date(),
        updatedBy: 'system'
    };
}

/**
 * Validate enterprise settings structure and values
 */
function validateEnterpriseSettings(settings) {
    const errors = [];

    if (!settings) {
        errors.push('Settings object is required');
        return { valid: false, errors };
    }

    // Validate composite confidence
    if (settings.compositeConfidence) {
        const cc = settings.compositeConfidence;
        
        if (cc.knowledgeWeights) {
            const weights = cc.knowledgeWeights;
            ['companyKB', 'clientsViaKB', 'llmFallback'].forEach(key => {
                if (weights[key] !== undefined && (weights[key] < 0 || weights[key] > 100)) {
                    errors.push(`${key} weight must be between 0 and 100`);
                }
            });
        }
        
        if (cc.compositeThreshold !== undefined && (cc.compositeThreshold < 0 || cc.compositeThreshold > 100)) {
            errors.push('Composite threshold must be between 0 and 100');
        }
    }

    // Validate provider router
    if (settings.providerRouter) {
        const pr = settings.providerRouter;
        const validProviders = ['openai-gpt4', 'anthropic-claude', 'google-gemini', 'none'];
        
        if (pr.primaryProvider && !validProviders.includes(pr.primaryProvider)) {
            errors.push('Invalid primary provider');
        }
        
        if (pr.fallbackChain) {
            if (pr.fallbackChain.fallback1 && !validProviders.includes(pr.fallbackChain.fallback1)) {
                errors.push('Invalid fallback1 provider');
            }
            if (pr.fallbackChain.fallback2 && !validProviders.includes(pr.fallbackChain.fallback2)) {
                errors.push('Invalid fallback2 provider');
            }
        }

        if (pr.circuitBreaker) {
            const cb = pr.circuitBreaker;
            if (cb.errorThreshold !== undefined && (cb.errorThreshold < 1 || cb.errorThreshold > 20)) {
                errors.push('Circuit breaker error threshold must be between 1 and 20');
            }
            if (cb.timeoutSeconds !== undefined && (cb.timeoutSeconds < 5 || cb.timeoutSeconds > 300)) {
                errors.push('Circuit breaker timeout must be between 5 and 300 seconds');
            }
        }
    }

    // Validate cost controls
    if (settings.costControls) {
        const cc = settings.costControls;
        if (cc.dailyLLMBudget !== undefined && (cc.dailyLLMBudget < 0 || cc.dailyLLMBudget > 1000)) {
            errors.push('Daily LLM budget must be between 0 and 1000');
        }
        if (cc.maxTokensPerCall !== undefined && (cc.maxTokensPerCall < 100 || cc.maxTokensPerCall > 4000)) {
            errors.push('Max tokens per call must be between 100 and 4000');
        }
    }

    // Validate memory management
    if (settings.memoryManagement) {
        const mm = settings.memoryManagement;
        if (mm.sessionTTLMinutes !== undefined && (mm.sessionTTLMinutes < 5 || mm.sessionTTLMinutes > 120)) {
            errors.push('Session TTL must be between 5 and 120 minutes');
        }
        if (mm.dataRetentionDays !== undefined && ![7, 30, 90, 365].includes(mm.dataRetentionDays)) {
            errors.push('Data retention must be 7, 30, 90, or 365 days');
        }
    }

    // Validate security
    if (settings.security) {
        const sec = settings.security;
        if (sec.llmTimeoutSeconds !== undefined && (sec.llmTimeoutSeconds < 5 || sec.llmTimeoutSeconds > 60)) {
            errors.push('LLM timeout must be between 5 and 60 seconds');
        }
        if (sec.totalCallTimeoutSeconds !== undefined && (sec.totalCallTimeoutSeconds < 10 || sec.totalCallTimeoutSeconds > 300)) {
            errors.push('Total call timeout must be between 10 and 300 seconds');
        }
        if (sec.dataResidency && !['us-east', 'us-west', 'eu-west', 'asia-pacific'].includes(sec.dataResidency)) {
            errors.push('Invalid data residency region');
        }
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Validate business logic and provide recommendations
 */
async function validateBusinessLogic(companyId, config) {
    const warnings = [];
    const recommendations = [];

    try {
        // Check if company has trade categories for weight configuration
        const company = await Company.findById(companyId).select('tradeCategories');
        
        if (!company.tradeCategories || company.tradeCategories.length === 0) {
            warnings.push('No trade categories configured - trade category weights will have no effect');
            recommendations.push('Configure trade categories in Company Profile before setting category weights');
        }

        // Validate provider chain doesn't have circular references
        if (config.providerRouter) {
            const { primaryProvider, fallbackChain } = config.providerRouter;
            const providers = [primaryProvider, fallbackChain?.fallback1, fallbackChain?.fallback2].filter(p => p && p !== 'none');
            const uniqueProviders = [...new Set(providers)];
            
            if (providers.length !== uniqueProviders.length) {
                warnings.push('Duplicate providers in fallback chain detected');
                recommendations.push('Use different providers for primary and fallback to ensure redundancy');
            }
        }

        // Check cost control reasonableness
        if (config.costControls) {
            const dailyBudget = config.costControls.dailyLLMBudget;
            const maxTokens = config.costControls.maxTokensPerCall;
            
            if (dailyBudget < 10) {
                warnings.push('Daily budget is very low - may cause frequent service interruptions');
                recommendations.push('Consider setting daily budget to at least $10 for consistent service');
            }
            
            if (maxTokens < 500) {
                warnings.push('Max tokens per call is low - may truncate complex responses');
                recommendations.push('Consider setting max tokens to at least 500 for complete responses');
            }
        }

        // Security recommendations
        if (config.security) {
            const { blockedPatterns, piiDetectionEnabled } = config.security;
            
            if (!blockedPatterns || blockedPatterns.length < 3) {
                recommendations.push('Add more blocked patterns for enhanced security');
            }
            
            if (!piiDetectionEnabled) {
                warnings.push('PII detection is disabled - may pose compliance risks');
                recommendations.push('Enable PII detection for better data protection');
            }
        }

    } catch (error) {
        console.error('Error in business logic validation:', error);
        warnings.push('Could not perform complete validation due to system error');
    }

    return {
        valid: true,
        errors: [],
        warnings,
        recommendations
    };
}

/**
 * Reset daily usage tracking if it's a new day
 */
async function resetDailyUsageIfNeeded(company) {
    try {
        const today = new Date();
        const lastReset = company.enterpriseAIIntelligence?.costControls?.lastResetDate;
        
        if (!lastReset || !isSameDay(today, new Date(lastReset))) {
            await Company.findByIdAndUpdate(
                company._id,
                {
                    $set: {
                        'enterpriseAIIntelligence.costControls.currentDayUsage': 0,
                        'enterpriseAIIntelligence.costControls.lastResetDate': today
                    }
                }
            );
            console.log(`[Enterprise AI] 🔄 Reset daily usage for company: ${company._id}`);
        }
    } catch (error) {
        console.error('Error resetting daily usage:', error);
    }
}

/**
 * Check if two dates are the same day
 */
function isSameDay(date1, date2) {
    return date1.getFullYear() === date2.getFullYear() &&
           date1.getMonth() === date2.getMonth() &&
           date1.getDate() === date2.getDate();
}

module.exports = router;
