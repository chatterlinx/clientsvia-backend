/**
 * ============================================================================
 * WIRING TIERS - Prescriptive Build Guide (Not Passive Report)
 * ============================================================================
 * 
 * This defines what the AI agent NEEDS at each performance tier.
 * Wiring shows: "You're at Tier X, here's what's missing for Tier Y"
 * 
 * TIER PHILOSOPHY:
 * - MVA (Minimum Viable Agent): Can run without breaking
 * - PRO (Production Grade): Ready for real business
 * - MAX (Full Potential): Top performance, lowest failure, highest conversion
 * 
 * Each requirement has:
 * - fieldId: Maps to wiringRegistry field
 * - purpose: What it does (1 sentence)
 * - failureMode: What happens if missing
 * - impact: conversion | reliability | speed | safety
 * - priority: Order within tier (lower = fix first)
 * - fixInstructions: Exact steps to fix
 * 
 * ============================================================================
 */

// ============================================================================
// TIER DEFINITIONS
// ============================================================================

const TIER_MVA = {
    id: 'MVA',
    name: 'Minimum Viable Agent',
    description: 'Agent can run without breaking',
    color: '#f59e0b',
    icon: '🟡',
    requirements: [
        {
            fieldId: 'frontDesk.aiName',
            purpose: 'Agent identifies itself by name',
            failureMode: 'Generic "AI Assistant" name used',
            impact: 'reliability',
            priority: 1,
            fixInstructions: 'Go to Front Desk → Personality → Set AI Name'
        },
        {
            fieldId: 'frontDesk.discoveryConsent.forceLLMDiscovery',
            purpose: 'Kill switch - must be OFF for scenarios to auto-respond',
            failureMode: 'Scenarios matched but LLM speaks instead (expensive, unpredictable)',
            impact: 'reliability',
            priority: 1,
            critical: true,
            mustBe: false,
            fixInstructions: 'Go to Front Desk → Discovery & Consent → Set "Force LLM Discovery" to OFF'
        },
        {
            fieldId: 'frontDesk.discoveryConsent.disableScenarioAutoResponses',
            purpose: 'Kill switch - must be OFF for scenarios to respond',
            failureMode: 'Scenarios matched but silently blocked',
            impact: 'reliability',
            priority: 1,
            critical: true,
            mustBe: false,
            fixInstructions: 'Go to Front Desk → Discovery & Consent → Set "Disable Auto-Responses" to OFF'
        },
        {
            fieldId: 'dataConfig.templateReferences',
            purpose: 'Links company to scenario templates',
            failureMode: 'Zero scenarios available - LLM-only fallback for everything',
            impact: 'reliability',
            priority: 1,
            critical: true,
            validator: (val) => Array.isArray(val) && val.length > 0 && val.some(r => r.enabled !== false),
            fixInstructions: 'Go to Data & Config → Template References → Link an active template'
        },
        {
            fieldId: 'frontDesk.bookingEnabled',
            purpose: 'Master switch for booking functionality',
            failureMode: 'Cannot collect appointments',
            impact: 'conversion',
            priority: 2,
            fixInstructions: 'Go to Front Desk → Booking Prompts → Enable booking'
        },
        {
            fieldId: 'frontDesk.bookingSlots',
            purpose: 'Defines what info to collect for appointments',
            failureMode: 'Booking enabled but no slots to ask',
            impact: 'conversion',
            priority: 2,
            validator: (val) => Array.isArray(val) && val.length > 0 && val.every(s => s.question),
            fixInstructions: 'Go to Front Desk → Booking Prompts → Add slots with questions'
        },
        {
            fieldId: 'frontDesk.discoveryConsent.bookingRequiresExplicitConsent',
            purpose: 'Consent gate before collecting personal info',
            failureMode: 'Agent jumps into booking without caller consent',
            impact: 'safety',
            priority: 2,
            fixInstructions: 'Go to Front Desk → Discovery & Consent → Enable booking consent'
        }
    ]
};

