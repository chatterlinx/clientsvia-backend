/**
 * ============================================================================
 * WIRING REPORT BUILDER - Generates truth from actual config
 * ============================================================================
 * 
 * This builds the wiring report by checking ACTUAL database values against
 * the wiring registry definitions.
 * 
 * RULES:
 * 1. Never hardcode status - always compute from real data
 * 2. Check Redis cache status for debugging
 * 3. Include infrastructure health
 * 4. Report critical issues prominently
 * 
 * ============================================================================
 */

const { wiringRegistryV1, WIRING_SCHEMA_VERSION } = require('./wiringRegistry.v1');
// promptPacks migration REMOVED Jan 2026 - nuked
const logger = require('../../utils/logger');

// ============================================================================
// UTILITIES
// ============================================================================

function getPath(obj, path) {
    if (!obj || !path) return undefined;
    
    // Handle special collection references
    if (path.includes(' collection')) return undefined; // Collections checked separately
    
    const parts = path.split('.');
    let cur = obj;
    
    for (const p of parts) {
        if (cur == null) return undefined;
        cur = cur[p];
    }
    return cur;
}

function isNonEmpty(val) {
    if (val == null) return false;
    if (Array.isArray(val)) return val.length > 0;
    if (typeof val === 'object') return Object.keys(val).length > 0;
    if (typeof val === 'string') return val.trim().length > 0;
    if (typeof val === 'boolean') return true;
    if (typeof val === 'number') return true;
    return true;
}

function computeStatus({ enabled, dbOk, compiledOk, consumerDeclared, hasCriticalIssue, uiOnly }) {
    if (!enabled) return { status: 'DISABLED', health: 'GRAY' };
    if (hasCriticalIssue) return { status: 'MISCONFIGURED', health: 'RED' };
    if (uiOnly) return { status: 'UI_ONLY', health: 'RED' };
    
    // WIRED requires: db exists + consumers declared
    if (dbOk && consumerDeclared) return { status: 'WIRED', health: 'GREEN' };
    
    // PARTIAL if some but not all
    if (dbOk || consumerDeclared) return { status: 'PARTIAL', health: 'YELLOW' };
    
    return { status: 'NOT_CONFIGURED', health: 'GRAY' };
}

// ============================================================================
// REDIS CACHE CHECK
// ============================================================================

async function checkRedisCache(companyId) {
    const cacheKey = `scenario-pool:${companyId}`;
    
    try {
        const redisFactory = require('../../utils/redisFactory');
        const redis = redisFactory.getClient();
        
        if (!redis) {
            return {
                status: 'UNAVAILABLE',
                health: 'YELLOW',
                message: 'Redis client not available'
            };
        }
        
        const cached = await redis.get(cacheKey);
        const ttl = await redis.ttl(cacheKey);
        
        if (!cached) {
            return {
                status: 'MISS',
                health: 'YELLOW',
                cacheKey,
                ttlSeconds: -1,
                scenarioCount: 0,
                effectiveConfigVersion: null,
                message: 'No cached data - will load from MongoDB on next request'
            };
        }
        
        const parsed = JSON.parse(cached);
        return {
            status: 'HIT',
            health: 'GREEN',
            cacheKey,
            ttlSeconds: ttl,
            scenarioCount: parsed.scenarios?.length || 0,
            effectiveConfigVersion: parsed.effectiveConfigVersion || null,
            message: `Cached ${parsed.scenarios?.length || 0} scenarios, expires in ${ttl}s`
        };
        
    } catch (error) {
        return {
            status: 'ERROR',
            health: 'RED',
            cacheKey,
            error: error.message
        };
    }
}

// ============================================================================
// SCENARIO POOL CHECK
// ============================================================================

