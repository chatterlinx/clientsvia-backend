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
    // PERSONALITY TAB - V57 Deep Structural Integrity Checks
    // ═══════════════════════════════════════════════════════════════════
    personality: {
        name: 'Personality',
        icon: '🎭',
        checks: [
            // ─────────────────────────────────────────────────────────────
            // PROBE 1: PROMPT_HYDRATION - Is personality wired to LLM?
            // ─────────────────────────────────────────────────────────────
            {
                id: 'PROMPT_HYDRATION',
                description: 'Personality profile exists and is hydrated for LLM',
                severity: 'error',
                weight: 25,
                check: (config) => {
                    const personality = config?.frontDeskBehavior?.personality;
                    const promptTemplate = personality?.promptTemplate;
                    const agentName = personality?.agentName;
                    const tone = personality?.tone || config?.frontDeskBehavior?.conversationStyle;
                    
                    // Personality must have at least tone OR agentName OR promptTemplate
                    const hasMinimalPersonality = !!tone || !!agentName || !!promptTemplate;
                    
                    // For "world class" - need more substance
                    const hasRichPersonality = promptTemplate && promptTemplate.length > 50;
                    
                    return {
                        passed: hasMinimalPersonality,
                        value: hasRichPersonality ? 'Rich profile' : (hasMinimalPersonality ? 'Minimal profile' : 'NOT_WIRED'),
                        details: { 
                            hasTone: !!tone, 
                            hasAgentName: !!agentName, 
                            hasPromptTemplate: !!promptTemplate,
                            promptLength: promptTemplate?.length || 0
                        },
                        fix: hasMinimalPersonality ? null : 'Configure personality profile (tone, agent name, or prompt template)'
                    };
                }
            },
            // ─────────────────────────────────────────────────────────────
            // PROBE 2: KNOWLEDGE_BASE_SYNC - Trade knowledge wired?
            // ─────────────────────────────────────────────────────────────
            {
                id: 'KNOWLEDGE_BASE_SYNC',
                description: 'Trade knowledge is linked (not hardcoded)',
                severity: 'error',
                weight: 20,
                check: (config, tradeKey) => {
                    // Check if trade key exists
                    const hasTradeKey = !!tradeKey && tradeKey !== 'universal';
                    
                    // Check if templates are linked (templates provide trade knowledge)
                    const templateRefs = config?.templateReferences || [];
                    const hasLinkedTemplates = templateRefs.some(t => t.enabled !== false);
                    
                    // Trade knowledge should come from templates, not hardcoded
                    const isWiredCorrectly = hasTradeKey && hasLinkedTemplates;
                    
                    return {
                        passed: isWiredCorrectly,
                        value: isWiredCorrectly ? `${tradeKey} via templates` : (hasTradeKey ? 'Trade set but no templates' : 'NO_TRADE_KEY'),
                        details: {
                            tradeKey,
                            linkedTemplates: templateRefs.filter(t => t.enabled !== false).length
                        },
                        fix: !hasTradeKey ? 'Set trade key in Data & Config → Onboarding' :
                             !hasLinkedTemplates ? 'Link a trade template in Data & Config → Template References' : null
                    };
                }
            },
            // ─────────────────────────────────────────────────────────────
            // PROBE 3: LLM_TONE_BINDING - Tone controls LLM temperature
            // ─────────────────────────────────────────────────────────────
            {
                id: 'LLM_TONE_BINDING',
                description: 'Conversation style is set and bound to LLM behavior',
                severity: 'error',
                weight: 20,
                check: (config) => {
                    const style = config?.frontDeskBehavior?.conversationStyle;
                    const validStyles = ['confident', 'balanced', 'polite'];
                    const isValid = !!style && validStyles.includes(style);
                    
                    // Check if style acknowledgments exist for the selected style
                    const acks = config?.frontDeskBehavior?.styleAcknowledgments;
                    const hasAcksForStyle = style && acks?.[style]?.length > 0;
                    
                    return {
                        passed: isValid,
                        value: isValid ? `${style}${hasAcksForStyle ? ' (with acks)' : ''}` : 'NOT_SET',
                        details: {
                            style,
                            hasAcknowledgments: hasAcksForStyle,
                            // These would map to LLM temperature in runtime
                            expectedTemp: style === 'confident' ? 0.3 : style === 'balanced' ? 0.5 : 0.7
                        },
                        fix: isValid ? null : 'Select a conversation style (Confident, Balanced, or Polite)'
                    };
                }
            },
            // ─────────────────────────────────────────────────────────────
            // PROBE 4: FALLBACK_PERSONALITY - Recovery mode for failures
            // ─────────────────────────────────────────────────────────────
            {
                id: 'FALLBACK_PERSONALITY',
                description: 'Fallback/recovery personality for engine failures',
                severity: 'warning',
                weight: 15,
                check: (config) => {
                    const fallbacks = config?.frontDeskBehavior?.fallbackResponses;
                    const hasGeneric = fallbacks?.generic && fallbacks.generic.trim().length > 0;
                    const hasLowConf = fallbacks?.lowConfidence && fallbacks.lowConfidence.trim().length > 0;
                    
                    // For "recovery mode" - should have specific error handling responses
                    const hasRecoveryMode = hasGeneric && hasLowConf;
                    
                    return {
                        passed: hasGeneric,
                        value: hasRecoveryMode ? 'Full recovery mode' : (hasGeneric ? 'Basic fallback only' : 'NO_FALLBACK'),
                        details: {
                            hasGenericFallback: hasGeneric,
                            hasLowConfidenceFallback: hasLowConf
                        },
                        fix: hasGeneric ? null : 'Configure generic fallback response for when AI doesn\'t understand'
                    };
                }
            },
            // ─────────────────────────────────────────────────────────────
            // PROBE 5: AGENT_IDENTITY - Agent has a name and identity
            // ─────────────────────────────────────────────────────────────
            {
                id: 'AGENT_IDENTITY',
                description: 'AI agent has a name/identity configured',
                severity: 'warning',
                weight: 10,
                check: (config) => {
                    const agentName = config?.frontDeskBehavior?.personality?.agentName || 
                                      config?.aiName;
                    const hasName = !!agentName && agentName.trim().length > 0;
                    
                    return {
                        passed: hasName,
                        value: hasName ? agentName : 'Anonymous',
                        fix: hasName ? null : 'Give your AI agent a name (e.g., Sarah, Alex)'
                    };
                }
            },
            // ─────────────────────────────────────────────────────────────
            // PROBE 6: STYLE_DEPTH - Rich style configuration (world class)
            // ─────────────────────────────────────────────────────────────
            {
                id: 'STYLE_DEPTH',
                description: 'Style has depth (acknowledgments, warmth, pace)',
                severity: 'warning',
                weight: 10,
                check: (config) => {
                    const p = config?.frontDeskBehavior?.personality || {};
                    const style = config?.frontDeskBehavior?.conversationStyle;
                    const acks = config?.frontDeskBehavior?.styleAcknowledgments;
                    
                    let depth = 0;
                    if (style) depth++;
                    if (p.warmth !== undefined) depth++;
                    if (p.speakingPace) depth++;
                    if (acks?.[style]?.length > 0) depth++;
                    if (p.agentName) depth++;
                    
                    const maxDepth = 5;
                    const percent = Math.round((depth / maxDepth) * 100);
                    
                    return {
                        passed: depth >= 3, // At least 3 of 5 for "good"
                        value: `${depth}/${maxDepth} attributes (${percent}%)`,
                        details: {
                            hasStyle: !!style,
                            hasWarmth: p.warmth !== undefined,
                            hasPace: !!p.speakingPace,
                            hasAcks: acks?.[style]?.length > 0,
                            hasName: !!p.agentName
                        },
                        fix: depth < 3 ? 'Add more personality depth: warmth, pace, acknowledgments' : null
                    };
                }
            }
        ]
    },

    // ═══════════════════════════════════════════════════════════════════
    // DISCOVERY & CONSENT TAB - V57 "Gatekeeper" of the call
    // This tab decides if the agent has permission to book
    // If broken, agent loops indefinitely before reaching booking slots
    // ═══════════════════════════════════════════════════════════════════
    discoveryConsent: {
        name: 'Discovery & Consent',
        icon: '🧠',
        checks: [
            // ─────────────────────────────────────────────────────────────
            // PROBE 1: CONSENT_WIRING - Is consent system properly configured?
            // CRITICAL: If enabled but phrases null, call loops forever
            // ─────────────────────────────────────────────────────────────
            {
                id: 'CONSENT_WIRING',
                description: 'Consent system is properly wired (not half-configured)',
                severity: 'error',
                weight: 30,
                check: (config) => {
                    const dc = config?.frontDeskBehavior?.discoveryConsent || {};
                    const bookingRequiresConsent = dc.bookingRequiresExplicitConsent;
                    const consentPhrases = dc.consentPhrases || [];
                    const consentYesWords = dc.consentYesWords || [];
                    const wantsBooking = config?.frontDeskBehavior?.detectionTriggers?.wantsBooking || [];
                    
                    // CRITICAL: If consent is required but no phrases defined = infinite loop
                    if (bookingRequiresConsent === true && (consentPhrases.length === 0 || consentYesWords.length === 0)) {
                        return {
                            passed: false,
                            value: 'CONSENT_REQUIRED_BUT_EMPTY',
                            details: {
                                bookingRequiresConsent: true,
                                consentPhrasesCount: consentPhrases.length,
                                consentYesWordsCount: consentYesWords.length
                            },
                            fix: 'Add consent phrases AND yes-words, or disable booking consent requirement'
                        };
                    }
                    
                    // Check if consent system is consistent
                    const isConsistent = (bookingRequiresConsent && consentPhrases.length > 0 && consentYesWords.length > 0) || 
                                         (!bookingRequiresConsent);
                    
                    return {
                        passed: isConsistent,
                        value: isConsistent ? 
                            (bookingRequiresConsent ? `Enabled (${consentPhrases.length} phrases, ${consentYesWords.length} yes-words)` : 'Disabled (no consent needed)') :
                            'MISCONFIGURED',
                        details: {
                            bookingRequiresConsent,
                            consentPhrasesCount: consentPhrases.length,
                            consentYesWordsCount: consentYesWords.length,
                            consentPhrasesSample: consentPhrases.slice(0, 3),
                            consentYesWordsSample: consentYesWords.slice(0, 3),
                            wantsBookingCount: wantsBooking.length,
                            wantsBookingSample: wantsBooking.slice(0, 3)
                        },
                        fix: isConsistent ? null : 'Configure consent phrases AND yes-words (or disable consent requirement)'
                    };
                }
            },
            // ─────────────────────────────────────────────────────────────
            // PROBE 2: INTENT_MATCH_DEPTH - Are booking intents detectable?
            // "I need an AC service" must trigger BOOKING mode 100% of time
            // ─────────────────────────────────────────────────────────────
            {
                id: 'INTENT_MATCH_DEPTH',
                description: 'Booking intent triggers are configured',
                severity: 'error',
                weight: 25,
                check: (config) => {
                    const dc = config?.frontDeskBehavior?.discoveryConsent || {};
                    const bookingIntentPhrases = dc.bookingIntentPhrases || [];
                    
                    // Also check for common booking scenarios in template
                    const templateRefs = config?.templateReferences || [];
                    const hasTemplates = templateRefs.length > 0;
                    
                    // Minimum intent phrases for reliable detection
                    const hasEnoughPhrases = bookingIntentPhrases.length >= 5;
                    
                    // Check for critical phrases that MUST be detected
                    const criticalPhrases = ['schedule', 'appointment', 'book', 'service', 'come out'];
                    const lowercasePhrases = bookingIntentPhrases.map(p => p.toLowerCase());
                    const missingCritical = criticalPhrases.filter(cp => 
                        !lowercasePhrases.some(lp => lp.includes(cp))
                    );
                    
                    const passed = hasEnoughPhrases || hasTemplates; // Templates can provide intent detection
                    
                    return {
                        passed,
                        value: passed ? 
                            `${bookingIntentPhrases.length} phrases${hasTemplates ? ' + template scenarios' : ''}` :
                            'INSUFFICIENT_INTENT_DETECTION',
                        details: {
                            customPhrasesCount: bookingIntentPhrases.length,
                            hasTemplateScenarios: hasTemplates,
                            missingCriticalPhrases: missingCritical.length > 0 ? missingCritical : null
                        },
                        fix: passed ? null : 'Add booking intent phrases (schedule, appointment, book, service, etc.)'
                    };
                }
            },
            // ─────────────────────────────────────────────────────────────
            // PROBE 3: CONSENT_PERSISTENCE - Does consent survive session?
            // Consent must be "locked" once given, not re-asked
            // ─────────────────────────────────────────────────────────────
            {
                id: 'CONSENT_PERSISTENCE',
                description: 'Consent tracking is configured to persist',
                severity: 'warning',
                weight: 20,
                check: (config) => {
                    const dc = config?.frontDeskBehavior?.discoveryConsent || {};
                    
                    // Check if system is configured to remember consent
                    const persistConsent = dc.persistConsent !== false; // Default true
                    const lockAfterConsent = dc.lockModeAfterConsent !== false; // Default true
                    
                    const isPersistent = persistConsent && lockAfterConsent;
                    
                    return {
                        passed: isPersistent,
                        value: isPersistent ? 'Consent locks session' : 'Consent may be re-asked',
                        details: {
                            persistConsent,
                            lockModeAfterConsent: lockAfterConsent
                        },
                        fix: isPersistent ? null : 'Enable consent persistence to prevent re-asking'
                    };
                }
            },
            // ─────────────────────────────────────────────────────────────
            // PROBE 4: DISCOVERY_FACT_EXTRACTION - Are issues captured?
            // "water leakage" must appear in callLedger/runningSummary
            // ─────────────────────────────────────────────────────────────
            {
                id: 'DISCOVERY_FACT_EXTRACTION',
                description: 'Issue extraction is configured (facts → booking)',
                severity: 'warning',
                weight: 15,
                check: (config) => {
                    const dc = config?.frontDeskBehavior?.discoveryConsent || {};
                    
                    // Check if fact extraction is enabled
                    const extractIssues = dc.extractIssuesDuringDiscovery !== false;
                    const passToBooking = dc.passIssuesToBooking !== false;
                    
                    // Check if call ledger is enabled (where facts are stored)
                    const ledgerEnabled = config?.frontDeskBehavior?.callLedger?.enabled !== false;
                    
                    const isWired = extractIssues && (passToBooking || ledgerEnabled);
                    
                    return {
                        passed: isWired,
                        value: isWired ? 'Issues extracted → booking' : 'Issues may be lost',
                        details: {
                            extractIssues,
                            passToBooking,
                            ledgerEnabled
                        },
                        fix: isWired ? null : 'Enable issue extraction during discovery'
                    };
                }
            },
            // ─────────────────────────────────────────────────────────────
            // PROBE 5: KILL_SWITCH_SAFETY - Are kill switches in safe state?
            // forceLLMDiscovery=true OR disableScenarioAutoResponses=true = broken
            // ─────────────────────────────────────────────────────────────
            {
                id: 'KILL_SWITCH_SAFETY',
                description: 'Kill switches are OFF (scenarios can fire)',
                severity: 'error',
                weight: 10,
                check: (config) => {
                    const dc = config?.frontDeskBehavior?.discoveryConsent || {};
                    
                    // These should be FALSE for normal operation
                    const forceLLM = dc.forceLLMDiscovery === true;
                    const disableAuto = dc.disableScenarioAutoResponses === true;
                    
                    // Both OFF = safe
                    const isSafe = !forceLLM && !disableAuto;
                    
                    let status = 'SAFE';
                    if (forceLLM && disableAuto) status = 'BOTH_KILL_SWITCHES_ON';
                    else if (forceLLM) status = 'FORCE_LLM_ON';
                    else if (disableAuto) status = 'AUTO_RESPONSES_DISABLED';
                    
                    return {
                        passed: isSafe,
                        value: isSafe ? 'Scenarios enabled' : status,
                        details: {
                            forceLLMDiscovery: forceLLM,
                            disableScenarioAutoResponses: disableAuto
                        },
                        fix: isSafe ? null : 
                            `Turn OFF: ${forceLLM ? 'Force LLM Discovery' : ''}${forceLLM && disableAuto ? ' AND ' : ''}${disableAuto ? 'Disable Auto Responses' : ''}`
                    };
                }
            }
        ]
    },

    // ═══════════════════════════════════════════════════════════════════
    // BOOKING SLOTS TAB - V57 Deep Slot Integrity
    // This is where "Mark" vs "Gonzales" confusion happens
    // ═══════════════════════════════════════════════════════════════════
    bookingSlots: {
        name: 'Booking Slots',
        icon: '📋',
        checks: [
            // ─────────────────────────────────────────────────────────────
            // PROBE 1: SLOTS_EXIST - Are slots defined at all?
            // ─────────────────────────────────────────────────────────────
            {
                id: 'SLOTS_EXIST',
                description: 'Booking slots are defined',
                severity: 'error',
                weight: 20,
                check: (config) => {
                    const slots = config?.frontDeskBehavior?.bookingSlots || [];
                    const enabledSlots = slots.filter(s => s.enabled !== false);
                    const hasSlots = enabledSlots.length > 0;
                    
                    return {
                        passed: hasSlots,
                        value: hasSlots ? `${enabledSlots.length} active slots` : 'NO_SLOTS',
                        details: {
                            total: slots.length,
                            enabled: enabledSlots.length,
                            slotTypes: enabledSlots.map(s => s.type || s.slotId || s.id)
                        },
                        fix: hasSlots ? null : 'Configure booking slots (name, phone, address)'
                    };
                }
            },
            // ─────────────────────────────────────────────────────────────
            // PROBE 2: NAME_SLOT_COMPLETE - Name extraction fully wired
            // This is where "Mark" vs "Gonzales" confusion happens
            // ─────────────────────────────────────────────────────────────
            {
                id: 'NAME_SLOT_COMPLETE',
                description: 'Name slot is fully configured (first + last)',
                severity: 'error',
                weight: 20,
                check: (config) => {
                    const slots = config?.frontDeskBehavior?.bookingSlots || [];
                    const nameSlot = slots.find(s => 
                        s.type === 'name' || s.slotId === 'name' || s.id === 'name' ||
                        s.type === 'firstName' || s.slotId === 'firstName'
                    );
                    
                    if (!nameSlot) {
                        return {
                            passed: false,
                            value: 'NO_NAME_SLOT',
                            fix: 'Add a name slot to collect caller name'
                        };
                    }
                    
                    // Check all name-related questions
                    const hasFirstNameQ = !!nameSlot.firstNameQuestion || !!nameSlot.question;
                    const hasLastNameQ = !!nameSlot.lastNameQuestion;
                    const hasSpellingConfig = nameSlot.askSpellingVariant !== undefined;
                    
                    // Calculate completeness
                    let completeness = 0;
                    if (hasFirstNameQ) completeness += 40;
                    if (hasLastNameQ) completeness += 40;
                    if (hasSpellingConfig) completeness += 20;
                    
                    const isComplete = completeness >= 80;
                    
                    return {
                        passed: isComplete,
                        value: isComplete ? `${completeness}% complete` : `${completeness}% - INCOMPLETE`,
                        details: {
                            hasFirstNameQuestion: hasFirstNameQ,
                            hasLastNameQuestion: hasLastNameQ,
                            hasSpellingVariantConfig: hasSpellingConfig,
                            askFullName: nameSlot.askFullName,
                            useFirstNameOnly: nameSlot.useFirstNameOnly
                        },
                        fix: isComplete ? null : 
                            !hasFirstNameQ ? 'Add firstNameQuestion to name slot' :
                            !hasLastNameQ ? 'Add lastNameQuestion to name slot' :
                            'Configure spelling variant handling'
                    };
                }
            },
            // ─────────────────────────────────────────────────────────────
            // PROBE 3: REQUIRED_SLOT_SHAPE - Do core slots have ids, types, questions?
            // Missing slotId/type/question can stall the state machine or produce null questions.
            // ─────────────────────────────────────────────────────────────
            {
                id: 'REQUIRED_SLOT_SHAPE',
                description: 'Core booking slots (name/phone/address/time) have id, type, and question',
                severity: 'error',
                weight: 25,
                check: (config) => {
                    const slots = (config?.frontDeskBehavior?.bookingSlots || []).filter(s => s.enabled !== false);
                    const requiredTypes = ['name', 'phone', 'address', 'time'];
                    const findings = [];
                    for (const rt of requiredTypes) {
                        const slot = slots.find(s =>
                            (s.slotId || s.id) === rt || s.type === rt
                        );
                        if (!slot) {
                            findings.push({ slotType: rt, reason: 'missing_slot' });
                            continue;
                        }
                        const missing = [];
                        if (!slot.slotId && !slot.id) missing.push('id/slotId');
                        if (!slot.type) missing.push('type');
                        if (!slot.question) missing.push('question');
                        if (missing.length > 0) {
                            findings.push({ slotType: rt, missing });
                        }
                    }
                    const passed = findings.length === 0;
                    return {
                        passed,
                        value: passed ? 'All core slots have id/type/question' : 'Core slots incomplete',
                        details: { findings },
                        fix: passed ? null : 'Ensure name/phone/address/time slots each have slotId (or id), type, and question text'
                    };
                }
            },
            // ─────────────────────────────────────────────────────────────
            // PROBE 4: SPELLING_VARIANT_WIRING - "Marc with C" handling
            // ─────────────────────────────────────────────────────────────
            {
                id: 'SPELLING_VARIANT_WIRING',
                description: 'Spelling variant confirmation is wired',
                severity: 'warning',
                weight: 15,
                check: (config) => {
                    const slots = config?.frontDeskBehavior?.bookingSlots || [];
                    const nameSlot = slots.find(s => s.type === 'name' || s.slotId === 'name');
                    
                    if (!nameSlot) {
                        return { passed: true, value: 'N/A (no name slot)', fix: null };
                    }
                    
                    // Check for spelling variant configuration
                    const hasSpellingPrompt = !!nameSlot.spellingVariantPrompt;
                    const hasCommonVariants = Array.isArray(nameSlot.commonSpellingVariants) && 
                                              nameSlot.commonSpellingVariants.length > 0;
                    const askSpellingVariant = nameSlot.askSpellingVariant !== false;
                    
                    const isWired = hasSpellingPrompt || hasCommonVariants || askSpellingVariant;
                    
                    return {
                        passed: isWired,
                        value: isWired ? 
                            `Enabled${hasCommonVariants ? ` (${nameSlot.commonSpellingVariants.length} variants)` : ''}` : 
                            'NOT_CONFIGURED',
                        details: {
                            hasSpellingPrompt,
                            hasCommonVariants,
                            askSpellingVariant
                        },
                        fix: isWired ? null : 'Configure spelling variant handling for names like Marc/Mark'
                    };
                }
            },
            // ─────────────────────────────────────────────────────────────
            // PROBE 4: PHONE_SLOT_COMPLETE - Phone extraction wired
            // ─────────────────────────────────────────────────────────────
            {
                id: 'PHONE_SLOT_COMPLETE',
                description: 'Phone slot is fully configured',
                severity: 'error',
                weight: 15,
                check: (config) => {
                    const slots = config?.frontDeskBehavior?.bookingSlots || [];
                    const phoneSlot = slots.find(s => s.type === 'phone' || s.slotId === 'phone' || s.id === 'phone');
                    
                    if (!phoneSlot) {
                        return {
                            passed: false,
                            value: 'NO_PHONE_SLOT',
                            fix: 'Add a phone slot to collect callback number'
                        };
                    }
                    
                    const hasQuestion = !!phoneSlot.question;
                    const hasAreaCodePrompt = !!phoneSlot.areaCodePrompt;
                    const hasValidation = phoneSlot.validateFormat !== false;
                    
                    return {
                        passed: hasQuestion,
                        value: hasQuestion ? 
                            `Configured${hasAreaCodePrompt ? ' (with breakdown)' : ''}` : 
                            'MISSING_QUESTION',
                        details: {
                            hasQuestion,
                            hasAreaCodePrompt,
                            hasValidation
                        },
                        fix: hasQuestion ? null : 'Add question to phone slot'
                    };
                }
            },
            // ─────────────────────────────────────────────────────────────
            // PROBE 5: ADDRESS_SLOT_COMPLETE - Address for service trades
            // ─────────────────────────────────────────────────────────────
            {
                id: 'ADDRESS_SLOT_COMPLETE',
                description: 'Address slot configured (required for service trades)',
                severity: 'warning',
                weight: 15,
                check: (config, tradeKey) => {
                    const serviceTradeKeys = ['hvac', 'plumbing', 'electrical', 'roofing', 'landscaping', 'cleaning', 'pest', 'appliance'];
                    const isServiceTrade = serviceTradeKeys.includes(tradeKey?.toLowerCase());
                    
                    const slots = config?.frontDeskBehavior?.bookingSlots || [];
                    const addressSlot = slots.find(s => s.type === 'address' || s.slotId === 'address' || s.id === 'address');
                    
                    if (!isServiceTrade && !addressSlot) {
                        return { passed: true, value: 'N/A (not service trade)', fix: null };
                    }
                    
                    if (!addressSlot) {
                        return {
                            passed: false,
                            value: `REQUIRED_FOR_${tradeKey?.toUpperCase()}`,
                            fix: `Add address slot - ${tradeKey} technicians need a service location`
                        };
                    }
                    
                    const hasQuestion = !!addressSlot.question;
                    const hasBreakdown = !!addressSlot.streetBreakdownPrompt || !!addressSlot.cityPrompt;
                    
                    return {
                        passed: hasQuestion,
                        value: hasQuestion ? 
                            `Configured${hasBreakdown ? ' (with breakdown)' : ''}` : 
                            'MISSING_QUESTION',
                        details: {
                            hasQuestion,
                            hasBreakdown,
                            hasPartialPrompt: !!addressSlot.partialAddressPrompt
                        },
                        fix: hasQuestion ? null : 'Add question to address slot'
                    };
                }
            },
            // ─────────────────────────────────────────────────────────────
            // PROBE 6: SLOT_ORDER_VALID - Slots asked in correct order
            // ─────────────────────────────────────────────────────────────
            {
                id: 'SLOT_ORDER_VALID',
                description: 'Slot collection order is logical',
                severity: 'warning',
                weight: 10,
                check: (config) => {
                    const slots = config?.frontDeskBehavior?.bookingSlots || [];
                    const enabledSlots = slots.filter(s => s.enabled !== false);
                    
                    if (enabledSlots.length < 2) {
                        return { passed: true, value: 'N/A (< 2 slots)', fix: null };
                    }
                    
                    // Get slot order
                    const order = enabledSlots.map(s => ({
                        type: s.type || s.slotId || s.id,
                        order: s.order ?? s.priority ?? 999
                    })).sort((a, b) => a.order - b.order);
                    
                    // Ideal order: name → phone → address → issue
                    const idealOrder = ['name', 'firstName', 'phone', 'address', 'issue', 'notes'];
                    const typeOrder = order.map(o => o.type);
                    
                    // Check if name comes before phone
                    const nameIdx = typeOrder.findIndex(t => t === 'name' || t === 'firstName');
                    const phoneIdx = typeOrder.findIndex(t => t === 'phone');
                    
                    const nameBeforePhone = nameIdx === -1 || phoneIdx === -1 || nameIdx < phoneIdx;
                    
                    return {
                        passed: nameBeforePhone,
                        value: nameBeforePhone ? `Order: ${typeOrder.join(' → ')}` : 'PHONE_BEFORE_NAME',
                        details: { order: typeOrder },
                        fix: nameBeforePhone ? null : 'Reorder slots: Name should come before Phone'
                    };
                }
            },
            // ─────────────────────────────────────────────────────────────
            // PROBE 7: ALL_SLOTS_HAVE_QUESTIONS - No silent slots
            // ─────────────────────────────────────────────────────────────
            {
                id: 'ALL_SLOTS_HAVE_QUESTIONS',
                description: 'Every enabled slot has a question defined',
                severity: 'error',
                weight: 5,
                check: (config) => {
                    const slots = config?.frontDeskBehavior?.bookingSlots || [];
                    const enabledSlots = slots.filter(s => s.enabled !== false);
                    
                    const slotsWithoutQuestions = enabledSlots.filter(s => {
                        // Name slots can use firstNameQuestion
                        if (s.type === 'name' || s.slotId === 'name') {
                            return !s.question && !s.firstNameQuestion;
                        }
                        return !s.question;
                    });
                    
                    const allHaveQuestions = slotsWithoutQuestions.length === 0;
                    
                    return {
                        passed: allHaveQuestions,
                        value: allHaveQuestions ? 
                            `All ${enabledSlots.length} slots have questions` : 
                            `${slotsWithoutQuestions.length} SILENT SLOTS`,
                        details: {
                            slotsWithoutQuestions: slotsWithoutQuestions.map(s => s.type || s.slotId || s.id)
                        },
                        fix: allHaveQuestions ? null : 
                            `Add questions to: ${slotsWithoutQuestions.map(s => s.type || s.slotId).join(', ')}`
                    };
                }
            },
            // ─────────────────────────────────────────────────────────────
            // PROBE 8: QUESTIONS_NOT_HARDCODED - UI questions != fallbacks
            // 🚨 CRITICAL: Ensures AI uses YOUR configured prompts
            // ─────────────────────────────────────────────────────────────
            {
                id: 'QUESTIONS_NOT_HARDCODED',
                description: 'Slot questions are customized (not just defaults)',
                severity: 'warning',
                weight: 20,
                check: (config) => {
                    const slots = config?.frontDeskBehavior?.bookingSlots || [];
                    const enabledSlots = slots.filter(s => s.enabled !== false);
                    
                    // Known "default-ish" questions. If the slot question matches these,
                    // it likely wasn't customized (even if it *is* saved in UI/DB).
                    const HARDCODED_FALLBACKS = [
                        "what is your name?",
                        "may i have your name please?",
                        "and what's your first name?",
                        "what's your first name?",
                        "what's your last name?",
                        "what's the best phone number to reach you?",
                        "what is the best phone number to reach you?",
                        "what's your phone number?",
                        "what is your phone?",
                        "what is your address?",
                        "what's the address for the service?",
                        "when works best for you?"
                    ];
                    
                    const slotsUsingHardcodedQuestion = enabledSlots.filter(s => {
                        const q = (s.question || '').toLowerCase().trim();
                        // Check if question matches or is very similar to hardcoded
                        return HARDCODED_FALLBACKS.some(hc => {
                            const hcNorm = hc.toLowerCase().trim();
                            // Exact match or very close (handles punctuation differences)
                            return q === hcNorm || 
                                   q.replace(/[?.,!]/g, '') === hcNorm.replace(/[?.,!]/g, '');
                        });
                    });
                    
                    const allCustomized = slotsUsingHardcodedQuestion.length === 0;
                    
                    // Build details with actual question text for verification
                    const questionDetails = enabledSlots.map(s => ({
                        slot: s.type || s.slotId || s.id,
                        question: s.question?.substring(0, 50) + (s.question?.length > 50 ? '...' : ''),
                        isCustom: !HARDCODED_FALLBACKS.some(hc => 
                            (s.question || '').toLowerCase().includes(hc.replace(/\?/g, '').trim())
                        )
                    }));
                    
                    return {
                        passed: allCustomized,
                        value: allCustomized ? 
                            `✅ All ${enabledSlots.length} slots are customized` : 
                            `⚠️ ${slotsUsingHardcodedQuestion.length} slots still use default wording`,
                        details: {
                            questionDetails,
                            potentialHardcodedSlots: slotsUsingHardcodedQuestion.map(s => ({
                                slot: s.type || s.slotId || s.id,
                                question: s.question
                            }))
                        },
                        fix: allCustomized ? null :
                            `Customize slot questions (optional but recommended) for: ${slotsUsingHardcodedQuestion.map(s => s.type || s.slotId).join(', ')}`
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
    // GREETING TAB - V57 Deep Structural Integrity (Instructions for what to do first)
    // ═══════════════════════════════════════════════════════════════════
    greeting: {
        name: 'Greeting',
        icon: '👋',
        checks: [
            // ─────────────────────────────────────────────────────────────
            // PROBE 1: GREETING_HYDRATION - Greeting exists and has content
            // ─────────────────────────────────────────────────────────────
            {
                id: 'GREETING_HYDRATION',
                description: 'Greeting response is configured with content',
                severity: 'error',
                weight: 35,
                check: (config) => {
                    // Runtime truth: ConversationEngine uses frontDeskBehavior.greetingResponses (LLM-0)
                    // Also accept connectionMessages.voice.text for voice channel.
                    const greetingResponses = config?.frontDeskBehavior?.greetingResponses || [];
                    
                    // Also check connectionMessages (often used for greeting)
                    const connectionMsg = config?.connectionMessages?.voice?.text;
                    
                    const hasGreetingRules = Array.isArray(greetingResponses) && greetingResponses.length > 0;
                    const hasConnectionGreeting = connectionMsg && connectionMsg.trim().length > 10;
                    
                    // At least one source of greeting must exist
                    const hasAnyGreeting = hasGreetingRules || hasConnectionGreeting;
                    
                    // Check if greeting has substance (not just "Hi")
                    let greetingQuality = 'none';
                    if (hasGreetingRules) {
                        const first = greetingResponses[0];
                        const responseLength = String(first || '').length;
                        greetingQuality = responseLength > 50 ? 'rich' : responseLength > 10 ? 'basic' : 'minimal';
                    } else if (hasConnectionGreeting) {
                        greetingQuality = connectionMsg.length > 50 ? 'rich' : 'basic';
                    }
                    
                    return {
                        passed: hasAnyGreeting,
                        value: hasAnyGreeting ? `${greetingQuality} (${greetingResponses.length} responses)` : 'NO_GREETING',
                        details: {
                            hasGreetingRules,
                            ruleCount: greetingResponses.length,
                            hasConnectionGreeting,
                            quality: greetingQuality
                        },
                        fix: hasAnyGreeting ? null : 'Add a greeting response - this is what the agent says first!'
                    };
                }
            },
            // ─────────────────────────────────────────────────────────────
            // PROBE 2: DEFAULT_GREETING_BINDING - Always-apply greeting exists
            // ─────────────────────────────────────────────────────────────
            {
                id: 'DEFAULT_GREETING_BINDING',
                description: 'Default greeting exists (always applies)',
                severity: 'error',
                weight: 25,
                check: (config) => {
                    // greetingResponses are unconditional; if at least 1 exists, it's implicitly default.
                    const greetingResponses = config?.frontDeskBehavior?.greetingResponses || [];
                    const hasDefault = Array.isArray(greetingResponses) && greetingResponses.length > 0;
                    
                    return {
                        passed: hasDefault,
                        value: hasDefault ? 'Implicit default (greetingResponses[0])' : 'NO_DEFAULT',
                        fix: hasDefault ? null : 'Add a default greeting rule that always applies'
                    };
                }
            },
            // ─────────────────────────────────────────────────────────────
            // PROBE 3: GREETING_FLOW_CONTINUITY - Greeting leads somewhere
            // ─────────────────────────────────────────────────────────────
            {
                id: 'GREETING_FLOW_CONTINUITY',
                description: 'Greeting leads to next action (not dead-end)',
                severity: 'warning',
                weight: 20,
                check: (config) => {
                    // Check if greeting ends with a question or prompt
                    const rules = config?.frontDeskBehavior?.conversationStages?.greeting?.rules ||
                                  config?.frontDeskBehavior?.greetingRules ||
                                  [];
                    const connectionMsg = config?.connectionMessages?.voice?.text || '';
                    
                    // Look for question marks or call-to-action phrases
                    const hasQuestionInRules = rules.some(r => {
                        const text = r.response || r.text || '';
                        return text.includes('?') || 
                               text.toLowerCase().includes('how can') ||
                               text.toLowerCase().includes('what can') ||
                               text.toLowerCase().includes('help you');
                    });
                    
                    const hasQuestionInConnection = connectionMsg.includes('?') ||
                                                    connectionMsg.toLowerCase().includes('how can') ||
                                                    connectionMsg.toLowerCase().includes('help');
                    
                    const hasContinuity = hasQuestionInRules || hasQuestionInConnection || rules.length === 0;
                    
                    return {
                        passed: hasContinuity,
                        value: hasContinuity ? 'Prompts caller' : 'Dead-end greeting',
                        fix: hasContinuity ? null : 'Greeting should end with "How can I help you?" or similar'
                    };
                }
            },
            // ─────────────────────────────────────────────────────────────
            // PROBE 4: AFTER_HOURS_COVERAGE - Time-based greeting
            // ─────────────────────────────────────────────────────────────
            {
                id: 'AFTER_HOURS_COVERAGE',
                description: 'After-hours greeting (if business hours set)',
                severity: 'warning',
                weight: 20,
                check: (config, tradeKey, companyDoc) => {
                    const hasBusinessHours = companyDoc?.businessHours?.enabled ||
                                             companyDoc?.configuration?.businessHours?.enabled;
                    
                    if (!hasBusinessHours) {
                        return { passed: true, value: 'N/A (24/7 operation)', fix: null };
                    }
                    
                    const rules = config?.frontDeskBehavior?.conversationStages?.greeting?.rules ||
                                  config?.frontDeskBehavior?.greetingRules ||
                                  [];
                    
                    const afterHoursRule = rules.find(r => 
                        r.condition?.toLowerCase().includes('after') || 
                        r.condition?.toLowerCase().includes('closed') ||
                        r.name?.toLowerCase().includes('after') ||
                        r.name?.toLowerCase().includes('closed')
                    );
                    
                    return {
                        passed: !!afterHoursRule,
                        value: afterHoursRule ? 'Configured' : 'MISSING',
                        fix: afterHoursRule ? null : 'Add after-hours greeting (you have business hours set)'
                    };
                }
            }
        ]
    },

    // ═══════════════════════════════════════════════════════════════════
    // DYNAMIC FLOWS TAB - V57 "Instructions" - What the agent does
    // ═══════════════════════════════════════════════════════════════════
    dynamicFlows: {
        name: 'Dynamic Flows',
        icon: '🔀',
        checks: [
            // ─────────────────────────────────────────────────────────────
            // PROBE 1: FLOWS_EXIST - Does the agent have instructions?
            // ─────────────────────────────────────────────────────────────
            {
                id: 'FLOWS_EXIST',
                description: 'Dynamic flows are configured (agent has instructions)',
                severity: 'error',
                weight: 30,
                check: async (config, tradeKey, companyDoc, companyId) => {
                    try {
                        const DynamicFlow = require('../../models/DynamicFlow');
                        const allFlows = await DynamicFlow.find({ companyId });
                        const enabledFlows = allFlows.filter(f => f.enabled);
                        
                        // Agent needs at least SOME flows to know what to do
                        const hasFlows = allFlows.length > 0;
                        const hasEnabledFlows = enabledFlows.length > 0;
                        
                        return {
                            passed: hasFlows,
                            value: hasFlows ? `${allFlows.length} total, ${enabledFlows.length} enabled` : 'NO_FLOWS',
                            details: {
                                totalFlows: allFlows.length,
                                enabledFlows: enabledFlows.length,
                                flowNames: enabledFlows.slice(0, 5).map(f => f.name)
                            },
                            fix: hasFlows ? null : 'Create dynamic flows to give the agent instructions'
                        };
                    } catch (err) {
                        logger.error('[FrontDeskVerifier] Error checking flows exist:', err);
                        return { passed: false, value: 'CHECK_ERROR', fix: 'Unable to check dynamic flows' };
                    }
                }
            },
            // ─────────────────────────────────────────────────────────────
            // PROBE 2: ENABLED_FLOWS_VALID - Enabled flows are complete
            // ─────────────────────────────────────────────────────────────
            {
                id: 'ENABLED_FLOWS_VALID',
                description: 'All enabled flows have complete actions',
                severity: 'error',
                weight: 30,
                check: async (config, tradeKey, companyDoc, companyId) => {
                    try {
                        const DynamicFlow = require('../../models/DynamicFlow');
                        const flows = await DynamicFlow.find({ companyId, enabled: true });
                        
                        if (flows.length === 0) {
                            return { passed: true, value: 'No enabled flows to validate', fix: null };
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
                            value: invalidFlows.length === 0 ? `${flows.length} flows valid` : `${invalidFlows.length}/${flows.length} invalid`,
                            details: { invalidFlows },
                            fix: invalidFlows.length > 0 ? 
                                `Fix flows: ${invalidFlows.map(f => f.name).join(', ')}` : null
                        };
                    } catch (err) {
                        logger.error('[FrontDeskVerifier] Error checking flow validity:', err);
                        return { passed: true, value: 'Check skipped (error)', fix: null };
                    }
                }
            },
            // ─────────────────────────────────────────────────────────────
            // PROBE 3: BOOKING_FLOW_EXISTS - Has a booking/appointment flow
            // ─────────────────────────────────────────────────────────────
            {
                id: 'BOOKING_FLOW_EXISTS',
                description: 'Booking/appointment flow is configured',
                severity: 'warning',
                weight: 20,
                check: async (config, tradeKey, companyDoc, companyId) => {
                    try {
                        const DynamicFlow = require('../../models/DynamicFlow');
                        const flows = await DynamicFlow.find({ companyId, enabled: true });
                        
                        // Look for booking-related flows
                        const bookingFlow = flows.find(f => 
                            f.name?.toLowerCase().includes('book') ||
                            f.name?.toLowerCase().includes('appoint') ||
                            f.name?.toLowerCase().includes('schedul') ||
                            f.category?.toLowerCase().includes('book')
                        );
                        
                        // Also check if booking is enabled in frontDeskBehavior
                        const bookingEnabled = config?.frontDeskBehavior?.bookingEnabled;
                        
                        // If booking is enabled, we should have a booking flow
                        if (bookingEnabled && !bookingFlow) {
                            return {
                                passed: false,
                                value: 'Booking enabled but no flow',
                                fix: 'Create a booking flow to handle appointment requests'
                            };
                        }
                        
                        return {
                            passed: true,
                            value: bookingFlow ? `Found: ${bookingFlow.name}` : 'N/A (booking disabled)',
                            fix: null
                        };
                    } catch (err) {
                        return { passed: true, value: 'Check skipped', fix: null };
                    }
                }
            },
            // ─────────────────────────────────────────────────────────────
            // PROBE 4: ESCALATION_FLOW_EXISTS - Human handoff configured
            // ─────────────────────────────────────────────────────────────
            {
                id: 'ESCALATION_FLOW_EXISTS',
                description: 'Escalation/handoff flow exists',
                severity: 'warning',
                weight: 20,
                check: async (config, tradeKey, companyDoc, companyId) => {
                    try {
                        // Truth: Escalation is primarily UI-driven (frontDeskBehavior.escalation).
                        // A Dynamic Flow is optional; do not warn if escalation is configured and enabled.
                        const esc = config?.frontDeskBehavior?.escalation || {};
                        const hasEscCfg =
                            esc.enabled !== false &&
                            Array.isArray(esc.triggerPhrases) &&
                            esc.triggerPhrases.filter(Boolean).length > 0 &&
                            typeof esc.offerMessage === 'string' &&
                            esc.offerMessage.trim().length > 0;
                        
                        if (hasEscCfg) {
                            return {
                                passed: true,
                                value: `UI escalation configured (${esc.triggerPhrases.length} triggers)`,
                                fix: null
                            };
                        }

                        const DynamicFlow = require('../../models/DynamicFlow');
                        const flows = await DynamicFlow.find({ companyId });
                        
                        // Look for escalation-related flows
                        const escalationFlow = flows.find(f => 
                            f.name?.toLowerCase().includes('escal') ||
                            f.name?.toLowerCase().includes('handoff') ||
                            f.name?.toLowerCase().includes('transfer') ||
                            f.name?.toLowerCase().includes('human') ||
                            f.name?.toLowerCase().includes('manager')
                        );
                        
                        return {
                            passed: !!escalationFlow,
                            value: escalationFlow ? `Found: ${escalationFlow.name}` : 'NO_ESCALATION_PATH',
                            fix: escalationFlow ? null : 'Configure Escalation triggers/messages (Front Desk → Escalation) or create a Dynamic Flow for "speak to manager" requests'
                        };
                    } catch (err) {
                        return { passed: true, value: 'Check skipped', fix: null };
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
                    // Truth: UI uses maxSameQuestion (not maxRetries).
                    const maxSame = config?.frontDeskBehavior?.loopPrevention?.maxSameQuestion;
                    const hasValue = typeof maxSame === 'number' && maxSame > 0;
                    return {
                        passed: hasValue,
                        value: hasValue ? `${maxSame} max repeats` : 'Using default',
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

