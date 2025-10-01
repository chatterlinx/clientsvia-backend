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
 * V2 DELETED: Old flat Company Q&A GET endpoint
 * Now using category-based endpoint at line ~2045
 */

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
        const PriorityDrivenKnowledgeRouter = require('../../services/v2priorityDrivenKnowledgeRouter');
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

        // V2 FIX: Delete from CompanyKnowledgeQnA collection (not embedded array)
        const deletedQnA = await CompanyKnowledgeQnA.findByIdAndDelete(id);

        if (!deletedQnA) {
            return res.status(404).json({
                success: false,
                message: 'Company Q&A not found',
                error: 'QNA_NOT_FOUND'
            });
        }

        // Verify the Q&A belonged to this company (security check)
        if (deletedQnA.companyId.toString() !== companyId) {
            // Restore the deleted Q&A (shouldn't happen with proper auth, but safety first)
            await CompanyKnowledgeQnA.create(deletedQnA);
            return res.status(403).json({
                success: false,
                message: 'Unauthorized: Q&A belongs to different company',
                error: 'UNAUTHORIZED'
            });
        }

        // Update company knowledge management lastUpdated timestamp
        await Company.findByIdAndUpdate(
            companyId,
            {
                $set: { 
                    'aiAgentLogic.knowledgeManagement.lastUpdated': new Date(),
                    updatedAt: new Date()
                }
            },
            { runValidators: true }
        );

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
    let { businessType, description } = req.body;
    
    // If no businessType provided, default to 'general'
    if (!businessType) {
        businessType = 'general';
    }

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

        // 🎯 AUTO-SAVE: Save generated Q&As directly to CompanyKnowledgeQnA collection
        const savedQnAs = [];
        for (const qna of generatedQnA) {
            const newQnA = new CompanyKnowledgeQnA({
                companyId,
                question: qna.question,
                answer: qna.answer,
                keywords: qna.keywords || [],
                confidence: 0.8,
                status: 'active',
                category: 'general',
                autoGenerated: true
            });
            const saved = await newQnA.save();
            savedQnAs.push({
                id: saved._id.toString(),
                ...qna
            });
        }

        // Update company knowledge management timestamp
        await Company.findByIdAndUpdate(
            companyId,
            {
                $set: { 
                    'aiAgentLogic.knowledgeManagement.lastUpdated': new Date(),
                    updatedAt: new Date()
                }
            },
            { runValidators: true }
        );

        // Invalidate Redis cache
        try {
            const cacheKey = `company:${companyId}:knowledge`;
            await redisClient.del(cacheKey);
        } catch (error) {
            logger.warn(`⚠️ V2 Cache invalidation failed`, { error: error.message });
        }

        const responseTime = Date.now() - startTime;
        logger.info(`🤖 AI Q&A generation and auto-save success for company ${companyId}`, { 
            responseTime,
            entriesGenerated: savedQnAs.length
        });

        res.json({
            success: true,
            message: `AI Q&A generated and saved successfully! Created ${savedQnAs.length} entries.`,
            data: savedQnAs,
            meta: {
                responseTime,
                entriesGenerated: savedQnAs.length,
                autoSaved: true
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
 * ✨ FOCUSED GENERATION: Creates targeted Q&As based on admin input
 */
async function generateSmartQnA(businessType, description) {
    const generatedEntries = [];
    
    // Parse what the admin typed to understand the intent
    const descriptionLower = description.toLowerCase();
    
    // 🎯 SMART DETECTION: Figure out what the admin is trying to add
    const detectedTopics = [];
    
    // Service Area Detection
    if (descriptionLower.match(/service|serve|area|county|city|location|miles|radius|cover/i)) {
        detectedTopics.push({
            type: 'serviceArea',
            question: "What areas do you service?",
            answer: description.trim(),
            keywords: ['area', 'location', 'service', 'serve', 'where', 'coverage', 'distance', 'travel']
        });
    }
    
    // Hours Detection
    if (descriptionLower.match(/hour|open|close|monday|tuesday|wednesday|thursday|friday|saturday|sunday|am|pm|24\/7/i)) {
        detectedTopics.push({
            type: 'hours',
            question: "What are your hours of operation?",
            answer: description.trim(),
            keywords: ['hours', 'open', 'closed', 'schedule', 'time', 'when', 'availability', 'monday', 'friday']
        });
    }
    
    // Emergency Service Detection
    if (descriptionLower.match(/emergency|24\/7|urgent|after hours|weekend|night/i)) {
        detectedTopics.push({
            type: 'emergency',
            question: "Do you offer emergency services?",
            answer: description.trim(),
            keywords: ['emergency', 'urgent', '24/7', 'after hours', 'weekend', 'night', 'immediate']
        });
    }
    
    // Pricing Detection
    if (descriptionLower.match(/cost|price|pricing|fee|charge|\$|dollar|estimate|quote/i)) {
        detectedTopics.push({
            type: 'pricing',
            question: "What are your pricing and service fees?",
            answer: description.trim(),
            keywords: ['cost', 'price', 'pricing', 'fee', 'charge', 'estimate', 'quote', 'how much']
        });
    }
    
    // Insurance/Payment Detection
    if (descriptionLower.match(/insurance|payment|accept|visa|mastercard|card|cash|check|financing/i)) {
        detectedTopics.push({
            type: 'payment',
            question: "What payment methods do you accept?",
            answer: description.trim(),
            keywords: ['payment', 'insurance', 'accept', 'visa', 'mastercard', 'cash', 'check', 'financing']
        });
    }
    
    // Brands/Equipment Detection
    if (descriptionLower.match(/brand|equipment|install|carry|trane|carrier|lennox|rheem|goodman/i)) {
        detectedTopics.push({
            type: 'brands',
            question: "What brands or equipment do you work with?",
            answer: description.trim(),
            keywords: ['brand', 'equipment', 'install', 'carry', 'model', 'manufacturer']
        });
    }
    
    // 🎯 IF NOTHING DETECTED: Create a general Q&A from the description
    if (detectedTopics.length === 0) {
        // Try to extract the key topic from the description
        const words = description.trim().split(' ');
        const firstFewWords = words.slice(0, 3).join(' ');
        
        generatedEntries.push({
            question: `Tell me about ${firstFewWords}`,
            answer: description.trim(),
            keywords: extractKeywords(description)
        });
    } else {
        // Add only the detected topics
        generatedEntries.push(...detectedTopics);
    }
    
    return generatedEntries;
}

/**
 * 🔑 Extract Keywords from Text
 */
function extractKeywords(text) {
    // Remove common words and extract meaningful keywords
    const commonWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'we', 'our', 'your', 'are', 'is'];
    const words = text.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 2 && !commonWords.includes(word));
    
    // Return unique keywords
    return [...new Set(words)].slice(0, 10);
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

    // ✅ FIXED: Use the user's raw role input directly, don't add generic contractor language
    const polishedRole = `I am a ${baseRole} for ${businessType}. ${rawRole} I provide helpful, accurate information about our services, scheduling, and policies. I maintain a professional, friendly tone while ensuring customers receive the information they need.`;

    return polishedRole;
}

/**
 * 📋 Get Q&A Templates for Business Type
 */
function getQnATemplatesForBusiness(businessType) {
    const category = determineBusinessCategory(businessType);
    
    // ✅ BUSINESS-SPECIFIC TEMPLATES: Different Q&As for different business types
    const businessTemplates = {
        'dental': [
            {
                question: "What are your office hours?",
                answer: "Our office hours are [HOURS]. We also offer [EMERGENCY_SERVICE] for dental emergencies.",
                keywords: ["hours", "open", "closed", "schedule", "appointment", "when", "office hours"]
            },
            {
                question: "Do you accept my insurance?",
                answer: "We accept most major dental insurance plans. Please call us with your insurance information and we'll verify your coverage.",
                keywords: ["insurance", "coverage", "accept", "plan", "dental insurance", "benefits"]
            },
            {
                question: "What areas do you serve?",
                answer: "We serve [SERVICE_AREA] and surrounding areas. Contact us to confirm if we serve your location.",
                keywords: ["area", "location", "serve", "coverage", "where", "distance"]
            },
            {
                question: "Do you handle dental emergencies?",
                answer: "Yes, we provide [EMERGENCY_SERVICE]. Please call us immediately for urgent dental issues.",
                keywords: ["emergency", "urgent", "pain", "tooth", "dental emergency", "after hours"]
            }
        ],
        'hvac': [
            {
                question: "What are your service hours?",
                answer: "Our service hours are [HOURS]. We also offer [EMERGENCY_SERVICE] for HVAC emergencies.",
                keywords: ["hours", "open", "closed", "schedule", "time", "when", "availability"]
            },
            {
                question: "Do you offer emergency HVAC services?",
                answer: "Yes, we provide [EMERGENCY_SERVICE] for heating and cooling emergencies.",
                keywords: ["emergency", "urgent", "24/7", "after hours", "weekend", "holiday", "hvac"]
            },
            {
                question: "What areas do you serve?",
                answer: "We serve [SERVICE_AREA] and surrounding areas for all HVAC needs.",
                keywords: ["area", "location", "serve", "coverage", "where", "distance", "travel"]
            },
            {
                question: "Do you provide free estimates?",
                answer: "Yes, we offer free estimates for HVAC installations and major repairs.",
                keywords: ["estimate", "quote", "free", "cost", "price", "consultation", "evaluation"]
            }
        ],
        'plumbing': [
            {
                question: "What are your service hours?",
                answer: "Our service hours are [HOURS]. We also offer [EMERGENCY_SERVICE] for plumbing emergencies.",
                keywords: ["hours", "open", "closed", "schedule", "time", "when", "availability"]
            },
            {
                question: "Do you handle plumbing emergencies?",
                answer: "Yes, we provide [EMERGENCY_SERVICE] for urgent plumbing issues like leaks and clogs.",
                keywords: ["emergency", "urgent", "24/7", "leak", "clog", "burst pipe", "plumbing"]
            },
            {
                question: "What areas do you serve?",
                answer: "We serve [SERVICE_AREA] and surrounding areas for all plumbing services.",
                keywords: ["area", "location", "serve", "coverage", "where", "distance", "travel"]
            }
        ],
        'general': [
            {
                question: "What are your hours of operation?",
                answer: "Our business hours are [HOURS]. We also offer [EMERGENCY_SERVICE] when needed.",
                keywords: ["hours", "open", "closed", "schedule", "time", "when", "availability"]
            },
            {
                question: "What areas do you serve?",
                answer: "We serve [SERVICE_AREA] and surrounding areas. Contact us to confirm service availability.",
                keywords: ["area", "location", "serve", "coverage", "where", "distance", "travel"]
            },
            {
                question: "Are you licensed and insured?",
                answer: "Yes, we are fully licensed and insured for your protection and peace of mind.",
                keywords: ["licensed", "insured", "certified", "bonded", "qualified", "credentials"]
            }
        ]
    };

    return businessTemplates[category] || businessTemplates['general'];
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
 * ✅ Check if Template is Relevant - FIXED to use actual user input
 */
function isRelevantTemplate(template, keyInfo) {
    // ✅ FIXED: Always include the first 3 templates from business-specific list
    // This ensures we get relevant Q&As for the business type
    return true;
    
    // Previous hardcoded logic removed - now we use business-specific templates
    // that are already filtered by business type in getQnATemplatesForBusiness()
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

    // ✅ FIXED: Extract actual information from user's description
    const descriptionLower = description.toLowerCase();
    
    // Extract service area from description
    let serviceArea = 'our local area';
    if (descriptionLower.includes('county')) {
        const countyMatch = description.match(/(\w+\s+county)/i);
        if (countyMatch) serviceArea = countyMatch[1];
    } else if (descriptionLower.includes('area')) {
        const areaMatch = description.match(/(\w+\s+area)/i);
        if (areaMatch) serviceArea = areaMatch[1];
    } else if (descriptionLower.includes('city') || descriptionLower.includes('town')) {
        const cityMatch = description.match(/(\w+(?:\s+\w+)?)\s+(?:city|town)/i);
        if (cityMatch) serviceArea = cityMatch[1];
    }

    // Replace placeholders with actual information
    if (keyInfo.hours) {
        personalizedAnswer = personalizedAnswer.replace('[HOURS]', keyInfo.hours);
    } else {
        // ✅ FIXED: Use business-appropriate default hours
        const category = determineBusinessCategory(businessType);
        const defaultHours = category === 'dental' ? 
            'Monday through Friday 8 AM to 5 PM' : 
            'Monday through Friday 8 AM to 6 PM';
        personalizedAnswer = personalizedAnswer.replace('[HOURS]', defaultHours);
    }

    // ✅ FIXED: Use business-appropriate emergency service language
    const category = determineBusinessCategory(businessType);
    let emergencyService = 'emergency service availability';
    if (category === 'dental') {
        emergencyService = 'emergency dental care for urgent situations';
    } else if (category === 'hvac' || category === 'plumbing' || category === 'electrical') {
        emergencyService = '24/7 emergency service';
    }
    
    if (keyInfo.emergency) {
        personalizedAnswer = personalizedAnswer.replace('[EMERGENCY_SERVICE]', emergencyService);
    } else {
        personalizedAnswer = personalizedAnswer.replace('[EMERGENCY_SERVICE]', emergencyService);
    }

    // ✅ FIXED: Use actual service area from user description
    personalizedAnswer = personalizedAnswer.replace('[SERVICE_AREA]', serviceArea);

    return personalizedAnswer;
}

/**
 * 🏷️ Generate Keywords
 * ❌ DEPRECATED: This function is no longer used
 * ✅ ALL keyword generation now uses KeywordGenerationService V3
 */
// function generateKeywords(question, answer, businessType) {
//     // DELETED - Use KeywordGenerationService instead
// }

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


/**
 * ==============================================================
 * 🎯 COMPANY Q&A CATEGORIES - Full Category System
 * ==============================================================
 * These endpoints provide FULL category management for Company Q&As
 * using a SEPARATE CompanyQnACategory model with its own collection
 * 100% ISOLATED from Global Trade Categories!
 */

const CompanyQnACategory = require('../../models/CompanyQnACategory');
const { ObjectId } = require('mongodb');

/**
 * GET /api/company/:companyId/knowledge-management/company-qna
 * Load all Company Q&A Categories for this company
 */
router.get('/:companyId/knowledge-management/company-qna', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;
    const { includeQnAs = 'true', includeStats = 'true' } = req.query;

    try {
        logger.info(`📚 GET company Q&A categories for company ${companyId}`);

        // Load categories for this specific company from SEPARATE collection
        const categories = await CompanyQnACategory.find({ companyId }).lean();
        
        // Format response to match frontend expectations
        const formattedCategories = categories.map(cat => ({
            _id: cat._id,
            name: cat.name,
            description: cat.description,
            companyId: cat.companyId,
            qnas: cat.qnas || [],
            statistics: {
                totalQnAs: cat.qnas?.length || 0,
                totalKeywords: cat.qnas?.reduce((sum, q) => sum + (q.keywords?.length || 0), 0) || 0,
                lastUpdated: cat.audit?.updatedAt || cat.createdAt
            },
            isActive: cat.isActive,
            createdAt: cat.audit?.createdAt || cat.createdAt
        }));
        
        const responseTime = Date.now() - startTime;
        logger.info(`📚 GET company Q&A categories success`, { 
            responseTime,
            categoriesFound: formattedCategories.length
        });

        res.json({
            success: true,
            message: 'Company Q&A categories loaded successfully',
            data: formattedCategories,
            meta: {
                responseTime,
                totalCategories: formattedCategories.length,
                totalQnAs: formattedCategories.reduce((sum, cat) => sum + (cat.qnas?.length || 0), 0)
            }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ GET company Q&A categories failed`, {
            error: error.message,
            responseTime
        });

        res.status(500).json({
            success: false,
            message: 'Failed to load Company Q&A categories',
            error: error.message,
            meta: { responseTime }
        });
    }
});

/**
 * POST /api/company/:companyId/knowledge-management/company-qna/categories
 * Create a new Company Q&A Category
 */
router.post('/:companyId/knowledge-management/company-qna/categories', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;
    const { name, description } = req.body;

    try {
        logger.info(`📚 POST company Q&A category`, { companyId, name });

        // Validation
        if (!name || name.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Category name is required'
            });
        }

        // Pre-check: Does this category already exist for this company?
        const existingCategory = await CompanyQnACategory.findOne({ companyId, name: name.trim() });
        if (existingCategory) {
            logger.warn(`⚠️  Category already exists for this company`, { companyId, name: name.trim(), existingCategoryId: existingCategory._id });
            return res.status(409).json({
                success: false,
                message: 'A category with this name already exists for this company',
                error: 'Duplicate category name',
                existingCategoryId: existingCategory._id,
                meta: { responseTime: Date.now() - startTime }
            });
        }

        // Create new category scoped to this company in SEPARATE collection
        const newCategory = new CompanyQnACategory({
            name: name.trim(),
            description: description?.trim() || '',
            companyId: companyId, // Company-specific!
            qnas: [],
            isActive: true,
            metadata: {
                totalQAs: 0,
                totalKeywords: 0,
                lastUpdated: new Date(),
                version: '2.0.0'
            },
            audit: {
                createdAt: new Date(),
                createdBy: 'admin',
                updatedAt: new Date(),
                updatedBy: 'admin'
            }
        });

        const savedCategory = await newCategory.save();

        // Invalidate cache
        try {
            await redisClient.del(`company:${companyId}:knowledge`);
        } catch (error) {
            logger.warn(`⚠️ Cache invalidation failed`, { error: error.message });
        }

        const responseTime = Date.now() - startTime;
        logger.info(`📚 POST company Q&A category success`, { responseTime, categoryId: savedCategory._id });

        res.status(201).json({
            success: true,
            message: `Category "${savedCategory.name}" created successfully`,
            data: {
                _id: savedCategory._id,
                name: savedCategory.name,
                description: savedCategory.description,
                companyId: savedCategory.companyId,
                isActive: savedCategory.isActive,
                qnas: [],
                statistics: {
                    totalQnAs: 0,
                    totalKeywords: 0,
                    lastUpdated: savedCategory.audit.createdAt
                },
                createdAt: savedCategory.audit.createdAt
            },
            meta: { responseTime }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ POST company Q&A category failed`, {
            error: error.message,
            errorCode: error.code,
            errorName: error.name,
            companyId,
            categoryName: name,
            responseTime
        });

        // Enhanced error message for duplicate key errors
        if (error.code === 11000) {
            const duplicateInfo = {
                message: 'A category with this name already exists',
                hint: 'Each company can have categories with unique names. The same category name can exist across different companies.',
                technicalDetails: error.message,
                companyId,
                categoryName: name
            };
            
            logger.error(`❌ DUPLICATE KEY ERROR - Detailed info:`, duplicateInfo);
            
            return res.status(409).json({
                success: false,
                message: 'Duplicate category name',
                error: error.message,
                details: duplicateInfo,
                meta: { responseTime }
            });
        }

        res.status(500).json({
            success: false,
            message: 'Failed to create category',
            error: error.message,
            meta: { responseTime }
        });
    }
});

/**
 * PUT /api/company/:companyId/knowledge-management/company-qna/categories/:categoryId
 * Update a Company Q&A Category (name and/or AI Agent Role description)
 */
router.put('/:companyId/knowledge-management/company-qna/categories/:categoryId', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId, categoryId } = req.params;
    const { name, description } = req.body;

    try {
        logger.info(`✏️ PUT company Q&A category`, { companyId, categoryId, name });

        // Validation
        if (!name || name.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Category name is required'
            });
        }

        // Find the category
        const category = await CompanyQnACategory.findOne({ _id: categoryId, companyId });
        if (!category) {
            logger.warn(`⚠️  Category not found`, { companyId, categoryId });
            return res.status(404).json({
                success: false,
                message: 'Category not found or does not belong to this company',
                meta: { responseTime: Date.now() - startTime }
            });
        }

        // Check if new name conflicts with another category (if name is being changed)
        if (name.trim().toLowerCase() !== category.name.toLowerCase()) {
            const existingCategory = await CompanyQnACategory.findOne({ 
                companyId, 
                name: name.trim(),
                _id: { $ne: categoryId } // Exclude current category
            });
            if (existingCategory) {
                logger.warn(`⚠️  Category name already exists`, { companyId, name: name.trim(), existingCategoryId: existingCategory._id });
                return res.status(409).json({
                    success: false,
                    message: 'A category with this name already exists for this company',
                    error: 'Duplicate category name',
                    meta: { responseTime: Date.now() - startTime }
                });
            }
        }

        // Update category
        category.name = name.trim();
        category.description = description?.trim() || '';
        category.audit.updatedAt = new Date();
        category.audit.updatedBy = 'admin';

        const updatedCategory = await category.save();

        // Invalidate cache
        try {
            await redisClient.del(`company:${companyId}:knowledge`);
        } catch (error) {
            logger.warn(`⚠️ Cache invalidation failed`, { error: error.message });
        }

        const responseTime = Date.now() - startTime;
        logger.info(`✏️ PUT company Q&A category success`, { responseTime, categoryId: updatedCategory._id });

        res.status(200).json({
            success: true,
            message: `Category "${updatedCategory.name}" updated successfully`,
            data: {
                _id: updatedCategory._id,
                name: updatedCategory.name,
                description: updatedCategory.description,
                companyId: updatedCategory.companyId,
                isActive: updatedCategory.isActive,
                qnas: updatedCategory.qnas,
                statistics: {
                    totalQnAs: updatedCategory.qnas.filter(q => q.isActive).length,
                    totalKeywords: updatedCategory.qnas.reduce((total, qna) => total + (qna.keywords ? qna.keywords.length : 0), 0),
                    lastUpdated: updatedCategory.audit.updatedAt
                },
                updatedAt: updatedCategory.audit.updatedAt
            },
            meta: { responseTime }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ PUT company Q&A category failed`, {
            error: error.message,
            errorCode: error.code,
            errorName: error.name,
            companyId,
            categoryId,
            categoryName: name,
            responseTime
        });

        res.status(500).json({
            success: false,
            message: 'Failed to update category',
            error: error.message,
            meta: { responseTime }
        });
    }
});

/**
 * POST /api/company/:companyId/knowledge-management/company-qna/categories/:categoryId/qna
 * Add Q&A to a Company Q&A Category
 */
router.post('/:companyId/knowledge-management/company-qna/categories/:categoryId/qna', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId, categoryId } = req.params;
    const { question, answer, manualKeywords = [] } = req.body;

    try {
        logger.info(`📚 POST company Q&A to category`, { companyId, categoryId });

        // Validation
        if (!question || !answer) {
            return res.status(400).json({
                success: false,
                error: 'Question and answer are required'
            });
        }

        // Find category
        const category = await CompanyQnACategory.findOne({ _id: categoryId, companyId });
        if (!category) {
            return res.status(404).json({
                success: false,
                error: 'Category not found'
            });
        }

        // Generate keywords
        const KeywordGenerationService = require('../../services/knowledge/KeywordGenerationService');
        const keywordService = new KeywordGenerationService();
        let finalKeywords = [];
        
        if (manualKeywords && manualKeywords.length > 0) {
            finalKeywords = [...new Set(manualKeywords.map(k => k.trim().toLowerCase()))].filter(k => k.length > 0);
        } else {
            const generated = await keywordService.generateAdvancedKeywords(question, answer, { tradeCategories: [category.name] });
            finalKeywords = generated.primary || [];
        }

        // Create new Q&A
        const qnaId = new ObjectId().toString();
        const newQnA = {
            id: qnaId,
            _id: new ObjectId(),
            question: question.trim(),
            answer: answer.trim(),
            keywords: finalKeywords,
            autoGenerated: manualKeywords.length === 0 ? finalKeywords : [],
            manualKeywords: manualKeywords.length > 0 ? finalKeywords : [],
            isActive: true,
            status: 'active',
            priority: 'normal',
            difficulty: 'basic',
            confidence: 0.85,
            createdAt: new Date(),
            updatedAt: new Date(),
            createdBy: 'admin'
        };

        // Add Q&A to category
        category.qnas = category.qnas || [];
        category.qnas.push(newQnA);
        
        // Update metadata
        category.metadata = category.metadata || {};
        category.metadata.totalQAs = category.qnas.length;
        category.metadata.totalKeywords = category.qnas.reduce((total, qna) => total + (qna.keywords || []).length, 0);
        category.metadata.lastUpdated = new Date();
        
        await category.save();

        // Invalidate cache
        try {
            await redisClient.del(`company:${companyId}:knowledge`);
        } catch (error) {
            logger.warn(`⚠️ Cache invalidation failed`, { error: error.message });
        }

        const responseTime = Date.now() - startTime;
        logger.info(`📚 POST company Q&A success`, { responseTime });

        res.status(201).json({
            success: true,
            message: 'Q&A added successfully',
            data: {
                categoryName: category.name,
                qna: newQnA
            },
            meta: { responseTime }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ POST company Q&A failed`, {
            error: error.message,
            responseTime
        });

        res.status(500).json({
            success: false,
            message: 'Failed to add Q&A',
            error: error.message,
            meta: { responseTime }
        });
    }
});

