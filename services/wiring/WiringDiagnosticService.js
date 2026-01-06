/**
 * ============================================================================
 * WIRING DIAGNOSTIC SERVICE - Links Test Results to Configuration Issues
 * ============================================================================
 * 
 * This service provides quick wiring diagnostics that explain WHY a test
 * might have failed. Used by Test Agent to show configuration issues.
 * 
 * ============================================================================
 */

const Company = require('../../models/v2Company');
const logger = require('../../utils/logger');

/**
 * Get quick wiring diagnostics for a company
 * Returns issues that might affect scenario matching
 * 
 * @param {string} companyId - The company ID
 * @returns {Promise<Object>} Diagnostic summary with issues and links
 */
async function getQuickDiagnostics(companyId) {
    const startTime = Date.now();
    const diagnostics = {
        companyId,
        timestamp: new Date().toISOString(),
        healthy: true,
        issues: [],
        warnings: [],
        stats: {},
        links: {} // Deep links to Wiring Tab sections
    };
    
    try {
        // Load company doc
        const companyDoc = await Company.findById(companyId)
            .select('aiAgentSettings companyName businessName')
            .lean();
        
        if (!companyDoc) {
            diagnostics.healthy = false;
            diagnostics.issues.push({
                id: 'COMPANY_NOT_FOUND',
                severity: 'CRITICAL',
                title: 'Company Not Found',
                message: `Company ${companyId} does not exist in database`,
                fix: 'Check if companyId is correct',
                wiringLink: null
            });
            return diagnostics;
        }
        
        const settings = companyDoc.aiAgentSettings || {};
        const frontDesk = settings.frontDeskBehavior || {};
        const discoveryConsent = frontDesk.discoveryConsent || {};
        
        // =====================================================================
        // CHECK 1: Kill Switches
        // =====================================================================
        const forceLLM = discoveryConsent.forceLLMDiscovery === true;
        const disableScenarios = discoveryConsent.disableScenarioAutoResponses === true;
        
        diagnostics.stats.killSwitches = {
            forceLLMDiscovery: forceLLM,
            disableScenarioAutoResponses: disableScenarios,
            scenariosBlocked: forceLLM || disableScenarios
        };
        
        if (forceLLM) {
            diagnostics.healthy = false;
            diagnostics.issues.push({
                id: 'KILL_SWITCH_FORCE_LLM',
                severity: 'CRITICAL',
                title: 'Kill Switch: Force LLM Discovery ON',
                message: 'Scenarios cannot auto-respond. LLM leads all conversations.',
                fix: 'Go to Front Desk → Discovery & Consent → Turn OFF "Force LLM Discovery"',
                wiringLink: 'killSwitches',
                fieldId: 'frontDesk.discoveryConsent.forceLLMDiscovery'
            });
        }
        
        if (disableScenarios) {
            diagnostics.healthy = false;
            diagnostics.issues.push({
                id: 'KILL_SWITCH_DISABLE_SCENARIOS',
                severity: 'CRITICAL',
                title: 'Kill Switch: Scenario Auto-Responses DISABLED',
                message: 'Scenarios are matched but cannot respond automatically.',
                fix: 'Go to Front Desk → Discovery & Consent → Turn OFF "Disable Scenario Auto-Responses"',
                wiringLink: 'killSwitches',
                fieldId: 'frontDesk.discoveryConsent.disableScenarioAutoResponses'
            });
        }
        
        // =====================================================================
        // CHECK 2: Template References
        // =====================================================================
        const templateRefs = settings.templateReferences || [];
        const enabledRefs = templateRefs.filter(r => r?.enabled !== false);
        
        diagnostics.stats.templates = {
            total: templateRefs.length,
            enabled: enabledRefs.length,
            hasTemplates: enabledRefs.length > 0
        };
        
        if (enabledRefs.length === 0) {
            diagnostics.healthy = false;
            diagnostics.issues.push({
                id: 'NO_TEMPLATES_LINKED',
                severity: 'CRITICAL',
                title: 'No Templates Linked',
                message: 'Company has no scenario templates linked. Scenario pool will be empty.',
                fix: 'Go to Data & Config → Template References → Link a template',
                wiringLink: 'gapAnalysis',
                fieldId: 'dataConfig.templateReferences'
            });
        }
        
        // =====================================================================
        // CHECK 3: Scenario Pool (if templates are linked)
        // =====================================================================
        if (enabledRefs.length > 0) {
            try {
                const ScenarioPoolService = require('../ScenarioPoolService');
                const pool = await ScenarioPoolService.getScenarioPoolForCompany(companyId);
                
                diagnostics.stats.scenarios = {
                    count: pool.scenarios?.length || 0,
                    hasScenarios: (pool.scenarios?.length || 0) > 0
                };
                
                if ((pool.scenarios?.length || 0) === 0) {
                    diagnostics.healthy = false;
                    diagnostics.issues.push({
                        id: 'EMPTY_SCENARIO_POOL',
                        severity: 'HIGH',
                        title: 'Scenario Pool Empty',
                        message: 'Templates are linked but contain 0 scenarios.',
                        fix: 'Add scenarios to the linked template, or link a different template',
                        wiringLink: 'gapAnalysis',
                        fieldId: 'dataConfig.scenarios'
                    });
                }
            } catch (e) {
                diagnostics.warnings.push({
                    id: 'SCENARIO_POOL_ERROR',
                    title: 'Could not check scenario pool',
                    message: e.message
                });
            }
        }
        
        // =====================================================================
        // CHECK 4: Booking Slots (if booking might be involved)
        // =====================================================================
        const bookingSlots = settings.bookingSlots || frontDesk.bookingSlots || [];
        const validSlots = bookingSlots.filter(s => s.question && s.question.trim().length > 0);
        const invalidSlots = bookingSlots.length - validSlots.length;
        
        diagnostics.stats.bookingSlots = {
            total: bookingSlots.length,
            valid: validSlots.length,
            invalid: invalidSlots
        };
        
        if (invalidSlots > 0) {
            diagnostics.warnings.push({
                id: 'INVALID_BOOKING_SLOTS',
                severity: 'MEDIUM',
                title: `${invalidSlots} Booking Slots Missing Question`,
                message: 'Some booking slots are missing the required "question" field and will be rejected at runtime.',
                fix: 'Go to Front Desk → Booking Prompts → Add questions to all slots',
                wiringLink: 'actionQueue',
                fieldId: 'frontDesk.bookingSlots'
            });
        }
        
        // =====================================================================
        // CHECK 5: Redis Cache Status
        // =====================================================================
        try {
            const { getSharedRedisClient, isRedisConfigured } = require('../redisClientFactory');
            if (isRedisConfigured()) {
                const redis = await getSharedRedisClient();
                if (redis) {
                    const cacheKey = `scenario-pool:${companyId}`;
                    const exists = await redis.exists(cacheKey);
                    diagnostics.stats.redis = {
                        configured: true,
                        scenarioPoolCached: exists === 1
                    };
                    
                    if (!exists) {
                        diagnostics.warnings.push({
                            id: 'REDIS_CACHE_MISS',
                            title: 'Scenario Pool Not Cached',
                            message: 'First call may be slower as scenarios load from MongoDB.',
                            fix: 'This is normal - cache will populate on first call',
                            wiringLink: null
                        });
                    }
                }
            }
        } catch (e) {
            diagnostics.stats.redis = { error: e.message };
        }
        
        // =====================================================================
        // BUILD WIRING TAB LINKS
        // =====================================================================
        diagnostics.links = {
            wiringTab: `/control-plane-v2.html?companyId=${companyId}&tab=wiring`,
            killSwitches: `/control-plane-v2.html?companyId=${companyId}&tab=wiring&section=killSwitches`,
            gapAnalysis: `/control-plane-v2.html?companyId=${companyId}&tab=wiring&section=gapAnalysis`,
            actionQueue: `/control-plane-v2.html?companyId=${companyId}&tab=wiring&section=actionQueue`
        };
        
        diagnostics.generationTimeMs = Date.now() - startTime;
        
        return diagnostics;
        
    } catch (error) {
        logger.error('[WIRING DIAGNOSTIC] Error generating diagnostics', { 
            companyId, 
            error: error.message 
        });
        
        diagnostics.healthy = false;
        diagnostics.issues.push({
            id: 'DIAGNOSTIC_ERROR',
            severity: 'HIGH',
            title: 'Diagnostic Error',
            message: error.message,
            fix: 'Check server logs for details'
        });
        
        return diagnostics;
    }
}

