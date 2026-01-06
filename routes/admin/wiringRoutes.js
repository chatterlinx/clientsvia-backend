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
// Quick diagnostics for Test Agent integration
// ============================================================================
router.get('/:companyId/quick-diagnostics', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        logger.info('[WIRING API] Quick diagnostics requested', { companyId });
        
        const { getQuickDiagnostics } = require('../../services/wiring/WiringDiagnosticService');
        
        const diagnostics = await getQuickDiagnostics(companyId);
        
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
// POST /api/admin/wiring-status/:companyId/analyze-test
// Analyze a test result and return wiring-related explanations
// ============================================================================
router.post('/:companyId/analyze-test', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { testResult } = req.body;
        
        if (!testResult) {
            return res.status(400).json({ error: 'testResult required in body' });
        }
        
        logger.info('[WIRING API] Test analysis requested', { companyId });
        
        const { analyzeTestFailure } = require('../../services/wiring/WiringDiagnosticService');
        
        const analysis = await analyzeTestFailure(testResult, companyId);
        
        return res.json(analysis);
        
    } catch (error) {
        logger.error('[WIRING API] Test analysis error', { error: error.message });
        return res.status(500).json({
            error: 'Failed to analyze test',
            details: error.message
        });
    }
});

module.exports = router;