/**
 * PUT /api/company/:companyId/knowledge-management/company-qna/categories/:categoryId/qna/:qnaId
 * Update Q&A in a Company Q&A Category
 */
router.put('/:companyId/knowledge-management/company-qna/categories/:categoryId/qna/:qnaId', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId, categoryId, qnaId } = req.params;
    const { question, answer, manualKeywords = [] } = req.body;

    try {
        logger.info(`📚 PUT company Q&A`, { companyId, categoryId, qnaId });

        const category = await CompanyQnACategory.findOne({ _id: categoryId, companyId });
        if (!category) {
            return res.status(404).json({
                success: false,
                error: 'Category not found'
            });
        }

        const qnaIndex = category.qnas.findIndex(q => q.id === qnaId || q._id.toString() === qnaId);
        if (qnaIndex === -1) {
            return res.status(404).json({
                success: false,
                error: 'Q&A not found'
            });
        }

        // Generate keywords
        const KeywordGenerationService = require('../../services/knowledge/KeywordGenerationService');
        const keywordService = new KeywordGenerationService();
        let finalKeywords = [];
        
        if (manualKeywords && manualKeywords.length > 0) {
            finalKeywords = [...new Set(manualKeywords.map(k => k.trim().toLowerCase()))].filter(k => k.length > 0);
        } else {
            const generated = await keywordService.generateAdvancedKeywords(question, answer, { tradeCategories: [category.name] });
            finalKeywords = generated.primary || [];
        }

        // Update Q&A
        category.qnas[qnaIndex].question = question.trim();
        category.qnas[qnaIndex].answer = answer.trim();
        category.qnas[qnaIndex].keywords = finalKeywords;
        category.qnas[qnaIndex].updatedAt = new Date();

        // Update metadata
        category.metadata.totalKeywords = category.qnas.reduce((total, qna) => total + (qna.keywords || []).length, 0);
        category.metadata.lastUpdated = new Date();

        await category.save();

        // Invalidate cache
        try {
            await redisClient.del(`company:${companyId}:knowledge`);
        } catch (error) {
            logger.warn(`⚠️ Cache invalidation failed`, { error: error.message });
        }

        const responseTime = Date.now() - startTime;
        logger.info(`📚 PUT company Q&A success`, { responseTime });

        res.json({
            success: true,
            message: 'Q&A updated successfully',
            data: {
                categoryName: category.name,
                qna: category.qnas[qnaIndex]
            },
            meta: { responseTime }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ PUT company Q&A failed`, {
            error: error.message,
            responseTime
        });

        res.status(500).json({
            success: false,
            message: 'Failed to update Q&A',
            error: error.message,
            meta: { responseTime }
        });
    }
});

/**
 * DELETE /api/company/:companyId/knowledge-management/company-qna/categories/:categoryId/qna/:qnaId
 * Delete Q&A from a Company Q&A Category
 */
router.delete('/:companyId/knowledge-management/company-qna/categories/:categoryId/qna/:qnaId', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId, categoryId, qnaId } = req.params;

    try {
        logger.info(`📚 DELETE company Q&A`, { companyId, categoryId, qnaId });

        const category = await CompanyQnACategory.findOne({ _id: categoryId, companyId });
        if (!category) {
            return res.status(404).json({
                success: false,
                error: 'Category not found'
            });
        }

        const qnaIndex = category.qnas.findIndex(q => q.id === qnaId || q._id.toString() === qnaId);
        if (qnaIndex === -1) {
            return res.status(404).json({
                success: false,
                error: 'Q&A not found'
            });
        }

        // Remove Q&A
        category.qnas.splice(qnaIndex, 1);

        // Update metadata
        category.metadata.totalQAs = category.qnas.length;
        category.metadata.totalKeywords = category.qnas.reduce((total, qna) => total + (qna.keywords || []).length, 0);
        category.metadata.lastUpdated = new Date();

        await category.save();

        // Invalidate cache
        try {
            await redisClient.del(`company:${companyId}:knowledge`);
        } catch (error) {
            logger.warn(`⚠️ Cache invalidation failed`, { error: error.message });
        }

        const responseTime = Date.now() - startTime;
        logger.info(`📚 DELETE company Q&A success`, { responseTime });

        res.json({
            success: true,
            message: 'Q&A deleted successfully',
            data: {
                categoryName: category.name
            },
            meta: { responseTime }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ DELETE company Q&A failed`, {
            error: error.message,
            responseTime
        });

        res.status(500).json({
            success: false,
            message: 'Failed to delete Q&A',
            error: error.message,
            meta: { responseTime }
        });
    }
});

