/**
 * ============================================================================
 * USAGE SERVICE - CALL TRACKING & BILLING
 * ============================================================================
 * 
 * PURPOSE: Finalize call traces and record usage for billing
 * ARCHITECTURE: Called at call end to persist Redis context to MongoDB
 * SCOPE: Integrates FrontlineContext, CallTrace, UsageRecord, CompanyBillingState
 * 
 * ============================================================================
 */

const CallTrace = require('../../models/CallTrace');
const UsageRecord = require('../../models/UsageRecord');
const CompanyBillingState = require('../../models/CompanyBillingState');
const { loadContext, deleteContext } = require('./frontlineContextService');
const logger = require('../../utils/logger');

/**
 * Persist final context snapshot to MongoDB and clean up Redis
 * @param {string} callId - Twilio Call SID
 * @param {Object} meta - Call metadata
 * @param {number} meta.startedAt - Unix timestamp (ms) when call started
 * @param {number} meta.endedAt - Unix timestamp (ms) when call ended
 * @returns {Promise<void>}
 */
async function finalizeCallTrace(callId, { startedAt, endedAt }) {
  try {
    const ctx = await loadContext(callId);
    
    if (!ctx) {
      logger.warn(`[USAGE SERVICE] No context found for call: ${callId} - cannot finalize`);
      return;
    }
    
    // Create CallTrace snapshot
    const callTrace = await CallTrace.create({
      callId: ctx.callId,
      companyId: ctx.companyId,
      trade: ctx.trade,
      currentIntent: ctx.currentIntent,
      extracted: ctx.extracted,
      triageMatches: ctx.triageMatches,
      tierTrace: ctx.tierTrace,
      transcript: ctx.transcript,
      readyToBook: ctx.readyToBook,
      appointmentId: ctx.appointmentId,
      configVersion: ctx.configVersion,
      startedAt,
      endedAt
    });
    
    logger.info(`[USAGE SERVICE] Finalized call trace: ${callId}`, {
      companyId: ctx.companyId,
      durationSeconds: callTrace.durationSeconds,
      intent: ctx.currentIntent,
      appointmentCreated: !!ctx.appointmentId
    });
    
    // Clean up Redis context
    await deleteContext(callId);
    
    return callTrace;
  } catch (error) {
    logger.error(`[USAGE SERVICE] Failed to finalize call trace: ${callId}`, {
      error: error.message,
      stack: error.stack
    });
    // Don't throw - non-fatal, data remains in Redis with TTL
  }
}

/**
 * Record usage for billing and analytics
 * @param {Object} params
 * @param {string} params.companyId
 * @param {string} params.callId
 * @param {number} params.rawDurationSeconds
 * @param {number} [params.llmTurns=0] - Number of LLM interactions
 * @param {number} [params.tier1Count=0] - Tier 1 (Rules) resolutions
 * @param {number} [params.tier2Count=0] - Tier 2 (Semantic) resolutions
 * @param {number} [params.tier3Count=0] - Tier 3 (LLM) resolutions
 * @param {string} [params.primaryIntent='other'] - Main call intent
 * @param {number} [params.estimatedAiCost=0] - Estimated AI cost in USD
 * @param {boolean} [params.bookingCreated=false] - Whether appointment was booked
 * @param {string} [params.appointmentId] - Appointment ID if booked
 * @param {boolean} [params.successfulResolution=true] - Whether call was resolved
 * @param {boolean} [params.transferredToHuman=false] - Whether transferred to human
 * @returns {Promise<void>}
 */
