'use strict';

/**
 * ============================================================================
 * RENDER SHELL SEED — Engine Hub Default Settings (Optimum Performance)
 * ============================================================================
 *
 * Seeds the engineHub sub-document on a company record with the recommended
 * settings for optimum call performance. Safe to re-run — uses $set so it
 * only writes the engineHub block, touching nothing else on the company doc.
 *
 * Uses raw `mongodb` driver (no mongoose, no dotenv) so it runs cleanly in
 * the Render Shell where MONGODB_URI is already set as an environment variable.
 *
 * Usage — paste into Render Shell:
 *   node scripts/seed-enginehub-defaults.js [companyId]
 *
 * Defaults to Penguin Air if no companyId is supplied.
 * Mode is always seeded as 'passive' — admin must explicitly promote to
 * 'learning' or 'active'. Never auto-activates live call routing.
 *
 * ============================================================================
 */

const { MongoClient, ObjectId } = require('mongodb');

const PENGUIN_AIR_ID = '68e3f77a9d623b8058c700c4';
const COMPANY_ID     = process.argv[2] || PENGUIN_AIR_ID;

// ─────────────────────────────────────────────────────────────────────────────
// OPTIMUM ENGINE HUB DEFAULTS
//
// Design principles:
//  1. Start passive — zero live call impact until admin explicitly activates
//  2. All safety nets on — strict grounding, all escalation rungs enabled
//  3. Catch compound questions — multi-intent at threshold 0.72 (not too
//     aggressive, not too loose — validated across HVAC call patterns)
//  4. Never drop a question — llm_fallback for no-KC-match so Claude handles
//     anything the KC doesn't cover (non-factual, conversational)
//  5. Full observability — trace on, KC misses logged, CI alerts at 2 fallbacks
// ─────────────────────────────────────────────────────────────────────────────

