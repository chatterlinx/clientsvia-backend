/**
 * 📚 KNOWLEDGE MANAGEMENT API - V2 CLEAN VERSION
 * ===============================================
 * V2-grade API endpoints for managing AI agent knowledge base
 * Multi-tenant, Redis-cached, priority-integrated system
 * 
 * 🆕 V2 IMPROVEMENTS:
 * - Fixed legacy placeholder format: {{companyName}} → {companyname}
 * - Fixed legacy placeholder format: {{serviceType}} → {servicetype}
 * - Eliminated all legacy spaghetti code references
 * - Clean, modern placeholder system compatible with V2 runtime
 * 
 * ENDPOINTS:
 * GET    /api/company/:companyId/knowledge-management
 * PUT    /api/company/:companyId/knowledge-management
 * POST   /api/company/:companyId/knowledge-management/company-qna
 * PUT    /api/company/:companyId/knowledge-management/company-qna/:id
 * DELETE /api/company/:companyId/knowledge-management/company-qna/:id
 * POST   /api/company/:companyId/knowledge-management/trade-qna
 * PUT    /api/company/:companyId/knowledge-management/trade-qna/:id
 * DELETE /api/company/:companyId/knowledge-management/trade-qna/:id
 * POST   /api/company/:companyId/knowledge-management/templates
 * PUT    /api/company/:companyId/knowledge-management/templates/:id
 * DELETE /api/company/:companyId/knowledge-management/templates/:id
 * PUT    /api/company/:companyId/knowledge-management/in-house-fallback
 * POST   /api/company/:companyId/knowledge-management/test-ai-agent
 * 
 * FEATURES:
 * - Complete CRUD operations for all knowledge sources
 * - Auto-keyword generation from Q&A content
 * - Real-time AI agent testing integration
 * - Performance tracking and analytics
 * - Priority-aware caching and invalidation
 */

const express = require('express');
const router = express.Router();
const Company = require('../../models/v2Company');
const CompanyKnowledgeQnA = require('../../models/knowledge/CompanyQnA');
const { authenticateJWT } = require('../../middleware/auth');
// V2 DELETED: Legacy v2 aiAgentCacheService - using simple Redis directly
const { redisClient } = require('../../clients');
const logger = require('../../utils/logger');
const Joi = require('joi');
const { v4: uuidv4 } = require('uuid');

// Validation schemas
const companyQnASchema = Joi.object({
    question: Joi.string().required().min(5).max(500).trim(),
    answer: Joi.string().required().min(10).max(2000).trim(),
    keywords: Joi.array().items(Joi.string().trim()).default([]),
    confidence: Joi.number().min(0).max(1).default(0.8),
    status: Joi.string().valid('active', 'inactive', 'draft').default('active'),
    category: Joi.string().trim().default('general')
});

const tradeQnASchema = Joi.object({
    question: Joi.string().required().min(5).max(500).trim(),
    answer: Joi.string().required().min(10).max(2000).trim(),
    tradeCategory: Joi.string().required().trim(),
    difficulty: Joi.string().valid('basic', 'intermediate', 'advanced', 'expert').default('basic'), // Frontend sends this
    keywords: Joi.array().items(Joi.string().trim()).default([]),
    category: Joi.string().trim().default('services'), // Frontend sends this
    companyId: Joi.string().trim(), // Frontend sends this (optional)
    priority: Joi.number().min(1).max(5).default(2), // Frontend sends this
    confidence: Joi.number().min(0).max(1).default(0.75),
    status: Joi.string().valid('active', 'inactive', 'draft').default('active'),
    isGlobal: Joi.boolean().default(false),
    source: Joi.string().valid('company', 'global', 'imported').default('company'),
    updatedAt: Joi.string().isoDate().optional() // Frontend sends this
});

const templateSchema = Joi.object({
    name: Joi.string().required().min(3).max(100).trim(),
    template: Joi.string().required().min(10).max(1000).trim(),
    keywords: Joi.array().items(Joi.string().trim()).default([]),
    category: Joi.string().valid('greeting', 'service', 'booking', 'emergency', 'hours', 'closing').required(),
    confidence: Joi.number().min(0).max(1).default(0.7),
    status: Joi.string().valid('active', 'inactive').default('active'),
    variables: Joi.array().items(Joi.object({
        name: Joi.string().required(),
        description: Joi.string().default(''),
        required: Joi.boolean().default(false)
    })).default([])
});

const inHouseFallbackSchema = Joi.object({
    enabled: Joi.boolean().default(true),
    serviceRequests: Joi.object({
        response: Joi.string().trim().default(''),
        keywords: Joi.array().items(Joi.string().trim()).default([])
    }).default({}),
    bookingRequests: Joi.object({
        response: Joi.string().trim().default(''),
        keywords: Joi.array().items(Joi.string().trim()).default([])
    }).default({}),
    emergencySituations: Joi.object({
        response: Joi.string().trim().default(''),
        keywords: Joi.array().items(Joi.string().trim()).default([])
    }).default({}),
    generalInquiries: Joi.object({
        response: Joi.string().trim().default(''),
        keywords: Joi.array().items(Joi.string().trim()).default([])
    }).default({})
});

const testAIAgentSchema = Joi.object({
    query: Joi.string().required().min(1).max(500),
    testSources: Joi.array().items(Joi.string().valid('companyQnA', 'tradeQnA', 'templates', 'inHouseFallback')).default(['companyQnA', 'tradeQnA', 'templates', 'inHouseFallback']),
    includeInactive: Joi.boolean().default(false),
    showDetails: Joi.boolean().default(true)
});

/**
 * 📚 GET /api/company/:companyId/knowledge-management
 * Retrieve complete knowledge management configuration
 */
