const express = require('express');
const router = express.Router();
const path = require('path');
const { getDB } = require('../db');
const { ObjectId } = require('mongodb');
const Company = require('../models/Company'); // Add Company model import
const { google } = require('googleapis'); // For Google Calendar
const { normalizePhoneNumber } = require('../utils/phone');
const { redisClient } = require('../clients');
const { defaultResponses, clearCompanyResponsesCache } = require('../utils/personalityResponses');

// Google OAuth2 Client Setup
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    console.warn("🔴 Google OAuth credentials are not fully configured in .env. Google Calendar integration will likely fail.");
}

const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
);

const daysOfWeekForOperatingHours = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// --- HTML Serving Routes ---
router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});
router.get('/directory.html', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'directory.html'));
});
router.get('/add-company.html', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'add-company.html'));
});
router.get('/company-profile.html', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'company-profile.html'));
});

// --- API Routes for Company Data ---

router.post('/companies', async (req, res) => {
    console.log('[API POST /api/companies] Received data:', JSON.stringify(req.body, null, 2));
    try {
        const {
            companyName,
            ownerName,
            ownerEmail,
            ownerPhone,
            contactName,
            contactEmail,
            contactPhone,
            address,
            timezone
        } = req.body;

        if (!companyName || !ownerName || !ownerEmail || !contactPhone || !timezone ||
            !address || !address.street || !address.city || !address.state || !address.zip || !address.country) {
            console.warn('[API POST /api/companies] Validation failed. Missing or invalid required fields. Data received:', req.body);
            return res.status(400).json({ message: 'Missing required fields or timezone is missing.' });
        }

        const newCompanyData = {
            companyName,
            tradeTypes: [],
            ownerName,
            ownerEmail,
            ownerPhone: ownerPhone || null,
            contactName: contactName || null,
            contactEmail: contactEmail || null,
            contactPhone,
            address,
            timezone: timezone || 'America/New_York'
        };

        // Use Mongoose model to create the company with all default values
        const newCompany = new Company(newCompanyData);
        const savedCompany = await newCompany.save();
        
        console.log('[API POST /api/companies] Company added successfully:', savedCompany.companyName, 'ID:', savedCompany._id);
        res.status(201).json(savedCompany);
    } catch (error) {
        console.error('[API POST /api/companies] Error:', error.message, error.stack);
        res.status(500).json({ message: `Error adding company: ${error.message}` });
    }
});

router.get('/companies', async (req, res) => {
    try {
        const companies = await Company.find({}).sort({ createdAt: -1 });
        res.json(companies);
    } catch (error) {
        console.error('[API GET /api/companies] Error:', error);
        res.status(500).json({ message: 'Error fetching companies' });
    }
});

// Middleware to check cache for company data
async function checkCompanyCache(req, res, next) {
    const { id } = req.params;
    const cacheKey = `company:${id}`;
    try {
        const cachedData = await redisClient.get(cacheKey);
        if (cachedData) {
            console.log(`CACHE HIT for ${cacheKey}`);
            return res.status(200).json(JSON.parse(cachedData));
        } else {
            console.log(`CACHE MISS for ${cacheKey}`);
            next();
        }
    } catch (error) {
        console.error('Redis error:', error);
        next();
    }
}

router.get('/company/:id', checkCompanyCache, async (req, res) => {
    const companyId = req.params.id;
    if (!ObjectId.isValid(companyId)) {
        return res.status(400).json({ message: 'Invalid company ID format' });
    }
    try {
        const company = await Company.findById(companyId);
        if (!company) return res.status(404).json({ message: 'Company not found' });

        const cacheKey = `company:${companyId}`;
        await redisClient.setEx(cacheKey, 3600, JSON.stringify(company));
        console.log(`SAVED to cache: ${cacheKey}`);

        if (company.aiSettings?.elevenLabs?.apiKey) {
            company.aiSettings.elevenLabs.apiKey = '*****';
        }
        res.json(company);
    } catch (error) {
        console.error('[API GET /api/company/:id] Error:', error);
        res.status(500).json({ message: 'Error fetching company details' });
    }
});

