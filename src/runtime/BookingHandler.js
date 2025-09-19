/**
 * BookingHandler.js - Interactive booking flow stepper
 * 
 * Handles:
 * - Multi-step booking collection
 * - Field validation and extraction
 * - Booking confirmation and storage
 * - Dynamic flow based on company configuration
 */

const Company = require('../../models/Company');
const Booking = require('../../models/Booking');
// LLMClient removed - using pure in-house system

class BookingHandler {
  /**
   * Start a new booking session
   * @param {string} companyID - Company identifier
   * @param {Object} context - Initial context (user intent, etc.)
   * @returns {Object} Initial booking state
   */
  static async start(companyID, context = {}) {
    try {
      const company = await Company.findById(companyID);
      if (!company || !company.aiAgentLogic?.bookingFlow) {
        throw new Error('Booking flow not configured for company');
      }

      const bookingFlow = company.aiAgentLogic.bookingFlow;
      
      return {
        companyID,
        stepIndex: 0,
        collectedData: {},
        flowConfig: bookingFlow,
        sessionId: this.generateSessionId(),
        startTime: new Date(),
        context: context
      };
    } catch (error) {
      console.error('Error starting booking flow:', error);
      throw error;
    }
  }

  /**
   * Process next step in booking flow
   * @param {Object} state - Current booking state
   * @param {string} userText - User's response
   * @param {Object} context - Additional context
   * @returns {Object} Updated state and response
   */
  static async next(state, userText, context = {}) {
    try {
      const { stepIndex, flowConfig, collectedData } = state;
      const steps = flowConfig.steps || [];
      
      if (stepIndex >= steps.length) {
        // Flow complete, finalize booking
        return await this.finalizeBooking(state);
      }

      const currentStep = steps[stepIndex];
      const extractionResult = await this.extractFieldValue(
        currentStep, 
        userText, 
        collectedData,
        state.companyID
      );

      // Update collected data
      if (extractionResult.value !== null) {
        collectedData[currentStep.field] = extractionResult.value;
        
        // Move to next step
        const nextStepIndex = stepIndex + 1;
        const updatedState = {
          ...state,
          stepIndex: nextStepIndex,
          collectedData,
          lastExtraction: extractionResult
        };

        // Check if we're done or need next prompt
        if (nextStepIndex >= steps.length) {
          return await this.finalizeBooking(updatedState);
        } else {
          return {
            state: updatedState,
            response: this.generateStepPrompt(steps[nextStepIndex], collectedData),
            isComplete: false
          };
        }
      } else {
        // Field extraction failed, ask again
        return {
          state,
          response: extractionResult.retryPrompt || this.generateRetryPrompt(currentStep),
          isComplete: false,
          error: extractionResult.error
        };
      }
    } catch (error) {
      console.error('Error processing booking step:', error);
      return {
        state,
        response: `Configuration error: Company must configure booking responses in AI Agent Logic. Each company must have their own protocol.`,
        isComplete: false,
        error: error.message
      };
    }
  }

  /**
   * Extract field value from user text
   * @param {Object} step - Current step configuration
   * @param {string} userText - User's input
   * @param {Object} collectedData - Previously collected data
   * @param {string} companyID - Company identifier
   * @returns {Object} Extraction result
   */
  static async extractFieldValue(step, userText, collectedData, companyID) {
    const fieldType = step.type || 'text';
    const fieldName = step.field;

    try {
      switch (fieldType) {
        case 'name':
          return this.extractName(userText, step);
          
        case 'phone':
          return this.extractPhone(userText, step);
          
        case 'email':
          return this.extractEmail(userText, step);
          
        case 'address':
          return this.extractAddress(userText, step);
          
        case 'date':
          return this.extractDate(userText, step);
          
        case 'time':
          return this.extractTime(userText, step);
          
        case 'datetime':
          return this.extractDateTime(userText, step);
          
        case 'service':
          return this.extractService(userText, step, companyID);
          
        case 'priority':
          return this.extractPriority(userText, step);
          
        case 'text':
        default:
          return this.extractText(userText, step);
      }
    } catch (error) {
      return {
        value: null,
        error: error.message,
        retryPrompt: `I'm sorry, I couldn't understand that. ${step.prompt}`
      };
    }
  }

