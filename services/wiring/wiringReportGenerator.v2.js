/**
 * ============================================================================
 * WIRING REPORT GENERATOR V2 - Source of Truth Report Builder
 * ============================================================================
 * 
 * Generates the complete wiring report with:
 *   - meta: version, timestamp
 *   - scope: companyID, tradeKey, environment
 *   - uiMap: what exists in UI
 *   - dataMap: what exists in DB
 *   - runtimeMap: what runtime reads
 *   - effectiveConfig: resolved values with source attribution
 *   - health: status for every field
 *   - diff: mismatches between UI/DB/Runtime
 *   - diagrams: Mermaid strings
 *   - noTenantBleedProof: tenant safety audits
 * 
 * ============================================================================
 */

const { wiringRegistryV2, getAllFields, getCriticalFields, getKillSwitchFields, VALIDATORS } = require('./wiringRegistry.v2');
const { RUNTIME_READERS_MAP, hasRuntimeReaders, analyzeCoverage } = require('./runtimeReaders.map');
const { evaluateTiers, getTierDefinitions } = require('./wiringTiers');
const Company = require('../../models/v2Company');
const logger = require('../../utils/logger');
const { seedCompanyBaseFields } = require('./companySeeder');

// Status codes
const STATUS = {
    WIRED: 'WIRED',              // ✅ Full end-to-end
    PARTIAL: 'PARTIAL',          // ⚠️ Some subfields missing
    MISCONFIGURED: 'MISCONFIGURED', // 🔴 Enabled but invalid
    NOT_CONFIGURED: 'NOT_CONFIGURED', // ⬜ Optional not set
    UI_ONLY: 'UI_ONLY',          // 🟣 No runtime reader
    DEAD_READ: 'DEAD_READ',      // 🟠 Runtime reads but no UI
    TENANT_RISK: 'TENANT_RISK'   // 🧨 Unscoped
};

/**
 * Get value at path from object
 */
function getPath(obj, path) {
    if (!obj || !path) return undefined;
    const parts = path.split('.');
    let cur = obj;
    for (const p of parts) {
        if (cur == null) return undefined;
        cur = cur[p];
    }
    return cur;
}

/**
 * Check if value is non-empty
 */
function isNonEmpty(val) {
    if (val == null) return false;
    if (Array.isArray(val)) return val.length > 0;
    if (typeof val === 'object') return Object.keys(val).length > 0;
    if (typeof val === 'string') return val.trim().length > 0;
    if (typeof val === 'boolean') return true;
    if (typeof val === 'number') return true;
    return true;
}

/**
 * Compute status for a field
 */
function computeFieldStatus(field, dbValue, hasRuntime, derivedData = null) {
    const hasDbValue = isNonEmpty(dbValue);
    const hasUi = !!field.ui;
    
    // GLOBAL_TEMPLATE_DERIVED fields are checked differently
    if (field.isDerived || field.source === 'GLOBAL_TEMPLATE_DERIVED') {
        // For derived fields, check the derivedData instead of dbValue
        if (derivedData) {
            if (derivedData.hasTemplateRefs && derivedData.scenarioCount > 0) {
                return STATUS.WIRED;
            } else if (derivedData.hasTemplateRefs && derivedData.scenarioCount === 0) {
                return STATUS.PARTIAL; // Templates linked but no scenarios
            } else {
                return STATUS.NOT_CONFIGURED; // No template refs
            }
        }
        return STATUS.NOT_CONFIGURED;
    }
    
    // No runtime reader = UI_ONLY
    if (!hasRuntime) {
        return hasDbValue ? STATUS.UI_ONLY : STATUS.NOT_CONFIGURED;
    }
    
    // Has runtime but no DB value
    if (!hasDbValue) {
        if (field.required) {
            return STATUS.MISCONFIGURED;
        }
        return STATUS.NOT_CONFIGURED;
    }
    
    // Has both - check validators
    if (field.validators && field.validators.length > 0) {
        for (const validator of field.validators) {
            if (typeof validator.fn === 'function' && !validator.fn(dbValue)) {
                return STATUS.MISCONFIGURED;
            }
        }
    }
    
    return STATUS.WIRED;
}

/**
 * Build UI map from registry
 */
function buildUiMap() {
    const uiMap = {
        tabs: [],
        sections: [],
        fields: [],
        totalTabs: 0,
        totalSections: 0,
        totalFields: 0
    };
    
    for (const tab of wiringRegistryV2.tabs) {
        uiMap.tabs.push({
            id: tab.id,
            label: tab.label,
            ui: tab.ui,
            critical: tab.critical || false
        });
        uiMap.totalTabs++;
        
        for (const section of (tab.sections || [])) {
            uiMap.sections.push({
                id: section.id,
                label: section.label,
                tabId: tab.id,
                ui: section.ui,
                critical: section.critical || false
            });
            uiMap.totalSections++;
            
            for (const field of (section.fields || [])) {
                uiMap.fields.push({
                    id: field.id,
                    label: field.label,
                    sectionId: section.id,
                    tabId: tab.id,
                    ui: field.ui,
                    required: field.required || false,
                    critical: field.critical || false
                });
                uiMap.totalFields++;
            }
        }
    }
    
    return uiMap;
}

/**
 * Build data map from registry + actual DB values
 */
