const ollamaService = require('./services/ollamaService');
const { checkKBWithFallback } = require('./middleware/checkKBWithOllama');
const TraceLogger = require('./utils/traceLogger');

/**
 * Comprehensive Ollama Integration Test Suite
 */

async function testOllamaIntegration() {
  console.log('🧪 OLLAMA INTEGRATION TEST SUITE');
  console.log('================================\n');

  let testsPassed = 0;
  let testsTotal = 0;

  // Test 1: Basic Ollama Service Health Check
  console.log('📋 Test 1: Ollama Service Health Check');
  testsTotal++;
  try {
    const healthResult = await ollamaService.checkHealth();
    if (healthResult) {
      console.log('✅ Ollama service is available');
      testsPassed++;
    } else {
      console.log('❌ Ollama service is not available');
      console.log('   Make sure Ollama is running: ollama serve');
    }
  } catch (error) {
    console.log('❌ Health check failed:', error.message);
  }
  console.log('');

  // Test 2: Connection and Model Information
  console.log('📋 Test 2: Connection and Model Information');
  testsTotal++;
  try {
    const connectionTest = await ollamaService.testConnection();
    if (connectionTest.success) {
      console.log('✅ Connection test successful');
      console.log(`   Service URL: ${connectionTest.service_url}`);
      console.log(`   Configured Model: ${connectionTest.configured_model}`);
      console.log(`   Available Models: ${connectionTest.available_models.length}`);
      connectionTest.available_models.forEach(model => {
        console.log(`     - ${model.name} (${(model.size / 1024 / 1024 / 1024).toFixed(1)}GB)`);
      });
      testsPassed++;
    } else {
      console.log('❌ Connection test failed:', connectionTest.error);
    }
  } catch (error) {
    console.log('❌ Connection test error:', error.message);
  }
  console.log('');

  // Test 3: Basic Text Generation
  console.log('📋 Test 3: Basic Text Generation');
  testsTotal++;
  try {
    const prompt = "What is HVAC? Please provide a brief explanation.";
    const result = await ollamaService.generateResponse(prompt, { max_tokens: 100 });
    
    if (result.success && result.text) {
      console.log('✅ Text generation successful');
      console.log(`   Response Time: ${result.responseTime}ms`);
      console.log(`   Model Used: ${result.model}`);
      console.log(`   Response: ${result.text.substring(0, 200)}...`);
      testsPassed++;
    } else {
      console.log('❌ Text generation failed:', result.error);
    }
  } catch (error) {
    console.log('❌ Text generation error:', error.message);
  }
  console.log('');

  // Test 4: Agent-Specific Response Generation
  console.log('📋 Test 4: Agent-Specific Response Generation');
  testsTotal++;
  try {
    const question = "My air conditioner is making a loud noise. What should I do?";
    const context = {
      companyName: 'CoolAir HVAC',
      tradeCategory: 'hvac-residential',
      personality: 'professional and helpful',
      conversationHistory: [],
      customInstructions: 'Provide helpful HVAC advice but recommend professional service when needed'
    };
    
    const result = await ollamaService.generateAgentResponse(question, context);
    
    if (result.success && result.text) {
      console.log('✅ Agent response generation successful');
      console.log(`   Response Time: ${result.responseTime}ms`);
      console.log(`   Context-Aware Response: ${result.text}`);
      testsPassed++;
    } else {
      console.log('❌ Agent response generation failed:', result.error);
    }
  } catch (error) {
    console.log('❌ Agent response error:', error.message);
  }
  console.log('');

  // Test 5: Knowledge Base + Ollama Fallback Integration
  console.log('📋 Test 5: KB + Ollama Fallback Integration');
  testsTotal++;
  try {
    // Mock company data
    const mockCompany = {
      _id: 'test-company-id',
      companyName: 'Test HVAC Company',
      tradeCategory: 'hvac-residential',
      aiSettings: {
        personality: 'friendly and professional',
        ollamaFallbackEnabled: true
      }
    };

    const traceLogger = new TraceLogger();
    const question = "How often should I change my air filter?"; // This likely won't match KB
    
    const result = await checkKBWithFallback(question, mockCompany._id, traceLogger, {
      ollamaFallbackEnabled: true,
      company: mockCompany,
      conversationHistory: []
    });
    
    console.log(`   Source: ${result.source}`);
    console.log(`   Confidence: ${result.confidence}`);
    console.log(`   Fallback Used: ${result.fallbackUsed}`);
    
    if (result.answer) {
      console.log('✅ KB + Ollama fallback working');
      console.log(`   Response: ${result.answer.substring(0, 150)}...`);
      testsPassed++;
    } else {
      console.log('❌ KB + Ollama fallback failed');
      console.log(`   Error: ${result.error || 'No answer generated'}`);
    }
    
    console.log(`   Trace: ${result.trace}`);
  } catch (error) {
    console.log('❌ KB + Ollama integration error:', error.message);
  }
  console.log('');

  // Test 6: Performance Benchmark
  console.log('📋 Test 6: Performance Benchmark (5 requests)');
  testsTotal++;
  try {
    const testQuestions = [
      "What is HVAC maintenance?",
      "How do I troubleshoot a furnace?", 
      "What causes air conditioning problems?",
      "When should I call a technician?",
      "How can I improve my indoor air quality?"
    ];

    const startTime = Date.now();
    const results = [];
    
    for (const question of testQuestions) {
      const result = await ollamaService.generateAgentResponse(question, {
        companyName: 'Test Company',
        tradeCategory: 'hvac'
      });
      results.push(result);
    }
    
    const totalTime = Date.now() - startTime;
    const successfulRequests = results.filter(r => r.success).length;
    const avgResponseTime = results.reduce((sum, r) => sum + r.responseTime, 0) / results.length;
    
    console.log(`✅ Performance test completed`);
    console.log(`   Total Time: ${totalTime}ms`);
    console.log(`   Successful Requests: ${successfulRequests}/${testQuestions.length}`);
    console.log(`   Average Response Time: ${avgResponseTime.toFixed(0)}ms`);
    console.log(`   Requests per Second: ${(testQuestions.length / (totalTime / 1000)).toFixed(2)}`);
    
    if (successfulRequests >= testQuestions.length * 0.8) { // 80% success rate
      testsPassed++;
    }
    
  } catch (error) {
    console.log('❌ Performance benchmark error:', error.message);
  }
  console.log('');

  // Test 7: Error Handling and Fallback
  console.log('📋 Test 7: Error Handling and Graceful Degradation');
  testsTotal++;
  try {
    // Test with invalid model
    const originalModel = ollamaService.model;
    ollamaService.model = 'non-existent-model:latest';
    
    const result = await ollamaService.generateResponse("Test question");
    
    // Restore original model
    ollamaService.model = originalModel;
    
    if (!result.success) {
      console.log('✅ Error handling working correctly');
      console.log(`   Error caught: ${result.error}`);
      testsPassed++;
    } else {
      console.log('❌ Error handling not working - should have failed');
    }
    
  } catch (error) {
    console.log('✅ Error handling working (exception caught):', error.message);
    testsPassed++;
  }
  console.log('');

  // Summary
  console.log('📊 TEST SUMMARY');
  console.log('===============');
  console.log(`Tests Passed: ${testsPassed}/${testsTotal}`);
  console.log(`Success Rate: ${((testsPassed / testsTotal) * 100).toFixed(1)}%`);
  
  if (testsPassed === testsTotal) {
    console.log('🎉 ALL TESTS PASSED! Ollama integration is working perfectly.');
  } else if (testsPassed >= testsTotal * 0.8) {
    console.log('✅ Most tests passed. Ollama integration is mostly working.');
  } else {
    console.log('⚠️  Several tests failed. Check Ollama configuration and connectivity.');
  }
  
  console.log('\n💡 NEXT STEPS:');
  if (testsPassed < testsTotal) {
    console.log('1. Make sure Ollama is running: ollama serve');
    console.log('2. Check that the configured model is downloaded: ollama pull llama3.2:3b');
    console.log('3. Verify network connectivity to http://localhost:11434');
  } else {
    console.log('1. Integration is ready for production use');
    console.log('2. Monitor performance in production environment');
    console.log('3. Consider adjusting timeout and model settings based on usage');
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  testOllamaIntegration()
    .then(() => {
      console.log('\n✅ Test suite completed');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Test suite failed:', error);
      process.exit(1);
    });
}

module.exports = {
  testOllamaIntegration
};
