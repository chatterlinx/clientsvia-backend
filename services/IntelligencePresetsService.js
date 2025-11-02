// ============================================================================
// CLIENTSVIA - INTELLIGENCE PRESETS SERVICE
// ============================================================================
// Purpose: Manage Test Pilot vs Production 3-Tier Intelligence configurations
// Created: 2025-11-02
// Architecture: Dual 3-Tier System (Test = Aggressive, Production = Conservative)
// ============================================================================

const logger = require('../utils/logger');

// ============================================================================
// PRESET DEFINITIONS - WORLD-CLASS DEFAULTS
// ============================================================================
// These are BULLETPROOF configurations that prevent human mistakes
// Each preset is designed for specific use cases and template maturity levels
// ============================================================================

const INTELLIGENCE_PRESETS = {
    // ========================================================================
    // CONSERVATIVE - Minimize Cost, Proven Templates
    // ========================================================================
    conservative: {
        id: 'conservative',
        name: '🐢 Conservative',
        emoji: '🐢',
        description: 'Minimize LLM cost - Use only for proven patterns',
        detailedDescription: 'Best for mature templates (6+ months old) with high match rates. Focuses on cost optimization while still catching edge cases.',
        
        useCase: 'Template is mature (85%+ match rate), high call volume, tight budget',
        
        thresholds: {
            tier1: 0.85,  // Strict - only high-confidence rule matches
            tier2: 0.70   // Strict - semantic must be very clear
        },
        
        llmConfig: {
            model: 'gpt-4o-mini',      // Cheaper model
            autoApply: 'manual',        // No auto-apply (human review)
            maxCallsPerDay: 50,         // Limit Tier 3 to 50 calls/day
            contextWindow: 'minimal'    // Reduce context to save tokens
        },
        
        estimatedCost: {
            per100Calls: '$2-5',
            perCall: '$0.02-0.05',
            tier3Rate: '5-8%',
            monthlyAt1000Calls: '$20-50'
        },
        
        expectedPerformance: {
            tier1MatchRate: '85-90%',
            tier2MatchRate: '8-12%',
            tier3MatchRate: '2-5%',
            avgResponseTime: '450ms'
        },
        
        recommendedFor: [
            'Mature templates (85%+ match rate)',
            'High call volume companies (1000+ calls/month)',
            'Budget-conscious testing',
            'Templates in maintenance mode',
            'Well-established industries (dentist, plumber, HVAC)'
        ],
        
        notRecommendedFor: [
            'Brand new templates (Week 1)',
            'Templates with known gaps',
            'Rapid prototyping phase',
            'Complex/niche industries'
        ]
    },
    
    // ========================================================================
    // BALANCED - Default Recommended Configuration
    // ========================================================================
    balanced: {
        id: 'balanced',
        name: '⚖️ Balanced',
        emoji: '⚖️',
        description: 'Recommended default - Good learning, reasonable cost',
        detailedDescription: 'Perfect balance of learning speed and cost efficiency. Suitable for most templates during active development and optimization.',
        
        useCase: 'New template testing, ongoing optimization, most use cases',
        
        thresholds: {
            tier1: 0.80,  // Standard threshold
            tier2: 0.60   // Standard threshold
        },
        
        llmConfig: {
            model: 'gpt-4o-mini',      // Good quality, reasonable cost
            autoApply: 'manual',        // Manual review (safe default)
            maxCallsPerDay: null,       // No limit
            contextWindow: 'standard'   // Normal context
        },
        
        estimatedCost: {
            per100Calls: '$5-10',
            perCall: '$0.05-0.10',
            tier3Rate: '10-15%',
            monthlyAt1000Calls: '$50-100'
        },
        
        expectedPerformance: {
            tier1MatchRate: '75-80%',
            tier2MatchRate: '12-18%',
            tier3MatchRate: '8-12%',
            avgResponseTime: '550ms'
        },
        
        recommendedFor: [
            'New template initial testing (Week 1-4)',
            'Regular template optimization',
            'Most use cases (DEFAULT)',
            'Balanced cost vs learning',
            'Medium-sized companies (500-1000 calls/month)'
        ],
        
        notRecommendedFor: [
            'Extremely tight budgets (<$20/month)',
            'Templates that need rapid iteration',
            'Research/debugging scenarios'
        ]
    },
    
    // ========================================================================
    // AGGRESSIVE - Maximum Learning, Higher Cost
    // ========================================================================
    aggressive: {
        id: 'aggressive',
        name: '🚀 Aggressive',
        emoji: '🚀',
        description: 'Maximum learning - Higher cost, faster improvement',
        detailedDescription: 'Optimized for rapid learning and template improvement. Sends more calls to LLM for deep analysis, generating comprehensive suggestions.',
        
        useCase: 'New template, many gaps, need rapid learning curve',
        
        thresholds: {
            tier1: 0.70,  // Looser - trigger Tier 2/3 more often
            tier2: 0.50   // Looser - trigger Tier 3 frequently
        },
        
        llmConfig: {
            model: 'gpt-4o',                // Best quality model
            autoApply: 'high-confidence',   // Auto-apply 90%+ confidence suggestions
            maxCallsPerDay: null,           // No limit
            contextWindow: 'extended'       // More context for better analysis
        },
        
        estimatedCost: {
            per100Calls: '$15-25',
            perCall: '$0.15-0.25',
            tier3Rate: '20-30%',
            monthlyAt1000Calls: '$150-250'
        },
        
        expectedPerformance: {
            tier1MatchRate: '60-70%',
            tier2MatchRate: '15-20%',
            tier3MatchRate: '15-25%',
            avgResponseTime: '750ms'
        },
        
        recommendedFor: [
            'Brand new template (Day 1-7)',
            'Template has known gaps',
            'Rapid prototyping phase',
            'Cost is not a primary concern',
            'Complex/specialized industries',
            'Research & development'
        ],
        
        notRecommendedFor: [
            'Mature templates',
            'Limited budgets',
            'High-volume production environments',
            'Templates already at 80%+ match rate'
        ]
    },
    
    // ========================================================================
    // YOLO - Nuclear Learning Mode (Research Only!)
    // ========================================================================
    yolo: {
        id: 'yolo',
        name: '🔥 YOLO Mode',
        emoji: '🔥',
        description: 'NUCLEAR LEARNING - Send almost everything to LLM',
        detailedDescription: 'Extreme learning mode that sends most calls to GPT-4o for maximum insight. EXPENSIVE - Only for research, debugging, or building comprehensive datasets.',
        
        useCase: 'Development/research ONLY - Understanding edge cases - NOT for regular testing',
        
        thresholds: {
            tier1: 0.50,  // Very loose - most calls trigger Tier 2
            tier2: 0.30   // Very loose - most trigger Tier 3
        },
        
        llmConfig: {
            model: 'gpt-4o',                // Best quality model
            autoApply: 'all',               // Auto-apply everything (risky!)
            maxCallsPerDay: null,           // No limit
            contextWindow: 'maximum'        // Full context + history
        },
        
        estimatedCost: {
            per100Calls: '$50-100',
            perCall: '$0.50-1.00',
            tier3Rate: '50-70%',
            monthlyAt1000Calls: '$500-1000'
        },
        
        expectedPerformance: {
            tier1MatchRate: '30-40%',
            tier2MatchRate: '20-30%',
            tier3MatchRate: '40-60%',
            avgResponseTime: '1200ms'
        },
        
        warnings: [
            '⚠️ EXPENSIVE - Can cost $50-100 per 100 test calls',
            '⚠️ Not recommended for production testing',
            '⚠️ Can generate 100+ suggestions per day',
            '⚠️ Auto-applies ALL suggestions (requires careful monitoring)',
            '⚠️ High LLM costs - Only use for specific research goals',
            '⚠️ Will automatically revert to Balanced after 24 hours'
        ],
        
        recommendedFor: [
            'Template research & development',
            'Understanding complex edge cases',
            'Building comprehensive test datasets',
            'Debugging mysterious template failures',
            'Academic/research purposes',
            'ONE-TIME use for specific investigations'
        ],
        
        notRecommendedFor: [
            'Regular template testing (use Aggressive instead)',
            'Production environments',
            'Budget-conscious scenarios',
            'Long-term continuous use',
            'ANY scenario where cost matters'
        ],
        
        requiresConfirmation: true,  // Force user to confirm they understand the cost
        autoRevertAfterHours: 24     // Auto-revert to Balanced after 24h
    }
};

