/**
 * Booking Flow Handler
 * Handles the multi-step booking process after service issue detection
 */

class BookingFlowHandler {
  constructor() {
    this.bookingSteps = {
      address_collection: {
        step: 'address_collection',
        question: 'Is this for your home or business?',
        nextStep: 'location_details',
        validation: ['home', 'business', 'residence', 'commercial', 'house', 'office']
      },
      location_details: {
        step: 'location_details', 
        question: 'What\'s the address where you need service?',
        nextStep: 'contact_info',
        validation: null // Address validation would go here
      },
      contact_info: {
        step: 'contact_info',
        question: 'What\'s the best phone number to reach you?',
        nextStep: 'availability',
        validation: /^\(?[\d\s\-\(\)]{10,}$/ // Basic phone validation
      },
      availability: {
        step: 'availability',
        question: 'Are you available today for an emergency service call, or would you prefer to schedule for tomorrow?',
        nextStep: 'confirmation',
        validation: ['today', 'tomorrow', 'now', 'asap', 'later', 'schedule']
      },
      confirmation: {
        step: 'confirmation', 
        question: 'Perfect! I\'ve got you scheduled. A technician will call you within 15 minutes to confirm the appointment and provide an arrival time. Is there anything else I can help you with?',
        nextStep: 'complete',
        validation: null
      }
    };
  }

  /**
   * Process booking flow step based on user response
   */
  processBookingStep(currentStep, userResponse, bookingContext = {}) {
    const stepConfig = this.bookingSteps[currentStep];
    
    if (!stepConfig) {
      return {
        error: true,
        message: 'Invalid booking step',
        shouldEscalate: true
      };
    }

    console.log(`[Booking Flow] Processing step: ${currentStep}`);
    console.log(`[Booking Flow] User response: "${userResponse}"`);

    // Validate user response if validation exists
    if (stepConfig.validation) {
      const isValid = this.validateResponse(userResponse, stepConfig.validation);
      if (!isValid) {
        return {
          error: false,
          needsClarification: true,
          response: this.getClarificationMessage(currentStep, userResponse),
          currentStep: currentStep // Stay on same step
        };
      }
    }

    // Store the response in booking context
    bookingContext[currentStep] = userResponse;

    // Move to next step
    const nextStep = stepConfig.nextStep;
    
    if (nextStep === 'complete') {
      return {
        error: false,
        bookingComplete: true,
        response: this.getConfirmationMessage(bookingContext),
        bookingReference: this.generateBookingReference(),
        bookingData: bookingContext
      };
    }

    const nextStepConfig = this.bookingSteps[nextStep];
    
    return {
      error: false,
      needsNextStep: true,
      response: this.getStepResponse(currentStep, userResponse, nextStepConfig.question),
      currentStep: nextStep,
      nextStep: nextStep,
      bookingContext: bookingContext
    };
  }

  /**
   * Validate user response based on step requirements
   */
  validateResponse(response, validation) {
    if (Array.isArray(validation)) {
      // Keyword validation
      const responseLower = response.toLowerCase();
      return validation.some(keyword => responseLower.includes(keyword));
    } else if (validation instanceof RegExp) {
      // Regex validation
      return validation.test(response);
    }
    return true; // No validation required
  }

  /**
   * Get clarification message when validation fails
   */
  getClarificationMessage(step, response) {
    const clarifications = {
      address_collection: "I need to know if this is for your home or business location. Could you please clarify?",
      contact_info: "I need a valid phone number to reach you. Could you please provide your phone number?",
      availability: "Would you prefer service today or would you like to schedule for tomorrow?"
    };

    return clarifications[step] || "Could you please clarify your response?";
  }

  /**
   * Generate response acknowledging current step and asking next question
   */
  getStepResponse(currentStep, userResponse, nextQuestion) {
    const acknowledgments = {
      address_collection: userResponse.toLowerCase().includes('business') || userResponse.toLowerCase().includes('commercial') || userResponse.toLowerCase().includes('office')
        ? "Got it, for your business location."
        : "Understood, for your home.",
      location_details: "Thank you for the address.",
      contact_info: "Perfect, I have your contact number.",
      availability: "Excellent choice."
    };

    const ack = acknowledgments[currentStep] || "Thank you.";
    return `${ack} ${nextQuestion}`;
  }

  /**
   * Generate final confirmation message
   */
  getConfirmationMessage(bookingContext) {
    const locationType = bookingContext.address_collection?.toLowerCase().includes('business') ? 'business' : 'home';
    const timing = bookingContext.availability?.toLowerCase().includes('today') || bookingContext.availability?.toLowerCase().includes('now') ? 'today' : 'soon';
    
    return `Perfect! I've scheduled an emergency service call for your ${locationType} ${timing}. A technician will call you within 15 minutes to confirm the appointment and provide an arrival time. Your service request has been submitted and our team is preparing to help you. Is there anything else I can help you with?`;
  }

  /**
   * Generate unique booking reference
   */
  generateBookingReference() {
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.random().toString(36).substring(2, 5).toUpperCase();
    return `SVC-${timestamp}-${random}`;
  }

  /**
   * Get initial booking question based on service issue
   */
  getInitialBookingQuestion(serviceType, urgency) {
    if (urgency === 'high' || urgency === 'urgent') {
      return "Let's get this emergency taken care of right away. Is this for your home or business?";
    }
    return "Let's get you scheduled for service. Is this for your home or business?";
  }

  /**
   * Check if response indicates user wants to exit booking flow
   */
  isBookingExit(response) {
    const exitKeywords = [
      'cancel', 'nevermind', 'never mind', 'not now', 'later', 'call back',
      'no thanks', 'no thank you', 'not interested', 'abort', 'stop'
    ];
    
    const responseLower = response.toLowerCase();
    return exitKeywords.some(keyword => responseLower.includes(keyword));
  }

  /**
   * Handle booking flow exit
   */
  handleBookingExit() {
    return {
      bookingCancelled: true,
      response: "No problem! If you change your mind and need service, just give us a call. We're here to help whenever you're ready. Is there anything else I can assist you with today?"
    };
  }
}

module.exports = BookingFlowHandler;