router.patch('/company/:id', async (req, res) => {
    console.log(`[API PATCH /api/company/:id] (Overview) Received update for ID: ${req.params.id} with data:`, JSON.stringify(req.body, null, 2));
    const companyId = req.params.id;

    if (!ObjectId.isValid(companyId)) return res.status(400).json({ message: 'Invalid company ID format' });

    try {
        const updates = req.body;
        delete updates._id;

        const updateOperation = {};
        if (updates.address && typeof updates.address === 'object') {
            for (const subKey in updates.address) {
                updateOperation[`address.${subKey}`] = updates.address[subKey];
            }
            delete updates.address;
        } else {
             if(updates.addressStreet !== undefined) { updateOperation['address.street'] = updates.addressStreet; delete updates.addressStreet;}
             if(updates.addressCity   !== undefined) { updateOperation['address.city'] = updates.addressCity;   delete updates.addressCity;}
             if(updates.addressState  !== undefined) { updateOperation['address.state'] = updates.addressState;  delete updates.addressState;}
             if(updates.addressZip    !== undefined) { updateOperation['address.zip'] = updates.addressZip;    delete updates.addressZip;}
             if(updates.addressCountry!== undefined) { updateOperation['address.country'] = updates.addressCountry; delete updates.addressCountry;}
        }

        for (const key in updates) {
            if (Object.prototype.hasOwnProperty.call(updates, key)) {
                if (key === 'tradeTypes') {
                    if (Array.isArray(updates[key])) {
                        updateOperation[key] = updates[key];
                    } else if (updates[key]) {
                        updateOperation[key] = [updates[key]];
                    } else {
                        updateOperation[key] = [];
                    }
                } else if (key === 'isActive' && typeof updates[key] !== 'boolean') {
                    updateOperation[key] = updates[key] === 'true' || updates[key] === true;
                } else if (key === 'additionalContacts' && Array.isArray(updates[key])) {
                    updateOperation[key] = updates[key];
                }
                else {
                    updateOperation[key] = updates[key];
                }
            }
        }
        updateOperation.updatedAt = new Date();

        const updatedCompany = await Company.findByIdAndUpdate(
            companyId,
            updateOperation,
            { new: true, runValidators: true }
        );

        if (!updatedCompany) return res.status(404).json({ message: 'Company not found.' });

        const cacheKey = `company:${companyId}`;
        await redisClient.del(cacheKey);
        console.log(`DELETED from cache: ${cacheKey}`);

        res.json(updatedCompany);
    } catch (error) {
        console.error(`[API PATCH /api/company/:id] (Overview) Error updating company ${companyId}:`, error.message, error.stack);
        res.status(500).json({ message: `Error updating company: ${error.message}` });
    }
});

router.patch('/company/:companyId/configuration', async (req, res) => {
    const { companyId } = req.params;
    const { twilioConfig, smsSettings } = req.body;
    if (!ObjectId.isValid(companyId)) return res.status(400).json({ message: 'Invalid company ID format' });

    try {
        const updateFields = {};
        if (twilioConfig && typeof twilioConfig === 'object') {
            updateFields['twilioConfig.accountSid'] = twilioConfig.accountSid || null;
            updateFields['twilioConfig.authToken'] = twilioConfig.authToken || null;
            updateFields['twilioConfig.phoneNumber'] = twilioConfig.phoneNumber ? normalizePhoneNumber(twilioConfig.phoneNumber) : null;
        }
        if (smsSettings && typeof smsSettings === 'object') {
            updateFields['smsSettings.jobAlerts'] = !!smsSettings.jobAlerts;
            updateFields['smsSettings.customerReplies'] = !!smsSettings.customerReplies;
            updateFields['smsSettings.appointmentReminders'] = !!smsSettings.appointmentReminders;
        }

        if (Object.keys(updateFields).length === 0) {
            const company = await Company.findById(companyId);
            return res.json(company || { message: 'Company not found, no updates made.'});
        }
        updateFields.updatedAt = new Date();
        
        const updatedCompany = await Company.findByIdAndUpdate(
            companyId,
            updateFields,
            { new: true, runValidators: true }
        );
        
        if (!updatedCompany) return res.status(404).json({ message: 'Company not found' });

        const cacheKey = `company:${companyId}`;
        await redisClient.del(cacheKey);
        console.log(`DELETED from cache: ${cacheKey}`);

        res.json(updatedCompany);
    } catch (error) {
        console.error(`[API PATCH /api/company/${companyId}/configuration] Error:`, error.message, error.stack);
        res.status(500).json({ message: `Error updating configuration: ${error.message}` });
    }
});

// This route needs to be updated if you want to manage Google Calendar OAuth tokens here.
// For now, it only updates highlevel. Google Calendar linking should have its own dedicated routes.
router.patch('/company/:companyId/integrations', async (req, res) => {
    const { companyId } = req.params;
    const { integrations } = req.body; // Assuming this only sends highlevel data
    if (!ObjectId.isValid(companyId)) return res.status(400).json({ message: 'Invalid company ID format' });
    if (!integrations || typeof integrations !== 'object') {
        return res.status(400).json({ message: 'Integrations data is required and must be an object.' });
    }

    try {
        const updateFields = {
            'integrations.highlevelApiKey': integrations.highlevelApiKey || null,
            'integrations.highlevelCalendarId': integrations.highlevelCalendarId || null,
            updatedAt: new Date()
        };

        const updatedCompany = await Company.findByIdAndUpdate(
            companyId,
            updateFields,
            { new: true, runValidators: true }
        );
        
        if (!updatedCompany) return res.status(404).json({ message: 'Company not found' });

        const cacheKey = `company:${companyId}`;
        await redisClient.del(cacheKey);
        console.log(`DELETED from cache: ${cacheKey}`);

        res.json(updatedCompany);
    } catch (error) {
        console.error(`[API PATCH /api/company/${companyId}/integrations] Error:`, error.message, error.stack);
        res.status(500).json({ message: `Error updating integrations: ${error.message}` });
    }
});