router.get('/:companyId/knowledge-management', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;

    try {
        logger.info(`📚 GET knowledge management request for company ${companyId}`);

        // V2 SYSTEM: Simple Redis cache check (no legacy v2 cache service)
        let knowledge = null;
        try {
            const cacheKey = `company:${companyId}:knowledge`;
            const cached = await redisClient.get(cacheKey);
            if (cached) knowledge = JSON.parse(cached);
        } catch (error) {
            logger.warn(`⚠️ V2 Cache check failed for knowledge`, { error: error.message });
        }
        
        if (!knowledge) {
            // Cache miss - load from database
            logger.debug(`📚 V2 Cache miss - loading knowledge from CompanyKnowledgeQnA collection for company ${companyId}`);
            
            const company = await Company.findById(companyId).select('aiAgentLogic.knowledgeManagement').lean();
            
            if (!company) {
                return res.status(404).json({
                    success: false,
                    message: 'Company not found',
                    error: 'COMPANY_NOT_FOUND'
                });
            }

            // V2 FIX: Load Company Q&A from CompanyKnowledgeQnA collection
            const companyQnAs = await CompanyKnowledgeQnA.find({ companyId }).lean();
            
            // Get base knowledge structure from company document (for tradeQnA, templates, etc.)
            knowledge = company.aiAgentLogic?.knowledgeManagement || getDefaultKnowledgeManagement();
            
            // V2 SYSTEM: Replace embedded companyQnA with collection data
            knowledge.companyQnA = companyQnAs.map(qna => ({
                id: qna._id.toString(),
                question: qna.question,
                answer: qna.answer,
                keywords: qna.keywords,
                confidence: qna.confidence,
                status: qna.status,
                category: qna.category,
                createdAt: qna.createdAt,
                updatedAt: qna.updatedAt
            }));

            // If no knowledge configured, return defaults
            if (!knowledge) {
                knowledge = getDefaultKnowledgeManagement();
                logger.info(`📚 Using default knowledge management for company ${companyId}`);
            }

            // V2 SYSTEM: Simple Redis cache set (no legacy v2 cache service)
            try {
                const cacheKey = `company:${companyId}:knowledge`;
                await redisClient.setex(cacheKey, 1800, JSON.stringify(knowledge)); // 30 min TTL
            } catch (error) {
                logger.warn(`⚠️ V2 Cache set failed for knowledge`, { error: error.message });
            }
        }

        // Calculate statistics
        const statistics = calculateKnowledgeStatistics(knowledge);

        const responseTime = Date.now() - startTime;
        logger.info(`📚 GET knowledge management success for company ${companyId}`, {
            responseTime,
            cached: knowledge.cachedAt ? true : false,
            totalEntries: statistics.totalEntries
        });

        res.json({
            success: true,
            data: {
                ...knowledge,
                statistics
            },
            meta: {
                responseTime,
                cached: knowledge.cachedAt ? true : false,
                version: knowledge.version || 1
            }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ GET knowledge management failed for company ${companyId}`, {
            error: error.message,
            responseTime,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            message: 'Failed to retrieve knowledge management configuration',
            error: 'INTERNAL_SERVER_ERROR',
            meta: { responseTime }
        });
    }
});

/**
 * 📚 PUT /api/company/:companyId/knowledge-management
 * Update complete knowledge management configuration
 */
router.put('/:companyId/knowledge-management', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;

    try {
        logger.info(`📚 PUT knowledge management request for company ${companyId}`);

        // Validate the complete knowledge management structure
        const updateData = {
            ...req.body,
            version: (req.body.version || 0) + 1,
            lastUpdated: new Date(),
            statistics: calculateKnowledgeStatistics(req.body)
        };

        // Update database
        const company = await Company.findByIdAndUpdate(
            companyId,
            {
                $set: {
                    'aiAgentLogic.knowledgeManagement': updateData,
                    updatedAt: new Date()
                }
            },
            { new: true, runValidators: true }
        );

        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found',
                error: 'COMPANY_NOT_FOUND'
            });
        }

        // V2 SYSTEM: Simple Redis cache invalidation and update (no legacy v2 cache service)
        try {
            const cacheKey = `company:${companyId}:knowledge`;
            await redisClient.del(cacheKey); // Invalidate old cache
            await redisClient.setex(cacheKey, 1800, JSON.stringify(updateData)); // Cache new data
        } catch (error) {
            logger.warn(`⚠️ V2 Cache update failed for knowledge`, { error: error.message });
        }

        const responseTime = Date.now() - startTime;
        logger.info(`📚 PUT knowledge management success for company ${companyId}`, {
            responseTime,
            version: updateData.version,
            totalEntries: updateData.statistics.totalEntries
        });

        res.json({
            success: true,
            message: 'Knowledge management configuration updated successfully',
            data: updateData,
            meta: {
                responseTime,
                version: updateData.version,
                cacheInvalidated: true
            }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ PUT knowledge management failed for company ${companyId}`, {
            error: error.message,
            responseTime,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            message: 'Failed to update knowledge management configuration',
            error: 'INTERNAL_SERVER_ERROR',
            meta: { responseTime }
        });
    }
});

/**
 * 📚 GET /api/company/:companyId/knowledge-management/company-qna
 * Get all Company Q&A entries
 */
router.get('/:companyId/knowledge-management/company-qna', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;

    try {
        logger.info(`📚 GET company Q&A request for company ${companyId}`);

        // Load Company Q&A from CompanyKnowledgeQnA collection
        const companyQnAs = await CompanyKnowledgeQnA.find({ companyId }).lean();
        
        const responseTime = Date.now() - startTime;
        logger.info(`📚 GET company Q&A success for company ${companyId}`, { 
            responseTime,
            entriesFound: companyQnAs.length
        });

        res.json({
            success: true,
            message: 'Company Q&A loaded successfully',
            data: companyQnAs,
            meta: {
                responseTime,
                entriesFound: companyQnAs.length,
                collection: 'CompanyKnowledgeQnA'
            }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ GET company Q&A failed for company ${companyId}`, {
            error: error.message,
            responseTime
        });

        res.status(500).json({
            success: false,
            message: 'Failed to load Company Q&A',
            error: error.message,
            meta: { responseTime }
        });
    }
});

/**
 * 📚 POST /api/company/:companyId/knowledge-management/company-qna
 * Create new Company Q&A entry
 */
router.post('/:companyId/knowledge-management/company-qna', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;

    try {
        logger.info(`📚 POST company Q&A request for company ${companyId}`);

        // Validate request body
        const { error, value } = companyQnASchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Invalid Company Q&A data',
                error: 'VALIDATION_ERROR',
                details: error.details
            });
        }

        // V2 FIX: Create Q&A entry in CompanyKnowledgeQnA collection (not embedded)
        const newQnA = new CompanyKnowledgeQnA({
            question: value.question,
            answer: value.answer,
            companyId: companyId,
            category: value.category || 'general',
            status: value.status || 'active',
            confidence: value.confidence || 0.8,
            tradeCategories: value.tradeCategories || [],
            // Keywords will be auto-generated by the model's pre-save middleware
        });

        // Save to CompanyKnowledgeQnA collection with auto-keyword generation
        const savedQnA = await newQnA.save();
        
        // 🚀 OPTIMIZATION: Invalidate keyword cache when Q&A added
        const PriorityDrivenKnowledgeRouter = require('../../services/priorityDrivenKnowledgeRouter');
        const router = new PriorityDrivenKnowledgeRouter();
        router.invalidateKeywordCache(companyId, 'companyQnA');

        // Verify company exists
        const company = await Company.findById(companyId);
        if (!company) {
            // Clean up the created Q&A if company doesn't exist
            await CompanyKnowledgeQnA.findByIdAndDelete(savedQnA._id);
            return res.status(404).json({
                success: false,
                message: 'Company not found',
                error: 'COMPANY_NOT_FOUND'
            });
        }

        // V2 SYSTEM: Simple Redis cache invalidation (no legacy v2 cache service)
        try {
            const cacheKey = `company:${companyId}:knowledge`;
            await redisClient.del(cacheKey);
        } catch (error) {
            logger.warn(`⚠️ V2 Cache invalidation failed`, { error: error.message });
        }

        const responseTime = Date.now() - startTime;
        logger.info(`📚 V2 POST company Q&A success for company ${companyId}`, {
            responseTime,
            qnaId: savedQnA._id,
            keywords: savedQnA.keywords.length,
            collection: 'CompanyKnowledgeQnA'
        });

        res.status(201).json({
            success: true,
            message: 'Company Q&A created successfully in V2 collection',
            data: {
                id: savedQnA._id.toString(),
                question: savedQnA.question,
                answer: savedQnA.answer,
                keywords: savedQnA.keywords,
                confidence: savedQnA.confidence,
                status: savedQnA.status,
                category: savedQnA.category,
                createdAt: savedQnA.createdAt,
                updatedAt: savedQnA.updatedAt
            },
            meta: {
                responseTime,
                autoKeywords: true,
                cacheInvalidated: true,
                storageType: 'CompanyKnowledgeQnA_collection'
            }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ POST company Q&A failed for company ${companyId}`, {
            error: error.message,
            responseTime,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            message: 'Failed to create Company Q&A',
            error: 'INTERNAL_SERVER_ERROR',
            meta: { responseTime }
        });
    }
});

