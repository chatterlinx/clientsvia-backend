const express = require('express');
const router = express.Router();
const path = require('path');
const { getDB } = require('../db');
const { ObjectId } = require('mongodb');
const Company = require('../models/v2Company'); // V2 Company model import
// V2 DELETED: Google Calendar integration eliminated
// const { google } = require('googleapis'); // For Google Calendar
const { normalizePhoneNumber } = require('../utils/phone');
const { redisClient } = require('../clients');
const { apiLimiter } = require('../middleware/rateLimit'); // Rate limiting
const { authenticateJWT, requireRole } = require('../middleware/auth'); // Authentication
// Legacy personality system removed - using modern AI Agent Logic responseCategories

// V2 DELETED: Google OAuth2 Client Setup - Calendar integration eliminated
// const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
// const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
// const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
// 
// if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
//     console.warn("🔴 Google OAuth credentials are not fully configured in .env. Google Calendar integration will likely fail.");
// }
// 
// const oauth2Client = new google.auth.OAuth2(
//     GOOGLE_CLIENT_ID,
//     GOOGLE_CLIENT_SECRET,
//     GOOGLE_REDIRECT_URI
// );

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

/* ============================================================================
   🏢 CREATE NEW COMPANY - V2 MODERN SYSTEM
   ============================================================================
   
   ENDPOINT: POST /api/companies
   AUTH: No authentication required (open endpoint for company creation)
   
   PURPOSE:
   Quick company creation with minimal required fields. Supports three form types:
   1. Modern Form (V2): Name + International Address Object
   2. Legacy Simplified: Name + Phone + Single Address String
   3. Legacy Full: Complete company details with owner/contact info
   
   FEATURES:
   ✅ Modern quick-start form (2 fields: name + address object)
   ✅ International address format (street, city, state, zip, country)
   ✅ Backward compatible with legacy forms
   ✅ Auto-generates default AI agent settings
   ✅ Phone number optional (added later in profile)
   ✅ Smart form detection based on payload structure
   
   MODERN FORM PAYLOAD:
   {
       companyName: string (required),
       address: {
           street: string (required),
           city: string (required),
           state: string (required),
           zip: string (required),
           country: string (required)
       },
       timezone: string (optional, default: "America/New_York"),
       profileComplete: boolean (optional, default: false)
   }
   
   WORKFLOW:
   1. Detect form type (Modern vs Legacy Simplified vs Legacy Full)
   2. Validate required fields based on form type
   3. Create company document with defaults
   4. Auto-generate account status (active)
   5. Return saved company with _id for profile completion
   
   ============================================================================ */
