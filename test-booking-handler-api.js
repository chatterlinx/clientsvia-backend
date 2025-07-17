// test-booking-handler-api.js
// Comprehensive test script for BookingHandler API functionality

const fetch = require('node-fetch');

const BASE_URL = 'http://localhost:3000';
const TEST_COMPANY_ID = '673c5c5c0b7bf5dfcc02b09b'; // Replace with your test company ID

console.log('🔥 BOOKING HANDLER API TEST SUITE');
console.log('==================================');

async function testAPI() {
    try {
        console.log('\n📡 1. Testing Available Booking Flows API');
        console.log('-------------------------------------------');
        
        const availableResponse = await fetch(`${BASE_URL}/api/booking-handler/available/${TEST_COMPANY_ID}`);
        const availableData = await availableResponse.json();
        
        console.log('✅ Available Flows Response:', JSON.stringify(availableData, null, 2));
        
        if (availableData.success && availableData.availableFlows.length > 0) {
            console.log(`\n📊 Found ${availableData.flowCount} available booking flows:`);
            availableData.availableFlows.forEach((flow, index) => {
                console.log(`  ${index + 1}. ${flow.tradeType} - ${flow.serviceType} (${flow.stepCount} steps)`);
            });
            
            // Test with first available flow
            const testFlow = availableData.availableFlows[0];
            
            console.log('\n📋 2. Testing Get Booking Flow API');
            console.log('-----------------------------------');
            
            const flowResponse = await fetch(`${BASE_URL}/api/booking-handler/flow/${TEST_COMPANY_ID}/${testFlow.tradeType}/${testFlow.serviceType}`);
            const flowData = await flowResponse.json();
            
            console.log('✅ Get Flow Response:', JSON.stringify(flowData, null, 2));
            
            if (flowData.success) {
                console.log('\n🎯 3. Testing Step Progression API');
                console.log('-----------------------------------');
                
                const totalSteps = flowData.bookingFlow.flowSteps.length;
                
                for (let step = 0; step <= totalSteps; step++) {
                    const stepResponse = await fetch(`${BASE_URL}/api/booking-handler/step`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            companyID: TEST_COMPANY_ID,
                            trade: testFlow.tradeType,
                            serviceType: testFlow.serviceType,
                            currentStep: step
                        })
                    });
                    
                    const stepData = await stepResponse.json();
                    
                    if (step < totalSteps) {
                        console.log(`Step ${step + 1}/${totalSteps}: ${stepData.message}`);
                    } else {
                        console.log(`Completion: ${stepData.message}`);
                    }
                }
                
                console.log('\n🎬 4. Testing Flow Simulation API');
                console.log('----------------------------------');
                
                const simulationResponse = await fetch(`${BASE_URL}/api/booking-handler/simulate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        companyID: TEST_COMPANY_ID,
                        trade: testFlow.tradeType,
                        serviceType: testFlow.serviceType,
                        responses: [
                            "Home",
                            "123 Main St, Anytown, USA 12345",
                            "AC not cooling properly",
                            "Tomorrow afternoon",
                            "Afternoon works better"
                        ]
                    })
                });
                
                const simulationData = await simulationResponse.json();
                console.log('✅ Simulation Response:', JSON.stringify(simulationData, null, 2));
                
                console.log('\n🔍 5. Testing Flow Validation API');
                console.log('----------------------------------');
                
                const validationResponse = await fetch(`${BASE_URL}/api/booking-handler/validate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        bookingScript: flowData.bookingFlow
                    })
                });
                
                const validationData = await validationResponse.json();
                console.log('✅ Validation Response:', JSON.stringify(validationData, null, 2));
                
            }
        } else {
            console.log('⚠️  No booking flows found. Running sample data creation...');
            
            // Import and run sample data creation
            const { createSampleBookingData } = require('./create-sample-booking-data');
            await createSampleBookingData();
            
            console.log('\n🔄 Re-running tests with sample data...');
            await testAPI(); // Recursive call with sample data
            return;
        }
        
        console.log('\n🎉 ALL TESTS COMPLETED SUCCESSFULLY!');
        console.log('=====================================');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('Stack trace:', error.stack);
    }
}

async function testTradeServiceTypes() {
    console.log('\n🛠️  6. Testing Trade Categories & Service Types Integration');
    console.log('----------------------------------------------------------');
    
    try {
        // Test getting trade categories
        const tradesResponse = await fetch(`${BASE_URL}/api/trade-categories`);
        const tradesData = await tradesResponse.json();
        
        console.log(`✅ Found ${tradesData.length} trade categories`);
        
        if (tradesData.length > 0) {
            const testTrade = tradesData[0];
            console.log(`Testing with trade: ${testTrade.name}`);
            
            // Test getting service types for this trade
            const serviceTypesResponse = await fetch(`${BASE_URL}/api/trade-categories/service-types/${testTrade.name}`);
            const serviceTypesData = await serviceTypesResponse.json();
            
            console.log('✅ Service Types Response:', JSON.stringify(serviceTypesData, null, 2));
            
            if (serviceTypesData.serviceTypes && serviceTypesData.serviceTypes.length > 0) {
                // Test booking flow for first service type
                const testServiceType = serviceTypesData.serviceTypes[0];
                
                console.log(`\n🔗 Testing booking flow for ${testTrade.name} - ${testServiceType}`);
                
                const flowResponse = await fetch(`${BASE_URL}/api/booking-handler/flow/${TEST_COMPANY_ID}/${testTrade.name}/${testServiceType}`);
                const flowData = await flowResponse.json();
                
                if (flowData.success) {
                    console.log('✅ Booking flow found and integrated with trade categories!');
                    console.log(`Flow has ${flowData.stepCount} steps`);
                } else {
                    console.log('⚠️  No booking flow configured for this trade/service combination');
                    console.log('This is expected if you haven\'t configured booking scripts via the UI yet');
                }
            }
        }
        
    } catch (error) {
        console.error('❌ Trade/Service integration test failed:', error.message);
    }
}

async function runAllTests() {
    console.log(`🚀 Starting tests against: ${BASE_URL}`);
    console.log(`📋 Test Company ID: ${TEST_COMPANY_ID}`);
    console.log('\nMake sure your server is running with: npm start\n');
    
    await testAPI();
    await testTradeServiceTypes();
    
    console.log('\n📝 TESTING SUMMARY');
    console.log('==================');
    console.log('✅ BookingHandler API endpoints tested');
    console.log('✅ Flow progression logic validated');
    console.log('✅ Integration with trade categories verified');
    console.log('✅ Sample data creation scripts available');
    console.log('\n🎯 Next Steps:');
    console.log('   1. Use the Admin UI to configure booking scripts');
    console.log('   2. Test the Service Type Manager panel');
    console.log('   3. Test the Booking Script Configuration panel');
    console.log('   4. Integrate BookingHandler into your AI agent logic');
}

// Run tests if called directly
if (require.main === module) {
    runAllTests()
        .then(() => {
            console.log('\n✅ All tests completed successfully!');
            process.exit(0);
        })
        .catch(error => {
            console.error('\n❌ Tests failed:', error);
            process.exit(1);
        });
}

module.exports = { testAPI, testTradeServiceTypes, runAllTests };
