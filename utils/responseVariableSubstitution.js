/**
 * ═══════════════════════════════════════════════════════════════════════════
 * RESPONSE VARIABLE SUBSTITUTION
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Part of: Call Center Module V2
 * Created: December 2, 2025
 * 
 * PURPOSE:
 * ─────────────────────────────────────────────────────────────────────────────
 * Replace {variable} placeholders in AI responses with actual customer data.
 * 
 * Example:
 *   Input: "Hi {customerName}! Welcome back to {companyName}."
 *   Output: "Hi John Smith! Welcome back to ABC Plumbing."
 * 
 * CALLED BY:
 * - v2AIAgentRuntime (after generating response)
 * - Brain1Runtime (before sending TwiML)
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

const logger = require('./logger');

// Import existing placeholder replacer for company variables
const { replacePlaceholders } = require('./placeholderReplacer');

/**
 * Substitute all {variable} placeholders in a response text
 * 
 * @param {string} text - Text with {placeholders}
 * @param {Object} context - Context object containing customer and company data
 * @param {Object} context.customerContext - Customer data from CustomerLookup
 * @param {Object} context.company - Company data
 * @param {Object} context.callState - Current call state
 * @returns {string} - Text with placeholders replaced
 */
function substituteVariables(text, context = {}) {
  if (!text || typeof text !== 'string') {
    return text;
  }

  const { customerContext = {}, company = {}, callState = {} } = context;

  // Build variable map
  const variables = {
    // ─────────────────────────────────────────────────────────────────────────
    // COMPANY VARIABLES
    // ─────────────────────────────────────────────────────────────────────────
    companyName: company.companyName || company.businessName || 'our company',
    companyType: company.trade || company.industry || 'service',
    serviceAreas: Array.isArray(company.serviceAreas) 
      ? company.serviceAreas.join(', ') 
      : company.serviceAreas || 'your area',
    businessHours: company.businessHours || 'regular business hours',
    mainPhone: company.phoneNumber || company.mainPhone || '',
    emergencyPhone: company.emergencyPhone || company.afterHoursPhone || '',
    billingPhone: company.billingPhone || '',
    greeting: company.aiAgentSettings?.greeting?.default || 'Thank you for calling',
    bookingUrl: company.bookingUrl || '',

    // ─────────────────────────────────────────────────────────────────────────
    // CUSTOMER VARIABLES (from CustomerLookup)
    // ─────────────────────────────────────────────────────────────────────────
    isReturning: customerContext.isReturning || false,
    customerName: customerContext.customerName || customerContext.fullName || '',
    customerFirstName: customerContext.customerFirstName || customerContext.firstName || '',
    totalCalls: customerContext.totalCalls || 0,
    
    // Location
    city: customerContext.city || '',
    state: customerContext.state || '',
    hasAddress: customerContext.hasAddress || false,
    fullAddress: customerContext.fullAddress || '',
    
    // Phone type
    phoneType: customerContext.phoneType || 'unknown',
    canSms: customerContext.canSms || false,
    carrier: customerContext.carrier || '',
    
    // Access info
    accessNotes: customerContext.accessNotes || '',
    keyLocation: customerContext.keyLocation || '',
    gateCode: customerContext.gateCode || '',
    lockboxCode: customerContext.lockboxCode || '',
    petInfo: customerContext.petInfo || '',
    alternateContact: customerContext.alternateContact?.name 
      ? `${customerContext.alternateContact.name} (${customerContext.alternateContact.phone || 'no phone'})`
      : '',
    
    // Household
    isHouseholdMember: customerContext.isHouseholdMember || false,
    householdPrimaryName: customerContext.householdPrimaryName || '',
    householdMemberCount: customerContext.householdMemberCount || 0,
    
    // Multi-property
    hasMultipleProperties: customerContext.hasMultipleProperties || false,
    propertyCount: customerContext.propertyCount || 1,
    propertyNicknames: customerContext.propertyNicknames || '',
    
    // Commercial
    isCommercial: customerContext.isCommercial || false,
    businessName: customerContext.commercial?.businessName || '',
    locationName: customerContext.commercial?.locationName || '',
    
    // Status
    status: customerContext.status || 'unknown',
    lifetimeValue: customerContext.lifetimeValue || 0,
    
    // Tags and preferences
    tags: Array.isArray(customerContext.tags) ? customerContext.tags.join(', ') : '',
    specialNotes: customerContext.specialNotes || '',

    // ─────────────────────────────────────────────────────────────────────────
    // CALL STATE VARIABLES
    // ─────────────────────────────────────────────────────────────────────────
    turnCount: callState.turnCount || 1,
    currentIntent: callState.currentIntent || '',
    
    // Extracted entities from conversation
    extractedName: callState.extracted?.contact?.name || '',
    extractedPhone: callState.extracted?.contact?.phone || '',
    extractedAddress: callState.extracted?.location?.addressLine1 || '',
    extractedCity: callState.extracted?.location?.city || '',
    extractedState: callState.extracted?.location?.state || '',
    extractedProblem: callState.extracted?.problem?.summary || '',
    extractedUrgency: callState.extracted?.problem?.urgency || 'normal',
    preferredDate: callState.extracted?.scheduling?.preferredDate || '',
    preferredWindow: callState.extracted?.scheduling?.preferredWindow || ''
  };

  // Count substitutions for logging
  let substitutionCount = 0;

  // Replace all {variable} patterns
  const result = text.replace(/\{(\w+)\}/g, (match, varName) => {
    if (variables.hasOwnProperty(varName)) {
      const value = variables[varName];
      
      // Handle booleans specially
      if (typeof value === 'boolean') {
        substitutionCount++;
        return value ? 'true' : 'false';
      }
      
      // Handle empty values - keep placeholder or use sensible default
      if (value === '' || value === null || value === undefined) {
        // For some variables, keeping the placeholder is fine
        // For others, we should remove or use a default
        const skipEmptyVars = ['customerName', 'customerFirstName', 'city', 'state', 'accessNotes'];
        if (skipEmptyVars.includes(varName)) {
          return ''; // Remove empty name/location placeholders
        }
        return match; // Keep other placeholders
      }
      
      substitutionCount++;
      return String(value);
    }
    
    // Unknown variable - keep as-is
    logger.debug('[VARIABLE_SUB] Unknown variable', { variable: varName });
    return match;
  });

  // Log if we made substitutions
  if (substitutionCount > 0) {
    logger.debug('[VARIABLE_SUB] Substituted variables', {
      count: substitutionCount,
      inputLength: text.length,
      outputLength: result.length,
      hadCustomerName: !!customerContext.customerName,
      isReturning: customerContext.isReturning
    });
  }

  return result;
}

