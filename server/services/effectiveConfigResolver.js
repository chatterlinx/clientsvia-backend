/**
 * Effective Configuration Resolver - Phase 2
 * 
 * Resolves configuration with inheritance hierarchy:
 * Company Overrides → HVAC Starter Pack → Platform Defaults
 * 
 * Enterprise-grade with comprehensive error handling and validation
 * 
 * @author Chief Coding Engineer
 * @version 2.1
 */

const Company = require('../../models/Company');
const { ObjectId } = require('mongodb');

// Lazy load presets to avoid circular dependencies
let starterPack, platformDefaults;
function loadPresets() {
    if (!starterPack) {
        starterPack = require('../presets/starterPack.hvac_v1.json');
        platformDefaults = require('../presets/platformDefaults.json');
    }
}

/**
 * Deep merge objects with proper array handling
 */
function deepMerge(target, ...sources) {
    if (!sources.length) return target;
    const source = sources.shift();

    if (isObject(target) && isObject(source)) {
        for (const key in source) {
            if (isObject(source[key])) {
                if (!target[key]) Object.assign(target, { [key]: {} });
                deepMerge(target[key], source[key]);
            } else {
                Object.assign(target, { [key]: source[key] });
            }
        }
    }

    return deepMerge(target, ...sources);
}

function isObject(item) {
    return item && typeof item === 'object' && !Array.isArray(item);
}

/**
 * Get effective settings for a company
 * Merges: Company → HVAC Starter → Platform Defaults
 */
async function getEffectiveSettings(companyId) {
    try {
        // Input validation
        if (!companyId) {
            throw new Error('Company ID is required');
        }
        if (!ObjectId.isValid(companyId)) {
            throw new Error(`Invalid company ID format: ${companyId}`);
        }

        console.log(`[EffectiveResolver] Resolving full config for company: ${companyId}`);
        
        // Load presets
        loadPresets();
        
        // Load company data
        const company = await Company.findById(companyId).lean();
        if (!company) {
            throw new Error(`Company not found: ${companyId}`);
        }

        // Start with platform defaults (deep clone)
        let effectiveConfig = JSON.parse(JSON.stringify(platformDefaults));
        
        // Merge HVAC starter pack
        effectiveConfig = deepMerge(effectiveConfig, starterPack);
        
        // Apply company overrides
        const companyOverrides = extractCompanyOverrides(company);
        effectiveConfig = deepMerge(effectiveConfig, companyOverrides);
        
        // Add metadata
        effectiveConfig._metadata = {
            companyId,
            resolvedAt: new Date().toISOString(),
            layers: ['platformDefaults', 'hvacStarter', 'companyOverrides'],
            version: '2.1'
        };

        console.log(`[EffectiveResolver] ✅ Resolved full config for company ${companyId}`);
        return effectiveConfig;
        
    } catch (error) {
        console.error(`[EffectiveResolver] ❌ Failed to resolve config:`, error);
        throw error;
    }
}

/**
 * Get effective settings for a specific module
 */
async function getEffectiveModule(companyId, moduleKey) {
    try {
        // Input validation
        if (!companyId) {
            throw new Error('Company ID is required');
        }
        if (!moduleKey) {
            throw new Error('Module key is required');
        }
        if (!ObjectId.isValid(companyId)) {
            throw new Error(`Invalid company ID format: ${companyId}`);
        }

        console.log(`[EffectiveResolver] Resolving module '${moduleKey}' for company: ${companyId}`);
        
        const fullConfig = await getEffectiveSettings(companyId);
        const moduleConfig = extractModuleConfig(fullConfig, moduleKey);
        
        console.log(`[EffectiveResolver] ✅ Resolved module '${moduleKey}' for company ${companyId}`);
        return moduleConfig;
        
    } catch (error) {
        console.error(`[EffectiveResolver] ❌ Failed to resolve module '${moduleKey}':`, error);
        throw error;
    }
}

/**
 * Extract company-specific overrides from company document
 */
function extractCompanyOverrides(company) {
    return {
        knowledge: {
            companyKB: {
                threshold: company.agentSettings?.companyKBThreshold,
                entries: company.companyQnA || []
            },
            tradeCategories: company.tradeCategories || []
        },
        agentSettings: company.agentSettings || {},
        personality: {
            voiceTone: company.personalitySettings?.voiceTone,
            responseStyle: company.personalitySettings?.responseStyle,
            escalationBehavior: company.personalitySettings?.escalationBehavior
        },
        intelligence: {
            memoryMode: company.agentSettings?.memoryMode,
            confidenceScoring: company.agentSettings?.confidenceScoring,
            semanticSearchEnabled: company.agentSettings?.semanticSearchEnabled
        },
        voice: {
            provider: company.agentSettings?.ttsProvider,
            voiceId: company.elevenLabs?.voiceId || company.googleVoice,
            speed: company.ttsSpeed,
            pitch: company.ttsPitch
        },
        transfer: {
            transferEmail: company.transferEmail,
            transferPhone: company.transferPhone,
            escalationMode: company.agentSettings?.escalationMode
        },
        booking: {
            operatingHours: company.agentSetup?.operatingHours,
            timezone: company.agentSetup?.timezone,
            use247Routing: company.agentSetup?.use247Routing,
            afterHoursAction: company.agentSetup?.afterHoursAction
        },
        notifications: {
            emailNotifications: company.emailNotifications,
            smsNotifications: company.smsNotifications
        }
    };
}

/**
 * Extract specific module configuration
 */
function extractModuleConfig(fullConfig, moduleKey) {
    const moduleMap = {
        knowledge: () => ({
            companyKB: fullConfig.knowledge?.companyKB,
            tradeCategories: fullConfig.knowledge?.tradeCategories,
            thresholds: fullConfig.knowledge?.thresholds
        }),
        'agent-settings': () => fullConfig.agentSettings,
        intelligence: () => fullConfig.intelligence,
        personality: () => fullConfig.personality,
        voice: () => fullConfig.voice,
        transfer: () => fullConfig.transfer,
        booking: () => fullConfig.booking,
        notifications: () => fullConfig.notifications,
        priority: () => ({
            answerPriority: fullConfig.answerPriority,
            thresholds: fullConfig.knowledge?.thresholds
        }),
        'knowledge-sources': () => ({
            sources: fullConfig.knowledge,
            thresholds: fullConfig.knowledge?.thresholds
        })
    };

    const extractor = moduleMap[moduleKey];
    if (!extractor) {
        throw new Error(`Unknown module key: ${moduleKey}`);
    }

    return {
        module: moduleKey,
        config: extractor(),
        _metadata: {
            ...fullConfig._metadata,
            moduleKey,
            extractedAt: new Date().toISOString()
        }
    };
}

module.exports = {
    getEffectiveSettings,
    getEffectiveModule,
    deepMerge,
    extractCompanyOverrides,
    extractModuleConfig
};
