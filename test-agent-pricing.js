/**
 * Test Agent Performance with Pricing Questions
 */

const axios = require('axios');

async function testAgentWithPricing() {
  console.log('🧪 Testing Agent Performance with Pricing Questions...\n');
  
  const baseUrl = 'http://localhost:4000';
  
  // Test scenarios for pricing
  const testScenarios = [
    {
      name: 'Service Call Fee Question',
      transcript: 'How much is your service call?',
      expectedKeywords: ['$49', 'service call', 'diagnostic']
    },
    {
      name: 'AC Service/Tune-up Question',
      transcript: 'How much is your AC serviced?',
      expectedKeywords: ['$89', 'tune-up', 'full service']
    },
    {
      name: 'General Repair Pricing',
      transcript: 'How much do repairs cost?',
      expectedKeywords: ['repair', 'cost', 'range', '$150']
    },
    {
      name: 'Repetition Test - Same Question Twice',
      transcript: 'What do you charge for service calls?',
      expectedKeywords: ['$49', 'service call']
    }
  ];
  
  console.log('📋 Available Test Scenarios:');
  testScenarios.forEach((scenario, index) => {
    console.log(`   ${index + 1}. ${scenario.name}: "${scenario.transcript}"`);
  });
  console.log();
  
  // Test each scenario with a generic company ID approach
  for (const [index, scenario] of testScenarios.entries()) {
    console.log(`🎯 Test ${index + 1}: ${scenario.name}`);
    console.log(`   Question: "${scenario.transcript}"`);
    
    try {
      // Try to use agent intelligence test endpoint with simple parameters
      const testData = {
        transcript: scenario.transcript,
        // Try common test patterns
        testMode: true
      };
      
      const response = await axios.post(`${baseUrl}/api/agent/process-transcript`, testData, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      console.log(`   ✅ Response received:`);
      if (response.data && response.data.response) {
        console.log(`   📝 Answer: ${response.data.response.substring(0, 120)}...`);
        
        // Check if expected keywords are present
        const answerLower = response.data.response.toLowerCase();
        const foundKeywords = scenario.expectedKeywords.filter(keyword => 
          answerLower.includes(keyword.toLowerCase())
        );
        
        if (foundKeywords.length > 0) {
          console.log(`   ✅ Found expected keywords: ${foundKeywords.join(', ')}`);
        } else {
          console.log(`   ⚠️  Expected keywords not found: ${scenario.expectedKeywords.join(', ')}`);
        }
      } else {
        console.log(`   📄 Raw response: ${JSON.stringify(response.data).substring(0, 100)}...`);
      }
      
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
      if (error.response && error.response.data) {
        console.log(`   📄 Error details: ${JSON.stringify(error.response.data)}`);
      }
    }
    
    console.log();
    
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('🎉 Testing completed!');
  console.log('\n📊 Summary:');
  console.log('- The agent should now distinguish between service call fees and full AC service pricing');
  console.log('- Service calls should mention $49 diagnostic fee');
  console.log('- AC service/tune-ups should mention $89+ pricing');
  console.log('- Repair questions should provide cost ranges');
}

// Run the test
testAgentWithPricing().catch(console.error);
