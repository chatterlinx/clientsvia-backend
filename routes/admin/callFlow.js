/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CALL FLOW API ROUTES
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Purpose: Manage dynamic call processing sequence per company
 * 
 * Routes:
 * - GET    /api/admin/call-flow/:companyId              → Get current config
 * - GET    /api/admin/call-flow/:companyId/metrics      → Get REAL production metrics
 * - PUT    /api/admin/call-flow/:companyId              → Update config
 * - POST   /api/admin/call-flow/:companyId/analyze      → Analyze performance
 * - POST   /api/admin/call-flow/:companyId/reset        → Reset to defaults
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();
const { authenticateJWT } = require('../../middleware/auth');
const Company = require('../../models/v2Company');
const LLMCallLog = require('../../models/LLMCallLog');
const defaultCallFlowConfig = require('../../config/defaultCallFlowConfig');
const logger = require('../../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/admin/call-flow/:companyId
// Get current call flow configuration
// ═══════════════════════════════════════════════════════════════════════════
router.get('/:companyId', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        
        logger.info(`📋 [CALL FLOW API] Fetching config for company: ${companyId}`);
        
        const company = await Company.findById(companyId)
            .select('businessName aiAgentSettings.callFlowConfig')
            .lean();
        
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }
        
        // If no config exists, return defaults
        const callFlowConfig = company.aiAgentSettings?.callFlowConfig || defaultCallFlowConfig;
        
        logger.info(`✅ [CALL FLOW API] Config fetched: ${callFlowConfig.length} steps`);
        
        res.json({
            success: true,
            data: {
                companyId,
                companyName: company.businessName,
                callFlowConfig,
                isDefault: !company.aiAgentSettings?.callFlowConfig
            }
        });
        
    } catch (error) {
        logger.error('❌ [CALL FLOW API] GET failed:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch call flow config',
            error: error.message
        });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/admin/call-flow/:companyId/metrics
// Get REAL production metrics (replaces hardcoded estimates)
// ═══════════════════════════════════════════════════════════════════════════
router.get('/:companyId/metrics', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        
        logger.info(`📊 [CALL FLOW METRICS] Fetching real metrics for company: ${companyId}`);
        
        // Load company
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }
        
        // Calculate date range (Last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        // Aggregate REAL metrics from call logs
        const callMetrics = await LLMCallLog.aggregate([
            {
                $match: {
                    companyId: company._id,
                    createdAt: { $gte: thirtyDaysAgo }
                }
            },
            {
                $group: {
                    _id: null,
                    totalCalls: { $sum: 1 },
                    avgTotalTime: { $avg: '$performanceMetrics.totalTime' },
                    avgCost: { $avg: '$costBreakdown.totalCost' },
                    totalCost: { $sum: '$costBreakdown.totalCost' },
                    tier1Calls: {
                        $sum: {
                            $cond: ['$tier1Result.attempted', 1, 0]
                        }
                    },
                    tier2Calls: {
                        $sum: {
                            $cond: ['$tier2Result.attempted', 1, 0]
                        }
                    },
                    tier3Calls: {
                        $sum: {
                            $cond: ['$tier3Result.attempted', 1, 0]
                        }
                    }
                }
            }
        ]);
        
        const hasRealData = callMetrics.length > 0 && callMetrics[0].totalCalls > 0;
        
        if (hasRealData) {
            const metrics = callMetrics[0];
            
            // Real production metrics
            const avgResponseTimeMs = Math.round(metrics.avgTotalTime || 0);
            const avgCostPerCall = (metrics.avgCost || 0).toFixed(4);
            const monthlyEstimate1000Calls = (parseFloat(avgCostPerCall) * 1000).toFixed(2);
            
            logger.info(`✅ [CALL FLOW METRICS] Real metrics calculated`, {
                companyId,
                totalCalls: metrics.totalCalls,
                avgResponseTimeMs,
                avgCostPerCall
            });
            
            res.json({
                success: true,
                hasRealData: true,
                period: 'Last 30 days',
                totalCalls: metrics.totalCalls,
                metrics: {
                    avgResponseTimeMs,
                    avgCostPerCall,
                    monthlyEstimate1000Calls
                },
                tierBreakdown: {
                    tier1: metrics.tier1Calls,
                    tier2: metrics.tier2Calls,
                    tier3: metrics.tier3Calls
                },
                totalCost30Days: metrics.totalCost.toFixed(2)
            });
            
        } else {
            // No real data yet - return estimates with clear warning
            logger.warn(`⚠️ [CALL FLOW METRICS] No real data found, returning estimates`, {
                companyId
            });
            
            const callFlowConfig = company.aiAgentSettings?.callFlowConfig || defaultCallFlowConfig;
            const estimates = calculatePerformanceEstimate(callFlowConfig);
            
            res.json({
                success: true,
                hasRealData: false,
                period: 'Estimates (No calls yet)',
                totalCalls: 0,
                metrics: {
                    avgResponseTimeMs: estimates.avgResponseTimeMs,
                    avgCostPerCall: estimates.avgCostPerCall,
                    monthlyEstimate1000Calls: estimates.monthlyEstimate1000Calls
                },
                tierBreakdown: {
                    tier1: 0,
                    tier2: 0,
                    tier3: 0
                },
                totalCost30Days: '0.00',
                warning: 'These are estimated values. Real metrics will appear after processing calls.'
            });
        }
        
    } catch (error) {
        logger.error('❌ [CALL FLOW METRICS] Failed to fetch metrics:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch call flow metrics',
            error: error.message
        });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// PUT /api/admin/call-flow/:companyId
