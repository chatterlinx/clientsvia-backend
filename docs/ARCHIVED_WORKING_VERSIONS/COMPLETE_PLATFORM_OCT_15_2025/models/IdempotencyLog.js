/**
 * ============================================================================
 * IDEMPOTENCY LOG MODEL
 * ============================================================================
 * 
 * PURPOSE: Prevent double-apply on network retries
 * 
 * HOW IT WORKS:
 * 1. Client generates UUID (idempotency key)
 * 2. Client sends apply request with key
 * 3. Server checks if key exists in this collection
 * 4. If exists: return cached response (no re-apply)
 * 5. If new: process request, store response, return
 * 
 * TTL: Documents auto-delete after 24 hours
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');

const idempotencyLogSchema = new mongoose.Schema({
    // Idempotency key (UUID from client)
    key: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    
    // Company ID (for auditing)
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true,
        index: true
    },
    
    // User ID (who made the request)
    userId: {
        type: String,
        required: true
    },
    
    // Action performed
    action: {
        type: String,
        required: true,
        enum: ['apply_variables', 'apply_filler_words', 'go_live', 'sync_template']
    },
    
    // Request body (for debugging)
    requestBody: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    
    // Response that was returned
    response: {
        statusCode: {
            type: Number,
            required: true
        },
        body: {
            type: mongoose.Schema.Types.Mixed,
            required: true
        }
    },
    
    // Request metadata
    metadata: {
        ip: { type: String },
        userAgent: { type: String },
        timestamp: { type: Date, default: Date.now }
    },
    
    // Auto-create timestamp
    createdAt: {
        type: Date,
        default: Date.now,
        expires: 86400 // TTL: 24 hours (in seconds)
    }
});

// Compound index for faster lookups
idempotencyLogSchema.index({ key: 1, companyId: 1 });

// Static method to check and store
idempotencyLogSchema.statics.checkOrStore = async function(key, companyId, userId, action, requestBody, response, metadata) {
    try {
        // Try to find existing log
        const existing = await this.findOne({ key, companyId });
        
        if (existing) {
            console.log(`[IDEMPOTENCY] ✅ Key already used: ${key.substring(0, 8)}...`);
            return {
                isDuplicate: true,
                response: existing.response
            };
        }
        
        // Store new log
        const log = new this({
            key,
            companyId,
            userId,
            action,
            requestBody,
            response,
            metadata
        });
        
        await log.save();
        
        console.log(`[IDEMPOTENCY] ✨ New key stored: ${key.substring(0, 8)}...`);
        
        return {
            isDuplicate: false,
            response: null
        };
        
    } catch (error) {
        // If duplicate key error (race condition), it's a duplicate
        if (error.code === 11000) {
            console.log(`[IDEMPOTENCY] ✅ Key already used (race): ${key.substring(0, 8)}...`);
            
            // Fetch the existing response
            const existing = await this.findOne({ key, companyId });
            return {
                isDuplicate: true,
                response: existing?.response || null
            };
        }
        
        throw error;
    }
};

const IdempotencyLog = mongoose.model('IdempotencyLog', idempotencyLogSchema);

module.exports = IdempotencyLog;

