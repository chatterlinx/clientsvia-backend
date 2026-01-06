/**
 * ============================================================================
 * SEED DYNAMIC FLOW TEMPLATES
 * ============================================================================
 * 
 * Creates global templates for common conversation flows.
 * These are read-only and can be copied to company-specific flows.
 * 
 * Run: node scripts/seed-dynamic-flow-templates.js
 * 
 * ============================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');
const DynamicFlow = require('../models/DynamicFlow');

// ════════════════════════════════════════════════════════════════════════════
// TEMPLATE DEFINITIONS
// ════════════════════════════════════════════════════════════════════════════

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
        tradeType: null,  // Universal
        
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
            },
            {
                type: 'keyword',
                config: {
                    keywords: ['returning', 'again', 'back'],
                    matchAll: false
                },
                priority: 5,
                description: 'Detect returning keywords'
            }
        ],
        
        requirements: [
            {
                type: 'acknowledge',
                config: {
                    acknowledgment: 'Welcome back! We appreciate your continued trust.',
                    onlyOnce: true
                },
                order: 1,
                description: 'Acknowledge returning customer'
            },
            {
                type: 'set_flag',
                config: {
                    flagName: 'isReturningCustomer',
                    flagValue: true
                },
                order: 2,
                description: 'Mark as returning customer'
            },
            {
                type: 'set_fact',
                config: {
                    factKey: 'customerType',
                    factValue: 'returning'
                },
                order: 3,
                description: 'Store customer type fact'
            }
        ],
        
        actions: [
            {
                timing: 'on_activate',
                type: 'set_flag',
                config: {
                    flagName: 'returningCustomerDetected',
                    flagValue: true
                },
                description: 'Set detection flag'
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
        priority: 200,  // High priority
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
                priority: 20,
                description: 'Emergency keywords'
            },
            {
                type: 'phrase',
                config: {
                    phrases: [
                        'need someone now',
                        'come out immediately',
                        'this is an emergency',
                        'cant wait',
                        'dangerous situation'
                    ],
                    fuzzy: true
                },
                priority: 15,
                description: 'Emergency phrases'
            }
        ],
        
        requirements: [
            {
                type: 'acknowledge',
                config: {
                    acknowledgment: 'I understand this is urgent. Let me get you scheduled right away.',
                    onlyOnce: true
                },
                order: 1,
                description: 'Acknowledge urgency'
            },
            {
                type: 'set_flag',
                config: {
                    flagName: 'isEmergency',
                    flagValue: true
                },
                order: 2,
                description: 'Mark as emergency'
            }
        ],
        
        actions: [
            {
                timing: 'on_activate',
                type: 'transition_mode',
                config: {
                    targetMode: 'BOOKING'
                },
                description: 'Fast-track to booking'
            },
            {
                timing: 'on_activate',
                type: 'set_flag',
                config: {
                    flagName: 'priorityLevel',
                    flagValue: 'emergency'
                },
                description: 'Set priority level'
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
        tradeType: null,  // Universal
        
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
                priority: 10,
                description: 'Booking intent phrases'
            },
            {
                type: 'keyword',
                config: {
                    keywords: ['schedule', 'book', 'appointment', 'visit', 'service call'],
                    matchAll: false
                },
                priority: 5,
                description: 'Booking keywords'
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
                order: 1,
                description: 'Collect customer name'
            },
            {
                type: 'collect_slot',
                config: {
                    slotId: 'phone',
                    required: true
                },
                order: 2,
                description: 'Collect phone number'
            },
            {
                type: 'collect_slot',
                config: {
                    slotId: 'address',
                    required: true
                },
                order: 3,
                description: 'Collect service address'
            }
        ],
        
        actions: [
            {
                timing: 'on_activate',
                type: 'transition_mode',
                config: {
                    targetMode: 'BOOKING'
                },
                description: 'Enter booking mode'
            },
            {
                timing: 'on_complete',
                type: 'transition_mode',
                config: {
                    targetMode: 'COMPLETE'
                },
                description: 'Complete call'
            },
            {
                timing: 'on_complete',
                type: 'create_record',
                config: {
                    recordType: 'booking'
                },
                description: 'Create booking record'
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
                priority: 10,
                description: 'Pricing keywords'
            },
            {
                type: 'phrase',
                config: {
                    phrases: [
                        'what do you charge',
                        'how much does it cost',
                        'whats the price',
                        'can i get a quote',
                        'ballpark estimate'
                    ],
                    fuzzy: true
                },
                priority: 8,
                description: 'Pricing phrases'
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
                order: 1,
                description: 'Apply pricing response rule'
            }
        ],
        
        actions: [
            {
                timing: 'on_activate',
                type: 'set_flag',
                config: {
                    flagName: 'pricingInquiry',
                    flagValue: true
                },
                description: 'Mark pricing inquiry'
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
                priority: 10,
                description: 'Hours keywords'
            },
            {
                type: 'phrase',
                config: {
                    phrases: [
                        'what are your hours',
                        'when are you open',
                        'do you work weekends',
                        'are you available',
                        'what time do you'
                    ],
                    fuzzy: true
                },
                priority: 8,
                description: 'Hours phrases'
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
                order: 1,
                description: 'Apply hours response rule'
            }
        ],
        
        actions: [
            {
                timing: 'on_activate',
                type: 'set_flag',
                config: {
                    flagName: 'hoursInquiry',
                    flagValue: true
                },
                description: 'Mark hours inquiry'
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
        priority: 150,  // High priority
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
                priority: 20,
                description: 'Frustration keywords'
            },
            {
                type: 'phrase',
                config: {
                    phrases: [
                        'this is ridiculous',
                        'i cant believe',
                        'waste of time',
                        'not helpful',
                        'speak to someone else',
                        'talk to a human',
                        'real person'
                    ],
                    fuzzy: true
                },
                priority: 15,
                description: 'Frustration phrases'
            }
        ],
        
        requirements: [
            {
                type: 'acknowledge',
                config: {
                    acknowledgment: 'I sincerely apologize for any frustration. Let me make sure we get this resolved for you.',
                    onlyOnce: true
                },
                order: 1,
                description: 'Apologize and de-escalate'
            },
            {
                type: 'set_flag',
                config: {
                    flagName: 'customerFrustrated',
                    flagValue: true
                },
                order: 2,
                description: 'Mark frustration flag'
            }
        ],
        
        actions: [
            {
                timing: 'on_activate',
                type: 'set_flag',
                config: {
                    flagName: 'deescalationMode',
                    flagValue: true
                },
                description: 'Enable de-escalation mode'
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
    }
];

// ════════════════════════════════════════════════════════════════════════════
// MAIN SEEDING FUNCTION
// ════════════════════════════════════════════════════════════════════════════

async function seedTemplates() {
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('   DYNAMIC FLOW TEMPLATE SEEDER');
    console.log('═══════════════════════════════════════════════════════════════════');
    
    try {
        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
        if (!mongoUri) {
            throw new Error('MONGODB_URI not configured');
        }
        
        console.log('\n📡 Connecting to MongoDB...');
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB');
        
        // Seed each template
        console.log('\n📝 Seeding templates...\n');
        
        let created = 0;
        let updated = 0;
        let skipped = 0;
        
        for (const template of TEMPLATES) {
            const existing = await DynamicFlow.findOne({
                flowKey: template.flowKey,
                isTemplate: true
            });
            
            if (existing) {
                // Update existing template - use $set to avoid conflict with $inc
                const updateDoc = { ...template };
                delete updateDoc.metadata; // Remove metadata from $set to avoid conflict
                
                await DynamicFlow.updateOne(
                    { _id: existing._id },
                    { 
                        $set: updateDoc,
                        $inc: { 'metadata.version': 1 }
                    }
                );
                console.log(`   📝 Updated: ${template.name} (${template.flowKey})`);
                updated++;
            } else {
                // Create new template
                await DynamicFlow.create(template);
                console.log(`   ✅ Created: ${template.name} (${template.flowKey})`);
                created++;
            }
        }
        
        console.log('\n═══════════════════════════════════════════════════════════════════');
        console.log(`   SUMMARY: ${created} created, ${updated} updated, ${skipped} skipped`);
        console.log('═══════════════════════════════════════════════════════════════════');
        
        // List all templates
        const allTemplates = await DynamicFlow.find({ isTemplate: true }).select('flowKey name priority enabled');
        console.log('\n📋 All Templates:');
        for (const t of allTemplates) {
            const status = t.enabled ? '✅' : '❌';
            console.log(`   ${status} ${t.flowKey} (priority: ${t.priority}) - ${t.name}`);
        }
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('\n📡 Disconnected from MongoDB');
    }
}

// Run if called directly
if (require.main === module) {
    seedTemplates().then(() => {
        console.log('\n✅ Seeding complete!');
        process.exit(0);
    });
}

module.exports = { seedTemplates, TEMPLATES };

