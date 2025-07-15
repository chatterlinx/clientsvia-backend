// Script to add a proper thermostat Q&A entry to improve matching
const { MongoClient, ObjectId } = require('mongodb');

async function addThermostatQA() {
  console.log('🔧 ADDING THERMOSTAT Q&A ENTRY FOR BETTER MATCHING\n');
  
  // Simulate adding the Q&A entry that should exist based on QA_OPTIMIZATION_GUIDE.md
  console.log('📝 Recommended thermostat Q&A entry:');
  
  const thermostatQA = {
    question: 'thermostat problems',
    answer: 'I can help you with thermostat issues. Is the display completely blank, or are you seeing any error messages? This will help me determine if it needs a battery replacement or a technician visit.',
    keywords: [
      'thermostat blank',
      'thermostat not working',
      'thermostat display', 
      'thermostat screen',
      'thermostat dead',
      'thermostat frozen',
      'blank thermostat',
      'dead thermostat',
      'thermostat reset'
    ]
  };
  
  console.log('Q:', thermostatQA.question);
  console.log('A:', thermostatQA.answer);
  console.log('Keywords:', thermostatQA.keywords.join(', '));
  
  // Test the matching with our improved algorithm
  console.log('\n🎯 Testing improved Q&A matching:');
  
  const { findCachedAnswer } = require('./utils/aiAgent');
  
  const testQuestions = [
    'my thermostat is blank',
    'thermostat blank', 
    'thermostat display blank',
    'my thermostat is blank and its leaking water' // The problematic case
  ];
  
  testQuestions.forEach(question => {
    console.log(`\n❓ "${question}"`);
    const result = findCachedAnswer([thermostatQA], question, 0.25);
    if (result) {
      console.log(`✅ MATCHED: "${result.substring(0, 60)}..."`);
    } else {
      console.log(`❌ NO MATCH`);
    }
  });
  
  console.log('\n📋 CategoryQAs format for adding to company:');
  console.log('Q: ' + thermostatQA.question);
  console.log('A: ' + thermostatQA.answer);
  console.log('');
}

addThermostatQA()
  .then(() => {
    console.log('✅ Thermostat Q&A analysis complete');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
