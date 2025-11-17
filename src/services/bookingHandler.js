/**
 * ============================================================================
 * BOOKING HANDLER - APPOINTMENT CREATION FROM CALLS
 * ============================================================================
 * 
 * PURPOSE: Create/update contacts, locations, and appointments from call context
 * ARCHITECTURE: Skeleton implementation for Phase 1
 * FUTURE: Will integrate with calendar, SMS confirmations, tech dispatch
 * 
 * ============================================================================
 */

const Contact = require('../../models/v2Contact'); // Use existing v2Contact model
const Location = require('../../models/Location');
const Appointment = require('../../models/Appointment');
const Company = require('../../models/Company');
const logger = require('../../utils/logger');

/**
 * Create or update contact based on extracted context
 * Uses existing v2Contact model which has comprehensive fields
 * @param {string} companyId
 * @param {import("../core/frontlineTypes").ExtractedContext} extracted
 * @returns {Promise<Object>} Contact document
 */
async function resolveContact(companyId, extracted) {
  try {
    // If contactId already exists in extracted data, fetch it
    if (extracted.contactId) {
      const existing = await Contact.findById(extracted.contactId);
      if (existing) {
        logger.info(`[BOOKING HANDLER] Using existing contact: ${extracted.contactId}`);
        return existing;
      }
    }
    
    // If no phone number, create minimal contact
    if (!extracted.callerPhone) {
      const contact = await Contact.create({
        companyId,
        fullName: extracted.callerName || "Unknown Caller",
        primaryPhone: "Unknown",
        status: 'new_lead',
        leadSource: 'phone_call'
      });
      
      logger.info(`[BOOKING HANDLER] Created contact without phone: ${contact._id}`);
      return contact;
    }
    
    // Look up by phone number
    let contact = await Contact.findByPhone(companyId, extracted.callerPhone);
    
    if (!contact) {
      // Create new contact
      contact = await Contact.create({
        companyId,
        fullName: extracted.callerName || "Unknown",
        primaryPhone: extracted.callerPhone,
        email: extracted.email || null,
        status: 'new_lead',
        leadSource: 'phone_call',
        extractedData: {
          hasEmergency: false,
          mentionedKeywords: extracted.symptoms || [],
          callSummary: extracted.issueSummary || ""
        }
      });
      
      logger.info(`[BOOKING HANDLER] Created new contact: ${contact._id}`, {
        companyId,
        phone: extracted.callerPhone
      });
    } else {
      // Update existing contact if name changed
      let updated = false;
      
      if (extracted.callerName && contact.fullName !== extracted.callerName) {
        contact.fullName = extracted.callerName;
        updated = true;
      }
      
      // Mark as returning customer
      if (extracted.isReturningCustomer) {
        contact.status = 'customer';
        updated = true;
      }
      
      if (updated) {
        await contact.save();
        logger.info(`[BOOKING HANDLER] Updated existing contact: ${contact._id}`);
      } else {
        logger.info(`[BOOKING HANDLER] Using existing contact: ${contact._id}`);
      }
    }
    
    return contact;
  } catch (error) {
    logger.error(`[BOOKING HANDLER] Failed to resolve contact`, {
      error: error.message,
      stack: error.stack,
      companyId,
      extracted
    });
    throw error;
  }
}

/**
 * Create or update location based on extracted context
 * @param {string} companyId
 * @param {import("../core/frontlineTypes").ExtractedContext} extracted
 * @param {string} contactId - Contact ObjectId
 * @returns {Promise<Object>} Location document
 */
