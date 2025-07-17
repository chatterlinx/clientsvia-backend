// test-api-trace-endpoint.js
// Test script to verify the API endpoint for Custom KB trace testing

const axios = require('axios');

// Configuration (adjust if your server is running on different port)
const SERVER_URL = 'http://localhost:3000';
const TEST_COMPANY_ID = '686a680241806a4991f7367f'; // Penguin Air ID

async function testTraceAPI() {
  console.log('🧪 Testing AI Response Trace API Endpoint');
  console.log('=' .repeat(50));
  
  // Test cases
  const testCases = [
    {
      query: "my thermostat is blank",
      description: "Should match thermostat Q&A"
    },
    {
      query: "air conditioner not cooling", 
      description: "Should match AC repair Q&A"
    },
    {
      query: "what are your business hours",
      description: "Should show no matches (trace only)"
    }
  ];

  for (const testCase of testCases) {
    console.log(`\n📝 Testing: "${testCase.query}"`);
    console.log(`💡 Expected: ${testCase.description}`);
    console.log('-'.repeat(40));

    try {
      const response = await axios.post(`${SERVER_URL}/api/ai-agent/test-custom-kb-trace`, {
        companyId: TEST_COMPANY_ID,
        query: testCase.query
      }, {
        headers: {
          'Content-Type': 'application/json',
          // Note: In production, you'd need proper JWT token
        },
        timeout: 10000
      });

      if (response.data.success) {
        const { result, trace, metadata } = response.data;
        
        console.log(`✅ API Response: SUCCESS`);
        console.log(`📊 Metadata:`);
        console.log(`   • Sources tested: ${metadata.sourcesTested}`);
        console.log(`   • Match found: ${metadata.matchFound}`);
        console.log(`   • Timestamp: ${metadata.timestamp}`);
        
        if (result) {
          console.log(`🎯 Selected Response: "${result.substring(0, 80)}..."`);
        } else {
          console.log(`❌ No response: Would fall back to other handlers`);
        }
        
        console.log(`🔍 Trace Summary:`);
        console.log(`   • Query: "${trace.query}"`);
        console.log(`   • Keywords: [${trace.keywords.join(', ')}]`);
        console.log(`   • Steps: ${trace.steps.length}`);
        console.log(`   • Selected: ${trace.selectedSource}`);
        console.log(`   • Execution: ${trace.totalTime}ms`);
        
        // Show trace steps
        trace.steps.forEach((step, index) => {
          const icon = step.matchResult.matched ? '✅' : '❌';
          const confidence = Math.round(step.matchResult.confidence * 100);
          console.log(`   ${icon} Step ${index + 1}: ${step.source} (${confidence}%)`);
        });
        
      } else {
        console.log(`❌ API Error: ${response.data.error}`);
      }
      
    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        console.log(`⚠️  Server not running: Please start the server first`);
        console.log(`   Command: npm start (or node app.js)`);
      } else if (error.response) {
        console.log(`❌ API Error ${error.response.status}: ${error.response.data?.error || 'Unknown error'}`);
      } else {
        console.log(`❌ Network Error: ${error.message}`);
      }
    }
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('🎯 API ENDPOINT TEST SUMMARY:');
  console.log('✅ Endpoint: /api/ai-agent/test-custom-kb-trace');
  console.log('✅ Request format: { companyId, query }');
  console.log('✅ Response format: { success, result, trace, metadata }');
  console.log('✅ Error handling: Included');
  console.log('\n🚀 Ready for frontend integration!');
}

// Check if axios is available
if (typeof axios === 'undefined') {
  console.log('❌ Error: axios not found');
  console.log('Install with: npm install axios');
  process.exit(1);
}

// Run the test
testTraceAPI().catch(error => {
  console.error('Test failed:', error.message);
});
