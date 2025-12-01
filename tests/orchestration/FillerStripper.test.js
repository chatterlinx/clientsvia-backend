/**
 * ============================================================================
 * FILLER STRIPPER - UNIT TESTS
 * ============================================================================
 */

const FillerStripper = require('../../src/services/orchestration/preprocessing/FillerStripper');

describe('FillerStripper', () => {
  
  describe('clean()', () => {
    
    test('should remove common filler words', () => {
      const input = "um I need uh help with like my AC you know";
      const output = FillerStripper.clean(input);
      expect(output).toBe("I need help with my AC");
    });
    
    test('should preserve emotional words (protected)', () => {
      const input = "this is damn frustrating and I need help now";
      const output = FillerStripper.clean(input);
      expect(output).toContain("damn");
      expect(output).toContain("help");
      expect(output).toContain("now");
    });
    
    test('should handle stutters', () => {
      const input = "I-I-I need help";
      const output = FillerStripper.clean(input);
      expect(output).toBe("I need help");
    });
    
    test('should collapse multiple spaces', () => {
      const input = "my   AC    is    broken";
      const output = FillerStripper.clean(input);
      expect(output).toBe("my AC is broken");
    });
    
    test('should handle empty input', () => {
      expect(FillerStripper.clean("")).toBe("");
      expect(FillerStripper.clean("   ")).toBe("");
    });
    
    test('should be fast (<5ms for typical input)', () => {
      const input = "um like you know I really need uh help with basically my AC";
      const start = Date.now();
      FillerStripper.clean(input);
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(5);
    });
    
    test('should handle batch cleaning', () => {
      const inputs = [
        "um I need help",
        "like my AC is broken you know",
        "uh this is frustrating"
      ];
      const outputs = FillerStripper.cleanBatch(inputs);
      expect(outputs).toHaveLength(3);
      expect(outputs[0]).toBe("I need help");
      expect(outputs[1]).toBe("my AC is broken");
    });
  });
  
  describe('Edge Cases', () => {
    
    test('should handle non-string input gracefully', () => {
      expect(FillerStripper.clean(null)).toBe("");
      expect(FillerStripper.clean(undefined)).toBe("");
      expect(FillerStripper.clean(123)).toBe("");
    });
    
    test('should preserve case in output', () => {
      const input = "Um I NEED help ASAP";
      const output = FillerStripper.clean(input);
      expect(output).toBe("I NEED help ASAP");
    });
    
    test('should handle text with only fillers', () => {
      const input = "um uh like you know";
      const output = FillerStripper.clean(input);
      expect(output).toBe("");
    });
  });
});

