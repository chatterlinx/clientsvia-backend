/**
 * DETAILED TEST FOR INSTANT RESPONSE MATCHER
 * 
 * Purpose: Debug the matcher with detailed scoring information
 * Usage: node scripts/test-matcher-detailed.js
 * 
 * Last Updated: 2025-10-02
 */

const instantResponseMatcher = require('../services/v2InstantResponseMatcher');
const variations = require('../config/instantResponseVariations');

console.log('🔬 Detailed Matcher Test with Debug Info\n');

// Test a single query
const query = 'when are you open';
const trigger = 'what are your hours';

console.log(`Query: "${query}"`);
console.log(`Trigger: "${trigger}"\n`);

// Normalize
const normalizedQuery = instantResponseMatcher.normalizeQuery(query);
const normalizedTrigger = instantResponseMatcher.normalizeQuery(trigger);

console.log(`Normalized Query: "${normalizedQuery}"`);
console.log(`Normalized Trigger: "${normalizedTrigger}"\n`);

// Extract terms
const queryTerms = instantResponseMatcher.extractKeyTerms(normalizedQuery);
const triggerTerms = instantResponseMatcher.extractKeyTerms(normalizedTrigger);

console.log(`Query Terms: [${queryTerms.join(', ')}]`);
console.log(`Trigger Terms: [${triggerTerms.join(', ')}]\n`);

// Check variation dictionary
console.log('Variation Dictionary Lookups:');
queryTerms.forEach(term => {
  const canonical = variations.findCanonical(term);
  console.log(`  "${term}" → ${canonical || 'NOT FOUND'}`);
});
console.log('');

triggerTerms.forEach(term => {
  const canonical = variations.findCanonical(term);
  console.log(`  "${term}" → ${canonical || 'NOT FOUND'}`);
});
console.log('');

// Check relationships
console.log('Term Relationships:');
for (const qTerm of queryTerms) {
  for (const tTerm of triggerTerms) {
    const related = variations.areRelated(qTerm, tTerm);
    if (related) {
      console.log(`  ✅ "${qTerm}" ↔ "${tTerm}" (RELATED)`);
    }
  }
}
console.log('');

// Calculate scores
const variationScore = instantResponseMatcher.calculateVariationScore(queryTerms, triggerTerms);
const fuzzyScore = instantResponseMatcher.calculateFuzzyScore(normalizedQuery, normalizedTrigger);
const overlapScore = instantResponseMatcher.calculateTermOverlap(queryTerms, triggerTerms);

console.log('Individual Scores:');
console.log(`  Variation Score: ${(variationScore * 100).toFixed(1)}%`);
console.log(`  Fuzzy Score: ${(fuzzyScore * 100).toFixed(1)}%`);
console.log(`  Overlap Score: ${(overlapScore * 100).toFixed(1)}%`);
console.log('');

// Full match
const testResponses = [{
  trigger: trigger,
  response: 'Test response',
  enabled: true
}];

const match = instantResponseMatcher.match(query, testResponses);

if (match) {
  console.log('✅ FINAL MATCH RESULT:');
  console.log(`   Confidence: ${(match.score * 100).toFixed(1)}%`);
  console.log(`   Threshold: ${instantResponseMatcher.confidenceThreshold * 100}%`);
  console.log(`   Match Time: ${match.matchTimeMs}ms`);
} else {
  console.log('❌ NO MATCH (below confidence threshold)');
}

console.log('\n🔍 Testing "hours" vs "open" relationship:');
console.log(`  "hours" canonical: ${variations.findCanonical('hours')}`);
console.log(`  "open" canonical: ${variations.findCanonical('open')}`);
console.log(`  Are they related? ${variations.areRelated('hours', 'open')}`);
