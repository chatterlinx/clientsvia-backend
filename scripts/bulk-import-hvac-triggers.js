/**
 * Bulk Import HVAC Triggers for Penguin Air
 * 
 * Loads all triggers from docs/hvac-triggers-100.json into CompanyLocalTrigger
 * for company: 68e3f77a9d623b8058c700c4 (Penguin Air)
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const COMPANY_ID = '68e3f77a9d623b8058c700c4'; // Penguin Air

async function main() {
  try {
    console.log('🚀 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const CompanyLocalTrigger = require('../models/CompanyLocalTrigger');
    
    // Load HVAC triggers from JSON
    const jsonPath = path.join(__dirname, '../docs/hvac-triggers-100.json');
    console.log('📂 Reading:', jsonPath);
    
    const triggersData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    console.log(`📋 Found ${triggersData.length} triggers in JSON`);

    // Clear existing triggers for this company (optional - comment out if you want to keep existing)
    console.log('🗑️  Clearing existing triggers for company...');
    const deleteResult = await CompanyLocalTrigger.deleteMany({ companyId: COMPANY_ID });
    console.log(`✅ Deleted ${deleteResult.deletedCount} existing triggers`);

    // Convert JSON format to CompanyLocalTrigger schema
    const triggers = triggersData.map(t => ({
      companyId: COMPANY_ID,
      triggerId: t.ruleId,
      label: t.label,
      priority: t.priority || 50,
      enabled: true, // Enable all by default
      
      // Matching
      keywords: t.keywords || [],
      phrases: t.phrases || [],
      negativeKeywords: t.negativeKeywords || [],
      
      // Response
      answer: {
        answerText: t.answerText || '',
        audioUrl: null // V125: Always null on import - use TTS, avoid 404 errors
        // Audio can be generated per-trigger via UI after import
        // This prevents ephemeral storage 404 issues
      },
      
      // Follow-up
      followUp: t.followUpQuestion ? {
        question: t.followUpQuestion,
        nextAction: t.nextAction || 'CONTINUE'
      } : null,
      
      // Metadata
      category: t.category || extractCategory(t.ruleId),
      tags: t.tags || [],
      
      createdAt: new Date(),
      updatedAt: new Date()
    }));

    console.log('💾 Inserting triggers into database...');
    const result = await CompanyLocalTrigger.insertMany(triggers);
    console.log(`✅ Successfully imported ${result.length} triggers!`);

    // Summary by category
    const categories = {};
    triggers.forEach(t => {
      const cat = t.category || 'uncategorized';
      categories[cat] = (categories[cat] || 0) + 1;
    });

    console.log('\n📊 IMPORT SUMMARY:');
    console.log('═'.repeat(60));
    console.log(`Company: Penguin Air`);
    console.log(`Company ID: ${COMPANY_ID}`);
    console.log(`Total Triggers: ${result.length}`);
    console.log('\nBy Category:');
    Object.entries(categories).forEach(([cat, count]) => {
      console.log(`  ${cat}: ${count} triggers`);
    });
    console.log('═'.repeat(60));
    
    console.log('\n✅ DONE! Triggers are now loaded and ready.');
    console.log('\n📋 AUDIO STATUS:');
    console.log('  • All triggers imported with audioUrl: null');
    console.log('  • Will use ElevenLabs TTS (dynamic generation)');
    console.log('  • No 404 errors - TTS works on every call');
    console.log('  • Optional: Generate pre-recorded audio later via UI for faster responses');
    console.log('\n🎯 TEST THE FIX:');
    console.log('  1. Make a test call: "My AC is not cooling"');
    console.log('  2. Expected: Agent matches "AC not cooling" trigger');
    console.log('  3. Response: "Got it{name}. I can help with that..."');
    console.log('  4. Audio: ElevenLabs TTS (2-3s generation time)');
    console.log('\n💡 TO IMPROVE PERFORMANCE:');
    console.log('  • Go to Triggers tab in UI');
    console.log('  • Click "Generate Audio" on frequently-used triggers');
    console.log('  • Pre-recorded audio = 200ms (vs 2-3s for TTS)');

  } catch (error) {
    console.error('❌ ERROR:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

function extractCategory(ruleId) {
  if (!ruleId) return 'general';
  
  if (ruleId.startsWith('emergency.')) return 'emergency';
  if (ruleId.startsWith('hvac.cooling.')) return 'cooling';
  if (ruleId.startsWith('hvac.heat.')) return 'heating';
  if (ruleId.startsWith('hvac.airflow.')) return 'airflow';
  if (ruleId.startsWith('hvac.water.')) return 'water';
  if (ruleId.startsWith('hvac.noise.')) return 'noise';
  if (ruleId.startsWith('hvac.iaq.')) return 'indoor_air_quality';
  if (ruleId.startsWith('hvac.tstat.')) return 'thermostat';
  if (ruleId.startsWith('hvac.duct.')) return 'ductwork';
  if (ruleId.startsWith('hvac.filter.')) return 'filter';
  
  return 'general';
}

main();
