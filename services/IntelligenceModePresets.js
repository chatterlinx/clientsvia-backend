/**
 * Intelligence Mode Presets for Test Pilot
 * 
 * This module defines three preset configurations for Test Pilot intelligence:
 * - MAXIMUM: Deep LLM analysis on every test (best quality, highest cost)
 * - BALANCED: Selective LLM analysis on failures (good quality, moderate cost)
 * - MINIMAL: Critical-only LLM analysis (basic quality, lowest cost)
 * 
 * Philosophy: Test Pilot = Pay upfront to perfect template → Production = Free
 */

const INTELLIGENCE_MODE_PRESETS = {
  
  /**
   * 🔥 MAXIMUM LLM HELP
   * 
   * Use Case: Building new templates, major updates, pre-production validation
   * Philosophy: Spare no expense to find every improvement opportunity
   * Result: 95%+ confidence template that handles production calls for free
   */
  MAXIMUM: {
    // Metadata
    id: 'MAXIMUM',
    displayName: 'Maximum LLM Help',
    emoji: '🔥',
    description: 'Deep analysis on EVERY test - Perfect for building new templates',
    
    // Test Pilot Analysis Configuration
    testPilot: {
      llmModel: 'gpt-4o',                    // Best model (not cheapest)
      analysisDepth: 'DEEP',                  // Full comprehensive analysis
      analysisMode: 'ALWAYS',                 // Analyze ALL tests (even 100% confidence)
      suggestionFilter: 'ALL',                // Show all suggestions (no filtering)
      minConfidenceForAnalysis: 0,            // Analyze even perfect matches
      conflictDetection: 'AGGRESSIVE',        // Find all potential conflicts
      edgeCasePrediction: true,               // Predict edge cases
      beforeAfterSimulation: true,            // Show impact simulations
      bulkActions: true,                      // Enable bulk apply/ignore
      costLimit: null,                        // No cost limits
      maxAnalysisTime: 30000,                 // 30s timeout for LLM
    },
    
    // Tier Thresholds (for production AI Gateway)
    tiers: {
      tier1Threshold: 0.80,   // 80% - Higher bar (forces more analysis in testing)
      tier2Threshold: 0.60,   // 60% - Lower bar (catches more edge cases)
      enableTier3: true,      // Always use LLM when tier 1/2 fail
    },
    
    // Learning & Sharing Configuration
    learning: {
      enabled: true,
      shareWithinIndustry: true,              // Share patterns with same industry
      proposeGlobal: true,                    // Propose universal patterns
      minPatternFrequency: 1,                 // Learn from EVERY pattern (no threshold)
      minConfidence: 0.50,                    // Low bar (learn from failures too)
      autoApplyHighConfidence: false,         // Manual review required
    },
    
    // Cost & Performance Estimates
    estimates: {
      costPerTest: 0.10,      // ~$0.10 per test (GPT-4o + deep analysis)
      speed: 'SLOW',          // 2-5 seconds per test
      quality: 'MAXIMUM',     // Best possible insights
    },
    
    // Recommended Use Cases
    bestFor: [
      'Building new templates from scratch',
      'Major template updates or refactoring',
      'Testing complex edge cases',
      'Pre-production validation',
      'When you want zero customer issues',
    ],
    
    // Warnings
    warnings: {
      costPerDay: 'Could exceed $10-50/day if testing heavily',
      speed: 'Analysis takes 2-5s per test (not for quick validation)',
    },
  },

  /**
   * ⚖️ BALANCED HELP
   * 
   * Use Case: Refining existing templates, minor updates, cost-conscious testing
   * Philosophy: Smart analysis - only deep-dive on failures
   * Result: Good template quality at reasonable cost
   */
  BALANCED: {
    // Metadata
    id: 'BALANCED',
    displayName: 'Balanced Help',
    emoji: '⚖️',
    description: 'Analyze only failed/low-confidence tests - Smart middle ground',
    
    // Test Pilot Analysis Configuration
    testPilot: {
      llmModel: 'gpt-4o-mini',                // Cheaper model
      analysisDepth: 'STANDARD',              // Normal analysis (not deep)
      analysisMode: 'ON_FAILURE',             // Only analyze when confidence < threshold
      suggestionFilter: 'HIGH_PRIORITY',      // Show important suggestions only
      minConfidenceForAnalysis: 0.70,         // Skip analysis if ≥70% confidence
      conflictDetection: 'STANDARD',          // Basic conflict detection
      edgeCasePrediction: true,               // Still predict edge cases
      beforeAfterSimulation: false,           // Skip simulations (save time)
      bulkActions: true,                      // Enable bulk apply/ignore
      costLimit: 0.10,                        // $0.10 max per test
      maxAnalysisTime: 15000,                 // 15s timeout for LLM
    },
    
    // Tier Thresholds
    tiers: {
      tier1Threshold: 0.70,   // 70% - Standard (default)
      tier2Threshold: 0.75,   // 75% - Standard
      enableTier3: true,      // Use LLM when needed
    },
    
    // Learning & Sharing Configuration
    learning: {
      enabled: true,
      shareWithinIndustry: true,              // Share patterns with same industry
      proposeGlobal: false,                   // Don't propose global (cost savings)
      minPatternFrequency: 2,                 // Must see pattern 2+ times
      minConfidence: 0.70,                    // Medium bar
      autoApplyHighConfidence: false,         // Manual review required
    },
    
    // Cost & Performance Estimates
    estimates: {
      costPerTest: 0.05,      // ~$0.05 per test (only on failures)
      speed: 'MEDIUM',        // 1-2 seconds per test
      quality: 'GOOD',        // Solid insights on important issues
    },
    
    // Recommended Use Cases
    bestFor: [
      'Refining existing templates',
      'Minor template updates',
      'Cost-conscious testing',
      'Maintenance and improvements',
    ],
    
    // Warnings
    warnings: {
      costPerDay: 'Could reach $5-10/day if many tests fail',
      coverage: 'May miss minor improvements (only analyzes failures)',
    },
  },

  /**
   * 💚 MINIMAL LLM
   * 
   * Use Case: Production validation, mature templates, quick smoke tests
   * Philosophy: Only intervene on critical failures
   * Result: Fast validation with minimal cost
   */
  MINIMAL: {
    // Metadata
    id: 'MINIMAL',
    displayName: 'Minimal LLM',
    emoji: '💚',
    description: 'Only analyze critical failures - Production validation mode',
    
    // Test Pilot Analysis Configuration
    testPilot: {
      llmModel: 'gpt-4o-mini',                // Cheapest model
      analysisDepth: 'SHALLOW',               // Quick surface-level analysis
      analysisMode: 'CRITICAL_ONLY',          // Only if catastrophic failure
      suggestionFilter: 'CRITICAL_ONLY',      // Only critical suggestions
      minConfidenceForAnalysis: 0.40,         // Only if <40% confidence (major failure)
      conflictDetection: 'DISABLED',          // Skip conflict detection
      edgeCasePrediction: false,              // Skip edge case prediction
      beforeAfterSimulation: false,           // Skip simulations
      bulkActions: false,                     // Manual only (safer)
      costLimit: 0.02,                        // $0.02 max per test
      maxAnalysisTime: 10000,                 // 10s timeout for LLM
    },
    
    // Tier Thresholds
    tiers: {
      tier1Threshold: 0.60,   // 60% - Low bar (easy to pass)
      tier2Threshold: 0.80,   // 80% - High bar (hard to reach Tier 3)
      enableTier3: true,      // Still use LLM as fallback
    },
    
    // Learning & Sharing Configuration
    learning: {
      enabled: true,
      shareWithinIndustry: false,             // No sharing (cost savings)
      proposeGlobal: false,                   // No global proposals
      minPatternFrequency: 5,                 // Must see pattern 5+ times
      minConfidence: 0.85,                    // High bar (only proven patterns)
      autoApplyHighConfidence: false,         // Manual review required
    },
    
    // Cost & Performance Estimates
    estimates: {
      costPerTest: 0.01,      // ~$0.01 per test (rarely triggers LLM)
      speed: 'FAST',          // <500ms per test
      quality: 'BASIC',       // Catches critical issues only
    },
    
    // Recommended Use Cases
    bestFor: [
      'Testing mature templates',
      'Production validation',
      'Quick smoke tests',
      'Cost-minimized testing',
      'High-volume testing',
    ],
    
    // Warnings
    warnings: {
      coverage: 'Will miss many improvement opportunities',
      quality: 'Only catches catastrophic failures',
    },
  },
};

