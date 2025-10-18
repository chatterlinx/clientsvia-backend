/**
 * ============================================================================
 * ADMIN NOTIFICATION SERVICE - SMS + EMAIL ALERTS
 * ============================================================================
 * 
 * PURPOSE:
 * Sends instant notifications to admin when critical alerts are generated.
 * Supports SMS (via Twilio) and Email (via existing email client).
 * 
 * ARCHITECTURE:
 * - Reads settings from AdminSettings model
 * - Composes messages from templates with dynamic variables
 * - Sends via Twilio REST API (SMS) and email client
 * - Handles errors gracefully (notifications should never block main flow)
 * 
 * USAGE:
 * ```javascript
 * const AdminNotificationService = require('./services/AdminNotificationService');
 * 
 * await AdminNotificationService.sendAlert({
 *     companyId: '64a1b2c3d4e5f6',
 *     companyName: 'Tesla Air',
 *     alertType: 'missing_variables',
 *     severity: 'warning',
 *     message: '3 required variables need values',
 *     fixUrl: 'https://clientsvia.ai/company-profile.html?id=64a1b2c3d4e5f6&tab=ai-agent-settings&subtab=variables'
 * });
 * ```
 * 
 * DYNAMIC VARIABLES:
 * - {companyName} - Name of the company
 * - {companyId} - Company ID
 * - {alertType} - Type of alert (missing_variables, error, etc.)
 * - {severity} - Severity level (info, warning, error)
 * - {message} - Alert message
 * - {fixUrl} - Direct link to fix the issue
 * - {timestamp} - Current timestamp
 */

const AdminSettings = require('../models/AdminSettings');

// Twilio client (lazy loaded)
let twilioClient = null;

// Email client
const { emailClient } = require('../clients');

// ============================================================================
// TWILIO INITIALIZATION
// ============================================================================

/**
 * Get or initialize Twilio client
 */
function getTwilioClient() {
    if (twilioClient) {
        return twilioClient;
    }
    
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const phoneNumber = process.env.TWILIO_PHONE_NUMBER;
    
    if (!accountSid || !authToken || !phoneNumber) {
        console.warn('⚠️  [NOTIFICATION SERVICE] Twilio credentials not configured - SMS disabled');
        return null;
    }
    
    try {
        const twilio = require('twilio');
        twilioClient = twilio(accountSid, authToken);
        console.log('✅ [NOTIFICATION SERVICE] Twilio client initialized');
        return twilioClient;
    } catch (error) {
        console.error('❌ [NOTIFICATION SERVICE] Failed to initialize Twilio:', error.message);
        return null;
    }
}

// ============================================================================
// MESSAGE COMPOSITION
// ============================================================================

/**
 * Replace template variables with actual values
 */
function composeMessage(template, data) {
    let message = template;
    
    // Replace all variables
    message = message.replace(/{companyName}/g, data.companyName || 'Unknown Company');
    message = message.replace(/{companyId}/g, data.companyId || '');
    message = message.replace(/{alertType}/g, data.alertType || 'Alert');
    message = message.replace(/{severity}/g, data.severity || 'info');
    message = message.replace(/{message}/g, data.message || 'No details provided');
    message = message.replace(/{fixUrl}/g, data.fixUrl || '');
    message = message.replace(/{timestamp}/g, new Date().toLocaleString());
    
    return message;
}

// ============================================================================
// SMS NOTIFICATION
// ============================================================================

/**
 * Send SMS notification via Twilio
 */
async function sendSMS(settings, data) {
    console.log('📱 [NOTIFICATION SERVICE] Preparing SMS...');
    
    // Check if SMS is enabled
    if (!settings.sms.enabled) {
        console.log('⏭️  [NOTIFICATION SERVICE] SMS disabled, skipping');
        return { success: false, reason: 'SMS notifications disabled' };
    }
    
    // Check phone number
    if (!settings.sms.phoneNumber) {
        console.warn('⚠️  [NOTIFICATION SERVICE] No admin phone number configured');
        return { success: false, reason: 'No phone number configured' };
    }
    
    // Get Twilio client
    const client = getTwilioClient();
    if (!client) {
        console.warn('⚠️  [NOTIFICATION SERVICE] Twilio not available');
        return { success: false, reason: 'Twilio not configured' };
    }
    
    try {
        // Compose message
        const messageBody = composeMessage(settings.sms.template, data);
        
        console.log(`📤 [NOTIFICATION SERVICE] Sending SMS to ${settings.sms.phoneNumber}`);
        
        // Send SMS
        const result = await client.messages.create({
            body: messageBody,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: settings.sms.phoneNumber
        });
        
        console.log(`✅ [NOTIFICATION SERVICE] SMS sent successfully (SID: ${result.sid})`);
        
        return { 
            success: true, 
            sid: result.sid,
            to: settings.sms.phoneNumber
        };
        
    } catch (error) {
        console.error('❌ [NOTIFICATION SERVICE] Failed to send SMS:', error.message);
        return { 
            success: false, 
            reason: error.message 
        };
    }
}