  /**
   * Extract name from user text
   */
  static extractName(userText, step) {
    // Simple name extraction - could be enhanced with NLP
    const nameMatch = userText.match(/(?:my name is|i'm|i am|call me)\s+([a-zA-Z\s]+)/i);
    if (nameMatch) {
      const name = nameMatch[1].trim();
      if (name.length > 1 && name.length < 50) {
        return { value: name, confidence: 0.8 };
      }
    }

    // Try to extract just words that look like names
    const words = userText.split(/\s+/).filter(word => 
      /^[A-Za-z]{2,}$/.test(word) && 
      !['the', 'and', 'for', 'with', 'that', 'this'].includes(word.toLowerCase())
    );
    
    if (words.length >= 1 && words.length <= 3) {
      return { value: words.join(' '), confidence: 0.6 };
    }

    return {
      value: null,
      error: 'Could not extract name',
      retryPrompt: "Could you please tell me your full name?"
    };
  }

  /**
   * Extract phone number from user text
   */
  static extractPhone(userText, step) {
    // Remove common words and extract digits
    const digits = userText.replace(/[^\d]/g, '');
    
    // US phone number patterns
    if (digits.length === 10) {
      const formatted = `(${digits.substr(0,3)}) ${digits.substr(3,3)}-${digits.substr(6,4)}`;
      return { value: formatted, confidence: 0.9 };
    } else if (digits.length === 11 && digits[0] === '1') {
      const phone = digits.substr(1);
      const formatted = `(${phone.substr(0,3)}) ${phone.substr(3,3)}-${phone.substr(6,4)}`;
      return { value: formatted, confidence: 0.9 };
    }

    return {
      value: null,
      error: 'Invalid phone number format',
      retryPrompt: "Could you please provide your phone number? For example: 555-123-4567"
    };
  }

  /**
   * Extract email from user text
   */
  static extractEmail(userText, step) {
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/;
    const match = userText.match(emailRegex);
    
    if (match) {
      return { value: match[0].toLowerCase(), confidence: 0.9 };
    }

    return {
      value: null,
      error: 'No valid email found',
      retryPrompt: "Could you please provide your email address?"
    };
  }

  /**
   * Extract address from user text
   */
  static extractAddress(userText, step) {
    // Simple address extraction - could be enhanced with geocoding API
    if (userText.length > 10 && userText.length < 200) {
      // Look for common address patterns
      const hasNumber = /\d/.test(userText);
      const hasStreetWords = /\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|way|boulevard|blvd)\b/i.test(userText);
      
      if (hasNumber && (hasStreetWords || userText.split(' ').length >= 3)) {
        return { value: userText.trim(), confidence: 0.7 };
      }
    }

    return {
      value: null,
      error: 'Could not extract address',
      retryPrompt: "Could you please provide your full address, including street number and name?"
    };
  }

  /**
   * Extract date from user text
   */
  static extractDate(userText, step) {
    const today = new Date();
    const text = userText.toLowerCase();

    // Handle relative dates
    if (text.includes('today')) {
      return { value: today.toISOString().split('T')[0], confidence: 0.9 };
    } else if (text.includes('tomorrow')) {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return { value: tomorrow.toISOString().split('T')[0], confidence: 0.9 };
    }

    // Handle day names
    const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    for (const day of dayNames) {
      if (text.includes(day)) {
        const date = this.getNextWeekday(day);
        return { value: date.toISOString().split('T')[0], confidence: 0.8 };
      }
    }

    // Handle date patterns (MM/DD/YYYY, MM-DD-YYYY, etc.)
    const datePatterns = [
      /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/,
      /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/
    ];

    for (const pattern of datePatterns) {
      const match = userText.match(pattern);
      if (match) {
        try {
          const date = new Date(match[0]);
          if (!isNaN(date.getTime()) && date > today) {
            return { value: date.toISOString().split('T')[0], confidence: 0.8 };
          }
        } catch (e) {
          // Invalid date, continue
        }
      }
    }

    return {
      value: null,
      error: 'Could not extract date',
      retryPrompt: "What date would work for you? You can say something like 'tomorrow' or 'next Friday'."
    };
  }

  /**
   * Extract time from user text
   */
  static extractTime(userText, step) {
    const timePatterns = [
      /(\d{1,2}):(\d{2})\s*(am|pm)/i,
      /(\d{1,2})\s*(am|pm)/i,
      /(\d{1,2}):(\d{2})/
    ];

    for (const pattern of timePatterns) {
      const match = userText.match(pattern);
      if (match) {
        let hour = parseInt(match[1]);
        const minute = match[2] ? parseInt(match[2]) : 0;
        const meridiem = match[3] ? match[3].toLowerCase() : null;

        if (meridiem === 'pm' && hour !== 12) {
          hour += 12;
        } else if (meridiem === 'am' && hour === 12) {
          hour = 0;
        }

        if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
          const timeString = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
          return { value: timeString, confidence: 0.9 };
        }
      }
    }

    return {
      value: null,
      error: 'Could not extract time',
      retryPrompt: "What time would work for you? For example: '2:30 PM' or '14:30'."
    };
  }

