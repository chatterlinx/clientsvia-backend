#!/usr/bin/env node
// scripts/seed-cheatsheet-defaults.js
// ============================================================================
// SEED DEFAULT CHEAT SHEET - Add Industry-Optimized Defaults to Templates
// ============================================================================
// PURPOSE: Populate templates with AI telemarketer detection and best practices
// USAGE: node scripts/seed-cheatsheet-defaults.js
// ============================================================================

require('dotenv').config();
const mongoose = require('mongoose');
const { connectDB } = require('../db');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');

// ============================================================================
// DEFAULT EDGE CASES - AI TELEMARKETER & SPAM DETECTION
// ============================================================================

const defaultEdgeCases = [
  {
    name: 'Dead Air - No Response',
    triggerPatterns: [
      '(silence_3sec)',
      '(no_audio)',
      '(timeout)',
      '(connection_dropped)'
    ],
    responseText: 'Hello? ... Anyone there? ... Goodbye.',
    action: 'hang_up',
    priority: 10,
    enabled: true
  },
  {
    name: 'AI Telemarketer - Generic Script',
    triggerPatterns: [
      'can you hear me',
      'hello\\?.*hello\\?',
      'this is.*calling about',
      'congratulations.*you.*selected',
      'final notice',
      'your warranty.*expire',
      'lower your.*rate',
      'reduced your.*debt',
      'free cruise',
      'you have been chosen'
    ],
    responseText: 'We don\'t accept unsolicited sales calls. Please remove us from your list. Goodbye.',
    action: 'hang_up',
    priority: 9,
    enabled: true
  },
  {
    name: 'Robocall - Automated System',
    triggerPatterns: [
      'press 1',
      'press.*to speak',
      'press.*for',
      'this is a courtesy call',
      'this is not a sales call',
      'do not hang up',
      'stay on the line',
      'your business listing'
    ],
    responseText: null,
    action: 'hang_up',
    priority: 10,
    enabled: true
  },
  {
    name: 'Voicemail - Recording Detected',
    triggerPatterns: [
      '\\(beep\\)',
      'leave a message',
      'at the tone',
      'you have reached',
      'the number you.*dialed',
      'mailbox is full',
      'not available.*message',
      'after the beep'
    ],
    responseText: null,
    action: 'hang_up',
    priority: 10,
    enabled: true
  },
  {
    name: 'Call Center Background Noise',
    triggerPatterns: [
      '\\(background_chatter\\)',
      '\\(hold_music\\)',
      'please hold',
      'transferring your call',
      '\\(multiple_voices\\)',
      '\\(call_center_ambient\\)'
    ],
    responseText: 'We don\'t accept telemarketing calls. Goodbye.',
    action: 'hang_up',
    priority: 8,
    enabled: true
  }
];

// ============================================================================
// DEFAULT BEHAVIOR RULES - HVAC INDUSTRY BEST PRACTICES
// ============================================================================

const defaultBehaviorRules = [
  'ACK_OK',                 // "Got it", "Understood"
  'POLITE_PROFESSIONAL',    // Professional tone for HVAC customers
  'CONFIRM_ENTITIES',       // Repeat back captured info
  'USE_COMPANY_NAME'        // Mention company name naturally
];

// ============================================================================
// DEFAULT GUARDRAILS - HVAC SAFETY & COMPLIANCE
// ============================================================================

const defaultGuardrails = [
  'NO_DIAGNOSES',           // Never diagnose HVAC problems remotely
  'NO_PRICES',              // Pricing requires on-site assessment
  'NO_APOLOGIES_SPAM',      // One apology, not repeated
  'NO_MEDICAL_ADVICE'       // No air quality health claims
];

// ============================================================================
// DEFAULT ACTION ALLOWLIST - HVAC OPERATIONS
// ============================================================================

const defaultActionAllowlist = [
  'BOOK_APPT',              // Schedule service calls
  'TAKE_MESSAGE',           // Capture customer info
  'TRANSFER_EMERGENCY',     // Route urgent calls
  'TRANSFER_BILLING',       // Route payment questions
  'PROVIDE_HOURS',          // Share business hours
  'COLLECT_INFO'            // Gather equipment details
];

// ============================================================================
// DEFAULT TRANSFER RULES - HVAC CALL ROUTING
// ============================================================================