// ============================================================================
// EMAIL NOTIFICATION
// ============================================================================

/**
 * Send Email notification
 */
async function sendEmail(settings, data) {
    console.log('📧 [NOTIFICATION SERVICE] Preparing Email...');
    
    // Check if Email is enabled
    if (!settings.email.enabled) {
        console.log('⏭️  [NOTIFICATION SERVICE] Email disabled, skipping');
        return { success: false, reason: 'Email notifications disabled' };
    }
    
    // Check email address
    if (!settings.email.address) {
        console.warn('⚠️  [NOTIFICATION SERVICE] No admin email configured');
        return { success: false, reason: 'No email address configured' };
    }
    
    // Check if email client is available
    if (!emailClient || !emailClient.sendEmail) {
        console.warn('⚠️  [NOTIFICATION SERVICE] Email client not available');
        return { success: false, reason: 'Email client not configured' };
    }
    
    try {
        // Compose subject and body
        const subject = composeMessage(settings.email.subject, data);
        const body = composeMessage(settings.email.template, data);
        
        console.log(`📤 [NOTIFICATION SERVICE] Sending Email to ${settings.email.address}`);
        
        // Send email
        await emailClient.sendEmail({
            to: settings.email.address,
            subject: subject,
            text: body,
            html: body.replace(/\n/g, '<br>')
        });
        
        console.log('✅ [NOTIFICATION SERVICE] Email sent successfully');
        
        return { 
            success: true,
            to: settings.email.address
        };
        
    } catch (error) {
        console.error('❌ [NOTIFICATION SERVICE] Failed to send Email:', error.message);
        return { 
            success: false, 
            reason: error.message 
        };
    }
}

// ============================================================================
// MAIN NOTIFICATION FUNCTION
// ============================================================================

/**
 * Send admin alert notification
 * 
 * @param {Object} data - Alert data
 * @param {string} data.companyId - Company ID
 * @param {string} data.companyName - Company name
 * @param {string} data.alertType - Alert type (missing_variables, error, etc.)
 * @param {string} data.severity - Severity (info, warning, error)
 * @param {string} data.message - Alert message
 * @param {string} data.fixUrl - URL to fix the issue
 */
async function sendAlert(data) {
    console.log(`🔔 [NOTIFICATION SERVICE] Alert received for ${data.companyName}`);
    
    try {
        // Get admin settings
        const settings = await AdminSettings.getSettings();
        
        // Check if we should notify for this alert type
        const shouldNotify = await AdminSettings.shouldNotify(data.alertType);
        
        if (!shouldNotify) {
            console.log(`⏭️  [NOTIFICATION SERVICE] Notifications disabled for alert type: ${data.alertType}`);
            return {
                success: true,
                reason: 'Alert type not configured for notifications',
                sms: null,
                email: null
            };
        }
        
        // Send SMS and Email in parallel (non-blocking)
        const [smsResult, emailResult] = await Promise.allSettled([
            sendSMS(settings, data),
            sendEmail(settings, data)
        ]);
        
        // Extract results
        const sms = smsResult.status === 'fulfilled' ? smsResult.value : { success: false, reason: smsResult.reason?.message };
        const email = emailResult.status === 'fulfilled' ? emailResult.value : { success: false, reason: emailResult.reason?.message };
        
        console.log('📋 [NOTIFICATION SERVICE] Notification summary:');
        console.log(`   SMS: ${sms.success ? '✅ Sent' : '❌ Failed'}`);
        console.log(`   Email: ${email.success ? '✅ Sent' : '❌ Failed'}`);
        
        return {
            success: true,
            sms,
            email
        };
        
    } catch (error) {
        console.error('❌ [NOTIFICATION SERVICE] Critical error:', error);
        
        // NEVER throw - notifications should never block the main application
        return {
            success: false,
            reason: error.message,
            sms: null,
            email: null
        };
    }
}

/**
 * Send test notification
 */
async function sendTestNotification(type = 'both') {
    console.log(`🧪 [NOTIFICATION SERVICE] Sending test notification (type: ${type})`);
    
    const testData = {
        companyId: 'test-123',
        companyName: 'Test Company',
        alertType: 'test',
        severity: 'info',
        message: 'This is a test notification from ClientsVia Alert Center',
        fixUrl: 'https://clientsvia.ai/index.html'
    };
    
    try {
        const settings = await AdminSettings.getSettings();
        
        let results = {};
        
        if (type === 'sms' || type === 'both') {
            results.sms = await sendSMS(settings, testData);
        }
        
        if (type === 'email' || type === 'both') {
            results.email = await sendEmail(settings, testData);
        }
        
        return {
            success: true,
            results
        };
        
    } catch (error) {
        console.error('❌ [NOTIFICATION SERVICE] Test notification failed:', error);
        return {
            success: false,
            reason: error.message
        };
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    sendAlert,
    sendTestNotification
};

