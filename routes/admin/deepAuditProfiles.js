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

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/admin/templates/:templateId/scenario-audit-status
// SINGLE SOURCE OF TRUTH: All scenarios with their audit status under active profile
// ════════════════════════════════════════════════════════════════════════════════
router.get('/templates/:templateId/scenario-audit-status', async (req, res) => {
    try {
        const { templateId } = req.params;
        
        logger.info('[SCENARIO-AUDIT-STATUS] Request received', { templateId });
        
        // Get template with all scenarios
        const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
        const template = await GlobalInstantResponseTemplate.findById(templateId).lean();
        
        if (!template) {
            logger.warn('[SCENARIO-AUDIT-STATUS] Template not found', { templateId });
            return res.status(404).json({ error: 'Template not found' });
        }
        
        // Get active profile
        const activeProfile = await deepAuditService.getActiveAuditProfile(templateId);
        const auditProfileId = activeProfile._id.toString();
        
        logger.info('[SCENARIO-AUDIT-STATUS] Looking for results', { 
            templateId, 
            auditProfileId,
            profileName: activeProfile.name
        });
        
        // Get all audit results for this profile
        const auditResults = await ScenarioAuditResult.find({ 
            templateId, 
            auditProfileId 
        }).lean();
        
        logger.info('[SCENARIO-AUDIT-STATUS] Found results', { 
            templateId, 
            auditProfileId,
            resultsCount: auditResults.length 
        });
        
        // Create a map for quick lookup
        const auditMap = new Map();
        auditResults.forEach(r => {
            auditMap.set(r.scenarioId, r);
        });
        
        // Get latest fix ledger entry per scenario (for verified badges)
        const fixLedgerEntries = await ScenarioFixLedger.find({
            templateId,
            auditProfileId
        })
            .sort({ createdAt: -1 })
            .lean();
        
        const fixLedgerMap = new Map();
        for (const entry of fixLedgerEntries) {
            if (!fixLedgerMap.has(entry.scenarioId)) {
                fixLedgerMap.set(entry.scenarioId, entry);
            }
        }
        
        // Build the comprehensive scenario list
        const scenarios = [];
        let totalScenarios = 0;
        let auditedCount = 0;
        let pendingCount = 0;
        let perfectCount = 0;
        let needsWorkCount = 0;
        
        // DEBUG: Log sample of stored scenarioIds vs template scenarioIds
        const storedIds = Array.from(auditMap.keys()).slice(0, 5);
        logger.info('[SCENARIO-AUDIT-STATUS] Sample stored scenarioIds', { storedIds });
        
        // Flatten all scenarios from categories
        let templateIdsSample = [];
        (template.categories || []).forEach(category => {
            (category.scenarios || []).forEach(scenario => {
                totalScenarios++;
                
                const scenarioId = scenario.scenarioId || scenario._id?.toString() || scenario.id;
                
                // Collect first 5 template scenario IDs for comparison
                if (templateIdsSample.length < 5) {
                    templateIdsSample.push({
                        scenarioId,
                        hasScenarioId: !!scenario.scenarioId,
                        has_id: !!scenario._id,
                        hasId: !!scenario.id,
                        name: scenario.name || scenario.scenarioName
                    });
                }
                
                const auditResult = auditMap.get(scenarioId);
                
                const fixEntry = fixLedgerMap.get(scenarioId);
                
                const scenarioInfo = {
                    scenarioId,
                    scenarioName: scenario.scenarioName || scenario.name || 'Unnamed',
                    categoryName: category.categoryName || category.name || 'Uncategorized',
                    isAudited: !!auditResult,
                    auditedAt: auditResult?.createdAt || null,
                    verdict: auditResult?.verdict || null,
                    score: auditResult?.score ?? null,
                    rewriteNeeded: auditResult?.rewriteNeeded ?? null,
                    contentHash: auditResult?.scenarioContentHash || null,
                    lastFixAt: fixEntry?.createdAt || null,
                    fixType: fixEntry?.fixType || null,
                    fixLedgerId: fixEntry?._id?.toString() || null,
                    verifiedAt: fixEntry?.verifiedAt || null,
                    verifiedScore: fixEntry?.verifiedScore ?? null,
                    verifiedVerdict: fixEntry?.verifiedVerdict || null,
                    // Supervision transparency (READ-ONLY - shows what was filtered during audit)
                    supervision: auditResult?.supervision ? {
                        grounded: auditResult.supervision.grounded ?? false,
                        originalIssueCount: auditResult.supervision.originalIssueCount ?? 0,
                        hallucinatedFiltered: auditResult.supervision.hallucinatedFiltered ?? 0,
                        verifiedIssueCount: auditResult.supervision.verifiedIssueCount ?? 0
                    } : null,
                    // Double-check indicator: true if supervision validated the audit
                    isSupervised: !!(auditResult?.supervision?.grounded)
                };
                
                if (auditResult) {
                    auditedCount++;
                    // Classification logic - aligned with Deep Audit modal:
                    // Perfect: score >= 9 AND (verdict is PERFECT or no rewrite needed)
                    // NeedsWork: rewriteNeeded OR score < 7 OR verdict is NEEDS_WORK/FAILS
                    const verdict = (auditResult.verdict || '').toUpperCase();
                    const score = auditResult.score || 0;
                    const rewriteNeeded = auditResult.rewriteNeeded === true;
                    
                    if (score >= 9 && !rewriteNeeded) {
                        perfectCount++;
                    } else if (rewriteNeeded || score < 7 || verdict === 'NEEDS_WORK' || verdict === 'FAILS') {
                        needsWorkCount++;
                    }
                } else {
                    pendingCount++;
                }
                
                scenarios.push(scenarioInfo);
            });
        });
        
        // DEBUG: Log the ID comparison to diagnose mismatch
        logger.info('[SCENARIO-AUDIT-STATUS] 🔍 ID COMPARISON', {
            templateIdsSample,
            storedIdsCount: auditMap.size,
            matchedCount: auditedCount,
            mismatchLikely: auditMap.size > 0 && auditedCount < auditMap.size,
            diagnosis: auditMap.size > auditedCount 
                ? 'MISMATCH: More stored IDs than matches - scenarioId format differs!'
                : 'OK'
        });
        
        // Sort: pending first, then needs_work, then by name
        scenarios.sort((a, b) => {
            // Pending (not audited) first
            if (!a.isAudited && b.isAudited) return -1;
            if (a.isAudited && !b.isAudited) return 1;
            
            // Among audited: needs_work first
            if (a.isAudited && b.isAudited) {
                const aScore = a.score ?? 10;
                const bScore = b.score ?? 10;
                if (aScore !== bScore) return aScore - bScore;
            }
            
            // Then by name
            return (a.scenarioName || '').localeCompare(b.scenarioName || '');
        });
        
        res.json({
            success: true,
            
            // Template info
            template: {
                id: templateId,
                name: template.name || template.templateName || 'Unknown Template',
                totalCategories: template.categories?.length || 0
            },
            
            // Active profile
            auditProfile: {
                id: auditProfileId,
                name: activeProfile.name,
                rubricVersion: activeProfile.rubricVersion || 'v1',
                createdAt: activeProfile.createdAt
            },
            
            // Summary counts
            summary: {
                totalScenarios,
                auditedCount,
                pendingCount,
                perfectCount,
                needsWorkCount,
                progressPercent: totalScenarios > 0 
                    ? Math.round((auditedCount / totalScenarios) * 100) 
                    : 0
            },
            
            // Full scenario list
            scenarios
        });
        
    } catch (error) {
        logger.error('[AUDIT_PROFILES] Get scenario audit status error', { error: error.message });
        res.status(500).json({ error: 'Failed to get scenario audit status', details: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/admin/templates/:templateId/audit-diagnostic
// Debug endpoint: Check what's actually stored in the database
// NOTE: Temporarily public for debugging - add auth back later
// ════════════════════════════════════════════════════════════════════════════════
router.get('/templates/:templateId/audit-diagnostic', /* NO AUTH - TEMP DEBUG */ async (req, res) => {
    try {
        const { templateId } = req.params;
        
        logger.info('[AUDIT_DIAGNOSTIC] Running diagnostic', { templateId });
        
        // Get all profiles for this template
        const profiles = await AuditProfile.find({ templateId }).lean();
        
        // Get count of results per profile for THIS templateId
        const resultCountsForTemplate = await ScenarioAuditResult.aggregate([
            { $match: { templateId } },
            { $group: { _id: '$auditProfileId', count: { $sum: 1 }, avgScore: { $avg: '$score' } } }
        ]);
        
        // Get sample results for THIS templateId
        const sampleResultsForTemplate = await ScenarioAuditResult.find({ templateId })
            .limit(5)
            .sort({ createdAt: -1 })
            .lean();
        
        // ═══════════════════════════════════════════════════════════════════
        // GLOBAL CHECK: What templateIds exist in the ENTIRE collection?
        // ═══════════════════════════════════════════════════════════════════
        const allTemplateIds = await ScenarioAuditResult.distinct('templateId');
        const totalResultCount = await ScenarioAuditResult.countDocuments();
        
        // Get counts per templateId
        const countsByTemplateId = await ScenarioAuditResult.aggregate([
            { $group: { _id: '$templateId', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);
        
        // Get recent results from ANY templateId (to see what's being saved)
        const recentResults = await ScenarioAuditResult.find({})
            .limit(10)
            .sort({ createdAt: -1 })
            .select('templateId scenarioId scenarioName score verdict createdAt auditProfileId')
            .lean();
        
        // ═══════════════════════════════════════════════════════════════════
        // COLLECTION CHECK: Verify the collection exists
        // ═══════════════════════════════════════════════════════════════════
        const mongoose = require('mongoose');
        const collections = await mongoose.connection.db.listCollections().toArray();
        const collectionNames = collections.map(c => c.name);
        const hasScenarioAuditResults = collectionNames.includes('scenarioAuditResults');
        
        res.json({
            success: true,
            queryTemplateId: templateId,
            
            // Results for the requested templateId
            forRequestedTemplate: {
                profileCount: profiles.length,
                profiles: profiles.map(p => ({
                    id: p._id.toString(),
                    name: p.name,
                    isActive: p.isActive
                })),
                resultCount: resultCountsForTemplate.reduce((sum, r) => sum + r.count, 0),
                resultsByProfile: resultCountsForTemplate,
                sampleResults: sampleResultsForTemplate.map(r => ({
                    scenarioId: r.scenarioId,
                    scenarioName: r.scenarioName,
                    score: r.score,
                    verdict: r.verdict
                }))
            },
            
            // Global database state
            globalDatabaseState: {
                collectionExists: hasScenarioAuditResults,
                totalResultsInCollection: totalResultCount,
                uniqueTemplateIdsInDb: allTemplateIds,
                countsByTemplateId: countsByTemplateId,
                recentResults: recentResults.map(r => ({
                    templateId: r.templateId,
                    scenarioId: r.scenarioId,
                    scenarioName: r.scenarioName,
                    score: r.score,
                    verdict: r.verdict,
                    auditProfileId: r.auditProfileId,
                    createdAt: r.createdAt
                }))
            },
            
            // Mismatch detection
            diagnosis: {
                templateIdMatch: allTemplateIds.includes(templateId),
                possibleMismatch: allTemplateIds.length > 0 && !allTemplateIds.includes(templateId)
                    ? `Results exist for other templateIds but NOT for ${templateId}. Check if templateId format differs.`
                    : null,
                suggestion: totalResultCount === 0 
                    ? 'No results in database at all. Either Deep Audit never ran, or saves are failing silently. Check Render logs for [DEEP AUDIT] messages.'
                    : allTemplateIds.includes(templateId)
                        ? 'Results exist for this template. Check if auditProfileId matches.'
                        : 'Results exist but for different templateIds. The Deep Audit might be using a different templateId format.'
            }
        });
        
    } catch (error) {
        logger.error('[AUDIT_DIAGNOSTIC] Error', { error: error.message, stack: error.stack });
        res.status(500).json({ error: 'Diagnostic failed', details: error.message });
    }
});

module.exports = router;