async function resolveLocation(companyId, extracted, contactId) {
  try {
    // If locationId already exists in extracted data, fetch it
    if (extracted.locationId) {
      const existing = await Location.findById(extracted.locationId);
      if (existing) {
        logger.info(`[BOOKING HANDLER] Using existing location: ${extracted.locationId}`);
        return existing;
      }
    }
    
    // Require at least addressLine1 and postalCode for location lookup
    if (!extracted.addressLine1 || !extracted.postalCode) {
      // Create placeholder location
      const location = await Location.create({
        companyId,
        addressLine1: extracted.addressLine1 || "Address TBD",
        addressLine2: extracted.addressLine2 || "",
        city: extracted.city || "",
        state: extracted.state || "",
        postalCode: extracted.postalCode || "",
        contactId,
        accessProfile: {
          notes: extracted.accessNotes || ""
        }
      });
      
      logger.info(`[BOOKING HANDLER] Created placeholder location: ${location._id}`);
      return location;
    }
    
    // Look up existing location by address
    let location = await Location.findByAddress(
      companyId, 
      extracted.addressLine1, 
      extracted.postalCode
    );
    
    if (!location) {
      // Create new location
      location = await Location.create({
        companyId,
        addressLine1: extracted.addressLine1,
        addressLine2: extracted.addressLine2 || "",
        city: extracted.city || "",
        state: extracted.state || "",
        postalCode: extracted.postalCode,
        contactId,
        accessProfile: {
          notes: extracted.accessNotes || ""
        },
        locationType: 'residential' // Default, can be updated later
      });
      
      logger.info(`[BOOKING HANDLER] Created new location: ${location._id}`, {
        companyId,
        address: extracted.addressLine1
      });
    } else {
      // Update existing location
      let updated = false;
      
      // Update contact association if different
      if (contactId && (!location.contactId || location.contactId.toString() !== contactId.toString())) {
        location.contactId = contactId;
        updated = true;
      }
      
      // Update access notes if provided
      if (extracted.accessNotes) {
        if (!location.accessProfile) {
          location.accessProfile = {};
        }
        location.accessProfile.notes = extracted.accessNotes;
        updated = true;
      }
      
      if (updated) {
        await location.save();
        logger.info(`[BOOKING HANDLER] Updated existing location: ${location._id}`);
      } else {
        logger.info(`[BOOKING HANDLER] Using existing location: ${location._id}`);
      }
    }
    
    return location;
  } catch (error) {
    logger.error(`[BOOKING HANDLER] Failed to resolve location`, {
      error: error.message,
      stack: error.stack,
      companyId,
      extracted
    });
    throw error;
  }
}

/**
 * ============================================================================
 * BOOKING RULES INTEGRATION - V2 CHEAT SHEET
 * ============================================================================
 */

/**
 * Select applicable booking rule based on trade, service type, and scheduling context
 * @param {Array} bookingRules - Array of booking rules from cheatSheet.bookingRules
 * @param {Object} context - Booking context
 * @param {string} context.trade - Trade category (e.g., "HVAC Residential")
 * @param {string} context.serviceType - Service type (e.g., "Repair", "Maintenance")
 * @param {string} context.priority - Priority level ("normal", "high", "emergency")
 * @param {Date} context.requestedDate - Requested appointment date
 * @param {boolean} context.isEmergency - Whether this is an emergency request
 * @returns {Object|null} Selected booking rule or null
 */
