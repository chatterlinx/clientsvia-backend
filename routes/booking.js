// routes/booking.js
// API routes for booking flow management

const express = require('express');
const router = express.Router();
const BookingFlowEngine = require('../services/bookingFlowEngine');
const calendarService = require('../services/calendarService');

// In-memory session storage (use Redis in production)
const sessions = new Map();

// Start a new booking flow
router.post('/start', async (req, res) => {
  try {
    const { companyId } = req.body;
    
    // Load company configuration (mock for now)
    const companyConfig = {
      id: companyId || 'default',
      bookingFlow: require('../config/sample_booking_flow.json')
    };
    
    // Create new booking session
    const sessionId = 'session_' + Date.now();
    const bookingEngine = new BookingFlowEngine(companyConfig);
    
    sessions.set(sessionId, bookingEngine);
    
    const firstStep = bookingEngine.getNextStep();
    
    res.json({
      success: true,
      sessionId,
      currentStep: firstStep,
      progress: bookingEngine.getProgress()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Handle user response in booking flow
router.post('/respond/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { response } = req.body;
    
    const bookingEngine = sessions.get(sessionId);
    if (!bookingEngine) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }
    
    const result = bookingEngine.handleResponse(response);
    
    if (result && result.error) {
      return res.json({
        success: false,
        error: result.message,
        retry: true,
        progress: bookingEngine.getProgress()
      });
    }
    
    const progress = bookingEngine.getProgress();
    
    if (bookingEngine.isComplete()) {
      const confirmation = bookingEngine.confirmBookingDetails();
      
      res.json({
        success: true,
        completed: true,
        confirmation,
        progress,
        sessionData: bookingEngine.getSessionData()
      });
    } else {
      res.json({
        success: true,
        nextStep: result,
        progress
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get available time slots
router.get('/slots/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const bookingEngine = sessions.get(sessionId);
    if (!bookingEngine) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }
    
    const sessionData = bookingEngine.getSessionData();
    const slots = await bookingEngine.findAvailableTimeSlot(sessionData.serviceType);
    
    res.json({
      success: true,
      slots,
      serviceType: sessionData.serviceType
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Confirm booking with selected time slot
router.post('/confirm/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { slotId } = req.body;
    
    const bookingEngine = sessions.get(sessionId);
    if (!bookingEngine) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }
    
    const result = await bookingEngine.confirmBooking(slotId);
    
    // Clean up session after booking
    if (result.success) {
      sessions.delete(sessionId);
    }
    
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get booking status
router.get('/status/:bookingId', async (req, res) => {
  try {
    const { bookingId } = req.params;
    
    const booking = await calendarService.getBooking(bookingId);
    
    if (!booking) {
      return res.status(404).json({
        success: false,
        error: 'Booking not found'
      });
    }
    
    res.json({
      success: true,
      booking
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Cancel booking
router.delete('/cancel/:bookingId', async (req, res) => {
  try {
    const { bookingId } = req.params;
    
    const result = await calendarService.cancelBooking(bookingId);
    
    res.json({
      success: true,
      message: result.message
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get all bookings (admin)
router.get('/all', async (req, res) => {
  try {
    const bookings = await calendarService.getAllBookings();
    
    res.json({
      success: true,
      bookings,
      count: bookings.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