/**
 * Get preset configuration by ID
 * @param {string} modeId - 'MAXIMUM', 'BALANCED', or 'MINIMAL'
 * @returns {object} Preset configuration
 */
function getPreset(modeId) {
  const preset = INTELLIGENCE_MODE_PRESETS[modeId];
  if (!preset) {
    throw new Error(`Invalid intelligence mode: ${modeId}. Must be MAXIMUM, BALANCED, or MINIMAL.`);
  }
  return preset;
}

/**
 * Get all available presets
 * @returns {array} Array of all presets
 */
function getAllPresets() {
  return Object.values(INTELLIGENCE_MODE_PRESETS);
}

/**
 * Recommend preset based on template maturity
 * @param {object} templateStats - Template statistics
 * @returns {object} Recommended preset with reasoning
 */
function recommendPreset(templateStats) {
  const { testCount = 0, avgConfidence = 0, lastUpdated = null } = templateStats;
  
  // New or immature template
  if (testCount < 20 || avgConfidence < 70) {
    return {
      preset: INTELLIGENCE_MODE_PRESETS.MAXIMUM,
      reason: 'Template is new or struggling - use maximum intelligence to perfect it',
      confidence: 'HIGH',
    };
  }
  
  // Mature and performing well
  if (avgConfidence >= 90 && testCount > 100) {
    return {
      preset: INTELLIGENCE_MODE_PRESETS.MINIMAL,
      reason: 'Template is mature and working well - minimal analysis needed',
      confidence: 'HIGH',
    };
  }
  
  // Middle ground - template is good but can improve
  return {
    preset: INTELLIGENCE_MODE_PRESETS.BALANCED,
    reason: 'Template is functional but has room for improvement - balanced approach recommended',
    confidence: 'MEDIUM',
  };
}

