/**
 * ============================================================================
 * WIRING COMPLIANCE CHECKER
 * ============================================================================
 * 
 * Detects hardcoded values that should come from the wiring system.
 * 
 * PURPOSE:
 * - Catch "drift" where developers add hardcoded text instead of reading config
 * - Verify runtime behavior matches wiring registry
 * - Provide actionable reports on compliance violations
 * 
 * USAGE:
 * - Run manually: node services/wiring/WiringComplianceChecker.js
 * - API endpoint: GET /api/admin/wiring-status/:companyId/compliance
 * - Called by wiring report generator for health checks
 * 
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// PATTERNS TO DETECT
// These are string patterns that MUST come from config, not hardcode
// ============================================================================

const HARDCODE_PATTERNS = [
    // Booking prompts - MUST come from bookingSlots[].question or sub-fields
    {
        id: 'BOOKING_NAME_PROMPT',
        pattern: /["'`](what'?s your (first |last )?name|may i have your name|and your last name|what's your first name)["'`]/gi,
        shouldComeFrom: 'bookingSlots[].question OR bookingSlots[].lastNameQuestion/firstNameQuestion',
        severity: 'HIGH',
        allowedFiles: ['wiringTiers.js', 'v2Company.js', 'runtimeReaders.map.js'] // Schema/registry files OK
    },
    {
        id: 'BOOKING_PHONE_PROMPT',
        pattern: /["'`](what'?s (the best |your )?phone|area code|rest of the number|can i get a number)["'`]/gi,
        shouldComeFrom: 'bookingSlots[].question OR bookingSlots[].areaCodePrompt/restOfNumberPrompt',
        severity: 'HIGH',
        allowedFiles: ['wiringTiers.js', 'v2Company.js', 'runtimeReaders.map.js']
    },
    {
        id: 'BOOKING_ADDRESS_PROMPT',
        pattern: /["'`](what'?s (the |your )?(service )?address|full address including city|street address)["'`]/gi,
        shouldComeFrom: 'bookingSlots[].question OR bookingSlots[].partialAddressPrompt/streetBreakdownPrompt',
        severity: 'HIGH',
        allowedFiles: ['wiringTiers.js', 'v2Company.js', 'runtimeReaders.map.js']
    },
    // Fallback responses
    {
        id: 'FALLBACK_GENERIC',
        pattern: /["'`](i didn'?t (quite )?catch that|can you (please )?repeat|could you say that again)["'`]/gi,
        shouldComeFrom: 'fallbackResponses.generic',
        severity: 'MEDIUM',
        allowedFiles: ['wiringTiers.js', 'v2Company.js', 'runtimeReaders.map.js']
    },
    // Escalation messages
    {
        id: 'ESCALATION_MESSAGE',
        pattern: /["'`](let me (connect|transfer) you|transferring you now|one moment while i)["'`]/gi,
        shouldComeFrom: 'escalation.transferMessage',
        severity: 'MEDIUM',
        allowedFiles: ['wiringTiers.js', 'v2Company.js', 'runtimeReaders.map.js']
    },
    // Loop prevention nudges
    {
        id: 'LOOP_NUDGE',
        pattern: /["'`](sure —? go ahead|no problem —? go ahead)["'`]/gi,
        shouldComeFrom: 'loopPrevention.nudge*Prompt',
        severity: 'MEDIUM',
        allowedFiles: ['wiringTiers.js', 'v2Company.js', 'runtimeReaders.map.js']
    },
    // De-escalation responses
    {
        id: 'DEESCALATION_RESPONSE',
        pattern: /["'`](i (completely )?understand your frustration|i'?m (so )?sorry you'?re dealing with)["'`]/gi,
        shouldComeFrom: 'emotions.deescalationResponse OR frustration.response',
        severity: 'MEDIUM',
        allowedFiles: ['wiringTiers.js', 'v2Company.js', 'runtimeReaders.map.js']
    }
];

// Files to scan (relative to project root)
// These are the runtime files that handle AI responses and should read from config
const FILES_TO_SCAN = [
    'services/ConversationEngine.js',
    'services/BookingFlowEngine.js',
    'services/BookingScriptEngine.js',
    'services/ResponseRenderer.js',
    'services/ConversationStateMachine.js',
    'services/v2AIAgentRuntime.js',
    'services/elite-frontline/EliteFrontlineIntelV23.js',
    'services/Tier3LLMFallback.js',
    'services/LowConfidenceHandler.js',
    'services/CheatSheetEngine.js'
];

// ============================================================================
// COMPLIANCE CHECK ENGINE
// ============================================================================

/**
 * Scan a single file for hardcode violations
 */
