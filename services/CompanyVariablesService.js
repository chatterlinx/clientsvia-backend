// services/CompanyVariablesService.js
// 🎯 CANONICAL COMPANY VARIABLES SERVICE
// Single source of truth for reading and writing company-specific AI Agent variables
// 
// PURPOSE:
// - Centralized read/write for aiAgentSettings.variables (Map) and variableDefinitions (Array)
// - Handles legacy data migration from configuration.variables, aiAgentLogic.placeholders, etc.
// - Enforces validation using variableValidators.js
// - Auto-clears Redis cache on writes
//
// CANONICAL FIELDS (v2Company.js):
// - company.aiAgentSettings.variables (Map<String, String>) ← VALUES
// - company.aiAgentSettings.variableDefinitions (Array) ← METADATA
//
// LEGACY FIELDS (READ-ONLY, DO NOT WRITE):
// - company.configuration.variables
// - company.aiAgentSettings.placeholders
// - company.aiAgentSettings.variables

const Company = require('../models/v2Company');
const { validateBatch } = require('../utils/variableValidators');
const logger = require('../utils/logger');

/**
 * Convert Mongoose Map to plain object
 * @param {Map|Object} mapOrObj - Mongoose Map or plain object
 * @returns {Object} Plain object { key: value }
 */
function mapToObj(mapOrObj) {
    if (!mapOrObj) {
        return {};
    }
    
    if (mapOrObj instanceof Map) {
        const obj = {};
        for (const [k, v] of mapOrObj.entries()) {
            obj[k] = v;
        }
        return obj;
    }
    
    // Already a plain object
    return mapOrObj;
}

/**
 * Get variables, definitions, and metadata for a company
 * 
 * @param {String} companyId - Company ID
 * @returns {Promise<Object>} { variables, definitions, meta }
 * 
 * Example response:
 * {
 *   variables: { companyName: "Royal Plumbing", phone: "+1-555-1234" },
 *   definitions: [
 *     { key: "companyName", label: "Company Name", type: "text", required: true, ... }
 *   ],
 *   meta: {
 *     lastScanDate: Date | null,
 *     totalVariables: 8,
 *     totalRequired: 3,
 *     filledRequired: 2,
 *     missingRequiredCount: 1
 *   }
 * }
 */
async function getVariablesForCompany(companyId) {
    logger.info(`[VARIABLES SERVICE] Loading variables for company: ${companyId}`);
    
    const company = await Company.findById(companyId)
        .select('aiAgentSettings.variables aiAgentSettings.variableDefinitions aiAgentSettings.lastScanDate aiAgentSettings.scanMetadata')
        .lean();
    
    if (!company) {
        throw new Error(`Company ${companyId} not found`);
    }
    
    const variables = mapToObj(company.aiAgentSettings?.variables);
    const definitions = company.aiAgentSettings?.variableDefinitions || [];
    const lastScanDate = company.aiAgentSettings?.lastScanDate || null;
    const scanMetadata = company.aiAgentSettings?.scanMetadata?.lastScan || null;
    
    // Calculate metadata
    const totalVariables = definitions.length;
    const totalRequired = definitions.filter(d => d.required === true).length;
    
    let filledRequired = 0;
    definitions.forEach(def => {
        if (def.required) {
            const value = variables[def.key] || '';
            if (value.trim() !== '') {
                filledRequired++;
            }
        }
    });
    
    const missingRequiredCount = totalRequired - filledRequired;
    
    const meta = {
        lastScanDate,
        totalVariables,
        totalRequired,
        filledRequired,
        missingRequiredCount,
        scanMetadata // Include scan metadata (reason, triggeredBy, etc.)
    };
    
    logger.info(`[VARIABLES SERVICE] ✅ Loaded ${totalVariables} variables (${filledRequired}/${totalRequired} required filled)`);
    
    return {
        variables,
        definitions,
        meta
    };
}

/**
 * Update company-specific variable values
 * 
 * @param {String} companyId - Company ID
 * @param {Object} updates - Plain object { key: value }
 * @returns {Promise<Object>} { variables, definitions, meta }
 * 
 * VALIDATION:
 * - Uses variableValidators.js for type-specific validation
 * - Phone → E.164 format
 * - Email → RFC regex
 * - URL → must have protocol
 * - Currency → normalized string
 * 
 * WRITE TARGET:
 * - ONLY writes to company.aiAgentSettings.variables (Map)
 * - NEVER writes to legacy fields (configuration.variables, aiAgentLogic.placeholders, etc.)
 * 
 * CACHING:
 * - Auto-clears Redis cache after successful save
 */
async function updateVariablesForCompany(companyId, updates) {
    logger.info(`[VARIABLES SERVICE] Updating variables for company: ${companyId}`);
    logger.debug(`[VARIABLES SERVICE] Updates:`, updates);
    
    // Load company with full aiAgentSettings
    const company = await Company.findById(companyId)
        .select('aiAgentSettings');
    
    if (!company) {
        throw new Error(`Company ${companyId} not found`);
    }
    
    // Get current definitions for validation
    const definitions = company.aiAgentSettings?.variableDefinitions || [];
    
    // Validate all updates
    const validation = validateBatch(updates, definitions);
    
    if (!validation.isValid) {
        logger.warn(`[VARIABLES SERVICE] Validation failed for company ${companyId}:`, validation.errors);
        
        const error = new Error('Validation failed');
        error.isValidationError = true;
        error.validationErrors = validation.errors;
        error.field = validation.errors[0]?.field; // First error field for convenience
        throw error;
    }
    
    // Initialize variables Map if it doesn't exist
    if (!company.aiAgentSettings.variables) {
        company.aiAgentSettings.variables = new Map();
    }
    
    // Write validated values to canonical Map
    Object.entries(validation.formatted).forEach(([key, value]) => {
        const v = (value == null) ? '' : String(value).trim();
        
        if (v === '') {
            // Remove empty values
            company.aiAgentSettings.variables.delete(key);
            logger.debug(`[VARIABLES SERVICE] Removed empty value for key: ${key}`);
        } else {
            // Set validated value
            company.aiAgentSettings.variables.set(key, v);
            logger.debug(`[VARIABLES SERVICE] Set ${key} = ${v}`);
        }
    });
    
    // Mark as modified (required for Mongoose Map)
    company.markModified('aiAgentSettings.variables');
    
    // Save to MongoDB
    await company.save();
    
    logger.info(`[VARIABLES SERVICE] ✅ Saved variables for company: ${companyId}`);
    logger.debug(`[VARIABLES SERVICE] Variables saved to MongoDB - no Redis cache clearing (MongoDB-only architecture)`);
    
    // Return updated data (same shape as getVariablesForCompany)
    return getVariablesForCompany(companyId);
}

module.exports = {
    getVariablesForCompany,
    updateVariablesForCompany,
    mapToObj
};
