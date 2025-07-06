// Script to update all companies to use gemini-2.5-flash for aiSettings.model
// Usage: node scripts/fix_gemini_model.js

const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/your-db-name';
// Correctly extract DB_NAME from URI (handles query string)
const DB_NAME = MONGODB_URI.split('/')[3].split('?')[0];

async function main() {
  const client = new MongoClient(MONGODB_URI, { useUnifiedTopology: true });
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const result = await db.collection('companiesCollection').updateMany(
      { 'aiSettings.model': { $ne: 'gemini-2.5-flash' } },
      { $set: { 'aiSettings.model': 'gemini-2.5-flash' } }
    );
    console.log(`Updated ${result.modifiedCount} companies to gemini-2.5-flash.`);
  } catch (err) {
    console.error('Error updating companies:', err);
  } finally {
    await client.close();
  }
}

main();
