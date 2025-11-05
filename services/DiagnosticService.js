/**
 * ============================================================================
 * DIAGNOSTIC SERVICE
 * ============================================================================
 * 
 * PURPOSE: Enterprise-grade diagnostic engine for AI Agent configuration
 * ARCHITECTURE: Multi-tenant, component-based validation system
 * COMPONENTS: Templates, Variables, Twilio, Voice, Scenarios
 * 
 * FEATURES:
 * - Detailed validation with code references
 * - Database state inspection
 * - Dependency impact analysis
 * - Actionable fix instructions
 * - Developer-focused output
 * 
 * SECURITY: Multi-tenant isolation, input validation
 * PERFORMANCE: Optimized queries, Redis caching ready
 * 
 * Created: 2025-11-04
 * ============================================================================
 */

const Company = require('../models/v2Company');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
const logger = require('../utils/logger');

class DiagnosticService {
    
    /**
     * Get detailed diagnostics for a specific component
     * @param {string} companyId - Company ID
     * @param {string} component - Component name (templates|variables|twilio|voice|scenarios)
     * @returns {Object} Diagnostic report
     */
    static async getDiagnostics(companyId, component) {
        logger.info(`[DIAGNOSTICS] Running diagnostic for ${component} - Company: ${companyId}`);
        
        try {
            // Load company data
            const company = await Company.findById(companyId)
                .select('companyName configuration aiAgentSettings aiAgentLogic twilioAccountSid twilioAuthToken twilioPhoneNumber')
                .lean();
            
            if (!company) {
                throw new Error('Company not found');
            }
            
            // Route to component-specific diagnostic
            switch (component.toLowerCase()) {
                case 'templates':
                    return await this.checkTemplates(company);
                case 'variables':
                    return await this.checkVariables(company);
                case 'twilio':
                    return await this.checkTwilio(company);
                case 'voice':
                    return await this.checkVoice(company);
                case 'scenarios':
                    return await this.checkScenarios(company);
                default:
                    throw new Error(`Unknown component: ${component}`);
            }
            
        } catch (error) {
            logger.error(`[DIAGNOSTICS] Error running diagnostic for ${component}:`, error);
            throw error;
        }
    }
    