/**
 * DELETE /api/company/:companyId/knowledge-management/company-qna/categories/:categoryId
 * Delete entire Company Q&A Category
 */
router.delete('/:companyId/knowledge-management/company-qna/categories/:categoryId', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId, categoryId } = req.params;

    try {
        logger.info(`📚 DELETE company Q&A category`, { companyId, categoryId });

        const category = await CompanyQnACategory.findOneAndDelete({ _id: categoryId, companyId });
        if (!category) {
            return res.status(404).json({
                success: false,
                error: 'Category not found'
            });
        }

        // Invalidate cache
        try {
            await redisClient.del(`company:${companyId}:knowledge`);
        } catch (error) {
            logger.warn(`⚠️ Cache invalidation failed`, { error: error.message });
        }

        const responseTime = Date.now() - startTime;
        logger.info(`📚 DELETE company Q&A category success`, { responseTime });

        res.json({
            success: true,
            message: `Category "${category.name}" deleted successfully`,
            data: {
                categoryName: category.name
            },
            meta: { responseTime }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ DELETE company Q&A category failed`, {
            error: error.message,
            responseTime
        });

        res.status(500).json({
            success: false,
            message: 'Failed to delete category',
            error: error.message,
            meta: { responseTime }
        });
    }
});

/**
 * POST /api/company/:companyId/knowledge-management/company-qna/categories/:categoryId/generate-top-qnas
 * Generate Top 15 Q&As for a Company Q&A Category (AI-powered)
 */
router.post('/:companyId/knowledge-management/company-qna/categories/:categoryId/generate-top-qnas', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId, categoryId } = req.params;

    try {
        logger.info(`�� POST generate Q&As for company category`, { companyId, categoryId });

        const category = await CompanyQnACategory.findOne({ _id: categoryId, companyId });
        if (!category) {
            return res.status(404).json({
                success: false,
                error: 'Category not found'
            });
        }

        // Get company info for context
        const company = await Company.findById(companyId).select('companyName businessType');

        // Generate 15 Q&As based on category name (reuse the smart generation logic)
        const generatedQnAs = await generateCategoryQnAs(category.name, company);

        // Add generated Q&As to category (avoid duplicates)
        let addedCount = 0;
        let skippedDuplicates = 0;

        for (const genQnA of generatedQnAs) {
            // Check for duplicate questions
            const isDuplicate = category.qnas.some(existing => 
                existing.question.toLowerCase().trim() === genQnA.question.toLowerCase().trim()
            );

            if (!isDuplicate) {
                const qnaId = new ObjectId().toString();
                const newQnA = {
                    id: qnaId,
                    _id: new ObjectId(),
                    question: genQnA.question,
                    answer: genQnA.answer,
                    keywords: genQnA.keywords || [],
                    autoGenerated: genQnA.keywords || [],
                    manualKeywords: [],
                    isActive: true,
                    status: 'active',
                    priority: 'normal',
                    difficulty: 'basic',
                    confidence: 0.85,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    createdBy: 'ai-generator'
                };
                category.qnas.push(newQnA);
                addedCount++;
            } else {
                skippedDuplicates++;
            }
        }

        // Update metadata
        category.metadata.totalQAs = category.qnas.length;
        category.metadata.totalKeywords = category.qnas.reduce((total, qna) => total + (qna.keywords || []).length, 0);
        category.metadata.lastUpdated = new Date();

        await category.save();

        // Invalidate cache
        try {
            await redisClient.del(`company:${companyId}:knowledge`);
        } catch (error) {
            logger.warn(`⚠️ Cache invalidation failed`, { error: error.message });
        }

        const responseTime = Date.now() - startTime;
        logger.info(`📚 POST generate Q&As success`, { responseTime, addedCount });

        res.json({
            success: true,
            message: `Generated ${addedCount} new Q&As for "${category.name}"`,
            data: {
                categoryName: category.name,
                generatedQnAs: addedCount,
                totalQnAs: category.qnas.length,
                skippedDuplicates
            },
            meta: { responseTime }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ POST generate Q&As failed`, {
            error: error.message,
            responseTime
        });

        res.status(500).json({
            success: false,
            message: 'Failed to generate Q&As',
            error: error.message,
            meta: { responseTime }
        });
    }
});

