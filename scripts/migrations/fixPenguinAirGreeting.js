/**
 * ============================================================================
 * FIX PENGUIN AIR GREETING
 * ============================================================================
 * 
 * Sets the optimal greeting for Penguin Air (Golden HVAC Blueprint):
 * - Ultra-short for fast TTS (~2s)
 * - Contains {{companyName}} placeholder
 * - Passes all lint rules
 * 
 * Run: node scripts/migrations/fixPenguinAirGreeting.js
 * 
 * ============================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { standardizePlaceholders } = require('../../utils/placeholderStandard');

const PENGUIN_AIR_ID = '68e3f77a9d623b8058c700c4';

// OPTIMAL GREETING (5 words, ~2s TTS, has placeholder)
const OPTIMAL_GREETING = '{{companyName}} — how can I help?';

// Alternative (7 words, ~2.5s TTS)
const ALTERNATIVE_GREETING = 'Thanks for calling {{companyName}} — how can I help?';

async function main() {
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log('FIX PENGUIN AIR GREETING');
    console.log('═══════════════════════════════════════════════════════════════════════════\n');
    
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!mongoUri) {
        console.error('❌ No MongoDB URI found. Set MONGODB_URI or MONGO_URI env var.');
        process.exit(1);
    }
    
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');
    
    const Company = require('../../models/v2Company');
    
    const company = await Company.findById(PENGUIN_AIR_ID);
    if (!company) {
        console.error(`❌ Company not found: ${PENGUIN_AIR_ID}`);
        await mongoose.disconnect();
        process.exit(1);
    }
    
    console.log(`📍 Company: ${company.companyName}`);
    console.log(`📍 ID: ${company._id}\n`);
    
    // Show current state
    console.log('CURRENT GREETING LOCATIONS:');
    console.log('─────────────────────────────────────────────────────────────────────────────');
    console.log(`connectionMessages.voice.text:          ${company.connectionMessages?.voice?.text || '(empty)'}`);
    console.log(`connectionMessages.voice.realtime.text: ${company.connectionMessages?.voice?.realtime?.text || '(empty)'}`);
    console.log(`frontDeskBehavior.greeting:             ${JSON.stringify(company.frontDeskBehavior?.greeting) || '(empty)'}`);
    console.log(`callFlowEngine.style.greeting:          ${company.callFlowEngine?.style?.greeting || '(empty)'}`);
    console.log('');
    
    // Use the short optimal greeting
    const newGreeting = OPTIMAL_GREETING;
    console.log(`📝 NEW GREETING: "${newGreeting}"`);
    console.log(`   Words: ${newGreeting.split(/\s+/).length}`);
    console.log(`   Est. TTS: ~${(newGreeting.split(/\s+/).length * 0.4).toFixed(1)}s`);
    console.log('');
    
    // Initialize paths
    if (!company.connectionMessages) company.connectionMessages = {};
    if (!company.connectionMessages.voice) company.connectionMessages.voice = {};
    if (!company.connectionMessages.voice.realtime) company.connectionMessages.voice.realtime = {};
    
    // Set canonical paths
    company.connectionMessages.voice.text = newGreeting;
    company.connectionMessages.voice.realtime.text = newGreeting;
    
    // Clear legacy paths (mark as deprecated)
    if (company.frontDeskBehavior?.greeting) {
        console.log('🗑️  Clearing frontDeskBehavior.greeting (legacy)');
        company.frontDeskBehavior.greeting = null;
    }
    
    if (company.callFlowEngine?.style?.greeting) {
        console.log('🗑️  Clearing callFlowEngine.style.greeting (legacy)');
        company.callFlowEngine.style.greeting = null;
    }
    
    // Save
    await company.save();
    console.log('\n✅ Greeting updated successfully!\n');
    
    // Verify
    const updated = await Company.findById(PENGUIN_AIR_ID);
    console.log('VERIFIED GREETING LOCATIONS:');
    console.log('─────────────────────────────────────────────────────────────────────────────');
    console.log(`connectionMessages.voice.text:          ${updated.connectionMessages?.voice?.text}`);
    console.log(`connectionMessages.voice.realtime.text: ${updated.connectionMessages?.voice?.realtime?.text}`);
    console.log(`frontDeskBehavior.greeting:             ${updated.frontDeskBehavior?.greeting || '(cleared)'}`);
    console.log(`callFlowEngine.style.greeting:          ${updated.callFlowEngine?.style?.greeting || '(cleared)'}`);
    console.log('');
    
    // Clear Redis cache if available
    try {
        const redisClient = require('../../config/redis');
        if (redisClient?.isOpen) {
            await redisClient.del(`company:${PENGUIN_AIR_ID}`);
            console.log('🗑️  Redis cache cleared\n');
        }
    } catch (e) {
        console.log('⚠️  Redis not available, skip cache clear\n');
    }
    
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log('DONE - Now refresh Control Plane and run Lint to verify');
    console.log('═══════════════════════════════════════════════════════════════════════════');
    
    await mongoose.disconnect();
}

main().catch(err => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
});
