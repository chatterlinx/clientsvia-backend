/**
 * ============================================================================
 * SNAPSHOT INTEGRITY (HMAC SIGNING)
 * ============================================================================
 * 
 * Signs platform snapshots with HMAC-SHA256 for tamper detection.
 * 
 * USAGE:
 * 1. Set SNAPSHOT_SIGNING_SECRET env var
 * 2. Call signSnapshot(snapshotObject)
 * 3. Client can verify hash matches
 * 
 * If SNAPSHOT_SIGNING_SECRET is not set, snapshot is still returned
 * but _integrity.signed = false and a warning is added.
 * 
 * ============================================================================
 */

const crypto = require('crypto');
const logger = require('../../utils/logger');

const SIGNING_SECRET = process.env.SNAPSHOT_SIGNING_SECRET;
let missingSecretWarned = false;
const ALGORITHM = 'sha256';

/**
 * Canonicalize snapshot for stable hash computation
 * Removes _integrity field and sorts keys for consistent ordering
 */
function canonicalize(snapshot) {
    // Deep clone and remove _integrity
    const clean = JSON.parse(JSON.stringify(snapshot));
    delete clean._integrity;
    
    // Sort keys for stable hash
    return JSON.stringify(clean, Object.keys(clean).sort());
}

/**
 * Sign a snapshot with HMAC-SHA256
 * 
 * @param {Object} snapshot - The snapshot to sign
 * @returns {Object} - Snapshot with _integrity field added
 */
function signSnapshot(snapshot) {
    const signedAt = new Date().toISOString();
    
    // If no secret configured, return with warning
    if (!SIGNING_SECRET) {
        if (!missingSecretWarned) {
            missingSecretWarned = true;
            logger.warn('[SNAPSHOT INTEGRITY] SNAPSHOT_SIGNING_SECRET not configured - snapshot unsigned');
        }
        return {
            ...snapshot,
            _integrity: {
                signed: false,
                warning: 'SNAPSHOT_SIGNING_SECRET not configured',
                signedAt
            }
        };
    }
    
    try {
        const canonical = canonicalize(snapshot);
        const hash = crypto
            .createHash(ALGORITHM)
            .update(canonical)
            .digest('hex');
        
        const sig = crypto
            .createHmac(ALGORITHM, SIGNING_SECRET)
            .update(canonical)
            .digest('hex');
        
        return {
            ...snapshot,
            _integrity: {
                signed: true,
                algo: `HMAC-${ALGORITHM.toUpperCase()}`,
                hash,
                sig,
                signedAt,
                companyId: snapshot.meta?.companyId || null,
                snapshotVersion: snapshot.meta?.snapshotVersion || 'unknown'
            }
        };
    } catch (error) {
        logger.error('[SNAPSHOT INTEGRITY] Signing failed:', error.message);
        return {
            ...snapshot,
            _integrity: {
                signed: false,
                error: error.message,
                signedAt
            }
        };
    }
}

/**
 * Verify a signed snapshot
 * 
 * @param {Object} snapshot - Snapshot with _integrity field
 * @returns {Object} - { valid: boolean, reason: string }
 */
function verifySnapshot(snapshot) {
    if (!snapshot._integrity) {
        return { valid: false, reason: 'No _integrity field present' };
    }
    
    if (!snapshot._integrity.signed) {
        return { valid: false, reason: snapshot._integrity.warning || 'Snapshot not signed' };
    }
    
    if (!SIGNING_SECRET) {
        return { valid: false, reason: 'SNAPSHOT_SIGNING_SECRET not configured for verification' };
    }
    
    try {
        const canonical = canonicalize(snapshot);
        const expectedSig = crypto
            .createHmac(ALGORITHM, SIGNING_SECRET)
            .update(canonical)
            .digest('hex');
        
        if (expectedSig === snapshot._integrity.sig) {
            return { valid: true, reason: 'Signature verified' };
        } else {
            return { valid: false, reason: 'Signature mismatch - possible tampering' };
        }
    } catch (error) {
        return { valid: false, reason: `Verification error: ${error.message}` };
    }
}

module.exports = {
    signSnapshot,
    verifySnapshot,
    canonicalize
};

