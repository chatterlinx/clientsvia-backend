'use strict';

/**
 * ============================================================================
 * TRANSFER DESTINATION MODEL
 * ============================================================================
 *
 * Represents a single transfer target in a company's routing directory.
 * Each destination is a rich, independently-configurable routing object:
 * an employee (agent), a department, or an external number.
 *
 * ARCHITECTURE — WHERE THIS FITS:
 *
 *   Call arrives → AI receptionist runs KC/arbitration pipeline
 *     → Caller says "transfer me to sales" / "speak to someone"
 *     → KCTransferIntentDetector fires (GATE 0.5)
 *     → TransferPolicy is loaded (company-level defaults)
 *     → TransferDestination is matched by name/department/type
 *     → Availability check runs (company schedule + destination override)
 *     → Available  → warm/cold transfer with AI context packet
 *     → Unavailable → overflow action (voicemail/forward/message+hangup)
 *
 * DESTINATION TYPES:
 *   agent      — An individual employee (John Smith, Sales Rep)
 *   department — A team/group (Sales, Service, Billing, Dispatch)
 *   external   — An outside number (answering service, on-call mobile)
 *
 * SCHEDULE HIERARCHY (5 levels, same pattern as Genesys/RingCentral):
 *   1. Emergency override (TransferPolicy) — overrides everything
 *   2. Company schedule (TransferPolicy)   — base business hours
 *   3. Department override                 — per-dept hours (agent inherits)
 *   4. Agent override                      — per-agent custom hours
 *   5. Holiday calendar (TransferPolicy)   — named date overrides
 *
 * OVERFLOW CHAIN:
 *   Each destination independently configures what happens when it is
 *   unavailable: voicemail, forward to another destination or number,
 *   or play a message and hang up.
 *
 * NOTIFICATIONS:
 *   Per-destination, per-event (missed call, voicemail) configuration.
 *   Notifications go to the destination's own contact methods OR to a
 *   supervisor/owner override address — independently configured.
 *
 * TRANSFER CONTEXT PACKET:
 *   On warm transfer, the AI can pre-brief the receiving agent with a
 *   spoken summary of what the caller wants + the full discoveryNotes
 *   object built turn-by-turn. This is the competitive differentiator vs
 *   dumb phone systems that blind-transfer with zero context.
 *
 * CALLER ACCESS CONTROL:
 *   blockTelemarketers — AI-flagged spam/telemarketer calls never reach
 *   this destination; they route to the telemarketer policy instead.
 *   vipOnly — only callers on the TransferPolicy.callerScreening.vipList
 *   can reach this destination directly.
 *
 * CALENDAR INTEGRATION (future-ready):
 *   calendarUrl + calendarProvider fields are stored now so the UI can
 *   expose them early. The booking engine will check availability against
 *   the linked calendar when the feature is built.
 *
 * MULTI-TENANT RULES:
 *   - Every document is scoped to a single companyId.
 *   - All queries must include { companyId } filter.
 *   - callerAccess.vipList/blocklist are NEVER shared across tenants.
 *   - No defaults can silently mask missing config — surface gaps to UI.
 *
 * REDIS CACHE:
 *   Runtime reads: key = transfer-destinations:{companyId}  TTL = 10 min
 *   Invalidated on every CREATE / UPDATE / DELETE / enable-toggle.
 *
 * STATS:
 *   transferCount and lastTransferAt are fire-and-forget via $inc/$set.
 *   Never read at call time — admin analytics only.
 *
 * ============================================================================
 */

const mongoose = require('mongoose');

// ── Day-of-week hours sub-schema ──────────────────────────────────────────────
// Reused in both TransferDestination (per-agent override) and TransferPolicy
// (company master schedule). Keeping it here as a shared definition.

const dayHoursSchema = new mongoose.Schema(
  {
    enabled: {
      type:    Boolean,
      default: false,
      comment: 'true = this day is a working day; false = closed/unavailable'
    },
    open: {
      type:    String,
      default: '08:00',
      match:   /^\d{2}:\d{2}$/,
      comment: 'Opening time in HH:MM (24h). Only meaningful when enabled=true.'
    },
    close: {
      type:    String,
      default: '17:00',
      match:   /^\d{2}:\d{2}$/,
      comment: 'Closing time in HH:MM (24h). Only meaningful when enabled=true.'
    }
  },
  { _id: false }
);

