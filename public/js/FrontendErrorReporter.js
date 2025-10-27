/**
 * ============================================================================
 * FRONTEND ERROR REPORTER - Client-Side Error Monitoring
 * ============================================================================
 * 
 * PURPOSE:
 * Centralized error handling for all frontend API calls. Sends alerts to
 * Notification Center and provides user-friendly error recovery.
 * 
 * FEATURES:
 * - Automatic error categorization (network, auth, validation, server)
 * - Alert sending to backend Notification Center
 * - User-friendly error messages with retry buttons
 * - Pattern detection (repeated failures)
 * - Graceful degradation
 * 
 * USAGE:
 * ```javascript
 * import FrontendErrorReporter from './js/FrontendErrorReporter.js';
 * 
 * const reporter = new FrontendErrorReporter({
 *     context: 'Global AI Brain',
 *     module: 'Behaviors'
 * });
 * 
 * try {
 *     const data = await fetchBehaviors();
 * } catch (error) {
 *     await reporter.reportError({
 *         error,
 *         operation: 'fetchBehaviors',
 *         userMessage: 'Failed to load AI behavior templates',
 *         retryFunction: fetchBehaviors
 *     });
 * }
 * ```
 * 
 * ============================================================================
 */

class FrontendErrorReporter {
    constructor(config = {}) {
        this.context = config.context || 'Frontend';
        this.module = config.module || 'Unknown';
        this.alertEndpoint = config.alertEndpoint || '/api/admin/notifications/frontend-error';
        
        // Track error patterns
        this.errorCache = new Map();
        this.ERROR_PATTERN_THRESHOLD = 3; // Alert after 3 similar errors
        this.ERROR_PATTERN_WINDOW = 60000; // 1 minute window
        
        console.log(`📊 [FRONTEND ERROR REPORTER] Initialized for ${this.context} - ${this.module}`);
    }

    /**
     * ============================================================================
     * MAIN ERROR REPORTING METHOD
     * ============================================================================
     * Categorizes error, sends alert, shows UI message, provides retry
     * 
     * @param {Object} options - Error reporting options
     * @param {Error} options.error - The error object
     * @param {string} options.operation - Operation name (e.g., 'fetchBehaviors')
     * @param {string} options.userMessage - User-friendly message
     * @param {Function} options.retryFunction - Function to retry the operation
     * @param {Object} options.additionalContext - Extra context data
     * @returns {Promise<void>}
     */
    async reportError({
        error,
        operation,
        userMessage = 'An error occurred',
        retryFunction = null,
        additionalContext = {}
    }) {
        try {
            // Categorize error
            const errorInfo = this._categorizeError(error);
            
            // Check if we should send alert (pattern detection)
            const shouldAlert = this._shouldSendAlert(operation, errorInfo);
            
            // Log error
            console.error(`❌ [${this.context}] ${operation} failed:`, {
                error: error.message,
                category: errorInfo.category,
                severity: errorInfo.severity,
                stack: error.stack
            });

            // Send alert to Notification Center if threshold met
            if (shouldAlert) {
                await this._sendAlertToBackend({
                    operation,
                    errorInfo,
                    additionalContext
                });
            }

            // Show user-friendly error message with retry option
            this._showUserError({
                userMessage,
                errorInfo,
                retryFunction,
                operation
            });

        } catch (reportError) {
            // If error reporting itself fails, log to console only
            console.error('❌ [FRONTEND ERROR REPORTER] Failed to report error:', reportError);
        }
    }