router.post('/companies', async (req, res) => {
    console.log('[API POST /api/companies] 📥 Received data:', JSON.stringify(req.body, null, 2));
    try {
        const {
            companyName,
            companyPhone,
            companyAddress, // Legacy single-field address
            address,        // Modern international address object
            timezone,
            // Legacy fields (optional for backward compatibility)
            ownerName,
            ownerEmail,
            ownerPhone,
            contactName,
            contactEmail,
            contactPhone
        } = req.body;

        // 🎯 Determine form type: Modern (address object) vs Legacy (companyAddress string)
        const isModernForm = address && address.street && address.city;
        const isLegacySimplified = companyPhone && companyAddress && !ownerName && !ownerEmail;
        
        let newCompanyData;
        
        if (isModernForm) {
            // ✨ MODERN FORM - International address format
            console.log('[API POST /api/companies] 🌍 Modern form detected - International address');
            
            if (!companyName || !address || !address.street || !address.city || !address.state || !address.zip || !address.country) {
                console.warn('[API POST /api/companies] ❌ Modern form validation failed. Missing required fields:', {
                    companyName: !!companyName,
                    address: !!address,
                    'address.street': address?.street,
                    'address.city': address?.city,
                    'address.state': address?.state,
                    'address.zip': address?.zip,
                    'address.country': address?.country
                });
                return res.status(400).json({ 
                    message: 'Missing required fields: Company Name and complete Address are required.' 
                });
            }

            newCompanyData = {
                companyName,
                companyPhone: companyPhone || null, // Optional - can be added later
                address: {
                    street: address.street,
                    city: address.city,
                    state: address.state,
                    zip: address.zip,
                    country: address.country
                },
                // Set defaults for fields to be completed later
                tradeTypes: [],
                tradeCategories: [],
                ownerName: null,
                ownerEmail: null,
                ownerPhone: null,
                contactName: null,
                contactEmail: null,
                contactPhone: null,
                timezone: timezone || 'America/New_York',
                status: 'active',
                profileComplete: false, // Flag to track if additional details have been added
                // Default account status
                accountStatus: {
                    status: 'active',
                    lastChanged: new Date()
                }
            };

            console.log('[API POST /api/companies] ✅ Creating modern company with international address');
            
        } else if (isLegacySimplified) {
            // 📦 LEGACY SIMPLIFIED FORM - Single address field
            console.log('[API POST /api/companies] 📦 Legacy simplified form detected');
            
            if (!companyName || !companyPhone || !companyAddress) {
                console.warn('[API POST /api/companies] ❌ Simplified form validation failed. Missing required fields:', {
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
                tradeCategories: [],
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
                profileComplete: false,
                accountStatus: {
                    status: 'active',
                    lastChanged: new Date()
                }
            };

            console.log('[API POST /api/companies] ✅ Creating legacy simplified company');
            
        } else {
            // 🗂️ FULL LEGACY FORM - All fields provided
            console.log('[API POST /api/companies] 🗂️ Full legacy form detected');
            
            if (!companyName || !ownerName || !ownerEmail || !contactPhone || !timezone ||
                !address || !address.street || !address.city || !address.state || !address.zip || !address.country) {
                console.warn('[API POST /api/companies] ❌ Legacy form validation failed. Missing or invalid required fields. Data received:', req.body);
                return res.status(400).json({ message: 'Missing required fields or timezone is missing.' });
            }

            newCompanyData = {
                companyName,
                tradeTypes: [],
                tradeCategories: [],
                ownerName,
                ownerEmail,
                ownerPhone: ownerPhone || null,
                contactName: contactName || null,
                contactEmail: contactEmail || null,
                contactPhone,
                address,
                timezone: timezone || 'America/New_York',
                profileComplete: true,
                accountStatus: {
                    status: 'active',
                    lastChanged: new Date()
                }
            };
            
            console.log('[API POST /api/companies] ✅ Creating full legacy company');
        }

        // Use Mongoose model to create the company with all default values
        const newCompany = new Company(newCompanyData);
        const savedCompany = await newCompany.save();
        
        console.log('[API POST /api/companies] 🎉 Company added successfully:', savedCompany.companyName, 'ID:', savedCompany._id);
        res.status(201).json(savedCompany);
    } catch (error) {
        console.error('[API POST /api/companies] ❌ Error:', error.message, error.stack);
        res.status(500).json({ message: `Error adding company: ${error.message}` });
    }
});

// AUTHENTICATED ENDPOINT: Get all companies (requires authentication)
// Accessible to all authenticated users (admins, users, etc.)
// Security: Requires valid JWT but not admin role (changed Oct 16, 2025)
router.get('/companies', authenticateJWT, async (req, res) => {
    try {
        console.log('[API GET /api/companies] Authenticated user requesting all companies:', req.user.email);
        
        // 📊 PRODUCTION-GRADE: Fetch companies with optimized field projection
        // 🔒 CRITICAL: Exclude deleted companies from directory (only Data Center shows deleted)
        // Uses lean() for performance (returns plain JavaScript objects)
        const companies = await Company.find({ isDeleted: { $ne: true } }, {
            // Core company information
            companyName: 1,
            tradeCategories: 1,
            isActive: 1,
            isDeleted: 1,  // Include for client-side filtering (should always be false)
            
            // Account status (Configuration tab integration)
            // NOTE: Nested fields require explicit projection in Mongoose
            'accountStatus.status': 1,              // active | call_forward | suspended
            'accountStatus.callForwardNumber': 1,   // Phone number for call forwarding
            'accountStatus.reason': 1,              // Internal notes for status change
            
            // Contact & business details
            businessPhone: 1,
            businessEmail: 1,
            businessWebsite: 1,
            
            // International address structure
            'address.street': 1,
            'address.city': 1,
            'address.state': 1,
            'address.zip': 1,
            'address.country': 1,
            
            // Metadata
            createdAt: 1,
            updatedAt: 1,
            
            // Legacy status field (kept for backward compatibility)
            status: 1
            
            // 🔒 SECURITY: Sensitive fields excluded (API keys, tokens, passwords, etc.)
        }).lean();
        
        console.log(`[API GET /api/companies] Found ${companies.length} companies in database`);
        console.log(`[API GET /api/companies] Returning ${companies.length} companies to user: ${req.user.email}`);
        
        res.json({
            success: true,
            data: companies,
            count: companies.length,
            message: 'Company directory loaded successfully'
        });
        
    } catch (err) {
        console.error('[API GET /api/companies] Error:', err);
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
    console.log(`🔍 [CACHE] Checking cache for: ${cacheKey}`);
    try {
        const cachedData = await redisClient.get(cacheKey);
        if (cachedData) {
            console.log(`✅ [CACHE] CACHE HIT for ${cacheKey} - returning cached data`);
            const data = JSON.parse(cachedData);
            console.log(`📋 [CACHE] Cached data companyName: ${data.companyName}, businessPhone: ${data.businessPhone}`);
            return res.status(200).json(data);
        } else {
            console.log(`❌ [CACHE] CACHE MISS for ${cacheKey} - loading from DB`);
            next();
        }
    } catch (error) {
        console.error('❌ [CACHE] Redis error:', error);
        next();
    }
}

router.get('/company/:id', checkCompanyCache, async (req, res) => {
    const companyId = req.params.id;
    if (!ObjectId.isValid(companyId)) {
        return res.status(400).json({ message: 'Invalid company ID format' });
    }
    try {
        console.log(`📊 [DB] Loading company from database: ${companyId}`);
        // Explicitly include aiAgentLogic field in the query
        const company = await Company.findById(companyId).lean();
        if (!company) return res.status(404).json({ message: 'Company not found' });

        console.log(`✅ [DB] Company loaded: ${company.companyName}, businessPhone: ${company.businessPhone}`);
        console.log(`📝 [DB] Notes in company document:`, company.notes?.length || 0, 'notes');

        const cacheKey = `company:${companyId}`;
        await redisClient.setEx(cacheKey, 3600, JSON.stringify(company));
        console.log(`✅ [CACHE] SAVED to cache: ${cacheKey} (TTL: 3600s)`);
        
        // Debug: Log if aiAgentLogic exists
        console.log(`🔍 DEBUG: aiAgentLogic exists in response: ${!!company.aiAgentLogic}`);
        if (company.aiAgentLogic) {
            console.log(`🔍 DEBUG: aiAgentLogic thresholds:`, company.aiAgentLogic.thresholds);
        }

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
        
        // 🗑️ COMPLETE CLEANUP: Clear ALL Redis cache keys for this company
        try {
            const cacheKeys = [
                `company:${companyId}`,
                `companyQnA:${companyId}`,
                `tradeQnA:${companyId}`
            ];
            
            // Add phone-based cache keys (Twilio uses these)
            if (company.twilioConfig?.phoneNumber) {
                cacheKeys.push(`company-phone:${company.twilioConfig.phoneNumber}`);
            }
            if (company.twilioConfig?.phoneNumbers && Array.isArray(company.twilioConfig.phoneNumbers)) {
                company.twilioConfig.phoneNumbers.forEach(phone => {
                    if (phone.phoneNumber) {
                        cacheKeys.push(`company-phone:${phone.phoneNumber}`);
                    }
                });
            }
            
            // Clear all cache keys
            for (const key of cacheKeys) {
                if (key && !key.includes('undefined')) {
                    await redisClient.del(key);
                    console.log(`[API DELETE /api/company/:id] 🗑️ Cleared cache: ${key}`);
                }
            }
            
            console.log(`[API DELETE /api/company/:id] ✅ Cleared ${cacheKeys.length} cache keys`);
        } catch (cacheError) {
            console.warn(`[API DELETE /api/company/:id] ⚠️ Failed to clear cache:`, cacheError.message);
            // Don't fail the request if cache clearing fails
        }
        
        // 🗑️ Delete related documents from other collections
        try {
            // Delete Company Q&A categories and entries
            const CompanyQnACategory = require('../models/CompanyQnACategory');
            const deletedQnA = await CompanyQnACategory.deleteMany({ companyId: companyId });
            console.log(`[API DELETE /api/company/:id] 🗑️ Deleted ${deletedQnA.deletedCount} Q&A categories`);
            
            // Delete Instant Response categories
            const InstantResponseCategory = require('../models/InstantResponseCategory');
            const deletedIR = await InstantResponseCategory.deleteMany({ companyId: companyId });
            console.log(`[API DELETE /api/company/:id] 🗑️ Deleted ${deletedIR.deletedCount} Instant Response categories`);
            
            // Delete call logs (if you have a call log model)
            // const CallLog = require('../models/v2AIAgentCallLog');
            // const deletedLogs = await CallLog.deleteMany({ companyId: companyId });
            // console.log(`[API DELETE /api/company/:id] 🗑️ Deleted ${deletedLogs.deletedCount} call logs`);
            
            console.log(`[API DELETE /api/company/:id] ✅ Deleted all related documents`);
        } catch (relatedDataError) {
            console.warn(`[API DELETE /api/company/:id] ⚠️ Failed to delete related data:`, relatedDataError.message);
            // Don't fail the request if related data deletion fails
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
                if (key === 'tradeTypes' || key === 'tradeCategories') {
                    if (Array.isArray(updates[key])) {
                        // 🎯 V2: Save to both legacy and new fields for compatibility
                        updateOperation['tradeTypes'] = updates[key];      // Legacy field
                        updateOperation['tradeCategories'] = updates[key]; // V2 field
                        console.log(`💾 [TRADE CATEGORIES] Saving to both fields:`, updates[key]);
                    } else if (updates[key]) {
                        updateOperation['tradeTypes'] = [updates[key]];
                        updateOperation['tradeCategories'] = [updates[key]];
                    } else {
                        updateOperation['tradeTypes'] = [];
                        updateOperation['tradeCategories'] = [];
                    }
                } else if (key === 'isActive' && typeof updates[key] !== 'boolean') {
                    updateOperation[key] = updates[key] === 'true' || updates[key] === true;
                } else if (key === 'additionalContacts' && Array.isArray(updates[key])) {
                    updateOperation[key] = updates[key];
                } else if (key === 'contacts' && Array.isArray(updates[key])) {
                    updateOperation[key] = updates[key];
                } else if (key === 'notes' && Array.isArray(updates[key])) {
                    // GOLD STANDARD: Handle notes array properly
                    console.log('📝 [NOTES DEBUG] Processing notes array for save:', updates[key].length, 'notes');
                    console.log('📝 [NOTES DEBUG] First note:', updates[key][0]);
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

        // 🚀 V2 OPTIMIZATION: Clear both company and AI config caches
        const cacheKey = `company:${companyId}`;
        const deletedCount = await redisClient.del(cacheKey);
        console.log(`✅ [CACHE] DELETED from cache: ${cacheKey}, keys deleted: ${deletedCount}`);
        
        // Clear AI Agent Logic cache when aiAgentLogic is updated (includes keywords)
        if (req.body.aiAgentLogic) {
            const aiLoader = require('../src/config/aiLoader');
            await aiLoader.invalidate(companyId);
            console.log(`⚡ AI Agent Logic cache invalidated for company: ${companyId}`);
        }

        res.json(updatedCompany);
    } catch (error) {
        console.error(`[API PATCH /api/company/:id] (Overview) Error updating company ${companyId}:`, error.message, error.stack);
        res.status(500).json({ message: `Error updating company: ${error.message}` });
    }
});

// 🚨 Account Status Management - Critical for billing/service control
router.patch('/company/:companyId/account-status', async (req, res) => {
    const { companyId } = req.params;
    const { status, callForwardNumber, callForwardMessage, suspendedMessage, reason, notes } = req.body;
    
    console.log(`[API PATCH /company/${companyId}/account-status] Status change request:`, { status, callForwardNumber, callForwardMessage, reason });
    
    if (!ObjectId.isValid(companyId)) {
        return res.status(400).json({ success: false, message: 'Invalid company ID format' });
    }
    
    // Validate status
    const validStatuses = ['active', 'call_forward', 'suspended'];
    if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({ 
            success: false, 
            message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` 
        });
    }
    
    // Validate call forward number if status is call_forward
    if (status === 'call_forward' && !callForwardNumber) {
        return res.status(400).json({ 
            success: false, 
            message: 'Call forward number is required when status is "call_forward"' 
        });
    }
    
    try {
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }
        
        // Get admin user info (defaulting to 'Admin' since this is accessed from company profile)
        const changedBy = req.body.changedBy || 'Admin';
        
        // Initialize accountStatus if it doesn't exist
        if (!company.accountStatus) {
            company.accountStatus = {
                status: 'active',
                callForwardNumber: null,
                reason: null,
                changedBy: null,
                changedAt: null,
                history: [],
                notes: null
            };
        }
        
        // Create history entry BEFORE updating current status
        const historyEntry = {
            status: status,
            callForwardNumber: status === 'call_forward' ? callForwardNumber : null,
            callForwardMessage: status === 'call_forward' ? callForwardMessage : null,
            suspendedMessage: status === 'suspended' ? suspendedMessage : null,
            reason: reason || null,
            changedBy: changedBy,
            changedAt: new Date()
        };
        
        // Update account status
        company.accountStatus.status = status;
        company.accountStatus.callForwardNumber = status === 'call_forward' ? callForwardNumber : null;
        company.accountStatus.callForwardMessage = status === 'call_forward' ? callForwardMessage : null;
        company.accountStatus.suspendedMessage = status === 'suspended' ? suspendedMessage : null;
        company.accountStatus.reason = reason || null;
        company.accountStatus.changedBy = changedBy;
        company.accountStatus.changedAt = new Date();
        if (notes) {
            company.accountStatus.notes = notes;
        }
        
        // Add to history
        if (!company.accountStatus.history) {
            company.accountStatus.history = [];
        }
        company.accountStatus.history.push(historyEntry);
        
        // Save company
        await company.save();
        
        // Clear ALL cache keys for this company to ensure fresh data
        const cacheKeys = [
            `company:${companyId}`,
            `companyQnA:${companyId}`,
            `tradeQnA:${companyId}`
        ];
        
        // Add phone-based cache keys (Twilio uses these)
        if (company.twilioConfig?.phoneNumber) {
            cacheKeys.push(`company-phone:${company.twilioConfig.phoneNumber}`);
        }
        if (company.twilioConfig?.phoneNumbers && Array.isArray(company.twilioConfig.phoneNumbers)) {
            company.twilioConfig.phoneNumbers.forEach(phone => {
                if (phone.phoneNumber) {
                    cacheKeys.push(`company-phone:${phone.phoneNumber}`);
                }
            });
        }
        
        for (const key of cacheKeys) {
            if (key && !key.includes('undefined')) {
                await redisClient.del(key);
                console.log(`🗑️ Cleared cache key: ${key}`);
            }
        }
        
        console.log(`🚨 Account status changed for company ${company.companyName} (${companyId}): ${status}`);
        console.log(`   Changed by: ${changedBy} at ${historyEntry.changedAt}`);
        console.log(`   Reason: ${reason || 'Not specified'}`);
        if (status === 'call_forward') {
            console.log(`   Forward to: ${callForwardNumber}`);
            console.log(`   Forward message: "${callForwardMessage || '(none - silent forward)'}"`);
        }
        console.log(`   📝 Saved accountStatus object:`, JSON.stringify(company.accountStatus, null, 2));
        
        res.json({ 
            success: true, 
            message: `Account status updated to "${status}"`,
            accountStatus: company.accountStatus
        });
        
    } catch (error) {
        console.error(`[API PATCH /company/${companyId}/account-status] Error:`, error.message, error.stack);
        res.status(500).json({ 
            success: false, 
            message: `Error updating account status: ${error.message}` 
        });
    }
});

// 🗑️ Delete Account Status History Entry
router.delete('/company/:companyId/account-status/history/:index', authenticateJWT, async (req, res) => {
    const { companyId, index } = req.params;
    const historyIndex = parseInt(index, 10);
    
    console.log(`[API DELETE /company/${companyId}/account-status/history/${index}] Delete request`);
    
    if (!ObjectId.isValid(companyId)) {
        return res.status(400).json({ success: false, message: 'Invalid company ID format' });
    }
    
    if (isNaN(historyIndex) || historyIndex < 0) {
        return res.status(400).json({ success: false, message: 'Invalid history index' });
    }
    
    try {
        const company = await Company.findById(companyId);
        
        if (!company) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }
        
        if (!company.accountStatus || !company.accountStatus.history || company.accountStatus.history.length === 0) {
            return res.status(404).json({ success: false, message: 'No status history found' });
        }
        
        // Sort history by date descending (most recent first) to match frontend display
        const sortedHistory = [...company.accountStatus.history].sort((a, b) => 
            new Date(b.changedAt) - new Date(a.changedAt)
        );
        
        if (historyIndex >= sortedHistory.length) {
            return res.status(404).json({ success: false, message: 'History entry not found' });
        }
        
        // Get the entry to delete
        const entryToDelete = sortedHistory[historyIndex];
        
        // Remove the entry from the original array by matching the changedAt timestamp
        company.accountStatus.history = company.accountStatus.history.filter(
            entry => entry.changedAt.getTime() !== entryToDelete.changedAt.getTime()
        );
        
        await company.save();
        
        // Clear Redis cache
        const cacheKeys = [
            `company:${companyId}`,
            ...(company.twilioConfig?.phoneNumbers || []).map(phone => `company-phone:${phone}`)
        ];
        
        for (const key of cacheKeys) {
            await redisClient.del(key);
            console.log(`🗑️ Cleared cache: ${key}`);
        }
        
        console.log(`✅ Deleted status history entry at index ${historyIndex} for company ${companyId}`);
        
        res.json({ 
            success: true, 
            message: 'Status history entry deleted successfully',
            remainingEntries: company.accountStatus.history.length
        });
    } catch (error) {
        console.error(`[API DELETE /company/${companyId}/account-status/history/${index}] Error:`, error.message, error.stack);
        res.status(500).json({ 
            success: false, 
            message: `Error deleting history entry: ${error.message}` 
        });
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
        // V2 DELETED: Google voice provider - using ElevenLabs only
        // if (aiSettings.googleVoice !== undefined) updatePayload['aiSettings.googleVoice'] = aiSettings.googleVoice;
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

        // V2 DELETED: Google Calendar integration - calendar tab eliminated
        // if (typeof aiSettings.enableGoogleCalendarIntegration === 'boolean') {
        //     updatePayload['aiSettings.enableGoogleCalendarIntegration'] = aiSettings.enableGoogleCalendarIntegration;
        // } else if (currentAISettings.enableGoogleCalendarIntegration === undefined) {
        //     // If not in payload and not in DB, default to false
        //     updatePayload['aiSettings.enableGoogleCalendarIntegration'] = false;
        // }
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

/**
 * 💾 Company Profile Update Endpoint
 * PATCH /api/company/:companyId/profile
 */
router.patch('/company/:companyId/profile', authenticateJWT, async (req, res) => {
    const { companyId } = req.params;
    const updateData = req.body;

    console.log(`[API PATCH /api/company/${companyId}/profile] Received data:`, JSON.stringify(updateData, null, 2));

    if (!ObjectId.isValid(companyId)) {
        return res.status(400).json({ message: 'Invalid company ID format' });
    }

    try {
        // Build update object with dot notation for nested fields
        const updateFields = {};
        
        if (updateData.businessType) {
            updateFields.businessType = updateData.businessType;
        }
        
        // Handle nested aiAgentLogic fields
        Object.keys(updateData).forEach(key => {
            if (key.startsWith('aiAgentLogic.')) {
                updateFields[key] = updateData[key];
            }
        });

        // Always update lastUpdated
        updateFields['aiAgentLogic.lastUpdated'] = new Date();

        console.log(`[Profile Update] Updating fields:`, updateFields);

        const result = await Company.findByIdAndUpdate(
            companyId,
            { $set: updateFields },
            { new: true, runValidators: true }
        );

        if (!result) {
            return res.status(404).json({ message: 'Company not found' });
        }

        // Clear Redis cache
        try {
            if (redisClient && redisClient.isReady) {
                await redisClient.del(`company:${companyId}`);
                console.log(`🗑️ Cache cleared for company ${companyId} after profile update`);
            }
        } catch (cacheError) {
            console.warn('⚠️ Cache clear failed after profile update:', cacheError.message);
        }

        console.log(`✅ Company profile updated successfully for ${companyId}`);
        res.json({ 
            message: 'Company profile updated successfully', 
            data: result 
        });

    } catch (error) {
        console.error(`❌ Error updating company profile for ${companyId}:`, error);
        res.status(500).json({ 
            message: 'Failed to update company profile', 
            error: error.message 
        });
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

// REMOVED: Legacy AI Settings endpoint - replaced by AI Agent Logic system
// All AI configuration now handled through /api/company/:companyId (PATCH) with aiAgentLogic field

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

// Legacy personality routes removed - using modern AI Agent Logic system

// 🚀 V2 SYSTEM: Legacy knowledge routes DELETED - using V2 Knowledge Management system only

// V2 DELETED: Legacy agent settings routes - using V2 AI Agent Logic system
// const agentSettingsRoutes = require('./company/agentSettings');
// router.use('/', agentSettingsRoutes);

// ============================================================================
// QUICK VARIABLES - Piggybacking on existing v2company routes!
// Version: 2.0 - Enterprise Mongoose + Redis Pattern
// ============================================================================

// 🔍 DIAGNOSTIC: Check Quick Variables version
// 🗑️ DELETED: Quick Variables routes - Replaced by Placeholders in AI Agent Logic tab (routes/company/v2placeholders.js)

// ============================================================
// 🚀 V3 AI RESPONSE SYSTEM - INSTANT RESPONSES & TEMPLATES
// ============================================================
// Piggyback strategy: Add to existing deployed file to avoid 404 errors
// Data already exists in v2Company.agentBrain.instantResponses & responseTemplates

console.log('[INIT] 🚀 Loading V3 AI Response System routes (Instant Responses + Templates)...');

// ⚡ GET INSTANT RESPONSES
router.get('/company/:companyId/instant-responses', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;
    
    try {
        console.log(`[IR-GET-1] Loading instant responses for company: ${companyId}`);
        
        const company = await Company.findById(companyId)
            .select('agentBrain.instantResponses')
            .lean();
        
        if (!company) {
            console.log(`[IR-GET-2] ❌ Company not found: ${companyId}`);
            return res.status(404).json({ 
                success: false, 
                message: 'Company not found' 
            });
        }
        
        const instantResponses = company.agentBrain?.instantResponses || [];
        console.log(`[IR-GET-3] ✅ Loaded ${instantResponses.length} instant responses`);
        
        res.json({
            success: true,
            data: instantResponses,
            meta: { responseTime: Date.now() - startTime }
        });
        
    } catch (error) {
        console.error('[IR-GET-ERROR] Error loading instant responses:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to load instant responses',
            error: error.message 
        });
    }
});

// ⚡ POST NEW INSTANT RESPONSE
router.post('/company/:companyId/instant-responses', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;
    const { trigger, response, category, priority } = req.body;
    
    try {
        console.log(`[IR-POST-1] Creating instant response for company: ${companyId}`);
        console.log(`[IR-POST-2] Data:`, { trigger, category, priority });
        
        // Validation
        if (!trigger || !Array.isArray(trigger) || trigger.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Trigger keywords are required (array)' 
            });
        }
        if (!response || response.trim().length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Response is required' 
            });
        }
        
        const company = await Company.findById(companyId);
        if (!company) {
            console.log(`[IR-POST-3] ❌ Company not found: ${companyId}`);
            return res.status(404).json({ 
                success: false, 
                message: 'Company not found' 
            });
        }
        
        // Initialize agentBrain if needed
        if (!company.agentBrain) {
            company.agentBrain = { version: 1, lastUpdated: new Date() };
        }
        if (!company.agentBrain.instantResponses) {
            company.agentBrain.instantResponses = [];
        }
        
        // Create new instant response
        const newInstantResponse = {
            id: `ir_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            trigger: trigger.map(t => t.trim().toLowerCase()),
            response: response.trim(),
            category: category || 'common',
            priority: priority || 5,
            enabled: true,
            createdAt: new Date(),
            usageCount: 0
        };
        
        company.agentBrain.instantResponses.push(newInstantResponse);
        company.agentBrain.lastUpdated = new Date();
        
        await company.save();
        
        // Clear cache
        try {
            await redisClient.del(`company:${companyId}`);
            console.log(`[IR-POST-4] ✅ Cache cleared for company: ${companyId}`);
        } catch (cacheError) {
            console.warn(`[IR-POST-5] ⚠️  Cache clear failed:`, cacheError.message);
        }
        
        console.log(`[IR-POST-6] ✅ Instant response created: ${newInstantResponse.id}`);
        
        res.json({
            success: true,
            message: 'Instant response created successfully',
            data: newInstantResponse,
            meta: { responseTime: Date.now() - startTime }
        });
        
    } catch (error) {
        console.error('[IR-POST-ERROR] Error creating instant response:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to create instant response',
            error: error.message 
        });
    }
});

// ⚡ PUT UPDATE INSTANT RESPONSE
router.put('/company/:companyId/instant-responses/:responseId', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId, responseId } = req.params;
    const { trigger, response, category, priority, enabled } = req.body;
    
    try {
        console.log(`[IR-PUT-1] Updating instant response: ${responseId}`);
        
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ 
                success: false, 
                message: 'Company not found' 
            });
        }
        
        const instantResponse = company.agentBrain?.instantResponses?.find(ir => ir.id === responseId);
        if (!instantResponse) {
            console.log(`[IR-PUT-2] ❌ Instant response not found: ${responseId}`);
            return res.status(404).json({ 
                success: false, 
                message: 'Instant response not found' 
            });
        }
        
        // Update fields
        if (trigger) instantResponse.trigger = trigger.map(t => t.trim().toLowerCase());
        if (response) instantResponse.response = response.trim();
        if (category) instantResponse.category = category;
        if (priority !== undefined) instantResponse.priority = priority;
        if (enabled !== undefined) instantResponse.enabled = enabled;
        instantResponse.updatedAt = new Date();
        
        company.agentBrain.lastUpdated = new Date();
        await company.save();
        
        // Clear cache
        try {
            await redisClient.del(`company:${companyId}`);
        } catch (cacheError) {
            console.warn(`[IR-PUT-3] ⚠️  Cache clear failed:`, cacheError.message);
        }
        
        console.log(`[IR-PUT-4] ✅ Instant response updated: ${responseId}`);
        
        res.json({
            success: true,
            message: 'Instant response updated successfully',
            data: instantResponse,
            meta: { responseTime: Date.now() - startTime }
        });
        
    } catch (error) {
        console.error('[IR-PUT-ERROR] Error updating instant response:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to update instant response',
            error: error.message 
        });
    }
});

