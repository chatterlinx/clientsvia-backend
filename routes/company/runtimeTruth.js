/**
 * ============================================================================
 * RUNTIME TRUTH - The SINGLE JSON That Shows What Actually Runs
 * ============================================================================
 * 
 * PURPOSE: One endpoint that returns EVERYTHING needed to understand
 *          what will happen when a call comes in.
 * 
 * CRITICAL: If it's not in this JSON, it doesn't exist for runtime.
 * 
 * INCLUDES:
 * - Provider sources for each section (know where data came from)
 * - IDs for every editable thing (templateId, categoryId, scenarioId, flowId)
 * - Version tracking for optimistic concurrency
 * - Control Plane (greeting, booking, fallbacks, personality)
 * - Scenario Brain (templates, categories, scenarios)
 * - Dynamic Flows (triggers, actions, flow coordination)
 * - Matching Policy (tier thresholds, priority rules)
 * - Wiring (scenario → action → flow → booking mapping)
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const crypto = require('crypto');
const v2Company = require('../../models/v2Company');
const CompanyResponseDefaults = require('../../models/CompanyResponseDefaults');
const CompanyPlaceholders = require('../../models/CompanyPlaceholders');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
// ☢️ NUKED Feb 2026: DynamicFlow - V110 architecture replaces Dynamic Flows
// const DynamicFlow = require('../../models/DynamicFlow');
const { authenticateJWT, requireCompanyAccess } = require('../../middleware/auth');
const { unifyConfig } = require('../../utils/configUnifier');
const { substitutePlaceholders } = require('../../utils/placeholderStandard');
const { validateScenarioQuality, QUALITY_REQUIREMENTS } = require('../../utils/scenarioEnforcement');
const logger = require('../../utils/logger');
// ☢️ NUKED: BookingContractCompiler - Booking Contract V2 removed Jan 2026
const BookingScriptEngine = require('../../services/BookingScriptEngine');
const { computeEffectiveConfigVersion } = require('../../utils/effectiveConfigVersion');

// ============================================================================
// PROVIDER VERSIONS - Track what version of each provider generated data
// ============================================================================
const PROVIDER_VERSIONS = {
    controlPlane: 'controlPlane:v3',
    scenarioBrain: 'scenarioBrain:v2',
    // ☢️ NUKED Feb 2026: dynamicFlow removed - V110 architecture replaces it
    matchingPolicy: 'matchingPolicy:v1',
    placeholders: 'placeholders:v1'
};

// ============================================================================
// SCHEMA VERSION - Increment when output shape changes
// ============================================================================
const SCHEMA_VERSION = 'RT_V22.2';

router.use(authenticateJWT);
router.use(requireCompanyAccess);

/**
 * Generate version hash for optimistic concurrency
 */
function generateVersionHash(companyId, timestamp) {
    const data = `${companyId}:${timestamp}`;
    return `rt_${crypto.createHash('md5').update(data).digest('hex').slice(0, 8)}_${timestamp}`;
}

/**
 * GET /api/company/:companyId/runtime-truth
 * 
 * Returns the complete runtime truth for this company - EVERYTHING in one JSON
 * 
 * CRITICAL: This is the SINGLE SOURCE OF TRUTH
 * - If it's not here, it doesn't exist
 * - IDs are patchable
 * - Sources are traceable
 * - Version enables optimistic concurrency
 */
