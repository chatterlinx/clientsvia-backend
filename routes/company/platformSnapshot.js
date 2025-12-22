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
 * ============================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const { generateSnapshot, quickHealthCheck } = require('../../platform/snapshot/platformSnapshot');
const { signControlPlaneSnapshot, verifySignedSnapshot } = require('../../lib/snapshotIntegrity');
const logger = require('../../utils/logger');

/**
 * GET /api/company/:companyId/platform-snapshot
 * 
 * Returns the full platform snapshot
 */
router.get('/', async (req, res) => {
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
 */
router.get('/health', async (req, res) => {
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
 */
router.get('/badge', async (req, res) => {
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
 * Useful for "Verify Snapshot" button in UI.
 * 
 * Body: The full signed snapshot object
 * 
 * Returns:
 * - { success: true, ok: true, signedAt, companyId, snapshotVersion } if valid
 * - { success: true, ok: false, reason: '...' } if invalid
 */
router.post('/verify', (req, res) => {
    const { companyId } = req.params;
    
    try {
        const signedSnapshot = req.body;
        
        if (!signedSnapshot || typeof signedSnapshot !== 'object') {
            return res.status(400).json({
                success: false,
                error: 'Request body must be a signed snapshot object'
            });
        }
        
        // Verify the snapshot
        const result = verifySignedSnapshot(signedSnapshot);
        
        logger.info('[PLATFORM SNAPSHOT API] Verify result', {
            companyId,
            ok: result.ok,
            reason: result.reason || null
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

