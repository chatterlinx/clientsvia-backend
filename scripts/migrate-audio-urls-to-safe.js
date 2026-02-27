#!/usr/bin/env node
/**
 * ============================================================================
 * MIGRATE AUDIO URLS TO /audio-safe
 * ============================================================================
 * 
 * Updates all existing audio URLs from /audio to /audio-safe for MongoDB fallback
 * 
 * USAGE:
 *   node scripts/migrate-audio-urls-to-safe.js
 * 
 * ============================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function migrateAudioUrls() {
    console.log('🔄 Starting audio URL migration...');
    console.log('━'.repeat(80));
    
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');
        
        const db = mongoose.connection.db;
        
        // ════════════════════════════════════════════════════════════════════════
        // MIGRATE TRIGGER AUDIO
        // ════════════════════════════════════════════════════════════════════════
        
        console.log('\n📢 Migrating Trigger Audio URLs...');
        const triggerAudioResult = await db.collection('triggeraudios').updateMany(
            { audioUrl: /^\/audio\/instant-lines\// },
            [{
                $set: {
                    audioUrl: {
                        $replaceOne: {
                            input: "$audioUrl",
                            find: "/audio/instant-lines/",
                            replacement: "/audio-safe/instant-lines/"
                        }
                    }
                }
            }]
        );
        
        console.log(`✅ Trigger Audio: ${triggerAudioResult.modifiedCount} URLs updated`);
        
        // ════════════════════════════════════════════════════════════════════════
        // MIGRATE GREETING AUDIO
        // ════════════════════════════════════════════════════════════════════════
        
        console.log('\n👋 Migrating Greeting Audio URLs...');
        const greetingAudioResult = await db.collection('greetingaudios').updateMany(
            { audioUrl: /^\/audio\/greetings\// },
            [{
                $set: {
                    audioUrl: {
                        $replaceOne: {
                            input: "$audioUrl",
                            find: "/audio/greetings/",
                            replacement: "/audio-safe/greetings/"
                        }
                    }
                }
            }]
        );
        
        console.log(`✅ Greeting Audio: ${greetingAudioResult.modifiedCount} URLs updated`);
        
        // ════════════════════════════════════════════════════════════════════════
        // MIGRATE COMPANY TRIGGER audioUrl FIELDS
        // ════════════════════════════════════════════════════════════════════════
        
        console.log('\n🏢 Migrating Company Trigger URLs in v2Company...');
        
        const companies = await db.collection('companiesCollection').find({
            'aiAgentSettings.agent2.discovery.playbook.rules': { $exists: true }
        }).toArray();
        
        let companyUpdates = 0;
        for (const company of companies) {
            const rules = company?.aiAgentSettings?.agent2?.discovery?.playbook?.rules || [];
            let modified = false;
            
            for (const rule of rules) {
                if (rule.answer?.audioUrl && rule.answer.audioUrl.startsWith('/audio/instant-lines/')) {
                    rule.answer.audioUrl = rule.answer.audioUrl.replace('/audio/instant-lines/', '/audio-safe/instant-lines/');
                    modified = true;
                }
            }
            
            if (modified) {
                await db.collection('companiesCollection').updateOne(
                    { _id: company._id },
                    { $set: { 'aiAgentSettings.agent2.discovery.playbook.rules': rules } }
                );
                companyUpdates++;
            }
        }
        
        console.log(`✅ Company Triggers: ${companyUpdates} companies updated`);
        
        // ════════════════════════════════════════════════════════════════════════
        // MIGRATE GREETING URLs in v2Company
        // ════════════════════════════════════════════════════════════════════════
        
        console.log('\n👋 Migrating Company Greeting URLs in v2Company...');
        
        const greetingCompanies = await db.collection('companiesCollection').find({
            $or: [
                { 'aiAgentSettings.agent2.greetings.callStart.audioUrl': { $regex: '^/audio/greetings/' } },
                { 'aiAgentSettings.agent2.greetings.interceptor.rules': { $exists: true } }
            ]
        }).toArray();
        
        let greetingCompanyUpdates = 0;
        for (const company of greetingCompanies) {
            let modified = false;
            const greetings = company?.aiAgentSettings?.agent2?.greetings;
            
            // Call Start
            if (greetings?.callStart?.audioUrl && greetings.callStart.audioUrl.startsWith('/audio/greetings/')) {
                greetings.callStart.audioUrl = greetings.callStart.audioUrl.replace('/audio/greetings/', '/audio-safe/greetings/');
                modified = true;
            }
            
            // Rules
            const rules = greetings?.interceptor?.rules || [];
            for (const rule of rules) {
                if (rule.audioUrl && rule.audioUrl.startsWith('/audio/greetings/')) {
                    rule.audioUrl = rule.audioUrl.replace('/audio/greetings/', '/audio-safe/greetings/');
                    modified = true;
                }
            }
            
            if (modified) {
                await db.collection('companiesCollection').updateOne(
                    { _id: company._id },
                    { $set: { 'aiAgentSettings.agent2.greetings': greetings } }
                );
                greetingCompanyUpdates++;
            }
        }
        
        console.log(`✅ Company Greetings: ${greetingCompanyUpdates} companies updated`);
        
        console.log('\n━'.repeat(80));
        console.log('📊 MIGRATION SUMMARY');
        console.log('━'.repeat(80));
        console.log(`✅ TriggerAudio collection: ${triggerAudioResult.modifiedCount} documents`);
        console.log(`✅ GreetingAudio collection: ${greetingAudioResult.modifiedCount} documents`);
        console.log(`✅ Company triggers: ${companyUpdates} companies`);
        console.log(`✅ Company greetings: ${greetingCompanyUpdates} companies`);
        console.log('━'.repeat(80));
        console.log('\n✅ Migration complete! All audio URLs now use /audio-safe\n');
        
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Disconnected from MongoDB');
    }
}

// Run if called directly
if (require.main === module) {
    migrateAudioUrls().then(() => {
        console.log('🎉 Done!');
        process.exit(0);
    });
}

module.exports = { migrateAudioUrls };
