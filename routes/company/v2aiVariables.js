/**
 * 🔧 AI VARIABLES API ROUTES
 * ===========================
 * Manage reusable placeholder variables for AI Agent responses
 * Variables like [Company Name], [Business Hours] are replaced automatically by AI
 * 
 * Endpoints:
 * - GET    /api/company/:companyId/ai-variables          - Load all variables
 * - POST   /api/company/:companyId/ai-variables          - Add new variable
 * - DELETE /api/company/:companyId/ai-variables/:varId   - Delete variable
 */

const express = require('express');
const router = express.Router();
const v2Company = require('../../models/v2Company');
const { authenticateJWT } = require('../../middleware/auth');
const logger = require('../../utils/logger');

/**
 * GET /api/company/:companyId/ai-variables
 * Load all AI variables for a company
 */
router.get('/:companyId/ai-variables', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { companyId } = req.params;
        
        console.log(`📦 [AI-VAR-LOAD-1] Loading variables for company: ${companyId}`);
        
        // Load company with aiVariables only
        const company = await v2Company.findById(companyId).select('aiVariables').lean();
        
        if (!company) {
            console.log(`❌ [AI-VAR-LOAD-2] Company not found: ${companyId}`);
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }
        
        const variables = company.aiVariables || [];
        console.log(`✅ [AI-VAR-LOAD-3] Loaded ${variables.length} variables`);
        
        res.json({
            success: true,
            data: variables,
            meta: {
                count: variables.length,
                responseTime: Date.now() - startTime
            }
        });
        
    } catch (error) {
        console.error(`❌ [AI-VAR-LOAD-ERROR] Error loading variables:`, error);
        logger.error('Error loading AI variables', { error: error.message, companyId: req.params.companyId });
        
        res.status(500).json({
            success: false,
            message: 'Failed to load AI variables',
            error: error.message
        });
    }
});

/**
 * POST /api/company/:companyId/ai-variables
 * Add a new AI variable
 */
router.post('/:companyId/ai-variables', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { companyId } = req.params;
        const { placeholder, value } = req.body;
        
        console.log(`✏️ [AI-VAR-CREATE-1] Creating variable for company: ${companyId}`);
        console.log(`✏️ [AI-VAR-CREATE-2] Data:`, { placeholder, value });
        
        // Validation
        if (!placeholder || !value) {
            console.log(`❌ [AI-VAR-CREATE-3] Missing required fields`);
            return res.status(400).json({
                success: false,
                message: 'Placeholder and value are required'
            });
        }
        
        // Find company
        const company = await v2Company.findById(companyId);
        
        if (!company) {
            console.log(`❌ [AI-VAR-CREATE-4] Company not found: ${companyId}`);
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }
        
        // Check for duplicate placeholder
        if (!company.aiVariables) {
            company.aiVariables = [];
        }
        
        const duplicate = company.aiVariables.find(v => v.placeholder.toLowerCase() === placeholder.toLowerCase());
        if (duplicate) {
            console.log(`⚠️ [AI-VAR-CREATE-5] Duplicate placeholder detected: ${placeholder}`);
            return res.status(409).json({
                success: false,
                message: `Placeholder "${placeholder}" already exists`
            });
        }
        
        // Create new variable
        const newVariable = {
            id: `var_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            placeholder,
            value,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        
        // Add to company
        company.aiVariables.push(newVariable);
        await company.save();
        
        console.log(`✅ [AI-VAR-CREATE-6] Variable created successfully:`, newVariable.id);
        
        res.status(201).json({
            success: true,
            message: 'AI variable created successfully',
            data: newVariable,
            meta: {
                responseTime: Date.now() - startTime
            }
        });
        
    } catch (error) {
        console.error(`❌ [AI-VAR-CREATE-ERROR] Error creating variable:`, error);
        logger.error('Error creating AI variable', { error: error.message, companyId: req.params.companyId });
        
        res.status(500).json({
            success: false,
            message: 'Failed to create AI variable',
            error: error.message
        });
    }
});

/**
 * DELETE /api/company/:companyId/ai-variables/:varId
 * Delete an AI variable
 */
router.delete('/:companyId/ai-variables/:varId', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { companyId, varId } = req.params;
        
        console.log(`🗑️ [AI-VAR-DELETE-1] Deleting variable: ${varId} from company: ${companyId}`);
        
        // Find company and remove variable
        const company = await v2Company.findById(companyId);
        
        if (!company) {
            console.log(`❌ [AI-VAR-DELETE-2] Company not found: ${companyId}`);
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }
        
        // Find variable index
        const varIndex = company.aiVariables?.findIndex(v => v.id === varId);
        
        if (varIndex === undefined || varIndex === -1) {
            console.log(`❌ [AI-VAR-DELETE-3] Variable not found: ${varId}`);
            return res.status(404).json({
                success: false,
                message: 'Variable not found'
            });
        }
        
        // Remove variable
        company.aiVariables.splice(varIndex, 1);
        await company.save();
        
        console.log(`✅ [AI-VAR-DELETE-4] Variable deleted successfully`);
        
        res.json({
            success: true,
            message: 'AI variable deleted successfully',
            meta: {
                responseTime: Date.now() - startTime
            }
        });
        
    } catch (error) {
        console.error(`❌ [AI-VAR-DELETE-ERROR] Error deleting variable:`, error);
        logger.error('Error deleting AI variable', { error: error.message, companyId: req.params.companyId, varId: req.params.varId });
        
        res.status(500).json({
            success: false,
            message: 'Failed to delete AI variable',
            error: error.message
        });
    }
});

module.exports = router;

