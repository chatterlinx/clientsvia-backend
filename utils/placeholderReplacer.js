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
 * Replace all placeholders in text with their actual values
 * 
 * REFACTORED: Now reads exclusively from aiAgentSettings.variables (canonical source)
 * - Replaces: {variableName} and [variableName]
 * - Case-insensitive matching
 * - Handles both Mongoose Map and plain object
 * 
 * @param {string} text - Text containing placeholders like {Company Name} or [Company Name]
 * @param {Object} company - Company document with aiAgentSettings.variables
 * @returns {string} Text with placeholders replaced
 */
function replacePlaceholders(text, company) {
    if (!text || typeof text !== 'string') {
        return text;
    }

    let processedText = text;
    
    // Read from CANONICAL location: aiAgentSettings.variables
    const variables = company?.aiAgentSettings?.variables;
    
    if (!variables) {
        logger.debug(`[PLACEHOLDERS] No variables configured for company ${company?._id || 'unknown'}`);
        return processedText;
    }

    // Handle both Mongoose Map and plain object
    const entries = variables instanceof Map ? Array.from(variables.entries()) : Object.entries(variables);
    
    logger.debug(`[PLACEHOLDERS] Processing ${entries.length} variables for company ${company._id}`);

    let replacementCount = 0;

    // Replace each variable
    entries.forEach(([key, value]) => {
        if (!key || !value) {
            return; // Skip empty values
        }

        // Escape special regex characters in key
        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        // Match both [key] and {key}, case-insensitive
        // Pattern: [\[{]key[\]}]
        const regex = new RegExp(`[\\[{]\\s*${escapedKey}\\s*[\\]}]`, 'gi');
        
        const before = processedText;
        processedText = processedText.replace(regex, value);
        
        if (before !== processedText) {
            replacementCount++;
            logger.debug(`[PLACEHOLDERS] ✅ Replaced {${key}} → ${value}`);
        }
    });

    if (replacementCount > 0) {
        logger.info(`[PLACEHOLDERS] Successfully replaced ${replacementCount} placeholders in response`);
    }

    return processedText;
}

/**
 * Replace placeholders in multiple responses (array)
 * @param {Array<string>} responses - Array of response texts
 * @param {Object} company - Company document with aiAgentLogic.placeholders array
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
 * @param {Object} company - Company document with aiAgentLogic.placeholders array
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

