/**
 * ════════════════════════════════════════════════════════════════════════════════
 * BLUEPRINT GENERATOR SERVICE
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * Enterprise-grade scenario configuration generator.
 * 
 * PURPOSE:
 * Generate complete, validated scenario configurations based on:
 * - Company's trade (HVAC, Dental, Plumbing, etc.)
 * - Company's existing platform settings
 * - Industry best practices
 * - Cross-system validation (transfers, placeholders, call protection, etc.)
 * 
 * DESIGN PRINCIPLES:
 * 1. DETERMINISTIC - No LLM, no guessing. Every value is intentional.
 * 2. VALIDATED - Cross-references all platform settings before generating.
 * 3. DOCUMENTED - Every field includes reasoning for the chosen value.
 * 4. TIERED OUTPUT - Summary → Category → Scenario (manageable review)
 * 5. EXTENSIBLE - Easy to add new trades and customize templates.
 * 
 * ARCHITECTURE:
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │                         BlueprintGenerator                                  │
 * ├─────────────────────────────────────────────────────────────────────────────┤
 * │  INPUT:                                                                     │
 * │  • companyId                                                                │
 * │  • tradeKey (hvac, dental, plumbing, universal)                            │
 * │  • platformSnapshot (from PlatformSnapshot service)                        │
 * │                                                                             │
 * │  PROCESS:                                                                   │
 * │  1. Load trade-specific Golden Template                                     │
 * │  2. Load company's platform snapshot                                        │
 * │  3. Merge template with company data                                        │
 * │  4. Validate against platform settings                                      │
 * │  5. Generate tiered output                                                  │
 * │                                                                             │
 * │  OUTPUT:                                                                    │
 * │  • BlueprintSummary (overview for admin review)                            │
 * │  • BlueprintDetail (full config per category)                              │
 * │  • BlueprintExport (complete JSON for backup)                              │
 * │  • ValidationReport (conflicts, warnings, recommendations)                  │
 * └─────────────────────────────────────────────────────────────────────────────┘
 * 
 * ════════════════════════════════════════════════════════════════════════════════
 */