// ── Weekly schedule sub-schema ────────────────────────────────────────────────

const weeklyScheduleSchema = new mongoose.Schema(
  {
    mon: { type: dayHoursSchema, default: () => ({ enabled: true,  open: '08:00', close: '17:00' }) },
    tue: { type: dayHoursSchema, default: () => ({ enabled: true,  open: '08:00', close: '17:00' }) },
    wed: { type: dayHoursSchema, default: () => ({ enabled: true,  open: '08:00', close: '17:00' }) },
    thu: { type: dayHoursSchema, default: () => ({ enabled: true,  open: '08:00', close: '17:00' }) },
    fri: { type: dayHoursSchema, default: () => ({ enabled: true,  open: '08:00', close: '17:00' }) },
    sat: { type: dayHoursSchema, default: () => ({ enabled: false, open: '09:00', close: '14:00' }) },
    sun: { type: dayHoursSchema, default: () => ({ enabled: false, open: '09:00', close: '14:00' }) }
  },
  { _id: false }
);

// ── Destination schedule sub-schema ──────────────────────────────────────────

const destinationScheduleSchema = new mongoose.Schema(
  {
    followCompany: {
      type:    Boolean,
      default: true,
      comment: 'When true, this destination uses the company master schedule. Override fields are ignored.'
    },
    timezone: {
      type:    String,
      default: '',
      trim:    true,
      comment: 'IANA timezone string (e.g. "America/New_York"). Empty = inherit from TransferPolicy.'
    },
    weekly: {
      type:    weeklyScheduleSchema,
      default: () => ({}),
      comment: 'Custom weekly hours. Only used when followCompany=false.'
    }
  },
  { _id: false }
);

// ── Overflow sub-schema ───────────────────────────────────────────────────────

const overflowSchema = new mongoose.Schema(
  {
    action: {
      type:    String,
      enum:    ['voicemail', 'forward_number', 'forward_destination', 'message_hangup'],
      default: 'voicemail',
      comment: [
        'voicemail           — Record a voicemail (destination-level box).',
        'forward_number      — Immediately bridge to forwardToNumber (E164).',
        'forward_destination — Bridge to another TransferDestination by ID.',
        'message_hangup      — Play hangupMessage TTS and end the call.'
      ].join(' ')
    },
    forwardToNumber: {
      type:    String,
      trim:    true,
      default: '',
      comment: 'E164 phone number. Used when action = forward_number.'
    },
    forwardToDestinationId: {
      type:    String,
      trim:    true,
      default: '',
      comment: 'TransferDestination._id. Used when action = forward_destination.'
    },
    forwardToDestinationName: {
      type:    String,
      trim:    true,
      default: '',
      comment: 'Denormalised display name for the forward destination. UI reference only.'
    },
    hangupMessage: {
      type:      String,
      trim:      true,
      default:   '',
      maxlength: 500,
      comment:   'Spoken message when action = message_hangup. TTS-rendered at call time.'
    },
    voicemailGreeting: {
      type:      String,
      trim:      true,
      default:   '',
      maxlength: 300,
      comment:   'Custom voicemail greeting. Empty = company default greeting.'
    },
    voicemailTranscription: {
      type:    Boolean,
      default: true,
      comment: 'Whether to AI-transcribe voicemail audio and attach transcript to notifications.'
    },
    voicemailRetentionDays: {
      type:    Number,
      default: 90,
      min:     1,
      comment: 'Days to retain voicemail audio. After retention period, audio is purged.'
    }
  },
  { _id: false }
);

// ── Per-event notification target sub-schema ──────────────────────────────────

const notifyTargetSchema = new mongoose.Schema(
  {
    smsEnabled: {
      type:    Boolean,
      default: false,
      comment: 'Send SMS notification on this event.'
    },
    smsTo: {
      type:    String,
      trim:    true,
      default: '',
      comment: 'E164 number to receive SMS. Defaults to destination phoneNumber if empty.'
    },
    emailEnabled: {
      type:    Boolean,
      default: false,
      comment: 'Send email notification on this event.'
    },
    emailTo: {
      type:    String,
      trim:    true,
      default: '',
      comment: 'Email address to receive notification. Defaults to destination email if empty.'
    },
    includeTranscript: {
      type:    Boolean,
      default: true,
      comment: 'Include AI voicemail transcript in the email body. Only relevant for onVoicemail.'
    }
  },
  { _id: false }
);

