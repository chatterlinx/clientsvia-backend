/**
 * ════════════════════════════════════════════════════════════════════════════════
 * EXECUTION MAP API ROUTES
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * API for generating call execution flow visualizations.
 * 
 * ENDPOINTS:
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │  GET  /api/company/:companyId/execution-map           - Full execution map  │
 * │  GET  /api/company/:companyId/execution-map/stages    - List all stages     │
 * │  GET  /api/company/:companyId/execution-map/path/:type - Scenario path      │
 * └─────────────────────────────────────────────────────────────────────────────┘
 * 
 * ════════════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const logger = require('../../utils/logger');

// Services
const { 
    CallExecutionMapper, 
    EXECUTION_STAGES 
} = require('../../services/callExecution/CallExecutionMapper');

// Platform Snapshot
let platformSnapshotService;
try {
    platformSnapshotService = require('../../platform/snapshot/platformSnapshot');
} catch (e) {
    logger.warn('[EXECUTION MAP ROUTES] Platform snapshot service not available');
}

// Models
const v2Company = require('../../models/v2Company');

// ═══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validate company exists
 */
const validateCompany = async (req, res, next) => {
    const { companyId } = req.params;
    
    if (!companyId || !companyId.match(/^[a-f\d]{24}$/i)) {
        return res.status(400).json({
            success: false,
            error: 'Invalid company ID format'
        });
    }
    
    try {
        const company = await v2Company.findById(companyId)
            .select('name tradeKey')
            .lean();
            
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        req.company = company;
        next();
    } catch (error) {
        logger.error('[EXECUTION MAP] Company validation failed:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to validate company'
        });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/company/:companyId/execution-map
// Generate full execution map
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/', validateCompany, async (req, res) => {
    const { companyId } = req.params;
    const startTime = Date.now();
    
    try {
        // Get platform snapshot
        if (!platformSnapshotService) {
            return res.status(503).json({
                success: false,
                error: 'Platform snapshot service not available'
            });
        }
        
        const platformSnapshot = await platformSnapshotService.generateSnapshot(companyId, 'full');
        
        // Generate execution map
        const mapper = new CallExecutionMapper();
        const executionMap = mapper.generateMap(platformSnapshot);
        
        logger.info(`[EXECUTION MAP] Generated for ${companyId} in ${Date.now() - startTime}ms`);
        
        res.json(executionMap);
        
    } catch (error) {
        logger.error('[EXECUTION MAP] Generation error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            generatedIn: Date.now() - startTime
        });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/company/:companyId/execution-map/stages
// List all execution stages (static reference)
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/stages', validateCompany, async (req, res) => {
    try {
        res.json({
            success: true,
            stages: EXECUTION_STAGES,
            count: EXECUTION_STAGES.length
        });
    } catch (error) {
        logger.error('[EXECUTION MAP] Stages error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/company/:companyId/execution-map/path/:type
// Get execution path for specific scenario type
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/path/:type', validateCompany, async (req, res) => {
    const { companyId, type } = req.params;
    
    const validTypes = ['emergency', 'booking', 'inquiry', 'transfer', 'general'];
    
    if (!validTypes.includes(type)) {
        return res.status(400).json({
            success: false,
            error: `Invalid path type. Must be one of: ${validTypes.join(', ')}`
        });
    }
    
    try {
        if (!platformSnapshotService) {
            return res.status(503).json({
                success: false,
                error: 'Platform snapshot service not available'
            });
        }
        
        const platformSnapshot = await platformSnapshotService.generateSnapshot(companyId, 'full');
        
        const mapper = new CallExecutionMapper();
        const path = mapper.getScenarioPath(platformSnapshot, type);
        
        res.json(path);
        
    } catch (error) {
        logger.error('[EXECUTION MAP] Path error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = router;

