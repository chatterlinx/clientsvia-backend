/**
 * ============================================================================
 * PREVIEW TOKEN UTILITY
 * ============================================================================
 * 
 * PURPOSE: Secure Preview/Apply flow with JWT-based token verification
 * 
 * SECURITY FEATURES:
 * - JWT signature prevents token forgery
 * - SHA256 hash ensures data integrity
 * - 10-minute expiry prevents old previews from being applied
 * - Hash comparison detects any data tampering
 * 
 * FLOW:
 * 1. User requests preview → generate token with hash of updates
 * 2. User clicks apply → verify token + re-hash updates
 * 3. If hash matches → apply changes
 * 4. If hash mismatch → reject (data was tampered)
 * 
 * ============================================================================
 */

const jwt = require('jsonwebtoken');
const logger = require('./logger.js');

const crypto = require('crypto');

/**
 * Generate preview token
 * @param {string} companyId - Company ID
 * @param {string} userId - User ID making the change
 * @param {Object} updates - The updates to preview (will be hashed)
 * @returns {string} JWT token
 */
function generatePreviewToken(companyId, userId, updates) {
    logger.security(`[PREVIEW TOKEN] 🔐 Generating token for company ${companyId}`);
    
    try {
        // 1. Hash the updates with SHA256
        const updatesString = JSON.stringify(updates, Object.keys(updates).sort());
        const updatesHash = crypto
            .createHash('sha256')
            .update(updatesString)
            .digest('hex');
        
        logger.security(`[PREVIEW TOKEN] 🔐 Updates hash: ${updatesHash.substring(0, 16)}...`);
        
        // 2. Create JWT payload
        const payload = {
            companyId,
            userId,
            updatesHash,
            type: 'preview',
            iat: Math.floor(Date.now() / 1000)
        };
        
        // 3. Sign JWT with 10 minute expiry
        const token = jwt.sign(payload, process.env.JWT_SECRET, {
            expiresIn: '10m' // 10 minutes
        });
        
        logger.security(`[PREVIEW TOKEN] ✅ Token generated (expires in 10 minutes)`);
        
        return token;
        
    } catch (error) {
        logger.security(`[PREVIEW TOKEN] ❌ Generation failed:`, error);
        throw new Error(`Failed to generate preview token: ${error.message}`);
    }
}

/**
 * Verify preview token and compare hash
 * @param {string} token - JWT token from client
 * @param {Object} updates - The updates being applied (will be re-hashed)
 * @returns {Object} { valid: boolean, error?: string, payload?: Object }
 */
function verifyPreviewToken(token, updates) {
    logger.security(`[PREVIEW TOKEN] 🔍 Verifying token...`);
    
    try {
        // 1. Verify JWT signature and expiry
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        
        logger.security(`[PREVIEW TOKEN] ✅ JWT signature valid`);
        logger.security(`[PREVIEW TOKEN] 🔍 Token for company: ${payload.companyId}`);
        logger.security(`[PREVIEW TOKEN] 🔍 Token by user: ${payload.userId}`);
        
        // 2. Check token type
        if (payload.type !== 'preview') {
            logger.security(`[PREVIEW TOKEN] ❌ Invalid token type: ${payload.type}`);
            return {
                valid: false,
                error: 'Invalid token type'
            };
        }
        
        // 3. Re-hash the updates
        const updatesString = JSON.stringify(updates, Object.keys(updates).sort());
        const updatesHash = crypto
            .createHash('sha256')
            .update(updatesString)
            .digest('hex');
        
        logger.security(`[PREVIEW TOKEN] 🔍 Expected hash: ${payload.updatesHash.substring(0, 16)}...`);
        logger.security(`[PREVIEW TOKEN] 🔍 Received hash: ${updatesHash.substring(0, 16)}...`);
        
        // 4. Compare hashes
        if (payload.updatesHash !== updatesHash) {
            logger.security(`[PREVIEW TOKEN] ❌ Hash mismatch! Data was tampered or changed.`);
            return {
                valid: false,
                error: 'Preview data does not match. Please preview changes again before applying.'
            };
        }
        
        logger.security(`[PREVIEW TOKEN] ✅ Token valid and hash matches`);
        
        return {
            valid: true,
            payload
        };
        
    } catch (error) {
        // Handle JWT errors
        if (error.name === 'TokenExpiredError') {
            logger.security(`[PREVIEW TOKEN] ⏰ Token expired`);
            return {
                valid: false,
                error: 'Preview token expired. Please preview changes again (tokens expire after 10 minutes).'
            };
        }
        
        if (error.name === 'JsonWebTokenError') {
            logger.security(`[PREVIEW TOKEN] ❌ Invalid token: ${error.message}`);
            return {
                valid: false,
                error: 'Invalid preview token. Please preview changes again.'
            };
        }
        
        logger.security(`[PREVIEW TOKEN] ❌ Verification failed:`, error);
        return {
            valid: false,
            error: `Token verification failed: ${error.message}`
        };
    }
}

/**
 * Get remaining time for token (for countdown display)
 * @param {string} token - JWT token
 * @returns {Object} { valid: boolean, expiresIn?: number, expiresAt?: Date }
 */
function getTokenExpiry(token) {
    try {
        // Decode without verification (just to read expiry)
        const payload = jwt.decode(token);
        
        if (!payload || !payload.exp) {
            return { valid: false };
        }
        
        const now = Math.floor(Date.now() / 1000);
        const expiresIn = payload.exp - now; // Seconds remaining
        
        return {
            valid: expiresIn > 0,
            expiresIn, // Seconds
            expiresAt: new Date(payload.exp * 1000)
        };
        
    } catch (error) {
        return { valid: false };
    }
}

module.exports = {
    generatePreviewToken,
    verifyPreviewToken,
    getTokenExpiry
};
