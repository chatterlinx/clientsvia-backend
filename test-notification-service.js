// test-notification-service.js
// Test script for the Notification Service

const NotificationService = require('./services/notificationService');
const templates = require('./config/messageTemplates.json');

// Mock SMS and Email clients
const mockSMS = {
  send: ({ to, body }) => {
    console.log(`📱 SMS to ${to}:`);
    console.log(`   ${body}`);
    return Promise.resolve({ messageId: 'sms_' + Date.now(), status: 'sent' });
  }
};

const mockEmail = {
  send: ({ to, subject, body }) => {
    console.log(`📧 Email to ${to}:`);
    console.log(`   Subject: ${subject}`);
    console.log(`   Body: ${body.substring(0, 100)}${body.length > 100 ? '...' : ''}`);
    return Promise.resolve({ messageId: 'email_' + Date.now(), status: 'sent' });
  }
};

async function testNotificationService() {
  console.log('🚀 Testing Notification Service...\n');

  // Initialize notification service
  const notify = new NotificationService({
    smsClient: mockSMS,
    emailClient: mockEmail,
    templates
  });

  console.log('📋 Available Templates:');
  notify.getAvailableTemplates().forEach(template => {
    console.log(`  - ${template}`);
  });
  console.log('');

  // Test data
  const testData = {
    companyName: 'Penguin Air',
    customerName: 'John Smith',
    serviceType: 'HVAC Repair',
    appointmentTime: 'Monday, July 21st at 2:00 PM',
    address: '123 Main St, City, State 12345',
    phone: '(555) 123-4567',
    customerPhone: '+15555551234',
    customerEmail: 'john.smith@example.com'
  };

  console.log('📅 Testing Booking Confirmation...');
  
  // Test SMS
  const smsResult = await notify.sendSMS(
    '+15555551234',
    'bookingConfirmation',
    testData
  );
  console.log(`SMS Result: ${smsResult.success ? '✅ Success' : '❌ Failed'}`);
  console.log('');

  // Test Email
  const emailResult = await notify.sendEmail(
    'john.smith@example.com',
    'Appointment Confirmed',
    'bookingConfirmation',
    testData
  );
  console.log(`Email Result: ${emailResult.success ? '✅ Success' : '❌ Failed'}`);
  console.log('');

  // Test smart notification (chooses best channel)
  console.log('🎯 Testing Smart Notification...');
  const contact = {
    name: 'John Smith',
    phone: '+15555551234',
    email: 'john.smith@example.com'
  };

  const smartResult = await notify.sendNotification(
    contact,
    'bookingReminder',
    testData,
    { preferSMS: true }
  );
  console.log(`Smart Notification: ${smartResult.success ? '✅ Success' : '❌ Failed'} via ${smartResult.primary}`);
  console.log('');

  // Test emergency alert
  console.log('🚨 Testing Emergency Alert...');
  const emergencyData = {
    ...testData,
    serviceType: 'Emergency Plumbing',
    description: 'Burst pipe flooding basement',
    timestamp: new Date().toLocaleString()
  };

  await notify.sendSMS('+15556667777', 'emergencyAlert', emergencyData);
  console.log('');

  // Test fallback message (for transfer router)
  console.log('📩 Testing Fallback Message...');
  const fallbackData = {
    recipientName: 'Steven Ferris',
    customerName: 'Jane Doe',
    customerPhone: '+15555559999',
    customerMessage: 'I need help with my heating system',
    timestamp: new Date().toLocaleString()
  };

  await notify.sendSMS('+15556667777', 'fallbackMessage', fallbackData);
  console.log('');

  // Test bulk notifications
  console.log('📢 Testing Bulk Notifications...');
  const contacts = [
    { name: 'John Smith', phone: '+15555551111', email: 'john@example.com' },
    { name: 'Jane Doe', phone: '+15555552222', email: 'jane@example.com' },
    { name: 'Bob Johnson', phone: '+15555553333', email: 'bob@example.com' }
  ];

  const bulkResult = await notify.sendBulkNotifications(
    contacts,
    'welcomeMessage',
    {
      companyName: 'Penguin Air',
      serviceType: 'HVAC',
      phone: '(555) 123-4567',
      email: 'info@penguinair.com',
      website: 'www.penguinair.com'
    },
    { batchSize: 2, delay: 50 }
  );

  console.log(`Bulk Notification Results:`);
  console.log(`  Total: ${bulkResult.total}`);
  console.log(`  Successful: ${bulkResult.successful}`);
  console.log(`  Failed: ${bulkResult.failed}`);
  console.log('');

  // Test statistics
  console.log('📊 Testing Notification Statistics...');
  const stats = notify.getStats('24h');
  console.log(`Statistics (last 24h):`);
  console.log(`  Total Messages: ${stats.total}`);
  console.log(`  Successful: ${stats.successful}`);
  console.log(`  Failed: ${stats.failed}`);
  console.log(`  SMS: ${stats.sms}`);
  console.log(`  Email: ${stats.email}`);
  console.log(`  Success Rate: ${stats.successRate}%`);
  console.log('');

  // Test template formatting
  console.log('🎨 Testing Template Formatting...');
  const formattedMessage = notify.formatMessage('paymentReminder', {
    customerName: 'John Smith',
    amount: '250.00',
    invoiceNumber: 'INV-001',
    dueDate: 'July 25, 2025',
    serviceDescription: 'HVAC Maintenance',
    paymentLink: 'https://pay.penguinair.com/inv001',
    phone: '(555) 123-4567',
    companyName: 'Penguin Air'
  }, 'email');

  console.log('Payment Reminder Email:');
  console.log(formattedMessage);
  console.log('');

  console.log('🎯 Notification Service test completed!');
}

