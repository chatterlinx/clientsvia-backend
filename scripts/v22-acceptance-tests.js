#!/usr/bin/env node
/**
 * V22 LLM-LED DISCOVERY - ACCEPTANCE TESTS
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * This script runs the 4 mandatory acceptance tests for the V22 architecture.
 * Each test produces a transcript + log that proves the system behaves correctly.
 * 
 * TESTS:
 *   A. Discovery without Booking (thermostat blank)
 *   B. Discovery → Consent → Booking flow
 *   C. Question Mid-Discovery (why does this keep happening)
 *   D. Dental vs HVAC contamination check
 * 
 * RUN: node scripts/v22-acceptance-tests.js
 * ═══════════════════════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const mongoose = require('mongoose');
const ConversationEngine = require('../services/ConversationEngine');
const Company = require('../models/v2Company');
const ConversationSession = require('../models/ConversationSession');

// Test configuration
const HVAC_COMPANY_ID = process.env.TEST_HVAC_COMPANY_ID || '68e3f77a9d623b8058c700c4';
const DENTAL_COMPANY_ID = process.env.TEST_DENTAL_COMPANY_ID || null;

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    bold: '\x1b[1m'
};

function log(msg, color = 'reset') {
    console.log(`${colors[color]}${msg}${colors.reset}`);
}

function logHeader(title) {
    console.log('\n' + '═'.repeat(80));
    log(title, 'bold');
    console.log('═'.repeat(80));
}

function logResult(test, passed, details = '') {
    const status = passed ? `${colors.green}✅ PASS${colors.reset}` : `${colors.red}❌ FAIL${colors.reset}`;
    console.log(`\n${status} - ${test}`);
    if (details) console.log(`   ${details}`);
}

/**
 * Create a test session for a company
 */
async function createTestSession(companyId, channel = 'test') {
    const session = new ConversationSession({
        companyId,
        channel,
        status: 'active',
        mode: 'DISCOVERY',
        booking: { consentGiven: false },
        collectedSlots: {},
        discovery: {},
        conversationMemory: {},
        turns: [],
        metrics: { totalTurns: 0 }
    });
    await session.save();
    return session;
}

/**
 * Simulate a conversation turn
 */
async function simulateTurn(session, company, userText) {
    log(`\n👤 USER: "${userText}"`, 'cyan');
    
    const startTime = Date.now();
    const result = await ConversationEngine.processTurn({
        session,
        company,
        userText,
        channel: 'test'
    });
    const latencyMs = Date.now() - startTime;
    
    log(`🤖 AI: "${result.response}"`, 'yellow');
    
    // Extract V22 Black Box data
    const blackBox = result.v22BlackBox || result.debug?.v22BlackBox || {};
    
    return {
        response: result.response,
        mode: session.mode,
        consentGiven: session.booking?.consentGiven,
        llmSpoke: !result.fromStateMachine,
        tokensUsed: result.tokensUsed || 0,
        latencyMs,
        blackBox,
        raw: result
    };
}

/**
 * TEST A: Discovery without Booking
 * Caller says something that sounds like an issue but should NOT trigger booking
 */
