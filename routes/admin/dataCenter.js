/**
 * ============================================================================
 * DATA CENTER API - Admin Operations
 * ============================================================================
 * Comprehensive admin tool for:
 * - Universal search across all company data
 * - Health metrics and junk detection
 * - Safe cleanup (soft delete, purge)
 * - Customer and transcript exports
 * - Duplicate detection
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Company = require('../../models/v2Company');
const CompanyHealthService = require('../../services/CompanyHealthService');
const { authenticateJWT } = require('../../middleware/auth');
const { redisClient } = require('../../db');

// Apply authentication to all routes
router.use(authenticateJWT);

/**
 * ============================================================================
 * GET /api/admin/data-center/companies
 * List all companies with health metrics, search, and filters
 * ============================================================================
 */
router.get('/companies', async (req, res) => {
    try {
        const {
            query = '',
            state = 'all', // all | live | deleted
            staleDays = 60,
            page = 1,
            pageSize = 25,
            sort = '-lastActivity'
        } = req.query;

        console.log('[DATA CENTER] 📊 GET /companies', { query, state, page, pageSize });

        const pageNum = parseInt(page);
        const limit = parseInt(pageSize);
        const skip = (pageNum - 1) * limit;

        // 🔍 SEARCH EVERYWHERE: Query MongoDB directly via native driver to bypass ALL middleware
        // This ensures we get EVERY company regardless of Mongoose middleware filters
        const db = mongoose.connection.db;
        // IMPORTANT: Our Mongoose model maps to the 'companiesCollection' collection
        // Use the same native collection here to avoid mismatches
        const companiesCollection = db.collection('companiesCollection');

        // First, let's see what's in the database
        const totalInDB = await companiesCollection.countDocuments({});
        const liveInDB = await companiesCollection.countDocuments({ isDeleted: { $ne: true } });
        const deletedInDB = await companiesCollection.countDocuments({ isDeleted: true });
        
        console.log('[DATA CENTER] 🔍 MongoDB Stats:', {
            total: totalInDB,
            live: liveInDB,
            deleted: deletedInDB
        });
        console.log('[DATA CENTER] 🔍 Querying MongoDB native driver with state:', state);

        // Build match filter
        const match = {};

        // State filter
        if (state === 'live') {
            match.isDeleted = { $ne: true };
            match.isActive = { $ne: false }; // Changed to catch undefined and true
        } else if (state === 'deleted') {
            match.isDeleted = true;
        } else {
            // 'all' - explicitly include both deleted and non-deleted
            console.log('[DATA CENTER] 📋 Fetching ALL companies (deleted + live)');
        }

        // Search filter
        if (query && query.trim()) {
            const q = query.trim();
            
            // Check if it's a Mongo ID
            if (/^[a-f0-9]{24}$/i.test(q)) {
                match._id = new mongoose.Types.ObjectId(q);
            }
            // Check if it's a phone number
            else if (/^\+?\d[\d\s\-\(\)]+$/.test(q)) {
                const phoneDigits = q.replace(/[\s\-\(\)]/g, '');
                match.$or = [
                    { 'twilioConfig.phoneNumbers.number': new RegExp(phoneDigits, 'i') },
                    { primaryPhone: new RegExp(phoneDigits, 'i') }
                ];
            }
            // Check if it's an email
            else if (/@/.test(q)) {
                match.$or = [
                    { email: new RegExp(q, 'i') },
                    { ownerEmail: new RegExp(q, 'i') }
                ];
            }
            // Text search - use regex for company/business name
            else {
                match.$or = [
                    { companyName: new RegExp(q, 'i') },
                    { businessName: new RegExp(q, 'i') },
                    { domain: new RegExp(q, 'i') }
                ];
            }
        }

        // Calculate stale cutoff date
        const staleCutoff = new Date(Date.now() - (parseInt(staleDays) * 24 * 60 * 60 * 1000));

        // Build aggregation pipeline
        // Note: We need to handle isDeleted manually since aggregation bypasses middleware
        const finalMatch = { ...match };
        
        // For 'all' state, we still need to check if we should include deleted
        if (state === 'all') {
            // Include both deleted and non-deleted
            // No additional filter needed
        }
        
        const pipeline = [
            { $match: finalMatch },

            // Lookup call logs for activity metrics
            {
                $lookup: {
                    from: 'v2aiagentcalllogs',
                    let: { companyId: '$_id' },
                    pipeline: [
                        { $match: { $expr: { $eq: ['$companyId', '$$companyId'] } } },
                        {
                            $group: {
                                _id: null,
                                calls: { $sum: 1 },
                                lastActivity: { $max: '$timestamp' }
                            }
                        }
                    ],
                    as: 'callsAgg'
                }
            },

            // Lookup contacts for customer count
            {
                $lookup: {
                    from: 'v2contacts',
                    let: { companyId: '$_id' },
                    pipeline: [
                        { $match: { $expr: { $eq: ['$companyId', '$$companyId'] } } },
                        { $count: 'count' }
                    ],
                    as: 'contactsAgg'
                }
            },

            // Lookup notification logs for activity
            {
                $lookup: {
                    from: 'v2notificationlogs',
                    let: { companyId: '$_id' },
                    pipeline: [
                        { $match: { $expr: { $eq: ['$companyId', '$$companyId'] } } },
                        { $count: 'count' }
                    ],
                    as: 'notificationsAgg'
                }
            },

            // Project fields
            {
                $project: {
                    _id: 1,
                    companyName: 1,
                    businessName: 1,
                    email: 1,
                    ownerEmail: 1,
                    domain: 1,
                    createdAt: 1,
                    updatedAt: 1,
                    isActive: 1,
                    isDeleted: 1,
                    deletedAt: 1,
                    deletedBy: 1,
                    deleteReason: 1,
                    autoPurgeAt: 1,
                    tradeCategories: 1,
                    twilioConfig: 1,
                    aiAgentLogic: 1,
                    accountStatus: 1,
                    
                    // Aggregated data
                    calls: { $ifNull: [{ $arrayElemAt: ['$callsAgg.calls', 0] }, 0] },
                    lastActivity: { $arrayElemAt: ['$callsAgg.lastActivity', 0] },
                    customers: { $ifNull: [{ $arrayElemAt: ['$contactsAgg.count', 0] }, 0] },
                    notifications: { $ifNull: [{ $arrayElemAt: ['$notificationsAgg.count', 0] }, 0] },
                    
                    // Calculate stale flag
                    stale: {
                        $cond: [
                            { $lte: [{ $ifNull: [{ $arrayElemAt: ['$callsAgg.lastActivity', 0] }, new Date(0)] }, staleCutoff] },
                            true,
                            false
                        ]
                    }
                }
            },

            // Sort
            { $sort: buildSortObject(sort) },

            // Pagination
            { $skip: skip },
            { $limit: limit }
        ];

        // Execute aggregation using NATIVE MongoDB driver (bypasses all Mongoose middleware)
        const companies = await companiesCollection.aggregate(pipeline).toArray();
        console.log('[DATA CENTER] ✅ Native MongoDB aggregation returned', companies.length, 'companies');
        
        // DEBUG: Log first company to see structure
        if (companies.length > 0) {
            console.log('[DATA CENTER] 🔍 First company sample:', {
                _id: companies[0]._id,
                companyName: companies[0].companyName,
                businessName: companies[0].businessName,
                calls: companies[0].calls,
                hasCallsAgg: !!companies[0].callsAgg
            });
        }

        // Calculate health metrics for each company
        const results = companies.map(company => {
            const health = CompanyHealthService.calculateHealth(company, {
                calls: company.calls,
                lastActivity: company.lastActivity,
                approxStorageBytes: 0 // Will be calculated in inventory endpoint
            });

            const badge = CompanyHealthService.getHealthBadge(health);

            return {
                companyId: company._id,
                companyName: company.companyName || company.businessName,
                ownerEmail: company.email || company.ownerEmail,
                domain: company.domain,
                createdAt: company.createdAt,
                
                // Status
                isLive: health.isLive,
                isDeleted: company.isDeleted || false,
                isActive: company.isActive !== false,
                accountStatus: company.accountStatus?.status || 'active',
                
                // Health
                healthScore: health.score,
                healthBadge: badge,
                flags: health.flags,
                
                // Metrics
                calls: company.calls,
                scenarios: company.aiAgentLogic?.instantResponses?.length || 0,
                customers: company.customers,
                lastActivity: company.lastActivity,
                lastActivityFormatted: CompanyHealthService.formatLastActivity(company.lastActivity),
                readinessScore: company.aiAgentLogic?.readiness?.score || 0,
                
                // Phone
                phoneNumbers: company.twilioConfig?.phoneNumbers || [],
                primaryPhone: company.twilioConfig?.phoneNumber || null,
                
                // Soft delete info
                deletedAt: company.deletedAt,
                deletedBy: company.deletedBy,
                deleteReason: company.deleteReason,
                autoPurgeAt: company.autoPurgeAt,
                daysUntilPurge: company.autoPurgeAt 
                    ? Math.ceil((new Date(company.autoPurgeAt) - new Date()) / (1000 * 60 * 60 * 24))
                    : null,
                
                // Trade
                tradeCategories: company.tradeCategories || []
            };
        });

        // Get total count (without pagination) using NATIVE MongoDB driver
        const countPipeline = [
            { $match: finalMatch },
            { $count: 'total' }
        ];
        const countResult = await companiesCollection.aggregate(countPipeline).toArray();
        const total = countResult.length > 0 ? countResult[0].total : 0;
        console.log('[DATA CENTER] 📊 Total count from native MongoDB:', total);

        const response = {
            results,
            total,
            page: pageNum,
            pageSize: limit,
            totalPages: Math.ceil(total / limit)
        };
        
        console.log('[DATA CENTER] 📤 Sending response:', {
            resultsCount: results.length,
            total: response.total,
            page: response.page
        });
        
        res.json(response);

    } catch (error) {
        console.error('[DATA CENTER] Error listing companies:', error);
        res.status(500).json({ 
            error: 'Failed to list companies',
            details: error.message 
        });
    }
});

