/**
 * ============================================================================
 * PREVIEW TOKEN UTILITY
 * ============================================================================
 * 
 * PURPOSE: Generate secure tokens for preview-before-apply workflow
 * 
 * SECURITY:
 * - Token contains hash of proposed updates
 * - Apply endpoint verifies hash matches
 * - Prevents MITM attacks (changed updates after preview)
 * - Tokens expire after 10 minutes
 * 
 * USAGE:
 *   const token = generatePreviewToken(companyId, userId, updates);
 *   const verified = verifyPreviewToken(token, updates);
 * 
 * ============================================================================
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// JWT secret (use environment variable in production)
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

/**
 * Generate a secure preview token
 * @param {string} companyId - Company ID
 * @param {string} userId - User ID making the change
 * @param {object} updates - Proposed updates object
 * @returns {string} JWT token
 */
function generatePreviewToken(companyId, userId, updates) {
    // Create SHA256 hash of updates
    const updatesString = JSON.stringify(updates, Object.keys(updates).sort());
    const updatesHash = crypto
        .createHash('sha256')
        .update(updatesString)
        .digest('hex');
    
    // Create JWT payload
    const payload = {
        type: 'preview',
        companyId,
        userId,
        updatesHash,
        timestamp: Date.now()
    };
    
    // Sign JWT with 10 minute expiration
    const token = jwt.sign(payload, JWT_SECRET, {
        expiresIn: '10m',
        issuer: 'clientsvia-backend',
        audience: 'config-preview'
    });
    
    console.log(`[PREVIEW TOKEN] Generated for company ${companyId}, hash: ${updatesHash.substring(0, 8)}...`);
    
    return token;
}

/**
 * Verify a preview token matches the provided updates
 * @param {string} token - JWT token from preview
 * @param {object} updates - Updates being applied
 * @returns {object} { valid: boolean, payload?: object, error?: string }
 */
function verifyPreviewToken(token, updates) {
    try {
        // Verify and decode JWT
        const payload = jwt.verify(token, JWT_SECRET, {
            issuer: 'clientsvia-backend',
            audience: 'config-preview'
        });
        
        // Verify it's a preview token
        if (payload.type !== 'preview') {
            return {
                valid: false,
                error: 'Invalid token type'
            };
        }
        
        // Hash the updates
        const updatesString = JSON.stringify(updates, Object.keys(updates).sort());
        const updatesHash = crypto
            .createHash('sha256')
            .update(updatesString)
            .digest('hex');
        
        // Verify hash matches
        if (payload.updatesHash !== updatesHash) {
            console.error('[PREVIEW TOKEN] Hash mismatch!');
            console.error(`  Expected: ${payload.updatesHash.substring(0, 16)}...`);
            console.error(`  Got:      ${updatesHash.substring(0, 16)}...`);
            
            return {
                valid: false,
                error: 'Updates have been modified after preview. Please preview again.'
            };
        }
        
        console.log(`[PREVIEW TOKEN] ✅ Verified for company ${payload.companyId}`);
        
        return {
            valid: true,
            payload
        };
        
    } catch (error) {
        console.error('[PREVIEW TOKEN] Verification failed:', error.message);
        
        if (error.name === 'TokenExpiredError') {
            return {
                valid: false,
                error: 'Preview token has expired. Please preview again.'
            };
        }
        
        if (error.name === 'JsonWebTokenError') {
            return {
                valid: false,
                error: 'Invalid preview token'
            };
        }
        
        return {
            valid: false,
            error: 'Token verification failed'
        };
    }
}

/**
 * Generate hash for updates (used for comparison)
 * @param {object} updates - Updates object
 * @returns {string} SHA256 hash
 */
function hashUpdates(updates) {
    const updatesString = JSON.stringify(updates, Object.keys(updates).sort());
    return crypto
        .createHash('sha256')
        .update(updatesString)
        .digest('hex');
}

module.exports = {
    generatePreviewToken,
    verifyPreviewToken,
    hashUpdates
};

