/**
 * ============================================================================
 * COMPANY CONFIG SEEDER - Prevents Wiring regression due to missing base fields
 * ============================================================================
 *
 * Goal: Wiring should never go RED because a company is missing “basic required”
 * fields that the platform expects to exist.
 *
 * IMPORTANT:
 * - Uses the `Company` model which is bound to Mongo collection `companiesCollection`
 *   (see `models/v2Company.js`).
 * - Seeds ONLY missing fields (idempotent, safe).
 * - Does NOT seed any scenario content. Scenarios remain GLOBAL (templates).
 */
 
const Company = require('../../models/v2Company');
const logger = require('../../utils/logger');
const { 
    DEFAULT_DETECTION_TRIGGERS, 
    DEFAULT_DIRECT_INTENT_PATTERNS, 
    DEFAULT_SCHEDULING, 
    DEFAULT_BUSINESS_HOURS,
    // V110: New canonical structures
    DEFAULT_SLOT_REGISTRY,
    DEFAULT_DISCOVERY_FLOW,
    DEFAULT_BOOKING_FLOW,
    DEFAULT_FLOW_POLICIES
} = require('../../config/onboarding/DefaultFrontDeskPreset');

/**
 * Infer a tradeKey for a company using templateReferences (if present).
 * Returns lowercase string or null.
 */
async function inferTradeKeyFromTemplateRefs(templateRefs) {
    try {
        const enabledRefs = Array.isArray(templateRefs) ? templateRefs.filter(r => r?.enabled !== false && r?.templateId) : [];
        if (enabledRefs.length === 0) return null;

        const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
        const first = await GlobalInstantResponseTemplate
            .findById(enabledRefs[0].templateId)
            .select('tradeKey templateType')
            .lean();

        const inferred = first?.tradeKey || first?.templateType || null;
        return inferred ? String(inferred).toLowerCase() : null;
    } catch (e) {
        logger.warn('[WIRING SEEDER] tradeKey inference failed (non-fatal)', { error: e?.message || String(e) });
        return null;
    }
}

/**
 * Seed base fields on a company doc.
 * @returns {Promise<{updated:boolean, applied:Record<string, any>, resolvedTradeKey:string|null}>}
 */
