/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * FIX HVAC UNKNOWN SCENARIOS
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Purpose: Fix scenarios with scenarioType=UNKNOWN in HVAC templates
 * 
 * This script:
 * 1. Finds all templates with HVAC/trades containing scenarios with UNKNOWN type
 * 2. Uses intelligent detection to classify them
 * 3. Updates the database
 * 4. Reports the changes
 * 
 * Usage:
 *   DRY_RUN=true node scripts/fix-hvac-unknown-scenarios.js   # Preview only
 *   node scripts/fix-hvac-unknown-scenarios.js                 # Apply changes
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const mongoose = require('mongoose');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
const { detectScenarioType } = require('../utils/scenarioTypeDetector');

const DRY_RUN = process.env.DRY_RUN === 'true';

// Scenario type detection lives in utils/scenarioTypeDetector.js

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN SCRIPT
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('  FIX HVAC UNKNOWN SCENARIOS');
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log(`  Mode: ${DRY_RUN ? '🔍 DRY RUN (preview only)' : '⚡ APPLY (writing changes)'}`);
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');
    
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        console.error('❌ MONGODB_URI not set');
        process.exit(1);
    }
    
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');
    
    try {
        // Find all templates
        const templates = await GlobalInstantResponseTemplate.find({}).lean();
        console.log(`📋 Found ${templates.length} templates\n`);
        
        let totalUnknown = 0;
        let totalFixed = 0;
        const changes = [];
        
        for (const template of templates) {
            const templateChanges = [];
            
            for (const category of (template.categories || [])) {
                for (const scenario of (category.scenarios || [])) {
                    // Check if UNKNOWN or missing
                    if (!scenario.scenarioType || scenario.scenarioType === 'UNKNOWN') {
                        totalUnknown++;
                        
                        const detected = detectScenarioType(scenario, category.name);
                        
                        templateChanges.push({
                            templateId: template._id.toString(),
                            templateName: template.name,
                            categoryName: category.name,
                            scenarioId: scenario.scenarioId || scenario._id?.toString(),
                            scenarioName: scenario.name,
                            before: scenario.scenarioType || 'null',
                            after: detected,
                            isLocked: scenario.autofillLock === true,
                            triggers: (scenario.triggers || []).slice(0, 3).join(', ')
                        });
                    }
                }
            }
            
            if (templateChanges.length > 0) {
                changes.push({
                    templateId: template._id.toString(),
                    templateName: template.name,
                    scenarios: templateChanges
                });
            }
        }
        
        // Report findings
        console.log('═══════════════════════════════════════════════════════════════════════════════');
        console.log('  FINDINGS');
        console.log('═══════════════════════════════════════════════════════════════════════════════');
        console.log(`  Total scenarios with UNKNOWN/null scenarioType: ${totalUnknown}`);
        console.log(`  Templates affected: ${changes.length}\n`);
        
        for (const templateChange of changes) {
            console.log(`\n📦 Template: ${templateChange.templateName} (${templateChange.templateId})`);
            console.log(`   Scenarios to fix: ${templateChange.scenarios.length}`);
            
            for (const sc of templateChange.scenarios) {
                const lockIcon = sc.isLocked ? '🔒' : '✏️';
                console.log(`   ${lockIcon} "${sc.scenarioName}"`);
                console.log(`      Category: ${sc.categoryName}`);
                console.log(`      Before: ${sc.before} → After: ${sc.after}`);
                console.log(`      Triggers: ${sc.triggers || 'none'}`);
            }
        }
        
        // Apply changes if not dry run
        if (!DRY_RUN && changes.length > 0) {
            console.log('\n═══════════════════════════════════════════════════════════════════════════════');
            console.log('  APPLYING CHANGES');
            console.log('═══════════════════════════════════════════════════════════════════════════════\n');
            
            for (const templateChange of changes) {
                const template = await GlobalInstantResponseTemplate.findById(templateChange.templateId);
                
                if (!template) {
                    console.log(`❌ Template not found: ${templateChange.templateId}`);
                    continue;
                }
                
                let updatedCount = 0;
                let skippedLocked = 0;
                
                for (const category of (template.categories || [])) {
                    for (const scenario of (category.scenarios || [])) {
                        const scenarioIdStr = scenario.scenarioId || scenario._id?.toString();
                        const changeInfo = templateChange.scenarios.find(s => 
                            s.scenarioId === scenarioIdStr || s.scenarioName === scenario.name
                        );
                        
                        if (changeInfo) {
                            // Skip locked scenarios
                            if (scenario.autofillLock === true) {
                                skippedLocked++;
                                console.log(`   🔒 Skipped (locked): ${scenario.name}`);
                                continue;
                            }
                            
                            // Apply the fix
                            scenario.scenarioType = changeInfo.after;
                            scenario.updatedAt = new Date();
                            scenario.updatedBy = 'fix-hvac-unknown-scenarios';
                            updatedCount++;
                            totalFixed++;
                            
                            console.log(`   ✅ Fixed: ${scenario.name} → ${changeInfo.after}`);
                        }
                    }
                }
                
                // Save template
                template.updatedAt = new Date();
                template.lastUpdatedBy = 'fix-hvac-unknown-scenarios';
                await template.save();
                
                console.log(`   💾 Saved template: ${templateChange.templateName}`);
                console.log(`      Updated: ${updatedCount}, Skipped (locked): ${skippedLocked}\n`);
            }
            
            console.log('═══════════════════════════════════════════════════════════════════════════════');
            console.log('  SUMMARY');
            console.log('═══════════════════════════════════════════════════════════════════════════════');
            console.log(`  Total UNKNOWN scenarios found: ${totalUnknown}`);
            console.log(`  Total scenarios fixed: ${totalFixed}`);
            console.log(`  Templates updated: ${changes.length}`);
            console.log('═══════════════════════════════════════════════════════════════════════════════\n');
        } else if (DRY_RUN && changes.length > 0) {
            console.log('\n═══════════════════════════════════════════════════════════════════════════════');
            console.log('  DRY RUN COMPLETE - No changes made');
            console.log('  Run without DRY_RUN=true to apply changes');
            console.log('═══════════════════════════════════════════════════════════════════════════════\n');
        } else {
            console.log('\n✅ No UNKNOWN scenarios found - all scenarios are properly typed!\n');
        }
        
    } finally {
        await mongoose.disconnect();
        console.log('✅ Disconnected from MongoDB');
    }
}

main().catch(err => {
    console.error('❌ Script failed:', err);
    process.exit(1);
});

