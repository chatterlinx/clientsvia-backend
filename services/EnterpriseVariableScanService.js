/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ENTERPRISE VARIABLE SCAN SERVICE
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * VERSION: 8.0 (2025-11-04) - ENTERPRISE AUTOMATION & AUDIT
 * 
 * PURPOSE: World-class auto-triggered variable scanning with comprehensive
 *          audit trails, differential analysis, and enterprise logging
 * 
 * FEATURES:
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ 1. AUTO-TRIGGERING                                                      │
 * │    • Template added/activated → Auto-scan                               │
 * │    • Template removed → Cleanup scan                                    │
 * │    • Global template updated → Rescan all companies using it            │
 * │                                                                          │
 * │ 2. COMPREHENSIVE SCAN REPORTS                                           │
 * │    • Word count analysis (total words, unique words, placeholders)      │
 * │    • Template breakdown (names, IDs, versions)                          │
 * │    • Category & scenario details                                        │
 * │    • Variable locations (which scenarios use which variables)           │
 * │                                                                          │
 * │ 3. DIFFERENTIAL ANALYSIS                                                │
 * │    • Compare with previous scan                                         │
 * │    • Show what changed (new, removed, modified variables)               │
 * │    • Detect "no changes" vs "zero variables found"                      │
 * │                                                                          │
 * │ 4. ENTERPRISE LOGGING                                                   │
 * │    • Detailed checkpoint logging (50+ checkpoints)                      │
 * │    • Performance metrics (duration, throughput)                         │
 * │    • Validation warnings                                                │
 * │    • Proof of work with statistics                                      │
 * │                                                                          │
 * │ 5. SMART FORCE SCAN                                                     │
 * │    • Validates 0 variables is legitimate (if no placeholders)           │
 * │    • Shows "No new findings" if results match previous                  │
 * │    • Shows differential (what changed since last scan)                  │
 * └─────────────────────────────────────────────────────────────────────────┘
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

const Company = require('../models/v2Company');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');
const ScenarioPoolService = require('./ScenarioPoolService');

// Import Redis client
let redisClient;
try {
    const clients = require('../clients/index');
    redisClient = clients.redisClient;
} catch (error) {
    logger.warn('⚠️  [ENTERPRISE SCAN] Redis import failed:', error.message);
    redisClient = null;
}

class EnterpriseVariableScanService {
    
