/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VENDOR CALL MODEL
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Part of: Call Center Module V2
 * Created: December 2, 2025
 * 
 * PURPOSE:
 * ─────────────────────────────────────────────────────────────────────────────
 * Track calls FROM vendors, linked to orders/jobs/customers.
 * 
 * Examples:
 * - "The motor for Mrs. Johnson is ready for pickup"
 *   → Links to: Vendor (Johnstone Supply), Customer (Mrs. Johnson), Order (#12345)
 * 
 * - "Your order is backordered, need 2 more days"
 *   → Links to: Vendor (XYZ Parts), Order (#67890), Action needed
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

const mongoose = require('mongoose');
const logger = require('../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════
// CALL REASON TYPES
// ═══════════════════════════════════════════════════════════════════════════

const CALL_REASONS = {
  // Order-related
  ORDER_READY: 'order_ready',           // "Your order is ready for pickup"
  ORDER_SHIPPED: 'order_shipped',       // "Your order has shipped"
  ORDER_DELIVERED: 'order_delivered',   // "Package delivered"
  ORDER_BACKORDERED: 'order_backordered', // "Item is backordered"
  ORDER_CANCELLED: 'order_cancelled',   // "Item discontinued/unavailable"
  ORDER_PRICING: 'order_pricing',       // "Price update/quote"
  
  // Delivery-related
  DELIVERY_ATTEMPT: 'delivery_attempt', // "No one at location"
  DELIVERY_SCHEDULE: 'delivery_schedule', // "Scheduling delivery"
  DELIVERY_SIGNATURE: 'delivery_signature', // "Need signature"
  
  // Account-related
  ACCOUNT_INVOICE: 'account_invoice',   // "Invoice reminder"
  ACCOUNT_CREDIT: 'account_credit',     // "Credit approved/denied"
  ACCOUNT_STATEMENT: 'account_statement', // "Monthly statement"
  
  // General
  GENERAL_INQUIRY: 'general_inquiry',
  CALLBACK_REQUEST: 'callback_request',
  OTHER: 'other'
};

const URGENCY_LEVELS = {
  LOW: 'low',           // Informational
  NORMAL: 'normal',     // Standard follow-up
  HIGH: 'high',         // Needs attention today
  URGENT: 'urgent'      // Immediate action required
};

const ACTION_STATUS = {
  PENDING: 'pending',       // Needs action
  IN_PROGRESS: 'in_progress', // Being handled
  COMPLETED: 'completed',   // Done
  CANCELLED: 'cancelled'    // No longer needed
};

// ═══════════════════════════════════════════════════════════════════════════
// SCHEMA
// ═══════════════════════════════════════════════════════════════════════════

const VendorCallSchema = new mongoose.Schema({
  
  // ─────────────────────────────────────────────────────────────────────────
  // IDENTITY
  // ─────────────────────────────────────────────────────────────────────────
  
  companyId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'v2Company', 
    required: true,
    index: true 
  },
  
  /**
   * Unique call ID
   */
  callId: { 
    type: String, 
    unique: true,
    required: true
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // VENDOR INFORMATION
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Reference to the vendor
   */
  vendorId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Vendor',
    index: true
  },
  
  /**
   * Vendor name (denormalized for quick display)
   */
  vendorName: { 
    type: String,
    required: true
  },
  
  /**
   * Phone number the call came from
   */
  phone: { 
    type: String,
    required: true,
    index: true
  },
  
  /**
   * Name of person who called (from vendor)
   */
  callerName: { 
    type: String,
    maxLength: 100
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // CALL DETAILS
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * When the call came in
   */
  calledAt: { 
    type: Date,
    required: true,
    default: Date.now,
    index: true
  },
  
  /**
   * Reason for the call
   */
  reason: { 
    type: String,
    enum: Object.values(CALL_REASONS),
    default: CALL_REASONS.OTHER
  },
  
  /**
   * Urgency level
   */
  urgency: { 
    type: String,
    enum: Object.values(URGENCY_LEVELS),
    default: URGENCY_LEVELS.NORMAL,
    index: true
  },
  
  /**
   * Summary of the call
   */
  summary: { 
    type: String,
    maxLength: 1000,
    required: true
  },
  
  /**
   * Full notes/transcript
   */
  notes: { 
    type: String,
    maxLength: 5000
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // LINKED ENTITIES
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Related order/PO number
   */
  orderNumber: { 
    type: String,
    maxLength: 50,
    index: true
  },
  
  /**
   * Related customer (if call is about a customer's order)
   */
  relatedCustomerId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Customer'
  },
  
  /**
   * Customer name (denormalized)
   */
  relatedCustomerName: { 
    type: String,
    maxLength: 100
  },
  
  /**
   * Related appointment/job (if applicable)
   */
  relatedAppointmentId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Appointment'
  },
  
  /**
   * Tracking number (for deliveries)
   */
  trackingNumber: { 
    type: String,
    maxLength: 100
  },
  
  /**
   * Invoice number (for billing calls)
   */
  invoiceNumber: { 
    type: String,
    maxLength: 50
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // ACTION TRACKING
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * What action is needed
   */
  actionRequired: { 
    type: String,
    maxLength: 500
  },
  
  /**
   * Action status
   */
  actionStatus: { 
    type: String,
    enum: Object.values(ACTION_STATUS),
    default: ACTION_STATUS.PENDING,
    index: true
  },
  
  /**
   * Who is assigned to handle this
   */
  assignedTo: { 
    type: String,
    maxLength: 100
  },
  
  /**
   * When action was completed
   */
  completedAt: { 
    type: Date
  },
  
  /**
   * Completion notes
   */
  completionNotes: { 
    type: String,
    maxLength: 500
  },
  
  /**
   * Who took this call
   */
  handledBy: { 
    type: String,
    maxLength: 100
  }
  
}, {
  timestamps: true,
  collection: 'vendor_calls'
});

// ═══════════════════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════════════════

VendorCallSchema.index({ companyId: 1, calledAt: -1 }, { name: 'idx_company_recent' });
VendorCallSchema.index({ companyId: 1, vendorId: 1, calledAt: -1 }, { name: 'idx_company_vendor_calls' });
VendorCallSchema.index({ companyId: 1, actionStatus: 1, urgency: 1 }, { name: 'idx_pending_actions' });
VendorCallSchema.index({ companyId: 1, orderNumber: 1 }, { name: 'idx_by_order' });
VendorCallSchema.index({ companyId: 1, relatedCustomerId: 1 }, { name: 'idx_by_customer' });

// ═══════════════════════════════════════════════════════════════════════════
// STATIC METHODS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate unique call ID
 */
VendorCallSchema.statics.generateCallId = function() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `vcall_${timestamp}_${random}`;
};

/**
 * Create a new vendor call record
 */
VendorCallSchema.statics.createCall = async function(data) {
  if (!data.callId) {
    data.callId = this.generateCallId();
  }
  
  const call = await this.create(data);
  
  logger.info('[VENDOR_CALL] Created', {
    callId: call.callId,
    vendorName: call.vendorName,
    reason: call.reason,
    orderNumber: call.orderNumber
  });
  
  return call;
};

/**
 * Get pending actions for a company
 */
VendorCallSchema.statics.getPendingActions = async function(companyId, options = {}) {
  const { limit = 50, urgency } = options;
  
  const query = { 
    companyId, 
    actionStatus: { $in: [ACTION_STATUS.PENDING, ACTION_STATUS.IN_PROGRESS] }
  };
  
  if (urgency) {
    query.urgency = urgency;
  }
  
  return this.find(query)
    .sort({ urgency: -1, calledAt: -1 })
    .limit(limit)
    .lean();
};

/**
 * Get recent vendor calls
 */
VendorCallSchema.statics.getRecentCalls = async function(companyId, options = {}) {
  const { 
    page = 1, 
    limit = 50, 
    vendorId,
    reason,
    actionStatus
  } = options;
  
  const query = { companyId };
  
  if (vendorId) query.vendorId = vendorId;
  if (reason) query.reason = reason;
  if (actionStatus) query.actionStatus = actionStatus;
  
  const skip = (page - 1) * Math.min(limit, 100);
  const actualLimit = Math.min(limit, 100);
  
  const [calls, total] = await Promise.all([
    this.find(query)
      .sort({ calledAt: -1 })
      .skip(skip)
      .limit(actualLimit)
      .lean(),
    this.countDocuments(query)
  ]);
  
  return {
    calls,
    total,
    page,
    limit: actualLimit,
    pages: Math.ceil(total / actualLimit)
  };
};

/**
 * Mark action as completed
 */
VendorCallSchema.statics.completeAction = async function(callId, completionData) {
  const { completedBy, notes } = completionData;
  
  const call = await this.findOneAndUpdate(
    { callId },
    {
      $set: {
        actionStatus: ACTION_STATUS.COMPLETED,
        completedAt: new Date(),
        completionNotes: notes,
        handledBy: completedBy
      }
    },
    { new: true }
  );
  
  if (call) {
    logger.info('[VENDOR_CALL] Action completed', {
      callId,
      completedBy
    });
  }
  
  return call;
};

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

const VendorCall = mongoose.model('VendorCall', VendorCallSchema);

module.exports = VendorCall;
module.exports.CALL_REASONS = CALL_REASONS;
module.exports.URGENCY_LEVELS = URGENCY_LEVELS;
module.exports.ACTION_STATUS = ACTION_STATUS;

