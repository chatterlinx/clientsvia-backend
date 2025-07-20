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
}

module.exports = TransferRouter;
