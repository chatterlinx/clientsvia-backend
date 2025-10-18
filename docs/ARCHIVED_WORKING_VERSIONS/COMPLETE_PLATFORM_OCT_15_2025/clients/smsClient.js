// clients/smsClient.js
// V2-Grade SMS Client with Twilio Integration
// Spartan Coder - Gold Standard Implementation

const twilio = require('twilio');
const { createTwilioClient, getPrimaryPhoneNumber } = require('../utils/twilioClientFactory');

class SMSClient {
  constructor() {
    // Legacy global client for backward compatibility (deprecated)
    this.client = null;
    this.isProduction = process.env.NODE_ENV === 'production';
    this.testMode = process.env.SMS_TEST_MODE === 'true';
    
    // Legacy global config (deprecated - use per-company credentials instead)
    this.config = {
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      fromNumber: process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER
    };

    // Initialize legacy global client if credentials exist (for backward compatibility)
    if (this.config.accountSid && this.config.authToken) {
      try {
        this.client = twilio(this.config.accountSid, this.config.authToken);
        console.log('[SMS] ✅ Legacy global Twilio client initialized (deprecated)');
      } catch (error) {
        console.error('[SMS] ❌ Failed to initialize legacy Twilio client:', error.message);
      }
    } else {
      console.log('[SMS] ⚠️  Legacy Twilio credentials not found, using per-company credentials');
    }

    // Message tracking
    this.sentMessages = [];
    this.stats = {
      sent: 0,
      failed: 0,
      queued: 0
    };
  }

