/**
 * ============================================================================
 * CONFIGURATION READINESS SERVICE
 * ============================================================================
 * 
 * PURPOSE: Calculate if company is ready to go live with AI Agent
 * 
 * SCORING ALGORITHM:
 * - Variables (45%): Required variables configured
 * - Filler Words (10%): Filler words active
 * - Scenarios (25%): Template scenarios loaded
 * - Voice (10%): Voice settings configured
 * - Test Calls (10%): Test calls completed
 * 
 * GO LIVE CRITERIA:
 * - Score >= 80/100
 * - Zero critical blockers
 * 
 * BLOCKERS:
 * - CRITICAL: Prevents Go Live (missing required config)
 * - MAJOR: Strongly recommended to fix
 * - WARNING: Should be addressed eventually
 * 
 * ============================================================================
 */

const Company = require('../models/v2Company');
const logger = require('../utils/logger.js');

const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');

class ConfigurationReadinessService {
    
    /**
     * Calculate comprehensive readiness score
     * @param {Object} company - Company document (already loaded)
     * @returns {Object} Readiness report
     */
    static async calculateReadiness(company) {
        logger.info(`[READINESS] 🎯 Calculating readiness for: ${company.companyName}`);
        
        const report = {
            calculatedAt: new Date(),
            companyId: company._id.toString(),
            companyName: company.companyName,
            score: 0,
            canGoLive: false,
            blockers: [],
            warnings: [],
            components: {
                accountStatus: null,
                variables: null,
                fillerWords: null,
                scenarios: null,
                voice: null,
                testCalls: null
            }
        };
        
        // 🚨 GATEKEEPER: Check account status FIRST (Configuration tab)
        this.checkAccountStatus(company, report);
        
        // Calculate each component
        await Promise.all([
            this.calculateVariablesScore(company, report),
            this.calculateFillerWordsScore(company, report),
            this.calculateScenariosScore(company, report),
            this.calculateVoiceScore(company, report),
            this.calculateTestCallsScore(company, report)
        ]);
        
        // Calculate total score (weighted sum)
        const totalScore = 
            (report.components.variables.score * 0.45) +
            (report.components.fillerWords.score * 0.10) +
            (report.components.scenarios.score * 0.25) +
            (report.components.voice.score * 0.10) +
            (report.components.testCalls.score * 0.10);
        
        report.score = Math.round(totalScore);
        
        // Determine if can go live
        const hasCriticalBlockers = report.blockers.some(b => b.severity === 'critical');
        report.canGoLive = report.score >= 80 && !hasCriticalBlockers;
        
        logger.info(`[READINESS] ✅ Score: ${report.score}/100 | Can Go Live: ${report.canGoLive}`);
        logger.info(`[READINESS] 📊 Components:`);
        logger.info(`   - Variables: ${report.components.variables.score}/100 (${report.components.variables.configured}/${report.components.variables.required})`);
        logger.info(`   - Filler Words: ${report.components.fillerWords.score}/100 (${report.components.fillerWords.active} active)`);
        logger.info(`   - Scenarios: ${report.components.scenarios.score}/100 (${report.components.scenarios.active} active)`);
        logger.info(`   - Voice: ${report.components.voice.score}/100 (${report.components.voice.configured ? 'configured' : 'not configured'})`);
        logger.info(`   - Test Calls: ${report.components.testCalls.score}/100 (${report.components.testCalls.made}/${report.components.testCalls.required})`);
        
        if (report.blockers.length > 0) {
            logger.info(`[READINESS] 🚫 Blockers: ${report.blockers.length}`);
            report.blockers.forEach(b => logger.info(`   - ${b.code}: ${b.message}`));
        }
        
        return report;
    }
    
