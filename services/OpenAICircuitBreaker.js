/**
 * ============================================================================
 * OPENAI CIRCUIT BREAKER - Resilience for LLM Calls
 * ============================================================================
 * 
 * PURPOSE: Prevent cascade failures when OpenAI is slow or down
 * 
 * STATES:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: OpenAI is failing, requests fail fast without waiting
 * - HALF_OPEN: Testing if OpenAI recovered, allow limited requests
 * 
 * CONFIGURATION:
 * - timeout: Max time to wait for OpenAI response (ms)
 * - errorThreshold: Number of failures before opening circuit
 * - resetTimeout: Time before attempting to close circuit (ms)
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');

class OpenAICircuitBreaker {
    constructor(options = {}) {
        this.name = options.name || 'openai';
        this.timeout = options.timeout || 8000;           // 8 seconds max
        this.errorThreshold = options.errorThreshold || 5; // 5 failures to open
        this.resetTimeout = options.resetTimeout || 30000; // 30 seconds before retry
        this.halfOpenRequests = options.halfOpenRequests || 1; // Requests to test in half-open
        
        // State
        this.state = 'CLOSED';
        this.failures = 0;
        this.successes = 0;
        this.lastFailureTime = null;
        this.halfOpenAttempts = 0;
        
        // Metrics
        this.metrics = {
            totalCalls: 0,
            successfulCalls: 0,
            failedCalls: 0,
            circuitOpenCount: 0,
            fallbacksUsed: 0,
            lastStateChange: new Date()
        };
        
        logger.info('[CIRCUIT BREAKER] Initialized', {
            name: this.name,
            timeout: this.timeout,
            errorThreshold: this.errorThreshold,
            resetTimeout: this.resetTimeout
        });
    }
    
    /**
     * Execute a function with circuit breaker protection
     * @param {Function} fn - Async function to execute (the OpenAI call)
     * @param {Function} fallback - Fallback function if circuit is open or call fails
     * @param {Object} context - Context for logging (callId, companyId, etc.)
     * @returns {Promise<any>} Result from fn or fallback
     */
    async execute(fn, fallback, context = {}) {
        this.metrics.totalCalls++;
        
        // Check if circuit should transition from OPEN to HALF_OPEN
        if (this.state === 'OPEN') {
            const timeSinceLastFailure = Date.now() - this.lastFailureTime;
            if (timeSinceLastFailure >= this.resetTimeout) {
                this.transitionTo('HALF_OPEN', 'reset_timeout_elapsed');
            }
        }
        
        // If circuit is OPEN, fail fast
        if (this.state === 'OPEN') {
            logger.warn('[CIRCUIT BREAKER] Circuit OPEN - using fallback', {
                name: this.name,
                timeSinceOpen: Date.now() - this.lastFailureTime,
                resetIn: this.resetTimeout - (Date.now() - this.lastFailureTime),
                ...context
            });
            this.metrics.fallbacksUsed++;
            return await fallback();
        }
        
        // If HALF_OPEN, limit concurrent test requests
        if (this.state === 'HALF_OPEN' && this.halfOpenAttempts >= this.halfOpenRequests) {
            logger.debug('[CIRCUIT BREAKER] HALF_OPEN limit reached - using fallback', {
                name: this.name,
                halfOpenAttempts: this.halfOpenAttempts,
                ...context
            });
            this.metrics.fallbacksUsed++;
            return await fallback();
        }
        
        if (this.state === 'HALF_OPEN') {
            this.halfOpenAttempts++;
        }
        
        // Execute the function with timeout
        try {
            const result = await this.executeWithTimeout(fn, this.timeout);
            this.onSuccess();
            return result;
            
        } catch (error) {
            this.onFailure(error, context);
            
            // If we hit error threshold, use fallback for THIS request too
            logger.warn('[CIRCUIT BREAKER] Call failed - using fallback', {
                name: this.name,
                error: error.message,
                failures: this.failures,
                state: this.state,
                ...context
            });
            this.metrics.fallbacksUsed++;
            return await fallback();
        }
    }
    
    /**
     * Execute function with timeout
     */
    async executeWithTimeout(fn, timeout) {
        return new Promise(async (resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Circuit breaker timeout after ${timeout}ms`));
            }, timeout);
            
            try {
                const result = await fn();
                clearTimeout(timer);
                resolve(result);
            } catch (error) {
                clearTimeout(timer);
                reject(error);
            }
        });
    }
    
    /**
     * Handle successful call
     */
    onSuccess() {
        this.metrics.successfulCalls++;
        this.successes++;
        
        if (this.state === 'HALF_OPEN') {
            // Success in half-open state - close the circuit
            this.transitionTo('CLOSED', 'half_open_success');
            this.failures = 0;
            this.halfOpenAttempts = 0;
            
            logger.info('[CIRCUIT BREAKER] Circuit CLOSED after successful test', {
                name: this.name
            });
        } else if (this.state === 'CLOSED') {
            // Reset failure count on success
            this.failures = 0;
        }
    }
    
    /**
     * Handle failed call
     */
    onFailure(error, context = {}) {
        this.metrics.failedCalls++;
        this.failures++;
        this.lastFailureTime = Date.now();
        
        logger.error('[CIRCUIT BREAKER] Call failed', {
            name: this.name,
            error: error.message,
            failures: this.failures,
            threshold: this.errorThreshold,
            state: this.state,
            ...context
        });
        
        if (this.state === 'HALF_OPEN') {
            // Failure in half-open state - back to open
            this.transitionTo('OPEN', 'half_open_failure');
            this.halfOpenAttempts = 0;
            
        } else if (this.state === 'CLOSED' && this.failures >= this.errorThreshold) {
            // Hit threshold - open the circuit
            this.transitionTo('OPEN', 'error_threshold_reached');
            this.metrics.circuitOpenCount++;
            
            logger.error('[CIRCUIT BREAKER] 🔴 Circuit OPENED due to failures', {
                name: this.name,
                failures: this.failures,
                threshold: this.errorThreshold,
                willRetryIn: this.resetTimeout
            });
        }
    }
    
    /**
     * Transition to a new state
     */
    transitionTo(newState, reason) {
        const oldState = this.state;
        this.state = newState;
        this.metrics.lastStateChange = new Date();
        
        logger.info('[CIRCUIT BREAKER] State transition', {
            name: this.name,
            from: oldState,
            to: newState,
            reason
        });
    }
    
    /**
     * Get current status for health checks
     */
    getStatus() {
        return {
            name: this.name,
            state: this.state,
            failures: this.failures,
            errorThreshold: this.errorThreshold,
            lastFailureTime: this.lastFailureTime,
            timeSinceLastFailure: this.lastFailureTime ? Date.now() - this.lastFailureTime : null,
            metrics: this.metrics,
            config: {
                timeout: this.timeout,
                errorThreshold: this.errorThreshold,
                resetTimeout: this.resetTimeout
            }
        };
    }
    
    /**
     * Force reset the circuit (for admin/debugging)
     */
    forceReset() {
        const oldState = this.state;
        this.state = 'CLOSED';
        this.failures = 0;
        this.successes = 0;
        this.halfOpenAttempts = 0;
        this.lastFailureTime = null;
        
        logger.warn('[CIRCUIT BREAKER] Force reset', {
            name: this.name,
            previousState: oldState
        });
        
        return { success: true, previousState: oldState };
    }
}

// ============================================================================
// SINGLETON INSTANCES FOR DIFFERENT LLM USE CASES
// ============================================================================

// Main circuit breaker for Frontline-Intel calls (used on every call)
const frontlineCircuitBreaker = new OpenAICircuitBreaker({
    name: 'frontline-intel',
    timeout: 5000,          // 5s timeout (frontline should be fast)
    errorThreshold: 5,      // 5 failures to open
    resetTimeout: 30000     // 30s before retry
});

// Circuit breaker for Tier-3 LLM fallback (more tolerance for slowness)
const tier3CircuitBreaker = new OpenAICircuitBreaker({
    name: 'tier3-llm',
    timeout: 10000,         // 10s timeout (tier 3 can be slower)
    errorThreshold: 3,      // 3 failures to open (less tolerant - it's expensive)
    resetTimeout: 60000     // 60s before retry
});

// Circuit breaker for LLM-0 Orchestration
const orchestratorCircuitBreaker = new OpenAICircuitBreaker({
    name: 'llm0-orchestrator',
    timeout: 8000,          // 8s timeout
    errorThreshold: 5,      
    resetTimeout: 30000     
});

module.exports = {
    OpenAICircuitBreaker,
    frontlineCircuitBreaker,
    tier3CircuitBreaker,
    orchestratorCircuitBreaker
};

