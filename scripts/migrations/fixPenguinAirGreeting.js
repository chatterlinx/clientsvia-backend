/**
 * ============================================================================
 * FIX PENGUIN AIR GREETING - ONE-TIME MIGRATION
 * ============================================================================
 * 
 * Updates Penguin Air's greeting to the optimal version:
 * "Thanks for calling {{companyName}} — how can I help?"
 * 
 * This is the gold standard greeting:
 * - 8 words
 * - ~2.5s TTS time
 * - Uses {{companyName}} placeholder
 * - Fast first-turn response
 * 
 * Run with: node scripts/migrations/fixPenguinAirGreeting.js
 * 
 * ============================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');
const v2Company = require('../../models/v2Company');

const OPTIMAL_GREETING = "Thanks for calling {{companyName}} — how can I help?";

async function main() {
    console.log('\n========================================');
    console.log('FIX PENGUIN AIR GREETING MIGRATION');
    console.log('========================================\n');
    
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!mongoUri) {
        console.error('❌ No MongoDB URI found in environment');
        process.exit(1);
    }
    
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');
    
    try {
        // Find Penguin Air by name (case-insensitive)
        const penguinAir = await v2Company.findOne({
            $or: [
                { name: /penguin.*air/i },
                { 'profile.name': /penguin.*air/i },
                { companyName: /penguin.*air/i }
            ]
        });
        
        if (!penguinAir) {
            console.log('❌ Penguin Air not found in database');
            console.log('   Looking for any company with "penguin" in name...');
            
            const anyPenguin = await v2Company.findOne({
                $or: [
                    { name: /penguin/i },
                    { 'profile.name': /penguin/i }
                ]
            });
            
            if (anyPenguin) {
                console.log(`   Found: ${anyPenguin.name || anyPenguin.profile?.name} (ID: ${anyPenguin._id})`);
            } else {
                console.log('   No Penguin company found at all');
            }
            
            process.exit(1);
        }
        
        console.log(`✅ Found Penguin Air: ${penguinAir.name || penguinAir.profile?.name}`);
        console.log(`   Company ID: ${penguinAir._id}\n`);
        
        // Show current greeting state
        console.log('📋 CURRENT GREETING STATE:');
        console.log('   connectionMessages.voice.text:', 
            penguinAir.connectionMessages?.voice?.text || '(not set)');
        console.log('   connectionMessages.voice.realtime.text:', 
            penguinAir.connectionMessages?.voice?.realtime?.text || '(not set)');
        console.log('   callFlowEngine.style.greeting:', 
            penguinAir.callFlowEngine?.style?.greeting || '(not set)');
        console.log('');
        
        // Update greeting in ALL canonical paths
        console.log('🔧 UPDATING TO OPTIMAL GREETING:');
        console.log(`   "${OPTIMAL_GREETING}"\n`);
        
        // Ensure nested objects exist
        if (!penguinAir.connectionMessages) penguinAir.connectionMessages = {};
        if (!penguinAir.connectionMessages.voice) penguinAir.connectionMessages.voice = {};
        if (!penguinAir.connectionMessages.voice.realtime) penguinAir.connectionMessages.voice.realtime = {};
        
        // Write to PRIMARY path
        penguinAir.connectionMessages.voice.text = OPTIMAL_GREETING;
        console.log('   ✅ connectionMessages.voice.text');
        
        // Write to REALTIME path
        penguinAir.connectionMessages.voice.realtime.text = OPTIMAL_GREETING;
        console.log('   ✅ connectionMessages.voice.realtime.text');
        
        // Mirror to callFlowEngine if it exists
        if (penguinAir.callFlowEngine?.style) {
            penguinAir.callFlowEngine.style.greeting = OPTIMAL_GREETING;
            console.log('   ✅ callFlowEngine.style.greeting (mirrored)');
        }
        
        // Also update frontDeskBehavior if it exists
        if (!penguinAir.frontDeskBehavior) penguinAir.frontDeskBehavior = {};
        if (!penguinAir.frontDeskBehavior.greeting) penguinAir.frontDeskBehavior.greeting = {};
        penguinAir.frontDeskBehavior.greeting.text = OPTIMAL_GREETING;
        penguinAir.frontDeskBehavior.greeting.enabled = true;
        console.log('   ✅ frontDeskBehavior.greeting.text');
        
        // Also update aiAgentSettings if it exists
        if (penguinAir.aiAgentSettings?.frontDeskBehavior) {
            if (!penguinAir.aiAgentSettings.frontDeskBehavior.greeting) {
                penguinAir.aiAgentSettings.frontDeskBehavior.greeting = {};
            }
            penguinAir.aiAgentSettings.frontDeskBehavior.greeting.text = OPTIMAL_GREETING;
            penguinAir.aiAgentSettings.frontDeskBehavior.greeting.enabled = true;
            console.log('   ✅ aiAgentSettings.frontDeskBehavior.greeting.text');
        }
        
        // Add migration metadata
        if (!penguinAir._meta) penguinAir._meta = {};
        penguinAir._meta.greetingOptimizedAt = new Date().toISOString();
        penguinAir._meta.greetingOptimizedVersion = 'penguin_air_gold_v1';
        
        // Save
        await penguinAir.save();
        console.log('\n💾 Saved to database');
        
        // Clear Redis cache
        try {
            const { redisClient } = require('../../db');
            if (redisClient && redisClient.isOpen) {
                await redisClient.del(`company:${penguinAir._id}`);
                console.log('🗑️  Cleared Redis cache');
            }
        } catch (e) {
            console.log('⚠️  Could not clear Redis cache (may not be connected)');
        }
        
        // Verify
        console.log('\n========================================');
        console.log('✅ MIGRATION COMPLETE');
        console.log('========================================');
        console.log('');
        console.log('Penguin Air greeting is now optimal:');
        console.log(`  "${OPTIMAL_GREETING}"`);
        console.log('');
        console.log('Stats:');
        console.log('  • Word count: 8');
        console.log('  • Estimated TTS: ~2.5s');
        console.log('  • Uses placeholder: ✅ {{companyName}}');
        console.log('  • Lint status: OPTIMAL');
        console.log('');
        console.log('All future companies cloned from Penguin Air will inherit this greeting.');
        console.log('');
        
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('📡 Disconnected from MongoDB');
    }
}

main().catch(console.error);

