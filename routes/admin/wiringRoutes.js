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
    
    if (r.specialChecks?.serviceTypeResolution) {
        const str = r.specialChecks.serviceTypeResolution;
        lines.push(`### Service Type Resolution`);
        lines.push(`- **Status:** ${str.status}`);
        lines.push(`- **Health:** ${str.health}`);
        if (str.summary) {
            lines.push(`- **Resolver Enabled:** ${str.summary.resolverEnabled}`);
            lines.push(`- **Calendar Integrated:** ${str.summary.calendarIntegrated}`);
            lines.push(`- **Mapped Types:** ${str.summary.mappedTypes?.join(', ') || 'none'}`);
            lines.push(`- **Clarification Enabled:** ${str.summary.clarificationEnabled}`);
        }
        if (str.checks?.calendarMappings?.missingCanonical?.length > 0) {
            lines.push(`- **Missing Mappings:** ${str.checks.calendarMappings.missingCanonical.join(', ')}`);
        }
        if (str.checks?.runtimePath) {
            lines.push(`- **Runtime Path Verified:** ${str.checks.runtimePath.pathVerified ? '✅ Yes' : '❌ No'}`);
        }
        if (str.issues?.length > 0) {
            lines.push(`- **Issues:**`);
            str.issues.forEach(i => lines.push(`  - [${i.severity}] ${i.message}`));
        }
        lines.push(`- **Message:** ${str.message || 'n/a'}`);
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
        // V92 FIX: For deeply nested paths, find the deepest existing parent
        // and set the nested structure from there. This avoids Mongoose strict
        // mode silently dropping updates when intermediate paths don't exist.
        // Note: pathParts already defined above for beforeValue extraction
        let effectivePath = dbPath;
        let effectiveValue = valueToApply;
        
        // Find the deepest existing path
        const docObj = companyDoc.toObject();
        let deepestExistingIdx = 0;
        let currentObj = docObj;
        
        for (let i = 0; i < pathParts.length - 1; i++) {
            if (currentObj && typeof currentObj === 'object' && pathParts[i] in currentObj) {
                currentObj = currentObj[pathParts[i]];
                deepestExistingIdx = i + 1;
            } else {
                break;
            }
        }
        
        // If not all parent paths exist, build nested structure from deepest existing
        if (deepestExistingIdx < pathParts.length - 1) {
            console.log('[WIRING APPLY] V92: Parent path missing, building nested structure', {
                fullPath: dbPath,
                deepestExistingIdx,
                deepestExisting: pathParts.slice(0, deepestExistingIdx).join('.') || '(root)',
                missingFrom: pathParts.slice(deepestExistingIdx).join('.')
            });
            
            // Build nested object from the missing parts
            // e.g., if "a.b" exists but target is "a.b.c.d.e = value", build:
            //   effectivePath = "a.b.c"
            //   effectiveValue = { d: { e: value } }
            const missingParts = pathParts.slice(deepestExistingIdx);
            // missingParts = ['c', 'd', 'e'] where 'e' is the final key
            
            // Start with the value at the deepest level
            let nestedValue = valueToApply;
            
            // Wrap from second-to-last up to second (index 1), leaving first for the path
            // e.g., ['c', 'd', 'e'] -> wrap 'e' in 'd': {d: {e: value}}, skip 'c' for path
            for (let i = missingParts.length - 1; i >= 1; i--) {
                nestedValue = { [missingParts[i]]: nestedValue };
            }
            
            // effectivePath = existing path + first missing part
            if (deepestExistingIdx > 0) {
                effectivePath = pathParts.slice(0, deepestExistingIdx).join('.') + '.' + missingParts[0];
            } else {
                effectivePath = missingParts[0];
            }
            effectiveValue = nestedValue;
            
            console.log('[WIRING APPLY] V92: Adjusted update path', {
                originalPath: dbPath,
                effectivePath,
                effectiveValuePreview: JSON.stringify(effectiveValue).substring(0, 200)
            });
        }
        
        const patch = {
            $set: {
                [effectivePath]: effectiveValue
            }
        };
        
        console.log('[WIRING APPLY] CHECKPOINT 8: Server-generated patch', { 
            dbPath,
            effectivePath,
            valueType: typeof effectiveValue,
            pathWasAdjusted: effectivePath !== dbPath
        });
        
        // =========================================================
        // APPLY UPDATE
        // =========================================================
        // V92 FIX: Use native MongoDB collection to bypass Mongoose strict mode
        // Mongoose strict mode silently drops updates for deeply nested paths
        // even when the schema defines them, if parent objects don't exist.
        const mongoose = require('mongoose');
        const updateResult = await mongoose.connection.collection('companiesCollection').updateOne(
            { _id: new ObjectId(companyId) },
            patch
        );
        
        console.log('[WIRING APPLY] ✅ CHECKPOINT 9: Update result:', updateResult);

        // =========================================================
        // AFTER-WRITE VERIFICATION (NO MORE SILENT "APPLIED")
        // =========================================================
        // Mongoose strict mode can drop unknown paths during update ops, which yields modifiedCount=0.
        // Also, if the value was already identical, modifiedCount can be 0 even though it's "applied".
        const deepEqual = (a, b) => {
            try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; }
        };
        const getPath = (obj, path) => {
            if (!obj || !path) return undefined;
            const parts = String(path).split('.');
            let cur = obj;
            for (const p of parts) {
                if (cur == null) return undefined;
                cur = cur[p];
            }
            return cur;
        };
        const afterDoc = await Company.findById(companyId).lean();
        const afterValue = getPath(afterDoc, dbPath);
        const alreadyApplied = deepEqual(beforeValue, valueToApply) || deepEqual(afterValue, valueToApply);
        
        // V92 DEBUG: Trace resumeBooking specifically
        if (fieldId.includes('resumeBooking')) {
            console.log('[WIRING APPLY DEBUG] resumeBooking verification:', {
                fieldId,
                dbPath,
                beforeValue: beforeValue ? JSON.stringify(beforeValue).substring(0, 100) : 'null',
                afterValue: afterValue ? JSON.stringify(afterValue).substring(0, 100) : 'null',
                valueToApply: JSON.stringify(valueToApply).substring(0, 100),
                alreadyApplied,
                modifiedCount: updateResult.modifiedCount
            });
        }

        if (!alreadyApplied && updateResult.modifiedCount === 0) {
            console.error('[WIRING APPLY] ❌ CHECKPOINT 9b: No changes applied (likely strict schema dropped path)', {
                companyId,
                fieldId,
                dbPath
            });
            return res.status(409).json({
                success: false,
                error: 'NO_CHANGES_APPLIED',
                message: 'Apply did not persist any changes. This usually means the dbPath is not schema-backed (strict mode dropped it), or the write was blocked.',
                companyId,
                fieldId,
                dbPath,
                modifiedCount: updateResult.modifiedCount,
                matchedCount: updateResult.matchedCount,
                hint: 'Click Inspect to view dbPath and current value. If dbPath is wrong, Wiring registry must be updated.'
            });
        }
        
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
            verification: {
                alreadyApplied,
                afterValue
            },
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
// POST /api/admin/wiring-status/:companyId/bind-template
// TEMPLATE BINDING - The single activation switch for scenario content
// This is PREREQUISITE #0 - without proper binding, the engine has nothing
// ============================================================================
router.post('/:companyId/bind-template', async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;
    const { templateId, templateName, priority = 1, enabled = true } = req.body;
    
    logger.info('[WIRING API] 🔗 Bind template requested', { companyId, templateId });
    
    try {
        // Validate company exists
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ 
                success: false, 
                error: 'Company not found',
                companyId 
            });
        }
        
        // If no templateId provided, find the first available template
        let targetTemplateId = templateId;
        let resolvedTemplateName = templateName;
        
        if (!targetTemplateId) {
            const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
            const availableTemplate = await GlobalInstantResponseTemplate.findOne({
                $or: [
                    { status: 'published' },
                    { isPublished: true },
                    { isActive: true }
                ]
            }).select('_id name').lean();
            
            if (!availableTemplate) {
                return res.status(404).json({
                    success: false,
                    error: 'NO_TEMPLATES_AVAILABLE',
                    message: 'No global templates exist in the system - create templates first'
                });
            }
            
            targetTemplateId = availableTemplate._id.toString();
            resolvedTemplateName = availableTemplate.name;
        }
        
        // Validate template exists
        const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
        const template = await GlobalInstantResponseTemplate.findById(targetTemplateId).select('_id name').lean();
        if (!template) {
            return res.status(404).json({
                success: false,
                error: 'TEMPLATE_NOT_FOUND',
                message: `Template ${targetTemplateId} does not exist`,
                templateId: targetTemplateId
            });
        }
        
        resolvedTemplateName = resolvedTemplateName || template.name;
        
        // Check if already bound
        const existingRefs = company.aiAgentSettings?.templateReferences || [];
        const alreadyBound = existingRefs.some(ref => 
            ref.templateId?.toString() === targetTemplateId
        );
        
        if (alreadyBound) {
            return res.json({
                success: true,
                status: 'ALREADY_BOUND',
                message: `Template "${resolvedTemplateName}" is already bound to this company`,
                companyId,
                templateId: targetTemplateId,
                templateName: resolvedTemplateName
            });
        }
        
        // Build the new reference
        const newRef = {
            templateId: targetTemplateId,
            templateName: resolvedTemplateName,
            enabled: enabled,
            priority: priority,
            addedAt: new Date(),
            addedBy: req.user?.email || req.user?.name || 'wiring-api'
        };
        
        // Add to templateReferences
        await Company.updateOne(
            { _id: companyId },
            { 
                $push: { 
                    'aiAgentSettings.templateReferences': newRef 
                }
            }
        );
        
        // 🎛️ AUTO-CREATE SERVICE SWITCHBOARD
        // When a company binds to a template, automatically create their Service Switchboard
        // This gives them the full menu of services (all OFF by default)
        // Company admin then explicitly enables the services they offer
        let switchboardCreated = false;
        try {
            const ServiceSwitchboard = require('../../models/ServiceSwitchboard');
            const switchboard = await ServiceSwitchboard.getOrCreateForCompany(
                companyId,
                targetTemplateId,
                company.name || 'Unknown Company',
                resolvedTemplateName
            );
            
            if (switchboard && switchboard.services.length > 0) {
                switchboardCreated = true;
                logger.info('[WIRING API] 🎛️ Service Switchboard created', {
                    companyId,
                    templateId: targetTemplateId,
                    serviceCount: switchboard.services.length,
                    allDisabled: switchboard.services.every(s => !s.enabled)
                });
            }
        } catch (switchboardErr) {
            // Non-fatal - binding still works, switchboard can be created later
            logger.warn('[WIRING API] ⚠️ Service Switchboard creation warning:', switchboardErr.message);
        }
        
        // Clear Redis cache to force pool rebuild
        try {
            const { getSharedRedisClient, isRedisConfigured } = require('../../services/redisClientFactory');
            if (isRedisConfigured()) {
                const redis = await getSharedRedisClient();
                if (redis) {
                    await redis.del(`scenario-pool:${companyId}`);
                    await redis.del(`company:${companyId}`);
                    logger.info('[WIRING API] ✅ Cache cleared for pool rebuild');
                }
            }
        } catch (cacheErr) {
            logger.warn('[WIRING API] Cache clear warning:', cacheErr.message);
        }
        
        // Verify the binding worked by checking pool
        const ScenarioPoolService = require('../../services/ScenarioPoolService');
        const poolResult = await ScenarioPoolService.getScenarioPoolForCompany(companyId, { bypassCache: true });
        
        const durationMs = Date.now() - startTime;
        
        logger.info('[WIRING API] ✅ Template bound successfully', { 
            companyId, 
            templateId: targetTemplateId,
            poolScenarioCount: poolResult.scenarios?.length || 0,
            durationMs 
        });
        
        return res.json({
            success: true,
            status: 'BOUND',
            message: `Template "${resolvedTemplateName}" bound successfully`,
            companyId,
            templateId: targetTemplateId,
            templateName: resolvedTemplateName,
            binding: newRef,
            verification: {
                poolScenarioCount: poolResult.scenarios?.length || 0,
                templatesUsed: poolResult.templatesUsed?.length || 0
            },
            serviceSwitchboard: {
                created: switchboardCreated,
                note: switchboardCreated 
                    ? 'Service Switchboard created with all services OFF - admin must enable services'
                    : 'Switchboard will be created when admin opens Blueprint Builder'
            },
            durationMs,
            nextSteps: [
                'Run /audit to verify scenarios are now visible',
                'Run /wiring-status to confirm TEMPLATE_BINDING_MISSING is resolved',
                switchboardCreated 
                    ? 'Open Service Switchboard in Blueprint Builder to enable services'
                    : 'Service Switchboard will auto-create on first access',
                'Make a test call to generate runtime proof'
            ]
        });
        
    } catch (error) {
        logger.error('[WIRING API] Bind template error', { error: error.message, stack: error.stack });
        return res.status(500).json({
            success: false,
            error: error.message,
            durationMs: Date.now() - startTime
        });
    }
});

