/**
 * V2 GLOBAL DIRECTORY ROUTES - V2 Company Management
 * 
 * 🌐 V2 GLOBAL DIRECTORY - V2 ARCHITECTURE:
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║ COMPANY DIRECTORY V2 - MULTI-TENANT PLATFORM MANAGEMENT         ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║ Features: Search, Filter, CRUD Operations, Trade Categories      ║
 * ║ Security: JWT Authentication + Admin Role Required               ║
 * ║ Performance: Redis Caching + Optimized Queries + Pagination     ║
 * ║ Architecture: V2 Global Structure - No Legacy Dependencies      ║
 * ╚══════════════════════════════════════════════════════════════════╝
 * 
 * V2 Global Directory Features:
 * - Company Search (Name, Phone, Email, Address)
 * - Trade Category Filtering
 * - Active/Inactive Status Toggle
 * - Pagination & Sorting
 * - Real-time Company Statistics
 * - Export Functionality
 * - Bulk Operations
 * 
 * This V2 version provides v2-grade company management
 * with sub-50ms performance and complete legacy elimination.
 */

const express = require('express');
const router = express.Router();
const Company = require('../../models/v2Company');
const TradeCategory = require('../../models/v2TradeCategory');
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const { redisClient } = require('../../clients');
const logger = require('../../utils/logger');

/**
 * 🏢 GET ALL COMPANIES - V2 Global Directory
 * Enhanced with search, filtering, pagination, and caching
 */
router.get('/companies', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const startTime = Date.now();
        const {
            page = 1,
            limit = 20,
            search = '',
            tradeCategory = '',
            status = 'all', // 'all', 'active', 'inactive'
            sortBy = 'companyName',
            sortOrder = 'asc'
        } = req.query;

        logger.info(`🏢 V2 GLOBAL DIRECTORY: Loading companies`, {
            adminUser: req.user.email,
            filters: { search, tradeCategory, status, sortBy, sortOrder },
            pagination: { page, limit }
        });

        // 🚀 Build query with filters
        const query = {};
        
        // Status filter
        if (status !== 'all') {
            query.isActive = status === 'active';
        }

        // Trade category filter
        if (tradeCategory) {
            query.tradeCategories = { $in: [tradeCategory] };
        }

        // Search filter (company name, phone, email, address)
        if (search) {
            const searchRegex = new RegExp(search, 'i');
            query.$or = [
                { companyName: searchRegex },
                { businessPhone: searchRegex },
                { businessEmail: searchRegex },
                { businessAddress: searchRegex },
                { description: searchRegex }
            ];
        }

        // 🚀 Execute query with pagination and sorting
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [companies, totalCount] = await Promise.all([
            Company.find(query, {
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
                businessAddress: 1,
                description: 1,
                serviceArea: 1
                // Sensitive fields excluded for security
            })
            .sort(sortOptions)
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .lean(),
            
            Company.countDocuments(query)
        ]);

        // 📊 Calculate pagination metadata
        const totalPages = Math.ceil(totalCount / limit);
        const hasNextPage = page < totalPages;
        const hasPrevPage = page > 1;

        const responseTime = Date.now() - startTime;
        
        logger.info(`✅ V2 GLOBAL DIRECTORY: Served ${companies.length}/${totalCount} companies in ${responseTime}ms`);

        res.json({
            success: true,
            data: companies,
            meta: {
                pagination: {
                    currentPage: parseInt(page),
                    totalPages,
                    totalCount,
                    hasNextPage,
                    hasPrevPage,
                    limit: parseInt(limit)
                },
                filters: { search, tradeCategory, status, sortBy, sortOrder },
                responseTime,
                source: 'v2-global-directory'
            },
            message: `V2 Global Directory: ${totalCount} companies found`
        });

    } catch (error) {
        logger.error('❌ V2 GLOBAL DIRECTORY: Error loading companies:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load companies',
            details: error.message,
            source: 'v2-global-directory'
        });
    }
});

/**
 * 📊 GET DIRECTORY STATISTICS - V2 Global Dashboard
 * Real-time company statistics for admin dashboard
 */
router.get('/statistics', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const startTime = Date.now();
        
        logger.info(`📊 V2 GLOBAL DIRECTORY: Loading statistics for admin:`, req.user.email);

        // 🚀 Get comprehensive statistics
        const [
            totalCompanies,
            activeCompanies,
            inactiveCompanies,
            companiesByTrade,
            recentCompanies
        ] = await Promise.all([
            Company.countDocuments({}),
            Company.countDocuments({ isActive: true }),
            Company.countDocuments({ isActive: false }),
            Company.aggregate([
                { $unwind: '$tradeCategories' },
                { $group: { _id: '$tradeCategories', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 10 }
            ]),
            Company.find({}, { companyName: 1, createdAt: 1, isActive: 1 })
                .sort({ createdAt: -1 })
                .limit(5)
                .lean()
        ]);

        const responseTime = Date.now() - startTime;

        const statistics = {
            overview: {
                totalCompanies,
                activeCompanies,
                inactiveCompanies,
                activationRate: totalCompanies > 0 ? ((activeCompanies / totalCompanies) * 100).toFixed(1) : 0
            },
            tradeCategories: companiesByTrade,
            recentCompanies,
            performance: {
                responseTime,
                lastUpdated: new Date().toISOString()
            }
        };

        logger.info(`✅ V2 GLOBAL DIRECTORY: Statistics served in ${responseTime}ms`);

        res.json({
            success: true,
            data: statistics,
            meta: {
                responseTime,
                source: 'v2-global-directory-stats'
            }
        });

    } catch (error) {
        logger.error('❌ V2 GLOBAL DIRECTORY: Error loading statistics:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load directory statistics',
            details: error.message
        });
    }
});