/**
 * 📚 PUT /api/company/:companyId/knowledge-management/company-qna/:id
 * Update existing Company Q&A entry
 */
router.put('/:companyId/knowledge-management/company-qna/:id', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId, id } = req.params;

    try {
        logger.info(`📚 PUT company Q&A request for company ${companyId}, ID ${id}`);

        // Validate request body
        const { error, value } = companyQnASchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Invalid Company Q&A data',
                error: 'VALIDATION_ERROR',
                details: error.details
            });
        }

        // Generate auto-keywords if not provided
        if (value.keywords.length === 0) {
            value.keywords = generateKeywords(value.question + ' ' + value.answer);
        }

        // Update the specific Q&A entry
        const company = await Company.findOneAndUpdate(
            { 
                _id: companyId,
                'aiAgentLogic.knowledgeManagement.companyQnA.id': id
            },
            {
                $set: {
                    'aiAgentLogic.knowledgeManagement.companyQnA.$.question': value.question,
                    'aiAgentLogic.knowledgeManagement.companyQnA.$.answer': value.answer,
                    'aiAgentLogic.knowledgeManagement.companyQnA.$.keywords': value.keywords,
                    'aiAgentLogic.knowledgeManagement.companyQnA.$.confidence': value.confidence,
                    'aiAgentLogic.knowledgeManagement.companyQnA.$.status': value.status,
                    'aiAgentLogic.knowledgeManagement.companyQnA.$.category': value.category,
                    'aiAgentLogic.knowledgeManagement.companyQnA.$.updatedAt': new Date(),
                    'aiAgentLogic.knowledgeManagement.lastUpdated': new Date(),
                    updatedAt: new Date()
                }
            },
            { new: true, runValidators: true }
        );

        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company or Q&A entry not found',
                error: 'NOT_FOUND'
            });
        }

        // Find the updated entry
        const updatedQnA = company.aiAgentLogic.knowledgeManagement.companyQnA.find(qna => qna.id === id);

        // V2 SYSTEM: Simple Redis cache invalidation (no legacy v2 cache service)
        try {
            const cacheKey = `company:${companyId}:knowledge`;
            await redisClient.del(cacheKey);
        } catch (error) {
            logger.warn(`⚠️ V2 Cache invalidation failed`, { error: error.message });
        }

        const responseTime = Date.now() - startTime;
        logger.info(`📚 PUT company Q&A success for company ${companyId}`, {
            responseTime,
            qnaId: id,
            keywords: value.keywords.length
        });

        res.json({
            success: true,
            message: 'Company Q&A updated successfully',
            data: updatedQnA,
            meta: {
                responseTime,
                autoKeywords: value.keywords.length === 0,
                cacheInvalidated: true
            }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ PUT company Q&A failed for company ${companyId}`, {
            error: error.message,
            responseTime,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            message: 'Failed to update Company Q&A',
            error: 'INTERNAL_SERVER_ERROR',
            meta: { responseTime }
        });
    }
});

/**
 * 📚 DELETE /api/company/:companyId/knowledge-management/company-qna/:id
 * Delete Company Q&A entry
 */
router.delete('/:companyId/knowledge-management/company-qna/:id', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId, id } = req.params;

    try {
        logger.info(`📚 DELETE company Q&A request for company ${companyId}, ID ${id}`);

        // Remove the specific Q&A entry
        const company = await Company.findByIdAndUpdate(
            companyId,
            {
                $pull: { 'aiAgentLogic.knowledgeManagement.companyQnA': { id: id } },
                $set: { 
                    'aiAgentLogic.knowledgeManagement.lastUpdated': new Date(),
                    updatedAt: new Date()
                }
            },
            { new: true, runValidators: true }
        );

        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found',
                error: 'COMPANY_NOT_FOUND'
            });
        }

        // V2 SYSTEM: Simple Redis cache invalidation (no legacy v2 cache service)
        try {
            const cacheKey = `company:${companyId}:knowledge`;
            await redisClient.del(cacheKey);
        } catch (error) {
            logger.warn(`⚠️ V2 Cache invalidation failed`, { error: error.message });
        }

        const responseTime = Date.now() - startTime;
        logger.info(`📚 DELETE company Q&A success for company ${companyId}`, {
            responseTime,
            qnaId: id
        });

        res.json({
            success: true,
            message: 'Company Q&A deleted successfully',
            meta: {
                responseTime,
                deletedId: id,
                cacheInvalidated: true
            }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ DELETE company Q&A failed for company ${companyId}`, {
            error: error.message,
            responseTime,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            message: 'Failed to delete Company Q&A',
            error: 'INTERNAL_SERVER_ERROR',
            meta: { responseTime }
        });
    }
});

/**
 * 📚 POST /api/company/:companyId/knowledge-management/trade-qna
 * Create new Trade Q&A entry
 */
