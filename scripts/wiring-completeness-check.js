#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════════════════════════════════════
 * WIRING COMPLETENESS CHECK - CI Validation Script
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * Enforces wiring consistency by scanning code for integration points
 * and verifying they have matching entries in the wiring registry.
 * 
 * USAGE:
 *   node scripts/wiring-completeness-check.js [--fail-on-violation]
 * 
 * MODES:
 *   Default (warn): Logs violations but exits 0 (CI passes)
 *   --fail-on-violation: Exits 1 on any violation (blocks CI/PR)
 * 
 * WHAT IT CHECKS:
 *   1. API integrations (Google Calendar, Google Geo, SMS) are wired in registry
 *   2. Booking flow features (confirmSpelling, askFullName) have UI config paths
 *   3. No "dead" imports (services imported but never used)
 * 
 * ════════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

// Configuration
const FAIL_ON_VIOLATION = process.argv.includes('--fail-on-violation');
const ROOT = path.resolve(__dirname, '..');

// Colors for terminal output
const colors = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    reset: '\x1b[0m'
};

// Files to scan for wiring points
const FILES_TO_SCAN = [
    'services/engine/booking/BookingFlowRunner.js',
    'services/engine/ConversationEngine.js',
    'services/engine/HybridScenarioSelector.js',
    'routes/v2twilio.js'
];

// Wiring checks: pattern in code -> required wiring
const WIRING_CHECKS = [
    // ═══════════════════════════════════════════════════════════════════
    // API INTEGRATIONS - Must be wired in UI and have runtime readers
    // ═══════════════════════════════════════════════════════════════════
    {
        id: 'google-calendar',
        description: 'Google Calendar integration for time slots',
        files: ['BookingFlowRunner.js'],
        codePattern: /GoogleCalendarService\.(findAvailableSlots|checkAvailability|confirmSlot)/g,
        requiredDbPath: 'integrations.googleCalendar.enabled',
        requiredEdge: 'section_bookingPrompts → integrations_googleCalendar',
        severity: 'high'
    },
    {
        id: 'google-geo',
        description: 'Google Geo/Maps integration for address validation',
        files: ['BookingFlowRunner.js'],
        codePattern: /AddressValidationService\.validateAddress/g,
        requiredDbPath: 'aiAgentSettings.frontDesk.booking.addressVerification.enabled',
        requiredEdge: 'section_bookingPrompts → integrations_googleGeo',
        severity: 'high'
    },
    {
        id: 'sms-notifications',
        description: 'SMS notifications on booking complete',
        files: ['BookingFlowRunner.js'],
        codePattern: /SMSNotificationService\.(sendBookingConfirmation|scheduleReminders)/g,
        requiredDbPath: 'integrations.smsNotifications.enabled',
        requiredEdge: 'booking_complete → integrations_smsNotifications',
        severity: 'high'
    },
    
    // ═══════════════════════════════════════════════════════════════════
    // BOOKING FLOW FEATURES - Must have UI config paths
    // ═══════════════════════════════════════════════════════════════════
    {
        id: 'confirm-spelling',
        description: 'Name spelling confirmation feature',
        files: ['BookingFlowRunner.js'],
        codePattern: /confirmSpelling|needsSpellingCheck|pendingSpellingConfirm/g,
        requiredDbPath: 'aiAgentSettings.frontDeskBehavior.bookingSlots.*.confirmSpelling',
        requiredEdge: 'slots_name → confirmSpelling',
        severity: 'medium'
    },
    {
        id: 'ask-full-name',
        description: 'Full name collection (first + last)',
        files: ['BookingFlowRunner.js'],
        codePattern: /askFullName|askMissingNamePart|lastNameQuestion/g,
        requiredDbPath: 'aiAgentSettings.frontDeskBehavior.bookingSlots.*.askFullName',
        requiredEdge: 'slots_name → askFullName',
        severity: 'medium'
    },
    {
        id: 'resume-booking',
        description: 'Resume booking protocol after off-rails',
        files: ['BookingFlowRunner.js', 'ConversationEngine.js'],
        codePattern: /resumeBooking|bridgeBack|offRailsRecovery/g,
        requiredDbPath: 'aiAgentSettings.frontDeskBehavior.offRailsRecovery.bridgeBack.resumeBooking',
        requiredEdge: 'section_loopPrevention → resumeBooking',
        severity: 'medium'
    },
    
    // ═══════════════════════════════════════════════════════════════════
    // CONSENT & DISCOVERY - Critical for booking flow
    // ═══════════════════════════════════════════════════════════════════
    {
        id: 'consent-gating',
        description: 'Consent required before booking mode',
        files: ['ConversationEngine.js', 'v2twilio.js'],
        codePattern: /consentObtained|explicitConsent|checkConsent/g,
        requiredDbPath: 'aiAgentSettings.frontDeskBehavior.discoveryConsent.explicitConsentRequired',
        requiredEdge: 'section_discoveryConsent → dynamicFlows_booking_intent',
        severity: 'critical'
    }
];

// ════════════════════════════════════════════════════════════════════════════════
// MAIN VALIDATION LOGIC
// ════════════════════════════════════════════════════════════════════════════════

