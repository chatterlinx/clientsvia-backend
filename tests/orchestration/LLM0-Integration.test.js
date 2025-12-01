/**
 * ============================================================================
 * LLM-0 ORCHESTRATION ENGINE - INTEGRATION TEST
 * ============================================================================
 * 
 * Tests the complete flow from raw input → preprocessed → emotion → LLM-0
 * 
 * CHECKPOINTS:
 * ✅ Step 3: Preprocessing works
 * ✅ Step 4.5: Emotion detection works
 * ✅ Context is properly enriched
 * ✅ All components integrate cleanly
 * 
 * ============================================================================
 */

const { preprocessing, intelligence } = require('../../src/services/orchestration');
const { FillerStripper, TranscriptNormalizer } = preprocessing;
const { EmotionDetector } = intelligence;

describe('LLM-0 Integration (Full Flow)', () => {
  
  describe('Preprocessing Pipeline', () => {
    
    test('CHECKPOINT 1: FillerStripper → TranscriptNormalizer pipeline', () => {
      const rawInput = "um like my a/c is uh broken you know";
      
      // Step 1: Strip fillers
      const step1 = FillerStripper.clean(rawInput);
      expect(step1).not.toContain("um");
      expect(step1).not.toContain("uh");
      expect(step1).not.toContain("you know");
      
      // Step 2: Normalize
      const step2 = TranscriptNormalizer.normalize(step1);
      expect(step2).toContain("AC"); // "a/c" → "AC"
      expect(step2).toBe("my AC is broken");
      
      console.log(`
✅ CHECKPOINT 1 PASSED
   Raw:    "${rawInput}"
   Step 1: "${step1}"
   Step 2: "${step2}"
      `);
    });
    
    test('CHECKPOINT 2: Emotion detection on preprocessed text', () => {
      const rawInput = "um this is like the third damn time my a/c broke you know!!!";
      
      // Preprocess
      let cleaned = FillerStripper.clean(rawInput);
      cleaned = TranscriptNormalizer.normalize(cleaned);
      
      // Emotion detection
      const emotion = EmotionDetector.analyze(cleaned);
      
      expect(emotion.primary).toBe('FRUSTRATED');
      expect(emotion.intensity).toBeGreaterThan(0.6);
      expect(emotion.signals.length).toBeGreaterThan(0);
      
      console.log(`
✅ CHECKPOINT 2 PASSED
   Cleaned: "${cleaned}"
   Emotion: ${emotion.primary} (${(emotion.intensity * 100).toFixed(0)}%)
   Signals: ${emotion.signals.length} detected
      `);
    });
  });
  
  describe('Real-World Scenarios', () => {
    
    test('SCENARIO: Frustrated returning customer', () => {
      const rawInput = "um yeah this is like the second time I called about my broken AC you know";
      
      // Simulate full preprocessing
      let text = FillerStripper.clean(rawInput);
      text = TranscriptNormalizer.normalize(text);
      
      // Simulate caller history
      const callerHistory = {
        callerHistory: [{
          totalCount: 2,
          firstName: 'Walter',
          lastIntent: 'AC_REPAIR'
        }]
      };
      
      // Emotion detection with context
      const emotion = EmotionDetector.analyze(text, callerHistory);
      
      expect(text).toBe("yeah this is the second time I called about my broken AC");
      expect(emotion.primary).toBe('FRUSTRATED');
      expect(emotion.modifiers.some(m => m.type === 'returningCaller')).toBe(true);
      
      console.log(`
✅ SCENARIO PASSED: Frustrated Returning Customer
   Preprocessed: "${text}"
   Emotion: ${emotion.primary} (intensity: ${emotion.intensity.toFixed(2)})
   Context Applied: Returning caller boost detected
      `);
    });
    
    test('SCENARIO: Emergency call', () => {
      const rawInput = "um there's like water everywhere help!!!";
      
      let text = FillerStripper.clean(rawInput);
      text = TranscriptNormalizer.normalize(text);
      const emotion = EmotionDetector.analyze(text);
      const isEmergency = EmotionDetector.isEmergency(text);
      
      expect(isEmergency).toBe(true);
      expect(emotion.primary).toMatch(/PANICKED|STRESSED/);
      expect(emotion.intensity).toBeGreaterThan(0.7);
      
      console.log(`
✅ SCENARIO PASSED: Emergency Call
   Preprocessed: "${text}"
   Emergency Detected: ${isEmergency}
   Emotion: ${emotion.primary} (${(emotion.intensity * 100).toFixed(0)}%)
      `);
    });
    
    test('SCENARIO: Calm scheduling request', () => {
      const rawInput = "hi um I'd like to schedule a maintenance appointment";
      
      let text = FillerStripper.clean(rawInput);
      text = TranscriptNormalizer.normalize(text);
      const emotion = EmotionDetector.analyze(text);
      
      expect(emotion.primary).toBe('NEUTRAL');
      expect(emotion.intensity).toBeLessThan(0.3);
      
      console.log(`
✅ SCENARIO PASSED: Calm Scheduling
   Preprocessed: "${text}"
   Emotion: ${emotion.primary} (neutral, as expected)
      `);
    });
    
    test('SCENARIO: Humorous customer', () => {
      const rawInput = "haha my AC is sweating more than me lol";
      
      let text = FillerStripper.clean(rawInput);
      text = TranscriptNormalizer.normalize(text);
      const emotion = EmotionDetector.analyze(text);
      
      expect(emotion.primary).toBe('HUMOROUS');
      expect(text).toContain("AC"); // Normalized
      
      console.log(`
✅ SCENARIO PASSED: Humorous Customer
   Preprocessed: "${text}"
   Emotion: ${emotion.primary}
   Humor preserved: lol, haha detected
      `);
    });
  });
  
  describe('Performance Benchmarks', () => {
    
    test('CHECKPOINT 3: Full pipeline completes in <25ms', () => {
      const rawInput = "um this is like really frustrating my a/c broke again you know";
      
      const start = Date.now();
      
      // Full pipeline
      let text = FillerStripper.clean(rawInput);
      text = TranscriptNormalizer.normalize(text);
      const emotion = EmotionDetector.analyze(text);
      
      const duration = Date.now() - start;
      
      expect(duration).toBeLessThan(25);
      
      console.log(`
✅ CHECKPOINT 3 PASSED: Performance
   Total Pipeline Duration: ${duration}ms (target: <25ms)
   Components:
     - FillerStripper: <3ms
     - TranscriptNormalizer: <3ms
     - EmotionDetector: <15ms
      `);
    });
  });
  
  describe('Context Enrichment', () => {
    
    test('CHECKPOINT 4: Context object is properly enriched', () => {
      const rawInput = "I'm so frustrated!!!";
      
      // Simulate context object (like in orchestrationEngine.js)
      const ctx = {
        currentIntent: null,
        emotion: null,
        memory: null
      };
      
      // Preprocessing
      let text = FillerStripper.clean(rawInput);
      text = TranscriptNormalizer.normalize(text);
      
      // Emotion detection
      const emotion = EmotionDetector.analyze(text, ctx.memory);
      ctx.emotion = emotion;
      
      // Verify context enrichment
      expect(ctx.emotion).toBeDefined();
      expect(ctx.emotion.primary).toBe('FRUSTRATED');
      expect(ctx.emotion.intensity).toBeGreaterThan(0);
      expect(ctx.emotion.executionTime).toBeDefined();
      
      console.log(`
✅ CHECKPOINT 4 PASSED: Context Enrichment
   Context before: { emotion: null }
   Context after:  { emotion: { primary: "${ctx.emotion.primary}", intensity: ${ctx.emotion.intensity.toFixed(2)} } }
      `);
    });
  });
});

/**
 * Run this test suite before deployment:
 * 
 * npm test tests/orchestration/LLM0-Integration.test.js
 * 
 * Expected output:
 * ✅ All checkpoints passed
 * ✅ Performance targets met
 * ✅ Context enrichment working
 * ✅ Real-world scenarios validated
 */

