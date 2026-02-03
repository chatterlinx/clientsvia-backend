/**
 * ============================================================================
 * MIGRATION: Add Discovery Clarification Dynamic Flow
 * ============================================================================
 * 
 * V92: Adds the "Discovery Clarification" flow as a global template and
 * copies it to all HVAC companies.
 * 
 * This flow detects vague issues ("not working", "problems") and asks
 * clarifying questions ("Is it not cooling, not heating, or something else?")
 * BEFORE offering to schedule a technician.
 * 
 * Usage:
 *   node scripts/migrations/add-discovery-clarification-flow.js
 * 
 * ============================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');
const DynamicFlow = require('../../models/DynamicFlow');

const FLOW_KEY = 'discovery_clarification';

// ════════════════════════════════════════════════════════════════════════════
// DISCOVERY CLARIFICATION TEMPLATE
// ════════════════════════════════════════════════════════════════════════════
const DISCOVERY_CLARIFICATION_TEMPLATE = {
    name: 'Discovery Clarification',
    description: 'Asks clarifying questions when caller describes a vague issue (e.g., "AC problems" → "Is it not cooling, not heating, or something else?"). Prevents rushing to booking without understanding the problem.',
    flowKey: FLOW_KEY,
    companyId: null,  // Global template
    templateId: null,
    tradeType: 'hvac',
    enabled: true,
    isTemplate: true,
    priority: 50,  // High priority - run before booking intent
    
    triggers: [
        {
            type: 'keyword',
            config: {
                keywords: [
                    'not working',
                    'problems',
                    'issues',
                    'something wrong',
                    'acting up',
                    'broken',
                    'wont turn on',
                    'keeps shutting off',
                    'stops working',
                    'having trouble',
                    'giving me problems',
                    'not right'
                ],
                matchAll: false  // OR - any keyword triggers
            },
            priority: 50,
            description: 'Vague issue patterns that need clarification'
        }
    ],
    
    requirements: [
        {
            type: 'set_flag',
            config: {
                flagName: 'needsClarification',
                flagValue: true
            },
            order: 1,
            description: 'Mark that we need to ask a clarifying question'
        }
    ],
    
    actions: [
        {
            timing: 'on_activate',
            type: 'set_flag',
            config: {
                flagName: 'askedClarifyingQuestion',
                flagValue: false,
                alsoWriteToCallLedgerFacts: true
            },
            description: 'Track that clarification was triggered'
        },
        {
            timing: 'on_activate',
            type: 'append_ledger',
            config: {
                type: 'EVENT',
                key: 'DISCOVERY_CLARIFICATION_NEEDED',
                note: 'Vague issue detected - asking clarifying question'
            },
            description: 'Log clarification event'
        }
    ],
    
    settings: {
        allowConcurrent: true,
        conflictsWith: [],
        maxDurationSeconds: null,
        persistent: false,  // One-time check
        reactivatable: false,  // Only ask once per call
        minConfidence: 0.5,
        enableTrace: true
    },
    
    metadata: {
        version: 1,
        tags: ['v92', 'discovery', 'clarification', 'ux'],
        usageCount: 0
    }
};

async function run() {
    try {
        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
        if (!mongoUri) {
            console.error('❌ No MONGODB_URI found in environment');
            process.exit(1);
        }
        
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB');
        
        // Check if template already exists
        const existingTemplate = await DynamicFlow.findOne({
            flowKey: FLOW_KEY,
            isTemplate: true
        });
        
        if (existingTemplate) {
            console.log(`⚠️  Template "${FLOW_KEY}" already exists (ID: ${existingTemplate._id})`);
            console.log('   Updating existing template...');
            
            await DynamicFlow.updateOne(
                { _id: existingTemplate._id },
                { $set: DISCOVERY_CLARIFICATION_TEMPLATE }
            );
            
            console.log('✅ Template updated');
        } else {
            console.log(`📝 Creating template "${FLOW_KEY}"...`);
            const template = await DynamicFlow.create(DISCOVERY_CLARIFICATION_TEMPLATE);
            console.log(`✅ Template created (ID: ${template._id})`);
        }
        
        // Get count of HVAC companies that need this flow
        const v2Company = mongoose.connection.collection('v2companies');
        const hvacCompanies = await v2Company.find({
            $or: [
                { trade: 'hvac' },
                { tradeType: 'hvac' },
                { 'tradeCategory.key': 'hvac' }
            ]
        }).toArray();
        
        console.log(`\n📊 Found ${hvacCompanies.length} HVAC companies`);
        
        // Copy template to companies that don't have it
        let created = 0;
        let skipped = 0;
        
        for (const company of hvacCompanies) {
            const existingFlow = await DynamicFlow.findOne({
                flowKey: FLOW_KEY,
                companyId: company._id,
                isTemplate: false
            });
            
            if (existingFlow) {
                skipped++;
                continue;
            }
            
            // Create company copy
            const template = await DynamicFlow.findOne({
                flowKey: FLOW_KEY,
                isTemplate: true
            });
            
            if (template) {
                await DynamicFlow.createFromTemplate(template._id, company._id, {
                    name: 'Discovery Clarification',
                    description: 'Asks clarifying questions for vague issues before scheduling'
                });
                created++;
                console.log(`   ✅ Added to ${company.companyName || company._id}`);
            }
        }
        
        console.log(`\n📈 Summary:`);
        console.log(`   Created: ${created} company flows`);
        console.log(`   Skipped: ${skipped} (already exist)`);
        
        console.log('\n✅ Migration complete!');
        
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        console.error(error.stack);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Disconnected from MongoDB');
    }
}

// Run if called directly
if (require.main === module) {
    run();
}

module.exports = { DISCOVERY_CLARIFICATION_TEMPLATE, run };
