/**
 * ScenarioRuntimeCompiler.js
 * 
 * Compiles raw scenario JSON into runtime-ready specs.
 * This is the "compilation" step that eliminates per-turn parsing.
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 * PHILOSOPHY:
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * "Use all settings by design, but don't compute all settings by default."
 * 
 * We pre-compute:
 * - Normalized triggers (lowercased, trimmed)
 * - Trigger index entries
 * - "needs" flags for conditional settings
 * - Pre-validated structure
 * 
 * At runtime, we just EXECUTE - no parsing, no validation, no interpretation.
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 * TIERED SETTINGS BUDGET:
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Tier 0 (always applied):
 *   - reply selection (quick/full)
 *   - placeholder rendering ({name})
 *   - structure enforcement
 * 
 * Tier 1 (only if flagged):
 *   - preconditions
 *   - entity validation
 *   - ttsOverride
 *   - timedFollowUp
 *   - _noName variants
 * 
 * Tier 2 (only if triggered):
 *   - actionHooks
 *   - effects
 *   - dynamicVariables
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const logger = require('../utils/logger');

/**
 * Compile a raw scenario into a runtime-ready spec
 * 
 * @param {Object} scenario - Raw scenario from database
 * @param {Object} options - Compilation options
 * @returns {Object} ScenarioRuntimeSpec
 */
