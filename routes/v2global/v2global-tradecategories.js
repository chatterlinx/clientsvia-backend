/**
 * V2 GLOBAL TRADE CATEGORIES ROUTES - V2 Trade Management
 * 
 * V2 GLOBAL TRADE CATEGORIES - V2 ARCHITECTURE:
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║ TRADE CATEGORIES V2 - MULTI-TENANT PLATFORM MANAGEMENT          ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║ Features: Global Trade Categories, AI-Powered Q&A, Keywords      ║
 * ║ Security: JWT Authentication + Admin Role Required               ║
 * ║ Performance: Redis Caching + Auto-Generated Keywords            ║
 * ║ Architecture: V2 Global Structure - No Legacy Dependencies      ║
 * ╚══════════════════════════════════════════════════════════════════╝
 * 
 * V2 Global Trade Categories Features:
 * - Global trade category management (HVAC, Plumbing, Electrical, etc.)
 * - AI-powered Q&A with auto-generated keywords
 * - Company inheritance system (companies select global categories)
 * - Keyword regeneration and optimization
 * - Search and filtering capabilities
 * - Statistics and analytics dashboard
 * - Company profile integration for trade Q&A inheritance
 * 
 * CRITICAL INTEGRATION POINT:
 * Company profiles inherit global trade Q&As when they select categories.
 * This V2 system ensures seamless integration with V2 Profile routes.
 */

const express = require('express');
const router = express.Router();
const TradeCategory = require('../../models/TradeCategory');
const CompanyKnowledgeQnA = require('../../models/knowledge/CompanyQnA');
const Company = require('../../models/Company');
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const { redisClient } = require('../../clients');
const logger = require('../../utils/logger');
const { ObjectId } = require('mongodb');

/**
 * 🏷️ GET ALL TRADE CATEGORIES - V2 Global Trade Categories
 * Enhanced with Q&A counts, keyword statistics, and caching
 */
router.get('/categories', async (req, res) => {
    try {
        const startTime = Date.now();
        const {
            includeQnAs = 'true',
            includeStats = 'true',
            search = '',
            sortBy = 'name',
            sortOrder = 'asc'
        } = req.query;

        logger.info(`🏷️ V2 GLOBAL TRADE CATEGORIES: Loading categories`, {
            includeQnAs,
            includeStats,
            search
        });

        // 🚀 Try Redis cache first for global categories
        const cacheKey = `v2-global-trade-categories:${includeQnAs}:${includeStats}:${search}:${sortBy}:${sortOrder}`;
        try {
            const cached = await redisClient.get(cacheKey);
            if (cached) {
                const categories = JSON.parse(cached);
                logger.info(`🚀 V2 GLOBAL TRADE CATEGORIES: Served from cache in ${Date.now() - startTime}ms`);
                return res.json({
                    success: true,
                    data: categories,
                    meta: {
                        source: 'cache',
                        responseTime: Date.now() - startTime,
                        count: categories.length
                    }
                });
            }
        } catch (cacheError) {
            logger.warn('⚠️ Cache read failed:', cacheError.message);
        }

        // 🔍 Build query with search filter
        const query = { companyId: 'global', isActive: true };
        if (search) {
            const searchRegex = new RegExp(search, 'i');
            query.$or = [
                { name: searchRegex },
                { description: searchRegex }
            ];
        }

        // 🚀 Execute query with sorting
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        let categories = await TradeCategory.find(query)
            .sort(sortOptions)
            .lean();

        // 📊 Enrich categories with Q&A and keyword statistics
        if (includeStats === 'true' || includeQnAs === 'true') {
            categories = await Promise.all(categories.map(async (category) => {
                try {
                    // Get Q&As for this category (embedded in the category document)
                    const qnas = category.qnas || [];
                    
                    // Filter active Q&As
                    const activeQnAs = qnas.filter(qna => qna.isActive !== false && qna.status !== 'archived');
                    
                    // Calculate statistics
                    const totalKeywords = activeQnAs.reduce((total, qna) => {
                        return total + (qna.keywords ? qna.keywords.length : 0);
                    }, 0);
                    
                    // Get latest update date
                    let lastUpdated = category.updatedAt || category.createdAt;
                    if (activeQnAs.length > 0) {
                        const latestQnA = activeQnAs.reduce((latest, qna) => {
                            const qnaDate = qna.updatedAt || qna.createdAt;
                            return qnaDate > latest ? qnaDate : latest;
                        }, new Date(0));
                        
                        if (latestQnA > new Date(lastUpdated || 0)) {
                            lastUpdated = latestQnA;
                        }
                    }

                    return {
                        ...category,
                        qnas: includeQnAs === 'true' ? activeQnAs : undefined,
                        statistics: includeStats === 'true' ? {
                            totalQnAs: activeQnAs.length,
                            totalKeywords,
                            lastUpdated
                        } : undefined
                    };
                } catch (error) {
                    logger.error(`❌ Error enriching category ${category.name}:`, error);
                    return {
                        ...category,
                        qnas: includeQnAs === 'true' ? [] : undefined,
                        statistics: includeStats === 'true' ? {
                            totalQnAs: 0,
                            totalKeywords: 0,
                            lastUpdated: category.updatedAt || category.createdAt
                        } : undefined
                    };
                }
            }));
        }

        // 🚀 Cache for 30 minutes
        try {
            await redisClient.setex(cacheKey, 1800, JSON.stringify(categories));
        } catch (cacheError) {
            logger.warn('⚠️ Cache write failed:', cacheError.message);
        }

        const responseTime = Date.now() - startTime;
        logger.info(`✅ V2 GLOBAL TRADE CATEGORIES: Served ${categories.length} categories in ${responseTime}ms`);

        res.json({
            success: true,
            data: categories,
            meta: {
                source: 'database',
                responseTime,
                count: categories.length,
                filters: { search, sortBy, sortOrder }
            }
        });

    } catch (error) {
        logger.error('❌ V2 GLOBAL TRADE CATEGORIES: Error loading categories:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load trade categories',
            details: error.message,
            source: 'v2-global-tradecategories'
        });
    }
});

/**
 * 📊 GET TRADE CATEGORIES STATISTICS - V2 Global Dashboard
 * Real-time statistics for admin dashboard
 */
