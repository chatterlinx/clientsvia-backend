/**
 * ============================================================================
 * AGENT 2.0 GREETING VALIDATION TESTS
 * ============================================================================
 * 
 * Tests the greeting validation logic to ensure corrupted data is caught
 * and sanitized before reaching TTS.
 * 
 * ============================================================================
 */

const { validateGreetingText } = require('../scripts/fix-agent2-greeting-corruption');

describe('Agent 2.0 Greeting Validation', () => {
  const SAFE_DEFAULT = "Thank you for calling. How can I help you today?";

  describe('Valid Greetings', () => {
    test('should accept plain human-readable text', () => {
      const text = "Thank you for calling. How can I help you today?";
      const result = validateGreetingText(text);
      expect(result.isValid).toBe(true);
      expect(result.fixed).toBeNull();
      expect(result.reason).toBeNull();
    });

    test('should accept greeting with company name', () => {
      const text = "Thank you for calling ABC Company. How may I assist you?";
      const result = validateGreetingText(text);
      expect(result.isValid).toBe(true);
    });

    test('should accept greeting with hours', () => {
      const text = "Thank you for calling. We're open Monday through Friday, 9 to 5. How can I help you?";
      const result = validateGreetingText(text);
      expect(result.isValid).toBe(true);
    });

    test('should accept greeting with multiple sentences', () => {
      const text = "Welcome to our service. We're here to help. How can I assist you today?";
      const result = validateGreetingText(text);
      expect(result.isValid).toBe(true);
    });
  });

  describe('Type Validation', () => {
    test('should reject non-string values (object)', () => {
      const text = { greeting: "Hello" };
      const result = validateGreetingText(text);
      expect(result.isValid).toBe(false);
      expect(result.fixed).toBe(SAFE_DEFAULT);
      expect(result.reason).toContain('not a string');
    });

    test('should reject non-string values (array)', () => {
      const text = ["Hello", "World"];
      const result = validateGreetingText(text);
      expect(result.isValid).toBe(false);
      expect(result.fixed).toBe(SAFE_DEFAULT);
    });

    test('should reject non-string values (number)', () => {
      const text = 12345;
      const result = validateGreetingText(text);
      expect(result.isValid).toBe(false);
      expect(result.fixed).toBe(SAFE_DEFAULT);
    });

    test('should reject non-string values (null)', () => {
      const text = null;
      const result = validateGreetingText(text);
      expect(result.isValid).toBe(false);
      expect(result.fixed).toBe(SAFE_DEFAULT);
    });

    test('should reject non-string values (undefined)', () => {
      const text = undefined;
      const result = validateGreetingText(text);
      expect(result.isValid).toBe(false);
      expect(result.fixed).toBe(SAFE_DEFAULT);
    });
  });

  describe('Empty String Validation', () => {
    test('should reject empty string', () => {
      const text = "";
      const result = validateGreetingText(text);
      expect(result.isValid).toBe(false);
      expect(result.fixed).toBe(SAFE_DEFAULT);
      expect(result.reason).toContain('empty');
    });

    test('should reject whitespace-only string', () => {
      const text = "   \n\t  ";
      const result = validateGreetingText(text);
      expect(result.isValid).toBe(false);
      expect(result.fixed).toBe(SAFE_DEFAULT);
      expect(result.reason).toContain('empty');
    });
  });

  describe('JSON Detection', () => {
    test('should reject JSON object', () => {
      const text = '{ "greeting": "Hello" }';
      const result = validateGreetingText(text);
      expect(result.isValid).toBe(false);
      expect(result.fixed).toBe(SAFE_DEFAULT);
      expect(result.reason).toContain('JSON');
    });

    test('should reject JSON array', () => {
      const text = '["Hello", "World"]';
      const result = validateGreetingText(text);
      expect(result.isValid).toBe(false);
      expect(result.fixed).toBe(SAFE_DEFAULT);
      expect(result.reason).toContain('JSON');
    });
  });

  describe('Code Detection', () => {
    test('should reject function declaration', () => {
      const text = 'function greet() { return "Hello"; }';
      const result = validateGreetingText(text);
      expect(result.isValid).toBe(false);
      expect(result.fixed).toBe(SAFE_DEFAULT);
      expect(result.reason).toContain('function');
    });

    test('should reject const declaration', () => {
      const text = 'const greeting = "Hello"';
      const result = validateGreetingText(text);
      expect(result.isValid).toBe(false);
      expect(result.fixed).toBe(SAFE_DEFAULT);
      expect(result.reason).toContain('const');
    });

    test('should reject let declaration', () => {
      const text = 'let greeting = "Hello"';
      const result = validateGreetingText(text);
      expect(result.isValid).toBe(false);
      expect(result.fixed).toBe(SAFE_DEFAULT);
      expect(result.reason).toContain('let');
    });

    test('should reject arrow function', () => {
      const text = '() => { return "Hello"; }';
      const result = validateGreetingText(text);
      expect(result.isValid).toBe(false);
      expect(result.fixed).toBe(SAFE_DEFAULT);
      expect(result.reason).toContain('arrow function');
    });

    test('should reject class declaration', () => {
      const text = 'class Greeting { constructor() {} }';
      const result = validateGreetingText(text);
      expect(result.isValid).toBe(false);
      expect(result.fixed).toBe(SAFE_DEFAULT);
      expect(result.reason).toContain('class');
    });
  });

  describe('Business ID Detection (THE SMOKING GUN)', () => {
    test('should reject "CONNECTION_GREETING" constant', () => {
      const text = 'CONNECTION_GREETING';
      const result = validateGreetingText(text);
      expect(result.isValid).toBe(false);
      expect(result.fixed).toBe(SAFE_DEFAULT);
      expect(result.reason).toContain('CONNECTION_GREETING');
    });

    test('should reject "connection_greeting" (lowercase)', () => {
      const text = 'connection_greeting';
      const result = validateGreetingText(text);
      expect(result.isValid).toBe(false);
      expect(result.fixed).toBe(SAFE_DEFAULT);
      expect(result.reason).toContain('CONNECTION_GREETING');
    });

    test('should reject "fd_CONNECTION_GREETING" file prefix', () => {
      const text = 'fd_CONNECTION_GREETING';
      const result = validateGreetingText(text);
      expect(result.isValid).toBe(false);
      expect(result.fixed).toBe(SAFE_DEFAULT);
      expect(result.reason).toContain('fd_CONNECTION_GREETING');
    });

    test('should reject "fd_CONNECTION_GREETING_1234567890" file ID', () => {
      const text = 'fd_CONNECTION_GREETING_1234567890';
      const result = validateGreetingText(text);
      expect(result.isValid).toBe(false);
      expect(result.fixed).toBe(SAFE_DEFAULT);
      expect(result.reason).toContain('fd_CONNECTION_GREETING');
    });

    test('should reject generic file ID pattern "fd_SOME_CONSTANT_123"', () => {
      const text = 'fd_SOME_CONSTANT_123';
      const result = validateGreetingText(text);
      expect(result.isValid).toBe(false);
      expect(result.fixed).toBe(SAFE_DEFAULT);
      expect(result.reason).toContain('file ID');
    });

    test('should reject text containing "CONNECTION_GREETING" within a sentence', () => {
      const text = 'Welcome to CONNECTION_GREETING service';
      const result = validateGreetingText(text);
      expect(result.isValid).toBe(false);
      expect(result.fixed).toBe(SAFE_DEFAULT);
      expect(result.reason).toContain('CONNECTION_GREETING');
    });
  });

  describe('Length Validation', () => {
    test('should accept reasonable length text (100 chars)', () => {
      const text = 'a'.repeat(100);
      const result = validateGreetingText(text);
      expect(result.isValid).toBe(true);
    });

    test('should accept maximum reasonable length (500 chars)', () => {
      const text = 'a'.repeat(500);
      const result = validateGreetingText(text);
      expect(result.isValid).toBe(true);
    });

    test('should truncate excessive length (>500 chars)', () => {
      const text = 'a'.repeat(600);
      const result = validateGreetingText(text);
      expect(result.isValid).toBe(false);
      expect(result.fixed).toHaveLength(500);
      expect(result.reason).toContain('500 characters');
    });
  });

  describe('Edge Cases', () => {
    test('should handle text with special characters', () => {
      const text = "Thank you for calling! We're here to help. How can we assist you today?";
      const result = validateGreetingText(text);
      expect(result.isValid).toBe(true);
    });

    test('should handle text with numbers', () => {
      const text = "Thank you for calling. We're open 24/7. How can I help you?";
      const result = validateGreetingText(text);
      expect(result.isValid).toBe(true);
    });

    test('should handle text with punctuation', () => {
      const text = "Welcome! How can we help you today?";
      const result = validateGreetingText(text);
      expect(result.isValid).toBe(true);
    });

    test('should handle text with quotes', () => {
      const text = 'Thank you for calling "ABC Company". How can I help?';
      const result = validateGreetingText(text);
      expect(result.isValid).toBe(true);
    });
  });

  describe('Real-World Corruption Examples', () => {
    test('should catch object stringified as "[object Object]"', () => {
      const text = "[object Object]";
      const result = validateGreetingText(text);
      expect(result.isValid).toBe(false);
      expect(result.fixed).toBe(SAFE_DEFAULT);
    });

    test('should catch accidentally serialized config', () => {
      const text = '{"enabled":true,"text":"Hello","audioUrl":""}';
      const result = validateGreetingText(text);
      expect(result.isValid).toBe(false);
      expect(result.fixed).toBe(SAFE_DEFAULT);
    });

    test('should catch module.exports leak', () => {
      const text = 'module.exports = { greeting: "Hello" }';
      const result = validateGreetingText(text);
      expect(result.isValid).toBe(false);
      expect(result.fixed).toBe(SAFE_DEFAULT);
    });
  });
});

describe('Integration: Full Validation Pipeline', () => {
  test('should provide actionable fix for corrupted text', () => {
    const corruptedText = 'CONNECTION_GREETING';
    const result = validateGreetingText(corruptedText);
    
    expect(result.isValid).toBe(false);
    expect(result.fixed).toBe(SAFE_DEFAULT);
    expect(result.reason).toBeTruthy();
    
    // The fixed value should be safe for TTS
    expect(typeof result.fixed).toBe('string');
    expect(result.fixed.length).toBeGreaterThan(0);
    expect(result.fixed).not.toContain('CONNECTION_GREETING');
  });

  test('should preserve valid text without modification', () => {
    const validText = "Thank you for calling ABC Company. How may I assist you today?";
    const result = validateGreetingText(validText);
    
    expect(result.isValid).toBe(true);
    expect(result.fixed).toBeNull();
    expect(result.reason).toBeNull();
  });
});
