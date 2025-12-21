/**
 * ============================================================================
 * PLATFORM SNAPSHOT CONTRACT TEST
 * ============================================================================
 * 
 * This test MUST pass before any merge to main.
 * It validates the platform snapshot contract is complete.
 * 
 * CI RULE: If this test fails → merge blocked
 * 
 * ============================================================================
 */

const { REQUIRED_PROVIDERS, SCHEMA_VERSION, SNAPSHOT_VERSION } = require('../platform/snapshot/snapshotRegistry');
const { computeCompleteness, PENALTY_CODES } = require('../platform/snapshot/completenessScore');

// Mock snapshot for testing
const createMockSnapshot = (overrides = {}) => {
    const baseSnapshot = {
        meta: {
            companyId: 'test-company-id',
            companyName: 'Test Company',
            tradeKey: 'hvac',
            environment: 'test',
            generatedAt: new Date().toISOString(),
            generationMs: 50,
            snapshotVersion: SNAPSHOT_VERSION,
            schemaVersion: SCHEMA_VERSION,
            scope: 'full'
        },
        providers: {
            controlPlane: {
                provider: 'controlPlane',
                providerVersion: '1.0',
                schemaVersion: SCHEMA_VERSION,
                enabled: true,
                health: 'GREEN',
                warnings: [],
                data: { greetingConfigured: true }
            },
            dynamicFlow: {
                provider: 'dynamicFlow',
                providerVersion: '1.0',
                schemaVersion: SCHEMA_VERSION,
                enabled: true,
                health: 'GREEN',
                warnings: [],
                data: { flowsTotal: 5, flowsEnabled: 5, duplicateFlowKeys: [], priorityOrderValid: true }
            },
            scenarioBrain: {
                provider: 'scenarioBrain',
                providerVersion: '1.0',
                schemaVersion: SCHEMA_VERSION,
                enabled: true,
                health: 'GREEN',
                warnings: [],
                data: {
                    summary: {
                        templatesActive: 1,
                        scenariosEnabled: 10,
                        scenariosDisabled: 2,
                        disabledCategoriesNoDefault: 0,
                        disabledScenariosNoAlt: 0
                    },
                    companyDefaults: { notOfferedConfigured: true }
                }
            },
            callProtection: {
                provider: 'callProtection',
                providerVersion: '1.0',
                schemaVersion: SCHEMA_VERSION,
                enabled: true,
                health: 'GREEN',
                warnings: [],
                data: { rulesTotal: 3, rulesEnabled: 3 }
            },
            transfers: {
                provider: 'transfers',
                providerVersion: '1.0',
                schemaVersion: SCHEMA_VERSION,
                enabled: true,
                health: 'GREEN',
                warnings: [],
                data: { targetsTotal: 2, targetsEnabled: 2 }
            },
            placeholders: {
                provider: 'placeholders',
                providerVersion: '1.0',
                schemaVersion: SCHEMA_VERSION,
                enabled: true,
                health: 'GREEN',
                warnings: [],
                data: { count: 10, missingCritical: [], missingOptional: ['hours'] }
            },
            runtimeBindings: {
                provider: 'runtimeBindings',
                providerVersion: '1.0',
                schemaVersion: SCHEMA_VERSION,
                enabled: true,
                health: 'GREEN',
                warnings: [],
                data: {
                    wiringChecks: {
                        intelligentRouterWired: true,
                        scenarioEngineWired: true,
                        overrideResolverWired: true,
                        dynamicFlowWired: true,
                        placeholdersWired: true
                    },
                    lastCallStats: { avgResponseMs: null, llmFallbackRate: null }
                }
            }
        },
        drift: {
            status: 'GREEN',
            missingProviders: [],
            warnings: []
        }
    };
    
    // Apply overrides
    return { ...baseSnapshot, ...overrides };
};

