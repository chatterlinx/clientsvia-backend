/**
 * TEST INSTANT RESPONSE MATCHER
 * 
 * Purpose: Verify the matcher service works correctly
 * Usage: node scripts/test-instant-response-matcher.js
 * 
 * Last Updated: 2025-10-02
 */

const instantResponseMatcher = require('../services/v2InstantResponseMatcher');

console.log('🧪 Testing Instant Response Matcher\n');

// Test data
const testResponses = [
  {
    trigger: 'what are your hours',
    response: 'We are open Monday-Friday 9am-5pm, Saturday 10am-3pm.',
    category: 'hours',
    enabled: true,
    priority: 95
  },
  {
    trigger: 'where are you located',
    response: 'We are located at 123 Main Street, Anytown, USA 12345.',
    category: 'location',
    enabled: true,
    priority: 90
  },
  {
    trigger: 'do you do emergency service',
    response: 'Yes! We provide 24/7 emergency service. Call 555-1234 immediately.',
    category: 'emergency',
    enabled: true,
    priority: 100
  },
  {
    trigger: 'how much do you charge',
    response: 'Our pricing varies by service. Please call 555-1234 for a free quote.',
    category: 'pricing',
    enabled: true,
    priority: 85
  }
];

// Test queries
const testQueries = [
  'when are you open',              // Should match "what are your hours"
  'what time do you close',         // Should match "what are your hours"
  'what is your address',           // Should match "where are you located"
  'where is your office',           // Should match "where are you located"
  'do you have emergency',          // Should match "do you do emergency service"
  'urgent service available',       // Should match "do you do emergency service"
  'what are your rates',            // Should match "how much do you charge"
  'pricing information',            // Should match "how much do you charge"
  'what is the weather like',       // Should NOT match anything
  'random unrelated query'          // Should NOT match anything
];

console.log('📋 Test Responses Loaded:', testResponses.length);
console.log('📋 Test Queries:', testQueries.length);
console.log('\n' + '='.repeat(80) + '\n');

// Run tests
let passed = 0;
let failed = 0;

testQueries.forEach((query, index) => {
  console.log(`Test ${index + 1}: "${query}"`);
  
  const match = instantResponseMatcher.match(query, testResponses);
  
  if (match) {
    console.log(`  ✅ MATCH FOUND`);
    console.log(`     Confidence: ${(match.score * 100).toFixed(1)}%`);
    console.log(`     Trigger: "${match.trigger}"`);
    console.log(`     Response: "${match.response.substring(0, 60)}..."`);
    console.log(`     Match Time: ${match.matchTimeMs}ms`);
    passed++;
  } else {
    console.log(`  ❌ NO MATCH (confidence too low)`);
    failed++;
  }
  
  console.log('');
});

console.log('='.repeat(80));
console.log('\n📊 Test Summary:');
console.log(`   Matches Found: ${passed}`);
console.log(`   No Matches: ${failed}`);
console.log(`   Total Queries: ${testQueries.length}`);

// Display matcher stats
const stats = instantResponseMatcher.getStats();
console.log('\n⚙️ Matcher Configuration:');
console.log(`   Confidence Threshold: ${stats.confidenceThreshold}`);
console.log(`   Fuzzy Match Threshold: ${stats.fuzzyMatchThreshold}`);
console.log(`   Filler Words Count: ${stats.fillerWordsCount}`);
console.log(`   Variations Loaded: ${stats.variationsLoaded}`);

console.log('\n✅ Matcher test completed!\n');
