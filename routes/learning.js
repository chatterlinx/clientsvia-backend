const express = require('express');
const router = express.Router();
const SuggestedKnowledgeEntry = require('../models/SuggestedKnowledgeEntry');
const KnowledgeEntry = require('../models/KnowledgeEntry');
const Company = require('../models/Company');

// Get analytics data for the learning dashboard
router.get('/analytics/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        // Get counts and statistics
        const pendingSuggestions = await SuggestedKnowledgeEntry.countDocuments({
            companyId,
            status: 'pending'
        });
        
        const approvedSuggestions = await SuggestedKnowledgeEntry.countDocuments({
            companyId,
            status: 'approved'
        });
        
        const rejectedSuggestions = await SuggestedKnowledgeEntry.countDocuments({
            companyId,
            status: 'rejected'
        });
        
        const totalKnowledgeEntries = await KnowledgeEntry.countDocuments({
            companyId
        });
        
        // Get recent activity (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const recentSuggestions = await SuggestedKnowledgeEntry.countDocuments({
            companyId,
            createdAt: { $gte: thirtyDaysAgo }
        });
        
        res.json({
            statusCounts: {
                pending: pendingSuggestions,
                approved: approvedSuggestions,
                rejected: rejectedSuggestions
            },
            totalKnowledgeEntries,
            recentSuggestions,
            learningActive: pendingSuggestions > 0 || recentSuggestions > 0
        });
    } catch (error) {
        console.error('Error fetching learning analytics:', error);
        res.status(500).json({ error: 'Failed to fetch analytics' });
    }
});

// Get pending suggestions for review
router.get('/suggestions/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { status = 'pending', limit = 10, skip = 0 } = req.query;
        
        const suggestions = await SuggestedKnowledgeEntry.find({
            companyId,
            status
        })
        .sort({ priority: -1, createdAt: -1 })
        .limit(parseInt(limit))
        .skip(parseInt(skip))
        .lean();
        
        res.json(suggestions);
    } catch (error) {
        console.error('Error fetching suggestions:', error);
        res.status(500).json({ error: 'Failed to fetch suggestions' });
    }
});

// Approve a suggestion and convert to knowledge entry
router.post('/suggestions/:suggestionId/approve', async (req, res) => {
    try {
        const { suggestionId } = req.params;
        const { category, tags, reviewNotes } = req.body;
        
        const suggestion = await SuggestedKnowledgeEntry.findById(suggestionId);
        if (!suggestion) {
            return res.status(404).json({ error: 'Suggestion not found' });
        }
        
        // Create knowledge entry
        const knowledgeEntry = new KnowledgeEntry({
            companyId: suggestion.companyId,
            question: suggestion.question,
            answer: suggestion.answer,
            category: category || suggestion.category,
            tags: tags || suggestion.tags,
            confidence: suggestion.confidence,
            source: 'ai_learning',
            isActive: true,
            reviewNotes,
            createdAt: new Date()
        });
        
        await knowledgeEntry.save();
        
        // Update suggestion status
        suggestion.status = 'approved';
        suggestion.reviewedAt = new Date();
        suggestion.reviewNotes = reviewNotes;
        await suggestion.save();
        
        res.json({ 
            message: 'Suggestion approved successfully',
            knowledgeEntry: knowledgeEntry._id
        });
    } catch (error) {
        console.error('Error approving suggestion:', error);
        res.status(500).json({ error: 'Failed to approve suggestion' });
    }
});

// Reject a suggestion
router.post('/suggestions/:suggestionId/reject', async (req, res) => {
    try {
        const { suggestionId } = req.params;
        const { reviewNotes } = req.body;
        
        const suggestion = await SuggestedKnowledgeEntry.findById(suggestionId);
        if (!suggestion) {
            return res.status(404).json({ error: 'Suggestion not found' });
        }
        
        suggestion.status = 'rejected';
        suggestion.reviewedAt = new Date();
        suggestion.reviewNotes = reviewNotes;
        await suggestion.save();
        
        res.json({ message: 'Suggestion rejected successfully' });
    } catch (error) {
        console.error('Error rejecting suggestion:', error);
        res.status(500).json({ error: 'Failed to reject suggestion' });
    }
});

