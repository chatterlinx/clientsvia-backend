#!/usr/bin/env node

/**
 * ============================================================================
 * FIX AGENT 2.0 GREETING CORRUPTION
 * ============================================================================
 * 
 * Repairs corrupted greeting text in Agent 2.0 callStart configuration.
 * 
 * PROBLEM:
 * - callStart.text sometimes contains objects, JSON, code, or internal IDs
 * - This causes TTS to read aloud "CONNECTION_GREETING" or other garbage
 * 
 * SOLUTION:
 * - Detect corrupted text patterns
 * - Replace with safe default greeting
 * - Log all fixes for audit trail
 * 
 * USAGE:
 *   node scripts/fix-agent2-greeting-corruption.js <companyId>
 *   node scripts/fix-agent2-greeting-corruption.js 68e3f77a9d623b8058c700c4
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const Company = require('../models/v2Company');
const logger = require('../utils/logger');

// Safe default greeting to use when corruption is detected
const SAFE_DEFAULT_GREETING = "Thank you for calling. How can I help you today?";

/**
 * Validate and fix greeting text
 * @param {string} text - Greeting text to validate
 * @returns {Object} { isValid: boolean, fixed: string|null, reason: string|null }
 */
function validateGreetingText(text) {
  // Must be a string
  if (typeof text !== 'string') {
    return {
      isValid: false,
      fixed: SAFE_DEFAULT_GREETING,
      reason: `Text is not a string (type: ${typeof text})`
    };
  }
  
  const trimmed = text.trim();
  
  // Must not be empty
  if (!trimmed) {
    return {
      isValid: false,
      fixed: SAFE_DEFAULT_GREETING,
      reason: 'Text is empty'
    };
  }
  
  // Must not be JSON
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return {
      isValid: false,
      fixed: SAFE_DEFAULT_GREETING,
      reason: 'Text appears to be JSON'
    };
  }
  
  // Must not be code
  const codePatterns = [
    { pattern: /^function\s/, name: 'function declaration' },
    { pattern: /^const\s/, name: 'const declaration' },
    { pattern: /^let\s/, name: 'let declaration' },
    { pattern: /^var\s/, name: 'var declaration' },
    { pattern: /^module\.exports/, name: 'module.exports' },
    { pattern: /^require\(/, name: 'require statement' },
    { pattern: /^import\s/, name: 'import statement' },
    { pattern: /^export\s/, name: 'export statement' },
    { pattern: /=>\s*\{/, name: 'arrow function' },
    { pattern: /\bclass\s+\w+\s*\{/, name: 'class declaration' }
  ];
  
  for (const { pattern, name } of codePatterns) {
    if (pattern.test(trimmed)) {
      return {
        isValid: false,
        fixed: SAFE_DEFAULT_GREETING,
        reason: `Text contains ${name}`
      };
    }
  }
  
  // Must not be internal identifiers or file paths (THE SMOKING GUN!)
  const businessIdPatterns = [
    { pattern: /CONNECTION_GREETING/i, name: 'CONNECTION_GREETING constant' },
    { pattern: /fd_CONNECTION_GREETING/i, name: 'fd_CONNECTION_GREETING file prefix' },
    { pattern: /^fd_[A-Z_]+_\d+$/, name: 'generic file ID pattern' },
    { pattern: /\/audio\//i, name: 'audio file path' },
    { pattern: /\.mp3/i, name: 'audio file extension (.mp3)' },
    { pattern: /\.wav/i, name: 'audio file extension (.wav)' },
    { pattern: /\.ogg/i, name: 'audio file extension (.ogg)' },
    { pattern: /^https?:\/\//i, name: 'URL (should be in audioUrl field, not text)' },
    { pattern: /^\/.*\.(mp3|wav|ogg)$/i, name: 'audio file path pattern' }
  ];
  
  for (const { pattern, name } of businessIdPatterns) {
    if (pattern.test(trimmed)) {
      return {
        isValid: false,
        fixed: SAFE_DEFAULT_GREETING,
        reason: `Text contains internal identifier: ${name}`
      };
    }
  }
  
  // Must be reasonable length (1-500 chars)
  if (trimmed.length > 500) {
    return {
      isValid: false,
      fixed: trimmed.substring(0, 500),
      reason: 'Text exceeds 500 characters'
    };
  }
  
  // All checks passed
  return { isValid: true, fixed: null, reason: null };
}

/**
 * Fix greeting corruption for a specific company
 * @param {string} companyId - Company ID to fix
 * @returns {Promise<Object>} Fix result
 */
async function fixGreetingCorruption(companyId) {
  console.log('═'.repeat(80));
  console.log('🔧 AGENT 2.0 GREETING CORRUPTION FIX');
  console.log('═'.repeat(80));
  console.log(`Company ID: ${companyId}`);
  console.log();
  
  try {
    // Load company
    const company = await Company.findById(companyId);
    
    if (!company) {
      console.log('❌ Company not found');
      return { success: false, error: 'Company not found' };
    }
    
    console.log(`✅ Company found: ${company.businessName || company.companyName || 'Unknown'}`);
    console.log();
    
    // Check if Agent 2.0 is configured
    const agent2 = company.aiAgentSettings?.agent2;
    if (!agent2) {
      console.log('ℹ️  Agent 2.0 not configured for this company');
      return { success: true, message: 'Agent 2.0 not configured' };
    }
    
    const greetings = agent2.greetings;
    if (!greetings) {
      console.log('ℹ️  Agent 2.0 greetings not configured');
      return { success: true, message: 'Greetings not configured' };
    }
    
    const callStart = greetings.callStart;
    if (!callStart) {
      console.log('ℹ️  callStart greeting not configured');
      return { success: true, message: 'callStart not configured' };
    }
    
    // Display current state
    console.log('📊 CURRENT STATE:');
    console.log('─'.repeat(80));
    console.log(JSON.stringify(callStart, null, 2));
    console.log();
    
    // Validate text field
    const textValidation = validateGreetingText(callStart.text);
    let textFixed = false;
    
    if (!textValidation.isValid) {
      console.log(`❌ CORRUPTION DETECTED IN TEXT FIELD:`);
      console.log(`   Reason: ${textValidation.reason}`);
      console.log(`   Current value: ${JSON.stringify(callStart.text)?.substring(0, 100)}`);
      console.log(`   Fixed value: ${textValidation.fixed}`);
      console.log();
      
      callStart.text = textValidation.fixed;
      textFixed = true;
    } else {
      console.log(`✅ Text field is valid: "${callStart.text.substring(0, 80)}${callStart.text.length > 80 ? '...' : ''}"`);
    }
    
    // Validate audioUrl field
    let audioFixed = false;
    if (callStart.audioUrl !== undefined && typeof callStart.audioUrl !== 'string') {
      console.log(`❌ CORRUPTION DETECTED IN AUDIO URL:`);
      console.log(`   Type: ${typeof callStart.audioUrl}`);
      console.log(`   Value: ${JSON.stringify(callStart.audioUrl)?.substring(0, 100)}`);
      console.log();
      
      callStart.audioUrl = '';
      audioFixed = true;
    } else if (callStart.audioUrl) {
      console.log(`✅ Audio URL is valid: ${callStart.audioUrl}`);
    } else {
      console.log(`ℹ️  No audio URL configured (using TTS)`);
    }
    
    // Save if fixes were applied
    if (textFixed || audioFixed) {
      console.log();
      console.log('💾 SAVING FIXES...');
      console.log();
      
      // Mark as updated
      if (!agent2.meta) {
        agent2.meta = {};
      }
      agent2.meta.greetingFixedAt = new Date();
      agent2.meta.greetingFixedBy = 'fix-agent2-greeting-corruption.js';
      
      await company.save();
      
      console.log('✅ FIXES SAVED SUCCESSFULLY!');
      console.log();
      console.log('📊 NEW STATE:');
      console.log('─'.repeat(80));
      console.log(JSON.stringify(callStart, null, 2));
      console.log();
      
      return {
        success: true,
        fixed: true,
        changes: {
          textFixed,
          audioFixed
        }
      };
    } else {
      console.log();
      console.log('✅ NO CORRUPTION DETECTED — Data is clean!');
      console.log();
      
      return {
        success: true,
        fixed: false,
        message: 'No corruption detected'
      };
    }
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
    console.error('Usage: node scripts/fix-agent2-greeting-corruption.js <companyId>');
    console.error('Example: node scripts/fix-agent2-greeting-corruption.js 68e3f77a9d623b8058c700c4');
    process.exit(1);
  }
  
  // Connect to database
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/clientsvia', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connected to database');
    console.log();
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    process.exit(1);
  }
  
  // Run the fix
  const result = await fixGreetingCorruption(companyId);
  
  // Disconnect
  await mongoose.disconnect();
  console.log('✅ Disconnected from database');
  console.log();
  
  // Exit with appropriate code
  if (result.success) {
    console.log('═'.repeat(80));
    console.log('✅ OPERATION COMPLETE');
    console.log('═'.repeat(80));
    process.exit(0);
  } else {
    console.log('═'.repeat(80));
    console.log('❌ OPERATION FAILED');
    console.log('═'.repeat(80));
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = { fixGreetingCorruption, validateGreetingText };