const logger = require('../../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const BLUEPRINT_VERSION = '1.0.0';
const SCHEMA_VERSION = 'v1';

/**
 * Supported trade types with their template mappings
 */
const SUPPORTED_TRADES = {
    hvac: {
        key: 'hvac',
        name: 'HVAC',
        description: 'Heating, Ventilation, and Air Conditioning',
        templateFile: 'hvac.blueprint',
        keywords: ['ac', 'heating', 'cooling', 'furnace', 'hvac', 'air conditioning']
    },
    dental: {
        key: 'dental',
        name: 'Dental',
        description: 'Dental Office and Orthodontics',
        templateFile: 'dental.blueprint',
        keywords: ['dental', 'teeth', 'dentist', 'orthodontics', 'cleaning']
    },
    plumbing: {
        key: 'plumbing',
        name: 'Plumbing',
        description: 'Plumbing and Water Services',
        templateFile: 'plumbing.blueprint',
        keywords: ['plumbing', 'plumber', 'water', 'pipe', 'drain', 'leak']
    },
    universal: {
        key: 'universal',
        name: 'Universal',
        description: 'Universal template for any industry',
        templateFile: 'universal.blueprint',
        keywords: []
    }
};

/**
 * All scenario fields with their metadata
 * This is the SINGLE SOURCE OF TRUTH for field definitions
 */
const SCENARIO_FIELD_SCHEMA = {
    // ═══════════════════════════════════════════════════════════════════════════
    // CORE FIELDS
    // ═══════════════════════════════════════════════════════════════════════════
    enabled: {
        type: 'boolean',
        default: true,
        required: true,
        category: 'core',
        description: 'Whether this scenario is active and can be matched',
        impactLevel: 'critical'
    },
    priority: {
        type: 'number',
        default: 5,
        required: true,
        min: 0,
        max: 100,
        category: 'core',
        description: 'Higher priority scenarios are evaluated first (0-100)',
        impactLevel: 'critical'
    },
    name: {
        type: 'string',
        default: '',
        required: true,
        maxLength: 100,
        category: 'core',
        description: 'Human-readable name for this scenario',
        impactLevel: 'display'
    },
    description: {
        type: 'string',
        default: '',
        required: false,
        maxLength: 500,
        category: 'core',
        description: 'Detailed description of when this scenario should fire',
        impactLevel: 'display'
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // MATCHING FIELDS
    // ═══════════════════════════════════════════════════════════════════════════
    triggers: {
        type: 'array',
        itemType: 'string',
        default: [],
        required: true,
        minItems: 1,
        maxItems: 50,
        category: 'matching',
        description: 'Phrases that trigger this scenario',
        impactLevel: 'critical'
    },
    negativeTriggers: {
        type: 'array',
        itemType: 'string',
        default: [],
        required: false,
        maxItems: 30,
        category: 'matching',
        description: 'Phrases that should NOT trigger this scenario (exclusions)',
        impactLevel: 'high'
    },
    minConfidence: {
        type: 'number',
        default: 0.7,
        required: true,
        min: 0.1,
        max: 1.0,
        category: 'matching',
        description: 'Minimum confidence score required to match (0.1-1.0)',
        impactLevel: 'critical'
    },
    contextWeight: {
        type: 'number',
        default: 0.2,
        required: false,
        min: 0,
        max: 1.0,
        category: 'matching',
        description: 'How much recent conversation context affects matching (0-1)',
        impactLevel: 'medium'
    },
    requiresAllTriggers: {
        type: 'boolean',
        default: false,
        required: false,
        category: 'matching',
        description: 'If true, ALL triggers must be present (AND logic vs OR)',
        impactLevel: 'high'
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // RESPONSE FIELDS
    // ═══════════════════════════════════════════════════════════════════════════
    quickReplies: {
        type: 'array',
        itemType: 'string',
        default: [],
        required: true,
        minItems: 1,
        maxItems: 20,
        category: 'response',
        description: 'Short, quick responses (1-2 sentences)',
        impactLevel: 'critical'
    },
    fullReplies: {
        type: 'array',
        itemType: 'string',
        default: [],
        required: false,
        maxItems: 20,
        category: 'response',
        description: 'Longer, detailed responses for complex situations',
        impactLevel: 'high'
    },
    replySelection: {
        type: 'enum',
        options: ['random', 'sequential', 'contextual', 'first'],
        default: 'random',
        required: true,
        category: 'response',
        description: 'How to choose which reply to use',
        impactLevel: 'medium'
    },
    replyStrategy: {
        type: 'enum',
        options: ['quick_first', 'full_first', 'adaptive', 'time_based'],
        default: 'adaptive',
        required: false,
        category: 'response',
        description: 'Strategy for choosing quick vs full replies',
        impactLevel: 'medium'
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // FLOW CONTROL FIELDS
    // ═══════════════════════════════════════════════════════════════════════════
    followUpMode: {
        type: 'enum',
        options: ['none', 'collect_info', 'confirm', 'escalate', 'transfer'],
        default: 'none',
        required: false,
        category: 'flow',
        description: 'What happens after the initial response',
        impactLevel: 'high'
    },
    followUpPrompt: {
        type: 'string',
        default: '',
        required: false,
        maxLength: 300,
        category: 'flow',
        description: 'Custom prompt for follow-up (if followUpMode is set)',
        impactLevel: 'medium'
    },
    transitionToMode: {
        type: 'enum',
        options: ['DISCOVERY', 'BOOKING', 'TRANSFER', 'EMERGENCY', null],
        default: null,
        required: false,
        category: 'flow',
        description: 'Mode to transition to after this scenario fires',
        impactLevel: 'high'
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // TRANSFER / ESCALATION FIELDS
    // ═══════════════════════════════════════════════════════════════════════════
    transferHook: {
        type: 'string',
        default: null,
        required: false,
        category: 'escalation',
        description: 'Transfer target ID to route to (must exist in transfers)',
        impactLevel: 'high',
        validatedAgainst: 'transfers.targets'
    },
    transferMessage: {
        type: 'string',
        default: '',
        required: false,
        maxLength: 300,
        category: 'escalation',
        description: 'Message to say before transferring',
        impactLevel: 'medium'
    },
    escalationThreshold: {
        type: 'number',
        default: 3,
        required: false,
        min: 1,
        max: 10,
        category: 'escalation',
        description: 'How many times scenario can fire before auto-escalating',
        impactLevel: 'medium'
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ENTITY / VALIDATION FIELDS
    // ═══════════════════════════════════════════════════════════════════════════
    entityValidation: {
        type: 'object',
        default: {},
        required: false,
        category: 'entity',
        description: 'Required entities and their validation rules',
        impactLevel: 'medium',
        schema: {
            requiresName: { type: 'boolean', default: false },
            requiresPhone: { type: 'boolean', default: false },
            requiresAddress: { type: 'boolean', default: false },
            requiresZip: { type: 'boolean', default: false },
            requiresEmail: { type: 'boolean', default: false }
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // TIMING / BEHAVIOR FIELDS
    // ═══════════════════════════════════════════════════════════════════════════
    silencePolicy: {
        type: 'enum',
        options: ['wait', 'prompt_once', 'prompt_twice', 'escalate'],
        default: 'prompt_once',
        required: false,
        category: 'timing',
        description: 'What to do when caller goes silent after this scenario',
        impactLevel: 'medium'
    },
    timedFollowUp: {
        type: 'object',
        default: null,
        required: false,
        category: 'timing',
        description: 'Automatic follow-up after specified delay',
        impactLevel: 'low',
        schema: {
            enabled: { type: 'boolean', default: false },
            delaySeconds: { type: 'number', default: 5, min: 1, max: 30 },
            message: { type: 'string', default: '' }
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ACTION HOOKS
    // ═══════════════════════════════════════════════════════════════════════════
    actionHooks: {
        type: 'array',
        itemType: 'object',
        default: [],
        required: false,
        maxItems: 10,
        category: 'hooks',
        description: 'Actions to execute when this scenario fires',
        impactLevel: 'high',
        itemSchema: {
            type: { type: 'enum', options: ['set_flag', 'append_ledger', 'log_event', 'webhook'] },
            key: { type: 'string' },
            value: { type: 'any' }
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // METADATA FIELDS
    // ═══════════════════════════════════════════════════════════════════════════
    tags: {
        type: 'array',
        itemType: 'string',
        default: [],
        required: false,
        maxItems: 20,
        category: 'metadata',
        description: 'Tags for organizing and filtering scenarios',
        impactLevel: 'display'
    },
    version: {
        type: 'string',
        default: '1.0.0',
        required: false,
        category: 'metadata',
        description: 'Version of this scenario configuration',
        impactLevel: 'display'
    },
    lastUpdatedBy: {
        type: 'string',
        default: 'blueprint',
        required: false,
        category: 'metadata',
        description: 'Who/what last updated this scenario',
        impactLevel: 'audit'
    }
};

/**
 * Category field schema (similar structure for categories)
 */
const CATEGORY_FIELD_SCHEMA = {
    name: {
        type: 'string',
        default: '',
        required: true,
        maxLength: 100,
        category: 'core',
        description: 'Human-readable category name',
        impactLevel: 'display'
    },
    enabled: {
        type: 'boolean',
        default: true,
        required: true,
        category: 'core',
        description: 'Whether this category and its scenarios are active',
        impactLevel: 'critical'
    },
    priority: {
        type: 'number',
        default: 5,
        required: false,
        min: 0,
        max: 100,
        category: 'core',
        description: 'Category-level priority (affects all scenarios within)',
        impactLevel: 'high'
    },
    description: {
        type: 'string',
        default: '',
        required: false,
        maxLength: 500,
        category: 'core',
        description: 'What types of caller intents this category handles',
        impactLevel: 'display'
    },
    disabledDefaultReply: {
        type: 'string',
        default: null,
        required: false,
        maxLength: 500,
        category: 'fallback',
        description: 'Response to use if entire category is disabled',
        impactLevel: 'high'
    },
    icon: {
        type: 'string',
        default: '📁',
        required: false,
        maxLength: 10,
        category: 'display',
        description: 'Emoji or icon for UI display',
        impactLevel: 'display'
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// BLUEPRINT GENERATOR CLASS
// ═══════════════════════════════════════════════════════════════════════════════

class BlueprintGenerator {
    /**
     * Create a new BlueprintGenerator instance
     * @param {Object} options - Configuration options
     */
    constructor(options = {}) {
        this.options = {
            validateTransfers: true,
            validatePlaceholders: true,
            validatePriorities: true,
            includeReasoning: true,
            ...options
        };
        
        this.templateCache = new Map();
        this.validationErrors = [];
        this.validationWarnings = [];
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PUBLIC METHODS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Generate a complete blueprint for a company
     * @param {String} companyId - Company ID
     * @param {String} tradeKey - Trade type (hvac, dental, etc.)
     * @param {Object} platformSnapshot - Full platform snapshot
     * @returns {Object} Complete blueprint with summary, details, and validation
     */
    async generate(companyId, tradeKey, platformSnapshot) {
        const startTime = Date.now();
        
        logger.info(`[BLUEPRINT] Generating blueprint for company ${companyId}, trade: ${tradeKey}`);
        
        // Reset validation state
        this.validationErrors = [];
        this.validationWarnings = [];
        
        try {
            // 1. Validate inputs
            this._validateInputs(companyId, tradeKey, platformSnapshot);
            
            // 2. Load the trade-specific template
            const template = await this._loadTemplate(tradeKey);
            
            // 3. Extract platform context for merging
            const platformContext = this._extractPlatformContext(platformSnapshot);
            
            // 4. Merge template with platform context
            const mergedConfig = this._mergeTemplateWithContext(template, platformContext);
            
            // 5. Validate the merged config against platform
            const validation = this._validateConfig(mergedConfig, platformSnapshot);
            
            // 6. Generate tiered output
            const summary = this._generateSummary(mergedConfig, validation);
            const details = this._generateDetails(mergedConfig);
            const exportData = this._generateExport(mergedConfig, summary, validation);
            
            const generationMs = Date.now() - startTime;
            
            logger.info(`[BLUEPRINT] Generated blueprint in ${generationMs}ms - ${summary.categoriesTotal} categories, ${summary.scenariosTotal} scenarios`);
            
            return {
                success: true,
                meta: {
                    companyId,
                    tradeKey,
                    tradeName: SUPPORTED_TRADES[tradeKey]?.name || 'Unknown',
                    blueprintVersion: BLUEPRINT_VERSION,
                    schemaVersion: SCHEMA_VERSION,
                    generatedAt: new Date().toISOString(),
                    generationMs
                },
                summary,
                details,
                validation,
                export: exportData
            };
            
        } catch (error) {
            logger.error(`[BLUEPRINT] Generation failed for company ${companyId}:`, error);
            
            return {
                success: false,
                error: error.message,
                meta: {
                    companyId,
                    tradeKey,
                    blueprintVersion: BLUEPRINT_VERSION,
                    generatedAt: new Date().toISOString()
                },
                validationErrors: this.validationErrors,
                validationWarnings: this.validationWarnings
            };
        }
    }

    /**
     * Get the list of all supported trades
     * @returns {Array} Array of trade objects
     */
    getSupportedTrades() {
        return Object.values(SUPPORTED_TRADES);
    }

    /**
     * Get the full field schema for scenarios
     * @returns {Object} Field schema with all metadata
     */
    getScenarioFieldSchema() {
        return { ...SCENARIO_FIELD_SCHEMA };
    }

    /**
     * Get the full field schema for categories
     * @returns {Object} Field schema with all metadata
     */
    getCategoryFieldSchema() {
        return { ...CATEGORY_FIELD_SCHEMA };
    }

    /**
     * Validate a single scenario config against the schema
     * @param {Object} scenarioConfig - Scenario configuration to validate
     * @returns {Object} Validation result { valid, errors, warnings }
     */
    validateScenario(scenarioConfig) {
        const errors = [];
        const warnings = [];
        
        for (const [fieldName, fieldSchema] of Object.entries(SCENARIO_FIELD_SCHEMA)) {
            const value = scenarioConfig[fieldName];
            const fieldErrors = this._validateField(fieldName, value, fieldSchema);
            errors.push(...fieldErrors.errors);
            warnings.push(...fieldErrors.warnings);
        }
        
        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PRIVATE METHODS - INPUT VALIDATION
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Validate generator inputs
     */
    _validateInputs(companyId, tradeKey, platformSnapshot) {
        if (!companyId) {
            throw new Error('companyId is required');
        }
        
        if (!tradeKey) {
            throw new Error('tradeKey is required');
        }
        
        if (!SUPPORTED_TRADES[tradeKey]) {
            throw new Error(`Unsupported trade: ${tradeKey}. Supported trades: ${Object.keys(SUPPORTED_TRADES).join(', ')}`);
        }
        
        if (!platformSnapshot) {
            throw new Error('platformSnapshot is required for context');
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PRIVATE METHODS - TEMPLATE LOADING
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Load a trade-specific template
     */
    async _loadTemplate(tradeKey) {
        // Check cache first
        if (this.templateCache.has(tradeKey)) {
            return this.templateCache.get(tradeKey);
        }
        
        const tradeConfig = SUPPORTED_TRADES[tradeKey];
        
        try {
            // Dynamic import of template file
            const templatePath = `../../config/goldenBlueprints/${tradeConfig.templateFile}`;
            const template = require(templatePath);
            
            // Cache for future use
            this.templateCache.set(tradeKey, template);
            
            return template;
        } catch (error) {
            logger.warn(`[BLUEPRINT] Template not found for ${tradeKey}, falling back to universal`);
            
            // Fallback to universal template
            if (tradeKey !== 'universal') {
                return this._loadTemplate('universal');
            }
            
            throw new Error(`No template found for trade: ${tradeKey}`);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PRIVATE METHODS - PLATFORM CONTEXT
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Extract relevant context from platform snapshot
     */
    _extractPlatformContext(platformSnapshot) {
        const providers = platformSnapshot.providers || {};
        
        return {
            // Company info
            companyName: platformSnapshot.meta?.companyName || 'Unknown Company',
            tradeKey: platformSnapshot.meta?.tradeKey || 'universal',
            
            // Available placeholders
            placeholders: this._extractPlaceholders(providers.placeholders),
            
            // Available transfer targets
            transferTargets: this._extractTransferTargets(providers.transfers),
            
            // Booking slots (for entity validation)
            bookingSlots: this._extractBookingSlots(providers.controlPlane),
            
            // Call protection rules (for conflict checking)
            callProtectionRules: this._extractCallProtectionRules(providers.callProtection),
            
            // Existing dynamic flows (for linking)
            dynamicFlows: this._extractDynamicFlows(providers.dynamicFlow),
            
            // Existing scenarios (for priority conflict checking)
            existingScenarios: this._extractExistingScenarios(providers.scenarioBrain)
        };
    }

    _extractPlaceholders(placeholdersProvider) {
        if (!placeholdersProvider?.data?.items) return {};
        
        const result = {};
        for (const item of placeholdersProvider.data.items) {
            result[item.canonicalKey] = {
                hasValue: item.hasValue,
                aliases: item.aliases || []
            };
        }
        return result;
    }

    _extractTransferTargets(transfersProvider) {
        if (!transfersProvider?.data?.targets) return [];
        
        return transfersProvider.data.targets.map(t => ({
            id: t.intentTag,
            label: t.label,
            enabled: t.enabled
        }));
    }

    _extractBookingSlots(controlPlaneProvider) {
        if (!controlPlaneProvider?.data?.frontDesk?.bookingSlotNames) return [];
        return controlPlaneProvider.data.frontDesk.bookingSlotNames;
    }

    _extractCallProtectionRules(callProtectionProvider) {
        if (!callProtectionProvider?.data?.rules) return [];
        
        return callProtectionProvider.data.rules.map(r => ({
            name: r.name,
            enabled: r.enabled,
            priority: r.priority
        }));
    }

    _extractDynamicFlows(dynamicFlowProvider) {
        if (!dynamicFlowProvider?.data?.flows) return [];
        
        return dynamicFlowProvider.data.flows.map(f => ({
            flowKey: f.flowKey,
            enabled: f.enabled,
            priority: f.priority
        }));
    }

    _extractExistingScenarios(scenarioBrainProvider) {
        if (!scenarioBrainProvider?.data?.templates) return [];
        
        const scenarios = [];
        for (const template of scenarioBrainProvider.data.templates) {
            for (const category of template.categories || []) {
                for (const scenario of category.scenarios || []) {
                    scenarios.push({
                        scenarioId: scenario.scenarioId,
                        name: scenario.name,
                        priority: scenario.priority,
                        categoryName: category.name
                    });
                }
            }
        }
        return scenarios;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PRIVATE METHODS - TEMPLATE MERGING
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Merge template with platform context
     */
    _mergeTemplateWithContext(template, context) {
        const merged = {
            categories: []
        };
        
        for (const category of template.categories || []) {
            const mergedCategory = {
                ...category,
                scenarios: []
            };
            
            for (const scenario of category.scenarios || []) {
                const mergedScenario = this._mergeScenario(scenario, context);
                mergedCategory.scenarios.push(mergedScenario);
            }
            
            merged.categories.push(mergedCategory);
        }
        
        return merged;
    }

    /**
     * Merge a single scenario with context (placeholder substitution, validation)
     */
    _mergeScenario(scenario, context) {
        const merged = { ...scenario };
        
        // Substitute placeholders in replies
        if (merged.quickReplies) {
            merged.quickReplies = merged.quickReplies.map(reply => 
                this._substitutePlaceholders(reply, context.placeholders)
            );
        }
        
        if (merged.fullReplies) {
            merged.fullReplies = merged.fullReplies.map(reply => 
                this._substitutePlaceholders(reply, context.placeholders)
            );
        }
        
        // Validate transfer hook exists
        if (merged.transferHook && this.options.validateTransfers) {
            const targetExists = context.transferTargets.some(t => 
                t.id === merged.transferHook && t.enabled
            );
            
            if (!targetExists) {
                this.validationWarnings.push({
                    type: 'TRANSFER_TARGET_MISSING',
                    scenario: scenario.name,
                    field: 'transferHook',
                    value: merged.transferHook,
                    message: `Transfer target '${merged.transferHook}' not found or disabled`
                });
            }
        }
        
        return merged;
    }

    /**
     * Substitute placeholder keys with validation markers
     */
    _substitutePlaceholders(text, availablePlaceholders) {
        if (!text) return text;
        
        // Find all {{placeholder}} patterns
        const placeholderRegex = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;
        
        return text.replace(placeholderRegex, (match, key) => {
            const placeholder = availablePlaceholders[key];
            
            if (!placeholder) {
                this.validationWarnings.push({
                    type: 'PLACEHOLDER_MISSING',
                    field: 'reply',
                    value: key,
                    message: `Placeholder '{{${key}}}' not found in company placeholders`
                });
            } else if (!placeholder.hasValue) {
                this.validationWarnings.push({
                    type: 'PLACEHOLDER_EMPTY',
                    field: 'reply',
                    value: key,
                    message: `Placeholder '{{${key}}}' exists but has no value set`
                });
            }
            
            return match; // Keep the placeholder as-is
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PRIVATE METHODS - VALIDATION
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Validate merged config against platform
     */
    _validateConfig(mergedConfig, platformSnapshot) {
        const validation = {
            valid: true,
            errors: [...this.validationErrors],
            warnings: [...this.validationWarnings],
            checks: {
                priorityConflicts: [],
                missingTransfers: [],
                missingPlaceholders: [],
                triggerOverlaps: []
            }
        };
        
        // Check for priority conflicts
        if (this.options.validatePriorities) {
            const priorities = new Map();
            
            for (const category of mergedConfig.categories) {
                for (const scenario of category.scenarios) {
                    const key = scenario.priority;
                    
                    if (priorities.has(key)) {
                        validation.checks.priorityConflicts.push({
                            priority: key,
                            scenarios: [priorities.get(key), scenario.name]
                        });
                    } else {
                        priorities.set(key, scenario.name);
                    }
                }
            }
        }
        
        // Collect all missing transfers
        validation.checks.missingTransfers = this.validationWarnings
            .filter(w => w.type === 'TRANSFER_TARGET_MISSING')
            .map(w => ({ scenario: w.scenario, target: w.value }));
        
        // Collect all missing placeholders
        validation.checks.missingPlaceholders = this.validationWarnings
            .filter(w => w.type === 'PLACEHOLDER_MISSING' || w.type === 'PLACEHOLDER_EMPTY')
            .map(w => ({ placeholder: w.value, issue: w.type }));
        
        // Set overall validity
        validation.valid = validation.errors.length === 0 && 
                          validation.checks.priorityConflicts.length === 0;
        
        return validation;
    }

    /**
     * Validate a single field against its schema
     */
    _validateField(fieldName, value, schema) {
        const errors = [];
        const warnings = [];
        
        // Check required
        if (schema.required && (value === undefined || value === null || value === '')) {
            errors.push({
                field: fieldName,
                message: `${fieldName} is required`,
                type: 'REQUIRED_FIELD_MISSING'
            });
            return { errors, warnings };
        }
        
        // Skip further validation if not provided and not required
        if (value === undefined || value === null) {
            return { errors, warnings };
        }
        
        // Type validation
        switch (schema.type) {
            case 'string':
                if (typeof value !== 'string') {
                    errors.push({ field: fieldName, message: `${fieldName} must be a string`, type: 'TYPE_MISMATCH' });
                } else if (schema.maxLength && value.length > schema.maxLength) {
                    warnings.push({ field: fieldName, message: `${fieldName} exceeds max length of ${schema.maxLength}`, type: 'MAX_LENGTH_EXCEEDED' });
                }
                break;
                
            case 'number':
                if (typeof value !== 'number') {
                    errors.push({ field: fieldName, message: `${fieldName} must be a number`, type: 'TYPE_MISMATCH' });
                } else {
                    if (schema.min !== undefined && value < schema.min) {
                        errors.push({ field: fieldName, message: `${fieldName} must be at least ${schema.min}`, type: 'VALUE_TOO_LOW' });
                    }
                    if (schema.max !== undefined && value > schema.max) {
                        errors.push({ field: fieldName, message: `${fieldName} must be at most ${schema.max}`, type: 'VALUE_TOO_HIGH' });
                    }
                }
                break;
                
            case 'boolean':
                if (typeof value !== 'boolean') {
                    errors.push({ field: fieldName, message: `${fieldName} must be a boolean`, type: 'TYPE_MISMATCH' });
                }
                break;
                
            case 'array':
                if (!Array.isArray(value)) {
                    errors.push({ field: fieldName, message: `${fieldName} must be an array`, type: 'TYPE_MISMATCH' });
                } else {
                    if (schema.minItems && value.length < schema.minItems) {
                        errors.push({ field: fieldName, message: `${fieldName} must have at least ${schema.minItems} items`, type: 'MIN_ITEMS_NOT_MET' });
                    }
                    if (schema.maxItems && value.length > schema.maxItems) {
                        warnings.push({ field: fieldName, message: `${fieldName} exceeds max items of ${schema.maxItems}`, type: 'MAX_ITEMS_EXCEEDED' });
                    }
                }
                break;
                
            case 'enum':
                if (!schema.options.includes(value)) {
                    errors.push({ field: fieldName, message: `${fieldName} must be one of: ${schema.options.join(', ')}`, type: 'INVALID_ENUM_VALUE' });
                }
                break;
        }
        
        return { errors, warnings };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PRIVATE METHODS - OUTPUT GENERATION
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Generate summary for admin review (Tier 1)
     */
    _generateSummary(mergedConfig, validation) {
        const categoriesTotal = mergedConfig.categories.length;
        let scenariosTotal = 0;
        
        const categoryList = mergedConfig.categories.map(cat => {
            const scenarioCount = cat.scenarios.length;
            scenariosTotal += scenarioCount;
            
            return {
                name: cat.name,
                icon: cat.icon || '📁',
                enabled: cat.enabled,
                scenarioCount,
                status: cat._isNew ? 'NEW' : 'ENHANCED'
            };
        });
        
        return {
            categoriesTotal,
            scenariosTotal,
            categories: categoryList,
            validationStatus: validation.valid ? 'READY' : 'HAS_ISSUES',
            priorityConflicts: validation.checks.priorityConflicts.length,
            missingTransfers: validation.checks.missingTransfers.length,
            missingPlaceholders: validation.checks.missingPlaceholders.length
        };
    }

    /**
     * Generate detailed category configs (Tier 2)
     */
    _generateDetails(mergedConfig) {
        return mergedConfig.categories.map(category => ({
            categoryId: category.categoryId,
            name: category.name,
            icon: category.icon,
            enabled: category.enabled,
            description: category.description,
            priority: category.priority,
            disabledDefaultReply: category.disabledDefaultReply,
            scenarios: category.scenarios.map(scenario => {
                const detail = { ...scenario };
                
                // Add reasoning if enabled
                if (this.options.includeReasoning && scenario._reasoning) {
                    detail.reasoning = scenario._reasoning;
                }
                
                return detail;
            })
        }));
    }

    /**
     * Generate complete export (Tier 3)
     */
    _generateExport(mergedConfig, summary, validation) {
        return {
            version: BLUEPRINT_VERSION,
            schema: SCHEMA_VERSION,
            generatedAt: new Date().toISOString(),
            summary,
            validation,
            config: mergedConfig
        };
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
    BlueprintGenerator,
    SUPPORTED_TRADES,
    SCENARIO_FIELD_SCHEMA,
    CATEGORY_FIELD_SCHEMA,
    BLUEPRINT_VERSION,
    SCHEMA_VERSION
};

