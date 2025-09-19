/**
 * Debug Company Configuration Route
 * 
 * Temporary route to check and fix company AI Agent Logic configuration
 * This route can be called from the browser or API client to diagnose
 * and fix missing AI Agent Logic configurations.
 */

const express = require('express');
const router = express.Router();
const Company = require('../models/Company');

const REQUIRED_RESPONSE_CATEGORIES = [
    'greeting-response',
    'no-match-response', 
    'transfer-unavailable-response',
    'final-fallback-response',
    'conversation-fallback-response',
    'technical-difficulty-response',
    'no-input-fallback-response',
    'ai-not-enabled-response'
];

/**
 * Check company AI Agent Logic configuration
 * GET /api/debug/company-config/:companyId
 */
router.get('/company-config/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        console.log(`🔍 Checking AI Agent Logic configuration for company: ${companyId}`);
        
        // Find the company
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                error: `Company not found: ${companyId}`
            });
        }
        
        const companyName = company.businessName || company.companyName;
        console.log(`📋 Company: ${companyName} (ID: ${companyId})`);
        
        // Check AI Agent Logic configuration
        const aiLogic = company.aiAgentLogic || {};
        const enabled = aiLogic.enabled !== false;
        
        // Check thresholds
        const thresholds = aiLogic.thresholds || {};
        const thresholdStatus = {
            companyQnA: thresholds.companyQnA || null,
            tradeQnA: thresholds.tradeQnA || null,
            templates: thresholds.templates || null,
            inHouseFallback: thresholds.inHouseFallback || null
        };
        
        // Check response categories
        const responseCategories = aiLogic.responseCategories?.core || {};
        const responseStatus = {};
        const missingResponses = [];
        
        REQUIRED_RESPONSE_CATEGORIES.forEach(category => {
            const exists = responseCategories[category];
            responseStatus[category] = exists ? 'CONFIGURED' : 'MISSING';
            if (!exists) {
                missingResponses.push(category);
            }
        });
        
        // Check knowledge source priorities
        const priorities = aiLogic.knowledgeSourcePriorities || [];
        
        // Summary
        const hasThresholds = Object.values(thresholdStatus).some(t => t !== null);
        const hasResponses = missingResponses.length === 0;
        const hasPriorities = priorities.length > 0;
        const isFullyConfigured = hasThresholds && hasResponses && hasPriorities;
        
        const result = {
            success: true,
            companyId,
            companyName,
            aiAgentLogic: {
                enabled,
                isFullyConfigured,
                thresholds: {
                    configured: hasThresholds,
                    values: thresholdStatus
                },
                responseCategories: {
                    configured: hasResponses,
                    missing: missingResponses,
                    status: responseStatus
                },
                knowledgeSourcePriorities: {
                    configured: hasPriorities,
                    values: priorities
                }
            },
            recommendations: []
        };
        
        // Add recommendations
        if (!hasThresholds) {
            result.recommendations.push('Configure confidence thresholds in AI Agent Logic tab');
        }
        if (!hasResponses) {
            result.recommendations.push(`Configure ${missingResponses.length} missing response categories`);
        }
        if (!hasPriorities) {
            result.recommendations.push('Configure knowledge source priorities');
        }
        
        if (isFullyConfigured) {
            result.recommendations.push('✅ Company is fully configured!');
        } else {
            result.recommendations.push('❌ Company needs AI Agent Logic configuration');
            result.recommendations.push('💡 Use POST /api/debug/company-config/:companyId to auto-fix');
        }
        
        res.json(result);
        
    } catch (error) {
        console.error('❌ Error checking company configuration:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Fix company AI Agent Logic configuration
 * POST /api/debug/company-config/:companyId
 */
router.post('/company-config/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        console.log(`🔧 Fixing AI Agent Logic configuration for company: ${companyId}`);
        
        // Find the company
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                error: `Company not found: ${companyId}`
            });
        }
        
        const companyName = company.businessName || company.companyName;
        console.log(`📋 Company: ${companyName} (ID: ${companyId})`);
        
        // Check current configuration
        const aiLogic = company.aiAgentLogic || {};
        const thresholds = aiLogic.thresholds || {};
        const responseCategories = aiLogic.responseCategories?.core || {};
        const priorities = aiLogic.knowledgeSourcePriorities || [];
        
        const updates = {};
        const fixedItems = [];
        
        // Fix thresholds if missing
        const hasThresholds = Object.keys(thresholds).length > 0;
        if (!hasThresholds) {
            updates['aiAgentLogic.thresholds'] = {
                companyQnA: 0.8,
                tradeQnA: 0.75,
                templates: 0.7,
                inHouseFallback: 0.5
            };
            fixedItems.push('Added default confidence thresholds');
        }
        
        // Fix missing response categories
        const missingResponses = [];
        REQUIRED_RESPONSE_CATEGORIES.forEach(category => {
            if (!responseCategories[category]) {
                missingResponses.push(category);
            }
        });
        
        if (missingResponses.length > 0) {
            const coreResponses = { ...responseCategories };
            
            missingResponses.forEach(category => {
                switch(category) {
                    case 'greeting-response':
                        coreResponses[category] = `Hello! Thank you for calling ${companyName}. How can I help you today?`;
                        break;
                    case 'no-match-response':
                        coreResponses[category] = `I want to make sure I give you accurate information. Let me connect you with one of our specialists who can help.`;
                        break;
                    case 'transfer-unavailable-response':
                        coreResponses[category] = `I apologize, but I'm unable to transfer your call right now. Please try calling back later or visit our website for assistance.`;
                        break;
                    case 'final-fallback-response':
                        coreResponses[category] = `Thank you for calling ${companyName}. Please visit our website or call back later for assistance.`;
                        break;
                    case 'conversation-fallback-response':
                        coreResponses[category] = `I want to make sure I provide you with accurate information. Let me connect you with a specialist.`;
                        break;
                    case 'technical-difficulty-response':
                        coreResponses[category] = `I'm experiencing some technical difficulties. Please try calling back in a few minutes or visit our website.`;
                        break;
                    case 'no-input-fallback-response':
                        coreResponses[category] = `I didn't hear anything. If you need assistance, please speak clearly or try calling back.`;
                        break;
                    case 'ai-not-enabled-response':
                        coreResponses[category] = `Thank you for calling ${companyName}. Please visit our website or call back later for assistance.`;
                        break;
                }
            });
            
            updates['aiAgentLogic.responseCategories.core'] = coreResponses;
            fixedItems.push(`Added ${missingResponses.length} missing response categories`);
        }
        
        // Fix knowledge source priorities if missing
        if (priorities.length === 0) {
            updates['aiAgentLogic.knowledgeSourcePriorities'] = [
                'companyQnA',
                'tradeQnA', 
                'templates',
                'inHouseFallback'
            ];
            fixedItems.push('Added default knowledge source priorities');
        }
        
        // Enable AI Agent Logic and update timestamp
        updates['aiAgentLogic.enabled'] = true;
        updates['aiAgentLogic.lastUpdated'] = new Date();
        
        if (fixedItems.length > 0) {
            // Apply updates
            await Company.findByIdAndUpdate(companyId, { $set: updates });
            
            console.log(`✅ CONFIGURATION FIXED! Company ${companyId} now has proper AI Agent Logic setup.`);
            
            res.json({
                success: true,
                companyId,
                companyName,
                message: 'AI Agent Logic configuration fixed successfully',
                fixedItems,
                note: 'Admin should review and customize these default responses in the platform'
            });
        } else {
            res.json({
                success: true,
                companyId,
                companyName,
                message: 'No fixes needed - company is already fully configured',
                fixedItems: []
            });
        }
        
    } catch (error) {
        console.error('❌ Error fixing company configuration:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * List all companies with their AI Agent Logic status
 * GET /api/debug/companies-status
 */
router.get('/companies-status', async (req, res) => {
    try {
        console.log('🔍 Checking AI Agent Logic status for all companies');
        
        const companies = await Company.find({}, {
            _id: 1,
            companyName: 1,
            businessName: 1,
            'aiAgentLogic.enabled': 1,
            'aiAgentLogic.thresholds': 1,
            'aiAgentLogic.responseCategories.core': 1,
            'aiAgentLogic.knowledgeSourcePriorities': 1
        });
        
        const results = companies.map(company => {
            const aiLogic = company.aiAgentLogic || {};
            const thresholds = aiLogic.thresholds || {};
            const responseCategories = aiLogic.responseCategories?.core || {};
            const priorities = aiLogic.knowledgeSourcePriorities || [];
            
            const hasThresholds = Object.keys(thresholds).length > 0;
            const missingResponses = REQUIRED_RESPONSE_CATEGORIES.filter(cat => !responseCategories[cat]);
            const hasResponses = missingResponses.length === 0;
            const hasPriorities = priorities.length > 0;
            const isFullyConfigured = hasThresholds && hasResponses && hasPriorities;
            
            return {
                id: company._id,
                name: company.businessName || company.companyName,
                enabled: aiLogic.enabled !== false,
                configured: isFullyConfigured,
                issues: {
                    missingThresholds: !hasThresholds,
                    missingResponses: missingResponses.length,
                    missingPriorities: !hasPriorities
                }
            };
        });
        
        const summary = {
            total: results.length,
            fullyConfigured: results.filter(r => r.configured).length,
            needsConfiguration: results.filter(r => !r.configured).length
        };
        
        res.json({
            success: true,
            summary,
            companies: results
        });
        
    } catch (error) {
        console.error('❌ Error checking companies status:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