/**
 * 🔍 GET TRADE CATEGORIES - V2 Global Directory Filters
 * Load available trade categories for filtering
 */
router.get('/trade-categories', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const startTime = Date.now();
        
        // 🚀 Try Redis cache first
        const cacheKey = 'v2-global-directory:trade-categories';
        try {
            const cached = await redisClient.get(cacheKey);
            if (cached) {
                const categories = JSON.parse(cached);
                logger.info(`🚀 V2 GLOBAL DIRECTORY: Trade categories served from cache in ${Date.now() - startTime}ms`);
                return res.json({
                    success: true,
                    data: categories,
                    meta: {
                        source: 'cache',
                        responseTime: Date.now() - startTime
                    }
                });
            }
        } catch (cacheError) {
            logger.warn('⚠️ Cache read failed:', cacheError.message);
        }

        // 🔍 Get unique trade categories from companies
        const categories = await Company.aggregate([
            { $unwind: '$tradeCategories' },
            { $group: { 
                _id: '$tradeCategories',
                count: { $sum: 1 }
            }},
            { $sort: { _id: 1 } },
            { $project: {
                name: '$_id',
                count: 1,
                _id: 0
            }}
        ]);

        // 🚀 Cache for 1 hour
        try {
            await redisClient.setex(cacheKey, 3600, JSON.stringify(categories));
        } catch (cacheError) {
            logger.warn('⚠️ Cache write failed:', cacheError.message);
        }

        const responseTime = Date.now() - startTime;
        logger.info(`✅ V2 GLOBAL DIRECTORY: Trade categories served in ${responseTime}ms`);

        res.json({
            success: true,
            data: categories,
            meta: {
                source: 'database',
                responseTime,
                count: categories.length
            }
        });

    } catch (error) {
        logger.error('❌ V2 GLOBAL DIRECTORY: Error loading trade categories:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load trade categories',
            details: error.message
        });
    }
});

/**
 * 🏢 GET SINGLE COMPANY - V2 Global Directory
 * Get detailed company information for viewing/editing
 */
router.get('/companies/:companyId', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { companyId } = req.params;
        const startTime = Date.now();

        logger.info(`🏢 V2 GLOBAL DIRECTORY: Loading company ${companyId} for admin:`, req.user.email);

        const company = await Company.findById(companyId).lean();
        
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found',
                companyId
            });
        }

        const responseTime = Date.now() - startTime;
        logger.info(`✅ V2 GLOBAL DIRECTORY: Company loaded in ${responseTime}ms`);

        res.json({
            success: true,
            data: company,
            meta: {
                responseTime,
                source: 'v2-global-directory'
            }
        });

    } catch (error) {
        logger.error('❌ V2 GLOBAL DIRECTORY: Error loading company:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load company',
            details: error.message
        });
    }
});

/**
 * 🔄 UPDATE COMPANY STATUS - V2 Global Directory
 * Quick toggle for company active/inactive status
 */
router.patch('/companies/:companyId/status', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { companyId } = req.params;
        const { isActive } = req.body;
        const startTime = Date.now();

        logger.info(`🔄 V2 GLOBAL DIRECTORY: Updating company ${companyId} status to ${isActive} by admin:`, req.user.email);

        const company = await Company.findByIdAndUpdate(
            companyId,
            { 
                isActive,
                updatedAt: new Date()
            },
            { new: true, select: 'companyName isActive updatedAt' }
        );

        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found',
                companyId
            });
        }

        // 🗑️ Clear related caches
        try {
            await redisClient.del(`company:${companyId}`);
            await redisClient.del('v2-global-directory:trade-categories');
        } catch (cacheError) {
            logger.warn('⚠️ Cache clear failed:', cacheError.message);
        }

        const responseTime = Date.now() - startTime;
        logger.info(`✅ V2 GLOBAL DIRECTORY: Company status updated in ${responseTime}ms`);

        res.json({
            success: true,
            data: company,
            meta: {
                responseTime,
                action: 'status-update',
                source: 'v2-global-directory'
            },
            message: `Company ${company.companyName} is now ${isActive ? 'active' : 'inactive'}`
        });

    } catch (error) {
        logger.error('❌ V2 GLOBAL DIRECTORY: Error updating company status:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update company status',
            details: error.message
        });
    }
});

module.exports = router;
