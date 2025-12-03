/**
 * PLACEHOLDER REPLACEMENT UTILITY
 * 
 * Purpose: Centralized placeholder replacement system for AI Agent responses
 * - Replaces {placeholder} syntax with actual values from company.aiAgentSettings.placeholders
 * - Supports both {braces} and [brackets] syntax for backward compatibility
 * - Case-insensitive matching
 * - Comprehensive logging for debugging
 * 
 * Usage:
 * const { replacePlaceholders } = require('../utils/placeholderReplacer');
 * const processedResponse = replacePlaceholders(response, company);
 * 
 * Integration Points:
 * - v2AIAgentRuntime.js (greeting and responses)
 * - AIBrain3tierllm.js (3-Tier Intelligence System)
 * - v2InstantResponseMatcher.js (instant responses)
 * 
 * Created: 2025-10-05
 */

const logger = require('./logger');

/**
 * Build system variables from company data
 * These are built-in variables that come directly from company fields
 * 
 * @param {Object} company - Company document
 * @returns {Object} System variables map
 */
function buildSystemVariables(company) {
    if (!company) return {};
    
    const systemVars = {
        // Core company info
        companyName: company.companyName || company.businessName || company.name || '',
        companyType: company.trade || company.companyType || company.industry || 'Service',
        trade: company.trade || 'Service',
        
        // Contact info
        mainPhone: company.phone || company.mainPhone || '',
        emergencyPhone: company.emergencyPhone || company.aiAgentSettings?.emergencyPhone || '',
        billingPhone: company.billingPhone || company.aiAgentSettings?.billingPhone || '',
        techSupportPhone: company.techSupportPhone || company.aiAgentSettings?.techSupportPhone || '',
        
        // Location & service
        serviceAreas: Array.isArray(company.serviceAreas) 
            ? company.serviceAreas.join(', ') 
            : (company.serviceAreas || ''),
        address: company.address || '',
        city: company.city || '',
        state: company.state || '',
        zipCode: company.zipCode || company.zip || '',
        
        // Business info
        businessHours: company.businessHours || company.hours || 'Monday-Friday 8am-5pm',
        greeting: company.greeting || company.aiAgentSettings?.greeting || `Thanks for calling ${company.companyName || 'us'}!`,
        
        // URLs
        bookingUrl: company.bookingUrl || company.aiAgentSettings?.bookingUrl || '',
        websiteUrl: company.websiteUrl || company.website || '',
        
        // Additional from aiAgentSettings
        ...(company.aiAgentSettings?.systemVariables || {})
    };
    
    return systemVars;
}

/**
 * Replace all placeholders in text with their actual values
 * 
 * ENHANCED: Now includes both SYSTEM variables and CUSTOM variables
 * - SYSTEM: {companyName}, {serviceAreas}, {emergencyPhone}, etc. (from company data)
 * - CUSTOM: User-defined variables from aiAgentSettings.variables
 * 
 * @param {string} text - Text containing placeholders like {companyName} or {serviceAreas}
 * @param {Object} company - Company document with aiAgentSettings.variables
 * @param {Object} additionalVars - Optional additional variables to substitute
 * @returns {string} Text with placeholders replaced
 */
