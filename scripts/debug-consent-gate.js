/**
 * ============================================================================
 * DEBUG: Follow-up Consent Gate State Tracking
 * ============================================================================
 * 
 * This script helps debug why the consent gate isn't firing when a caller
 * responds "Yes" to a follow-up question.
 * 
 * Usage: node scripts/debug-consent-gate.js <callSid>
 * 
 * ============================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');
const CallSummary = require('../models/CallSummary');
const CallTranscriptV2 = require('../models/CallTranscriptV2');

async function debugConsentGate(callSid) {
  console.log('🔍 Debugging Follow-up Consent Gate State Tracking\n');
  
  if (!callSid) {
    console.error('❌ Usage: node scripts/debug-consent-gate.js <callSid>');
    process.exit(1);
  }
  
  // Connect to MongoDB
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('❌ No MongoDB URI found in environment');
    process.exit(1);
  }
  
  await mongoose.connect(mongoUri);
  console.log('✅ Connected to MongoDB\n');
  
  // ─────────────────────────────────────────────────────────────────────────
  // LOAD CALL DATA
  // ─────────────────────────────────────────────────────────────────────────
  
  console.log(`📞 Loading call data for: ${callSid}\n`);
  
  const callSummary = await CallSummary.findOne({ callSid }).lean();
  if (!callSummary) {
    console.error('❌ Call not found in CallSummary');
    process.exit(1);
  }
  
  const transcript = await CallTranscriptV2.findOne({ callSid }).lean();
  if (!transcript) {
    console.log('⚠️  No CallTranscriptV2 found, using CallSummary events');
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // ANALYZE TURNS AND STATE
  // ─────────────────────────────────────────────────────────────────────────
  
  const turns = transcript?.turns || callSummary.turns || [];
  const trace = transcript?.trace || [];
  
  console.log(`📊 Call Overview:`);
  console.log(`   Company: ${callSummary.companyId}`);
  console.log(`   Total Turns: ${turns.length}`);
  console.log(`   Trace Events: ${trace.length}\n`);
  
  // Find trigger card response and follow-up question
  let followUpTurn = null;
  let responseTurn = null;
  
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const turnNum = i + 1;
    
    console.log(`🔄 Turn ${turnNum}:`);
    console.log(`   Speaker: ${turn.speaker}`);
    console.log(`   Text: "${turn.text}"`);
    
    if (turn.speaker === 'agent') {
      // Check if this turn contains a follow-up question
      const hasFollowUpQuestion = turn.text && turn.text.includes('Do you want me to get that scheduled?');
      if (hasFollowUpQuestion) {
        followUpTurn = turnNum;
        console.log(`   ✅ FOLLOW-UP QUESTION DETECTED`);
      }
      
      // Check state for pendingFollowUpQuestion
      if (turn.state?.agent2?.discovery?.pendingFollowUpQuestion) {
        console.log(`   📝 pendingFollowUpQuestion: "${turn.state.agent2.discovery.pendingFollowUpQuestion}"`);
        console.log(`   📝 pendingFollowUpQuestionTurn: ${turn.state.agent2.discovery.pendingFollowUpQuestionTurn}`);
        console.log(`   📝 pendingFollowUpQuestionSource: ${turn.state.agent2.discovery.pendingFollowUpQuestionSource}`);
      }
    }
    
    if (turn.speaker === 'caller' && turn.text?.toLowerCase().includes('yes')) {
      responseTurn = turnNum;
      console.log(`   ✅ CALLER SAID YES`);
    }
    
    console.log('');
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // ANALYZE TRACE EVENTS
  // ─────────────────────────────────────────────────────────────────────────
  
  console.log('📋 Relevant Trace Events:\n');
  
  const relevantEvents = trace.filter(event => 
    event.event?.includes('FOLLOWUP') || 
    event.event?.includes('CONSENT') ||
    event.event?.includes('TRIGGER_CARD') ||
    event.event?.includes('PENDING')
  );
  
  for (const event of relevantEvents) {
    console.log(`   🔸 ${event.event} (Turn ${event.turn || '?'})`);
    if (event.data) {
      const data = typeof event.data === 'string' ? event.data : JSON.stringify(event.data, null, 2);
      console.log(`      ${data.substring(0, 200)}${data.length > 200 ? '...' : ''}`);
    }
    console.log('');
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // ANALYSIS SUMMARY
  // ─────────────────────────────────────────────────────────────────────────
  
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🎯 ANALYSIS SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  
  if (followUpTurn && responseTurn) {
    console.log(`✅ Follow-up question asked in Turn ${followUpTurn}`);
    console.log(`✅ Caller responded "Yes" in Turn ${responseTurn}`);
    console.log(`📊 Turn difference: ${responseTurn - followUpTurn} (should be 1)`);
    
    if (responseTurn - followUpTurn === 1) {
      console.log(`✅ Turn sequence is correct`);
      console.log(`❓ Check if pendingFollowUpQuestionTurn was set to ${followUpTurn}`);
    } else {
      console.log(`❌ Turn sequence is wrong - there were ${responseTurn - followUpTurn - 1} extra turns`);
    }
  } else {
    if (!followUpTurn) console.log(`❌ No follow-up question detected`);
    if (!responseTurn) console.log(`❌ No "Yes" response detected`);
  }
  
  // Check for consent gate events
  const consentEvents = trace.filter(e => e.event?.includes('FOLLOWUP_CONSENT'));
  if (consentEvents.length > 0) {
    console.log(`✅ Found ${consentEvents.length} consent gate events`);
  } else {
    console.log(`❌ No consent gate events found - consent gate never fired`);
  }
  
  // Check for complex fallthrough
  const fallthroughEvents = trace.filter(e => e.event?.includes('COMPLEX_FALLTHROUGH'));
  if (fallthroughEvents.length > 0) {
    console.log(`⚠️  Found ${fallthroughEvents.length} complex fallthrough events - caller response was classified as COMPLEX`);
  }
  
  console.log('═══════════════════════════════════════════════════════════════');
  
  await mongoose.disconnect();
  process.exit(0);
}

const callSid = process.argv[2];
debugConsentGate(callSid).catch(err => {
  console.error('❌ Debug failed:', err);
  process.exit(1);
});