    /**
     * Calculate variables score (45% of total)
     */
    static async calculateVariablesScore(company, report) {
        const component = {
            name: 'Variables',
            score: 0,
            required: 0,
            configured: 0,
            missing: [],
            weight: 45
        };
        
        try {
            // Load template to get variable definitions
            if (!company.configuration?.clonedFrom) {
                // No template cloned - critical blocker
                component.score = 0;
                component.required = 0;
                component.configured = 0;
                
                report.blockers.push({
                    code: 'NO_TEMPLATE',
                    message: 'No Global AI Brain template cloned',
                    severity: 'CRITICAL',
                    target: '/company/:companyId/ai-agent-settings/template-info',
                    component: 'template'
                });
                
                report.components.variables = component;
                return;
            }
            
            const template = await GlobalInstantResponseTemplate.findById(company.configuration.clonedFrom);
            
            if (!template) {
                component.score = 0;
                report.blockers.push({
                    code: 'TEMPLATE_NOT_FOUND',
                    message: 'Cloned template no longer exists',
                    severity: 'CRITICAL',
                    target: '/company/:companyId/ai-agent-settings/template-info',
                    component: 'template'
                });
                report.components.variables = component;
                return;
            }
            
            // Get variable definitions
            const variableDefinitions = template.variableDefinitions || template.availableVariables || [];
            const variables = company.configuration?.variables || {};
            
            // Convert Map to object if needed
            const variablesObj = variables.toObject ? variables.toObject() : variables;
            
            // Count required vs configured
            const requiredVars = variableDefinitions.filter(v => v.required);
            component.required = requiredVars.length;
            
            requiredVars.forEach(varDef => {
                const value = variablesObj[varDef.key];
                if (value && value.trim() !== '') {
                    component.configured++;
                } else {
                    component.missing.push({
                        key: varDef.key,
                        label: varDef.label || varDef.key,
                        type: varDef.type || 'text'
                    });
                }
            });
            
            // Calculate score
            if (component.required === 0) {
                component.score = 100; // No required variables
            } else {
                component.score = Math.round((component.configured / component.required) * 100);
            }
            
            // Add blockers for missing required variables
            if (component.missing.length > 0) {
                report.blockers.push({
                    code: 'MISSING_REQUIRED_VARIABLES',
                    message: `${component.missing.length} required variable(s) not configured`,
                    severity: 'CRITICAL',
                    target: `/company/:companyId/ai-agent-settings/variables`,
                    component: 'variables',
                    details: component.missing.map(v => v.label).join(', ')
                });
            }
            
        } catch (error) {
            logger.error(`[READINESS] ❌ Variables calculation error:`, error);
            component.score = 0;
            report.blockers.push({
                code: 'VARIABLES_ERROR',
                message: `Error calculating variables: ${error.message}`,
                severity: 'CRITICAL',
                component: 'variables'
            });
        }
        
        report.components.variables = component;
    }
    
    /**
     * Calculate filler words score (10% of total)
     */
    static async calculateFillerWordsScore(company, report) {
        const component = {
            name: 'Filler Words',
            score: 100, // Default to 100 (not critical)
            active: 0,
            inherited: 0,
            custom: 0,
            weight: 10
        };
        
        try {
            const fillerWords = company.configuration?.fillerWords || {};
            const inherited = fillerWords.inherited || [];
            const custom = fillerWords.custom || [];
            
            component.inherited = inherited.length;
            component.custom = custom.length;
            component.active = inherited.length + custom.length;
            
            // Filler words are optional but recommended
            if (component.active === 0) {
                component.score = 50; // Half score if none configured
                report.warnings.push({
                    code: 'NO_FILLER_WORDS',
                    message: 'No filler words configured - may affect speech recognition accuracy',
                    severity: 'major',
                    target: `/company/:companyId/ai-agent-settings/filler-words`,
                    component: 'fillerWords'
                });
            } else if (component.active < 20) {
                component.score = 75; // Low count warning
                report.warnings.push({
                    code: 'FEW_FILLER_WORDS',
                    message: `Only ${component.active} filler words configured (recommended: 20+)`,
                    severity: 'WARNING',
                    target: `/company/:companyId/ai-agent-settings/filler-words`,
                    component: 'fillerWords'
                });
            } else {
                component.score = 100;
            }
            
        } catch (error) {
            logger.error(`[READINESS] ❌ Filler words calculation error:`, error);
            component.score = 50;
        }
        
        report.components.fillerWords = component;
    }
    