function replacePlaceholders(text, company, additionalVars = {}) {
    if (!text || typeof text !== 'string') {
        return text;
    }

    let processedText = text;
    let replacementCount = 0;
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1: Apply SYSTEM variables (from company data)
    // ═══════════════════════════════════════════════════════════════════════
    const systemVars = buildSystemVariables(company);
    
    Object.entries(systemVars).forEach(([key, value]) => {
        if (!key || value === undefined || value === null) return;
        
        const stringValue = String(value);
        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`[\\[{]\\s*${escapedKey}\\s*[\\]}]`, 'gi');
        
        const before = processedText;
        processedText = processedText.replace(regex, stringValue);
        
        if (before !== processedText) {
            replacementCount++;
            logger.debug(`[PLACEHOLDERS] ✅ System: {${key}} → ${stringValue.substring(0, 50)}${stringValue.length > 50 ? '...' : ''}`);
        }
    });
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 2: Apply CUSTOM variables (from aiAgentSettings.variables)
    // ═══════════════════════════════════════════════════════════════════════
    const customVariables = company?.aiAgentSettings?.variables;
    
    if (customVariables) {
        const entries = customVariables instanceof Map 
            ? Array.from(customVariables.entries()) 
            : Object.entries(customVariables);
        
        entries.forEach(([key, value]) => {
            if (!key || value === undefined || value === null) return;
            
            const stringValue = String(value);
            const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`[\\[{]\\s*${escapedKey}\\s*[\\]}]`, 'gi');
            
            const before = processedText;
            processedText = processedText.replace(regex, stringValue);
            
            if (before !== processedText) {
                replacementCount++;
                logger.debug(`[PLACEHOLDERS] ✅ Custom: {${key}} → ${stringValue.substring(0, 50)}${stringValue.length > 50 ? '...' : ''}`);
            }
        });
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3: Apply ADDITIONAL variables (passed as parameter)
    // ═══════════════════════════════════════════════════════════════════════
    if (additionalVars && typeof additionalVars === 'object') {
        Object.entries(additionalVars).forEach(([key, value]) => {
            if (!key || value === undefined || value === null) return;
            
            const stringValue = String(value);
            const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`[\\[{]\\s*${escapedKey}\\s*[\\]}]`, 'gi');
            
            const before = processedText;
            processedText = processedText.replace(regex, stringValue);
            
            if (before !== processedText) {
                replacementCount++;
                logger.debug(`[PLACEHOLDERS] ✅ Additional: {${key}} → ${stringValue.substring(0, 50)}${stringValue.length > 50 ? '...' : ''}`);
            }
        });
    }
    
    if (replacementCount > 0) {
        logger.info(`[PLACEHOLDERS] ✅ Replaced ${replacementCount} placeholders for company ${company?._id || 'unknown'}`);
    } else {
        // Check for unreplaced placeholders
        const unreplacedMatches = processedText.match(/\{[^}]+\}/g);
        if (unreplacedMatches && unreplacedMatches.length > 0) {
            const uniqueUnreplaced = [...new Set(unreplacedMatches)];
            logger.warn(`[PLACEHOLDERS] ⚠️ ${uniqueUnreplaced.length} unreplaced placeholders found: ${uniqueUnreplaced.slice(0, 5).join(', ')}${uniqueUnreplaced.length > 5 ? '...' : ''}`);
        }
    }

    return processedText;
}

/**
 * Replace placeholders in multiple responses (array)
 * @param {Array<string>} responses - Array of response texts
 * @param {Object} company - Company document with aiAgentSettings.placeholders array
 * @returns {Array<string>} Array with placeholders replaced
 */
function replacePlaceholdersInArray(responses, company) {
    if (!Array.isArray(responses)) {
        return responses;
    }

    return responses.map(response => replacePlaceholders(response, company));
}

/**
 * Replace placeholders in an object's text properties
 * @param {Object} obj - Object with text properties that may contain placeholders
 * @param {Array<string>} textFields - Array of field names to process
 * @param {Object} company - Company document with aiAgentSettings.placeholders array
 * @returns {Object} Object with placeholders replaced in specified fields
 */
function replacePlaceholdersInObject(obj, textFields, company) {
    if (!obj || typeof obj !== 'object') {
        return obj;
    }

    const processed = { ...obj };

    textFields.forEach(field => {
        if (processed[field] && typeof processed[field] === 'string') {
            processed[field] = replacePlaceholders(processed[field], company);
        }
    });

    return processed;
}

module.exports = {
    replacePlaceholders,
    replacePlaceholdersInArray,
    replacePlaceholdersInObject
};

