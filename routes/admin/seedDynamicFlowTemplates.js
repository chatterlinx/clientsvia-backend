/**
 * ============================================================================
 * SEED/FIX DYNAMIC FLOW TEMPLATES
 * ============================================================================
 * 
 * Admin endpoint to seed or fix global Dynamic Flow templates.
 * These are the "golden" templates that companies can copy.
 * 
 * POST /api/admin/dynamic-flow-templates/seed-golden
 * POST /api/admin/dynamic-flow-templates/validate-all
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const DynamicFlow = require('../../models/DynamicFlow');
const TradeCategory = require('../../models/v2TradeCategory');
const logger = require('../../utils/logger');

// ============================================================================
// GOLDEN HVAC TEMPLATES (CANONICAL FORMAT)
// ============================================================================
// 
// These templates use the CORRECT schema:
// - triggers: [{ type, config: { phrases, ... } }]  ← V2 schema
// - actions: [{ type, timing, config: { ... } }]
// 
// This matches what the DynamicFlow Mongoose schema expects.
//

const GOLDEN_HVAC_TEMPLATES = [
    // ═══════════════════════════════════════════════════════════════════════
    // 1) EMERGENCY SERVICE DETECTION
    // ═══════════════════════════════════════════════════════════════════════
    {
        flowKey: 'emergency_service',
        name: 'Emergency Service Detection',
        description: 'Detects emergency/urgent service requests and fast-tracks to booking',
        priority: 200,
        enabled: true,
        isTemplate: true,
        isActive: true,
        
        triggers: [{
            type: 'phrase',
            config: {
                phrases: [
                    'emergency',
                    'urgent',
                    'no ac',
                    'not cooling',
                    'ac stopped working',
                    'no air',
                    'system down',
                    'water leaking',
                    'burning smell',
                    'smoke',
                    'no heat',
                    'heat not working',
                    'freezing',
                    'pipe burst'
                ],
                fuzzy: true,
                minConfidence: 0.7
            }
        }],
        
        actions: [
            {
                timing: 'on_activate',
                type: 'set_flag',
                config: {
                    flagName: 'isEmergency',
                    flagValue: true,
                    alsoWriteToCallLedgerFacts: true
                }
            },
            {
                timing: 'on_activate',
                type: 'append_ledger',
                config: {
                    type: 'flow_event',
                    key: 'emergency_detected',
                    note: 'Emergency service flow triggered'
                }
            },
            {
                timing: 'on_activate',
                type: 'ack_once',
                config: {
                    key: 'ack_emergency',
                    text: "I understand this is urgent. Let me get you scheduled as quickly as possible."
                }
            },
            {
                timing: 'on_activate',
                type: 'transition_mode',
                config: {
                    mode: 'EMERGENCY'
                }
            }
        ],
        
        settings: {
            allowConcurrent: false
        },
        
        metadata: {
            version: 1,
            tradeType: 'hvac',
            createdBy: 'system',
            isGoldenTemplate: true
        }
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // 2) AFTER HOURS ROUTING
    // ═══════════════════════════════════════════════════════════════════════
    {
        flowKey: 'after_hours_routing',
        name: 'After Hours Detection',
        description: 'Detects calls outside business hours and routes appropriately',
        priority: 90,
        enabled: true,
        isTemplate: true,
        isActive: true,
        
        triggers: [{
            type: 'after_hours',
            config: {
                timezone: 'America/Phoenix',
                useCompanyHours: true
            }
        }],
        
        actions: [
            {
                timing: 'on_activate',
                type: 'set_flag',
                config: {
                    flagName: 'afterHours',
                    flagValue: true,
                    alsoWriteToCallLedgerFacts: true
                }
            },
            {
                timing: 'on_activate',
                type: 'append_ledger',
                config: {
                    type: 'flow_event',
                    key: 'after_hours_detected',
                    note: 'Call received outside business hours'
                }
            },
            {
                timing: 'on_activate',
                type: 'ack_once',
                config: {
                    key: 'ack_after_hours',
                    text: "You've reached us after hours. I can take a message and have someone call you back, or if this is an emergency, just tell me what's going on."
                }
            },
            {
                timing: 'on_activate',
                type: 'transition_mode',
                config: {
                    mode: 'AFTER_HOURS'
                }
            }
        ],
        
        settings: {
            allowConcurrent: true
        },
        
        metadata: {
            version: 1,
            tradeType: 'hvac',
            createdBy: 'system',
            isGoldenTemplate: true
        }
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // 3) RETURNING CUSTOMER CLAIM
    // ═══════════════════════════════════════════════════════════════════════
    {
        flowKey: 'returning_customer_claim',
        name: 'Returning Customer Detection',
        description: 'Detects when caller claims to be an existing customer',
        priority: 150,
        enabled: true,
        isTemplate: true,
        isActive: true,
        
        triggers: [{
            type: 'phrase',
            config: {
                phrases: [
                    'returning customer',
                    'been here before',
                    'you serviced my',
                    'had you out',
                    'came out last',
                    'existing customer',
                    'im a customer',
                    "i'm a customer",
                    'previous service',
                    'came before',
                    'already a customer'
                ],
                fuzzy: true,
                minConfidence: 0.75
            }
        }],
        
        actions: [
            {
                timing: 'on_activate',
                type: 'set_flag',
                config: {
                    flagName: 'isReturningCustomer',
                    flagValue: true,
                    alsoWriteToCallLedgerFacts: true
                }
            },
            {
                timing: 'on_activate',
                type: 'append_ledger',
                config: {
                    type: 'customer_claim',
                    key: 'returning_customer',
                    note: 'Caller claims to be existing customer'
                }
            },
            {
                timing: 'on_activate',
                type: 'ack_once',
                config: {
                    key: 'ack_returning',
                    text: "Welcome back! Let me pull up your information. Can you confirm the phone number on file?"
                }
            },
            {
                timing: 'on_activate',
                type: 'transition_mode',
                config: {
                    mode: 'BOOKING'
                }
            }
        ],
        
        settings: {
            allowConcurrent: false
        },
        
        metadata: {
            version: 1,
            tradeType: 'hvac',
            createdBy: 'system',
            isGoldenTemplate: true
        }
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // 4) TECHNICIAN REQUEST
    // ═══════════════════════════════════════════════════════════════════════
    {
        flowKey: 'technician_request',
        name: 'Technician Request Detection',
        description: 'Detects when caller requests a specific technician',
        priority: 80,
        enabled: true,
        isTemplate: true,
        isActive: true,
        
        triggers: [{
            type: 'phrase',
            config: {
                phrases: [
                    'same technician',
                    'same tech',
                    'request a technician',
                    'specific technician',
                    'the guy who came',
                    'the one who fixed',
                    'want the same person',
                    'can i get the same',
                    'send the same'
                ],
                fuzzy: true,
                minConfidence: 0.6
            }
        }],
        
        actions: [
            {
                timing: 'on_activate',
                type: 'set_flag',
                config: {
                    flagName: 'requestedSpecificTech',
                    flagValue: true,
                    alsoWriteToCallLedgerFacts: true
                }
            },
            {
                timing: 'on_activate',
                type: 'append_ledger',
                config: {
                    type: 'flow_event',
                    key: 'tech_request',
                    note: 'Caller requested specific technician'
                }
            },
            {
                timing: 'on_activate',
                type: 'ack_once',
                config: {
                    key: 'ack_tech_request',
                    text: "Got it! I'll note that you'd like the same technician. Do you remember their name?"
                }
            },
            {
                timing: 'on_activate',
                type: 'transition_mode',
                config: {
                    mode: 'BOOKING'
                }
            }
        ],
        
        settings: {
            allowConcurrent: false
        },
        
        metadata: {
            version: 1,
            tradeType: 'hvac',
            createdBy: 'system',
            isGoldenTemplate: true
        }
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // 5) PRICING INQUIRY DEFLECTION
    // ═══════════════════════════════════════════════════════════════════════
    {
        flowKey: 'pricing_inquiry',
        name: 'Pricing Inquiry Detection',
        description: 'Detects pricing questions and provides appropriate deflection',
        priority: 70,
        enabled: true,
        isTemplate: true,
        isActive: true,
        
        triggers: [{
            type: 'phrase',
            config: {
                phrases: [
                    'how much',
                    'what does it cost',
                    'price',
                    'pricing',
                    'estimate',
                    'quote',
                    'ballpark',
                    'charge',
                    'fee',
                    'rate'
                ],
                fuzzy: true,
                minConfidence: 0.65
            }
        }],
        
        actions: [
            {
                timing: 'on_activate',
                type: 'set_flag',
                config: {
                    flagName: 'pricingInquiry',
                    flagValue: true,
                    alsoWriteToCallLedgerFacts: true
                }
            },
            {
                timing: 'on_activate',
                type: 'append_ledger',
                config: {
                    type: 'flow_event',
                    key: 'pricing_inquiry',
                    note: 'Caller asked about pricing'
                }
            },
            {
                timing: 'on_activate',
                type: 'ack_once',
                config: {
                    key: 'ack_pricing',
                    text: "I'd be happy to help with pricing information. Our rates depend on the specific service needed. I can have one of our comfort advisors give you a detailed quote. Would you like to schedule a free estimate?"
                }
            }
            // Note: No transition_mode - stays in discovery
        ],
        
        settings: {
            allowConcurrent: true
        },
        
        metadata: {
            version: 1,
            tradeType: 'hvac',
            createdBy: 'system',
            isGoldenTemplate: true
        }
    }
];

// ============================================================================
// VALIDATE TEMPLATE HELPER
// ============================================================================

function validateTemplate(template) {
    const errors = [];
    const warnings = [];
    
    // Required fields
    if (!template.flowKey) errors.push('Missing flowKey');
    if (!template.name) errors.push('Missing name');
    
    // Triggers validation
    const triggers = template.triggers || [];
    if (triggers.length === 0) {
        errors.push('No triggers defined - template will NEVER fire');
    } else {
        triggers.forEach((t, i) => {
            if (!t.type) errors.push(`Trigger[${i}]: Missing type`);
            if (t.type === 'phrase') {
                const phrases = t.config?.phrases || t.phrases || [];
                if (phrases.length === 0) {
                    errors.push(`Trigger[${i}]: Phrase trigger has 0 phrases`);
                } else if (phrases.length < 3) {
                    warnings.push(`Trigger[${i}]: Only ${phrases.length} phrases (recommend 3+)`);
                }
            }
        });
    }
    
    // Actions validation
    const actions = template.actions || [];
    if (actions.length === 0) {
        warnings.push('No actions defined');
    } else {
        actions.forEach((a, i) => {
            if (!a.type) errors.push(`Action[${i}]: Missing type`);
        });
    }
    
    return {
        valid: errors.length === 0,
        errors,
        warnings,
        triggerCount: triggers.length,
        actionCount: actions.length,
        phraseCount: triggers.reduce((sum, t) => sum + (t.config?.phrases?.length || t.phrases?.length || 0), 0)
    };
}

// ============================================================================
// SEED GOLDEN TEMPLATES
// ============================================================================
// POST /api/admin/dynamic-flow-templates/seed-golden

router.post('/seed-golden', async (req, res) => {
    const results = {
        created: [],
        updated: [],
        errors: [],
        skipped: []
    };
    
    try {
        logger.info('[SEED TEMPLATES] Starting golden HVAC template seed');
        
        // Find or create HVAC trade category
        let hvacCategory = await TradeCategory.findOne({ 
            $or: [
                { name: 'HVAC Residential' },
                { key: 'hvac_residential' }
            ]
        });
        
        if (!hvacCategory) {
            hvacCategory = await TradeCategory.create({
                name: 'HVAC Residential',
                key: 'hvac_residential',
                description: 'Heating, Ventilation, and Air Conditioning for residential properties',
                isActive: true
            });
            logger.info('[SEED TEMPLATES] Created HVAC Residential trade category');
        }
        
        // Process each template
        for (const templateData of GOLDEN_HVAC_TEMPLATES) {
            try {
                // Validate first
                const validation = validateTemplate(templateData);
                if (!validation.valid) {
                    results.errors.push({
                        flowKey: templateData.flowKey,
                        reason: 'Validation failed',
                        errors: validation.errors
                    });
                    continue;
                }
                
                // Check if exists
                const existing = await DynamicFlow.findOne({
                    flowKey: templateData.flowKey,
                    isTemplate: true
                });
                
                const flowDoc = {
                    ...templateData,
                    tradeCategoryId: hvacCategory._id,
                    companyId: null,  // Templates have no company
                    isTemplate: true
                };
                
                if (existing) {
                    // Update existing
                    await DynamicFlow.findByIdAndUpdate(existing._id, {
                        $set: flowDoc,
                        $inc: { 'metadata.version': 1 }
                    });
                    
                    results.updated.push({
                        flowKey: templateData.flowKey,
                        name: templateData.name,
                        triggerCount: validation.triggerCount,
                        phraseCount: validation.phraseCount,
                        actionCount: validation.actionCount
                    });
                } else {
                    // Create new
                    await DynamicFlow.create(flowDoc);
                    
                    results.created.push({
                        flowKey: templateData.flowKey,
                        name: templateData.name,
                        triggerCount: validation.triggerCount,
                        phraseCount: validation.phraseCount,
                        actionCount: validation.actionCount
                    });
                }
                
            } catch (err) {
                results.errors.push({
                    flowKey: templateData.flowKey,
                    reason: err.message
                });
            }
        }
        
        logger.info('[SEED TEMPLATES] Seed complete', {
            created: results.created.length,
            updated: results.updated.length,
            errors: results.errors.length
        });
        
        res.json({
            success: true,
            message: `Seeded ${results.created.length} new, updated ${results.updated.length} existing`,
            results
        });
        
    } catch (error) {
        logger.error('[SEED TEMPLATES] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// VALIDATE ALL TEMPLATES
// ============================================================================
// GET /api/admin/dynamic-flow-templates/validate-all

router.get('/validate-all', async (req, res) => {
    try {
        const templates = await DynamicFlow.find({ isTemplate: true }).lean();
        
        const results = templates.map(t => ({
            flowKey: t.flowKey,
            name: t.name,
            enabled: t.enabled,
            ...validateTemplate(t)
        }));
        
        const valid = results.filter(r => r.valid);
        const invalid = results.filter(r => !r.valid);
        
        res.json({
            success: true,
            summary: {
                total: templates.length,
                valid: valid.length,
                invalid: invalid.length
            },
            templates: results
        });
        
    } catch (error) {
        logger.error('[VALIDATE TEMPLATES] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// DELETE INVALID TEMPLATES (DANGEROUS)
// ============================================================================
// DELETE /api/admin/dynamic-flow-templates/purge-invalid

router.delete('/purge-invalid', async (req, res) => {
    try {
        const { confirm } = req.query;
        
        if (confirm !== 'yes-delete-invalid') {
            return res.status(400).json({
                success: false,
                error: 'Must confirm with ?confirm=yes-delete-invalid'
            });
        }
        
        const templates = await DynamicFlow.find({ isTemplate: true }).lean();
        
        const toDelete = [];
        for (const t of templates) {
            const validation = validateTemplate(t);
            if (!validation.valid) {
                toDelete.push(t);
            }
        }
        
        if (toDelete.length === 0) {
            return res.json({
                success: true,
                message: 'No invalid templates to delete',
                deleted: 0
            });
        }
        
        // Delete them
        const ids = toDelete.map(t => t._id);
        await DynamicFlow.deleteMany({ _id: { $in: ids } });
        
        logger.warn('[PURGE TEMPLATES] Deleted invalid templates', {
            count: toDelete.length,
            flowKeys: toDelete.map(t => t.flowKey)
        });
        
        res.json({
            success: true,
            message: `Deleted ${toDelete.length} invalid templates`,
            deleted: toDelete.map(t => ({ flowKey: t.flowKey, name: t.name }))
        });
        
    } catch (error) {
        logger.error('[PURGE TEMPLATES] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;

