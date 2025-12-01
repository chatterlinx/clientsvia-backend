/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DATA PURGE JOB
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Part of: Call Center Module V2
 * Created: December 1, 2025
 * Proposal: PROPOSAL-CALL-CENTER-MODULE-V2.md
 * 
 * PURPOSE:
 * ─────────────────────────────────────────────────────────────────────────────
 * Automatically purge old data based on retention policies.
 * Required for GDPR/CCPA compliance - data minimization principle.
 * 
 * SCHEDULE:
 * ─────────────────────────────────────────────────────────────────────────────
 * - Runs weekly (Sunday 3 AM)
 * - Can also be triggered manually
 * 
 * RETENTION DEFAULTS:
 * ─────────────────────────────────────────────────────────────────────────────
 * - Call summaries: 2 years
 * - Transcripts: 1 year (archived to S3 first)
 * - Recordings metadata: 90 days
 * - Customers: 7 years (anonymized, not deleted)
 * - Audit logs: 7 years (required for compliance)
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

const mongoose = require('mongoose');
const CallSummary = require('../models/CallSummary');
const CallTranscript = require('../models/CallTranscript');
const Customer = require('../models/Customer');
const CustomerEvent = require('../models/CustomerEvent');
const AuditLog = require('../models/AuditLog');
const V2Company = require('../models/v2Company');
const logger = require('../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // Default retention periods (days)
  DEFAULT_RETENTION: {
    callSummaries: 365 * 2,     // 2 years
    transcripts: 365,           // 1 year
    recordingsMetadata: 90,     // 90 days
    customerEvents: 365 * 3,    // 3 years
    inactiveCustomers: 365 * 7  // 7 years
  },
  
  // Batch size for deletes
  BATCH_SIZE: 100,
  
  // Dry run by default (set to false to actually delete)
  DRY_RUN: process.env.PURGE_DRY_RUN !== 'false'
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PURGE FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run the data purge job
 * 
 * @param {Object} options - Purge options
 * @returns {Promise<Object>} - Purge results
 */
async function runPurge(options = {}) {
  const startTime = Date.now();
  const dryRun = options.dryRun ?? CONFIG.DRY_RUN;
  
  logger.info('[PURGE] ═══════════════════════════════════════════════════════════════');
  logger.info(`[PURGE] Starting data purge job (DRY RUN: ${dryRun})`);
  logger.info('[PURGE] ═══════════════════════════════════════════════════════════════');
  
  const results = {
    dryRun,
    startedAt: new Date(),
    purged: {
      callSummaries: 0,
      transcripts: 0,
      customerEvents: 0,
      inactiveCustomers: 0
    },
    errors: []
  };
  
  try {
    // Get all companies
    const companies = await V2Company.find().select('_id companyName dataRetention').lean();
    
    logger.info(`[PURGE] Processing ${companies.length} companies`);
    
    for (const company of companies) {
      try {
        const companyResult = await purgeCompanyData(company, dryRun);
        
        results.purged.callSummaries += companyResult.callSummaries;
        results.purged.transcripts += companyResult.transcripts;
        results.purged.customerEvents += companyResult.customerEvents;
        results.purged.inactiveCustomers += companyResult.inactiveCustomers;
        
      } catch (err) {
        results.errors.push({
          companyId: company._id,
          error: err.message
        });
        logger.error('[PURGE] Error purging company data', {
          companyId: company._id,
          error: err.message
        });
      }
    }
    
    // Log summary to audit
    if (!dryRun && (results.purged.callSummaries > 0 || results.purged.transcripts > 0)) {
      await AuditLog.create({
        companyId: null,  // Platform-wide
        actionType: 'SYSTEM_MAINTENANCE',
        actor: { type: 'system' },
        details: {
          jobType: 'DATA_PURGE',
          results: results.purged,
          duration: Date.now() - startTime
        }
      });
    }
    
  } catch (error) {
    logger.error('[PURGE] Job failed', { error: error.message });
    results.errors.push({ error: error.message });
  }
  
  results.duration = Date.now() - startTime;
  results.completedAt = new Date();
  
  logger.info('[PURGE] ═══════════════════════════════════════════════════════════════');
  logger.info('[PURGE] Data purge job completed', {
    dryRun,
    purged: results.purged,
    errors: results.errors.length,
    duration: `${results.duration}ms`
  });
  logger.info('[PURGE] ═══════════════════════════════════════════════════════════════');
  
  return results;
}

/**
 * Purge data for a specific company
 * 
 * @param {Object} company - Company document
 * @param {boolean} dryRun - Whether to actually delete
 * @returns {Promise<Object>} - Purge results for company
 */
async function purgeCompanyData(company, dryRun) {
  const companyId = company._id;
  const retention = company.dataRetention || CONFIG.DEFAULT_RETENTION;
  const now = new Date();
  
  const results = {
    callSummaries: 0,
    transcripts: 0,
    customerEvents: 0,
    inactiveCustomers: 0
  };
  
  // 1. Purge old call summaries
  const callCutoff = new Date(now - (retention.callSummaries || CONFIG.DEFAULT_RETENTION.callSummaries) * 24 * 60 * 60 * 1000);
  
  if (dryRun) {
    results.callSummaries = await CallSummary.countDocuments({
      companyId,
      startedAt: { $lt: callCutoff }
    });
  } else {
    const callResult = await CallSummary.deleteMany({
      companyId,
      startedAt: { $lt: callCutoff }
    });
    results.callSummaries = callResult.deletedCount;
  }
  
  // 2. Purge old transcripts (should already be archived to S3)
  const transcriptCutoff = new Date(now - (retention.transcripts || CONFIG.DEFAULT_RETENTION.transcripts) * 24 * 60 * 60 * 1000);
  
  if (dryRun) {
    results.transcripts = await CallTranscript.countDocuments({
      companyId,
      createdAt: { $lt: transcriptCutoff },
      movedToColdAt: { $exists: true }  // Only delete if archived
    });
  } else {
    const transcriptResult = await CallTranscript.deleteMany({
      companyId,
      createdAt: { $lt: transcriptCutoff },
      movedToColdAt: { $exists: true }
    });
    results.transcripts = transcriptResult.deletedCount;
  }
  
  // 3. Purge old customer events
  const eventCutoff = new Date(now - (retention.customerEvents || CONFIG.DEFAULT_RETENTION.customerEvents) * 24 * 60 * 60 * 1000);
  
  if (dryRun) {
    results.customerEvents = await CustomerEvent.countDocuments({
      companyId,
      timestamp: { $lt: eventCutoff }
    });
  } else {
    const eventResult = await CustomerEvent.deleteMany({
      companyId,
      timestamp: { $lt: eventCutoff }
    });
    results.customerEvents = eventResult.deletedCount;
  }
  
  // 4. Anonymize inactive customers (7+ years no contact)
  const inactiveCutoff = new Date(now - (retention.inactiveCustomers || CONFIG.DEFAULT_RETENTION.inactiveCustomers) * 24 * 60 * 60 * 1000);
  
  if (dryRun) {
    results.inactiveCustomers = await Customer.countDocuments({
      companyId,
      lastContactAt: { $lt: inactiveCutoff },
      status: { $nin: ['deleted', 'merged'] }
    });
  } else {
    const inactiveCustomers = await Customer.find({
      companyId,
      lastContactAt: { $lt: inactiveCutoff },
      status: { $nin: ['deleted', 'merged'] }
    }).select('_id').limit(CONFIG.BATCH_SIZE);
    
    for (const customer of inactiveCustomers) {
      await Customer.findByIdAndUpdate(customer._id, {
        $set: {
          fullName: '[PURGED - RETENTION]',
          firstName: '[PURGED]',
          lastName: '[PURGED]',
          email: `purged-${customer._id}@purged.local`,
          phone: '+10000000000',
          secondaryPhones: [],
          addresses: [],
          preferences: {},
          status: 'deleted',
          deletedAt: new Date(),
          deletedBy: 'retention_policy',
          deletionReason: 'Automatic purge - exceeded retention period'
        }
      });
      results.inactiveCustomers++;
    }
  }
  
  if (results.callSummaries > 0 || results.transcripts > 0) {
    logger.info('[PURGE] Company purge complete', {
      companyId: companyId.toString(),
      companyName: company.companyName,
      dryRun,
      results
    });
  }
  
  return results;
}

/**
 * Get purge status for monitoring
 */
async function getPurgeStatus() {
  const now = new Date();
  
  // Count records eligible for purge
  const callCutoff = new Date(now - CONFIG.DEFAULT_RETENTION.callSummaries * 24 * 60 * 60 * 1000);
  const transcriptCutoff = new Date(now - CONFIG.DEFAULT_RETENTION.transcripts * 24 * 60 * 60 * 1000);
  const eventCutoff = new Date(now - CONFIG.DEFAULT_RETENTION.customerEvents * 24 * 60 * 60 * 1000);
  
  const [callsEligible, transcriptsEligible, eventsEligible] = await Promise.all([
    CallSummary.countDocuments({ startedAt: { $lt: callCutoff } }),
    CallTranscript.countDocuments({ createdAt: { $lt: transcriptCutoff }, movedToColdAt: { $exists: true } }),
    CustomerEvent.countDocuments({ timestamp: { $lt: eventCutoff } })
  ]);
  
  // Get last purge from audit log
  const lastPurge = await AuditLog.findOne({
    actionType: 'SYSTEM_MAINTENANCE',
    'details.jobType': 'DATA_PURGE'
  }).sort({ timestamp: -1 }).lean();
  
  return {
    status: callsEligible + transcriptsEligible + eventsEligible > 0 ? 'PURGE_NEEDED' : 'COMPLIANT',
    eligibleForPurge: {
      callSummaries: callsEligible,
      transcripts: transcriptsEligible,
      customerEvents: eventsEligible
    },
    retentionPolicy: CONFIG.DEFAULT_RETENTION,
    lastPurge: lastPurge ? {
      timestamp: lastPurge.timestamp,
      results: lastPurge.details?.results
    } : null,
    dryRunEnabled: CONFIG.DRY_RUN
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI EXECUTION
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  if (mongoose.connection.readyState !== 1) {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      console.error('MONGODB_URI environment variable is required');
      process.exit(1);
    }
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');
  }
  
  const dryRun = process.argv.includes('--execute') ? false : true;
  
  if (dryRun) {
    console.log('\n⚠️  DRY RUN MODE - No data will be deleted');
    console.log('    Use --execute flag to actually delete data\n');
  }
  
  try {
    const result = await runPurge({ dryRun });
    console.log('\nPurge completed:', JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (error) {
    console.error('Purge failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  runPurge,
  purgeCompanyData,
  getPurgeStatus,
  CONFIG
};

