/**
 * ============================================================================
 * PLATFORM SNAPSHOT AGGREGATOR
 * ============================================================================
 * 
 * This is the core engine that collects all provider snapshots and computes
 * the completeness score.
 * 
 * RULE: If it's not in this snapshot, it does not exist.
 * 
 * ============================================================================
 */

const { REQUIRED_PROVIDERS, SNAPSHOT_VERSION, SCHEMA_VERSION } = require('./snapshotRegistry');
const { computeCompleteness } = require('./completenessScore');
const { signSnapshot } = require('./snapshotIntegrity');
const Company = require('../../models/v2Company');
const logger = require('../../utils/logger');

// Import all providers
const providers = [
    require('./providers/controlPlane.snapshot'),
    require('./providers/dynamicFlow.snapshot'),
    require('./providers/scenarioBrain.snapshot'),
    require('./providers/callProtection.snapshot'),
    require('./providers/transfers.snapshot'),
    require('./providers/placeholders.snapshot'),
    require('./providers/runtimeBindings.snapshot')
];

// Map provider files to their keys
const PROVIDER_KEYS = [
    'controlPlane',
    'dynamicFlow',
    'scenarioBrain',
    'callProtection',
    'transfers',
    'placeholders',
    'runtimeBindings'
];

/**
 * Generate a complete platform snapshot for a company
 * 
 * @param {String} companyId - Company ObjectId
 * @param {Object} options - Options
 * @param {String} options.scope - 'full' | 'control' | 'scenarios' | 'runtime'
 * @returns {Object} - Complete platform snapshot
 */
