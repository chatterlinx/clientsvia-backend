/**
 * ============================================================================
 * CUSTOMER CONTEXT LOADER - Enterprise Customer Intelligence System
 * ============================================================================
 * 
 * PURPOSE:
 * Loads comprehensive customer history for AI agent to provide personalized,
 * intelligent service. Makes the agent "remember" returning customers.
 * 
 * WHAT IT LOADS:
 * 1. Customer identity (name, phone, address, preferences)
 * 2. Past call transcripts (last 3 calls - summarized)
 * 3. Service visits with technician names
 * 4. Equipment info and warranty status
 * 5. AI-accumulated notes and preferences
 * 6. Relationship metrics (total calls, lifetime value)
 * 
 * USAGE:
 * Called at start of conversation for return callers.
 * Context is injected into LLM prompt for smart responses.
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');
const Customer = require('../models/Customer');
const CustomerEvent = require('../models/CustomerEvent');
const CallTranscript = require('../models/CallTranscript');
const CallSummary = require('../models/CallSummary');
const BlackBoxRecording = require('../models/BlackBoxRecording');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  MAX_PAST_CALLS: 3,           // How many past calls to load transcripts for
  MAX_TRANSCRIPT_TURNS: 10,    // Max turns per transcript (summarize long calls)
  MAX_VISITS: 5,               // How many past service visits to include
  MAX_AI_NOTES: 10,            // How many AI notes to include
  MAX_CONTEXT_TOKENS: 2000,    // Approximate token budget for customer context
  RECENT_CALL_DAYS: 90         // Only load calls from last N days
};

// ============================================================================
// MAIN LOADER FUNCTION
// ============================================================================

/**
 * Load comprehensive customer context for AI agent
 * 
 * @param {ObjectId} companyId - Company ID
 * @param {ObjectId} customerId - Customer ID
 * @param {Object} options - Optional settings
 * @returns {Object} - Full customer context for LLM
 */
async function loadCustomerContext(companyId, customerId, options = {}) {
  const startTime = Date.now();
  
  try {
    if (!customerId) {
      logger.debug('[CUSTOMER CONTEXT] No customerId provided - new caller');
      return { isReturning: false, hasContext: false };
    }
    
    // Load customer record
    const customer = await Customer.findOne({ 
      _id: customerId, 
      companyId 
    }).lean();
    
    if (!customer) {
      logger.debug('[CUSTOMER CONTEXT] Customer not found', { customerId });
      return { isReturning: false, hasContext: false };
    }
    
    // Parallel load all customer data
    const [
      callHistory,
      pastTranscripts,
      serviceVisits,
      aiNotes
    ] = await Promise.all([
      loadCallHistory(companyId, customerId),
      loadPastTranscripts(companyId, customerId),
      loadServiceVisits(customer),
      loadAINotes(customer)
    ]);
    
    // Build the context object
    const context = {
      isReturning: true,
      hasContext: true,
      loadTimeMs: Date.now() - startTime,
      
      // === IDENTITY ===
      identity: {
        customerId: customerId.toString(),
        name: {
          full: customer.name?.full || null,
          first: customer.name?.first || null,
          last: customer.name?.last || null,
          nickname: customer.name?.nickname || null,
          displayName: customer.name?.nickname || customer.name?.first || customer.name?.full || 'Customer'
        },
        primaryPhone: getPrimaryPhone(customer),
        primaryEmail: getPrimaryEmail(customer),
        primaryAddress: getPrimaryAddress(customer)
      },
      
      // === RELATIONSHIP METRICS ===
      metrics: {
        totalCalls: customer.metrics?.totalCalls || 0,
        totalBookings: customer.metrics?.totalBookings || 0,
        totalVisits: customer.visits?.length || 0,
        lifetimeValue: customer.metrics?.lifetimeValue || 0,
        lastInteractionAt: customer.metrics?.lastInteractionAt || null,
        firstContactAt: customer.firstContactAt || customer.createdAt,
        customerSince: formatCustomerSince(customer.firstContactAt || customer.createdAt),
        status: customer.status || 'active',
        tags: customer.tags || []
      },
      
      // === CALL HISTORY (Summaries) ===
      callHistory: callHistory,
      
      // === PAST TRANSCRIPTS (For AI to reference) ===
      pastTranscripts: pastTranscripts,
      
      // === SERVICE VISITS ===
      serviceVisits: serviceVisits,
      
      // === EQUIPMENT ===
      equipment: formatEquipment(customer.equipment || []),
      
      // === PREFERENCES ===
      preferences: {
        preferredTechnician: customer.preferences?.preferredTechnicianName || null,
        preferredTimeWindow: customer.preferences?.preferredTimeWindow || null,
        preferredContactMethod: customer.preferences?.preferredContactMethod || 'phone',
        communicationStyle: customer.preferences?.communicationStyle || null,
        specialInstructions: customer.preferences?.specialInstructions || null,
        language: customer.preferences?.language || 'en'
      },
      
      // === AI NOTES (Accumulated intelligence) ===
      aiNotes: aiNotes,
      
      // === ADDRESSES (All known) ===
      addresses: formatAddresses(customer.addresses || [])
    };
    
    logger.info('[CUSTOMER CONTEXT] ✅ Loaded for returning customer', {
      customerId: customerId.toString(),
      displayName: context.identity.name.displayName,
      totalCalls: context.metrics.totalCalls,
      pastTranscriptsLoaded: context.pastTranscripts.length,
      serviceVisitsLoaded: context.serviceVisits.length,
      loadTimeMs: context.loadTimeMs
    });
    
    return context;
    
  } catch (error) {
    logger.error('[CUSTOMER CONTEXT] Failed to load (non-fatal)', {
      customerId,
      error: error.message
    });
    return { isReturning: false, hasContext: false, error: error.message };
  }
}