const TIER_PRO = {
    id: 'PRO',
    name: 'Production Grade',
    description: 'Ready for real business',
    color: '#22c55e',
    icon: '🟢',
    requires: ['MVA'], // Must have MVA first
    requirements: [
        {
            fieldId: 'frontDesk.escalation.enabled',
            purpose: 'Allows transfer to human when requested',
            failureMode: 'Caller trapped with AI when they ask for manager',
            impact: 'reliability',
            priority: 1,
            fixInstructions: 'Go to Front Desk → Escalation → Enable escalation'
        },
        {
            fieldId: 'frontDesk.escalation.triggerPhrases',
            purpose: 'Words that trigger human transfer',
            failureMode: '"Manager" or "real person" ignored',
            impact: 'reliability',
            priority: 1,
            validator: (val) => Array.isArray(val) && val.length >= 3,
            fixInstructions: 'Go to Front Desk → Escalation → Add trigger phrases (manager, supervisor, human, etc.)'
        },
        {
            fieldId: 'transfers.transferTargets',
            purpose: 'Phone numbers to transfer to',
            failureMode: 'Escalation triggered but nowhere to send caller',
            impact: 'reliability',
            priority: 1,
            validator: (val) => Array.isArray(val) && val.length > 0,
            fixInstructions: 'Go to Transfer Calls → Add at least one transfer target'
        },
        {
            fieldId: 'frontDesk.loopPrevention',
            purpose: 'Detects when agent keeps asking same question',
            failureMode: 'Agent loops on misunderstood slot forever',
            impact: 'reliability',
            priority: 2,
            validator: (val) => val && val.enabled === true,
            fixInstructions: 'Go to Front Desk → Loops → Enable loop prevention'
        },
        {
            fieldId: 'frontDesk.forbiddenPhrases',
            purpose: 'Words agent must never say',
            failureMode: 'Agent says "I don\'t know" or "that\'s not my job"',
            impact: 'safety',
            priority: 2,
            validator: (val) => Array.isArray(val) && val.length >= 3,
            fixInstructions: 'Go to Front Desk → Forbidden → Add forbidden phrases'
        },
        {
            fieldId: 'frontDesk.discoveryConsent.consentPhrases',
            purpose: 'Words that mean "yes, proceed with booking"',
            failureMode: 'Caller says "sure" but agent doesn\'t recognize consent',
            impact: 'conversion',
            priority: 3,
            validator: (val) => Array.isArray(val) && val.length >= 5,
            fixInstructions: 'Go to Front Desk → Discovery & Consent → Add consent phrases'
        },
        {
            fieldId: 'frontDesk.escalation.transferMessage',
            purpose: 'What agent says during transfer',
            failureMode: 'Silent transfer or generic message',
            impact: 'reliability',
            priority: 3,
            fixInstructions: 'Go to Front Desk → Escalation → Set transfer message'
        }
    ]
};