    /**
     * ═══════════════════════════════════════════════════════════════════════
     * MAIN SCAN METHOD - ENTERPRISE GRADE
     * ═══════════════════════════════════════════════════════════════════════
     */
    async scanCompany(companyId, options = {}) {
        const scanId = `scan-${Date.now()}-${uuidv4().slice(0, 8)}`;
        const startTime = new Date();
        
        logger.info(`🔍 [ENTERPRISE SCAN ${scanId}] ═══════════════════════════════════════════════════`);
        logger.info(`🔍 [ENTERPRISE SCAN ${scanId}] Checkpoint 1: Starting enterprise scan`);
        logger.info(`🔍 [ENTERPRISE SCAN ${scanId}] Company: ${companyId}`);
        logger.info(`🔍 [ENTERPRISE SCAN ${scanId}] Trigger: ${options.reason || 'manual'}`);
        logger.info(`🔍 [ENTERPRISE SCAN ${scanId}] Triggered By: ${options.triggeredBy || 'system'}`);
        
        try {
            // ═══════════════════════════════════════════════════════════════
            // STEP 1: Load Company & Previous Scan
            // ═══════════════════════════════════════════════════════════════
            logger.info(`🔍 [ENTERPRISE SCAN ${scanId}] Checkpoint 2: Loading company data...`);
            
            const company = await Company.findById(companyId);
            if (!company) {
                throw new Error(`Company ${companyId} not found`);
            }
            
            // Get previous scan for differential analysis
            const previousScan = company.aiAgentSettings?.variableScanStatus?.lastReport || null;
            const previousScanId = previousScan?.scanId || null;
            
            logger.info(`✅ [ENTERPRISE SCAN ${scanId}] Checkpoint 3: Company loaded`);
            logger.info(`📊 [ENTERPRISE SCAN ${scanId}] Previous Scan: ${previousScanId || 'None'}`);
            
            // ═══════════════════════════════════════════════════════════════
            // STEP 2: Load Active Templates
            // ═══════════════════════════════════════════════════════════════
            logger.info(`🔍 [ENTERPRISE SCAN ${scanId}] Checkpoint 4: Loading active templates...`);
            
            const templateRefs = company.aiAgentSettings?.templateReferences || [];
            const activeTemplates = templateRefs.filter(ref => ref.enabled !== false);
            
            logger.info(`✅ [ENTERPRISE SCAN ${scanId}] Checkpoint 5: Found ${activeTemplates.length} active templates`);

            // Preload scenario pool once for the entire scan (respects scenario controls)
            const scenarioPoolResult = await ScenarioPoolService.getScenarioPoolForCompany(companyId);
            const scenarioPool = scenarioPoolResult?.scenarios || [];
            logger.info(`✅ [ENTERPRISE SCAN ${scanId}] Checkpoint 5.1: Scenario pool loaded with ${scenarioPool.length} scenarios`);
            
            if (activeTemplates.length === 0) {
                logger.warn(`⚠️  [ENTERPRISE SCAN ${scanId}] No active templates - scan will return 0 variables (valid state)`);
            }
            
            // ═══════════════════════════════════════════════════════════════
            // STEP 3: Scan Each Template (COMPREHENSIVE)
            // ═══════════════════════════════════════════════════════════════
            const templatesScanned = [];
            const allVariables = new Map(); // { key => { occurrences: 147, locations: [...] } }
            
            let totalCategories = 0;
            let totalScenarios = 0;
            let totalWords = 0;
            let uniqueWordsSet = new Set();
            let totalPlaceholders = 0;
            
            for (let i = 0; i < activeTemplates.length; i++) {
                const ref = activeTemplates[i];
                const templateId = ref.templateId;
                
                logger.info(`🔍 [ENTERPRISE SCAN ${scanId}] Checkpoint 6.${i + 1}: Scanning template ${i + 1}/${activeTemplates.length}...`);
                logger.info(`📦 [ENTERPRISE SCAN ${scanId}] Template ID: ${templateId}`);
                
                // Load template from Global AI Brain
                const template = await GlobalInstantResponseTemplate.findById(templateId);
                
                if (!template) {
                    logger.warn(`⚠️  [ENTERPRISE SCAN ${scanId}] Template ${templateId} not found - skipping`);
                    continue;
                }
                
                logger.info(`✅ [ENTERPRISE SCAN ${scanId}] Checkpoint 6.${i + 1}.1: Template loaded: ${template.name}`);
                
                // Use preloaded ScenarioPoolService results (respects filters)
                const templateScenarios = scenarioPool.filter(s => 
                    s.templateId === templateId || s.templateId === templateId.toString()
                );
                
                logger.info(`📊 [ENTERPRISE SCAN ${scanId}] Checkpoint 6.${i + 1}.2: ScenarioPool returned ${templateScenarios.length} scenarios`);
                
                // Initialize template report
                const templateReport = {
                    templateId,
                    templateName: template.name,
                    version: template.version || 'v1.0.0',
                    priority: ref.priority || 1,
                    status: ref.enabled ? 'active' : 'inactive',
                    categories: {
                        total: 0,
                        scanned: 0,
                        list: []
                    },
                    scenarios: {
                        total: templateScenarios.length,
                        scanned: 0,
                        skipped: 0,
                        list: []
                    },
                    variablesFound: {
                        unique: 0,
                        totalOccurrences: 0,
                        breakdown: []
                    },
                    wordAnalysis: {
                        totalWords: 0,
                        uniqueWords: 0,
                        averageWordsPerScenario: 0,
                        placeholderWords: 0,
                        regularWords: 0
                    }
                };
                
                // Get categories from template
                const categoriesSet = new Set();
                templateScenarios.forEach(s => {
                    if (s.category) categoriesSet.add(s.category);
                });
                templateReport.categories.list = Array.from(categoriesSet);
                templateReport.categories.total = templateReport.categories.list.length;
                templateReport.categories.scanned = templateReport.categories.list.length;
                
                totalCategories += templateReport.categories.total;
                
                // Scan each scenario
                logger.info(`🔍 [ENTERPRISE SCAN ${scanId}] Checkpoint 6.${i + 1}.3: Scanning ${templateScenarios.length} scenarios...`);
                
                for (let j = 0; j < templateScenarios.length; j++) {
                    const scenario = templateScenarios[j];
                    
                    // Extract all text from scenario
                    const triggers = scenario.triggers || [];
                    const replies = (scenario.replies || []).map(r => r.text || r);
                    const allText = [...triggers, ...replies].join(' ');
                    
                    // Word count analysis
                    const words = allText.toLowerCase().match(/\b\w+\b/g) || [];
                    const wordCount = words.length;
                    templateReport.wordAnalysis.totalWords += wordCount;
                    totalWords += wordCount;
                    
                    words.forEach(word => uniqueWordsSet.add(word));
                    
                    // Extract {variables}
                    const variableMatches = allText.match(/\{([a-zA-Z0-9_]+)\}/g) || [];
                    const variablesInScenario = variableMatches.map(m => m.slice(1, -1)); // Remove { }
                    
                    templateReport.wordAnalysis.placeholderWords += variableMatches.length;
                    totalPlaceholders += variableMatches.length;
                    
                    // Track variable locations
                    const uniqueVarsInScenario = [...new Set(variablesInScenario)];
                    uniqueVarsInScenario.forEach(varKey => {
                        const count = variablesInScenario.filter(v => v === varKey).length;
                        
                        if (!allVariables.has(varKey)) {
                            allVariables.set(varKey, {
                                key: varKey,
                                occurrences: 0,
                                locations: []
                            });
                        }
                        
                        const varData = allVariables.get(varKey);
                        varData.occurrences += count;
                        varData.locations.push({
                            scenarioId: scenario.scenarioId,
                            scenarioName: scenario.name || 'Unnamed',
                            category: scenario.category || 'General',
                            count
                        });
                    });
                    
                    // Add scenario to report
                    templateReport.scenarios.list.push({
                        scenarioId: scenario.scenarioId,
                        name: scenario.name || 'Unnamed',
                        category: scenario.category || 'General',
                        status: scenario.status || 'live',
                        priority: scenario.priority || 5,
                        triggersCount: triggers.length,
                        repliesCount: replies.length,
                        variablesFound: uniqueVarsInScenario.length,
                        wordCount
                    });
                    
                    templateReport.scenarios.scanned++;
                    totalScenarios++;
                    
                    // Progress logging (every 10 scenarios)
                    if ((j + 1) % 10 === 0 || j === templateScenarios.length - 1) {
                        logger.info(`📊 [ENTERPRISE SCAN ${scanId}] Progress: ${j + 1}/${templateScenarios.length} scenarios processed`);
                    }
                }
                
                // Calculate template-specific variable stats
                const templateVars = Array.from(allVariables.values())
                    .map(v => ({
                        key: v.key,
                        occurrences: v.locations.filter(loc => 
                            templateReport.scenarios.list.some(s => s.scenarioId === loc.scenarioId)
                        ).reduce((sum, loc) => sum + loc.count, 0),
                        locations: v.locations.filter(loc =>
                            templateReport.scenarios.list.some(s => s.scenarioId === loc.scenarioId)
                        )
                    }))
                    .filter(v => v.occurrences > 0);
                
                templateReport.variablesFound.unique = templateVars.length;
                templateReport.variablesFound.totalOccurrences = templateVars.reduce((sum, v) => sum + v.occurrences, 0);
                templateReport.variablesFound.breakdown = templateVars.map(v => ({
                    key: v.key,
                    occurrences: v.occurrences,
                    locations: v.locations,
                    category: this.categorizeVariable(v.key),
                    type: this.inferType(v.key),
                    required: this.isRequired(v.key)
                }));
                
                // Word analysis
                templateReport.wordAnalysis.averageWordsPerScenario = templateReport.scenarios.scanned > 0
                    ? Math.round(templateReport.wordAnalysis.totalWords / templateReport.scenarios.scanned)
                    : 0;
                templateReport.wordAnalysis.regularWords = templateReport.wordAnalysis.totalWords - templateReport.wordAnalysis.placeholderWords;
                
                templatesScanned.push(templateReport);
                
                logger.info(`✅ [ENTERPRISE SCAN ${scanId}] Checkpoint 6.${i + 1}.4: Template scan complete`);
                logger.info(`📊 [ENTERPRISE SCAN ${scanId}] ${templateReport.scenarios.scanned} scenarios, ${templateReport.variablesFound.unique} unique variables, ${templateReport.wordAnalysis.totalWords} words`);
            }
            
            // ═══════════════════════════════════════════════════════════════
            // STEP 4: Build Variable Definitions
            // ═══════════════════════════════════════════════════════════════
            logger.info(`🔍 [ENTERPRISE SCAN ${scanId}] Checkpoint 7: Building variable definitions...`);
            
            const variableDefinitions = [];
            
            for (const [key, data] of allVariables.entries()) {
                const varDef = {
                    key,
                    label: this.humanize(key),
                    category: this.categorizeVariable(key),
                    usageCount: data.occurrences,
                    required: this.isRequired(key),
                    type: this.inferType(key),
                    example: this.getExample(key),
                    locations: data.locations,
                    source: data.locations.length > 0 
                        ? templatesScanned.find(t => 
                            t.scenarios.list.some(s => s.scenarioId === data.locations[0].scenarioId)
                          )?.templateName || 'Unknown'
                        : 'Unknown'
                };
                
                variableDefinitions.push(varDef);
            }
            
            logger.info(`✅ [ENTERPRISE SCAN ${scanId}] Checkpoint 8: Built ${variableDefinitions.length} variable definitions`);
            
            // ═══════════════════════════════════════════════════════════════
            // STEP 5: Differential Analysis
            // ═══════════════════════════════════════════════════════════════
            logger.info(`🔍 [ENTERPRISE SCAN ${scanId}] Checkpoint 9: Performing differential analysis...`);
            
            const differential = await this.performDifferentialAnalysis(
                company,
                previousScan,
                variableDefinitions,
                templatesScanned
            );
            
            logger.info(`✅ [ENTERPRISE SCAN ${scanId}] Checkpoint 10: Differential analysis complete`);
            logger.info(`📊 [ENTERPRISE SCAN ${scanId}] New: ${differential.variablesChanged.new.length}, Removed: ${differential.variablesChanged.removed.length}, Modified: ${differential.variablesChanged.modified.length}`);
            
            // ═══════════════════════════════════════════════════════════════
            // STEP 6: Merge with Existing Variables (Preserve User Values!)
            // ═══════════════════════════════════════════════════════════════
            logger.info(`🔍 [ENTERPRISE SCAN ${scanId}] Checkpoint 11: Merging with existing variables...`);
            
            const existingDefs = company.aiAgentSettings?.variableDefinitions || [];
            let newCount = 0;
            
            variableDefinitions.forEach(newDef => {
                const existingIndex = existingDefs.findIndex(d => d.key === newDef.key);
                
                if (existingIndex === -1) {
                    // New variable - add it
                    existingDefs.push(newDef);
                    newCount++;
                    logger.info(`  ➕ NEW: {${newDef.key}} - ${newDef.usageCount} occurrences`);
                } else {
                    // Existing variable - update metadata only
                    existingDefs[existingIndex].usageCount = newDef.usageCount;
                    existingDefs[existingIndex].locations = newDef.locations;
                    existingDefs[existingIndex].source = newDef.source;
                    logger.debug(`  🔄 UPDATE: {${newDef.key}} - usage count: ${newDef.usageCount}`);
                }
            });
            
            logger.info(`✅ [ENTERPRISE SCAN ${scanId}] Checkpoint 12: Merge complete - ${newCount} new variables added`);
            
            // ═══════════════════════════════════════════════════════════════
            // STEP 7: Build Comprehensive Scan Report
            // ═══════════════════════════════════════════════════════════════
            const endTime = new Date();
            const duration = (endTime - startTime) / 1000; // seconds
            
            const scanReport = {
                // Scan metadata
                scanId,
                timestamp: endTime.toISOString(),
                triggeredBy: options.triggeredBy || 'system',
                triggerReason: options.reason || 'manual',
                duration,
                
                // Templates processed
                templatesScanned: {
                    total: templatesScanned.length,
                    list: templatesScanned
                },
                
                // Aggregated statistics
                aggregated: {
                    totalTemplates: templatesScanned.length,
                    totalCategories,
                    totalScenarios,
                    totalWords,
                    uniqueWords: uniqueWordsSet.size,
                    totalPlaceholders,
                    uniqueVariables: variableDefinitions.length
                },
                
                // Differential analysis
                differential,
                
                // Validation & warnings
                validation: this.validateScanResults(templatesScanned, variableDefinitions),
                
                // Performance metrics
                performance: {
                    startTime: startTime.toISOString(),
                    endTime: endTime.toISOString(),
                    duration,
                    scenariosPerSecond: totalScenarios > 0 ? (totalScenarios / duration).toFixed(2) : 0,
                    templatesPerSecond: templatesScanned.length > 0 ? (templatesScanned.length / duration).toFixed(3) : 0
                }
            };
            
            // ═══════════════════════════════════════════════════════════════
            // STEP 8: Save to MongoDB
            // ═══════════════════════════════════════════════════════════════
            logger.info(`🔍 [ENTERPRISE SCAN ${scanId}] Checkpoint 13: Saving to MongoDB...`);
            
            await Company.findByIdAndUpdate(companyId, {
                'aiAgentSettings.variableDefinitions': existingDefs,
                'aiAgentSettings.lastScanDate': endTime,
                'aiAgentSettings.variableScanStatus.lastReport': scanReport,
                $push: {
                    'aiAgentSettings.variableScanStatus.history': {
                        $each: [scanReport],
                        $slice: -20 // Keep last 20 scans
                    }
                }
            });
            
            logger.info(`✅ [ENTERPRISE SCAN ${scanId}] Checkpoint 14: Saved to MongoDB`);
            
            // ═══════════════════════════════════════════════════════════════
            // STEP 9: Clear Redis Cache
            // ═══════════════════════════════════════════════════════════════
            logger.info(`🔍 [ENTERPRISE SCAN ${scanId}] Checkpoint 15: Clearing Redis cache...`);
            
            try {
                if (redisClient && redisClient.status === 'ready') {
                    await redisClient.del(`company:${companyId}`);
                    logger.info(`✅ [ENTERPRISE SCAN ${scanId}] Checkpoint 16: Cache cleared`);
                } else {
                    logger.warn(`⚠️  [ENTERPRISE SCAN ${scanId}] Checkpoint 16: Redis not ready - skipping cache clear`);
                }
            } catch (cacheError) {
                logger.error(`❌ [ENTERPRISE SCAN ${scanId}] Checkpoint 16: Failed to clear Redis cache:`, cacheError.message);
            }
            
            // ═══════════════════════════════════════════════════════════════
            // FINAL: Log Summary
            // ═══════════════════════════════════════════════════════════════
            logger.info(`✅ [ENTERPRISE SCAN ${scanId}] Checkpoint 17: SCAN COMPLETE!`);
            logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            logger.info(`📊 [ENTERPRISE SCAN ${scanId}] SCAN SUMMARY:`);
            logger.info(`   Duration: ${duration.toFixed(2)}s`);
            logger.info(`   Templates: ${templatesScanned.length}`);
            logger.info(`   Categories: ${totalCategories}`);
            logger.info(`   Scenarios: ${totalScenarios}`);
            logger.info(`   Total Words: ${totalWords.toLocaleString()}`);
            logger.info(`   Unique Words: ${uniqueWordsSet.size.toLocaleString()}`);
            logger.info(`   Placeholders: ${totalPlaceholders}`);
            logger.info(`   Unique Variables: ${variableDefinitions.length}`);
            logger.info(`   New Variables: ${newCount}`);
            logger.info(`   Differential: ${differential.summary.noChangesDetected ? 'NO CHANGES' : 'CHANGES DETECTED'}`);
            logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            
            return scanReport;
            
        } catch (error) {
            logger.error(`❌ [ENTERPRISE SCAN ${scanId}] Error:`, error);
            throw error;
        }
    }
    
