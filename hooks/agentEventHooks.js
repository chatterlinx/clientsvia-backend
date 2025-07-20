// hooks/agentEventHooks.js
// Enhanced Event Hook System for AI Agent Logic
// Spartan Coder - Gold Standard Implementation

const NotificationService = require('../services/notificationService');
const templates = require('../config/messageTemplates.json');
const smsClient = require('../clients/smsClient');
const emailClient = require('../clients/emailClient');

class AgentEventHooks {
  constructor() {
    this.notify = new NotificationService({
      smsClient,
      emailClient,
      templates
    });
    
    this.eventLog = [];
    this.enabled = true;
    this.maxLogSize = 1000;
  }

  /**
   * Log event for monitoring and analytics
   */
  logEvent(eventType, data, result) {
    const event = {
      timestamp: new Date().toISOString(),
      type: eventType,
      data: data,
      result: result,
      sessionId: data.sessionId || 'unknown'
    };

    this.eventLog.push(event);
    
    // Keep log size manageable
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog = this.eventLog.slice(-this.maxLogSize);
    }

    console.log(`[EventHooks] ${eventType}:`, result.success ? '✅' : '❌', result.message || result.error);
  }

  /**
   * Called after successful booking - ENHANCED
   * @param {object} booking - includes phone, email, appointmentTime, companyName, customerName
   */
  async onBookingConfirmed(booking) {
    if (!this.enabled) return { success: false, message: 'Event hooks disabled' };

    try {
      const data = {
        appointmentTime: booking.appointmentTime,
        companyName: booking.companyName,
        customerName: booking.customerName,
        name: booking.customerName,
        serviceType: booking.serviceType || 'Service',
        address: booking.address || 'Location TBD',
        phone: booking.companyPhone || 'Contact us',
        confirmationNumber: booking.confirmationNumber || 'N/A'
      };

      const results = [];

      // Send SMS if phone available
      if (booking.phone) {
        const smsResult = await this.notify.sendSMS(booking.phone, 'bookingConfirmation', data);
        results.push({ channel: 'sms', ...smsResult });
      }

      // Send email if email available
      if (booking.email) {
        const emailResult = await this.notify.sendEmail(
          booking.email, 
          'Booking Confirmed - ' + data.companyName, 
          'bookingConfirmation', 
          data
        );
        results.push({ channel: 'email', ...emailResult });
      }

      const successful = results.filter(r => r.success).length;
      const result = {
        success: successful > 0,
        message: `Booking confirmation sent via ${successful} channel(s)`,
        channels: results,
        booking: booking
      };

      this.logEvent('booking_confirmed', booking, result);
      return result;

    } catch (error) {
      const result = {
        success: false,
        error: error.message,
        booking: booking
      };
      
      this.logEvent('booking_confirmed', booking, result);
      return result;
    }
  }

  /**
   * Called when fallback message is needed - ENHANCED
   * @param {object} fallback - includes to, message, company info
   */
  async onFallbackMessage(fallback) {
    if (!this.enabled) return { success: false, message: 'Event hooks disabled' };

    try {
      const data = {
        message: fallback.message,
        customerMessage: fallback.message,
        companyName: fallback.companyName,
        recipientName: fallback.to?.name || 'Team Member',
        customerName: fallback.customerName || 'Customer',
        customerPhone: fallback.customerPhone || 'Unknown',
        timestamp: new Date().toLocaleString()
      };

      const results = [];

      // Send SMS if phone available
      if (fallback.to?.phone) {
        const smsResult = await this.notify.sendSMS(fallback.to.phone, 'fallbackMessage', data);
        results.push({ channel: 'sms', ...smsResult });
      }

      // Send email if email available
      if (fallback.to?.email) {
        const emailResult = await this.notify.sendEmail(
          fallback.to.email, 
          'Customer Message - ' + data.companyName, 
          'fallbackMessage', 
          data
        );
        results.push({ channel: 'email', ...emailResult });
      }

      const successful = results.filter(r => r.success).length;
      const result = {
        success: successful > 0,
        message: `Fallback message sent via ${successful} channel(s)`,
        channels: results,
        fallback: fallback
      };

      this.logEvent('fallback_message', fallback, result);
      return result;

    } catch (error) {
      const result = {
        success: false,
        error: error.message,
        fallback: fallback
      };
      
      this.logEvent('fallback_message', fallback, result);
      return result;
    }
  }

  /**
   * Called when transfer is completed - NEW ENHANCEMENT
   * @param {object} transfer - transfer details
   */
  async onTransferCompleted(transfer) {
    if (!this.enabled) return { success: false, message: 'Event hooks disabled' };

    try {
      // Log transfer for analytics
      const result = {
        success: true,
        message: 'Transfer completed successfully',
        transfer: transfer,
        timestamp: new Date().toISOString()
      };

      this.logEvent('transfer_completed', transfer, result);
      return result;

    } catch (error) {
      const result = {
        success: false,
        error: error.message,
        transfer: transfer
      };
      
      this.logEvent('transfer_completed', transfer, result);
      return result;
    }
  }

  /**
   * Called for emergency service requests - NEW ENHANCEMENT
   * @param {object} emergency - emergency details
   */
  async onEmergencyRequest(emergency) {
    if (!this.enabled) return { success: false, message: 'Event hooks disabled' };

    try {
      const data = {
        serviceType: emergency.serviceType || 'Emergency Service',
        address: emergency.address || 'Location provided by customer',
        customerName: emergency.customerName || 'Customer',
        customerPhone: emergency.customerPhone || 'Phone not provided',
        description: emergency.description || 'Emergency situation reported',
        timestamp: new Date().toLocaleString()
      };

      const results = [];

      // Send emergency alerts to all emergency contacts
      if (emergency.emergencyContacts) {
        for (const contact of emergency.emergencyContacts) {
          if (contact.phone) {
            const smsResult = await this.notify.sendSMS(contact.phone, 'emergencyAlert', data);
            results.push({ contact: contact.name, channel: 'sms', ...smsResult });
          }
          
          if (contact.email) {
            const emailResult = await this.notify.sendEmail(
              contact.email,
              'EMERGENCY SERVICE REQUEST',
              'emergencyAlert',
              data
            );
            results.push({ contact: contact.name, channel: 'email', ...emailResult });
          }
        }
      }

      const successful = results.filter(r => r.success).length;
      const result = {
        success: successful > 0,
        message: `Emergency alerts sent to ${successful} channel(s)`,
        priority: 'HIGH',
        channels: results,
        emergency: emergency
      };

      this.logEvent('emergency_request', emergency, result);
      return result;

    } catch (error) {
      const result = {
        success: false,
        error: error.message,
        priority: 'HIGH',
        emergency: emergency
      };
      
      this.logEvent('emergency_request', emergency, result);
      return result;
    }
  }

  /**
   * Get event statistics for monitoring
   */
  getEventStats(timeframe = '24h') {
    const now = new Date();
    const cutoff = new Date(now.getTime() - this.parseTimeframe(timeframe));
    
    const recentEvents = this.eventLog.filter(event => new Date(event.timestamp) >= cutoff);
    
    const stats = {
      total: recentEvents.length,
      successful: recentEvents.filter(e => e.result.success).length,
      failed: recentEvents.filter(e => !e.result.success).length,
      byType: {}
    };

    // Count by event type
    recentEvents.forEach(event => {
      stats.byType[event.type] = (stats.byType[event.type] || 0) + 1;
    });

    stats.successRate = stats.total > 0 ? (stats.successful / stats.total * 100).toFixed(2) : 0;

    return stats;
  }

  /**
   * Get recent events for monitoring dashboard
   */
  getRecentEvents(limit = 10) {
    return this.eventLog
      .slice(-limit)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  /**
   * Enable/disable event hooks
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    console.log(`[EventHooks] Event hooks ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Clear event log
   */
  clearEventLog() {
    this.eventLog = [];
    console.log('[EventHooks] Event log cleared');
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
}

// Create singleton instance
const agentEventHooks = new AgentEventHooks();

// Export both class and instance for flexibility
module.exports = {
  AgentEventHooks,
  agentEventHooks,
  // Legacy exports for backward compatibility
  onBookingConfirmed: agentEventHooks.onBookingConfirmed.bind(agentEventHooks),
  onFallbackMessage: agentEventHooks.onFallbackMessage.bind(agentEventHooks),
  onTransferCompleted: agentEventHooks.onTransferCompleted.bind(agentEventHooks),
  onEmergencyRequest: agentEventHooks.onEmergencyRequest.bind(agentEventHooks)
};
