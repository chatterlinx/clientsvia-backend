'use strict';

/**
 * ============================================================================
 * TRANSFER POLICY MODEL
 * ============================================================================
 *
 * Singleton document per company (unique on companyId). Stores company-wide
 * transfer routing defaults, the master business schedule, caller screening
 * lists, and the emergency override switch.
 *
 * ARCHITECTURE — RELATIONSHIP TO TransferDestination:
 *
 *   TransferPolicy  (1 per company)  ← company-wide defaults + master schedule
 *   TransferDestination  (N per company)  ← per-destination overrides
 *
 *   At runtime, the 5-level schedule hierarchy is resolved as:
 *     Level 1: this.emergencyOverride.active → override everything
 *     Level 2: this.schedule (company master hours + timezone)
 *     Level 3: destination.schedule.followCompany=false → use destination hours
 *     Level 4: this.schedule.holidays → named date overrides
 *     Result: available | unavailable → route or overflow
 *
 * COMPANY DIRECTORY PROTOCOL:
 *   directoryProtocol is the AI agent's standing instruction for handling
 *   transfer requests. It is injected into the system prompt when GATE 0.5
 *   fires — giving the AI explicit guidance on how to handle the moment
 *   a caller says "I'd like to speak with someone."
 *   Example: "When a caller requests a transfer, always ask for their name
 *   and the reason they're calling before initiating the transfer."
 *
 * CALLER SCREENING:
 *   Three-tier classification per incoming call:
 *     1. blocklist  → immediate rejection with configurable message
 *     2. vipList    → skip normal flow, route directly to preferred destination
 *     3. standard   → normal AI receptionist flow
 *   Each tier is a [String] array of E164 phone numbers.
 *
 * TELEMARKETER HANDLING:
 *   When AI flags a caller as a telemarketer (low confidence customer profile),
 *   the telemarketerPolicy determines what happens:
 *     block    → play blockedMessage and hang up immediately
 *     voicemail → route to a designated voicemail box for review
 *     message  → play telemarkerMessage and hang up gracefully
 *   telemarkerMessage should instruct them to remove the number from lists.
 *
 * EMERGENCY OVERRIDE:
 *   A single on/off switch that immediately reroutes ALL incoming calls
 *   regardless of schedule, destination, or overflow rules.
 *   Activated manually (UI toggle) or via API (future: webhook trigger).
 *   When active: every call receives emergencyOverride.message and is
 *   optionally forwarded to emergencyOverride.forwardTo (if set).
 *
 * ANNOUNCE TRANSFER:
 *   When enabled, the AI says a customisable announcement to the caller
 *   before bridging (e.g. "I'm transferring you to John in Sales now.
 *   Please hold for a moment."). This reduces caller hang-ups during
 *   the transfer gap.
 *
 * SINGLETON — ONE DOC PER COMPANY:
 *   getForCompany() upserts on first access so a document always exists.
 *   API PATCH routes use $set — never $replace — to support partial updates.
 *
 * MULTI-TENANT RULES:
 *   - companyId is unique-indexed. One doc per tenant.
 *   - vipList and blocklist are NEVER shared across tenants.
 *   - No defaults silently mask missing config — surface gaps to UI.
 *
 * REDIS CACHE:
 *   Runtime reads: key = transfer-policy:{companyId}  TTL = 10 min
 *   Invalidated on every PATCH via invalidateCache().
 *
 * ============================================================================
 */

const mongoose = require('mongoose');

// ── Day-of-week hours sub-schema (same definition as TransferDestination) ─────

const dayHoursSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    open:    { type: String,  default: '08:00', match: /^\d{2}:\d{2}$/ },
    close:   { type: String,  default: '17:00', match: /^\d{2}:\d{2}$/ }
  },
  { _id: false }
);

// ── Company master schedule sub-schema ────────────────────────────────────────

const companyScheduleSchema = new mongoose.Schema(
  {
    timezone: {
      type:    String,
      default: 'America/New_York',
      trim:    true,
      comment: 'IANA timezone string. All time comparisons at runtime use this timezone.'
    },
    weekly: {
      mon: { type: dayHoursSchema, default: () => ({ enabled: true,  open: '08:00', close: '17:00' }) },
      tue: { type: dayHoursSchema, default: () => ({ enabled: true,  open: '08:00', close: '17:00' }) },
      wed: { type: dayHoursSchema, default: () => ({ enabled: true,  open: '08:00', close: '17:00' }) },
      thu: { type: dayHoursSchema, default: () => ({ enabled: true,  open: '08:00', close: '17:00' }) },
      fri: { type: dayHoursSchema, default: () => ({ enabled: true,  open: '08:00', close: '17:00' }) },
      sat: { type: dayHoursSchema, default: () => ({ enabled: false, open: '09:00', close: '14:00' }) },
      sun: { type: dayHoursSchema, default: () => ({ enabled: false, open: '09:00', close: '14:00' }) }
    },
    holidays: {
      type:    [{
        _id:   false,
        date:  { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },  // YYYY-MM-DD
        name:  { type: String, trim: true, default: '' },
        type:  { type: String, enum: ['closed', 'custom'], default: 'closed' },  // custom = partial hours
        open:  { type: String, default: '08:00', match: /^\d{2}:\d{2}$/ },
        close: { type: String, default: '12:00', match: /^\d{2}:\d{2}$/ }
      }],
      default: [],
      comment: 'Named holiday overrides. type=closed means fully closed on that date. type=custom = partial-day hours.'
    }
  },
  { _id: false }
);

