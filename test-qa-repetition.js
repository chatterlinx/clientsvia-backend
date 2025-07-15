#!/usr/bin/env node

// Test Q&A Repetition Detection
// This script tests that the agent doesn't repeat the same Q&A response multiple times

const { redisClient } = require('./clients');
const KnowledgeEntry = require('./models/KnowledgeEntry');
const { findCachedAnswer } = require('./utils/aiAgent');
const Company = require('./models/Company');

async function testQARepetition() {
  console.log('🧪 Testing Q&A Repetition Detection...\n');

  // Test case 1: Pricing questions
  console.log('📊 Test Case 1: Pricing Questions');
  const pricingQuestions = [
    "What are your prices?",
    "How much do you charge?", 
    "What do you charge for service calls?",
    "What are your prices again?"
  ];

  // Simulate conversation history with pricing already answered
  const testCallSid = 'test-call-' + Date.now();
  const historyKey = `conversation-history:${testCallSid}`;
  
  const conversationHistory = [
    { role: 'user', text: 'What are your prices?' },
    { role: 'assistant', text: 'Our service calls are just $49, and that includes a full diagnostic. If we find the problem and you approve the repair, that $49 goes towards the total cost.' },
    { role: 'user', text: 'That sounds good' },
    { role: 'assistant', text: 'Great! Is there anything else I can help you with today?' }
  ];
  
  await redisClient.setEx(historyKey, 60, JSON.stringify(conversationHistory));

  // Try to get company data
  const testCompany = await Company.findOne().limit(1);
  if (!testCompany) {
    console.log('❌ No company found for testing');
    return;
  }

  // Get Q&A entries
  const qnaEntries = await KnowledgeEntry.find({ 
    companyId: testCompany._id,
    entryType: 'qa' 
  });

  console.log(`Found ${qnaEntries.length} Q&A entries for company: ${testCompany.companyName}`);

  for (const question of pricingQuestions) {
    console.log(`\n🔍 Testing: "${question}"`);
    
    const fuzzyThreshold = 0.25;
    const cachedAnswer = findCachedAnswer(qnaEntries, question, fuzzyThreshold);
    
    if (cachedAnswer) {
      console.log(`✅ Q&A Match Found: ${cachedAnswer.substring(0, 100)}...`);
      
      // Check for repetition (simulate the logic from twilio.js)
      const storedHistory = await redisClient.get(historyKey);
      let history = [];
      if (storedHistory) {
        history = JSON.parse(storedHistory);
      }
      
      const recentAssistantMessages = history
        .filter(msg => msg.role === 'assistant')
        .slice(-3);
      
      const isRepeatingQA = recentAssistantMessages.some(msg => 
        msg.text && msg.text.includes(cachedAnswer.substring(0, 50))
      );
      
      if (isRepeatingQA) {
        console.log(`🔄 REPETITION DETECTED - Would use clarification instead`);
        const clarificationResponses = [
          "I've already shared that information with you. Is there something specific you'd like to know more about?",
          "As I mentioned, " + cachedAnswer.substring(0, 100) + "... Is there another way I can help you?",
          "I provided those details already. Do you have any other questions I can help with?",
          "We covered that just now. What else would you like to know about our services?"
        ];
        const clarification = clarificationResponses[Math.floor(Math.random() * clarificationResponses.length)];
        console.log(`📢 Clarification: "${clarification}"`);
      } else {
        console.log(`✅ No repetition detected - would proceed with Q&A response`);
      }
    } else {
      console.log(`❌ No Q&A match found for: "${question}"`);
    }
  }

  console.log('\n🧪 Test Case 2: Thermostat Questions');
  const thermostatQuestions = [
    "My thermostat is blank",
    "The thermostat screen is blank", 
    "Thermostat display is not working",
    "My thermostat screen is blank again"
  ];

  // Reset conversation with thermostat already answered
  const thermostatHistory = [
    { role: 'user', text: 'My thermostat is blank' },
    { role: 'assistant', text: 'A blank thermostat display usually indicates a power issue. First, check if the thermostat has batteries and replace them if needed. If it\'s hardwired, check your circuit breaker.' },
    { role: 'user', text: 'Ok I checked that' },
    { role: 'assistant', text: 'Good! Did replacing the batteries or checking the breaker help?' }
  ];
  
  await redisClient.setEx(historyKey, 60, JSON.stringify(thermostatHistory));

  for (const question of thermostatQuestions) {
    console.log(`\n🔍 Testing: "${question}"`);
    
    const fuzzyThreshold = 0.25;
    const cachedAnswer = findCachedAnswer(qnaEntries, question, fuzzyThreshold);
    
    if (cachedAnswer) {
      console.log(`✅ Q&A Match Found: ${cachedAnswer.substring(0, 100)}...`);
      
      // Check for repetition
      const storedHistory = await redisClient.get(historyKey);
      let history = [];
      if (storedHistory) {
        history = JSON.parse(storedHistory);
      }
      
      const recentAssistantMessages = history
        .filter(msg => msg.role === 'assistant')
        .slice(-3);
      
      const isRepeatingQA = recentAssistantMessages.some(msg => 
        msg.text && msg.text.includes(cachedAnswer.substring(0, 50))
      );
      
      if (isRepeatingQA) {
        console.log(`🔄 REPETITION DETECTED - Would use clarification instead`);
      } else {
        console.log(`✅ No repetition detected - would proceed with Q&A response`);
      }
    } else {
      console.log(`❌ No Q&A match found for: "${question}"`);
    }
  }

  // Clean up test data
  await redisClient.del(historyKey);
  console.log('\n✅ Q&A Repetition Detection Test Complete!');
}

// Run the test
testQARepetition()
  .then(() => {
    console.log('\n🎉 All tests completed!');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
  });
