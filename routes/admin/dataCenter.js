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
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const DataCenterAuditLog = require('../../models/DataCenterAuditLog');
const { redisClient } = require('../../db');

// Apply authentication to all routes
router.use(authenticateJWT);
// Enforce admin-only access for all Data Center operations
router.use(requireRole('admin'));

// Helper: Build a collections map based on existing collection names
function buildCollectionsMap(names) {
    return {
        companies: names.has('companiesCollection') ? 'companiesCollection' : 'companies',
        calls: names.has('v2aiagentcalllogs') ? 'v2aiagentcalllogs' : (names.has('aiagentcalllogs') ? 'aiagentcalllogs' : null),
        contacts: names.has('v2contacts') ? 'v2contacts' : (names.has('contacts') ? 'contacts' : null),
        notifications: names.has('v2notificationlogs') ? 'v2notificationlogs' : (names.has('notificationlogs') ? 'notificationlogs' : null),
        transcripts: names.has('conversationlogs') ? 'conversationlogs' : null,
        customers: names.has('customers') ? 'customers' : null
    };
}

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
        const collections = await db.listCollections().toArray();
        const names = new Set(collections.map(c => c.name));
        const collectionsMap = buildCollectionsMap(names);
        // Pick primary and legacy company collections
        const companiesCollection = db.collection(collectionsMap.companies);
        const legacyCollection = collectionsMap.companies === 'companiesCollection' && names.has('companies')
            ? db.collection('companies')
            : null;

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

        // State filter with legacy compatibility
        // Deleted if any of the following is true: isDeleted=true/'true', deleted=true/'true', deletedAt exists (date), accountStatus.status='deleted'
        const deletedOr = [
            { isDeleted: true },
            { isDeleted: 'true' },
            { deleted: true },
            { deleted: 'true' },
            { deletedAt: { $type: 'date' } },
            { 'accountStatus.status': 'deleted' }
        ];

        if (state === 'live') {
            match.$and = [
                { $nor: deletedOr },
                { $or: [ { isActive: { $ne: false } }, { isActive: { $exists: false } } ] }
            ];
        } else if (state === 'deleted') {
            match.$or = deletedOr;
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
        
        // Build base pipeline (no sort/pagination yet)
        const basePipeline = [
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

            // Note: We will merge results from multiple collections and then sort/paginate in JS
        ];

        // Execute aggregation using NATIVE MongoDB driver across BOTH possible collections
        // Diagnostics: when filtering deleted, log chosen collections and filter
        if (state === 'deleted' || state === 'live' || state === 'all') {
            console.log('[DATA CENTER] 🔎 Companies list final $match:', JSON.stringify(finalMatch));
            console.log('[DATA CENTER] 🔎 Using company collections:', {
                primary: collectionsMap.companies || '(none)',
                legacy: (collectionsMap.companies === 'companiesCollection' && names.has('companies')) ? 'companies' : null
            });
        }

        const [primaryResults, legacyResults] = await Promise.all([
            companiesCollection.aggregate(basePipeline).toArray(),
            legacyCollection ? legacyCollection.aggregate(basePipeline).toArray() : Promise.resolve([])
        ]);
        const mergedCompanies = [...primaryResults, ...(legacyResults || [])];
        console.log('[DATA CENTER] ✅ Native MongoDB aggregation returned', mergedCompanies.length, 'companies (merged)');
        
        // DEBUG: Log first company to see structure
        if (mergedCompanies.length > 0) {
            console.log('[DATA CENTER] 🔍 First company sample:', {
                _id: mergedCompanies[0]._id,
                companyName: mergedCompanies[0].companyName,
                businessName: mergedCompanies[0].businessName,
                calls: mergedCompanies[0].calls,
                hasCallsAgg: !!mergedCompanies[0].callsAgg
            });
        }

        // Sort merged results in JS based on requested sort
        const sortSpec = buildSortObject(sort);
        const [[sortKey, sortDir]] = Object.entries(sortSpec);
        mergedCompanies.sort((a, b) => {
            const av = a[sortKey] ?? null;
            const bv = b[sortKey] ?? null;
            const aVal = av instanceof Date ? av.getTime() : (typeof av === 'number' ? av : (av ? 1 : 0));
            const bVal = bv instanceof Date ? bv.getTime() : (typeof bv === 'number' ? bv : (bv ? 1 : 0));
            return sortDir === -1 ? bVal - aVal : aVal - bVal;
        });

        // Pagination in JS after merge
        const pageSlice = mergedCompanies.slice(skip, skip + limit);

        // Calculate health metrics for each company
        const results = pageSlice.map(company => {
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

        // Get total count across both collections
        const [primaryCount, legacyCount] = await Promise.all([
            companiesCollection.countDocuments(finalMatch),
            legacyCollection ? legacyCollection.countDocuments(finalMatch) : Promise.resolve(0)
        ]);
        const total = (primaryCount || 0) + (legacyCount || 0);
        console.log('[DATA CENTER] 📊 Total count from native MongoDB (merged):', total);

        if (state === 'deleted') {
            console.log('[DATA CENTER] 🔎 Pre-pagination deleted counts:', { primaryCount, legacyCount, total });
        }

        const response = {
            results,
            total,
            page: pageNum,
            pageSize: limit,
            totalPages: Math.ceil(total / limit),
            collectionsMap
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

        // Check cache first (guard if redis is unavailable)
        const cacheKey = `datacenter:inventory:${id}`;
        try {
            if (redisClient && typeof redisClient.get === 'function') {
                const cached = await redisClient.get(cacheKey);
                if (cached) {
                    console.log('[DATA CENTER] Returning cached inventory');
                    return res.json(JSON.parse(cached));
                }
            }
        } catch (cacheErr) {
            console.warn('[DATA CENTER] Redis cache get failed:', cacheErr.message);
        }

        // Fetch company with legacy fallback
        // Use native driver to bypass Mongoose middleware and .option()
        const db = mongoose.connection.db;
        const collections = await db.listCollections().toArray();
        const names = new Set(collections.map(c => c.name));
        const collectionsMap = buildCollectionsMap(names);
        const primaryName = collectionsMap.companies;
        const raw = await db.collection(primaryName).findOne({ _id: new mongoose.Types.ObjectId(id) })
            || (names.has('companies') ? await db.collection('companies').findOne({ _id: new mongoose.Types.ObjectId(id) }) : null);
        if (!raw) {
            return res.status(404).json({ error: 'Company not found' });
        }

        // Count documents in each collection
        // Support legacy collection names as well
        const callLogsName = collectionsMap.calls || 'v2aiagentcalllogs';
        const contactsName = collectionsMap.contacts || 'v2contacts';
        const notificationsName = collectionsMap.notifications || 'v2notificationlogs';

        const [callsCount, contactsCount, notificationsCount] = await Promise.all([
            db.collection(callLogsName).countDocuments({ companyId: raw._id }),
            db.collection(contactsName).countDocuments({ companyId: raw._id }),
            db.collection(notificationsName).countDocuments({ companyId: raw._id })
        ]);

        // Diagnostics: include chosen collection names
        console.log('[DATA CENTER] Inventory collection map:', {
            calls: callLogsName,
            contacts: contactsName,
            notifications: notificationsName
        });

        // Count scenarios
        const scenariosCount = raw.aiAgentLogic?.instantResponses?.length || 0;

        // Count Redis keys (expensive - skip for now, or implement later)
        const redisKeysCount = 0; // TODO: Implement Redis SCAN if needed

        // External assets
        const externals = {
            twilioNumbers: raw.twilioConfig?.phoneNumbers?.map(p => p.number) || 
                          (raw.twilioConfig?.phoneNumber ? [raw.twilioConfig.phoneNumber] : []),
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
            companyName: raw.companyName || raw.businessName,
            collections: {
                calls: callsCount,
                contacts: contactsCount,
                notifications: notificationsCount,
                scenarios: scenariosCount
            },
            collectionsMap: {
                ...collectionsMap,
                companies: primaryName,
                calls: callLogsName,
                contacts: contactsName,
                notifications: notificationsName
            },
            externals,
            redisKeys: redisKeysCount,
            estimates: {
                ...estimates,
                totalFormatted: CompanyHealthService.formatDataSize(estimates.totalBytes)
            },
            cachedAt: new Date()
        };

        // Cache for 30 seconds (best-effort)
        try {
            if (redisClient && typeof redisClient.setex === 'function') {
                await redisClient.setex(cacheKey, 30, JSON.stringify(inventory));
            }
        } catch (cacheErr) {
            console.warn('[DATA CENTER] Redis cache set failed:', cacheErr.message);
        }

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
        const userEmail = req.user?.email || null;

        console.log('[DATA CENTER] PATCH /companies/:id/soft-delete', id);

        // Fetch company (include deleted to check if already deleted)
        // Use native driver to bypass Mongoose middleware and .option()
        const rawCompany = await mongoose.connection.db.collection('companiesCollection').findOne({ _id: new mongoose.Types.ObjectId(id) })
            || await mongoose.connection.db.collection('companies').findOne({ _id: new mongoose.Types.ObjectId(id) });
        if (!rawCompany) {
            return res.status(404).json({ error: 'Company not found' });
        }

        if (rawCompany.isDeleted) {
            return res.status(400).json({ error: 'Company is already deleted' });
        }

        // Mark as deleted
        const autoPurgeDate = new Date();
        autoPurgeDate.setDate(autoPurgeDate.getDate() + 30);

        const softDeleteUpdate = {
            $set: {
                isDeleted: true,
                deletedAt: new Date(),
                deletedBy: userId || null,
                deleteReason: reason || 'No reason provided',
                deleteNotes: notes || '',
                autoPurgeAt: autoPurgeDate
            }
        };

        // Update both primary and legacy collections; only one will match
        await Promise.all([
            mongoose.connection.db.collection('companiesCollection').updateOne(
                { _id: new mongoose.Types.ObjectId(id) },
                softDeleteUpdate
            ),
            mongoose.connection.db.collection('companies').updateOne(
                { _id: new mongoose.Types.ObjectId(id) },
                softDeleteUpdate
            )
        ]);

        // Clear cache (best-effort)
        try {
            if (redisClient && typeof redisClient.del === 'function') {
                await redisClient.del(`company:${id}`);
                await redisClient.del(`datacenter:inventory:${id}`);
                await redisClient.del(`readiness:${id}`);
                console.log('[DATA CENTER] Cache cleared for deleted company');
            }
        } catch (cacheError) {
            console.warn('[DATA CENTER] Cache clear failed:', cacheError.message);
        }

        console.log('[DATA CENTER] ✅ Company soft deleted:', id);

        // Audit log - Soft delete
        try {
            await DataCenterAuditLog.create({
                action: 'SOFT_DELETE',
                targetType: 'COMPANY',
                targetId: id,
                targetName: rawCompany.companyName || rawCompany.businessName || null,
                userId: userId || null,
                userEmail: userEmail,
                metadata: { reason: reason || null, notes: notes || null },
                success: true
            });
        } catch (auditErr) {
            console.warn('[DATA CENTER] Audit log failed (SOFT_DELETE):', auditErr.message);
        }

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
        const userId = req.user?._id || req.user?.id;
        const userEmail = req.user?.email || null;

        console.log('[DATA CENTER] POST /companies/:id/restore', id);

        // Fetch company (include deleted)
        // Use native driver to bypass Mongoose middleware and .option()
        const rawRestore2 = await mongoose.connection.db.collection('companiesCollection').findOne({ _id: new mongoose.Types.ObjectId(id) })
            || await mongoose.connection.db.collection('companies').findOne({ _id: new mongoose.Types.ObjectId(id) });
        if (!rawRestore2) {
            return res.status(404).json({ error: 'Company not found' });
        }

        if (!rawRestore2.isDeleted) {
            return res.status(400).json({ error: 'Company is not deleted' });
        }

        // Restore company (primary + legacy)
        const restoreUpdate = {
            $set: {
                isDeleted: false,
                deletedAt: null,
                deletedBy: null,
                deleteReason: null,
                deleteNotes: null,
                autoPurgeAt: null
            }
        };

        await Promise.all([
            mongoose.connection.db.collection('companiesCollection').updateOne(
                { _id: new mongoose.Types.ObjectId(id) },
                restoreUpdate
            ),
            mongoose.connection.db.collection('companies').updateOne(
                { _id: new mongoose.Types.ObjectId(id) },
                restoreUpdate
            )
        ]);

        // Clear cache (best-effort)
        try {
            if (redisClient && typeof redisClient.del === 'function') {
                await redisClient.del(`company:${id}`);
                await redisClient.del(`datacenter:inventory:${id}`);
                await redisClient.del(`readiness:${id}`);
                console.log('[DATA CENTER] Cache cleared for restored company');
            }
        } catch (cacheError) {
            console.warn('[DATA CENTER] Cache clear failed:', cacheError.message);
        }

        console.log('[DATA CENTER] ✅ Company restored:', id);

        // Audit log - Restore
        try {
            await DataCenterAuditLog.create({
                action: 'RESTORE',
                targetType: 'COMPANY',
                targetId: id,
                targetName: rawRestore2.companyName || rawRestore2.businessName || null,
                userId: userId || null,
                userEmail: userEmail,
                success: true
            });
        } catch (auditErr) {
            console.warn('[DATA CENTER] Audit log failed (RESTORE):', auditErr.message);
        }

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

        // Fetch contacts from legacy-aware collection name
        const db = mongoose.connection.db;
        const collections = await db.listCollections().toArray();
        const names = new Set(collections.map(c => c.name));
        const collectionsMap = buildCollectionsMap(names);
        const contactsName = collectionsMap.contacts || 'v2contacts';

        const contacts = await db.collection(contactsName)
            .find(query)
            .sort({ lastContacted: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();

        const total = await db.collection(contactsName)
            .countDocuments(query);

        res.json({
            results: contacts,
            total,
            page: pageNum,
            pageSize: limit,
            totalPages: Math.ceil(total / limit),
            collectionsMap
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

        // Legacy-aware call logs collection
        const db = mongoose.connection.db;
        const collections = await db.listCollections().toArray();
        const names = new Set(collections.map(c => c.name));
        const collectionsMap = buildCollectionsMap(names);
        const callLogsName = collectionsMap.calls || 'v2aiagentcalllogs';

        const calls = await db.collection(callLogsName)
            .find(query)
            .sort({ timestamp: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();

        const total = await db.collection(callLogsName)
            .countDocuments(query);

        res.json({
            results: calls,
            total,
            page: pageNum,
            pageSize: limit,
            totalPages: Math.ceil(total / limit),
            collectionsMap
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
        const db = mongoose.connection.db;
        const collections = await db.listCollections().toArray();
        const names = new Set(collections.map(c => c.name));
        const companiesName = names.has('companiesCollection') ? 'companiesCollection' : 'companies';

        const pipeline = [
            {
                // Exclude deleted across legacy flags
                $match: {
                    $and: [
                        { $or: [ { isDeleted: { $ne: true } }, { isDeleted: { $exists: false } } ] },
                        { $or: [ { deleted: { $ne: true } }, { deleted: { $exists: false } } ] },
                        { $or: [ { 'accountStatus.status': { $ne: 'deleted' } }, { 'accountStatus.status': { $exists: false } } ] }
                    ]
                }
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

        // Use native driver aggregation to avoid middleware
        const duplicates = await db.collection(companiesName).aggregate(pipeline).toArray();

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

/**
 * ============================================================================
 * GET /api/admin/data-center/scan
 * Environment + DB scan: enumerate collections, merged company totals, Redis
 * ============================================================================
 */
router.get('/scan', async (req, res) => {
    try {
        const db = mongoose.connection.db;
        const collections = await db.listCollections().toArray();
        const names = new Set(collections.map(c => c.name));

        // List collections
        const colNames = collections.map(c => c.name);

        // Company collections (primary + legacy)
        const primaryCompanies = db.collection(names.has('companiesCollection') ? 'companiesCollection' : 'companies');
        const legacyCompanies = names.has('companies') ? db.collection('companies') : null;

        const [
            totalPrimary, livePrimary, deletedPrimary,
            totalLegacy, liveLegacy, deletedLegacy
        ] = await Promise.all([
            primaryCompanies.countDocuments({}),
            // live = NOT deleted by any legacy flag
            primaryCompanies.countDocuments({
                $and: [
                    { $or: [ { isDeleted: { $ne: true } }, { isDeleted: { $exists: false } } ] },
                    { $or: [ { deleted: { $ne: true } }, { deleted: { $exists: false } } ] },
                    { $or: [ { 'accountStatus.status': { $ne: 'deleted' } }, { 'accountStatus.status': { $exists: false } } ] }
                ]
            }),
            // deleted = any legacy flag
            primaryCompanies.countDocuments({ $or: [ { isDeleted: true }, { deleted: true }, { deletedAt: { $type: 'date' } }, { 'accountStatus.status': 'deleted' } ] }),
            legacyCompanies ? legacyCompanies.countDocuments({}) : 0,
            legacyCompanies ? legacyCompanies.countDocuments({
                $and: [
                    { $or: [ { isDeleted: { $ne: true } }, { isDeleted: { $exists: false } } ] },
                    { $or: [ { deleted: { $ne: true } }, { deleted: { $exists: false } } ] },
                    { $or: [ { 'accountStatus.status': { $ne: 'deleted' } }, { 'accountStatus.status': { $exists: false } } ] }
                ]
            }) : 0,
            legacyCompanies ? legacyCompanies.countDocuments({ $or: [ { isDeleted: true }, { deleted: true }, { deletedAt: { $type: 'date' } }, { 'accountStatus.status': 'deleted' } ] }) : 0
        ]);

        // Other key collections (safe counts)
        const safeCount = async (name, query = {}) => {
            try { return await db.collection(name).countDocuments(query); } catch { return 0; }
        };

        const counts = {
            v2aiagentcalllogs: await safeCount(names.has('v2aiagentcalllogs') ? 'v2aiagentcalllogs' : (names.has('aiagentcalllogs') ? 'aiagentcalllogs' : 'v2aiagentcalllogs')),
            v2contacts: await safeCount(names.has('v2contacts') ? 'v2contacts' : (names.has('contacts') ? 'contacts' : 'v2contacts')),
            v2notificationlogs: await safeCount(names.has('v2notificationlogs') ? 'v2notificationlogs' : (names.has('notificationlogs') ? 'notificationlogs' : 'v2notificationlogs'))
        };

        const collectionsMap = buildCollectionsMap(names);

        // Redis scan (approx) for company-related keys
        const scanPatternCounts = async (patterns) => {
            const result = {};
            for (const pattern of patterns) {
                let cursor = '0';
                let total = 0;
                try {
                    do {
                        const reply = await redisClient.scan(cursor, 'MATCH', pattern, 'COUNT', 1000);
                        cursor = reply[0];
                        total += reply[1]?.length || 0;
                    } while (cursor !== '0');
                } catch (e) {
                    // ignore redis errors in scan
                }
                result[pattern] = total;
            }
            return result;
        };

        const redis = await scanPatternCounts(['company:*', 'datacenter:*', 'ai:*']);

        res.json({
            env: {
                nodeEnv: process.env.NODE_ENV || 'development',
                dbName: db.databaseName
            },
            mongo: {
                collections: colNames,
                collectionsMap,
                companies: {
                    primary: { total: totalPrimary, live: livePrimary, deleted: deletedPrimary },
                    legacy: { total: totalLegacy, live: liveLegacy, deleted: deletedLegacy },
                    merged: {
                        total: (totalPrimary || 0) + (totalLegacy || 0),
                        live: (livePrimary || 0) + (liveLegacy || 0),
                        deleted: (deletedPrimary || 0) + (deletedLegacy || 0)
                    }
                },
                counts
            },
            redis
        });
    } catch (error) {
        console.error('[DATA CENTER] Error scanning environment:', error);
        res.status(500).json({ error: 'Scan failed', details: error.message });
    }
});

/**
 * ============================================================================
 * GET /api/admin/data-center/summary
 * Returns global counters: total, live, deleted, neverLive (merged across
 * primary 'companiesCollection' and legacy 'companies')
 * ============================================================================
 */
router.get('/summary', async (req, res) => {
    try {
        const db = mongoose.connection.db;
        const collections = await db.listCollections().toArray();
        const names = new Set(collections.map(c => c.name));
        const collectionsMap = buildCollectionsMap(names);
        const primary = db.collection(collectionsMap.companies);
        const legacy = collectionsMap.companies === 'companiesCollection' && names.has('companies') ? db.collection('companies') : null;

        // Unified deleted/live filters (legacy-aware)
        const deletedMatch = {
            $or: [
                { isDeleted: true },
                { isDeleted: 'true' },
                { deleted: true },
                { deleted: 'true' },
                { deletedAt: { $type: 'date' } },
                { 'accountStatus.status': 'deleted' }
            ]
        };
        const liveMatch = {
            $and: [
                { $or: [ { isDeleted: { $exists: false } }, { isDeleted: false }, { isDeleted: 'false' } ] },
                { $or: [ { deleted: { $exists: false } }, { deleted: false }, { deleted: 'false' } ] },
                { $or: [ { deletedAt: { $exists: false } }, { deletedAt: null } ] },
                { $or: [ { 'accountStatus.status': { $exists: false } }, { 'accountStatus.status': { $ne: 'deleted' } } ] }
            ]
        };

        console.log('[SUMMARY] Using companies collection:', collectionsMap.companies || '(none)');
        console.log('[SUMMARY] deletedMatch =', JSON.stringify(deletedMatch));
        console.log('[SUMMARY] liveMatch    =', JSON.stringify(liveMatch));

        // Basic counts for primary and legacy, then merge
        const [totalP, delP, liveP] = await Promise.all([
            primary.countDocuments({}),
            primary.countDocuments(deletedMatch),
            primary.countDocuments(liveMatch)
        ]);

        let totalL = 0, delL = 0, liveL = 0;
        if (legacy) {
            [totalL, delL, liveL] = await Promise.all([
                legacy.countDocuments({}),
                legacy.countDocuments(deletedMatch),
                legacy.countDocuments(liveMatch)
            ]);
        }

        // Never-live is optional; compute safely with try/catch and default 0
        let neverP = 0, neverL = 0;
        try {
            const callLogsName = collectionsMap.calls || null;
            if (callLogsName) {
                const pipeline = [
                    {
                        $lookup: {
                            from: callLogsName,
                            let: { cid: '$_id' },
                            pipeline: [
                                { $match: { $expr: { $eq: ['$companyId', '$$cid'] } } },
                                { $limit: 1 }
                            ],
                            as: 'callsAgg'
                        }
                    },
                    {
                        $project: {
                            zeroCalls: { $eq: [{ $size: '$callsAgg' }, 0] },
                            scenariosSize: { $size: { $ifNull: ['$aiAgentLogic.instantResponses', []] } },
                            phoneCount: { $size: { $ifNull: ['$twilioConfig.phoneNumbers', []] } },
                            legacyPhone: { $ifNull: ['$twilioConfig.phoneNumber', null] }
                        }
                    },
                    {
                        $project: {
                            isNeverLive: {
                                $and: [
                                    '$zeroCalls',
                                    { $eq: ['$scenariosSize', 0] },
                                    { $eq: ['$phoneCount', 0] },
                                    { $eq: ['$legacyPhone', null] }
                                ]
                            }
                        }
                    },
                    { $match: { isNeverLive: true } },
                    { $count: 'count' }
                ];
                const rP = await primary.aggregate(pipeline).toArray();
                neverP = rP.length ? rP[0].count : 0;
                if (legacy) {
                    const rL = await legacy.aggregate(pipeline).toArray();
                    neverL = rL.length ? rL[0].count : 0;
                }
            }
        } catch (e) {
            console.warn('[SUMMARY] neverLive computation skipped:', e.message);
        }

        const summary = {
            total: (totalP || 0) + (totalL || 0),
            live: (liveP || 0) + (liveL || 0),
            deleted: (delP || 0) + (delL || 0),
            neverLive: (neverP || 0) + (neverL || 0)
        };

        res.json({ ...summary, collectionsMap });
    } catch (error) {
        console.error('[DATA CENTER] Error getting summary:', error);
        res.status(500).json({ error: 'Failed to get summary', details: error.message });
    }
});

/**
 * ==========================================================================
 * GET /api/admin/data-center/companies/:id/deletion-debug
 * Explain why a company is considered deleted and which collection was used
 * ==========================================================================
 */
router.get('/companies/:id/deletion-debug', async (req, res) => {
    try {
        const { id } = req.params;
        const db = mongoose.connection.db;
        const collections = await db.listCollections().toArray();
        const names = new Set(collections.map(c => c.name));
        const collectionsMap = buildCollectionsMap(names);

        const objectId = new mongoose.Types.ObjectId(id);
        let usedCollection = collectionsMap.companies;
        let doc = await db.collection(usedCollection).findOne(
            { _id: objectId },
            { projection: { companyName: 1, businessName: 1, isDeleted: 1, deleted: 1, deletedAt: 1, accountStatus: 1 } }
        );

        if (!doc && usedCollection === 'companiesCollection' && names.has('companies')) {
            usedCollection = 'companies';
            doc = await db.collection('companies').findOne(
                { _id: objectId },
                { projection: { companyName: 1, businessName: 1, isDeleted: 1, deleted: 1, deletedAt: 1, accountStatus: 1 } }
            );
        }

        if (!doc) {
            return res.status(404).json({ error: 'Company not found' });
        }

        const flags = {
            isDeleted: doc.isDeleted === true,
            deleted: doc.deleted === true,
            deletedAtIsDate: doc.deletedAt instanceof Date,
            accountStatusDeleted: doc.accountStatus?.status === 'deleted',
            stringBooleans: {
                isDeleted: doc.isDeleted === 'true',
                deleted: doc.deleted === 'true'
            }
        };

        const evaluatedAsDeleted = Boolean(
            doc.isDeleted === true ||
            doc.deleted === true ||
            doc.isDeleted === 'true' ||
            doc.deleted === 'true' ||
            (doc.deletedAt instanceof Date) ||
            (doc.accountStatus && doc.accountStatus.status === 'deleted')
        );

        const raw = {
            companyName: doc.companyName || doc.businessName || null,
            isDeleted: doc.isDeleted ?? null,
            deleted: doc.deleted ?? null,
            deletedAt: doc.deletedAt ?? null,
            accountStatus: doc.accountStatus ?? null
        };

        res.json({
            companyId: id,
            collection: usedCollection,
            flags,
            evaluatedAsDeleted,
            raw
        });
    } catch (error) {
        console.error('[DATA CENTER] Error in deletion-debug:', error);
        res.status(500).json({ error: 'Failed to debug deletion status', details: error.message });
    }
});

/**
 * ==========================================================================
 * GET /api/admin/data-center/collections-map
 * Return selected collection names for this environment
 * ==========================================================================
 */
router.get('/collections-map', async (req, res) => {
    try {
        const db = mongoose.connection.db;
        const collections = await db.listCollections().toArray();
        const names = new Set(collections.map(c => c.name));
        const collectionsMap = buildCollectionsMap(names);
        res.json(collectionsMap);
    } catch (error) {
        console.error('[DATA CENTER] Error in collections-map:', error);
        res.status(500).json({ error: 'Failed to get collections map', details: error.message });
    }
});

/**
 * ==========================================================================
 * POST /api/admin/data-center/seed/e2e
 * Seed minimal E2E fixtures (guarded by ALLOW_SEEDING=true)
 * ==========================================================================
 */
router.post('/seed/e2e', async (req, res) => {
    try {
        if (process.env.ALLOW_SEEDING !== 'true') {
            return res.status(403).json({ ok: false, error: 'SEEDING_DISABLED' });
        }

        const db = mongoose.connection.db;
        const list = await db.listCollections().toArray();
        const names = new Set(list.map(c => c.name));
        const cmap = buildCollectionsMap(names);

        const companies = db.collection(cmap.companies);
        const calls = cmap.calls ? db.collection(cmap.calls) : null;
        const transcripts = cmap.transcripts ? db.collection(cmap.transcripts) : null;
        const contacts = cmap.contacts ? db.collection(cmap.contacts) : null;

        const seedTag = 'DATA_CENTER_E2E';
        const now = new Date();

        const liveName = 'SEED – Live Demo Co';
        const neverName = 'SEED – Never Live Co';
        const delName = 'SEED – Deleted Legacy Co';

        const liveRes = await companies.findOneAndUpdate(
            { seedTag, companyName: liveName },
            { $set: { seedTag, companyName: liveName, status: 'active', accountStatus: { status: 'active' }, createdAt: now } },
            { upsert: true, returnDocument: 'after' }
        );
        const liveCo = liveRes.value || await companies.findOne({ seedTag, companyName: liveName });

        const neverRes = await companies.findOneAndUpdate(
            { seedTag, companyName: neverName },
            { $set: { seedTag, companyName: neverName, status: 'inactive', accountStatus: { status: 'inactive' }, createdAt: now } },
            { upsert: true, returnDocument: 'after' }
        );
        const neverCo = neverRes.value || await companies.findOne({ seedTag, companyName: neverName });

        const delRes = await companies.findOneAndUpdate(
            { seedTag, companyName: delName },
            { $set: { seedTag, companyName: delName, isDeleted: true, deleted: true, deletedAt: now, accountStatus: { status: 'deleted' }, createdAt: now } },
            { upsert: true, returnDocument: 'after' }
        );
        const deletedCo = delRes.value || await companies.findOne({ seedTag, companyName: delName });

        // Minimal activity for Live Co
        if (contacts) {
            await contacts.updateOne(
                { seedTag, companyId: liveCo._id, phone: '+12345550100' },
                { $set: { seedTag, companyId: liveCo._id, name: 'Seed Customer', phone: '+12345550100', createdAt: now } },
                { upsert: true }
            );
        }
        if (calls) {
            await calls.updateOne(
                { seedTag, companyId: liveCo._id, callId: 'SEEDCALL-1' },
                { $set: { seedTag, companyId: liveCo._id, callId: 'SEEDCALL-1', startedAt: now, durationSec: 60 } },
                { upsert: true }
            );
        }
        if (transcripts) {
            await transcripts.updateOne(
                { seedTag, companyId: liveCo._id, callId: 'SEEDCALL-1' },
                { $set: { seedTag, companyId: liveCo._id, callId: 'SEEDCALL-1', text: 'Hello this is a seed transcript.' } },
                { upsert: true }
            );
        }

        return res.json({
            ok: true,
            collectionsMap: cmap,
            companies: {
                liveCoId: liveCo?._id,
                neverLiveCoId: neverCo?._id,
                deletedCoId: deletedCo?._id
            }
        });
    } catch (error) {
        console.error('[DATA CENTER] Seed E2E error:', error);
        return res.status(500).json({ ok: false, error: 'SEED_FAILED', message: error.message });
    }
});

/**
 * ==========================================================================
 * POST /api/admin/data-center/seed/e2e/wipe
 * Remove E2E fixtures by seedTag (guarded by ALLOW_SEEDING=true)
 * ==========================================================================
 */
router.post('/seed/e2e/wipe', async (req, res) => {
    try {
        if (process.env.ALLOW_SEEDING !== 'true') {
            return res.status(403).json({ ok: false, error: 'SEEDING_DISABLED' });
        }
        const db = mongoose.connection.db;
        const list = await db.listCollections().toArray();
        const names = new Set(list.map(c => c.name));
        const cmap = buildCollectionsMap(names);
        const seedTag = 'DATA_CENTER_E2E';

        const collectionsToClean = [
            cmap.companies,
            cmap.calls,
            cmap.transcripts,
            cmap.contacts,
            cmap.notifications
        ].filter(Boolean);

        for (const colName of collectionsToClean) {
            await db.collection(colName).deleteMany({ seedTag });
        }

        return res.json({ ok: true, collectionsMap: cmap });
    } catch (error) {
        console.error('[DATA CENTER] Wipe E2E error:', error);
        return res.status(500).json({ ok: false, error: 'WIPE_FAILED', message: error.message });
    }
});

module.exports = router;

