const { connectDB } = require('../db');
const KnowledgeEntry = require('../models/KnowledgeEntry');

(async () => {
  try {
    await connectDB();
    await KnowledgeEntry.collection.createIndex({ category: 1, question: 1 });
    console.log('KnowledgeEntry compound index created');
    process.exit(0);
  } catch (err) {
    console.error('Failed to create KnowledgeEntry index:', err);
    process.exit(1);
  }
})();
