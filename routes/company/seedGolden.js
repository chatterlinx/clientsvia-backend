/**
 * ============================================================================
 * SEED GOLDEN SETUP API - CLEAN SEPARATION
 * ============================================================================
 * 
 * CRITICAL ARCHITECTURE (December 2025):
 * 
 * 1. GLOBAL TEMPLATES (isTemplate=true, companyId=null)
 *    - Blueprints that live in the system
 *    - Created by seedGlobalTemplates()
 *    - NEVER used directly in runtime
 * 
 * 2. COMPANY FLOWS (isTemplate=false, companyId=<id>)
 *    - Runtime execution flows
 *    - Created ONLY via explicit "Copy to Company"
 *    - NEVER auto-created during template seeding
 * 
 * POST /api/company/:companyId/seed-golden
 *   → Seeds company CONFIG (placeholders, front desk, booking, defaults, etc.)
 *   → Seeds GLOBAL TEMPLATES for the trade
 *   → Does NOT create company flows
 * 
 * POST /api/company/:companyId/seed-golden/copy-templates
 *   → Copies templates to company as active flows
 *   → Explicit user action
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const logger = require('../../utils/logger');

// Models
const Company = require('../../models/v2Company');
const CompanyPlaceholders = require('../../models/CompanyPlaceholders');
const CompanyResponseDefaults = require('../../models/CompanyResponseDefaults');
const DynamicFlow = require('../../models/DynamicFlow');
const CheatSheetVersion = require('../../models/cheatsheet/CheatSheetVersion');

// Golden configurations
const goldenConfigs = {
    hvac_residential: require('../../config/goldenSetups/hvac_residential')
};

// Auth middleware
const { authenticateJWT } = require('../../middleware/auth');

/**
 * POST /api/company/:companyId/seed-golden
 * 
 * Seeds company config + global templates
 * Does NOT create company flows (use /copy-templates for that)
 */
