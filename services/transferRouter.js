// services/transferRouter.js

const moment = require('moment');

class TransferRouter {
  constructor(personnelList = []) {
    this.personnel = personnelList;
  }

  /**
   * Find a matching recipient based on keyword/intent
   * @param {string} query - user request (e.g., "I want to talk to billing")
   * @returns {object|null}
   */
  resolveTransferTarget(query, now = moment()) {
    query = query.toLowerCase();

    const match = this.personnel.find(person => {
      return person.roles?.some(role => query.includes(role.toLowerCase()));
    });

    if (!match) return null;

    const isAvailable = this.isWithinWorkingHours(match, now);
    const allowTransfer = match.allowDirectTransfer !== false;

    return {
      ...match,
      canTransferNow: isAvailable && allowTransfer,
      canMessage: !!(match.email || match.phone),
      fallback: !isAvailable || !allowTransfer
    };
  }

  /**
   * Check if current time is within personnel's working hours
   */
  isWithinWorkingHours(person, now = moment()) {
    if (!person.hours) return true;

    const dayKey = now.format('ddd').toLowerCase(); // e.g., 'mon'
    const time = parseInt(now.format('HHmm'));

    const ranges = person.hours[dayKey] || person.hours['any'];
    if (!ranges) return false;

    const [start, end] = ranges.split('-').map(t => parseInt(t.replace(':', '')));
    return time >= start && time <= end;
  }

  /**
   * Handle fallback message when transfer isn't allowed
   */
  buildMessageFallback(person, customerMessage) {
    return {
      to: person.phone || person.email,
      via: person.preferSMS ? 'sms' : 'email',
      message: `📩 New message from customer: "${customerMessage}"\n\nPlease follow up.`,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Fallback for owner, manager, or unavailable roles
   */
  getEscalationPolicy(role) {
    const person = this.personnel.find(p =>
      p.roles?.includes(role.toLowerCase())
    );

    if (!person) return null;

    return {
      name: person.name,
      canTransfer: person.allowDirectTransfer !== false,
      fallbackMessage: person.allowDirectTransfer === false
        ? "They're unavailable right now, but I'll make sure they get your message."
        : "Let me try to connect you…"
    };
  }

  /**
   * Get all available personnel for a given time
   */
  getAvailablePersonnel(now = moment()) {
    return this.personnel.filter(person => 
      this.isWithinWorkingHours(person, now) && person.allowDirectTransfer !== false
    );
  }

  /**
   * Find best transfer option based on priority and availability
   */
  findBestTransferOption(query, now = moment()) {
    const target = this.resolveTransferTarget(query, now);
    
    if (target && target.canTransferNow) {
      return {
        type: 'direct_transfer',
        target,
        message: `Let me connect you with ${target.name} right away.`
      };
    }

    if (target && target.canMessage) {
      return {
        type: 'message_fallback',
        target,
        fallback: this.buildMessageFallback(target, query),
        message: `${target.name} isn't available right now, but I'll send them your message immediately.`
      };
    }

    // Find any available personnel as backup
    const available = this.getAvailablePersonnel(now);
    if (available.length > 0) {
      return {
        type: 'backup_transfer',
        target: available[0],
        message: `Let me connect you with ${available[0].name} who can help you.`
      };
    }

    return {
      type: 'no_transfer',
      message: 'Our team is currently unavailable, but I can help you with many questions or take a message.'
    };
  }

  /**
   * Get transfer statistics
   */
  getTransferStats(now = moment()) {
    const available = this.getAvailablePersonnel(now);
    const unavailable = this.personnel.filter(p => !this.isWithinWorkingHours(p, now));
    const noDirectTransfer = this.personnel.filter(p => p.allowDirectTransfer === false);

    return {
      totalPersonnel: this.personnel.length,
      available: available.length,
      unavailable: unavailable.length,
      messageOnly: noDirectTransfer.length,
      availablePersonnel: available.map(p => ({
        name: p.name,
        roles: p.roles
      }))
    };
  }

  /**
   * Check if transfer router is enabled for a company
   */
  isEnabled(companyId) {
    // In a real implementation, this would check database
    return true; // Default enabled
  }

  /**
   * Enable transfer router for a company
   */
  enable(companyId) {
    console.log(`Transfer router enabled for company ${companyId}`);
    // In a real implementation, this would update database
  }

  /**
   * Disable transfer router for a company
   */
  disable(companyId) {
    console.log(`Transfer router disabled for company ${companyId}`);
    // In a real implementation, this would update database
  }

  /**
   * Get active transfers for a company
   */
  getActiveTransfers(companyId) {
    // Mock data - in real implementation, this would come from database
    return [
      {
        id: 'transfer-001',
        customerPhone: '+1234567890',
        targetPersonnel: 'John Doe',
        status: 'in_progress',
        startTime: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        reason: 'Billing inquiry'
      }
    ];
  }

  /**
   * Get configuration for a company
   */
  getConfiguration(companyId) {
    return {
      autoDistribution: true,
      priority: 'round_robin',
      businessHours: {
        enabled: true,
        start: '09:00',
        end: '17:00',
        timezone: 'America/New_York'
      },
      fallbackBehavior: 'message',
      maxWaitTime: 300 // seconds
    };
  }

  /**
   * Update configuration for a company
   */
  updateConfiguration(companyId, config) {
    console.log(`Transfer router configuration updated for company ${companyId}:`, config);
    // In a real implementation, this would save to database
  }

  /**
   * Get analytics for a company
   */
  getAnalytics(companyId) {
    // Mock analytics data
    return {
      totalTransfers: 125,
      successfulTransfers: 118,
      failedTransfers: 7,
      averageWaitTime: 45, // seconds
      successRate: 94.4,
      peakHours: ['10:00-11:00', '14:00-15:00'],
      topReasons: [
        { reason: 'Billing', count: 45 },
        { reason: 'Technical Support', count: 32 },
        { reason: 'Sales', count: 28 }
      ]
    };
  }

  /**
   * Execute a transfer (for testing)
   */
  async executeTransfer(transferData) {
    console.log('Executing transfer:', transferData);
    
    // Simulate transfer execution
    return {
      transferId: `transfer-${Date.now()}`,
      status: 'success',
      targetMember: transferData.targetMember,
      customerInfo: transferData.customerInfo,
      timestamp: new Date().toISOString(),
      estimatedWaitTime: Math.floor(Math.random() * 60) + 30 // 30-90 seconds
    };
  }
}

module.exports = TransferRouter;