// ── Emergency override sub-schema ─────────────────────────────────────────────

const emergencyOverrideSchema = new mongoose.Schema(
  {
    active: {
      type:    Boolean,
      default: false,
      comment: 'Master emergency switch. When true, ALL calls bypass normal routing immediately.'
    },
    message: {
      type:      String,
      trim:      true,
      default:   'We are currently experiencing an emergency situation and are unable to take calls at this time. Please call back later or leave a voicemail.',
      maxlength: 500,
      comment:   'Spoken TTS message to every caller when emergency mode is active.'
    },
    forwardTo: {
      type:    String,
      trim:    true,
      default: '',
      comment: 'E164 number to forward all calls to during emergency. Empty = voicemail only.'
    },
    activatedAt: {
      type:    Date,
      default: null,
      comment: 'When the emergency override was last activated. Informational — not used in routing logic.'
    },
    activatedBy: {
      type:    String,
      trim:    true,
      default: '',
      comment: 'User who activated the override. Informational audit trail.'
    }
  },
  { _id: false }
);

// ── Caller screening sub-schema ───────────────────────────────────────────────

const callerScreeningSchema = new mongoose.Schema(
  {
    vipList: {
      type:    [String],
      default: [],
      comment: 'E164 phone numbers of VIP callers. Skips normal flow; routes to preferred destination directly.'
    },
    blocklist: {
      type:    [String],
      default: [],
      comment: 'E164 phone numbers that are permanently blocked. Call is rejected with blockedMessage.'
    },
    blockedMessage: {
      type:      String,
      trim:      true,
      default:   'We are unable to accept calls from this number.',
      maxlength: 300,
      comment:   'TTS message spoken when a blocked number calls.'
    },
    blockAnonymous: {
      type:    Boolean,
      default: false,
      comment: 'When true, callers with withheld/anonymous caller ID receive blockedMessage.'
    },
    telemarkerAction: {
      type:    String,
      enum:    ['block', 'voicemail', 'message'],
      default: 'message',
      comment: [
        'block    — Hang up immediately (no message).',
        'voicemail — Route to telemarketer voicemail box for review.',
        'message  — Play telemarkerMessage and hang up gracefully.'
      ].join(' ')
    },
    telemarkerMessage: {
      type:      String,
      trim:      true,
      default:   'This number is registered on the Do Not Call list. Please remove it from your calling list immediately. Thank you.',
      maxlength: 400,
      comment:   'Message played to telemarketer callers when action = message.'
    },
    telemarkerVoicemailDestinationId: {
      type:    String,
      trim:    true,
      default: '',
      comment: 'TransferDestination._id to receive telemarketer voicemails. Only used when action = voicemail.'
    }
  },
  { _id: false }
);

// ── Transfer announcement sub-schema ─────────────────────────────────────────

const transferAnnouncementSchema = new mongoose.Schema(
  {
    enabled: {
      type:    Boolean,
      default: true,
      comment: 'When true, AI announces the transfer to caller before bridging.'
    },
    template: {
      type:      String,
      trim:      true,
      default:   "I'm going to connect you with {name} now. Please hold for just a moment.",
      maxlength: 300,
      comment:   'Spoken announcement template. Variables: {name}, {department}, {title}. Rendered at call time.'
    }
  },
  { _id: false }
);

// ── Built-in defaults ─────────────────────────────────────────────────────────