    /**
     * ========================================================================
     * TEMPLATES DIAGNOSTIC
     * ========================================================================
     */
    static async checkTemplates(company) {
        const checks = [];
        let score = 0;
        const maxScore = 100;
        
        // ────────────────────────────────────────────────────────────────────
        // CHECK 1: Template Cloned
        // ────────────────────────────────────────────────────────────────────
        const templateRefs = company.aiAgentSettings?.templateReferences || [];
        const activeTemplates = templateRefs.filter(ref => ref.enabled !== false);
        
        if (activeTemplates.length === 0) {
            checks.push({
                id: 'tmpl_no_clone',
                type: 'configuration',
                status: 'failed',
                severity: 'critical',
                message: 'No Global AI Brain template cloned',
                currentValue: 'No templates',
                expectedValue: 'At least 1 active template',
                impact: [
                    'Cannot generate AI responses',
                    'No scenarios available',
                    'Zero variables inherited',
                    'Go Live blocked'
                ],
                codeReference: {
                    file: 'models/v2Company.js',
                    line: 2053,
                    path: 'aiAgentSettings.templateReferences'
                },
                fix: {
                    action: 'navigate',
                    target: 'aicore-templates',
                    description: 'Go to AiCore Templates tab and clone a template from Global AI Brain'
                }
            });
        } else {
            // Load template details
            const template = activeTemplates[0];
            let templateDetails = null;
            
            try {
                templateDetails = await GlobalInstantResponseTemplate.findById(template.templateId)
                    .select('name industry categories scenarios variables')
                    .lean();
            } catch (error) {
                logger.warn(`[DIAGNOSTICS] Could not load template ${template.templateId}:`, error.message);
            }
            
            if (templateDetails) {
                // Count scenarios
                const scenarioCount = templateDetails.categories?.reduce((total, cat) => {
                    return total + (cat.scenarios?.length || 0);
                }, 0) || 0;
                
                checks.push({
                    id: 'tmpl_cloned',
                    type: 'configuration',
                    status: 'passed',
                    severity: 'info',
                    message: 'Global AI Brain template successfully cloned',
                    details: {
                        templateId: template.templateId,
                        templateName: templateDetails.name,
                        industry: templateDetails.industry?.join(', ') || 'Not specified',
                        clonedAt: template.clonedAt || 'Unknown',
                        lastSynced: template.lastSynced || 'Never',
                        scenariosInherited: scenarioCount,
                        variablesInherited: templateDetails.variables?.length || 0,
                        categoriesCount: templateDetails.categories?.length || 0
                    },
                    codeReference: {
                        file: 'models/v2Company.js',
                        line: 2053,
                        path: 'aiAgentSettings.templateReferences[0]'
                    }
                });
                score = 100;
            } else {
                checks.push({
                    id: 'tmpl_invalid',
                    type: 'configuration',
                    status: 'failed',
                    severity: 'high',
                    message: 'Template reference exists but template not found in database',
                    currentValue: `Template ID: ${template.templateId}`,
                    expectedValue: 'Valid template in GlobalInstantResponseTemplate collection',
                    impact: ['Template data unavailable', 'Scenarios may not load'],
                    codeReference: {
                        file: 'models/GlobalInstantResponseTemplate.js',
                        line: 1,
                        path: 'GlobalInstantResponseTemplate'
                    },
                    fix: {
                        action: 'manual',
                        description: 'Re-clone template or contact support if template was deleted'
                    }
                });
                score = 50;
            }
        }
        
        // ────────────────────────────────────────────────────────────────────
        // CHECK 2: Template Sync Status
        // ────────────────────────────────────────────────────────────────────
        if (activeTemplates.length > 0) {
            const template = activeTemplates[0];
            const lastSynced = template.lastSynced ? new Date(template.lastSynced) : null;
            const now = new Date();
            const daysSinceSync = lastSynced ? Math.floor((now - lastSynced) / (1000 * 60 * 60 * 24)) : 999;
            
            if (daysSinceSync > 30) {
                checks.push({
                    id: 'tmpl_sync_old',
                    type: 'maintenance',
                    status: 'warning',
                    severity: 'medium',
                    message: `Template not synced in ${daysSinceSync} days`,
                    currentValue: lastSynced ? lastSynced.toISOString() : 'Never synced',
                    expectedValue: 'Synced within last 30 days',
                    impact: ['May miss latest template updates', 'Scenarios could be outdated'],
                    fix: {
                        action: 'sync',
                        description: 'Click "Sync from Global AI Brain" in AiCore Templates tab'
                    }
                });
            } else if (lastSynced) {
                checks.push({
                    id: 'tmpl_sync_recent',
                    type: 'maintenance',
                    status: 'passed',
                    severity: 'info',
                    message: `Template synced ${daysSinceSync} day(s) ago`,
                    details: {
                        lastSynced: lastSynced.toISOString(),
                        syncFrequency: 'Recommended: Every 30 days'
                    }
                });
            }
        }
        
        // Calculate summary
        const failed = checks.filter(c => c.status === 'failed').length;
        const passed = checks.filter(c => c.status === 'passed').length;
        const warnings = checks.filter(c => c.status === 'warning').length;
        
        return {
            component: 'templates',
            companyId: company._id,
            companyName: company.companyName,
            status: failed > 0 ? 'failed' : (warnings > 0 ? 'warning' : 'passed'),
            score,
            timestamp: new Date().toISOString(),
            checks,
            summary: {
                total: checks.length,
                passed,
                failed,
                warnings
            },
            metadata: {
                activeTemplates: activeTemplates.length,
                totalReferences: templateRefs.length
            }
        };
    }
    