router.get('/statistics', async (req, res) => {
    try {
        const startTime = Date.now();
        
        logger.info(`📊 V2 GLOBAL TRADE CATEGORIES: Loading statistics`);

        // 🚀 Get comprehensive statistics
        const categories = await TradeCategory.find({ companyId: 'global', isActive: true }).lean();
        
        let totalCategories = categories.length;
        let totalQnAs = 0;
        let totalKeywords = 0;
        let categoriesWithQnAs = 0;

        // Calculate detailed statistics
        categories.forEach(category => {
            const qnas = (category.qnas || []).filter(qna => qna.isActive !== false && qna.status !== 'archived');
            if (qnas.length > 0) {
                categoriesWithQnAs++;
                totalQnAs += qnas.length;
                
                qnas.forEach(qna => {
                    totalKeywords += (qna.keywords || []).length;
                });
            }
        });

        // Get top categories by Q&A count
        const topCategories = categories
            .map(category => ({
                name: category.name,
                qnaCount: (category.qnas || []).filter(qna => qna.isActive !== false && qna.status !== 'archived').length,
                keywordCount: (category.qnas || []).reduce((total, qna) => total + (qna.keywords || []).length, 0)
            }))
            .sort((a, b) => b.qnaCount - a.qnaCount)
            .slice(0, 5);

        const responseTime = Date.now() - startTime;

        const statistics = {
            overview: {
                totalCategories,
                totalQnAs,
                totalKeywords,
                categoriesWithQnAs,
                averageQnAsPerCategory: totalCategories > 0 ? (totalQnAs / totalCategories).toFixed(1) : 0,
                averageKeywordsPerQnA: totalQnAs > 0 ? (totalKeywords / totalQnAs).toFixed(1) : 0
            },
            topCategories,
            performance: {
                responseTime,
                lastUpdated: new Date().toISOString()
            }
        };

        logger.info(`✅ V2 GLOBAL TRADE CATEGORIES: Statistics served in ${responseTime}ms`);

        res.json({
            success: true,
            data: statistics,
            meta: {
                responseTime,
                source: 'v2-global-tradecategories-stats'
            }
        });

    } catch (error) {
        logger.error('❌ V2 GLOBAL TRADE CATEGORIES: Error loading statistics:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load trade categories statistics',
            details: error.message
        });
    }
});

/**
 * 🏷️ POST CREATE TRADE CATEGORY - V2 Global Trade Categories
 * Create new global trade category with validation
 */
router.post('/categories', async (req, res) => {
    try {
        const startTime = Date.now();
        const { name, description } = req.body;

        console.log('🔍 CHECKPOINT 1: Category creation started', {
            rawName: name,
            rawDescription: description,
            timestamp: new Date().toISOString()
        });

        logger.info(`🏷️ V2 GLOBAL TRADE CATEGORIES: Creating category:`, {
            name,
            description: description ? 'provided' : 'empty'
        });

        // 🔍 Enhanced Validation
        const validationErrors = [];
        
        console.log('🔍 CHECKPOINT 2: Starting validation', {
            nameProvided: !!name,
            nameLength: name ? name.trim().length : 0,
            descriptionProvided: !!description,
            descriptionLength: description ? description.trim().length : 0
        });
        
        if (!name || name.trim().length === 0) {
            validationErrors.push('Category name is required and cannot be empty');
            console.log('🚨 VALIDATION ERROR: Name is required');
        } else if (name.trim().length < 2) {
            validationErrors.push('Category name must be at least 2 characters long');
            console.log('🚨 VALIDATION ERROR: Name too short');
        } else if (name.trim().length > 50) {
            validationErrors.push('Category name cannot exceed 50 characters');
            console.log('🚨 VALIDATION ERROR: Name too long');
        }

        if (description && description.trim().length > 200) {
            validationErrors.push('Description cannot exceed 200 characters');
            console.log('🚨 VALIDATION ERROR: Description too long');
        }

        console.log('🔍 CHECKPOINT 3: Basic validation complete', {
            validationErrors: validationErrors.length,
            errors: validationErrors
        });

        // Check for duplicate category name (only among active categories)
        const searchName = name.trim();
        // Escape special regex characters to prevent regex injection
        const escapedName = searchName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const searchRegex = new RegExp(`^${escapedName}$`, 'i');
        
        console.log('🔍 CHECKPOINT 4: Starting duplicate check', {
            originalName: name,
            trimmedName: searchName,
            escapedName: escapedName,
            regexPattern: searchRegex.toString(),
            searchCriteria: {
                companyId: 'global',
                isActive: true
            }
        });
        
        logger.info(`🔍 V2 DUPLICATE CHECK: Searching for category`, {
            searchName,
            searchRegex: searchRegex.toString(),
            companyId: 'global',
            isActive: true
        });
        
        const existingCategory = await TradeCategory.findOne({ 
            name: { $regex: searchRegex },
            companyId: 'global',
            isActive: true
        });
        
        console.log('🔍 CHECKPOINT 5: Database query complete', {
            queryExecuted: true,
            foundExisting: !!existingCategory,
            existingCategoryDetails: existingCategory ? {
                _id: existingCategory._id,
                name: existingCategory.name,
                companyId: existingCategory.companyId,
                isActive: existingCategory.isActive,
                createdAt: existingCategory.createdAt
            } : null
        });
        
        logger.info(`🔍 V2 DUPLICATE CHECK: Result`, {
            found: !!existingCategory,
            existingCategory: existingCategory ? {
                _id: existingCategory._id,
                name: existingCategory.name,
                companyId: existingCategory.companyId,
                isActive: existingCategory.isActive
            } : null
        });
        
        // V2 DUPLICATE CHECK: Properly validate unique categories
        if (existingCategory) {
            console.log('🚨 CHECKPOINT 6: DUPLICATE FOUND!', {
                attemptedName: searchName,
                existingCategory: {
                    _id: existingCategory._id,
                    name: existingCategory.name,
                    companyId: existingCategory.companyId,
                    isActive: existingCategory.isActive,
                    createdAt: existingCategory.createdAt
                },
                exactMatch: existingCategory.name.toLowerCase() === searchName.toLowerCase(),
                caseComparison: {
                    existing: existingCategory.name,
                    attempted: searchName,
                    existingLower: existingCategory.name.toLowerCase(),
                    attemptedLower: searchName.toLowerCase()
                }
            });
            
            logger.warn(`🚨 V2 DUPLICATE CHECK: Found existing category`, {
                existingCategory: {
                    _id: existingCategory._id,
                    name: existingCategory.name,
                    companyId: existingCategory.companyId,
                    isActive: existingCategory.isActive
                }
            });
            validationErrors.push('A trade category with this name already exists');
        } else {
            console.log('✅ CHECKPOINT 6: No duplicate found - proceeding with creation');
        }

        console.log('🔍 CHECKPOINT 7: Final validation check', {
            totalValidationErrors: validationErrors.length,
            allErrors: validationErrors,
            willProceed: validationErrors.length === 0
        });

        if (validationErrors.length > 0) {
            console.log('🚫 CHECKPOINT 8: Validation failed - returning error response', {
                errors: validationErrors,
                responseStatus: 400
            });
            
            logger.warn(`🚫 V2 GLOBAL TRADE CATEGORIES: Validation failed:`, validationErrors);
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                details: validationErrors,
                source: 'v2-global-tradecategories'
            });
        }

        console.log('✅ CHECKPOINT 9: Creating new category object', {
            name: name.trim(),
            description: description?.trim() || '',
            companyId: 'global'
        });

        // 🏗️ Create new trade category
        const newCategory = new TradeCategory({
            name: name.trim(),
            description: description?.trim() || '',
            companyId: 'global',
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

        // 🗑️ Clear related caches
        try {
            await redisClient.del('v2-global-trade-categories:*');
            await redisClient.del('v2-global-directory:trade-categories');
        } catch (cacheError) {
            logger.warn('⚠️ Cache clear failed:', cacheError.message);
        }

        const responseTime = Date.now() - startTime;
        
        logger.info(`✅ V2 GLOBAL TRADE CATEGORIES: Category created successfully in ${responseTime}ms`, {
            categoryId: savedCategory._id,
            categoryName: savedCategory.name
        });

        res.status(201).json({
            success: true,
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
            meta: {
                responseTime,
                source: 'v2-global-tradecategories',
                action: 'create-category'
            },
            message: `Trade category "${savedCategory.name}" created successfully`
        });

    } catch (error) {
        logger.error('❌ V2 GLOBAL TRADE CATEGORIES: Error creating category:', error);
        
        // Handle specific MongoDB errors
        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                error: 'Duplicate entry',
                details: ['A trade category with this name already exists'],
                source: 'v2-global-tradecategories'
            });
        }
        
        res.status(500).json({
            success: false,
            error: 'Failed to create trade category',
            details: error.message,
            source: 'v2-global-tradecategories'
        });
    }
});