function selectBookingRule(bookingRules, context) {
  if (!Array.isArray(bookingRules) || bookingRules.length === 0) {
    logger.info('[BOOKING] No booking rules configured');
    return null;
  }
  
  logger.info(`[BOOKING] Rules available: ${bookingRules.length}`);
  logger.info(`[BOOKING] Matching context:`, {
    trade: context.trade,
    serviceType: context.serviceType,
    priority: context.priority,
    requestedDate: context.requestedDate,
    isEmergency: context.isEmergency
  });
  
  // Filter rules by trade and serviceType
  const candidateRules = bookingRules.filter(rule => {
    // Match trade (empty/null means "any trade")
    const tradeMatches = !rule.trade || rule.trade === '' || rule.trade === context.trade;
    
    // Match serviceType (empty/null means "any serviceType")
    const serviceTypeMatches = !rule.serviceType || rule.serviceType === '' || rule.serviceType === context.serviceType;
    
    return tradeMatches && serviceTypeMatches;
  });
  
  logger.info(`[BOOKING] Candidate rules after trade/service filter: ${candidateRules.length}`);
  
  if (candidateRules.length === 0) {
    logger.info('[BOOKING] No matching rules found, using default behavior');
    return null;
  }
  
  // Sort by priority: emergency > high > normal
  const priorityOrder = { 'emergency': 0, 'high': 1, 'normal': 2 };
  const sortedRules = candidateRules.sort((a, b) => {
    const aPriority = priorityOrder[a.priority || 'normal'];
    const bPriority = priorityOrder[b.priority || 'normal'];
    return aPriority - bPriority;
  });
  
  // Find first rule that passes all checks
  for (const rule of sortedRules) {
    const checks = validateBookingRule(rule, context);
    
    if (checks.isValid) {
      logger.info(`[BOOKING] Selected rule: "${rule.label}" (priority=${rule.priority || 'normal'}, days=${(rule.daysOfWeek || []).join(',')}, time=${rule.timeWindow?.start || '--'}–${rule.timeWindow?.end || '--'})`, {
        ruleId: rule.id,
        trade: rule.trade || 'any',
        serviceType: rule.serviceType || 'any'
      });
      
      return rule;
    } else {
      logger.info(`[BOOKING] Rule "${rule.label}" failed validation:`, checks.reasons);
    }
  }
  
  logger.info('[BOOKING] No rules passed validation, using default behavior');
  return null;
}

/**
 * Validate if a booking rule is applicable for the given context
 * @param {Object} rule - Booking rule to validate
 * @param {Object} context - Booking context
 * @returns {Object} Validation result with isValid flag and reasons
 */
function validateBookingRule(rule, context) {
  const reasons = [];
  
  // Check days of week
  if (context.requestedDate && Array.isArray(rule.daysOfWeek) && rule.daysOfWeek.length > 0) {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const requestedDay = dayNames[new Date(context.requestedDate).getDay()];
    
    if (!rule.daysOfWeek.includes(requestedDay)) {
      reasons.push(`Requested day ${requestedDay} not in allowed days: ${rule.daysOfWeek.join(',')}`);
    }
  }
  
  // Check weekend allowed
  if (context.requestedDate && rule.weekendAllowed === false) {
    const dayOfWeek = new Date(context.requestedDate).getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      reasons.push('Weekend booking not allowed by this rule');
    }
  }
  
  // Check same-day allowed
  if (rule.sameDayAllowed === false) {
    const today = new Date().toISOString().split('T')[0];
    const requestedDay = new Date(context.requestedDate).toISOString().split('T')[0];
    
    if (requestedDay === today) {
      reasons.push('Same-day booking not allowed by this rule');
    }
  }
  
  // Time window check is less strict (we don't have exact time, just date)
  // This can be enhanced later when we have specific time requests
  
  return {
    isValid: reasons.length === 0,
    reasons
  };
}

/**
 * ============================================================================
 * COMPANY CONTACTS INTEGRATION - V2 CHEAT SHEET
 * ============================================================================
 */

/**
 * Get primary contacts for transfer/notification based on criteria
 * @param {Array} companyContacts - Array of contacts from cheatSheet.companyContacts
 * @param {Object} options - Selection criteria
 * @param {boolean} options.afterHours - Filter for after-hours contacts
 * @param {boolean} options.smsOnly - Filter for SMS-enabled contacts
 * @param {string} options.role - Filter by role (e.g., 'dispatcher', 'tech')
 * @returns {Array} Sorted array of matching contacts (by priority)
 */
