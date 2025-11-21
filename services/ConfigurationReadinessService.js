/**
 * ============================================================================
 * CONFIGURATION READINESS SERVICE V2.0
 * ============================================================================
 * 
 * PURPOSE: Calculate if company is ready to go live with AI Agent
 * 
 * CRITICAL: This service checks the CORRECT schema (aiAgentSettings)
 * 
 * SCORING ALGORITHM:
 * - Templates (30%): At least one active template
 * - Variables (30%): Required variables configured
 * - Twilio (20%): Phone number and credentials configured
 * - Voice (10%): Voice settings configured
 * - Scenarios (10%): Active scenarios available
 * 
 * GO LIVE CRITERIA:
 * - Score >= 80/100
 * - Zero critical blockers
 * - Account status = ACTIVE
 * 
 * BLOCKERS:
 * - CRITICAL: Prevents Go Live (missing required config)
 * - MAJOR: Strongly recommended to fix
 * - WARNING: Should be addressed eventually
 * 
 * ============================================================================
 */

const Company = require('../models/v2Company');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
const logger = require('../utils/logger.js');

class ConfigurationReadinessService {
    
    /**
     * Calculate comprehensive readiness score
     * @param {Object} company - Company document (already loaded)
     * @returns {Object} Readiness report
     */
    static async calculateReadiness(company) {
        logger.info(`[READINESS] 🎯 Calculating readiness for: ${company.companyName} (${company._id})`);
        
        const report = {
            calculatedAt: new Date(),
            companyId: company._id.toString(),
            companyName: company.companyName,
            score: 0,
            canGoLive: false,
            blockers: [],
            warnings: [],
            components: {
                templates: null,
                variables: null,
                twilio: null,
                voice: null,
                scenarios: null,
                readiness: null
            }
        };
        
        // 🚨 GATEKEEPER: Check account status FIRST
        this.checkAccountStatus(company, report);
        
        // Calculate each component in parallel
        await Promise.all([
            this.checkTemplates(company, report),
            this.checkVariables(company, report),
            this.checkTwilio(company, report),
            this.checkVoice(company, report),
            this.checkScenarios(company, report)
        ]);
        
        // Calculate total score (weighted sum)
        const totalScore = 
            (report.components.templates.score * 0.30) +
            (report.components.variables.score * 0.30) +
            (report.components.twilio.score * 0.20) +
            (report.components.voice.score * 0.10) +
            (report.components.scenarios.score * 0.10);
        
        report.score = Math.round(totalScore);
        
        // Determine if can go live
        const hasCriticalBlockers = report.blockers.some(b => b.severity === 'critical');
        const isAccountActive = report.components.readiness?.isActive || false;
        report.canGoLive = report.score >= 80 && !hasCriticalBlockers && isAccountActive;
        
        // Log summary
        logger.info(`[READINESS] ✅ Score: ${report.score}/100 | Can Go Live: ${report.canGoLive}`);
        logger.info(`[READINESS] 📊 Components:`);
        logger.info(`   - Templates:  ${report.components.templates.score}/100 (${report.components.templates.active} active)`);
        logger.info(`   - Variables:  ${report.components.variables.score}/100 (${report.components.variables.configured}/${report.components.variables.required})`);
        logger.info(`   - Twilio:     ${report.components.twilio.score}/100 (${report.components.twilio.configured ? 'configured' : 'not configured'})`);
        logger.info(`   - Voice:      ${report.components.voice.score}/100 (${report.components.voice.configured ? 'configured' : 'not configured'})`);
        logger.info(`   - Scenarios:  ${report.components.scenarios.score}/100 (${report.components.scenarios.active} active)`);
        
        if (report.blockers.length > 0) {
            logger.warn(`[READINESS] 🚫 Blockers: ${report.blockers.length}`);
            report.blockers.forEach(b => logger.warn(`   - [${b.severity}] ${b.code}: ${b.message}`));
        }
        
        return report;
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
            isLive: false,
            weight: 0 // Doesn't contribute to score, but blocks Go Live
        };
        