    /**
     * ========================================================================
     * VARIABLES DIAGNOSTIC - AICORE VARIABLES TAB
     * ========================================================================
     * Checks AiCore Variables (from template scanning)
     * Location: company.aiAgentSettings.variables (Map)
     * Purpose: Developer alert - warn if variables exist but values are blank
     * NOTE: This is a warning system only, does NOT block calls
     */
    static async checkVariables(company) {
        const checks = [];
        let score = 0;
        
        // Get AiCore Variables (Map object from aiAgentSettings.variables)
        const variablesMap = company.aiAgentSettings?.variables || {};
        
        // Convert Map to object if needed
        let variables = {};
        if (variablesMap instanceof Map) {
            variables = Object.fromEntries(variablesMap);
        } else if (typeof variablesMap === 'object' && variablesMap !== null) {
            variables = variablesMap;
        }
        
        const variableKeys = Object.keys(variables);
        const totalVariables = variableKeys.length;
        
        logger.debug(`[DIAGNOSTICS] Checking ${totalVariables} AiCore variables from aiAgentSettings.variables`);
        
        // ────────────────────────────────────────────────────────────────────
        // CHECK 1: No Variables Found
        // ────────────────────────────────────────────────────────────────────
        if (totalVariables === 0) {
            checks.push({
                id: 'var_none_found',
                type: 'configuration',
                status: 'warning',
                severity: 'medium',
                message: 'No variables detected from template scan',
                currentValue: 0,
                expectedValue: 'Variables from scanned templates',
                impact: [
                    'Template placeholders may not be replaced',
                    'Scenarios using variables will have placeholder text'
                ],
                codeReference: {
                    file: 'models/v2Company.js',
                    line: 1833,
                    path: 'aiAgentSettings.variables'
                },
                fix: {
                    action: 'navigate',
                    target: 'variables',
                    description: 'Scan templates to detect variables or add them manually'
                }
            });
            
            return {
                component: 'variables',
                companyId: company._id,
                companyName: company.companyName,
                status: 'warning',
                score: 0,
                timestamp: new Date().toISOString(),
                checks,
                summary: {
                    total: 1,
                    passed: 0,
                    failed: 0,
                    warnings: 1
                },
                metadata: {
                    totalVariables: 0,
                    withValues: 0,
                    blank: 0
                }
            };
        }
        
        // ────────────────────────────────────────────────────────────────────
        // CHECK 2: Variables with Blank/Empty Values
        // ────────────────────────────────────────────────────────────────────
        let variablesWithValues = 0;
        let variablesBlank = 0;
        
        for (const [varName, varValue] of Object.entries(variables)) {
            // Check if value is truly filled (not empty, not whitespace, not placeholder)
            const valueStr = varValue ? String(varValue).trim() : '';
            const lowerValue = valueStr.toLowerCase();
            
            // Detect placeholder patterns (case-insensitive)
            const isPlaceholder = lowerValue.startsWith('e.g') ||      // e.g., e.g., E.g., etc.
                                  lowerValue.startsWith('ex.') ||      // ex., example
                                  lowerValue.startsWith('example') ||
                                  valueStr === '(empty)' ||
                                  valueStr === 'N/A' ||
                                  lowerValue === 'n/a';
            
            const hasValue = valueStr.length > 0 && !isPlaceholder;
            
            if (!hasValue) {
                // Variable exists but is BLANK - RED X WARNING
                checks.push({
                    id: `var_blank_${varName}`,
                    type: 'missing_value',
                    status: 'failed',
                    severity: 'high',
                    field: varName,
                    message: `Variable "{${varName}}" has no value`,
                    currentValue: valueStr || '(empty)',
                    expectedValue: 'Actual value to use in scenarios',
                    impact: [
                        `Placeholder {${varName}} will not be replaced`,
                        'Customers may see {${varName}} in responses'
                    ],
                    codeReference: {
                        file: 'models/v2Company.js',
                        line: 1833,
                        path: `aiAgentSettings.variables.${varName}`
                    },
                    fix: {
                        action: 'navigate',
                        target: 'variables',
                        field: varName,
                        description: `Fill in actual value for {${varName}}`
                    }
                });
                variablesBlank++;
            } else {
                // Variable has value - GREEN CHECKMARK
                checks.push({
                    id: `var_valid_${varName}`,
                    type: 'validation',
                    status: 'passed',
                    severity: 'info',
                    field: varName,
                    message: `Variable "{${varName}}" = "${valueStr}"`,
                    currentValue: valueStr,
                    details: {
                        variableName: varName,
                        value: valueStr,
                        length: valueStr.length
                    }
                });
                variablesWithValues++;
            }
        }
        
        // ────────────────────────────────────────────────────────────────────
        // CALCULATE SCORE
        // ────────────────────────────────────────────────────────────────────
        score = totalVariables > 0 
            ? Math.round((variablesWithValues / totalVariables) * 100)
            : 0;
        
        // NO SUMMARY CHECK - Just show individual variables
        // Users want to see ONLY what's in the Variables tab list
        
        const failed = checks.filter(c => c.status === 'failed').length;
        const passed = checks.filter(c => c.status === 'passed').length;
        const warnings = checks.filter(c => c.status === 'warning').length;
        
        return {
            component: 'variables',
            companyId: company._id,
            companyName: company.companyName,
            status: variablesBlank > 0 ? 'failed' : 'passed',
            score,
            timestamp: new Date().toISOString(),
            checks,
            summary: {
                total: checks.length,
                passed,
                failed,
                warnings
            },
            metadata: {
                totalVariables,
                withValues: variablesWithValues,
                blank: variablesBlank,
                dataSource: 'aiAgentSettings.variables (AiCore Variables tab)'
            }
        };
    }
    
