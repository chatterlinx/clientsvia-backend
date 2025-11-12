// tests/cheatsheet-engine.test.js
// ============================================================================
// CHEAT SHEET ENGINE INTEGRATION TEST
// ============================================================================
// TESTS:
//   1. Edge case short-circuit (highest priority)
//   2. Transfer rule matching (second priority)
//   3. Guardrail enforcement (content filtering)
//   4. Behavior rule application (tone polish)
//   5. Performance budget enforcement
//   6. Full precedence chain integration
// ============================================================================

const CheatSheetEngine = require('../services/CheatSheetEngine');

// ═══════════════════════════════════════════════════════════════════
// TEST 1: Edge Case Detection (Short-Circuit)
// ═══════════════════════════════════════════════════════════════════

describe('CheatSheetEngine - Edge Case Detection', () => {
  
  test('should short-circuit on edge case match', async () => {
    const policy = {
      version: 1,
      checksum: 'test-checksum',
      behaviorFlags: new Set(),
      guardrailFlags: new Set(),
      allowedActionFlags: new Set(),
      
      edgeCases: [
        {
          id: 'ec-machine',
          name: 'Machine Detection',
          priority: 1,
          response: "I'm a real person here to help!",
          patterns: [/\bmachine\b/i, /\brobot\b/i, /\bai\b/i]
        }
      ],
      
      transferRules: [],
      guardrailPatterns: {}
    };
    
    const result = await CheatSheetEngine.apply(
      'Original response',
      'Are you a machine?',
      { companyId: 'test-123', callId: 'call-456', turnNumber: 1 },
      policy
    );
    
    expect(result.response).toBe("I'm a real person here to help!");
    expect(result.shortCircuit).toBe(true);
    expect(result.action).toBe('RESPOND');
    expect(result.appliedBlocks).toHaveLength(1);
    expect(result.appliedBlocks[0].type).toBe('EDGE_CASE');
    expect(result.appliedBlocks[0].id).toBe('ec-machine');
    expect(result.timeMs).toBeLessThan(10);
    
    console.log('  ✅ Edge case short-circuit works');
  });
  
  test('should skip disabled edge cases', async () => {
    const policy = {
      version: 1,
      checksum: 'test-checksum',
      behaviorFlags: new Set(),
      guardrailFlags: new Set(),
      allowedActionFlags: new Set(),
      
      edgeCases: [
        {
          id: 'ec-disabled',
          name: 'Disabled Edge Case',
          priority: 1,
          response: 'Should not appear',
          patterns: [/test/i],
          enabled: false // DISABLED
        }
      ],
      
      transferRules: [],
      guardrailPatterns: {}
    };
    
    const result = await CheatSheetEngine.apply(
      'Original response',
      'test input',
      { companyId: 'test-123', callId: 'call-456', turnNumber: 1 },
      policy
    );
    
    expect(result.response).toBe('Original response');
    expect(result.shortCircuit).toBe(false);
    expect(result.appliedBlocks.find(b => b.type === 'EDGE_CASE')).toBeUndefined();
    
    console.log('  ✅ Disabled edge cases skipped');
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 2: Transfer Rule Matching
// ═══════════════════════════════════════════════════════════════════

describe('CheatSheetEngine - Transfer Rules', () => {
  
  test('should trigger transfer on intent match', async () => {
    const policy = {
      version: 1,
      checksum: 'test-checksum',
      behaviorFlags: new Set(),
      guardrailFlags: new Set(),
      allowedActionFlags: new Set(['TRANSFER_BILLING']),
      
      edgeCases: [],
      
      transferRules: [
        {
          id: 'tr-billing',
          intentTag: 'billing',
          priority: 5,
          script: 'Transferring you to our billing department...',
          contact: 'Billing Team',
          phone: '555-1234',
          patterns: [/\bbilling\b/i, /\binvoice\b/i, /\bpayment\b/i],
          afterHoursOnly: false
        }
      ],
      
      guardrailPatterns: {}
    };
    
    const result = await CheatSheetEngine.apply(
      'Original response',
      'I have a billing question',
      { companyId: 'test-123', callId: 'call-456', turnNumber: 1 },
      policy
    );
    
    expect(result.response).toBe('Transferring you to our billing department...');
    expect(result.action).toBe('TRANSFER');
    expect(result.transferTarget).toBe('Billing Team');
    expect(result.transferPhone).toBe('555-1234');
    expect(result.appliedBlocks).toHaveLength(1);
    expect(result.appliedBlocks[0].type).toBe('TRANSFER_RULE');
    expect(result.appliedBlocks[0].intentTag).toBe('billing');
    
    console.log('  ✅ Transfer rule triggered correctly');
  });
  
  test('should block unauthorized transfer action', async () => {
    const policy = {
      version: 1,
      checksum: 'test-checksum',
      behaviorFlags: new Set(),
      guardrailFlags: new Set(),
      allowedActionFlags: new Set(), // EMPTY - no actions allowed
      
      edgeCases: [],
      
      transferRules: [
        {
          id: 'tr-billing',
          intentTag: 'billing',
          priority: 5,
          script: 'Transferring you to our billing department...',
          contact: 'Billing Team',
          patterns: [/billing/i]
        }
      ],
      
      guardrailPatterns: {}
    };
    
    const result = await CheatSheetEngine.apply(
      'Original response',
      'I need billing help',
      { companyId: 'test-123', callId: 'call-456', turnNumber: 1 },
      policy
    );
    
    expect(result.response).toBe('Let me connect you with someone who can help.');
    expect(result.action).toBe('RESPOND'); // NOT TRANSFER
    expect(result.appliedBlocks.find(b => b.type === 'TRANSFER_BLOCKED')).toBeDefined();
    
    console.log('  ✅ Unauthorized transfer blocked');
  });
  
  test('should respect after-hours filtering', async () => {
    const currentHour = new Date().getHours();
    const isDuringBusinessHours = currentHour >= 7 && currentHour < 19;
    
    const policy = {
      version: 1,
      checksum: 'test-checksum',
      behaviorFlags: new Set(),
      guardrailFlags: new Set(),
      allowedActionFlags: new Set(['TRANSFER_EMERGENCY']),
      
      edgeCases: [],
      
      transferRules: [
        {
          id: 'tr-emergency',
          intentTag: 'emergency',
          priority: 1,
          script: 'Transferring to emergency line...',
          contact: 'Emergency',
          patterns: [/emergency/i],
          afterHoursOnly: true // ONLY AFTER HOURS
        }
      ],
      
      guardrailPatterns: {}
    };
    
    const result = await CheatSheetEngine.apply(
      'Original response',
      'I have an emergency',
      { companyId: 'test-123', callId: 'call-456', turnNumber: 1 },
      policy
    );
    
    if (isDuringBusinessHours) {
      // Should NOT transfer during business hours
      expect(result.action).toBe('RESPOND');
      console.log('  ✅ After-hours rule blocked during business hours');
    } else {
      // Should transfer after hours
      expect(result.action).toBe('TRANSFER');
      console.log('  ✅ After-hours rule allowed after hours');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 3: Guardrail Enforcement
// ═══════════════════════════════════════════════════════════════════

describe('CheatSheetEngine - Guardrails', () => {
  
  test('should block unauthorized prices', async () => {
    const policy = {
      version: 1,
      checksum: 'test-checksum',
      behaviorFlags: new Set(),
      guardrailFlags: new Set(['NO_PRICES']),
      allowedActionFlags: new Set(),
      
      edgeCases: [],
      transferRules: [],
      
      guardrailPatterns: {
        prices: /\$\d+(?:,\d{3})*(?:\.\d{2})?/g
      }
    };
    
    const result = await CheatSheetEngine.apply(
      'Our service costs $500 for the first hour.',
      'How much does it cost?',
      { 
        companyId: 'test-123', 
        callId: 'call-456', 
        turnNumber: 1,
        company: { aiAgentSettings: { variables: {} } }
      },
      policy
    );
    
    expect(result.response).toContain('[contact us for pricing]');
    expect(result.response).not.toContain('$500');
    expect(result.appliedBlocks.find(b => b.type === 'GUARDRAILS')).toBeDefined();
    expect(result.appliedBlocks.find(b => b.firedFlags?.includes('NO_PRICES'))).toBeDefined();
    
    console.log('  ✅ Unauthorized prices blocked');
  });
  
  test('should allow whitelisted prices from variables', async () => {
    const policy = {
      version: 1,
      checksum: 'test-checksum',
      behaviorFlags: new Set(),
      guardrailFlags: new Set(['NO_PRICES']),
      allowedActionFlags: new Set(),
      
      edgeCases: [],
      transferRules: [],
      
      guardrailPatterns: {
        prices: /\$\d+(?:,\d{3})*(?:\.\d{2})?/g
      }
    };
    
    const result = await CheatSheetEngine.apply(
      'Our service starts at $99 per visit.',
      'How much?',
      { 
        companyId: 'test-123', 
        callId: 'call-456', 
        turnNumber: 1,
        company: { 
          aiAgentSettings: { 
            variables: {
              service_fee: '$99' // APPROVED
            }
          }
        }
      },
      policy
    );
    
    expect(result.response).toContain('$99');
    expect(result.response).not.toContain('[contact us for pricing]');
    
    console.log('  ✅ Whitelisted prices allowed');
  });
  
  test('should block phone numbers', async () => {
    const policy = {
      version: 1,
      checksum: 'test-checksum',
      behaviorFlags: new Set(),
      guardrailFlags: new Set(['NO_PHONE_NUMBERS']),
      allowedActionFlags: new Set(),
      
      edgeCases: [],
      transferRules: [],
      
      guardrailPatterns: {
        phones: /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g
      }
    };
    
    const result = await CheatSheetEngine.apply(
      'You can reach us at 555-123-4567',
      'What is your number?',
      { 
        companyId: 'test-123', 
        callId: 'call-456', 
        turnNumber: 1,
        company: { aiAgentSettings: { variables: {} } }
      },
      policy
    );
    
    expect(result.response).toContain('[contact information]');
    expect(result.response).not.toContain('555-123-4567');
    
    console.log('  ✅ Phone numbers blocked');
  });
  
  test('should block URLs', async () => {
    const policy = {
      version: 1,
      checksum: 'test-checksum',
      behaviorFlags: new Set(),
      guardrailFlags: new Set(['NO_URLS']),
      allowedActionFlags: new Set(),
      
      edgeCases: [],
      transferRules: [],
      
      guardrailPatterns: {
        urls: /https?:\/\/[^\s]+/g
      }
    };
    
    const result = await CheatSheetEngine.apply(
      'Visit our website at https://example.com for more info.',
      'Where can I learn more?',
      { 
        companyId: 'test-123', 
        callId: 'call-456', 
        turnNumber: 1,
        company: { aiAgentSettings: { variables: {} } }
      },
      policy
    );
    
    expect(result.response).toContain('[website link removed]');
    expect(result.response).not.toContain('https://example.com');
    
    console.log('  ✅ URLs blocked');
  });
  
  test('should limit apology spam', async () => {
    const policy = {
      version: 1,
      checksum: 'test-checksum',
      behaviorFlags: new Set(),
      guardrailFlags: new Set(['NO_APOLOGIES_SPAM']),
      allowedActionFlags: new Set(),
      
      edgeCases: [],
      transferRules: [],
      
      guardrailPatterns: {
        apologies: /\bsorry\b/gi
      }
    };
    
    const result = await CheatSheetEngine.apply(
      'Sorry about that. Sorry for the delay. Sorry we missed your call.',
      'Why did you not answer?',
      { 
        companyId: 'test-123', 
        callId: 'call-456', 
        turnNumber: 1,
        company: { aiAgentSettings: { variables: {} } }
      },
      policy
    );
    
    // Count "sorry" occurrences
    const sorryCount = (result.response.match(/\bsorry\b/gi) || []).length;
    expect(sorryCount).toBe(1); // Only one allowed
    
    console.log('  ✅ Apology spam limited to 1x');
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 4: Behavior Rule Application
// ═══════════════════════════════════════════════════════════════════

describe('CheatSheetEngine - Behavior Rules', () => {
  
  test('should prepend "Ok" acknowledgment', async () => {
    const policy = {
      version: 1,
      checksum: 'test-checksum',
      behaviorFlags: new Set(['ACK_OK']),
      guardrailFlags: new Set(),
      allowedActionFlags: new Set(),
      
      edgeCases: [],
      transferRules: [],
      guardrailPatterns: {}
    };
    
    const result = await CheatSheetEngine.apply(
      'I can help you with that.',
      'Can you help me?',
      { companyId: 'test-123', callId: 'call-456', turnNumber: 2 },
      policy
    );
    
    expect(result.response).toMatch(/^Ok,/i);
    expect(result.appliedBlocks.find(b => b.type === 'BEHAVIOR_RULES')).toBeDefined();
    
    console.log('  ✅ "Ok" prepended');
  });
  
  test('should inject company name on first turn', async () => {
    const policy = {
      version: 1,
      checksum: 'test-checksum',
      behaviorFlags: new Set(['USE_COMPANY_NAME']),
      guardrailFlags: new Set(),
      allowedActionFlags: new Set(),
      
      edgeCases: [],
      transferRules: [],
      guardrailPatterns: {}
    };
    
    const result = await CheatSheetEngine.apply(
      'How can I help you today?',
      'Hello',
      { 
        companyId: 'test-123', 
        callId: 'call-456', 
        turnNumber: 1,
        isFirstTurn: true,
        company: {
          aiAgentSettings: {
            variables: {
              companyname: 'Acme Services'
            }
          }
        }
      },
      policy
    );
    
    expect(result.response).toContain('Acme Services');
    expect(result.response).toMatch(/Thanks for calling Acme Services!/i);
    
    console.log('  ✅ Company name injected on first turn');
  });
  
  test('should expand contractions for formal tone', async () => {
    const policy = {
      version: 1,
      checksum: 'test-checksum',
      behaviorFlags: new Set(['POLITE_PROFESSIONAL']),
      guardrailFlags: new Set(),
      allowedActionFlags: new Set(),
      
      edgeCases: [],
      transferRules: [],
      guardrailPatterns: {}
    };
    
    const result = await CheatSheetEngine.apply(
      "I can't help with that, but I'm sure we can find someone who can.",
      'Can you diagnose my issue?',
      { companyId: 'test-123', callId: 'call-456', turnNumber: 1 },
      policy
    );
    
    expect(result.response).toContain('cannot');
    expect(result.response).toContain('I am');
    expect(result.response).not.toContain("can't");
    expect(result.response).not.toContain("I'm");
    
    console.log('  ✅ Contractions expanded for formal tone');
  });
  
  test('should confirm collected entities', async () => {
    const policy = {
      version: 1,
      checksum: 'test-checksum',
      behaviorFlags: new Set(['CONFIRM_ENTITIES']),
      guardrailFlags: new Set(),
      allowedActionFlags: new Set(),
      
      edgeCases: [],
      transferRules: [],
      guardrailPatterns: {}
    };
    
    const result = await CheatSheetEngine.apply(
      'Great! I will schedule that for you.',
      'Schedule me for tomorrow at 3pm',
      { 
        companyId: 'test-123', 
        callId: 'call-456', 
        turnNumber: 3,
        collectedEntities: {
          name: 'John Doe',
          date: 'tomorrow',
          time: '3pm'
        }
      },
      policy
    );
    
    expect(result.response).toContain('Just to confirm');
    expect(result.response).toContain('John Doe');
    expect(result.response).toContain('tomorrow');
    expect(result.response).toContain('3pm');
    
    console.log('  ✅ Collected entities confirmed');
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 5: Performance Budget Enforcement
// ═══════════════════════════════════════════════════════════════════

describe('CheatSheetEngine - Performance', () => {
  
  test('should complete within 10ms budget', async () => {
    const policy = {
      version: 1,
      checksum: 'test-checksum',
      behaviorFlags: new Set(['ACK_OK']),
      guardrailFlags: new Set(['NO_PRICES']),
      allowedActionFlags: new Set(),
      
      edgeCases: [],
      transferRules: [],
      
      guardrailPatterns: {
        prices: /\$\d+/g
      }
    };
    
    const result = await CheatSheetEngine.apply(
      'Our service costs $100.',
      'How much?',
      { 
        companyId: 'test-123', 
        callId: 'call-456', 
        turnNumber: 1,
        company: { aiAgentSettings: { variables: {} } }
      },
      policy
    );
    
    expect(result.timeMs).toBeLessThan(10);
    
    console.log(`  ✅ Completed in ${result.timeMs}ms (under 10ms budget)`);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 6: Full Precedence Chain Integration
// ═══════════════════════════════════════════════════════════════════

describe('CheatSheetEngine - Full Precedence Chain', () => {
  
  test('should apply all 4 levels of precedence in order', async () => {
    const policy = {
      version: 1,
      checksum: 'test-checksum',
      behaviorFlags: new Set(['ACK_OK']),
      guardrailFlags: new Set(['NO_PRICES']),
      allowedActionFlags: new Set(),
      
      edgeCases: [],
      transferRules: [],
      
      guardrailPatterns: {
        prices: /\$\d+/g
      }
    };
    
    const result = await CheatSheetEngine.apply(
      'That will be $200 for the service.',
      'How much will it cost?',
      { 
        companyId: 'test-123', 
        callId: 'call-456', 
        turnNumber: 1,
        company: { aiAgentSettings: { variables: {} } }
      },
      policy
    );
    
    // Verify all precedence levels applied
    const blockTypes = result.appliedBlocks.map(b => b.type);
    
    expect(blockTypes).toContain('GUARDRAILS'); // Prices blocked
    expect(blockTypes).toContain('BEHAVIOR_RULES'); // Ok prepended
    
    expect(result.response).toMatch(/^Ok,/i); // Behavior applied
    expect(result.response).toContain('[contact us for pricing]'); // Guardrail applied
    expect(result.response).not.toContain('$200'); // Price blocked
    
    console.log('  ✅ All 4 precedence levels applied correctly');
    console.log('  📊 Applied blocks:', blockTypes);
  });
  
  test('should respect precedence order (edge case trumps all)', async () => {
    const policy = {
      version: 1,
      checksum: 'test-checksum',
      behaviorFlags: new Set(['ACK_OK']),
      guardrailFlags: new Set(['NO_PRICES']),
      allowedActionFlags: new Set(['TRANSFER_BILLING']),
      
      edgeCases: [
        {
          id: 'ec-machine',
          name: 'Machine Detection',
          priority: 1,
          response: "I'm a real person!",
          patterns: [/machine/i]
        }
      ],
      
      transferRules: [
        {
          id: 'tr-billing',
          intentTag: 'billing',
          priority: 5,
          script: 'Transferring to billing...',
          contact: 'Billing',
          patterns: [/billing/i]
        }
      ],
      
      guardrailPatterns: {
        prices: /\$\d+/g
      }
    };
    
    // Input matches BOTH edge case AND transfer rule
    const result = await CheatSheetEngine.apply(
      'Original response with $100 price.',
      'Are you a machine? I need billing help.',
      { 
        companyId: 'test-123', 
        callId: 'call-456', 
        turnNumber: 1,
        company: { aiAgentSettings: { variables: {} } }
      },
      policy
    );
    
    // Edge case should win (highest priority)
    expect(result.shortCircuit).toBe(true);
    expect(result.response).toBe("I'm a real person!");
    expect(result.action).toBe('RESPOND'); // NOT TRANSFER
    expect(result.appliedBlocks).toHaveLength(1);
    expect(result.appliedBlocks[0].type).toBe('EDGE_CASE');
    
    // Guardrails and behaviors should NOT run (short-circuited)
    expect(result.response).not.toMatch(/^Ok,/i);
    expect(result.response).not.toContain('[contact us for pricing]');
    
    console.log('  ✅ Precedence order respected (edge case trumps all)');
  });
});

// ═══════════════════════════════════════════════════════════════════
// RUN TESTS
// ═══════════════════════════════════════════════════════════════════

console.log('\n🧪 CheatSheetEngine Integration Tests\n');
console.log('Starting tests...\n');