/**
 * Helper: Build sort object from sort string
 */
function buildSortObject(sortStr) {
    const sortMap = {
        'name': { companyName: 1 },
        '-name': { companyName: -1 },
        'created': { createdAt: 1 },
        '-created': { createdAt: -1 },
        'calls': { calls: 1 },
        '-calls': { calls: -1 },
        'lastActivity': { lastActivity: 1 },
        '-lastActivity': { lastActivity: -1 },
        'health': { healthScore: 1 },
        '-health': { healthScore: -1 }
    };

    return sortMap[sortStr] || { lastActivity: -1 }; // Default: newest activity first
}

/**
 * ============================================================================
 * GET /api/admin/data-center/companies/:id/inventory
 * Get deep inventory for a company (cached for 30s)
 * ============================================================================
 */
router.get('/companies/:id/inventory', async (req, res) => {
    try {
        const { id } = req.params;
        console.log('[DATA CENTER] GET /companies/:id/inventory', id);

        // Check cache first
        const cacheKey = `datacenter:inventory:${id}`;
        const cached = await redisClient.get(cacheKey);
        if (cached) {
            console.log('[DATA CENTER] Returning cached inventory');
            return res.json(JSON.parse(cached));
        }

        // Fetch company
        const company = await Company.findById(id).option({ includeDeleted: true });
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        // Count documents in each collection
        const [callsCount, contactsCount, notificationsCount] = await Promise.all([
            mongoose.connection.db.collection('v2aiagentcalllogs').countDocuments({ companyId: company._id }),
            mongoose.connection.db.collection('v2contacts').countDocuments({ companyId: company._id }),
            mongoose.connection.db.collection('v2notificationlogs').countDocuments({ companyId: company._id })
        ]);

        // Count scenarios
        const scenariosCount = company.aiAgentLogic?.instantResponses?.length || 0;

        // Count Redis keys (expensive - skip for now, or implement later)
        const redisKeysCount = 0; // TODO: Implement Redis SCAN if needed

        // External assets
        const externals = {
            twilioNumbers: company.twilioConfig?.phoneNumbers?.map(p => p.number) || 
                          (company.twilioConfig?.phoneNumber ? [company.twilioConfig.phoneNumber] : []),
            webhooks: 0 // TODO: Count webhooks if stored
        };

        // Estimate storage (rough calculation)
        const estimates = {
            callsBytes: callsCount * 5000, // Rough estimate: 5KB per call
            contactsBytes: contactsCount * 1000, // 1KB per contact
            notificationsBytes: notificationsCount * 500, // 500B per notification
            scenariosBytes: scenariosCount * 2000, // 2KB per scenario
            totalBytes: 0
        };
        estimates.totalBytes = estimates.callsBytes + estimates.contactsBytes + 
                              estimates.notificationsBytes + estimates.scenariosBytes;

        const inventory = {
            companyId: id,
            companyName: company.companyName || company.businessName,
            collections: {
                calls: callsCount,
                contacts: contactsCount,
                notifications: notificationsCount,
                scenarios: scenariosCount
            },
            externals,
            redisKeys: redisKeysCount,
            estimates: {
                ...estimates,
                totalFormatted: CompanyHealthService.formatDataSize(estimates.totalBytes)
            },
            cachedAt: new Date()
        };

        // Cache for 30 seconds
        await redisClient.setex(cacheKey, 30, JSON.stringify(inventory));

        res.json(inventory);

    } catch (error) {
        console.error('[DATA CENTER] Error getting inventory:', error);
        res.status(500).json({ 
            error: 'Failed to get inventory',
            details: error.message 
        });
    }
});