// ⚡ DELETE INSTANT RESPONSE
router.delete('/company/:companyId/instant-responses/:responseId', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId, responseId } = req.params;
    
    try {
        console.log(`[IR-DELETE-1] Deleting instant response: ${responseId}`);
        
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ 
                success: false, 
                message: 'Company not found' 
            });
        }
        
        const initialLength = company.agentBrain?.instantResponses?.length || 0;
        if (!company.agentBrain?.instantResponses) {
            return res.status(404).json({ 
                success: false, 
                message: 'No instant responses found' 
            });
        }
        
        company.agentBrain.instantResponses = company.agentBrain.instantResponses.filter(
            ir => ir.id !== responseId
        );
        
        const finalLength = company.agentBrain.instantResponses.length;
        
        if (initialLength === finalLength) {
            console.log(`[IR-DELETE-2] ❌ Instant response not found: ${responseId}`);
            return res.status(404).json({ 
                success: false, 
                message: 'Instant response not found' 
            });
        }
        
        company.agentBrain.lastUpdated = new Date();
        await company.save();
        
        // Clear cache
        try {
            await redisClient.del(`company:${companyId}`);
        } catch (cacheError) {
            console.warn(`[IR-DELETE-3] ⚠️  Cache clear failed:`, cacheError.message);
        }
        
        console.log(`[IR-DELETE-4] ✅ Instant response deleted: ${responseId}`);
        
        res.json({
            success: true,
            message: 'Instant response deleted successfully',
            meta: { responseTime: Date.now() - startTime }
        });
        
    } catch (error) {
        console.error('[IR-DELETE-ERROR] Error deleting instant response:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to delete instant response',
            error: error.message 
        });
    }
});