router.patch('/company/:companyId/aisettings', async (req, res) => {
    const { companyId } = req.params;
    const { aiSettings } = req.body;
    if (!ObjectId.isValid(companyId)) return res.status(400).json({ message: 'Invalid company ID format' });
    if (!aiSettings || typeof aiSettings !== 'object' || Object.keys(aiSettings).length === 0) {
        return res.status(400).json({ message: 'Invalid or missing aiSettings data' });
    }

    try {
        const currentCompany = await Company.findById(companyId);
        if (!currentCompany) return res.status(404).json({ message: 'Company not found' });
        const currentAISettings = currentCompany.aiSettings || {};

        // Build the $set object carefully to preserve existing fields if not provided in the request
        const updatePayload = {};
        if (aiSettings.model !== undefined) updatePayload['aiSettings.model'] = aiSettings.model;
        if (aiSettings.personality !== undefined) updatePayload['aiSettings.personality'] = aiSettings.personality;
        if (aiSettings.googleVoice !== undefined) updatePayload['aiSettings.googleVoice'] = aiSettings.googleVoice;
        if (aiSettings.voicePitch !== undefined) updatePayload['aiSettings.voicePitch'] = Number(aiSettings.voicePitch);
        if (aiSettings.voiceSpeed !== undefined) updatePayload['aiSettings.voiceSpeed'] = Number(aiSettings.voiceSpeed);
        if (aiSettings.responseLength !== undefined) updatePayload['aiSettings.responseLength'] = aiSettings.responseLength;
        if (aiSettings.knowledgeBaseSource !== undefined) updatePayload['aiSettings.knowledgeBaseSource'] = aiSettings.knowledgeBaseSource;
        if (aiSettings.escalationKeywords !== undefined) updatePayload['aiSettings.escalationKeywords'] = aiSettings.escalationKeywords;
        if (typeof aiSettings.sentimentAnalysis === 'boolean') updatePayload['aiSettings.sentimentAnalysis'] = aiSettings.sentimentAnalysis;
        if (typeof aiSettings.dataLogging === 'boolean') updatePayload['aiSettings.dataLogging'] = aiSettings.dataLogging;
        if (typeof aiSettings.bargeIn === 'boolean') updatePayload['aiSettings.bargeIn'] = aiSettings.bargeIn;
        if (typeof aiSettings.proactiveOutreach === 'boolean') updatePayload['aiSettings.proactiveOutreach'] = aiSettings.proactiveOutreach;
        if (typeof aiSettings.llmFallbackEnabled === 'boolean') updatePayload['aiSettings.llmFallbackEnabled'] = aiSettings.llmFallbackEnabled;
        if (aiSettings.customEscalationMessage !== undefined) updatePayload['aiSettings.customEscalationMessage'] = aiSettings.customEscalationMessage;
        
        // Agent Performance Controls
        if (aiSettings.silenceTimeout !== undefined) updatePayload['aiSettings.silenceTimeout'] = Number(aiSettings.silenceTimeout);
        if (aiSettings.responseDelayMs !== undefined) updatePayload['aiSettings.responseDelayMs'] = Number(aiSettings.responseDelayMs);
        if (aiSettings.fuzzyMatchThreshold !== undefined) updatePayload['aiSettings.fuzzyMatchThreshold'] = Number(aiSettings.fuzzyMatchThreshold);
        if (aiSettings.twilioSpeechConfidenceThreshold !== undefined) updatePayload['aiSettings.twilioSpeechConfidenceThreshold'] = Number(aiSettings.twilioSpeechConfidenceThreshold);
        if (aiSettings.maxRepeats !== undefined) updatePayload['aiSettings.maxRepeats'] = Number(aiSettings.maxRepeats);

        // *** MODIFICATION FOR GOOGLE CALENDAR SWITCH ***
        if (typeof aiSettings.enableGoogleCalendarIntegration === 'boolean') {
            updatePayload['aiSettings.enableGoogleCalendarIntegration'] = aiSettings.enableGoogleCalendarIntegration;
        } else if (currentAISettings.enableGoogleCalendarIntegration === undefined) {
            // If not in payload and not in DB, default to false
            updatePayload['aiSettings.enableGoogleCalendarIntegration'] = false;
        }
        // Else, if not in payload but exists in DB, it will be preserved (no explicit $set)

        updatePayload.updatedAt = new Date();

        if (Object.keys(updatePayload).length <= 1) { // Only updatedAt
            const company = await Company.findById(companyId);
            return res.json(company || { message: 'Company found, no AI settings updates applied.'});
        }

        const updatedCompany = await Company.findByIdAndUpdate(
            companyId,
            updatePayload,
            { new: true, runValidators: true }
        );

        if (!updatedCompany) return res.status(404).json({ message: 'Company not found (during update)' });

        const cacheKey = `company:${companyId}`;
        await redisClient.del(cacheKey);
        console.log(`DELETED from cache: ${cacheKey}`);

        res.json(updatedCompany);
    } catch (error) {
        console.error(`[API PATCH /api/company/${companyId}/aisettings] Error:`, error.message, error.stack);
        res.status(500).json({ message: `Error updating AI settings: ${error.message}` });
    }
});


