/**
 * ═══════════════════════════════════════════════════════════════════════════
 * COMPLIANCE SERVICE
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Part of: Call Center Module V2
 * Created: December 1, 2025
 * Proposal: PROPOSAL-CALL-CENTER-MODULE-V2.md
 * 
 * PURPOSE:
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles all compliance-related operations for GDPR, CCPA, and SOC2.
 * 
 * FEATURES:
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Recording Consent - Track and enforce recording consent
 * 2. Data Retention - Automatic purging of old data
 * 3. Customer Merge - Combine duplicate customer records
 * 4. Data Export - GDPR "right to access" / CCPA requests
 * 5. Data Deletion - GDPR "right to be forgotten"
 * 
 * LEGAL REQUIREMENTS:
 * ─────────────────────────────────────────────────────────────────────────────
 * - GDPR: Right to access, right to erasure, data portability
 * - CCPA: Right to know, right to delete, right to opt-out
 * - SOC2: Audit trails, access controls, data retention
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

const Customer = require('../models/Customer');
const CustomerEvent = require('../models/CustomerEvent');
const CallSummary = require('../models/CallSummary');
const CallTranscript = require('../models/CallTranscript');
const AuditLog = require('../models/AuditLog');
const mongoose = require('mongoose');
const logger = require('../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // Two-party consent states (require explicit consent)
  TWO_PARTY_CONSENT_STATES: [
    'CA', 'CT', 'FL', 'IL', 'MD', 'MA', 'MI', 'MT', 'NH', 'PA', 'WA'
  ],
  
  // Default data retention periods (days)
  DEFAULT_RETENTION: {
    calls: 365 * 2,        // 2 years
    transcripts: 365,       // 1 year
    recordings: 90,         // 90 days
    customers: 365 * 7,     // 7 years (for tax/legal)
    auditLogs: 365 * 7      // 7 years
  },
  
  // Export formats
  EXPORT_FORMATS: ['json', 'csv'],
  
  // Batch sizes
  BATCH_SIZE: 100
};

// ═══════════════════════════════════════════════════════════════════════════
// RECORDING CONSENT
// ═══════════════════════════════════════════════════════════════════════════

class ComplianceService {
  
  /**
   * Check if recording consent is required based on state
   * 
   * @param {string} state - US state code
   * @returns {Object} - Consent requirements
   */
  static getConsentRequirements(state) {
    if (!state) {
      return {
        required: true,
        type: 'one-party',
        message: 'State unknown - defaulting to one-party consent',
        explicitConsentNeeded: false
      };
    }
    
    const normalizedState = state.toUpperCase().trim();
    const isTwoParty = CONFIG.TWO_PARTY_CONSENT_STATES.includes(normalizedState);
    
    return {
      required: true,
      type: isTwoParty ? 'two-party' : 'one-party',
      state: normalizedState,
      explicitConsentNeeded: isTwoParty,
      message: isTwoParty 
        ? `${normalizedState} requires two-party consent - explicit consent needed`
        : `${normalizedState} allows one-party consent - announcement sufficient`
    };
  }
  
  /**
   * Record consent for a call
   * 
   * @param {string} callId - Call ID
   * @param {Object} consentData - Consent information
   */
  static async recordConsent(callId, consentData) {
    const {
      consentType,      // 'explicit' | 'implied' | 'denied' | 'unknown'
      callerState,
      consentTimestamp,
      method,           // 'verbal' | 'keypress' | 'announcement'
      agentId
    } = consentData;
    
    const call = await CallSummary.findOneAndUpdate(
      { callId },
      {
        $set: {
          'consent.recordingConsent': consentType,
          'consent.callerState': callerState,
          'consent.consentTimestamp': consentTimestamp || new Date(),
          'consent.consentMethod': method,
          'consent.recordedBy': agentId || 'system'
        }
      },
      { new: true }
    );
    
    if (!call) {
      throw new Error(`Call not found: ${callId}`);
    }
    
    // Log to audit
    await AuditLog.create({
      companyId: call.companyId,
      actionType: 'CONSENT_UPDATED',
      entityType: 'CallSummary',
      entityId: call._id,
      actor: {
        type: agentId ? 'user' : 'system',
        id: agentId
      },
      details: {
        callId,
        consentType,
        callerState,
        method
      }
    });
    
    logger.info('[COMPLIANCE] Consent recorded', {
      callId,
      consentType,
      callerState
    });
    
    return call;
  }
  
  /**
   * Check if a call can be recorded based on consent status
   * 
   * @param {string} callId - Call ID
   * @returns {Object} - Recording permission status
   */
  static async canRecord(callId) {
    const call = await CallSummary.findOne({ callId }).select('consent').lean();
    
    if (!call) {
      return {
        allowed: false,
        reason: 'Call not found'
      };
    }
    
    const consent = call.consent || {};
    
    // If in two-party state, need explicit consent
    if (CONFIG.TWO_PARTY_CONSENT_STATES.includes(consent.callerState)) {
      if (consent.recordingConsent === 'explicit') {
        return { allowed: true, reason: 'Explicit consent given' };
      }
      if (consent.recordingConsent === 'denied') {
        return { allowed: false, reason: 'Consent denied by caller' };
      }
      return { allowed: false, reason: 'Two-party state - explicit consent required' };
    }
    
    // One-party states - announcement is sufficient
    if (consent.recordingConsent === 'denied') {
      return { allowed: false, reason: 'Consent denied by caller' };
    }
    
    return { allowed: true, reason: 'One-party consent state' };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // DATA EXPORT (GDPR/CCPA)
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Export all data for a customer (GDPR Article 20 - Right to Data Portability)
   * 
   * @param {string} companyId - Company ID
   * @param {string} customerId - Customer ID
   * @param {string} format - Export format ('json' or 'csv')
   * @param {string} requestedBy - Who requested the export
   * @returns {Promise<Object>} - Exported data
   */
  static async exportCustomerData(companyId, customerId, format = 'json', requestedBy = 'system') {
    logger.info('[COMPLIANCE] Starting data export', { companyId, customerId, format });
    
    const startTime = Date.now();
    
    // Get customer
    const customer = await Customer.findOne({ 
      _id: customerId, 
      companyId 
    }).lean();
    
    if (!customer) {
      throw new Error('Customer not found');
    }
    
    // Get all customer events
    const events = await CustomerEvent.find({ 
      customerId, 
      companyId 
    }).sort({ timestamp: -1 }).lean();
    
    // Get all calls
    const calls = await CallSummary.find({ 
      customerId, 
      companyId 
    }).sort({ startedAt: -1 }).lean();
    
    // Get transcripts for calls
    const callIds = calls.map(c => c._id);
    const transcripts = await CallTranscript.find({ 
      callId: { $in: callIds } 
    }).lean();
    
    // Build export data
    const exportData = {
      exportMetadata: {
        exportDate: new Date().toISOString(),
        exportedBy: requestedBy,
        companyId,
        customerId,
        format,
        dataCategories: ['profile', 'calls', 'transcripts', 'events']
      },
      customer: {
        ...customer,
        // Remove internal fields
        __v: undefined,
        companyId: undefined
      },
      calls: calls.map(c => ({
        ...c,
        __v: undefined,
        companyId: undefined
      })),
      transcripts: transcripts.map(t => ({
        callId: t.callId,
        turns: t.turns,
        createdAt: t.createdAt
      })),
      events: events.map(e => ({
        type: e.type,
        timestamp: e.timestamp,
        data: e.data
      }))
    };
    
    // Log to audit
    await AuditLog.create({
      companyId,
      actionType: 'DATA_EXPORTED',
      entityType: 'Customer',
      entityId: customerId,
      actor: {
        type: requestedBy === 'system' ? 'system' : 'user',
        email: requestedBy
      },
      details: {
        format,
        recordsExported: {
          calls: calls.length,
          transcripts: transcripts.length,
          events: events.length
        },
        exportDuration: Date.now() - startTime
      }
    });
    
    logger.info('[COMPLIANCE] Data export complete', {
      customerId,
      calls: calls.length,
      duration: Date.now() - startTime
    });
    
    // Format based on request
    if (format === 'csv') {
      return this._convertToCSV(exportData);
    }
    
    return exportData;
  }
  
  /**
   * Convert export data to CSV format
   */
  static _convertToCSV(data) {
    const csvParts = [];
    
    // Customer CSV
    csvParts.push({
      filename: 'customer.csv',
      content: this._objectToCSV([data.customer])
    });
    
    // Calls CSV
    if (data.calls.length > 0) {
      csvParts.push({
        filename: 'calls.csv',
        content: this._objectToCSV(data.calls)
      });
    }
    
    // Events CSV
    if (data.events.length > 0) {
      csvParts.push({
        filename: 'events.csv',
        content: this._objectToCSV(data.events)
      });
    }
    
    return {
      format: 'csv',
      files: csvParts,
      metadata: data.exportMetadata
    };
  }
  
  /**
   * Convert array of objects to CSV string
   */
  static _objectToCSV(array) {
    if (array.length === 0) return '';
    
    const headers = Object.keys(array[0]).filter(k => !k.startsWith('_'));
    const rows = array.map(obj => 
      headers.map(h => {
        const val = obj[h];
        if (val === null || val === undefined) return '';
        if (typeof val === 'object') return JSON.stringify(val);
        return String(val).replace(/"/g, '""');
      }).map(v => `"${v}"`).join(',')
    );
    
    return [headers.join(','), ...rows].join('\n');
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // DATA DELETION (GDPR Right to Erasure)
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Delete all data for a customer (GDPR Article 17 - Right to Erasure)
   * 
   * @param {string} companyId - Company ID
   * @param {string} customerId - Customer ID
   * @param {string} requestedBy - Who requested the deletion
   * @param {string} reason - Reason for deletion
   * @returns {Promise<Object>} - Deletion summary
   */
  static async deleteCustomerData(companyId, customerId, requestedBy, reason = 'GDPR request') {
    logger.info('[COMPLIANCE] Starting data deletion', { companyId, customerId, reason });
    
    const startTime = Date.now();
    const deletionSummary = {
      customerId,
      deletedAt: new Date(),
      requestedBy,
      reason,
      recordsDeleted: {}
    };
    
    // Start transaction
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      // Get customer first
      const customer = await Customer.findOne({ _id: customerId, companyId }).session(session);
      if (!customer) {
        throw new Error('Customer not found');
      }
      
      // Delete transcripts
      const calls = await CallSummary.find({ customerId, companyId }).select('_id').session(session);
      const callIds = calls.map(c => c._id);
      
      const transcriptsDeleted = await CallTranscript.deleteMany({ 
        callId: { $in: callIds } 
      }).session(session);
      deletionSummary.recordsDeleted.transcripts = transcriptsDeleted.deletedCount;
      
      // Delete calls
      const callsDeleted = await CallSummary.deleteMany({ 
        customerId, 
        companyId 
      }).session(session);
      deletionSummary.recordsDeleted.calls = callsDeleted.deletedCount;
      
      // Delete events
      const eventsDeleted = await CustomerEvent.deleteMany({ 
        customerId, 
        companyId 
      }).session(session);
      deletionSummary.recordsDeleted.events = eventsDeleted.deletedCount;
      
      // Anonymize customer (don't fully delete - keep for audit trail)
      await Customer.findByIdAndUpdate(customerId, {
        $set: {
          fullName: '[DELETED]',
          firstName: '[DELETED]',
          lastName: '[DELETED]',
          email: `deleted-${customerId}@deleted.local`,
          phone: '+10000000000',
          secondaryPhones: [],
          addresses: [],
          preferences: {},
          tags: [],
          status: 'deleted',
          deletedAt: new Date(),
          deletedBy: requestedBy,
          deletionReason: reason
        }
      }).session(session);
      deletionSummary.recordsDeleted.customer = 1;
      
      // Commit transaction
      await session.commitTransaction();
      
      // Log to audit (outside transaction)
      await AuditLog.create({
        companyId,
        actionType: 'DATA_PURGED',
        entityType: 'Customer',
        entityId: customerId,
        actor: {
          type: requestedBy === 'system' ? 'system' : 'user',
          email: requestedBy
        },
        details: {
          reason,
          recordsDeleted: deletionSummary.recordsDeleted,
          deletionDuration: Date.now() - startTime
        }
      });
      
      logger.info('[COMPLIANCE] Data deletion complete', {
        customerId,
        recordsDeleted: deletionSummary.recordsDeleted,
        duration: Date.now() - startTime
      });
      
      return deletionSummary;
      
    } catch (error) {
      await session.abortTransaction();
      logger.error('[COMPLIANCE] Data deletion failed', {
        error: error.message,
        customerId
      });
      throw error;
    } finally {
      session.endSession();
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // CUSTOMER MERGE
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Merge two customer records (when duplicates are found)
   * 
   * @param {string} companyId - Company ID
   * @param {string} primaryCustomerId - Customer to keep
   * @param {string} secondaryCustomerId - Customer to merge into primary
   * @param {string} mergedBy - Who performed the merge
   * @returns {Promise<Object>} - Merge summary
   */
  static async mergeCustomers(companyId, primaryCustomerId, secondaryCustomerId, mergedBy) {
    logger.info('[COMPLIANCE] Starting customer merge', {
      companyId,
      primary: primaryCustomerId,
      secondary: secondaryCustomerId
    });
    
    const startTime = Date.now();
    
    // Validate both customers exist and belong to company
    const [primaryCustomer, secondaryCustomer] = await Promise.all([
      Customer.findOne({ _id: primaryCustomerId, companyId }),
      Customer.findOne({ _id: secondaryCustomerId, companyId })
    ]);
    
    if (!primaryCustomer) {
      throw new Error('Primary customer not found');
    }
    if (!secondaryCustomer) {
      throw new Error('Secondary customer not found');
    }
    
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      // Update all calls to point to primary customer
      const callsUpdated = await CallSummary.updateMany(
        { customerId: secondaryCustomerId, companyId },
        { $set: { customerId: primaryCustomerId } }
      ).session(session);
      
      // Update all events to point to primary customer
      const eventsUpdated = await CustomerEvent.updateMany(
        { customerId: secondaryCustomerId, companyId },
        { $set: { customerId: primaryCustomerId } }
      ).session(session);
      
      // Merge secondary phone numbers
      const mergedPhones = [
        ...new Set([
          primaryCustomer.phone,
          secondaryCustomer.phone,
          ...(primaryCustomer.secondaryPhones || []),
          ...(secondaryCustomer.secondaryPhones || [])
        ])
      ].filter(p => p && p !== primaryCustomer.phone);
      
      // Merge tags
      const mergedTags = [
        ...new Set([
          ...(primaryCustomer.tags || []),
          ...(secondaryCustomer.tags || [])
        ])
      ];
      
      // Update primary customer with merged data
      const mergeData = {
        secondaryPhones: mergedPhones,
        tags: mergedTags,
        totalCalls: (primaryCustomer.totalCalls || 0) + (secondaryCustomer.totalCalls || 0),
        totalAppointments: (primaryCustomer.totalAppointments || 0) + (secondaryCustomer.totalAppointments || 0),
        lifetimeValue: (primaryCustomer.lifetimeValue || 0) + (secondaryCustomer.lifetimeValue || 0)
      };
      
      // Prefer non-null values from primary, fall back to secondary
      if (!primaryCustomer.fullName && secondaryCustomer.fullName) {
        mergeData.fullName = secondaryCustomer.fullName;
        mergeData.firstName = secondaryCustomer.firstName;
        mergeData.lastName = secondaryCustomer.lastName;
      }
      if (!primaryCustomer.email && secondaryCustomer.email) {
        mergeData.email = secondaryCustomer.email;
      }
      if (!primaryCustomer.primaryAddress && secondaryCustomer.primaryAddress) {
        mergeData.primaryAddress = secondaryCustomer.primaryAddress;
      }
      
      await Customer.findByIdAndUpdate(
        primaryCustomerId,
        { $set: mergeData }
      ).session(session);
      
      // Mark secondary customer as merged
      await Customer.findByIdAndUpdate(
        secondaryCustomerId,
        {
          $set: {
            status: 'merged',
            mergedInto: primaryCustomerId,
            mergedAt: new Date(),
            mergedBy
          }
        }
      ).session(session);
      
      // Create merge event
      await CustomerEvent.create([{
        companyId,
        customerId: primaryCustomerId,
        type: 'CUSTOMER_MERGED',
        data: {
          mergedFrom: secondaryCustomerId,
          mergedBy,
          callsMerged: callsUpdated.modifiedCount,
          eventsMerged: eventsUpdated.modifiedCount
        },
        timestamp: new Date(),
        createdBy: mergedBy
      }], { session });
      
      await session.commitTransaction();
      
      // Log to audit
      await AuditLog.create({
        companyId,
        actionType: 'CUSTOMER_MERGED',
        entityType: 'Customer',
        entityId: primaryCustomerId,
        actor: {
          type: 'user',
          email: mergedBy
        },
        details: {
          primaryCustomerId,
          secondaryCustomerId,
          callsMerged: callsUpdated.modifiedCount,
          eventsMerged: eventsUpdated.modifiedCount,
          mergeDuration: Date.now() - startTime
        }
      });
      
      logger.info('[COMPLIANCE] Customer merge complete', {
        primary: primaryCustomerId,
        secondary: secondaryCustomerId,
        callsMerged: callsUpdated.modifiedCount,
        duration: Date.now() - startTime
      });
      
      return {
        success: true,
        primaryCustomerId,
        secondaryCustomerId,
        recordsMerged: {
          calls: callsUpdated.modifiedCount,
          events: eventsUpdated.modifiedCount
        },
        duration: Date.now() - startTime
      };
      
    } catch (error) {
      await session.abortTransaction();
      logger.error('[COMPLIANCE] Customer merge failed', {
        error: error.message,
        primary: primaryCustomerId,
        secondary: secondaryCustomerId
      });
      throw error;
    } finally {
      session.endSession();
    }
  }
  
  /**
   * Find potential duplicate customers
   * 
   * @param {string} companyId - Company ID
   * @returns {Promise<Array>} - Potential duplicates
   */
  static async findDuplicates(companyId) {
    // Find customers with same phone (excluding merged/deleted)
    const phoneGroups = await Customer.aggregate([
      {
        $match: {
          companyId: new mongoose.Types.ObjectId(companyId),
          status: { $nin: ['merged', 'deleted'] }
        }
      },
      {
        $group: {
          _id: '$phone',
          count: { $sum: 1 },
          customers: { $push: { _id: '$_id', fullName: '$fullName', status: '$status' } }
        }
      },
      {
        $match: { count: { $gt: 1 } }
      }
    ]);
    
    // Find customers with same email
    const emailGroups = await Customer.aggregate([
      {
        $match: {
          companyId: new mongoose.Types.ObjectId(companyId),
          status: { $nin: ['merged', 'deleted'] },
          email: { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: '$email',
          count: { $sum: 1 },
          customers: { $push: { _id: '$_id', fullName: '$fullName', phone: '$phone' } }
        }
      },
      {
        $match: { count: { $gt: 1 } }
      }
    ]);
    
    return {
      byPhone: phoneGroups.map(g => ({
        phone: g._id,
        customers: g.customers
      })),
      byEmail: emailGroups.map(g => ({
        email: g._id,
        customers: g.customers
      }))
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // DATA RETENTION
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Get data retention status for a company
   * 
   * @param {string} companyId - Company ID
   * @returns {Promise<Object>} - Retention status
   */
  static async getRetentionStatus(companyId) {
    const now = new Date();
    
    // Count records by age
    const callsOlderThan2Years = await CallSummary.countDocuments({
      companyId,
      startedAt: { $lt: new Date(now - CONFIG.DEFAULT_RETENTION.calls * 24 * 60 * 60 * 1000) }
    });
    
    const transcriptsOlderThan1Year = await CallTranscript.countDocuments({
      companyId,
      createdAt: { $lt: new Date(now - CONFIG.DEFAULT_RETENTION.transcripts * 24 * 60 * 60 * 1000) }
    });
    
    return {
      companyId,
      retentionPolicy: CONFIG.DEFAULT_RETENTION,
      pendingPurge: {
        calls: callsOlderThan2Years,
        transcripts: transcriptsOlderThan1Year
      },
      status: callsOlderThan2Years > 0 || transcriptsOlderThan1Year > 0
        ? 'PURGE_NEEDED'
        : 'COMPLIANT'
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = ComplianceService;
module.exports.CONFIG = CONFIG;

