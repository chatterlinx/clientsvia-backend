/**
 * ============================================================================
 * FRONTLINE CONTEXT TYPES - CALL ENGINE SPINE
 * ============================================================================
 * 
 * PURPOSE: Shared type definitions for live call context
 * ARCHITECTURE: JSDoc-based typing for JS compatibility
 * SCOPE: Used across call engine services
 * 
 * ============================================================================
 */

/**
 * @typedef {Object} TranscriptTurn
 * @property {"caller"|"agent"} role
 * @property {string} text
 * @property {number} [timestamp] - Unix timestamp in ms
 */

/**
 * @typedef {Object} TierResolution
 * @property {1|2|3} tier - Intelligence tier used (1=Rules, 2=Semantic, 3=LLM)
 * @property {number} confidence - Match confidence 0-1
 * @property {string} [sourceId] - Triage card ID, KB doc ID, etc
 * @property {string} [answerText] - Response provided
 * @property {string} [reasoning] - Why this tier was selected
 */

/**
 * @typedef {Object} ExtractedContext
 * @property {string} [callerName]
 * @property {string} [callerPhone]
 * @property {string} [addressLine1]
 * @property {string} [addressLine2]
 * @property {string} [city]
 * @property {string} [state]
 * @property {string} [postalCode]
 * @property {string} [locationId] - Link to Location doc if exists
 * @property {string} [contactId] - Link to Contact doc if exists
 * @property {string} [issueSummary] - Short text, e.g. "no cool, buzzing noise"
 * @property {string[]} [symptoms] - Tokens from triage
 * @property {string} [serviceType] - "repair", "maintenance", "install", "emergency"
 * @property {string} [requestedDate] - ISO date string
 * @property {string} [requestedWindow] - "8-10", "10-12", etc
 * @property {string} [accessNotes] - Gate code, pets, alarms
 * @property {boolean} [isReturningCustomer]
 */

/**
 * @typedef {Object} FrontlineContext
 * @property {string} callId - Twilio Call SID
 * @property {string} companyId
 * @property {string} [trade] - "hvac", "plumbing", etc
 * @property {string} [currentIntent] - "booking", "update", "info", "troubleshooting", "billing", "other"
 * @property {ExtractedContext} extracted - Extracted data from conversation
 * @property {string[]} triageMatches - Array of triage card IDs matched
 * @property {TierResolution[]} tierTrace - History of tier resolutions
 * @property {TranscriptTurn[]} transcript - Full conversation transcript
 * @property {boolean} readyToBook - Whether all booking info is collected
 * @property {string} [appointmentId] - Filled once booking is created
 * @property {number} configVersion - Which AiCore config version used
 * @property {number} createdAt - Unix timestamp in ms
 * @property {number} updatedAt - Unix timestamp in ms
 */

// Export types for use in other modules
module.exports = {
  // Type definitions exported for JSDoc reference
  // Actual exports are documentation only - types are JSDoc comments
};

