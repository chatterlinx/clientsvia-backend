// debug-qa-data.js
// Debug script to check Q&A data structure

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://chatterlinx:eSnQuCbvZUXTJ6ZV@cluster0.0bqzx.mongodb.net/';
const DB_NAME = process.env.MONGODB_DB_NAME || 'clientsvia';

async function debugQAData() {
    console.log('=== DEBUG: Q&A DATA ANALYSIS ===');
    
    const client = new MongoClient(MONGODB_URI);
    
    try {
        await client.connect();
        const db = client.db(DB_NAME);
        const companiesCollection = db.collection('companiesCollection');
        
        // Get all companies
        const companies = await companiesCollection.find({}).toArray();
        
        console.log(`\nFound ${companies.length} companies total`);
        
        let companiesWithQAs = 0;
        for (const company of companies) {
            console.log(`\n--- Company: ${company.companyName || company.name || 'Unnamed'} ---`);
            console.log(`ID: ${company._id}`);
            console.log(`Company ID: ${company.companyID || 'N/A'}`);
            
            // Check agentSetup structure
            if (company.agentSetup) {
                console.log('✅ Has agentSetup');
                
                if (company.agentSetup.categoryQAs) {
                    console.log('✅ Has categoryQAs');
                    console.log(`   Length: ${company.agentSetup.categoryQAs.length} characters`);
                    console.log(`   Sample: ${company.agentSetup.categoryQAs.substring(0, 200)}...`);
                    companiesWithQAs++;
                } else {
                    console.log('❌ No categoryQAs found');
                }
                
                if (company.agentSetup.categories) {
                    console.log(`   Categories: ${JSON.stringify(company.agentSetup.categories)}`);
                } else {
                    console.log('   No categories found');
                }
            } else {
                console.log('❌ No agentSetup found');
            }
        }
        
        console.log(`\n=== SUMMARY ===`);
        console.log(`Total companies: ${companies.length}`);
        console.log(`Companies with Q&As: ${companiesWithQAs}`);
        
        // Pick a company with Q&As for testing
        const testCompany = companies.find(c => c.agentSetup?.categoryQAs);
        if (testCompany) {
            console.log(`\n=== TEST COMPANY ===`);
            console.log(`Use this company ID for testing: ${testCompany._id}`);
            console.log(`Company Name: ${testCompany.companyName || testCompany.name}`);
        }
        
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.close();
    }
}

// Run the debug
debugQAData().then(() => {
    console.log('\nDebug complete.');
    process.exit(0);
}).catch(error => {
    console.error('Debug failed:', error);
    process.exit(1);
});
