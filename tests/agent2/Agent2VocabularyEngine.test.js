/**
 * ============================================================================
 * AGENT 2.0 VOCABULARY ENGINE - ACCEPTANCE TESTS
 * ============================================================================
 *
 * Tests for the vocabulary normalization and hint system.
 *
 * Test Categories:
 * 1. HARD_NORMALIZE: Replace mishears/misspellings
 * 2. SOFT_HINT: Add hints without modifying text
 * 3. Priority ordering
 * 4. Match modes (EXACT vs CONTAINS)
 * 5. Edge cases and disabled entries
 *
 * Run with: npm test -- --grep "Agent2VocabularyEngine"
 *
 * ============================================================================
 */

const assert = require('assert');
const { Agent2VocabularyEngine, VOCABULARY_TYPES, MATCH_MODES } = require('../../services/engine/agent2/Agent2VocabularyEngine');

describe('Agent2VocabularyEngine', () => {
  // ══════════════════════════════════════════════════════════════════════════
  // TEST 1: HARD_NORMALIZE - Replace mishears/misspellings
  // ══════════════════════════════════════════════════════════════════════════
  describe('HARD_NORMALIZE', () => {
    it('should normalize "acee" to "ac" (EXACT match)', () => {
      const config = {
        enabled: true,
        entries: [
          { enabled: true, priority: 10, type: 'HARD_NORMALIZE', matchMode: 'EXACT', from: 'acee', to: 'ac' }
        ]
      };
      
      const result = Agent2VocabularyEngine.process({
        userInput: 'my acee is not cooling',
        state: {},
        config
      });
      
      assert.strictEqual(result.normalizedText, 'my ac is not cooling');
      assert.strictEqual(result.applied.length, 1);
      assert.strictEqual(result.applied[0].type, 'HARD_NORMALIZE');
      assert.strictEqual(result.applied[0].from, 'acee');
      assert.strictEqual(result.applied[0].to, 'ac');
      assert.strictEqual(result.hints.length, 0);
    });
    
    it('should normalize multiple mishears in sequence', () => {
      const config = {
        enabled: true,
        entries: [
          { enabled: true, priority: 10, type: 'HARD_NORMALIZE', matchMode: 'EXACT', from: 'acee', to: 'ac' },
          { enabled: true, priority: 11, type: 'HARD_NORMALIZE', matchMode: 'EXACT', from: 'tstat', to: 'thermostat' }
        ]
      };
      
      const result = Agent2VocabularyEngine.process({
        userInput: 'my acee is off and my tstat is blank',
        state: {},
        config
      });
      
      assert.strictEqual(result.normalizedText, 'my ac is off and my thermostat is blank');
      assert.strictEqual(result.applied.length, 2);
    });
    
    it('should handle "thermo stat" to "thermostat" (CONTAINS)', () => {
      const config = {
        enabled: true,
        entries: [
          { enabled: true, priority: 10, type: 'HARD_NORMALIZE', matchMode: 'CONTAINS', from: 'thermo stat', to: 'thermostat' }
        ]
      };
      
      const result = Agent2VocabularyEngine.process({
        userInput: 'my thermo stat is showing an error',
        state: {},
        config
      });
      
      assert.strictEqual(result.normalizedText, 'my thermostat is showing an error');
    });
    
    it('should NOT match "acee" inside "raceee" with EXACT mode', () => {
      const config = {
        enabled: true,
        entries: [
          { enabled: true, priority: 10, type: 'HARD_NORMALIZE', matchMode: 'EXACT', from: 'acee', to: 'ac' }
        ]
      };
      
      const result = Agent2VocabularyEngine.process({
        userInput: 'my raceee car is fast',
        state: {},
        config
      });
      
      assert.strictEqual(result.normalizedText, 'my raceee car is fast');
      assert.strictEqual(result.applied.length, 0);
    });
  });
  
  // ══════════════════════════════════════════════════════════════════════════
  // TEST 2: SOFT_HINT - Add hints without modifying text
  // ══════════════════════════════════════════════════════════════════════════
  describe('SOFT_HINT', () => {
    it('should add hint for "thingy on the wall" without modifying text', () => {
      const config = {
        enabled: true,
        entries: [
          { enabled: true, priority: 50, type: 'SOFT_HINT', matchMode: 'CONTAINS', from: 'thingy on the wall', to: 'maybe_thermostat' }
        ]
      };
      
      const result = Agent2VocabularyEngine.process({
        userInput: 'the thingy on the wall is not working',
        state: {},
        config
      });
      
      // Text should NOT be modified
      assert.strictEqual(result.normalizedText, 'the thingy on the wall is not working');
      // Hint should be added
      assert.strictEqual(result.hints.length, 1);
      assert.strictEqual(result.hints[0], 'maybe_thermostat');
      assert.strictEqual(result.applied.length, 1);
      assert.strictEqual(result.applied[0].type, 'SOFT_HINT');
    });
    
    it('should add multiple hints for different phrases', () => {
      const config = {
        enabled: true,
        entries: [
          { enabled: true, priority: 50, type: 'SOFT_HINT', matchMode: 'CONTAINS', from: 'thingy on the wall', to: 'maybe_thermostat' },
          { enabled: true, priority: 51, type: 'SOFT_HINT', matchMode: 'CONTAINS', from: 'box outside', to: 'maybe_outdoor_unit' }
        ]
      };
      
      const result = Agent2VocabularyEngine.process({
        userInput: 'the thingy on the wall says the box outside is off',
        state: {},
        config
      });
      
      assert.strictEqual(result.hints.length, 2);
      assert(result.hints.includes('maybe_thermostat'));
      assert(result.hints.includes('maybe_outdoor_unit'));
    });
    
    it('should deduplicate hints from previous state', () => {
      const config = {
        enabled: true,
        entries: [
          { enabled: true, priority: 50, type: 'SOFT_HINT', matchMode: 'CONTAINS', from: 'thingy', to: 'maybe_thermostat' }
        ]
      };
      
      const state = {
        agent2: {
          hints: ['maybe_thermostat'] // Already has this hint
        }
      };
      
      const result = Agent2VocabularyEngine.process({
        userInput: 'the thingy is broken',
        state,
        config
      });
      
      // Should not duplicate the hint
      assert.strictEqual(result.hints.filter(h => h === 'maybe_thermostat').length, 1);
    });
  });
  
  // ══════════════════════════════════════════════════════════════════════════
  // TEST 3: Priority ordering
  // ══════════════════════════════════════════════════════════════════════════
  describe('Priority', () => {
    it('should apply entries in priority order (lower = first)', () => {
      const config = {
        enabled: true,
        entries: [
          { enabled: true, priority: 20, type: 'HARD_NORMALIZE', matchMode: 'EXACT', from: 'ac', to: 'air conditioner' },
          { enabled: true, priority: 10, type: 'HARD_NORMALIZE', matchMode: 'EXACT', from: 'acee', to: 'ac' }
        ]
      };
      
      // Priority 10 (acee→ac) should run first, then priority 20 (ac→air conditioner)
      const result = Agent2VocabularyEngine.process({
        userInput: 'my acee is broken',
        state: {},
        config
      });
      
      // First: acee → ac, then: ac → air conditioner
      assert.strictEqual(result.normalizedText, 'my air conditioner is broken');
      assert.strictEqual(result.applied.length, 2);
    });
  });
  
  // ══════════════════════════════════════════════════════════════════════════
  // TEST 4: Combined HARD_NORMALIZE + SOFT_HINT
  // ══════════════════════════════════════════════════════════════════════════
  describe('Combined processing', () => {
    it('should normalize text AND add hints in same pass', () => {
      const config = {
        enabled: true,
        entries: [
          { enabled: true, priority: 10, type: 'HARD_NORMALIZE', matchMode: 'EXACT', from: 'acee', to: 'ac' },
          { enabled: true, priority: 50, type: 'SOFT_HINT', matchMode: 'CONTAINS', from: 'thingy', to: 'maybe_thermostat' }
        ]
      };
      
      const result = Agent2VocabularyEngine.process({
        userInput: 'my acee is off and the thingy shows nothing',
        state: {},
        config
      });
      
      // Should normalize "acee" to "ac"
      assert.strictEqual(result.normalizedText, 'my ac is off and the thingy shows nothing');
      // Should add hint for "thingy"
      assert.strictEqual(result.hints.length, 1);
      assert.strictEqual(result.hints[0], 'maybe_thermostat');
      // Should have 2 applied entries
      assert.strictEqual(result.applied.length, 2);
    });
  });
  
  // ══════════════════════════════════════════════════════════════════════════
  // TEST 5: Disabled entries
  // ══════════════════════════════════════════════════════════════════════════
  describe('Disabled entries', () => {
    it('should skip disabled entries', () => {
      const config = {
        enabled: true,
        entries: [
          { enabled: false, priority: 10, type: 'HARD_NORMALIZE', matchMode: 'EXACT', from: 'acee', to: 'ac' }
        ]
      };
      
      const result = Agent2VocabularyEngine.process({
        userInput: 'my acee is not cooling',
        state: {},
        config
      });
      
      // Should NOT be normalized because entry is disabled
      assert.strictEqual(result.normalizedText, 'my acee is not cooling');
      assert.strictEqual(result.applied.length, 0);
      assert.strictEqual(result.stats.skippedDisabled, 1);
    });
    
    it('should return original text when vocabulary is disabled', () => {
      const config = {
        enabled: false,
        entries: [
          { enabled: true, priority: 10, type: 'HARD_NORMALIZE', matchMode: 'EXACT', from: 'acee', to: 'ac' }
        ]
      };
      
      const result = Agent2VocabularyEngine.process({
        userInput: 'my acee is not cooling',
        state: {},
        config
      });
      
      assert.strictEqual(result.normalizedText, 'my acee is not cooling');
      assert.strictEqual(result.applied.length, 0);
    });
  });
  
  // ══════════════════════════════════════════════════════════════════════════
  // TEST 6: Validation
  // ══════════════════════════════════════════════════════════════════════════
  describe('Validation', () => {
    it('should validate entry with missing "from" field', () => {
      const errors = Agent2VocabularyEngine.validateEntry({
        enabled: true,
        type: 'HARD_NORMALIZE',
        to: 'ac'
      });
      
      assert(errors.length > 0);
      assert(errors.some(e => e.includes('from')));
    });
    
    it('should validate entry with invalid type', () => {
      const errors = Agent2VocabularyEngine.validateEntry({
        enabled: true,
        type: 'INVALID_TYPE',
        from: 'acee',
        to: 'ac'
      });
      
      assert(errors.length > 0);
      assert(errors.some(e => e.includes('type')));
    });
    
    it('should pass validation for valid entry', () => {
      const errors = Agent2VocabularyEngine.validateEntry({
        enabled: true,
        priority: 10,
        type: 'HARD_NORMALIZE',
        matchMode: 'EXACT',
        from: 'acee',
        to: 'ac'
      });
      
      assert.strictEqual(errors.length, 0);
    });
  });
  
  // ══════════════════════════════════════════════════════════════════════════
  // TEST 7: Stats
  // ══════════════════════════════════════════════════════════════════════════
  describe('Stats', () => {
    it('should return correct stats for vocabulary config', () => {
      const config = {
        enabled: true,
        entries: [
          { enabled: true, type: 'HARD_NORMALIZE', matchMode: 'EXACT', from: 'a', to: 'b' },
          { enabled: true, type: 'HARD_NORMALIZE', matchMode: 'CONTAINS', from: 'c', to: 'd' },
          { enabled: true, type: 'SOFT_HINT', matchMode: 'CONTAINS', from: 'e', to: 'f' },
          { enabled: false, type: 'HARD_NORMALIZE', matchMode: 'EXACT', from: 'g', to: 'h' }
        ]
      };
      
      const stats = Agent2VocabularyEngine.getStats(config);
      
      assert.strictEqual(stats.enabled, true);
      assert.strictEqual(stats.totalEntries, 4);
      assert.strictEqual(stats.enabledEntries, 3);
      assert.strictEqual(stats.disabledEntries, 1);
      assert.strictEqual(stats.hardNormalizeCount, 2);
      assert.strictEqual(stats.softHintCount, 1);
      assert.strictEqual(stats.exactMatchCount, 1);
      assert.strictEqual(stats.containsMatchCount, 2);
    });
  });
  
  // ══════════════════════════════════════════════════════════════════════════
  // TEST 8: Edge cases
  // ══════════════════════════════════════════════════════════════════════════
  describe('Edge cases', () => {
    it('should handle empty input', () => {
      const config = {
        enabled: true,
        entries: [
          { enabled: true, type: 'HARD_NORMALIZE', matchMode: 'EXACT', from: 'acee', to: 'ac' }
        ]
      };
      
      const result = Agent2VocabularyEngine.process({
        userInput: '',
        state: {},
        config
      });
      
      assert.strictEqual(result.normalizedText, '');
      assert.strictEqual(result.applied.length, 0);
    });
    
    it('should handle null config', () => {
      const result = Agent2VocabularyEngine.process({
        userInput: 'test input',
        state: {},
        config: null
      });
      
      assert.strictEqual(result.normalizedText, 'test input');
      assert.strictEqual(result.applied.length, 0);
    });
    
    it('should preserve case in normalized output', () => {
      const config = {
        enabled: true,
        entries: [
          { enabled: true, type: 'HARD_NORMALIZE', matchMode: 'EXACT', from: 'acee', to: 'ac' }
        ]
      };
      
      const result = Agent2VocabularyEngine.process({
        userInput: 'My ACEE is broken',
        state: {},
        config
      });
      
      // Should normalize to lowercase "ac" (matches original case start)
      assert(result.normalizedText.includes('ac') || result.normalizedText.includes('Ac'));
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ACCEPTANCE TEST: Integration scenario
// ══════════════════════════════════════════════════════════════════════════
describe('Agent2VocabularyEngine - Integration', () => {
  it('should handle real-world HVAC call scenario', () => {
    const config = {
      enabled: true,
      entries: [
        // HARD_NORMALIZE
        { enabled: true, priority: 10, type: 'HARD_NORMALIZE', matchMode: 'EXACT', from: 'acee', to: 'ac', notes: 'Common STT mishear' },
        { enabled: true, priority: 11, type: 'HARD_NORMALIZE', matchMode: 'EXACT', from: 'a/c', to: 'ac', notes: 'Normalize spelling' },
        { enabled: true, priority: 12, type: 'HARD_NORMALIZE', matchMode: 'EXACT', from: 'tstat', to: 'thermostat', notes: 'Abbreviation' },
        // SOFT_HINT
        { enabled: true, priority: 50, type: 'SOFT_HINT', matchMode: 'CONTAINS', from: 'thingy on the wall', to: 'maybe_thermostat', notes: 'Ambiguous reference' },
        { enabled: true, priority: 51, type: 'SOFT_HINT', matchMode: 'CONTAINS', from: 'box outside', to: 'maybe_outdoor_unit', notes: 'Ambiguous reference' }
      ]
    };
    
    // Test case 1: Mishear + ambiguous phrase
    const result1 = Agent2VocabularyEngine.process({
      userInput: 'hi my acee is not cooling and the thingy on the wall shows 80 degrees',
      state: {},
      config
    });
    
    assert.strictEqual(result1.normalizedText, 'hi my ac is not cooling and the thingy on the wall shows 80 degrees');
    assert.strictEqual(result1.hints.length, 1);
    assert.strictEqual(result1.hints[0], 'maybe_thermostat');
    
    // Test case 2: Multiple hints
    const result2 = Agent2VocabularyEngine.process({
      userInput: 'the thingy on the wall is fine but the box outside is making noise',
      state: {},
      config
    });
    
    assert.strictEqual(result2.hints.length, 2);
    assert(result2.hints.includes('maybe_thermostat'));
    assert(result2.hints.includes('maybe_outdoor_unit'));
  });
});