    /**
     * ============================================================================
     * CATEGORIZE ERROR
     * ============================================================================
     * Determines error type, severity, and user-facing vs internal
     */
    _categorizeError(error) {
        let category = 'UNKNOWN';
        let severity = 'WARNING';
        let customerFacing = false;
        let httpStatus = null;

        // Network errors
        if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
            category = 'NETWORK';
            severity = 'CRITICAL';
            customerFacing = true;
            httpStatus = 0;
        }
        // HTTP errors
        else if (error.message?.includes('HTTP error')) {
            const statusMatch = error.message.match(/status: (\d+)/);
            httpStatus = statusMatch ? parseInt(statusMatch[1]) : 500;

            if (httpStatus === 401 || httpStatus === 403) {
                category = 'AUTHENTICATION';
                severity = 'WARNING';
                customerFacing = true;
            } else if (httpStatus === 404) {
                category = 'NOT_FOUND';
                severity = 'INFO';
                customerFacing = false;
            } else if (httpStatus === 429) {
                category = 'RATE_LIMIT';
                severity = 'WARNING';
                customerFacing = true;
            } else if (httpStatus === 500 || httpStatus === 502 || httpStatus === 503) {
                category = 'SERVER_ERROR';
                severity = 'CRITICAL';
                customerFacing = false;
            } else if (httpStatus >= 400 && httpStatus < 500) {
                category = 'CLIENT_ERROR';
                severity = 'WARNING';
                customerFacing = true;
            } else {
                category = 'SERVER_ERROR';
                severity = 'CRITICAL';
                customerFacing = false;
            }
        }
        // Timeout errors
        else if (error.name === 'AbortError' || error.message?.includes('timeout')) {
            category = 'TIMEOUT';
            severity = 'WARNING';
            customerFacing = true;
        }
        // JSON parse errors (backend returned invalid data)
        else if (error instanceof SyntaxError || error.message?.includes('JSON')) {
            category = 'INVALID_RESPONSE';
            severity = 'CRITICAL';
            customerFacing = false;
        }
        // Default
        else {
            category = 'UNHANDLED';
            severity = 'CRITICAL';
            customerFacing = false;
        }