async function testA_DiscoveryWithoutBooking(company) {
    logHeader('TEST A: Discovery without Booking');
    log('Scenario: Caller describes an issue. AI should empathize and help, NOT start booking.', 'blue');
    
    const session = await createTestSession(company._id);
    const results = [];
    
    // Turn 1: Describe issue
    const turn1 = await simulateTurn(session, company, "My thermostat screen is blank and I'm annoyed.");
    results.push(turn1);
    
    // Verification
    const passed = {
        llmSpoke: turn1.llmSpoke === true,
        modeIsDiscovery: session.mode === 'DISCOVERY',
        noBookingStarted: session.booking?.consentGiven !== true,
        noNameAsked: !turn1.response.toLowerCase().includes('name'),
        noPhoneAsked: !turn1.response.toLowerCase().includes('phone'),
        showsEmpathy: /sorry|understand|frustrat|annoying|help/i.test(turn1.response)
    };
    
    const allPassed = Object.values(passed).every(v => v);
    
    console.log('\n📋 VERIFICATION:');
    console.log(`   LLM spoke first: ${passed.llmSpoke ? '✅' : '❌'}`);
    console.log(`   Mode is DISCOVERY: ${passed.modeIsDiscovery ? '✅' : '❌'} (actual: ${session.mode})`);
    console.log(`   No booking started: ${passed.noBookingStarted ? '✅' : '❌'}`);
    console.log(`   Did NOT ask for name: ${passed.noNameAsked ? '✅' : '❌'}`);
    console.log(`   Did NOT ask for phone: ${passed.noPhoneAsked ? '✅' : '❌'}`);
    console.log(`   Shows empathy: ${passed.showsEmpathy ? '✅' : '❌'}`);
    console.log(`   Latency: ${turn1.latencyMs}ms`);
    console.log(`   Tokens: ${turn1.tokensUsed}`);
    
    logResult('TEST A', allPassed);
    
    // Cleanup
    await ConversationSession.findByIdAndDelete(session._id);
    
    return { passed: allPassed, results, verification: passed };
}

/**
 * TEST B: Discovery → Consent → Booking
 * Caller describes issue, then explicitly asks to book
 */
async function testB_ConsentToBooking(company) {
    logHeader('TEST B: Discovery → Consent → Booking');
    log('Scenario: Caller describes issue, then says "Can you send someone?". AI should transition to booking.', 'blue');
    
    const session = await createTestSession(company._id);
    const results = [];
    
    // Turn 1: Describe issue
    const turn1 = await simulateTurn(session, company, "It's not working at all. The whole system is dead.");
    results.push(turn1);
    const modeAfterTurn1 = session.mode;
    
    // Turn 2: Request booking (explicit consent)
    const turn2 = await simulateTurn(session, company, "Can you send someone out to fix it?");
    results.push(turn2);
    const modeAfterTurn2 = session.mode;
    
    // Verification
    const passed = {
        turn1_discovery: modeAfterTurn1 === 'DISCOVERY',
        turn2_booking: modeAfterTurn2 === 'BOOKING',
        consentDetected: session.booking?.consentGiven === true,
        modeTransition: modeAfterTurn1 !== modeAfterTurn2,
        bookingPromptShown: /name|phone|address|schedule/i.test(turn2.response)
    };
    
    const allPassed = Object.values(passed).every(v => v);
    
    console.log('\n📋 VERIFICATION:');
    console.log(`   Turn 1 mode is DISCOVERY: ${passed.turn1_discovery ? '✅' : '❌'} (actual: ${modeAfterTurn1})`);
    console.log(`   Turn 2 mode is BOOKING: ${passed.turn2_booking ? '✅' : '❌'} (actual: ${modeAfterTurn2})`);
    console.log(`   Consent detected: ${passed.consentDetected ? '✅' : '❌'}`);
    console.log(`   Mode transition occurred: ${passed.modeTransition ? '✅' : '❌'}`);
    console.log(`   Booking prompt shown: ${passed.bookingPromptShown ? '✅' : '❌'}`);
    console.log(`   Consent phrase: "${session.booking?.consentPhrase || 'none'}"`);
    
    logResult('TEST B', allPassed);
    
    // Cleanup
    await ConversationSession.findByIdAndDelete(session._id);
    
    return { passed: allPassed, results, verification: passed };
}

/**
 * TEST C: Question Mid-Discovery
 * Caller asks a question that should be answered, not trigger booking
 */
