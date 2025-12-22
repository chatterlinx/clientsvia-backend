/**
 * ============================================================================
 * FIX PENGUIN AIR GREETING (HARD SET)
 * ============================================================================
 * 
 * PROBLEM: The snapshot was checking frontDeskBehavior.greeting BEFORE
 *          connectionMessages.voice.text, so the old greeting kept winning.
 * 
 * SOLUTION: 
 * 1. Set connectionMessages.voice.text (CANONICAL)
 * 2. CLEAR frontDeskBehavior.greeting (LEGACY - was overriding canonical!)
 * 3. CLEAR any other legacy paths
 * 
 * Run: node scripts/migrations/fixPenguinAirGreeting.js
 * 
 * ============================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');

const PENGUIN_AIR_ID = '68e3f77a9d623b8058c700c4';

// OPTIMAL GREETING (5 words, ~2s TTS, has placeholder)
const OPTIMAL_GREETING = '{{companyName}} — how can I help?';

async function main() {
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log('FIX PENGUIN AIR GREETING (HARD SET + CLEAR LEGACY)');
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
    console.log('CURRENT GREETING LOCATIONS (BEFORE FIX):');
    console.log('─────────────────────────────────────────────────────────────────────────────');
    console.log(`1. connectionMessages.voice.text:          "${company.connectionMessages?.voice?.text || '(empty)'}"`);
    console.log(`2. connectionMessages.voice.realtime.text: "${company.connectionMessages?.voice?.realtime?.text || '(empty)'}"`);
    console.log(`3. frontDeskBehavior.greeting:             "${company.frontDeskBehavior?.greeting || '(empty)'}" ← LEGACY (was winning!)`);
    console.log(`4. callFlowEngine.style.greeting:          "${company.callFlowEngine?.style?.greeting || '(empty)'}"`);
    console.log(`5. aiAgentSettings.greeting:               "${company.aiAgentSettings?.greeting || '(empty)'}"`);
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
    
    // ═══════════════════════════════════════════════════════════════════════════
    // 1. SET CANONICAL PATHS
    // ═══════════════════════════════════════════════════════════════════════════
    company.connectionMessages.voice.text = newGreeting;
    company.connectionMessages.voice.realtime.text = newGreeting;
    console.log('✅ Set connectionMessages.voice.text = new greeting');
    console.log('✅ Set connectionMessages.voice.realtime.text = new greeting');
    
    // ═══════════════════════════════════════════════════════════════════════════
    // 2. CLEAR ALL LEGACY PATHS (CRITICAL - these were overriding canonical!)
    // ═══════════════════════════════════════════════════════════════════════════
    
    // frontDeskBehavior.greeting (THE CULPRIT)
    if (company.frontDeskBehavior) {
        if (company.frontDeskBehavior.greeting) {
            console.log(`🗑️  CLEARING frontDeskBehavior.greeting (was: "${company.frontDeskBehavior.greeting}")`);
            company.frontDeskBehavior.greeting = null;
        }
        // Also check nested greeting object
        if (company.frontDeskBehavior.greeting?.text) {
            console.log(`🗑️  CLEARING frontDeskBehavior.greeting.text`);
            company.frontDeskBehavior.greeting = null;
        }
    }
    
    // callFlowEngine.style.greeting
    if (company.callFlowEngine?.style?.greeting) {
        console.log(`🗑️  CLEARING callFlowEngine.style.greeting (was: "${company.callFlowEngine.style.greeting}")`);
        company.callFlowEngine.style.greeting = null;
    }
    
    // aiAgentSettings.greeting (if exists)
    if (company.aiAgentSettings?.greeting) {
        console.log(`🗑️  CLEARING aiAgentSettings.greeting`);
        company.aiAgentSettings.greeting = null;
    }
    
    // aiAgentSettings.frontDeskBehavior.greeting (nested)
    if (company.aiAgentSettings?.frontDeskBehavior?.greeting) {
        console.log(`🗑️  CLEARING aiAgentSettings.frontDeskBehavior.greeting`);
        company.aiAgentSettings.frontDeskBehavior.greeting = null;
    }
    
    // profile.greeting (if exists)
    if (company.profile?.greeting) {
        console.log(`🗑️  CLEARING profile.greeting`);
        company.profile.greeting = null;
    }
    
    // greeting at root (if exists)
    if (company.greeting) {
        console.log(`🗑️  CLEARING company.greeting (root)`);
        company.greeting = null;
    }
    
    console.log('');
    
    // ═══════════════════════════════════════════════════════════════════════════
    // 3. SAVE
    // ═══════════════════════════════════════════════════════════════════════════
    await company.save();
    console.log('✅ Saved to MongoDB!\n');
    
    // ═══════════════════════════════════════════════════════════════════════════
    // 4. VERIFY (re-read from DB)
    // ═══════════════════════════════════════════════════════════════════════════
    const updated = await Company.findById(PENGUIN_AIR_ID);
    console.log('VERIFIED GREETING LOCATIONS (AFTER FIX):');
    console.log('─────────────────────────────────────────────────────────────────────────────');
    console.log(`1. connectionMessages.voice.text:          "${updated.connectionMessages?.voice?.text}" ← CANONICAL ✅`);
    console.log(`2. connectionMessages.voice.realtime.text: "${updated.connectionMessages?.voice?.realtime?.text}"`);
    console.log(`3. frontDeskBehavior.greeting:             "${updated.frontDeskBehavior?.greeting || '(CLEARED)'}"`);
    console.log(`4. callFlowEngine.style.greeting:          "${updated.callFlowEngine?.style?.greeting || '(CLEARED)'}"`);
    console.log('');
    
    // ═══════════════════════════════════════════════════════════════════════════
    // 5. CLEAR REDIS CACHE
    // ═══════════════════════════════════════════════════════════════════════════
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
    console.log('DONE!');
    console.log('');
    console.log('NEXT STEPS:');
    console.log('1. Refresh Control Plane UI');
    console.log('2. Check Greeting Optimizer shows: "{{companyName}} — how can I help?"');
    console.log('3. Run Lint - HAS_COMPANY_NAME should PASS');
    console.log('4. Verify greetingSource = "connectionMessages.voice" (not frontDeskBehavior)');
    console.log('═══════════════════════════════════════════════════════════════════════════');
    
    await mongoose.disconnect();
}

main().catch(err => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
});
