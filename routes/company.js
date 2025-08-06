const express = require('express');
const router = express.Router();
const path = require('path');
const { getDB } = require('../db');
const { ObjectId } = require('mongodb');
const Company = require('../models/Company'); // Add Company model import
const { google } = require('googleapis'); // For Google Calendar
const { normalizePhoneNumber } = require('../utils/phone');
const { redisClient } = require('../clients');
const { apiLimiter } = require('../middleware/rateLimit'); // Rate limiting
const { authenticateJWT, requireRole } = require('../middleware/auth'); // Authentication
const { defaultResponses, clearCompanyResponsesCache, initializeStandardPersonalityResponses, ensurePersonalityResponsesExist } = require('../utils/personalityResponses_enhanced');

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
            companyPhone,
            companyAddress,
            // Legacy fields (optional for backward compatibility)
            ownerName,
            ownerEmail,
            ownerPhone,
            contactName,
            contactEmail,
            contactPhone,
            address,
            timezone
        } = req.body;

        // Check for simplified form (new workflow) vs legacy form
        const isSimplifiedForm = companyPhone && companyAddress && !ownerName && !ownerEmail;
        
        let newCompanyData;
        
        if (isSimplifiedForm) {
            // New simplified validation - only requires company name, phone, and address
            if (!companyName || !companyPhone || !companyAddress) {
                console.warn('[API POST /api/companies] Simplified form validation failed. Missing required fields:', {
                    companyName: !!companyName,
                    companyPhone: !!companyPhone,
                    companyAddress: !!companyAddress
                });
                return res.status(400).json({ message: 'Missing required fields: Company Name, Phone Number, and Address are required.' });
            }

            newCompanyData = {
                companyName,
                companyPhone,
                companyAddress,
                // Set defaults for fields to be completed later
                tradeTypes: [],
                ownerName: null,
                ownerEmail: null,
                ownerPhone: null,
                contactName: null,
                contactEmail: null,
                contactPhone: null,
                address: {
                    street: '',
                    city: '',
                    state: '',
                    zip: '',
                    country: 'USA'
                },
                timezone: timezone || 'America/New_York',
                status: 'active',
                profileComplete: false // Flag to track if additional details have been added
            };

            console.log('[API POST /api/companies] Creating simplified company with data:', newCompanyData);
            
        } else {
            // Legacy validation for backward compatibility
            if (!companyName || !ownerName || !ownerEmail || !contactPhone || !timezone ||
                !address || !address.street || !address.city || !address.state || !address.zip || !address.country) {
                console.warn('[API POST /api/companies] Legacy form validation failed. Missing or invalid required fields. Data received:', req.body);
                return res.status(400).json({ message: 'Missing required fields or timezone is missing.' });
            }

            newCompanyData = {
                companyName,
                tradeTypes: [],
                ownerName,
                ownerEmail,
                ownerPhone: ownerPhone || null,
                contactName: contactName || null,
                contactEmail: contactEmail || null,
                contactPhone,
                address,
                timezone: timezone || 'America/New_York',
                profileComplete: true
            };
        }

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

