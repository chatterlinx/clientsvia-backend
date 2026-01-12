# Email Client Usage Guide

## 🎯 Quick Start

```javascript
// Import the email client anywhere in your code
const emailClient = require('../clients/emailClient');

// Send admin alert (errors, debugging, system notifications)
await emailClient.sendAdminAlert('Error Title', 'Error details...');

// Send customer email (future - appointments, invoices)
const result = await emailClient.sendCustomerEmail({
  to: 'customer@example.com',
  companyId: '507f1f77bcf86cd799439011',
  templateId: 'appointment_confirmation',
  data: { appointmentTime: '2:00 PM' }
});

// CRITICAL: Always notify admin if customer email fails
if (!result.success) {
  await emailClient.sendAdminAlert(
    '🚨 Customer Email Failed',
    `Failed to send appointment email\nError: ${result.error}`
  );
}
```

---

## 📧 1. Admin/Developer Notifications (Gmail)

### When to Use
- ✅ System errors and exceptions
- ✅ Database connection failures
- ✅ Redis cache issues
- ✅ Twilio webhook failures
- ✅ SMS test confirmations
- ✅ Health check alerts
- ✅ Background job failures
- ✅ Security alerts

### Method: `sendAdminAlert(subject, body, html?)`

```javascript
// Example 1: Database error
try {
  await Company.findById(companyId);
} catch (error) {
  await emailClient.sendAdminAlert(
    '🚨 Database Error',
    `Failed to load company ${companyId}\n\nError: ${error.message}\nStack: ${error.stack}`
  );
}

// Example 2: SMS test confirmation (already implemented)
await emailClient.sendAdminAlert(
  '✅ SMS Test Received',
  `Test SMS from ${phoneNumber}\nTime: ${timestamp}`
);

// Example 3: Health check failure
await emailClient.sendAdminAlert(
  '⚠️ Health Check Failed',
  `Component: Redis Cache\nStatus: DOWN\nError: Connection timeout after 5 seconds`
);

// Example 4: Custom HTML
await emailClient.sendAdminAlert(
  '🎉 New Company Registered',
  'A new company has signed up!',
  `<h2>New Company Registration</h2>
   <p><strong>Name:</strong> Royal Plumbing</p>
   <p><strong>Email:</strong> owner@royalplumbing.com</p>`
);
```

### Method: `sendToAdmins(options)`

```javascript
// Batch send to all admin contacts
await emailClient.sendToAdmins({
  subject: 'Platform Maintenance',
  body: 'The platform will be offline for maintenance tonight 2-4 AM ET',
  html: '<h2>Maintenance Notice</h2><p>2-4 AM ET tonight</p>'
});
```

---

## 💼 2. Customer/Client Emails (SendGrid - Future)

### When to Use
- ✅ Appointment confirmations
- ✅ Appointment reminders (24hr, 1hr before)
- ✅ Invoice delivery
- ✅ Payment receipts
- ✅ Service completion notifications
- ✅ Marketing emails (opt-in only)

### Method: `sendCustomerEmail(options)` (Not Yet Implemented)

```javascript
// Example 1: Appointment confirmation
const result = await emailClient.sendCustomerEmail({
  to: 'customer@example.com',
  companyId: '507f1f77bcf86cd799439011',
  templateId: 'appointment_confirmation',
  data: {
    companyName: 'Royal Plumbing',
    appointmentTime: '2:00 PM Wednesday, Oct 23',
    technicianName: 'John Smith',
    serviceType: 'Water Heater Repair',
    confirmationLink: 'https://app.clientsvia.ai/confirm/abc123'
  }
});

// CRITICAL: Always check result and notify admin if it fails
if (!result.success) {
  await emailClient.sendAdminAlert(
    '🚨 Appointment Confirmation Email Failed',
    `Customer: customer@example.com\nCompany: Royal Plumbing\nError: ${result.error}\n\n⚠️ Customer may miss their appointment!`
  );
  
  // Maybe send SMS as fallback?
  // await smsClient.send({ to: customer.phone, body: 'Your appointment is confirmed...' });
}

// Example 2: Invoice delivery
const invoiceResult = await emailClient.sendCustomerEmail({
  to: 'customer@example.com',
  companyId: company._id,
  templateId: 'invoice',
  data: {
    invoiceNumber: 'INV-2025-001',
    amount: '$350.00',
    dueDate: 'November 1, 2025',
    paymentLink: 'https://pay.clientsvia.ai/inv-001'
  }
});

if (!invoiceResult.success) {
  await emailClient.sendAdminAlert(
    '🚨 Invoice Email Failed',
    `Customer won't receive invoice ${data.invoiceNumber}\nError: ${invoiceResult.error}`
  );
}
```

---

## 🔥 Real-World Usage Examples

### In Error Handlers (Middleware)

```javascript
// middleware/errorHandler.js
const emailClient = require('../clients/emailClient');