function compileScenario(scenario, options = {}) {
    const startTime = Date.now();
    const { templateId, categoryName } = options;
    
    // ========================================================================
    // IDENTITY (always present)
    // ========================================================================
    const spec = {
        // Identity
        id: scenario.scenarioId || scenario._id?.toString() || `scenario_${Date.now()}`,
        name: scenario.name || 'Unnamed Scenario',
        templateId,
        categoryName,
        
        // Status (pre-validated)
        isActive: scenario.isActive !== false && scenario.status === 'live',
        status: scenario.status || 'draft',
        
        // Type & Priority (pre-validated)
        scenarioType: normalizeScenarioType(scenario.scenarioType),
        priority: typeof scenario.priority === 'number' ? scenario.priority : 50,
        minConfidence: typeof scenario.minConfidence === 'number' ? scenario.minConfidence : 0.6,
        cooldownSeconds: typeof scenario.cooldownSeconds === 'number' ? scenario.cooldownSeconds : 0,
        
        // ====================================================================
        // PRE-NORMALIZED TRIGGERS (for fast matching)
        // ====================================================================
        triggers: {
            // Original triggers (for display/debugging)
            original: scenario.triggers || [],
            
            // Normalized triggers (lowercased, trimmed) for matching
            normalized: (scenario.triggers || [])
                .filter(t => t && typeof t === 'string')
                .map(t => t.toLowerCase().trim())
                .filter(t => t.length >= 2),
            
            // Regex triggers (pre-compiled where safe)
            regex: compileRegexTriggers(scenario.regexTriggers || []),
            
            // Negative triggers (pre-normalized)
            negative: (scenario.negativeTriggers || [])
                .filter(t => t && typeof t === 'string')
                .map(t => t.toLowerCase().trim()),
            
            // Example phrases (for Tier-3 context)
            examples: scenario.exampleUserPhrases || [],
            negativeExamples: scenario.negativeUserPhrases || []
        },
        
        // ====================================================================
        // REPLIES (pre-validated arrays)
        // ====================================================================
        replies: {
            quick: normalizeReplies(scenario.quickReplies),
            full: normalizeReplies(scenario.fullReplies),
            quickNoName: normalizeReplies(scenario.quickReplies_noName),
            fullNoName: normalizeReplies(scenario.fullReplies_noName),
            strategy: scenario.replyStrategy || 'AUTO'
        },
        
        // ====================================================================
        // FOLLOW-UP (pre-validated)
        // ====================================================================
        followUp: {
            mode: scenario.followUpMode || 'NONE',
            questionText: scenario.followUpQuestionText || null,
            funnel: scenario.followUpFunnel || null,
            transferTarget: scenario.transferTarget || null
        },
        
        // ====================================================================
        // WIRING (pre-validated)
        // ====================================================================
        wiring: {
            actionType: scenario.actionType || 'REPLY_ONLY',
            flowId: scenario.flowId || null,
            bookingIntent: scenario.bookingIntent === true,
            requiredSlots: scenario.requiredSlots || [],
            stopRouting: scenario.stopRouting === true
        },
        
        // ====================================================================
        // BEHAVIOR (pre-validated)
        // ====================================================================
        behavior: scenario.behavior || 'calm_professional',
        channel: scenario.channel || 'any',
        handoffPolicy: scenario.handoffPolicy || 'low_confidence',
        
        // ====================================================================
        // 🎯 "NEEDS" FLAGS - The tiered settings budget
        // ====================================================================
        // These flags tell runtime which expensive operations to skip
        needs: {
            // Tier 1 flags
            nameVariant: hasNamePlaceholder(scenario),
            ttsOverride: !!(scenario.ttsOverride && Object.keys(scenario.ttsOverride).length > 0),
            timedFollowUp: !!(scenario.timedFollowUp && scenario.timedFollowUp.enabled),
            silencePolicy: !!(scenario.silencePolicy && scenario.silencePolicy.enabled),
            entityValidation: !!(scenario.entityValidation && Object.keys(scenario.entityValidation).length > 0),
            preconditions: !!(scenario.preconditions && scenario.preconditions.length > 0),
            
            // Tier 2 flags
            actionHooks: !!(scenario.actionHooks && scenario.actionHooks.length > 0),
            effects: !!(scenario.effects && scenario.effects.length > 0),
            dynamicVariables: !!(scenario.dynamicVariables && Object.keys(scenario.dynamicVariables).length > 0),
            entityCapture: !!(scenario.entityCapture && scenario.entityCapture.length > 0),
            
            // LLM flags
            llmRewrite: scenario.replyStrategy === 'LLM_WRAP' || scenario.replyStrategy === 'LLM_CONTEXT'
        },
        
        // ====================================================================
        // RAW DATA (for Tier 2 settings when needed)
        // ====================================================================
        raw: {
            preconditions: scenario.preconditions || [],
            entityCapture: scenario.entityCapture || [],
            entityValidation: scenario.entityValidation || {},
            dynamicVariables: scenario.dynamicVariables || {},
            actionHooks: scenario.actionHooks || [],
            effects: scenario.effects || [],
            ttsOverride: scenario.ttsOverride || {},
            timedFollowUp: scenario.timedFollowUp || {},
            silencePolicy: scenario.silencePolicy || {}
        },
        
        // ====================================================================
        // METADATA
        // ====================================================================
        meta: {
            compiledAt: Date.now(),
            compileTimeMs: 0, // Set below
            triggerCount: (scenario.triggers || []).length,
            replyCount: (scenario.quickReplies || []).length + (scenario.fullReplies || []).length,
            hasNoNameVariants: !!(scenario.quickReplies_noName?.length || scenario.fullReplies_noName?.length)
        }
    };
    
    spec.meta.compileTimeMs = Date.now() - startTime;
    
    return spec;
}

/**
 * Compile multiple scenarios and build trigger index
 * 
 * @param {Array} scenarios - Raw scenarios
 * @param {Object} options - Compilation options
 * @returns {Object} { specs, triggerIndex, stats }
 */
