// clients/emailClient.js
// Enterprise-Grade Email Client with SendGrid Integration
// Spartan Coder - Gold Standard Implementation

const sgMail = require('@sendgrid/mail');

class EmailClient {
  constructor() {
    // Initialize SendGrid if API key is available
    this.isProduction = process.env.NODE_ENV === 'production';
    this.testMode = process.env.EMAIL_TEST_MODE === 'true';
    
    this.config = {
      apiKey: process.env.SENDGRID_API_KEY,
      fromEmail: process.env.FROM_EMAIL || process.env.SENDGRID_FROM_EMAIL,
      fromName: process.env.FROM_NAME || 'ClientsVia Support'
    };

    // Initialize SendGrid if API key exists
    if (this.config.apiKey) {
      try {
        sgMail.setApiKey(this.config.apiKey);
        console.log('[Email] ✅ SendGrid client initialized successfully');
      } catch (error) {
        console.error('[Email] ❌ Failed to initialize SendGrid client:', error.message);
      }
    } else {
      console.log('[Email] ⚠️  SendGrid API key not found, using mock mode');
    }

    // Message tracking
    this.sentEmails = [];
    this.stats = {
      sent: 0,
      failed: 0,
      queued: 0
    };
  }

  /**
   * Send email message
   * @param {object} options - { to, subject, body, from?, html? }
   * @returns {Promise<object>} - { success, messageId?, error? }
   */
  async send(options) {
    const { to, subject, body, from, html } = options;

    // Validate input
    if (!to || !subject || !body) {
      const error = 'Missing required fields: to, subject, and body';
      console.error('[Email] ❌', error);
      this.stats.failed++;
      return { success: false, error };
    }

    // Validate email format
    if (!this.isValidEmail(to)) {
      const error = `Invalid email format: ${to}`;
      console.error('[Email] ❌', error);
      this.stats.failed++;
      return { success: false, error };
    }

    const emailData = {
      to: to.toLowerCase().trim(),
      subject: subject.substring(0, 200), // Subject length limit
      text: body,
      html: html || this.convertToHTML(body),
      from: from || `${this.config.fromName} <${this.config.fromEmail}>`,
      timestamp: new Date().toISOString()
    };

    try {
      let result;

      if (this.testMode || !this.config.apiKey) {
        // Mock mode for development/testing
        result = await this.mockSend(emailData);
      } else {
        // Production SendGrid send
        result = await this.sendGridSend(emailData);
      }

      // Track successful email
      this.trackEmail(emailData, result, true);
      this.stats.sent++;

      console.log(`[Email] ✅ Email sent to ${to}`);
      return { success: true, ...result };

    } catch (error) {
      // Track failed email
      this.trackEmail(emailData, null, false, error.message);
      this.stats.failed++;

      console.error(`[Email] ❌ Failed to send to ${to}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send email via SendGrid
   */
  async sendGridSend(emailData) {
    const msg = {
      to: emailData.to,
      from: emailData.from,
      subject: emailData.subject,
      text: emailData.text,
      html: emailData.html
    };

    const response = await sgMail.send(msg);
    const messageId = response[0].headers['x-message-id'];

    return {
      messageId,
      provider: 'sendgrid',
      status: 'sent',
      deliveryStatus: 'queued'
    };
  }

  /**
   * Mock email send for development/testing
   */
  async mockSend(emailData) {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300));

    // Simulate occasional failures (3% fail rate)
    if (Math.random() < 0.03) {
      throw new Error('Mock network error');
    }

    const mockId = 'mock_email_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

    console.log('[Email] 📧 MOCK EMAIL:');
    console.log(`   To: ${emailData.to}`);
    console.log(`   Subject: ${emailData.subject}`);
    console.log(`   Body: ${emailData.text.substring(0, 100)}...`);
    console.log(`   ID: ${mockId}`);

    return {
      messageId: mockId,
      provider: 'mock',
      status: 'sent',
      deliveryStatus: 'delivered'
    };
  }

  /**
   * Convert plain text to basic HTML
   */
  convertToHTML(text) {
    return text
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')
      .replace(/^(.+)/, '<p>$1')
      .replace(/(.+)$/, '$1</p>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>');
  }

  /**
   * Validate email format
   */
  isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Send bulk emails with rate limiting
   */
  async sendBulk(emails, options = {}) {
    const { batchSize = 10, delayBetweenBatches = 1000 } = options;
    const results = [];

    for (let i = 0; i < emails.length; i += batchSize) {
      const batch = emails.slice(i, i + batchSize);
      
      const batchPromises = batch.map(email => this.send(email));
      const batchResults = await Promise.allSettled(batchPromises);
      
      results.push(...batchResults);

      // Delay between batches to avoid rate limits
      if (i + batchSize < emails.length && delayBetweenBatches > 0) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
      }
    }

    return {
      total: emails.length,
      successful: results.filter(r => r.status === 'fulfilled' && r.value.success).length,
      failed: results.filter(r => r.status === 'rejected' || !r.value.success).length,
      results
    };
  }

  /**
   * Track sent emails for analytics
   */
  trackEmail(emailData, result, success, error = null) {
    const record = {
      ...emailData,
      success,
      result,
      error,
      sentAt: new Date().toISOString()
    };

    this.sentEmails.push(record);

    // Keep only last 500 emails in memory
    if (this.sentEmails.length > 500) {
      this.sentEmails = this.sentEmails.slice(-500);
    }
  }

  /**
   * Get email statistics
   */
  getStats() {
    const recent = this.sentEmails.filter(email => {
      const emailTime = new Date(email.sentAt);
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      return emailTime >= oneDayAgo;
    });

    return {
      ...this.stats,
      recent24h: {
        total: recent.length,
        successful: recent.filter(email => email.success).length,
        failed: recent.filter(email => !email.success).length
      },
      provider: this.config.apiKey ? 'sendgrid' : 'mock',
      testMode: this.testMode
    };
  }

  /**
   * Get recent emails
   */
  getRecentEmails(limit = 10) {
    return this.sentEmails
      .slice(-limit)
      .sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
  }

  /**
   * Check if email client is properly configured
   */
  isConfigured() {
    return !!(this.config.apiKey || this.testMode);
  }

  /**
   * Get configuration status
   */
  getStatus() {
    return {
      configured: this.isConfigured(),
      provider: this.config.apiKey ? 'sendgrid' : 'mock',
      testMode: this.testMode,
      hasApiKey: !!this.config.apiKey,
      fromEmail: this.config.fromEmail || 'Not configured',
      fromName: this.config.fromName
    };
  }

  /**
   * Test email configuration
   */
  async testConfiguration(testEmail) {
    if (!testEmail) {
      throw new Error('Test email address required');
    }

    return await this.send({
      to: testEmail,
      subject: 'Email Configuration Test',
      body: 'This is a test email to verify your email configuration is working correctly.'
    });
  }
}

// Create singleton instance
const emailClient = new EmailClient();

module.exports = emailClient;