async function recordUsage(params) {
  try {
    // Calculate billed minutes (round up)
    const billedMinutes = Math.ceil((params.rawDurationSeconds || 0) / 60);
    
    // Estimate costs (placeholder logic - adjust based on real pricing)
    const twilioVoiceCost = billedMinutes * 0.013; // $0.013/min estimate
    const elevenLabsCost = (params.rawDurationSeconds || 0) * 0.0001; // Estimate
    const llmCost = (params.tier3Count || 0) * 0.002; // $0.002 per Tier 3 call
    
    // Create usage record
    const usageRecord = await UsageRecord.create({
      companyId: params.companyId,
      callId: params.callId,
      rawDurationSeconds: params.rawDurationSeconds || 0,
      billedMinutes,
      llmTurns: params.llmTurns || 0,
      tier1Count: params.tier1Count || 0,
      tier2Count: params.tier2Count || 0,
      tier3Count: params.tier3Count || 0,
      primaryIntent: params.primaryIntent || 'other',
      twilioVoiceCost,
      elevenLabsCost,
      llmCost,
      bookingCreated: params.bookingCreated || false,
      appointmentId: params.appointmentId || null,
      successfulResolution: params.successfulResolution !== false,
      transferredToHuman: params.transferredToHuman || false
    });
    
    logger.info(`[USAGE SERVICE] Recorded usage for call: ${params.callId}`, {
      companyId: params.companyId,
      billedMinutes,
      totalCost: usageRecord.totalCost,
      tier1: params.tier1Count || 0,
      tier2: params.tier2Count || 0,
      tier3: params.tier3Count || 0
    });
    
    // Update company billing state
    const state = await CompanyBillingState.findOrCreateForCompany(params.companyId);
    
    if (state) {
      // Add minutes
      state.minutesUsed += billedMinutes;
      state.totalCalls += 1;
      
      // Add tier usage counts
      state.tier1UsageCount += params.tier1Count || 0;
      state.tier2UsageCount += params.tier2Count || 0;
      state.tier3UsageCount += params.tier3Count || 0;
      
      // Add costs
      state.estimatedAiCost += (params.estimatedAiCost || 0) + llmCost;
      state.tier3Cost += llmCost;
      
      // Track booking
      if (params.bookingCreated) {
        state.bookingsCreated += 1;
      }
      
      // Recalculate overage
      if (state.minutesIncluded && state.minutesUsed > state.minutesIncluded) {
        state.overageMinutes = state.minutesUsed - state.minutesIncluded;
      }
      
      await state.save();
      
      logger.info(`[USAGE SERVICE] Updated billing state for company: ${params.companyId}`, {
        minutesUsed: state.minutesUsed,
        minutesIncluded: state.minutesIncluded,
        overageMinutes: state.overageMinutes,
        usagePercent: state.usagePercent
      });
      
      // Check if overage alert needed
      const alertNeeded = await state.checkOverageAlert();
      if (alertNeeded) {
        logger.warn(`[USAGE SERVICE] Overage alert triggered for company: ${params.companyId}`, {
          usagePercent: state.usagePercent,
          minutesUsed: state.minutesUsed,
          minutesIncluded: state.minutesIncluded
        });
        // TODO: Send email/notification to company admin
      }
    }
    
    return usageRecord;
  } catch (error) {
    logger.error(`[USAGE SERVICE] Failed to record usage for call: ${params.callId}`, {
      error: error.message,
      stack: error.stack,
      params
    });
    // Don't throw - non-fatal, billing can be reconciled later
  }
}

/**
 * Get usage statistics for a company
 * @param {string} companyId
 * @param {Object} options
 * @param {Date} [options.startDate] - Filter start date
 * @param {Date} [options.endDate] - Filter end date
 * @returns {Promise<Object>} Usage statistics
 */
async function getCompanyUsageStats(companyId, options = {}) {
  try {
    const usageStats = await UsageRecord.getCompanyUsage(companyId, options);
    const tierBreakdown = await UsageRecord.getTierBreakdown(companyId, options);
    const callStats = await CallTrace.getCompanyStats(companyId, options);
    const billingState = await CompanyBillingState.findOne({ companyId });
    
    return {
      usage: usageStats,
      tiers: tierBreakdown,
      calls: callStats,
      billing: billingState || null
    };
  } catch (error) {
    logger.error(`[USAGE SERVICE] Failed to get usage stats for company: ${companyId}`, {
      error: error.message
    });
    throw error;
  }
}

module.exports = {
  finalizeCallTrace,
  recordUsage,
  getCompanyUsageStats
};