    /**
     * Calculate scenarios score (25% of total)
     */
    static async calculateScenariosScore(company, report) {
        const component = {
            name: 'Scenarios',
            score: 0,
            active: 0,
            total: 0,
            categories: 0,
            weight: 25
        };
        
        try {
            // Load template to get scenarios
            if (!company.configuration?.clonedFrom) {
                component.score = 0;
                // Blocker already added in variables check
                report.components.scenarios = component;
                return;
            }
            
            const template = await GlobalInstantResponseTemplate.findById(company.configuration.clonedFrom);
            
            if (!template) {
                component.score = 0;
                report.components.scenarios = component;
                return;
            }
            
            // Count scenarios
            const categories = template.categories || [];
            component.categories = categories.length;
            
            categories.forEach(category => {
                const scenarios = category.scenarios || [];
                component.total += scenarios.length;
                component.active += scenarios.filter(s => s.status === 'active').length;
            });
            
            // Calculate score
            if (component.active === 0) {
                component.score = 0;
                report.blockers.push({
                    code: 'NO_SCENARIOS',
                    message: 'No active scenarios found in template',
                    severity: 'CRITICAL',
                    target: `/company/:companyId/ai-agent-settings/scenarios`,
                    component: 'scenarios'
                });
            } else if (component.active < 10) {
                component.score = 50;
                report.warnings.push({
                    code: 'FEW_SCENARIOS',
                    message: `Only ${component.active} active scenarios (recommended: 50+)`,
                    severity: 'major',
                    target: `/company/:companyId/ai-agent-settings/scenarios`,
                    component: 'scenarios'
                });
            } else {
                component.score = 100;
            }
            
        } catch (error) {
            logger.error(`[READINESS] ❌ Scenarios calculation error:`, error);
            component.score = 0;
            report.blockers.push({
                code: 'SCENARIOS_ERROR',
                message: `Error loading scenarios: ${error.message}`,
                severity: 'CRITICAL',
                component: 'scenarios'
            });
        }
        
        report.components.scenarios = component;
    }
    
    /**
     * Calculate voice score (10% of total)
     */
    static async calculateVoiceScore(company, report) {
        const component = {
            name: 'Voice Settings',
            score: 0,
            configured: false,
            voiceId: null,
            apiSource: null,
            weight: 10
        };
        
        try {
            const voiceSettings = company.aiAgentLogic?.voiceSettings || {};
            
            component.voiceId = voiceSettings.voiceId || null;
            component.apiSource = voiceSettings.apiSource || null;
            component.configured = Boolean(voiceSettings.voiceId);
            
            if (!component.configured) {
                component.score = 0;
                report.blockers.push({
                    code: 'NO_VOICE',
                    message: 'No voice selected for AI Agent',
                    severity: 'CRITICAL',
                    target: `/company/:companyId/ai-voice`,
                    component: 'voice'
                });
            } else {
                component.score = 100;
            }
            
        } catch (error) {
            logger.error(`[READINESS] ❌ Voice calculation error:`, error);
            component.score = 0;
            report.blockers.push({
                code: 'VOICE_ERROR',
                message: `Error checking voice settings: ${error.message}`,
                severity: 'CRITICAL',
                component: 'voice'
            });
        }
        
        report.components.voice = component;
    }
    
