'use strict';

/**
 * ============================================================================
 * UAP ARRAYS — Admin API Routes
 * ============================================================================
 *
 * CRUD + calibration API for the Utterance Act Parser vocabulary.
 * UAPArrays define the daType/daSubType taxonomy and their trigger phrases.
 * Runtime reads ONLY from MongoDB — no values are hardcoded in code.
 *
 * MOUNT: /api/admin/agent2/company/:companyId/uap
 *
 * ENDPOINTS — ARRAYS:
 *   GET    /:companyId/uap/arrays            — list all arrays for company
 *   POST   /:companyId/uap/arrays/seed       — seed standard arrays (idempotent)
 *   PATCH  /:companyId/uap/arrays/:id        — update array (trigger phrases, active toggle)
 *
 * ENDPOINTS — PENDING CLASSIFICATIONS:
 *   GET    /:companyId/uap/pending           — sub-types with classificationStatus=PENDING
 *   PATCH  /:companyId/uap/pending/:arrayId/:subTypeKey  — manual override
 *
 * ENDPOINTS — BOOKING FIELDS (same source as Discovery Notes settings):
 *   GET    /:companyId/uap/booking-fields    — load bookingFieldConfig (from Company doc)
 *   PATCH  /:companyId/uap/booking-fields    — save bookingFieldConfig
 *
 * NO HARDCODING:
 *   STANDARD_DA_TYPES below are the seed payload only — written to DB once via /seed.
 *   After that, the DB record is the single source of truth. Owners can edit freely.
 *   Runtime never references STANDARD_DA_TYPES — it always reads from UAPArray collection.
 * ============================================================================
 */

const express             = require('express');
const router              = express.Router();
const mongoose            = require('mongoose');
const logger              = require('../../utils/logger');
const { authenticateJWT } = require('../../middleware/auth');
const UAPArray            = require('../../models/UAPArray');
const Company             = require('../../models/v2Company');

// ── All routes require a valid JWT ───────────────────────────────────────────
router.use(authenticateJWT);

// ── Access control ────────────────────────────────────────────────────────────

function _validateCompanyAccess(req, res, companyId) {
  if (!companyId) {
    res.status(400).json({ success: false, error: 'companyId is required' });
    return false;
  }
  const user    = req.user || {};
  const isAdmin = ['admin', 'super_admin', 'platform_admin'].includes(user.role);
  if (!isAdmin && user.companyId !== companyId) {
    res.status(403).json({ success: false, error: 'Access denied' });
    return false;
  }
  return true;
}

// ── Standard seed payload ─────────────────────────────────────────────────────
// This is the ONE-TIME seed payload written to the DB via POST /seed.
// After seeding, these values live in MongoDB. Code never references them at runtime.

