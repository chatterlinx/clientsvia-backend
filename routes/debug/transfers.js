/**
 * ============================================================================
 * DEBUG: TRANSFERS ENDPOINTS
 * ============================================================================
 * 
 * GET  /api/company/:companyId/debug/transfers  - Read current transfer targets
 * PUT  /api/company/:companyId/debug/transfers  - Add/update transfer target + read-back
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const mongoose = require('mongoose');
const v2Company = require('../../models/v2Company');
const logger = require('../../utils/logger');

/**
 * GET /api/company/:companyId/debug/transfers
 * 
 * Returns current transfer targets from DB.
 */
router.get('/', async (req, res) => {
    const { companyId } = req.params;
    
    try {
        const company = await v2Company.findById(companyId)
            .select('companyName aiAgentSettings.transferTargets frontDeskBehavior.transfers')
            .lean();
        
        if (!company) {
            return res.status(404).json({ ok: false, error: 'Company not found' });
        }
        
        const primaryTargets = company.aiAgentSettings?.transferTargets || [];
        const legacyTargets = company.frontDeskBehavior?.transfers?.targets || [];
        
        res.json({
            ok: true,
            companyId,
            companyName: company.companyName,
            sources: {
                'aiAgentSettings.transferTargets': primaryTargets.length,
                'frontDeskBehavior.transfers.targets': legacyTargets.length
            },
            targets: primaryTargets,
            legacyTargets: legacyTargets.length > 0 ? legacyTargets : undefined
        });
        
    } catch (error) {
        logger.error('[DEBUG TRANSFERS GET] Error:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

/**
 * PUT /api/company/:companyId/debug/transfers
 * 
 * Add or update a transfer target. If id exists, update in place; else append.
 * 
 * Body: { "id": "service_advisor", "label": "Service Advisor", "type": "phone", "destination": "+1...", "enabled": true }
 */
router.put('/', async (req, res) => {
    const { companyId } = req.params;
    const { id, label, type = 'phone', destination, enabled = true, description, priority = 1 } = req.body;
    
    if (!id) {
        return res.status(400).json({
            ok: false,
            error: 'id field is required',
            example: { id: 'service_advisor', label: 'Service Advisor', type: 'phone', destination: '+15551234567', enabled: true }
        });
    }
    
    if (!destination) {
        return res.status(400).json({
            ok: false,
            error: 'destination field is required (phone number or queue name)'
        });
    }
    
    try {
        // First, get current targets to check if id exists
        const company = await v2Company.findById(companyId).lean();
        
        if (!company) {
            return res.status(404).json({ ok: false, error: 'Company not found' });
        }
        
        const existingTargets = company.aiAgentSettings?.transferTargets || [];
        const existingIndex = existingTargets.findIndex(t => t.id === id);
        
        const newTarget = {
            id,
            name: label || id,
            label: label || id,
            type,
            destination,
            description: description || `Transfer target: ${label || id}`,
            priority,
            enabled,
            isDefault: existingTargets.length === 0 // First target is default
        };
        
        let action = 'created';
        let updatedTargets;
        
        if (existingIndex >= 0) {
            // Update in place
            action = 'updated';
            updatedTargets = [...existingTargets];
            updatedTargets[existingIndex] = { ...updatedTargets[existingIndex], ...newTarget };
        } else {
            // Append
            updatedTargets = [...existingTargets, newTarget];
        }
        
        // Write to DB
        await v2Company.updateOne(
            { _id: new mongoose.Types.ObjectId(companyId) },
            {
                $set: {
                    'aiAgentSettings.transferTargets': updatedTargets,
                    updatedAt: new Date()
                }
            }
        );
        
        // Clear Redis cache
        try {
            const { redisClient } = require('../../db');
            if (redisClient && redisClient.isOpen) {
                await redisClient.del(`company:${companyId}`);
            }
        } catch (e) {
            // Non-critical
        }
        
        logger.info(`[DEBUG TRANSFERS PUT] ${action} transfer ${id} for ${companyId}`);
        
        // Read-back from DB
        const updatedCompany = await v2Company.findById(companyId)
            .select('aiAgentSettings.transferTargets')
            .lean();
        
        const readBackTargets = updatedCompany?.aiAgentSettings?.transferTargets || [];
        
        res.json({
            ok: true,
            action,
            wrote: newTarget,
            wroteCount: updatedTargets.length,
            readBackTargets,
            verification: {
                success: readBackTargets.some(t => t.id === id && t.destination === destination)
            }
        });
        
    } catch (error) {
        logger.error('[DEBUG TRANSFERS PUT] Error:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

/**
 * DELETE /api/company/:companyId/debug/transfers/:targetId
 * 
 * Remove a transfer target by id.
 */
router.delete('/:targetId', async (req, res) => {
    const { companyId, targetId } = req.params;
    
    try {
        const company = await v2Company.findById(companyId).lean();
        
        if (!company) {
            return res.status(404).json({ ok: false, error: 'Company not found' });
        }
        
        const existingTargets = company.aiAgentSettings?.transferTargets || [];
        const filteredTargets = existingTargets.filter(t => t.id !== targetId);
        
        if (filteredTargets.length === existingTargets.length) {
            return res.status(404).json({ ok: false, error: `Transfer target '${targetId}' not found` });
        }
        
        await v2Company.updateOne(
            { _id: new mongoose.Types.ObjectId(companyId) },
            {
                $set: {
                    'aiAgentSettings.transferTargets': filteredTargets,
                    updatedAt: new Date()
                }
            }
        );
        
        // Clear Redis cache
        try {
            const { redisClient } = require('../../db');
            if (redisClient && redisClient.isOpen) {
                await redisClient.del(`company:${companyId}`);
            }
        } catch (e) {
            // Non-critical
        }
        
        logger.info(`[DEBUG TRANSFERS DELETE] Removed transfer ${targetId} for ${companyId}`);
        
        // Read-back
        const updatedCompany = await v2Company.findById(companyId)
            .select('aiAgentSettings.transferTargets')
            .lean();
        
        res.json({
            ok: true,
            action: 'deleted',
            deletedId: targetId,
            readBackTargets: updatedCompany?.aiAgentSettings?.transferTargets || []
        });
        
    } catch (error) {
        logger.error('[DEBUG TRANSFERS DELETE] Error:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

module.exports = router;