// Get knowledge base entries
router.get('/knowledge/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { category, tags, search, limit = 20, skip = 0 } = req.query;
        
        let query = { companyId, isActive: true };
        
        if (category) {
            query.category = category;
        }
        
        if (tags) {
            query.tags = { $in: tags.split(',') };
        }
        
        if (search) {
            query.$or = [
                { question: { $regex: search, $options: 'i' } },
                { answer: { $regex: search, $options: 'i' } },
                { tags: { $in: [new RegExp(search, 'i')] } }
            ];
        }
        
        const knowledge = await KnowledgeEntry.find(query)
            .sort({ createdAt: -1 })
            .limit(parseInt(limit))
            .skip(parseInt(skip))
            .lean();
        
        res.json(knowledge);
    } catch (error) {
        console.error('Error fetching knowledge entries:', error);
        res.status(500).json({ error: 'Failed to fetch knowledge entries' });
    }
});

// Update knowledge entry
router.put('/knowledge/:knowledgeId', async (req, res) => {
    try {
        const { knowledgeId } = req.params;
        const updates = req.body;
        
        const knowledge = await KnowledgeEntry.findByIdAndUpdate(
            knowledgeId,
            { ...updates, updatedAt: new Date() },
            { new: true }
        );
        
        if (!knowledge) {
            return res.status(404).json({ error: 'Knowledge entry not found' });
        }
        
        res.json(knowledge);
    } catch (error) {
        console.error('Error updating knowledge entry:', error);
        res.status(500).json({ error: 'Failed to update knowledge entry' });
    }
});

// Delete knowledge entry (soft delete)
router.delete('/knowledge/:knowledgeId', async (req, res) => {
    try {
        const { knowledgeId } = req.params;
        
        const knowledge = await KnowledgeEntry.findByIdAndUpdate(
            knowledgeId,
            { isActive: false, updatedAt: new Date() },
            { new: true }
        );
        
        if (!knowledge) {
            return res.status(404).json({ error: 'Knowledge entry not found' });
        }
        
        res.json({ message: 'Knowledge entry deleted successfully' });
    } catch (error) {
        console.error('Error deleting knowledge entry:', error);
        res.status(500).json({ error: 'Failed to delete knowledge entry' });
    }
});

// Get learning settings for a company
router.get('/settings/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        const company = await Company.findById(companyId).lean();
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Return learning settings with defaults
        const settings = company.learningSettings || {
            autoLearning: true,
            confidenceThreshold: 0.8,
            maxSuggestionsPerDay: 10,
            categories: ['general', 'pricing', 'services', 'policies'],
            requireApproval: true
        };
        
        res.json(settings);
    } catch (error) {
        console.error('Error fetching learning settings:', error);
        res.status(500).json({ error: 'Failed to fetch learning settings' });
    }
});

// Update learning settings for a company
router.put('/settings/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        const settings = req.body;
        
        const company = await Company.findByIdAndUpdate(
            companyId,
            { 
                learningSettings: settings,
                updatedAt: new Date()
            },
            { new: true }
        );
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        res.json({ 
            message: 'Learning settings updated successfully',
            settings: company.learningSettings
        });
    } catch (error) {
        console.error('Error updating learning settings:', error);
        res.status(500).json({ error: 'Failed to update learning settings' });
    }
});

// Get available categories and tags for filters
router.get('/metadata/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        // Get unique categories from both suggestions and knowledge entries
        const suggestionCategories = await SuggestedKnowledgeEntry.distinct('category', { companyId });
        const knowledgeCategories = await KnowledgeEntry.distinct('category', { companyId, isActive: true });
        const categories = [...new Set([...suggestionCategories, ...knowledgeCategories])];
        
        // Get unique tags
        const suggestionTags = await SuggestedKnowledgeEntry.distinct('tags', { companyId });
        const knowledgeTags = await KnowledgeEntry.distinct('tags', { companyId, isActive: true });
        const tags = [...new Set([...suggestionTags.flat(), ...knowledgeTags.flat()])];
        
        res.json({ categories, tags });
    } catch (error) {
        console.error('Error fetching metadata:', error);
        res.status(500).json({ error: 'Failed to fetch metadata' });
    }
});

// Create test data for development (temporary endpoint)
router.post('/test-data/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        const suggestionData = req.body;
        
        const suggestion = new SuggestedKnowledgeEntry({
            companyId,
            ...suggestionData
        });
        
        await suggestion.save();
        
        res.json({ 
            message: 'Test suggestion created successfully',
            suggestion: suggestion._id
        });
    } catch (error) {
        console.error('Error creating test data:', error);
        res.status(500).json({ error: 'Failed to create test data' });
    }
});

module.exports = router;
