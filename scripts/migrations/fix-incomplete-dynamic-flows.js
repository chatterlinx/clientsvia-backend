/**
 * ============================================================================
 * FIX INCOMPLETE DYNAMIC FLOWS
 * ============================================================================
 * 
 * Problem: Two enabled flows are missing required V1 actions:
 * - after_hours_routing: missing append_ledger, transition_mode
 * - technician_request: missing append_ledger, transition_mode
 * 
 * This causes Wiring to penalize 10 points each = 80% score
 * 
 * Usage:
 *   node scripts/migrations/fix-incomplete-dynamic-flows.js [companyId]
 * 
 * If no companyId provided, shows all affected companies.
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
require('dotenv').config();

const COMPANY_ID = process.argv[2];

async function main() {
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('FIX INCOMPLETE DYNAMIC FLOWS');
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    const DynamicFlow = require('../../models/DynamicFlow');
    
    // Define the fix patches for each flowKey
    const FLOW_FIXES = {
        'after_hours_routing': {
            appendLedger: {
                timing: 'on_activate',
                type: 'append_ledger',
                config: {
                    type: 'EVENT',
                    key: 'AFTER_HOURS_DETECTED',
                    note: 'Call received outside business hours. Routing to after-hours handling.'
                },
                description: 'Log after-hours detection to call ledger'
            },
            transitionMode: {
                timing: 'on_activate',
                type: 'transition_mode',
                config: {
                    targetMode: 'BOOKING',  // Continue to booking (can collect info for callback)
                    setBookingLocked: false  // Don't lock - allow flexibility
                },
                description: 'Transition to booking for after-hours message capture'
            }
        },
        'technician_request': {
            appendLedger: {
                timing: 'on_activate',
                type: 'append_ledger',
                config: {
                    type: 'CLAIM',
                    key: 'TECHNICIAN_REQUESTED',
                    note: 'Caller requested a specific technician. Flag set for dispatch.'
                },
                description: 'Log technician request to call ledger'
            },
            transitionMode: {
                timing: 'on_activate',
                type: 'transition_mode',
                config: {
                    targetMode: 'BOOKING',
                    setBookingLocked: true
                },
                description: 'Transition to booking to capture technician preference'
            }
        }
    };
    
    // Build query
    const query = {
        flowKey: { $in: ['after_hours_routing', 'technician_request'] },
        enabled: true,
        isTemplate: false
    };
    
    if (COMPANY_ID) {
        query.companyId = new mongoose.Types.ObjectId(COMPANY_ID);
    }
    
    const flows = await DynamicFlow.find(query).lean();
    
    console.log(`Found ${flows.length} flow(s) to check\n`);
    
    if (flows.length === 0) {
        console.log('No matching flows found.');
        console.log('\nTo find all companies with these flows:');
        console.log('  node scripts/migrations/fix-incomplete-dynamic-flows.js');
        await mongoose.disconnect();
        return;
    }
    
    // Process each flow
    for (const flow of flows) {
        console.log(`\n─────────────────────────────────────────────────────────────────────────────`);
        console.log(`📋 Flow: ${flow.name} (${flow.flowKey})`);
        console.log(`   Company: ${flow.companyId}`);
        console.log(`   Current actions: ${flow.actions?.map(a => a.type).join(', ') || 'none'}`);
        
        const actionTypes = (flow.actions || []).map(a => a.type);
        const hasAppendLedger = actionTypes.includes('append_ledger');
        const hasTransitionMode = actionTypes.includes('transition_mode');
        
        if (hasAppendLedger && hasTransitionMode) {
            console.log(`   ✅ Already complete - skipping`);
            continue;
        }
        
        // Get fix config for this flowKey
        const fix = FLOW_FIXES[flow.flowKey];
        if (!fix) {
            console.log(`   ⚠️ No fix defined for flowKey: ${flow.flowKey}`);
            continue;
        }
        
        // Build actions to add
        const actionsToAdd = [];
        
        if (!hasAppendLedger) {
            console.log(`   ➕ Adding: append_ledger (${fix.appendLedger.config.key})`);
            actionsToAdd.push(fix.appendLedger);
        }
        
        if (!hasTransitionMode) {
            console.log(`   ➕ Adding: transition_mode (${fix.transitionMode.config.targetMode})`);
            actionsToAdd.push(fix.transitionMode);
        }
        
        // Apply the fix
        const updatedActions = [...(flow.actions || []), ...actionsToAdd];
        
        await DynamicFlow.updateOne(
            { _id: flow._id },
            { 
                $set: { 
                    actions: updatedActions,
                    'metadata.lastModifiedAt': new Date(),
                    'metadata.lastModifiedNote': 'Auto-fixed by fix-incomplete-dynamic-flows.js'
                }
            }
        );
        
        console.log(`   ✅ Fixed! Now has ${updatedActions.length} actions: ${updatedActions.map(a => a.type).join(', ')}`);
    }
    
    console.log('\n═══════════════════════════════════════════════════════════════════════════════');
    console.log('DONE');
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('\nNext steps:');
    console.log('1. Clear Redis cache: node scripts/clear-scenario-cache.js');
    console.log('2. Re-run Wiring check in Control Plane');
    console.log('3. Score should go from 80% → 100% (GREEN)');
    
    await mongoose.disconnect();
}

main().catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
});

