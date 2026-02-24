const { Agent2GreetingInterceptor } = require('./services/engine/agent2/Agent2GreetingInterceptor');

// Test config
const testConfig = {
  interceptor: {
    enabled: true,
    shortOnlyGate: { maxWords: 2, blockIfIntentWords: true },
    intentWords: ['repair', 'appointment', 'broken'],
    rules: [
      { ruleId: 'fuzzy-hi', enabled: true, matchType: 'FUZZY', triggers: ['hi'], response: 'Hello there!' },
      { ruleId: 'exact-morning', enabled: true, matchType: 'EXACT', triggers: ['good morning'], response: 'Good morning!' }
    ]
  }
};

// Test cases
const testCases = [
  { input: 'hi', desc: 'EXACT match for hi' },
  { input: 'hey', desc: 'FUZZY: hey should match hi' },
  { input: 'hiya', desc: 'FUZZY: hiya should match hi' },
  { input: 'howdy', desc: 'FUZZY: howdy should match hi' },
  { input: 'hiiii', desc: 'FUZZY: hiiii should match hi (extended)' },
  { input: 'good morning', desc: 'EXACT: good morning' },
  { input: 'mornin', desc: 'Should NOT match (exact only)' },
  { input: 'hi my AC is broken', desc: 'TOO_LONG + INTENT_WORD' },
  { input: 'hi repair', desc: 'INTENT_WORD present' },
  { input: 'yo', desc: 'FUZZY: yo should match hi' },
];

console.log('=== GREETING INTERCEPTOR TEST ===\n');
testCases.forEach(tc => {
  const result = Agent2GreetingInterceptor.evaluate({
    input: tc.input,
    config: testConfig,
    turn: 1,
    state: {}
  });
  const icon = result.intercepted ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`[${icon}] '${tc.input}' → ${result.intercepted ? 'INTERCEPTED' : 'BLOCKED'} (${result.proof.blockedReason || result.proof.matchedRuleId})`);
  if (result.intercepted) {
    console.log(`   Response: ${result.response}`);
  }
  console.log('');
});
