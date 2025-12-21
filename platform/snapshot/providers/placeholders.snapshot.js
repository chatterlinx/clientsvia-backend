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
        
        // Also check company document for legacy variables
        const company = await Company.findById(companyId)
            .select('companyName phoneNumber variables')
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
        
        // Auto-add critical company fields
        if (company?.companyName && !placeholderMap.has('companyname')) {
            placeholderMap.set('companyname', {
                key: 'companyname',
                value: company.companyName,
                source: 'company',
                isSystem: true
            });
        }
        
        if (company?.phoneNumber && !placeholderMap.has('phone')) {
            placeholderMap.set('phone', {
                key: 'phone',
                value: company.phoneNumber,
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
        
        // Determine health
        let health = 'GREEN';
        const warnings = [];
        
        if (missingCritical.length > 0) {
            warnings.push(`Missing critical placeholders: ${missingCritical.join(', ')}`);
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

