// check-companies.js
// Quick script to check existing companies in the database

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://chatterlinx:eSnQuCbvZUXTJ6ZV@cluster0.0bqzx.mongodb.net/';
const DB_NAME = process.env.MONGODB_DB_NAME || 'clientsvia';

async function checkCompanies() {
    console.log('Checking existing companies in database...');
    
    const client = new MongoClient(MONGODB_URI);
    
    try {
        await client.connect();
        const db = client.db(DB_NAME);
        const companiesCollection = db.collection('companiesCollection');
        
        const companies = await companiesCollection.find({}, { projection: { _id: 1, name: 1, companyID: 1 } }).toArray();
        
        console.log(`Found ${companies.length} companies:`);
        companies.forEach((company, index) => {
            console.log(`  ${index + 1}. ${company.name || 'Unnamed'} (ID: ${company._id}, companyID: ${company.companyID || 'N/A'})`);
        });
        
        if (companies.length > 0) {
            console.log(`\nUsing first company for testing: ${companies[0]._id}`);
            return companies[0]._id.toString();
        }
        
    } catch (error) {
        console.error('Error checking companies:', error);
    } finally {
        await client.close();
    }
    
    return null;
}

// Run if called directly
if (require.main === module) {
    checkCompanies()
        .then((companyId) => {
            if (companyId) {
                console.log(`\nUse this company ID for testing: ${companyId}`);
            } else {
                console.log('\nNo companies found. Please create a company first.');
            }
            process.exit(0);
        })
        .catch(error => {
            console.error('Failed to check companies:', error);
            process.exit(1);
        });
}

module.exports = { checkCompanies };
