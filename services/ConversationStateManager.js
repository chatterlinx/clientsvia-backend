/**
 * ============================================================================
 * CONVERSATION STATE MANAGER
 * ============================================================================
 * 
 * Maintains full conversation history in Redis for each call.
 * This is what enables the LLM to have CONTEXT and act like a real person.
 * 
 * Without this, every turn is "first contact" and the AI sounds dumb.
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');

// Try to load Redis, but work without it if needed
let redisClient = null;
try {
    const { createClient } = require('redis');
    redisClient = require('../config/redis');
} catch (e) {
    logger.warn('[CONVERSATION STATE] Redis not available, using in-memory fallback');
}

// In-memory fallback for development/testing
const memoryStore = new Map();

class ConversationStateManager {
    
    /**
     * Get full conversation state for a call
     * 
     * @param {string} callId - Twilio Call SID
     * @returns {Promise<Object>} Full conversation state
     */
    static async getState(callId) {
        if (!callId) return this.getDefaultState();
        
        try {
            const key = `conv:${callId}`;
            
            if (redisClient?.isReady) {
                const data = await redisClient.get(key);
                if (data) {
                    const parsed = JSON.parse(data);
                    logger.debug('[CONVERSATION STATE] Loaded from Redis', { callId, turns: parsed.history?.length || 0 });
                    return parsed;
                }
            } else if (memoryStore.has(key)) {
                return memoryStore.get(key);
            }
            
            return this.getDefaultState();
            
        } catch (error) {
            logger.error('[CONVERSATION STATE] Get failed', { callId, error: error.message });
            return this.getDefaultState();
        }
    }
    
    /**
     * Save conversation state
     * 
     * @param {string} callId - Twilio Call SID
     * @param {Object} state - Full conversation state
     * @returns {Promise<boolean>} Success
     */
    static async saveState(callId, state) {
        if (!callId) return false;
        
        try {
            const key = `conv:${callId}`;
            const ttl = 3600; // 1 hour TTL
            
            // Ensure history doesn't grow unbounded
            if (state.history && state.history.length > 20) {
                state.history = state.history.slice(-20);
            }
            
            const data = JSON.stringify(state);
            
            if (redisClient?.isReady) {
                await redisClient.setEx(key, ttl, data);
            } else {
                memoryStore.set(key, state);
                // Clean up old entries
                if (memoryStore.size > 100) {
                    const firstKey = memoryStore.keys().next().value;
                    memoryStore.delete(firstKey);
                }
            }
            
            logger.debug('[CONVERSATION STATE] Saved', { callId, turns: state.history?.length || 0 });
            return true;
            
        } catch (error) {
            logger.error('[CONVERSATION STATE] Save failed', { callId, error: error.message });
            return false;
        }
    }
    
    /**
     * Add a turn to the conversation history
     * 
     * @param {string} callId - Twilio Call SID
     * @param {string} role - 'caller' or 'agent'
     * @param {string} content - What was said
     * @param {Object} metadata - Optional metadata (slots extracted, mode, etc.)
     */
    static async addTurn(callId, role, content, metadata = {}) {
        if (!callId || !content) return;
        
        const state = await this.getState(callId);
        
        state.history.push({
            role,
            content,
            timestamp: Date.now(),
            ...metadata
        });
        
        state.turnCount = (state.turnCount || 0) + 1;
        state.lastUpdate = Date.now();
        
        await this.saveState(callId, state);
    }
    
    /**
     * Update slots in the conversation state
     * 
     * @param {string} callId - Twilio Call SID
     * @param {Object} slots - Slots to merge
     */
    static async updateSlots(callId, slots) {
        if (!callId || !slots) return;
        
        const state = await this.getState(callId);
        
        state.slots = {
            ...state.slots,
            ...Object.fromEntries(
                Object.entries(slots).filter(([k, v]) => v !== null && v !== undefined)
            )
        };
        
        await this.saveState(callId, state);
    }
    
    /**
     * Update conversation mode
     * 
     * @param {string} callId - Twilio Call SID
     * @param {string} mode - 'free' | 'booking' | 'triage' | 'rescue'
     */
    static async updateMode(callId, mode) {
        if (!callId || !mode) return;
        
        const state = await this.getState(callId);
        state.mode = mode;
        
        // Track mode transitions
        state.modeHistory = state.modeHistory || [];
        state.modeHistory.push({ mode, timestamp: Date.now() });
        
        await this.saveState(callId, state);
    }
    
    /**
     * Mark frustration detected
     * 
     * @param {string} callId - Twilio Call SID
     */
    static async markFrustrated(callId) {
        if (!callId) return;
        
        const state = await this.getState(callId);
        state.frustrationCount = (state.frustrationCount || 0) + 1;
        state.lastFrustrationAt = Date.now();
        
        await this.saveState(callId, state);
        
        return state.frustrationCount;
    }
    
    /**
     * Get conversation history formatted for LLM
     * 
     * @param {string} callId - Twilio Call SID
     * @param {number} limit - Max turns to return
     * @returns {Promise<Array>} Formatted history
     */
    static async getHistoryForLLM(callId, limit = 10) {
        const state = await this.getState(callId);
        
        return (state.history || [])
            .slice(-limit)
            .map(turn => ({
                role: turn.role,
                content: turn.content
            }));
    }
    
    /**
     * Get default state for a new conversation
     */
    static getDefaultState() {
        return {
            mode: 'free',
            slots: {
                name: null,
                phone: null,
                address: null,
                serviceType: null,
                time: null
            },
            history: [],
            turnCount: 0,
            frustrationCount: 0,
            modeHistory: [],
            createdAt: Date.now(),
            lastUpdate: Date.now()
        };
    }
    
    /**
     * Clear state for a call (for testing or end-of-call cleanup)
     */
    static async clearState(callId) {
        if (!callId) return;
        
        const key = `conv:${callId}`;
        
        try {
            if (redisClient?.isReady) {
                await redisClient.del(key);
            } else {
                memoryStore.delete(key);
            }
        } catch (error) {
            logger.error('[CONVERSATION STATE] Clear failed', { callId, error: error.message });
        }
    }
}

module.exports = ConversationStateManager;

