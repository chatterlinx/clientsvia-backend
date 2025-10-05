/**
 * PLACEHOLDER REPLACEMENT UTILITY
 * 
 * Purpose: Centralized placeholder replacement system for AI Agent responses
 * - Replaces {placeholder} syntax with actual values from company.aiAgentLogic.placeholders
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
 * - v2priorityDrivenKnowledgeRouter.js (all knowledge sources)
 * - v2InstantResponseMatcher.js (instant responses)
 * 
 * Created: 2025-10-05
 */

const logger = require('./logger');

/**
 * Replace all placeholders in text with their actual values
 * @param {string} text - Text containing placeholders like {Company Name} or [Company Name]
 * @param {Object} company - Company document with aiAgentLogic.placeholders array
 * @returns {string} Text with placeholders replaced
 */
function replacePlaceholders(text, company) {
    if (!text || typeof text !== 'string') {
        return text;
    }

    let processedText = text;
    
    // Check if company has placeholders configured
    if (!company?.aiAgentLogic?.placeholders || !Array.isArray(company.aiAgentLogic.placeholders)) {
        logger.debug(`[PLACEHOLDERS] No placeholders configured for company ${company?._id || 'unknown'}`);
        return processedText;
    }

    const placeholders = company.aiAgentLogic.placeholders;
    logger.debug(`[PLACEHOLDERS] Processing ${placeholders.length} placeholders for company ${company._id}`);

    let replacementCount = 0;

    // Replace each placeholder
    placeholders.forEach(placeholder => {
        if (!placeholder.name || !placeholder.value) {
            return; // Skip invalid placeholders
        }

        // Escape special regex characters in placeholder name
        const escapedName = placeholder.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        // Match both [Placeholder Name] and {Placeholder Name}, case-insensitive
        // Pattern: [\[{]placeholder name[\]}]
        const regex = new RegExp(`[\\[{]\\s*${escapedName}\\s*[\\]}]`, 'gi');
        
        const before = processedText;
        processedText = processedText.replace(regex, placeholder.value);
        
        if (before !== processedText) {
            replacementCount++;
            logger.debug(`[PLACEHOLDERS] ✅ Replaced {${placeholder.name}} → ${placeholder.value}`);
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