// Test phone number normalization
function testPhoneNormalization() {
  console.log('\n📞 Testing Phone Number Normalization:\n');
  
  const notify = new NotificationService({
    smsClient: mockSMS,
    emailClient: mockEmail,
    templates
  });

  const testNumbers = [
    '5551234567',
    '(555) 123-4567',
    '+1 555 123 4567',
    '555-123-4567',
    '+15551234567',
    '1-555-123-4567'
  ];

  testNumbers.forEach(number => {
    const normalized = notify.normalizePhoneNumber(number);
    console.log(`${number.padEnd(15)} → ${normalized}`);
  });
}

// Test error handling
async function testErrorHandling() {
  console.log('\n❌ Testing Error Handling:\n');
  
  const errorSMS = {
    send: () => Promise.reject(new Error('SMS service unavailable'))
  };

  const errorEmail = {
    send: () => Promise.reject(new Error('Email service unavailable'))
  };

  const notify = new NotificationService({
    smsClient: errorSMS,
    emailClient: errorEmail,
    templates
  });

  // Test failed SMS
  const smsResult = await notify.sendSMS('+15555551234', 'bookingConfirmation', {});
  console.log(`Failed SMS: ${smsResult.success ? 'Unexpected Success' : '✅ Properly handled'}`);

  // Test invalid template
  const invalidResult = await notify.sendSMS('+15555551234', 'nonexistentTemplate', {});
  console.log(`Invalid Template: ${invalidResult.success ? 'Unexpected Success' : '✅ Properly handled'}`);

  // Test missing data
  const missingDataResult = await notify.sendSMS('', 'bookingConfirmation', {});
  console.log(`Missing Data: ${missingDataResult.success ? 'Unexpected Success' : '✅ Properly handled'}`);
}

// Run tests
if (require.main === module) {
  Promise.resolve()
    .then(() => testNotificationService())
    .then(() => testPhoneNormalization())
    .then(() => testErrorHandling())
    .catch(console.error);
}

module.exports = { 
  testNotificationService, 
  testPhoneNormalization, 
  testErrorHandling 
};
