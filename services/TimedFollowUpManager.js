/**
 * ============================================================================
 * TIMED FOLLOW-UP MANAGER - Trigger follow-up messages after idle periods
 * ============================================================================
 * 
 * This service manages timed follow-up prompts for scenarios.
 * When a scenario has timedFollowUp enabled, this manager:
 * 1. Schedules a timer after the scenario response
 * 2. Triggers a follow-up message if the caller goes idle
 * 3. Handles extension requests
 * 
 * USAGE:
 * - Call scheduleFollowUp() after a scenario matches
 * - Call clearFollowUp() when caller responds
 * - The manager will call the callback when timer fires
 * 
 * CONFIGURATION (from scenario.timedFollowUp):
 * {
 *   enabled: true,
 *   delaySeconds: 50,      // How long to wait
 *   messages: [...],        // Follow-up messages (random selection)
 *   extensionSeconds: 30   // Additional time if requested
 * }
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');
const EventEmitter = require('events');

class TimedFollowUpManager extends EventEmitter {
    constructor() {
        super();
        // Store active timers by callId
        this.activeTimers = new Map();
        // Store follow-up state by callId
        this.followUpState = new Map();
    }
    
    /**
     * Schedule a timed follow-up for a call
     * @param {string} callId - Unique call identifier
     * @param {Object} timedFollowUp - Configuration from scenario
     * @param {Object} context - Additional context (companyId, scenarioId, etc.)
     * @param {Function} callback - Called when timer fires (receives message)
     * @returns {boolean} - Whether follow-up was scheduled
     */
    scheduleFollowUp(callId, timedFollowUp, context = {}, callback) {
        if (!callId) {
            logger.warn('[TIMED FOLLOWUP] No callId provided');
            return false;
        }
        
        // Check if enabled
        if (!timedFollowUp || !timedFollowUp.enabled) {
            logger.debug(`[TIMED FOLLOWUP] Not enabled for call ${callId}`);
            return false;
        }
        
        // Clear any existing timer for this call
        this.clearFollowUp(callId);
        
        const delaySeconds = timedFollowUp.delaySeconds || 50;
        const delayMs = delaySeconds * 1000;
        const messages = timedFollowUp.messages || ['Are you still there?'];
        const extensionSeconds = timedFollowUp.extensionSeconds || 30;
        
        logger.info(`⏰ [TIMED FOLLOWUP] Scheduling for call ${callId}`, {
            delaySeconds,
            messagesCount: messages.length,
            extensionSeconds,
            scenarioId: context.scenarioId
        });
        
        // Store state
        this.followUpState.set(callId, {
            timedFollowUp,
            context,
            callback,
            scheduledAt: Date.now(),
            delayMs,
            attemptCount: 0,
            maxAttempts: timedFollowUp.maxAttempts || 2
        });
        
        // Schedule the timer
        const timerId = setTimeout(() => {
            this._triggerFollowUp(callId);
        }, delayMs);
        
        this.activeTimers.set(callId, timerId);
        
        // Emit event for tracking
        this.emit('scheduled', { callId, delaySeconds, context });
        
        return true;
    }
    
    /**
     * Clear/cancel a scheduled follow-up
     * @param {string} callId - Call identifier
     * @returns {boolean} - Whether a timer was cleared
     */
    clearFollowUp(callId) {
        if (!callId) return false;
        
        const timerId = this.activeTimers.get(callId);
        if (timerId) {
            clearTimeout(timerId);
            this.activeTimers.delete(callId);
            
            logger.info(`⏰ [TIMED FOLLOWUP] Cleared timer for call ${callId}`);
            this.emit('cleared', { callId, reason: 'caller_responded' });
            
            return true;
        }
        
        return false;
    }
    
    /**
     * Extend the follow-up timer (caller requested more time)
     * @param {string} callId - Call identifier
     * @returns {boolean} - Whether extension was granted
     */
    extendFollowUp(callId) {
        const state = this.followUpState.get(callId);
        if (!state) {
            logger.debug(`[TIMED FOLLOWUP] No state to extend for call ${callId}`);
            return false;
        }
        
        // Clear existing timer
        this.clearFollowUp(callId);
        
        const extensionMs = (state.timedFollowUp.extensionSeconds || 30) * 1000;
        
        logger.info(`⏰ [TIMED FOLLOWUP] Extending by ${state.timedFollowUp.extensionSeconds}s for call ${callId}`);
        
        // Schedule new timer with extension
        const timerId = setTimeout(() => {
            this._triggerFollowUp(callId);
        }, extensionMs);
        
        this.activeTimers.set(callId, timerId);
        this.emit('extended', { callId, extensionSeconds: state.timedFollowUp.extensionSeconds });
        
        return true;
    }
    
    /**
     * Internal: Trigger the follow-up message
     * @private
     */
    _triggerFollowUp(callId) {
        const state = this.followUpState.get(callId);
        if (!state) {
            logger.debug(`[TIMED FOLLOWUP] No state found for call ${callId}, timer may have been cleared`);
            return;
        }
        
        const { timedFollowUp, context, callback, attemptCount, maxAttempts } = state;
        const messages = timedFollowUp.messages || ['Are you still there?'];
        
        // Check attempt count
        if (attemptCount >= maxAttempts) {
            logger.info(`⏰ [TIMED FOLLOWUP] Max attempts (${maxAttempts}) reached for call ${callId}`, {
                action: 'Consider escalation or ending call'
            });
            this.emit('maxAttemptsReached', { callId, attemptCount, context });
            this._cleanup(callId);
            return;
        }
        
        // Select a random message
        const message = messages[Math.floor(Math.random() * messages.length)];
        
        logger.info(`⏰ [TIMED FOLLOWUP] Triggering for call ${callId}`, {
            attemptCount: attemptCount + 1,
            maxAttempts,
            messagePreview: message.substring(0, 50)
        });
        
        // Update attempt count
        state.attemptCount = attemptCount + 1;
        this.followUpState.set(callId, state);
        
        // Emit event
        this.emit('triggered', { 
            callId, 
            message, 
            attemptCount: state.attemptCount, 
            context 
        });
        
        // Call the callback if provided
        if (typeof callback === 'function') {
            try {
                callback({
                    message,
                    attemptCount: state.attemptCount,
                    maxAttempts,
                    isLastAttempt: state.attemptCount >= maxAttempts,
                    context
                });
            } catch (error) {
                logger.error(`❌ [TIMED FOLLOWUP] Callback error for call ${callId}`, {
                    error: error.message
                });
            }
        }
        
        // If not at max attempts, schedule next follow-up
        if (state.attemptCount < maxAttempts) {
            const nextDelayMs = (timedFollowUp.intervalSeconds || timedFollowUp.delaySeconds || 30) * 1000;
            
            const timerId = setTimeout(() => {
                this._triggerFollowUp(callId);
            }, nextDelayMs);
            
            this.activeTimers.set(callId, timerId);
        } else {
            // Clean up after max attempts
            this._cleanup(callId);
        }
    }
    
    /**
     * Clean up state for a call
     * @private
     */
    _cleanup(callId) {
        this.activeTimers.delete(callId);
        this.followUpState.delete(callId);
        logger.debug(`[TIMED FOLLOWUP] Cleaned up state for call ${callId}`);
    }
    
    /**
     * End a call's follow-up tracking completely
     * @param {string} callId - Call identifier
     */
    endCall(callId) {
        this.clearFollowUp(callId);
        this._cleanup(callId);
        this.emit('ended', { callId });
    }
    
    /**
     * Get follow-up state for a call (for debugging)
     * @param {string} callId - Call identifier
     * @returns {Object|null} - Current state or null
     */
    getState(callId) {
        const state = this.followUpState.get(callId);
        if (!state) return null;
        
        return {
            hasActiveTimer: this.activeTimers.has(callId),
            scheduledAt: state.scheduledAt,
            attemptCount: state.attemptCount,
            maxAttempts: state.maxAttempts,
            delayMs: state.delayMs,
            timedFollowUp: state.timedFollowUp
        };
    }
    
    /**
     * Get count of active timers (for monitoring)
     * @returns {number}
     */
    getActiveTimerCount() {
        return this.activeTimers.size;
    }
    
    /**
     * Clear all timers (for shutdown/cleanup)
     */
    clearAll() {
        for (const [callId, timerId] of this.activeTimers) {
            clearTimeout(timerId);
        }
        this.activeTimers.clear();
        this.followUpState.clear();
        logger.info(`[TIMED FOLLOWUP] Cleared all ${this.activeTimers.size} timers`);
    }
}

// Export singleton instance
module.exports = new TimedFollowUpManager();
