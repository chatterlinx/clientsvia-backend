/**
 * ============================================================================
 * HVAC DEFAULT SERVICE CATALOG - Jan 2026
 * ============================================================================
 * 
 * PURPOSE:
 * Pre-populated service catalog for HVAC templates.
 * ~24 services covering the full spectrum of HVAC business operations.
 * 
 * USAGE:
 * ServiceCatalog.seedHVACServices(templateId)
 * 
 * CATEGORIES:
 * - Cooling (AC repair, maintenance, installation)
 * - Heating (furnace, heat pump, boiler)
 * - Maintenance (tune-ups, preventive)
 * - IAQ (air quality, filters, ducts)
 * - Specialty (commercial, emergency)
 * - Sales & Quotes (estimates, replacements)
 * 
 * ============================================================================
 */

const HVAC_DEFAULT_SERVICES = [
    // ============================================
    // COOLING SERVICES
    // ============================================
    {
        serviceKey: 'ac_repair',
        displayName: 'AC Repair',
        description: 'Air conditioning repair and troubleshooting',
        category: 'Cooling',
        defaultEnabled: true,
        defaultSource: 'global',
        intentKeywords: ['ac repair', 'air conditioner repair', 'fix my ac', 'ac broken', 'ac not working', 'no cool', 'ac problem'],
        intentPhrases: ['my ac is not working', 'air conditioner broke', 'need ac repair', 'ac stopped cooling'],
        negativeKeywords: [],
        declineMessage: null,
        suggestAlternatives: true,
        alternativeServices: ['ac_maintenance', 'new_system_quote'],
        isCore: true,
        sortOrder: 1,
        scenarioHints: {
            typicalScenarioTypes: ['EMERGENCY', 'TROUBLESHOOT', 'BOOKING'],
            targetScenarioCount: 12,
            suggestedKeywords: ['cooling', 'ac', 'air conditioner', 'compressor', 'refrigerant']
        }
    },
    {
        serviceKey: 'ac_maintenance',
        displayName: 'AC Maintenance / Tune-Up',
        description: 'Preventive AC maintenance and seasonal tune-ups',
        category: 'Cooling',
        defaultEnabled: true,
        defaultSource: 'global',
        intentKeywords: ['ac maintenance', 'ac tune up', 'ac checkup', 'ac service', 'preventive maintenance'],
        intentPhrases: ['schedule ac tune up', 'need ac maintenance', 'annual ac service'],
        negativeKeywords: ['repair', 'broken'],
        declineMessage: null,
        isCore: true,
        sortOrder: 2,
        scenarioHints: {
            typicalScenarioTypes: ['BOOKING', 'FAQ'],
            targetScenarioCount: 8,
            suggestedKeywords: ['tune up', 'maintenance', 'checkup', 'seasonal']
        }
    },
    {
        serviceKey: 'ac_installation',
        displayName: 'AC Installation / Replacement',
        description: 'New air conditioning system installation',
        category: 'Cooling',
        defaultEnabled: true,
        defaultSource: 'global',
        intentKeywords: ['new ac', 'ac installation', 'replace ac', 'ac replacement', 'install ac'],
        intentPhrases: ['need new ac', 'replace my air conditioner', 'install new ac'],
        negativeKeywords: [],
        declineMessage: null,
        isCore: false,
        sortOrder: 3,
        scenarioHints: {
            typicalScenarioTypes: ['QUOTE', 'BOOKING', 'FAQ'],
            targetScenarioCount: 8,
            suggestedKeywords: ['new system', 'installation', 'replacement', 'upgrade']
        }
    },
    
    // ============================================
    // HEATING SERVICES
    // ============================================
    {
        serviceKey: 'heating_repair',
        displayName: 'Heating / Furnace Repair',
        description: 'Furnace, heat pump, and heating system repair',
        category: 'Heating',
        defaultEnabled: true,
        defaultSource: 'global',
        intentKeywords: ['heater repair', 'furnace repair', 'heating repair', 'no heat', 'heater broken', 'furnace not working'],
        intentPhrases: ['my heater is not working', 'furnace stopped working', 'no heat in house'],
        negativeKeywords: ['water heater'],
        declineMessage: null,
        isCore: true,
        sortOrder: 10,
        scenarioHints: {
            typicalScenarioTypes: ['EMERGENCY', 'TROUBLESHOOT', 'BOOKING'],
            targetScenarioCount: 12,
            suggestedKeywords: ['furnace', 'heat pump', 'heating', 'no heat', 'cold']
        }
    },
    {
        serviceKey: 'heating_maintenance',
        displayName: 'Heating Maintenance / Tune-Up',
        description: 'Preventive furnace and heating system maintenance',
        category: 'Heating',
        defaultEnabled: true,
        defaultSource: 'global',
        intentKeywords: ['furnace tune up', 'heater maintenance', 'heating checkup', 'furnace service'],
        intentPhrases: ['schedule furnace tune up', 'annual heating service'],
        negativeKeywords: [],
        declineMessage: null,
        isCore: true,
        sortOrder: 11,
        scenarioHints: {
            typicalScenarioTypes: ['BOOKING', 'FAQ'],
            targetScenarioCount: 8,
            suggestedKeywords: ['tune up', 'maintenance', 'winter prep']
        }
    },
    {
        serviceKey: 'heat_pump_service',
        displayName: 'Heat Pump Service',
        description: 'Heat pump repair, maintenance, and installation',
        category: 'Heating',
        defaultEnabled: true,
        defaultSource: 'global',
        intentKeywords: ['heat pump', 'mini split', 'ductless', 'heat pump repair', 'heat pump maintenance'],
        intentPhrases: ['heat pump not working', 'need heat pump service', 'mini split repair'],
        negativeKeywords: [],
        declineMessage: null,
        isCore: false,
        sortOrder: 12,
        scenarioHints: {
            typicalScenarioTypes: ['TROUBLESHOOT', 'BOOKING', 'FAQ'],
            targetScenarioCount: 8,
            suggestedKeywords: ['heat pump', 'mini split', 'ductless', 'defrost']
        }
    },
    
    // ============================================
    // EMERGENCY SERVICES
    // ============================================
    {
        serviceKey: 'emergency_hvac',
        displayName: 'Emergency HVAC Service',
        description: '24/7 emergency heating and cooling service',
        category: 'Emergency',
        defaultEnabled: true,
        defaultSource: 'global',
        intentKeywords: ['emergency', 'urgent', '24 hour', 'after hours', 'weekend service', 'same day'],
        intentPhrases: ['need emergency service', 'hvac emergency', 'urgent ac repair', 'need someone today'],
        negativeKeywords: [],
        declineMessage: null,
        isCore: true,
        sortOrder: 20,
        scenarioHints: {
            typicalScenarioTypes: ['EMERGENCY', 'BOOKING'],
            targetScenarioCount: 6,
            suggestedKeywords: ['emergency', 'urgent', 'now', 'today', '24/7']
        }
    },
    {
        serviceKey: 'gas_smell',
        displayName: 'Gas Smell / Gas Leak',
        description: 'Emergency response for gas smell or suspected gas leak',
        category: 'Emergency',
        defaultEnabled: true,
        defaultSource: 'global',
        intentKeywords: ['gas smell', 'gas leak', 'smells like gas', 'natural gas', 'gas odor'],
        intentPhrases: ['smell gas in my house', 'think I have a gas leak', 'my furnace smells like gas'],
        negativeKeywords: [],
        declineMessage: null,
        isCore: true,
        sortOrder: 21,
        scenarioHints: {
            typicalScenarioTypes: ['EMERGENCY'],
            targetScenarioCount: 4,
            suggestedKeywords: ['gas', 'leak', 'smell', 'evacuate', 'danger'],
            generationNotes: 'CRITICAL: Must advise evacuation and calling gas company/911'
        }
    },
    
    // ============================================
    // THERMOSTAT SERVICES
    // ============================================
    {
        serviceKey: 'thermostat_service',
        displayName: 'Thermostat Service',
        description: 'Thermostat repair, replacement, and smart thermostat installation',
        category: 'Controls',
        defaultEnabled: true,
        defaultSource: 'global',
        intentKeywords: ['thermostat', 'smart thermostat', 'nest', 'ecobee', 'thermostat not working', 'thermostat replacement'],
        intentPhrases: ['my thermostat is broken', 'need new thermostat', 'install smart thermostat'],
        negativeKeywords: [],
        declineMessage: null,
        isCore: false,
        sortOrder: 30,
        scenarioHints: {
            typicalScenarioTypes: ['TROUBLESHOOT', 'BOOKING', 'FAQ'],
            targetScenarioCount: 10,
            suggestedKeywords: ['thermostat', 'temperature', 'smart', 'wifi', 'programmable']
        }
    },
    
    // ============================================
    // INDOOR AIR QUALITY
    // ============================================
    {
        serviceKey: 'duct_cleaning',
        displayName: 'Duct Cleaning',
        description: 'Air duct cleaning and sanitization',
        category: 'Indoor Air Quality',
        defaultEnabled: false, // Niche service - opt-in
        defaultSource: 'companyLocal',
        intentKeywords: ['duct cleaning', 'clean ducts', 'air duct', 'ductwork cleaning', 'vent cleaning'],
        intentPhrases: ['want to clean my ducts', 'need duct cleaning', 'clean my air ducts'],
        negativeKeywords: ['duct tape'],
        declineMessage: "We don't offer duct cleaning, but we can help with air filter replacement, UV light installation, or air purifier systems. What would work best for you?",
        suggestAlternatives: true,
        alternativeServices: ['air_filter_service', 'air_purifier', 'iaq_assessment'],
        isCore: false,
        sortOrder: 40,
        scenarioHints: {
            typicalScenarioTypes: ['BOOKING', 'FAQ', 'QUOTE'],
            targetScenarioCount: 6,
            suggestedKeywords: ['duct', 'clean', 'air quality', 'dusty']
        }
    },
    {
        serviceKey: 'air_filter_service',
        displayName: 'Air Filter Service',
        description: 'Air filter replacement, filter delivery, and filter subscriptions',
        category: 'Indoor Air Quality',
        defaultEnabled: true,
        defaultSource: 'global',
        intentKeywords: ['air filter', 'filter replacement', 'change filter', 'filter delivery', 'filter subscription'],
        intentPhrases: ['need new filter', 'replace my air filter', 'filter delivery service'],
        negativeKeywords: [],
        declineMessage: null,
        isCore: false,
        sortOrder: 41,
        scenarioHints: {
            typicalScenarioTypes: ['FAQ', 'BOOKING'],
            targetScenarioCount: 6,
            suggestedKeywords: ['filter', 'MERV', 'HEPA', 'air quality']
        }
    },
    {
        serviceKey: 'air_purifier',
        displayName: 'Air Purifier / UV Light',
        description: 'Whole-home air purifiers, UV light systems, and air sanitization',
        category: 'Indoor Air Quality',
        defaultEnabled: true,
        defaultSource: 'global',
        intentKeywords: ['air purifier', 'uv light', 'air sanitizer', 'air cleaner', 'germicidal', 'ionizer'],
        intentPhrases: ['want air purifier', 'install uv light', 'whole home air cleaner'],
        negativeKeywords: [],
        declineMessage: null,
        isCore: false,
        sortOrder: 42,
        scenarioHints: {
            typicalScenarioTypes: ['FAQ', 'QUOTE', 'BOOKING'],
            targetScenarioCount: 6,
            suggestedKeywords: ['purifier', 'UV', 'clean air', 'allergies', 'germs']
        }
    },
    {
        serviceKey: 'iaq_assessment',
        displayName: 'Indoor Air Quality Assessment',
        description: 'Air quality testing and assessment',
        category: 'Indoor Air Quality',
        defaultEnabled: false, // Specialty service
        defaultSource: 'global',
        intentKeywords: ['air quality test', 'iaq', 'air quality assessment', 'air testing'],
        intentPhrases: ['test my air quality', 'air quality inspection'],
        negativeKeywords: [],
        declineMessage: null,
        isCore: false,
        sortOrder: 43,
        scenarioHints: {
            typicalScenarioTypes: ['FAQ', 'BOOKING'],
            targetScenarioCount: 4,
            suggestedKeywords: ['test', 'assessment', 'air quality', 'indoor']
        }
    },
    
    // ============================================
    // MAINTENANCE PLANS
    // ============================================
    {
        serviceKey: 'maintenance_plan',
        displayName: 'Maintenance Plan / Membership',
        description: 'Service agreements, maintenance plans, and membership programs',
        category: 'Plans & Memberships',
        defaultEnabled: true,
        defaultSource: 'global',
        intentKeywords: ['maintenance plan', 'membership', 'service agreement', 'annual plan', 'hvac plan'],
        intentPhrases: ['what maintenance plans do you offer', 'sign up for membership', 'cancel membership'],
        negativeKeywords: [],
        declineMessage: null,
        isCore: false,
        sortOrder: 50,
        scenarioHints: {
            typicalScenarioTypes: ['FAQ', 'BOOKING'],
            targetScenarioCount: 8,
            suggestedKeywords: ['plan', 'membership', 'discount', 'priority', 'agreement']
        }
    },
    
    // ============================================
    // COMMERCIAL SERVICES
    // ============================================
    {
        serviceKey: 'commercial_hvac',
        displayName: 'Commercial HVAC Service',
        description: 'Commercial and light commercial HVAC service',
        category: 'Commercial',
        defaultEnabled: false, // Not all companies do commercial
        defaultSource: 'companyLocal',
        intentKeywords: ['commercial', 'business', 'office', 'store', 'restaurant', 'rooftop unit', 'rtu'],
        intentPhrases: ['commercial hvac', 'business ac repair', 'office air conditioning'],
        negativeKeywords: ['residential', 'home'],
        declineMessage: "We focus on residential HVAC service. For commercial properties, I can recommend a commercial specialist. Is your call about a home system?",
        suggestAlternatives: true,
        alternativeServices: ['ac_repair', 'heating_repair'],
        isCore: false,
        sortOrder: 60,
        scenarioHints: {
            typicalScenarioTypes: ['TROUBLESHOOT', 'BOOKING', 'QUOTE'],
            targetScenarioCount: 8,
            suggestedKeywords: ['commercial', 'business', 'rooftop', 'RTU', 'VRF']
        }
    },
    
    // ============================================
    // QUOTES & ESTIMATES
    // ============================================
    {
        serviceKey: 'new_system_quote',
        displayName: 'New System Quote / Estimate',
        description: 'Free estimates for new HVAC system installation',
        category: 'Sales',
        defaultEnabled: true,
        defaultSource: 'global',
        intentKeywords: ['quote', 'estimate', 'price', 'cost', 'new system', 'replacement cost'],
        intentPhrases: ['how much for new ac', 'get a quote', 'free estimate', 'replacement cost'],
        negativeKeywords: [],
        declineMessage: null,
        isCore: true,
        sortOrder: 70,
        scenarioHints: {
            typicalScenarioTypes: ['QUOTE', 'BOOKING', 'FAQ'],
            targetScenarioCount: 8,
            suggestedKeywords: ['quote', 'estimate', 'price', 'cost', 'free']
        }
    },
    {
        serviceKey: 'financing',
        displayName: 'Financing Options',
        description: 'Financing and payment plans for HVAC equipment',
        category: 'Sales',
        defaultEnabled: true,
        defaultSource: 'global',
        intentKeywords: ['financing', 'payment plan', 'monthly payments', 'credit', 'loan'],
        intentPhrases: ['do you offer financing', 'payment options', 'can I make payments'],
        negativeKeywords: [],
        declineMessage: null,
        isCore: false,
        sortOrder: 71,
        scenarioHints: {
            typicalScenarioTypes: ['FAQ'],
            targetScenarioCount: 4,
            suggestedKeywords: ['financing', 'payment', 'monthly', 'credit', 'approval']
        }
    },
    
    // ============================================
    // WARRANTY & FOLLOW-UP
    // ============================================
    {
        serviceKey: 'warranty_service',
        displayName: 'Warranty Service',
        description: 'Warranty claims and warranty-covered repairs',
        category: 'Support',
        defaultEnabled: true,
        defaultSource: 'global',
        intentKeywords: ['warranty', 'covered', 'under warranty', 'warranty claim', 'manufacturer warranty'],
        intentPhrases: ['is this under warranty', 'warranty repair', 'file warranty claim'],
        negativeKeywords: [],
        declineMessage: null,
        isCore: false,
        sortOrder: 80,
        scenarioHints: {
            typicalScenarioTypes: ['FAQ', 'TROUBLESHOOT'],
            targetScenarioCount: 4,
            suggestedKeywords: ['warranty', 'covered', 'parts', 'labor', 'years']
        }
    },
    {
        serviceKey: 'follow_up_service',
        displayName: 'Follow-Up / Previous Service',
        description: 'Follow-up calls about previous service visits',
        category: 'Support',
        defaultEnabled: true,
        defaultSource: 'global',
        intentKeywords: ['follow up', 'previous visit', 'same problem', 'came back', 'still not working'],
        intentPhrases: ['calling back about', 'you were here yesterday', 'same issue as before'],
        negativeKeywords: [],
        declineMessage: null,
        isCore: true,
        sortOrder: 81,
        scenarioHints: {
            typicalScenarioTypes: ['TROUBLESHOOT', 'BOOKING'],
            targetScenarioCount: 6,
            suggestedKeywords: ['follow up', 'previous', 'return', 'still']
        }
    },
    
    // ============================================
    // GENERAL INQUIRIES
    // ============================================
    {
        serviceKey: 'general_inquiry',
        displayName: 'General Inquiry',
        description: 'General questions and information requests',
        category: 'General',
        defaultEnabled: true,
        defaultSource: 'global',
        intentKeywords: ['question', 'information', 'hours', 'location', 'address', 'phone'],
        intentPhrases: ['what are your hours', 'where are you located', 'general question'],
        negativeKeywords: [],
        declineMessage: null,
        isCore: true,
        sortOrder: 90,
        scenarioHints: {
            typicalScenarioTypes: ['FAQ'],
            targetScenarioCount: 10,
            suggestedKeywords: ['hours', 'location', 'service area', 'contact']
        }
    },
    {
        serviceKey: 'scheduling',
        displayName: 'Scheduling / Appointments',
        description: 'Booking, rescheduling, and canceling appointments',
        category: 'General',
        defaultEnabled: true,
        defaultSource: 'global',
        intentKeywords: ['schedule', 'appointment', 'book', 'reschedule', 'cancel', 'available'],
        intentPhrases: ['schedule an appointment', 'book a service call', 'need to reschedule', 'cancel my appointment'],
        negativeKeywords: [],
        declineMessage: null,
        isCore: true,
        sortOrder: 91,
        scenarioHints: {
            typicalScenarioTypes: ['BOOKING'],
            targetScenarioCount: 8,
            suggestedKeywords: ['schedule', 'appointment', 'time', 'available', 'book']
        }
    },
    {
        serviceKey: 'pricing_inquiry',
        displayName: 'Pricing Inquiry',
        description: 'Questions about service pricing and rates',
        category: 'General',
        defaultEnabled: true,
        defaultSource: 'global',
        intentKeywords: ['price', 'cost', 'how much', 'rate', 'fee', 'charge'],
        intentPhrases: ['how much do you charge', 'what is your rate', 'cost of service call'],
        negativeKeywords: [],
        declineMessage: null,
        isCore: true,
        sortOrder: 92,
        scenarioHints: {
            typicalScenarioTypes: ['FAQ'],
            targetScenarioCount: 6,
            suggestedKeywords: ['price', 'cost', 'rate', 'diagnostic', 'trip charge']
        }
    },
    
    // ============================================
    // SPECIALTY SERVICES (OPT-IN)
    // ============================================
    {
        serviceKey: 'dryer_vent_cleaning',
        displayName: 'Dryer Vent Cleaning',
        description: 'Dryer vent cleaning and lint removal',
        category: 'Specialty',
        defaultEnabled: false, // Niche service
        defaultSource: 'companyLocal',
        intentKeywords: ['dryer vent', 'dryer exhaust', 'dryer duct', 'lint', 'dryer cleaning'],
        intentPhrases: ['clean dryer vent', 'dryer vent cleaning', 'dryer taking long to dry'],
        negativeKeywords: ['repair dryer', 'fix dryer'],
        declineMessage: "We don't offer dryer vent cleaning, but we can help with your HVAC system. Is there an AC or heating issue I can help with?",
        suggestAlternatives: true,
        alternativeServices: ['duct_cleaning', 'ac_maintenance'],
        isCore: false,
        sortOrder: 100,
        scenarioHints: {
            typicalScenarioTypes: ['BOOKING', 'FAQ'],
            targetScenarioCount: 4,
            suggestedKeywords: ['dryer', 'vent', 'lint', 'exhaust']
        }
    },
    {
        serviceKey: 'insulation',
        displayName: 'Insulation Services',
        description: 'Attic and crawlspace insulation',
        category: 'Specialty',
        defaultEnabled: false,
        defaultSource: 'companyLocal',
        intentKeywords: ['insulation', 'attic insulation', 'crawlspace', 'blown insulation'],
        intentPhrases: ['add insulation', 'insulate my attic', 'need insulation'],
        negativeKeywords: [],
        declineMessage: "We don't install insulation, but we can recommend a specialist. Is there an HVAC service I can help with?",
        suggestAlternatives: true,
        alternativeServices: ['iaq_assessment', 'ac_maintenance'],
        isCore: false,
        sortOrder: 101,
        scenarioHints: {
            typicalScenarioTypes: ['FAQ', 'QUOTE'],
            targetScenarioCount: 4,
            suggestedKeywords: ['insulation', 'attic', 'energy', 'efficiency']
        }
    }
];

