/**
 * ============================================================================
 * COMPLETENESS SCORE CALCULATOR
 * ============================================================================
 * 
 * Computes a 0-100 score that answers:
 * "Is this company's control plane + runtime wiring production-ready?"
 * 
 * SCORING PHILOSOPHY:
 * - Correctness + Isolation > Speed > Convenience
 * - Cross-tenant contamination = heavy penalty
 * - Wrong answers = heavy penalty
 * - Optional features = no penalty if disabled
 * 
 * PENALTY WEIGHTS (ClientsVia V22 Model):
 * - CRITICAL (RED): -25 to -35
 * - MAJOR (YELLOW): -8 to -15
 * - MINOR (GREEN): -2 to -5
 * 
 * ============================================================================
 */

const { REQUIRED_PROVIDERS, REQUIRED_PROVIDERS_BY_SCOPE } = require('./snapshotRegistry');
const logger = require('../../utils/logger');

// Penalty codes for consistent logging/searching
const PENALTY_CODES = {
    // CRITICAL - force RED
    MISSING_PROVIDER: { severity: 'RED', weight: 25 },
    PROVIDER_SCHEMA_INVALID: { severity: 'RED', weight: 25 },
    TRADE_SCOPE_MISSING: { severity: 'RED', weight: 35 },
    CROSS_TENANT_RISK: { severity: 'RED', weight: 35 },
    OVERRIDES_NOT_ENFORCED: { severity: 'RED', weight: 30 },
    DYFLOW_ENABLED_ZERO: { severity: 'RED', weight: 25 },
    SCENARIO_ENABLED_ZERO: { severity: 'RED', weight: 25 },
    BOOKING_WIRED_BUT_MISSING_FIELDS: { severity: 'RED', weight: 25 },
    
    // MAJOR - YELLOW
    PLACEHOLDER_CRITICAL_MISSING: { severity: 'YELLOW', weight: 15 },
    DISABLED_CATEGORY_NO_DEFAULT_REPLY: { severity: 'YELLOW', weight: 12 },
    DISABLED_SCENARIO_NO_ALT_REPLY: { severity: 'YELLOW', weight: 8 },
    LLM_FALLBACK_HIGH_15: { severity: 'YELLOW', weight: 10 },
    LLM_FALLBACK_HIGH_25: { severity: 'YELLOW', weight: 15 },
    LLM_FALLBACK_HIGH_40: { severity: 'YELLOW', weight: 20 },
    RESPONSE_SLOW_1500: { severity: 'YELLOW', weight: 8 },
    RESPONSE_SLOW_2500: { severity: 'YELLOW', weight: 12 },
    RESPONSE_SLOW_4000: { severity: 'YELLOW', weight: 18 },
    DUPLICATE_FLOWKEYS: { severity: 'YELLOW', weight: 12 },
    PRIORITY_ORDER_INVALID: { severity: 'YELLOW', weight: 10 },
    TEMPLATE_NOT_TRADE_SCOPED: { severity: 'YELLOW', weight: 15 },
    
    // December 2025 Directive - New validation penalties
    NO_GREETING_CONFIGURED: { severity: 'YELLOW', weight: 8 },
    INVALID_CALL_PROTECTION_RULE: { severity: 'YELLOW', weight: 10 },
    INVALID_DYNAMIC_FLOW: { severity: 'YELLOW', weight: 10 },
    BOOKING_ENABLED_NO_SLOTS: { severity: 'YELLOW', weight: 8 },
    
    // MINOR - GREEN
    PLACEHOLDER_OPTIONAL_MISSING: { severity: 'GREEN', weight: 2 },

    // Runtime truth blockers (reply behavior governance)
    CONSENT_SCENARIO_AUTOREPLIES_BLOCKED: { severity: 'YELLOW', weight: 15 },
    SCENARIO_UNKNOWN_TYPE_ENABLED: { severity: 'YELLOW', weight: 12 }
};

/**
 * Main scoring function
 * @param {Object} snapshot - The full platform snapshot
 * @param {String} scopeOverride - Optional scope override (reads from snapshot.meta.scope if not provided)
 * @returns {Object} - { score, status, grade, summary, penalties, recommendations, scope }
 */