// 📋 GET RESPONSE TEMPLATES
router.get('/company/:companyId/response-templates', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;
    
    try {
        console.log(`[RT-GET-1] Loading response templates for company: ${companyId}`);
        
        const company = await Company.findById(companyId)
            .select('agentBrain.responseTemplates')
            .lean();
        
        if (!company) {
            console.log(`[RT-GET-2] ❌ Company not found: ${companyId}`);
            return res.status(404).json({ 
                success: false, 
                message: 'Company not found' 
            });
        }
        
        const responseTemplates = company.agentBrain?.responseTemplates || [];
        console.log(`[RT-GET-3] ✅ Loaded ${responseTemplates.length} response templates`);
        
        res.json({
            success: true,
            data: responseTemplates,
            meta: { responseTime: Date.now() - startTime }
        });
        
    } catch (error) {
        console.error('[RT-GET-ERROR] Error loading response templates:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to load response templates',
            error: error.message 
        });
    }
});

// 📋 POST NEW RESPONSE TEMPLATE
router.post('/company/:companyId/response-templates', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;
    const { name, template, category, keywords, confidence } = req.body;
    
    try {
        console.log(`[RT-POST-1] Creating response template for company: ${companyId}`);
        console.log(`[RT-POST-2] Data:`, { name, category, confidence });
        
        // Validation
        if (!name || name.trim().length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Template name is required' 
            });
        }
        if (!template || template.trim().length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Template text is required' 
            });
        }
        if (!category) {
            return res.status(400).json({ 
                success: false, 
                message: 'Category is required' 
            });
        }
        
        const company = await Company.findById(companyId);
        if (!company) {
            console.log(`[RT-POST-3] ❌ Company not found: ${companyId}`);
            return res.status(404).json({ 
                success: false, 
                message: 'Company not found' 
            });
        }
        
        // Initialize agentBrain if needed
        if (!company.agentBrain) {
            company.agentBrain = { version: 1, lastUpdated: new Date() };
        }
        if (!company.agentBrain.responseTemplates) {
            company.agentBrain.responseTemplates = [];
        }
        
        // Create new response template
        const newTemplate = {
            id: `rt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: name.trim(),
            template: template.trim(),
            category,
            keywords: keywords ? keywords.map(k => k.trim().toLowerCase()) : [],
            confidence: confidence || 0.7,
            enabled: true,
            createdAt: new Date(),
            usageCount: 0,
            lastUsed: null
        };
        
        company.agentBrain.responseTemplates.push(newTemplate);
        company.agentBrain.lastUpdated = new Date();
        
        await company.save();
        
        // Clear cache
        try {
            await redisClient.del(`company:${companyId}`);
            console.log(`[RT-POST-4] ✅ Cache cleared for company: ${companyId}`);
        } catch (cacheError) {
            console.warn(`[RT-POST-5] ⚠️  Cache clear failed:`, cacheError.message);
        }
        
        console.log(`[RT-POST-6] ✅ Response template created: ${newTemplate.id}`);
        
        res.json({
            success: true,
            message: 'Response template created successfully',
            data: newTemplate,
            meta: { responseTime: Date.now() - startTime }
        });
        
    } catch (error) {
        console.error('[RT-POST-ERROR] Error creating response template:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to create response template',
            error: error.message 
        });
    }
});

// 📋 PUT UPDATE RESPONSE TEMPLATE
router.put('/company/:companyId/response-templates/:templateId', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId, templateId } = req.params;
    const { name, template, category, keywords, confidence, enabled } = req.body;
    
    try {
        console.log(`[RT-PUT-1] Updating response template: ${templateId}`);
        
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ 
                success: false, 
                message: 'Company not found' 
            });
        }
        
        const responseTemplate = company.agentBrain?.responseTemplates?.find(rt => rt.id === templateId);
        if (!responseTemplate) {
            console.log(`[RT-PUT-2] ❌ Response template not found: ${templateId}`);
            return res.status(404).json({ 
                success: false, 
                message: 'Response template not found' 
            });
        }
        
        // Update fields
        if (name) responseTemplate.name = name.trim();
        if (template) responseTemplate.template = template.trim();
        if (category) responseTemplate.category = category;
        if (keywords) responseTemplate.keywords = keywords.map(k => k.trim().toLowerCase());
        if (confidence !== undefined) responseTemplate.confidence = confidence;
        if (enabled !== undefined) responseTemplate.enabled = enabled;
        responseTemplate.updatedAt = new Date();
        
        company.agentBrain.lastUpdated = new Date();
        await company.save();
        
        // Clear cache
        try {
            await redisClient.del(`company:${companyId}`);
        } catch (cacheError) {
            console.warn(`[RT-PUT-3] ⚠️  Cache clear failed:`, cacheError.message);
        }
        
        console.log(`[RT-PUT-4] ✅ Response template updated: ${templateId}`);
        
        res.json({
            success: true,
            message: 'Response template updated successfully',
            data: responseTemplate,
            meta: { responseTime: Date.now() - startTime }
        });
        
    } catch (error) {
        console.error('[RT-PUT-ERROR] Error updating response template:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to update response template',
            error: error.message 
        });
    }
});

// 📋 DELETE RESPONSE TEMPLATE
router.delete('/company/:companyId/response-templates/:templateId', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId, templateId } = req.params;
    
    try {
        console.log(`[RT-DELETE-1] Deleting response template: ${templateId}`);
        
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ 
                success: false, 
                message: 'Company not found' 
            });
        }
        
        const initialLength = company.agentBrain?.responseTemplates?.length || 0;
        if (!company.agentBrain?.responseTemplates) {
            return res.status(404).json({ 
                success: false, 
                message: 'No response templates found' 
            });
        }
        
        company.agentBrain.responseTemplates = company.agentBrain.responseTemplates.filter(
            rt => rt.id !== templateId
        );
        
        const finalLength = company.agentBrain.responseTemplates.length;
        
        if (initialLength === finalLength) {
            console.log(`[RT-DELETE-2] ❌ Response template not found: ${templateId}`);
            return res.status(404).json({ 
                success: false, 
                message: 'Response template not found' 
            });
        }
        
        company.agentBrain.lastUpdated = new Date();
        await company.save();
        
        // Clear cache
        try {
            await redisClient.del(`company:${companyId}`);
        } catch (cacheError) {
            console.warn(`[RT-DELETE-3] ⚠️  Cache clear failed:`, cacheError.message);
        }
        
        console.log(`[RT-DELETE-4] ✅ Response template deleted: ${templateId}`);
        
        res.json({
            success: true,
            message: 'Response template deleted successfully',
            meta: { responseTime: Date.now() - startTime }
        });
        
    } catch (error) {
        console.error('[RT-DELETE-ERROR] Error deleting response template:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to delete response template',
            error: error.message 
        });
    }
});

console.log('[INIT] ✅ V3 AI Response System routes added (Instant Responses + Templates piggybacked!)');

module.exports = router;