  /**
   * Extract combined date and time
   */
  static extractDateTime(userText, step) {
    const dateResult = this.extractDate(userText, step);
    const timeResult = this.extractTime(userText, step);

    if (dateResult.value && timeResult.value) {
      const datetime = `${dateResult.value}T${timeResult.value}:00`;
      return { value: datetime, confidence: Math.min(dateResult.confidence, timeResult.confidence) };
    }

    return {
      value: null,
      error: 'Could not extract date and time',
      retryPrompt: "When would you like to schedule this? Please provide both the date and time."
    };
  }

  /**
   * Extract service type
   */
  static async extractService(userText, step, companyID) {
    const options = step.options || [];
    const text = userText.toLowerCase();

    // Check for exact matches
    for (const option of options) {
      if (text.includes(option.toLowerCase())) {
        return { value: option, confidence: 0.9 };
      }
    }

    // Use LLM for service classification if no exact match
    if (options.length > 0) {
      try {
        const company = await Company.findById(companyID);
        const prompt = `Given the user's request: "${userText}", which of these services best matches: ${options.join(', ')}? Respond with just the service name.`;
        
        const llmResult = await llmClient.answer(
          company.aiAgentLogic?.modelConfig,
          companyID,
          prompt
        );

        const suggestedService = llmResult.text?.trim();
        if (options.some(opt => opt.toLowerCase() === suggestedService?.toLowerCase())) {
          return { value: suggestedService, confidence: 0.7 };
        }
      } catch (error) {
        console.error('LLM service extraction failed:', error);
      }
    }

    return {
      value: userText.trim(),
      confidence: 0.5,
      retryPrompt: step.options ? 
        `Which service do you need? We offer: ${step.options.join(', ')}` :
        "Could you please describe what service you need?"
    };
  }

  /**
   * Extract priority level
   */
  static extractPriority(userText, step) {
    const text = userText.toLowerCase();
    const urgentKeywords = ['urgent', 'emergency', 'asap', 'immediately', 'right away'];
    const highKeywords = ['soon', 'quickly', 'high priority'];
    const lowKeywords = ['low priority', 'not urgent', 'whenever', 'no rush'];

    if (urgentKeywords.some(keyword => text.includes(keyword))) {
      return { value: 'urgent', confidence: 0.9 };
    } else if (highKeywords.some(keyword => text.includes(keyword))) {
      return { value: 'high', confidence: 0.8 };
    } else if (lowKeywords.some(keyword => text.includes(keyword))) {
      return { value: 'low', confidence: 0.8 };
    }

    return { value: 'normal', confidence: 0.6 };
  }

  /**
   * Extract general text
   */
  static extractText(userText, step) {
    const text = userText.trim();
    if (text.length > 0) {
      return { value: text, confidence: 0.9 };
    }

    return {
      value: null,
      error: 'No text provided',
      retryPrompt: step.prompt || "Could you please provide more details?"
    };
  }

  /**
   * Generate prompt for current step
   */
  static generateStepPrompt(step, collectedData) {
    let prompt = step.prompt || `Please provide your ${step.field}.`;

    // Add context if previous data was collected
    if (Object.keys(collectedData).length > 0) {
      const context = this.buildContextString(collectedData);
      prompt = `Great! ${context} Now, ${prompt}`;
    }

    return prompt;
  }

  /**
   * Generate retry prompt for failed extraction
   */
  static generateRetryPrompt(step) {
    return `I didn't quite catch that. ${step.prompt || `Could you please provide your ${step.field}?`}`;
  }

