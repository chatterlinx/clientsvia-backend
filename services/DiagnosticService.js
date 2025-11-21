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
                .select('companyName configuration aiAgentSettings aiAgentSettings twilioConfig')
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
                case 'cheatsheet':
                    return await this.checkCheatSheet(company);
                case 'frontline-intel':
                    return await this.checkFrontlineIntel(company);
                case 'tier-settings':
                    return await this.check3TierSettings(company);
                case 'tier-llm':
                    return await this.check3TierLlm(company);
                case 'brain-llm':
                    return await this.checkBrainLlm(company);
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
                    target: 'templates',
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
            const clonedAt = template.clonedAt ? new Date(template.clonedAt) : null;
            const now = new Date();
            
            // ✅ FIX: Calculate days correctly - check activation date if never synced
            let daysSinceSync = 0;
            let isNewTemplate = false;
            
            if (lastSynced) {
                // Template has been synced - calculate days since last sync
                daysSinceSync = Math.floor((now - lastSynced) / (1000 * 60 * 60 * 24));
            } else if (clonedAt) {
                // Never synced - check if it's a new template (< 7 days old)
                const daysSinceActivation = Math.floor((now - clonedAt) / (1000 * 60 * 60 * 24));
                isNewTemplate = daysSinceActivation < 7;
                daysSinceSync = daysSinceActivation;
            } else {
                // No sync date AND no clone date - unknown age
                daysSinceSync = 999;
            }
            
            // Only show warning if template is old AND not synced recently
            if (!isNewTemplate && daysSinceSync > 30) {
                checks.push({
                    id: 'tmpl_sync_old',
                    type: 'maintenance',
                    status: 'warning',
                    severity: 'medium',
                    message: lastSynced ? `Template not synced in ${daysSinceSync} days` : `Template activated ${daysSinceSync} days ago but never synced`,
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
            } else if (isNewTemplate) {
                // New template (< 7 days) - no warning needed
                checks.push({
                    id: 'tmpl_new',
                    type: 'info',
                    status: 'passed',
                    severity: 'info',
                    message: `Template recently activated (${daysSinceSync} day(s) ago)`,
                    details: {
                        clonedAt: clonedAt?.toISOString(),
                        note: 'Sync recommended after 30 days'
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
        
        // ✨ FIX: Check DEFINITIONS first (source of truth for which variables exist)
        // Then verify each has a value in the VALUES Map
        const variableDefinitions = company.aiAgentSettings?.variableDefinitions || [];
        const variablesMap = company.aiAgentSettings?.variables || {};
        
        // Convert Map to object if needed
        let variables = {};
        if (variablesMap instanceof Map) {
            variables = Object.fromEntries(variablesMap);
        } else if (typeof variablesMap === 'object' && variablesMap !== null) {
            variables = variablesMap;
        }
        
        const totalVariables = variableDefinitions.length;
        
        logger.debug(`[DIAGNOSTICS] Checking ${totalVariables} AiCore variables from aiAgentSettings.variableDefinitions`);
        logger.debug(`[DIAGNOSTICS] Current values in Map: ${Object.keys(variables).length}`);
        
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
                    'No template placeholders detected',
                    'If templates use {variables}, run Force Scan to detect them'
                ],
                codeReference: {
                    file: 'models/v2Company.js',
                    line: 1833,
                    path: 'aiAgentSettings.variableDefinitions'
                },
                fix: {
                    action: 'navigate',
                    target: 'variables',
                    description: 'Run Force Scan to detect variables from templates'
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
        // CHECK 2: Iterate over DEFINITIONS and check if each has a VALUE
        // ────────────────────────────────────────────────────────────────────
        let variablesWithValues = 0;
        let variablesBlank = 0;
        
        for (const definition of variableDefinitions) {
            const varName = definition.key;
            
            // ✨ FIX: Look up value in VALUES Map using the definition key
            const varValue = variables[varName];
            
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
                // Variable exists in definitions but has NO VALUE - RED X WARNING
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
                        length: valueStr.length,
                        category: definition.category || 'General',
                        usageCount: definition.usageCount || 0
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
        
        // ✨ FIX: Check twilioConfig object (CORRECT location in schema)
        const twilioConfig = company.twilioConfig || {};
        
        // ────────────────────────────────────────────────────────────────────
        // CHECK 1: Twilio Account SID
        // ────────────────────────────────────────────────────────────────────
        const accountSid = twilioConfig.accountSid;
        
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
                    line: 44,
                    path: 'twilioConfig.accountSid'
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
        const authToken = twilioConfig.authToken;
        
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
                    line: 45,
                    path: 'twilioConfig.authToken'
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
        // Check both new multi-phone system and legacy single number
        const phoneNumbers = twilioConfig.phoneNumbers || [];
        const legacyPhone = twilioConfig.phoneNumber;
        const phoneNumber = phoneNumbers.length > 0 
            ? phoneNumbers[0].phoneNumber 
            : legacyPhone;
        
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
                    line: 49,
                    path: 'twilioConfig.phoneNumbers / twilioConfig.phoneNumber'
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
                phoneNumber: phoneNumber || null,
                phoneNumbersCount: phoneNumbers.length,
                hasLegacyPhone: Boolean(legacyPhone),
                hasMultiPhone: phoneNumbers.length > 0
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
        
        const voiceSettings = company.aiAgentSettings?.voiceSettings;
        
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
                    path: 'aiAgentSettings.voiceSettings.voiceId'
                },
                fix: {
                    action: 'navigate',
                    target: 'voicecore',
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
                    target: 'voicecore',
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
                    target: 'voicecore',
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
                    target: 'voicecore',
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
        const allCategories = new Set();
        
        // ✅ FIX: Loop through ALL active templates (not just first one)
        if (activeTemplates.length > 0) {
            for (const templateRef of activeTemplates) {
                try {
                    const template = await GlobalInstantResponseTemplate.findById(templateRef.templateId)
                        .select('name categories')
                        .lean();
                    
                    if (template && template.categories) {
                        // Count scenarios from this template
                        for (const category of template.categories) {
                            // Track unique categories
                            allCategories.add(category.categoryId || category.name);
                            
                            if (category.scenarios) {
                                totalScenarios += category.scenarios.length;
                            }
                        }
                    }
                } catch (error) {
                    logger.warn(`[DIAGNOSTICS] Could not load template ${templateRef.templateId}:`, error.message);
                }
            }
            
            // Total unique categories across all templates
            categoryCount = allCategories.size;
            
            // ✅ FIX: Check for disabled scenarios (only count where isEnabled === false)
            const scenarioControls = company.aiAgentSettings?.scenarioControls || [];
            disabledScenarios = scenarioControls.filter(c => c.isEnabled === false).length;
            activeScenarios = totalScenarios - disabledScenarios;
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
                    target: 'templates',
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
                    target: 'live-scenarios',
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
    
    /**
     * ========================================================================
     * CHEATSHEET DIAGNOSTIC
     * ========================================================================
     */
    static async checkCheatSheet(company) {
        const checks = [];
        let score = 0;
        const maxScore = 100;
        
        const liveVersionId = company.aiAgentSettings?.cheatSheetMeta?.liveVersionId;
        
        // Check 1: Live configuration exists
        if (liveVersionId) {
            const CheatSheetVersion = require('../models/cheatsheet/CheatSheetVersion');
            const liveVersion = await CheatSheetVersion.findOne({
                versionId: liveVersionId,
                status: 'live'
            }).lean();
            
            if (liveVersion) {
                checks.push({
                    name: 'Live Configuration',
                    status: 'PASS',
                    message: `Live version "${liveVersion.name}" (${liveVersionId})`,
                    details: `Last updated: ${new Date(liveVersion.updatedAt).toLocaleString()}`,
                    target: 'cheat-sheet'
                });
                score += 40;
                
                // Check 2: Frontline-Intel instructions
                const instructions = liveVersion.config?.frontlineIntel?.instructions || '';
                if (instructions.trim().length > 50) {
                    checks.push({
                        name: 'Frontline-Intel Instructions',
                        status: 'PASS',
                        message: `Instructions configured (${instructions.length} characters)`,
                        target: 'cheat-sheet'
                    });
                    score += 40;
                } else {
                    checks.push({
                        name: 'Frontline-Intel Instructions',
                        status: 'FAIL',
                        message: 'Frontline-Intel instructions missing or too short',
                        details: 'AI needs core instructions to function properly',
                        fix: 'Fill out Frontline-Intel in CheatSheet tab',
                        target: 'cheat-sheet'
                    });
                }
                
                // Check 3: Section coverage
                const config = liveVersion.config || {};
                const sections = {
                    triage: Object.keys(config.triage || {}).length > 0,
                    frontlineIntel: instructions.trim().length > 0,
                    transferRules: Object.keys(config.transferRules || {}).length > 0,
                    edgeCases: Object.keys(config.edgeCases || {}).length > 0,
                    behavior: Object.keys(config.behavior || {}).length > 0,
                    guardrails: Object.keys(config.guardrails || {}).length > 0
                };
                
                const populatedCount = Object.values(sections).filter(Boolean).length;
                
                if (populatedCount >= 3) {
                    checks.push({
                        name: 'Section Coverage',
                        status: 'PASS',
                        message: `${populatedCount}/6 sections configured`,
                        target: 'cheat-sheet'
                    });
                    score += 20;
                } else {
                    checks.push({
                        name: 'Section Coverage',
                        status: 'WARN',
                        message: `Only ${populatedCount}/6 sections configured`,
                        details: 'More sections = better AI guidance',
                        target: 'cheat-sheet'
                    });
                    score += 10;
                }
            } else {
                checks.push({
                    name: 'Live Configuration',
                    status: 'FAIL',
                    message: 'Live version not found in database',
                    details: `Pointer exists (${liveVersionId}) but version is missing`,
                    fix: 'Create a new CheatSheet configuration',
                    target: 'cheat-sheet'
                });
            }
        } else {
            checks.push({
                name: 'Live Configuration',
                status: 'FAIL',
                message: 'No live CheatSheet configuration',
                details: 'AI has no instructions to follow',
                fix: 'Configure CheatSheet in Control Plane V2',
                target: 'cheat-sheet'
            });
        }
        
        const passed = checks.filter(c => c.status === 'PASS').length;
        const failed = checks.filter(c => c.status === 'FAIL').length;
        const warnings = checks.filter(c => c.status === 'WARN').length;
        
        return {
            component: 'cheatsheet',
            score,
            maxScore,
            status: score >= 80 ? 'HEALTHY' : score >= 50 ? 'WARNING' : 'CRITICAL',
            timestamp: new Date().toISOString(),
            checks,
            summary: {
                total: checks.length,
                passed,
                failed,
                warnings
            }
        };
    }
    
    /**
     * ========================================================================
     * FRONTLINE-INTEL DIAGNOSTIC (Detailed check for just the instructions)
     * ========================================================================
     */
    static async checkFrontlineIntel(company) {
        const checks = [];
        let score = 0;
        const maxScore = 100;
        
        const liveVersionId = company.aiAgentSettings?.cheatSheetMeta?.liveVersionId;
        
        if (liveVersionId) {
            const CheatSheetVersion = require('../models/cheatsheet/CheatSheetVersion');
            const liveVersion = await CheatSheetVersion.findOne({
                versionId: liveVersionId,
                status: 'live'
            }).lean();
            
            if (liveVersion) {
                const instructions = liveVersion.config?.frontlineIntel?.instructions || '';
                const wordCount = instructions.trim().split(/\s+/).length;
                const lineCount = instructions.trim().split('\n').length;
                
                // Check 1: Instructions exist
                if (instructions.trim().length > 0) {
                    checks.push({
                        name: 'Instructions Exist',
                        status: 'PASS',
                        message: `Frontline-Intel configured`,
                        details: `${instructions.length} characters, ${wordCount} words, ${lineCount} lines`,
                        target: 'cheat-sheet'
                    });
                    score += 30;
                } else {
                    checks.push({
                        name: 'Instructions Exist',
                        status: 'FAIL',
                        message: 'Frontline-Intel instructions are empty',
                        details: 'AI has no core guidance',
                        fix: 'Add instructions in CheatSheet → Frontline-Intel',
                        target: 'cheat-sheet'
                    });
                }
                
                // Check 2: Adequate length
                if (wordCount >= 50) {
                    checks.push({
                        name: 'Adequate Length',
                        status: 'PASS',
                        message: `${wordCount} words (sufficient)`,
                        target: 'cheat-sheet'
                    });
                    score += 30;
                } else if (wordCount > 0) {
                    checks.push({
                        name: 'Adequate Length',
                        status: 'WARN',
                        message: `Only ${wordCount} words (recommend 50+)`,
                        details: 'More detailed instructions = better AI performance',
                        target: 'cheat-sheet'
                    });
                    score += 15;
                } else {
                    checks.push({
                        name: 'Adequate Length',
                        status: 'FAIL',
                        message: 'Instructions too short',
                        target: 'cheat-sheet'
                    });
                }
                
                // Check 3: Not placeholder
                const lowerInstructions = instructions.toLowerCase();
                const isPlaceholder = lowerInstructions.includes('coming soon') ||
                                     lowerInstructions.includes('placeholder') ||
                                     lowerInstructions.includes('todo') ||
                                     lowerInstructions.includes('tbd');
                
                if (!isPlaceholder) {
                    checks.push({
                        name: 'Real Content',
                        status: 'PASS',
                        message: 'Instructions contain real content',
                        target: 'cheat-sheet'
                    });
                    score += 20;
                } else {
                    checks.push({
                        name: 'Real Content',
                        status: 'WARN',
                        message: 'Instructions contain placeholder text',
                        details: 'Replace placeholder with actual instructions',
                        target: 'cheat-sheet'
                    });
                    score += 10;
                }
                
                // Check 4: Key sections present
                const hasMission = /mission|purpose|goal/i.test(instructions);
                const hasProtocol = /protocol|process|procedure/i.test(instructions);
                const hasExamples = /example|such as|for instance/i.test(instructions);
                
                const sectionCount = [hasMission, hasProtocol, hasExamples].filter(Boolean).length;
                
                if (sectionCount >= 2) {
                    checks.push({
                        name: 'Key Sections',
                        status: 'PASS',
                        message: `${sectionCount}/3 key sections found (mission/protocol/examples)`,
                        target: 'cheat-sheet'
                    });
                    score += 20;
                } else {
                    checks.push({
                        name: 'Key Sections',
                        status: 'WARN',
                        message: `Only ${sectionCount}/3 key sections found`,
                        details: 'Include: mission statement, protocols, and examples',
                        target: 'cheat-sheet'
                    });
                    score += 10;
                }
            } else {
                checks.push({
                    name: 'Live Configuration',
                    status: 'FAIL',
                    message: 'Live version not found',
                    target: 'cheat-sheet'
                });
            }
        } else {
            checks.push({
                name: 'Live Configuration',
                status: 'FAIL',
                message: 'No live CheatSheet configuration',
                fix: 'Configure CheatSheet first',
                target: 'cheat-sheet'
            });
        }
        
        const passed = checks.filter(c => c.status === 'PASS').length;
        const failed = checks.filter(c => c.status === 'FAIL').length;
        const warnings = checks.filter(c => c.status === 'WARN').length;
        
        return {
            component: 'frontline-intel',
            score,
            maxScore,
            status: score >= 80 ? 'HEALTHY' : score >= 50 ? 'WARNING' : 'CRITICAL',
            timestamp: new Date().toISOString(),
            checks,
            summary: {
                total: checks.length,
                passed,
                failed,
                warnings
            }
        };
    }
    
    /**
     * ========================================================================
     * 3-TIER SETTINGS DIAGNOSTIC
     * ========================================================================
     */
    static async check3TierSettings(company) {
        const checks = [];
        let score = 0;
        const maxScore = 100;
        
        const intelligenceSettings = company.aiAgentSettings?.intelligenceSettings || {};
        const enabled = intelligenceSettings.enable3TierIntelligence === true;
        
        // ────────────────────────────────────────────────────────────────────
        // CHECK 1: 3-Tier Intelligence Enabled
        // ────────────────────────────────────────────────────────────────────
        checks.push({
            id: '3tier_enabled',
            type: 'configuration',
            status: enabled ? 'passed' : 'failed',
            severity: enabled ? 'info' : 'critical',
            message: enabled ? '3-Tier Intelligence is enabled' : '3-Tier Intelligence is disabled',
            currentValue: enabled ? 'Enabled' : 'Disabled',
            expectedValue: 'Enabled',
            impact: enabled ? [] : [
                'Advanced AI routing unavailable',
                'No intelligent tier escalation',
                'Missing performance optimization',
                'Reduced cost efficiency'
            ],
            codeReference: {
                file: 'models/v2Company.js',
                path: 'aiAgentSettings.intelligenceSettings.enable3TierIntelligence'
            },
            fix: {
                action: 'navigate',
                target: 'aicore-settings',
                description: 'Enable 3-Tier Intelligence in AI Agent Settings'
            }
        });
        
        if (enabled) score += 40;
        
        // ────────────────────────────────────────────────────────────────────
        // CHECK 2: Active Tiers
        // ────────────────────────────────────────────────────────────────────
        const tier1Active = intelligenceSettings.enableTier1 === true;
        const tier2Active = intelligenceSettings.enableTier2 === true;
        const tier3Active = intelligenceSettings.enableTier3 === true;
        const activeTierCount = [tier1Active, tier2Active, tier3Active].filter(Boolean).length;
        
        checks.push({
            id: '3tier_active_tiers',
            type: 'configuration',
            status: activeTierCount > 0 ? 'passed' : 'failed',
            severity: activeTierCount > 0 ? 'info' : 'critical',
            message: `${activeTierCount} out of 3 tiers are active`,
            details: {
                tier1: tier1Active ? 'Active' : 'Inactive',
                tier2: tier2Active ? 'Active' : 'Inactive',
                tier3: tier3Active ? 'Active' : 'Inactive'
            },
            currentValue: `${activeTierCount} tiers active`,
            expectedValue: 'At least 1 tier active',
            impact: activeTierCount === 0 ? [
                'No AI routing available',
                'System cannot classify requests',
                'All calls will fail'
            ] : [],
            fix: {
                action: 'navigate',
                target: 'aicore-settings',
                description: 'Enable at least one tier (Tier 1, 2, or 3)'
            }
        });
        
        if (activeTierCount > 0) score += 30;
        
        // ────────────────────────────────────────────────────────────────────
        // CHECK 3: Confidence Thresholds
        // ────────────────────────────────────────────────────────────────────
        const thresholds = intelligenceSettings.confidenceThresholds || {};
        const hasThresholds = (thresholds.tier1 !== undefined && thresholds.tier2 !== undefined);
        
        checks.push({
            id: '3tier_thresholds',
            type: 'configuration',
            status: hasThresholds ? 'passed' : 'failed',
            severity: hasThresholds ? 'info' : 'warning',
            message: hasThresholds ? 'Confidence thresholds configured' : 'Confidence thresholds not set',
            details: hasThresholds ? {
                tier1Threshold: thresholds.tier1,
                tier2Threshold: thresholds.tier2
            } : null,
            currentValue: hasThresholds ? 'Configured' : 'Not set',
            expectedValue: 'Configured',
            impact: hasThresholds ? [] : [
                'Sub-optimal tier routing',
                'May escalate too frequently',
                'Reduced cost efficiency'
            ],
            fix: {
                action: 'navigate',
                target: 'aicore-settings',
                description: 'Set confidence thresholds for tier routing'
            }
        });
        
        if (hasThresholds) score += 30;
        
        const passed = checks.filter(c => c.status === 'passed').length;
        const failed = checks.filter(c => c.status === 'failed').length;
        
        return {
            component: 'tier-settings',
            companyId: company._id.toString(),
            companyName: company.companyName,
            status: score >= 80 ? 'passed' : score >= 50 ? 'warning' : 'critical',
            score,
            maxScore,
            timestamp: new Date().toISOString(),
            checks,
            summary: {
                total: checks.length,
                passed,
                failed,
                warnings: 0
            }
        };
    }
    
    /**
     * ========================================================================
     * 3-TIER LLM DIAGNOSTIC
     * ========================================================================
     */
    static async check3TierLlm(company) {
        const checks = [];
        let score = 0;
        const maxScore = 100;
        
        const llmSettings = company.aiAgentSettings?.llmSettings || {};
        const provider = llmSettings.llmProvider;
        const apiKey = llmSettings.openAIApiKey || llmSettings.anthropicApiKey;
        
        // ────────────────────────────────────────────────────────────────────
        // CHECK 1: LLM Provider Configured
        // ────────────────────────────────────────────────────────────────────
        checks.push({
            id: 'tier_llm_provider',
            type: 'configuration',
            status: provider ? 'passed' : 'failed',
            severity: provider ? 'info' : 'critical',
            message: provider ? `LLM Provider: ${provider}` : 'No LLM provider configured',
            currentValue: provider || 'Not set',
            expectedValue: 'OpenAI or Anthropic',
            impact: provider ? [] : [
                'Cannot generate AI responses',
                'Tier 3 routing unavailable',
                'All calls will fail'
            ],
            codeReference: {
                file: 'models/v2Company.js',
                path: 'aiAgentSettings.llmSettings.llmProvider'
            },
            fix: {
                action: 'navigate',
                target: 'aicore-settings',
                description: 'Select an LLM provider (OpenAI or Anthropic)'
            }
        });
        
        if (provider) score += 50;
        
        // ────────────────────────────────────────────────────────────────────
        // CHECK 2: API Key Configured
        // ────────────────────────────────────────────────────────────────────
        checks.push({
            id: 'tier_llm_api_key',
            type: 'configuration',
            status: apiKey ? 'passed' : 'failed',
            severity: apiKey ? 'info' : 'critical',
            message: apiKey ? 'API key configured' : 'No API key configured',
            currentValue: apiKey ? '••••••••' : 'Not set',
            expectedValue: 'Valid API key',
            impact: apiKey ? [] : [
                'Cannot connect to LLM provider',
                'All AI requests will fail',
                'System is non-functional'
            ],
            codeReference: {
                file: 'models/v2Company.js',
                path: 'aiAgentSettings.llmSettings.openAIApiKey / anthropicApiKey'
            },
            fix: {
                action: 'navigate',
                target: 'aicore-settings',
                description: 'Add your LLM provider API key'
            }
        });
        
        if (apiKey) score += 50;
        
        // Note: Actual connection test will be done by background health monitor
        const passed = checks.filter(c => c.status === 'passed').length;
        const failed = checks.filter(c => c.status === 'failed').length;
        
        return {
            component: 'tier-llm',
            companyId: company._id.toString(),
            companyName: company.companyName,
            status: score >= 80 ? 'passed' : score >= 50 ? 'warning' : 'critical',
            score,
            maxScore,
            timestamp: new Date().toISOString(),
            checks,
            summary: {
                total: checks.length,
                passed,
                failed,
                warnings: 0
            },
            note: 'Full connection test will be performed by background health monitor'
        };
    }
    
    /**
     * ========================================================================
     * BRAIN LLM (ORCHESTRATOR) DIAGNOSTIC
     * ========================================================================
     */
    static async checkBrainLlm(company) {
        const checks = [];
        let score = 0;
        const maxScore = 100;
        
        const brainLlmSettings = company.aiAgentSettings?.brainLlmSettings || {};
        const apiKey = brainLlmSettings.apiKey;
        const model = brainLlmSettings.model;
        
        // ────────────────────────────────────────────────────────────────────
        // CHECK 1: Brain LLM API Key
        // ────────────────────────────────────────────────────────────────────
        checks.push({
            id: 'brain_llm_api_key',
            type: 'configuration',
            status: apiKey ? 'passed' : 'failed',
            severity: apiKey ? 'info' : 'critical',
            message: apiKey ? 'Brain LLM API key configured' : 'No Brain LLM API key',
            currentValue: apiKey ? '••••••••' : 'Not set',
            expectedValue: 'Valid API key',
            impact: apiKey ? [] : [
                'Cannot classify requests',
                'No intelligent routing',
                'AI orchestrator unavailable',
                'System cannot function'
            ],
            codeReference: {
                file: 'models/v2Company.js',
                path: 'aiAgentSettings.brainLlmSettings.apiKey'
            },
            fix: {
                action: 'navigate',
                target: 'aicore-settings',
                description: 'Add Brain/Orchestrator LLM API key'
            }
        });
        
        if (apiKey) score += 60;
        
        // ────────────────────────────────────────────────────────────────────
        // CHECK 2: Brain LLM Model
        // ────────────────────────────────────────────────────────────────────
        checks.push({
            id: 'brain_llm_model',
            type: 'configuration',
            status: model ? 'passed' : 'failed',
            severity: model ? 'info' : 'critical',
            message: model ? `Brain LLM Model: ${model}` : 'No Brain LLM model configured',
            currentValue: model || 'Not set',
            expectedValue: 'Valid LLM model (e.g., gpt-4, claude-3)',
            impact: model ? [] : [
                'Cannot initialize orchestrator',
                'Request classification will fail',
                'No AI routing available'
            ],
            codeReference: {
                file: 'models/v2Company.js',
                path: 'aiAgentSettings.brainLlmSettings.model'
            },
            fix: {
                action: 'navigate',
                target: 'aicore-settings',
                description: 'Select a Brain/Orchestrator LLM model'
            }
        });
        
        if (model) score += 40;
        
        // Note: Actual connection test will be done by background health monitor
        const passed = checks.filter(c => c.status === 'passed').length;
        const failed = checks.filter(c => c.status === 'failed').length;
        
        return {
            component: 'brain-llm',
            companyId: company._id.toString(),
            companyName: company.companyName,
            status: score >= 80 ? 'passed' : score >= 50 ? 'warning' : 'critical',
            score,
            maxScore,
            timestamp: new Date().toISOString(),
            checks,
            summary: {
                total: checks.length,
                passed,
                failed,
                warnings: 0
            },
            note: 'Full connection test will be performed by background health monitor'
        };
    }
}

module.exports = DiagnosticService;