module.exports = (err, req, res, next) => {
  console.error('❌ [ERROR]', err);
  
  // Notify admin of 500 errors
  if (err.status === 500 || !err.status) {
    emailClient.sendAdminAlert(
      '🚨 500 Error in Production',
      `Path: ${req.path}\nMethod: ${req.method}\nError: ${err.message}\nStack: ${err.stack}\nUser: ${req.user?.email || 'Anonymous'}`
    );
  }
  
  res.status(err.status || 500).json({
    success: false,
    error: err.message
  });
};
```

### In Cron Jobs (Background Tasks)

```javascript
// services/autoPurgeCron.js
const emailClient = require('../clients/emailClient');
const cron = require('node-cron');

cron.schedule('0 2 * * *', async () => {
  console.log('[AUTO-PURGE] Starting daily cleanup...');
  
  try {
    const result = await DataCenterPurgeService.autoDeleteExpired();
    
    // Notify admin of results
    await emailClient.sendAdminAlert(
      '🗑️ Daily Auto-Purge Complete',
      `Deleted: ${result.deletedCount} companies\nTime: ${result.duration}ms`
    );
    
  } catch (error) {
    // Critical: Notify admin if purge fails
    await emailClient.sendAdminAlert(
      '🚨 Auto-Purge Failed',
      `Daily cleanup failed!\nError: ${error.message}\n\n⚠️ Database may fill up if not fixed!`
    );
  }
});
```

### In API Routes (Customer Actions)

```javascript
// routes/company/appointments.js
const emailClient = require('../../clients/emailClient');

router.post('/api/companies/:companyId/appointments', async (req, res) => {
  try {
    const appointment = await Appointment.create(req.body);
    
    // Send confirmation email to customer
    const emailResult = await emailClient.sendCustomerEmail({
      to: req.body.customerEmail,
      companyId: req.params.companyId,
      templateId: 'appointment_confirmation',
      data: {
        appointmentTime: appointment.scheduledAt,
        technicianName: appointment.technician,
        serviceType: appointment.serviceType
      }
    });
    
    // If customer email fails, notify admin immediately
    if (!emailResult.success) {
      await emailClient.sendAdminAlert(
        '🚨 Appointment Confirmation Failed',
        `Customer: ${req.body.customerEmail}\nCompany: ${req.params.companyId}\nAppointment ID: ${appointment._id}\nError: ${emailResult.error}`
      );
    }
    
    res.json({ success: true, appointment });
    
  } catch (error) {
    // Notify admin of API errors
    await emailClient.sendAdminAlert(
      '🚨 Appointment Creation Failed',
      `Company: ${req.params.companyId}\nError: ${error.message}\nStack: ${error.stack}`
    );
    res.status(500).json({ success: false, error: error.message });
  }
});
```

### In Webhook Handlers (Twilio)

```javascript
// routes/v2twilio.js (already implemented)
const emailClient = require('../clients/emailClient');

