// hooks/agentEventHooks.js
// Enhanced Event Hook System for AI Agent Logic
// Spartan Coder - Gold Standard Implementation

// V2 DELETED: NotificationService not in V2 system
// const NotificationService = require('../services/notificationService');
const NotificationLog = require('../models/v2NotificationLog');
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
  async logEvent(eventType, data, result) {
    const startTime = Date.now();
    
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

    // Log event to database for AI Agent Logic analytics
    try {
      // Ensure we have company context for AI Agent Logic isolation
      const companyId = data.companyId || process.env.DEFAULT_COMPANY_ID || null;
      if (!companyId) {
        console.warn('[AI-AGENT-LOGIC] No company ID available for event hook logging');
      }
      
      const endTime = Date.now();
      
      // Create a comprehensive notification log for the event hook execution
      await NotificationLog.create({
        type: 'event_hook',
        recipient: data.phone || data.email || data.customerName || 'system',
        subject: `AI Agent Event: ${eventType}`,
        message: result.message || result.error || 'AI Agent event hook executed',
        templateKey: eventType,
        status: result.success ? 'completed' : 'failed',
        errorMessage: result.success ? null : (result.error || 'Unknown error'),
        metadata: {
          eventData: data,
          result: result,
          eventType: eventType,
          channels: result.channels || [],
          fromAgent: true, // Always true for AI Agent Logic
          companyId: companyId,
          sessionId: data.sessionId || `event_${Date.now()}`,
          traceId: data.traceId || `trace_${Date.now()}`
        },
        aiAgentContext: {
          source: 'agent_event_hooks',
          eventType: eventType,
          processingTime: endTime - startTime,
          success: result.success,
          sessionId: data.sessionId || `event_${Date.now()}`,
          conversationStep: data.conversationStep || 'event_execution',
          confidenceScore: data.confidenceScore || null,
          intentDetected: data.intentDetected || null
        }
      });
    } catch (error) {
      console.error('[AI-AGENT-LOGIC] Failed to log event to database:', error);
      // Don't fail the event hook if logging fails
    }
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

      await this.logEvent('booking_confirmed', booking, result);
      return result;

    } catch (error) {
      const result = {
        success: false,
        error: error.message,
        booking: booking
      };
      
      await this.logEvent('booking_confirmed', booking, result);
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

      await this.logEvent('fallback_message', fallback, result);
      return result;

    } catch (error) {
      const result = {
        success: false,
        error: error.message,
        fallback: fallback
      };
      
      await this.logEvent('fallback_message', fallback, result);
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

      await this.logEvent('transfer_completed', transfer, result);
      return result;

    } catch (error) {
      const result = {
        success: false,
        error: error.message,
        transfer: transfer
      };
      
      await this.logEvent('transfer_completed', transfer, result);
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

      await this.logEvent('emergency_request', emergency, result);
      return result;

    } catch (error) {
      const result = {
        success: false,
        error: error.message,
        priority: 'HIGH',
        emergency: emergency
      };
      
      await this.logEvent('emergency_request', emergency, result);
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
   * Clear recent events only
   */
  clearRecentEvents(companyId) {
    this.eventLog = this.eventLog.filter(event => 
      new Date(event.timestamp) < new Date(Date.now() - 24 * 60 * 60 * 1000) // Keep events older than 24 hours
    );
    console.log(`[EventHooks] Recent events cleared for company ${companyId}`);
  }

  /**
   * Clear all analytics data
   */
  clearAllAnalytics(companyId) {
    this.eventLog = [];
    console.log(`[EventHooks] All analytics data cleared for company ${companyId}`);
  }

  /**
   * Reset to default configuration
   */
  resetToDefaults(companyId) {
    this.eventLog = [];
    this.enabled = true;
    this.maxLogSize = 1000;
    console.log(`[EventHooks] Reset to defaults for company ${companyId}`);
  }

  /**
   * Get hooks configuration for a company
   */
  getHooks(companyId) {
    return {
      bookingConfirmed: { enabled: this.enabled, priority: 'high' },
      fallbackMessage: { enabled: this.enabled, priority: 'medium' },
      emergencyRequest: { enabled: this.enabled, priority: 'critical' },
      transferCompleted: { enabled: this.enabled, priority: 'low' }
    };
  }

  /**
   * Register a hook for an event type
   */
  registerHook(companyId, eventType, config) {
    console.log(`[EventHooks] Registered hook for ${eventType} (company: ${companyId})`);
    // In a real implementation, this would save to database
  }

  /**
   * Unregister a hook
   */
  unregisterHook(companyId, eventType) {
    console.log(`[EventHooks] Unregistered hook for ${eventType} (company: ${companyId})`);
    // In a real implementation, this would remove from database
  }

  /**
   * Trigger an event hook
   */
  async triggerEvent(eventType, eventData) {
    switch (eventType) {
      case 'booking_confirmed':
        return await this.onBookingConfirmed(eventData);
      case 'fallback_triggered':
        return await this.onFallbackMessage(eventData);
      case 'emergency_alert':
        return await this.onEmergencyRequest(eventData);
      case 'transfer_completed':
        return await this.onTransferCompleted(eventData);
      default:
        return { success: false, error: `Unknown event type: ${eventType}` };
    }
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
   * Get analytics data for a company
   */
  getAnalytics(companyId) {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    // Filter events for the company and last 24 hours
    const recentEvents = this.eventLog.filter(event => 
      event.timestamp >= last24h.toISOString()
    );
    
    const successfulEvents = recentEvents.filter(event => event.result?.success).length;
    const failedEvents = recentEvents.filter(event => !event.result?.success).length;
    const totalEvents = recentEvents.length;
    
    // Count by event type
    const eventsByType = {};
    recentEvents.forEach(event => {
      eventsByType[event.type] = (eventsByType[event.type] || 0) + 1;
    });
    
    return {
      totalEvents,
      successfulEvents,
      failedEvents,
      successRate: totalEvents > 0 ? Math.round((successfulEvents / totalEvents) * 100) : 0,
      eventsByType,
      recentEvents: recentEvents.slice(-10).map(event => ({
        timestamp: event.timestamp,
        eventType: event.type,
        status: event.result?.success ? 'success' : 'failed',
        error: event.result?.error || '',
        details: event.result?.message || ''
      })),
      bookingEvents: eventsByType.booking_confirmed || 0,
      fallbackEvents: eventsByType.fallback_triggered || 0,
      emergencyEvents: eventsByType.emergency_alert || 0,
      transferEvents: eventsByType.transfer_completed || 0
    };
  }

  /**
   * Get AI Agent Logic specific analytics from database
   */
  async getAIAgentAnalytics(timeframe = '24h') {
    try {
      const hours = this.parseTimeframe(timeframe) / (1000 * 60 * 60);
      const since = new Date(Date.now() - hours * 60 * 60 * 1000);
      
      // Use NotificationLog analytics methods
      const [
        totalStats,
        eventBreakdown,
        performanceMetrics,
        recentActivity
      ] = await Promise.all([
        NotificationLog.getAIAgentStats(since),
        NotificationLog.getEventBreakdown(since),
        NotificationLog.getPerformanceMetrics(since),
        NotificationLog.find({
          'aiAgentContext.source': { $in: ['agent_event_hooks', 'notification_service'] },
          createdAt: { $gte: since }
        })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean()
      ]);

      return {
        timeframe,
        totalStats,
        eventBreakdown,
        performanceMetrics,
        recentActivity: recentActivity.map(log => ({
          timestamp: log.createdAt,
          type: log.type,
          eventType: log.templateKey,
          status: log.status,
          recipient: log.recipient,
          success: log.status === 'sent' || log.status === 'completed',
          processingTime: log.aiAgentContext?.processingTime || 0,
          source: log.aiAgentContext?.source || 'unknown'
        })),
        summary: {
          totalNotifications: totalStats.totalNotifications,
          successRate: totalStats.successRate,
          avgProcessingTime: performanceMetrics.avgProcessingTime,
          mostActiveEvent: eventBreakdown[0]?.eventType || 'none',
          emergencyAlerts: eventBreakdown.find(e => e.eventType === 'emergency_request')?.count || 0
        }
      };
    } catch (error) {
      console.error('Error getting AI Agent analytics:', error);
      return { error: error.message };
    }
  }

  /**
   * Get notification delivery analytics for AI Agent Logic tab
   */
  async getDeliveryAnalytics(timeframe = '24h') {
    try {
      const hours = this.parseTimeframe(timeframe) / (1000 * 60 * 60);
      const since = new Date(Date.now() - hours * 60 * 60 * 1000);
      
      const pipeline = [
        {
          $match: {
            'metadata.fromAgent': true,
            createdAt: { $gte: since }
          }
        },
        {
          $group: {
            _id: {
              type: '$type',
              status: '$status'
            },
            count: { $sum: 1 },
            avgProcessingTime: { $avg: '$aiAgentContext.processingTime' }
          }
        }
      ];

      const results = await NotificationLog.aggregate(pipeline);
      
      const analytics = {
        sms: { sent: 0, failed: 0, pending: 0, avgTime: 0 },
        email: { sent: 0, failed: 0, pending: 0, avgTime: 0 },
        event_hook: { completed: 0, failed: 0, pending: 0, avgTime: 0 }
      };

      results.forEach(result => {
        const { type, status } = result._id;
        if (analytics[type]) {
          analytics[type][status] = result.count;
          analytics[type].avgTime = Math.round(result.avgProcessingTime || 0);
        }
      });

      return {
        timeframe,
        channels: analytics,
        total: {
          sent: analytics.sms.sent + analytics.email.sent + analytics.event_hook.completed,
          failed: analytics.sms.failed + analytics.email.failed + analytics.event_hook.failed,
          pending: analytics.sms.pending + analytics.email.pending + analytics.event_hook.pending
        }
      };
    } catch (error) {
      console.error('Error getting delivery analytics:', error);
      return { error: error.message };
    }
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