function buildDataMap(companyDoc) {
    const dataMap = {
        collections: {},
        fields: [],
        coverage: {
            total: 0,
            found: 0,
            missing: 0
        }
    };
    
    const allFields = getAllFields();
    
    for (const field of allFields) {
        const dbPath = field.db?.path;
        let dbValue = undefined;
        let source = 'not_found';
        
        // Derived/global fields do not count against DB coverage for company doc.
        const isDerived = field.isDerived || field.source === 'GLOBAL_TEMPLATE_DERIVED' || !dbPath;

        if (!isDerived && dbPath && companyDoc) {
            dbValue = getPath(companyDoc, dbPath);
            if (isNonEmpty(dbValue)) {
                source = 'companyDoc';
                dataMap.coverage.found++;
            } else if (field.defaultValue !== undefined) {
                dbValue = field.defaultValue;
                source = 'default';
            } else {
                dataMap.coverage.missing++;
            }
            dataMap.coverage.total++;
        } else if (isDerived) {
            source = field.source || 'derived';
        }
        
        dataMap.fields.push({
            id: field.id,
            dbPath,
            dbCollection: field.db?.collection || 'companiesCollection',
            value: dbValue,
            source,
            hasValue: isNonEmpty(dbValue),
            isDerived
        });
    }
    
    // =========================================================================
    // CRITICAL FIX: Add templateReferences directly to dataMap
    // WiringDiagnosticService.getQuickDiagnostics() expects this at:
    //   wiringReport.dataMap.templateReferences
    // Without this, diagnostics will always show "No Templates Linked" even 
    // when templates ARE linked via aiAgentSettings.templateReferences
    // =========================================================================
    const templateRefs = companyDoc?.aiAgentSettings?.templateReferences || [];
    dataMap.templateReferences = templateRefs.filter(ref => ref.enabled !== false);
    
    return dataMap;
}

/**
 * Build runtime map from readers map
 */
function buildRuntimeMap() {
    const runtimeMap = {
        readers: [],
        coverage: {
            total: 0,
            mapped: 0,
            unmapped: 0
        }
    };
    
    for (const [configPath, entry] of Object.entries(RUNTIME_READERS_MAP)) {
        runtimeMap.readers.push({
            configPath,
            dbPath: entry.dbPath,
            scope: entry.scope,
            readersCount: entry.readers?.length || 0,
            readers: (entry.readers || []).map(r => ({
                file: r.file,
                function: r.function,
                line: r.line,
                description: r.description,
                critical: r.critical || false,
                checkpoint: r.checkpoint || null
            })),
            defaultValue: entry.defaultValue
        });
        runtimeMap.coverage.total++;
        runtimeMap.coverage.mapped++;
    }
    
    return runtimeMap;
}

/**
 * Build effective config with source attribution
 */
function buildEffectiveConfig(companyDoc, globalTemplates = []) {
    const effectiveConfig = {
        fields: [],
        killSwitches: {},
        criticalFields: {}
    };
    
    const allFields = getAllFields();
    
    for (const field of allFields) {
        const dbPath = field.db?.path;
        let value = undefined;
        let source = 'not_set';
        let sourceRef = null;
        
        // Try to get from company doc
        if (dbPath && companyDoc) {
            value = getPath(companyDoc, dbPath);
            if (isNonEmpty(value)) {
                source = 'companyDoc';
                sourceRef = companyDoc._id?.toString() || null;
            }
        }
        
        // Fall back to default
        if (!isNonEmpty(value) && field.defaultValue !== undefined) {
            value = field.defaultValue;
            source = 'default';
            sourceRef = 'wiringRegistry';
        }
        
        const entry = {
            id: field.id,
            label: field.label,
            value,
            source,
            sourceRef,
            scope: field.scope || 'company'
        };
        
        effectiveConfig.fields.push(entry);
        
        // Track kill switches separately
        if (field.killSwitch) {
            effectiveConfig.killSwitches[field.id] = {
                value,
                effect: field.killSwitchEffect,
                isBlocking: value === true
            };
        }
        
        // Track critical fields separately
        if (field.critical) {
            effectiveConfig.criticalFields[field.id] = {
                value,
                hasValue: isNonEmpty(value),
                required: field.required
            };
        }
    }
    
    return effectiveConfig;
}

/**
 * Build health report
 */
