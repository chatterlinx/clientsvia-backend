/**
 * ============================================================================
 * COMPANY VARIABLES SERVICE - CANONICAL SOURCE OF TRUTH
 * ============================================================================
 * 
 * PURPOSE:
 * Centralized read/write logic for company variables system.
 * Ensures all code paths use the same canonical fields:
 * - aiAgentSettings.variableDefinitions (metadata)
 * - aiAgentSettings.variables (actual values)
 * 
 * REPLACES:
 * - Direct reads from configuration.variables
 * - Direct reads from aiAgentLogic.placeholders
 * - Direct reads from aiAgentLogic.variables
 * 
 * FEATURES:
 * - Single source of truth for variables
 * - Automatic migration from legacy fields
 * - Validation support
 * - Missing required variable detection
 * 
 * ============================================================================
 */

const Company = require('../models/v2Company');
const logger = require('../utils/logger');
const CacheHelper = require('../utils/cacheHelper');

class CompanyVariablesService {
    
    /**
     * Get variables and definitions for a company
     * 
     * @param {string} companyId - Company MongoDB ObjectId
     * @returns {Promise<Object>} { definitions, values, meta }
     * 
     * @example
     * const result = await CompanyVariablesService.getVariablesForCompany('64a1b2c3');
     * // {
     * //   definitions: [...],
     * //   values: { companyName: "Royal Plumbing", ... },
     * //   meta: { lastScanDate: Date, missingRequiredCount: 2 }
     * // }
     */
    static async getVariablesForCompany(companyId) {
        logger.debug(`📥 [VARIABLES SERVICE] Getting variables for company: ${companyId}`);
        
        try {
            const company = await Company.findById(companyId)
                .select('aiAgentSettings.variableDefinitions aiAgentSettings.variables aiAgentSettings.lastScanDate configuration.variables')
                .lean();
            
            if (!company) {
                throw new Error(`Company ${companyId} not found`);
            }
            
            // Get definitions from canonical location
            const definitions = company.aiAgentSettings?.variableDefinitions || [];
            
            // Get values from canonical location (Map → plain object)
            let values = {};
            if (company.aiAgentSettings?.variables) {
                // Mongoose Map is already a plain object when using .lean()
                values = company.aiAgentSettings.variables;
            }
            
            // MIGRATION: If canonical is empty but legacy has data, copy it
            if (Object.keys(values).length === 0 && company.configuration?.variables) {
                const legacyValues = company.configuration.variables;
                if (Object.keys(legacyValues).length > 0) {
                    logger.warn(`⚠️  [VARIABLES SERVICE] Migrating legacy variables for company ${companyId}`);
                    values = legacyValues;
                    
                    // Trigger background migration (non-blocking)
                    setImmediate(async () => {
                        try {
                            await this.migrateLegacyVariables(companyId);
                        } catch (migrationError) {
                            logger.error(`❌ [VARIABLES SERVICE] Migration failed for ${companyId}:`, migrationError);
                        }
                    });
                }
            }
            
            // Calculate missing required count
            const missingRequired = definitions.filter(def => 
                def.required && !def.deprecated && !values[def.key]
            );
            
            const meta = {
                lastScanDate: company.aiAgentSettings?.lastScanDate || null,
                missingRequiredCount: missingRequired.length,
                totalVariables: definitions.length,
                totalRequired: definitions.filter(d => d.required && !d.deprecated).length
            };
            
            logger.info(`✅ [VARIABLES SERVICE] Retrieved ${definitions.length} definitions, ${Object.keys(values).length} values`);
            
            return {
                definitions,
                values,
                meta
            };
            
        } catch (error) {
            logger.error(`❌ [VARIABLES SERVICE] Failed to get variables for ${companyId}:`, error);
            throw error;
        }
    }
    
