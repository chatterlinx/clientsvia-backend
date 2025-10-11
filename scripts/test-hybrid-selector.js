/**
 * ============================================================================
 * TEST SCRIPT: HYBRID SCENARIO SELECTOR
 * ============================================================================
 * 
 * Tests the intelligent matching engine with real-world phrases
 * 
 * Usage:
 *   node scripts/test-hybrid-selector.js
 * 
 * ============================================================================
 */

const HybridScenarioSelector = require('../services/HybridScenarioSelector');

// ============================================
// MOCK SCENARIOS (FROM GLOBAL AI BRAIN)
// ============================================

const mockScenarios = [
    {
        scenarioId: 'hold-request-001',
        name: 'Hold / Pause Request',
        status: 'live',
        isActive: true,
        priority: 5,
        channel: 'any',
        language: 'auto',
        cooldownSeconds: 30,
        triggers: [
            'hold on',
            'hold please',
            'wait a moment',
            'give me a second',
            'one moment please',
            'can you hold',
            'let me check'
        ],
        negativeTriggers: [
            "don't hold",
            'no hold',
            'keep going'
        ],
        regexTriggers: [],
        confidenceThreshold: 0.30, // Lowered for testing
        categories: ['call-management'],
        quickReplies: [
            "Of course! Take your time.",
            "No problem, I'll wait right here.",
            "Sure thing! I'm not going anywhere."
        ],
        fullReplies: [
            "Absolutely! Take all the time you need. I'll be right here when you're ready.",
            "No rush at all! I'll hold the line and wait for you to return."
        ]
    },
    {
        scenarioId: 'appointment-scheduling-001',
        name: 'Appointment Scheduling Request',
        status: 'live',
        isActive: true,
        priority: 8,
        channel: 'any',
        language: 'auto',
        cooldownSeconds: 60,
        triggers: [
            'schedule appointment',
            'book appointment',
            'make appointment',
            'need appointment',
            'set up appointment',
            'arrange appointment',
            'reschedule',
            'change appointment'
        ],
        negativeTriggers: [
            'cancel appointment',
            'no appointment'
        ],
        regexTriggers: [
            '\\b(appointment|appt)\\b'
        ],
        confidenceThreshold: 0.30, // Lowered for testing // Lowered for testing
        categories: ['scheduling', 'appointments'],
        quickReplies: [
            "I can help with that! Let me check our calendar.",
            "Sure! I'd be happy to set that up for you.",
            "Perfect! Let's get you scheduled."
        ],
        fullReplies: [
            "I'd be glad to help you schedule an appointment! What day and time works best for you?",
            "Let me pull up our calendar and find a good time for you. Do you have any preferred days or times?"
        ]
    },
    {
        scenarioId: 'greeting-001',
        name: 'Greeting / Hello',
        status: 'live',
        isActive: true,
        priority: 3,
        channel: 'any',
        language: 'auto',
        cooldownSeconds: 300,
        triggers: [
            'hello',
            'hi',
            'hey',
            'good morning',
            'good afternoon',
            'good evening',
            'howdy'
        ],
        negativeTriggers: [],
        regexTriggers: [],
        confidenceThreshold: 0.35, // Lowered for testing
        categories: ['greetings'],
        quickReplies: [
            "Hello! How can I help you today?",
            "Hi there! What can I do for you?",
            "Hey! Thanks for calling."
        ],
        fullReplies: [
            "Hello! Thank you for calling. I'm here to help. What can I do for you today?",
            "Hi there! It's great to hear from you. How may I assist you today?"
        ]
    },
    {
        scenarioId: 'emergency-001',
        name: 'Emergency / Urgent Situation',
        status: 'live',
        isActive: true,
        priority: 100,
        channel: 'any',
        language: 'auto',
        cooldownSeconds: 0,
        triggers: [
            'emergency',
            'urgent',
            'help',
            'crisis',
            'immediate',
            'right now',
            'asap'
        ],
        negativeTriggers: [],
        regexTriggers: [
            '\\bemergency\\b',
            '\\burgent\\b'
        ],
        confidenceThreshold: 0.48, // Lowered for testing
        categories: ['emergency', 'escalation'],
        quickReplies: [
            "I understand this is urgent. Let me connect you immediately.",
            "This sounds important. Connecting you to someone right away."
        ],
        fullReplies: [
            "I understand this is an emergency. I'm connecting you to a live person immediately. Please hold on.",
            "This is urgent. I'm transferring you to someone who can help right now. One moment."
        ]
    },
    {
        scenarioId: 'smalltalk-001',
        name: 'Smalltalk / Chitchat',
        status: 'live',
        isActive: true,
        priority: -2,
        channel: 'any',
        language: 'auto',
        cooldownSeconds: 120,
        triggers: [
            'how are you',
            'nice weather',
            'having a good day',
            'whats up',
            'hows it going'
        ],
        negativeTriggers: [],
        regexTriggers: [],
        confidenceThreshold: 0.30, // Lowered for testing
        categories: ['smalltalk', 'chitchat'],
        quickReplies: [
            "I'm doing well, thank you! How about you?",
            "Great, thanks for asking! How can I help you today?",
            "I'm good! What can I do for you?"
        ],
        fullReplies: [
            "I'm doing wonderfully, thank you for asking! Now, what can I help you with today?",
            "I appreciate you asking! I'm here and ready to help. What brings you in today?"
        ]
    }
];

// ============================================
// TEST CASES
// ============================================