// ============================================================================
// PRESET GETTER FUNCTIONS
// ============================================================================

/**
 * Get a preset configuration by name
 * @param {string} presetName - One of: conservative, balanced, aggressive, yolo
 * @returns {Object} Preset configuration object
 */
function getPreset(presetName) {
    const preset = INTELLIGENCE_PRESETS[presetName];
    
    if (!preset) {
        logger.warn(`⚠️ [INTELLIGENCE PRESETS] Unknown preset "${presetName}", defaulting to balanced`);
        return INTELLIGENCE_PRESETS.balanced;
    }
    
    logger.info(`✅ [INTELLIGENCE PRESETS] Loaded preset: ${preset.name}`);
    return preset;
}

/**
 * Get all available presets (for UI dropdown)
 * @returns {Array} Array of preset objects
 */
function getAllPresets() {
    return Object.values(INTELLIGENCE_PRESETS);
}

/**
 * Get preset metadata (for UI display)
 * @returns {Array} Simplified preset info for dropdowns
 */
function getPresetMetadata() {
    return Object.values(INTELLIGENCE_PRESETS).map(preset => ({
        id: preset.id,
        name: preset.name,
        emoji: preset.emoji,
        description: preset.description,
        estimatedCost: preset.estimatedCost.per100Calls,
        tier3Rate: preset.estimatedCost.tier3Rate
    }));
}

