/**
 * AI RESPONSE SUGGESTION SERVICE
 * 
 * Purpose: Generate smart, contextual AI responses for instant response Q&As
 * - Uses category context and trigger phrases to generate appropriate responses
 * - Creates SHORT, PRECISE, NATURAL responses (2-3 sentences max)
 * - Follows company personality and tone guidelines
 * 
 * Strategy:
 * 1. Analyze trigger intent (greeting, thanks, frustration, etc.)
 * 2. Consider category description (empathy, professionalism, etc.)
 * 3. Generate contextually appropriate response
 * 4. Keep it conversational and action-oriented
 * 
 * NO EXTERNAL LLMs - 100% in-house, pattern-based generation
 * 
 * Created: 2025-10-02
 */

class AIResponseSuggestionService {
  /**
   * Generate MULTIPLE AI response variations based on context
   * Returns 3-5 variations to avoid sounding robotic
   * @param {Object} context - Context for generation
   * @param {String} context.categoryName - Category name
   * @param {String} context.categoryDescription - Category description
   * @param {String} context.mainTrigger - Main trigger phrase
   * @param {Array} context.variations - Trigger variations
   * @param {String} context.companyName - Company name (optional)
   * @param {Number} context.count - Number of variations to generate (default: 3)
   * @returns {Array} - Array of suggested responses
   */
  suggestResponses(context) {
    const {
      categoryName = '',
      categoryDescription = '',
      mainTrigger = '',
      variations = [],
      companyName = '[Company Name]',
      count = 3
    } = context;

    logger.info(`[AI Suggest] Generating ${count} response variations for: "${mainTrigger}"`);
    logger.info(`[AI Suggest] Category: ${categoryName}`);

    // Detect intent from trigger and category
    const intent = this.detectIntent(mainTrigger, categoryName, categoryDescription);
    logger.info(`[AI Suggest] Detected intent: ${intent}`);

    // Generate multiple response variations
    const responses = this.generateResponseVariationsForIntent(intent, mainTrigger, categoryDescription, companyName, count);

    logger.info(`[AI Suggest] Generated ${responses.length} variations`);
    return responses;
  }

  /**
   * Generate SINGLE response (for backwards compatibility)
   * @deprecated Use suggestResponses() instead for multi-variation support
   */
  suggestResponse(context) {
    const responses = this.suggestResponses({ ...context, count: 1 });
    return responses[0] || "I'm here to help!";
  }

  /**
   * Detect intent from trigger phrase and context
   */
  detectIntent(trigger, categoryName, description) {
    const lowerTrigger = trigger.toLowerCase();
    const lowerCategory = categoryName.toLowerCase();
    const lowerDesc = description.toLowerCase();

    // GREETING INTENTS
    if (this.matchesPattern(lowerTrigger, ['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening'])) {
      return 'greeting';
    }

    // THANKS/GRATITUDE INTENTS
    if (this.matchesPattern(lowerTrigger, ['thank', 'thanks', 'appreciate', 'grateful'])) {
      return 'gratitude';
    }

    // WAIT/HOLD INTENTS
    if (this.matchesPattern(lowerTrigger, ['hold', 'wait', 'moment', 'second', 'bear with'])) {
      return 'wait';
    }

    // FRUSTRATION/UPSET INTENTS
    if (this.matchesPattern(lowerTrigger, ['frustrated', 'upset', 'angry', 'mad', 'annoyed', 'disappointed']) ||
        this.matchesPattern(lowerDesc, ['empathy', 'understanding', 'frustrated', 'upset'])) {
      return 'frustration';
    }

    // APOLOGY INTENTS
    if (this.matchesPattern(lowerTrigger, ['sorry', 'apologize', 'apologies', 'excuse me', 'my bad'])) {
      return 'apology';
    }

    // HELP/ASSISTANCE INTENTS
    if (this.matchesPattern(lowerTrigger, ['help', 'assist', 'support', 'need'])) {
      return 'help';
    }

    // GOODBYE INTENTS
    if (this.matchesPattern(lowerTrigger, ['bye', 'goodbye', 'see you', 'later', 'take care'])) {
      return 'goodbye';
    }

    // CHECKING/CONSULTATION INTENTS
    if (this.matchesPattern(lowerTrigger, ['checking', 'let me check', 'looking into', 'finding out']) ||
        this.matchesPattern(lowerCategory, ['consultation', 'checking'])) {
      return 'checking';
    }

    // DEFAULT: Generic acknowledgment
    return 'acknowledgment';
  }