// ADMIN ENDPOINT: Get all companies (requires admin authentication)
// Previously disabled for security - now restored with proper authentication
// Security Fix: July 27, 2025 - Added JWT authentication and admin role requirement
router.get('/companies', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        console.log('[ADMIN API GET /api/companies] Admin user requesting all companies:', req.user.email);
        
        // Use Mongoose model instead of direct collection access for consistency
        const companies = await Company.find({}, {
            // Include fields needed by the directory
            companyName: 1,
            tradeCategories: 1,
            isActive: 1,
            status: 1,
            createdAt: 1,
            updatedAt: 1,
            businessPhone: 1,
            businessEmail: 1,
            businessWebsite: 1,
            address: 1
            // Sensitive fields like API keys, tokens, etc. are excluded
        }).lean();
        
        console.log(`[ADMIN API GET /api/companies] Found ${companies.length} companies in database`);
        console.log(`[ADMIN API GET /api/companies] Returning ${companies.length} companies to admin`);
        
        res.json({
            success: true,
            data: companies,
            count: companies.length,
            message: 'Admin access granted to company directory'
        });
        
    } catch (err) {
        console.error('[ADMIN API GET /api/companies] Error:', err);
        res.status(500).json({ 
            message: 'Server error retrieving companies',
            error: err.message 
        });
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

// Delete a company completely from the database
router.delete('/company/:id', async (req, res) => {
    const companyId = req.params.id;
    console.log(`[API DELETE /api/company/:id] Deleting company with ID: ${companyId}`);
    
    if (!ObjectId.isValid(companyId)) {
        return res.status(400).json({ message: 'Invalid company ID format' });
    }
    
    try {
        // First, check if the company exists
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ message: 'Company not found' });
        }
        
        const companyName = company.companyName || company.name || 'Unknown Company';
        console.log(`[API DELETE /api/company/:id] Found company to delete: ${companyName}`);
        
        // Delete the company from the database
        const deleteResult = await Company.findByIdAndDelete(companyId);
        
        if (!deleteResult) {
            throw new Error('Failed to delete company from database');
        }
        
        // Clear the company from Redis cache
        try {
            const cacheKey = `company:${companyId}`;
            await redisClient.del(cacheKey);
            console.log(`[API DELETE /api/company/:id] Cleared cache: ${cacheKey}`);
        } catch (cacheError) {
            console.warn(`[API DELETE /api/company/:id] Failed to clear cache:`, cacheError.message);
            // Don't fail the request if cache clearing fails
        }
        
        // Clear any personality responses cache for this company
        try {
            await clearCompanyResponsesCache(companyId);
            console.log(`[API DELETE /api/company/:id] Cleared personality responses cache for company: ${companyId}`);
        } catch (personalityCacheError) {
            console.warn(`[API DELETE /api/company/:id] Failed to clear personality responses cache:`, personalityCacheError.message);
            // Don't fail the request if cache clearing fails
        }
        
        console.log(`[API DELETE /api/company/:id] Successfully deleted company: ${companyName} (ID: ${companyId})`);
        
        res.json({ 
            success: true,
            message: `Company "${companyName}" has been permanently deleted`,
            deletedCompanyId: companyId,
            deletedCompanyName: companyName
        });
        
    } catch (error) {
        console.error(`[API DELETE /api/company/:id] Error deleting company ${companyId}:`, error.message, error.stack);
        res.status(500).json({ 
            message: `Error deleting company: ${error.message}`,
            error: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

router.patch('/company/:id', async (req, res) => {
    console.log(`[API PATCH /api/company/:id] (Overview) Received update for ID: ${req.params.id} with data:`, JSON.stringify(req.body, null, 2));
    
    // GOLD STANDARD: Debug notes data specifically
    if (req.body.notes) {
        console.log('📝 [NOTES DEBUG] Notes field received:', req.body.notes);
        console.log('📝 [NOTES DEBUG] Notes is array:', Array.isArray(req.body.notes));
        console.log('📝 [NOTES DEBUG] Notes length:', req.body.notes.length);
    } else {
        console.log('📝 [NOTES DEBUG] No notes field in request body');
    }
    
    const companyId = req.params.id;

    if (!ObjectId.isValid(companyId)) return res.status(400).json({ message: 'Invalid company ID format' });

    try {
        const updates = req.body;
        delete updates._id;

        const updateOperation = {};
        
        // Handle address updates with dot notation
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
        
        // Handle twilioConfig updates with dot notation
        if (updates.twilioConfig && typeof updates.twilioConfig === 'object') {
            for (const subKey in updates.twilioConfig) {
                updateOperation[`twilioConfig.${subKey}`] = updates.twilioConfig[subKey];
            }
            delete updates.twilioConfig;
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
                } else if (key === 'contacts' && Array.isArray(updates[key])) {
                    updateOperation[key] = updates[key];
                } else if (key === 'notes' && Array.isArray(updates[key])) {
                    // GOLD STANDARD: Handle notes array properly
                    console.log('📝 [NOTES DEBUG] Processing notes array for save:', updates[key]);
                    updateOperation[key] = updates[key];
                }
                else {
                    updateOperation[key] = updates[key];
                }
            }
        }
        updateOperation.updatedAt = new Date();

        // Auto-set profileComplete when business details are provided
        const hasBusinessInfo = updates.businessEmail || updates.businessWebsite || updates.description || 
                              updates.businessPhone || updates.businessAddress || updates.serviceArea || updates.businessHours;
        if (hasBusinessInfo) {
            updateOperation.profileComplete = true;
        }

        const updatedCompany = await Company.findByIdAndUpdate(
            companyId,
            updateOperation,
            { new: true, runValidators: true }
        );

        if (!updatedCompany) return res.status(404).json({ message: 'Company not found.' });

        // GOLD STANDARD: Debug notes after save
        if (updatedCompany.notes) {
            console.log('📝 [NOTES DEBUG] Notes after save:', updatedCompany.notes.length, 'notes saved');
        }

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

// Voice Settings endpoint - ElevenLabs only
router.patch('/company/:companyId/voice-settings', async (req, res) => {
    const { companyId } = req.params;
    const settings = req.body;
    
    console.log('[Voice Settings Debug] Received settings:', settings);
    
    if (!ObjectId.isValid(companyId)) {
        return res.status(400).json({ message: 'Invalid company ID format' });
    }
    
    if (!settings || typeof settings !== 'object') {
        return res.status(400).json({ message: 'Invalid voice settings data' });
    }
    
    try {
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ message: 'Company not found' });
        }
        
        // Initialize aiSettings if it doesn't exist
        if (!company.aiSettings) {
            company.aiSettings = {};
        }
        
        // Update voice-related settings (ElevenLabs only)
        const voiceSettingsFields = [
            'ttsProvider', 
            'elevenlabsVoiceId', 
            'elevenlabsApiKey', 
            'elevenlabsStability', 
            'elevenlabsClarity',
            'twilioSpeechConfidenceThreshold',
            'fuzzyMatchThreshold'
        ];
        
        voiceSettingsFields.forEach(field => {
            if (field in settings) {
                console.log(`[Voice Settings Debug] Setting ${field} to:`, settings[field], `(type: ${typeof settings[field]})`);
                company.aiSettings[field] = settings[field];
            }
        });
        
        // Handle nested elevenLabs object
        if (settings.elevenlabsApiKey) {
            if (!company.aiSettings.elevenLabs) {
                company.aiSettings.elevenLabs = {};
            }
            company.aiSettings.elevenLabs.apiKey = settings.elevenlabsApiKey;
        }
        
        if (settings.elevenlabsVoiceId) {
            if (!company.aiSettings.elevenLabs) {
                company.aiSettings.elevenLabs = {};
            }
            company.aiSettings.elevenLabs.voiceId = settings.elevenlabsVoiceId;
        }
        
        if (settings.elevenlabsStability !== undefined) {
            if (!company.aiSettings.elevenLabs) {
                company.aiSettings.elevenLabs = {};
            }
            company.aiSettings.elevenLabs.stability = settings.elevenlabsStability;
        }
        
        if (settings.elevenlabsClarity !== undefined) {
            if (!company.aiSettings.elevenLabs) {
                company.aiSettings.elevenLabs = {};
            }
            company.aiSettings.elevenLabs.similarityBoost = settings.elevenlabsClarity;
        }
        
        await company.save();
        
        // Clear cache to ensure Twilio gets fresh data
        const cacheKey = `company:${companyId}`;
        await redisClient.del(cacheKey);
        console.log(`[Voice Settings] Cleared cache for key: ${cacheKey}`);
        
        // ALSO clear phone-based cache used by Twilio
        if (company.twilioConfig?.phoneNumber) {
          const phoneCacheKey = `company-phone:${company.twilioConfig.phoneNumber}`;
          await redisClient.del(phoneCacheKey);
          console.log(`[Voice Settings] Cleared phone cache for key: ${phoneCacheKey}`);
        }
        
        console.log(`[API PATCH /api/company/${companyId}/voice-settings] Voice settings updated successfully`);
        res.json({ message: 'Voice settings updated successfully', aiSettings: company.aiSettings });
        
    } catch (error) {
        console.error(`[API PATCH /api/company/${companyId}/voice-settings] Error:`, error.message, error.stack);
        res.status(500).json({ message: `Error updating voice settings: ${error.message}` });
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

// --- Booking Flow Configuration Routes ---

// Get booking flow configuration for a company
router.get('/companies/:companyId/booking-flow', apiLimiter, async (req, res) => {
    try {
        const { companyId } = req.params;
        
        if (!ObjectId.isValid(companyId)) {
            return res.status(400).json({ error: 'Invalid company ID' });
        }
        
        const company = await Company.findById(companyId).select('bookingFlow');
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Return booking flow or default configuration
        const defaultBookingFlow = [
            { prompt: "What type of service are you looking for today?", name: "serviceType" },
            { prompt: "Great! What is the full service address?", name: "address" },
            { prompt: "And what's the best phone number to reach you?", name: "phoneNumber" },
            { prompt: "What email should we use for booking confirmations?", name: "email" }
        ];
        
        console.log(`[API] Loaded booking flow for company ${companyId}:`, company.bookingFlow || 'using defaults');
        res.json(company.bookingFlow || defaultBookingFlow);
    } catch (error) {
        console.error('[API Error] Error fetching booking flow:', error);
        res.status(500).json({ error: 'Failed to fetch booking flow configuration' });
    }
});

// Save booking flow configuration for a company
router.post('/companies/:companyId/booking-flow', apiLimiter, async (req, res) => {
    try {
        const { companyId } = req.params;
        const bookingFlowFields = req.body;
        
        if (!ObjectId.isValid(companyId)) {
            return res.status(400).json({ error: 'Invalid company ID' });
        }
        
        // Enhanced validation for booking flow fields
        if (!Array.isArray(bookingFlowFields)) {
            return res.status(400).json({ error: 'Booking flow must be an array' });
        }
        
        if (bookingFlowFields.length > 20) {
            return res.status(400).json({ error: 'Maximum 20 booking flow fields allowed' });
        }
        
        for (const field of bookingFlowFields) {
            // Required field validation
            if (!field.prompt || !field.name || typeof field.prompt !== 'string' || typeof field.name !== 'string') {
                return res.status(400).json({ error: 'Each booking flow field must have a prompt and name' });
            }
            
            // Length validation
            if (field.prompt.length > 500) {
                return res.status(400).json({ error: 'Prompt must be less than 500 characters' });
            }
            
            if (field.name.length > 100) {
                return res.status(400).json({ error: 'Field name must be less than 100 characters' });
            }
            
            // Sanitize field names (alphanumeric and underscores only)
            if (!/^[a-zA-Z0-9_]+$/.test(field.name)) {
                return res.status(400).json({ error: 'Field names can only contain letters, numbers, and underscores' });
            }
            
            // Validate field type if provided
            if (field.type && !['text', 'phone', 'email', 'date', 'notes'].includes(field.type)) {
                return res.status(400).json({ error: 'Invalid field type' });
            }
        }
        
        // Use Mongoose model for consistency
        const result = await Company.findByIdAndUpdate(
            companyId,
            { 
                bookingFlow: bookingFlowFields,
                bookingFlowUpdatedAt: new Date()
            },
            { new: true, runValidators: true }
        );
        
        if (!result) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        console.log(`[API] Updated booking flow for company ${companyId} with ${bookingFlowFields.length} fields`);
        res.json({ 
            success: true, 
            message: 'Booking flow configuration saved successfully',
            fieldCount: bookingFlowFields.length,
            bookingFlow: result.bookingFlow
        });
    } catch (error) {
        console.error('[API Error] Error saving booking flow:', error);
        res.status(500).json({ error: 'Failed to save booking flow configuration' });
    }
});

// Get company's trade categories
router.get('/companies/:companyId/trade-categories', apiLimiter, async (req, res) => {
    try {
        const { companyId } = req.params;
        
        if (!ObjectId.isValid(companyId)) {
            return res.status(400).json({ error: 'Invalid company ID' });
        }
        
        const company = await Company.findById(companyId).select('tradeTypes');
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        console.log(`[API] Loaded trade categories for company ${companyId}:`, company.tradeTypes);
        res.json({ tradeCategories: company.tradeTypes || [] });
    } catch (error) {
        console.error('[API Error] Error fetching company trade categories:', error);
        res.status(500).json({ error: 'Failed to fetch company trade categories' });
    }
});

// Save company's trade categories
router.post('/companies/:companyId/trade-categories', apiLimiter, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { tradeCategories } = req.body;
        
        if (!ObjectId.isValid(companyId)) {
            return res.status(400).json({ error: 'Invalid company ID' });
        }
        
        // Validate trade categories
        if (!Array.isArray(tradeCategories)) {
            return res.status(400).json({ error: 'Trade categories must be an array' });
        }
        
        // Limit number of categories to prevent abuse
        if (tradeCategories.length > 10) {
            return res.status(400).json({ error: 'Maximum 10 trade categories allowed per company' });
        }
        
        // Validate each category name
        for (const category of tradeCategories) {
            if (typeof category !== 'string' || category.trim().length === 0) {
                return res.status(400).json({ error: 'All trade categories must be valid non-empty strings' });
            }
            if (category.length > 100) {
                return res.status(400).json({ error: 'Trade category names must be less than 100 characters' });
            }
        }
        
        // Clean and deduplicate categories
        const cleanedCategories = [...new Set(tradeCategories.map(cat => cat.trim()))];
        
        // Use Mongoose model for consistency
        const result = await Company.findByIdAndUpdate(
            companyId,
            { 
                tradeTypes: cleanedCategories,
                updatedAt: new Date()
            },
            { new: true, runValidators: true }
        );
        
        if (!result) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Clear Redis cache if it exists
        try {
            const cacheKey = `company:${companyId}`;
            await redisClient.del(cacheKey);
            console.log(`[Trade Categories] Cleared cache: ${cacheKey}`);
        } catch (redisError) {
            console.warn('[Trade Categories] Redis cache clear failed:', redisError.message);
        }
        
        console.log(`[API] Updated trade categories for company ${companyId}:`, cleanedCategories);
        res.json({ 
            success: true, 
            message: 'Trade categories updated successfully',
            tradeCategories: cleanedCategories,
            count: cleanedCategories.length
        });
    } catch (error) {
        console.error('[API Error] Error saving company trade categories:', error);
        res.status(500).json({ error: 'Failed to save company trade categories' });
    }
});

// Enhanced ElevenLabs Voice Settings endpoint
router.post('/:companyId/voice-settings', async (req, res) => {
    try {
        const companyId = req.params.companyId;
        const {
            apiKey,
            voiceId,
            stability,
            similarity_boost,
            style,
            use_speaker_boost,
            model_id,
            output_format,
            optimize_streaming_latency
        } = req.body;

        // Validate required fields
        if (!voiceId) {
            return res.status(400).json({
                success: false,
                message: 'Voice ID is required'
            });
        }

        // Find and update company
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        // Initialize aiSettings if not exists
        if (!company.aiSettings) {
            company.aiSettings = {};
        }

        // Initialize elevenLabs settings if not exists
        if (!company.aiSettings.elevenLabs) {
            company.aiSettings.elevenLabs = {};
        }

        // Update ElevenLabs settings
        company.aiSettings.elevenLabs = {
            apiKey: apiKey || company.aiSettings.elevenLabs.apiKey,
            voiceId: voiceId,
            stability: parseFloat(stability) || 0.5,
            similarity_boost: parseFloat(similarity_boost) || 0.7,
            style: parseFloat(style) || 0.0,
            use_speaker_boost: use_speaker_boost !== false, // Default to true
            model_id: model_id || 'eleven_turbo_v2_5',
            output_format: output_format || 'mp3_44100_128',
            optimize_streaming_latency: parseInt(optimize_streaming_latency) || 0,
            updated: new Date()
        };

        // Save company
        await company.save();

        console.log(`✅ ElevenLabs voice settings saved for company ${companyId}`);

        res.json({
            success: true,
            message: 'Voice settings saved successfully',
            settings: company.aiSettings.elevenLabs
        });

    } catch (error) {
        console.error('❌ Error saving voice settings:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to save voice settings',
            error: error.message
        });
    }
});

// Get company voice settings
router.get('/:companyId/voice-settings', async (req, res) => {
    try {
        const companyId = req.params.companyId;
        
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        const voiceSettings = company.aiSettings?.elevenLabs || {
            stability: 0.5,
            similarity_boost: 0.7,
            style: 0.0,
            use_speaker_boost: true,
            model_id: 'eleven_turbo_v2_5',
            output_format: 'mp3_44100_128',
            optimize_streaming_latency: 0
        };

        res.json({
            success: true,
            settings: voiceSettings
        });

    } catch (error) {
        console.error('❌ Error getting voice settings:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get voice settings',
            error: error.message
        });
    }
});