router.patch('/company/:companyId/agentsetup', async (req, res) => {
    const { companyId } = req.params;
    const { agentSetup, tradeTypes, timezone } = req.body;

    console.log(`[API PATCH /api/company/${companyId}/agentsetup] Received data:`, JSON.stringify(req.body, null, 2));

    const db = getDB();
    if (!db) return res.status(500).json({ message: 'Database not connected' });
    if (!ObjectId.isValid(companyId)) return res.status(400).json({ message: 'Invalid company ID format' });
    if (!agentSetup || typeof agentSetup !== 'object') return res.status(400).json({ message: 'Agent Setup data is required.' });

    const companiesCollection = db.collection('companiesCollection');
    try {
        // Fetch current company to merge agentSetup properly
        const currentCompany = await companiesCollection.findOne({ _id: new ObjectId(companyId) });
        if (!currentCompany) {
            return res.status(404).json({ message: 'Company not found' });
        }
        const currentAgentSetup = currentCompany.agentSetup || {};

        const finalAgentSetup = {
            agentMode: agentSetup.agentMode !== undefined ? agentSetup.agentMode : currentAgentSetup.agentMode || 'full',
            categories: (tradeTypes && Array.isArray(tradeTypes)) ? tradeTypes : (agentSetup.categories !== undefined ? agentSetup.categories : currentAgentSetup.categories || []),
            companySpecialties: agentSetup.companySpecialties !== undefined ? agentSetup.companySpecialties : currentAgentSetup.companySpecialties || '',
            timezone: timezone || (agentSetup.timezone !== undefined ? agentSetup.timezone : currentAgentSetup.timezone || 'America/New_York'),
            operatingHours: agentSetup.operatingHours || currentAgentSetup.operatingHours || daysOfWeekForOperatingHours.map(day => ({day: day, enabled: !['Saturday', 'Sunday'].includes(day), start: '09:00', end: '17:00'})),
            use247Routing: typeof agentSetup.use247Routing === 'boolean' ? agentSetup.use247Routing : currentAgentSetup.use247Routing || false,
            afterHoursAction: agentSetup.afterHoursAction !== undefined ? agentSetup.afterHoursAction : currentAgentSetup.afterHoursAction || 'message',
            onCallForwardingNumber: agentSetup.onCallForwardingNumber !== undefined ? agentSetup.onCallForwardingNumber : currentAgentSetup.onCallForwardingNumber ||'',
            greetingType: agentSetup.greetingType !== undefined ? agentSetup.greetingType : currentAgentSetup.greetingType || 'tts',
            greetingAudioUrl: agentSetup.greetingAudioUrl !== undefined ? agentSetup.greetingAudioUrl : currentAgentSetup.greetingAudioUrl || '',
            agentGreeting: agentSetup.agentGreeting !== undefined ? agentSetup.agentGreeting : currentAgentSetup.agentGreeting || '',
            mainAgentScript: agentSetup.mainAgentScript !== undefined ? agentSetup.mainAgentScript : currentAgentSetup.mainAgentScript || '',
            agentClosing: agentSetup.agentClosing !== undefined ? agentSetup.agentClosing : currentAgentSetup.agentClosing || '',
            protocols: agentSetup.protocols || currentAgentSetup.protocols || {},
            textToPayPhoneSource: agentSetup.textToPayPhoneSource !== undefined ? agentSetup.textToPayPhoneSource : currentAgentSetup.textToPayPhoneSource || 'callerID',
            schedulingRules: agentSetup.schedulingRules || currentAgentSetup.schedulingRules || [],
            callRouting: agentSetup.callRouting || currentAgentSetup.callRouting || [],
            afterHoursRouting: agentSetup.afterHoursRouting || currentAgentSetup.afterHoursRouting || [],
            summaryRecipients: agentSetup.summaryRecipients || currentAgentSetup.summaryRecipients || [],
            afterHoursRecipients: agentSetup.afterHoursRecipients || currentAgentSetup.afterHoursRecipients || [],
            malfunctionForwarding: agentSetup.malfunctionForwarding || currentAgentSetup.malfunctionForwarding || [],
            malfunctionRecipients: agentSetup.malfunctionRecipients || currentAgentSetup.malfunctionRecipients || [],
            placeholders: agentSetup.placeholders || currentAgentSetup.placeholders || []
           };

        const updateFields = {
            agentSetup: finalAgentSetup,
            updatedAt: new Date()
        };
        if (tradeTypes && Array.isArray(tradeTypes)) {
            updateFields.tradeTypes = tradeTypes; // Update root tradeTypes if provided
        }
        if (timezone) { // Update root timezone if provided
            updateFields.timezone = timezone;
        }

        const result = await companiesCollection.updateOne(
            { _id: new ObjectId(companyId) },
            { $set: updateFields }
        );

        if (result.matchedCount === 0) return res.status(404).json({ message: 'Company not found (during update)' });

        console.log(`[API PATCH /api/company/${companyId}/agentsetup] Agent Setup updated. Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}`);
        const updatedCompany = await companiesCollection.findOne({ _id: new ObjectId(companyId) });

        const cacheKey = `company:${companyId}`;
        await redisClient.del(cacheKey);
        console.log(`DELETED from cache: ${cacheKey}`);

        res.json(updatedCompany);
    } catch (error) {
        console.error(`[API PATCH /api/company/${companyId}/agentsetup] Error updating agent setup:`, error.message, error.stack);
        res.status(500).json({ message: `Error updating agent setup: ${error.message}` });
    }
});