  /**
   * Check if text matches any of the patterns
   */
  matchesPattern(text, patterns) {
    return patterns.some(pattern => text.includes(pattern));
  }

  /**
   * Generate MULTIPLE response variations for intent (NEW)
   */
  generateResponseVariationsForIntent(intent, trigger, description, companyName, count = 3) {
    const allResponses = this.getAllResponsesForIntent(intent, companyName);
    
    // Shuffle and return requested count
    const shuffled = allResponses.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, Math.min(count, allResponses.length));
  }

  /**
   * Generate SINGLE response (legacy method)
   * @deprecated
   */
  generateResponseForIntent(intent, trigger, description, companyName) {
    const responses = this.getAllResponsesForIntent(intent, companyName);
    return responses[Math.floor(Math.random() * responses.length)];
  }

  /**
   * Get all available responses for an intent
   */
  getAllResponsesForIntent(intent, companyName = '[Company Name]') {
    const responses = {
      greeting: [
        `Hi! How can I help you today?`,
        `Hello! Thanks for reaching out. What can I do for you?`,
        `Hey there! How may I assist you today?`,
        `Good to hear from you! What brings you in today?`
      ],
      
      gratitude: [
        `You're very welcome! Is there anything else I can help you with?`,
        `Happy to help! Let me know if you need anything else.`,
        `My pleasure! Feel free to reach out anytime.`,
        `Glad I could assist! Don't hesitate to ask if you have more questions.`
      ],
      
      wait: [
        `Of course! Take your time. I'll be right here when you're ready.`,
        `No problem at all! I'll wait for you.`,
        `Sure thing! I'm here whenever you're ready to continue.`,
        `Absolutely! Let me know when you're ready to proceed.`
      ],
      
      frustration: [
        `I completely understand your frustration. Let me help you get this resolved right away.`,
        `I hear you, and I'm truly sorry you're experiencing this. Let's work together to fix it.`,
        `I understand how upsetting this must be. I'm here to help make this right for you.`,
        `Your frustration is completely valid. Let me see what I can do to resolve this for you immediately.`
      ],
      
      apology: [
        `No need to apologize! How can I assist you today?`,
        `That's perfectly fine! What can I help you with?`,
        `No worries at all! Let me know what you need.`,
        `Don't worry about it! How may I help you?`
      ],
      
      help: [
        `I'm here to help! What do you need assistance with?`,
        `Absolutely! I'd be happy to assist you. What's going on?`,
        `Of course! Let me know what you need and I'll get you sorted out.`,
        `I'm glad you reached out! Tell me what you need help with.`
      ],
      
      goodbye: [
        `Thank you for contacting us! Have a wonderful day.`,
        `Take care! Feel free to reach out anytime you need assistance.`,
        `Have a great day! We're always here if you need anything.`,
        `Thanks for calling! Don't hesitate to contact us again if you need help.`
      ],
      
      checking: [
        `Let me look into that for you. I'll have an answer in just a moment.`,
        `I'm checking on that right now. Thank you for your patience.`,
        `Give me just a second to verify that information for you.`,
        `I'm looking into that as we speak. I'll have details for you shortly.`
      ],
      
      acknowledgment: [
        `I understand. How can I assist you with that?`,
        `Got it. Let me help you with that right away.`,
        `I hear you. What would you like me to do to help?`,
        `Understood. I'm here to help you with this.`
      ]
    };

    // Get responses for this intent
    const intentResponses = responses[intent] || responses.acknowledgment;
    
    // Replace company name placeholder in all responses
    return intentResponses.map(r => r.replace(/\[Company Name\]/g, companyName));
  }

  /**
   * Generate response with custom personality/tone
   */
  generateCustomResponse(trigger, tone = 'professional', length = 'short') {
    // This can be extended later for more advanced customization
    const context = {
      mainTrigger: trigger,
      categoryName: tone,
      categoryDescription: `Respond in a ${tone} manner`,
      companyName: '[Company Name]'
    };

    return this.suggestResponse(context);
  }
}

// Export singleton instance
module.exports = new AIResponseSuggestionService();

