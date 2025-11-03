/**
 * ============================================================================
 * SCENARIO POOL SERVICE - CANONICAL SCENARIO LOADING
 * ============================================================================
 * 
 * PURPOSE:
 * Single source of truth for building the effective scenario list for a company.
 * Used by both AiCore UI and Twilio runtime to ensure consistency.
 * 
 * KEY FEATURES:
 * - Multi-template support via aiAgentSettings.templateReferences
 * - Legacy fallback to configuration.clonedFrom
 * - Per-company scenario enable/disable (scenarioControls)
 * - Template priority ordering
 * - Only loads 'live' and active scenarios
 * 
 * USAGE:
 * ```js
 * const { scenarios, templatesUsed } = await ScenarioPoolService.getScenarioPoolForCompany(companyId);
 * const enabledScenarios = scenarios.filter(s => s.isEnabledForCompany !== false);
 * ```
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');
const Company = require('../models/v2Company');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');

class ScenarioPoolService {
    /**
     * ============================================================================
     * GET SCENARIO POOL FOR COMPANY - MAIN ENTRY POINT
     * ============================================================================
     * Builds the complete scenario list for a company from all active templates.
     * 
     * @param {String} companyId - Company ObjectId
     * @param {Object} options - Reserved for future use
     * @returns {Promise<Object>} - { scenarios: Array, templatesUsed: Array }
     */
    static async getScenarioPoolForCompany(companyId, options = {}) {
        const startTime = Date.now();
        
        logger.info(`📚 [SCENARIO POOL] Building scenario pool for company: ${companyId}`);
        
        try {
            // ========================================================
            // STEP 1: LOAD COMPANY DATA
            // ========================================================
            const company = await Company.findById(companyId)
                .select('aiAgentSettings.templateReferences aiAgentSettings.scenarioControls configuration.clonedFrom companyName businessName')
                .lean();
            
            if (!company) {
                logger.error(`❌ [SCENARIO POOL] Company not found: ${companyId}`);
                return {
                    scenarios: [],
                    templatesUsed: [],
                    error: 'Company not found'
                };
            }
            
            const companyName = company.companyName || company.businessName || companyId;
            logger.debug(`📊 [SCENARIO POOL] Company: ${companyName}`);
            
            // ========================================================
            // STEP 2: DETERMINE WHICH TEMPLATES TO USE
            // ========================================================
            const templateIds = this._determineTemplateIds(company);
            
            if (templateIds.length === 0) {
                logger.info(`⚠️ [SCENARIO POOL] No templates configured for company: ${companyName}`);
                return {
                    scenarios: [],
                    templatesUsed: [],
                    warning: 'No templates configured'
                };
            }
            
            logger.info(`📋 [SCENARIO POOL] Found ${templateIds.length} template(s) to load`);
            
            // ========================================================
            // STEP 3: LOAD TEMPLATES AND FLATTEN SCENARIOS
            // ========================================================
            const { scenarioPool, templatesUsed } = await this._loadAndFlattenScenarios(
                templateIds,
                companyId
            );
            
            logger.info(`✅ [SCENARIO POOL] Loaded ${scenarioPool.length} scenarios from ${templatesUsed.length} template(s)`);
            
            // ========================================================
            // STEP 4: APPLY PER-COMPANY SCENARIO CONTROLS
            // ========================================================
            const controlsMap = this._buildScenarioControlMap(company);
            
            scenarioPool.forEach(scenario => {
                const key = `${scenario.templateId}:${scenario.scenarioId}`;
                const control = controlsMap.get(key);
                
                if (control) {
                    scenario.isEnabledForCompany = control.isEnabled;
                    scenario.disabledAt = control.disabledAt || null;
                    scenario.disabledBy = control.disabledBy || null;
                    scenario.disabledNotes = control.notes || null;
                } else {
                    // Default: enabled
                    scenario.isEnabledForCompany = true;
                }
            });
            
            const enabledCount = scenarioPool.filter(s => s.isEnabledForCompany).length;
            const disabledCount = scenarioPool.length - enabledCount;
            
            logger.info(`🎯 [SCENARIO POOL] Scenario status: ${enabledCount} enabled, ${disabledCount} disabled (${Date.now() - startTime}ms)`);
            
            return {
                scenarios: scenarioPool,
                templatesUsed
            };
            
        } catch (error) {
            logger.error(`❌ [SCENARIO POOL] Error building scenario pool for ${companyId}:`, error);
            return {
                scenarios: [],
                templatesUsed: [],
                error: error.message
            };
        }
    }
    
    /**
     * ============================================================================
     * DETERMINE TEMPLATE IDS - MULTI-TEMPLATE VS LEGACY
     * ============================================================================
     * Logic:
     * 1. If templateReferences exists and has enabled entries → use those (multi-template)
     * 2. Else if configuration.clonedFrom exists → use that (legacy single template)
     * 3. Else → no templates
     * 
     * @param {Object} company - Company document (lean)
     * @returns {Array<Object>} - [{ templateId, priority }] sorted by priority
     * @private
     */
    static _determineTemplateIds(company) {
        const templateRefs = company.aiAgentSettings?.templateReferences || [];
        const legacyClonedFrom = company.configuration?.clonedFrom;
        
        // NEW SYSTEM: Multi-template via templateReferences
        const enabledRefs = templateRefs.filter(ref => 
            ref.templateId && ref.enabled !== false
        );
        
        if (enabledRefs.length > 0) {
            logger.debug(`📚 [SCENARIO POOL] Using NEW multi-template system: ${enabledRefs.length} template(s)`);
            
            // Sort by priority (lower number = higher priority)
            return enabledRefs
                .map(ref => ({
                    templateId: ref.templateId,
                    priority: ref.priority || 999
                }))
                .sort((a, b) => a.priority - b.priority);
        }
        
        // LEGACY SYSTEM: Single template via configuration.clonedFrom
        if (legacyClonedFrom) {
            logger.debug(`📚 [SCENARIO POOL] Using LEGACY single-template system`);
            return [{
                templateId: legacyClonedFrom.toString(),
                priority: 1
            }];
        }
        
        logger.debug(`⚠️ [SCENARIO POOL] No templates found (neither new nor legacy system)`);
        return [];
    }
    
    /**
     * ============================================================================
     * LOAD AND FLATTEN SCENARIOS FROM TEMPLATES
     * ============================================================================
     * For each template:
     * - Load from MongoDB
     * - Flatten categories.scenarios[] into single array
     * - Only include: status='live' AND isActive=true
     * - Enrich with template/category metadata
     * 
     * @param {Array<Object>} templateRefs - [{ templateId, priority }]
     * @param {String} companyId - Company ObjectId
     * @returns {Promise<Object>} - { scenarioPool: Array, templatesUsed: Array }
     * @private
     */
    static async _loadAndFlattenScenarios(templateRefs, companyId) {
        const scenarioPool = [];
        const templatesUsed = [];
        
        for (const ref of templateRefs) {
            try {
                const template = await GlobalInstantResponseTemplate.findById(ref.templateId)
                    .select('_id name categories')
                    .lean();
                
                if (!template) {
                    logger.warn(`⚠️ [SCENARIO POOL] Template not found: ${ref.templateId}`);
                    continue;
                }
                
                logger.debug(`📖 [SCENARIO POOL] Processing template: ${template.name}`);
                
                templatesUsed.push({
                    templateId: template._id.toString(),
                    templateName: template.name
                });
                
                // Flatten scenarios from all categories
                const categories = template.categories || [];
                let scenarioCount = 0;
                
                categories.forEach(category => {
                    const scenarios = category.scenarios || [];
                    
                    scenarios.forEach(scenario => {
                        // FILTER: Only 'live' and active scenarios
                        if (scenario.status !== 'live' || scenario.isActive !== true) {
                            return;
                        }
                        
                        // Build standardized scenario object
                        scenarioPool.push({
                            // Company context
                            companyId: companyId,
                            
                            // Template metadata
                            templateId: template._id.toString(),
                            templateName: template.name,
                            templatePriority: ref.priority,
                            
                            // Category metadata
                            categoryId: category.id || category._id?.toString() || null,
                            categoryName: category.name || null,
                            
                            // Scenario identity
                            scenarioId: scenario.scenarioId || scenario._id?.toString(),
                            name: scenario.name,
                            status: scenario.status,
                            isActive: scenario.isActive,
                            
                            // Matching fields (used by HybridScenarioSelector)
                            triggers: scenario.triggers || [],
                            regexTriggers: scenario.regexTriggers || [],
                            negativeTriggers: scenario.negativeTriggers || [],
                            
                            // Reply variations
                            quickReplies: scenario.quickReplies || [],
                            fullReplies: scenario.fullReplies || [],
                            followUpFunnel: scenario.followUpFunnel || null,
                            
                            // Scoring and behavior
                            priority: scenario.priority || 0,
                            contextWeight: scenario.contextWeight || 1,
                            behavior: scenario.behavior || null,
                            cooldownSeconds: scenario.cooldownSeconds || 0,
                            
                            // Entity capture (future)
                            entityCapture: scenario.entityCapture || [],
                            dynamicVariables: scenario.dynamicVariables || {},
                            
                            // Action hooks (future)
                            actionHooks: scenario.actionHooks || [],
                            
                            // Voice/TTS
                            toneLevel: scenario.toneLevel || 2,
                            ttsOverride: scenario.ttsOverride || {},
                            
                            // Will be set in next step:
                            isEnabledForCompany: true // default, overridden by scenarioControls
                        });
                        
                        scenarioCount++;
                    });
                });
                
                logger.debug(`  ✅ Loaded ${scenarioCount} live scenarios from ${categories.length} categories`);
                
            } catch (error) {
                logger.error(`❌ [SCENARIO POOL] Error loading template ${ref.templateId}:`, error);
                // Continue with other templates
            }
        }
        
        return { scenarioPool, templatesUsed };
    }
    
    /**
     * ============================================================================
     * BUILD SCENARIO CONTROL MAP
     * ============================================================================
     * Creates a fast lookup Map from scenarioControls array.
     * 
     * Key format: `${templateId}:${scenarioId}`
     * Value: { isEnabled, disabledAt, disabledBy, notes }
     * 
     * @param {Object} company - Company document (lean)
     * @returns {Map} - Control lookup map
     * @private
     */
    static _buildScenarioControlMap(company) {
        const controlsMap = new Map();
        const controls = company.aiAgentSettings?.scenarioControls || [];
        
        controls.forEach(control => {
            if (!control.templateId || !control.scenarioId) {
                return; // Skip invalid entries
            }
            
            const key = `${control.templateId}:${control.scenarioId}`;
            controlsMap.set(key, {
                isEnabled: control.isEnabled !== false, // Default true
                disabledAt: control.disabledAt || null,
                disabledBy: control.disabledBy || null,
                notes: control.notes || null
            });
        });
        
        logger.debug(`🔧 [SCENARIO POOL] Built control map with ${controlsMap.size} entries`);
        
        return controlsMap;
    }
    
    /**
     * ============================================================================
     * HELPER: Build scenario control map from company (EXPORTED)
     * ============================================================================
     * Public helper for external use.
     * 
     * @param {Object} company - Company document
     * @returns {Map} - Control lookup map
     */
    static buildScenarioControlMap(company) {
        return this._buildScenarioControlMap(company);
    }
}

module.exports = ScenarioPoolService;

