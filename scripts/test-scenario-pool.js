/**
 * Test script for ScenarioPoolService
 * Run: node scripts/test-scenario-pool.js <companyId>
 */

require('dotenv').config();
const mongoose = require('mongoose');
const ScenarioPoolService = require('../services/ScenarioPoolService');

async function test() {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');
        
        const companyId = process.argv[2] || '68e3f77a9d623b8058c700c4'; // Royal Plumbing
        
        console.log(`🧪 Testing ScenarioPoolService for company: ${companyId}\n`);
        
        const startTime = Date.now();
        const result = await ScenarioPoolService.getScenarioPoolForCompany(companyId);
        const elapsedTime = Date.now() - startTime;
        
        console.log('\n📊 RESULTS:');
        console.log(`⏱️  Query time: ${elapsedTime}ms`);
        console.log(`📚 Templates used: ${result.templatesUsed.length}`);
        console.log(`🎭 Total scenarios: ${result.scenarios.length}`);
        
        if (result.templatesUsed.length > 0) {
            console.log('\n📑 Templates:');
            result.templatesUsed.forEach(t => {
                console.log(`   - ${t.templateName} (${t.templateId})`);
            });
        }
        
        if (result.scenarios.length > 0) {
            const enabledCount = result.scenarios.filter(s => s.isEnabledForCompany).length;
            const disabledCount = result.scenarios.length - enabledCount;
            
            console.log(`\n✅ Enabled: ${enabledCount}`);
            console.log(`❌ Disabled: ${disabledCount}`);
            
            console.log('\n🎯 Sample scenarios (first 2):');
            result.scenarios.slice(0, 2).forEach((s, idx) => {
                console.log(`\n   ${idx + 1}. ${s.name}`);
                console.log(`      Template: ${s.templateName}`);
                console.log(`      Category: ${s.categoryName}`);
                console.log(`      ScenarioID: ${s.scenarioId}`);
                console.log(`      TemplateID: ${s.templateId}`);
                console.log(`      Enabled: ${s.isEnabledForCompany}`);
                console.log(`      Triggers: ${s.triggers.slice(0, 2).join(', ')}`);
            });
        }
        
        await mongoose.disconnect();
        console.log('\n✅ Test complete');
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}

test();

