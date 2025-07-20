# Notification Service - Production Setup Guide

## Overview

The notification service is now fully integrated with booking flows and transfer routing. This guide shows how to replace mock clients with production services.

## Current Features

✅ **Multi-channel notifications** (SMS + Email)  
✅ **Template-based messaging** with Mustache  
✅ **Booking flow integration** (confirmations, reminders, cancellations)  
✅ **Transfer router integration** (emergency alerts, quote requests)  
✅ **Analytics and tracking** (success rates, message history)  
✅ **Automatic channel selection** (SMS preferred, email fallback)  
✅ **Bulk messaging** with rate limiting  

## Production Setup

### 1. SMS Integration (Twilio)

Install Twilio SDK:
```bash
npm install twilio
```

Replace mock SMS client:
```javascript
const twilio = require('twilio');

const smsClient = {
  client: twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN),
  
  async send({ to, body }) {
    try {
      const message = await this.client.messages.create({
        body,
        from: process.env.TWILIO_PHONE_NUMBER,
        to
      });
      return { messageId: message.sid, status: message.status };
    } catch (error) {
      throw new Error(`SMS failed: ${error.message}`);
    }
  }
};
```

### 2. Email Integration (SendGrid)

Install SendGrid SDK:
```bash
npm install @sendgrid/mail
```

Replace mock email client:
```javascript
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const emailClient = {
  async send({ to, subject, body }) {
    try {
      const msg = {
        to,
        from: process.env.FROM_EMAIL,
        subject,
        text: body,
        html: body.replace(/\n/g, '<br>')
      };
      
      const [response] = await sgMail.send(msg);
      return { messageId: response.headers['x-message-id'], status: 'sent' };
    } catch (error) {
      throw new Error(`Email failed: ${error.message}`);
    }
  }
};
```

### 3. Environment Variables

Add to your `.env` file:
```env
# Twilio Configuration
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1234567890

# SendGrid Configuration
SENDGRID_API_KEY=your_sendgrid_api_key
FROM_EMAIL=noreply@yourcompany.com

# Company Configuration
COMPANY_NAME=Your Company Name
COMPANY_PHONE=555-YOUR-COMPANY
COMPANY_EMAIL=info@yourcompany.com
COMPANY_WEBSITE=www.yourcompany.com
```

### 4. Initialize Production Service

```javascript
const NotificationIntegration = require('./services/notificationIntegration');

const notifications = new NotificationIntegration({
  smsClient: smsClient,      // Your Twilio client
  emailClient: emailClient,  // Your SendGrid client
  companyInfo: {
    name: process.env.COMPANY_NAME,
    phone: process.env.COMPANY_PHONE,
    email: process.env.COMPANY_EMAIL,
    website: process.env.COMPANY_WEBSITE
  }
});
```

## Usage Examples

### Quick Booking Confirmation
```javascript
await notifications.sendBookingConfirmation({
  customerName: 'John Smith',
  customerPhone: '+15555551234',
  customerEmail: 'john@email.com',
  serviceType: 'HVAC Repair',
  appointmentTime: 'Monday 2-4 PM',
  address: '123 Main Street'
});
```

### Emergency Alert
```javascript
await notifications.sendEmergencyAlert(
  { phone: '+15551234567', email: 'tech@company.com' },
  {
    serviceType: 'Emergency Plumbing',
    address: '456 Emergency Lane',
    customerPhone: '+15559876543',
    description: 'Water pipe burst'
  }
);
```

### Service Completion
```javascript
await notifications.sendServiceComplete(
  { phone: '+15555551234', email: 'customer@email.com' },
  {
    customerName: 'Jane Doe',
    serviceType: 'AC Installation',
    technicianName: 'Bob Rodriguez',
    serviceDescription: 'New AC unit installed successfully'
  }
);
```

## Advanced Features

### Bulk Notifications
```javascript
const contacts = [
  { phone: '+15551111111', email: 'customer1@email.com' },
  { phone: '+15552222222', email: 'customer2@email.com' }
];

await notifications.getNotificationService().sendBulkNotifications(
  contacts,
  'welcomeMessage',
  { companyName: 'Your Company' },
  { batchSize: 5, delay: 1000 }
);
```

### Custom Templates
```javascript
notifications.getNotificationService().addTemplate('customAlert', {
  sms: '🔧 {{companyName}}: {{message}}',
  email: 'Custom Alert\n\n{{message}}\n\nBest regards,\n{{companyName}}'
});
```

### Analytics Dashboard
```javascript
const analytics = notifications.getAnalytics();
console.log(\`Success Rate: \${analytics.successRate}%\`);
console.log(\`Total Messages: \${analytics.totalMessages}\`);

const recent = notifications.getRecentMessages(10);
recent.forEach(msg => {
  console.log(\`\${msg.type}: \${msg.to} (\${msg.success ? 'Success' : 'Failed'})\`);
});
```

## Integration with Existing Systems

### Booking Flow Integration
```javascript
const BookingWithNotifications = require('./examples/booking-with-notifications');
const bookingSystem = new BookingWithNotifications({
  smsClient: productionSMSClient,
  emailClient: productionEmailClient
});

// Process booking with automatic notifications
await bookingSystem.processBooking(bookingData);
```

### Transfer Router Integration
```javascript
const TransferWithNotifications = require('./examples/transfer-with-notifications');
const transferSystem = new TransferWithNotifications({
  smsClient: productionSMSClient,
  emailClient: productionEmailClient
});

// Process call with automatic routing and notifications
await transferSystem.processIncomingCall(callData);
```

## Error Handling & Monitoring

### Retry Logic
```javascript
const notificationWithRetry = {
  async send(contact, template, data, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await notifications.sendNotification(contact, template, data);
      } catch (error) {
        if (attempt === maxRetries) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
};
```

### Rate Limiting
```javascript
const rateLimit = require('express-rate-limit');

const notificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use('/api/notifications', notificationLimiter);
```

### Monitoring & Alerts
```javascript
const analytics = notifications.getAnalytics('1h');
if (analytics.successRate < 90) {
  // Send alert to admin
  await notifications.sendCustomMessage(
    { email: 'admin@company.com' },
    {
      recipientName: 'Admin',
      message: \`Notification success rate dropped to \${analytics.successRate}%\`,
      senderName: 'System Monitor'
    }
  );
}
```

## Next Steps

1. **Set up Twilio/SendGrid accounts** and get API credentials
2. **Configure environment variables** for production
3. **Replace mock clients** with production implementations
4. **Set up monitoring** and error alerting
5. **Test with small volume** before full deployment
6. **Implement rate limiting** and retry logic
7. **Set up analytics dashboard** for tracking performance

## Files Created

- `services/notificationService.js` - Core notification service
- `services/notificationIntegration.js` - Simplified integration layer
- `config/messageTemplates.json` - Message templates
- `examples/booking-with-notifications.js` - Booking integration example
- `examples/transfer-with-notifications.js` - Transfer routing example
- `test-notification-integration.js` - Comprehensive demo
- `simple-notification-example.js` - Basic usage examples

## Support

The notification system is fully integrated and production-ready. Replace the mock clients with your preferred SMS/email providers and you're ready to go!
