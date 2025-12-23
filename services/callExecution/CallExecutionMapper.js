/**
 * ════════════════════════════════════════════════════════════════════════════════
 * CALL EXECUTION MAPPER SERVICE
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * Enterprise-grade call flow visualization engine.
 * 
 * PURPOSE:
 * Generate a complete visualization of how a call flows through all systems:
 * - Call Protection → Dynamic Flow → Scenarios → Booking → Transfer
 * 
 * DESIGN PRINCIPLES:
 * 1. COMPLETE - Shows every system the call touches
 * 2. ORDERED - Reflects actual execution order
 * 3. LINKED - Shows connections between systems
 * 4. STATEFUL - Reflects current configuration state (enabled/disabled)
 * 5. ACTIONABLE - Identifies gaps and misconfigurations
 * 
 * OUTPUT:
 * A structured execution map that can be visualized as:
 * - Vertical flow diagram (UI)
 * - JSON export (debugging)
 * - Audit trail (compliance)
 * 
 * ════════════════════════════════════════════════════════════════════════════════
 */

const logger = require('../../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const EXECUTION_MAP_VERSION = '1.0.0';

/**
 * Execution stages in order
 */
const EXECUTION_STAGES = [
    {
        id: 'CALL_ARRIVAL',
        name: 'Call Arrives',
        icon: '📞',
        description: 'Incoming call is received by the system',
        order: 1
    },
    {
        id: 'CALL_PROTECTION',
        name: 'Call Protection',
        icon: '🛡️',
        description: 'Spam, voicemail, and frustration detection',
        order: 2
    },
    {
        id: 'GREETING',
        name: 'Greeting',
        icon: '👋',
        description: 'Initial greeting message',
        order: 3
    },
    {
        id: 'DYNAMIC_FLOW_CHECK',
        name: 'Dynamic Flow Check',
        icon: '🔀',
        description: 'Trigger-based flow evaluation',
        order: 4
    },
    {
        id: 'SCENARIO_MATCHING',
        name: 'Scenario Matching',
        icon: '🎯',
        description: '3-Tier intelligence: Rules → Semantic → LLM',
        order: 5
    },
    {
        id: 'MODE_CHECK',
        name: 'Mode Check',
        icon: '🔄',
        description: 'Current conversation mode (DISCOVERY/BOOKING)',
        order: 6
    },
    {
        id: 'BOOKING_ENGINE',
        name: 'Booking Engine',
        icon: '📅',
        description: 'Slot collection and calendar integration',
        order: 7
    },
    {
        id: 'TRANSFER_CHECK',
        name: 'Transfer Check',
        icon: '📲',
        description: 'Escalation and transfer routing',
        order: 8
    },
    {
        id: 'RESPONSE_GENERATION',
        name: 'Response Generation',
        icon: '💬',
        description: 'Placeholder substitution and guardrails',
        order: 9
    },
    {
        id: 'RESPONSE_DELIVERY',
        name: 'Response Delivery',
        icon: '🔊',
        description: 'TTS and response to caller',
        order: 10
    }
];

/**
 * Link types between stages
 */
const LINK_TYPES = {
    SEQUENTIAL: 'sequential',      // Normal flow A → B
    CONDITIONAL: 'conditional',    // A → B if condition
    BYPASS: 'bypass',              // Skip A, go to B
    REDIRECT: 'redirect',          // Force transfer to B
    PARALLEL: 'parallel'           // A + B simultaneously
};

// ═══════════════════════════════════════════════════════════════════════════════
// CALL EXECUTION MAPPER CLASS
// ═══════════════════════════════════════════════════════════════════════════════

class CallExecutionMapper {
    /**
     * Create a new CallExecutionMapper instance
     */
    constructor() {
        this.warnings = [];
        this.gaps = [];
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PUBLIC METHODS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Generate complete execution map from platform snapshot
     * @param {Object} platformSnapshot - Full platform snapshot
     * @returns {Object} Execution map with stages, links, and status
     */
    generateMap(platformSnapshot) {
        const startTime = Date.now();
        
        this.warnings = [];
        this.gaps = [];
        
        const providers = platformSnapshot.providers || {};
        const meta = platformSnapshot.meta || {};
        
        try {
            // Build each stage
            const stages = EXECUTION_STAGES.map(stageDef => {
                const stageData = this._buildStage(stageDef, providers, meta);
                return stageData;
            });
            
            // Build links between stages
            const links = this._buildLinks(stages, providers);
            
            // Identify gaps and issues
            const issues = this._identifyIssues(stages, links, providers);
            
            // Calculate overall health
            const health = this._calculateHealth(stages, issues);
            
            return {
                success: true,
                version: EXECUTION_MAP_VERSION,
                generatedAt: new Date().toISOString(),
                generatedIn: Date.now() - startTime,
                company: {
                    id: meta.companyId,
                    name: meta.companyName,
                    trade: meta.tradeKey
                },
                stages,
                links,
                issues,
                health,
                summary: this._generateSummary(stages, issues)
            };
            
        } catch (error) {
            logger.error('[EXECUTION MAP] Generation error:', error);
            
            return {
                success: false,
                error: error.message,
                generatedAt: new Date().toISOString()
            };
        }
    }

    /**
     * Get execution path for a specific scenario
     * @param {Object} platformSnapshot - Platform snapshot
     * @param {String} scenario - Scenario ID or type
     * @returns {Object} Specific execution path
     */
    getScenarioPath(platformSnapshot, scenario) {
        const fullMap = this.generateMap(platformSnapshot);
        
        if (!fullMap.success) {
            return fullMap;
        }
        
        // Filter stages relevant to the scenario
        const path = this._traceScenarioPath(fullMap, scenario);
        
        return {
            success: true,
            scenario,
            path,
            summary: `${path.length} stages in execution path`
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PRIVATE METHODS - STAGE BUILDING
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Build a single stage with its current configuration
     */
    _buildStage(stageDef, providers, meta) {
        const stage = {
            id: stageDef.id,
            name: stageDef.name,
            icon: stageDef.icon,
            description: stageDef.description,
            order: stageDef.order,
            status: 'unknown',
            enabled: true,
            config: {},
            actions: [],
            warnings: []
        };
        
        switch (stageDef.id) {
            case 'CALL_ARRIVAL':
                stage.status = 'active';
                stage.config = {
                    callCenter: providers.callCenter?.data || null
                };
                break;
                
            case 'CALL_PROTECTION':
                this._buildCallProtectionStage(stage, providers.callProtection);
                break;
                
            case 'GREETING':
                this._buildGreetingStage(stage, providers.controlPlane);
                break;
                
            case 'DYNAMIC_FLOW_CHECK':
                this._buildDynamicFlowStage(stage, providers.dynamicFlow);
                break;
                
            case 'SCENARIO_MATCHING':
                this._buildScenarioMatchingStage(stage, providers.scenarioBrain);
                break;
                
            case 'MODE_CHECK':
                this._buildModeCheckStage(stage, providers.controlPlane);
                break;
                
            case 'BOOKING_ENGINE':
                this._buildBookingStage(stage, providers.controlPlane);
                break;
                
            case 'TRANSFER_CHECK':
                this._buildTransferStage(stage, providers.transfers);
                break;
                
            case 'RESPONSE_GENERATION':
                this._buildResponseGenerationStage(stage, providers);
                break;
                
            case 'RESPONSE_DELIVERY':
                stage.status = 'active';
                stage.config = { tts: 'enabled' };
                break;
                
            default:
                stage.status = 'unknown';
        }
        
        return stage;
    }

    _buildCallProtectionStage(stage, callProtection) {
        if (!callProtection || callProtection.health !== 'GREEN') {
            stage.status = callProtection?.health === 'YELLOW' ? 'warning' : 'disabled';
            stage.warnings.push('Call protection not fully configured');
        } else {
            stage.status = 'active';
        }
        
        const rules = callProtection?.data?.rules || [];
        const enabledRules = rules.filter(r => r.enabled);
        
        stage.config = {
            totalRules: rules.length,
            enabledRules: enabledRules.length,
            ruleTypes: enabledRules.map(r => r.name)
        };
        
        stage.actions = [
            { trigger: 'Spam detected', action: 'Block call' },
            { trigger: 'Voicemail detected', action: 'End call' },
            { trigger: 'Frustration detected', action: 'Escalate to human' }
        ].filter(a => 
            enabledRules.some(r => r.name.toLowerCase().includes(a.trigger.split(' ')[0].toLowerCase()))
        );
        
        if (enabledRules.length === 0) {
            stage.warnings.push('No call protection rules enabled');
        }
    }

    _buildGreetingStage(stage, controlPlane) {
        const greeting = controlPlane?.data?.frontDesk?.greetingPreview;
        
        if (!greeting) {
            stage.status = 'warning';
            stage.warnings.push('No greeting configured');
            stage.config = { hasGreeting: false };
        } else {
            stage.status = 'active';
            stage.config = {
                hasGreeting: true,
                preview: greeting.substring(0, 100) + (greeting.length > 100 ? '...' : ''),
                wordCount: greeting.split(' ').length
            };
        }
    }

    _buildDynamicFlowStage(stage, dynamicFlow) {
        if (!dynamicFlow || dynamicFlow.health !== 'GREEN') {
            stage.status = dynamicFlow?.health === 'YELLOW' ? 'warning' : 'disabled';
        } else {
            stage.status = 'active';
        }
        
        const flows = dynamicFlow?.data?.flows || [];
        const enabledFlows = flows.filter(f => f.enabled);
        
        stage.config = {
            totalFlows: flows.length,
            enabledFlows: enabledFlows.length,
            flowNames: enabledFlows.slice(0, 5).map(f => f.name || f.flowKey)
        };
        
        stage.actions = enabledFlows.map(f => ({
            trigger: f.flowKey,
            action: `Priority ${f.priority}`,
            priority: f.priority
        })).sort((a, b) => b.priority - a.priority);
        
        if (enabledFlows.length === 0) {
            stage.warnings.push('No dynamic flows enabled');
        }
    }

    _buildScenarioMatchingStage(stage, scenarioBrain) {
        if (!scenarioBrain || scenarioBrain.health !== 'GREEN') {
            stage.status = scenarioBrain?.health === 'YELLOW' ? 'warning' : 'error';
        } else {
            stage.status = 'active';
        }
        
        const templates = scenarioBrain?.data?.templates || [];
        let totalCategories = 0;
        let totalScenarios = 0;
        
        for (const template of templates) {
            totalCategories += template.categories?.length || 0;
            for (const category of template.categories || []) {
                totalScenarios += category.scenarios?.length || 0;
            }
        }
        
        stage.config = {
            templates: templates.length,
            categories: totalCategories,
            scenarios: totalScenarios,
            tier1: 'Rule-based matching',
            tier2: 'Semantic matching',
            tier3: 'LLM fallback'
        };
        
        stage.actions = [
            { trigger: 'Tier 1 match (>0.8)', action: 'Use rule-based response' },
            { trigger: 'Tier 2 match (>0.6)', action: 'Use semantic match' },
            { trigger: 'No match', action: 'Use LLM fallback' }
        ];
        
        if (totalScenarios === 0) {
            stage.status = 'error';
            stage.warnings.push('No scenarios configured');
        }
    }

    _buildModeCheckStage(stage, controlPlane) {
        stage.status = 'active';
        
        const consentRequired = controlPlane?.data?.frontDesk?.discoveryConsent?.required !== false;
        
        stage.config = {
            modes: ['DISCOVERY', 'BOOKING', 'TRANSFER', 'EMERGENCY'],
            defaultMode: 'DISCOVERY',
            consentRequired
        };
        
        stage.actions = [
            { trigger: 'Mode = DISCOVERY', action: 'Allow scenario responses' },
            { trigger: 'Consent given + booking intent', action: 'Switch to BOOKING' },
            { trigger: 'Emergency detected', action: 'Switch to EMERGENCY' },
            { trigger: 'Transfer requested', action: 'Switch to TRANSFER' }
        ];
    }

    _buildBookingStage(stage, controlPlane) {
        const bookingEnabled = controlPlane?.data?.frontDesk?.bookingEnabled !== false;
        const slots = controlPlane?.data?.frontDesk?.bookingSlotNames || [];
        
        if (!bookingEnabled) {
            stage.status = 'disabled';
            stage.enabled = false;
        } else if (slots.length === 0) {
            stage.status = 'warning';
            stage.warnings.push('Booking enabled but no slots configured');
        } else {
            stage.status = 'active';
        }
        
        stage.config = {
            enabled: bookingEnabled,
            slotsCount: slots.length,
            slots: slots.slice(0, 5),
            calendar: controlPlane?.data?.calendar || null
        };
        
        stage.actions = slots.map(slot => ({
            trigger: `Collect ${slot}`,
            action: `Ask for ${slot}`
        }));
    }

    _buildTransferStage(stage, transfers) {
        if (!transfers || transfers.enabled === false) {
            stage.status = 'disabled';
            stage.enabled = false;
        } else if (transfers.health !== 'GREEN') {
            stage.status = transfers.health === 'YELLOW' ? 'warning' : 'error';
        } else {
            stage.status = 'active';
        }
        
        const targets = transfers?.data?.targets || [];
        const enabledTargets = targets.filter(t => t.enabled !== false);
        
        stage.config = {
            totalTargets: targets.length,
            enabledTargets: enabledTargets.length,
            targets: enabledTargets.map(t => ({
                id: t.intentTag,
                label: t.label
            }))
        };
        
        stage.actions = enabledTargets.map(t => ({
            trigger: `Transfer to ${t.label}`,
            action: `Call ${t.intentTag}`
        }));
        
        if (enabledTargets.length === 0 && transfers?.enabled !== false) {
            stage.warnings.push('Transfers enabled but no targets configured');
        }
    }

    _buildResponseGenerationStage(stage, providers) {
        stage.status = 'active';
        
        const placeholders = providers.placeholders?.data?.items || [];
        
        stage.config = {
            placeholders: placeholders.length,
            placeholderNames: placeholders.slice(0, 5).map(p => p.canonicalKey),
            guardrails: 'Forbidden words check',
            toneAdjustment: 'Personality settings applied'
        };
        
        stage.actions = [
            { trigger: 'Response ready', action: 'Substitute placeholders' },
            { trigger: 'Placeholders substituted', action: 'Apply guardrails' },
            { trigger: 'Guardrails passed', action: 'Apply tone adjustment' }
        ];
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PRIVATE METHODS - LINK BUILDING
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Build links between stages
     */
    _buildLinks(stages, providers) {
        const links = [];
        
        // Sequential links
        for (let i = 0; i < stages.length - 1; i++) {
            const from = stages[i];
            const to = stages[i + 1];
            
            links.push({
                from: from.id,
                to: to.id,
                type: from.enabled && to.enabled ? LINK_TYPES.SEQUENTIAL : LINK_TYPES.BYPASS,
                label: from.enabled ? 'Continue' : 'Skip (disabled)'
            });
        }
        
        // Conditional links
        // Call Protection → Transfer (if frustration)
        links.push({
            from: 'CALL_PROTECTION',
            to: 'TRANSFER_CHECK',
            type: LINK_TYPES.CONDITIONAL,
            label: 'If frustration detected → Transfer'
        });
        
        // Dynamic Flow → Mode Change
        links.push({
            from: 'DYNAMIC_FLOW_CHECK',
            to: 'MODE_CHECK',
            type: LINK_TYPES.CONDITIONAL,
            label: 'If mode transition action'
        });
        
        // Scenario → Booking
        links.push({
            from: 'SCENARIO_MATCHING',
            to: 'BOOKING_ENGINE',
            type: LINK_TYPES.CONDITIONAL,
            label: 'If booking intent detected'
        });
        
        // Scenario → Transfer
        links.push({
            from: 'SCENARIO_MATCHING',
            to: 'TRANSFER_CHECK',
            type: LINK_TYPES.CONDITIONAL,
            label: 'If transfer hook configured'
        });
        
        return links;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PRIVATE METHODS - ISSUE IDENTIFICATION
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Identify gaps and issues in the execution flow
     */
    _identifyIssues(stages, links, providers) {
        const issues = {
            critical: [],
            warnings: [],
            info: []
        };
        
        // Check for critical issues
        const scenarioStage = stages.find(s => s.id === 'SCENARIO_MATCHING');
        if (scenarioStage?.config?.scenarios === 0) {
            issues.critical.push({
                stage: 'SCENARIO_MATCHING',
                message: 'No scenarios configured - AI will rely entirely on LLM',
                recommendation: 'Apply a Blueprint to configure scenarios'
            });
        }
        
        // Check for warnings
        const greetingStage = stages.find(s => s.id === 'GREETING');
        if (!greetingStage?.config?.hasGreeting) {
            issues.warnings.push({
                stage: 'GREETING',
                message: 'No greeting configured',
                recommendation: 'Add a greeting in Control Plane'
            });
        }
        
        const protectionStage = stages.find(s => s.id === 'CALL_PROTECTION');
        if (protectionStage?.config?.enabledRules === 0) {
            issues.warnings.push({
                stage: 'CALL_PROTECTION',
                message: 'No call protection rules enabled',
                recommendation: 'Enable spam and voicemail detection'
            });
        }
        
        const bookingStage = stages.find(s => s.id === 'BOOKING_ENGINE');
        if (bookingStage?.config?.enabled && bookingStage?.config?.slotsCount === 0) {
            issues.warnings.push({
                stage: 'BOOKING_ENGINE',
                message: 'Booking enabled but no slots configured',
                recommendation: 'Add booking slots in Front Desk'
            });
        }
        
        const transferStage = stages.find(s => s.id === 'TRANSFER_CHECK');
        if (transferStage?.status === 'warning') {
            issues.warnings.push({
                stage: 'TRANSFER_CHECK',
                message: 'Transfers enabled but no targets configured',
                recommendation: 'Add transfer targets in Transfer Calls'
            });
        }
        
        // Check for info items
        const flowStage = stages.find(s => s.id === 'DYNAMIC_FLOW_CHECK');
        if (flowStage?.config?.enabledFlows === 0) {
            issues.info.push({
                stage: 'DYNAMIC_FLOW_CHECK',
                message: 'No dynamic flows configured',
                recommendation: 'Add flows for advanced routing (optional)'
            });
        }
        
        // Collect all stage warnings
        for (const stage of stages) {
            for (const warning of stage.warnings) {
                if (!issues.warnings.some(w => w.message === warning)) {
                    issues.warnings.push({
                        stage: stage.id,
                        message: warning
                    });
                }
            }
        }
        
        return issues;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PRIVATE METHODS - HEALTH CALCULATION
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Calculate overall health status
     */
    _calculateHealth(stages, issues) {
        if (issues.critical.length > 0) {
            return {
                status: 'RED',
                score: 0,
                message: `${issues.critical.length} critical issue(s) blocking production`
            };
        }
        
        if (issues.warnings.length > 5) {
            return {
                status: 'YELLOW',
                score: 50,
                message: `${issues.warnings.length} warnings need attention`
            };
        }
        
        if (issues.warnings.length > 0) {
            return {
                status: 'YELLOW',
                score: 80,
                message: `${issues.warnings.length} minor issue(s) to review`
            };
        }
        
        return {
            status: 'GREEN',
            score: 100,
            message: 'All systems configured correctly'
        };
    }

    /**
     * Generate human-readable summary
     */
    _generateSummary(stages, issues) {
        const activeStages = stages.filter(s => s.status === 'active').length;
        const totalStages = stages.length;
        
        return {
            activeStages,
            totalStages,
            coverage: `${Math.round((activeStages / totalStages) * 100)}%`,
            criticalIssues: issues.critical.length,
            warnings: issues.warnings.length,
            description: `${activeStages}/${totalStages} execution stages active`
        };
    }

    /**
     * Trace the path for a specific scenario type
     */
    _traceScenarioPath(fullMap, scenarioType) {
        // Return stages that would be touched for this scenario
        const path = [];
        
        // Always starts with call arrival
        path.push(fullMap.stages.find(s => s.id === 'CALL_ARRIVAL'));
        
        // Always check call protection
        path.push(fullMap.stages.find(s => s.id === 'CALL_PROTECTION'));
        
        // Greeting
        path.push(fullMap.stages.find(s => s.id === 'GREETING'));
        
        // Dynamic flow (if enabled)
        const flowStage = fullMap.stages.find(s => s.id === 'DYNAMIC_FLOW_CHECK');
        if (flowStage?.config?.enabledFlows > 0) {
            path.push(flowStage);
        }
        
        // Scenario matching
        path.push(fullMap.stages.find(s => s.id === 'SCENARIO_MATCHING'));
        
        // Mode check
        path.push(fullMap.stages.find(s => s.id === 'MODE_CHECK'));
        
        // Scenario-specific paths
        if (scenarioType === 'emergency') {
            path.push(fullMap.stages.find(s => s.id === 'TRANSFER_CHECK'));
        } else if (scenarioType === 'booking') {
            path.push(fullMap.stages.find(s => s.id === 'BOOKING_ENGINE'));
        }
        
        // Always ends with response
        path.push(fullMap.stages.find(s => s.id === 'RESPONSE_GENERATION'));
        path.push(fullMap.stages.find(s => s.id === 'RESPONSE_DELIVERY'));
        
        return path.filter(Boolean);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
    CallExecutionMapper,
    EXECUTION_STAGES,
    LINK_TYPES,
    EXECUTION_MAP_VERSION
};