router.post('/:companyId/knowledge-management/trade-qna', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;

    try {
        logger.info(`📚 POST trade Q&A request for company ${companyId}`);

        // Validate request body
        const { error, value } = tradeQnASchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Invalid Trade Q&A data',
                error: 'VALIDATION_ERROR',
                details: error.details
            });
        }

        // Generate auto-keywords if not provided
        if (value.keywords.length === 0) {
            value.keywords = generateKeywords(value.question + ' ' + value.answer);
        }

        // Create new Trade Q&A entry
        const newQnA = {
            id: uuidv4(),
            ...value,
            performance: {
                responseTime: 0,
                accuracy: 0,
                usageCount: 0
            },
            createdAt: new Date(),
            updatedAt: new Date(),
            createdBy: 'admin'
        };

        // Add to company's trade Q&A knowledge management
        const company = await Company.findByIdAndUpdate(
            companyId,
            {
                $push: { 'aiAgentLogic.knowledgeManagement.tradeQnA': newQnA },
                $set: { 
                    'aiAgentLogic.knowledgeManagement.lastUpdated': new Date(),
                    updatedAt: new Date()
                }
            },
            { new: true, runValidators: true }
        );

        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found',
                error: 'COMPANY_NOT_FOUND'
            });
        }

        // V2 SYSTEM: Simple Redis cache invalidation (no legacy v2 cache service)
        try {
            const cacheKey = `company:${companyId}:knowledge`;
            await redisClient.del(cacheKey);
        } catch (error) {
            logger.warn(`⚠️ V2 Cache invalidation failed`, { error: error.message });
        }

        const responseTime = Date.now() - startTime;
        logger.info(`📚 Trade Q&A created successfully for company ${companyId} in ${responseTime}ms`);

        res.status(201).json({
            success: true,
            message: 'Trade Q&A created successfully',
            data: newQnA,
            meta: {
                responseTime,
                companyId,
                totalTradeQnAs: company.aiAgentLogic?.knowledgeManagement?.tradeQnA?.length || 0
            }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`📚 Error creating trade Q&A for company ${companyId}:`, error);
        
        res.status(500).json({
            success: false,
            message: 'Failed to create Trade Q&A',
            error: 'INTERNAL_SERVER_ERROR',
            meta: { responseTime }
        });
    }
});

/**
 * 📚 PUT /api/company/:companyId/knowledge-management/trade-qna/:id
 * Update existing Trade Q&A entry
 */
router.put('/:companyId/knowledge-management/trade-qna/:id', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId, id } = req.params;

    try {
        logger.info(`📚 PUT trade Q&A request for company ${companyId}, ID: ${id}`);

        // Validate request body
        const { error, value } = tradeQnASchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Invalid Trade Q&A data',
                error: 'VALIDATION_ERROR',
                details: error.details
            });
        }

        // Generate auto-keywords if not provided
        if (value.keywords.length === 0) {
            value.keywords = generateKeywords(value.question + ' ' + value.answer);
        }

        // Update the Trade Q&A entry
        const updateData = {
            ...value,
            updatedAt: new Date()
        };

        const company = await Company.findOneAndUpdate(
            { 
                _id: companyId,
                'aiAgentLogic.knowledgeManagement.tradeQnA.id': id
            },
            {
                $set: {
                    'aiAgentLogic.knowledgeManagement.tradeQnA.$': {
                        id,
                        ...updateData,
                        performance: {
                            responseTime: 0,
                            accuracy: 0,
                            usageCount: 0
                        },
                        createdBy: 'admin'
                    },
                    'aiAgentLogic.knowledgeManagement.lastUpdated': new Date(),
                    updatedAt: new Date()
                }
            },
            { new: true, runValidators: true }
        );

        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company or Trade Q&A not found',
                error: 'NOT_FOUND'
            });
        }

        // V2 SYSTEM: Simple Redis cache invalidation (no legacy v2 cache service)
        try {
            const cacheKey = `company:${companyId}:knowledge`;
            await redisClient.del(cacheKey);
        } catch (error) {
            logger.warn(`⚠️ V2 Cache invalidation failed`, { error: error.message });
        }

        const responseTime = Date.now() - startTime;
        logger.info(`📚 Trade Q&A updated successfully for company ${companyId} in ${responseTime}ms`);

        const updatedQnA = company.aiAgentLogic?.knowledgeManagement?.tradeQnA?.find(q => q.id === id);

        res.json({
            success: true,
            message: 'Trade Q&A updated successfully',
            data: updatedQnA,
            meta: {
                responseTime,
                companyId,
                totalTradeQnAs: company.aiAgentLogic?.knowledgeManagement?.tradeQnA?.length || 0
            }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`📚 Error updating trade Q&A for company ${companyId}:`, error);
        
        res.status(500).json({
            success: false,
            message: 'Failed to update Trade Q&A',
            error: 'INTERNAL_SERVER_ERROR',
            meta: { responseTime }
        });
    }
});

/**
 * 📚 DELETE /api/company/:companyId/knowledge-management/trade-qna/:id
 * Delete Trade Q&A entry
 */
router.delete('/:companyId/knowledge-management/trade-qna/:id', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId, id } = req.params;

    try {
        logger.info(`📚 DELETE trade Q&A request for company ${companyId}, ID: ${id}`);

        // Remove the Trade Q&A entry
        const company = await Company.findByIdAndUpdate(
            companyId,
            {
                $pull: { 'aiAgentLogic.knowledgeManagement.tradeQnA': { id } },
                $set: { 
                    'aiAgentLogic.knowledgeManagement.lastUpdated': new Date(),
                    updatedAt: new Date()
                }
            },
            { new: true, runValidators: true }
        );

        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found',
                error: 'COMPANY_NOT_FOUND'
            });
        }

        // V2 SYSTEM: Simple Redis cache invalidation (no legacy v2 cache service)
        try {
            const cacheKey = `company:${companyId}:knowledge`;
            await redisClient.del(cacheKey);
        } catch (error) {
            logger.warn(`⚠️ V2 Cache invalidation failed`, { error: error.message });
        }

        const responseTime = Date.now() - startTime;
        logger.info(`📚 Trade Q&A deleted successfully for company ${companyId} in ${responseTime}ms`);

        res.json({
            success: true,
            message: 'Trade Q&A deleted successfully',
            meta: {
                responseTime,
                companyId,
                deletedId: id,
                totalTradeQnAs: company.aiAgentLogic?.knowledgeManagement?.tradeQnA?.length || 0
            }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`📚 Error deleting trade Q&A for company ${companyId}:`, error);
        
        res.status(500).json({
            success: false,
            message: 'Failed to delete Trade Q&A',
            error: 'INTERNAL_SERVER_ERROR',
            meta: { responseTime }
        });
    }
});

/**
 * 📚 POST /api/company/:companyId/knowledge-management/test-ai-agent
 * Test AI agent with current knowledge base
 */