/**
 * 🚀 V3 AI Q&A Generator for Category
 * ✨ NOW USES KeywordGenerationService FOR ALL KEYWORDS!
 */
async function generateCategoryQnAs(categoryName, company) {
    // ✅ V3: Use advanced KeywordGenerationService for ALL keywords
    const KeywordGenerationService = require('../../services/knowledge/KeywordGenerationService');
    const keywordService = new KeywordGenerationService();
    
    const categoryLower = categoryName.toLowerCase();
    const companyName = company?.companyName || 'our company';
    
    const templates = {
        hvac: [
            { q: 'What HVAC services do you offer?', a: `${companyName} offers comprehensive HVAC services including installation, repair, and maintenance for residential and commercial properties.`, k: ['hvac', 'services', 'installation', 'repair', 'maintenance'] },
            { q: 'Do you service all brands of HVAC systems?', a: `Yes, our certified technicians service all major HVAC brands and models.`, k: ['brands', 'service', 'hvac', 'certified', 'technicians'] },
            { q: 'What are your HVAC service hours?', a: `We're available Monday through Friday 8 AM to 6 PM, with emergency service available 24/7.`, k: ['hours', 'schedule', 'availability', 'emergency', 'service'] },
            { q: 'Do you offer emergency HVAC service?', a: `Yes, we provide 24/7 emergency HVAC service for heating and cooling emergencies.`, k: ['emergency', 'urgent', '24/7', 'after hours', 'hvac'] },
            { q: 'How much does HVAC repair cost?', a: `HVAC repair costs vary based on the issue. We provide free estimates and competitive pricing.`, k: ['cost', 'price', 'estimate', 'repair', 'hvac'] },
            { q: 'Do you install new HVAC systems?', a: `Yes, we install energy-efficient HVAC systems for both residential and commercial properties.`, k: ['install', 'new', 'hvac', 'system', 'energy efficient'] },
            { q: 'How often should I service my HVAC?', a: `We recommend servicing your HVAC system twice a year - once before summer and once before winter.`, k: ['maintenance', 'service', 'schedule', 'frequency', 'hvac'] },
            { q: 'Do you offer HVAC maintenance plans?', a: `Yes, we offer affordable maintenance plans to keep your HVAC running efficiently year-round.`, k: ['maintenance', 'plan', 'service', 'contract', 'hvac'] },
            { q: 'What areas do you service for HVAC?', a: `${companyName} services [SERVICE_AREA] and surrounding areas for all HVAC needs.`, k: ['area', 'location', 'service', 'coverage', 'hvac'] },
            { q: 'Are you licensed and insured?', a: `Yes, ${companyName} is fully licensed, bonded, and insured for your protection.`, k: ['licensed', 'insured', 'bonded', 'certified', 'qualified'] },
            { q: 'Do you offer financing for HVAC installation?', a: `Yes, we offer flexible financing options for HVAC system installations.`, k: ['financing', 'payment', 'plans', 'installation', 'hvac'] },
            { q: 'How long does HVAC installation take?', a: `Most HVAC installations take 1-2 days depending on system complexity.`, k: ['installation', 'time', 'duration', 'hvac', 'system'] },
            { q: 'What brands of HVAC do you install?', a: `We install top brands including Trane, Carrier, Lennox, and more.`, k: ['brands', 'install', 'trane', 'carrier', 'lennox'] },
            { q: 'Do you provide free HVAC estimates?', a: `Yes, we provide free, no-obligation estimates for all HVAC services.`, k: ['estimate', 'free', 'quote', 'consultation', 'hvac'] },
            { q: 'Can you help with HVAC emergencies?', a: `Absolutely! Call us anytime for emergency HVAC service - we're available 24/7.`, k: ['emergency', 'urgent', 'help', '247', 'hvac'] }
        ],
        plumbing: [
            { q: 'What plumbing services do you offer?', a: `${companyName} offers complete plumbing services including repairs, installations, drain cleaning, and emergency services.`, k: ['plumbing', 'services', 'repair', 'installation', 'drain'] },
            { q: 'Do you handle plumbing emergencies?', a: `Yes, we provide 24/7 emergency plumbing service for urgent issues like leaks and clogs.`, k: ['emergency', 'urgent', '247', 'leak', 'plumbing'] },
            { q: 'What are your plumbing service hours?', a: `We're available Monday through Friday 8 AM to 6 PM, with 24/7 emergency service.`, k: ['hours', 'schedule', 'availability', 'service', 'plumbing'] },
            { q: 'How much does plumbing repair cost?', a: `Plumbing repair costs vary. We provide upfront pricing and free estimates.`, k: ['cost', 'price', 'estimate', 'repair', 'plumbing'] },
            { q: 'Do you do water heater installation?', a: `Yes, we install and repair all types of water heaters including tankless models.`, k: ['water heater', 'install', 'repair', 'tankless', 'plumbing'] },
            { q: 'Can you clear clogged drains?', a: `Yes, we use professional equipment to clear any clogged drain or sewer line.`, k: ['clog', 'drain', 'clean', 'sewer', 'plumbing'] },
            { q: 'Do you fix leaky faucets?', a: `Yes, we repair and replace leaky faucets, pipes, and fixtures.`, k: ['leak', 'faucet', 'repair', 'fix', 'plumbing'] },
            { q: 'What areas do you service?', a: `${companyName} services [SERVICE_AREA] and surrounding areas for all plumbing needs.`, k: ['area', 'location', 'service', 'coverage', 'plumbing'] },
            { q: 'Are you licensed plumbers?', a: `Yes, all our plumbers are fully licensed, insured, and experienced.`, k: ['licensed', 'insured', 'certified', 'qualified', 'plumber'] },
            { q: 'Do you offer plumbing maintenance?', a: `Yes, we offer preventive plumbing maintenance to avoid costly repairs.`, k: ['maintenance', 'preventive', 'service', 'inspection', 'plumbing'] },
            { q: 'Can you install new plumbing fixtures?', a: `Yes, we install sinks, toilets, showers, and all plumbing fixtures.`, k: ['install', 'fixture', 'sink', 'toilet', 'shower'] },
            { q: 'Do you do sewer line repair?', a: `Yes, we repair and replace sewer lines using modern techniques.`, k: ['sewer', 'line', 'repair', 'replace', 'plumbing'] },
            { q: 'How fast can you respond to emergencies?', a: `We typically respond to plumbing emergencies within 1-2 hours.`, k: ['emergency', 'response', 'fast', 'urgent', 'plumbing'] },
            { q: 'Do you provide free plumbing estimates?', a: `Yes, we provide free estimates for all plumbing services.`, k: ['estimate', 'free', 'quote', 'consultation', 'plumbing'] },
            { q: 'Can you help with low water pressure?', a: `Yes, we diagnose and fix low water pressure issues quickly.`, k: ['water pressure', 'low', 'fix', 'repair', 'plumbing'] }
        ],
        electrical: [
            { q: 'What electrical services do you offer?', a: `${companyName} offers complete electrical services including repairs, installations, and upgrades.`, k: ['electrical', 'services', 'repair', 'installation', 'upgrade'] },
            { q: 'Do you handle electrical emergencies?', a: `Yes, we provide 24/7 emergency electrical service for urgent electrical issues.`, k: ['emergency', 'urgent', '247', 'electrical', 'service'] },
            { q: 'Are you licensed electricians?', a: `Yes, all our electricians are fully licensed, insured, and certified.`, k: ['licensed', 'insured', 'certified', 'electrician', 'qualified'] },
            { q: 'What are your electrical service hours?', a: `We're available Monday through Friday 8 AM to 6 PM, with emergency service available.`, k: ['hours', 'schedule', 'availability', 'electrical', 'service'] },
            { q: 'How much does electrical work cost?', a: `Electrical costs vary by project. We provide free estimates and competitive pricing.`, k: ['cost', 'price', 'estimate', 'electrical', 'work'] },
            { q: 'Do you install ceiling fans?', a: `Yes, we install ceiling fans, light fixtures, and all electrical fixtures.`, k: ['install', 'ceiling fan', 'light', 'fixture', 'electrical'] },
            { q: 'Can you upgrade electrical panels?', a: `Yes, we upgrade electrical panels to meet modern power demands safely.`, k: ['upgrade', 'panel', 'breaker', 'electrical', 'power'] },
            { q: 'Do you install outlets and switches?', a: `Yes, we install, repair, and upgrade outlets, switches, and wiring.`, k: ['install', 'outlet', 'switch', 'wiring', 'electrical'] },
            { q: 'What areas do you service?', a: `${companyName} services [SERVICE_AREA] and surrounding areas for electrical work.`, k: ['area', 'location', 'service', 'coverage', 'electrical'] },
            { q: 'Do you do generator installation?', a: `Yes, we install backup generators for homes and businesses.`, k: ['generator', 'install', 'backup', 'power', 'electrical'] },
            { q: 'Can you fix tripped breakers?', a: `Yes, we diagnose and repair circuit breaker issues safely.`, k: ['breaker', 'circuit', 'trip', 'fix', 'electrical'] },
            { q: 'Do you provide electrical inspections?', a: `Yes, we provide comprehensive electrical safety inspections.`, k: ['inspection', 'safety', 'electrical', 'check', 'service'] },
            { q: 'Can you install recessed lighting?', a: `Yes, we install all types of lighting including recessed and LED systems.`, k: ['install', 'lighting', 'recessed', 'led', 'electrical'] },
            { q: 'Do you offer free electrical estimates?', a: `Yes, we provide free estimates for all electrical projects.`, k: ['estimate', 'free', 'quote', 'consultation', 'electrical'] },
            { q: 'How fast can you respond to emergencies?', a: `We typically respond to electrical emergencies within 1-2 hours.`, k: ['emergency', 'response', 'fast', 'urgent', 'electrical'] }
        ]
    };

    // Determine category type and get templates
    let selectedTemplates = [];
    if (categoryLower.includes('hvac') || categoryLower.includes('heating') || categoryLower.includes('cooling') || categoryLower.includes('air')) {
        selectedTemplates = templates.hvac;
    } else if (categoryLower.includes('plumb')) {
        selectedTemplates = templates.plumbing;
    } else if (categoryLower.includes('electric')) {
        selectedTemplates = templates.electrical;
    } else {
        // Generic business Q&As
        selectedTemplates = [
            { q: 'What are your hours of operation?', a: `${companyName} is open Monday through Friday 8 AM to 6 PM.` },
            { q: 'What areas do you service?', a: `We service [SERVICE_AREA] and surrounding areas.` },
            { q: 'Do you offer free estimates?', a: `Yes, we provide free estimates for all services.` },
            { q: 'Are you licensed and insured?', a: `Yes, ${companyName} is fully licensed and insured.` },
            { q: 'Do you offer emergency services?', a: `Yes, we provide emergency service for urgent situations.` }
        ];
    }
    
    // ✅ V3: Generate keywords dynamically using KeywordGenerationService
    const qnasWithKeywords = await Promise.all(
        selectedTemplates.map(async (t) => {
            const generated = await keywordService.generateAdvancedKeywords(t.q, t.a, { 
                tradeCategories: [categoryName] 
            });
            return {
                question: t.q,
                answer: t.a,
                keywords: generated.primary // Use V3-generated keywords!
            };
        })
    );
    
    return qnasWithKeywords;
}

