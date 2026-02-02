/**
 * ════════════════════════════════════════════════════════════════════════════════
 * MIGRATION: Sync BookingRequest Indexes
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * Creates the unique_active_session_booking index that prevents duplicate
 * BookingRequests for the same session.
 * 
 * WHY THIS EXISTS:
 * Mongoose does NOT auto-create indexes in production (autoIndex: false).
 * This script manually creates the index to ensure idempotency works.
 * 
 * RUN THIS ONCE AFTER DEPLOY:
 *   node scripts/migrations/syncBookingRequestIndexes.js
 * 
 * OR via API (admin only):
 *   POST /api/admin/migrations/sync-booking-indexes
 * 
 * ════════════════════════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const mongoose = require('mongoose');
const BookingRequest = require('../../models/BookingRequest');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

async function syncIndexes() {
    console.log('════════════════════════════════════════════════════════════════');
    console.log('MIGRATION: Sync BookingRequest Indexes');
    console.log('════════════════════════════════════════════════════════════════');
    
    try {
        // Connect to MongoDB
        if (mongoose.connection.readyState !== 1) {
            console.log('Connecting to MongoDB...');
            await mongoose.connect(MONGO_URI);
            console.log('✅ Connected to MongoDB');
        }
        
        // Get existing indexes
        console.log('\n📋 Current indexes on bookingRequests:');
        const existingIndexes = await BookingRequest.collection.getIndexes();
        
        for (const [name, index] of Object.entries(existingIndexes)) {
            console.log(`  - ${name}: ${JSON.stringify(index.key)}`);
            if (index.unique) console.log(`    unique: true`);
            if (index.partialFilterExpression) {
                console.log(`    partialFilterExpression: ${JSON.stringify(index.partialFilterExpression)}`);
            }
        }
        
        // Check if our index exists
        const hasIdempotencyIndex = existingIndexes['unique_active_session_booking'];
        
        if (hasIdempotencyIndex) {
            console.log('\n✅ unique_active_session_booking index already exists');
        } else {
            console.log('\n⚠️ unique_active_session_booking index NOT FOUND - creating...');
            
            // Create the index manually
            await BookingRequest.collection.createIndex(
                { sessionId: 1 },
                {
                    unique: true,
                    partialFilterExpression: {
                        sessionId: { $ne: null },
                        status: { $ne: 'CANCELLED' }
                    },
                    name: 'unique_active_session_booking',
                    background: true  // Don't block other operations
                }
            );
            
            console.log('✅ unique_active_session_booking index CREATED');
        }
        
        // Sync all indexes from schema (creates any missing ones)
        console.log('\n🔄 Running syncIndexes() for all schema indexes...');
        await BookingRequest.syncIndexes();
        console.log('✅ All indexes synced');
        
        // Verify final state
        console.log('\n📋 Final indexes on bookingRequests:');
        const finalIndexes = await BookingRequest.collection.getIndexes();
        
        for (const [name, index] of Object.entries(finalIndexes)) {
            const isIdempotency = name === 'unique_active_session_booking';
            console.log(`  ${isIdempotency ? '🔒' : '-'} ${name}: ${JSON.stringify(index.key)}`);
        }
        
        console.log('\n════════════════════════════════════════════════════════════════');
        console.log('MIGRATION COMPLETE');
        console.log('════════════════════════════════════════════════════════════════');
        
        return { success: true, indexCount: Object.keys(finalIndexes).length };
        
    } catch (error) {
        console.error('\n❌ Migration failed:', error.message);
        throw error;
    }
}

// Run if executed directly
if (require.main === module) {
    syncIndexes()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}

module.exports = { syncIndexes };
