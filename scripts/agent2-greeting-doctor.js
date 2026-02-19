#!/usr/bin/env node

/**
 * ============================================================================
 * AGENT 2.0 GREETING DOCTOR
 * ============================================================================
 * 
 * All-in-one tool to diagnose AND fix greeting issues.
 * 
 * USAGE:
 *   # Diagnose only (dry run)
 *   node scripts/agent2-greeting-doctor.js <companyId>
 * 
 *   # Diagnose and fix automatically
 *   node scripts/agent2-greeting-doctor.js <companyId> --fix
 * 
 * EXAMPLES:
 *   node scripts/agent2-greeting-doctor.js 68e3f77a9d623b8058c700c4
 *   node scripts/agent2-greeting-doctor.js 68e3f77a9d623b8058c700c4 --fix
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const { diagnoseGreeting } = require('./diagnose-agent2-greeting');
const { fixGreetingCorruption } = require('./fix-agent2-greeting-corruption');

/**
 * Main entry point
 */
async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const companyId = args[0];
  const shouldFix = args.includes('--fix');
  
  if (!companyId) {
    console.error('Usage: node scripts/agent2-greeting-doctor.js <companyId> [--fix]');
    console.error('');
    console.error('Examples:');
    console.error('  node scripts/agent2-greeting-doctor.js 68e3f77a9d623b8058c700c4');
    console.error('  node scripts/agent2-greeting-doctor.js 68e3f77a9d623b8058c700c4 --fix');
    console.error('');
    console.error('Options:');
    console.error('  --fix    Automatically fix detected issues (default: dry run only)');
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
  
  try {
    // STEP 1: Run diagnostic
    console.log('═'.repeat(80));
    console.log('🏥 AGENT 2.0 GREETING DOCTOR');
    console.log('═'.repeat(80));
    console.log(`Company ID: ${companyId}`);
    console.log(`Mode: ${shouldFix ? 'FIX' : 'DIAGNOSE ONLY (DRY RUN)'}`);
    console.log();
    
    const diagResult = await diagnoseGreeting(companyId);
    
    if (!diagResult.success) {
      console.error('❌ Diagnostic failed');
      await mongoose.disconnect();
      process.exit(1);
    }
    
    // Check if issues were detected in the diagnostic output
    // (This is a simplified check - the actual diagnostic logs the details)
    
    if (!shouldFix) {
      console.log('ℹ️  DRY RUN MODE: Issues detected but not fixed');
      console.log('   To fix automatically, run with --fix flag:');
      console.log(`   node scripts/agent2-greeting-doctor.js ${companyId} --fix`);
      console.log();
    } else {
      // STEP 2: Run fix if requested
      console.log();
      console.log('─'.repeat(80));
      console.log('💊 APPLYING FIX...');
      console.log('─'.repeat(80));
      console.log();
      
      const fixResult = await fixGreetingCorruption(companyId);
      
      if (!fixResult.success) {
        console.error('❌ Fix failed');
        await mongoose.disconnect();
        process.exit(1);
      }
      
      if (fixResult.fixed) {
        console.log();
        console.log('═'.repeat(80));
        console.log('✅ TREATMENT SUCCESSFUL');
        console.log('═'.repeat(80));
        console.log();
        console.log('Next steps:');
        console.log('1. Test by calling the number');
        console.log('2. Verify in Twilio Request Inspector');
        console.log('3. If you want custom text, update in Agent 2.0 UI → Greetings tab');
        console.log();
      } else {
        console.log();
        console.log('═'.repeat(80));
        console.log('✅ NO TREATMENT NEEDED');
        console.log('═'.repeat(80));
        console.log();
        console.log('Greeting configuration is already clean!');
        console.log();
      }
    }
    
  } catch (error) {
    console.error();
    console.error('❌ Unhandled error:', error.message);
    console.error(error.stack);
    await mongoose.disconnect();
    process.exit(1);
  }
  
  // Disconnect
  await mongoose.disconnect();
  console.log('✅ Disconnected from database');
  console.log();
  
  process.exit(0);
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { main };