function getPrimaryContacts(companyContacts, options = {}) {
  if (!Array.isArray(companyContacts) || companyContacts.length === 0) {
    logger.warn('[CONTACTS] No company contacts configured');
    return [];
  }
  
  logger.info(`[CONTACTS] Total company contacts: ${companyContacts.length}`);
  
  let filtered = companyContacts;
  
  // Filter by contact type
  if (!options.smsOnly) {
    filtered = filtered.filter(c => 
      c.type === 'phone' || c.type === 'mobile' || c.type === 'sms-only'
    );
  } else {
    filtered = filtered.filter(c => c.smsEnabled === true);
  }
  
  // Filter by after-hours if specified
  if (options.afterHours) {
    filtered = filtered.filter(c => c.isAfterHours === true);
    logger.info(`[CONTACTS] After-hours contacts available: ${filtered.length}`);
  }
  
  // Filter by role if specified
  if (options.role) {
    filtered = filtered.filter(c => c.role === options.role);
    logger.info(`[CONTACTS] Contacts with role "${options.role}": ${filtered.length}`);
  }
  
  // Sort by priority (lower number = higher priority)
  const sorted = filtered.sort((a, b) => (a.priority || 99) - (b.priority || 99));
  
  if (sorted.length > 0) {
    logger.info(`[CONTACTS] Selected contact for ${options.afterHours ? 'after-hours' : 'normal'} ${options.smsOnly ? 'SMS' : 'transfer'}: "${sorted[0].label}" ${sorted[0].phoneNumber}`, {
      role: sorted[0].role,
      isPrimary: sorted[0].isPrimary,
      priority: sorted[0].priority || 99
    });
  }
  
  return sorted;
}

/**
 * Normalize extracted context from orchestrator format to legacy format
 * Supports both Phase 1 (flat) and Phase 3 (nested) formats
 * @param {Object} extracted - Extracted context (either format)
 * @returns {Object} Normalized extracted context
 */
function normalizeExtractedContext(extracted) {
  // If already in flat format (Phase 1), return as-is
  if (extracted.callerName || extracted.callerPhone || extracted.addressLine1) {
    return extracted;
  }
  
  // Convert from nested orchestrator format (Phase 3) to flat format
  return {
    callerName: extracted.contact?.name || extracted.callerName,
    callerPhone: extracted.contact?.phone || extracted.callerPhone,
    email: extracted.contact?.email || extracted.email,
    addressLine1: extracted.location?.addressLine1 || extracted.addressLine1,
    addressLine2: extracted.location?.addressLine2 || extracted.addressLine2,
    city: extracted.location?.city || extracted.city,
    state: extracted.location?.state || extracted.state,
    postalCode: extracted.location?.zip || extracted.location?.postalCode || extracted.postalCode,
    issueSummary: extracted.problem?.summary || extracted.issueSummary,
    symptoms: extracted.symptoms || [],
    serviceType: extracted.problem?.category || extracted.serviceType,
    requestedDate: extracted.scheduling?.preferredDate || extracted.requestedDate,
    requestedWindow: extracted.scheduling?.preferredWindow || extracted.requestedWindow,
    accessNotes: extracted.access?.notes || extracted.accessNotes,
    isReturningCustomer: extracted.isReturningCustomer,
    contactId: extracted.contactId,
    locationId: extracted.locationId
  };
}

/**
 * Book an appointment from the current context
 * Phase 1: Basic booking without advanced business rules
 * Phase 3: Enhanced to support orchestrator nested format
 * Future phases will add:
 * - Calendar integration
 * - Technician availability
 * - Service type validation
 * - SMS confirmations
 * - Pricing estimation
 * 
 * @param {import("../core/frontlineTypes").FrontlineContext} ctx
 * @returns {Promise<Object>} Appointment document
 */