        try {
            const accountStatus = company.accountStatus || {};
            const status = accountStatus.status || 'active';
            const readiness = company.configuration?.readiness || {};
            
            component.status = status;
            component.isActive = (status === 'active');
            component.isLive = readiness.isLive || false;
            
            logger.info(`[READINESS] 🚨 GATEKEEPER: Account status = ${status}, isLive = ${component.isLive}`);
            
            // CRITICAL: Account must be ACTIVE to go live
            if (status === 'suspended') {
                component.score = 0;
                report.blockers.push({
                    code: 'ACCOUNT_SUSPENDED',
                    message: 'Account is SUSPENDED - All incoming calls are blocked',
                    severity: 'critical',
                    target: '/company-profile.html',
                    component: 'accountStatus',
                    details: `Reason: ${accountStatus.reason || 'Not specified'}. Change status to ACTIVE in Configuration tab to go live.`
                });
                
                logger.security(`[READINESS] 🚫 BLOCKED: Account suspended`);
                
            } else if (status === 'call_forward') {
                component.score = 0;
                report.blockers.push({
                    code: 'ACCOUNT_CALL_FORWARD',
                    message: 'Account is set to CALL FORWARD - Calls are being forwarded, not handled by AI',
                    severity: 'critical',
                    target: '/company-profile.html',
                    component: 'accountStatus',
                    details: `Currently forwarding to: ${accountStatus.callForwardNumber || 'unknown'}. Change status to ACTIVE to enable AI Agent.`
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
                    severity: 'critical',
                    target: '/company-profile.html',
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
                severity: 'critical',
                component: 'accountStatus'
            });
        }
        
        report.components.readiness = component;
    }
    
    /**
     * Check templates (30% of total)
     * CRITICAL FIX: Now checks aiAgentSettings.templateReferences (not legacy clonedFrom)
     */
    static async checkTemplates(company, report) {
        const component = {
            name: 'Templates',
            score: 0,
            active: 0,
            total: 0,
            configured: false,
            templateIds: [],
            weight: 30
        };
        
        try {
            // ✅ CORRECT: Check NEW schema
            const templateRefs = company.aiAgentSettings?.templateReferences || [];
            const activeTemplates = templateRefs.filter(ref => ref.enabled !== false);
            
            component.total = templateRefs.length;
            component.active = activeTemplates.length;
            component.configured = component.active > 0;
            component.templateIds = activeTemplates.map(ref => ref.templateId);
            
            logger.info(`[READINESS] 📋 Templates: ${component.active} active out of ${component.total} total`);
            
            if (component.active === 0) {
                component.score = 0;
                report.blockers.push({
                    code: 'NO_TEMPLATE',
                    message: 'No templates activated - AI Agent has no scenarios to match against',
                    severity: 'critical',
                    target: 'aicore-templates',  // ✨ FIX: Navigate to AiCore Templates tab
                    component: 'templates',
                    details: 'Navigate to AI Agent Settings → AiCore Templates and activate at least one template.'
                });
                
                logger.warn(`[READINESS] ❌ NO TEMPLATES: Company has no active templates`);
            } else {
                // Verify templates actually exist in database
                const existingTemplates = await GlobalInstantResponseTemplate.find({
                    _id: { $in: component.templateIds }
                }).select('_id name version').lean();
                
                const existingIds = existingTemplates.map(t => t._id.toString());
                const missingIds = component.templateIds.filter(id => !existingIds.includes(id.toString()));
                
                if (missingIds.length > 0) {
                    component.score = 50; // Partial credit
                    report.warnings.push({
                        code: 'TEMPLATE_NOT_FOUND',
                        message: `${missingIds.length} template(s) not found in Global AI Brain`,
                        severity: 'major',
                        target: 'aicore-templates',  // ✨ FIX: Navigate to AiCore Templates tab
                        component: 'templates',
                        details: `Missing template IDs: ${missingIds.join(', ')}. Remove invalid references.`
                    });
                    
                    logger.warn(`[READINESS] ⚠️ MISSING TEMPLATES: ${missingIds.length} templates not found`);
                } else {
                    component.score = 100;
                    logger.info(`[READINESS] ✅ TEMPLATES OK: ${component.active} valid templates`);
                }
            }
            
        } catch (error) {
            logger.error(`[READINESS] ❌ Templates check error:`, error);
            component.score = 0;
            report.blockers.push({
                code: 'TEMPLATES_ERROR',
                message: `Error checking templates: ${error.message}`,
                severity: 'critical',
                component: 'templates'
            });
        }
        
        report.components.templates = component;
    }
    