// ============================================================================
// DELETE /api/admin/wiring-status/:companyId/unbind-template/:templateId
// Remove a template binding
// ============================================================================
router.delete('/:companyId/unbind-template/:templateId', async (req, res) => {
    const { companyId, templateId } = req.params;
    
    logger.info('[WIRING API] 🔗 Unbind template requested', { companyId, templateId });
    
    try {
        const result = await Company.updateOne(
            { _id: companyId },
            { 
                $pull: { 
                    'aiAgentSettings.templateReferences': { 
                        templateId: templateId 
                    }
                }
            }
        );
        
        // Clear cache
        try {
            const { getSharedRedisClient, isRedisConfigured } = require('../../services/redisClientFactory');
            if (isRedisConfigured()) {
                const redis = await getSharedRedisClient();
                if (redis) {
                    await redis.del(`scenario-pool:${companyId}`);
                }
            }
        } catch (e) { /* ignore */ }
        
        return res.json({
            success: true,
            status: 'UNBOUND',
            message: `Template ${templateId} unbound`,
            modifiedCount: result.modifiedCount
        });
        
    } catch (error) {
        logger.error('[WIRING API] Unbind template error', { error: error.message });
        return res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// GET /api/admin/wiring-status/:companyId/template-binding
// Get current template binding status
// ============================================================================
router.get('/:companyId/template-binding', async (req, res) => {
    const { companyId } = req.params;
    
    try {
        const company = await Company.findById(companyId)
            .select('companyName aiAgentSettings.templateReferences configuration.clonedFrom')
            .lean();
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        const templateRefs = company.aiAgentSettings?.templateReferences || [];
        const enabledRefs = templateRefs.filter(r => r.templateId && r.enabled !== false);
        
        // Get pool count for verification
        const ScenarioPoolService = require('../../services/ScenarioPoolService');
        const poolResult = await ScenarioPoolService.getScenarioPoolForCompany(companyId);
        
        return res.json({
            companyId,
            companyName: company.companyName,
            binding: {
                method: enabledRefs.length > 0 ? 'templateReferences' : 
                        company.configuration?.clonedFrom ? 'legacy_clonedFrom' : 'NONE',
                totalRefs: templateRefs.length,
                enabledRefs: enabledRefs.length,
                references: templateRefs
            },
            legacyClonedFrom: company.configuration?.clonedFrom || null,
            verification: {
                poolScenarioCount: poolResult.scenarios?.length || 0,
                templatesUsed: poolResult.templatesUsed || []
            },
            status: enabledRefs.length > 0 ? 'BOUND' : 
                    company.configuration?.clonedFrom ? 'LEGACY_BINDING' : 'UNBOUND'
        });
        
    } catch (error) {
        logger.error('[WIRING API] Get template binding error', { error: error.message });
        return res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// POST /api/admin/wiring-status/:companyId/fix-template-references
// Quick fix for NO_TEMPLATE_REFERENCES critical issue (legacy endpoint)
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
// POST /api/admin/wiring-status/:companyId/fix-spelling-variants
// V61: Quick fix for spelling variant configuration
// Enables: slot-level confirmSpelling + global nameSpellingVariants.enabled
// ============================================================================
router.post('/:companyId/fix-spelling-variants', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        logger.info('[WIRING API] Fix Spelling Variants requested', { companyId });
        
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Ensure structure exists
        if (!company.aiAgentSettings) {
            company.aiAgentSettings = {};
        }
        if (!company.aiAgentSettings.frontDeskBehavior) {
            company.aiAgentSettings.frontDeskBehavior = {};
        }
        
        const frontDesk = company.aiAgentSettings.frontDeskBehavior;
        const bookingSlots = frontDesk.bookingSlots || [];
        const currentSpellingConfig = frontDesk.nameSpellingVariants || {};
        
        // Check current state
        const nameSlotIndex = bookingSlots.findIndex(s => 
            s.type === 'name' || s.id === 'name' || s.slotId === 'name'
        );
        const nameSlot = nameSlotIndex >= 0 ? bookingSlots[nameSlotIndex] : null;
        
        const hasConfirmSpelling = nameSlot?.confirmSpelling === true;
        const hasGlobalEnabled = currentSpellingConfig.enabled === true;
        
        logger.info('[WIRING API] Current spelling config:', {
            nameSlotFound: !!nameSlot,
            nameSlotIndex,
            hasConfirmSpelling,
            hasGlobalEnabled
        });
        
        // Already configured correctly?
        if (hasConfirmSpelling && hasGlobalEnabled) {
            return res.json({
                status: 'ALREADY_CONFIGURED',
                message: 'Spelling variants already correctly configured',
                slotLevel: hasConfirmSpelling,
                globalLevel: hasGlobalEnabled
            });
        }
        
        const changes = [];
        
        // Track what needs to change
        if (nameSlot && !hasConfirmSpelling) {
            changes.push('Set confirmSpelling: true on name slot');
        }
        if (!hasGlobalEnabled) {
            changes.push('Set nameSpellingVariants.enabled: true with variant groups');
        }
        
        if (changes.length === 0) {
            return res.json({
                status: 'NO_CHANGES_NEEDED',
                message: 'No changes were needed'
            });
        }
        
        // V61 FIX: Use targeted $set update to bypass full document validation
        // This avoids triggering validation errors on unrelated fields (like cheatSheet.transferRules)
        const updateOps = {};
        
        if (nameSlot && !hasConfirmSpelling && nameSlotIndex >= 0) {
            updateOps[`aiAgentSettings.frontDeskBehavior.bookingSlots.${nameSlotIndex}.confirmSpelling`] = true;
        }
        
        if (!hasGlobalEnabled) {
            updateOps['aiAgentSettings.frontDeskBehavior.nameSpellingVariants'] = {
                enabled: true,
                source: 'auto_scan',
                checkMode: '1_char_only',
                maxAsksPerCall: 1,
                variantGroups: [
                    { base: 'Mark', variants: ['Marc'] },
                    { base: 'Brian', variants: ['Bryan', 'Bryon'] },
                    { base: 'Eric', variants: ['Erik'] },
                    { base: 'Steven', variants: ['Stephen'] },
                    { base: 'Sara', variants: ['Sarah'] },
                    { base: 'John', variants: ['Jon'] },
                    { base: 'Kristina', variants: ['Christina'] },
                    { base: 'Catherine', variants: ['Katherine', 'Kathryn'] },
                    { base: 'Philip', variants: ['Phillip'] },
                    { base: 'Jeffrey', variants: ['Geoffrey'] },
                    { base: 'Allan', variants: ['Alan', 'Allen'] },
                    { base: 'Anne', variants: ['Ann'] }
                ]
            };
        }
        
        await Company.updateOne(
            { _id: companyId },
            { $set: updateOps }
        );
        
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
        
        logger.info('[WIRING API] ✅ Spelling variants fixed successfully', { changes });
        
        return res.json({
            status: 'FIXED',
            message: 'Spelling variant configuration fixed',
            changes,
            action: 'Test by saying a name like "Mark" - AI should ask "Is that Mark with a K or Marc with a C?"'
        });
        
    } catch (error) {
        logger.error('[WIRING API] Fix Spelling Variants error', { error: error.message, stack: error.stack });
        return res.status(500).json({
            error: 'Failed to fix spelling variants',
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

// ============================================================================
// GET /api/admin/wiring-status/:companyId/scenario-coverage
// Analyze scenario coverage and identify gaps
// ============================================================================
router.get('/:companyId/scenario-coverage', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { daysBack } = req.query;
        
        logger.info('[WIRING API] Scenario coverage analysis requested', { companyId });
        
        const ScenarioCoverageAnalyzer = require('../../services/ScenarioCoverageAnalyzer');
        
        const report = await ScenarioCoverageAnalyzer.analyzeCoverage(companyId, {
            daysBack: daysBack ? parseInt(daysBack) : 7
        });
        
        return res.json(report);
        
    } catch (error) {
        logger.error('[WIRING API] Scenario coverage analysis error', { 
            error: error.message, 
            stack: error.stack 
        });
        return res.status(500).json({
            error: 'Failed to analyze scenario coverage',
            details: error.message
        });
    }
});

// ============================================================================
// GET /api/admin/wiring-status/:companyId/scenario-alignment
// SINGLE SOURCE OF TRUTH - Scenario Pool Alignment Data
// 
// Returns complete alignment showing what Gap Fill, Audit, and Agent see.
// This is the source of truth that ensures all three systems work in harmony.
// ============================================================================
router.get('/:companyId/scenario-alignment', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        logger.info('[WIRING API] 📊 Scenario alignment data requested', { companyId });
        
        const ScenarioPoolService = require('../../services/ScenarioPoolService');
        
        const alignmentData = await ScenarioPoolService.getScenarioAlignmentData(companyId);
        
        if (!alignmentData.success) {
            return res.status(404).json({
                success: false,
                error: alignmentData.error || 'Failed to compute alignment',
                companyId
            });
        }
        
        // Add recommendation for wiring tab
        alignmentData.wiringRecommendation = {
            shouldShowInWiring: true,
            category: 'SCENARIO_ALIGNMENT',
            displayName: 'Scenario Pool Alignment',
            description: 'Ensures Gap Fill, Audit, and LLM Agent all work from the same scenario pool',
            icon: 'fa-sync-alt',
            statusIndicator: alignmentData.alignment?.summary?.status || 'UNKNOWN'
        };
        
        logger.info('[WIRING API] ✅ Scenario alignment computed', { 
            companyId,
            agentCanSee: alignmentData.alignment?.agentCanSee,
            isAligned: alignmentData.alignment?.isAligned,
            computeTimeMs: alignmentData.computeTimeMs
        });
        
        return res.json(alignmentData);
        
    } catch (error) {
        logger.error('[WIRING API] Scenario alignment error', { 
            error: error.message, 
            stack: error.stack 
        });
        return res.status(500).json({
            success: false,
            error: 'Failed to compute scenario alignment',
            details: error.message
        });
    }
});

// ============================================================================
// GET /api/admin/wiring-status/:companyId/unified-health
// Combined health check including scenario alignment
// Returns all health indicators for the wiring tab scoreboard
// ============================================================================
router.get('/:companyId/unified-health', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { companyId } = req.params;
        
        logger.info('[WIRING API] 📊 Unified health check requested', { companyId });
        
        // Load company first
        const companyDoc = await Company.findById(companyId)
            .select('companyName businessName aiAgentSettings.templateReferences')
            .lean();
        
        if (!companyDoc) {
            return res.status(404).json({
                health: 'RED',
                error: 'Company not found'
            });
        }
        
        // Run all health checks in parallel
        const ScenarioPoolService = require('../../services/ScenarioPoolService');
        const { getSettingsCount } = require('../../services/scenarioAudit/constants');
        
        const [alignmentData, settingsCounts] = await Promise.all([
            ScenarioPoolService.getScenarioAlignmentData(companyId),
            Promise.resolve(getSettingsCount())
        ]);
        
        // Build unified health response
        const result = {
            companyId,
            companyName: companyDoc.companyName || companyDoc.businessName,
            computedAt: new Date().toISOString(),
            computeTimeMs: Date.now() - startTime,
            
            // Overall health
            health: 'GREEN',
            issues: [],
            
            // Scenario alignment (Gap Fill + Audit + Agent harmony)
            scenarioAlignment: alignmentData.success ? {
                status: alignmentData.alignment?.summary?.status || 'UNKNOWN',
                label: alignmentData.alignment?.summary?.label || 'Unknown',
                message: alignmentData.alignment?.summary?.message || '',
                metrics: {
                    totalInTemplates: alignmentData.alignment?.totalInTemplates || 0,
                    activeInTemplates: alignmentData.alignment?.activeInTemplates || 0,
                    agentCanSee: alignmentData.alignment?.agentCanSee || 0,
                    gapFillScope: alignmentData.alignment?.gapFillScope || 0,
                    auditScope: alignmentData.alignment?.auditScope || 0,
                    disabledByCompany: alignmentData.alignment?.disabledByCompany || 0,
                    alignmentPercentage: alignmentData.alignment?.alignmentPercentage || 0
                },
                isAligned: alignmentData.alignment?.isAligned || false
            } : {
                status: 'RED',
                label: 'ERROR',
                message: alignmentData.error || 'Failed to compute alignment',
                isAligned: false
            },
            
            // Settings registry alignment (from constants.js)
            settingsRegistry: {
                total: settingsCounts.total,
                audited: settingsCounts.audited,
                gapGenerated: settingsCounts.gapGenerated,
                agentUsed: settingsCounts.agentUsed,
                aligned: settingsCounts.aligned,
                gaps: settingsCounts.gaps,
                runtime: {
                    autoGenerated: settingsCounts.runtimeAuto,
                    manualConfig: settingsCounts.runtimeManual
                },
                coverage: {
                    audit: settingsCounts.audited > 0 ? Math.round((settingsCounts.audited / settingsCounts.agentUsed) * 100) : 0,
                    gap: settingsCounts.gapGenerated > 0 ? Math.round((settingsCounts.gapGenerated / settingsCounts.agentUsed) * 100) : 0,
                    agent: 100 // Agent is the baseline
                }
            },
            
            // Template health
            templateHealth: {
                hasTemplates: (companyDoc.aiAgentSettings?.templateReferences || []).length > 0,
                enabledCount: (companyDoc.aiAgentSettings?.templateReferences || []).filter(r => r.enabled !== false).length
            }
        };
        
        // Determine overall health
        if (!result.templateHealth.hasTemplates) {
            result.health = 'RED';
            result.issues.push('No templates configured');
        }
        
        if (result.scenarioAlignment.status === 'RED') {
            result.health = 'RED';
            result.issues.push('Scenario alignment issue: ' + result.scenarioAlignment.message);
        } else if (result.scenarioAlignment.status === 'YELLOW') {
            if (result.health !== 'RED') result.health = 'YELLOW';
            result.issues.push('Scenario alignment warning: ' + result.scenarioAlignment.message);
        }
        
        if (result.settingsRegistry.gaps.length > 0) {
            if (result.health !== 'RED') result.health = 'YELLOW';
            result.issues.push(`${result.settingsRegistry.gaps.length} settings registry alignment gaps`);
        }
        
        logger.info('[WIRING API] ✅ Unified health computed', { 
            companyId,
            health: result.health,
            issueCount: result.issues.length,
            computeTimeMs: result.computeTimeMs
        });
        
        return res.json(result);
        
    } catch (error) {
        logger.error('[WIRING API] Unified health error', { 
            error: error.message, 
            stack: error.stack 
        });
        return res.status(500).json({
            health: 'RED',
            error: 'Failed to compute unified health',
            details: error.message
        });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/admin/wiring-status/:companyId/runtime-proof
// One-click runtime proof - show evidence of runtime-owned field decisions
// ════════════════════════════════════════════════════════════════════════════════
router.get('/:companyId/runtime-proof', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { hours = 24 } = req.query;
        const { getRuntimeFields, getContentFields, getAdminFields } = require('../../services/scenarioAudit/constants');
        const BlackBoxRecording = require('../../models/BlackBoxRecording');
        
        logger.info('[WIRING API] Runtime proof requested', { companyId, hours });
        
        const since = new Date(Date.now() - parseInt(hours) * 60 * 60 * 1000);
        const runtimeFields = getRuntimeFields();
        
        // Query BlackBox for execution events
        const events = await BlackBoxRecording.find({
            companyId,
            type: { $in: ['RESPONSE_EXECUTION', 'BOOKING_DECISION', 'HANDOFF_DECISION', 'FOLLOW_UP_DECISION'] },
            createdAt: { $gte: since }
        })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();
        
        // Build proof summary
        const proof = {
            companyId,
            timeWindow: `${hours} hours`,
            queriedAt: new Date().toISOString(),
            eventCount: events.length,
            runtimeFields: runtimeFields.length,
            decisions: [],
            fieldSummary: {}
        };
        
        // Initialize field summary
        for (const field of runtimeFields) {
            proof.fieldSummary[field] = {
                seen: false,
                count: 0,
                lastSeenAt: null,
                values: new Set()
            };
        }
        
        // Analyze events
        for (const event of events) {
            const decision = {
                eventId: event._id.toString(),
                type: event.type,
                createdAt: event.createdAt,
                callId: event.callId,
                runtimeDecisions: {}
            };
            
            const data = event.data || {};
            
            // Extract runtime field values from event data
            for (const field of runtimeFields) {
                const value = data[field] ?? data.runtimeDecisions?.[field] ?? data.execution?.[field];
                if (value !== undefined) {
                    decision.runtimeDecisions[field] = value;
                    proof.fieldSummary[field].seen = true;
                    proof.fieldSummary[field].count++;
                    proof.fieldSummary[field].values.add(String(value));
                    if (!proof.fieldSummary[field].lastSeenAt) {
                        proof.fieldSummary[field].lastSeenAt = event.createdAt;
                    }
                }
            }
            
            if (Object.keys(decision.runtimeDecisions).length > 0) {
                proof.decisions.push(decision);
            }
        }
        
        // Convert Sets to Arrays for JSON
        for (const field of runtimeFields) {
            proof.fieldSummary[field].values = Array.from(proof.fieldSummary[field].values);
        }
        
        // Calculate status
        const provenCount = Object.values(proof.fieldSummary).filter(f => f.seen).length;
        proof.status = provenCount === runtimeFields.length ? 'FULLY_PROVEN' : 
                       provenCount > 0 ? 'PARTIALLY_PROVEN' : 'UNPROVEN';
        proof.health = proof.status === 'FULLY_PROVEN' ? 'GREEN' : 
                       proof.status === 'PARTIALLY_PROVEN' ? 'YELLOW' : 'GRAY';
        proof.summary = {
            provenFields: provenCount,
            totalFields: runtimeFields.length,
            percentage: Math.round((provenCount / runtimeFields.length) * 100)
        };
        
        // Ownership model for context
        proof.ownershipModel = {
            content: { count: getContentFields().length, description: 'WHAT to say (Scenario defines)' },
            runtime: { count: runtimeFields.length, description: 'HOW/WHEN (Runtime decides)' },
            admin: { count: getAdminFields().length, description: 'Policies (Admin configures)' }
        };
        
        res.json(proof);
        
    } catch (error) {
        logger.error('[WIRING API] Runtime proof error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/admin/wiring-status/:companyId/trace/:traceId
// One-click trace - show full BlackBox event for a specific trace ID
// ════════════════════════════════════════════════════════════════════════════════
router.get('/:companyId/trace/:traceId', async (req, res) => {
    try {
        const { companyId, traceId } = req.params;
        const BlackBoxRecording = require('../../models/BlackBoxRecording');
        
        logger.info('[WIRING API] Trace lookup requested', { companyId, traceId });
        
        const event = await BlackBoxRecording.findById(traceId).lean();
        
        if (!event) {
            return res.status(404).json({ error: 'Trace not found', traceId });
        }
        
        if (event.companyId !== companyId) {
            return res.status(403).json({ error: 'Trace does not belong to this company' });
        }
        
        res.json({
            success: true,
            trace: {
                id: event._id.toString(),
                type: event.type,
                callId: event.callId,
                createdAt: event.createdAt,
                data: event.data
            }
        });
        
    } catch (error) {
        logger.error('[WIRING API] Trace lookup error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// POST /api/admin/wiring-status/seed-test-company
// DEV ONLY: Create a test company with scenarios, templates, and blackbox events
// This enables end-to-end wiring verification in local/dev environments
// ════════════════════════════════════════════════════════════════════════════════
router.post('/seed-test-company', async (req, res) => {
    // SAFETY: Only allow in development
    if (process.env.NODE_ENV === 'production' && !req.query.force) {
        return res.status(403).json({
            error: 'SEED_BLOCKED',
            message: 'Seeding is blocked in production. Use ?force=true to override (dangerous).'
        });
    }
    
    const startTime = Date.now();
    
    try {
        logger.info('[WIRING SEED] 🌱 Starting test company seed');
        
        const mongoose = require('mongoose');
        const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
        const BlackBoxRecording = require('../../models/BlackBoxRecording');
        
        // ════════════════════════════════════════════════════════════════════
        // 1. Create or update test company
        // ════════════════════════════════════════════════════════════════════
        const testCompanyData = {
            companyName: 'Wiring Test Company (Dev)',
            businessName: 'Dev Test HVAC',
            industry: 'hvac',
            isTestCompany: true,
            aiAgentSettings: {
                enabled: true,
                discoveryMode: 'balanced',
                templateReferences: [],
                frontDeskBehavior: {
                    bookingSlots: [
                        { id: 'name', type: 'name', question: 'May I have your name please?', required: true },
                        { id: 'phone', type: 'phone', question: 'And your phone number?', required: true },
                        { id: 'address', type: 'address', question: 'What is the service address?', required: true },
                        { id: 'issue', type: 'issue', question: 'Can you describe the issue?', required: true }
                    ],
                    greetingResponses: [
                        'Hi, thanks for calling {companyName}. How can I help you today?'
                    ],
                    nameSpellingVariants: {
                        enabled: true,
                        variantGroups: [
                            { base: 'Mark', variants: ['Marc'] },
                            { base: 'Brian', variants: ['Bryan'] }
                        ]
                    }
                },
                serviceTypeClarification: {
                    enabled: true,
                    clarifyPhrases: ['Are you calling about a repair, maintenance, or something else?']
                }
            },
            googleCalendar: {
                enabled: true,
                eventColors: {
                    colorMapping: [
                        { label: 'Repair Service', canonicalType: 'repair', colorId: '11', schedule: { days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], startTime: '08:00', endTime: '17:00', slotDuration: 60 } },
                        { label: 'Maintenance', canonicalType: 'maintenance', colorId: '2', schedule: { days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], startTime: '09:00', endTime: '16:00', slotDuration: 90 } },
                        { label: 'Emergency', canonicalType: 'emergency', colorId: '4', schedule: { days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], startTime: '00:00', endTime: '23:59', slotDuration: 60 } },
                        { label: 'Estimate', canonicalType: 'estimate', colorId: '3', schedule: { days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], startTime: '10:00', endTime: '15:00', slotDuration: 120 } }
                    ]
                }
            }
        };
        
        let testCompany = await Company.findOne({ companyName: 'Wiring Test Company (Dev)' });
        if (testCompany) {
            await Company.updateOne({ _id: testCompany._id }, { $set: testCompanyData });
            testCompany = await Company.findById(testCompany._id);
            logger.info('[WIRING SEED] Updated existing test company');
        } else {
            testCompany = await Company.create(testCompanyData);
            logger.info('[WIRING SEED] Created new test company');
        }
        
        const companyId = testCompany._id.toString();
        
        // ════════════════════════════════════════════════════════════════════
        // 2. Create or update global template with scenarios
        // ════════════════════════════════════════════════════════════════════
        // Generate unique IDs for scenarios
        const generateId = () => new mongoose.Types.ObjectId().toString();
        
        const testScenarios = [
            {
                scenarioId: generateId(),
                name: 'AC Not Cooling',
                status: 'live',
                isActive: true,
                category: 'TROUBLESHOOT',
                scenarioType: 'TROUBLESHOOT',
                priority: 5,
                minConfidence: 0.6,
                behavior: 'calm_professional',
                bookingIntent: true,
                triggers: ['ac not cooling', 'air not cold', 'no cold air', 'ac broken'],
                quickReplies: ['I understand. Is the unit running but not cooling, or not turning on at all?'],
                fullReplies: ['Thanks, {name}. We can have a technician out to take a look. Would morning or afternoon work better?'],
                entityCapture: ['name', 'phone', 'address', 'issue']
            },
            {
                scenarioId: generateId(),
                name: 'Schedule Maintenance',
                status: 'live',
                isActive: true,
                category: 'BOOKING',
                scenarioType: 'BOOKING',
                priority: 3,
                minConfidence: 0.7,
                behavior: 'calm_professional',
                bookingIntent: true,
                triggers: ['schedule maintenance', 'tune up', 'annual service', 'preventive maintenance'],
                quickReplies: ['Great! When were you hoping to have the maintenance done?'],
                fullReplies: ['Perfect, {name}. I can get you scheduled for maintenance. Do you prefer morning or afternoon?'],
                entityCapture: ['name', 'phone', 'address']
            },
            {
                scenarioId: generateId(),
                name: 'Emergency No Heat',
                status: 'live',
                isActive: true,
                category: 'EMERGENCY',
                scenarioType: 'EMERGENCY',
                priority: 10,
                minConfidence: 0.5,
                behavior: 'empathetic_professional',
                bookingIntent: true,
                triggers: ['no heat', 'heater not working', 'furnace broken', 'emergency heat'],
                quickReplies: ['I understand this is urgent. Is there anyone vulnerable in the home - elderly, children, or pets?'],
                fullReplies: ['We treat no-heat situations as emergencies. Let me get a technician dispatched to you right away, {name}.'],
                entityCapture: ['name', 'phone', 'address', 'issue', 'urgency']
            },
            {
                scenarioId: generateId(),
                name: 'Request Estimate',
                status: 'live',
                isActive: true,
                category: 'ESTIMATE',
                scenarioType: 'ESTIMATE',
                priority: 2,
                minConfidence: 0.6,
                behavior: 'calm_professional',
                bookingIntent: true,
                triggers: ['estimate', 'quote', 'how much', 'pricing', 'cost'],
                quickReplies: ['I can help with that. What type of estimate are you looking for?'],
                fullReplies: ['Sure thing, {name}. I can schedule a technician to come out and provide a free estimate. What day works best?'],
                entityCapture: ['name', 'phone', 'address', 'estimateType']
            },
            {
                scenarioId: generateId(),
                name: 'Business Hours',
                status: 'live',
                isActive: true,
                category: 'FAQ',
                scenarioType: 'FAQ',
                priority: 0,
                minConfidence: 0.7,
                behavior: 'calm_professional',
                bookingIntent: false,
                triggers: ['what are your hours', 'when are you open', 'business hours', 'hours of operation'],
                quickReplies: ['We are open Monday through Friday, 8 AM to 5 PM. Is there anything else I can help you with?'],
                fullReplies: [],
                entityCapture: []
            },
            {
                scenarioId: generateId(),
                name: 'Thank You / Goodbye',
                status: 'live',
                isActive: true,
                category: 'SMALL_TALK',
                scenarioType: 'SMALL_TALK',
                priority: -5,
                minConfidence: 0.8,
                behavior: 'calm_professional',
                bookingIntent: false,
                triggers: ['thank you', 'thanks', 'goodbye', 'bye', 'have a good day'],
                quickReplies: ["You're welcome! Have a great day and don't hesitate to call if you need anything else."],
                fullReplies: [],
                entityCapture: []
            }
        ];
        
        const testCategory = {
            id: 'wiring-test-category',
            name: 'All Scenarios',
            description: 'Test scenarios for wiring verification',
            icon: '🔧',
            scope: 'GLOBAL',
            scenarios: testScenarios
        };
        
        let template = await GlobalInstantResponseTemplate.findOne({ name: 'Wiring Test Template (Dev)' });
        if (template) {
            template.categories = [testCategory];
            template.version = template.version || '1.0';
            await template.save();
            logger.info('[WIRING SEED] Updated existing test template');
        } else {
            template = await GlobalInstantResponseTemplate.create({
                version: '1.0',
                name: 'Wiring Test Template (Dev)',
                description: 'Test template for wiring verification',
                tradeType: 'hvac',
                industry: 'hvac',
                status: 'published',
                isActive: true,
                isPublished: true,
                categories: [testCategory]
            });
            logger.info('[WIRING SEED] Created new test template');
        }
        
        // Link template to company
        await Company.updateOne(
            { _id: testCompany._id },
            { 
                $set: { 
                    'aiAgentSettings.templateReferences': [{
                        templateId: template._id,
                        templateName: template.name,
                        enabled: true,
                        priority: 1,
                        addedAt: new Date(),
                        addedBy: 'wiring-seed'
                    }]
                }
            }
        );
        
        // ════════════════════════════════════════════════════════════════════
        // 3. Create fake BlackBox events (runtime proof)
        // ════════════════════════════════════════════════════════════════════
        const fakeEvents = [];
        const eventTypes = ['RESPONSE_EXECUTION', 'BOOKING_DECISION', 'MATCHING_PIPELINE', 'SERVICE_TYPE_RESOLUTION'];
        const canonicalTypes = ['repair', 'maintenance', 'emergency', 'estimate'];
        const actionTypes = ['REPLY_ONLY', 'BOOKING_FLOW', 'TRANSFER', 'ESCALATE'];
        
        for (let i = 0; i < 20; i++) {
            const eventType = eventTypes[i % eventTypes.length];
            const createdAt = new Date(Date.now() - Math.random() * 24 * 60 * 60 * 1000); // Random time in last 24h
            
            fakeEvents.push({
                companyId,
                callId: `test_call_${i}_${Date.now()}`,
                type: eventType,
                createdAt,
                data: {
                    scenarioId: testScenarios[i % testScenarios.length].name,
                    scenarioType: testScenarios[i % testScenarios.length].scenarioType,
                    confidence: 0.7 + Math.random() * 0.3,
                    matchMethod: i % 2 === 0 ? 'fast_exact' : 'semantic_embedding',
                    canonicalType: canonicalTypes[i % canonicalTypes.length],
                    actionType: actionTypes[i % actionTypes.length],
                    followUpMode: i % 3 === 0 ? 'ASK_IF_BOOK' : 'NONE',
                    handoffPolicy: i % 4 === 0 ? 'transfer_to_human' : 'low_confidence',
                    bookingDecision: i % 2 === 0 ? 'PROCEED' : 'SKIP',
                    runtimeDecisions: {
                        followUpMode: i % 3 === 0 ? 'ASK_IF_BOOK' : 'NONE',
                        actionType: actionTypes[i % actionTypes.length],
                        handoffPolicy: i % 4 === 0 ? 'transfer_to_human' : 'low_confidence'
                    }
                }
            });
        }
        
        // Clear old test events and insert new ones
        await BlackBoxRecording.deleteMany({ companyId, callId: /^test_call_/ });
        await BlackBoxRecording.insertMany(fakeEvents);
        logger.info('[WIRING SEED] Created fake BlackBox events:', fakeEvents.length);
        
        // ════════════════════════════════════════════════════════════════════
        // 4. Clear Redis cache for test company
        // ════════════════════════════════════════════════════════════════════
        try {
            const { getSharedRedisClient, isRedisConfigured } = require('../../services/redisClientFactory');
            if (isRedisConfigured()) {
                const redis = await getSharedRedisClient();
                if (redis) {
                    await redis.del(`scenario-pool:${companyId}`);
                    await redis.del(`company:${companyId}`);
                    logger.info('[WIRING SEED] Cleared Redis cache');
                }
            }
        } catch (cacheErr) {
            logger.warn('[WIRING SEED] Cache clear warning:', cacheErr.message);
        }
        
        const durationMs = Date.now() - startTime;
        
        logger.info('[WIRING SEED] ✅ Seed completed', { companyId, durationMs });
        
        return res.json({
            success: true,
            message: 'Test company seeded successfully',
            companyId,
            companyName: testCompany.companyName,
            templateId: template._id.toString(),
            templateName: template.name,
            scenarioCount: testScenarios.length,
            blackboxEventCount: fakeEvents.length,
            durationMs,
            nextSteps: [
                `Visit Wiring Tab with companyId: ${companyId}`,
                'Run audit to verify scenario alignment',
                'Check runtime proof for BlackBox events'
            ],
            apiUrls: {
                wiringReport: `/api/admin/wiring-status/${companyId}`,
                audit: `/api/admin/scenario-gaps/${companyId}/audit`,
                runtimeProof: `/api/admin/wiring-status/${companyId}/runtime-proof`
            }
        });
        
    } catch (error) {
        logger.error('[WIRING SEED] Error:', { error: error.message, stack: error.stack });
        return res.status(500).json({
            success: false,
            error: error.message,
            durationMs: Date.now() - startTime
        });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/admin/wiring-status/:companyId/last-call-trace
// Quick access to the most recent call's trace for this company
// ════════════════════════════════════════════════════════════════════════════════
router.get('/:companyId/last-call-trace', async (req, res) => {
    try {
        const { companyId } = req.params;
        const BlackBoxRecording = require('../../models/BlackBoxRecording');
        
        logger.info('[WIRING API] Last call trace requested', { companyId });
        
        // Find the most recent call for this company
        const lastEvent = await BlackBoxRecording.findOne({ companyId })
            .sort({ createdAt: -1 })
            .lean();
        
        if (!lastEvent) {
            return res.status(404).json({
                error: 'NO_CALLS_FOUND',
                message: 'No BlackBox recordings found for this company',
                companyId
            });
        }
        
        // Find all events for this call
        const callEvents = await BlackBoxRecording.find({ 
            companyId, 
            callId: lastEvent.callId 
        })
        .sort({ createdAt: 1 })
        .lean();
        
        // Extract key runtime decisions
        const runtimeDecisions = {};
        const eventTimeline = [];
        
        for (const event of callEvents) {
            eventTimeline.push({
                type: event.type,
                timestamp: event.createdAt,
                dataKeys: Object.keys(event.data || {})
            });
            
            if (event.data?.runtimeDecisions) {
                Object.assign(runtimeDecisions, event.data.runtimeDecisions);
            }
            if (event.data?.canonicalType) {
                runtimeDecisions.canonicalType = event.data.canonicalType;
            }
            if (event.data?.actionType) {
                runtimeDecisions.actionType = event.data.actionType;
            }
            if (event.data?.followUpMode) {
                runtimeDecisions.followUpMode = event.data.followUpMode;
            }
        }
        
        return res.json({
            success: true,
            companyId,
            callId: lastEvent.callId,
            callTimestamp: lastEvent.createdAt,
            eventCount: callEvents.length,
            runtimeDecisions,
            eventTimeline,
            fullEvents: callEvents.map(e => ({
                id: e._id.toString(),
                type: e.type,
                createdAt: e.createdAt,
                data: e.data
            }))
        });
        
    } catch (error) {
        logger.error('[WIRING API] Last call trace error', { error: error.message });
        return res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// GET /api/admin/wiring-status/scenario-settings
// Scenario Settings Catalog - Shows all 22+ settings and wiring status
// ============================================================================
router.get('/scenario-settings', async (req, res) => {
    try {
        const { 
            SCENARIO_SETTINGS_CATALOG, 
            getWiringSummary, 
            getUnwiredSettings 
        } = require('../../services/wiring/scenarioSettingsCatalog');
        
        const { view = 'summary' } = req.query;
        
        // Full catalog
        if (view === 'full') {
            return res.json({
                success: true,
                catalog: SCENARIO_SETTINGS_CATALOG,
                timestamp: new Date().toISOString()
            });
        }
        
        // Unwired settings (priority TODO)
        if (view === 'unwired') {
            const unwired = getUnwiredSettings();
            return res.json({
                success: true,
                ...unwired,
                timestamp: new Date().toISOString()
            });
        }
        
        // Summary (default)
        const summary = getWiringSummary();
        return res.json({
            success: true,
            ...summary,
            message: `${summary.counts.wired} settings wired, ${summary.counts.schemaOnly} schema-only (not wired)`,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        logger.error('[WIRING API] Scenario settings catalog error', { error: error.message });
        return res.status(500).json({ error: error.message });
    }
});

module.exports = router;