const STANDARD_DA_TYPES = [
  {
    daType:     'PRICING_QUERY',
    label:      'Pricing Questions',
    daSubTypes: [
      { key: 'GENERAL_PRICING',   label: 'General Pricing',          triggerPhrases: ['how much', 'what does it cost', 'price', 'rates', 'quote', 'estimate', 'fee'] },
      { key: 'FINANCING',         label: 'Financing & Payment Plans', triggerPhrases: ['financing', 'payment plan', 'monthly payment', 'finance', 'pay over time'] },
      { key: 'WARRANTY',          label: 'Warranty Pricing',          triggerPhrases: ['warranty cost', 'extended warranty', 'protection plan', 'warranty price'] }
    ]
  },
  {
    daType:     'AVAILABILITY_QUERY',
    label:      'Availability & Scheduling',
    daSubTypes: [
      { key: 'SCHEDULE_APPT',     label: 'Schedule Appointment',      triggerPhrases: ['schedule', 'book', 'appointment', 'come out', 'send someone', 'availability', 'when can'] },
      { key: 'SAME_DAY',          label: 'Same-Day Service',           triggerPhrases: ['same day', 'today', 'asap', 'as soon as possible', 'emergency', 'urgent', 'right away'] },
      { key: 'HOURS',             label: 'Business Hours',             triggerPhrases: ['hours', 'open', 'closed', 'when do you', 'what time', 'business hours'] }
    ]
  },
  {
    daType:     'SERVICE_QUERY',
    label:      'Services Offered',
    daSubTypes: [
      { key: 'DO_YOU_DO',         label: 'Do You Offer This Service',  triggerPhrases: ['do you do', 'do you offer', 'can you', 'do you handle', 'do you fix', 'do you install'] },
      { key: 'SERVICE_BRANDS',    label: 'Brands Serviced',            triggerPhrases: ['brand', 'brands', 'make', 'model', 'manufacturer', 'work on'] },
      { key: 'SERVICE_AREAS',     label: 'Service Areas',              triggerPhrases: ['service area', 'do you come to', 'do you cover', 'my area', 'my zip', 'my city'] }
    ]
  },
  {
    daType:     'COMPLAINT',
    label:      'Complaints & Concerns',
    daSubTypes: [
      { key: 'QUALITY_COMPLAINT', label: 'Service Quality',            triggerPhrases: ['not working', 'still broken', 'came back', 'problem again', 'not fixed', 'came back already'] },
      { key: 'BILLING_DISPUTE',   label: 'Billing Dispute',            triggerPhrases: ['charged', 'overcharged', 'wrong charge', 'bill', 'invoice', 'refund', 'not what I was quoted'] },
      { key: 'TECHNICIAN',        label: 'Technician Issue',           triggerPhrases: ['technician', 'tech', 'guy who came', 'your guy', 'your employee', 'the person'] }
    ]
  },
  {
    daType:     'GENERAL_INQUIRY',
    label:      'General Inquiries',
    daSubTypes: [
      { key: 'COMPANY_INFO',      label: 'About the Company',          triggerPhrases: ['who are you', 'about your company', 'tell me about', 'licensed', 'bonded', 'insured', 'years in business'] },
      { key: 'PROMOTIONS',        label: 'Promotions & Discounts',     triggerPhrases: ['discount', 'coupon', 'promo', 'deal', 'special offer', 'promotion', 'sale'] }
    ]
  },
  {
    daType:     'CANCELLATION',
    label:      'Cancellations & Reschedules',
    daSubTypes: [
      { key: 'CANCEL_APPT',       label: 'Cancel Appointment',         triggerPhrases: ['cancel', 'cancellation', 'need to cancel', 'want to cancel'] },
      { key: 'RESCHEDULE',        label: 'Reschedule Appointment',     triggerPhrases: ['reschedule', 'change my appointment', 'different time', 'move my appointment', 'different day'] }
    ]
  },
  {
    daType:     'REFERRAL',
    label:      'Referrals & Recommendations',
    daSubTypes: [
      { key: 'GAVE_REFERRAL',     label: 'Caller Was Referred',        triggerPhrases: ['my friend', 'they recommended', 'told me about you', 'referred by', 'gave me your number'] },
      { key: 'WANTS_REFERRAL',    label: 'Asking for Referral',        triggerPhrases: ['recommend', 'refer', 'know anyone', 'can you recommend'] }
    ]
  },
  {
    daType:     'EMERGENCY',
    label:      'Emergency Service',
    daSubTypes: [
      { key: 'AFTER_HOURS',       label: 'After Hours Emergency',      triggerPhrases: ['emergency', 'urgent', 'flooded', 'gas leak', 'no heat', 'no ac', 'no power', 'not working at all'] },
      { key: 'SAFETY_CONCERN',    label: 'Safety Concern',             triggerPhrases: ['dangerous', 'safety', 'unsafe', 'gas smell', 'burning smell', 'sparks', 'fire'] }
    ]
  },
  {
    daType:     'FOLLOW_UP',
    label:      'Follow-Up Calls',
    daSubTypes: [
      { key: 'CHECK_STATUS',      label: 'Checking Job Status',        triggerPhrases: ['status', 'update', 'when is', 'what time', 'still coming', 'on the way', 'running late'] },
      { key: 'CALL_BACK',         label: 'Requesting Callback',        triggerPhrases: ['call me back', 'have someone call', 'can someone call', 'return my call', 'callback'] }
    ]
  },
  {
    daType:     'UNKNOWN',
    label:      'Unclassified',
    daSubTypes: [
      { key: 'UNCLASSIFIED',      label: 'Unclassified Utterance',     triggerPhrases: [] }
    ]
  }
];

