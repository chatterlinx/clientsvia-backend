/**
 * ============================================================================
 * CONTROL PLANE SNAPSHOT INTEGRITY (HMAC SIGNATURE)
 * ============================================================================
 * 
 * Provides cryptographic integrity verification for Control Plane snapshots.
 * 
 * WHAT THIS DOES:
 * - Server signs every snapshot with HMAC-SHA256
 * - Client can verify: hash matches payload (tamper detection)
 * - Optional /verify endpoint for UI verification button
 * 
 * SIGNATURE BLOCK ADDED TO SNAPSHOTS:
 * "_integrity": {
 *    "algo": "sha256+hmac",
 *    "hash": "<sha256 of canonical payload>",
 *    "sig":  "<hmac_sha256(secret, hash)>",
 *    "signedAt": "<ISO date>",
 *    "companyId": "<companyId>",
 *    "snapshotVersion": "<snapshotVersion>"
 * }
 * 
 * IMPORTANT:
 * - We sign a CANONICALIZED version of the snapshot WITHOUT _integrity,
 *   so signature is stable and cannot be self-referential.
 * 
 * ENVIRONMENT VARIABLE REQUIRED:
 * - SNAPSHOT_SIGNING_SECRET (minimum 32 characters, recommended 64+)
 * 
 * ============================================================================
 */

