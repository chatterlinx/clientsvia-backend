// clients/emailClient.js
// V2-Grade Email Client with Gmail/Nodemailer Integration
// Supports both Gmail (free, 500/day) and SendGrid (backup)

const nodemailer = require('nodemailer');

class EmailClient {
  constructor() {
    this.isProduction = process.env.NODE_ENV === 'production';
    
    // Try Gmail first, fallback to SendGrid
    this.useGmail = !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
    
    if (this.useGmail) {
      // Gmail configuration
      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.GMAIL_USER,
          pass: process.env.GMAIL_APP_PASSWORD
        }
      });
      
      this.config = {
        fromEmail: process.env.GMAIL_USER,
        fromName: process.env.FROM_NAME || 'ClientsVia Alerts'
      };
      
      console.log(`[Email] ✅ Gmail client initialized (${process.env.GMAIL_USER})`);
      
      // Verify connection
      this.transporter.verify((error, success) => {
        if (error) {
          console.error('[Email] ⚠️  Gmail verification failed:', error.message);
        } else {
          console.log('[Email] ✅ Gmail ready to send emails');
        }
      });
      
    } else if (process.env.SENDGRID_API_KEY) {
      // Fallback to SendGrid
      const sgMail = require('@sendgrid/mail');
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      this.sgMail = sgMail;
      
      this.config = {
        fromEmail: process.env.FROM_EMAIL || process.env.SENDGRID_FROM_EMAIL,
        fromName: process.env.FROM_NAME || 'ClientsVia Support'
      };
      
      console.log('[Email] ✅ SendGrid client initialized');
      
    } else {
      console.log('[Email] ⚠️  No email service configured (Gmail or SendGrid)');
      console.log('[Email] ℹ️  Set GMAIL_USER + GMAIL_APP_PASSWORD for Gmail (free, 500/day)');
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

    try {
      let result;

      if (this.useGmail && this.transporter) {
        // Send via Gmail
        result = await this.sendViaGmail({ to, subject, body, html, from });
      } else if (this.sgMail) {
        // Send via SendGrid
        result = await this.sendViaSendGrid({ to, subject, body, html, from });
      } else {
        // Mock mode - no email service configured
        console.log(`[Email] 📧 [MOCK] Would send to ${to}: ${subject}`);
        return { success: true, messageId: 'mock-' + Date.now(), mock: true };
      }

      this.stats.sent++;
      console.log(`[Email] ✅ Email sent to ${to}`);
      return { success: true, ...result };

    } catch (error) {
      this.stats.failed++;
      console.error(`[Email] ❌ Failed to send to ${to}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send via Gmail (nodemailer)
   */
  async sendViaGmail({ to, subject, body, html, from }) {
    const mailOptions = {
      from: from || `"${this.config.fromName}" <${this.config.fromEmail}>`,
      to: to,
      subject: subject,
      text: body,
      html: html || this.convertToHTML(body)
    };

    const info = await this.transporter.sendMail(mailOptions);
    
    return {
      messageId: info.messageId,
      provider: 'gmail',
      accepted: info.accepted,
      rejected: info.rejected
    };
  }

  /**
   * Send via SendGrid
   */
  async sendViaSendGrid({ to, subject, body, html, from }) {
    const msg = {
      to: to,
      from: from || `${this.config.fromName} <${this.config.fromEmail}>`,
      subject: subject,
      text: body,
      html: html || this.convertToHTML(body)
    };

    const [response] = await this.sgMail.send(msg);
    
    return {
      messageId: response.headers['x-message-id'],
      provider: 'sendgrid',
      statusCode: response.statusCode
    };
  }

  /**
   * Validate email format
   */
  isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Convert plain text to simple HTML
   */
  convertToHTML(text) {
    return `
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px;">
        <div style="white-space: pre-wrap;">${this.escapeHtml(text)}</div>
      </div>
    `;
  }

  /**
   * Escape HTML special characters
   */
  escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  /**
   * Get email stats
   */
  getStats() {
    return {
      ...this.stats,
      provider: this.useGmail ? 'gmail' : (this.sgMail ? 'sendgrid' : 'none'),
      configured: !!(this.useGmail || this.sgMail)
    };
  }
}

// Create singleton instance
const emailClient = new EmailClient();

module.exports = emailClient;
