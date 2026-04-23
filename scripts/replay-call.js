#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * replay-call.js — Offline replay of a real call's routing decisions
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * UAP/v1.md §27 — Item 7 of the 8-Cue + Anchor Hardening initiative.
 *
 * PURPOSE
 * -------
 * Take a real callSid that was already processed, re-extract its per-turn
 * utterances from MongoDB qaLog, and feed them BACK through the live
 * KCDiscoveryRunner — WITHOUT writing anything, without touching Redis,
 * without hitting any live pipeline side-effects.
 *
 * Purpose: prove that routing changes (specificity, anchor acronyms,
 * ROUTE_DECISION wiring, negative-keyword updates, etc.) either:
 *   (a) correctly fix a previously-broken turn, or
 *   (b) do not regress a previously-correct turn.
 *
 * Fully multi-tenant — companyId + callSid are CLI args, no hardcoding.
 *
 * USAGE
 * -----
 *   node scripts/replay-call.js <companyId> <callSid>
 *   node scripts/replay-call.js <companyId> <callSid> --json
 *   node scripts/replay-call.js <companyId> <callSid> --turn 3
 *
 * FLAGS
 *   --json          Emit the full replay transcript as JSON (no pretty print).
 *   --turn <N>      Replay only turn N (default: all turns).
 *   --verbose       Print every captured emit event per turn.
 *
 * EXIT CODE
 *   0 — replay completed. Does NOT imply "no change" — use --json + diff
 *       to decide what counts as regression for your workflow.
 *   1 — fatal error (bad args, mongo unreachable, call not found).
 *
 * SIDE EFFECTS — NONE
 * -------------------
 * Before invoking KCDiscoveryRunner.run(), this script stubs
 * DiscoveryNotesService.update() and .init() to no-ops, and passes
 * `redis: null` so no cache writes happen. The engine's internal
 * `.catch(() => {})` wrappers absorb any residual write intent.
 *
 * READ-ONLY against Mongo (loads Company + Customer, never writes).
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const path = require('path');

// ── Load env (.env) if present — matches pattern in other scripts ────────────
try { require('dotenv').config(); } catch (_e) { /* optional */ }

const { MongoClient, ObjectId } = require('mongodb');

// ── CLI ──────────────────────────────────────────────────────────────────────
const args       = process.argv.slice(2);
const companyId  = args[0];
const callSid    = args[1];
const jsonOut    = args.includes('--json');
const verbose    = args.includes('--verbose');
const onlyTurnIx = args.indexOf('--turn');
const onlyTurn   = onlyTurnIx !== -1 ? parseInt(args[onlyTurnIx + 1], 10) : null;

if (!companyId || !callSid || companyId.startsWith('--') || callSid.startsWith('--')) {
  console.error('Usage: node scripts/replay-call.js <companyId> <callSid> [--json] [--turn N] [--verbose]');
  process.exit(1);
}
if (!process.env.MONGODB_URI) {
  console.error('❌ MONGODB_URI not set in env');
  process.exit(1);
}

// ── STUB SIDE-EFFECT MODULES *BEFORE* REQUIRING THE ENGINE ──────────────────
// KCDiscoveryRunner requires DiscoveryNotesService at module load. Mutating
// the exported object after require() is safe because Node caches module
// exports by reference — the engine calls .update()/.init() at runtime, and
// by then our no-ops are in place.
const DiscoveryNotesService = require('../services/discoveryNotes/DiscoveryNotesService');
DiscoveryNotesService.update = async () => true;   // claim success, do nothing
DiscoveryNotesService.init   = async () => true;
DiscoveryNotesService.load   = async () => null;   // no pre-warmed notes in replay

const KCDiscoveryRunner = require('../services/engine/kc/KCDiscoveryRunner');

// ── HELPERS ──────────────────────────────────────────────────────────────────

function log(msg) { if (!jsonOut) console.log(msg); }

function hr(char = '─', n = 75) { log(char.repeat(n)); }

/**
 * Extract per-turn utterances + recorded routing from a call's qaLog.
 * Groups by `turn` index — each turn gets the first userInput seen
 * (from CUE_FRAME events, which carry `question: userInput`) plus the
 * recorded ROUTE_DECISION entry if one exists.
 */