function buildHealth(companyDoc, derivedData = {}) {
    const health = {
        overall: 'GREEN',
        byStatus: {
            [STATUS.WIRED]: 0,
            [STATUS.PARTIAL]: 0,
            [STATUS.MISCONFIGURED]: 0,
            [STATUS.NOT_CONFIGURED]: 0,
            [STATUS.UI_ONLY]: 0,
            [STATUS.DEAD_READ]: 0,
            [STATUS.TENANT_RISK]: 0
        },
        // NEW: Required vs Optional breakdown
        requiredCoverage: {
            total: 0,
            wired: 0,
            missing: 0,
            percent: 0,
            missingFields: []
        },
        optionalCoverage: {
            total: 0,
            configured: 0,
            notConfigured: 0,
            percent: 0
        },
        // NEW: Golden Blueprint status
        goldenBlueprint: {
            ready: false,
            score: 0,
            requiredMet: false,
            recommendedMet: false,
            missingForGolden: []
        },
        fields: [],
        criticalIssues: [],
        warnings: []
    };
    
    const allFields = getAllFields();
    
    for (const field of allFields) {
        // Handle GLOBAL_TEMPLATE_DERIVED fields differently
        const isDerived = field.isDerived || field.source === 'GLOBAL_TEMPLATE_DERIVED';
        
        let dbPath = null;
        let dbValue = undefined;
        
        if (!isDerived) {
            dbPath = field.db?.path;
            dbValue = dbPath && companyDoc ? getPath(companyDoc, dbPath) : undefined;
        }
        
        const hasRuntime = hasRuntimeReaders(field.id);
        
        // Pass derivedData for derived fields
        const fieldDerivedData = isDerived ? derivedData : null;
        const status = computeFieldStatus(field, dbValue, hasRuntime, fieldDerivedData);
        
        health.byStatus[status]++;
        
        // Build detailed field entry
        const fieldEntry = {
            id: field.id,
            label: field.label,
            status,
            hasValue: isDerived ? (derivedData?.scenarioCount > 0) : isNonEmpty(dbValue),
            hasRuntime,
            critical: field.critical || false,
            required: field.required || false,
            dbPath: isDerived ? null : (field.db?.path || null),
            currentValue: isDerived ? `${derivedData?.scenarioCount || 0} scenarios from ${derivedData?.templateCount || 0} templates` : dbValue,
            defaultValue: field.defaultValue,
            source: isDerived ? 'GLOBAL_TEMPLATE_DERIVED' : (isNonEmpty(dbValue) ? 'companyDoc' : (field.defaultValue !== undefined ? 'default' : 'not_set')),
            isDerived: isDerived || false
        };
        
        health.fields.push(fieldEntry);
        
        // Handle derived fields that aren't wired (missing templates or scenarios)
        if (isDerived && status !== STATUS.WIRED) {
            let reason, fix;
            
            if (!derivedData?.hasTemplateRefs) {
                reason = 'No templates linked to company';
                fix = field.fixInstructions?.noTemplateRefs || 'Select templates in Data & Config → Template References';
            } else if (derivedData?.scenarioCount === 0) {
                reason = 'Templates linked but contain 0 scenarios';
                fix = field.fixInstructions?.scenariosEmpty || 'Add scenarios to the linked template';
            } else {
                reason = 'Unknown derivation issue';
                fix = 'Check template configuration';
            }
            
            if (status === STATUS.PARTIAL || status === STATUS.NOT_CONFIGURED) {
                health.warnings.push({
                    fieldId: field.id,
                    label: field.label,
                    status,
                    reason,
                    fix,
                    derivedFrom: 'templateReferences',
                    templateCount: derivedData?.templateCount || 0,
                    scenarioCount: derivedData?.scenarioCount || 0
                });
            }
            continue; // Skip the MISCONFIGURED block for derived fields
        }
        
        // CRITICAL FIX: If health=RED, criticalIssues must never be empty
        // Every MISCONFIGURED field must emit a criticalIssue entry
        if (status === STATUS.MISCONFIGURED) {
            // Determine WHY it's misconfigured
            let reason = 'Unknown validation failure';
            let expected = 'Valid value';
            let fix = 'Check UI configuration';
            
            if (!isNonEmpty(dbValue) && field.required) {
                reason = `Required field is empty/missing in database`;
                expected = field.defaultValue !== undefined ? `Default: ${JSON.stringify(field.defaultValue)}` : 'Any valid value';
                fix = `Set value in Control Plane → ${field.ui?.path || field.label}`;
            } else if (field.validators && field.validators.length > 0) {
                // Run validators to get specific failure message
                for (const validator of field.validators) {
                    if (typeof validator.fn === 'function' && !validator.fn(dbValue)) {
                        reason = validator.message || 'Validation failed';
                        expected = validator.message || 'Passes validation';
                        fix = `Fix in Control Plane → ${field.ui?.path || field.label}`;
                        break;
                    }
                }
            }
            
            health.criticalIssues.push({
                fieldId: field.id,
                label: field.label,
                status,
                reason,
                expected,
                actual: dbValue === undefined ? 'undefined' : (dbValue === null ? 'null' : JSON.stringify(dbValue)),
                dbPath: field.db?.path,
                uiPath: field.ui?.path,
                fix,
                critical: field.critical || false,
                required: field.required || false
            });
        } else if (status === STATUS.UI_ONLY && field.required) {
            health.warnings.push({
                fieldId: field.id,
                label: field.label,
                status,
                message: `Required field has no runtime reader (UI_ONLY)`
            });
        }
    }
    
    // Determine overall health
    if (health.byStatus[STATUS.MISCONFIGURED] > 0 || health.criticalIssues.length > 0) {
        health.overall = 'RED';
    } else if (health.byStatus[STATUS.UI_ONLY] > 0 || health.byStatus[STATUS.PARTIAL] > 0) {
        health.overall = 'YELLOW';
    }
    
    // =========================================================================
    // CALCULATE REQUIRED vs OPTIONAL COVERAGE
    // =========================================================================
    for (const field of health.fields) {
        if (field.required) {
            health.requiredCoverage.total++;
            if (field.status === STATUS.WIRED) {
                health.requiredCoverage.wired++;
            } else if (field.status === STATUS.NOT_CONFIGURED || field.status === STATUS.MISCONFIGURED) {
                health.requiredCoverage.missing++;
                health.requiredCoverage.missingFields.push({
                    id: field.id,
                    label: field.label,
                    status: field.status,
                    dbPath: field.dbPath,
                    defaultValue: field.defaultValue
                });
            }
        } else {
            health.optionalCoverage.total++;
            if (field.status === STATUS.WIRED || field.status === STATUS.PARTIAL) {
                health.optionalCoverage.configured++;
            } else {
                health.optionalCoverage.notConfigured++;
            }
        }
    }
    
    // Calculate percentages
    if (health.requiredCoverage.total > 0) {
        health.requiredCoverage.percent = Math.round(
            (health.requiredCoverage.wired / health.requiredCoverage.total) * 100
        );
    }
    if (health.optionalCoverage.total > 0) {
        health.optionalCoverage.percent = Math.round(
            (health.optionalCoverage.configured / health.optionalCoverage.total) * 100
        );
    }
    
    // =========================================================================
    // GOLDEN BLUEPRINT EVALUATION
    // =========================================================================
    // A company is "Golden Blueprint Ready" when:
    // 1. All REQUIRED fields are WIRED (100% required coverage)
    // 2. No CRITICAL_ISSUES
    // 3. No MISCONFIGURED fields
    // 4. Recommended: Key optional fields configured (>50% optional)
    
    const requiredMet = health.requiredCoverage.percent === 100;
    const noCriticalIssues = health.criticalIssues.length === 0;
    const noMisconfigured = health.byStatus[STATUS.MISCONFIGURED] === 0;
    const recommendedMet = health.optionalCoverage.percent >= 50;
    
    health.goldenBlueprint.requiredMet = requiredMet;
    health.goldenBlueprint.recommendedMet = recommendedMet;
    health.goldenBlueprint.ready = requiredMet && noCriticalIssues && noMisconfigured;
    
    // Calculate golden blueprint score (0-100)
    let score = 0;
    if (requiredMet) score += 60;  // 60% weight on required fields
    if (noCriticalIssues) score += 20;  // 20% weight on no critical issues
    if (noMisconfigured) score += 10;  // 10% weight on no misconfigurations
    if (recommendedMet) score += 10;  // 10% weight on optional fields
    health.goldenBlueprint.score = score;
    
    // List what's missing for golden blueprint
    if (!requiredMet) {
        health.goldenBlueprint.missingForGolden.push({
            category: 'REQUIRED_FIELDS',
            message: `${health.requiredCoverage.missing} required fields not configured`,
            fields: health.requiredCoverage.missingFields.map(f => f.id)
        });
    }
    if (health.criticalIssues.length > 0) {
        health.goldenBlueprint.missingForGolden.push({
            category: 'CRITICAL_ISSUES',
            message: `${health.criticalIssues.length} critical issues to fix`,
            issues: health.criticalIssues.map(i => i.fieldId)
        });
    }
    
    return health;
}