async function handleBookingFromContext(ctx) {
  try {
    const companyId = ctx.companyId;
    
    // Normalize extracted context (supports both Phase 1 flat and Phase 3 nested formats)
    const extracted = normalizeExtractedContext(ctx.extracted);
    
    logger.info(`[BOOKING HANDLER] Starting booking from context`, {
      callId: ctx.callId,
      companyId,
      readyToBook: ctx.readyToBook,
      hasContact: !!(extracted.callerName || extracted.callerPhone),
      hasLocation: !!extracted.addressLine1,
      hasServiceInfo: !!extracted.issueSummary
    });
    
    // ═══════════════════════════════════════════════════════════════════
    // LOAD CHEAT SHEET (BOOKING RULES + COMPANY CONTACTS)
    // ═══════════════════════════════════════════════════════════════════
    
    let cheatSheet = {};
    let bookingRules = [];
    let companyContacts = [];
    let selectedBookingRule = null;
    
    try {
      const company = await Company.findById(companyId);
      if (company && company.aiAgentSettings && company.aiAgentSettings.cheatSheet) {
        cheatSheet = company.aiAgentSettings.cheatSheet;
        bookingRules = Array.isArray(cheatSheet.bookingRules) ? cheatSheet.bookingRules : [];
        companyContacts = Array.isArray(cheatSheet.companyContacts) ? cheatSheet.companyContacts : [];
        
        logger.info('[BOOKING HANDLER] Cheat sheet loaded', {
          bookingRules: bookingRules.length,
          companyContacts: companyContacts.length
        });
      } else {
        logger.info('[BOOKING HANDLER] No cheat sheet configured, using default behavior');
      }
    } catch (cheatSheetError) {
      logger.error('[BOOKING HANDLER] Failed to load cheat sheet, falling back to default behavior', {
        error: cheatSheetError.message
      });
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // SELECT BOOKING RULE (IF CONFIGURED)
    // ═══════════════════════════════════════════════════════════════════
    
    const urgency = extracted.problem?.urgency || 'normal';
    const isEmergency = urgency === 'emergency';
    const requestedDate = extracted.requestedDate || new Date().toISOString().split('T')[0];
    
    if (bookingRules.length > 0) {
      const bookingContext = {
        trade: ctx.trade || "",
        serviceType: extracted.serviceType || (isEmergency ? "emergency" : "repair"),
        priority: isEmergency ? 'emergency' : 'normal',
        requestedDate: requestedDate,
        isEmergency: isEmergency
      };
      
      selectedBookingRule = selectBookingRule(bookingRules, bookingContext);
    }
    
    // PRODUCTION HARDENING: Check for existing appointment (idempotency)
    // If this call already has an appointment, return it instead of creating duplicate
    if (ctx.appointmentId) {
      logger.info(`[BOOKING HANDLER] Appointment already exists for this call`, {
        callId: ctx.callId,
        appointmentId: ctx.appointmentId
      });
      
      const existingAppointment = await Appointment.findById(ctx.appointmentId);
      if (existingAppointment) {
        logger.info(`[BOOKING HANDLER] Returning existing appointment`, {
          appointmentId: existingAppointment._id,
          scheduledDate: existingAppointment.scheduledDate
        });
        return existingAppointment;
      }
    }
    
    // Also check by callId (in case context is out of sync)
    const existingByCallId = await Appointment.findOne({ companyId, callId: ctx.callId });
    if (existingByCallId) {
      logger.info(`[BOOKING HANDLER] Found existing appointment by callId`, {
        callId: ctx.callId,
        appointmentId: existingByCallId._id
      });
      
      // Update context with appointment ID
      ctx.appointmentId = existingByCallId._id.toString();
      return existingByCallId;
    }
    
    // Validate minimum required data
    if (!extracted.callerName && !extracted.callerPhone) {
      logger.warn(`[BOOKING HANDLER] Missing contact info`, { callId: ctx.callId });
    }
    
    if (!extracted.addressLine1) {
      logger.warn(`[BOOKING HANDLER] Missing address info`, { callId: ctx.callId });
    }
    
    // Resolve contact
    const contact = await resolveContact(companyId, extracted);
    
    // Resolve location
    const location = await resolveLocation(companyId, extracted, contact._id);
    
    // Create appointment with booking rule metadata
    const appointmentData = {
      companyId,
      contactId: contact._id,
      locationId: location._id,
      callId: ctx.callId,
      trade: ctx.trade || "",
      serviceType: extracted.serviceType || (isEmergency ? "emergency" : "repair"),
      status: "scheduled",
      scheduledDate: requestedDate,
      timeWindow: extracted.requestedWindow || "TBD",
      notesForTech: extracted.issueSummary || "",
      accessNotes: extracted.accessNotes || "",
      priority: isEmergency ? 'emergency' : determinePriority(extracted),
      urgencyScore: isEmergency ? 100 : calculateUrgencyScore(extracted)
    };
    
    // Add booking rule metadata if rule was selected
    if (selectedBookingRule) {
      appointmentData.bookingRuleApplied = {
        ruleId: selectedBookingRule.id,
        label: selectedBookingRule.label,
        trade: selectedBookingRule.trade || 'any',
        serviceType: selectedBookingRule.serviceType || 'any',
        priority: selectedBookingRule.priority || 'normal',
        notes: selectedBookingRule.notes || ''
      };
      
      logger.info('[BOOKING HANDLER] Applied booking rule to appointment', {
        ruleId: selectedBookingRule.id,
        ruleLabel: selectedBookingRule.label
      });
    }
    
    const appointment = await Appointment.create(appointmentData);
    
    logger.info(`[BOOKING HANDLER] Created appointment: ${appointment._id}`, {
      companyId,
      contactId: contact._id,
      locationId: location._id,
      scheduledDate: appointment.scheduledDate,
      serviceType: appointment.serviceType,
      priority: appointment.priority,
      urgencyScore: appointment.urgencyScore
    });
    
    // Update context with appointment ID
    ctx.appointmentId = appointment._id.toString();
    
    // TODO Phase 4: Send SMS confirmation
    // TODO Phase 4: Add to calendar
    // TODO Phase 4: Notify dispatch/technician
    
    return appointment;
  } catch (error) {
    logger.error(`[BOOKING HANDLER] Failed to handle booking from context`, {
      error: error.message,
      stack: error.stack,
      callId: ctx.callId,
      companyId: ctx.companyId
    });
    throw error;
  }
}

/**
 * Determine appointment priority from extracted context
 * @param {import("../core/frontlineTypes").ExtractedContext} extracted
 * @returns {string} Priority level
 */
function determinePriority(extracted) {
  // Check for emergency keywords in symptoms or issue summary
  const emergencyKeywords = [
    'emergency', 'urgent', 'flooding', 'leak', 'burst', 'fire', 
    'electrical', 'gas', 'dangerous', 'immediately'
  ];
  
  const text = [
    ...(extracted.symptoms || []),
    extracted.issueSummary || ""
  ].join(' ').toLowerCase();
  
  const hasEmergency = emergencyKeywords.some(keyword => text.includes(keyword));
  
  if (hasEmergency) {
    return 'emergency';
  }
  
  if (extracted.serviceType === 'emergency') {
    return 'emergency';
  }
  
  if (extracted.serviceType === 'repair') {
    return 'high';
  }
  
  return 'routine';
}

/**
 * Calculate urgency score (0-100) from extracted context
 * @param {import("../core/frontlineTypes").ExtractedContext} extracted
 * @returns {number} Urgency score
 */
function calculateUrgencyScore(extracted) {
  let score = 50; // Base score
  
  // Emergency keywords boost
  const emergencyKeywords = ['emergency', 'urgent', 'immediately'];
  const text = [
    ...(extracted.symptoms || []),
    extracted.issueSummary || ""
  ].join(' ').toLowerCase();
  
  emergencyKeywords.forEach(keyword => {
    if (text.includes(keyword)) score += 15;
  });
  
  // Service type boost
  if (extracted.serviceType === 'emergency') score += 30;
  else if (extracted.serviceType === 'repair') score += 10;
  
  // Requested date boost (sooner = higher score)
  if (extracted.requestedDate) {
    const requested = new Date(extracted.requestedDate);
    const today = new Date();
    const daysUntil = Math.ceil((requested - today) / (1000 * 60 * 60 * 24));
    
    if (daysUntil <= 0) score += 20;
    else if (daysUntil === 1) score += 15;
    else if (daysUntil <= 3) score += 10;
  }
  
  // Cap at 100
  return Math.min(100, Math.max(0, score));
}

module.exports = {
  handleBookingFromContext,
  resolveContact,
  resolveLocation,
  determinePriority,
  calculateUrgencyScore,
  selectBookingRule,
  validateBookingRule,
  getPrimaryContacts
};

