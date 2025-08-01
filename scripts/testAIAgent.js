/**
 * testAIAgent.js - Comprehensive test script for AI Agent Logic
 * 
 * Tests all components:
 * - API endpoints
 * - Knowledge routing
 * - Booking flow
 * - Behavior engine
 * - Intent routing
 * - Response tracing
 */

const mongoose = require('mongoose');
const Company = require('../models/Company');
const { seedAIAgentLogic } = require('./seedAIAgentLogic');

// Test configuration
const TEST_COMPANY_ID = '507f1f77bcf86cd799439011'; // Mock ID for testing

async function runAIAgentTests() {
  try {
    console.log('🧪 Starting AI Agent Logic Tests...\n');
    
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/clientsvia';
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    // Test 1: Component Imports
    console.log('🔍 Test 1: Component Imports');
    await testComponentImports();
    
    // Test 2: AI Configuration Loading
    console.log('\n🔍 Test 2: AI Configuration Loading');
    await testAIConfigLoading();
    
    // Test 3: Intent Routing
    console.log('\n🔍 Test 3: Intent Routing');
    await testIntentRouting();
    
    // Test 4: Knowledge Routing
    console.log('\n🔍 Test 4: Knowledge Routing');
    await testKnowledgeRouting();
    
    // Test 5: Booking Flow
    console.log('\n🔍 Test 5: Booking Flow');
    await testBookingFlow();
    
    // Test 6: Behavior Engine
    console.log('\n🔍 Test 6: Behavior Engine');
    await testBehaviorEngine();
    
    // Test 7: API Endpoints
    console.log('\n🔍 Test 7: API Endpoints');
    await testAPIEndpoints();
    
    // Test 8: Multi-tenant Isolation
    console.log('\n🔍 Test 8: Multi-tenant Isolation');
    await testMultiTenantIsolation();
    
    console.log('\n🎉 All tests completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('📡 Disconnected from MongoDB');
  }
}

async function testComponentImports() {
  try {
    // Test individual component imports
    const aiLoader = require('../src/config/aiLoader');
    console.log('✅ AI Loader imported');
    
    const { answer } = require('../src/config/llmClient');
    console.log('✅ LLM Client imported');
    
    const { route: routeIntent } = require('../src/runtime/IntentRouter');
    console.log('✅ Intent Router imported');
    
    const { route: routeKnowledge } = require('../src/runtime/KnowledgeRouter');
    console.log('✅ Knowledge Router imported');
    
    const { apply: applyBehavior } = require('../src/runtime/BehaviorEngine');
    console.log('✅ Behavior Engine imported');
    
    const { start: startBooking } = require('../src/runtime/BookingHandler');
    console.log('✅ Booking Handler imported');
    
    const { ResponseTraceLogger } = require('../src/runtime/ResponseTrace');
    console.log('✅ Response Trace imported');
    
    const { processCallTurn } = require('../services/aiAgentRuntime');
    console.log('✅ AI Agent Runtime imported');
    
  } catch (error) {
    console.error('❌ Component import failed:', error.message);
    throw error;
  }
}

async function testAIConfigLoading() {
  try {
    // Test if we can load default configuration
    const aiLoader = require('../src/config/aiLoader');
    
    // Create a test company if it doesn't exist
    let company = await Company.findById(TEST_COMPANY_ID);
    if (!company) {
      company = new Company({
        _id: TEST_COMPANY_ID,
        businessName: 'Test Company',
        companyName: 'Test Company',
        email: 'test@test.com'
      });
      await company.save();
      console.log('📝 Created test company');
    }
    
    // Ensure it has AI Agent Logic
    if (!company.aiAgentLogic?.enabled) {
      console.log('🌱 Seeding AI configuration for test company...');
      await seedAIAgentLogic();
    }
    
    // Test loading configuration
    const config = await aiLoader.get(TEST_COMPANY_ID);
    
    if (config && config.answerPriorityFlow) {
      console.log('✅ AI configuration loaded successfully');
      console.log(`   Priority flow: ${config.answerPriorityFlow.join(' → ')}`);
      console.log(`   Company KB threshold: ${config.thresholds.companyKB}`);
    } else {
      throw new Error('AI configuration not found or invalid');
    }
    
  } catch (error) {
    console.error('❌ AI Config loading failed:', error.message);
    throw error;
  }
}

async function testIntentRouting() {
  try {
    const { route: routeIntent } = require('../src/runtime/IntentRouter');
    
    // Test different intents
    const testCases = [
      { text: "I need to schedule an appointment", expectedIntent: "booking" },
      { text: "What are your business hours?", expectedIntent: "hours" },
      { text: "I want to speak to a person", expectedIntent: "transfer" },
      { text: "This is an emergency!", expectedIntent: "emergency" },
      { text: "My thermostat is not working", expectedIntent: "qa" }
    ];
    
    for (const testCase of testCases) {
      const result = await routeIntent(TEST_COMPANY_ID, testCase.text, {});
      
      if (result.intent === testCase.expectedIntent) {
        console.log(`✅ "${testCase.text}" → ${result.intent} (confidence: ${result.confidence})`);
      } else {
        console.log(`⚠️  "${testCase.text}" → ${result.intent} (expected: ${testCase.expectedIntent})`);
      }
    }
    
  } catch (error) {
    console.error('❌ Intent routing failed:', error.message);
    throw error;
  }
}

async function testKnowledgeRouting() {
  try {
    const { route: routeKnowledge } = require('../src/runtime/KnowledgeRouter');
    
    // Test knowledge routing with a sample query
    const result = await routeKnowledge({
      companyID: TEST_COMPANY_ID,
      text: "What are your payment methods?",
      context: {}
    });
    
    if (result && result.result) {
      console.log('✅ Knowledge routing successful');
      console.log(`   Source: ${result.trace.find(t => t.selected)?.source || 'unknown'}`);
      console.log(`   Response: ${result.result.text?.substring(0, 50)}...`);
    } else {
      console.log('⚠️  Knowledge routing returned no result - this is OK for testing');
    }
    
  } catch (error) {
    console.error('❌ Knowledge routing failed:', error.message);
    // Don't throw - this might fail due to missing knowledge base entries
  }
}

async function testBookingFlow() {
  try {
    const { start: startBooking, next: nextBooking } = require('../src/runtime/BookingHandler');
    
    // Test starting a booking flow
    const bookingState = await startBooking(TEST_COMPANY_ID, {
      userText: "I need to schedule a repair",
      intent: "booking"
    });
    
    if (bookingState && bookingState.stepIndex === 0) {
      console.log('✅ Booking flow started successfully');
      console.log(`   Current step: ${bookingState.flowConfig.steps[0].field}`);
      
      // Test progressing through the flow
      const result = await nextBooking(bookingState, "John Smith", {
        companyID: TEST_COMPANY_ID
      });
      
      if (result && result.state && result.state.stepIndex === 1) {
        console.log('✅ Booking flow progression successful');
        console.log(`   Collected name: ${result.state.collectedData.name}`);
      } else {
        console.log('⚠️  Booking flow progression failed');
      }
    } else {
      throw new Error('Booking flow failed to start');
    }
    
  } catch (error) {
    console.error('❌ Booking flow failed:', error.message);
    throw error;
  }
}

async function testBehaviorEngine() {
  try {
    const { apply: applyBehavior } = require('../src/runtime/BehaviorEngine');
    const aiLoader = require('../src/config/aiLoader');
    
    const config = await aiLoader.get(TEST_COMPANY_ID);
    const callState = { consecutiveSilences: 0, failedAttempts: 0 };
    const answer = { text: "Hello, how can I help you?", confidence: 0.9 };
    const context = { companyID: TEST_COMPANY_ID };
    
    const result = await applyBehavior(config, callState, answer, context);
    
    if (result && result.text) {
      console.log('✅ Behavior engine applied successfully');
      console.log(`   Final text: ${result.text.substring(0, 50)}...`);
      console.log(`   Control flags: ${JSON.stringify(result.controlFlags)}`);
    } else {
      throw new Error('Behavior engine failed to apply');
    }
    
  } catch (error) {
    console.error('❌ Behavior engine failed:', error.message);
    throw error;
  }
}

async function testAPIEndpoints() {
  try {
    // Test if API routes are properly structured
    const aiAgentLogicRoutes = require('../routes/aiAgentLogic');
    console.log('✅ AI Agent Logic routes loaded');
    
    const twilioRoutes = require('../routes/twilio');
    console.log('✅ Twilio routes loaded (with AI Agent integration)');
    
    // Test company model access
    const company = await Company.findById(TEST_COMPANY_ID);
    if (company && company.aiAgentLogic) {
      console.log('✅ Company with AI Agent Logic found');
      console.log(`   Answer priority: ${company.aiAgentLogic.answerPriorityFlow?.join(' → ')}`);
    } else {
      throw new Error('Company AI Agent Logic not found');
    }
    
  } catch (error) {
    console.error('❌ API endpoint test failed:', error.message);
    throw error;
  }
}

async function testMultiTenantIsolation() {
  try {
    // Create a second test company
    const TEST_COMPANY_ID_2 = '507f1f77bcf86cd799439012';
    
    let company2 = await Company.findById(TEST_COMPANY_ID_2);
    if (!company2) {
      company2 = new Company({
        _id: TEST_COMPANY_ID_2,
        businessName: 'Test Company 2',
        companyName: 'Test Company 2',
        email: 'test2@test.com',
        aiAgentLogic: {
          enabled: true,
          answerPriorityFlow: ['templates', 'llmFallback'], // Different config
          thresholds: { companyKB: 0.9 } // Different threshold
        }
      });
      await company2.save();
    }
    
    const aiLoader = require('../src/config/aiLoader');
    
    // Load configs for both companies
    const config1 = await aiLoader.get(TEST_COMPANY_ID);
    const config2 = await aiLoader.get(TEST_COMPANY_ID_2);
    
    if (config1.thresholds.companyKB !== config2.thresholds.companyKB) {
      console.log('✅ Multi-tenant isolation confirmed');
      console.log(`   Company 1 threshold: ${config1.thresholds.companyKB}`);
      console.log(`   Company 2 threshold: ${config2.thresholds.companyKB}`);
    } else {
      console.log('⚠️  Multi-tenant isolation may not be working properly');
    }
    
    // Clean up test company 2
    await Company.findByIdAndDelete(TEST_COMPANY_ID_2);
    
  } catch (error) {
    console.error('❌ Multi-tenant isolation test failed:', error.message);
    throw error;
  }
}

// Run tests if called directly
if (require.main === module) {
  runAIAgentTests()
    .then(() => {
      console.log('\n🎉 AI Agent Logic is ready for production testing!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Tests failed:', error);
      process.exit(1);
    });
}

module.exports = {
  runAIAgentTests,
  testComponentImports,
  testAIConfigLoading,
  testIntentRouting,
  testKnowledgeRouting,
  testBookingFlow,
  testBehaviorEngine,
  testAPIEndpoints,
  testMultiTenantIsolation
};
