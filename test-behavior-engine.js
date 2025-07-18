/**
 * Comprehensive Behavior Engine Test Script
 * Test all behavior detection patterns and system integration
 */

// Test behavior detection patterns
const behaviorTests = [
    {
        name: "Frustration Detection",
        queries: [
            "I'm so frustrated with this service",
            "This is ridiculous, I've been waiting forever",
            "I'm annoyed that nobody answered",
            "Your service is terrible"
        ],
        expectedBehavior: "de-escalate",
        expectedFlags: ["frustration_detected"]
    },
    {
        name: "Escalation Requests",
        queries: [
            "I want to talk to a person",
            "Transfer me to someone",
            "I need to speak to a supervisor",
            "Connect me to a human"
        ],
        expectedBehavior: "escalate_to_human",
        expectedFlags: ["escalation_requested"]
    },
    {
        name: "Silence Detection",
        queries: [
            "",
            "   ",
            null
        ],
        expectedBehavior: "prompt_engagement",
        expectedFlags: ["silence_prompt"]
    },
    {
        name: "Off-Topic Detection",
        queries: [
            "What's the weather like today?",
            "Are you interested in politics?",
            "This is spam content",
            "Let's talk about sports"
        ],
        expectedBehavior: "redirect_conversation",
        expectedFlags: ["off_topic_redirect"]
    },
    {
        name: "Robot Detection",
        queries: [
            "Are you a real person?",
            "Am I talking to a robot?",
            "This sounds like a machine",
            "You're not human, are you?"
        ],
        expectedBehavior: "humanize_response",
        expectedFlags: ["robot_detection"]
    },
    {
        name: "Normal Queries (No Behavior)",
        queries: [
            "What are your hours?",
            "Do you service my area?",
            "Can you help with my AC?",
            "I need a repair appointment"
        ],
        expectedBehavior: null,
        expectedFlags: []
    }
];

// Test configuration
const testConfig = {
    companyId: "686a680241806a4991f7367f",
    behaviorConfig: {
        frustrationKeywords: ["frustrated", "annoyed", "upset", "ridiculous", "terrible"],
        silenceThreshold: 8,
        repetitionLimit: 3,
        offTopicKeywords: ["weather", "politics", "spam", "sports"],
        useLLMForSentiment: false,
        enableEmpathyResponses: true
    }
};

/**
 * Run comprehensive behavior engine tests
 */
async function runBehaviorEngineTests() {
    console.log('🧪 Starting Comprehensive Behavior Engine Tests...');
    console.log('📋 Testing with configuration:', testConfig);
    
    let totalTests = 0;
    let passedTests = 0;
    let failedTests = 0;
    
    for (const testCase of behaviorTests) {
        console.log(`\n📂 Testing: ${testCase.name}`);
        console.log(`   Queries: ${testCase.queries.length}`);
        console.log(`   Expected: ${testCase.expectedBehavior || 'No behavior'}`);
        
        for (const query of testCase.queries) {
            totalTests++;
            
            try {
                const result = await testBehaviorDetection(query);
                const passed = validateTestResult(result, testCase, query);
                
                if (passed) {
                    passedTests++;
                    console.log(`   ✅ "${query || '(empty)'}" - PASSED`);
                } else {
                    failedTests++;
                    console.log(`   ❌ "${query || '(empty)'}" - FAILED`);
                    console.log(`      Expected: ${testCase.expectedBehavior}`);
                    console.log(`      Got: ${result.behaviorDetected?.action || 'null'}`);
                }
            } catch (error) {
                failedTests++;
                console.error(`   💥 "${query || '(empty)'}" - ERROR:`, error.message);
            }
        }
    }
    
    console.log('\n📊 Test Results Summary:');
    console.log(`   Total Tests: ${totalTests}`);
    console.log(`   Passed: ${passedTests} (${Math.round(passedTests/totalTests*100)}%)`);
    console.log(`   Failed: ${failedTests} (${Math.round(failedTests/totalTests*100)}%)`);
    
    if (failedTests === 0) {
        console.log('🎉 All tests passed! Behavior engine is working correctly.');
    } else {
        console.log('⚠️ Some tests failed. Check the logs above for details.');
    }
    
    return {
        total: totalTests,
        passed: passedTests,
        failed: failedTests,
        success: failedTests === 0
    };
}

/**
 * Test behavior detection for a single query
 */
