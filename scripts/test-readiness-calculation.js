#!/usr/bin/env node
/**
 * ============================================================================
 * TEST SCRIPT: Readiness Calculation
 * ============================================================================
 * 
 * PURPOSE: Automated testing of ConfigurationReadinessService
 * 
 * USAGE:
 *   node scripts/test-readiness-calculation.js <companyId>
 * 
 * EXAMPLE:
 *   node scripts/test-readiness-calculation.js 68e3f77a9d623b8058c700c4
 * 
 * ============================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/v2Company');
const ConfigurationReadinessService = require('../services/ConfigurationReadinessService');

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

async function testReadinessCalculation(companyId) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`${colors.bright}${colors.blue}🧪 TESTING READINESS CALCULATION${colors.reset}`);
    console.log(`${'='.repeat(80)}\n`);
    
    try {
        // Connect to MongoDB
        console.log(`${colors.cyan}📡 Connecting to MongoDB...${colors.reset}`);
        await mongoose.connect(process.env.MONGODB_URI);
        console.log(`${colors.green}✅ Connected to MongoDB${colors.reset}\n`);
        
        // Load company
        console.log(`${colors.cyan}📋 Loading company: ${companyId}${colors.reset}`);
        const company = await Company.findById(companyId);
        
        if (!company) {
            console.log(`${colors.red}❌ Company not found${colors.reset}`);
            process.exit(1);
        }
        
        console.log(`${colors.green}✅ Company found: ${company.companyName}${colors.reset}\n`);
        
        // Calculate readiness
        console.log(`${colors.cyan}🎯 Calculating readiness...${colors.reset}`);
        const readiness = await ConfigurationReadinessService.calculateReadiness(company);
        
        // Display results
        console.log(`\n${'='.repeat(80)}`);
        console.log(`${colors.bright}📊 READINESS REPORT${colors.reset}`);
        console.log(`${'='.repeat(80)}\n`);
        
        // Overall Score
        const scoreColor = readiness.score >= 80 ? colors.green : 
                          readiness.score >= 50 ? colors.yellow : 
                          colors.red;
        
        console.log(`${colors.bright}Overall Score:${colors.reset} ${scoreColor}${readiness.score}/100${colors.reset}`);
        console.log(`${colors.bright}Can Go Live:${colors.reset} ${readiness.canGoLive ? colors.green + '✅ YES' : colors.red + '❌ NO'}${colors.reset}\n`);
        
        // Components Breakdown
        console.log(`${colors.bright}📊 Components Breakdown:${colors.reset}\n`);
        
        const components = [
            { name: 'Account Status', data: readiness.components.accountStatus, weight: 'GATEKEEPER' },
            { name: 'Variables', data: readiness.components.variables, weight: '45%' },
            { name: 'Scenarios', data: readiness.components.scenarios, weight: '25%' },
            { name: 'Voice', data: readiness.components.voice, weight: '10%' },
            { name: 'Filler Words', data: readiness.components.fillerWords, weight: '10%' },
            { name: 'Test Calls', data: readiness.components.testCalls, weight: '10%' }
        ];
        
        components.forEach(comp => {
            const score = comp.data.score || 0;
            const scoreColor = score >= 80 ? colors.green : score >= 50 ? colors.yellow : colors.red;
            
            console.log(`  ${colors.bright}${comp.name}${colors.reset} (${comp.weight})`);
            console.log(`    Score: ${scoreColor}${score}/100${colors.reset}`);
            
            // Component-specific details
            if (comp.name === 'Account Status') {
                const statusColor = comp.data.isActive ? colors.green : colors.red;
                console.log(`    Status: ${statusColor}${comp.data.status}${colors.reset}`);
                console.log(`    Active: ${comp.data.isActive ? colors.green + '✅' : colors.red + '❌'}${colors.reset}`);
            }
            else if (comp.name === 'Variables') {
                console.log(`    Configured: ${comp.data.configured}/${comp.data.required}`);
                if (comp.data.missing && comp.data.missing.length > 0) {
                    console.log(`    ${colors.yellow}Missing: ${comp.data.missing.map(m => m.label).join(', ')}${colors.reset}`);
                }
            }
            else if (comp.name === 'Scenarios') {
                console.log(`    Active: ${comp.data.active} scenarios`);
                console.log(`    Categories: ${comp.data.categories}`);
            }
            else if (comp.name === 'Voice') {
                const voiceColor = comp.data.configured ? colors.green : colors.red;
                console.log(`    Configured: ${voiceColor}${comp.data.configured ? '✅ YES' : '❌ NO'}${colors.reset}`);
                if (comp.data.voiceId) {
                    console.log(`    Voice ID: ${comp.data.voiceId.substring(0, 8)}...`);
                }
            }
            else if (comp.name === 'Filler Words') {
                console.log(`    Active: ${comp.data.active} words`);
            }
            else if (comp.name === 'Test Calls') {
                console.log(`    Made: ${comp.data.made}/${comp.data.required}`);
            }
            
            console.log('');
        });
        
        // Blockers
        if (readiness.blockers.length > 0) {
            console.log(`${colors.bright}${colors.red}🚫 BLOCKERS (${readiness.blockers.length})${colors.reset}\n`);
            readiness.blockers.forEach((blocker, i) => {
                const severityColor = blocker.severity === 'critical' ? colors.red : colors.yellow;
                console.log(`  ${i + 1}. ${severityColor}[${blocker.severity.toUpperCase()}]${colors.reset} ${blocker.code}`);
                console.log(`     ${blocker.message}`);
                if (blocker.details) {
                    console.log(`     ${colors.cyan}Details: ${blocker.details}${colors.reset}`);
                }
                if (blocker.target) {
                    console.log(`     ${colors.cyan}Fix in: ${blocker.target}${colors.reset}`);
                }
                console.log('');
            });
        }
        
        // Warnings
        if (readiness.warnings && readiness.warnings.length > 0) {
            console.log(`${colors.bright}${colors.yellow}⚠️  WARNINGS (${readiness.warnings.length})${colors.reset}\n`);
            readiness.warnings.forEach((warning, i) => {
                console.log(`  ${i + 1}. [${warning.severity.toUpperCase()}] ${warning.code}`);
                console.log(`     ${warning.message}`);
                console.log('');
            });
        }
        
        // Test Results Summary
        console.log(`${'='.repeat(80)}`);
        console.log(`${colors.bright}✅ TEST RESULTS${colors.reset}`);
        console.log(`${'='.repeat(80)}\n`);
        
        const tests = [
            {
                name: 'Account Status Check',
                pass: readiness.components.accountStatus !== undefined,
                expected: 'Component exists',
                actual: readiness.components.accountStatus ? 'Present' : 'Missing'
            },
            {
                name: 'Score Calculation',
                pass: readiness.score >= 0 && readiness.score <= 100,
                expected: 'Score between 0-100',
                actual: `${readiness.score}`
            },
            {
                name: 'Gatekeeper Logic',
                pass: readiness.components.accountStatus?.status ? true : false,
                expected: 'Account status checked',
                actual: readiness.components.accountStatus?.status || 'Not checked'
            },
            {
                name: 'Blocker Detection',
                pass: readiness.canGoLive ? readiness.blockers.length === 0 : readiness.blockers.length > 0,
                expected: 'Blockers prevent Go Live',
                actual: readiness.blockers.length > 0 ? `${readiness.blockers.length} blockers found` : 'No blockers'
            },
            {
                name: 'Variable Validation',
                pass: readiness.components.variables !== undefined,
                expected: 'Variables checked',
                actual: readiness.components.variables ? `${readiness.components.variables.configured}/${readiness.components.variables.required}` : 'Not checked'
            }
        ];
        
        let passed = 0;
        let failed = 0;
        
        tests.forEach(test => {
            const status = test.pass ? colors.green + '✅ PASS' : colors.red + '❌ FAIL';
            console.log(`${status}${colors.reset} - ${test.name}`);
            console.log(`  Expected: ${test.expected}`);
            console.log(`  Actual: ${test.actual}\n`);
            
            if (test.pass) passed++;
            else failed++;
        });
        
        console.log(`${'='.repeat(80)}`);
        const finalColor = failed === 0 ? colors.green : colors.red;
        console.log(`${finalColor}${colors.bright}FINAL RESULT: ${passed}/${tests.length} tests passed${colors.reset}`);
        console.log(`${'='.repeat(80)}\n`);
        
        // Exit code
        process.exit(failed === 0 ? 0 : 1);
        
    } catch (error) {
        console.error(`${colors.red}❌ Error:${colors.reset}`, error);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
    }
}

// Main
const companyId = process.argv[2];

if (!companyId) {
    console.log(`${colors.red}❌ Usage: node test-readiness-calculation.js <companyId>${colors.reset}`);
    console.log(`${colors.cyan}Example: node test-readiness-calculation.js 68e3f77a9d623b8058c700c4${colors.reset}`);
    process.exit(1);
}

testReadinessCalculation(companyId);

