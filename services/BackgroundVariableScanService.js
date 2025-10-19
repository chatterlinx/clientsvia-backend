/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BACKGROUND VARIABLE SCAN SERVICE
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE: Automatically scan Global AI Brain templates for {variables} placeholders
 *          and sync them to company variable definitions without manual intervention
 * 
 * ARCHITECTURE:
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ Event-Driven Auto-Scan                                                  │
 * │  1. Template Activated     → Scan that template                         │
 * │  2. Template Deactivated   → Remove unique variables                    │
 * │  3. Global Template Updated → Rescan for all companies                  │
 * │  4. Page Load              → Check if rescan needed                     │
 * │                                                                          │
 * │ Smart Deduplication                                                     │
 * │  • {companyName} appears 147 times → Add ONCE to table                 │
 * │  • Track usage count for insights                                       │
 * │  • Merge with existing variables (preserve user values)                 │
 * │                                                                          │
 * │ Background Processing                                                   │
 * │  • Non-blocking - runs in background                                    │
 * │  • Progress tracking (current/total scenarios)                          │
 * │  • Full audit trail with scan history                                   │
 * └─────────────────────────────────────────────────────────────────────────┘
 * 
 * CHECKPOINTS: Comprehensive logging at every step
 * ═══════════════════════════════════════════════════════════════════════════
 */

const Company = require('../models/v2Company');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
const { getDB } = require('../db');

// Import Redis client from centralized clients module
let redisClient;
try {
    const clients = require('../clients/index');
    redisClient = clients.redisClient;
    if (redisClient) {
        console.log('✅ [BACKGROUND SCAN] Redis client connected');
    } else {
        console.warn('⚠️  [BACKGROUND SCAN] Redis client not available - cache operations will be no-ops');
    }
} catch (error) {
    console.warn('⚠️  [BACKGROUND SCAN] Redis import failed:', error.message);
    redisClient = null;
}

class BackgroundVariableScanService {
    
