/**
 * ============================================================================
 * PLACEHOLDERS SNAPSHOT PROVIDER
 * ============================================================================
 * Provides: Company variables (name, phone, license, etc.)
 */

const CompanyPlaceholders = require('../../../models/CompanyPlaceholders');
const Company = require('../../../models/v2Company');
const { CRITICAL_PLACEHOLDERS, OPTIONAL_PLACEHOLDERS } = require('../snapshotRegistry');
const logger = require('../../../utils/logger');

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
        
        // Build placeholder map (NEW system takes precedence)
        const placeholderMap = new Map();
        
        // Add from NEW placeholders system
        placeholders.forEach(p => {
            placeholderMap.set(p.key.toLowerCase(), {
                key: p.key,
                value: p.value,
                source: 'placeholders',
                isSystem: p.isSystem || false
            });
        });
        
        // Add legacy variables (if not overridden)
        if (company?.variables) {
            Object.entries(company.variables).forEach(([key, value]) => {
                if (!placeholderMap.has(key.toLowerCase())) {
                    placeholderMap.set(key.toLowerCase(), {
                        key,
                        value,
                        source: 'legacy',
                        isSystem: false
                    });
                }
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // AUTO-DERIVE SYSTEM PLACEHOLDERS FROM COMPANY RECORD
        // These are injected automatically - users don't need to manually add
        // ═══════════════════════════════════════════════════════════════════
        
        // companyname (CRITICAL)
        if (company?.companyName && !placeholderMap.has('companyname')) {
            placeholderMap.set('companyname', {
                key: 'companyname',
                value: company.companyName,
                source: 'company',
                isSystem: true
            });
        }
        
        // phone (CRITICAL) - Check multiple possible fields
        if (!placeholderMap.has('phone')) {
            const phoneValue = company?.companyPhone || 
                               company?.phoneNumber || 
                               company?.twilioIntegration?.phoneNumber;
            if (phoneValue) {
                placeholderMap.set('phone', {
                    key: 'phone',
                    value: phoneValue,
                    source: 'company',
                    isSystem: true
                });
            }
        }
        
        // address (optional but useful)
        if (company?.companyAddress && !placeholderMap.has('address')) {
            placeholderMap.set('address', {
                key: 'address',
                value: company.companyAddress,
                source: 'company',
                isSystem: true
            });
        }
        
        // email (optional)
        if (company?.email && !placeholderMap.has('email')) {
            placeholderMap.set('email', {
                key: 'email',
                value: company.email,
                source: 'company',
                isSystem: true
            });
        }
        
        // website (optional)
        if (company?.website && !placeholderMap.has('website')) {
            placeholderMap.set('website', {
                key: 'website',
                value: company.website,
                source: 'company',
                isSystem: true
            });
        }
        
        // Check for missing critical placeholders
        const missingCritical = [];
        CRITICAL_PLACEHOLDERS.forEach(key => {
            if (!placeholderMap.has(key)) {
                missingCritical.push(key);
            }
        });
        
        // Check for missing optional placeholders
        const missingOptional = [];
        OPTIONAL_PLACEHOLDERS.forEach(key => {
            if (!placeholderMap.has(key)) {
                missingOptional.push(key);
            }
        });
        
        // Determine health and provide actionable warnings
        let health = 'GREEN';
        const warnings = [];
        
        if (missingCritical.length > 0) {
            // Provide specific actionable guidance
            if (missingCritical.includes('phone')) {
                warnings.push('Missing critical placeholder: phone — Add company phone in Company Profile');
            }
            if (missingCritical.includes('companyname')) {
                warnings.push('Missing critical placeholder: companyname — Company name not set in profile');
            }
            // Generic fallback for any others
            const otherMissing = missingCritical.filter(k => !['phone', 'companyname'].includes(k));
            if (otherMissing.length > 0) {
                warnings.push(`Missing critical placeholders: ${otherMissing.join(', ')}`);
            }
            health = 'YELLOW';
        }
        
        // Convert map to array
        const allPlaceholders = Array.from(placeholderMap.values());
        
        return {
            provider: 'placeholders',
            providerVersion: '1.0',
            schemaVersion: 'v1',
            enabled: true,
            health,
            warnings,
            data: {
                count: allPlaceholders.length,
                keys: allPlaceholders.map(p => p.key),
                
                missingCritical,
                missingOptional,
                
                bySource: {
                    placeholders: allPlaceholders.filter(p => p.source === 'placeholders').length,
                    legacy: allPlaceholders.filter(p => p.source === 'legacy').length,
                    company: allPlaceholders.filter(p => p.source === 'company').length
                },
                
                items: allPlaceholders.map(p => ({
                    key: p.key,
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