const testCases = [
    {
        name: 'Exact Match - Hold Request',
        phrase: 'can you hold on for a moment',
        expectedScenario: 'hold-request-001',
        expectedConfidence: 0.75
    },
    {
        name: 'Variation - Hold Request',
        phrase: 'give me a second I need to check something',
        expectedScenario: 'hold-request-001',
        expectedConfidence: 0.65
    },
    {
        name: 'Negative Trigger Block - Hold Request',
        phrase: "please don't hold I need to speak now",
        expectedScenario: null, // Should NOT match hold-request
        expectedConfidence: 0
    },
    {
        name: 'Appointment Scheduling',
        phrase: 'I need to schedule an appointment',
        expectedScenario: 'appointment-scheduling-001',
        expectedConfidence: 0.80
    },
    {
        name: 'Appointment Variation',
        phrase: 'I gotta reschedule my appt',
        expectedScenario: 'appointment-scheduling-001',
        expectedConfidence: 0.70
    },
    {
        name: 'Emergency - High Priority',
        phrase: 'this is an emergency I need help right now',
        expectedScenario: 'emergency-001',
        expectedConfidence: 0.90
    },
    {
        name: 'Greeting - Simple',
        phrase: 'hello',
        expectedScenario: 'greeting-001',
        expectedConfidence: 0.70
    },
    {
        name: 'Smalltalk - Low Priority',
        phrase: 'hey how are you doing today',
        expectedScenario: 'smalltalk-001', // Should match, but low priority
        expectedConfidence: 0.55
    },
    {
        name: 'No Match - Gibberish',
        phrase: 'asdfasdf zxcvzxcv',
        expectedScenario: null,
        expectedConfidence: 0
    },
    {
        name: 'Regex Match - Appointment',
        phrase: 'I have an appt tomorrow',
        expectedScenario: 'appointment-scheduling-001',
        expectedConfidence: 0.75
    }
];

// ============================================
// RUN TESTS
// ============================================

async function runTests() {
    console.log('\n🧪 ============================================');
    console.log('🧠 HYBRID SCENARIO SELECTOR - TEST SUITE');
    console.log('============================================\n');
    
    let passedTests = 0;
    let failedTests = 0;
    
    for (const testCase of testCases) {
        console.log(`\n📝 TEST: ${testCase.name}`);
        console.log(`   Phrase: "${testCase.phrase}"`);
        
        const result = await HybridScenarioSelector.selectScenario(
            testCase.phrase,
            mockScenarios,
            { channel: 'voice', language: 'en' }
        );
        
        const selectedId = result.scenario ? result.scenario.scenarioId : null;
        const confidence = result.confidence;
        
        // Check if test passed
        let passed = true;
        let failReason = '';
        
        if (selectedId !== testCase.expectedScenario) {
            passed = false;
            failReason = `Expected scenario "${testCase.expectedScenario}", got "${selectedId}"`;
        }
        
        if (passed && testCase.expectedConfidence > 0) {
            const confidenceDiff = Math.abs(confidence - testCase.expectedConfidence);
            if (confidenceDiff > 0.15) { // Allow 15% variance
                passed = false;
                failReason = `Expected confidence ~${testCase.expectedConfidence}, got ${confidence.toFixed(2)}`;
            }
        }
        
        // Print result
        if (passed) {
            console.log(`   ✅ PASS`);
            console.log(`   → Selected: ${selectedId || '(none)'}`);
            console.log(`   → Confidence: ${confidence.toFixed(2)}`);
            console.log(`   → Time: ${result.trace.timingMs.total}ms`);
            passedTests++;
        } else {
            console.log(`   ❌ FAIL: ${failReason}`);
            console.log(`   → Selected: ${selectedId || '(none)'}`);
            console.log(`   → Confidence: ${confidence.toFixed(2)}`);
            console.log(`   → Expected: ${testCase.expectedScenario || '(none)'}`);
            failedTests++;
        }
        
        // Print top 3 candidates
        if (result.trace.topCandidates && result.trace.topCandidates.length > 0) {
            console.log(`   🏆 Top Candidates:`);
            result.trace.topCandidates.slice(0, 3).forEach((candidate, index) => {
                console.log(`      ${index + 1}. ${candidate.name} (score: ${candidate.score}, conf: ${candidate.confidence})`);
            });
        }
    }
    
    // ============================================
    // SUMMARY
    // ============================================
    console.log('\n\n🎯 ============================================');
    console.log('TEST SUMMARY');
    console.log('============================================');
    console.log(`✅ Passed: ${passedTests}/${testCases.length}`);
    console.log(`❌ Failed: ${failedTests}/${testCases.length}`);
    console.log(`📊 Success Rate: ${((passedTests / testCases.length) * 100).toFixed(1)}%`);
    console.log('============================================\n');
    
    // ============================================
    // SERVICE STATS
    // ============================================
    const stats = HybridScenarioSelector.getStats();
    console.log('📈 SERVICE STATISTICS:');
    console.log(`   Version: ${stats.version}`);
    console.log(`   Filler Words: ${stats.fillerWordsCount}`);
    console.log(`   BM25 k1: ${stats.config.bm25.k1}`);
    console.log(`   BM25 b: ${stats.config.bm25.b}`);
    console.log(`   Min Confidence: ${stats.config.minConfidenceDefault}`);
    console.log('\n🔥 Test suite complete!\n');
}

// Run tests
runTests().catch(error => {
    console.error('❌ Test suite error:', error);
    process.exit(1);
});