async function testC_QuestionMidDiscovery(company) {
    logHeader('TEST C: Question Mid-Discovery');
    log('Scenario: Caller asks "Why does this keep happening?". AI should answer, stay in discovery.', 'blue');
    
    const session = await createTestSession(company._id);
    const results = [];
    
    // Turn 1: Context
    const turn1 = await simulateTurn(session, company, "My AC keeps shutting off randomly.");
    results.push(turn1);
    
    // Turn 2: Ask a question (should NOT trigger booking)
    const turn2 = await simulateTurn(session, company, "Why does this keep happening every year?");
    results.push(turn2);
    
    // Verification
    const passed = {
        staysInDiscovery: session.mode === 'DISCOVERY',
        noBookingStarted: session.booking?.consentGiven !== true,
        answersQuestion: turn2.response.length > 20, // Should give a real answer
        noBookingPrompt: !/may i have your name/i.test(turn2.response),
        llmSpoke: turn2.llmSpoke === true
    };
    
    const allPassed = Object.values(passed).every(v => v);
    
    console.log('\n📋 VERIFICATION:');
    console.log(`   Stays in DISCOVERY: ${passed.staysInDiscovery ? '✅' : '❌'} (actual: ${session.mode})`);
    console.log(`   No booking started: ${passed.noBookingStarted ? '✅' : '❌'}`);
    console.log(`   Answers the question: ${passed.answersQuestion ? '✅' : '❌'}`);
    console.log(`   No booking prompt: ${passed.noBookingPrompt ? '✅' : '❌'}`);
    console.log(`   LLM spoke: ${passed.llmSpoke ? '✅' : '❌'}`);
    
    logResult('TEST C', allPassed);
    
    // Cleanup
    await ConversationSession.findByIdAndDelete(session._id);
    
    return { passed: allPassed, results, verification: passed };
}

/**
 * TEST D: Dental vs HVAC Contamination
 * Verify dental company doesn't use HVAC vocabulary
 */
async function testD_ContaminationCheck(hvacCompany, dentalCompany) {
    logHeader('TEST D: Dental vs HVAC Contamination Check');
    
    if (!dentalCompany) {
        log('⚠️  SKIPPED: No dental company configured for testing', 'yellow');
        log('   Set TEST_DENTAL_COMPANY_ID environment variable to run this test', 'yellow');
        return { passed: null, skipped: true };
    }
    
    log('Scenario: Dental caller says "My tooth hurts". AI should use dental vocabulary only.', 'blue');
    
    const session = await createTestSession(dentalCompany._id);
    const results = [];
    
    // Turn 1: Dental issue
    const turn1 = await simulateTurn(session, dentalCompany, "My tooth hurts really bad.");
    results.push(turn1);
    
    // Contamination check
    const hvacWords = ['technician', 'dispatch', 'unit', 'repair', 'hvac', 'ac', 'furnace', 'duct'];
    const responseWords = turn1.response.toLowerCase();
    const contamination = hvacWords.filter(w => responseWords.includes(w));
    
    const passed = {
        noTechnician: !responseWords.includes('technician'),
        noDispatch: !responseWords.includes('dispatch'),
        noUnit: !responseWords.includes('unit'),
        noHvacTerms: contamination.length === 0,
        usesDentalTerms: /dentist|appointment|tooth|dental|pain/i.test(turn1.response)
    };
    
    const allPassed = Object.values(passed).every(v => v);
    
    console.log('\n📋 VERIFICATION:');
    console.log(`   No "technician": ${passed.noTechnician ? '✅' : '❌'}`);
    console.log(`   No "dispatch": ${passed.noDispatch ? '✅' : '❌'}`);
    console.log(`   No "unit": ${passed.noUnit ? '✅' : '❌'}`);
    console.log(`   No HVAC contamination: ${passed.noHvacTerms ? '✅' : '❌'}`);
    if (contamination.length > 0) {
        console.log(`   ⚠️  Found contaminated words: ${contamination.join(', ')}`);
    }
    console.log(`   Uses dental terms: ${passed.usesDentalTerms ? '✅' : '❌'}`);
    
    logResult('TEST D', allPassed);
    
    // Cleanup
    await ConversationSession.findByIdAndDelete(session._id);
    
    return { passed: allPassed, results, verification: passed };
}

/**
 * LATENCY TEST: Measure component timings
 */
