/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VARIABLE SYNC SERVICE
 * Auto-sync variables whenever CheatSheet content changes
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE: Keep Variables table always in sync with actual usage
 * 
 * TRIGGERS:
 * - CheatSheet save (Frontline-Intel, Edge Cases, Transfer Rules, etc.)
 * - Scenario save
 * - Template save
 * 
 * DESIGN: Lightweight, non-blocking, runs after save completes
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

const logger = require('../utils/logger');
const Company = require('../models/v2Company');

class VariableSyncService {
    
    /**
     * Normalize frontlineIntel to string
     * Frontend may save as string OR object {instructions: "text"}
     * @param {string|Object} frontlineIntel - The frontlineIntel field
     * @returns {string} The extracted text content
     */
    static normalizeFrontlineIntel(frontlineIntel) {
        if (!frontlineIntel) return '';
        if (typeof frontlineIntel === 'string') return frontlineIntel;
        if (typeof frontlineIntel === 'object') {
            // V1 format: {instructions: "text"}
            return frontlineIntel.instructions || frontlineIntel.text || '';
        }
        return '';
    }
    
    /**
     * Helper: Convert camelCase to Human Readable
     */
    static humanize(key) {
        if (!key || typeof key !== 'string') return 'Unknown';
        return key
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, str => str.toUpperCase())
            .trim();
    }
    
    /**
     * Helper: Categorize variable based on name
     */
    static categorizeVariable(key) {
        if (!key || typeof key !== 'string') return 'General';
        const lowerKey = key.toLowerCase();
        
        if (lowerKey.includes('company') || lowerKey.includes('business') || lowerKey.includes('name')) {
            return 'Company Info';
        }
        if (lowerKey.includes('price') || lowerKey.includes('cost') || lowerKey.includes('fee') || lowerKey.includes('rate')) {
            return 'Pricing';
        }
        if (lowerKey.includes('phone') || lowerKey.includes('email') || lowerKey.includes('address') || lowerKey.includes('contact')) {
            return 'Contact';
        }
        if (lowerKey.includes('hour') || lowerKey.includes('schedule') || lowerKey.includes('time') || lowerKey.includes('appointment')) {
            return 'Scheduling';
        }
        if (lowerKey.includes('service') || lowerKey.includes('repair') || lowerKey.includes('install')) {
            return 'Services';
        }
        return 'General';
    }
    
    /**
     * Helper: Infer variable type from name
     */
    static inferType(key) {
        if (!key || typeof key !== 'string') return 'text';
        const lowerKey = key.toLowerCase();
        
        if (lowerKey.includes('email')) return 'email';
        if (lowerKey.includes('phone')) return 'phone';
        if (lowerKey.includes('url') || lowerKey.includes('website') || lowerKey.includes('booking')) return 'url';
        if (lowerKey.includes('price') || lowerKey.includes('cost') || lowerKey.includes('fee')) return 'currency';
        if (lowerKey.includes('count') || lowerKey.includes('number') || lowerKey.includes('year')) return 'number';
        return 'text';
    }
    
    /**
     * Helper: Get example value for variable
     */
    static getExample(key) {
        if (!key || typeof key !== 'string') return 'Enter value';
        const lowerKey = key.toLowerCase();
        
        if (lowerKey.includes('company') || lowerKey.includes('business')) return 'e.g., Atlas Air Conditioning';
        if (lowerKey.includes('phone')) return 'e.g., (239) 555-0100';
        if (lowerKey.includes('email')) return 'e.g., info@company.com';
        if (lowerKey.includes('address')) return 'e.g., 123 Main St, Naples, FL';
        if (lowerKey.includes('hour')) return 'e.g., Mon-Fri 8AM-5PM';
        if (lowerKey.includes('price') || lowerKey.includes('cost')) return 'e.g., $89';
        if (lowerKey.includes('website') || lowerKey.includes('booking') || lowerKey.includes('url')) return 'e.g., https://company.com';
        if (lowerKey.includes('greeting')) return 'e.g., Thanks for calling!';
        if (lowerKey.includes('area')) return 'e.g., Naples, Fort Myers, Bonita Springs';
        if (lowerKey.includes('type') || lowerKey.includes('trade')) return 'e.g., HVAC, Plumbing, Electrical';
        return `Enter ${this.humanize(key)}`;
    }
    
    /**
     * Extract all {variable} placeholders from text
     * @param {string} text - Text containing {variables}
     * @returns {string[]} Array of unique variable names (without braces)
     */
    static extractVariables(text) {
        if (!text || typeof text !== 'string') return [];
        
        const matches = text.match(/\{([a-zA-Z0-9_]+)\}/g) || [];
        const variables = matches.map(m => m.slice(1, -1)); // Remove { and }
        return [...new Set(variables)]; // Unique only
    }
    
    /**
     * Extract variables from an object's string properties
     * @param {Object} obj - Object to scan
     * @param {string[]} fields - Field names to scan
     * @returns {string[]} Array of unique variable names
     */
    static extractFromObject(obj, fields) {
        if (!obj) return [];
        
        const allVars = [];
        for (const field of fields) {
            const value = obj[field];
            if (typeof value === 'string') {
                allVars.push(...this.extractVariables(value));
            }
        }
        return [...new Set(allVars)];
    }
    
    /**
     * Extract variables from an array of objects
     * @param {Array} arr - Array of objects to scan
     * @param {string[]} fields - Field names to scan in each object
     * @returns {string[]} Array of unique variable names
     */
    static extractFromArray(arr, fields) {
        if (!Array.isArray(arr)) return [];
        
        const allVars = [];
        for (const item of arr) {
            allVars.push(...this.extractFromObject(item, fields));
        }
        return [...new Set(allVars)];
    }
    
    /**
     * Sync variables from CheatSheet config to Variables table
     * Called automatically after CheatSheet save
     * 
     * @param {string} companyId - Company ID
     * @param {Object} config - CheatSheet config object
     * @returns {Object} Sync result with stats
     */
    static async syncFromCheatSheet(companyId, config) {
        const startTime = Date.now();
        
        try {
            logger.info(`🔄 [VARIABLE SYNC] Starting sync for company ${companyId}`);
            
            if (!config) {
                logger.warn(`🔄 [VARIABLE SYNC] No config provided, skipping`);
                return { synced: 0, source: 'cheatsheet' };
            }
            
            const variablesBySource = new Map();
            
            // ═══════════════════════════════════════════════════════════════
            // SCAN 1: Frontline-Intel
            // ═══════════════════════════════════════════════════════════════
            // Handle both string and object {instructions: "text"} formats
            logger.info(`🔄 [VARIABLE SYNC] Raw frontlineIntel type: ${typeof config.frontlineIntel}`);
            logger.info(`🔄 [VARIABLE SYNC] Raw frontlineIntel: ${JSON.stringify(config.frontlineIntel)?.substring(0, 300)}`);
            
            const frontlineText = this.normalizeFrontlineIntel(config.frontlineIntel);
            logger.info(`🔄 [VARIABLE SYNC] Normalized frontlineIntel length: ${frontlineText.length}`);
            logger.info(`🔄 [VARIABLE SYNC] Normalized preview: ${frontlineText.substring(0, 200)}`);
            const frontlineVars = this.extractVariables(frontlineText);
            if (frontlineVars.length > 0) {
                frontlineVars.forEach(v => {
                    if (!variablesBySource.has(v)) {
                        variablesBySource.set(v, { sources: [], count: 0 });
                    }
                    variablesBySource.get(v).sources.push('Frontline-Intel');
                    variablesBySource.get(v).count++;
                });
            }
            logger.info(`🔄 [VARIABLE SYNC] Frontline-Intel: ${frontlineVars.length} variables found: ${frontlineVars.join(', ') || 'none'}`);
            
            // ═══════════════════════════════════════════════════════════════
            // SCAN 2: Edge Cases
            // ═══════════════════════════════════════════════════════════════
            const edgeCaseVars = this.extractFromArray(
                config.edgeCases || [], 
                ['responseText', 'name', 'description']
            );
            if (edgeCaseVars.length > 0) {
                edgeCaseVars.forEach(v => {
                    if (!variablesBySource.has(v)) {
                        variablesBySource.set(v, { sources: [], count: 0 });
                    }
                    variablesBySource.get(v).sources.push('Edge Cases');
                    variablesBySource.get(v).count++;
                });
            }
            logger.debug(`🔄 [VARIABLE SYNC] Edge Cases: ${edgeCaseVars.length} variables`);
            
            // ═══════════════════════════════════════════════════════════════
            // SCAN 3: Transfer Rules
            // ═══════════════════════════════════════════════════════════════
            const transferVars = this.extractFromArray(
                config.transferRules || [],
                ['script', 'phoneNumber', 'contactNameOrQueue', 'transferMessage']
            );
            if (transferVars.length > 0) {
                transferVars.forEach(v => {
                    if (!variablesBySource.has(v)) {
                        variablesBySource.set(v, { sources: [], count: 0 });
                    }
                    variablesBySource.get(v).sources.push('Transfer Rules');
                    variablesBySource.get(v).count++;
                });
            }
            logger.debug(`🔄 [VARIABLE SYNC] Transfer Rules: ${transferVars.length} variables`);
            
            // ═══════════════════════════════════════════════════════════════
            // SCAN 4: Behavior Rules
            // ═══════════════════════════════════════════════════════════════
            const behaviorVars = this.extractFromArray(
                config.behaviorRules || [],
                ['response', 'pattern', 'message']
            );
            if (behaviorVars.length > 0) {
                behaviorVars.forEach(v => {
                    if (!variablesBySource.has(v)) {
                        variablesBySource.set(v, { sources: [], count: 0 });
                    }
                    variablesBySource.get(v).sources.push('Behavior Rules');
                    variablesBySource.get(v).count++;
                });
            }
            logger.debug(`🔄 [VARIABLE SYNC] Behavior Rules: ${behaviorVars.length} variables`);
            
            // ═══════════════════════════════════════════════════════════════
            // SCAN 5: Guardrails
            // ═══════════════════════════════════════════════════════════════
            const guardrailVars = this.extractFromArray(
                config.guardrails || [],
                ['rule', 'message', 'replacement']
            );
            if (guardrailVars.length > 0) {
                guardrailVars.forEach(v => {
                    if (!variablesBySource.has(v)) {
                        variablesBySource.set(v, { sources: [], count: 0 });
                    }
                    variablesBySource.get(v).sources.push('Guardrails');
                    variablesBySource.get(v).count++;
                });
            }
            logger.debug(`🔄 [VARIABLE SYNC] Guardrails: ${guardrailVars.length} variables`);
            
            // ═══════════════════════════════════════════════════════════════
            // SCAN 6: Booking Rules
            // ═══════════════════════════════════════════════════════════════
            const bookingVars = this.extractFromArray(
                config.bookingRules || [],
                ['message', 'confirmationMessage', 'reminderMessage', 'prompt']
            );
            if (bookingVars.length > 0) {
                bookingVars.forEach(v => {
                    if (!variablesBySource.has(v)) {
                        variablesBySource.set(v, { sources: [], count: 0 });
                    }
                    variablesBySource.get(v).sources.push('Booking Rules');
                    variablesBySource.get(v).count++;
                });
            }
            logger.debug(`🔄 [VARIABLE SYNC] Booking Rules: ${bookingVars.length} variables`);
            
            // ═══════════════════════════════════════════════════════════════
            // SCAN 7: Company Contacts
            // ═══════════════════════════════════════════════════════════════
            const contactVars = this.extractFromArray(
                config.companyContacts || [],
                ['name', 'phone', 'email', 'notes']
            );
            if (contactVars.length > 0) {
                contactVars.forEach(v => {
                    if (!variablesBySource.has(v)) {
                        variablesBySource.set(v, { sources: [], count: 0 });
                    }
                    variablesBySource.get(v).sources.push('Company Contacts');
                    variablesBySource.get(v).count++;
                });
            }
            logger.debug(`🔄 [VARIABLE SYNC] Company Contacts: ${contactVars.length} variables`);
            
            // ═══════════════════════════════════════════════════════════════
            // SCAN 8: Links
            // ═══════════════════════════════════════════════════════════════
            const linkVars = this.extractFromArray(
                config.links || [],
                ['url', 'label', 'description']
            );
            if (linkVars.length > 0) {
                linkVars.forEach(v => {
                    if (!variablesBySource.has(v)) {
                        variablesBySource.set(v, { sources: [], count: 0 });
                    }
                    variablesBySource.get(v).sources.push('Links');
                    variablesBySource.get(v).count++;
                });
            }
            logger.debug(`🔄 [VARIABLE SYNC] Links: ${linkVars.length} variables`);
            
            // ═══════════════════════════════════════════════════════════════
            // UPDATE VARIABLES TABLE (BOTH variables AND variableDefinitions)
            // ═══════════════════════════════════════════════════════════════
            const uniqueVariables = [...variablesBySource.keys()];
            
            logger.info(`🔄 [VARIABLE SYNC] Found ${uniqueVariables.length} unique variables: ${uniqueVariables.join(', ')}`);
            
            if (uniqueVariables.length === 0) {
                logger.info(`🔄 [VARIABLE SYNC] No variables found in CheatSheet`);
                return { synced: 0, source: 'cheatsheet', duration: Date.now() - startTime };
            }
            
            // Get company
            const company = await Company.findById(companyId);
            if (!company) {
                logger.error(`🔄 [VARIABLE SYNC] Company ${companyId} not found`);
                return { synced: 0, error: 'Company not found' };
            }
            
            // Initialize aiAgentSettings if needed
            if (!company.aiAgentSettings) {
                company.aiAgentSettings = {};
            }
            if (!company.aiAgentSettings.variables) {
                company.aiAgentSettings.variables = {};
            }
            if (!company.aiAgentSettings.variableDefinitions) {
                company.aiAgentSettings.variableDefinitions = [];
            }
            
            // Current variables (key-value pairs for user to fill)
            const existingVars = company.aiAgentSettings.variables || {};
            // Current definitions (array with metadata for UI display)
            const existingDefs = company.aiAgentSettings.variableDefinitions || [];
            const existingDefKeys = new Set(existingDefs.map(d => (d.key || '').toLowerCase()));
            
            let addedCount = 0;
            let updatedCount = 0;
            
            // Merge new variables into BOTH structures
            for (const [varName, data] of variablesBySource.entries()) {
                const normalizedKey = varName.toLowerCase();
                
                // 1. Update variables object (for value storage)
                if (!existingVars[varName]) {
                    existingVars[varName] = '';
                    addedCount++;
                    logger.info(`🔄 [VARIABLE SYNC] ➕ Added new variable: {${varName}}`);
                } else {
                    updatedCount++;
                }
                
                // 2. Update variableDefinitions array (for UI display)
                if (!existingDefKeys.has(normalizedKey)) {
                    const newDef = {
                        key: varName,
                        normalizedKey: normalizedKey,
                        label: this.humanize(varName),
                        category: this.categorizeVariable(varName),
                        usageCount: data.count || 1,
                        required: false,
                        type: this.inferType(varName),
                        example: this.getExample(varName),
                        source: data.sources.join(', ') || 'Cheat Sheet',
                        locations: data.sources.map(s => ({ source: s, category: 'Cheat Sheet' }))
                    };
                    existingDefs.push(newDef);
                    existingDefKeys.add(normalizedKey);
                    logger.info(`🔄 [VARIABLE SYNC] ➕ Added definition for: {${varName}} (category: ${newDef.category})`);
                }
            }
            
            // Save BOTH structures
            company.aiAgentSettings.variables = existingVars;
            company.aiAgentSettings.variableDefinitions = existingDefs;
            company.markModified('aiAgentSettings.variables');
            company.markModified('aiAgentSettings.variableDefinitions');
            await company.save();
            
            logger.info(`✅ [VARIABLE SYNC] Saved ${existingDefs.length} definitions and ${Object.keys(existingVars).length} variables`);
            
            const duration = Date.now() - startTime;
            
            logger.info(`✅ [VARIABLE SYNC] Complete for company ${companyId}`, {
                uniqueVariables: uniqueVariables.length,
                added: addedCount,
                updated: updatedCount,
                duration: `${duration}ms`
            });
            
            return {
                synced: uniqueVariables.length,
                added: addedCount,
                updated: updatedCount,
                variables: uniqueVariables,
                source: 'cheatsheet',
                duration
            };
            
        } catch (error) {
            logger.error(`❌ [VARIABLE SYNC] Error syncing variables`, {
                companyId,
                error: error.message,
                stack: error.stack
            });
            return { synced: 0, error: error.message };
        }
    }
    
    /**
     * Quick sync - extract and sync from just the changed section
     * More efficient than full sync when only one section changed
     * 
     * @param {string} companyId - Company ID
     * @param {string} section - Section name (e.g., 'frontlineIntel', 'edgeCases')
     * @param {any} content - Section content
     */
    static async syncSection(companyId, section, content) {
        const startTime = Date.now();
        
        try {
            logger.info(`🔄 [VARIABLE SYNC] Quick sync for ${section}`);
            
            let variables = [];
            
            switch (section) {
                case 'frontlineIntel':
                    // Handle both string and object {instructions: "text"} formats
                    const frontlineText = this.normalizeFrontlineIntel(content);
                    variables = this.extractVariables(frontlineText);
                    break;
                case 'edgeCases':
                    variables = this.extractFromArray(content || [], ['responseText', 'name']);
                    break;
                case 'transferRules':
                    variables = this.extractFromArray(content || [], ['script', 'phoneNumber']);
                    break;
                case 'behaviorRules':
                    variables = this.extractFromArray(content || [], ['response', 'pattern']);
                    break;
                case 'guardrails':
                    variables = this.extractFromArray(content || [], ['rule', 'message']);
                    break;
                case 'bookingRules':
                    variables = this.extractFromArray(content || [], ['message', 'confirmationMessage']);
                    break;
                default:
                    logger.debug(`🔄 [VARIABLE SYNC] Unknown section: ${section}`);
                    return { synced: 0 };
            }
            
            if (variables.length === 0) {
                return { synced: 0, section };
            }
            
            // Get company and merge
            const company = await Company.findById(companyId);
            if (!company) return { synced: 0, error: 'Company not found' };
            
            if (!company.aiAgentSettings) company.aiAgentSettings = {};
            if (!company.aiAgentSettings.variables) company.aiAgentSettings.variables = {};
            
            let addedCount = 0;
            for (const varName of variables) {
                if (!company.aiAgentSettings.variables[varName]) {
                    company.aiAgentSettings.variables[varName] = '';
                    addedCount++;
                }
            }
            
            if (addedCount > 0) {
                company.markModified('aiAgentSettings.variables');
                await company.save();
            }
            
            logger.info(`✅ [VARIABLE SYNC] Section sync complete: ${section}`, {
                variables: variables.length,
                added: addedCount,
                duration: `${Date.now() - startTime}ms`
            });
            
            return {
                synced: variables.length,
                added: addedCount,
                section,
                variables
            };
            
        } catch (error) {
            logger.error(`❌ [VARIABLE SYNC] Section sync error`, { section, error: error.message });
            return { synced: 0, error: error.message };
        }
    }
}

module.exports = VariableSyncService;

