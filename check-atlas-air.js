#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
    const db = mongoose.connection.db;
    
    // Find Atlas Air
    const company = await db.collection('companies').findOne({ 
        $or: [
            { companyName: /atlas air/i },
            { _id: new mongoose.Types.ObjectId('68813026dd95f599c74e49c7') }
        ]
    });
    
    if (!company) {
        console.log('❌ Company not found!');
        process.exit(1);
    }
    
    console.log('✅ Found company:');
    console.log('   ID:', company._id.toString());
    console.log('   Name:', company.companyName);
    console.log('   Has quickVariables:', 'quickVariables' in company);
    console.log('   quickVariables:', company.quickVariables);
    console.log('');
    
    // Now try to add it using MongoDB directly
    console.log('🔧 Adding quickVariables field with $set...');
    const result = await db.collection('companies').updateOne(
        { _id: company._id },
        { 
            $set: { 
                quickVariables: [{
                    id: 'test-direct-123',
                    name: 'Company Name',
                    value: 'Atlas Air',
                    createdAt: new Date()
                }]
            }
        }
    );
    
    console.log('Update result:', result);
    
    // Verify
    const updated = await db.collection('companies').findOne({ _id: company._id });
    console.log('✅ After update:');
    console.log('   quickVariables:', updated.quickVariables);
    
    process.exit(0);
}).catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
});

