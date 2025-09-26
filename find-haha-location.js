const mongoose = require('mongoose');
const Company = require('./models/Company');

async function findHahaLocation() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/clientsvia');
    console.log('Connected to MongoDB');

    const companyId = '68813026dd95f599c74e49c7';
    const company = await Company.findById(companyId);

    if (!company) {
      console.log('Company not found');
      return;
    }

    console.log('=== SEARCHING FOR HAHA IN COMPANY DATA ===');
    
    function searchObject(obj, path = '') {
      if (typeof obj === 'string') {
        if (obj.toLowerCase().includes('haha')) {
          console.log(`FOUND HAHA at path: ${path}`);
          console.log(`Value: "${obj}"`);
        }
      } else if (Array.isArray(obj)) {
        obj.forEach((item, index) => {
          searchObject(item, `${path}[${index}]`);
        });
      } else if (obj && typeof obj === 'object') {
        Object.keys(obj).forEach(key => {
          searchObject(obj[key], path ? `${path}.${key}` : key);
        });
      }
    }

    searchObject(company.toObject());

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

findHahaLocation();