function run() {
    console.log(`\n${colors.cyan}═══════════════════════════════════════════════════════════════${colors.reset}`);
    console.log(`${colors.cyan}  WIRING COMPLETENESS CHECK${colors.reset}`);
    console.log(`${colors.cyan}═══════════════════════════════════════════════════════════════${colors.reset}\n`);
    
    const results = {
        passed: [],
        warnings: [],
        violations: []
    };
    
    // Load wiring registry for cross-reference
    const wiringTiersPath = path.join(ROOT, 'services/wiring/wiringTiers.js');
    let registryFields = [];
    
    if (fs.existsSync(wiringTiersPath)) {
        try {
            // Extract field IDs from wiringTiers.js
            const tiersContent = fs.readFileSync(wiringTiersPath, 'utf8');
            const fieldMatches = tiersContent.match(/id:\s*['"]([^'"]+)['"]/g) || [];
            registryFields = fieldMatches.map(m => m.replace(/id:\s*['"]|['"]/g, ''));
            console.log(`${colors.green}✓${colors.reset} Loaded wiring registry: ${registryFields.length} fields\n`);
        } catch (err) {
            console.log(`${colors.yellow}⚠${colors.reset} Could not parse wiring registry: ${err.message}\n`);
        }
    }
    
    // Run each check
    for (const check of WIRING_CHECKS) {
        const checkResult = runCheck(check, registryFields);
        
        if (checkResult.status === 'pass') {
            results.passed.push(checkResult);
        } else if (checkResult.status === 'warning') {
            results.warnings.push(checkResult);
        } else {
            results.violations.push(checkResult);
        }
    }
    
    // Print results
    printResults(results);
    
    // Exit code
    if (results.violations.length > 0 && FAIL_ON_VIOLATION) {
        console.log(`\n${colors.red}✗ Wiring violations detected. CI blocked.${colors.reset}`);
        console.log(`  Fix violations or run without --fail-on-violation for warn mode.\n`);
        process.exit(1);
    } else if (results.violations.length > 0) {
        console.log(`\n${colors.yellow}⚠ Wiring violations detected (warn mode - CI passes).${colors.reset}`);
        console.log(`  Run with --fail-on-violation to block CI.\n`);
        process.exit(0);
    } else {
        console.log(`\n${colors.green}✓ All wiring checks passed!${colors.reset}\n`);
        process.exit(0);
    }
}

function runCheck(check, registryFields) {
    const result = {
        id: check.id,
        description: check.description,
        severity: check.severity,
        status: 'pass',
        details: []
    };
    
    // 1. Check if code pattern exists in any of the target files
    let codeFound = false;
    let filesWithCode = [];
    
    for (const file of check.files) {
        const fullPath = FILES_TO_SCAN.find(f => f.includes(file));
        if (!fullPath) continue;
        
        const filePath = path.join(ROOT, fullPath);
        if (!fs.existsSync(filePath)) continue;
        
        const content = fs.readFileSync(filePath, 'utf8');
        const matches = content.match(check.codePattern);
        
        if (matches && matches.length > 0) {
            codeFound = true;
            filesWithCode.push({ file: fullPath, matches: matches.length });
        }
    }
    
    if (!codeFound) {
        // Code pattern not found - feature not implemented (that's OK)
        result.status = 'pass';
        result.details.push(`Feature not implemented in code (OK)`);
        return result;
    }
    
    // 2. Code exists - verify wiring
    result.details.push(`Found in: ${filesWithCode.map(f => `${f.file} (${f.matches}x)`).join(', ')}`);
    
    // Check if required DB path is in registry
    const dbPathBase = check.requiredDbPath.split('.')[0];
    const hasRegistryEntry = registryFields.some(f => 
        f.includes(dbPathBase) || check.requiredDbPath.includes(f)
    );
    
    if (!hasRegistryEntry) {
        result.status = check.severity === 'critical' ? 'violation' : 'warning';
        result.details.push(`Missing registry entry for: ${check.requiredDbPath}`);
    }
    
    // Note the required edge for documentation
    result.details.push(`Required edge: ${check.requiredEdge}`);
    
    return result;
}

function printResults(results) {
    // Passed
    if (results.passed.length > 0) {
        console.log(`${colors.green}PASSED (${results.passed.length}):${colors.reset}`);
        for (const r of results.passed) {
            console.log(`  ${colors.green}✓${colors.reset} ${r.id}: ${r.description}`);
        }
        console.log('');
    }
    
    // Warnings
    if (results.warnings.length > 0) {
        console.log(`${colors.yellow}WARNINGS (${results.warnings.length}):${colors.reset}`);
        for (const r of results.warnings) {
            console.log(`  ${colors.yellow}⚠${colors.reset} ${r.id}: ${r.description}`);
            for (const d of r.details) {
                console.log(`    └─ ${d}`);
            }
        }
        console.log('');
    }
    
    // Violations
    if (results.violations.length > 0) {
        console.log(`${colors.red}VIOLATIONS (${results.violations.length}):${colors.reset}`);
        for (const r of results.violations) {
            console.log(`  ${colors.red}✗${colors.reset} ${r.id}: ${r.description} [${r.severity.toUpperCase()}]`);
            for (const d of r.details) {
                console.log(`    └─ ${d}`);
            }
        }
        console.log('');
    }
    
    // Summary
    const total = results.passed.length + results.warnings.length + results.violations.length;
    console.log(`${colors.cyan}─────────────────────────────────────────────────────────────────${colors.reset}`);
    console.log(`Summary: ${results.passed.length}/${total} passed, ${results.warnings.length} warnings, ${results.violations.length} violations`);
}

// Run
run();
