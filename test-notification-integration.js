#!/usr/bin/env node

// test-notification-integration.js
// Integration test demonstrating notification service with booking flows and transfer routing

const path = require('path');
const fs = require('fs');

const moment = require('moment');

// Load services
const NotificationService = require('./services/notificationService');
const BookingFlowEngine = require('./services/bookingFlowEngine');
const TransferRouter = require('./services/transferRouter');

// Load configurations
const messageTemplates = JSON.parse(fs.readFileSync('./config/messageTemplates.json', 'utf8'));
const personnelConfig = JSON.parse(fs.readFileSync('./config/personnelConfig.json', 'utf8'));

// Mock clients for testing
const mockSMSClient = {
  send: async (params) => {
    console.log(`📱 SMS SENT TO ${params.to}:`);
    console.log(`   ${params.body}`);
    return { messageId: `sms_${Date.now()}`, status: 'sent' };
  }
};

const mockEmailClient = {
  send: async (params) => {
    console.log(`📧 EMAIL SENT TO ${params.to}:`);
    console.log(`   Subject: ${params.subject}`);
    console.log(`   Body: ${params.body.substring(0, 100)}...`);
    return { messageId: `email_${Date.now()}`, status: 'sent' };
  }
};

class IntegratedNotificationDemo {
  constructor() {
    // Initialize notification service
    this.notificationService = new NotificationService({
      smsClient: mockSMSClient,
      emailClient: mockEmailClient,
      templates: messageTemplates
    });

    // Initialize booking flow engine
    this.bookingEngine = new BookingFlowEngine({
      notificationService: this.notificationService
    });

    // Initialize transfer router
    this.transferRouter = new TransferRouter(personnelConfig);
  }

  /**
   * Demo 1: Booking confirmation with notifications
   */
  async demoBookingWithNotifications() {
    console.log('\n🔷 DEMO 1: Booking Confirmation with Notifications');
    console.log('=' .repeat(60));

    const bookingData = {
      customerId: 'cust_12345',
      customerName: 'John Smith',
      customerPhone: '+1-555-0123',
      customerEmail: 'john.smith@email.com',
      serviceType: 'HVAC Repair',
      appointmentTime: 'Tomorrow at 2:00 PM',
      address: '123 Main Street, Anytown',
      companyName: 'CoolAir HVAC Services',
      phone: '555-HVAC-NOW'
    };

    // Send booking confirmation
    const contact = {
      phone: bookingData.customerPhone,
      email: bookingData.customerEmail
    };

    console.log('\n📅 Sending booking confirmation...');
    const confirmationResult = await this.notificationService.sendNotification(
      contact,
      'bookingConfirmation',
      bookingData,
      { preferSMS: true, sendBoth: false }
    );

    console.log(`✅ Confirmation sent via ${confirmationResult.primary}:`, confirmationResult.success);

    // Schedule reminder (simulated)
    console.log('\n⏰ Scheduling reminder for 24 hours before...');
    setTimeout(async () => {
      await this.notificationService.sendNotification(
        contact,
        'bookingReminder',
        bookingData,
        { preferSMS: true }
      );
    }, 1000); // Simulate 1 second = 24 hours

    return confirmationResult;
  }