    /**
     * Main entry point: Scan a template for a specific company
     */
    async scanTemplateForCompany(companyId, templateId) {
        console.log(`🔍 [BG SCAN] Checkpoint 1: Starting scan for company ${companyId}, template ${templateId}`);
        
        try {
            // Mark as scanning
            console.log(`🔍 [BG SCAN] Checkpoint 2: Marking company as scanning...`);
            await Company.updateOne(
                { _id: companyId },
                { 
                    'aiAgentSettings.variableScanStatus.isScanning': true,
                    'aiAgentSettings.variableScanStatus.scanProgress.current': 0,
                    'aiAgentSettings.variableScanStatus.scanProgress.total': 0,
                    'aiAgentSettings.variableScanStatus.scanProgress.currentTemplate': ''
                }
            );
            console.log(`✅ [BG SCAN] Checkpoint 3: Company marked as scanning`);
            
            // Load template from Global AI Brain
            console.log(`🔍 [BG SCAN] Checkpoint 4: Loading template from Global AI Brain...`);
            const template = await GlobalInstantResponseTemplate.findById(templateId);
            
            if (!template) {
                console.error(`❌ [BG SCAN] Checkpoint 5: Template not found: ${templateId}`);
                throw new Error('Template not found');
            }
            
            console.log(`✅ [BG SCAN] Checkpoint 5: Template loaded: ${template.name}`);
            
            // Get all scenarios from template
            const scenarios = template.instantResponses || [];
            const totalScenarios = scenarios.length;
            
            console.log(`📊 [BG SCAN] Checkpoint 6: Template has ${totalScenarios} scenarios`);
            
            // Update progress total
            await Company.updateOne(
                { _id: companyId },
                { 
                    'aiAgentSettings.variableScanStatus.scanProgress.total': totalScenarios,
                    'aiAgentSettings.variableScanStatus.scanProgress.currentTemplate': template.name
                }
            );
            
            // Scan each scenario for {variables}
            console.log(`🔍 [BG SCAN] Checkpoint 7: Starting scenario scan...`);
            const variableMap = new Map(); // { "companyName" => 147, "phoneNumber" => 89, ... }
            
            for (let i = 0; i < scenarios.length; i++) {
                const scenario = scenarios[i];
                
                // Extract {variables} from triggers and replies
                const allText = [
                    ...(scenario.triggers || []),
                    ...(scenario.replies || []).map(r => r.text || '')
                ].join(' ');
                
                // Match all {variableName} patterns
                const matches = allText.match(/\{([a-zA-Z0-9_]+)\}/g) || [];
                
                matches.forEach(match => {
                    const key = match.slice(1, -1); // Remove { }
                    variableMap.set(key, (variableMap.get(key) || 0) + 1);
                });
                
                // Update progress every 10 scenarios
                if ((i + 1) % 10 === 0 || i === totalScenarios - 1) {
                    await Company.updateOne(
                        { _id: companyId },
                        { 'aiAgentSettings.variableScanStatus.scanProgress.current': i + 1 }
                    );
                    console.log(`✅ [BG SCAN] Progress: ${i + 1}/${totalScenarios} scenarios scanned`);
                }
            }
            
            console.log(`✅ [BG SCAN] Checkpoint 8: Scenario scan complete - Found ${variableMap.size} unique variables`);
            
            // Convert to variable definitions
            console.log(`🔍 [BG SCAN] Checkpoint 9: Building variable definitions...`);
            const variableDefinitions = [];
            const details = [];
            
            for (const [key, count] of variableMap.entries()) {
                const category = this.categorizeVariable(key);
                
                const varDef = {
                    key,
                    label: this.humanize(key),
                    category,
                    usageCount: count,
                    required: this.isRequired(key),
                    type: this.inferType(key),
                    example: this.getExample(key),
                    source: template.name
                };
                
                variableDefinitions.push(varDef);
                
                details.push({
                    variable: key,
                    occurrences: count,
                    addedToTable: true,
                    category
                });
                
                console.log(`  📝 {${key}} - ${count} occurrences → ${category}`);
            }
            
            console.log(`✅ [BG SCAN] Checkpoint 10: Variable definitions built`);
            
            // Merge with existing variables (don't overwrite values!)
            console.log(`🔍 [BG SCAN] Checkpoint 11: Merging with existing variables...`);
            const company = await Company.findById(companyId);
            const existingVars = company.aiAgentSettings?.variables || {};
            const existingDefs = company.aiAgentSettings?.variableDefinitions || [];
            
            let newCount = 0;
            
            variableDefinitions.forEach(newDef => {
                const existingIndex = existingDefs.findIndex(d => d.key === newDef.key);
                
                if (existingIndex === -1) {
                    // New variable - add it
                    existingDefs.push(newDef);
                    newCount++;
                    console.log(`  ➕ NEW: {${newDef.key}}`);
                } else {
                    // Existing variable - update usage count only
                    existingDefs[existingIndex].usageCount = newDef.usageCount;
                    existingDefs[existingIndex].source = template.name;
                    console.log(`  🔄 UPDATE: {${newDef.key}} - usage count: ${newDef.usageCount}`);
                }
            });
            
            console.log(`✅ [BG SCAN] Checkpoint 12: Merge complete - ${newCount} new variables added`);
            
            // Save to MongoDB
            console.log(`🔍 [BG SCAN] Checkpoint 13: Saving to MongoDB...`);
            await Company.findByIdAndUpdate(companyId, {
                'aiAgentSettings.variableDefinitions': existingDefs,
                'aiAgentSettings.variableScanStatus.isScanning': false,
                'aiAgentSettings.variableScanStatus.lastScan': new Date(),
                $push: {
                    'aiAgentSettings.variableScanStatus.scanHistory': {
                        $each: [{
                            timestamp: new Date(),
                            templateId,
                            templateName: template.name,
                            scenariosScanned: totalScenarios,
                            totalScenarios,
                            variablesFound: variableDefinitions.length,
                            newVariables: newCount,
                            details
                        }],
                        $slice: -10 // Keep last 10 scans
                    }
                }
            });
            
            console.log(`✅ [BG SCAN] Checkpoint 14: Saved to MongoDB`);
            
            // Clear Redis cache
            console.log(`🔍 [BG SCAN] Checkpoint 15: Clearing Redis cache...`);
            if (redisClient) {
                await redisClient.del(`company:${companyId}`);
                console.log(`✅ [BG SCAN] Checkpoint 16: Cache cleared`);
            } else {
                console.log(`⚠️  [BG SCAN] Checkpoint 16: Redis not available - skipping cache clear`);
            }
            
            console.log(`✅ [BG SCAN] Checkpoint 17: SCAN COMPLETE!`);
            console.log(`📊 [BG SCAN] Summary:
  Template: ${template.name}
  Scenarios Scanned: ${totalScenarios}
  Unique Variables Found: ${variableDefinitions.length}
  New Variables Added: ${newCount}
  Total Variables Now: ${existingDefs.length}`);
            
            return {
                success: true,
                templateName: template.name,
                scenariosScanned: totalScenarios,
                variablesFound: variableDefinitions.length,
                newVariables: newCount,
                totalVariables: existingDefs.length,
                details
            };
            
        } catch (error) {
            console.error(`❌ [BG SCAN] Error at scan:`, error);
            
            // Mark as not scanning
            await Company.updateOne(
                { _id: companyId },
                { 'aiAgentSettings.variableScanStatus.isScanning': false }
            );
            
            throw error;
        }
    }
    
