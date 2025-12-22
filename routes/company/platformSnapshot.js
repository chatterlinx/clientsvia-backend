/**
 * ============================================================================
 * PLATFORM SNAPSHOT API ENDPOINT
 * ============================================================================
 * 
 * GET /api/company/:companyId/platform-snapshot
 * 
 * Returns a complete, read-only JSON snapshot of the entire platform wiring.
 * This is the SINGLE SOURCE OF TRUTH for debugging, auditing, and onboarding.
 * 
 * Query Parameters:
 * - scope: 'full' | 'control' | 'scenarios' | 'runtime' (default: 'full')
 * 
 * RULES:
 * - Read-only (no writes)
 * - No LLM calls
 * - Cached reads allowed
 * - Max generation time: 2 seconds
 * 
 * AUTHENTICATION:
 * - Option 1: JWT token (Authorization: Bearer <jwt>) - for UI/admin access
 * - Option 2: Snapshot API Key (X-Snapshot-Key: <key>) - for terminal/server-to-server
 * 
 * The Snapshot API Key allows terminal-only verification without browser tokens.
 * Set SNAPSHOT_VERIFY_API_KEY env var (64+ chars recommended).
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const { generateSnapshot, quickHealthCheck } = require('../../platform/snapshot/platformSnapshot');
const { signControlPlaneSnapshot, verifySignedSnapshot } = require('../../lib/snapshotIntegrity');
const { authenticateJWT } = require('../../middleware/auth');
const logger = require('../../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════
// SNAPSHOT VERIFY API KEY MIDDLEWARE (Terminal-only access)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Middleware that allows access via EITHER:
 * 1. X-Snapshot-Key header matching SNAPSHOT_VERIFY_API_KEY
 * 2. Valid JWT token (existing admin auth)
 * 
 * This enables terminal-only verification without browser tokens.
 */
function requireSnapshotAuth(req, res, next) {
    const snapshotApiKey = process.env.SNAPSHOT_VERIFY_API_KEY;
    
    // Check for X-Snapshot-Key header first (terminal access)
    const providedKey = req.headers['x-snapshot-key'];
    
    if (providedKey && snapshotApiKey) {
        // Constant-time comparison to prevent timing attacks
        if (providedKey.length === snapshotApiKey.length && 
            require('crypto').timingSafeEqual(
                Buffer.from(providedKey),
                Buffer.from(snapshotApiKey)
            )) {
            // Valid API key - grant access
            logger.info('[PLATFORM SNAPSHOT AUTH] Access granted via X-Snapshot-Key', {
                companyId: req.params.companyId,
                ip: req.ip
            });
            req.snapshotKeyAuth = true;
            return next();
        }
    }
    
    // Fall back to JWT auth (UI/admin access)
    return authenticateJWT(req, res, next);
}

/**
 * GET /api/company/:companyId/platform-snapshot
 * 
 * Returns the full platform snapshot (signed with HMAC integrity)
 * 
 * Auth: X-Snapshot-Key OR Bearer JWT
 */
router.get('/', requireSnapshotAuth, async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;
    const { scope = 'full' } = req.query;
    
    logger.info('[PLATFORM SNAPSHOT API] Request received', {
        companyId,
        scope,
        ip: req.ip
    });
    
    // Validate companyId
    if (!companyId || companyId === 'undefined') {
        return res.status(400).json({
            success: false,
            error: 'companyId is required',
            snapshot: null
        });
    }
    
    // Validate scope
    const validScopes = ['full', 'control', 'scenarios', 'runtime'];
    if (!validScopes.includes(scope)) {
        return res.status(400).json({
            success: false,
            error: `Invalid scope. Valid values: ${validScopes.join(', ')}`,
            snapshot: null
        });
    }
    
    try {
        // Generate snapshot with timeout
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Snapshot generation timeout (2s)')), 2000);
        });
        
        const snapshotPromise = generateSnapshot(companyId, { scope });
        
        const snapshot = await Promise.race([snapshotPromise, timeoutPromise]);
        
        const apiTime = Date.now() - startTime;
        
        // Sign the snapshot with HMAC integrity
        const signedSnapshot = signControlPlaneSnapshot(snapshot, { 
            companyId,
            allowUnsigned: true  // Allow unsigned in dev mode
        });
        
        logger.info('[PLATFORM SNAPSHOT API] Response sent', {
            companyId,
            scope,
            score: signedSnapshot.completeness?.score,
            status: signedSnapshot.completeness?.status,
            apiTimeMs: apiTime,
            generationMs: signedSnapshot.meta?.generationMs,
            signed: signedSnapshot._integrity?.algo !== 'none'
        });
        
        res.json({
            success: true,
            snapshot: signedSnapshot
        });
        
    } catch (error) {
        logger.error('[PLATFORM SNAPSHOT API] Error:', {
            companyId,
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: error.message,
            snapshot: null
        });
    }
});

