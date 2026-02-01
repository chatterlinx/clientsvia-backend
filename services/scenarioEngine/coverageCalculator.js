/**
 * ============================================================================
 * SCENARIO COVERAGE CALCULATOR - Feb 2026
 * ============================================================================
 * 
 * PURPOSE:
 * Calculate scenario coverage per service to drive the Scenario Engine.
 * Determines what's missing, what needs work, what's been supervised.
 * 
 * COVERAGE TARGETS BY SERVICE TYPE:
 * - WORK services: 20 scenarios (FAQ, Booking, Troubleshoot, Emergency, Edge)
 * - SYMPTOM services: 5 scenarios (Triage routing, Clarifying questions)
 * - ADMIN services: 2 scenarios (Deterministic responses)
 * 
 * ============================================================================
 */

const logger = require('../../utils/logger');

/**
 * Coverage targets by service type
 */
const COVERAGE_TARGETS = {
    work: {
        total: 20,
        breakdown: {
            faq: 4,
            booking: 4,
            troubleshoot: 6,
            emergency: 2,
            edge_cases: 4
        }
    },
    symptom: {
        total: 5,
        breakdown: {
            triage_routing: 3,
            clarifying: 2
        }
    },
    admin: {
        total: 2,
        breakdown: {
            deterministic: 2
        }
    }
};

/**
 * Status thresholds
 */
const STATUS_THRESHOLDS = {
    HEALTHY_PERCENT: 90,      // 90%+ coverage = healthy
    WARNING_PERCENT: 50,      // 50-89% = warning
    CRITICAL_PERCENT: 0       // <50% = critical
};

/**
 * Get coverage target for a service type
 */
function getCoverageTarget(serviceType) {
    const type = (serviceType || 'work').toLowerCase();
    return COVERAGE_TARGETS[type] || COVERAGE_TARGETS.work;
}

/**
 * Calculate coverage for a single service
 * @param {Object} service - Service from switchboard
 * @param {Array} scenarios - All scenarios for the template
 * @param {Array} auditResults - Deep audit results (optional)
 * @returns {Object} Coverage stats for this service
 */
function calculateServiceCoverage(service, scenarios, auditResults = []) {
    const serviceKey = service.serviceKey;
    const serviceType = (service.serviceType || 'work').toLowerCase();
    const target = getCoverageTarget(serviceType);
    
    // Find scenarios for this service
    // Match by serviceKey, category, or keywords
    const serviceScenarios = scenarios.filter(s => {
        // Direct serviceKey match
        if (s.serviceKey === serviceKey) return true;
        
        // Category match (fuzzy)
        const scenarioCategory = (s.category || '').toLowerCase();
        const serviceCategory = (service.category || '').toLowerCase();
        const displayName = (service.displayName || '').toLowerCase();
        
        // Check if scenario category contains service info
        if (scenarioCategory.includes(serviceKey.replace(/_/g, ' '))) return true;
        if (scenarioCategory.includes(displayName)) return true;
        
        // Check triggers/keywords overlap
        const servicekeywords = (service.intentKeywords || []).map(k => k.toLowerCase());
        const scenarioTriggers = (s.triggers || []).map(t => t.toLowerCase());
        
        const hasKeywordOverlap = servicekeywords.some(kw => 
            scenarioTriggers.some(t => t.includes(kw) || kw.includes(t))
        );
        
        return hasKeywordOverlap;
    });
    
    const existingCount = serviceScenarios.length;
    const gap = Math.max(0, target.total - existingCount);
    const coveragePercent = target.total > 0 ? Math.round((existingCount / target.total) * 100) : 100;
    
    // Find audit results for these scenarios
    const auditedScenarios = serviceScenarios.filter(s => {
        const auditResult = auditResults.find(a => 
            a.scenarioId === s._id?.toString() || 
            a.scenarioName === s.scenarioName
        );
        return auditResult && auditResult.overallScore !== undefined;
    });
    
    const supervisedCount = auditedScenarios.length;
    const supervisedPercent = existingCount > 0 ? Math.round((supervisedCount / existingCount) * 100) : 0;
    
    // Calculate average audit score
    let avgAuditScore = null;
    if (auditedScenarios.length > 0) {
        const scores = auditedScenarios.map(s => {
            const audit = auditResults.find(a => 
                a.scenarioId === s._id?.toString() || 
                a.scenarioName === s.scenarioName
            );
            return audit?.overallScore || 0;
        });
        avgAuditScore = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
    }
    
    // Determine status
    let status = 'healthy';
    let statusIcon = '🟢';
    
    if (gap > 0) {
        if (coveragePercent >= STATUS_THRESHOLDS.WARNING_PERCENT) {
            status = 'warning';
            statusIcon = '🟡';
        } else {
            status = 'critical';
            statusIcon = '🔴';
        }
    }
    
    // Determine supervision level
    let supervisionLevel = 'none';
    let supervisionIcon = '';
    
    if (supervisedPercent >= 90 && avgAuditScore >= 7) {
        supervisionLevel = 'full';
        supervisionIcon = '✓✓';
    } else if (supervisedPercent > 0) {
        supervisionLevel = 'partial';
        supervisionIcon = '✓';
    }
    
    return {
        serviceKey,
        displayName: service.displayName,
        serviceType,
        category: service.category || 'General',
        enabled: service.enabled,
        
        // Coverage stats
        target: target.total,
        existing: existingCount,
        gap,
        coveragePercent,
        
        // Status
        status,
        statusIcon,
        
        // Supervision (Deep Audit)
        supervisedCount,
        supervisedPercent,
        avgAuditScore,
        supervisionLevel,
        supervisionIcon,
        
        // Scenario details
        scenarios: serviceScenarios.map(s => ({
            scenarioId: s._id?.toString(),
            scenarioName: s.scenarioName,
            scenarioType: s.scenarioType,
            category: s.category
        }))
    };
}

