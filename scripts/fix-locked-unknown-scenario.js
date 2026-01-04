/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * FIX LOCKED UNKNOWN SCENARIO
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Purpose: Fix the specific locked scenario that has scenarioType=UNKNOWN
 * 
 * Target: scenario-1761397970305-0ejqojnvy ("Outdoor fan not spinning")
 * Fix: Set scenarioType = "TROUBLESHOOT" (fan diagnostic is troubleshooting)
 * 
 * Note: This keeps the autofillLock=true but fixes the UNKNOWN type
 *       so the scenario can actually route at runtime.
 * 
 * Usage:
 *   DRY_RUN=true node scripts/fix-locked-unknown-scenario.js   # Preview
 *   node scripts/fix-locked-unknown-scenario.js                 # Apply
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const mongoose = require('mongoose');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');

const DRY_RUN = process.env.DRY_RUN === 'true';

// TARGET: The specific scenario that needs fixing
const TARGET_SCENARIO_ID = 'scenario-1761397970305-0ejqojnvy';
const TARGET_SCENARIO_NAME = 'Outdoor fan not spinning';
const CORRECT_TYPE = 'TROUBLESHOOT'; // Fan not spinning is a diagnostic/troubleshoot scenario

async function main() {
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('  FIX LOCKED UNKNOWN SCENARIO');
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log(`  Mode: ${DRY_RUN ? '🔍 DRY RUN (preview only)' : '⚡ APPLY (writing changes)'}`);
    console.log(`  Target: ${TARGET_SCENARIO_ID}`);
    console.log(`  Name: ${TARGET_SCENARIO_NAME}`);
    console.log(`  Fix: scenarioType → ${CORRECT_TYPE}`);
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');
    
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        console.error('❌ MONGODB_URI not set');
        process.exit(1);
    }
    
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');
    
    try {
        // Find all templates and search for the scenario
        const templates = await GlobalInstantResponseTemplate.find({});
        console.log(`📋 Searching ${templates.length} templates...\n`);
        
        let found = false;
        let templateDoc = null;
        let categoryRef = null;
        let scenarioRef = null;
        
        for (const template of templates) {
            for (const category of (template.categories || [])) {
                for (const scenario of (category.scenarios || [])) {
                    const scenarioId = scenario.scenarioId || scenario._id?.toString();
                    const scenarioName = scenario.name || '';
                    
                    // Match by ID or name
                    if (scenarioId === TARGET_SCENARIO_ID || 
                        scenarioName.toLowerCase().includes('outdoor fan not spinning')) {
                        found = true;
                        templateDoc = template;
                        categoryRef = category;
                        scenarioRef = scenario;
                        
                        console.log('🎯 FOUND TARGET SCENARIO:');
                        console.log(`   Template: ${template.name} (${template._id})`);
                        console.log(`   Category: ${category.name}`);
                        console.log(`   Scenario: ${scenario.name}`);
                        console.log(`   ID: ${scenarioId}`);
                        console.log(`   Current scenarioType: ${scenario.scenarioType || 'null/undefined'}`);
                        console.log(`   autofillLock: ${scenario.autofillLock === true ? 'LOCKED' : 'unlocked'}`);
                        console.log(`   Triggers: ${(scenario.triggers || []).length}`);
                        console.log(`   Sample triggers: ${(scenario.triggers || []).slice(0, 5).join(', ')}`);
                        console.log('');
                        break;
                    }
                }
                if (found) break;
            }
            if (found) break;
        }
        
        if (!found) {
            console.log('❌ Target scenario NOT FOUND');
            console.log('   Searched for ID:', TARGET_SCENARIO_ID);
            console.log('   Or name containing: "outdoor fan not spinning"');
            
            // List all UNKNOWN scenarios as alternatives
            console.log('\n📋 All UNKNOWN scenarios found:');
            for (const template of templates) {
                for (const category of (template.categories || [])) {
                    for (const scenario of (category.scenarios || [])) {
                        if (!scenario.scenarioType || scenario.scenarioType === 'UNKNOWN') {
                            console.log(`   - ${scenario.name} (${scenario.scenarioId || scenario._id}) [${template.name}]`);
                        }
                    }
                }
            }
            return;
        }
        
        // Check current state
        const currentType = scenarioRef.scenarioType || 'UNKNOWN';
        const isAlreadyCorrect = currentType === CORRECT_TYPE;
        
        if (isAlreadyCorrect) {
            console.log(`✅ Scenario already has correct scenarioType: ${CORRECT_TYPE}`);
            console.log('   No changes needed!');
            return;
        }
        
        console.log('═══════════════════════════════════════════════════════════════════════════════');
        console.log('  PROPOSED CHANGE');
        console.log('═══════════════════════════════════════════════════════════════════════════════');
        console.log(`  Before: scenarioType = "${currentType}"`);
        console.log(`  After:  scenarioType = "${CORRECT_TYPE}"`);
        console.log(`  Lock:   Remains ${scenarioRef.autofillLock ? 'LOCKED' : 'unlocked'}`);
        console.log('═══════════════════════════════════════════════════════════════════════════════\n');
        
        if (DRY_RUN) {
            console.log('🔍 DRY RUN - No changes written');
            console.log('   Run without DRY_RUN=true to apply fix');
            return;
        }
        
        // Apply the fix
        console.log('⚡ APPLYING FIX...');
        
        // Find and update the scenario in the template document
        for (const category of (templateDoc.categories || [])) {
            for (const scenario of (category.scenarios || [])) {
                const scenarioId = scenario.scenarioId || scenario._id?.toString();
                if (scenarioId === (scenarioRef.scenarioId || scenarioRef._id?.toString()) ||
                    scenario.name === scenarioRef.name) {
                    
                    // Apply fix
                    scenario.scenarioType = CORRECT_TYPE;
                    scenario.updatedAt = new Date();
                    scenario.updatedBy = 'fix-locked-unknown-scenario';
                    
                    console.log(`   ✅ Set scenarioType = "${CORRECT_TYPE}"`);
                    break;
                }
            }
        }
        
        // Save template
        templateDoc.updatedAt = new Date();
        templateDoc.lastUpdatedBy = 'fix-locked-unknown-scenario';
        await templateDoc.save();
        
        console.log(`   💾 Saved template: ${templateDoc.name}`);
        
        // Verify the fix
        console.log('\n🔍 VERIFYING FIX...');
        const verifyTemplate = await GlobalInstantResponseTemplate.findById(templateDoc._id).lean();
        let verified = false;
        
        for (const category of (verifyTemplate.categories || [])) {
            for (const scenario of (category.scenarios || [])) {
                if (scenario.name === TARGET_SCENARIO_NAME || 
                    scenario.name?.toLowerCase().includes('outdoor fan not spinning')) {
                    console.log(`   Scenario: ${scenario.name}`);
                    console.log(`   scenarioType: ${scenario.scenarioType}`);
                    verified = scenario.scenarioType === CORRECT_TYPE;
                    break;
                }
            }
        }
        
        console.log('');
        console.log('═══════════════════════════════════════════════════════════════════════════════');
        if (verified) {
            console.log('  ✅ FIX VERIFIED SUCCESSFULLY');
            console.log(`     scenarioType is now "${CORRECT_TYPE}"`);
            console.log('     Platform Snapshot should now show:');
            console.log('       - unknownScenarioTypeCount: 0');
            console.log('       - scenarioBrain.health: GREEN');
        } else {
            console.log('  ⚠️ VERIFICATION UNCERTAIN');
            console.log('     Please check Platform Snapshot manually');
        }
        console.log('═══════════════════════════════════════════════════════════════════════════════\n');
        
    } finally {
        await mongoose.disconnect();
        console.log('✅ Disconnected from MongoDB');
    }
}

main().catch(err => {
    console.error('❌ Script failed:', err);
    process.exit(1);
});

