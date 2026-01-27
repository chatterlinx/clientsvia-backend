/**
 * ════════════════════════════════════════════════════════════════════════════════
 * GLOBAL PLACEHOLDER CATALOG
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * This is the MASTER REGISTRY of all allowed placeholder keys.
 * - GPT must only generate placeholders from this catalog
 * - Template scanner validates against this
 * - Runtime resolver uses fallbacks from here
 * 
 * Format: {companyName} (camelCase, single braces)
 * ════════════════════════════════════════════════════════════════════════════════
 */

// ════════════════════════════════════════════════════════════════════════════════
// UNIVERSAL PLACEHOLDERS (all trades)
// ════════════════════════════════════════════════════════════════════════════════
const PRICING_POLICY_SCRIPTS = {
    transferOffer:
        'Pricing can vary based on the system and what we find. Would you like me to connect you with a service advisor to go over pricing?',
    transferConfirm: 'Perfect, transferring you now.',
    transferDecline:
        'No problem. I can have a service advisor call you back with pricing, or I can help you schedule service. What would you prefer?',
    callbackOffer:
        'Pricing can vary depending on the system. I can have a service advisor call you back with accurate pricing. What\'s the best number to reach you?'
};

const UNIVERSAL_PLACEHOLDERS = [
    // Company Identity
    { 
        key: 'companyName', 
        label: 'Company Name', 
        type: 'text', 
        category: 'identity',
        scope: 'company',
        required: true, 
        fallback: 'our company',
        description: 'The company name as it should appear in responses',
        example: 'Penguin Air'
    },
    { 
        key: 'companyPhone', 
        label: 'Main Phone', 
        type: 'phone', 
        category: 'contact',
        scope: 'company',
        required: true, 
        fallback: 'our main number',
        description: 'Primary business phone number',
        example: '(555) 123-4567'
    },
    { 
        key: 'dispatchPhone', 
        label: 'Dispatch Phone', 
        type: 'phone', 
        category: 'contact',
        scope: 'company',
        required: false, 
        fallback: '',
        description: 'Direct dispatch line (if different from main)',
        example: '(555) 123-4568'
    },
    { 
        key: 'emergencyPhone', 
        label: 'Emergency Phone', 
        type: 'phone', 
        category: 'contact',
        scope: 'company',
        required: false, 
        fallback: 'our emergency line',
        description: '24/7 emergency contact number',
        example: '(555) 123-4569'
    },
    {
        key: 'companyEmail',
        label: 'Company Email',
        type: 'email',
        category: 'contact',
        scope: 'company',
        required: false,
        fallback: '',
        description: 'Primary company email address',
        example: 'info@penguinair.com'
    },
    
    // Location & Service
    { 
        key: 'companyAddress', 
        label: 'Company Address', 
        type: 'address', 
        category: 'location',
        scope: 'company',
        required: false, 
        fallback: '',
        description: 'Physical business address',
        example: '123 Cool Breeze Lane, Phoenix, AZ 85001'
    },
    { 
        key: 'serviceAreas', 
        label: 'Service Areas', 
        type: 'text', 
        category: 'location',
        scope: 'company',
        required: false, 
        fallback: 'your area',
        description: 'Cities/regions served',
        example: 'Phoenix, Scottsdale, Tempe, and surrounding areas'
    },
    { 
        key: 'businessHours', 
        label: 'Business Hours', 
        type: 'text', 
        category: 'hours',
        scope: 'company',
        required: false, 
        fallback: 'normal business hours',
        description: 'Standard operating hours',
        example: 'Monday-Friday 8am-5pm, Saturday 9am-2pm'
    },
    { 
        key: 'afterHoursPolicy', 
        label: 'After Hours Policy', 
        type: 'text', 
        category: 'hours',
        scope: 'company',
        required: false, 
        fallback: 'We have 24/7 emergency service available',
        description: 'What happens after hours',
        example: 'For emergencies, call our 24/7 line. Non-urgent requests will be returned next business day.'
    },
    
    // Pricing
    { 
        key: 'serviceCallFee', 
        label: 'Service Call Fee', 
        type: 'money', 
        category: 'pricing',
        scope: 'company',
        required: true, 
        fallback: '',
        supportsModes: ['LITERAL', 'OFFER_TRANSFER', 'OFFER_CALLBACK'],
        policyScripts: PRICING_POLICY_SCRIPTS,
        defaultMode: 'LITERAL',
        description: 'Dispatch/diagnostic fee',
        example: '$89'
    },
    { 
        key: 'estimateFee', 
        label: 'Estimate Fee', 
        type: 'text', 
        category: 'pricing',
        scope: 'company',
        required: false, 
        fallback: 'free estimate',
        supportsModes: ['LITERAL', 'OFFER_TRANSFER', 'OFFER_CALLBACK'],
        policyScripts: PRICING_POLICY_SCRIPTS,
        defaultMode: 'LITERAL',
        description: 'Cost for estimates',
        example: 'Free for new system quotes'
    },
    
    // Online
    { 
        key: 'websiteUrl', 
        label: 'Website URL', 
        type: 'url', 
        category: 'online',
        scope: 'company',
        required: false, 
        fallback: 'our website',
        description: 'Company website',
        example: 'www.penguinair.com'
    },
    { 
        key: 'bookingUrl', 
        label: 'Online Booking URL', 
        type: 'url', 
        category: 'online',
        scope: 'company',
        required: false, 
        fallback: '',
        description: 'Direct booking link',
        example: 'www.penguinair.com/book'
    },
    
    // Credentials
    { 
        key: 'licenseNumber', 
        label: 'License Number', 
        type: 'text', 
        category: 'credentials',
        scope: 'company',
        required: false, 
        fallback: '',
        description: 'State/local license',
        example: 'AZ ROC #123456'
    }
];