// ============================================================================
// RECOMMENDATION ENGINE
// ============================================================================

/**
 * Recommend a preset based on template maturity and goals
 * @param {Object} criteria - Selection criteria
 * @returns {Object} Recommended preset with reasoning
 */
function recommendPreset(criteria = {}) {
    const {
        templateAge = 0,           // Days since template created
        currentMatchRate = 0,      // Current Tier 1 match rate (0-1)
        monthlyCallVolume = 0,     // Expected calls per month
        monthlyBudget = null,      // Monthly budget (null = unlimited)
        primaryGoal = 'balanced'   // 'cost' | 'learning' | 'balanced'
    } = criteria;
    
    let recommendation;
    let reasoning = [];
    
    // ========================================================================
    // DECISION TREE - INTELLIGENT RECOMMENDATION
    // ========================================================================
    
    // Brand new template (first week)
    if (templateAge < 7) {
        recommendation = 'aggressive';
        reasoning.push('Template is brand new (< 7 days old) - aggressive learning recommended');
    }
    
    // Very mature template
    else if (templateAge > 180 && currentMatchRate > 0.85) {
        recommendation = 'conservative';
        reasoning.push(`Template is mature (${templateAge} days old) with high match rate (${(currentMatchRate * 100).toFixed(0)}%)`);
    }
    
    // High call volume + budget constraints
    else if (monthlyCallVolume > 1000 && monthlyBudget && monthlyBudget < 100) {
        recommendation = 'conservative';
        reasoning.push(`High call volume (${monthlyCallVolume}/month) with tight budget ($${monthlyBudget}/month)`);
    }
    
    // Low match rate (needs improvement)
    else if (currentMatchRate < 0.70) {
        recommendation = 'aggressive';
        reasoning.push(`Low match rate (${(currentMatchRate * 100).toFixed(0)}%) - needs learning boost`);
    }
    
    // Cost-focused
    else if (primaryGoal === 'cost') {
        recommendation = 'conservative';
        reasoning.push('Primary goal is cost optimization');
    }
    
    // Learning-focused
    else if (primaryGoal === 'learning') {
        recommendation = 'aggressive';
        reasoning.push('Primary goal is maximum learning');
    }
    
    // Default: Balanced
    else {
        recommendation = 'balanced';
        reasoning.push('Default recommendation for most use cases');
    }
    
    // ========================================================================
    // RETURN RECOMMENDATION + REASONING
    // ========================================================================
    
    const preset = getPreset(recommendation);
    
    return {
        recommendedPreset: recommendation,
        preset: preset,
        reasoning: reasoning,
        confidence: 0.85,
        alternatives: reasoning.includes('aggressive') 
            ? ['balanced', 'conservative'] 
            : ['balanced', 'aggressive']
    };
}

