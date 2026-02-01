/**
 * ============================================================================
 * HVAC DEFAULT SERVICE CATALOG - Jan 2026
 * ============================================================================
 * 
 * PURPOSE:
 * Pre-populated service catalog for HVAC templates.
 * ~24 services covering the full spectrum of HVAC business operations.
 * 
 * IMPORTANT - SWITCHBOARD BEHAVIOR:
 * - The Service Catalog is the GLOBAL menu of available services
 * - When a company binds to HVAC template, they get this menu
 * - BUT all services start as OFF in the company's Switchboard
 * - Company admin must EXPLICITLY enable each service they offer
 * - `defaultEnabled` here is for FUTURE use (UI hints) but does NOT
 *   affect initial toggle state - all toggles start OFF
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
    // COOLING SERVICES (WORK)
    // ============================================
    {
        serviceKey: 'ac_repair',
        displayName: 'AC Repair',
        description: 'Air conditioning repair and troubleshooting',
        category: 'Cooling',
        serviceType: 'work',
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
        serviceType: 'work',
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
        serviceType: 'work',
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
    // HEATING SERVICES (WORK)
    // ============================================
    {
        serviceKey: 'heating_repair',
        displayName: 'Heating / Furnace Repair',
        description: 'Furnace, heat pump, and heating system repair',
        category: 'Heating',
        serviceType: 'work',
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
        serviceType: 'work',
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
        serviceType: 'work',
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
    // EMERGENCY SERVICES (WORK)
    // ============================================
    {
        serviceKey: 'emergency_hvac',
        displayName: 'Emergency HVAC Service',
        description: '24/7 emergency heating and cooling service',
        category: 'Emergency',
        serviceType: 'work',
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
        serviceType: 'work',
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
    // THERMOSTAT SERVICES (WORK)
    // ============================================
    {
        serviceKey: 'thermostat_service',
        displayName: 'Thermostat Service',
        description: 'Thermostat repair, replacement, and smart thermostat installation',
        category: 'Controls',
        serviceType: 'work',
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
    // INDOOR AIR QUALITY (WORK)
    // ============================================
    {
        serviceKey: 'duct_cleaning',
        displayName: 'Duct Cleaning',
        description: 'Air duct cleaning and sanitization',
        category: 'Indoor Air Quality',
        serviceType: 'work',
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
        serviceType: 'work',
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
        serviceType: 'work',
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
        serviceType: 'work',
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
    // MAINTENANCE PLANS (WORK)
    // ============================================
    {
        serviceKey: 'maintenance_plan',
        displayName: 'Maintenance Plan / Membership',
        description: 'Service agreements, maintenance plans, and membership programs',
        category: 'Plans & Memberships',
        serviceType: 'work',
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
    // COMMERCIAL SERVICES (WORK)
    // ============================================
    {
        serviceKey: 'commercial_hvac',
        displayName: 'Commercial HVAC Service',
        description: 'Commercial and light commercial HVAC service',
        category: 'Commercial',
        serviceType: 'work',
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
    // QUOTES & ESTIMATES (WORK)
    // ============================================
    {
        serviceKey: 'new_system_quote',
        displayName: 'New System Quote / Estimate',
        description: 'Free estimates for new HVAC system installation',
        category: 'Sales',
        serviceType: 'work',
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
        serviceType: 'work',
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
    // WARRANTY & FOLLOW-UP (WORK)
    // ============================================
    {
        serviceKey: 'warranty_service',
        displayName: 'Warranty Service',
        description: 'Warranty claims and warranty-covered repairs',
        category: 'Support',
        serviceType: 'work',
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
        serviceType: 'work',
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
    // GENERAL INQUIRIES (WORK)
    // ============================================
    {
        serviceKey: 'general_inquiry',
        displayName: 'General Inquiry',
        description: 'General questions and information requests',
        category: 'General',
        serviceType: 'work',
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
        serviceType: 'work',
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
        serviceType: 'work',
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
    // SPECIALTY SERVICES (WORK - OPT-IN)
    // ============================================
    {
        serviceKey: 'dryer_vent_cleaning',
        displayName: 'Dryer Vent Cleaning',
        description: 'Dryer vent cleaning and lint removal',
        category: 'Specialty',
        serviceType: 'work',
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
        serviceType: 'work',
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
    },
    
    // ============================================================================
    // NEW WORK SERVICES (V1.2 - Consultant Patch)
    // ============================================================================
    
    {
        serviceKey: 'ac_drain_line',
        displayName: 'AC Drain Line Clog / Water Leak',
        description: 'AC drain line cleaning, clog removal, and water leak repair',
        category: 'Cooling',
        serviceType: 'work',
        defaultEnabled: true,
        defaultSource: 'global',
        intentKeywords: ['ac leaking', 'water from ac', 'drain line', 'clogged drain', 'overflow pan', 'wet ceiling', 'ac drip', 'condensate'],
        intentPhrases: ['water leaking from ac', 'ac is dripping water', 'water on floor from ac', 'drain line clogged'],
        negativeKeywords: ['refrigerant leak'],
        declineMessage: null,
        isCore: false,
        sortOrder: 4,
        scenarioHints: {
            typicalScenarioTypes: ['EMERGENCY', 'TROUBLESHOOT', 'BOOKING'],
            targetScenarioCount: 8,
            suggestedKeywords: ['drain', 'water', 'leak', 'clog', 'overflow']
        }
    },
    {
        serviceKey: 'refrigerant_leak_detection',
        displayName: 'Refrigerant Leak Detection',
        description: 'Detect and locate refrigerant leaks in AC systems',
        category: 'Cooling',
        serviceType: 'work',
        defaultEnabled: true,
        defaultSource: 'global',
        intentKeywords: ['refrigerant leak', 'freon leak', 'low refrigerant', 'hissing sound', 'ac not cold enough'],
        intentPhrases: ['think I have a freon leak', 'ac losing refrigerant', 'refrigerant leak detection'],
        negativeKeywords: [],
        declineMessage: null,
        isCore: false,
        sortOrder: 5,
        scenarioHints: {
            typicalScenarioTypes: ['TROUBLESHOOT', 'BOOKING'],
            targetScenarioCount: 6,
            suggestedKeywords: ['leak', 'refrigerant', 'freon', 'detection', 'charge']
        }
    },
    {
        serviceKey: 'refrigerant_recharge',
        displayName: 'Refrigerant Recharge',
        description: 'Add refrigerant to AC system',
        category: 'Cooling',
        serviceType: 'work',
        defaultEnabled: true,
        defaultSource: 'global',
        intentKeywords: ['add freon', 'recharge ac', 'top off refrigerant', 'refrigerant low', 'need freon'],
        intentPhrases: ['ac needs freon', 'recharge my ac', 'add refrigerant to ac'],
        negativeKeywords: [],
        declineMessage: null,
        isCore: false,
        sortOrder: 6,
        scenarioHints: {
            typicalScenarioTypes: ['BOOKING', 'FAQ'],
            targetScenarioCount: 6,
            suggestedKeywords: ['recharge', 'freon', 'refrigerant', 'R410A', 'R22']
        }
    },
    {
        serviceKey: 'air_handler_service',
        displayName: 'Air Handler Service',
        description: 'Air handler repair, maintenance, and replacement',
        category: 'Cooling',
        serviceType: 'work',
        defaultEnabled: true,
        defaultSource: 'global',
        intentKeywords: ['air handler', 'inside unit', 'blower unit', 'attic unit', 'indoor unit'],
        intentPhrases: ['air handler not working', 'problem with air handler', 'air handler repair'],
        negativeKeywords: [],
        declineMessage: null,
        isCore: false,
        sortOrder: 7,
        scenarioHints: {
            typicalScenarioTypes: ['TROUBLESHOOT', 'BOOKING'],
            targetScenarioCount: 6,
            suggestedKeywords: ['air handler', 'blower', 'indoor', 'attic']
        }
    },
    {
        serviceKey: 'evaporator_coil_service',
        displayName: 'Evaporator Coil Repair / Replacement',
        description: 'Evaporator coil repair, cleaning, and replacement',
        category: 'Cooling',
        serviceType: 'work',
        defaultEnabled: true,
        defaultSource: 'global',
        intentKeywords: ['evaporator coil', 'coil leak', 'coil replacement', 'indoor coil', 'a-coil'],
        intentPhrases: ['evaporator coil leaking', 'need coil replaced', 'coil is bad'],
        negativeKeywords: ['condenser coil'],
        declineMessage: null,
        isCore: false,
        sortOrder: 8,
        scenarioHints: {
            typicalScenarioTypes: ['TROUBLESHOOT', 'QUOTE', 'BOOKING'],
            targetScenarioCount: 6,
            suggestedKeywords: ['evaporator', 'coil', 'leak', 'replacement']
        }
    },
    {
        serviceKey: 'whole_home_dehumidification',
        displayName: 'Whole-Home Dehumidifier',
        description: 'Whole-home dehumidifier installation and service',
        category: 'Indoor Air Quality',
        serviceType: 'work',
        defaultEnabled: false, // Upsell service
        defaultSource: 'global',
        intentKeywords: ['dehumidifier', 'humidity problem', 'musty air', 'too humid', 'moisture in air', 'whole home dehumidifier'],
        intentPhrases: ['house is too humid', 'need a dehumidifier', 'humidity control'],
        negativeKeywords: ['portable dehumidifier'],
        declineMessage: null,
        isCore: false,
        sortOrder: 44,
        scenarioHints: {
            typicalScenarioTypes: ['FAQ', 'QUOTE', 'BOOKING'],
            targetScenarioCount: 6,
            suggestedKeywords: ['humidity', 'dehumidifier', 'moisture', 'Florida']
        }
    },
    {
        serviceKey: 'duct_repair_replace',
        displayName: 'Duct Repair / Replacement',
        description: 'Ductwork repair, replacement, and modification',
        category: 'Indoor Air Quality',
        serviceType: 'work',
        defaultEnabled: false,
        defaultSource: 'global',
        intentKeywords: ['duct repair', 'duct leaking', 'torn duct', 'bad ducts', 'ductwork repair', 'replace ducts'],
        intentPhrases: ['ducts are falling apart', 'need duct repair', 'ductwork needs replacing'],
        negativeKeywords: ['duct cleaning'],
        declineMessage: null,
        isCore: false,
        sortOrder: 45,
        scenarioHints: {
            typicalScenarioTypes: ['QUOTE', 'BOOKING'],
            targetScenarioCount: 6,
            suggestedKeywords: ['duct', 'repair', 'replace', 'flexible', 'rigid']
        }
    },
    {
        serviceKey: 'duct_sealing',
        displayName: 'Duct Sealing / Aeroseal',
        description: 'Duct sealing and Aeroseal services for energy efficiency',
        category: 'Indoor Air Quality',
        serviceType: 'work',
        defaultEnabled: false,
        defaultSource: 'global',
        intentKeywords: ['aeroseal', 'duct sealing', 'air leaks in ducts', 'seal ducts', 'duct leakage'],
        intentPhrases: ['seal my ducts', 'ducts leaking air', 'aeroseal service'],
        negativeKeywords: [],
        declineMessage: null,
        isCore: false,
        sortOrder: 46,
        scenarioHints: {
            typicalScenarioTypes: ['FAQ', 'QUOTE'],
            targetScenarioCount: 4,
            suggestedKeywords: ['seal', 'aeroseal', 'leakage', 'efficiency']
        }
    },
    {
        serviceKey: 'smart_thermostat_setup',
        displayName: 'Smart Thermostat Setup / WiFi',
        description: 'Smart thermostat installation, WiFi setup, and app configuration',
        category: 'Controls',
        serviceType: 'work',
        defaultEnabled: true,
        defaultSource: 'global',
        intentKeywords: ['nest setup', 'ecobee setup', 'thermostat wifi', 'app not connecting', 'smart thermostat install'],
        intentPhrases: ['set up my nest', 'thermostat wont connect to wifi', 'install smart thermostat'],
        negativeKeywords: [],
        declineMessage: null,
        isCore: false,
        sortOrder: 31,
        scenarioHints: {
            typicalScenarioTypes: ['TROUBLESHOOT', 'BOOKING', 'FAQ'],
            targetScenarioCount: 8,
            suggestedKeywords: ['smart', 'wifi', 'nest', 'ecobee', 'app']
        }
    },
    
    // ============================================================================
    // SYMPTOM SERVICES (V1.2 - Triage Entry Points)
    // These are NOT services you sell - they route to WORK services
    // ============================================================================
    
    {
        serviceKey: 'frozen_coil',
        displayName: 'Frozen Coil / Iced AC',
        description: 'Symptom: Ice forming on AC unit or refrigerant lines',
        category: 'Cooling',
        serviceType: 'symptom',
        defaultEnabled: true,
        defaultSource: 'global',
        intentKeywords: ['ac frozen', 'ice on unit', 'frozen coil', 'ice on pipes', 'iced up', 'ice on ac'],
        intentPhrases: ['my ac is frozen', 'ice forming on ac', 'coils are frozen'],
        negativeKeywords: [],
        routesTo: ['ac_repair', 'refrigerant_leak_detection', 'air_handler_service'],
        triageMode: 'light',
        triagePrompts: [{
            question: 'Is the unit still running or has it completely shut off?',
            answers: [
                { label: 'Still running', routeHint: 'refrigerant_leak_detection' },
                { label: 'Shut off completely', routeHint: 'ac_repair' }
            ]
        }],
        declineMessage: null,
        isCore: false,
        sortOrder: 150
    },
    {
        serviceKey: 'uneven_cooling',
        displayName: 'Uneven Cooling / Hot Rooms',
        description: 'Symptom: Some rooms hot while others are cold',
        category: 'Cooling',
        serviceType: 'symptom',
        defaultEnabled: true,
        defaultSource: 'global',
        intentKeywords: ['one room hot', 'uneven cooling', 'upstairs hot', 'downstairs cold', 'hot spots', 'room not cooling'],
        intentPhrases: ['one room is hot', 'upstairs wont cool', 'some rooms are hot'],
        negativeKeywords: [],
        routesTo: ['ac_repair', 'air_handler_service', 'duct_repair_replace'],
        triageMode: 'light',
        triagePrompts: [{
            question: 'Is this a new problem or has it always been this way?',
            answers: [
                { label: 'New problem', routeHint: 'ac_repair' },
                { label: 'Always been this way', routeHint: 'duct_repair_replace' }
            ]
        }],
        declineMessage: null,
        isCore: false,
        sortOrder: 151
    },
    {
        serviceKey: 'musty_smell',
        displayName: 'Musty Smell / Odor from Vents',
        description: 'Symptom: Musty, moldy, or bad smell from AC vents',
        category: 'Indoor Air Quality',
        serviceType: 'symptom',
        defaultEnabled: true,
        defaultSource: 'global',
        intentKeywords: ['musty smell', 'moldy smell', 'bad odor', 'smell from vents', 'stinky ac', 'mildew smell'],
        intentPhrases: ['ac smells musty', 'bad smell from vents', 'moldy smell when ac runs'],
        negativeKeywords: ['gas smell', 'burning smell'],
        routesTo: ['duct_cleaning', 'iaq_assessment', 'air_purifier'],
        triageMode: 'light',
        triagePrompts: [{
            question: 'Does the smell happen only when the AC first turns on, or all the time?',
            answers: [
                { label: 'Only at first', routeHint: 'duct_cleaning' },
                { label: 'All the time', routeHint: 'iaq_assessment' }
            ]
        }],
        declineMessage: null,
        isCore: false,
        sortOrder: 152
    },
    {
        serviceKey: 'thermostat_no_power',
        displayName: 'Thermostat Blank / No Power',
        description: 'Symptom: Thermostat screen is blank or not responding',
        category: 'Controls',
        serviceType: 'symptom',
        defaultEnabled: true,
        defaultSource: 'global',
        intentKeywords: ['thermostat blank', 'thermostat off', 'no power thermostat', 'screen black', 'thermostat dead'],
        intentPhrases: ['my thermostat is blank', 'thermostat has no power', 'screen wont turn on'],
        negativeKeywords: [],
        routesTo: ['thermostat_service', 'ac_repair'],
        triageMode: 'light',
        triagePrompts: [{
            question: 'Have you checked if the batteries need replacing, or is it a wired thermostat?',
            answers: [
                { label: 'Tried new batteries, still blank', routeHint: 'thermostat_service' },
                { label: 'It is wired (no batteries)', routeHint: 'ac_repair' }
            ]
        }],
        declineMessage: null,
        isCore: false,
        sortOrder: 153
    },
    {
        serviceKey: 'dusty_house',
        displayName: 'Dusty House / Allergies',
        description: 'Symptom: Excessive dust or allergy symptoms indoors',
        category: 'Indoor Air Quality',
        serviceType: 'symptom',
        defaultEnabled: true,
        defaultSource: 'global',
        intentKeywords: ['dusty house', 'too much dust', 'allergies', 'sneezing', 'dust everywhere', 'air quality bad'],
        intentPhrases: ['house is always dusty', 'allergies are bad inside', 'dust keeps coming back'],
        negativeKeywords: [],
        routesTo: ['air_filter_service', 'duct_cleaning', 'iaq_assessment'],
        triageMode: 'light',
        triagePrompts: [{
            question: 'When did you last change your air filter?',
            answers: [
                { label: 'Recently (within 30 days)', routeHint: 'duct_cleaning' },
                { label: 'Not sure / Over 30 days', routeHint: 'air_filter_service' }
            ]
        }],
        declineMessage: null,
        isCore: false,
        sortOrder: 154
    },
    {
        serviceKey: 'ac_not_cooling',
        displayName: 'AC Not Cooling',
        description: 'Symptom: Air conditioner running but not cooling the house',
        category: 'Cooling',
        serviceType: 'symptom',
        defaultEnabled: true,
        defaultSource: 'global',
        intentKeywords: ['ac not cooling', 'no cold air', 'ac running but not cold', 'warm air from vents', 'ac not working'],
        intentPhrases: ['my ac is not cooling', 'ac blowing warm air', 'house wont cool down'],
        negativeKeywords: ['ac not turning on'],
        routesTo: ['ac_repair', 'refrigerant_recharge', 'air_filter_service'],
        triageMode: 'light',
        triagePrompts: [{
            question: 'Is the air coming from the vents cool at all, or completely warm?',
            answers: [
                { label: 'Slightly cool but not cold enough', routeHint: 'refrigerant_recharge' },
                { label: 'Completely warm/room temperature', routeHint: 'ac_repair' }
            ]
        }],
        declineMessage: null,
        isCore: false,
        sortOrder: 155
    },
    {
        serviceKey: 'no_heat',
        displayName: 'No Heat / Heating Not Working',
        description: 'Symptom: Heater or furnace not producing heat',
        category: 'Heating',
        serviceType: 'symptom',
        defaultEnabled: true,
        defaultSource: 'global',
        intentKeywords: ['no heat', 'heater not working', 'furnace not heating', 'cold air from vents', 'heat not coming on'],
        intentPhrases: ['my heater is not working', 'no heat coming out', 'furnace wont heat'],
        negativeKeywords: ['ac', 'cooling'],
        routesTo: ['heating_repair', 'thermostat_service'],
        triageMode: 'light',
        triagePrompts: [{
            question: 'Is the fan blowing but the air is cold, or is nothing happening at all?',
            answers: [
                { label: 'Fan blows but air is cold', routeHint: 'heating_repair' },
                { label: 'Nothing happens when I turn it on', routeHint: 'thermostat_service' }
            ]
        }],
        declineMessage: null,
        isCore: false,
        sortOrder: 156
    },
    
    // ============================================================================
    // ADMIN SERVICES (V1.2 - Operational Requests)
    // These have NO scenarios - deterministic handlers only
    // ============================================================================
    
    {
        serviceKey: 'eta_dispatch',
        displayName: 'Technician ETA / Dispatch Status',
        description: 'Caller asking about technician arrival time or dispatch status',
        category: 'Support',
        serviceType: 'admin',
        defaultEnabled: true,
        defaultSource: 'global',
        intentKeywords: ['where is tech', 'eta', 'technician coming', 'running late', 'when will tech arrive', 'dispatch status'],
        intentPhrases: ['where is my technician', 'when will the tech arrive', 'is the technician on the way'],
        negativeKeywords: [],
        adminHandler: {
            type: 'transfer',
            transferTo: 'dispatch',
            message: "Let me connect you with our dispatch team to check on your technician's status and give you an accurate ETA."
        },
        declineMessage: null,
        isCore: false,
        sortOrder: 200
    },
    {
        serviceKey: 'reschedule_cancel',
        displayName: 'Reschedule / Cancel Appointment',
        description: 'Caller wants to reschedule or cancel an existing appointment',
        category: 'General',
        serviceType: 'admin',
        defaultEnabled: true,
        defaultSource: 'global',
        intentKeywords: ['reschedule', 'cancel appointment', 'change my time', 'move appointment', 'cancel service'],
        intentPhrases: ['I need to reschedule', 'can I cancel my appointment', 'change my appointment time'],
        negativeKeywords: ['schedule new', 'book new'],
        adminHandler: {
            type: 'transfer',
            transferTo: 'scheduling',
            message: "I can help you with that. Let me connect you with our scheduling team to make that change for you."
        },
        declineMessage: null,
        isCore: false,
        sortOrder: 201
    },
    {
        serviceKey: 'pay_bill',
        displayName: 'Pay Bill / Payment Link',
        description: 'Caller wants to pay their bill or get a payment link',
        category: 'Support',
        serviceType: 'admin',
        defaultEnabled: true,
        defaultSource: 'global',
        intentKeywords: ['pay bill', 'payment link', 'invoice payment', 'pay my balance', 'make a payment'],
        intentPhrases: ['I want to pay my bill', 'can you send me a payment link', 'how do I pay my invoice'],
        negativeKeywords: [],
        adminHandler: {
            type: 'link',
            message: "I can send you a payment link right now. Would you prefer it via text message or email?",
            linkUrl: '{company.paymentPortal}'
        },
        declineMessage: null,
        isCore: false,
        sortOrder: 202
    },
    {
        serviceKey: 'complaint_escalation',
        displayName: 'Complaint / Speak to Manager',
        description: 'Caller has a complaint or wants to speak with management',
        category: 'Support',
        serviceType: 'admin',
        defaultEnabled: true,
        defaultSource: 'global',
        intentKeywords: ['complaint', 'speak to manager', 'not happy', 'supervisor', 'escalate', 'dissatisfied'],
        intentPhrases: ['I want to speak to a manager', 'I have a complaint', 'I need to escalate this'],
        negativeKeywords: [],
        adminHandler: {
            type: 'transfer',
            transferTo: 'manager',
            message: "I understand you'd like to speak with a manager. Let me transfer you right away so we can address your concerns."
        },
        disabledBehavior: {
            action: 'transfer',
            message: "I apologize for any inconvenience. Let me connect you with our office so we can help resolve this.",
            transferTo: 'office'
        },
        declineMessage: null,
        isCore: true,
        sortOrder: 203
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
 * Get service count stats (V1.2 - includes service types)
 */
