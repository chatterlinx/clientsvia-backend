/**
 * ============================================================================
 * LLM LEARNING CONSOLE - BACKEND ROUTES
 * ============================================================================
 * 
 * PURPOSE: API endpoints for the LLM Learning Console UI
 * 
 * ROUTES:
 * - GET    /api/admin/llm-learning/cost-analytics
 * - GET    /api/admin/llm-learning/templates
 * - GET    /api/admin/llm-learning/suggestions/:templateId
 * - PATCH  /api/admin/llm-learning/suggestions/:id/approve
 * - PATCH  /api/admin/llm-learning/suggestions/:id/reject
 * - POST   /api/admin/llm-learning/suggestions/bulk-approve
 * - GET    /api/admin/llm-learning/suggestions/:id/preview
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const ProductionLLMSuggestion = require('../../models/ProductionLLMSuggestion');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const logger = require('../../utils/logger');

// Apply authentication to all routes
router.use(authenticateJWT);
router.use(requireRole('admin'));

/**
 * ============================================================================
 * GET /api/admin/llm-learning/cost-analytics
 * ============================================================================
 * PURPOSE: Get cost analytics for dashboard
 * 
 * RESPONSE:
 * {
 *   today: { cost: 2.40, calls: 12 },
 *   week: { cost: 18.50, calls: 87 },
 *   roi: { savings: 120.00, suggestionsApplied: 40 },
 *   tier3Reduction: 15
 * }
 * ============================================================================
 */
router.get('/cost-analytics', async (req, res) => {
    try {
        logger.info('[LLM LEARNING] Fetching cost analytics');
        
        const analytics = await ProductionLLMSuggestion.getCostAnalytics();
        
        res.json(analytics);
        
    } catch (error) {
        logger.error('[LLM LEARNING] Error fetching cost analytics:', error);
        res.status(500).json({ 
            error: 'Failed to fetch cost analytics',
            message: error.message 
        });
    }
});

/**
 * ============================================================================
 * GET /api/admin/llm-learning/templates
 * ============================================================================
 * PURPOSE: Get all templates with pending suggestion counts
 * 
 * RESPONSE:
 * {
 *   templates: [
 *     {
 *       _id: '...',
 *       name: 'Universal AI Brain',
 *       pendingSuggestions: 47,
 *       learningCost: 12.50,
 *       companiesUsing: 12,
 *       lastSuggestion: '2025-11-02T...',
 *       priority: { high: 23, medium: 18, low: 6 }
 *     }
 *   ]
 * }
 * ============================================================================
 */
router.get('/templates', async (req, res) => {
    try {
        logger.info('[LLM LEARNING] Fetching templates summary');
        
        const templates = await ProductionLLMSuggestion.getTemplatesSummary();
        
        res.json({ templates });
        
    } catch (error) {
        logger.error('[LLM LEARNING] Error fetching templates:', error);
        res.status(500).json({ 
            error: 'Failed to fetch templates',
            message: error.message 
        });
    }
});

/**
 * ============================================================================
 * GET /api/admin/llm-learning/suggestions/:templateId
 * ============================================================================
 * PURPOSE: Get all pending suggestions for a specific template
 * 
 * QUERY PARAMS:
 * - priority: 'high' | 'medium' | 'low' | 'all' (default: 'all')
 * - limit: number (default: 100)
 * - skip: number (default: 0)
 * 
 * RESPONSE:
 * {
 *   suggestions: [
 *     {
 *       _id: '...',
 *       suggestion: 'Add trigger: leaky pipe',
 *       suggestionType: 'trigger',
 *       suggestedValue: 'leaky pipe',
 *       priority: 'high',
 *       confidence: 0.95,
 *       customerPhrase: 'Can you come fix my leaky pipe?',
 *       companyName: 'Royal Plumbing',
 *       cost: 0.08,
 *       callDate: '2025-11-02T...',
 *       ...
 *     }
 *   ],
 *   total: 47,
 *   filtered: 23
 * }
 * ============================================================================
 */
router.get('/suggestions/:templateId', async (req, res) => {
    try {
        const { templateId } = req.params;
        const { priority = 'all', limit = 100, skip = 0 } = req.query;
        
        logger.info(`[LLM LEARNING] Fetching suggestions for template: ${templateId}, priority: ${priority}`);
        
        // Validate templateId
        if (!mongoose.Types.ObjectId.isValid(templateId)) {
            return res.status(400).json({ error: 'Invalid template ID' });
        }
        
        // Build query
        const query = {
            templateId: new mongoose.Types.ObjectId(templateId),
            status: 'pending'
        };
        
        if (priority !== 'all') {
            query.priority = priority;
        }
        
        // Get suggestions
        const suggestions = await ProductionLLMSuggestion.find(query)
            .sort({ priority: -1, confidence: -1, createdAt: -1 }) // High priority first, then by confidence
            .limit(parseInt(limit))
            .skip(parseInt(skip))
            .lean();
        
        // Get total count (for pagination)
        const total = await ProductionLLMSuggestion.countDocuments({
            templateId: new mongoose.Types.ObjectId(templateId),
            status: 'pending'
        });
        
        const filtered = await ProductionLLMSuggestion.countDocuments(query);
        
        res.json({
            suggestions,
            total,
            filtered
        });
        
    } catch (error) {
        logger.error('[LLM LEARNING] Error fetching suggestions:', error);
        res.status(500).json({ 
            error: 'Failed to fetch suggestions',
            message: error.message 
        });
    }
});

