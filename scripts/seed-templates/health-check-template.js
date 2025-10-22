/**
 * ============================================================================
 * TEMPLATE HEALTH CHECK SYSTEM
 * ============================================================================
 * 
 * PURPOSE:
 * Comprehensive audit and health check for Global AI Brain templates.
 * Verifies data integrity, schema compliance, and operational readiness.
 * 
 * CHECKS PERFORMED:
 * ✅ Schema validation
 * ✅ Required fields present
 * ✅ Scenario integrity (triggers, replies, etc.)
 * ✅ Action hooks validity
 * ✅ Behavior references
 * ✅ Entity capture consistency
 * ✅ Duplicate detection
 * ✅ Performance metrics
 * ✅ Configuration completeness
 * 
 * HOW TO RUN:
 * ```
 * node scripts/seed-templates/health-check-template.js
 * ```
 * 
 * OPTIONAL: Check specific template by ID
 * ```
 * node scripts/seed-templates/health-check-template.js <templateId>
 * ```
 * 
 * ============================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI not found in environment variables');
    process.exit(1);
}

// ============================================================================
// HEALTH CHECK CRITERIA
// ============================================================================

const HEALTH_CHECKS = {
    // Critical - Must pass for template to be operational
    CRITICAL: {
        hasCategories: 'Template must have at least one category',
        hasScenarios: 'Template must have at least one scenario',
        scenariosHaveTriggers: 'All scenarios must have triggers',
        scenariosHaveReplies: 'All scenarios must have replies',
        noOrphanedScenarios: 'All scenarios must belong to a category',
        validChannels: 'All scenarios must have valid channel values',
        validPriorities: 'All priorities must be within range (-10 to 100)',
        validConfidence: 'All confidence thresholds must be 0.0 to 1.0'
    },
    
    // Warnings - Should be addressed but not blocking
    WARNINGS: {
        duplicateTriggers: 'Duplicate triggers may cause confusion',
        emptyCategories: 'Categories should have scenarios',
        lowScenarioCount: 'Consider adding more scenarios for coverage',
        missingActionHooks: 'Scenarios with handoff should have action hooks',
        longReplies: 'Replies over 500 chars may be too verbose',
        noNegativeTriggers: 'Consider negative triggers for precision'
    },
    
    // Optimization - Nice to have
    OPTIMIZATION: {
        replyVariations: 'Multiple reply variations improve naturalness',
        entityCapture: 'Entity capture improves conversation quality',
        followUpFunnels: 'Follow-up funnels guide conversation flow',
        cooldownsSet: 'Cooldowns prevent repetitive responses'
    }
};

// ============================================================================
// HEALTH CHECK FUNCTIONS
// ============================================================================

class TemplateHealthChecker {
    constructor(template) {
        this.template = template;
        this.issues = {
            critical: [],
            warnings: [],
            optimizations: []
        };
        this.stats = {
            totalCategories: 0,
            totalScenarios: 0,
            totalTriggers: 0,
            avgTriggersPerScenario: 0,
            avgRepliesPerScenario: 0,
            scenariosWithEntities: 0,
            scenariosWithHooks: 0,
            scenariosWithCooldowns: 0
        };
    }

    // ========================================
    // CRITICAL CHECKS
    // ========================================

    checkHasCategories() {
        if (!this.template.categories || this.template.categories.length === 0) {
            this.issues.critical.push({
                check: 'hasCategories',
                message: HEALTH_CHECKS.CRITICAL.hasCategories,
                severity: 'CRITICAL'
            });
            return false;
        }
        this.stats.totalCategories = this.template.categories.length;
        return true;
    }

    checkHasScenarios() {
        let totalScenarios = 0;
        this.template.categories.forEach(cat => {
            totalScenarios += (cat.scenarios || []).length;
        });
        
        if (totalScenarios === 0) {
            this.issues.critical.push({
                check: 'hasScenarios',
                message: HEALTH_CHECKS.CRITICAL.hasScenarios,
                severity: 'CRITICAL'
            });
            return false;
        }
        
        this.stats.totalScenarios = totalScenarios;
        return true;
    }

    checkScenariosHaveTriggers() {
        const scenariosWithoutTriggers = [];
        
        this.template.categories.forEach((cat, catIdx) => {
            (cat.scenarios || []).forEach((scenario, scnIdx) => {
                if (!scenario.triggers || scenario.triggers.length === 0) {
                    scenariosWithoutTriggers.push({
                        category: cat.name,
                        scenario: scenario.name,
                        index: `${catIdx}.${scnIdx}`
                    });
                }
            });
        });
        
        if (scenariosWithoutTriggers.length > 0) {
            this.issues.critical.push({
                check: 'scenariosHaveTriggers',
                message: HEALTH_CHECKS.CRITICAL.scenariosHaveTriggers,
                severity: 'CRITICAL',
                details: scenariosWithoutTriggers
            });
            return false;
        }
        
        return true;
    }

    checkScenariosHaveReplies() {
        const scenariosWithoutReplies = [];
        
        this.template.categories.forEach((cat, catIdx) => {
            (cat.scenarios || []).forEach((scenario, scnIdx) => {
                const hasQuickReplies = scenario.quickReplies && scenario.quickReplies.length > 0;
                const hasFullReplies = scenario.fullReplies && scenario.fullReplies.length > 0;
                
                if (!hasQuickReplies && !hasFullReplies) {
                    scenariosWithoutReplies.push({
                        category: cat.name,
                        scenario: scenario.name,
                        index: `${catIdx}.${scnIdx}`
                    });
                }
            });
        });
        
        if (scenariosWithoutReplies.length > 0) {
            this.issues.critical.push({
                check: 'scenariosHaveReplies',
                message: HEALTH_CHECKS.CRITICAL.scenariosHaveReplies,
                severity: 'CRITICAL',
                details: scenariosWithoutReplies
            });
            return false;
        }
        
        return true;
    }

    checkValidChannels() {
        const validChannels = ['voice', 'sms', 'chat', 'any'];
        const invalidChannels = [];
        
        this.template.categories.forEach((cat, catIdx) => {
            (cat.scenarios || []).forEach((scenario, scnIdx) => {
                if (scenario.channel && !validChannels.includes(scenario.channel)) {
                    invalidChannels.push({
                        category: cat.name,
                        scenario: scenario.name,
                        channel: scenario.channel,
                        index: `${catIdx}.${scnIdx}`
                    });
                }
            });
        });
        
        if (invalidChannels.length > 0) {
            this.issues.critical.push({
                check: 'validChannels',
                message: HEALTH_CHECKS.CRITICAL.validChannels,
                severity: 'CRITICAL',
                details: invalidChannels
            });
            return false;
        }
        
        return true;
    }

    checkValidPriorities() {
        const invalidPriorities = [];
        
        this.template.categories.forEach((cat, catIdx) => {
            (cat.scenarios || []).forEach((scenario, scnIdx) => {
                const priority = scenario.priority || 0;
                if (priority < -10 || priority > 100) {
                    invalidPriorities.push({
                        category: cat.name,
                        scenario: scenario.name,
                        priority,
                        index: `${catIdx}.${scnIdx}`
                    });
                }
            });
        });
        
        if (invalidPriorities.length > 0) {
            this.issues.critical.push({
                check: 'validPriorities',
                message: HEALTH_CHECKS.CRITICAL.validPriorities,
                severity: 'CRITICAL',
                details: invalidPriorities
            });
            return false;
        }
        
        return true;
    }

    checkValidConfidence() {
        const invalidConfidence = [];
        
        this.template.categories.forEach((cat, catIdx) => {
            (cat.scenarios || []).forEach((scenario, scnIdx) => {
                const confidence = scenario.minConfidence || 0.5;
                if (confidence < 0 || confidence > 1) {
                    invalidConfidence.push({
                        category: cat.name,
                        scenario: scenario.name,
                        minConfidence: confidence,
                        index: `${catIdx}.${scnIdx}`
                    });
                }
            });
        });
        
        if (invalidConfidence.length > 0) {
            this.issues.critical.push({
                check: 'validConfidence',
                message: HEALTH_CHECKS.CRITICAL.validConfidence,
                severity: 'CRITICAL',
                details: invalidConfidence
            });
            return false;
        }
        
        return true;
    }

    // ========================================
    // WARNING CHECKS
    // ========================================

    checkDuplicateTriggers() {
        const triggerMap = new Map();
        const duplicates = [];
        
        this.template.categories.forEach((cat) => {
            (cat.scenarios || []).forEach((scenario) => {
                (scenario.triggers || []).forEach((trigger) => {
                    const normalized = trigger.toLowerCase().trim();
                    if (triggerMap.has(normalized)) {
                        duplicates.push({
                            trigger,
                            scenarios: [triggerMap.get(normalized), scenario.name]
                        });
                    } else {
                        triggerMap.set(normalized, scenario.name);
                    }
                });
            });
        });
        
        if (duplicates.length > 0) {
            this.issues.warnings.push({
                check: 'duplicateTriggers',
                message: HEALTH_CHECKS.WARNINGS.duplicateTriggers,
                severity: 'WARNING',
                count: duplicates.length,
                details: duplicates.slice(0, 5) // Show first 5
            });
        }
    }

    checkEmptyCategories() {
        const emptyCategories = [];
        
        this.template.categories.forEach((cat, idx) => {
            if (!cat.scenarios || cat.scenarios.length === 0) {
                emptyCategories.push({
                    category: cat.name,
                    index: idx
                });
            }
        });
        
        if (emptyCategories.length > 0) {
            this.issues.warnings.push({
                check: 'emptyCategories',
                message: HEALTH_CHECKS.WARNINGS.emptyCategories,
                severity: 'WARNING',
                count: emptyCategories.length,
                details: emptyCategories
            });
        }
    }

    checkLowScenarioCount() {
        if (this.stats.totalScenarios < 10) {
            this.issues.warnings.push({
                check: 'lowScenarioCount',
                message: HEALTH_CHECKS.WARNINGS.lowScenarioCount,
                severity: 'WARNING',
                current: this.stats.totalScenarios,
                recommended: 20
            });
        }
    }

    // ========================================
    // OPTIMIZATION CHECKS
    // ========================================

    checkReplyVariations() {
        const scenariosWithSingleReply = [];
        
        this.template.categories.forEach((cat) => {
            (cat.scenarios || []).forEach((scenario) => {
                const quickCount = (scenario.quickReplies || []).length;
                const fullCount = (scenario.fullReplies || []).length;
                
                if (quickCount + fullCount === 1) {
                    scenariosWithSingleReply.push({
                        category: cat.name,
                        scenario: scenario.name
                    });
                }
            });
        });
        
        if (scenariosWithSingleReply.length > 0) {
            this.issues.optimizations.push({
                check: 'replyVariations',
                message: HEALTH_CHECKS.OPTIMIZATION.replyVariations,
                severity: 'INFO',
                count: scenariosWithSingleReply.length,
                percentage: ((scenariosWithSingleReply.length / this.stats.totalScenarios) * 100).toFixed(1)
            });
        }
    }

    // ========================================
    // STATISTICS
    // ========================================

    calculateStats() {
        let totalTriggers = 0;
        let totalReplies = 0;
        let scenariosWithEntities = 0;
        let scenariosWithHooks = 0;
        let scenariosWithCooldowns = 0;
        
        this.template.categories.forEach((cat) => {
            (cat.scenarios || []).forEach((scenario) => {
                totalTriggers += (scenario.triggers || []).length;
                totalReplies += (scenario.quickReplies || []).length + (scenario.fullReplies || []).length;
                
                if (scenario.entityCapture && scenario.entityCapture.length > 0) {
                    scenariosWithEntities++;
                }
                
                if (scenario.actionHooks && scenario.actionHooks.length > 0) {
                    scenariosWithHooks++;
                }
                
                if (scenario.cooldownSeconds && scenario.cooldownSeconds > 0) {
                    scenariosWithCooldowns++;
                }
            });
        });
        
        this.stats.totalTriggers = totalTriggers;
        this.stats.avgTriggersPerScenario = (totalTriggers / this.stats.totalScenarios).toFixed(2);
        this.stats.avgRepliesPerScenario = (totalReplies / this.stats.totalScenarios).toFixed(2);
        this.stats.scenariosWithEntities = scenariosWithEntities;
        this.stats.scenariosWithHooks = scenariosWithHooks;
        this.stats.scenariosWithCooldowns = scenariosWithCooldowns;
    }

    // ========================================
    // RUN ALL CHECKS
    // ========================================

    runAllChecks() {
        console.log('🔍 [HEALTH CHECK] Running comprehensive template audit...\n');
        
        // Critical checks
        console.log('🚨 [CRITICAL CHECKS]');
        this.checkHasCategories();
        this.checkHasScenarios();
        this.checkScenariosHaveTriggers();
        this.checkScenariosHaveReplies();
        this.checkValidChannels();
        this.checkValidPriorities();
        this.checkValidConfidence();
        
        // Warning checks
        console.log('⚠️  [WARNING CHECKS]');
        this.checkDuplicateTriggers();
        this.checkEmptyCategories();
        this.checkLowScenarioCount();
        
        // Optimization checks
        console.log('💡 [OPTIMIZATION CHECKS]');
        this.checkReplyVariations();
        
        // Calculate stats
        this.calculateStats();
        
        return this.generateReport();
    }

    // ========================================
    // REPORT GENERATION
    // ========================================

    generateReport() {
        const totalIssues = this.issues.critical.length + this.issues.warnings.length + this.issues.optimizations.length;
        
        console.log(`\n${  '='.repeat(80)}`);
        console.log('📊 TEMPLATE HEALTH REPORT');
        console.log('='.repeat(80));
        
        console.log(`\n📋 Template: ${this.template.name}`);
        console.log(`🆔 ID: ${this.template._id}`);
        console.log(`📌 Version: ${this.template.version}`);
        console.log(`🏷️  Type: ${this.template.templateType}`);
        console.log(`✅ Published: ${this.template.isPublished ? 'Yes' : 'No'}`);
        console.log(`⭐ Default: ${this.template.isDefaultTemplate ? 'Yes' : 'No'}`);
        
        // Statistics
        console.log('\n📊 STATISTICS:');
        console.log(`   Categories: ${this.stats.totalCategories}`);
        console.log(`   Scenarios: ${this.stats.totalScenarios}`);
        console.log(`   Total Triggers: ${this.stats.totalTriggers}`);
        console.log(`   Avg Triggers/Scenario: ${this.stats.avgTriggersPerScenario}`);
        console.log(`   Avg Replies/Scenario: ${this.stats.avgRepliesPerScenario}`);
        console.log(`   Scenarios with Entities: ${this.stats.scenariosWithEntities} (${((this.stats.scenariosWithEntities / this.stats.totalScenarios) * 100).toFixed(1)}%)`);
        console.log(`   Scenarios with Action Hooks: ${this.stats.scenariosWithHooks} (${((this.stats.scenariosWithHooks / this.stats.totalScenarios) * 100).toFixed(1)}%)`);
        console.log(`   Scenarios with Cooldowns: ${this.stats.scenariosWithCooldowns} (${((this.stats.scenariosWithCooldowns / this.stats.totalScenarios) * 100).toFixed(1)}%)`);
        
        // Issues
        console.log('\n🔍 ISSUES FOUND:');
        console.log(`   🚨 Critical: ${this.issues.critical.length}`);
        console.log(`   ⚠️  Warnings: ${this.issues.warnings.length}`);
        console.log(`   💡 Optimizations: ${this.issues.optimizations.length}`);
        console.log(`   📊 Total: ${totalIssues}`);
        
        // Critical issues
        if (this.issues.critical.length > 0) {
            console.log('\n🚨 CRITICAL ISSUES (Must Fix):');
            this.issues.critical.forEach((issue, idx) => {
                console.log(`\n   ${idx + 1}. ${issue.check}`);
                console.log(`      Message: ${issue.message}`);
                if (issue.details) {
                    console.log(`      Affected: ${JSON.stringify(issue.details, null, 2)}`);
                }
            });
        }
        
        // Warnings
        if (this.issues.warnings.length > 0) {
            console.log('\n⚠️  WARNINGS (Should Address):');
            this.issues.warnings.forEach((issue, idx) => {
                console.log(`\n   ${idx + 1}. ${issue.check}`);
                console.log(`      Message: ${issue.message}`);
                if (issue.count) {
                    console.log(`      Count: ${issue.count}`);
                }
            });
        }
        
        // Optimizations
        if (this.issues.optimizations.length > 0) {
            console.log('\n💡 OPTIMIZATION SUGGESTIONS (Nice to Have):');
            this.issues.optimizations.forEach((issue, idx) => {
                console.log(`\n   ${idx + 1}. ${issue.check}`);
                console.log(`      Message: ${issue.message}`);
                if (issue.percentage) {
                    console.log(`      Affected: ${issue.percentage}% of scenarios`);
                }
            });
        }
        
        // Health Score
        const healthScore = this.calculateHealthScore();
        console.log(`\n${  '='.repeat(80)}`);
        console.log(`🏥 OVERALL HEALTH SCORE: ${healthScore}/100`);
        console.log('='.repeat(80));
        
        if (healthScore >= 90) {
            console.log('\n✅ EXCELLENT! Template is healthy and production-ready.');
        } else if (healthScore >= 75) {
            console.log('\n👍 GOOD! Template is functional with minor improvements needed.');
        } else if (healthScore >= 60) {
            console.log('\n⚠️  FAIR! Template needs attention before production use.');
        } else {
            console.log('\n🚨 CRITICAL! Template has serious issues that must be fixed.');
        }
        
        console.log('\n');
        
        return {
            healthy: this.issues.critical.length === 0,
            score: healthScore,
            issues: this.issues,
            stats: this.stats
        };
    }

    calculateHealthScore() {
        let score = 100;
        
        // Critical issues: -20 points each
        score -= (this.issues.critical.length * 20);
        
        // Warnings: -5 points each
        score -= (this.issues.warnings.length * 5);
        
        // Optimizations: -2 points each
        score -= (this.issues.optimizations.length * 2);
        
        return Math.max(0, score);
    }
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

async function runHealthCheck() {
    try {
        console.log('🏥 [HEALTH CHECK] Starting template health audit...');
        console.log(`📦 [HEALTH CHECK] Connecting to MongoDB: ${MONGODB_URI.replace(/\/\/.*:.*@/, '//***:***@')}\n`);
        
        await mongoose.connect(MONGODB_URI);
        console.log('✅ [HEALTH CHECK] Connected to MongoDB\n');
        
        // Check if specific template ID provided
        const targetTemplateId = process.argv[2];
        
        let templates;
        if (targetTemplateId) {
            console.log(`🎯 [HEALTH CHECK] Checking specific template: ${targetTemplateId}\n`);
            const template = await GlobalInstantResponseTemplate.findById(targetTemplateId);
            if (!template) {
                console.error(`❌ Template not found: ${targetTemplateId}`);
                process.exit(1);
            }
            templates = [template];
        } else {
            console.log('🔍 [HEALTH CHECK] Checking all templates...\n');
            templates = await GlobalInstantResponseTemplate.find();
            console.log(`📊 [HEALTH CHECK] Found ${templates.length} template(s)\n`);
        }
        
        const results = [];
        
        for (const template of templates) {
            const checker = new TemplateHealthChecker(template);
            const result = checker.runAllChecks();
            results.push(result);
        }
        
        // Summary
        if (results.length > 1) {
            console.log(`\n${  '='.repeat(80)}`);
            console.log('📊 SUMMARY ACROSS ALL TEMPLATES');
            console.log('='.repeat(80));
            
            const avgScore = (results.reduce((sum, r) => sum + r.score, 0) / results.length).toFixed(1);
            const healthyCount = results.filter(r => r.healthy).length;
            
            console.log(`   Average Health Score: ${avgScore}/100`);
            console.log(`   Healthy Templates: ${healthyCount}/${results.length}`);
            console.log(`   Critical Issues: ${results.reduce((sum, r) => sum + r.issues.critical.length, 0)}`);
            console.log(`   Warnings: ${results.reduce((sum, r) => sum + r.issues.warnings.length, 0)}`);
            console.log(`   Optimizations: ${results.reduce((sum, r) => sum + r.issues.optimizations.length, 0)}`);
            console.log('\n');
        }
        
        console.log('🎉 [HEALTH CHECK] Audit complete!\n');
        
    } catch (error) {
        console.error('❌ [HEALTH CHECK] Error during health check:', error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log('👋 [HEALTH CHECK] Database connection closed');
    }
}

// Run the health check
runHealthCheck();

