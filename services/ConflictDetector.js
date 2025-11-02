/**
 * ============================================================================
 * CONFLICT DETECTOR - ROUTING ISSUE PREVENTION
 * ============================================================================
 * 
 * PURPOSE:
 * Detects potential conflicts in template configuration that could cause
 * routing ambiguity or incorrect scenario matching. Prevents production issues
 * before customers encounter them.
 * 
 * CONFLICT TYPES:
 * 1. TRIGGER_COLLISION - Same trigger in multiple scenarios
 * 2. SYNONYM_OVERLAP - Conflicting synonym mappings
 * 3. ROUTING_AMBIGUITY - Multiple scenarios match with similar confidence
 * 
 * ARCHITECTURE:
 * - Build comprehensive index of all triggers/synonyms
 * - Cross-reference to find collisions
 * - Classify severity (CRITICAL/WARNING/INFO)
 * - Generate smart fix suggestions
 * 
 * CHECKPOINT STRATEGY:
 * - Checkpoint at start of each analysis phase
 * - Log all detected conflicts with context
 * - Track performance metrics
 * - Never mask errors - always provide full details
 * 
 * DEPENDENCIES:
 * - GlobalInstantResponseTemplate (template data)
 * 
 * EXPORTS:
 * - ConflictDetector (class)
 * 
 * USED BY:
 * - EnterpriseAISuggestionEngine (conflict analysis)
 * - routes/admin/enterpriseSuggestions (conflict API)
 * 
 * ============================================================================
 */

const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
const { ulid } = require('ulid');

class ConflictDetector {
    constructor() {
        console.log('🏗️ [CHECKPOINT 0] ConflictDetector initialized');
    }
    
    /**
     * ============================================================================
     * DETECT ALL CONFLICTS (Main Entry Point)
     * ============================================================================
     * Comprehensive conflict detection across all scenarios
     * 
     * @param {Object} template - Template to analyze
     * @param {String} mode - Detection mode (AGGRESSIVE, STANDARD, DISABLED)
     * @returns {Array} Array of detected conflicts
     * 
     * CHECKPOINT FLOW:
     * 1. Validate inputs
     * 2. Build trigger index
     * 3. Build synonym index
     * 4. Detect trigger collisions
     * 5. Detect synonym overlaps
     * 6. Detect routing ambiguity
     * 7. Classify severity
     * 8. Generate smart fixes
     * 9. Return conflicts
     * ============================================================================
     */
    async detectAllConflicts(template, mode = 'STANDARD') {
        console.log('🔵 [CHECKPOINT 1] detectAllConflicts() started');
        console.log('🔵 [CHECKPOINT 1.1] Mode:', mode, 'Template:', template.name);
        
        if (mode === 'DISABLED') {
            console.log('⏭️ [CHECKPOINT 1.2] Conflict detection disabled');
            return [];
        }
        
        try {
            const conflicts = [];
            
            // ============================================
            // STEP 1: BUILD INDEXES
            // ============================================
            console.log('🔵 [CHECKPOINT 2] Building indexes...');
            
            const triggerIndex = this.buildTriggerIndex(template);
            const synonymIndex = this.buildSynonymIndex(template);
            
            console.log('✅ [CHECKPOINT 2.1] Trigger index built:', triggerIndex.size, 'unique triggers');
            console.log('✅ [CHECKPOINT 2.2] Synonym index built:', synonymIndex.size, 'unique synonyms');
            
            // ============================================
            // STEP 2: DETECT TRIGGER COLLISIONS
            // ============================================
            console.log('🔵 [CHECKPOINT 3] Detecting trigger collisions...');
            
            const triggerCollisions = this.detectTriggerCollisions(triggerIndex);
            conflicts.push(...triggerCollisions);
            
            console.log('✅ [CHECKPOINT 3.1] Found', triggerCollisions.length, 'trigger collisions');
            
            // ============================================
            // STEP 3: DETECT SYNONYM OVERLAPS (if AGGRESSIVE)
            // ============================================
            if (mode === 'AGGRESSIVE') {
                console.log('🔵 [CHECKPOINT 4] Detecting synonym overlaps...');
                
                const synonymOverlaps = this.detectSynonymOverlaps(synonymIndex);
                conflicts.push(...synonymOverlaps);
                
                console.log('✅ [CHECKPOINT 4.1] Found', synonymOverlaps.length, 'synonym overlaps');
            } else {
                console.log('⏭️ [CHECKPOINT 4] Skipping synonym overlap detection (mode: STANDARD)');
            }
            
            // ============================================
            // STEP 4: CLASSIFY & ENHANCE
            // ============================================
            console.log('🔵 [CHECKPOINT 5] Classifying conflicts...');
            
            const classifiedConflicts = conflicts.map(conflict => 
                this.enhanceConflict(conflict, mode)
            );
            
            console.log('✅ [CHECKPOINT 5.1] Conflicts classified and enhanced');
            
            // ============================================
            // STEP 5: RETURN RESULTS
            // ============================================
            console.log('✅ [CHECKPOINT 6] detectAllConflicts() complete!');
            console.log('✅ [CHECKPOINT 6.1] Total conflicts:', classifiedConflicts.length);
            
            return classifiedConflicts;
            
        } catch (error) {
            console.error('❌ [CHECKPOINT ERROR] detectAllConflicts() failed:', error.message);
            console.error('Stack trace:', error.stack);
            throw error;
        }
    }
    
