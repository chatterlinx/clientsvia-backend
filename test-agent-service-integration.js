/**
 * Test Agent Integration with Service Issue Flow
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

const { answerQuestion } = require('./services/agent');

async function testAgentIntegration() {
  console.log('🧪 Testing Agent Integration with Service Issue Flow...\n');
  
  // Use a real company ID from the database
  const testCompanyId = '66b5d10bb8b60bfca5ba82a1'; // Penguin Air Corp
  
  const testCases = [
    {
      question: "My AC stopped working this morning.",
      description: "Classic AC service issue - should trigger booking flow"
    },
    {
      question: "The air conditioner is not working and it's really hot!",
      description: "AC urgency case - should trigger booking flow"
    },
    {
      question: "What are your business hours?",
      description: "Non-service issue - should use normal flow"
    }
  ];
  
  for (const testCase of testCases) {
    console.log(`\n📞 Testing: "${testCase.question}"`);
    console.log(`📝 Expected: ${testCase.description}\n`);
    
    try {
      const result = await answerQuestion(
        testCompanyId,
        testCase.question,
        'concise',
        [],
        '',
        'friendly',
        '',
        '',
        'test-call-123'
      );
      
      console.log('✅ Agent Response:');
      console.log(`   Text: "${result.text}"`);
      console.log(`   Escalate: ${result.escalate}`);
      
      if (result.proceedToBooking) {
        console.log('🎯 BOOKING FLOW TRIGGERED!');
        console.log(`   Proceed to Booking: ${result.proceedToBooking}`);
        
        if (result.bookingFlow) {
          console.log('📋 Booking Flow Details:');
          console.log(`   Step: ${result.bookingFlow.step}`);
          console.log(`   Service Type: ${result.bookingFlow.serviceType}`);
          console.log(`   Urgency: ${result.bookingFlow.urgency}`);
          console.log(`   Issue: ${result.bookingFlow.issueDescription}`);
        }
      }
      
      console.log('---');
      
    } catch (error) {
      console.error(`❌ Error testing "${testCase.question}":`, error.message);
    }
  }
  
  console.log('\n🎉 Agent Integration Test Complete!');
  
  // Close the database connection
  await mongoose.connection.close();
}

testAgentIntegration().catch(console.error);
