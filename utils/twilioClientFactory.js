// utils/twilioClientFactory.js
// Factory for creating per-company Twilio clients

const twilio = require('twilio');
const logger = require('./logger.js');


/**
 * Create a Twilio client for a specific company
 * @param {Object} company - Company object with twilioConfig
 * @returns {Object|null} - Twilio client or null if not configured
 */
function createTwilioClient(company) {
    if (!company?.twilioConfig) {
        logger.security('[Twilio] No twilioConfig found for company:', company?.companyName);
        return null;
    }

    const { accountSid, authToken, apiKey, apiSecret } = company.twilioConfig;

    try {
        // Option 1: Use API Key + Secret (recommended for production)
        if (apiKey && apiSecret) {
            logger.security('[Twilio] Creating client with API Key for:', company.companyName);
            return twilio(apiKey, apiSecret, { accountSid });
        }
        
        // Option 2: Use Account SID + Auth Token (basic auth)
        if (accountSid && authToken) {
            logger.security('[Twilio] Creating client with Auth Token for:', company.companyName);
            return twilio(accountSid, authToken);
        }

        logger.security('[Twilio] Missing credentials for company:', company.companyName);
        return null;

    } catch (error) {
        logger.error('[Twilio] Failed to create client for company:', company.companyName, error.message);
        return null;
    }
}

/**
 * Get primary phone number for a company
 * @param {Object} company - Company object
 * @returns {string|null} - Primary phone number or null
 */
function getPrimaryPhoneNumber(company) {
    if (!company?.twilioConfig?.phoneNumbers?.length) {
        return company?.twilioConfig?.phoneNumber || null; // Fallback to legacy field
    }

    // Find primary phone number
    const primary = company.twilioConfig.phoneNumbers.find(phone => phone.isPrimary);
    return primary?.phoneNumber || company.twilioConfig.phoneNumbers[0]?.phoneNumber || null;
}

module.exports = {
    createTwilioClient,
    getPrimaryPhoneNumber
};
