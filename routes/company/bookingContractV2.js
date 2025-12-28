/**
 * ============================================================================
 * BOOKING CONTRACT V2 - Company API
 * ============================================================================
 *
 * Feature-flagged layer that lets a company define:
 * - slotLibrary[] : what can be collected (questions, validation, confirm-back)
 * - slotGroups[]  : when to ask which slots (based on session.flags / contextFlags)
 *
 * IMPORTANT:
 * - This route does NOT change live call behavior by itself.
 * - Live call behavior flips only when:
 *   aiAgentSettings.frontDeskBehavior.bookingContractV2Enabled === true
 *   AND slotLibrary/slotGroups are populated.
 *
 * Endpoints:
 * - GET  /preview?flagsJson=...  -> compile preview using provided flags
 * - POST /migrate/from-bookingSlots -> generate slotLibrary+slotGroups from current bookingSlots
 */

const express = require('express');
const router = express.Router({ mergeParams: true });

const v2Company = require('../../models/v2Company');
const logger = require('../../utils/logger');
const { authenticateJWT, requireCompanyAccess } = require('../../middleware/auth');
const BookingContractCompiler = require('../../services/BookingContractCompiler');
const BookingScriptEngine = require('../../services/BookingScriptEngine');

router.use(authenticateJWT);
router.use(requireCompanyAccess);

function safeJsonParse(maybeJson) {
    if (!maybeJson || typeof maybeJson !== 'string') return null;
    try {
        return JSON.parse(maybeJson);
    } catch {
        return null;
    }
}

/**
 * GET /api/company/:companyId/booking-contract-v2/preview?flagsJson={}
 */
router.get('/preview', async (req, res) => {
    const { companyId } = req.params;
    const flags = safeJsonParse(req.query.flagsJson) || {};

    try {
        const company = await v2Company.findById(companyId).lean();
        if (!company) return res.status(404).json({ success: false, message: 'Company not found' });

        const frontDesk = company.aiAgentSettings?.frontDeskBehavior || {};
        const slotLibrary = Array.isArray(frontDesk.slotLibrary) ? frontDesk.slotLibrary : [];
        const slotGroups = Array.isArray(frontDesk.slotGroups) ? frontDesk.slotGroups : [];

        const compiled = BookingContractCompiler.compileBookingSlots({
            slotLibrary,
            slotGroups,
            contextFlags: flags
        });

        return res.json({
            success: true,
            data: {
                bookingContractV2Enabled: frontDesk.bookingContractV2Enabled === true,
                slotLibraryCount: slotLibrary.length,
                slotGroupsCount: slotGroups.length,
                flags,
                compiled
            }
        });
    } catch (error) {
        logger.error('[BOOKING CONTRACT V2] preview error', { companyId, error: error.message, stack: error.stack });
        return res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/company/:companyId/booking-contract-v2/migrate/from-bookingSlots
 * Body:
 * - enableAfter?: boolean (default false)
 * - groupLabel?: string (default "Base Booking")
 */
router.post('/migrate/from-bookingSlots', async (req, res) => {
    const { companyId } = req.params;
    const enableAfter = req.body?.enableAfter === true;
    const groupLabel = (req.body?.groupLabel || 'Base Booking').toString();

    try {
        const company = await v2Company.findById(companyId);
        if (!company) return res.status(404).json({ success: false, message: 'Company not found' });

        const frontDesk = company.aiAgentSettings?.frontDeskBehavior || {};

        // Use the existing normalized slots as the source of truth (legacy path)
        const normalized = BookingScriptEngine.getBookingSlotsFromCompany(company.toObject(), { contextFlags: {} });
        const slots = normalized.slots || [];

        // Convert normalized legacy slots -> slotLibrary
        const slotLibrary = slots.map(s => {
            const id = s.slotId || s.id;
            return {
                id,
                label: s.label || id,
                type: s.type || 'text',
                question: s.question || '',
                required: s.required === true,
                confirmBack: s.confirmBack === true,
                confirmPrompt: s.confirmPrompt || '',
                validation: s.validation || null,
                enumOptions: Array.isArray(s.selectOptions) ? s.selectOptions : [],
                order: typeof s.order === 'number' ? s.order : 0,
                typeOptions: (() => {
                    // Capture remaining keys as typeOptions without polluting base fields.
                    // This keeps V2 flexible and prevents schema churn.
                    const known = new Set([
                        'slotId', 'id', 'key', 'label', 'question', 'required', 'order', 'type',
                        'confirmBack', 'confirmPrompt', 'validation', 'selectOptions'
                    ]);
                    const opt = {};
                    for (const [k, v] of Object.entries(s || {})) {
                        if (!known.has(k)) opt[k] = v;
                    }
                    return opt;
                })()
            };
        });

        // Build one default group that preserves slot order
        const slotIdsOrdered = [...slotLibrary]
            .sort((a, b) => (a.order || 0) - (b.order || 0))
            .map(s => s.id);

        const slotGroups = [{
            id: 'base_booking',
            label: groupLabel,
            enabled: true,
            order: 0,
            isDefault: true,
            when: {},
            slots: slotIdsOrdered
        }];

        company.aiAgentSettings = company.aiAgentSettings || {};
        company.aiAgentSettings.frontDeskBehavior = company.aiAgentSettings.frontDeskBehavior || {};
        company.aiAgentSettings.frontDeskBehavior.slotLibrary = slotLibrary;
        company.aiAgentSettings.frontDeskBehavior.slotGroups = slotGroups;
        if (enableAfter) company.aiAgentSettings.frontDeskBehavior.bookingContractV2Enabled = true;

        await company.save();

        const compiledPreview = BookingContractCompiler.compileBookingSlots({
            slotLibrary,
            slotGroups,
            contextFlags: {}
        });

        return res.json({
            success: true,
            data: {
                migratedFrom: normalized.source,
                bookingContractV2Enabled: company.aiAgentSettings.frontDeskBehavior.bookingContractV2Enabled === true,
                slotLibraryCount: slotLibrary.length,
                slotGroupsCount: slotGroups.length,
                compiledPreview
            }
        });
    } catch (error) {
        logger.error('[BOOKING CONTRACT V2] migrate/from-bookingSlots error', { companyId, error: error.message, stack: error.stack });
        return res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;