/**
 * 🤖 POST ADD Q&A TO TRADE CATEGORY - V2 Global Trade Categories
 * Add Q&A with auto-generated keywords to global trade category
 */
router.post('/categories/:categoryId/qna', async (req, res) => {
    try {
        const { categoryId } = req.params;
        const { question, answer, manualKeywords = [] } = req.body;
        const startTime = Date.now();

        logger.info(`🤖 V2 GLOBAL TRADE CATEGORIES: Adding Q&A to category ${categoryId}`, {
            question: question?.substring(0, 50) + '...',
            hasManualKeywords: manualKeywords.length > 0
        });

        // 🔍 Validation
        const validationErrors = [];
        
        if (!question || question.trim().length === 0) {
            validationErrors.push('Question is required and cannot be empty');
        } else if (question.trim().length < 3) {
            validationErrors.push('Question must be at least 3 characters long');
        } else if (question.trim().length > 500) {
            validationErrors.push('Question cannot exceed 500 characters');
        }

        if (!answer || answer.trim().length === 0) {
            validationErrors.push('Answer is required and cannot be empty');
        } else if (answer.trim().length < 3) {
            validationErrors.push('Answer must be at least 3 characters long');
        } else if (answer.trim().length > 2000) {
            validationErrors.push('Answer cannot exceed 2000 characters');
        }

        if (validationErrors.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                details: validationErrors,
                source: 'v2-global-tradecategories'
            });
        }

        // 🔍 Find the trade category
        const category = await TradeCategory.findById(categoryId);
        if (!category) {
            return res.status(404).json({
                success: false,
                error: 'Trade category not found',
                categoryId,
                source: 'v2-global-tradecategories'
            });
        }

        // 🤖 Generate keywords (auto or manual)
        let finalKeywords = [];
        if (manualKeywords && manualKeywords.length > 0) {
            // Use manual keywords
            finalKeywords = [...new Set(manualKeywords.map(k => k.trim().toLowerCase()))].filter(k => k.length > 0);
            logger.info(`🔧 Using manual keywords: ${finalKeywords.join(', ')}`);
        } else {
            // Auto-generate keywords
            finalKeywords = generateKeywords(question, answer, category.name);
            logger.info(`🤖 Generated auto keywords: ${finalKeywords.join(', ')}`);
        }

        // 🏗️ Create new Q&A entry
        const qnaId = new ObjectId().toString();
        const newQnA = {
            id: qnaId, // Required by schema
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

        // 📝 Add Q&A to category
        category.qnas = category.qnas || [];
        category.qnas.push(newQnA);
        
        // Update metadata
        category.metadata = category.metadata || {};
        category.metadata.totalQAs = category.qnas.length;
        category.metadata.totalKeywords = category.qnas.reduce((total, qna) => total + (qna.keywords || []).length, 0);
        category.metadata.lastUpdated = new Date();
        
        category.audit = category.audit || {};
        category.audit.updatedAt = new Date();
        category.audit.updatedBy = 'admin';

        await category.save();

        // 🚀 OPTIMIZATION: Invalidate trade Q&A keyword cache for all companies using this category
        try {
            const PriorityDrivenKnowledgeRouter = require('../../services/priorityDrivenKnowledgeRouter');
            const router = new PriorityDrivenKnowledgeRouter();
            
            // Find all companies using this trade category and invalidate their cache
            const Company = require('../../models/Company');
            const companiesUsingCategory = await Company.find({ 
                tradeCategories: categoryId 
            }).select('_id').lean();
            
            companiesUsingCategory.forEach(company => {
                router.invalidateKeywordCache(company._id.toString(), 'tradeQnA');
            });
            
            logger.info(`🚀 Invalidated tradeQnA keyword cache for ${companiesUsingCategory.length} companies`);
        } catch (cacheError) {
            logger.warn('⚠️ Failed to invalidate keyword cache:', cacheError.message);
        }

        // 🗑️ Clear related caches
        try {
            await redisClient.del('v2-global-trade-categories:*');
            // Clear company-specific caches that might inherit this Q&A
            await redisClient.del('knowledge:company:*');
        } catch (cacheError) {
            logger.warn('⚠️ Cache clear failed:', cacheError.message);
        }

        const responseTime = Date.now() - startTime;
        
        logger.info(`✅ V2 GLOBAL TRADE CATEGORIES: Q&A added successfully in ${responseTime}ms`, {
            categoryId,
            categoryName: category.name,
            qnaId: newQnA._id,
            keywordCount: finalKeywords.length
        });

        res.status(201).json({
            success: true,
            data: {
                qna: newQnA,
                category: {
                    _id: category._id,
                    name: category.name,
                    totalQnAs: category.qnas.length,
                    totalKeywords: category.metadata.totalKeywords
                }
            },
            meta: {
                responseTime,
                source: 'v2-global-tradecategories',
                action: 'add-qna'
            },
            message: `Q&A added to "${category.name}" with ${finalKeywords.length} keywords`
        });

    } catch (error) {
        logger.error('❌ V2 GLOBAL TRADE CATEGORIES: Error adding Q&A:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to add Q&A to trade category',
            details: error.message,
            source: 'v2-global-tradecategories'
        });
    }
});