function compileScenarioPool(scenarios, options = {}) {
    const startTime = Date.now();
    const { templateId } = options;
    
    const specs = [];
    const triggerIndex = new Map(); // trigger -> [scenarioSpec, ...]
    const exactIndex = new Map();   // exact trigger -> scenarioSpec
    
    let activeCount = 0;
    let totalTriggers = 0;
    let totalReplies = 0;
    
    for (const scenario of scenarios) {
        const spec = compileScenario(scenario, { templateId });
        
        if (!spec.isActive) continue;
        
        specs.push(spec);
        activeCount++;
        totalTriggers += spec.triggers.normalized.length;
        totalReplies += spec.meta.replyCount;
        
        // Build trigger index (O(1) lookup instead of linear scan)
        for (const trigger of spec.triggers.normalized) {
            // Exact match index
            if (!exactIndex.has(trigger)) {
                exactIndex.set(trigger, spec);
            }
            
            // Multi-match index (for scoring)
            if (!triggerIndex.has(trigger)) {
                triggerIndex.set(trigger, []);
            }
            triggerIndex.get(trigger).push(spec);
            
            // Also index individual words for partial matching
            const words = trigger.split(/\s+/).filter(w => w.length >= 3);
            for (const word of words) {
                const key = `word:${word}`;
                if (!triggerIndex.has(key)) {
                    triggerIndex.set(key, []);
                }
                // Avoid duplicates
                const existing = triggerIndex.get(key);
                if (!existing.includes(spec)) {
                    existing.push(spec);
                }
            }
        }
    }
    
    const compileTimeMs = Date.now() - startTime;
    
    logger.info('[COMPILER] Scenario pool compiled', {
        templateId,
        totalScenarios: scenarios.length,
        activeScenarios: activeCount,
        totalTriggers,
        totalReplies,
        indexSize: triggerIndex.size,
        exactIndexSize: exactIndex.size,
        compileTimeMs
    });
    
    return {
        specs,
        triggerIndex,
        exactIndex,
        stats: {
            totalScenarios: scenarios.length,
            activeScenarios: activeCount,
            totalTriggers,
            totalReplies,
            indexSize: triggerIndex.size,
            compileTimeMs
        }
    };
}

/**
 * Fast candidate lookup using trigger index
 * 
 * @param {string} input - Normalized user input
 * @param {Map} triggerIndex - Pre-built trigger index
 * @param {Map} exactIndex - Pre-built exact match index
 * @returns {Object} { exactMatch, candidates }
 */
