/**
 * Deep Audit Profiles API
 * 
 * Admin endpoints for managing audit profiles.
 * 
 * KEY CONCEPTS:
 * - Profiles are template-scoped (NOT company-scoped)
 * - Only ONE profile can be active per template
 * - Creating a new profile = fresh audit under new standards
 * - Purging cache = force re-audit under same standards
 * 
 * @module routes/admin/deepAuditProfiles
 */
const express = require('express');
const router = express.Router({ mergeParams: true });

const AuditProfile = require('../../models/AuditProfile');
const ScenarioAuditResult = require('../../models/ScenarioAuditResult');
const ScenarioFixLedger = require('../../models/ScenarioFixLedger');
const deepAuditService = require('../../services/deepAudit');
const logger = require('../../utils/logger');

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/admin/templates/:templateId/audit-profiles
// List all audit profiles for a template
// ════════════════════════════════════════════════════════════════════════════════
router.get('/templates/:templateId/audit-profiles', async (req, res) => {
    try {
        const { templateId } = req.params;
        
        const profiles = await deepAuditService.listProfilesForTemplate(templateId);
        const activeProfile = await deepAuditService.getActiveAuditProfile(templateId);
        
        res.json({
            success: true,
            templateId,
            activeAuditProfileId: activeProfile._id.toString(),
            profiles
        });
        
    } catch (error) {
        logger.error('[AUDIT_PROFILES] List error', { error: error.message });
        res.status(500).json({ error: 'Failed to list audit profiles', details: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/admin/templates/:templateId/audit-profiles/active
// Get the active audit profile
// ════════════════════════════════════════════════════════════════════════════════
router.get('/templates/:templateId/audit-profiles/active', async (req, res) => {
    try {
        const { templateId } = req.params;
        
        const activeProfile = await deepAuditService.getActiveAuditProfile(templateId);
        const stats = await ScenarioAuditResult.getProfileStats(templateId, activeProfile._id.toString());
        
        res.json({
            success: true,
            auditProfile: {
                ...activeProfile,
                stats
            }
        });
        
    } catch (error) {
        logger.error('[AUDIT_PROFILES] Get active error', { error: error.message });
        res.status(500).json({ error: 'Failed to get active profile', details: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/admin/templates/:templateId/audit-profiles/:auditProfileId
// Get a specific audit profile
// ════════════════════════════════════════════════════════════════════════════════
router.get('/templates/:templateId/audit-profiles/:auditProfileId', async (req, res) => {
    try {
        const { templateId, auditProfileId } = req.params;
        
        const profile = await deepAuditService.getAuditProfileById(auditProfileId);
        if (!profile) {
            return res.status(404).json({ error: 'Profile not found' });
        }
        
        const stats = await ScenarioAuditResult.getProfileStats(templateId, auditProfileId);
        const fixStats = await ScenarioFixLedger.getProfileFixStats(templateId, auditProfileId);
        
        res.json({
            success: true,
            auditProfile: {
                ...profile,
                stats,
                fixStats
            }
        });
        
    } catch (error) {
        logger.error('[AUDIT_PROFILES] Get profile error', { error: error.message });
        res.status(500).json({ error: 'Failed to get profile', details: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// POST /api/admin/templates/:templateId/audit-profiles
// Create a new audit profile
// ════════════════════════════════════════════════════════════════════════════════
router.post('/templates/:templateId/audit-profiles', async (req, res) => {
    try {
        const { templateId } = req.params;
        const { 
            name, 
            description,
            config, 
            cloneFromProfileId,
            activateImmediately = false 
        } = req.body;
        
        if (!name) {
            return res.status(400).json({ error: 'Profile name is required' });
        }
        
        const createdBy = req.user?.email || req.user?.username || 'admin';
        
        const profile = await deepAuditService.createAuditProfile({
            templateId,
            name,
            description,
            config,
            cloneFromProfileId,
            createdBy
        });
        
        logger.info('[AUDIT_PROFILES] Created new profile', {
            templateId,
            auditProfileId: profile._id.toString(),
            name,
            createdBy
        });
        
        // Optionally activate immediately
        if (activateImmediately) {
            await deepAuditService.setActiveProfile(templateId, profile._id.toString());
            profile.isActive = true;
        }
        
        res.status(201).json({
            success: true,
            message: `Profile "${name}" created${activateImmediately ? ' and activated' : ''}`,
            auditProfile: profile
        });
        
    } catch (error) {
        logger.error('[AUDIT_PROFILES] Create error', { error: error.message });
        res.status(500).json({ error: 'Failed to create profile', details: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// POST /api/admin/templates/:templateId/audit-profiles/:auditProfileId/activate
// Set a profile as active
// ════════════════════════════════════════════════════════════════════════════════
router.post('/templates/:templateId/audit-profiles/:auditProfileId/activate', async (req, res) => {
    try {
        const { templateId, auditProfileId } = req.params;
        
        const profile = await deepAuditService.setActiveProfile(templateId, auditProfileId);
        
        logger.info('[AUDIT_PROFILES] Activated profile', {
            templateId,
            auditProfileId,
            name: profile.name
        });
        
        res.json({
            success: true,
            message: `Profile "${profile.name}" is now active`,
            auditProfile: profile
        });
        
    } catch (error) {
        logger.error('[AUDIT_PROFILES] Activate error', { error: error.message });
        res.status(500).json({ error: 'Failed to activate profile', details: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// PATCH /api/admin/templates/:templateId/audit-profiles/:auditProfileId
// Update profile settings
// ════════════════════════════════════════════════════════════════════════════════
router.patch('/templates/:templateId/audit-profiles/:auditProfileId', async (req, res) => {
    try {
        const { auditProfileId } = req.params;
        const updates = req.body;
        
        // Don't allow updating certain fields
        delete updates._id;
        delete updates.templateId;
        delete updates.createdAt;
        delete updates.updatedAt;
        
        const profile = await AuditProfile.findByIdAndUpdate(
            auditProfileId,
            { $set: updates },
            { new: true }
        ).lean();
        
        if (!profile) {
            return res.status(404).json({ error: 'Profile not found' });
        }
        
        logger.info('[AUDIT_PROFILES] Updated profile', {
            auditProfileId,
            updates: Object.keys(updates)
        });
        
        res.json({
            success: true,
            message: 'Profile updated',
            auditProfile: profile
        });
        
    } catch (error) {
        logger.error('[AUDIT_PROFILES] Update error', { error: error.message });
        res.status(500).json({ error: 'Failed to update profile', details: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// DELETE /api/admin/templates/:templateId/audit-profiles/:auditProfileId/results
// Purge all audit results for a profile (force re-audit)
// ════════════════════════════════════════════════════════════════════════════════
router.delete('/templates/:templateId/audit-profiles/:auditProfileId/results', async (req, res) => {
    try {
        const { templateId, auditProfileId } = req.params;
        const { confirm } = req.query;
        
        // Require confirmation
        if (confirm !== 'true') {
            return res.status(400).json({
                error: 'Confirmation required',
                message: 'Add ?confirm=true to purge all results. This will force re-audit of all scenarios.'
            });
        }
        
        const deletedCount = await deepAuditService.purgeProfileResults(templateId, auditProfileId);
        
        logger.warn('[AUDIT_PROFILES] Purged all results', {
            templateId,
            auditProfileId,
            deletedCount
        });
        
        res.json({
            success: true,
            message: `Purged ${deletedCount} cached results. Next Deep Audit will re-audit all scenarios.`,
            deletedCount
        });
        
    } catch (error) {
        logger.error('[AUDIT_PROFILES] Purge error', { error: error.message });
        res.status(500).json({ error: 'Failed to purge results', details: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// DELETE /api/admin/templates/:templateId/audit-profiles/:auditProfileId/results/:scenarioId
// Purge audit result for a single scenario (selective re-audit)
// ════════════════════════════════════════════════════════════════════════════════
router.delete('/templates/:templateId/audit-profiles/:auditProfileId/results/:scenarioId', async (req, res) => {
    try {
        const { templateId, auditProfileId, scenarioId } = req.params;
        
        const deletedCount = await deepAuditService.purgeScenarioResult(
            templateId, 
            scenarioId, 
            auditProfileId
        );
        
        logger.info('[AUDIT_PROFILES] Purged scenario result', {
            templateId,
            scenarioId,
            auditProfileId,
            deletedCount
        });
        
        res.json({
            success: true,
            message: deletedCount > 0 
                ? `Purged cached result for scenario. It will be re-audited on next run.`
                : 'No cached result found for this scenario.',
            deletedCount
        });
        
    } catch (error) {
        logger.error('[AUDIT_PROFILES] Purge scenario error', { error: error.message });
        res.status(500).json({ error: 'Failed to purge scenario result', details: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// DELETE /api/admin/templates/:templateId/audit-profiles/:auditProfileId
// Delete a profile (must not be active)
// ════════════════════════════════════════════════════════════════════════════════
router.delete('/templates/:templateId/audit-profiles/:auditProfileId', async (req, res) => {
    try {
        const { templateId, auditProfileId } = req.params;
        const { confirm } = req.query;
        
        // Require confirmation
        if (confirm !== 'true') {
            return res.status(400).json({
                error: 'Confirmation required',
                message: 'Add ?confirm=true to delete this profile and all its results.'
            });
        }
        
        await deepAuditService.deleteProfile(auditProfileId);
        
        logger.warn('[AUDIT_PROFILES] Deleted profile', {
            templateId,
            auditProfileId
        });
        
        res.json({
            success: true,
            message: 'Profile and all its results deleted'
        });
        
    } catch (error) {
        if (error.message.includes('Cannot delete active')) {
            return res.status(400).json({ error: error.message });
        }
        logger.error('[AUDIT_PROFILES] Delete error', { error: error.message });
        res.status(500).json({ error: 'Failed to delete profile', details: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/admin/templates/:templateId/audit-profiles/:auditProfileId/fix-ledger
// Get fix history for a profile
// ════════════════════════════════════════════════════════════════════════════════
router.get('/templates/:templateId/audit-profiles/:auditProfileId/fix-ledger', async (req, res) => {
    try {
        const { templateId, auditProfileId } = req.params;
        const { limit = 100, skip = 0 } = req.query;
        
        const fixes = await ScenarioFixLedger.getProfileFixes(templateId, auditProfileId, {
            limit: parseInt(limit, 10),
            skip: parseInt(skip, 10)
        });
        
        const stats = await ScenarioFixLedger.getProfileFixStats(templateId, auditProfileId);
        
        res.json({
            success: true,
            stats,
            fixes,
            pagination: {
                limit: parseInt(limit, 10),
                skip: parseInt(skip, 10),
                total: stats.totalFixes
            }
        });
        
    } catch (error) {
        logger.error('[AUDIT_PROFILES] Get fix ledger error', { error: error.message });
        res.status(500).json({ error: 'Failed to get fix ledger', details: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/admin/templates/:templateId/scenarios/:scenarioId/fix-history
// Get fix history for a specific scenario
// ════════════════════════════════════════════════════════════════════════════════
router.get('/templates/:templateId/scenarios/:scenarioId/fix-history', async (req, res) => {
    try {
        const { templateId, scenarioId } = req.params;
        const { limit = 10 } = req.query;
        
        const history = await ScenarioFixLedger.getScenarioHistory(
            templateId, 
            scenarioId,
            parseInt(limit, 10)
        );
        
        res.json({
            success: true,
            scenarioId,
            fixCount: history.length,
            history
        });
        
    } catch (error) {
        logger.error('[AUDIT_PROFILES] Get scenario history error', { error: error.message });
        res.status(500).json({ error: 'Failed to get scenario history', details: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/admin/templates/:templateId/audit-results
// Get all audit results for a template (under active profile)
// ════════════════════════════════════════════════════════════════════════════════
router.get('/templates/:templateId/audit-results', async (req, res) => {
    try {
        const { templateId } = req.params;
        const { verdict, minScore, maxScore, limit = 100 } = req.query;
        
        const activeProfile = await deepAuditService.getActiveAuditProfile(templateId);
        const auditProfileId = activeProfile._id.toString();
        
        // Build query
        const query = { templateId, auditProfileId };
        
        if (verdict) {
            query.verdict = verdict;
        }
        if (minScore) {
            query.score = { ...query.score, $gte: parseInt(minScore, 10) };
        }
        if (maxScore) {
            query.score = { ...query.score, $lte: parseInt(maxScore, 10) };
        }
        
        const results = await ScenarioAuditResult.find(query)
            .sort({ score: 1, scenarioName: 1 })
            .limit(parseInt(limit, 10))
            .lean();
        
        const stats = await ScenarioAuditResult.getProfileStats(templateId, auditProfileId);
        
        res.json({
            success: true,
            auditProfile: {
                id: auditProfileId,
                name: activeProfile.name
            },
            stats,
            resultCount: results.length,
            results
        });
        
    } catch (error) {
        logger.error('[AUDIT_PROFILES] Get audit results error', { error: error.message });
        res.status(500).json({ error: 'Failed to get audit results', details: error.message });
    }
});

module.exports = router;
