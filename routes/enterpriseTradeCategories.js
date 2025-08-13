// routes/enterpriseTradeCategories.js
// Enterprise Trade Categories Management with AI-powered keyword generation

const express = require('express');
const router = express.Router();
const { getDB } = require('../db');
const { ObjectId } = require('mongodb');
const logger = require('../utils/logger');

const COLLECTION_NAME = 'enterpriseTradeCategories';

// AI-powered keyword generator
function generateKeywords(question, answer, categoryName) {
    const text = `${question} ${answer} ${categoryName}`.toLowerCase();
    
    // Extract technical terms, brand names, and service types
    const technicalTerms = text.match(/\b(?:hvac|plumbing|electrical|repair|maintenance|installation|service|emergency|commercial|residential|industrial)\b/g) || [];
    
    // Extract specific equipment/systems
    const equipment = text.match(/\b(?:furnace|boiler|water\s*heater|ac|air\s*conditioner|pipe|drain|circuit|breaker|outlet|switch|pump|valve|thermostat|duct|filter)\b/g) || [];
    
    // Extract service actions
    const actions = text.match(/\b(?:install|repair|replace|maintain|clean|inspect|diagnose|fix|upgrade|service|troubleshoot)\b/g) || [];
    
    // Extract urgency indicators
    const urgency = text.match(/\b(?:emergency|urgent|immediate|asap|leak|flood|no\s*heat|no\s*cooling|outage|broken)\b/g) || [];
    
    // Extract location indicators
    const locations = text.match(/\b(?:basement|attic|kitchen|bathroom|garage|office|warehouse|retail|home|business)\b/g) || [];
    
    // Combine and deduplicate
    const allKeywords = [...new Set([
        ...technicalTerms,
        ...equipment,
        ...actions,
        ...urgency,
        ...locations
    ])];
    
    // Add category-specific keywords
    const categoryKeywords = {
        'hvac': ['heating', 'cooling', 'ventilation', 'climate', 'temperature'],
        'plumbing': ['water', 'sewer', 'drainage', 'pipes', 'fixtures'],
        'electrical': ['power', 'wiring', 'outlets', 'lighting', 'voltage'],
        'general': ['maintenance', 'repair', 'service', 'inspection']
    };
    
    const categoryKey = categoryName.toLowerCase();
    if (categoryKeywords[categoryKey]) {
        allKeywords.push(...categoryKeywords[categoryKey]);
    }
    
    return [...new Set(allKeywords)].slice(0, 15); // Limit to 15 most relevant keywords
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
        
        logger.info('Trade categories retrieved', { count: categories.length, companyId });
        
        res.json({
            success: true,
            data: categories,
            meta: {
                total: categories.length,
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
        
        // Generate keywords automatically
        const autoKeywords = generateKeywords(question, answer, category.name);
        
        // Combine manual and auto-generated keywords, remove duplicates
        const allKeywords = [...new Set([...manualKeywords, ...autoKeywords])];
        
        const newQnA = {
            id: new ObjectId(),
            question: question.trim(),
            answer: answer.trim(),
            keywords: allKeywords,
            autoGenerated: autoKeywords,
            manualKeywords: manualKeywords,
            confidence: 0.85, // Default confidence score
            isActive: true,
            metadata: {
                createdAt: new Date(),
                createdBy: req.user?.id || 'system',
                updatedAt: new Date(),
                usage: {
                    timesMatched: 0,
                    lastMatched: null,
                    averageConfidence: 0.85
                }
            }
        };
        
        const updateResult = await collection.updateOne(
            { _id: new ObjectId(id) },
            {
                $push: { qnas: newQnA },
                $inc: { 
                    'metadata.totalQAs': 1,
                    'metadata.totalKeywords': allKeywords.length
                },
                $set: {
                    'metadata.lastUpdated': new Date(),
                    'audit.updatedAt': new Date(),
                    'audit.updatedBy': req.user?.id || 'system'
                }
            }
        );
        
        if (updateResult.modifiedCount === 1) {
            logger.info('Q&A added to trade category', { 
                categoryId: id, 
                questionPreview: question.substring(0, 50),
                keywordCount: allKeywords.length
            });
            
            res.status(201).json({
                success: true,
                data: newQnA,
                message: 'Q&A added successfully with auto-generated keywords'
            });
        } else {
            throw new Error('Failed to add Q&A to category');
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
        
        const db = getDB();
        const collection = db.collection(COLLECTION_NAME);
        
        const category = await collection.findOne({ _id: new ObjectId(id) });
        if (!category) {
            return res.status(404).json({
                success: false,
                message: 'Trade category not found'
            });
        }
        
        // Regenerate keywords if question or answer changed
        const autoKeywords = generateKeywords(question, answer, category.name);
        const allKeywords = [...new Set([...manualKeywords, ...autoKeywords])];
        
        const updateResult = await collection.updateOne(
            { 
                _id: new ObjectId(id),
                'qnas.id': new ObjectId(qnaId)
            },
            {
                $set: {
                    'qnas.$.question': question.trim(),
                    'qnas.$.answer': answer.trim(),
                    'qnas.$.keywords': allKeywords,
                    'qnas.$.autoGenerated': autoKeywords,
                    'qnas.$.manualKeywords': manualKeywords,
                    'qnas.$.metadata.updatedAt': new Date(),
                    'metadata.lastUpdated': new Date(),
                    'audit.updatedAt': new Date(),
                    'audit.updatedBy': req.user?.id || 'system'
                }
            }
        );
        
        if (updateResult.modifiedCount === 1) {
            logger.info('Q&A updated in trade category', { categoryId: id, qnaId, keywordCount: allKeywords.length });
            
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
        
        const updateResult = await collection.updateOne(
            { _id: new ObjectId(id) },
            {
                $pull: { qnas: { id: new ObjectId(qnaId) } },
                $inc: { 'metadata.totalQAs': -1 },
                $set: {
                    'metadata.lastUpdated': new Date(),
                    'audit.updatedAt': new Date(),
                    'audit.updatedBy': req.user?.id || 'system'
                }
            }
        );
        
        if (updateResult.modifiedCount === 1) {
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
                    autoGenerated: autoKeywords,
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

// Global Q&As endpoint - Get all Q&As from all categories
router.get('/qas', async (req, res) => {
    try {
        const db = getDB();
        const collection = db.collection(COLLECTION_NAME);
        
        const { categoryNames, activeOnly = 'true' } = req.query;
        const query = { companyId: 'global' };
        
        // Filter by category names if provided
        if (categoryNames) {
            const names = categoryNames.split(',').map(name => name.trim());
            query.name = { $in: names };
        }
        
        // Get all categories
        const categories = await collection.find(query).toArray();
        
        // Extract all Q&As from all categories
        const allQAs = [];
        categories.forEach(category => {
            if (category.qnas && Array.isArray(category.qnas)) {
                category.qnas.forEach(qna => {
                    // Filter active only if requested
                    if (activeOnly === 'false' || qna.isActive !== false) {
                        allQAs.push({
                            ...qna,
                            categoryId: category._id,
                            categoryName: category.name,
                            categoryDescription: category.description
                        });
                    }
                });
            }
        });
        
        // Sort by confidence score descending
        allQAs.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
        
        logger.info('Fetched all Q&As', { 
            totalCategories: categories.length,
            totalQAs: allQAs.length,
            categoryNames: categoryNames || 'all'
        });
        
        res.json({
            success: true,
            data: allQAs,
            meta: {
                totalCategories: categories.length,
                totalQAs: allQAs.length,
                activeOnly: activeOnly === 'true',
                categories: categories.map(cat => ({
                    id: cat._id,
                    name: cat.name,
                    qnaCount: cat.qnas ? cat.qnas.length : 0
                }))
            }
        });
        
    } catch (error) {
        logger.error('Error fetching all Q&As', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

module.exports = router;
