/**
 * ============================================================================
 * WIRING ROUTES - API endpoints for Wiring Tab
 * ============================================================================
 * 
 * Endpoints:
 * - GET  /api/admin/wiring-status/:companyId    - Full wiring report
 * - GET  /api/admin/wiring-status/:companyId/health - Quick health check
 * - POST /api/admin/wiring-status/:companyId/clear-cache - Clear scenario cache
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const { buildWiringReport } = require('../../services/wiring/wiringReportBuilder');
const { scanGuardrails } = require('../../services/wiring/guardrailScanner');
const Company = require('../../models/v2Company');
const logger = require('../../utils/logger');
const { authenticateJWT } = require('../../middleware/auth');

// All wiring routes require authentication (admin dashboard)
router.use(authenticateJWT);

// ============================================================================
// GET /api/admin/wiring-status/:companyId
// Full wiring report with all checks
// ============================================================================
router.get('/:companyId', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { companyId } = req.params;
        const { 
            format = 'json',
            includeGuardrails = '1',
            includeInfrastructure = '1'
        } = req.query;
        
        logger.info('[WIRING API] Full report requested', { companyId });
        
        // Load company
        const companyDoc = await Company.findById(companyId).lean();
        if (!companyDoc) {
            return res.status(404).json({
                error: 'Company not found',
                companyId
            });
        }
        
        // Build report
        const report = await buildWiringReport({
            companyId,
            companyDoc,
            environment: process.env.NODE_ENV || 'production',
            runtimeVersion: process.env.GIT_SHA || process.env.RENDER_GIT_COMMIT?.substring(0, 8) || null,
            effectiveConfigVersion: companyDoc.effectiveConfigVersion || null,
            includeInfrastructure: includeInfrastructure === '1'
        });
        
        // Optionally scan guardrails (slower)
        if (includeGuardrails === '1') {
            const repoRoot = process.cwd();
            report.guardrailScan = scanGuardrails({ repoRoot, companyDoc });
            
            // Update health if guardrail violations found
            const violations = report.guardrailScan.filter(g => g.status === 'VIOLATION');
            if (violations.length > 0 && report.health !== 'RED') {
                report.health = 'RED';
                report.guardrailViolations = violations.length;
            }
        }
        
        report.apiLatencyMs = Date.now() - startTime;
        
        // Format response
        if (format === 'md' || format === 'markdown') {
            const md = wiringReportToMarkdown(report);
            res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="wiring-report-${companyId}.md"`);
            return res.status(200).send(md);
        }
        
        // JSON (default)
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.json(report);
        
    } catch (error) {
        logger.error('[WIRING API] Error building report', { error: error.message, stack: error.stack });
        return res.status(500).json({
            error: 'Failed to build wiring report',
            details: error.message
        });
    }
});

// ============================================================================
// GET /api/admin/wiring-status/:companyId/health
// Quick health check (faster, less detail)
// ============================================================================
router.get('/:companyId/health', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        const companyDoc = await Company.findById(companyId)
            .select('companyName businessName aiAgentSettings.templateReferences effectiveConfigVersion')
            .lean();
        
        if (!companyDoc) {
            return res.status(404).json({
                health: 'RED',
                error: 'Company not found'
            });
        }
        
        // Quick checks
        const checks = {
            companyExists: true,
            templateReferencesLinked: (companyDoc.aiAgentSettings?.templateReferences || []).filter(r => r.enabled !== false).length > 0
        };
        
        // Redis check
        try {
            const { getSharedRedisClient, isRedisConfigured } = require('../../services/redisClientFactory');
            if (!isRedisConfigured()) {
                checks.redisError = 'REDIS_URL not configured';
            } else {
                const redis = await getSharedRedisClient();
                if (redis) {
                    const cached = await redis.get(`scenario-pool:${companyId}`);
                    checks.redisCached = !!cached;
                    if (cached) {
                        const parsed = JSON.parse(cached);
                        checks.cachedScenarioCount = parsed.scenarios?.length || 0;
                    }
                } else {
                    checks.redisError = 'Redis client not available';
                }
            }
        } catch (e) {
            checks.redisError = e.message;
        }
        
        // Determine health
        let health = 'GREEN';
        const issues = [];
        
        if (!checks.templateReferencesLinked) {
            health = 'RED';
            issues.push('No templates linked');
        }
        
        if (checks.cachedScenarioCount === 0 && checks.templateReferencesLinked) {
            health = health === 'RED' ? 'RED' : 'YELLOW';
            issues.push('Templates linked but cache shows 0 scenarios');
        }
        
        return res.json({
            health,
            companyId,
            companyName: companyDoc.companyName || companyDoc.businessName,
            checks,
            issues,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        logger.error('[WIRING API] Health check error', { error: error.message });
        return res.status(500).json({
            health: 'RED',
            error: error.message
        });
    }
});

// ============================================================================
// POST /api/admin/wiring-status/:companyId/clear-cache
// Clear scenario pool cache for debugging
// ============================================================================
router.post('/:companyId/clear-cache', async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;
    
    logger.info('[WIRING API] 🗑️ CHECKPOINT: Cache clear requested', { companyId });
    console.log('[WIRING API] 🗑️ CHECKPOINT: Cache clear requested for companyId:', companyId);
    
    try {
        // CHECKPOINT 1: Get redis client factory
        console.log('[WIRING API] CHECKPOINT 1: Loading redisClientFactory...');
        const { getSharedRedisClient, isRedisConfigured } = require('../../services/redisClientFactory');
        
        // CHECKPOINT 2: Check if Redis is configured
        console.log('[WIRING API] CHECKPOINT 2: Checking Redis config...');
        if (!isRedisConfigured()) {
            console.error('[WIRING API] ❌ CHECKPOINT 2 FAILED: Redis not configured');
            return res.status(503).json({
                success: false,
                error: 'Redis not configured (REDIS_URL not set)',
                checkpoint: 'REDIS_CONFIG_CHECK'
            });
        }
        console.log('[WIRING API] ✅ CHECKPOINT 2: Redis is configured');
        
        // CHECKPOINT 3: Get shared client
        console.log('[WIRING API] CHECKPOINT 3: Getting shared Redis client...');
        const redis = await getSharedRedisClient();
        
        if (!redis) {
            console.error('[WIRING API] ❌ CHECKPOINT 3 FAILED: Could not get Redis client');
            return res.status(503).json({
                success: false,
                error: 'Redis client not available (connection failed)',
                checkpoint: 'REDIS_CLIENT_GET'
            });
        }
        console.log('[WIRING API] ✅ CHECKPOINT 3: Redis client obtained');
        
        // CHECKPOINT 4: Build cache key and check existence
        const cacheKey = `scenario-pool:${companyId}`;
        console.log('[WIRING API] CHECKPOINT 4: Checking cache key existence:', cacheKey);
        const existed = await redis.exists(cacheKey);
        console.log('[WIRING API] ✅ CHECKPOINT 4: Cache key existed:', existed === 1);
        
        // CHECKPOINT 5: Delete cache
        console.log('[WIRING API] CHECKPOINT 5: Deleting cache key...');
        await redis.del(cacheKey);
        console.log('[WIRING API] ✅ CHECKPOINT 5: Cache key deleted');
        
        const durationMs = Date.now() - startTime;
        
        logger.info('[WIRING API] ✅ Cache cleared successfully', { 
            companyId, 
            wasPresent: existed === 1,
            durationMs 
        });
        
        return res.json({
            success: true,
            cacheKey,
            wasPresent: existed === 1,
            message: existed ? 'Cache cleared - next request will reload from MongoDB' : 'Cache was already empty',
            durationMs,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        const durationMs = Date.now() - startTime;
        console.error('[WIRING API] ❌ Cache clear FAILED:', error.message);
        console.error('[WIRING API] Stack:', error.stack);
        logger.error('[WIRING API] Cache clear error', { 
            companyId,
            error: error.message, 
            stack: error.stack,
            durationMs 
        });
        return res.status(500).json({
            success: false,
            error: error.message,
            stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined,
            durationMs
        });
    }
});

// ============================================================================
// HELPERS
// ============================================================================

function wiringReportToMarkdown(r) {
    const lines = [];
    
    lines.push(`# Wiring Report: ${r.companyName || r.companyId}`);
    lines.push('');
    lines.push(`**Health:** ${r.health}`);
    lines.push(`**Generated:** ${r.generatedAt}`);
    lines.push(`**Environment:** ${r.environment}`);
    lines.push(`**Company ID:** ${r.companyId}`);
    lines.push(`**Trade:** ${r.tradeKey}`);
    lines.push(`**Effective Config Version:** ${r.effectiveConfigVersion || 'n/a'}`);
    lines.push('');
    
    // Scoreboard
    lines.push('## Scoreboard');
    lines.push('');
    lines.push(`| Metric | Tabs | Sections |`);
    lines.push(`|--------|------|----------|`);
    lines.push(`| Total | ${r.counts?.tabs?.total || 0} | ${r.counts?.sections?.total || 0} |`);
    lines.push(`| Wired | ${r.counts?.tabs?.wired || 0} | ${r.counts?.sections?.wired || 0} |`);
    lines.push(`| Partial | ${r.counts?.tabs?.partial || 0} | ${r.counts?.sections?.partial || 0} |`);
    lines.push(`| Misconfigured | ${r.counts?.tabs?.misconfigured || 0} | ${r.counts?.sections?.misconfigured || 0} |`);
    lines.push('');
    
    // Special Checks
    lines.push('## Special Checks');
    lines.push('');
    
    if (r.specialChecks?.templateReferences) {
        const tr = r.specialChecks.templateReferences;
        lines.push(`### Template References`);
        lines.push(`- **Status:** ${tr.status}`);
        lines.push(`- **Enabled:** ${tr.enabledRefs}`);
        lines.push(`- **Message:** ${tr.message}`);
        lines.push('');
    }
    
    if (r.specialChecks?.scenarioPool) {
        const sp = r.specialChecks.scenarioPool;
        lines.push(`### Scenario Pool`);
        lines.push(`- **Status:** ${sp.status}`);
        lines.push(`- **Scenarios:** ${sp.scenarioCount}`);
        lines.push(`- **Enabled:** ${sp.enabledCount}`);
        lines.push('');
    }
    
    if (r.specialChecks?.redisCache) {
        const rc = r.specialChecks.redisCache;
        lines.push(`### Redis Cache`);
        lines.push(`- **Status:** ${rc.status}`);
        lines.push(`- **Message:** ${rc.message || 'n/a'}`);
        lines.push('');
    }
    
    // Issues
    lines.push('## Issues');
    lines.push('');
    
    if (!r.issues || r.issues.length === 0) {
        lines.push('✅ No issues detected');
    } else {
        for (const issue of r.issues.slice(0, 20)) {
            lines.push(`### ${issue.severity}: ${issue.label}`);
            lines.push(`- **Node:** ${issue.nodeId}`);
            lines.push(`- **Status:** ${issue.status}`);
            lines.push(`- **Reasons:** ${(issue.reasons || []).join(', ')}`);
            if (issue.fix) lines.push(`- **Fix:** ${issue.fix}`);
            lines.push('');
        }
    }
    
    // Guardrails
    if (r.guardrailScan) {
        lines.push('## Guardrail Scan');
        lines.push('');
        
        const violations = r.guardrailScan.filter(g => g.status !== 'PASS');
        const passes = r.guardrailScan.filter(g => g.status === 'PASS');
        
        if (violations.length > 0) {
            lines.push('### ⚠️ Violations');
            for (const v of violations) {
                lines.push(`- **${v.ruleId}** (${v.severity}): ${v.details}`);
                if (v.file) lines.push(`  - File: ${v.file}:${v.line}`);
            }
            lines.push('');
        }
        
        lines.push('### ✅ Passed');
        for (const p of passes) {
            lines.push(`- ${p.ruleId}`);
        }
    }
    
    return lines.join('\n');
}

// ============================================================================
// GET /api/admin/wiring-status/:companyId/v2
// Full V2 wiring report with complete source-of-truth data
// ============================================================================
router.get('/:companyId/v2', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { format = 'json' } = req.query;
        
        logger.info('[WIRING API V2] Full report requested', { companyId, format });
        
        const { generateWiringReport, reportToMarkdown } = require('../../services/wiring/wiringReportGenerator.v2');
        
        const report = await generateWiringReport({
            companyId,
            tradeKey: req.query.tradeKey || 'universal',
            environment: process.env.NODE_ENV || 'production'
        });
        
        // Format response
        if (format === 'md' || format === 'markdown') {
            const md = reportToMarkdown(report);
            res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="wiring-report-v2-${companyId}.md"`);
            return res.status(200).send(md);
        }
        
        // JSON (default)
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.json(report);
        
    } catch (error) {
        logger.error('[WIRING API V2] Error', { error: error.message, stack: error.stack });
        return res.status(500).json({
            error: 'Failed to generate V2 wiring report',
            details: error.message
        });
    }
});

// ============================================================================
// POST /api/admin/wiring-status/validate
// Validate pasted JSON against wiring registry
// ============================================================================
router.post('/validate', async (req, res) => {
    try {
        const { json } = req.body;
        
        if (!json) {
            return res.status(400).json({ error: 'JSON payload required' });
        }
        
        logger.info('[WIRING API] Validate JSON requested');
        
        const { wiringRegistryV2, getAllFields, VALIDATORS } = require('../../services/wiring/wiringRegistry.v2');
        
        let parsed;
        try {
            parsed = typeof json === 'string' ? JSON.parse(json) : json;
        } catch (e) {
            return res.status(400).json({ error: 'Invalid JSON', details: e.message });
        }
        
        // Run validators
        const results = {
            valid: true,
            errors: [],
            warnings: [],
            fieldCount: 0
        };
        
        const allFields = getAllFields();
        
        for (const field of allFields) {
            const dbPath = field.db?.path;
            if (!dbPath) continue;
            
            // Get value from parsed JSON
            const parts = dbPath.split('.');
            let val = parsed;
            for (const p of parts) {
                if (val == null) break;
                val = val[p];
            }
            
            results.fieldCount++;
            
            // Run validators
            if (field.validators) {
                for (const validator of field.validators) {
                    if (typeof validator.fn === 'function' && !validator.fn(val)) {
                        if (field.required || field.critical) {
                            results.valid = false;
                            results.errors.push({
                                fieldId: field.id,
                                label: field.label,
                                message: validator.message || 'Validation failed',
                                path: dbPath,
                                value: val
                            });
                        } else {
                            results.warnings.push({
                                fieldId: field.id,
                                label: field.label,
                                message: validator.message || 'Validation failed',
                                path: dbPath
                            });
                        }
                    }
                }
            }
        }
        
        return res.json(results);
        
    } catch (error) {
        logger.error('[WIRING API] Validate error', { error: error.message });
        return res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// GET /api/admin/wiring-status/:companyId/quick-diagnostics
// Quick diagnostics using V2 wiring generator (standalone, no snapshot)
// ============================================================================
router.get('/:companyId/quick-diagnostics', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        logger.info('[WIRING API] Quick diagnostics requested', { companyId });
        
        // Tenant safety: validate companyId format
        if (!companyId || companyId.length < 10) {
            return res.status(400).json({ error: 'Invalid companyId' });
        }
        
        const { getQuickDiagnostics } = require('../../services/wiring/WiringDiagnosticService');
        
        const diagnostics = await getQuickDiagnostics(companyId);
        
        // Tenant safety: ensure response only contains this company's data
        diagnostics._tenantVerified = diagnostics.companyId === companyId;
        
        return res.json(diagnostics);
        
    } catch (error) {
        logger.error('[WIRING API] Quick diagnostics error', { error: error.message });
        return res.status(500).json({
            error: 'Failed to generate diagnostics',
            details: error.message
        });
    }
});

// ============================================================================
// POST /api/admin/wiring-status/:companyId/diagnose
// Evidence-based diagnosis from debugSnapshot (Test Agent integration)
// 
// THIS IS THE "TRUTH MACHINE" ENDPOINT:
// - Takes actual debugSnapshot from test response
// - Runs deterministic Failure→Node mapping
// - Returns exact evidence + exact fixes
// ============================================================================
router.post('/:companyId/diagnose', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { debugSnapshot } = req.body;
        
        logger.info('[WIRING API] Evidence-based diagnosis requested', { companyId });
        
        // Tenant safety: validate companyId
        if (!companyId || companyId.length < 10) {
            return res.status(400).json({ error: 'Invalid companyId' });
        }
        
        if (!debugSnapshot) {
            return res.status(400).json({ 
                error: 'debugSnapshot required in body',
                hint: 'Pass the debug object from test response'
            });
        }
        
        const { diagnoseFromSnapshot } = require('../../services/wiring/WiringDiagnosticService');
        
        const diagnosis = diagnoseFromSnapshot(debugSnapshot, companyId);
        
        // Tenant safety: verify we're returning data for the right company
        diagnosis._tenantVerified = diagnosis.companyId === companyId;
        
        return res.json(diagnosis);
        
    } catch (error) {
        logger.error('[WIRING API] Diagnosis error', { error: error.message, stack: error.stack });
        return res.status(500).json({
            error: 'Failed to diagnose',
            details: error.message
        });
    }
});

// ============================================================================
// POST /api/admin/wiring-status/:companyId/apply
// APPLY A WIRING FIX - One-click from Next Actions
// 
// THIS IS THE "BUILD SYSTEM" ENDPOINT:
// - Takes a patch from the tier system
// - Validates tenant safety (company-scoped only)
// - Rejects any global template/scenario writes
// - Applies to companiesCollection
// ============================================================================
router.post('/:companyId/apply', async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;
    
    logger.info('[WIRING API] 🔧 Apply fix requested', { companyId });
    console.log('[WIRING API] 🔧 CHECKPOINT 1: Apply fix request received', { companyId });
    
    try {
        const { patch, reason, fieldId } = req.body;
        
        // VALIDATION 1: Required fields
        if (!patch) {
            console.error('[WIRING API] ❌ CHECKPOINT 2 FAILED: Missing patch');
            return res.status(400).json({
                success: false,
                error: 'patch is required',
                hint: 'Send { patch: { "$set": { "path": value } }, reason: "...", fieldId: "..." }'
            });
        }
        console.log('[WIRING API] ✅ CHECKPOINT 2: Patch object present');
        
        // VALIDATION 2: Patch must have $set
        if (!patch.$set || typeof patch.$set !== 'object') {
            console.error('[WIRING API] ❌ CHECKPOINT 3 FAILED: Invalid patch structure');
            return res.status(400).json({
                success: false,
                error: 'patch must contain $set object',
                received: Object.keys(patch)
            });
        }
        console.log('[WIRING API] ✅ CHECKPOINT 3: Valid $set structure');
        
        const pathsToUpdate = Object.keys(patch.$set);
        console.log('[WIRING API] CHECKPOINT 4: Paths to update:', pathsToUpdate);
        
        // =========================================================
        // TENANT SAFETY - NON-NEGOTIABLE RULES
        // =========================================================
        
        // ALLOWED prefixes (company-scoped data only)
        const ALLOWED_PREFIXES = [
            'aiAgentSettings.',
            'transfers.',
            'dataConfig.',
            'dynamicFlow.companyFlows'
        ];
        
        // FORBIDDEN patterns (global templates/scenarios)
        const FORBIDDEN_PATTERNS = [
            /globalinstantresponsetemplate/i,
            /templates\./,
            /scenarios\./,
            /categories\[/,
            /categories\./,
            /\.scenarios\[/,
            /template(?!References)/i  // "template" but not "templateReferences"
        ];
        
        // Special case: aiAgentSettings.templateReferences is allowed
        const ALLOWED_EXCEPTIONS = [
            'aiAgentSettings.templateReferences'
        ];
        
        const violations = [];
        
        for (const path of pathsToUpdate) {
            // Check if path is explicitly allowed exception
            const isException = ALLOWED_EXCEPTIONS.some(ex => path.startsWith(ex));
            if (isException) continue;
            
            // Check if path has allowed prefix
            const hasAllowedPrefix = ALLOWED_PREFIXES.some(prefix => path.startsWith(prefix));
            if (!hasAllowedPrefix) {
                violations.push({
                    path,
                    reason: 'Path does not start with allowed prefix',
                    allowed: ALLOWED_PREFIXES
                });
                continue;
            }
            
            // Check for forbidden patterns
            for (const pattern of FORBIDDEN_PATTERNS) {
                if (pattern.test(path)) {
                    violations.push({
                        path,
                        reason: `Path matches forbidden pattern: ${pattern}`,
                        rule: 'No writes to global templates/scenarios'
                    });
                    break;
                }
            }
        }
        
        if (violations.length > 0) {
            console.error('[WIRING API] ❌ CHECKPOINT 5 FAILED: Tenant safety violation', violations);
            return res.status(403).json({
                success: false,
                error: 'TENANT_SAFETY_VIOLATION',
                message: 'Patch contains paths that would modify global templates or scenarios',
                violations,
                hint: 'Only company-scoped settings under aiAgentSettings, transfers, dataConfig can be modified'
            });
        }
        console.log('[WIRING API] ✅ CHECKPOINT 5: Tenant safety passed');
        
        // VALIDATION 3: Company must exist
        const { ObjectId } = require('mongoose').Types;
        if (!ObjectId.isValid(companyId)) {
            console.error('[WIRING API] ❌ Invalid companyId format');
            return res.status(400).json({
                success: false,
                error: 'Invalid companyId format'
            });
        }
        
        const companyDoc = await Company.findById(companyId);
        if (!companyDoc) {
            console.error('[WIRING API] ❌ CHECKPOINT 6 FAILED: Company not found');
            return res.status(404).json({
                success: false,
                error: 'Company not found',
                companyId
            });
        }
        console.log('[WIRING API] ✅ CHECKPOINT 6: Company found:', companyDoc.companyName);
        
        // =========================================================
        // APPLY THE UPDATE
        // =========================================================
        console.log('[WIRING API] CHECKPOINT 7: Applying update...');
        
        const updateResult = await Company.updateOne(
            { _id: new ObjectId(companyId) },
            patch
        );
        
        console.log('[WIRING API] ✅ CHECKPOINT 8: Update result:', updateResult);
        
        // Clear Redis cache for this company
        try {
            const { getSharedRedisClient, isRedisConfigured } = require('../../services/redisClientFactory');
            if (isRedisConfigured()) {
                const redis = await getSharedRedisClient();
                if (redis) {
                    await redis.del(`scenario-pool:${companyId}`);
                    await redis.del(`company:${companyId}`);
                    console.log('[WIRING API] ✅ Redis cache cleared for company');
                }
            }
        } catch (cacheErr) {
            console.warn('[WIRING API] Cache clear warning:', cacheErr.message);
        }
        
        const durationMs = Date.now() - startTime;
        
        logger.info('[WIRING API] ✅ Fix applied successfully', { 
            companyId, 
            fieldId,
            paths: pathsToUpdate,
            modifiedCount: updateResult.modifiedCount,
            durationMs 
        });
        
        return res.json({
            success: true,
            companyId,
            fieldId,
            reason: reason || 'wiring_fix',
            appliedPaths: pathsToUpdate,
            modifiedCount: updateResult.modifiedCount,
            durationMs,
            timestamp: new Date().toISOString(),
            hint: 'Refresh wiring report to see updated tier scores'
        });
        
    } catch (error) {
        const durationMs = Date.now() - startTime;
        console.error('[WIRING API] ❌ Apply fix FAILED:', error.message);
        console.error('[WIRING API] Stack:', error.stack);
        logger.error('[WIRING API] Apply fix error', { 
            companyId,
            error: error.message, 
            stack: error.stack,
            durationMs 
        });
        return res.status(500).json({
            success: false,
            error: error.message,
            durationMs
        });
    }
});

// ============================================================================
// POST /api/admin/wiring-status/:companyId/patch-json
// Generate PATCH JSON for actionable fixes
// Input: debugSnapshot or issues array
// Output: PATCH JSON that can be pasted for instant fix instructions
// ============================================================================
router.post('/:companyId/patch-json', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { debugSnapshot, issues } = req.body;
        
        logger.info('[WIRING API] PATCH JSON generation requested', { companyId });
        
        const { diagnoseFromSnapshot, generatePatchJson, extractEvidence } = require('../../services/wiring/WiringDiagnosticService');
        
        let patchJson;
        
        if (debugSnapshot) {
            // Full diagnosis from snapshot
            const diagnosis = diagnoseFromSnapshot(debugSnapshot, companyId);
            patchJson = diagnosis.patchJson;
        } else if (issues) {
            // Generate from existing issues
            const evidence = { effectiveConfigVersion: 'from-issues' };
            patchJson = generatePatchJson(issues, evidence, companyId);
        } else {
            return res.status(400).json({ 
                error: 'Either debugSnapshot or issues required' 
            });
        }
        
        return res.json(patchJson);
        
    } catch (error) {
        logger.error('[WIRING API] PATCH JSON error', { error: error.message });
        return res.status(500).json({
            error: 'Failed to generate PATCH JSON',
            details: error.message
        });
    }
});

module.exports = router;

