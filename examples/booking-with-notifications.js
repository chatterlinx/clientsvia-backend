// examples/booking-with-notifications.js
// Example: Integrating booking flow with notifications

const NotificationIntegration = require('../services/notificationIntegration');
const BookingFlowEngine = require('../services/bookingFlowEngine');

class BookingWithNotifications {
  constructor(options = {}) {
    // Initialize notification integration
    this.notifications = new NotificationIntegration({
      companyInfo: {
        name: 'CoolAir HVAC Services',
        phone: '555-HVAC-NOW',
        email: 'service@coolairhvac.com',
        website: 'www.coolairhvac.com'
      },
      ...options
    });

    // Initialize booking engine with basic config
    this.bookingEngine = new BookingFlowEngine({
      bookingFlow: []
    });
  }

  /**
   * Process a complete booking with notifications
   */
  async processBooking(bookingRequest) {
    console.log('🎯 Processing booking with notifications...');
    
    try {
      // Step 1: Validate and create booking
      const booking = await this.createBooking(bookingRequest);
      console.log('✅ Booking created:', booking.id);

      // Step 2: Send confirmation notification
      const confirmationResult = await this.notifications.sendBookingConfirmation({
        customerName: booking.customerName,
        customerPhone: booking.customerPhone,
        customerEmail: booking.customerEmail,
        serviceType: booking.serviceType,
        appointmentTime: booking.appointmentTime,
        address: booking.address
      });

      console.log('📱 Confirmation sent:', confirmationResult.success);

      // Step 3: Schedule reminder (in real app, use a job queue)
      this.scheduleReminder(booking);

      return {
        success: true,
        booking,
        confirmationSent: confirmationResult.success
      };

    } catch (error) {
      console.error('❌ Booking processing failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Create booking record
   */
  async createBooking(request) {
    // Simulate booking creation
    const booking = {
      id: `booking_${Date.now()}`,
      customerName: request.customerName,
      customerPhone: request.customerPhone,
      customerEmail: request.customerEmail,
      serviceType: request.serviceType,
      appointmentTime: request.appointmentTime,
      address: request.address,
      status: 'confirmed',
      createdAt: new Date()
    };

    // In real app, save to database
    console.log('💾 Booking saved to database');
    
    return booking;
  }

  /**
   * Schedule booking reminder
   */
  scheduleReminder(booking) {
    // In production, use a proper job queue like Bull or Agenda
    console.log('⏰ Reminder scheduled for 24 hours before appointment');
    
    // Simulate scheduling (in real app, calculate actual time)
    setTimeout(async () => {
      await this.notifications.sendBookingReminder({
        customerName: booking.customerName,
        customerPhone: booking.customerPhone,
        customerEmail: booking.customerEmail,
        serviceType: booking.serviceType,
        appointmentTime: booking.appointmentTime,
        address: booking.address
      });
      console.log('📅 Reminder sent for booking:', booking.id);
    }, 2000); // 2 seconds = 24 hours in this demo
  }

  /**
   * Cancel booking with notification
   */
  async cancelBooking(bookingId, reason = 'Scheduling conflict') {
    console.log(`❌ Cancelling booking: ${bookingId}`);
    
    try {
      // Get booking details (simulate)
      const booking = await this.getBooking(bookingId);
      
      // Update booking status
      booking.status = 'cancelled';
      booking.cancellationReason = reason;
      
      // Send cancellation notification
      const result = await this.notifications.getNotificationService().sendNotification(
        {
          phone: booking.customerPhone,
          email: booking.customerEmail
        },
        'bookingCancellation',
        {
          customerName: booking.customerName,
          appointmentTime: booking.appointmentTime,
          cancellationReason: reason,
          phone: '555-HVAC-NOW'
        },
        { preferSMS: true, sendBoth: false }
      );

      console.log('📱 Cancellation notification sent:', result.success);
      
      return {
        success: true,
        booking,
        notificationSent: result.success
      };

    } catch (error) {
      console.error('❌ Cancellation failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Complete service with notification
   */
  async completeService(bookingId, completionData) {
    console.log(`✅ Completing service for booking: ${bookingId}`);
    
    try {
      // Get booking details
      const booking = await this.getBooking(bookingId);
      
      // Update booking status
      booking.status = 'completed';
      booking.completedAt = new Date();
      booking.technician = completionData.technicianName;
      
      // Send completion notification
      const result = await this.notifications.sendServiceComplete(
        {
          phone: booking.customerPhone,
          email: booking.customerEmail
        },
        {
          customerName: booking.customerName,
          serviceType: booking.serviceType,
          serviceDate: new Date().toLocaleDateString(),
          technicianName: completionData.technicianName,
          serviceDescription: completionData.description || booking.serviceType,
          reviewLink: `https://coolairhvac.com/review/${bookingId}`
        }
      );

      console.log('📧 Completion notification sent:', result.success);
      
      return {
        success: true,
        booking,
        notificationSent: result.success
      };

    } catch (error) {
      console.error('❌ Service completion failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get booking by ID (simulate database lookup)
   */
  async getBooking(bookingId) {
    // Simulate database lookup
    return {
      id: bookingId,
      customerName: 'John Smith',
      customerPhone: '+1-555-0123',
      customerEmail: 'john.smith@email.com',
      serviceType: 'HVAC Repair',
      appointmentTime: 'Tomorrow at 2:00 PM',
      address: '123 Main Street, Anytown',
      status: 'confirmed',
      createdAt: new Date()
    };
  }

  /**
   * Demo the complete booking workflow
   */
  async demo() {
    console.log('🚀 BOOKING WITH NOTIFICATIONS DEMO');
    console.log('=' .repeat(50));

    // Demo booking request
    const bookingRequest = {
      customerName: 'Alice Johnson',
      customerPhone: '+1-555-0987',
      customerEmail: 'alice.johnson@email.com',
      serviceType: 'AC Installation',
      appointmentTime: 'Friday at 10:00 AM',
      address: '456 Oak Street, Cooltown'
    };

    // Process booking
    console.log('\n1️⃣ Processing new booking...');
    const bookingResult = await this.processBooking(bookingRequest);
    
    if (bookingResult.success) {
      const bookingId = bookingResult.booking.id;
      
      // Wait for reminder
      await new Promise(resolve => setTimeout(resolve, 2500));
      
      // Complete service
      console.log('\n2️⃣ Completing service...');
      await this.completeService(bookingId, {
        technicianName: 'Mike Rodriguez',
        description: 'New AC unit installed and tested successfully'
      });
      
      // Show analytics
      console.log('\n3️⃣ Notification Analytics:');
      const analytics = this.notifications.getAnalytics();
      console.log(`   📊 Total messages: ${analytics.totalMessages}`);
      console.log(`   📱 SMS sent: ${analytics.smsCount}`);
      console.log(`   📧 Emails sent: ${analytics.emailCount}`);
      console.log(`   ✅ Success rate: ${analytics.successRate}%`);
    }

    console.log('\n🎉 Demo completed!');
  }
}

// Export for use in other modules
module.exports = BookingWithNotifications;

// Run demo if this file is executed directly
if (require.main === module) {
  const demo = new BookingWithNotifications();
  demo.demo().catch(console.error);
}
