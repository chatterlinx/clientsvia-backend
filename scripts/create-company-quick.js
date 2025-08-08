// Quick script to create a company in the correct database
const mongoose = require('mongoose');
const Company = require('./models/Company');

async function createCompany() {
    try {
        await mongoose.connect('mongodb://localhost:27017/clientsvia-test');
        console.log('Connected to MongoDB');
        
        // Delete any existing test company
        await Company.deleteMany({ companyName: 'Test Company' });
        
        // Create new test company
        const company = new Company({
            companyName: 'Test Company',
            email: 'test@example.com',
            phone: '555-0123',
            industry: 'Technology',
            aiSettings: {
                elevenLabs: {
                    useOwnApiKey: false,
                    voiceId: 'rachel', // Set a default voice
                    stability: 0.5,
                    similarityBoost: 0.7,
                    apiKey: '' // Empty for global key usage
                }
            }
        });
        
        await company.save();
        console.log('Company created with ID:', company._id.toString());
        console.log('Use this ID for testing:', company._id.toString());
        
        // Verify the save
        const saved = await Company.findById(company._id);
        console.log('Verification - Voice ID:', saved.aiSettings.elevenLabs.voiceId);
        
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

createCompany();
