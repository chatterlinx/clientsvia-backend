// services/notificationService.js

const mustache = require('mustache');

class NotificationService {
  constructor({ smsClient, emailClient, templates }) {
    this.smsClient = smsClient;
    this.emailClient = emailClient;
    this.templates = templates || {};
    this.sentMessages = []; // Track sent messages for analytics
  }

  /**
   * Format message using mustache templates
   */
  formatMessage(templateKey, data, channel = 'sms') {
    const template = this.templates?.[templateKey]?.[channel];
    if (!template) {
      console.warn(`Template not found: ${templateKey} for channel: ${channel}`);
      return null;
    }
    
    try {
      return mustache.render(template, data);
    } catch (error) {
      console.error(`Error formatting message: ${error.message}`);
      return null;
    }
  }

  /**
   * Send SMS notification
   */
  async sendSMS(to, templateKey, data, options = {}) {
    try {
      const message = this.formatMessage(templateKey, data, 'sms');
      if (!message || !to) {
        console.warn('Invalid SMS parameters:', { to, templateKey, hasMessage: !!message });
        return { success: false, error: 'Invalid parameters' };
      }

      const result = await this.smsClient.send({
        to: this.normalizePhoneNumber(to),
        body: message,
        ...options
      });

      // Track sent message
      this.trackMessage({
        type: 'sms',
        to,
        templateKey,
        data,
        message,
        timestamp: new Date(),
        success: true,
        result
      });

      return { success: true, message, result };
    } catch (error) {
      console.error('SMS send error:', error);
      
      // Track failed message
      this.trackMessage({
        type: 'sms',
        to,
        templateKey,
        data,
        timestamp: new Date(),
        success: false,
        error: error.message
      });

      return { success: false, error: error.message };
    }
  }

  /**
   * Send email notification
   */
  async sendEmail(to, subject, templateKey, data, options = {}) {
    try {
      const body = this.formatMessage(templateKey, data, 'email');
      if (!body || !to || !subject) {
        console.warn('Invalid email parameters:', { to, subject, templateKey, hasBody: !!body });
        return { success: false, error: 'Invalid parameters' };
      }

      const result = await this.emailClient.send({
        to: to.toLowerCase().trim(),
        subject,
        body,
        ...options
      });

      // Track sent message
      this.trackMessage({
        type: 'email',
        to,
        subject,
        templateKey,
        data,
        body,
        timestamp: new Date(),
        success: true,
        result
      });

      return { success: true, subject, body, result };
    } catch (error) {
      console.error('Email send error:', error);
      
      // Track failed message
      this.trackMessage({
        type: 'email',
        to,
        subject,
        templateKey,
        data,
        timestamp: new Date(),
        success: false,
        error: error.message
      });

      return { success: false, error: error.message };
    }
  }

  /**
   * Send notification using best channel based on preferences
   */
  async sendNotification(contact, templateKey, data, options = {}) {
    const { preferSMS = false, fallbackEmail = true } = options;
    const results = [];

    // Try SMS first if preferred and phone available
    if ((preferSMS || !contact.email) && contact.phone) {
      const smsResult = await this.sendSMS(contact.phone, templateKey, data);
      results.push({ channel: 'sms', ...smsResult });
      
      if (smsResult.success && !options.sendBoth) {
        return { success: true, primary: 'sms', results };
      }
    }

    // Try email if preferred or SMS failed
    if (contact.email && (fallbackEmail || !preferSMS || !contact.phone)) {
      const subject = this.generateSubject(templateKey, data);
      const emailResult = await this.sendEmail(contact.email, subject, templateKey, data);
      results.push({ channel: 'email', ...emailResult });
      
      if (emailResult.success) {
        return { success: true, primary: 'email', results };
      }
    }

    return { 
      success: false, 
      error: 'No successful delivery channels', 
      results 
    };
  }