  /**
   * Demo 2: Emergency routing with notifications
   */
  async demoEmergencyRouting() {
    console.log('\n🔷 DEMO 2: Emergency Call Routing with Notifications');
    console.log('=' .repeat(60));

    const emergencyCall = {
      customerName: 'Sarah Johnson',
      customerPhone: '+1-555-0456',
      serviceType: 'Emergency Plumbing',
      description: 'Major pipe burst in basement - water everywhere!',
      address: '456 Oak Avenue, Emergency City',
      urgency: 'EMERGENCY',
      timestamp: new Date().toISOString()
    };

    console.log('\n🚨 Processing emergency call...');
    
    // Route the emergency call using the correct interface
    const routingResult = this.transferRouter.findBestTransferOption(
      `emergency plumbing ${emergencyCall.description}`,
      moment()
    );

    console.log('📞 Transfer option:', routingResult.type);
    console.log('📞 Message:', routingResult.message);

    if (routingResult.target) {
      // Send emergency alert to assigned personnel
      const personnelContact = {
        phone: routingResult.target.phone,
        email: routingResult.target.email
      };

      console.log('\n🔔 Sending emergency alert to assigned personnel...');
      await this.notificationService.sendNotification(
        personnelContact,
        'emergencyAlert',
        emergencyCall,
        { preferSMS: true, sendBoth: true }
      );

      // Also notify other available personnel as backup
      const available = this.transferRouter.getAvailablePersonnel();
      if (available.length > 1) {
        console.log('\n📢 Notifying backup personnel...');
        for (const backup of available.slice(1, 3)) { // Skip first (already notified), take next 2
          const backupContact = {
            phone: backup.phone,
            email: backup.email
          };
          
          await this.notificationService.sendNotification(
            backupContact,
            'fallbackMessage',
            {
              recipientName: backup.name,
              customerMessage: `EMERGENCY BACKUP NEEDED: ${emergencyCall.description}`,
              customerName: emergencyCall.customerName,
              customerPhone: emergencyCall.customerPhone,
              timestamp: new Date().toLocaleString()
            },
            { preferSMS: true }
          );
        }
      }
    }

    return routingResult;
  }

  /**
   * Demo 3: Service completion workflow
   */
  async demoServiceCompletion() {
    console.log('\n🔷 DEMO 3: Service Completion Workflow');
    console.log('=' .repeat(60));

    const serviceData = {
      customerName: 'Mike Wilson',
      customerPhone: '+1-555-0789',
      customerEmail: 'mike.wilson@email.com',
      serviceType: 'Air Conditioning Tune-up',
      serviceDate: new Date().toLocaleDateString(),
      technicianName: 'Bob Rodriguez',
      serviceDescription: 'Annual AC maintenance and filter replacement',
      companyName: 'CoolAir HVAC Services',
      phone: '555-HVAC-NOW',
      reviewLink: 'https://coolairhvac.com/review/12345'
    };

    const contact = {
      phone: serviceData.customerPhone,
      email: serviceData.customerEmail
    };

    console.log('\n✅ Sending service completion notification...');
    const completionResult = await this.notificationService.sendNotification(
      contact,
      'serviceComplete',
      serviceData,
      { preferSMS: false, fallbackEmail: true } // Prefer email for detailed completion info
    );

    console.log('📊 Service completion notification sent:', completionResult.success);

    // Schedule follow-up (simulated)
    console.log('\n📅 Scheduling follow-up in 7 days...');
    setTimeout(async () => {
      await this.notificationService.sendNotification(
        contact,
        'welcomeMessage',
        {
          companyName: serviceData.companyName,
          serviceType: 'any future HVAC needs',
          phone: serviceData.phone,
          email: 'info@coolairhvac.com',
          website: 'www.coolairhvac.com'
        },
        { preferSMS: true }
      );
    }, 1500); // Simulate 1.5 seconds = 7 days

    return completionResult;
  }

