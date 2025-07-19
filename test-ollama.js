// test-ollama.js - Simple test script for Ollama integration
// Run this to verify your Ollama setup is working

const localLLM = require('./services/localLLM');

async function testOllamaIntegration() {
  console.log('🤖 Testing Ollama Integration...\n');

  // Test 1: Check service availability
  console.log('1. Checking if Ollama service is running...');
  const isAvailable = await localLLM.isAvailable();
  console.log(`   Service status: ${isAvailable ? '✅ Online' : '❌ Offline'}\n`);

  if (!isAvailable) {
    console.log('❌ Ollama service is not running. Please start Ollama first.');
    return;
  }

  // Test 2: Check model availability
  console.log('2. Checking if model is downloaded...');
  const isModelReady = await localLLM.isModelAvailable();
  console.log(`   Model status: ${isModelReady ? '✅ Ready' : '❌ Not Ready'}\n`);

  if (!isModelReady) {
    console.log('❌ Model not ready. Please wait for download to complete.');
    console.log('   You can check progress with: ollama list');
    return;
  }

  // Test 3: Simple query
  console.log('3. Testing simple query...');
  const simpleResponse = await localLLM.queryLLM('Hello! Can you help me with customer service?');
  console.log('   Question: Hello! Can you help me with customer service?');
  console.log(`   Response: ${simpleResponse}\n`);

  // Test 4: Customer service scenario
  console.log('4. Testing customer service scenario...');
  const customerQuery = 'I need help with my booking. Can you tell me your hours?';
  const companyContext = 'We are a home services company that provides HVAC repair and maintenance.';
  
  const serviceResponse = await localLLM.generateCustomerServiceResponse(
    customerQuery, 
    companyContext
  );
  
  console.log('   Customer: I need help with my booking. Can you tell me your hours?');
  console.log('   Company: Home services company (HVAC repair and maintenance)');
  console.log(`   AI Response: ${serviceResponse}\n`);

  // Test 5: Get status
  console.log('5. Getting service status...');
  const status = await localLLM.getStatus();
  console.log('   Status:', JSON.stringify(status, null, 2));

  console.log('\n🎉 Ollama integration test complete!');
}

// Run the test
if (require.main === module) {
  testOllamaIntegration().catch(console.error);
}

module.exports = testOllamaIntegration;
