// scripts/test-behavior-engine.js
// Test script for the behavior engine with mock data

const { evaluateBehavior, createBehaviorContext, getPenguinAirBehaviorRules } = require('../utils/behaviorRules');

// Mock Penguin Air company profile
const mockPenguinAir = {
  _id: "686a680241806a4991f7367f",
  name: "Penguin Air",
  mainPhone: "+15551234567",
  serviceAdvisorNumber: "+15551234567",
  behaviorRules: getPenguinAirBehaviorRules()
};

// Test cases to verify behavior engine
const testCases = [
  {
    name: "Robot Detection",
    transcript: "Are you a robot?",
    expectedAction: "humanize_response"
  },
  {
    name: "Escalation Request",
    transcript: "I want to talk to a person",
    expectedAction: "escalate_to_service_advisor"
  },
  {
    name: "Technician Request",
    transcript: "I need to speak with Dustin",
    expectedAction: "confirm_technician_request"
  },
  {
    name: "Frustration Detection",
    transcript: "This is frustrating",
    expectedAction: "escalate_to_service_advisor"
  },
  {
    name: "Normal Conversation",
    transcript: "I need help with my air conditioner",
    expectedAction: "continue_normal_flow"
  },
  {
    name: "Silence Handling",
    transcript: "",
    context: { silenceDuration: 3, silenceCount: 0 },
    expectedAction: "handle_silence"
  },
  {
    name: "Multiple Robot Attempts",
    transcript: "Are you real or a machine?",
    expectedAction: "humanize_response"
  },
  {
    name: "Emergency Keywords",
    transcript: "This is an emergency, no heat",
    expectedAction: "continue_normal_flow" // Should be handled by intent classification
  }
];

function runBehaviorTests() {
  console.log('🧪 Testing Behavior Engine for Penguin Air\n');
  console.log('═'.repeat(60));
  
  let passedTests = 0;
  let totalTests = testCases.length;
  
  testCases.forEach((testCase, index) => {
    console.log(`\n${index + 1}. Testing: ${testCase.name}`);
    console.log(`   Input: "${testCase.transcript}"`);
    
    const behaviorContext = createBehaviorContext(testCase.context || {});
    
    const result = evaluateBehavior({
      transcript: testCase.transcript,
      companyProfile: mockPenguinAir,
      context: behaviorContext
    });
    
    const passed = result.action === testCase.expectedAction;
    console.log(`   Expected: ${testCase.expectedAction}`);
    console.log(`   Got: ${result.action}`);
    console.log(`   Result: ${passed ? '✅ PASS' : '❌ FAIL'}`);
    
    if (result.message) {
      console.log(`   Response: "${result.message}"`);
    }
    
    if (passed) passedTests++;
  });
  
  console.log('\n' + '═'.repeat(60));
  console.log(`🎯 Test Results: ${passedTests}/${totalTests} tests passed`);
  
  if (passedTests === totalTests) {
    console.log('🎉 All tests passed! Behavior engine is working correctly.');
  } else {
    console.log('⚠️ Some tests failed. Review behavior rules logic.');
  }
  
  return passedTests === totalTests;
}

// Test specific behavioral scenarios
function testSpecificScenarios() {
  console.log('\n\n🔍 Testing Specific Production Scenarios\n');
  
  const scenarios = [
    {
      name: "Customer suspects AI",
      transcript: "You sound like a robot, are you real?",
      description: "Should humanize and reassure"
    },
    {
      name: "Frustrated customer",
      transcript: "This is so frustrating, I just want to talk to someone",
      description: "Should escalate immediately"
    },
    {
      name: "Specific technician request",
      transcript: "I worked with Marcello before, can I speak with him?",
      description: "Should confirm technician request"
    },
    {
      name: "Long silence",
      transcript: "",
      context: { silenceDuration: 4, silenceCount: 1 },
      description: "Should handle silence with fallback"
    },
    {
      name: "Multiple silence warnings",
      transcript: "",
      context: { silenceDuration: 3, silenceCount: 2 },
      description: "Should escalate due to repeated silence"
    }
  ];
  
  scenarios.forEach((scenario, index) => {
    console.log(`${index + 1}. ${scenario.name}`);
    console.log(`   Scenario: ${scenario.description}`);
    console.log(`   Input: "${scenario.transcript || '[silence]'}"`);
    
    const result = evaluateBehavior({
      transcript: scenario.transcript,
      companyProfile: mockPenguinAir,
      context: createBehaviorContext(scenario.context || {})
    });
    
    console.log(`   Action: ${result.action}`);
    console.log(`   Priority: ${result.priority}`);
    if (result.message) {
      console.log(`   Response: "${result.message}"`);
    }
    console.log('');
  });
}

// Test configuration loading
function testConfigurationLoading() {
  console.log('\n🔧 Testing Configuration Loading\n');
  
  const penguinRules = getPenguinAirBehaviorRules();
  console.log('Penguin Air Behavior Rules:');
  console.log(`✓ Silence limit: ${penguinRules.silenceLimitSeconds} seconds`);
  console.log(`✓ Technicians: ${penguinRules.technicianNames.join(', ')}`);
  console.log(`✓ Escalation triggers: ${penguinRules.escalationTriggers.length} configured`);
  console.log(`✓ Robot detection keywords: ${penguinRules.robotDetectionKeywords.length} configured`);
  console.log(`✓ After hours enabled: ${penguinRules.afterHours.enabled}`);
  console.log(`✓ Business hours: ${penguinRules.afterHours.hours.start}:00 - ${penguinRules.afterHours.hours.end}:00`);
}

// Main test runner
function main() {
  console.log('🚀 Behavior Engine Test Suite');
  console.log('Testing production-grade AI behavior rules for Penguin Air\n');
  
  testConfigurationLoading();
  const allTestsPassed = runBehaviorTests();
  testSpecificScenarios();
  
  console.log('\n' + '═'.repeat(60));
  console.log('🎯 Test Suite Complete');
  
  if (allTestsPassed) {
    console.log('✅ Behavior engine is ready for production deployment!');
    console.log('\n📋 Next Steps:');
    console.log('   1. Integrate behaviorMiddleware into your agent routes');
    console.log('   2. Add behavior rules to company profiles in MongoDB');
    console.log('   3. Monitor live calls for behavioral triggers');
    console.log('   4. Fine-tune rules based on real call data');
  } else {
    console.log('❌ Some tests failed - review before deploying');
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  runBehaviorTests,
  testSpecificScenarios,
  mockPenguinAir
};