function scanFile(filePath, projectRoot) {
    const fullPath = path.join(projectRoot, filePath);
    
    if (!fs.existsSync(fullPath)) {
        return { file: filePath, status: 'NOT_FOUND', violations: [] };
    }
    
    const content = fs.readFileSync(fullPath, 'utf8');
    const lines = content.split('\n');
    const violations = [];
    const fileName = path.basename(filePath);
    
    for (const rule of HARDCODE_PATTERNS) {
        // Skip if this file is in the allowed list (schema/registry files)
        if (rule.allowedFiles?.includes(fileName)) {
            continue;
        }
        
        // Check each line
        lines.forEach((line, idx) => {
            const lineNum = idx + 1;
            
            // Skip comments
            if (line.trim().startsWith('//') || line.trim().startsWith('*')) {
                return;
            }
            
            // Skip lines that are reading from config (good pattern)
            if (line.includes('?.') && (
                line.includes('Prompt') ||
                line.includes('Question') ||
                line.includes('Response') ||
                line.includes('Message')
            )) {
                // This looks like config reading: someConfig?.somePrompt
                // Check if it's actually using a fallback after config read
                if (line.includes('||')) {
                    // Pattern: config?.field || "fallback"
                    // This is ACCEPTABLE - fallback is schema default
                    return;
                }
            }
            
            // Check for pattern match
            rule.pattern.lastIndex = 0; // Reset regex
            const match = rule.pattern.exec(line);
            
            if (match) {
                // Check if this is a fallback pattern (acceptable)
                const beforeMatch = line.substring(0, match.index);
                if (beforeMatch.includes('||') || beforeMatch.includes('??')) {
                    // This is after a nullish coalescing - it's a fallback
                    // Still flag but as INFO not violation
                    violations.push({
                        ruleId: rule.id,
                        severity: 'INFO',
                        line: lineNum,
                        column: match.index,
                        matched: match[0],
                        context: line.trim().substring(0, 100),
                        message: `Fallback default found. Ensure it matches schema default in v2Company.js`,
                        shouldComeFrom: rule.shouldComeFrom
                    });
                } else {
                    // Direct hardcode - VIOLATION
                    violations.push({
                        ruleId: rule.id,
                        severity: rule.severity,
                        line: lineNum,
                        column: match.index,
                        matched: match[0],
                        context: line.trim().substring(0, 100),
                        message: `HARDCODE DETECTED: This text should come from config`,
                        shouldComeFrom: rule.shouldComeFrom
                    });
                }
            }
        });
    }
    
    return {
        file: filePath,
        status: violations.length > 0 ? 'VIOLATIONS_FOUND' : 'COMPLIANT',
        violationCount: violations.filter(v => v.severity !== 'INFO').length,
        infoCount: violations.filter(v => v.severity === 'INFO').length,
        violations
    };
}

/**
 * Run full compliance check
 */