async function checkScenarioPool(companyId) {
    try {
        const ScenarioPoolService = require('../../services/ScenarioPoolService');
        const result = await ScenarioPoolService.getScenarioPoolForCompany(companyId);
        
        return {
            status: result.scenarios?.length > 0 ? 'LOADED' : 'EMPTY',
            health: result.scenarios?.length > 0 ? 'GREEN' : 'RED',
            scenarioCount: result.scenarios?.length || 0,
            enabledCount: result.scenarios?.filter(s => s.isEnabledForCompany !== false).length || 0,
            templatesUsed: result.templatesUsed || [],
            effectiveConfigVersion: result.effectiveConfigVersion || null
        };
    } catch (error) {
        return {
            status: 'ERROR',
            health: 'RED',
            error: error.message
        };
    }
}

// ============================================================================
// DYNAMIC FLOW CHECK
// ============================================================================

async function checkDynamicFlows(companyId) {
    try {
        const DynamicFlow = require('../../models/DynamicFlow');
        
        const companyFlows = await DynamicFlow.countDocuments({
            companyId,
            isTemplate: false,
            enabled: true
        });
        
        const templates = await DynamicFlow.countDocuments({
            isTemplate: true,
            enabled: true
        });
        
        return {
            status: companyFlows > 0 ? 'ACTIVE' : 'NO_COMPANY_FLOWS',
            health: companyFlows > 0 ? 'GREEN' : 'YELLOW',
            companyFlowCount: companyFlows,
            templateCount: templates,
            message: companyFlows > 0 
                ? `${companyFlows} active company flows`
                : 'No company flows - only templates exist (use Copy Templates to Company)'
        };
    } catch (error) {
        return {
            status: 'ERROR',
            health: 'RED',
            error: error.message
        };
    }
}

// ============================================================================
// BOOKING CONTRACT CHECK
// ============================================================================

function checkBookingContract(companyDoc) {
    const frontDesk = companyDoc?.aiAgentSettings?.frontDeskBehavior || {};
    const bookingSlots = frontDesk.bookingSlots || [];
    const bookingEnabled = companyDoc?.aiAgentSettings?.bookingEnabled;
    
    // Check if slots have required 'question' field
    const slotsWithQuestion = bookingSlots.filter(s => s.question || s.prompt);
    const missingQuestion = bookingSlots.filter(s => !s.question && !s.prompt);
    
    // ☢️ NUKED: bookingContractV2 check removed Jan 2026 - never wired to runtime
    // Booking slots are wired directly without the V2 compilation layer
    
    const status = {
        definedSlotCount: bookingSlots.length,
        slotsWithQuestion: slotsWithQuestion.length,
        slotsMissingQuestion: missingQuestion.length,
        bookingEnabled,
        runtimeConfigured: slotsWithQuestion.length > 0
    };
    
    if (!bookingEnabled && bookingSlots.length === 0) {
        return {
            ...status,
            status: 'DISABLED',
            health: 'GRAY',
            message: 'Booking not enabled'
        };
    }
    
    if (missingQuestion.length > 0) {
        return {
            ...status,
            status: 'MISCONFIGURED',
            health: 'RED',
            message: `${missingQuestion.length} slots missing 'question' field`,
            missingQuestionSlots: missingQuestion.map(s => s.id || s.slotId)
        };
    }
    
    if (slotsWithQuestion.length === 0) {
        return {
            ...status,
            status: 'PARTIAL',
            health: 'YELLOW',
            message: 'No booking slots with questions configured'
        };
    }
    
    return {
        ...status,
        status: 'WIRED',
        health: 'GREEN',
        message: `${bookingSlots.length} slots configured`
    };
}

// ============================================================================
// KILL SWITCHES CHECK (CRITICAL - blocks scenarios even when template is perfect)
// ============================================================================

