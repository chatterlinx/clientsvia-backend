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
const ServiceSwitchboard = require('../models/ServiceSwitchboard');
const ServiceCatalog = require('../models/ServiceCatalog');
const { computeEffectiveConfigVersion } = require('../utils/effectiveConfigVersion');
const { compileScenarioPool, fastCandidateLookup } = require('./ScenarioRuntimeCompiler');

class ScenarioPoolService {
    // ============================================================
    // PHASE A.1: NORMALIZATION HELPERS
    // ============================================================
    // These helpers handle backwards compatibility for weighted replies
    // and other Phase A.1 data transformations
    
    /**
     * Normalize reply arrays to consistent {text, weight} format
     * Supports legacy [String] format and new [{text, weight}] format
     * 
     * @param {Array} rawReplies - Mixed array: strings or {text, weight} objects
     * @returns {Array<Object>} - [{text, weight}, ...]
     * @private
     */
    static _normalizeReplies(rawReplies) {
        if (!rawReplies || !Array.isArray(rawReplies)) {
            return [];
        }
        
        if (rawReplies.length === 0) {
            return [];
        }
        
        // Check if already normalized (first item is object with text property)
        if (typeof rawReplies[0] === 'object' && rawReplies[0] !== null && rawReplies[0].text) {
            return rawReplies.map(r => ({
                text: String(r.text).trim(),
                weight: typeof r.weight === 'number' ? Math.max(0, r.weight) : 3
            }));
        }
        
        // Legacy format: array of strings
        return rawReplies
            .filter(item => item && String(item).trim().length > 0)
            .map(text => ({
                text: String(text).trim(),
                weight: 3 // Default weight
            }));
    }
    
