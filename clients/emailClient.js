// ============================================================================
// EMAIL CLIENT - TWO-SYSTEM ARCHITECTURE
// ============================================================================
// 
// PURPOSE:
// ClientsVia uses TWO separate email systems with clear separation:
//
// 1️⃣ ADMIN/DEVELOPER EMAILS (Gmail - clientsvia@gmail.com)
//    - System alerts, errors, debugging
//    - SMS test confirmations
//    - Health check failures
//    - USAGE: emailClient.sendAdminAlert() or emailClient.sendToAdmins()
//
// 2️⃣ CUSTOMER EMAILS (Twilio SendGrid - FUTURE)
//    - Appointment confirmations, invoices
//    - Marketing emails (per-company branded)
//    - USAGE: emailClient.sendCustomerEmail() (not yet implemented)
//
// CRITICAL PATTERN:
// If customer email fails → ALWAYS notify admin via sendAdminAlert()
//
// IMPORT IN YOUR CODE:
// const emailClient = require('../clients/emailClient');
// await emailClient.sendAdminAlert('Subject', 'Body');
// await emailClient.sendToAdmins({ subject, body, html });
//
// ============================================================================

const nodemailer = require('nodemailer');

class EmailClient {
    constructor() {
        this.isProduction = process.env.NODE_ENV === 'production';
        this.testMode = process.env.EMAIL_TEST_MODE === 'true';
        
        // ========================================================================
        // GMAIL CONFIGURATION (Admin/Developer Emails)
        // ========================================================================
        this.config = {
            user: process.env.GMAIL_USER,
            appPassword: process.env.GMAIL_APP_PASSWORD,
            fromEmail: process.env.FROM_EMAIL || process.env.GMAIL_USER,
            fromName: process.env.FROM_NAME || 'ClientsVia Alerts'
        };
        
        if (this.config.user && this.config.appPassword) {
            this.mailer = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: this.config.user,
                    pass: this.config.appPassword,
                },
            });
            console.log('[Email] ✅ Gmail mailer initialized successfully');
        } else {
            console.log('[Email] ⚠️  GMAIL_USER or GMAIL_APP_PASSWORD not found, using mock mode');
        }
        
        // ========================================================================
        // SENDGRID CONFIGURATION (Customer Emails - FUTURE)
        // ========================================================================
        // this.sendGridApiKey = process.env.SENDGRID_API_KEY;
        // if (this.sendGridApiKey) {
        //     const sgMail = require('@sendgrid/mail');
        //     sgMail.setApiKey(this.sendGridApiKey);
        //     this.sgMail = sgMail;
        //     console.log('[Email] ✅ SendGrid initialized for customer emails');
        // }
        
        // Statistics
        this.stats = {
            adminEmailsSent: 0,
            adminEmailsFailed: 0,
            customerEmailsSent: 0,
            customerEmailsFailed: 0
        };
    }
    
    // ========================================================================
    // 1️⃣ ADMIN/DEVELOPER EMAIL METHODS (Gmail)
    // ========================================================================
    
    /**
     * Send alert to admin developers (Gmail)
     * USE THIS for: Errors, system alerts, debugging, SMS test confirmations
     * 
     * @param {string} subject - Email subject line
     * @param {string} body - Plain text body
     * @param {string} [html] - Optional HTML body
     * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
     * 
     * EXAMPLE:
     * await emailClient.sendAdminAlert(
     *   '🚨 Customer Email Failed',
     *   `Failed to send appointment confirmation to customer@example.com\nError: SMTP timeout`
     * );
     */
    async sendAdminAlert(subject, body, html = null) {
        try {
            // Get admin contacts from AdminSettings
            const AdminSettings = require('../models/AdminSettings');
            const settings = await AdminSettings.findOne({});
            const adminContacts = settings?.notificationCenter?.adminContacts || [];
            
            const recipients = adminContacts
                .filter(c => c.receiveEmail && c.email)
                .map(c => c.email);
            
            if (recipients.length === 0) {
                console.log('[Email] ⚠️  No admin contacts configured with email - cannot send admin alert');
                return { success: false, error: 'No admin email recipients configured' };
            }
            
            const results = [];
            for (const email of recipients) {
                const result = await this.send({
                    to: email,
                    subject: `[ClientsVia Admin] ${subject}`,
                    body,
                    html
                });
                results.push(result);
            }
            
            const allSuccess = results.every(r => r.success);
            this.stats.adminEmailsSent += allSuccess ? recipients.length : 0;
            this.stats.adminEmailsFailed += allSuccess ? 0 : recipients.length;
            
            return {
                success: allSuccess,
                recipients: recipients.length,
                results
            };
            
        } catch (error) {
            console.error('[Email] ❌ Failed to send admin alert:', error);
            this.stats.adminEmailsFailed++;
            return { success: false, error: error.message };
        }
    }
    
    /**
     * Send email to all admin contacts (Gmail)
     * USE THIS for: Batch admin notifications, platform-wide alerts
     * 
     * @param {object} options - { subject, body, html? }
     * @returns {Promise<{success: boolean, recipients: number}>}
     * 
     * EXAMPLE:
     * await emailClient.sendToAdmins({
     *   subject: 'SMS Test Received',
     *   body: 'Test SMS command received from +15551234567',
     *   html: '<h2>SMS Test</h2><p>Success!</p>'
     * });
     */
    async sendToAdmins(options) {
        return await this.sendAdminAlert(options.subject, options.body, options.html);
    }
    
    // ========================================================================
    // 2️⃣ CUSTOMER EMAIL METHODS (Twilio SendGrid - FUTURE)
    // ========================================================================
    
    /**
     * Send email to customer (SendGrid - FUTURE)
     * USE THIS for: Appointment confirmations, invoices, receipts
     * 
     * ⚠️ CRITICAL: If this fails, ALWAYS call sendAdminAlert() to notify admins
     * 
     * @param {object} options - { to, companyId, templateId, data }
     * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
     * 
     * EXAMPLE:
     * const result = await emailClient.sendCustomerEmail({
     *   to: 'customer@example.com',
     *   companyId: '507f1f77bcf86cd799439011',
     *   templateId: 'appointment_confirmation',
     *   data: { appointmentTime: '2:00 PM', technicianName: 'John' }
     * });
     * 
     * if (!result.success) {
     *   // CRITICAL: Notify admin that customer email failed
     *   await emailClient.sendAdminAlert(
     *     '🚨 Customer Email Failed',
     *     `Failed to send ${templateId} to ${to}\nError: ${result.error}`
     *   );
     * }
     */
    async sendCustomerEmail(options) {
        // TODO: Implement SendGrid customer email
        console.log('[Email] ⚠️  sendCustomerEmail() not yet implemented - use SendGrid');
        
        // Notify admin that customer email system is not ready
        await this.sendAdminAlert(
            '⚠️ Customer Email Attempted But Not Configured',
            `Attempted to send customer email but SendGrid is not configured yet.\n\nRecipient: ${options.to}\nTemplate: ${options.templateId || 'N/A'}\n\nPlease configure SENDGRID_API_KEY.`
        );
        
        this.stats.customerEmailsFailed++;
        return { success: false, error: 'SendGrid not configured' };
    }
    
    // ========================================================================
    // LOW-LEVEL EMAIL SENDER (Used by both admin and customer methods)
    // ========================================================================
    
    /**
     * Low-level email sender (direct send, bypasses admin/customer routing)
     * USE THIS SPARINGLY - Prefer sendAdminAlert() or sendCustomerEmail()
     * 
     * @param {object} options - { to, subject, body, html? }
     * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
     */
    async send(options) {
        const { to, subject, body, html } = options;
        
        // Validation
        if (!to || !subject || !body) {
            const error = 'Missing required fields: to, subject, and body';
            console.error('[Email] ❌', error);
            return { success: false, error };
        }
        
        if (!this.isValidEmail(to)) {
            const error = `Invalid email format: ${to}`;
            console.error('[Email] ❌', error);
            return { success: false, error };
        }
        
        const emailData = {
            from: `"${this.config.fromName}" <${this.config.fromEmail}>`,
            to: to.toLowerCase().trim(),
            subject: subject.substring(0, 200),
            text: body,
            html: html || this.convertToHTML(body),
            timestamp: new Date().toISOString()
        };
        
        try {
            let result;
            
            if (this.testMode || !this.mailer) {
                result = await this.mockSend(emailData);
            } else {
                result = await this.mailer.sendMail(emailData);
                result.messageId = result.messageId; // Nodemailer returns messageId directly
            }
            
            console.log(`[Email] ✅ Sent to ${to}: ${subject}`);
            
            return { success: true, ...result };
            
        } catch (error) {
            console.error(`[Email] ❌ Failed to send to ${to}:`, error.message);
            return { success: false, error: error.message };
        }
    }
    
    /**
     * Mock email sending (test mode)
     */
    async mockSend(emailData) {
        console.log('[Email] 📧 [MOCK MODE] Would send:', {
            to: emailData.to,
            subject: emailData.subject,
            bodyPreview: emailData.text.substring(0, 100)
        });
        
        return {
            messageId: `mock-${Date.now()}`,
            mock: true,
            timestamp: emailData.timestamp
        };
    }
    
    // ========================================================================
    // UTILITY METHODS
    // ========================================================================
    
    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }
    
    convertToHTML(text) {
        return `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto;">
                <div style="white-space: pre-wrap; line-height: 1.6;">${this.escapeHtml(text)}</div>
                <hr style="margin: 30px 0; border: none; border-top: 1px solid #e0e0e0;">
                <p style="font-size: 12px; color: #666;">
                    This is an automated message from ClientsVia Platform.<br>
                    © ${new Date().getFullYear()} ClientsVia. All rights reserved.
                </p>
            </div>
        `;
    }
    
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
    
    getStats() {
        return {
            ...this.stats,
            adminEmailSystem: this.mailer ? 'Gmail (Active)' : 'Not Configured',
            customerEmailSystem: 'SendGrid (Not Yet Implemented)',
            testMode: this.testMode
        };
    }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================
// Import this in your code:
// const emailClient = require('../clients/emailClient');
// 
// ADMIN NOTIFICATIONS:
// await emailClient.sendAdminAlert('Error Title', 'Error details...');
// 
// CUSTOMER EMAILS (Future):
// const result = await emailClient.sendCustomerEmail({ to, companyId, templateId, data });
// if (!result.success) {
//   await emailClient.sendAdminAlert('Customer Email Failed', result.error);
// }
// ============================================================================

const emailClient = new EmailClient();
module.exports = emailClient;