async function testBehaviorDetection(query) {
    const response = await fetch('https://clientsvia-backend.onrender.com/api/ai-agent/test-behavior', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            query: query,
            companyId: testConfig.companyId,
            behaviorConfig: testConfig.behaviorConfig
        })
    });
    
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return await response.json();
}

/**
 * Validate test result against expected behavior
 */
function validateTestResult(result, testCase, query) {
    const detected = result.behaviorDetected;
    
    // Check if behavior was expected
    if (testCase.expectedBehavior === null) {
        return detected === null;
    }
    
    // Check if behavior was detected when expected
    if (!detected) {
        return false;
    }
    
    // Check if the correct behavior was detected
    if (detected.action !== testCase.expectedBehavior) {
        return false;
    }
    
    // Check flags if specified
    if (testCase.expectedFlags && testCase.expectedFlags.length > 0) {
        const detectedFlags = detected.flags || [];
        const hasExpectedFlags = testCase.expectedFlags.every(flag => detectedFlags.includes(flag));
        if (!hasExpectedFlags) {
            return false;
        }
    }
    
    return true;
}

/**
 * Test UI integration
 */
function testBehaviorEngineUI() {
    console.log('🖥️ Testing Behavior Engine UI Integration...');
    
    const elements = [
        'frustration-keywords',
        'silence-threshold', 
        'repetition-limit',
        'off-topic-keywords',
        'use-llm-sentiment',
        'enable-empathy-responses',
        'behavior-test-input',
        'test-behavior-btn'
    ];
    
    const results = {};
    
    elements.forEach(id => {
        const element = document.getElementById(id);
        results[id] = !!element;
        console.log(`   ${id}: ${element ? '✅ Found' : '❌ Missing'}`);
    });
    
    const allFound = Object.values(results).every(found => found);
    console.log(`\n📊 UI Elements: ${allFound ? '✅ All found' : '❌ Some missing'}`);
    
    return results;
}

/**
 * Test behavior configuration save/load
 */
async function testBehaviorConfigurationPersistence() {
    console.log('💾 Testing Behavior Configuration Persistence...');
    
    // Test data
    const testData = {
        frustrationKeywords: ["test1", "test2"],
        silenceThreshold: 12,
        repetitionLimit: 5,
        offTopicKeywords: ["test3", "test4"],
        useLLMForSentiment: true,
        enableEmpathyResponses: false
    };
    
    try {
        // Populate form with test data
        if (typeof window.populateBehaviorConfiguration === 'function') {
            window.populateBehaviorConfiguration(testData);
            console.log('   ✅ Populated form with test data');
        }
        
        // Collect data back
        if (typeof window.collectBehaviorConfiguration === 'function') {
            const collected = window.collectBehaviorConfiguration();
            console.log('   ✅ Collected data from form');
            
            // Validate round-trip
            const matches = JSON.stringify(collected) === JSON.stringify(testData);
            console.log(`   ${matches ? '✅' : '❌'} Round-trip validation: ${matches ? 'PASSED' : 'FAILED'}`);
            
            if (!matches) {
                console.log('      Expected:', testData);
                console.log('      Got:', collected);
            }
            
            return matches;
        }
        
        return false;
    } catch (error) {
        console.error('   ❌ Error in persistence test:', error);
        return false;
    }
}

// Export test functions for browser use
if (typeof window !== 'undefined') {
    window.runBehaviorEngineTests = runBehaviorEngineTests;
    window.testBehaviorEngineUI = testBehaviorEngineUI;
    window.testBehaviorConfigurationPersistence = testBehaviorConfigurationPersistence;
    console.log('🔧 Behavior engine test functions available:');
    console.log('   - runBehaviorEngineTests()');
    console.log('   - testBehaviorEngineUI()');
    console.log('   - testBehaviorConfigurationPersistence()');
}

// Auto-run tests if loaded in browser
if (typeof window !== 'undefined' && window.location) {
    console.log('🚀 Behavior Engine Test Suite Loaded');
    console.log('📋 Run tests manually or wait for auto-run...');
    
    // Auto-run after page is fully loaded
    setTimeout(() => {
        if (document.readyState === 'complete') {
            console.log('🎯 Auto-running behavior engine tests...');
            runBehaviorEngineTests().then(results => {
                console.log('✅ Auto-test completed:', results);
            }).catch(error => {
                console.error('❌ Auto-test failed:', error);
            });
        }
    }, 3000);
}