/**
 * Analyze a test result and return wiring-related explanations
 * 
 * @param {Object} testResult - The test result from test-respond endpoint
 * @param {string} companyId - The company ID
 * @returns {Promise<Object>} Analysis with wiring explanations
 */
async function analyzeTestFailure(testResult, companyId) {
    const analysis = {
        testPassed: testResult.matched && testResult.confidence >= (testResult.threshold || 0.45),
        possibleWiringCauses: [],
        recommendations: []
    };
    
    // Get wiring diagnostics
    const diagnostics = await getQuickDiagnostics(companyId);
    
    // If test failed and there are wiring issues, they might be related
    if (!analysis.testPassed) {
        // Add relevant wiring issues as possible causes
        for (const issue of diagnostics.issues) {
            if (issue.severity === 'CRITICAL') {
                analysis.possibleWiringCauses.push({
                    cause: issue.title,
                    explanation: issue.message,
                    fix: issue.fix,
                    wiringLink: diagnostics.links[issue.wiringLink] || diagnostics.links.wiringTab,
                    likelihood: issue.id.includes('KILL_SWITCH') ? 'HIGH' : 
                               issue.id.includes('TEMPLATE') ? 'HIGH' : 'MEDIUM'
                });
            }
        }
        
        // Add scenario-specific checks
        if (!testResult.matched) {
            if (diagnostics.stats.scenarios?.count === 0) {
                analysis.possibleWiringCauses.push({
                    cause: 'No Scenarios Available',
                    explanation: 'The scenario pool is empty - there are no scenarios to match against.',
                    fix: 'Link a template with scenarios in Data & Config',
                    wiringLink: diagnostics.links.gapAnalysis,
                    likelihood: 'VERY_HIGH'
                });
            } else if (diagnostics.stats.killSwitches?.scenariosBlocked) {
                analysis.possibleWiringCauses.push({
                    cause: 'Scenarios Blocked by Kill Switch',
                    explanation: 'Scenarios exist but are blocked from auto-responding due to kill switch settings.',
                    fix: 'Disable kill switches in Front Desk → Discovery & Consent',
                    wiringLink: diagnostics.links.killSwitches,
                    likelihood: 'VERY_HIGH'
                });
            }
        }
        
        // Build recommendations
        if (analysis.possibleWiringCauses.length > 0) {
            analysis.recommendations.push({
                action: 'Check Wiring Tab',
                description: 'Review the Wiring Tab for configuration issues that might be blocking scenarios.',
                link: diagnostics.links.wiringTab
            });
        }
        
        // If no wiring issues, the problem is likely the scenario content itself
        if (analysis.possibleWiringCauses.length === 0) {
            analysis.recommendations.push({
                action: 'Review Scenario Triggers',
                description: 'Wiring looks healthy. The test phrase might not match any scenario triggers. Consider adding more triggers or fillers.',
                link: null
            });
        }
    }
    
    analysis.wiringDiagnostics = diagnostics;
    
    return analysis;
}

module.exports = {
    getQuickDiagnostics,
    analyzeTestFailure
};