    /**
     * Update variable values for a company
     * 
     * @param {string} companyId - Company MongoDB ObjectId
     * @param {Object} updates - Key-value pairs to update { key1: 'value', key2: 'value' }
     * @param {Object} options - Optional settings
     * @returns {Promise<Object>} { success, values, meta }
     */
    static async updateVariablesForCompany(companyId, updates, options = {}) {
        logger.debug(`💾 [VARIABLES SERVICE] Updating variables for company: ${companyId}`);
        logger.debug(`💾 [VARIABLES SERVICE] Updates:`, updates);
        
        try {
            const company = await Company.findById(companyId)
                .select('aiAgentSettings.variableDefinitions aiAgentSettings.variables aiAgentSettings.configurationAlert');
            
            if (!company) {
                throw new Error(`Company ${companyId} not found`);
            }
            
            // Initialize if needed
            if (!company.aiAgentSettings) {
                company.aiAgentSettings = {};
            }
            if (!company.aiAgentSettings.variables) {
                company.aiAgentSettings.variables = new Map();
            }
            
            // Apply updates
            for (const [key, value] of Object.entries(updates)) {
                if (value === null || value === undefined || value === '') {
                    // Delete empty values
                    company.aiAgentSettings.variables.delete(key);
                } else {
                    // Set/update value
                    company.aiAgentSettings.variables.set(key, value);
                }
            }
            
            // Recalculate configuration alert
            const definitions = company.aiAgentSettings.variableDefinitions || [];
            const values = company.aiAgentSettings.variables;
            
            const missingRequired = definitions.filter(def => 
                def.required && !def.deprecated && !values.get(def.key)
            );
            
            if (missingRequired.length > 0) {
                // Generate alert
                company.aiAgentSettings.configurationAlert = {
                    type: 'missing_variables',
                    severity: 'warning',
                    message: `${missingRequired.length} required variable${missingRequired.length > 1 ? 's' : ''} need${missingRequired.length === 1 ? 's' : ''} values`,
                    missingVariables: missingRequired.map(def => ({
                        key: def.key,
                        label: def.label,
                        type: def.type,
                        category: def.category
                    })),
                    createdAt: new Date()
                };
            } else {
                // Clear alert
                company.aiAgentSettings.configurationAlert = null;
            }
            
            // Mark as modified (Mongoose requirement for nested paths)
            company.markModified('aiAgentSettings.variables');
            company.markModified('aiAgentSettings.configurationAlert');
            
            await company.save();
            
            // Clear cache
            await CacheHelper.clearCompanyCache(companyId);
            
            logger.info(`✅ [VARIABLES SERVICE] Updated ${Object.keys(updates).length} variables for company ${companyId}`);
            
            // Return updated state
            const updatedValues = {};
            for (const [key, value] of company.aiAgentSettings.variables.entries()) {
                updatedValues[key] = value;
            }
            
            return {
                success: true,
                values: updatedValues,
                meta: {
                    missingRequiredCount: missingRequired.length,
                    totalVariables: definitions.length
                }
            };
            
        } catch (error) {
            logger.error(`❌ [VARIABLES SERVICE] Failed to update variables for ${companyId}:`, error);
            throw error;
        }
    }
    
    /**
     * Migrate legacy variables to canonical location
     * 
     * @param {string} companyId - Company MongoDB ObjectId
     * @returns {Promise<Object>} Migration result
     */
    static async migrateLegacyVariables(companyId) {
        logger.info(`🔄 [VARIABLES SERVICE] Starting legacy migration for company: ${companyId}`);
        
        try {
            const company = await Company.findById(companyId);
            
            if (!company) {
                throw new Error(`Company ${companyId} not found`);
            }
            
            let migratedCount = 0;
            
            // Initialize canonical if needed
            if (!company.aiAgentSettings) {
                company.aiAgentSettings = {};
            }
            if (!company.aiAgentSettings.variables) {
                company.aiAgentSettings.variables = new Map();
            }
            
            // Migrate from configuration.variables
            if (company.configuration?.variables) {
                const legacyVars = company.configuration.variables;
                
                for (const [key, value] of Object.entries(legacyVars)) {
                    if (!company.aiAgentSettings.variables.has(key) && value) {
                        company.aiAgentSettings.variables.set(key, value);
                        migratedCount++;
                    }
                }
            }
            
            if (migratedCount > 0) {
                company.markModified('aiAgentSettings.variables');
                await company.save();
                
                logger.info(`✅ [VARIABLES SERVICE] Migrated ${migratedCount} variables from legacy fields`);
            } else {
                logger.info(`ℹ️  [VARIABLES SERVICE] No legacy variables to migrate`);
            }
            
            return {
                success: true,
                migratedCount
            };
            
        } catch (error) {
            logger.error(`❌ [VARIABLES SERVICE] Migration failed for ${companyId}:`, error);
            throw error;
        }
    }
}

module.exports = CompanyVariablesService;