/**
 * Get all HVAC default services
 */
function getHVACDefaultServices() {
    return HVAC_DEFAULT_SERVICES;
}

/**
 * Get services by category
 */
function getServicesByCategory(category) {
    return HVAC_DEFAULT_SERVICES.filter(s => s.category === category);
}

/**
 * Get core services only
 */
function getCoreServices() {
    return HVAC_DEFAULT_SERVICES.filter(s => s.isCore);
}

/**
 * Get default-enabled services
 */
function getDefaultEnabledServices() {
    return HVAC_DEFAULT_SERVICES.filter(s => s.defaultEnabled);
}

/**
 * Get categories list
 */
function getCategories() {
    const categories = [...new Set(HVAC_DEFAULT_SERVICES.map(s => s.category))];
    return categories.sort();
}

/**
 * Get service count stats
 */
function getServiceStats() {
    return {
        total: HVAC_DEFAULT_SERVICES.length,
        core: HVAC_DEFAULT_SERVICES.filter(s => s.isCore).length,
        defaultEnabled: HVAC_DEFAULT_SERVICES.filter(s => s.defaultEnabled).length,
        defaultDisabled: HVAC_DEFAULT_SERVICES.filter(s => !s.defaultEnabled).length,
        categories: getCategories().length,
        estimatedScenarios: HVAC_DEFAULT_SERVICES.reduce((sum, s) => sum + (s.scenarioHints?.targetScenarioCount || 8), 0)
    };
}

module.exports = {
    HVAC_DEFAULT_SERVICES,
    getHVACDefaultServices,
    getServicesByCategory,
    getCoreServices,
    getDefaultEnabledServices,
    getCategories,
    getServiceStats
};