    /**
     * ═══════════════════════════════════════════════════════════════════════
     * DIFFERENTIAL ANALYSIS
     * ═══════════════════════════════════════════════════════════════════════
     */
    async performDifferentialAnalysis(company, previousScan, currentVariables, currentTemplates) {
        if (!previousScan) {
            return {
                previousScanId: null,
                previousScanDate: null,
                templatesChanged: { added: [], removed: [], unchanged: [] },
                variablesChanged: { new: [], removed: [], modified: [], unchanged: [] },
                summary: {
                    newVariablesCount: currentVariables.length,
                    removedVariablesCount: 0,
                    modifiedVariablesCount: 0,
                    unchangedVariablesCount: 0,
                    noChangesDetected: false
                }
            };
        }
        
        const previousVars = company.aiAgentSettings?.variableDefinitions || [];
        const previousTemplates = previousScan.templatesScanned?.list || [];
        
        // Template changes
        const currentTemplateIds = new Set(currentTemplates.map(t => t.templateId));
        const previousTemplateIds = new Set(previousTemplates.map(t => t.templateId));
        
        const templatesChanged = {
            added: currentTemplates.filter(t => !previousTemplateIds.has(t.templateId)).map(t => t.templateName),
            removed: previousTemplates.filter(t => !currentTemplateIds.has(t.templateId)).map(t => t.templateName),
            unchanged: currentTemplates.filter(t => previousTemplateIds.has(t.templateId)).map(t => t.templateName)
        };
        
        // Variable changes
        const currentVarMap = new Map(currentVariables.map(v => [v.key, v]));
        const previousVarMap = new Map(previousVars.map(v => [v.key, v]));
        
        const variablesChanged = {
            new: [],
            removed: [],
            modified: [],
            unchanged: []
        };
        
        // Find new and modified
        for (const [key, currentVar] of currentVarMap.entries()) {
            if (!previousVarMap.has(key)) {
                variablesChanged.new.push({
                    key,
                    occurrences: currentVar.usageCount,
                    addedBy: currentVar.source
                });
            } else {
                const previousVar = previousVarMap.get(key);
                if (currentVar.usageCount !== previousVar.usageCount) {
                    variablesChanged.modified.push({
                        key,
                        oldCount: previousVar.usageCount,
                        newCount: currentVar.usageCount,
                        delta: currentVar.usageCount - previousVar.usageCount
                    });
                } else {
                    variablesChanged.unchanged.push({
                        key,
                        occurrences: currentVar.usageCount
                    });
                }
            }
        }
        
        // Find removed
        for (const [key, previousVar] of previousVarMap.entries()) {
            if (!currentVarMap.has(key)) {
                variablesChanged.removed.push({
                    key,
                    reason: templatesChanged.removed.length > 0 ? 'template_removed' : 'no_longer_used'
                });
            }
        }
        
        // Summary
        const noChangesDetected = 
            variablesChanged.new.length === 0 &&
            variablesChanged.removed.length === 0 &&
            variablesChanged.modified.length === 0 &&
            templatesChanged.added.length === 0 &&
            templatesChanged.removed.length === 0;
        
        return {
            previousScanId: previousScan.scanId,
            previousScanDate: previousScan.timestamp,
            templatesChanged,
            variablesChanged,
            summary: {
                newVariablesCount: variablesChanged.new.length,
                removedVariablesCount: variablesChanged.removed.length,
                modifiedVariablesCount: variablesChanged.modified.length,
                unchangedVariablesCount: variablesChanged.unchanged.length,
                noChangesDetected
            }
        };
    }
    
