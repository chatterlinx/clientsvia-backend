/**
 * ════════════════════════════════════════════════════════════════════════════════
 * BLUEPRINT SPEC V1 - Template Coverage Contract
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * A Blueprint Spec defines WHAT scenarios a template SHOULD have.
 * It is NOT the scenarios themselves - it's the coverage contract.
 * 
 * ARCHITECTURE:
 *   Blueprint Spec = "This template should have these scenario types"
 *   Assessment = "Compare existing scenarios to the spec"
 *   Generation = "Create content-only cards for missing items"
 * 
 * OWNERSHIP:
 *   Blueprint specs are READ-ONLY. They define the contract.
 *   Scenarios are GENERATED from the spec, not copied from it.
 *   Generated scenarios contain ONLY content-owned fields (22 fields).
 * 
 * ════════════════════════════════════════════════════════════════════════════════
 */

/**
 * BlueprintSpecV1 Schema
 * 
 * @typedef {Object} BlueprintSpecV1
 * @property {string} blueprintId - Unique blueprint identifier
 * @property {string} tradeKey - Trade/industry (hvac, plumbing, electrical, accounting)
 * @property {string} name - Human-readable name
 * @property {string} version - Spec version (v1, v2, etc.)
 * @property {string} description - Description of this blueprint
 * @property {BlueprintMetadata} metadata - Industry context
 * @property {BlueprintCategory[]} categories - Scenario categories
 */

/**
 * @typedef {Object} BlueprintMetadata
 * @property {string} companyTone - Default tone (calm_professional, etc.)
 * @property {string[]} disallowedTopics - Topics to avoid
 * @property {string[]} complianceNotes - Legal/compliance requirements
 * @property {Object} operatingAssumptions - Business context
 */

/**
 * @typedef {Object} BlueprintCategory
 * @property {string} categoryKey - Stable category identifier
 * @property {string} name - Category display name
 * @property {string} icon - Emoji icon
 * @property {number} priority - Category priority (0-100)
 * @property {BlueprintItem[]} items - Scenario specs in this category
 */

/**
 * @typedef {Object} BlueprintItem
 * @property {string} itemKey - Stable scenario identifier (e.g., "hvac_no_ac_summer")
 * @property {string} name - Human-readable scenario name
 * @property {string} scenarioType - BOOKING, TROUBLESHOOT, FAQ, EMERGENCY, etc.
 * @property {boolean} required - Is this scenario required for coverage?
 * @property {string} priority - high, medium, low
 * @property {boolean} bookingIntent - Should this lead to booking?
 * @property {string} replyGoal - "classify" or "book" - what the reply should achieve
 * @property {string[]} triggerHints - Example phrases that should trigger this
 * @property {string[]} negativeTriggerHints - Phrases that should NOT match
 * @property {string[]} entityCaptureHints - Entities to capture
 * @property {string[]} tags - Classification tags
 * @property {string} notes - Additional context for generation
 */

// Valid scenario types
const VALID_SCENARIO_TYPES = [
    'EMERGENCY',      // Critical issues - priority 90-100
    'BOOKING',        // Scheduling/appointment intents - priority 70-85
    'FAQ',            // Informational questions - priority 40-60
    'TROUBLESHOOT',   // Diagnostic/classification - priority 50-70
    'BILLING',        // Payment, invoice questions - priority 40-60
    'TRANSFER',       // Human escalation - priority 80-90
    'SMALL_TALK',     // Greetings, thanks, goodbye - priority 0-10
    'SYSTEM',         // Internal acks - priority 20-40
    'SUPPORT',        // General support requests - priority 50-70
    'POLICY'          // Hours, service areas, policies - priority 20-40
];

// Valid reply goals
const VALID_REPLY_GOALS = [
    'classify',  // Quick question to classify the issue further
    'book',      // Progress toward booking an appointment
    'inform',    // Provide information (FAQ)
    'transfer',  // Escalate to human
    'close'      // End conversation gracefully
];

/**
 * Validate a BlueprintSpecV1 object
 * 
 * @param {Object} spec - The blueprint spec to validate
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateBlueprintSpec(spec) {
    const errors = [];
    
    // Required top-level fields
    if (!spec.blueprintId) errors.push('Missing blueprintId');
    if (!spec.tradeKey) errors.push('Missing tradeKey');
    if (!spec.name) errors.push('Missing name');
    if (!spec.version) errors.push('Missing version');
    
    // Validate categories
    if (!spec.categories || !Array.isArray(spec.categories)) {
        errors.push('Missing or invalid categories array');
    } else {
        spec.categories.forEach((cat, catIdx) => {
            if (!cat.categoryKey) errors.push(`Category ${catIdx}: missing categoryKey`);
            if (!cat.name) errors.push(`Category ${catIdx}: missing name`);
            
            // Validate items
            if (!cat.items || !Array.isArray(cat.items)) {
                errors.push(`Category ${catIdx}: missing or invalid items array`);
            } else {
                cat.items.forEach((item, itemIdx) => {
                    if (!item.itemKey) errors.push(`Category ${catIdx} Item ${itemIdx}: missing itemKey`);
                    if (!item.name) errors.push(`Category ${catIdx} Item ${itemIdx}: missing name`);
                    if (!item.scenarioType) errors.push(`Category ${catIdx} Item ${itemIdx}: missing scenarioType`);
                    if (item.scenarioType && !VALID_SCENARIO_TYPES.includes(item.scenarioType)) {
                        errors.push(`Category ${catIdx} Item ${itemIdx}: invalid scenarioType "${item.scenarioType}"`);
                    }
                    if (!item.triggerHints || item.triggerHints.length === 0) {
                        errors.push(`Category ${catIdx} Item ${itemIdx}: missing triggerHints`);
                    }
                });
            }
        });
    }
    
    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Get all items from a blueprint spec (flattened)
 * 
 * @param {Object} spec - The blueprint spec
 * @returns {Array} Flattened list of all items with category info
 */
function getAllBlueprintItems(spec) {
    const items = [];
    
    for (const category of (spec.categories || [])) {
        for (const item of (category.items || [])) {
            items.push({
                ...item,
                categoryKey: category.categoryKey,
                categoryName: category.name,
                categoryPriority: category.priority || 50
            });
        }
    }
    
    return items;
}

/**
 * Get required items only
 * 
 * @param {Object} spec - The blueprint spec
 * @returns {Array} Required items only
 */
function getRequiredItems(spec) {
    return getAllBlueprintItems(spec).filter(item => item.required !== false);
}

/**
 * Get coverage stats for a blueprint
 * 
 * @param {Object} spec - The blueprint spec
 * @returns {Object} Coverage statistics
 */
function getBlueprintStats(spec) {
    const allItems = getAllBlueprintItems(spec);
    const requiredItems = allItems.filter(i => i.required !== false);
    
    const byType = {};
    const byCategory = {};
    
    for (const item of allItems) {
        byType[item.scenarioType] = (byType[item.scenarioType] || 0) + 1;
        byCategory[item.categoryKey] = (byCategory[item.categoryKey] || 0) + 1;
    }
    
    return {
        totalItems: allItems.length,
        requiredItems: requiredItems.length,
        optionalItems: allItems.length - requiredItems.length,
        byType,
        byCategory,
        categories: spec.categories?.length || 0
    };
}

module.exports = {
    VALID_SCENARIO_TYPES,
    VALID_REPLY_GOALS,
    validateBlueprintSpec,
    getAllBlueprintItems,
    getRequiredItems,
    getBlueprintStats
};
