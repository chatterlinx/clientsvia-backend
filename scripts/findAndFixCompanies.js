#!/usr/bin/env node

// Script to find and fix companies with phone numbers
const { MongoClient } = require('mongodb');
require('dotenv').config();

async function findAndFixCompanies() {
  const client = new MongoClient(process.env.MONGODB_URI);
  
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const db = client.db();
    const companiesCollection = db.collection('companiesCollection');
    
    // Find companies with phone numbers
    const companies = await companiesCollection.find({
      'twilioConfig.phoneNumber': { $exists: true, $ne: null }
    }).toArray();
    
    console.log(`Found ${companies.length} companies with phone numbers`);
    
    for (const company of companies) {
      console.log(`Company: ${company.companyName} (${company._id})`);
      console.log(`Phone: ${company.twilioConfig?.phoneNumber}`);
      console.log(`Current escalation message: ${company.aiSettings?.customEscalationMessage}`);
      console.log(`LLM Fallback enabled: ${company.aiSettings?.llmFallbackEnabled}`);
      
      // Update this company with proper settings
      const updateResult = await companiesCollection.updateOne(
        { _id: company._id },
        { 
          $set: { 
            'aiSettings.customEscalationMessage': "I understand you're having an issue. Let me connect you with one of our specialists who can help you right away.",
            'aiSettings.llmFallbackEnabled': true, // Enable LLM for better responses
            'aiSettings.fuzzyMatchThreshold': 0.3 // Lower threshold for better Q&A matching
          }
        }
      );
      
      console.log(`Updated company ${company.companyName} - modified: ${updateResult.modifiedCount}`);
      console.log('---');
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

// Run the script
findAndFixCompanies();
