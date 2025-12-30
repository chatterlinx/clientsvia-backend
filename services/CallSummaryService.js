/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CALL SUMMARY SERVICE
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Part of: Call Center Module V2
 * Created: December 1, 2025
 * Proposal: PROPOSAL-CALL-CENTER-MODULE-V2.md
 * 
 * PURPOSE:
 * ─────────────────────────────────────────────────────────────────────────────
 * Business logic layer for call record management.
 * Orchestrates CallSummary, CallTranscript, CustomerEvent, and CustomerLookup.
 * 
 * RESPONSIBILITIES:
 * ─────────────────────────────────────────────────────────────────────────────
 * - Start call (create CallSummary, lookup customer)
 * - End call (update with outcome, AI analysis, transcript)
 * - Link calls to customers
 * - Store transcripts separately (hot/cold separation)
 * - Log customer events
 * 
 * USAGE:
 * ─────────────────────────────────────────────────────────────────────────────
 * // At call start (Twilio webhook)
 * const callContext = await CallSummaryService.startCall({
 *   companyId, phone, twilioSid, direction
 * });
 * 
 * // At call end (after AI processing)
 * await CallSummaryService.endCall(callId, {
 *   outcome, primaryIntent, transcript, ...
 * });
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

const CallSummary = require('../models/CallSummary');
const CallTranscript = require('../models/CallTranscript');
const CustomerEvent = require('../models/CustomerEvent');
const CustomerLookup = require('./CustomerLookup');
const Customer = require('../models/Customer');
const Company = require('../models/v2Company');
const Vendor = require('../models/Vendor');
const logger = require('../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // Two-party consent states (require explicit consent for recording)
  TWO_PARTY_CONSENT_STATES: [
    'CA', 'CT', 'FL', 'IL', 'MD', 'MA', 'MI', 'MT', 'NH', 'PA', 'WA'
  ],
  
  // Maximum transcript turns to store
  MAX_TRANSCRIPT_TURNS: 1000,
  
  // Enable detailed logging
  DEBUG: process.env.NODE_ENV !== 'production'
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN SERVICE CLASS
// ═══════════════════════════════════════════════════════════════════════════

class CallSummaryService {
  
  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * START CALL
   * ═══════════════════════════════════════════════════════════════════════════
   * 
   * Called at the beginning of every incoming call.
   * Creates CallSummary record and identifies the customer.
   * 
   * @param {Object} params - Call parameters
   * @param {string} params.companyId - Company ID
   * @param {string} params.phone - Caller phone number
   * @param {string} params.twilioSid - Twilio Call SID
   * @param {string} [params.direction='inbound'] - Call direction
   * @param {string} [params.callerState] - Caller's state (for consent)
   * @returns {Promise<Object>} - Call context for AI processing
   */
  static async startCall({ companyId, phone, twilioSid, direction = 'inbound', callerState = null }) {
    const startTime = Date.now();
    
    logger.info('[CALL_SERVICE] Starting call', {
      companyId,
      phone,
      twilioSid,
      direction
    });
    
    try {
      // ─────────────────────────────────────────────────────────────────────────
      // STEP 0: Vendor-first caller identity (company-scoped)
      // ─────────────────────────────────────────────────────────────────────────
      // If enabled and vendor match found, do NOT create/attach a Customer record.
      // This prevents vendor/supplier numbers from polluting the customer directory.
      let vendorHandling = null;
      try {
        const company = await Company.findById(companyId)
          .select('aiAgentSettings.frontDeskBehavior.vendorHandling')
          .lean();
        vendorHandling = company?.aiAgentSettings?.frontDeskBehavior?.vendorHandling || null;
      } catch (cfgErr) {
        // Non-blocking: config load failure should not break calls
        logger.warn('[CALL_SERVICE] VendorHandling config load failed (non-blocking)', {
          companyId,
          error: cfgErr.message
        });
      }

      const vendorFirstEnabled = vendorHandling?.vendorFirstEnabled === true;
      if (vendorFirstEnabled) {
        const vendor = await Vendor.findByPhone(companyId, phone);
        if (vendor) {
          const callId = CallSummary.generateCallId();

          const consentType = callerState && CONFIG.TWO_PARTY_CONSENT_STATES.includes(callerState.toUpperCase())
            ? 'two-party'
            : 'one-party';

          const callSummary = await CallSummary.create({
            companyId,
            callId,
            twilioSid,
            phone: vendor.phone || phone,
            customerId: null,
            callerName: vendor.businessName || null,
            isReturning: false,
            direction,
            startedAt: new Date(),
            kpi: {
              callerType: 'vendor'
            },
            consent: {
              consentType,
              callerState,
              consentTimestamp: new Date()
            },
            processingStatus: 'pending'
          });

          const callContext = {
            // Call identity
            callId,
            twilioSid,
            companyId,

            // Caller identity
            callerType: 'vendor',
            vendorId: vendor._id,
            vendorContext: {
              vendorName: vendor.businessName || null,
              vendorType: vendor.vendorType || null,
              vendorId: vendor.vendorId || null
            },

            // Customer fields intentionally null
            customerId: null,
            customerContext: null,
            isNewCustomer: false,
            isReturning: false,

            // AI context (for higher layers)
            aiContext: {
              callerType: 'vendor',
              vendorName: vendor.businessName || null,
              callId,
              direction
            },

            startedAt: callSummary.startedAt,
            customerLookupTime: Date.now() - startTime,
            fromCache: false
          };

          logger.info('[CALL_SERVICE] Vendor recognized (vendor-first)', {
            callId,
            companyId,
            phone: vendor.phone || phone,
            vendorName: vendor.businessName || null,
            duration: Date.now() - startTime
          });

          return callContext;
        }
      }

      // ─────────────────────────────────────────────────────────────────────────
      // STEP 1: Look up or create customer (race-proof)
      // ─────────────────────────────────────────────────────────────────────────
      const { customer, isNew: isNewCustomer, fromCache } = 
        await CustomerLookup.getOrCreatePlaceholder(companyId, phone);
      
      // ─────────────────────────────────────────────────────────────────────────
      // STEP 2: Get AI context for personalization
      // ─────────────────────────────────────────────────────────────────────────
      const customerContext = await CustomerLookup.getAIContext(companyId, phone);
      
      // ─────────────────────────────────────────────────────────────────────────
      // STEP 3: Generate call ID and create CallSummary
      // ─────────────────────────────────────────────────────────────────────────
      const callId = CallSummary.generateCallId();
      
      // Determine consent type based on state
      const consentType = callerState && CONFIG.TWO_PARTY_CONSENT_STATES.includes(callerState.toUpperCase())
        ? 'two-party'
        : 'one-party';
      
      const callSummary = await CallSummary.create({
        companyId,
        callId,
        twilioSid,
        phone: customer.phone,  // Use normalized phone from customer
        customerId: customer._id,
        callerName: customer.fullName || null,
        isReturning: customerContext.isReturning,
        direction,
        startedAt: new Date(),
        kpi: {
          callerType: 'customer'
        },
        consent: {
          consentType,
          callerState,
          consentTimestamp: new Date()
        },
        processingStatus: 'pending'
      });
      
      // ─────────────────────────────────────────────────────────────────────────
      // STEP 4: Log call_started event
      // ─────────────────────────────────────────────────────────────────────────
      await CustomerEvent.logEvent({
        companyId,
        customerId: customer._id,
        type: CustomerEvent.EVENT_TYPES.CALL_STARTED,
        data: {
          callId,
          twilioSid,
          direction,
          isReturning: customerContext.isReturning
        },
        callId,
        createdBy: 'system'
      });
      
      // ─────────────────────────────────────────────────────────────────────────
      // STEP 5: Build and return call context
      // ─────────────────────────────────────────────────────────────────────────
      const callContext = {
        // Call identity
        callId,
        twilioSid,
        companyId,

        // Caller identity
        callerType: 'customer',
        
        // Customer info
        customerId: customer._id,
        customerContext,
        isNewCustomer,
        isReturning: customerContext.isReturning,
        
        // AI context (for LLM-0)
        aiContext: {
          ...customerContext,
          callId,
          direction
        },
        
        // Metadata
        startedAt: callSummary.startedAt,
        customerLookupTime: Date.now() - startTime,
        fromCache
      };
      
      logger.info('[CALL_SERVICE] Call started successfully', {
        callId,
        customerId: customer.customerId,
        isReturning: customerContext.isReturning,
        duration: Date.now() - startTime
      });
      
      return callContext;
      
    } catch (error) {
      logger.error('[CALL_SERVICE] Failed to start call', {
        error: error.message,
        stack: error.stack,
        companyId,
        phone,
        twilioSid
      });
      throw error;
    }
  }
  
  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * END CALL
   * ═══════════════════════════════════════════════════════════════════════════
   * 
   * Called when a call ends. Updates CallSummary with outcome, AI analysis,
   * and stores transcript.
   * 
   * @param {string} callId - Call ID
   * @param {Object} data - Call completion data
   * @returns {Promise<CallSummary>}
   */
  static async endCall(callId, data) {
    const startTime = Date.now();
    
    logger.info('[CALL_SERVICE] Ending call', { callId });
    
    try {
      const {
        // Outcome
        outcome,
        outcomeDetail,
        transferredTo,
        appointmentCreatedId,
        messageLeft,
        followUpRequired,
        followUpNotes,
        
        // AI Analysis
        primaryIntent,
        intentConfidence,
        secondaryIntents,
        emotion,
        triageCard,
        scenarioMatched,
        routingTier,
        llmModel,
        llmCost,
        
        // Captured data
        capturedSummary,
        callerName,
        
        // Transcript
        transcript,  // Array of { speaker, text, timestamp }
        turnCount,
        
        // Recording
        recordingUrl,
        recordingDuration,
        recordingConsent
      } = data;
      
      // ─────────────────────────────────────────────────────────────────────────
      // STEP 1: Get existing call summary
      // ─────────────────────────────────────────────────────────────────────────
      const existingCall = await CallSummary.findOne({ callId });
      if (!existingCall) {
        throw new Error(`Call not found: ${callId}`);
      }
      
      const companyId = existingCall.companyId;
      const customerId = existingCall.customerId;
      
      // ─────────────────────────────────────────────────────────────────────────
      // STEP 2: Store transcript separately (if provided)
      // ─────────────────────────────────────────────────────────────────────────
      let transcriptRef = null;
      if (transcript && transcript.length > 0) {
        const limitedTranscript = transcript.slice(0, CONFIG.MAX_TRANSCRIPT_TURNS);
        const transcriptDoc = await CallTranscript.createTranscript(
          companyId,
          callId,
          limitedTranscript
        );
        transcriptRef = transcriptDoc._id;
      }
      
      // ─────────────────────────────────────────────────────────────────────────
      // STEP 3: Update CallSummary
      // ─────────────────────────────────────────────────────────────────────────
      const now = new Date();
      const durationSeconds = Math.round((now - existingCall.startedAt) / 1000);

      // Preserve more-specific outcomes that may have been set during the live call
      // (e.g., transfer initiated). Status callbacks often report "completed" even when transferred.
      const preserveOutcome = (existing, incoming) => {
        if (!incoming) return existing || CALL_OUTCOMES.COMPLETED;
        if (!existing) return incoming;

        // If we already know it was transferred, never downgrade to "completed".
        if (existing === CALL_OUTCOMES.TRANSFERRED && incoming === CALL_OUTCOMES.COMPLETED) return existing;
        if (existing === CALL_OUTCOMES.VOICEMAIL && incoming === CALL_OUTCOMES.COMPLETED) return existing;
        if (existing === CALL_OUTCOMES.CALLBACK_REQUESTED && incoming === CALL_OUTCOMES.COMPLETED) return existing;

        return incoming;
      };

      const finalOutcome = preserveOutcome(existingCall.outcome, outcome);
      
      const updateData = {
        endedAt: now,
        durationSeconds,
        outcome: finalOutcome,
        outcomeDetail,
        transferredTo,
        appointmentCreatedId,
        messageLeft: messageLeft || false,
        followUpRequired: followUpRequired || false,
        followUpNotes,
        primaryIntent,
        intentConfidence,
        secondaryIntents,
        emotion,
        triageCard,
        scenarioMatched,
        routingTier,
        llmModel,
        llmCost: llmCost || 0,
        capturedSummary,
        turnCount: turnCount || transcript?.length || 0,
        transcriptRef,
        hasTranscript: !!transcriptRef,
        processingStatus: 'complete'
      };

      // Derive KPI bucket and containment outcome at end-of-call (compact, non-invasive).
      // If the call ever entered booking, it's a BOOKING bucket. If transfer occurred/was initiated, TRANSFER bucket.
      try {
        const kpi = existingCall.kpi || {};
        const transferLike = finalOutcome === CALL_OUTCOMES.TRANSFERRED || kpi.transferInitiated === true;
        const bucket = transferLike
          ? 'TRANSFER'
          : (kpi.enteredBooking === true ? 'BOOKING' : 'FAQ_ONLY');

        // Containment outcome rules (locked definition):
        // - SUCCESS: no transfer/voicemail-to-human handoff
        // - INTENTIONAL_HANDOFF: policy-defined "take message" outcomes (vendor/after-hours)
        // - FAILURE: otherwise
        const isIntentional = (kpi.vendorMessageCaptured === true) || (kpi.afterHoursMessageCaptured === true);
        const containmentOutcome = transferLike
          ? (isIntentional ? 'INTENTIONAL_HANDOFF' : 'FAILURE')
          : 'SUCCESS';

        const containmentCountedAsSuccess = containmentOutcome === 'SUCCESS' || containmentOutcome === 'INTENTIONAL_HANDOFF';

        updateData['kpi.bucket'] = bucket;
        updateData['kpi.containmentOutcome'] = containmentOutcome;
        updateData['kpi.containmentCountedAsSuccess'] = containmentCountedAsSuccess;
        updateData['kpi.lastUpdatedAt'] = now;
      } catch (kpiErr) {
        logger.warn('[CALL_SERVICE] KPI derivation failed (non-blocking)', { callId, error: kpiErr.message });
      }
      
      // Update caller name if captured
      if (callerName && !existingCall.callerName) {
        updateData.callerName = callerName;
      }
      
      // Update recording info
      if (recordingUrl) {
        updateData.hasRecording = true;
        updateData['consent.recordingConsent'] = recordingConsent || false;
      }
      
      const updatedCall = await CallSummary.findOneAndUpdate(
        { callId },
        { $set: updateData },
        { new: true }
      );
      
      // ─────────────────────────────────────────────────────────────────────────
      // STEP 4: Log call_completed event
      // ─────────────────────────────────────────────────────────────────────────
      if (customerId) {
        await CustomerEvent.logEvent({
          companyId,
          customerId,
          type: CustomerEvent.EVENT_TYPES.CALL_COMPLETED,
          data: {
            callId,
            outcome,
            outcomeDetail,
            primaryIntent,
            routingTier,
            durationSeconds,
            appointmentCreated: !!appointmentCreatedId
          },
          callId,
          appointmentId: appointmentCreatedId,
          createdBy: 'system'
        });
        
        // ─────────────────────────────────────────────────────────────────────────
        // STEP 5: Enrich customer with captured data
        // ─────────────────────────────────────────────────────────────────────────
        if (capturedSummary || callerName) {
          try {
            const enrichData = { companyId };
            
            if (callerName) {
              enrichData.fullName = callerName;
              // Try to split into first/last name
              const nameParts = callerName.split(' ');
              if (nameParts.length >= 2) {
                enrichData.firstName = nameParts[0];
                enrichData.lastName = nameParts.slice(1).join(' ');
              } else {
                enrichData.firstName = callerName;
              }
            }
            
            // Update customer status based on outcome
            if (appointmentCreatedId) {
              enrichData.status = 'customer';
            } else if (outcome === 'completed') {
              enrichData.status = 'lead';
            }
            
            await CustomerLookup.enrichCustomer(customerId, enrichData);
          } catch (err) {
            logger.warn('[CALL_SERVICE] Failed to enrich customer', {
              error: err.message,
              customerId
            });
          }
        }
        
        // ─────────────────────────────────────────────────────────────────────────
        // STEP 6: Update customer stats
        // ─────────────────────────────────────────────────────────────────────────
        const statsIncrements = {};
        if (appointmentCreatedId) {
          statsIncrements.totalAppointments = 1;
        }
        
        if (Object.keys(statsIncrements).length > 0) {
          await Customer.incrementStats(customerId, statsIncrements);
        }
      }
      
      logger.info('[CALL_SERVICE] Call ended successfully', {
        callId,
        outcome,
        durationSeconds,
        routingTier,
        processingTime: Date.now() - startTime
      });
      
      return updatedCall;
      
    } catch (error) {
      logger.error('[CALL_SERVICE] Failed to end call', {
        error: error.message,
        stack: error.stack,
        callId
      });
      
      // Mark call as error
      await CallSummary.findOneAndUpdate(
        { callId },
        { 
          $set: { 
            processingStatus: 'error',
            errorMessage: error.message,
            endedAt: new Date()
          } 
        }
      );
      
      throw error;
    }
  }
  
  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * ADD TRANSCRIPT TURN
   * ═══════════════════════════════════════════════════════════════════════════
   * 
   * Add a single turn to the transcript during the call.
   * Used for real-time transcript building.
   * 
   * @param {string} callId - Call ID
   * @param {Object} turn - Transcript turn
   */
  static async addTranscriptTurn(callId, turn) {
    const { speaker, text, timestamp } = turn;
    
    // Find or create transcript
    let transcript = await CallTranscript.findOne({ callId });
    
    if (!transcript) {
      const call = await CallSummary.findOne({ callId }).select('companyId');
      if (!call) {
        throw new Error(`Call not found: ${callId}`);
      }
      
      transcript = await CallTranscript.create({
        companyId: call.companyId,
        callId,
        turns: []
      });
    }
    
    // Add turn
    const turnNumber = transcript.turns.length + 1;
    transcript.turns.push({
      speaker,
      text,
      timestamp: timestamp || new Date(),
      turnNumber
    });
    
    await transcript.save();
    
    // Update turn count in CallSummary
    await CallSummary.findOneAndUpdate(
      { callId },
      { $set: { turnCount: turnNumber } }
    );
  }
  
  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * GET CALL BY ID
   * ═══════════════════════════════════════════════════════════════════════════
   * 
   * Get a single call with optional transcript.
   * 
   * @param {string} companyId - Company ID
   * @param {string} callId - Call ID
   * @param {boolean} includeTranscript - Include transcript
   * @returns {Promise<Object>}
   */
  static async getCall(companyId, callId, includeTranscript = false) {
    const call = await CallSummary.findOne({ companyId, callId }).lean();
    
    if (!call) {
      return null;
    }
    
    // Include transcript if requested
    if (includeTranscript && call.transcriptRef) {
      const transcript = await CallTranscript.findById(call.transcriptRef).lean();
      call.transcript = transcript?.turns || [];
    }
    
    // Include customer info
    if (call.customerId) {
      const customer = await Customer.findById(call.customerId)
        .select('customerId fullName phone status tags')
        .lean();
      call.customer = customer;
    }
    
    return call;
  }
  
  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * GET RECENT CALLS
   * ═══════════════════════════════════════════════════════════════════════════
   * 
   * Get paginated list of recent calls for a company.
   * 
   * @param {string} companyId - Company ID
   * @param {Object} options - Query options
   * @returns {Promise<Object>}
   */
  static async getRecentCalls(companyId, options = {}) {
    return CallSummary.getRecentCalls(companyId, options);
  }
  
  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * GET CUSTOMER CALLS
   * ═══════════════════════════════════════════════════════════════════════════
   * 
   * Get all calls for a specific customer.
   * 
   * @param {string} companyId - Company ID
   * @param {string} customerId - Customer ID
   * @param {number} limit - Max calls to return
   * @returns {Promise<CallSummary[]>}
   */
  static async getCustomerCalls(companyId, customerId, limit = 50) {
    return CallSummary.find({ companyId, customerId })
      .sort({ startedAt: -1 })
      .limit(limit)
      .lean();
  }
  
  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * FLAG CALL
   * ═══════════════════════════════════════════════════════════════════════════
   * 
   * Flag a call for review.
   * 
   * @param {string} companyId - Company ID
   * @param {string} callId - Call ID
   * @param {string} reason - Flag reason
   * @param {string} flaggedBy - Who flagged it
   */
  static async flagCall(companyId, callId, reason, flaggedBy = 'system') {
    const call = await CallSummary.findOneAndUpdate(
      { companyId, callId },
      { 
        $set: { 
          flagged: true, 
          flagReason: reason 
        } 
      },
      { new: true }
    );
    
    if (!call) {
      throw new Error(`Call not found: ${callId}`);
    }
    
    logger.info('[CALL_SERVICE] Call flagged', {
      callId,
      reason,
      flaggedBy
    });
    
    return call;
  }
  
  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * ADD NOTE
   * ═══════════════════════════════════════════════════════════════════════════
   * 
   * Add an agent note to a call.
   * 
   * @param {string} companyId - Company ID
   * @param {string} callId - Call ID
   * @param {string} note - Note text
   * @param {string} addedBy - Who added it
   */
  static async addNote(companyId, callId, note, addedBy) {
    const call = await CallSummary.findOneAndUpdate(
      { companyId, callId },
      { $set: { agentNote: note } },
      { new: true }
    );
    
    if (!call) {
      throw new Error(`Call not found: ${callId}`);
    }
    
    // Also log as customer event
    if (call.customerId) {
      await CustomerEvent.logEvent({
        companyId,
        customerId: call.customerId,
        type: CustomerEvent.EVENT_TYPES.NOTE_ADDED,
        data: {
          text: note,
          category: 'call',
          callId
        },
        callId,
        createdBy: addedBy
      });
    }
    
    return call;
  }
  
  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * MARK REVIEWED
   * ═══════════════════════════════════════════════════════════════════════════
   * 
   * Mark a call as reviewed with optional rating.
   * 
   * @param {string} companyId - Company ID
   * @param {string} callId - Call ID
   * @param {string} reviewedBy - Who reviewed it
   * @param {number} rating - Rating (1-5)
   * @param {string} feedback - Review feedback
   */
  static async markReviewed(companyId, callId, reviewedBy, rating = null, feedback = null) {
    const updateData = {
      reviewedAt: new Date(),
      reviewedBy
    };
    
    if (rating) updateData.reviewRating = rating;
    if (feedback) updateData.reviewFeedback = feedback;
    
    const call = await CallSummary.findOneAndUpdate(
      { companyId, callId },
      { $set: updateData },
      { new: true }
    );
    
    if (!call) {
      throw new Error(`Call not found: ${callId}`);
    }
    
    // Clear flag if it was flagged
    if (call.flagged) {
      await CallSummary.findOneAndUpdate(
        { callId },
        { $set: { flagged: false } }
      );
    }
    
    return call;
  }
  
  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * GET CALL STATS (Quick)
   * ═══════════════════════════════════════════════════════════════════════════
   * 
   * Get quick stats for today (for dashboard header).
   * 
   * @param {string} companyId - Company ID
   * @returns {Promise<Object>}
   */
  static async getTodayStats(companyId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const stats = await CallSummary.aggregate([
      {
        $match: {
          companyId: new (require('mongoose').Types.ObjectId)(companyId),
          startedAt: { $gte: today, $lt: tomorrow }
        }
      },
      {
        $group: {
          _id: null,
          totalCalls: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$outcome', 'completed'] }, 1, 0] } },
          appointmentsBooked: { $sum: { $cond: [{ $ne: ['$appointmentCreatedId', null] }, 1, 0] } },
          avgDuration: { $avg: '$durationSeconds' }
        }
      }
    ]);
    
    return stats[0] || {
      totalCalls: 0,
      completed: 0,
      appointmentsBooked: 0,
      avgDuration: 0
    };
  }
  
  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * HEALTH CHECK
   * ═══════════════════════════════════════════════════════════════════════════
   */
  static async healthCheck() {
    const startTime = Date.now();
    
    try {
      // Check CallSummary collection
      await CallSummary.findOne().select('_id').lean().maxTimeMS(5000);
      
      // Check CustomerLookup service
      const customerHealth = await CustomerLookup.healthCheck();
      
      return {
        status: customerHealth.status,
        callSummary: 'HEALTHY',
        customerLookup: customerHealth,
        responseTime: Date.now() - startTime
      };
    } catch (error) {
      return {
        status: 'DOWN',
        error: error.message,
        responseTime: Date.now() - startTime
      };
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MODULE EXPORT
// ═══════════════════════════════════════════════════════════════════════════

module.exports = CallSummaryService;

