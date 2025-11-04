/**
 * ============================================================================
 * PLACEHOLDER SCAN SERVICE - INTELLIGENT VARIABLE MANAGEMENT
 * ============================================================================
 * 
 * PURPOSE:
 * Orchestrate placeholder scanning, alert generation, and cache management
 * for company-specific variable setup. Ensures companies have all required
 * variables configured before going live.
 * 
 * ARCHITECTURE:
 * - Scans template → Extracts placeholders → Enriches metadata
 * - Merges with existing company variables (preserves filled values)
 * - Generates alerts for missing required variables
 * - Auto-clears cache after updates
 * - Dashboard TO-DO integration ready
 * 
 * KEY FEATURES:
 * - Smart merging (keeps existing values)
 * - Alert generation (missing required fields)
 * - Auto-clear alerts when complete
 * - Background scanning for bulk updates
 * - Sub-100ms performance
 * 
 * USAGE:
 * ```javascript
 * const PlaceholderScanService = require('./services/PlaceholderScanService');
 * 
 * // Scan single company
 * const result = await PlaceholderScanService.scanCompany(companyId);
 * 
 * // Scan all companies using a template
 * await PlaceholderScanService.scanAllCompaniesForTemplate(templateId);
 * ```
 * 
 * ============================================================================
 */

const Company = require('../models/v2Company');
const logger = require('../utils/logger.js');

const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
const CacheHelper = require('../utils/cacheHelper');
const AdminNotificationService = require('./AdminNotificationService');
const ScenarioPoolService = require('./ScenarioPoolService');
const { 
    extractPlaceholdersFromTemplate, 
    enrichPlaceholder,
    normalizePlaceholderName
} = require('../utils/placeholderUtils');

// ============================================================================
// PLACEHOLDER SCAN SERVICE
// ============================================================================

class PlaceholderScanService {
    
    // ========================================================================
    // SINGLE COMPANY SCAN
    // ========================================================================
    
