const mongoose = require('mongoose');
const Company = require('./models/Company');

async function createTestCompany() {
  try {
    await mongoose.connect('mongodb://localhost:27017/clientsvia');
    console.log('Connected to MongoDB');
    
    // Check if test company already exists
    let company = await Company.findOne({ companyName: 'Test Company' });
    
    if (!company) {
      // Create a test company
      company = new Company({
        companyName: 'Test Company',
        email: 'test@example.com',
        phone: '555-0123',
        industry: 'Technology',
        aiSettings: {
          elevenLabs: {
            useOwnApiKey: false,
            voiceId: null,
            stability: 0.5,
            similarityBoost: 0.7
          }
        }
      });
      
      await company.save();
      console.log('✅ Created test company with ID:', company._id.toString());
    } else {
      console.log('✅ Found existing test company with ID:', company._id.toString());
    }
    
    await mongoose.disconnect();
    return company._id.toString();
  } catch (err) {
    console.error('❌ Error:', err.message);
    await mongoose.disconnect();
    process.exit(1);
  }
}

createTestCompany();
