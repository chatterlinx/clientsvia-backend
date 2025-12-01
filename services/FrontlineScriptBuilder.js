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
        
        // Load Brain-2 data (categories and scenarios from template)
        const templateId = company.configuration?.clonedFrom || 
                          company.aiAgentSettings?.templateId;
        
        let brain2 = { categories: [], scenarios: [] };
        
        if (templateId) {
            const template = await GlobalInstantResponseTemplate.findById(templateId).lean();
            if (template) {
                brain2 = this.extractBrain2Data(template);
            }
        }
        
        // Load Triage Cards
        const triageCards = await TriageCard.find({
            companyId,
            isActive: true
        }).sort({ priority: -1 }).lean();
        
        // Load Booking Rules from company config
        const bookingRules = this.extractBookingRules(company);
        
        // Load Transfer Rules from company config
        const transferRules = this.extractTransferRules(company);
        
        const context = {
            companyId: companyId.toString(),
            company: {
                name: company.name || 'Company',
                trade: company.trade || company.industry || 'Service',
                mainPhone: company.twilioConfig?.phoneNumber || company.primaryPhone || '',
                emergencyPhone: company.twilioConfig?.emergencyPhone || '',
                serviceAreas: company.configuration?.variables?.get?.('serviceAreas') || 
                             company.serviceAreas || [],
                businessHours: company.agentSetup?.operatingHours ? 
                    this.formatOperatingHours(company.agentSetup.operatingHours) : 
                    'Please contact for hours'
            },
            brain2,
            triage: {
                cards: triageCards.map(card => ({
                    id: card._id.toString(),
                    title: card.displayName || card.triageLabel,
                    action: card.quickRuleConfig?.action || 'DIRECT_TO_3TIER',
                    intentTag: card.intent || card.triageLabel?.toUpperCase().replace(/\s+/g, '_'),
                    mustHaveKeywords: card.quickRuleConfig?.keywordsMustHave || [],
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
     * Build the LLM prompt
     */
    static buildPrompt({ context, adminBrief, tonePreset, aggressiveness, includeExamples }) {
        const tone = TONE_PRESETS[tonePreset] || TONE_PRESETS.professional_warm;
        const aggro = AGGRESSIVENESS_LEVELS[aggressiveness] || AGGRESSIVENESS_LEVELS.medium;
        
        const systemPrompt = `You are an AI assistant that generates receptionist behavior scripts for a multi-tenant voice AI platform.

Each company has:
- Its own trade (e.g. HVAC, Real Estate, Accounting, Dental, Plumbing, Legal)
- Its own AiCore categories, scenarios, triage cards, booking rules, and transfer rules.

Your job is to generate a single Frontline-Intel script for ONE company, in the exact contract format shown.

CRITICAL RULES:
- Use ONLY the trade and scenarios provided for this companyId.
- NEVER assume HVAC or any specific trade - use the provided data.
- Reflect triage actions (DIRECT_TO_3TIER, DIRECT_TO_BOOKING, DIRECT_TO_TRANSFER, EDGE_CASE) in behavior guidelines.
- Reflect booking rules and transfer rules in the appropriate sections.
- Use placeholders: {companyName}, {serviceAreas}, {mainPhone}, {emergencyPhone}, {businessHours}
- Return ONLY the script text. No JSON, no comments, no explanations.

TONE: ${tone.name}
${tone.style}

LEAD CAPTURE STYLE: ${aggro.name}
${aggro.style}`;

        const contextJson = JSON.stringify({
            company: context.company,
            brain2: {
                categories: context.brain2.categories.slice(0, 15), // Limit for token size
                scenarios: context.brain2.scenarios.slice(0, 30)
            },
            triage: {
                cards: context.triage.cards.slice(0, 20)
            },
            bookingRules: context.bookingRules.slice(0, 5),
            transferRules: context.transferRules.slice(0, 5)
        }, null, 2);

        const examplesSection = includeExamples ? `
Include 2-3 example dialogues for the most important call types based on the triage cards.` : '';

        const userPrompt = `COMPANY CONTEXT:
${contextJson}

ADMIN BUSINESS BRIEF:
"${adminBrief || 'No specific instructions provided. Generate a standard professional script based on the company data.'}"

${examplesSection}

GENERATE a complete Frontline-Intel script with these sections:
1. HEADER: Company name, trade, service areas
2. YOUR ROLE: What the AI receptionist does for this specific business
3. CORE BEHAVIOR GUIDELINES: Tone, conversation style, dos and don'ts
4. INTENT EXTRACTION: How to identify what the caller wants (based on triage cards)
5. ENTITY COLLECTION: What info to gather (name, phone, address, specific to this trade)
6. APPOINTMENT/BOOKING PROTOCOL: Based on booking rules provided
7. TRANSFER PROTOCOL: When and how to transfer (based on transfer rules)
8. EMERGENCY HANDLING: Based on trade-specific emergencies
9. COMPANY INFORMATION: Hours, service areas, contact info
10. CUSTOMIZATION NOTES: Trade-specific behaviors

Remember: This is for "${context.company.trade}" - NOT HVAC unless that's the actual trade.`;

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

