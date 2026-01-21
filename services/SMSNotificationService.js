/**
 * ════════════════════════════════════════════════════════════════════════════════
 * SMS NOTIFICATION SERVICE - V88 (Jan 2026)
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * Handles booking confirmation SMS and appointment reminders.
 * Uses company-specific Twilio credentials and UI-configurable templates.
 * 
 * FEATURES:
 * - Immediate confirmation SMS on booking complete
 * - Scheduled reminders (24h, 1h before, day-of)
 * - Template variable substitution ({customerName}, {appointmentTime}, etc.)
 * - Quiet hours enforcement
 * - Reply keyword handling (C=confirm, R=reschedule)
 * - Short URL generation for reschedule/cancel links
 * 
 * USAGE:
 *   await SMSNotificationService.sendBookingConfirmation(companyId, booking);
 *   await SMSNotificationService.scheduleReminders(companyId, booking);
 *   await SMSNotificationService.processScheduledMessages(); // Called by job
 * 
 * ════════════════════════════════════════════════════════════════════════════════
 */

const logger = require('../utils/logger');
const smsClient = require('../clients/smsClient');
const emailClient = require('../clients/emailClient');
const v2Company = require('../models/v2Company');
const ScheduledSMS = require('../models/ScheduledSMS');
const BookingRequest = require('../models/BookingRequest');

// ════════════════════════════════════════════════════════════════════════════════
// EMAIL-TO-SMS CARRIER GATEWAYS
// ════════════════════════════════════════════════════════════════════════════════
// When Twilio A2P isn't set up, we can send SMS via email-to-SMS gateways

const CARRIER_GATEWAYS = {
    'verizon': 'vtext.com',
    'att': 'txt.att.net',
    'tmobile': 'tmomail.net',
    'sprint': 'messaging.sprintpcs.com',
    'uscellular': 'email.uscc.net',
    'metropcs': 'mymetropcs.com',
    'boost': 'sms.myboostmobile.com',
    'cricket': 'sms.cricketwireless.net',
    'virgin': 'vmobl.com',
    'google_fi': 'msg.fi.google.com'
};

/**
 * Send SMS via email-to-SMS gateway (fallback when Twilio isn't available)
 * @param {string} phone - Phone number (10 digits)
 * @param {string} message - SMS message
 * @param {string} carrier - Carrier name (verizon, att, tmobile, etc.)
 * @returns {Object} { success, method, error? }
 */