// ============================================================================
// COST ESTIMATION
// ============================================================================

/**
 * Estimate cost for a given preset and call volume
 * @param {string} presetName - Preset name
 * @param {number} callsPerDay - Expected daily call volume
 * @returns {Object} Cost breakdown
 */
function estimateCost(presetName, callsPerDay) {
    const preset = getPreset(presetName);
    
    // Parse cost range (e.g., "$5-10" -> {min: 5, max: 10})
    const costRange = preset.estimatedCost.per100Calls.replace('$', '').split('-');
    const costPer100Min = parseFloat(costRange[0]);
    const costPer100Max = parseFloat(costRange[1]);
    
    // Parse Tier 3 rate (e.g., "10-15%" -> {min: 0.10, max: 0.15})
    const tier3Range = preset.estimatedCost.tier3Rate.replace('%', '').split('-');
    const tier3RateMin = parseFloat(tier3Range[0]) / 100;
    const tier3RateMax = parseFloat(tier3Range[1]) / 100;
    
    // Calculate costs
    const dailyCostMin = (callsPerDay / 100) * costPer100Min;
    const dailyCostMax = (callsPerDay / 100) * costPer100Max;
    const monthlyCostMin = dailyCostMin * 30;
    const monthlyCostMax = dailyCostMax * 30;
    const yearlyCostMin = dailyCostMin * 365;
    const yearlyCostMax = dailyCostMax * 365;
    
    const tier3CallsMin = Math.round(callsPerDay * tier3RateMin);
    const tier3CallsMax = Math.round(callsPerDay * tier3RateMax);
    
    return {
        preset: preset.name,
        callsPerDay: callsPerDay,
        
        daily: {
            costMin: dailyCostMin.toFixed(2),
            costMax: dailyCostMax.toFixed(2),
            costRange: `$${dailyCostMin.toFixed(2)} - $${dailyCostMax.toFixed(2)}`,
            tier3Calls: `${tier3CallsMin} - ${tier3CallsMax}`
        },
        
        monthly: {
            costMin: monthlyCostMin.toFixed(2),
            costMax: monthlyCostMax.toFixed(2),
            costRange: `$${monthlyCostMin.toFixed(2)} - $${monthlyCostMax.toFixed(2)}`,
            tier3Calls: `${tier3CallsMin * 30} - ${tier3CallsMax * 30}`
        },
        
        yearly: {
            costMin: yearlyCostMin.toFixed(2),
            costMax: yearlyCostMax.toFixed(2),
            costRange: `$${yearlyCostMin.toFixed(2)} - $${yearlyCostMax.toFixed(2)}`,
            tier3Calls: `${tier3CallsMin * 365} - ${tier3CallsMax * 365}`
        },
        
        breakdown: {
            tier1Rate: preset.expectedPerformance.tier1MatchRate,
            tier2Rate: preset.expectedPerformance.tier2MatchRate,
            tier3Rate: preset.expectedPerformance.tier3MatchRate,
            avgResponseTime: preset.expectedPerformance.avgResponseTime
        }
    };
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate custom intelligence settings
 * @param {Object} settings - Custom settings object
 * @returns {Object} Validation result {valid: boolean, errors: string[]}
 */
function validateCustomSettings(settings) {
    const errors = [];
    const warnings = [];
    
    // ========================================================================
    // THRESHOLD VALIDATION
    // ========================================================================
    
    // Tier 1 must be higher than Tier 2
    if (settings.thresholds.tier1 <= settings.thresholds.tier2) {
        errors.push('❌ Tier 1 threshold must be HIGHER than Tier 2 threshold');
    }
    
    // Tier 1 range check (50% - 95%)
    if (settings.thresholds.tier1 < 0.5 || settings.thresholds.tier1 > 0.95) {
        errors.push('❌ Tier 1 threshold must be between 50% and 95%');
    }
    
    // Tier 2 range check (30% - 80%)
    if (settings.thresholds.tier2 < 0.3 || settings.thresholds.tier2 > 0.80) {
        errors.push('❌ Tier 2 threshold must be between 30% and 80%');
    }
    
    // ========================================================================
    // YOLO MODE WARNING
    // ========================================================================
    
    // Very loose thresholds (potential YOLO mode)
    if (settings.thresholds.tier1 < 0.60 && settings.thresholds.tier2 < 0.40) {
        warnings.push('⚠️ WARNING: Very loose thresholds will result in HIGH LLM costs! (50-70% Tier 3 rate)');
    }
    
    // ========================================================================
    // COST CONTROL VALIDATION
    // ========================================================================
    
    // Auto-apply ALL without budget limit is dangerous
    if (settings.llmConfig?.autoApply === 'all' && !settings.costControls?.dailyBudget) {
        warnings.push('⚠️ WARNING: Auto-apply ALL without daily budget limit is risky! Consider setting a budget.');
    }
    
    // ========================================================================
    // LLM MODEL VALIDATION
    // ========================================================================
    
    const validModels = ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'];
    if (settings.llmConfig?.model && !validModels.includes(settings.llmConfig.model)) {
        errors.push(`❌ Invalid LLM model. Must be one of: ${validModels.join(', ')}`);
    }
    
    return {
        valid: errors.length === 0,
        errors: errors,
        warnings: warnings
    };
}

/**
 * Validate preset selection (ensure it exists)
 * @param {string} presetName - Preset to validate
 * @returns {Object} Validation result
 */
function validatePreset(presetName) {
    const valid = INTELLIGENCE_PRESETS.hasOwnProperty(presetName);
    
    return {
        valid: valid,
        errors: valid ? [] : [`❌ Unknown preset: "${presetName}". Valid presets: ${Object.keys(INTELLIGENCE_PRESETS).join(', ')}`]
    };
}

// ============================================================================
// PRESET COMPARISON
// ============================================================================

/**
 * Compare two presets side-by-side
 * @param {string} preset1Name - First preset
 * @param {string} preset2Name - Second preset
 * @returns {Object} Comparison matrix
 */
function comparePresets(preset1Name, preset2Name) {
    const preset1 = getPreset(preset1Name);
    const preset2 = getPreset(preset2Name);
    
    return {
        comparison: [
            {
                metric: 'Tier 1 Threshold',
                [preset1.name]: `${(preset1.thresholds.tier1 * 100).toFixed(0)}%`,
                [preset2.name]: `${(preset2.thresholds.tier1 * 100).toFixed(0)}%`
            },
            {
                metric: 'Tier 2 Threshold',
                [preset1.name]: `${(preset1.thresholds.tier2 * 100).toFixed(0)}%`,
                [preset2.name]: `${(preset2.thresholds.tier2 * 100).toFixed(0)}%`
            },
            {
                metric: 'LLM Model',
                [preset1.name]: preset1.llmConfig.model,
                [preset2.name]: preset2.llmConfig.model
            },
            {
                metric: 'Cost per 100 calls',
                [preset1.name]: preset1.estimatedCost.per100Calls,
                [preset2.name]: preset2.estimatedCost.per100Calls
            },
            {
                metric: 'Tier 3 Rate',
                [preset1.name]: preset1.estimatedCost.tier3Rate,
                [preset2.name]: preset2.estimatedCost.tier3Rate
            },
            {
                metric: 'Auto-apply',
                [preset1.name]: preset1.llmConfig.autoApply,
                [preset2.name]: preset2.llmConfig.autoApply
            }
        ]
    };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    INTELLIGENCE_PRESETS,
    getPreset,
    getAllPresets,
    getPresetMetadata,
    recommendPreset,
    estimateCost,
    validateCustomSettings,
    validatePreset,
    comparePresets
};

