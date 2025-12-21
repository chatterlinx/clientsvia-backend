/**
 * ============================================================================
 * SNAPSHOT PROVIDER REGISTRY
 * ============================================================================
 * 
 * This file is the TRUTH LIST of required snapshot providers.
 * Any subsystem that affects runtime MUST add itself here.
 * 
 * If it's not in this list, it's not monitored.
 * If it's in this list but missing from snapshot → drift RED.
 * 
 * ============================================================================
 */

module.exports = {
    // Required providers for a complete platform snapshot (FULL scope)
    REQUIRED_PROVIDERS: [
        'controlPlane',
        'dynamicFlow',
        'scenarioBrain',
        'callProtection',
        'transfers',
        'placeholders',
        'runtimeBindings'
    ],
    
    // ═══════════════════════════════════════════════════════════════════════════
    // SCOPE-SPECIFIC REQUIRED PROVIDERS
    // Only penalize missing providers that are required for the current scope
    // ═══════════════════════════════════════════════════════════════════════════
    REQUIRED_PROVIDERS_BY_SCOPE: {
        full: [
            'controlPlane',
            'dynamicFlow',
            'scenarioBrain',
            'callProtection',
            'transfers',
            'placeholders',
            'runtimeBindings'
        ],
        scenarios: [
            'scenarioBrain',
            'placeholders'
        ],
        control: [
            'controlPlane',
            'dynamicFlow',
            'placeholders'
        ],
        runtime: [
            'runtimeBindings',
            'dynamicFlow',
            'callProtection',
            'transfers'
        ]
    },
    
    // Provider metadata for documentation
    PROVIDER_METADATA: {
        controlPlane: {
            name: 'Control Plane',
            description: 'Front desk, greeting, tone, booking configuration',
            criticality: 'HIGH'
        },
        dynamicFlow: {
            name: 'Dynamic Flow Engine',
            description: 'Trigger → Event → State → Action routing',
            criticality: 'HIGH'
        },
        scenarioBrain: {
            name: 'Scenario Brain (3-Tier)',
            description: 'Scenario matching, templates, categories, overrides',
            criticality: 'CRITICAL'
        },
        callProtection: {
            name: 'Call Protection',
            description: 'Pre-answer filters (spam, voicemail, abuse)',
            criticality: 'MEDIUM'
        },
        transfers: {
            name: 'Transfer Calls',
            description: 'Transfer targets, after-hours routing',
            criticality: 'MEDIUM'
        },
        placeholders: {
            name: 'Placeholders',
            description: 'Company variables (name, phone, license, etc.)',
            criticality: 'HIGH'
        },
        runtimeBindings: {
            name: 'Runtime Bindings',
            description: 'Twilio → IntelligentRouter wiring verification',
            criticality: 'CRITICAL'
        }
    },
    
    // Critical placeholders that MUST exist
    CRITICAL_PLACEHOLDERS: [
        'companyname',
        'phone'
    ],
    
    // Optional placeholders (minor penalty if missing)
    OPTIONAL_PLACEHOLDERS: [
        'hours',
        'servicearea',
        'license',
        'address',
        'email',
        'website'
    ],
    
    // Schema version for contract testing
    SCHEMA_VERSION: 'v1',
    
    // Snapshot system version
    SNAPSHOT_VERSION: 'v1.0'
};