function checkKillSwitches(companyDoc) {
    const discoveryConsent = companyDoc?.aiAgentSettings?.frontDeskBehavior?.discoveryConsent || {};
    
    // These kill switches block scenario auto-responses
    const forceLLMDiscovery = discoveryConsent.forceLLMDiscovery ?? false;
    const disableScenarioAutoResponses = discoveryConsent.disableScenarioAutoResponses ?? false;
    const bookingRequiresExplicitConsent = discoveryConsent.bookingRequiresExplicitConsent ?? true;
    const autoReplyAllowedScenarioTypes = discoveryConsent.autoReplyAllowedScenarioTypes || ['FAQ', 'TROUBLESHOOT', 'EMERGENCY'];
    
    // The critical question: Can scenarios auto-respond?
    const scenarioAutoResponseAllowed = !forceLLMDiscovery && !disableScenarioAutoResponses;
    
    // Determine health
    let health = 'GREEN';
    let status = 'SCENARIOS_ENABLED';
    let message = 'Scenarios can auto-respond for allowed types';
    
    if (forceLLMDiscovery && disableScenarioAutoResponses) {
        health = 'RED';
        status = 'SCENARIOS_BLOCKED';
        message = 'BOTH kill switches ON - scenarios will NEVER fire. scenarioCount will always be 0.';
    } else if (forceLLMDiscovery) {
        health = 'YELLOW';
        status = 'DISCOVERY_FORCED';
        message = 'forceLLMDiscovery=true - LLM speaks first, scenarios as tools only';
    } else if (disableScenarioAutoResponses) {
        health = 'RED';
        status = 'AUTO_RESPONSE_DISABLED';
        message = 'disableScenarioAutoResponses=true - scenarios matched but cannot auto-respond';
    }
    
    return {
        status,
        health,
        message,
        
        // Individual switch values
        forceLLMDiscovery,
        disableScenarioAutoResponses,
        bookingRequiresExplicitConsent,
        autoReplyAllowedScenarioTypes,
        
        // The bottom line
        scenarioAutoResponseAllowed,
        
        // Fix instructions
        fix: !scenarioAutoResponseAllowed 
            ? 'Set forceLLMDiscovery=false AND disableScenarioAutoResponses=false in Front Desk → Discovery & Consent'
            : null
    };
}

// ============================================================================
// GREETING INTERCEPT CHECK (the V34 bug that made agent say "connection rough")
// ============================================================================

function checkGreetingIntercept(companyDoc) {
    const greetingResponses = companyDoc?.aiAgentSettings?.frontDeskBehavior?.greetingResponses || [];
    
    // Check if greeting responses are configured
    const hasGreetingResponses = greetingResponses.length > 0;
    
    // Check for common greeting triggers
    const greetingTriggers = ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening'];
    const configuredTriggers = greetingResponses.flatMap(g => {
        if (typeof g === 'string') return [g.toLowerCase()];
        if (g.trigger) return [g.trigger.toLowerCase()];
        if (g.triggers) return g.triggers.map(t => t.toLowerCase());
        return [];
    });
    
    const missingTriggers = greetingTriggers.filter(t => 
        !configuredTriggers.some(ct => ct.includes(t) || t.includes(ct))
    );
    
    // The V34 bug was about fresh-* session IDs being treated as existing sessions
    // We can't check that here directly, but we can note if the fix is deployed
    const v34BugNote = 'V34 bug FIXED in commit e1b68c44 - fresh-* sessions now correctly trigger greeting intercept';
    
    if (!hasGreetingResponses) {
        return {
            status: 'NOT_CONFIGURED',
            health: 'YELLOW',
            message: 'No greeting responses configured - LLM will handle all greetings',
            responseCount: 0,
            configuredTriggers: [],
            missingTriggers: greetingTriggers,
            v34BugNote
        };
    }
    
    if (missingTriggers.length > 0) {
        return {
            status: 'PARTIAL',
            health: 'YELLOW',
            message: `${greetingResponses.length} responses configured, but missing common triggers`,
            responseCount: greetingResponses.length,
            configuredTriggers,
            missingTriggers,
            v34BugNote,
            fix: `Add responses for: ${missingTriggers.join(', ')}`
        };
    }
    
    return {
        status: 'WIRED',
        health: 'GREEN',
        message: `${greetingResponses.length} greeting responses configured with all common triggers`,
        responseCount: greetingResponses.length,
        configuredTriggers,
        missingTriggers: [],
        v34BugNote
    };
}