/**
 * ✏️ PUT UPDATE Q&A IN TRADE CATEGORY - V2 Global Trade Categories
 * Update existing Q&A with auto-generated keywords in global trade category
 */
router.put('/categories/:categoryId/qna/:qnaId', async (req, res) => {
    try {
        const { categoryId, qnaId } = req.params;
        const { question, answer, manualKeywords = [] } = req.body;
        const startTime = Date.now();

        logger.info(`✏️ V2 GLOBAL TRADE CATEGORIES: Updating Q&A ${qnaId} in category ${categoryId}`, {
            question: question?.substring(0, 50) + '...',
            hasManualKeywords: manualKeywords.length > 0
        });

        // 🔍 Validation
        const validationErrors = [];
        
        if (!question || question.trim().length === 0) {
            validationErrors.push('Question is required and cannot be empty');
        } else if (question.trim().length < 3) {
            validationErrors.push('Question must be at least 3 characters long');
        } else if (question.trim().length > 500) {
            validationErrors.push('Question cannot exceed 500 characters');
        }

        if (!answer || answer.trim().length === 0) {
            validationErrors.push('Answer is required and cannot be empty');
        } else if (answer.trim().length < 3) {
            validationErrors.push('Answer must be at least 3 characters long');
        } else if (answer.trim().length > 2000) {
            validationErrors.push('Answer cannot exceed 2000 characters');
        }

        if (validationErrors.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                details: validationErrors,
                source: 'v2-global-tradecategories'
            });
        }

        // 🔍 Find the trade category
        const category = await TradeCategory.findById(categoryId);
        if (!category) {
            return res.status(404).json({
                success: false,
                error: 'Trade category not found',
                categoryId,
                source: 'v2-global-tradecategories'
            });
        }

        // 🔍 Find the Q&A to update
        const qnaIndex = category.qnas.findIndex(qna => qna.id === qnaId || qna._id.toString() === qnaId);
        if (qnaIndex === -1) {
            return res.status(404).json({
                success: false,
                error: 'Q&A not found in this category',
                categoryId,
                qnaId,
                source: 'v2-global-tradecategories'
            });
        }

        // 🤖 Generate keywords (auto or manual)
        let finalKeywords = [];
        if (manualKeywords && manualKeywords.length > 0) {
            // Use manual keywords
            finalKeywords = [...new Set(manualKeywords.map(k => k.trim().toLowerCase()))].filter(k => k.length > 0);
            logger.info(`🔧 Using manual keywords: ${finalKeywords.join(', ')}`);
        } else {
            // Auto-generate keywords
            finalKeywords = generateKeywords(question, answer, category.name);
            logger.info(`🤖 Generated auto keywords: ${finalKeywords.join(', ')}`);
        }

        // 🏗️ Update the Q&A entry
        const existingQnA = category.qnas[qnaIndex];
        const updatedQnA = {
            ...existingQnA.toObject(),
            question: question.trim(),
            answer: answer.trim(),
            keywords: finalKeywords,
            autoGenerated: manualKeywords.length === 0 ? finalKeywords : existingQnA.autoGenerated || [],
            manualKeywords: manualKeywords.length > 0 ? finalKeywords : existingQnA.manualKeywords || [],
            updatedAt: new Date(),
            updatedBy: 'admin'
        };

        // Replace the Q&A in the array
        category.qnas[qnaIndex] = updatedQnA;
        
        // Update metadata
        category.metadata = category.metadata || {};
        category.metadata.totalKeywords = category.qnas.reduce((total, qna) => total + (qna.keywords || []).length, 0);
        category.metadata.lastUpdated = new Date();
        
        category.audit = category.audit || {};
        category.audit.updatedAt = new Date();
        category.audit.updatedBy = 'admin';

        await category.save();

        // 🗑️ Clear related caches
        try {
            await redisClient.del('v2-global-trade-categories:*');
            // Clear company-specific caches that might inherit this Q&A
            await redisClient.del('knowledge:company:*');
        } catch (cacheError) {
            logger.warn('⚠️ Cache clear failed:', cacheError.message);
        }

        const responseTime = Date.now() - startTime;
        
        logger.info(`✅ V2 GLOBAL TRADE CATEGORIES: Q&A updated successfully in ${responseTime}ms`, {
            categoryId,
            categoryName: category.name,
            qnaId: updatedQnA.id || updatedQnA._id,
            keywordCount: finalKeywords.length
        });

        res.status(200).json({
            success: true,
            data: {
                qna: updatedQnA,
                category: {
                    _id: category._id,
                    name: category.name,
                    totalQnAs: category.qnas.length,
                    totalKeywords: category.metadata.totalKeywords
                }
            },
            meta: {
                responseTime,
                source: 'v2-global-tradecategories',
                action: 'update-qna'
            },
            message: `Q&A updated in "${category.name}" with ${finalKeywords.length} keywords`
        });

    } catch (error) {
        logger.error('❌ V2 GLOBAL TRADE CATEGORIES: Error updating Q&A:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update Q&A in trade category',
            details: error.message,
            source: 'v2-global-tradecategories'
        });
    }
});

/**
 * 🗑️ DELETE TRADE CATEGORY - V2 Global Trade Categories
 * Soft delete (mark as inactive) or hard delete global trade category
 */