// Update call flow configuration (reorder, enable/disable steps)
// ═══════════════════════════════════════════════════════════════════════════
router.put('/:companyId', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { callFlowConfig } = req.body;
        
        if (!callFlowConfig || !Array.isArray(callFlowConfig)) {
            return res.status(400).json({
                success: false,
                message: 'callFlowConfig must be an array'
            });
        }
        
        logger.info(`💾 [CALL FLOW API] Updating config for company: ${companyId}`);
        logger.info(`📊 [CALL FLOW API] New config: ${callFlowConfig.length} steps`);
        
        // Validate configuration
        const validation = validateCallFlowConfig(callFlowConfig);
        if (!validation.valid) {
            logger.warn(`⚠️ [CALL FLOW API] Validation failed:`, validation.errors);
            return res.status(400).json({
                success: false,
                message: 'Invalid call flow configuration',
                errors: validation.errors,
                warnings: validation.warnings
            });
        }
        
        // Update company
        const company = await Company.findByIdAndUpdate(
            companyId,
            {
                $set: {
                    'aiAgentSettings.callFlowConfig': callFlowConfig
                }
            },
            { new: true, runValidators: true }
        ).select('businessName aiAgentSettings.callFlowConfig');
        
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }
        
        logger.info(`✅ [CALL FLOW API] Config updated successfully`);
        
        // Calculate performance estimate
        const performanceEstimate = calculatePerformanceEstimate(callFlowConfig);
        
        res.json({
            success: true,
            message: 'Call flow configuration updated successfully',
            data: {
                companyId,
                companyName: company.businessName,
                callFlowConfig: company.aiAgentSettings.callFlowConfig,
                performanceEstimate,
                warnings: validation.warnings
            }
        });
        
    } catch (error) {
        logger.error('❌ [CALL FLOW API] PUT failed:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update call flow config',
            error: error.message
        });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/admin/call-flow/:companyId/analyze
// Analyze current call flow performance and suggest optimizations
// ═══════════════════════════════════════════════════════════════════════════
router.post('/:companyId/analyze', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        
        logger.info(`📊 [CALL FLOW API] Analyzing performance for company: ${companyId}`);
        
        const company = await Company.findById(companyId)
            .select('businessName aiAgentSettings')
            .lean();
        
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }
        
        const callFlowConfig = company.aiAgentSettings?.callFlowConfig || defaultCallFlowConfig;
        
        // Analyze configuration
        const analysis = analyzeCallFlow(callFlowConfig, company);
        
        logger.info(`✅ [CALL FLOW API] Analysis complete`);
        
        res.json({
            success: true,
            data: {
                companyId,
                companyName: company.businessName,
                analysis
            }
        });
        
    } catch (error) {
        logger.error('❌ [CALL FLOW API] ANALYZE failed:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to analyze call flow',
            error: error.message
        });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/admin/call-flow/:companyId/reset
// Reset call flow to default configuration
// ═══════════════════════════════════════════════════════════════════════════
router.post('/:companyId/reset', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        
        logger.info(`🔄 [CALL FLOW API] Resetting config to defaults for company: ${companyId}`);
        
        const company = await Company.findByIdAndUpdate(
            companyId,
            {
                $set: {
                    'aiAgentSettings.callFlowConfig': defaultCallFlowConfig
                }
            },
            { new: true }
        ).select('businessName aiAgentSettings.callFlowConfig');
        
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }
        
        logger.info(`✅ [CALL FLOW API] Config reset to defaults`);
        
        res.json({
            success: true,
            message: 'Call flow configuration reset to defaults',
            data: {
                companyId,
                companyName: company.businessName,
                callFlowConfig: company.aiAgentSettings.callFlowConfig
            }
        });
        
    } catch (error) {
        logger.error('❌ [CALL FLOW API] RESET failed:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to reset call flow config',
            error: error.message
        });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate call flow configuration
 */