// --- AI Settings Endpoint ---
router.post('/companies/:companyId/ai-settings', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { language, ...otherSettings } = req.body;

        console.log(`[API POST /api/companies/${companyId}/ai-settings] Updating AI settings:`, { language, ...otherSettings });

        if (!ObjectId.isValid(companyId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid company ID'
            });
        }

        // Validate language code
        const supportedLanguages = [
            'en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'zh', 'ja', 'ko', 
            'ar', 'hi', 'nl', 'sv', 'da', 'no', 'fi', 'pl', 'tr', 'cs'
        ];

        if (language && !supportedLanguages.includes(language)) {
            return res.status(400).json({
                success: false,
                message: 'Unsupported language code'
            });
        }

        // Build update object
        const updateData = {};
        if (language) updateData['aiSettings.language'] = language;
        
        // Add other AI settings
        Object.keys(otherSettings).forEach(key => {
            updateData[`aiSettings.${key}`] = otherSettings[key];
        });

        const result = await Company.findByIdAndUpdate(
            companyId,
            { $set: updateData },
            { new: true, runValidators: true }
        );

        if (!result) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        console.log(`✅ AI settings updated for company ${companyId}:`, updateData);

        res.json({
            success: true,
            message: 'AI settings updated successfully',
            aiSettings: result.aiSettings
        });

    } catch (error) {
        console.error('❌ Error updating AI settings:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update AI settings',
            error: error.message
        });
    }
});