async function testLatency(company) {
    logHeader('LATENCY MEASUREMENTS');
    
    const session = await createTestSession(company._id);
    
    // Run a typical discovery turn and capture timings
    const turn = await simulateTurn(session, company, "My AC isn't cooling properly.");
    
    console.log('\n📊 LATENCY RESULTS:');
    console.log(`   Total turn latency: ${turn.latencyMs}ms ${turn.latencyMs < 1200 ? '✅' : '❌'} (max: 1200ms)`);
    console.log(`   LLM tokens used: ${turn.tokensUsed}`);
    
    // Hard limits check
    const limits = {
        totalTurn: turn.latencyMs < 1200
    };
    
    // Cleanup
    await ConversationSession.findByIdAndDelete(session._id);
    
    return { latencyMs: turn.latencyMs, limits };
}

/**
 * Main test runner
 */
async function runAllTests() {
    console.log('\n');
    console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
    console.log('║                    V22 LLM-LED DISCOVERY - ACCEPTANCE TESTS                  ║');
    console.log('║                         ClientsVia Backend Verification                      ║');
    console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
    
    try {
        // Connect to database
        log('\n🔌 Connecting to MongoDB...', 'blue');
        await mongoose.connect(process.env.MONGODB_URI);
        log('✅ Connected to MongoDB', 'green');
        
        // Load test companies
        const hvacCompany = await Company.findById(HVAC_COMPANY_ID);
        if (!hvacCompany) {
            log(`❌ HVAC company not found: ${HVAC_COMPANY_ID}`, 'red');
            process.exit(1);
        }
        log(`✅ Loaded HVAC company: ${hvacCompany.companyName}`, 'green');
        
        let dentalCompany = null;
        if (DENTAL_COMPANY_ID) {
            dentalCompany = await Company.findById(DENTAL_COMPANY_ID);
            if (dentalCompany) {
                log(`✅ Loaded Dental company: ${dentalCompany.companyName}`, 'green');
            }
        }
        
        // Run tests
        const results = {
            testA: await testA_DiscoveryWithoutBooking(hvacCompany),
            testB: await testB_ConsentToBooking(hvacCompany),
            testC: await testC_QuestionMidDiscovery(hvacCompany),
            testD: await testD_ContaminationCheck(hvacCompany, dentalCompany),
            latency: await testLatency(hvacCompany)
        };
        
        // Summary
        logHeader('FINAL SUMMARY');
        
        const testResults = [
            { name: 'Test A (Discovery without Booking)', passed: results.testA.passed },
            { name: 'Test B (Consent → Booking)', passed: results.testB.passed },
            { name: 'Test C (Question Mid-Discovery)', passed: results.testC.passed },
            { name: 'Test D (Contamination Check)', passed: results.testD.passed }
        ];
        
        let passCount = 0;
        let failCount = 0;
        let skipCount = 0;
        
        testResults.forEach(t => {
            if (t.passed === null) {
                console.log(`⏭️  ${t.name}: SKIPPED`);
                skipCount++;
            } else if (t.passed) {
                console.log(`${colors.green}✅ ${t.name}: PASSED${colors.reset}`);
                passCount++;
            } else {
                console.log(`${colors.red}❌ ${t.name}: FAILED${colors.reset}`);
                failCount++;
            }
        });
        
        console.log('\n' + '─'.repeat(50));
        console.log(`Total: ${passCount} passed, ${failCount} failed, ${skipCount} skipped`);
        console.log(`Latency: ${results.latency.latencyMs}ms`);
        
        if (failCount === 0) {
            log('\n🎉 ALL TESTS PASSED - V22 Architecture Verified!', 'green');
        } else {
            log('\n⚠️  SOME TESTS FAILED - Review required before merge', 'red');
        }
        
        // Disconnect
        await mongoose.disconnect();
        process.exit(failCount > 0 ? 1 : 0);
        
    } catch (error) {
        console.error('\n❌ Test runner error:', error);
        await mongoose.disconnect();
        process.exit(1);
    }
}

// Run tests
runAllTests();

