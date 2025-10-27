/**
 * ============================================================================
 * CLEAR BEHAVIORS - FOR TESTING NOTIFICATION SYSTEM
 * ============================================================================
 * Temporarily clears behaviors to test empty state detection
 * Run seed-behaviors-quick.js afterwards to restore
 * ============================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');
const GlobalAIBehaviorTemplate = require('../models/GlobalAIBehaviorTemplate');

async function clearBehaviors() {
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');

        const count = await GlobalAIBehaviorTemplate.countDocuments();
        console.log(`📊 Current behaviors in database: ${count}`);

        if (count === 0) {
            console.log('⚠️  Database already empty - nothing to clear');
            process.exit(0);
        }

        console.log('🗑️  Clearing all behaviors...');
        const result = await GlobalAIBehaviorTemplate.deleteMany({});
        
        console.log(`✅ Cleared ${result.deletedCount} behaviors`);
        console.log('');
        console.log('🧪 TEST INSTRUCTIONS:');
        console.log('   1. Refresh the Global AI Brain page');
        console.log('   2. Click the Behaviors tab');
        console.log('   3. Check Notification Center for alert');
        console.log('   4. Run: node scripts/seed-behaviors-quick.js to restore');
        console.log('');
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Clear failed:', error);
        process.exit(1);
    }
}

clearBehaviors();

