/**
 * Test script for Triage Builder endpoint
 * 
 * Usage: node scripts/test-triage-builder.js
 * 
 * Tests the /api/admin/triage-builder/generate endpoint with sample payload
 */

require('dotenv').config();
const { generateTriagePackage } = require('../services/TriageBuilderService');

const testPayload = {
    trade: 'HVAC',
    situation: 'Customer wants to book a cheap maintenance special even though their AC is not cooling.',
    serviceTypes: ['REPAIR', 'MAINTENANCE', 'EMERGENCY', 'OTHER']
};

console.log('🧪 [TEST] Starting Triage Builder test...\n');
console.log('📋 [TEST] Input:', JSON.stringify(testPayload, null, 2), '\n');

generateTriagePackage(
    testPayload.trade,
    testPayload.situation,
    testPayload.serviceTypes
)
    .then(result => {
        console.log('✅ [TEST] Success!\n');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('FRONTLINE_INTEL_SECTION:');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log(result.frontlineIntelSection);
        console.log('\n');
        
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('CHEAT_SHEET_TRIAGE_MAP:');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log(result.cheatSheetTriageMap);
        console.log('\n');
        
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('RESPONSE_LIBRARY (' + result.responseLibrary.length + ' responses):');
        console.log('═══════════════════════════════════════════════════════════════');
        result.responseLibrary.forEach((response, index) => {
            console.log(`${index + 1}. ${response}`);
        });
        console.log('\n');
        
        console.log('📊 [TEST] Statistics:');
        console.log(`  - Frontline-Intel length: ${result.frontlineIntelSection.length} chars`);
        console.log(`  - Cheat Sheet length: ${result.cheatSheetTriageMap.length} chars`);
        console.log(`  - Response count: ${result.responseLibrary.length}`);
        
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ [TEST] Failed:', error.message);
        console.error(error);
        process.exit(1);
    });