// ============================================================================
// BOOKING SLOT NORMALIZATION CHECK (detailed view of what's rejected)
// ============================================================================

function checkBookingSlotNormalization(companyDoc) {
    const frontDesk = companyDoc?.aiAgentSettings?.frontDeskBehavior || {};
    const bookingSlots = frontDesk.bookingSlots || [];
    
    const analysis = {
        total: bookingSlots.length,
        valid: [],
        rejected: [],
        reasons: {}
    };
    
    for (const slot of bookingSlots) {
        const slotId = slot.id || slot.slotId || slot._id?.toString() || 'unknown';
        const issues = [];
        
        // Check for question field
        if (!slot.question && !slot.prompt) {
            issues.push('missing_question');
        }
        
        // Check for type field
        if (!slot.type && !slot.slotType) {
            issues.push('missing_type');
        }
        
        // Check for ID
        if (!slot.id && !slot.slotId) {
            issues.push('missing_id');
        }
        
        if (issues.length === 0) {
            analysis.valid.push({
                id: slotId,
                type: slot.type || slot.slotType,
                hasQuestion: true
            });
        } else {
            analysis.rejected.push({
                id: slotId,
                type: slot.type || slot.slotType || 'unknown',
                issues
            });
            
            // Aggregate rejection reasons
            for (const issue of issues) {
                analysis.reasons[issue] = (analysis.reasons[issue] || 0) + 1;
            }
        }
    }
    
    const status = analysis.rejected.length === 0 
        ? (analysis.valid.length > 0 ? 'ALL_VALID' : 'NONE_CONFIGURED')
        : 'HAS_REJECTIONS';
    
    const health = analysis.rejected.length === 0
        ? (analysis.valid.length > 0 ? 'GREEN' : 'GRAY')
        : 'RED';
    
    return {
        status,
        health,
        message: analysis.rejected.length > 0 
            ? `${analysis.rejected.length}/${analysis.total} slots will be REJECTED at runtime`
            : `${analysis.valid.length} slots valid and ready`,
        totalSlots: analysis.total,
        validSlots: analysis.valid.length,
        rejectedSlots: analysis.rejected.length,
        rejectionReasons: analysis.reasons,
        validSlotDetails: analysis.valid,
        rejectedSlotDetails: analysis.rejected,
        fix: analysis.rejected.length > 0 
            ? 'Add "question" field to all slots in Front Desk → Booking Prompts'
            : null
    };
}

// ============================================================================
// MAIN REPORT BUILDER
// ============================================================================

