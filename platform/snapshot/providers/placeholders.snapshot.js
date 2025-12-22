/**
 * ============================================================================
 * PLACEHOLDERS SNAPSHOT PROVIDER
 * ============================================================================
 * Provides: Company variables (name, phone, license, etc.)
 * 
 * STANDARD FORMAT: {{companyName}} (camelCase canonical)
 * Aliases: companyname, company_name, COMPANYNAME → all resolve to companyName
 */

const CompanyPlaceholders = require('../../../models/CompanyPlaceholders');
const Company = require('../../../models/v2Company');
const { CRITICAL_PLACEHOLDERS, OPTIONAL_PLACEHOLDERS } = require('../snapshotRegistry');
const { normalizeKey, PLACEHOLDER_ALIASES } = require('../../../utils/placeholderStandard');
const logger = require('../../../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════
// CANONICAL PLACEHOLDER DEFINITIONS
// These are the STANDARD keys - aliases map to these
// ═══════════════════════════════════════════════════════════════════════════
const CANONICAL_PLACEHOLDERS = {
    companyName: {
        aliases: ['companyname', 'company_name', 'COMPANYNAME', 'COMPANY_NAME', 'company'],
        description: 'Company name',
        isCritical: true
    },
    companyPhone: {
        aliases: ['companyphone', 'company_phone', 'phone', 'phonenumber', 'phone_number'],
        description: 'Company phone number',
        isCritical: true
    },
    companyAddress: {
        aliases: ['companyaddress', 'company_address', 'address'],
        description: 'Company address',
        isCritical: false
    },
    companyEmail: {
        aliases: ['companyemail', 'company_email', 'email'],
        description: 'Company email',
        isCritical: false
    },
    companyWebsite: {
        aliases: ['companywebsite', 'company_website', 'website', 'url'],
        description: 'Company website',
        isCritical: false
    },
    serviceArea: {
        aliases: ['servicearea', 'service_area'],
        description: 'Service area/region',
        isCritical: false
    },
    businessHours: {
        aliases: ['businesshours', 'business_hours', 'hours'],
        description: 'Business hours',
        isCritical: false
    }
};

module.exports.getSnapshot = async function(companyId) {
    const startTime = Date.now();
    
    try {
        // Get placeholders from NEW system
        const placeholdersDoc = await CompanyPlaceholders.findOne({ companyId }).lean();
        const placeholders = placeholdersDoc?.placeholders || [];
        
        // Also check company document for legacy variables + system fields
        const company = await Company.findById(companyId)
            .select('companyName companyPhone phoneNumber companyAddress email website variables twilioIntegration')
            .lean();
        
        // Build placeholder map with CANONICAL keys
        const placeholderMap = new Map();
        
        // Add from NEW placeholders system (normalize keys)
        placeholders.forEach(p => {
            const canonicalKey = normalizeKey(p.key);
            placeholderMap.set(canonicalKey, {
                canonicalKey,
                originalKey: p.key,
                value: p.value,
                source: 'placeholders',
                isSystem: p.isSystem || false,
                aliases: CANONICAL_PLACEHOLDERS[canonicalKey]?.aliases || []
            });
        });
        
        // Add legacy variables (if not overridden, normalize keys)
        if (company?.variables) {
            Object.entries(company.variables).forEach(([key, value]) => {
                const canonicalKey = normalizeKey(key);
                if (!placeholderMap.has(canonicalKey)) {
                    placeholderMap.set(canonicalKey, {
                        canonicalKey,
                        originalKey: key,
                        value,
                        source: 'legacy',
                        isSystem: false,
                        aliases: CANONICAL_PLACEHOLDERS[canonicalKey]?.aliases || []
                    });
                }
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // AUTO-DERIVE SYSTEM PLACEHOLDERS FROM COMPANY RECORD
        // Using CANONICAL keys (companyName, not companyname)
        // ═══════════════════════════════════════════════════════════════════
        
        // companyName (CRITICAL) - note: canonical is camelCase
        if (company?.companyName && !placeholderMap.has('companyName')) {
            placeholderMap.set('companyName', {
                canonicalKey: 'companyName',
                originalKey: 'companyName',
                value: company.companyName,
                source: 'company',
                isSystem: true,
                aliases: CANONICAL_PLACEHOLDERS.companyName.aliases
            });
        }
        
        // companyPhone (CRITICAL) - Check multiple possible fields
        if (!placeholderMap.has('companyPhone')) {
            const phoneValue = company?.companyPhone || 
                               company?.phoneNumber || 
                               company?.twilioIntegration?.phoneNumber;
            if (phoneValue) {
                placeholderMap.set('companyPhone', {
                    canonicalKey: 'companyPhone',
                    originalKey: 'companyPhone',
                    value: phoneValue,
                    source: 'company',
                    isSystem: true,
                    aliases: CANONICAL_PLACEHOLDERS.companyPhone.aliases
                });
            }
        }
        
        // companyAddress (optional but useful)
        if (company?.companyAddress && !placeholderMap.has('companyAddress')) {
            placeholderMap.set('companyAddress', {
                canonicalKey: 'companyAddress',
                originalKey: 'companyAddress',
                value: company.companyAddress,
                source: 'company',
                isSystem: true,
                aliases: CANONICAL_PLACEHOLDERS.companyAddress.aliases
            });
        }
        
        // companyEmail (optional)
        if (company?.email && !placeholderMap.has('companyEmail')) {
            placeholderMap.set('companyEmail', {
                canonicalKey: 'companyEmail',
                originalKey: 'companyEmail',
                value: company.email,
                source: 'company',
                isSystem: true,
                aliases: CANONICAL_PLACEHOLDERS.companyEmail.aliases
            });
        }
        
        // companyWebsite (optional)
        if (company?.website && !placeholderMap.has('companyWebsite')) {
            placeholderMap.set('companyWebsite', {
                canonicalKey: 'companyWebsite',
                originalKey: 'companyWebsite',
                value: company.website,
                source: 'company',
                isSystem: true,
                aliases: CANONICAL_PLACEHOLDERS.companyWebsite.aliases
            });
        }
        
        // Check for missing critical placeholders (using CANONICAL keys)
        const canonicalCritical = ['companyName', 'companyPhone'];
        const missingCritical = [];
        canonicalCritical.forEach(key => {
            if (!placeholderMap.has(key)) {
                missingCritical.push(key);
            }
        });
        
        // Check for missing optional placeholders
        const canonicalOptional = ['companyAddress', 'companyEmail', 'companyWebsite', 'serviceArea', 'businessHours'];
        const missingOptional = [];
        canonicalOptional.forEach(key => {
            if (!placeholderMap.has(key)) {
                missingOptional.push(key);
            }
        });
        
        // Determine health and provide actionable warnings
        let health = 'GREEN';
        const warnings = [];
        
        if (missingCritical.length > 0) {
            // Provide specific actionable guidance
            if (missingCritical.includes('companyPhone')) {
                warnings.push('Missing critical placeholder: companyPhone — Add company phone in Company Profile');
            }
            if (missingCritical.includes('companyName')) {
                warnings.push('Missing critical placeholder: companyName — Company name not set in profile');
            }
            health = 'YELLOW';
        }
        
        // Convert map to array with CANONICAL structure
        const allPlaceholders = Array.from(placeholderMap.values());
        
        return {
            provider: 'placeholders',
            providerVersion: '2.0',  // Version bump for canonical keys
            schemaVersion: 'v2',
            enabled: true,
            health,
            warnings,
            data: {
                count: allPlaceholders.length,
                
                // CANONICAL keys only (not legacy)
                keys: allPlaceholders.map(p => p.canonicalKey),
                
                // Standard format documentation
                standardFormat: '{{placeholderName}}',
                
                missingCritical,
                missingOptional,
                
                bySource: {
                    placeholders: allPlaceholders.filter(p => p.source === 'placeholders').length,
                    legacy: allPlaceholders.filter(p => p.source === 'legacy').length,
                    company: allPlaceholders.filter(p => p.source === 'company').length
                },
                
                // Full items with canonical key + aliases
                items: allPlaceholders.map(p => ({
                    canonicalKey: p.canonicalKey,
                    normalizedKey: p.canonicalKey,  // Same as canonical
                    originalKey: p.originalKey,
                    aliases: p.aliases,
                    hasValue: !!p.value,
                    source: p.source,
                    isSystem: p.isSystem
                }))
            },
            generatedIn: Date.now() - startTime
        };
        
    } catch (error) {
        logger.error('[SNAPSHOT:placeholders] Error:', error.message);
        return {
            provider: 'placeholders',
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

