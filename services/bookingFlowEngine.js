// services/bookingFlowEngine.js

const calendarService = require('./calendarService');

class BookingFlowEngine {
  constructor(companyConfig) {
    this.flow = companyConfig.bookingFlow || [];
    this.currentStep = 0;
    this.sessionData = {};
    this.companyConfig = companyConfig;
    this.availableSlots = [];
  }

  getNextStep() {
    if (this.currentStep >= this.flow.length) return null;
    return this.flow[this.currentStep];
  }

  handleResponse(input) {
    const currentField = this.flow[this.currentStep];
    
    // Validate input based on field type
    if (currentField.validation) {
      const isValid = this.validateInput(input, currentField.validation);
      if (!isValid) {
        return {
          error: true,
          message: currentField.validation.errorMessage || 'Invalid input',
          retry: true
        };
      }
    }
    
    this.sessionData[currentField.name] = input;
    this.currentStep += 1;
    
    // If we just collected service type, fetch available slots
    if (currentField.name === 'serviceType') {
      this.preloadAvailableSlots(input);
    }
    
    return this.getNextStep();
  }

  validateInput(input, validation) {
    switch (validation.type) {
      case 'phone':
        return /^\d{10,}$/.test(input.replace(/\D/g, ''));
      case 'email':
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);
      case 'required':
        return input && input.trim().length > 0;
      default:
        return true;
    }
  }

  async preloadAvailableSlots(serviceType) {
    try {
      this.availableSlots = await calendarService.getAvailableSlots(serviceType);
    } catch (error) {
      console.error('Failed to preload slots:', error);
      this.availableSlots = [];
    }
  }

  isComplete() {
    return this.currentStep >= this.flow.length;
  }

  getSessionData() {
    return this.sessionData;
  }

  async findAvailableTimeSlot(tradeType) {
    if (this.availableSlots.length > 0) {
      return this.availableSlots;
    }
    return await calendarService.getAvailableSlots(tradeType);
  }

  async confirmBooking(selectedSlotId) {
    try {
      const booking = await calendarService.bookSlot(selectedSlotId, {
        ...this.sessionData,
        companyId: this.companyConfig.id || 'default'
      });
      
      return {
        success: true,
        booking,
        message: 'Booking confirmed successfully!',
        confirmationNumber: this.generateConfirmationNumber()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'Failed to confirm booking'
      };
    }
  }

  confirmBookingDetails() {
    const summary = {
      ...this.sessionData,
      availableSlots: this.availableSlots.slice(0, 3) // Show first 3 slots
    };
    
    return {
      message: "Here's what I've got:",
      summary,
      nextAction: 'selectTimeSlot'
    };
  }

  generateConfirmationNumber() {
    return 'BK' + Date.now().toString().slice(-8);
  }

  reset() {
    this.currentStep = 0;
    this.sessionData = {};
    this.availableSlots = [];
  }

  getProgress() {
    return {
      currentStep: this.currentStep,
      totalSteps: this.flow.length,
      percentage: Math.round((this.currentStep / this.flow.length) * 100),
      completed: this.isComplete()
    };
  }
}

module.exports = BookingFlowEngine;