function getServiceStats() {
    const workServices = HVAC_DEFAULT_SERVICES.filter(s => s.serviceType === 'work' || !s.serviceType);
    const symptomServices = HVAC_DEFAULT_SERVICES.filter(s => s.serviceType === 'symptom');
    const adminServices = HVAC_DEFAULT_SERVICES.filter(s => s.serviceType === 'admin');
    
    return {
        total: HVAC_DEFAULT_SERVICES.length,
        // By service type (V1.2)
        workCount: workServices.length,
        symptomCount: symptomServices.length,
        adminCount: adminServices.length,
        // Legacy stats
        core: HVAC_DEFAULT_SERVICES.filter(s => s.isCore).length,
        defaultEnabled: HVAC_DEFAULT_SERVICES.filter(s => s.defaultEnabled).length,
        defaultDisabled: HVAC_DEFAULT_SERVICES.filter(s => !s.defaultEnabled).length,
        categories: getCategories().length,
        // Only WORK services have scenarios
        estimatedScenarios: workServices.reduce((sum, s) => sum + (s.scenarioHints?.targetScenarioCount || 8), 0)
    };
}

/**
 * Get services by type (V1.2)
 */
function getServicesByType(serviceType) {
    return HVAC_DEFAULT_SERVICES.filter(s => 
        (s.serviceType || 'work') === serviceType
    );
}

module.exports = {
    HVAC_DEFAULT_SERVICES,
    getHVACDefaultServices,
    getServicesByCategory,
    getServicesByType,
    getCoreServices,
    getDefaultEnabledServices,
    getCategories,
    getServiceStats
};