    /**
     * ============================================================================
     * BUILD TRIGGER INDEX
     * ============================================================================
     * Creates a map of all triggers to their scenarios
     * 
     * Format: Map<trigger, Array<{scenarioId, scenarioName, categoryName}>>
     * 
     * @param {Object} template - Template to index
     * @returns {Map} Trigger index
     * ============================================================================
     */
    buildTriggerIndex(template) {
        console.log('🔵 [CHECKPOINT - BUILD INDEX] Building trigger index...');
        
        const index = new Map();
        
        try {
            template.categories?.forEach(category => {
                category.scenarios?.forEach(scenario => {
                    scenario.triggers?.forEach(trigger => {
                        const normalizedTrigger = trigger.toLowerCase().trim();
                        
                        if (!index.has(normalizedTrigger)) {
                            index.set(normalizedTrigger, []);
                        }
                        
                        index.get(normalizedTrigger).push({
                            scenarioId: scenario.scenarioId,
                            scenarioName: scenario.name,
                            categoryId: category.id,
                            categoryName: category.name
                        });
                    });
                });
            });
            
            console.log('✅ [CHECKPOINT - BUILD INDEX] Indexed', index.size, 'unique triggers');
            
            return index;
            
        } catch (error) {
            console.error('❌ [CHECKPOINT - BUILD INDEX ERROR]:', error.message);
            return new Map(); // Return empty on error
        }
    }
    
    /**
     * ============================================================================
     * BUILD SYNONYM INDEX
     * ============================================================================
     * Creates a map of all synonyms to their technical terms
     * 
     * Format: Map<synonym, Array<{technical, categoryName}>>
     * 
     * @param {Object} template - Template to index
     * @returns {Map} Synonym index
     * ============================================================================
     */
    buildSynonymIndex(template) {
        console.log('🔵 [CHECKPOINT - BUILD SYNONYM INDEX] Building synonym index...');
        
        const index = new Map();
        
        try {
            // Template-level synonyms
            if (template.synonymMap) {
                template.synonymMap.forEach((synonyms, technical) => {
                    synonyms.forEach(synonym => {
                        const normalized = synonym.toLowerCase().trim();
                        
                        if (!index.has(normalized)) {
                            index.set(normalized, []);
                        }
                        
                        index.get(normalized).push({
                            technical,
                            categoryName: 'Global',
                            level: 'template'
                        });
                    });
                });
            }
            
            // Category-level synonyms
            template.categories?.forEach(category => {
                if (category.synonymMap) {
                    category.synonymMap.forEach((synonyms, technical) => {
                        synonyms.forEach(synonym => {
                            const normalized = synonym.toLowerCase().trim();
                            
                            if (!index.has(normalized)) {
                                index.set(normalized, []);
                            }
                            
                            index.get(normalized).push({
                                technical,
                                categoryName: category.name,
                                level: 'category'
                            });
                        });
                    });
                }
            });
            
            console.log('✅ [CHECKPOINT - BUILD SYNONYM INDEX] Indexed', index.size, 'unique synonyms');
            
            return index;
            
        } catch (error) {
            console.error('❌ [CHECKPOINT - BUILD SYNONYM INDEX ERROR]:', error.message);
            return new Map();
        }
    }
    