/**
 * Build diff report (UI vs DB vs Runtime mismatches)
 */
function buildDiff(companyDoc) {
    const diff = {
        uiVsDb: [],      // Fields in UI but not in DB
        dbVsRuntime: [], // Fields in DB but no runtime reader
        runtimeVsUi: [], // Runtime reads but no UI exposure
        total: 0
    };
    
    const allFields = getAllFields();
    const uiFieldIds = new Set(allFields.map(f => f.id));
    const runtimeFieldIds = new Set(Object.keys(RUNTIME_READERS_MAP));
    
    // UI vs DB
    for (const field of allFields) {
        const dbPath = field.db?.path;
        const dbValue = dbPath && companyDoc ? getPath(companyDoc, dbPath) : undefined;
        
        if (!isNonEmpty(dbValue) && field.required) {
            diff.uiVsDb.push({
                fieldId: field.id,
                issue: 'Required field not in DB',
                uiPath: field.ui?.path,
                dbPath: field.db?.path
            });
            diff.total++;
        }
    }
    
    // DB vs Runtime
    for (const field of allFields) {
        const hasRuntime = runtimeFieldIds.has(field.id);
        const dbPath = field.db?.path;
        const dbValue = dbPath && companyDoc ? getPath(companyDoc, dbPath) : undefined;
        
        if (isNonEmpty(dbValue) && !hasRuntime) {
            diff.dbVsRuntime.push({
                fieldId: field.id,
                issue: 'Value in DB but no runtime reader (UI_ONLY)',
                dbPath: field.db?.path
            });
            diff.total++;
        }
    }
    
    // Runtime vs UI (dead reads)
    for (const runtimeFieldId of runtimeFieldIds) {
        if (!uiFieldIds.has(runtimeFieldId)) {
            diff.runtimeVsUi.push({
                fieldId: runtimeFieldId,
                issue: 'Runtime reads but not in UI registry (DEAD_READ)',
                runtimeEntry: RUNTIME_READERS_MAP[runtimeFieldId]
            });
            diff.total++;
        }
    }
    
    return diff;
}

/**
 * Build tenant safety audit
 */
/**
 * Build comprehensive Scope Proof for multi-tenant safety
 * 
 * THE NON-NEGOTIABLE RULES:
 * 1. Templates + Scenarios are GLOBAL (never contain hardcoded company values)
 * 2. Companies only store REFERENCES (not scenario bodies)
 * 3. Effective Config is computed per request
 * 4. Wiring Tab must be company-scoped
 * 5. No cross-tenant writes
 */
