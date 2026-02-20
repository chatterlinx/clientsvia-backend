/**
 * ============================================================================
 * AGENT 2.0 CALL REASON SANITIZER
 * ============================================================================
 *
 * Transforms raw call_reason_detail into clean, short labels.
 * Prevents the "echo" problem where agent says "It sounds like [caller transcript]"
 *
 * Design Principles:
 * - Map common intents to short labels (e.g., "AC not cooling")
 * - Strip leading punctuation, greetings, fillers
 * - Never return the caller's full transcript
 * - UI-configurable mappings
 *
 * MODES:
 * - 'summary_label': Map to predefined labels (recommended)
 * - 'truncate': First N meaningful words only
 * - 'passthrough': Return as-is (legacy behavior)
 *
 * ============================================================================
 */

const logger = require('../../../utils/logger');

// ────────────────────────────────────────────────────────────────────────────
// DEFAULT INTENT-TO-LABEL MAPPINGS
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_INTENT_LABELS = [
  // AC/Cooling issues - most specific patterns first
  { patterns: [/not\s+cool(?:ing)?/i, /no\s+cool(?:ing)?/i, /stopped\s+cool(?:ing)?/i, /won'?t\s+cool/i], label: 'AC not cooling' },
  { patterns: [/ac\s+(?:problem|issue|trouble)s?/i, /a\.?c\.?\s+(?:problem|issue|trouble)s?/i], label: 'AC issue' },
  { patterns: [/air\s+condition(?:ing|er)?\s+(?:problem|issue|trouble)s?/i], label: 'AC issue' },
  { patterns: [/warm\s+air/i, /hot\s+air/i, /blowing\s+(?:warm|hot)/i], label: 'AC blowing warm air' },
  
  // Heat issues
  { patterns: [/not\s+heat(?:ing)?/i, /no\s+heat(?:ing)?/i, /stopped\s+heat(?:ing)?/i, /won'?t\s+heat/i], label: 'not heating' },
  { patterns: [/furnace\s+(?:problem|issue|trouble|not)/i], label: 'furnace issue' },
  { patterns: [/cold\s+air/i, /blowing\s+cold/i], label: 'blowing cold air' },
  
  // System down / not working
  { patterns: [/nothing\s+(?:is\s+)?work(?:ing)?/i, /everything\s+(?:is\s+)?(?:down|off|broken)/i], label: 'system not working' },
  { patterns: [/not\s+(?:turn|run|work|start)(?:ing)?/i, /won'?t\s+(?:turn|run|work|start)/i, /stopped\s+(?:work|run)(?:ing)?/i, /isn'?t\s+work(?:ing)?/i], label: 'system not working' },
  { patterns: [/system\s+down/i, /unit\s+down/i, /ac\s+down/i, /hvac\s+down/i], label: 'system down' },
  { patterns: [/broke(?:n)?/i, /dead/i], label: 'system down' },
  
  // Thermostat
  { patterns: [/thermostat\s+(?:is\s+)?(?:blank|dead|off|not\s+work)/i], label: 'thermostat blank' },
  { patterns: [/blank\s+(?:thermostat|screen|display)/i], label: 'thermostat blank' },
  { patterns: [/display\s+(?:blank|dead|not\s+work)/i, /screen\s+(?:blank|dead)/i], label: 'display not working' },
  
  // Airflow
  { patterns: [/no\s+(?:air|airflow)/i, /weak\s+(?:air|airflow)/i, /not\s+(?:blowing|putting\s+out)/i], label: 'no airflow' },
  
  // Water/leaks
  { patterns: [/water\s+(?:leak|drip|puddle)/i, /leak(?:ing)?\s+water/i], label: 'water leak' },
  { patterns: [/flooding/i, /water\s+everywhere/i], label: 'flooding' },
  
  // Noise
  { patterns: [/(?:loud|strange|weird)\s+noise/i, /mak(?:e|ing)\s+(?:a\s+)?noise/i], label: 'unusual noise' },
  { patterns: [/bang(?:ing)?/i, /rattle/i, /rattl(?:e|ing)/i, /squeal/i, /buzz(?:ing)?/i], label: 'unusual noise' },
  
  // Smell
  { patterns: [/(?:burning|bad|strange)\s+smell/i, /smell(?:s|ing)?\s+(?:like\s+)?burn/i], label: 'unusual smell' },
  { patterns: [/smoke/i], label: 'smoke detected' },
  
  // Frozen
  { patterns: [/frozen/i, /ice\s+(?:on|buildup)/i, /frost/i, /iced?\s+(?:up|over)/i], label: 'frozen unit' },
  
  // Maintenance
  { patterns: [/maintenance/i, /tune[\s-]?up/i, /check[\s-]?up/i, /inspection/i], label: 'maintenance request' },
  
  // Scheduling
  { patterns: [/schedule/i, /appointment/i, /book(?:ing)?/i], label: 'service request' },
  { patterns: [/send\s+(?:someone|a?\s*tech)/i, /get\s+(?:someone|a?\s*tech)\s+out/i], label: 'service request' },
  
  // Emergency
  { patterns: [/emergency/i, /urgent(?:ly)?/i, /asap/i], label: 'urgent service needed' },
  { patterns: [/gas\s+(?:leak|smell)/i, /carbon\s+monoxide/i], label: 'potential gas leak' }
];

// ────────────────────────────────────────────────────────────────────────────
// FILLER/NOISE PATTERNS TO STRIP
// ────────────────────────────────────────────────────────────────────────────

const STRIP_PATTERNS = [
  // Leading punctuation
  /^[.,;:!?\s]+/,
  
  // Greetings
  /^(hi|hello|hey|good\s+(?:morning|afternoon|evening))[,.\s]*/i,
  
  // Name intros
  /\bmy\s+name\s+(?:is|'s)\s+[a-zA-Z'\-]+[,.\s]*/i,
  /\bi'?m\s+[a-zA-Z'\-]+[,.\s]+/i,
  /\bthis\s+is\s+[a-zA-Z'\-]+[,.\s]*/i,
  
  // Filler words
  /\b(um|uh|erm|like|you\s+know|kinda|sorta|basically)\b[,.\s]*/gi,
  
  // Customer context that doesn't help (already captured elsewhere)
  // Be careful not to strip too much - only strip the intro, not the problem description
  /\bi\s*(?:am|'m)\s+(?:a\s+)?(?:long[-\s]?time|existing|current)\s+customer[,.\s]*/i,
  /\bi'?ve\s+been\s+(?:a\s+)?(?:long[-\s]?time\s+)?customer\s+(?:for|since)[^,]*[,]\s*/i,
  /\byou\s+(?:guys|all)\s+(?:installed|serviced|worked\s+on)[^,]*[,]\s*/i,
  
  // Question/help requests (we already know they want help)
  /\bi\s+was\s+(?:wondering|hoping|calling)\b[^.?!]*[.?!]?\s*/i,
  /\bcan\s+(?:you|someone)\s+help\s+(?:me|us)?\s*[.?!]?\s*/i,
  /\bif\s+you\s+can\s+help\b[^.?!]*[.?!]?\s*/i,
  
  // Trailing punctuation after cleanup
  /[.,;:!?\s]+$/
];

// ────────────────────────────────────────────────────────────────────────────
// SANITIZER CLASS
// ────────────────────────────────────────────────────────────────────────────

class Agent2CallReasonSanitizer {
  /**
   * Sanitize call_reason_detail into a clean, short label.
   *
   * @param {string} rawReason - The raw extracted call reason
   * @param {Object} config - UI-configured sanitization settings
   * @returns {{ sanitized: string, mode: string, originalLength: number, matched: boolean }}
   */
  static sanitize(rawReason, config = {}) {
    const mode = config.mode || 'summary_label';
    const maxWords = config.maxWords || 6;
    const customMappings = config.customMappings || [];
    
    const original = `${rawReason || ''}`.trim();
    const result = {
      sanitized: '',
      mode,
      originalLength: original.length,
      matched: false,
      matchedLabel: null
    };
    
    if (!original) {
      return result;
    }
    
    // Step 1: Strip noise from raw input
    let cleaned = this.stripNoise(original);
    
    if (!cleaned) {
      return result;
    }
    
    // Step 2: Apply mode-specific processing
    switch (mode) {
      case 'summary_label':
        result.sanitized = this.mapToLabel(cleaned, customMappings);
        result.matched = result.sanitized !== null;
        if (result.matched) {
          result.matchedLabel = result.sanitized;
        } else {
          // Fallback: extract first meaningful words
          result.sanitized = this.extractMeaningfulWords(cleaned, maxWords);
        }
        break;
        
      case 'truncate':
        result.sanitized = this.extractMeaningfulWords(cleaned, maxWords);
        break;
        
      case 'passthrough':
        result.sanitized = cleaned;
        break;
        
      default:
        result.sanitized = this.mapToLabel(cleaned, customMappings) || 
                           this.extractMeaningfulWords(cleaned, maxWords);
    }
    
    // Final cleanup
    result.sanitized = this.finalCleanup(result.sanitized);
    
    logger.debug('[CallReasonSanitizer] Sanitized reason', {
      originalPreview: original.substring(0, 60),
      sanitized: result.sanitized,
      mode,
      matched: result.matched
    });
    
    return result;
  }
  
  /**
   * Strip filler words, greetings, and noise from text.
   */
  static stripNoise(text) {
    let cleaned = `${text || ''}`.trim();
    
    for (const pattern of STRIP_PATTERNS) {
      cleaned = cleaned.replace(pattern, ' ');
    }
    
    // Collapse multiple spaces
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    
    return cleaned;
  }
  
  /**
   * Map cleaned text to a predefined label.
   * Returns null if no pattern matches.
   */
  static mapToLabel(text, customMappings = []) {
    const normalized = `${text || ''}`.toLowerCase();
    
    // Check custom mappings first (UI-configured)
    for (const mapping of customMappings) {
      if (!mapping.patterns || !mapping.label) continue;
      
      const patterns = Array.isArray(mapping.patterns) ? mapping.patterns : [mapping.patterns];
      for (const p of patterns) {
        const regex = p instanceof RegExp ? p : new RegExp(p, 'i');
        if (regex.test(normalized)) {
          return mapping.label;
        }
      }
    }
    
    // Check default mappings
    for (const mapping of DEFAULT_INTENT_LABELS) {
      for (const pattern of mapping.patterns) {
        if (pattern.test(normalized)) {
          return mapping.label;
        }
      }
    }
    
    return null;
  }
  
  /**
   * Extract first N meaningful words from text.
   * Filters out stop words and short words.
   */
  static extractMeaningfulWords(text, maxWords = 6) {
    const stopWords = new Set([
      'i', 'me', 'my', 'myself', 'we', 'our', 'you', 'your',
      'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then',
      'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'having', 'do', 'does', 'did',
      'will', 'would', 'could', 'should', 'may', 'might',
      'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
      'from', 'up', 'about', 'into', 'over', 'after',
      'this', 'that', 'these', 'those', 'it', 'its',
      'just', 'some', 'so', 'than', 'too', 'very',
      'can', 'now', 'here', 'there', 'when', 'where',
      'hi', 'hello', 'hey', 'um', 'uh', 'like'
    ]);
    
    const words = `${text || ''}`
      .toLowerCase()
      .replace(/[^a-z0-9\s'-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1 && !stopWords.has(w));
    
    if (words.length === 0) {
      return text?.substring(0, 40) || '';
    }
    
    const selected = words.slice(0, maxWords);
    return selected.join(' ');
  }
  
  /**
   * Final cleanup pass - ensure output is presentable.
   */
  static finalCleanup(text) {
    let cleaned = `${text || ''}`.trim();
    
    // Remove leading/trailing punctuation
    cleaned = cleaned.replace(/^[.,;:!?\s]+/, '').replace(/[.,;:!?\s]+$/, '');
    
    // Capitalize first letter
    if (cleaned.length > 0) {
      cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }
    
    // Limit length
    if (cleaned.length > 60) {
      cleaned = cleaned.substring(0, 57) + '...';
    }
    
    return cleaned;
  }
  
  /**
   * Get default configuration for UI display.
   */
  static getDefaultConfig() {
    return {
      enabled: true,
      mode: 'summary_label',
      maxWords: 6,
      stripLeadingPunctuation: true,
      stripGreetingPhrases: true,
      stripNamePhrases: true,
      stripFillerWords: true,
      customMappings: []
    };
  }
}

module.exports = { Agent2CallReasonSanitizer };