    /**
     * ========================================================================
     * TWILIO DIAGNOSTIC
     * ========================================================================
     */
    static async checkTwilio(company) {
        const checks = [];
        let score = 0;
        
        // ────────────────────────────────────────────────────────────────────
        // CHECK 1: Twilio Account SID
        // ────────────────────────────────────────────────────────────────────
        const accountSid = company.twilioAccountSid;
        
        if (!accountSid) {
            checks.push({
                id: 'twilio_no_sid',
                type: 'credentials',
                status: 'failed',
                severity: 'critical',
                message: 'Twilio Account SID not configured',
                currentValue: null,
                expectedValue: 'AC[32 characters]',
                impact: ['Cannot receive calls', 'Cannot send SMS', 'AI Agent non-functional'],
                codeReference: {
                    file: 'models/v2Company.js',
                    line: 800,
                    path: 'twilioAccountSid'
                },
                fix: {
                    action: 'manual',
                    description: 'Add Twilio Account SID from Twilio Console'
                }
            });
        } else if (!accountSid.startsWith('AC') || accountSid.length !== 34) {
            checks.push({
                id: 'twilio_invalid_sid',
                type: 'credentials',
                status: 'failed',
                severity: 'critical',
                message: 'Twilio Account SID has invalid format',
                currentValue: accountSid,
                expectedValue: 'AC[32 characters], total length 34',
                impact: ['Cannot authenticate with Twilio', 'API calls will fail'],
                fix: {
                    action: 'manual',
                    description: 'Verify SID from Twilio Console (should start with "AC")'
                }
            });
        } else {
            checks.push({
                id: 'twilio_sid_valid',
                type: 'credentials',
                status: 'passed',
                severity: 'info',
                message: 'Twilio Account SID configured correctly',
                currentValue: `${accountSid.substring(0, 10)}...${accountSid.substring(30)}`,
                details: {
                    length: accountSid.length,
                    format: 'AC + 32 characters'
                }
            });
            score += 33;
        }
        
        // ────────────────────────────────────────────────────────────────────
        // CHECK 2: Twilio Auth Token
        // ────────────────────────────────────────────────────────────────────
        const authToken = company.twilioAuthToken;
        
        if (!authToken) {
            checks.push({
                id: 'twilio_no_token',
                type: 'credentials',
                status: 'failed',
                severity: 'critical',
                message: 'Twilio Auth Token not configured',
                currentValue: null,
                expectedValue: '32 character string',
                impact: ['Cannot authenticate with Twilio', 'API calls will fail'],
                codeReference: {
                    file: 'models/v2Company.js',
                    line: 801,
                    path: 'twilioAuthToken'
                },
                fix: {
                    action: 'manual',
                    description: 'Add Twilio Auth Token from Twilio Console'
                }
            });
        } else if (authToken.length !== 32) {
            checks.push({
                id: 'twilio_invalid_token',
                type: 'credentials',
                status: 'failed',
                severity: 'high',
                message: 'Twilio Auth Token has invalid length',
                currentValue: `${authToken.length} characters`,
                expectedValue: '32 characters',
                fix: {
                    action: 'manual',
                    description: 'Verify Auth Token from Twilio Console'
                }
            });
        } else {
            checks.push({
                id: 'twilio_token_valid',
                type: 'credentials',
                status: 'passed',
                severity: 'info',
                message: 'Twilio Auth Token configured correctly',
                currentValue: '****...****',
                details: {
                    length: authToken.length,
                    note: 'Token masked for security'
                }
            });
            score += 33;
        }
        
        // ────────────────────────────────────────────────────────────────────
        // CHECK 3: Twilio Phone Number
        // ────────────────────────────────────────────────────────────────────
        const phoneNumber = company.twilioPhoneNumber;
        
        if (!phoneNumber) {
            checks.push({
                id: 'twilio_no_phone',
                type: 'configuration',
                status: 'failed',
                severity: 'critical',
                message: 'Twilio Phone Number not configured',
                currentValue: null,
                expectedValue: 'E.164 format: +1XXXXXXXXXX',
                impact: ['No incoming call routing', 'Cannot test AI Agent'],
                codeReference: {
                    file: 'models/v2Company.js',
                    line: 802,
                    path: 'twilioPhoneNumber'
                },
                fix: {
                    action: 'manual',
                    description: 'Add phone number from Twilio Console'
                }
            });
        } else if (!/^\+[1-9]\d{1,14}$/.test(phoneNumber)) {
            checks.push({
                id: 'twilio_invalid_phone',
                type: 'configuration',
                status: 'failed',
                severity: 'high',
                message: 'Twilio Phone Number has invalid format',
                currentValue: phoneNumber,
                expectedValue: 'E.164 format: +1XXXXXXXXXX',
                fix: {
                    action: 'manual',
                    description: 'Format phone number as E.164 (e.g., +12395551234)'
                }
            });
        } else {
            checks.push({
                id: 'twilio_phone_valid',
                type: 'configuration',
                status: 'passed',
                severity: 'info',
                message: 'Twilio Phone Number configured correctly',
                currentValue: phoneNumber,
                details: {
                    format: 'E.164',
                    note: 'Incoming calls will route to this number'
                }
            });
            score += 34;
        }
        
        const failed = checks.filter(c => c.status === 'failed').length;
        const passed = checks.filter(c => c.status === 'passed').length;
        const warnings = checks.filter(c => c.status === 'warning').length;
        
        return {
            component: 'twilio',
            companyId: company._id,
            companyName: company.companyName,
            status: failed > 0 ? 'failed' : 'passed',
            score: Math.round(score),
            timestamp: new Date().toISOString(),
            checks,
            summary: {
                total: checks.length,
                passed,
                failed,
                warnings
            },
            metadata: {
                accountSid: accountSid ? `${accountSid.substring(0, 10)}...` : null,
                phoneNumber: phoneNumber || null
            }
        };
    }
    
