#!/usr/bin/env node

/**
 * ============================================================================
 * DIAGNOSE AGENT 2.0 GREETING CONFIGURATION
 * ============================================================================
 * 
 * Inspects and reports on Agent 2.0 greeting configuration for a company.
 * Use this to understand what's actually stored in the database and how
 * it will be processed at runtime.
 * 
 * USAGE:
 *   node scripts/diagnose-agent2-greeting.js <companyId>
 *   node scripts/diagnose-agent2-greeting.js 68e3f77a9d623b8058c700c4
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const Company = require('../models/v2Company');

/**
 * Diagnose greeting configuration for a company
 */
async function diagnoseGreeting(companyId) {
  console.log('═'.repeat(80));
  console.log('🔍 AGENT 2.0 GREETING DIAGNOSTIC');
  console.log('═'.repeat(80));
  console.log(`Company ID: ${companyId}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log();
  
  try {
    // Load company
    const company = await Company.findById(companyId);
    
    if (!company) {
      console.log('❌ COMPANY NOT FOUND');
      return { success: false, error: 'Company not found' };
    }
    
    console.log(`✅ Company: ${company.businessName || company.companyName || 'Unknown'}`);
    console.log();
    
    // Check Agent 2.0 configuration
    console.log('─'.repeat(80));
    console.log('📋 AGENT 2.0 CONFIGURATION');
    console.log('─'.repeat(80));
    
    const agent2 = company.aiAgentSettings?.agent2;
    if (!agent2) {
      console.log('❌ Agent 2.0 not configured');
      console.log('   Path: company.aiAgentSettings.agent2');
      console.log('   Status: undefined or null');
      return { success: true, configured: false };
    }
    
    console.log(`✅ Agent 2.0 Enabled: ${agent2.enabled === true ? 'YES' : 'NO'}`);
    console.log(`✅ Discovery Enabled: ${agent2.discovery?.enabled === true ? 'YES' : 'NO'}`);
    console.log();
    
    // Check greetings configuration
    console.log('─'.repeat(80));
    console.log('📋 GREETINGS CONFIGURATION');
    console.log('─'.repeat(80));
    
    const greetings = agent2.greetings;
    if (!greetings) {
      console.log('❌ Greetings not configured');
      console.log('   Path: company.aiAgentSettings.agent2.greetings');
      console.log('   Status: undefined or null');
      return { success: true, configured: false };
    }
    
    // Inspect callStart greeting
    console.log('📞 CALL START GREETING:');
    console.log();
    
    const callStart = greetings.callStart;
    if (!callStart || typeof callStart !== 'object') {
      console.log('❌ callStart not configured properly');
      console.log(`   Type: ${typeof callStart}`);
      console.log(`   Value: ${JSON.stringify(callStart)}`);
      console.log();
    } else {
      // Display full callStart configuration
      console.log('Raw Configuration:');
      console.log(JSON.stringify(callStart, null, 2));
      console.log();
      
      // Analyze each field
      console.log('Field Analysis:');
      console.log();
      
      // Enabled field
      const enabled = callStart.enabled;
      console.log(`  enabled: ${enabled}`);
      console.log(`    ├─ Type: ${typeof enabled}`);
      console.log(`    ├─ Runtime behavior: ${enabled !== false ? 'Greeting will play' : 'Greeting DISABLED'}`);
      console.log(`    └─ ${enabled !== false ? '✅ VALID' : '⚠️  Greeting skipped'}`);
      console.log();
      
      // Text field (THE CRITICAL ONE!)
      const text = callStart.text;
      console.log(`  text: ${JSON.stringify(text)?.substring(0, 100)}${JSON.stringify(text)?.length > 100 ? '...' : ''}`);
      console.log(`    ├─ Type: ${typeof text}`);
      console.log(`    ├─ Length: ${typeof text === 'string' ? text.length : 'N/A'}`);
      
      // Validation checks
      let textIssues = [];
      
      if (typeof text !== 'string') {
        textIssues.push('❌ NOT A STRING (will cause TTS failure)');
      } else {
        if (!text.trim()) {
          textIssues.push('⚠️  EMPTY STRING (will use fallback)');
        }
        if (text.startsWith('{') || text.startsWith('[')) {
          textIssues.push('❌ APPEARS TO BE JSON (will be sanitized to fallback)');
        }
        if (text.includes('CONNECTION_GREETING')) {
          textIssues.push('🔴 CONTAINS "CONNECTION_GREETING" (THIS IS THE BUG!)');
        }
        if (text.includes('fd_CONNECTION_GREETING')) {
          textIssues.push('🔴 CONTAINS "fd_CONNECTION_GREETING" (THIS IS THE BUG!)');
        }
        if (/^fd_[A-Z_]+_\d+$/.test(text)) {
          textIssues.push('🔴 LOOKS LIKE FILE ID (THIS IS THE BUG!)');
        }
        if (/^(function|const|let|var|module|require|import|export)\s/.test(text)) {
          textIssues.push('❌ CONTAINS CODE (will be sanitized to fallback)');
        }
      }
      
      if (textIssues.length === 0) {
        console.log(`    ├─ Validation: ✅ VALID`);
        console.log(`    └─ Preview: "${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"`);
      } else {
        console.log(`    ├─ Validation: ❌ ISSUES DETECTED`);
        textIssues.forEach((issue, i) => {
          const prefix = i === textIssues.length - 1 ? '    └─' : '    ├─';
          console.log(`${prefix} ${issue}`);
        });
      }
      console.log();
      
      // Audio URL field
      const audioUrl = callStart.audioUrl;
      console.log(`  audioUrl: ${JSON.stringify(audioUrl)?.substring(0, 100)}${JSON.stringify(audioUrl)?.length > 100 ? '...' : ''}`);
      console.log(`    ├─ Type: ${typeof audioUrl}`);
      console.log(`    ├─ Has value: ${audioUrl && audioUrl.trim() ? 'YES' : 'NO'}`);
      
      let audioIssues = [];
      
      if (audioUrl !== undefined && typeof audioUrl !== 'string') {
        audioIssues.push('❌ NOT A STRING');
      } else if (audioUrl && audioUrl.trim()) {
        console.log(`    ├─ URL: ${audioUrl}`);
        if (audioUrl.startsWith('http')) {
          audioIssues.push('✅ External URL');
        } else if (audioUrl.startsWith('/audio/')) {
          audioIssues.push('✅ Local file path');
        } else {
          audioIssues.push('⚠️  Unusual path format');
        }
      }
      
      if (audioIssues.length > 0) {
        audioIssues.forEach((issue, i) => {
          const prefix = i === audioIssues.length - 1 ? '    └─' : '    ├─';
          console.log(`${prefix} ${issue}`);
        });
      } else {
        console.log(`    └─ ${audioUrl && audioUrl.trim() ? '✅ VALID' : 'ℹ️  Not configured (will use TTS)'}`);
      }
      console.log();
      
      // Runtime behavior prediction
      console.log('─'.repeat(80));
      console.log('🎯 PREDICTED RUNTIME BEHAVIOR');
      console.log('─'.repeat(80));
      console.log();
      
      if (enabled === false) {
        console.log('❌ Greeting is DISABLED');
        console.log('   → Call will go straight to listening (no greeting)');
      } else if (audioUrl && audioUrl.trim() && typeof audioUrl === 'string') {
        console.log('🎵 AUDIO MODE (Prerecorded)');
        console.log(`   → Will play: ${audioUrl}`);
        console.log('   → TwiML: <Play>...</Play>');
      } else if (typeof text === 'string' && text.trim() && textIssues.length === 0) {
        console.log('🎙️  TTS MODE (Real-time)');
        console.log(`   → Will speak: "${text.substring(0, 60)}${text.length > 60 ? '...' : ''}"`);
        console.log('   → TwiML: <Say>...</Say> (or ElevenLabs → <Play>)');
      } else if (textIssues.length > 0) {
        console.log('🛡️  FALLBACK MODE (Validation failed)');
        console.log('   → Detected issues with text field');
        console.log('   → Will use safe default: "Thank you for calling. How can I help you today?"');
        console.log('   → TwiML: <Say>Thank you for calling. How can I help you today?</Say>');
      } else {
        console.log('❓ UNKNOWN MODE');
        console.log('   → Neither text nor audio configured properly');
        console.log('   → Will likely use safe default');
      }
      console.log();
      
      // Issues summary
      if (textIssues.length > 0) {
        console.log('─'.repeat(80));
        console.log('🚨 ISSUES DETECTED');
        console.log('─'.repeat(80));
        console.log();
        console.log('The following issues will prevent the greeting from working correctly:');
        console.log();
        textIssues.forEach((issue, i) => {
          console.log(`  ${i + 1}. ${issue}`);
        });
        console.log();
        console.log('RECOMMENDED ACTION:');
        console.log('  Run: node scripts/fix-agent2-greeting-corruption.js ' + companyId);
        console.log();
      } else {
        console.log('─'.repeat(80));
        console.log('✅ NO ISSUES DETECTED');
        console.log('─'.repeat(80));
        console.log();
        console.log('Greeting configuration looks clean and should work correctly.');
        console.log();
      }
    }
    
    return { success: true, configured: true };
    
  } catch (error) {
    console.error();
    console.error('❌ ERROR:', error.message);
    console.error();
    console.error(error.stack);
    console.error();
    
    return { success: false, error: error.message };
  }
}

/**
 * Main entry point
 */
async function main() {
  // Parse command line arguments
  const companyId = process.argv[2];
  
  if (!companyId) {
    console.error('Usage: node scripts/diagnose-agent2-greeting.js <companyId>');
    console.error('Example: node scripts/diagnose-agent2-greeting.js 68e3f77a9d623b8058c700c4');
    process.exit(1);
  }
  
  // Connect to database
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/clientsvia', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    process.exit(1);
  }
  
  // Run the diagnostic
  const result = await diagnoseGreeting(companyId);
  
  // Disconnect
  await mongoose.disconnect();
  
  // Exit with appropriate code
  console.log('═'.repeat(80));
  if (result.success) {
    console.log('✅ DIAGNOSTIC COMPLETE');
  } else {
    console.log('❌ DIAGNOSTIC FAILED');
  }
  console.log('═'.repeat(80));
  console.log();
  
  process.exit(result.success ? 0 : 1);
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = { diagnoseGreeting };
