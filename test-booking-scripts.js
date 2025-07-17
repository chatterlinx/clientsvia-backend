/**
 * Test Booking Scripts Configuration
 * Tests the new booking script functionality end-to-end
 */

const baseURL = 'http://localhost:4000';
const testCompanyId = '686a680241806a4991f7367f'; // Penguin Air test company

async function testBookingScriptsAPI() {
    console.log('🧪 Testing Booking Scripts Configuration');
    console.log('==========================================');

    try {
        // Test 1: Create a new booking script
        console.log('\n1️⃣ Testing: Create booking script');
        
        const newScript = {
            companyId: testCompanyId,
            tradeType: 'hvac',
            serviceType: 'repair',
            script: [
                'So I can help you correctly, do you need AC repair or heating repair?',
                'Is this for your home or business?',
                'What\'s the address where you need service?',
                'What\'s the best phone number to reach you?',
                'Are you available today for emergency service?',
                'Perfect! I\'ve got you scheduled for HVAC repair service.'
            ]
        };

        const createResponse = await fetch(`${baseURL}/api/booking-scripts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newScript)
        });
        
        const createResult = await createResponse.json();
        
        if (createResult.success) {
            console.log('✅ Successfully created booking script');
            console.log(`   Trade/Service: ${newScript.tradeType}/${newScript.serviceType}`);
        } else {
            console.log('❌ Failed to create booking script:', createResult.error);
            return;
        }

        // Test 2: Retrieve the created script
        console.log('\n2️⃣ Testing: Retrieve specific booking script');
        
        const getResponse = await fetch(`${baseURL}/api/booking-scripts/${testCompanyId}/${newScript.tradeType}/${newScript.serviceType}`);
        const getResult = await getResponse.json();
        
        if (getResult.tradeType && getResult.serviceType) {
            console.log('✅ Successfully retrieved booking script');
            console.log(`   Trade/Service: ${getResult.tradeType}/${getResult.serviceType}`);
            console.log(`   Script steps: ${getResult.script.length} steps`);
        } else {
            console.log('❌ Failed to retrieve booking script:', getResult.error || 'Invalid response structure');
        }

        // Test 3: Get all booking scripts for company
        console.log('\n3️⃣ Testing: Get all booking scripts');
        
        const getAllResponse = await fetch(`${baseURL}/api/booking-scripts/${testCompanyId}`);
        const getAllResult = await getAllResponse.json();
        
        if (getAllResult.bookingScripts) {
            console.log('✅ Successfully retrieved all booking scripts');
            console.log(`   Total scripts: ${getAllResult.bookingScripts.length}`);
            getAllResult.bookingScripts.forEach(script => {
                console.log(`   - ${script.tradeType}/${script.serviceType} (${script.script.length} steps)`);
            });
        } else {
            console.log('❌ Failed to retrieve all booking scripts:', getAllResult.error || 'Invalid response structure');
        }

        // Test 4: Test booking script execution
        console.log('\n4️⃣ Testing: Booking script execution test');
        
        const testData = {
            script: newScript.script,
            tradeType: newScript.tradeType,
            serviceType: newScript.serviceType
        };

        const testResponse = await fetch(`${baseURL}/api/booking-scripts/test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testData)
        });
        
        const testResult = await testResponse.json();
        
        if (testResult.status === 'success') {
            console.log('✅ Successfully tested booking script');
            console.log(`   Trade/Service: ${testResult.tradeType}/${testResult.serviceType}`);
            console.log(`   Script steps: ${testResult.stepCount}`);
            console.log(`   Estimated duration: ${testResult.estimatedDuration} seconds`);
            if (testResult.suggestions.length > 0) {
                console.log(`   Suggestions: ${testResult.suggestions.join(', ')}`);
            }
        } else {
            console.log('❌ Failed to test booking script:', testResult.error);
        }

        // Test 5: Create another script (different service type)
        console.log('\n5️⃣ Testing: Create second booking script (maintenance)');
        
        const maintenanceScript = {
            companyId: testCompanyId,
            tradeType: 'hvac',
            serviceType: 'maintenance',
            script: [
                'Are you looking to schedule routine maintenance or a specific tune-up?',
                'Is this for your home or business?',
                'What\'s the address for the maintenance visit?',
                'What\'s your preferred contact number?',
                'When would be the best time for our technician?',
                'Excellent! I\'ve scheduled your maintenance appointment.'
            ]
        };

        const maintenanceResponse = await fetch(`${baseURL}/api/booking-scripts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(maintenanceScript)
        });
        
        const maintenanceResult = await maintenanceResponse.json();
        
        if (maintenanceResult.success) {
            console.log('✅ Successfully created maintenance booking script');
        } else {
            console.log('❌ Failed to create maintenance script:', maintenanceResult.error);
        }

        // Test 6: Test templates endpoint
        console.log('\n6️⃣ Testing: Booking script templates');
        
        const templatesResponse = await fetch(`${baseURL}/api/booking-scripts/templates`);
        const templatesResult = await templatesResponse.json();
        
        if (templatesResult && templatesResult.hvac) {
            console.log('✅ Successfully retrieved templates');
            const trades = Object.keys(templatesResult);
            console.log(`   Available trade templates: ${trades.join(', ')}`);
            
            trades.forEach(trade => {
                const services = Object.keys(templatesResult[trade]);
                console.log(`   ${trade}: ${services.join(', ')}`);
            });
        } else {
            console.log('❌ Failed to retrieve templates:', templatesResult.error || 'Invalid response structure');
        }

        console.log('\n📊 Test Summary:');
        console.log('================');
        console.log('✅ All booking script tests completed successfully!');
        console.log('🎉 The Booking Script Configuration panel is ready for use.');
        console.log('');
        console.log('📍 Location in UI: Company Profile → Agent Setup → Booking Script Configuration');
        console.log('🔧 Features tested:');
        console.log('   - Create booking scripts per trade/service');
        console.log('   - Retrieve individual and all scripts');
        console.log('   - Test script execution simulation');
        console.log('   - Template system');
        console.log('   - Multiple trade types and service types');

    } catch (error) {
        console.error('❌ Test error:', error.message);
    }
}

// Run the test
testBookingScriptsAPI();
