/**
 * ============================================================================
 * SCENARIO SETTINGS CATALOG - All 22+ Settings and Wiring Status
 * ============================================================================
 * 
 * PURPOSE: Single source of truth for ALL scenario settings
 * 
 * This catalog answers:
 *   1. What settings exist? (from schema)
 *   2. Is it wired at runtime? (actually used in code)
 *   3. Where is it wired? (file + function)
 *   4. When was it last verified? 
 * 
 * STATUS CODES:
 *   ✅ WIRED - Runtime actually reads and uses this setting
 *   🟠 PARTIAL - Runtime reads but doesn't fully use
 *   🟣 SCHEMA_ONLY - Exists in schema, NOT wired at runtime
 *   🔴 DEPRECATED - Use alternative field
 * 
 * ============================================================================
 */

const SCENARIO_SETTINGS_CATALOG = {
    version: 'V92',
    lastAudit: '2026-02-01',
    totalSettings: 60,
    wiredCount: 25, // Updated after V92 fixes
    
    // ========================================================================
    // DATA FLOW: How settings get from Blueprint/Config to Runtime
    // ========================================================================
    dataFlow: {
        description: 'Settings must survive this path to be used at runtime',
        steps: [
            '1. UI/Blueprint → Template config (GlobalInstantResponseTemplate)',
            '2. Company selects templates → aiAgentSettings.templateReferences',
            '3. ScenarioPoolService.getScenarioPoolForCompany() → loads scenarios',
            '4. ScenarioRuntimeCompiler.compileScenario() → creates runtime spec',
            '5. HybridScenarioSelector → uses compiled spec for matching'
        ],
        critical: 'If a setting is not compiled in step 4, it is INVISIBLE at runtime!'
    },
    
    // ========================================================================
    // IDENTITY & LIFECYCLE
    // ========================================================================
    identity: {
        scenarioId: {
            status: 'WIRED',
            wiredTo: ['HybridScenarioSelector.js', 'ScenarioPoolService.js'],
            description: 'Unique identifier for scenario',
            required: true
        },
        version: {
            status: 'WIRED',
            wiredTo: ['ScenarioPoolService.js'],
            description: 'Version number for rollback support'
        },
        status: {
            status: 'WIRED',
            wiredTo: ['HybridScenarioSelector.js'],
            description: 'draft | live | archived',
            values: ['draft', 'live', 'archived']
        },
        name: {
            status: 'WIRED',
            wiredTo: ['HybridScenarioSelector.js', 'ResponseEngine.js'],
            description: 'Human-readable scenario name',
            required: true
        },
        isActive: {
            status: 'WIRED',
            wiredTo: ['HybridScenarioSelector.js'],
            description: 'Quick on/off toggle'
        }
    },
    
    // ========================================================================
    // CATEGORIZATION & ORGANIZATION
    // ========================================================================
    categorization: {
        categories: {
            status: 'WIRED',
            wiredTo: ['ScenarioPoolService.js', 'HybridScenarioSelector.js'],
            description: 'Many-to-many category membership'
        },
        priority: {
            status: 'WIRED',
            wiredTo: ['HybridScenarioSelector.js'],
            description: 'Tie-breaker when multiple scenarios match',
            range: [-10, 100],
            examples: { emergency: 100, neutral: 0, smalltalk: -5 }
        },
        cooldownSeconds: {
            status: 'PARTIAL',
            wiredTo: ['ScenarioRuntimeCompiler.js'],
            description: 'Prevents scenario from firing again within N seconds',
            note: 'Compiled but enforcement unclear'
        }
    },
    
    // ========================================================================
    // MULTILINGUAL & CHANNEL
    // ========================================================================
    multilingual: {
        language: {
            status: 'SCHEMA_ONLY',
            wiredTo: [],
            description: 'auto | en | es | fr etc.',
            todo: 'Wire to language detection in ConversationEngine'
        },
        channel: {
            status: 'SCHEMA_ONLY',
            wiredTo: [],
            description: 'voice | sms | chat | any',
            todo: 'Wire to channel-specific routing'
        }
    },
    
    // ========================================================================
    // HYBRID MATCHING - THE INTELLIGENCE CORE
    // ========================================================================
    matching: {
        triggers: {
            status: 'WIRED',
            wiredTo: ['HybridScenarioSelector.js:calculateScenarioScore', 'HybridScenarioSelector.js:calculateBM25Score'],
            description: 'Plain phrases for BM25 keyword matching',
            required: true,
            example: ['no heat', 'heater not working', 'furnace not working']
        },
        regexTriggers: {
            status: 'WIRED',
            wiredTo: ['HybridScenarioSelector.js:calculateRegexScore'],
            description: 'Advanced regex pattern matching',
            example: ['\\b(no|won\'t)\\s+(get|have)\\s+(heat|warm)']
        },
        negativeTriggers: {
            status: 'WIRED',
            wiredTo: ['HybridScenarioSelector.js'],
            description: 'Phrases that PREVENT matching',
            example: ['don\'t need heat', 'cancel heating']
        },
        keywords: {
            status: 'WIRED',
            wiredTo: ['ScenarioRuntimeCompiler.js', 'HybridScenarioSelector.js:calculateScenarioScore'],
            description: 'Fast Tier-1 matching keywords (V92 fix)',
            wiredInVersion: 'V92',
            compiledPath: 'spec.triggers.keywords',
            example: ['heat', 'furnace', 'cold', 'freezing']
        },
        negativeKeywords: {
            status: 'WIRED',
            wiredTo: ['ScenarioRuntimeCompiler.js', 'HybridScenarioSelector.js'],
            description: 'Keywords that PREVENT matching (V92 fix)',
            wiredInVersion: 'V92',
            compiledPath: 'spec.triggers.negativeKeywords',
            example: ['cancel', 'summer', 'too much']
        },
        contextWeight: {
            status: 'WIRED',
            wiredTo: ['ScenarioRuntimeCompiler.js', 'HybridScenarioSelector.js'],
            description: 'Multiplier on final match score (V92 fix)',
            wiredInVersion: 'V92',
            compiledPath: 'spec.contextWeight',
            range: [0, 1],
            examples: { emergency: 0.95, chitchat: 0.5, neutral: 0.7 }
        },
        minConfidence: {
            status: 'WIRED',
            wiredTo: ['IntelligentRouter.js', 'ScenarioRuntimeCompiler.js'],
            description: 'Scenario-level confidence threshold override',
            range: [0, 1]
        },
        embeddingVector: {
            status: 'SCHEMA_ONLY',
            wiredTo: [],
            description: 'Precomputed semantic embedding for triggers',
            todo: 'Wire to sentence-transformers for true semantic matching'
        }
    },
    
    // ========================================================================
    // STATE MACHINE & CONVERSATION FLOW
    // ========================================================================
    stateMachine: {
        preconditions: {
            status: 'PARTIAL',
            wiredTo: ['ScenarioRuntimeCompiler.js'],
            description: 'Conditions that must be met for scenario to match',
            note: 'Compiled but enforcement unclear',
            example: { state: 'collecting_phone', hasEntity: ['name'] }
        },
        effects: {
            status: 'PARTIAL',
            wiredTo: ['ScenarioRuntimeCompiler.js'],
            description: 'State changes to apply after scenario executes',
            note: 'Compiled but enforcement unclear',
            example: { setState: 'confirming', increment: { holdCount: 1 } }
        }
    },
    
    // ========================================================================
    // ENHANCED USER PHRASE TRIGGERS
    // ========================================================================
    enhancedTriggers: {
        exampleUserPhrases: {
            status: 'SCHEMA_ONLY',
            wiredTo: [],
            description: '12-18 example phrases users say (for ML training)',
            todo: 'Wire to embedding generation + training pipeline'
        },
        negativeUserPhrases: {
            status: 'SCHEMA_ONLY',
            wiredTo: [],
            description: 'Phrases that PREVENT matching (for ML training)',
            todo: 'Wire to ML training pipeline'
        }
    },
    
    // ========================================================================
    // WEIGHTED REPLIES
    // ========================================================================
    replies: {
        quickReplies: {
            status: 'WIRED',
            wiredTo: ['ResponseEngine.js', 'LLMDiscoveryEngine.js', 'ScenarioPoolService.js'],
            description: 'Short responses for voice (10-30 words)',
            minItems: 7,
            recommended: '7-10'
        },
        fullReplies: {
            status: 'WIRED',
            wiredTo: ['ResponseEngine.js', 'LLMDiscoveryEngine.js', 'ScenarioPoolService.js'],
            description: 'Long responses for SMS/chat (50-150 words)',
            minItems: 7,
            recommended: '7-10'
        },
        followUpPrompts: {
            status: 'PARTIAL',
            wiredTo: ['ScenarioPoolService.js'],
            description: 'Follow-up questions after initial response',
            note: 'Stored but may not be selected at runtime'
        },
        followUpFunnel: {
            status: 'WIRED',
            wiredTo: ['ScenarioRuntimeCompiler.js'],
            description: 'Re-engagement prompt to guide back to call purpose'
        },
        replySelection: {
            status: 'SCHEMA_ONLY',
            wiredTo: [],
            description: 'sequential | random | bandit',
            todo: 'Wire to ResponseEngine for intelligent reply selection'
        }
    },
    
    // ========================================================================
    // SCENARIO SEMANTICS & REPLY STRATEGY
    // ========================================================================
    semantics: {
        scenarioType: {
            status: 'WIRED',
            wiredTo: ['ScenarioRuntimeCompiler.js', 'IntelligentRouter.js', 'LLMDiscoveryEngine.js'],
            description: 'EMERGENCY | BOOKING | FAQ | TROUBLESHOOT | BILLING | TRANSFER | SMALL_TALK | SYSTEM',
            values: ['EMERGENCY', 'BOOKING', 'FAQ', 'TROUBLESHOOT', 'BILLING', 'TRANSFER', 'SMALL_TALK', 'SYSTEM']
        },
        replyStrategy: {
            status: 'WIRED',
            wiredTo: ['ResponseEngine.js', 'ScenarioRuntimeCompiler.js'],
            description: 'AUTO | FULL_ONLY | QUICK_ONLY | QUICK_THEN_FULL | LLM_WRAP | LLM_CONTEXT',
            values: ['AUTO', 'FULL_ONLY', 'QUICK_ONLY', 'QUICK_THEN_FULL', 'LLM_WRAP', 'LLM_CONTEXT']
        }
    },
    
    // ========================================================================
    // FOLLOW-UP BEHAVIOR
    // ========================================================================
    followUp: {
        followUpMode: {
            status: 'WIRED',
            wiredTo: ['ResponseEngine.js', 'LLMDiscoveryEngine.js', 'ScenarioRuntimeCompiler.js'],
            description: 'NONE | ASK_FOLLOWUP_QUESTION | ASK_IF_BOOK | TRANSFER',
            values: ['NONE', 'ASK_FOLLOWUP_QUESTION', 'ASK_IF_BOOK', 'TRANSFER']
        },
        followUpQuestionText: {
            status: 'WIRED',
            wiredTo: ['ResponseEngine.js', 'ScenarioRuntimeCompiler.js'],
            description: 'Text to ask if followUpMode=ASK_FOLLOWUP_QUESTION'
        },
        transferTarget: {
            status: 'WIRED',
            wiredTo: ['ResponseEngine.js', 'ScenarioRuntimeCompiler.js'],
            description: 'Queue/extension for transfer if followUpMode=TRANSFER'
        }
    },
    
    // ========================================================================
    // ENTITY CAPTURE & DYNAMIC VARIABLES
    // ========================================================================
    entities: {
        entityCapture: {
            status: 'WIRED',
            wiredTo: ['ScenarioRuntimeCompiler.js', 'scenarioGeneration/serviceScenarioGenerator.js'],
            description: 'List of entities to extract from speech',
            example: ['name', 'phone_number', 'address', 'technician']
        },
        entityValidation: {
            status: 'PARTIAL',
            wiredTo: ['ScenarioRuntimeCompiler.js'],
            description: 'Validation rules per entity',
            note: 'Stored but enforcement unclear'
        },
        dynamicVariables: {
            status: 'PARTIAL',
            wiredTo: ['ScenarioRuntimeCompiler.js'],
            description: 'Variable fallbacks when entity missing',
            note: 'Stored but enforcement unclear'
        }
    },
    
    // ========================================================================
    // ACTION HOOKS & INTEGRATIONS
    // ========================================================================
    actions: {
        actionHooks: {
            status: 'WIRED',
            wiredTo: ['ScenarioRuntimeCompiler.js'],
            description: 'References to GlobalActionHook hookIds',
            example: ['escalate_to_human', 'log_sentiment_positive']
        },
        handoffPolicy: {
            status: 'SCHEMA_ONLY',
            wiredTo: [],
            description: 'never | low_confidence | always_on_keyword',
            todo: 'Wire to escalation logic in ConversationEngine'
        }
    },
    
    // ========================================================================
    // SENSITIVE DATA & SAFETY
    // ========================================================================
    safety: {
        sensitiveInfoRule: {
            status: 'SCHEMA_ONLY',
            wiredTo: [],
            description: 'platform_default | custom',
            todo: 'Wire to SensitiveMasker'
        },
        customMasking: {
            status: 'SCHEMA_ONLY',
            wiredTo: [],
            description: 'Per-entity masking overrides',
            todo: 'Wire to SensitiveMasker'
        }
    },
    
    // ========================================================================
    // TIMING & HOLD BEHAVIOR
    // ========================================================================
    timing: {
        timedFollowUp: {
            status: 'SCHEMA_ONLY',
            wiredTo: [],
            description: 'Timer-based check-in during holds',
            fields: ['enabled', 'delaySeconds', 'messages', 'extensionSeconds'],
            todo: 'Wire to hold management in ConversationEngine'
        },
        silencePolicy: {
            status: 'SCHEMA_ONLY',
            wiredTo: [],
            description: 'How to handle caller silence',
            fields: ['maxConsecutive', 'finalWarning'],
            todo: 'Wire to silence handler (currently uses company-level settings)'
        }
    },
    
    // ========================================================================
    // AI INTELLIGENCE & LEARNING
    // ========================================================================
    intelligence: {
        qnaPairs: {
            status: 'SCHEMA_ONLY',
            wiredTo: [],
            description: 'Training data for semantic matching',
            todo: 'Wire to embedding-based semantic matching'
        },
        testPhrases: {
            status: 'SCHEMA_ONLY',
            wiredTo: [],
            description: 'Validation test cases',
            todo: 'Wire to scenario validation/audit system'
        },
        examples: {
            status: 'SCHEMA_ONLY',
            wiredTo: [],
            description: 'Sample conversations showing expected flow',
            todo: 'Wire to training/few-shot prompting'
        },
        escalationFlags: {
            status: 'SCHEMA_ONLY',
            wiredTo: [],
            description: 'Sentiment/situation flags that trigger escalation',
            example: ['angry', 'confused', 'vip_customer', 'urgent'],
            todo: 'Wire to escalation logic'
        }
    },
    
    // ========================================================================
    // VOICE & TTS CONTROL
    // ========================================================================
    voice: {
        behavior: {
            status: 'WIRED',
            wiredTo: ['ScenarioRuntimeCompiler.js'],
            description: 'References GlobalAIBehaviorTemplate.behaviorId'
        },
        toneLevel: {
            status: 'DEPRECATED',
            wiredTo: [],
            description: 'Use behavior field instead',
            replacement: 'behavior'
        },
        ttsOverride: {
            status: 'PARTIAL',
            wiredTo: ['ScenarioRuntimeCompiler.js'],
            description: 'pitch, rate, volume overrides',
            note: 'Compiled but may not reach TTS engine'
        }
    },
    
    // ========================================================================
    // METADATA & AUDIT
    // ========================================================================
    metadata: {
        notes: {
            status: 'WIRED',
            wiredTo: ['ScenarioPoolService.js'],
            description: 'Internal notes for admins (NOT used by AI)'
        },
        createdBy: { status: 'WIRED', wiredTo: ['ScenarioPoolService.js'] },
        updatedBy: { status: 'WIRED', wiredTo: ['ScenarioPoolService.js'] },
        createdAt: { status: 'WIRED', wiredTo: ['ScenarioPoolService.js'] },
        updatedAt: { status: 'WIRED', wiredTo: ['ScenarioPoolService.js'] }
    }
};