// ── Notifications sub-schema ──────────────────────────────────────────────────

const notificationsSchema = new mongoose.Schema(
  {
    onMissedCall: {
      type:    notifyTargetSchema,
      default: () => ({ smsEnabled: false, emailEnabled: false, includeTranscript: false }),
      comment: 'Notification fired when a transfer to this destination is missed (no answer, busy, or declined).'
    },
    onVoicemail: {
      type:    notifyTargetSchema,
      default: () => ({ smsEnabled: true, emailEnabled: true, includeTranscript: true }),
      comment: 'Notification fired when a caller leaves a voicemail at this destination.'
    },
    onTransferRequest: {
      type:    notifyTargetSchema,
      default: () => ({ smsEnabled: false, emailEnabled: false, includeTranscript: false }),
      comment: 'Notification fired when AI routes a caller toward this destination (pre-transfer, fire-and-forget).'
    }
  },
  { _id: false }
);

// ── Transfer context packet sub-schema ───────────────────────────────────────

const transferContextSchema = new mongoose.Schema(
  {
    mode: {
      type:    String,
      enum:    ['warm', 'cold'],
      default: 'warm',
      comment: [
        'warm — AI pre-briefs the agent with a spoken summary before connecting caller.',
        'cold — Blind transfer: caller is bridged directly, no pre-brief.'
      ].join(' ')
    },
    sendCallerSummary: {
      type:    Boolean,
      default: true,
      comment: 'When warm: AI announces caller name + reason for calling to the receiving agent.'
    },
    includeDiscoveryNotes: {
      type:    Boolean,
      default: true,
      comment: 'When warm: full discoveryNotes object is injected into the pre-brief spoken to agent.'
    },
    summaryTemplate: {
      type:      String,
      trim:      true,
      default:   '',
      maxlength: 400,
      comment:   'Custom pre-brief template. Variables: {callerName}, {callReason}, {urgency}. Empty = AI-generated.'
    }
  },
  { _id: false }
);

// ── Caller access sub-schema ──────────────────────────────────────────────────

const callerAccessSchema = new mongoose.Schema(
  {
    allowAll: {
      type:    Boolean,
      default: true,
      comment: 'When true, any non-blocked caller can reach this destination.'
    },
    vipOnly: {
      type:    Boolean,
      default: false,
      comment: 'When true, only callers on TransferPolicy.callerScreening.vipList can reach this destination.'
    },
    blockTelemarketers: {
      type:    Boolean,
      default: true,
      comment: 'When true, AI-flagged telemarketer calls are routed to the telemarketer policy instead of here.'
    },
    requireScreening: {
      type:    Boolean,
      default: false,
      comment: 'When true, unknown callers must announce their name before the call is connected to this destination.'
    }
  },
  { _id: false }
);

// ── Stats sub-schema ──────────────────────────────────────────────────────────

const statsSchema = new mongoose.Schema(
  {
    transferCount: {
      type:    Number,
      default: 0,
      comment: 'Total successful transfers to this destination. Incremented via $inc, never decremented.'
    },
    missedCount: {
      type:    Number,
      default: 0,
      comment: 'Total missed transfers (no answer / overflow triggered). Incremented fire-and-forget.'
    },
    voicemailCount: {
      type:    Number,
      default: 0,
      comment: 'Total voicemails received at this destination.'
    },
    lastTransferAt: {
      type:    Date,
      default: null,
      comment: 'Timestamp of the most recent successful transfer.'
    }
  },
  { _id: false }
);

// ── Calendar integration sub-schema (future-ready) ───────────────────────────

const calendarIntegrationSchema = new mongoose.Schema(
  {
    provider: {
      type:    String,
      enum:    ['', 'google', 'outlook', 'calendly', 'custom'],
      default: '',
      comment: 'Calendar system linked to this destination for appointment availability.'
    },
    calendarUrl: {
      type:    String,
      trim:    true,
      default: '',
      comment: 'Public availability URL (e.g. Calendly booking link, Google Calendar appointment URL).'
    },
    calendarId: {
      type:    String,
      trim:    true,
      default: '',
      comment: 'Internal calendar ID for API-based availability checks (future OAuth integration).'
    },
    allowSelfService: {
      type:    Boolean,
      default: false,
      comment: 'When true, AI can offer caller a booking slot directly from this calendar during the call.'
    }
  },
  { _id: false }
);

