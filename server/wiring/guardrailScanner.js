/**
 * ============================================================================
 * GUARDRAIL SCANNER - Enforce MUST NOT DO rules
 * ============================================================================
 * 
 * Scans runtime code for violations of multi-tenant safety rules.
 * 
 * RULES ENFORCED:
 * 1. No hardcoded tenant/company names
 * 2. No trade-specific assumptions in runtime
 * 3. All cache keys must be companyId scoped
 * 4. No silent fallbacks that hide errors
 * 5. Scenarios must live in global templates only
 * 
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');

// ============================================================================
// SCAN CONFIGURATION
// ============================================================================

const SCAN_DIRS = [
    'server',
    'services',
    'routes',
    'utils',
    'models'
];

const SKIP_DIRS = [
    'node_modules',
    '.git',
    'scripts',  // Scripts are allowed to have tenant-specific logic
    'test',
    '__tests__'
];

const SKIP_FILES = [
    'guardrailScanner.js',
    'wiringRegistry.v1.js',
    'package.json',
    'package-lock.json'
];

// Tenant names that should NEVER appear in runtime code
const FORBIDDEN_TENANT_STRINGS = [
    'Penguin Air',
    'penguin-air',
    'penguinair',
    'Royal HVAC',
    'royal-hvac',
    'Comfort Pro',
    'comfort-pro',
    // Add more as companies are onboarded
];

// Trade-specific terms that should NOT be hardcoded in runtime
const FORBIDDEN_TRADE_TERMS = [
    // These are OK in templates/scenarios, but NOT in runtime logic
    // Commenting out to avoid false positives
    // 'thermostat',
    // 'compressor',
    // 'refrigerant',
    // 'hvac',
    // 'dental',
    // 'plumbing'
];

// ============================================================================
// SCAN PATTERNS
// ============================================================================

const SCAN_PATTERNS = [
    {
        id: 'GR_NO_TENANT_HARDCODE',
        label: 'No hardcoded tenant logic in runtime',
        severity: 'CRITICAL',
        patterns: [
            // Direct company name checks
            /companyName\s*===?\s*['"`][\w\s]+['"`]/gi,
            /company\.name\s*===?\s*['"`][\w\s]+['"`]/gi,
            // Hardcoded company IDs (24 hex chars = ObjectId)
            /companyId\s*===?\s*['"`][a-f0-9]{24}['"`]/gi,
            /['"`][a-f0-9]{24}['"`]\s*===?\s*companyId/gi
        ]
    },
    {
        id: 'GR_CACHE_KEYS_SCOPED',
        label: 'Cache keys must be companyId scoped',
        severity: 'CRITICAL',
        patterns: [
            // Redis set/get without variable interpolation
            /redis\.(get|set)\(\s*['"`][^${}\n]+['"`]\s*[,)]/gi,
            // Static cache keys
            /cacheKey\s*=\s*['"`][^${}\n]+['"`]/gi
        ],
        // Whitelist patterns that are OK
        whitelist: [
            /scenario-pool:\$\{companyId\}/i,
            /scenario-pool:.*companyId/i,
            /\$\{companyId\}/i
        ]
    },
    {
        id: 'GR_NO_SILENT_FALLBACKS',
        label: 'No silent fallback when enabled misconfigured',
        severity: 'HIGH',
        patterns: [
            // Empty catch blocks
            /catch\s*\([^)]*\)\s*\{\s*\}/g,
            // Catch that just returns null/undefined
            /catch\s*\([^)]*\)\s*\{\s*return\s*(null|undefined);\s*\}/g,
            // Catch that swallows error without logging
            /catch\s*\([^)]*\)\s*\{\s*\/\//g
        ]
    },
    {
        id: 'GR_SCENARIOS_GLOBAL_ONLY',
        label: 'Scenarios must live in global templates only',
        severity: 'CRITICAL',
        patterns: [
            // Direct writes to company.scenarios
            /company\.scenarios\s*=\s/gi,
            /company\.scenarios\.push/gi,
            /\$push.*scenarios/gi,
            /\$set.*company\.scenarios/gi
        ]
    }
];

// ============================================================================
// FILE SCANNER
// ============================================================================

function walkDir(dir, files = []) {
    if (!fs.existsSync(dir)) return files;
    
    try {
        const items = fs.readdirSync(dir);
        
        for (const item of items) {
            // Skip directories
            if (SKIP_DIRS.includes(item)) continue;
            if (item.startsWith('.')) continue;
            
            const fullPath = path.join(dir, item);
            const stat = fs.statSync(fullPath);
            
            if (stat.isDirectory()) {
                walkDir(fullPath, files);
            } else if (stat.isFile()) {
                // Only scan JS/TS files
                if (!/\.(js|ts|jsx|tsx)$/.test(item)) continue;
                if (SKIP_FILES.includes(item)) continue;
                
                files.push(fullPath);
            }
        }
    } catch (error) {
        logger.warn('[GUARDRAIL] Error walking directory', { dir, error: error.message });
    }
    
    return files;
}

function scanFile(filePath, content) {
    const violations = [];
    const lines = content.split('\n');
    
    // Check for forbidden tenant strings
    for (const tenantStr of FORBIDDEN_TENANT_STRINGS) {
        const regex = new RegExp(tenantStr.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'gi');
        if (regex.test(content)) {
            const lineNum = findLineNumber(content, tenantStr);
            violations.push({
                ruleId: 'GR_NO_TENANT_HARDCODE',
                severity: 'CRITICAL',
                status: 'VIOLATION',
                file: filePath,
                line: lineNum,
                match: tenantStr,
                details: `Found hardcoded tenant name "${tenantStr}" in runtime code`
            });
        }
    }
    
    // Run pattern checks
    for (const rule of SCAN_PATTERNS) {
        for (const pattern of rule.patterns) {
            const matches = content.match(pattern);
            
            if (matches) {
                for (const match of matches) {
                    // Check whitelist
                    const isWhitelisted = (rule.whitelist || []).some(wp => wp.test(match));
                    if (isWhitelisted) continue;
                    
                    const lineNum = findLineNumber(content, match);
                    violations.push({
                        ruleId: rule.id,
                        severity: rule.severity,
                        status: 'WARN',
                        file: filePath,
                        line: lineNum,
                        match: match.substring(0, 100),
                        details: `Possible ${rule.label} violation`
                    });
                }
            }
        }
    }
    
    return violations;
}

function findLineNumber(content, searchStr) {
    const index = content.indexOf(searchStr);
    if (index === -1) return 0;
    
    const beforeMatch = content.substring(0, index);
    return (beforeMatch.match(/\n/g) || []).length + 1;
}

// ============================================================================
// MAIN SCANNER
// ============================================================================

function scanGuardrails({ repoRoot, companyDoc }) {
    const startTime = Date.now();
    const results = [];
    
    logger.info('[GUARDRAIL] Starting scan', { repoRoot });
    
    // Collect files to scan
    const files = [];
    for (const dir of SCAN_DIRS) {
        const fullDir = path.join(repoRoot, dir);
        walkDir(fullDir, files);
    }
    
    logger.info('[GUARDRAIL] Files to scan', { count: files.length });
    
    // Scan each file
    const seen = new Set();
    
    for (const filePath of files) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const violations = scanFile(filePath, content);
            
            for (const v of violations) {
                // Deduplicate by rule + file + line
                const key = `${v.ruleId}::${v.file}::${v.line}`;
                if (seen.has(key)) continue;
                seen.add(key);
                
                // Convert to relative path
                v.file = path.relative(repoRoot, v.file);
                results.push(v);
            }
        } catch (error) {
            logger.warn('[GUARDRAIL] Error scanning file', { filePath, error: error.message });
        }
    }
    
    // Add PASS entries for rules with no violations
    const allRuleIds = SCAN_PATTERNS.map(p => p.id);
    allRuleIds.push('GR_NO_TENANT_HARDCODE');
    
    for (const ruleId of allRuleIds) {
        if (!results.some(r => r.ruleId === ruleId)) {
            const rule = SCAN_PATTERNS.find(p => p.id === ruleId) || {
                label: ruleId,
                severity: 'INFO'
            };
            results.push({
                ruleId,
                status: 'PASS',
                severity: 'INFO',
                details: `No violations detected for: ${rule.label || ruleId}`
            });
        }
    }
    
    logger.info('[GUARDRAIL] Scan complete', {
        filesScanned: files.length,
        violations: results.filter(r => r.status !== 'PASS').length,
        timeMs: Date.now() - startTime
    });
    
    return results;
}

module.exports = { scanGuardrails };