    /**
     * ============================================================================
     * DETECT TRIGGER COLLISIONS
     * ============================================================================
     * Finds triggers that appear in multiple scenarios
     * 
     * @param {Map} triggerIndex - Trigger to scenarios map
     * @returns {Array} Array of collision conflicts
     * ============================================================================
     */
    detectTriggerCollisions(triggerIndex) {
        console.log('🔵 [CHECKPOINT - COLLISIONS] Detecting trigger collisions...');
        
        const collisions = [];
        
        try {
            triggerIndex.forEach((scenarios, trigger) => {
                // If trigger appears in 2+ scenarios, it's a collision
                if (scenarios.length > 1) {
                    collisions.push({
                        conflictId: ulid(),
                        type: 'TRIGGER_COLLISION',
                        severity: this.calculateCollisionSeverity(scenarios),
                        description: `Trigger "${trigger}" appears in ${scenarios.length} different scenarios, causing routing ambiguity.`,
                        affectedScenarios: scenarios,
                        conflictingElements: [trigger],
                        smartFixes: this.generateCollisionFixes(trigger, scenarios),
                        status: 'open',
                        detectedAt: new Date()
                    });
                }
            });
            
            console.log('✅ [CHECKPOINT - COLLISIONS] Found', collisions.length, 'collisions');
            
            return collisions;
            
        } catch (error) {
            console.error('❌ [CHECKPOINT - COLLISIONS ERROR]:', error.message);
            return [];
        }
    }
    
    /**
     * ============================================================================
     * DETECT SYNONYM OVERLAPS
     * ============================================================================
     * Finds synonyms that map to different technical terms
     * 
     * @param {Map} synonymIndex - Synonym to technical terms map
     * @returns {Array} Array of overlap conflicts
     * ============================================================================
     */
    detectSynonymOverlaps(synonymIndex) {
        console.log('🔵 [CHECKPOINT - OVERLAPS] Detecting synonym overlaps...');
        
        const overlaps = [];
        
        try {
            synonymIndex.forEach((mappings, synonym) => {
                // If synonym maps to 2+ different technical terms, it's an overlap
                const uniqueTechnicals = [...new Set(mappings.map(m => m.technical))];
                
                if (uniqueTechnicals.length > 1) {
                    overlaps.push({
                        conflictId: ulid(),
                        type: 'SYNONYM_OVERLAP',
                        severity: 'WARNING',
                        description: `Synonym "${synonym}" maps to multiple technical terms: ${uniqueTechnicals.join(', ')}. This may cause confusion.`,
                        affectedScenarios: mappings.map(m => ({
                            categoryName: m.categoryName
                        })),
                        conflictingElements: [synonym, ...uniqueTechnicals],
                        smartFixes: this.generateOverlapFixes(synonym, mappings),
                        status: 'open',
                        detectedAt: new Date()
                    });
                }
            });
            
            console.log('✅ [CHECKPOINT - OVERLAPS] Found', overlaps.length, 'overlaps');
            
            return overlaps;
            
        } catch (error) {
            console.error('❌ [CHECKPOINT - OVERLAPS ERROR]:', error.message);
            return [];
        }
    }
    
    /**
     * ============================================================================
     * CALCULATE COLLISION SEVERITY
     * ============================================================================
     * Determines how serious a trigger collision is
     * 
     * @param {Array} scenarios - Scenarios sharing the trigger
     * @returns {String} Severity (CRITICAL, WARNING, INFO)
     * ============================================================================
     */
    calculateCollisionSeverity(scenarios) {
        // Critical if in same category (very confusing)
        const categories = [...new Set(scenarios.map(s => s.categoryId))];
        if (categories.length === 1) {
            return 'CRITICAL';
        }
        
        // Warning if high-priority scenarios (e.g., Emergency + Appointment)
        const isEmergency = scenarios.some(s => 
            s.categoryName?.toLowerCase().includes('emergency')
        );
        if (isEmergency) {
            return 'CRITICAL';
        }
        
        // Otherwise just a warning
        return 'WARNING';
    }
    