// ═══════════════════════════════════════════════════════════════════════════
// GET /:companyId/uap/arrays
// List all UAPArrays for this company.
// ═══════════════════════════════════════════════════════════════════════════
router.get('/:companyId/uap/arrays', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const arrays = await UAPArray.find({ companyId }).sort({ daType: 1 }).lean();
    return res.json({ success: true, arrays });
  } catch (err) {
    logger.error('[UAPArrays] GET arrays error', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load arrays' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /:companyId/uap/arrays/seed
// Seed standard arrays (idempotent — skips existing daTypes).
// Safe to call multiple times.
// ═══════════════════════════════════════════════════════════════════════════
router.post('/:companyId/uap/arrays/seed', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    let seeded = 0;
    let skipped = 0;

    for (const def of STANDARD_DA_TYPES) {
      const existing = await UAPArray.findOne({ companyId, daType: def.daType });
      if (existing) {
        skipped++;
        continue;
      }

      await UAPArray.create({
        companyId,
        daType:     def.daType,
        label:      def.label,
        isStandard: true,
        isActive:   true,
        daSubTypes: def.daSubTypes.map(st => ({
          key:                  st.key,
          label:                st.label,
          triggerPhrases:       st.triggerPhrases || [],
          attachedTo:           [],
          classificationStatus: 'AUTO_CONFIRMED',
          classificationScore:  null
        }))
      });
      seeded++;
    }

    logger.info('[UAPArrays] Seed complete', { companyId, seeded, skipped });
    return res.json({ success: true, seeded, skipped, total: STANDARD_DA_TYPES.length });
  } catch (err) {
    logger.error('[UAPArrays] Seed error', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Seed failed' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /:companyId/uap/arrays/:id
// Update array — add/remove trigger phrase, toggle active, update label.
//
// Body may include:
//   { isActive: bool }
//   { label: string }
//   { subTypeKey: string, addPhrase: string }
//   { subTypeKey: string, removePhrase: string }
// ═══════════════════════════════════════════════════════════════════════════
router.patch('/:companyId/uap/arrays/:id', async (req, res) => {
  const { companyId, id } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ success: false, error: 'Invalid array ID' });
  }

  const { isActive, label, subTypeKey, addPhrase, removePhrase } = req.body;

  try {
    const array = await UAPArray.findOne({ _id: id, companyId });
    if (!array) {
      return res.status(404).json({ success: false, error: 'Array not found' });
    }

    // Toggle active
    if (isActive !== undefined) array.isActive = Boolean(isActive);

    // Rename array label
    if (label !== undefined && typeof label === 'string') array.label = label.trim();

    // Trigger phrase operations on a specific sub-type
    if (subTypeKey) {
      const st = array.daSubTypes.find(s => s.key === subTypeKey);
      if (!st) {
        return res.status(404).json({ success: false, error: `Sub-type '${subTypeKey}' not found` });
      }

      if (addPhrase && typeof addPhrase === 'string') {
        const phrase = addPhrase.trim().toLowerCase();
        if (phrase && !st.triggerPhrases.includes(phrase)) {
          st.triggerPhrases.push(phrase);
        }
      }

      if (removePhrase && typeof removePhrase === 'string') {
        const phrase = removePhrase.trim().toLowerCase();
        st.triggerPhrases = st.triggerPhrases.filter(p => p !== phrase);
      }
    }

    await array.save();
    logger.info('[UAPArrays] Array updated', { companyId, id, subTypeKey });
    return res.json({ success: true, array });
  } catch (err) {
    logger.error('[UAPArrays] PATCH array error', { companyId, id, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to update array' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /:companyId/uap/pending
// Sub-types with classificationStatus = PENDING (need owner review).
// Used for the Pending tab badge count and table.
// ═══════════════════════════════════════════════════════════════════════════
router.get('/:companyId/uap/pending', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const arrays = await UAPArray.find({ companyId, isActive: true }).lean();

    const pending = [];
    for (const arr of arrays) {
      for (const st of arr.daSubTypes || []) {
        if (st.classificationStatus === 'PENDING') {
          pending.push({
            arrayId:              arr._id,
            daType:               arr.daType,
            daTypeLabel:          arr.label,
            subTypeKey:           st.key,
            subTypeLabel:         st.label,
            classificationScore:  st.classificationScore,
            attachedTo:           st.attachedTo || []
          });
        }
      }
    }

    return res.json({ success: true, pending, count: pending.length });
  } catch (err) {
    logger.error('[UAPArrays] GET pending error', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load pending' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /:companyId/uap/pending/:arrayId/:subTypeKey
// Manual override for a pending classification.
// Body: { status: 'AUTO_CONFIRMED' | 'MANUAL', daType?: string }
// ═══════════════════════════════════════════════════════════════════════════
router.patch('/:companyId/uap/pending/:arrayId/:subTypeKey', async (req, res) => {
  const { companyId, arrayId, subTypeKey } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  if (!mongoose.Types.ObjectId.isValid(arrayId)) {
    return res.status(400).json({ success: false, error: 'Invalid array ID' });
  }

  const { status } = req.body;
  const allowed = ['AUTO_CONFIRMED', 'MANUAL'];
  if (!status || !allowed.includes(status)) {
    return res.status(400).json({ success: false, error: `status must be one of: ${allowed.join(', ')}` });
  }

  try {
    const result = await UAPArray.updateOne(
      { _id: arrayId, companyId, 'daSubTypes.key': subTypeKey },
      { $set: { 'daSubTypes.$.classificationStatus': status } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Sub-type not found' });
    }

    logger.info('[UAPArrays] Pending override', { companyId, arrayId, subTypeKey, status });
    return res.json({ success: true, subTypeKey, status });
  } catch (err) {
    logger.error('[UAPArrays] PATCH pending error', { companyId, arrayId, subTypeKey, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to update classification' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /:companyId/uap/booking-fields
// Load bookingFieldConfig (same source as Discovery Notes settings).
// ═══════════════════════════════════════════════════════════════════════════
router.get('/:companyId/uap/booking-fields', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const company = await Company.findOne(
      { _id: companyId },
      { 'agentSettings.discoverySettings': 1 }
    ).lean();

    if (!company) {
      return res.status(404).json({ success: false, error: 'Company not found' });
    }

    const bookingFieldConfig =
      company?.agentSettings?.discoverySettings?.bookingFieldConfig || {};

    return res.json({ success: true, bookingFieldConfig });
  } catch (err) {
    logger.error('[UAPArrays] GET booking-fields error', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load booking fields' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /:companyId/uap/booking-fields
// Save bookingFieldConfig (same target as Discovery Notes settings).
// Body: { bookingFieldConfig: { service_call: [...], maintenance: [...], ... } }
// ═══════════════════════════════════════════════════════════════════════════
router.patch('/:companyId/uap/booking-fields', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const { bookingFieldConfig } = req.body;

  if (bookingFieldConfig === undefined) {
    return res.status(400).json({ success: false, error: 'bookingFieldConfig is required' });
  }

  if (typeof bookingFieldConfig !== 'object' || Array.isArray(bookingFieldConfig)) {
    return res.status(400).json({ success: false, error: 'bookingFieldConfig must be an object' });
  }

  try {
    const result = await Company.updateOne(
      { _id: companyId },
      { $set: { 'agentSettings.discoverySettings.bookingFieldConfig': bookingFieldConfig } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Company not found' });
    }

    logger.info('[UAPArrays] bookingFieldConfig saved via UAP route', { companyId });
    return res.json({ success: true, bookingFieldConfig });
  } catch (err) {
    logger.error('[UAPArrays] PATCH booking-fields error', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to save booking fields' });
  }
});

module.exports = router;