function extractTurns(qaLog) {
  const byTurn = {};
  for (const entry of (qaLog || [])) {
    const t = entry.turn ?? 0;
    if (!byTurn[t]) {
      byTurn[t] = { turn: t, userInput: null, recorded: { routeDecision: null, matchedContainerId: null, events: [] } };
    }
    if (!byTurn[t].userInput && entry.question) byTurn[t].userInput = entry.question;
    if (entry.type === 'ROUTE_DECISION' && !byTurn[t].recorded.routeDecision) {
      byTurn[t].recorded.routeDecision = {
        winner:      entry.winner,
        winnerBy:    entry.winnerBy,
        runnerUp:    entry.runnerUp || null,
        margin:      entry.margin ?? null,
        candidates:  entry.candidates || [],
      };
    }
    byTurn[t].recorded.events.push(entry.type);
  }
  return Object.values(byTurn).sort((a, b) => a.turn - b.turn);
}

/**
 * Pretty-print a single turn's replay result vs. recorded routing.
 */
function renderTurn(t, capturedEvents, capturedRoute) {
  hr('═');
  log(`TURN ${t.turn}`);
  hr('═');
  log(`utterance: ${JSON.stringify(t.userInput)}`);
  log('');

  log('── RECORDED (original call) ──');
  if (t.recorded.routeDecision) {
    const r = t.recorded.routeDecision;
    log(`  winner:    ${r.winner || '(none)'}`);
    log(`  winnerBy:  ${r.winnerBy || '(n/a)'}`);
    log(`  runnerUp:  ${r.runnerUp ? `${r.runnerUp.gate} (${r.runnerUp.containerId || '-'})` : '(none)'}`);
    log(`  margin:    ${r.margin ?? '(n/a)'}`);
    log(`  candidates: ${(r.candidates || []).map(c => `${c.gate}→${c.containerId || '-'}@${c.score ?? '-'}`).join(' | ') || '(none)'}`);
  } else {
    log('  (no ROUTE_DECISION entry in original qaLog — call pre-dates Item 6)');
    log(`  events: ${t.recorded.events.join(', ')}`);
  }
  log('');

  log('── REPLAYED (current code) ──');
  if (capturedRoute) {
    log(`  winner:    ${capturedRoute.winner || '(none)'}`);
    log(`  winnerBy:  ${capturedRoute.winnerBy || '(n/a)'}`);
    log(`  runnerUp:  ${capturedRoute.runnerUp ? `${capturedRoute.runnerUp.gate} (${capturedRoute.runnerUp.containerId || '-'})` : '(none)'}`);
    log(`  margin:    ${capturedRoute.margin ?? '(n/a)'}`);
    log(`  candidates: ${(capturedRoute.candidates || []).map(c => `${c.gate}→${c.containerId || '-'}@${c.score ?? '-'}`).join(' | ') || '(none)'}`);
  } else {
    log('  (replay produced no KC_ROUTE_DECISION — check --verbose for raw events)');
  }

  if (verbose) {
    log('');
    log('── captured events (replay) ──');
    for (const e of capturedEvents) {
      log(`  [${e.type}] ${JSON.stringify(e.data).slice(0, 200)}`);
    }
  }

  // Diff summary
  log('');
  const recWinner = t.recorded.routeDecision && t.recorded.routeDecision.winner;
  const newWinner = capturedRoute && capturedRoute.winner;
  let verdict;
  if (!t.recorded.routeDecision) verdict = 'no-recorded-decision';
  else if (recWinner === newWinner) verdict = '✅ winner-unchanged';
  else                              verdict = '⚠️  winner-changed';
  log(`verdict: ${verdict}`);
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
(async () => {
  const mongo = await MongoClient.connect(process.env.MONGODB_URI);
  const db    = mongo.db('clientsvia');

  // 1. Load Company
  const company = await db.collection('companiesCollection').findOne({ _id: new ObjectId(companyId) });
  if (!company) {
    console.error(`❌ Company ${companyId} not found`);
    await mongo.close();
    process.exit(1);
  }

  // 2. Load Customer + discoveryNote for this callSid
  const cust = await db.collection('customers').findOne({
    companyId:               new ObjectId(companyId),
    'discoveryNotes.callSid': callSid,
  });
  if (!cust) {
    console.error(`❌ No customer record contains callSid ${callSid} for company ${companyId}`);
    await mongo.close();
    process.exit(1);
  }

  const note = (cust.discoveryNotes || []).find(n => n.callSid === callSid);
  if (!note) {
    console.error(`❌ Customer ${cust.phone || cust._id} found but no discoveryNote with callSid`);
    await mongo.close();
    process.exit(1);
  }

  const turns = extractTurns(note.qaLog);
  if (turns.length === 0) {
    console.error(`❌ Call found but qaLog has no turns`);
    await mongo.close();
    process.exit(1);
  }

  // Emit banner
  log('');
  hr('═');
  log(`  REPLAY — ${company.companyName || companyId}`);
  log(`  callSid:  ${callSid}`);
  log(`  customer: ${cust.phone || '(no phone)'}`);
  log(`  turns:    ${turns.length}${onlyTurn !== null ? ` (replay filter: --turn ${onlyTurn})` : ''}`);
  hr('═');
  log('');

  // 3. Replay each turn
  const replayRecords = [];
  const targetTurns   = onlyTurn !== null ? turns.filter(t => t.turn === onlyTurn) : turns;

  for (const t of targetTurns) {
    if (!t.userInput) {
      log(`(turn ${t.turn} — no userInput in qaLog, skipping)`);
      continue;
    }

    // Capture all emit events for this turn
    const capturedEvents = [];
    const emitEvent = (type, data) => capturedEvents.push({ type, data });

    let replayResult = null;
    let replayError  = null;
    try {
      replayResult = await KCDiscoveryRunner.run({
        company,
        companyId,
        callSid:     `REPLAY_${callSid}`,   // distinct synthetic sid — prevents any
                                            // stray write from colliding with the real record
        userInput:   t.userInput,
        state:       {},                    // fresh state — replay is per-turn atomic
        emitEvent,
        turn:        t.turn,
        redis:       null,                  // no cache writes
      });
    } catch (e) {
      replayError = e;
    }

    // Find the KC_ROUTE_DECISION event in the capture
    const rdEvent = capturedEvents.find(e => e.type === 'KC_ROUTE_DECISION');
    const capturedRoute = rdEvent ? {
      winner:     rdEvent.data.winner,
      winnerBy:   rdEvent.data.winnerBy,
      runnerUp:   rdEvent.data.runnerUp,
      margin:     rdEvent.data.margin,
      candidates: rdEvent.data.candidates,
    } : null;

    if (replayError) {
      log(`TURN ${t.turn} — REPLAY ERROR: ${replayError.message}`);
      if (verbose) log(replayError.stack);
    } else if (!jsonOut) {
      renderTurn(t, capturedEvents, capturedRoute);
      log('');
    }

    replayRecords.push({
      turn:       t.turn,
      userInput:  t.userInput,
      recorded:   t.recorded.routeDecision,
      replayed:   capturedRoute,
      events:     capturedEvents.map(e => e.type),
      error:      replayError ? replayError.message : null,
    });
  }

  // 4. Summary
  if (!jsonOut) {
    hr('═');
    log('SUMMARY');
    hr('═');
    let unchanged = 0, changed = 0, noRecord = 0, errors = 0;
    for (const r of replayRecords) {
      if (r.error) { errors++; continue; }
      if (!r.recorded) { noRecord++; continue; }
      if (r.recorded.winner === (r.replayed && r.replayed.winner)) unchanged++;
      else changed++;
    }
    log(`  turns replayed:       ${replayRecords.length}`);
    log(`  winner unchanged:     ${unchanged}`);
    log(`  winner CHANGED:       ${changed}`);
    log(`  no recorded decision: ${noRecord}`);
    log(`  replay errors:        ${errors}`);
    log('');
  } else {
    console.log(JSON.stringify({
      companyId,
      callSid,
      companyName: company.companyName || null,
      turns:       replayRecords,
    }, null, 2));
  }

  await mongo.close();
  process.exit(0);
})().catch(err => {
  console.error('FATAL:', err.stack || err.message);
  process.exit(1);
});
