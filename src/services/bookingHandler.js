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
    
    // Determine urgency from extracted problem data
    const urgency = extracted.problem?.urgency || 'normal';
    const isEmergency = urgency === 'emergency';
    
    // Create appointment
    const appointment = await Appointment.create({
      companyId,
      contactId: contact._id,
      locationId: location._id,
      callId: ctx.callId,
      trade: ctx.trade || "",
      serviceType: extracted.serviceType || (isEmergency ? "emergency" : "repair"),
      status: "scheduled",
      scheduledDate: extracted.requestedDate || new Date().toISOString().split('T')[0],
      timeWindow: extracted.requestedWindow || "TBD",
      notesForTech: extracted.issueSummary || "",
      accessNotes: extracted.accessNotes || "",
      priority: isEmergency ? 'emergency' : determinePriority(extracted),
      urgencyScore: isEmergency ? 100 : calculateUrgencyScore(extracted)
    });
    
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
  calculateUrgencyScore
};

