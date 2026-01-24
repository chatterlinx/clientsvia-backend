/**
 * ════════════════════════════════════════════════════════════════════════════════
 * UNIFIED AUDIT ENGINE - Three Layers, One Registry
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * ARCHITECTURE:
 * - Content Audit: validates ownership=content fields in scenarios
 * - Runtime Audit: validates ownership=runtime fields via blackbox proof
 * - Admin Audit: validates ownership=admin fields in company config
 * 
 * ALL derived from SCENARIO_SETTINGS_REGISTRY. No separate lists.
 * 
 * SEVERITY ALGORITHM (same as Wiring):
 * - Any critical/high fail → RED
 * - Any warn fail → YELLOW
 * - Warnings only → YELLOW
 * - No runtime data → GRAY (unproven)
 * - All pass → GREEN
 * 
 * ════════════════════════════════════════════════════════════════════════════════
 */

const {
    SCENARIO_SETTINGS_REGISTRY,
    getContentFields,
    getRuntimeFields,
    getAdminFields,
    computeAuditStatus,
    ALL_BANNED_PHRASES,
    GENERIC_TRIGGERS,
    SCENARIO_TYPES,
    APPROVED_BEHAVIORS
} = require('./constants');

const BlackBoxRecording = require('../../models/BlackBoxRecording');
const Company = require('../../models/v2Company');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
const logger = require('../../utils/logger');

// ════════════════════════════════════════════════════════════════════════════════
// CONTENT AUDIT - Scenario-owned fields only
// ════════════════════════════════════════════════════════════════════════════════

async function runContentAudit(companyId, scenarios) {
    const contentFields = getContentFields();
    const checks = [];
    
    for (const scenario of scenarios) {
        if (scenario.status !== 'live' || scenario.isActive === false) continue;
        
        // Check each content field based on registry audit config
        for (const fieldName of contentFields) {
            const fieldConfig = SCENARIO_SETTINGS_REGISTRY[fieldName];
            if (!fieldConfig?.audit?.contentChecks) continue;
            
            const fieldValue = scenario[fieldName];
            const contentChecks = fieldConfig.audit.contentChecks;
            const severity = fieldConfig.audit.severity || 'info';
            
            for (const check of contentChecks) {
                const result = runContentCheck(check, fieldName, fieldValue, scenario);
                if (result) {
                    checks.push({
                        scenarioId: scenario.scenarioId,
                        scenarioName: scenario.name,
                        field: fieldName,
                        check,
                        status: result.status,
                        severity,
                        message: result.message
                    });
                }
            }
        }
    }
    
    return {
        layer: 'content',
        description: 'Scenario content validation (WHAT to say)',
        ...computeAuditStatus(checks),
        checks
    };
}

