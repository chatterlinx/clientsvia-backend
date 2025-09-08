#!/usr/bin/env node

/**
 * Migration Script: Add Trade Categories to Existing Q&As
 * Fixes the mongoose/redis migration issue where Q&A data exists but lacks tradeCategories field
 */

const { MongoClient } = require('mongodb');

async function migrateQnAData() {
  let client;
  try {
    client = new MongoClient(process.env.MONGODB_URI || 'mongodb://localhost:27017/clientsvia');
    await client.connect();
    console.log('✅ Connected to MongoDB');
    
    const db = client.db();
    const tradeCollection = db.collection('enterprisetradeCategories');
    
    // Create sample trade categories for the global view
    const categories = [
      {
        name: 'HVAC Residential',
        description: 'Hvac Residential only',
        companyId: 'global',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Plumbing',
        description: 'Plumbing services and repairs',
        companyId: 'global', 
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Electrical',
        description: 'Electrical installation and repair services',
        companyId: 'global',
        createdAt: new Date(), 
        updatedAt: new Date()
      }
    ];
    
    console.log('📋 Creating trade categories...');
    // Insert categories if they don't exist
    for (const category of categories) {
      const existing = await tradeCollection.findOne({ name: category.name, companyId: 'global' });
      if (!existing) {
        await tradeCollection.insertOne(category);
        console.log(`✅ Created trade category: ${category.name}`);
      } else {
        console.log(`ℹ️ Trade category already exists: ${category.name}`);
      }
    }
    
    // Now update existing Q&As to add tradeCategories field
    const qnaCollection = db.collection('qna');
    const qnas = await qnaCollection.find({}).toArray();
    
    console.log(`\n🔄 Migrating ${qnas.length} Q&As to add tradeCategories...`);
    
    for (const qna of qnas) {
      // Analyze the Q&A content to determine appropriate trade categories
      let tradeCategories = [];
      const text = `${qna.question} ${qna.answer}`.toLowerCase();
      
      if (text.includes('hvac') || text.includes('heating') || text.includes('cooling') || text.includes('air conditioning')) {
        tradeCategories.push('HVAC Residential');
      }
      if (text.includes('plumb') || text.includes('pipe') || text.includes('drain') || text.includes('water')) {
        tradeCategories.push('Plumbing');
      }
      if (text.includes('electric') || text.includes('wire') || text.includes('outlet') || text.includes('circuit')) {
        tradeCategories.push('Electrical');
      }
      
      // If no specific trade detected, default to HVAC since the sample data seems HVAC-related
      if (tradeCategories.length === 0) {
        tradeCategories.push('HVAC Residential');
      }
      
      // Update the Q&A with trade categories and other missing fields
      await qnaCollection.updateOne(
        { _id: qna._id },
        { 
          $set: { 
            tradeCategories: tradeCategories,
            status: 'active',
            keywords: qna.keywords || [],
            usageCount: qna.usageCount || 0
          }
        }
      );
      
      console.log(`✅ Updated Q&A: ${qna.question.substring(0, 50)}... → [${tradeCategories.join(', ')}]`);
    }
    
    console.log('\n🎉 Migration completed successfully!');
    
    // Verify the migration
    const updatedQnas = await qnaCollection.find({ tradeCategories: { $exists: true } }).toArray();
    console.log(`📊 Verification: ${updatedQnas.length} Q&As now have tradeCategories field`);
    
    const tradeCount = await tradeCollection.countDocuments({ companyId: 'global' });
    console.log(`📊 Verification: ${tradeCount} global trade categories created`);
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
    }
  }
}

// Run the migration
migrateQnAData().then(() => {
  console.log('🚀 Migration script completed');
  process.exit(0);
}).catch(error => {
  console.error('💥 Migration script failed:', error);
  process.exit(1);
});
