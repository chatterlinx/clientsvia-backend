// routes/enterpriseTradeCategories.js
// Enterprise Trade Categories Management with AI-powered keyword generation

const express = require('express');
const router = express.Router();
const { getDB } = require('../db');
const { ObjectId } = require('mongodb');
const logger = require('../utils/logger');

// Helper functions for enterprise trade category matching
function getKeywordsForCategory(categoryName) {
    const categoryKeywords = {
        'HVAC Residential': 'hvac|heating|cooling|air conditioning|furnace|ac|thermostat|duct|ventilation',
        'Plumbing': 'plumbing|plumber|pipe|drain|water|leak|toilet|faucet|sink|shower',
        'Electrical': 'electrical|electric|wire|outlet|circuit|breaker|panel|switch|light'
    };
    
    const cleanName = categoryName.replace(/[*]/g, '').trim();
    return categoryKeywords[cleanName] || categoryName.toLowerCase();
}

function getKeywordArrayForCategory(categoryName) {
    const keywords = getKeywordsForCategory(categoryName);
    return keywords.split('|');
}

const COLLECTION_NAME = 'enterpriseTradeCategories';

// AI-powered keyword generator
// OPTIMIZED AI AGENT KEYWORD GENERATION
// Designed for fast, accurate Q&A matching during phone calls
function generateKeywords(question, answer, categoryName) {
    console.log('🔧 KEYWORD GENERATION:', { 
        question: question.substring(0, 50) + '...', 
        answer: answer.substring(0, 50) + '...',
        categoryName 
    });
    
    const text = `${question} ${answer} ${categoryName}`.toLowerCase();
    
    // PRIORITY 1: Core technical terms (high weight for AI matching)
    const technicalTerms = text.match(/\b(?:hvac|plumbing|electrical|repair|maintenance|installation|service|emergency|commercial|residential|industrial)\b/g) || [];
    
    // PRIORITY 2: Specific equipment (exact match importance)
    const equipment = text.match(/\b(?:furnace|boiler|water\s*heater|ac|air\s*conditioner|pipe|drain|circuit|breaker|outlet|switch|pump|valve|thermostat|duct|filter|unit|system)\b/g) || [];
    
    // PRIORITY 3: Service actions (what customer needs)
    const actions = text.match(/\b(?:install|repair|replace|maintain|clean|inspect|diagnose|fix|upgrade|service|troubleshoot|check)\b/g) || [];
    
    // PRIORITY 4: Problem indicators (urgent matching)
    const problems = text.match(/\b(?:broken|not\s*working|leaking|clogged|blocked|frozen|overheating|noisy|blank|dead|tripped)\b/g) || [];
    
    // PRIORITY 5: Location context
    const locations = text.match(/\b(?:basement|attic|kitchen|bathroom|garage|office|warehouse|retail|home|business)\b/g) || [];
    
    // Combine with priority weighting (most important first)
    let allKeywords = [
        ...technicalTerms,
        ...equipment, 
        ...actions,
        ...problems,
        ...locations
    ];
    
    // Add category-specific high-value keywords
    const categoryKeywords = {
        'hvac residential': ['heating', 'cooling', 'temperature', 'climate'],
        'plumbing': ['water', 'leak', 'drain', 'pipe'],
        'electrical': ['power', 'wiring', 'electric'],
        'general': ['service', 'repair']
    };
    
    const categoryKey = categoryName.toLowerCase().replace(/[*]/g, '');
    Object.keys(categoryKeywords).forEach(key => {
        if (categoryKey.includes(key) || key.includes(categoryKey.split(' ')[0])) {
            allKeywords.push(...categoryKeywords[key]);
        }
    });
    
    // CRITICAL: Ensure proper array handling and deduplication
    const uniqueKeywords = [...new Set(allKeywords.filter(k => k && k.length > 1))];
    
    // OPTIMIZATION: Limit to 8-12 most relevant keywords for fast AI matching
    const finalKeywords = uniqueKeywords.slice(0, 12);
    
    console.log('✅ KEYWORDS GENERATED:', { 
        count: finalKeywords.length, 
        keywords: finalKeywords,
        categories: { technicalTerms: technicalTerms.length, equipment: equipment.length, actions: actions.length, problems: problems.length }
    });
    
    return finalKeywords;
}

