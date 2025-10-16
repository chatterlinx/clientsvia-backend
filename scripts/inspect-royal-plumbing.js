#!/usr/bin/env node

require('dotenv').config();
const mongoose = require('mongoose');

async function inspect() {
    await mongoose.connect(process.env.MONGODB_URI);
    
    const db = mongoose.connection.db;
    const companies = db.collection('v2companies');
    
    const company = await companies.findOne({ _id: new mongoose.Types.ObjectId('68e3f77a9d623b8058c700c4') });
    
    console.log('\n🔍 Searching for string "default" in company document...\n');
    
    function findStringDefaults(obj, path = '') {
        for (const [key, value] of Object.entries(obj || {})) {
            const currentPath = path ? `${path}.${key}` : key;
            
            if (value === 'default' || value === 'Default') {
                console.log(`❌ FOUND: ${currentPath} = "${value}"`);
            } else if (typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)) {
                findStringDefaults(value, currentPath);
            } else if (Array.isArray(value)) {
                value.forEach((item, index) => {
                    if (typeof item === 'object' && item !== null) {
                        findStringDefaults(item, `${currentPath}[${index}]`);
                    }
                });
            }
        }
    }
    
    findStringDefaults(company);
    
    console.log('\n✅ Scan complete');
    await mongoose.disconnect();
    process.exit(0);
}

inspect();