// =============================================
// AGENT PRIORITY CONFIGURATION ENDPOINTS
// =============================================

// GET Agent Priority Configuration
router.get('/companies/:companyId/agent-priority-config', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        console.log(`[Agent Priority] 📥 Loading priority config for company: ${companyId}`);
        
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }
        
        // Return saved priority configuration or defaults
        const priorityConfig = company.agentPriorityConfig || {
            enabled: true,
            processingFlow: [
                {
                    id: 'company-knowledge',
                    name: 'Company Knowledge Base',
                    type: 'knowledge',
                    enabled: true,
                    priority: 1,
                    description: 'Search company-specific Q&A and knowledge entries'
                },
                {
                    id: 'trade-categories',
                    name: 'Trade Category Knowledge',
                    type: 'knowledge',
                    enabled: true,
                    priority: 2,
                    description: 'Search trade-specific knowledge base'
                },
                {
                    id: 'llm-fallback',
                    name: 'AI Assistant (LLM)',
                    type: 'llm',
                    enabled: true,
                    priority: 3,
                    description: 'Last resort: Generate response using AI'
                }
            ]
        };
        
        console.log(`[Agent Priority] ✅ Priority config loaded successfully`);
        
        res.json({
            success: true,
            data: priorityConfig
        });
        
    } catch (error) {
        console.error('[Agent Priority] ❌ Error loading priority config:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to load agent priority configuration',
            error: error.message
        });
    }
});