router.get('/company/:companyId/personality-responses', async (req, res) => {
    const { companyId } = req.params;
    const db = getDB();
    if (!db) return res.status(500).json({ message: 'Database not connected' });
    if (!ObjectId.isValid(companyId)) return res.status(400).json({ message: 'Invalid company ID format' });
    const companiesCollection = db.collection('companiesCollection');
    try {
        const company = await companiesCollection.findOne(
            { _id: new ObjectId(companyId) },
            { projection: { personalityResponses: 1 } }
        );
        if (!company) return res.status(404).json({ message: 'Company not found' });
        res.json(company.personalityResponses || {});
    } catch (error) {
        console.error(`[API GET /api/company/${companyId}/personality-responses] Error:`, error.message, error.stack);
        res.status(500).json({ message: `Error fetching personality responses: ${error.message}` });
    }
});

router.patch('/company/:companyId/personality-responses', async (req, res) => {
    const { companyId } = req.params;
    const { personalityResponses } = req.body;
    const db = getDB();
    if (!db) return res.status(500).json({ message: 'Database not connected' });
    if (!ObjectId.isValid(companyId)) return res.status(400).json({ message: 'Invalid company ID format' });
    if (!personalityResponses || typeof personalityResponses !== 'object') {
        return res.status(400).json({ message: 'personalityResponses object required' });
    }
    const companiesCollection = db.collection('companiesCollection');
    try {
        await companiesCollection.updateOne(
            { _id: new ObjectId(companyId) },
            { $set: { personalityResponses, updatedAt: new Date() } }
        );
        const updatedCompany = await companiesCollection.findOne({ _id: new ObjectId(companyId) });
        const cacheKey = `company:${companyId}`;
        await redisClient.del(cacheKey);
        console.log(`DELETED from cache: ${cacheKey}`);
        clearCompanyResponsesCache(companyId);
        res.json(updatedCompany);
    } catch (error) {
        console.error(`[API PATCH /api/company/${companyId}/personality-responses] Error:`, error.message, error.stack);
        res.status(500).json({ message: `Error updating personality responses: ${error.message}` });
    }
});


// --- NOTES API ROUTES ---
router.post('/company/:companyId/notes', async (req, res) => { /* ...your existing notes route... */ });
router.patch('/company/:companyId/notes/:noteId', async (req, res) => { /* ...your existing notes route... */ });
router.delete('/company/:companyId/notes/:noteId', async (req, res) => { /* ...your existing notes route... */ });
router.delete('/company/:id', async (req, res) => { /* ...your existing company delete route... */ });


// --- Google Calendar OAuth Routes --- START ---

// 1. Initiate Authorization to Google
router.get('/company/:companyId/google-calendar/authorize', async (req, res) => {
    const { companyId } = req.params;
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
        return res.status(500).send('Google Calendar integration is not configured on the server.');
    }
    if (!ObjectId.isValid(companyId)) {
        return res.status(400).send('Invalid Company ID.');
    }

    const scopes = [
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/calendar.readonly',
        'openid',
        'email',
        'profile'
    ];
    const state = Buffer.from(JSON.stringify({ companyId })).toString('base64');

    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes,
        prompt: 'consent', // Important to try and get refresh_token on subsequent authorizations too
        state: state
    });
    console.log(`[Google Auth] Redirecting company ${companyId} to Google consent screen.`);
    res.redirect(authUrl);
});

