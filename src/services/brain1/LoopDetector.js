/**
 * ============================================================================
 * LOOP DETECTOR - BRAIN-1 SAFETY NET
 * ============================================================================
 * 
 * Prevents the AI from getting stuck in infinite loops by detecting when
 * the same response pattern is being emitted multiple times.
 * 
 * MULTI-TENANT SAFE: Works with normalized response signatures, not content.
 * 
 * ============================================================================
 */

const logger = require('../../../utils/logger');

// In-memory store for response history per call
// Key: callId, Value: { responses: [], lastUpdated: timestamp }
const callResponseHistory = new Map();

// Auto-cleanup interval (clear calls older than 30 minutes)
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CALL_AGE_MS = 30 * 60 * 1000; // 30 minutes

// Start cleanup interval
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [callId, data] of callResponseHistory.entries()) {
        if (now - data.lastUpdated > MAX_CALL_AGE_MS) {
            callResponseHistory.delete(callId);
            cleaned++;
        }
    }
    if (cleaned > 0) {
        logger.info('[LOOP DETECTOR] Cleaned up stale entries', { cleaned });
    }
}, CLEANUP_INTERVAL_MS);

/**
 * Normalize a response to a signature for comparison
 * Strips names, numbers, and minor variations to detect "same pattern"
 * 
 * @param {string} response - The AI response text
 * @returns {string} - Normalized signature
 */
function normalizeToSignature(response) {
    if (!response) return 'EMPTY';
    
    return response
        .toLowerCase()
        // Remove specific names (2+ capital letters followed by lowercase)
        .replace(/\b[A-Z][a-z]+\b/g, 'NAME')
        // Remove phone numbers
        .replace(/\+?\d{10,}/g, 'PHONE')
        // Remove times
        .replace(/\d{1,2}:\d{2}(?:\s*(?:am|pm))?/gi, 'TIME')
        // Remove dates
        .replace(/\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?/g, 'DATE')
        // Remove standalone numbers
        .replace(/\b\d+\b/g, 'NUM')
        // Normalize whitespace
        .replace(/\s+/g, ' ')
        .trim()
        // Take first 100 chars as signature
        .substring(0, 100);
}

/**
 * Record a response for a call
 * 
 * @param {string} callId - The call SID
 * @param {string} response - The AI response text
 */
function recordResponse(callId, response) {
    if (!callId || !response) return;
    
    const signature = normalizeToSignature(response);
    
    if (!callResponseHistory.has(callId)) {
        callResponseHistory.set(callId, {
            responses: [],
            lastUpdated: Date.now()
        });
    }
    
    const data = callResponseHistory.get(callId);
    data.responses.push({
        signature,
        timestamp: Date.now(),
        originalLength: response.length
    });
    data.lastUpdated = Date.now();
    
    // Keep only last 5 responses
    if (data.responses.length > 5) {
        data.responses.shift();
    }
}

/**
 * Check if the call is stuck in a loop
 * 
 * @param {string} callId - The call SID
 * @param {string} pendingResponse - The response about to be sent (optional)
 * @returns {Object} - { isLooping: boolean, loopCount: number, signature: string }
 */
function checkForLoop(callId, pendingResponse = null) {
    const data = callResponseHistory.get(callId);
    
    if (!data || data.responses.length < 2) {
        return { isLooping: false, loopCount: 0, signature: null };
    }
    
    // Get the signature to check (either pending or last recorded)
    const signatureToCheck = pendingResponse 
        ? normalizeToSignature(pendingResponse)
        : data.responses[data.responses.length - 1]?.signature;
    
    if (!signatureToCheck) {
        return { isLooping: false, loopCount: 0, signature: null };
    }
    
    // Count consecutive matches from the end
    let loopCount = 0;
    for (let i = data.responses.length - 1; i >= 0; i--) {
        if (data.responses[i].signature === signatureToCheck) {
            loopCount++;
        } else {
            break; // Stop at first different response
        }
    }
    
    // Also check if pending matches the last response
    if (pendingResponse) {
        const lastSignature = data.responses[data.responses.length - 1]?.signature;
        if (lastSignature === signatureToCheck) {
            loopCount++;
        }
    }
    
    const isLooping = loopCount >= 2;
    
    if (isLooping) {
        logger.warn('[LOOP DETECTOR] 🔄 LOOP DETECTED!', {
            callId: callId.substring(0, 12),
            loopCount,
            signature: signatureToCheck.substring(0, 50)
        });
    }
    
    return { isLooping, loopCount, signature: signatureToCheck };
}

/**
 * Check if call is stuck (convenience method)
 * 
 * @param {string} callId - The call SID
 * @returns {boolean}
 */
function isStuck(callId) {
    return checkForLoop(callId).isLooping;
}

/**
 * Clear history for a call (call ended)
 * 
 * @param {string} callId - The call SID
 */
function clearCall(callId) {
    callResponseHistory.delete(callId);
}

/**
 * Get stats for debugging
 */
function getStats() {
    return {
        activeCalls: callResponseHistory.size,
        entries: Array.from(callResponseHistory.entries()).map(([callId, data]) => ({
            callId: callId.substring(0, 12),
            responseCount: data.responses.length,
            lastUpdated: new Date(data.lastUpdated).toISOString()
        }))
    };
}

module.exports = {
    recordResponse,
    checkForLoop,
    isStuck,
    clearCall,
    getStats,
    normalizeToSignature
};