// ════════════════════════════════════════════════════════════════════════════════
// RUNTIME PLACEHOLDERS (system-filled, NOT editable)
// ════════════════════════════════════════════════════════════════════════════════
const RUNTIME_PLACEHOLDERS = [
    {
        key: 'callerName',
        label: 'Caller Name',
        type: 'text',
        category: 'runtime',
        scope: 'runtime',
        required: false,
        fallback: '',
        description: 'Full caller name captured during the session',
        example: 'John Smith'
    },
    {
        key: 'callerFirstName',
        label: 'Caller First Name',
        type: 'text',
        category: 'runtime',
        scope: 'runtime',
        required: false,
        fallback: '',
        description: 'Caller first name',
        example: 'John'
    },
    {
        key: 'callerLastName',
        label: 'Caller Last Name',
        type: 'text',
        category: 'runtime',
        scope: 'runtime',
        required: false,
        fallback: '',
        description: 'Caller last name',
        example: 'Smith'
    },
    {
        key: 'callerPhone',
        label: 'Caller Phone',
        type: 'phone',
        category: 'runtime',
        scope: 'runtime',
        required: false,
        fallback: '',
        description: 'Phone number of the caller',
        example: '(555) 555-1212'
    },
    {
        key: 'callerEmail',
        label: 'Caller Email',
        type: 'text',
        category: 'runtime',
        scope: 'runtime',
        required: false,
        fallback: '',
        description: 'Email captured from caller',
        example: 'john@example.com'
    },
    {
        key: 'serviceAddress',
        label: 'Service Address',
        type: 'address',
        category: 'runtime',
        scope: 'runtime',
        required: false,
        fallback: '',
        description: 'Service location captured during call',
        example: '123 Main St'
    },
    {
        key: 'appointmentDate',
        label: 'Appointment Date',
        type: 'text',
        category: 'runtime',
        scope: 'runtime',
        required: false,
        fallback: '',
        description: 'Scheduled date for appointment',
        example: 'Monday, Feb 3'
    },
    {
        key: 'appointmentTime',
        label: 'Appointment Time',
        type: 'text',
        category: 'runtime',
        scope: 'runtime',
        required: false,
        fallback: '',
        description: 'Scheduled time for appointment',
        example: '2:00 PM'
    },
    {
        key: 'appointmentWindow',
        label: 'Appointment Window',
        type: 'text',
        category: 'runtime',
        scope: 'runtime',
        required: false,
        fallback: '',
        description: 'Appointment time window',
        example: '2-4 PM'
    },
    {
        key: 'issueSummary',
        label: 'Issue Summary',
        type: 'text',
        category: 'runtime',
        scope: 'runtime',
        required: false,
        fallback: '',
        description: 'Brief summary of caller’s issue',
        example: 'AC not cooling'
    }
];

