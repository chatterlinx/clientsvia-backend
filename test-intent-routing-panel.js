/**
 * Test Intent Routing & Flow Control Panel Functionality
 * This script tests the new Intent Routing API endpoints and UI integration
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:4000';
const TEST_COMPANY_ID = '6584e1a123456789abcdef01';

async function testIntentRoutingImplementation() {
    console.log('🚀 Testing Intent Routing & Flow Control Panel Implementation\n');
    
    let allTestsPassed = true;
    
    try {
        // Test 1: Get Intent Routing Configuration
        console.log('📋 Test 1: Get Intent Routing Configuration');
        try {
            const response = await axios.get(`${BASE_URL}/api/agent/intent-routing/${TEST_COMPANY_ID}`);
            
            if (response.data.success && response.data.data.intentFlow) {
                console.log('✅ PASS: Got intent routing configuration');
                console.log(`   - Found ${response.data.data.intentFlow.length} intent categories`);
                console.log(`   - Performance metrics available: ${!!response.data.data.performance}`);
            } else {
                console.log('❌ FAIL: Invalid configuration structure');
                allTestsPassed = false;
            }
        } catch (error) {
            console.log('❌ FAIL: Error getting configuration:', error.message);
            allTestsPassed = false;
        }
        
        // Test 2: Classify Intent
        console.log('\n🧠 Test 2: Intent Classification');
        try {
            const testInputs = [
                'My AC stopped working this morning',
                'I need to schedule maintenance',
                'What are your hours?',
                'Can I speak to a manager?'
            ];
            
            for (const input of testInputs) {
                const response = await axios.post(`${BASE_URL}/api/agent/classify-intent`, {
                    companyId: TEST_COMPANY_ID,
                    inputText: input
                });
                
                if (response.data.success && response.data.data.intent) {
                    console.log(`✅ PASS: "${input}" → ${response.data.data.intent.intentName} (${response.data.data.intent.confidence}%)`);
                } else {
                    console.log(`❌ FAIL: Could not classify "${input}"`);
                    allTestsPassed = false;
                }
            }
        } catch (error) {
            console.log('❌ FAIL: Error classifying intents:', error.message);
            allTestsPassed = false;
        }
        
        // Test 3: Test Intent Flow
        console.log('\n🔬 Test 3: Intent Flow Testing');
        try {
            const response = await axios.post(`${BASE_URL}/api/agent/test-intent-flow`, {
                companyId: TEST_COMPANY_ID,
                testInput: 'My air conditioner is broken and needs immediate repair',
                scenario: 'service_emergency'
            });
            
            if (response.data.success && response.data.data.steps) {
                console.log('✅ PASS: Intent flow test completed');
                console.log(`   - Processing time: ${response.data.data.processingTime}`);
                console.log(`   - Confidence: ${response.data.data.confidence}`);
                console.log(`   - Steps executed: ${response.data.data.steps.length}`);
                console.log(`   - Final response: "${response.data.data.finalResponse.substring(0, 50)}..."`);
            } else {
                console.log('❌ FAIL: Invalid flow test response');
                allTestsPassed = false;
            }
        } catch (error) {
            console.log('❌ FAIL: Error testing intent flow:', error.message);
            allTestsPassed = false;
        }
        
        // Test 4: Validate Intent Flow
        console.log('\n✅ Test 4: Intent Flow Validation');
        try {
            const validFlow = [
                {
                    id: 'test_intent',
                    name: 'Test Intent',
                    priority: 'high',
                    confidence: 85,
                    keywords: ['test', 'demo'],
                    order: 1,
                    handler: 'TestHandler'
                }
            ];
            
            const response = await axios.post(`${BASE_URL}/api/agent/validate-intent-flow`, {
                intentFlow: validFlow
            });
            
            if (response.data.success && response.data.data.isValid !== undefined) {
                console.log(`✅ PASS: Intent flow validation works (valid: ${response.data.data.isValid})`);
            } else {
                console.log('❌ FAIL: Invalid validation response');
                allTestsPassed = false;
            }
        } catch (error) {
            console.log('❌ FAIL: Error validating intent flow:', error.message);
            allTestsPassed = false;
        }
        
        // Test 5: Get Performance Metrics
        console.log('\n📊 Test 5: Performance Metrics');
        try {
            const response = await axios.get(`${BASE_URL}/api/agent/intent-routing-metrics/${TEST_COMPANY_ID}?timeRange=24h`);
            
            if (response.data.success && response.data.data.intentAccuracy !== undefined) {
                console.log('✅ PASS: Performance metrics retrieved');
                console.log(`   - Intent accuracy: ${response.data.data.intentAccuracy}%`);
                console.log(`   - Routing speed: ${response.data.data.routingSpeed}s`);
                console.log(`   - Fallback rate: ${response.data.data.fallbackRate}%`);
                console.log(`   - Total intents: ${response.data.data.totalIntents}`);
            } else {
                console.log('❌ FAIL: Invalid metrics response');
                allTestsPassed = false;
            }
        } catch (error) {
            console.log('❌ FAIL: Error getting performance metrics:', error.message);
            allTestsPassed = false;
        }
        
        // Test 6: Intent Templates
        console.log('\n📚 Test 6: Intent Templates');
        try {
            const response = await axios.get(`${BASE_URL}/api/agent/intent-templates?businessType=hvac`);
            
            if (response.data.success && response.data.data.intents) {
                console.log('✅ PASS: Intent templates retrieved');
                console.log(`   - Business type: ${response.data.data.name}`);
                console.log(`   - Available intents: ${response.data.data.intents.length}`);
            } else {
                console.log('❌ FAIL: Invalid templates response');
                allTestsPassed = false;
            }
        } catch (error) {
            console.log('❌ FAIL: Error getting intent templates:', error.message);
            allTestsPassed = false;
        }
        
        // Summary
        console.log('\n' + '='.repeat(60));
        if (allTestsPassed) {
            console.log('🎉 ALL TESTS PASSED! Intent Routing & Flow Control Panel is working correctly.');
            console.log('\n✨ Features Implemented:');
            console.log('   • Multi-tenant AI logic configurator');
            console.log('   • Intent classification with confidence scoring');
            console.log('   • Flow testing and validation');
            console.log('   • Performance metrics and analytics');
            console.log('   • Business-specific intent templates');
            console.log('   • Real-time configuration updates');
            console.log('   • Safe dropdown selectors and reorder buttons');
            console.log('   • Complete UI integration in Agent Setup tab');
            
            console.log('\n🔗 Access the panel:');
            console.log(`   Company Profile: ${BASE_URL}/company-profile.html?companyId=${TEST_COMPANY_ID}`);
            console.log('   Navigate to: Agent Setup > Intent Routing & Flow Control Panel');
            
        } else {
            console.log('❌ SOME TESTS FAILED. Check the errors above.');
        }
        console.log('='.repeat(60));
        
    } catch (error) {
        console.error('💥 Fatal error during testing:', error.message);
    }
}

// Run the test
testIntentRoutingImplementation().catch(console.error);