// ══════════════════════════════════════════════════════════════════════════════
// MAIN SCHEMA
// ══════════════════════════════════════════════════════════════════════════════

const transferDestinationSchema = new mongoose.Schema(
  {
    // ─────────────────────────────────────────────────────────────────────────
    // IDENTITY & TENANT ISOLATION
    // ─────────────────────────────────────────────────────────────────────────
    companyId: {
      type:     String,
      required: true,
      trim:     true,
      index:    true,
      comment:  'Tenant isolator — ALL queries must include this field. Never query across tenants.'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // DISPLAY & TYPE
    // ─────────────────────────────────────────────────────────────────────────
    name: {
      type:      String,
      required:  true,
      trim:      true,
      maxlength: 100,
      comment:   'Display name — spoken in warm transfer pre-brief. E.g. "John Smith", "Sales Department".'
    },

    type: {
      type:    String,
      enum:    ['agent', 'department', 'external'],
      default: 'agent',
      comment: [
        'agent      — Individual employee (has title, belongs to a department).',
        'department — Team/group (can have member agents).',
        'external   — Outside number (answering service, on-call, vendor).'
      ].join(' ')
    },

    title: {
      type:      String,
      trim:      true,
      default:   '',
      maxlength: 80,
      comment:   'Job title or role. E.g. "Service Technician", "Sales Manager". Used in warm pre-brief.'
    },

    // Department linkage — agent belongs to a department (denormalised for perf)
    departmentId: {
      type:    String,
      trim:    true,
      default: '',
      comment: 'TransferDestination._id of the parent department. Only set on type=agent.'
    },

    departmentName: {
      type:    String,
      trim:    true,
      default: '',
      comment: 'Denormalised department name for display. Kept in sync with the department destination name.'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // CONTACT
    // ─────────────────────────────────────────────────────────────────────────
    phoneNumber: {
      type:    String,
      trim:    true,
      default: '',
      comment: 'E164 phone number to dial for this destination. E.g. "+17145551234".'
    },

    email: {
      type:    String,
      trim:    true,
      default: '',
      comment: 'Email address. Used as default notification target if notification.emailTo is blank.'
    },

    extension: {
      type:    String,
      trim:    true,
      default: '',
      comment: 'Internal extension (for VOIP systems that support * or # extension dialling).'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // STATE & ORDERING
    // ─────────────────────────────────────────────────────────────────────────
    enabled: {
      type:    Boolean,
      default: true,
      comment: 'Master toggle. false = destination is skipped during routing (not deleted).'
    },

    priority: {
      type:    Number,
      default: 100,
      min:     1,
      comment: 'Sort order within type — lower number = preferred. Used for round-robin fallback ordering.'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // AVAILABILITY — 5-LEVEL SCHEDULE HIERARCHY
    // Level 1 (highest): TransferPolicy.emergencyOverride
    // Level 2:           TransferPolicy.schedule (company master)
    // Level 3:           Department schedule (if type=agent, parent dept hours)
    // Level 4:           This document's schedule (followCompany=false)
    // Level 5 (lowest):  TransferPolicy.schedule.holidays (date overrides)
    // ─────────────────────────────────────────────────────────────────────────
    schedule: {
      type:    destinationScheduleSchema,
      default: () => ({ followCompany: true }),
      comment: 'Availability schedule. followCompany=true = use TransferPolicy master schedule.'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // OVERFLOW — WHEN UNAVAILABLE
    // ─────────────────────────────────────────────────────────────────────────
    overflow: {
      type:    overflowSchema,
      default: () => ({ action: 'voicemail' }),
      comment: 'What to do when this destination is unavailable (after-hours, no-answer, busy).'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // NOTIFICATIONS
    // ─────────────────────────────────────────────────────────────────────────
    notifications: {
      type:    notificationsSchema,
      default: () => ({}),
      comment: 'Per-event notification config. Each event independently configures SMS + email targets.'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // TRANSFER CONTEXT PACKET
    // The AI's competitive advantage — context delivered to human agent on transfer.
    // ─────────────────────────────────────────────────────────────────────────
    transferContext: {
      type:    transferContextSchema,
      default: () => ({ mode: 'warm', sendCallerSummary: true, includeDiscoveryNotes: true }),
      comment: 'How the AI packages call context when transferring to this destination.'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // CALLER ACCESS CONTROL
    // ─────────────────────────────────────────────────────────────────────────
    callerAccess: {
      type:    callerAccessSchema,
      default: () => ({ allowAll: true, blockTelemarketers: true }),
      comment: 'Who is allowed to reach this destination. Telemarketer blocking is on by default.'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // CALENDAR INTEGRATION (FUTURE-READY)
    // Fields stored now, feature implemented when calendar OAuth is built.
    // ─────────────────────────────────────────────────────────────────────────
    calendar: {
      type:    calendarIntegrationSchema,
      default: () => ({}),
      comment: 'Optional calendar integration for appointment booking (Calendly, Google, Outlook).'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // INTERNAL NOTES
    // ─────────────────────────────────────────────────────────────────────────
    internalNotes: {
      type:      String,
      trim:      true,
      default:   '',
      maxlength: 500,
      comment:   'Admin-only notes. Never surfaced to callers or spoken by AI.'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // STATS — fire-and-forget analytics, never read at call time
    // ─────────────────────────────────────────────────────────────────────────
    stats: {
      type:    statsSchema,
      default: () => ({}),
      comment: 'Usage counters. Updated via $inc/$set after transfer events.'
    }
  },
  {
    timestamps:  true,
    collection:  'transferDestinations',   // explicit — never rely on mongoose plural inference
    versionKey:  false
  }
);

// ══════════════════════════════════════════════════════════════════════════════
// INDEXES
// ══════════════════════════════════════════════════════════════════════════════

// Primary runtime query: all enabled destinations for a company, ordered
transferDestinationSchema.index({ companyId: 1, enabled: 1, priority: 1 });

// Admin listing: all destinations for a company (includes disabled)
transferDestinationSchema.index({ companyId: 1, type: 1, priority: 1 });

// Department → agents lookup (find all agents in a department)
transferDestinationSchema.index({ companyId: 1, departmentId: 1 });

// ══════════════════════════════════════════════════════════════════════════════
// PRE-SAVE HOOK — PHONE NORMALISATION + TENANT SAFETY
// ══════════════════════════════════════════════════════════════════════════════

transferDestinationSchema.pre('save', function (next) {
  // Ensure companyId is always a string
  if (this.companyId && typeof this.companyId !== 'string') {
    this.companyId = this.companyId.toString();
  }

  // Strip whitespace from phone number
  if (this.phoneNumber) {
    this.phoneNumber = this.phoneNumber.replace(/\s/g, '');
  }

  // Agents without a phoneNumber inherit the department number at runtime.
  // This hook does not auto-populate — the API layer handles that.

  next();
});

// ══════════════════════════════════════════════════════════════════════════════
// STATIC HELPERS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * findActiveForCompany — All enabled destinations, sorted by type then priority.
 * Used at runtime by KCTransferIntentDetector to build the routing directory.
 *
 * @param {string} companyId
 * @returns {Promise<Array>}
 */
transferDestinationSchema.statics.findActiveForCompany = function (companyId) {
  return this.find({ companyId, enabled: true })
    .sort({ type: 1, priority: 1, createdAt: 1 })
    .lean();
};

/**
 * findDepartments — All department-type destinations (enabled only).
 * Used to populate the department selector in the UI and for overflow chaining.
 *
 * @param {string} companyId
 * @returns {Promise<Array>}
 */
transferDestinationSchema.statics.findDepartments = function (companyId) {
  return this.find({ companyId, type: 'department', enabled: true })
    .sort({ priority: 1 })
    .lean();
};

/**
 * findAgentsInDepartment — All agents belonging to a specific department.
 *
 * @param {string} companyId
 * @param {string} departmentId — TransferDestination._id of the parent department
 * @returns {Promise<Array>}
 */
transferDestinationSchema.statics.findAgentsInDepartment = function (companyId, departmentId) {
  return this.find({ companyId, departmentId, type: 'agent', enabled: true })
    .sort({ priority: 1 })
    .lean();
};

module.exports = mongoose.model(
  'TransferDestination',
  transferDestinationSchema,
  'transferDestinations'
);
