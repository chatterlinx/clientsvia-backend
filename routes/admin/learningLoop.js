/**
 * ============================================================================
 * LEARNING LOOP API ROUTES
 * ============================================================================
 * 
 * Quick-add endpoints for the Black Box TODO tab.
 * Enables admins to quickly add:
 * - Edge Cases (telemarketer phrases)
 * - Blacklist numbers
 * - Synonyms
 * 
 * Part of the LLM-0 Self-Improvement System.
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const v2Company = require('../../models/v2Company');
const logger = require('../../utils/logger');

// ☢️ NUKED Feb 2026: cheatSheet routes removed
// ============================================================================
// ADD PHRASE TO EDGE CASES - REMOVED
// ============================================================================
// POST /api/admin/learning-loop/quick-add-edge-case/:companyId
// ☢️ NUKED Feb 2026: Full cheat sheet nuke - edge cases stored in cheatSheet
// ============================================================================
router.post('/quick-add-edge-case/:companyId', authenticateJWT, requireRole('admin'), async (req, res) => {
    res.status(410).json({
        success: false,
        error: 'Cheat sheet system has been removed. Edge cases are no longer supported.',
        nukedAt: 'Feb 2026'
    });
});

// ============================================================================
// ADD NUMBER TO BLACKLIST
// ============================================================================
// POST /api/admin/learning-loop/quick-add-blacklist/:companyId
// ============================================================================
router.post('/quick-add-blacklist/:companyId', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { companyId } = req.params;
        const { phoneNumber, reason = 'spam' } = req.body;
        
        if (!phoneNumber || phoneNumber.length < 10) {
            return res.status(400).json({
                success: false,
                message: 'Invalid phone number'
            });
        }
        
        const company = await v2Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }
        
        // Initialize call filtering if not exists
        if (!company.callFiltering) {
            company.callFiltering = { enabled: true, blacklist: [], whitelist: [] };
        }
        if (!Array.isArray(company.callFiltering.blacklist)) {
            company.callFiltering.blacklist = [];
        }
        
        // Normalize phone number
        const normalized = phoneNumber.replace(/\D/g, '');
        
        // Check for duplicate
        const exists = company.callFiltering.blacklist.some(
            entry => (typeof entry === 'string' ? entry : entry.phoneNumber)?.replace(/\D/g, '') === normalized
        );
        
        if (exists) {
            return res.status(409).json({
                success: false,
                message: 'This number is already blacklisted'
            });
        }
        
        // Add to blacklist
        const blacklistEntry = {
            phoneNumber: normalized,
            reason,
            status: 'active',
            addedAt: new Date(),
            addedBy: req.user.email || 'system',
            source: 'black_box_learning'
        };
        
        company.callFiltering.blacklist.push(blacklistEntry);
        company.markModified('callFiltering.blacklist');
        await company.save();
        
        // Clear Redis cache
        try {
            const { redisClient } = require('../../clients');
            await redisClient.del(`company:${companyId}`);
        } catch (cacheErr) {
            logger.debug('[LEARNING LOOP] Failed to clear cache', { error: cacheErr.message });
        }
        
        logger.info('[LEARNING LOOP] Added blacklist from Black Box', {
            companyId,
            phoneNumber: normalized.substring(0, 6) + '****',
            reason,
            addedBy: req.user.email
        });
        
        res.json({
            success: true,
            message: `Added ${normalized.substring(0, 6)}**** to Blacklist`,
            entry: blacklistEntry
        });
        
    } catch (error) {
        logger.error('[LEARNING LOOP] Failed to add blacklist', {
            companyId: req.params.companyId,
            error: error.message
        });
        res.status(500).json({
            success: false,
            message: 'Failed to add to blacklist',
            error: error.message
        });
    }
});

// ============================================================================
// ADD SYNONYM
// ============================================================================
// POST /api/admin/learning-loop/quick-add-synonym/:companyId
// ============================================================================
router.post('/quick-add-synonym/:companyId', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { companyId } = req.params;
        const { slangTerm, technicalTerm, categoryName } = req.body;
        
        if (!slangTerm || !technicalTerm) {
            return res.status(400).json({
                success: false,
                message: 'Both slang term and technical term are required'
            });
        }
        
        const company = await v2Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }
        
        // Find the template
        const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
        const template = await GlobalInstantResponseTemplate.findOne({
            companyId,
            isActive: true
        }).sort({ updatedAt: -1 });
        
        if (!template) {
            return res.status(404).json({
                success: false,
                message: 'No active template found for this company'
            });
        }
        
        // Find the category if specified, otherwise add to first category
        let targetCategory;
        if (categoryName) {
            targetCategory = template.categories.find(c => 
                c.name.toLowerCase() === categoryName.toLowerCase()
            );
        }
        if (!targetCategory && template.categories.length > 0) {
            targetCategory = template.categories[0];
        }
        
        if (!targetCategory) {
            return res.status(404).json({
                success: false,
                message: 'No category found to add synonym to'
            });
        }
        
        // Initialize synonyms array if not exists
        if (!targetCategory.effectiveSynonyms) {
            targetCategory.effectiveSynonyms = [];
        }
        
        // Check for duplicate
        const normalizedSlang = slangTerm.trim().toLowerCase();
        const exists = targetCategory.effectiveSynonyms.some(
            s => s.colloquial?.toLowerCase() === normalizedSlang
        );
        
        if (exists) {
            return res.status(409).json({
                success: false,
                message: 'This synonym already exists'
            });
        }
        
        // Add synonym
        const newSynonym = {
            colloquial: slangTerm.trim(),
            technical: technicalTerm.trim(),
            addedAt: new Date(),
            addedBy: req.user.email || 'system',
            source: 'black_box_learning'
        };
        
        targetCategory.effectiveSynonyms.push(newSynonym);
        template.markModified('categories');
        await template.save();
        
        logger.info('[LEARNING LOOP] Added synonym from Black Box', {
            companyId,
            slangTerm: slangTerm.substring(0, 30),
            technicalTerm: technicalTerm.substring(0, 30),
            category: targetCategory.name,
            addedBy: req.user.email
        });
        
        res.json({
            success: true,
            message: `Added synonym: "${slangTerm}" → "${technicalTerm}" to ${targetCategory.name}`,
            synonym: newSynonym,
            category: targetCategory.name
        });
        
    } catch (error) {
        logger.error('[LEARNING LOOP] Failed to add synonym', {
            companyId: req.params.companyId,
            error: error.message
        });
        res.status(500).json({
            success: false,
            message: 'Failed to add synonym',
            error: error.message
        });
    }
});

// ============================================================================
// GET LEARNING STATS
// ============================================================================
// GET /api/admin/learning-loop/:companyId/stats
// ============================================================================
router.get('/:companyId/stats', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { companyId } = req.params;
        
        const company = await v2Company.findById(companyId).lean();
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }
        
        // ☢️ NUKED Feb 2026: cheatSheet.edgeCases removed - no longer tracked
        const blacklist = company.callFiltering?.blacklist || [];
        
        // Count items added from Black Box
        const blacklistFromBlackBox = blacklist.filter(b => b.source === 'black_box_learning').length;
        
        res.json({
            success: true,
            stats: {
                // ☢️ NUKED Feb 2026: edgeCases removed from stats
                edgeCases: {
                    total: 0,
                    fromBlackBox: 0,
                    active: 0,
                    _note: 'NUKED Feb 2026 - cheatSheet system removed'
                },
                blacklist: {
                    total: blacklist.length,
                    fromBlackBox: blacklistFromBlackBox,
                    active: blacklist.filter(b => b.status === 'active').length
                }
            }
        });
        
    } catch (error) {
        logger.error('[LEARNING LOOP] Failed to get stats', {
            companyId: req.params.companyId,
            error: error.message
        });
        res.status(500).json({
            success: false,
            message: 'Failed to get learning stats',
            error: error.message
        });
    }
});

module.exports = router;
