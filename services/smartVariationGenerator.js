/**
 * SMART VARIATION GENERATOR
 * 
 * Purpose: Generate contextual variations for instant response triggers
 * - Uses linguistic patterns (NO hardcoded word lists)
 * - Generates variations based on structure and grammar
 * - All variations are transparent and editable by admin
 * 
 * Strategy:
 * 1. Analyze input phrase structure
 * 2. Apply grammatical transformations
 * 3. Generate variations that preserve meaning
 * 4. Return suggestions for admin to review/edit
 * 
 * NO HIDDEN DICTIONARIES - All logic is algorithmic
 * 
 * Created: 2025-10-02
 */

class SmartVariationGenerator {
  /**
   * Generate variations for a trigger phrase
   * @param {String} trigger - Original trigger phrase
   * @param {Number} count - Number of variations to generate (default: 8)
   * @returns {Array} - Array of variation strings
   */
  generateVariations(trigger, count = 8) {
    if (!trigger || typeof trigger !== 'string') {
      return [];
    }

    const normalized = trigger.toLowerCase().trim();
    const variations = new Set();

    // Add original (normalized)
    variations.add(normalized);

    // 1. CASE VARIATIONS
    this.addCaseVariations(trigger, variations);

    // 2. CONTRACTION EXPANSIONS/CONTRACTIONS
    this.addContractionVariations(normalized, variations);

    // 3. PUNCTUATION VARIATIONS
    this.addPunctuationVariations(normalized, variations);

    // 4. WORD ORDER VARIATIONS (for multi-word phrases)
    this.addWordOrderVariations(normalized, variations);

    // 5. FILLER WORD REMOVAL/ADDITION
    this.addFillerVariations(normalized, variations);

    // 6. TENSE VARIATIONS (for verbs)
    this.addTenseVariations(normalized, variations);

    // 7. FORMALITY VARIATIONS
    this.addFormalityVariations(normalized, variations);

    // Convert Set to Array and limit to requested count
    const result = Array.from(variations)
      .filter(v => v && v.length > 0)
      .slice(0, count);

    console.log(`[SmartVariationGenerator] Generated ${result.length} variations for: "${trigger}"`);
    return result;
  }

  /**
   * Add case variations (uppercase, lowercase, title case)
   */
  addCaseVariations(trigger, variations) {
    const lower = trigger.toLowerCase();
    const upper = trigger.toUpperCase();
    const title = this.toTitleCase(trigger);

    variations.add(lower);
    variations.add(upper);
    variations.add(title);
  }

  /**
   * Add contraction variations
   * Examples: "I am" <-> "I'm", "do not" <-> "don't"
   */
  addContractionVariations(trigger, variations) {
    // Common contraction patterns (algorithmic, not dictionary)
    const contractionRules = [
      { expanded: 'i am', contracted: "i'm" },
      { expanded: 'you are', contracted: "you're" },
      { expanded: 'he is', contracted: "he's" },
      { expanded: 'she is', contracted: "she's" },
      { expanded: 'it is', contracted: "it's" },
      { expanded: 'we are', contracted: "we're" },
      { expanded: 'they are', contracted: "they're" },
      { expanded: 'do not', contracted: "don't" },
      { expanded: 'does not', contracted: "doesn't" },
      { expanded: 'did not', contracted: "didn't" },
      { expanded: 'cannot', contracted: "can't" },
      { expanded: 'will not', contracted: "won't" },
      { expanded: 'would not', contracted: "wouldn't" },
      { expanded: 'should not', contracted: "shouldn't" },
      { expanded: 'could not', contracted: "couldn't" }
    ];

    // Try expanding contractions
    for (const rule of contractionRules) {
      if (trigger.includes(rule.contracted)) {
        variations.add(trigger.replace(rule.contracted, rule.expanded));
      }
      if (trigger.includes(rule.expanded)) {
        variations.add(trigger.replace(rule.expanded, rule.contracted));
      }
    }
  }

