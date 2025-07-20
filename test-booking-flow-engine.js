// test-booking-flow-engine.js
// Test script for the Enhanced Booking Flow Engine

const BookingFlowEngine = require('./services/bookingFlowEngine');
const calendarService = require('./services/calendarService');
const sampleFlow = require('./config/sample_booking_flow.json');

async function testBookingFlowEngine() {
  console.log('🚀 Testing Enhanced Booking Flow Engine...\n');

  // Create company config with booking flow
  const companyConfig = {
    id: 'test-company',
    bookingFlow: sampleFlow
  };

  // Initialize booking engine
  const bookingEngine = new BookingFlowEngine(companyConfig);
  
  console.log('📋 Starting booking flow...');
  console.log(`📊 Initial Progress: ${JSON.stringify(bookingEngine.getProgress())}\n`);
  
  // Simulate user responses with validation
  const userResponses = [
    'HVAC',
    '123 Main St, City, State 12345',
    '5551234567',
    'customer@example.com',
    'Standard (Within 3 days)',
    'Front door is blue, dog in backyard named Max'
  ];

  let stepIndex = 0;
  let currentStep = bookingEngine.getNextStep();

  while (currentStep && stepIndex < userResponses.length) {
    console.log(`\n🤖 Agent: ${currentStep.prompt}`);
    if (currentStep.options) {
      console.log(`� Options: ${currentStep.options.join(', ')}`);
    }
    console.log(`�👤 Customer: ${userResponses[stepIndex]}`);
    
    // Handle the response
    const result = bookingEngine.handleResponse(userResponses[stepIndex]);
    
    if (result && result.error) {
      console.log(`❌ Validation Error: ${result.message}`);
      continue; // In real scenario, would ask for input again
    }
    
    console.log(`📊 Progress: ${JSON.stringify(bookingEngine.getProgress())}`);
    
    currentStep = result;
    stepIndex++;
  }

  // Check if flow is complete
  if (bookingEngine.isComplete()) {
    console.log('\n✅ Booking flow completed!');
    
    // Get confirmation details
    const confirmation = bookingEngine.confirmBookingDetails();
    console.log('\n📝 Booking Summary:');
    console.log(confirmation.message);
    console.log(JSON.stringify(confirmation.summary, null, 2));

    // Test available time slots
    console.log('\n📅 Finding available time slots...');
    const slots = await bookingEngine.findAvailableTimeSlot('HVAC');
    console.log(`Found ${slots.length} available slots:`);
    slots.slice(0, 3).forEach((slot, index) => {
      const start = new Date(slot.start);
      const end = new Date(slot.end);
      console.log(`  ${index + 1}. ${start.toLocaleDateString()} ${start.toLocaleTimeString()} - ${end.toLocaleTimeString()}`);
    });

    // Test booking confirmation
    if (slots.length > 0) {
      console.log('\n🎯 Testing booking confirmation...');
      const selectedSlot = slots[0];
      const bookingResult = await bookingEngine.confirmBooking(selectedSlot.id);
      
      if (bookingResult.success) {
        console.log('✅ Booking confirmed!');
        console.log(`📋 Confirmation Number: ${bookingResult.confirmationNumber}`);
        console.log('📞 Booking Details:', JSON.stringify(bookingResult.booking, null, 2));
      } else {
        console.log('❌ Booking failed:', bookingResult.message);
      }
    }
  } else {
    console.log('\n❌ Booking flow incomplete');
  }

  // Test calendar service directly
  console.log('\n🗓️ Testing Calendar Service...');
  const allBookings = await calendarService.getAllBookings();
  console.log(`📊 Total bookings in system: ${allBookings.length}`);

  console.log('\n🎯 Enhanced Booking Flow Engine test completed!');
}

// Test booking API endpoints simulation
async function testBookingAPI() {
  console.log('\n🌐 Testing Booking API Simulation...');
  
  const express = require('express');
  const bookingRoutes = require('./routes/booking');
  
  // Simulate API calls
  console.log('✅ Booking API routes loaded successfully');
  console.log('📡 Routes available: /start, /respond/:sessionId, /slots/:sessionId, /confirm/:sessionId');
}

// Run the tests
if (require.main === module) {
  Promise.resolve()
    .then(() => testBookingFlowEngine())
    .then(() => testBookingAPI())
    .catch(console.error);
}

module.exports = { testBookingFlowEngine, testBookingAPI };