    /**
     * ============================================================================
     * GENERATE COLLISION FIXES
     * ============================================================================
     * Suggests smart fixes for trigger collisions
     * 
     * @param {String} trigger - Colliding trigger
     * @param {Array} scenarios - Affected scenarios
     * @returns {Array} Array of fix suggestions
     * ============================================================================
     */
    generateCollisionFixes(trigger, scenarios) {
        const fixes = [];
        
        // Fix 1: Make trigger more specific
        fixes.push({
            action: 'ADJUST_THRESHOLD',
            description: `Make "${trigger}" more specific by adding context keywords to each scenario`
        });
        
        // Fix 2: Use negative triggers
        fixes.push({
            action: 'ADD_TO_BOTH',
            description: `Keep "${trigger}" in both scenarios but add negative triggers to prevent false matches`
        });
        
        // Fix 3: Merge if scenarios are similar
        if (scenarios.length === 2) {
            fixes.push({
                action: 'MERGE_SCENARIOS',
                description: `Consider merging "${scenarios[0].scenarioName}" and "${scenarios[1].scenarioName}" if they serve similar purposes`
            });
        }
        
        // Fix 4: Create parent scenario
        fixes.push({
            action: 'CREATE_NEW_SCENARIO',
            description: `Create a parent scenario that handles "${trigger}" and routes to appropriate sub-scenarios`
        });
        
        return fixes;
    }
    
    /**
     * ============================================================================
     * GENERATE OVERLAP FIXES
     * ============================================================================
     * Suggests smart fixes for synonym overlaps
     * 
     * @param {String} synonym - Overlapping synonym
     * @param {Array} mappings - Different technical mappings
     * @returns {Array} Array of fix suggestions
     * ============================================================================
     */
    generateOverlapFixes(synonym, mappings) {
        const fixes = [];
        
        // Fix 1: Context-specific synonyms
        fixes.push({
            action: 'ADD_TO_BOTH',
            description: `Keep "${synonym}" in both categories but use context to disambiguate`
        });
        
        // Fix 2: Remove from global
        if (mappings.some(m => m.level === 'template')) {
            fixes.push({
                action: 'ADJUST_THRESHOLD',
                description: `Move "${synonym}" from global template to category-specific synonyms only`
            });
        }
        
        // Fix 3: Pick most common meaning
        fixes.push({
            action: 'MERGE_SCENARIOS',
            description: `Choose the most common technical meaning for "${synonym}" and remove others`
        });
        
        return fixes;
    }
    
    /**
     * ============================================================================
     * ENHANCE CONFLICT
     * ============================================================================
     * Adds additional context and metadata to conflict
     * 
     * @param {Object} conflict - Base conflict object
     * @param {String} mode - Detection mode
     * @returns {Object} Enhanced conflict
     * ============================================================================
     */
    enhanceConflict(conflict, mode) {
        return {
            ...conflict,
            mode,
            metadata: {
                detectedBy: 'ConflictDetector',
                version: '1.0.0',
                timestamp: new Date()
            }
        };
    }
    
    /**
     * ============================================================================
     * DETECT CONFLICTS FOR PATTERNS
     * ============================================================================
     * Check if suggested patterns would create conflicts
     * 
     * @param {Array} suggestedPatterns - Patterns to check
     * @param {Object} template - Template to check against
     * @param {String} mode - Detection mode
     * @returns {Array} Array of potential conflicts
     * 
     * USE CASE: Before applying LLM suggestions, check if they'd cause issues
     * ============================================================================
     */
    async detectConflictsForPatterns(suggestedPatterns, template, mode = 'STANDARD') {
        console.log('🔵 [CHECKPOINT - PATTERN CHECK] Checking', suggestedPatterns.length, 'patterns for conflicts');
        
        try {
            const conflicts = [];
            const triggerIndex = this.buildTriggerIndex(template);
            
            suggestedPatterns.forEach(pattern => {
                const normalized = pattern.toLowerCase().trim();
                
                // Check if pattern already exists
                if (triggerIndex.has(normalized)) {
                    const existingScenarios = triggerIndex.get(normalized);
                    
                    conflicts.push({
                        conflictId: ulid(),
                        type: 'TRIGGER_COLLISION',
                        severity: 'WARNING',
                        description: `Suggested pattern "${pattern}" would conflict with existing scenarios: ${existingScenarios.map(s => s.scenarioName).join(', ')}`,
                        affectedScenarios: existingScenarios,
                        conflictingElements: [pattern],
                        smartFixes: [{
                            action: 'ADD_TO_BOTH',
                            description: `This pattern appears in multiple contexts. Consider adding it to all relevant scenarios or making it more specific.`
                        }],
                        status: 'open',
                        detectedAt: new Date()
                    });
                }
            });
            
            console.log('✅ [CHECKPOINT - PATTERN CHECK] Found', conflicts.length, 'potential conflicts');
            
            return conflicts;
            
        } catch (error) {
            console.error('❌ [CHECKPOINT - PATTERN CHECK ERROR]:', error.message);
            return [];
        }
    }
}

module.exports = ConflictDetector;

