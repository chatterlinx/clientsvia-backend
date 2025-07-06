// routes/integrations.js
const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const Company = require('../models/Company'); // Your Mongoose Company model
const { ObjectId } = require('mongodb'); // Or mongoose.Types.ObjectId if using Mongoose types exclusively

// Ensure these are loaded from your environment variables
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI; 
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:10000'; 

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    console.error("FATAL ERROR: Google OAuth credentials or Redirect URI not configured in environment variables.");
    // Consider exiting or disabling these routes if config is missing
}

const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
);

// Route 1: Initiate Google OAuth flow
router.get('/google/auth', async (req, res) => { // Make it async if you need to check company first
    const { companyId } = req.query;

    if (!companyId || !ObjectId.isValid(companyId)) {
        return res.status(400).send('Missing or invalid companyId query parameter.');
    }
    // Optional: Check if company exists before redirecting
    // const company = await Company.findById(companyId);
    // if (!company) {
    //     return res.status(404).send('Company not found. Cannot initiate OAuth.');
    // }

    const scopes = [
        'https://www.googleapis.com/auth/calendar.readonly', 
        'https://www.googleapis.com/auth/calendar.events'    
    ];

    const authorizeUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline', 
        scope: scopes,
        prompt: 'consent', 
        state: companyId 
    });

    console.log(`[API GET /integrations/google/auth] Redirecting for companyId ${companyId} to: ${authorizeUrl}`);
    res.redirect(authorizeUrl);
});

// Route 2: Handle the OAuth 2.0 callback from Google
router.get('/google/oauth2callback', async (req, res) => {
    const { code, state: companyId, error } = req.query;

    console.log(`[API GET /integrations/google/oauth2callback] Received callback. Code: ${code ? 'PRESENT' : 'MISSING'}, companyId (state): ${companyId}, Error: ${error || 'None'}`);

    if (error) {
        console.error('Error from Google OAuth callback:', error);
        const redirectUrl = `${APP_BASE_URL}/company-profile.html?id=${companyId}&tab=config&googleAuthError=${encodeURIComponent(error)}`;
        console.log(`Redirecting to: ${redirectUrl}`);
        return res.redirect(redirectUrl);
    }

    if (!code) {
        const redirectUrl = `${APP_BASE_URL}/company-profile.html?id=${companyId}&tab=config&googleAuthError=${encodeURIComponent('Missing authorization code from Google.')}`;
        console.log(`Redirecting to: ${redirectUrl}`);
        return res.redirect(redirectUrl);
    }
    if (!companyId || !ObjectId.isValid(companyId)) {
        // Cannot redirect to a specific company page if companyId is invalid
        return res.status(400).send('Invalid or missing company identifier (state parameter). Cannot complete authorization.');
    }

    try {
        const { tokens } = await oauth2Client.getToken(code);
        console.log('[API GET /integrations/google/oauth2callback] Tokens received from Google:', tokens);
        
        // oauth2Client.setCredentials(tokens); // Set credentials for subsequent API calls if needed immediately

        const company = await Company.findById(companyId);
        if (!company) {
            const redirectUrl = `${APP_BASE_URL}/company-profile.html?id=${companyId}&tab=config&googleAuthError=${encodeURIComponent('Company not found for storing tokens.')}`;
            console.log(`Redirecting to: ${redirectUrl}`);
            return res.redirect(redirectUrl);
        }

        if (!company.integrations) { // Ensure integrations object exists
            company.integrations = {};
        }
        company.integrations.googleOAuth = {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token, 
            expiryDate: tokens.expiry_date,     
            scope: tokens.scope,
            isAuthorized: true
        };
        company.updatedAt = new Date();
        await company.save();

        console.log(`[API GET /integrations/google/oauth2callback] Google OAuth tokens stored successfully for companyId ${companyId}`);
        const redirectUrl = `${APP_BASE_URL}/company-profile.html?id=${companyId}&tab=config&googleAuthSuccess=true`;
        console.log(`Redirecting to: ${redirectUrl}`);
        res.redirect(redirectUrl);

    } catch (e) {
        console.error('[API GET /integrations/google/oauth2callback] Error getting tokens or saving to DB:', e.message, e.stack);
        const redirectUrl = `${APP_BASE_URL}/company-profile.html?id=${companyId}&tab=config&googleAuthError=${encodeURIComponent(e.message)}`;
        console.log(`Redirecting to: ${redirectUrl}`);
        res.redirect(redirectUrl);
    }
});

module.exports = router;
