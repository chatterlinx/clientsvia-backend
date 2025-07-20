// examples/transfer-with-notifications.js
// Example: Integrating transfer router with notifications

const moment = require('moment');
const NotificationIntegration = require('../services/notificationIntegration');
const TransferRouter = require('../services/transferRouter');
const fs = require('fs');

class TransferWithNotifications {
  constructor(options = {}) {
    // Load personnel configuration
    const personnelConfig = JSON.parse(
      fs.readFileSync('./config/personnelConfig.json', 'utf8')
    );

    // Initialize notification integration
    this.notifications = new NotificationIntegration({
      companyInfo: {
        name: 'ServicePro Solutions',
        phone: '555-SERVICE',
        email: 'dispatch@servicepro.com',
        website: 'www.servicepro.com'
      },
      ...options
    });

    // Initialize transfer router with notifications
    this.transferRouter = new TransferRouter(personnelConfig);
  }

  /**
   * Process incoming call with automatic routing and notifications
   */
  async processIncomingCall(callData) {
    console.log('📞 Processing incoming call...');
    console.log(`   From: ${callData.customerPhone}`);
    console.log(`   Intent: ${callData.intent}`);
    
    try {
      // Route the call using the correct interface
      const routingResult = this.transferRouter.findBestTransferOption(
        `${callData.intent} ${callData.description || ''}`,
        moment()
      );

      console.log(`📞 Routing result: ${routingResult.type}`);
      console.log(`📞 Message: ${routingResult.message}`);

      if (routingResult.target) {
        console.log(`✅ Assigned to: ${routingResult.target.name}`);
        
        // Send notification to assigned personnel
        await this.notifyAssignedPersonnel(routingResult.target, callData);
        
        // Send notifications to backup if it's an emergency
        if (callData.priority === 'emergency') {
          const available = this.transferRouter.getAvailablePersonnel();
          const backupPersonnel = available.filter(p => p.name !== routingResult.target.name);
          if (backupPersonnel.length > 0) {
            await this.notifyBackupPersonnel(backupPersonnel, callData);
          }
        }
        
        // Send confirmation to customer if requested
        if (callData.sendConfirmation) {
          await this.sendCustomerConfirmation(callData, routingResult.target);
        }
        
        return {
          success: true,
          routedTo: routingResult.target,
          notificationsSent: true,
          type: routingResult.type
        };
        
      } else {
        console.log('❌ No personnel available');
        
        // Send fallback notification to all available personnel
        await this.sendFallbackNotifications(callData);
        
        return {
          success: false,
          reason: 'No personnel available',
          fallbackSent: true
        };
      }
      
    } catch (error) {
      console.error('❌ Call processing failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Notify assigned personnel about the incoming call
   */
  async notifyAssignedPersonnel(personnel, callData) {
    const contact = {
      phone: personnel.phone,
      email: personnel.email
    };

    if (callData.intent.includes('emergency')) {
      // Send emergency alert
      await this.notifications.sendEmergencyAlert(contact, {
        serviceType: callData.serviceType || 'Emergency Service',
        address: callData.address || 'Address not provided',
        customerPhone: callData.customerPhone,
        description: callData.description || 'Emergency assistance needed'
      });
    } else if (callData.intent.includes('quote')) {
      // Send quote request
      await this.notifications.sendQuoteRequest(contact, {
        customerName: callData.customerName || 'Customer',
        customerPhone: callData.customerPhone,
        customerEmail: callData.customerEmail || 'Not provided',
        serviceType: callData.serviceType || 'Service Request',
        address: callData.address || 'Address not provided',
        description: callData.description || 'Quote requested',
        urgency: callData.priority || 'Standard'
      });
    } else {
      // Send general message
      await this.notifications.sendCustomMessage(contact, {
        recipientName: personnel.name,
        message: `${callData.intent}: ${callData.description || 'Customer needs assistance'}`,
        senderName: callData.customerName || 'Customer',
        senderPhone: callData.customerPhone,
        options: { preferSMS: true }
      });
    }

    console.log(`📱 Notification sent to ${personnel.name}`);
  }

  /**
   * Notify backup personnel for emergencies
   */
  async notifyBackupPersonnel(backupList, callData) {
    console.log('📢 Notifying backup personnel...');
    
    for (const backup of backupList.slice(0, 3)) { // Limit to 3 backup notifications
      const contact = {
        phone: backup.phone,
        email: backup.email
      };

      await this.notifications.sendCustomMessage(contact, {
        recipientName: backup.name,
        message: `BACKUP NEEDED - ${callData.intent}: ${callData.description || 'Emergency assistance required'}`,
        senderName: 'Dispatch System',
        senderPhone: 'System Alert',
        options: { preferSMS: true }
      });

      console.log(`📱 Backup notification sent to ${backup.name}`);
    }
  }

  /**
   * Send confirmation to customer
   */
  async sendCustomerConfirmation(callData, assignedPersonnel) {
    if (!callData.customerPhone) return;

    const contact = { phone: callData.customerPhone };
    if (callData.customerEmail) {
      contact.email = callData.customerEmail;
    }

    await this.notifications.sendCustomMessage(contact, {
      recipientName: callData.customerName || 'Customer',
      message: `Your ${callData.serviceType || 'service'} request has been assigned to ${assignedPersonnel.name}. They will contact you shortly.`,
      senderName: 'ServicePro Solutions',
      senderPhone: '555-SERVICE',
      options: { preferSMS: true }
    });

    console.log('📱 Confirmation sent to customer');
  }

  /**
   * Send fallback notifications when no one is available
   */
  async sendFallbackNotifications(callData) {
    console.log('📢 Sending fallback notifications to all personnel...');
    
    // Get all available personnel
    const allPersonnel = this.transferRouter.personnel || [];
    
    for (const person of allPersonnel.slice(0, 5)) { // Limit to 5 notifications
      const contact = {
        phone: person.phone,
        email: person.email
      };

      await this.notifications.sendCustomMessage(contact, {
        recipientName: person.name,
        message: `URGENT - No one available for: ${callData.intent}. Customer: ${callData.customerPhone}. Please respond if available.`,
        senderName: 'Dispatch System',
        senderPhone: 'System Alert',
        options: { preferSMS: true }
      });
    }

    // Also send to customer apologizing for delay
    if (callData.customerPhone) {
      const contact = { phone: callData.customerPhone };
      await this.notifications.sendCustomMessage(contact, {
        recipientName: callData.customerName || 'Customer',
        message: 'We\'re currently experiencing high call volume. A technician will contact you within 30 minutes. For emergencies, call 555-EMERGENCY.',
        senderName: 'ServicePro Solutions',
        senderPhone: '555-SERVICE',
        options: { preferSMS: true }
      });
    }
  }

  /**
   * Handle escalation when initial contact fails
   */
  async escalateCall(callId, originalPersonnel, callData) {
    console.log(`🔄 Escalating call ${callId}...`);
    
    // Find next available personnel using the correct interface
    const available = this.transferRouter.getAvailablePersonnel();
    const nextAvailable = available.find(p => p.name !== originalPersonnel.name);

    if (nextAvailable) {
      await this.notifyAssignedPersonnel(nextAvailable, {
        ...callData,
        description: `ESCALATED from ${originalPersonnel.name}: ${callData.description}`
      });

      console.log(`⬆️ Call escalated to: ${nextAvailable.name}`);
      return { success: true, target: nextAvailable };
    } else {
      // Ultimate fallback - notify supervisor
      await this.notifySupervisor(callData, originalPersonnel);
      return { success: false, reason: 'Escalated to supervisor' };
    }
  }

  /**
   * Notify supervisor for critical issues
   */
  async notifySupervisor(callData, originalPersonnel) {
    console.log('👨‍💼 Notifying supervisor...');
    
    // Find supervisor (assuming role exists in personnel config)
    const allPersonnel = this.transferRouter.personnel || [];
    const supervisor = allPersonnel.find(p => p.roles && p.roles.includes('supervisor'));
    
    if (supervisor) {
      const contact = {
        phone: supervisor.phone,
        email: supervisor.email
      };

      await this.notifications.sendCustomMessage(contact, {
        recipientName: supervisor.name,
        message: `SUPERVISOR ALERT - Escalation needed. Original assignee: ${originalPersonnel.name}. Customer: ${callData.customerPhone}. Issue: ${callData.description}`,
        senderName: 'Dispatch System',
        senderPhone: 'System Alert',
        options: { preferSMS: true, sendBoth: true }
      });
    }
  }

  /**
   * Demo the complete transfer workflow
   */
  async demo() {
    console.log('🚀 TRANSFER WITH NOTIFICATIONS DEMO');
    console.log('=' .repeat(50));

    // Demo call scenarios
    const scenarios = [
      {
        name: 'Emergency Plumbing',
        callData: {
          customerName: 'Sarah Emergency',
          customerPhone: '+1-555-0911',
          intent: 'emergency_plumbing',
          serviceType: 'Emergency Plumbing',
          priority: 'emergency',
          description: 'Water pipe burst in basement - flooding!',
          address: '789 Flood Street',
          sendConfirmation: true
        }
      },
      {
        name: 'Quote Request',
        callData: {
          customerName: 'Bob Homeowner',
          customerPhone: '+1-555-0123',
          customerEmail: 'bob@email.com',
          intent: 'sales_quote',
          serviceType: 'Kitchen Renovation',
          priority: 'standard',
          description: 'Need quote for complete kitchen remodel',
          address: '123 Remodel Avenue',
          sendConfirmation: true
        }
      },
      {
        name: 'General Service',
        callData: {
          customerPhone: '+1-555-0456',
          intent: 'general_service',
          serviceType: 'HVAC Maintenance',
          description: 'Annual AC checkup needed',
          sendConfirmation: false
        }
      }
    ];

    // Process each scenario
    for (let i = 0; i < scenarios.length; i++) {
      const scenario = scenarios[i];
      console.log(`\n${i + 1}️⃣ ${scenario.name}:`);
      console.log('-' .repeat(30));
      
      const result = await this.processIncomingCall(scenario.callData);
      
      if (result.success) {
        console.log(`✅ Successfully routed to: ${result.routedTo.name}`);
      } else {
        console.log(`❌ Routing failed: ${result.reason || result.error}`);
      }
      
      // Add delay between scenarios
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Show analytics
    console.log('\n📊 Transfer & Notification Analytics:');
    console.log('-' .repeat(40));
    const analytics = this.notifications.getAnalytics();
    console.log(`📱 Total notifications sent: ${analytics.totalMessages}`);
    console.log(`📞 SMS notifications: ${analytics.smsCount}`);
    console.log(`📧 Email notifications: ${analytics.emailCount}`);
    console.log(`✅ Success rate: ${analytics.successRate}%`);

    // Show recent messages
    console.log('\n📋 Recent Notifications:');
    const recent = this.notifications.getRecentMessages(5);
    recent.forEach((msg, idx) => {
      const status = msg.success ? '✅' : '❌';
      const time = new Date(msg.timestamp).toLocaleTimeString();
      console.log(`   ${idx + 1}. ${status} ${msg.type.toUpperCase()} to ${msg.to} (${msg.templateKey}) at ${time}`);
    });

    console.log('\n🎉 Transfer demo completed!');
  }
}

// Export for use in other modules
module.exports = TransferWithNotifications;

// Run demo if this file is executed directly
if (require.main === module) {
  const demo = new TransferWithNotifications();
  demo.demo().catch(console.error);
}