function buildNoTenantBleedProof(companyDoc, companyId, derivedData = {}) {
    const proof = {
        passed: true,
        checks: [],
        violations: [],
        
        // SCOPE PROOF - The definitive multi-tenant audit
        scopeProof: {
            companyId: companyId,
            tradeKey: companyDoc?.aiAgentSettings?.tradeKey || companyDoc?.tradeKey || 'universal',
            templateIdsUsed: [],
            scenarioIdsUsed: [], // IDs only - never bodies
            placeholdersResolvedFrom: 'effectiveConfig',
            noEmbeddedScenarioBodies: true,
            noCompanyWritesToGlobal: true,
            configSourceChain: ['globalDefaults', 'templateConfig', 'companyConfig']
        }
    };
    
    // Extract template IDs and details used
    const templateRefs = companyDoc?.aiAgentSettings?.templateReferences || [];
    const enabledTemplates = templateRefs.filter(ref => ref.enabled !== false);
    
    proof.scopeProof.templateIdsUsed = enabledTemplates
        .map(ref => ref.templateId)
        .filter(Boolean);
    
    // V55: Add template DETAILS for verification (name + ID)
    proof.scopeProof.templatesUsed = enabledTemplates.map(ref => ({
        id: ref.templateId?.toString() || 'unknown',
        name: ref.templateName || 'Unnamed Template',
        priority: ref.priority || 1,
        enabled: ref.enabled !== false
    }));
    
    // Extract scenario IDs from derivedData (IDs only, never bodies)
    if (derivedData?.scenarios && Array.isArray(derivedData.scenarios)) {
        proof.scopeProof.scenarioIdsUsed = derivedData.scenarios
            .map(s => s._id || s.scenarioId || s.id)
            .filter(Boolean)
            .map(id => id.toString());
    }
    
    // =========================================================================
    // CHECK 1: COMPANY_ID_MATCH
    // =========================================================================
    const idMatch = companyDoc?._id?.toString() === companyId;
    proof.checks.push({
        id: 'COMPANY_ID_MATCH',
        description: 'Company document ID matches requested ID',
        passed: idMatch,
        expected: companyId,
        actual: companyDoc?._id?.toString()
    });
    
    if (!idMatch) {
        proof.passed = false;
        proof.violations.push({
            rule: 'COMPANY_ID_MATCH',
            severity: 'CRITICAL',
            message: 'Company ID mismatch - possible tenant bleed'
        });
    }
    
    // =========================================================================
    // CHECK 2: NO_EMBEDDED_SCENARIOS
    // =========================================================================
    const hasEmbeddedScenarios = templateRefs.some(ref => 
        ref.scenarios && Array.isArray(ref.scenarios) && ref.scenarios.length > 0
    );
    
    proof.scopeProof.noEmbeddedScenarioBodies = !hasEmbeddedScenarios;
    
    proof.checks.push({
        id: 'NO_EMBEDDED_SCENARIOS',
        description: 'Template references contain IDs only, not embedded scenario bodies',
        passed: !hasEmbeddedScenarios,
        templateRefCount: templateRefs.length
    });
    
    if (hasEmbeddedScenarios) {
        proof.passed = false;
        proof.violations.push({
            rule: 'NO_EMBEDDED_SCENARIOS',
            severity: 'CRITICAL',
            message: 'Company doc contains embedded scenarios - violates global template rule'
        });
    }
    
    // =========================================================================
    // CHECK 3: NO_SCENARIO_TEXT_IN_COMPANY_DOC
    // =========================================================================
    const companyJson = JSON.stringify(companyDoc || {});
    const hasScenarioText = companyJson.includes('"triggers":[') && 
                           companyJson.includes('"quickReplies":[');
    
    proof.checks.push({
        id: 'NO_SCENARIO_TEXT',
        description: 'Company document does not contain scenario text (triggers/quickReplies)',
        passed: !hasScenarioText
    });
    
    if (hasScenarioText) {
        proof.passed = false;
        proof.scopeProof.noEmbeddedScenarioBodies = false;
        proof.violations.push({
            rule: 'NO_SCENARIO_TEXT',
            severity: 'CRITICAL',
            message: 'Company doc appears to contain scenario text - violates global template rule'
        });
    }
    
    // =========================================================================
    // CHECK 4: TRADE_KEY_CONSISTENCY
    // =========================================================================
    const companyTradeKey = companyDoc?.aiAgentSettings?.tradeKey || companyDoc?.tradeKey;
    const hasTradeKey = !!companyTradeKey;
    
    proof.checks.push({
        id: 'TRADE_KEY_SET',
        description: 'Company has explicit tradeKey set (prevents cross-trade scenario bleed)',
        passed: hasTradeKey,
        tradeKey: companyTradeKey || 'NOT_SET'
    });
    
    // Not a hard failure, but a warning
    if (!hasTradeKey) {
        proof.violations.push({
            rule: 'TRADE_KEY_SET',
            severity: 'WARNING',
            message: 'No explicit tradeKey - company may receive scenarios from other trades'
        });
    }
    
    // =========================================================================
    // CHECK 5: PLACEHOLDERS_USE_ALLOWLIST
    // =========================================================================
    // Check that any placeholders in company config use standard keys
    const ALLOWED_PLACEHOLDER_KEYS = [
        'companyName', 'businessName', 'phone', 'hours', 'serviceArea',
        'address', 'email', 'website', 'aiName', 'ownerName',
        'emergencyPhone', 'afterHoursMessage', 'holidayMessage'
    ];
    
    const companyPlaceholders = companyDoc?.aiAgentSettings?.placeholders || {};
    const placeholderKeys = Object.keys(companyPlaceholders);
    const invalidPlaceholders = placeholderKeys.filter(k => !ALLOWED_PLACEHOLDER_KEYS.includes(k));
    
    proof.checks.push({
        id: 'PLACEHOLDERS_ALLOWLIST',
        description: 'Company placeholders use only allowed keys',
        passed: invalidPlaceholders.length === 0,
        allowedKeys: ALLOWED_PLACEHOLDER_KEYS,
        invalidKeys: invalidPlaceholders
    });
    
    if (invalidPlaceholders.length > 0) {
        proof.violations.push({
            rule: 'PLACEHOLDERS_ALLOWLIST',
            severity: 'WARNING',
            message: `Unknown placeholder keys: ${invalidPlaceholders.join(', ')}`
        });
    }
    
    // =========================================================================
    // CHECK 6: NO_HARDCODED_OTHER_COMPANY_DATA
    // =========================================================================
    // Look for patterns that suggest hardcoded data from other companies
    const suspiciousPatterns = [
        /\b(Penguin Air|ABC Plumbing|Smith Dental)\b/gi, // Example company names
        /\+1\d{10}/g, // Phone numbers that shouldn't be in config
    ];
    
    // Only check scenario-like fields, not the whole doc
    const fieldsToCheck = [
        companyDoc?.aiAgentSettings?.frontDeskBehavior?.greetingResponses,
        companyDoc?.aiAgentSettings?.frontDeskBehavior?.fallbackResponses,
    ].filter(Boolean);
    
    let hasHardcodedData = false;
    for (const field of fieldsToCheck) {
        const fieldStr = JSON.stringify(field);
        // If it contains what looks like specific company data but doesn't use placeholders
        if (fieldStr.includes('Penguin') && !fieldStr.includes('{companyName}')) {
            hasHardcodedData = true;
        }
    }
    
    proof.checks.push({
        id: 'NO_HARDCODED_COMPANY_DATA',
        description: 'Company responses use placeholders, not hardcoded values',
        passed: !hasHardcodedData
    });
    
    if (hasHardcodedData) {
        proof.violations.push({
            rule: 'NO_HARDCODED_COMPANY_DATA',
            severity: 'WARNING',
            message: 'Some responses may contain hardcoded company-specific text instead of placeholders'
        });
    }
    
    // =========================================================================
    // CHECK 7: COMPANY_ONLY_STORES_REFERENCES
    // =========================================================================
    // Verify company doc structure follows the reference pattern
    const companyStoresOnlyRefs = 
        !companyDoc?.scenarios && // No direct scenarios
        !companyDoc?.categories && // No direct categories
        !companyDoc?.templates; // No direct templates
    
    proof.checks.push({
        id: 'COMPANY_STORES_REFS_ONLY',
        description: 'Company document only stores references to global resources, not the resources themselves',
        passed: companyStoresOnlyRefs
    });
    
    if (!companyStoresOnlyRefs) {
        proof.passed = false;
        proof.violations.push({
            rule: 'COMPANY_STORES_REFS_ONLY',
            severity: 'CRITICAL',
            message: 'Company doc contains direct scenarios/categories/templates - must use references only'
        });
    }
    
    // =========================================================================
    // FINAL SUMMARY
    // =========================================================================
    const criticalViolations = proof.violations.filter(v => v.severity === 'CRITICAL');
    const warningViolations = proof.violations.filter(v => v.severity === 'WARNING');
    
    proof.summary = {
        totalChecks: proof.checks.length,
        passed: proof.checks.filter(c => c.passed).length,
        failed: proof.checks.filter(c => !c.passed).length,
        criticalViolations: criticalViolations.length,
        warnings: warningViolations.length,
        verdict: criticalViolations.length === 0 ? 'SAFE' : 'UNSAFE'
    };
    
    // Only fail on critical violations
    proof.passed = criticalViolations.length === 0;
    
    return proof;
}

