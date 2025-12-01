/**
 * ============================================================================
 * FRONTLINE SCRIPT BUILDER SERVICE
 * ============================================================================
 * 
 * PURPOSE: Generate Frontline-Intel scripts using LLM + company context
 * 
 * FLOW:
 * 1. Load context (company, Brain-2 categories/scenarios, triage, booking, transfer)
 * 2. Build structured LLM prompt
 * 3. Call LLM to generate script
 * 4. Validate and return
 * 
 * MULTI-TENANT: All data scoped by companyId. Never cross-contaminates.
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');
const Company = require('../models/v2Company');
const TriageCard = require('../models/TriageCard');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
const FrontlineScriptDraft = require('../models/FrontlineScriptDraft');
const openaiClient = require('../config/openai');

// ============================================================================
// TONE PRESETS
// ============================================================================
const TONE_PRESETS = {
    professional_warm: {
        name: 'Professional & Warm',
        description: 'Friendly but businesslike. Builds trust quickly.',
        style: 'Be warm and personable while maintaining professionalism. Use phrases like "I\'d be happy to help" and "Let me take care of that for you."'
    },
    casual_friendly: {
        name: 'Casual & Friendly',
        description: 'Relaxed, approachable, conversational.',
        style: 'Be conversational and relaxed. Use contractions freely. Feel like a helpful neighbor rather than a corporate representative.'
    },
    strict_corporate: {
        name: 'Strict Corporate',
        description: 'Formal, precise, no small talk.',
        style: 'Maintain formal language throughout. Avoid contractions. Be efficient and direct. Suitable for legal, financial, or enterprise clients.'
    },
    empathetic_supportive: {
        name: 'Empathetic & Supportive',
        description: 'Extra patient, understanding, great for sensitive industries.',
        style: 'Lead with empathy. Acknowledge concerns before problem-solving. Use phrases like "I understand how frustrating that must be" and "We\'re here for you."'
    }
};

// ============================================================================
// AGGRESSIVENESS LEVELS
// ============================================================================
const AGGRESSIVENESS_LEVELS = {
    low: {
        name: 'Low',
        description: 'Ask once, respect hesitation.',
        style: 'Gently offer to capture contact information. If caller declines, proceed without pushing.'
    },
    medium: {
        name: 'Medium',
        description: 'Ask twice if first declined, explain value.',
        style: 'If caller doesn\'t volunteer information, ask directly. If they hesitate, explain why it helps (e.g., "So we can call you back if disconnected").'
    },
    high: {
        name: 'High',
        description: 'Persistent capture, always get contact before routing.',
        style: 'Always capture name and callback number before any routing. If caller tries to skip, redirect: "I just need one quick piece of info first."'
    }
};

class FrontlineScriptBuilder {
    
    /**
     * ========================================================================
     * LOAD CONTEXT FOR SCRIPT BUILDER
     * ========================================================================
     * Gathers all company data needed to build an intelligent script.
     * Tries multiple paths to find Brain-2 data.
     * 
     * @param {string} companyId
     * @returns {Promise<Object>}
     */
    static async loadContext(companyId) {
        logger.info('[SCRIPT BUILDER] Loading context', { companyId });
        
        // Load company
        const company = await Company.findById(companyId).lean();
        if (!company) {
            throw new Error('Company not found');
        }
        
        // ====================================================================
        // LOAD BRAIN-2 DATA (multiple paths)
        // ====================================================================
        let brain2 = { categories: [], scenarios: [] };
        
        // Path 1: Try clonedFrom template
        const templateId = company.configuration?.clonedFrom || 
                          company.aiAgentSettings?.templateId ||
                          company.templateId;
        
        if (templateId) {
            const template = await GlobalInstantResponseTemplate.findById(templateId).lean();
            if (template) {
                brain2 = this.extractBrain2Data(template);
                logger.debug('[SCRIPT BUILDER] Found Brain-2 data from template', { templateId });
            }
        }
        
        // Path 2: If no template, try embedded aiAgentSettings.categories
        if (brain2.categories.length === 0 && company.aiAgentSettings?.categories) {
            brain2 = this.extractBrain2FromEmbedded(company.aiAgentSettings);
            logger.debug('[SCRIPT BUILDER] Found Brain-2 data from embedded aiAgentSettings');
        }
        
        // Path 3: If still empty, try globalInstantResponseTemplates by trade
        if (brain2.categories.length === 0 && company.trade) {
            const tradeTemplate = await GlobalInstantResponseTemplate.findOne({
                $or: [
                    { trade: company.trade },
                    { tradeName: company.trade },
                    { name: { $regex: company.trade, $options: 'i' } }
                ],
                isActive: true
            }).lean();
            
            if (tradeTemplate) {
                brain2 = this.extractBrain2Data(tradeTemplate);
                logger.debug('[SCRIPT BUILDER] Found Brain-2 data from trade template', { trade: company.trade });
            }
        }
        
        // ====================================================================
        // LOAD TRIAGE CARDS (try multiple query patterns)
        // ====================================================================
        let triageCards = await TriageCard.find({
            companyId,
            isActive: { $ne: false } // Include those without isActive field
        }).sort({ priority: -1 }).lean();
        
        // Also try company string match
        if (triageCards.length === 0) {
            triageCards = await TriageCard.find({
                company: companyId,
                isActive: { $ne: false }
            }).sort({ priority: -1 }).lean();
        }
        
        // ====================================================================
        // EXTRACT VARIABLES FROM COMPANY
        // ====================================================================
        const variables = company.configuration?.variables || 
                         company.variables || 
                         company.aiAgentSettings?.variables || {};
        
        // Handle Map vs Object
        const getVar = (key, fallback = '') => {
            if (variables instanceof Map) return variables.get(key) || fallback;
            return variables[key] || fallback;
        };
        
        // ====================================================================
        // BUILD CONTEXT
        // ====================================================================
        const bookingRules = this.extractBookingRules(company);
        const transferRules = this.extractTransferRules(company);
        
        const context = {
            companyId: companyId.toString(),
            company: {
                name: company.name || getVar('companyName', 'Company'),
                trade: company.trade || company.industry || getVar('companyType', 'Service'),
                mainPhone: company.twilioConfig?.phoneNumber || company.primaryPhone || getVar('companyPhone', ''),
                emergencyPhone: company.twilioConfig?.emergencyPhone || getVar('emergencyPhone', ''),
                billingPhone: getVar('billingPhone', ''),
                techSupportPhone: getVar('techSupportPhone', ''),
                serviceAreas: company.serviceAreas || getVar('serviceAreas', []),
                businessHours: company.agentSetup?.operatingHours ? 
                    this.formatOperatingHours(company.agentSetup.operatingHours) : 
                    getVar('businessHours', 'Contact for hours'),
                greeting: getVar('greeting', 'Thank you for calling. How can I help you today?'),
                bookingUrl: getVar('bookingUrl', '')
            },
            brain2,
            triage: {
                cards: triageCards.map(card => ({
                    id: card._id.toString(),
                    title: card.displayName || card.triageLabel || card.name,
                    action: card.quickRuleConfig?.action || card.action || 'DIRECT_TO_3TIER',
                    intentTag: card.intent || card.triageLabel?.toUpperCase().replace(/\s+/g, '_') || 'GENERAL',
                    mustHaveKeywords: card.quickRuleConfig?.keywordsMustHave || card.keywords || [],
                    excludeKeywords: card.quickRuleConfig?.keywordsExclude || []
                }))
            },
            bookingRules,
            transferRules
        };
        
        logger.info('[SCRIPT BUILDER] Context loaded', {
            companyId,
            companyName: context.company.name,
            trade: context.company.trade,
            categoriesCount: context.brain2.categories.length,
            scenariosCount: context.brain2.scenarios.length,
            triageCardsCount: context.triage.cards.length,
            bookingRulesCount: context.bookingRules.length,
            transferRulesCount: context.transferRules.length
        });
        
        return context;
    }
    
    /**
     * Extract Brain-2 data from embedded aiAgentSettings
     */
    static extractBrain2FromEmbedded(aiAgentSettings) {
        const categories = [];
        const scenarios = [];
        
        if (aiAgentSettings.categories && Array.isArray(aiAgentSettings.categories)) {
            for (const cat of aiAgentSettings.categories) {
                categories.push({
                    id: cat._id?.toString() || cat.id || `cat_${categories.length}`,
                    name: cat.name || cat.categoryName,
                    description: cat.description || ''
                });
                
                const catScenarios = cat.scenarios || cat.items || [];
                for (const scn of catScenarios) {
                    scenarios.push({
                        id: scn._id?.toString() || scn.id || `scn_${scenarios.length}`,
                        categoryId: cat._id?.toString() || cat.id,
                        title: scn.name || scn.scenarioName || scn.title,
                        goal: scn.objective || scn.goal || scn.description || '',
                        keyPhrases: scn.triggerPhrases || scn.triggers || scn.keywords || []
                    });
                }
            }
        }
        
        return { categories, scenarios };
    }
    
    /**
     * Extract Brain-2 categories and scenarios from template
     */
    static extractBrain2Data(template) {
        const categories = [];
        const scenarios = [];
        
        if (template.categories && Array.isArray(template.categories)) {
            for (const cat of template.categories) {
                categories.push({
                    id: cat._id?.toString() || cat.id,
                    name: cat.name,
                    description: cat.description || ''
                });
                
                if (cat.scenarios && Array.isArray(cat.scenarios)) {
                    for (const scn of cat.scenarios) {
                        scenarios.push({
                            id: scn._id?.toString() || scn.id,
                            categoryId: cat._id?.toString() || cat.id,
                            title: scn.name || scn.title,
                            goal: scn.objective || scn.goal || '',
                            keyPhrases: scn.triggerPhrases || scn.keyPhrases || []
                        });
                    }
                }
            }
        }
        
        return { categories, scenarios };
    }
    
    /**
     * Extract booking rules from company config
     */
    static extractBookingRules(company) {
        const rules = [];
        const schedulingRules = company.agentSetup?.schedulingRules || [];
        
        for (const rule of schedulingRules) {
            rules.push({
                id: rule._id?.toString() || `rule_${rules.length}`,
                serviceType: rule.serviceName || 'Service',
                priority: rule.priority || 50,
                entitiesRequired: ['name', 'phone', 'address'],
                timeWindowStyle: rule.roundTo === 'hour' ? '2_HR_WINDOW' : '1_HR_WINDOW'
            });
        }
        
        return rules;
    }
    
    /**
     * Extract transfer rules from company config
     */
    static extractTransferRules(company) {
        const rules = [];
        const callRouting = company.agentSetup?.callRouting || [];
        
        for (const route of callRouting) {
            rules.push({
                id: route._id?.toString() || `xfer_${rules.length}`,
                intentTag: 'TRANSFER_REQUEST',
                queueName: route.name || 'Main Office',
                phoneNumber: route.phoneNumber || '',
                entitiesToCollect: ['name', 'phone', 'reason']
            });
        }
        
        // Add emergency transfer if configured
        if (company.twilioConfig?.emergencyPhone) {
            rules.push({
                id: 'xfer_emergency',
                intentTag: 'EMERGENCY',
                queueName: 'Emergency Line',
                phoneNumber: company.twilioConfig.emergencyPhone,
                entitiesToCollect: ['name', 'phone', 'address', 'emergency_description']
            });
        }
        
        return rules;
    }
    
    /**
     * Format operating hours for display
     */
    static formatOperatingHours(hours) {
        if (!Array.isArray(hours)) return 'Contact for hours';
        
        const enabledDays = hours.filter(h => h.enabled);
        if (enabledDays.length === 0) return 'Contact for hours';
        
        // Group by time slot
        const groups = {};
        for (const day of enabledDays) {
            const slot = `${day.start || '09:00'}-${day.end || '17:00'}`;
            if (!groups[slot]) groups[slot] = [];
            groups[slot].push(day.day?.substring(0, 3) || 'Day');
        }
        
        return Object.entries(groups)
            .map(([slot, days]) => `${days.join(', ')} ${slot}`)
            .join('; ');
    }
    
    /**
     * ========================================================================
     * GENERATE FRONTLINE SCRIPT
     * ========================================================================
     * 
     * @param {Object} params
     * @param {string} params.companyId
     * @param {string} params.versionId
     * @param {string} params.adminBrief
     * @param {string} params.tonePreset
     * @param {string} params.aggressiveness
     * @param {boolean} params.includeExamples
     * @param {string} params.userId - For audit
     * @returns {Promise<{scriptText: string, draft: Object}>}
     */
    static async generateScript({
        companyId,
        versionId,
        adminBrief,
        tonePreset = 'professional_warm',
        aggressiveness = 'medium',
        includeExamples = true,
        userId
    }) {
        const startTime = Date.now();
        
        logger.info('[SCRIPT BUILDER] Generating script', {
            companyId,
            versionId,
            tonePreset,
            aggressiveness,
            includeExamples
        });
        
        // 1) Load context
        const context = await this.loadContext(companyId);
        
        // 2) Build LLM prompt
        const prompt = this.buildPrompt({
            context,
            adminBrief,
            tonePreset,
            aggressiveness,
            includeExamples
        });
        
        // 3) Call LLM
        const llmResult = await this.callLLM(prompt);
        
        // 4) Validate script
        this.validateScript(llmResult.scriptText);
        
        // 5) Save draft for audit
        const draft = await FrontlineScriptDraft.create({
            companyId,
            versionId,
            scriptText: llmResult.scriptText,
            parameters: {
                adminBrief,
                tonePreset,
                aggressiveness,
                includeExamples
            },
            contextSnapshot: {
                companyName: context.company.name,
                trade: context.company.trade,
                categoriesCount: context.brain2.categories.length,
                scenariosCount: context.brain2.scenarios.length,
                triageCardsCount: context.triage.cards.length,
                bookingRulesCount: context.bookingRules.length,
                transferRulesCount: context.transferRules.length
            },
            llmMetadata: {
                model: llmResult.model,
                promptTokens: llmResult.usage?.prompt_tokens || 0,
                completionTokens: llmResult.usage?.completion_tokens || 0,
                totalTokens: llmResult.usage?.total_tokens || 0,
                cost: this.calculateCost(llmResult.usage),
                latencyMs: Date.now() - startTime
            },
            createdBy: userId
        });
        
        logger.info('[SCRIPT BUILDER] Script generated', {
            companyId,
            draftId: draft._id,
            scriptLength: llmResult.scriptText.length,
            latencyMs: Date.now() - startTime
        });
        
        return {
            scriptText: llmResult.scriptText,
            draft: {
                id: draft._id.toString(),
                createdAt: draft.createdAt
            }
        };
    }
    
    /**
     * Build the LLM prompt - Optimized for high-quality script output
     */
    static buildPrompt({ context, adminBrief, tonePreset, aggressiveness, includeExamples }) {
        const tone = TONE_PRESETS[tonePreset] || TONE_PRESETS.professional_warm;
        const aggro = AGGRESSIVENESS_LEVELS[aggressiveness] || AGGRESSIVENESS_LEVELS.medium;
        
        const systemPrompt = `You are a senior conversation designer who creates receptionist behavior scripts for voice AI systems.

Your scripts are used by LLMs to guide phone conversations. They must be:
- ACTIONABLE: Every line tells the AI exactly what to do
- CONVERSATIONAL: Written like you're coaching a person, not documenting a process
- VARIABLE-READY: Use {placeholders} that get replaced at runtime

TONE FOR THIS SCRIPT: ${tone.name}
${tone.style}

LEAD CAPTURE LEVEL: ${aggro.name}
${aggro.style}

CRITICAL REQUIREMENTS:
1. Use these exact placeholders: {companyName}, {companyType}, {serviceAreas}, {businessHours}, {mainPhone}, {emergencyPhone}, {billingPhone}, {greeting}, {bookingUrl}
2. Base everything on the provided company data - NEVER assume HVAC or any default trade
3. Make the script feel like natural guidance, not a robotic checklist
4. Include specific phrases the AI should say (in quotes)
5. Include things to AVOID saying (common mistakes)`;

        // Build scenario summary for prompt
        const scenarioSummary = context.brain2.scenarios.length > 0
            ? context.brain2.scenarios.slice(0, 20).map(s => `• ${s.title}: ${s.goal || 'Handle this topic'}`).join('\n')
            : '• No scenarios configured yet - use general best practices for ' + context.company.trade;
        
        // Build triage summary
        const triageSummary = context.triage.cards.length > 0
            ? context.triage.cards.slice(0, 15).map(c => `• "${c.title}" → ${c.action}`).join('\n')
            : '• Route general inquiries to knowledge base\n• Route booking requests to booking flow\n• Route emergencies to transfer';

        const examplesInstruction = includeExamples 
            ? `\n\nINCLUDE 3-4 EXAMPLE DIALOGUES showing:
- How to handle the most common call type for this trade
- How to handle an emergency/urgent situation
- How to capture lead info naturally
- How to handle a pricing question (deflect gracefully)

Format dialogues like:
CALLER: "..."
AI: "..."`
            : '';

        const userPrompt = `═══════════════════════════════════════════════════════════════════════════
COMPANY DATA
═══════════════════════════════════════════════════════════════════════════
Company: ${context.company.name}
Trade: ${context.company.trade}
Service Areas: ${Array.isArray(context.company.serviceAreas) ? context.company.serviceAreas.join(', ') || 'See {serviceAreas}' : context.company.serviceAreas || 'See {serviceAreas}'}
Business Hours: ${context.company.businessHours}
Emergency Phone: ${context.company.emergencyPhone || '{emergencyPhone}'}

═══════════════════════════════════════════════════════════════════════════
BRAIN-2 SCENARIOS (What topics this AI can discuss)
═══════════════════════════════════════════════════════════════════════════
${scenarioSummary}

═══════════════════════════════════════════════════════════════════════════
TRIAGE ROUTING RULES
═══════════════════════════════════════════════════════════════════════════
${triageSummary}

═══════════════════════════════════════════════════════════════════════════
BOOKING RULES: ${context.bookingRules.length} configured
TRANSFER RULES: ${context.transferRules.length} configured
═══════════════════════════════════════════════════════════════════════════

ADMIN INSTRUCTIONS:
"${adminBrief || 'Generate a professional script optimized for this trade. Focus on common customer needs and efficient call handling.'}"
${examplesInstruction}

═══════════════════════════════════════════════════════════════════════════
NOW GENERATE THE SCRIPT
═══════════════════════════════════════════════════════════════════════════

Create a Frontline-Intel script with these EXACT sections (use the headers as shown):

═══════════════════════════════════════════════════════════════════════════
FRONTLINE-INTEL: {companyName} AI RECEPTIONIST
Trade: {companyType} | Service Areas: {serviceAreas}
═══════════════════════════════════════════════════════════════════════════

🎯 YOUR MISSION
[2-3 sentences about what this AI does for callers of this specific business type]

📋 BEHAVIOR RULES (Always Follow)
[Bullet list of 5-7 core behaviors - be specific, use action verbs]
• DO: ...
• DO: ...
• NEVER: ...
• NEVER: ...

🔍 INTENT DETECTION (What Callers Want)
[List the main call types for this trade with detection cues]
• EMERGENCY: [keywords and phrases that signal emergency for THIS trade]
• SERVICE REQUEST: [what a typical service call sounds like]
• BOOKING/SCHEDULING: [booking request signals]
• PRICING INQUIRY: [how people ask about costs]
• GENERAL QUESTION: [informational requests]

📝 INFORMATION TO COLLECT
[What data to gather, in order of importance]
1. ...
2. ...
[Include trade-specific fields if relevant]

📅 BOOKING PROTOCOL
[Step-by-step booking flow]

📞 TRANSFER RULES
• IMMEDIATE TRANSFER: [emergencies] → {emergencyPhone}
• [other transfer scenarios]

⚠️ WHAT TO AVOID
[5-6 specific things NOT to do - common mistakes]
• Never say: "..."
• Never promise: ...

🏢 COMPANY INFO
Business Hours: {businessHours}
Main Line: {mainPhone}
Emergency: {emergencyPhone}

[If includeExamples: Add EXAMPLE DIALOGUES section]

Return ONLY the script. No explanations before or after.`;

        return { system: systemPrompt, user: userPrompt };
    }
    
    /**
     * Call LLM
     */
    static async callLLM(prompt) {
        if (!openaiClient) {
            throw new Error('OpenAI client not initialized');
        }
        
        const response = await openaiClient.chat.completions.create({
            model: process.env.SCRIPT_BUILDER_MODEL || 'gpt-4o-mini',
            temperature: 0.7,
            max_tokens: 4000,
            messages: [
                { role: 'system', content: prompt.system },
                { role: 'user', content: prompt.user }
            ]
        });
        
        return {
            scriptText: response.choices[0]?.message?.content || '',
            model: response.model,
            usage: response.usage
        };
    }
    
    /**
     * Validate generated script
     */
    static validateScript(scriptText) {
        if (!scriptText || scriptText.length < 500) {
            throw new Error('Generated script is too short. Please try again.');
        }
        
        // Check for required sections (flexible matching)
        const requiredPatterns = [
            /YOUR ROLE|ROLE:|AI RECEPTIONIST/i,
            /BEHAVIOR|GUIDELINES|CORE/i,
            /INTENT|EXTRACT|IDENTIFY/i
        ];
        
        for (const pattern of requiredPatterns) {
            if (!pattern.test(scriptText)) {
                logger.warn('[SCRIPT BUILDER] Script may be missing sections', {
                    pattern: pattern.toString(),
                    scriptLength: scriptText.length
                });
            }
        }
        
        return true;
    }
    
    /**
     * Calculate cost based on usage
     */
    static calculateCost(usage) {
        if (!usage) return 0;
        
        // GPT-4o-mini pricing (as of late 2024)
        const inputCostPer1K = 0.00015;
        const outputCostPer1K = 0.0006;
        
        return (
            (usage.prompt_tokens / 1000) * inputCostPer1K +
            (usage.completion_tokens / 1000) * outputCostPer1K
        );
    }
    
    /**
     * Get tone presets for UI
     */
    static getTonePresets() {
        return Object.entries(TONE_PRESETS).map(([key, value]) => ({
            value: key,
            name: value.name,
            description: value.description
        }));
    }
    
    /**
     * Get aggressiveness levels for UI
     */
    static getAggressivenessLevels() {
        return Object.entries(AGGRESSIVENESS_LEVELS).map(([key, value]) => ({
            value: key,
            name: value.name,
            description: value.description
        }));
    }
}

module.exports = FrontlineScriptBuilder;