router.post('/:companyId/knowledge-management/test-ai-agent', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;

    try {
        logger.info(`📚 POST test AI agent request for company ${companyId}`);

        // Validate request body
        const { error, value } = testAIAgentSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Invalid test request',
                error: 'VALIDATION_ERROR',
                details: error.details
            });
        }

        const { query, testSources, includeInactive, showDetails } = value;

        // V2 SYSTEM: Simple Redis cache check (no legacy v2 cache service)
        let knowledge = null;
        try {
            const cacheKey = `company:${companyId}:knowledge`;
            const cached = await redisClient.get(cacheKey);
            if (cached) knowledge = JSON.parse(cached);
        } catch (error) {
            logger.warn(`⚠️ V2 Cache check failed for knowledge`, { error: error.message });
        }
        
        if (!knowledge) {
            const company = await Company.findById(companyId).select('aiAgentLogic.knowledgeManagement').lean();
            if (!company) {
                return res.status(404).json({
                    success: false,
                    message: 'Company not found',
                    error: 'COMPANY_NOT_FOUND'
                });
            }
            knowledge = company.aiAgentLogic?.knowledgeManagement || getDefaultKnowledgeManagement();
        }

        // Simulate AI agent testing
        const testResults = await simulateAIAgentTest(companyId, query, knowledge, {
            testSources,
            includeInactive,
            showDetails
        });

        const responseTime = Date.now() - startTime;
        logger.info(`📚 POST test AI agent success for company ${companyId}`, {
            responseTime,
            query: query.substring(0, 50),
            sourcesMatched: testResults.matches?.length || 0
        });

        res.json({
            success: true,
            message: 'AI agent test completed',
            data: {
                query,
                ...testResults,
                testConfig: {
                    testSources,
                    includeInactive,
                    showDetails
                }
            },
            meta: {
                responseTime,
                totalTestTime: testResults.totalTestTime || responseTime
            }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ POST test AI agent failed for company ${companyId}`, {
            error: error.message,
            responseTime,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            message: 'Failed to test AI agent',
            error: 'INTERNAL_SERVER_ERROR',
            meta: { responseTime }
        });
    }
});

/**
 * 📋 PUT /api/company/:companyId/knowledge-management/in-house-fallback
 * Update in-house fallback configuration
 */
router.put('/:companyId/knowledge-management/in-house-fallback', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;

    try {
        logger.info(`📋 PUT in-house fallback request for company ${companyId}`);

        // Validate request body
        const { error, value } = inHouseFallbackSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Invalid in-house fallback data',
                error: 'VALIDATION_ERROR',
                details: error.details
            });
        }

        // Update company's in-house fallback configuration
        const company = await Company.findByIdAndUpdate(
            companyId,
            {
                $set: {
                    'aiAgentLogic.knowledgeManagement.inHouseFallback': value,
                    'aiAgentLogic.lastUpdated': new Date()
                }
            },
            { new: true, runValidators: true }
        ).select('aiAgentLogic.knowledgeManagement.inHouseFallback');

        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found',
                error: 'COMPANY_NOT_FOUND'
            });
        }

        // Clear cache
        try {
            if (redisClient && redisClient.isReady) {
                const cacheKey = `knowledge:${companyId}`;
                await redisClient.del(cacheKey);
                logger.info(`🗑️ Cache cleared for company ${companyId} after fallback update`);
            }
        } catch (error) {
            logger.warn(`⚠️ Cache clear failed after fallback update`, { error: error.message });
        }

        const responseTime = Date.now() - startTime;
        logger.info(`📋 PUT in-house fallback success for company ${companyId}`, { responseTime });

        res.json({
            success: true,
            message: 'In-house fallback configuration updated successfully',
            data: company.aiAgentLogic.knowledgeManagement.inHouseFallback,
            meta: {
                responseTime,
                cacheCleared: true
            }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ PUT in-house fallback failed for company ${companyId}`, {
            error: error.message,
            responseTime
        });

        res.status(500).json({
            success: false,
            message: 'Failed to update in-house fallback configuration',
            error: error.message,
            meta: { responseTime }
        });
    }
});

/**
 * 🛠️ UTILITY FUNCTIONS
 */

/**
 * Get default knowledge management configuration
 * @returns {Object} Default knowledge management configuration
 */
function getDefaultKnowledgeManagement() {
    return {
        version: 1,
        lastUpdated: new Date(),
        companyQnA: [],
        tradeQnA: [],
        templates: getDefaultTemplates(),
        inHouseFallback: {
            enabled: true,
            serviceRequests: {
                response: 'I understand you need service. Let me connect you with one of our technicians who can help you right away.',
                keywords: ['service', 'repair', 'fix', 'broken', 'problem', 'issue', 'help', 'maintenance']
            },
            bookingRequests: {
                response: 'I\'d be happy to help you schedule an appointment. Let me connect you with our scheduling team.',
                keywords: ['appointment', 'schedule', 'book', 'visit', 'come out', 'when can you', 'available']
            },
            emergencySituations: {
                response: 'This sounds urgent. Let me connect you with our emergency team immediately.',
                keywords: ['emergency', 'urgent', 'asap', 'right now', 'immediately', 'broken down']
            },
            generalInquiries: {
                response: 'Thank you for calling. Let me connect you with someone who can help you right away.',
                keywords: ['hours', 'open', 'closed', 'when do you', 'what time', 'available', 'info', 'contact']
            },
            performance: {
                totalFallbacks: 0,
                successRate: 0,
                avgConfidence: 0.5
            }
        },
        statistics: {
            totalEntries: 0,
            activeEntries: 0,
            avgConfidence: 0,
            lastOptimized: new Date()
        }
    };
}

/**
 * Get default templates
 * @returns {Array} Default template configurations
 */
function getDefaultTemplates() {
    return [
        {
            id: uuidv4(),
            name: 'Standard Greeting',
            template: 'Thanks for calling {companyname}! How can I help you today?',
            keywords: ['hello', 'hi', 'greeting'],
            category: 'greeting',
            confidence: 0.8,
            status: 'active',
            variables: [
                { name: 'companyname', description: 'Company name', required: true }
            ],
            performance: { usageCount: 0 },
            createdAt: new Date(),
            updatedAt: new Date()
        },
        {
            id: uuidv4(),
            name: 'Service Request',
            template: 'I understand you need {servicetype} service. Let me help you with that right away.',
            keywords: ['service', 'repair', 'fix'],
            category: 'service',
            confidence: 0.75,
            status: 'active',
            variables: [
                { name: 'servicetype', description: 'Type of service needed', required: false }
            ],
            performance: { usageCount: 0 },
            createdAt: new Date(),
            updatedAt: new Date()
        }
    ];
}

/**
 * Calculate knowledge management statistics
 * @param {Object} knowledge - Knowledge management object
 * @returns {Object} Statistics object
 */