/**
 * Generate Mermaid diagrams
 */
function buildDiagrams(companyDoc, health) {
    const diagrams = {};
    
    // System overview diagram
    diagrams.systemOverview = `
graph TD
    subgraph "Control Plane UI"
        UI[User Interface]
    end
    
    subgraph "Database"
        COMPANY[(Company Doc)]
        TEMPLATES[(Global Templates)]
        CHEATSHEETS[(Cheat Sheets)]
    end
    
    subgraph "Runtime"
        CE[ConversationEngine]
        SPS[ScenarioPoolService]
        LLM[LLM Engine]
    end
    
    UI -->|saves| COMPANY
    UI -->|references| TEMPLATES
    CE -->|reads| COMPANY
    CE -->|loads via templateRefs| SPS
    SPS -->|fetches| TEMPLATES
    CE -->|calls| LLM
    
    style UI fill:#22d3ee
    style CE fill:#22c55e
    style COMPANY fill:#f59e0b
    style TEMPLATES fill:#8b5cf6
`;

    // Kill switches diagram
    const killSwitches = getKillSwitchFields();
    const killSwitchStates = killSwitches.map(ks => {
        const val = getPath(companyDoc, ks.db?.path);
        return `${ks.label}: ${val ? 'ON 🔴' : 'OFF ✅'}`;
    }).join('\\n');
    
    diagrams.killSwitches = `
graph LR
    INPUT[User Input] --> KS{Kill Switches}
    KS -->|${killSwitchStates}| DECISION
    DECISION -->|Scenarios Allowed| SCENARIOS[Scenario Selector]
    DECISION -->|Scenarios Blocked| LLM[LLM Only]
`;

    // Health status diagram
    const wiredCount = health.byStatus[STATUS.WIRED] || 0;
    const partialCount = health.byStatus[STATUS.PARTIAL] || 0;
    const misconfiguredCount = health.byStatus[STATUS.MISCONFIGURED] || 0;
    const uiOnlyCount = health.byStatus[STATUS.UI_ONLY] || 0;
    
    diagrams.healthSummary = `
pie title Field Health Status
    "WIRED" : ${wiredCount}
    "PARTIAL" : ${partialCount}
    "MISCONFIGURED" : ${misconfiguredCount}
    "UI_ONLY" : ${uiOnlyCount}
`;

    return diagrams;
}

/**
 * Main report generator
 */
