/**
 * ============================================================================
 * EMOTION DETECTOR - UNIT TESTS
 * ============================================================================
 */

const EmotionDetector = require('../../src/services/orchestration/intelligence/EmotionDetector');

describe('EmotionDetector', () => {
  
  describe('analyze()', () => {
    
    test('should detect FRUSTRATED emotion', () => {
      const result = EmotionDetector.analyze("This is the third time I've called! Nothing works!");
      expect(result.primary).toBe('FRUSTRATED');
      expect(result.intensity).toBeGreaterThan(0.6);
    });
    
    test('should detect ANGRY emotion with profanity', () => {
      const result = EmotionDetector.analyze("This is bullshit! I want my money back!");
      expect(result.primary).toBe('ANGRY');
      expect(result.intensity).toBeGreaterThan(0.7);
    });
    
    test('should detect PANICKED emotion', () => {
      const result = EmotionDetector.analyze("Emergency! Water everywhere! Help me now!");
      expect(result.primary).toBe('PANICKED');
      expect(result.intensity).toBeGreaterThan(0.8);
    });
    
    test('should detect HUMOROUS emotion', () => {
      const result = EmotionDetector.analyze("haha my AC is sweating more than me lol");
      expect(result.primary).toBe('HUMOROUS');
      expect(result.intensity).toBeGreaterThan(0.3);
    });
    
    test('should default to NEUTRAL for calm input', () => {
      const result = EmotionDetector.analyze("I need to schedule a maintenance appointment");
      expect(result.primary).toBe('NEUTRAL');
      expect(result.intensity).toBeLessThan(0.3);
    });
    
    test('should apply intensity modifiers for multiple exclamations', () => {
      const result = EmotionDetector.analyze("Help me!!!");
      expect(result.modifiers).toContainEqual(
        expect.objectContaining({ type: 'multipleExclamation' })
      );
    });
    
    test('should apply intensity boost for returning caller', () => {
      const callerHistory = {
        callerHistory: [{ totalCount: 3, firstName: 'John' }]
      };
      const result = EmotionDetector.analyze("My AC is broken again", callerHistory);
      expect(result.modifiers.some(m => m.type === 'multipleCalls')).toBe(true);
    });
    
    test('should be fast (<20ms)', () => {
      const start = Date.now();
      EmotionDetector.analyze("I'm so frustrated with this broken AC!");
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(20);
    });
  });
  
  describe('isEmergency()', () => {
    
    test('should detect fire emergency', () => {
      expect(EmotionDetector.isEmergency("There's a fire!")).toBe(true);
    });
    
    test('should detect flood emergency', () => {
      expect(EmotionDetector.isEmergency("Water is flooding my basement!")).toBe(true);
    });
    
    test('should detect gas leak emergency', () => {
      expect(EmotionDetector.isEmergency("I smell gas!")).toBe(true);
    });
    
    test('should not flag normal issues as emergency', () => {
      expect(EmotionDetector.isEmergency("My AC is broken")).toBe(false);
      expect(EmotionDetector.isEmergency("I need help")).toBe(false);
    });
  });
  
  describe('describe()', () => {
    
    test('should describe emotion intensity correctly', () => {
      expect(EmotionDetector.describe('FRUSTRATED', 0.85)).toBe('Extremely frustrated');
      expect(EmotionDetector.describe('ANGRY', 0.65)).toBe('Very angry');
      expect(EmotionDetector.describe('STRESSED', 0.45)).toBe('Moderately stressed');
      expect(EmotionDetector.describe('NEUTRAL', 0.0)).toBe('Calm and neutral');
    });
  });
  
  describe('Edge Cases', () => {
    
    test('should handle empty input', () => {
      const result = EmotionDetector.analyze("");
      expect(result.primary).toBe('NEUTRAL');
      expect(result.intensity).toBe(0);
    });
    
    test('should handle null caller history', () => {
      const result = EmotionDetector.analyze("I'm frustrated", null);
      expect(result).toHaveProperty('primary');
      expect(result).toHaveProperty('intensity');
    });
  });
});