/**
 * GET /api/company/:companyId/platform-snapshot/health
 * 
 * Quick health check (faster than full snapshot)
 * 
 * Auth: X-Snapshot-Key OR Bearer JWT
 */
router.get('/health', requireSnapshotAuth, async (req, res) => {
    const { companyId } = req.params;
    
    if (!companyId || companyId === 'undefined') {
        return res.status(400).json({
            success: false,
            error: 'companyId is required'
        });
    }
    
    try {
        const health = await quickHealthCheck(companyId);
        
        res.json({
            success: true,
            ...health
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/company/:companyId/platform-snapshot/badge
 * 
 * Returns just the badge info (score, status, grade) for UI display
 * 
 * Auth: X-Snapshot-Key OR Bearer JWT
 */
router.get('/badge', requireSnapshotAuth, async (req, res) => {
    const { companyId } = req.params;
    
    if (!companyId || companyId === 'undefined') {
        return res.status(400).json({
            success: false,
            error: 'companyId is required'
        });
    }
    
    try {
        // ALWAYS use FULL scope for badge - this is the header truth indicator
        const snapshot = await generateSnapshot(companyId, { scope: 'full' });
        
        const { score, status, grade, summary } = snapshot.completeness || {};
        
        // Emoji based on status
        let emoji = '🟢';
        if (status === 'YELLOW') emoji = '🟡';
        if (status === 'RED') emoji = '🔴';
        
        res.json({
            success: true,
            badge: {
                emoji,
                score,
                status,
                grade,
                summary,
                label: `${emoji} JSON ${score}%`
            }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            badge: {
                emoji: '⚠️',
                score: 0,
                status: 'ERROR',
                grade: 'F',
                summary: 'Snapshot unavailable',
                label: '⚠️ JSON'
            }
        });
    }
});

/**
 * POST /api/company/:companyId/platform-snapshot/verify
 * 
 * Verify a signed snapshot's integrity.
 * Useful for "Verify Snapshot" button in UI or terminal curl tests.
 * 
 * Auth: X-Snapshot-Key OR Bearer JWT
 * 
 * Body: Either:
 * - The full API response: { success: true, snapshot: { ... } }
 * - Or just the snapshot object directly: { meta, completeness, _integrity, ... }
 * 
 * Returns:
 * - { success: true, ok: true, signedAt, companyId, snapshotVersion } if valid
 * - { success: true, ok: false, reason: '...' } if invalid
 */
router.post('/verify', requireSnapshotAuth, (req, res) => {
    const { companyId } = req.params;
    
    try {
        let signedSnapshot = req.body;
        
        if (!signedSnapshot || typeof signedSnapshot !== 'object') {
            return res.status(400).json({
                success: false,
                error: 'Request body must be a signed snapshot object'
            });
        }
        
        // Handle both formats:
        // 1. Full API response: { success: true, snapshot: { _integrity, ... } }
        // 2. Direct snapshot: { _integrity, meta, completeness, ... }
        if (signedSnapshot.success === true && signedSnapshot.snapshot) {
            signedSnapshot = signedSnapshot.snapshot;
            logger.info('[PLATFORM SNAPSHOT API] Extracted snapshot from API response wrapper');
        }
        
        // Verify the snapshot
        const result = verifySignedSnapshot(signedSnapshot);
        
        logger.info('[PLATFORM SNAPSHOT API] Verify result', {
            companyId,
            ok: result.ok,
            reason: result.reason || null,
            authMethod: req.snapshotKeyAuth ? 'X-Snapshot-Key' : 'JWT'
        });
        
        res.json({
            success: true,
            ...result
        });
        
    } catch (error) {
        logger.error('[PLATFORM SNAPSHOT API] Verify error:', {
            companyId,
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;