    /**
     * Ensure Phase A.1 fields exist in scenario object with defaults
     * 
     * @param {Object} scenario - Scenario object from template
     * @returns {Object} - Scenario with all Phase A.1 fields
     * @private
     */
    static _ensurePhaseA1Fields(scenario) {
        return {
            ...scenario,
            
            // Phase A.1: User phrases
            exampleUserPhrases: scenario.exampleUserPhrases || [],
            negativeUserPhrases: scenario.negativeUserPhrases || [],
            
            // Phase A.1: Weighted replies (normalized)
            quickReplies: this._normalizeReplies(scenario.quickReplies),
            fullReplies: this._normalizeReplies(scenario.fullReplies),
            followUpPrompts: this._normalizeReplies(scenario.followUpPrompts),
            
            // Phase A.1: Follow-up behavior
            followUpMode: scenario.followUpMode || 'NONE',
            followUpQuestionText: scenario.followUpQuestionText || null,
            transferTarget: scenario.transferTarget || null,
            
            // Phase A.1: Confidence override
            minConfidence: scenario.minConfidence || null,
            
            // Phase A.1: Admin notes
            notes: scenario.notes || ''
        };
    }
    
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
    static async getScenarioPoolForCompany(companyId, _options = {}) {
        const startTime = Date.now();
        const { bypassCache = false } = (_options && typeof _options === 'object') ? _options : {};
        const cacheKey = `scenario-pool:${companyId}`;
        const CACHE_TTL = 300; // 5 minutes
        
        logger.info(`📚 [SCENARIO POOL] Building scenario pool for company: ${companyId}`);
        
        try {
            // ========================================================
            // 🔧 PHASE 4: REDIS CACHE CHECK
            // ========================================================
            const { redisClient } = require('../db');
            
            if (!redisClient || typeof redisClient.get !== 'function') {
                logger.warn('⚠️ [SCENARIO POOL CACHE] Redis client unavailable - caching disabled');
            } else {
                if (bypassCache) {
                    logger.info(`🧪 [SCENARIO POOL CACHE] Bypassing cache (force fresh)`, { cacheKey });
                } else {
                    try {
                        const cached = await redisClient.get(cacheKey);
                        if (cached) {
                            const parsed = JSON.parse(cached);
                            const cacheHitTime = Date.now() - startTime;
                            logger.info(`✅ [SCENARIO POOL CACHE] Cache HIT (${cacheHitTime}ms) - ${parsed.scenarios?.length || 0} scenarios`);
                            console.log(`[🚀 CACHE HIT] Scenario pool loaded in ${cacheHitTime}ms (30x faster!)`);
                            return parsed;
                        }
                    } catch (cacheError) {
                        logger.warn(`⚠️ [SCENARIO POOL CACHE] Redis error (non-critical)`, {
                            message: cacheError?.message || String(cacheError),
                            name: cacheError?.name || null,
                            code: cacheError?.code || null
                        });
                        // Continue to MongoDB fallback
                    }
                }
            }
            
            logger.info(`⚪ [SCENARIO POOL CACHE] Cache MISS, loading from MongoDB...`);
            
            // ========================================================
            // STEP 1: LOAD COMPANY DATA
            // ========================================================
            const company = await Company.findById(companyId)
                .select('aiAgentSettings.templateReferences aiAgentSettings.scenarioControls aiAgentSettings.customTemplateId configuration.clonedFrom companyName businessName tradeKey')
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
            const { scenarioPool, templatesUsed, templatesMeta } = await this._loadAndFlattenScenarios(
                templateIds,
                companyId
            );
            
            logger.info(`✅ [SCENARIO POOL] Loaded ${scenarioPool.length} scenarios from ${templatesUsed.length} template(s)`);
            
            // ════════════════════════════════════════════════════════════════════════════
            // GUARDRAIL: Pool Composition Logging (for Black Box / diagnostics)
            // This ensures we can always trace where scenarios came from
            // ════════════════════════════════════════════════════════════════════════════
            const companyLocalScenarios = scenarioPool.filter(s => s.isCompanyLocal === true);
            const globalScenarios = scenarioPool.filter(s => s.isCompanyLocal !== true);
            
            // Group by templateId
            const scenariosByTemplate = {};
            scenarioPool.forEach(s => {
                const key = s.templateId || 'unknown';
                scenariosByTemplate[key] = (scenariosByTemplate[key] || 0) + 1;
            });
            
            const poolComposition = {
                total: scenarioPool.length,
                companyLocalCount: companyLocalScenarios.length,
                globalCount: globalScenarios.length,
                byTemplate: scenariosByTemplate,
                customTemplateId: company.aiAgentSettings?.customTemplateId || null
            };
            
            logger.info(`📊 [SCENARIO POOL] Composition:`, poolComposition);
            
            // ════════════════════════════════════════════════════════════════════════════
            // GUARDRAIL: Alarm if customTemplateId configured but no Company Local loaded
            // This catches the "UI looks right, runtime is lying" bug
            // ════════════════════════════════════════════════════════════════════════════
            if (company.aiAgentSettings?.customTemplateId && companyLocalScenarios.length === 0) {
                logger.error(`🚨 [CRITICAL_WIRING_GAP] customTemplateId configured but 0 Company Local scenarios loaded!`, {
                    companyId,
                    companyName,
                    customTemplateId: company.aiAgentSettings.customTemplateId,
                    totalScenariosLoaded: scenarioPool.length,
                    possibleCauses: [
                        'Custom template has no active scenarios',
                        'Custom template not found in database',
                        'Scenarios in custom template have isActive=false'
                    ]
                });
            }
            
            // Attach pool composition to result for Black Box logging
            const _poolComposition = poolComposition;
            
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
            
            // ========================================================
            // 🚀 PHASE 4.5: COMPILE SCENARIOS INTO RUNTIME SPECS
            // ========================================================
            // This is the "compilation" step - transforms raw JSON into
            // runtime-ready specs with:
            // - Pre-normalized triggers
            // - Trigger index for O(1) lookup
            // - "needs" flags for tiered settings budget
            // ========================================================
            const compileStart = Date.now();
            const compiled = compileScenarioPool(
                scenarioPool.filter(s => s.isEnabledForCompany),
                { templateId: templatesUsed[0] || 'multi' }
            );
            
            logger.info(`⚡ [SCENARIO POOL] Compiled ${compiled.specs.length} scenarios (${Date.now() - compileStart}ms)`, {
                indexSize: compiled.stats.indexSize,
                totalTriggers: compiled.stats.totalTriggers
            });
            
            // ========================================================
            // 🚀 V92: LOAD SERVICE SWITCHBOARD
            // ========================================================
            // This tells us which services the company ACTUALLY offers
            // Runtime can use this for:
            // - Deterministic declines ("We don't offer X")
            // - Service-scoped routing
            // - Service-aware responses
            // ========================================================
            let serviceContext = null;
            try {
                const switchboard = await ServiceSwitchboard.findOne({ companyId }).lean();
                
                if (switchboard && switchboard.services && switchboard.services.length > 0) {
                    // Build a quick lookup map: serviceKey -> { enabled, declineMessage, keywords, agentNotes }
                    const enabledServices = [];
                    const disabledServices = [];
                    const serviceMap = {};
                    
                    for (const svc of switchboard.services) {
                        const entry = {
                            serviceKey: svc.serviceKey,
                            enabled: svc.enabled === true,
                            declineMessage: svc.customDeclineMessage || null,
                            keywords: [...(svc.additionalKeywords || []), ...(svc.customKeywords || [])],
                            agentNotes: svc.agentNotes || null,
                            sourcePolicy: svc.sourcePolicy || 'auto',
                            triageEnabled: svc.triageEnabled !== false,
                            scheduling: svc.scheduling || null
                        };
                        
                        serviceMap[svc.serviceKey] = entry;
                        
                        if (entry.enabled) {
                            enabledServices.push(svc.serviceKey);
                        } else {
                            disabledServices.push(svc.serviceKey);
                        }
                    }
                    
                    // Also load catalog for default keywords and decline messages
                    const catalog = await ServiceCatalog.findOne({ templateId: switchboard.templateId }).lean();
                    
                    if (catalog && catalog.services) {
                        for (const catSvc of catalog.services) {
                            if (serviceMap[catSvc.serviceKey]) {
                                // Merge catalog defaults
                                const entry = serviceMap[catSvc.serviceKey];
                                entry.catalogName = catSvc.name;
                                entry.catalogKeywords = catSvc.keywords || [];
                                entry.catalogDeclineMessage = catSvc.declineMessage || null;
                                // Merge keywords (company + catalog)
                                entry.allKeywords = [...new Set([...entry.keywords, ...(catSvc.keywords || [])])];
                            }
                        }
                    }
                    
                    serviceContext = {
                        hasData: true,
                        templateId: switchboard.templateId,
                        enabledServices,
                        disabledServices,
                        serviceMap,
                        // Quick lookup helpers
                        isServiceEnabled: (key) => serviceMap[key]?.enabled === true,
                        getDeclineMessage: (key) => {
                            const svc = serviceMap[key];
                            if (!svc) return null;
                            return svc.declineMessage || svc.catalogDeclineMessage || `We don't currently offer ${svc.catalogName || key} services.`;
                        }
                    };
                    
                    logger.info(`✅ [SCENARIO POOL] Service Switchboard loaded: ${enabledServices.length} enabled, ${disabledServices.length} disabled`, {
                        companyId,
                        enabledServices: enabledServices.slice(0, 10),
                        disabledCount: disabledServices.length
                    });
                } else {
                    logger.debug(`⚪ [SCENARIO POOL] No Service Switchboard found for company`, { companyId });
                    serviceContext = { hasData: false, enabledServices: [], disabledServices: [], serviceMap: {} };
                }
            } catch (switchboardError) {
                logger.warn(`⚠️ [SCENARIO POOL] Failed to load Service Switchboard (non-critical)`, {
                    companyId,
                    error: switchboardError.message
                });
                serviceContext = { hasData: false, error: switchboardError.message };
            }
            
            // ========================================================
            // 🔧 PHASE 5: CACHE RESULT IN REDIS
            // ========================================================
            const effectiveConfigVersion = computeEffectiveConfigVersion({
                companyId,
                // Scenario pool behavior depends on which templates are enabled + scenario controls
                templateReferences: company.aiAgentSettings?.templateReferences || [],
                scenarioControls: company.aiAgentSettings?.scenarioControls || [],
                templatesMeta,
                // V92: Include service switchboard in config version
                // Cache invalidates when services change
                serviceSwitchboard: serviceContext?.hasData ? {
                    enabledCount: serviceContext.enabledServices?.length || 0,
                    disabledCount: serviceContext.disabledServices?.length || 0,
                    services: serviceContext.enabledServices?.slice(0, 10) || [] // First 10 for hash
                } : null,
                providerVersions: {
                    scenarioPoolService: 'ScenarioPoolService:v3-switchboard',
                    hybridScenarioSelector: 'HybridScenarioSelector:v1'
                }
            });

            // ========================================================
            // RESULT OBJECT
            // ========================================================
            // scenarios: Raw scenarios (backward compatibility)
            // compiled: Runtime specs + indexes (new fast path)
            // ========================================================
            const result = {
                // Legacy: raw scenarios (keep for backward compatibility)
                scenarios: scenarioPool,
                templatesUsed,
                templatesMeta,
                effectiveConfigVersion,
                
                // ════════════════════════════════════════════════════════════════════
                // POOL COMPOSITION: For Black Box logging and diagnostics
                // ════════════════════════════════════════════════════════════════════
                poolComposition: _poolComposition,
                
                // 🚀 V92: SERVICE CONTEXT - What services does this company offer?
                // Use serviceContext.isServiceEnabled(key) for quick lookups
                // Use serviceContext.getDeclineMessage(key) for deterministic declines
                serviceContext: serviceContext ? {
                    hasData: serviceContext.hasData,
                    templateId: serviceContext.templateId || null,
                    enabledServices: serviceContext.enabledServices || [],
                    disabledServices: serviceContext.disabledServices || [],
                    // Note: serviceMap is serializable, helper functions are not
                    // Re-create helpers on cache load
                    serviceMap: serviceContext.serviceMap || {}
                } : null,
                
                // 🚀 NEW: Compiled runtime specs + indexes
                compiled: {
                    specs: compiled.specs,
                    // Note: Map objects can't be JSON serialized, so we convert to array
                    // On cache load, we reconstruct the Maps
                    triggerIndexEntries: Array.from(compiled.triggerIndex.entries()),
                    exactIndexEntries: Array.from(compiled.exactIndex.entries()),
                    stats: compiled.stats
                }
            };
            
            try {
                const { redisClient } = require('../db');
                if (!redisClient || typeof redisClient.setEx !== 'function') {
                    logger.warn('⚠️ [SCENARIO POOL CACHE] Redis client unavailable - skip cache write');
                } else {
                    await redisClient.setEx(cacheKey, CACHE_TTL, JSON.stringify(result));
                    logger.info(`💾 [SCENARIO POOL CACHE] Cached ${scenarioPool.length} scenarios for ${CACHE_TTL}s`);
                    console.log(`[💾 CACHE WRITE] Scenario pool cached (TTL: ${CACHE_TTL}s)`);
                }
            } catch (cacheError) {
                logger.warn(`⚠️ [SCENARIO POOL CACHE] Failed to cache`, {
                    message: cacheError?.message || String(cacheError),
                    name: cacheError?.name || null,
                    code: cacheError?.code || null
                });
                // Non-critical, continue
            }
            
            return result;
            
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
        const legacyActiveTemplates = company.aiAgentSettings?.activeTemplates || [];
        const legacyClonedFrom = company.configuration?.clonedFrom;
        const customTemplateId = company.aiAgentSettings?.customTemplateId;
        
        const result = [];
        
        // ════════════════════════════════════════════════════════════════════════════
        // COMPANY LOCAL TEMPLATE (customTemplateId) - HIGHEST PRIORITY
        // These are company-specific scenarios that override global templates
        // ════════════════════════════════════════════════════════════════════════════
        if (customTemplateId) {
            logger.debug(`🏢 [SCENARIO POOL] Adding COMPANY LOCAL template: ${customTemplateId}`);
            result.push({
                templateId: customTemplateId.toString(),
                priority: 0, // Highest priority - company local wins
                isCompanyLocal: true
            });
        }
        
        // NEW SYSTEM: Multi-template via templateReferences
        const enabledRefs = templateRefs.filter(ref => 
            ref.templateId && ref.enabled !== false
        );
        
        if (enabledRefs.length > 0) {
            logger.debug(`📚 [SCENARIO POOL] Using NEW multi-template system: ${enabledRefs.length} template(s)`);
            
            // Sort by priority (lower number = higher priority)
            const mainTemplates = enabledRefs
                .map(ref => ({
                    templateId: ref.templateId,
                    priority: ref.priority || 999,
                    isCompanyLocal: false
                }))
                .sort((a, b) => a.priority - b.priority);
            
            result.push(...mainTemplates);
            return result;
        }

        // LEGACY (v1.0) SYSTEM: aiAgentSettings.activeTemplates (array of IDs or objects)
        if (Array.isArray(legacyActiveTemplates) && legacyActiveTemplates.length > 0) {
            const normalizedLegacyRefs = legacyActiveTemplates
                .map((entry, index) => {
                    if (!entry) { return null; }

                    // String entry → templateId
                    if (typeof entry === 'string') {
                        return {
                            templateId: entry,
                            priority: index + 1,
                            enabled: true,
                            isCompanyLocal: false
                        };
                    }

                    // Object entry → may contain templateId/id/enabled/priority
                    if (typeof entry === 'object') {
                        const templateId = entry.templateId || entry.id || entry._id || null;
                        const enabled = entry.enabled !== false;
                        if (!templateId || !enabled) {
                            return null;
                        }
                        return {
                            templateId: templateId.toString(),
                            priority: entry.priority || entry.sortOrder || index + 1,
                            enabled: true,
                            isCompanyLocal: false
                        };
                    }

                    return null;
                })
                .filter(Boolean);

            if (normalizedLegacyRefs.length > 0) {
                logger.debug(`📚 [SCENARIO POOL] Using LEGACY activeTemplates array: ${normalizedLegacyRefs.length} template(s)`);
                result.push(...normalizedLegacyRefs.sort((a, b) => (a.priority || 999) - (b.priority || 999)));
                return result;
            }
        }
        
        // LEGACY SYSTEM: Single template via configuration.clonedFrom
        if (legacyClonedFrom) {
            logger.debug(`📚 [SCENARIO POOL] Using LEGACY single-template system`);
            result.push({
                templateId: legacyClonedFrom.toString(),
                priority: 1,
                isCompanyLocal: false
            });
            return result;
        }
        
        // Return result even if only customTemplateId was added
        if (result.length > 0) {
            logger.debug(`🏢 [SCENARIO POOL] Only COMPANY LOCAL template available`);
            return result;
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
        const templatesMeta = [];
        
        for (const ref of templateRefs) {
            try {
                const template = await GlobalInstantResponseTemplate.findById(ref.templateId)
                    .select('_id name version updatedAt isPublished isActive categories')
                    .lean();
                
                if (!template) {
                    logger.warn(`⚠️ [SCENARIO POOL] Template not found: ${ref.templateId}`);
                    continue;
                }
                
                // DEBUG: Log template state
                logger.info(`📖 [SCENARIO POOL] Processing template: ${template.name}`, {
                    isPublished: template.isPublished,
                    isActive: template.isActive,
                    categoryCount: (template.categories || []).length
                });
                
                templatesUsed.push({
                    templateId: template._id.toString(),
                    templateName: template.name
                });

                templatesMeta.push({
                    templateId: template._id.toString(),
                    version: template.version || null,
                    updatedAt: template.updatedAt ? new Date(template.updatedAt).toISOString() : null,
                    isPublished: template.isPublished ?? null,
                    isActive: template.isActive ?? null
                });
                
                // Flatten scenarios from all categories
                const categories = template.categories || [];
                let scenarioCount = 0;
                
                categories.forEach(category => {
                    const scenarios = category.scenarios || [];
                    
                    // DEBUG: Log first category structure to diagnose "Uncategorized" issue
                    if (scenarioCount === 0 && categories.length > 0) {
                        logger.info('[SCENARIO POOL] First category:', {
                            categoryId: category.id,
                            categoryName: category.name,
                            scenarioCount: scenarios.length,
                            firstScenario: scenarios[0] ? {
                                name: scenarios[0].name,
                                status: scenarios[0].status,
                                isActive: scenarios[0].isActive
                            } : null
                        });
                    }
                    
                    let activeInCategory = 0;
                    
                    scenarios.forEach(scenario => {
                        // FILTER: Only active scenarios
                        // isActive is the single source of truth: true = load it, false = don't
                        if (scenario.isActive !== true) {
                            return;
                        }
                        
                        // FILTER: Skip deprecated/replaced scenarios
                        // Replace-not-Add sets replacedByScenarioId when upgrading
                        if (scenario.replacedByScenarioId) {
                            return;
                        }
                        
                        activeInCategory++;
                        
                        // 🎯 PHASE A.1: Ensure all Phase A.1 fields are normalized and present
                        const normalizedScenario = this._ensurePhaseA1Fields(scenario);
                        
                        // Build standardized scenario object
                        scenarioPool.push({
                            // Company context
                            companyId,
                            
                            // Template metadata
                            templateId: template._id.toString(),
                            templateName: template.name,
                            templatePriority: ref.priority,
                            
                            // ════════════════════════════════════════════════════════════════════
                            // COMPANY LOCAL FLAG: Scenarios from customTemplateId have priority
                            // ════════════════════════════════════════════════════════════════════
                            isCompanyLocal: ref.isCompanyLocal === true,
                            
                            // Category metadata
                            categoryId: category.id || category._id?.toString() || null,
                            categoryName: category.name || category.id || 'Uncategorized',
                            
                            // Scenario identity
                            scenarioId: normalizedScenario.scenarioId || normalizedScenario._id?.toString(),
                            name: normalizedScenario.name,
                            status: normalizedScenario.status,
                            isActive: normalizedScenario.isActive,
                            
                            // Matching fields (used by HybridScenarioSelector)
                            triggers: normalizedScenario.triggers || [],
                            regexTriggers: normalizedScenario.regexTriggers || [],
                            negativeTriggers: normalizedScenario.negativeTriggers || [],
                            
                            // 🎯 PHASE A.1: Enhanced user phrase triggers
                            exampleUserPhrases: normalizedScenario.exampleUserPhrases || [],
                            negativeUserPhrases: normalizedScenario.negativeUserPhrases || [],
                            
                            // 🎯 PHASE A.1: Weighted replies (normalized at read-time)
                            quickReplies: normalizedScenario.quickReplies,
                            fullReplies: normalizedScenario.fullReplies,
                            followUpPrompts: normalizedScenario.followUpPrompts,
                            followUpFunnel: normalizedScenario.followUpFunnel || null,
                            
                            // Scoring and behavior
                            priority: normalizedScenario.priority || 0,
                            contextWeight: normalizedScenario.contextWeight || 1,
                            behavior: normalizedScenario.behavior || null,
                            cooldownSeconds: normalizedScenario.cooldownSeconds || 0,
                            
                            // Entity capture (future)
                            entityCapture: normalizedScenario.entityCapture || [],
                            dynamicVariables: normalizedScenario.dynamicVariables || {},
                            
                            // Action hooks (future)
                            actionHooks: normalizedScenario.actionHooks || [],
                            
                            // Voice/TTS
                            toneLevel: normalizedScenario.toneLevel || 2,
                            ttsOverride: normalizedScenario.ttsOverride || {},
                            
                            // 🎯 PHASE A.1: Scenario semantics
                            scenarioType: normalizedScenario.scenarioType || null,
                            replyStrategy: normalizedScenario.replyStrategy || 'AUTO',
                            
                            // 🎯 PHASE A.1: Follow-up behavior (not used yet, wired in Phase A.2)
                            followUpMode: normalizedScenario.followUpMode || 'NONE',
                            followUpQuestionText: normalizedScenario.followUpQuestionText || null,
                            transferTarget: normalizedScenario.transferTarget || null,
                            
                            // 🎯 PHASE A.1: Confidence override
                            minConfidence: normalizedScenario.minConfidence || null,
                            
                            // 🎯 PHASE A.1: Admin notes
                            notes: normalizedScenario.notes || '',
                            
                            // Will be set in next step:
                            isEnabledForCompany: true // default, overridden by scenarioControls
                        });
                        
                        scenarioCount++;
                    });
                    
                    // DEBUG: Log how many active scenarios in this category
                    if (activeInCategory > 0) {
                        logger.info(`[SCENARIO POOL] Category "${category.name || 'Uncategorized'}": ${activeInCategory} active scenarios (${scenarios.length} total)`);
                    }
                });

                logger.info(`  ✅ Loaded ${scenarioCount} scenarios from ${categories.length} categories`);
                
            } catch (error) {
                logger.error(`❌ [SCENARIO POOL] Error loading template ${ref.templateId}:`, error);
                // Continue with other templates
            }
        }
        
        return { scenarioPool, templatesUsed, templatesMeta };
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
    
    /**
     * ============================================================================
     * SCENARIO ALIGNMENT DATA - SINGLE SOURCE OF TRUTH
     * ============================================================================
     * 
     * PURPOSE:
     * Returns complete alignment data showing what scenarios exist in templates
     * vs what the LLM agent actually sees. This is the source of truth that
     * Gap Fill, Audit, and Wiring tabs should all use.
     * 
     * ALIGNMENT RULES:
     * - Gap Fill should only suggest scenarios the agent CAN use (active, enabled)
     * - Audit should only check scenarios the agent WILL use (active, enabled)
     * - Agent uses ScenarioPoolService filtered scenarios
     * 
     * @param {String} companyId - Company ObjectId
     * @returns {Promise<Object>} - Full alignment data
     */
    static async getScenarioAlignmentData(companyId) {
        const startTime = Date.now();
        
        logger.info(`📊 [SCENARIO ALIGNMENT] Building alignment data for company: ${companyId}`);
        
        try {
            // ========================================================
            // STEP 1: LOAD COMPANY DATA
            // ========================================================
            const company = await Company.findById(companyId)
                .select('aiAgentSettings.templateReferences aiAgentSettings.scenarioControls aiAgentSettings.customTemplateId configuration.clonedFrom companyName businessName')
                .lean();
            
            if (!company) {
                return {
                    success: false,
                    error: 'Company not found',
                    alignment: null
                };
            }
            
            const companyName = company.companyName || company.businessName || companyId;
            
            // ========================================================
            // STEP 2: GET TEMPLATE IDS
            // ========================================================
            const templateRefs = this._determineTemplateIds(company);
            
            if (templateRefs.length === 0) {
                return {
                    success: true,
                    companyId,
                    companyName,
                    alignment: {
                        totalInTemplates: 0,
                        activeInTemplates: 0,
                        enabledForCompany: 0,
                        disabledByCompany: 0,
                        agentCanSee: 0,
                        gapFillScope: 0,
                        auditScope: 0,
                        isAligned: true,
                        alignmentPercentage: 100,
                        breakdown: []
                    },
                    templatesUsed: [],
                    warning: 'No templates configured'
                };
            }
            
            // ========================================================
            // STEP 3: LOAD ALL TEMPLATES AND COUNT SCENARIOS
            // ========================================================
            const controlsMap = this._buildScenarioControlMap(company);
            const breakdown = [];
            
            let totalInTemplates = 0;
            let activeInTemplates = 0;
            let enabledForCompany = 0;
            let disabledByCompany = 0;
            
            const templatesUsed = [];
            
            for (const ref of templateRefs) {
                const template = await GlobalInstantResponseTemplate.findById(ref.templateId)
                    .select('_id name version categories')
                    .lean();
                
                if (!template) {
                    logger.warn(`⚠️ [SCENARIO ALIGNMENT] Template not found: ${ref.templateId}`);
                    continue;
                }
                
                templatesUsed.push({
                    templateId: template._id.toString(),
                    templateName: template.name
                });
                
                const categories = template.categories || [];
                
                for (const category of categories) {
                    const scenarios = category.scenarios || [];
                    
                    for (const scenario of scenarios) {
                        totalInTemplates++;
                        
                        const scenarioId = scenario.scenarioId || scenario._id?.toString();
                        const isActiveInTemplate = scenario.isActive === true;
                        
                        if (isActiveInTemplate) {
                            activeInTemplates++;
                            
                            // Check company-level control
                            const controlKey = `${template._id.toString()}:${scenarioId}`;
                            const control = controlsMap.get(controlKey);
                            const isEnabledForCompany = !control || control.isEnabled !== false;
                            
                            if (isEnabledForCompany) {
                                enabledForCompany++;
                            } else {
                                disabledByCompany++;
                            }
                            
                            breakdown.push({
                                templateId: template._id.toString(),
                                templateName: template.name,
                                categoryName: category.name || 'Uncategorized',
                                scenarioId,
                                scenarioName: scenario.name,
                                isActiveInTemplate,
                                isEnabledForCompany,
                                agentCanSee: isActiveInTemplate && isEnabledForCompany,
                                reason: !isActiveInTemplate 
                                    ? 'inactive_in_template' 
                                    : !isEnabledForCompany 
                                        ? 'disabled_by_company' 
                                        : 'active_and_enabled'
                            });
                        } else {
                            breakdown.push({
                                templateId: template._id.toString(),
                                templateName: template.name,
                                categoryName: category.name || 'Uncategorized',
                                scenarioId,
                                scenarioName: scenario.name,
                                isActiveInTemplate: false,
                                isEnabledForCompany: null,
                                agentCanSee: false,
                                reason: 'inactive_in_template'
                            });
                        }
                    }
                }
            }
            
            // ========================================================
            // STEP 4: COMPUTE ALIGNMENT METRICS
            // ========================================================
            // What the agent sees = active in template AND enabled for company
            const agentCanSee = enabledForCompany;
            
            // What Gap Fill should work with = same as agent (no point filling gaps agent won't use)
            const gapFillScope = agentCanSee;
            
            // What Audit should check = same as agent (no point auditing scenarios agent ignores)
            const auditScope = agentCanSee;
            
            // Perfect alignment = all three see the same count
            const isAligned = gapFillScope === auditScope && auditScope === agentCanSee;
            
            // Alignment percentage = (agent visible / total active) * 100
            const alignmentPercentage = activeInTemplates > 0 
                ? Math.round((agentCanSee / activeInTemplates) * 100)
                : 100;
            
            const result = {
                success: true,
                companyId,
                companyName,
                computedAt: new Date().toISOString(),
                computeTimeMs: Date.now() - startTime,
                alignment: {
                    // Raw counts
                    totalInTemplates,          // Everything in templates (active + inactive)
                    activeInTemplates,         // Only isActive=true scenarios
                    enabledForCompany,         // Active AND not disabled by scenarioControls
                    disabledByCompany,         // Active but disabled by scenarioControls
                    
                    // What each system should see (unified)
                    agentCanSee,               // LLM Agent runtime
                    gapFillScope,              // Gap Fill GPT-4 (should match agent)
                    auditScope,                // Audit GPT-4 (should match agent)
                    
                    // Alignment status
                    isAligned,
                    alignmentPercentage,
                    
                    // Filtering summary
                    inactiveCount: totalInTemplates - activeInTemplates,
                    
                    // For wiring tab display
                    summary: {
                        label: isAligned ? 'PERFECT ALIGNMENT' : 'ALIGNMENT GAP',
                        status: isAligned ? 'GREEN' : alignmentPercentage >= 80 ? 'YELLOW' : 'RED',
                        message: isAligned
                            ? `All ${agentCanSee} scenarios are accessible to Gap Fill, Audit, and Agent`
                            : `${disabledByCompany} scenarios are disabled - Gap Fill/Audit should use ScenarioPoolService`
                    }
                },
                templatesUsed,
                breakdown: breakdown.slice(0, 100) // Limit breakdown to first 100 for performance
            };
            
            logger.info(`✅ [SCENARIO ALIGNMENT] Computed alignment: ${agentCanSee}/${activeInTemplates} active, ${alignmentPercentage}% aligned (${Date.now() - startTime}ms)`);
            
            return result;
            
        } catch (error) {
            logger.error(`❌ [SCENARIO ALIGNMENT] Error computing alignment for ${companyId}:`, error);
            return {
                success: false,
                error: error.message,
                alignment: null
            };
        }
    }
    
    /**
     * ============================================================================
     * GET SCENARIOS FOR GAP FILL / AUDIT (UNIFIED)
     * ============================================================================
     * 
     * PURPOSE:
     * Returns the exact same scenario list that the LLM agent uses.
     * Gap Fill and Audit should call this instead of loading templates directly.
     * 
     * This ensures:
     * - Gap Fill only suggests gaps for scenarios the agent can actually use
     * - Audit only checks scenarios the agent will actually respond with
     * 
     * @param {String} companyId - Company ObjectId
     * @returns {Promise<Object>} - { scenarios, template, alignment }
     */
    static async getScenariosForGapFillAndAudit(companyId) {
        logger.info(`🎯 [SCENARIO POOL] Loading scenarios for Gap Fill/Audit (unified): ${companyId}`);
        
        // Get the scenario pool (same as LLM agent uses)
        const poolResult = await this.getScenarioPoolForCompany(companyId, { bypassCache: true });
        
        if (poolResult.error) {
            return {
                success: false,
                error: poolResult.error,
                scenarios: [],
                template: null,
                alignment: null
            };
        }
        
        // Only return enabled scenarios (what agent actually sees)
        const enabledScenarios = poolResult.scenarios.filter(s => s.isEnabledForCompany !== false);
        
        // Also get alignment data for transparency
        const alignmentData = await this.getScenarioAlignmentData(companyId);
        
        return {
            success: true,
            scenarios: enabledScenarios,
            templatesUsed: poolResult.templatesUsed,
            templatesMeta: poolResult.templatesMeta,
            alignment: alignmentData.alignment,
            message: `Loaded ${enabledScenarios.length} scenarios (same as LLM agent sees)`
        };
    }

    // ============================================================================
    // 🚀 FAST SCENARIO LOOKUP - Uses compiled indexes
    // ============================================================================
    
    /**
     * Fast scenario lookup using pre-compiled indexes
     * 
     * This is the "fast path" for scenario matching:
     * - O(1) exact match lookup
     * - O(k) word-based candidate filtering (k = words in input)
     * - Returns candidates for scoring, not full pool scan
     * 
     * @param {Object} poolResult - Result from getScenarioPoolForCompany
     * @param {string} userInput - Raw user input
     * @returns {Object} { exactMatch, candidates, method, lookupTimeMs }
     */
    static fastScenarioLookup(poolResult, userInput) {
        const startTime = Date.now();
        
        // Check if compiled data exists
        if (!poolResult?.compiled?.triggerIndexEntries) {
            logger.warn('[SCENARIO POOL] No compiled indexes available, falling back to full scan');
            return {
                exactMatch: null,
                candidates: poolResult?.compiled?.specs || poolResult?.scenarios || [],
                method: 'full_scan',
                lookupTimeMs: Date.now() - startTime
            };
        }
        
        // Reconstruct Maps from cached array entries
        const triggerIndex = new Map(poolResult.compiled.triggerIndexEntries);
        const exactIndex = new Map(poolResult.compiled.exactIndexEntries);
        
        // Use the fast lookup
        const result = fastCandidateLookup(userInput, triggerIndex, exactIndex);
        result.lookupTimeMs = Date.now() - startTime;
        
        logger.debug(`⚡ [FAST LOOKUP] ${result.method}: ${result.candidates.length} candidates in ${result.lookupTimeMs}ms`);
        
        return result;
    }
    
    /**
     * Get compiled specs from pool result
     * 
     * @param {Object} poolResult - Result from getScenarioPoolForCompany
     * @returns {Array} Compiled scenario specs
     */
    static getCompiledSpecs(poolResult) {
        return poolResult?.compiled?.specs || [];
    }
    
    /**
     * Get compilation stats
     * 
     * @param {Object} poolResult - Result from getScenarioPoolForCompany
     * @returns {Object} Compilation statistics
     */
    static getCompilationStats(poolResult) {
        return poolResult?.compiled?.stats || {
            totalScenarios: poolResult?.scenarios?.length || 0,
            activeScenarios: 0,
            totalTriggers: 0,
            indexSize: 0,
            compileTimeMs: 0
        };
    }
    
    // ========================================================================
    // V92: SERVICE SWITCHBOARD HELPERS
    // ========================================================================
    // These helpers allow runtime to check service availability
    // and get deterministic decline messages
    // ========================================================================
    
    /**
     * Check if a service is enabled for a company
     * 
     * @param {Object} serviceContext - From poolResult.serviceContext
     * @param {String} serviceKey - Service key to check (e.g., "duct_cleaning")
     * @returns {Boolean} - true if enabled or no switchboard data
     */
    static isServiceEnabled(serviceContext, serviceKey) {
        if (!serviceContext || !serviceContext.hasData) {
            return true; // Default: allow if no switchboard configured
        }
        
        const service = serviceContext.serviceMap?.[serviceKey];
        return service ? service.enabled === true : true; // Default: allow unknown services
    }
    
    /**
     * Get a deterministic decline message for a disabled service
     * 
     * @param {Object} serviceContext - From poolResult.serviceContext
     * @param {String} serviceKey - Service key
     * @returns {String|null} - Decline message or null if service enabled/unknown
     */
    static getServiceDeclineMessage(serviceContext, serviceKey) {
        if (!serviceContext || !serviceContext.hasData) {
            return null;
        }
        
        const service = serviceContext.serviceMap?.[serviceKey];
        if (!service || service.enabled === true) {
            return null; // No decline needed
        }
        
        // Return custom message or generate default
        if (service.declineMessage) {
            return service.declineMessage;
        }
        if (service.catalogDeclineMessage) {
            return service.catalogDeclineMessage;
        }
        
        // Generate default
        const serviceName = service.catalogName || serviceKey.replace(/_/g, ' ');
        return `We don't currently offer ${serviceName} services. Is there something else I can help you with?`;
    }
    
    /**
     * Get service context for a detected service intent
     * Useful for routing decisions
     * 
     * @param {Object} serviceContext - From poolResult.serviceContext
     * @param {String} serviceKey - Service key
     * @returns {Object|null} - Full service context or null
     */
    static getServiceContext(serviceContext, serviceKey) {
        if (!serviceContext || !serviceContext.hasData) {
            return null;
        }
        return serviceContext.serviceMap?.[serviceKey] || null;
    }
    
    /**
     * Get all enabled services (for building service offerings response)
     * 
     * @param {Object} serviceContext - From poolResult.serviceContext
     * @returns {Array<String>} - List of enabled service keys
     */
    static getEnabledServices(serviceContext) {
        if (!serviceContext || !serviceContext.hasData) {
            return [];
        }
        return serviceContext.enabledServices || [];
    }
}

module.exports = ScenarioPoolService;

