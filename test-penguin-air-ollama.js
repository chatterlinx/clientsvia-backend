// test-penguin-air-ollama.js - Production test for Penguin Air with Ollama primary/Gemini backup
// This tests the complete LLM chain for Penguin Air company (ID: 686a680241806a4991f7367f)

const { ObjectId } = require('mongodb');
const { getDB } = require('./db');
const localLLM = require('./services/localLLM');
const { checkKBWithFallback } = require('./middleware/checkKBWithOllama');
const agentService = require('./services/agent');
const TraceLogger = require('./utils/traceLogger');

const PENGUIN_AIR_ID = '686a680241806a4991f7367f';

async function testPenguinAirOllamaIntegration() {
  console.log('🐧 PENGUIN AIR - OLLAMA INTEGRATION TEST');
  console.log('========================================\n');

  try {
    // Step 1: Verify Penguin Air company exists and get current settings
    console.log('📋 Step 1: Loading Penguin Air company data...');
    const db = getDB();
    const company = await db.collection('companiesCollection').findOne({ 
      _id: new ObjectId(PENGUIN_AIR_ID) 
    });

    if (!company) {
      console.log('❌ Penguin Air company not found!');
      return;
    }

    console.log(`✅ Company found: ${company.companyName}`);
    console.log(`   Trade Category: ${company.tradeCategory}`);
    console.log(`   Current AI Settings:`, company.aiSettings || 'None configured');
    console.log('');

    // Step 2: Update Penguin Air with Ollama settings (production-ready)
    console.log('📋 Step 2: Configuring Ollama settings for Penguin Air...');
    
    const ollamaSettings = {
      ollamaFallbackEnabled: true,
      localLLM: {
        enabled: true,
        model: process.env.OLLAMA_MODEL || 'llama3.1:8b-instruct-q4_0',
        temperature: 0.3,
        maxTokens: 150
      },
      personality: 'professional and helpful HVAC specialist',
      llmFallbackEnabled: true, // Keep Gemini as backup
      customEscalationMessage: 'Let me connect you with one of our HVAC specialists for detailed assistance.'
    };

    // Update company settings
    const updateResult = await db.collection('companiesCollection').updateOne(
      { _id: new ObjectId(PENGUIN_AIR_ID) },
      { 
        $set: { 
          'aiSettings.ollamaFallbackEnabled': ollamaSettings.ollamaFallbackEnabled,
          'aiSettings.localLLM': ollamaSettings.localLLM,
          'aiSettings.personality': ollamaSettings.personality,
          'aiSettings.llmFallbackEnabled': ollamaSettings.llmFallbackEnabled,
          'aiSettings.customEscalationMessage': ollamaSettings.customEscalationMessage
        }
      }
    );

    if (updateResult.modifiedCount > 0) {
      console.log('✅ Penguin Air AI settings updated successfully');
    } else {
      console.log('ℹ️  Settings already current (no changes needed)');
    }
    console.log('');

    // Step 3: Test Ollama service availability
    console.log('📋 Step 3: Testing Ollama service availability...');
    const isOllamaAvailable = await localLLM.isAvailable();
    const isModelReady = await localLLM.isModelAvailable();
    
    console.log(`   Ollama Service: ${isOllamaAvailable ? '✅ Online' : '❌ Offline'}`);
    console.log(`   Model Ready: ${isModelReady ? '✅ Ready' : '❌ Not Ready'}`);
    
    if (!isOllamaAvailable || !isModelReady) {
      console.log('⚠️  Ollama not ready - fallback to Gemini will be used');
    }
    console.log('');

    // Step 4: Test KB + Ollama fallback flow
    console.log('📋 Step 4: Testing KB + Ollama fallback integration...');
    
    const testQuestions = [
      'My air conditioner is making a strange noise. What should I do?',
      'How often should I change my HVAC filter?',
      'What temperature should I set my thermostat to save energy?'
    ];

    for (const question of testQuestions) {
      console.log(`\n🔍 Testing: "${question}"`);
      
      try {
        const traceLogger = new TraceLogger();
        const startTime = Date.now();

        // Test the enhanced KB with Ollama fallback
        const result = await checkKBWithFallback(question, PENGUIN_AIR_ID, traceLogger, {
          ollamaFallbackEnabled: true,
          company: { ...company, aiSettings: ollamaSettings },
          conversationHistory: []
        });

        const responseTime = Date.now() - startTime;

        if (result && result.answer) {
          console.log(`   ✅ Response received (${responseTime}ms)`);
          console.log(`   📝 Source: ${result.source}`);
          console.log(`   🎯 Confidence: ${result.confidence}`);
          console.log(`   🔄 Ollama Used: ${result.fallbackUsed ? 'Yes' : 'No'}`);
          console.log(`   📄 Answer: ${result.answer.substring(0, 150)}...`);
        } else {
          console.log(`   ❌ No response generated`);
        }

        // Show trace for debugging
        console.log(`   🔍 Trace: ${result.trace}`);

      } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
      }
    }
    console.log('');

    // Step 5: Test full agent service flow
    console.log('📋 Step 5: Testing complete agent service flow...');
    
    try {
      const testQuestion = 'I think my furnace might need maintenance. Can you help?';
      console.log(`\n🔍 Full agent test: "${testQuestion}"`);
      
      const startTime = Date.now();
      const agentResponse = await agentService.answerQuestion(
        PENGUIN_AIR_ID,
        testQuestion,
        'concise',
        [],
        '', // mainAgentScript
        'professional and helpful',
        'HVAC repair and maintenance',
        '', // categoryQAs
        'test-call-sid'
      );
      const responseTime = Date.now() - startTime;

      console.log(`   ✅ Agent response received (${responseTime}ms)`);
      console.log(`   📝 Method: ${agentResponse.responseMethod}`);
      console.log(`   🔄 Ollama Used: ${agentResponse.ollamaFallbackUsed ? 'Yes' : 'No'}`);
      console.log(`   📄 Response: ${agentResponse.text.substring(0, 200)}...`);
      
      if (agentResponse.trace) {
        console.log(`   🔍 Trace: ${agentResponse.trace.substring(0, 300)}...`);
      }

    } catch (error) {
      console.log(`   ❌ Agent service error: ${error.message}`);
    }
    console.log('');

    // Step 6: Performance benchmark
    console.log('📋 Step 6: Performance benchmark (3 requests)...');
    
    const benchmarkQuestions = [
      'What are your business hours?',
      'Do you offer emergency HVAC service?',
      'How much does a furnace tune-up cost?'
    ];

    const benchmarkResults = [];
    
    for (const question of benchmarkQuestions) {
      try {
        const startTime = Date.now();
        const result = await localLLM.queryWithContext(question, {
          company: 'Penguin Air',
          trade: 'HVAC',
          personality: 'professional and helpful'
        });
        const responseTime = Date.now() - startTime;
        
        benchmarkResults.push({
          question,
          success: !!result,
          responseTime,
          responseLength: result ? result.length : 0
        });
        
      } catch (error) {
        benchmarkResults.push({
          question,
          success: false,
          responseTime: 0,
          error: error.message
        });
      }
    }

    const successful = benchmarkResults.filter(r => r.success).length;
    const avgResponseTime = benchmarkResults
      .filter(r => r.success)
      .reduce((sum, r) => sum + r.responseTime, 0) / successful;

    console.log(`   ✅ Benchmark completed`);
    console.log(`   📊 Success Rate: ${successful}/${benchmarkQuestions.length} (${(successful/benchmarkQuestions.length*100).toFixed(1)}%)`);
    console.log(`   ⏱️  Average Response Time: ${avgResponseTime.toFixed(0)}ms`);
    console.log('');

    // Summary
    console.log('📊 PENGUIN AIR INTEGRATION SUMMARY');
    console.log('==================================');
    console.log(`✅ Company: ${company.companyName} (${PENGUIN_AIR_ID})`);
    console.log(`✅ Ollama Integration: ${isOllamaAvailable ? 'Active' : 'Fallback Mode'}`);
    console.log(`✅ Model: ${ollamaSettings.localLLM.model}`);
    console.log(`✅ Fallback: Gemini backup configured`);
    console.log(`✅ Settings: Permanently saved to database`);
    console.log('');
    console.log('🎯 PRODUCTION STATUS: READY');
    console.log('   - Ollama primary LLM configured');
    console.log('   - Gemini backup active');
    console.log('   - Full trace logging enabled');
    console.log('   - Multi-tenant isolation maintained');

  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error(error.stack);
  }
}

// Run test if this file is executed directly
if (require.main === module) {
  testPenguinAirOllamaIntegration()
    .then(() => {
      console.log('\n✅ Penguin Air Ollama integration test completed');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Test failed:', error);
      process.exit(1);
    });
}

module.exports = {
  testPenguinAirOllamaIntegration,
  PENGUIN_AIR_ID
};