const BUILT_IN_DEFAULTS = {
  directoryProtocol:    'When a caller asks to speak with someone, confirm their name and reason for calling before transferring.',
  defaultTransferMode:  'warm',
  defaultOverflowAction: 'voicemail',
  defaultOverflowMessage: 'I\'m sorry, no one is available to take your call right now. Please leave a message and we\'ll get back to you as soon as possible.',
  sendCallerSummaryDefault:     true,
  includeDiscoveryNotesDefault: true,
  announceTransfer: {
    enabled:  true,
    template: "I'm going to connect you with {name} now. Please hold for just a moment."
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// MAIN SCHEMA
// ══════════════════════════════════════════════════════════════════════════════

const transferPolicySchema = new mongoose.Schema(
  {
    // ─────────────────────────────────────────────────────────────────────────
    // IDENTITY & TENANT ISOLATION
    // ─────────────────────────────────────────────────────────────────────────
    companyId: {
      type:     String,
      required: true,
      unique:   true,   // one policy doc per company — enforced at DB level
      trim:     true,
      index:    true,
      comment:  'Tenant isolator — unique per company. Never query across tenants.'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // DIRECTORY PROTOCOL
    // Injected into AI system prompt when GATE 0.5 fires (transfer intent detected).
    // ─────────────────────────────────────────────────────────────────────────
    directoryProtocol: {
      type:      String,
      trim:      true,
      default:   BUILT_IN_DEFAULTS.directoryProtocol,
      maxlength: 600,
      comment:   'AI standing instruction for handling transfer requests. Injected into system prompt at GATE 0.5.'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // EMERGENCY OVERRIDE — highest priority, overrides everything
    // ─────────────────────────────────────────────────────────────────────────
    emergencyOverride: {
      type:    emergencyOverrideSchema,
      default: () => ({}),
      comment: 'When active, ALL incoming calls receive the emergency message immediately.'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // COMPANY MASTER SCHEDULE (level 2 in hierarchy)
    // ─────────────────────────────────────────────────────────────────────────
    schedule: {
      type:    companyScheduleSchema,
      default: () => ({}),
      comment: 'Master business hours. Destinations with followCompany=true inherit these hours.'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // TRANSFER DEFAULTS
    // Applied to any destination that does not override these values.
    // ─────────────────────────────────────────────────────────────────────────
    defaultTransferMode: {
      type:    String,
      enum:    ['warm', 'cold'],
      default: BUILT_IN_DEFAULTS.defaultTransferMode,
      comment: 'Default transfer mode applied when a destination does not specify its own mode.'
    },

    defaultOverflowAction: {
      type:    String,
      enum:    ['voicemail', 'message_hangup'],
      default: BUILT_IN_DEFAULTS.defaultOverflowAction,
      comment: 'Company-wide default when a destination is unavailable and has no overflow rule configured.'
    },

    defaultOverflowMessage: {
      type:      String,
      trim:      true,
      default:   BUILT_IN_DEFAULTS.defaultOverflowMessage,
      maxlength: 400,
      comment:   'Spoken message when defaultOverflowAction = message_hangup and destination has no custom message.'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // AI CONTEXT DEFAULTS
    // ─────────────────────────────────────────────────────────────────────────
    sendCallerSummaryDefault: {
      type:    Boolean,
      default: BUILT_IN_DEFAULTS.sendCallerSummaryDefault,
      comment: 'Company-wide default: send AI-generated caller summary to agent on warm transfer.'
    },

    includeDiscoveryNotesDefault: {
      type:    Boolean,
      default: BUILT_IN_DEFAULTS.includeDiscoveryNotesDefault,
      comment: 'Company-wide default: include full discoveryNotes object in warm transfer pre-brief.'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // TRANSFER ANNOUNCEMENT TO CALLER
    // ─────────────────────────────────────────────────────────────────────────
    announceTransfer: {
      type:    transferAnnouncementSchema,
      default: () => ({ ...BUILT_IN_DEFAULTS.announceTransfer }),
      comment: 'AI announces the transfer to caller before bridging. Reduces hang-ups during transfer gap.'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // CALLER SCREENING
    // ─────────────────────────────────────────────────────────────────────────
    callerScreening: {
      type:    callerScreeningSchema,
      default: () => ({}),
      comment: 'VIP list, blocklist, and telemarketer handling policy.'
    }
  },
  {
    timestamps:  true,
    collection:  'transferPolicies',   // explicit — never rely on mongoose plural inference
    versionKey:  false
  }
);

// ══════════════════════════════════════════════════════════════════════════════
// INDEXES
// ══════════════════════════════════════════════════════════════════════════════

transferPolicySchema.index({ companyId: 1 }, { unique: true });

// ══════════════════════════════════════════════════════════════════════════════
// STATIC HELPERS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * getForCompany — Load the transfer policy for a company.
 * If no document exists, one is created with built-in defaults via upsert.
 * Returns a plain lean object — safe to cache and pass across modules.
 *
 * @param {string} companyId
 * @returns {Promise<Object>}
 */
transferPolicySchema.statics.getForCompany = async function (companyId) {
  const doc = await this.findOneAndUpdate(
    { companyId },
    { $setOnInsert: { companyId } },
    { upsert: true, new: true, lean: true, setDefaultsOnInsert: true }
  );
  return doc;
};

/**
 * getDefaults — Plain object with all built-in defaults.
 * Used by admin UI to pre-fill blank policy forms and by tests.
 *
 * @returns {Object}
 */
transferPolicySchema.statics.getDefaults = function () {
  return { ...BUILT_IN_DEFAULTS };
};

transferPolicySchema.statics.BUILT_IN_DEFAULTS = BUILT_IN_DEFAULTS;

module.exports = mongoose.model(
  'TransferPolicy',
  transferPolicySchema,
  'transferPolicies'
);