function calculateKnowledgeStatistics(knowledge) {
    if (!knowledge) return { totalEntries: 0, activeEntries: 0, avgConfidence: 0 };

    const companyQnACount = knowledge.companyQnA?.length || 0;
    const tradeQnACount = knowledge.tradeQnA?.length || 0;
    const templatesCount = knowledge.templates?.length || 0;
    
    const totalEntries = companyQnACount + tradeQnACount + templatesCount;
    
    const activeCompanyQnA = knowledge.companyQnA?.filter(q => q.status === 'active').length || 0;
    const activeTradeQnA = knowledge.tradeQnA?.filter(q => q.status === 'active').length || 0;
    const activeTemplates = knowledge.templates?.filter(t => t.status === 'active').length || 0;
    
    const activeEntries = activeCompanyQnA + activeTradeQnA + activeTemplates;
    
    // Calculate average confidence
    let totalConfidence = 0;
    let confidenceCount = 0;
    
    if (knowledge.companyQnA) {
        knowledge.companyQnA.forEach(q => {
            totalConfidence += q.confidence || 0.8;
            confidenceCount++;
        });
    }
    
    if (knowledge.tradeQnA) {
        knowledge.tradeQnA.forEach(q => {
            totalConfidence += q.confidence || 0.75;
            confidenceCount++;
        });
    }
    
    if (knowledge.templates) {
        knowledge.templates.forEach(t => {
            totalConfidence += t.confidence || 0.7;
            confidenceCount++;
        });
    }
    
    const avgConfidence = confidenceCount > 0 ? totalConfidence / confidenceCount : 0;

    return {
        totalEntries,
        activeEntries,
        avgConfidence: Math.round(avgConfidence * 100) / 100,
        breakdown: {
            companyQnA: { total: companyQnACount, active: activeCompanyQnA },
            tradeQnA: { total: tradeQnACount, active: activeTradeQnA },
            templates: { total: templatesCount, active: activeTemplates }
        },
        lastCalculated: new Date()
    };
}

/**
 * Generate keywords from text content
 * @param {string} text - Text to extract keywords from
 * @returns {Array} Array of keywords
 */
function generateKeywords(text) {
    if (!text) return [];
    
    // Simple keyword extraction (in production, this could use NLP libraries)
    const words = text.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 3)
        .filter(word => !['this', 'that', 'with', 'have', 'will', 'from', 'they', 'been', 'said', 'each', 'which', 'their', 'time', 'would', 'there', 'could', 'other'].includes(word));
    
    // Get unique words and limit to top 10
    const uniqueWords = [...new Set(words)];
    return uniqueWords.slice(0, 10);
}

/**
 * Simulate AI agent testing
 * @param {string} companyId - Company identifier
 * @param {string} query - Test query
 * @param {Object} knowledge - Knowledge management object
 * @param {Object} options - Test options
 * @returns {Object} Test results
 */
async function simulateAIAgentTest(companyId, query, knowledge, options) {
    const startTime = Date.now();
    const matches = [];

    try {
        const queryLower = query.toLowerCase();

        // Test Company Q&A
        if (options.testSources.includes('companyQnA') && knowledge.companyQnA) {
            knowledge.companyQnA.forEach(qna => {
                if (!options.includeInactive && qna.status !== 'active') return;
                
                const confidence = calculateMatchConfidence(queryLower, qna.question.toLowerCase(), qna.keywords);
                if (confidence > 0.3) {
                    matches.push({
                        source: 'companyQnA',
                        type: 'Company Q&A',
                        id: qna.id,
                        question: qna.question,
                        answer: qna.answer,
                        confidence: confidence,
                        threshold: 0.8,
                        match: confidence >= 0.8,
                        keywords: qna.keywords
                    });
                }
            });
        }

        // Test Trade Q&A
        if (options.testSources.includes('tradeQnA') && knowledge.tradeQnA) {
            knowledge.tradeQnA.forEach(qna => {
                if (!options.includeInactive && qna.status !== 'active') return;
                
                const confidence = calculateMatchConfidence(queryLower, qna.question.toLowerCase(), qna.keywords);
                if (confidence > 0.3) {
                    matches.push({
                        source: 'tradeQnA',
                        type: 'Trade Q&A',
                        id: qna.id,
                        question: qna.question,
                        answer: qna.answer,
                        confidence: confidence,
                        threshold: 0.75,
                        match: confidence >= 0.75,
                        tradeCategory: qna.tradeCategory,
                        keywords: qna.keywords
                    });
                }
            });
        }

        // Test Templates
        if (options.testSources.includes('templates') && knowledge.templates) {
            knowledge.templates.forEach(template => {
                if (!options.includeInactive && template.status !== 'active') return;
                
                const confidence = calculateMatchConfidence(queryLower, template.name.toLowerCase(), template.keywords);
                if (confidence > 0.3) {
                    matches.push({
                        source: 'templates',
                        type: 'Template',
                        id: template.id,
                        name: template.name,
                        template: template.template,
                        confidence: confidence,
                        threshold: 0.7,
                        match: confidence >= 0.7,
                        category: template.category,
                        keywords: template.keywords
                    });
                }
            });
        }

        // Test In-House Fallback
        if (options.testSources.includes('inHouseFallback') && knowledge.inHouseFallback?.enabled) {
            const fallback = knowledge.inHouseFallback;
            let fallbackMatch = null;
            let maxConfidence = 0;

            // Check each keyword category using V2 structure
            const categoryMappings = {
                'serviceRequests': 'service',
                'bookingRequests': 'booking', 
                'emergencySituations': 'emergency',
                'generalInquiries': 'general'
            };
            
            Object.keys(categoryMappings).forEach(categoryKey => {
                const categoryData = fallback[categoryKey];
                if (categoryData && categoryData.keywords) {
                    const confidence = calculateKeywordMatch(queryLower, categoryData.keywords);
                    if (confidence > maxConfidence) {
                        maxConfidence = confidence;
                        fallbackMatch = {
                            source: 'inHouseFallback',
                            type: 'In-House Fallback',
                            category: categoryMappings[categoryKey],
                            response: categoryData.response || 'Thank you for contacting us. Let me connect you with someone who can help you right away.',
                            confidence: confidence,
                            threshold: 0.5,
                            match: confidence >= 0.5,
                            keywords: categoryData.keywords
                        };
                    }
                }
            });

            if (fallbackMatch && maxConfidence > 0.3) {
                matches.push(fallbackMatch);
            }
        }

        // Sort matches by confidence
        matches.sort((a, b) => b.confidence - a.confidence);

        const totalTestTime = Date.now() - startTime;
        const bestMatch = matches.find(m => m.match);

        return {
            matches: options.showDetails ? matches : matches.filter(m => m.match),
            bestMatch: bestMatch || null,
            totalMatches: matches.length,
            successfulMatches: matches.filter(m => m.match).length,
            totalTestTime: `${totalTestTime}ms`,
            recommendation: bestMatch ? 
                `Best match found in ${bestMatch.source} with ${Math.round(bestMatch.confidence * 100)}% confidence` :
                'No matches found above threshold. Consider adding this query to your knowledge base.'
        };

    } catch (error) {
        logger.error(`❌ AI agent test simulation failed for company ${companyId}`, error);
        return {
            matches: [],
            bestMatch: null,
            totalMatches: 0,
            successfulMatches: 0,
            totalTestTime: `${Date.now() - startTime}ms`,
            error: error.message
        };
    }
}

