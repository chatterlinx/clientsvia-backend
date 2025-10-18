#!/usr/bin/env node

require('dotenv').config();
const mongoose = require('mongoose');

async function checkDirect() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        
        // Query directly without Mongoose model
        const db = mongoose.connection.db;
        const collection = db.collection('companies');
        
        const doc = await collection.findOne(
            { _id: new mongoose.Types.ObjectId('68813026dd95f599c74e49c7') },
            { projection: { 'aiAgentLogic.initialGreeting': 1, 'aiAgentLogic.connectionMessages': 1 } }
        );
        
        console.log('\n🔍 DIRECT MONGODB QUERY (bypassing Mongoose):\n');
        console.log(JSON.stringify(doc, null, 2));
        console.log();
        
        await mongoose.disconnect();
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

checkDirect();