async function generateWiringReport({ companyId, tradeKey = null, environment = 'production' }) {
    const startTime = Date.now();
    
    // Load company doc FIRST so we can get the actual tradeKey
    let companyDoc = await Company.findById(companyId).lean();
    if (!companyDoc) {
        throw new Error(`Company not found: ${companyId}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MANDATORY: Seed required base fields (idempotent)
    // This prevents Wiring regression due to missing basics and avoids “Modified:0”
    // confusion by always writing through the `Company` model (companiesCollection).
    // ─────────────────────────────────────────────────────────────────────────
    try {
        const seedRes = await seedCompanyBaseFields({ companyId, companyDoc });
        if (seedRes.updated) {
            companyDoc = await Company.findById(companyId).lean();
        }
    } catch (e) {
        logger.warn('[WIRING REPORT V2] Seeder failed (non-fatal)', { error: e?.message || String(e) });
    }
    
    // CRITICAL FIX: Use company's actual tradeKey, not a blind default to 'universal'
    // Resolution order:
    // 1. Explicit tradeKey passed
    // 2. Company's stored tradeKey
    // 3. Infer from templateReferences if available
    // 4. Fallback to 'universal'
    const templateRefs = companyDoc.aiAgentSettings?.templateReferences || [];
    let inferredTradeKey = null;
    let tradeKeySource = null;
    
    const requestedTradeKey = tradeKey ? String(tradeKey) : null;
    const companyTradeKey =
        companyDoc.aiAgentSettings?.tradeKey ||
        companyDoc.tradeKey ||
        companyDoc.trade ||
        null;

    let resolvedTradeKey = null;
    if (requestedTradeKey) {
        resolvedTradeKey = requestedTradeKey;
        tradeKeySource = 'requested';
    } else if (companyTradeKey) {
        resolvedTradeKey = String(companyTradeKey);
        tradeKeySource = 'company';
    } else {
        // Only infer if we actually need it.
        if (templateRefs.length > 0 && templateRefs[0].templateId) {
            try {
                const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
                const firstTemplate = await GlobalInstantResponseTemplate
                    .findById(templateRefs[0].templateId)
                    .select('tradeKey templateType')
                    .lean();
                inferredTradeKey = firstTemplate?.tradeKey || firstTemplate?.templateType || null;
                if (inferredTradeKey) {
                    resolvedTradeKey = String(inferredTradeKey);
                    tradeKeySource = 'inferredFromTemplates';
                }
            } catch (e) {
                logger.warn('[WIRING REPORT V2] Could not infer tradeKey from template', { error: e?.message || String(e) });
            }
        }
        if (!resolvedTradeKey) {
            resolvedTradeKey = 'universal';
            tradeKeySource = 'default';
        }
    }
    resolvedTradeKey = String(resolvedTradeKey).toLowerCase();
    if (tradeKeySource !== 'inferredFromTemplates') {
        inferredTradeKey = null; // keep report clean
    }
    
    logger.info('[WIRING REPORT V2] Generating report', { 
        companyId, 
        requestedTradeKey,
        resolvedTradeKey,
        inferredTradeKey,
        tradeKeySource,
        companyTradeKey: companyTradeKey ? String(companyTradeKey).toLowerCase() : null
    });
    
    // Load DERIVED data (scenario pool from templates)
    const enabledTemplateRefs = Array.isArray(templateRefs) ? templateRefs.filter(r => r?.enabled !== false) : [];
    let derivedData = {
        hasTemplateRefs: enabledTemplateRefs.length > 0,
        templateCount: enabledTemplateRefs.length,
        scenarioCount: 0,
        scenarios: []
    };
    
    if (derivedData.hasTemplateRefs) {
        try {
            const ScenarioPoolService = require('../../services/ScenarioPoolService');
            const poolResult = await ScenarioPoolService.getScenarioPoolForCompany(companyId);
            derivedData.scenarioCount = poolResult.scenarios?.length || 0;
            derivedData.scenarios = poolResult.scenarios || [];
            derivedData.effectiveConfigVersion = poolResult.effectiveConfigVersion || null;
        } catch (e) {
            logger.warn('[WIRING REPORT V2] Could not load scenario pool', { error: e.message });
            derivedData.scenarioPoolError = e.message;
        }
    }
    
    logger.info('[WIRING REPORT V2] Derived data loaded', {
        hasTemplateRefs: derivedData.hasTemplateRefs,
        templateCount: derivedData.templateCount,
        scenarioCount: derivedData.scenarioCount
    });
    
    // Build all report sections
    const uiMap = buildUiMap();
    const dataMap = buildDataMap(companyDoc);
    const runtimeMap = buildRuntimeMap();
    const effectiveConfig = buildEffectiveConfig(companyDoc);
    const health = buildHealth(companyDoc, derivedData);
    const diff = buildDiff(companyDoc);
    const noTenantBleedProof = buildNoTenantBleedProof(companyDoc, companyId, derivedData);
    const diagrams = buildDiagrams(companyDoc, health);
    
    // Calculate coverage scores
    const uiPaths = getAllFields().map(f => f.id);
    const coverage = analyzeCoverage(uiPaths);
    
    const report = {
        // META
        meta: {
            schemaVersion: wiringRegistryV2.schemaVersion,
            generatedAt: new Date().toISOString(),
            generationTimeMs: Date.now() - startTime,
            reportType: 'WIRING_REPORT_V2'
        },
        
        // SCOPE
        scope: {
            companyId,
            companyName: companyDoc.companyName || companyDoc.businessName,
            tradeKey: resolvedTradeKey,
            requestedTradeKey,
            tradeKeySource,
            inferredTradeKey,
            companyTradeKey: companyTradeKey ? String(companyTradeKey).toLowerCase() : null,
            environment,
            effectiveConfigVersion: companyDoc.effectiveConfigVersion || null
        },
        
        // SCOREBOARD (top 5 checks)
        scoreboard: {
            uiCoverage: {
                label: 'UI Coverage',
                value: `${uiMap.totalFields} fields`,
                percent: 100, // All UI fields are in registry by definition
                status: 'GREEN'
            },
            dbCoverage: {
                label: 'DB Coverage',
                value: `${dataMap.coverage.found}/${dataMap.coverage.total}`,
                percent: Math.round((dataMap.coverage.found / dataMap.coverage.total) * 100),
                status: dataMap.coverage.found === dataMap.coverage.total ? 'GREEN' : 'YELLOW'
            },
            runtimeCoverage: {
                label: 'Runtime Coverage',
                value: `${coverage.wiredCount}/${coverage.totalUIPaths}`,
                percent: coverage.runtimeCoveragePercent,
                status: coverage.runtimeCoveragePercent > 80 ? 'GREEN' : coverage.runtimeCoveragePercent > 50 ? 'YELLOW' : 'RED'
            },
            tenantSafety: {
                label: 'Tenant Safety',
                value: noTenantBleedProof.passed ? 'PASSED' : `${noTenantBleedProof.violations.length} violations`,
                percent: noTenantBleedProof.passed ? 100 : 0,
                status: noTenantBleedProof.passed ? 'GREEN' : 'RED'
            },
            deadConfig: {
                label: 'Dead Config',
                value: `${coverage.uiOnlyCount + coverage.deadReadCount} items`,
                percent: coverage.uiOnlyCount + coverage.deadReadCount === 0 ? 100 : 0,
                status: coverage.uiOnlyCount + coverage.deadReadCount === 0 ? 'GREEN' : 'YELLOW'
            }
        },
        
        // MAPS
        uiMap,
        dataMap,
        runtimeMap,
        
        // EFFECTIVE CONFIG
        effectiveConfig,
        
        // HEALTH
        health,
        
        // DIFF
        diff,
        
        // DIAGRAMS
        diagrams,
        
        // TENANT SAFETY
        noTenantBleedProof,
        
        // DERIVED DATA (from global templates)
        derivedData: {
            hasTemplateRefs: derivedData.hasTemplateRefs,
            templateCount: derivedData.templateCount,
            scenarioCount: derivedData.scenarioCount,
            effectiveConfigVersion: derivedData.effectiveConfigVersion || null,
            scenarioPoolError: derivedData.scenarioPoolError || null
        },
        
        // COVERAGE ANALYSIS
        coverage: {
            ...coverage,
            uiOnlyPaths: coverage.uiOnlyPaths.slice(0, 20), // Limit for readability
            deadReadPaths: coverage.deadReadPaths.slice(0, 20)
        },
        
        // TIER SYSTEM - Prescriptive Build Guide
        tiers: evaluateTiers(health.fields),
        tierDefinitions: getTierDefinitions()
    };
    
    logger.info('[WIRING REPORT V2] Report generated', {
        companyId,
        health: health.overall,
        currentTier: report.tiers.currentTier,
        tierScores: report.tiers.tierScores,
        nextActionsCount: report.tiers.nextActions.length,
        generationTimeMs: report.meta.generationTimeMs
    });
    
    return report;
}

/**
 * Convert report to Markdown
 */
function reportToMarkdown(report) {
    const lines = [];
    
    lines.push(`# Wiring Report: ${report.scope.companyName}`);
    lines.push('');
    lines.push(`**Generated:** ${report.meta.generatedAt}`);
    lines.push(`**Company ID:** ${report.scope.companyId}`);
    lines.push(`**Trade:** ${report.scope.tradeKey}`);
    lines.push(`**Environment:** ${report.scope.environment}`);
    lines.push(`**Health:** ${report.health.overall}`);
    lines.push('');
    
    // Scoreboard
    lines.push('## Scoreboard');
    lines.push('');
    lines.push('| Check | Value | Status |');
    lines.push('|-------|-------|--------|');
    for (const [key, check] of Object.entries(report.scoreboard)) {
        const emoji = check.status === 'GREEN' ? '✅' : check.status === 'YELLOW' ? '⚠️' : '🔴';
        lines.push(`| ${check.label} | ${check.value} (${check.percent}%) | ${emoji} ${check.status} |`);
    }
    lines.push('');
    
    // Critical Issues
    if (report.health.criticalIssues.length > 0) {
        lines.push('## 🔴 Critical Issues');
        lines.push('');
        for (const issue of report.health.criticalIssues) {
            lines.push(`- **${issue.label}**: ${issue.message}`);
        }
        lines.push('');
    }
    
    // Kill Switches
    lines.push('## Kill Switches');
    lines.push('');
    for (const [id, ks] of Object.entries(report.effectiveConfig.killSwitches)) {
        const emoji = ks.isBlocking ? '🔴' : '✅';
        lines.push(`- ${emoji} **${id}**: ${ks.value} ${ks.isBlocking ? '(BLOCKING)' : ''}`);
        if (ks.effect) lines.push(`  - Effect: ${ks.effect}`);
    }
    lines.push('');
    
    // Tenant Safety
    lines.push('## Tenant Safety');
    lines.push('');
    lines.push(`**Overall:** ${report.noTenantBleedProof.passed ? '✅ PASSED' : '🔴 FAILED'}`);
    lines.push('');
    for (const check of report.noTenantBleedProof.checks) {
        const emoji = check.passed ? '✅' : '🔴';
        lines.push(`- ${emoji} ${check.description}`);
    }
    lines.push('');
    
    // Diagrams
    lines.push('## Diagrams');
    lines.push('');
    lines.push('### System Overview');
    lines.push('```mermaid');
    lines.push(report.diagrams.systemOverview.trim());
    lines.push('```');
    lines.push('');
    
    return lines.join('\n');
}

module.exports = {
    generateWiringReport,
    reportToMarkdown,
    STATUS
};

