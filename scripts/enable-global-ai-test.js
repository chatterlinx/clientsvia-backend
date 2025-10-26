/**
 * Quick Script: Enable Global AI Brain Testing
 * 
 * This script enables the global AI Brain test configuration
 * so incoming test calls will be routed correctly.
 * 
 * Usage: node scripts/enable-global-ai-test.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const AdminSettings = require('../models/AdminSettings');

async function enableGlobalAITest() {
  console.log('🔧 [ENABLE TEST] Starting...');
  
  try {
    // Connect to MongoDB
    console.log('📡 [ENABLE TEST] Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ [ENABLE TEST] Connected to MongoDB');
    
    // Get current settings
    const settings = await AdminSettings.getSettings();
    
    if (!settings) {
      console.log('❌ [ENABLE TEST] No AdminSettings found!');
      process.exit(1);
    }
    
    console.log('📊 [ENABLE TEST] Current state:', {
      enabled: settings.globalAIBrainTest?.enabled || false,
      phoneNumber: settings.globalAIBrainTest?.phoneNumber || 'Not set',
      activeTemplateId: settings.globalAIBrainTest?.activeTemplateId || 'Not set'
    });
    
    // Enable testing
    if (!settings.globalAIBrainTest) {
      settings.globalAIBrainTest = {};
    }
    
    settings.globalAIBrainTest.enabled = true;
    
    await settings.save();
    
    console.log('✅ [ENABLE TEST] Testing enabled!');
    console.log('📊 [ENABLE TEST] New state:', {
      enabled: settings.globalAIBrainTest.enabled,
      phoneNumber: settings.globalAIBrainTest.phoneNumber || 'Not set',
      activeTemplateId: settings.globalAIBrainTest.activeTemplateId || 'Not set'
    });
    
    console.log('\n✅ SUCCESS! Global AI Brain testing is now ENABLED.');
    console.log('🔔 NOTE: Make sure you have set:');
    console.log('   - Phone number (E.164 format)');
    console.log('   - Twilio Account SID');
    console.log('   - Twilio Auth Token');
    console.log('   - Active Template ID');
    console.log('\n📱 Go to Global AI Brain → Twilio Testing to configure.');
    
  } catch (error) {
    console.error('❌ [ENABLE TEST] Error:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('📡 [ENABLE TEST] Disconnected from MongoDB');
  }
}

enableGlobalAITest();

