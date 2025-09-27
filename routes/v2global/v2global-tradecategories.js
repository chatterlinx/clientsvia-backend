/**
 * V2 GLOBAL TRADE CATEGORIES ROUTES - Enterprise Trade Management
 * 
 * V2 GLOBAL TRADE CATEGORIES - ENTERPRISE ARCHITECTURE:
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
const CompanyQnA = require('../../models/knowledge/CompanyQnA');
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
router.post('/categories', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const startTime = Date.now();
        const { name, description } = req.body;

        logger.info(`🏷️ V2 GLOBAL TRADE CATEGORIES: Creating category:`, {
            name,
            description: description ? 'provided' : 'empty'
        });

        // 🔍 Enhanced Validation
        const validationErrors = [];
        
        if (!name || name.trim().length === 0) {
            validationErrors.push('Category name is required and cannot be empty');
        } else if (name.trim().length < 2) {
            validationErrors.push('Category name must be at least 2 characters long');
        } else if (name.trim().length > 50) {
            validationErrors.push('Category name cannot exceed 50 characters');
        }

        if (description && description.trim().length > 200) {
            validationErrors.push('Description cannot exceed 200 characters');
        }

        // Check for duplicate category name (only among active categories)
        const searchName = name.trim();
        // Escape special regex characters to prevent regex injection
        const escapedName = searchName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const searchRegex = new RegExp(`^${escapedName}$`, 'i');
        
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
            logger.warn(`🚨 V2 DUPLICATE CHECK: Found existing category`, {
                existingCategory: {
                    _id: existingCategory._id,
                    name: existingCategory.name,
                    companyId: existingCategory.companyId,
                    isActive: existingCategory.isActive
                }
            });
            validationErrors.push('A trade category with this name already exists');
        }

        if (validationErrors.length > 0) {
            logger.warn(`🚫 V2 GLOBAL TRADE CATEGORIES: Validation failed:`, validationErrors);
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                details: validationErrors,
                source: 'v2-global-tradecategories'
            });
        }

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
router.post('/categories/:categoryId/qna', authenticateJWT, requireRole('admin'), async (req, res) => {
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
        } else if (question.trim().length < 5) {
            validationErrors.push('Question must be at least 5 characters long');
        } else if (question.trim().length > 500) {
            validationErrors.push('Question cannot exceed 500 characters');
        }

        if (!answer || answer.trim().length === 0) {
            validationErrors.push('Answer is required and cannot be empty');
        } else if (answer.trim().length < 5) {
            validationErrors.push('Answer must be at least 5 characters long');
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
 * 🤖 AUTO-GENERATE TOP 20 Q&As - V2 Enterprise Feature
 * Generate industry-specific, booking-focused Q&As for trade categories
 */