const crypto = require('crypto');
const logger = require('../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Stable JSON stringify: sorts keys recursively for canonical representation.
 * This ensures the same object always produces the same string.
 * 
 * @param {*} value - Any JSON-serializable value
 * @returns {string} - Canonical JSON string
 */
function stableStringify(value) {
    if (value === null || value === undefined) {
        return JSON.stringify(value);
    }
    
    if (typeof value !== 'object') {
        return JSON.stringify(value);
    }
    
    if (Array.isArray(value)) {
        return '[' + value.map(stableStringify).join(',') + ']';
    }
    
    // Object: sort keys alphabetically
    const keys = Object.keys(value).sort();
    return '{' + keys
        .map(k => JSON.stringify(k) + ':' + stableStringify(value[k]))
        .join(',') + '}';
}

/**
 * Remove _integrity field recursively (prevents self-referential signing).
 * 
 * @param {*} obj - Object to strip
 * @returns {*} - Object without _integrity fields
 */
function stripIntegrity(obj) {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    
    if (Array.isArray(obj)) {
        return obj.map(stripIntegrity);
    }
    
    const out = {};
    for (const k of Object.keys(obj)) {
        if (k === '_integrity') continue;
        out[k] = stripIntegrity(obj[k]);
    }
    return out;
}

/**
 * SHA-256 hash of a string, returned as hex.
 * 
 * @param {string} str - Input string
 * @returns {string} - Hex-encoded SHA-256 hash
 */
function sha256Hex(str) {
    return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

/**
 * HMAC-SHA256 of a string using a secret, returned as hex.
 * 
 * @param {string} secret - HMAC secret
 * @param {string} str - Input string
 * @returns {string} - Hex-encoded HMAC-SHA256
 */
function hmacSha256Hex(secret, str) {
    return crypto.createHmac('sha256', secret).update(str, 'utf8').digest('hex');
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN SIGNING FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sign a snapshot object and return a NEW snapshot with _integrity block.
 * 
 * @param {object} snapshot - The snapshot to sign
 * @param {object} opts - Options
 * @param {string} opts.companyId - Company ID (optional, extracted from snapshot if not provided)
 * @param {boolean} opts.allowUnsigned - If true, return unsigned snapshot when secret is missing (dev mode)
 * @returns {object} - Snapshot with _integrity block
 * @throws {Error} - If secret is missing/weak and allowUnsigned is false
 */
function signControlPlaneSnapshot(snapshot, opts = {}) {
    const secret = process.env.SNAPSHOT_SIGNING_SECRET;
    
    // Check for secret
    if (!secret || String(secret).trim().length < 32) {
        // In development, allow unsigned snapshots with a warning
        if (opts.allowUnsigned || process.env.NODE_ENV === 'development') {
            logger.warn('[SNAPSHOT INTEGRITY] No signing secret configured - snapshot will be unsigned');
            return {
                ...snapshot,
                _integrity: {
                    algo: 'none',
                    hash: null,
                    sig: null,
                    signedAt: new Date().toISOString(),
                    companyId: opts.companyId || snapshot?.meta?.companyId || null,
                    snapshotVersion: snapshot?.meta?.snapshotVersion || null,
                    warning: 'UNSIGNED - SNAPSHOT_SIGNING_SECRET not configured'
                }
            };
        }
        
        // In production, this is a critical error
        throw new Error(
            'Missing/weak SNAPSHOT_SIGNING_SECRET. Set a strong value (>=32 chars) in environment.'
        );
    }
    
    // Strip any existing _integrity to prevent self-reference
    const base = stripIntegrity(snapshot);
    
    // Create canonical JSON representation
    const canonical = stableStringify(base);
    
    // Hash the canonical representation
    const hash = sha256Hex(canonical);
    
    // Sign the hash with HMAC
    const sig = hmacSha256Hex(secret, hash);
    
    // Extract metadata
    const signedAt = new Date().toISOString();
    const companyId = opts.companyId || 
                      base?.meta?.companyId || 
                      base?.providers?.controlPlane?.data?.companyId || 
                      null;
    const snapshotVersion = base?.meta?.snapshotVersion || null;
    
    logger.info('[SNAPSHOT INTEGRITY] Signed snapshot', {
        companyId,
        snapshotVersion,
        hashPrefix: hash.substring(0, 16) + '...',
        signedAt
    });
    
    return {
        ...base,
        _integrity: {
            algo: 'sha256+hmac',
            hash,
            sig,
            signedAt,
            companyId,
            snapshotVersion
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICATION FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verify a signed snapshot's integrity.
 * 
 * @param {object} signedSnapshot - Snapshot with _integrity block
 * @returns {object} - Verification result: { ok: boolean, reason?: string, ... }
 */
function verifySignedSnapshot(signedSnapshot) {
    const secret = process.env.SNAPSHOT_SIGNING_SECRET;
    
    if (!secret) {
        return { ok: false, reason: 'missing_secret' };
    }
    
    const integrity = signedSnapshot?._integrity;
    
    // Check for unsigned snapshots
    if (integrity?.algo === 'none') {
        return { ok: false, reason: 'snapshot_unsigned', warning: integrity.warning };
    }
    
    // Check integrity block exists
    if (!integrity?.hash || !integrity?.sig) {
        return { ok: false, reason: 'missing_integrity' };
    }
    
    // Strip _integrity and recompute hash
    const base = stripIntegrity(signedSnapshot);
    const canonical = stableStringify(base);
    const recomputedHash = sha256Hex(canonical);
    
    // Verify hash matches
    if (recomputedHash !== integrity.hash) {
        logger.warn('[SNAPSHOT INTEGRITY] Hash mismatch - possible tampering', {
            expected: integrity.hash.substring(0, 16) + '...',
            computed: recomputedHash.substring(0, 16) + '...'
        });
        return { 
            ok: false, 
            reason: 'hash_mismatch',
            recomputedHash: recomputedHash.substring(0, 16) + '...'
        };
    }
    
    // Verify signature matches
    const recomputedSig = hmacSha256Hex(secret, integrity.hash);
    if (recomputedSig !== integrity.sig) {
        logger.warn('[SNAPSHOT INTEGRITY] Signature mismatch - invalid secret or tampering');
        return { ok: false, reason: 'sig_mismatch' };
    }
    
    return { 
        ok: true,
        signedAt: integrity.signedAt,
        companyId: integrity.companyId,
        snapshotVersion: integrity.snapshotVersion
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
    // Main functions
    signControlPlaneSnapshot,
    verifySignedSnapshot,
    
    // Helpers (exported for testing)
    stableStringify,
    stripIntegrity,
    sha256Hex,
    hmacSha256Hex
};

