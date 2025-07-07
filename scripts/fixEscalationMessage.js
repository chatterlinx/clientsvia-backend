#!/usr/bin/env node

// Script to fix the custom escalation message in the database
const { MongoClient } = require('mongodb');
require('dotenv').config();

async function fixEscalationMessage() {
  const client = new MongoClient(process.env.MONGODB_URI);
  
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const db = client.db();
    const companiesCollection = db.collection('companiesCollection');
    
    // Find companies with the incorrect escalation message
    const companies = await companiesCollection.find({
      'aiSettings.customEscalationMessage': { $regex: /reading this from.*LLM Message/i }
    }).toArray();
    
    console.log(`Found ${companies.length} companies with incorrect escalation message`);
    
    // Update each company with a proper escalation message
    for (const company of companies) {
      const properMessage = "I'm unable to answer that right now, let me connect you to a team member who can help.";
      
      await companiesCollection.updateOne(
        { _id: company._id },
        { 
          $set: { 
            'aiSettings.customEscalationMessage': properMessage,
            'aiSettings.llmFallbackEnabled': true // Also enable LLM fallback for better responses
          }
        }
      );
      
      console.log(`Updated company ${company.companyName} (${company._id})`);
    }
    
    console.log('Escalation message fix completed');
    
  } catch (error) {
    console.error('Error fixing escalation message:', error);
  } finally {
    await client.close();
  }
}

// Run the script
fixEscalationMessage();
