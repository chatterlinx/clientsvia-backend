/**
 * 🔧 AI PLACEHOLDERS API ROUTES
 * =============================
 * Manage reusable placeholder variables for AI Agent responses
 * Variables like [Company Name], [Business Hours] are replaced automatically by AI
 * 
 * **FRESH START - CLEAN IMPLEMENTATION**
 * 
 * Endpoints:
 * - GET    /api/company/:companyId/ai-placeholders          - Load all placeholders
 * - POST   /api/company/:companyId/ai-placeholders          - Add new placeholder
 * - PUT    /api/company/:companyId/ai-placeholders/:id      - Update placeholder
 * - DELETE /api/company/:companyId/ai-placeholders/:id      - Delete placeholder
 * 
 * Multi-Tenant:
 * - All operations scoped by companyId
 * - Data stored in company.aiPlaceholders array (embedded)
 * - 100% isolation per company
 */

const express = require('express');
const router = express.Router();
const v2Company = require('../../models/v2Company');
const { authenticateJWT } = require('../../middleware/auth');
const logger = require('../../utils/logger');
const { v4: uuidv4 } = require('uuid');

console.log('✅ [AI-PLACEHOLDER-INIT] AI Placeholders route module loading...');

/**
 * GET /api/company/:companyId/ai-placeholders
 * Load all AI placeholders for a company
 */
router.get('/:companyId/ai-placeholders', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { companyId } = req.params;
        
        console.log(`📦 [AI-PLACEHOLDER-GET] Loading placeholders for company: ${companyId}`);
        
        // Load company with aiPlaceholders only
        const company = await v2Company.findById(companyId).select('aiPlaceholders').lean();
        
        if (!company) {
            console.log(`❌ [AI-PLACEHOLDER-GET] Company not found: ${companyId}`);
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        const placeholders = company.aiPlaceholders || [];
        const responseTime = Date.now() - startTime;
        
        console.log(`✅ [AI-PLACEHOLDER-GET] Loaded ${placeholders.length} placeholders in ${responseTime}ms`);
        
        res.status(200).json({
            success: true,
            message: 'AI Placeholders loaded successfully',
            data: placeholders,
            meta: { responseTime }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        console.error(`❌ [AI-PLACEHOLDER-GET] Error:`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to load AI placeholders',
            error: error.message,
            meta: { responseTime }
        });
    }
});

/**
 * POST /api/company/:companyId/ai-placeholders
 * Add a new AI placeholder
 */
router.post('/:companyId/ai-placeholders', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { companyId } = req.params;
        const { placeholder, value } = req.body;
        
        console.log(`📝 [AI-PLACEHOLDER-CREATE] Creating placeholder for company: ${companyId}`);
        console.log(`📝 [AI-PLACEHOLDER-CREATE] Data: ${placeholder} → ${value}`);

        // Validation
        if (!placeholder || !value) {
            return res.status(400).json({
                success: false,
                message: 'Placeholder and value are required'
            });
        }
        
        // Find company
        const company = await v2Company.findById(companyId);
        
        if (!company) {
            console.log(`❌ [AI-PLACEHOLDER-CREATE] Company not found: ${companyId}`);
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }
        
        // Initialize array if needed
        if (!company.aiPlaceholders) {
            company.aiPlaceholders = [];
        }
        
        // Check for duplicate placeholder (case-insensitive)
        const duplicate = company.aiPlaceholders.find(p => 
            p.placeholder.toLowerCase() === placeholder.toLowerCase()
        );
        
        if (duplicate) {
            console.log(`⚠️ [AI-PLACEHOLDER-CREATE] Duplicate placeholder: ${placeholder}`);
            return res.status(409).json({
                success: false,
                message: `Placeholder "${placeholder}" already exists`
            });
        }
        
        // Create new placeholder
        const newPlaceholder = {
            id: uuidv4(),
            placeholder: placeholder.trim(),
            value: value.trim(),
            createdAt: new Date(),
            updatedAt: new Date()
        };
        
        company.aiPlaceholders.push(newPlaceholder);
        await company.save();
        
        const responseTime = Date.now() - startTime;
        console.log(`✅ [AI-PLACEHOLDER-CREATE] Created in ${responseTime}ms`);
        
        res.status(201).json({
            success: true,
            message: `Placeholder "${placeholder}" created successfully`,
            data: newPlaceholder,
            meta: { responseTime }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        console.error(`❌ [AI-PLACEHOLDER-CREATE] Error:`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to create AI placeholder',
            error: error.message,
            meta: { responseTime }
        });
    }
});