/**
 * Get summary of wiring status
 */
function getWiringSummary() {
    const summary = {
        wired: [],
        partial: [],
        schemaOnly: [],
        deprecated: []
    };
    
    for (const [section, settings] of Object.entries(SCENARIO_SETTINGS_CATALOG)) {
        if (typeof settings !== 'object' || !settings) continue;
        if (['version', 'lastAudit', 'totalSettings', 'wiredCount'].includes(section)) continue;
        
        for (const [key, config] of Object.entries(settings)) {
            if (!config || typeof config !== 'object') continue;
            
            const item = {
                section,
                setting: key,
                description: config.description || '',
                wiredTo: config.wiredTo || [],
                todo: config.todo || null
            };
            
            switch (config.status) {
                case 'WIRED':
                    summary.wired.push(item);
                    break;
                case 'PARTIAL':
                    summary.partial.push(item);
                    break;
                case 'SCHEMA_ONLY':
                    summary.schemaOnly.push(item);
                    break;
                case 'DEPRECATED':
                    summary.deprecated.push(item);
                    break;
            }
        }
    }
    
    return {
        ...summary,
        counts: {
            wired: summary.wired.length,
            partial: summary.partial.length,
            schemaOnly: summary.schemaOnly.length,
            deprecated: summary.deprecated.length,
            total: summary.wired.length + summary.partial.length + summary.schemaOnly.length + summary.deprecated.length
        }
    };
}

/**
 * Get settings that need to be wired (priority TODO list)
 */
function getUnwiredSettings() {
    const summary = getWiringSummary();
    return {
        priority: [
            // Most impactful settings to wire next
            summary.schemaOnly.find(s => s.setting === 'qnaPairs'),
            summary.schemaOnly.find(s => s.setting === 'escalationFlags'),
            summary.schemaOnly.find(s => s.setting === 'silencePolicy'),
            summary.schemaOnly.find(s => s.setting === 'replySelection'),
            summary.schemaOnly.find(s => s.setting === 'handoffPolicy')
        ].filter(Boolean),
        all: summary.schemaOnly,
        partial: summary.partial
    };
}

module.exports = {
    SCENARIO_SETTINGS_CATALOG,
    getWiringSummary,
    getUnwiredSettings
};