function runContentCheck(check, fieldName, value, scenario) {
    // Parse check syntax: "checkType:param1,param2"
    const [checkType, params] = check.includes(':') ? check.split(':') : [check, ''];
    const paramList = params ? params.split(',') : [];
    
    switch (checkType) {
        case 'required':
            if (value === undefined || value === null || value === '') {
                return { status: 'fail', message: `${fieldName} is required` };
            }
            if (Array.isArray(value) && value.length === 0) {
                return { status: 'fail', message: `${fieldName} is required (empty array)` };
            }
            return { status: 'pass', message: `${fieldName} present` };
            
        case 'array':
            if (value !== undefined && !Array.isArray(value)) {
                return { status: 'fail', message: `${fieldName} must be an array` };
            }
            return { status: 'pass', message: `${fieldName} is array` };
            
        case 'boolean':
            if (value !== undefined && typeof value !== 'boolean') {
                return { status: 'warn', message: `${fieldName} should be boolean` };
            }
            return { status: 'pass', message: `${fieldName} is boolean` };
            
        case 'number':
            if (value !== undefined && typeof value !== 'number') {
                return { status: 'warn', message: `${fieldName} should be number` };
            }
            return { status: 'pass', message: `${fieldName} is number` };
            
        case 'minLength':
            const minLen = parseInt(paramList[0]) || 1;
            const actualLen = Array.isArray(value) ? value.length : (value?.length || 0);
            if (actualLen < minLen) {
                return { status: 'warn', message: `${fieldName} has ${actualLen} items, need ${minLen}+` };
            }
            return { status: 'pass', message: `${fieldName} has ${actualLen} items (min: ${minLen})` };
            
        case 'maxLength':
            const maxLen = parseInt(paramList[0]) || 100;
            const len = Array.isArray(value) ? value.length : (value?.length || 0);
            if (len > maxLen) {
                return { status: 'warn', message: `${fieldName} has ${len} items, max is ${maxLen}` };
            }
            return { status: 'pass', message: `${fieldName} length ok` };
            
        case 'range':
            const [min, max] = paramList.map(p => parseFloat(p));
            if (typeof value === 'number' && (value < min || value > max)) {
                return { status: 'warn', message: `${fieldName} is ${value}, should be ${min}-${max}` };
            }
            return { status: 'pass', message: `${fieldName} in range` };
            
        case 'enum':
            const allowed = paramList;
            if (value && !allowed.includes(value)) {
                return { status: 'warn', message: `${fieldName} is "${value}", expected one of: ${allowed.join(', ')}` };
            }
            return { status: 'pass', message: `${fieldName} is valid enum` };
            
        case 'noBannedPhrases':
            if (Array.isArray(value)) {
                const banned = value.filter(v => 
                    ALL_BANNED_PHRASES.some(bp => v.toLowerCase().includes(bp.toLowerCase()))
                );
                if (banned.length > 0) {
                    return { status: 'fail', message: `${fieldName} contains banned phrases: ${banned.slice(0, 3).join(', ')}` };
                }
            }
            return { status: 'pass', message: `${fieldName} no banned phrases` };
            
        case 'noGenericTriggers':
            if (Array.isArray(value)) {
                const generic = value.filter(v => 
                    GENERIC_TRIGGERS?.some(gt => v.toLowerCase() === gt.toLowerCase())
                );
                if (generic.length > 0) {
                    return { status: 'warn', message: `${fieldName} has generic triggers: ${generic.slice(0, 3).join(', ')}` };
                }
            }
            return { status: 'pass', message: `${fieldName} no generic triggers` };
            
        case 'hasNamePlaceholder':
            if (Array.isArray(value)) {
                const withName = value.filter(v => v.includes('{name}'));
                if (withName.length === 0) {
                    return { status: 'warn', message: `${fieldName} should include {name} in at least one reply` };
                }
            }
            return { status: 'pass', message: `${fieldName} has {name} placeholder` };
            
        case 'noNamePlaceholder':
            if (Array.isArray(value)) {
                const withName = value.filter(v => v.includes('{name}'));
                if (withName.length > 0) {
                    return { status: 'fail', message: `${fieldName} should NOT include {name} (this is _noName variant)` };
                }
            }
            return { status: 'pass', message: `${fieldName} no {name} (correct)` };
            
        case 'matchesQuickRepliesCount':
            const qrCount = scenario.quickReplies?.length || 0;
            const qrNoNameCount = scenario.quickReplies_noName?.length || 0;
            if (qrCount > 0 && qrNoNameCount !== qrCount) {
                return { status: 'warn', message: `quickReplies_noName count (${qrNoNameCount}) doesn't match quickReplies (${qrCount})` };
            }
            return { status: 'pass', message: `_noName count matches` };
            
        case 'matchesFullRepliesCount':
            const frCount = scenario.fullReplies?.length || 0;
            const frNoNameCount = scenario.fullReplies_noName?.length || 0;
            if (frCount > 0 && frNoNameCount !== frCount) {
                return { status: 'warn', message: `fullReplies_noName count (${frNoNameCount}) doesn't match fullReplies (${frCount})` };
            }
            return { status: 'pass', message: `_noName count matches` };
            
        case 'validScenarioType':
            if (value && !SCENARIO_TYPES.includes(value)) {
                return { status: 'warn', message: `scenarioType "${value}" is not standard` };
            }
            return { status: 'pass', message: `scenarioType valid` };
            
        case 'validBehavior':
            if (value && APPROVED_BEHAVIORS && !APPROVED_BEHAVIORS.includes(value)) {
                return { status: 'warn', message: `behavior "${value}" is not in approved list` };
            }
            return { status: 'pass', message: `behavior valid` };
            
        case 'validRegex':
            if (Array.isArray(value)) {
                for (const pattern of value) {
                    try {
                        new RegExp(pattern);
                    } catch (e) {
                        return { status: 'fail', message: `Invalid regex in ${fieldName}: ${pattern}` };
                    }
                }
            }
            return { status: 'pass', message: `${fieldName} regex valid` };
            
        default:
            return null; // Unknown check type, skip
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// RUNTIME AUDIT - Engine-owned fields, requires blackbox proof
// ════════════════════════════════════════════════════════════════════════════════

async function runRuntimeAudit(companyId, timeWindowHours = 24) {
    const runtimeFields = getRuntimeFields();
    const checks = [];
    
    try {
        const since = new Date(Date.now() - timeWindowHours * 60 * 60 * 1000);
        
        // Query BlackBox for execution events
        const events = await BlackBoxRecording.find({
            companyId,
            type: { $in: ['RESPONSE_EXECUTION', 'BOOKING_DECISION', 'HANDOFF_DECISION', 'FOLLOW_UP_DECISION'] },
            createdAt: { $gte: since }
        })
        .sort({ createdAt: -1 })
        .limit(500)
        .lean();
        
        const hasRuntimeData = events.length > 0;
        
        // Check each runtime field for proof
        for (const fieldName of runtimeFields) {
            const fieldConfig = SCENARIO_SETTINGS_REGISTRY[fieldName];
            const proofKey = fieldConfig?.audit?.runtimeProofKey || fieldName;
            const allowedValues = fieldConfig?.audit?.allowedValues;
            const severity = fieldConfig?.audit?.severity || 'info';
            
            // Look for evidence in events
            let seen = false;
            let lastSeenAt = null;
            let sampleTraceId = null;
            let sampleValue = null;
            let decisionCount = 0;
            const uniqueValues = new Set();
            
            for (const event of events) {
                const data = event.data || {};
                const value = data[proofKey] ?? data.runtimeDecisions?.[proofKey] ?? data.execution?.[proofKey];
                
                if (value !== undefined) {
                    seen = true;
                    decisionCount++;
                    uniqueValues.add(String(value));
                    
                    if (!lastSeenAt) {
                        lastSeenAt = event.createdAt;
                        sampleTraceId = event._id?.toString();
                        sampleValue = value;
                    }
                }
            }
            
            // Check if values are valid
            let valuesValid = true;
            let invalidValue = null;
            if (allowedValues && uniqueValues.size > 0) {
                for (const v of uniqueValues) {
                    if (!allowedValues.includes(v)) {
                        valuesValid = false;
                        invalidValue = v;
                        break;
                    }
                }
            }
            
            // Determine status
            let status = 'pass';
            let message = '';
            
            if (!hasRuntimeData) {
                status = 'warn';
                message = `No runtime data in last ${timeWindowHours}h (make test calls to prove)`;
            } else if (!seen) {
                status = 'warn';
                message = `${fieldName} not seen in ${events.length} events (may not be logged)`;
            } else if (!valuesValid) {
                status = 'fail';
                message = `${fieldName} has invalid value "${invalidValue}" (allowed: ${allowedValues.join(', ')})`;
            } else {
                message = `${fieldName} proven: ${decisionCount}x, last: ${sampleValue}`;
            }
            
            checks.push({
                field: fieldName,
                proofKey,
                status,
                severity,
                message,
                seen,
                lastSeenAt,
                sampleTraceId,
                sampleValue,
                decisionCount,
                uniqueValues: Array.from(uniqueValues)
            });
        }
        
        return {
            layer: 'runtime',
            description: 'Runtime decisions proof (HOW/WHEN to behave)',
            ...computeAuditStatus(checks, { hasRuntimeData }),
            eventCount: events.length,
            timeWindow: `${timeWindowHours}h`,
            checks
        };
        
    } catch (error) {
        logger.error('[RUNTIME AUDIT] Error:', error);
        return {
            layer: 'runtime',
            description: 'Runtime decisions proof (HOW/WHEN to behave)',
            status: 'RED',
            pass: 0,
            warn: 0,
            fail: 1,
            error: error.message,
            checks: [{
                field: 'query',
                status: 'fail',
                severity: 'critical',
                message: `Failed to query BlackBox: ${error.message}`
            }]
        };
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// ADMIN AUDIT - Config-owned fields, requires config presence
// ════════════════════════════════════════════════════════════════════════════════

async function runAdminAudit(companyId) {
    const adminFields = getAdminFields();
    const checks = [];
    
    try {
        // Load company config
        const company = await Company.findById(companyId).lean();
        if (!company) {
            return {
                layer: 'admin',
                description: 'Admin policy validation (Infrastructure)',
                status: 'RED',
                pass: 0,
                warn: 0,
                fail: 1,
                checks: [{
                    field: 'company',
                    status: 'fail',
                    severity: 'critical',
                    message: 'Company not found'
                }]
            };
        }
        
        const frontDesk = company.frontDesk || {};
        const scheduling = company.scheduling || {};
        
        // Check each admin field
        for (const fieldName of adminFields) {
            const fieldConfig = SCENARIO_SETTINGS_REGISTRY[fieldName];
            const configKey = fieldConfig?.audit?.adminConfigKey;
            const severity = fieldConfig?.audit?.severity || 'info';
            const additionalChecks = fieldConfig?.audit?.checks || [];
            
            if (!configKey) continue;
            
            // Get config value using path
            const value = getConfigValue(company, configKey);
            
            let status = 'pass';
            let message = '';
            
            if (value === undefined || value === null) {
                status = 'warn';
                message = `${fieldName}: not configured (${configKey})`;
            } else {
                message = `${fieldName}: configured`;
                
                // Run additional checks
                for (const additionalCheck of additionalChecks) {
                    const checkResult = runAdminCheck(additionalCheck, fieldName, value, company);
                    if (checkResult && checkResult.status !== 'pass') {
                        status = checkResult.status;
                        message = checkResult.message;
                        break;
                    }
                }
            }
            
            checks.push({
                field: fieldName,
                configKey,
                status,
                severity,
                message,
                value: value !== undefined ? (typeof value === 'object' ? '[object]' : value) : null
            });
        }
        
        // Special checks for critical admin settings
        
        // Silence policy sanity check
        const silencePolicy = frontDesk.silencePolicy;
        if (silencePolicy) {
            if (silencePolicy.maxConsecutive > 5) {
                checks.push({
                    field: 'silencePolicy.maxConsecutive',
                    configKey: 'frontDesk.silencePolicy.maxConsecutive',
                    status: 'warn',
                    severity: 'warn',
                    message: `silencePolicy.maxConsecutive is ${silencePolicy.maxConsecutive} (recommend <= 5)`
                });
            }
        }
        
        // Timed follow-up sanity check
        const timedFollowUp = frontDesk.timedFollowUp;
        if (timedFollowUp?.enabled) {
            const delay = timedFollowUp.delaySeconds || 50;
            if (delay > 20) {
                checks.push({
                    field: 'timedFollowUp.delaySeconds',
                    configKey: 'frontDesk.timedFollowUp.delaySeconds',
                    status: 'warn',
                    severity: 'warn',
                    message: `timedFollowUp delay is ${delay}s (recommend 6-15s for silence recovery)`
                });
            }
        }
        
        // Calendar mapping check
        const calendarConfig = scheduling?.googleCalendar || scheduling?.calendar;
        if (calendarConfig?.enabled && (!calendarConfig?.colorMapping || calendarConfig.colorMapping.length === 0)) {
            checks.push({
                field: 'calendarColorMapping',
                configKey: 'scheduling.googleCalendar.colorMapping',
                status: 'warn',
                severity: 'warn',
                message: 'Calendar enabled but no color mapping configured'
            });
        }
        
        return {
            layer: 'admin',
            description: 'Admin policy validation (Infrastructure)',
            ...computeAuditStatus(checks),
            checks
        };
        
    } catch (error) {
        logger.error('[ADMIN AUDIT] Error:', error);
        return {
            layer: 'admin',
            description: 'Admin policy validation (Infrastructure)',
            status: 'RED',
            pass: 0,
            warn: 0,
            fail: 1,
            error: error.message,
            checks: [{
                field: 'query',
                status: 'fail',
                severity: 'critical',
                message: `Failed to load company: ${error.message}`
            }]
        };
    }
}

function getConfigValue(obj, path) {
    if (!obj || !path) return undefined;
    const parts = path.split('.');
    let cur = obj;
    for (const p of parts) {
        if (cur == null) return undefined;
        cur = cur[p];
    }
    return cur;
}

function runAdminCheck(check, fieldName, value, company) {
    const [checkType, params] = check.includes(':') ? check.split(':') : [check, ''];
    const paramList = params ? params.split(',') : [];
    
    switch (checkType) {
        case 'delayRange':
            const [min, max] = paramList.map(p => parseInt(p));
            if (typeof value === 'number' && (value < min || value > max)) {
                return { status: 'warn', message: `${fieldName} is ${value}s, recommend ${min}-${max}s` };
            }
            return { status: 'pass', message: `${fieldName} in range` };
            
        case 'hasMaxConsecutive':
            if (typeof value === 'object' && !value.maxConsecutive) {
                return { status: 'warn', message: `${fieldName} missing maxConsecutive` };
            }
            return { status: 'pass', message: `${fieldName} has maxConsecutive` };
            
        case 'hasFinalWarning':
            if (typeof value === 'object' && !value.finalWarning) {
                return { status: 'warn', message: `${fieldName} missing finalWarning` };
            }
            return { status: 'pass', message: `${fieldName} has finalWarning` };
            
        default:
            return null;
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// UNIFIED AUDIT - Run all three layers
// ════════════════════════════════════════════════════════════════════════════════

async function runUnifiedAudit(companyId, options = {}) {
    const { mode = 'all', timeWindowHours = 24 } = options;
    const startTime = Date.now();
    
    // Load scenarios for content audit
    let scenarios = [];
    if (mode === 'all' || mode === 'content') {
        const templates = await GlobalInstantResponseTemplate.find({}).lean();
        for (const template of templates) {
            for (const category of (template.categories || [])) {
                scenarios.push(...(category.scenarios || []));
            }
        }
    }
    
    // Run audits based on mode
    const result = {
        companyId,
        generatedAt: new Date().toISOString(),
        generationTimeMs: 0,
        registrySnapshotVersion: 'ownership-v1',
        mode,
        summary: {},
        contentAudit: null,
        runtimeAudit: null,
        adminAudit: null
    };
    
    if (mode === 'all' || mode === 'content') {
        result.contentAudit = await runContentAudit(companyId, scenarios);
        result.summary.content = {
            status: result.contentAudit.status,
            pass: result.contentAudit.pass,
            warn: result.contentAudit.warn,
            fail: result.contentAudit.fail
        };
    }
    
    if (mode === 'all' || mode === 'runtime') {
        result.runtimeAudit = await runRuntimeAudit(companyId, timeWindowHours);
        result.summary.runtime = {
            status: result.runtimeAudit.status,
            pass: result.runtimeAudit.pass,
            warn: result.runtimeAudit.warn,
            fail: result.runtimeAudit.fail
        };
    }
    
    if (mode === 'all' || mode === 'admin') {
        result.adminAudit = await runAdminAudit(companyId);
        result.summary.admin = {
            status: result.adminAudit.status,
            pass: result.adminAudit.pass,
            warn: result.adminAudit.warn,
            fail: result.adminAudit.fail
        };
    }
    
    // Compute overall status using same reducer
    const allStatuses = [
        result.contentAudit?.status,
        result.runtimeAudit?.status,
        result.adminAudit?.status
    ].filter(Boolean);
    
    if (allStatuses.includes('RED')) {
        result.overallStatus = 'RED';
    } else if (allStatuses.includes('YELLOW')) {
        result.overallStatus = 'YELLOW';
    } else if (allStatuses.includes('GRAY')) {
        result.overallStatus = 'GRAY';
    } else {
        result.overallStatus = 'GREEN';
    }
    
    result.generationTimeMs = Date.now() - startTime;
    
    return result;
}

module.exports = {
    runUnifiedAudit,
    runContentAudit,
    runRuntimeAudit,
    runAdminAudit
};