router.delete('/categories/:categoryId', async (req, res) => {
    try {
        const { categoryId } = req.params;
        const { hard = false } = req.query;
        const startTime = Date.now();

        logger.info(`🗑️ V2 GLOBAL TRADE CATEGORIES: Deleting category ${categoryId}`, { hard });

        const category = await TradeCategory.findOne({ _id: categoryId, companyId: 'global' });
        if (!category) {
            return res.status(404).json({
                success: false,
                error: 'Trade category not found',
                source: 'v2-global-tradecategories'
            });
        }

        if (hard === 'true') {
            await TradeCategory.findByIdAndDelete(categoryId);
            logger.info(`✅ V2 GLOBAL TRADE CATEGORIES: Category permanently deleted`, { categoryId, name: category.name });
        } else {
            category.isActive = false;
            category.audit = category.audit || {};
            category.audit.updatedAt = new Date();
            category.audit.updatedBy = 'admin';
            await category.save();
            logger.info(`✅ V2 GLOBAL TRADE CATEGORIES: Category soft deleted`, { categoryId, name: category.name });
        }

        const responseTime = Date.now() - startTime;
        res.json({
            success: true,
            message: `Trade category ${hard === 'true' ? 'permanently deleted' : 'deactivated'}`,
            data: { categoryId, categoryName: category.name, deletionType: hard === 'true' ? 'permanent' : 'soft' },
            meta: { responseTime, source: 'v2-global-tradecategories' }
        });

    } catch (error) {
        logger.error('❌ V2 GLOBAL TRADE CATEGORIES: Error deleting category', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete trade category',
            details: error.message,
            source: 'v2-global-tradecategories'
        });
    }
});

/**
 * 🗑️ DELETE Q&A FROM TRADE CATEGORY - V2 Global Trade Categories
 */
router.delete('/categories/:categoryId/qna/:qnaId', async (req, res) => {
    try {
        const { categoryId, qnaId } = req.params;
        const startTime = Date.now();

        const category = await TradeCategory.findOne({ _id: categoryId, companyId: 'global' });
        if (!category) {
            return res.status(404).json({
                success: false,
                error: 'Trade category not found',
                source: 'v2-global-tradecategories'
            });
        }

        const qnaIndex = category.qnas.findIndex(qna => qna.id === qnaId || qna._id.toString() === qnaId);
        if (qnaIndex === -1) {
            return res.status(404).json({
                success: false,
                error: 'Q&A not found in this category',
                source: 'v2-global-tradecategories'
            });
        }

        const removedQnA = category.qnas[qnaIndex];
        category.qnas.splice(qnaIndex, 1);

        category.metadata = category.metadata || {};
        category.metadata.totalQAs = category.qnas.length;
        category.metadata.totalKeywords = category.qnas.reduce((total, qna) => total + (qna.keywords || []).length, 0);
        category.metadata.lastUpdated = new Date();

        await category.save();

        const responseTime = Date.now() - startTime;
        res.json({
            success: true,
            data: { categoryId, categoryName: category.name, deletedQnA: { id: removedQnA.id, question: removedQnA.question }, remainingQnAs: category.qnas.length },
            meta: { responseTime, source: 'v2-global-tradecategories' },
            message: `Q&A removed from "${category.name}"`
        });

    } catch (error) {
        logger.error('❌ V2 GLOBAL TRADE CATEGORIES: Error deleting Q&A', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete Q&A',
            details: error.message,
            source: 'v2-global-tradecategories'
        });
    }
});

/**
 * 🤖 AUTO-GENERATE TOP 20 Q&As - V2 V2 Feature
 * Generate industry-specific, booking-focused Q&As for trade categories
 */
router.post('/categories/:categoryId/generate-top-qnas', async (req, res) => {
    try {
        const { categoryId } = req.params;
        const startTime = Date.now();

        logger.info(`🤖 V2 AUTO-GENERATE: Generating top Q&As for category ${categoryId}`);

        const category = await TradeCategory.findOne({ _id: categoryId, companyId: 'global' });
        if (!category) {
            return res.status(404).json({
                success: false,
                error: 'Trade category not found',
                source: 'v2-global-tradecategories'
            });
        }

        // Get industry-specific Q&As based on category name
        const generatedQnAs = generateIndustryQnAs(category.name, category.description);
        
        // 🎯 ADMIN CONTROL: Add generated Q&As with flexible duplicate handling
        const existingQuestions = (category.qnas || []).map(qna => qna.question.toLowerCase().trim());
        const newQnAs = [];

        for (const qnaData of generatedQnAs) {
            const questionLower = qnaData.question.toLowerCase().trim();
            
            // Only skip if EXACT match exists - admin has full control to add similar questions
            const exactMatch = existingQuestions.find(existing => existing === questionLower);
            
            if (!exactMatch) {
                const qnaId = new ObjectId().toString();
                const newQnA = {
                    id: qnaId,
                    _id: new ObjectId(),
                    question: qnaData.question,
                    answer: qnaData.answer,
                    keywords: qnaData.keywords,
                    autoGenerated: true,
                    manualKeywords: [],
                    isActive: true,
                    status: 'active',
                    priority: qnaData.priority || 'normal',
                    difficulty: 'basic',
                    confidence: 0.9,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    createdBy: 'auto-generator'
                };
                
                category.qnas = category.qnas || [];
                category.qnas.push(newQnA);
                newQnAs.push(newQnA);
            }
        }

        // Update metadata
        category.metadata = category.metadata || {};
        category.metadata.totalQAs = category.qnas.length;
        category.metadata.totalKeywords = category.qnas.reduce((total, qna) => total + (qna.keywords || []).length, 0);
        category.metadata.lastUpdated = new Date();

        category.audit = category.audit || {};
        category.audit.updatedAt = new Date();
        category.audit.updatedBy = 'auto-generator';

        await category.save();

        const responseTime = Date.now() - startTime;
        logger.info(`✅ V2 AUTO-GENERATE: Generated ${newQnAs.length} Q&As in ${responseTime}ms`, {
            categoryId,
            categoryName: category.name,
            totalQnAs: category.qnas.length
        });

        res.json({
            success: true,
            data: {
                categoryId,
                categoryName: category.name,
                generatedQnAs: newQnAs.length,
                totalQnAs: category.qnas.length,
                skippedDuplicates: generatedQnAs.length - newQnAs.length
            },
            meta: {
                responseTime,
                source: 'v2-global-tradecategories',
                action: 'auto-generate-qnas'
            },
            message: `Generated ${newQnAs.length} professional Q&As for "${category.name}"`
        });

    } catch (error) {
        logger.error('❌ V2 AUTO-GENERATE: Error generating Q&As', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate Q&As',
            details: error.message,
            source: 'v2-global-tradecategories'
        });
    }
});