    /**
     * Scan all active templates for a company
     */
    async scanAllTemplatesForCompany(companyId) {
        console.log(`🔍 [BG SCAN ALL] Starting full scan for company ${companyId}`);
        
        try {
            const company = await Company.findById(companyId);
            const templateRefs = company.aiAgentSettings?.templateReferences || [];
            
            console.log(`📊 [BG SCAN ALL] Company has ${templateRefs.length} active templates`);
            
            const results = [];
            
            for (const ref of templateRefs) {
                console.log(`🔍 [BG SCAN ALL] Scanning template: ${ref.templateId}`);
                const result = await this.scanTemplateForCompany(companyId, ref.templateId);
                results.push(result);
            }
            
            console.log(`✅ [BG SCAN ALL] Full scan complete for company ${companyId}`);
            
            return {
                success: true,
                templatesScanned: results.length,
                results
            };
            
        } catch (error) {
            console.error(`❌ [BG SCAN ALL] Error:`, error);
            throw error;
        }
    }
    
    /**
     * Categorize variable based on name
     */
    categorizeVariable(key) {
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
     * Check if variable is required
     */
    isRequired(key) {
        const requiredVars = ['companyName', 'phoneNumber', 'businessName', 'phone', 'email'];
        return requiredVars.includes(key);
    }
    
    /**
     * Infer variable type from name
     */
    inferType(key) {
        const lowerKey = key.toLowerCase();
        
        if (lowerKey.includes('email')) return 'email';
        if (lowerKey.includes('phone')) return 'phone';
        if (lowerKey.includes('url') || lowerKey.includes('website')) return 'url';
        if (lowerKey.includes('price') || lowerKey.includes('cost') || lowerKey.includes('fee')) return 'currency';
        if (lowerKey.includes('count') || lowerKey.includes('number') || lowerKey.includes('year')) return 'number';
        
        return 'text';
    }
    
    /**
     * Get example value for variable
     */
    getExample(key) {
        const lowerKey = key.toLowerCase();
        
        if (lowerKey.includes('company') || lowerKey.includes('business')) return 'e.g., Atlas Air Conditioning';
        if (lowerKey.includes('phone')) return 'e.g., (239) 555-0100';
        if (lowerKey.includes('email')) return 'e.g., info@company.com';
        if (lowerKey.includes('address')) return 'e.g., 123 Main St, Naples, FL';
        if (lowerKey.includes('hour')) return 'e.g., Mon-Fri 8AM-5PM';
        if (lowerKey.includes('price') || lowerKey.includes('cost')) return 'e.g., $89';
        if (lowerKey.includes('website')) return 'e.g., https://company.com';
        
        return `Enter ${this.humanize(key)}`;
    }
    
    /**
     * Convert camelCase to Human Readable
     */
    humanize(key) {
        return key
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, str => str.toUpperCase())
            .trim();
    }
}

module.exports = new BackgroundVariableScanService();