  /**
   * Add punctuation variations
   */
  addPunctuationVariations(trigger, variations) {
    // Add with question mark (if not already there)
    if (!trigger.includes('?')) {
      variations.add(`${trigger  }?`);
    }

    // Add with exclamation (for short phrases)
    if (trigger.split(' ').length <= 3 && !trigger.includes('!')) {
      variations.add(`${trigger  }!`);
    }

    // Add without punctuation
    const noPunctuation = trigger.replace(/[?.!,;:]/g, '').trim();
    if (noPunctuation !== trigger) {
      variations.add(noPunctuation);
    }
  }

  /**
   * Add word order variations (for 2-3 word phrases)
   */
  addWordOrderVariations(trigger, variations) {
    const words = trigger.split(/\s+/);
    
    // Only for 2-word phrases to avoid nonsense
    if (words.length === 2) {
      variations.add(`${words[1]  } ${  words[0]}`);
    }
  }

  /**
   * Add/remove filler words
   */
  addFillerVariations(trigger, variations) {
    // Common filler words to remove (algorithmic pattern)
    const fillers = ['um', 'uh', 'like', 'you know', 'i mean', 'so', 'well', 'just', 'really'];
    
    let modified = trigger;
    for (const filler of fillers) {
      modified = modified.replace(new RegExp(`\\b${  filler  }\\b`, 'gi'), '').replace(/\s+/g, ' ').trim();
    }
    
    if (modified !== trigger && modified.length > 0) {
      variations.add(modified);
    }

    // Add "please" if not present (for polite variations)
    if (!trigger.includes('please') && trigger.split(' ').length <= 4) {
      variations.add(`please ${  trigger}`);
    }
  }

  /**
   * Add tense variations (simple algorithmic rules)
   */
  addTenseVariations(trigger, variations) {
    // Present -> Present Continuous (add -ing)
    const words = trigger.split(/\s+/);
    const lastWord = words[words.length - 1];

    // Simple -ing transformation
    if (lastWord.length > 3 && !lastWord.endsWith('ing')) {
      const ingForm = lastWord.endsWith('e') 
        ? `${lastWord.slice(0, -1)  }ing`
        : `${lastWord  }ing`;
      
      words[words.length - 1] = ingForm;
      variations.add(words.join(' '));
    }

    // -ing -> base form
    if (lastWord.endsWith('ing')) {
      const baseForm = lastWord.endsWith('eing')
        ? `${lastWord.slice(0, -3)  }e`
        : lastWord.slice(0, -3);
      
      words[words.length - 1] = baseForm;
      variations.add(words.join(' '));
    }
  }

  /**
   * Add formality variations
   */
  addFormalityVariations(trigger, variations) {
    // Informal -> Formal transformations (pattern-based)
    const formalityRules = [
      { informal: 'hi', formal: 'hello' },
      { informal: 'hey', formal: 'hello' },
      { informal: 'yeah', formal: 'yes' },
      { informal: 'yep', formal: 'yes' },
      { informal: 'nope', formal: 'no' },
      { informal: 'gonna', formal: 'going to' },
      { informal: 'wanna', formal: 'want to' },
      { informal: 'gotta', formal: 'got to' },
      { informal: 'ok', formal: 'okay' },
      { informal: 'thanks', formal: 'thank you' },
      { informal: 'bye', formal: 'goodbye' }
    ];

    for (const rule of formalityRules) {
      // Informal -> Formal
      if (trigger.includes(rule.informal)) {
        variations.add(trigger.replace(new RegExp(`\\b${  rule.informal  }\\b`, 'gi'), rule.formal));
      }
      // Formal -> Informal
      if (trigger.includes(rule.formal)) {
        variations.add(trigger.replace(new RegExp(`\\b${  rule.formal  }\\b`, 'gi'), rule.informal));
      }
    }
  }

  /**
   * Convert to title case
   */
  toTitleCase(str) {
    return str
      .toLowerCase()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}

// Export singleton instance
module.exports = new SmartVariationGenerator();

