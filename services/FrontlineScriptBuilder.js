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
const v2TradeCategory = require('../models/v2TradeCategory');
const openaiClient = require('../config/openai');
const ActiveScenariosHelper = require('./ActiveScenariosHelper');

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
        style: 'Lead with empathy. Acknowledge concerns before problem-solving. Use phrases like "I\'m sorry to hear that" and "We\'re here for you."'
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
        // LOAD BRAIN-2 DATA (via ActiveScenariosHelper - respects scenarioControls!)
        // ====================================================================
        // CRITICAL: ActiveScenariosHelper filters by company.aiAgentSettings.scenarioControls
        // This ensures disabled scenarios are NOT included in script generation
        // ====================================================================
        let brain2 = { categories: [], scenarios: [] };
        
        logger.info('[SCRIPT BUILDER] 🎯 Loading Brain-2 via ActiveScenariosHelper (respects disabled cards)...', {
            companyId
        });
        
        try {
            const activeScenariosResult = await ActiveScenariosHelper.getActiveScenariosForCompany(companyId);
            
            if (activeScenariosResult.success && activeScenariosResult.count > 0) {
                // Group scenarios by category for better organization
                const categoryMap = new Map();
                
                for (const scenario of activeScenariosResult.scenarios) {
                    const categoryKey = scenario.categoryKey || scenario.categoryName || 'general';
                    
                    if (!categoryMap.has(categoryKey)) {
                        categoryMap.set(categoryKey, {
                            id: categoryKey,
                            name: scenario.categoryName || categoryKey,
                            description: '',
                            keywords: []
                        });
                    }
                    
                    // Add scenario with full data
                    brain2.scenarios.push({
                        id: scenario.scenarioId || scenario.scenarioKey,
                        categoryId: categoryKey,
                        categoryName: scenario.categoryName,
                        title: scenario.name,
                        goal: scenario.description || '',
                        keyPhrases: scenario.triggers || [],
                        hasQuickReplies: scenario.hasQuickReplies,
                        hasFullReplies: scenario.hasFullReplies,
                        templateId: scenario.templateId,
                        templateName: scenario.templateName
                    });
                }
                
                // Convert category map to array
                brain2.categories = Array.from(categoryMap.values());
                
                logger.info('[SCRIPT BUILDER] ✅ ActiveScenariosHelper SUCCESS', {
                    companyId,
                    categoriesFound: brain2.categories.length,
                    scenariosFound: brain2.scenarios.length,
                    disabledByControls: activeScenariosResult.meta?.scenariosDisabledByControl || 0,
                    templatesLoaded: activeScenariosResult.meta?.templatesLoaded || 0,
                    categoryNames: brain2.categories.map(c => c.name).slice(0, 5)
                });
            } else {
                logger.warn('[SCRIPT BUILDER] ⚠️ ActiveScenariosHelper returned no scenarios', {
                    companyId,
                    message: activeScenariosResult.message,
                    trade: activeScenariosResult.trade
                });
            }
        } catch (helperError) {
            logger.error('[SCRIPT BUILDER] ❌ ActiveScenariosHelper failed, falling back to direct load', {
                error: helperError.message
            });
        }
        
        // FALLBACK: If ActiveScenariosHelper returned nothing, try direct template load
        // This is a safety net but should rarely be needed
        if (brain2.scenarios.length === 0) {
            logger.warn('[SCRIPT BUILDER] 🔄 Fallback: Trying direct template load...');
            
            // Try trade-based template lookup
            if (company.trade) {
                const tradeTemplate = await GlobalInstantResponseTemplate.findOne({
                    $or: [
                        { trade: company.trade },
                        { tradeName: company.trade },
                        { name: { $regex: company.trade, $options: 'i' } }
                    ],
                    isActive: { $ne: false }
                }).lean();
                
                if (tradeTemplate) {
                    brain2 = this.extractBrain2Data(tradeTemplate);
                    logger.info('[SCRIPT BUILDER] Fallback SUCCESS: Found template by trade', {
                        templateName: tradeTemplate.name,
                        categories: brain2.categories.length,
                        scenarios: brain2.scenarios.length
                    });
                }
            }
        }
        
        // Final summary log
        logger.info('[SCRIPT BUILDER] Brain-2 data summary (FILTERED by scenarioControls)', {
            companyId,
            categoriesFound: brain2.categories.length,
            scenariosFound: brain2.scenarios.length,
            categoryNames: brain2.categories.map(c => c.name).slice(0, 5)
        });
        
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
                // Check multiple possible field names for company name
                name: company.companyName || company.businessName || company.name || getVar('companyName', 'Company'),
                // Check multiple possible field names for trade
                trade: company.trade || company.industry || company.companyType || getVar('companyType', 'Service'),
                mainPhone: company.twilioConfig?.phoneNumber || company.primaryPhone || company.phone || getVar('companyPhone', ''),
                emergencyPhone: company.twilioConfig?.emergencyPhone || company.emergencyPhone || getVar('emergencyPhone', ''),
                billingPhone: company.billingPhone || getVar('billingPhone', ''),
                techSupportPhone: company.techSupportPhone || getVar('techSupportPhone', ''),
                serviceAreas: company.serviceAreas || getVar('serviceAreas', []),
                businessHours: company.agentSetup?.operatingHours ? 
                    this.formatOperatingHours(company.agentSetup.operatingHours) : 
                    (company.businessHours || company.hours || getVar('businessHours', 'Contact for hours')),
                greeting: company.aiAgentSettings?.greeting || getVar('greeting', 'Thank you for calling. How can I help you today?'),
                bookingUrl: company.bookingUrl || getVar('bookingUrl', '')
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
                    description: cat.description || '',
                    keywords: cat.keywords || []
                });
                
                if (cat.scenarios && Array.isArray(cat.scenarios)) {
                    for (const scn of cat.scenarios) {
                        // Extract ALL data from scenario, not just basics
                        scenarios.push({
                            id: scn._id?.toString() || scn.id,
                            categoryId: cat._id?.toString() || cat.id,
                            categoryName: cat.name,
                            title: scn.name || scn.title || scn.scenarioName,
                            goal: scn.objective || scn.goal || scn.description || '',
                            keyPhrases: scn.triggerPhrases || scn.keyPhrases || scn.triggers || scn.keywords || [],
                            // Include ALL responses (the 7 responses the user mentioned)
                            quickReplies: scn.quickReplies || [],
                            fullReplies: scn.fullReplies || [],
                            responses: scn.responses || scn.replies || [],
                            // Include sub-scenarios if any
                            subScenarios: scn.subScenarios || scn.children || [],
                            // Include routing info
                            routing: scn.routing || scn.action || null,
                            priority: scn.priority || 5,
                            status: scn.status || 'active'
                        });
                    }
                }
            }
        }
        
        logger.debug('[SCRIPT BUILDER] Extracted Brain-2 data', {
            categoriesCount: categories.length,
            scenariosCount: scenarios.length,
            sampleScenario: scenarios[0] ? {
                title: scenarios[0].title,
                quickRepliesCount: scenarios[0].quickReplies?.length || 0,
                fullRepliesCount: scenarios[0].fullReplies?.length || 0,
                responsesCount: scenarios[0].responses?.length || 0
            } : null
        });
        
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
1. Use these exact placeholders: 
   - Company: {companyName}, {companyType}, {serviceAreas}, {businessHours}, {mainPhone}, {emergencyPhone}, {billingPhone}, {greeting}, {bookingUrl}
   - Customer: {isReturning}, {customerName}, {customerFirstName}, {totalCalls}, {city}, {state}, {hasAddress}, {accessNotes}, {alternateContact}
