/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * TRANSCRIPT GENERATOR - V111 Call Transcript Service
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Generates clean, readable transcripts from ConversationMemory at call end.
 * 
 * TWO OUTPUT FORMATS:
 * 1. Customer Transcript - Clean, shareable with customer
 * 2. Engineering Transcript - Full debug details for troubleshooting
 * 
 * USAGE:
 *   const generator = new TranscriptGenerator(memory, company);
 *   const customerTranscript = generator.generateCustomer();
 *   const engineeringTranscript = generator.generateEngineering();
 * 
 * SPEC: docs/architecture/V111-ConversationMemory-Spec.md
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const logger = require('../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════════
// VERSION
// ═══════════════════════════════════════════════════════════════════════════════
const VERSION = 'v111.transcript.1';

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSCRIPT GENERATOR CLASS
// ═══════════════════════════════════════════════════════════════════════════════

class TranscriptGenerator {
  /**
   * Create a TranscriptGenerator
   * @param {object} memory - ConversationMemory object (or its JSON representation)
   * @param {object} company - Company object for branding
   */
  constructor(memory, company = {}) {
    this.memory = memory;
    this.company = company;
    this.companyName = company.name || company.companyName || 'Company';
    this.agentName = company.aiAgentSettings?.frontDeskBehavior?.personality?.name || 'Agent';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CUSTOMER TRANSCRIPT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate a clean customer-facing transcript
   * @returns {string} Formatted transcript
   */
  generateCustomer() {
    const lines = [];
    
    // Header
    lines.push('═'.repeat(70));
    lines.push(`CALL TRANSCRIPT - ${this.companyName}`);
    lines.push('═'.repeat(70));
    lines.push('');
    
    // Call info
    lines.push(`Date: ${this._formatDate(this.memory.createdAt || this.memory.startTime)}`);
    lines.push(`Duration: ${this._formatDuration(this.memory.outcome?.duration)}`);
    if (this.memory.facts?.name) {
      lines.push(`Caller: ${this.memory.facts.name}`);
    }
    lines.push('');
    lines.push('─'.repeat(70));
    lines.push('');
    
    // Conversation turns
    const turns = this.memory.turns || [];
    for (const turn of turns) {
      const callerText = turn.caller?.cleaned || turn.caller?.raw || '';
      const agentText = turn.response?.text || '';
      
      if (callerText) {
        lines.push(`CALLER: ${callerText}`);
      }
      if (agentText) {
        lines.push(`${this.agentName.toUpperCase()}: ${agentText}`);
      }
      lines.push('');
    }
    
    // Booking confirmation (if any)
    if (this.memory.booking?.created || this.memory.booking?.confirmed) {
      lines.push('─'.repeat(70));
      lines.push('');
      lines.push('BOOKING CONFIRMATION');
      lines.push('');
      
      const booking = this.memory.booking;
      const facts = this.memory.facts || {};
      
      if (facts.name) lines.push(`Name: ${facts.name}`);
      if (facts.phone) lines.push(`Phone: ${facts.phone}`);
      if (facts.address) lines.push(`Address: ${facts.address}`);
      if (facts.issue || facts.serviceType) {
        lines.push(`Service: ${facts.issue || facts.serviceType}`);
      }
      if (booking.appointmentTime) {
        lines.push(`Appointment: ${booking.appointmentTime}`);
      }
      lines.push('');
    }
    
    // Footer
    lines.push('─'.repeat(70));
    lines.push(`Thank you for calling ${this.companyName}!`);
    lines.push('═'.repeat(70));
    
    return lines.join('\n');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ENGINEERING TRANSCRIPT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate detailed engineering transcript for debugging
   * @returns {string} Formatted transcript with full details
   */
  generateEngineering() {
    const lines = [];
    
    // Header
    lines.push('╔' + '═'.repeat(78) + '╗');
    lines.push('║' + this._center('V111 ENGINEERING TRANSCRIPT', 78) + '║');
    lines.push('╚' + '═'.repeat(78) + '╝');
    lines.push('');
    
    // Call metadata
    lines.push('┌─────────────────────────────────────────────────────────────────────────────┐');
    lines.push('│ CALL METADATA                                                               │');
    lines.push('├─────────────────────────────────────────────────────────────────────────────┤');
    lines.push(`│ Call ID:    ${this._pad(this.memory.callId || 'unknown', 62)}│`);
    lines.push(`│ Company:    ${this._pad(this.companyName, 62)}│`);
    lines.push(`│ Company ID: ${this._pad(this.memory.companyId || 'unknown', 62)}│`);
    lines.push(`│ Start Time: ${this._pad(this._formatDate(this.memory.createdAt), 62)}│`);
    lines.push(`│ Duration:   ${this._pad(this._formatDuration(this.memory.outcome?.duration), 62)}│`);
    lines.push(`│ Outcome:    ${this._pad(this.memory.outcome?.endReason || 'unknown', 62)}│`);
    lines.push(`│ V111 Ver:   ${this._pad(this.memory.version || VERSION, 62)}│`);
    lines.push('└─────────────────────────────────────────────────────────────────────────────┘');
    lines.push('');
    
    // Final facts
    lines.push('┌─────────────────────────────────────────────────────────────────────────────┐');
    lines.push('│ FINAL FACTS (Runtime Truth)                                                 │');
    lines.push('├─────────────────────────────────────────────────────────────────────────────┤');
    
    const facts = this.memory.facts || {};
    const factKeys = Object.keys(facts);
    if (factKeys.length > 0) {
      for (const key of factKeys) {
        const value = facts[key];
        const displayValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
        lines.push(`│ ${this._pad(key + ':', 15)}${this._pad(displayValue.substring(0, 58), 59)}│`);
      }
    } else {
      lines.push('│ (no facts captured)                                                         │');
    }
    lines.push('└─────────────────────────────────────────────────────────────────────────────┘');
    lines.push('');
    
    // V111 Config snapshot
    if (this.memory.config) {
      lines.push('┌─────────────────────────────────────────────────────────────────────────────┐');
      lines.push('│ V111 CONFIG (Config Truth)                                                  │');
      lines.push('├─────────────────────────────────────────────────────────────────────────────┤');
      lines.push(`│ Enabled:         ${this._pad(String(this.memory.config.enabled), 57)}│`);
      
      const captureGoals = this.memory.config.captureGoals || {};
      lines.push(`│ MUST fields:     ${this._pad((captureGoals.must?.fields || []).join(', ') || 'none', 57)}│`);
      lines.push(`│ SHOULD fields:   ${this._pad((captureGoals.should?.fields || []).join(', ') || 'none', 57)}│`);
      lines.push(`│ NICE fields:     ${this._pad((captureGoals.nice?.fields || []).join(', ') || 'none', 57)}│`);
      
      const contextWindow = this.memory.config.contextWindow || {};
      lines.push(`│ Context window:  ${this._pad(`${contextWindow.maxTurns || 6} turns, ${contextWindow.maxTokenBudget || 600} tokens`, 57)}│`);
      lines.push('└─────────────────────────────────────────────────────────────────────────────┘');
      lines.push('');
    }
    
    // Capture progress
    if (this.memory.captureProgress) {
      lines.push('┌─────────────────────────────────────────────────────────────────────────────┐');
      lines.push('│ CAPTURE PROGRESS                                                            │');
      lines.push('├─────────────────────────────────────────────────────────────────────────────┤');
      
      const progress = this.memory.captureProgress;
      const mustStatus = Object.entries(progress.must || {}).map(([k, v]) => 
        `${k}:${v.captured ? '✓' : '✗'}`
      ).join(' ') || 'none';
      const shouldStatus = Object.entries(progress.should || {}).map(([k, v]) => 
        `${k}:${v.captured ? '✓' : '✗'}`
      ).join(' ') || 'none';
      
      lines.push(`│ MUST:    ${this._pad(mustStatus, 65)}│`);
      lines.push(`│ SHOULD:  ${this._pad(shouldStatus, 65)}│`);
      lines.push(`│ Turns without progress: ${this._pad(String(progress.turnsWithoutProgress || 0), 50)}│`);
      lines.push('└─────────────────────────────────────────────────────────────────────────────┘');
      lines.push('');
    }
    
    // Turn-by-turn breakdown
    lines.push('┌─────────────────────────────────────────────────────────────────────────────┐');
    lines.push('│ TURN-BY-TURN BREAKDOWN                                                      │');
    lines.push('└─────────────────────────────────────────────────────────────────────────────┘');
    
    const turns = this.memory.turns || [];
    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];
      lines.push('');
      lines.push(`╭── TURN ${turn.turn ?? i} ─────────────────────────────────────────────────────────────╮`);
      lines.push(`│ Time: ${this._pad(turn.timestamp || '', 68)}│`);
      lines.push('├───────────────────────────────────────────────────────────────────────────────┤');
      
      // Caller input
      const callerRaw = turn.caller?.raw || '';
      const callerCleaned = turn.caller?.cleaned || callerRaw;
      lines.push(`│ CALLER (raw):     "${this._pad(callerRaw.substring(0, 53), 53)}"│`);
      if (callerRaw !== callerCleaned) {
        lines.push(`│ CALLER (cleaned): "${this._pad(callerCleaned.substring(0, 53), 53)}"│`);
      }
      
      // STT ops
      const sttOps = turn.caller?.sttOps || {};
      if (sttOps.fillersRemoved?.length || sttOps.correctionsApplied?.length) {
        const sttInfo = [];
        if (sttOps.fillersRemoved?.length) sttInfo.push(`fillers:-${sttOps.fillersRemoved.length}`);
        if (sttOps.correctionsApplied?.length) sttInfo.push(`corrections:${sttOps.correctionsApplied.length}`);
        lines.push(`│ STT ops:          ${this._pad(sttInfo.join(', '), 56)}│`);
      }
      
      lines.push('├───────────────────────────────────────────────────────────────────────────────┤');
      
      // Routing
      const handler = turn.routing?.selectedHandler || 'UNKNOWN';
      const why = (turn.routing?.why || []).map(w => w.rule || w).join(' → ');
      lines.push(`│ HANDLER:  ${this._pad(handler, 64)}│`);
      lines.push(`│ WHY:      ${this._pad(why.substring(0, 64), 64)}│`);
      
      // V111 governance (if present)
      if (turn.v111?.governance?.length > 0) {
        const govSteps = turn.v111.governance.map(g => `${g.step}:${g.result}`).join(' → ');
        lines.push(`│ V111 GOV: ${this._pad(govSteps.substring(0, 64), 64)}│`);
      }
      
      lines.push('├───────────────────────────────────────────────────────────────────────────────┤');
      
      // Response
      const responseText = turn.response?.text || '';
      const latencyMs = turn.response?.latencyMs || 0;
      lines.push(`│ RESPONSE (${latencyMs}ms): ${this._pad('', 51)}│`);
      
      // Wrap response text
      const responseLines = this._wrapText(responseText, 73);
      for (const line of responseLines) {
        lines.push(`│ ${this._pad(line, 74)}│`);
      }
      
      // Delta
      const factsAdded = turn.delta?.factsAdded || [];
      const factsUpdated = turn.delta?.factsUpdated || [];
      if (factsAdded.length || factsUpdated.length) {
        lines.push('├───────────────────────────────────────────────────────────────────────────────┤');
        if (factsAdded.length) {
          lines.push(`│ +FACTS: ${this._pad(factsAdded.join(', '), 66)}│`);
        }
        if (factsUpdated.length) {
          lines.push(`│ ~FACTS: ${this._pad(factsUpdated.join(', '), 66)}│`);
        }
      }
      
      lines.push('╰───────────────────────────────────────────────────────────────────────────────╯');
    }
    
    // Booking details (if any)
    if (this.memory.booking?.modeLocked || this.memory.booking?.created) {
      lines.push('');
      lines.push('┌─────────────────────────────────────────────────────────────────────────────┐');
      lines.push('│ BOOKING STATE                                                               │');
      lines.push('├─────────────────────────────────────────────────────────────────────────────┤');
      
      const booking = this.memory.booking || {};
      lines.push(`│ Mode Locked:   ${this._pad(String(booking.modeLocked || false), 59)}│`);
      lines.push(`│ Consent Turn:  ${this._pad(String(booking.consentTurn ?? 'N/A'), 59)}│`);
      lines.push(`│ Current Step:  ${this._pad(booking.currentStep || 'N/A', 59)}│`);
      lines.push(`│ Created:       ${this._pad(String(booking.created || false), 59)}│`);
      lines.push('└─────────────────────────────────────────────────────────────────────────────┘');
    }
    
    // Footer
    lines.push('');
    lines.push('═'.repeat(79));
    lines.push(`Generated: ${new Date().toISOString()} | Version: ${VERSION}`);
    lines.push('═'.repeat(79));
    
    return lines.join('\n');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // JSON EXPORT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate a structured JSON export
   * @returns {object} Structured call data
   */
  generateJSON() {
    return {
      version: VERSION,
      generatedAt: new Date().toISOString(),
      call: {
        callId: this.memory.callId,
        companyId: this.memory.companyId,
        companyName: this.companyName,
        startTime: this.memory.createdAt,
        duration: this.memory.outcome?.duration,
        outcome: this.memory.outcome?.endReason,
        totalTurns: this.memory.turns?.length || 0
      },
      facts: this.memory.facts || {},
      captureProgress: this.memory.captureProgress || {},
      booking: this.memory.booking || null,
      turns: (this.memory.turns || []).map(turn => ({
        turn: turn.turn,
        timestamp: turn.timestamp,
        caller: {
          raw: turn.caller?.raw,
          cleaned: turn.caller?.cleaned
        },
        handler: turn.routing?.selectedHandler,
        response: turn.response?.text,
        latencyMs: turn.response?.latencyMs,
        factsAdded: turn.delta?.factsAdded || [],
        v111Governance: turn.v111?.governance || []
      })),
      config: this.memory.config || null
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Format date for display
   * @private
   */
  _formatDate(dateInput) {
    if (!dateInput) return 'Unknown';
    try {
      const date = new Date(dateInput);
      return date.toLocaleString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short'
      });
    } catch (e) {
      return String(dateInput);
    }
  }

  /**
   * Format duration for display
   * @private
   */
  _formatDuration(ms) {
    if (!ms) return 'Unknown';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    
    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    }
    return `${seconds}s`;
  }

  /**
   * Center text in a given width
   * @private
   */
  _center(text, width) {
    const padding = Math.max(0, width - text.length);
    const leftPad = Math.floor(padding / 2);
    const rightPad = padding - leftPad;
    return ' '.repeat(leftPad) + text + ' '.repeat(rightPad);
  }

  /**
   * Pad text to a given width
   * @private
   */
  _pad(text, width) {
    const str = String(text || '');
    if (str.length >= width) return str.substring(0, width);
    return str + ' '.repeat(width - str.length);
  }

  /**
   * Wrap text to fit within a width
   * @private
   */
  _wrapText(text, width) {
    if (!text) return ['(empty)'];
    
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';
    
    for (const word of words) {
      if (currentLine.length + word.length + 1 <= width) {
        currentLine += (currentLine ? ' ' : '') + word;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word.length <= width ? word : word.substring(0, width);
      }
    }
    
    if (currentLine) lines.push(currentLine);
    return lines.length > 0 ? lines : ['(empty)'];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATIC HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Quick generate customer transcript
 * @param {object} memory - ConversationMemory
 * @param {object} company - Company object
 * @returns {string} Customer transcript
 */
function generateCustomerTranscript(memory, company) {
  const generator = new TranscriptGenerator(memory, company);
  return generator.generateCustomer();
}

/**
 * Quick generate engineering transcript
 * @param {object} memory - ConversationMemory
 * @param {object} company - Company object
 * @returns {string} Engineering transcript
 */
function generateEngineeringTranscript(memory, company) {
  const generator = new TranscriptGenerator(memory, company);
  return generator.generateEngineering();
}

/**
 * Generate both transcripts
 * @param {object} memory - ConversationMemory
 * @param {object} company - Company object
 * @returns {object} { customer, engineering, json }
 */
function generateAllTranscripts(memory, company) {
  const generator = new TranscriptGenerator(memory, company);
  return {
    customer: generator.generateCustomer(),
    engineering: generator.generateEngineering(),
    json: generator.generateJSON()
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
  TranscriptGenerator,
  generateCustomerTranscript,
  generateEngineeringTranscript,
  generateAllTranscripts,
  VERSION
};