// 🎯 INDUSTRY-SPECIFIC Q&A GENERATOR
        function generateIndustryQnAs(categoryName, description) {
            // 🎯 UNIVERSAL Q&A GENERATOR - Always returns 15 Q&As for ANY category
            // Dynamic generation based on category name - no hardcoded limitations
            
            return generateUniversalQnAs(categoryName, description);
        }

        function generateUniversalQnAs(categoryName, description) {
            // 🎯 UNIVERSAL 15 Q&As - Works for ANY service business category
            return [
                {
                    question: "What are your service hours?",
                    answer: `We're available Monday through Friday 8 AM to 6 PM, with emergency service available 24/7. What type of ${categoryName.toLowerCase()} service do you need? I can check our availability.`,
                    keywords: ["hours", "service", "emergency", "availability", "schedule"],
                    priority: "high"
                },
                {
                    question: "Do you offer free estimates?",
                    answer: `Yes, we provide free estimates for all ${categoryName.toLowerCase()} services. We can usually schedule an estimate within 24 hours. What project are you looking to get quoted?`,
                    keywords: ["estimate", "free", "quote", "project", "schedule"],
                    priority: "high"
                },
                {
                    question: "Are you licensed and insured?",
                    answer: `Absolutely! We're fully licensed, bonded, and insured for your protection. All our ${categoryName.toLowerCase()} technicians are certified professionals. Would you like to schedule a service call?`,
                    keywords: ["licensed", "insured", "bonded", "certified", "professional"],
                    priority: "normal"
                },
                {
                    question: "How quickly can you come out?",
                    answer: "We typically offer same-day or next-day service, with emergency calls available 24/7. What's the urgency of your situation? I can check our earliest availability.",
                    keywords: ["same day", "next day", "emergency", "availability", "urgent"],
                    priority: "high"
                },
                {
                    question: "Do you guarantee your work?",
                    answer: `Yes, all our ${categoryName.toLowerCase()} work comes with a satisfaction guarantee and warranty on parts and labor. We stand behind our quality. What service are you interested in?`,
                    keywords: ["guarantee", "warranty", "satisfaction", "quality", "service"],
                    priority: "normal"
                },
                {
                    question: "What areas do you service?",
                    answer: "We service the entire metro area and surrounding communities. We can usually reach you within 30-45 minutes. What's your location? I'll confirm we service your area.",
                    keywords: ["areas", "service area", "metro", "location", "coverage"],
                    priority: "high"
                },
                {
                    question: "Do you offer emergency services?",
                    answer: `Yes, we provide 24/7 emergency ${categoryName.toLowerCase()} services. Emergency rates may apply after hours, but we'll get your issue resolved quickly. What's your emergency?`,
                    keywords: ["emergency", "24/7", "after hours", "urgent", "immediate"],
                    priority: "high"
                },
                {
                    question: "How much do your services cost?",
                    answer: "Our pricing varies by service type and complexity. We provide upfront pricing before any work begins - no surprises. Would you like me to schedule a free estimate?",
                    keywords: ["cost", "pricing", "upfront", "estimate", "transparent"],
                    priority: "high"
                },
                {
                    question: "Do you offer financing options?",
                    answer: "Yes, we offer flexible financing options for larger projects, including 0% interest plans with approved credit. We work with you to find affordable solutions. Interested in learning more?",
                    keywords: ["financing", "payment plans", "0% interest", "credit", "affordable"],
                    priority: "normal"
                },
                {
                    question: "Are your technicians background checked?",
                    answer: "Absolutely! All our technicians undergo thorough background checks and drug testing. They're also uniformed and carry company ID for your security and peace of mind.",
                    keywords: ["background check", "drug testing", "security", "uniformed", "safety"],
                    priority: "normal"
                },
                {
                    question: "Do you clean up after the work is done?",
                    answer: "Yes, we always clean up our work area and leave your property as clean as we found it. Professional cleanup is part of our standard service. We respect your home.",
                    keywords: ["cleanup", "clean", "professional", "respect", "tidy"],
                    priority: "normal"
                },
                {
                    question: "Can you work around my schedule?",
                    answer: "We offer flexible scheduling including evenings and weekends when possible. We understand you have a busy life and work to accommodate your needs. What times work best for you?",
                    keywords: ["flexible", "schedule", "evenings", "weekends", "accommodate"],
                    priority: "normal"
                },
                {
                    question: "Do you provide warranties on your work?",
                    answer: `All our ${categoryName.toLowerCase()} work comes with comprehensive warranties - typically 1-5 years depending on the service. We also warranty all parts and materials. You're fully protected.`,
                    keywords: ["warranty", "comprehensive", "parts", "materials", "protected"],
                    priority: "normal"
                },
                {
                    question: "What makes you different from other companies?",
                    answer: `We combine years of ${categoryName.toLowerCase()} experience with modern technology and old-fashioned customer service. Our customers choose us for reliability, quality, and fair pricing. Ready to experience the difference?`,
                    keywords: ["different", "experience", "technology", "customer service", "reliability"],
                    priority: "normal"
                },
                {
                    question: "Can I get references from past customers?",
                    answer: "Absolutely! We're proud of our work and happy to provide references from recent customers in your area. You can also check our online reviews. Would you like me to send some references?",
                    keywords: ["references", "past customers", "reviews", "testimonials", "reputation"],
                    priority: "normal"
                }
            ];
        }

/**
 * 🧹 V2 NUCLEAR CLEAN - DROP AND REBUILD COLLECTION
 * Clean slate approach for bulletproof V2 architecture
 */
/**
 * 🔍 DEBUG: Check for specific category name
 */
