/**
 * ════════════════════════════════════════════════════════════════════════════════
 * GOOGLE CALENDAR OAUTH CALLBACK - V88 (Jan 2026)
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * OAuth2 callback handler for Google Calendar authorization.
 * 
 * FLOW:
 * 1. User clicks "Connect Calendar" in UI
 * 2. Redirected to Google consent screen
 * 3. User approves, Google redirects here with code
 * 4. We exchange code for tokens and save to company
 * 5. Redirect back to company profile with success/error status
 * 
 * SECURITY:
 * - Uses state parameter to pass/verify companyId
 * - Tokens are never exposed in URLs or logs
 * 
 * ════════════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();
const GoogleCalendarService = require('../../services/GoogleCalendarService');
const logger = require('../../utils/logger');

// ════════════════════════════════════════════════════════════════════════════════
// OAUTH CALLBACK
// ════════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/integrations/google-calendar/callback
 * OAuth2 callback - Google redirects here after user consent
 */
router.get('/callback', async (req, res) => {
    try {
        const { code, state, error, error_description } = req.query;
        
        // Check for OAuth errors
        if (error) {
            logger.error('[GOOGLE CALENDAR CALLBACK] OAuth error', { 
                error, 
                error_description,
                state 
            });
            return res.redirect(`/company-profile.html?companyId=${state || ''}&gcError=${encodeURIComponent(error_description || error)}`);
        }
        
        // Validate required parameters
        if (!code || !state) {
            logger.error('[GOOGLE CALENDAR CALLBACK] Missing code or state');
            return res.redirect('/company-profile.html?gcError=missing_parameters');
        }
        
        const companyId = state;
        
        logger.info('[GOOGLE CALENDAR CALLBACK] Processing callback', { companyId });
        
        // Exchange code for tokens
        const result = await GoogleCalendarService.handleAuthCallback(code, companyId);
        
        if (result.success) {
            logger.info('[GOOGLE CALENDAR CALLBACK] ✅ Calendar connected successfully', {
                companyId,
                email: result.email
            });
            
            // Redirect back to company profile with success
            res.redirect(`/company-profile.html?companyId=${companyId}&tab=integrations&gcSuccess=true&gcEmail=${encodeURIComponent(result.email || '')}`);
        } else {
            logger.error('[GOOGLE CALENDAR CALLBACK] ❌ Token exchange failed', {
                companyId,
                error: result.error
            });
            
            res.redirect(`/company-profile.html?companyId=${companyId}&tab=integrations&gcError=${encodeURIComponent(result.error || 'connection_failed')}`);
        }
    } catch (err) {
        logger.error('[GOOGLE CALENDAR CALLBACK] ❌ Unexpected error', {
            error: err.message,
            stack: err.stack
        });
        
        const companyId = req.query.state || '';
        res.redirect(`/company-profile.html?companyId=${companyId}&gcError=${encodeURIComponent(err.message)}`);
    }
});

/**
 * GET /api/integrations/google-calendar/health
 * Health check endpoint
 */
router.get('/health', (req, res) => {
    res.json({
        configured: GoogleCalendarService.isConfigured(),
        timestamp: new Date().toISOString()
    });
});

module.exports = router;
