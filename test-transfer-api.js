// test-transfer-api.js
// Test script for Transfer Router API endpoints

const axios = require('axios');

const BASE_URL = 'http://localhost:3000/api/transfer';

async function testTransferAPI() {
    console.log('🚀 Testing Transfer Router API...\n');

    try {
        // Test health check
        console.log('1. Testing health check...');
        const healthResponse = await axios.get(`${BASE_URL}/health`);
        console.log('✅ Health check response:', healthResponse.data);
        console.log('');

        // Test transfer resolution
        console.log('2. Testing transfer resolution...');
        const resolveTests = [
            'I want to talk to billing',
            'I need to speak with the manager',
            'Can I talk to dispatch?',
            'I want to speak with the owner'
        ];

        for (const query of resolveTests) {
            try {
                const response = await axios.post(`${BASE_URL}/resolve`, { query });
                console.log(`Query: "${query}"`);
                console.log(`Result: ${response.data.type}`);
                console.log(`Message: "${response.data.message}"`);
                if (response.data.target) {
                    console.log(`Target: ${response.data.target.name}`);
                }
                console.log('');
            } catch (error) {
                console.error(`❌ Error testing query "${query}":`, error.response?.data || error.message);
            }
        }

        // Test personnel lookup
        console.log('3. Testing personnel lookup...');
        const roles = ['manager', 'owner', 'dispatcher'];
        
        for (const role of roles) {
            try {
                const response = await axios.get(`${BASE_URL}/personnel/${role}`);
                console.log(`Role: ${role}`);
                console.log(`Name: ${response.data.name}`);
                console.log(`Can Transfer: ${response.data.canTransfer}`);
                console.log('');
            } catch (error) {
                console.error(`❌ Error getting ${role}:`, error.response?.data || error.message);
            }
        }

        // Test statistics
        console.log('4. Testing transfer statistics...');
        const statsResponse = await axios.get(`${BASE_URL}/stats`);
        console.log('📊 Transfer Statistics:');
        console.log(`Time: ${statsResponse.data.timeOfDay}`);
        console.log(`Total Personnel: ${statsResponse.data.totalPersonnel}`);
        console.log(`Available: ${statsResponse.data.available}`);
        console.log(`Unavailable: ${statsResponse.data.unavailable}`);
        console.log('');

        // Test personnel list
        console.log('5. Testing personnel list...');
        const personnelResponse = await axios.get(`${BASE_URL}/personnel`);
        console.log(`👥 Personnel Count: ${personnelResponse.data.count}`);
        personnelResponse.data.personnel.forEach(person => {
            console.log(`  - ${person.name} (${person.label}): ${person.roles.join(', ')}`);
        });
        console.log('');

        // Test multiple queries
        console.log('6. Testing multiple queries...');
        const testQueries = [
            'I need billing help',
            'Emergency repair needed',
            'Schedule an appointment'
        ];
        
        const testResponse = await axios.post(`${BASE_URL}/test`, {
            queries: testQueries
        });
        
        console.log('🧪 Test Results:');
        testResponse.data.testResults.forEach((result, index) => {
            console.log(`  ${index + 1}. "${result.query}" → ${result.result.type}`);
        });
        console.log('');

        console.log('✅ All Transfer Router API tests completed successfully!');

    } catch (error) {
        console.error('❌ API test failed:', error.response?.data || error.message);
        console.log('\n💡 Make sure the server is running with: npm start');
        console.log('📡 Testing endpoint:', BASE_URL);
    }
}

// Test with different time scenarios
async function testTimeScenarios() {
    console.log('\n⏰ Testing Time-based Scenarios...\n');

    const scenarios = [
        {
            name: 'Business Hours (Monday 2 PM)',
            timestamp: '2025-07-21T14:00:00Z'
        },
        {
            name: 'After Hours (Monday 8 PM)',
            timestamp: '2025-07-21T20:00:00Z'
        },
        {
            name: 'Weekend (Saturday 12 PM)',
            timestamp: '2025-07-19T12:00:00Z'
        }
    ];

    for (const scenario of scenarios) {
        try {
            console.log(`🕐 ${scenario.name}:`);
            
            // Test stats for this time
            const statsResponse = await axios.get(`${BASE_URL}/stats?timestamp=${scenario.timestamp}`);
            console.log(`   Available: ${statsResponse.data.available}/${statsResponse.data.totalPersonnel}`);
            
            // Test transfer resolution
            const resolveResponse = await axios.post(`${BASE_URL}/resolve`, {
                query: 'I want to talk to billing',
                timestamp: scenario.timestamp
            });
            console.log(`   Billing Request: ${resolveResponse.data.type}`);
            console.log('');
            
        } catch (error) {
            console.error(`❌ Error testing ${scenario.name}:`, error.response?.data || error.message);
        }
    }
}

// Run tests if this file is executed directly
if (require.main === module) {
    // Check if axios is available
    Promise.resolve()
        .then(() => testTransferAPI())
        .then(() => testTimeScenarios())
        .catch(error => {
            if (error.code === 'MODULE_NOT_FOUND') {
                console.log('📦 Installing axios for API testing...');
                const { exec } = require('child_process');
                exec('npm install axios', (error, stdout, stderr) => {
                    if (error) {
                        console.error('❌ Failed to install axios:', error);
                        return;
                    }
                    console.log('✅ Axios installed. Please run the test again.');
                });
            } else {
                console.error('❌ Test failed:', error);
            }
        });
}

module.exports = { testTransferAPI, testTimeScenarios };
