/**
 * ============================================================================
 * ACTION HOOK EXECUTOR - Execute hooks after scenario matches
 * ============================================================================
 * 
 * This service executes action hooks defined in scenarios.
 * Hooks are triggered AFTER a scenario matches and responds.
 * 
 * BUILT-IN HOOKS:
 * - offer_scheduling: Trigger scheduling flow
 * - capture_contact: Activate contact capture mode
 * - escalate_to_human: Flag for human escalation
 * - log_sentiment_positive/negative: Log sentiment
 * - send_sms_followup: Queue SMS follow-up
 * - start_booking_flow: Activate booking collection
 * - notify_admin: Send admin notification
 * 
 * CUSTOM HOOKS:
 * Custom hooks are logged and can be extended by companies.
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');

class ActionHookExecutor {
    constructor() {
        // Registry of built-in hook handlers
        this.hooks = {
            // Scheduling/Booking hooks
            'offer_scheduling': this._offerScheduling.bind(this),
            'start_booking_flow': this._startBookingFlow.bind(this),
            'require_booking': this._requireBooking.bind(this),
            
            // Contact capture hooks
            'capture_contact': this._captureContact.bind(this),
            'capture_name': this._captureName.bind(this),
            'capture_phone': this._capturePhone.bind(this),
            'capture_email': this._captureEmail.bind(this),
            'capture_address': this._captureAddress.bind(this),
            
            // Escalation hooks
            'escalate_to_human': this._escalateToHuman.bind(this),
            'transfer_to_agent': this._transferToAgent.bind(this),
            'request_callback': this._requestCallback.bind(this),
            
            // Sentiment logging hooks
            'log_sentiment_positive': this._logSentimentPositive.bind(this),
            'log_sentiment_negative': this._logSentimentNegative.bind(this),
            'log_sentiment_frustrated': this._logSentimentFrustrated.bind(this),
            
            // Communication hooks
            'send_sms_followup': this._sendSmsFollowup.bind(this),
            'send_email_followup': this._sendEmailFollowup.bind(this),
            
            // Admin notification hooks
            'notify_admin': this._notifyAdmin.bind(this),
            'flag_for_review': this._flagForReview.bind(this),
            
            // Service-specific hooks
            'emergency_dispatch': this._emergencyDispatch.bind(this),
            'priority_queue': this._priorityQueue.bind(this)
        };
    }
    
    /**
     * Execute all hooks for a scenario
     * @param {Array} hooks - Array of hook IDs to execute
     * @param {Object} context - Execution context
     * @returns {Object} - Results of hook execution
     */
    async executeHooks(hooks, context = {}) {
        if (!hooks || hooks.length === 0) {
            return { executed: [], skipped: [], errors: [] };
        }
        
        const results = {
            executed: [],
            skipped: [],
            errors: [],
            flags: {},
            actions: []
        };
        
        const { callId, companyId, scenarioId, conversationState = {} } = context;
        
        logger.info(`⚡ [HOOK EXECUTOR] Executing ${hooks.length} hooks`, {
            callId,
            companyId,
            scenarioId,
            hooks
        });
        
        for (const hookId of hooks) {
            if (!hookId || typeof hookId !== 'string') {
                results.skipped.push({ hookId, reason: 'Invalid hook ID' });
                continue;
            }
            
            const normalizedHookId = hookId.trim().toLowerCase();
            
            try {
                if (this.hooks[normalizedHookId]) {
                    // Built-in hook
                    const hookResult = await this.hooks[normalizedHookId](context);
                    results.executed.push({
                        hookId: normalizedHookId,
                        type: 'builtin',
                        result: hookResult
                    });
                    
                    // Collect flags and actions from hook results
                    if (hookResult.flag) {
                        results.flags[hookResult.flag] = hookResult.value !== undefined ? hookResult.value : true;
                    }
                    if (hookResult.action) {
                        results.actions.push(hookResult.action);
                    }
                    
                    logger.info(`✅ [HOOK] Executed: ${normalizedHookId}`, {
                        callId,
                        result: hookResult
                    });
                } else {
                    // Custom hook - log it for tracking, can be extended
                    results.executed.push({
                        hookId: normalizedHookId,
                        type: 'custom',
                        result: { logged: true }
                    });
                    
                    logger.info(`📋 [HOOK] Custom hook logged: ${normalizedHookId}`, {
                        callId,
                        companyId,
                        note: 'Custom hooks can be extended by company integrations'
                    });
                }
            } catch (error) {
                results.errors.push({
                    hookId: normalizedHookId,
                    error: error.message
                });
                
                logger.error(`❌ [HOOK] Error executing: ${normalizedHookId}`, {
                    callId,
                    error: error.message
                });
            }
        }
        
        logger.info(`⚡ [HOOK EXECUTOR] Complete`, {
            callId,
            executed: results.executed.length,
            skipped: results.skipped.length,
            errors: results.errors.length,
            flags: Object.keys(results.flags),
            actions: results.actions.length
        });
        
        return results;
    }
    
    // ========================================================================
    // BUILT-IN HOOK IMPLEMENTATIONS
    // ========================================================================
    
    async _offerScheduling(context) {
        return {
            flag: 'shouldOfferScheduling',
            value: true,
            action: { type: 'OFFER_SCHEDULING', data: { triggered: true } }
        };
    }
    
    async _startBookingFlow(context) {
        return {
            flag: 'bookingFlowActive',
            value: true,
            action: { type: 'START_BOOKING_FLOW', data: { mode: 'active' } }
        };
    }
    
    async _requireBooking(context) {
        return {
            flag: 'bookingRequired',
            value: true,
            action: { type: 'REQUIRE_BOOKING', data: { mandatory: true } }
        };
    }
    
    async _captureContact(context) {
        return {
            flag: 'captureContactInfo',
            value: true,
            action: { type: 'CAPTURE_CONTACT', data: { fields: ['name', 'phone'] } }
        };
    }
    
    async _captureName(context) {
        return {
            flag: 'captureName',
            value: true,
            action: { type: 'CAPTURE_ENTITY', data: { entity: 'name' } }
        };
    }
    
    async _capturePhone(context) {
        return {
            flag: 'capturePhone',
            value: true,
            action: { type: 'CAPTURE_ENTITY', data: { entity: 'phone' } }
        };
    }
    
    async _captureEmail(context) {
        return {
            flag: 'captureEmail',
            value: true,
            action: { type: 'CAPTURE_ENTITY', data: { entity: 'email' } }
        };
    }
    
    async _captureAddress(context) {
        return {
            flag: 'captureAddress',
            value: true,
            action: { type: 'CAPTURE_ENTITY', data: { entity: 'address' } }
        };
    }
    
    async _escalateToHuman(context) {
        return {
            flag: 'escalateToHuman',
            value: true,
            action: { type: 'ESCALATE', data: { reason: 'hook_triggered', priority: 'normal' } }
        };
    }
    
    async _transferToAgent(context) {
        return {
            flag: 'transferToAgent',
            value: true,
            action: { type: 'TRANSFER', data: { target: context.transferTarget || 'default_queue' } }
        };
    }
    
    async _requestCallback(context) {
        return {
            flag: 'callbackRequested',
            value: true,
            action: { type: 'REQUEST_CALLBACK', data: { scheduled: true } }
        };
    }
    
    async _logSentimentPositive(context) {
        return {
            flag: 'sentiment',
            value: 'positive',
            action: { type: 'LOG_SENTIMENT', data: { sentiment: 'positive', score: 0.8 } }
        };
    }
    
    async _logSentimentNegative(context) {
        return {
            flag: 'sentiment',
            value: 'negative',
            action: { type: 'LOG_SENTIMENT', data: { sentiment: 'negative', score: -0.6 } }
        };
    }
    
    async _logSentimentFrustrated(context) {
        return {
            flag: 'sentiment',
            value: 'frustrated',
            action: { type: 'LOG_SENTIMENT', data: { sentiment: 'frustrated', score: -0.9, escalate: true } }
        };
    }
    
    async _sendSmsFollowup(context) {
        return {
            flag: 'smsFollowupQueued',
            value: true,
            action: { type: 'QUEUE_SMS', data: { type: 'followup', delay: 0 } }
        };
    }
    
    async _sendEmailFollowup(context) {
        return {
            flag: 'emailFollowupQueued',
            value: true,
            action: { type: 'QUEUE_EMAIL', data: { type: 'followup', delay: 0 } }
        };
    }
    
    async _notifyAdmin(context) {
        return {
            flag: 'adminNotified',
            value: true,
            action: { type: 'NOTIFY_ADMIN', data: { 
                callId: context.callId, 
                scenarioId: context.scenarioId,
                reason: 'hook_triggered'
            }}
        };
    }
    
    async _flagForReview(context) {
        return {
            flag: 'flaggedForReview',
            value: true,
            action: { type: 'FLAG_REVIEW', data: { priority: 'normal' } }
        };
    }
    
    async _emergencyDispatch(context) {
        return {
            flag: 'emergencyDispatch',
            value: true,
            action: { type: 'EMERGENCY_DISPATCH', data: { priority: 'critical', immediate: true } }
        };
    }
    
    async _priorityQueue(context) {
        return {
            flag: 'priorityQueue',
            value: true,
            action: { type: 'PRIORITY_QUEUE', data: { boost: true } }
        };
    }
}

// Export singleton instance
module.exports = new ActionHookExecutor();