    /**
     * Check variables (30% of total)
     * CRITICAL FIX: Now checks aiAgentSettings.variables and variableDefinitions
     */
    static async checkVariables(company, report) {
        const component = {
            name: 'Variables',
            score: 0,
            required: 0,
            configured: 0,
            missing: [],
            blank: [],
            total: 0,
            weight: 30
        };
        
        try {
            // ✨ FIX: Check DEFINITIONS first (source of truth for which variables exist)
            // Then verify each has a value in the VALUES Map
            const variableDefinitions = company.aiAgentSettings?.variableDefinitions || [];
            const variablesMap = company.aiAgentSettings?.variables || new Map();
            
            // Convert Map to object if needed
            const variablesObj = variablesMap instanceof Map ? Object.fromEntries(variablesMap) : 
                                 (typeof variablesMap === 'object' && variablesMap !== null) ? variablesMap : {};
            
            component.total = variableDefinitions.length;
            
            logger.info(`[READINESS] 🔧 Variables: ${component.total} total from variableDefinitions`);
            logger.info(`[READINESS] 🔧 Values in Map: ${Object.keys(variablesObj).length}`);
            
            if (component.total === 0) {
                // No variables scanned yet - this is OK, just a warning
                component.score = 100;
                component.configured = true;
                logger.info(`[READINESS] ⚠️ No variables detected (template not scanned yet)`);
            } else {
                // ✨ FIX: Iterate over DEFINITIONS and check if each has a VALUE
                let variablesWithValues = 0;
                let variablesBlank = 0;
                
                variableDefinitions.forEach(definition => {
                    const varKey = definition.key;
                    
                    // ✨ FIX: Look up value in VALUES Map using the definition key
                    const value = variablesObj[varKey];
                    
                    // Check if value is truly filled (not empty, not whitespace, not placeholder)
                    const valueStr = value ? String(value).trim() : '';
                    const lowerValue = valueStr.toLowerCase();
                    
                    // Detect placeholder patterns (case-insensitive)
                    const isPlaceholder = lowerValue.startsWith('e.g') ||      // e.g., e.g., E.g., etc.
                                          lowerValue.startsWith('ex.') ||      // ex., example
                                          lowerValue.startsWith('example') ||
                                          valueStr === '(empty)' ||
                                          valueStr === 'N/A' ||
                                          lowerValue === 'n/a';
                    
                    const hasValue = valueStr.length > 0 && !isPlaceholder;
                    
                    if (hasValue) {
                        variablesWithValues++;
                    } else {
                        variablesBlank++;
                        component.blank.push({
                            key: varKey,
                            label: definition.label || varKey,
                            category: definition.category || 'General'
                        });
                    }
                });
                
                component.configured = variablesWithValues;
                component.required = component.total; // All variables should have values
                
                // Calculate score (% of variables that have values)
                component.score = Math.round((variablesWithValues / component.total) * 100);
                
                logger.info(`[READINESS] 📊 Variables with values: ${variablesWithValues}/${component.total} (${component.score}%)`);
                
                // Add blocker if any variables have blank values
                if (variablesBlank > 0) {
                    report.blockers.push({
                        code: 'BLANK_VARIABLES',
                        message: `${variablesBlank} variable(s) exist but have no value`,
                        severity: 'high',
                        target: 'variables',  // ✨ FIX: Navigate to AiCore Variables tab
                        component: 'variables',
                        details: `Blank: ${component.blank.map(v => v.key).join(', ')}`
                    });
                    
                    logger.warn(`[READINESS] ⚠️ BLANK VARIABLES: ${component.blank.map(v => v.key).join(', ')}`);
                } else {
                    logger.info(`[READINESS] ✅ VARIABLES OK: All ${component.total} variable(s) have values`);
                }
            }
            
        } catch (error) {
            logger.error(`[READINESS] ❌ Variables check error:`, error);
            component.score = 0;
            report.blockers.push({
                code: 'VARIABLES_ERROR',
                message: `Error checking variables: ${error.message}`,
                severity: 'critical',
                component: 'variables'
            });
        }
        
        report.components.variables = component;
    }
    
