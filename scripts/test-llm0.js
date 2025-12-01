#!/usr/bin/env node

/**
 * ============================================================================
 * LLM-0 TEST HARNESS
 * ============================================================================
 * 
 * Tests Brain 1 (LLM-0) with sample inputs to verify it's working correctly.
 * No telephony required - pure orchestration testing.
 * 
 * USAGE:
 *   node scripts/test-llm0.js
 *   node scripts/test-llm0.js --company <companyId>
 * 
 * ============================================================================
 */

require('dotenv').config();

const mongoose = require('mongoose');
const { decideNextStep } = require('../services/orchestration/LLM0OrchestratorService');
const { VALID_ACTIONS } = require('../services/orchestration/LLM0Contracts');

// Test samples representing different caller intents
const TEST_SAMPLES = [
    // Emergency / Urgent
    {
        input: "Hey it's me again, my AC is leaking all over the floor and there's water everywhere!",
        expectedAction: ['RUN_SCENARIO', 'TRANSFER_CALL'],
        expectedIntent: ['emergency', 'leak', 'ac', 'water'],
        expectedFlags: { isEmergency: true }
    },
    
    // Booking request
    {
        input: "I'd like to book a maintenance tune-up for next week, maybe Tuesday or Wednesday",
        expectedAction: ['BOOK_APPOINTMENT', 'RUN_SCENARIO'],
        expectedIntent: ['maintenance', 'booking', 'tune-up', 'appointment'],
        expectedFlags: { needsBooking: true }
    },
    
    // Information question
    {
        input: "I just want to know your pricing for a new AC unit installation",
        expectedAction: ['RUN_SCENARIO', 'ASK_QUESTION'],
        expectedIntent: ['pricing', 'installation', 'info', 'question'],
        expectedFlags: {}
    },
    
    // Frustrated caller
    {
        input: "This is ridiculous, third time this month my heater broke down. I need someone out here NOW",
        expectedAction: ['TRANSFER_CALL', 'RUN_SCENARIO'],
        expectedIntent: ['repair', 'heater', 'frustrated'],
        expectedFlags: { isFrustrated: true }
    },
    
    // Wrong number
    {
        input: "Is this the pizza place? I want to order a large pepperoni",
        expectedAction: ['END_CALL'],
        expectedIntent: ['wrong_number'],
        expectedFlags: { isWrongNumber: true }
    },
    
    // Simple greeting
    {
        input: "Hi, hello, how are you today?",
        expectedAction: ['ASK_QUESTION', 'MESSAGE_ONLY'],
        expectedIntent: ['greeting', 'small_talk'],
        expectedFlags: {}
    },
    
    // Billing inquiry
    {
        input: "I got a bill that looks way too high, I need to talk to someone about this",
        expectedAction: ['RUN_SCENARIO', 'TRANSFER_CALL'],
        expectedIntent: ['billing', 'dispute'],
        expectedFlags: {}
    },
    
    // Service area check
    {
        input: "Do you guys service the Orlando area? I'm over near Disney",
        expectedAction: ['RUN_SCENARIO', 'ASK_QUESTION'],
        expectedIntent: ['service_area', 'location'],
        expectedFlags: {}
    }
];

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(color, message) {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

async function runTest(sample, testNumber, companyId) {
    log('cyan', `\n${'═'.repeat(80)}`);
    log('bright', `TEST ${testNumber}: "${sample.input.substring(0, 50)}..."`);
    log('cyan', '═'.repeat(80));
    
    const startTime = Date.now();
    
    try {
        const decision = await decideNextStep({
            companyId: companyId,
            callId: `TEST_CALL_${testNumber}`,
            userInput: sample.input,
            callState: { stage: 'greeting', turnCount: 1 },
            turnHistory: []
        });
        
        const duration = Date.now() - startTime;
        
        // Validate action
        const actionValid = VALID_ACTIONS.includes(decision.action);
        const actionExpected = sample.expectedAction.includes(decision.action);
        
        // Check flags
        let flagsMatch = true;
        const flagResults = {};
        for (const [flag, expectedValue] of Object.entries(sample.expectedFlags || {})) {
            const actualValue = decision.flags[flag];
            flagResults[flag] = { expected: expectedValue, actual: actualValue };
            if (actualValue !== expectedValue) {
                flagsMatch = false;
            }
        }
        
        // Output results
        console.log('\n📥 INPUT:', sample.input);
        console.log('');
        console.log('📤 DECISION:');
        console.log(`   Action:     ${decision.action} ${actionValid ? '✓' : '✗ INVALID'} ${actionExpected ? '✓ expected' : '⚠ unexpected'}`);
        console.log(`   Intent:     ${decision.intentTag}`);
        console.log(`   NextPrompt: ${decision.nextPrompt ? decision.nextPrompt.substring(0, 80) + '...' : '(none)'}`);
        console.log('');
        console.log('🚩 FLAGS:');
        console.log(`   needsScenario:  ${decision.flags.needsScenario}`);
        console.log(`   needsBooking:   ${decision.flags.needsBooking}`);
        console.log(`   needsTransfer:  ${decision.flags.needsTransfer}`);
        console.log(`   isEmergency:    ${decision.flags.isEmergency}`);
        console.log(`   isFrustrated:   ${decision.flags.isFrustrated}`);
        console.log(`   isSpam:         ${decision.flags.isSpam}`);
        console.log(`   isWrongNumber:  ${decision.flags.isWrongNumber}`);
        
        if (Object.keys(flagResults).length > 0) {
            console.log('');
            console.log('🎯 FLAG VALIDATION:');
            for (const [flag, result] of Object.entries(flagResults)) {
                const icon = result.actual === result.expected ? '✓' : '✗';
                console.log(`   ${flag}: ${result.actual} (expected: ${result.expected}) ${icon}`);
            }
        }
        
        console.log('');
        console.log('🔍 SCENARIO HINTS:');
        console.log(`   Category: ${decision.scenarioHints.categoryKey || '(none)'}`);
        console.log(`   Scenario: ${decision.scenarioHints.scenarioKey || '(none)'}`);
        console.log(`   Confidence: ${(decision.scenarioHints.confidence * 100).toFixed(1)}%`);
        
        console.log('');
        console.log('📊 ENTITIES:');
        console.log(`   Contact:  ${JSON.stringify(decision.entities.contact)}`);
        console.log(`   Location: ${JSON.stringify(decision.entities.location)}`);
        console.log(`   Problem:  ${JSON.stringify(decision.entities.problem)}`);
        
        console.log('');
        console.log('🐛 DEBUG:');
        console.log(`   Emotion:  ${decision.debug.emotion?.primary || 'N/A'} (intensity: ${decision.debug.emotion?.intensity || 0})`);
        console.log(`   Tokens removed: ${decision.debug.preprocessing.tokensRemoved}`);
        console.log(`   Reasoning: ${decision.debug.reasoning?.substring(0, 100) || '(none)'}...`);
        
        console.log('');
        console.log('⏱️  PERFORMANCE:');
        console.log(`   Preprocessing: ${decision.debug.performance.preprocessingMs}ms`);
        console.log(`   LLM Call:      ${decision.debug.performance.llmCallMs}ms`);
        console.log(`   Total:         ${decision.debug.performance.totalMs}ms (wall: ${duration}ms)`);
        
        // Final verdict
        console.log('');
        if (actionValid && actionExpected && flagsMatch) {
            log('green', `✅ TEST ${testNumber} PASSED`);
            return { passed: true };
        } else if (actionValid) {
            log('yellow', `⚠️  TEST ${testNumber} PARTIAL (action valid but unexpected or flags mismatch)`);
            return { passed: false, partial: true };
        } else {
            log('red', `❌ TEST ${testNumber} FAILED (invalid action: ${decision.action})`);
            return { passed: false };
        }
        
    } catch (error) {
        log('red', `❌ TEST ${testNumber} ERROR: ${error.message}`);
        console.error(error.stack);
        return { passed: false, error: error.message };
    }
}

async function main() {
    log('bright', '\n🧠 LLM-0 TEST HARNESS');
    log('cyan', '════════════════════════════════════════════════════════════════════════════════\n');
    
    // Parse command line args
    const args = process.argv.slice(2);
    let companyId = 'TEST_COMPANY';
    
    const companyArgIndex = args.indexOf('--company');
    if (companyArgIndex !== -1 && args[companyArgIndex + 1]) {
        companyId = args[companyArgIndex + 1];
    }
    
    log('blue', `Company ID: ${companyId}`);
    log('blue', `Test samples: ${TEST_SAMPLES.length}`);
    
    // Connect to database if not TEST_COMPANY
    if (companyId !== 'TEST_COMPANY' && process.env.MONGODB_URI) {
        try {
            log('yellow', 'Connecting to MongoDB...');
            await mongoose.connect(process.env.MONGODB_URI);
            log('green', 'MongoDB connected');
        } catch (dbErr) {
            log('red', `MongoDB connection failed: ${dbErr.message}`);
            log('yellow', 'Continuing with TEST_COMPANY mode...');
            companyId = 'TEST_COMPANY';
        }
    }
    
    // Run tests
    const results = [];
    for (let i = 0; i < TEST_SAMPLES.length; i++) {
        const result = await runTest(TEST_SAMPLES[i], i + 1, companyId);
        results.push(result);
        
        // Small delay between tests
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Summary
    log('cyan', `\n${'═'.repeat(80)}`);
    log('bright', 'SUMMARY');
    log('cyan', '═'.repeat(80));
    
    const passed = results.filter(r => r.passed).length;
    const partial = results.filter(r => r.partial).length;
    const failed = results.filter(r => !r.passed && !r.partial).length;
    const errors = results.filter(r => r.error).length;
    
    console.log(`\nTotal:   ${results.length}`);
    log('green', `Passed:  ${passed}`);
    log('yellow', `Partial: ${partial}`);
    log('red', `Failed:  ${failed}`);
    if (errors > 0) {
        log('red', `Errors:  ${errors}`);
    }
    
    console.log('');
    
    // Disconnect
    if (mongoose.connection.readyState === 1) {
        await mongoose.disconnect();
    }
    
    // Exit with appropriate code
    process.exit(failed > 0 || errors > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});

