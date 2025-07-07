#!/usr/bin/env node

// Script to check and fix company escalation messages
const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

async function checkCompanyData() {
  const client = new MongoClient(process.env.MONGODB_URI);
  
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const db = client.db();
    const companiesCollection = db.collection('companiesCollection');
    
    // Find the specific company from the logs
    const companyId = '686a680241806a4991f7367f';
    const company = await companiesCollection.findOne({ _id: new ObjectId(companyId) });
    
    if (company) {
      console.log('Company found:', company.companyName);
      console.log('Current AI Settings:', JSON.stringify(company.aiSettings, null, 2));
      
      // Update the company with proper settings
      const updateResult = await companiesCollection.updateOne(
        { _id: new ObjectId(companyId) },
        { 
          $set: { 
            'aiSettings.customEscalationMessage': "I understand you're having an issue with your thermostat. Let me connect you with one of our HVAC specialists who can help diagnose and resolve this for you.",
            'aiSettings.llmFallbackEnabled': true, // Enable LLM for better responses
            'aiSettings.fuzzyMatchThreshold': 0.3 // Lower threshold for better Q&A matching
          }
        }
      );
      
      console.log('Update result:', updateResult);
      
      // Verify the update
      const updatedCompany = await companiesCollection.findOne({ _id: new ObjectId(companyId) });
      console.log('Updated AI Settings:', JSON.stringify(updatedCompany.aiSettings, null, 2));
      
    } else {
      console.log('Company not found');
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

// Run the script
checkCompanyData();