function runComplianceCheck(projectRoot = process.cwd()) {
    console.log('[COMPLIANCE] Starting wiring compliance check...');
    console.log('[COMPLIANCE] Project root:', projectRoot);
    
    const results = {
        timestamp: new Date().toISOString(),
        projectRoot,
        summary: {
            filesScanned: 0,
            filesWithViolations: 0,
            totalViolations: 0,
            totalInfos: 0,
            bySeverity: { HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 }
        },
        files: [],
        violations: []
    };
    
    for (const file of FILES_TO_SCAN) {
        const fileResult = scanFile(file, projectRoot);
        results.files.push(fileResult);
        
        if (fileResult.status === 'NOT_FOUND') {
            continue;
        }
        
        results.summary.filesScanned++;
        
        if (fileResult.violationCount > 0) {
            results.summary.filesWithViolations++;
        }
        
        for (const v of fileResult.violations) {
            if (v.severity === 'INFO') {
                results.summary.totalInfos++;
                results.summary.bySeverity.INFO++;
            } else {
                results.summary.totalViolations++;
                results.summary.bySeverity[v.severity]++;
                results.violations.push({
                    ...v,
                    file
                });
            }
        }
    }
    
    // Calculate compliance score
    const maxViolations = FILES_TO_SCAN.length * HARDCODE_PATTERNS.length;
    const violationPenalty = 
        (results.summary.bySeverity.HIGH * 10) +
        (results.summary.bySeverity.MEDIUM * 5) +
        (results.summary.bySeverity.LOW * 2);
    
    results.summary.complianceScore = Math.max(0, 100 - violationPenalty);
    results.summary.status = results.summary.totalViolations === 0 ? 'COMPLIANT' : 'VIOLATIONS_DETECTED';
    
    console.log('[COMPLIANCE] Check complete:', results.summary);
    
    return results;
}

/**
 * Format compliance report as markdown
 */
function formatAsMarkdown(results) {
    const lines = [];
    
    lines.push('# Wiring Compliance Report');
    lines.push('');
    lines.push(`**Generated:** ${results.timestamp}`);
    lines.push(`**Status:** ${results.summary.status}`);
    lines.push(`**Compliance Score:** ${results.summary.complianceScore}%`);
    lines.push('');
    
    lines.push('## Summary');
    lines.push(`- Files Scanned: ${results.summary.filesScanned}`);
    lines.push(`- Files with Violations: ${results.summary.filesWithViolations}`);
    lines.push(`- Total Violations: ${results.summary.totalViolations}`);
    lines.push(`- Fallback Infos: ${results.summary.totalInfos}`);
    lines.push('');
    
    if (results.violations.length > 0) {
        lines.push('## Violations');
        lines.push('');
        lines.push('| File | Line | Severity | Rule | Message |');
        lines.push('|------|------|----------|------|---------|');
        
        for (const v of results.violations) {
            lines.push(`| ${v.file} | ${v.line} | ${v.severity} | ${v.ruleId} | ${v.message} |`);
        }
        lines.push('');
        
        lines.push('### Fix Instructions');
        lines.push('');
        for (const v of results.violations) {
            lines.push(`**${v.file}:${v.line}** - \`${v.matched}\``);
            lines.push(`  → Should come from: \`${v.shouldComeFrom}\``);
            lines.push(`  → Context: \`${v.context}\``);
            lines.push('');
        }
    } else {
        lines.push('## ✅ All Clear!');
        lines.push('');
        lines.push('No hardcode violations detected. All config values are properly wired.');
    }
    
    return lines.join('\n');
}

// ============================================================================
// EXPORTS & CLI
// ============================================================================

module.exports = {
    runComplianceCheck,
    scanFile,
    formatAsMarkdown,
    HARDCODE_PATTERNS,
    FILES_TO_SCAN
};

// Run from CLI
if (require.main === module) {
    const projectRoot = path.resolve(__dirname, '../..');
    const results = runComplianceCheck(projectRoot);
    
    console.log('\n' + '='.repeat(60));
    console.log(formatAsMarkdown(results));
    console.log('='.repeat(60) + '\n');
    
    // Exit with error code if violations found
    process.exit(results.summary.totalViolations > 0 ? 1 : 0);
}