const defaultTransferRules = [
  {
    name: 'Emergency Service Transfer',
    intentTag: 'emergency',
    contactNameOrQueue: '{{EMERGENCY_CONTACT}}',
    phoneNumber: '{{EMERGENCY_PHONE}}',
    script: 'This sounds urgent. Let me connect you to our emergency service line right now.',
    collectEntities: [
      {
        name: 'caller_name',
        type: 'text',
        required: true,
        prompt: 'Can I get your name please?',
        maxRetries: 2,
        escalateOnFail: false
      },
      {
        name: 'phone_number',
        type: 'phone',
        required: true,
        prompt: 'What\'s the best number to reach you?',
        validationPattern: '^\\(?\\d{3}\\)?[-.\\s]?\\d{3}[-.\\s]?\\d{4}$',
        validationPrompt: 'That doesn\'t sound like a valid phone number. Can you try again?',
        maxRetries: 2,
        escalateOnFail: false
      },
      {
        name: 'address',
        type: 'address',
        required: true,
        prompt: 'What\'s the service address?',
        maxRetries: 2,
        escalateOnFail: true
      }
    ],
    afterHoursOnly: false,
    priority: 10,
    enabled: true
  },
  {
    name: 'Billing Department Transfer',
    intentTag: 'billing',
    contactNameOrQueue: '{{BILLING_CONTACT}}',
    phoneNumber: '{{BILLING_PHONE}}',
    script: 'Let me transfer you to our billing department. They\'ll take great care of you.',
    collectEntities: [
      {
        name: 'caller_name',
        type: 'text',
        required: false,
        prompt: 'Can I get your name for billing?',
        maxRetries: 1,
        escalateOnFail: false
      }
    ],
    afterHoursOnly: false,
    priority: 5,
    enabled: true
  },
  {
    name: 'General Scheduling Transfer',
    intentTag: 'scheduling',
    contactNameOrQueue: '{{SCHEDULING_CONTACT}}',
    phoneNumber: '{{SCHEDULING_PHONE}}',
    script: 'Perfect! Let me connect you with our scheduling team to book your appointment.',
    collectEntities: [],
    afterHoursOnly: false,
    priority: 5,
    enabled: true
  }
];

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function seedCheatSheetDefaults() {
  try {
    console.log('🧠 [SEED CHEAT SHEET] Connecting to MongoDB...');
    await connectDB();
    console.log('✅ [SEED CHEAT SHEET] Connected to MongoDB');
    
    // Find all active templates
    const templates = await GlobalInstantResponseTemplate.find({
      isActive: true,
      isPublished: true
    });
    
    console.log(`📋 [SEED CHEAT SHEET] Found ${templates.length} active templates`);
    
    if (templates.length === 0) {
      console.log('⚠️ [SEED CHEAT SHEET] No active templates found');
      process.exit(0);
    }
    
    // Update each template
    for (const template of templates) {
      console.log(`\n🔧 [SEED CHEAT SHEET] Updating template: ${template.name}`);
      
      // Check if defaultCheatSheet already exists
      if (template.defaultCheatSheet && 
          template.defaultCheatSheet.edgeCases && 
          template.defaultCheatSheet.edgeCases.length > 0) {
        console.log(`   ⚠️ Template already has ${template.defaultCheatSheet.edgeCases.length} edge cases`);
        console.log(`   ℹ️ Skipping to avoid overwriting custom configurations`);
        continue;
      }
      
      // Initialize defaultCheatSheet if it doesn't exist
      if (!template.defaultCheatSheet) {
        template.defaultCheatSheet = {};
      }
      
      // Set defaults
      template.defaultCheatSheet.behaviorRules = defaultBehaviorRules;
      template.defaultCheatSheet.guardrails = defaultGuardrails;
      template.defaultCheatSheet.actionAllowlist = defaultActionAllowlist;
      template.defaultCheatSheet.edgeCases = defaultEdgeCases;
      template.defaultCheatSheet.transferRules = defaultTransferRules;
      template.defaultCheatSheet.updatedAt = new Date();
      template.defaultCheatSheet.updatedBy = 'Seed Script';
      template.defaultCheatSheet.notes = 'Industry-optimized defaults with AI telemarketer detection';
      
      // Save template
      await template.save();
      
      console.log(`   ✅ Added ${defaultEdgeCases.length} edge cases`);
      console.log(`   ✅ Added ${defaultBehaviorRules.length} behavior rules`);
      console.log(`   ✅ Added ${defaultGuardrails.length} guardrails`);
      console.log(`   ✅ Added ${defaultActionAllowlist.length} allowed actions`);
      console.log(`   ✅ Added ${defaultTransferRules.length} transfer rules`);
      console.log(`   🎉 Template "${template.name}" updated successfully!`);
    }
    
    console.log('\n✅ [SEED CHEAT SHEET] All templates updated successfully!');
    console.log('\n📝 [SEED CHEAT SHEET] Summary:');
    console.log(`   • ${defaultEdgeCases.length} AI Telemarketer Detection Patterns`);
    console.log(`   • ${defaultBehaviorRules.length} Behavior Rules`);
    console.log(`   • ${defaultGuardrails.length} Safety Guardrails`);
    console.log(`   • ${defaultActionAllowlist.length} Allowed Actions`);
    console.log(`   • ${defaultTransferRules.length} Transfer Rule Templates`);
    
    console.log('\n🎯 [SEED CHEAT SHEET] Next Steps:');
    console.log('   1. Go to Company Profile → AI Settings → Cheat Sheet');
    console.log('   2. Click "Import from Template"');
    console.log('   3. Fill in placeholder values ({{EMERGENCY_PHONE}}, etc.)');
    console.log('   4. Save & Compile');
    console.log('   5. Test with a live call!');
    
  } catch (error) {
    console.error('❌ [SEED CHEAT SHEET] Failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ [SEED CHEAT SHEET] Disconnected from MongoDB');
    process.exit(0);
  }
}

// Run script
seedCheatSheetDefaults();