/**
 * PUT /api/company/:companyId/ai-placeholders/:id
 * Update an AI placeholder
 */
router.put('/:companyId/ai-placeholders/:id', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { companyId, id } = req.params;
        const { placeholder, value } = req.body;
        
        console.log(`✏️ [AI-PLACEHOLDER-UPDATE] Updating placeholder ${id} for company: ${companyId}`);

        // Validation
        if (!placeholder || !value) {
            return res.status(400).json({
                success: false,
                message: 'Placeholder and value are required'
            });
        }
        
        // Find company
        const company = await v2Company.findById(companyId);
        
        if (!company) {
            console.log(`❌ [AI-PLACEHOLDER-UPDATE] Company not found: ${companyId}`);
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }
        
        // Find placeholder
        const placeholderIndex = company.aiPlaceholders?.findIndex(p => p.id === id);
        
        if (placeholderIndex === -1 || placeholderIndex === undefined) {
            console.log(`❌ [AI-PLACEHOLDER-UPDATE] Placeholder not found: ${id}`);
            return res.status(404).json({
                success: false,
                message: 'Placeholder not found'
            });
        }
        
        // Check for duplicate (exclude current)
        const duplicate = company.aiPlaceholders.find((p, index) => 
            index !== placeholderIndex &&
            p.placeholder.toLowerCase() === placeholder.toLowerCase()
        );
        
        if (duplicate) {
            console.log(`⚠️ [AI-PLACEHOLDER-UPDATE] Duplicate placeholder: ${placeholder}`);
            return res.status(409).json({
                success: false,
                message: `Placeholder "${placeholder}" already exists`
            });
        }
        
        // Update placeholder
        company.aiPlaceholders[placeholderIndex].placeholder = placeholder.trim();
        company.aiPlaceholders[placeholderIndex].value = value.trim();
        company.aiPlaceholders[placeholderIndex].updatedAt = new Date();
        
        await company.save();
        
        const responseTime = Date.now() - startTime;
        console.log(`✅ [AI-PLACEHOLDER-UPDATE] Updated in ${responseTime}ms`);
        
        res.status(200).json({
            success: true,
            message: `Placeholder "${placeholder}" updated successfully`,
            data: company.aiPlaceholders[placeholderIndex],
            meta: { responseTime }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        console.error(`❌ [AI-PLACEHOLDER-UPDATE] Error:`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to update AI placeholder',
            error: error.message,
            meta: { responseTime }
        });
    }
});

/**
 * DELETE /api/company/:companyId/ai-placeholders/:id
 * Delete an AI placeholder
 */
router.delete('/:companyId/ai-placeholders/:id', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { companyId, id } = req.params;
        
        console.log(`🗑️ [AI-PLACEHOLDER-DELETE] Deleting placeholder ${id} for company: ${companyId}`);
        
        // Find company
        const company = await v2Company.findById(companyId);
        
        if (!company) {
            console.log(`❌ [AI-PLACEHOLDER-DELETE] Company not found: ${companyId}`);
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }
        
        // Find and remove placeholder
        const initialLength = company.aiPlaceholders?.length || 0;
        company.aiPlaceholders = company.aiPlaceholders?.filter(p => p.id !== id) || [];
        
        if (company.aiPlaceholders.length === initialLength) {
            console.log(`❌ [AI-PLACEHOLDER-DELETE] Placeholder not found: ${id}`);
            return res.status(404).json({
                success: false,
                message: 'Placeholder not found'
            });
        }
        
        await company.save();
        
        const responseTime = Date.now() - startTime;
        console.log(`✅ [AI-PLACEHOLDER-DELETE] Deleted in ${responseTime}ms`);
        
        res.status(200).json({
            success: true,
            message: 'Placeholder deleted successfully',
            meta: { responseTime }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        console.error(`❌ [AI-PLACEHOLDER-DELETE] Error:`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete AI placeholder',
            error: error.message,
            meta: { responseTime }
        });
    }
});

console.log('✅ [AI-PLACEHOLDER-INIT] AI Placeholders routes defined (GET, POST, PUT, DELETE)');

module.exports = router;

console.log('✅ [AI-PLACEHOLDER-INIT] Module export complete!');

