/**
 * ════════════════════════════════════════════════════════════════════════════════
 * GOOGLE CALENDAR OAUTH CALLBACK - V88 (Jan 2026)
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * OAuth2 callback handler for Google Calendar authorization.
 * 
 * FLOW:
 * 1. User clicks "Connect Calendar" in Agent Console
 * 2. Redirected to Google consent screen
 * 3. User approves, Google redirects here with code
 * 4. We exchange code for tokens and save to company
 * 5. Redirect back to Agent Console calendar page with success/error status
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
const ConfigCacheService = require('../../services/ConfigCacheService');
const logger = require('../../utils/logger');

// ════════════════════════════════════════════════════════════════════════════════
// OAUTH CALLBACK
// ════════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/integrations/google-calendar/callback
 * OAuth2 callback - Google redirects here after user consent
 * 
 * Redirects to Agent Console (preferred) or Company Profile (fallback)
 */
router.get('/callback', async (req, res) => {
    try {
        const { code, state, error, error_description } = req.query;
        
        // Parse state - may contain source indicator
        // Format: companyId or companyId:source (e.g., "abc123:agent-console")
        let companyId = state || '';
        let source = 'profile'; // Default fallback
        
        if (state && state.includes(':')) {
            const parts = state.split(':');
            companyId = parts[0];
            source = parts[1] || 'profile';
        }
        
        // Determine redirect base URL
        const getRedirectUrl = (params) => {
            if (source === 'agent-console') {
                return `/agent-console/calendar.html?companyId=${companyId}&${params}`;
            }
            return `/company-profile.html?companyId=${companyId}&tab=integrations&${params}`;
        };
        
        // Check for OAuth errors
        if (error) {
            logger.error('[GOOGLE CALENDAR CALLBACK] OAuth error', { 
                error, 
                error_description,
                companyId,
                source
            });
            return res.redirect(getRedirectUrl(`gcError=${encodeURIComponent(error_description || error)}`));
        }
        
        // Validate required parameters
        if (!code || !companyId) {
            logger.error('[GOOGLE CALENDAR CALLBACK] Missing code or state');
            return res.redirect(getRedirectUrl('gcError=missing_parameters'));
        }
        
        logger.info('[GOOGLE CALENDAR CALLBACK] Processing callback', { companyId, source });
        
        // Exchange code for tokens
        const result = await GoogleCalendarService.handleAuthCallback(code, companyId);
        
        if (result.success) {
            logger.info('[GOOGLE CALENDAR CALLBACK] ✅ Calendar connected successfully', {
                companyId,
                email: result.email,
                source
            });
            
            // Invalidate cached calendar status so runtime sees the change immediately
            await ConfigCacheService.invalidateCalendarStatus(companyId);
            await ConfigCacheService.invalidateBookingConfig(companyId);
            
            // Redirect with success
            res.redirect(getRedirectUrl(`connected=1&gcEmail=${encodeURIComponent(result.email || '')}`));
        } else {
            logger.error('[GOOGLE CALENDAR CALLBACK] ❌ Token exchange failed', {
                companyId,
                error: result.error,
                source
            });
            
            res.redirect(getRedirectUrl(`gcError=${encodeURIComponent(result.error || 'connection_failed')}`));
        }
    } catch (err) {
        logger.error('[GOOGLE CALENDAR CALLBACK] ❌ Unexpected error', {
            error: err.message,
            stack: err.stack
        });
        
        // Extract companyId from state for error redirect
        let companyId = '';
        let source = 'profile';
        const state = req.query.state || '';
        if (state.includes(':')) {
            const parts = state.split(':');
            companyId = parts[0];
            source = parts[1] || 'profile';
        } else {
            companyId = state;
        }
        
        const redirectUrl = source === 'agent-console'
            ? `/agent-console/calendar.html?companyId=${companyId}&gcError=${encodeURIComponent(err.message)}`
            : `/company-profile.html?companyId=${companyId}&gcError=${encodeURIComponent(err.message)}`;
        
        res.redirect(redirectUrl);
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
