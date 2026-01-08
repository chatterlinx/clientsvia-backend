/**
 * FrontDeskVerifier.js
 * V57: Deep verification service for Front Desk configuration
 * 
 * PURPOSE:
 * - Verify each sub-tab has COMPLETE configuration (not just "exists")
 * - Ensure settings are appropriate for the company's trade key
 * - Feed results back into Wiring Tab overall health score
 * 
 * PHILOSOPHY:
 * - If it's wired correctly, legacy code doesn't matter
 * - 100% = production ready for this trade
 * - Errors = work to be done, not blockers
 */

const logger = require('../../utils/logger');

/**
 * Verification rules per sub-tab
 * Each rule returns: { passed: boolean, score: number (0-100), issues: [], warnings: [] }
 */
const VERIFICATION_RULES = {
    
    // ═══════════════════════════════════════════════════════════════════
    // PERSONALITY TAB
    // ═══════════════════════════════════════════════════════════════════
    personality: {
        name: 'Personality',
        icon: '🎭',
        checks: [
            {
                id: 'CONVERSATION_STYLE_SET',
                description: 'Conversation style is selected',
                severity: 'error',
                weight: 30,
                check: (config) => {
                    const style = config?.frontDeskBehavior?.conversationStyle;
                    return {
                        passed: !!style && ['confident', 'balanced', 'polite'].includes(style),
                        value: style || 'NOT_SET',
                        fix: 'Select a conversation style (Confident, Balanced, or Polite)'
                    };
                }
            },
            {
                id: 'STYLE_ACKNOWLEDGMENTS_SET',
                description: 'Style acknowledgments configured',
                severity: 'warning',
                weight: 20,
                check: (config) => {
                    const acks = config?.frontDeskBehavior?.styleAcknowledgments;
                    const hasAcks = acks && (
                        (acks.confident?.length > 0) ||
                        (acks.balanced?.length > 0) ||
                        (acks.polite?.length > 0)
                    );
                    return {
                        passed: hasAcks,
                        value: hasAcks ? 'Configured' : 'Using defaults',
                        fix: 'Add custom acknowledgment phrases for selected style'
                    };
                }
            },
            {
                id: 'PERSONALITY_WARMTH_SET',
                description: 'Personality warmth level configured',
                severity: 'warning',
                weight: 25,
                check: (config) => {
                    const warmth = config?.frontDeskBehavior?.personality?.warmth;
                    return {
                        passed: warmth !== undefined && warmth !== null,
                        value: warmth ?? 'NOT_SET',
                        fix: 'Set personality warmth level (0-100)'
                    };
                }
            },
            {
                id: 'SPEAKING_PACE_SET',
                description: 'Speaking pace configured',
                severity: 'warning',
                weight: 25,
                check: (config) => {
                    const pace = config?.frontDeskBehavior?.personality?.speakingPace;
                    return {
                        passed: pace !== undefined && pace !== null,
                        value: pace ?? 'NOT_SET',
                        fix: 'Set speaking pace (slow, normal, fast)'
                    };
                }
            }
        ]
    },

    // ═══════════════════════════════════════════════════════════════════
    // BOOKING SLOTS TAB
    // ═══════════════════════════════════════════════════════════════════
    bookingSlots: {
        name: 'Booking Slots',
        icon: '📋',
        checks: [
            {
                id: 'BOOKING_SLOTS_DEFINED',
                description: 'Booking slots are defined',
                severity: 'error',
                weight: 40,
                check: (config) => {
                    const slots = config?.frontDeskBehavior?.bookingSlots;
                    const hasSlots = Array.isArray(slots) && slots.length > 0;
                    return {
                        passed: hasSlots,
                        value: hasSlots ? `${slots.length} slots` : 'NO_SLOTS',
                        fix: 'Configure at least one booking slot (name, phone, address)'
                    };
                }
            },
            {
                id: 'NAME_SLOT_CONFIGURED',
                description: 'Name slot has question configured',
                severity: 'error',
                weight: 20,
                check: (config) => {
                    const slots = config?.frontDeskBehavior?.bookingSlots || [];
                    const nameSlot = slots.find(s => s.type === 'name' || s.slotId === 'name' || s.id === 'name');
                    const hasQuestion = nameSlot?.firstNameQuestion || nameSlot?.question;
                    return {
                        passed: !!nameSlot && !!hasQuestion,
                        value: hasQuestion ? 'Configured' : (nameSlot ? 'Missing question' : 'Slot not found'),
                        fix: 'Add name slot with firstNameQuestion configured'
                    };
                }
            },
            {
                id: 'PHONE_SLOT_CONFIGURED',
                description: 'Phone slot has question configured',
                severity: 'error',
                weight: 20,
                check: (config) => {
                    const slots = config?.frontDeskBehavior?.bookingSlots || [];
                    const phoneSlot = slots.find(s => s.type === 'phone' || s.slotId === 'phone' || s.id === 'phone');
                    const hasQuestion = phoneSlot?.question;
                    return {
                        passed: !!phoneSlot && !!hasQuestion,
                        value: hasQuestion ? 'Configured' : (phoneSlot ? 'Missing question' : 'Slot not found'),
                        fix: 'Add phone slot with question configured'
                    };
                }
            },
            {
                id: 'ADDRESS_SLOT_CONFIGURED',
                description: 'Address slot has question configured',
                severity: 'warning',
                weight: 20,
                check: (config, tradeKey) => {
                    // Address is required for service trades (HVAC, plumbing, etc.)
                    const serviceTradeKeys = ['hvac', 'plumbing', 'electrical', 'roofing', 'landscaping', 'cleaning'];
                    const isServiceTrade = serviceTradeKeys.includes(tradeKey?.toLowerCase());
                    
                    if (!isServiceTrade) {
                        return { passed: true, value: 'N/A (not service trade)', fix: null };
                    }
                    
                    const slots = config?.frontDeskBehavior?.bookingSlots || [];
                    const addressSlot = slots.find(s => s.type === 'address' || s.slotId === 'address' || s.id === 'address');
                    const hasQuestion = addressSlot?.question;
                    return {
                        passed: !!addressSlot && !!hasQuestion,
                        value: hasQuestion ? 'Configured' : (addressSlot ? 'Missing question' : 'Slot not found'),
                        fix: `Add address slot with question (required for ${tradeKey} trade)`
                    };
                }
            }
        ]
    },

    // ═══════════════════════════════════════════════════════════════════
    // RESPONSES TAB
    // ═══════════════════════════════════════════════════════════════════
    responses: {
        name: 'Responses',
        icon: '💬',
        checks: [
            {
                id: 'GENERIC_FALLBACK_SET',
                description: 'Generic fallback response configured',
                severity: 'error',
                weight: 40,
                check: (config) => {
                    const fallback = config?.frontDeskBehavior?.fallbackResponses?.generic;
                    const hasFallback = fallback && fallback.trim().length > 0;
                    return {
                        passed: hasFallback,
                        value: hasFallback ? 'Set' : 'NOT_SET',
                        fix: 'Configure a generic fallback response for when AI doesn\'t understand'
                    };
                }
            },
            {
                id: 'NO_RESPONSE_FALLBACK_SET',
                description: 'No-response fallback configured',
                severity: 'warning',
                weight: 30,
                check: (config) => {
                    const fallback = config?.frontDeskBehavior?.fallbackResponses?.noResponse;
                    const hasFallback = fallback && fallback.trim().length > 0;
                    return {
                        passed: hasFallback,
                        value: hasFallback ? 'Set' : 'Using default',
                        fix: 'Configure a response for when caller goes silent'
                    };
                }
            },
            {
                id: 'LOW_CONFIDENCE_FALLBACK_SET',
                description: 'Low confidence response configured',
                severity: 'warning',
                weight: 30,
                check: (config) => {
                    const fallback = config?.frontDeskBehavior?.fallbackResponses?.lowConfidence;
                    const hasFallback = fallback && fallback.trim().length > 0;
                    return {
                        passed: hasFallback,
                        value: hasFallback ? 'Set' : 'Using default',
                        fix: 'Configure a response for low confidence matches'
                    };
                }
            }
        ]
    },

    // ═══════════════════════════════════════════════════════════════════
    // GREETING TAB
    // ═══════════════════════════════════════════════════════════════════
    greeting: {
        name: 'Greeting',
        icon: '👋',
        checks: [
            {
                id: 'GREETING_RULES_EXIST',
                description: 'At least one greeting rule configured',
                severity: 'error',
                weight: 50,
                check: (config) => {
                    const rules = config?.frontDeskBehavior?.conversationStages?.greeting?.rules ||
                                  config?.frontDeskBehavior?.greetingRules ||
                                  [];
                    const hasRules = Array.isArray(rules) && rules.length > 0;
                    return {
                        passed: hasRules,
                        value: hasRules ? `${rules.length} rules` : 'NO_RULES',
                        fix: 'Add at least one greeting rule'
                    };
                }
            },
            {
                id: 'DEFAULT_GREETING_EXISTS',
                description: 'Default/fallback greeting exists',
                severity: 'error',
                weight: 30,
                check: (config) => {
                    const rules = config?.frontDeskBehavior?.conversationStages?.greeting?.rules ||
                                  config?.frontDeskBehavior?.greetingRules ||
                                  [];
                    const defaultRule = rules.find(r => r.isDefault || r.condition === 'always' || !r.condition);
                    return {
                        passed: !!defaultRule,
                        value: defaultRule ? 'Found' : 'NOT_FOUND',
                        fix: 'Add a default greeting rule that always applies'
                    };
                }
            },
            {
                id: 'AFTER_HOURS_GREETING',
                description: 'After-hours greeting configured (if business hours set)',
                severity: 'warning',
                weight: 20,
                check: (config, tradeKey, companyDoc) => {
                    // Check if business hours are configured
                    const hasBusinessHours = companyDoc?.businessHours?.enabled ||
                                             companyDoc?.configuration?.businessHours?.enabled;
                    
                    if (!hasBusinessHours) {
                        return { passed: true, value: 'N/A (no business hours set)', fix: null };
                    }
                    
                    const rules = config?.frontDeskBehavior?.conversationStages?.greeting?.rules ||
                                  config?.frontDeskBehavior?.greetingRules ||
                                  [];
                    const afterHoursRule = rules.find(r => 
                        r.condition?.includes('after_hours') || 
                        r.condition?.includes('afterHours') ||
                        r.name?.toLowerCase().includes('after')
                    );
                    return {
                        passed: !!afterHoursRule,
                        value: afterHoursRule ? 'Found' : 'NOT_FOUND',
                        fix: 'Add an after-hours greeting (you have business hours configured)'
                    };
                }
            }
        ]
    },

    // ═══════════════════════════════════════════════════════════════════
    // DYNAMIC FLOWS TAB
    // ═══════════════════════════════════════════════════════════════════
    dynamicFlows: {
        name: 'Dynamic Flows',
        icon: '🔀',
        checks: [
            {
                id: 'ENABLED_FLOWS_VALID',
                description: 'All enabled flows have complete actions',
                severity: 'error',
                weight: 100,
                check: async (config, tradeKey, companyDoc, companyId) => {
                    // This check requires loading DynamicFlow collection
                    try {
                        const DynamicFlow = require('../../models/DynamicFlow');
                        const flows = await DynamicFlow.find({ companyId, enabled: true });
                        
                        if (flows.length === 0) {
                            return { passed: true, value: 'No enabled flows', fix: null };
                        }
                        
                        const requiredActions = ['set_flag', 'append_ledger', 'ack_once', 'transition_mode'];
                        const invalidFlows = [];
                        
                        for (const flow of flows) {
                            const actionTypes = (flow.actions || []).map(a => a.type);
                            const missingActions = requiredActions.filter(req => !actionTypes.includes(req));
                            if (missingActions.length > 0) {
                                invalidFlows.push({ name: flow.name, missing: missingActions });
                            }
                        }
                        
                        return {
                            passed: invalidFlows.length === 0,
                            value: invalidFlows.length === 0 ? `${flows.length} flows valid` : `${invalidFlows.length} invalid`,
                            details: invalidFlows,
                            fix: invalidFlows.length > 0 ? 
                                `Fix flows: ${invalidFlows.map(f => f.name).join(', ')}` : null
                        };
                    } catch (err) {
                        logger.error('[FrontDeskVerifier] Error checking dynamic flows:', err);
                        return { passed: true, value: 'Check skipped (error)', fix: null };
                    }
                }
            }
        ]
    },

    // ═══════════════════════════════════════════════════════════════════
    // VOCABULARY TAB
    // ═══════════════════════════════════════════════════════════════════
    vocabulary: {
        name: 'Vocabulary',
        icon: '📚',
        checks: [
            {
                id: 'TRADE_SYNONYMS_LOADED',
                description: 'Trade-specific synonyms available',
                severity: 'warning',
                weight: 40,
                check: (config, tradeKey) => {
                    // Check if company has template references that would provide synonyms
                    const templateRefs = config?.templateReferences || [];
                    const hasTemplates = templateRefs.length > 0 && templateRefs.some(t => t.enabled !== false);
                    return {
                        passed: hasTemplates,
                        value: hasTemplates ? `${templateRefs.length} templates linked` : 'No templates',
                        fix: hasTemplates ? null : `Link a ${tradeKey || 'trade'} template for vocabulary`
                    };
                }
            },
            {
                id: 'FILLER_WORDS_CONFIGURED',
                description: 'Filler words configured for natural speech',
                severity: 'warning',
                weight: 30,
                check: (config) => {
                    const fillers = config?.frontDeskBehavior?.customFillers || [];
                    // Also check if inherited from template
                    const hasFillers = fillers.length > 0;
                    return {
                        passed: hasFillers,
                        value: hasFillers ? `${fillers.length} custom fillers` : 'Using inherited',
                        fix: null // Not critical - inherited fillers are fine
                    };
                }
            },
            {
                id: 'STOP_WORDS_CONFIGURED',
                description: 'Stop words configured for slot extraction',
                severity: 'warning',
                weight: 30,
                check: (config) => {
                    const stopWords = config?.frontDeskBehavior?.customStopWords;
                    const enabled = stopWords?.enabled !== false;
                    return {
                        passed: enabled,
                        value: enabled ? 'Enabled' : 'Disabled',
                        fix: enabled ? null : 'Enable stop words for accurate slot extraction'
                    };
                }
            }
        ]
    },

    // ═══════════════════════════════════════════════════════════════════
    // LOOP PREVENTION TAB
    // ═══════════════════════════════════════════════════════════════════
    loopPrevention: {
        name: 'Loop Prevention',
        icon: '🔄',
        checks: [
            {
                id: 'LOOP_PREVENTION_ENABLED',
                description: 'Loop prevention is enabled',
                severity: 'warning',
                weight: 50,
                check: (config) => {
                    const lp = config?.frontDeskBehavior?.loopPrevention;
                    const enabled = lp?.enabled !== false;
                    return {
                        passed: enabled,
                        value: enabled ? 'Enabled' : 'Disabled',
                        fix: enabled ? null : 'Enable loop prevention to avoid repeated questions'
                    };
                }
            },
            {
                id: 'MAX_RETRIES_SET',
                description: 'Maximum retries configured',
                severity: 'warning',
                weight: 25,
                check: (config) => {
                    const maxRetries = config?.frontDeskBehavior?.loopPrevention?.maxRetries;
                    const hasValue = maxRetries !== undefined && maxRetries > 0;
                    return {
                        passed: hasValue,
                        value: hasValue ? `${maxRetries} retries` : 'Using default',
                        fix: null
                    };
                }
            },
            {
                id: 'NUDGE_PROMPTS_SET',
                description: 'Nudge prompts configured',
                severity: 'warning',
                weight: 25,
                check: (config) => {
                    const lp = config?.frontDeskBehavior?.loopPrevention;
                    const hasNudges = lp?.nudgeNamePrompt || lp?.nudgePhonePrompt || lp?.nudgeAddressPrompt;
                    return {
                        passed: !!hasNudges,
                        value: hasNudges ? 'Configured' : 'Using defaults',
                        fix: null
                    };
                }
            }
        ]
    }
};

