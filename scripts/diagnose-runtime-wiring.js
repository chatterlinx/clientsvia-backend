/**
 * ============================================================================
 * DIAGNOSE RUNTIME WIRING
 * ============================================================================
 * 
 * Checks why scenarios aren't being retrieved for a company.
 * Identifies missing template references, kill switches, etc.
 * 
 * Usage:
 *   node scripts/diagnose-runtime-wiring.js
 *   node scripts/diagnose-runtime-wiring.js --fix
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const Company = require('../models/v2Company');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
const ScenarioPoolService = require('../services/ScenarioPoolService');

// Configuration
const COMPANY_ID = '68e3f77a9d623b8058c700c4'; // Penguin Air
const TEMPLATE_ID = '68fb535130d19aec696d8123'; // HVAC Trade Knowledge Template (V1.1)
const MONGODB_URI = process.env.MONGODB_URI;

async function diagnose(shouldFix = false) {
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log('🔍 RUNTIME WIRING DIAGNOSTIC');
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log(`Company ID: ${COMPANY_ID}`);
    console.log(`Template ID: ${TEMPLATE_ID}`);
    console.log(`Mode: ${shouldFix ? 'FIX' : 'DIAGNOSE ONLY'}`);
    console.log('');

    if (!MONGODB_URI) {
        console.error('❌ MONGODB_URI environment variable is not set');
        process.exit(1);
    }

    try {
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        // ═══════════════════════════════════════════════════════════════════
        // CHECK 1: Company exists
        // ═══════════════════════════════════════════════════════════════════
        console.log('───────────────────────────────────────────────────────────────────────────');
        console.log('📋 CHECK 1: Company Exists');
        console.log('───────────────────────────────────────────────────────────────────────────');
        
        const company = await Company.findById(COMPANY_ID);
        if (!company) {
            console.error(`❌ Company ${COMPANY_ID} not found!`);
            process.exit(1);
        }
        console.log(`✅ Company found: ${company.companyName || company.businessName}`);
        console.log(`   Trade: ${company.trade || company.tradeKey || 'NOT SET'}`);

        // ═══════════════════════════════════════════════════════════════════
        // CHECK 2: Template exists and has scenarios
        // ═══════════════════════════════════════════════════════════════════
        console.log('\n───────────────────────────────────────────────────────────────────────────');
        console.log('📋 CHECK 2: Template Exists');
        console.log('───────────────────────────────────────────────────────────────────────────');
        
        const template = await GlobalInstantResponseTemplate.findById(TEMPLATE_ID);
        if (!template) {
            console.error(`❌ Template ${TEMPLATE_ID} not found!`);
            process.exit(1);
        }
        
        const totalScenarios = template.categories?.reduce((sum, cat) => sum + (cat.scenarios?.length || 0), 0) || 0;
        console.log(`✅ Template found: ${template.name}`);
        console.log(`   Version: ${template.version}`);
        console.log(`   Categories: ${template.categories?.length || 0}`);
        console.log(`   Total Scenarios: ${totalScenarios}`);

        // ═══════════════════════════════════════════════════════════════════
        // CHECK 3: Template References
        // ═══════════════════════════════════════════════════════════════════
        console.log('\n───────────────────────────────────────────────────────────────────────────');
        console.log('📋 CHECK 3: Template References (aiAgentSettings.templateReferences)');
        console.log('───────────────────────────────────────────────────────────────────────────');
        
        const templateRefs = company.aiAgentSettings?.templateReferences || [];
        console.log(`   Current refs: ${templateRefs.length}`);
        
        if (templateRefs.length === 0) {
            console.log('   ❌ NO TEMPLATE REFERENCES! Scenarios will not load.');
        } else {
            templateRefs.forEach((ref, i) => {
                const isTarget = ref.templateId?.toString() === TEMPLATE_ID;
                const status = ref.enabled !== false ? '✅ enabled' : '❌ disabled';
                console.log(`   [${i}] ${ref.templateId} ${status} priority=${ref.priority || 0} ${isTarget ? '← TARGET' : ''}`);
            });
        }
        
        // Check if our target template is referenced and enabled
        const targetRef = templateRefs.find(r => r.templateId?.toString() === TEMPLATE_ID);
        const hasTargetEnabled = targetRef && targetRef.enabled !== false;
        
        if (!hasTargetEnabled) {
            console.log(`\n   ⚠️  PROBLEM: HVAC template (${TEMPLATE_ID}) is NOT enabled!`);
        }

        // ═══════════════════════════════════════════════════════════════════
        // CHECK 4: Kill Switches (Discovery Consent)
        // ═══════════════════════════════════════════════════════════════════
        console.log('\n───────────────────────────────────────────────────────────────────────────');
        console.log('📋 CHECK 4: Kill Switches (discoveryConsent)');
        console.log('───────────────────────────────────────────────────────────────────────────');
        
        const dc = company.aiAgentSettings?.frontDeskBehavior?.discoveryConsent || {};
        
        const forceLLM = dc.forceLLMDiscovery !== false;
        const disableAuto = dc.disableScenarioAutoResponses !== false;
        const allowTypes = dc.autoReplyAllowedScenarioTypes || [];
        
        console.log(`   forceLLMDiscovery: ${forceLLM ? 'true (LLM always speaks)' : 'false (scenarios can speak)'}`);
        console.log(`   disableScenarioAutoResponses: ${disableAuto ? 'true (context-only by default)' : 'false (may verbatim)'}`);
        console.log(`   autoReplyAllowedScenarioTypes: [${allowTypes.join(', ')}]`);
        
        if (disableAuto && allowTypes.length > 0) {
            console.log(`   → Scenarios of types [${allowTypes.join(', ')}] CAN auto-respond`);
        } else if (disableAuto && allowTypes.length === 0) {
            console.log(`   ⚠️  ALL scenario auto-responses blocked (no allowlist)`);
        }

        // ═══════════════════════════════════════════════════════════════════
        // CHECK 5: Test Scenario Pool Loading
        // ═══════════════════════════════════════════════════════════════════
        console.log('\n───────────────────────────────────────────────────────────────────────────');
        console.log('📋 CHECK 5: Scenario Pool Loading Test');
        console.log('───────────────────────────────────────────────────────────────────────────');
        
        try {
            const poolResult = await ScenarioPoolService.getScenarioPoolForCompany(COMPANY_ID);
            const scenarios = poolResult?.scenarios || [];
            const enabled = scenarios.filter(s => s.isEnabledForCompany !== false);
            
            console.log(`   Total loaded: ${scenarios.length}`);
            console.log(`   Enabled: ${enabled.length}`);
            console.log(`   effectiveConfigVersion: ${poolResult?.effectiveConfigVersion || 'null'}`);
            
            if (scenarios.length === 0) {
                console.log('   ❌ NO SCENARIOS LOADED! This is the problem.');
            } else {
                console.log('   ✅ Scenarios loading correctly');
            }
        } catch (poolErr) {
            console.log(`   ❌ Error loading scenario pool: ${poolErr.message}`);
        }

        // ═══════════════════════════════════════════════════════════════════
        // FIX: Add template reference if missing
        // ═══════════════════════════════════════════════════════════════════
        if (shouldFix) {
            console.log('\n───────────────────────────────────────────────────────────────────────────');
            console.log('🔧 APPLYING FIXES');
            console.log('───────────────────────────────────────────────────────────────────────────');
            
            let changes = [];
            
            // Fix 1: Add template reference if missing
            if (!hasTargetEnabled) {
                console.log(`\n   📝 Adding template reference for ${TEMPLATE_ID}...`);
                
                // Remove any existing ref for this template
                const existingRefs = company.aiAgentSettings?.templateReferences || [];
                const filteredRefs = existingRefs.filter(r => r.templateId?.toString() !== TEMPLATE_ID);
                
                // Add new enabled ref
                filteredRefs.push({
                    templateId: TEMPLATE_ID,
                    enabled: true,
                    priority: 1,
                    addedAt: new Date(),
                    addedBy: 'runtime-wiring-fix'
                });
                
                company.set('aiAgentSettings.templateReferences', filteredRefs);
                changes.push('Added HVAC template reference');
            }
            
            // Fix 2: Add autoReplyAllowedScenarioTypes if empty
            if (allowTypes.length === 0 && disableAuto) {
                console.log('\n   📝 Adding default autoReplyAllowedScenarioTypes...');
                
                if (!company.aiAgentSettings) company.aiAgentSettings = {};
                if (!company.aiAgentSettings.frontDeskBehavior) company.aiAgentSettings.frontDeskBehavior = {};
                if (!company.aiAgentSettings.frontDeskBehavior.discoveryConsent) {
                    company.aiAgentSettings.frontDeskBehavior.discoveryConsent = {};
                }
                
                company.aiAgentSettings.frontDeskBehavior.discoveryConsent.autoReplyAllowedScenarioTypes = 
                    ['FAQ', 'TROUBLESHOOT', 'EMERGENCY'];
                
                company.markModified('aiAgentSettings.frontDeskBehavior.discoveryConsent');
                changes.push('Added autoReplyAllowedScenarioTypes: [FAQ, TROUBLESHOOT, EMERGENCY]');
            }
            
            if (changes.length > 0) {
                await company.save();
                console.log('\n   ✅ Changes saved:');
                changes.forEach(c => console.log(`      • ${c}`));
            } else {
                console.log('\n   ✅ No fixes needed - configuration looks correct');
            }
            
            // Re-test scenario pool after fix
            console.log('\n   🔄 Re-testing scenario pool loading...');
            try {
                const poolResult2 = await ScenarioPoolService.getScenarioPoolForCompany(COMPANY_ID);
                const scenarios2 = poolResult2?.scenarios || [];
                console.log(`   Scenarios after fix: ${scenarios2.length}`);
                
                if (scenarios2.length > 0) {
                    console.log('   ✅ Scenarios now loading correctly!');
                } else {
                    console.log('   ⚠️  Still no scenarios - may need Redis cache clear');
                }
            } catch (err2) {
                console.log(`   ❌ Error: ${err2.message}`);
            }
        }

        // ═══════════════════════════════════════════════════════════════════
        // SUMMARY
        // ═══════════════════════════════════════════════════════════════════
        console.log('\n═══════════════════════════════════════════════════════════════════════════');
        console.log('📊 DIAGNOSIS SUMMARY');
        console.log('═══════════════════════════════════════════════════════════════════════════');
        
        const issues = [];
        if (!hasTargetEnabled) issues.push('Template reference missing or disabled');
        if (disableAuto && allowTypes.length === 0) issues.push('No scenario types allowed for auto-reply');
        
        if (issues.length === 0) {
            console.log('✅ No wiring issues detected');
            console.log('   If scenarios still show 0, try:');
            console.log('   1. Clear Redis cache');
            console.log('   2. Restart the server');
            console.log('   3. Check server logs for errors');
        } else {
            console.log('❌ Issues found:');
            issues.forEach((issue, i) => console.log(`   ${i + 1}. ${issue}`));
            
            if (!shouldFix) {
                console.log('\n   To fix these issues, run:');
                console.log('   node scripts/diagnose-runtime-wiring.js --fix');
            }
        }

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('\n✅ Disconnected from MongoDB');
    }
}

// Parse args
const args = process.argv.slice(2);
const shouldFix = args.includes('--fix');

diagnose(shouldFix);