async function seedCompanyBaseFields({ companyId, companyDoc }) {
    if (!companyId) throw new Error('seedCompanyBaseFields requires companyId');
    if (!companyDoc) throw new Error('seedCompanyBaseFields requires companyDoc');

    const applied = {};

    // Safe defaults: minimal + non-breaking
    const hasAiName = !!companyDoc?.aiAgentSettings?.aiName;
    if (!hasAiName) {
        applied['aiAgentSettings.aiName'] = 'AI Assistant';
    }

    const hasBookingEnabled = typeof companyDoc?.aiAgentSettings?.frontDeskBehavior?.bookingEnabled === 'boolean';
    if (!hasBookingEnabled) {
        // Safe default: false until explicitly enabled/configured
        applied['aiAgentSettings.frontDeskBehavior.bookingEnabled'] = false;
    }

    const hasTradeKey = !!companyDoc?.aiAgentSettings?.tradeKey;
    let resolvedTradeKey = hasTradeKey ? String(companyDoc.aiAgentSettings.tradeKey).toLowerCase() : null;
    if (!resolvedTradeKey) {
        const inferred = await inferTradeKeyFromTemplateRefs(companyDoc?.aiAgentSettings?.templateReferences || []);
        resolvedTradeKey = inferred || 'universal';
        applied['aiAgentSettings.tradeKey'] = resolvedTradeKey;
    }

    // V106: Seed detection triggers if missing - CRITICAL for booking intent detection
    // Without these, callers saying "get someone out" stay stuck in DISCOVERY
    const hasWantsBooking = Array.isArray(companyDoc?.aiAgentSettings?.frontDeskBehavior?.detectionTriggers?.wantsBooking) &&
        companyDoc.aiAgentSettings.frontDeskBehavior.detectionTriggers.wantsBooking.length > 0;
    if (!hasWantsBooking) {
        applied['aiAgentSettings.frontDeskBehavior.detectionTriggers.wantsBooking'] = DEFAULT_DETECTION_TRIGGERS.wantsBooking;
        logger.info('[WIRING SEEDER] V106: Seeding wantsBooking detection triggers', {
            companyId: companyDoc._id.toString(),
            phraseCount: DEFAULT_DETECTION_TRIGGERS.wantsBooking.length
        });
    }

    // V108: Seed directIntentPatterns to CANONICAL path (frontDesk.detectionTriggers.*)
    // Legacy path (booking.directIntentPatterns) is no longer seeded in strict mode
    const hasDirectPatternsCanonical = Array.isArray(companyDoc?.aiAgentSettings?.frontDeskBehavior?.detectionTriggers?.directIntentPatterns) &&
        companyDoc.aiAgentSettings.frontDeskBehavior.detectionTriggers.directIntentPatterns.length > 0;
    if (!hasDirectPatternsCanonical) {
        applied['aiAgentSettings.frontDeskBehavior.detectionTriggers.directIntentPatterns'] = DEFAULT_DIRECT_INTENT_PATTERNS;
        logger.info('[WIRING SEEDER] V108: Seeding directIntentPatterns to canonical path', {
            companyId: companyDoc._id.toString(),
            phraseCount: DEFAULT_DIRECT_INTENT_PATTERNS.length,
            path: 'frontDeskBehavior.detectionTriggers.directIntentPatterns'
        });
    }

    // Phase 1: Seed scheduling config if missing (request_only mode)
    // This ensures frontDesk.scheduling.* keys resolve from companyConfig
    const hasScheduling = companyDoc?.aiAgentSettings?.frontDeskBehavior?.scheduling?.provider;
    if (!hasScheduling) {
        applied['aiAgentSettings.frontDeskBehavior.scheduling'] = DEFAULT_SCHEDULING;
        logger.info('[WIRING SEEDER] Phase 1: Seeding scheduling config (request_only mode)', {
            companyId: companyDoc._id.toString(),
            provider: DEFAULT_SCHEDULING.provider,
            windowCount: DEFAULT_SCHEDULING.timeWindows.length
        });
    }

    // Phase 1: Seed business hours if missing
    // This ensures frontDesk.businessHours resolves from companyConfig
    const hasBusinessHours = companyDoc?.aiAgentSettings?.frontDeskBehavior?.businessHours;
    if (!hasBusinessHours) {
        applied['aiAgentSettings.frontDeskBehavior.businessHours'] = DEFAULT_BUSINESS_HOURS;
        logger.info('[WIRING SEEDER] Phase 1: Seeding business hours', {
            companyId: companyDoc._id.toString()
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // V110: Seed NEW CANONICAL STRUCTURES (slotRegistry, discoveryFlow, bookingFlow, policies)
    // These are the enterprise-grade slot/flow architecture
    // ═══════════════════════════════════════════════════════════════════════════
    const hasSlotRegistry = companyDoc?.aiAgentSettings?.frontDeskBehavior?.slotRegistry?.version;
    if (!hasSlotRegistry) {
        applied['aiAgentSettings.frontDeskBehavior.slotRegistry'] = DEFAULT_SLOT_REGISTRY;
        logger.info('[WIRING SEEDER] V110: Seeding slotRegistry', {
            companyId: companyDoc._id.toString(),
            slotCount: DEFAULT_SLOT_REGISTRY.slots?.length || 0
        });
    }

    const hasDiscoveryFlow = companyDoc?.aiAgentSettings?.frontDeskBehavior?.discoveryFlow?.version;
    if (!hasDiscoveryFlow) {
        applied['aiAgentSettings.frontDeskBehavior.discoveryFlow'] = DEFAULT_DISCOVERY_FLOW;
        logger.info('[WIRING SEEDER] V110: Seeding discoveryFlow', {
            companyId: companyDoc._id.toString(),
            stepCount: DEFAULT_DISCOVERY_FLOW.steps?.length || 0
        });
    }

    const hasBookingFlow = companyDoc?.aiAgentSettings?.frontDeskBehavior?.bookingFlow?.version;
    if (!hasBookingFlow) {
        applied['aiAgentSettings.frontDeskBehavior.bookingFlow'] = DEFAULT_BOOKING_FLOW;
        logger.info('[WIRING SEEDER] V110: Seeding bookingFlow', {
            companyId: companyDoc._id.toString(),
            stepCount: DEFAULT_BOOKING_FLOW.steps?.length || 0
        });
    }

    const hasPolicies = companyDoc?.aiAgentSettings?.frontDeskBehavior?.policies?.booking;
    if (!hasPolicies) {
        applied['aiAgentSettings.frontDeskBehavior.policies'] = DEFAULT_FLOW_POLICIES;
        logger.info('[WIRING SEEDER] V110: Seeding policies', {
            companyId: companyDoc._id.toString()
        });
    }

    const keys = Object.keys(applied);
    if (keys.length === 0) {
        return { updated: false, applied: {}, resolvedTradeKey };
    }

    const res = await Company.updateOne(
        { _id: companyDoc._id },
        { $set: applied }
    );

    logger.info('[WIRING SEEDER] Seeded base fields (idempotent)', {
        companyId: companyDoc._id.toString(),
        matched: res.matchedCount,
        modified: res.modifiedCount,
        appliedKeys: keys
    });

    return { updated: res.modifiedCount > 0, applied, resolvedTradeKey };
}

module.exports = {
    seedCompanyBaseFields
};