/**
 * Calculate estimated cost for a preset given test volume
 * @param {string} modeId - Preset ID
 * @param {number} testsPerDay - Expected tests per day
 * @returns {object} Cost breakdown
 */
function estimateCost(modeId, testsPerDay) {
  const preset = getPreset(modeId);
  const costPerTest = preset.estimates.costPerTest;
  
  return {
    costPerTest,
    dailyCost: (costPerTest * testsPerDay).toFixed(2),
    weeklyCost: (costPerTest * testsPerDay * 7).toFixed(2),
    monthlyCost: (costPerTest * testsPerDay * 30).toFixed(2),
    currency: 'USD',
  };
}

/**
 * Validate preset configuration
 * @param {object} preset - Preset to validate
 * @returns {object} Validation result
 */
function validatePreset(preset) {
  const errors = [];
  
  if (!preset.testPilot) {
    errors.push('Missing testPilot configuration');
  }
  
  if (!preset.tiers) {
    errors.push('Missing tiers configuration');
  }
  
  if (preset.tiers && preset.tiers.tier1Threshold > preset.tiers.tier2Threshold) {
    errors.push('tier1Threshold must be <= tier2Threshold');
  }
  
  if (!['gpt-4o', 'gpt-4o-mini'].includes(preset.testPilot?.llmModel)) {
    errors.push('Invalid llmModel - must be gpt-4o or gpt-4o-mini');
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

module.exports = {
  INTELLIGENCE_MODE_PRESETS,
  getPreset,
  getAllPresets,
  recommendPreset,
  estimateCost,
  validatePreset,
};