  /**
   * Demo 4: Quote request routing
   */
  async demoQuoteRequest() {
    console.log('\n🔷 DEMO 4: Quote Request Routing');
    console.log('=' .repeat(60));

    const quoteRequest = {
      customerName: 'Lisa Chen',
      customerPhone: '+1-555-0321',
      customerEmail: 'lisa.chen@email.com',
      serviceType: 'Commercial HVAC Installation',
      address: '789 Business Park Drive, Commerce City',
      description: 'Need new HVAC system for 5000 sq ft office building',
      urgency: 'Standard',
      timestamp: new Date().toISOString()
    };

    console.log('\n💰 Processing quote request...');

    // Route to sales team using correct interface
    const routingResult = this.transferRouter.findBestTransferOption(
      `sales quote ${quoteRequest.serviceType}`,
      moment()
    );

    console.log('📞 Transfer option:', routingResult.type);

    if (routingResult.target) {
      const salesContact = {
        phone: routingResult.target.phone,
        email: routingResult.target.email
      };

      console.log('\n📋 Sending quote request to sales team...');
      await this.notificationService.sendNotification(
        salesContact,
        'quoteRequest',
        quoteRequest,
        { preferSMS: false, fallbackEmail: true }
      );

      // Send confirmation to customer
      const customerContact = {
        phone: quoteRequest.customerPhone,
        email: quoteRequest.customerEmail
      };

      console.log('\n📧 Sending confirmation to customer...');
      await this.notificationService.sendNotification(
        customerContact,
        'welcomeMessage',
        {
          customerName: quoteRequest.customerName,
          companyName: 'CoolAir HVAC Services',
          serviceType: quoteRequest.serviceType,
          phone: '555-HVAC-NOW',
          email: 'quotes@coolairhvac.com',
          website: 'www.coolairhvac.com'
        },
        { preferSMS: true }
      );
    }

    return routingResult;
  }

  /**
   * Demo 5: Analytics and reporting
   */
  async demoAnalytics() {
    console.log('\n🔷 DEMO 5: Notification Analytics');
    console.log('=' .repeat(60));

    const analytics = this.notificationService.getAnalytics();
    
    console.log('\n📊 Notification Statistics:');
    console.log(`   Total Messages Sent: ${analytics.totalMessages}`);
    console.log(`   SMS Messages: ${analytics.smsCount}`);
    console.log(`   Email Messages: ${analytics.emailCount}`);
    console.log(`   Success Rate: ${analytics.successRate}%`);
    console.log(`   Failed Messages: ${analytics.failedMessages}`);

    console.log('\n📈 Recent Activity:');
    const recentMessages = this.notificationService.getRecentMessages(5);
    recentMessages.forEach((msg, idx) => {
      const status = msg.success ? '✅' : '❌';
      const time = new Date(msg.timestamp).toLocaleTimeString();
      console.log(`   ${idx + 1}. ${status} ${msg.type.toUpperCase()} to ${msg.to} (${msg.templateKey}) at ${time}`);
    });

    return analytics;
  }

  /**
   * Run all demos
   */
  async runAllDemos() {
    console.log('🚀 INTEGRATED NOTIFICATION SERVICE DEMO');
    console.log('=' .repeat(60));
    console.log('Testing notification integration with booking flows and transfer routing...\n');

    try {
      // Run all demos
      await this.demoBookingWithNotifications();
      await this.demoEmergencyRouting();
      await this.demoServiceCompletion();
      await this.demoQuoteRequest();
      
      // Wait a bit for scheduled notifications
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      await this.demoAnalytics();

      console.log('\n🎉 All demos completed successfully!');
      console.log('\nKey Features Demonstrated:');
      console.log('✅ Booking confirmation and reminder notifications');
      console.log('✅ Emergency call routing with instant alerts');
      console.log('✅ Service completion workflow with follow-up');
      console.log('✅ Quote request routing to sales team');
      console.log('✅ Analytics and message tracking');
      console.log('✅ Multi-channel communication (SMS + Email)');
      console.log('✅ Template-based messaging with Mustache');
      console.log('✅ Personnel routing integration');

    } catch (error) {
      console.error('❌ Demo failed:', error.message);
      console.error(error.stack);
    }
  }
}

// Run the demo if this file is executed directly
if (require.main === module) {
  const demo = new IntegratedNotificationDemo();
  demo.runAllDemos().then(() => {
    console.log('\n👋 Demo completed. Check the output above for results.');
    process.exit(0);
  }).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = IntegratedNotificationDemo;