/**
 * @route   POST /api/enterprise-trade-categories
 * @desc    Create a new trade category with Q&A and auto-generated keywords
 */
router.post('/', async (req, res) => {
    try {
        const { name, description, companyId = 'global' } = req.body;
        
        if (!name || !name.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Category name is required'
            });
        }
        
        const db = getDB();
        const collection = db.collection(COLLECTION_NAME);
        
        // Check if category already exists for this company
        const existing = await collection.findOne({
            name: new RegExp(`^${name.trim()}$`, 'i'),
            companyId
        });
        
        if (existing) {
            return res.status(409).json({
                success: false,
                message: `Trade category '${name.trim()}' already exists`
            });
        }
        
        const newCategory = {
            name: name.trim(),
            description: description?.trim() || '',
            companyId,
            qnas: [],
            isActive: true,
            metadata: {
                totalQAs: 0,
                totalKeywords: 0,
                lastUpdated: new Date(),
                version: '1.0.0'
            },
            audit: {
                createdAt: new Date(),
                createdBy: req.user?.id || 'system',
                updatedAt: new Date(),
                updatedBy: req.user?.id || 'system'
            }
        };
        
        const result = await collection.insertOne(newCategory);
        
        if (result.acknowledged) {
            const created = await collection.findOne({ _id: result.insertedId });
            logger.info('Trade category created', { categoryId: result.insertedId, name, companyId });
            
            res.status(201).json({
                success: true,
                data: created,
                message: 'Trade category created successfully'
            });
        } else {
            throw new Error('Failed to create trade category');
        }
        
    } catch (error) {
        logger.error('Error creating trade category', { error: error.message, stack: error.stack });
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * @route   GET /api/enterprise-trade-categories
 * @desc    Get all trade categories for a company
 */
router.get('/', async (req, res) => {
    try {
        const { companyId = 'global', includeGlobal = 'true' } = req.query;
        console.log(`🚀 ENTERPRISE TRADE CATEGORIES: Loading for companyId="${companyId}", includeGlobal="${includeGlobal}"`);
        
        const db = getDB();
        const collection = db.collection(COLLECTION_NAME);
        
        let query = {};
        if (includeGlobal === 'true') {
            query = { $or: [{ companyId }, { companyId: 'global' }] };
        } else {
            query = { companyId };
        }
        
        const categories = await collection
            .find(query)
            .sort({ name: 1 })
            .toArray();
        
        console.log(`📋 Found ${categories.length} trade categories:`, categories.map(c => c.name));
        
        // 🔧 PRODUCTION FIX: Enrich categories with Q&A and keyword data
        const CompanyQnA = require('../models/knowledge/CompanyQnA');
        
        const enrichedCategories = await Promise.all(categories.map(async (category) => {
            try {
                // Get Q&As for this trade category
                let qnas = [];
                if (companyId && companyId !== 'global') {
                    // Company-specific Q&As
                    qnas = await CompanyQnA.find({
                        companyId: companyId,
                        tradeCategories: category.name,
                        status: { $in: ['active', 'draft', 'under_review'] } // Include all visible statuses
                    }).select('question keywords createdAt updatedAt status').lean();
                } else if (companyId === 'global') {
                    // GLOBAL TRADE CATEGORIES: Use embedded Q&As from the category document
                    console.log(`🔍 GLOBAL TRADE CATEGORY: Loading embedded Q&As for "${category.name}"`);
                    
                    // Get embedded Q&As from the category document
                    qnas = category.qnas || [];
                    
                    // Fix legacy Q&As that don't have proper _id fields or broken keywords
                    let needsUpdate = false;
                    qnas = qnas.map(qna => {
                        let qnaUpdated = false;
                        
                        // Fix missing _id
                        if (!qna._id) {
                            qna._id = new ObjectId();
                            needsUpdate = true;
                            qnaUpdated = true;
                            console.log(`🔧 Fixed legacy Q&A "${qna.question?.substring(0, 30)}..." - added _id`);
                        }
                        
                        // Fix broken keywords (character-level splits)
                        if (qna.keywords && Array.isArray(qna.keywords)) {
                            const hasBrokenKeywords = qna.keywords.some(k => k.length === 1 || k === ' ' || k === ',');
                            if (hasBrokenKeywords) {
                                console.log(`🔧 FIXING BROKEN KEYWORDS for "${qna.question?.substring(0, 30)}..."`);
                                console.log(`   OLD: [${qna.keywords.slice(0, 5).join(', ')}...]`);
                                
                                // Regenerate keywords properly
                                qna.keywords = generateKeywords(qna.question || '', qna.answer || '', category.name);
                                needsUpdate = true;
                                qnaUpdated = true;
                                
                                console.log(`   NEW: [${qna.keywords.join(', ')}]`);
                            }
                        }
                        
                        if (qnaUpdated) {
                            console.log(`✅ Updated Q&A "${qna.question?.substring(0, 30)}..."`);
                        }
                        
                        return qna;
                    });
                    
                    // Update the category document if we fixed any Q&As
                    if (needsUpdate) {
                        await collection.updateOne(
                            { _id: category._id },
                            { $set: { qnas: qnas } }
                        );
                        console.log(`✅ Updated category "${category.name}" with fixed Q&A IDs`);
                    }
                    
                    // Filter only active Q&As
                    qnas = qnas.filter(qna => qna.isActive !== false && qna.status !== 'archived');
                    
                    console.log(`🎯 EMBEDDED Q&As found for "${category.name}": ${qnas.length}`);
                }
                
                // Process Q&As to ensure autoGenerated field is populated for legacy data
                qnas = qnas.map(qna => {
                    // If autoGenerated is null/undefined, treat all keywords as auto-generated for legacy data
                    if (!qna.autoGenerated && qna.keywords && qna.keywords.length > 0) {
                        qna.autoGenerated = qna.keywords; // All keywords are auto-generated for legacy
                        qna.manualKeywords = qna.manualKeywords || [];
                        console.log(`🔧 Fixed legacy Q&A "${qna.question}" - set ${qna.keywords.length} auto keywords`);
                    }
                    return qna;
                });
                
                // Calculate total keywords from all Q&As
                const totalKeywords = qnas.reduce((total, qna) => {
                    return total + (qna.keywords ? qna.keywords.length : 0);
                }, 0);
                
                console.log(`📊 Category "${category.name}": ${qnas.length} Q&As, ${totalKeywords} total keywords`);
                
                // Get the latest update date from Q&As or category
                let lastUpdated = category.updatedAt || category.createdAt;
                if (qnas.length > 0) {
                    const latestQnA = qnas.reduce((latest, qna) => {
                        const qnaDate = qna.updatedAt || qna.createdAt;
                        return qnaDate > latest ? qnaDate : latest;
                    }, new Date(0));
                    
                    if (latestQnA > new Date(lastUpdated || 0)) {
                        lastUpdated = latestQnA;
                    }
                }
                
                return {
                    ...category,
                    qnas: qnas, // Include Q&As for frontend
                    totalKeywords: totalKeywords,
                    lastUpdated: lastUpdated
                };
            } catch (error) {
                console.error('Error enriching category:', category.name, error);
                return {
                    ...category,
                    qnas: [],
                    totalKeywords: 0,
                    lastUpdated: category.updatedAt || category.createdAt
                };
            }
        }));
        
        logger.info('Trade categories retrieved and enriched', { count: enrichedCategories.length, companyId });
        
        res.json({
            success: true,
            data: enrichedCategories,
            meta: {
                total: enrichedCategories.length,
                companyId,
                includeGlobal: includeGlobal === 'true'
            }
        });
        
    } catch (error) {
        logger.error('Error retrieving trade categories', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

/**
 * @route   POST /api/enterprise-trade-categories/qna
 * @desc    Add company-specific Trade Q&A with auto-generated trade keywords
 */
router.post('/qna', async (req, res) => {
    try {
        console.log('🚀 ENTERPRISE: Creating company-specific Trade Q&A');
        
        const { question, answer, category, companyId, tradeCategory } = req.body;
        
        if (!question?.trim() || !answer?.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Question and answer are required'
            });
        }
        
        if (!companyId) {
            return res.status(400).json({
                success: false,
                message: 'Company ID is required'
            });
        }
        
        console.log('🔧 Trade Q&A data:', { question: question.substring(0, 50), companyId, tradeCategory });
        
        // Use the CompanyQnA model for company-specific trade Q&As
        const CompanyQnA = require('../models/knowledge/CompanyQnA');
        
        // Create trade-specific Q&A entry
        const tradeQnA = new CompanyQnA({
            question: question.trim(),
            answer: answer.trim(),
            category: category || 'general',
            companyId: companyId,
            tradeCategories: tradeCategory ? [tradeCategory] : [],
            status: 'active',
            priority: 'normal',
            // Keywords will be auto-generated by the pre-save middleware
            autoGenerated: true
        });
        
        console.log('💾 Saving trade-specific Q&A to database...');
        const savedQnA = await tradeQnA.save();
        
        console.log('✅ Trade Q&A saved successfully:', savedQnA._id);
        
        // Clear Redis cache for company
        const { redisClient } = require('../clients');
        try {
            await redisClient.del(`knowledge:company:${companyId}:*`);
            console.log('🗑️ CACHE CLEARED: Company trade knowledge cache invalidated');
        } catch (cacheError) {
            console.warn('⚠️ Cache clear failed:', cacheError.message);
        }
        
        res.status(201).json({
            success: true,
            data: savedQnA,
            message: 'Trade Q&A created successfully with auto-generated keywords',
            analytics: {
                keywordsGenerated: savedQnA.keywords?.length || 0,
                tradeCategory: tradeCategory,
                confidence: savedQnA.confidence
            }
        });
        
    } catch (error) {
        console.error('❌ Failed to create Trade Q&A:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create Trade Q&A',
            error: error.message
        });
    }
});

/**
 * @route   GET /api/enterprise-trade-categories/qnas/:companyId
 * @desc    Get company-specific Trade Q&As filtered by trade categories
 */
router.get('/qnas/:companyId', async (req, res) => {
    try {
        console.log('🔍 ENTERPRISE: Loading company Trade Q&As');
        
        const { companyId } = req.params;
        const { trades, status = 'active' } = req.query;
        
        console.log('🔍 Loading Trade Q&As for company:', companyId);
        console.log('🔍 Trade filter:', trades);
        
        const CompanyQnA = require('../models/knowledge/CompanyQnA');
        
        // Build query for company-specific trade Q&As
        const query = {
            companyId: companyId
        };
        
        // Only add status filter if not 'all'
        if (status && status !== 'all') {
            query.status = status;
        }
        
        // Filter by trade categories if specified
        if (trades) {
            const tradeList = trades.split(',').map(t => t.trim());
            query.tradeCategories = { $in: tradeList };
            console.log('🔧 Filtering by trade categories:', tradeList);
        }
        
        console.log('🔍 MongoDB query for Trade Q&As:', query);
        
        const tradeQnAs = await CompanyQnA.find(query)
            .sort({ createdAt: -1 })
            .lean();
        
        console.log('✅ Trade Q&As loaded:', tradeQnAs.length);
        
        res.json({
            success: true,
            data: tradeQnAs,
            meta: {
                total: tradeQnAs.length,
                companyId: companyId,
                tradeFilter: trades,
                statusFilter: status
            }
        });
        
    } catch (error) {
        console.error('❌ Failed to load Trade Q&As:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to load Trade Q&As',
            error: error.message
        });
    }
});

/**
 * @route   GET /api/enterprise-trade-categories/stats/:companyId
 * @desc    Get Trade Q&A statistics for company
 */
router.get('/stats/:companyId', async (req, res) => {
    try {
        console.log('📊 ENTERPRISE: Loading Trade Q&A stats');
        
        const { companyId } = req.params;
        
        const CompanyQnA = require('../models/knowledge/CompanyQnA');
        
        // Get trade Q&A statistics
        const totalTradeQnAs = await CompanyQnA.countDocuments({ 
            companyId: companyId,
            tradeCategories: { $exists: true, $not: { $size: 0 } }
        });
        
        const activeTradeQnAs = await CompanyQnA.countDocuments({ 
            companyId: companyId,
            status: 'active',
            tradeCategories: { $exists: true, $not: { $size: 0 } }
        });
        
        const draftTradeQnAs = await CompanyQnA.countDocuments({ 
            companyId: companyId,
            status: 'draft',
            tradeCategories: { $exists: true, $not: { $size: 0 } }
        });
        
        const reviewTradeQnAs = await CompanyQnA.countDocuments({ 
            companyId: companyId,
            status: 'under_review',
            tradeCategories: { $exists: true, $not: { $size: 0 } }
        });
        
        // Get trade category breakdown
        const tradeBreakdown = await CompanyQnA.aggregate([
            { $match: { companyId: companyId } },
            { $unwind: '$tradeCategories' },
            { $group: { _id: '$tradeCategories', count: { $sum: 1 } } }
        ]);
        
        const stats = {
            total: totalTradeQnAs,
            active: activeTradeQnAs,
            draft: draftTradeQnAs,
            under_review: reviewTradeQnAs,
            inactive: totalTradeQnAs - activeTradeQnAs - draftTradeQnAs - reviewTradeQnAs,
            breakdown: tradeBreakdown.reduce((acc, item) => {
                acc[item._id] = item.count;
                return acc;
            }, {}),
            lastUpdated: new Date()
        };
        
        console.log('✅ Trade Q&A stats loaded:', stats);
        
        res.json({
            success: true,
            data: stats
        });
        
    } catch (error) {
        console.error('❌ Failed to load Trade Q&A stats:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to load Trade Q&A stats',
            error: error.message
        });
    }
});