/**
 * Calculate match confidence between query and content
 * @param {string} query - Search query (lowercase)
 * @param {string} content - Content to match against (lowercase)
 * @param {Array} keywords - Keywords array
 * @returns {number} Confidence score (0-1)
 */
function calculateMatchConfidence(query, content, keywords = []) {
    let confidence = 0;
    
    // Enhanced query processing - remove common words
    const commonWords = ['how', 'what', 'when', 'where', 'why', 'do', 'does', 'is', 'are', 'can', 'will', 'the', 'a', 'an', 'and', 'or', 'but'];
    const queryWords = query.split(/\s+/).filter(word => word.length > 2 && !commonWords.includes(word));
    const contentWords = content.split(/\s+/).filter(word => word.length > 2);
    
    // 1. Direct phrase matching (highest confidence)
    if (content.includes(query)) {
        confidence += 0.9;
    }
    
    // 2. Semantic word matching (improved algorithm)
    if (queryWords.length > 0) {
        const exactMatches = queryWords.filter(word => contentWords.includes(word));
        const partialMatches = queryWords.filter(word => 
            contentWords.some(contentWord => 
                contentWord.includes(word) || word.includes(contentWord)
            )
        );
        
        const wordMatchScore = (exactMatches.length * 1.0 + partialMatches.length * 0.5) / queryWords.length;
        confidence += wordMatchScore * 0.7;
    }
    
    // 3. Enhanced keyword matching
    if (keywords && keywords.length > 0) {
        let keywordScore = 0;
        
        // Direct keyword matches
        const directMatches = keywords.filter(keyword => 
            query.includes(keyword.toLowerCase()) || keyword.toLowerCase().includes(query)
        );
        keywordScore += directMatches.length * 0.3;
        
        // Partial keyword matches
        const partialMatches = keywords.filter(keyword => {
            const keywordLower = keyword.toLowerCase();
            return queryWords.some(word => 
                keywordLower.includes(word) || word.includes(keywordLower)
            );
        });
        keywordScore += partialMatches.length * 0.2;
        
        // Intent-based matching for common service queries
        const serviceIntents = ['cost', 'price', 'pricing', 'fee', 'charge', 'rate', 'much', 'expensive', 'cheap'];
        const hasServiceIntent = queryWords.some(word => serviceIntents.includes(word));
        const hasServiceKeywords = keywords.some(keyword => serviceIntents.includes(keyword.toLowerCase()));
        
        if (hasServiceIntent && hasServiceKeywords) {
            keywordScore += 0.4; // Boost for service pricing queries
        }
        
        confidence += Math.min(keywordScore, 0.6);
    }
    
    // 4. Boost for common business queries
    const businessBoosts = {
        'service': ['service', 'repair', 'fix', 'maintenance'],
        'pricing': ['cost', 'price', 'pricing', 'fee', 'charge', 'rate', 'much'],
        'booking': ['appointment', 'schedule', 'book', 'visit'],
        'emergency': ['emergency', 'urgent', 'asap', 'immediate']
    };
    
    for (const [category, boostWords] of Object.entries(businessBoosts)) {
        if (queryWords.some(word => boostWords.includes(word))) {
            if (keywords.some(keyword => boostWords.includes(keyword.toLowerCase()))) {
                confidence += 0.15; // Business context boost
                break;
            }
        }
    }
    
    return Math.min(confidence, 1.0);
}

/**
 * Calculate keyword match confidence
 * @param {string} query - Search query (lowercase)
 * @param {Array} keywords - Keywords to match against
 * @returns {number} Confidence score (0-1)
 */
function calculateKeywordMatch(query, keywords) {
    if (!keywords || keywords.length === 0) return 0;
    
    const matches = keywords.filter(keyword => 
        query.includes(keyword.toLowerCase()) || keyword.toLowerCase().includes(query)
    );
    
    return matches.length > 0 ? Math.min(matches.length / keywords.length + 0.3, 1.0) : 0;
}

/**
 * 🤖 AI Q&A Generation Endpoint
 * POST /api/company/:companyId/knowledge-management/generate-qna
 */
router.post('/:companyId/knowledge-management/generate-qna', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;
    const { businessType, description } = req.body;

    try {
        logger.info(`🤖 AI Q&A generation request for company ${companyId}`);

        if (!businessType || !description) {
            return res.status(400).json({
                success: false,
                message: 'Business type and description are required',
                error: 'MISSING_REQUIRED_FIELDS'
            });
        }

        // Generate AI Q&A entries
        const generatedQnA = await generateSmartQnA(businessType, description);

        const responseTime = Date.now() - startTime;
        logger.info(`🤖 AI Q&A generation success for company ${companyId}`, { 
            responseTime,
            entriesGenerated: generatedQnA.length
        });

        res.json({
            success: true,
            message: 'AI Q&A generated successfully',
            data: generatedQnA,
            meta: {
                responseTime,
                entriesGenerated: generatedQnA.length
            }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ AI Q&A generation failed for company ${companyId}`, {
            error: error.message,
            responseTime
        });

        res.status(500).json({
            success: false,
            message: 'Failed to generate AI Q&A',
            error: error.message,
            meta: { responseTime }
        });
    }
});

/**
 * 🤖 AI Role Generation Endpoint
 * POST /api/company/:companyId/knowledge-management/generate-role
 */
router.post('/:companyId/knowledge-management/generate-role', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;
    const { businessType, rawRole } = req.body;

    try {
        logger.info(`🤖 AI Role generation request for company ${companyId}`);

        if (!businessType || !rawRole) {
            return res.status(400).json({
                success: false,
                message: 'Business type and raw role are required',
                error: 'MISSING_REQUIRED_FIELDS'
            });
        }

        // Generate AI role description
        const polishedRole = await generateSmartRole(businessType, rawRole);

        const responseTime = Date.now() - startTime;
        logger.info(`🤖 AI Role generation success for company ${companyId}`, { responseTime });

        res.json({
            success: true,
            message: 'AI role generated successfully',
            data: { polishedRole },
            meta: { responseTime }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ AI Role generation failed for company ${companyId}`, {
            error: error.message,
            responseTime
        });

        res.status(500).json({
            success: false,
            message: 'Failed to generate AI role',
            error: error.message,
            meta: { responseTime }
        });
    }
});