async function sendViaEmailGateway(phone, message, carrier = 'verizon') {
    const log = (msg, data = {}) => logger.info(`[SMS VIA EMAIL] ${msg}`, data);
    
    try {
        // Normalize phone to 10 digits
        const digits = phone.replace(/\D/g, '');
        const phone10 = digits.length === 11 && digits.startsWith('1') 
            ? digits.substring(1) 
            : digits;
        
        if (phone10.length !== 10) {
            return { success: false, error: `Invalid phone number: ${phone}` };
        }
        
        // Get gateway domain
        const gateway = CARRIER_GATEWAYS[carrier.toLowerCase()];
        if (!gateway) {
            return { success: false, error: `Unknown carrier: ${carrier}. Use: ${Object.keys(CARRIER_GATEWAYS).join(', ')}` };
        }
        
        // Build email address
        const emailAddress = `${phone10}@${gateway}`;
        
        log('Sending via email gateway', { 
            phone: phone10.substring(0, 6) + '****',
            carrier,
            gateway 
        });
        
        // Send via email client
        // SMS via email should be plain text, no HTML, and short subject
        const result = await emailClient.send({
            to: emailAddress,
            subject: 'SMS', // Carriers may ignore or include subject
            body: message.substring(0, 160) // SMS character limit
        });
        
        if (result.success) {
            log('✅ Sent via email gateway', { 
                messageId: result.messageId,
                carrier 
            });
            return { 
                success: true, 
                method: 'email_gateway',
                carrier,
                messageId: result.messageId 
            };
        } else {
            return { success: false, error: result.error };
        }
        
    } catch (err) {
        logger.error('[SMS VIA EMAIL] ❌ Failed', { error: err.message });
        return { success: false, error: err.message };
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// TEMPLATE PLACEHOLDERS
// ════════════════════════════════════════════════════════════════════════════════

// Chat link base URL
const CHAT_BASE_URL = process.env.CHAT_BASE_URL || 'https://cv-backend-va.onrender.com/customer-chat.html';

const PLACEHOLDERS = {
    '{customerName}': (data) => data.customerName || 'Valued Customer',
    '{customerFirstName}': (data) => data.customerName?.split(' ')[0] || 'there',
    '{customerPhone}': (data) => data.customerPhone || '',
    '{customerAddress}': (data) => data.customerAddress || 'your location',
    '{companyName}': (data) => data.companyName || 'Our Company',
    '{companyPhone}': (data) => data.companyPhone || '',
    '{appointmentTime}': (data) => formatAppointmentTime(data.appointmentTime),
    '{appointmentDate}': (data) => formatAppointmentDate(data.appointmentTime),
    '{serviceType}': (data) => data.serviceType || 'service',
    '{technicianName}': (data) => data.technicianName || 'our technician',
    '{eta}': (data) => data.eta || '30',
    '{rescheduleLink}': (data) => data.rescheduleLink || '',
    '{cancelLink}': (data) => data.cancelLink || '',
    '{bookingId}': (data) => data.bookingId || '',
    // V89: Chat link for customer web chat (includes booking ID for context)
    '{chatLink}': (data) => {
        if (!data.companyId) return '';
        let url = `${CHAT_BASE_URL}?c=${data.companyId}`;
        // Include booking ID so AI knows who's chatting
        if (data.bookingId) url += `&b=${data.bookingId}`;
        return url;
    }
};

/**
 * Format appointment time for SMS (e.g., "Tuesday at 2:00 PM")
 */
function formatAppointmentTime(dateInput) {
    if (!dateInput) return 'your scheduled time';
    
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return 'your scheduled time';
    
    const options = {
        weekday: 'long',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    };
    
    return date.toLocaleString('en-US', options);
}

/**
 * Format appointment date for SMS (e.g., "January 22")
 */
function formatAppointmentDate(dateInput) {
    if (!dateInput) return 'your appointment date';
    
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return 'your appointment date';
    
    const options = {
        month: 'long',
        day: 'numeric'
    };
    
    return date.toLocaleString('en-US', options);
}

/**
 * Substitute placeholders in template
 */
function populateTemplate(template, data) {
    let result = template;
    
    for (const [placeholder, resolver] of Object.entries(PLACEHOLDERS)) {
        const value = resolver(data);
        result = result.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
    }
    
    return result;
}

// ════════════════════════════════════════════════════════════════════════════════
// QUIET HOURS CHECK
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Check if current time is within quiet hours
 * @param {Object} quietHours - { enabled, startTime: "21:00", endTime: "08:00" }
 * @param {string} timezone - Company timezone
 */
function isQuietHours(quietHours, timezone = 'America/New_York') {
    if (!quietHours?.enabled) return false;
    
    const now = new Date();
    const currentHour = parseInt(now.toLocaleString('en-US', { 
        hour: 'numeric', 
        hour12: false, 
        timeZone: timezone 
    }));
    const currentMinute = parseInt(now.toLocaleString('en-US', { 
        minute: 'numeric', 
        timeZone: timezone 
    }));
    
    const currentTime = currentHour * 60 + currentMinute;
    
    const [startH, startM] = (quietHours.startTime || '21:00').split(':').map(Number);
    const [endH, endM] = (quietHours.endTime || '08:00').split(':').map(Number);
    
    const startTime = startH * 60 + startM;
    const endTime = endH * 60 + endM;
    
    // Handle overnight quiet hours (e.g., 21:00 - 08:00)
    if (startTime > endTime) {
        return currentTime >= startTime || currentTime < endTime;
    }
    
    return currentTime >= startTime && currentTime < endTime;
}

/**
 * Get next time outside quiet hours
 */
function getNextSendTime(quietHours, timezone = 'America/New_York') {
    if (!quietHours?.enabled) return new Date();
    
    const [endH, endM] = (quietHours.endTime || '08:00').split(':').map(Number);
    
    const nextSend = new Date();
    nextSend.setHours(endH, endM, 0, 0);
    
    // If end time already passed today, schedule for tomorrow
    if (nextSend <= new Date()) {
        nextSend.setDate(nextSend.getDate() + 1);
    }
    
    return nextSend;
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN SERVICE FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Send booking confirmation SMS immediately
 * @param {string} companyId
 * @param {Object} booking - BookingRequest document or data
 * @returns {Object} { success, messageId?, error? }
 */
async function sendBookingConfirmation(companyId, booking) {
    const log = (msg, data = {}) => logger.info(`[SMS NOTIFICATION] ${msg}`, data);
    
    try {
        // Load company with SMS settings
        const company = await v2Company.findById(companyId).lean();
        if (!company) {
            return { success: false, error: 'Company not found' };
        }
        
        const smsConfig = company.smsNotifications || {};
        
        // Check if SMS notifications are enabled
        if (!smsConfig.enabled) {
            log('SMS notifications disabled for company', { companyId });
            return { success: false, error: 'SMS notifications disabled', skipped: true };
        }
        
        // Check if confirmation SMS is enabled
        if (!smsConfig.confirmation?.enabled) {
            log('Confirmation SMS disabled', { companyId });
            return { success: false, error: 'Confirmation SMS disabled', skipped: true };
        }
        
        // Get customer phone
        const customerPhone = booking.slots?.phone || 
                             booking.callerPhone || 
                             booking.customerPhone;
        
        if (!customerPhone) {
            return { success: false, error: 'No customer phone number' };
        }
        
        // Check quiet hours
        const timezone = company.timezone || 'America/New_York';
        if (isQuietHours(smsConfig.quietHours, timezone)) {
            log('Quiet hours - scheduling for later', { companyId });
            
            // Schedule for when quiet hours end
            const scheduledFor = getNextSendTime(smsConfig.quietHours, timezone);
            
            await scheduleMessage({
                companyId,
                bookingId: booking._id,
                type: 'confirmation',
                toPhone: customerPhone,
                toName: booking.slots?.name?.full || booking.customerName,
                template: smsConfig.confirmation.template,
                scheduledFor,
                appointmentTime: booking.calendarEventStart || booking.slots?.time?.confirmedSlot,
                data: buildTemplateData(company, booking)
            });
            
            return { success: true, scheduled: true, scheduledFor };
        }
        
        // Build message from template
        const templateData = buildTemplateData(company, booking);
        const message = populateTemplate(smsConfig.confirmation.template, templateData);
        
        log('Sending confirmation SMS', {
            companyId,
            bookingId: booking._id?.toString(),
            phone: customerPhone.substring(0, 6) + '***'
        });
        
        // Send via SMS client
        const result = await smsClient.sendWithCompany({
            to: customerPhone,
            body: message,
            company
        });
        
        if (result.success) {
            log('✅ Confirmation SMS sent', { messageId: result.messageId });
            
            // Update booking with SMS info
            if (booking._id) {
                await BookingRequest.updateOne(
                    { _id: booking._id },
                    { 
                        $set: { 
                            'smsConfirmation.sent': true,
                            'smsConfirmation.sentAt': new Date(),
                            'smsConfirmation.messageId': result.messageId
                        }
                    }
                );
            }
        }
        
        return result;
        
    } catch (err) {
        logger.error('[SMS NOTIFICATION] ❌ Confirmation failed', {
            companyId,
            error: err.message,
            stack: err.stack
        });
        return { success: false, error: err.message };
    }
}

/**
 * Schedule reminder SMS messages for a booking
 * @param {string} companyId
 * @param {Object} booking - BookingRequest document
 */
async function scheduleReminders(companyId, booking) {
    const log = (msg, data = {}) => logger.info(`[SMS NOTIFICATION] ${msg}`, data);
    
    try {
        const company = await v2Company.findById(companyId).lean();
        if (!company) {
            return { success: false, error: 'Company not found' };
        }
        
        const smsConfig = company.smsNotifications || {};
        
        if (!smsConfig.enabled) {
            return { success: false, error: 'SMS notifications disabled', skipped: true };
        }
        
        // Get appointment time
        const appointmentTime = booking.calendarEventStart || 
                               booking.slots?.time?.confirmedSlot;
        
        if (!appointmentTime) {
            log('No appointment time - cannot schedule reminders', { bookingId: booking._id });
            return { success: false, error: 'No appointment time' };
        }
        
        const appointmentDate = new Date(appointmentTime);
        const customerPhone = booking.slots?.phone || booking.callerPhone;
        
        if (!customerPhone) {
            return { success: false, error: 'No customer phone' };
        }
        
        const templateData = buildTemplateData(company, booking);
        const scheduled = [];
        
        // 24-hour reminder
        if (smsConfig.reminder24h?.enabled) {
            const reminder24hTime = new Date(appointmentDate.getTime() - 24 * 60 * 60 * 1000);
            
            if (reminder24hTime > new Date()) {
                await scheduleMessage({
                    companyId,
                    bookingId: booking._id,
                    type: 'reminder_24h',
                    toPhone: customerPhone,
                    toName: booking.slots?.name?.full,
                    template: smsConfig.reminder24h.template,
                    scheduledFor: reminder24hTime,
                    appointmentTime: appointmentDate,
                    data: templateData
                });
                scheduled.push('reminder_24h');
            }
        }
        
        // 1-hour reminder
        if (smsConfig.reminder1h?.enabled) {
            const reminder1hTime = new Date(appointmentDate.getTime() - 60 * 60 * 1000);
            
            if (reminder1hTime > new Date()) {
                await scheduleMessage({
                    companyId,
                    bookingId: booking._id,
                    type: 'reminder_1h',
                    toPhone: customerPhone,
                    toName: booking.slots?.name?.full,
                    template: smsConfig.reminder1h.template,
                    scheduledFor: reminder1hTime,
                    appointmentTime: appointmentDate,
                    data: templateData
                });
                scheduled.push('reminder_1h');
            }
        }
        
        // Day-of reminder (morning)
        if (smsConfig.reminderDayOf?.enabled) {
            const dayOfDate = new Date(appointmentDate);
            const [sendH, sendM] = (smsConfig.reminderDayOf.sendTime || '08:00').split(':').map(Number);
            dayOfDate.setHours(sendH, sendM, 0, 0);
            
            if (dayOfDate > new Date() && dayOfDate < appointmentDate) {
                await scheduleMessage({
                    companyId,
                    bookingId: booking._id,
                    type: 'reminder_day_of',
                    toPhone: customerPhone,
                    toName: booking.slots?.name?.full,
                    template: smsConfig.reminderDayOf.template,
                    scheduledFor: dayOfDate,
                    appointmentTime: appointmentDate,
                    data: templateData
                });
                scheduled.push('reminder_day_of');
            }
        }
        
        log('✅ Reminders scheduled', { 
            bookingId: booking._id?.toString(), 
            scheduled 
        });
        
        return { success: true, scheduled };
        
    } catch (err) {
        logger.error('[SMS NOTIFICATION] ❌ Schedule reminders failed', {
            companyId,
            error: err.message
        });
        return { success: false, error: err.message };
    }
}

/**
 * Schedule a single SMS message
 */
async function scheduleMessage({ 
    companyId, 
    bookingId, 
    type, 
    toPhone, 
    toName, 
    template, 
    scheduledFor, 
    appointmentTime,
    data 
}) {
    const message = populateTemplate(template, data);
    
    const sms = new ScheduledSMS({
        companyId,
        bookingId,
        type,
        toPhone,
        toName,
        message,
        templateUsed: template,
        placeholdersUsed: data,
        scheduledFor,
        appointmentTime
    });
    
    await sms.save();
    
    logger.info('[SMS NOTIFICATION] 📅 Message scheduled', {
        type,
        scheduledFor: scheduledFor.toISOString(),
        bookingId: bookingId?.toString()
    });
    
    return sms;
}

/**
 * Process all due scheduled messages (called by job runner)
 */
async function processScheduledMessages() {
    const log = (msg, data = {}) => logger.info(`[SMS JOB] ${msg}`, data);
    
    try {
        // Find due messages
        const dueMessages = await ScheduledSMS.findDue(100);
        
        if (dueMessages.length === 0) {
            return { processed: 0 };
        }
        
        log(`Processing ${dueMessages.length} due messages`);
        
        let sent = 0;
        let failed = 0;
        
        for (const sms of dueMessages) {
            try {
                const company = sms.companyId;
                
                if (!company) {
                    await sms.markFailed('Company not found');
                    failed++;
                    continue;
                }
                
                // Check quiet hours
                const smsConfig = company.smsNotifications || {};
                const timezone = company.timezone || 'America/New_York';
                
                if (isQuietHours(smsConfig.quietHours, timezone)) {
                    // Reschedule for when quiet hours end
                    sms.scheduledFor = getNextSendTime(smsConfig.quietHours, timezone);
                    await sms.save();
                    log('Rescheduled due to quiet hours', { 
                        smsId: sms._id, 
                        newTime: sms.scheduledFor 
                    });
                    continue;
                }
                
                // Send the message
                const result = await smsClient.sendWithCompany({
                    to: sms.toPhone,
                    body: sms.message,
                    company
                });
                
                if (result.success) {
                    await sms.markSent(result.messageId);
                    sent++;
                    log('✅ Sent', { smsId: sms._id, type: sms.type });
                } else {
                    await sms.markFailed(result.error);
                    failed++;
                    log('❌ Failed', { smsId: sms._id, error: result.error });
                }
                
            } catch (err) {
                await sms.markFailed(err.message);
                failed++;
                logger.error('[SMS JOB] Message processing error', { 
                    smsId: sms._id, 
                    error: err.message 
                });
            }
        }
        
        log(`Job complete: ${sent} sent, ${failed} failed`);
        
        return { processed: dueMessages.length, sent, failed };
        
    } catch (err) {
        logger.error('[SMS JOB] ❌ Job failed', { error: err.message });
        return { processed: 0, error: err.message };
    }
}

/**
 * Cancel all pending reminders for a booking
 */
async function cancelReminders(bookingId, reason = 'Booking cancelled') {
    return ScheduledSMS.cancelForBooking(bookingId, reason);
}

/**
 * Handle incoming SMS reply
 * @param {string} fromPhone - Customer phone
 * @param {string} body - Message body
 * @param {string} companyId - Company ID
 */
async function handleIncomingReply(fromPhone, body, companyId) {
    const log = (msg, data = {}) => logger.info(`[SMS REPLY] ${msg}`, data);
    
    try {
        const company = await v2Company.findById(companyId).lean();
        if (!company) return { handled: false };
        
        const replyConfig = company.smsNotifications?.replyHandling;
        if (!replyConfig?.enabled) return { handled: false };
        
        const bodyUpper = body.toUpperCase().trim();
        
        // Check for confirm keywords
        if (replyConfig.confirmKeywords?.some(k => bodyUpper === k.toUpperCase())) {
            log('Confirm keyword detected', { fromPhone, body });
            
            const response = populateTemplate(replyConfig.confirmResponse, {
                companyName: company.companyName,
                companyPhone: company.companyPhone
            });
            
            await smsClient.sendWithCompany({
                to: fromPhone,
                body: response,
                company
            });
            
            return { handled: true, action: 'confirm', response };
        }
        
        // Check for reschedule keywords
        if (replyConfig.rescheduleKeywords?.some(k => bodyUpper === k.toUpperCase())) {
            log('Reschedule keyword detected', { fromPhone, body });
            
            const response = populateTemplate(replyConfig.rescheduleResponse, {
                companyName: company.companyName,
                companyPhone: company.companyPhone
            });
            
            await smsClient.sendWithCompany({
                to: fromPhone,
                body: response,
                company
            });
            
            return { handled: true, action: 'reschedule', response };
        }
        
        // Check for cancel keywords
        if (replyConfig.cancelKeywords?.some(k => bodyUpper === k.toUpperCase())) {
            log('Cancel keyword detected', { fromPhone, body });
            
            // Find and cancel the booking
            // TODO: Implement actual booking cancellation
            
            const response = populateTemplate(replyConfig.cancelResponse, {
                companyName: company.companyName,
                companyPhone: company.companyPhone
            });
            
            await smsClient.sendWithCompany({
                to: fromPhone,
                body: response,
                company
            });
            
            return { handled: true, action: 'cancel', response };
        }
        
        return { handled: false };
        
    } catch (err) {
        logger.error('[SMS REPLY] Error handling reply', { 
            fromPhone, 
            error: err.message 
        });
        return { handled: false, error: err.message };
    }
}

/**
 * Build template data from company and booking
 */
function buildTemplateData(company, booking) {
    return {
        customerName: booking.slots?.name?.full || 
                     `${booking.slots?.name?.first || ''} ${booking.slots?.name?.last || ''}`.trim() ||
                     'Valued Customer',
        customerPhone: booking.slots?.phone || booking.callerPhone || '',
        customerAddress: booking.slots?.address?.full || booking.slots?.address || '',
        companyName: company.companyName || 'Our Company',
        companyPhone: company.companyPhone || company.businessPhone || '',
        appointmentTime: booking.calendarEventStart || booking.slots?.time?.confirmedSlot || booking.slots?.time,
        serviceType: booking.serviceType || booking.issue || 'service',
        bookingId: booking._id?.toString() || '',
        // V89: Include companyId for chat link placeholder
        companyId: company._id?.toString() || ''
    };
}

/**
 * Get SMS notification stats for a company
 */
async function getStats(companyId, days = 30) {
    return ScheduledSMS.getStats(companyId, days);
}

/**
 * Get pending messages for a company
 */
async function getPendingMessages(companyId, limit = 50) {
    return ScheduledSMS.find({
        companyId,
        status: 'pending'
    })
    .sort({ scheduledFor: 1 })
    .limit(limit)
    .populate('bookingId', 'slots caseId');
}

// ════════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Quick test: Send SMS via email gateway
 * Use this when Twilio A2P isn't set up yet
 */
async function sendTestViaEmail(phone, message, carrier = 'verizon') {
    return sendViaEmailGateway(phone, message, carrier);
}

module.exports = {
    // Sending
    sendBookingConfirmation,
    scheduleReminders,
    processScheduledMessages,
    cancelReminders,
    
    // Reply handling
    handleIncomingReply,
    
    // Utilities
    populateTemplate,
    isQuietHours,
    
    // Stats
    getStats,
    getPendingMessages,
    
    // Email-to-SMS fallback (when Twilio A2P not ready)
    sendViaEmailGateway,
    sendTestViaEmail,
    CARRIER_GATEWAYS
};