router.post('/sms', async (req, res) => {
  const { From: from, Body: message } = req.body;
  
  // Test command - notify admin
  if (message.match(/^(TEST|PING)$/i)) {
    await emailClient.sendAdminAlert(
      '✅ SMS Test Received',
      `Test SMS from ${from}\nMessage: "${message}"\nTime: ${new Date().toLocaleString()}`
    );
  }
  
  // ... rest of SMS handling
});
```

---

## 🎨 HTML Email Templates

### Simple Alert
```javascript
await emailClient.sendAdminAlert(
  'Alert Title',
  'Plain text body',
  `
  <div style="font-family: Arial, sans-serif; padding: 20px;">
    <h2 style="color: #d32f2f;">🚨 Alert Title</h2>
    <p>Something went wrong!</p>
    <div style="background: #f5f5f5; padding: 10px; border-radius: 4px;">
      <code>Error details here...</code>
    </div>
  </div>
  `
);
```

### Rich Notification
```javascript
await emailClient.sendAdminAlert(
  'New Company Signup',
  'A new company registered',
  `
  <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center;">
      <h1 style="color: white; margin: 0;">🎉 New Company!</h1>
    </div>
    <div style="padding: 30px; background: white;">
      <h2>Company Details</h2>
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Name:</strong></td>
          <td style="padding: 10px; border-bottom: 1px solid #eee;">Royal Plumbing</td>
        </tr>
        <tr>
          <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Email:</strong></td>
          <td style="padding: 10px; border-bottom: 1px solid #eee;">owner@royalplumbing.com</td>
        </tr>
        <tr>
          <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Phone:</strong></td>
          <td style="padding: 10px; border-bottom: 1px solid #eee;">+1 (555) 123-4567</td>
        </tr>
      </table>
      <div style="text-align: center; margin-top: 30px;">
        <a href="https://app.clientsvia.ai/admin" style="background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
          View in Admin Dashboard
        </a>
      </div>
    </div>
  </div>
  `
);
```

---

## ⚙️ Configuration

### Environment Variables (Render)
```env
# Gmail (Admin Notifications)
GMAIL_USER=clientsvia@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx

# SendGrid (Customer Emails - Future)
# SENDGRID_API_KEY=SG.xxxx
# SENDGRID_FROM_EMAIL=noreply@clientsvia.ai
# SENDGRID_FROM_NAME=ClientsVia
```

### Admin Contacts Configuration
Admin emails are sent to all contacts with `receiveEmail: true` in `AdminSettings.notificationCenter.adminContacts`:

```javascript
// Set via Notification Center UI or directly in DB
{
  notificationCenter: {
    adminContacts: [
      {
        name: 'Marc',
        phone: '+12395652202',
        email: 'clientsvia@gmail.com',
        receiveSMS: true,
        receiveEmail: true,  // ← Must be true to receive admin alerts
        receiveCalls: true
      }
    ]
  }
}
```

---

## 📊 Statistics & Monitoring

```javascript
// Get email stats
const stats = emailClient.getStats();
console.log(stats);
// {
//   adminEmailsSent: 15,
//   adminEmailsFailed: 1,
//   customerEmailsSent: 0,
//   customerEmailsFailed: 0,
//   adminEmailSystem: 'Gmail (Active)',
//   customerEmailSystem: 'SendGrid (Not Yet Implemented)',
//   testMode: false
// }
```

---

## 🚨 Critical Pattern: Always Notify Admin on Customer Email Failure

**NEVER let a customer email failure go silent!**

```javascript
// ✅ CORRECT
const result = await emailClient.sendCustomerEmail({ ... });
if (!result.success) {
  await emailClient.sendAdminAlert(
    '🚨 Customer Email Failed',
    `Customer won't receive important notification\nError: ${result.error}`
  );
}

// ❌ WRONG - Silent failure
const result = await emailClient.sendCustomerEmail({ ... });
// Whoops, forgot to check result.success - customer never gets their email!
```

---

## 🔗 Related Files

- **Implementation**: `clients/emailClient.js`
- **Architecture**: `docs/EMAIL-ARCHITECTURE.md`
- **Usage Example**: `routes/v2twilio.js` (SMS test notifications)
- **Admin Settings**: `models/AdminSettings.js` (admin contacts)

---

**Last Updated**: October 21, 2025  
**Owner**: Platform Team

