/**
 * ============================================================================
 * CLEANUP & SEED DYNAMIC FLOW TEMPLATES
 * ============================================================================
 * 
 * This script:
 * 1. DELETES all duplicate/legacy templates
 * 2. UPSERTS only the canonical templates
 * 3. Enforces: enabled=false when triggers.length === 0
 * 
 * Run: node scripts/cleanup-and-seed-templates.js
 * 
 * ============================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');

// ════════════════════════════════════════════════════════════════════════════
// CANONICAL TEMPLATE KEYS - These are the ONLY templates that should exist
// ════════════════════════════════════════════════════════════════════════════
const CANONICAL_KEYS = [
    'emergency_service',
    'returning_customer', 
    'booking_intent',
    'pricing_inquiry',
    'hours_availability',
    'frustrated_customer',
    'after_hours_routing',
    'technician_request'
];

// Legacy keys to DELETE (duplicates of canonical keys)
const LEGACY_KEYS_TO_DELETE = [
    'emergency_detection',  // duplicate of emergency_service
];

// ════════════════════════════════════════════════════════════════════════════
// CANONICAL TEMPLATES - Single source of truth
// ════════════════════════════════════════════════════════════════════════════
const CANONICAL_TEMPLATES = [
    {
        flowKey: 'emergency_service',
        name: 'Emergency Service Detection',
        description: 'Detects emergency situations (no heat, no AC, gas leak, flooding) and fast-tracks to booking.',
        isTemplate: true,
        enabled: true,
        priority: 200,
        triggers: [{
            type: 'phrase',
            config: {
                phrases: [
                    'emergency', 'urgent', 'asap', 'right now', 'immediately',
                    'no heat', 'no ac', 'no air', 'not cooling', 'not heating',
                    'gas leak', 'gas smell', 'flooding', 'flooded', 'water everywhere',
                    'smoke', 'burning smell', 'sparking', 'on fire',
                    'freezing', 'pipes burst', 'pipe burst'
                ],
                fuzzy: true
            }
        }],
        actions: [
            { timing: 'on_activate', type: 'set_flag', config: { flagName: 'isEmergency', flagValue: true } },
            { timing: 'on_activate', type: 'ack_once', config: { key: 'ack_emergency', text: "I understand this is urgent. Let me get you scheduled right away." } },
            { timing: 'on_activate', type: 'transition_mode', config: { mode: 'BOOKING' } }
        ],
        settings: { allowConcurrent: false },
        metadata: { version: 1, tags: ['emergency', 'fast-path'] }
    },
    {
        flowKey: 'returning_customer',
        name: 'Returning Customer Recognition',
        description: 'Detects and acknowledges returning customers.',
        isTemplate: true,
        enabled: true,
        priority: 100,
        triggers: [{
            type: 'phrase',
            config: {
                phrases: [
                    'returning customer', 'been here before', 'came here last',
                    'used you guys before', 'you came out before', 'you fixed my',
                    'last time you', 'remember me', 'i called before', 'we spoke before',
                    'existing customer', 'already a customer'
                ],
                fuzzy: true
            }
        }],
        actions: [
            { timing: 'on_activate', type: 'set_flag', config: { flagName: 'isReturningCustomer', flagValue: true } },
            { timing: 'on_activate', type: 'ack_once', config: { key: 'ack_returning', text: "Welcome back! We appreciate your continued trust." } }
        ],
        settings: { allowConcurrent: true },
        metadata: { version: 1, tags: ['customer-recognition'] }
    },
    {
        flowKey: 'booking_intent',
        name: 'Standard Booking Intent',
        description: 'Detects when caller wants to schedule service.',
        isTemplate: true,
        enabled: true,
        priority: 50,
        triggers: [{
            type: 'phrase',
            config: {
                phrases: [
                    'schedule an appointment', 'book an appointment', 'set up a visit',
                    'need someone to come out', 'want to schedule', 'can you send someone',
                    'need service', 'lets book it', 'yes please schedule',
                    'sounds good', 'lets do it', 'book it'
                ],
                fuzzy: true
            }
        }],
        actions: [
            { timing: 'on_activate', type: 'transition_mode', config: { mode: 'BOOKING' } }
        ],
        settings: { allowConcurrent: false },
        metadata: { version: 1, tags: ['booking'] }
    },
    {
        flowKey: 'pricing_inquiry',
        name: 'Pricing Inquiry',
        description: 'Handles questions about pricing and costs.',
        isTemplate: true,
        enabled: true,
        priority: 30,
        triggers: [{
            type: 'phrase',
            config: {
                phrases: [
                    'how much', 'what does it cost', 'price', 'pricing',
                    'estimate', 'quote', 'ballpark', 'charge', 'fee', 'rate',
                    'what do you charge', 'can i get a quote'
                ],
                fuzzy: true
            }
        }],
        actions: [
            { timing: 'on_activate', type: 'set_flag', config: { flagName: 'pricingInquiry', flagValue: true } },
            { timing: 'on_activate', type: 'ack_once', config: { key: 'ack_pricing', text: "Pricing varies based on the specific service. Would you like me to schedule a free estimate?" } }
        ],
        settings: { allowConcurrent: true },
        metadata: { version: 1, tags: ['pricing', 'faq'] }
    },
    {
        flowKey: 'hours_availability',
        name: 'Hours & Availability',
        description: 'Handles questions about business hours.',
        isTemplate: true,
        enabled: true,
        priority: 25,
        triggers: [{
            type: 'phrase',
            config: {
                phrases: [
                    'what are your hours', 'when are you open', 'do you work weekends',
                    'are you available', 'what time do you', 'hours of operation',
                    'open on saturday', 'open on sunday', 'evening hours'
                ],
                fuzzy: true
            }
        }],
        actions: [
            { timing: 'on_activate', type: 'set_flag', config: { flagName: 'hoursInquiry', flagValue: true } },
            { timing: 'on_activate', type: 'ack_once', config: { key: 'ack_hours', text: "We have flexible scheduling. Would you like me to check availability for a specific day?" } }
        ],
        settings: { allowConcurrent: true },
        metadata: { version: 1, tags: ['hours', 'faq'] }
    },
    {
        flowKey: 'frustrated_customer',
        name: 'Frustrated Customer Handler',
        description: 'Detects frustration and applies de-escalation.',
        isTemplate: true,
        enabled: true,
        priority: 150,
        triggers: [{
            type: 'phrase',
            config: {
                phrases: [
                    'frustrated', 'annoyed', 'angry', 'upset', 'ridiculous',
                    'unacceptable', 'terrible', 'horrible', 'worst',
                    'never again', 'complaint', 'manager', 'supervisor',
                    'this is ridiculous', 'waste of time', 'talk to a human', 'real person'
                ],
                fuzzy: true
            }
        }],
        actions: [
            { timing: 'on_activate', type: 'set_flag', config: { flagName: 'customerFrustrated', flagValue: true } },
            { timing: 'on_activate', type: 'ack_once', config: { key: 'ack_frustrated', text: "I sincerely apologize for any frustration. Let me make sure we get this resolved for you." } }
        ],
        settings: { allowConcurrent: true },
        metadata: { version: 1, tags: ['de-escalation', 'emotion'] }
    },
    {
        flowKey: 'after_hours_routing',
        name: 'After Hours Detection',
        description: 'Detects calls outside business hours.',
        isTemplate: true,
        enabled: true,
        priority: 90,
        triggers: [{
            type: 'after_hours',
            config: { useCompanyHours: true }
        }],
        actions: [
            { timing: 'on_activate', type: 'set_flag', config: { flagName: 'afterHours', flagValue: true } },
            { timing: 'on_activate', type: 'ack_once', config: { key: 'ack_after_hours', text: "You've reached us after hours. I can take a message, or if this is an emergency, tell me what's going on." } }
        ],
        settings: { allowConcurrent: true },
        metadata: { version: 1, tags: ['after-hours'] }
    },
    {
        flowKey: 'technician_request',
        name: 'Technician Request Detection',
        description: 'Detects when caller requests a specific technician.',
        isTemplate: true,
        enabled: true,
        priority: 80,
        triggers: [{
            type: 'phrase',
            config: {
                phrases: [
                    'same technician', 'same tech', 'request a technician',
                    'specific technician', 'the guy who came', 'the one who fixed',
                    'want the same person', 'can i get the same', 'send the same'
                ],
                fuzzy: true
            }
        }],
        actions: [
            { timing: 'on_activate', type: 'set_flag', config: { flagName: 'requestedSpecificTech', flagValue: true } },
            { timing: 'on_activate', type: 'ack_once', config: { key: 'ack_tech_request', text: "I'll note that you'd like the same technician. Do you remember their name?" } }
        ],
        settings: { allowConcurrent: false },
        metadata: { version: 1, tags: ['technician-request'] }
    }
];

// ════════════════════════════════════════════════════════════════════════════
// MAIN FUNCTION
// ════════════════════════════════════════════════════════════════════════════
async function cleanupAndSeed() {
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('   CLEANUP & SEED DYNAMIC FLOW TEMPLATES');
    console.log('═══════════════════════════════════════════════════════════════════');
    
    try {
        const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
        if (!mongoUri) throw new Error('MONGODB_URI not configured');
        
        console.log('\n📡 Connecting to MongoDB...');
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB');
        
        const db = mongoose.connection.db;
        const collection = db.collection('dynamic_flows');
        
        // ════════════════════════════════════════════════════════════════════
        // STEP 1: Delete legacy/duplicate templates
        // ════════════════════════════════════════════════════════════════════
        console.log('\n🗑️  STEP 1: Deleting legacy duplicates...\n');
        
        for (const legacyKey of LEGACY_KEYS_TO_DELETE) {
            const result = await collection.deleteMany({ 
                flowKey: legacyKey, 
                isTemplate: true 
            });
            if (result.deletedCount > 0) {
                console.log(`   ❌ Deleted: ${legacyKey} (${result.deletedCount} docs)`);
            }
        }
        
        // Also delete any templates NOT in canonical list
        const nonCanonical = await collection.find({ 
            isTemplate: true,
            flowKey: { $nin: CANONICAL_KEYS }
        }).toArray();
        
        if (nonCanonical.length > 0) {
            console.log(`\n   ⚠️  Found ${nonCanonical.length} non-canonical templates:`);
            for (const doc of nonCanonical) {
                console.log(`      - ${doc.flowKey}: ${doc.name}`);
            }
            
            const deleteResult = await collection.deleteMany({
                isTemplate: true,
                flowKey: { $nin: CANONICAL_KEYS }
            });
            console.log(`   ❌ Deleted ${deleteResult.deletedCount} non-canonical templates`);
        }
        
        // ════════════════════════════════════════════════════════════════════
        // STEP 2: Upsert canonical templates
        // ════════════════════════════════════════════════════════════════════
        console.log('\n📝 STEP 2: Upserting canonical templates...\n');
        
        let created = 0;
        let updated = 0;
        
        for (const template of CANONICAL_TEMPLATES) {
            // HARD RULE: If no triggers, force enabled=false
            const triggers = template.triggers || [];
            if (triggers.length === 0) {
                template.enabled = false;
                console.log(`   ⚠️  ${template.flowKey}: No triggers, forcing enabled=false`);
            }
            
            const result = await collection.updateOne(
                { flowKey: template.flowKey, isTemplate: true },
                { 
                    $set: {
                        ...template,
                        updatedAt: new Date()
                    },
                    $setOnInsert: {
                        createdAt: new Date()
                    }
                },
                { upsert: true }
            );
            
            if (result.upsertedCount > 0) {
                console.log(`   ✅ Created: ${template.name} (${template.flowKey})`);
                created++;
            } else if (result.modifiedCount > 0) {
                console.log(`   📝 Updated: ${template.name} (${template.flowKey})`);
                updated++;
            } else {
                console.log(`   ⏭️  Unchanged: ${template.name} (${template.flowKey})`);
            }
        }
        
        // ════════════════════════════════════════════════════════════════════
        // STEP 3: Verify final state
        // ════════════════════════════════════════════════════════════════════
        console.log('\n═══════════════════════════════════════════════════════════════════');
        console.log(`   SUMMARY: ${created} created, ${updated} updated`);
        console.log('═══════════════════════════════════════════════════════════════════');
        
        const allTemplates = await collection.find({ isTemplate: true })
            .project({ flowKey: 1, name: 1, priority: 1, enabled: 1, triggers: 1 })
            .sort({ priority: -1 })
            .toArray();
        
        console.log(`\n📋 Final Template Registry (${allTemplates.length} templates):\n`);
        
        for (const t of allTemplates) {
            const triggerCount = (t.triggers || []).length;
            const status = t.enabled ? '✅' : '❌';
            const triggerStatus = triggerCount > 0 ? `${triggerCount} triggers` : '⚠️ 0 TRIGGERS';
            console.log(`   ${status} ${t.flowKey.padEnd(22)} P:${String(t.priority).padStart(3)} ${triggerStatus}`);
        }
        
        // Check for any remaining issues
        const invalid = allTemplates.filter(t => t.enabled && (t.triggers || []).length === 0);
        if (invalid.length > 0) {
            console.log('\n🚨 WARNING: Found enabled templates with 0 triggers:');
            invalid.forEach(t => console.log(`   - ${t.flowKey}`));
        } else {
            console.log('\n✅ All templates valid (no enabled+0-trigger violations)');
        }
        
        // Check for duplicates
        const keyCount = {};
        allTemplates.forEach(t => {
            keyCount[t.flowKey] = (keyCount[t.flowKey] || 0) + 1;
        });
        const dupes = Object.entries(keyCount).filter(([k, v]) => v > 1);
        if (dupes.length > 0) {
            console.log('\n🚨 WARNING: Duplicate flowKeys found:');
            dupes.forEach(([k, v]) => console.log(`   - ${k}: ${v} copies`));
        } else {
            console.log('✅ No duplicate flowKeys');
        }
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('\n📡 Disconnected from MongoDB');
    }
}

// Run
cleanupAndSeed().then(() => {
    console.log('\n✅ Cleanup & seed complete!');
    process.exit(0);
});