router.get('/', async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;
    const timestamp = new Date().toISOString();
    
    try {
        console.log(`🎯 [RUNTIME TRUTH] Building for company: ${companyId}`);
        
        // ═══════════════════════════════════════════════════════════════════════
        // PARALLEL LOAD ALL DATA SOURCES
        // ═══════════════════════════════════════════════════════════════════════
        const [company, responseDefaults, placeholdersDoc] = await Promise.all([
            v2Company.findById(companyId).lean(),
            CompanyResponseDefaults.getOrCreate(companyId),
            CompanyPlaceholders.findOne({ companyId }).lean()
            // ☢️ NUKED Feb 2026: DynamicFlow.find() - V110 architecture replaces Dynamic Flows
        ]);
        
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // BUILD PLACEHOLDER MAP
        // ═══════════════════════════════════════════════════════════════════════
        const placeholderMap = {};
        const placeholderEntries = [];
        (placeholdersDoc?.placeholders || []).forEach(p => {
            placeholderMap[p.key] = p.value;
            placeholderEntries.push({
                id: p._id?.toString() || `ph_${p.key}`,
                key: p.key,
                value: p.value,
                editable: true
            });
        });
        // Add system placeholders (not editable)
        placeholderMap.companyName = company.companyName;
        placeholderMap.companyPhone = company.companyPhone || company.phoneNumber;
        placeholderEntries.push(
            { id: 'sys_companyName', key: 'companyName', value: company.companyName, editable: false, system: true },
            { id: 'sys_companyPhone', key: 'companyPhone', value: company.companyPhone || company.phoneNumber, editable: false, system: true }
        );
        
        // ═══════════════════════════════════════════════════════════════════════
        // UNIFY CONTROL PLANE CONFIG
        // ═══════════════════════════════════════════════════════════════════════
        const controlPlane = unifyConfig(company, responseDefaults, {
            seedBookingSlotsIfEmpty: false
        });
        
        // ═══════════════════════════════════════════════════════════════════════
        // LOAD ACTIVE TEMPLATES + SCENARIOS
        // ═══════════════════════════════════════════════════════════════════════
        const templateRefs = company.aiAgentSettings?.templateReferences || [];
        const activeTemplateIds = templateRefs
            .filter(ref => ref.enabled)
            .map(ref => ref.templateId);
        
        // NOTE: Removed isActive filter to match /configuration/templates behavior
        // The templateReferences.enabled flag is sufficient for filtering
        const templates = await GlobalInstantResponseTemplate.find({
            _id: { $in: activeTemplateIds }
        }).lean();

        const effectiveConfigVersion = computeEffectiveConfigVersion({
            companyId,
            frontDeskBehavior: company.aiAgentSettings?.frontDeskBehavior || null,
            agentSettings: company.agentSettings || null,
            templateReferences: company.aiAgentSettings?.templateReferences || [],
            scenarioControls: company.aiAgentSettings?.scenarioControls || [],
            templatesMeta: templates.map(t => ({
                templateId: t._id?.toString?.() || String(t._id),
                version: t.version || null,
                updatedAt: t.updatedAt ? new Date(t.updatedAt).toISOString() : null,
                isPublished: t.isPublished ?? null,
                isActive: t.isActive ?? null
            })),
            placeholders: (placeholdersDoc?.placeholders || []).map(p => ({ key: p.key, value: p.value })),
            providerVersions: PROVIDER_VERSIONS
        });
        
        // Flatten scenarios with category info - include ALL IDs
        const scenarios = [];
        const categories = [];
        let totalTriggers = 0;
        
        templates.forEach(template => {
            (template.categories || []).forEach(cat => {
                const categoryId = cat.id || cat._id?.toString() || `cat_${cat.name.replace(/\s+/g, '_').toLowerCase()}`;
                
                categories.push({
                    id: categoryId,
                    name: cat.name,
                    templateId: template._id.toString(),
                    templateName: template.name,
                    scenarioCount: (cat.scenarios || []).length,
                    scope: 'GLOBAL', // Categories are in global templates
                    editable: false // Global content not directly editable
                });
                
                (cat.scenarios || []).forEach(scenario => {
                    const triggers = scenario.triggers || [];
                    totalTriggers += triggers.length;
                    
                    const scenarioId = scenario.scenarioId || scenario._id?.toString() || `sc_${scenario.name.replace(/\s+/g, '_').toLowerCase()}`;
                    
                    // Determine actionType (explicit or detected)
                    const explicitActionType = scenario.actionType || null;
                    const detectedAction = detectScenarioAction(scenario);
                    
                    scenarios.push({
                        id: scenarioId,
                        name: scenario.name,
                        categoryId: categoryId,
                        categoryName: cat.name,
                        templateId: template._id.toString(),
                        templateName: template.name,
                        
                        // Scope info for patch routing
                        scope: scenario.scope || 'GLOBAL',
                        ownerCompanyId: scenario.ownerCompanyId?.toString() || null,
                        editable: (scenario.scope || 'GLOBAL') === 'COMPANY', // Only company overrides are editable
                        
                        // Matching
                        triggers: triggers.slice(0, 5), // First 5 for preview
                        triggerCount: triggers.length,
                        negativeTriggers: scenario.negativeTriggers || [],
                        negativeTriggerCount: (scenario.negativeTriggers || []).length,
                        minConfidence: scenario.minConfidence || scenario.contextWeight || 0.7,
                        priority: scenario.priority || 0,
                        
                        // Classification (PATCHABLE via company override)
                        scenarioType: scenario.scenarioType || 'UNKNOWN',
                        autofillLock: scenario.autofillLock === true,
                        status: scenario.status || 'live',
                        
                        // Replies
                        quickReplyCount: (scenario.quickReplies || []).length,
                        fullReplyCount: (scenario.fullReplies || []).length,
                        replyPolicy: scenario.replyPolicy || 'ROTATE_PER_CALLER',
                        
                        // 🔗 WIRING - What happens when this matches? (PATCHABLE)
                        wiring: {
                            // Explicit actionType from schema (new field)
                            actionType: explicitActionType,
                            // Detected action (backward compat)
                            detectedAction: detectedAction,
                            // Effective action (explicit wins if set)
                            effectiveAction: explicitActionType || detectedAction,
                            
                            // Flow wiring
                            flowId: scenario.flowId?.toString() || null,
                            stopRouting: scenario.stopRouting || false,
                            
                            // Transfer wiring
                            transferTarget: scenario.transferTarget || null,
                            handoffPolicy: scenario.handoffPolicy || 'low_confidence',
                            
                            // Booking wiring
                            bookingIntent: scenario.bookingIntent || false,
                            requiredSlots: scenario.requiredSlots || [],
                            
                            // Legacy support
                            actionHooks: scenario.actionHooks || [],
                            followUpMode: scenario.followUpMode || 'NONE'
                        },
                        
                        // Wiring validation state (db flag + effective computed)
                        wiringValidated: scenario.wiringValidated || false,
                        wiringValidatedAt: scenario.wiringValidatedAt || null,
                        wiringValidatedEffective: (() => {
                            const validation = validateScenarioQuality(scenario);
                            const wiringPass = validation?.checks?.wiring?.pass !== false;
                            const noIssues = !(scenario.wiringIssues && scenario.wiringIssues.length > 0);
                            return wiringPass && noIssues;
                        })(),
                        wiringIssues: scenario.wiringIssues || [],
                        
                        // Quality (local calculation)
                        quality: {
                            score: calculateScenarioQuality(scenario),
                            issues: getScenarioIssues(scenario)
                        },
                        
                        // ═══════════════════════════════════════════════════════════════
                        // 🛡️ ENTERPRISE ENFORCEMENT (December 2025 - NO EXCEPTIONS)
                        // If enterpriseReady === false, scenario WILL NOT MATCH at runtime
                        // ═══════════════════════════════════════════════════════════════
                        enforcement: (() => {
                            const validation = validateScenarioQuality(scenario);
                            return {
                                enterpriseReady: validation.enterpriseReady,
                                grade: validation.grade,
                                status: validation.status,
                                willMatch: validation.enterpriseReady, // Only enterprise-ready scenarios match
                                issues: validation.issues,
                                warnings: validation.warnings,
                                checks: {
                                    triggers: validation.checks.triggers?.pass,
                                    negatives: validation.checks.negativeTriggers?.pass,
                                    quickReplies: validation.checks.quickReplies?.pass,
                                    fullReplies: validation.checks.fullReplies?.pass,
                                    scenarioType: validation.checks.scenarioType?.pass,
                                    wiring: validation.checks.wiring?.pass,
                                    enums: validation.checks.enums?.pass
                                }
                            };
                        })()
                    });
                });
            });
        });
        
        // ☢️ NUKED Feb 2026: Dynamic Flows formatting removed - V110 architecture replaces it
        // const flows = allDynamicFlows.map(...);
        // const enabledFlows = flows.filter(f => f.enabled);
        
        // ═══════════════════════════════════════════════════════════════════════
        // BUILD MATCHING POLICY
        // ═══════════════════════════════════════════════════════════════════════
        const aiSettings = company.aiAgentSettings || {};
        const thresholds = aiSettings.thresholds || {};
        const frontDeskBehavior = company.aiAgentSettings?.frontDeskBehavior || {};
        const frontDeskDiscoveryConsent = frontDeskBehavior.discoveryConsent || {};
        const frontDeskDetectionTriggers = frontDeskBehavior.detectionTriggers || {};

        // Normalize booleans that may arrive as strings (e.g., "false") or undefined.
        // This prevents "ghost warnings" where UI shows false but truth logic treats it as true.
        const normalizeBoolean = (value, defaultValue) => {
            if (value === true || value === false) return value;
            if (value === 'true') return true;
            if (value === 'false') return false;
            return defaultValue;
        };

        // V22 Consent (runtime uses frontDeskBehavior.discoveryConsent + detectionTriggers.wantsBooking)
        const autoReplyAllowedScenarioTypes = Array.isArray(frontDeskDiscoveryConsent.autoReplyAllowedScenarioTypes)
            ? frontDeskDiscoveryConsent.autoReplyAllowedScenarioTypes
                .map(t => (t || '').toString().trim().toUpperCase())
                .filter(Boolean)
            : [];
        const v22Consent = {
            bookingRequiresExplicitConsent: normalizeBoolean(frontDeskDiscoveryConsent.bookingRequiresExplicitConsent, true),
            forceLLMDiscovery: normalizeBoolean(frontDeskDiscoveryConsent.forceLLMDiscovery, true),
            // Default MUST be false (do not silently block scenario replies when unset)
            disableScenarioAutoResponses: normalizeBoolean(frontDeskDiscoveryConsent.disableScenarioAutoResponses, false),
            autoReplyAllowedScenarioTypes,
            consentQuestionTemplate: frontDeskDiscoveryConsent.consentQuestionTemplate || null,
            consentYesWords: Array.isArray(frontDeskDiscoveryConsent.consentYesWords) ? frontDeskDiscoveryConsent.consentYesWords : [],
            consentPhrases: Array.isArray(frontDeskDetectionTriggers.wantsBooking) ? frontDeskDetectionTriggers.wantsBooking : []
        };

        // Canonical consent truth: this is the ONLY object Runtime Truth should display and warn from.
        // Enterprise rule: a "truth report" must not contradict itself.
        const blockAllScenarioAutoRepliesUntilConsent =
            v22Consent.disableScenarioAutoResponses === true && v22Consent.autoReplyAllowedScenarioTypes.length === 0;
        const discoveryConsentTruth = {
            source: 'aiAgentSettings.frontDeskBehavior.discoveryConsent + aiAgentSettings.frontDeskBehavior.detectionTriggers.wantsBooking',
            bookingRequiresExplicitConsent: v22Consent.bookingRequiresExplicitConsent,
            forceLLMDiscovery: v22Consent.forceLLMDiscovery,
            disableScenarioAutoResponses: v22Consent.disableScenarioAutoResponses,
            autoReplyAllowedScenarioTypes: v22Consent.autoReplyAllowedScenarioTypes,
            blockAllScenarioAutoRepliesUntilConsent,
            configured: !!(v22Consent.consentQuestionTemplate || v22Consent.consentPhrases.length > 0 || v22Consent.consentYesWords.length > 0),
            consentQuestionTemplate: v22Consent.consentQuestionTemplate,
            consentPhrasesCount: v22Consent.consentPhrases.length,
            consentPhrasesSample: v22Consent.consentPhrases.slice(0, 5),
            consentYesWordsCount: v22Consent.consentYesWords.length,
            consentYesWordsSample: v22Consent.consentYesWords.slice(0, 5),
            status: blockAllScenarioAutoRepliesUntilConsent
                ? 'BLOCKED: Scenarios will not auto-reply until consent is given'
                : (v22Consent.disableScenarioAutoResponses === true && v22Consent.autoReplyAllowedScenarioTypes.length > 0)
                    ? `OK: ${v22Consent.autoReplyAllowedScenarioTypes.join(', ')} may auto-reply before consent (BOOKING remains consent-gated)`
                    : 'OK: Scenarios can respond normally'
        };
        
        const matchingPolicy = {
            source: PROVIDER_VERSIONS.matchingPolicy,
            tierOrder: ['RULE_BASED', 'SEMANTIC', 'LLM_FALLBACK'],
            thresholds: {
                tier1: thresholds.tier1Threshold || thresholds.companyQnAThreshold || 0.8,
                tier2: thresholds.tier2Threshold || thresholds.tradeQnAThreshold || 0.6,
                tier3: 'LLM_FALLBACK'
            },
            priorityRules: {
                emergencyBoost: 10,
                exactMatchBoost: 5,
                negativeMatchBlock: true
            },
            discoveryConsent: {
                // NOTE: these fields must reflect what runtime actually uses
                required: discoveryConsentTruth.bookingRequiresExplicitConsent,
                bookingRequiresExplicitConsent: discoveryConsentTruth.bookingRequiresExplicitConsent,
                forceLLMDiscovery: discoveryConsentTruth.forceLLMDiscovery,
                disableScenarioAutoResponses: discoveryConsentTruth.disableScenarioAutoResponses,
                // Blocker only when auto-replies are fully disabled with no allowlist.
                scenariosBlockedByConsent: discoveryConsentTruth.blockAllScenarioAutoRepliesUntilConsent === true,
                consentPhrasesCount: discoveryConsentTruth.consentPhrasesCount,
                consentYesWordsCount: discoveryConsentTruth.consentYesWordsCount
            }
        };
        
        // ═══════════════════════════════════════════════════════════════════════
        // BUILD BOOKING CONFIG
        // ═══════════════════════════════════════════════════════════════════════
        // ☢️ NUKED: Booking Contract V2 (slotLibrary, slotGroups, compiler) - Jan 2026
        // Booking slots are wired directly via bookingSlots without V2 compilation layer
        
        const booking = {
            enabled: controlPlane.booking.enabled,
            slots: controlPlane.booking.slots.map((s, idx) => ({
                id: `slot_${s.key || s.name || idx}`,
                key: s.key || s.name,
                label: s.label || s.name,
                required: s.required !== false,
                validation: s.validation || null,
                editable: true
            })),
            slotsCount: controlPlane.booking.slotsCount,

            // Consent rules (do NOT invent defaults here; missing config must be visible)
            consent: {
                // NOTE: runtime uses V22 fields in frontDeskBehavior.discoveryConsent + detectionTriggers.wantsBooking
                required: v22Consent.bookingRequiresExplicitConsent,
                configured: !!(v22Consent.consentQuestionTemplate || v22Consent.consentPhrases.length > 0),
                // Backward-compatible fields (do not remove)
                phrase: v22Consent.consentQuestionTemplate,
                // V22 fields (preferred)
                consentQuestionTemplate: v22Consent.consentQuestionTemplate,
                consentPhrasesCount: v22Consent.consentPhrases.length,
                consentPhrasesSample: v22Consent.consentPhrases.slice(0, 5),
                consentYesWordsCount: v22Consent.consentYesWords.length,
                consentYesWordsSample: v22Consent.consentYesWords.slice(0, 5)
            },

            // ☢️ NUKED: bookingContractV2 section removed Jan 2026
        };

        // What runtime will actually use for booking slots (single entry point)
        const bookingRuntime = BookingScriptEngine.getBookingSlotsFromCompany(company, { contextFlags: {} });

        // ═══════════════════════════════════════════════════════════════════════
        // BUILD VOCABULARY CONFIG (Caller Input + AI Output Guardrails)
        // ═══════════════════════════════════════════════════════════════════════
        const callerVocabulary = frontDeskBehavior.callerVocabulary || {};
        const vocabularyGuardrails = frontDeskBehavior.vocabularyGuardrails || {};
        const fillerWordsEnabled = frontDeskBehavior.fillerWordsEnabled !== false;
        const customFillers = company.aiAgentSettings?.fillerWords?.custom || [];
        const nameStopWordsEnabled = frontDeskBehavior.nameStopWordsEnabled !== false;
        // Global name stop words via AWConfigReader (NOT per-company)
        const AWConfigReader = require('../../services/wiring/AWConfigReader');
        const customNameStopWords = AWConfigReader.getGlobalStopWords();

        const vocabulary = {
            source: 'aiAgentSettings.frontDeskBehavior.(callerVocabulary|vocabularyGuardrails) + AdminSettings.(nameStopWords)',

            // INPUT: translate caller slang before matching/LLM
            callerVocabulary: {
                enabled: callerVocabulary.enabled !== false,
                synonymCount: callerVocabulary.synonymMap ? Object.keys(callerVocabulary.synonymMap).length : 0,
                sample: callerVocabulary.synonymMap
                    ? Object.entries(callerVocabulary.synonymMap).slice(0, 5).map(([slang, meaning]) => ({ slang, meaning }))
                    : []
            },

            // OUTPUT: control what AI is allowed to say (enforcement is runtime-owned)
            vocabularyGuardrails: {
                allowedServiceNounsCount: Array.isArray(vocabularyGuardrails.allowedServiceNouns) ? vocabularyGuardrails.allowedServiceNouns.length : 0,
                forbiddenWordsCount: Array.isArray(vocabularyGuardrails.forbiddenWords) ? vocabularyGuardrails.forbiddenWords.length : 0,
                replacementMapCount: vocabularyGuardrails.replacementMap ? Object.keys(vocabularyGuardrails.replacementMap).length : 0
            },

            // INPUT: remove conversational noise before processing
            fillerWords: {
                enabled: fillerWordsEnabled,
                customCount: Array.isArray(customFillers) ? customFillers.length : 0,
                sample: Array.isArray(customFillers) ? customFillers.slice(0, 10) : []
            },

            // INPUT: block false-positive name extraction
            nameStopWords: {
                enabled: nameStopWordsEnabled,
                customCount: Array.isArray(customNameStopWords) ? customNameStopWords.length : 0,
                sample: Array.isArray(customNameStopWords) ? customNameStopWords.slice(0, 10) : []
            }
        };

        // ═══════════════════════════════════════════════════════════════════════
        // FRONT DESK (TAB-BY-TAB TRUTH) - must mirror what runtime actually reads
        // ═══════════════════════════════════════════════════════════════════════
        const frontDesk = {
            source: 'aiAgentSettings.frontDeskBehavior',

            // Tab: Personality
            personality: {
                // The runtime uses this (HybridReceptionistLLM.loadFrontDeskConfig)
                agentName: frontDeskBehavior.personality?.agentName || '',
                tone: frontDeskBehavior.personality?.tone || null,
                verbosity: frontDeskBehavior.personality?.verbosity || null,
                maxResponseWords: frontDeskBehavior.personality?.maxResponseWords ?? null,
                useCallerName: frontDeskBehavior.personality?.useCallerName ?? null,
                // V83: Added warmth and speakingPace (used by HybridReceptionistLLM for LLM prompt tuning)
                warmth: typeof frontDeskBehavior.personality?.warmth === 'number' 
                    ? frontDeskBehavior.personality.warmth 
                    : null,
                speakingPace: frontDeskBehavior.personality?.speakingPace || null,
                conversationStyle: frontDeskBehavior.conversationStyle || 'balanced',
                styleAcknowledgmentsConfigured: !!frontDeskBehavior.styleAcknowledgments,
                styleAcknowledgments: frontDeskBehavior.styleAcknowledgments || null
            },

            // Tab: Personality (Greeting Rules)
            greetingRules: {
                enabled: frontDeskBehavior.conversationStages?.enabled !== false,
                rulesCount: Array.isArray(frontDeskBehavior.conversationStages?.greetingRules)
                    ? frontDeskBehavior.conversationStages.greetingRules.length
                    : 0,
                rulesSample: Array.isArray(frontDeskBehavior.conversationStages?.greetingRules)
                    ? frontDeskBehavior.conversationStages.greetingRules.slice(0, 5).map(r => ({
                        trigger: r.trigger,
                        fuzzy: r.fuzzy === true,
                        responsePreview: (r.response || '').substring(0, 60)
                    }))
                    : []
            },

            // ═══════════════════════════════════════════════════════════════════════════
            // V110: ENTERPRISE SLOT/FLOW ARCHITECTURE
            // ═══════════════════════════════════════════════════════════════════════════
            // ═══════════════════════════════════════════════════════════════════════════
            // V110: SLOT REGISTRY - Single Source of Truth for all slots
            // ═══════════════════════════════════════════════════════════════════════════
            slotRegistry: {
                configured: !!frontDeskBehavior.slotRegistry?.version,
                version: frontDeskBehavior.slotRegistry?.version || null,
                slotCount: Array.isArray(frontDeskBehavior.slotRegistry?.slots) 
                    ? frontDeskBehavior.slotRegistry.slots.length 
                    : 0,
                slotIds: Array.isArray(frontDeskBehavior.slotRegistry?.slots)
                    ? frontDeskBehavior.slotRegistry.slots.map(s => s.id)
                    : [],
                requiredSlots: Array.isArray(frontDeskBehavior.slotRegistry?.slots)
                    ? frontDeskBehavior.slotRegistry.slots.filter(s => s.required).map(s => s.id)
                    : [],
                slotsSummary: Array.isArray(frontDeskBehavior.slotRegistry?.slots)
                    ? frontDeskBehavior.slotRegistry.slots.map(s => ({
                        id: s.id,
                        label: s.label,
                        type: s.type,
                        required: s.required === true,
                        discoveryFillAllowed: s.discoveryFillAllowed !== false,
                        bookingConfirmRequired: s.bookingConfirmRequired !== false,
                        // V110: Extraction config
                        extractionSources: s.extraction?.source || ['utterance'],
                        // V110: Address-specific policy
                        hasAddressPolicy: s.type === 'address' && !!s.addressPolicy
                    }))
                    : [],
                // V110: Slot lifecycle states
                slotStates: ['EMPTY', 'CAPTURED', 'CONFIRMED', 'LOCKED', 'REJECTED'],
                source: 'aiAgentSettings.frontDeskBehavior.slotRegistry'
            },

            // ═══════════════════════════════════════════════════════════════════════════
            // V110: DISCOVERY FLOW - Passive capture + Smart confirmation
            // ═══════════════════════════════════════════════════════════════════════════
            discoveryFlow: {
                configured: !!frontDeskBehavior.discoveryFlow?.version,
                version: frontDeskBehavior.discoveryFlow?.version || null,
                enabled: frontDeskBehavior.discoveryFlow?.enabled !== false,
                stepsCount: Array.isArray(frontDeskBehavior.discoveryFlow?.steps) 
                    ? frontDeskBehavior.discoveryFlow.steps.length 
                    : 0,
                // V110: Step order for reference
                stepOrder: Array.isArray(frontDeskBehavior.discoveryFlow?.steps)
                    ? frontDeskBehavior.discoveryFlow.steps
                        .sort((a, b) => (a.order || 0) - (b.order || 0))
                        .map(s => s.slotId)
                    : [],
                stepsSummary: Array.isArray(frontDeskBehavior.discoveryFlow?.steps)
                    ? frontDeskBehavior.discoveryFlow.steps.map(s => ({
                        stepId: s.stepId,
                        slotId: s.slotId,
                        order: s.order,
                        confirmMode: s.confirmMode || 'smart_if_captured',
                        hasAskPrompt: !!s.ask,
                        hasReprompt: !!s.reprompt,
                        hasRepromptVariants: Array.isArray(s.repromptVariants) && s.repromptVariants.length > 0,
                        repromptVariantsCount: s.repromptVariants?.length || 0
                    }))
                    : [],
                // V110: Confirm modes available
                confirmModes: ['smart_if_captured', 'always', 'never', 'confirm_if_from_caller_id'],
                source: 'aiAgentSettings.frontDeskBehavior.discoveryFlow'
            },

            // ═══════════════════════════════════════════════════════════════════════════
            // V110: BOOKING FLOW - Confirm captured → Ask missing → Finalize
            // ═══════════════════════════════════════════════════════════════════════════
            bookingFlow: {
                configured: !!frontDeskBehavior.bookingFlow?.version,
                version: frontDeskBehavior.bookingFlow?.version || null,
                enabled: frontDeskBehavior.bookingFlow?.enabled !== false,
                confirmCapturedFirst: frontDeskBehavior.bookingFlow?.confirmCapturedFirst !== false,
                stepsCount: Array.isArray(frontDeskBehavior.bookingFlow?.steps) 
                    ? frontDeskBehavior.bookingFlow.steps.length 
                    : 0,
                // V110: Step order for reference
                stepOrder: Array.isArray(frontDeskBehavior.bookingFlow?.steps)
                    ? frontDeskBehavior.bookingFlow.steps
                        .sort((a, b) => (a.order || 0) - (b.order || 0))
                        .map(s => s.slotId)
                    : [],
                stepsSummary: Array.isArray(frontDeskBehavior.bookingFlow?.steps)
                    ? frontDeskBehavior.bookingFlow.steps.map(s => ({
                        stepId: s.stepId,
                        slotId: s.slotId,
                        order: s.order,
                        hasAskPrompt: !!s.ask,
                        hasConfirmPrompt: !!s.confirmPrompt,
                        hasReprompt: !!s.reprompt,
                        hasRepromptVariants: Array.isArray(s.repromptVariants) && s.repromptVariants.length > 0,
                        repromptVariantsCount: s.repromptVariants?.length || 0,
                        // V110: Address sub-step config
                        hasStructuredSubflow: s.structuredSubflow?.enabled === true,
                        structuredSubflowSequence: s.structuredSubflow?.enabled 
                            ? (s.structuredSubflow.sequence || []).join(' → ')
                            : null
                    }))
                    : [],
                // V110: Completion config
                completion: {
                    reviewAndConfirm: frontDeskBehavior.bookingFlow?.completion?.reviewAndConfirm !== false,
                    hasConfirmScript: !!frontDeskBehavior.bookingFlow?.completion?.confirmScript,
                    hasConfirmRetryPrompt: !!frontDeskBehavior.bookingFlow?.completion?.confirmRetryPrompt,
                    hasCorrectionPrompt: !!frontDeskBehavior.bookingFlow?.completion?.correctionPrompt
                },
                // V110: Reprompt budget (enterprise)
                maxAttemptsPerSlot: frontDeskBehavior.bookingFlow?.maxAttemptsPerSlot || 3,
                source: 'aiAgentSettings.frontDeskBehavior.bookingFlow'
            },

            // ═══════════════════════════════════════════════════════════════════════════
            // V110: FLOW POLICIES - Enterprise behavior configuration
            // ═══════════════════════════════════════════════════════════════════════════
            flowPolicies: {
                configured: !!frontDeskBehavior.policies,
                nameParsing: {
                    useFirstNameList: frontDeskBehavior.policies?.nameParsing?.useFirstNameList !== false,
                    confirmIfFirstNameDetected: frontDeskBehavior.policies?.nameParsing?.confirmIfFirstNameDetected !== false,
                    acceptLastNameOnly: frontDeskBehavior.policies?.nameParsing?.acceptLastNameOnly !== false,
                    // V110: "That's my last name" handling
                    ifCallerSaysNoThatsMyLastName: frontDeskBehavior.policies?.nameParsing?.ifCallerSaysNoThatsMyLastName || {
                        moveValueTo: 'name.last',
                        thenAsk: 'name.first'
                    }
                },
                booking: {
                    whenBookingStarts: frontDeskBehavior.policies?.booking?.whenBookingStarts || 'confirm_discovery_values_then_ask_missing',
                    neverRestartIfAlreadyCaptured: frontDeskBehavior.policies?.booking?.neverRestartIfAlreadyCaptured !== false,
                    // V110: Confirm modes per slot
                    defaultConfirmMode: frontDeskBehavior.policies?.booking?.defaultConfirmMode || 'smart_if_captured'
                },
                address: {
                    defaultState: frontDeskBehavior.policies?.address?.defaultState || 'FL',
                    requireCityIfMissing: frontDeskBehavior.policies?.address?.requireCityIfMissing !== false,
                    requireUnitIfMultiUnit: frontDeskBehavior.policies?.address?.requireUnitIfMultiUnit !== false,
                    geoVerifyEnabled: frontDeskBehavior.policies?.address?.geoVerifyEnabled !== false,
                    // V110: Geo verify timing
                    geoVerifyWhen: frontDeskBehavior.policies?.address?.geoVerifyWhen || 'on_full_address'
                },
                // V110: Reprompt budget
                repromptBudget: {
                    maxRepromptsPerSlot: frontDeskBehavior.policies?.repromptBudget?.maxRepromptsPerSlot || 3,
                    maxTotalReprompts: frontDeskBehavior.policies?.repromptBudget?.maxTotalReprompts || 10,
                    onExceed: frontDeskBehavior.policies?.repromptBudget?.onExceed || 'transfer'
                },
                source: 'aiAgentSettings.frontDeskBehavior.policies'
            },

            // Tab: Booking (LEGACY - use slotRegistry + bookingFlow instead)
            booking: {
                // Single runtime entry point for slots (LEGACY)
                runtimeSlots: {
                    source: bookingRuntime.source,
                    isConfigured: bookingRuntime.isConfigured === true,
                    slotCount: (bookingRuntime.slots || []).length,
                    requiredSlotIds: (bookingRuntime.slots || []).filter(s => s.required).map(s => s.slotId),
                    slotsSample: (bookingRuntime.slots || []).slice(0, 6).map(s => ({
                        id: s.slotId,
                        type: s.type,
                        required: s.required === true,
                        questionPreview: (s.question || '').substring(0, 60)
                    }))
                },

                // Booking outcome (finalization copy + mode)
                bookingOutcome: {
                    mode: frontDeskBehavior.bookingOutcome?.mode || 'confirmed_on_call',
                    useAsapVariant: frontDeskBehavior.bookingOutcome?.useAsapVariant !== false,
                    hasAsapVariantScript: !!frontDeskBehavior.bookingOutcome?.asapVariantScript,
                    hasCustomFinalScript: !!frontDeskBehavior.bookingOutcome?.customFinalScript,
                    finalScriptsCount: frontDeskBehavior.bookingOutcome?.finalScripts
                        ? Object.keys(frontDeskBehavior.bookingOutcome.finalScripts).length
                        : 0
                },

                // ☢️ NUKED: bookingContractV2 section removed Jan 2026

                // Vendor / Supplier handling (runtime fast-path exists)
                vendorHandling: {
                    vendorFirstEnabled: frontDeskBehavior.vendorHandling?.vendorFirstEnabled === true,
                    enabled: frontDeskBehavior.vendorHandling?.enabled === true,
                    mode: frontDeskBehavior.vendorHandling?.mode || 'collect_message',
                    allowLinkToCustomer: frontDeskBehavior.vendorHandling?.allowLinkToCustomer === true
                },

                // Unit of Work (UoW)
                unitOfWork: {
                    enabled: frontDeskBehavior.unitOfWork?.enabled === true,
                    allowMultiplePerCall: frontDeskBehavior.unitOfWork?.allowMultiplePerCall === true,
                    maxUnitsPerCall: typeof frontDeskBehavior.unitOfWork?.maxUnitsPerCall === 'number'
                        ? frontDeskBehavior.unitOfWork.maxUnitsPerCall
                        : null,
                    perUnitSlotIds: Array.isArray(frontDeskBehavior.unitOfWork?.perUnitSlotIds)
                        ? frontDeskBehavior.unitOfWork.perUnitSlotIds
                        : []
                },

                // After-hours deterministic message contract
                afterHoursMessageContract: (() => {
                    const c = frontDeskBehavior.afterHoursMessageContract || {};
                    const mode = c.mode === 'custom' ? 'custom' : 'inherit_booking_minimum';
                    const requiredFieldKeys = Array.isArray(c.requiredFieldKeys) ? c.requiredFieldKeys : [];
                    const extraSlotIds = Array.isArray(c.extraSlotIds) ? c.extraSlotIds : [];
                    const baseline = ['name', 'phone', 'address', 'problemSummary', 'preferredTime'];
                    const effective = mode === 'custom'
                        ? [...requiredFieldKeys, ...extraSlotIds]
                        : baseline;
                    return {
                        mode,
                        requiredFieldKeysCount: requiredFieldKeys.length,
                        extraSlotIdsCount: extraSlotIds.length,
                        effectiveFieldCount: effective.length,
                        effectiveFieldKeysSample: effective.slice(0, 10)
                    };
                })()
            },

            // Tab: Emotions
            emotions: {
                source: 'aiAgentSettings.frontDeskBehavior.emotionResponses',
                configured: !!frontDeskBehavior.emotionResponses,
                // Show toggles only (no scripts)
                responses: (() => {
                    const er = frontDeskBehavior.emotionResponses || {};
                    const pick = (k) => ({
                        enabled: er?.[k]?.enabled !== false,
                        ...(k === 'frustrated' ? { reduceFriction: er?.[k]?.reduceFriction === true } : {}),
                        ...(k === 'angry' ? { offerEscalation: er?.[k]?.offerEscalation === true } : {}),
                        ...(k === 'friendly' ? { allowSmallTalk: er?.[k]?.allowSmallTalk === true } : {}),
                        ...(k === 'joking' ? { respondInKind: er?.[k]?.respondInKind === true } : {}),
                        ...(k === 'panicked' ? {
                            bypassAllQuestions: er?.[k]?.bypassAllQuestions === true,
                            confirmFirst: er?.[k]?.confirmFirst === true
                        } : {})
                    });
                    return {
                        stressed: pick('stressed'),
                        frustrated: pick('frustrated'),
                        angry: pick('angry'),
                        friendly: pick('friendly'),
                        joking: pick('joking'),
                        panicked: pick('panicked')
                    };
                })()
            },

            // Tab: Frustration
            frustration: {
                source: 'aiAgentSettings.frontDeskBehavior.frustrationTriggers',
                triggerCount: Array.isArray(frontDeskBehavior.frustrationTriggers) ? frontDeskBehavior.frustrationTriggers.length : 0,
                triggersSample: Array.isArray(frontDeskBehavior.frustrationTriggers)
                    ? frontDeskBehavior.frustrationTriggers.slice(0, 10)
                    : []
            },

            // Tab: Escalation
            escalation: {
                source: 'aiAgentSettings.frontDeskBehavior.escalation',
                enabled: frontDeskBehavior.escalation?.enabled !== false,
                triggerCount: Array.isArray(frontDeskBehavior.escalation?.triggerPhrases)
                    ? frontDeskBehavior.escalation.triggerPhrases.length
                    : 0,
                maxLoopsBeforeOffer: typeof frontDeskBehavior.escalation?.maxLoopsBeforeOffer === 'number'
                    ? frontDeskBehavior.escalation.maxLoopsBeforeOffer
                    : null,
                hasOfferMessage: !!frontDeskBehavior.escalation?.offerMessage,
                hasTransferMessage: !!frontDeskBehavior.escalation?.transferMessage,
                triggersSample: Array.isArray(frontDeskBehavior.escalation?.triggerPhrases)
                    ? frontDeskBehavior.escalation.triggerPhrases.slice(0, 10)
                    : []
            },

            // Tab: Loops
            loops: {
                source: 'aiAgentSettings.frontDeskBehavior.loopPrevention',
                enabled: frontDeskBehavior.loopPrevention?.enabled !== false,
                maxSameQuestion: typeof frontDeskBehavior.loopPrevention?.maxSameQuestion === 'number'
                    ? frontDeskBehavior.loopPrevention.maxSameQuestion
                    : null,
                rephraseIntro: frontDeskBehavior.loopPrevention?.rephraseIntro || null,
                hasOnLoopScript: !!frontDeskBehavior.loopPrevention?.onLoop
            },

            // Tab: Forbidden
            forbidden: {
                source: 'aiAgentSettings.frontDeskBehavior.forbiddenPhrases',
                count: Array.isArray(frontDeskBehavior.forbiddenPhrases) ? frontDeskBehavior.forbiddenPhrases.length : 0,
                sample: Array.isArray(frontDeskBehavior.forbiddenPhrases) ? frontDeskBehavior.forbiddenPhrases.slice(0, 10) : []
            },

            // Tab: Detection
            detection: {
                source: 'aiAgentSettings.frontDeskBehavior.detectionTriggers',
                triggers: {
                    trustConcernCount: Array.isArray(frontDeskBehavior.detectionTriggers?.trustConcern)
                        ? frontDeskBehavior.detectionTriggers.trustConcern.length
                        : 0,
                    callerFeelsIgnoredCount: Array.isArray(frontDeskBehavior.detectionTriggers?.callerFeelsIgnored)
                        ? frontDeskBehavior.detectionTriggers.callerFeelsIgnored.length
                        : 0,
                    refusedSlotCount: Array.isArray(frontDeskBehavior.detectionTriggers?.refusedSlot)
                        ? frontDeskBehavior.detectionTriggers.refusedSlot.length
                        : 0,
                    describingProblemCount: Array.isArray(frontDeskBehavior.detectionTriggers?.describingProblem)
                        ? frontDeskBehavior.detectionTriggers.describingProblem.length
                        : 0,
                    wantsBookingCount: Array.isArray(frontDeskBehavior.detectionTriggers?.wantsBooking)
                        ? frontDeskBehavior.detectionTriggers.wantsBooking.length
                        : 0
                }
            },

            // Tab: Fallbacks
            fallbacks: {
                source: 'aiAgentSettings.frontDeskBehavior.fallbackResponses',
                configured: !!frontDeskBehavior.fallbackResponses,
                keysConfigured: (() => {
                    const fb = frontDeskBehavior.fallbackResponses || {};
                    return Object.keys(fb).filter(k => typeof fb[k] === 'string' && fb[k].trim().length > 0);
                })(),
                preview: (() => {
                    const fb = frontDeskBehavior.fallbackResponses || {};
                    const pick = (k) => (typeof fb[k] === 'string' && fb[k].trim()) ? fb[k].trim().substring(0, 80) : null;
                    return {
                        greeting: pick('greeting'),
                        didNotUnderstandTier1: pick('didNotUnderstandTier1'),
                        didNotUnderstandTier2: pick('didNotUnderstandTier2'),
                        didNotUnderstandTier3: pick('didNotUnderstandTier3')
                    };
                })()
            },

            // Tab: Modes
            modes: {
                source: 'aiAgentSettings.frontDeskBehavior.modeSwitching',
                configured: !!frontDeskBehavior.modeSwitching,
                minTurnsBeforeBooking: Number.isFinite(frontDeskBehavior.modeSwitching?.minTurnsBeforeBooking)
                    ? frontDeskBehavior.modeSwitching.minTurnsBeforeBooking
                    : null,
                bookingConfidenceThreshold: typeof frontDeskBehavior.modeSwitching?.bookingConfidenceThreshold === 'number'
                    ? frontDeskBehavior.modeSwitching.bookingConfidenceThreshold
                    : null,
                autoRescueOnFrustration: frontDeskBehavior.modeSwitching?.autoRescueOnFrustration !== false,
                // V116: autoTriageOnProblem reads from V110 canonical path (triage.autoOnProblem)
                autoTriageOnProblem: frontDeskBehavior.triage?.autoOnProblem !== false
            },
            
            // Tab: Hours & Availability (V109: Canonical location is frontDeskBehavior.businessHours)
            businessHours: (() => {
                // V109: Check CANONICAL location first (frontDeskBehavior.businessHours)
                // Fall back to LEGACY location (aiAgentSettings.businessHours) for migration period
                const canonicalHours = frontDeskBehavior.businessHours;
                const legacyHours = company.aiAgentSettings?.businessHours;
                const hours = canonicalHours || legacyHours;
                const sourceLocation = canonicalHours 
                    ? 'aiAgentSettings.frontDeskBehavior.businessHours (CANONICAL)' 
                    : (legacyHours 
                        ? 'aiAgentSettings.businessHours (LEGACY - should migrate)' 
                        : 'NOT_CONFIGURED');
                
                return {
                    source: sourceLocation,
                    configured: !!(hours && (hours.timezone || hours.weekly)),
                    usesLegacyLocation: !canonicalHours && !!legacyHours,
                    timezone: hours?.timezone || null,
                    weeklyConfigured: !!(hours?.weekly && Object.keys(hours.weekly).length > 0),
                    weeklyDaysSet: hours?.weekly ? Object.keys(hours.weekly).filter(k => hours.weekly[k] !== null).length : 0,
                    holidaysCount: Array.isArray(hours?.holidays) ? hours.holidays.length : 0,
                    // Sample for validation
                    sample: hours?.weekly ? Object.entries(hours.weekly).slice(0, 3).map(([day, val]) => ({
                        day,
                        isOpen: val !== null,
                        hours: val ? `${val.open || '?'}-${val.close || '?'}` : 'CLOSED'
                    })) : []
                };
            })(),
            
            // Tab: Scheduling (Phase 1 - Request Only)
            scheduling: {
                source: 'aiAgentSettings.frontDeskBehavior.scheduling',
                provider: frontDeskBehavior.scheduling?.provider || 'request_only',
                timeWindowsCount: Array.isArray(frontDeskBehavior.scheduling?.timeWindows) 
                    ? frontDeskBehavior.scheduling.timeWindows.length 
                    : 0,
                timeWindowsSample: Array.isArray(frontDeskBehavior.scheduling?.timeWindows)
                    ? frontDeskBehavior.scheduling.timeWindows.slice(0, 5).map(w => ({
                        id: w.id,
                        label: w.label,
                        time: w.time || `${w.startTime || '?'}-${w.endTime || '?'}`
                    }))
                    : [],
                promptConfigured: !!frontDeskBehavior.scheduling?.morningAfternoonPrompt || !!frontDeskBehavior.scheduling?.timeWindowPrompt
            }
        };

        // ═══════════════════════════════════════════════════════════════════════
        // BUILD VENDOR / SUPPLIER HANDLING (Call Center directory)
        // ═══════════════════════════════════════════════════════════════════════
        const vendorHandling = frontDeskBehavior.vendorHandling || {};
        const vendor = {
            source: 'aiAgentSettings.frontDeskBehavior.vendorHandling',
            vendorFirstEnabled: vendorHandling.vendorFirstEnabled === true,
            enabled: vendorHandling.enabled === true,
            mode: vendorHandling.mode || 'collect_message',
            allowLinkToCustomer: vendorHandling.allowLinkToCustomer === true,
            promptsConfigured: !!vendorHandling.prompts
        };

        // ═══════════════════════════════════════════════════════════════════════
        // BUILD UNIT OF WORK (UoW) - Universal multi-location / multi-job container
        // ═══════════════════════════════════════════════════════════════════════
        const uow = frontDeskBehavior.unitOfWork || {};
        const unitOfWork = {
            source: 'aiAgentSettings.frontDeskBehavior.unitOfWork',
            enabled: uow.enabled === true,
            allowMultiplePerCall: uow.allowMultiplePerCall === true,
            maxUnitsPerCall: typeof uow.maxUnitsPerCall === 'number' ? uow.maxUnitsPerCall : 3,
            labelSingular: uow.labelSingular || 'Job',
            labelPlural: uow.labelPlural || 'Jobs',
            perUnitSlotIds: Array.isArray(uow.perUnitSlotIds) ? uow.perUnitSlotIds : [],
            confirmation: {
                hasAskAddAnotherPrompt: !!uow.confirmation?.askAddAnotherPrompt,
                hasFinalScriptMulti: !!uow.confirmation?.finalScriptMulti
            }
        };

        // ═══════════════════════════════════════════════════════════════════════
        // V83: BUILD LLM-0 CONTROLS - Brain-1 behavior settings (silence, loops, spam, patience)
        // Source: aiAgentSettings.llm0Controls (loaded by LLM0ControlsLoader.js)
        // ═══════════════════════════════════════════════════════════════════════
        const llm0Raw = company.aiAgentSettings?.llm0Controls || {};
        const llm0Controls = {
            source: 'aiAgentSettings.llm0Controls',
            // Silence Handling (detects caller going quiet)
            silenceHandling: {
                enabled: llm0Raw.silenceHandling?.enabled !== false,
                thresholdSeconds: llm0Raw.silenceHandling?.thresholdSeconds ?? 5,
                maxPrompts: llm0Raw.silenceHandling?.maxPrompts ?? 3,
                offerCallback: llm0Raw.silenceHandling?.offerCallback !== false,
                hasFirstPrompt: !!llm0Raw.silenceHandling?.firstPrompt,
                hasSecondPrompt: !!llm0Raw.silenceHandling?.secondPrompt,
                hasThirdPrompt: !!llm0Raw.silenceHandling?.thirdPrompt,
                hasCallbackMessage: !!llm0Raw.silenceHandling?.callbackMessage
            },
            // Loop Detection (prevents repeated responses)
            loopDetection: {
                enabled: llm0Raw.loopDetection?.enabled !== false,
                maxRepeatedResponses: llm0Raw.loopDetection?.maxRepeatedResponses ?? 3,
                detectionWindow: llm0Raw.loopDetection?.detectionWindow ?? 5,
                onLoopAction: llm0Raw.loopDetection?.onLoopAction || 'escalate',
                hasEscalationMessage: !!llm0Raw.loopDetection?.escalationMessage
            },
            // Spam Filter (telemarketer detection)
            spamFilter: {
                enabled: llm0Raw.spamFilter?.enabled !== false,
                phraseCount: Array.isArray(llm0Raw.spamFilter?.telemarketerPhrases) 
                    ? llm0Raw.spamFilter.telemarketerPhrases.length 
                    : 0,
                onSpamDetected: llm0Raw.spamFilter?.onSpamDetected || 'polite_dismiss',
                autoAddToBlacklist: llm0Raw.spamFilter?.autoAddToBlacklist === true,
                logToBlackBox: llm0Raw.spamFilter?.logToBlackBox !== false,
                hasDismissMessage: !!llm0Raw.spamFilter?.dismissMessage
            },
            // Customer Patience (never hang up on customers)
            customerPatience: {
                enabled: llm0Raw.customerPatience?.enabled !== false,
                neverAutoHangup: llm0Raw.customerPatience?.neverAutoHangup !== false,
                maxPatiencePrompts: llm0Raw.customerPatience?.maxPatiencePrompts ?? 5,
                alwaysOfferCallback: llm0Raw.customerPatience?.alwaysOfferCallback !== false,
                hasPatienceMessage: !!llm0Raw.customerPatience?.patienceMessage
            },
            // Bailout Rules (when to escalate/transfer)
            bailoutRules: {
                enabled: llm0Raw.bailoutRules?.enabled !== false,
                maxTurnsBeforeEscalation: llm0Raw.bailoutRules?.maxTurnsBeforeEscalation ?? 10,
                confusionThreshold: llm0Raw.bailoutRules?.confusionThreshold ?? 0.3,
                escalateOnBailout: llm0Raw.bailoutRules?.escalateOnBailout !== false,
                hasBailoutMessage: !!llm0Raw.bailoutRules?.bailoutMessage,
                hasTransferTarget: !!llm0Raw.bailoutRules?.transferTarget
            },
            // Confidence Thresholds (for decision making)
            confidenceThresholds: {
                highConfidence: llm0Raw.confidenceThresholds?.highConfidence ?? 0.85,
                mediumConfidence: llm0Raw.confidenceThresholds?.mediumConfidence ?? 0.65,
                lowConfidence: llm0Raw.confidenceThresholds?.lowConfidence ?? 0.45,
                fallbackToLLM: llm0Raw.confidenceThresholds?.fallbackToLLM ?? 0.4
            }
        };
        
        // ═══════════════════════════════════════════════════════════════════════
        // BUILD WIRING MAP - The Critical Link (Scenario → Action → Flow → Booking)
        // ═══════════════════════════════════════════════════════════════════════
        
        // Count scenarios by effective action type
        const actionTypeCounts = {
            'REPLY_ONLY': scenarios.filter(s => s.wiring.effectiveAction === 'REPLY_ONLY').length,
            'START_FLOW': scenarios.filter(s => s.wiring.effectiveAction === 'START_FLOW').length,
            'REQUIRE_BOOKING': scenarios.filter(s => s.wiring.effectiveAction === 'REQUIRE_BOOKING' || s.wiring.effectiveAction === 'START_BOOKING').length,
            'TRANSFER': scenarios.filter(s => s.wiring.effectiveAction === 'TRANSFER').length,
            'SMS_FOLLOWUP': scenarios.filter(s => s.wiring.effectiveAction === 'SMS_FOLLOWUP').length,
            'ESCALATE_OR_BOOK': scenarios.filter(s => s.wiring.effectiveAction === 'ESCALATE_OR_BOOK').length,
            'REPLY_THEN_ASK': scenarios.filter(s => s.wiring.effectiveAction === 'REPLY_THEN_ASK').length
        };
        
        const wiringMap = {
            // Map scenarioType → default action + priority (runtime uses this if no explicit actionType)
            scenarioTypeToAction: {
                'EMERGENCY': { defaultAction: 'ESCALATE_OR_BOOK', stopRouting: true, priority: 100 },
                'BOOKING': { defaultAction: 'REQUIRE_BOOKING', stopRouting: false, priority: 75 },
                'TROUBLESHOOT': { defaultAction: 'REPLY_ONLY', stopRouting: false, priority: 50 },
                'FAQ': { defaultAction: 'REPLY_ONLY', stopRouting: false, priority: 40 },
                'BILLING': { defaultAction: 'REPLY_ONLY', stopRouting: false, priority: 50 },
                'TRANSFER': { defaultAction: 'TRANSFER', stopRouting: true, priority: 85 },
                'SMALL_TALK': { defaultAction: 'REPLY_ONLY', stopRouting: false, priority: 10 },
                'SYSTEM': { defaultAction: 'REPLY_ONLY', stopRouting: false, priority: 30 },
                'UNKNOWN': { defaultAction: 'REPLY_ONLY', stopRouting: false, priority: 20 }
            },
            
            // Allowed actionType enum values
            allowedActionTypes: ['REPLY_ONLY', 'START_FLOW', 'REQUIRE_BOOKING', 'TRANSFER', 'SMS_FOLLOWUP'],
            
            // Current distribution of scenarios by effective action
            actionTypeCounts,
            
            // What percentage of scenarios are properly wired?
            coverage: {
                totalScenarios: scenarios.length,
                withScenarioType: scenarios.filter(s => s.scenarioType !== 'UNKNOWN').length,
                withExplicitActionType: scenarios.filter(s => s.wiring.actionType).length,
                withTransferTarget: scenarios.filter(s => s.wiring.transferTarget).length,
                withFlowId: scenarios.filter(s => s.wiring.flowId).length,
                withBookingIntent: scenarios.filter(s => s.wiring.bookingIntent).length,
                withRequiredSlots: scenarios.filter(s => s.wiring.requiredSlots && s.wiring.requiredSlots.length > 0).length,
                withStopRouting: scenarios.filter(s => s.wiring.stopRouting).length,
                validated: scenarios.filter(s => s.wiringValidated || s.wiringValidatedEffective).length,
                
                // Enterprise enforcement stats
                enterpriseReady: scenarios.filter(s => s.enforcement?.enterpriseReady).length,
                notEnterpriseReady: scenarios.filter(s => !s.enforcement?.enterpriseReady).length,
                willMatchAtRuntime: scenarios.filter(s => s.enforcement?.willMatch).length
            },
            
            // ═══════════════════════════════════════════════════════════════
            // 🛡️ ENTERPRISE ENFORCEMENT SUMMARY
            // ═══════════════════════════════════════════════════════════════
            enforcement: {
                enabled: true, // Always enforced - NO EXCEPTIONS
                rule: 'A scenario cannot be enabled unless enterpriseReady === true',
                totalScenarios: scenarios.length,
                enterpriseReadyCount: scenarios.filter(s => s.enforcement?.enterpriseReady).length,
                percentReady: scenarios.length > 0 
                    ? Math.round(scenarios.filter(s => s.enforcement?.enterpriseReady).length / scenarios.length * 100)
                    : 0,
                qualityRequirements: QUALITY_REQUIREMENTS,
                rejectedScenarios: scenarios
                    .filter(s => !s.enforcement?.enterpriseReady)
                    .slice(0, 10)
                    .map(s => ({
                        id: s.id,
                        name: s.name,
                        grade: s.enforcement?.grade,
                        issues: s.enforcement?.issues?.slice(0, 3)
                    }))
            },
            
            // Wiring health summary
            health: {
                scenariosWithoutType: scenarios.filter(s => s.scenarioType === 'UNKNOWN').length,
                startFlowMissingFlowId: scenarios.filter(s => 
                    (s.wiring.actionType === 'START_FLOW' || s.wiring.effectiveAction === 'START_FLOW') && 
                    !s.wiring.flowId
                ).length,
                transferMissingTarget: scenarios.filter(s => 
                    (s.wiring.actionType === 'TRANSFER' || s.wiring.effectiveAction === 'TRANSFER') && 
                    !s.wiring.transferTarget
                ).length,
                bookingMissingSlots: scenarios.filter(s => 
                    s.wiring.bookingIntent && 
                    (!s.wiring.requiredSlots || s.wiring.requiredSlots.length === 0)
                ).length
            }
        };
        
        // ═══════════════════════════════════════════════════════════════════════
        // BUILD HEALTH STATUS
        // ═══════════════════════════════════════════════════════════════════════
        const issues = [];
        
        if (!controlPlane.greeting.configured) {
            issues.push({ severity: 'ERROR', area: 'greeting', message: 'No greeting configured', fix: 'Set controlPlane.greeting.text' });
        }
        
        if (controlPlane.booking.slotsCount === 0 && controlPlane.booking.enabled) {
            issues.push({ severity: 'ERROR', area: 'booking', message: 'Booking enabled but no slots configured', fix: 'Add booking slots' });
        }
        
        if (scenarios.length === 0) {
            issues.push({ severity: 'ERROR', area: 'scenarios', message: 'No scenarios loaded', fix: 'Enable a template in aiAgentSettings.templateReferences' });
        }
        
        // ☢️ NUKED Feb 2026: Dynamic Flows health check removed - V110 architecture replaces it
        // if (enabledFlows.length === 0) { ... }

        // ☢️ NUKED: Booking Contract V2 health check removed Jan 2026
        
        const unknownScenarioItems = scenarios.filter(s => s.scenarioType === 'UNKNOWN');
        const unknownScenarios = unknownScenarioItems.length;
        if (unknownScenarios > 0) {
            const unknownExamples = unknownScenarioItems
                .slice(0, 5)
                .map(s => ({ id: s.id, name: s.name, templateName: s.templateName, locked: s.autofillLock === true }));

            issues.push({ 
                severity: 'WARNING', 
                area: 'scenarios', 
                message: `${unknownScenarios} scenarios have scenarioType=UNKNOWN (no routing)`,
                fix: 'Run Golden Autofill (apply) on ALL enabled templates or manually set scenarioType per scenario.',
                examples: unknownExamples
            });
        }
        
        // 🚨 EMERGENCY ENFORCEMENT: Check for EMERGENCY scenarios without stopRouting=true
        const emergencyWithoutStop = scenarios.filter(s => 
            s.scenarioType === 'EMERGENCY' && s.wiring?.stopRouting !== true
        );
        if (emergencyWithoutStop.length > 0) {
            const examples = emergencyWithoutStop.slice(0, 5).map(s => ({
                id: s.id,
                name: s.name,
                templateName: s.templateName,
                stopRouting: s.wiring?.stopRouting
            }));
            issues.push({
                severity: 'WARNING',
                area: 'emergency_enforcement',
                message: `${emergencyWithoutStop.length} EMERGENCY scenario(s) lack stopRouting=true (safety risk)`,
                fix: 'Run Golden Autofill (apply) or manually set stopRouting=true on EMERGENCY scenarios.',
                examples
            });
        }
        
        // 🛑 TRANSFER ENFORCEMENT: Check for TRANSFER scenarios without stopRouting=true
        const transferWithoutStop = scenarios.filter(s => 
            s.scenarioType === 'TRANSFER' && s.wiring?.stopRouting !== true
        );
        if (transferWithoutStop.length > 0) {
            const examples = transferWithoutStop.slice(0, 3).map(s => ({
                id: s.id,
                name: s.name,
                templateName: s.templateName
            }));
            issues.push({
                severity: 'WARNING',
                area: 'transfer_enforcement',
                message: `${transferWithoutStop.length} TRANSFER scenario(s) lack stopRouting=true`,
                fix: 'Run Golden Autofill (apply) or manually set stopRouting=true on TRANSFER scenarios.',
                examples
            });
        }
        
        if (discoveryConsentTruth.blockAllScenarioAutoRepliesUntilConsent === true) {
            issues.push({ 
                severity: 'WARNING', 
                area: 'consent', 
                message: 'disableScenarioAutoResponses=true - scenarios will not reply until consent given',
                fix: 'Either set discoveryConsent.disableScenarioAutoResponses=false, or configure discoveryConsent.autoReplyAllowedScenarioTypes to allow safe scenario types before consent.'
            });
        }
        
        // V109: Check for legacy businessHours location
        const canonicalBusinessHours = frontDeskBehavior.businessHours;
        const legacyBusinessHours = company.aiAgentSettings?.businessHours;
        if (!canonicalBusinessHours && legacyBusinessHours) {
            issues.push({
                severity: 'WARNING',
                area: 'businessHours',
                message: 'businessHours is at LEGACY location (aiAgentSettings.businessHours) - should be in frontDeskBehavior',
                fix: 'Run migration script: node scripts/migrate-business-hours-to-canonical.js --execute'
            });
        }
        
        const healthStatus = issues.some(i => i.severity === 'ERROR') ? 'RED' : 
                             issues.some(i => i.severity === 'WARNING') ? 'YELLOW' : 'GREEN';
        
        // ═══════════════════════════════════════════════════════════════════════
        // EXPLAIN WHY NOT GREEN - Human-readable blockers summary
        // This is THE authoritative list of what's preventing production readiness
        // ═══════════════════════════════════════════════════════════════════════
        const explainWhyNotGreen = healthStatus === 'GREEN' 
            ? null 
            : {
                status: healthStatus,
                summary: healthStatus === 'RED' 
                    ? `${issues.filter(i => i.severity === 'ERROR').length} critical issue(s) blocking production`
                    : `${issues.filter(i => i.severity === 'WARNING').length} warning(s) need attention`,
                blockers: issues.filter(i => i.severity === 'ERROR').map(i => ({
                    area: i.area,
                    message: i.message,
                    fix: i.fix
                })),
                warnings: issues.filter(i => i.severity === 'WARNING').map(i => ({
                    area: i.area,
                    message: i.message,
                    fix: i.fix
                }))
            };
        
        const health = {
            status: healthStatus,
            issues,
            criticalCount: issues.filter(i => i.severity === 'ERROR').length,
            warningCount: issues.filter(i => i.severity === 'WARNING').length,
            explainWhyNotGreen
        };
        
        // ═══════════════════════════════════════════════════════════════════════
        // BUILD VERSION FOR OPTIMISTIC CONCURRENCY
        // ═══════════════════════════════════════════════════════════════════════
        const version = generateVersionHash(companyId, timestamp);
        
        // ═══════════════════════════════════════════════════════════════════════
        // BUILD FINAL RESPONSE
        // ═══════════════════════════════════════════════════════════════════════
        const runtimeTruth = {
            _meta: {
                companyId,
                companyName: company.companyName,
                tradeKey: company.tradeKey || 'hvac',
                environment: process.env.NODE_ENV || 'development',
                schemaVersion: SCHEMA_VERSION,
                effectiveConfigVersion,
                // 🔒 DRIFT DETECTION: Include last saved ECV for UI comparison
                lastSavedEffectiveConfigVersion: company.aiAgentSettings?._meta?.lastSavedEffectiveConfigVersion || null,
                lastSavedAt: company.aiAgentSettings?._meta?.lastSavedAt || null,
                lastSavedBy: company.aiAgentSettings?._meta?.lastSavedBy || null,
                driftDetected: company.aiAgentSettings?._meta?.lastSavedEffectiveConfigVersion
                    ? company.aiAgentSettings._meta.lastSavedEffectiveConfigVersion !== effectiveConfigVersion
                    : false,
                version, // For optimistic concurrency in patches
                generatedAt: timestamp,
                generationTimeMs: Date.now() - startTime,
                deploy: {
                    // Render provides these env vars in production; null locally.
                    renderGitCommit: process.env.RENDER_GIT_COMMIT || null,
                    renderServiceId: process.env.RENDER_SERVICE_ID || null,
                    renderInstanceId: process.env.RENDER_INSTANCE_ID || null
                },
                sources: [
                    PROVIDER_VERSIONS.controlPlane,
                    PROVIDER_VERSIONS.scenarioBrain,
                    // ☢️ NUKED Feb 2026: dynamicFlow provider version removed
                    PROVIDER_VERSIONS.matchingPolicy,
                    PROVIDER_VERSIONS.placeholders
                ]
            },
            
            health,
            
            // Control Plane (greeting, booking, fallbacks)
            controlPlane: {
                source: PROVIDER_VERSIONS.controlPlane,
                greeting: {
                    configured: controlPlane.greeting.configured,
                    text: controlPlane.greeting.standardized,
                    preview: substitutePlaceholders(controlPlane.greeting.standardized, placeholderMap),
                    editable: true
                },
                // V22 Consent Gate (this MUST match runtime; if it's not here, it doesn't exist)
                discoveryConsent: discoveryConsentTruth,
                // Vocabulary (Caller input translation + output guardrails)
                vocabulary,
                // Front Desk tabs (truth mirrors runtime)
                frontDesk,
                booking,
                vendor,
                unitOfWork,
                // V83: LLM-0 Controls (Brain-1 behavior: silence, loops, spam, patience, bailout)
                llm0Controls,
                fallbacks: {
                    notOffered: { 
                        text: controlPlane.fallbacks.notOfferedReply, 
                        editable: true,
                        id: 'fallback_notOffered'
                    },
                    unknownIntent: { 
                        text: controlPlane.fallbacks.unknownIntentReply, 
                        editable: true,
                        id: 'fallback_unknownIntent'
                    },
                    afterHours: { 
                        text: controlPlane.fallbacks.afterHoursReply, 
                        editable: true,
                        id: 'fallback_afterHours'
                    }
                },
                // Keep legacy/unified personality in output for backward compat (do not use for runtime)
                unifiedPersonality: controlPlane.personality
            },
            
            // Scenario Brain
            scenarioBrain: {
                source: PROVIDER_VERSIONS.scenarioBrain,
                activeTemplates: templates.map(t => ({
                    id: t._id.toString(),
                    name: t.name,
                    categoryCount: (t.categories || []).length,
                    scenarioCount: (t.categories || []).reduce((sum, c) => sum + (c.scenarios || []).length, 0),
                    scope: 'GLOBAL',
                    editable: false
                })),
                categories,
                scenarios,
                totals: {
                    templates: templates.length,
                    categories: categories.length,
                    scenarios: scenarios.length,
                    triggers: totalTriggers
                }
            },
            
            // ☢️ NUKED Feb 2026: dynamicFlows section removed - V110 architecture replaces it
            // dynamicFlows: { ... },
            
            // Matching Policy
            matchingPolicy,
            
            // Wiring Map - The critical link
            wiringMap,
            
            // Placeholders
            placeholders: {
                source: PROVIDER_VERSIONS.placeholders,
                entries: placeholderEntries,
                map: placeholderMap
            }
        };
        
        console.log(`✅ [RUNTIME TRUTH] Generated in ${Date.now() - startTime}ms, version: ${version}`);
        
        res.json({
            success: true,
            data: runtimeTruth
        });
        
    } catch (error) {
        console.error('❌ [RUNTIME TRUTH] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Detect what action a scenario should trigger based on its configuration
 * 
 * PRIORITY ORDER (highest to lowest):
 * 1. Explicit actionType field (if set)
 * 2. Explicit flowId → START_FLOW
 * 3. Explicit transferTarget → TRANSFER
 * 4. Explicit bookingIntent → REQUIRE_BOOKING
 * 5. scenarioType inference (EMERGENCY → ESCALATE_OR_BOOK, BOOKING → REQUIRE_BOOKING)
 * 6. followUpMode inference
 * 7. Default → REPLY_ONLY
 */
function detectScenarioAction(scenario) {
    // If actionType is explicitly set, use it (but we return detected for backward compat)
    // The caller should check scenario.actionType separately
    
    // Explicit flowId → START_FLOW
    if (scenario.flowId) return 'START_FLOW';
    
    // Explicit transfer target → TRANSFER
    if (scenario.transferTarget) return 'TRANSFER';
    
    // Explicit booking intent → REQUIRE_BOOKING
    if (scenario.bookingIntent) return 'REQUIRE_BOOKING';
    
    // Scenario type inference
    switch (scenario.scenarioType) {
        case 'EMERGENCY':
            return 'ESCALATE_OR_BOOK';
        case 'BOOKING':
            return 'REQUIRE_BOOKING';
        case 'TRANSFER':
            return 'TRANSFER';
        // FAQ, TROUBLESHOOT, BILLING, SMALL_TALK, SYSTEM → REPLY_ONLY (default)
    }
    
    // Follow-up mode → REPLY_THEN_ASK
    if (scenario.followUpMode && scenario.followUpMode !== 'NONE') {
        return 'REPLY_THEN_ASK';
    }
    
    // Default → REPLY_ONLY
    return 'REPLY_ONLY';
}

/**
 * Calculate quality score for a scenario (0-100)
 * 
 * SCORING BREAKDOWN:
 * - Triggers: 8 minimum → -5 per missing (max -40)
 * - Negatives: 3 minimum → -5 per missing (max -15)
 * - Quick replies: 7 minimum → -3 per missing (max -21)
 * - Full replies: 3 minimum → -3 per missing (max -9)
 * - Scenario type: -10 if UNKNOWN
 * - Wiring: -15 for critical wiring issues
 */
function calculateScenarioQuality(scenario) {
    let score = 100;
    
    // Triggers (8 minimum)
    const triggers = scenario.triggers || [];
    if (triggers.length < 8) score -= (8 - triggers.length) * 5;
    
    // Negatives (3 minimum)
    const negatives = scenario.negativeTriggers || [];
    if (negatives.length < 3) score -= (3 - negatives.length) * 5;
    
    // Quick replies (7 minimum for variety)
    const quick = scenario.quickReplies || [];
    if (quick.length < 7) score -= (7 - quick.length) * 3;
    
    // Full replies (3 minimum)
    const full = scenario.fullReplies || [];
    if (full.length < 3) score -= (3 - full.length) * 3;
    
    // Scenario type (must be classified)
    if (!scenario.scenarioType || scenario.scenarioType === 'UNKNOWN') score -= 10;
    
    // ═══════════════════════════════════════════════════════════════════════
    // WIRING QUALITY (Critical for scenarios to actually DO something)
    // ═══════════════════════════════════════════════════════════════════════
    
    const actionType = scenario.actionType || detectScenarioAction(scenario);
    
    // START_FLOW without flowId → Critical error
    if (actionType === 'START_FLOW' && !scenario.flowId) {
        score -= 15;
    }
    
    // TRANSFER without transferTarget → Critical error
    if (actionType === 'TRANSFER' && !scenario.transferTarget) {
        score -= 15;
    }
    
    // REQUIRE_BOOKING without slots → Warning
    if ((actionType === 'REQUIRE_BOOKING' || scenario.bookingIntent) && 
        (!scenario.requiredSlots || scenario.requiredSlots.length === 0)) {
        score -= 5;
    }
    
    // EMERGENCY without stopRouting → Warning (should stop other scenarios)
    if (scenario.scenarioType === 'EMERGENCY' && !scenario.stopRouting) {
        score -= 5;
    }
    
    return Math.max(0, score);
}

/**
 * Get list of issues for a scenario (content + wiring)
 */
function getScenarioIssues(scenario) {
    const issues = [];
    
    // ═══════════════════════════════════════════════════════════════════════
    // CONTENT ISSUES
    // ═══════════════════════════════════════════════════════════════════════
    
    const triggers = scenario.triggers || [];
    if (triggers.length < 8) issues.push(`triggers: ${triggers.length}/8`);
    
    const negatives = scenario.negativeTriggers || [];
    if (negatives.length < 3) issues.push(`negatives: ${negatives.length}/3`);
    
    const quick = scenario.quickReplies || [];
    if (quick.length < 7) issues.push(`quickReplies: ${quick.length}/7`);
    
    const full = scenario.fullReplies || [];
    if (full.length < 3) issues.push(`fullReplies: ${full.length}/3`);
    
    if (!scenario.scenarioType || scenario.scenarioType === 'UNKNOWN') {
        issues.push('scenarioType: UNKNOWN');
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // WIRING ISSUES (Critical - prevents scenario from working)
    // ═══════════════════════════════════════════════════════════════════════
    
    const actionType = scenario.actionType || detectScenarioAction(scenario);
    
    // START_FLOW requires flowId
    if (actionType === 'START_FLOW' && !scenario.flowId) {
        issues.push('WIRING: START_FLOW requires flowId');
    }
    
    // TRANSFER requires transferTarget
    if (actionType === 'TRANSFER' && !scenario.transferTarget) {
        issues.push('WIRING: TRANSFER requires transferTarget');
    }
    
    // REQUIRE_BOOKING should have requiredSlots
    if ((actionType === 'REQUIRE_BOOKING' || scenario.bookingIntent) && 
        (!scenario.requiredSlots || scenario.requiredSlots.length === 0)) {
        issues.push('WIRING: booking intent without requiredSlots');
    }
    
    // EMERGENCY should stop other scenarios from firing
    if (scenario.scenarioType === 'EMERGENCY' && !scenario.stopRouting) {
        issues.push('WIRING: EMERGENCY should have stopRouting=true');
    }
    
    // Include any explicit wiring issues from validation
    if (scenario.wiringIssues && scenario.wiringIssues.length > 0) {
        scenario.wiringIssues.forEach(issue => {
            if (!issues.includes(issue)) {
                issues.push(issue);
            }
        });
    }
    
    return issues;
}

module.exports = router;