/**
 * @route   POST /api/enterprise-trade-categories/:id/qna
 * @desc    Add Q&A to a trade category with auto-generated keywords
 */
router.post('/:id/qna', async (req, res) => {
    try {
        const { id } = req.params;
        const { question, answer, manualKeywords = [] } = req.body;
        
        if (!question?.trim() || !answer?.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Question and answer are required'
            });
        }
        
        const db = getDB();
        const collection = db.collection(COLLECTION_NAME);
        
        // Get the category to access its name for keyword generation
        const category = await collection.findOne({ _id: new ObjectId(id) });
        if (!category) {
            return res.status(404).json({
                success: false,
                message: 'Trade category not found'
            });
        }
        
        console.log('🔧 ADD Q&A: Creating global trade category Q&A', {
            categoryId: id,
            categoryName: category.name,
            question: question.substring(0, 50) + '...',
            manualKeywords,
            manualKeywordsCount: manualKeywords.length
        });
        
        // Handle keywords - use manual if provided, otherwise generate auto
        const hasManualKeywords = manualKeywords && manualKeywords.length > 0;
        
        if (hasManualKeywords) {
            // User specified keywords - use their list as-is
            var finalKeywords = [...new Set(manualKeywords)];
            console.log('🔧 ADD Q&A: Using user-specified keywords:', finalKeywords);
        } else {
            // No manual keywords - generate auto keywords
            const autoKeywords = generateKeywords(question, answer, category.name);
            var finalKeywords = autoKeywords;
            console.log('🔧 ADD Q&A: Generated auto keywords:', autoKeywords.length);
        }
        
        // Create embedded Q&A for global trade category (shared by all companies)
        const newQnA = {
            _id: new ObjectId(),
            question: question.trim(),
            answer: answer.trim(),
            keywords: finalKeywords,
            autoGenerated: !hasManualKeywords,
            manualKeywords: hasManualKeywords ? manualKeywords : [],
            confidence: 0.85,
            isActive: true,
            metadata: {
                createdAt: new Date(),
                createdBy: 'system',
                updatedAt: new Date(),
                usage: {
                    timesMatched: 0,
                    lastMatched: null,
                    averageConfidence: 0.85
                }
            }
        };
        
        // Add Q&A to trade category's embedded array
        const updateResult = await collection.updateOne(
            { _id: new ObjectId(id) },
            {
                $push: { qnas: newQnA },
                $inc: { 
                    'metadata.totalQAs': 1,
                    'metadata.totalKeywords': finalKeywords.length
                },
                $set: {
                    'metadata.lastUpdated': new Date(),
                    'audit.updatedAt': new Date(),
                    'audit.updatedBy': 'system'
                }
            }
        );
        
        if (updateResult.modifiedCount === 1) {
            console.log('✅ ADD Q&A: Successfully added to global trade category', {
                categoryId: id,
                categoryName: category.name,
                qnaId: newQnA._id,
                totalKeywords: finalKeywords.length,
                keywordSource: hasManualKeywords ? 'user-specified' : 'auto-generated'
            });
            
            logger.info('Q&A added to global trade category', { 
                categoryId: id, 
                qnaId: newQnA._id,
                questionPreview: question.substring(0, 50),
                keywordCount: finalKeywords.length
            });
            
            res.status(201).json({
                success: true,
                data: newQnA,
                message: 'Q&A added successfully to global trade category'
            });
        } else {
            throw new Error('Failed to add Q&A to trade category');
        }
        
    } catch (error) {
        logger.error('Error adding Q&A to trade category', { error: error.message, categoryId: req.params.id });
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

/**
 * @route   PUT /api/enterprise-trade-categories/:id/qna/:qnaId
 * @desc    Update Q&A with regenerated keywords
 */
router.put('/:id/qna/:qnaId', async (req, res) => {
    try {
        const { id, qnaId } = req.params;
        const { question, answer, manualKeywords = [] } = req.body;
        
        console.log('🔧 EDIT Q&A: Received data', { 
            categoryId: id, 
            qnaId, 
            question: question?.substring(0, 50) + '...', 
            manualKeywords,
            manualKeywordsType: typeof manualKeywords,
            manualKeywordsLength: manualKeywords?.length
        });
        
        const db = getDB();
        const collection = db.collection(COLLECTION_NAME);
        
        const category = await collection.findOne({ _id: new ObjectId(id) });
        if (!category) {
            return res.status(404).json({
                success: false,
                message: 'Trade category not found'
            });
        }
        
        // For global trade categories, Q&As are stored as embedded documents
        
        // Check if user provided specific keywords (manual editing)
        const hasManualKeywords = manualKeywords && manualKeywords.length > 0;
        
        if (hasManualKeywords) {
            // User specified keywords - use their list as-is (they've already curated it)
            const allKeywords = [...new Set(manualKeywords)]; // Just deduplicate
            
            console.log('🔧 USER-SPECIFIED KEYWORDS:', {
                userKeywords: manualKeywords,
                finalCount: allKeywords.length,
                message: 'Using user-specified keywords without auto-generation'
            });
            
            var finalKeywords = allKeywords;
            var finalManualKeywords = manualKeywords; // All keywords are considered manual when user edits
        } else {
            // No manual keywords - generate auto keywords from content
            const autoKeywords = generateKeywords(question, answer, category.name);
            
            console.log('🔧 AUTO-GENERATED KEYWORDS:', {
                autoCount: autoKeywords.length,
                autoKeywords: autoKeywords,
                message: 'Generated keywords from question/answer content'
            });
            
            var finalKeywords = autoKeywords;
            var finalManualKeywords = []; // No manual keywords specified
        }
        
        // Update embedded Q&A in trade category document
        const updateResult = await collection.updateOne(
            { 
                _id: new ObjectId(id),
                'qnas._id': new ObjectId(qnaId)
            },
            {
                $set: {
                    'qnas.$.question': question.trim(),
                    'qnas.$.answer': answer.trim(),
                    'qnas.$.keywords': finalKeywords,
                    'qnas.$.autoGenerated': !hasManualKeywords,
                    'qnas.$.manualKeywords': finalManualKeywords,
                    'qnas.$.metadata.updatedAt': new Date(),
                    'metadata.lastUpdated': new Date(),
                    'audit.updatedAt': new Date(),
                    'audit.updatedBy': 'system'
                }
            }
        );
        
        if (updateResult.modifiedCount === 1) {
            console.log('✅ EDIT Q&A: Successfully updated embedded Q&A', {
                categoryId: id,
                qnaId,
                totalKeywords: finalKeywords.length,
                keywordSource: hasManualKeywords ? 'user-specified' : 'auto-generated'
            });
            
            logger.info('Q&A updated in trade category', { categoryId: id, qnaId, keywordCount: finalKeywords.length });
            
            res.json({
                success: true,
                message: 'Q&A updated successfully with regenerated keywords'
            });
        } else {
            return res.status(404).json({
                success: false,
                message: 'Q&A not found'
            });
        }
        
    } catch (error) {
        logger.error('Error updating Q&A', { error: error.message, categoryId: req.params.id, qnaId: req.params.qnaId });
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

/**
 * @route   DELETE /api/enterprise-trade-categories/:id/qna/:qnaId
 * @desc    Delete Q&A from trade category
 */
router.delete('/:id/qna/:qnaId', async (req, res) => {
    try {
        const { id, qnaId } = req.params;
        
        const db = getDB();
        const collection = db.collection(COLLECTION_NAME);
        
        // For global trade categories, Q&As are stored as embedded documents
        const deleteResult = await collection.updateOne(
            { _id: new ObjectId(id) },
            {
                $pull: { qnas: { _id: new ObjectId(qnaId) } },
                $inc: { 'metadata.totalQAs': -1 },
                $set: {
                    'metadata.lastUpdated': new Date(),
                    'audit.updatedAt': new Date(),
                    'audit.updatedBy': 'system'
                }
            }
        );
        
        if (deleteResult.modifiedCount === 1) {
            console.log('✅ DELETE Q&A: Successfully removed from global trade category', {
                categoryId: id,
                qnaId
            });
            
            logger.info('Q&A deleted from trade category', { categoryId: id, qnaId });
            
            res.json({
                success: true,
                message: 'Q&A deleted successfully'
            });
        } else {
            return res.status(404).json({
                success: false,
                message: 'Q&A not found'
            });
        }
        
    } catch (error) {
        logger.error('Error deleting Q&A', { error: error.message, categoryId: req.params.id, qnaId: req.params.qnaId });
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

/**
 * @route   GET /api/enterprise-trade-categories/:id/keywords/regenerate
 * @desc    Regenerate keywords for all Q&As in a category
 */
router.post('/:id/keywords/regenerate', async (req, res) => {
    try {
        const { id } = req.params;
        
        const db = getDB();
        const collection = db.collection(COLLECTION_NAME);
        
        const category = await collection.findOne({ _id: new ObjectId(id) });
        if (!category) {
            return res.status(404).json({
                success: false,
                message: 'Trade category not found'
            });
        }
        
        let updatedCount = 0;
        
        if (category.qnas && category.qnas.length > 0) {
            const updatedQnAs = category.qnas.map(qna => {
                const autoKeywords = generateKeywords(qna.question, qna.answer, category.name);
                const allKeywords = [...new Set([...(qna.manualKeywords || []), ...autoKeywords])];
                
                updatedCount++;
                
                return {
                    ...qna,
                    keywords: allKeywords,
                    autoGenerated: autoKeywords.length > 0, // Boolean: true if we generated keywords
                    metadata: {
                        ...qna.metadata,
                        updatedAt: new Date()
                    }
                };
            });
            
            await collection.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: {
                        qnas: updatedQnAs,
                        'metadata.lastUpdated': new Date(),
                        'audit.updatedAt': new Date(),
                        'audit.updatedBy': req.user?.id || 'system'
                    }
                }
            );
        }
        
        logger.info('Keywords regenerated for trade category', { categoryId: id, qnaCount: updatedCount });
        
        res.json({
            success: true,
            message: `Keywords regenerated for ${updatedCount} Q&As`,
            data: { updatedCount }
        });
        
    } catch (error) {
        logger.error('Error regenerating keywords', { error: error.message, categoryId: req.params.id });
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

/**
 * @route   GET /api/enterprise-trade-categories/search
 * @desc    Search Q&As across categories by keywords or content
 */
router.get('/search', async (req, res) => {
    try {
        const { query, companyId = 'global', includeGlobal = 'true' } = req.query;
        
        if (!query?.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Search query is required'
            });
        }
        
        const db = getDB();
        const collection = db.collection(COLLECTION_NAME);
        
        let dbQuery = {};
        if (includeGlobal === 'true') {
            dbQuery = { $or: [{ companyId }, { companyId: 'global' }] };
        } else {
            dbQuery = { companyId };
        }
        
        const searchTerms = query.toLowerCase().split(/\s+/);
        
        const categories = await collection.find(dbQuery).toArray();
        const results = [];
        
        categories.forEach(category => {
            if (category.qnas) {
                category.qnas.forEach(qna => {
                    const content = `${qna.question} ${qna.answer} ${qna.keywords?.join(' ')}`.toLowerCase();
                    const matches = searchTerms.filter(term => content.includes(term));
                    
                    if (matches.length > 0) {
                        results.push({
                            categoryId: category._id,
                            categoryName: category.name,
                            qnaId: qna.id,
                            question: qna.question,
                            answer: qna.answer,
                            keywords: qna.keywords,
                            relevanceScore: matches.length / searchTerms.length,
                            matchedTerms: matches
                        });
                    }
                });
            }
        });
        
        // Sort by relevance score
        results.sort((a, b) => b.relevanceScore - a.relevanceScore);
        
        logger.info('Trade category search completed', { query, resultCount: results.length, companyId });
        
        res.json({
            success: true,
            data: results,
            meta: {
                query,
                totalResults: results.length,
                companyId,
                includeGlobal: includeGlobal === 'true'
            }
        });
        
    } catch (error) {
        logger.error('Error searching trade categories', { error: error.message, query: req.query.query });
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

/**
 * @route   DELETE /api/enterprise-trade-categories/:id
 * @desc    Delete a trade category
 */
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const db = getDB();
        const collection = db.collection(COLLECTION_NAME);
        
        const deleteResult = await collection.deleteOne({ _id: new ObjectId(id) });
        
        if (deleteResult.deletedCount === 1) {
            logger.info('Trade category deleted', { categoryId: id });
            
            res.json({
                success: true,
                message: 'Trade category deleted successfully'
            });
        } else {
            return res.status(404).json({
                success: false,
                message: 'Trade category not found'
            });
        }
        
    } catch (error) {
        logger.error('Error deleting trade category', { error: error.message, categoryId: req.params.id });
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

module.exports = router;
