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
// SECURE WIRING FIX - Registry-driven, server-generated patches only
// 
// ENTERPRISE DESIGN:
// - Client sends ONLY: { fieldId, mode: "recommended" | "custom", inputs?: {} }
// - Server looks up field in wiringTiers registry
// - Server generates the patch (client CANNOT inject arbitrary $set)
// - Server validates against schema
// - Server applies with audit trail
// 
// THIS PREVENTS: arbitrary MongoDB writes, cross-tenant bleed, schema violations
// ============================================================================
router.post('/:companyId/apply', async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;
    const requestId = `apply_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    logger.info('[WIRING APPLY] 🔧 Request received', { companyId, requestId });
    console.log('[WIRING APPLY] 🔧 CHECKPOINT 1: Request received', { companyId, requestId });
    
    try {
        const { fieldId, mode = 'recommended', inputs, reason } = req.body;
        
        // =========================================================
        // VALIDATION 1: fieldId is required
        // =========================================================
        if (!fieldId) {
            console.error('[WIRING APPLY] ❌ CHECKPOINT 2 FAILED: Missing fieldId');
            return res.status(400).json({
                success: false,
                error: 'fieldId is required',
                hint: 'Send { fieldId: "frontDesk.greetingResponses", mode: "recommended" }'
            });
        }
        console.log('[WIRING APPLY] ✅ CHECKPOINT 2: fieldId present:', fieldId);
        
        // =========================================================
        // VALIDATION 2: Lookup field in registry (wiringTiers)
        // =========================================================
        const { TIER_MVA, TIER_PRO, TIER_MAX } = require('../../services/wiring/wiringTiers');
        const ALL_TIERS = [TIER_MVA, TIER_PRO, TIER_MAX];
        
        let registeredField = null;
        let sourceTier = null;
        
        for (const tier of ALL_TIERS) {
            const found = tier.requirements.find(r => r.fieldId === fieldId);
            if (found) {
                registeredField = found;
                sourceTier = tier.id;
                break;
            }
        }
        
        if (!registeredField) {
            console.error('[WIRING APPLY] ❌ CHECKPOINT 3 FAILED: Field not in registry:', fieldId);
            return res.status(400).json({
                success: false,
                error: 'FIELD_NOT_REGISTERED',
                message: `Field "${fieldId}" is not in the wiring registry`,
                hint: 'Only registered tier requirements can be applied'
            });
        }
        console.log('[WIRING APPLY] ✅ CHECKPOINT 3: Field found in registry', { 
            fieldId, 
            tier: sourceTier, 
            hasDbPath: !!registeredField.dbPath,
            hasRecommendedValue: registeredField.recommendedValue !== undefined 
        });
        
        // =========================================================
        // VALIDATION 3: Field must have dbPath
        // =========================================================
        if (!registeredField.dbPath) {
            console.error('[WIRING APPLY] ❌ CHECKPOINT 4 FAILED: No dbPath for field:', fieldId);
            return res.status(400).json({
                success: false,
                error: 'NO_DB_PATH',
                message: `Field "${fieldId}" has no database path configured`,
                hint: 'This field cannot be auto-applied'
            });
        }
        
        // =========================================================
        // VALIDATION 4: Determine value to apply
        // =========================================================
        let valueToApply;
        
        if (mode === 'recommended') {
            if (registeredField.recommendedValue === undefined) {
                console.error('[WIRING APPLY] ❌ CHECKPOINT 5 FAILED: No recommendedValue for:', fieldId);
                return res.status(400).json({
                    success: false,
                    error: 'NO_RECOMMENDED_VALUE',
                    message: `Field "${fieldId}" has no recommended value`,
                    hint: 'Use mode: "custom" with inputs instead',
                    requiresUserInput: registeredField.requiresUserInput || false
                });
            }
            valueToApply = registeredField.recommendedValue;
        } else if (mode === 'custom') {
            if (!inputs || inputs.value === undefined) {
                return res.status(400).json({
                    success: false,
                    error: 'MISSING_INPUTS',
                    message: 'Custom mode requires inputs.value',
                    hint: 'Send { fieldId, mode: "custom", inputs: { value: ... } }'
                });
            }
            valueToApply = inputs.value;
        } else {
            return res.status(400).json({
                success: false,
                error: 'INVALID_MODE',
                message: `Mode must be "recommended" or "custom", got: ${mode}`
            });
        }
        
        console.log('[WIRING APPLY] ✅ CHECKPOINT 5: Value determined', { 
            mode, 
            valueType: typeof valueToApply,
            isArray: Array.isArray(valueToApply)
        });
        
        // =========================================================
        // VALIDATION 5: Company must exist
        // =========================================================
        const { ObjectId } = require('mongoose').Types;
        if (!ObjectId.isValid(companyId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid companyId format'
            });
        }
        
        const companyDoc = await Company.findById(companyId);
        if (!companyDoc) {
            console.error('[WIRING APPLY] ❌ CHECKPOINT 6 FAILED: Company not found');
            return res.status(404).json({
                success: false,
                error: 'Company not found',
                companyId
            });
        }
        console.log('[WIRING APPLY] ✅ CHECKPOINT 6: Company found:', companyDoc.companyName);
        
        // =========================================================
        // TENANT SAFETY: Verify dbPath is company-scoped
        // =========================================================
        const dbPath = registeredField.dbPath;
        const ALLOWED_PREFIXES = [
            'aiAgentSettings.',
            'transfers.',
            'dataConfig.',
            'dynamicFlow.'
        ];
        
        const isAllowedPath = ALLOWED_PREFIXES.some(prefix => dbPath.startsWith(prefix));
        if (!isAllowedPath) {
            console.error('[WIRING APPLY] ❌ TENANT SAFETY: Blocked path:', dbPath);
            return res.status(403).json({
                success: false,
                error: 'TENANT_SAFETY_VIOLATION',
                message: `Path "${dbPath}" is not in allowed scope`,
                allowed: ALLOWED_PREFIXES
            });
        }
        console.log('[WIRING APPLY] ✅ CHECKPOINT 7: Tenant safety passed');
        
        // =========================================================
        // GET BEFORE VALUE FOR AUDIT
        // =========================================================
        const pathParts = dbPath.split('.');
        let beforeValue = companyDoc.toObject();
        for (const part of pathParts) {
            if (beforeValue == null) break;
            beforeValue = beforeValue[part];
        }
        
        // =========================================================
        // SERVER-GENERATED PATCH (not from client!)
        // =========================================================
        const patch = {
            $set: {
                [dbPath]: valueToApply
            }
        };
        
        console.log('[WIRING APPLY] CHECKPOINT 8: Server-generated patch', { 
            dbPath, 
            valueType: typeof valueToApply 
        });
        
        // =========================================================
        // APPLY UPDATE
        // =========================================================
        const updateResult = await Company.updateOne(
            { _id: new ObjectId(companyId) },
            patch
        );
        
        console.log('[WIRING APPLY] ✅ CHECKPOINT 9: Update result:', updateResult);
        
        // =========================================================
        // WRITE AUDIT LOG
        // =========================================================
        try {
            const mongoose = require('mongoose');
            const auditCollection = mongoose.connection.collection('companyConfigAudit');
            await auditCollection.insertOne({
                requestId,
                companyId,
                companyName: companyDoc.companyName,
                userId: req.user?.id || req.user?._id || 'unknown',
                fieldId,
                dbPath,
                mode,
                beforeValue: beforeValue !== undefined ? beforeValue : null,
                afterValue: valueToApply,
                tier: sourceTier,
                reason: reason || 'wiring_apply',
                source: 'wiring_tab',
                timestamp: new Date(),
                success: updateResult.modifiedCount > 0
            });
            console.log('[WIRING APPLY] ✅ CHECKPOINT 10: Audit log written');
        } catch (auditErr) {
            console.warn('[WIRING APPLY] ⚠️ Audit log failed (non-blocking):', auditErr.message);
        }
        
        // =========================================================
        // CLEAR REDIS CACHE
        // =========================================================
        try {
            const { getSharedRedisClient, isRedisConfigured } = require('../../services/redisClientFactory');
            if (isRedisConfigured()) {
                const redis = await getSharedRedisClient();
                if (redis) {
                    await redis.del(`scenario-pool:${companyId}`);
                    await redis.del(`company:${companyId}`);
                    console.log('[WIRING APPLY] ✅ Redis cache cleared');
                }
            }
        } catch (cacheErr) {
            console.warn('[WIRING APPLY] Cache clear warning:', cacheErr.message);
        }
        
        const durationMs = Date.now() - startTime;
        
        logger.info('[WIRING APPLY] ✅ Fix applied successfully', { 
            companyId, 
            fieldId,
            dbPath,
            tier: sourceTier,
            mode,
            modifiedCount: updateResult.modifiedCount,
            durationMs,
            requestId
        });
        
        return res.json({
            success: true,
            requestId,
            companyId,
            fieldId,
            dbPath,
            tier: sourceTier,
            mode,
            modifiedCount: updateResult.modifiedCount,
            durationMs,
            timestamp: new Date().toISOString(),
            audit: {
                logged: true,
                beforeValue: beforeValue !== undefined ? '(captured)' : null,
                afterValue: '(applied)'
            },
            hint: 'Refresh wiring report to see updated tier scores'
        });
        
    } catch (error) {
        const durationMs = Date.now() - startTime;
        console.error('[WIRING APPLY] ❌ FAILED:', error.message);
        console.error('[WIRING APPLY] Stack:', error.stack);
        logger.error('[WIRING APPLY] Error', { 
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

// ============================================================================
// POST /api/admin/wiring-status/:companyId/fix-template-references
// Quick fix for NO_TEMPLATE_REFERENCES critical issue
// ============================================================================
router.post('/:companyId/fix-template-references', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { templateId } = req.body;
        
        logger.info('[WIRING API] Fix Template References requested', { companyId, templateId });
        
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Check current state
        const currentRefs = company.aiAgentSettings?.templateReferences || [];
        logger.info('[WIRING API] Current templateReferences:', { count: currentRefs.length, refs: currentRefs });
        
        // If templateId provided, use it. Otherwise try to find from legacy locations
        let targetTemplateId = templateId;
        let templateName = 'Unknown Template';
        
        if (!targetTemplateId) {
            // Try to find from legacy locations
            const legacyTemplates = company.configuration?.templates || 
                                   company.dataConfig?.templates || [];
            
            if (legacyTemplates.length > 0) {
                const first = legacyTemplates[0];
                targetTemplateId = first.templateId || first._id || first.id;
                templateName = first.name || first.templateName || 'Legacy Template';
                logger.info('[WIRING API] Found legacy template:', { targetTemplateId, templateName });
            }
        }
        
        // If still no template, try to load from Global AI Brain (get first HVAC template)
        if (!targetTemplateId) {
            const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
            const hvacTemplate = await GlobalInstantResponseTemplate.findOne({
                $or: [
                    { tradeType: 'hvac' },
                    { tradeType: 'HVAC' },
                    { industry: 'hvac' },
                    { name: /HVAC/i }
                ],
                status: 'published'
            }).lean();
            
            if (hvacTemplate) {
                targetTemplateId = hvacTemplate._id.toString();
                templateName = hvacTemplate.name;
                logger.info('[WIRING API] Found HVAC template from Global AI Brain:', { targetTemplateId, templateName });
            }
        }
        
        if (!targetTemplateId) {
            return res.status(400).json({
                error: 'No template found to link. Please provide templateId in request body.',
                hint: 'POST with body: { "templateId": "your-template-id" }'
            });
        }
        
        // Check if already linked
        const alreadyLinked = currentRefs.some(ref => 
            ref.templateId?.toString() === targetTemplateId.toString()
        );
        
        if (alreadyLinked) {
            return res.json({
                status: 'ALREADY_LINKED',
                message: 'Template is already linked',
                templateId: targetTemplateId,
                currentRefs: currentRefs.length
            });
        }
        
        // Add the template reference
        if (!company.aiAgentSettings) {
            company.aiAgentSettings = {};
        }
        if (!company.aiAgentSettings.templateReferences) {
            company.aiAgentSettings.templateReferences = [];
        }
        
        company.aiAgentSettings.templateReferences.push({
            templateId: targetTemplateId,
            templateName: templateName,
            enabled: true,
            priority: 1,
            addedAt: new Date(),
            addedBy: 'wiring-fix-endpoint'
        });
        
        company.markModified('aiAgentSettings.templateReferences');
        await company.save();
        
        // Clear Redis cache
        try {
            const { getSharedRedisClient, isRedisConfigured } = require('../../services/redisClientFactory');
            if (isRedisConfigured()) {
                const redis = await getSharedRedisClient();
                await redis.del(`company:${companyId}`);
                logger.info('[WIRING API] Redis cache cleared for company');
            }
        } catch (cacheErr) {
            logger.warn('[WIRING API] Could not clear Redis cache:', cacheErr.message);
        }
        
        logger.info('[WIRING API] ✅ Template reference added successfully');
        
        return res.json({
            status: 'FIXED',
            message: 'Template reference added successfully',
            templateId: targetTemplateId,
            templateName: templateName,
            newRefsCount: company.aiAgentSettings.templateReferences.length,
            action: 'Re-run Wiring diagnostic to verify critical issue is resolved'
        });
        
    } catch (error) {
        logger.error('[WIRING API] Fix Template References error', { error: error.message, stack: error.stack });
        return res.status(500).json({
            error: 'Failed to fix template references',
            details: error.message
        });
    }
});

// ============================================================================
// GET /api/admin/wiring-status/:companyId/compliance
// Code compliance check - detects hardcoded values that should come from config
// ============================================================================
router.get('/:companyId/compliance', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { companyId } = req.params;
        const { format = 'json' } = req.query;
        
        logger.info('[WIRING API] Compliance check requested', { companyId });
        
        // Run the compliance checker
        const { runComplianceCheck, formatAsMarkdown } = require('../../services/wiring/WiringComplianceChecker');
        const projectRoot = require('path').resolve(__dirname, '../..');
        
        const results = runComplianceCheck(projectRoot);
        results.companyId = companyId;
        results.durationMs = Date.now() - startTime;
        
        // Return in requested format
        if (format === 'md' || format === 'markdown') {
            res.setHeader('Content-Type', 'text/markdown');
            return res.send(formatAsMarkdown(results));
        }
        
        return res.json(results);
        
    } catch (error) {
        logger.error('[WIRING API] Compliance check error', { error: error.message, stack: error.stack });
        return res.status(500).json({
            error: 'Compliance check failed',
            details: error.message
        });
    }
});

module.exports = router;

