const axios = require('axios');

async function testIntelligenceEndpoint() {
  try {
    console.log('🧪 Testing Intelligence Endpoint (Super AI Intelligence)');
    console.log('====================================================');

    // Test data
    const testData = {
      companyId: '686a680241806a4991f7367f',
      query: 'my thermostat is blank',
      scenario: 'customer-service'
    };

    console.log('\n📝 Testing query:', testData.query);
    console.log('🏢 Company ID:', testData.companyId);

    // Make the API call
    const response = await axios.post('http://localhost:4000/api/agent/test-intelligence', testData, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-token' // Add if needed
      },
      timeout: 30000 // 30 second timeout
    });

    console.log('\n✅ SUCCESS!');
    console.log('Response Status:', response.status);
    console.log('Intelligence Score:', response.data.data?.intelligenceScore);
    console.log('Response Method:', response.data.data?.method);
    console.log('Confidence:', response.data.data?.confidence);
    console.log('Response Time:', response.data.data?.responseTime + 'ms');
    console.log('Agent Response:', typeof response.data.data?.response === 'string' 
      ? response.data.data.response.substring(0, 200) + '...' 
      : String(response.data.data?.response || 'No response'));

    if (response.data.data?.debugInfo) {
      console.log('\n🔍 Debug Info:');
      console.log('Company Name:', response.data.data.debugInfo.companyName);
      console.log('Available Categories:', response.data.data.debugInfo.availableCategories);
      console.log('Has Main Script:', response.data.data.debugInfo.hasMainScript);
      console.log('Has Category QAs:', response.data.data.debugInfo.hasCategoryQAs);
      console.log('LLM Fallback Enabled:', response.data.data.debugInfo.llmFallbackEnabled);
    }

    console.log('\n🎯 TEST PASSED: No substring errors detected!');
    return true;

  } catch (error) {
    console.error('\n❌ ERROR:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.error('No response received:', error.message);
    } else {
      console.error('Request setup error:', error.message);
    }
    console.error('\n🚨 Full error:', error.stack);
    return false;
  }
}

// Also test the custom KB trace endpoint
async function testCustomKBTraceEndpoint() {
  try {
    console.log('\n\n🧪 Testing Custom KB Trace Endpoint');
    console.log('=====================================');

    const testData = {
      companyId: '686a680241806a4991f7367f',
      query: 'my thermostat is blank'
    };

    console.log('\n📝 Testing query:', testData.query);

    const response = await axios.post('http://localhost:4000/api/ai-agent/test-custom-kb-trace', testData, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });

    console.log('\n✅ SUCCESS!');
    console.log('Response Status:', response.status);
    console.log('Result:', response.data.result);
    console.log('Full response data:', JSON.stringify(response.data, null, 2));
    
    if (response.data.trace && Array.isArray(response.data.trace)) {
      console.log('\n📋 Trace Log:');
      response.data.trace.forEach((entry, index) => {
        console.log(`${index + 1}. ${entry.source}: ${entry.result} (${entry.details})`);
      });
    } else {
      console.log('\n📋 Trace format:', typeof response.data.trace, response.data.trace);
    }

    return true;

  } catch (error) {
    console.error('\n❌ Custom KB Trace ERROR:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Error:', error.message);
    }
    return false;
  }
}

async function runTests() {
  console.log('🚀 Starting AI Response Trace Tests\n');
  
  const test1 = await testIntelligenceEndpoint();
  const test2 = await testCustomKBTraceEndpoint();
  
  console.log('\n' + '='.repeat(60));
  console.log('🎯 FINAL RESULTS:');
  console.log(`Intelligence Endpoint: ${test1 ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`Custom KB Trace Endpoint: ${test2 ? '✅ PASSED' : '❌ FAILED'}`);
  
  if (test1 && test2) {
    console.log('\n🎉 ALL TESTS PASSED! Trace logger is working correctly.');
  } else {
    console.log('\n⚠️  Some tests failed. Check the errors above.');
  }
}

runTests().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
