/**
 * ============================================================================
 * FIX: CALLBACK vs "NOT SURE" SCENARIO MISMATCHING
 * ============================================================================
 * 
 * PROBLEM:
 * User said: "AC issues... you guys were here last week... his name was Dustin...
 *            I don't know if you can look up my records... come back out again...
 *            it's not working"
 * 
 * Agent incorrectly responded with: "That's totally fine — a lot of people call
 *            without knowing exactly what they need, and that's okay."
 * 
 * ROOT CAUSE:
 * The phrase "I don't know if you can look up" matched the trigger "I don't know"
 * from the "Caller Not Sure What They Need" scenario, even though the context
 * clearly indicates a CALLBACK/RETURN VISIT request.
 * 
 * FIX:
 * 1. Add negative triggers to "Caller Not Sure" to block when callback context present
 * 2. Add better triggers to "Follow-Up After Service" for common callback phrases
 * 3. Add negative triggers for phrases with "I don't know if" (context matters!)
 * 
 * ============================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
const logger = require('../utils/logger');

const TEMPLATE_ID = '68fb535130d19aec696d8123';

// Scenario IDs from the database
const CALLER_NOT_SURE_ID = 'scenario-1766497689882-06dn1hgrs';  // "Caller Not Sure What They Need"
const FOLLOW_UP_SERVICE_ID = 'scenario-1764756024959';  // "Follow-Up After Service" - need to find exact ID

// ============================================================================
// NEW NEGATIVE TRIGGERS for "Caller Not Sure What They Need"
// These will BLOCK this scenario when callback/return context is present
// ============================================================================
const NEW_NEGATIVE_TRIGGERS_FOR_NOT_SURE = [
    // Callback/return context
    'you guys were here',
    'was here last week',
    'come back out',
    'come back again',
    'return visit',
    'same technician',
    'same tech',
    'technician was here',
    'tech was here',
    'worked on it before',
    'look up my records',
    'look up my account',
    'check my records',
    'check my account',
    'follow up',
    'follow-up',
    'warranty issue',
    'still not working after',
    'same problem again',
    'problem came back',
    'issue came back',
    // Specific tech name requests
    'send the same',
    'request the same',
    'want the same'
];

// ============================================================================
// NEW TRIGGERS for "Follow-Up After Service" scenario
// These common phrases indicate a callback/return visit request
// ============================================================================
const NEW_TRIGGERS_FOR_FOLLOW_UP = [
    // Previous visit context
    'you guys were here',
    'you were here',
    'was here last week',
    'was here yesterday',
    'was here recently',
    'came out before',
    'came out last',
    'worked on it before',
    'fixed it before',
    'repaired it before',
    // Return request phrases
    'come back out',
    'come back again',
    'come back and check',
    'come back and look',
    'can you come back',
    'need someone back',
    'send someone back',
    // Tech-specific requests
    'same technician',
    'same tech',
    'the tech who came',
    'the guy who came',
    'request the same',
    // Record lookup
    'look up my records',
    'look up my account',
    'check my records',
    'pull up my file',
    // Problem persistence
    'still having the issue',
    'problem is back',
    'it broke again',
    'stopped working again',
    'not working again',
    'acting up again'
];

async function fixScenarios() {
    console.log('============================================================');
    console.log('FIX: Callback vs "Not Sure" Scenario Mismatching');
    console.log('============================================================\n');
    
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ MongoDB connected\n');
        
        const template = await GlobalInstantResponseTemplate.findById(TEMPLATE_ID);
        if (!template) {
            console.error('❌ Template not found:', TEMPLATE_ID);
            process.exit(1);
        }
        
        console.log(`📋 Template: ${template.version} - ${template.name}`);
        console.log(`   Categories: ${template.categories?.length || 0}\n`);
        
        let notSureScenario = null;
        let followUpScenario = null;
        let notSureCategory = null;
        let followUpCategory = null;
        
        // Find both scenarios
        for (const category of template.categories || []) {
            for (const scenario of category.scenarios || []) {
                if (scenario.scenarioId === CALLER_NOT_SURE_ID || 
                    scenario.name?.includes('Not Sure What They Need')) {
                    notSureScenario = scenario;
                    notSureCategory = category;
                    console.log(`✅ Found "Caller Not Sure" scenario in category: ${category.name}`);
                }
                
                if (scenario.name?.includes('Follow-Up After Service') ||
                    scenario.name?.includes('Follow Up After Service')) {
                    followUpScenario = scenario;
                    followUpCategory = category;
                    console.log(`✅ Found "Follow-Up After Service" scenario in category: ${category.name}`);
                }
            }
        }
        
        // ============================================================
        // FIX 1: Add negative triggers to "Caller Not Sure"
        // ============================================================
        if (notSureScenario) {
            console.log('\n🔧 FIX 1: Adding negative triggers to "Caller Not Sure"');
            console.log(`   Current negative triggers: ${notSureScenario.negativeTriggers?.length || 0}`);
            
            const existingNegatives = new Set((notSureScenario.negativeTriggers || []).map(t => t.toLowerCase()));
            let addedCount = 0;
            
            for (const newTrigger of NEW_NEGATIVE_TRIGGERS_FOR_NOT_SURE) {
                if (!existingNegatives.has(newTrigger.toLowerCase())) {
                    notSureScenario.negativeTriggers = notSureScenario.negativeTriggers || [];
                    notSureScenario.negativeTriggers.push(newTrigger);
                    addedCount++;
                    console.log(`   + Added: "${newTrigger}"`);
                }
            }
            
            console.log(`   ✅ Added ${addedCount} new negative triggers`);
        } else {
            console.log('\n⚠️ Could not find "Caller Not Sure" scenario');
        }
        
        // ============================================================
        // FIX 2: Add triggers to "Follow-Up After Service"
        // ============================================================
        if (followUpScenario) {
            console.log('\n🔧 FIX 2: Adding triggers to "Follow-Up After Service"');
            console.log(`   Current triggers: ${followUpScenario.triggers?.length || 0}`);
            
            const existingTriggers = new Set((followUpScenario.triggers || []).map(t => t.toLowerCase()));
            let addedCount = 0;
            
            for (const newTrigger of NEW_TRIGGERS_FOR_FOLLOW_UP) {
                if (!existingTriggers.has(newTrigger.toLowerCase())) {
                    followUpScenario.triggers = followUpScenario.triggers || [];
                    followUpScenario.triggers.push(newTrigger);
                    addedCount++;
                    console.log(`   + Added: "${newTrigger}"`);
                }
            }
            
            // Also increase priority so it wins over "Caller Not Sure"
            const oldPriority = followUpScenario.priority || 0;
            followUpScenario.priority = Math.max(oldPriority, 8);  // High priority
            console.log(`   📈 Priority: ${oldPriority} → ${followUpScenario.priority}`);
            
            console.log(`   ✅ Added ${addedCount} new triggers`);
        } else {
            console.log('\n⚠️ Could not find "Follow-Up After Service" scenario');
            console.log('   Creating a new scenario for callback requests...');
            
            // Find the appropriate category (Customer Service or Billing)
            const customerServiceCategory = template.categories?.find(c => 
                c.name?.toLowerCase().includes('customer') || 
                c.name?.toLowerCase().includes('billing')
            );
            
            if (customerServiceCategory) {
                const newScenario = {
                    scenarioId: `scenario-${Date.now()}-callback`,
                    name: 'Callback / Return Visit Request',
                    isActive: true,
                    status: 'live',
                    priority: 8,
                    triggers: NEW_TRIGGERS_FOR_FOLLOW_UP,
                    negativeTriggers: ['new customer', 'first time calling', 'never used before'],
                    quickReplies: [
                        "I see you've had service with us before. Let me look up your account.",
                        "I can definitely help with that. Let me pull up your records.",
                        "We stand behind our work — let me get this scheduled for you."
                    ],
                    fullReplies: [
                        "I'd be happy to help with a follow-up visit. Let me pull up your account and see when our technician was last there. If the issue is related to the previous repair, we'll absolutely take care of it. Can you give me the address or phone number on the account?",
                        "I understand you need us to come back out. We definitely want to make sure the job was done right. Let me look up your recent service history and we can get someone scheduled. What's the address?",
                        "No problem at all — if you've had service with us before and the issue came back, we'll get it resolved. Let me find your account and check on the previous work. What's your name or address?"
                    ],
                    actionHooks: ['lookup_history', 'flag_callback'],
                    handoffPolicy: 'low_confidence',
                    contextWeight: 0.8
                };
                
                customerServiceCategory.scenarios.push(newScenario);
                console.log(`   ✅ Created new "Callback / Return Visit Request" scenario`);
            }
        }
        
        // ============================================================
        // Save changes
        // ============================================================
        console.log('\n💾 Saving changes to database...');
        await template.save();
        console.log('✅ Template saved successfully!\n');
        
        console.log('============================================================');
        console.log('SUMMARY');
        console.log('============================================================');
        console.log(`✅ "Caller Not Sure" now has ${notSureScenario?.negativeTriggers?.length || 0} negative triggers`);
        console.log(`✅ "Follow-Up After Service" now has ${followUpScenario?.triggers?.length || 0} triggers`);
        console.log('\nThe agent should now correctly recognize callback/return visit requests');
        console.log('and NOT respond with "I don\'t know what you need" in those cases.\n');
        
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('MongoDB disconnected');
    }
}

fixScenarios();