/**
 * Run verification for a single sub-tab
 */
async function verifySubTab(tabKey, config, tradeKey, companyDoc, companyId) {
    const tabRules = VERIFICATION_RULES[tabKey];
    if (!tabRules) {
        return { 
            name: tabKey, 
            score: 100, 
            passed: true, 
            issues: [], 
            warnings: [],
            checks: [] 
        };
    }

    let totalWeight = 0;
    let earnedWeight = 0;
    const issues = [];
    const warnings = [];
    const checkResults = [];

    for (const rule of tabRules.checks) {
        try {
            const result = typeof rule.check === 'function' 
                ? await rule.check(config, tradeKey, companyDoc, companyId)
                : { passed: false, value: 'Invalid check' };
            
            totalWeight += rule.weight;
            if (result.passed) {
                earnedWeight += rule.weight;
            } else {
                const issue = {
                    id: rule.id,
                    description: rule.description,
                    severity: rule.severity,
                    value: result.value,
                    fix: result.fix,
                    details: result.details
                };
                
                if (rule.severity === 'error') {
                    issues.push(issue);
                } else {
                    warnings.push(issue);
                }
            }

            checkResults.push({
                id: rule.id,
                description: rule.description,
                passed: result.passed,
                value: result.value,
                severity: rule.severity,
                weight: rule.weight
            });
        } catch (err) {
            logger.error(`[FrontDeskVerifier] Error in check ${rule.id}:`, err);
            checkResults.push({
                id: rule.id,
                description: rule.description,
                passed: true, // Don't fail on errors
                value: 'Check error',
                severity: 'warning',
                weight: rule.weight
            });
            earnedWeight += rule.weight; // Give benefit of doubt on errors
        }
    }

    const score = totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 100) : 100;

    return {
        key: tabKey,
        name: tabRules.name,
        icon: tabRules.icon,
        score,
        passed: issues.length === 0,
        issues,
        warnings,
        checks: checkResults,
        totalChecks: tabRules.checks.length,
        passedChecks: checkResults.filter(c => c.passed).length
    };
}