    /**
     * ========================================================================
     * VOICE DIAGNOSTIC
     * ========================================================================
     */
    static async checkVoice(company) {
        const checks = [];
        let score = 0;
        
        const voiceSettings = company.aiAgentLogic?.voiceSettings;
        
        // ────────────────────────────────────────────────────────────────────
        // CHECK 1: Voice ID Configured
        // ────────────────────────────────────────────────────────────────────
        const voiceId = voiceSettings?.voiceId;
        
        if (!voiceId) {
            checks.push({
                id: 'voice_no_id',
                type: 'configuration',
                status: 'failed',
                severity: 'critical',
                message: 'ElevenLabs Voice ID not configured',
                currentValue: null,
                expectedValue: '21-character voice ID from ElevenLabs',
                impact: ['Voice responses will fail', 'AI Agent cannot speak'],
                codeReference: {
                    file: 'models/v2Company.js',
                    line: 214,
                    path: 'aiAgentLogic.voiceSettings.voiceId'
                },
                fix: {
                    action: 'navigate',
                    target: 'voice-settings',
                    description: 'Select a voice from ElevenLabs voice library'
                }
            });
        } else {
            checks.push({
                id: 'voice_id_valid',
                type: 'configuration',
                status: 'passed',
                severity: 'info',
                message: 'ElevenLabs Voice ID configured',
                currentValue: voiceId,
                details: {
                    voiceId: voiceId,
                    note: 'Voice will be used for all TTS generation'
                }
            });
            score += 40;
        }
        
        // ────────────────────────────────────────────────────────────────────
        // CHECK 2: Voice Settings (Stability, Similarity)
        // ────────────────────────────────────────────────────────────────────
        const stability = voiceSettings?.stability;
        const similarityBoost = voiceSettings?.similarityBoost;
        
        if (stability !== undefined && (stability < 0 || stability > 1)) {
            checks.push({
                id: 'voice_invalid_stability',
                type: 'configuration',
                status: 'failed',
                severity: 'medium',
                message: 'Voice stability value out of range',
                currentValue: stability,
                expectedValue: 'Number between 0.0 and 1.0',
                fix: {
                    action: 'navigate',
                    target: 'voice-settings',
                    description: 'Adjust stability slider to valid range (0.0 - 1.0)'
                }
            });
        } else if (stability !== undefined) {
            checks.push({
                id: 'voice_stability_valid',
                type: 'configuration',
                status: 'passed',
                severity: 'info',
                message: 'Voice stability configured',
                currentValue: stability,
                details: {
                    stability: stability,
                    recommendation: '0.4-0.6 for natural conversation'
                }
            });
            score += 30;
        }
        
        if (similarityBoost !== undefined && (similarityBoost < 0 || similarityBoost > 1)) {
            checks.push({
                id: 'voice_invalid_similarity',
                type: 'configuration',
                status: 'failed',
                severity: 'medium',
                message: 'Voice similarity boost value out of range',
                currentValue: similarityBoost,
                expectedValue: 'Number between 0.0 and 1.0',
                fix: {
                    action: 'navigate',
                    target: 'voice-settings',
                    description: 'Adjust similarity boost slider to valid range (0.0 - 1.0)'
                }
            });
        } else if (similarityBoost !== undefined) {
            checks.push({
                id: 'voice_similarity_valid',
                type: 'configuration',
                status: 'passed',
                severity: 'info',
                message: 'Voice similarity boost configured',
                currentValue: similarityBoost,
                details: {
                    similarityBoost: similarityBoost,
                    recommendation: '0.7-0.8 for voice consistency'
                }
            });
            score += 30;
        }
        
        // ────────────────────────────────────────────────────────────────────
        // CHECK 3: API Source
        // ────────────────────────────────────────────────────────────────────
        const apiSource = voiceSettings?.apiSource;
        
        if (apiSource === 'clientsvia') {
            checks.push({
                id: 'voice_api_clientsvia',
                type: 'info',
                status: 'passed',
                severity: 'info',
                message: 'Using ClientsVia global ElevenLabs API',
                details: {
                    apiSource: 'clientsvia',
                    note: 'No additional configuration needed',
                    billing: 'Usage billed through ClientsVia'
                }
            });
        } else if (apiSource === 'own') {
            const ownApiKey = voiceSettings?.ownApiKey;
            if (!ownApiKey) {
                checks.push({
                    id: 'voice_no_own_key',
                    type: 'configuration',
                    status: 'warning',
                    severity: 'medium',
                    message: 'Own API key selected but not configured',
                    currentValue: null,
                    expectedValue: 'Valid ElevenLabs API key',
                    fix: {
                        action: 'navigate',
                        target: 'voice-settings',
                        description: 'Add your ElevenLabs API key or switch to ClientsVia API'
                    }
                });
            } else {
                checks.push({
                    id: 'voice_own_key_valid',
                    type: 'configuration',
                    status: 'passed',
                    severity: 'info',
                    message: 'Using own ElevenLabs API key',
                    currentValue: '****...****',
                    details: {
                        apiSource: 'own',
                        note: 'API key masked for security'
                    }
                });
            }
        }
        
        const failed = checks.filter(c => c.status === 'failed').length;
        const passed = checks.filter(c => c.status === 'passed').length;
        const warnings = checks.filter(c => c.status === 'warning').length;
        
        return {
            component: 'voice',
            companyId: company._id,
            companyName: company.companyName,
            status: failed > 0 ? 'failed' : (warnings > 0 ? 'warning' : 'passed'),
            score: Math.round(score),
            timestamp: new Date().toISOString(),
            checks,
            summary: {
                total: checks.length,
                passed,
                failed,
                warnings
            },
            metadata: {
                voiceId: voiceId || null,
                apiSource: apiSource || 'not configured'
            }
        };
    }
    
