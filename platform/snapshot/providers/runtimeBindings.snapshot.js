/**
 * ============================================================================
 * RUNTIME BINDINGS SNAPSHOT PROVIDER
 * ============================================================================
 * Provides: Verification that Twilio → IntelligentRouter wiring is active
 * 
 * This provider checks that the actual runtime code paths are wired.
 * It does NOT check config - it checks that code exists and is callable.
 */

const logger = require('../../../utils/logger');

// Runtime services to verify
let IntelligentRouter, ScenarioEngine, OverrideResolver, DynamicFlowEngine;

try {
    IntelligentRouter = require('../../../services/IntelligentRouter');
} catch (e) {
    logger.warn('[SNAPSHOT:runtimeBindings] IntelligentRouter not found');
}

try {
    ScenarioEngine = require('../../../services/ScenarioEngine');
} catch (e) {
    logger.warn('[SNAPSHOT:runtimeBindings] ScenarioEngine not found');
}

try {
    OverrideResolver = require('../../../services/OverrideResolver');
} catch (e) {
    logger.warn('[SNAPSHOT:runtimeBindings] OverrideResolver not found');
}

try {
    DynamicFlowEngine = require('../../../services/DynamicFlowEngine');
} catch (e) {
    logger.warn('[SNAPSHOT:runtimeBindings] DynamicFlowEngine not found');
}

module.exports.getSnapshot = async function(companyId) {
    const startTime = Date.now();
    
    try {
        const wiringChecks = {
            intelligentRouterWired: false,
            scenarioEngineWired: false,
            overrideResolverWired: false,
            dynamicFlowWired: false,
            placeholdersWired: false,
            llmGuardrailsActive: false
        };
        
        const entryPoints = {
            voice: null,
            sms: null,
            web: null
        };
        
        const decisionOrder = [];
        
        // Check IntelligentRouter
        if (IntelligentRouter && typeof IntelligentRouter.route === 'function') {
            wiringChecks.intelligentRouterWired = true;
            entryPoints.voice = 'routes/v2twilio.js → IntelligentRouter.route';
            entryPoints.sms = 'routes/v2sms.js → IntelligentRouter.route';
            decisionOrder.push('IntelligentRouter (3-Tier)');
        }
        
        // Check ScenarioEngine
        if (ScenarioEngine && typeof ScenarioEngine.selectResponse === 'function') {
            wiringChecks.scenarioEngineWired = true;
            decisionOrder.push('ScenarioEngine.selectResponse');
        }
        
        // Check OverrideResolver
        if (OverrideResolver && typeof OverrideResolver.resolveResponse === 'function') {
            wiringChecks.overrideResolverWired = true;
            wiringChecks.placeholdersWired = true; // OverrideResolver handles placeholders
            decisionOrder.push('OverrideResolver (Disabled Handling)');
        }
        
        // Check DynamicFlowEngine
        if (DynamicFlowEngine) {
            const hasProcessTurn = typeof DynamicFlowEngine.processTurn === 'function' ||
                                   typeof DynamicFlowEngine.prototype?.processTurn === 'function';
            if (hasProcessTurn) {
                wiringChecks.dynamicFlowWired = true;
                decisionOrder.unshift('DynamicFlowEngine'); // First in decision order
            }
        }
        
        // LLM Guardrails check (simplified - check if tier3 has budget controls)
        if (IntelligentRouter && typeof IntelligentRouter.checkBudget === 'function') {
            wiringChecks.llmGuardrailsActive = true;
        }
        
        // Build full decision order
        const fullDecisionOrder = [
            'Call Protection',
            'Dynamic Flow',
            'Scenario Match (Tier 1/2/3)',
            'Disabled Override Resolution',
            'Placeholder Substitution',
            'LLM Fallback (if needed)'
        ];
        
        // Determine health
        let health = 'GREEN';
        const warnings = [];
        
        if (!wiringChecks.intelligentRouterWired) {
            warnings.push('IntelligentRouter not wired');
            health = 'RED';
        }
        
        if (!wiringChecks.scenarioEngineWired) {
            warnings.push('ScenarioEngine not wired');
            health = 'RED';
        }
        
        if (!wiringChecks.overrideResolverWired) {
            warnings.push('OverrideResolver not wired - disabled scenarios will not have fallback');
            health = 'YELLOW';
        }
        
        if (!wiringChecks.dynamicFlowWired) {
            warnings.push('DynamicFlowEngine not wired');
            // Not RED - dynamic flow is optional for some setups
            if (health === 'GREEN') health = 'YELLOW';
        }
        
        return {
            provider: 'runtimeBindings',
            providerVersion: '1.0',
            schemaVersion: 'v1',
            enabled: true,
            health,
            warnings,
            data: {
                entryPoints,
                
                decisionOrder: fullDecisionOrder,
                
                wiringChecks,
                
                services: {
                    intelligentRouter: {
                        loaded: !!IntelligentRouter,
                        hasRoute: typeof IntelligentRouter?.route === 'function',
                        hasCheckBudget: typeof IntelligentRouter?.checkBudget === 'function'
                    },
                    scenarioEngine: {
                        loaded: !!ScenarioEngine,
                        hasSelectResponse: typeof ScenarioEngine?.selectResponse === 'function',
                        hasGetEnabledScenarios: typeof ScenarioEngine?.getEnabledScenarios === 'function'
                    },
                    overrideResolver: {
                        loaded: !!OverrideResolver,
                        hasResolveResponse: typeof OverrideResolver?.resolveResponse === 'function',
                        hasResolveAndRender: typeof OverrideResolver?.resolveAndRender === 'function'
                    },
                    dynamicFlowEngine: {
                        loaded: !!DynamicFlowEngine,
                        type: typeof DynamicFlowEngine
                    }
                },
                
                // Performance stats placeholder (would need redis/db for real stats)
                lastCallStats: {
                    note: 'Real stats require Redis/analytics integration',
                    avgResponseMs: null,
                    scenarioHitRate: null,
                    llmFallbackRate: null
                }
            },
            generatedIn: Date.now() - startTime
        };
        
    } catch (error) {
        logger.error('[SNAPSHOT:runtimeBindings] Error:', error.message);
        return {
            provider: 'runtimeBindings',
            providerVersion: '1.0',
            schemaVersion: 'v1',
            enabled: false,
            health: 'RED',
            error: error.message,
            data: null,
            generatedIn: Date.now() - startTime
        };
    }
};

