// Temporary debug route to check Q&A data in production
const express = require('express');
const router = express.Router();

/**
 * @route   GET /api/debug/qna
 * @desc    Debug endpoint to check Q&A data in production database
 */
router.get('/qna', async (req, res) => {
    try {
        const CompanyQnA = require('../models/knowledge/CompanyQnA');
        
        console.log('🔍 DEBUG: Checking Q&A collection...');
        
        // Get all Q&As
        const allQnAs = await CompanyQnA.find({}).lean();
        console.log(`📊 Total Q&As found: ${allQnAs.length}`);
        
        const result = {
            total: allQnAs.length,
            qnas: allQnAs.map(qna => ({
                _id: qna._id,
                question: qna.question?.substring(0, 100) + '...',
                answer: qna.answer?.substring(0, 100) + '...',
                companyId: qna.companyId,
                tradeCategories: qna.tradeCategories,
                keywords: qna.keywords?.length || 0,
                status: qna.status,
                createdAt: qna.createdAt
            }))
        };
        
        res.json({
            success: true,
            data: result
        });
        
    } catch (error) {
        console.error('❌ Debug Q&A failed:', error);
        res.status(500).json({
            success: false,
            message: 'Debug failed',
            error: error.message
        });
    }
});

/**
 * @route   GET /api/debug/collections
 * @desc    Debug endpoint to check what collections exist
 */
router.get('/collections', async (req, res) => {
    try {
        const mongoose = require('mongoose');
        const db = mongoose.connection.db;
        
        const collections = await db.listCollections().toArray();
        const collectionInfo = {};
        
        for (const col of collections) {
            const count = await db.collection(col.name).countDocuments();
            collectionInfo[col.name] = count;
        }
        
        res.json({
            success: true,
            data: {
                collections: collectionInfo,
                totalCollections: collections.length
            }
        });
        
    } catch (error) {
        console.error('❌ Debug collections failed:', error);
        res.status(500).json({
            success: false,
            message: 'Debug failed',
            error: error.message
        });
    }
});

module.exports = router;