function fastCandidateLookup(input, triggerIndex, exactIndex) {
    const normalized = input.toLowerCase().trim();
    
    // 1. Check exact match first (O(1))
    if (exactIndex.has(normalized)) {
        return {
            exactMatch: exactIndex.get(normalized),
            candidates: [exactIndex.get(normalized)],
            method: 'exact'
        };
    }
    
    // 2. Check if input contains any exact trigger
    for (const [trigger, spec] of exactIndex.entries()) {
        if (normalized.includes(trigger) && trigger.length >= 5) {
            return {
                exactMatch: null,
                candidates: [spec],
                method: 'contains'
            };
        }
    }
    
    // 3. Gather candidates by word matching
    const words = normalized.split(/\s+/).filter(w => w.length >= 3);
    const candidateSet = new Set();
    const candidateScores = new Map();
    
    for (const word of words) {
        const key = `word:${word}`;
        const matches = triggerIndex.get(key) || [];
        for (const spec of matches) {
            candidateSet.add(spec);
            candidateScores.set(spec, (candidateScores.get(spec) || 0) + 1);
        }
    }
    
    // Sort by word match count (more matches = better candidate)
    const candidates = Array.from(candidateSet)
        .sort((a, b) => (candidateScores.get(b) || 0) - (candidateScores.get(a) || 0))
        .slice(0, 20); // Limit to top 20 candidates
    
    return {
        exactMatch: null,
        candidates,
        method: 'word_index'
    };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function normalizeScenarioType(type) {
    if (!type) return 'FAQ';
    const upper = type.toUpperCase();
    const valid = ['EMERGENCY', 'BOOKING', 'FAQ', 'TROUBLESHOOT', 'BILLING', 'TRANSFER', 'SMALL_TALK', 'SYSTEM'];
    return valid.includes(upper) ? upper : 'FAQ';
}

function normalizeReplies(replies) {
    if (!Array.isArray(replies)) return [];
    return replies.filter(r => {
        if (typeof r === 'string') return r.trim().length > 0;
        if (typeof r === 'object' && r.text) return r.text.trim().length > 0;
        return false;
    });
}

function compileRegexTriggers(patterns) {
    const compiled = [];
    for (const pattern of patterns) {
        if (!pattern || typeof pattern !== 'string') continue;
        try {
            compiled.push({
                source: pattern,
                regex: new RegExp(pattern, 'i')
            });
        } catch (e) {
            logger.warn('[COMPILER] Invalid regex trigger', { pattern, error: e.message });
        }
    }
    return compiled;
}

function hasNamePlaceholder(scenario) {
    const check = (arr) => {
        if (!Array.isArray(arr)) return false;
        return arr.some(r => {
            const text = typeof r === 'string' ? r : r?.text;
            return text && /\{name\}/i.test(text);
        });
    };
    return check(scenario.quickReplies) || check(scenario.fullReplies);
}

// ============================================================================
// RUNTIME TRACE
// ============================================================================

/**
 * Create a runtime trace for a scenario match
 * 
 * @param {Object} spec - ScenarioRuntimeSpec
 * @param {Object} matchInfo - Match information
 * @param {Object} timings - Timing breakdown
 * @returns {Object} RuntimeTrace
 */
function createRuntimeTrace(spec, matchInfo = {}, timings = {}) {
    return {
        companyId: matchInfo.companyId || null,
        templateId: spec?.templateId || null,
        scenarioIdMatched: spec?.id || null,
        scenarioNameMatched: spec?.name || null,
        
        // Match method
        matchMethod: matchInfo.method || 'unknown',
        matchConfidence: matchInfo.confidence || 0,
        matchTier: matchInfo.tier || 0,
        
        // Reply info
        replyType: matchInfo.replyType || 'quick',
        replyIndex: matchInfo.replyIndex || 0,
        
        // Applied settings (names only for lightweight trace)
        appliedSettings: buildAppliedSettingsList(spec),
        
        // Latency breakdown
        latencyBreakdownMs: {
            match: timings.match || 0,
            render: timings.render || 0,
            tts: timings.tts || 0,
            total: timings.total || 0
        },
        
        // Needs flags that were evaluated
        needsEvaluated: spec?.needs || {},
        
        timestamp: Date.now()
    };
}

/**
 * Build list of settings that were applied (based on needs flags)
 */
function buildAppliedSettingsList(spec) {
    if (!spec) return ['fallback'];
    
    const applied = [
        // Tier 0 (always)
        'replySelection',
        'placeholderRendering',
        'structureEnforcement'
    ];
    
    // Tier 1 (conditional)
    if (spec.needs?.nameVariant) applied.push('nameVariant');
    if (spec.needs?.ttsOverride) applied.push('ttsOverride');
    if (spec.needs?.timedFollowUp) applied.push('timedFollowUp');
    if (spec.needs?.silencePolicy) applied.push('silencePolicy');
    if (spec.needs?.entityValidation) applied.push('entityValidation');
    if (spec.needs?.preconditions) applied.push('preconditions');
    
    // Tier 2 (triggered)
    if (spec.needs?.actionHooks) applied.push('actionHooks');
    if (spec.needs?.effects) applied.push('effects');
    if (spec.needs?.dynamicVariables) applied.push('dynamicVariables');
    if (spec.needs?.entityCapture) applied.push('entityCapture');
    
    // Tier 3 (expensive)
    if (spec.needs?.llmRewrite) applied.push('llmRewrite');
    
    return applied;
}

module.exports = {
    compileScenario,
    compileScenarioPool,
    fastCandidateLookup,
    createRuntimeTrace,
    buildAppliedSettingsList
};
