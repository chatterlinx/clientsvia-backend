// routes/notifications.js
// API routes for notification management

const express = require('express');
const router = express.Router();
const NotificationService = require('../services/notificationService');
const templates = require('../config/messageTemplates.json');

// Mock clients for development (replace with Twilio/SendGrid in production)
const mockSMS = {
  send: ({ to, body }) => {
    console.log(`[SMS] To: ${to}, Message: ${body.substring(0, 50)}...`);
    return Promise.resolve({ 
      messageId: 'sms_' + Date.now(), 
      status: 'sent',
      to,
      timestamp: new Date().toISOString()
    });
  }
};

const mockEmail = {
  send: ({ to, subject, body }) => {
    console.log(`[Email] To: ${to}, Subject: ${subject}`);
    return Promise.resolve({ 
      messageId: 'email_' + Date.now(), 
      status: 'sent',
      to,
      subject,
      timestamp: new Date().toISOString()
    });
  }
};

// Initialize notification service
const notificationService = new NotificationService({
  smsClient: mockSMS,
  emailClient: mockEmail,
  templates
});

// Send SMS notification
router.post('/sms', async (req, res) => {
  try {
    const { to, templateKey, data, options } = req.body;
    
    if (!to || !templateKey) {
      return res.status(400).json({
        success: false,
        error: 'Phone number and template key are required'
      });
    }
    
    const result = await notificationService.sendSMS(to, templateKey, data, options);
    
    res.json({
      success: result.success,
      ...result
    });
  } catch (error) {
    console.error('[Notification API] SMS error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send SMS notification'
    });
  }
});

// Send email notification
router.post('/email', async (req, res) => {
  try {
    const { to, subject, templateKey, data, options } = req.body;
    
    if (!to || !templateKey) {
      return res.status(400).json({
        success: false,
        error: 'Email address and template key are required'
      });
    }
    
    const emailSubject = subject || notificationService.generateSubject(templateKey, data);
    const result = await notificationService.sendEmail(to, emailSubject, templateKey, data, options);
    
    res.json({
      success: result.success,
      ...result
    });
  } catch (error) {
    console.error('[Notification API] Email error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send email notification'
    });
  }
});

// Send smart notification (chooses best channel)
router.post('/send', async (req, res) => {
  try {
    const { contact, templateKey, data, options } = req.body;
    
    if (!contact || !templateKey) {
      return res.status(400).json({
        success: false,
        error: 'Contact information and template key are required'
      });
    }
    
    const result = await notificationService.sendNotification(contact, templateKey, data, options);
    
    res.json({
      success: result.success,
      ...result
    });
  } catch (error) {
    console.error('[Notification API] Send error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send notification'
    });
  }
});

// Send bulk notifications
router.post('/bulk', async (req, res) => {
  try {
    const { contacts, templateKey, data, options } = req.body;
    
    if (!Array.isArray(contacts) || !templateKey) {
      return res.status(400).json({
        success: false,
        error: 'Contacts array and template key are required'
      });
    }
    
    const result = await notificationService.sendBulkNotifications(contacts, templateKey, data, options);
    
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('[Notification API] Bulk send error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send bulk notifications'
    });
  }
});

// Preview message without sending
router.post('/preview', (req, res) => {
  try {
    const { templateKey, data, channel } = req.body;
    
    if (!templateKey) {
      return res.status(400).json({
        success: false,
        error: 'Template key is required'
      });
    }
    
    const smsMessage = notificationService.formatMessage(templateKey, data, 'sms');
    const emailMessage = notificationService.formatMessage(templateKey, data, 'email');
    const subject = notificationService.generateSubject(templateKey, data);
    
    const preview = {
      templateKey,
      data,
      sms: smsMessage,
      email: {
        subject,
        body: emailMessage
      }
    };
    
    if (channel) {
      // Return only specific channel
      if (channel === 'sms') {
        preview.message = smsMessage;
      } else if (channel === 'email') {
        preview.message = emailMessage;
        preview.subject = subject;
      }
    }
    
    res.json({
      success: true,
      preview
    });
  } catch (error) {
    console.error('[Notification API] Preview error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate preview'
    });
  }
});

// Get notification statistics
router.get('/stats', (req, res) => {
  try {
    const { timeframe = '24h' } = req.query;
    
    const stats = notificationService.getStats(timeframe);
    
    res.json({
      success: true,
      timeframe,
      stats
    });
  } catch (error) {
    console.error('[Notification API] Stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get statistics'
    });
  }
});

// Get available templates
router.get('/templates', (req, res) => {
  try {
    const templates = notificationService.getAvailableTemplates();
    
    res.json({
      success: true,
      templates,
      count: templates.length
    });
  } catch (error) {
    console.error('[Notification API] Templates error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get templates'
    });
  }
});

// Get specific template
router.get('/templates/:templateKey', (req, res) => {
  try {
    const { templateKey } = req.params;
    
    const template = notificationService.templates[templateKey];
    
    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }
    
    res.json({
      success: true,
      templateKey,
      template
    });
  } catch (error) {
    console.error('[Notification API] Template error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get template'
    });
  }
});

// Add or update template (admin only)
router.put('/templates/:templateKey', (req, res) => {
  try {
    const { templateKey } = req.params;
    const { template } = req.body;
    
    if (!template || !template.sms || !template.email) {
      return res.status(400).json({
        success: false,
        error: 'Template must include both SMS and email versions'
      });
    }
    
    notificationService.addTemplate(templateKey, template);
    
    res.json({
      success: true,
      message: 'Template updated successfully',
      templateKey
    });
  } catch (error) {
    console.error('[Notification API] Update template error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update template'
    });
  }
});

// Test notifications with sample data
router.post('/test', async (req, res) => {
  try {
    const { templateKey, contact } = req.body;
    
    // Sample test data
    const testData = {
      companyName: 'Test Company',
      customerName: 'John Doe',
      serviceType: 'Test Service',
      appointmentTime: 'Today at 2:00 PM',
      address: '123 Test St, Test City',
      phone: '(555) 123-4567',
      customerPhone: '+15555551234',
      amount: '100.00',
      invoiceNumber: 'TEST-001'
    };
    
    const testContact = contact || {
      name: 'Test User',
      phone: '+15555551234',
      email: 'test@example.com'
    };
    
    const result = await notificationService.sendNotification(
      testContact,
      templateKey || 'bookingConfirmation',
      testData,
      { preferSMS: false } // Use email for testing
    );
    
    res.json({
      success: true,
      testData,
      testContact,
      result
    });
  } catch (error) {
    console.error('[Notification API] Test error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to run test'
    });
  }
});

// Health check
router.get('/health', (req, res) => {
  try {
    const stats = notificationService.getStats('1h');
    
    res.json({
      success: true,
      status: 'healthy',
      service: 'notifications',
      templatesCount: notificationService.getAvailableTemplates().length,
      recentMessages: stats.total,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: error.message
    });
  }
});

module.exports = router;
