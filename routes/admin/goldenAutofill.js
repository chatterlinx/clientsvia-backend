/**
 * ════════════════════════════════════════════════════════════════════════════════
 * GOLDEN AUTOFILL - Apply Best-Practice Defaults to Template Scenarios
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * POST /api/trade-knowledge/templates/:templateId/golden-autofill
 * 
 * Features:
 * - Dry run mode with full preview
 * - Per-scenario diff report (before/after)
 * - Respects autofillLock to protect tuned scenarios
 * - Sets scenarioType explicitly
 * - Stores audit log with run details
 * - Quality metrics for Category QA Dashboard
 * 
 * ════════════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const logger = require('../../utils/logger');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');

// ═══════════════════════════════════════════════════════════════════════════════
// GOLDEN DEFAULTS CONFIGURATION v1.1.0
// ═══════════════════════════════════════════════════════════════════════════════

const GOLDEN_DEFAULTS = {
    version: '1.1.0',
    
    // Reply Strategy
    replySelection: 'random',  // 'random' | 'sequential' | 'bandit'
    replyStrategy: 'AUTO',
    followUpMode: 'NONE',
    
    // Handoff Policy by scenarioType (matches schema enum)
    handoffPolicy: {
        EMERGENCY: 'always_on_keyword',
        BOOKING: 'low_confidence',
        FAQ: 'low_confidence',
        SMALL_TALK: 'never',
        SYSTEM: 'never',
        TRANSFER: 'always_on_keyword',
        UNKNOWN: 'low_confidence'
    },
    
    // Priority by scenarioType (0-100)
    priority: {
        EMERGENCY: { min: 90, max: 100, default: 95 },
        BOOKING: { min: 70, max: 85, default: 78 },
        FAQ: { min: 40, max: 60, default: 50 },
        SMALL_TALK: { min: 0, max: 10, default: 5 },
        SYSTEM: { min: 20, max: 40, default: 30 },
        TRANSFER: { min: 80, max: 90, default: 85 },
        UNKNOWN: { min: 50, max: 70, default: 60 }
    },
    
    // Min Confidence by type (0.0-1.0)
    minConfidence: {
        EMERGENCY: { min: 0.60, max: 0.70, default: 0.65 },
        BOOKING: { min: 0.50, max: 0.65, default: 0.55 },
        FAQ: { min: 0.45, max: 0.60, default: 0.50 },
        SMALL_TALK: { min: 0.35, max: 0.45, default: 0.40 },
        SYSTEM: { min: 0.50, max: 0.65, default: 0.55 },
        TRANSFER: { min: 0.55, max: 0.70, default: 0.60 },
        UNKNOWN: { min: 0.45, max: 0.55, default: 0.50 }
    },
    
    // Context Weight by type (0.0-1.0)
    contextWeight: {
        EMERGENCY: 0.95,
        BOOKING: 0.80,
        FAQ: 0.70,
        SMALL_TALK: 0.50,
        SYSTEM: 0.60,
        TRANSFER: 0.85,
        UNKNOWN: 0.70
    },
    
    // Quality Minimums
    minimums: {
        triggers: 8,
        negativeTriggers: 3,
        quickReplies: 7,
        fullReplies: 3
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
            'I am still here if you need me.',
            'Take your time - let me know when you are ready.'
        ]
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO TYPE DETECTION (INTELLIGENT CLASSIFICATION)
// ═══════════════════════════════════════════════════════════════════════════════

const TYPE_KEYWORDS = {
    EMERGENCY: [
        'emergency', 'urgent', 'gas leak', 'no heat', 'no cool', 'freezing',
        'flooding', 'dangerous', 'carbon monoxide', 'smoke', 'fire', 'water damage',
        'broken pipe', 'no power', 'sparking', 'electrical shock', 'burning smell',
        'ceiling leak', 'sewage', 'overflow', 'total failure', 'not turning on'
    ],
    BOOKING: [
        'book', 'schedule', 'appointment', 'reschedule', 'cancel appointment',
        'someone come out', 'send a tech', 'technician visit', 'set up service',
        'when available', 'next available', 'time slot', 'calendar'
    ],
    TRANSFER: [
        'speak to human', 'talk to someone', 'real person', 'manager',
        'supervisor', 'service advisor', 'representative', 'transfer me',
        'connect me', 'let me talk to'
    ],
    SMALL_TALK: [
        'how are you', 'thank you', 'thanks', 'goodbye', 'bye', 'have a nice day',
        'wrong number', 'wrong department', 'sorry', 'oops', 'never mind',
        'just kidding', 'hello', 'hi there', 'good morning', 'good afternoon'
    ],
    FAQ: [
        'pricing', 'cost', 'how much', 'warranty', 'financing', 'membership',
        'service area', 'do you service', 'payment', 'accept credit',
        'hours', 'open', 'closed', 'location', 'address', 'reviews'
    ],
    SYSTEM: [
        'hold please', 'one moment', 'got it', 'understood', 'okay',
        'processing', 'looking up', 'checking'
    ]
};

function detectScenarioType(scenario, categoryName) {
    // If explicitly set and not UNKNOWN, use it
    if (scenario.scenarioType && scenario.scenarioType !== 'UNKNOWN') {
        return scenario.scenarioType;
    }
    
    const searchText = [
        (scenario.name || '').toLowerCase(),
        (categoryName || '').toLowerCase(),
        ...(scenario.triggers || []).map(t => t.toLowerCase())
    ].join(' ');
    
    // Check each type's keywords
    for (const [type, keywords] of Object.entries(TYPE_KEYWORDS)) {
        if (keywords.some(k => searchText.includes(k))) {
            return type;
        }
    }
    
    return 'UNKNOWN';
}

// ═══════════════════════════════════════════════════════════════════════════════
// QUALITY SCORING - For Category QA Dashboard
// ═══════════════════════════════════════════════════════════════════════════════

function computeQualityScore(scenario) {
    let score = 0;
    const issues = [];
    const triggerCount = (scenario.triggers || []).length;
    const negativeCount = (scenario.negativeTriggers || []).length;
    const quickCount = (scenario.quickReplies || []).length;
    const fullCount = (scenario.fullReplies || []).length;
    
    // Triggers (max 25 points)
    if (triggerCount >= GOLDEN_DEFAULTS.minimums.triggers) {
        score += 25;
    } else {
        score += Math.round((triggerCount / GOLDEN_DEFAULTS.minimums.triggers) * 25);
        issues.push(`triggers: ${triggerCount}/${GOLDEN_DEFAULTS.minimums.triggers}`);
    }
    
    // Negatives (max 15 points)
    if (negativeCount >= GOLDEN_DEFAULTS.minimums.negativeTriggers) {
        score += 15;
    } else {
        score += Math.round((negativeCount / GOLDEN_DEFAULTS.minimums.negativeTriggers) * 15);
        issues.push(`negatives: ${negativeCount}/${GOLDEN_DEFAULTS.minimums.negativeTriggers}`);
    }
    
    // Quick replies (max 25 points)
    if (quickCount >= GOLDEN_DEFAULTS.minimums.quickReplies) {
        score += 25;
    } else {
        score += Math.round((quickCount / GOLDEN_DEFAULTS.minimums.quickReplies) * 25);
        issues.push(`quickReplies: ${quickCount}/${GOLDEN_DEFAULTS.minimums.quickReplies}`);
    }
    
    // Full replies (max 15 points)
    if (fullCount >= GOLDEN_DEFAULTS.minimums.fullReplies) {
        score += 15;
    } else {
        score += Math.round((fullCount / GOLDEN_DEFAULTS.minimums.fullReplies) * 15);
        issues.push(`fullReplies: ${fullCount}/${GOLDEN_DEFAULTS.minimums.fullReplies}`);
    }
    
    // Has scenarioType (10 points)
    if (scenario.scenarioType && scenario.scenarioType !== 'UNKNOWN') {
        score += 10;
    } else {
        issues.push('scenarioType: UNKNOWN');
    }
    
    // Has handoffPolicy (5 points)
    if (scenario.handoffPolicy && scenario.handoffPolicy !== 'low_confidence') {
        score += 5;
    } else if (scenario.scenarioType === 'EMERGENCY' && scenario.handoffPolicy !== 'always_on_keyword') {
        issues.push('handoffPolicy: should be always_on_keyword for EMERGENCY');
    }
    
    // Has actionHooks (5 points bonus)
    if ((scenario.actionHooks || []).length > 0) {
        score += 5;
    }
    
    return {
        score: Math.min(100, score),
        grade: score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F',
        issues,
        counts: { triggerCount, negativeCount, quickCount, fullCount }
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPUTE UPDATES FOR A SCENARIO (WITH FULL DIFF)
// ═══════════════════════════════════════════════════════════════════════════════

function computeScenarioUpdates(scenario, categoryName) {
    const detectedType = detectScenarioType(scenario, categoryName);
    const updates = {};
    const diff = []; // Full before/after diff
    
    // ─────────────────────────────────────────────────────────────────────────
    // 1. SET scenarioType (if not explicitly set)
    // ─────────────────────────────────────────────────────────────────────────
    if (!scenario.scenarioType || scenario.scenarioType === 'UNKNOWN') {
        updates.scenarioType = detectedType;
        diff.push({
            field: 'scenarioType',
            before: scenario.scenarioType || null,
            after: detectedType,
            reason: 'Auto-classified from name/triggers'
        });
    }
    
    const effectiveType = updates.scenarioType || scenario.scenarioType || detectedType;
    
    // ─────────────────────────────────────────────────────────────────────────
    // 2. Reply Strategy
    // ─────────────────────────────────────────────────────────────────────────
    if (scenario.replySelection !== GOLDEN_DEFAULTS.replySelection) {
        updates.replySelection = GOLDEN_DEFAULTS.replySelection;
        diff.push({
            field: 'replySelection',
            before: scenario.replySelection || null,
            after: GOLDEN_DEFAULTS.replySelection,
            reason: 'Golden default'
        });
    }
    
    if (scenario.replyStrategy !== GOLDEN_DEFAULTS.replyStrategy) {
        updates.replyStrategy = GOLDEN_DEFAULTS.replyStrategy;
        diff.push({
            field: 'replyStrategy',
            before: scenario.replyStrategy || null,
            after: GOLDEN_DEFAULTS.replyStrategy,
            reason: 'Golden default'
        });
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // 3. Handoff Policy (by type)
    // ─────────────────────────────────────────────────────────────────────────
    const targetHandoff = GOLDEN_DEFAULTS.handoffPolicy[effectiveType] || GOLDEN_DEFAULTS.handoffPolicy.UNKNOWN;
    if (scenario.handoffPolicy !== targetHandoff) {
        updates.handoffPolicy = targetHandoff;
        diff.push({
            field: 'handoffPolicy',
            before: scenario.handoffPolicy || null,
            after: targetHandoff,
            reason: `Golden default for ${effectiveType}`
        });
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // 4. Priority (by type)
    // ─────────────────────────────────────────────────────────────────────────
    const priorityConfig = GOLDEN_DEFAULTS.priority[effectiveType] || GOLDEN_DEFAULTS.priority.UNKNOWN;
    const currentPriority = scenario.priority ?? 5;
    if (currentPriority < priorityConfig.min || currentPriority > priorityConfig.max) {
        updates.priority = priorityConfig.default;
        diff.push({
            field: 'priority',
            before: currentPriority,
            after: priorityConfig.default,
            reason: `Out of range for ${effectiveType} (${priorityConfig.min}-${priorityConfig.max})`
        });
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // 5. Min Confidence (by type)
    // ─────────────────────────────────────────────────────────────────────────
    const confidenceConfig = GOLDEN_DEFAULTS.minConfidence[effectiveType] || GOLDEN_DEFAULTS.minConfidence.UNKNOWN;
    const currentConfidence = scenario.minConfidence ?? 0.5;
    if (currentConfidence < confidenceConfig.min || currentConfidence > confidenceConfig.max) {
        updates.minConfidence = confidenceConfig.default;
        diff.push({
            field: 'minConfidence',
            before: currentConfidence,
            after: confidenceConfig.default,
            reason: `Out of range for ${effectiveType} (${confidenceConfig.min}-${confidenceConfig.max})`
        });
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // 6. Context Weight (by type)
    // ─────────────────────────────────────────────────────────────────────────
    const targetWeight = GOLDEN_DEFAULTS.contextWeight[effectiveType] || GOLDEN_DEFAULTS.contextWeight.UNKNOWN;
    const currentWeight = scenario.contextWeight ?? 0.7;
    if (Math.abs(currentWeight - targetWeight) > 0.05) {
        updates.contextWeight = targetWeight;
        diff.push({
            field: 'contextWeight',
            before: currentWeight,
            after: targetWeight,
            reason: `Golden default for ${effectiveType}`
        });
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // 7. Silence Policy
    // ─────────────────────────────────────────────────────────────────────────
    if (!scenario.silencePolicy || scenario.silencePolicy.maxConsecutive !== GOLDEN_DEFAULTS.silencePolicy.maxConsecutive) {
        updates.silencePolicy = GOLDEN_DEFAULTS.silencePolicy;
        diff.push({
            field: 'silencePolicy',
            before: scenario.silencePolicy || null,
            after: GOLDEN_DEFAULTS.silencePolicy,
            reason: 'Golden default'
        });
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // 8. Timed Follow-up
    // ─────────────────────────────────────────────────────────────────────────
    if (!scenario.timedFollowUp || !scenario.timedFollowUp.enabled) {
        updates.timedFollowUp = GOLDEN_DEFAULTS.timedFollowUp;
        diff.push({
            field: 'timedFollowUp',
            before: scenario.timedFollowUp || null,
            after: GOLDEN_DEFAULTS.timedFollowUp,
            reason: 'Enable with golden defaults'
        });
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // Quality Assessment (never auto-fixed, just flagged)
    // ─────────────────────────────────────────────────────────────────────────
    const quality = computeQualityScore(scenario);
    
    return {
        scenarioId: scenario.scenarioId || scenario._id?.toString(),
        scenarioName: scenario.name,
        categoryName,
        detectedType,
        effectiveType,
        isLocked: scenario.autofillLock === true,
        hasUpdates: Object.keys(updates).length > 0,
        updates,
        diff,
        quality,
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
        const allResults = [];
        let totalScenarios = 0;
        let lockedCount = 0;
        
        for (const category of (template.categories || [])) {
            for (const scenario of (category.scenarios || [])) {
                totalScenarios++;
                const result = computeScenarioUpdates(scenario, category.name);
                
                if (result.isLocked) {
                    lockedCount++;
                }
                
                allResults.push(result);
            }
        }
        
        // Categorize results
        const locked = allResults.filter(r => r.isLocked);
        const toUpdate = allResults.filter(r => !r.isLocked && r.hasUpdates);
        const alreadyCompliant = allResults.filter(r => !r.isLocked && !r.hasUpdates);
        const withQualityIssues = allResults.filter(r => r.quality.issues.length > 0);
        
        // Type breakdown
        const byType = {};
        for (const type of ['EMERGENCY', 'BOOKING', 'FAQ', 'SMALL_TALK', 'SYSTEM', 'TRANSFER', 'UNKNOWN']) {
            byType[type] = allResults.filter(r => r.effectiveType === type).length;
        }
        
        // Quality breakdown
        const byGrade = { A: 0, B: 0, C: 0, D: 0, F: 0 };
        for (const r of allResults) {
            byGrade[r.quality.grade]++;
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 3: If dry_run, return preview (no writes)
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
                    alreadyCompliant: alreadyCompliant.length,
                    locked: lockedCount,
                    withQualityIssues: withQualityIssues.length,
                    averageQualityScore: Math.round(allResults.reduce((sum, r) => sum + r.quality.score, 0) / allResults.length)
                },
                
                // Detailed breakdown
                byType,
                byGrade,
                
                // Full diff for scenarios to update (first 10)
                willUpdate: toUpdate.slice(0, 10).map(r => ({
                    scenarioId: r.scenarioId,
                    scenarioName: r.scenarioName,
                    categoryName: r.categoryName,
                    type: r.effectiveType,
                    quality: r.quality,
                    changes: r.diff
                })),
                
                // Locked scenarios (skipped)
                lockedScenarios: locked.map(r => ({
                    scenarioId: r.scenarioId,
                    scenarioName: r.scenarioName,
                    categoryName: r.categoryName,
                    reason: 'autofillLock=true (manually tuned)'
                })),
                
                // Quality issues (needs manual attention)
                qualityIssues: withQualityIssues.slice(0, 15).map(r => ({
                    scenarioId: r.scenarioId,
                    scenarioName: r.scenarioName,
                    categoryName: r.categoryName,
                    type: r.effectiveType,
                    grade: r.quality.grade,
                    score: r.quality.score,
                    issues: r.quality.issues,
                    counts: r.quality.counts
                })),
                
                meta: {
                    generatedAt: new Date().toISOString(),
                    generatedInMs: Date.now() - startTime
                }
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 4: Apply mode - actually write updates (skip locked)
        // ═══════════════════════════════════════════════════════════════════
        const applied = [];
        const skipped = [];
        const failed = [];
        
        for (const category of template.categories) {
            for (const scenario of category.scenarios) {
                const scenarioIdStr = scenario.scenarioId || scenario._id?.toString();
                const updateInfo = toUpdate.find(u => u.scenarioId === scenarioIdStr);
                
                // Skip locked scenarios
                if (scenario.autofillLock === true) {
                    skipped.push({
                        scenarioId: scenarioIdStr,
                        scenarioName: scenario.name,
                        reason: 'autofillLock=true'
                    });
                    continue;
                }
                
                if (updateInfo && updateInfo.hasUpdates) {
                    try {
                        // Apply updates
                        Object.assign(scenario, updateInfo.updates);
                        
                        // Audit fields
                        scenario.lastAutofillAt = new Date();
                        scenario.lastAutofillVersion = GOLDEN_DEFAULTS.version;
                        scenario.updatedBy = adminUser;
                        scenario.updatedAt = new Date();
                        
                        applied.push({
                            scenarioId: scenarioIdStr,
                            scenarioName: scenario.name,
                            categoryName: updateInfo.categoryName,
                            type: updateInfo.effectiveType,
                            changes: updateInfo.diff
                        });
                    } catch (e) {
                        failed.push({
                            scenarioId: scenarioIdStr,
                            scenarioName: scenario.name,
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
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 7: Build audit log
        // ═══════════════════════════════════════════════════════════════════
        const auditLog = {
            runId: `autofill-${Date.now()}`,
            templateId,
            templateName: template.name,
            goldenVersion: GOLDEN_DEFAULTS.version,
            executedBy: adminUser,
            executedAt: new Date().toISOString(),
            results: {
                total: totalScenarios,
                updated: applied.length,
                skipped: skipped.length + alreadyCompliant.length,
                locked: lockedCount,
                failed: failed.length
            },
            byType,
            byGrade,
            durationMs: Date.now() - startTime
        };
        
        logger.info(`[GOLDEN AUTOFILL] APPLY complete:`, auditLog);
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 8: Return results
        // ═══════════════════════════════════════════════════════════════════
        res.json({
            success: true,
            mode: 'apply',
            templateId,
            templateName: template.name,
            goldenVersion: GOLDEN_DEFAULTS.version,
            
            results: {
                totalScenarios,
                updated: applied.length,
                skipped: skipped.length + alreadyCompliant.length,
                locked: lockedCount,
                failed: failed.length
            },
            
            byType,
            byGrade,
            
            // Detailed applied changes (first 20)
            applied: applied.slice(0, 20),
            
            // Skipped (locked)
            skipped: skipped.slice(0, 10),
            
            // Failed
            failed,
            
            // Verification
            verification: {
                passed: verifyScenarioCount === totalScenarios,
                scenarioCountMatch: verifyScenarioCount === totalScenarios,
                stampApplied: !!verifyTemplate.lastGoldenAutofillAt,
                versionMatch: verifyTemplate.lastGoldenAutofillVersion === GOLDEN_DEFAULTS.version
            },
            
            // Audit log (for export)
            auditLog,
            
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

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/trade-knowledge/templates/:templateId/quality-report
// Category QA Dashboard data
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/:templateId/quality-report', async (req, res) => {
    const { templateId } = req.params;
    const startTime = Date.now();
    
    try {
        const template = await GlobalInstantResponseTemplate.findById(templateId).lean();
        
        if (!template) {
            return res.status(404).json({ success: false, error: 'Template not found' });
        }
        
        const categoryReports = [];
        let templateTotalScore = 0;
        let templateScenarioCount = 0;
        
        for (const category of (template.categories || [])) {
            const scenarioReports = [];
            let categoryTotalScore = 0;
            
            for (const scenario of (category.scenarios || [])) {
                const quality = computeQualityScore(scenario);
                const detectedType = detectScenarioType(scenario, category.name);
                
                scenarioReports.push({
                    scenarioId: scenario.scenarioId,
                    name: scenario.name,
                    scenarioType: scenario.scenarioType || detectedType,
                    detectedType,
                    priority: scenario.priority || 0,
                    minConfidence: scenario.minConfidence || 0.5,
                    handoffPolicy: scenario.handoffPolicy || 'low_confidence',
                    isLocked: scenario.autofillLock === true,
                    lastAutofillAt: scenario.lastAutofillAt || null,
                    lastManualTuneAt: scenario.lastManualTuneAt || null,
                    quality,
                    counts: quality.counts,
                    needsWork: quality.grade === 'D' || quality.grade === 'F'
                });
                
                categoryTotalScore += quality.score;
                templateTotalScore += quality.score;
                templateScenarioCount++;
            }
            
            const categoryAvgScore = scenarioReports.length > 0 
                ? Math.round(categoryTotalScore / scenarioReports.length) 
                : 0;
            
            categoryReports.push({
                categoryId: category.id,
                categoryName: category.name,
                scenarioCount: scenarioReports.length,
                averageScore: categoryAvgScore,
                grade: categoryAvgScore >= 90 ? 'A' : categoryAvgScore >= 80 ? 'B' : categoryAvgScore >= 70 ? 'C' : categoryAvgScore >= 60 ? 'D' : 'F',
                needsWorkCount: scenarioReports.filter(s => s.needsWork).length,
                lockedCount: scenarioReports.filter(s => s.isLocked).length,
                scenarios: scenarioReports.sort((a, b) => a.quality.score - b.quality.score) // Worst first
            });
        }
        
        // Sort categories by average score (worst first)
        categoryReports.sort((a, b) => a.averageScore - b.averageScore);
        
        res.json({
            success: true,
            templateId,
            templateName: template.name,
            
            summary: {
                totalCategories: categoryReports.length,
                totalScenarios: templateScenarioCount,
                averageScore: templateScenarioCount > 0 ? Math.round(templateTotalScore / templateScenarioCount) : 0,
                categoriesNeedingWork: categoryReports.filter(c => c.grade === 'D' || c.grade === 'F').length,
                scenariosNeedingWork: categoryReports.reduce((sum, c) => sum + c.needsWorkCount, 0),
                lockedScenarios: categoryReports.reduce((sum, c) => sum + c.lockedCount, 0)
            },
            
            // Fix queue - categories sorted by score (worst first)
            fixQueue: categoryReports.filter(c => c.needsWorkCount > 0).map(c => ({
                categoryId: c.categoryId,
                categoryName: c.categoryName,
                averageScore: c.averageScore,
                grade: c.grade,
                scenariosToFix: c.needsWorkCount
            })),
            
            categories: categoryReports,
            
            minimumRequirements: GOLDEN_DEFAULTS.minimums,
            goldenVersion: GOLDEN_DEFAULTS.version,
            
            meta: {
                generatedAt: new Date().toISOString(),
                generatedInMs: Date.now() - startTime
            }
        });
        
    } catch (error) {
        logger.error(`[QUALITY REPORT] Error:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/trade-knowledge/templates/:templateId/scenarios/:scenarioId/lock
// Toggle autofill lock on a scenario
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/:templateId/scenarios/:scenarioId/lock', async (req, res) => {
    const { templateId, scenarioId } = req.params;
    const { locked } = req.body;
    const adminUser = req.user?.email || req.user?.username || 'system';
    
    try {
        const template = await GlobalInstantResponseTemplate.findById(templateId);
        
        if (!template) {
            return res.status(404).json({ success: false, error: 'Template not found' });
        }
        
        // Find scenario across all categories
        let found = false;
        for (const category of template.categories) {
            const scenario = (category.scenarios || []).find(s => 
                s.scenarioId === scenarioId || s._id?.toString() === scenarioId
            );
            
            if (scenario) {
                scenario.autofillLock = locked === true;
                if (locked) {
                    scenario.lastManualTuneAt = new Date();
                    scenario.lastManualTuneBy = adminUser;
                }
                found = true;
                break;
            }
        }
        
        if (!found) {
            return res.status(404).json({ success: false, error: 'Scenario not found' });
        }
        
        await template.save();
        
        res.json({
            success: true,
            scenarioId,
            autofillLock: locked === true,
            message: locked ? 'Scenario locked - autofill will skip' : 'Scenario unlocked - autofill can modify'
        });
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
