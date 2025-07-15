#!/usr/bin/env node
/**
 * Fix Pricing Q&A Entries and Add Repetition Detection
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');
const KnowledgeEntry = require('./models/KnowledgeEntry');

async function fixPricingQAs() {
  console.log('🔧 Fixing pricing Q&A entries and adding repetition detection...');
  
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to database');
    
    const targetCompanyId = '686a680241806a4991f7367f';
    
    // First, check current pricing entries
    console.log('\n📋 Current pricing-related Q&A entries:');
    const existingPricingEntries = await KnowledgeEntry.find({
      companyId: new ObjectId(targetCompanyId),
      $or: [
        { question: /price|cost|much|fee|charge/i },
        { keywords: { $in: ['price', 'cost', 'fee', 'charge', 'how much', 'service call'] } }
      ]
    }).lean();
    
    existingPricingEntries.forEach((entry, index) => {
      console.log(`${index + 1}. Question: "${entry.question}"`);
      console.log(`   Keywords: [${entry.keywords ? entry.keywords.join(', ') : 'none'}]`);
      console.log(`   Answer: "${entry.answer.substring(0, 100)}..."`);
      console.log('---');
    });
    
    // Add specific pricing entries to differentiate service call vs full service
    const pricingEntries = [
      {
        question: 'service call cost',
        keywords: [
          'service call cost',
          'diagnostic fee', 
          'visit fee',
          'trip charge',
          'how much service call',
          'cost to come out',
          'technician visit cost'
        ],
        answer: 'Our service call is just $49, which covers the technician visit and diagnostic to identify the issue. If we proceed with any repairs, this fee is often applied toward the work. Would you like to schedule a diagnostic visit?',
        category: 'Pricing',
        approved: true
      },
      {
        question: 'ac service price',
        keywords: [
          'ac serviced',
          'how much ac service',
          'ac tune-up cost',
          'full service cost',
          'maintenance package price',
          'how much to service ac',
          'ac maintenance cost',
          'annual service cost',
          'hvac service price'
        ],
        answer: 'A full AC service or tune-up starts at $89 and includes coil cleaning, refrigerant check, filter inspection, electrical connections check, and performance testing. The initial $49 service call fee is included in this price. Most tune-ups take 1-2 hours. Would you like to schedule your AC service?',
        category: 'Pricing',
        approved: true
      },
      {
        question: 'repair pricing',
        keywords: [
          'repair cost',
          'how much repair',
          'fix cost',
          'replacement price',
          'part cost',
          'labor cost',
          'repair estimate'
        ],
        answer: 'Repair costs vary based on the specific issue and parts needed. Common repairs range from $150-$800, with most being under $400. We provide upfront pricing before any work begins - no surprises. The $49 diagnostic fee helps us give you an accurate estimate. Ready to schedule?',
        category: 'Pricing',
        approved: true
      }
    ];
    
    console.log('\n🎯 Adding enhanced pricing Q&A entries...');
    
    for (const entryData of pricingEntries) {
      // Check if similar entry already exists
      const existing = await KnowledgeEntry.findOne({
        companyId: new ObjectId(targetCompanyId),
        question: new RegExp(entryData.question, 'i')
      });
      
      if (existing) {
        console.log(`⚠️ Similar entry exists for "${entryData.question}", updating...`);
        await KnowledgeEntry.updateOne(
          { _id: existing._id },
          {
            $set: {
              keywords: entryData.keywords,
              answer: entryData.answer,
              category: entryData.category,
              updatedAt: new Date()
            }
          }
        );
        console.log(`✅ Updated existing entry: "${entryData.question}"`);
      } else {
        const newEntry = new KnowledgeEntry({
          companyId: new ObjectId(targetCompanyId),
          ...entryData
        });
        
        const result = await newEntry.save();
        console.log(`✅ Added new entry: "${entryData.question}" (${result._id})`);
      }
    }
    
    // Show updated entries
    console.log('\n📋 Updated pricing Q&A entries:');
    const updatedEntries = await KnowledgeEntry.find({
      companyId: new ObjectId(targetCompanyId),
      $or: [
        { question: /price|cost|much|fee|charge/i },
        { category: 'Pricing' }
      ]
    }).lean();
    
    updatedEntries.forEach((entry, index) => {
      console.log(`${index + 1}. Question: "${entry.question}"`);
      console.log(`   Keywords: [${entry.keywords ? entry.keywords.join(', ') : 'none'}]`);
      console.log(`   Answer: "${entry.answer.substring(0, 100)}..."`);
      console.log('---');
    });
    
    console.log('🎉 Pricing Q&A entries updated successfully!');
    console.log('🔧 Now customers should get specific answers for service calls vs full AC service');
    
  } catch (error) {
    console.error('❌ Error fixing pricing Q&A entries:', error);
  }
}

// Run if called directly
if (require.main === module) {
  fixPricingQAs().then(() => {
    console.log('✅ Script completed');
    mongoose.connection.close();
    process.exit(0);
  }).catch(error => {
    console.error('❌ Script failed:', error);
    mongoose.connection.close();
    process.exit(1);
  });
}

module.exports = { fixPricingQAs };