/**
 * Calculate coverage for all services in a template
 * @param {Array} services - Services from switchboard
 * @param {Array} scenarios - All scenarios for the template
 * @param {Array} auditResults - Deep audit results (optional)
 * @returns {Object} Full coverage report
 */
function calculateTemplateCoverage(services, scenarios, auditResults = []) {
    const enabledServices = services.filter(s => s.enabled);
    
    // Calculate coverage for each service
    const serviceCoverage = enabledServices.map(service => 
        calculateServiceCoverage(service, scenarios, auditResults)
    );
    
    // Sort by gap (highest first), then by service type
    serviceCoverage.sort((a, b) => {
        // Sort by service type first (work > symptom > admin)
        const typeOrder = { work: 0, symptom: 1, admin: 2 };
        const typeA = typeOrder[a.serviceType] || 0;
        const typeB = typeOrder[b.serviceType] || 0;
        if (typeA !== typeB) return typeA - typeB;
        
        // Then by gap (highest first)
        return b.gap - a.gap;
    });
    
    // Calculate totals
    const totals = serviceCoverage.reduce((acc, s) => {
        acc.targetTotal += s.target;
        acc.existingTotal += s.existing;
        acc.gapTotal += s.gap;
        acc.supervisedTotal += s.supervisedCount;
        
        if (s.status === 'healthy') acc.healthyCount++;
        else if (s.status === 'warning') acc.warningCount++;
        else acc.criticalCount++;
        
        if (s.supervisionLevel === 'full') acc.fullySupervisedCount++;
        else if (s.supervisionLevel === 'partial') acc.partiallySupervisedCount++;
        
        return acc;
    }, {
        targetTotal: 0,
        existingTotal: 0,
        gapTotal: 0,
        supervisedTotal: 0,
        healthyCount: 0,
        warningCount: 0,
        criticalCount: 0,
        fullySupervisedCount: 0,
        partiallySupervisedCount: 0
    });
    
    totals.overallCoveragePercent = totals.targetTotal > 0 
        ? Math.round((totals.existingTotal / totals.targetTotal) * 100) 
        : 100;
    
    totals.overallSupervisionPercent = totals.existingTotal > 0
        ? Math.round((totals.supervisedTotal / totals.existingTotal) * 100)
        : 0;
    
    // Group by service type
    const byType = {
        work: serviceCoverage.filter(s => s.serviceType === 'work'),
        symptom: serviceCoverage.filter(s => s.serviceType === 'symptom'),
        admin: serviceCoverage.filter(s => s.serviceType === 'admin')
    };
    
    // Type summaries
    const typeSummaries = {};
    for (const [type, services] of Object.entries(byType)) {
        typeSummaries[type] = {
            count: services.length,
            target: services.reduce((a, s) => a + s.target, 0),
            existing: services.reduce((a, s) => a + s.existing, 0),
            gap: services.reduce((a, s) => a + s.gap, 0),
            healthyCount: services.filter(s => s.status === 'healthy').length
        };
    }
    
    return {
        generatedAt: new Date().toISOString(),
        
        // Summary stats
        summary: {
            totalServices: enabledServices.length,
            ...totals
        },
        
        // By type
        typeSummaries,
        
        // Coverage targets reference
        coverageTargets: COVERAGE_TARGETS,
        
        // Detailed coverage per service
        services: serviceCoverage,
        
        // Services needing work (for engine queue)
        needsWork: serviceCoverage.filter(s => s.gap > 0).map(s => ({
            serviceKey: s.serviceKey,
            displayName: s.displayName,
            serviceType: s.serviceType,
            gap: s.gap,
            priority: s.gap // Higher gap = higher priority
        }))
    };
}

/**
 * Get services that need scenario generation (for engine queue)
 * @param {Object} coverageReport - Full coverage report
 * @param {number} limit - Max services to return
 * @returns {Array} Services needing generation, sorted by priority
 */
function getGenerationQueue(coverageReport, limit = 10) {
    return coverageReport.needsWork
        .sort((a, b) => b.priority - a.priority)
        .slice(0, limit);
}

module.exports = {
    COVERAGE_TARGETS,
    STATUS_THRESHOLDS,
    getCoverageTarget,
    calculateServiceCoverage,
    calculateTemplateCoverage,
    getGenerationQueue
};