  /**
   * Send SMS message
   * @param {object} options - { to, body, from? }
   * @returns {Promise<object>} - { success, messageId?, error? }
   */
  async send(options) {
    const { to, body, from } = options;

    // Validate input
    if (!to || !body) {
      const error = 'Missing required fields: to and body';
      console.error('[SMS] ❌', error);
      this.stats.failed++;
      return { success: false, error };
    }

    // Normalize phone number
    const normalizedTo = this.normalizePhoneNumber(to);
    if (!normalizedTo) {
      const error = `Invalid phone number format: ${to}`;
      console.error('[SMS] ❌', error);
      this.stats.failed++;
      return { success: false, error };
    }

    const messageData = {
      to: normalizedTo,
      body: body.substring(0, 1600), // SMS length limit
      from: from || this.config.fromNumber,
      timestamp: new Date().toISOString()
    };

    try {
      let result;

      if (this.testMode || !this.client) {
        // Mock mode for development/testing
        result = await this.mockSend(messageData);
      } else {
        // Production Twilio send
        result = await this.twilioSend(messageData);
      }

      // Track successful message
      this.trackMessage(messageData, result, true);
      this.stats.sent++;

      console.log(`[SMS] ✅ Message sent to ${normalizedTo}`);
      return { success: true, ...result };

    } catch (error) {
      // Track failed message
      this.trackMessage(messageData, null, false, error.message);
      this.stats.failed++;

      console.error(`[SMS] ❌ Failed to send to ${normalizedTo}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send SMS message with per-company credentials (RECOMMENDED)
   * @param {object} options - { to, body, from?, company }
   * @returns {Promise<object>} - { success, messageId?, error? }
   */
  async sendWithCompany(options) {
    const { to, body, from, company } = options;

    // Validate input
    if (!to || !body) {
      const error = 'Missing required fields: to and body';
      console.error('[SMS] ❌', error);
      this.stats.failed++;
      return { success: false, error };
    }

    if (!company) {
      const error = 'Company object is required for per-company SMS';
      console.error('[SMS] ❌', error);
      this.stats.failed++;
      return { success: false, error };
    }

    // Normalize phone number
    const normalizedTo = this.normalizePhoneNumber(to);
    if (!normalizedTo) {
      const error = `Invalid phone number format: ${to}`;
      console.error('[SMS] ❌', error);
      this.stats.failed++;
      return { success: false, error };
    }

    // Get company-specific Twilio client
    const companyClient = createTwilioClient(company);
    if (!companyClient && !this.testMode) {
      const error = `No Twilio credentials configured for company: ${company.companyName}`;
      console.error('[SMS] ❌', error);
      this.stats.failed++;
      return { success: false, error };
    }

    // Determine from number - use company's primary number or provided from
    const fromNumber = from || getPrimaryPhoneNumber(company) || this.config.fromNumber;
    if (!fromNumber) {
      const error = `No from phone number available for company: ${company.companyName}`;
      console.error('[SMS] ❌', error);
      this.stats.failed++;
      return { success: false, error };
    }

    const messageData = {
      to: normalizedTo,
      body: body.substring(0, 1600), // SMS length limit
      from: fromNumber,
      timestamp: new Date().toISOString(),
      companyId: company._id?.toString(),
      companyName: company.companyName
    };

    try {
      let result;

      if (this.testMode || !companyClient) {
        // Mock mode for development/testing
        result = await this.mockSend(messageData);
        console.log(`[SMS] 📱 Mock SMS sent for company: ${company.companyName}`);
      } else {
        // Production Twilio send with company-specific client
        result = await this.companyTwilioSend(messageData, companyClient);
        console.log(`[SMS] ✅ SMS sent for company: ${company.companyName}`);
      }

      // Track successful message
      this.trackMessage(messageData, result, true);
      this.stats.sent++;

      console.log(`[SMS] ✅ Company message sent to ${normalizedTo} from ${fromNumber}`);
      return { success: true, ...result };

    } catch (error) {
      // Track failed message
      this.trackMessage(messageData, null, false, error.message);
      this.stats.failed++;

      console.error(`[SMS] ❌ Failed to send for company ${company.companyName}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send SMS via Twilio
   */
  async twilioSend(messageData) {
    const message = await this.client.messages.create({
      body: messageData.body,
      from: messageData.from,
      to: messageData.to
    });

    return {
      messageId: message.sid,
      status: message.status,
      provider: 'twilio',
      cost: message.price,
      deliveryStatus: 'queued'
    };
  }

  /**
   * Send SMS via Twilio with company-specific client
   */
  async companyTwilioSend(messageData, companyClient) {
    const message = await companyClient.messages.create({
      body: messageData.body,
      from: messageData.from,
      to: messageData.to
    });

    return {
      messageId: message.sid,
      status: message.status,
      provider: 'twilio',
      cost: message.price,
      deliveryStatus: 'queued'
    };
  }

  /**
   * Mock SMS send for development/testing
   */
  async mockSend(messageData) {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));

    // Simulate occasional failures (5% fail rate)
    if (Math.random() < 0.05) {
      throw new Error('Mock network error');
    }

    const mockId = 'mock_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

    console.log('[SMS] 📱 MOCK MESSAGE:');
    console.log(`   To: ${messageData.to}`);
    console.log(`   Body: ${messageData.body}`);
    console.log(`   ID: ${mockId}`);

    return {
      messageId: mockId,
      status: 'sent',
      provider: 'mock',
      cost: '$0.00',
      deliveryStatus: 'delivered'
    };
  }

  /**
   * Normalize phone number to E.164 format
   */
  normalizePhoneNumber(phone) {
    if (!phone) return null;

    // Remove all non-digit characters
    const digits = phone.replace(/\D/g, '');

    // Handle different number formats
    if (digits.length === 10) {
      // US 10-digit number
      return `+1${digits}`;
    } else if (digits.length === 11 && digits.startsWith('1')) {
      // US 11-digit number starting with 1
      return `+${digits}`;
    } else if (digits.length > 7 && phone.startsWith('+')) {
      // International number with + prefix
      return phone;
    } else if (digits.length > 10) {
      // International number without + prefix
      return `+${digits}`;
    }

    // Invalid number
    return null;
  }

  /**
   * Track sent messages for analytics
   */
  trackMessage(messageData, result, success, error = null) {
    const record = {
      ...messageData,
      success,
      result,
      error,
      sentAt: new Date().toISOString()
    };

    this.sentMessages.push(record);

    // Keep only last 500 messages in memory
    if (this.sentMessages.length > 500) {
      this.sentMessages = this.sentMessages.slice(-500);
    }
  }

  /**
   * Get SMS statistics
   */
  getStats() {
    const recent = this.sentMessages.filter(msg => {
      const msgTime = new Date(msg.sentAt);
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      return msgTime >= oneDayAgo;
    });

    return {
      ...this.stats,
      recent24h: {
        total: recent.length,
        successful: recent.filter(msg => msg.success).length,
        failed: recent.filter(msg => !msg.success).length
      },
      provider: this.client ? 'twilio' : 'mock',
      testMode: this.testMode
    };
  }

  /**
   * Get recent messages
   */
  getRecentMessages(limit = 10) {
    return this.sentMessages
      .slice(-limit)
      .sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
  }

  /**
   * Check if SMS client is properly configured
   */
  isConfigured() {
    return !!(this.client || this.testMode);
  }

  /**
   * Get configuration status
   */
  getStatus() {
    return {
      configured: this.isConfigured(),
      provider: this.client ? 'twilio' : 'mock',
      testMode: this.testMode,
      hasCredentials: !!(this.config.accountSid && this.config.authToken),
      fromNumber: this.config.fromNumber || 'Not configured'
    };
  }
}

// Create singleton instance
const smsClient = new SMSClient();

module.exports = smsClient;