        return {
            category,
            severity,
            customerFacing,
            httpStatus,
            message: error.message,
            stack: error.stack
        };
    }

    /**
     * ============================================================================
     * PATTERN DETECTION - Should we send alert?
     * ============================================================================
     * Tracks error patterns and only sends alert after threshold
     */
    _shouldSendAlert(operation, errorInfo) {
        const now = Date.now();
        const errorKey = `${operation}::${errorInfo.category}`;
        
        let pattern = this.errorCache.get(errorKey);

        if (!pattern) {
            // First occurrence
            pattern = {
                count: 1,
                firstSeen: now,
                lastSeen: now,
                lastAlerted: 0
            };
            this.errorCache.set(errorKey, pattern);
            return false; // Don't alert on first occurrence
        }

        // Update pattern
        pattern.count++;
        pattern.lastSeen = now;

        // Reset count if outside time window
        if (now - pattern.firstSeen > this.ERROR_PATTERN_WINDOW) {
            pattern.count = 1;
            pattern.firstSeen = now;
        }

        // Check if we should alert
        const shouldAlert = pattern.count >= this.ERROR_PATTERN_THRESHOLD;

        if (shouldAlert) {
            pattern.lastAlerted = now;
            console.warn(`🚨 [PATTERN DETECTED] ${operation} failed ${pattern.count} times - sending alert`);
        }

        return shouldAlert;
    }

    /**
     * ============================================================================
     * SEND ALERT TO BACKEND
     * ============================================================================
     * Sends error details to backend, which forwards to Notification Center
     */
    async _sendAlertToBackend({ operation, errorInfo, additionalContext }) {
        try {
            const token = this._getAuthToken();
            
            const alertData = {
                context: this.context,
                module: this.module,
                operation,
                errorCategory: errorInfo.category,
                errorMessage: errorInfo.message,
                severity: errorInfo.severity,
                httpStatus: errorInfo.httpStatus,
                stackTrace: errorInfo.stack,
                userAgent: navigator.userAgent,
                url: window.location.href,
                timestamp: new Date().toISOString(),
                additionalContext
            };

            const response = await fetch(this.alertEndpoint, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(alertData)
            });

            if (response.ok) {
                console.log(`✅ [ALERT SENT] ${operation} error reported to Notification Center`);
            } else {
                console.warn(`⚠️ [ALERT FAILED] Could not send alert (status: ${response.status})`);
            }
        } catch (alertError) {
            console.error('❌ [ALERT SEND FAILED]', alertError);
            // Don't throw - alerting failure shouldn't break the app
        }
    }

    /**
     * ============================================================================
     * SHOW USER-FRIENDLY ERROR
     * ============================================================================
     * Displays error message in UI with retry button
     */
    _showUserError({ userMessage, errorInfo, retryFunction, operation }) {
        // Use existing showNotification if available, otherwise create fallback
        if (typeof showNotification === 'function') {
            showNotification(userMessage, 'error');
        } else {
            console.error(`USER ERROR: ${userMessage}`);
        }

        // Create detailed error card (optional enhancement)
        const detailMessage = this._getDetailedErrorMessage(errorInfo);
        console.log(`📋 [ERROR DETAILS] ${detailMessage}`);

        // If retry function provided, log it for user
        if (retryFunction) {
            console.log(`🔄 [RETRY AVAILABLE] Run 'window.retryLastOperation()' to retry ${operation}`);
            window.retryLastOperation = retryFunction;
        }
    }

    /**
     * ============================================================================
     * GET DETAILED ERROR MESSAGE
     * ============================================================================
     * Provides context-aware error messages for users
     */
    _getDetailedErrorMessage(errorInfo) {
        switch (errorInfo.category) {
            case 'NETWORK':
                return 'Network connection failed. Please check your internet connection and try again.';
            case 'AUTHENTICATION':
                return 'Your session may have expired. Please refresh the page and log in again.';
            case 'NOT_FOUND':
                return 'The requested data was not found. It may have been deleted or moved.';
            case 'RATE_LIMIT':
                return 'Too many requests. Please wait a moment and try again.';
            case 'SERVER_ERROR':
                return 'Server error. Our team has been notified and is working on a fix.';
            case 'TIMEOUT':
                return 'Request timed out. The server may be slow or overloaded.';
            case 'INVALID_RESPONSE':
                return 'Received invalid data from server. This indicates a backend issue.';
            default:
                return 'An unexpected error occurred. Please try again or contact support.';
        }
    }

    /**
     * ============================================================================
     * GET AUTH TOKEN
     * ============================================================================
     * Retrieves JWT token from localStorage or cookies
     */
    _getAuthToken() {
        // Try localStorage first
        let token = localStorage.getItem('authToken');
        
        // Try sessionStorage
        if (!token) {
            token = sessionStorage.getItem('authToken');
        }
        
        // Try cookies
        if (!token) {
            const cookies = document.cookie.split(';');
            for (const cookie of cookies) {
                const [name, value] = cookie.trim().split('=');
                if (name === 'authToken' || name === 'token') {
                    token = value;
                    break;
                }
            }
        }
        
        return token || '';
    }

    /**
     * ============================================================================
     * CLEANUP OLD PATTERNS
     * ============================================================================
     * Removes expired error patterns from cache
     */
    cleanup() {
        const now = Date.now();
        const expiredKeys = [];

        for (const [key, pattern] of this.errorCache.entries()) {
            if (now - pattern.lastSeen > this.ERROR_PATTERN_WINDOW * 5) {
                expiredKeys.push(key);
            }
        }

        expiredKeys.forEach(key => this.errorCache.delete(key));

        if (expiredKeys.length > 0) {
            console.debug(`🧹 [CLEANUP] Removed ${expiredKeys.length} expired error patterns`);
        }
    }
}

// Cleanup old patterns every 5 minutes
setInterval(() => {
    if (window.frontendErrorReporter) {
        window.frontendErrorReporter.cleanup();
    }
}, 300000);

// Export for ES6 modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FrontendErrorReporter;
}