    /**
     * Calculate test calls score (10% of total)
     */
    static async calculateTestCallsScore(company, report) {
        const component = {
            name: 'Test Calls',
            score: 0,
            made: 0,
            required: 3, // Recommended minimum
            weight: 10
        };
        
        try {
            component.made = company.configuration?.testCallsMade || 0;
            
            // Calculate score based on test calls made
            if (component.made === 0) {
                component.score = 0;
                report.warnings.push({
                    code: 'NO_TEST_CALLS',
                    message: 'No test calls made - strongly recommended before going live',
                    severity: 'major',
                    target: `/company/:companyId/ai-agent-settings/dashboard`,
                    component: 'testCalls'
                });
            } else if (component.made < component.required) {
                component.score = Math.round((component.made / component.required) * 100);
                report.warnings.push({
                    code: 'FEW_TEST_CALLS',
                    message: `Only ${component.made} test call(s) made (recommended: ${component.required}+)`,
                    severity: 'WARNING',
                    target: `/company/:companyId/ai-agent-settings/dashboard`,
                    component: 'testCalls'
                });
            } else {
                component.score = 100;
            }
            
        } catch (error) {
            logger.error(`[READINESS] ❌ Test calls calculation error:`, error);
            component.score = 0;
        }
        
        report.components.testCalls = component;
    }
    
    /**
     * 🚨 GATEKEEPER: Check account status (Configuration tab)
     * This is checked FIRST before all other components
     * SUSPENDED or CALL_FORWARD status prevents Go Live
     */
    static checkAccountStatus(company, report) {
        const component = {
            name: 'Account Status',
            score: 0,
            status: 'unknown',
            isActive: false,
            weight: 0 // Doesn't contribute to score, but blocks Go Live
        };
        
        try {
            const accountStatus = company.accountStatus || {};
            const status = accountStatus.status || 'active';
            
            component.status = status;
            component.isActive = (status === 'active');
            
            logger.info(`[READINESS] 🚨 GATEKEEPER: Account status = ${status}`);
            
            // CRITICAL: Account must be ACTIVE to go live
            if (status === 'suspended') {
                component.score = 0;
                report.blockers.push({
                    code: 'ACCOUNT_SUSPENDED',
                    message: 'Account is SUSPENDED - All incoming calls are blocked',
                    severity: 'CRITICAL',
                    target: '/company/:companyId/config#account-status',
                    component: 'accountStatus',
                    details: `Reason: ${accountStatus.reason || 'Not specified'}. Change status to ACTIVE in Configuration tab to go live.`
                });
                
                logger.security(`[READINESS] 🚫 BLOCKED: Account suspended`);
                
            } else if (status === 'call_forward') {
                component.score = 0;
                report.blockers.push({
                    code: 'ACCOUNT_CALL_FORWARD',
                    message: 'Account is set to CALL FORWARD - Calls are being forwarded, not handled by AI',
                    severity: 'CRITICAL',
                    target: '/company/:companyId/config#account-status',
                    component: 'accountStatus',
                    details: `Currently forwarding to: ${accountStatus.callForwardNumber || 'unknown'}. Change status to ACTIVE in Configuration tab to enable AI Agent.`
                });
                
                logger.security(`[READINESS] 🚫 BLOCKED: Account in call forward mode`);
                
            } else if (status === 'active') {
                component.score = 100;
                logger.security(`[READINESS] ✅ GATEKEEPER PASSED: Account is active`);
            } else {
                // Unknown status - block as precaution
                component.score = 0;
                report.blockers.push({
                    code: 'ACCOUNT_STATUS_UNKNOWN',
                    message: `Unknown account status: "${status}"`,
                    severity: 'CRITICAL',
                    target: '/company/:companyId/config#account-status',
                    component: 'accountStatus',
                    details: 'Please set account status to ACTIVE in Configuration tab.'
                });
                
                logger.security(`[READINESS] 🚫 BLOCKED: Unknown account status`);
            }
            
        } catch (error) {
            logger.security(`[READINESS] ❌ Account status check error:`, error);
            component.score = 0;
            report.blockers.push({
                code: 'ACCOUNT_STATUS_ERROR',
                message: `Error checking account status: ${error.message}`,
                severity: 'CRITICAL',
                component: 'accountStatus'
            });
        }
        
        report.components.accountStatus = component;
    }
}

module.exports = ConfigurationReadinessService;
