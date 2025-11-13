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
            
            if (activeTemplates.length === 0) {
                logger.warn(`⚠️  [ENTERPRISE SCAN ${scanId}] No active templates - scan will return 0 variables (valid state)`);
            }
            
            // ✨ FIX: Read templates DIRECTLY from Global AI Brain (like AiCore Templates tab)
            // This ensures 100% consistency with what the AiCore Templates tab shows
            // NO FILTERING - scan all scenarios in the template
            logger.info(`🔍 [ENTERPRISE SCAN ${scanId}] Checkpoint 5.1: Reading templates directly from Global AI Brain...`);
            
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
                
                // ✨ FIX: Load template DIRECTLY from Global AI Brain (SOURCE OF TRUTH)
                // This matches exactly what GET /api/company/:id/configuration/templates does
                const template = await GlobalInstantResponseTemplate.findById(templateId)
                    .select('_id name version categories')
                    .lean();
                
                if (!template) {
                    logger.warn(`⚠️  [ENTERPRISE SCAN ${scanId}] Template ${templateId} not found - skipping`);
                    continue;
                }
                
                logger.info(`✅ [ENTERPRISE SCAN ${scanId}] Checkpoint 6.${i + 1}.1: Template loaded: ${template.name} (ID: ${template._id})`);
                
                // ✨ FIX: Flatten scenarios DIRECTLY from template.categories (NO FILTERING)
                // This ensures we scan ALL scenarios, matching AiCore Templates tab logic
                const allCategories = template.categories || [];
                const templateScenarios = allCategories.flatMap(category => category.scenarios || []);
                
                logger.info(`📊 [ENTERPRISE SCAN ${scanId}] Checkpoint 6.${i + 1}.2: Template has ${allCategories.length} categories and ${templateScenarios.length} scenarios`);
                
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
                
                // ✨ FIX: Count categories DIRECTLY from template (SOURCE OF TRUTH)
                // This matches exactly what AiCore Templates tab shows
                templateReport.categories.list = allCategories.map(cat => cat.name || 'Unnamed');
                templateReport.categories.total = allCategories.length;
                templateReport.categories.scanned = allCategories.length;
                
                totalCategories += allCategories.length;
                
                logger.info(`📂 [ENTERPRISE SCAN ${scanId}] Checkpoint 6.${i + 1}.2.1: Categories: ${allCategories.length} (${templateReport.categories.list.join(', ')})`);
                
                // Scan each scenario
                logger.info(`🔍 [ENTERPRISE SCAN ${scanId}] Checkpoint 6.${i + 1}.3: Scanning ${templateScenarios.length} scenarios...`);
                
                for (let j = 0; j < templateScenarios.length; j++) {
                    const scenario = templateScenarios[j];
                    
                    // ✨ FIX: Extract text from direct template scenarios
                    // Template scenarios have: triggers, quickReplies, fullReplies
                    const triggers = scenario.triggers || [];
                    const quickReplies = (scenario.quickReplies || []).map(r => r.text || r);
                    const fullReplies = (scenario.fullReplies || []).map(r => r.text || r);
                    const allText = [...triggers, ...quickReplies, ...fullReplies].join(' ');
                    
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
                    
                    // ✨ SMART CASE-INSENSITIVE VARIABLE GROUPING
                    // Group by lowercase key: {companyName}, {CompanyName}, {companyname} → ONE variable
                    const uniqueVarsInScenario = [...new Set(variablesInScenario)];
                    uniqueVarsInScenario.forEach(varKey => {
                        const count = variablesInScenario.filter(v => v === varKey).length;
                        
                        // Use lowercase as grouping key (case-insensitive)
                        const normalizedKey = varKey.toLowerCase();
                        
                        if (!allVariables.has(normalizedKey)) {
                            allVariables.set(normalizedKey, {
                                normalizedKey: normalizedKey,           // Lowercase for grouping
                                preferredFormat: varKey,                 // Start with first format seen
                                formatVariations: new Set([varKey]),     // Track all format variations
                                formatCounts: { [varKey]: 0 },          // Count uses per format
                                occurrences: 0,                          // Total occurrences across all formats
                                locations: []
                            });
                        }
                        
                        const varData = allVariables.get(normalizedKey);
                        
                        // Track this format variation
                        varData.formatVariations.add(varKey);
                        varData.formatCounts[varKey] = (varData.formatCounts[varKey] || 0) + count;
                        varData.occurrences += count;
                        
                        // Update preferred format (most used format wins)
                        const currentPreferredCount = varData.formatCounts[varData.preferredFormat] || 0;
                        if (varData.formatCounts[varKey] > currentPreferredCount) {
                            varData.preferredFormat = varKey;
                        }
                        
                        varData.locations.push({
                            scenarioId: scenario.scenarioId,
                            scenarioName: scenario.name || 'Unnamed',
                            category: scenario.category || 'General',
                            count,
                            format: varKey  // Track which format was used
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
                        repliesCount: quickReplies.length + fullReplies.length,
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
                        key: v.preferredFormat || v.normalizedKey,  // Use preferred format as key
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
            // STEP 3.5: Scan Frontline-Intel (NEW!)
            // ═══════════════════════════════════════════════════════════════
            logger.info(`🔍 [ENTERPRISE SCAN ${scanId}] Checkpoint 6.5: Scanning Frontline-Intel...`);
            
            const frontlineIntel = company.aiAgentSettings?.cheatSheet?.frontlineIntel || '';
            let frontlineIntelReport = {
                source: 'Frontline-Intel',
                enabled: true,
                charactersScanned: frontlineIntel.length,
                variablesFound: {
                    unique: 0,
                    totalOccurrences: 0,
                    breakdown: []
                },
                wordAnalysis: {
                    totalWords: 0,
                    uniqueWords: 0,
                    placeholderWords: 0,
                    regularWords: 0
                }
            };
            
            if (frontlineIntel && frontlineIntel.trim()) {
                logger.info(`📝 [ENTERPRISE SCAN ${scanId}] Checkpoint 6.5.1: Frontline-Intel text: ${frontlineIntel.length} characters`);
                
                // Word count analysis
                const words = frontlineIntel.toLowerCase().match(/\b\w+\b/g) || [];
                const wordCount = words.length;
                frontlineIntelReport.wordAnalysis.totalWords = wordCount;
                totalWords += wordCount;
                
                const uniqueWordsInFI = new Set(words);
                frontlineIntelReport.wordAnalysis.uniqueWords = uniqueWordsInFI.size;
                words.forEach(word => uniqueWordsSet.add(word));
                
                // Extract {variables}
                const variableMatches = frontlineIntel.match(/\{([a-zA-Z0-9_]+)\}/g) || [];
                const variablesInFI = variableMatches.map(m => m.slice(1, -1)); // Remove { }
                
                frontlineIntelReport.wordAnalysis.placeholderWords = variableMatches.length;
                totalPlaceholders += variableMatches.length;
                
                logger.info(`✅ [ENTERPRISE SCAN ${scanId}] Checkpoint 6.5.2: Found ${variableMatches.length} variable occurrences in Frontline-Intel`);
                
                // SMART CASE-INSENSITIVE VARIABLE GROUPING (same as scenarios)
                const uniqueVarsInFI = [...new Set(variablesInFI)];
                uniqueVarsInFI.forEach(varKey => {
                    const count = variablesInFI.filter(v => v === varKey).length;
                    
                    // Use lowercase as grouping key (case-insensitive)
                    const normalizedKey = varKey.toLowerCase();
                    
                    if (!allVariables.has(normalizedKey)) {
                        allVariables.set(normalizedKey, {
                            normalizedKey: normalizedKey,
                            preferredFormat: varKey,
                            formatVariations: new Set([varKey]),
                            formatCounts: { [varKey]: 0 },
                            occurrences: 0,
                            locations: []
                        });
                    }
                    
                    const varData = allVariables.get(normalizedKey);
                    
                    // Track this format variation
                    varData.formatVariations.add(varKey);
                    varData.formatCounts[varKey] = (varData.formatCounts[varKey] || 0) + count;
                    varData.occurrences += count;
                    
                    // Update preferred format (most used format wins)
                    const currentPreferredCount = varData.formatCounts[varData.preferredFormat] || 0;
                    if (varData.formatCounts[varKey] > currentPreferredCount) {
                        varData.preferredFormat = varKey;
                    }
                    
                    varData.locations.push({
                        source: 'Frontline-Intel',
                        category: 'Cheat Sheet',
                        location: 'Frontline-Intel Protocols',
                        count,
                        format: varKey
                    });
                    
                    logger.info(`  📌 [ENTERPRISE SCAN ${scanId}] Variable {${varKey}} found ${count} time(s) in Frontline-Intel`);
                });
                
                // Update report
                frontlineIntelReport.variablesFound.unique = uniqueVarsInFI.length;
                frontlineIntelReport.variablesFound.totalOccurrences = variableMatches.length;
                frontlineIntelReport.variablesFound.breakdown = uniqueVarsInFI.map(varKey => ({
                    key: varKey,
                    occurrences: variablesInFI.filter(v => v === varKey).length
                }));
                frontlineIntelReport.wordAnalysis.regularWords = wordCount - variableMatches.length;
                
                logger.info(`✅ [ENTERPRISE SCAN ${scanId}] Checkpoint 6.5.3: Frontline-Intel scan complete`);
                logger.info(`📊 [ENTERPRISE SCAN ${scanId}] ${frontlineIntelReport.variablesFound.unique} unique variables, ${wordCount} words`);
            } else {
                logger.info(`ℹ️  [ENTERPRISE SCAN ${scanId}] Checkpoint 6.5.1: Frontline-Intel is empty - skipping`);
            }
            
            // Add Frontline-Intel report to scanned sources
            templatesScanned.push(frontlineIntelReport);
            
            // ═══════════════════════════════════════════════════════════════
            // STEP 3.6: Scan Edge Cases (NEW!)
            // ═══════════════════════════════════════════════════════════════
            logger.info(`🔍 [ENTERPRISE SCAN ${scanId}] Checkpoint 6.6: Scanning Edge Cases...`);
            
            const edgeCases = company.aiAgentSettings?.cheatSheet?.edgeCases || [];
            let edgeCasesReport = {
                source: 'Edge Cases',
                enabled: true,
                itemsScanned: edgeCases.length,
                variablesFound: {
                    unique: 0,
                    totalOccurrences: 0,
                    breakdown: []
                },
                wordAnalysis: {
                    totalWords: 0,
                    uniqueWords: 0,
                    placeholderWords: 0,
                    regularWords: 0
                }
            };
            
            if (edgeCases.length > 0) {
                logger.info(`📝 [ENTERPRISE SCAN ${scanId}] Checkpoint 6.6.1: Scanning ${edgeCases.length} edge cases`);
                
                for (const edgeCase of edgeCases) {
                    const edgeCaseName = edgeCase.name || 'Unnamed';
                    const responseText = edgeCase.responseText || '';
                    
                    if (!responseText) continue;
                    
                    // Word count analysis
                    const words = responseText.toLowerCase().match(/\b\w+\b/g) || [];
                    const wordCount = words.length;
                    edgeCasesReport.wordAnalysis.totalWords += wordCount;
                    totalWords += wordCount;
                    
                    const uniqueWordsInEC = new Set(words);
                    edgeCasesReport.wordAnalysis.uniqueWords += uniqueWordsInEC.size;
                    words.forEach(word => uniqueWordsSet.add(word));
                    
                    // Extract {variables}
                    const variableMatches = responseText.match(/\{([a-zA-Z0-9_]+)\}/g) || [];
                    const variablesInEC = variableMatches.map(m => m.slice(1, -1));
                    
                    edgeCasesReport.wordAnalysis.placeholderWords += variableMatches.length;
                    totalPlaceholders += variableMatches.length;
                    
                    // SMART CASE-INSENSITIVE VARIABLE GROUPING
                    const uniqueVarsInEC = [...new Set(variablesInEC)];
                    uniqueVarsInEC.forEach(varKey => {
                        const count = variablesInEC.filter(v => v === varKey).length;
                        const normalizedKey = varKey.toLowerCase();
                        
                        if (!allVariables.has(normalizedKey)) {
                            allVariables.set(normalizedKey, {
                                normalizedKey: normalizedKey,
                                preferredFormat: varKey,
                                formatVariations: new Set([varKey]),
                                formatCounts: { [varKey]: 0 },
                                occurrences: 0,
                                locations: []
                            });
                        }
                        
                        const varData = allVariables.get(normalizedKey);
                        varData.formatVariations.add(varKey);
                        varData.formatCounts[varKey] = (varData.formatCounts[varKey] || 0) + count;
                        varData.occurrences += count;
                        
                        const currentPreferredCount = varData.formatCounts[varData.preferredFormat] || 0;
                        if (varData.formatCounts[varKey] > currentPreferredCount) {
                            varData.preferredFormat = varKey;
                        }
                        
                        varData.locations.push({
                            source: 'Edge Case',
                            category: 'Cheat Sheet',
                            location: `Edge Case: ${edgeCaseName}`,
                            count,
                            format: varKey
                        });
                        
                        logger.info(`  📌 [ENTERPRISE SCAN ${scanId}] Variable {${varKey}} found ${count} time(s) in edge case "${edgeCaseName}"`);
                    });
                }
                
                edgeCasesReport.variablesFound.unique = [...new Set(edgeCases.flatMap(ec => {
                    const matches = (ec.responseText || '').match(/\{([a-zA-Z0-9_]+)\}/g) || [];
                    return matches.map(m => m.slice(1, -1).toLowerCase());
                }))].length;
                edgeCasesReport.variablesFound.totalOccurrences = edgeCasesReport.wordAnalysis.placeholderWords;
                edgeCasesReport.wordAnalysis.regularWords = edgeCasesReport.wordAnalysis.totalWords - edgeCasesReport.wordAnalysis.placeholderWords;
                
                logger.info(`✅ [ENTERPRISE SCAN ${scanId}] Checkpoint 6.6.2: Edge Cases scan complete`);
                logger.info(`📊 [ENTERPRISE SCAN ${scanId}] ${edgeCasesReport.variablesFound.unique} unique variables, ${edgeCasesReport.wordAnalysis.totalWords} words`);
            } else {
                logger.info(`ℹ️  [ENTERPRISE SCAN ${scanId}] Checkpoint 6.6.1: No edge cases configured - skipping`);
            }
            
            templatesScanned.push(edgeCasesReport);
            
            // ═══════════════════════════════════════════════════════════════
            // STEP 3.7: Scan Transfer Rules (NEW!)
            // ═══════════════════════════════════════════════════════════════
            logger.info(`🔍 [ENTERPRISE SCAN ${scanId}] Checkpoint 6.7: Scanning Transfer Rules...`);
            
            const transferRules = company.aiAgentSettings?.cheatSheet?.transferRules || [];
            let transferRulesReport = {
                source: 'Transfer Rules',
                enabled: true,
                itemsScanned: transferRules.length,
                variablesFound: {
                    unique: 0,
                    totalOccurrences: 0,
                    breakdown: []
                },
                wordAnalysis: {
                    totalWords: 0,
                    uniqueWords: 0,
                    placeholderWords: 0,
                    regularWords: 0
                }
            };
            
            if (transferRules.length > 0) {
                logger.info(`📝 [ENTERPRISE SCAN ${scanId}] Checkpoint 6.7.1: Scanning ${transferRules.length} transfer rules`);
                
                for (const rule of transferRules) {
                    const ruleName = rule.name || 'Unnamed';
                    const script = rule.script || '';
                    const phoneNumber = rule.phoneNumber || '';
                    const contact = rule.contactNameOrQueue || '';
                    
                    // Combine all text fields
                    const allText = [script, phoneNumber, contact].join(' ');
                    
                    // Word count analysis
                    const words = allText.toLowerCase().match(/\b\w+\b/g) || [];
                    const wordCount = words.length;
                    transferRulesReport.wordAnalysis.totalWords += wordCount;
                    totalWords += wordCount;
                    
                    const uniqueWordsInTR = new Set(words);
                    transferRulesReport.wordAnalysis.uniqueWords += uniqueWordsInTR.size;
                    words.forEach(word => uniqueWordsSet.add(word));
                    
                    // Extract {variables}
                    const variableMatches = allText.match(/\{([a-zA-Z0-9_]+)\}/g) || [];
                    const variablesInTR = variableMatches.map(m => m.slice(1, -1));
                    
                    transferRulesReport.wordAnalysis.placeholderWords += variableMatches.length;
                    totalPlaceholders += variableMatches.length;
                    
                    // SMART CASE-INSENSITIVE VARIABLE GROUPING
                    const uniqueVarsInTR = [...new Set(variablesInTR)];
                    uniqueVarsInTR.forEach(varKey => {
                        const count = variablesInTR.filter(v => v === varKey).length;
                        const normalizedKey = varKey.toLowerCase();
                        
                        if (!allVariables.has(normalizedKey)) {
                            allVariables.set(normalizedKey, {
                                normalizedKey: normalizedKey,
                                preferredFormat: varKey,
                                formatVariations: new Set([varKey]),
                                formatCounts: { [varKey]: 0 },
                                occurrences: 0,
                                locations: []
                            });
                        }
                        
                        const varData = allVariables.get(normalizedKey);
                        varData.formatVariations.add(varKey);
                        varData.formatCounts[varKey] = (varData.formatCounts[varKey] || 0) + count;
                        varData.occurrences += count;
                        
                        const currentPreferredCount = varData.formatCounts[varData.preferredFormat] || 0;
                        if (varData.formatCounts[varKey] > currentPreferredCount) {
                            varData.preferredFormat = varKey;
                        }
                        
                        varData.locations.push({
                            source: 'Transfer Rule',
                            category: 'Cheat Sheet',
                            location: `Transfer Rule: ${ruleName}`,
                            count,
                            format: varKey
                        });
                        
                        logger.info(`  📌 [ENTERPRISE SCAN ${scanId}] Variable {${varKey}} found ${count} time(s) in transfer rule "${ruleName}"`);
                    });
                }
                
                transferRulesReport.variablesFound.unique = [...new Set(transferRules.flatMap(rule => {
                    const allText = [rule.script || '', rule.phoneNumber || '', rule.contactNameOrQueue || ''].join(' ');
                    const matches = allText.match(/\{([a-zA-Z0-9_]+)\}/g) || [];
                    return matches.map(m => m.slice(1, -1).toLowerCase());
                }))].length;
                transferRulesReport.variablesFound.totalOccurrences = transferRulesReport.wordAnalysis.placeholderWords;
                transferRulesReport.wordAnalysis.regularWords = transferRulesReport.wordAnalysis.totalWords - transferRulesReport.wordAnalysis.placeholderWords;
                
                logger.info(`✅ [ENTERPRISE SCAN ${scanId}] Checkpoint 6.7.2: Transfer Rules scan complete`);
                logger.info(`📊 [ENTERPRISE SCAN ${scanId}] ${transferRulesReport.variablesFound.unique} unique variables, ${transferRulesReport.wordAnalysis.totalWords} words`);
            } else {
                logger.info(`ℹ️  [ENTERPRISE SCAN ${scanId}] Checkpoint 6.7.1: No transfer rules configured - skipping`);
            }
            
            templatesScanned.push(transferRulesReport);
            
            // ═══════════════════════════════════════════════════════════════
            // STEP 4: Build Variable Definitions
            // ═══════════════════════════════════════════════════════════════
            logger.info(`🔍 [ENTERPRISE SCAN ${scanId}] Checkpoint 7: Building variable definitions...`);
            
            const variableDefinitions = [];
            
            for (const [normalizedKey, data] of allVariables.entries()) {
                // Use preferred format (most common) as the canonical key
                const canonicalKey = data.preferredFormat || normalizedKey;  // Fallback to normalizedKey
                const formatVariations = data.formatVariations ? Array.from(data.formatVariations) : [canonicalKey];
                const hasMultipleFormats = formatVariations.length > 1;
                
                // Defensive check
                if (!canonicalKey) {
                    logger.error(`❌ [ENTERPRISE SCAN ${scanId}] Invalid variable data: normalizedKey=${normalizedKey}, data=`, data);
                    continue;
                }
                
                const varDef = {
                    key: canonicalKey,                          // Use preferred format
                    normalizedKey: normalizedKey,                // Lowercase for lookups
                    label: this.humanize(canonicalKey),
                    category: this.categorizeVariable(canonicalKey),
                    usageCount: data.occurrences,                // Total across all formats
                    required: this.isRequired(canonicalKey),
                    type: this.inferType(canonicalKey),
                    example: this.getExample(canonicalKey),
                    locations: data.locations,
                    source: data.locations.length > 0 
                        ? templatesScanned.find(t => 
                            t.scenarios.list.some(s => s.scenarioId === data.locations[0].scenarioId)
                          )?.templateName || 'Unknown'
                        : 'Unknown',
                    
                    // ✨ NEW: Format variation tracking
                    formatVariations: formatVariations,          // All formats found
                    formatCounts: data.formatCounts,             // Usage per format
                    hasMultipleFormats: hasMultipleFormats,      // Warning flag
                    preferredFormat: data.preferredFormat        // Most common format
                };
                
                if (hasMultipleFormats) {
                    logger.warn(`⚠️  [ENTERPRISE SCAN ${scanId}] Variable format mismatch: ${formatVariations.join(', ')} → standardized to {${canonicalKey}}`);
                }
                
                variableDefinitions.push(varDef);
            }
            
            logger.info(`✅ [ENTERPRISE SCAN ${scanId}] Checkpoint 8: Built ${variableDefinitions.length} variable definitions`);
            
            // ═══════════════════════════════════════════════════════════════
            // STEP 5: Deduplicate Existing Variables FIRST (for accurate differential)
            // ═══════════════════════════════════════════════════════════════
            logger.info(`🔍 [ENTERPRISE SCAN ${scanId}] Checkpoint 9: Deduplicating existing variables...`);
            
            // 🧹 CLEANUP: Deduplicate existing variables (removes historical case-insensitive duplicates)
            const rawExistingDefs = company.aiAgentSettings?.variableDefinitions || [];
            logger.info(`🧹 [ENTERPRISE SCAN ${scanId}] Starting deduplication - raw count: ${rawExistingDefs.length}`);
            
            const deduplicatedMap = new Map();
            let duplicatesRemoved = 0;
            
            rawExistingDefs.forEach((def, index) => {
                const normalizedKey = (def.normalizedKey || def.key?.toLowerCase() || '');
                
                if (!normalizedKey) {
                    logger.warn(`  ⚠️  [DEDUPE ${index}] Skipping entry with no key:`, def);
                    return;
                }
                
                logger.debug(`  [DEDUPE ${index}] Processing: key="${def.key}" normalized="${normalizedKey}" usageCount=${def.usageCount || 0}`);
                
                if (!deduplicatedMap.has(normalizedKey)) {
                    // First occurrence - keep it
                    deduplicatedMap.set(normalizedKey, def);
                    logger.debug(`  ✅ [DEDUPE ${index}] First occurrence - keeping {${def.key}}`);
                } else {
                    // Duplicate found - merge values, prefer filled over empty
                    const existing = deduplicatedMap.get(normalizedKey);
                    
                    logger.warn(`  🧹 [DEDUPE ${index}] DUPLICATE FOUND: {${def.key}} (usage: ${def.usageCount || 0}) → merging into {${existing.key}} (usage: ${existing.usageCount || 0})`);
                    
                    // Preserve user-entered values (non-empty wins)
                    if (!existing.value && def.value) {
                        existing.value = def.value;
                        logger.debug(`    ↳ Preserved value from duplicate: "${def.value}"`);
                    }
                    
                    // Merge usage counts (add them up)
                    const oldUsage = existing.usageCount || 0;
                    existing.usageCount = oldUsage + (def.usageCount || 0);
                    logger.debug(`    ↳ Merged usage count: ${oldUsage} + ${def.usageCount || 0} = ${existing.usageCount}`);
                    
                    duplicatesRemoved++;
                }
            });
            
            const existingDefs = Array.from(deduplicatedMap.values());
            
            logger.info(`✨ [ENTERPRISE SCAN ${scanId}] Deduplication complete - removed ${duplicatesRemoved} duplicates (${rawExistingDefs.length} → ${existingDefs.length})`);
            
            if (duplicatesRemoved > 0) {
                logger.info(`🎯 [ENTERPRISE SCAN ${scanId}] Cleaned variables: ${existingDefs.map(d => `{${d.key}}`).join(', ')}`);
            }
            
            // ═══════════════════════════════════════════════════════════════
            // STEP 6: Differential Analysis (NOW uses deduplicated baseline!)
            // ═══════════════════════════════════════════════════════════════
            logger.info(`🔍 [ENTERPRISE SCAN ${scanId}] Checkpoint 10: Performing differential analysis (against deduplicated baseline)...`);
            
            const differential = await this.performDifferentialAnalysis(
                existingDefs,  // ✨ Use deduplicated variables as baseline!
                previousScan,
                variableDefinitions,
                templatesScanned
            );
            
            logger.info(`✅ [ENTERPRISE SCAN ${scanId}] Checkpoint 11: Differential analysis complete`);
            logger.info(`📊 [ENTERPRISE SCAN ${scanId}] New: ${differential.variablesChanged.new.length}, Removed: ${differential.variablesChanged.removed.length}, Modified: ${differential.variablesChanged.modified.length}`);
            
            // ═══════════════════════════════════════════════════════════════
            // STEP 7: Merge with Deduplicated Variables (Preserve User Values!)
            // ═══════════════════════════════════════════════════════════════
            logger.info(`🔍 [ENTERPRISE SCAN ${scanId}] Checkpoint 12: Merging new variables with deduplicated baseline...`);
            
            let newCount = 0;
            
            variableDefinitions.forEach(newDef => {
                // ✨ CASE-INSENSITIVE MATCHING: Compare using normalizedKey
                const existingIndex = existingDefs.findIndex(d => 
                    (d.normalizedKey || d.key.toLowerCase()) === newDef.normalizedKey
                );
                
                if (existingIndex === -1) {
                    // New variable - add it
                    existingDefs.push(newDef);
                    newCount++;
                    logger.info(`  ➕ NEW: {${newDef.key}} - ${newDef.usageCount} occurrences${newDef.hasMultipleFormats ? ` (⚠️ ${newDef.formatVariations.length} formats)` : ''}`);
                } else {
                    // Existing variable - update metadata only
                    existingDefs[existingIndex].key = newDef.key;  // Update to preferred format
                    existingDefs[existingIndex].normalizedKey = newDef.normalizedKey;
                    existingDefs[existingIndex].usageCount = newDef.usageCount;
                    existingDefs[existingIndex].locations = newDef.locations;
                    existingDefs[existingIndex].source = newDef.source;
                    existingDefs[existingIndex].formatVariations = newDef.formatVariations;
                    existingDefs[existingIndex].formatCounts = newDef.formatCounts;
                    existingDefs[existingIndex].hasMultipleFormats = newDef.hasMultipleFormats;
                    existingDefs[existingIndex].preferredFormat = newDef.preferredFormat;
                    logger.debug(`  🔄 UPDATE: {${newDef.key}} - usage count: ${newDef.usageCount}${newDef.hasMultipleFormats ? ` (⚠️ ${newDef.formatVariations.length} formats)` : ''}`);
                }
            });
            
            logger.info(`✅ [ENTERPRISE SCAN ${scanId}] Checkpoint 13: Merge complete - ${newCount} new variables added`);
            
            // ═══════════════════════════════════════════════════════════════
            // STEP 8: Build Comprehensive Scan Report
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
            // STEP 9: Save to MongoDB
            // ═══════════════════════════════════════════════════════════════
            logger.info(`🔍 [ENTERPRISE SCAN ${scanId}] Checkpoint 14: Saving to MongoDB...`);
            
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
            // NOTE: Redis cache NOT cleared - variables are MongoDB-only
            // Live calls load company doc from MongoDB (Redis caches full doc if available)
            // Variable changes take effect on next company doc load (acceptable latency)
            // ═══════════════════════════════════════════════════════════════
            
            // ═══════════════════════════════════════════════════════════════
            // FINAL: Log Summary
            // ═══════════════════════════════════════════════════════════════
            logger.info(`✅ [ENTERPRISE SCAN ${scanId}] Checkpoint 15: SCAN COMPLETE!`);
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
    async performDifferentialAnalysis(previousVars, previousScan, currentVariables, currentTemplates) {
        // previousVars: Array of deduplicated variable definitions from database
        // previousScan: Last scan report (for template comparison)
        // currentVariables: Newly scanned variable definitions
        // currentTemplates: Currently active templates
        
        if (!previousScan || previousVars.length === 0) {
            return {
                previousScanId: previousScan?.scanId || null,
                previousScanDate: previousScan?.timestamp || null,
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
        const previousTemplates = previousScan.templatesScanned?.list || [];
        
        // Template changes
        const currentTemplateIds = new Set(currentTemplates.map(t => t.templateId));
        const previousTemplateIds = new Set(previousTemplates.map(t => t.templateId));
        
        const templatesChanged = {
            added: currentTemplates.filter(t => !previousTemplateIds.has(t.templateId)).map(t => t.templateName),
            removed: previousTemplates.filter(t => !currentTemplateIds.has(t.templateId)).map(t => t.templateName),
            unchanged: currentTemplates.filter(t => previousTemplateIds.has(t.templateId)).map(t => t.templateName)
        };
        
        // ✨ CASE-INSENSITIVE Variable changes: Use normalizedKey for comparison
        const currentVarMap = new Map(currentVariables.map(v => [v.normalizedKey || v.key.toLowerCase(), v]));
        const previousVarMap = new Map(previousVars.map(v => [(v.normalizedKey || v.key.toLowerCase()), v]));
        
        const variablesChanged = {
            new: [],
            removed: [],
            modified: [],
            unchanged: []
        };
        
        // Find new and modified
        for (const [normalizedKey, currentVar] of currentVarMap.entries()) {
            if (!previousVarMap.has(normalizedKey)) {
                variablesChanged.new.push({
                    key: currentVar.key,                    // Display preferred format
                    normalizedKey: normalizedKey,
                    occurrences: currentVar.usageCount,
                    addedBy: currentVar.source,
                    hasMultipleFormats: currentVar.hasMultipleFormats || false,
                    formatVariations: currentVar.formatVariations || [currentVar.key]
                });
            } else {
                const previousVar = previousVarMap.get(normalizedKey);
                if (currentVar.usageCount !== previousVar.usageCount) {
                    variablesChanged.modified.push({
                        key: currentVar.key,                // Display preferred format
                        normalizedKey: normalizedKey,
                        oldCount: previousVar.usageCount,
                        newCount: currentVar.usageCount,
                        delta: currentVar.usageCount - previousVar.usageCount
                    });
                } else {
                    variablesChanged.unchanged.push({
                        key: currentVar.key,                // Display preferred format
                        normalizedKey: normalizedKey,
                        occurrences: currentVar.usageCount
                    });
                }
            }
        }
        
        // Find removed (using normalizedKey for comparison)
        for (const [normalizedKey, previousVar] of previousVarMap.entries()) {
            if (!currentVarMap.has(normalizedKey)) {
                variablesChanged.removed.push({
                    key: previousVar.key,           // Display original format
                    normalizedKey: normalizedKey,
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
        // Defensive check for undefined/null
        if (!key || typeof key !== 'string') {
            return 'General';
        }
        
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
        // Defensive check for undefined/null
        if (!key || typeof key !== 'string') {
            return false;
        }
        
        const requiredVars = ['companyName', 'phoneNumber', 'businessName', 'phone', 'email'];
        return requiredVars.includes(key);
    }
    
    /**
     * Helper: Infer variable type from name
     */
    inferType(key) {
        // Defensive check for undefined/null
        if (!key || typeof key !== 'string') {
            return 'text';
        }
        
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
        // Defensive check for undefined/null
        if (!key || typeof key !== 'string') {
            return 'Enter value';
        }
        
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
        // Defensive check for undefined/null
        if (!key || typeof key !== 'string') {
            return 'Unknown';
        }
        
        return key
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, str => str.toUpperCase())
            .trim();
    }
}

module.exports = new EnterpriseVariableScanService();