    /**
     * Scan a single company for placeholders
     * 
     * PROCESS:
     * 1. Load company & template(s)
     * 2. Extract placeholders from all templates
     * 3. Enrich with metadata
     * 4. Smart merge with existing definitions (preserve filled values)
     * 5. Generate alerts for missing required variables
     * 6. Save to company & clear cache
     * 
     * PERFORMANCE: 50-150ms
     * 
     * @param {string} companyId - MongoDB ObjectId as string
     * @param {Object} options - Scan options
     * @param {string} options.reason - Why the scan was triggered: 'manual', 'template_activated', 'template_removed'
     * @param {string} options.triggeredBy - Email or userId of who triggered the scan
     * @param {string} options.templateId - Template ID that triggered the scan (for template_activated/removed)
     * @returns {Promise<Object>} Scan results
     * 
     * @example
     * const result = await PlaceholderScanService.scanCompany('64a1b2c3d4e5f6', {
     *   reason: 'template_activated',
     *   triggeredBy: 'admin@example.com'
     * });
     * // {
     * //   success: true,
     * //   placeholders: [...],
     * //   newCount: 3,
     * //   existingCount: 5,
     * //   missingRequired: [...],
     * //   hasAlert: true
     * // }
     */
    static async scanCompany(companyId, options = {}) {
        const { reason = 'manual', triggeredBy = 'system', templateId = null } = options;
        const startTime = Date.now();
        
        logger.debug(`🔍 [PLACEHOLDER SCAN] Starting scan for company ${companyId} (reason: ${reason}, triggeredBy: ${triggeredBy})`);
        
        try {
            // ============================================================================
            // STEP 1: LOAD COMPANY & SCENARIOS VIA SCENARIOPOOLSERVICE
            // ============================================================================
            // CRITICAL: Use the same service as Live Scenarios to ensure consistency
            
            const company = await Company.findById(companyId);
            if (!company) {
                throw new Error(`Company ${companyId} not found`);
            }
            
            logger.info('[VARIABLE SCAN] Loading scenario pool for company %s', companyId);
            
            // Use ScenarioPoolService - same source as Live Scenarios endpoint
            const { scenarios, templatesUsed, error, warning } = await ScenarioPoolService.getScenarioPoolForCompany(companyId);
            
            if (error) {
                logger.error('[VARIABLE SCAN] ❌ ScenarioPoolService error:', error);
                throw new Error(`Failed to load scenarios: ${error}`);
            }
            
            if (warning) {
                logger.warn('[VARIABLE SCAN] ⚠️ ScenarioPoolService warning:', warning);
            }
            
            logger.info('[VARIABLE SCAN] ScenarioPoolService returned: %d scenarios, %d templates', 
                scenarios?.length || 0, 
                templatesUsed?.length || 0
            );
            
            // Safety check: ensure scenarios and templatesUsed are arrays
            const safeScenarios = Array.isArray(scenarios) ? scenarios : [];
            const safeTemplatesUsed = Array.isArray(templatesUsed) ? templatesUsed : [];
            
            // Calculate category count from scenarios
            const categoriesSet = new Set();
            safeScenarios.forEach(s => {
                if (s.categoryName) {
                    categoriesSet.add(s.categoryName);
                }
            });
            const totalCategories = categoriesSet.size;
            
            logger.info('[VARIABLE SCAN] Company %s scanning %d templates: %o', 
                companyId, 
                safeTemplatesUsed.length, 
                safeTemplatesUsed.map(t => t.templateId)
            );
            
            // ============================================================================
            // ENTERPRISE VALIDATION: Load actual templates for expected vs actual comparison
            // ============================================================================
            logger.info('[VARIABLE SCAN] Loading template schemas for validation...');
            
            const templateIds = safeTemplatesUsed.map(t => t.templateId);
            const actualTemplates = await GlobalInstantResponseTemplate
                .find({ _id: { $in: templateIds } })
                .select('_id name categories')
                .lean();
            
            logger.info('[VARIABLE SCAN] Loaded %d template schemas from database', actualTemplates.length);
            
            // Build validation report: expected vs actual
            const templateBreakdown = [];
            const validationIssues = [];
            
            safeTemplatesUsed.forEach((template, idx) => {
                const templateScenarios = safeScenarios.filter(s => String(s.templateId) === String(template.templateId));
                const templateCategories = new Set(templateScenarios.map(s => s.categoryName));
                
                // Find actual template schema
                const actualTemplate = actualTemplates.find(t => String(t._id) === String(template.templateId));
                
                let expectedCategories = 0;
                let expectedScenarios = 0;
                
                if (actualTemplate && actualTemplate.categories) {
                    expectedCategories = actualTemplate.categories.length;
                    expectedScenarios = actualTemplate.categories.reduce((sum, cat) => {
                        return sum + (cat.scenarios?.length || 0);
                    }, 0);
                }
                
                const categoriesMatch = templateCategories.size === expectedCategories;
                const scenariosMatch = templateScenarios.length === expectedScenarios;
                
                const breakdown = {
                    templateId: template.templateId,
                    templateName: template.templateName || actualTemplate?.name || 'Unknown',
                    expected: {
                        categories: expectedCategories,
                        scenarios: expectedScenarios
                    },
                    scanned: {
                        categories: templateCategories.size,
                        scenarios: templateScenarios.length
                    },
                    validation: {
                        categoriesMatch,
                        scenariosMatch,
                        status: (categoriesMatch && scenariosMatch) ? 'complete' : 'partial'
                    },
                    categoryNames: Array.from(templateCategories)
                };
                
                templateBreakdown.push(breakdown);
                
                // Log validation result
                const statusIcon = breakdown.validation.status === 'complete' ? '✅' : '⚠️';
                logger.info('[VARIABLE SCAN]   %s Template %d: %s (ID: %s)', 
                    statusIcon,
                    idx + 1, 
                    breakdown.templateName, 
                    breakdown.templateId
                );
                logger.info('[VARIABLE SCAN]      Categories: %d/%d | Scenarios: %d/%d', 
                    breakdown.scanned.categories,
                    breakdown.expected.categories,
                    breakdown.scanned.scenarios,
                    breakdown.expected.scenarios
                );
                
                // Track validation issues
                if (!categoriesMatch || !scenariosMatch) {
                    const issue = {
                        templateId: template.templateId,
                        templateName: breakdown.templateName,
                        type: !categoriesMatch && !scenariosMatch ? 'categories_and_scenarios_mismatch' : 
                              !categoriesMatch ? 'categories_mismatch' : 'scenarios_mismatch',
                        expected: breakdown.expected,
                        scanned: breakdown.scanned,
                        severity: 'warning'
                    };
                    validationIssues.push(issue);
                    
                    logger.warn('[VARIABLE SCAN] ⚠️ Validation issue: %s - Expected %d categories, scanned %d | Expected %d scenarios, scanned %d',
                        breakdown.templateName,
                        breakdown.expected.categories,
                        breakdown.scanned.categories,
                        breakdown.expected.scenarios,
                        breakdown.scanned.scenarios
                    );
                }
            });
            
            if (safeScenarios.length === 0) {
                logger.warn(`⚠️ [VARIABLE SCAN] No scenarios found for company ${companyId} - Possible validation issue`);
                
                // Still need to clear any existing variables and save
                company.aiAgentSettings.variableDefinitions = [];
                company.aiAgentSettings.lastScanDate = new Date();
                company.aiAgentSettings.configurationAlert = null;
                
                // Store scan metadata with validation issue
                if (!company.aiAgentSettings.scanMetadata) {
                    company.aiAgentSettings.scanMetadata = {};
                }
                
                const emptyIssue = {
                    type: 'no_scenarios_found',
                    templateId: templateBreakdown[0]?.templateId,
                    templateName: templateBreakdown[0]?.templateName,
                    severity: 'error',
                    message: 'ScenarioPoolService returned 0 scenarios'
                };
                
                const emptyScanEntry = {
                    scanId: `scan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    scannedAt: new Date(),
                    reason,
                    triggeredBy,
                    templateId,
                    stats: {
                        templatesCount: safeTemplatesUsed.length,
                        categoriesCount: 0,
                        scenariosCount: 0,
                        uniqueVariables: 0,
                        totalPlaceholderOccurrences: 0
                    },
                    templates: templateBreakdown,
                    validation: {
                        status: 'error',
                        issues: [emptyIssue],
                        issueCount: 1
                    },
                    performance: {
                        scanDurationMs: Date.now() - startTime
                    }
                };
                
                company.aiAgentSettings.scanMetadata.lastScan = emptyScanEntry;
                
                // Store in history
                if (!company.aiAgentSettings.scanMetadata.history) {
                    company.aiAgentSettings.scanMetadata.history = [];
                }
                company.aiAgentSettings.scanMetadata.history.unshift(emptyScanEntry);
                if (company.aiAgentSettings.scanMetadata.history.length > 20) {
                    company.aiAgentSettings.scanMetadata.history = company.aiAgentSettings.scanMetadata.history.slice(0, 20);
                }
                
                company.markModified('aiAgentSettings.variableDefinitions');
                company.markModified('aiAgentSettings.lastScanDate');
                company.markModified('aiAgentSettings.configurationAlert');
                company.markModified('aiAgentSettings.scanMetadata');
                
                await company.save();
                await CacheHelper.clearCompanyCache(companyId);
                
                logger.info(`✅ [VARIABLE SCAN] Scan complete for company ${companyId} (0 scenarios, 0 variables, 1 validation issue)`);
                
                return {
                    success: true,
                    placeholders: [],
                    newCount: 0,
                    existingCount: 0,
                    missingRequired: [],
                    hasAlert: false,
                    message: 'No scenarios configured',
                    templatesUsed: safeTemplatesUsed,
                    templateBreakdown,
                    validationIssues: [emptyIssue],
                    scanMetadata: {
                        scanId: emptyScanEntry.scanId,
                        scannedAt: emptyScanEntry.scannedAt,
                        reason,
                        triggeredBy,
                        templateId,
                        validation: emptyScanEntry.validation,
                        performance: emptyScanEntry.performance
                    },
                    stats: {
                        templatesCount: safeTemplatesUsed.length,
                        categoriesCount: 0,
                        scenariosCount: 0,
                        totalPlaceholderOccurrences: 0,
                        uniqueVariables: 0
                    }
                };
            }
            
            // ============================================================================
            // STEP 2: EXTRACT PLACEHOLDERS FROM FLATTENED SCENARIOS
            // ============================================================================
            // Scan over the same scenario structure that Live Scenarios uses
            
            const combinedPlaceholderMap = new Map();
            let totalPlaceholderOccurrences = 0;
            
            // Regex: Match {anything} or [anything] with any casing
            const PLACEHOLDER_REGEX = /[\{\[]\s*([A-Za-z0-9_]+)\s*[\}\]]/g;
            
            for (const scenario of safeScenarios) {
                // Collect all text fields from scenario
                const textParts = [
                    scenario.name,
                    ...(scenario.triggers || []),
                    ...(scenario.quickReplies || []),
                    ...(scenario.fullReplies || []),
                    scenario.description,
                    scenario.notes
                ].filter(Boolean);
                
                // Scan each text part
                for (const text of textParts) {
                    if (!text || typeof text !== 'string') {continue;}
                    
                    const matches = text.matchAll(PLACEHOLDER_REGEX);
                    
                    for (const match of matches) {
                        const rawKey = match[1]; // e.g. "CompanyName", "company_name", "COMPANY"
                        const normalizedKey = normalizePlaceholderName(rawKey); // All become "companyname"
                        
                        const currentCount = combinedPlaceholderMap.get(normalizedKey) || 0;
                        combinedPlaceholderMap.set(normalizedKey, currentCount + 1);
                        totalPlaceholderOccurrences += 1;
                    }
                }
            }
            
            logger.info('[VARIABLE SCAN] Scan input stats for company %s', companyId, {
                templatesCount: safeTemplatesUsed.length,
                categoriesCount: totalCategories,
                scenariosCount: safeScenarios.length,
                totalPlaceholderOccurrences,
                uniqueVariables: combinedPlaceholderMap.size
            });
            
            logger.info(`✅ [VARIABLE SCAN] Found ${combinedPlaceholderMap.size} unique placeholders from ${totalPlaceholderOccurrences} total occurrences`);
            
            // 5. Enrich placeholders with metadata
            const newDefinitions = [];
            for (const [key, count] of combinedPlaceholderMap.entries()) {
                newDefinitions.push(enrichPlaceholder(key, count));
            }
            
            // 6. Smart merge with existing definitions
            const existingDefinitions = company.aiAgentSettings?.variableDefinitions || [];
            const existingKeys = new Set(existingDefinitions.map(def => def.key));
            
            const finalDefinitions = [];
            const newPlaceholders = [];
            const updatedPlaceholders = [];
            
            // Keep existing definitions (update usage counts)
            for (const existingDef of existingDefinitions) {
                const newDef = newDefinitions.find(d => d.key === existingDef.key);
                
                if (newDef) {
                    // Placeholder still exists - update usage count
                    const oldCount = existingDef.usageCount || 0;
                    const newCount = newDef.usageCount;
                    
                    finalDefinitions.push({
                        ...existingDef,
                        usageCount: newCount
                    });
                    
                    if (oldCount !== newCount) {
                        updatedPlaceholders.push({
                            key: existingDef.key,
                            oldCount,
                            newCount
                        });
                    }
                } else {
                    // Placeholder removed from template - keep but mark as deprecated
                    finalDefinitions.push({
                        ...existingDef,
                        deprecated: true
                    });
                }
            }
            
            // Add new placeholders
            for (const newDef of newDefinitions) {
                if (!existingKeys.has(newDef.key)) {
                    finalDefinitions.push(newDef);
                    newPlaceholders.push(newDef);
                }
            }
            
            // 7. Check for missing required values
            // Handle both Mongoose Map and plain object
            const currentVariables = company.aiAgentSettings?.variables || new Map();
            const getValue = (key) => {
                return currentVariables instanceof Map ? currentVariables.get(key) : currentVariables[key];
            };
            
            const missingRequired = finalDefinitions.filter(def => 
                def.required && !getValue(def.key)
            );
            
            logger.info(`📊 [PLACEHOLDER SCAN] New: ${newPlaceholders.length}, Updated: ${updatedPlaceholders.length}, Missing: ${missingRequired.length}`);
            
            // 8. Generate or clear alert
            if (missingRequired.length > 0) {
                company.aiAgentSettings.configurationAlert = {
                    type: 'missing_variables',
                    severity: 'WARNING',
                    message: `${missingRequired.length} required variable${missingRequired.length > 1 ? 's' : ''} need${missingRequired.length === 1 ? 's' : ''} values`,
                    missingVariables: missingRequired.map(def => ({
                        key: def.key,
                        label: def.label,
                        type: def.type,
                        category: def.category
                    })),
                    createdAt: new Date()
                };
                
                logger.info(`⚠️  [PLACEHOLDER SCAN] Alert generated for ${missingRequired.length} missing variables`);
            } else {
                // All required variables filled - clear alert
                company.aiAgentSettings.configurationAlert = null;
                logger.info(`✅ [PLACEHOLDER SCAN] All required variables filled - alert cleared`);
            }
            
            // 9. Save updated definitions, alert, and scan metadata
            company.aiAgentSettings.variableDefinitions = finalDefinitions;
            company.aiAgentSettings.lastScanDate = new Date();
            
            // ============================================================================
            // ENTERPRISE AUDIT TRAIL: Store comprehensive scan history
            // ============================================================================
            if (!company.aiAgentSettings.scanMetadata) {
                company.aiAgentSettings.scanMetadata = {};
            }
            
            const scanEntry = {
                scanId: `scan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                scannedAt: new Date(),
                reason,
                triggeredBy,
                templateId,
                stats: {
                    templatesCount: safeTemplatesUsed.length,
                    categoriesCount: totalCategories,
                    scenariosCount: safeScenarios.length,
                    uniqueVariables: combinedPlaceholderMap.size,
                    totalPlaceholderOccurrences
                },
                templates: templateBreakdown,
                validation: {
                    status: validationIssues.length === 0 ? 'complete' : 'partial',
                    issues: validationIssues,
                    issueCount: validationIssues.length
                },
                performance: {
                    scanDurationMs: Date.now() - startTime
                }
            };
            
            // Store last scan for quick access
            company.aiAgentSettings.scanMetadata.lastScan = scanEntry;
            
            // Store scan history (keep last 20 scans for audit trail)
            if (!company.aiAgentSettings.scanMetadata.history) {
                company.aiAgentSettings.scanMetadata.history = [];
            }
            
            company.aiAgentSettings.scanMetadata.history.unshift(scanEntry);
            
            // Trim history to last 20 scans (enterprise audit trail)
            if (company.aiAgentSettings.scanMetadata.history.length > 20) {
                company.aiAgentSettings.scanMetadata.history = company.aiAgentSettings.scanMetadata.history.slice(0, 20);
            }
            
            logger.info('[VARIABLE SCAN] Scan history updated: %d entries stored', 
                company.aiAgentSettings.scanMetadata.history.length
            );
            
            // Mark nested paths as modified (Mongoose requirement)
            company.markModified('aiAgentSettings.variableDefinitions');
            company.markModified('aiAgentSettings.configurationAlert');
            company.markModified('aiAgentSettings.lastScanDate');
            company.markModified('aiAgentSettings.scanMetadata');
            
            await company.save();
            
            // 10. Clear cache
            await CacheHelper.clearCompanyCache(companyId);
            
            // 11. Send admin notification if alert was generated (non-blocking)
            if (missingRequired.length > 0) {
                const fixUrl = `${process.env.FRONTEND_URL || 'https://clientsvia-backend.onrender.com'}/company-profile.html?id=${companyId}&tab=ai-agent-settings&subtab=variables`;
                
                // Send notification asynchronously (don't block main flow)
                setImmediate(async () => {
                    try {
                        await AdminNotificationService.sendAlert({
                            companyId,
                            companyName: company.companyName || 'Unknown Company',
                            alertType: 'missing_variables',
                            severity: 'WARNING',
                            message: `${missingRequired.length} required variable${missingRequired.length > 1 ? 's' : ''} need${missingRequired.length === 1 ? 's' : ''} values`,
                            fixUrl
                        });
                    } catch (notificationError) {
                        // Never let notification errors block the main flow
                        logger.error('❌ [PLACEHOLDER SCAN] Notification failed (non-critical):', notificationError.message);
                    }
                });
            }
            
            const scanDuration = Date.now() - startTime;
            
            logger.info(`✅ [VARIABLE SCAN] Scan complete for company ${companyId} (reason: ${reason}, duration: ${scanDuration}ms)`);
            
            return {
                success: true,
                placeholders: finalDefinitions,
                newCount: newPlaceholders.length,
                existingCount: existingDefinitions.length,
                updatedCount: updatedPlaceholders.length,
                missingRequired,
                hasAlert: missingRequired.length > 0,
                newPlaceholders,
                updatedPlaceholders,
                templatesUsed: safeTemplatesUsed, // Include template metadata for UI
                templateBreakdown, // ENTERPRISE: Template validation breakdown
                validationIssues, // ENTERPRISE: List of validation issues
                scanMetadata: {
                    scanId: scanEntry.scanId,
                    scannedAt: scanEntry.scannedAt,
                    reason,
                    triggeredBy,
                    templateId,
                    validation: scanEntry.validation,
                    performance: scanEntry.performance
                },
                stats: {
                    templatesCount: safeTemplatesUsed.length,
                    categoriesCount: totalCategories,
                    scenariosCount: safeScenarios.length,
                    totalPlaceholderOccurrences,
                    uniqueVariables: combinedPlaceholderMap.size
                }
            };
            
        } catch (error) {
            logger.error(`❌ [PLACEHOLDER SCAN] Failed for company ${companyId}:`, error);
            throw error;
        }
    }
    
    // ========================================================================
    // BULK TEMPLATE SCAN
    // ========================================================================
    
    /**
     * Scan all companies using a specific template
     * 
     * USE CASE: Admin updates Global AI Brain template
     * PROCESS: Background job, scans all affected companies
     * PERFORMANCE: ~50-100ms per company
     * 
     * @param {string} templateId - Global template MongoDB ObjectId as string
     * @returns {Promise<Object>} Bulk scan results
     * 
     * @example
     * // After admin updates Global AI Brain template
     * await PlaceholderScanService.scanAllCompaniesForTemplate('64a1b2c3d4e5f6');
     */
    static async scanAllCompaniesForTemplate(templateId) {
        logger.debug(`🔍 [BULK SCAN] Starting scan for template ${templateId}`);
        
        try {
            // 1. Find all companies using this template
            const companies = await Company.find({
                'aiAgentSettings.templateReferences.templateId': templateId
            }).select('_id companyName');
            
            if (companies.length === 0) {
                logger.info(`ℹ️  [BULK SCAN] No companies using template ${templateId}`);
                return {
                    success: true,
                    companiesScanned: 0,
                    companiesWithAlerts: 0
                };
            }
            
            logger.info(`📋 [BULK SCAN] Found ${companies.length} companies to scan`);
            
            // 2. Scan each company
            const results = {
                success: true,
                companiesScanned: 0,
                companiesWithAlerts: 0,
                companiesFailed: 0,
                errors: []
            };
            
            for (const company of companies) {
                try {
                    const scanResult = await this.scanCompany(company._id.toString());
                    
                    results.companiesScanned++;
                    
                    if (scanResult.hasAlert) {
                        results.companiesWithAlerts++;
                    }
                    
                    logger.info(`✅ [BULK SCAN] Scanned company ${company.companyName}`);
                    
                } catch (error) {
                    results.companiesFailed++;
                    results.errors.push({
                        companyId: company._id.toString(),
                        companyName: company.companyName,
                        error: error.message
                    });
                    
                    logger.error(`❌ [BULK SCAN] Failed to scan company ${company.companyName}:`, error.message);
                }
            }
            
            logger.info(`✅ [BULK SCAN] Complete: ${results.companiesScanned} scanned, ${results.companiesWithAlerts} alerts, ${results.companiesFailed} failures`);
            
            return results;
            
        } catch (error) {
            logger.error(`❌ [BULK SCAN] Failed for template ${templateId}:`, error);
            throw error;
        }
    }
    
    // ========================================================================
    // ALERT MANAGEMENT
    // ========================================================================
    
    /**
     * Get all companies with configuration alerts
     * 
     * USE CASE: Dashboard TO-DO widget
     * RETURNS: List of companies needing attention
     * 
     * @returns {Promise<Array>} Companies with alerts
     * 
     * @example
     * const todos = await PlaceholderScanService.getConfigurationAlerts();
     * // [
     * //   {
     * //     companyId: '64a1b2c3',
     * //     companyName: "Joe's Plumbing",
     * //     alert: { ... },
     * //     missingCount: 2
     * //   }
     * // ]
     */
    static async getConfigurationAlerts() {
        logger.debug(`📋 [ALERTS] Fetching all configuration alerts`);
        
        try {
            const companies = await Company.find({
                'aiAgentSettings.configurationAlert': { $exists: true, $ne: null }
            })
            .select('companyName aiAgentSettings.configurationAlert')
            .sort({ 'aiAgentSettings.configurationAlert.createdAt': -1 });
            
            const alerts = companies.map(company => ({
                companyId: company._id.toString(),
                companyName: company.companyName,
                alert: company.aiAgentSettings.configurationAlert,
                missingCount: company.aiAgentSettings.configurationAlert.missingVariables?.length || 0
            }));
            
            logger.info(`✅ [ALERTS] Found ${alerts.length} configuration alerts`);
            
            return alerts;
            
        } catch (error) {
            logger.error(`❌ [ALERTS] Failed to fetch alerts:`, error);
            throw error;
        }
    }
    
    // ========================================================================
    // VALIDATION & HEALTH
    // ========================================================================
    
    /**
     * Check if company has all required variables filled
     * 
     * USE CASE: Pre-flight check before going live
     * 
     * @param {string} companyId - Company MongoDB ObjectId
     * @returns {Promise<Object>} Validation result
     * 
     * @example
     * const validation = await PlaceholderScanService.validateCompanyVariables('64a1b2c3');
     * // {
     * //   isValid: false,
     * //   missingRequired: ['phone', 'companyName'],
     * //   totalRequired: 3,
     * //   filledRequired: 1
     * // }
     */
    static async validateCompanyVariables(companyId) {
        logger.info(`🔍 [VALIDATION] Checking variables for company ${companyId}`);
        
        try {
            const company = await Company.findById(companyId)
                .select('aiAgentSettings.variableDefinitions aiAgentSettings.variables');
            
            if (!company) {
                throw new Error(`Company ${companyId} not found`);
            }
            
            const definitions = company.aiAgentSettings?.variableDefinitions || [];
            const variables = company.aiAgentSettings?.variables || {};
            
            const requiredDefs = definitions.filter(def => def.required);
            const missingRequired = requiredDefs.filter(def => !variables[def.key]);
            
            const isValid = missingRequired.length === 0;
            
            logger.info(`${isValid ? '✅' : '⚠️ '} [VALIDATION] Company ${companyId}: ${isValid ? 'VALID' : `Missing ${missingRequired.length} required variables`}`);
            
            return {
                isValid,
                missingRequired: missingRequired.map(def => def.key),
                totalRequired: requiredDefs.length,
                filledRequired: requiredDefs.length - missingRequired.length
            };
            
        } catch (error) {
            logger.error(`❌ [VALIDATION] Failed for company ${companyId}:`, error);
            throw error;
        }
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = PlaceholderScanService;