/**
 * 🤖 Smart Q&A Generator (In-House AI)
 */
async function generateSmartQnA(businessType, description) {
    // In-house AI generation logic
    const qnaTemplates = getQnATemplatesForBusiness(businessType);
    const generatedEntries = [];

    // Parse description for key information
    const keyInfo = extractKeyInformation(description);
    
    // Generate relevant Q&A entries
    for (const template of qnaTemplates) {
        if (isRelevantTemplate(template, keyInfo)) {
            const qna = {
                question: personalizeQuestion(template.question, businessType, keyInfo),
                answer: personalizeAnswer(template.answer, businessType, keyInfo, description),
                keywords: generateKeywords(template.question, template.answer, businessType)
            };
            generatedEntries.push(qna);
        }
    }

    return generatedEntries;
}

/**
 * 🤖 Smart Role Generator (In-House AI)
 */
async function generateSmartRole(businessType, rawRole) {
    // Professional role templates
    const roleTemplates = {
        'hvac': 'professional HVAC technician and customer service representative',
        'plumbing': 'experienced plumbing professional and customer service specialist',
        'electrical': 'certified electrician and customer service expert',
        'dental': 'dental office receptionist and patient care coordinator',
        'auto': 'automotive service advisor and customer care specialist',
        'general': 'skilled contractor and customer service professional'
    };

    // Determine business category
    const category = determineBusinessCategory(businessType);
    const baseRole = roleTemplates[category] || roleTemplates['general'];

    // Generate polished role
    const polishedRole = `I am a ${baseRole} for ${businessType}. ${rawRole} I provide helpful, accurate information about our services, scheduling, pricing, and policies. I maintain a professional, friendly tone while ensuring customers receive the information they need to make informed decisions about our services.`;

    return polishedRole;
}

/**
 * 📋 Get Q&A Templates for Business Type
 */
function getQnATemplatesForBusiness(businessType) {
    const templates = [
        {
            question: "What are your hours of operation?",
            answer: "Our business hours are [HOURS]. We also offer [EMERGENCY_SERVICE] for urgent situations.",
            keywords: ["hours", "open", "closed", "schedule", "time", "when", "availability"]
        },
        {
            question: "Do you offer emergency services?",
            answer: "Yes, we provide 24/7 emergency services for urgent situations. Emergency service rates may apply.",
            keywords: ["emergency", "urgent", "24/7", "after hours", "weekend", "holiday"]
        },
        {
            question: "What areas do you serve?",
            answer: "We serve [SERVICE_AREA] and surrounding areas. Contact us to confirm service availability in your location.",
            keywords: ["area", "location", "serve", "coverage", "where", "distance", "travel"]
        },
        {
            question: "Do you provide free estimates?",
            answer: "Yes, we offer free estimates for most services. Contact us to schedule your free consultation.",
            keywords: ["estimate", "quote", "free", "cost", "price", "consultation", "evaluation"]
        },
        {
            question: "Are you licensed and insured?",
            answer: "Yes, we are fully licensed and insured for your protection and peace of mind.",
            keywords: ["licensed", "insured", "certified", "bonded", "qualified", "credentials"]
        }
    ];

    return templates;
}

/**
 * 🔍 Extract Key Information from Description
 */
function extractKeyInformation(description) {
    const keyInfo = {
        hours: null,
        emergency: false,
        freeEstimates: false,
        serviceArea: null
    };

    // Extract hours
    const hoursMatch = description.match(/(\d{1,2})-(\d{1,2})|(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/i);
    if (hoursMatch) {
        keyInfo.hours = hoursMatch[0];
    }

    // Check for emergency service
    if (/emergency|24\/7|after hours/i.test(description)) {
        keyInfo.emergency = true;
    }

    // Check for free estimates
    if (/free estimate|free consultation|no charge/i.test(description)) {
        keyInfo.freeEstimates = true;
    }

    return keyInfo;
}

/**
 * ✅ Check if Template is Relevant
 */
function isRelevantTemplate(template, keyInfo) {
    // Always include hours template
    if (template.question.includes("hours")) return true;
    
    // Include emergency template if mentioned
    if (template.question.includes("emergency") && keyInfo.emergency) return true;
    
    // Include estimate template if mentioned
    if (template.question.includes("estimate") && keyInfo.freeEstimates) return true;
    
    // Include licensing template (always relevant)
    if (template.question.includes("licensed")) return true;
    
    return false;
}

/**
 * 🎯 Personalize Question
 */
function personalizeQuestion(question, businessType, keyInfo) {
    return question; // Questions are already generic enough
}

/**
 * 🎯 Personalize Answer
 */
function personalizeAnswer(answer, businessType, keyInfo, description) {
    let personalizedAnswer = answer;

    // Replace placeholders with actual information
    if (keyInfo.hours) {
        personalizedAnswer = personalizedAnswer.replace('[HOURS]', keyInfo.hours);
    } else {
        personalizedAnswer = personalizedAnswer.replace('[HOURS]', 'Monday through Friday 8 AM to 5 PM');
    }

    if (keyInfo.emergency) {
        personalizedAnswer = personalizedAnswer.replace('[EMERGENCY_SERVICE]', '24/7 emergency service');
    } else {
        personalizedAnswer = personalizedAnswer.replace('[EMERGENCY_SERVICE]', 'emergency service availability');
    }

    personalizedAnswer = personalizedAnswer.replace('[SERVICE_AREA]', 'our local area');

    return personalizedAnswer;
}

/**
 * 🏷️ Generate Keywords
 */
function generateKeywords(question, answer, businessType) {
    const baseKeywords = [];
    
    // Extract keywords from question and answer
    const text = `${question} ${answer}`.toLowerCase();
    const words = text.match(/\b\w{3,}\b/g) || [];
    
    // Add relevant keywords
    words.forEach(word => {
        if (!['the', 'and', 'for', 'are', 'you', 'our', 'we', 'your', 'can', 'will', 'may'].includes(word)) {
            if (!baseKeywords.includes(word)) {
                baseKeywords.push(word);
            }
        }
    });

    return baseKeywords.slice(0, 8); // Limit to 8 keywords
}

/**
 * 🏢 Determine Business Category
 */
function determineBusinessCategory(businessType) {
    const type = businessType.toLowerCase();
    
    if (type.includes('hvac')) return 'hvac';
    if (type.includes('plumb')) return 'plumbing';
    if (type.includes('electric')) return 'electrical';
    if (type.includes('dental')) return 'dental';
    if (type.includes('auto')) return 'auto';
    
    return 'general';
}

module.exports = router;
