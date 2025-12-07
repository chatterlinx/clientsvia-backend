/**
 * ============================================================================
 * SERVICE TYPE CLARIFICATION ADMIN ROUTES
 * ============================================================================
 * 
 * API endpoints for managing Service Type Clarification configuration.
 * 
 * ENDPOINTS:
 * - GET    /api/admin/service-type-clarification/:companyId     - Get config
 * - PATCH  /api/admin/service-type-clarification/:companyId     - Update config
 * - POST   /api/admin/service-type-clarification/:companyId/reset - Reset to defaults
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');
const v2Company = require('../../models/v2Company');
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const ServiceTypeClarifier = require('../../services/ServiceTypeClarifier');

// ============================================================================
// GET CONFIGURATION
// ============================================================================
router.get('/:companyId', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        
        const company = await v2Company.findById(companyId).lean();
        if (!company) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }
        
        // Get company config or use defaults
        let config = company.aiAgentSettings?.serviceTypeClarification;
        
        if (!config || !config.serviceTypes || config.serviceTypes.length === 0) {
            // Return defaults if no config exists
            config = ServiceTypeClarifier.getDefaultConfig('hvac');
        } else {
            // Merge with defaults to fill any missing fields
            const defaults = ServiceTypeClarifier.getDefaultConfig('hvac');
            config = {
                enabled: config.enabled !== undefined ? config.enabled : defaults.enabled,
                ambiguousPhrases: config.ambiguousPhrases?.length > 0 ? config.ambiguousPhrases : defaults.ambiguousPhrases,
                clarificationQuestion: config.clarificationQuestion || defaults.clarificationQuestion,
                serviceTypes: config.serviceTypes?.length > 0 ? config.serviceTypes : defaults.serviceTypes
            };
        }
        
        res.json({
            success: true,
            data: config
        });
        
    } catch (error) {
        logger.error('[SERVICE TYPE] GET error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================================
// UPDATE CONFIGURATION
// ============================================================================
router.patch('/:companyId', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        const updates = req.body;
        
        logger.info('[SERVICE TYPE] Updating config for company:', companyId);
        
        const updateObj = {};
        
        // Enabled toggle
        if (typeof updates.enabled === 'boolean') {
            updateObj['aiAgentSettings.serviceTypeClarification.enabled'] = updates.enabled;
        }
        
        // Ambiguous phrases
        if (Array.isArray(updates.ambiguousPhrases)) {
            updateObj['aiAgentSettings.serviceTypeClarification.ambiguousPhrases'] = 
                updates.ambiguousPhrases.map(p => p.toLowerCase().trim()).filter(Boolean);
        }
        
        // Clarification question
        if (typeof updates.clarificationQuestion === 'string') {
            updateObj['aiAgentSettings.serviceTypeClarification.clarificationQuestion'] = 
                updates.clarificationQuestion.trim();
        }
        
        // Service types
        if (Array.isArray(updates.serviceTypes)) {
            // Validate and clean service types
            const cleanedServiceTypes = updates.serviceTypes.map((st, idx) => ({
                key: (st.key || `type_${idx}`).toLowerCase().trim(),
                label: st.label || st.key,
                keywords: Array.isArray(st.keywords) 
                    ? st.keywords.map(kw => kw.toLowerCase().trim()).filter(Boolean)
                    : [],
                calendarId: st.calendarId || null,
                priority: st.priority || idx + 1,
                enabled: st.enabled !== false
            }));
            
            updateObj['aiAgentSettings.serviceTypeClarification.serviceTypes'] = cleanedServiceTypes;
        }
        
        // Metadata
        updateObj['aiAgentSettings.serviceTypeClarification.lastUpdated'] = new Date();
        updateObj['aiAgentSettings.serviceTypeClarification.updatedBy'] = req.user?.email || 'system';
        
        await v2Company.updateOne({ _id: companyId }, { $set: updateObj });
        
        logger.info('[SERVICE TYPE] ✅ Config updated for company:', companyId);
        
        res.json({
            success: true,
            message: 'Service Type Clarification configuration updated'
        });
        
    } catch (error) {
        logger.error('[SERVICE TYPE] PATCH error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================================
// RESET TO DEFAULTS
// ============================================================================
router.post('/:companyId/reset', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { trade = 'hvac' } = req.body;
        
        logger.info('[SERVICE TYPE] Resetting to defaults for company:', companyId);
        
        const defaults = ServiceTypeClarifier.getDefaultConfig(trade);
        
        await v2Company.updateOne(
            { _id: companyId },
            { 
                $set: { 
                    'aiAgentSettings.serviceTypeClarification': {
                        ...defaults,
                        lastUpdated: new Date(),
                        updatedBy: req.user?.email || 'system'
                    }
                }
            }
        );
        
        res.json({
            success: true,
            message: 'Service Type Clarification reset to defaults',
            data: defaults
        });
        
    } catch (error) {
        logger.error('[SERVICE TYPE] Reset error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================================
// TEST SERVICE TYPE DETECTION
// ============================================================================
router.post('/:companyId/test', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { text } = req.body;
        
        if (!text) {
            return res.status(400).json({ success: false, message: 'Text is required' });
        }
        
        // Get company config
        const company = await v2Company.findById(companyId).lean();
        const config = company?.aiAgentSettings?.serviceTypeClarification;
        
        // Test clarification
        const shouldClarifyResult = ServiceTypeClarifier.shouldClarify(text, config);
        
        // Test detection
        const detectedType = ServiceTypeClarifier.detectServiceType(text, config);
        
        res.json({
            success: true,
            data: {
                input: text,
                shouldClarify: shouldClarifyResult,
                detectedType,
                clarificationQuestion: shouldClarifyResult.needsClarification 
                    ? ServiceTypeClarifier.getClarificationQuestion(config)
                    : null
            }
        });
        
    } catch (error) {
        logger.error('[SERVICE TYPE] Test error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;