// ════════════════════════════════════════════════════════════════════════════════
// TRADE-SPECIFIC PLACEHOLDERS
// ════════════════════════════════════════════════════════════════════════════════
const TRADE_PLACEHOLDERS = {
    HVAC: [
        { 
            key: 'acTuneupPrice', 
            label: 'AC Tune-Up Price', 
            type: 'money', 
            category: 'pricing',
            scope: 'company',
            required: true, 
            fallback: '',
            supportsModes: ['LITERAL', 'OFFER_TRANSFER', 'OFFER_CALLBACK'],
            policyScripts: PRICING_POLICY_SCRIPTS,
            defaultMode: 'LITERAL',
            description: 'AC maintenance price',
            example: '$89'
        },
        { 
            key: 'furnaceTuneupPrice', 
            label: 'Furnace Tune-Up Price', 
            type: 'money', 
            category: 'pricing',
            scope: 'company',
            required: true, 
            fallback: '',
            supportsModes: ['LITERAL', 'OFFER_TRANSFER', 'OFFER_CALLBACK'],
            policyScripts: PRICING_POLICY_SCRIPTS,
            defaultMode: 'LITERAL',
            description: 'Heating maintenance price',
            example: '$89'
        },
        { 
            key: 'membershipPrice', 
            label: 'Maintenance Plan Price', 
            type: 'money', 
            category: 'pricing',
            scope: 'company',
            required: true, 
            fallback: '',
            supportsModes: ['LITERAL', 'OFFER_TRANSFER', 'OFFER_CALLBACK'],
            policyScripts: PRICING_POLICY_SCRIPTS,
            defaultMode: 'LITERAL',
            description: 'Annual maintenance plan cost',
            example: '$199/year'
        },
        { 
            key: 'financingAvailable', 
            label: 'Financing Available', 
            type: 'text', 
            category: 'sales',
            scope: 'company',
            required: false, 
            fallback: 'We offer financing options',
            description: 'Financing terms/partners',
            example: 'We offer 0% financing for 12 months through GreenSky'
        },
        { 
            key: 'brandsServiced', 
            label: 'Brands Serviced', 
            type: 'text', 
            category: 'info',
            scope: 'company',
            required: false, 
            fallback: 'all major brands',
            description: 'HVAC brands supported',
            example: 'Carrier, Trane, Lennox, Goodman, and all major brands'
        }
    ],
    
    PLUMBING: [
        { 
            key: 'drainCleaningPrice', 
            label: 'Drain Cleaning Price', 
            type: 'money', 
            category: 'pricing',
            scope: 'company',
            required: true, 
            fallback: '',
            supportsModes: ['LITERAL', 'OFFER_TRANSFER', 'OFFER_CALLBACK'],
            policyScripts: PRICING_POLICY_SCRIPTS,
            defaultMode: 'LITERAL',
            description: 'Basic drain clearing cost',
            example: '$149'
        },
        { 
            key: 'waterHeaterFlushPrice', 
            label: 'Water Heater Flush Price', 
            type: 'money', 
            category: 'pricing',
            scope: 'company',
            required: true, 
            fallback: '',
            supportsModes: ['LITERAL', 'OFFER_TRANSFER', 'OFFER_CALLBACK'],
            policyScripts: PRICING_POLICY_SCRIPTS,
            defaultMode: 'LITERAL',
            description: 'Water heater maintenance',
            example: '$99'
        }
    ],
    
    ELECTRICAL: [
        { 
            key: 'outletInstallPrice', 
            label: 'Outlet Install Price', 
            type: 'money', 
            category: 'pricing',
            scope: 'company',
            required: true, 
            fallback: '',
            supportsModes: ['LITERAL', 'OFFER_TRANSFER', 'OFFER_CALLBACK'],
            policyScripts: PRICING_POLICY_SCRIPTS,
            defaultMode: 'LITERAL',
            description: 'Standard outlet installation',
            example: 'Starting at $150'
        },
        { 
            key: 'panelUpgradeEstimate', 
            label: 'Panel Upgrade Range', 
            type: 'text', 
            category: 'pricing',
            scope: 'company',
            required: false, 
            fallback: 'we provide free estimates',
            supportsModes: ['LITERAL', 'OFFER_TRANSFER', 'OFFER_CALLBACK'],
            policyScripts: PRICING_POLICY_SCRIPTS,
            defaultMode: 'LITERAL',
            description: 'Electrical panel upgrade range',
            example: '$1,500-$3,500 depending on amperage'
        }
    ]
};

// ════════════════════════════════════════════════════════════════════════════════
// ALIAS MAPPING (backward compatibility)
// ════════════════════════════════════════════════════════════════════════════════
// Maps old/legacy keys to canonical keys
const PLACEHOLDER_ALIASES = {
    // Lowercase variants
    'companyname': 'companyName',
    'company_name': 'companyName',
    'company': 'companyName',
    
    // Legacy runtime aliases (do NOT use going forward)
    'name': 'callerName',
    'customername': 'callerName',
    
    // Phone aliases
    'phone': 'companyPhone',
    'mainphone': 'companyPhone',
    'main_phone': 'companyPhone',
    'dispatchphone': 'dispatchPhone',
    'dispatch_phone': 'dispatchPhone',
    'emergencyphone': 'emergencyPhone',
    'emergency_phone': 'emergencyPhone',
    
    // Address aliases
    'address': 'companyAddress',
    'company_address': 'companyAddress',
    'serviceareas': 'serviceAreas',
    'service_areas': 'serviceAreas',
    'service_area': 'serviceAreas',
    'servicearea': 'serviceAreas',
    
    // Hours aliases
    'businesshours': 'businessHours',
    'business_hours': 'businessHours',
    'hours': 'businessHours',
    
    // Price aliases
    'servicecallfee': 'serviceCallFee',
    'service_call_fee': 'serviceCallFee',
    'servicecallprice': 'serviceCallFee',
    'diagnostic_fee': 'serviceCallFee',
    
    // URL aliases
    'websiteurl': 'websiteUrl',
    'website_url': 'websiteUrl',
    'website': 'websiteUrl',
    'bookingurl': 'bookingUrl',
    'booking_url': 'bookingUrl',
    
    // License aliases
    'licensenumber': 'licenseNumber',
    'license_number': 'licenseNumber',
    'license': 'licenseNumber',
    
    // Email aliases
    'email': 'companyEmail',
    'companyemail': 'companyEmail',
    'company_email': 'companyEmail'
};

