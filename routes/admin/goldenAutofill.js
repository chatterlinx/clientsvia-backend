/**
 * ════════════════════════════════════════════════════════════════════════════════
 * GOLDEN AUTOFILL - Apply Best-Practice Defaults to Template Scenarios
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * POST /api/trade-knowledge/templates/:templateId/golden-autofill
 * 
 * Actually applies golden defaults to scenarios - not just UI text.
 * Supports dry_run and apply modes with full verification.
 * 
 * ════════════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const logger = require('../../utils/logger');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');

// ═══════════════════════════════════════════════════════════════════════════════
// GOLDEN DEFAULTS CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const GOLDEN_DEFAULTS = {
    version: '1.0.0',
    
    // Reply Strategy
    replySelection: 'random',  // 'random' | 'sequential' | 'bandit'
    replyStrategy: 'AUTO',
    followUpMode: 'NONE',
    
    // Handoff Policy (must match schema enum: 'never' | 'low_confidence' | 'always_on_keyword')
    handoffPolicy: {
        emergency: 'always_on_keyword',
        booking: 'low_confidence',
        faq: 'low_confidence',
        smallTalk: 'never',
        default: 'low_confidence'
    },
    
    // Priority by scenario type (0-100)
    priority: {
        emergency: { min: 90, max: 100 },
        booking: { min: 70, max: 85 },
        faq: { min: 40, max: 60 },
        smallTalk: { min: 0, max: 10 },
        default: { min: 50, max: 70 }
    },
    
    // Min Confidence by type (0.0-1.0)
    minConfidence: {
        emergency: { min: 0.60, max: 0.70 },
        normal: { min: 0.45, max: 0.60 },
        smallTalk: { min: 0.35, max: 0.45 },
        default: 0.50
    },
    
    // Context Weight by type (0.0-1.0)
    contextWeight: {
        emergency: 0.95,
        booking: 0.80,
        faq: 0.70,
        smallTalk: 0.50,
        default: 0.70
    },
    
    // Minimums
    minimums: {
        negativeTriggers: 3,
        quickReplies: 5,
        fullReplies: 3,
        triggers: 5
    },
    
    // Silence Policy
    silencePolicy: {
        maxConsecutive: 2,
        finalWarning: 'Hello? Are you still there?'
    },
    
    // Timed Follow-up
    timedFollowUp: {
        enabled: true,
        delaySeconds: 45,
        extensionSeconds: 30,
        messages: [
            'Are you still there?',
            'Just checking in...',
            "I'm still here if you need me.",
            'Take your time—let me know when you're ready.'
        ]
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO TYPE DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

function detectScenarioType(scenario, categoryName) {
    const name = (scenario.name || '').toLowerCase();
    const catName = (categoryName || '').toLowerCase();
    const triggers = (scenario.triggers || []).map(t => t.toLowerCase()).join(' ');
    
    // Emergency detection
    const emergencyKeywords = ['emergency', 'urgent', 'gas leak', 'no heat', 'no cool', 'freezing', 'flooding', 'dangerous'];
    if (emergencyKeywords.some(k => name.includes(k) || catName.includes(k) || triggers.includes(k))) {
        return 'emergency';
    }
    
    // Booking detection
    const bookingKeywords = ['book', 'schedule', 'appointment', 'reschedule', 'cancel appointment'];
    if (bookingKeywords.some(k => name.includes(k) || catName.includes(k) || triggers.includes(k))) {
        return 'booking';
    }
    
    // Small talk detection
    const smallTalkKeywords = ['how are you', 'thank you', 'thanks', 'goodbye', 'wrong number', 'wrong department'];
    if (smallTalkKeywords.some(k => name.includes(k) || catName.includes(k))) {
        return 'smallTalk';
    }
    
    // FAQ/General
    const faqKeywords = ['pricing', 'cost', 'warranty', 'financing', 'membership', 'service area'];
    if (faqKeywords.some(k => name.includes(k) || catName.includes(k))) {
        return 'faq';
    }
    
    return 'default';
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPUTE UPDATES FOR A SCENARIO
// ═══════════════════════════════════════════════════════════════════════════════

function computeScenarioUpdates(scenario, categoryName) {
    const scenarioType = detectScenarioType(scenario, categoryName);
    const updates = {};
    const reasons = [];
    
    // 1. Reply Strategy
    if (scenario.replySelection !== GOLDEN_DEFAULTS.replySelection) {
        updates.replySelection = GOLDEN_DEFAULTS.replySelection;
        reasons.push(`replySelection: ${scenario.replySelection || 'null'} → ${GOLDEN_DEFAULTS.replySelection}`);
    }
    
    if (scenario.replyStrategy !== GOLDEN_DEFAULTS.replyStrategy) {
        updates.replyStrategy = GOLDEN_DEFAULTS.replyStrategy;
        reasons.push(`replyStrategy: ${scenario.replyStrategy || 'null'} → ${GOLDEN_DEFAULTS.replyStrategy}`);
    }
    
    if (scenario.followUpMode !== GOLDEN_DEFAULTS.followUpMode) {
        updates.followUpMode = GOLDEN_DEFAULTS.followUpMode;
        reasons.push(`followUpMode: ${scenario.followUpMode || 'null'} → ${GOLDEN_DEFAULTS.followUpMode}`);
    }
    
    // 2. Handoff Policy
    const targetHandoff = GOLDEN_DEFAULTS.handoffPolicy[scenarioType] || GOLDEN_DEFAULTS.handoffPolicy.default;
    if (scenario.handoffPolicy !== targetHandoff) {
        updates.handoffPolicy = targetHandoff;
        reasons.push(`handoffPolicy: ${scenario.handoffPolicy || 'null'} → ${targetHandoff} (type: ${scenarioType})`);
    }
    
    // 3. Priority
    const priorityRange = GOLDEN_DEFAULTS.priority[scenarioType] || GOLDEN_DEFAULTS.priority.default;
    const currentPriority = scenario.priority || 5;
    if (currentPriority < priorityRange.min || currentPriority > priorityRange.max) {
        const newPriority = Math.round((priorityRange.min + priorityRange.max) / 2);
        updates.priority = newPriority;
        reasons.push(`priority: ${currentPriority} → ${newPriority} (range: ${priorityRange.min}-${priorityRange.max})`);
    }
    
    // 4. Context Weight
    const targetWeight = GOLDEN_DEFAULTS.contextWeight[scenarioType] || GOLDEN_DEFAULTS.contextWeight.default;
    if (Math.abs((scenario.contextWeight || 0.7) - targetWeight) > 0.05) {
        updates.contextWeight = targetWeight;
        reasons.push(`contextWeight: ${scenario.contextWeight || 0.7} → ${targetWeight}`);
    }
    
    // 5. Silence Policy
    if (!scenario.silencePolicy || scenario.silencePolicy.maxConsecutive !== GOLDEN_DEFAULTS.silencePolicy.maxConsecutive) {
        updates.silencePolicy = GOLDEN_DEFAULTS.silencePolicy;
        reasons.push('silencePolicy: updated to golden default');
    }
    
    // 6. Timed Follow-up
    if (!scenario.timedFollowUp || !scenario.timedFollowUp.enabled) {
        updates.timedFollowUp = GOLDEN_DEFAULTS.timedFollowUp;
        reasons.push('timedFollowUp: enabled with golden default');
    }
    
    // 7. Check minimums (flag but don't auto-generate)
    const warnings = [];
    if ((scenario.negativeTriggers || []).length < GOLDEN_DEFAULTS.minimums.negativeTriggers) {
        warnings.push(`negativeTriggers: only ${(scenario.negativeTriggers || []).length}, needs ${GOLDEN_DEFAULTS.minimums.negativeTriggers}+`);
    }
    if ((scenario.quickReplies || []).length < GOLDEN_DEFAULTS.minimums.quickReplies) {
        warnings.push(`quickReplies: only ${(scenario.quickReplies || []).length}, needs ${GOLDEN_DEFAULTS.minimums.quickReplies}+`);
    }
    if ((scenario.fullReplies || []).length < GOLDEN_DEFAULTS.minimums.fullReplies) {
        warnings.push(`fullReplies: only ${(scenario.fullReplies || []).length}, needs ${GOLDEN_DEFAULTS.minimums.fullReplies}+`);
    }
    if ((scenario.triggers || []).length < GOLDEN_DEFAULTS.minimums.triggers) {
        warnings.push(`triggers: only ${(scenario.triggers || []).length}, needs ${GOLDEN_DEFAULTS.minimums.triggers}+`);
    }
    
    return {
        scenarioId: scenario.scenarioId || scenario._id,
        scenarioName: scenario.name,
        categoryName,
        scenarioType,
        hasUpdates: Object.keys(updates).length > 0,
        updates,
        reasons,
        warnings,
        updateCount: Object.keys(updates).length
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/trade-knowledge/templates/:templateId/golden-autofill
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/:templateId/golden-autofill', async (req, res) => {
    const { templateId } = req.params;
    const { mode = 'dry_run' } = req.body; // 'dry_run' | 'apply'
    const startTime = Date.now();
    const adminUser = req.user?.email || req.user?.username || 'system';
    
    logger.info(`[GOLDEN AUTOFILL] ${mode.toUpperCase()} for template ${templateId} by ${adminUser}`);
    
    try {
        // ═══════════════════════════════════════════════════════════════════
        // STEP 1: Load template
        // ═══════════════════════════════════════════════════════════════════
        const template = await GlobalInstantResponseTemplate.findById(templateId);
        
        if (!template) {
            return res.status(404).json({
                success: false,
                error: 'Template not found',
                templateId
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 2: Compute updates for all scenarios
        // ═══════════════════════════════════════════════════════════════════
        const allUpdates = [];
        let totalScenarios = 0;
        
        for (const category of (template.categories || [])) {
            for (const scenario of (category.scenarios || [])) {
                totalScenarios++;
                const result = computeScenarioUpdates(scenario, category.name);
                allUpdates.push(result);
            }
        }
        
        const toUpdate = allUpdates.filter(u => u.hasUpdates);
        const skipped = allUpdates.filter(u => !u.hasUpdates);
        const withWarnings = allUpdates.filter(u => u.warnings.length > 0);
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 3: If dry_run, return preview
        // ═══════════════════════════════════════════════════════════════════
        if (mode === 'dry_run') {
            return res.json({
                success: true,
                mode: 'dry_run',
                templateId,
                templateName: template.name,
                goldenVersion: GOLDEN_DEFAULTS.version,
                
                summary: {
                    totalScenarios,
                    toUpdate: toUpdate.length,
                    skipped: skipped.length,
                    withWarnings: withWarnings.length
                },
                
                // Sample of first 5 updates
                sampleUpdates: toUpdate.slice(0, 5).map(u => ({
                    scenarioId: u.scenarioId,
                    scenarioName: u.scenarioName,
                    categoryName: u.categoryName,
                    scenarioType: u.scenarioType,
                    changes: u.reasons
                })),
                
                // All warnings
                warnings: withWarnings.map(u => ({
                    scenarioId: u.scenarioId,
                    scenarioName: u.scenarioName,
                    warnings: u.warnings
                })),
                
                // Type breakdown
                byType: {
                    emergency: allUpdates.filter(u => u.scenarioType === 'emergency').length,
                    booking: allUpdates.filter(u => u.scenarioType === 'booking').length,
                    faq: allUpdates.filter(u => u.scenarioType === 'faq').length,
                    smallTalk: allUpdates.filter(u => u.scenarioType === 'smallTalk').length,
                    default: allUpdates.filter(u => u.scenarioType === 'default').length
                },
                
                meta: {
                    generatedAt: new Date().toISOString(),
                    generatedInMs: Date.now() - startTime
                }
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 4: Apply mode - actually write updates
        // ═══════════════════════════════════════════════════════════════════
        const applied = [];
        const failed = [];
        
        for (const category of template.categories) {
            for (const scenario of category.scenarios) {
                const updateInfo = toUpdate.find(u => 
                    u.scenarioId === (scenario.scenarioId || scenario._id?.toString())
                );
                
                if (updateInfo && updateInfo.hasUpdates) {
                    try {
                        // Apply updates directly to the scenario object
                        Object.assign(scenario, updateInfo.updates);
                        scenario.updatedBy = adminUser;
                        scenario.updatedAt = new Date();
                        
                        applied.push({
                            scenarioId: updateInfo.scenarioId,
                            scenarioName: updateInfo.scenarioName,
                            changes: updateInfo.reasons
                        });
                    } catch (e) {
                        failed.push({
                            scenarioId: updateInfo.scenarioId,
                            scenarioName: updateInfo.scenarioName,
                            error: e.message
                        });
                    }
                }
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 5: Save template with audit stamp
        // ═══════════════════════════════════════════════════════════════════
        template.lastGoldenAutofillAt = new Date();
        template.lastGoldenAutofillBy = adminUser;
        template.lastGoldenAutofillVersion = GOLDEN_DEFAULTS.version;
        template.lastUpdatedBy = adminUser;
        template.updatedAt = new Date();
        
        await template.save();
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 6: Verify by re-reading
        // ═══════════════════════════════════════════════════════════════════
        const verifyTemplate = await GlobalInstantResponseTemplate.findById(templateId).lean();
        const verifyScenarioCount = (verifyTemplate.categories || [])
            .reduce((sum, c) => sum + (c.scenarios || []).length, 0);
        
        const verified = verifyScenarioCount === totalScenarios && 
                        verifyTemplate.lastGoldenAutofillVersion === GOLDEN_DEFAULTS.version;
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 7: Return results
        // ═══════════════════════════════════════════════════════════════════
        logger.info(`[GOLDEN AUTOFILL] APPLY complete: ${applied.length} updated, ${skipped.length} skipped, ${failed.length} failed`);
        
        res.json({
            success: true,
            mode: 'apply',
            templateId,
            templateName: template.name,
            goldenVersion: GOLDEN_DEFAULTS.version,
            
            results: {
                totalScenarios,
                updated: applied.length,
                skipped: skipped.length,
                failed: failed.length
            },
            
            // Detailed results
            applied: applied.slice(0, 20), // First 20
            failed,
            
            // Verification
            verification: {
                passed: verified,
                scenarioCountMatch: verifyScenarioCount === totalScenarios,
                stampApplied: !!verifyTemplate.lastGoldenAutofillAt,
                versionMatch: verifyTemplate.lastGoldenAutofillVersion === GOLDEN_DEFAULTS.version
            },
            
            // Audit stamp
            auditStamp: {
                lastGoldenAutofillAt: template.lastGoldenAutofillAt,
                lastGoldenAutofillBy: template.lastGoldenAutofillBy,
                lastGoldenAutofillVersion: template.lastGoldenAutofillVersion
            },
            
            meta: {
                generatedAt: new Date().toISOString(),
                generatedInMs: Date.now() - startTime
            }
        });
        
    } catch (error) {
        logger.error(`[GOLDEN AUTOFILL] Error:`, error);
        res.status(500).json({
            success: false,
            error: error.message,
            templateId
        });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/trade-knowledge/templates/:templateId/golden-autofill/status
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/:templateId/golden-autofill/status', async (req, res) => {
    const { templateId } = req.params;
    
    try {
        const template = await GlobalInstantResponseTemplate.findById(templateId)
            .select('name lastGoldenAutofillAt lastGoldenAutofillBy lastGoldenAutofillVersion')
            .lean();
        
        if (!template) {
            return res.status(404).json({ success: false, error: 'Template not found' });
        }
        
        res.json({
            success: true,
            templateId,
            templateName: template.name,
            goldenAutofill: {
                hasBeenApplied: !!template.lastGoldenAutofillAt,
                lastAppliedAt: template.lastGoldenAutofillAt || null,
                lastAppliedBy: template.lastGoldenAutofillBy || null,
                appliedVersion: template.lastGoldenAutofillVersion || null,
                currentVersion: GOLDEN_DEFAULTS.version,
                needsUpdate: template.lastGoldenAutofillVersion !== GOLDEN_DEFAULTS.version
            }
        });
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;