// ============================================================================
// CALL HISTORY LOADER
// ============================================================================

async function loadCallHistory(companyId, customerId) {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - CONFIG.RECENT_CALL_DAYS);
    
    const calls = await CallSummary.find({
      companyId,
      customerId,
      createdAt: { $gte: cutoffDate }
    })
      .sort({ createdAt: -1 })
      .limit(CONFIG.MAX_PAST_CALLS + 2) // Load a few extra for context
      .select('callId createdAt duration outcome summary intent callerSentiment')
      .lean();
    
    return calls.map(call => ({
      callId: call.callId,
      date: call.createdAt,
      dateFormatted: formatDate(call.createdAt),
      daysAgo: getDaysAgo(call.createdAt),
      duration: call.duration,
      durationFormatted: formatDuration(call.duration),
      outcome: call.outcome || 'unknown',
      summary: call.summary || null,
      intent: call.intent || null,
      sentiment: call.callerSentiment || 'neutral'
    }));
    
  } catch (error) {
    logger.warn('[CUSTOMER CONTEXT] Failed to load call history', { error: error.message });
    return [];
  }
}

// ============================================================================
// PAST TRANSCRIPTS LOADER
// ============================================================================

async function loadPastTranscripts(companyId, customerId) {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - CONFIG.RECENT_CALL_DAYS);
    
    // First get call IDs for this customer
    const calls = await CallSummary.find({
      companyId,
      customerId,
      createdAt: { $gte: cutoffDate }
    })
      .sort({ createdAt: -1 })
      .limit(CONFIG.MAX_PAST_CALLS)
      .select('callId createdAt transcriptRef')
      .lean();
    
    if (calls.length === 0) return [];
    
    // Load transcripts from BlackBoxRecording (has full transcript)
    const callIds = calls.map(c => c.callId);
    const recordings = await BlackBoxRecording.find({
      companyId,
      callId: { $in: callIds }
    })
      .select('callId startedAt transcript.callerTurns transcript.agentTurns')
      .lean();
    
    // Format transcripts for AI consumption
    const transcripts = [];
    
    for (const recording of recordings) {
      const call = calls.find(c => c.callId === recording.callId);
      if (!recording.transcript) continue;
      
      // Merge and sort turns
      const allTurns = [
        ...(recording.transcript.callerTurns || []).map(t => ({ ...t, speaker: 'caller' })),
        ...(recording.transcript.agentTurns || []).map(t => ({ ...t, speaker: 'agent' }))
      ].sort((a, b) => (a.t || 0) - (b.t || 0));
      
      // Take most important turns (first few and last few)
      const summarizedTurns = summarizeTranscript(allTurns, CONFIG.MAX_TRANSCRIPT_TURNS);
      
      transcripts.push({
        callId: recording.callId,
        date: call?.createdAt || recording.startedAt,
        dateFormatted: formatDate(call?.createdAt || recording.startedAt),
        daysAgo: getDaysAgo(call?.createdAt || recording.startedAt),
        turns: summarizedTurns,
        turnCount: allTurns.length,
        summary: extractConversationSummary(allTurns)
      });
    }
    
    // Sort by date descending
    transcripts.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    return transcripts;
    
  } catch (error) {
    logger.warn('[CUSTOMER CONTEXT] Failed to load past transcripts', { error: error.message });
    return [];
  }
}