    /**
     * ========================================================================
     * SCENARIOS DIAGNOSTIC
     * ========================================================================
     */
    static async checkScenarios(company) {
        const checks = [];
        let score = 0;
        
        // Load template to count scenarios
        const templateRefs = company.aiAgentSettings?.templateReferences || [];
        const activeTemplates = templateRefs.filter(ref => ref.enabled !== false);
        
        let totalScenarios = 0;
        let activeScenarios = 0;
        let disabledScenarios = 0;
        let categoryCount = 0;
        
        if (activeTemplates.length > 0) {
            try {
                const template = await GlobalInstantResponseTemplate.findById(activeTemplates[0].templateId)
                    .select('name categories')
                    .lean();
                
                if (template && template.categories) {
                    categoryCount = template.categories.length;
                    
                    // Count scenarios
                    for (const category of template.categories) {
                        if (category.scenarios) {
                            totalScenarios += category.scenarios.length;
                        }
                    }
                    
                    // Check for disabled scenarios
                    const scenarioControls = company.aiAgentSettings?.scenarioControls || [];
                    disabledScenarios = scenarioControls.length;
                    activeScenarios = totalScenarios - disabledScenarios;
                }
            } catch (error) {
                logger.warn('[DIAGNOSTICS] Could not load template for scenario count:', error.message);
            }
        }
        
        // ────────────────────────────────────────────────────────────────────
        // CHECK 1: Scenarios Available
        // ────────────────────────────────────────────────────────────────────
        if (totalScenarios === 0) {
            checks.push({
                id: 'scenarios_none',
                type: 'configuration',
                status: 'failed',
                severity: 'critical',
                message: 'No scenarios available',
                currentValue: 0,
                expectedValue: 'At least 10-20 scenarios for basic coverage',
                impact: [
                    'AI Agent cannot handle customer queries',
                    'No conversation flows available',
                    'Go Live blocked'
                ],
                codeReference: {
                    file: 'models/GlobalInstantResponseTemplate.js',
                    line: 1,
                    path: 'categories[].scenarios'
                },
                fix: {
                    action: 'navigate',
                    target: 'aicore-templates',
                    description: 'Clone a template from Global AI Brain to inherit scenarios'
                }
            });
        } else if (activeScenarios < 10) {
            checks.push({
                id: 'scenarios_low',
                type: 'configuration',
                status: 'warning',
                severity: 'medium',
                message: `Only ${activeScenarios} active scenarios`,
                currentValue: activeScenarios,
                expectedValue: 'At least 10-20 scenarios for good coverage',
                impact: ['Limited conversation handling', 'May not cover common queries'],
                fix: {
                    action: 'navigate',
                    target: 'aicore-live-scenarios',
                    description: 'Review and enable more scenarios'
                }
            });
            score = 50;
        } else {
            checks.push({
                id: 'scenarios_available',
                type: 'configuration',
                status: 'passed',
                severity: 'info',
                message: `${activeScenarios} active scenarios configured`,
                currentValue: activeScenarios,
                details: {
                    total: totalScenarios,
                    active: activeScenarios,
                    disabled: disabledScenarios,
                    categories: categoryCount
                }
            });
            score = 100;
        }
        
        // ────────────────────────────────────────────────────────────────────
        // CHECK 2: Category Coverage
        // ────────────────────────────────────────────────────────────────────
        if (categoryCount > 0) {
            checks.push({
                id: 'scenarios_categories',
                type: 'info',
                status: 'passed',
                severity: 'info',
                message: `Scenarios organized into ${categoryCount} categories`,
                details: {
                    categoryCount: categoryCount,
                    note: 'Categories help organize scenarios by topic'
                }
            });
        }
        
        // ────────────────────────────────────────────────────────────────────
        // CHECK 3: Disabled Scenarios
        // ────────────────────────────────────────────────────────────────────
        if (disabledScenarios > 0) {
            checks.push({
                id: 'scenarios_disabled',
                type: 'info',
                status: 'passed',
                severity: 'info',
                message: `${disabledScenarios} scenario(s) manually disabled`,
                details: {
                    disabled: disabledScenarios,
                    note: 'Disabled scenarios will not be used by AI Agent'
                }
            });
        }
        
        const failed = checks.filter(c => c.status === 'failed').length;
        const passed = checks.filter(c => c.status === 'passed').length;
        const warnings = checks.filter(c => c.status === 'warning').length;
        
        return {
            component: 'scenarios',
            companyId: company._id,
            companyName: company.companyName,
            status: failed > 0 ? 'failed' : (warnings > 0 ? 'warning' : 'passed'),
            score,
            timestamp: new Date().toISOString(),
            checks,
            summary: {
                total: checks.length,
                passed,
                failed,
                warnings
            },
            metadata: {
                totalScenarios,
                activeScenarios,
                disabledScenarios,
                categoryCount
            }
        };
    }
}

module.exports = DiagnosticService;