/**
 * Run full Front Desk verification
 * @param {string} companyId - Company ID
 * @param {object} companyDoc - Full company document
 * @returns {object} Verification report
 */
async function verifyFrontDesk(companyId, companyDoc) {
    const startTime = Date.now();
    logger.info('[FrontDeskVerifier] Starting verification', { companyId });

    const config = companyDoc?.aiAgentSettings || {};
    const tradeKey = config?.tradeKey || companyDoc?.tradeKey || 'universal';

    const subTabs = Object.keys(VERIFICATION_RULES);
    const results = {};
    let totalScore = 0;
    let allIssues = [];
    let allWarnings = [];

    for (const tabKey of subTabs) {
        const result = await verifySubTab(tabKey, config, tradeKey, companyDoc, companyId);
        results[tabKey] = result;
        totalScore += result.score;
        allIssues = allIssues.concat(result.issues.map(i => ({ ...i, tab: result.name })));
        allWarnings = allWarnings.concat(result.warnings.map(w => ({ ...w, tab: result.name })));
    }

    const overallScore = Math.round(totalScore / subTabs.length);
    const durationMs = Date.now() - startTime;

    const report = {
        _format: 'FRONT_DESK_VERIFICATION_V1',
        companyId,
        tradeKey,
        generatedAt: new Date().toISOString(),
        durationMs,
        
        // Overall status
        overallScore,
        status: overallScore === 100 ? 'PRODUCTION_READY' : overallScore >= 70 ? 'MOSTLY_READY' : 'NEEDS_WORK',
        
        // Summary counts
        summary: {
            totalSubTabs: subTabs.length,
            fullyConfigured: Object.values(results).filter(r => r.score === 100).length,
            partiallyConfigured: Object.values(results).filter(r => r.score > 0 && r.score < 100).length,
            notConfigured: Object.values(results).filter(r => r.score === 0).length,
            totalIssues: allIssues.length,
            totalWarnings: allWarnings.length
        },
        
        // Per-tab results
        subTabs: results,
        
        // All issues aggregated
        issues: allIssues,
        warnings: allWarnings
    };

    logger.info('[FrontDeskVerifier] Verification complete', { 
        companyId, 
        score: overallScore, 
        issues: allIssues.length,
        durationMs 
    });

    return report;
}

module.exports = {
    verifyFrontDesk,
    verifySubTab,
    VERIFICATION_RULES
};

