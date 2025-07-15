// Test script to debug the specific "my thermostat is blank" matching issue
console.log('🔍 DEBUGGING: "My thermostat is blank" Q&A Matching Issue\n');

const { findCachedAnswer } = require('./utils/aiAgent');

// Mock Q&A entries based on the QA_OPTIMIZATION_GUIDE.md
const testQAEntries = [
  {
    question: 'thermostat problems',
    answer: 'I can help you with thermostat issues. Is the display completely blank, or are you seeing any error messages? This will help me determine if it needs a battery replacement or a technician visit.',
    keywords: [
      'thermostat blank',
      'thermostat not working', 
      'thermostat display',
      'thermostat screen',
      'thermostat dead',
      'thermostat frozen'
    ]
  },
  {
    question: 'ac repair',
    answer: 'We\'ll be happy to schedule your AC repair as soon as possible. Would you like the first available appointment, or do you have a specific time in mind?',
    keywords: [
      'ac repair',
      'air conditioner repair',
      'ac not cooling',
      'ac stopped working',
      'ac unit broken',
      'air conditioner broken'
    ]
  },
  {
    question: 'water leak from ac',
    answer: 'Water leaking from your AC unit usually indicates a clogged drain or condensation issue. This typically requires a service call. Would you like me to schedule a technician to inspect and fix the leak?',
    keywords: [
      'water leaking from ac',
      'ac unit leaking water',
      'water dripping from unit', 
      'ac drain leak',
      'condensation leak'
    ]
  }
];

console.log('📋 Test Q&A Entries:');
testQAEntries.forEach((entry, index) => {
  console.log(`${index + 1}. Q: "${entry.question}"`);
  console.log(`   Keywords: [${entry.keywords.join(', ')}]`);
  console.log(`   A: "${entry.answer.substring(0, 60)}..."`);
  console.log('');
});

console.log('=' * 80);

// Test the problematic question
const testQuestions = [
  'my thermostat is blank',
  'thermostat blank',
  'thermostat display blank',
  'my thermostat screen is blank',
  'thermostat not working',
  'my thermostat is blank and its leaking water' // The exact issue from the screenshot
];

console.log('\n🎯 Testing Q&A Matching:');

testQuestions.forEach(question => {
  console.log(`\n❓ Question: "${question}"`);
  console.log(`${'='.repeat(50)}`);
  
  const result = findCachedAnswer(testQAEntries, question, 0.3);
  
  if (result) {
    console.log(`✅ MATCHED: "${result.substring(0, 80)}..."`);
  } else {
    console.log(`❌ NO MATCH - Will fall back to LLM with low confidence`);
  }
});

console.log('\n🔧 RECOMMENDATIONS:');
console.log('1. Lower the fuzzy threshold from 0.3 to 0.25 for better matching');
console.log('2. Add more specific thermostat keywords like "blank", "display", "screen"');
console.log('3. Improve contextual matching for thermostat-specific issues');
console.log('4. Consider word variations like "blank" → "not working", "dead", "frozen"');
