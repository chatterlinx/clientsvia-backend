/**
 * ============================================================================
 * FRONTLINE-INTEL SERVICE - CHEAP INTENT CLASSIFIER
 * ============================================================================
 * 
 * PURPOSE: Fast, keyword-based intent classification without LLM calls
 * ARCHITECTURE: Rule-based classifier using keywords and patterns
 * PERFORMANCE: < 5ms per classification
 * 
 * ============================================================================
 */

const logger = require('../../utils/logger');

/**
 * Classify frontline intent from caller text
 * @param {Object} params
 * @param {string} params.text - Cleaned caller utterance (filler removed)
 * @param {Object} params.config - Runtime config from CompanyConfigLoader
 * @param {Object} params.context - Current FrontlineContext from Redis
 * @returns {import('../core/orchestrationTypes').FrontlineIntelResult}
 */
function classifyFrontlineIntent({ text, config, context }) {
  try {
    const lowerText = text.toLowerCase();
    const words = lowerText.split(/\s+/);
    
    // Initialize signals
    const signals = {
      maybeEmergency: false,
      maybeWrongNumber: false,
      maybeSpam: false,
      maybeBooking: false,
      maybeUpdate: false,
      maybeTroubleshooting: false
    };
    
    // Check for very short responses
    const isShortResponse = words.length <= 3;
    const shortResponseWords = ['yes', 'yeah', 'yep', 'no', 'nope', 'ok', 'okay', 'sure', 'fine', 'good'];
    const isConfirmation = isShortResponse && shortResponseWords.some(w => lowerText.includes(w));
    
    // If it's a short confirmation and we already have intent, keep it
    if (isConfirmation && context.currentIntent) {
      return {
        intent: context.currentIntent,
        confidence: 0.9,
        signals
      };
    }
    
    // EMERGENCY DETECTION (highest priority)
    const emergencyKeywords = [
      'emergency', 'urgent', 'asap', 'right now', 'immediately',
      'flooding', 'flood', 'water everywhere', 'burst pipe',
      'gas leak', 'smell gas', 'gas smell',
      'smoke', 'fire', 'sparking', 'electrical fire',
      'no heat', 'freezing', 'cold house',
      'dangerous', 'hazard', 'unsafe'
    ];
    
    if (emergencyKeywords.some(keyword => lowerText.includes(keyword))) {
      signals.maybeEmergency = true;
      return {
        intent: 'emergency',
        confidence: 0.95,
        signals
      };
    }
    
    // WRONG NUMBER DETECTION
    const wrongNumberPhrases = [
      'who is this', 'who are you', 'i didn\'t call', 'stop calling',
      'wrong number', 'didn\'t request', 'not interested', 'take me off',
      'remove me', 'delete my number', 'how did you get'
    ];
    
    if (wrongNumberPhrases.some(phrase => lowerText.includes(phrase))) {
      signals.maybeWrongNumber = true;
      return {
        intent: 'wrong_number',
        confidence: 0.9,
        signals
      };
    }
    
    // SPAM DETECTION
    const spamKeywords = [
      'warranty', 'extended warranty', 'car warranty',
      'survey', 'questionnaire', 'promotion', 'special offer',
      'free cruise', 'congratulations', 'you\'ve won',
      'reduce your debt', 'lower your rate', 'refinance'
    ];
    
    if (spamKeywords.some(keyword => lowerText.includes(keyword))) {
      signals.maybeSpam = true;
      return {
        intent: 'spam',
        confidence: 0.85,
        signals
      };
    }
    
    // APPOINTMENT UPDATE DETECTION
    const updateKeywords = [
      'reschedule', 'cancel', 'change', 'move', 'different time',
      'different day', 'modify', 'update my appointment',
      'cancel my appointment', 'change my appointment'
    ];
    
    const hasAppointmentMention = lowerText.includes('appointment') || 
                                   lowerText.includes('booking') ||
                                   lowerText.includes('scheduled');
    
    if (updateKeywords.some(keyword => lowerText.includes(keyword))) {
      signals.maybeUpdate = true;
      if (hasAppointmentMention) {
        return {
          intent: 'update_appointment',
          confidence: 0.85,
          signals
        };
      }
    }
    
    // BOOKING/SCHEDULING DETECTION
    const bookingKeywords = [
      'appointment', 'schedule', 'book', 'booking', 'reservation',
      'come out', 'send someone', 'need service', 'service call',
      'estimate', 'quote', 'inspection', 'check', 'look at',
      'repair', 'fix', 'install', 'maintenance'
    ];
    
    const timeKeywords = [
      'today', 'tomorrow', 'this week', 'next week',
      'morning', 'afternoon', 'evening',
      'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
      'asap', 'soon', 'when can'
    ];
    
    const hasBookingKeyword = bookingKeywords.some(keyword => lowerText.includes(keyword));
    const hasTimeKeyword = timeKeywords.some(keyword => lowerText.includes(keyword));
    
    if (hasBookingKeyword || (hasTimeKeyword && words.length > 5)) {
      signals.maybeBooking = true;
    }
    
    // TROUBLESHOOTING DETECTION (problem description)
    const problemKeywords = [
      'not working', 'broken', 'problem', 'issue', 'trouble',
      'not cooling', 'not heating', 'making noise', 'buzzing', 'humming',
      'leaking', 'leak', 'dripping', 'water', 'moisture',
      'smell', 'odor', 'stink', 'stinks',
      'error', 'error code', 'flashing', 'blinking',
      'won\'t start', 'won\'t turn on', 'not turning on',
      'keeps shutting off', 'keeps tripping',
      'no hot water', 'no cold water', 'no pressure'
    ];
    
    const hasProblemKeyword = problemKeywords.some(keyword => lowerText.includes(keyword));
    
    if (hasProblemKeyword) {
      signals.maybeTroubleshooting = true;
    }
    
    // BILLING/PRICING DETECTION
    const billingKeywords = [
      'cost', 'price', 'how much', 'charge', 'fee', 'bill', 'invoice',
      'payment', 'pay', 'quote', 'estimate'
    ];
    
    const hasBillingKeyword = billingKeywords.some(keyword => lowerText.includes(keyword));
    
    // INFO/GENERAL QUESTIONS
    const infoKeywords = [
      'do you', 'can you', 'what do', 'what are',
      'hours', 'open', 'available', 'location', 'address',
      'service area', 'cover', 'work in'
    ];
    
    const hasInfoKeyword = infoKeywords.some(keyword => lowerText.includes(keyword));
    
    // DETERMINE PRIMARY INTENT BASED ON SIGNALS
    
    // Booking - strong signal
    if (signals.maybeBooking && (hasTimeKeyword || hasProblemKeyword)) {
      return {
        intent: 'booking',
        confidence: 0.8,
        signals
      };
    }
    
    // Update - if mentioned
    if (signals.maybeUpdate) {
      return {
        intent: 'update_appointment',
        confidence: 0.75,
        signals
      };
    }
    
    // Troubleshooting - problem described
    if (signals.maybeTroubleshooting && !signals.maybeBooking) {
      return {
        intent: 'troubleshooting',
        confidence: 0.7,
        signals
      };
    }
    
    // Billing/pricing questions
    if (hasBillingKeyword && !hasBookingKeyword) {
      return {
        intent: 'billing',
        confidence: 0.7,
        signals
      };
    }
    
    // Info/general questions
    if (hasInfoKeyword) {
      return {
        intent: 'info',
        confidence: 0.65,
        signals
      };
    }
    
    // Default - if booking keywords present even without strong signals
    if (signals.maybeBooking) {
      return {
        intent: 'booking',
        confidence: 0.6,
        signals
      };
    }
    
    // Fallback to other
    return {
      intent: 'other',
      confidence: 0.5,
      signals
    };
    
  } catch (error) {
    logger.error('[FRONTLINE INTEL] Classification error', {
      error: error.message,
      stack: error.stack
    });
    
    // Fallback on error
    return {
      intent: 'other',
      confidence: 0.3,
      signals: {
        maybeEmergency: false,
        maybeWrongNumber: false,
        maybeSpam: false,
        maybeBooking: false,
        maybeUpdate: false,
        maybeTroubleshooting: false
      }
    };
  }
}

module.exports = {
  classifyFrontlineIntent
};