/**
 * ============================================================================
 * PATCH /api/admin/data-center/companies/:id/soft-delete
 * Soft delete a company (mark as deleted with grace period)
 * ============================================================================
 */
router.patch('/companies/:id/soft-delete', async (req, res) => {
    try {
        const { id } = req.params;
        const { reason, notes } = req.body;
        const userId = req.user?._id || req.user?.id;

        console.log('[DATA CENTER] PATCH /companies/:id/soft-delete', id);

        // Fetch company (include deleted to check if already deleted)
        const company = await Company.findById(id).option({ includeDeleted: true });
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        if (company.isDeleted) {
            return res.status(400).json({ error: 'Company is already deleted' });
        }

        // Mark as deleted
        company.isDeleted = true;
        company.deletedAt = new Date();
        company.deletedBy = userId;
        company.deleteReason = reason || 'No reason provided';
        company.deleteNotes = notes || '';
        
        // Set auto-purge date (30 days from now)
        const autoPurgeDate = new Date();
        autoPurgeDate.setDate(autoPurgeDate.getDate() + 30);
        company.autoPurgeAt = autoPurgeDate;

        await company.save();

        // Clear cache
        try {
            await redisClient.del(`company:${id}`);
            console.log('[DATA CENTER] Cache cleared for deleted company');
        } catch (cacheError) {
            console.warn('[DATA CENTER] Cache clear failed:', cacheError.message);
        }

        console.log('[DATA CENTER] ✅ Company soft deleted:', id);

        res.json({
            success: true,
            message: 'Company soft deleted successfully',
            autoPurgeAt: autoPurgeDate,
            daysUntilPurge: 30
        });

    } catch (error) {
        console.error('[DATA CENTER] Error soft deleting company:', error);
        res.status(500).json({ 
            error: 'Failed to soft delete company',
            details: error.message 
        });
    }
});