const TIER_MAX = {
    id: 'MAX',
    name: 'Full Potential',
    description: 'Top performance, lowest failure, highest conversion',
    color: '#8b5cf6',
    icon: '🟣',
    requires: ['MVA', 'PRO'], // Must have both first
    requirements: [
        {
            fieldId: 'frontDesk.greetingResponses',
            purpose: '0-token instant response to "hello"',
            failureMode: 'LLM call for simple greeting (slow, $$$)',
            impact: 'speed',
            priority: 1,
            payoff: 'Reduces "hello?" dead air by 80%',
            validator: (val) => Array.isArray(val) && val.length > 0,
            fixInstructions: 'Go to Front Desk → Greetings → Add greeting responses'
        },
        {
            fieldId: 'frontDesk.fastPathBooking.enabled',
            purpose: 'Instant booking offer for urgent intent',
            failureMode: 'Caller says "send someone" but agent keeps asking questions',
            impact: 'conversion',
            priority: 1,
            payoff: 'Increases booking rate 20-30%',
            fixInstructions: 'Go to Front Desk → Fast-Path → Enable fast-path'
        },
        {
            fieldId: 'frontDesk.fastPathBooking.triggerKeywords',
            purpose: 'Keywords that trigger instant booking offer',
            failureMode: '"Send someone out" doesn\'t trigger fast-path',
            impact: 'conversion',
            priority: 1,
            validator: (val) => Array.isArray(val) && val.length >= 10,
            fixInstructions: 'Go to Front Desk → Fast-Path → Add trigger keywords (schedule, book, come out, etc.)'
        },
        {
            fieldId: 'frontDesk.fallbackResponses',
            purpose: 'Custom responses when nothing matches',
            failureMode: '"Connection was rough" nonsense from LLM',
            impact: 'reliability',
            priority: 2,
            payoff: 'Eliminates weird LLM fallback phrases',
            validator: (val) => val && Object.keys(val).length > 0,
            fixInstructions: 'Go to Front Desk → Fallbacks → Add fallback responses'
        },
        {
            fieldId: 'frontDesk.vocabulary',
            purpose: 'Translates caller slang to standard terms',
            failureMode: '"My AC is busted" not recognized as repair request',
            impact: 'reliability',
            priority: 2,
            payoff: 'Better scenario matching for colloquial speech',
            validator: (val) => val && Object.keys(val).length > 0,
            fixInstructions: 'Go to Front Desk → Vocabulary → Add term mappings'
        },
        {
            fieldId: 'frontDesk.emotions',
            purpose: 'Detects caller emotional state',
            failureMode: 'Angry caller gets robotic response',
            impact: 'reliability',
            priority: 3,
            payoff: 'Better handling of frustrated callers',
            validator: (val) => val && Object.keys(val).length > 0,
            fixInstructions: 'Go to Front Desk → Emotions → Configure emotion detection'
        },
        {
            fieldId: 'frontDesk.frustration',
            purpose: 'De-escalation when caller is frustrated',
            failureMode: 'Frustrated caller not recognized, keeps getting script',
            impact: 'reliability',
            priority: 3,
            payoff: 'Reduces call abandonment from frustration',
            validator: (val) => val && Object.keys(val).length > 0,
            fixInstructions: 'Go to Front Desk → Frustration → Configure frustration handling'
        },
        {
            fieldId: 'dataConfig.cheatSheets',
            purpose: 'Quick FAQ knowledge for common questions',
            failureMode: 'Simple FAQ goes to full LLM call',
            impact: 'speed',
            priority: 3,
            payoff: 'Faster FAQ responses, lower LLM costs',
            validator: (val) => val !== null && val !== undefined,
            fixInstructions: 'Go to Data & Config → Cheat Sheets → Add FAQ content'
        },
        {
            fieldId: 'dataConfig.placeholders',
            purpose: 'Dynamic values in responses ({companyName}, {phone})',
            failureMode: 'Hardcoded company name in all scenarios',
            impact: 'reliability',
            priority: 4,
            validator: (val) => val && Object.keys(val).length > 0,
            fixInstructions: 'Go to Data & Config → Placeholders → Add company placeholders'
        },
        {
            fieldId: 'dynamicFlow.companyFlows',
            purpose: 'Custom trigger-action automation',
            failureMode: 'No business-specific flow customization',
            impact: 'conversion',
            priority: 4,
            payoff: 'Custom flows for specific business needs',
            validator: (val) => Array.isArray(val) && val.length > 0,
            fixInstructions: 'Go to Dynamic Flow → Create company-specific flows'
        }
    ]
};

// ============================================================================
// TIER EVALUATION ENGINE
// ============================================================================

const ALL_TIERS = [TIER_MVA, TIER_PRO, TIER_MAX];

/**
 * Evaluate a field against a requirement
 */
function evaluateRequirement(requirement, fieldValue, fieldStatus) {
    // If field has custom validator, use it
    if (requirement.validator) {
        return requirement.validator(fieldValue);
    }
    
    // If requirement specifies mustBe value
    if (requirement.mustBe !== undefined) {
        return fieldValue === requirement.mustBe;
    }
    
    // Default: check if field has value (WIRED status)
    return fieldStatus === 'WIRED';
}

/**
 * Calculate tier completion for a company
 * 
 * @param {Object} healthFields - Array from health.fields in wiring report
 * @returns {Object} Tier evaluation with completion stats and next actions
 */