    /**
     * Check Twilio (20% of total)
     * NEW: This was missing from the original service!
     */
    static async checkTwilio(company, report) {
        const component = {
            name: 'Twilio',
            score: 0,
            configured: false,
            hasCredentials: false,
            hasPhoneNumber: false,
            phoneNumbers: [],
            weight: 20
        };
        
        try {
            const twilioConfig = company.twilioConfig || {};
            
            // Check credentials
            component.hasCredentials = Boolean(
                twilioConfig.accountSid && 
                twilioConfig.authToken
            );
            
            // Check phone numbers (new multi-number system or legacy single number)
            const phoneNumbers = twilioConfig.phoneNumbers || [];
            const legacyPhone = twilioConfig.phoneNumber;
            
            if (phoneNumbers.length > 0) {
                component.hasPhoneNumber = true;
                component.phoneNumbers = phoneNumbers.map(p => p.phoneNumber);
            } else if (legacyPhone) {
                component.hasPhoneNumber = true;
                component.phoneNumbers = [legacyPhone];
            }
            
            component.configured = component.hasCredentials && component.hasPhoneNumber;
            
            logger.info(`[READINESS] 📞 Twilio: Credentials=${component.hasCredentials}, Phone=${component.hasPhoneNumber}`);
            
            // Calculate score and add blockers
            if (!component.hasCredentials && !component.hasPhoneNumber) {
                component.score = 0;
                report.blockers.push({
                    code: 'NO_TWILIO',
                    message: 'Twilio not configured - No phone number or credentials',
                    severity: 'critical',
                    target: 'twilio-control',  // ✨ FIX: Navigate to Twilio Control tab
                    component: 'twilio',
                    details: 'Navigate to VoiceCore → Twilio Control and configure your Twilio account.'
                });
                
                logger.warn(`[READINESS] ❌ NO TWILIO: No credentials or phone number`);
            } else if (!component.hasCredentials) {
                component.score = 25;
                report.blockers.push({
                    code: 'NO_TWILIO_CREDENTIALS',
                    message: 'Twilio credentials missing (Account SID / Auth Token)',
                    severity: 'critical',
                    target: 'twilio-control',  // ✨ FIX: Navigate to Twilio Control tab
                    component: 'twilio',
                    details: 'Add your Twilio Account SID and Auth Token.'
                });
                
                logger.warn(`[READINESS] ❌ NO TWILIO CREDENTIALS`);
            } else if (!component.hasPhoneNumber) {
                component.score = 25;
                report.blockers.push({
                    code: 'NO_TWILIO_PHONE',
                    message: 'No Twilio phone number configured',
                    severity: 'critical',
                    target: 'twilio-control',  // ✨ FIX: Navigate to Twilio Control tab
                    component: 'twilio',
                    details: 'Add at least one Twilio phone number to receive calls.'
                });
                
                logger.warn(`[READINESS] ❌ NO PHONE NUMBER`);
            } else {
                component.score = 100;
                logger.info(`[READINESS] ✅ TWILIO OK: ${component.phoneNumbers.join(', ')}`);
            }
            
        } catch (error) {
            logger.error(`[READINESS] ❌ Twilio check error:`, error);
            component.score = 0;
            report.blockers.push({
                code: 'TWILIO_ERROR',
                message: `Error checking Twilio: ${error.message}`,
                severity: 'critical',
                component: 'twilio'
            });
        }
        
        report.components.twilio = component;
    }
    
    /**
     * Check voice settings (10% of total)
     */
    static async checkVoice(company, report) {
        const component = {
            name: 'Voice',
            score: 0,
            configured: false,
            voiceId: null,
            apiSource: null,
            weight: 10
        };
        
        try {
            const voiceSettings = company.aiAgentSettings?.voiceSettings || {};
            
            component.voiceId = voiceSettings.voiceId || null;
            component.apiSource = voiceSettings.apiSource || null;
            component.configured = Boolean(voiceSettings.voiceId);
            
            logger.info(`[READINESS] 🎙️ Voice: ${component.configured ? component.voiceId : 'not configured'}`);
            
            if (!component.configured) {
                component.score = 0;
                report.blockers.push({
                    code: 'NO_VOICE',
                    message: 'No voice selected for AI Agent',
                    severity: 'critical',
                    target: 'voice-settings',  // ✨ FIX: Navigate to Voice Settings tab
                    component: 'voice',
                    details: 'Navigate to VoiceCore → Voice Settings and select a voice.'
                });
                
                logger.warn(`[READINESS] ❌ NO VOICE`);
            } else {
                component.score = 100;
                logger.info(`[READINESS] ✅ VOICE OK: ${component.voiceId}`);
            }
            
        } catch (error) {
            logger.error(`[READINESS] ❌ Voice check error:`, error);
            component.score = 0;
            report.blockers.push({
                code: 'VOICE_ERROR',
                message: `Error checking voice settings: ${error.message}`,
                severity: 'critical',
                component: 'voice'
            });
        }
        
        report.components.voice = component;
    }
    
