// services/notificationIntegration.js
// Simplified integration layer for notification service

const NotificationService = require('./notificationService');
const fs = require('fs');
const path = require('path');

class NotificationIntegration {
  constructor(options = {}) {
    // Load templates
    const templatesPath = options.templatesPath || path.join(__dirname, '../config/messageTemplates.json');
    this.templates = JSON.parse(fs.readFileSync(templatesPath, 'utf8'));
    
    // Initialize notification service with provided or mock clients
    this.notificationService = new NotificationService({
      smsClient: options.smsClient || this.createMockSMSClient(),
      emailClient: options.emailClient || this.createMockEmailClient(),
      templates: this.templates
    });
    
    this.companyInfo = options.companyInfo || {
      name: 'Your Company',
      phone: '555-0000',
      email: 'info@yourcompany.com',
      website: 'www.yourcompany.com'
    };
  }

  /**
   * Create mock SMS client for testing
   */
  createMockSMSClient() {
    return {
      send: async (params) => {
        console.log(`📱 [MOCK SMS] TO: ${params.to}`);
        console.log(`📱 [MOCK SMS] BODY: ${params.body}`);
        return { messageId: `mock_sms_${Date.now()}`, status: 'sent' };
      }
    };
  }

  /**
   * Create mock email client for testing
   */
  createMockEmailClient() {
    return {
      send: async (params) => {
        console.log(`📧 [MOCK EMAIL] TO: ${params.to}`);
        console.log(`📧 [MOCK EMAIL] SUBJECT: ${params.subject}`);
        console.log(`📧 [MOCK EMAIL] BODY: ${params.body.substring(0, 100)}...`);
        return { messageId: `mock_email_${Date.now()}`, status: 'sent' };
      }
    };
  }

  /**
   * Quick method to send booking confirmation
   */
  async sendBookingConfirmation(bookingData) {
    const contact = {
      phone: bookingData.customerPhone,
      email: bookingData.customerEmail
    };

    const data = {
      customerName: bookingData.customerName,
      companyName: bookingData.companyName || this.companyInfo.name,
      serviceType: bookingData.serviceType,
      appointmentTime: bookingData.appointmentTime,
      address: bookingData.address,
      phone: bookingData.companyPhone || this.companyInfo.phone
    };

    return await this.notificationService.sendNotification(
      contact,
      'bookingConfirmation',
      data,
      { preferSMS: true, sendBoth: false }
    );
  }

  /**
   * Quick method to send booking reminder
   */
  async sendBookingReminder(bookingData) {
    const contact = {
      phone: bookingData.customerPhone,
      email: bookingData.customerEmail
    };

    const data = {
      customerName: bookingData.customerName,
      companyName: bookingData.companyName || this.companyInfo.name,
      serviceType: bookingData.serviceType,
      appointmentTime: bookingData.appointmentTime,
      address: bookingData.address,
      phone: bookingData.companyPhone || this.companyInfo.phone
    };

    return await this.notificationService.sendNotification(
      contact,
      'bookingReminder',
      data,
      { preferSMS: true }
    );
  }

  /**
   * Quick method to send emergency alert
   */
  async sendEmergencyAlert(personnelContact, emergencyData) {
    const data = {
      serviceType: emergencyData.serviceType,
      address: emergencyData.address,
      customerPhone: emergencyData.customerPhone,
      description: emergencyData.description,
      timestamp: new Date().toLocaleString()
    };

    return await this.notificationService.sendNotification(
      personnelContact,
      'emergencyAlert',
      data,
      { preferSMS: true, sendBoth: true }
    );
  }

  /**
   * Quick method to send quote request notification
   */
  async sendQuoteRequest(salesContact, quoteData) {
    const data = {
      customerName: quoteData.customerName,
      customerPhone: quoteData.customerPhone,
      customerEmail: quoteData.customerEmail,
      serviceType: quoteData.serviceType,
      address: quoteData.address,
      description: quoteData.description,
      urgency: quoteData.urgency || 'Standard'
    };

    return await this.notificationService.sendNotification(
      salesContact,
      'quoteRequest',
      data,
      { preferSMS: false, fallbackEmail: true }
    );
  }

  /**
   * Quick method to send service completion notification
   */
  async sendServiceComplete(customerContact, serviceData) {
    const data = {
      customerName: serviceData.customerName,
      serviceType: serviceData.serviceType,
      serviceDate: serviceData.serviceDate || new Date().toLocaleDateString(),
      technicianName: serviceData.technicianName,
      serviceDescription: serviceData.serviceDescription,
      companyName: serviceData.companyName || this.companyInfo.name,
      phone: serviceData.companyPhone || this.companyInfo.phone,
      reviewLink: serviceData.reviewLink || `${this.companyInfo.website}/review`
    };

    return await this.notificationService.sendNotification(
      customerContact,
      'serviceComplete',
      data,
      { preferSMS: false, fallbackEmail: true }
    );
  }

  /**
   * Quick method to send welcome message
   */
  async sendWelcome(customerContact, serviceType = null) {
    const data = {
      companyName: this.companyInfo.name,
      serviceType: serviceType || 'your service needs',
      phone: this.companyInfo.phone,
      email: this.companyInfo.email,
      website: this.companyInfo.website
    };

    return await this.notificationService.sendNotification(
      customerContact,
      'welcomeMessage',
      data,
      { preferSMS: true }
    );
  }

  /**
   * Quick method to send payment reminder
   */
  async sendPaymentReminder(customerContact, paymentData) {
    const data = {
      customerName: paymentData.customerName,
      amount: paymentData.amount,
      invoiceNumber: paymentData.invoiceNumber,
      dueDate: paymentData.dueDate,
      serviceDescription: paymentData.serviceDescription,
      paymentLink: paymentData.paymentLink,
      phone: this.companyInfo.phone
    };

    return await this.notificationService.sendNotification(
      customerContact,
      'paymentReminder',
      data,
      { preferSMS: true, sendBoth: false }
    );
  }

  /**
   * Send custom message using fallback template
   */
  async sendCustomMessage(recipientContact, messageData) {
    const data = {
      recipientName: messageData.recipientName,
      customerMessage: messageData.message,
      customerName: messageData.senderName || 'Customer',
      customerPhone: messageData.senderPhone || 'N/A',
      timestamp: new Date().toLocaleString()
    };

    return await this.notificationService.sendNotification(
      recipientContact,
      'fallbackMessage',
      data,
      messageData.options || { preferSMS: true }
    );
  }

  /**
   * Get notification analytics
   */
  getAnalytics() {
    return this.notificationService.getAnalytics();
  }

  /**
   * Get recent messages
   */
  getRecentMessages(limit = 10) {
    return this.notificationService.getRecentMessages(limit);
  }

  /**
   * Get notification service instance for advanced usage
   */
  getNotificationService() {
    return this.notificationService;
  }
}

module.exports = NotificationIntegration;
