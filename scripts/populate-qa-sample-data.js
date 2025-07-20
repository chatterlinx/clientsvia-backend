// scripts/populate-qa-sample-data.js
const mongoose = require('mongoose');
const CompanyQnA = require('../models/CompanyQnA');
const TradeQnA = require('../models/TradeQnA');

// Sample company Q&A data
const sampleCompanyQAs = [
  {
    question: "What are your business hours?",
    answer: "We are open Monday-Friday 8AM-6PM, Saturday 9AM-4PM, and closed on Sundays.",
    keywords: ["hours", "open", "schedule", "time"]
  },
  {
    question: "Do you offer emergency services?",
    answer: "Yes, we provide 24/7 emergency services for urgent HVAC issues. Emergency rates apply.",
    keywords: ["emergency", "24/7", "urgent", "after hours"]
  },
  {
    question: "What is your warranty policy?",
    answer: "We offer a 1-year warranty on all labor and honor manufacturer warranties on parts.",
    keywords: ["warranty", "guarantee", "coverage", "protection"]
  },
  {
    question: "Do you provide free estimates?",
    answer: "Yes, we provide free estimates for all new installations and major repairs.",
    keywords: ["estimate", "quote", "free", "pricing", "cost"]
  }
];

// Sample trade Q&A data for HVAC
const sampleTradeQAs = [
  {
    tradeCategory: "HVAC",
    question: "How often should I change my air filter?",
    answer: "Air filters should typically be changed every 1-3 months, depending on usage and filter type.",
    keywords: ["filter", "change", "replace", "maintenance"]
  },
  {
    tradeCategory: "HVAC",
    question: "Why is my AC not cooling properly?",
    answer: "Common causes include dirty filters, low refrigerant, blocked vents, or thermostat issues.",
    keywords: ["cooling", "not cold", "warm air", "ac problem"]
  },
  {
    tradeCategory: "HVAC",
    question: "What size AC unit do I need?",
    answer: "AC size depends on square footage, insulation, windows, and climate. A professional assessment is recommended.",
    keywords: ["size", "tonnage", "capacity", "btu"]
  },
  {
    tradeCategory: "Plumbing",
    question: "How do I fix a leaky faucet?",
    answer: "First turn off water supply, then check washers, O-rings, and valve seats for wear or damage.",
    keywords: ["leak", "faucet", "drip", "repair"]
  }
];

async function populateQAData() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/clientsvia');
    
    console.log('🗑️  Clearing existing Q&A data...');
    await CompanyQnA.deleteMany({});
    await TradeQnA.deleteMany({});
    
    // For demo, we'll use a sample company ID (replace with actual company ID)
    const sampleCompanyId = new mongoose.Types.ObjectId();
    
    console.log('📝 Adding sample company Q&As...');
    const companyQAs = sampleCompanyQAs.map(qa => ({
      ...qa,
      companyId: sampleCompanyId
    }));
    await CompanyQnA.insertMany(companyQAs);
    
    console.log('🔧 Adding sample trade Q&As...');
    await TradeQnA.insertMany(sampleTradeQAs);
    
    console.log('✅ Sample Q&A data populated successfully!');
    console.log(`📊 Added ${companyQAs.length} company Q&As and ${sampleTradeQAs.length} trade Q&As`);
    console.log(`🏢 Sample Company ID: ${sampleCompanyId}`);
    
  } catch (error) {
    console.error('❌ Error populating Q&A data:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Run if called directly
if (require.main === module) {
  populateQAData();
}

module.exports = { populateQAData };
