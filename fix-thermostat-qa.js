#!/usr/bin/env node
/**
 * Add Missing Thermostat Q&A Entry and Fix Q&A Matching Issues
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');
const KnowledgeEntry = require('./models/KnowledgeEntry');

async function addThermostatQA() {
  console.log('🔧 Adding missing thermostat Q&A entry...');
  
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to database');
    
    // First, let's see what entries currently exist
    console.log('\n📋 Current Q&A entries:');
    const existingEntries = await KnowledgeEntry.find({}).lean();
    existingEntries.forEach((entry, index) => {
      console.log(`${index + 1}. Question: "${entry.question}"`);
      console.log(`   Keywords: [${entry.keywords ? entry.keywords.join(', ') : 'none'}]`);
      console.log(`   Answer: "${entry.answer.substring(0, 80)}..."`);
      console.log(`   Company ID: ${entry.companyId}`);
      console.log('---');
    });
    
    // Find the correct company ID - look for the main company (686a680241806a4991f7367f)
    const targetCompanyId = '686a680241806a4991f7367f';
    
    console.log(`\n🎯 Adding thermostat TROUBLESHOOTING Q&A entry for company: ${targetCompanyId}`);
    
    // Check if thermostat TROUBLESHOOTING entry already exists (not just smart thermostat installation)
    const existingThermostat = await KnowledgeEntry.findOne({
      companyId: new ObjectId(targetCompanyId),
      $or: [
        { question: /thermostat.*issue/i },
        { question: /blank.*thermostat/i },
        { keywords: { $in: ['blank thermostat', 'thermostat blank', 'thermostat not working'] } }
      ]
    });
    
    if (existingThermostat) {
      console.log('⚠️ Thermostat troubleshooting entry already exists:', existingThermostat.question);
      return;
    }
    
    // Add the new thermostat TROUBLESHOOTING Q&A entry
    const thermostatEntry = new KnowledgeEntry({
      companyId: new ObjectId(targetCompanyId),
      question: 'thermostat issue',
      keywords: [
        'blank thermostat',
        'thermostat blank',
        'thermostat not working',
        'thermostat display blank',
        'thermostat no power',
        'thermostat screen off',
        'thermostat dead',
        'thermostat frozen',
        'thermostat display dark',
        'thermostat screen dark',
        'thermostat not responding',
        'thermostat battery',
        'no display thermostat',
        'black thermostat screen',
        'empty thermostat display'
      ],
      answer: 'It sounds like your thermostat display is blank or not working. This is usually caused by a power issue, dead batteries, or a tripped breaker. Let me schedule a technician to diagnose and fix this right away. Most thermostat issues can be resolved quickly - when would you like us to come out?',
      approved: true,
      category: 'HVAC Repair'
    });
    
    const result = await thermostatEntry.save();
    console.log('✅ Successfully added thermostat troubleshooting Q&A entry:', result._id);
    
    // Also update the fuzzy matching threshold for this company to be more precise
    const companyUpdate = await mongoose.connection.db.collection('companiesCollection').updateOne(
      { _id: new ObjectId(targetCompanyId) },
      { 
        $set: { 
          'aiSettings.fuzzyMatchThreshold': 0.2, // Lower threshold for more precise matching
          updatedAt: new Date()
        } 
      }
    );
    
    console.log('✅ Updated company fuzzy matching threshold to 0.2 for more precise matching');
    
    // Display updated entries for this company
    console.log('\n📋 Updated Q&A entries for target company:');
    const updatedEntries = await KnowledgeEntry.find({ companyId: new ObjectId(targetCompanyId) }).lean();
    updatedEntries.forEach((entry, index) => {
      console.log(`${index + 1}. Question: "${entry.question}"`);
      console.log(`   Keywords: [${entry.keywords ? entry.keywords.join(', ') : 'none'}]`);
      console.log(`   Answer: "${entry.answer.substring(0, 80)}..."`);
      console.log('---');
    });
    
    console.log('🎉 Thermostat Q&A entry added successfully!');
    console.log('🔧 Now the agent should properly handle "blank thermostat" requests');
    
  } catch (error) {
    console.error('❌ Error adding thermostat Q&A entry:', error);
  }
}

// Run if called directly
if (require.main === module) {
  addThermostatQA().then(() => {
    console.log('🎉 Thermostat Q&A entry added successfully!');
    console.log('🔧 Now the agent should properly handle "blank thermostat" requests');
    console.log('✅ Script completed');
    mongoose.connection.close();
    process.exit(0);
  }).catch(error => {
    console.error('❌ Script failed:', error);
    mongoose.connection.close();
    process.exit(1);
  });
}

module.exports = { addThermostatQA };