router.post('/', authenticateJWT, async (req, res) => {
    const { companyId } = req.params;
    const { profile = 'penguin_air', tradeCategoryKey = 'hvac_residential' } = req.body;
    
    const startTime = Date.now();
    const results = {
        companyId,
        profile,
        tradeCategoryKey,
        actions: [],
        warnings: [],
        errors: [],
        // New: Explicitly track what we're doing
        templatesSeeded: 0,
        companyFlowsCreated: 0 // Should always be 0 from this endpoint
    };
    
    logger.info('[SEED GOLDEN] Starting golden setup', { companyId, profile, tradeCategoryKey });
    
    try {
        // Get golden configuration
        const goldenConfig = goldenConfigs[tradeCategoryKey];
        if (!goldenConfig) {
            return res.status(400).json({
                success: false,
                error: `Unknown trade category: ${tradeCategoryKey}`,
                available: Object.keys(goldenConfigs)
            });
        }
        
        // Verify company exists
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // A) SEED PLACEHOLDERS
        // ═══════════════════════════════════════════════════════════════════
        try {
            const placeholdersResult = await seedPlaceholders(companyId, goldenConfig.placeholders);
            results.actions.push({
                section: 'placeholders',
                ...placeholdersResult
            });
        } catch (error) {
            results.errors.push({ section: 'placeholders', error: error.message });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // B) SEED FRONT DESK BEHAVIOR
        // ═══════════════════════════════════════════════════════════════════
        try {
            const frontDeskResult = await seedFrontDeskBehavior(companyId, goldenConfig.frontDeskBehavior, company);
            results.actions.push({
                section: 'frontDeskBehavior',
                ...frontDeskResult
            });
        } catch (error) {
            results.errors.push({ section: 'frontDeskBehavior', error: error.message });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // C) SEED BOOKING CONFIGURATION
        // ═══════════════════════════════════════════════════════════════════
        try {
            const bookingResult = await seedBookingConfig(companyId, goldenConfig.booking, company);
            results.actions.push({
                section: 'booking',
                ...bookingResult
            });
        } catch (error) {
            results.errors.push({ section: 'booking', error: error.message });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // D) SEED DEFAULT REPLIES
        // ═══════════════════════════════════════════════════════════════════
        try {
            const defaultsResult = await seedDefaultReplies(companyId, goldenConfig.defaultReplies);
            results.actions.push({
                section: 'defaultReplies',
                ...defaultsResult
            });
        } catch (error) {
            results.errors.push({ section: 'defaultReplies', error: error.message });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // E) SEED TRANSFERS
        // ═══════════════════════════════════════════════════════════════════
        try {
            const transfersResult = await seedTransfers(companyId, goldenConfig.transfers, company);
            results.actions.push({
                section: 'transfers',
                ...transfersResult
            });
        } catch (error) {
            results.errors.push({ section: 'transfers', error: error.message });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // F) SEED CALL PROTECTION
        // ═══════════════════════════════════════════════════════════════════
        try {
            const callProtectionResult = await seedCallProtection(companyId, goldenConfig.callProtection);
            results.actions.push({
                section: 'callProtection',
                ...callProtectionResult
            });
        } catch (error) {
            results.errors.push({ section: 'callProtection', error: error.message });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // G) SEED GLOBAL DYNAMIC FLOW TEMPLATES (NOT company flows!)
        // ═══════════════════════════════════════════════════════════════════
        try {
            const templatesResult = await seedGlobalTemplates(tradeCategoryKey, goldenConfig.dynamicFlows);
            results.actions.push({
                section: 'dynamicFlowTemplates',
                ...templatesResult
            });
            results.templatesSeeded = templatesResult.created + templatesResult.updated;
            
            // Add warning about needing to copy templates
            if (templatesResult.created > 0 || templatesResult.updated > 0) {
                results.warnings.push(`${results.templatesSeeded} templates seeded. Use "Copy Templates to Company" to activate them.`);
            }
        } catch (error) {
            results.errors.push({ section: 'dynamicFlowTemplates', error: error.message });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // H) SET TRADE CATEGORY
        // ═══════════════════════════════════════════════════════════════════
        try {
            await Company.findByIdAndUpdate(companyId, {
                $set: {
                    tradeKey: tradeCategoryKey,
                    industryType: tradeCategoryKey
                }
            });
            results.actions.push({
                section: 'tradeCategory',
                action: 'set',
                value: tradeCategoryKey
            });
        } catch (error) {
            results.errors.push({ section: 'tradeCategory', error: error.message });
        }
        
        results.duration = Date.now() - startTime;
        results.success = results.errors.length === 0;
        
        logger.info('[SEED GOLDEN] Completed', {
            companyId,
            profile,
            duration: results.duration,
            actionsCount: results.actions.length,
            templatesSeeded: results.templatesSeeded,
            companyFlowsCreated: results.companyFlowsCreated,
            errorsCount: results.errors.length
        });
        
        res.json(results);
        
    } catch (error) {
        logger.error('[SEED GOLDEN] Fatal error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            results
        });
    }
});

/**
 * POST /api/company/:companyId/seed-golden/copy-templates
 * 
 * EXPLICIT action to copy global templates to company as active flows.
 * This is the ONLY way company flows should be created from templates.
 * 
 * Body: {
 *   tradeCategoryKey: "hvac_residential",
 *   flowKeys: ["emergency_detection", "booking_intent"] // Optional: specific flows, or all if omitted
 * }
 */
router.post('/copy-templates', authenticateJWT, async (req, res) => {
    const { companyId } = req.params;
    const { tradeCategoryKey = 'hvac_residential', flowKeys = null } = req.body;
    
    const startTime = Date.now();
    const results = {
        companyId,
        tradeCategoryKey,
        copied: [],
        skipped: [],
        errors: []
    };
    
    logger.info('[COPY TEMPLATES] Starting', { companyId, tradeCategoryKey, flowKeys });
    
    try {
        // Get all templates for this trade
        const templateQuery = {
            isTemplate: true,
            enabled: true,
            $or: [
                { tradeType: tradeCategoryKey.split('_')[0] }, // hvac
                { tradeType: null },
                { tradeType: 'general' }
            ]
        };
        
        // If specific flowKeys requested, filter to those
        if (flowKeys && flowKeys.length > 0) {
            templateQuery.flowKey = { $in: flowKeys };
        }
        
        const templates = await DynamicFlow.find(templateQuery).lean();
        
        if (templates.length === 0) {
            return res.json({
                success: true,
                message: 'No templates found for this trade category',
                results
            });
        }
        
        // Copy each template to company
        for (const template of templates) {
            try {
                // Check if company already has this flow
                const existingFlow = await DynamicFlow.findOne({
                    companyId,
                    flowKey: template.flowKey,
                    isTemplate: false
                });
                
                if (existingFlow) {
                    results.skipped.push({
                        flowKey: template.flowKey,
                        reason: 'Already exists for company'
                    });
                    continue;
                }
                
                // Create company flow from template
                const companyFlow = await DynamicFlow.createFromTemplate(template._id, companyId);
                results.copied.push({
                    flowKey: template.flowKey,
                    name: template.name,
                    companyFlowId: companyFlow._id.toString()
                });
                
            } catch (error) {
                results.errors.push({
                    flowKey: template.flowKey,
                    error: error.message
                });
            }
        }
        
        results.duration = Date.now() - startTime;
        results.success = results.errors.length === 0;
        results.summary = {
            copied: results.copied.length,
            skipped: results.skipped.length,
            errors: results.errors.length
        };
        
        logger.info('[COPY TEMPLATES] Completed', results);
        res.json(results);
        
    } catch (error) {
        logger.error('[COPY TEMPLATES] Fatal error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            results
        });
    }
});

/**
 * POST /api/company/:companyId/seed-golden/quick-booking-flow
 * 
 * QUICK ACTION: Creates a working booking flow for the company.
 * This is a "one-click" solution for Step 2 of the build order.
 * 
 * Does NOT require templates to exist - creates flow directly.
 */
router.post('/quick-booking-flow', authenticateJWT, async (req, res) => {
    const { companyId } = req.params;
    const startTime = Date.now();
    
    logger.info('[QUICK BOOKING FLOW] Creating for company:', companyId);
    
    try {
        // Check if booking_intent flow already exists
        const existingFlow = await DynamicFlow.findOne({
            companyId,
            flowKey: 'booking_intent',
            isTemplate: false
        });
        
        if (existingFlow) {
            // If it exists but is disabled, enable it
            if (!existingFlow.enabled) {
                existingFlow.enabled = true;
                await existingFlow.save();
                return res.json({
                    success: true,
                    message: 'Booking flow already existed - now enabled!',
                    flowId: existingFlow._id.toString(),
                    flowKey: 'booking_intent',
                    enabled: true,
                    duration: Date.now() - startTime
                });
            }
            
            return res.json({
                success: true,
                message: 'Booking flow already exists and is enabled',
                flowId: existingFlow._id.toString(),
                flowKey: 'booking_intent',
                enabled: existingFlow.enabled,
                duration: Date.now() - startTime
            });
        }
        
        // Create the booking flow directly
        const bookingFlow = new DynamicFlow({
            companyId,
            flowKey: 'booking_intent',
            name: 'Booking Intent Detection',
            description: 'Detects when caller wants to schedule service and transitions to booking mode',
            priority: 50,
            enabled: true,
            isTemplate: false,
            
            // Triggers - must have phrases for flow to be valid
            triggers: [{
                type: 'phrase',
                config: {
                    phrases: [
                        'schedule',
                        'appointment',
                        'book',
                        'come out',
                        'send someone',
                        'need service',
                        'need repair',
                        'can you fix',
                        'available',
                        'when can you come',
                        'schedule a technician',
                        'get someone out here',
                        'make an appointment',
                        'set up service'
                    ],
                    fuzzy: true,
                    minConfidence: 0.6
                },
                priority: 50,
                description: 'Detects booking/appointment intent'
            }],
            
            // Actions
            actions: [
                {
                    timing: 'on_activate',
                    type: 'set_flag',
                    config: {
                        flagName: 'wantsBooking',
                        flagValue: true,
                        alsoWriteToCallLedgerFacts: true
                    },
                    description: 'Mark booking intent'
                },
                {
                    timing: 'on_activate',
                    type: 'append_ledger',
                    config: {
                        type: 'EVENT',
                        key: 'BOOKING_INTENT',
                        note: 'Caller wants to schedule service'
                    },
                    description: 'Log booking intent to ledger'
                },
                {
                    timing: 'on_activate',
                    type: 'ack_once',
                    config: {
                        text: "I'd be happy to help you schedule service!"
                    },
                    description: 'Acknowledge booking request'
                },
                {
                    timing: 'on_complete',
                    type: 'transition_mode',
                    config: {
                        targetMode: 'BOOKING',
                        setBookingLocked: true
                    },
                    description: 'Transition to booking mode'
                }
            ],
            
            settings: {
                allowConcurrent: false
            }
        });
        
        await bookingFlow.save();
        
        logger.info('[QUICK BOOKING FLOW] Created successfully:', {
            flowId: bookingFlow._id,
            flowKey: bookingFlow.flowKey,
            triggerCount: bookingFlow.triggers.length,
            actionCount: bookingFlow.actions.length
        });
        
        res.json({
            success: true,
            message: 'Booking flow created and enabled!',
            flowId: bookingFlow._id.toString(),
            flowKey: 'booking_intent',
            name: bookingFlow.name,
            enabled: true,
            triggerCount: bookingFlow.triggers[0].config.phrases.length,
            actionCount: bookingFlow.actions.length,
            duration: Date.now() - startTime
        });
        
    } catch (error) {
        logger.error('[QUICK BOOKING FLOW] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/company/:companyId/seed-golden/booking-slots
 * 
 * Seeds GOLDEN booking slots with proper configuration:
 * - Name slot with spelling variant checking, confirm-back, last name prompt
 * - Phone slot with caller ID offer
 * - Address slot with confirmation
 * - Time slot with ASAP option
 * 
 * This is the "gold standard" for how booking should be configured.
 */
router.post('/booking-slots', authenticateJWT, async (req, res) => {
    const { companyId } = req.params;
    const startTime = Date.now();
    
    try {
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ success: false, error: 'Company not found' });
        }
        
        // ═══════════════════════════════════════════════════════════════════════════
        // GOLDEN BOOKING SLOTS - The proper way to configure booking
        // ═══════════════════════════════════════════════════════════════════════════
        const goldenBookingSlots = [
            {
                id: 'name',           // MUST be 'name' for name intelligence to work
                slotId: 'name',       // Redundant for safety
                label: 'Customer Name',
                question: 'May I have your name, please?',
                type: 'name',
                required: true,
                order: 0,
                // Name-specific options
                askFullName: true,                    // Ask for last name after first
                useFirstNameOnly: false,              // We want full name
                askMissingNamePart: true,             // "And your last name?"
                // Confirmation
                confirmBack: true,
                confirmPrompt: 'Got it, {value}. Did I get that right?',
                // Helper
                helperNote: 'Caller usually gives first name first. Confirm spelling for similar names (Mark/Marc).'
            },
            {
                id: 'phone',
                slotId: 'phone',
                label: 'Phone Number',
                question: 'What\'s the best phone number to reach you?',
                type: 'phone',
                required: true,
                order: 1,
                // Phone-specific options
                offerCallerId: true,                  // "I see you're calling from XXX - is that a good number?"
                callerIdPrompt: 'I see you\'re calling from {callerId}. Is that a good number for us to reach you, or would you prefer a different one?',
                acceptTextMe: true,                   // Accept "text me" as valid
                breakDownIfUnclear: true,             // Break down if unclear
                // Confirmation
                confirmBack: true,
                confirmPrompt: 'Got it, {value}. Let me repeat that back - is that correct?'
            },
            {
                id: 'address',
                slotId: 'address',
                label: 'Service Address',
                question: 'What\'s the address for the service?',
                type: 'address',
                required: true,
                order: 2,
                // Address-specific options
                addressConfirmLevel: 'street_city',   // Confirm street and city
                acceptPartialAddress: false,          // Need full address
                breakDownIfUnclear: true,
                // Confirmation
                confirmBack: true,
                confirmPrompt: 'Let me confirm - that\'s {value}, correct?'
            },
            {
                id: 'time',
                slotId: 'time',
                label: 'Preferred Time',
                question: 'When would be a good time for the technician to come out?',
                type: 'datetime',
                required: true,
                order: 3,
                // DateTime-specific options
                offerAsap: true,                      // Offer "first available" option
                asapPhrase: 'as soon as possible',
                offerMorningAfternoon: true,          // "Morning or afternoon works better?"
                // Confirmation
                confirmBack: true,
                confirmPrompt: 'Great, I\'ll note that down as {value}.'
            }
        ];
        
        // ═══════════════════════════════════════════════════════════════════════════
        // GOLDEN NAME SPELLING VARIANTS CONFIG
        // ═══════════════════════════════════════════════════════════════════════════
        const goldenNameSpellingVariants = {
            enabled: true,
            mode: '1_char_only',
            source: 'curated_list',
            // Common spelling variants to check
            curatedVariants: {
                'mark': ['marc'],
                'marc': ['mark'],
                'brian': ['bryan', 'bryon'],
                'bryan': ['brian', 'bryon'],
                'steven': ['stephen', 'stefan'],
                'stephen': ['steven', 'stefan'],
                'jeff': ['geoff', 'geoffrey'],
                'geoff': ['jeff', 'jeffrey'],
                'john': ['jon'],
                'jon': ['john'],
                'michael': ['micheal', 'mike'],
                'chris': ['kris'],
                'kris': ['chris'],
                'cathy': ['kathy', 'cathie'],
                'kathy': ['cathy', 'kathie'],
                'sara': ['sarah'],
                'sarah': ['sara'],
                'eric': ['erik'],
                'erik': ['eric'],
                'alan': ['allan', 'allen'],
                'allen': ['alan', 'allan'],
                'anne': ['ann'],
                'ann': ['anne'],
                'phillip': ['philip'],
                'philip': ['phillip'],
                'rachel': ['rachael'],
                'rachael': ['rachel'],
                'teresa': ['theresa'],
                'theresa': ['teresa'],
                'tony': ['toni'],
                'toni': ['tony']
            },
            confirmPrompt: 'Just to confirm - is that {name} with a {diff}, or {variant}?'
        };
        
        // ═══════════════════════════════════════════════════════════════════════════
        // UPDATE COMPANY DOCUMENT - Use $set to avoid full validation issues
        // ═══════════════════════════════════════════════════════════════════════════
        
        const bookingTemplates = {
            confirmTemplate: 'Perfect, {name}! I have you scheduled for {time} at {address}. We\'ll send a confirmation to {phone}.',
            completeTemplate: 'You\'re all set! Is there anything else I can help you with?',
            offerAsap: true,
            asapPhrase: 'as soon as possible'
        };
        
        // Use updateOne with $set to avoid triggering validation on unrelated fields
        await Company.updateOne(
            { _id: companyId },
            {
                $set: {
                    'aiAgentSettings.frontDeskBehavior.bookingEnabled': true,
                    'aiAgentSettings.frontDeskBehavior.bookingSlots': goldenBookingSlots,
                    'aiAgentSettings.frontDeskBehavior.nameSpellingVariants': goldenNameSpellingVariants,
                    'aiAgentSettings.frontDeskBehavior.bookingTemplates': bookingTemplates
                }
            }
        );
        
        logger.info('[GOLDEN BOOKING SLOTS] Seeded for company', {
            companyId,
            companyName: company.companyName,
            slotsCount: goldenBookingSlots.length,
            slotIds: goldenBookingSlots.map(s => s.id),
            spellingVariantsEnabled: true,
            duration: Date.now() - startTime
        });
        
        res.json({
            success: true,
            message: 'Golden booking slots seeded successfully',
            config: {
                bookingEnabled: true,
                slotsCount: goldenBookingSlots.length,
                slots: goldenBookingSlots.map(s => ({
                    id: s.id,
                    label: s.label,
                    type: s.type,
                    required: s.required,
                    question: s.question.substring(0, 50) + '...'
                })),
                nameSpellingVariants: {
                    enabled: goldenNameSpellingVariants.enabled,
                    variantCount: Object.keys(goldenNameSpellingVariants.curatedVariants).length
                }
            },
            duration: Date.now() - startTime
        });
        
    } catch (error) {
        logger.error('[GOLDEN BOOKING SLOTS] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/company/:companyId/seed-golden/templates
 * 
 * List available templates for a trade category
 */
router.get('/templates', authenticateJWT, async (req, res) => {
    const { companyId } = req.params;
    const { tradeCategoryKey = 'hvac_residential' } = req.query;
    
    try {
        // Get company to check what flows already exist
        const existingFlows = await DynamicFlow.find({
            companyId,
            isTemplate: false
        }).select('flowKey').lean();
        
        const existingFlowKeys = new Set(existingFlows.map(f => f.flowKey));
        
        // Get templates
        const templates = await DynamicFlow.find({
            isTemplate: true,
            enabled: true,
            $or: [
                { tradeType: tradeCategoryKey.split('_')[0] },
                { tradeType: null },
                { tradeType: 'general' }
            ]
        }).select('flowKey name description priority trigger.type settings').lean();
        
        // Mark which are already copied
        const templatesWithStatus = templates.map(t => ({
            ...t,
            alreadyCopied: existingFlowKeys.has(t.flowKey)
        }));
        
        res.json({
            success: true,
            tradeCategoryKey,
            count: templates.length,
            alreadyCopied: templates.filter(t => existingFlowKeys.has(t.flowKey)).length,
            templates: templatesWithStatus
        });
        
    } catch (error) {
        logger.error('[LIST TEMPLATES] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/company/:companyId/seed-golden/profiles
 * Returns available golden profiles
 */
router.get('/profiles', authenticateJWT, (req, res) => {
    res.json({
        success: true,
        profiles: Object.keys(goldenConfigs).map(key => ({
            tradeCategoryKey: key,
            profileKey: goldenConfigs[key].profileKey,
            name: goldenConfigs[key].placeholders.find(p => p.key === 'companyname')?.value || key
        }))
    });
});

/**
 * POST /api/company/:companyId/seed-golden/copy-from/:sourceCompanyId
 * 
 * Copy settings from another company (e.g., golden reference)
 */
router.post('/copy-from/:sourceCompanyId', authenticateJWT, async (req, res) => {
    const { companyId: targetCompanyId, sourceCompanyId } = req.params;
    const { sections = ['frontDesk', 'booking', 'defaultReplies', 'transfers', 'callProtection'] } = req.body;
    
    const startTime = Date.now();
    const results = {
        targetCompanyId,
        sourceCompanyId,
        sections,
        copied: [],
        skipped: [],
        errors: []
    };
    
    logger.info('[COPY FROM COMPANY] Starting', { targetCompanyId, sourceCompanyId, sections });
    
    try {
        const [sourceCompany, targetCompany] = await Promise.all([
            Company.findById(sourceCompanyId),
            Company.findById(targetCompanyId)
        ]);
        
        if (!sourceCompany) {
            return res.status(404).json({ success: false, error: 'Source company not found' });
        }
        if (!targetCompany) {
            return res.status(404).json({ success: false, error: 'Target company not found' });
        }
        
        for (const section of sections) {
            try {
                switch (section) {
                    case 'frontDesk':
                        await copyFrontDesk(sourceCompanyId, targetCompanyId, sourceCompany);
                        results.copied.push('frontDesk');
                        break;
                    case 'booking':
                        await copyBooking(sourceCompanyId, targetCompanyId, sourceCompany);
                        results.copied.push('booking');
                        break;
                    case 'defaultReplies':
                        await copyDefaultReplies(sourceCompanyId, targetCompanyId);
                        results.copied.push('defaultReplies');
                        break;
                    case 'transfers':
                        await copyTransfers(sourceCompanyId, targetCompanyId, sourceCompany);
                        results.copied.push('transfers');
                        break;
                    case 'callProtection':
                        await copyCallProtection(sourceCompanyId, targetCompanyId);
                        results.copied.push('callProtection');
                        break;
                    case 'placeholders':
                        await copyPlaceholders(sourceCompanyId, targetCompanyId);
                        results.copied.push('placeholders');
                        break;
                    default:
                        results.skipped.push(section);
                }
            } catch (error) {
                results.errors.push({ section, error: error.message });
            }
        }
        
        results.duration = Date.now() - startTime;
        results.success = results.errors.length === 0;
        
        logger.info('[COPY FROM COMPANY] Completed', results);
        res.json(results);
        
    } catch (error) {
        logger.error('[COPY FROM COMPANY] Fatal error:', error);
        res.status(500).json({ success: false, error: error.message, results });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

async function seedPlaceholders(companyId, placeholders) {
    const result = { created: 0, updated: 0, skipped: 0 };
    
    let doc = await CompanyPlaceholders.findOne({ companyId });
    if (!doc) {
        doc = new CompanyPlaceholders({ companyId, placeholders: [] });
    }
    
    const existingMap = new Map(doc.placeholders.map(p => [p.key, p]));
    
    for (const ph of placeholders) {
        const existing = existingMap.get(ph.key);
        if (!existing) {
            doc.placeholders.push(ph);
            result.created++;
        } else if (!existing.value && ph.value) {
            existing.value = ph.value;
            result.updated++;
        } else {
            result.skipped++;
        }
    }
    
    await doc.save();
    return result;
}

async function seedFrontDeskBehavior(companyId, config, company) {
    const update = {
        'aiAgentSettings.frontDeskBehavior.greeting': config.greeting,
        'aiAgentSettings.frontDeskBehavior.conversationStyle': config.conversationStyle,
        'aiAgentSettings.frontDeskBehavior.personality': config.personality,
        'aiAgentSettings.frontDeskBehavior.forbiddenPhrases': config.forbiddenPhrases,
        'aiAgentSettings.frontDeskBehavior.blockPricing': config.blockPricing,
        'aiAgentSettings.frontDeskBehavior.pricingDeflection': config.pricingDeflection
    };
    
    await Company.findByIdAndUpdate(companyId, { $set: update });
    return { action: 'updated', fields: Object.keys(update).length };
}

async function seedBookingConfig(companyId, config, company) {
    const update = {
        'aiAgentSettings.bookingEnabled': config.enabled,
        'aiAgentSettings.frontDeskBehavior.bookingSlots': config.slots,
        'aiAgentSettings.frontDeskBehavior.urgentBookingBehavior': config.urgentBookingBehavior,
        'aiAgentSettings.frontDeskBehavior.urgentTransferTarget': config.urgentTransferTarget
    };
    
    await Company.findByIdAndUpdate(companyId, { $set: update });
    return { action: 'updated', slotsCount: config.slots.length };
}

async function seedDefaultReplies(companyId, config) {
    const defaults = await CompanyResponseDefaults.findOneAndUpdate(
        { companyId },
        {
            $set: {
                notOfferedReply: config.notOfferedReply,
                unknownIntentReply: config.unknownIntentReply,
                afterHoursReply: config.afterHoursReply,
                strictDisabledBehavior: config.strictDisabledBehavior
            }
        },
        { upsert: true, new: true }
    );
    
    return { action: 'upserted', id: defaults._id.toString() };
}

async function seedTransfers(companyId, transfers, company) {
    const result = { created: 0, updated: 0 };
    
    const existingTargets = company.aiAgentSettings?.transferTargets || [];
    const existingMap = new Map(existingTargets.map(t => [t.id, t]));
    
    const newTargets = [];
    for (const transfer of transfers) {
        const existing = existingMap.get(transfer.id);
        if (existing) {
            Object.assign(existing, transfer);
            newTargets.push(existing);
            result.updated++;
        } else {
            newTargets.push(transfer);
            result.created++;
        }
    }
    
    for (const [id, target] of existingMap) {
        if (!transfers.find(t => t.id === id)) {
            newTargets.push(target);
        }
    }
    
    await Company.findByIdAndUpdate(companyId, {
        $set: { 'aiAgentSettings.transferTargets': newTargets }
    });
    
    return result;
}

async function seedCallProtection(companyId, rules) {
    const result = { created: 0, updated: 0, removed: 0 };
    
    let cheatSheet = await CheatSheetVersion.findOne({ companyId, status: 'live' });
    
    if (!cheatSheet) {
        cheatSheet = new CheatSheetVersion({
            companyId,
            status: 'live',
            config: { edgeCases: [], transferRules: [] }
        });
    }
    
    const existingEdgeCases = cheatSheet.config?.edgeCases || [];
    
    // Remove invalid rules
    const invalidRemoved = existingEdgeCases.filter(ec => 
        ec.enabled !== false && 
        ((ec.triggerPatterns?.length === 0 && !['voicemail', 'machine', 'spam'].includes(ec.type)) ||
         (!ec.responseText && !ec.transferTargetId && ec.action !== 'hangup'))
    );
    result.removed = invalidRemoved.length;
    
    const existingValidMap = new Map(
        existingEdgeCases
            .filter(ec => !invalidRemoved.includes(ec))
            .map(ec => [ec.name, ec])
    );
    
    const newEdgeCases = [];
    for (const rule of rules) {
        const existing = existingValidMap.get(rule.name);
        if (existing) {
            Object.assign(existing, rule);
            newEdgeCases.push(existing);
            result.updated++;
            existingValidMap.delete(rule.name);
        } else {
            newEdgeCases.push(rule);
            result.created++;
        }
    }
    
    for (const [name, rule] of existingValidMap) {
        newEdgeCases.push(rule);
    }
    
    cheatSheet.config.edgeCases = newEdgeCases;
    await cheatSheet.save();
    
    return result;
}

/**
 * SEED GLOBAL TEMPLATES (NOT company flows!)
 * 
 * These are blueprint templates with isTemplate=true and companyId=null.
 * They are NOT used in runtime until explicitly copied to a company.
 * 
 * CRITICAL FIX (Dec 2025):
 * Must set BOTH tradeType (legacy) AND tradeCategoryId (V2 ObjectId).
 * The UI filters by tradeCategoryId, so templates without it won't appear!
 */
async function seedGlobalTemplates(tradeCategoryKey, flowConfigs) {
    const result = { created: 0, updated: 0, skipped: 0, tradeCategoryId: null };
    const tradeType = tradeCategoryKey.split('_')[0]; // "hvac" from "hvac_residential"
    
    // ═══════════════════════════════════════════════════════════════════════════
    // CRITICAL: Look up the tradeCategoryId from v2TradeCategory collection
    // Without this, templates won't appear in the UI (it filters by ObjectId)
    // ═══════════════════════════════════════════════════════════════════════════
    const TradeCategory = require('../../models/v2TradeCategory');
    let tradeCategoryId = null;
    let tradeCategoryName = null;
    
    try {
        // Look for existing trade category by name patterns
        // The model uses 'name' field (not 'key'), e.g., "HVAC Residential"
        const searchPatterns = [
            tradeCategoryKey.replace('_', ' '),                    // "hvac residential"
            tradeType,                                              // "hvac"
            tradeCategoryKey.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') // "Hvac Residential"
        ];
        
        let tradeCategory = await TradeCategory.findOne({
            name: new RegExp(`^${tradeType}`, 'i'),  // Starts with "hvac" (case-insensitive)
            companyId: 'global'                       // Global trade categories only
        });
        
        if (!tradeCategory) {
            // Try broader search
            tradeCategory = await TradeCategory.findOne({
                name: new RegExp(tradeType, 'i'),
                isActive: true
            });
        }
        
        if (!tradeCategory) {
            // Log available categories to help debug
            const availableCategories = await TradeCategory.find({ isActive: true })
                .select('name companyId')
                .lean();
            logger.warn('[SEED TEMPLATES] No trade category found', { 
                tradeCategoryKey, 
                tradeType,
                searchPatterns,
                availableCategories: availableCategories.map(c => `${c.name} (${c.companyId})`)
            });
            
            // Create the trade category if it doesn't exist
            logger.info('[SEED TEMPLATES] Creating trade category: HVAC Residential');
            tradeCategory = await TradeCategory.create({
                name: 'HVAC Residential',
                description: 'HVAC residential services templates and scenarios',
                companyId: 'global',
                isActive: true,
                qnas: []
            });
        }
        
        tradeCategoryId = tradeCategory._id;
        tradeCategoryName = tradeCategory.name;
        result.tradeCategoryId = tradeCategoryId.toString();
        logger.info('[SEED TEMPLATES] Using trade category', {
            tradeCategoryKey,
            tradeCategoryId: tradeCategoryId.toString(),
            tradeCategoryName
        });
    } catch (err) {
        logger.error('[SEED TEMPLATES] Error looking up trade category:', err.message);
    }
    
    for (const flowConfig of flowConfigs) {
        try {
            // Check if template already exists
            const existingTemplate = await DynamicFlow.findOne({
                flowKey: flowConfig.flowKey,
                isTemplate: true
            });
            
            if (existingTemplate) {
                // Update existing template - SET BOTH tradeType AND tradeCategoryId
                Object.assign(existingTemplate, {
                    ...flowConfig,
                    tradeType,
                    tradeCategoryId,        // V2 ObjectId (CRITICAL!)
                    tradeCategoryName,      // Human-readable name
                    isTemplate: true,
                    companyId: null, // Templates have no company
                    enabled: true
                });
                await existingTemplate.save();
                result.updated++;
            } else {
                // Create new template - SET BOTH tradeType AND tradeCategoryId
                const newTemplate = new DynamicFlow({
                    ...flowConfig,
                    tradeType,
                    tradeCategoryId,        // V2 ObjectId (CRITICAL!)
                    tradeCategoryName,      // Human-readable name
                    isTemplate: true,
                    companyId: null, // Templates have no company
                    enabled: true,
                    metadata: {
                        version: 1,
                        tags: [tradeCategoryKey, 'golden']
                    }
                });
                await newTemplate.save();
                result.created++;
            }
        } catch (error) {
            logger.error('[SEED TEMPLATES] Error seeding template:', {
                flowKey: flowConfig.flowKey,
                error: error.message
            });
            result.skipped++;
        }
    }
    
    return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// COPY HELPER FUNCTIONS (Company to Company)
// ═══════════════════════════════════════════════════════════════════════════

async function copyFrontDesk(sourceId, targetId, sourceCompany) {
    const frontDesk = sourceCompany.aiAgentSettings?.frontDeskBehavior || {};
    await Company.findByIdAndUpdate(targetId, {
        $set: {
            'aiAgentSettings.frontDeskBehavior.greeting': frontDesk.greeting,
            'aiAgentSettings.frontDeskBehavior.conversationStyle': frontDesk.conversationStyle,
            'aiAgentSettings.frontDeskBehavior.personality': frontDesk.personality,
            'aiAgentSettings.frontDeskBehavior.forbiddenPhrases': frontDesk.forbiddenPhrases,
            'aiAgentSettings.frontDeskBehavior.blockPricing': frontDesk.blockPricing,
            'aiAgentSettings.frontDeskBehavior.pricingDeflection': frontDesk.pricingDeflection
        }
    });
}

async function copyBooking(sourceId, targetId, sourceCompany) {
    const settings = sourceCompany.aiAgentSettings || {};
    const frontDesk = settings.frontDeskBehavior || {};
    await Company.findByIdAndUpdate(targetId, {
        $set: {
            'aiAgentSettings.bookingEnabled': settings.bookingEnabled,
            'aiAgentSettings.frontDeskBehavior.bookingSlots': frontDesk.bookingSlots,
            'aiAgentSettings.frontDeskBehavior.urgentBookingBehavior': frontDesk.urgentBookingBehavior,
            'aiAgentSettings.frontDeskBehavior.urgentTransferTarget': frontDesk.urgentTransferTarget
        }
    });
}

async function copyDefaultReplies(sourceId, targetId) {
    const sourceDefaults = await CompanyResponseDefaults.findOne({ companyId: sourceId }).lean();
    if (sourceDefaults) {
        await CompanyResponseDefaults.findOneAndUpdate(
            { companyId: targetId },
            {
                $set: {
                    notOfferedReply: sourceDefaults.notOfferedReply,
                    unknownIntentReply: sourceDefaults.unknownIntentReply,
                    afterHoursReply: sourceDefaults.afterHoursReply,
                    strictDisabledBehavior: sourceDefaults.strictDisabledBehavior
                }
            },
            { upsert: true }
        );
    }
}

async function copyTransfers(sourceId, targetId, sourceCompany) {
    const transfers = sourceCompany.aiAgentSettings?.transferTargets || [];
    await Company.findByIdAndUpdate(targetId, {
        $set: { 'aiAgentSettings.transferTargets': transfers }
    });
}

async function copyCallProtection(sourceId, targetId) {
    const sourceSheet = await CheatSheetVersion.findOne({ companyId: sourceId, status: 'live' }).lean();
    
    if (sourceSheet?.config?.edgeCases) {
        let targetSheet = await CheatSheetVersion.findOne({ companyId: targetId, status: 'live' });
        if (!targetSheet) {
            targetSheet = new CheatSheetVersion({
                companyId: targetId,
                status: 'live',
                config: { edgeCases: [], transferRules: [] }
            });
        }
        targetSheet.config.edgeCases = sourceSheet.config.edgeCases;
        await targetSheet.save();
    }
}

async function copyPlaceholders(sourceId, targetId) {
    const sourcePlaceholders = await CompanyPlaceholders.findOne({ companyId: sourceId }).lean();
    
    if (sourcePlaceholders?.placeholders) {
        await CompanyPlaceholders.findOneAndUpdate(
            { companyId: targetId },
            { $set: { placeholders: sourcePlaceholders.placeholders } },
            { upsert: true }
        );
    }
}

module.exports = router;
