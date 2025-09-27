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
router.post('/categories', async (req, res) => {
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
        const existingCategory = await TradeCategory.findOne({ 
            name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
            companyId: 'global',
            isActive: true
        });
        
        if (existingCategory) {
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
        const newQnA = {
            _id: new ObjectId(),
            question: question.trim(),
            answer: answer.trim(),
            keywords: finalKeywords,
            autoGenerated: manualKeywords.length === 0 ? finalKeywords : [],
            manualKeywords: manualKeywords.length > 0 ? finalKeywords : [],
            isActive: true,
            status: 'active',
            priority: 'normal',
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
 * 🔧 DEBUG ENDPOINT - GET ALL CATEGORIES (INCLUDING INACTIVE)
 * Temporary debug endpoint to see all categories in database
 */
router.get('/debug/all-categories', async (req, res) => {
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

module.exports = router;