async function generateSnapshot(companyId, options = {}) {
    const startTime = Date.now();
    const scope = options.scope || 'full';
    
    logger.info('[PLATFORM SNAPSHOT] Generating snapshot', { companyId, scope });
    
    // Initialize snapshot structure
    const snapshot = {
        meta: {
            companyId,
            companyName: null,
            tradeKey: null,
            scope, // CRITICAL: Store scope so computeCompleteness can read it
            environment: process.env.NODE_ENV || 'development',
            generatedAt: new Date().toISOString(),
            generationMs: 0,
            snapshotVersion: SNAPSHOT_VERSION,
            schemaVersion: SCHEMA_VERSION,
            scope
        },
        providers: {},
        drift: {
            status: 'GREEN',
            missingProviders: [],
            warnings: []
        },
        completeness: null
    };
    
    try {
        // Load company for meta info
        const company = await Company.findById(companyId)
            .select('companyName tradeKey industryType')
            .lean();
        
        if (company) {
            snapshot.meta.companyName = company.companyName;
            snapshot.meta.tradeKey = company.tradeKey || company.industryType || 'universal';
        } else {
            snapshot.drift.warnings.push('Company not found');
            snapshot.drift.status = 'YELLOW';
        }
        
        // Determine which providers to include based on scope
        const includedProviders = getProvidersForScope(scope);
        
        // Run all providers in parallel
        const providerPromises = providers.map(async (provider, index) => {
            const key = PROVIDER_KEYS[index];
            
            // Skip if not in scope
            if (!includedProviders.includes(key)) {
                return { key, result: null, skipped: true };
            }
            
            try {
                const result = await provider.getSnapshot(companyId);
                return { key, result, skipped: false };
            } catch (error) {
                logger.error(`[PLATFORM SNAPSHOT] Provider ${key} failed:`, error.message);
                return {
                    key,
                    result: {
                        provider: key,
                        providerVersion: '1.0',
                        schemaVersion: SCHEMA_VERSION,
                        enabled: false,
                        health: 'RED',
                        error: error.message,
                        data: null,
                        generatedIn: 0
                    },
                    skipped: false
                };
            }
        });
        
        const results = await Promise.all(providerPromises);
        
        // Populate providers object
        results.forEach(({ key, result, skipped }) => {
            if (!skipped && result) {
                snapshot.providers[key] = result;
            }
        });
        
        // Drift detection - check for missing required providers
        const loadedProviders = Object.keys(snapshot.providers);
        for (const required of REQUIRED_PROVIDERS) {
            if (!loadedProviders.includes(required) && includedProviders.includes(required)) {
                snapshot.drift.missingProviders.push(required);
                snapshot.drift.status = 'RED';
            }
        }
        
        // Check for RED health in any enabled provider
        Object.values(snapshot.providers).forEach(p => {
            if (p.enabled && p.health === 'RED') {
                if (snapshot.drift.status !== 'RED') {
                    snapshot.drift.status = 'RED';
                }
            } else if (p.enabled && p.health === 'YELLOW' && snapshot.drift.status === 'GREEN') {
                snapshot.drift.status = 'YELLOW';
            }
            
            // Collect warnings
            if (p.warnings && p.warnings.length > 0) {
                snapshot.drift.warnings.push(...p.warnings.map(w => `[${p.provider}] ${w}`));
            }
        });
        
        // Compute completeness score (SCOPE-AWARE)
        snapshot.completeness = computeCompleteness(snapshot, scope);

        // Explain why not GREEN (evidence-only)
        // This is intended to prevent "dashboard lies" where score looks good but runtime is blocked.
        const blockingPenalties = (snapshot.completeness?.penalties || [])
            .filter(p => p.severity === 'RED' || p.severity === 'YELLOW')
            .map(p => ({
                code: p.code,
                message: p.message,
                severity: p.severity,
                sourcePaths: p.sourcePaths || [],
                examples: p.examples || []
            }));
        snapshot.explainWhyNotGreen = {
            status: snapshot.completeness.status,
            blockers: blockingPenalties
        };
        
        // Finalize timing
        snapshot.meta.generationMs = Date.now() - startTime;
        
        logger.info('[PLATFORM SNAPSHOT] Generated successfully', {
            companyId,
            score: snapshot.completeness.score,
            status: snapshot.completeness.status,
            generationMs: snapshot.meta.generationMs
        });
        
        // Sign the snapshot (if SNAPSHOT_SIGNING_SECRET is configured)
        return signSnapshot(snapshot);
        
    } catch (error) {
        logger.error('[PLATFORM SNAPSHOT] Generation failed:', error.message);
        
        snapshot.drift.status = 'RED';
        snapshot.drift.warnings.push(`Snapshot generation error: ${error.message}`);
        snapshot.meta.generationMs = Date.now() - startTime;
        
        // Still compute completeness (will be low due to missing providers)
        snapshot.completeness = computeCompleteness(snapshot, scope);
        
        // Sign even on error (for consistency)
        return signSnapshot(snapshot);
    }
}

/**
 * Get which providers to include based on scope
 */
function getProvidersForScope(scope) {
    switch (scope) {
        case 'control':
            return ['controlPlane', 'dynamicFlow', 'callProtection', 'transfers', 'placeholders'];
        case 'scenarios':
            return ['scenarioBrain', 'placeholders'];
        case 'runtime':
            // CRITICAL: Include callProtection + transfers for runtime scope
            // These are required by REQUIRED_PROVIDERS_BY_SCOPE.runtime
            return ['runtimeBindings', 'dynamicFlow', 'callProtection', 'transfers'];
        case 'full':
        default:
            return PROVIDER_KEYS;
    }
}

/**
 * Quick health check without full snapshot
 */
async function quickHealthCheck(companyId) {
    try {
        const snapshot = await generateSnapshot(companyId, { scope: 'runtime' });
        return {
            healthy: snapshot.completeness.status === 'GREEN',
            score: snapshot.completeness.score,
            status: snapshot.completeness.status,
            summary: snapshot.completeness.summary
        };
    } catch (error) {
        return {
            healthy: false,
            score: 0,
            status: 'RED',
            summary: `Health check failed: ${error.message}`
        };
    }
}

module.exports = {
    generateSnapshot,
    quickHealthCheck,
    PROVIDER_KEYS
};

