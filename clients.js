const { createClient } = require('redis');
let Pinecone;
try {
  ({ Pinecone } = require('@pinecone-database/pinecone'));
} catch (err) {
  Pinecone = class {
    index() { return {}; }
  };
}

// --- Initialize Redis Client ---
const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));
if (process.env.NODE_ENV !== 'test') {
  redisClient.connect().then(() => {
    console.log('Successfully connected to Redis.');
  }).catch(console.error);
}

// --- Initialize Pinecone Client ---
let pinecone = null;
if (process.env.PINECONE_API_KEY) {
  pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY,
  });
} else {
  console.warn('PINECONE_API_KEY is not set. Pinecone features will be disabled.');
}

const getPineconeIndex = () => {
  if (!pinecone) return null;
  return pinecone.index(process.env.PINECONE_INDEX);
};

module.exports = { redisClient, pinecone, getPineconeIndex };