// 2. Handle OAuth Callback from Google
router.get('/google-calendar/oauth2callback', async (req, res) => {
    const { code, state, error: googleError } = req.query; // Renamed 'error' to 'googleError' to avoid conflict

    if (!GOOGLE_CLIENT_ID) return res.status(500).send('Google Calendar integration is not configured on the server.');

    let companyIdFromState; // To redirect user even if some early errors occur

    if (state) {
        try {
            const decodedState = JSON.parse(Buffer.from(state, 'base64').toString('ascii'));
            companyIdFromState = decodedState.companyId;
        } catch (e) {
            console.error('[Google Auth Callback] Invalid state parameter format:', e);
            // Cannot determine companyId, redirect to a generic error page or home
            return res.redirect('/directory.html?googleAuthError=' + encodeURIComponent('Invalid state parameter.'));
        }
    }

    const redirectUrl = companyIdFromState ? `/company-profile.html?id=${companyIdFromState}` : '/directory.html';

    if (googleError) {
        console.error('[Google Auth Callback] Error from Google:', googleError);
        return res.redirect(`${redirectUrl}&googleAuthError=` + encodeURIComponent(googleError));
    }
    if (!code) {
        return res.redirect(`${redirectUrl}&googleAuthError=` + encodeURIComponent('Missing authorization code.'));
    }
    if (!state || !companyIdFromState) { // companyIdFromState check already done implicitly by redirectUrl logic
        return res.redirect('/directory.html?googleAuthError=' + encodeURIComponent('Missing or invalid state parameter.'));
    }
     if (!ObjectId.isValid(companyIdFromState)) {
        console.error('[Google Auth Callback] Invalid companyId in state:', companyIdFromState);
        return res.redirect('/directory.html?googleAuthError=invalid_company_in_state');
    }


    const db = getDB();
    if (!db) {
         console.error('[Google Auth Callback] Database not connected.');
         return res.redirect(`${redirectUrl}&googleAuthError=` + encodeURIComponent('Server database error.'));
    }
    const companiesCollection = db.collection('companiesCollection');

    try {
        const { tokens } = await oauth2Client.getToken(code);
        // oauth2Client.setCredentials(tokens); // Set for current instance, but we primarily save to DB

        const tempClientForUserInfo = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
        tempClientForUserInfo.setCredentials(tokens);
        const oauth2UserInfoService = google.oauth2({ version: 'v2', auth: tempClientForUserInfo });
        const userInfo = await oauth2UserInfoService.userinfo.get();
        const userEmail = userInfo.data.email;

        const googleCalendarUpdate = {
            'integrations.googleCalendar.isLinked': true,
            'integrations.googleCalendar.authedUserEmail': userEmail,
            'integrations.googleCalendar.accessToken': tokens.access_token,
            'integrations.googleCalendar.lastAuthError': null, // Clear previous error
        };
        if (tokens.refresh_token) {
            googleCalendarUpdate['integrations.googleCalendar.refreshToken'] = tokens.refresh_token;
        }
        if (tokens.expiry_date) { // expiry_date is a timestamp (number of milliseconds since epoch)
            googleCalendarUpdate['integrations.googleCalendar.tokenExpiryDate'] = new Date(tokens.expiry_date);
        }

        await companiesCollection.updateOne(
            { _id: new ObjectId(companyIdFromState) },
            { $set: { ...googleCalendarUpdate, updatedAt: new Date() } }
        );
        console.log(`[Google Auth Callback] Successfully linked Google Calendar for company ${companyIdFromState}, email: ${userEmail}`);
        res.redirect(`/company-profile.html?id=${companyIdFromState}&googleAuthSuccess=true`);

    } catch (err) {
        const errorMessage = err.response?.data?.error_description || err.response?.data?.error || err.message || 'Unknown error during Google OAuth.';
        console.error('[Google Auth Callback] Error exchanging token or saving to DB for company ' + companyIdFromState + ':', errorMessage, err.stack ? err.stack.substring(0,500) : '');
        try {
            await companiesCollection.updateOne(
                { _id: new ObjectId(companyIdFromState) },
                { $set: {
                    'integrations.googleCalendar.isLinked': false,
                    'integrations.googleCalendar.accessToken': null, // Clear potentially partially stored token
                    // Do not clear refresh token here if it existed, as it might still be valid for a new attempt.
                    'integrations.googleCalendar.lastAuthError': errorMessage,
                    updatedAt: new Date()
                }}
            );
        } catch (dbError) {
             console.error('[Google Auth Callback] CRITICAL: Failed to even update DB with error state for company ' + companyIdFromState + ':', dbError);
        }
        res.redirect(`/company-profile.html?id=${companyIdFromState}&googleAuthError=` + encodeURIComponent(errorMessage));
    }
});

