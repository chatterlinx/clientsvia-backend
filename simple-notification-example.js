#!/usr/bin/env node

// simple-notification-example.js
// Simple example using the notification service as provided in the user's code snippet

const path = require('path');
const fs = require('fs');

// Load templates and notification service
const templates = JSON.parse(fs.readFileSync('./config/messageTemplates.json', 'utf8'));
const NotificationService = require('./services/notificationService');

// Replace with actual services like Twilio/SendGrid later
const mockSMS = { 
  send: ({ to, body }) => {
    console.log(`📱 SMS to ${to}:`);
    console.log(`   ${body}`);
    return Promise.resolve({ messageId: `sms_${Date.now()}`, status: 'sent' });
  }
};

const mockEmail = { 
  send: ({ to, subject, body }) => {
    console.log(`📧 Email to ${to}:`);
    console.log(`   Subject: ${subject}`);
    console.log(`   Body: ${body.substring(0, 80)}...`);
    return Promise.resolve({ messageId: `email_${Date.now()}`, status: 'sent' });
  }
};

const notify = new NotificationService({
  smsClient: mockSMS,
  emailClient: mockEmail,
  templates
});

// Example usage function
async function runExamples() {
  console.log('🚀 SIMPLE NOTIFICATION EXAMPLES');
  console.log('=' .repeat(50));

  console.log('\n📱 Example 1: SMS Booking Confirmation');
  console.log('-' .repeat(40));
  await notify.sendSMS('+15555551234', 'bookingConfirmation', {
    appointmentTime: 'Monday 2–4PM',
    companyName: 'Penguin Air',
    serviceType: 'HVAC Service',
    address: '123 Customer Street',
    phone: '555-PENGUIN'
  });

  console.log('\n📧 Example 2: Email Booking Confirmation');
  console.log('-' .repeat(40));
  await notify.sendEmail(
    'user@example.com', 
    'Booking Confirmed', 
    'bookingConfirmation', 
    {
      customerName: 'John',
      companyName: 'Penguin Air',
      appointmentTime: 'Monday 2–4PM',
      serviceType: 'HVAC Service',
      address: '123 Customer Street',
      phone: '555-PENGUIN'
    }
  );

  console.log('\n📞 Example 3: Emergency Alert');
  console.log('-' .repeat(40));
  await notify.sendSMS('+15551234567', 'emergencyAlert', {
    serviceType: 'Emergency Plumbing',
    address: '456 Emergency Lane',
    customerPhone: '+15559999999'
  });

  console.log('\n💰 Example 4: Quote Request');
  console.log('-' .repeat(40));
  await notify.sendEmail(
    'sales@company.com',
    'New Quote Request',
    'quoteRequest',
    {
      customerName: 'Jane Smith',
      customerPhone: '+15551111111',
      customerEmail: 'jane@email.com',
      serviceType: 'AC Installation',
      address: '789 Cool Street',
      description: 'Need new central air system',
      urgency: 'Standard'
    }
  );

  console.log('\n🎉 Example 5: Service Complete');
  console.log('-' .repeat(40));
  await notify.sendEmail(
    'customer@email.com',
    'Service Complete',
    'serviceComplete',
    {
      customerName: 'Bob Wilson',
      serviceType: 'Furnace Repair',
      serviceDate: new Date().toLocaleDateString(),
      technicianName: 'Mike the Tech',
      serviceDescription: 'Replaced heating element and cleaned system',
      companyName: 'Penguin Air',
      phone: '555-PENGUIN',
      reviewLink: 'https://penguinair.com/review'
    }
  );

  console.log('\n🔔 Example 6: Using sendNotification (auto-channel selection)');
  console.log('-' .repeat(60));
  await notify.sendNotification(
    {
      phone: '+15555551234',
      email: 'customer@email.com'
    },
    'welcomeMessage',
    {
      companyName: 'Penguin Air',
      serviceType: 'HVAC services',
      phone: '555-PENGUIN',
      email: 'info@penguinair.com',
      website: 'www.penguinair.com'
    },
    { preferSMS: true }
  );

  console.log('\n📊 Analytics Summary');
  console.log('-' .repeat(30));
  const analytics = notify.getAnalytics();
  console.log(`Total messages sent: ${analytics.totalMessages}`);
  console.log(`SMS messages: ${analytics.smsCount}`);
  console.log(`Email messages: ${analytics.emailCount}`);
  console.log(`Success rate: ${analytics.successRate}%`);

  console.log('\n✨ Ready for Production!');
  console.log('To use with real services, replace mockSMS and mockEmail with:');
  console.log('• Twilio client for SMS');
  console.log('• SendGrid, AWS SES, or similar for email');
  console.log('• Add proper error handling and retry logic');
  console.log('• Set up rate limiting and queue management');
}

// Run examples
if (require.main === module) {
  runExamples().catch(console.error);
}

module.exports = { notify, mockSMS, mockEmail };