/**
 * ============================================================================
 * POST /api/admin/data-center/companies/:id/restore
 * Restore a soft-deleted company
 * ============================================================================
 */
router.post('/companies/:id/restore', async (req, res) => {
    try {
        const { id } = req.params;

        console.log('[DATA CENTER] POST /companies/:id/restore', id);

        // Fetch company (include deleted)
        const company = await Company.findById(id).option({ includeDeleted: true });
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        if (!company.isDeleted) {
            return res.status(400).json({ error: 'Company is not deleted' });
        }

        // Restore company
        company.isDeleted = false;
        company.deletedAt = null;
        company.deletedBy = null;
        company.deleteReason = null;
        company.deleteNotes = null;
        company.autoPurgeAt = null;

        await company.save();

        // Clear cache
        try {
            await redisClient.del(`company:${id}`);
            console.log('[DATA CENTER] Cache cleared for restored company');
        } catch (cacheError) {
            console.warn('[DATA CENTER] Cache clear failed:', cacheError.message);
        }

        console.log('[DATA CENTER] ✅ Company restored:', id);

        res.json({
            success: true,
            message: 'Company restored successfully'
        });

    } catch (error) {
        console.error('[DATA CENTER] Error restoring company:', error);
        res.status(500).json({ 
            error: 'Failed to restore company',
            details: error.message 
        });
    }
});

/**
 * ============================================================================
 * GET /api/admin/data-center/companies/:id/customers
 * Get customer list for a company (from contacts/memories)
 * ============================================================================
 */