const ENGINE_HUB_DEFAULTS = {

  // ── Master ──────────────────────────────────────────────────────────────────
  // enabled: false — admin must flip the master switch to activate
  // mode: passive — log only, ZERO live call routing changes until promoted
  'engineHub.enabled': false,
  'engineHub.mode':    'passive',

  // ── Intent Detection ────────────────────────────────────────────────────────
  // multiIntent: catch compound questions ("how much AND do you have availability today?")
  // threshold 0.72: confident enough to act, loose enough to miss nothing
  // max 2 intents: handles compound questions without overloading the router
  'engineHub.intentDetection.multiIntentEnabled':  true,
  'engineHub.intentDetection.confidenceThreshold': 0.72,
  'engineHub.intentDetection.maxIntentsPerTurn':   2,

  // ── Policy Router ───────────────────────────────────────────────────────────
  // All 6 policies enabled — router picks the right one per context
  'engineHub.policyRouter.enabledPolicies': [
    'answer_then_book',   // Answer KC question, then pivot to booking (most common path)
    'book_then_defer',    // Commit the booking first if caller is mid-flow, then answer
    'clarify_first',      // Ask one clarifying question when intent is ambiguous
    'pause_resume',       // Pause active flow, answer interrupt, resume where left off
    'de_escalate',        // Cool the caller before routing — prevents hot transfers
    'offer_alternatives', // When primary path fails, offer the next best option
  ],

  // Escalation ladder — all rungs on
  // rung1: de-escalate before transferring (always attempt tone/pace reset)
  // rung4: confirm with caller before executing transfer (no surprise transfers)
  // altVoicemail: surface voicemail as an alternative when human unavailable
  // altCallback: offer callback as alternative to hold
  'engineHub.policyRouter.escalationConfig.rung1DeEscalate':     true,
  'engineHub.policyRouter.escalationConfig.rung4ConfirmTransfer': true,
  'engineHub.policyRouter.escalationConfig.altVoicemail':        true,
  'engineHub.policyRouter.escalationConfig.altCallback':         true,

  // ── Mid-Flow Interrupt Handling ─────────────────────────────────────────────
  // What happens when a caller injects a question into an active flow:
  //   pause_resume: answer the interrupt, then seamlessly return to the flow
  //   book_then_defer: finish the booking commitment first, then answer
  //   answer_then_book: answer the interrupt, then return to booking
  //   block_injection: hard block — used ONLY when transfer is already executing
  'engineHub.midFlowInterrupt.bookingSlotSelection':  'pause_resume',    // "What time works?" → interrupt → resume slot selection
  'engineHub.midFlowInterrupt.bookingAddressCapture': 'pause_resume',    // Address capture interrupted → answer → resume capture
  'engineHub.midFlowInterrupt.bookingConfirmation':   'book_then_defer', // Almost booked → lock in the booking, THEN answer
  'engineHub.midFlowInterrupt.afterHoursIntake':      'answer_then_book', // After-hours message → answer question → return to intake
  'engineHub.midFlowInterrupt.transferInProgress':    'block_injection',  // Transfer executing → block all new intents

  // ── Knowledge Engine ────────────────────────────────────────────────────────
  // strictGroundedMode: agent NEVER invents prices, policy dates, or commitments
  //   from memory. Must answer from KC cards only — hallucination is eliminated.
  // onNoKcMatch = llm_fallback: when no KC card matches, Claude handles the
  //   question (conversational, non-factual). Better than abstaining.
  //   strictGroundedMode still prevents Claude from inventing facts.
  // logKcMisses: every KC no-match is logged to callTraceLog — Call Intelligence
  //   surfaces these as gaps so you can add KC cards over time.
  'engineHub.knowledgeEngine.strictGroundedMode': true,
  'engineHub.knowledgeEngine.onNoKcMatch':        'llm_fallback',
  'engineHub.knowledgeEngine.logKcMisses':        true,

  // ── Agenda State ────────────────────────────────────────────────────────────
  // Tracks open/deferred intents per call so compound questions aren't dropped.
  // max 3 deferred: enough to track a compound caller without agenda bloat
  // autoSurface: agent proactively raises deferred topics at natural openings
  // timeout 5 turns: deferred intents expire after 5 turns — prevents ghost agenda
  'engineHub.agendaState.maxDeferredIntents':   3,
  'engineHub.agendaState.autoSurfaceDeferred':  true,
  'engineHub.agendaState.deferredTimeoutTurns': 5,

  // ── Trace & Diagnostics ─────────────────────────────────────────────────────
  // enabled: log all Engine Hub decisions per turn to callTraceLog
  // showInCallIntelligence: surface Engine Hub trace events in CI report
  // alertOnFallbackCount 2: flag any call where KC no-match fires 2+ times
  //   (signals a gap in the knowledge base that needs a new KC card)
  'engineHub.trace.enabled':              true,
  'engineHub.trace.showInCallIntelligence': true,
  'engineHub.trace.alertOnFallbackCount': 2,

  // ── isConfigured flag ────────────────────────────────────────────────────────
  // Tells the UI the settings have been saved at least once — hides the
  // "not configured" banner. Admin still controls enabled/mode.
  'engineHub.isConfigured': true,
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('══════════════════════════════════════════════════════════════════');
  console.log('  ⚙️   Render Seed: Engine Hub — Optimum Performance Defaults');
  console.log(`  Company ID: ${COMPANY_ID}`);
  console.log('══════════════════════════════════════════════════════════════════');
  console.log('');

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌  MONGODB_URI not set. Run this in Render Shell where env vars are available.');
    process.exit(1);
  }

  let companyObjId;
  try {
    companyObjId = new ObjectId(COMPANY_ID);
  } catch {
    console.error(`❌  Invalid companyId format: "${COMPANY_ID}"`);
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  console.log('  ✅  MongoDB connected\n');

  const db         = client.db('clientsvia');
  const companies  = db.collection('companiesCollection');

  // Verify company exists
  const company = await companies.findOne({ _id: companyObjId }, { projection: { companyName: 1 } });
  if (!company) {
    console.error(`❌  Company not found: ${COMPANY_ID}`);
    await client.close();
    process.exit(1);
  }
  console.log(`  Company: ${company.companyName || '(unnamed)'}`);
  console.log('');

  // Apply defaults via dot-notation $set — only writes engineHub keys, nothing else
  const result = await companies.updateOne(
    { _id: companyObjId },
    { $set: ENGINE_HUB_DEFAULTS }
  );

  if (result.matchedCount === 0) {
    console.error('❌  Update matched 0 documents (this should not happen after the findOne above)');
    await client.close();
    process.exit(1);
  }

  console.log('  ✅  Engine Hub defaults applied:\n');

  // Print a summary of what was written
  const groups = [
    { label: 'Master',              keys: ['engineHub.enabled', 'engineHub.mode'] },
    { label: 'Intent Detection',    keys: ['engineHub.intentDetection.multiIntentEnabled', 'engineHub.intentDetection.confidenceThreshold', 'engineHub.intentDetection.maxIntentsPerTurn'] },
    { label: 'Policy Router',       keys: ['engineHub.policyRouter.enabledPolicies', 'engineHub.policyRouter.escalationConfig.rung1DeEscalate', 'engineHub.policyRouter.escalationConfig.rung4ConfirmTransfer', 'engineHub.policyRouter.escalationConfig.altVoicemail', 'engineHub.policyRouter.escalationConfig.altCallback'] },
    { label: 'Mid-Flow Interrupts', keys: ['engineHub.midFlowInterrupt.bookingSlotSelection', 'engineHub.midFlowInterrupt.bookingAddressCapture', 'engineHub.midFlowInterrupt.bookingConfirmation', 'engineHub.midFlowInterrupt.afterHoursIntake', 'engineHub.midFlowInterrupt.transferInProgress'] },
    { label: 'Knowledge Engine',    keys: ['engineHub.knowledgeEngine.strictGroundedMode', 'engineHub.knowledgeEngine.onNoKcMatch', 'engineHub.knowledgeEngine.logKcMisses'] },
    { label: 'Agenda State',        keys: ['engineHub.agendaState.maxDeferredIntents', 'engineHub.agendaState.autoSurfaceDeferred', 'engineHub.agendaState.deferredTimeoutTurns'] },
    { label: 'Trace & Diagnostics', keys: ['engineHub.trace.enabled', 'engineHub.trace.showInCallIntelligence', 'engineHub.trace.alertOnFallbackCount'] },
  ];

  for (const group of groups) {
    console.log(`     ${group.label}:`);
    for (const key of group.keys) {
      const shortKey = key.replace('engineHub.', '');
      const val      = ENGINE_HUB_DEFAULTS[key];
      const display  = Array.isArray(val) ? `[${val.join(', ')}]` : String(val);
      console.log(`       ${shortKey.padEnd(48)} ${display}`);
    }
    console.log('');
  }

  console.log('  ⚠️   Mode is PASSIVE — engine logs decisions but does NOT affect live calls.');
  console.log('  ⚠️   Admin must flip the master switch + promote to Learning or Active to go live.');
  console.log('');
  console.log('══════════════════════════════════════════════════════════════════');
  console.log('  ✅  Done. Refresh Engine Hub to see the loaded defaults.');
  console.log('══════════════════════════════════════════════════════════════════');
  console.log('');

  await client.close();
}

main().catch(err => {
  console.error('❌  Seed failed:', err.message);
  process.exit(1);
});