describe('Platform Snapshot Contract Tests', () => {
    
    describe('Snapshot Schema Validation', () => {
        
        it('should have all required providers defined in registry', () => {
            expect(REQUIRED_PROVIDERS).toBeDefined();
            expect(Array.isArray(REQUIRED_PROVIDERS)).toBe(true);
            expect(REQUIRED_PROVIDERS.length).toBeGreaterThan(0);
            
            const expectedProviders = [
                'controlPlane',
                'dynamicFlow',
                'scenarioBrain',
                'callProtection',
                'transfers',
                'placeholders',
                'runtimeBindings'
            ];
            
            expectedProviders.forEach(provider => {
                expect(REQUIRED_PROVIDERS).toContain(provider);
            });
        });
        
        it('should have valid schema version', () => {
            expect(SCHEMA_VERSION).toBe('v1');
        });
        
        it('should have valid snapshot version', () => {
            expect(SNAPSHOT_VERSION).toBe('v1.0');
        });
        
    });
    
    describe('Completeness Score Calculation', () => {
        
        it('should return score between 0 and 100', () => {
            const snapshot = createMockSnapshot();
            const result = computeCompleteness(snapshot);
            
            expect(result.score).toBeGreaterThanOrEqual(0);
            expect(result.score).toBeLessThanOrEqual(100);
        });
        
        it('should have required fields in completeness result', () => {
            const snapshot = createMockSnapshot();
            const result = computeCompleteness(snapshot);
            
            expect(result.score).toBeDefined();
            expect(result.status).toBeDefined();
            expect(result.grade).toBeDefined();
            expect(result.summary).toBeDefined();
            expect(result.penalties).toBeDefined();
            expect(result.recommendations).toBeDefined();
            expect(result.readinessLevel).toBeDefined();
        });
        
        it('should return GREEN status for healthy snapshot', () => {
            const snapshot = createMockSnapshot();
            const result = computeCompleteness(snapshot);
            
            expect(result.status).toBe('GREEN');
            expect(result.score).toBeGreaterThanOrEqual(90);
            expect(['A', 'B']).toContain(result.grade);
        });
        
        it('should return RED status if required provider is missing', () => {
            const snapshot = createMockSnapshot();
            delete snapshot.providers.scenarioBrain;
            
            const result = computeCompleteness(snapshot);
            
            expect(result.status).toBe('RED');
            expect(result.score).toBeLessThanOrEqual(49);
            expect(result.penalties.some(p => p.code === 'MISSING_PROVIDER')).toBe(true);
        });
        
        it('should cap score at 49 if any RED penalty exists', () => {
            const snapshot = createMockSnapshot();
            // Make scenario brain have RED health
            snapshot.providers.scenarioBrain.health = 'RED';
            snapshot.providers.scenarioBrain.enabled = true;
            
            const result = computeCompleteness(snapshot);
            
            expect(result.score).toBeLessThanOrEqual(49);
            expect(result.status).toBe('RED');
        });
        
        it('should penalize disabled scenarios without alternate reply', () => {
            const snapshot = createMockSnapshot();
            snapshot.providers.scenarioBrain.data.summary.disabledScenariosNoAlt = 3;
            
            const result = computeCompleteness(snapshot);
            
            expect(result.score).toBeLessThan(100);
            expect(result.penalties.some(p => p.code === 'DISABLED_SCENARIO_NO_ALT_REPLY')).toBe(true);
        });
        
        it('should penalize missing critical placeholders', () => {
            const snapshot = createMockSnapshot();
            snapshot.providers.placeholders.data.missingCritical = ['companyname', 'phone'];
            
            const result = computeCompleteness(snapshot);
            
            expect(result.score).toBeLessThan(100);
            expect(result.penalties.some(p => p.code === 'PLACEHOLDER_CRITICAL_MISSING')).toBe(true);
        });
        
        it('should penalize duplicate flowKeys', () => {
            const snapshot = createMockSnapshot();
            snapshot.providers.dynamicFlow.data.duplicateFlowKeys = ['booking_intent'];
            
            const result = computeCompleteness(snapshot);
            
            expect(result.penalties.some(p => p.code === 'DUPLICATE_FLOWKEYS')).toBe(true);
        });
        
    });
    
    describe('Grade Mapping', () => {
        
        it('should return grade A for score >= 90', () => {
            const snapshot = createMockSnapshot();
            const result = computeCompleteness(snapshot);
            
            if (result.score >= 90) {
                expect(result.grade).toBe('A');
            }
        });
        
        it('should return grade F for score < 50', () => {
            const snapshot = createMockSnapshot();
            // Remove multiple providers to force low score
            delete snapshot.providers.scenarioBrain;
            delete snapshot.providers.dynamicFlow;
            delete snapshot.providers.runtimeBindings;
            
            const result = computeCompleteness(snapshot);
            
            expect(result.grade).toBe('F');
        });
        
    });
    
    describe('Penalty Codes', () => {
        
        it('should have all penalty codes defined', () => {
            expect(PENALTY_CODES).toBeDefined();
            
            const requiredCodes = [
                'MISSING_PROVIDER',
                'DISABLED_CATEGORY_NO_DEFAULT_REPLY',
                'DISABLED_SCENARIO_NO_ALT_REPLY',
                'PLACEHOLDER_CRITICAL_MISSING',
                'DUPLICATE_FLOWKEYS'
            ];
            
            requiredCodes.forEach(code => {
                expect(PENALTY_CODES[code]).toBeDefined();
                expect(PENALTY_CODES[code].severity).toBeDefined();
                expect(PENALTY_CODES[code].weight).toBeGreaterThan(0);
            });
        });
        
    });
    
    describe('Readiness Levels', () => {
        
        it('should return correct readiness level based on score', () => {
            const snapshot = createMockSnapshot();
            const result = computeCompleteness(snapshot);
            
            if (result.score >= 95) {
                expect(result.readinessLevel).toBe('ELITE - Set-and-forget');
            } else if (result.score >= 90) {
                expect(result.readinessLevel).toBe('PRODUCTION_READY');
            } else if (result.score >= 85) {
                expect(result.readinessLevel).toBe('WORKS - Needs cleanup soon');
            } else if (result.score >= 80) {
                expect(result.readinessLevel).toBe('RISKY - Expect weird calls');
            } else {
                expect(result.readinessLevel).toBe('NOT_PRODUCTION_SAFE');
            }
        });
        
    });
    
});

// Export for potential integration tests
module.exports = { createMockSnapshot };

