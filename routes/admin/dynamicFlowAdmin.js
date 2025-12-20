/**
 * ============================================================================
 * DYNAMIC FLOW ADMIN ROUTES - Seed Templates & Admin Operations
 * ============================================================================
 * 
 * Admin-only routes for managing global templates and system operations.
 * 
 * ROUTES:
 * - POST /api/admin/dynamic-flows/seed-templates    Seed global templates
 * - GET  /api/admin/dynamic-flows/templates         List all global templates
 * - DELETE /api/admin/dynamic-flows/templates/:id   Delete a template (admin only)
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const DynamicFlow = require('../../models/DynamicFlow');
const logger = require('../../utils/logger');

// ============================================================================
// MIDDLEWARE - Admin only
// ============================================================================

router.use(authenticateJWT);
router.use(requireRole('admin', 'owner'));

// ============================================================================
// TEMPLATE DEFINITIONS (Same as seed script)
// ============================================================================

const TEMPLATES = [
    // ─────────────────────────────────────────────────────────────────────────
    // RETURNING CUSTOMER FLOW
    // ─────────────────────────────────────────────────────────────────────────
    {
        name: 'Returning Customer Recognition',
        description: 'Detects and acknowledges returning customers. Sets flag for personalized service.',
        flowKey: 'returning_customer',
        isTemplate: true,
        enabled: true,
        priority: 100,
        tradeType: null,
        
        triggers: [
            {
                type: 'phrase',
                config: {
                    phrases: [
                        'returning customer',
                        'been here before',
                        'came here last',
                        'used you guys before',
                        'you came out before',
                        'you fixed my',
                        'last time you',
                        'remember me',
                        'i called before',
                        'we spoke before'
                    ],
                    fuzzy: true
                },
                priority: 10,
                description: 'Detect returning customer phrases'
            }
        ],
        
        requirements: [
            {
                type: 'acknowledge',
                config: {
                    acknowledgment: 'Welcome back! We appreciate your continued trust.',
                    onlyOnce: true
                },
                order: 1
            },
            {
                type: 'set_flag',
                config: {
                    flagName: 'isReturningCustomer',
                    flagValue: true
                },
                order: 2
            }
        ],
        
        actions: [
            {
                timing: 'on_activate',
                type: 'set_flag',
                config: {
                    flagName: 'returningCustomerDetected',
                    flagValue: true
                }
            }
        ],
        
        settings: {
            allowConcurrent: true,
            persistent: true,
            reactivatable: false,
            minConfidence: 0.7,
            enableTrace: true
        },
        
        metadata: {
            version: 1,
            tags: ['customer-recognition', 'personalization']
        }
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // EMERGENCY SERVICE FLOW
    // ─────────────────────────────────────────────────────────────────────────
    {
        name: 'Emergency Service Detection',
        description: 'Detects emergency situations and fast-tracks to booking.',
        flowKey: 'emergency_service',
        isTemplate: true,
        enabled: true,
        priority: 200,
        tradeType: 'hvac',
        
        triggers: [
            {
                type: 'keyword',
                config: {
                    keywords: [
                        'emergency', 'urgent', 'asap', 'right now',
                        'flooding', 'leak', 'no heat', 'no cooling',
                        'gas smell', 'smoke', 'sparking', 'fire'
                    ],
                    matchAll: false
                },
                priority: 20
            }
        ],
        
        requirements: [
            {
                type: 'acknowledge',
                config: {
                    acknowledgment: 'I understand this is urgent. Let me get you scheduled right away.',
                    onlyOnce: true
                },
                order: 1
            },
            {
                type: 'set_flag',
                config: {
                    flagName: 'isEmergency',
                    flagValue: true
                },
                order: 2
            }
        ],
        
        actions: [
            {
                timing: 'on_activate',
                type: 'transition_mode',
                config: {
                    targetMode: 'BOOKING'
                }
            },
            {
                timing: 'on_activate',
                type: 'set_flag',
                config: {
                    flagName: 'priorityLevel',
                    flagValue: 'emergency'
                }
            }
        ],
        
        settings: {
            allowConcurrent: false,
            conflictsWith: ['standard_booking'],
            persistent: true,
            reactivatable: false,
            minConfidence: 0.8,
            enableTrace: true
        },
        
        metadata: {
            version: 1,
            tags: ['emergency', 'fast-path', 'hvac']
        }
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // BOOKING INTENT FLOW
    // ─────────────────────────────────────────────────────────────────────────
    {
        name: 'Standard Booking Intent',
        description: 'Detects when caller wants to schedule service and transitions to booking mode.',
        flowKey: 'booking_intent',
        isTemplate: true,
        enabled: true,
        priority: 50,
        tradeType: null,
        
        triggers: [
            {
                type: 'phrase',
                config: {
                    phrases: [
                        'schedule an appointment',
                        'book an appointment',
                        'set up a visit',
                        'need someone to come out',
                        'want to schedule',
                        'can you send someone',
                        'need service',
                        'lets book it',
                        'yes please schedule',
                        'sounds good',
                        'lets do it'
                    ],
                    fuzzy: true
                },
                priority: 10
            }
        ],
        
        requirements: [
            {
                type: 'collect_slot',
                config: {
                    slotId: 'name',
                    required: true,
                    askImmediately: true
                },
                order: 1
            }
        ],
        
        actions: [
            {
                timing: 'on_activate',
                type: 'transition_mode',
                config: {
                    targetMode: 'BOOKING'
                }
            }
        ],
        
        settings: {
            allowConcurrent: false,
            persistent: true,
            reactivatable: false,
            minConfidence: 0.75,
            enableTrace: true
        },
        
        metadata: {
            version: 1,
            tags: ['booking', 'scheduling']
        }
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // PRICING INQUIRY FLOW
    // ─────────────────────────────────────────────────────────────────────────
    {
        name: 'Pricing Inquiry',
        description: 'Handles questions about pricing and costs.',
        flowKey: 'pricing_inquiry',
        isTemplate: true,
        enabled: true,
        priority: 30,
        tradeType: null,
        
        triggers: [
            {
                type: 'keyword',
                config: {
                    keywords: ['price', 'cost', 'how much', 'charge', 'fee', 'rate', 'estimate', 'quote'],
                    matchAll: false
                },
                priority: 10
            }
        ],
        
        requirements: [
            {
                type: 'response_rule',
                config: {
                    rule: 'use_pricing_response',
                    ruleConfig: {
                        lookupCheatSheet: true,
                        fallbackMessage: 'Pricing varies based on the specific service needed. We can provide an estimate once we know more about your situation.'
                    }
                },
                order: 1
            }
        ],
        
        actions: [
            {
                timing: 'on_activate',
                type: 'set_flag',
                config: {
                    flagName: 'pricingInquiry',
                    flagValue: true
                }
            }
        ],
        
        settings: {
            allowConcurrent: true,
            persistent: false,
            reactivatable: true,
            minConfidence: 0.7,
            enableTrace: true
        },
        
        metadata: {
            version: 1,
            tags: ['pricing', 'faq']
        }
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // FRUSTRATED CUSTOMER FLOW
    // ─────────────────────────────────────────────────────────────────────────
    {
        name: 'Frustrated Customer Handler',
        description: 'Detects customer frustration and applies de-escalation.',
        flowKey: 'frustrated_customer',
        isTemplate: true,
        enabled: true,
        priority: 150,
        tradeType: null,
        
        triggers: [
            {
                type: 'keyword',
                config: {
                    keywords: [
                        'frustrated', 'annoyed', 'angry', 'upset', 'ridiculous',
                        'unacceptable', 'terrible', 'horrible', 'worst',
                        'never again', 'complaint', 'manager', 'supervisor'
                    ],
                    matchAll: false
                },
                priority: 20
            }
        ],
        
        requirements: [
            {
                type: 'acknowledge',
                config: {
                    acknowledgment: 'I sincerely apologize for any frustration. Let me make sure we get this resolved for you.',
                    onlyOnce: true
                },
                order: 1
            },
            {
                type: 'set_flag',
                config: {
                    flagName: 'customerFrustrated',
                    flagValue: true
                },
                order: 2
            }
        ],
        
        actions: [
            {
                timing: 'on_activate',
                type: 'set_flag',
                config: {
                    flagName: 'deescalationMode',
                    flagValue: true
                }
            }
        ],
        
        settings: {
            allowConcurrent: true,
            persistent: true,
            reactivatable: false,
            minConfidence: 0.75,
            enableTrace: true
        },
        
        metadata: {
            version: 1,
            tags: ['customer-service', 'de-escalation', 'emotion']
        }
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // HOURS/AVAILABILITY FLOW
    // ─────────────────────────────────────────────────────────────────────────
    {
        name: 'Hours & Availability',
        description: 'Handles questions about business hours and availability.',
        flowKey: 'hours_availability',
        isTemplate: true,
        enabled: true,
        priority: 25,
        tradeType: null,
        
        triggers: [
            {
                type: 'keyword',
                config: {
                    keywords: ['hours', 'open', 'available', 'weekend', 'sunday', 'saturday', 'evening', 'morning'],
                    matchAll: false
                },
                priority: 10
            }
        ],
        
        requirements: [
            {
                type: 'response_rule',
                config: {
                    rule: 'use_hours_response',
                    ruleConfig: {
                        lookupCheatSheet: true,
                        fallbackMessage: 'We have flexible scheduling available. Would you like me to check our availability for a specific day?'
                    }
                },
                order: 1
            }
        ],
        
        actions: [
            {
                timing: 'on_activate',
                type: 'set_flag',
                config: {
                    flagName: 'hoursInquiry',
                    flagValue: true
                }
            }
        ],
        
        settings: {
            allowConcurrent: true,
            persistent: false,
            reactivatable: true,
            minConfidence: 0.7,
            enableTrace: true
        },
        
        metadata: {
            version: 1,
            tags: ['hours', 'availability', 'faq']
        }
    }
];

// ============================================================================
// SEED TEMPLATES ENDPOINT
// ============================================================================
// POST /api/admin/dynamic-flows/seed-templates

router.post('/seed-templates', async (req, res) => {
    try {
        logger.info('[DYNAMIC FLOW ADMIN] 🌱 Seeding templates...');
        
        const results = {
            created: [],
            updated: [],
            errors: []
        };
        
        for (const template of TEMPLATES) {
            try {
                const existing = await DynamicFlow.findOne({
                    flowKey: template.flowKey,
                    isTemplate: true
                });
                
                if (existing) {
                    // Update existing
                    await DynamicFlow.updateOne(
                        { _id: existing._id },
                        { 
                            ...template,
                            $inc: { 'metadata.version': 1 }
                        }
                    );
                    results.updated.push(template.flowKey);
                    logger.info(`[DYNAMIC FLOW ADMIN] Updated: ${template.flowKey}`);
                } else {
                    // Create new
                    await DynamicFlow.create(template);
                    results.created.push(template.flowKey);
                    logger.info(`[DYNAMIC FLOW ADMIN] Created: ${template.flowKey}`);
                }
            } catch (templateErr) {
                results.errors.push({
                    flowKey: template.flowKey,
                    error: templateErr.message
                });
                logger.error(`[DYNAMIC FLOW ADMIN] Error with ${template.flowKey}:`, templateErr.message);
            }
        }
        
        logger.info('[DYNAMIC FLOW ADMIN] ✅ Seeding complete', results);
        
        res.json({
            success: true,
            message: 'Templates seeded successfully',
            results
        });
        
    } catch (error) {
        logger.error('[DYNAMIC FLOW ADMIN] Seed failed:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// LIST ALL TEMPLATES
// ============================================================================
// GET /api/admin/dynamic-flows/templates

router.get('/templates', async (req, res) => {
    try {
        const templates = await DynamicFlow.find({ isTemplate: true })
            .sort({ priority: -1 })
            .lean();
        
        res.json({
            success: true,
            templates,
            total: templates.length
        });
        
    } catch (error) {
        logger.error('[DYNAMIC FLOW ADMIN] List templates failed:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// DELETE TEMPLATE (Admin only)
// ============================================================================
// DELETE /api/admin/dynamic-flows/templates/:templateId

router.delete('/templates/:templateId', async (req, res) => {
    try {
        const { templateId } = req.params;
        
        const template = await DynamicFlow.findOneAndDelete({
            _id: templateId,
            isTemplate: true
        });
        
        if (!template) {
            return res.status(404).json({
                success: false,
                error: 'Template not found'
            });
        }
        
        logger.info('[DYNAMIC FLOW ADMIN] Template deleted:', template.flowKey);
        
        res.json({
            success: true,
            deleted: template.flowKey
        });
        
    } catch (error) {
        logger.error('[DYNAMIC FLOW ADMIN] Delete template failed:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;