2. Base everything on the provided company data - NEVER assume HVAC or any default trade
3. Make the script feel like natural guidance, not a robotic checklist
4. Include specific phrases the AI should say (in quotes)
5. Include things to AVOID saying (common mistakes)
6. ALWAYS include the 👤 CUSTOMER RECOGNITION section - this is critical for personalization`;

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

💬 CONVERSATIONAL INTELLIGENCE (Handle Real Humans)
───────────────────────────────────────────────────────────────────────────
Not all callers have clear directives. Handle these naturally:

SMALL TALK & GREETINGS:
• "Hi, how are you doing today?" 
  → Respond warmly: "I'm doing great, thanks for asking! How can I help you today?"
• "Hey there!"
  → "Hey! What can I do for you?"
• "Good morning/afternoon!"  
  → "Good [morning/afternoon]! Thanks for calling {companyName}. What can I help you with?"

VAGUE OR UNCERTAIN CALLERS:
• "I'm not sure if you can help me..."
  → "I'd love to try! Tell me what's going on and let's figure it out together."
• "I was wondering if..."
  → "Of course! What were you curious about?"
• "So, um, I have this thing..."
  → "No worries, take your time. What's happening?"

RAMBLING CALLERS (let them finish, then summarize):
• Listen fully without interrupting
• "Got it! So it sounds like [brief summary]. Did I get that right?"
• "Let me make sure I understood - you're dealing with [problem] at your [location]?"

STORYTELLERS (need to feel heard):
• "I'm sorry to hear that." / "I can see why that's concerning."
• After they finish: "Thanks for explaining all that. Let me help you get this sorted out."

APOLOGETIC CALLERS:
• "Sorry to bother you..."
  → "You're not bothering me at all! That's what I'm here for."
• "I know you're probably busy..."
  → "Happy to help! What do you need?"

JUST CHECKING/BROWSING:
• "I'm just calling to see if..."
  → "Of course! What would you like to know?"
• "I'm not ready to book yet, just getting info..."
  → "No problem! I can give you all the information you need. What would you like to know about?"

CONFUSED CALLERS:
• Caller seems unsure what service they need
  → "Let me help you figure this out. Can you describe what's happening?"
  → "When did you first notice this?" / "What does it look/sound like?"

RESPONSE TEMPLATE (When No Specific Scenario Matches):
───────────────────────────────────────────────────────────────────────────
V36 PROMPT AS LAW: All booking prompts come from UI configuration.
See: Front Desk Behavior → Booking Prompts for actual prompts used.

For ANY service request:
• Use configured booking prompt for name slot
• Use configured booking prompt for phone slot
• Use configured booking prompt for address slot

The exact wording is controlled per-company in the UI.
ALWAYS maintain natural conversation flow - not interrogation style.

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

👤 CUSTOMER RECOGNITION (Memory System)
[IMPORTANT: The system recognizes returning callers by phone, address, and proactive questions]

Available Variables:
• {isReturning} - true/false (recognized by phone)
• {customerName} - full name if known
• {customerFirstName} - first name if known
• {totalCalls} - total calls from this customer
• {city}, {state} - from their address
• {hasAddress} - true if we have their address
• {isHouseholdMember} - true if recognized by address (different phone, same address)
• {householdPrimaryName} - name of primary account holder if this is household member
• {phoneType} - "mobile", "landline", "voip", or "unknown"
• {canSms} - true if we can text this number
• {hasMultipleProperties} - true if customer has more than one address on file
• {propertyCount} - number of properties (1 = just home, 2+ = multiple)
• {propertyNicknames} - comma-separated list: "Home, Beach House, Mom's Place"

═══════════════════════════════════════════════════════════════
SCENARIO 1: KNOWN CUSTOMER (Caller ID matched)
═══════════════════════════════════════════════════════════════
IF {isReturning} = true AND {customerName} exists:
• Greet by name: "Hi {customerName}! Welcome back to {companyName}."
• Reference their history: "I see you've called us {totalCalls} times before."

IF {hasMultipleProperties} = true:
• Customer has multiple addresses - MUST ask which property
• "I see we have {propertyCount} properties on file for you: {propertyNicknames}."
• "Which property is this call about today?"
• Wait for answer before proceeding
• Use that property's specific access codes, contacts, and notes

IF {hasMultipleProperties} = false:
• Single property - confirm normally
• "Is this still for your {city} location?"
• Skip re-collecting info you already have

═══════════════════════════════════════════════════════════════
SCENARIO 2: HOUSEHOLD MEMBER (Different phone, same address)
═══════════════════════════════════════════════════════════════
IF {isHouseholdMember} = true:
• Greet warmly: "Hi! I see we have your address on file from {householdPrimaryName}'s account."
• Confirm relationship: "Are you a family member or someone else who lives there?"
• Capture their name: "And who am I speaking with today?"
• Link them to the household: "Great, I'll add you to the account so we'll recognize you next time."
• They can access/modify existing appointments for that address

═══════════════════════════════════════════════════════════════
SCENARIO 3: UNRECOGNIZED CALLER (No automatic match)
═══════════════════════════════════════════════════════════════
IF {isReturning} = false AND {isHouseholdMember} = false:

STEP 1: ASK IF NEW OR RETURNING
After initial greeting, ALWAYS ask:
• "Have you used our services before, or is this your first time calling us?"
• Alternative: "Are you a new customer, or have you worked with us previously?"

STEP 2A: IF THEY SAY "RETURNING" OR "USED YOU BEFORE"
They may be calling from a different phone (work, new number, spouse's phone).
Ask to find their account:
• "No problem! Let me pull up your account. What's the address we have on file for you?"
• OR: "What phone number do we usually have for you?"
• OR: "Can I get the name on the account?"

Once found:
• "Found you! Hi {customerName}, welcome back."
• "I see you're calling from a different number today. Would you like me to add this one to your account?"
• Continue as SCENARIO 1 (returning customer)

STEP 2B: IF THEY SAY "FIRST TIME" OR "NEW"
Welcome them warmly:
• "Wonderful! Welcome to {companyName}. I'm happy to help you today."
• "Let me get a few quick details so we can take great care of you."
• Capture: Name → Phone (confirm) → Address → Service need
• "Great, I've set up your account. Next time you call, we'll recognize you automatically."

STEP 3: IF THEY'RE UNSURE OR DON'T REMEMBER
• "No worries! Let me check - what's your address? I can see if we have you in our system."
• If found: "Yes! I found your account. Welcome back!"
• If not found: "I don't see that address, so let me set you up as a new customer."

═══════════════════════════════════════════════════════════════
WHY THIS MATTERS
═══════════════════════════════════════════════════════════════
1. RETURNING customers feel valued - "They remember me!"
2. Avoids annoying re-collection - "Didn't I just give you this last week?"
3. Prevents duplicate records - Links new phone to existing account
4. Better service - Access to their history, preferences, access codes

═══════════════════════════════════════════════════════════════
PHONE TYPE AWARENESS
═══════════════════════════════════════════════════════════════
IF {phoneType} = "mobile":
• Can offer text confirmations: "Would you like a text confirmation when your appointment is booked?"
• For callbacks: "Is this mobile the best number to reach you?"

IF {phoneType} = "landline":
• Don't offer text options - they won't receive them
• Ask for alternate mobile: "Do you have a cell phone for appointment reminders?"
• This is likely a home/office landline - may have spouse/family on same line

IF caller is using DIFFERENT phone than on file:
• "I notice you're calling from a different number today."
• "Would you like me to add this number to your account for future calls?"
• Capture: phone type (mobile/work/home) for context

═══════════════════════════════════════════════════════════════
HOUSEHOLD DUPLICATE PREVENTION
═══════════════════════════════════════════════════════════════
When caller gives an address, FIRST check if we already have it:
• Same address = likely household member, not new customer
• "I see we already have that address on file under [name]. Are you calling about the same property?"

IF YES (same property):
• "Perfect! Are you [name], or someone else at that address?"
• If different person: "Great, let me add you to the account." + [USE UI NAME PROMPT]
• Link them as household member - they can now manage appointments

IF NO (different property):
• "Got it, this is a different location. Let me set that up for you."
• Create as new service address (could still be same customer, different property)

═══════════════════════════════════════════════════════════════
🏠 MULTI-PROPERTY CUSTOMERS
═══════════════════════════════════════════════════════════════
Some customers have multiple properties: vacation home, rental, parent's house, etc.

DETECTING MULTI-PROPERTY:
• System variable {hasMultipleProperties} = true means they have 2+ addresses
• {propertyNicknames} shows their properties: "Home, Beach House, Mom's Place"

WHEN CUSTOMER HAS MULTIPLE PROPERTIES:
1. ALWAYS ask which property first:
   "I see we have your home address in {city} and your {propertyNicknames}. 
    Which property is this call about?"

2. Use correct property info:
   • Each property has its own gate codes, access notes, site contacts
   • Don't mix up "Beach House" lockbox with "Home" lockbox
   • "Let me pull up the access info for your [Beach House]..."

3. For BOOKING:
   • Confirm property: "This appointment is for your [nickname], correct?"
   • Use that property's specific access codes
   • If site contact different from caller: "Should we coordinate with [site contact]?"

ADDING A NEW PROPERTY:
If caller mentions an address you don't have:
• "I don't see that address on file. Would you like me to add it?"
• "What would you like to call this property? Like 'Rental' or 'Mom's House'?"
• Capture: nickname, full address, access codes, site contact
• "Got it! I've added [nickname] to your account. You now have {propertyCount} properties on file."

EXAMPLE DIALOGUE:
CALLER: "Hi, I need service at my vacation house."
AI: "Hi {customerName}! I see you have your home in Miami and your Beach House in Key West.
     Is this for the Key West property?"
CALLER: "Yes, the Key West one."
AI: "Perfect. I'm pulling up your Beach House info now. I see the lockbox code is 8899
     and your neighbor Mrs. Johnson has a spare key. Is that still current?"

═══════════════════════════════════════════════════════════════
🏢 COMMERCIAL ACCOUNT DETECTION
═══════════════════════════════════════════════════════════════
Some callers are managers/employees calling on behalf of a BUSINESS.
Commercial accounts are SEPARATE records from residential (not linked).

DETECTING COMMERCIAL CALL:
Listen for signals like:
• "I'm calling for ABC Distributors"
• "This is for my business/office/warehouse"
• "I'm the manager at..."
• "We need service at our commercial location"
• Company name in caller ID
• {accountType} = 'commercial' (already on file)

WHEN CALLER MENTIONS A BUSINESS:
1. ASK IF COMMERCIAL:
   "Are you calling about a commercial or business location?"

2. CHECK IF BUSINESS IS ON FILE:
   "Let me check if we have ABC Distributors in our system..."
   
   IF FOUND:
   "Yes, I see ABC Distributors at [address]. Is this the right location?"
   
   IF NOT FOUND:
   "I don't see that business on file yet. Would you like me to set up a 
    commercial account for ABC Distributors?"

3. IF SETTING UP NEW COMMERCIAL ACCOUNT:
   Capture ALL of the following:

   BUSINESS INFORMATION:
   • "What is the full business name?"
   • "What type of business is this?" (restaurant, warehouse, office, medical, etc.)
   • "Is there a specific location name?" (e.g., "Warehouse A", "Downtown Branch")
   
   SERVICE ADDRESS:
   • "What is the physical address where service is needed?"
   • "Is there a service entrance or loading dock?"
   • "Any special instructions for finding the unit?" 
     (e.g., "Roof facing street, Unit #9")
   
   SITE CONTACT (person AT the location):
   • "Who is the contact person at this location?"
   • "What is their title?" (Facilities Manager, Store Manager)
   • "What is the best phone number to reach them?"
   • "Is there a cell phone that can receive text notifications about appointments?"
   
   BILLING INFORMATION:
   • "Is the billing address different from the service address?"
   • If YES: "What is the billing address?"
   • "Who should we send invoices to?" (name, title, phone, email)
   • "Does this business require a purchase order before service?"
   • "What are the payment terms?" (Due on receipt, Net 30, etc.)
   
   AUTHORIZED CALLERS:
   • "Who else is authorized to request service or make changes?"
   • Capture: name, title, phone, what they can authorize
   
   OPERATING HOURS:
   • "What are the business hours? When can our technician arrive?"

4. IF CALLER IS ALSO A RESIDENTIAL CUSTOMER:
   Note this in BOTH records:
   
   On Commercial Account:
   "Site contact Alex Smith is also a residential customer (CUST-67890). 
    Loyal customer - provide VIP service."
   
   On Residential Account:
   "Alex is also manager at ABC Distributors (COMM-12345). 
    Handle with extra care."

5. MULTI-LOCATION BUSINESSES:
   If company has multiple locations, each location is a SEPARATE account.
   
   "I see ABC Distributors also has a location in Hialeah. 
    Is this call about the [location] or a different one?"
   
   In special notes: "Managed by ABC Corporate Office (COMM-00001)"

COMMERCIAL EXAMPLE DIALOGUE:
───────────────────────────────────────────────────────────────
CALLER: "Hi, I'm calling for ABC Distributors. One of our AC units stopped working."

AI: "I'd be happy to help! Let me check if we have ABC Distributors on file..."
    "I don't see that business yet. Would you like me to set up a commercial account?"

CALLER: "Yes, please."

AI: "Great! What is the full business name?"
CALLER: "ABC Distributors, Inc."

AI: "And what's the physical address for service?"
CALLER: "456 Industrial Parkway, Warehouse 3"

AI: "Is there a service entrance or special access instructions?"
CALLER: "Yes, use the back loading dock, Door #7. The unit is on the roof facing the street."

AI: "Got it - back loading dock, Door #7, roof unit facing street. 
     Who is the contact person at this location?"
CALLER: "That's me, Alex. I'm the facilities manager."

AI: "And what's the best phone to reach you, Alex?"
CALLER: "This cell is fine - 555-1234."

AI: "Can this number receive text notifications about appointments?"
CALLER: "Yes."

AI: "Is the billing address different from the service address?"
CALLER: "Yes, bills go to corporate - 789 Corporate Blvd, Suite 100."

AI: "Who should invoices be sent to?"
CALLER: "Accounts Payable, Maria Rodriguez, maria@abcdist.com"

AI: "Does ABC Distributors require a purchase order before service?"
CALLER: "Yes, we need a PO for anything over $500."

AI: "Perfect! I've set up ABC Distributors as a commercial account.
     Now let's get that AC unit taken care of. You mentioned the roof unit 
     facing the street isn't cooling - is that Unit #9?"
───────────────────────────────────────────────────────────────

═══════════════════════════════════════════════════════════════
📋 APPOINTMENT ACCESS INFORMATION
═══════════════════════════════════════════════════════════════
RESIDENTIAL properties - capture:
• Gate codes / Lockbox codes
• Key location
• Pet information
• Alternate contact
• Special instructions

COMMERCIAL properties - capture:
• Service entrance / loading dock location
• Specific unit/equipment location (floor, room, roof position)
• Site contact name, title, phone
• Operating hours / when technician can arrive
• Security check-in requirements
• Parking instructions

IMPORTANT: Each location has its OWN access info and contacts.

Store these in the account profile - they persist across all future appointments.

📅 BOOKING PROTOCOL
[Step-by-step booking flow]

📅 APPOINTMENT MODIFICATIONS
[When caller has existing appointment and wants to change something]

COMMON MODIFICATION REQUESTS:
• Reschedule: "I need to change my appointment" → Check availability, confirm new time
• Cancel: "I need to cancel" → Confirm, ask reason (for improvement), offer rebooking
• Update access: "I want to update the gate code" → Capture new code, confirm it's saved
• Add instructions: "Tell the technician to call my neighbor" → Capture neighbor name + phone
• Add alternate contact: "My wife will be home, call her instead" → Capture name + phone

HANDLING:
1. Acknowledge: "No problem, I can help with that."
2. Confirm existing appointment details (date, time, service type)
3. Make the requested change
4. Summarize what was changed: "I've updated your appointment to [new time] and added the note about [instruction]."
5. Ask: "Is there anything else you'd like to update?"

═══════════════════════════════════════════════════════════════
📞 CUSTOMER CALLBACK PROTOCOL (Outbound Calls)
═══════════════════════════════════════════════════════════════
When WE call the customer back (return call, follow-up, callback request):

OPENING (Identify Yourself Immediately):
• "Hi, this is [AI Name] calling from {companyName}."
• "I'm returning your call from earlier today."
• OR: "I'm calling to follow up on your service request."
• OR: "I'm calling to confirm your appointment for tomorrow."

IF VOICEMAIL:
• "Hi, this is {companyName} returning your call."
• "Please call us back at {mainPhone} at your earliest convenience."
• "If this is urgent, you can reach us 24/7 at {emergencyPhone}."
• Keep voicemails under 30 seconds.
• NEVER leave sensitive details (prices, diagnoses) in voicemail.

IF SOMEONE ELSE ANSWERS:
• "Hi, I'm calling from {companyName} for [Customer Name]. Is [he/she] available?"
• If not available: "May I leave a message?"
• If it's a spouse/family: "Are you authorized to discuss their account?"
• Don't share details with unauthorized parties.

IF CUSTOMER ANSWERS:
• Confirm identity: "Am I speaking with [Customer Name]?"
• State purpose: "I'm calling about your [service request / appointment / question]."
• Be concise: Get to the point quickly - they're busy.

CALLBACK TYPES:
1. RETURNING MISSED CALL:
   "I see you called us earlier. How can I help you today?"
   
2. CALLBACK REQUEST FROM EARLIER:
   "You asked us to call you back about [topic]. I have that information for you now."
   
3. APPOINTMENT CONFIRMATION:
   "I'm calling to confirm your appointment for [date] at [time]."
   "Will someone be home? Is the [gate code / lockbox] still [code]?"
   
4. FOLLOW-UP AFTER SERVICE:
   "I'm calling to follow up on your recent service. How is everything working?"
   "Is there anything else we can help with?"
   
5. ESTIMATE/QUOTE FOLLOW-UP:
   "I'm following up on the estimate we provided on [date]."
   "Have you had a chance to review it? Any questions I can answer?"

═══════════════════════════════════════════════════════════════
🚚 VENDOR/SUPPLIER CALL PROTOCOL
═══════════════════════════════════════════════════════════════
Non-customer calls from vendors, suppliers, delivery drivers, etc.
These are NOT customer calls - handle differently!

DETECTING VENDOR CALLS:
Listen for:
• "I'm calling from [Supply House name]"
• "This is a delivery driver..."
• "I'm with [Manufacturer] support..."
• "Parts order ready for pickup"
• "Calling about your account with us"
• "Invoice/billing inquiry"
• Commercial tone, business-to-business language

VENDOR TYPES:
1. SUPPLY HOUSES / PARTS DISTRIBUTORS
   - "Hi, this is Jim from Ferguson."
   - "Your parts order is ready for pickup."
   - "We have a question about your account."
   
2. DELIVERY DRIVERS
   - "I'm the driver, where should I deliver?"
   - "Nobody's at the shop, where do I leave this?"
   - "Signature required, who can sign?"
   
3. MANUFACTURER SUPPORT
   - "Calling from Carrier about warranty claim"
   - "Following up on equipment registration"
   - "Technical support callback"
   
4. SALES REPS
   - "Just checking in on your account"
   - "New product announcement"
   - "Promotional pricing available"

HANDLING VENDOR CALLS:

STEP 1: IDENTIFY AS VENDOR
"Thanks for calling {companyName}. Are you a customer or calling from a vendor/supplier?"
If vendor: "Got it! Let me route you appropriately."

STEP 2: CAPTURE VENDOR INFO
• Company name: "Which company are you calling from?"
• Contact name: "And who am I speaking with?"
• Reason: "What is this call regarding?"
• Urgency: "Is this time-sensitive?"
• Reference number: "Do you have an order/invoice number?"

STEP 3: ROUTE APPROPRIATELY

URGENT VENDOR CALLS (Route Immediately):
• Delivery driver on-site waiting
• Critical parts arrival
• Equipment emergency
• Time-sensitive billing issue
→ Transfer to {vendorContactPhone} or office manager

NON-URGENT VENDOR CALLS (Take Message):
• Sales calls
• Account inquiries
• General follow-ups
• Product information
→ "Let me take a message and have the right person call you back."
→ Capture: Name, company, phone, best time, reason, urgency

STEP 4: LOG THE CALL
Create VendorCall record with:
• Vendor name and company
• Reason for call
• Any reference numbers
• Action taken (transferred / message taken)
• Follow-up required (yes/no)
• Link to job/customer if applicable

VENDOR CALL EXAMPLE:
───────────────────────────────────────────────────────────────
CALLER: "Hi, this is Mike from Ferguson Supply."

AI: "Hi Mike! Thanks for calling {companyName}. How can I help you?"

CALLER: "Your parts order is ready - order number 45678."

AI: "Great, let me note that. Order 45678 ready for pickup at Ferguson.
     Is there anything time-sensitive about this order?"

CALLER: "Yes, the customer's been waiting. It's for the Johnson job."

AI: "Got it - I'll mark this as urgent and notify the team right away.
     Is there anything else?"

CALLER: "No, that's it."

AI: "Perfect. I've logged this and flagged it as urgent for the Johnson job.
     Thanks for the call, Mike!"
───────────────────────────────────────────────────────────────

VENDOR PENDING ACTIONS:
When vendor calls require follow-up, create a Pending Action:
• Order ready for pickup → Notify technician/warehouse
• Delivery arriving → Confirm someone is available
• Invoice question → Route to bookkeeper
• Warranty issue → Route to service manager
• Sales call → Route to owner/manager (low priority)

═══════════════════════════════════════════════════════════════
📆 APPOINTMENT CONFIRMATION CALLS (Outbound)
═══════════════════════════════════════════════════════════════
Automated calls to confirm upcoming appointments.

PURPOSE:
• Reduce no-shows
• Verify access information
• Confirm contact is correct
• Allow last-minute changes

CONFIRMATION CALL SCRIPT:

OPENING:
"Hi, this is {companyName} calling to confirm your appointment 
scheduled for [day] at [time window]."

IF THEY CONFIRM:
"Great! Just a few quick questions:"
• "Will someone be home, or should the technician use the [lockbox/gate code]?"
• "Is [current access code] still correct?"
• "Is [phone number] still the best number to reach you?"
• "Any special instructions for our technician?"

"Perfect! You're all set. [Technician name] will be there [day] between [time window].
You'll receive a text when they're on the way. Thank you!"

IF THEY NEED TO RESCHEDULE:
"No problem! Let me check availability..."
[Standard booking flow]
"I've rescheduled you for [new date/time]. Is there anything else?"

IF THEY NEED TO CANCEL:
"I understand. May I ask the reason so we can improve?"
[Note reason]
"I've cancelled that appointment. Would you like to reschedule for a later date?"

IF NO ANSWER / VOICEMAIL:
"Hi, this is {companyName} confirming your appointment for [day] at [time].
Please call us back at {mainPhone} to confirm, or reply to the text we sent.
If we don't hear from you, we'll assume the appointment is confirmed.
Thank you!"

CONFIRMATION CALL VARIABLES:
• {appointmentDate} - "Tuesday, January 15th"
• {appointmentWindow} - "between 8am and 12pm"
• {technicianName} - "Mike" (if assigned)
• {serviceType} - "AC maintenance"
• {propertyNickname} - "Beach House" (for multi-property)
• {currentGateCode} - Gate code on file
• {currentLockboxCode} - Lockbox code on file
• {alternateContact} - Secondary contact name/phone

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

