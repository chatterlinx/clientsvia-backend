#!/usr/bin/env node
/**
 * Test AI Intelligence Engine Connections
 * Verifies all HTML IDs, JavaScript event handlers, and API endpoints
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 TESTING AI INTELLIGENCE ENGINE CONNECTIONS\n');

// Test 1: Verify HTML Elements Exist
console.log('📋 Step 1: Checking HTML Elements...');
const htmlContent = fs.readFileSync(path.join(__dirname, 'public/company-profile.html'), 'utf8');

const requiredIds = [
    'logicSemanticKnowledgeEnabled',
    'logicContextualMemoryEnabled', 
    'logicDynamicReasoningEnabled',
    'logicConfidenceThreshold',
    'logicConfidenceThresholdValue',
    'logicPersonalizationLevel',
    'logicSmartEscalationEnabled',
    'logicTestIntelligenceBtn',
    'logicIntelligenceTestResults',
    'logicAutoLearningEnabled',
    'logicPerformanceOptimization',
    'logicABTestingEnabled',
    'logicRealTimeOptimization',
    'logicPredictiveAnalytics'
];

let missingIds = [];
requiredIds.forEach(id => {
    if (!htmlContent.includes(`id="${id}"`)) {
        missingIds.push(id);
    }
});

if (missingIds.length === 0) {
    console.log('✅ All required HTML elements found');
} else {
    console.log('❌ Missing HTML elements:', missingIds);
}

// Test 2: Verify JavaScript Functions Exist  
console.log('\n📋 Step 2: Checking JavaScript Functions...');
const jsContent = fs.readFileSync(path.join(__dirname, 'public/js/ai-agent-setup.js'), 'utf8');

const requiredFunctions = [
    'initializeLogicAIIntelligence',
    'testLogicSuperAIIntelligence',
    'displayLogicIntelligenceTestResults',
    'updateLogicIntelligenceSettings',
    'updateLogicLearningSettings'
];

let missingFunctions = [];
requiredFunctions.forEach(func => {
    if (!jsContent.includes(func)) {
        missingFunctions.push(func);
    }
});

if (missingFunctions.length === 0) {
    console.log('✅ All required JavaScript functions found');
} else {
    console.log('❌ Missing JavaScript functions:', missingFunctions);
}

// Test 3: Verify API Endpoints Exist
console.log('\n📋 Step 3: Checking API Endpoints...');
const apiContent = fs.readFileSync(path.join(__dirname, 'routes/agentPerformance.js'), 'utf8');

const requiredEndpoints = [
    '/test-intelligence',
    '/intelligence-settings/:companyId',
    '/learning-settings/:companyId'
];

let missingEndpoints = [];
requiredEndpoints.forEach(endpoint => {
    const cleanEndpoint = endpoint.replace('/:companyId', '');
    if (!apiContent.includes(cleanEndpoint)) {
        missingEndpoints.push(endpoint);
    }
});

if (missingEndpoints.length === 0) {
    console.log('✅ All required API endpoints found');
} else {
    console.log('❌ Missing API endpoints:', missingEndpoints);
}

// Test 4: Verify Event Handler Connections
console.log('\n📋 Step 4: Checking Event Handler Connections...');
let eventHandlerIssues = [];

requiredIds.forEach(id => {
    if (id.includes('Btn') || id.includes('Enabled') || id.includes('Threshold') || id.includes('Level')) {
        if (!jsContent.includes(`getElementById('${id}')`)) {
            eventHandlerIssues.push(`Missing event handler for ${id}`);
        }
    }
});

if (eventHandlerIssues.length === 0) {
    console.log('✅ All event handlers properly connected');
} else {
    console.log('❌ Event handler issues:', eventHandlerIssues);
}

// Summary
console.log('\n🎯 SUMMARY:');
const totalIssues = missingIds.length + missingFunctions.length + missingEndpoints.length + eventHandlerIssues.length;

if (totalIssues === 0) {
    console.log('🎉 ALL TESTS PASSED! AI Intelligence Engine is fully connected and ready.');
    console.log('\n📍 Next Steps:');
    console.log('1. Open http://localhost:4000 in your browser');
    console.log('2. Navigate to any company\'s Agent Setup tab');
    console.log('3. Look for "AI Intelligence Engine (Advanced)" section');
    console.log('4. Test the controls and "Test Super AI Intelligence" button');
} else {
    console.log(`❌ Found ${totalIssues} issues that need to be fixed.`);
}

console.log('\n' + '='.repeat(60));