/**
 * Quick substitution for just customer greeting
 * Used for initial greeting personalization
 * 
 * @param {string} greeting - Greeting text with placeholders
 * @param {Object} customerContext - Customer data
 * @param {Object} company - Company data
 * @returns {string} - Personalized greeting
 */
function personalizeGreeting(greeting, customerContext, company) {
  if (!greeting) return greeting;

  // Quick substitutions for common greeting patterns
  let result = greeting;

  // Company name
  const companyName = company?.companyName || company?.businessName || 'our company';
  result = result.replace(/\{companyName\}/gi, companyName);

  // Customer personalization
  if (customerContext?.isReturning && customerContext?.customerFirstName) {
    // Returning customer with name
    result = result.replace(/\{customerFirstName\}/gi, customerContext.customerFirstName);
    result = result.replace(/\{customerName\}/gi, customerContext.customerName || customerContext.customerFirstName);
    
    // Add welcome back if not already present
    if (!result.toLowerCase().includes('welcome back') && !result.toLowerCase().includes('good to hear from you')) {
      // Optionally inject "welcome back" - but be careful not to be too aggressive
    }
  } else {
    // New customer - remove name placeholders
    result = result.replace(/\{customerFirstName\}/gi, '');
    result = result.replace(/\{customerName\}/gi, '');
    result = result.replace(/Hi\s+,/gi, 'Hi,'); // Clean up "Hi ,"
    result = result.replace(/Hello\s+,/gi, 'Hello,'); // Clean up "Hello ,"
  }

  // Clean up double spaces
  result = result.replace(/\s+/g, ' ').trim();

  return result;
}

/**
 * Check if text contains any unsubstituted variables
 * Useful for validation/debugging
 * 
 * @param {string} text - Text to check
 * @returns {string[]} - Array of unsubstituted variable names
 */
function findUnsubstitutedVariables(text) {
  if (!text) return [];
  
  const matches = text.match(/\{(\w+)\}/g) || [];
  return matches.map(m => m.slice(1, -1)); // Remove { }
}

/**
 * Build a substitution context from callState and company
 * Convenience method for runtime
 * 
 * @param {Object} callState - Current call state
 * @param {Object} company - Company document
 * @returns {Object} - Context object for substituteVariables
 */
function buildSubstitutionContext(callState, company) {
  return {
    customerContext: callState.customerContext || {},
    company: company || {},
    callState: callState || {}
  };
}

/**
 * Full substitution pipeline - company variables + customer variables
 * Use this as the main entry point for response processing
 * 
 * @param {string} text - Text with placeholders
 * @param {Object} context - Context with customerContext, company, callState
 * @returns {string} - Fully substituted text
 */
function fullSubstitution(text, context = {}) {
  if (!text) return text;

  let result = text;

  // Step 1: Replace company-level placeholders from aiAgentSettings.variables
  if (context.company) {
    result = replacePlaceholders(result, context.company);
  }

  // Step 2: Replace customer-level placeholders
  result = substituteVariables(result, context);

  return result;
}

module.exports = {
  substituteVariables,
  personalizeGreeting,
  findUnsubstitutedVariables,
  buildSubstitutionContext,
  fullSubstitution
};

