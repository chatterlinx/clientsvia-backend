/**
 * QuickAnswers Management Routes
 * Handles deduplication and management of QuickAnswer entries
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const v2Company = require('../../models/v2Company');
const logger = require('../../utils/logger');

/**
 * POST /api/company/:companyId/quickanswers/dedupe
 * Handle duplicate QuickAnswer resolution
 */
router.post('/dedupe', async (req, res) => {
    const { companyId } = req.params;
    const { action, firstId, duplicateId, triggers, reason, timestamp } = req.body;
    
    try {
        const company = await v2Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        // Find QuickAnswers in company config
        const quickAnswers = company.aiAgentSettings?.quickAnswers || 
                            company.frontDeskBehavior?.quickAnswers || 
                            company.quickAnswers || [];
        
        if (quickAnswers.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No QuickAnswers found in company config'
            });
        }
        
        // Find the duplicates by ID or by triggers
        let firstQA = quickAnswers.find(qa => qa._id?.toString() === firstId || qa.id === firstId);
        let duplicateQA = quickAnswers.find(qa => qa._id?.toString() === duplicateId || qa.id === duplicateId);
        
        // If IDs not found, try matching by triggers
        if (!firstQA || !duplicateQA) {
            const matchingQAs = quickAnswers.filter(qa => {
                const qaTriggers = qa.triggers || [];
                return triggers.some(t => qaTriggers.includes(t));
            });
            
            if (matchingQAs.length >= 2) {
                firstQA = matchingQAs[0];
                duplicateQA = matchingQAs[1];
            }
        }
        
        if (!firstQA || !duplicateQA) {
            return res.status(400).json({
                success: false,
                error: 'Could not find matching QuickAnswers'
            });
        }
        
        const changes = [];
        
        switch (action) {
            case 'keep_newest':
                // Compare creation dates, disable older
                const firstDate = new Date(firstQA.createdAt || 0);
                const dupDate = new Date(duplicateQA.createdAt || 0);
                
                if (dupDate > firstDate) {
                    firstQA.enabled = false;
                    firstQA.disabledReason = reason;
                    firstQA.disabledAt = timestamp;
                    changes.push(`Disabled first QA (older): ${firstQA.answer?.substring(0, 30)}...`);
                } else {
                    duplicateQA.enabled = false;
                    duplicateQA.disabledReason = reason;
                    duplicateQA.disabledAt = timestamp;
                    changes.push(`Disabled duplicate QA (older): ${duplicateQA.answer?.substring(0, 30)}...`);
                }
                break;
                
            case 'keep_highest_priority':
                const firstPriority = firstQA.priority || 0;
                const dupPriority = duplicateQA.priority || 0;
                
                if (dupPriority > firstPriority) {
                    firstQA.enabled = false;
                    firstQA.disabledReason = reason;
                    firstQA.disabledAt = timestamp;
                    changes.push(`Disabled first QA (lower priority): ${firstQA.answer?.substring(0, 30)}...`);
                } else {
                    duplicateQA.enabled = false;
                    duplicateQA.disabledReason = reason;
                    duplicateQA.disabledAt = timestamp;
                    changes.push(`Disabled duplicate QA (lower priority): ${duplicateQA.answer?.substring(0, 30)}...`);
                }
                break;
                
            case 'merge_triggers':
                // Merge all triggers into the first QA, disable the duplicate
                const allTriggers = [...new Set([
                    ...(firstQA.triggers || []),
                    ...(duplicateQA.triggers || [])
                ])];
                firstQA.triggers = allTriggers;
                duplicateQA.enabled = false;
                duplicateQA.disabledReason = reason;
                duplicateQA.disabledAt = timestamp;
                changes.push(`Merged ${allTriggers.length} triggers into first QA`);
                changes.push(`Disabled duplicate QA: ${duplicateQA.answer?.substring(0, 30)}...`);
                break;
                
            case 'keep_first':
                duplicateQA.enabled = false;
                duplicateQA.disabledReason = reason;
                duplicateQA.disabledAt = timestamp;
                changes.push(`Disabled duplicate QA: ${duplicateQA.answer?.substring(0, 30)}...`);
                break;
                
            case 'keep_duplicate':
                firstQA.enabled = false;
                firstQA.disabledReason = reason;
                firstQA.disabledAt = timestamp;
                changes.push(`Disabled first QA: ${firstQA.answer?.substring(0, 30)}...`);
                break;
                
            default:
                return res.status(400).json({
                    success: false,
                    error: `Unknown action: ${action}`
                });
        }
        
        // Save back to the correct path
        if (company.aiAgentSettings?.quickAnswers) {
            company.aiAgentSettings.quickAnswers = quickAnswers;
        } else if (company.frontDeskBehavior?.quickAnswers) {
            company.frontDeskBehavior.quickAnswers = quickAnswers;
        } else {
            company.quickAnswers = quickAnswers;
        }
        
        await company.save();
        
        // Clear Redis cache
        const { redisClient } = require('../../db');
        if (redisClient && redisClient.isOpen) {
            await redisClient.del(`company:${companyId}`);
        }
        
        logger.info(`[QUICKANSWERS DEDUPE] ${action} for company ${companyId}: ${changes.join(', ')}`);
        
        res.json({
            success: true,
            message: `Applied action: ${action}`,
            changes
        });
        
    } catch (error) {
        logger.error('[QUICKANSWERS DEDUPE] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/company/:companyId/quickanswers/restore-disabled
 * Restore QuickAnswers that were disabled by the deduper
 */
router.post('/restore-disabled', async (req, res) => {
    const { companyId } = req.params;
    const { reason } = req.body;
    
    try {
        const company = await v2Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        const quickAnswers = company.aiAgentSettings?.quickAnswers || 
                            company.frontDeskBehavior?.quickAnswers || 
                            company.quickAnswers || [];
        
        let restoredCount = 0;
        
        for (const qa of quickAnswers) {
            if (qa.enabled === false && qa.disabledReason === reason) {
                qa.enabled = true;
                delete qa.disabledReason;
                delete qa.disabledAt;
                restoredCount++;
            }
        }
        
        if (restoredCount === 0) {
            return res.json({
                success: true,
                message: 'No QuickAnswers to restore',
                restoredCount: 0
            });
        }
        
        // Save back
        if (company.aiAgentSettings?.quickAnswers) {
            company.aiAgentSettings.quickAnswers = quickAnswers;
        } else if (company.frontDeskBehavior?.quickAnswers) {
            company.frontDeskBehavior.quickAnswers = quickAnswers;
        } else {
            company.quickAnswers = quickAnswers;
        }
        
        await company.save();
        
        // Clear Redis cache
        const { redisClient } = require('../../db');
        if (redisClient && redisClient.isOpen) {
            await redisClient.del(`company:${companyId}`);
        }
        
        logger.info(`[QUICKANSWERS RESTORE] Restored ${restoredCount} QAs for company ${companyId}`);
        
        res.json({
            success: true,
            message: `Restored ${restoredCount} QuickAnswer(s)`,
            restoredCount
        });
        
    } catch (error) {
        logger.error('[QUICKANSWERS RESTORE] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;