// ════════════════════════════════════════════════════════════════════════════════
// CATALOG API
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Get the complete placeholder catalog for a trade
 * @param {string} tradeKey - Trade identifier (HVAC, PLUMBING, etc.)
 * @returns {Object} Catalog with placeholders and aliases
 */
function getCatalog(tradeKey = null) {
    const tradePlaceholders = tradeKey && TRADE_PLACEHOLDERS[tradeKey.toUpperCase()] 
        ? TRADE_PLACEHOLDERS[tradeKey.toUpperCase()] 
        : [];
    
    const allPlaceholders = [...UNIVERSAL_PLACEHOLDERS, ...tradePlaceholders, ...RUNTIME_PLACEHOLDERS];
    
    // Build quick lookup maps
    const byKey = {};
    const byCategory = {};
    
    for (const p of allPlaceholders) {
        byKey[p.key] = p;
        
        if (!byCategory[p.category]) {
            byCategory[p.category] = [];
        }
        byCategory[p.category].push(p);
    }
    
    return {
        tradeKey: tradeKey || 'UNIVERSAL',
        version: '1.0.0',
        policyScripts: {
            pricing: PRICING_POLICY_SCRIPTS
        },
        placeholders: allPlaceholders,
        byKey,
        byCategory,
        aliases: PLACEHOLDER_ALIASES,
        required: allPlaceholders.filter(p => p.scope === 'company' && p.required),
        optional: allPlaceholders.filter(p => p.scope === 'company' && !p.required),
        runtime: allPlaceholders.filter(p => p.scope === 'runtime')
    };
}

/**
 * Resolve a placeholder key through aliases
 * @param {string} key - The key to resolve
 * @returns {string} The canonical key
 */
function resolveAlias(key) {
    const normalized = key.toLowerCase().trim();
    return PLACEHOLDER_ALIASES[normalized] || key;
}

/**
 * Check if a key is valid (exists in catalog or has alias)
 * @param {string} key - The key to check
 * @param {string} tradeKey - Optional trade for trade-specific keys
 * @returns {Object} { valid, canonicalKey, placeholder }
 */
function validateKey(key, tradeKey = null) {
    const catalog = getCatalog(tradeKey);
    const canonicalKey = resolveAlias(key);
    const placeholder = catalog.byKey[canonicalKey];
    
    return {
        valid: !!placeholder,
        canonicalKey,
        placeholder: placeholder || null,
        isAlias: canonicalKey !== key
    };
}

/**
 * Get all valid keys (including aliases) for GPT prompt
 * @param {string} tradeKey - Trade identifier
 * @returns {string[]} Array of valid keys
 */
function getValidKeysForGPT(tradeKey = null) {
    const catalog = getCatalog(tradeKey);
    return catalog.placeholders.map(p => p.key);
}

/**
 * Get GPT-ready placeholder documentation
 * @param {string} tradeKey - Trade identifier
 * @returns {string} Markdown-formatted placeholder guide
 */
function getGPTPlaceholderGuide(tradeKey = null) {
    const catalog = getCatalog(tradeKey);
    
    let guide = `## Available Placeholders\n\n`;
    guide += `Use ONLY these placeholder keys in scenario text. Format: {placeholderKey}\n\n`;
    
    for (const [category, placeholders] of Object.entries(catalog.byCategory)) {
        guide += `### ${category.charAt(0).toUpperCase() + category.slice(1)}\n`;
        for (const p of placeholders) {
            guide += `- \`{${p.key}}\` - ${p.label}${p.required ? ' (REQUIRED)' : ''}\n`;
        }
        guide += '\n';
    }
    
    guide += `\n**DO NOT** invent new placeholder keys. Use ONLY the keys listed above.\n`;
    
    return guide;
}

module.exports = {
    PRICING_POLICY_SCRIPTS,
    UNIVERSAL_PLACEHOLDERS,
    TRADE_PLACEHOLDERS,
    RUNTIME_PLACEHOLDERS,
    PLACEHOLDER_ALIASES,
    getCatalog,
    resolveAlias,
    validateKey,
    getValidKeysForGPT,
    getGPTPlaceholderGuide
};