    /**
     * Check scenarios (10% of total)
     * Checks that active templates have live scenarios
     */
    static async checkScenarios(company, report) {
        const component = {
            name: 'Scenarios',
            score: 0,
            active: 0,
            total: 0,
            categories: 0,
            disabled: 0,
            weight: 10
        };
        
        try {
            // Get active template IDs
            const templateRefs = company.aiAgentSettings?.templateReferences || [];
            const activeTemplateIds = templateRefs
                .filter(ref => ref.enabled !== false)
                .map(ref => ref.templateId);
            
            if (activeTemplateIds.length === 0) {
                // No templates = no scenarios possible
                component.score = 0;
                component.active = 0;
                component.total = 0;
                
                // Add blocker for scenarios too (not just rely on templates blocker)
                report.blockers.push({
                    code: 'NO_SCENARIOS',
                    message: 'No active scenarios - AI Agent cannot match customer requests',
                    severity: 'critical',
                    target: 'templates',  // Fix by activating templates first
                    component: 'scenarios',
                    details: 'Activate at least one template in AiCore Templates tab to get scenarios.'
                });
                
                logger.info(`[READINESS] 🎭 Scenarios: 0 (no templates activated)`);
                report.components.scenarios = component;
                return;
            }
            
            // Load templates and count scenarios
            const templates = await GlobalInstantResponseTemplate.find({
                _id: { $in: activeTemplateIds }
            }).select('categories').lean();
            
            const scenarioControls = company.aiAgentSettings?.scenarioControls || {};
            
            templates.forEach(template => {
                const categories = template.categories || [];
                component.categories += categories.length;
                
                categories.forEach(category => {
                    const scenarios = category.scenarios || [];
                    scenarios.forEach(scenario => {
                        component.total++;
                        
                        // ✅ FIX: Only check company-level disabling, ignore template-level status
                        // This matches the UI behavior (Live Scenarios shows ALL scenarios from template)
                        const isDisabledByCompany = scenarioControls[scenario.scenarioId]?.isEnabled === false;
                        
                        if (!isDisabledByCompany) {
                            component.active++;
                        } else {
                            component.disabled++;
                        }
                    });
                });
            });
            
            logger.info(`[READINESS] 🎭 Scenarios: ${component.active} active out of ${component.total} total`);
            
            // Calculate score
            if (component.active === 0) {
                component.score = 0;
                report.blockers.push({
                    code: 'NO_SCENARIOS',
                    message: 'No active scenarios - AI Agent cannot match customer requests',
                    severity: 'critical',
                    target: 'live-scenarios',
                    component: 'scenarios',
                    details: 'All scenarios are disabled. Enable scenarios in AI Agent Settings → AiCore Live Scenarios.'
                });
                
                logger.warn(`[READINESS] ❌ NO SCENARIOS: All scenarios disabled`);
            } else if (component.active < 10) {
                component.score = 50;
                // CHANGED: Make this a BLOCKER instead of warning so it shows in Action Required
                report.blockers.push({
                    code: 'FEW_SCENARIOS',
                    message: `Only ${component.active} active scenario${component.active === 1 ? '' : 's'} - AI Agent needs more coverage`,
                    severity: 'critical',
                    target: 'live-scenarios',
                    component: 'scenarios',
                    details: `You have ${component.active} active scenario${component.active === 1 ? '' : 's'} but need at least 10 for adequate AI coverage. Enable more scenarios in AiCore Live Scenarios tab.`
                });
                
                logger.warn(`[READINESS] ⚠️ FEW SCENARIOS: Only ${component.active} active (need 10+)`);
            } else {
                component.score = 100;
                logger.info(`[READINESS] ✅ SCENARIOS OK: ${component.active} active scenarios`);
            }
            
        } catch (error) {
            logger.error(`[READINESS] ❌ Scenarios check error:`, error);
            component.score = 0;
            report.blockers.push({
                code: 'SCENARIOS_ERROR',
                message: `Error checking scenarios: ${error.message}`,
                severity: 'critical',
                component: 'scenarios'
            });
        }
        
        report.components.scenarios = component;
    }
}

module.exports = ConfigurationReadinessService;
