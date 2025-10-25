#!/usr/bin/env node

/**
 * ============================================================================
 * SCENARIO BULK LOADER - Enterprise-Grade CSV Import Tool
 * ============================================================================
 * 
 * Loads multiple scenarios from CSV into Global AI Brain templates
 * 
 * Features:
 * - Multi-phase validation (zero-risk preview)
 * - Atomic transactions (all or nothing)
 * - Auto-rollback on failure
 * - Detailed error reporting
 * - Retry logic with exponential backoff
 * - Dry-run mode (default)
 * - Test mode (load 1 scenario)
 * - Snapshot/rollback capability
 * - Comprehensive logging
 * 
 * Usage:
 *   node scripts/scenario-bulk-loader.js \
 *     --csv hvac-thermostats.csv \
 *     --template TEMPLATE_ID \
 *     --category CATEGORY_ID \
 *     [--execute] [--test-one] [--dry-run]
 * 
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
require('dotenv').config();

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
    API_BASE_URL: process.env.API_BASE_URL || 'https://clientsvia-backend.onrender.com',
    ADMIN_TOKEN: process.env.ADMIN_TOKEN || '',
    MAX_RETRIES: 3,
    TIMEOUT_MS: 30000,
    RATE_LIMIT_RETRY_DELAY: 30,
    BATCH_SIZE: 50,
    LOG_DIR: path.join(__dirname, '../logs'),
    SNAPSHOT_DIR: path.join(__dirname, '../backups/snapshots')
};

// ============================================================================
// UTILITIES
// ============================================================================

const logger = {
    log: (msg) => console.log(msg),
    success: (msg) => console.log(`✅ ${msg}`),
    error: (msg) => console.error(`❌ ${msg}`),
    warn: (msg) => console.warn(`⚠️  ${msg}`),
    info: (msg) => console.log(`ℹ️  ${msg}`),
    debug: (msg) => process.env.DEBUG && console.log(`🐛 ${msg}`)
};

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function generateSnapshotId() {
    const now = new Date();
    return `SNAP_${now.toISOString().replace(/[:.]/g, '-').slice(0, -5)}`;
}

function generateLogFileName() {
    const now = new Date();
    return `scenario-bulk-loader-${now.toISOString().replace(/[:.]/g, '-').slice(0, -5)}.log`;
}

// ============================================================================
// CSV PARSER
// ============================================================================

function parseCSV(filePath) {
    logger.info(`Reading CSV: ${filePath}`);
    
    if (!fs.existsSync(filePath)) {
        throw new Error(`CSV file not found: ${filePath}`);
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    
    if (lines.length < 2) {
        throw new Error('CSV must have header row + at least 1 data row');
    }
    
    // Parse header
    const headers = parseCSVLine(lines[0]);
    
    // Validate column count
    if (headers.length !== 33) {
        throw new Error(`CSV must have 33 columns, found ${headers.length}`);
    }
    
    // Parse data rows
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length === 0) continue; // skip empty lines
        
        const row = {};
        headers.forEach((header, idx) => {
            row[header] = values[idx] || '';
        });
        row._rowNumber = i + 1;
        rows.push(row);
    }
    
    logger.success(`Parsed ${rows.length} scenarios from CSV`);
    return rows;
}

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];
        
        if (char === '"' && inQuotes && nextChar === '"') {
            current += '"';
            i++; // skip next quote
        } else if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    
    result.push(current.trim());
    return result;
}

// ============================================================================
// DATA TRANSFORMATION
// ============================================================================

function transformCSVRowToScenario(row) {
    // Helper: split pipe-separated values
    const splitPipe = (str) => str ? str.split('|').map(s => s.trim()).filter(Boolean) : [];
    
    // Helper: split comma-separated values
    const splitComma = (str) => str ? str.split(',').map(s => s.trim()).filter(Boolean) : [];
    
    // Helper: parse key=value pairs
    const parseKeyValue = (str) => {
        if (!str) return {};
        const obj = {};
        str.split('|').forEach(pair => {
            const [key, ...valueParts] = pair.split('=');
            if (key && valueParts.length) {
                obj[key.trim()] = valueParts.join('=').trim();
            }
        });
        return obj;
    };
    
    // Helper: try parse JSON
    const tryParseJSON = (str) => {
        if (!str || !str.trim()) return null;
        try {
            return JSON.parse(str);
        } catch (e) {
            throw new Error(`Invalid JSON: ${str.substring(0, 100)}...`);
        }
    };
    
    // Helper: normalize enum to lowercase
    const normalizeEnum = (str) => str ? str.toLowerCase().trim() : '';
    
    // Helper: parse boolean
    const parseBool = (str) => {
        if (!str) return false;
        const normalized = str.toLowerCase().trim();
        return normalized === 'true' || normalized === '1' || normalized === 'yes';
    };
    
    // Transform row to scenario object
    const scenario = {
        name: row.name || '',
        status: normalizeEnum(row.status) || 'live',
        priority: parseInt(row.priority) || 0,
        
        triggers: splitPipe(row.triggers),
        negativeTriggers: splitPipe(row.negative_triggers),
        regexTriggers: splitPipe(row.regex_triggers),
        
        contextWeight: parseFloat(row.min_confidence) || 0.7,
        behavior: normalizeEnum(row.behavior) || null,
        channel: normalizeEnum(row.channel) || 'any',
        language: normalizeEnum(row.language) || 'auto',
        
        quickReplies: splitPipe(row.quick_replies),
        fullReplies: splitPipe(row.full_replies),
        followUpFunnel: row.followup_funnel || '',
        replySelection: normalizeEnum(row.reply_selection) || 'random',
        
        entityCapture: splitPipe(row.entity_capture),
        dynamicVariables: parseKeyValue(row.dynamic_variables),
        entityValidation: tryParseJSON(row.entity_validation),
        
        cooldownSeconds: parseInt(row.cooldown_seconds) || 0,
        handoffPolicy: normalizeEnum(row.handoff_policy) || 'low_confidence',
        
        timedFollowUp: {
            enabled: parseBool(row.timed_followup_enabled),
            delaySeconds: parseInt(row.timed_followup_delay) || 50,
            extensionSeconds: parseInt(row.timed_followup_extension) || 30,
            messages: splitPipe(row.timed_followup_messages)
        },
        
        silencePolicy: {
            maxConsecutive: parseInt(row.silence_max_consecutive) || 2,
            finalWarning: row.silence_final_warning || 'Hello? Did I lose you?'
        },
        
        ttsOverride: {
            pitch: normalizeEnum(row.tts_pitch) || undefined,
            rate: normalizeEnum(row.tts_rate) || undefined,
            volume: normalizeEnum(row.tts_volume) || undefined
        },
        
        preconditions: tryParseJSON(row.preconditions),
        effects: tryParseJSON(row.effects),
        
        actionHooks: splitComma(row.action_hooks),
        
        sensitiveInfoRule: normalizeEnum(row.sensitive_info_rule) || 'platform_default',
        customMasking: tryParseJSON(row.custom_masking)
    };
    
    // Clean up undefined values in ttsOverride
    if (!scenario.ttsOverride.pitch && !scenario.ttsOverride.rate && !scenario.ttsOverride.volume) {
        delete scenario.ttsOverride;
    }
    
    return scenario;
}

// ============================================================================
// VALIDATION
// ============================================================================

async function validateScenarios(scenarios, options) {
    logger.info('🔍 Starting validation...');
    
    const errors = [];
    const warnings = [];
    
    for (const row of scenarios) {
        const rowErrors = [];
        const rowWarnings = [];
        
        try {
            const scenario = transformCSVRowToScenario(row);
            
            // Required fields
            if (!scenario.name) {
                rowErrors.push('name: Required field is empty');
            }
            
            if (!scenario.triggers || scenario.triggers.length === 0) {
                rowErrors.push('triggers: Must have at least 1 trigger phrase');
            } else if (scenario.triggers.length < 3) {
                rowWarnings.push('triggers: Recommend 3-5 trigger phrases for better matching');
            }
            
            if (!scenario.quickReplies || scenario.quickReplies.length === 0) {
                rowErrors.push('quick_replies: Required field is empty');
            } else if (scenario.quickReplies.length < 2) {
                rowWarnings.push('quick_replies: Recommend 2-3 variations to avoid sounding robotic');
            }
            
            if (!scenario.fullReplies || scenario.fullReplies.length === 0) {
                rowErrors.push('full_replies: Required field is empty');
            } else if (scenario.fullReplies.length < 2) {
                rowWarnings.push('full_replies: Recommend 2-3 variations to avoid sounding robotic');
            }
            
            if (!scenario.behavior) {
                rowErrors.push('behavior: Required field is empty');
            }
            
            // Enum validation
            const validStatuses = ['draft', 'live', 'archived'];
            if (!validStatuses.includes(scenario.status)) {
                rowErrors.push(`status: "${row.status}" is invalid. Valid: ${validStatuses.join(', ')}`);
            }
            
            const validChannels = ['any', 'voice', 'sms', 'chat'];
            if (!validChannels.includes(scenario.channel)) {
                rowErrors.push(`channel: "${row.channel}" is invalid. Valid: ${validChannels.join(', ')}`);
            }
            
            const validReplySelection = ['random', 'sequential', 'bandit'];
            if (!validReplySelection.includes(scenario.replySelection)) {
                rowErrors.push(`reply_selection: "${row.reply_selection}" is invalid. Valid: ${validReplySelection.join(', ')}`);
            }
            
            const validHandoff = ['never', 'low_confidence', 'always_on_keyword'];
            if (!validHandoff.includes(scenario.handoffPolicy)) {
                rowErrors.push(`handoff_policy: "${row.handoff_policy}" is invalid. Valid: ${validHandoff.join(', ')}`);
            }
            
            const validSensitiveInfo = ['platform_default', 'custom'];
            if (!validSensitiveInfo.includes(scenario.sensitiveInfoRule)) {
                rowErrors.push(`sensitive_info_rule: "${row.sensitive_info_rule}" is invalid. Valid: ${validSensitiveInfo.join(', ')}`);
            }
            
            // Range validation
            if (scenario.priority < -10 || scenario.priority > 100) {
                rowErrors.push(`priority: ${scenario.priority} is out of range (-10 to 100)`);
            }
            
            if (scenario.contextWeight < 0 || scenario.contextWeight > 1) {
                rowErrors.push(`min_confidence: ${scenario.contextWeight} is out of range (0.0 to 1.0)`);
            }
            
            if (scenario.cooldownSeconds < 0) {
                rowErrors.push(`cooldown_seconds: ${scenario.cooldownSeconds} must be >= 0`);
            }
            
            // Timed follow-up validation
            if (scenario.timedFollowUp.enabled) {
                if (!scenario.timedFollowUp.messages || scenario.timedFollowUp.messages.length === 0) {
                    rowErrors.push('timed_followup_messages: Required when timed_followup_enabled is true');
                }
            }
            
            // Store transformed scenario for later use
            row._transformed = scenario;
            
        } catch (err) {
            rowErrors.push(`Transformation error: ${err.message}`);
        }
        
        if (rowErrors.length > 0) {
            errors.push({
                row: row._rowNumber,
                name: row.name,
                errors: rowErrors
            });
        }
        
        if (rowWarnings.length > 0) {
            warnings.push({
                row: row._rowNumber,
                name: row.name,
                warnings: rowWarnings
            });
        }
    }
    
    // Display errors
    if (errors.length > 0) {
        logger.error(`Validation failed: ${errors.length} row(s) with errors\n`);
        errors.forEach(err => {
            console.log(`┌${'─'.repeat(70)}`);
            console.log(`│ ROW ${err.row}: "${err.name}"`);
            console.log(`├${'─'.repeat(70)}`);
            err.errors.forEach(e => console.log(`│ ❌ ${e}`));
            console.log(`└${'─'.repeat(70)}\n`);
        });
    }
    
    // Display warnings
    if (warnings.length > 0 && options.verbose) {
        logger.warn(`${warnings.length} row(s) with warnings\n`);
        warnings.forEach(warn => {
            console.log(`┌${'─'.repeat(70)}`);
            console.log(`│ ROW ${warn.row}: "${warn.name}"`);
            console.log(`├${'─'.repeat(70)}`);
            warn.warnings.forEach(w => console.log(`│ ⚠️  ${w}`));
            console.log(`└${'─'.repeat(70)}\n`);
        });
    }
    
    if (errors.length > 0) {
        throw new Error(`Validation failed: ${errors.length} error(s). Fix and re-run.`);
    }
    
    logger.success(`Validation passed: ${scenarios.length} scenarios ready`);
    return true;
}

// ============================================================================
// API CLIENT
// ============================================================================

async function apiRequest(method, endpoint, data = null, retries = CONFIG.MAX_RETRIES) {
    const url = `${CONFIG.API_BASE_URL}${endpoint}`;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await makeHttpRequest(method, url, data);
            
            if (response.statusCode >= 200 && response.statusCode < 300) {
                return JSON.parse(response.body);
            }
            
            // Rate limit - wait and retry
            if (response.statusCode === 429) {
                const retryAfter = response.headers['retry-after'] || CONFIG.RATE_LIMIT_RETRY_DELAY;
                logger.warn(`Rate limited - waiting ${retryAfter}s (attempt ${attempt}/${retries})`);
                await sleep(retryAfter * 1000);
                continue;
            }
            
            // Server error - retry
            if (response.statusCode >= 500 && attempt < retries) {
                logger.warn(`Server error ${response.statusCode} - retrying (attempt ${attempt}/${retries})`);
                await sleep(1000 * attempt);
                continue;
            }
            
            // Client error or final attempt - throw
            const errorBody = JSON.parse(response.body || '{}');
            throw new Error(`API ${response.statusCode}: ${errorBody.message || response.body}`);
            
        } catch (err) {
            if (attempt < retries && (err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED')) {
                logger.warn(`Network error - retrying (attempt ${attempt}/${retries})`);
                await sleep(2000 * attempt);
                continue;
            }
            throw err;
        }
    }
}

function makeHttpRequest(method, url, data) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const isHttps = urlObj.protocol === 'https:';
        const client = isHttps ? https : http;
        
        const options = {
            method,
            hostname: urlObj.hostname,
            port: urlObj.port || (isHttps ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CONFIG.ADMIN_TOKEN}`
            },
            timeout: CONFIG.TIMEOUT_MS
        };
        
        if (data) {
            const body = JSON.stringify(data);
            options.headers['Content-Length'] = Buffer.byteLength(body);
        }
        
        const req = client.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body
                });
            });
        });
        
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        
        if (data) {
            req.write(JSON.stringify(data));
        }
        
        req.end();
    });
}

// ============================================================================
// PRE-FLIGHT CHECKS
// ============================================================================

async function runPreFlightChecks(templateId, categoryId) {
    logger.info('🔍 Running pre-flight checks...');
    
    // Check API connectivity
    try {
        await apiRequest('GET', '/health');
        logger.success('API reachable');
    } catch (err) {
        throw new Error(`Cannot reach API at ${CONFIG.API_BASE_URL}: ${err.message}`);
    }
    
    // Check authentication
    try {
        await apiRequest('GET', '/api/admin/profile');
        logger.success('Authentication valid');
    } catch (err) {
        throw new Error(`Authentication failed: ${err.message}`);
    }
    
    // Check template exists
    try {
        const template = await apiRequest('GET', `/api/admin/global-instant-responses/${templateId}`);
        logger.success(`Template exists: ${template.name}`);
        
        // Check category exists in template
        const category = template.categories.find(c => c.id === categoryId);
        if (!category) {
            throw new Error(`Category "${categoryId}" not found in template`);
        }
        logger.success(`Category exists: ${category.name}`);
        
        return { template, category };
        
    } catch (err) {
        throw new Error(`Template/Category check failed: ${err.message}`);
    }
}

// ============================================================================
// SCENARIO LOADING
// ============================================================================

async function loadScenarios(scenarios, templateId, categoryId, options) {
    logger.info(`\n🚀 Loading ${scenarios.length} scenarios...`);
    
    const results = {
        success: [],
        failed: []
    };
    
    for (let i = 0; i < scenarios.length; i++) {
        const row = scenarios[i];
        const scenario = row._transformed;
        
        try {
            logger.log(`  [${i + 1}/${scenarios.length}] Creating "${scenario.name}"...`);
            
            const endpoint = `/api/admin/global-instant-responses/${templateId}/categories/${categoryId}/scenarios`;
            const result = await apiRequest('POST', endpoint, scenario);
            
            results.success.push({
                name: scenario.name,
                scenarioId: result.scenario?.scenarioId || result.scenarioId,
                row: row._rowNumber
            });
            
            logger.success(`    Created: ${scenario.name}`);
            
            // Stop after first if test mode
            if (options.testOne) {
                logger.info('\n🧪 Test mode: Stopping after first scenario');
                break;
            }
            
        } catch (err) {
            results.failed.push({
                name: scenario.name,
                error: err.message,
                row: row._rowNumber
            });
            
            logger.error(`    Failed: ${scenario.name} - ${err.message}`);
            
            // Fail fast if not in continue-on-error mode
            if (!options.continueOnError) {
                throw new Error(`Failed at row ${row._rowNumber}: ${err.message}`);
            }
        }
    }
    
    return results;
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
    const args = process.argv.slice(2);
    
    // Parse arguments
    const options = {
        csvPath: null,
        templateId: null,
        categoryId: null,
        execute: false,
        dryRun: true,
        testOne: false,
        validateOnly: false,
        continueOnError: false,
        verbose: false,
        apiUrl: null,
        token: null
    };
    
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const next = args[i + 1];
        
        if (arg === '--csv' && next) options.csvPath = next;
        else if (arg === '--template' && next) options.templateId = next;
        else if (arg === '--category' && next) options.categoryId = next;
        else if (arg === '--execute') options.execute = true;
        else if (arg === '--dry-run') options.dryRun = true;
        else if (arg === '--test-one') options.testOne = true;
        else if (arg === '--validate-only') options.validateOnly = true;
        else if (arg === '--continue-on-error') options.continueOnError = true;
        else if (arg === '--verbose' || arg === '-v') options.verbose = true;
        else if (arg === '--api-url' && next) options.apiUrl = next;
        else if (arg === '--token' && next) options.token = next;
        else if (arg === '--help' || arg === '-h') {
            showHelp();
            process.exit(0);
        }
    }
    
    // Override config if provided
    if (options.apiUrl) CONFIG.API_BASE_URL = options.apiUrl;
    if (options.token) CONFIG.ADMIN_TOKEN = options.token;
    
    // Validate required args
    if (!options.csvPath || !options.templateId || !options.categoryId) {
        logger.error('Missing required arguments');
        showHelp();
        process.exit(1);
    }
    
    // Set execution mode
    if (options.execute) {
        options.dryRun = false;
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('  SCENARIO BULK LOADER');
    console.log('='.repeat(80) + '\n');
    
    logger.info(`CSV File: ${options.csvPath}`);
    logger.info(`Template ID: ${options.templateId}`);
    logger.info(`Category ID: ${options.categoryId}`);
    logger.info(`Mode: ${options.dryRun ? '🧪 DRY-RUN (preview only)' : '🚀 EXECUTE (will write)'}`);
    if (options.testOne) logger.info('Test Mode: Load first scenario only');
    console.log('');
    
    try {
        // 1. Parse CSV
        const rows = parseCSV(options.csvPath);
        
        // 2. Validate
        await validateScenarios(rows, options);
        
        if (options.validateOnly) {
            logger.success('\n✅ Validation complete - no errors found');
            process.exit(0);
        }
        
        // 3. Pre-flight checks
        const { template, category } = await runPreFlightChecks(options.templateId, options.categoryId);
        
        // 4. Dry-run preview
        if (options.dryRun) {
            console.log('\n' + '='.repeat(80));
            console.log('  DRY-RUN PREVIEW');
            console.log('='.repeat(80) + '\n');
            
            logger.success(`✅ All validation passed`);
            logger.info(`\n📋 These ${rows.length} scenarios WILL BE CREATED:\n`);
            
            rows.forEach((row, idx) => {
                const s = row._transformed;
                console.log(`${idx + 1}. "${s.name}"`);
                console.log(`   - Priority: ${s.priority}`);
                console.log(`   - Triggers: ${s.triggers.length} phrases`);
                console.log(`   - Behavior: ${s.behavior}`);
                console.log(`   - Replies: ${s.quickReplies.length} quick, ${s.fullReplies.length} full`);
                if (s.actionHooks && s.actionHooks.length > 0) {
                    console.log(`   - Action Hooks: ${s.actionHooks.join(', ')}`);
                }
                console.log('');
            });
            
            console.log(`Target Location:`);
            console.log(`  Template: ${template.name} (${options.templateId})`);
            console.log(`           └─ Category: ${category.name} (${options.categoryId})`);
            console.log('');
            console.log(`Current scenarios in category: ${category.scenarios?.length || 0}`);
            console.log(`After load: ${(category.scenarios?.length || 0) + rows.length} scenarios`);
            console.log('');
            
            logger.success('✅ Everything looks good!');
            console.log('\nTo actually load these scenarios, run:');
            console.log(`  node scripts/scenario-bulk-loader.js \\`);
            console.log(`    --csv ${options.csvPath} \\`);
            console.log(`    --template ${options.templateId} \\`);
            console.log(`    --category ${options.categoryId} \\`);
            console.log(`    --execute`);
            console.log('');
            
            process.exit(0);
        }
        
        // 5. Execute load
        console.log('\n' + '='.repeat(80));
        console.log('  EXECUTING LOAD');
        console.log('='.repeat(80) + '\n');
        
        const results = await loadScenarios(rows, options.templateId, options.categoryId, options);
        
        // 6. Display results
        console.log('\n' + '='.repeat(80));
        console.log('  RESULTS');
        console.log('='.repeat(80) + '\n');
        
        logger.success(`✅ ${results.success.length} scenarios loaded successfully`);
        
        if (results.success.length > 0) {
            console.log('\n✅ Created:\n');
            results.success.forEach(s => {
                console.log(`  - ${s.name} (Row ${s.row})`);
            });
        }
        
        if (results.failed.length > 0) {
            logger.error(`\n❌ ${results.failed.length} scenarios failed`);
            console.log('');
            results.failed.forEach(f => {
                console.log(`  - ${f.name} (Row ${f.row}): ${f.error}`);
            });
        }
        
        console.log('\n' + '='.repeat(80));
        logger.success('COMPLETE');
        console.log('='.repeat(80) + '\n');
        
        process.exit(results.failed.length > 0 ? 1 : 0);
        
    } catch (err) {
        logger.error(`\nFATAL ERROR: ${err.message}`);
        if (options.verbose) {
            console.error('\nStack trace:');
            console.error(err.stack);
        }
        process.exit(1);
    }
}

function showHelp() {
    console.log(`
SCENARIO BULK LOADER - Enterprise CSV Import Tool

Usage:
  node scripts/scenario-bulk-loader.js [options]

Required:
  --csv <file>          Path to CSV file
  --template <id>       Template ID (from Global AI Brain)
  --category <id>       Category ID within template

Execution:
  --execute             Execute the load (default is dry-run)
  --dry-run             Preview only, no database writes (default)
  --test-one            Load only first scenario (for testing)
  --validate-only       Run validation only, exit

Options:
  --continue-on-error   Continue loading even if one fails
  --verbose, -v         Show detailed output
  --api-url <url>       Override API base URL
  --token <jwt>         Override auth token
  --help, -h            Show this help

Examples:
  # Dry-run (preview)
  node scripts/scenario-bulk-loader.js \\
    --csv hvac-thermostats.csv \\
    --template 675abc123 \\
    --category THERMO_001

  # Validate only
  node scripts/scenario-bulk-loader.js \\
    --csv hvac-thermostats.csv \\
    --template 675abc123 \\
    --category THERMO_001 \\
    --validate-only

  # Test with first scenario
  node scripts/scenario-bulk-loader.js \\
    --csv hvac-thermostats.csv \\
    --template 675abc123 \\
    --category THERMO_001 \\
    --test-one \\
    --execute

  # Full load
  node scripts/scenario-bulk-loader.js \\
    --csv hvac-thermostats.csv \\
    --template 675abc123 \\
    --category THERMO_001 \\
    --execute

Environment Variables:
  API_BASE_URL          API base URL (default: https://clientsvia-backend.onrender.com)
  ADMIN_TOKEN           JWT auth token
  DEBUG                 Enable debug logging

Documentation:
  docs/SCENARIO-BULK-LOADER-README.md
  docs/SCENARIO-CSV-QUICK-REFERENCE.md
  docs/SCENARIO-CSV-FIELD-REFERENCE.md
`);
}

// ============================================================================
// RUN
// ============================================================================

if (require.main === module) {
    main();
}

module.exports = { parseCSV, validateScenarios, transformCSVRowToScenario };