/**
 * ============================================================================
 * PATCH /api/admin/llm-learning/suggestions/:id/approve
 * ============================================================================
 * PURPOSE: Approve a suggestion and apply it to the template
 * 
 * BODY:
 * {
 *   notes: 'Good suggestion, applying now' (optional)
 * }
 * 
 * FLOW:
 * 1. Mark suggestion as 'approved'
 * 2. Apply to GlobalInstantResponseTemplate (add trigger/synonym/etc)
 * 3. Mark as 'applied'
 * 4. Return success
 * 
 * ============================================================================
 */
router.patch('/suggestions/:id/approve', async (req, res) => {
    try {
        const { id } = req.params;
        const { notes } = req.body;
        const adminEmail = req.user?.email || 'Admin';
        
        logger.info(`[LLM LEARNING] Approving suggestion: ${id} by ${adminEmail}`);
        
        // Validate ID
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid suggestion ID' });
        }
        
        // Find suggestion
        const suggestion = await ProductionLLMSuggestion.findById(id);
        
        if (!suggestion) {
            return res.status(404).json({ error: 'Suggestion not found' });
        }
        
        if (suggestion.status !== 'pending') {
            return res.status(400).json({ error: `Suggestion already ${suggestion.status}` });
        }
        
        // Find template
        const template = await GlobalInstantResponseTemplate.findById(suggestion.templateId);
        
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        // Apply suggestion to template based on type
        let applied = false;
        
        switch (suggestion.suggestionType) {
            case 'trigger':
                // Find category and add trigger
                if (suggestion.targetCategory) {
                    const category = template.categories.find(c => c.name === suggestion.targetCategory);
                    if (category && suggestion.targetScenario) {
                        const scenario = category.scenarios.find(s => s.name === suggestion.targetScenario);
                        if (scenario) {
                            // Add trigger if not already present
                            if (!scenario.triggers.includes(suggestion.suggestedValue)) {
                                scenario.triggers.push(suggestion.suggestedValue);
                                applied = true;
                                logger.info(`[LLM LEARNING] Added trigger "${suggestion.suggestedValue}" to ${suggestion.targetCategory}/${suggestion.targetScenario}`);
                            }
                        }
                    }
                }
                break;
                
            case 'synonym':
                // Add to synonyms array at template level
                if (!template.synonyms) {
                    template.synonyms = [];
                }
                if (!template.synonyms.includes(suggestion.suggestedValue)) {
                    template.synonyms.push(suggestion.suggestedValue);
                    applied = true;
                    logger.info(`[LLM LEARNING] Added synonym "${suggestion.suggestedValue}"`);
                }
                break;
                
            case 'filler':
                // Add to filler words
                if (!template.fillerWords) {
                    template.fillerWords = [];
                }
                if (!template.fillerWords.includes(suggestion.suggestedValue)) {
                    template.fillerWords.push(suggestion.suggestedValue);
                    applied = true;
                    logger.info(`[LLM LEARNING] Added filler word "${suggestion.suggestedValue}"`);
                }
                break;
                
            case 'keyword':
                // Add to keywords
                if (!template.keywords) {
                    template.keywords = [];
                }
                if (!template.keywords.includes(suggestion.suggestedValue)) {
                    template.keywords.push(suggestion.suggestedValue);
                    applied = true;
                    logger.info(`[LLM LEARNING] Added keyword "${suggestion.suggestedValue}"`);
                }
                break;
                
            default:
                logger.warn(`[LLM LEARNING] Unsupported suggestion type: ${suggestion.suggestionType}`);
                return res.status(400).json({ 
                    error: 'Unsupported suggestion type',
                    type: suggestion.suggestionType 
                });
        }
        
        if (applied) {
            // Save template
            await template.save();
            
            // Update suggestion status
            suggestion.status = 'applied';
            suggestion.reviewedBy = adminEmail;
            suggestion.reviewedAt = new Date();
            suggestion.appliedAt = new Date();
            suggestion.appliedBy = adminEmail;
            if (notes) suggestion.notes = notes;
            await suggestion.save();
            
            logger.info(`[LLM LEARNING] ✅ Suggestion ${id} applied successfully`);
            
            res.json({
                success: true,
                message: 'Suggestion approved and applied to template',
                suggestion
            });
        } else {
            res.status(400).json({
                success: false,
                message: 'Failed to apply suggestion - target not found or already exists'
            });
        }
        
    } catch (error) {
        logger.error('[LLM LEARNING] Error approving suggestion:', error);
        res.status(500).json({ 
            error: 'Failed to approve suggestion',
            message: error.message 
        });
    }
});