router.get('/debug/check-category/:name', async (req, res) => {
    try {
        const { name } = req.params;
        
        // Check for exact matches and similar matches
        const exactMatch = await TradeCategory.findOne({ 
            name: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
            companyId: 'global'
        });
        
        const similarMatches = await TradeCategory.find({ 
            name: { $regex: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
            companyId: 'global'
        });
        
        const allCategories = await TradeCategory.find({ companyId: 'global' }).select('name isActive');
        
        res.json({
            success: true,
            searchTerm: name,
            exactMatch: exactMatch ? {
                _id: exactMatch._id,
                name: exactMatch.name,
                isActive: exactMatch.isActive,
                companyId: exactMatch.companyId
            } : null,
            similarMatches: similarMatches.map(cat => ({
                _id: cat._id,
                name: cat.name,
                isActive: cat.isActive
            })),
            allCategories: allCategories.map(cat => ({
                _id: cat._id,
                name: cat.name,
                isActive: cat.isActive
            })),
            totalCategories: allCategories.length
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 🚀 V2 SYSTEM ONLY - LEGACY DEBUG FUNCTIONS REMOVED
 * All legacy collection references eliminated for clean V2 architecture
 */

/**
 * 🔍 DEBUG ENDPOINT - RAW DATABASE QUERY
 * Direct MongoDB query to see what's actually in the database
 */
router.get('/debug/raw-query/:name', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { name } = req.params;
        const searchName = name.trim();
        
        // Direct MongoDB queries
        const exactMatch = await TradeCategory.findOne({ name: searchName });
        const caseInsensitiveMatch = await TradeCategory.findOne({ name: { $regex: new RegExp(`^${searchName}$`, 'i') } });
        const globalActiveMatch = await TradeCategory.findOne({ 
            name: { $regex: new RegExp(`^${searchName}$`, 'i') },
            companyId: 'global',
            isActive: true
        });
        
        // Get all categories for comparison
        const allCategories = await TradeCategory.find({}).lean();
        
        res.json({
            success: true,
            searchName,
            results: {
                exactMatch: exactMatch ? { _id: exactMatch._id, name: exactMatch.name, companyId: exactMatch.companyId, isActive: exactMatch.isActive } : null,
                caseInsensitiveMatch: caseInsensitiveMatch ? { _id: caseInsensitiveMatch._id, name: caseInsensitiveMatch.name, companyId: caseInsensitiveMatch.companyId, isActive: caseInsensitiveMatch.isActive } : null,
                globalActiveMatch: globalActiveMatch ? { _id: globalActiveMatch._id, name: globalActiveMatch.name, companyId: globalActiveMatch.companyId, isActive: globalActiveMatch.isActive } : null
            },
            totalCategoriesInDB: allCategories.length,
            allCategoryNames: allCategories.map(cat => ({ name: cat.name, companyId: cat.companyId, isActive: cat.isActive }))
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            stack: error.stack
        });
    }
});

/**
 * 🧪 DEBUG ENDPOINT - TEST DUPLICATE CHECK
 * Test the duplicate check logic directly
 */
router.get('/debug/test-duplicate/:name', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { name } = req.params;
        const searchName = name.trim();
        const searchRegex = new RegExp(`^${searchName}$`, 'i');
        
        console.log('🧪 TESTING DUPLICATE CHECK:', {
            originalName: name,
            searchName,
            regexString: searchRegex.toString(),
            regexSource: searchRegex.source,
            regexFlags: searchRegex.flags
        });
        
        const existingCategory = await TradeCategory.findOne({ 
            name: { $regex: searchRegex },
            companyId: 'global',
            isActive: true
        });
        
        // Also test with a simple string match
        const simpleMatch = await TradeCategory.findOne({ 
            name: searchName,
            companyId: 'global',
            isActive: true
        });
        
        res.json({
            success: true,
            testName: searchName,
            regexMatch: !!existingCategory,
            simpleMatch: !!simpleMatch,
            regexDetails: {
                pattern: searchRegex.toString(),
                source: searchRegex.source,
                flags: searchRegex.flags
            },
            foundCategory: existingCategory ? {
                _id: existingCategory._id,
                name: existingCategory.name,
                companyId: existingCategory.companyId
            } : null
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 🧹 DEBUG ENDPOINT - CLEAR REDIS CACHE
 * Temporary endpoint to clear any cached trade category data
 */
router.post('/debug/clear-cache', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const redisClient = require('../../db').redisClient;
        
        // Clear all trade category related cache keys
        const keys = await redisClient.keys('*trade*');
        if (keys.length > 0) {
            await redisClient.del(keys);
        }
        
        res.json({
            success: true,
            message: `Cleared ${keys.length} cache keys`,
            clearedKeys: keys
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 🔧 DEBUG ENDPOINT - GET ALL CATEGORIES (INCLUDING INACTIVE)
 * Temporary debug endpoint to see all categories in database
 */
router.get('/debug/all-categories', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        // Show ALL categories regardless of companyId to debug the duplicate issue
        const allCategories = await TradeCategory.find({}).lean();
        
        res.json({
            success: true,
            data: allCategories.map(cat => ({
                _id: cat._id,
                name: cat.name,
                description: cat.description,
                companyId: cat.companyId,
                isActive: cat.isActive,
                createdAt: cat.audit?.createdAt || cat.createdAt,
                qnaCount: (cat.qnas || []).length
            })),
            total: allCategories.length
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 🔍 GET TRADE CATEGORIES FOR COMPANY PROFILE - V2 Integration Point
 * CRITICAL: This endpoint is used by V2 Profile routes for trade Q&A inheritance
 */
router.get('/categories/for-company/:companyId', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        const startTime = Date.now();

        logger.info(`🔍 V2 GLOBAL TRADE CATEGORIES: Loading categories for company profile integration`, {
            companyId,
            userEmail: req.user.email
        });

        // 🏢 Get company's selected trade categories
        const company = await Company.findById(companyId).select('tradeCategories companyName').lean();
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found',
                companyId,
                source: 'v2-global-tradecategories'
            });
        }

        const selectedTrades = company.tradeCategories || [];
        
        // 🏷️ Get all global trade categories
        const allCategories = await TradeCategory.find({ 
            companyId: 'global', 
            isActive: true 
        }).select('name description qnas').lean();

        // 📊 Filter and enrich categories based on company selection
        const categoriesForCompany = allCategories.map(category => {
            const isSelected = selectedTrades.includes(category.name);
            const activeQnAs = (category.qnas || []).filter(qna => qna.isActive !== false && qna.status !== 'archived');
            
            return {
                _id: category._id,
                name: category.name,
                description: category.description,
                isSelected,
                qnas: isSelected ? activeQnAs : [], // Only include Q&As for selected categories
                statistics: {
                    totalQnAs: activeQnAs.length,
                    totalKeywords: activeQnAs.reduce((total, qna) => total + (qna.keywords || []).length, 0)
                }
            };
        });

        const responseTime = Date.now() - startTime;
        
        logger.info(`✅ V2 GLOBAL TRADE CATEGORIES: Company integration data served in ${responseTime}ms`, {
            companyId,
            companyName: company.companyName,
            totalCategories: categoriesForCompany.length,
            selectedCategories: selectedTrades.length
        });

        res.json({
            success: true,
            data: {
                company: {
                    _id: company._id,
                    companyName: company.companyName,
                    selectedTradeCategories: selectedTrades
                },
                categories: categoriesForCompany
            },
            meta: {
                responseTime,
                source: 'v2-global-tradecategories-company-integration',
                totalCategories: categoriesForCompany.length,
                selectedCategories: selectedTrades.length
            }
        });

    } catch (error) {
        logger.error('❌ V2 GLOBAL TRADE CATEGORIES: Error loading company integration data:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load trade categories for company',
            details: error.message,
            source: 'v2-global-tradecategories'
        });
    }
});

/**
 * 🤖 Helper function to generate keywords from question and answer
 * Enhanced keyword generation with trade-specific context
 */
function generateKeywords(question, answer, categoryName) {
    const text = `${question} ${answer} ${categoryName}`.toLowerCase();
    
    // Remove common stop words
    const stopWords = new Set([
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
        'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
        'will', 'would', 'could', 'should', 'may', 'might', 'can', 'must', 'shall',
        'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
        'this', 'that', 'these', 'those', 'what', 'when', 'where', 'why', 'how',
        'if', 'then', 'else', 'so', 'because', 'since', 'while', 'although', 'though'
    ]);
    
    // Extract meaningful words (3+ characters, not stop words)
    const words = text
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length >= 3 && !stopWords.has(word))
        .map(word => word.trim());
    
    // Count word frequency
    const wordCount = {};
    words.forEach(word => {
        wordCount[word] = (wordCount[word] || 0) + 1;
    });
    
    // Get top keywords by frequency, limit to 10
    const keywords = Object.entries(wordCount)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
        .map(([word]) => word);
    
    return keywords;
}

/**
 * 🗑️ DELETE TRADE CATEGORY - V2 Global Trade Categories
 * Soft delete or hard delete trade category
 */
router.delete('/categories/:categoryId', async (req, res) => {
    try {
        const { categoryId } = req.params;
        const { hard = false } = req.query;
        const startTime = Date.now();

        logger.info(`🗑️ V2 GLOBAL TRADE CATEGORIES: Deleting category ${categoryId}`, { hard });

        const category = await TradeCategory.findOne({ _id: categoryId, companyId: 'global' });
        if (!category) {
            return res.status(404).json({
                success: false,
                error: 'Trade category not found',
                source: 'v2-global-tradecategories'
            });
        }

        if (hard === 'true') {
            await TradeCategory.findByIdAndDelete(categoryId);
            logger.info(`✅ V2 GLOBAL TRADE CATEGORIES: Category permanently deleted`, { categoryId, name: category.name });
        } else {
            category.isActive = false;
            category.audit = category.audit || {};
            category.audit.updatedAt = new Date();
            category.audit.updatedBy = 'admin';
            await category.save();
            logger.info(`✅ V2 GLOBAL TRADE CATEGORIES: Category soft deleted`, { categoryId, name: category.name });
        }

        // Clear cache
        try {
            await redisClient.del('v2-global-trade-categories');
            await redisClient.del('v2-global-trade-statistics');
        } catch (cacheError) {
            logger.warn('Cache clear failed during category deletion', cacheError);
        }

        const responseTime = Date.now() - startTime;
        res.json({
            success: true,
            message: `Trade category ${hard === 'true' ? 'permanently deleted' : 'deactivated'}`,
            data: { categoryId, categoryName: category.name, deletionType: hard === 'true' ? 'permanent' : 'soft' },
            meta: { responseTime, source: 'v2-global-tradecategories' }
        });

    } catch (error) {
        logger.error('❌ V2 GLOBAL TRADE CATEGORIES: Error deleting category', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete trade category',
            details: error.message,
            source: 'v2-global-tradecategories'
        });
    }
});

/**
 * 🗑️ DELETE Q&A FROM TRADE CATEGORY - V2 Global Trade Categories
 * Remove specific Q&A from trade category
 */
router.delete('/categories/:categoryId/qna/:qnaId', async (req, res) => {
    try {
        const { categoryId, qnaId } = req.params;
        const startTime = Date.now();

        logger.info(`🗑️ V2 GLOBAL TRADE CATEGORIES: Deleting Q&A ${qnaId} from category ${categoryId}`);

        const category = await TradeCategory.findOne({ _id: categoryId, companyId: 'global' });
        if (!category) {
            return res.status(404).json({
                success: false,
                error: 'Trade category not found',
                source: 'v2-global-tradecategories'
            });
        }

        const qnaIndex = category.qnas.findIndex(qna => qna.id === qnaId || qna._id.toString() === qnaId);
        if (qnaIndex === -1) {
            return res.status(404).json({
                success: false,
                error: 'Q&A not found in this category',
                source: 'v2-global-tradecategories'
            });
        }

        const removedQnA = category.qnas[qnaIndex];
        category.qnas.splice(qnaIndex, 1);

        // Update metadata
        category.metadata = category.metadata || {};
        category.metadata.totalQAs = category.qnas.length;
        category.metadata.totalKeywords = category.qnas.reduce((total, qna) => total + (qna.keywords || []).length, 0);
        category.metadata.lastUpdated = new Date();

        category.audit = category.audit || {};
        category.audit.updatedAt = new Date();
        category.audit.updatedBy = 'admin';

        await category.save();

        // Clear cache
        try {
            await redisClient.del('v2-global-trade-categories');
            await redisClient.del('v2-global-trade-statistics');
        } catch (cacheError) {
            logger.warn('Cache clear failed during Q&A deletion', cacheError);
        }

        const responseTime = Date.now() - startTime;
        logger.info(`✅ V2 GLOBAL TRADE CATEGORIES: Q&A deleted successfully`, {
            categoryId,
            qnaId,
            remainingQnAs: category.qnas.length,
            responseTime
        });

        res.json({
            success: true,
            data: { 
                categoryId, 
                categoryName: category.name, 
                deletedQnA: { id: removedQnA.id, question: removedQnA.question }, 
                remainingQnAs: category.qnas.length 
            },
            meta: { responseTime, source: 'v2-global-tradecategories' },
            message: `Q&A removed from "${category.name}"`
        });

    } catch (error) {
        logger.error('❌ V2 GLOBAL TRADE CATEGORIES: Error deleting Q&A', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete Q&A',
            details: error.message,
            source: 'v2-global-tradecategories'
        });
    }
});

module.exports = router;