/**
 * Summarize a transcript to most important turns
 */
function summarizeTranscript(turns, maxTurns) {
  if (turns.length <= maxTurns) {
    return turns.map(t => ({
      speaker: t.speaker,
      text: t.text
    }));
  }
  
  // Take first 3, last 3, and key turns in between
  const firstTurns = turns.slice(0, 3);
  const lastTurns = turns.slice(-3);
  
  // Find key turns in the middle (ones with booking info or issues)
  const middleTurns = turns.slice(3, -3);
  const keyTurns = middleTurns.filter(t => {
    const text = (t.text || '').toLowerCase();
    return text.includes('name is') || 
           text.includes('address') || 
           text.includes('problem') ||
           text.includes('issue') ||
           text.includes('not working') ||
           text.includes('technician') ||
           text.includes('appointment') ||
           text.includes('scheduled');
  }).slice(0, maxTurns - 6);
  
  const result = [
    ...firstTurns,
    ...(keyTurns.length > 0 ? [{ speaker: 'system', text: '...' }] : []),
    ...keyTurns,
    { speaker: 'system', text: '...' },
    ...lastTurns
  ];
  
  return result.map(t => ({
    speaker: t.speaker,
    text: t.text
  }));
}

/**
 * Extract key points from conversation
 */
function extractConversationSummary(turns) {
  const callerTexts = turns
    .filter(t => t.speaker === 'caller')
    .map(t => t.text || '')
    .join(' ');
  
  // Extract key issues mentioned
  const issues = [];
  
  if (/not cooling|won't cool|no cold air/i.test(callerTexts)) issues.push('AC not cooling');
  if (/not heating|won't heat|no heat/i.test(callerTexts)) issues.push('Heating not working');
  if (/making noise|strange sound|loud/i.test(callerTexts)) issues.push('Making unusual noise');
  if (/leaking|water|dripping/i.test(callerTexts)) issues.push('Water leak');
  if (/thermostat|blank|not responding/i.test(callerTexts)) issues.push('Thermostat issue');
  if (/maintenance|tune.?up|check/i.test(callerTexts)) issues.push('Maintenance request');
  if (/emergency|urgent|asap/i.test(callerTexts)) issues.push('Urgent/Emergency');
  if (/callback|come back|return/i.test(callerTexts)) issues.push('Callback request');
  
  // Extract technician mentions
  const techMatch = callerTexts.match(/(?:technician|tech|guy|person|he|she)\s+(?:was\s+)?(?:named?\s+)?(\w+)/i);
  if (techMatch) {
    issues.push(`Technician: ${techMatch[1]}`);
  }
  
  return issues.length > 0 ? issues.join(', ') : 'General inquiry';
}

// ============================================================================
// SERVICE VISITS LOADER
// ============================================================================

async function loadServiceVisits(customer) {
  const visits = customer.visits || [];
  
  return visits
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, CONFIG.MAX_VISITS)
    .map(visit => ({
      date: visit.date,
      dateFormatted: formatDate(visit.date),
      daysAgo: getDaysAgo(visit.date),
      technicianName: visit.technicianName || 'Unknown technician',
      issueDescription: visit.issueDescription || null,
      resolution: visit.resolution || null,
      notes: visit.notes || null,
      wasCallback: visit.wasCallback || false,
      customerRating: visit.customerRating || null,
      invoiceAmount: visit.invoiceAmount || null
    }));
}

// ============================================================================
// AI NOTES LOADER
// ============================================================================

async function loadAINotes(customer) {
  const notes = customer.aiNotes || [];
  
  return notes
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, CONFIG.MAX_AI_NOTES)
    .map(note => ({
      note: note.note,
      source: note.source,
      createdAt: note.createdAt
    }));
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getPrimaryPhone(customer) {
  const phones = customer.phoneNumbers || [];
  const primary = phones.find(p => p.isPrimary);
  return primary?.number || phones[0]?.number || null;
}

function getPrimaryEmail(customer) {
  const emails = customer.emails || [];
  const primary = emails.find(e => e.isPrimary);
  return primary?.address || emails[0]?.address || null;
}

function getPrimaryAddress(customer) {
  const addresses = customer.addresses || [];
  const primary = addresses.find(a => a.isPrimary);
  const addr = primary || addresses[0];
  
  if (!addr) return null;
  
  const parts = [addr.street, addr.city, addr.state, addr.zip].filter(Boolean);
  return {
    formatted: parts.join(', '),
    street: addr.street,
    city: addr.city,
    state: addr.state,
    zip: addr.zip,
    notes: addr.notes || null // "Gate code 4521"
  };
}

function formatAddresses(addresses) {
  return addresses.map(addr => ({
    label: addr.label || 'Address',
    formatted: [addr.street, addr.city, addr.state, addr.zip].filter(Boolean).join(', '),
    street: addr.street,
    city: addr.city,
    state: addr.state,
    zip: addr.zip,
    notes: addr.notes || null,
    isPrimary: addr.isPrimary || false
  }));
}

function formatEquipment(equipment) {
  return equipment.map(eq => ({
    type: eq.type || 'Equipment',
    brand: eq.brand || null,
    model: eq.model || null,
    serialNumber: eq.serialNumber || null,
    installDate: eq.installDate,
    installYear: eq.installDate ? new Date(eq.installDate).getFullYear() : null,
    warrantyExpires: eq.warrantyExpires,
    isUnderWarranty: eq.warrantyExpires ? new Date(eq.warrantyExpires) > new Date() : null,
    warrantyStatus: getWarrantyStatus(eq.warrantyExpires),
    lastServiceDate: eq.lastServiceDate,
    notes: eq.notes || null
  }));
}

function getWarrantyStatus(warrantyExpires) {
  if (!warrantyExpires) return 'unknown';
  const expiryDate = new Date(warrantyExpires);
  const now = new Date();
  
  if (expiryDate > now) {
    const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
    if (daysLeft < 30) return 'expiring_soon';
    return 'active';
  }
  return 'expired';
}

function formatDate(date) {
  if (!date) return null;
  return new Date(date).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function getDaysAgo(date) {
  if (!date) return null;
  const diff = Date.now() - new Date(date).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function formatDuration(seconds) {
  if (!seconds) return null;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

function formatCustomerSince(date) {
  if (!date) return null;
  const months = Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24 * 30));
  if (months < 1) return 'New customer';
  if (months < 12) return `${months} month${months > 1 ? 's' : ''}`;
  const years = Math.floor(months / 12);
  return `${years} year${years > 1 ? 's' : ''}`;
}

// ============================================================================
// FORMAT FOR LLM PROMPT
// ============================================================================

/**
 * Format customer context as a string for LLM prompt injection
 * 
 * @param {Object} context - Customer context from loadCustomerContext
 * @returns {string} - Formatted context for LLM
 */
function formatForLLMPrompt(context) {
  if (!context || !context.hasContext) {
    return '';
  }
  
  const lines = [];
  
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('🧠 CUSTOMER INTELLIGENCE (Use this to personalize conversation)');
  lines.push('═══════════════════════════════════════════════════════════════');
  
  // Identity
  lines.push(`\n👤 CUSTOMER: ${context.identity.name.displayName}`);
  if (context.identity.name.full && context.identity.name.full !== context.identity.name.displayName) {
    lines.push(`   Full name: ${context.identity.name.full}`);
  }
  lines.push(`   Customer for: ${context.metrics.customerSince}`);
  lines.push(`   Total calls: ${context.metrics.totalCalls}`);
  if (context.metrics.tags?.length > 0) {
    lines.push(`   Tags: ${context.metrics.tags.join(', ')}`);
  }
  
  // Primary address
  if (context.identity.primaryAddress) {
    lines.push(`\n🏠 ADDRESS ON FILE: ${context.identity.primaryAddress.formatted}`);
    if (context.identity.primaryAddress.notes) {
      lines.push(`   ⚠️ Note: ${context.identity.primaryAddress.notes}`);
    }
  }
  
  // Equipment
  if (context.equipment?.length > 0) {
    lines.push('\n🔧 EQUIPMENT:');
    for (const eq of context.equipment) {
      let eqLine = `   • ${eq.type}`;
      if (eq.brand) eqLine += ` - ${eq.brand}`;
      if (eq.model) eqLine += ` ${eq.model}`;
      if (eq.installYear) eqLine += ` (installed ${eq.installYear})`;
      if (eq.warrantyStatus === 'active') eqLine += ' [WARRANTY ACTIVE]';
      else if (eq.warrantyStatus === 'expiring_soon') eqLine += ' [WARRANTY EXPIRING SOON]';
      else if (eq.warrantyStatus === 'expired') eqLine += ' [WARRANTY EXPIRED]';
      lines.push(eqLine);
    }
  }
  
  // Recent service visits
  if (context.serviceVisits?.length > 0) {
    lines.push('\n📅 RECENT SERVICE VISITS:');
    for (const visit of context.serviceVisits.slice(0, 3)) {
      let visitLine = `   • ${visit.dateFormatted}`;
      if (visit.technicianName) visitLine += ` - ${visit.technicianName}`;
      if (visit.issueDescription) visitLine += ` - "${visit.issueDescription}"`;
      if (visit.resolution) visitLine += ` → ${visit.resolution}`;
      if (visit.wasCallback) visitLine += ' [CALLBACK]';
      lines.push(visitLine);
    }
  }
  
  // Past call summaries
  if (context.callHistory?.length > 0) {
    lines.push('\n📞 PAST CALLS:');
    for (const call of context.callHistory.slice(0, 3)) {
      let callLine = `   • ${call.dateFormatted} (${call.daysAgo} days ago)`;
      if (call.summary) callLine += ` - ${call.summary}`;
      if (call.outcome) callLine += ` [${call.outcome.toUpperCase()}]`;
      lines.push(callLine);
    }
  }
  
  // Past transcript highlights
  if (context.pastTranscripts?.length > 0) {
    lines.push('\n💬 WHAT THEY SAID IN PAST CALLS:');
    for (const transcript of context.pastTranscripts.slice(0, 2)) {
      lines.push(`   [${transcript.dateFormatted}] ${transcript.summary}`);
      // Include a few key caller quotes
      const callerQuotes = transcript.turns
        .filter(t => t.speaker === 'caller' && t.text && t.text.length > 20)
        .slice(0, 2);
      for (const quote of callerQuotes) {
        lines.push(`      Caller: "${truncate(quote.text, 100)}"`);
      }
    }
  }
  
  // Preferences
  const prefs = context.preferences;
  if (prefs.preferredTechnician || prefs.preferredTimeWindow || prefs.specialInstructions) {
    lines.push('\n⭐ PREFERENCES:');
    if (prefs.preferredTechnician) {
      lines.push(`   • Preferred technician: ${prefs.preferredTechnician}`);
    }
    if (prefs.preferredTimeWindow) {
      lines.push(`   • Preferred time: ${prefs.preferredTimeWindow}`);
    }
    if (prefs.specialInstructions) {
      lines.push(`   • Special instructions: ${prefs.specialInstructions}`);
    }
  }
  
  // AI Notes
  if (context.aiNotes?.length > 0) {
    lines.push('\n📝 THINGS TO REMEMBER:');
    for (const note of context.aiNotes.slice(0, 5)) {
      lines.push(`   • ${note.note}`);
    }
  }
  
  lines.push('\n═══════════════════════════════════════════════════════════════');
  lines.push('USE THIS CONTEXT TO:');
  lines.push('• Greet by name if appropriate');
  lines.push('• Reference past visits/issues naturally');
  lines.push('• Pre-fill known info (don\'t re-ask address if on file)');
  lines.push('• Mention preferred technician if relevant');
  lines.push('• Be aware of warranty status for service discussions');
  lines.push('═══════════════════════════════════════════════════════════════\n');
  
  return lines.join('\n');
}

function truncate(str, maxLen) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

// ============================================================================
// SAVE NEW LEARNINGS (After call completion)
// ============================================================================

/**
 * Save new insights learned during a call back to customer record
 * 
 * @param {ObjectId} companyId - Company ID
 * @param {ObjectId} customerId - Customer ID
 * @param {Object} learnings - New info to save
 */
async function saveCallLearnings(companyId, customerId, learnings) {
  try {
    if (!customerId) return;
    
    const updates = { $set: {}, $push: {}, $inc: {} };
    
    // Update name if we learned it
    if (learnings.name) {
      if (learnings.name.first) updates.$set['name.first'] = learnings.name.first;
      if (learnings.name.last) updates.$set['name.last'] = learnings.name.last;
      if (learnings.name.full) updates.$set['name.full'] = learnings.name.full;
    }
    
    // Add new address if collected
    if (learnings.address && learnings.address.street) {
      updates.$push.addresses = {
        street: learnings.address.street,
        city: learnings.address.city,
        state: learnings.address.state,
        zip: learnings.address.zip,
        notes: learnings.address.notes,
        isPrimary: false,
        createdAt: new Date()
      };
    }
    
    // Add AI notes
    if (learnings.notes && learnings.notes.length > 0) {
      for (const note of learnings.notes) {
        updates.$push.aiNotes = {
          note: note,
          source: 'ai_extracted',
          createdAt: new Date(),
          sessionId: learnings.sessionId
        };
      }
    }
    
    // Update metrics
    updates.$inc['metrics.totalCalls'] = 1;
    updates.$set['metrics.lastInteractionAt'] = new Date();
    updates.$set['metrics.lastInteractionChannel'] = 'voice';
    
    // Update preferences if mentioned
    if (learnings.preferredTechnician) {
      updates.$set['preferences.preferredTechnicianName'] = learnings.preferredTechnician;
    }
    if (learnings.preferredTime) {
      updates.$set['preferences.preferredTimeWindow'] = learnings.preferredTime;
    }
    
    // Remove empty operations
    if (Object.keys(updates.$set).length === 0) delete updates.$set;
    if (Object.keys(updates.$push).length === 0) delete updates.$push;
    if (Object.keys(updates.$inc).length === 0) delete updates.$inc;
    
    if (Object.keys(updates).length > 0) {
      await Customer.updateOne(
        { _id: customerId, companyId },
        updates
      );
      
      logger.info('[CUSTOMER CONTEXT] ✅ Saved call learnings', {
        customerId: customerId.toString(),
        updatedFields: Object.keys(updates).flatMap(op => Object.keys(updates[op]))
      });
    }
    
  } catch (error) {
    logger.error('[CUSTOMER CONTEXT] Failed to save learnings (non-fatal)', {
      customerId,
      error: error.message
    });
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  loadCustomerContext,
  formatForLLMPrompt,
  saveCallLearnings,
  CONFIG
};
