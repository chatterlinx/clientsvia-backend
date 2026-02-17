/**
 * ============================================================================
 * FRONT DESK BEHAVIOR - Admin API Routes
 * ============================================================================
 * 
 * Manage all LLM-0 conversation behavior settings through the UI.
 * Everything is visible and editable - no hidden controls.
 * 
 * ENDPOINTS:
 * - GET    /:companyId           - Get current config
 * - PATCH  /:companyId           - Update config
 * - POST   /:companyId/reset     - Reset to defaults
 * - POST   /:companyId/test      - Test a phrase with current settings
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');
const v2Company = require('../../models/v2Company');
const { authenticateJWT } = require('../../middleware/auth');
const { requirePermission, PERMISSIONS } = require('../../middleware/rbac');
const { DEFAULT_FRONT_DESK_CONFIG } = require('../../config/frontDeskPrompt');
// promptPacks REMOVED Jan 2026 - nuked (static packs = maintenance overhead)
const ConfigAuditService = require('../../services/ConfigAuditService');
const { computeEffectiveConfigVersion } = require('../../utils/effectiveConfigVersion');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
// V93: BlackBoxLogger for CONFIG_WRITE events (AW ⇄ RE marriage)
const BlackBoxLogger = require('../../services/BlackBoxLogger');
// V110++: Import canonical slot/flow defaults
const { 
    DEFAULT_SLOT_REGISTRY, 
    DEFAULT_DISCOVERY_FLOW, 
    DEFAULT_BOOKING_FLOW, 
    DEFAULT_FLOW_POLICIES 
} = require('../../config/onboarding/DefaultFrontDeskPreset');

// ============================================================================
// V115: Auto-seed call_reason_detail into existing company slot registries
// ============================================================================
// Existing companies won't have this slot. We add it on read (not write) so
// the UI dropdown shows it immediately. It gets persisted on next save.
// ============================================================================
function ensureCallReasonSlot(registry) {
    if (!registry || !registry.slots) return registry;
    const hasCallReason = registry.slots.some(s => s.id === 'call_reason_detail');
    if (hasCallReason) return registry;
    
    // Add call_reason_detail to the end of the slot list
    registry.slots.push({
        id: 'call_reason_detail',
        type: 'text',
        label: 'Reason for Call',
        required: false,
        discoveryFillAllowed: true,
        bookingConfirmRequired: false,
        extraction: {
            source: ['triage'],
            confidenceMin: 0.40
        }
    });
    
    logger.info('[FRONT DESK BEHAVIOR] V115: Auto-seeded call_reason_detail into slot registry');
    return registry;
}

// ============================================================================
// V115: Auto-seed call_reason_detail discovery step with proper prompts
// ============================================================================
// If a company has the slot in their registry but the discovery step has
// generic placeholders (or doesn't exist), seed the correct prompts.
// ============================================================================
function ensureCallReasonDiscoveryStep(discoveryFlow) {
    if (!discoveryFlow || !discoveryFlow.steps) return discoveryFlow;
    
    const existingStep = discoveryFlow.steps.find(s => s.slotId === 'call_reason_detail');
    
    if (!existingStep) {
        // V110: call_reason_detail MUST be first so triage/scenario can fire immediately
        // Shift all existing step orders up by 1
        discoveryFlow.steps.forEach(step => {
            step.order = (step.order || 0) + 1;
        });
        
        // Insert call_reason_detail at order: 0 (first position)
        discoveryFlow.steps.unshift({
            stepId: 'd0',
            slotId: 'call_reason_detail',
            order: 0,
            ask: "Got it — {value}.",
            reprompt: "What can I help you with today?",
            confirmMode: 'never'
        });
        logger.info('[FRONT DESK BEHAVIOR] V115: Auto-seeded call_reason_detail discovery step at order: 0 (confirmMode: never)');
    } else {
        // Upgrade any non-'never' confirmMode and stale prompts
        let upgraded = false;
        if (existingStep.order !== 0) {
            existingStep.order = 0;
            upgraded = true;
        }
        if (existingStep.confirmMode !== 'never') {
            existingStep.confirmMode = 'never';
            upgraded = true;
        }
        if (existingStep.ask === 'Is that correct?' || existingStep.ask === "Got it — you're calling about {value}, right?") {
            existingStep.ask = "Got it — {value}.";
            upgraded = true;
        }
        if (existingStep.reprompt === 'Could you confirm?' || existingStep.reprompt === "Tell me what's going on with the system.") {
            existingStep.reprompt = "What can I help you with today?";
            upgraded = true;
        }
        if (upgraded) {
            logger.info('[FRONT DESK BEHAVIOR] V115: Upgraded call_reason_detail step → confirmMode: never, cleaner prompts');
        }
    }

    // Enforce deterministic, unique ordering with call_reason_detail first.
    const reasonStep = discoveryFlow.steps.find(step => step?.slotId === 'call_reason_detail');
    const remainingSteps = discoveryFlow.steps
        .filter(step => step && step !== reasonStep)
        .sort((a, b) => {
            const orderA = Number.isFinite(a?.order) ? a.order : Number.MAX_SAFE_INTEGER;
            const orderB = Number.isFinite(b?.order) ? b.order : Number.MAX_SAFE_INTEGER;
            if (orderA !== orderB) return orderA - orderB;
            return `${a?.stepId || ''}`.localeCompare(`${b?.stepId || ''}`);
        });

    discoveryFlow.steps = [reasonStep, ...remainingSteps].filter(Boolean).map((step, index) => ({
        ...step,
        order: index
    }));
    
    return discoveryFlow;
}

// ============================================================================
// DEFAULT VALUES (Shown in UI, can be customized per company)
// ============================================================================

const UI_DEFAULTS = {
    // 🎯 Conversation Style - How AI approaches booking
    // confident: "Let's get you scheduled" - assumptive, guides caller
    // balanced: "I can help with that" - friendly, universal default
    // polite: "Would you like me to...?" - deferential, respects autonomy
    conversationStyle: 'balanced',
    personality: {
        tone: 'warm',
        verbosity: 'concise',
        maxResponseWords: 30,
        useCallerName: true,
        // V79: Style depth controls (must be visible in UI)
        warmth: 0.6,
        speakingPace: 'normal'
    },
    bookingPrompts: {
        askName: "May I have your name?",
        askPhone: "What's the best phone number to reach you?",
        askAddress: "What's the service address?",
        askTime: "When works best for you - morning or afternoon?",
        confirmTemplate: "So I have {name} at {address}, {time}. Does that sound right?",
        completeTemplate: "You're all set, {name}! A technician will be out {time}. You'll receive a confirmation text shortly.",
        offerAsap: true,
        asapPhrase: "Or I can send someone as soon as possible."
    },
    bookingPromptsMap: {},
    serviceFlow: {
        mode: 'hybrid',
        empathyEnabled: false,
        trades: [],
        promptKeysByTrade: {}
    },
    promptGuards: {
        // V83 FIX: Use colons instead of dots - Mongoose Maps don't allow dots in keys
        missingPromptFallbackKey: 'booking:universal:guardrails:missing_prompt_fallback'
    },
    // promptPacks REMOVED Jan 2026
    bookingInterruption: {
        enabled: true,
        oneSlotPerTurn: true,
        forceReturnToQuestionAsLastLine: true,
        allowEmpathyLanguage: false,
        maxSentences: 2,
        shortClarificationPatterns: ['mark?', 'yes?', 'hello?', 'what?']
    },
    emotionResponses: {
        stressed: {
            enabled: true,
            acknowledgments: [
                "I understand, that sounds stressful.",
                "That must be really uncomfortable.",
                "I can hear this is frustrating."
            ],
            followUp: "Let me help you get this taken care of."
        },
        frustrated: {
            enabled: true,
            acknowledgments: [
                "I completely understand.",
                "I hear you, let's get this sorted.",
                "I get it - let's just get this done."
            ],
            followUp: "I'll get someone scheduled right away.",
            reduceFriction: true
        },
        angry: {
            enabled: true,
            acknowledgments: [
                "I'm really sorry you're dealing with this.",
                "I understand you're upset.",
                "I apologize for the frustration."
            ],
            followUp: "Let me make this right.",
            offerEscalation: true,
            maxTriesBeforeEscalate: 2
        },
        friendly: {
            enabled: true,
            allowSmallTalk: true,
            smallTalkLimit: 1
        }
    },
    frustrationTriggers: [
        "i don't care",
        "just send someone",
        "this is ridiculous",
        "you're not listening",
        "i already told you",
        "stop asking",
        "forget it",
        "whatever"
    ],
    escalation: {
        enabled: true,
        maxLoopsBeforeOffer: 3,
        triggerPhrases: ["manager", "supervisor", "real person", "human"],
        offerMessage: "I can connect you to someone directly or take a message for a manager. Which would you prefer?",
        transferMessage: "Let me connect you to our team now."
    },
    loopPrevention: {
        enabled: true,
        maxSameQuestion: 2,
        onLoop: 'rephrase',
        rephraseIntro: "Let me try this differently - "
    },
    forbiddenPhrases: [
        // Generic robot phrases that kill trust
        "tell me more about what you need",
        "what specific issues are you experiencing",
        "I'm sorry, I didn't understand",
        "let me clarify",
        "I'm here to help. Can you please tell me",
        "I understand. I can help you with that",
        "let me get some details",
        "can you please provide more information",
        "I need more information",
        "what exactly do you need",
        "could you be more specific",
        // Avoid these hedging phrases
        "I think",
        "I'm not sure but",
        "probably",
        "maybe I can",
        // These sound robotic
        "processing your request",
        "one moment please",
        "please hold while I"
    ],
    // Service area responses (admin-editable)
    serviceAreaResponses: {
        confirm: "Yes, we absolutely service {city} and all of Southwest Florida! We've been taking care of customers there for years.",
        ask: "We service most of Southwest Florida. What city or area are you located in?",
        decline: "I'm sorry, we don't currently service that area."
    },
    // Inquiry responses for common questions
    inquiryResponses: {
        ductCleaning: "Absolutely! Duct cleaning is one of our specialties. It helps improve air quality and system efficiency.",
        thermostatUpgrade: "Great choice! A new thermostat can save you money and make your home more comfortable. We install all major brands.",
        generalService: "We'd be happy to help! Let me get you scheduled with one of our technicians.",
        pricingInfo: "I'd be happy to get you a quote. Our pricing depends on the specific work needed - let me get your information and have someone reach out with details."
    },
    // 👤 V84: Name lists are GLOBAL (AdminSettings) — these defaults are placeholders.
    // The GET route overrides them from AdminSettings. Never saved per-company.
    commonFirstNames: [],
    commonLastNames: [],
    nameStopWords: [],
    // 🎯 Booking Outcome - What AI says when all slots collected
    // Default: "Confirmed on Call" - no callbacks unless explicitly enabled
    bookingOutcome: {
        mode: 'confirmed_on_call',
        useAsapVariant: true,
        finalScripts: {},
        asapVariantScript: null,
        customFinalScript: null
    },

    // 🏷️ Vendor / Supplier Handling (Call Center directory)
    vendorHandling: {
        vendorFirstEnabled: false,
        enabled: false,
        mode: 'collect_message',
        allowLinkToCustomer: false,
        prompts: {
            // DEFAULT - OVERRIDE IN UI
            greeting: "Thanks for calling. How can we help?",
            askSummary: "What can I help you with today?",
            askOrderNumber: "Do you have an order number or invoice number I should note?",
            askCustomerName: "Which customer is this regarding?",
            completion: "Got it. I’ll make sure the team gets this message right away.",
            transferMessage: "Thank you. Let me connect you to our team."
        }
    },

    // 📦 Unit of Work (UoW) - Universal multi-location / multi-job container
    unitOfWork: {
        enabled: false,
        allowMultiplePerCall: false,
        maxUnitsPerCall: 3,
        labelSingular: 'Job',
        labelPlural: 'Jobs',
        perUnitSlotIds: ['address'],
        confirmation: {
            // DEFAULT - OVERRIDE IN UI
            askAddAnotherPrompt: "Is this for just this location, or do you have another location to add today?",
            clarifyPrompt: "Just to confirm — do you have another location or job to add today?",
            nextUnitIntro: "Okay — let’s get the details for the next one.",
            finalScriptMulti: "Perfect — I’ve got both locations. Our team will take it from here.",
            yesWords: ['yes', 'yeah', 'yep', 'sure', 'okay', 'ok', 'correct', 'another', 'one more'],
            noWords: ['no', 'nope', 'nah', 'just this', 'only this', 'that’s it', "that's it", 'all set']
        }
    },

    // 🌙 After-hours message contract (deterministic message-taking)
    afterHoursMessageContract: {
        mode: 'inherit_booking_minimum',
        requiredFieldKeys: ['name', 'phone', 'address', 'problemSummary', 'preferredTime'],
        extraSlotIds: []
    }
};

// ============================================================================
// PROMPT KEY SANITIZATION (Map-safe; dots → colons, legacy → new)
// ============================================================================
const PROMPT_KEY_DOT_REGEX = /\./g;
const BLOCKED_PROMPT_MAP_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function normalizePromptKey(rawKey, legacyKeyMap) {
    if (rawKey === null || rawKey === undefined) return rawKey;
    const key = String(rawKey).trim();
    if (!key) return key;
    if (legacyKeyMap[key]) return legacyKeyMap[key];
    if (key.includes('.')) return key.replace(PROMPT_KEY_DOT_REGEX, ':');
    return key;
}

function readMapEntries(value) {
    if (!value) return [];
    if (typeof value.entries === 'function') {
        return Array.from(value.entries());
    }
    return Object.entries(value);
}

function sanitizeBookingPromptsMap(input, { legacyKeyMap, companyId }) {
    if (!input || typeof input !== 'object') {
        return { value: input, conversions: [], conflicts: [] };
    }

    const entries = readMapEntries(input);
    const canonicalEntries = [];
    const legacyEntries = [];

    for (const [key, value] of entries) {
        const normalizedKey = normalizePromptKey(key, legacyKeyMap);
        const needsConversion = normalizedKey !== String(key || '').trim();
        if (needsConversion) {
            legacyEntries.push([key, value, normalizedKey]);
        } else {
            canonicalEntries.push([key, value, normalizedKey]);
        }
    }

    const sanitized = {};
    const conversions = [];
    const conflicts = [];

    const applyEntry = (key, value, normalizedKey, isLegacy) => {
        if (!normalizedKey) return;
        if (BLOCKED_PROMPT_MAP_KEYS.has(normalizedKey)) {
            logger.warn('[FRONT DESK BEHAVIOR] ⚠️ Skipped unsafe bookingPromptsMap key', {
                companyId,
                key: normalizedKey
            });
            return;
        }
        if (Object.prototype.hasOwnProperty.call(sanitized, normalizedKey)) {
            if (sanitized[normalizedKey] !== value) {
                conflicts.push({ normalizedKey, existingKey: normalizedKey, incomingKey: key });
            }
            return;
        }
        sanitized[normalizedKey] = value;
        if (normalizedKey !== key) {
            conversions.push({ from: key, to: normalizedKey, legacy: isLegacy });
        }
    };

    canonicalEntries.forEach(([key, value, normalizedKey]) => applyEntry(key, value, normalizedKey, false));
    legacyEntries.forEach(([key, value, normalizedKey]) => applyEntry(key, value, normalizedKey, true));

    if (conversions.length > 0) {
        logger.warn('[FRONT DESK BEHAVIOR] ⚠️ Normalized bookingPromptsMap keys', {
            companyId,
            conversionsCount: conversions.length,
            sample: conversions.slice(0, 5)
        });
    }

    if (conflicts.length > 0) {
        logger.warn('[FRONT DESK BEHAVIOR] ⚠️ bookingPromptsMap key conflicts detected', {
            companyId,
            conflictsCount: conflicts.length,
            sample: conflicts.slice(0, 5)
        });
    }

    return { value: sanitized, conversions, conflicts };
}

function sanitizePromptGuards(input, { legacyKeyMap, companyId }) {
    if (!input || typeof input !== 'object') {
        return { value: input, changed: false };
    }
    if (input.missingPromptFallbackKey === undefined) {
        return { value: input, changed: false };
    }
    const normalizedKey = normalizePromptKey(input.missingPromptFallbackKey, legacyKeyMap);
    if (normalizedKey !== input.missingPromptFallbackKey) {
        logger.warn('[FRONT DESK BEHAVIOR] ⚠️ Normalized promptGuards.missingPromptFallbackKey', {
            companyId,
            from: input.missingPromptFallbackKey,
            to: normalizedKey
        });
        return {
            value: { ...input, missingPromptFallbackKey: normalizedKey },
            changed: true
        };
    }
    return { value: input, changed: false };
}

function sanitizeServiceFlow(input, { legacyKeyMap, companyId }) {
    if (!input || typeof input !== 'object') {
        return { value: input, conversions: [] };
    }
    const promptKeysByTrade = input.promptKeysByTrade;
    if (!promptKeysByTrade || typeof promptKeysByTrade !== 'object') {
        return { value: input, conversions: [] };
    }

    const entries = readMapEntries(promptKeysByTrade);
    const sanitizedPromptKeysByTrade = {};
    const conversions = [];

    for (const [tradeKey, keys] of entries) {
        if (!keys || typeof keys !== 'object') {
            sanitizedPromptKeysByTrade[tradeKey] = keys;
            continue;
        }
        const sanitizedKeys = { ...keys };
        for (const [field, value] of Object.entries(keys)) {
            if (typeof value !== 'string') continue;
            const normalizedKey = normalizePromptKey(value, legacyKeyMap);
            if (normalizedKey !== value) {
                conversions.push({ tradeKey, field, from: value, to: normalizedKey });
                sanitizedKeys[field] = normalizedKey;
            }
        }
        sanitizedPromptKeysByTrade[tradeKey] = sanitizedKeys;
    }

    if (conversions.length > 0) {
        logger.warn('[FRONT DESK BEHAVIOR] ⚠️ Normalized serviceFlow.promptKeysByTrade prompt keys', {
            companyId,
            conversionsCount: conversions.length,
            sample: conversions.slice(0, 5)
        });
    }

    return {
        value: { ...input, promptKeysByTrade: sanitizedPromptKeysByTrade },
        conversions
    };
}

// ============================================================================
// GET - Fetch current config
// ============================================================================
router.get('/:companyId', authenticateJWT, requirePermission(PERMISSIONS.CONFIG_READ), async (req, res) => {
    try {
        const { companyId } = req.params;
        
        const company = await v2Company.findById(companyId).lean();
        if (!company) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }
        
        // Merge saved config with defaults
        const saved = company.aiAgentSettings?.frontDeskBehavior || {};
        
        // V109: Read businessHours from CANONICAL location first, fall back to legacy
        // CANONICAL: aiAgentSettings.frontDeskBehavior.businessHours
        // LEGACY: aiAgentSettings.businessHours (will be migrated on next save)
        const businessHours = saved.businessHours || company.aiAgentSettings?.businessHours || null;
        
        const config = deepMerge(UI_DEFAULTS, saved);
        
        // ════════════════════════════════════════════════════════════════════════════
        // ════════════════════════════════════════════════════════════════════════════
        // GLOBAL SETTINGS — Single source of truth in AdminSettings
        // ════════════════════════════════════════════════════════════════════════════
        // V84: commonFirstNames, commonLastNames, nameStopWords are GLOBAL.
        // V84.3: globalProductionIntelligence thresholds are GLOBAL.
        // They live ONLY in AdminSettings. Per-company copies do NOT exist.
        // Every companyId reads from the same global list — no duplication.
        // New companies never get seeded with names; they just use global.
        // ════════════════════════════════════════════════════════════════════════════
        let adminSettings = null; // Shared reference for name lists + intelligence
        try {
            const AdminSettings = require('../../models/AdminSettings');
            adminSettings = await AdminSettings.findOne().lean();
            
            // AdminSettings is the ONLY source — no fallback to per-company
            config.commonFirstNames = adminSettings?.commonFirstNames || [];
            config.commonLastNames = adminSettings?.commonLastNames || [];
            config.nameStopWords = adminSettings?.nameStopWords || [];
            
            logger.info('[FRONT DESK BEHAVIOR] 👤 V84: Loaded GLOBAL name lists from AdminSettings', {
                companyId,
                firstNamesCount: config.commonFirstNames.length,
                lastNamesCount: config.commonLastNames.length,
                stopWordsCount: config.nameStopWords.length
            });
        } catch (err) {
            logger.error('[FRONT DESK BEHAVIOR] ❌ Failed to load AdminSettings global name lists', {
                companyId,
                error: err.message
            });
            // On error: empty arrays — never fall back to per-company data
            config.commonFirstNames = [];
            config.commonLastNames = [];
            config.nameStopWords = [];
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // AUTO-SEED — One-time population of empty AdminSettings from seed files
        // ════════════════════════════════════════════════════════════════════════════
        // Both name lists come from US Government public domain data:
        //   - commonFirstNames: SSA Baby Names (data/seeds/ssaFirstNames.js) — 10,000 names
        //   - commonLastNames:  US Census surnames (data/seeds/censusLastNames.js) — 50,000 names
        // This runs ONCE. After names exist in AdminSettings, this block is skipped.
        // No per-company fallbacks — AdminSettings is the single source of truth.
        // ════════════════════════════════════════════════════════════════════════════
        {
            const seedData = {};
            
            // Auto-seed first names from SSA if empty
            if (!config.commonFirstNames || config.commonFirstNames.length === 0) {
                try {
                    const ssaFirstNames = require('../../data/seeds/ssaFirstNames');
                    seedData.commonFirstNames = ssaFirstNames;
                    config.commonFirstNames = ssaFirstNames;
                    logger.info('[FRONT DESK BEHAVIOR] 🔄 AUTO-SEED: commonFirstNames from SSA (10K names)', { count: ssaFirstNames.length });
                } catch (e) {
                    logger.warn('[FRONT DESK BEHAVIOR] ⚠️ SSA first names seed not found', { error: e.message });
                }
            }
            
            // Auto-seed last names from Census if empty
            if (!config.commonLastNames || config.commonLastNames.length === 0) {
                try {
                    const censusLastNames = require('../../data/seeds/censusLastNames');
                    seedData.commonLastNames = censusLastNames;
                    config.commonLastNames = censusLastNames;
                    logger.info('[FRONT DESK BEHAVIOR] 🔄 AUTO-SEED: commonLastNames from Census (50K names)', { count: censusLastNames.length });
                } catch (e) {
                    logger.warn('[FRONT DESK BEHAVIOR] ⚠️ Census last names seed not found', { error: e.message });
                }
            }
            
            // Persist seed data to AdminSettings (one-time write)
            if (Object.keys(seedData).length > 0) {
                try {
                    const AdminSettingsForSeed = require('../../models/AdminSettings');
                    await AdminSettingsForSeed.updateOne(
                        {},
                        { $set: { ...seedData, lastUpdated: new Date() } },
                        { upsert: true }
                    );
                    logger.info('[FRONT DESK BEHAVIOR] ✅ AUTO-SEED: Persisted to AdminSettings', {
                        fields: Object.keys(seedData),
                        counts: Object.fromEntries(Object.entries(seedData).map(([k, v]) => [k, v.length]))
                    });
                } catch (seedErr) {
                    logger.error('[FRONT DESK BEHAVIOR] ❌ AUTO-SEED: Failed to persist', { error: seedErr.message });
                }
            }
        }
        
        
        // V110: Log slot registry and flows
        logger.info('[FRONT DESK BEHAVIOR] GET - V110 Status:', {
            companyId,
            hasSlotRegistry: !!config.slotRegistry,
            slotRegistryVersion: config.slotRegistry?.version || null,
            slotCount: config.slotRegistry?.slots?.length || 0,
            hasDiscoveryFlow: !!config.discoveryFlow,
            discoveryEnabled: config.discoveryFlow?.enabled,
            discoverySteps: config.discoveryFlow?.steps?.length || 0,
            hasBookingFlow: !!config.bookingFlow,
            bookingEnabled: config.bookingFlow?.enabled,
            bookingSteps: config.bookingFlow?.steps?.length || 0,
            hasPolicies: !!config.policies
        });
        
        if (config.bookingSlots) {
            logger.info('[FRONT DESK BEHAVIOR] GET - Returning bookingSlots (LEGACY):', {
                companyId,
                slotCount: config.bookingSlots.length,
                slots: config.bookingSlots.map(s => ({
                    id: s.id,
                    type: s.type,
                    askFullName: s.askFullName,
                    useFirstNameOnly: s.useFirstNameOnly,
                    askMissingNamePart: s.askMissingNamePart
                }))
            });
        } else {
            logger.info('[FRONT DESK BEHAVIOR] GET - No bookingSlots saved', { companyId });
        }
        
        // Ensure enabled defaults to true
        if (config.enabled === undefined) {
            config.enabled = true;
        }
        
        res.json({
            success: true,
            meta: {
                // promptPackRegistry REMOVED Jan 2026
            },
            data: {
                enabled: config.enabled,
                // 🎯 Conversation Style - confident/balanced/polite
                conversationStyle: config.conversationStyle || 'balanced',
                // 💬 Style Acknowledgments - custom phrases per style
                styleAcknowledgments: config.styleAcknowledgments || null,
                personality: config.personality,
                
                // ═══════════════════════════════════════════════════════════════
                // V110: SLOT REGISTRY + DISCOVERY/BOOKING FLOWS (CANONICAL)
                // ═══════════════════════════════════════════════════════════════
                // These are the NEW canonical structures - UI reads/writes these.
                // Runtime reads from these first, falls back to bookingSlots only if empty.
                // V115: Auto-seed call_reason_detail into existing registries + discovery flow
                slotRegistry: ensureCallReasonSlot(config.slotRegistry),
                discoveryFlow: ensureCallReasonDiscoveryStep(config.discoveryFlow || null),
                bookingFlow: config.bookingFlow || null,
                policies: config.policies || null,
                
                // Conversation Style: Openers (Layer 0 micro-acks)
                openers: config.openers || null,
                
                // V110 Response Templates (Layer 0.5 — discovery-before-discovery LLM rules)
                discoveryResponseTemplates: config.discoveryResponseTemplates || null,
                
                // V115: Triage config — single source of truth
                triage: config.triage || {
                    enabled: false,
                    minConfidence: 0.62,
                    autoOnProblem: true,
                    perService: {},
                    engine: 'v110'
                },
                
                // V110: Booking slots come from slotRegistry + bookingFlow (legacy bookingSlots removed)
                // 🏷️ Vendor / Supplier Handling (Call Center directory)
                vendorHandling: config.vendorHandling || null,
                // 📦 Unit of Work (UoW)
                unitOfWork: config.unitOfWork || null,
                // 🌙 After-hours message contract (deterministic)
                afterHoursMessageContract: config.afterHoursMessageContract || null,
                bookingTemplates: config.bookingTemplates || null,
                serviceFlow: config.serviceFlow,
                promptGuards: config.promptGuards,
                // promptPacks REMOVED Jan 2026
                emotionResponses: config.emotionResponses,
                frustrationTriggers: config.frustrationTriggers,
                escalation: config.escalation,
                loopPrevention: config.loopPrevention,
                forbiddenPhrases: config.forbiddenPhrases,
                // New UI-controlled fields
                detectionTriggers: config.detectionTriggers || null,
                fallbackResponses: config.fallbackResponses || null,
                modeSwitching: config.modeSwitching || null,
                serviceAreaResponses: config.serviceAreaResponses || null,
                inquiryResponses: config.inquiryResponses || null,
                // V22: Discovery & Consent Gate
                discoveryConsent: config.discoveryConsent || null,
                // V22: Vocabulary Guardrails (AI output)
                vocabularyGuardrails: config.vocabularyGuardrails || null,
                // 🔤 V26: Caller Vocabulary (Industry slang translation - caller input)
                callerVocabulary: config.callerVocabulary || null,
                // 🚀 V25: Fast-Path Booking - Respect caller urgency
                fastPathBooking: config.fastPathBooking || null,
                // 👤 V84: Name lists — GLOBAL from AdminSettings (single source of truth)
                commonFirstNames: config.commonFirstNames || [],
                commonLastNames: config.commonLastNames || [],
                nameStopWords: config.nameStopWords || [],
                // ✏️ V30: Name Spelling Variants - "Mark with K or C?"
                nameSpellingVariants: config.nameSpellingVariants || null,
                // 🎯 Booking Outcome - What AI says when all slots collected
                bookingOutcome: config.bookingOutcome || {
                    mode: 'confirmed_on_call',
                    useAsapVariant: true,
                    finalScripts: {},
                    asapVariantScript: null,
                    customFinalScript: null
                },
                // 👋 V32: Conversation Stages (includes greetingRules)
                conversationStages: config.conversationStages || null,
                // 🔇 V36: Filler Words (company-specific custom fillers)
                fillerWords: company.aiAgentSettings?.fillerWords || { inherited: [], custom: [] },
                fillerWordsEnabled: config.fillerWordsEnabled !== false, // Default to true
                // ☢️ V84: Legacy V36 per-company name stop words removed — now global only
                // 🕒 Canonical business hours (used by after_hours trigger + AfterHours handler)
                businessHours,
                // 📋 Architecture Notes - System documentation (editable in V110 tab)
                architectureNotes: config.architectureNotes || null,
                architectureNotesUpdated: config.architectureNotesUpdated || null,
                // 🧠 V111: Conversation Memory Config - Runtime truth configuration
                conversationMemory: config.conversationMemory || null,
                // 📡 V111: Connection Quality Gate - Bad connection / low confidence
                connectionQualityGate: config.connectionQualityGate || null,
                // 🛡️ V111: STT Protected Words - Company-specific words never stripped by STT
                sttProtectedWords: config.sttProtectedWords || [],
                lastUpdated: saved.lastUpdated || null,
                
                // ═══════════════════════════════════════════════════════════════
                // V84.3: 3-TIER INTELLIGENCE SETTINGS
                // ═══════════════════════════════════════════════════════════════
                // useGlobalIntelligence (per-company flag) + threshold configs:
                //   - globalProductionIntelligence: from AdminSettings (shared)
                //   - productionIntelligence: from company (per-company override)
                // Frontend reads the correct one based on the toggle.
                // ═══════════════════════════════════════════════════════════════
                useGlobalIntelligence: company.aiAgentSettings?.useGlobalIntelligence !== false,
                productionIntelligence: company.aiAgentSettings?.productionIntelligence || {},
                globalProductionIntelligence: adminSettings?.globalProductionIntelligence || {}
            }
        });
        
    } catch (error) {
        logger.error('[FRONT DESK BEHAVIOR] Get error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================================
// PATCH - Update config
// ============================================================================
router.patch('/:companyId', authenticateJWT, requirePermission(PERMISSIONS.CONFIG_WRITE), async (req, res) => {
    try {
        const { companyId } = req.params;
        const updates = req.body;
        // promptPacks migration map REMOVED Jan 2026 - just use empty object
        // normalizePromptKey will still convert dots to colons without the map
        const legacyPromptKeyMap = {};
        
        logger.info('[FRONT DESK BEHAVIOR] Updating config', {
            companyId,
            fieldsUpdated: Object.keys(updates)
        });
        


        // Guard against legacy/dotted prompt keys before Map casting
        if (updates.bookingPromptsMap) {
            const sanitized = sanitizeBookingPromptsMap(updates.bookingPromptsMap, {
                legacyKeyMap: legacyPromptKeyMap,
                companyId
            });
            updates.bookingPromptsMap = sanitized.value;
        }

        if (updates.promptGuards) {
            const sanitized = sanitizePromptGuards(updates.promptGuards, {
                legacyKeyMap: legacyPromptKeyMap,
                companyId
            });
            updates.promptGuards = sanitized.value;
        }

        if (updates.serviceFlow) {
            const sanitized = sanitizeServiceFlow(updates.serviceFlow, {
                legacyKeyMap: legacyPromptKeyMap,
                companyId
            });
            updates.serviceFlow = sanitized.value;
        }
        
        // Immutable config audit: BEFORE snapshot (company-scoped)
        const beforeCompany = await v2Company.findById(companyId)
            .select('aiAgentSettings.frontDeskBehavior aiAgentSettings.templateReferences aiAgentSettings.scenarioControls agentSettings')
            .lean();

        // Build the update object
        const updateObj = {};
        
        if (updates.enabled !== undefined) {
            updateObj['aiAgentSettings.frontDeskBehavior.enabled'] = updates.enabled;
        }
        
        if (updates.personality) {
            Object.entries(updates.personality).forEach(([key, value]) => {
                updateObj[`aiAgentSettings.frontDeskBehavior.personality.${key}`] = value;
            });
        }
        
        // V110: Legacy bookingPrompts write REMOVED — prompts come from bookingFlow.steps only.

        if (updates.bookingPromptsMap) {
            updateObj['aiAgentSettings.frontDeskBehavior.bookingPromptsMap'] = updates.bookingPromptsMap;
        }

        if (updates.serviceFlow) {
            updateObj['aiAgentSettings.frontDeskBehavior.serviceFlow'] = updates.serviceFlow;
        }

        if (updates.promptGuards) {
            updateObj['aiAgentSettings.frontDeskBehavior.promptGuards'] = updates.promptGuards;
        }

        // promptPacks update REMOVED Jan 2026
        
        if (updates.emotionResponses) {
            Object.entries(updates.emotionResponses).forEach(([emotion, settings]) => {
                Object.entries(settings).forEach(([key, value]) => {
                    updateObj[`aiAgentSettings.frontDeskBehavior.emotionResponses.${emotion}.${key}`] = value;
                });
            });
        }
        
        if (updates.frustrationTriggers) {
            updateObj['aiAgentSettings.frontDeskBehavior.frustrationTriggers'] = updates.frustrationTriggers;
        }
        
        // 🎯 CONVERSATION STYLE - How AI approaches booking (confident/balanced/polite)
        if (updates.conversationStyle) {
            updateObj['aiAgentSettings.frontDeskBehavior.conversationStyle'] = updates.conversationStyle;
            logger.info('[FRONT DESK BEHAVIOR] 🎯 Saving conversationStyle:', updates.conversationStyle);
        }
        
        // 💬 STYLE ACKNOWLEDGMENTS - Custom phrases for each conversation style
        if (updates.styleAcknowledgments) {
            updateObj['aiAgentSettings.frontDeskBehavior.styleAcknowledgments'] = updates.styleAcknowledgments;
            logger.info('[FRONT DESK BEHAVIOR] 💬 Saving styleAcknowledgments:', updates.styleAcknowledgments);
        }
        
        if (updates.escalation) {
            Object.entries(updates.escalation).forEach(([key, value]) => {
                updateObj[`aiAgentSettings.frontDeskBehavior.escalation.${key}`] = value;
            });
        }
        
        if (updates.loopPrevention) {
            Object.entries(updates.loopPrevention).forEach(([key, value]) => {
                updateObj[`aiAgentSettings.frontDeskBehavior.loopPrevention.${key}`] = value;
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════════════
        // V100: ENFORCEMENT SETTINGS - Control Plane strict mode toggle
        // ═══════════════════════════════════════════════════════════════════════════
        // This is the "kill switch" that enables Platform Law enforcement
        // - strictControlPlaneOnly: true = FrontDeskRuntime handles all turns
        // - level: "warn" = log violations, "strict" = block + fail closed
        // ═══════════════════════════════════════════════════════════════════════════
        if (updates.enforcement) {
            if (updates.enforcement.strictControlPlaneOnly !== undefined) {
                updateObj['aiAgentSettings.frontDesk.enforcement.strictControlPlaneOnly'] = updates.enforcement.strictControlPlaneOnly === true;
                logger.info('[FRONT DESK BEHAVIOR] V100: Setting strictControlPlaneOnly', {
                    companyId,
                    strictControlPlaneOnly: updates.enforcement.strictControlPlaneOnly === true
                });
            }
            if (updates.enforcement.level !== undefined) {
                const validLevels = ['warn', 'strict'];
                const level = validLevels.includes(updates.enforcement.level) ? updates.enforcement.level : 'warn';
                updateObj['aiAgentSettings.frontDesk.enforcement.level'] = level;
                logger.info('[FRONT DESK BEHAVIOR] V100: Setting enforcement level', {
                    companyId,
                    level
                });
            }
        }
        
        if (updates.forbiddenPhrases) {
            updateObj['aiAgentSettings.frontDeskBehavior.forbiddenPhrases'] = updates.forbiddenPhrases;
        }
        
        // ═══════════════════════════════════════════════════════════════════════════
        // V111: CONNECTION QUALITY GATE - Bad connection / low confidence handling
        // ═══════════════════════════════════════════════════════════════════════════
        if (updates.connectionQualityGate !== undefined) {
            updateObj['aiAgentSettings.frontDeskBehavior.connectionQualityGate'] = updates.connectionQualityGate;
            logger.info('[FRONT DESK BEHAVIOR] V111: Saving connectionQualityGate', {
                companyId,
                enabled: updates.connectionQualityGate?.enabled,
                confidenceThreshold: updates.connectionQualityGate?.confidenceThreshold,
                maxRetries: updates.connectionQualityGate?.maxRetries,
                troublePhrasesCount: (updates.connectionQualityGate?.troublePhrases || []).length
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════════════
        // V111: STT PROTECTED WORDS - Company-specific words never stripped by STT
        // ═══════════════════════════════════════════════════════════════════════════
        if (updates.sttProtectedWords !== undefined) {
            updateObj['aiAgentSettings.frontDeskBehavior.sttProtectedWords'] = updates.sttProtectedWords;
            logger.info('[FRONT DESK BEHAVIOR] V111: Saving sttProtectedWords', {
                companyId,
                count: (updates.sttProtectedWords || []).length,
                sample: (updates.sttProtectedWords || []).slice(0, 5)
            });
        }
        
        // V110: Legacy bookingSlots write REMOVED — runtime reads from slotRegistry + bookingFlow only.
        // If the admin UI still sends bookingSlots, log a warning but do NOT write to DB.
        if (updates.bookingSlots) {
            logger.warn('[FRONT DESK BEHAVIOR] Legacy bookingSlots save BLOCKED — use V110 slotRegistry + bookingFlow', {
                companyId,
                attemptedSlotCount: updates.bookingSlots?.length || 0
            });
        }

        // 🏷️ Vendor / Supplier Handling (Call Center directory)
        if (updates.vendorHandling && typeof updates.vendorHandling === 'object') {
            updateObj['aiAgentSettings.frontDeskBehavior.vendorHandling'] = updates.vendorHandling;
        }

        // 📦 Unit of Work (UoW)
        if (updates.unitOfWork && typeof updates.unitOfWork === 'object') {
            updateObj['aiAgentSettings.frontDeskBehavior.unitOfWork'] = updates.unitOfWork;
        }

        // 🌙 After-hours message contract (deterministic)
        if (updates.afterHoursMessageContract && typeof updates.afterHoursMessageContract === 'object') {
            updateObj['aiAgentSettings.frontDeskBehavior.afterHoursMessageContract'] = updates.afterHoursMessageContract;
        }

        // ═══════════════════════════════════════════════════════════════════════
        // 🕒 V109: Canonical business hours migration
        // ═══════════════════════════════════════════════════════════════════════
        // OLD LOCATION: aiAgentSettings.businessHours (LEGACY - DO NOT USE)
        // NEW LOCATION: aiAgentSettings.frontDeskBehavior.businessHours (CANONICAL)
        // 
        // This ensures Hours tab writes to the SAME namespace as all other 
        // Front Desk settings, so Control Plane can govern it properly.
        // ═══════════════════════════════════════════════════════════════════════
        if (updates.businessHours !== undefined) {
            if (updates.businessHours === null) {
                // Clear both locations for clean migration
                updateObj['aiAgentSettings.frontDeskBehavior.businessHours'] = null;
                updateObj['aiAgentSettings.businessHours'] = null; // Clear legacy
            } else if (updates.businessHours && typeof updates.businessHours === 'object') {
                // Write to CANONICAL location only
                updateObj['aiAgentSettings.frontDeskBehavior.businessHours'] = updates.businessHours;
                // Also clear legacy location if it exists (migration)
                updateObj['aiAgentSettings.businessHours'] = null;
            } else {
                return res.status(400).json({
                    success: false,
                    error: 'businessHours must be an object or null'
                });
            }
        }

        // ☢️ NUKED: bookingContractV2Enabled, slotLibrary, slotGroups save logic - Jan 2026
        
        // ═══════════════════════════════════════════════════════════════════════
        // V110: SLOT REGISTRY + BOOKING FLOW + DISCOVERY FLOW (CANONICAL)
        // ═══════════════════════════════════════════════════════════════════════
        // These are the NEW canonical structures that replace legacy bookingSlots.
        // Runtime reads from these first, falls back to bookingSlots only if empty.
        // ═══════════════════════════════════════════════════════════════════════
        if (updates.slotRegistry && typeof updates.slotRegistry === 'object') {
            updateObj['aiAgentSettings.frontDeskBehavior.slotRegistry'] = updates.slotRegistry;
            logger.info('[FRONT DESK BEHAVIOR] V110: Saving slotRegistry', {
                companyId,
                version: updates.slotRegistry.version,
                slotCount: updates.slotRegistry.slots?.length || 0,
                slotIds: (updates.slotRegistry.slots || []).map(s => s.id)
            });
        }
        
        if (updates.discoveryFlow && typeof updates.discoveryFlow === 'object') {
            updateObj['aiAgentSettings.frontDeskBehavior.discoveryFlow'] = updates.discoveryFlow;
            logger.info('[FRONT DESK BEHAVIOR] V110: Saving discoveryFlow', {
                companyId,
                version: updates.discoveryFlow.version,
                enabled: updates.discoveryFlow.enabled,
                stepCount: updates.discoveryFlow.steps?.length || 0
            });
        }
        
        if (updates.bookingFlow && typeof updates.bookingFlow === 'object') {
            updateObj['aiAgentSettings.frontDeskBehavior.bookingFlow'] = updates.bookingFlow;
            logger.info('[FRONT DESK BEHAVIOR] V110: Saving bookingFlow', {
                companyId,
                version: updates.bookingFlow.version,
                enabled: updates.bookingFlow.enabled,
                confirmCapturedFirst: updates.bookingFlow.confirmCapturedFirst,
                stepCount: updates.bookingFlow.steps?.length || 0,
                stepSlotIds: (updates.bookingFlow.steps || []).map(s => s.slotId)
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // CONVERSATION STYLE: OPENERS — Pre-prompt micro-acknowledgments
        // ═══════════════════════════════════════════════════════════════════════
        if (updates.openers && typeof updates.openers === 'object') {
            updateObj['aiAgentSettings.frontDeskBehavior.openers'] = updates.openers;
            logger.info('[FRONT DESK BEHAVIOR] Saving openers config', {
                companyId,
                enabled: updates.openers.enabled,
                mode: updates.openers.mode,
                generalCount: updates.openers.general?.length || 0,
                frustrationCount: updates.openers.frustration?.length || 0,
                urgencyCount: updates.openers.urgency?.length || 0
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // V110 RESPONSE TEMPLATES — Discovery-before-discovery LLM rules
        // ═══════════════════════════════════════════════════════════════════════
        if (updates.discoveryResponseTemplates && typeof updates.discoveryResponseTemplates === 'object') {
            updateObj['aiAgentSettings.frontDeskBehavior.discoveryResponseTemplates'] = updates.discoveryResponseTemplates;
            logger.info('[FRONT DESK BEHAVIOR] Saving discoveryResponseTemplates', {
                companyId,
                preAcceptance: !!updates.discoveryResponseTemplates.preAcceptance,
                postAcceptance: !!updates.discoveryResponseTemplates.postAcceptance,
                allCaptured: !!updates.discoveryResponseTemplates.allCaptured
            });
        }

        // ═══════════════════════════════════════════════════════════════════════
        // V115: TRIAGE CONFIG — The ONLY triage gate
        // ═══════════════════════════════════════════════════════════════════════
        // Saves to frontDeskBehavior.triage (single source of truth)
        // UI: Control Plane → Front Desk → V110 → Triage section
        // ═══════════════════════════════════════════════════════════════════════
        if (updates.triage && typeof updates.triage === 'object') {
            const t = updates.triage;
            if (t.enabled !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.triage.enabled'] = t.enabled === true;
            }
            if (t.minConfidence !== undefined) {
                const conf = Math.max(0, Math.min(1, Number(t.minConfidence) || 0.62));
                updateObj['aiAgentSettings.frontDeskBehavior.triage.minConfidence'] = conf;
            }
            if (t.autoOnProblem !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.triage.autoOnProblem'] = t.autoOnProblem === true;
            }
            if (t.perService !== undefined && typeof t.perService === 'object') {
                updateObj['aiAgentSettings.frontDeskBehavior.triage.perService'] = t.perService;
            }
            if (t.engine !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.triage.engine'] = 'v110'; // Only v110 allowed
            }
            
            logger.info('[FRONT DESK BEHAVIOR] V115: Saving triage config', {
                companyId,
                enabled: t.enabled,
                minConfidence: t.minConfidence,
                autoOnProblem: t.autoOnProblem,
                engine: 'v110'
            });
            
            // Log triage config change to BlackBox for audit
            BlackBoxLogger.logEvent({
                callId: 'CONFIG_CHANGE',
                companyId,
                type: 'TRIAGE_CONFIG_UPDATED',
                data: {
                    changes: Object.keys(t),
                    newValues: t,
                    updatedBy: req.user?.email || 'admin'
                }
            }).catch(() => {});
        }
        
        if (updates.policies && typeof updates.policies === 'object') {
            updateObj['aiAgentSettings.frontDeskBehavior.policies'] = updates.policies;
            logger.info('[FRONT DESK BEHAVIOR] V110: Saving policies', { companyId });
        }
        
        // Architecture Notes - System documentation (editable from V110 Discovery tab)
        if (updates.architectureNotes !== undefined) {
            updateObj['aiAgentSettings.frontDeskBehavior.architectureNotes'] = updates.architectureNotes;
            updateObj['aiAgentSettings.frontDeskBehavior.architectureNotesUpdated'] = new Date();
            logger.info('[FRONT DESK BEHAVIOR] Saving architectureNotes', { 
                companyId,
                noteLength: (updates.architectureNotes || '').length
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // V111: CONVERSATION MEMORY CONFIG - Runtime truth configuration
        // ═══════════════════════════════════════════════════════════════════════
        // Configures capture goals, handler governance, and context window policies.
        // Spec: docs/architecture/V111-ConversationMemory-Spec.md
        // ═══════════════════════════════════════════════════════════════════════
        if (updates.conversationMemory && typeof updates.conversationMemory === 'object') {
            updateObj['aiAgentSettings.frontDeskBehavior.conversationMemory'] = updates.conversationMemory;
            logger.info('[FRONT DESK BEHAVIOR] V111: Saving conversationMemory config', {
                companyId,
                version: updates.conversationMemory.version || 'v111',
                enabled: updates.conversationMemory.enabled,
                mustCapture: updates.conversationMemory.captureGoals?.must?.fields || [],
                shouldCapture: updates.conversationMemory.captureGoals?.should?.fields || [],
                maxTurns: updates.conversationMemory.contextWindow?.maxTurns,
                logTurnRecords: updates.conversationMemory.blackbox?.logTurnRecords
            });
        }
        
        // Save booking templates
        if (updates.bookingTemplates) {
            Object.entries(updates.bookingTemplates).forEach(([key, value]) => {
                updateObj[`aiAgentSettings.frontDeskBehavior.bookingTemplates.${key}`] = value;
            });
        }
        
        // Save detection triggers
        if (updates.detectionTriggers) {
            Object.entries(updates.detectionTriggers).forEach(([key, value]) => {
                updateObj[`aiAgentSettings.frontDeskBehavior.detectionTriggers.${key}`] = value;
            });
        }
        
        // Save fallback responses
        // V49 FIX: Sanitize values - schema expects strings, not arrays
        if (updates.fallbackResponses) {
            Object.entries(updates.fallbackResponses).forEach(([key, value]) => {
                // If value is an array, convert to string (join with space or take first element)
                let sanitizedValue = value;
                if (Array.isArray(value)) {
                    sanitizedValue = value.join(' ').trim() || '';
                    logger.warn(`[FRONT DESK] Converted array to string for fallbackResponses.${key}:`, { original: value, converted: sanitizedValue });
                }
                // Ensure it's a string
                if (typeof sanitizedValue !== 'string') {
                    sanitizedValue = String(sanitizedValue || '');
                }
                updateObj[`aiAgentSettings.frontDeskBehavior.fallbackResponses.${key}`] = sanitizedValue;
            });
        }
        
        // Save mode switching
        if (updates.modeSwitching) {
            Object.entries(updates.modeSwitching).forEach(([key, value]) => {
                updateObj[`aiAgentSettings.frontDeskBehavior.modeSwitching.${key}`] = value;
            });
        }
        
        // Phase 1: Save scheduling config (request_only mode with UI-controlled time windows)
        if (updates.scheduling) {
            // Save entire scheduling object - includes provider, timeWindows, prompts
            updateObj['aiAgentSettings.frontDeskBehavior.scheduling'] = updates.scheduling;
            logger.info('[FRONT DESK] Phase 1: Scheduling config saved', {
                companyId: req.params.companyId,
                provider: updates.scheduling.provider,
                windowCount: updates.scheduling.timeWindows?.length || 0
            });
        }
        
        // Save service area responses
        if (updates.serviceAreaResponses) {
            Object.entries(updates.serviceAreaResponses).forEach(([key, value]) => {
                updateObj[`aiAgentSettings.frontDeskBehavior.serviceAreaResponses.${key}`] = value;
            });
        }
        
        // Save inquiry responses
        if (updates.inquiryResponses) {
            Object.entries(updates.inquiryResponses).forEach(([key, value]) => {
                updateObj[`aiAgentSettings.frontDeskBehavior.inquiryResponses.${key}`] = value;
            });
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // V22: Discovery & Consent Gate Settings
        // ════════════════════════════════════════════════════════════════════════════
        if (updates.discoveryConsent) {
            Object.entries(updates.discoveryConsent).forEach(([key, value]) => {
                updateObj[`aiAgentSettings.frontDeskBehavior.discoveryConsent.${key}`] = value;
            });
            logger.info('[FRONT DESK BEHAVIOR] 🧠 V22 Saving discoveryConsent:', updates.discoveryConsent);
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // V92: Debug Logging Toggle
        // ════════════════════════════════════════════════════════════════════════════
        // Enables enhanced diagnostic logging for consent detection, booking triggers,
        // and flow transitions. Search BlackBox for "V92:" to find entries.
        // ════════════════════════════════════════════════════════════════════════════
        if (updates.debugLogging !== undefined) {
            updateObj['aiAgentSettings.frontDeskBehavior.debugLogging'] = !!updates.debugLogging;
            logger.info('[FRONT DESK BEHAVIOR] 🔍 V92 Debug Logging:', {
                companyId,
                enabled: !!updates.debugLogging
            });
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // V22: Vocabulary Guardrails Settings
        // ════════════════════════════════════════════════════════════════════════════
        if (updates.vocabularyGuardrails) {
            Object.entries(updates.vocabularyGuardrails).forEach(([key, value]) => {
                updateObj[`aiAgentSettings.frontDeskBehavior.vocabularyGuardrails.${key}`] = value;
            });
            logger.info('[FRONT DESK BEHAVIOR] 📝 V22 Saving vocabularyGuardrails:', updates.vocabularyGuardrails);
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // 🔤 V26: Caller Vocabulary - Industry Slang Translation
        // ════════════════════════════════════════════════════════════════════════════
        // When caller says "not pulling", AI understands "not cooling" (HVAC)
        // This is for INPUT (what caller says), not OUTPUT (what AI says)
        // ════════════════════════════════════════════════════════════════════════════
        if (updates.callerVocabulary) {
            Object.entries(updates.callerVocabulary).forEach(([key, value]) => {
                updateObj[`aiAgentSettings.frontDeskBehavior.callerVocabulary.${key}`] = value;
            });
            logger.info('[FRONT DESK BEHAVIOR] 🔤 V26 Saving callerVocabulary:', {
                companyId,
                enabled: updates.callerVocabulary.enabled,
                synonymCount: updates.callerVocabulary.synonymMap ? Object.keys(updates.callerVocabulary.synonymMap).length : 0
            });
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // 👤 V84: GLOBAL COMMON NAMES - Platform-wide lists (MOVED from per-company)
        // ════════════════════════════════════════════════════════════════════════════
        // Common first/last names are now stored in AdminSettings (global), not per-company.
        // This ensures all companies share the same name lists without duplication.
        // ════════════════════════════════════════════════════════════════════════════
        if (updates.commonFirstNames !== undefined || updates.commonLastNames !== undefined) {
            try {
                const AdminSettings = require('../../models/AdminSettings');
                const adminSettings = await AdminSettings.findOne();
                
                if (!adminSettings) {
                    logger.warn('[FRONT DESK BEHAVIOR] ⚠️ No AdminSettings found, creating one...');
                    const newSettings = new AdminSettings({
                        commonFirstNames: updates.commonFirstNames || [],
                        commonLastNames: updates.commonLastNames || []
                    });
                    await newSettings.save();
                    logger.info('[FRONT DESK BEHAVIOR] ✅ Created AdminSettings with global common names');
                } else {
                    // Update existing AdminSettings
                    if (updates.commonFirstNames !== undefined) {
                        adminSettings.commonFirstNames = updates.commonFirstNames || [];
                        logger.info('[FRONT DESK BEHAVIOR] 👤 Saving GLOBAL commonFirstNames', {
                            count: (updates.commonFirstNames || []).length,
                            sample: (updates.commonFirstNames || []).slice(0, 10)
                        });
                    }
                    
                    if (updates.commonLastNames !== undefined) {
                        adminSettings.commonLastNames = updates.commonLastNames || [];
                        logger.info('[FRONT DESK BEHAVIOR] 👤 Saving GLOBAL commonLastNames', {
                            count: (updates.commonLastNames || []).length,
                            sample: (updates.commonLastNames || []).slice(0, 10)
                        });
                    }
                    
                    adminSettings.lastUpdated = new Date();
                    adminSettings.updatedBy = req.user?.email || 'admin';
                    
                    await adminSettings.save();
                    logger.info('[FRONT DESK BEHAVIOR] ✅ Updated AdminSettings with global common names');
                }
            } catch (err) {
                logger.error('[FRONT DESK BEHAVIOR] ❌ Failed to save global common names', {
                    companyId,
                    error: err.message
                });
                // Don't fail the entire save, just log the error
            }
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // ⚡ V84.3: 3-TIER INTELLIGENCE SETTINGS - Thresholds and LLM Fallback Control
        // ════════════════════════════════════════════════════════════════════════════
        // Controls how aggressively AI matches scenarios:
        // - tier1Threshold: Min confidence for Tier 1 (rule-based, fast, free)
        // - tier2Threshold: Min confidence for Tier 2 (semantic, free)
        // - enableTier3: Whether to use GPT-4o-mini fallback (costs $)
        // - useGlobalIntelligence: Inherit platform defaults or use company-specific
        //
        // SAVE ROUTING:
        //   Global mode (default): saves to AdminSettings.globalProductionIntelligence
        //   Company mode: saves to company.aiAgentSettings.productionIntelligence
        //
        // RUNTIME READS:
        //   AIBrain3tierllm → IntelligentRouter context.intelligenceConfig
        //   AdminSettings.globalProductionIntelligence  (global mode)
        //   company.aiAgentSettings.productionIntelligence  (company mode)
        // ════════════════════════════════════════════════════════════════════════════
        if (updates.useGlobalIntelligence !== undefined || updates.productionIntelligence || updates.globalProductionIntelligence) {
            // Handle useGlobalIntelligence toggle (per-company flag)
            if (updates.useGlobalIntelligence !== undefined) {
                updateObj['aiAgentSettings.useGlobalIntelligence'] = updates.useGlobalIntelligence;
                logger.info('[FRONT DESK BEHAVIOR] ⚡ Saving useGlobalIntelligence', {
                    companyId,
                    value: updates.useGlobalIntelligence
                });
            }
            
            // Determine if saving globally or per-company
            const isGlobalMode = updates.useGlobalIntelligence !== undefined
                ? updates.useGlobalIntelligence
                : (await v2Company.findById(companyId).select('aiAgentSettings.useGlobalIntelligence').lean())
                    ?.aiAgentSettings?.useGlobalIntelligence !== false;
            
            // Handle intelligence thresholds
            const intel = updates.globalProductionIntelligence || updates.productionIntelligence;
            if (intel?.thresholds) {
                const thresholdUpdates = {};
                
                if (intel.thresholds.tier1 !== undefined) {
                    thresholdUpdates.tier1 = Math.max(0.50, Math.min(0.95, Number(intel.thresholds.tier1) || 0.80));
                }
                if (intel.thresholds.tier2 !== undefined) {
                    thresholdUpdates.tier2 = Math.max(0.40, Math.min(0.80, Number(intel.thresholds.tier2) || 0.60));
                }
                if (intel.thresholds.enableTier3 !== undefined) {
                    thresholdUpdates.enableTier3 = intel.thresholds.enableTier3 === true;
                }
                
                if (Object.keys(thresholdUpdates).length > 0) {
                    if (isGlobalMode) {
                        // ──── GLOBAL: Save to AdminSettings.globalProductionIntelligence ────
                        try {
                            const AdminSettings = require('../../models/AdminSettings');
                            const globalUpdateObj = {};
                            for (const [key, val] of Object.entries(thresholdUpdates)) {
                                globalUpdateObj[`globalProductionIntelligence.thresholds.${key}`] = val;
                            }
                            globalUpdateObj['globalProductionIntelligence.lastUpdated'] = new Date();
                            globalUpdateObj['globalProductionIntelligence.updatedBy'] = req.user?.email || 'admin';
                            
                            await AdminSettings.findOneAndUpdate(
                                {},
                                { $set: globalUpdateObj },
                                { upsert: true }
                            );
                            logger.info('[FRONT DESK BEHAVIOR] ⚡ V84.3: Saved GLOBAL intelligence thresholds to AdminSettings', {
                                companyId,
                                thresholds: thresholdUpdates
                            });
                        } catch (err) {
                            logger.error('[FRONT DESK BEHAVIOR] ❌ Failed to save global intelligence thresholds', {
                                companyId,
                                error: err.message
                            });
                        }
                    } else {
                        // ──── COMPANY: Save to company.aiAgentSettings.productionIntelligence ────
                        for (const [key, val] of Object.entries(thresholdUpdates)) {
                            updateObj[`aiAgentSettings.productionIntelligence.thresholds.${key}`] = val;
                        }
                        updateObj['aiAgentSettings.productionIntelligence.lastUpdated'] = new Date();
                        updateObj['aiAgentSettings.productionIntelligence.updatedBy'] = req.user?.email || 'admin';
                        logger.info('[FRONT DESK BEHAVIOR] ⚡ V84.3: Saved COMPANY intelligence thresholds', {
                            companyId,
                            thresholds: thresholdUpdates
                        });
                    }
                }
            }
        }
        
        // Legacy path: also handle nested aiAgentSettings.productionIntelligence for backward compatibility
        if (updates.aiAgentSettings?.productionIntelligence && !updates.productionIntelligence && !updates.globalProductionIntelligence) {
            const intel = updates.aiAgentSettings.productionIntelligence;
            if (intel.thresholds) {
                if (intel.thresholds.tier1 !== undefined) {
                    updateObj['aiAgentSettings.productionIntelligence.thresholds.tier1'] = Math.max(0.50, Math.min(0.95, Number(intel.thresholds.tier1) || 0.80));
                }
                if (intel.thresholds.tier2 !== undefined) {
                    updateObj['aiAgentSettings.productionIntelligence.thresholds.tier2'] = Math.max(0.40, Math.min(0.80, Number(intel.thresholds.tier2) || 0.60));
                }
                if (intel.thresholds.enableTier3 !== undefined) {
                    updateObj['aiAgentSettings.productionIntelligence.thresholds.enableTier3'] = intel.thresholds.enableTier3 === true;
                }
            }
            updateObj['aiAgentSettings.productionIntelligence.lastUpdated'] = new Date();
            updateObj['aiAgentSettings.productionIntelligence.updatedBy'] = req.user?.email || 'admin';
        }
        if (updates.aiAgentSettings?.useGlobalIntelligence !== undefined && updates.useGlobalIntelligence === undefined) {
            updateObj['aiAgentSettings.useGlobalIntelligence'] = updates.aiAgentSettings.useGlobalIntelligence;
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // 🚫 V84 Phase 2: NAME STOP WORDS - Now GLOBAL in AdminSettings
        // ════════════════════════════════════════════════════════════════════════════
        // Name rejection words are now platform-wide, stored in AdminSettings.
        // All companies share the same stop word list — no per-company duplication.
        // Runtime: IdentitySlotFirewall.validateName() + BookingFlowRunner.isStopWord()
        // ════════════════════════════════════════════════════════════════════════════
        if (updates.nameStopWords !== undefined) {
            // Normalize: lowercase, trim, deduplicate
            const normalized = [...new Set(
                (updates.nameStopWords || [])
                    .map(w => String(w).trim().toLowerCase())
                    .filter(w => w.length > 0)
            )];
            
            try {
                const AdminSettings = require('../../models/AdminSettings');
                let adminSettings = await AdminSettings.findOne();
                
                if (!adminSettings) {
                    adminSettings = new AdminSettings({ nameStopWords: normalized });
                    await adminSettings.save();
                    logger.info('[FRONT DESK BEHAVIOR] ✅ Created AdminSettings with global nameStopWords');
                } else {
                    adminSettings.nameStopWords = normalized;
                    adminSettings.lastUpdated = new Date();
                    await adminSettings.save();
                    logger.info('[FRONT DESK BEHAVIOR] 🚫 Saved GLOBAL nameStopWords to AdminSettings', {
                        count: normalized.length,
                        sample: normalized.slice(0, 15)
                    });
                }
            } catch (err) {
                logger.error('[FRONT DESK BEHAVIOR] ❌ Failed to save global nameStopWords', {
                    companyId,
                    error: err.message
                });
                // No per-company fallback — nameStopWords is GLOBAL only
            }
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // ✏️ V30: Name Spelling Variants - "Mark with K or C?"
        // ════════════════════════════════════════════════════════════════════════════
        // Optional feature for dental/medical/membership contexts.
        // OFF by default - only enable when exact spelling matters for record lookup.
        // ════════════════════════════════════════════════════════════════════════════
        if (updates.nameSpellingVariants) {
            if (updates.nameSpellingVariants.enabled !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.nameSpellingVariants.enabled'] = updates.nameSpellingVariants.enabled;
            }
            if (updates.nameSpellingVariants.source !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.nameSpellingVariants.source'] = updates.nameSpellingVariants.source;
            }
            if (updates.nameSpellingVariants.mode !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.nameSpellingVariants.mode'] = updates.nameSpellingVariants.mode;
            }
            if (updates.nameSpellingVariants.script !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.nameSpellingVariants.script'] = updates.nameSpellingVariants.script;
            }
            if (updates.nameSpellingVariants.maxAsksPerCall !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.nameSpellingVariants.maxAsksPerCall'] = updates.nameSpellingVariants.maxAsksPerCall;
            }
            if (updates.nameSpellingVariants.variantGroups !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.nameSpellingVariants.variantGroups'] = updates.nameSpellingVariants.variantGroups;
            }
            logger.info('[FRONT DESK BEHAVIOR] ✏️ V30 Saving nameSpellingVariants:', {
                companyId,
                enabled: updates.nameSpellingVariants.enabled,
                source: updates.nameSpellingVariants.source,
                mode: updates.nameSpellingVariants.mode,
                variantGroupCount: updates.nameSpellingVariants.variantGroups ? Object.keys(updates.nameSpellingVariants.variantGroups).length : 0
            });
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // 🎯 Booking Outcome - What AI says when all slots collected
        // ════════════════════════════════════════════════════════════════════════════
        // DEFAULT: "Confirmed on Call" - no callbacks unless explicitly enabled
        // Modes: confirmed_on_call, pending_dispatch, callback_required, 
        //        transfer_to_scheduler, after_hours_hold
        // ════════════════════════════════════════════════════════════════════════════
        if (updates.bookingOutcome) {
            if (updates.bookingOutcome.mode !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.bookingOutcome.mode'] = updates.bookingOutcome.mode;
            }
            if (updates.bookingOutcome.useAsapVariant !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.bookingOutcome.useAsapVariant'] = updates.bookingOutcome.useAsapVariant;
            }
            if (updates.bookingOutcome.asapVariantScript !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.bookingOutcome.asapVariantScript'] = updates.bookingOutcome.asapVariantScript;
            }
            if (updates.bookingOutcome.customFinalScript !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.bookingOutcome.customFinalScript'] = updates.bookingOutcome.customFinalScript;
            }
            if (updates.bookingOutcome.finalScripts) {
                Object.entries(updates.bookingOutcome.finalScripts).forEach(([mode, script]) => {
                    updateObj[`aiAgentSettings.frontDeskBehavior.bookingOutcome.finalScripts.${mode}`] = script;
                });
            }
            logger.info('[FRONT DESK BEHAVIOR] 🎯 Saving bookingOutcome:', {
                companyId,
                mode: updates.bookingOutcome.mode,
                useAsapVariant: updates.bookingOutcome.useAsapVariant,
                hasCustomScript: !!updates.bookingOutcome.customFinalScript
            });
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // 🚀 V25: Fast-Path Booking - Respect caller urgency
        // ════════════════════════════════════════════════════════════════════════════
        // When caller says "I need you out here", skip troubleshooting and offer scheduling.
        // Does NOT auto-book - still requires explicit consent.
        // ════════════════════════════════════════════════════════════════════════════
        if (updates.fastPathBooking) {
            if (updates.fastPathBooking.enabled !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.fastPathBooking.enabled'] = updates.fastPathBooking.enabled;
            }
            if (updates.fastPathBooking.triggerKeywords !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.fastPathBooking.triggerKeywords'] = updates.fastPathBooking.triggerKeywords;
            }
            if (updates.fastPathBooking.offerScript !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.fastPathBooking.offerScript'] = updates.fastPathBooking.offerScript;
            }
            if (updates.fastPathBooking.oneQuestionScript !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.fastPathBooking.oneQuestionScript'] = updates.fastPathBooking.oneQuestionScript;
            }
            if (updates.fastPathBooking.maxDiscoveryQuestions !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.fastPathBooking.maxDiscoveryQuestions'] = updates.fastPathBooking.maxDiscoveryQuestions;
            }
            logger.info('[FRONT DESK BEHAVIOR] 🚀 Saving fastPathBooking:', {
                companyId,
                enabled: updates.fastPathBooking.enabled,
                keywordCount: updates.fastPathBooking.triggerKeywords?.length,
                maxQuestions: updates.fastPathBooking.maxDiscoveryQuestions
            });
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // 👋 V32: Conversation Stages (includes greetingRules)
        // ════════════════════════════════════════════════════════════════════════════
        if (updates.conversationStages) {
            // Save greetingRules array (new V32 format)
            if (updates.conversationStages.greetingRules !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.conversationStages.greetingRules'] = updates.conversationStages.greetingRules;
            }
            // Save legacy greetingResponses (for backward compat)
            if (updates.conversationStages.greetingResponses) {
                Object.entries(updates.conversationStages.greetingResponses).forEach(([key, value]) => {
                    updateObj[`aiAgentSettings.frontDeskBehavior.conversationStages.greetingResponses.${key}`] = value;
                });
            }
            // Save other conversationStages settings if present
            if (updates.conversationStages.enabled !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.conversationStages.enabled'] = updates.conversationStages.enabled;
            }
            logger.info('[FRONT DESK BEHAVIOR] 👋 V32 Saving conversationStages:', {
                companyId,
                greetingRulesCount: updates.conversationStages.greetingRules?.length || 0,
                hasLegacyResponses: !!updates.conversationStages.greetingResponses
            });
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // 🔇 V36: Custom Filler Words (Company-Specific)
        // These are saved to aiAgentSettings.fillerWords.custom (NOT frontDeskBehavior)
        // ════════════════════════════════════════════════════════════════════════════
        if (updates.fillerWords) {
            if (updates.fillerWords.custom !== undefined) {
                updateObj['aiAgentSettings.fillerWords.custom'] = updates.fillerWords.custom;
            }
            logger.info('[FRONT DESK BEHAVIOR] 🔇 V36 Saving custom fillers:', {
                companyId,
                customCount: (updates.fillerWords.custom || []).length,
                customFillers: updates.fillerWords.custom || []
            });
        }
        
        // 🔇 V36: Filler words enabled toggle
        if (updates.fillerWordsEnabled !== undefined) {
            updateObj['aiAgentSettings.frontDeskBehavior.fillerWordsEnabled'] = updates.fillerWordsEnabled;
        }
        
        // ☢️ NUKED V84: Legacy V36 name stop words save block removed.
        // Name stop words are now GLOBAL — saved to AdminSettings above.
        // The old per-company aiAgentSettings.nameStopWords path is deprecated.
        
        // ════════════════════════════════════════════════════════════════════════════
        // 🏠 V93: Address Verification Policy (AW Onboarding Cockpit)
        // Controls whether agent asks for missing city/state/unit during booking
        // These are saved to aiAgentSettings.frontDesk.booking.addressVerification
        // ════════════════════════════════════════════════════════════════════════════
        if (updates.addressVerification) {
            const av = updates.addressVerification;
            if (av.enabled !== undefined) {
                updateObj['aiAgentSettings.frontDesk.booking.addressVerification.enabled'] = av.enabled;
            }
            if (av.requireCity !== undefined) {
                updateObj['aiAgentSettings.frontDesk.booking.addressVerification.requireCity'] = av.requireCity;
            }
            if (av.requireState !== undefined) {
                updateObj['aiAgentSettings.frontDesk.booking.addressVerification.requireState'] = av.requireState;
            }
            if (av.requireZip !== undefined) {
                updateObj['aiAgentSettings.frontDesk.booking.addressVerification.requireZip'] = av.requireZip;
            }
            if (av.requireUnitQuestion !== undefined) {
                updateObj['aiAgentSettings.frontDesk.booking.addressVerification.requireUnitQuestion'] = av.requireUnitQuestion;
            }
            if (av.unitQuestionMode !== undefined) {
                updateObj['aiAgentSettings.frontDesk.booking.addressVerification.unitQuestionMode'] = av.unitQuestionMode;
            }
            if (av.missingCityStatePrompt !== undefined) {
                updateObj['aiAgentSettings.frontDesk.booking.addressVerification.missingCityStatePrompt'] = av.missingCityStatePrompt;
            }
            if (av.unitTypePrompt !== undefined) {
                updateObj['aiAgentSettings.frontDesk.booking.addressVerification.unitTypePrompt'] = av.unitTypePrompt;
            }
            logger.info('[FRONT DESK BEHAVIOR] 🏠 V93 Saving addressVerification:', {
                companyId,
                changes: Object.keys(av)
            });
            
            // V93: Emit CONFIG_WRITE to Raw Events for AW ⇄ RE proof
            try {
                await BlackBoxLogger.logEvent({
                    companyId,
                    type: 'CONFIG_WRITE',
                    data: {
                        source: 'OnboardingCockpit',
                        section: 'addressVerification',
                        paths: Object.keys(av).map(k => `booking.addressVerification.${k}`),
                        changedBy: req.user?.email || 'admin',
                        timestamp: new Date().toISOString()
                    }
                });
            } catch (bbErr) {
                logger.warn('[FRONT DESK BEHAVIOR] CONFIG_WRITE event failed', { error: bbErr.message });
            }
        }
        
        updateObj['aiAgentSettings.frontDeskBehavior.lastUpdated'] = new Date();
        updateObj['aiAgentSettings.frontDeskBehavior.updatedBy'] = req.user?.email || 'admin';
        
        const result = await v2Company.findByIdAndUpdate(
            companyId,
            { $set: updateObj },
            { new: true }
        );
        
        if (!result) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }
        
        // 🔍 DEBUG: Log what was actually saved to MongoDB
        const savedSlots = result.aiAgentSettings?.frontDeskBehavior?.bookingSlots;
        if (savedSlots) {
            const nameSlot = savedSlots.find(s => s.id === 'name');
            logger.info('[FRONT DESK BEHAVIOR] ✅ SAVED TO MONGODB - Name slot:', {
                companyId,
                id: nameSlot?.id,
                type: nameSlot?.type,
                askMissingNamePart: nameSlot?.askMissingNamePart,
                askMissingNamePartType: typeof nameSlot?.askMissingNamePart
            });
        }
        
        // commonFirstNames/commonLastNames/nameStopWords are saved to AdminSettings (global)
        // not to per-company. See the PATCH handler's AdminSettings save block above.
        
        // Clear Redis cache so runtime picks up new config immediately
        try {
            const { redisClient } = require('../../db');
            if (redisClient && typeof redisClient.del === 'function') {
                await redisClient.del(`company:${companyId}`);
                await redisClient.del(`company:${companyId}:frontDeskBehavior`);
                logger.info('[FRONT DESK BEHAVIOR] ✅ Redis cache cleared for company', { companyId });
            } else {
                logger.debug('[FRONT DESK BEHAVIOR] Redis client not available for cache clear');
            }
        } catch (cacheErr) {
            logger.warn('[FRONT DESK BEHAVIOR] ⚠️ Redis cache clear failed (config will refresh in 60s)', { 
                error: cacheErr.message,
                companyId 
            });
        }

        // Immutable config audit: AFTER snapshot (company-scoped)
        const afterCompany = await v2Company.findById(companyId)
            .select('aiAgentSettings.frontDeskBehavior aiAgentSettings.templateReferences aiAgentSettings.scenarioControls agentSettings')
            .lean();

        const auditEntry = await ConfigAuditService.logConfigChange({
            req,
            companyId,
            action: 'frontDeskBehavior.patch',
            updatedPaths: Object.keys(updateObj),
            beforeCompanyDoc: beforeCompany,
            afterCompanyDoc: afterCompany
        });

        // ═══════════════════════════════════════════════════════════════════════════════
        // V94: CONFIG_WRITE - Emit to Raw Events for AW ⇄ RE marriage (Phase B proof)
        // ═══════════════════════════════════════════════════════════════════════════════
        // This allows AW/Raw Events to prove that UI saved specific canonical paths
        // Non-blocking - never let event logging break the save
        // ═══════════════════════════════════════════════════════════════════════════════
        try {
            // Convert updateObj keys to AW canonical paths for visibility
            const awPaths = Object.keys(updateObj).map(dbPath => {
                // Map DB paths back to AW canonical paths
                if (dbPath.startsWith('aiAgentSettings.frontDesk.booking.')) {
                    return dbPath.replace('aiAgentSettings.frontDesk.', '');
                }
                if (dbPath.startsWith('aiAgentSettings.frontDeskBehavior.')) {
                    return 'frontDesk.' + dbPath.replace('aiAgentSettings.frontDeskBehavior.', '');
                }
                if (dbPath.startsWith('aiAgentSettings.')) {
                    return dbPath.replace('aiAgentSettings.', '');
                }
                return dbPath;
            });
            
            // Only emit if we have paths to report
            if (awPaths.length > 0) {
                await BlackBoxLogger.logEvent(null, 'CONFIG_WRITE', {
                    source: 'FrontDeskBehaviorManager',
                    companyId,
                    paths: awPaths,
                    pathCount: awPaths.length,
                    // Highlight canonical AW paths (the important ones)
                    canonicalPaths: awPaths.filter(p => 
                        p.startsWith('booking.addressVerification.') ||
                        p.startsWith('frontDesk.detectionTriggers.') ||
                        p.startsWith('frontDesk.nameSpellingVariants.') ||
                        p.startsWith('frontDesk.slotRegistry.') ||
                        p.startsWith('frontDesk.bookingFlow.')
                    ),
                    changedBy: req.user?.email || 'admin',
                    effectiveConfigVersion: auditEntry?.effectiveConfigVersionAfter || null,
                    requestId: auditEntry?.request?.requestId || null
                }, { companyId });
                
                logger.info('[FRONT DESK BEHAVIOR] V94: CONFIG_WRITE emitted to Raw Events', {
                    companyId,
                    pathCount: awPaths.length,
                    canonicalCount: awPaths.filter(p => p.startsWith('booking.') || p.startsWith('frontDesk.')).length
                });
            }
        } catch (configWriteErr) {
            // Never let CONFIG_WRITE emission break the save
            logger.warn('[FRONT DESK BEHAVIOR] V94: CONFIG_WRITE emit failed (non-fatal)', {
                companyId,
                error: configWriteErr.message
            });
        }

        // ════════════════════════════════════════════════════════════════════════════
        // 🔒 DRIFT DETECTION: Save lastSavedEffectiveConfigVersion after successful write
        // ════════════════════════════════════════════════════════════════════════════
        // This enables UI to detect drift: UI saved ECV != Runtime ECV
        // If they differ, something external changed config since last UI save
        // ════════════════════════════════════════════════════════════════════════════
        if (auditEntry?.effectiveConfigVersionAfter) {
            try {
                await v2Company.findByIdAndUpdate(companyId, {
                    $set: {
                        'aiAgentSettings._meta.lastSavedEffectiveConfigVersion': auditEntry.effectiveConfigVersionAfter,
                        'aiAgentSettings._meta.lastSavedAt': new Date(),
                        'aiAgentSettings._meta.lastSavedRequestId': auditEntry.request?.requestId || null,
                        'aiAgentSettings._meta.lastSavedBy': req.user?.email || 'admin'
                    }
                });
                logger.info('[FRONT DESK BEHAVIOR] 🔒 DRIFT: Saved effectiveConfigVersion for drift detection', {
                    companyId,
                    effectiveConfigVersion: auditEntry.effectiveConfigVersionAfter
                });
            } catch (driftErr) {
                logger.warn('[FRONT DESK BEHAVIOR] ⚠️ Failed to save drift detection meta (non-fatal)', {
                    companyId,
                    error: driftErr.message
                });
            }
        }
        
        res.json({
            success: true,
            message: 'Front Desk Behavior updated',
            data: result.aiAgentSettings?.frontDeskBehavior,
            _meta: {
                effectiveConfigVersion: auditEntry?.effectiveConfigVersionAfter || null,
                requestId: auditEntry?.request?.requestId || null
            }
        });
        
    } catch (error) {
        logger.error('[FRONT DESK BEHAVIOR] Update error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================================
// POST - Reset to defaults
// ============================================================================
// V110++: Now includes canonical slot registry, discovery flow, booking flow
router.post('/:companyId/reset', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        
        // V110++: Merge UI_DEFAULTS with V110 canonical slot/flow configs
        // V84: Exclude global-only fields (commonFirstNames, commonLastNames, nameStopWords)
        // These live in AdminSettings, never in per-company documents.
        const { commonFirstNames, commonLastNames, nameStopWords, ...companyDefaults } = UI_DEFAULTS;
        const fullDefaults = {
            enabled: true,
            ...companyDefaults,
            // V110 Canonical Configs - IDs match SlotExtractor output
            slotRegistry: DEFAULT_SLOT_REGISTRY,
            discoveryFlow: DEFAULT_DISCOVERY_FLOW,
            bookingFlow: DEFAULT_BOOKING_FLOW,
            policies: DEFAULT_FLOW_POLICIES,
            lastUpdated: new Date(),
            updatedBy: req.user?.email || 'admin'
        };
        
        const result = await v2Company.findByIdAndUpdate(
            companyId,
            { 
                $set: { 
                    'aiAgentSettings.frontDeskBehavior': fullDefaults
                }
            },
            { new: true }
        );
        
        if (!result) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }
        
        logger.info('[FRONT DESK BEHAVIOR] V110++ Reset to defaults with canonical slots', {
            companyId,
            slotCount: DEFAULT_SLOT_REGISTRY?.slots?.length || 0,
            discoveryStepCount: DEFAULT_DISCOVERY_FLOW?.steps?.length || 0,
            bookingStepCount: DEFAULT_BOOKING_FLOW?.steps?.length || 0
        });
        
        res.json({
            success: true,
            message: 'Reset to defaults (V110++ with canonical slots)',
            data: result.aiAgentSettings?.frontDeskBehavior
        });
        
    } catch (error) {
        logger.error('[FRONT DESK BEHAVIOR] Reset error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================================
// POST - Test a phrase with FULL analysis and suggested response
// ============================================================================
router.post('/:companyId/test-emotion', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { phrase } = req.body;
        
        if (!phrase) {
            return res.status(400).json({ success: false, message: 'Phrase is required' });
        }
        
        const company = await v2Company.findById(companyId).lean();
        const config = company?.aiAgentSettings?.frontDeskBehavior || UI_DEFAULTS;
        
        const lowerPhrase = phrase.toLowerCase();
        
        // ════════════════════════════════════════════════════════════════════
        // 1. EMOTION DETECTION
        // ════════════════════════════════════════════════════════════════════
        const frustrationTriggers = config.frustrationTriggers || UI_DEFAULTS.frustrationTriggers;
        const matchedFrustration = frustrationTriggers.filter(t => lowerPhrase.includes(t.toLowerCase()));
        
        const escalationTriggers = config.escalation?.triggerPhrases || UI_DEFAULTS.escalation.triggerPhrases;
        const matchedEscalation = escalationTriggers.filter(t => lowerPhrase.includes(t.toLowerCase()));
        
        let detectedEmotion = 'neutral';
        if (matchedFrustration.length > 0) detectedEmotion = 'frustrated';
        if (matchedEscalation.length > 0) detectedEmotion = 'angry';
        
        // ════════════════════════════════════════════════════════════════════
        // 2. INTENT DETECTION - What does the caller want?
        // ════════════════════════════════════════════════════════════════════
        let detectedIntent = 'unknown';
        let intentKeywords = [];
        
        // Hours/Schedule questions
        if (/hours|open|close|available|when.*open|schedule/i.test(lowerPhrase)) {
            detectedIntent = 'hours_inquiry';
            intentKeywords = lowerPhrase.match(/hours|open|close|available|schedule/gi) || [];
        }
        // Pricing questions
        else if (/price|cost|how much|charge|fee|rate|estimate|quote/i.test(lowerPhrase)) {
            detectedIntent = 'pricing_inquiry';
            intentKeywords = lowerPhrase.match(/price|cost|how much|charge|fee|rate|estimate|quote/gi) || [];
        }
        // Service area questions
        else if (/service.*area|do you (service|cover|come to)|in my area|fort myers|naples|cape coral/i.test(lowerPhrase)) {
            detectedIntent = 'service_area';
            intentKeywords = lowerPhrase.match(/service|area|fort myers|naples|cape coral/gi) || [];
        }
        // Booking intent
        else if (/schedule|appointment|book|come out|send someone|technician|need service/i.test(lowerPhrase)) {
            detectedIntent = 'booking';
            intentKeywords = lowerPhrase.match(/schedule|appointment|book|come out|technician/gi) || [];
        }
        // Emergency
        else if (/emergency|urgent|right now|immediately|asap|leak|flood|no (heat|ac|air)/i.test(lowerPhrase)) {
            detectedIntent = 'emergency';
            intentKeywords = lowerPhrase.match(/emergency|urgent|leak|flood|no heat|no ac/gi) || [];
        }
        // General question
        else if (/\?$|what|how|why|can you|do you/i.test(lowerPhrase)) {
            detectedIntent = 'general_question';
        }
        
        // ════════════════════════════════════════════════════════════════════
        // 3. SUGGESTED RESPONSE - What should the AI say?
        // ════════════════════════════════════════════════════════════════════
        let suggestedResponse = '';
        let suggestion = '';
        let needsConfiguration = false;
        
        const inquiryResponses = config.inquiryResponses || UI_DEFAULTS.inquiryResponses || {};
        
        switch (detectedIntent) {
            case 'hours_inquiry':
                if (company?.businessHours) {
                    suggestedResponse = `Our office is open ${company.businessHours}. How can I help you today?`;
                } else {
                    suggestedResponse = "We're available Monday through Friday. Would you like to schedule a service?";
                    suggestion = "💡 Add business hours to Company Settings for automatic response";
                    needsConfiguration = true;
                }
                break;
                
            case 'pricing_inquiry':
                suggestedResponse = inquiryResponses.pricingInfo || 
                    "Pricing depends on the specific work needed. I'd be happy to get you a quote - may I have your name?";
                break;
                
            case 'service_area':
                const serviceAreaResponses = config.serviceAreaResponses || UI_DEFAULTS.serviceAreaResponses || {};
                suggestedResponse = serviceAreaResponses.confirm?.replace('{city}', 'your area') || 
                    "Yes, we service most of Southwest Florida! May I have your address to confirm?";
                break;
                
            case 'booking':
                suggestedResponse = `I can definitely help with that! May I have your name?`;
                break;
                
            case 'emergency':
                suggestedResponse = "I understand this is urgent. Let me get your information so we can send someone right away. What's your name and address?";
                break;
                
            case 'general_question':
                suggestedResponse = "I'd be happy to help! Let me get your information first - what's your name?";
                suggestion = "💡 Consider adding a specific response for this type of question in the Forbidden tab or creating a Triage Card";
                needsConfiguration = true;
                break;
                
            default:
                suggestedResponse = "I can help you with that! May I have your name to get started?";
                suggestion = "💡 This phrase didn't match any known patterns. Consider adding it to a Scenario or Triage Card.";
                needsConfiguration = true;
        }
        
        // ════════════════════════════════════════════════════════════════════
        // 4. RESPONSE
        // ════════════════════════════════════════════════════════════════════
        const emotionConfig = config.emotionResponses?.[detectedEmotion] || {};
        
        res.json({
            success: true,
            data: {
                phrase,
                // Emotion analysis
                detectedEmotion,
                matchedFrustration,
                matchedEscalation,
                // Intent analysis
                detectedIntent,
                intentKeywords,
                // What AI would say
                suggestedResponse,
                suggestion,
                needsConfiguration,
                // Emotion-specific behavior
                wouldAcknowledge: (emotionConfig.acknowledgments || []).length > 0,
                sampleAcknowledgment: (emotionConfig.acknowledgments || [])[0] || null,
                followUp: emotionConfig.followUp || '',
                reduceFriction: emotionConfig.reduceFriction || false,
                offerEscalation: emotionConfig.offerEscalation || false
            }
        });
        
    } catch (error) {
        logger.error('[FRONT DESK BEHAVIOR] Test emotion error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================================
// V73: GEOCODE ENDPOINT - Convert address to lat/lng for service area radius
// ============================================================================
router.get('/geocode', authenticateJWT, async (req, res) => {
    try {
        const { address } = req.query;
        
        if (!address) {
            return res.status(400).json({ success: false, error: 'Address is required' });
        }
        
        const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
        if (!GOOGLE_MAPS_API_KEY) {
            return res.status(500).json({ 
                success: false, 
                error: 'Google Maps API key not configured. Please add GOOGLE_MAPS_API_KEY to environment.' 
            });
        }
        
        const axios = require('axios');
        const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
            params: {
                address: address,
                key: GOOGLE_MAPS_API_KEY
            },
            timeout: 5000
        });
        
        if (response.data.status === 'OK' && response.data.results?.length > 0) {
            const result = response.data.results[0];
            const location = result.geometry?.location;
            
            if (location?.lat && location?.lng) {
                logger.info('[GEOCODE] ✅ Address geocoded successfully', {
                    address,
                    lat: location.lat,
                    lng: location.lng
                });
                
                return res.json({
                    success: true,
                    lat: location.lat,
                    lng: location.lng,
                    formattedAddress: result.formatted_address,
                    city: result.address_components?.find(c => c.types.includes('locality'))?.long_name,
                    state: result.address_components?.find(c => c.types.includes('administrative_area_level_1'))?.short_name
                });
            }
        }
        
        logger.warn('[GEOCODE] ❌ Address not found', { address, status: response.data.status });
        return res.json({ 
            success: false, 
            error: 'Address not found. Try a more specific address.' 
        });
        
    } catch (error) {
        logger.error('[GEOCODE] Error:', error.message);
        return res.status(500).json({ 
            success: false, 
            error: 'Geocoding failed: ' + error.message 
        });
    }
});

// ============================================================================
// HELPER: Deep merge objects
// ============================================================================
function deepMerge(target, source) {
    const result = { ...target };
    
    for (const key of Object.keys(source)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            result[key] = deepMerge(result[key] || {}, source[key]);
        } else if (source[key] !== undefined) {
            result[key] = source[key];
        }
    }
    
    return result;
}

module.exports = router;