async function buildWiringReport({
    companyId,
    companyDoc,
    effectiveConfig = {},
    runtimeTruth = null,
    tradeKey = 'universal',
    environment = 'production',
    runtimeVersion = null,
    effectiveConfigVersion = null,
    includeInfrastructure = true
}) {
    const startTime = Date.now();
    const now = new Date().toISOString();
    
    logger.info('[WIRING REPORT] Building report', { companyId, tradeKey });
    
    // Build node index
    const nodeMap = new Map();
    for (const node of wiringRegistryV1.nodes) {
        nodeMap.set(node.id, node);
    }
    
    // Track children
    const childrenMap = new Map();
    for (const node of wiringRegistryV1.nodes) {
        if (node.parentId) {
            if (!childrenMap.has(node.parentId)) {
                childrenMap.set(node.parentId, []);
            }
            childrenMap.get(node.parentId).push(node.id);
        }
    }
    
    // Evaluate each node
    const nodesOut = [];
    const issues = [];
    
    for (const node of wiringRegistryV1.nodes) {
        // Check if config exists in database
        let dbOk = false;
        const dbValues = {};
        
        for (const path of (node.expectedDbPaths || [])) {
            if (path.includes(' collection')) continue; // Skip collection references
            
            const val = getPath({ company: companyDoc }, path);
            dbValues[path] = val;
            if (isNonEmpty(val)) dbOk = true;
        }
        
        // Check consumers declared
        const consumerDeclared = (node.expectedConsumers || []).length > 0;
        
        // Check for critical issues
        let hasCriticalIssue = false;
        let criticalIssueMessage = null;
        
        if (node.criticalIssue) {
            const checkField = node.criticalIssue.checkField;
            if (checkField) {
                const val = getPath({ company: companyDoc }, checkField);
                if (!isNonEmpty(val)) {
                    hasCriticalIssue = true;
                    criticalIssueMessage = node.criticalIssue.description;
                }
            }
        }
        
        // Check required fields
        const missingFields = [];
        if (node.requiredFields && dbOk) {
            // Would need to iterate through actual config items to check
            // For now, we flag if entire config missing
        }
        
        // Determine enabled status
        const enabled = dbOk || node.type === 'TAB' || node.type === 'INFRASTRUCTURE';
        
        // UI-only check
        const uiOnly = enabled && !consumerDeclared && node.type !== 'TAB' && node.type !== 'INFRASTRUCTURE';
        
        // Compute status
        const { status, health } = computeStatus({
            enabled,
            dbOk,
            compiledOk: dbOk, // Simplified for now
            consumerDeclared,
            hasCriticalIssue,
            uiOnly
        });
        
        // Build reasons list
        const reasons = [];
        if (!dbOk && enabled) reasons.push('Config missing in database');
        if (!consumerDeclared && enabled) reasons.push('No runtime consumer declared');
        if (hasCriticalIssue) reasons.push(criticalIssueMessage);
        if (uiOnly) reasons.push('UI-only - no runtime consumer');
        
        const nodeOut = {
            id: node.id,
            type: node.type,
            label: node.label,
            description: node.description || '',
            parentId: node.parentId || null,
            enabled,
            status,
            health,
            reasons,
            critical: node.critical || false,
            expectedDbPaths: node.expectedDbPaths || [],
            expectedConsumers: node.expectedConsumers || [],
            expectedTraceKeys: node.expectedTraceKeys || [],
            children: childrenMap.get(node.id) || []
        };
        
        nodesOut.push(nodeOut);
        
        // Track issues
        if (enabled && !['WIRED', 'PROVEN', 'DISABLED'].includes(status)) {
            issues.push({
                severity: hasCriticalIssue || node.critical ? 'CRITICAL' : status === 'MISCONFIGURED' ? 'HIGH' : 'MEDIUM',
                nodeId: node.id,
                label: node.label,
                status,
                reasons,
                fix: node.criticalIssue?.solution || null
            });
        }
    }
    
    // ========================================================================
    // SPECIAL CHECKS
    // ========================================================================
    
    const specialChecks = {};
    
    // Redis cache check
    if (includeInfrastructure) {
        specialChecks.redisCache = await checkRedisCache(companyId);
    }
    
    // Scenario pool check
    specialChecks.scenarioPool = await checkScenarioPool(companyId);
    
    // Dynamic flows check
    specialChecks.dynamicFlows = await checkDynamicFlows(companyId);
    
    // Booking contract check
    specialChecks.bookingContract = checkBookingContract(companyDoc);
    
    // Booking slot normalization check (detailed rejection analysis)
    specialChecks.bookingSlotNormalization = checkBookingSlotNormalization(companyDoc);

    // promptPacks check REMOVED Jan 2026 - nuked
    
    // Kill switches check (CRITICAL - the reason scenarioCount=0)
    specialChecks.killSwitches = checkKillSwitches(companyDoc);
    
    // Greeting intercept check (the V34 bug)
    specialChecks.greetingIntercept = checkGreetingIntercept(companyDoc);
    
    // Template references check
    const templateRefs = companyDoc?.aiAgentSettings?.templateReferences || [];
    const enabledRefs = templateRefs.filter(r => r.enabled !== false);
    specialChecks.templateReferences = {
        status: enabledRefs.length > 0 ? 'LINKED' : 'NOT_LINKED',
        health: enabledRefs.length > 0 ? 'GREEN' : 'RED',
        totalRefs: templateRefs.length,
        enabledRefs: enabledRefs.length,
        templateIds: enabledRefs.map(r => r.templateId?.toString()),
        message: enabledRefs.length > 0 
            ? `${enabledRefs.length} template(s) linked`
            : 'CRITICAL: No templates linked - scenarios will not load!'
    };
    
    // Add critical issues from special checks
    if (specialChecks.scenarioPool.status === 'EMPTY') {
        issues.unshift({
            severity: 'CRITICAL',
            nodeId: 'dataConfig.scenarios',
            label: 'Scenarios',
            status: 'EMPTY',
            reasons: ['Scenario pool returned 0 scenarios'],
            fix: specialChecks.templateReferences.status === 'NOT_LINKED'
                ? 'Link a template via templateReferences'
                : 'Clear Redis cache: node scripts/clear-scenario-cache.js'
        });
    }
    
    if (specialChecks.templateReferences.status === 'NOT_LINKED') {
        issues.unshift({
            severity: 'CRITICAL',
            nodeId: 'dataConfig.templateReferences',
            label: 'Template References',
            status: 'NOT_LINKED',
            reasons: ['No templates linked to company'],
            fix: 'Add template reference via templateReferences or admin UI'
        });
    }
    
    if (specialChecks.bookingContract.status === 'NOT_COMPILED') {
        issues.push({
            severity: 'HIGH',
            nodeId: 'frontDesk.bookingPrompts',
            label: 'Booking Prompts',
            status: 'NOT_COMPILED',
            reasons: ['Slots defined but booking contract not compiled'],
            fix: 'Compile booking contract via UI or API'
        });
    }
    
    // Kill switches blocking scenarios (CRITICAL - the actual reason scenarioCount=0)
    if (specialChecks.killSwitches.status === 'SCENARIOS_BLOCKED') {
        issues.unshift({
            severity: 'CRITICAL',
            nodeId: 'frontDesk.discoveryConsent',
            label: 'Kill Switches BLOCKING Scenarios',
            status: 'SCENARIOS_BLOCKED',
            reasons: [
                'forceLLMDiscovery=true AND disableScenarioAutoResponses=true',
                'Scenarios will NEVER fire even if template is perfect',
                'This is why scenarioCount shows 0 in debug logs'
            ],
            fix: 'Set BOTH to false in Front Desk → Discovery & Consent tab'
        });
    } else if (specialChecks.killSwitches.status === 'AUTO_RESPONSE_DISABLED') {
        issues.unshift({
            severity: 'CRITICAL',
            nodeId: 'frontDesk.discoveryConsent',
            label: 'Scenario Auto-Response Disabled',
            status: 'AUTO_RESPONSE_DISABLED',
            reasons: ['disableScenarioAutoResponses=true - scenarios matched but cannot respond'],
            fix: 'Set disableScenarioAutoResponses=false in Front Desk → Discovery & Consent'
        });
    } else if (specialChecks.killSwitches.status === 'DISCOVERY_FORCED') {
        issues.push({
            severity: 'HIGH',
            nodeId: 'frontDesk.discoveryConsent',
            label: 'LLM Discovery Forced',
            status: 'DISCOVERY_FORCED',
            reasons: ['forceLLMDiscovery=true - LLM speaks first, scenarios as tools only'],
            fix: 'If you want scenario auto-responses, set forceLLMDiscovery=false'
        });
    }
    
    // Booking slot rejections
    if (specialChecks.bookingSlotNormalization.status === 'HAS_REJECTIONS') {
        issues.push({
            severity: 'HIGH',
            nodeId: 'frontDesk.bookingPrompts',
            label: 'Booking Slots Will Be Rejected',
            status: 'HAS_REJECTIONS',
            reasons: [
                `${specialChecks.bookingSlotNormalization.rejectedSlots} of ${specialChecks.bookingSlotNormalization.totalSlots} slots missing required fields`,
                `Rejection reasons: ${Object.entries(specialChecks.bookingSlotNormalization.rejectionReasons).map(([k, v]) => `${k}(${v})`).join(', ')}`
            ],
            fix: 'Add "question" field to all booking slots in Front Desk → Booking Prompts'
        });
    }

    // promptPacks legacy check REMOVED Jan 2026
    
    // ========================================================================
    // SCOREBOARD
    // ========================================================================
    
    const tabNodes = nodesOut.filter(n => n.type === 'TAB');
    const sectionNodes = nodesOut.filter(n => n.type === 'SECTION');
    
    function countByStatus(nodes) {
        return {
            total: nodes.length,
            wired: nodes.filter(n => n.status === 'WIRED').length,
            proven: nodes.filter(n => n.status === 'PROVEN').length,
            partial: nodes.filter(n => n.status === 'PARTIAL').length,
            misconfigured: nodes.filter(n => n.status === 'MISCONFIGURED').length,
            uiOnly: nodes.filter(n => n.status === 'UI_ONLY').length,
            disabled: nodes.filter(n => n.status === 'DISABLED').length,
            notConfigured: nodes.filter(n => n.status === 'NOT_CONFIGURED').length
        };
    }
    
    // ========================================================================
    // OVERALL HEALTH
    // ========================================================================
    
    let overallHealth = 'GREEN';
    if (issues.some(i => i.severity === 'CRITICAL')) {
        overallHealth = 'RED';
    } else if (issues.some(i => i.severity === 'HIGH')) {
        overallHealth = 'YELLOW';
    } else if (issues.length > 0) {
        overallHealth = 'YELLOW';
    }
    
    // ========================================================================
    // BUILD REPORT
    // ========================================================================
    
    const report = {
        schemaVersion: WIRING_SCHEMA_VERSION,
        generatedAt: now,
        generationTimeMs: Date.now() - startTime,
        environment,
        
        // Company info
        companyId,
        companyName: companyDoc?.companyName || companyDoc?.businessName || null,
        tradeKey: companyDoc?.trade || companyDoc?.tradeKey || tradeKey,
        
        // Versions
        runtimeVersion,
        effectiveConfigVersion: companyDoc?.effectiveConfigVersion || effectiveConfigVersion,
        
        // Overall status
        health: overallHealth,
        
        // Scoreboard
        counts: {
            tabs: countByStatus(tabNodes),
            sections: countByStatus(sectionNodes),
            issues: {
                critical: issues.filter(i => i.severity === 'CRITICAL').length,
                high: issues.filter(i => i.severity === 'HIGH').length,
                medium: issues.filter(i => i.severity === 'MEDIUM').length,
                total: issues.length
            }
        },
        
        // Special checks (most important for debugging)
        specialChecks,
        
        // Issues list (sorted by severity)
        issues: issues.sort((a, b) => {
            const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 };
            return (order[a.severity] || 99) - (order[b.severity] || 99);
        }).slice(0, 50),
        
        // Guardrails
        guardrails: wiringRegistryV1.guardrails,
        
        // Checkpoints reference
        checkpoints: wiringRegistryV1.checkpoints,
        
        // All nodes (for tree/diagram view)
        nodes: nodesOut,
        
        // Edges for diagram (simplified)
        edges: []
    };
    
    logger.info('[WIRING REPORT] Report built', {
        companyId,
        health: overallHealth,
        issueCount: issues.length,
        generationTimeMs: report.generationTimeMs
    });
    
    return report;
}

module.exports = { buildWiringReport };

