// admin-dashboard/db.js
const mongoose = require('mongoose'); // <<< ADD MONGOOSE
const { MongoClient } = require('mongodb'); // Keep if you have other parts strictly needing a separate native client, otherwise Mongoose's client can be used.

// const dotenv = require('dotenv');

// Load environment variables from .env file
// dotenv.config();

const uri = process.env.MONGODB_URI;
let dbInstance = null; // This will now be derived from Mongoose or can be the separate MongoClient if needed.

/**
 * Connects to the MongoDB database using Mongoose.
 * Also makes the native DB instance available via Mongoose's connection.
 */
const connectDB = async () => {
    if (mongoose.connection.readyState === 1 && dbInstance) { // 1 === connected
        // console.log('[Mongoose & MongoDB Connection] Using existing connections.');
        return dbInstance; // Or just return, as Mongoose handles its own singleton
    }

    if (!uri) {
        console.error('[MongoDB Connection] MONGODB_URI is not defined in .env file.');
        throw new Error('MONGODB_URI is not defined.');
    }

    try {
        // --- ESTABLISH MONGOOSE CONNECTION ---
        await mongoose.connect(uri, {
            // useNewUrlParser: true, // Deprecated in Mongoose 6+
            // useUnifiedTopology: true, // Deprecated in Mongoose 6+
            // serverSelectionTimeoutMS: 30000, // Optional: Increase timeout
            // socketTimeoutMS: 45000, // Optional
        });
        console.log('[Mongoose Connection] [OK] Successfully connected to MongoDB via Mongoose!');

        // Make the native 'Db' object available from Mongoose's connection
        // This dbInstance will be compatible with code expecting a native Db object.
        dbInstance = mongoose.connection.db;

        // If you absolutely need a separate MongoClient connection for some reason,
        // you could keep your original MongoClient logic here, but it's usually better
        // to use Mongoose's underlying connection if Mongoose is primary.
        // For example:
        // const client = new MongoClient(uri);
        // await client.connect();
        // const nativeDb = client.db(); // This would be a separate connection pool
        // console.log('[Native MongoClient] [OK] Successfully connected to MongoDB!');
        // dbInstance = nativeDb; // If you prefer to keep this as the source for getDB()

        return dbInstance; // Or just fulfill promise, Mongoose connection is global

    } catch (e) {
        console.error('[Mongoose/MongoDB Connection] [ERROR] Failed to connect:', e.message);
        console.error(e.stack); // Log full stack for more details
        throw e; // Re-throw the error so the caller (e.g., index.js) can be aware
    }
};

/**
 * Returns the active native database instance (from Mongoose's connection).
 * Throws an error if Mongoose is not connected.
 */
const getDB = () => {
    if (mongoose.connection.readyState !== 1) { // 1 means connected
        console.error('[MongoDB getDB] Mongoose is not connected. Ensure connectDB() was called successfully.');
        throw new Error('Database not initialized (Mongoose not connected).');
    }
    return mongoose.connection.db; // Return the native Db instance from Mongoose
};

// Export both functions
module.exports = { connectDB, getDB };