function computeCompleteness(snapshot, scopeOverride = null) {
    let score = 100;
    const penalties = [];
    const recommendations = [];
    let hasRedPenalty = false;
    
    const providers = snapshot.providers || {};
    
    // CRITICAL: Read scope from snapshot.meta.scope (primary) or use override/default
    const scope = scopeOverride || snapshot?.meta?.scope || 'full';
    
    // ═══════════════════════════════════════════════════════════════════════
    // 1. CHECK REQUIRED PROVIDERS (SCOPE-AWARE)
    // Only penalize missing providers that are required for the current scope
    // DO NOT penalize providers not required for this scope
    // ═══════════════════════════════════════════════════════════════════════
    const requiredForScope = REQUIRED_PROVIDERS_BY_SCOPE[scope] || REQUIRED_PROVIDERS;
    
    logger.info(`[COMPLETENESS] Scoring with scope: ${scope}, required providers: ${requiredForScope.join(', ')}`);
    logger.info(`[COMPLETENESS] Available providers: ${Object.keys(providers).join(', ')}`);
    
    requiredForScope.forEach(providerKey => {
        const provider = providers[providerKey];
        
        if (!provider) {
            penalties.push({
                code: 'MISSING_PROVIDER',
                severity: 'RED',
                weight: PENALTY_CODES.MISSING_PROVIDER.weight,
                message: `Missing required provider for ${scope} scope: ${providerKey}`
            });
            score -= PENALTY_CODES.MISSING_PROVIDER.weight;
            hasRedPenalty = true;
            recommendations.push(`Add ${providerKey} snapshot provider`);
        } else if (provider.health === 'RED' && provider.enabled) {
            // Only penalize RED health if the provider is enabled and failed
            penalties.push({
                code: 'PROVIDER_SCHEMA_INVALID',
                severity: 'RED',
                weight: PENALTY_CODES.PROVIDER_SCHEMA_INVALID.weight,
                message: `Provider ${providerKey} is RED: ${provider.error || 'health check failed'}`
            });
            score -= PENALTY_CODES.PROVIDER_SCHEMA_INVALID.weight;
            hasRedPenalty = true;
        }
        // NOTE: NOT_CONFIGURED status with enabled=false and health=GREEN is NOT penalized
        // Optional features (callProtection, transfers) can be unconfigured without penalty
    });
    
    // ═══════════════════════════════════════════════════════════════════════
    // 2. CHECK SCENARIO BRAIN (CRITICAL)
    // ═══════════════════════════════════════════════════════════════════════
    const scenarioBrain = providers.scenarioBrain?.data;
    if (scenarioBrain && providers.scenarioBrain.enabled) {
        const summary = scenarioBrain.summary || {};
        
        // No active templates
        if (summary.templatesActive === 0) {
            penalties.push({
                code: 'SCENARIO_ENABLED_ZERO',
                severity: 'RED',
                weight: PENALTY_CODES.SCENARIO_ENABLED_ZERO.weight,
                message: 'Scenario Brain enabled but no active templates'
            });
            score -= PENALTY_CODES.SCENARIO_ENABLED_ZERO.weight;
            hasRedPenalty = true;
            recommendations.push('Activate at least one template for scenario matching');
        }
        
        // Disabled categories without default reply
        const disabledCatsNoDefault = summary.disabledCategoriesNoDefault || 0;
        if (disabledCatsNoDefault > 0) {
            const penalty = Math.min(disabledCatsNoDefault * PENALTY_CODES.DISABLED_CATEGORY_NO_DEFAULT_REPLY.weight, 36);
            penalties.push({
                code: 'DISABLED_CATEGORY_NO_DEFAULT_REPLY',
                severity: 'YELLOW',
                weight: penalty,
                message: `${disabledCatsNoDefault} disabled categories without default reply`
            });
            score -= penalty;
            recommendations.push(`Configure default "not offered" reply for ${disabledCatsNoDefault} disabled categories`);
        }
        
        // Disabled scenarios without alternate reply (cap at -24)
        const disabledScenariosNoAlt = summary.disabledScenariosNoAlt || 0;
        if (disabledScenariosNoAlt > 0) {
            const penalty = Math.min(disabledScenariosNoAlt * PENALTY_CODES.DISABLED_SCENARIO_NO_ALT_REPLY.weight, 24);
            penalties.push({
                code: 'DISABLED_SCENARIO_NO_ALT_REPLY',
                severity: 'YELLOW',
                weight: penalty,
                message: `${disabledScenariosNoAlt} disabled scenarios without alternate reply`
            });
            score -= penalty;
            recommendations.push(`Configure alternate replies for ${disabledScenariosNoAlt} disabled scenarios`);
        }
        
        // Company defaults not configured
        if (!scenarioBrain.companyDefaults?.notOfferedConfigured && summary.scenariosDisabled > 0) {
            penalties.push({
                code: 'OVERRIDES_NOT_ENFORCED',
                severity: 'RED',
                weight: 15, // Less than full weight since category/scenario might have replies
                message: 'Company "Not Offered" default not configured but scenarios are disabled'
            });
            score -= 15;
            recommendations.push('Configure company-level "Not Offered" default reply');
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // 3. CHECK DYNAMIC FLOW (MAJOR)
    // ═══════════════════════════════════════════════════════════════════════
    const dynamicFlow = providers.dynamicFlow?.data;
    if (dynamicFlow && providers.dynamicFlow.enabled) {
        // Enabled but zero flows
        if (dynamicFlow.flowsEnabled === 0 && dynamicFlow.flowsTotal > 0) {
            penalties.push({
                code: 'DYFLOW_ENABLED_ZERO',
                severity: 'RED',
                weight: PENALTY_CODES.DYFLOW_ENABLED_ZERO.weight,
                message: 'Dynamic Flow has flows but none are enabled'
            });
            score -= PENALTY_CODES.DYFLOW_ENABLED_ZERO.weight;
            hasRedPenalty = true;
            recommendations.push('Enable at least one dynamic flow or disable the feature');
        }
        
        // Duplicate flowKeys
        if (dynamicFlow.duplicateFlowKeys?.length > 0) {
            penalties.push({
                code: 'DUPLICATE_FLOWKEYS',
                severity: 'YELLOW',
                weight: PENALTY_CODES.DUPLICATE_FLOWKEYS.weight,
                message: `Duplicate flowKeys: ${dynamicFlow.duplicateFlowKeys.join(', ')}`
            });
            score -= PENALTY_CODES.DUPLICATE_FLOWKEYS.weight;
            recommendations.push(`Resolve duplicate flowKeys: ${dynamicFlow.duplicateFlowKeys.join(', ')}`);
        }
        
        // Priority order invalid
        if (!dynamicFlow.priorityOrderValid) {
            penalties.push({
                code: 'PRIORITY_ORDER_INVALID',
                severity: 'YELLOW',
                weight: PENALTY_CODES.PRIORITY_ORDER_INVALID.weight,
                message: 'Dynamic flows have duplicate priorities (tie risk)'
            });
            score -= PENALTY_CODES.PRIORITY_ORDER_INVALID.weight;
            recommendations.push('Assign unique priorities to all dynamic flows');
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // 4. CHECK PLACEHOLDERS (MAJOR)
    // ═══════════════════════════════════════════════════════════════════════
    const placeholders = providers.placeholders?.data;
    if (placeholders) {
        // Missing critical placeholders (cap at -45)
        const missingCritical = placeholders.missingCritical || [];
        if (missingCritical.length > 0) {
            const penalty = Math.min(missingCritical.length * PENALTY_CODES.PLACEHOLDER_CRITICAL_MISSING.weight, 45);
            penalties.push({
                code: 'PLACEHOLDER_CRITICAL_MISSING',
                severity: 'YELLOW',
                weight: penalty,
                message: `Missing critical placeholders: ${missingCritical.join(', ')}`
            });
            score -= penalty;
            recommendations.push(`Add critical placeholders: ${missingCritical.join(', ')}`);
        }
        
        // Missing optional placeholders (cap at -10)
        const missingOptional = placeholders.missingOptional || [];
        if (missingOptional.length > 0) {
            const penalty = Math.min(missingOptional.length * PENALTY_CODES.PLACEHOLDER_OPTIONAL_MISSING.weight, 10);
            penalties.push({
                code: 'PLACEHOLDER_OPTIONAL_MISSING',
                severity: 'GREEN',
                weight: penalty,
                message: `Missing optional placeholders: ${missingOptional.join(', ')}`
            });
            score -= penalty;
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // 5. CHECK RUNTIME BINDINGS (CRITICAL)
    // ═══════════════════════════════════════════════════════════════════════
    const runtime = providers.runtimeBindings?.data;
    if (runtime) {
        const wiring = runtime.wiringChecks || {};
        
        if (!wiring.intelligentRouterWired) {
            penalties.push({
                code: 'CROSS_TENANT_RISK',
                severity: 'RED',
                weight: 20,
                message: 'IntelligentRouter not wired - calls may not be handled'
            });
            score -= 20;
            hasRedPenalty = true;
            recommendations.push('Wire IntelligentRouter.route to call handlers');
        }
        
        if (!wiring.overrideResolverWired && scenarioBrain?.summary?.scenariosDisabled > 0) {
            penalties.push({
                code: 'OVERRIDES_NOT_ENFORCED',
                severity: 'RED',
                weight: PENALTY_CODES.OVERRIDES_NOT_ENFORCED.weight,
                message: 'OverrideResolver not wired but scenarios are disabled - LLM will guess'
            });
            score -= PENALTY_CODES.OVERRIDES_NOT_ENFORCED.weight;
            hasRedPenalty = true;
            recommendations.push('Wire OverrideResolver for deterministic disabled handling');
        }
        
        // LLM fallback rate check (if stats available)
        const stats = runtime.lastCallStats || {};
        if (stats.llmFallbackRate !== null && stats.llmFallbackRate !== undefined) {
            if (stats.llmFallbackRate > 0.40) {
                penalties.push({
                    code: 'LLM_FALLBACK_HIGH_40',
                    severity: 'YELLOW',
                    weight: PENALTY_CODES.LLM_FALLBACK_HIGH_40.weight,
                    message: `LLM fallback rate ${(stats.llmFallbackRate * 100).toFixed(0)}% (>40%) - scenario brain failing`
                });
                score -= PENALTY_CODES.LLM_FALLBACK_HIGH_40.weight;
            } else if (stats.llmFallbackRate > 0.25) {
                penalties.push({
                    code: 'LLM_FALLBACK_HIGH_25',
                    severity: 'YELLOW',
                    weight: PENALTY_CODES.LLM_FALLBACK_HIGH_25.weight,
                    message: `LLM fallback rate ${(stats.llmFallbackRate * 100).toFixed(0)}% (>25%)`
                });
                score -= PENALTY_CODES.LLM_FALLBACK_HIGH_25.weight;
            } else if (stats.llmFallbackRate > 0.15) {
                penalties.push({
                    code: 'LLM_FALLBACK_HIGH_15',
                    severity: 'YELLOW',
                    weight: PENALTY_CODES.LLM_FALLBACK_HIGH_15.weight,
                    message: `LLM fallback rate ${(stats.llmFallbackRate * 100).toFixed(0)}% (>15%)`
                });
                score -= PENALTY_CODES.LLM_FALLBACK_HIGH_15.weight;
            }
        }
        
        // Response time check (if stats available)
        if (stats.avgResponseMs !== null && stats.avgResponseMs !== undefined) {
            if (stats.avgResponseMs > 4000) {
                penalties.push({
                    code: 'RESPONSE_SLOW_4000',
                    severity: 'YELLOW',
                    weight: PENALTY_CODES.RESPONSE_SLOW_4000.weight,
                    message: `Average response ${stats.avgResponseMs}ms (>4000ms)`
                });
                score -= PENALTY_CODES.RESPONSE_SLOW_4000.weight;
            } else if (stats.avgResponseMs > 2500) {
                penalties.push({
                    code: 'RESPONSE_SLOW_2500',
                    severity: 'YELLOW',
                    weight: PENALTY_CODES.RESPONSE_SLOW_2500.weight,
                    message: `Average response ${stats.avgResponseMs}ms (>2500ms)`
                });
                score -= PENALTY_CODES.RESPONSE_SLOW_2500.weight;
            } else if (stats.avgResponseMs > 1500) {
                penalties.push({
                    code: 'RESPONSE_SLOW_1500',
                    severity: 'YELLOW',
                    weight: PENALTY_CODES.RESPONSE_SLOW_1500.weight,
                    message: `Average response ${stats.avgResponseMs}ms (>1500ms)`
                });
                score -= PENALTY_CODES.RESPONSE_SLOW_1500.weight;
            }
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // 6. PROCESS PROVIDER WARNINGS (December 2025 Directive)
    // Each provider can emit warnings that should become penalties
    // ═══════════════════════════════════════════════════════════════════════

    // ═══════════════════════════════════════════════════════════════════════
    // 6a. RUNTIME-BLOCKING GOVERNANCE RULES (Evidence-based)
    // Platform Snapshot must NEVER show GREEN while runtime is blocked.
    // ═══════════════════════════════════════════════════════════════════════
    const consentSnapshot = providers.controlPlane?.data?.frontDesk?.discoveryConsent;
    if (consentSnapshot?.disableScenarioAutoResponses === true) {
        penalties.push({
            code: 'CONSENT_SCENARIO_AUTOREPLIES_BLOCKED',
            severity: 'YELLOW',
            weight: PENALTY_CODES.CONSENT_SCENARIO_AUTOREPLIES_BLOCKED.weight,
            message: 'Consent kill-switch enabled: scenarios will NOT auto-reply (runtime blocked until consent)',
            sourcePaths: [
                'aiAgentSettings.frontDeskBehavior.discoveryConsent.disableScenarioAutoResponses'
            ]
        });
        score -= PENALTY_CODES.CONSENT_SCENARIO_AUTOREPLIES_BLOCKED.weight;
        recommendations.push('Disable discoveryConsent.disableScenarioAutoResponses (keep bookingRequiresExplicitConsent ON)');
    }

    const unknownTypeCount = providers.scenarioBrain?.data?.summary?.unknownScenarioTypeCount || 0;
    if (unknownTypeCount > 0) {
        penalties.push({
            code: 'SCENARIO_UNKNOWN_TYPE_ENABLED',
            severity: 'YELLOW',
            weight: PENALTY_CODES.SCENARIO_UNKNOWN_TYPE_ENABLED.weight,
            message: `${unknownTypeCount} enabled scenarios have scenarioType=UNKNOWN (routing blocked)`,
            sourcePaths: [
                'templates[].categories[].scenarios[].scenarioType'
            ],
            examples: providers.scenarioBrain?.data?.summary?.unknownScenarioTypeExamples || []
        });
        score -= PENALTY_CODES.SCENARIO_UNKNOWN_TYPE_ENABLED.weight;
        recommendations.push('Fix UNKNOWN scenarios: set scenarioType to BOOKING|EMERGENCY|TROUBLESHOOT|FAQ');
    }
    
    // Control Plane warnings
    const controlPlane = providers.controlPlane;
    if (controlPlane?.warnings?.length > 0) {
        controlPlane.warnings.forEach(warning => {
            if (warning.includes('No greeting configured')) {
                penalties.push({
                    code: 'NO_GREETING_CONFIGURED',
                    severity: 'YELLOW',
                    weight: PENALTY_CODES.NO_GREETING_CONFIGURED.weight,
                    message: warning
                });
                score -= PENALTY_CODES.NO_GREETING_CONFIGURED.weight;
                recommendations.push('Configure a greeting in Front Desk settings');
            } else if (warning.includes('Booking enabled but no slots')) {
                penalties.push({
                    code: 'BOOKING_ENABLED_NO_SLOTS',
                    severity: 'YELLOW',
                    weight: PENALTY_CODES.BOOKING_ENABLED_NO_SLOTS.weight,
                    message: warning
                });
                score -= PENALTY_CODES.BOOKING_ENABLED_NO_SLOTS.weight;
                recommendations.push('Configure booking slots or disable booking');
            }
        });
    }
    
    // Call Protection warnings (invalid enabled rules)
    const callProtection = providers.callProtection;
    if (callProtection?.warnings?.length > 0) {
        callProtection.warnings.forEach(warning => {
            if (warning.includes('invalid')) {
                penalties.push({
                    code: 'INVALID_CALL_PROTECTION_RULE',
                    severity: 'YELLOW',
                    weight: PENALTY_CODES.INVALID_CALL_PROTECTION_RULE.weight,
                    message: warning
                });
                score -= PENALTY_CODES.INVALID_CALL_PROTECTION_RULE.weight;
                recommendations.push('Fix or disable invalid call protection rules');
            }
        });
    }
    
    // Dynamic Flow warnings (invalid enabled flows)
    if (dynamicFlow && providers.dynamicFlow?.warnings?.length > 0) {
        providers.dynamicFlow.warnings.forEach(warning => {
            if (warning.includes('invalid') || warning.includes('0 trigger phrases')) {
                penalties.push({
                    code: 'INVALID_DYNAMIC_FLOW',
                    severity: 'YELLOW',
                    weight: PENALTY_CODES.INVALID_DYNAMIC_FLOW.weight,
                    message: warning
                });
                score -= PENALTY_CODES.INVALID_DYNAMIC_FLOW.weight;
                recommendations.push('Fix or disable invalid dynamic flows');
            }
        });
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // 7. COMPUTE FINAL STATUS (December 2025 - Fixed logic)
    // ═══════════════════════════════════════════════════════════════════════
    
    // Enforce score bounds
    score = Math.max(0, Math.min(100, score));
    
    // If any RED penalty, cap at 49
    if (hasRedPenalty) {
        score = Math.min(score, 49);
    }
    
    // Determine grade (based on score)
    let grade;
    if (score >= 90) grade = 'A';
    else if (score >= 80) grade = 'B';
    else if (score >= 70) grade = 'C';
    else if (score >= 50) grade = 'D';
    else grade = 'F';
    
    // ═══════════════════════════════════════════════════════════════════════
    // STATUS LOGIC (LOCKED - December 2025)
    // Status is determined by PENALTY SEVERITY, not score alone
    // This prevents "RED status with only YELLOW penalties" confusion
    // ═══════════════════════════════════════════════════════════════════════
    const hasYellowPenalty = penalties.some(p => p.severity === 'YELLOW');
    
    let status;
    if (hasRedPenalty) {
        // Any RED penalty → status = RED (critical issues)
        status = 'RED';
    } else if (hasYellowPenalty) {
        // Any YELLOW penalty → status = YELLOW (warnings)
        status = 'YELLOW';
    } else {
        // Only GREEN/no penalties → status = GREEN
        status = 'GREEN';
    }
    
    // Build summary based on actual penalties
    const redCount = penalties.filter(p => p.severity === 'RED').length;
    const yellowCount = penalties.filter(p => p.severity === 'YELLOW').length;
    const greenCount = penalties.filter(p => p.severity === 'GREEN').length;
    
    let summary;
    if (status === 'GREEN') {
        if (greenCount > 0) {
            summary = `Production-ready with ${greenCount} minor suggestion${greenCount > 1 ? 's' : ''}`;
        } else {
            summary = 'Platform is production-ready';
        }
    } else if (status === 'YELLOW') {
        summary = `${yellowCount} warning${yellowCount > 1 ? 's' : ''} found`;
    } else {
        summary = `${redCount} critical issue${redCount > 1 ? 's' : ''} blocking production`;
    }
    
    // Add top issues to summary (show actual message, not just prefix)
    const topIssues = penalties
        .filter(p => p.severity === 'RED' || p.severity === 'YELLOW')
        .slice(0, 3)
        .map(p => p.message)
        .join('; ');
    
    if (topIssues) {
        summary += ` — ${topIssues}`;
    }
    
    return {
        scope,
        score,
        status,
        grade,
        summary,
        penalties: penalties.sort((a, b) => {
            const severityOrder = { RED: 0, YELLOW: 1, GREEN: 2 };
            return (severityOrder[a.severity] - severityOrder[b.severity]) || (b.weight - a.weight);
        }),
        recommendations: [...new Set(recommendations)], // Deduplicate
        readinessLevel: getReadinessLevel(score, status),
        requiredProviders: requiredForScope,
        providersChecked: Object.keys(providers)
    };
}

/**
 * Get readiness level description
 * Now accepts status to ensure consistency
 */
function getReadinessLevel(score, status) {
    // Status-based readiness (primary)
    if (status === 'RED') return 'NOT_PRODUCTION_SAFE';
    if (status === 'YELLOW') return 'WORKS_NEEDS_CLEANUP';
    
    // Score-based refinement for GREEN status
    if (score >= 95) return 'ELITE - Set-and-forget';
    if (score >= 90) return 'PRODUCTION_READY';
    return 'PRODUCTION_READY'; // GREEN status but score < 90 (shouldn't happen)
}

module.exports = {
    computeCompleteness,
    PENALTY_CODES
};