function evaluateTiers(healthFields) {
    const fieldMap = new Map();
    for (const field of healthFields) {
        fieldMap.set(field.id, field);
    }
    
    const result = {
        currentTier: null,
        tierScores: {},
        overallScore: 0,
        nextActions: [],
        byTier: {}
    };
    
    let previousTierComplete = true;
    
    for (const tier of ALL_TIERS) {
        const tierResult = {
            id: tier.id,
            name: tier.name,
            description: tier.description,
            color: tier.color,
            icon: tier.icon,
            total: tier.requirements.length,
            complete: 0,
            missing: [],
            complete_items: []
        };
        
        for (const req of tier.requirements) {
            const field = fieldMap.get(req.fieldId);
            const fieldValue = field?.currentValue;
            const fieldStatus = field?.status;
            
            const passed = evaluateRequirement(req, fieldValue, fieldStatus);
            
            if (passed) {
                tierResult.complete++;
                tierResult.complete_items.push(req.fieldId);
            } else {
                tierResult.missing.push({
                    fieldId: req.fieldId,
                    label: field?.label || req.fieldId,
                    purpose: req.purpose,
                    failureMode: req.failureMode,
                    impact: req.impact,
                    priority: req.priority,
                    payoff: req.payoff,
                    critical: req.critical || false,
                    fixInstructions: req.fixInstructions,
                    currentValue: fieldValue,
                    currentStatus: fieldStatus
                });
            }
        }
        
        tierResult.percent = tier.requirements.length > 0 
            ? Math.round((tierResult.complete / tier.requirements.length) * 100)
            : 100;
        
        tierResult.isComplete = tierResult.percent === 100;
        tierResult.isUnlocked = previousTierComplete;
        
        result.byTier[tier.id] = tierResult;
        result.tierScores[tier.id] = tierResult.percent;
        
        // Update current tier
        if (previousTierComplete && tierResult.isComplete) {
            result.currentTier = tier.id;
        }
        
        // Only allow next tier if this one is complete
        if (!tierResult.isComplete) {
            previousTierComplete = false;
        }
    }
    
    // Calculate overall score (weighted)
    const mvaScore = result.tierScores.MVA || 0;
    const proScore = result.tierScores.PRO || 0;
    const maxScore = result.tierScores.MAX || 0;
    result.overallScore = Math.round((mvaScore * 0.4) + (proScore * 0.35) + (maxScore * 0.25));
    
    // Build next actions (prioritized)
    const allMissing = [];
    
    // First: MVA critical items
    for (const item of (result.byTier.MVA?.missing || [])) {
        if (item.critical) {
            allMissing.push({ ...item, tier: 'MVA', tierPriority: 0 });
        }
    }
    
    // Then: MVA non-critical
    for (const item of (result.byTier.MVA?.missing || [])) {
        if (!item.critical) {
            allMissing.push({ ...item, tier: 'MVA', tierPriority: 1 });
        }
    }
    
    // Then: PRO items (if MVA complete)
    if (result.byTier.MVA?.isComplete) {
        for (const item of (result.byTier.PRO?.missing || [])) {
            allMissing.push({ ...item, tier: 'PRO', tierPriority: 2 });
        }
    }
    
    // Then: MAX items (if PRO complete)
    if (result.byTier.PRO?.isComplete) {
        for (const item of (result.byTier.MAX?.missing || [])) {
            allMissing.push({ ...item, tier: 'MAX', tierPriority: 3 });
        }
    }
    
    // Sort by: tierPriority, then impact (reliability > safety > conversion > speed), then priority
    const impactOrder = { reliability: 0, safety: 1, conversion: 2, speed: 3 };
    allMissing.sort((a, b) => {
        if (a.tierPriority !== b.tierPriority) return a.tierPriority - b.tierPriority;
        if (impactOrder[a.impact] !== impactOrder[b.impact]) {
            return (impactOrder[a.impact] || 99) - (impactOrder[b.impact] || 99);
        }
        return (a.priority || 99) - (b.priority || 99);
    });
    
    result.nextActions = allMissing.slice(0, 5); // Top 5 actions
    
    // Determine display tier
    if (!result.currentTier) {
        result.currentTier = 'NONE';
        result.displayTier = {
            id: 'NONE',
            name: 'Not Ready',
            icon: '⚪',
            color: '#6b7280'
        };
    } else {
        const tier = ALL_TIERS.find(t => t.id === result.currentTier);
        result.displayTier = {
            id: tier.id,
            name: tier.name,
            icon: tier.icon,
            color: tier.color
        };
    }
    
    return result;
}

/**
 * Get the tier definitions (for UI display)
 */
function getTierDefinitions() {
    return ALL_TIERS.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        color: t.color,
        icon: t.icon,
        requirementCount: t.requirements.length,
        requires: t.requires || []
    }));
}

module.exports = {
    TIER_MVA,
    TIER_PRO,
    TIER_MAX,
    ALL_TIERS,
    evaluateTiers,
    getTierDefinitions
};

