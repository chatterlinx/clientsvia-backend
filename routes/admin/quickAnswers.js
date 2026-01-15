/**
 * ============================================================================
 * QUICK ANSWERS - Admin API Routes
 * ============================================================================
 * 
 * FRESH IMPLEMENTATION - NO LEGACY CONNECTION
 * 
 * Manage instant responses to common caller questions.
 * Lives in Mission Control alongside Mission Triggers.
 * 
 * ENDPOINTS:
 * - GET    /:companyId              - Get all quick answers
 * - POST   /:companyId              - Add a quick answer
 * - PUT    /:companyId/:answerId    - Update a quick answer
 * - DELETE /:companyId/:answerId    - Delete a quick answer
 * - POST   /:companyId/match        - Test which answer matches a phrase
 * - POST   /:companyId/seed         - Retired seed endpoint
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');
const v2Company = require('../../models/v2Company');
const { authenticateJWT } = require('../../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// ============================================================================
// DEFAULT QUICK ANSWERS (legacy, retained for reference)
// ============================================================================

const DEFAULT_QUICK_ANSWERS = [
    {
        id: 'qa_hours',
        question: 'What are your hours?',
        answer: "We're available Monday through Friday, 8 AM to 5 PM. For emergencies, we have 24/7 service available.",
        triggers: ['hours', 'what time', 'when open', 'when close', 'are you open', 'business hours', 'office hours'],
        category: 'hours',
        enabled: true,
        priority: 10
    },
    {
        id: 'qa_service_area',
        question: 'Do you service my area?',
        answer: "We service most of Southwest Florida including Fort Myers, Naples, Cape Coral, and surrounding areas. What's your zip code?",
        triggers: ['service area', 'do you service', 'come to my area', 'in my area', 'service my location', 'fort myers', 'naples', 'cape coral'],
        category: 'service_area',
        enabled: true,
        priority: 10
    },
    {
        id: 'qa_pricing',
        question: 'How much does it cost?',
        answer: "Pricing depends on the specific work needed. We'd be happy to give you a free estimate - may I get your information to schedule that?",
        triggers: ['how much', 'cost', 'price', 'pricing', 'estimate', 'quote', 'charge', 'fee', 'expensive'],
        category: 'pricing',
        enabled: true,
        priority: 10
    },
    {
        id: 'qa_emergency',
        question: 'Is this an emergency service?',
        answer: "Yes, we offer 24/7 emergency service for urgent issues like no heat, no AC, gas leaks, or flooding. Are you experiencing an emergency right now?",
        triggers: ['emergency', 'urgent', '24 hour', 'after hours', 'weekend service', 'holiday service'],
        category: 'services',
        enabled: true,
        priority: 15
    },
    {
        id: 'qa_payment',
        question: 'What payment methods do you accept?',
        answer: "We accept all major credit cards, cash, and checks. We also offer financing options for larger projects.",
        triggers: ['payment', 'pay', 'credit card', 'financing', 'accept', 'cash', 'check'],
        category: 'policies',
        enabled: true,
        priority: 5
    },
    {
        id: 'qa_warranty',
        question: 'Do you offer a warranty?',
        answer: "Yes! We stand behind our work. All repairs come with a warranty, and we'll discuss the specific coverage with you before we start.",
        triggers: ['warranty', 'guarantee', 'guaranteed', 'stand behind', 'workmanship'],
        category: 'policies',
        enabled: true,
        priority: 5
    }
];

// ============================================================================
// GET - Fetch all quick answers for a company
// ============================================================================
router.get('/:companyId', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        
        const company = await v2Company.findById(companyId)
            .select('aiAgentSettings.callFlowEngine.quickAnswers')
            .lean();
        
        if (!company) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }
        
        const quickAnswers = company.aiAgentSettings?.callFlowEngine?.quickAnswers || [];
        
        res.json({
            success: true,
            data: quickAnswers,
            count: quickAnswers.length
        });
        
    } catch (error) {
        logger.error('[QUICK ANSWERS] Get error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================================
// POST - Add a new quick answer
// ============================================================================
router.post('/:companyId', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { question, answer, triggers = [], category = 'general', priority = 0 } = req.body;
        
        if (!question || !answer) {
            return res.status(400).json({ success: false, message: 'Question and answer are required' });
        }
        
        const newAnswer = {
            id: `qa_${uuidv4().slice(0, 8)}`,
            question: question.trim(),
            answer: answer.trim(),
            triggers: triggers.map(t => t.toLowerCase().trim()).filter(t => t),
            category,
            enabled: true,
            priority
        };
        
        const result = await v2Company.findByIdAndUpdate(
            companyId,
            { 
                $push: { 'aiAgentSettings.callFlowEngine.quickAnswers': newAnswer },
                $set: { 'aiAgentSettings.callFlowEngine.lastUpdated': new Date() }
            },
            { new: true }
        );
        
        if (!result) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }
        
        // Clear cache
        try {
            const redis = require('../../config/redis');
            if (redis?.client) {
                await redis.client.del(`company:${companyId}`);
                await redis.client.del(`company:${companyId}:quickAnswers`);
            }
        } catch (e) { /* non-critical */ }
        
        logger.info('[QUICK ANSWERS] Added new answer', { companyId, answerId: newAnswer.id, question });
        
        res.json({
            success: true,
            message: 'Quick answer added',
            data: newAnswer
        });
        
    } catch (error) {
        logger.error('[QUICK ANSWERS] Add error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================================
// PUT - Update an existing quick answer
// ============================================================================
router.put('/:companyId/:answerId', authenticateJWT, async (req, res) => {
    try {
        const { companyId, answerId } = req.params;
        const updates = req.body;
        
        // Build update object for the specific array element
        const updateFields = {};
        if (updates.question !== undefined) {
            updateFields['aiAgentSettings.callFlowEngine.quickAnswers.$.question'] = updates.question.trim();
        }
        if (updates.answer !== undefined) {
            updateFields['aiAgentSettings.callFlowEngine.quickAnswers.$.answer'] = updates.answer.trim();
        }
        if (updates.triggers !== undefined) {
            updateFields['aiAgentSettings.callFlowEngine.quickAnswers.$.triggers'] = 
                updates.triggers.map(t => t.toLowerCase().trim()).filter(t => t);
        }
        if (updates.category !== undefined) {
            updateFields['aiAgentSettings.callFlowEngine.quickAnswers.$.category'] = updates.category;
        }
        if (updates.enabled !== undefined) {
            updateFields['aiAgentSettings.callFlowEngine.quickAnswers.$.enabled'] = updates.enabled;
        }
        if (updates.priority !== undefined) {
            updateFields['aiAgentSettings.callFlowEngine.quickAnswers.$.priority'] = updates.priority;
        }
        
        updateFields['aiAgentSettings.callFlowEngine.lastUpdated'] = new Date();
        
        const result = await v2Company.findOneAndUpdate(
            { _id: companyId, 'aiAgentSettings.callFlowEngine.quickAnswers.id': answerId },
            { $set: updateFields },
            { new: true }
        );
        
        if (!result) {
            return res.status(404).json({ success: false, message: 'Company or answer not found' });
        }
        
        // Clear cache
        try {
            const redis = require('../../config/redis');
            if (redis?.client) {
                await redis.client.del(`company:${companyId}`);
                await redis.client.del(`company:${companyId}:quickAnswers`);
            }
        } catch (e) { /* non-critical */ }
        
        logger.info('[QUICK ANSWERS] Updated answer', { companyId, answerId });
        
        res.json({
            success: true,
            message: 'Quick answer updated'
        });
        
    } catch (error) {
        logger.error('[QUICK ANSWERS] Update error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================================
// DELETE - Remove a quick answer
// ============================================================================
router.delete('/:companyId/:answerId', authenticateJWT, async (req, res) => {
    try {
        const { companyId, answerId } = req.params;
        
        const result = await v2Company.findByIdAndUpdate(
            companyId,
            { 
                $pull: { 'aiAgentSettings.callFlowEngine.quickAnswers': { id: answerId } },
                $set: { 'aiAgentSettings.callFlowEngine.lastUpdated': new Date() }
            },
            { new: true }
        );
        
        if (!result) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }
        
        // Clear cache
        try {
            const redis = require('../../config/redis');
            if (redis?.client) {
                await redis.client.del(`company:${companyId}`);
                await redis.client.del(`company:${companyId}:quickAnswers`);
            }
        } catch (e) { /* non-critical */ }
        
        logger.info('[QUICK ANSWERS] Deleted answer', { companyId, answerId });
        
        res.json({
            success: true,
            message: 'Quick answer deleted'
        });
        
    } catch (error) {
        logger.error('[QUICK ANSWERS] Delete error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================================
// POST - Test which answer matches a phrase
// ============================================================================
router.post('/:companyId/match', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { phrase } = req.body;
        
        if (!phrase) {
            return res.status(400).json({ success: false, message: 'Phrase is required' });
        }
        
        const company = await v2Company.findById(companyId)
            .select('aiAgentSettings.callFlowEngine.quickAnswers')
            .lean();
        
        if (!company) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }
        
        const quickAnswers = company.aiAgentSettings?.callFlowEngine?.quickAnswers || [];
        const lowerPhrase = phrase.toLowerCase();
        
        // Find matching answers (sorted by priority)
        const matches = quickAnswers
            .filter(qa => qa.enabled)
            .map(qa => {
                const matchedTriggers = qa.triggers.filter(trigger => 
                    lowerPhrase.includes(trigger.toLowerCase())
                );
                return {
                    ...qa,
                    matchedTriggers,
                    matchScore: matchedTriggers.length
                };
            })
            .filter(qa => qa.matchScore > 0)
            .sort((a, b) => {
                // Sort by priority first, then by match score
                if (b.priority !== a.priority) return b.priority - a.priority;
                return b.matchScore - a.matchScore;
            });
        
        const bestMatch = matches[0] || null;
        
        res.json({
            success: true,
            data: {
                phrase,
                matched: !!bestMatch,
                bestMatch: bestMatch ? {
                    id: bestMatch.id,
                    question: bestMatch.question,
                    answer: bestMatch.answer,
                    category: bestMatch.category,
                    matchedTriggers: bestMatch.matchedTriggers
                } : null,
                allMatches: matches.length,
                suggestion: !bestMatch 
                    ? "No quick answer matched. Consider adding one for this type of question."
                    : null
            }
        });
        
    } catch (error) {
        logger.error('[QUICK ANSWERS] Match error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================================
// POST - Seed with default quick answers
// ============================================================================
router.post('/:companyId/seed', authenticateJWT, async (req, res) => {
    return res.status(410).json({
        success: false,
        message: 'Seed endpoint retired. Add quick answers manually.'
    });
    try {
        const { companyId } = req.params;
        const { overwrite = false } = req.body;
        
        const company = await v2Company.findById(companyId)
            .select('aiAgentSettings.callFlowEngine.quickAnswers')
            .lean();
        
        if (!company) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }
        
        const existing = company.aiAgentSettings?.callFlowEngine?.quickAnswers || [];
        
        if (existing.length > 0 && !overwrite) {
            return res.status(400).json({ 
                success: false, 
                message: `${existing.length} quick answers already exist. Use overwrite=true to replace.`,
                existingCount: existing.length
            });
        }
        
        // Generate fresh IDs for seeds
        const seededAnswers = DEFAULT_QUICK_ANSWERS.map(qa => ({
            ...qa,
            id: `qa_${uuidv4().slice(0, 8)}`
        }));
        
        await v2Company.findByIdAndUpdate(companyId, {
            $set: { 
                'aiAgentSettings.callFlowEngine.quickAnswers': seededAnswers,
                'aiAgentSettings.callFlowEngine.lastUpdated': new Date()
            }
        });
        
        // Clear cache
        try {
            const redis = require('../../config/redis');
            if (redis?.client) {
                await redis.client.del(`company:${companyId}`);
                await redis.client.del(`company:${companyId}:quickAnswers`);
            }
        } catch (e) { /* non-critical */ }
        
        logger.info('[QUICK ANSWERS] Seeded defaults', { companyId, count: seededAnswers.length });
        
        res.json({
            success: true,
            message: `Seeded ${seededAnswers.length} default quick answers`,
            data: seededAnswers
        });
        
    } catch (error) {
        logger.error('[QUICK ANSWERS] Seed error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;