/**
 * ============================================================================
 * PATCH /api/admin/llm-learning/suggestions/:id/reject
 * ============================================================================
 * PURPOSE: Reject a suggestion and mark it as dismissed
 * 
 * BODY:
 * {
 *   reason: 'Not relevant for this template' (optional)
 * }
 * 
 * ============================================================================
 */
router.patch('/suggestions/:id/reject', async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const adminEmail = req.user?.email || 'Admin';
        
        logger.info(`[LLM LEARNING] Rejecting suggestion: ${id} by ${adminEmail}`);
        
        // Validate ID
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid suggestion ID' });
        }
        
        // Find suggestion
        const suggestion = await ProductionLLMSuggestion.findById(id);
        
        if (!suggestion) {
            return res.status(404).json({ error: 'Suggestion not found' });
        }
        
        if (suggestion.status !== 'pending') {
            return res.status(400).json({ error: `Suggestion already ${suggestion.status}` });
        }
        
        // Update suggestion status
        suggestion.status = 'rejected';
        suggestion.reviewedBy = adminEmail;
        suggestion.reviewedAt = new Date();
        if (reason) suggestion.rejectionReason = reason;
        await suggestion.save();
        
        logger.info(`[LLM LEARNING] ❌ Suggestion ${id} rejected`);
        
        res.json({
            success: true,
            message: 'Suggestion rejected',
            suggestion
        });
        
    } catch (error) {
        logger.error('[LLM LEARNING] Error rejecting suggestion:', error);
        res.status(500).json({ 
            error: 'Failed to reject suggestion',
            message: error.message 
        });
    }
});

/**
 * ============================================================================
 * POST /api/admin/llm-learning/suggestions/bulk-approve
 * ============================================================================
 * PURPOSE: Approve multiple suggestions at once (90%+ confidence)
 * 
 * BODY:
 * {
 *   templateId: '...',
 *   minConfidence: 0.90 (default)
 * }
 * 
 * ============================================================================
 */
router.post('/suggestions/bulk-approve', async (req, res) => {
    try {
        const { templateId, minConfidence = 0.90 } = req.body;
        const adminEmail = req.user?.email || 'Admin';
        
        logger.info(`[LLM LEARNING] Bulk approving suggestions for template: ${templateId}, minConfidence: ${minConfidence}`);
        
        // Validate templateId
        if (!mongoose.Types.ObjectId.isValid(templateId)) {
            return res.status(400).json({ error: 'Invalid template ID' });
        }
        
        // Find high-confidence suggestions
        const suggestions = await ProductionLLMSuggestion.find({
            templateId: new mongoose.Types.ObjectId(templateId),
            status: 'pending',
            confidence: { $gte: minConfidence }
        });
        
        logger.info(`[LLM LEARNING] Found ${suggestions.length} high-confidence suggestions to approve`);
        
        // Approve each one (TODO: Optimize with bulk operations)
        const results = {
            total: suggestions.length,
            approved: 0,
            failed: 0,
            errors: []
        };
        
        for (const suggestion of suggestions) {
            try {
                // Call approve endpoint logic (simplified here)
                suggestion.status = 'approved';
                suggestion.reviewedBy = adminEmail;
                suggestion.reviewedAt = new Date();
                suggestion.notes = `Bulk approved (confidence: ${suggestion.confidence})`;
                await suggestion.save();
                results.approved++;
            } catch (error) {
                results.failed++;
                results.errors.push({
                    suggestionId: suggestion._id,
                    error: error.message
                });
            }
        }
        
        logger.info(`[LLM LEARNING] Bulk approve complete: ${results.approved} approved, ${results.failed} failed`);
        
        res.json({
            success: true,
            message: `Bulk approve complete: ${results.approved}/${results.total} approved`,
            results
        });
        
    } catch (error) {
        logger.error('[LLM LEARNING] Error in bulk approve:', error);
        res.status(500).json({ 
            error: 'Failed to bulk approve suggestions',
            message: error.message 
        });
    }
});

/**
 * ============================================================================
 * GET /api/admin/llm-learning/suggestions/:id/preview
 * ============================================================================
 * PURPOSE: Preview what would change if this suggestion is applied
 * (Future enhancement)
 * ============================================================================
 */
router.get('/suggestions/:id/preview', async (req, res) => {
    try {
        const { id } = req.params;
        
        // TODO: Implement preview logic
        res.json({
            success: true,
            message: 'Preview feature coming soon',
            preview: {}
        });
        
    } catch (error) {
        logger.error('[LLM LEARNING] Error generating preview:', error);
        res.status(500).json({ 
            error: 'Failed to generate preview',
            message: error.message 
        });
    }
});

module.exports = router;

