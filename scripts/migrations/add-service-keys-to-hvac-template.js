/**
 * Migration: Add Service Toggle Configuration to HVAC Template Categories
 * 
 * This adds serviceKey, isToggleable, defaultEnabled, serviceIntent, and serviceDecline
 * to HVAC template categories so companies can toggle services on/off.
 * 
 * Usage: node scripts/migrations/add-service-keys-to-hvac-template.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');

// Service configuration for HVAC categories
// Maps category names to service toggle configuration
// Categories not listed here will not be toggleable (always on)
const SERVICE_CONFIG = {
    // ════════════════════════════════════════════════════════════════════════════════
    // CORE SERVICES - Toggleable, default ON (most HVAC companies offer these)
    // ════════════════════════════════════════════════════════════════════════════════
    
    // Cooling & AC - Core service, most offer it
    'Cooling & AC': {
        serviceKey: 'cooling',
        isToggleable: true,
        defaultEnabled: true,
        serviceIntent: {
            keywords: ['ac', 'air conditioning', 'cooling', 'air conditioner', 'central air', 'cold air', 'not cooling', 'ac repair', 'ac service'],
            phrases: ['fix my ac', 'ac not working', 'need cooling', 'air conditioner broken'],
            negative: [],
            minConfidence: 0.6
        },
        serviceDecline: {
            defaultMessage: "We don't currently service air conditioning systems, but we can help with heating needs. Would you like to schedule a heating service?",
            suggestAlternatives: true
        }
    },
    
    // Heating - Core service
    'Heating': {
        serviceKey: 'heating',
        isToggleable: true,
        defaultEnabled: true,
        serviceIntent: {
            keywords: ['heating', 'furnace', 'heater', 'heat pump', 'boiler', 'not heating', 'no heat', 'cold house', 'heating repair'],
            phrases: ['fix my heater', 'furnace not working', 'no heat in house', 'heating broken'],
            negative: [],
            minConfidence: 0.6
        },
        serviceDecline: {
            defaultMessage: "We don't currently service heating systems, but we can help with cooling needs. Would you like to schedule an AC service?",
            suggestAlternatives: true
        }
    },
    
    // Maintenance - Core service
    'Maintenance': {
        serviceKey: 'maintenance',
        isToggleable: true,
        defaultEnabled: true,
        serviceIntent: {
            keywords: ['maintenance', 'tune up', 'tune-up', 'service plan', 'preventive', 'annual service', 'checkup', 'inspection'],
            phrases: ['schedule maintenance', 'need tune up', 'annual checkup', 'service my unit'],
            negative: [],
            minConfidence: 0.6
        },
        serviceDecline: {
            defaultMessage: "We don't currently offer maintenance plans, but we can help with repairs when issues arise. Is there a specific problem I can help with?",
            suggestAlternatives: true
        }
    },
    
    // ════════════════════════════════════════════════════════════════════════════════
    // SPECIALTY SERVICES - Toggleable, default OFF (not all HVAC companies offer)
    // ════════════════════════════════════════════════════════════════════════════════
    
    // Duct Cleaning - Many HVAC companies don't offer this
    'Duct Cleaning': {
        serviceKey: 'duct_cleaning',
        isToggleable: true,
        defaultEnabled: false,
        serviceIntent: {
            keywords: ['duct cleaning', 'clean ducts', 'air duct', 'ductwork cleaning', 'vent cleaning', 'clean vents', 'dirty ducts', 'dusty vents'],
            phrases: ['do you clean ducts', 'need duct cleaning', 'clean my ducts', 'how much to clean ducts'],
            negative: ['duct tape'],
            minConfidence: 0.6
        },
        serviceDecline: {
            defaultMessage: "We don't offer duct cleaning services, but we can help with your heating and cooling needs. Would you like to schedule a service call?",
            suggestAlternatives: true
        }
    },
    
    // Dryer Vent Cleaning - Niche service
    'Dryer Vent': {
        serviceKey: 'dryer_vent_cleaning',
        isToggleable: true,
        defaultEnabled: false,
        serviceIntent: {
            keywords: ['dryer vent', 'dryer duct', 'dryer exhaust', 'lint buildup', 'dryer fire', 'dryer not drying', 'lint trap'],
            phrases: ['clean dryer vent', 'dryer vent cleaning', 'dryer takes forever'],
            negative: [],
            minConfidence: 0.6
        },
        serviceDecline: {
            defaultMessage: "We don't offer dryer vent cleaning, but we specialize in heating and cooling systems. Is there something else I can help with?",
            suggestAlternatives: true
        }
    },
    
    // Commercial HVAC - Not all companies serve commercial
    'Commercial': {
        serviceKey: 'commercial_hvac',
        isToggleable: true,
        defaultEnabled: false,
        serviceIntent: {
            keywords: ['commercial', 'business', 'office building', 'warehouse', 'retail', 'restaurant hvac', 'rooftop unit', 'rtu', 'commercial account'],
            phrases: ['commercial hvac', 'business needs', 'office air conditioning', 'need commercial service'],
            negative: [],
            minConfidence: 0.6
        },
        serviceDecline: {
            defaultMessage: "We specialize in residential HVAC services. For commercial work, we'd recommend contacting a commercial HVAC specialist. Is there anything residential we can help with?",
            suggestAlternatives: true
        }
    },
    
    // New Construction - Not all companies do new installs
    'New Construction': {
        serviceKey: 'new_construction',
        isToggleable: true,
        defaultEnabled: false,
        serviceIntent: {
            keywords: ['new construction', 'new build', 'building a house', 'new home', 'construction project', 'new install', 'brand new system'],
            phrases: ['need hvac for new house', 'building a new home', 'new construction quote', 'installing in new build'],
            negative: [],
            minConfidence: 0.6
        },
        serviceDecline: {
            defaultMessage: "We focus on service and replacement for existing systems. For new construction, we'd recommend a contractor who specializes in new installs. Can I help with anything else?",
            suggestAlternatives: true
        }
    },
    
    // Indoor Air Quality - Specialized service
    'Indoor Air Quality': {
        serviceKey: 'indoor_air_quality',
        isToggleable: true,
        defaultEnabled: false,
        serviceIntent: {
            keywords: ['air quality', 'air purifier', 'uv light', 'humidifier', 'dehumidifier', 'air filtration', 'hepa', 'allergens', 'air cleaner'],
            phrases: ['improve air quality', 'install air purifier', 'need humidifier', 'allergies from air'],
            negative: [],
            minConfidence: 0.6
        },
        serviceDecline: {
            defaultMessage: "We don't currently offer indoor air quality products, but we can help with your heating and cooling needs. Would you like to schedule a service?",
            suggestAlternatives: true
        }
    },
    
    // Mini-Split Systems - Specialized
    'Mini-Split': {
        serviceKey: 'mini_split',
        isToggleable: true,
        defaultEnabled: false,
        serviceIntent: {
            keywords: ['mini split', 'mini-split', 'ductless', 'ductless ac', 'wall unit', 'split system', 'mitsubishi', 'fujitsu'],
            phrases: ['install mini split', 'ductless system', 'need a wall unit', 'mini split repair'],
            negative: [],
            minConfidence: 0.6
        },
        serviceDecline: {
            defaultMessage: "We don't currently service mini-split or ductless systems. We specialize in central heating and cooling. Is there something else I can help with?",
            suggestAlternatives: true
        }
    },
    
    // ════════════════════════════════════════════════════════════════════════════════
    // ALWAYS-ON CATEGORIES (isToggleable: false)
    // These are universal - every HVAC company handles these
    // ════════════════════════════════════════════════════════════════════════════════
    'General': {
        serviceKey: null,
        isToggleable: false
    },
    'Emergency': {
        serviceKey: null,
        isToggleable: false
    },
    'Booking': {
        serviceKey: null,
        isToggleable: false
    },
    'Scheduling': {
        serviceKey: null,
        isToggleable: false
    },
    'Pricing': {
        serviceKey: null,
        isToggleable: false
    },
    'Hours': {
        serviceKey: null,
        isToggleable: false
    }
};

// Helper to find config by partial/fuzzy match
function findServiceConfig(categoryName) {
    // Exact match first
    if (SERVICE_CONFIG[categoryName]) {
        return SERVICE_CONFIG[categoryName];
    }
    
    // Partial match (category name contains key or vice versa)
    const lowerName = categoryName.toLowerCase();
    for (const [key, config] of Object.entries(SERVICE_CONFIG)) {
        const lowerKey = key.toLowerCase();
        if (lowerName.includes(lowerKey) || lowerKey.includes(lowerName)) {
            return config;
        }
    }
    
    // Keyword-based matching for common variations
    const keywordMap = {
        'cooling': ['ac', 'air conditioning', 'cooling', 'air conditioner'],
        'heating': ['heat', 'furnace', 'heating', 'boiler'],
        'maintenance': ['maintenance', 'tune', 'service plan', 'preventive'],
        'duct_cleaning': ['duct clean', 'air duct'],
        'dryer_vent_cleaning': ['dryer vent', 'dryer duct'],
        'commercial_hvac': ['commercial', 'business'],
        'new_construction': ['new construction', 'new build', 'new install'],
        'indoor_air_quality': ['air quality', 'purifier', 'humidifier'],
        'mini_split': ['mini split', 'mini-split', 'ductless']
    };
    
    for (const [serviceKey, keywords] of Object.entries(keywordMap)) {
        for (const keyword of keywords) {
            if (lowerName.includes(keyword)) {
                // Find config with this serviceKey
                for (const config of Object.values(SERVICE_CONFIG)) {
                    if (config.serviceKey === serviceKey) {
                        return config;
                    }
                }
            }
        }
    }
    
    return null;
}

async function migrate() {
    console.log('🔧 Starting HVAC Template Service Keys Migration\n');
    
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');
        
        // Find HVAC template(s)
        const templates = await GlobalInstantResponseTemplate.find({
            $or: [
                { templateType: { $regex: /hvac/i } },
                { name: { $regex: /hvac/i } }
            ]
        });
        
        if (templates.length === 0) {
            console.log('❌ No HVAC templates found');
            return { success: false, error: 'No HVAC templates found' };
        }
        
        console.log(`📋 Found ${templates.length} HVAC template(s)\n`);
        
        const results = [];
        
        for (const template of templates) {
            console.log(`\n📄 Processing: ${template.name} (${template._id})`);
            console.log(`   Categories: ${template.categories?.length || 0}`);
            
            let updated = 0;
            let skipped = 0;
            let alwaysOn = 0;
            const configuredCategories = [];
            
            for (const category of (template.categories || [])) {
                const config = findServiceConfig(category.name);
                
                if (config) {
                    if (config.isToggleable === false) {
                        // Explicitly mark as not toggleable
                        category.isToggleable = false;
                        category.serviceKey = null;
                        console.log(`   ⚪ ${category.name} → always on (not toggleable)`);
                        alwaysOn++;
                    } else {
                        // Apply service configuration
                        category.serviceKey = config.serviceKey;
                        category.isToggleable = config.isToggleable;
                        category.defaultEnabled = config.defaultEnabled;
                        category.serviceIntent = config.serviceIntent;
                        category.serviceDecline = config.serviceDecline;
                        
                        console.log(`   ✅ ${category.name} → ${config.serviceKey} (toggleable: ${config.isToggleable}, default: ${config.defaultEnabled ? 'ON' : 'OFF'})`);
                        configuredCategories.push({
                            name: category.name,
                            serviceKey: config.serviceKey,
                            defaultEnabled: config.defaultEnabled
                        });
                        updated++;
                    }
                } else {
                    // Unknown category - skip (leave as is)
                    console.log(`   ⏭️  ${category.name} → skipped (no config match)`);
                    skipped++;
                }
            }
            
            // Save template
            await template.save();
            
            console.log(`\n   📊 Summary: ${updated} toggleable, ${alwaysOn} always-on, ${skipped} skipped`);
            
            results.push({
                templateId: template._id,
                templateName: template.name,
                updated,
                alwaysOn,
                skipped,
                configuredCategories
            });
        }
        
        console.log('\n✅ Migration complete!');
        console.log('\n📝 Next steps:');
        console.log('   1. Refresh Scenario Gaps page');
        console.log('   2. Go to Company Local → Services Offered');
        console.log('   3. Toggle services on/off to test');
        console.log('   4. View Config to see the JSON configuration');
        
        return { success: true, results };
        
    } catch (error) {
        console.error('❌ Migration failed:', error);
        return { success: false, error: error.message };
    } finally {
        await mongoose.disconnect();
    }
}

// Run if called directly
if (require.main === module) {
    migrate().catch(console.error);
}

module.exports = { migrate, SERVICE_CONFIG, findServiceConfig };