// Helper function to get an authenticated Google API client for a company
async function getGoogleAPIClient(companyId, db) {
    if (!GOOGLE_CLIENT_ID) throw new Error('Google Calendar integration not configured on server.');

    const companiesCollection = db.collection('companiesCollection');
    const company = await companiesCollection.findOne({ _id: new ObjectId(companyId) });

    if (!company || !company.integrations || !company.integrations.googleCalendar || !company.integrations.googleCalendar.isLinked) {
        throw new Error('Google Calendar is not linked for this company.');
    }
    if (!company.integrations.googleCalendar.accessToken) { // Essential token missing
        throw new Error('Google Calendar access token is missing. Please re-authorize.');
    }


    const gcal = company.integrations.googleCalendar;
    const client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
    client.setCredentials({
        access_token: gcal.accessToken,
        refresh_token: gcal.refreshToken, // This can be null if not obtained or if revoked
        expiry_date: gcal.tokenExpiryDate ? new Date(gcal.tokenExpiryDate).getTime() : null
    });

    // Check if token is expired or about to expire (e.g., within 5 minutes)
    if (client.isTokenExpiring()) { // isTokenExpiring() checks against current time
        console.log(`[Google API Client] Token for company ${companyId} is expiring or expired. Attempting refresh.`);
        if (!gcal.refreshToken) {
            console.error(`[Google API Client] Cannot refresh token for company ${companyId}: No refresh token available.`);
             await companiesCollection.updateOne(
                { _id: new ObjectId(companyId) },
                { $set: { 'integrations.googleCalendar.isLinked': false, 'integrations.googleCalendar.lastAuthError': 'Refresh token missing. Please re-authorize.' } }
            );
            throw new Error('Refresh token missing. Please re-authorize Google Calendar.');
        }
        try {
            const { credentials } = await client.refreshAccessToken(); // This refreshes and updates client.credentials
            // client.setCredentials(credentials); // Already done by refreshAccessToken internally

            const updateData = {
                'integrations.googleCalendar.accessToken': credentials.access_token,
            };
            if (credentials.expiry_date) {
                updateData['integrations.googleCalendar.tokenExpiryDate'] = new Date(credentials.expiry_date);
            }
            if (credentials.refresh_token) { // A new refresh token might be issued
                updateData['integrations.googleCalendar.refreshToken'] = credentials.refresh_token;
            }
            updateData['integrations.googleCalendar.lastAuthError'] = null; // Clear error on successful refresh

            await companiesCollection.updateOne({ _id: new ObjectId(companyId) }, { $set: { ...updateData, updatedAt: new Date() } });
            console.log(`[Google API Client] Token refreshed and saved for company ${companyId}.`);
        } catch (refreshError) {
            const errMsg = refreshError.response?.data?.error || refreshError.message;
            console.error(`[Google API Client] Failed to refresh token for company ${companyId}:`, errMsg);
            await companiesCollection.updateOne(
                { _id: new ObjectId(companyId) },
                { $set: {
                    'integrations.googleCalendar.isLinked': false,
                    'integrations.googleCalendar.lastAuthError': `Token refresh failed: ${errMsg}. Please re-authorize.`,
                    updatedAt: new Date()
                }}
            );
            throw new Error(`Token refresh failed: ${errMsg}. Please re-authorize Google Calendar.`);
        }
    }
    return client;
}

// 3. List User's Google Calendars
router.get('/company/:companyId/google-calendars/list', async (req, res) => {
    const { companyId } = req.params;
    const db = getDB();
    if (!db) return res.status(500).json({ message: 'Database not connected' });
    if (!ObjectId.isValid(companyId)) return res.status(400).json({ message: 'Invalid Company ID.' });
    if (!GOOGLE_CLIENT_ID) return res.status(500).json({ message: 'Google Calendar integration not configured on server.' });

    try {
        const authClient = await getGoogleAPIClient(companyId, db);
        const calendar = google.calendar({ version: 'v3', auth: authClient });
        const response = await calendar.calendarList.list({ minAccessRole: 'writer' });
        const calendars = response.data.items.map(cal => ({
            id: cal.id,
            summary: cal.summary,
            primary: cal.primary || false,
            accessRole: cal.accessRole,
            description: cal.description || null,
            timeZone: cal.timeZone
        }));
        res.json(calendars);
    } catch (error) {
        console.error(`[API GET /company/${companyId}/google-calendars/list] Error:`, error.message);
        res.status(500).json({ message: error.message || 'Failed to list Google Calendars.' });
    }
});

