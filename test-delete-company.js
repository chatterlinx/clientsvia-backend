// Test script for company deletion functionality
// Run this after starting MongoDB to test the delete endpoint

const fetch = require('node-fetch');

async function testDeleteCompany() {
    console.log('🧪 Testing Company Delete Functionality...\n');
    
    try {
        // First, create a test company to delete
        console.log('1. Creating a test company to delete...');
        const testCompany = {
            companyName: 'Test Delete Company',
            companyPhone: '+1-555-DELETE-ME',
            companyAddress: '123 Delete Street, Remove City, DEL 12345',
            ownerName: null,
            ownerEmail: null,
            ownerPhone: null,
            contactName: null,
            contactEmail: null,
            contactPhone: null,
            timezone: 'America/New_York',
            status: 'active'
        };

        const createResponse = await fetch('http://localhost:4000/api/companies', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testCompany)
        });

        if (!createResponse.ok) {
            throw new Error(`Failed to create test company: ${createResponse.status}`);
        }

        const createResult = await createResponse.json();
        const companyId = createResult.company._id;
        console.log(`✅ Created test company with ID: ${companyId}`);

        // Wait a moment
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Now test the delete functionality
        console.log('\n2. Testing DELETE endpoint...');
        const deleteResponse = await fetch(`http://localhost:4000/api/company/${companyId}`, {
            method: 'DELETE'
        });

        if (!deleteResponse.ok) {
            const errorText = await deleteResponse.text();
            throw new Error(`Delete failed: ${deleteResponse.status} - ${errorText}`);
        }

        const deleteResult = await deleteResponse.json();
        console.log('✅ Delete Response:', JSON.stringify(deleteResult, null, 2));

        // Verify the company is actually deleted
        console.log('\n3. Verifying company was deleted...');
        const verifyResponse = await fetch(`http://localhost:4000/api/company/${companyId}`);
        
        if (verifyResponse.status === 404) {
            console.log('✅ Company successfully deleted and no longer exists');
        } else {
            console.log('❌ Warning: Company may still exist in database');
        }

        console.log('\n🎉 Delete functionality test completed successfully!');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        
        if (error.message.includes('ECONNREFUSED')) {
            console.log('\n💡 Make sure the server is running:');
            console.log('   cd /Users/marc/MyProjects/clientsvia-backend');
            console.log('   npm start');
            console.log('\n💡 Also ensure MongoDB is running:');
            console.log('   brew services start mongodb/brew/mongodb-community');
        }
    }
}

if (require.main === module) {
    testDeleteCompany();
}

module.exports = { testDeleteCompany };
