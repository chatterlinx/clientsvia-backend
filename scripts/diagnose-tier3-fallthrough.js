/**
 * ============================================================================
 * TIER 3 FALLTHROUGH DIAGNOSTIC SCRIPT
 * ============================================================================
 * 
 * WHY: Every call is falling through to Tier 3 LLM (1200ms, $0.04/call)
 * GOAL: Find why Tier 1 (rule-based, <100ms, FREE) is failing
 * 
 * RUN: node scripts/diagnose-tier3-fallthrough.js <companyId>
 * 
 * CHECKS:
 * 1. Intelligence config (tier1Threshold, enabled state)
 * 2. Scenario pool (count, enabled state, triggers)
 * 3. ServiceSwitchboard (which services are ON)
 * 4. Fast lookup compilation status
 * 5. Recent calls (tier usage breakdown)
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
require('dotenv').config();

const Company = require('../models/v2Company');
const AdminSettings = require('../models/AdminSettings');
const ServiceSwitchboard = require('../models/ServiceSwitchboard');
const BlackBoxRecording = require('../models/BlackBoxRecording');
const ScenarioPoolService = require('../services/ScenarioPoolService');

const companyId = process.argv[2];

if (!companyId) {
    console.error('❌ Usage: node scripts/diagnose-tier3-fallthrough.js <companyId>');
    process.exit(1);
}

async function diagnose() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        // ════════════════════════════════════════════════════════════════
        // 1. LOAD COMPANY
        // ════════════════════════════════════════════════════════════════
        console.log('═'.repeat(80));
        console.log('1. COMPANY CONFIGURATION');
        console.log('═'.repeat(80));
        
        const company = await Company.findById(companyId);
        if (!company) {
            console.error(`❌ Company ${companyId} not found`);
            process.exit(1);
        }
        
        console.log(`✅ Company: ${company.companyName || company.businessName}`);
        console.log(`   Trade: ${company.defaultTrade || 'N/A'}`);
        console.log(`   Template: ${company.aiAgentSettings?.templateId || 'N/A'}\n`);

        // ════════════════════════════════════════════════════════════════
        // 2. INTELLIGENCE CONFIG
        // ════════════════════════════════════════════════════════════════
        console.log('═'.repeat(80));
        console.log('2. INTELLIGENCE CONFIGURATION');
        console.log('═'.repeat(80));
        
        const useGlobalIntelligence = company.aiAgentSettings?.useGlobalIntelligence !== false;
        console.log(`   Using: ${useGlobalIntelligence ? '🌐 GLOBAL' : '🎯 CUSTOM'} intelligence settings\n`);
        
        let intelligenceConfig;
        if (useGlobalIntelligence) {
            const adminSettings = await AdminSettings.findOne({});
            intelligenceConfig = adminSettings?.globalProductionIntelligence || {};
            console.log('   🌐 GLOBAL Intelligence Settings:');
        } else {
            intelligenceConfig = company.aiAgentSettings?.productionIntelligence || {};
            console.log('   🎯 CUSTOM Intelligence Settings:');
        }
        
        const enabled = intelligenceConfig.enabled === true;
        const tier1Threshold = intelligenceConfig.thresholds?.tier1 || 0.80;
        const tier2Threshold = intelligenceConfig.thresholds?.tier2 || 0.60;
        const enableTier3 = intelligenceConfig.thresholds?.enableTier3 !== false;
        
        console.log(`   Enabled: ${enabled ? '✅ YES' : '❌ NO'}`);
        console.log(`   Tier 1 Threshold: ${tier1Threshold} (${(tier1Threshold * 100).toFixed(0)}%)`);
        console.log(`   Tier 2 Threshold: ${tier2Threshold} (${(tier2Threshold * 100).toFixed(0)}%)`);
        console.log(`   Tier 3 Enabled: ${enableTier3 ? '✅ YES' : '❌ NO'}\n`);
        
        // ⚠️ WARNING: High threshold
        if (tier1Threshold >= 0.85) {
            console.log('   ⚠️  WARNING: Tier 1 threshold is VERY HIGH (>=85%)');
            console.log('   💡 Recommendation: Lower to 0.75 for better Tier 1 hit rate\n');
        } else if (tier1Threshold >= 0.80) {
            console.log('   ⚠️  NOTICE: Tier 1 threshold is HIGH (80%)');
            console.log('   💡 Consider: Lower to 0.70-0.75 if experiencing many Tier 3 calls\n');
        }

        // ════════════════════════════════════════════════════════════════
        // 3. SCENARIO POOL
        // ════════════════════════════════════════════════════════════════
        console.log('═'.repeat(80));
        console.log('3. SCENARIO POOL');
        console.log('═'.repeat(80));
        
        const poolResult = await ScenarioPoolService.getScenarioPoolForCompany(companyId);
        const allScenarios = poolResult?.scenarios || [];
        const enabledScenarios = allScenarios.filter(s => s.isEnabledForCompany !== false);
        
        console.log(`   Total scenarios: ${allScenarios.length}`);
        console.log(`   Enabled: ${enabledScenarios.length}`);
        console.log(`   Disabled: ${allScenarios.length - enabledScenarios.length}`);
        console.log(`   Compiled pool: ${poolResult?.compiled ? '✅ YES' : '❌ NO'}`);
        console.log(`   Fast lookup available: ${poolResult?.compiled?.specs ? '✅ YES' : '❌ NO'}\n`);
        
        if (enabledScenarios.length === 0) {
            console.log('   ❌ CRITICAL: NO ENABLED SCENARIOS!');
            console.log('   💡 Fix: Enable scenarios in Control Plane → Scenario Brain\n');
        } else if (enabledScenarios.length < 5) {
            console.log('   ⚠️  WARNING: Very few scenarios enabled (<5)');
            console.log('   💡 Consider: Add more scenarios for better coverage\n');
        }
        
        // Show sample scenarios
        console.log('   📋 Sample Enabled Scenarios (first 10):');
        enabledScenarios.slice(0, 10).forEach((s, i) => {
            const triggerCount = (s.triggers || []).length;
            const priority = s.priority || 0;
            console.log(`      ${i + 1}. ${s.name || 'Unnamed'} (${triggerCount} triggers, priority: ${priority})`);
        });
        console.log();

        // ════════════════════════════════════════════════════════════════
        // 4. SERVICE SWITCHBOARD
        // ════════════════════════════════════════════════════════════════
        console.log('═'.repeat(80));
        console.log('4. SERVICE SWITCHBOARD (Control Plane)');
        console.log('═'.repeat(80));
        
        const templateId = company.aiAgentSettings?.templateId;
        if (templateId) {
            const switchboard = await ServiceSwitchboard.findOne({ 
                companyId, 
                templateId 
            });
            
            if (switchboard) {
                const enabledServices = switchboard.getEnabledServices();
                const disabledServices = switchboard.getDisabledServices();
                
                console.log(`   Global Enabled: ${switchboard.globalEnabled ? '✅ YES' : '❌ NO'}`);
                console.log(`   Services Enabled: ${enabledServices.length}`);
                console.log(`   Services Disabled: ${disabledServices.length}\n`);
                
                if (!switchboard.globalEnabled) {
                    console.log('   ❌ CRITICAL: GLOBAL SWITCHBOARD IS OFF!');
                    console.log('   💡 Fix: Enable global switchboard in Control Plane\n');
                } else if (enabledServices.length === 0) {
                    console.log('   ❌ CRITICAL: NO SERVICES ENABLED!');
                    console.log('   💡 Fix: Enable services in Control Plane → Service Switchboard\n');
                } else {
                    console.log('   ✅ Enabled Services:');
                    enabledServices.slice(0, 10).forEach(s => {
                        console.log(`      - ${s.serviceKey} (sourcePolicy: ${s.sourcePolicy || 'auto'})`);
                    });
                    console.log();
                }
            } else {
                console.log('   ⚠️  WARNING: No switchboard found for this company+template');
                console.log('   💡 Action: Switchboard will be auto-created on first use\n');
            }
        } else {
            console.log('   ⚠️  No template assigned to company\n');
        }

        // ════════════════════════════════════════════════════════════════
        // 5. RECENT CALLS - TIER USAGE
        // ════════════════════════════════════════════════════════════════
        console.log('═'.repeat(80));
        console.log('5. RECENT CALLS (Last 20)');
        console.log('═'.repeat(80));
        
        const recentCalls = await BlackBoxRecording.find({ companyId })
            .sort({ startedAt: -1 })
            .limit(20)
            .lean();
        
        if (recentCalls.length === 0) {
            console.log('   ℹ️  No recent calls found in BlackBox\n');
        } else {
            console.log(`   Found ${recentCalls.length} recent calls\n`);
            
            let tier1Count = 0;
            let tier2Count = 0;
            let tier3Count = 0;
            let unknownCount = 0;
            
            recentCalls.forEach(call => {
                const events = call.events || [];
                const tier3Event = events.find(e => 
                    e.type === 'TIER3_LLM_FALLBACK_CALLED' || 
                    e.type === 'TIER3_FALLBACK'
                );
                const tier1Event = events.find(e => e.type === 'TIER3_FAST_MATCH');
                const tier2Event = events.find(e => e.type === 'TIER3_EMBEDDING_MATCH');
                
                if (tier1Event) tier1Count++;
                else if (tier2Event) tier2Count++;
                else if (tier3Event) tier3Count++;
                else unknownCount++;
            });
            
            const total = tier1Count + tier2Count + tier3Count + unknownCount;
            
            console.log('   📊 Tier Usage Breakdown:');
            console.log(`      Tier 1 (Rule-based, FREE): ${tier1Count}/${total} (${((tier1Count/total)*100).toFixed(1)}%)`);
            console.log(`      Tier 2 (Semantic, FREE): ${tier2Count}/${total} (${((tier2Count/total)*100).toFixed(1)}%)`);
            console.log(`      Tier 3 (LLM, $0.04): ${tier3Count}/${total} (${((tier3Count/total)*100).toFixed(1)}%) ⚠️`);
            console.log(`      Unknown: ${unknownCount}/${total}\n`);
            
            if (tier3Count > total * 0.5) {
                console.log('   🚨 CRITICAL: >50% of calls hitting Tier 3 LLM!');
                console.log('   💡 This is why responses are slow (1200ms vs 100ms)');
                console.log('   💡 Action: See recommendations below\n');
            } else if (tier3Count > total * 0.2) {
                console.log('   ⚠️  WARNING: >20% of calls hitting Tier 3 LLM');
                console.log('   💡 Target: <10% Tier 3 usage for optimal performance\n');
            } else {
                console.log('   ✅ GOOD: Tier 3 usage is within acceptable range (<20%)\n');
            }
        }

        // ════════════════════════════════════════════════════════════════
        // 6. RECOMMENDATIONS
        // ════════════════════════════════════════════════════════════════
        console.log('═'.repeat(80));
        console.log('6. 🎯 RECOMMENDATIONS TO FIX TIER 3 FALLTHROUGH');
        console.log('═'.repeat(80));
        console.log();
        
        const recommendations = [];
        
        // Check 1: Threshold too high
        if (tier1Threshold >= 0.80) {
            recommendations.push({
                priority: 'HIGH',
                issue: `Tier 1 threshold is ${(tier1Threshold * 100).toFixed(0)}% (too strict)`,
                fix: `Lower to 0.70-0.75 in ${useGlobalIntelligence ? 'Global' : 'Company'} Intelligence Settings`,
                impact: 'Will allow more scenarios to match at Tier 1 (FREE, fast)'
            });
        }
        
        // Check 2: No scenarios
        if (enabledScenarios.length === 0) {
            recommendations.push({
                priority: 'CRITICAL',
                issue: 'NO enabled scenarios',
                fix: 'Enable scenarios in Control Plane → Scenario Brain',
                impact: 'Without scenarios, everything falls to LLM'
            });
        }
        
        // Check 3: Few scenarios
        if (enabledScenarios.length > 0 && enabledScenarios.length < 10) {
            recommendations.push({
                priority: 'MEDIUM',
                issue: `Only ${enabledScenarios.length} scenarios enabled`,
                fix: 'Add more scenarios for common caller intents',
                impact: 'Better coverage = fewer LLM calls'
            });
        }
        
        // Check 4: No fast lookup
        if (!poolResult?.compiled) {
            recommendations.push({
                priority: 'MEDIUM',
                issue: 'Compiled pool not available',
                fix: 'Check ScenarioPoolService compilation',
                impact: 'Fast lookup speeds up Tier 1 matching'
            });
        }
        
        // Check 5: Switchboard off
        const switchboard = await ServiceSwitchboard.findOne({ companyId, templateId });
        if (switchboard && !switchboard.globalEnabled) {
            recommendations.push({
                priority: 'CRITICAL',
                issue: 'Global switchboard is OFF',
                fix: 'Enable in Control Plane → Service Switchboard',
                impact: 'All services blocked, nothing can match'
            });
        }
        
        if (recommendations.length === 0) {
            console.log('   ✅ No critical issues found!');
            console.log('   💡 If still experiencing Tier 3 fallthrough:');
            console.log('      - Check scenario trigger keywords (are they matching caller language?)');
            console.log('      - Review BlackBox logs for specific calls');
            console.log('      - Look at synonym configuration (caller vocabulary translation)');
        } else {
            recommendations.forEach((rec, i) => {
                console.log(`   ${i + 1}. [${rec.priority}] ${rec.issue}`);
                console.log(`      Fix: ${rec.fix}`);
                console.log(`      Impact: ${rec.impact}\n`);
            });
        }
        
        console.log('═'.repeat(80));
        console.log('DIAGNOSTIC COMPLETE');
        console.log('═'.repeat(80));
        console.log();

    } catch (error) {
        console.error('❌ Diagnostic failed:', error);
        console.error(error.stack);
    } finally {
        await mongoose.connection.close();
        process.exit(0);
    }
}

diagnose();
