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
            fixInstructions: 'Set AI Name',
            nav: { tab: 'front-desk', section: 'personality', field: 'aiName' },
            dbPath: 'aiAgentSettings.aiName',
            recommendedValue: '{companyName} Assistant' // Will be replaced with actual company name
        },
        {
            fieldId: 'frontDesk.discoveryConsent.forceLLMDiscovery',
            purpose: 'Kill switch - must be OFF for scenarios to auto-respond',
            failureMode: 'Scenarios matched but LLM speaks instead (expensive, unpredictable)',
            impact: 'reliability',
            priority: 1,
            critical: true,
            mustBe: false,
            fixInstructions: 'Set "Force LLM Discovery" to OFF',
            nav: { tab: 'front-desk', section: 'discovery-consent', field: 'forceLLMDiscovery' },
            dbPath: 'aiAgentSettings.frontDeskBehavior.discoveryConsent.forceLLMDiscovery',
            recommendedValue: false
        },
        {
            fieldId: 'frontDesk.discoveryConsent.disableScenarioAutoResponses',
            purpose: 'Kill switch - must be OFF for scenarios to respond',
            failureMode: 'Scenarios matched but silently blocked',
            impact: 'reliability',
            priority: 1,
            critical: true,
            mustBe: false,
            fixInstructions: 'Set "Disable Auto-Responses" to OFF',
            nav: { tab: 'front-desk', section: 'discovery-consent', field: 'disableScenarioAutoResponses' },
            dbPath: 'aiAgentSettings.frontDeskBehavior.discoveryConsent.disableScenarioAutoResponses',
            recommendedValue: false
        },
        {
            fieldId: 'dataConfig.templateReferences',
            purpose: 'Links company to scenario templates',
            failureMode: 'Zero scenarios available - LLM-only fallback for everything',
            impact: 'reliability',
            priority: 1,
            critical: true,
            validator: (val) => Array.isArray(val) && val.length > 0 && val.some(r => r.enabled !== false),
            fixInstructions: 'Link an active template',
            nav: { tab: 'data-config', section: 'template-references', field: 'templateReferences' },
            dbPath: 'aiAgentSettings.templateReferences',
            // No recommendedValue - must be selected by user
            requiresUserInput: true
        },
        {
            fieldId: 'frontDesk.bookingEnabled',
            purpose: 'Master switch for booking functionality',
            failureMode: 'Cannot collect appointments',
            impact: 'conversion',
            priority: 2,
            fixInstructions: 'Enable booking',
            nav: { tab: 'front-desk', section: 'booking-prompts', field: 'bookingEnabled' },
            dbPath: 'aiAgentSettings.frontDeskBehavior.bookingEnabled',
            recommendedValue: true
        },
        {
            fieldId: 'frontDesk.bookingSlots',
            purpose: 'Defines what info to collect for appointments',
            failureMode: 'Booking enabled but no slots to ask',
            impact: 'conversion',
            priority: 2,
            validator: (val) => Array.isArray(val) && val.length > 0 && val.every(s => s.question),
            fixInstructions: 'Add slots with questions',
            nav: { tab: 'front-desk', section: 'booking-prompts', field: 'bookingSlots' },
            dbPath: 'aiAgentSettings.frontDeskBehavior.bookingSlots',
            recommendedValue: [
                { id: 'firstName', type: 'text', label: 'First Name', question: "What's your first name?", required: true },
                { id: 'lastName', type: 'text', label: 'Last Name', question: 'And your last name?', required: true },
                { id: 'phone', type: 'phone', label: 'Phone', question: "What's the best phone number for the technician to reach you?", required: true },
                { id: 'address', type: 'address', label: 'Service Address', question: "What's the service address?", required: true },
                { id: 'serviceType', type: 'select', label: 'Service Type', question: 'Is this for repair, maintenance, or a new installation?', required: true },
                { id: 'problemDescription', type: 'text', label: 'Problem Description', question: 'Can you briefly describe what the system is doing?', required: true },
                { id: 'timeWindow', type: 'select', label: 'Preferred Time Window', question: 'Do you prefer morning (8-12) or afternoon (12-5)?', required: true }
            ]
        },
        {
            fieldId: 'frontDesk.discoveryConsent.bookingRequiresExplicitConsent',
            purpose: 'Consent gate before collecting personal info',
            failureMode: 'Agent jumps into booking without caller consent',
            impact: 'safety',
            priority: 2,
            fixInstructions: 'Enable booking consent',
            nav: { tab: 'front-desk', section: 'discovery-consent', field: 'bookingRequiresExplicitConsent' },
            dbPath: 'aiAgentSettings.frontDeskBehavior.discoveryConsent.bookingRequiresExplicitConsent',
            recommendedValue: true
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
            fixInstructions: 'Enable escalation',
            nav: { tab: 'front-desk', section: 'escalation', field: 'escalationEnabled' },
            dbPath: 'aiAgentSettings.frontDeskBehavior.escalation.enabled',
            recommendedValue: true
        },
        {
            fieldId: 'frontDesk.escalation.triggerPhrases',
            purpose: 'Words that trigger human transfer',
            failureMode: '"Manager" or "real person" ignored',
            impact: 'reliability',
            priority: 1,
            validator: (val) => Array.isArray(val) && val.length >= 3,
            fixInstructions: 'Add trigger phrases (manager, supervisor, human)',
            nav: { tab: 'front-desk', section: 'escalation', field: 'escalationPhrases' },
            dbPath: 'aiAgentSettings.frontDeskBehavior.escalation.triggerPhrases',
            recommendedValue: ['manager', 'supervisor', 'real person', 'human', 'speak to someone', 'talk to someone', 'live person', 'operator']
        },
        {
            fieldId: 'transfers.transferTargets',
            purpose: 'Phone numbers to transfer to',
            failureMode: 'Escalation triggered but nowhere to send caller',
            impact: 'reliability',
            priority: 1,
            validator: (val) => Array.isArray(val) && val.length > 0,
            fixInstructions: 'Add at least one transfer target',
            nav: { tab: 'transfer-calls', section: 'directory', field: 'transferTargets' },
            dbPath: 'aiAgentSettings.transferTargets',
            // No recommendedValue - requires user's phone numbers
            requiresUserInput: true
        },
        {
            fieldId: 'frontDesk.loopPrevention',
            purpose: 'Detects when agent keeps asking same question',
            failureMode: 'Agent loops on misunderstood slot forever',
            impact: 'reliability',
            priority: 2,
            validator: (val) => val && val.enabled === true,
            fixInstructions: 'Enable loop prevention',
            nav: { tab: 'front-desk', section: 'loops', field: 'loopPrevention' },
            dbPath: 'aiAgentSettings.frontDeskBehavior.loopPrevention',
            recommendedValue: { enabled: true, maxSameQuestion: 2, onLoop: 'rephrase', rephraseIntro: 'Let me try this differently -' }
        },
        {
            fieldId: 'frontDesk.forbiddenPhrases',
            purpose: 'Words agent must never say',
            failureMode: 'Agent says "I don\'t know" or "that\'s not my job"',
            impact: 'safety',
            priority: 2,
            validator: (val) => Array.isArray(val) && val.length >= 3,
            fixInstructions: 'Add forbidden phrases',
            nav: { tab: 'front-desk', section: 'forbidden', field: 'forbiddenPhrases' },
            dbPath: 'aiAgentSettings.frontDeskBehavior.forbiddenPhrases',
            recommendedValue: ["I don't know", "I can't help", "That's not my job", "Call back later", "We're too busy", "I'm just an AI", "I can't do that"]
        },
        {
            fieldId: 'frontDesk.discoveryConsent.consentPhrases',
            purpose: 'Words that mean "yes, proceed with booking"',
            failureMode: 'Caller says "sure" but agent doesn\'t recognize consent',
            impact: 'conversion',
            priority: 3,
            validator: (val) => Array.isArray(val) && val.length >= 5,
            fixInstructions: 'Add consent phrases',
            nav: { tab: 'front-desk', section: 'discovery-consent', field: 'consentPhrases' },
            dbPath: 'aiAgentSettings.frontDeskBehavior.discoveryConsent.consentPhrases',
            recommendedValue: ['yes', 'yeah', 'yep', 'yupp', 'ok', 'okay', 'alright', 'sounds good', 'go ahead', 'please do', 'do it', "let's do it", "let's do that", 'schedule it', 'book it', 'set it up', 'proceed', 'correct', 'that works', 'sure', 'absolutely', 'definitely', '100%', 'you can', 'you may', 'i agree', 'i consent']
        },
        {
            fieldId: 'frontDesk.escalation.transferMessage',
            purpose: 'What agent says during transfer',
            failureMode: 'Silent transfer or generic message',
            impact: 'reliability',
            priority: 3,
            fixInstructions: 'Set transfer message',
            nav: { tab: 'front-desk', section: 'escalation', field: 'transferMessage' },
            dbPath: 'aiAgentSettings.frontDeskBehavior.escalation.transferMessage',
            recommendedValue: 'Let me connect you to our team now. Please hold for just a moment.'
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
            fixInstructions: 'Add greeting responses',
            nav: { tab: 'front-desk', section: 'greetings', field: 'greetingResponses' },
            dbPath: 'aiAgentSettings.frontDeskBehavior.greetingResponses',
            recommendedValue: [
                'Hi! Thanks for calling {companyName}. How can I help you today?',
                'Hello! This is {companyName}. What can I help you with today?',
                'Good morning! Thanks for calling {companyName}. How may I assist you?',
                'Good afternoon! {companyName}, how can I help?'
            ]
        },
        {
            fieldId: 'frontDesk.fastPathBooking.enabled',
            purpose: 'Instant booking offer for urgent intent',
            failureMode: 'Caller says "send someone" but agent keeps asking questions',
            impact: 'conversion',
            priority: 1,
            payoff: 'Increases booking rate 20-30%',
            fixInstructions: 'Enable fast-path',
            nav: { tab: 'front-desk', section: 'fast-path', field: 'fastPathEnabled' },
            dbPath: 'aiAgentSettings.frontDeskBehavior.fastPathBooking.enabled',
            recommendedValue: true
        },
        {
            fieldId: 'frontDesk.offRailsRecovery.bridgeBack.resumeBooking',
            purpose: 'After off-rails Q&A in booking, the agent recaps collected slots and continues with the next missing slot',
            failureMode: 'Caller gets answered but booking context drifts; agent re-asks or loses momentum',
            impact: 'conversion',
            priority: 2,
            payoff: 'Reduces booking abandonment after interruptions',
            fixInstructions: 'Enable Resume Booking Protocol and set a template',
            nav: { tab: 'front-desk', section: 'personality', field: 'resumeBooking' },
            dbPath: 'aiAgentSettings.frontDeskBehavior.offRailsRecovery.bridgeBack.resumeBooking',
            recommendedValue: {
                enabled: true,
                includeValues: false,
                template: "Okay — back to booking. I have {collectedSummary}. {nextQuestion}",
                collectedItemTemplate: "{label}",
                collectedItemTemplateWithValue: "{label}: {value}",
                separator: ", ",
                finalSeparator: " and "
            }
        },
        {
            fieldId: 'frontDesk.confirmationRequests',
            purpose: 'When caller asks “did you get my phone/name/address right?”, repeat captured value using slot confirmPrompt',
            failureMode: 'Engine misroutes into breakdown/re-ask instead of confirming captured value',
            impact: 'reliability',
            priority: 2,
            payoff: 'Prevents phone/address/name confirmation misses',
            fixInstructions: 'Enable Confirmation Requests and keep at least 2 trigger phrases',
            nav: { tab: 'front-desk', section: 'personality', field: 'confirmationRequests' },
            dbPath: 'aiAgentSettings.frontDeskBehavior.confirmationRequests',
            recommendedValue: {
                enabled: true,
                triggers: [
                    "did you get my",
                    "did you catch my",
                    "did i give you the right",
                    "is that right",
                    "is that correct",
                    "can you repeat",
                    "can you read that back",
                    "can you confirm",
                    "what did you have for my"
                ]
            }
        },
        {
            fieldId: 'frontDesk.fastPathBooking.triggerKeywords',
            purpose: 'Keywords that trigger instant booking offer',
            failureMode: '"Send someone out" doesn\'t trigger fast-path',
            impact: 'conversion',
            priority: 1,
            validator: (val) => Array.isArray(val) && val.length >= 10,
            fixInstructions: 'Add trigger keywords (schedule, book, come out)',
            nav: { tab: 'front-desk', section: 'fast-path', field: 'fastPathKeywords' },
            dbPath: 'aiAgentSettings.frontDeskBehavior.fastPathBooking.triggerKeywords',
            recommendedValue: ['send someone', 'send somebody', 'get someone out', 'get somebody out', 'need you out', 'need someone out', 'want someone out', 'come out', 'come today', 'schedule', 'book', 'appointment', 'technician', 'fix it', 'just fix it', 'need service', 'need help now', 'asap', 'emergency', 'urgent', "i'm done", 'just get someone']
        },
        {
            fieldId: 'frontDesk.fallbackResponses',
            purpose: 'Custom responses when nothing matches',
            failureMode: '"Connection was rough" nonsense from LLM',
            impact: 'reliability',
            priority: 2,
            payoff: 'Eliminates weird LLM fallback phrases',
            validator: (val) => val && Object.keys(val).length > 0,
            fixInstructions: 'Add fallback responses',
            nav: { tab: 'front-desk', section: 'fallbacks', field: 'fallbackResponses' },
            dbPath: 'aiAgentSettings.frontDeskBehavior.fallbackResponses',
            recommendedValue: {
                noMatch: "I want to make sure I help you correctly. Could you tell me a bit more about what you need?",
                unclear: "I didn't quite catch that. Are you calling about a service issue, or would you like to schedule an appointment?",
                error: "I apologize - let me get you to someone who can help right away."
            }
        },
        {
            fieldId: 'frontDesk.vocabulary',
            purpose: 'Translates caller slang to standard terms',
            failureMode: '"My AC is busted" not recognized as repair request',
            impact: 'reliability',
            priority: 2,
            payoff: 'Better scenario matching for colloquial speech',
            validator: (val) => val && Object.keys(val).length > 0,
            fixInstructions: 'Add term mappings',
            nav: { tab: 'front-desk', section: 'vocabulary', field: 'vocabulary' },
            dbPath: 'aiAgentSettings.frontDeskBehavior.vocabulary',
            recommendedValue: {
                ac: 'air conditioner',
                'not cooling': 'blowing warm air',
                leaking: 'water leaking',
                frozen: 'ice on coil',
                busted: 'not working',
                broke: 'broken',
                'acting up': 'malfunctioning',
                wonky: 'not working properly'
            }
        },
        {
            fieldId: 'frontDesk.emotions',
            purpose: 'Detects caller emotional state',
            failureMode: 'Angry caller gets robotic response',
            impact: 'reliability',
            priority: 3,
            payoff: 'Better handling of frustrated callers',
            validator: (val) => val && Object.keys(val).length > 0,
            fixInstructions: 'Configure emotion detection',
            nav: { tab: 'front-desk', section: 'emotions', field: 'emotions' },
            dbPath: 'aiAgentSettings.frontDeskBehavior.emotions',
            recommendedValue: {
                enabled: true,
                detectAnger: true,
                detectFrustration: true,
                deescalationResponse: "I completely understand your frustration. Let me make sure we take care of this for you right away."
            }
        },
        {
            fieldId: 'frontDesk.frustration',
            purpose: 'De-escalation when caller is frustrated',
            failureMode: 'Frustrated caller not recognized, keeps getting script',
            impact: 'reliability',
            priority: 3,
            payoff: 'Reduces call abandonment from frustration',
            validator: (val) => val && Object.keys(val).length > 0,
            fixInstructions: 'Configure frustration handling',
            nav: { tab: 'front-desk', section: 'frustration', field: 'frustration' },
            dbPath: 'aiAgentSettings.frontDeskBehavior.frustration',
            recommendedValue: {
                enabled: true,
                triggerWords: ['frustrated', 'angry', 'upset', 'furious', 'ridiculous', 'unacceptable', 'terrible', 'awful', 'sick of this'],
                response: "I'm so sorry you're dealing with this. Your comfort is our priority - let me get this resolved for you right now."
            }
        },
        {
            fieldId: 'dataConfig.cheatSheets',
            purpose: 'Quick FAQ knowledge for common questions',
            failureMode: 'Simple FAQ goes to full LLM call',
            impact: 'speed',
            priority: 3,
            payoff: 'Faster FAQ responses, lower LLM costs',
            validator: (val) => val && (val.enabled === true || (Array.isArray(val.items) && val.items.length > 0)),
            fixInstructions: 'Add FAQ content via Cheat Sheet Editor → frontline-intel-editor.html',
            // NOTE: Cheat Sheets stored in separate CheatSheetVersion collection
            // Cannot auto-apply via Company doc - must use dedicated editor
            nav: { tab: 'data-config', section: 'template-references', field: 'templateReferences' },
            dbPath: 'CheatSheetVersion collection (companyId filter)',
            // Cannot auto-apply - uses separate collection, requires Frontline Intel Editor
            requiresUserInput: true,
            canAutoApply: false
        },
        {
            fieldId: 'dataConfig.placeholders',
            purpose: 'Dynamic values in responses ({companyName}, {phone})',
            failureMode: 'Hardcoded company name in all scenarios',
            impact: 'reliability',
            priority: 4,
            validator: (val) => val && Object.keys(val).length > 0,
            fixInstructions: 'Add company placeholders',
            nav: { tab: 'data-config', section: 'placeholders', field: 'placeholders' },
            dbPath: 'aiAgentSettings.dataConfig.placeholders',
            // No recommendedValue - requires user's actual company info
            requiresUserInput: true
        },
        {
            fieldId: 'dynamicFlow.companyFlows',
            purpose: 'Custom trigger-action automation',
            failureMode: 'No business-specific flow customization',
            impact: 'conversion',
            priority: 4,
            payoff: 'Custom flows for specific business needs',
            validator: (val) => Array.isArray(val) && val.length > 0,
            fixInstructions: 'Create company-specific flows',
            nav: { tab: 'dynamic-flow', section: 'company-flows', field: 'companyFlows' },
            dbPath: 'aiAgentSettings.dynamicFlow.companyFlows',
            // No recommendedValue - too business-specific
            requiresUserInput: true
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
                    nav: req.nav || null, // Navigation data for deep linking
                    currentValue: fieldValue,
                    currentStatus: fieldStatus,
                    // NEW: Include patch data for "Apply Fix" button
                    dbPath: req.dbPath || null,
                    recommendedValue: req.recommendedValue,
                    requiresUserInput: req.requiresUserInput || false,
                    canAutoApply: req.dbPath && req.recommendedValue !== undefined && !req.requiresUserInput
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