    /**
     * ═══════════════════════════════════════════════════════════════════════
     * VALIDATION & WARNINGS
     * ═══════════════════════════════════════════════════════════════════════
     */
    validateScanResults(templatesScanned, variableDefinitions) {
        const validation = {
            status: 'complete',
            issues: [],
            warnings: []
        };
        
        // Check for templates with zero variables
        templatesScanned.forEach(template => {
            if (template.variablesFound.unique === 0) {
                validation.warnings.push({
                    type: 'zero_variables_found',
                    templateId: template.templateId,
                    templateName: template.templateName,
                    message: `Template "${template.templateName}" has no {variable} placeholders - this is valid if no dynamic content is needed`
                });
            }
        });
        
        // Check for scenario count mismatches (ScenarioPoolService filtering)
        templatesScanned.forEach(template => {
            if (template.scenarios.scanned < template.scenarios.total) {
                validation.issues.push({
                    type: 'scenario_count_mismatch',
                    severity: 'warning',
                    templateId: template.templateId,
                    templateName: template.templateName,
                    expected: template.scenarios.total,
                    actual: template.scenarios.scanned,
                    message: `ScenarioPoolService filtered ${template.scenarios.total - template.scenarios.scanned} scenarios (likely isActive=false or scenario controls)`
                });
            }
        });
        
        return validation;
    }
    
    /**
     * Helper: Categorize variable based on name
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
     * Helper: Check if variable is required
     */
    isRequired(key) {
        const requiredVars = ['companyName', 'phoneNumber', 'businessName', 'phone', 'email'];
        return requiredVars.includes(key);
    }
    
    /**
     * Helper: Infer variable type from name
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
     * Helper: Get example value for variable
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
     * Helper: Convert camelCase to Human Readable
     */
    humanize(key) {
        return key
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, str => str.toUpperCase())
            .trim();
    }
}

module.exports = new EnterpriseVariableScanService();

