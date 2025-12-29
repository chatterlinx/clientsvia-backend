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
const DynamicFlow = require('../../models/DynamicFlow');
const { authenticateJWT, requireCompanyAccess } = require('../../middleware/auth');
const { unifyConfig } = require('../../utils/configUnifier');
const { substitutePlaceholders } = require('../../utils/placeholderStandard');
const { validateScenarioQuality, QUALITY_REQUIREMENTS } = require('../../utils/scenarioEnforcement');
const logger = require('../../utils/logger');
const BookingContractCompiler = require('../../services/BookingContractCompiler');
const BookingScriptEngine = require('../../services/BookingScriptEngine');

// ============================================================================
// PROVIDER VERSIONS - Track what version of each provider generated data
// ============================================================================
const PROVIDER_VERSIONS = {
    controlPlane: 'controlPlane:v3',
    scenarioBrain: 'scenarioBrain:v2',
    dynamicFlow: 'dynamicFlow:v2',
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
        const [company, responseDefaults, placeholdersDoc, allDynamicFlows] = await Promise.all([
            v2Company.findById(companyId).lean(),
            CompanyResponseDefaults.getOrCreate(companyId),
            CompanyPlaceholders.findOne({ companyId }).lean(),
            DynamicFlow.find({ companyId }).lean() // Get ALL flows, not just enabled
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
                        
                        // Wiring validation state
                        wiringValidated: scenario.wiringValidated || false,
                        wiringValidatedAt: scenario.wiringValidatedAt || null,
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
        
        // ═══════════════════════════════════════════════════════════════════════
        // FORMAT DYNAMIC FLOWS - Include ALL with enabled flag
        // ═══════════════════════════════════════════════════════════════════════
        const flows = allDynamicFlows.map(flow => ({
            id: flow._id.toString(),
            flowKey: flow.flowKey,
            name: flow.name,
            enabled: flow.enabled,
            priority: flow.priority || 0,
            
            // Scope info
            scope: flow.scope || 'COMPANY',
            editable: (flow.scope || 'COMPANY') === 'COMPANY',
            
            // Entry conditions - phrases are in t.config.phrases per schema
            triggers: (flow.triggers || []).map(t => {
                const phrases = t.config?.phrases || t.phrases || [];
                return {
                    type: t.type || 'phrase',
                    phrases: phrases.slice(0, 5),
                    phraseCount: phrases.length,
                    matchMode: t.config?.matchMode || t.matchMode || 'contains',
                    minConfidence: t.config?.minConfidence || t.minConfidence || 0.7
                };
            }),
            
            // Actions
            actions: (flow.actions || []).map(a => ({
                type: a.type,
                key: a.key,
                value: a.value
            })),
            
            // Settings
            allowConcurrent: flow.allowConcurrent || false,
            minConfidence: flow.minConfidence || 0.7
        }));
        
        const enabledFlows = flows.filter(f => f.enabled);
        
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
        const v22Consent = {
            bookingRequiresExplicitConsent: normalizeBoolean(frontDeskDiscoveryConsent.bookingRequiresExplicitConsent, true),
            forceLLMDiscovery: normalizeBoolean(frontDeskDiscoveryConsent.forceLLMDiscovery, true),
            // Default MUST be false (do not silently block scenario replies when unset)
            disableScenarioAutoResponses: normalizeBoolean(frontDeskDiscoveryConsent.disableScenarioAutoResponses, false),
            consentQuestionTemplate: frontDeskDiscoveryConsent.consentQuestionTemplate || null,
            consentYesWords: Array.isArray(frontDeskDiscoveryConsent.consentYesWords) ? frontDeskDiscoveryConsent.consentYesWords : [],
            consentPhrases: Array.isArray(frontDeskDetectionTriggers.wantsBooking) ? frontDeskDetectionTriggers.wantsBooking : []
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
                required: v22Consent.bookingRequiresExplicitConsent,
                bookingRequiresExplicitConsent: v22Consent.bookingRequiresExplicitConsent,
                forceLLMDiscovery: v22Consent.forceLLMDiscovery,
                disableScenarioAutoResponses: v22Consent.disableScenarioAutoResponses,
                scenariosBlockedByConsent: v22Consent.disableScenarioAutoResponses === true,
                consentPhrasesCount: v22Consent.consentPhrases.length,
                consentYesWordsCount: v22Consent.consentYesWords.length
            }
        };
        
        // ═══════════════════════════════════════════════════════════════════════
        // BUILD BOOKING CONFIG
        // ═══════════════════════════════════════════════════════════════════════
        const bookingV2Enabled = frontDeskBehavior.bookingContractV2Enabled === true;
        const bookingV2Library = Array.isArray(frontDeskBehavior.slotLibrary) ? frontDeskBehavior.slotLibrary : [];
        const bookingV2Groups = Array.isArray(frontDeskBehavior.slotGroups) ? frontDeskBehavior.slotGroups : [];
        const bookingV2PreviewFlags = {};
        const bookingV2CompiledPreview = (bookingV2Enabled && bookingV2Library.length > 0 && bookingV2Groups.length > 0)
            ? BookingContractCompiler.compileBookingSlots({ slotLibrary: bookingV2Library, slotGroups: bookingV2Groups, contextFlags: bookingV2PreviewFlags })
            : null;

        // Enterprise guardrail: default group should exist so preview {} never shows 0 "by design"
        // A "default group" is either explicitly isDefault=true or a group with empty when:{} (matches all).
        const bookingV2DefaultGroupExists = Array.isArray(bookingV2Groups) && bookingV2Groups.some(g => {
            if (!g || g.enabled === false) return false;
            const when = g.when;
            const whenIsEmptyObject = when && typeof when === 'object' && !Array.isArray(when) && Object.keys(when).length === 0;
            return g.isDefault === true || whenIsEmptyObject;
        });
        
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

            // Booking Contract V2 (feature-flagged; compiler preview uses empty flags)
            bookingContractV2: {
                enabled: bookingV2Enabled,
                slotLibraryCount: bookingV2Library.length,
                slotGroupsCount: bookingV2Groups.length,
                compiledPreview: bookingV2CompiledPreview ? {
                    hash: bookingV2CompiledPreview.hash,
                    compilePreviewFlagsUsed: bookingV2CompiledPreview.contextFlags || bookingV2PreviewFlags,
                    defaultGroupExists: bookingV2DefaultGroupExists,
                    matchingGroupIds: bookingV2CompiledPreview.matchingGroupIds,
                    activatedGroupId: (bookingV2CompiledPreview.matchingGroupIds && bookingV2CompiledPreview.matchingGroupIds[0]) || null,
                    activeSlotIdsOrdered: bookingV2CompiledPreview.activeSlotIdsOrdered,
                    missingSlotRefs: bookingV2CompiledPreview.missingSlotRefs
                } : null
            }
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
        const customNameStopWords = company.aiAgentSettings?.nameStopWords?.custom || [];

        const vocabulary = {
            source: 'aiAgentSettings.frontDeskBehavior.(callerVocabulary|vocabularyGuardrails) + aiAgentSettings.(fillerWords|nameStopWords)',

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

            // Tab: Booking
            booking: {
                // Single runtime entry point for slots
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

                // Contract V2 status (feature-flagged)
                bookingContractV2: {
                    enabled: frontDeskBehavior.bookingContractV2Enabled === true,
                    slotLibraryCount: Array.isArray(frontDeskBehavior.slotLibrary) ? frontDeskBehavior.slotLibrary.length : 0,
                    slotGroupsCount: Array.isArray(frontDeskBehavior.slotGroups) ? frontDeskBehavior.slotGroups.length : 0,
                    compiledPreviewHash: bookingV2CompiledPreview?.hash || null,
                    compiledPreviewActiveCount: bookingV2CompiledPreview?.activeSlotIdsOrdered?.length || 0,
                    compiledPreviewMissingRefsCount: bookingV2CompiledPreview?.missingSlotRefs?.length || 0,
                    compilePreviewFlagsUsed: bookingV2CompiledPreview?.contextFlags || bookingV2PreviewFlags,
                    defaultGroupExists: bookingV2DefaultGroupExists,
                    activatedGroupId: (bookingV2CompiledPreview?.matchingGroupIds && bookingV2CompiledPreview.matchingGroupIds[0]) || null
                },

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
                }
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
                autoTriageOnProblem: frontDeskBehavior.modeSwitching?.autoTriageOnProblem !== false
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
                validated: scenarios.filter(s => s.wiringValidated).length,
                
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
        
        if (enabledFlows.length === 0) {
            issues.push({ severity: 'WARNING', area: 'flows', message: 'No dynamic flows enabled - scenarios will reply but not coordinate', fix: 'Enable at least one flow in dynamicFlows' });
        }

        // Booking Contract V2 health (feature-flagged)
        if (booking.bookingContractV2?.enabled) {
            const compiledPreview = booking.bookingContractV2.compiledPreview;
            if (!compiledPreview) {
                issues.push({
                    severity: 'ERROR',
                    area: 'bookingContractV2',
                    message: 'Booking Contract V2 enabled but no slotLibrary/slotGroups configured',
                    fix: 'Add slotLibrary + slotGroups (or disable bookingContractV2Enabled)'
                });
            } else if ((compiledPreview.activeSlotIdsOrdered || []).length === 0) {
                issues.push({
                    severity: 'ERROR',
                    area: 'bookingContractV2',
                    message: 'Booking Contract V2 enabled but compiled active slots is empty',
                    fix: 'Ensure at least one enabled slotGroup matches flags and includes slot IDs present in slotLibrary'
                });
            } else if ((compiledPreview.missingSlotRefs || []).length > 0) {
                issues.push({
                    severity: 'ERROR',
                    area: 'bookingContractV2',
                    message: 'Booking Contract V2 compiled slots reference missing slotLibrary IDs',
                    fix: `Fix slotGroups.slots to reference valid slotLibrary ids (missing: ${(compiledPreview.missingSlotRefs || []).slice(0, 5).join(', ')})`
                });
            }
        }
        
        const unknownScenarioItems = scenarios.filter(s => s.scenarioType === 'UNKNOWN');
        const unknownScenarios = unknownScenarioItems.length;
        if (unknownScenarios > 0) {
            const unknownExamples = unknownScenarioItems
                .slice(0, 5)
                .map(s => ({ id: s.id, name: s.name, templateName: s.templateName }));

            issues.push({ 
                severity: 'WARNING', 
                area: 'scenarios', 
                message: `${unknownScenarios} scenarios have scenarioType=UNKNOWN (no routing)`,
                fix: 'Run Golden Autofill (apply) on ALL enabled templates or manually set scenarioType per scenario.',
                examples: unknownExamples
            });
        }
        
        if (matchingPolicy.discoveryConsent.disableScenarioAutoResponses === true) {
            issues.push({ 
                severity: 'WARNING', 
                area: 'consent', 
                message: 'disableScenarioAutoResponses=true - scenarios will not reply until consent given',
                fix: 'Set discoveryConsent.disableScenarioAutoResponses=false'
            });
        }
        
        const health = {
            status: issues.some(i => i.severity === 'ERROR') ? 'RED' : 
                    issues.some(i => i.severity === 'WARNING') ? 'YELLOW' : 'GREEN',
            issues,
            criticalCount: issues.filter(i => i.severity === 'ERROR').length,
            warningCount: issues.filter(i => i.severity === 'WARNING').length
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
                    PROVIDER_VERSIONS.dynamicFlow,
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
                discoveryConsent: controlPlane.discoveryConsent,
                // Vocabulary (Caller input translation + output guardrails)
                vocabulary,
                // Front Desk tabs (truth mirrors runtime)
                frontDesk,
                booking,
                vendor,
                unitOfWork,
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
            
            // Dynamic Flows
            dynamicFlows: {
                source: PROVIDER_VERSIONS.dynamicFlow,
                enabled: enabledFlows.length > 0,
                flows, // All flows, not just enabled
                enabledCount: enabledFlows.length,
                totalCount: flows.length
            },
            
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