function validateCallFlowConfig(config) {
    const errors = [];
    const warnings = [];
    
    // Check required steps are present
    const requiredSteps = ['spamFilter', 'frontlineIntel', 'scenarioMatching'];
    const presentSteps = new Set(config.map(s => s.id));
    
    for (const required of requiredSteps) {
        if (!presentSteps.has(required)) {
            errors.push(`Missing required step: ${required}`);
        }
    }
    
    // Check spamFilter is first and locked
    if (config[0]?.id !== 'spamFilter' || !config[0]?.locked) {
        errors.push('spamFilter must be first step and locked');
    }
    
    // Check for duplicate steps
    const stepIds = config.map(s => s.id);
    const duplicates = stepIds.filter((id, index) => stepIds.indexOf(id) !== index);
    if (duplicates.length > 0) {
        errors.push(`Duplicate steps found: ${duplicates.join(', ')}`);
    }
    
    // Check dependencies
    const frontlineIntelEnabled = config.find(s => s.id === 'frontlineIntel')?.enabled;
    const contextInjectionEnabled = config.find(s => s.id === 'contextInjection')?.enabled;
    
    if (contextInjectionEnabled && !frontlineIntelEnabled) {
        warnings.push('contextInjection requires frontlineIntel to be enabled');
    }
    
    // Check if Frontline-Intel is disabled
    if (!frontlineIntelEnabled) {
        warnings.push('⚠️ Frontline-Intel is disabled. Call intelligence will be limited.');
    }
    
    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

/**
 * Calculate performance estimate based on configuration
 */
function calculatePerformanceEstimate(config) {
    const estimates = {
        spamFilter: { timeMs: 2, cost: 0 },
        edgeCases: { timeMs: 10, cost: 0 },
        transferRules: { timeMs: 15, cost: 0 },
        frontlineIntel: { timeMs: 800, cost: 0.003 },
        scenarioMatching: { timeMs: 12, cost: 0 },  // Tier 1 average
        guardrails: { timeMs: 8, cost: 0 },
        behaviorPolish: { timeMs: 3, cost: 0 },
        contextInjection: { timeMs: 2, cost: 0 }
    };
    
    let totalTimeMs = 0;
    let totalCost = 0;
    
    for (const step of config) {
        if (step.enabled && estimates[step.id]) {
            totalTimeMs += estimates[step.id].timeMs;
            totalCost += estimates[step.id].cost;
        }
    }
    
    return {
        avgResponseTimeMs: totalTimeMs,
        avgCostPerCall: totalCost.toFixed(4),
        monthlyEstimate1000Calls: (totalCost * 1000).toFixed(2),
        breakdown: config
            .filter(s => s.enabled)
            .map(s => ({
                step: s.id,
                timeMs: estimates[s.id]?.timeMs || 0,
                cost: estimates[s.id]?.cost || 0
            }))
    };
}

/**
 * Analyze call flow for performance insights
 */
function analyzeCallFlow(config, company) {
    const frontlineIntelStep = config.find(s => s.id === 'frontlineIntel');
    const scenarioMatchingStep = config.find(s => s.id === 'scenarioMatching');
    
    const analysis = {
        currentConfig: config.map(s => ({
            id: s.id,
            enabled: s.enabled,
            locked: s.locked
        })),
        insights: [],
        recommendations: [],
        performanceEstimate: calculatePerformanceEstimate(config)
    };
    
    // Insight: Frontline-Intel status
    if (frontlineIntelStep?.enabled) {
        analysis.insights.push({
            type: 'info',
            message: 'Frontline-Intel is enabled (Phase 1 - Quality First)',
            impact: '✅ Maximum call intelligence, ~850ms average response'
        });
    } else {
        analysis.insights.push({
            type: 'warning',
            message: 'Frontline-Intel is disabled',
            impact: '⚠️ Limited call intelligence, may miss returning customers'
        });
        
        analysis.recommendations.push({
            action: 'Enable Frontline-Intel',
            reason: 'Provides intent extraction, customer lookup, and validation',
            tradeoff: '+800ms latency, +$0.003 cost, but significantly better quality'
        });
    }
    
    // Insight: Fast-path optimization
    const fastPathConfig = frontlineIntelStep?.params?.fastPath;
    if (fastPathConfig?.enabled) {
        analysis.insights.push({
            type: 'success',
            message: 'Fast-path optimization is enabled (Phase 2)',
            impact: '🚀 10% of calls bypass Frontline-Intel, ~62ms response'
        });
    } else {
        // Check if company is eligible for fast-path
        const totalCalls = 0;  // TODO: Get from database
        if (totalCalls >= 1000) {
            analysis.recommendations.push({
                action: 'Consider enabling fast-path optimization',
                reason: `You have ${totalCalls} calls. Simple patterns can now bypass Frontline-Intel.`,
                tradeoff: 'Requires testing and pattern configuration'
            });
        }
    }
    
    return analysis;
}

module.exports = router;

