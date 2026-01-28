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

// Service configuration for common HVAC categories
// Categories not listed here will not be toggleable (always on)
const SERVICE_CONFIG = {
    // ════════════════════════════════════════════════════════════════════════════════
    // TOGGLEABLE SERVICES - Companies can turn these on/off
    // ════════════════════════════════════════════════════════════════════════════════
    
    // Duct Cleaning - Many HVAC companies don't offer this
    'Duct Cleaning': {
        serviceKey: 'duct_cleaning',
        isToggleable: true,
        defaultEnabled: false, // Opt-in - not all HVAC companies do this
        serviceIntent: {
            keywords: ['duct cleaning', 'clean ducts', 'air duct', 'ductwork cleaning', 'vent cleaning', 'clean vents', 'dirty ducts'],
            phrases: ['do you clean ducts', 'need duct cleaning', 'clean my ducts', 'how much to clean ducts'],
            negative: ['duct tape'], // Not about duct cleaning
            minConfidence: 0.6
        },
        serviceDecline: {
            defaultMessage: "We don't currently offer duct cleaning services, but we can help with your heating, cooling, and ventilation needs. Would you like to schedule a service call?",
            suggestAlternatives: true
        }
    },
    
    // Dryer Vent Cleaning - Niche service
    'Dryer Vent': {
        serviceKey: 'dryer_vent',
        isToggleable: true,
        defaultEnabled: false, // Opt-in
        serviceIntent: {
            keywords: ['dryer vent', 'dryer duct', 'dryer exhaust', 'lint buildup', 'dryer fire'],
            phrases: ['clean dryer vent', 'dryer vent cleaning', 'dryer not drying'],
            negative: [],
            minConfidence: 0.6
        },
        serviceDecline: {
            defaultMessage: "We don't offer dryer vent cleaning services, but we specialize in heating and cooling. Is there something else we can help with?",
            suggestAlternatives: true
        }
    },
    
    // Commercial HVAC - Not all companies serve commercial
    'Commercial': {
        serviceKey: 'commercial_hvac',
        isToggleable: true,
        defaultEnabled: true, // Most do, but some are residential only
        serviceIntent: {
            keywords: ['commercial', 'business', 'office building', 'warehouse', 'retail', 'restaurant hvac', 'rooftop unit', 'rtu'],
            phrases: ['commercial hvac', 'business needs', 'office air conditioning', 'commercial account'],
            negative: [],
            minConfidence: 0.6
        },
        serviceDecline: {
            defaultMessage: "We specialize in residential HVAC services. For commercial work, we'd recommend contacting a commercial HVAC specialist in your area. Is there anything residential we can help with?",
            suggestAlternatives: true
        }
    },
    
    // New Construction - Not all companies do new installs
    'New Construction': {
        serviceKey: 'new_construction',
        isToggleable: true,
        defaultEnabled: true,
        serviceIntent: {
            keywords: ['new construction', 'new build', 'building a house', 'new home hvac', 'construction project'],
            phrases: ['need hvac for new house', 'building a new home', 'new construction quote'],
            negative: [],
            minConfidence: 0.6
        },
        serviceDecline: {
            defaultMessage: "We focus on service and replacement for existing systems, but we don't handle new construction projects. Would you like help with any existing HVAC needs?",
            suggestAlternatives: true
        }
    },
    
    // Indoor Air Quality - Specialized service
    'Indoor Air Quality': {
        serviceKey: 'indoor_air_quality',
        isToggleable: true,
        defaultEnabled: true,
        serviceIntent: {
            keywords: ['air quality', 'air purifier', 'uv light', 'humidifier', 'dehumidifier', 'air filtration', 'hepa', 'allergens'],
            phrases: ['improve air quality', 'install air purifier', 'need humidifier'],
            negative: [],
            minConfidence: 0.6
        },
        serviceDecline: {
            defaultMessage: "We don't currently offer specialized indoor air quality products, but we can help with your heating and cooling needs. Would you like to schedule a service?",
            suggestAlternatives: true
        }
    },
    
    // ════════════════════════════════════════════════════════════════════════════════
    // ALWAYS-ON CATEGORIES (not toggleable) - These are core HVAC services
    // ════════════════════════════════════════════════════════════════════════════════
    // - AC Repair
    // - Heating Repair
    // - AC Maintenance
    // - Heating Maintenance
    // - Emergency Service
    // - General Questions
    // - Booking/Scheduling
    // etc.
};

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
            return;
        }
        
        console.log(`📋 Found ${templates.length} HVAC template(s)\n`);
        
        for (const template of templates) {
            console.log(`\n📄 Processing: ${template.name} (${template._id})`);
            console.log(`   Categories: ${template.categories?.length || 0}`);
            
            let updated = 0;
            let skipped = 0;
            
            for (const category of (template.categories || [])) {
                const config = SERVICE_CONFIG[category.name];
                
                if (config) {
                    // Apply service configuration
                    category.serviceKey = config.serviceKey;
                    category.isToggleable = config.isToggleable;
                    category.defaultEnabled = config.defaultEnabled;
                    category.serviceIntent = config.serviceIntent;
                    category.serviceDecline = config.serviceDecline;
                    
                    console.log(`   ✅ ${category.name} → ${config.serviceKey} (toggleable: ${config.isToggleable}, default: ${config.defaultEnabled})`);
                    updated++;
                } else {
                    // Not a toggleable service - leave as is (always on)
                    skipped++;
                }
            }
            
            // Save template
            await template.save();
            
            console.log(`\n   📊 Summary: ${updated} categories configured, ${skipped} always-on`);
        }
        
        console.log('\n✅ Migration complete!');
        console.log('\n📝 Next steps:');
        console.log('   1. Refresh Scenario Gaps page');
        console.log('   2. Go to Company Local → Services Offered');
        console.log('   3. Toggle services on/off to test');
        console.log('   4. View Config to see the JSON configuration');
        
    } catch (error) {
        console.error('❌ Migration failed:', error);
    } finally {
        await mongoose.disconnect();
    }
}

// Run if called directly
if (require.main === module) {
    migrate().catch(console.error);
}

module.exports = { migrate, SERVICE_CONFIG };
