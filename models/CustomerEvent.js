/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CUSTOMER EVENT MODEL (Append-Only History)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Part of: Call Center Module V2
 * Created: December 1, 2025
 * Proposal: PROPOSAL-CALL-CENTER-MODULE-V2.md
 * 
 * PURPOSE:
 * ─────────────────────────────────────────────────────────────────────────────
 * This collection stores ALL customer history as immutable events.
 * It replaces embedded arrays in the Customer document (V1 design flaw).
 * 
 * WHY EVENT SOURCING:
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Customer documents stay lean (< 4KB)
 * 2. No MongoDB 16MB document limit issues
 * 3. Complete audit trail of all changes
 * 4. Can reconstruct customer state at any point in time
 * 5. Scales infinitely (append-only is horizontal-scale friendly)
 * 
 * EVENT TYPES:
 * ─────────────────────────────────────────────────────────────────────────────
 * - call_started, call_completed, call_transferred, call_abandoned
 * - appointment_booked, appointment_completed, appointment_cancelled, etc.
 * - note_added, note_updated
 * - address_added, address_updated
 * - equipment_added, equipment_serviced
 * - status_changed, customer_merged
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

const mongoose = require('mongoose');
const logger = require('../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════
// EVENT TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

const EVENT_TYPES = {
  // Call events
  CALL_STARTED: 'call_started',
  CALL_COMPLETED: 'call_completed',
  CALL_TRANSFERRED: 'call_transferred',
  CALL_ABANDONED: 'call_abandoned',
  CALL_VOICEMAIL: 'call_voicemail',
  
  // Appointment events
  APPOINTMENT_BOOKED: 'appointment_booked',
  APPOINTMENT_CONFIRMED: 'appointment_confirmed',
  APPOINTMENT_COMPLETED: 'appointment_completed',
  APPOINTMENT_CANCELLED: 'appointment_cancelled',
  APPOINTMENT_RESCHEDULED: 'appointment_rescheduled',
  APPOINTMENT_NO_SHOW: 'appointment_no_show',
  
  // Customer profile events
  CUSTOMER_CREATED: 'customer_created',
  CUSTOMER_UPDATED: 'customer_updated',
  CUSTOMER_MERGED: 'customer_merged',
  STATUS_CHANGED: 'status_changed',
  
  // Note events
  NOTE_ADDED: 'note_added',
  NOTE_UPDATED: 'note_updated',
  NOTE_DELETED: 'note_deleted',
  
  // Address events
  ADDRESS_ADDED: 'address_added',
  ADDRESS_UPDATED: 'address_updated',
  ADDRESS_REMOVED: 'address_removed',
  
  // Equipment events
  EQUIPMENT_ADDED: 'equipment_added',
  EQUIPMENT_UPDATED: 'equipment_updated',
  EQUIPMENT_SERVICED: 'equipment_serviced',
  EQUIPMENT_REMOVED: 'equipment_removed',
  
  // Billing events
  INVOICE_CREATED: 'invoice_created',
  INVOICE_SENT: 'invoice_sent',
  PAYMENT_RECEIVED: 'payment_received',
  PAYMENT_FAILED: 'payment_failed',
  
  // Communication events
  SMS_SENT: 'sms_sent',
  EMAIL_SENT: 'email_sent',
  
  // Compliance events
  CONSENT_UPDATED: 'consent_updated',
  DATA_EXPORTED: 'data_exported',
  DATA_DELETION_REQUESTED: 'data_deletion_requested'
};

// ═══════════════════════════════════════════════════════════════════════════
// SCHEMA DEFINITION
// ═══════════════════════════════════════════════════════════════════════════

const CustomerEventSchema = new mongoose.Schema({
  
  // ─────────────────────────────────────────────────────────────────────────
  // IDENTITY (Multi-tenant required)
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Company this event belongs to
   * REQUIRED for multi-tenant isolation
   */
  companyId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'v2Company', 
    required: [true, 'companyId is required for multi-tenant isolation'],
    index: true 
  },
  
  /**
   * Customer this event belongs to
   */
  customerId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Customer', 
    required: [true, 'customerId is required'],
    index: true 
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // EVENT TYPE
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Type of event
   * See EVENT_TYPES constant for all options
   */
  type: { 
    type: String, 
    required: [true, 'event type is required'],
    enum: {
      values: Object.values(EVENT_TYPES),
      message: '{VALUE} is not a valid event type'
    },
    index: true
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // EVENT DATA (Varies by type)
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Event-specific data payload
   * Structure varies based on event type
   * 
   * Examples:
   * - call_completed: { callId, duration, outcome, primaryIntent }
   * - appointment_booked: { appointmentId, date, service, technician }
   * - note_added: { text, category }
   * - address_added: { street, city, state, zip, type, accessNotes }
   * - equipment_added: { type, brand, model, serialNumber }
   * - status_changed: { from, to, reason }
   */
  data: {
    type: mongoose.Schema.Types.Mixed,
    required: [true, 'event data is required']
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // REFERENCES (Optional links to related documents)
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Reference to related call (if applicable)
   */
  callId: { 
    type: String,
    index: true,
    sparse: true
  },
  
  /**
   * Reference to related appointment (if applicable)
   */
  appointmentId: { 
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Appointment',
    index: true,
    sparse: true
  },
  
  /**
   * Reference to related invoice (if applicable)
   */
  invoiceId: { 
    type: mongoose.Schema.Types.ObjectId,
    sparse: true
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // METADATA
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Who created this event
   * Can be:
   * - 'system' for automated events
   * - User ID for manual actions
   * - 'ai_agent' for AI-initiated events
   */
  createdBy: { 
    type: String,
    required: true,
    default: 'system'
  },
  
  /**
   * User-friendly description (optional)
   */
  description: {
    type: String,
    maxLength: 500
  },
  
  /**
   * Event timestamp
   * IMMUTABLE - cannot be changed after creation
   */
  createdAt: { 
    type: Date, 
    default: Date.now, 
    immutable: true,
    index: true
  }
  
}, { 
  timestamps: false,  // We manage createdAt ourselves (immutable)
  collection: 'customer_events',
  
  // Disable updates - events are APPEND-ONLY
  strict: true
});


// ═══════════════════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Primary query: Get customer's event history (most recent first)
 */
CustomerEventSchema.index(
  { companyId: 1, customerId: 1, createdAt: -1 },
  { name: 'idx_customer_history' }
);

/**
 * Filter by event type
 */
CustomerEventSchema.index(
  { companyId: 1, customerId: 1, type: 1, createdAt: -1 },
  { name: 'idx_customer_type_history' }
);

/**
 * Find all events for a call
 */
CustomerEventSchema.index(
  { companyId: 1, callId: 1 },
  { sparse: true, name: 'idx_call_events' }
);

/**
 * Find all events for an appointment
 */
CustomerEventSchema.index(
  { companyId: 1, appointmentId: 1 },
  { sparse: true, name: 'idx_appointment_events' }
);

/**
 * Recent events across all customers (for activity feeds)
 */
CustomerEventSchema.index(
  { companyId: 1, createdAt: -1 },
  { name: 'idx_company_recent_events' }
);

/**
 * Type-based queries across company (for analytics)
 */
CustomerEventSchema.index(
  { companyId: 1, type: 1, createdAt: -1 },
  { name: 'idx_company_type_events' }
);


// ═══════════════════════════════════════════════════════════════════════════
// STATIC METHODS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Log a new event
 * This is the primary way to create events
 * 
 * @param {Object} params - Event parameters
 * @param {ObjectId} params.companyId - Company ID
 * @param {ObjectId} params.customerId - Customer ID
 * @param {string} params.type - Event type (from EVENT_TYPES)
 * @param {Object} params.data - Event data payload
 * @param {string} [params.callId] - Optional call reference
 * @param {ObjectId} [params.appointmentId] - Optional appointment reference
 * @param {string} [params.createdBy] - Who created the event
 * @param {string} [params.description] - Human-readable description
 * @returns {Promise<CustomerEvent>}
 */
CustomerEventSchema.statics.logEvent = async function({
  companyId,
  customerId,
  type,
  data,
  callId = null,
  appointmentId = null,
  invoiceId = null,
  createdBy = 'system',
  description = null
}) {
  // Validate required fields
  if (!companyId) throw new Error('companyId is required');
  if (!customerId) throw new Error('customerId is required');
  if (!type) throw new Error('type is required');
  if (!data) throw new Error('data is required');
  
  // Validate event type
  if (!Object.values(EVENT_TYPES).includes(type)) {
    throw new Error(`Invalid event type: ${type}`);
  }
  
  const event = await this.create({
    companyId,
    customerId,
    type,
    data,
    callId,
    appointmentId,
    invoiceId,
    createdBy,
    description
  });
  
  logger.info('[CUSTOMER_EVENT] Event logged', {
    eventId: event._id,
    companyId: companyId.toString(),
    customerId: customerId.toString(),
    type,
    callId,
    appointmentId: appointmentId?.toString()
  });
  
  return event;
};

/**
 * Get customer's event history
 * 
 * @param {ObjectId} companyId - Company ID
 * @param {ObjectId} customerId - Customer ID
 * @param {Object} [options] - Query options
 * @param {string[]} [options.types] - Filter by event types
 * @param {number} [options.limit] - Max events to return (default 100)
 * @param {number} [options.skip] - Skip N events (for pagination)
 * @param {Date} [options.since] - Only events after this date
 * @param {Date} [options.until] - Only events before this date
 * @returns {Promise<CustomerEvent[]>}
 */
CustomerEventSchema.statics.getHistory = async function(companyId, customerId, options = {}) {
  const {
    types = null,
    limit = 100,
    skip = 0,
    since = null,
    until = null
  } = options;
  
  const query = { companyId, customerId };
  
  // Filter by types
  if (types && types.length > 0) {
    query.type = { $in: types };
  }
  
  // Filter by date range
  if (since || until) {
    query.createdAt = {};
    if (since) query.createdAt.$gte = since;
    if (until) query.createdAt.$lte = until;
  }
  
  const events = await this.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(Math.min(limit, 500))  // Max 500 per request
    .lean();
  
  return events;
};

/**
 * Get all notes for a customer
 * Convenience method for the common "show notes" use case
 * 
 * @param {ObjectId} companyId - Company ID
 * @param {ObjectId} customerId - Customer ID
 * @returns {Promise<Object[]>} - Array of note data
 */
CustomerEventSchema.statics.getNotes = async function(companyId, customerId) {
  const events = await this.find({
    companyId,
    customerId,
    type: { $in: [EVENT_TYPES.NOTE_ADDED, EVENT_TYPES.NOTE_UPDATED] }
  })
    .sort({ createdAt: -1 })
    .lean();
  
  return events.map(e => ({
    eventId: e._id,
    text: e.data.text,
    category: e.data.category,
    createdBy: e.createdBy,
    createdAt: e.createdAt,
    isUpdate: e.type === EVENT_TYPES.NOTE_UPDATED
  }));
};

/**
 * Get all addresses for a customer
 * Reconstructs current address list from events
 * 
 * @param {ObjectId} companyId - Company ID
 * @param {ObjectId} customerId - Customer ID
 * @returns {Promise<Object[]>} - Array of addresses
 */
CustomerEventSchema.statics.getAddresses = async function(companyId, customerId) {
  const events = await this.find({
    companyId,
    customerId,
    type: { $in: [EVENT_TYPES.ADDRESS_ADDED, EVENT_TYPES.ADDRESS_UPDATED, EVENT_TYPES.ADDRESS_REMOVED] }
  })
    .sort({ createdAt: 1 })  // Oldest first to replay
    .lean();
  
  // Replay events to get current state
  const addressMap = new Map();
  
  for (const event of events) {
    const addressId = event.data.addressId || event._id.toString();
    
    if (event.type === EVENT_TYPES.ADDRESS_REMOVED) {
      addressMap.delete(addressId);
    } else {
      addressMap.set(addressId, {
        addressId,
        ...event.data,
        lastUpdated: event.createdAt
      });
    }
  }
  
  return Array.from(addressMap.values());
};

/**
 * Get all equipment for a customer
 * Reconstructs current equipment list from events
 * 
 * @param {ObjectId} companyId - Company ID
 * @param {ObjectId} customerId - Customer ID
 * @returns {Promise<Object[]>} - Array of equipment
 */
CustomerEventSchema.statics.getEquipment = async function(companyId, customerId) {
  const events = await this.find({
    companyId,
    customerId,
    type: { $in: [
      EVENT_TYPES.EQUIPMENT_ADDED, 
      EVENT_TYPES.EQUIPMENT_UPDATED, 
      EVENT_TYPES.EQUIPMENT_SERVICED,
      EVENT_TYPES.EQUIPMENT_REMOVED
    ] }
  })
    .sort({ createdAt: 1 })
    .lean();
  
  const equipmentMap = new Map();
  
  for (const event of events) {
    const equipmentId = event.data.equipmentId || event._id.toString();
    
    if (event.type === EVENT_TYPES.EQUIPMENT_REMOVED) {
      equipmentMap.delete(equipmentId);
    } else {
      const existing = equipmentMap.get(equipmentId) || {};
      equipmentMap.set(equipmentId, {
        ...existing,
        equipmentId,
        ...event.data,
        lastServiceDate: event.type === EVENT_TYPES.EQUIPMENT_SERVICED 
          ? event.createdAt 
          : existing.lastServiceDate,
        lastUpdated: event.createdAt
      });
    }
  }
  
  return Array.from(equipmentMap.values());
};

/**
 * Get call history for a customer
 * 
 * @param {ObjectId} companyId - Company ID
 * @param {ObjectId} customerId - Customer ID
 * @param {number} [limit] - Max calls to return
 * @returns {Promise<Object[]>} - Array of call summaries
 */
CustomerEventSchema.statics.getCallHistory = async function(companyId, customerId, limit = 50) {
  const events = await this.find({
    companyId,
    customerId,
    type: EVENT_TYPES.CALL_COMPLETED
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  
  return events.map(e => ({
    callId: e.callId,
    ...e.data,
    completedAt: e.createdAt
  }));
};

/**
 * Get appointment history for a customer
 * 
 * @param {ObjectId} companyId - Company ID
 * @param {ObjectId} customerId - Customer ID
 * @param {number} [limit] - Max appointments to return
 * @returns {Promise<Object[]>} - Array of appointment events
 */
CustomerEventSchema.statics.getAppointmentHistory = async function(companyId, customerId, limit = 50) {
  const events = await this.find({
    companyId,
    customerId,
    type: { $in: [
      EVENT_TYPES.APPOINTMENT_BOOKED,
      EVENT_TYPES.APPOINTMENT_CONFIRMED,
      EVENT_TYPES.APPOINTMENT_COMPLETED,
      EVENT_TYPES.APPOINTMENT_CANCELLED,
      EVENT_TYPES.APPOINTMENT_RESCHEDULED,
      EVENT_TYPES.APPOINTMENT_NO_SHOW
    ] }
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  
  return events.map(e => ({
    appointmentId: e.appointmentId,
    eventType: e.type,
    ...e.data,
    eventAt: e.createdAt
  }));
};

/**
 * Count events by type for a customer (for stats)
 * 
 * @param {ObjectId} companyId - Company ID
 * @param {ObjectId} customerId - Customer ID
 * @returns {Promise<Object>} - Event counts by type
 */
CustomerEventSchema.statics.getEventCounts = async function(companyId, customerId) {
  const counts = await this.aggregate([
    { $match: { companyId: new mongoose.Types.ObjectId(companyId), customerId: new mongoose.Types.ObjectId(customerId) } },
    { $group: { _id: '$type', count: { $sum: 1 } } }
  ]);
  
  const result = {};
  for (const { _id, count } of counts) {
    result[_id] = count;
  }
  
  return result;
};


// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE - Prevent Updates and Deletes
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Prevent updates - events are immutable
 */
CustomerEventSchema.pre('updateOne', function(next) {
  const error = new Error('CustomerEvent documents are immutable and cannot be updated');
  logger.error('[CUSTOMER_EVENT] Attempted to update immutable event');
  next(error);
});

CustomerEventSchema.pre('updateMany', function(next) {
  const error = new Error('CustomerEvent documents are immutable and cannot be updated');
  logger.error('[CUSTOMER_EVENT] Attempted to update immutable events');
  next(error);
});

CustomerEventSchema.pre('findOneAndUpdate', function(next) {
  const error = new Error('CustomerEvent documents are immutable and cannot be updated');
  logger.error('[CUSTOMER_EVENT] Attempted to update immutable event');
  next(error);
});

/**
 * Note: We allow deletes for GDPR compliance (right to be forgotten)
 * but this should only be done through the official data deletion endpoint
 */


// ═══════════════════════════════════════════════════════════════════════════
// MODEL EXPORT
// ═══════════════════════════════════════════════════════════════════════════

const CustomerEvent = mongoose.model('CustomerEvent', CustomerEventSchema);

// Export both the model and the event types
module.exports = CustomerEvent;
module.exports.EVENT_TYPES = EVENT_TYPES;