// 4. Disconnect Google Calendar
router.post('/company/:companyId/google-calendar/disconnect', async (req, res) => {
    const { companyId } = req.params;
    const db = getDB();
    if (!db) return res.status(500).json({ message: 'Database not connected.' });
    if (!ObjectId.isValid(companyId)) return res.status(400).json({ message: 'Invalid Company ID.' });
    if (!GOOGLE_CLIENT_ID) return res.status(500).json({ message: 'Google Calendar integration not configured on server.' });

    const companiesCollection = db.collection('companiesCollection');
    let companyDataBeforeDisconnect;
    try {
        companyDataBeforeDisconnect = await companiesCollection.findOne({ _id: new ObjectId(companyId) });
        const refreshToken = companyDataBeforeDisconnect?.integrations?.googleCalendar?.refreshToken;

        if (refreshToken) {
            // It's good practice to try and revoke the token on Google's side
            // oauth2Client.setCredentials({ refresh_token: refreshToken }); // Not strictly needed for revokeToken
            await oauth2Client.revokeToken(refreshToken);
            console.log(`[Google Disconnect] Token successfully revoked with Google for company ${companyId}`);
        } else {
            console.log(`[Google Disconnect] No refresh token found for company ${companyId} to revoke. Clearing local data only.`);
        }
    } catch (revokeError) {
        // Log the error but proceed to clear local data as the token might be invalid/already revoked
        console.warn(`[Google Disconnect] Failed to revoke token with Google for company ${companyId} (it may have already been invalid/revoked):`, revokeError.message);
    }

    // Always clear local data regardless of revocation success/failure
    try {
        const updateResult = await companiesCollection.updateOne(
            { _id: new ObjectId(companyId) },
            {
                $set: {
                    'integrations.googleCalendar.isLinked': false,
                    'integrations.googleCalendar.accessToken': null,
                    'integrations.googleCalendar.refreshToken': null,
                    'integrations.googleCalendar.tokenExpiryDate': null,
                    'integrations.googleCalendar.authedUserEmail': null,
                    'integrations.googleCalendar.lastAuthError': 'Disconnected by user.',
                    updatedAt: new Date()
                }
            }
        );
         if (updateResult.matchedCount === 0) {
            return res.status(404).json({ message: 'Company not found for disconnect.' });
        }
        res.json({ message: 'Google Calendar disconnected successfully.' });
    } catch (dbError) {
        console.error(`[API POST /company/${companyId}/google-calendar/disconnect] DB Error during disconnect:`, dbError.message, dbError.stack);
        res.status(500).json({ message: `Database error during Google Calendar disconnect: ${dbError.message}` });
    }
});

// --- Google Calendar OAuth Routes --- END ---

// ========================================================================
// ====> CORRECT ROUTE TO SAVE UNIFIED VOICE SETTINGS <====
// ========================================================================
router.patch('/company/:companyId/voice-settings', async (req, res) => {
    const { companyId } = req.params;
    const voiceSettings = req.body;

    if (!companyId || !voiceSettings || !ObjectId.isValid(companyId)) {
        return res.status(400).json({ message: 'Invalid or missing company ID or settings data.' });
    }

    const db = getDB();
    if (!db) return res.status(500).json({ message: 'Database not connected' });

    try {
        const updatePayload = {
            'aiSettings.googleVoice': voiceSettings.googleVoiceName,
            'aiSettings.voicePitch': voiceSettings.googleVoicePitch,
            'aiSettings.voiceSpeed': voiceSettings.googleVoiceSpeed,
            'aiSettings.ttsProvider': voiceSettings.ttsProvider,
            'aiSettings.elevenLabs.apiKey': voiceSettings.elevenlabsApiKey,
            'aiSettings.elevenLabs.voiceId': voiceSettings.elevenlabsVoiceId,
            'aiSettings.elevenLabs.stability': voiceSettings.elevenlabsStability,
            'aiSettings.elevenLabs.similarityBoost': voiceSettings.elevenlabsClarity,
            'aiSettings.elevenLabs.style': voiceSettings.elevenlabsStyle,
            'aiSettings.elevenLabs.modelId': voiceSettings.elevenlabsModelId,
            'aiSettings.responseDelayMs': Number(voiceSettings.responseDelayMs || 0),
            'aiSettings.twilioSpeechConfidenceThreshold': Number(voiceSettings.twilioSpeechConfidenceThreshold || 0.5),
            'aiSettings.fuzzyMatchThreshold': Number(voiceSettings.fuzzyMatchThreshold || 0.5),
            'aiSettings.speechConfirmation': voiceSettings.speechConfirmation,
            'aiSettings.logCalls': !!voiceSettings.logCalls,
            'updatedAt': new Date()
        };

        const dbResult = await getDB().collection('companiesCollection').updateOne(
            { _id: new ObjectId(companyId) },
            { $set: updatePayload }
        );

        if (dbResult.matchedCount === 0) {
            return res.status(404).json({ message: 'Company not found.' });
        }
        
        const cacheKey = `company:${companyId}`;
        await redisClient.del(cacheKey);
        console.log(`DELETED from cache after voice settings update: ${cacheKey}`);

        res.status(200).json({ message: "Voice settings updated successfully." });

    } catch (error) {
        console.error(`Error saving voice settings for company ${companyId}:`, error);
        res.status(500).json({ message: 'Server error while saving voice settings.' });
    }
});

module.exports = router;
