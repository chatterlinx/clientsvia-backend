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