router.get('/companies/:id/customers', async (req, res) => {
    try {
        const { id } = req.params;
        const { search = '', page = 1, pageSize = 50 } = req.query;

        console.log('[DATA CENTER] GET /companies/:id/customers', id);

        const pageNum = parseInt(page);
        const limit = parseInt(pageSize);
        const skip = (pageNum - 1) * limit;

        // Build query
        const query = { companyId: new mongoose.Types.ObjectId(id) };
        if (search) {
            query.$or = [
                { phoneNumber: new RegExp(search, 'i') },
                { name: new RegExp(search, 'i') },
                { email: new RegExp(search, 'i') }
            ];
        }

        // Fetch contacts
        const contacts = await mongoose.connection.db.collection('v2contacts')
            .find(query)
            .sort({ lastContacted: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();

        const total = await mongoose.connection.db.collection('v2contacts')
            .countDocuments(query);

        res.json({
            results: contacts,
            total,
            page: pageNum,
            pageSize: limit,
            totalPages: Math.ceil(total / limit)
        });

    } catch (error) {
        console.error('[DATA CENTER] Error fetching customers:', error);
        res.status(500).json({ 
            error: 'Failed to fetch customers',
            details: error.message 
        });
    }
});

/**
 * ============================================================================
 * GET /api/admin/data-center/companies/:id/transcripts
 * Get call transcripts for a company (date range)
 * ============================================================================
 */
router.get('/companies/:id/transcripts', async (req, res) => {
    try {
        const { id } = req.params;
        const { startDate, endDate, page = 1, pageSize = 50 } = req.query;

        console.log('[DATA CENTER] GET /companies/:id/transcripts', id);

        const pageNum = parseInt(page);
        const limit = parseInt(pageSize);
        const skip = (pageNum - 1) * limit;

        // Build query
        const query = { companyId: new mongoose.Types.ObjectId(id) };
        if (startDate || endDate) {
            query.timestamp = {};
            if (startDate) query.timestamp.$gte = new Date(startDate);
            if (endDate) query.timestamp.$lte = new Date(endDate);
        }

        // Fetch calls
        const calls = await mongoose.connection.db.collection('v2aiagentcalllogs')
            .find(query)
            .sort({ timestamp: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();

        const total = await mongoose.connection.db.collection('v2aiagentcalllogs')
            .countDocuments(query);

        res.json({
            results: calls,
            total,
            page: pageNum,
            pageSize: limit,
            totalPages: Math.ceil(total / limit)
        });

    } catch (error) {
        console.error('[DATA CENTER] Error fetching transcripts:', error);
        res.status(500).json({ 
            error: 'Failed to fetch transcripts',
            details: error.message 
        });
    }
});

/**
 * ============================================================================
 * GET /api/admin/data-center/duplicates
 * Find duplicate companies (by normalized name/domain)
 * ============================================================================
 */
router.get('/duplicates', async (req, res) => {
    try {
        console.log('[DATA CENTER] GET /duplicates');

        const pipeline = [
            {
                $match: { isDeleted: { $ne: true } }
            },
            {
                $project: {
                    companyName: 1,
                    businessName: 1,
                    domain: 1,
                    email: 1,
                    normalizedName: {
                        $toLower: {
                            $trim: {
                                input: { $ifNull: ['$companyName', '$businessName'] }
                            }
                        }
                    },
                    normalizedDomain: {
                        $toLower: {
                            $trim: {
                                input: { $ifNull: ['$domain', ''] }
                            }
                        }
                    }
                }
            },
            {
                $group: {
                    _id: { 
                        name: '$normalizedName',
                        domain: '$normalizedDomain'
                    },
                    count: { $sum: 1 },
                    companies: {
                        $push: {
                            id: '$_id',
                            companyName: '$companyName',
                            businessName: '$businessName',
                            domain: '$domain',
                            email: '$email'
                        }
                    }
                }
            },
            {
                $match: { count: { $gt: 1 } }
            },
            {
                $sort: { count: -1 }
            },
            {
                $limit: 50
            }
        ];

        const duplicates = await Company.aggregate(pipeline).option({ includeDeleted: false });

        res.json({
            clusters: duplicates,
            total: duplicates.length
        });

    } catch (error) {
        console.error('[DATA CENTER] Error finding duplicates:', error);
        res.status(500).json({ 
            error: 'Failed to find duplicates',
            details: error.message 
        });
    }
});

module.exports = router;

