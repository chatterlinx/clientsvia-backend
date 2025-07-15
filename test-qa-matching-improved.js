/**
 * Test Enhanced Q&A Matching for Thermostat Issues
 */

// Mock Q&A entry (from your example)
const thermostatQA = {
  question: "Why is my thermostat screen blank?",
  answer: "Often that's just dead batteries or a tripped breaker, but if the screen stays blank after you swap batteries, there might be a wiring issue. Let me know if you'd like help with next steps or if there's something else you want to ask about your system.",
  keywords: "thermostat, blank screen, batteries, power, wiring"
};

const testQuestions = [
  "my thermostat is blank",
  "thermostat screen not working", 
  "thermostat display is dead",
  "my thermostat screen is black",
  "thermostat won't turn on",
  "my heating control is blank"
];

// Enhanced matching logic (extracted from agent.js)
function testEnhancedQAMatching(question, qaEntry, threshold = 0.2) {
  const qLower = question.toLowerCase();
  const entryQuestion = qaEntry.question.toLowerCase();
  const entryAnswer = qaEntry.answer.toLowerCase();
  const fullEntryText = entryQuestion + ' ' + entryAnswer;
  
  // Enhanced semantic synonym mapping
  const synonymMap = {
    'blank': ['not working', 'dead', 'dark', 'empty', 'black', 'screen blank', 'display blank', 'no display'],
    'not working': ['blank', 'broken', 'dead', 'down', 'out', 'failed', 'malfunctioning'],
    'broken': ['not working', 'dead', 'damaged', 'faulty', 'out of order'],
    'dead': ['blank', 'not working', 'no power', 'won\'t turn on'],
    'screen': ['display', 'monitor', 'panel', 'interface'],
    'thermostat': ['temperature control', 'temp control', 'hvac control', 'climate control', 'heating control'],
    'fix': ['repair', 'service', 'maintenance', 'troubleshoot']
  };
  
  // Get question words and expand with synonyms
  const questionWords = qLower.split(' ').filter(word => word.length > 2);
  const expandedWords = new Set(questionWords);
  
  questionWords.forEach(word => {
    if (synonymMap[word]) {
      synonymMap[word].forEach(synonym => expandedWords.add(synonym));
    }
    // Check if word is a synonym of any key
    Object.entries(synonymMap).forEach(([key, synonyms]) => {
      if (synonyms.includes(word)) {
        expandedWords.add(key);
        synonyms.forEach(syn => expandedWords.add(syn));
      }
    });
  });
  
  // Enhanced matching with synonyms and patterns
  let matchCount = 0;
  let bonusScore = 0;
  
  Array.from(expandedWords).forEach(word => {
    if (fullEntryText.includes(word)) {
      matchCount += entryQuestion.includes(word) ? 2 : 1; // Question matches worth more
    }
  });
  
  // Specific pattern bonuses for common issues
  const patterns = [
    { pattern: /(thermostat|temp).*(blank|not working|dead|screen)/, boost: 3 },
    { pattern: /(blank|dead|not working).*(thermostat|screen|display)/, boost: 3 }
  ];
  
  patterns.forEach(({ pattern, boost }) => {
    if (pattern.test(qLower) && pattern.test(fullEntryText)) {
      bonusScore += boost;
    }
  });
  
  // Calculate final score
  const baseScore = questionWords.length > 0 ? matchCount / questionWords.length : 0;
  const finalScore = baseScore + (bonusScore * 0.1); // Add bonus as percentage
  
  return {
    score: finalScore,
    matches: finalScore > threshold,
    expandedWords: Array.from(expandedWords),
    matchCount,
    bonusScore,
    baseScore
  };
}

console.log('🧪 ENHANCED Q&A MATCHING TEST');
console.log('=' + '='.repeat(50));

console.log(`\nQ&A Entry: "${thermostatQA.question}"`);
console.log(`Answer: "${thermostatQA.answer.substring(0, 100)}..."`);

console.log('\n📋 TEST RESULTS:');
testQuestions.forEach((question, index) => {
  const result = testEnhancedQAMatching(question, thermostatQA);
  const status = result.matches ? '✅ MATCH' : '❌ NO MATCH';
  const confidence = Math.round(result.score * 100);
  
  console.log(`\n${index + 1}. "${question}"`);
  console.log(`   ${status} - ${confidence}% confidence`);
  console.log(`   Base Score: ${Math.round(result.baseScore * 100)}%, Bonus: ${result.bonusScore}, Final: ${confidence}%`);
  console.log(`   Expanded Words: ${result.expandedWords.slice(0, 5).join(', ')}${result.expandedWords.length > 5 ? '...' : ''}`);
});

console.log('\n🎯 SUMMARY:');
const matches = testQuestions.filter(q => testEnhancedQAMatching(q, thermostatQA).matches);
console.log(`✅ ${matches.length}/${testQuestions.length} questions would now match the thermostat Q&A`);
console.log(`📈 This should fix the 34% confidence issue you experienced!`);

// Test the specific case from the screenshot
const specificTest = testEnhancedQAMatching("my thermostat is blank", thermostatQA);
console.log(`\n🔍 SPECIFIC CASE: "my thermostat is blank"`);
console.log(`   Previous: ~34% confidence (failed)`);
console.log(`   Enhanced: ${Math.round(specificTest.score * 100)}% confidence (${specificTest.matches ? 'SUCCESS' : 'still fails'})`);