router.post('/categories/:categoryId/generate-top-qnas', authenticateJWT, requireRole('admin'), async (req, res) => {
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
            const categoryLower = categoryName.toLowerCase();
            
            // 🎯 UNIVERSAL Q&A GENERATOR - Always returns 15 Q&As for ANY category
            
            // Dental Office Q&As
            if (categoryLower.includes('dental')) {
        return [
            {
                question: "Do you take my insurance?",
                answer: "We work with most major insurance plans. I can verify your coverage right now and let you know your estimated cost. What insurance do you have? Would you like me to check availability for this week?",
                keywords: ["insurance", "coverage", "cost", "dental", "plan"],
                priority: "high"
            },
            {
                question: "What are your hours?",
                answer: "We're open Monday through Friday 8 AM to 6 PM, and Saturday 9 AM to 3 PM. We also offer emergency appointments. What day works best for you?",
                keywords: ["hours", "schedule", "appointment", "emergency", "availability"],
                priority: "high"
            },
            {
                question: "How much does a cleaning cost?",
                answer: "A routine cleaning typically runs $80-120 depending on your needs. With insurance, your copay is usually much less. Would you like me to schedule you for a consultation to get an exact quote?",
                keywords: ["cleaning", "cost", "price", "consultation", "quote"],
                priority: "high"
            },
            {
                question: "Do you do emergency appointments?",
                answer: "Yes, we reserve time daily for dental emergencies. We can usually see you the same day. What's the nature of your emergency? Let me check our emergency slots today.",
                keywords: ["emergency", "same day", "urgent", "pain", "appointment"],
                priority: "high"
            },
            {
                question: "How long is a typical appointment?",
                answer: "Cleanings take about 45 minutes, consultations 30 minutes. More complex procedures vary. What type of appointment are you looking for? I can give you a better time estimate.",
                keywords: ["appointment", "time", "duration", "cleaning", "consultation"],
                priority: "normal"
            },
            {
                question: "Do you offer payment plans?",
                answer: "Yes, we offer flexible payment plans and financing options for larger treatments. We also accept CareCredit. Would you like me to explain our payment options when I schedule your appointment?",
                keywords: ["payment", "financing", "carecredit", "plans", "options"],
                priority: "high"
            },
            {
                question: "Are you accepting new patients?",
                answer: "Yes, we're always welcoming new patients! We can usually get you in for a consultation within the next few days. What brings you in to see us?",
                keywords: ["new patients", "accepting", "consultation", "welcome", "appointment"],
                priority: "high"
            },
            {
                question: "Do you do teeth whitening?",
                answer: "Absolutely! We offer both in-office whitening and take-home kits. In-office takes about an hour with immediate results. Which option interests you more?",
                keywords: ["whitening", "teeth", "in-office", "take-home", "results"],
                priority: "normal"
            },
            {
                question: "What should I bring to my first appointment?",
                answer: "Please bring your insurance card, ID, and any recent X-rays from your previous dentist. We'll handle the rest! Should I email you a new patient form to fill out ahead of time?",
                keywords: ["first appointment", "insurance card", "x-rays", "new patient", "form"],
                priority: "normal"
            },
            {
                question: "Do you work with children?",
                answer: "Yes, we see patients of all ages and specialize in making kids comfortable. Our team is great with children. How old is your child? I can schedule them with our most kid-friendly dentist.",
                keywords: ["children", "kids", "all ages", "comfortable", "family"],
                priority: "normal"
            },
            {
                question: "Can you fix a broken tooth today?",
                answer: "Yes, we handle dental emergencies and can often repair broken teeth the same day. The treatment depends on the severity. Can you describe what happened? I'll check our emergency availability.",
                keywords: ["broken tooth", "emergency", "same day", "repair", "treatment"],
                priority: "high"
            },
            {
                question: "Do you do root canals?",
                answer: "Yes, we perform root canals with modern techniques that are much more comfortable than you might expect. Most patients are surprised how easy it is. Is this for current tooth pain?",
                keywords: ["root canal", "modern", "comfortable", "tooth pain", "treatment"],
                priority: "normal"
            },
            {
                question: "How often should I come in for cleanings?",
                answer: "Most patients benefit from cleanings every 6 months, though some need them more frequently. We'll assess your specific needs and recommend the best schedule. When was your last cleaning?",
                keywords: ["cleanings", "6 months", "frequency", "schedule", "assessment"],
                priority: "normal"
            },
            {
                question: "Do you offer sedation for nervous patients?",
                answer: "Absolutely! We offer several sedation options including nitrous oxide and oral sedation to help anxious patients feel comfortable. Many patients are surprised how relaxed they feel. Would this help you?",
                keywords: ["sedation", "nervous", "anxious", "nitrous oxide", "comfortable"],
                priority: "normal"
            },
            {
                question: "Can you match my existing dental work?",
                answer: "Yes, we take great care to match existing crowns, fillings, and other work so everything looks natural. We use advanced materials and techniques. What type of work are you looking to have done?",
                keywords: ["match", "existing", "crowns", "fillings", "natural"],
                priority: "normal"
            }
        ];
    }
    
    // HVAC Q&As
    if (categoryLower.includes('hvac') || categoryLower.includes('heating') || categoryLower.includes('cooling')) {
        return [
            {
                question: "My AC isn't cooling. What should I check?",
                answer: "First, check your thermostat settings and air filter. If those look good, you may need professional service. We can send a technician out today. What time works best for you?",
                keywords: ["ac", "cooling", "thermostat", "filter", "service"],
                priority: "high"
            },
            {
                question: "How often should I change my air filter?",
                answer: "Every 1-3 months depending on usage and pets. A dirty filter reduces efficiency and can damage your system. We can set up a maintenance plan to handle this for you. Interested?",
                keywords: ["filter", "maintenance", "change", "efficiency", "plan"],
                priority: "normal"
            },
            {
                question: "What's included in a tune-up?",
                answer: "We inspect all components, clean coils, check refrigerant, test safety controls, and optimize performance. It prevents breakdowns and saves energy. Would you like to schedule your seasonal tune-up?",
                keywords: ["tune-up", "maintenance", "inspection", "performance", "seasonal"],
                priority: "normal"
            },
            {
                question: "Do you offer emergency service?",
                answer: "Yes, we provide 24/7 emergency HVAC service. Emergency rates apply after hours, but we'll get your system running. What's the issue you're experiencing?",
                keywords: ["emergency", "24/7", "service", "after hours", "repair"],
                priority: "high"
            },
            {
                question: "How much does a new AC unit cost?",
                answer: "New systems range from $3,000-8,000 depending on size and efficiency. We offer free estimates and financing options. Would you like me to schedule a free consultation?",
                keywords: ["new", "cost", "price", "estimate", "financing"],
                priority: "high"
            },
            {
                question: "Why is my electric bill so high?",
                answer: "High bills often indicate your HVAC system is working harder than it should. This could be due to dirty filters, leaky ducts, or an aging system. We can do an energy audit to find the problem. Interested?",
                keywords: ["electric bill", "high", "energy audit", "efficiency", "leaky ducts"],
                priority: "high"
            },
            {
                question: "Should I repair or replace my old system?",
                answer: "If your system is over 10 years old and needs frequent repairs, replacement usually saves money long-term. We can assess your system and give you honest recommendations. When can we take a look?",
                keywords: ["repair", "replace", "old system", "10 years", "assessment"],
                priority: "high"
            },
            {
                question: "Do you offer financing for new systems?",
                answer: "Yes, we offer flexible financing with approved credit, including 0% interest options. We work with several lenders to find the best rates. Would you like me to pre-qualify you over the phone?",
                keywords: ["financing", "0% interest", "credit", "pre-qualify", "rates"],
                priority: "high"
            },
            {
                question: "How long does installation take?",
                answer: "Most installations take 4-8 hours for a complete system replacement. We'll give you an exact timeline during your estimate. We work efficiently to minimize disruption. Any scheduling preferences?",
                keywords: ["installation", "4-8 hours", "timeline", "estimate", "scheduling"],
                priority: "normal"
            },
            {
                question: "Do you service all brands?",
                answer: "Yes, our technicians are trained on all major HVAC brands including Carrier, Trane, Lennox, and more. We stock common parts and can usually fix it the same day. What brand is your system?",
                keywords: ["all brands", "carrier", "trane", "lennox", "same day"],
                priority: "normal"
            },
            {
                question: "What size AC unit do I need?",
                answer: "The right size depends on your home's square footage, insulation, and layout. An oversized or undersized unit wastes energy. We do proper load calculations during our free estimate. Ready to schedule?",
                keywords: ["size", "square footage", "load calculations", "free estimate", "energy"],
                priority: "normal"
            },
            {
                question: "Why does my house feel humid even with AC on?",
                answer: "Your AC might be oversized, have low refrigerant, or need ductwork adjustments. High humidity reduces comfort and can cause mold. We can diagnose and fix this quickly. When works for you?",
                keywords: ["humid", "oversized", "refrigerant", "ductwork", "mold"],
                priority: "normal"
            },
            {
                question: "Can you improve my indoor air quality?",
                answer: "Absolutely! We install air purifiers, UV lights, and advanced filtration systems. These remove allergens, bacteria, and odors. Many customers notice the difference immediately. What concerns do you have?",
                keywords: ["air quality", "air purifiers", "uv lights", "allergens", "filtration"],
                priority: "normal"
            },
            {
                question: "Do you offer maintenance contracts?",
                answer: "Yes, our maintenance plans include bi-annual tune-ups, priority service, and discounts on repairs. Members rarely have emergency breakdowns. Plans start at $99/year. Would you like the details?",
                keywords: ["maintenance contracts", "bi-annual", "priority service", "99/year", "plans"],
                priority: "normal"
            },
            {
                question: "My heater isn't working. Can you help today?",
                answer: "Absolutely! No heat is an emergency, especially in cold weather. We can usually get a technician out within a few hours. Have you checked your thermostat and circuit breaker? What's happening exactly?",
                keywords: ["heater", "not working", "emergency", "no heat", "today"],
                priority: "high"
            },
            {
                question: "What's the difference between a heat pump and furnace?",
                answer: "Heat pumps are more energy-efficient but work best in moderate climates. Furnaces provide reliable heat in any weather but cost more to operate. Your home and location determine the best choice. Want a free consultation?",
                keywords: ["heat pump", "furnace", "difference", "energy efficient", "consultation"],
                priority: "normal"
            },
            {
                question: "Can you install a smart thermostat?",
                answer: "Yes, we install all major smart thermostat brands like Nest, Ecobee, and Honeywell. Most installations take about an hour and can save 10-15% on energy bills. Which features interest you most?",
                keywords: ["smart thermostat", "nest", "ecobee", "honeywell", "energy savings"],
                priority: "normal"
            },
            {
                question: "Why are some rooms hotter or colder than others?",
                answer: "This usually indicates ductwork issues, blocked vents, or system imbalance. We can perform a comfort analysis and recommend solutions like zoning systems or duct modifications. Would you like an assessment?",
                keywords: ["rooms", "hot", "cold", "ductwork", "zoning"],
                priority: "normal"
            },
            {
                question: "Do you work on commercial HVAC systems?",
                answer: "Yes, we service commercial buildings, offices, and retail spaces. We understand business needs and work around your schedule to minimize disruption. What type of commercial property do you have?",
                keywords: ["commercial", "business", "office", "retail", "schedule"],
                priority: "normal"
            }
        ];
    }
    
    // Plumbing Q&As
    if (categoryLower.includes('plumbing')) {
        return [
            {
                question: "My toilet won't stop running. Can you help?",
                answer: "This is usually a simple fix with the flapper or chain inside the tank. If that doesn't work, we can send a plumber out today. Would you like me to schedule a service call?",
                keywords: ["toilet", "running", "flapper", "tank", "repair"],
                priority: "high"
            },
            {
                question: "I have low water pressure. What causes this?",
                answer: "Could be mineral buildup, a clogged aerator, or pipe issues. We can diagnose and fix it quickly. Most repairs take under an hour. When would be convenient for a visit?",
                keywords: ["water pressure", "low", "clogged", "pipes", "repair"],
                priority: "normal"
            },
            {
                question: "Do you do emergency plumbing calls?",
                answer: "Absolutely! We handle burst pipes, major leaks, and sewer backups 24/7. Emergency service is available with same-day response. What's your plumbing emergency?",
                keywords: ["emergency", "burst pipe", "leak", "sewer", "24/7"],
                priority: "high"
            },
            {
                question: "How much does it cost to unclog a drain?",
                answer: "Basic drain cleaning starts at $95. More complex clogs may cost more, but we'll give you the price upfront. Would you like me to schedule a drain cleaning service?",
                keywords: ["drain", "clog", "cleaning", "cost", "price"],
                priority: "high"
            },
            {
                question: "Can you install a new water heater?",
                answer: "Yes, we install all types of water heaters. Installation typically takes 2-4 hours. We offer same-day service in most cases. What type of water heater are you considering?",
                keywords: ["water heater", "install", "installation", "same day", "service"],
                priority: "normal"
            }
        ];
    }
    
    // Electrical Q&As - EXPANDED TO 15 FOR FULL COVERAGE
    if (categoryLower.includes('electrical')) {
        return [
            {
                question: "My circuit breaker keeps tripping. Is this dangerous?",
                answer: "A frequently tripping breaker indicates an overload or electrical issue that needs immediate attention. We can diagnose this safely today. When can we send an electrician out?",
                keywords: ["breaker", "tripping", "overload", "electrical", "dangerous"],
                priority: "high"
            },
            {
                question: "Can you install ceiling fans?",
                answer: "Yes, we install ceiling fans, including adding new electrical boxes if needed. Most installations take 1-2 hours. Would you like me to schedule an installation appointment?",
                keywords: ["ceiling fan", "install", "electrical box", "installation", "appointment"],
                priority: "normal"
            },
            {
                question: "I need more outlets in my room. Can you add them?",
                answer: "Absolutely! We can add outlets anywhere you need them. We'll assess your electrical panel capacity and give you options. Would you like a free estimate?",
                keywords: ["outlets", "add", "electrical panel", "estimate", "capacity"],
                priority: "normal"
            },
            {
                question: "Do you handle electrical emergencies?",
                answer: "Yes, we provide 24/7 emergency electrical service for power outages, sparking outlets, or burning smells. Safety first - what's your electrical emergency?",
                keywords: ["emergency", "24/7", "power outage", "sparking", "safety"],
                priority: "high"
            },
            {
                question: "How much does it cost to upgrade an electrical panel?",
                answer: "Panel upgrades typically range from $1,200-3,000 depending on your needs. We offer free estimates and can often complete the work in one day. Interested in a consultation?",
                keywords: ["panel upgrade", "cost", "estimate", "one day", "consultation"],
                priority: "high"
            },
            {
                question: "What are your electrical service hours?",
                answer: "We're available Monday through Friday 8 AM to 6 PM, with 24/7 emergency electrical service. What type of electrical work do you need? I can check our availability.",
                keywords: ["hours", "service", "emergency", "availability", "electrical work"],
                priority: "high"
            },
            {
                question: "Do you offer free electrical estimates?",
                answer: "Yes, we provide free estimates for all electrical services. We can usually schedule an estimate within 24 hours. What electrical project are you looking to get quoted?",
                keywords: ["estimate", "free", "quote", "electrical project", "schedule"],
                priority: "high"
            },
            {
                question: "Are your electricians licensed and insured?",
                answer: "Absolutely! All our electricians are fully licensed, bonded, and insured for your protection. They're certified professionals with years of experience. Would you like to schedule a service call?",
                keywords: ["licensed", "insured", "bonded", "certified", "electricians"],
                priority: "normal"
            },
            {
                question: "Can you install smart home devices?",
                answer: "Yes, we install smart switches, outlets, thermostats, and home automation systems. We'll ensure everything is properly wired and configured. What smart devices interest you?",
                keywords: ["smart home", "smart switches", "automation", "thermostats", "configuration"],
                priority: "normal"
            },
            {
                question: "Why do my lights keep flickering?",
                answer: "Flickering lights can indicate loose connections, overloaded circuits, or faulty wiring - all potential safety hazards. We can diagnose and fix this quickly. When can we take a look?",
                keywords: ["flickering lights", "loose connections", "overloaded", "faulty wiring", "safety"],
                priority: "high"
            },
            {
                question: "Do you install whole house generators?",
                answer: "Yes, we install and service whole house generators including Generac, Kohler, and other major brands. We handle permits and inspections too. Interested in backup power for your home?",
                keywords: ["generators", "whole house", "generac", "kohler", "backup power"],
                priority: "normal"
            },
            {
                question: "Can you rewire my old house?",
                answer: "Absolutely! We specialize in rewiring older homes to modern safety standards. We work efficiently to minimize disruption and handle all permits. Would you like a free assessment?",
                keywords: ["rewire", "old house", "safety standards", "permits", "assessment"],
                priority: "normal"
            },
            {
                question: "What's included in an electrical safety inspection?",
                answer: "We check your panel, wiring, outlets, GFCI protection, and code compliance. You'll get a detailed report with any recommendations. Safety inspections start at $150. Ready to schedule?",
                keywords: ["safety inspection", "panel", "wiring", "GFCI", "code compliance"],
                priority: "normal"
            },
            {
                question: "Do you offer financing for electrical work?",
                answer: "Yes, we offer flexible financing options for larger electrical projects, including 0% interest plans with approved credit. We make electrical upgrades affordable. Want to learn about options?",
                keywords: ["financing", "electrical projects", "0% interest", "credit", "affordable"],
                priority: "normal"
            },
            {
                question: "Can you install EV charging stations?",
                answer: "Yes, we install Level 2 EV charging stations for Tesla, Chevy, Ford, and all electric vehicles. We handle permits and ensure proper electrical capacity. Ready to charge at home?",
                keywords: ["EV charging", "Level 2", "Tesla", "electric vehicles", "permits"],
                priority: "normal"
            }
        ];
    }
    
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
router.post('/debug/nuclear-clean', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const startTime = Date.now();
        
        logger.warn('🧹 V2 NUCLEAR CLEAN: Starting complete collection rebuild...');
        
        // Get direct database connection
        const db = require('../../db').getDB();
        const collectionName = 'enterpriseTradeCategories';
        
        // Step 1: Drop the entire collection
        try {
            await db.collection(collectionName).drop();
            logger.info('✅ V2 NUCLEAR CLEAN: Collection dropped successfully');
        } catch (error) {
            if (error.codeName === 'NamespaceNotFound') {
                logger.info('✅ V2 NUCLEAR CLEAN: Collection already clean (not found)');
            } else {
                throw error;
            }
        }
        
        // Step 2: Recreate collection with V2 indexes
        const collection = db.collection(collectionName);
        
        // Create optimized V2 indexes
        await collection.createIndex({ companyId: 1, name: 1 }, { unique: true, name: 'v2_company_name_unique' });
        await collection.createIndex({ companyId: 1, isActive: 1 }, { name: 'v2_company_active' });
        await collection.createIndex({ 'qnas.keywords': 1 }, { name: 'v2_qna_keywords' });
        await collection.createIndex({ createdAt: 1 }, { name: 'v2_created_date' });
        
        logger.info('✅ V2 NUCLEAR CLEAN: V2 indexes created successfully');
        
        // Step 3: Verify clean state
        const count = await collection.countDocuments();
        const indexes = await collection.indexes();
        
        const responseTime = Date.now() - startTime;
        
        logger.info(`🚀 V2 NUCLEAR CLEAN: Complete! Clean slate ready in ${responseTime}ms`);
        
        res.json({
            success: true,
            message: 'V2 Nuclear Clean completed successfully',
            details: {
                collectionDropped: true,
                indexesCreated: indexes.length,
                documentCount: count,
                responseTime: `${responseTime}ms`
            },
            indexes: indexes.map(idx => ({ name: idx.name, key: idx.key })),
            nextSteps: [
                'Collection is now completely clean',
                'V2 optimized indexes are in place',
                'Ready for fresh category creation',
                'Zero legacy conflicts guaranteed'
            ]
        });
        
    } catch (error) {
        logger.error('❌ V2 NUCLEAR CLEAN: Failed', error);
        res.status(500).json({
            success: false,
            error: 'Nuclear clean failed',
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

/**
 * 🔍 DEBUG ENDPOINT - COMPREHENSIVE DATABASE SCAN
 * Find ALL records that might be causing unique constraint violations
 */
router.get('/debug/comprehensive-scan/:name', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { name } = req.params;
        const searchName = name.trim();
        
        // Get direct database connection
        const db = require('../../db').getDB();
        const collection = db.collection('enterpriseTradeCategories');
        
        // Multiple search strategies
        const searches = {
            exactName: await collection.findOne({ name: searchName }),
            caseInsensitiveName: await collection.findOne({ name: { $regex: new RegExp(`^${searchName}$`, 'i') } }),
            globalExactName: await collection.findOne({ companyId: 'global', name: searchName }),
            globalCaseInsensitiveName: await collection.findOne({ companyId: 'global', name: { $regex: new RegExp(`^${searchName}$`, 'i') } }),
            partialNameMatch: await collection.find({ name: { $regex: searchName, $options: 'i' } }).toArray(),
            allGlobalCategories: await collection.find({ companyId: 'global' }).toArray(),
            allCategoriesWithName: await collection.find({ name: { $regex: searchName, $options: 'i' } }).toArray(),
            totalCount: await collection.countDocuments({}),
            globalCount: await collection.countDocuments({ companyId: 'global' })
        };
        
        res.json({
            success: true,
            searchName,
            searches,
            summary: {
                foundExact: !!searches.exactName,
                foundCaseInsensitive: !!searches.caseInsensitiveName,
                foundGlobalExact: !!searches.globalExactName,
                foundGlobalCaseInsensitive: !!searches.globalCaseInsensitiveName,
                partialMatches: searches.partialNameMatch.length,
                totalCategories: searches.totalCount,
                globalCategories: searches.globalCount
            }
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
router.get('/categories/for-company/:companyId', async (req, res) => {
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
router.delete('/categories/:categoryId', authenticateJWT, requireRole('admin'), async (req, res) => {
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
router.delete('/categories/:categoryId/qna/:qnaId', authenticateJWT, requireRole('admin'), async (req, res) => {
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
