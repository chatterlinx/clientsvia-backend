/**
 * ============================================================================
 * SCENARIO BRAIN SNAPSHOT PROVIDER
 * ============================================================================
 * Provides: 3-Tier scenario engine state, templates, categories, overrides
 */

const Company = require('../../../models/v2Company');
const GlobalInstantResponseTemplate = require('../../../models/GlobalInstantResponseTemplate');
const CompanyScenarioOverride = require('../../../models/CompanyScenarioOverride');
const CompanyCategoryOverride = require('../../../models/CompanyCategoryOverride');
const CompanyResponseDefaults = require('../../../models/CompanyResponseDefaults');
const logger = require('../../../utils/logger');

module.exports.getSnapshot = async function(companyId) {
    const startTime = Date.now();
    
    try {
        // Load company
        const company = await Company.findById(companyId)
            .select('tradeKey industryType aiAgentSettings')
            .lean();
        
        if (!company) {
            return {
                provider: 'scenarioBrain',
                providerVersion: '1.0',
                schemaVersion: 'v1',
                enabled: false,
                health: 'RED',
                error: 'Company not found',
                data: null,
                generatedIn: Date.now() - startTime
            };
        }
        
        const tradeKey = company.tradeKey || company.industryType || 'universal';
        
        // Load active templates
        const activeTemplates = await GlobalInstantResponseTemplate.find({
            isActive: true,
            isPublished: true
        }).lean();
        
        // Load company overrides
        const [scenarioOverrides, categoryOverrides, companyDefaults] = await Promise.all([
            CompanyScenarioOverride.find({ companyId }).lean(),
            CompanyCategoryOverride.find({ companyId }).lean(),
            CompanyResponseDefaults.findOne({ companyId }).lean()
        ]);
        
        // Build override maps for quick lookup
        const scenarioOverrideMap = new Map();
        scenarioOverrides.forEach(o => scenarioOverrideMap.set(o.scenarioId, o));
        
        const categoryOverrideMap = new Map();
        categoryOverrides.forEach(o => categoryOverrideMap.set(o.categoryId, o));
        
        // Process templates and categories
        const templateSnapshots = [];
        let totalCategories = 0;
        let enabledCategories = 0;
        let disabledCategories = 0;
        let totalScenarios = 0;
        let enabledScenarios = 0;
        let disabledScenarios = 0;
        let disabledWithAlternate = 0;
        let disabledCategoriesNoDefault = 0;
        let disabledScenariosNoAlt = 0;
        
        for (const template of activeTemplates) {
            const categorySnapshots = [];
            
            for (const category of template.categories || []) {
                totalCategories++;
                
                const categoryOverride = categoryOverrideMap.get(category.id);
                const categoryEnabled = !categoryOverride || categoryOverride.enabled !== false;
                const categoryHasDefault = categoryOverride?.disabledDefaultReply?.fullReply || categoryOverride?.useCompanyDefault;
                
                if (categoryEnabled) {
                    enabledCategories++;
                } else {
                    disabledCategories++;
                    if (!categoryHasDefault) {
                        disabledCategoriesNoDefault++;
                    }
                }
                
                const scenarioSnapshots = [];
                
                for (const scenario of category.scenarios || []) {
                    if (!scenario.isActive || scenario.status !== 'live') continue;
                    
                    totalScenarios++;
                    
                    const scenarioOverride = scenarioOverrideMap.get(scenario.scenarioId);
                    const scenarioEnabled = !scenarioOverride || scenarioOverride.enabled !== false;
                    const hasAlternate = scenarioOverride?.disabledAlternateReply?.fullReply && 
                                        scenarioOverride?.fallbackPreference === 'SCENARIO';
                    
                    if (scenarioEnabled) {
                        enabledScenarios++;
                    } else {
                        disabledScenarios++;
                        if (hasAlternate) {
                            disabledWithAlternate++;
                        } else if (scenarioOverride?.fallbackPreference === 'SCENARIO' && !hasAlternate) {
                            disabledScenariosNoAlt++;
                        }
                    }
                    
                    scenarioSnapshots.push({
                        scenarioId: scenario.scenarioId,
                        name: scenario.name,
                        enabled: scenarioEnabled,
                        hasAlternateReply: hasAlternate,
                        fallbackPreference: scenarioOverride?.fallbackPreference || 'COMPANY',
                        triggerCount: (scenario.triggers || []).length,
                        priority: scenario.priority || 0
                    });
                }
                
                categorySnapshots.push({
                    categoryId: category.id,
                    name: category.name,
                    enabled: categoryEnabled,
                    disabledDefaultReplyConfigured: !!categoryHasDefault,
                    scenariosTotal: scenarioSnapshots.length,
                    scenariosEnabled: scenarioSnapshots.filter(s => s.enabled).length,
                    scenarios: scenarioSnapshots
                });
            }
            
            templateSnapshots.push({
                templateId: template._id.toString(),
                name: template.name,
                version: template.version,
                activeForCompany: true, // TODO: Check company template activation
                categoriesTotal: categorySnapshots.length,
                categories: categorySnapshots
            });
        }
        
        // Determine health
        let health = 'GREEN';
        const warnings = [];
        
        if (activeTemplates.length === 0) {
            warnings.push('No active templates');
            health = 'RED';
        }
        
        if (disabledCategoriesNoDefault > 0) {
            warnings.push(`${disabledCategoriesNoDefault} disabled categories without default reply`);
            health = 'YELLOW';
        }
        
        if (disabledScenariosNoAlt > 0) {
            warnings.push(`${disabledScenariosNoAlt} disabled scenarios (SCENARIO fallback) without alternate reply`);
            health = 'YELLOW';
        }
        
        if (!companyDefaults?.notOfferedReply?.fullReply) {
            warnings.push('Company "Not Offered" default reply not configured');
            if (disabledScenarios > 0) {
                health = 'YELLOW';
            }
        }
        
        return {
            provider: 'scenarioBrain',
            providerVersion: '1.0',
            schemaVersion: 'v1',
            enabled: true,
            health,
            warnings,
            data: {
                engine: {
                    type: '3-tier',
                    entryPoint: 'IntelligentRouter.route',
                    tier1: 'HybridScenarioSelector',
                    tier3: 'Tier3LLMFallback',
                    llmModel: 'gpt-4o-mini'
                },
                
                tradeKey,
                
                summary: {
                    templatesActive: templateSnapshots.length,
                    categoriesTotal: totalCategories,
                    categoriesEnabled: enabledCategories,
                    categoriesDisabled: disabledCategories,
                    scenariosTotal: totalScenarios,
                    scenariosEnabled: enabledScenarios,
                    scenariosDisabled: disabledScenarios,
                    disabledWithAlternate,
                    disabledCategoriesNoDefault,
                    disabledScenariosNoAlt
                },
                
                companyDefaults: {
                    notOfferedConfigured: !!companyDefaults?.notOfferedReply?.fullReply,
                    unknownIntentConfigured: !!companyDefaults?.unknownIntentReply?.fullReply,
                    afterHoursConfigured: !!companyDefaults?.afterHoursReply?.fullReply,
                    strictDisabledBehavior: companyDefaults?.strictDisabledBehavior ?? true
                },
                
                templates: templateSnapshots
            },
            generatedIn: Date.now() - startTime
        };
        
    } catch (error) {
        logger.error('[SNAPSHOT:scenarioBrain] Error:', error.message);
        return {
            provider: 'scenarioBrain',
            providerVersion: '1.0',
            schemaVersion: 'v1',
            enabled: false,
            health: 'RED',
            error: error.message,
            data: null,
            generatedIn: Date.now() - startTime
        };
    }
};