  /**
   * Finalize booking and save to database
   */
  static async finalizeBooking(state) {
    try {
      const { companyID, collectedData, sessionId } = state;
      
      // Create booking document
      const booking = new Booking({
        companyID,
        sessionId,
        customerInfo: {
          name: collectedData.name,
          phone: collectedData.phone,
          email: collectedData.email,
          address: collectedData.address
        },
        serviceDetails: {
          type: collectedData.service,
          description: collectedData.description,
          priority: collectedData.priority || 'normal'
        },
        scheduledDateTime: collectedData.datetime || collectedData.date,
        scheduledTime: collectedData.time,
        status: 'pending',
        source: 'ai_agent',
        createdAt: new Date(),
        collectedData: collectedData
      });

      await booking.save();

      // Generate confirmation message
      const confirmationMessage = this.generateConfirmationMessage(collectedData, booking._id);

      return {
        state: { ...state, isComplete: true, bookingId: booking._id },
        response: confirmationMessage,
        isComplete: true,
        booking: booking
      };
    } catch (error) {
      console.error('Error finalizing booking:', error);
      return {
        state,
        response: `Configuration error: Company must configure booking responses in AI Agent Logic. Each company must have their own protocol.`,
        isComplete: false,
        error: error.message
      };
    }
  }

  /**
   * Generate confirmation message
   */
  static generateConfirmationMessage(data, bookingId) {
    const parts = [];
    
    parts.push("Perfect! I've scheduled your appointment.");
    
    if (data.name) {
      parts.push(`Name: ${data.name}`);
    }
    
    if (data.service) {
      parts.push(`Service: ${data.service}`);
    }
    
    if (data.datetime) {
      const date = new Date(data.datetime);
      parts.push(`Date & Time: ${date.toLocaleDateString()} at ${date.toLocaleTimeString()}`);
    } else {
      if (data.date) {
        parts.push(`Date: ${new Date(data.date).toLocaleDateString()}`);
      }
      if (data.time) {
        parts.push(`Time: ${data.time}`);
      }
    }
    
    if (data.address) {
      parts.push(`Address: ${data.address}`);
    }
    
    parts.push(`Your booking confirmation number is ${bookingId.toString().slice(-6).toUpperCase()}.`);
    parts.push("Someone will contact you shortly to confirm the details. Is there anything else I can help you with?");
    
    return parts.join(' ');
  }

  /**
   * Build context string from collected data
   */
  static buildContextString(collectedData) {
    const parts = [];
    
    if (collectedData.name) {
      parts.push(`I have your name as ${collectedData.name}`);
    }
    
    if (collectedData.service) {
      parts.push(`for ${collectedData.service} service`);
    }
    
    return parts.join(' ') + '.';
  }

  /**
   * Get next occurrence of a weekday
   */
  static getNextWeekday(dayName) {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const today = new Date();
    const todayDay = today.getDay();
    const targetDay = days.indexOf(dayName.toLowerCase());
    
    if (targetDay === -1) return today;
    
    const daysUntilTarget = (targetDay - todayDay + 7) % 7;
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + (daysUntilTarget === 0 ? 7 : daysUntilTarget));
    
    return targetDate;
  }

  /**
   * Generate unique session ID
   */
  static generateSessionId() {
    return `booking_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get booking by session ID
   */
  static async getBookingBySession(sessionId) {
    try {
      return await Booking.findOne({ sessionId });
    } catch (error) {
      console.error('Error fetching booking by session:', error);
      return null;
    }
  }

  /**
   * Cancel booking
   */
  static async cancelBooking(bookingId, reason = 'customer_request') {
    try {
      const booking = await Booking.findById(bookingId);
      if (!booking) {
        throw new Error('Booking not found');
      }

      booking.status = 'cancelled';
      booking.cancellationReason = reason;
      booking.cancelledAt = new Date();
      
      await booking.save();
      return booking;
    } catch (error) {
      console.error('Error cancelling booking:', error);
      throw error;
    }
  }
}

module.exports = {
  start: async (companyID, context) => {
    return await BookingHandler.start(companyID, context);
  },
  next: async (state, userText, context) => {
    return await BookingHandler.next(state, userText, context);
  },
  finalizeBooking: async (state) => {
    return await BookingHandler.finalizeBooking(state);
  },
  BookingHandler
};