// POST Agent Priority Configuration
router.post('/companies/:companyId/agent-priority-config', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { processingFlow, enabled } = req.body;
        
        console.log(`[Agent Priority] 💾 Saving priority config for company: ${companyId}`);
        
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }
        
        // Update the agent priority configuration
        const updatedCompany = await Company.findByIdAndUpdate(
            companyId,
            {
                $set: {
                    agentPriorityConfig: {
                        enabled: enabled !== undefined ? enabled : true,
                        processingFlow: processingFlow || [],
                        lastUpdated: new Date()
                    }
                }
            },
            { new: true }
        );
        
        console.log(`[Agent Priority] ✅ Priority config saved successfully`);
        
        res.json({
            success: true,
            message: 'Agent priority configuration updated successfully',
            data: updatedCompany.agentPriorityConfig
        });
        
    } catch (error) {
        console.error('[Agent Priority] ❌ Error saving priority config:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to save agent priority configuration',
            error: error.message
        });
    }
});

// Include personality routes
const personalityRoutes = require('./company/personality');
router.use('/', personalityRoutes);

// Include knowledge routes
const knowledgeRoutes = require('./company/knowledge');
router.use('/', knowledgeRoutes);

// Include agent settings routes
const agentSettingsRoutes = require('./company/agentSettings');
router.use('/', agentSettingsRoutes);

module.exports = router;