  /**
   * Send bulk notifications
   */
  async sendBulkNotifications(contacts, templateKey, data, options = {}) {
    const results = [];
    const { batchSize = 10, delay = 100 } = options;

    for (let i = 0; i < contacts.length; i += batchSize) {
      const batch = contacts.slice(i, i + batchSize);
      
      const batchPromises = batch.map(contact => 
        this.sendNotification(contact, templateKey, data, options)
      );

      const batchResults = await Promise.allSettled(batchPromises);
      results.push(...batchResults.map((result, index) => ({
        contact: batch[index],
        ...result
      })));

      // Delay between batches to avoid rate limits
      if (i + batchSize < contacts.length && delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    return {
      total: contacts.length,
      successful: results.filter(r => r.status === 'fulfilled' && r.value.success).length,
      failed: results.filter(r => r.status === 'rejected' || !r.value.success).length,
      results
    };
  }

  /**
   * Generate subject line for emails
   */
  generateSubject(templateKey, data) {
    const subjectTemplates = {
      bookingConfirmation: 'Appointment Confirmed - {{companyName}}',
      bookingReminder: 'Reminder: Upcoming Appointment - {{companyName}}',
      bookingCancellation: 'Appointment Cancelled - {{companyName}}',
      fallbackMessage: 'New Customer Message - {{companyName}}',
      quoteRequest: 'Service Quote Request - {{companyName}}',
      emergencyAlert: 'URGENT: Emergency Service Request'
    };

    const template = subjectTemplates[templateKey] || 'Notification from {{companyName}}';
    return mustache.render(template, data);
  }

  /**
   * Normalize phone number format
   */
  normalizePhoneNumber(phone) {
    if (!phone) return null;
    
    // Remove all non-digits
    const digits = phone.replace(/\D/g, '');
    
    // Add +1 if it's a 10-digit US number
    if (digits.length === 10) {
      return `+1${digits}`;
    }
    
    // Add + if missing
    if (digits.length === 11 && !phone.startsWith('+')) {
      return `+${digits}`;
    }
    
    return phone;
  }

  /**
   * Track sent messages for analytics
   */
  trackMessage(messageData) {
    this.sentMessages.push(messageData);
    
    // Keep only last 1000 messages in memory
    if (this.sentMessages.length > 1000) {
      this.sentMessages = this.sentMessages.slice(-1000);
    }
  }

  /**
   * Get notification statistics
   */
  getStats(timeframe = '24h') {
    const now = new Date();
    const cutoff = new Date(now.getTime() - this.parseTimeframe(timeframe));
    
    const recentMessages = this.sentMessages.filter(msg => msg.timestamp >= cutoff);
    
    const stats = {
      total: recentMessages.length,
      successful: recentMessages.filter(msg => msg.success).length,
      failed: recentMessages.filter(msg => !msg.success).length,
      sms: recentMessages.filter(msg => msg.type === 'sms').length,
      email: recentMessages.filter(msg => msg.type === 'email').length
    };

    stats.successRate = stats.total > 0 ? (stats.successful / stats.total * 100).toFixed(2) : 0;

    return stats;
  }

  /**
   * Parse timeframe string to milliseconds
   */
  parseTimeframe(timeframe) {
    const unit = timeframe.slice(-1);
    const value = parseInt(timeframe.slice(0, -1));
    
    const multipliers = {
      'm': 60 * 1000,           // minutes
      'h': 60 * 60 * 1000,     // hours
      'd': 24 * 60 * 60 * 1000 // days
    };
    
    return value * (multipliers[unit] || multipliers.h);
  }

  /**
   * Get available templates
   */
  getAvailableTemplates() {
    return Object.keys(this.templates);
  }

  /**
   * Add or update template
   */
  addTemplate(key, template) {
    this.templates[key] = template;
  }

  /**
   * Get analytics (alias for getStats for backward compatibility)
   */
  getAnalytics(timeframe = '24h') {
    const stats = this.getStats(timeframe);
    return {
      totalMessages: stats.total,
      smsCount: stats.sms,
      emailCount: stats.email,
      successRate: parseFloat(stats.successRate),
      failedMessages: stats.failed,
      successfulMessages: stats.successful
    };
  }

  /**
   * Get recent messages
   */
  getRecentMessages(limit = 10) {
    return this.sentMessages
      .slice(-limit)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }
}

module.exports = NotificationService;
