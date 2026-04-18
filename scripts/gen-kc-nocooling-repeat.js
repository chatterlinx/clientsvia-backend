#!/usr/bin/env node
'use strict';

/**
 * ============================================================================
 * gen-kc-nocooling-repeat.js
 * ============================================================================
 *
 * Generates kc-nocooling-repeat.json — 2 new sections to extend the existing
 * "No Cooling" container with coverage for the two largest gap patterns from
 * the April 17 2026 gap report (17 events, 7 calls):
 *
 *   Pattern A — Obligation / Repeat Service Call  (2 events)
 *     Section: "No Cooling — Return Visit After Recent Repair"
 *     Caller question: "Do I have to pay for another service call?"
 *
 *   Pattern B — Tony-Was-Here New Symptom         (5 events)
 *     Section: "No Cooling — New Symptom After Recent Technician Visit"
 *     Caller pattern: "Tony was here, changed the motor, now water is leaking"
 *
 * tradeTerms are PRE-POPULATED using the phrase-only allowlist algorithm
 * (matches scripts/backfill-trade-terms.js). GATE 2.4 Field 8 lights up
 * immediately on import.
 *
 * IMPORT WORKFLOW:
 *   1. Run Phase 3 + Phase 4 scripts first (backfill + meta noAnchor flip)
 *   2. node scripts/gen-kc-nocooling-repeat.js
 *   3. Import kc-nocooling-repeat.json into "No Cooling" container
 *      via services-item.html Import button
 *   4. Re-score All → Fix All → Generate Missing Audio
 *   5. Verify Config Health tab shows 0 new HIGH/CRITICAL issues
 *
 * ============================================================================
 */

const fs   = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════════════
// GROQ CONTENT TEMPLATES — 350-400 words, no HVAC advice beyond policy
// ═══════════════════════════════════════════════════════════════════════════

const groqCat = {

  return_visit_after_recent_repair: `When a caller asks whether they need to pay for another service call after a recent visit, the answer depends on how recently the technician was there and what was done. The general policy is that if a callback is related to the same issue the technician just addressed, it is typically covered under the workmanship guarantee — no additional diagnostic fee, no additional trip charge. The caller is not being charged twice for the same problem.

If the call is a completely new issue that was not part of the original repair, a standard diagnostic fee applies. That fee is {reg_diagnostic_fee}, and it covers the technician's time to properly evaluate the new symptom. This is the same policy that would apply to any caller bringing up a new concern.

The important distinction is between a warranty callback and a new-problem visit. A warranty callback means the system is failing in a way directly tied to the previous repair — for example, the caller had a motor replaced and now the motor is not running, or the caller had a refrigerant charge done and the system is cooling poorly again within a short window. These are handled without a callback fee.

A new-problem visit is different — the system was cooling fine after the repair, and now a separate issue has appeared. A different part is failing, a different symptom is showing up, or enough time has passed that it is clearly an unrelated event. That visit carries the standard diagnostic fee because the technician has to start fresh and properly diagnose the new issue.

The agent should not make promises about what will or will not be charged without the dispatcher reviewing the original service ticket. The right move is to collect the caller's name and phone number, note that they are asking about a return visit on a recent repair, and schedule a visit so the technician can evaluate in person. Billing decisions are made by the office after the visit based on the work history, not by the agent on the phone.

If the caller pushes for a definitive answer on the phone, the agent should hold the line: the visit is scheduled, the technician evaluates, and the office reviews the history to determine fees. That protects the caller from being quoted incorrectly and protects the business from quoting a fee policy that does not match the original service ticket.`,

  new_symptom_after_recent_visit: `When a caller mentions that a technician was recently at the home, did a repair, and now a new or related symptom has appeared, the priority is to acknowledge the prior visit, show that the history matters, and move toward getting someone back out there. The caller is usually frustrated — they paid for a repair, and now something is still wrong or something new is wrong.

First, acknowledge the visit. If the caller uses the technician's name and a brief description of what was done — for example, "Tony was here and changed the motor" — the agent should use that information to show continuity. The caller should not feel like they are starting from scratch. The repair is on record, and the current symptom gets added to that record.

The key diagnostic question is whether the new symptom is related to the recent repair or a separate issue. A caller who had a motor replaced and is now reporting that water is leaking from the unit may be describing a related issue — the drain line might have been disturbed during the motor swap, or the condensate pan might have a crack. That is very different from a caller whose system cooled fine for two weeks after the repair and now has a completely unrelated issue.

The agent does not need to diagnose on the phone. The correct action is to schedule a return visit, note the recent repair in the discovery notes, and let the technician evaluate on site. The technician will review what was done previously, inspect the current symptom, and determine whether it is a warranty callback or a separate diagnostic event.

For symptoms that suggest active water damage — leaking, dripping, pooling water — the visit should be prioritized. Water can damage ceilings, walls, and floors quickly, and the caller has a legitimate urgency even if the cooling is still partially working.

The agent should collect the caller's name, phone number, and a brief description of the new symptom. If the caller remembers the original technician's name or roughly when the visit was, that is added to the ticket. The dispatcher will pull the original service record and assign the visit appropriately — often to the same technician if scheduling allows, since continuity helps diagnosis.`,

};

// ═══════════════════════════════════════════════════════════════════════════
// SECTIONS
// ═══════════════════════════════════════════════════════════════════════════

const sections = [

  { // Pattern A
    label: 'No Cooling — Return Visit After Recent Repair',
    content: 'If the callback is tied to the same repair we just did, it is covered under our workmanship guarantee. If it is a new issue, the standard diagnostic fee of {reg_diagnostic_fee} applies. The office reviews the original ticket to confirm.',
    groqKey: 'return_visit_after_recent_repair',
    callerPhrases: [
      'do I have to pay for another service call',
      'will I need to pay again for this',
      'am I going to get charged twice',
      'is there another fee for a return visit',
      'do I owe another diagnostic fee',
      'will there be another trip charge',
      'is this covered under warranty since you were just here',
      'do I have to pay if you come back out',
      'is there a callback fee',
      'am I required to pay a new service fee',
      'will this cost me more money',
      'do I pay the same diagnostic again',
      'is this a warranty visit or a new charge',
      'do you charge again when you come back',
      'am I paying for another visit on the same repair',
    ],
    anchorWords: [
      'pay', 'another', 'service', 'call', 'charge', 'fee', 'diagnostic',
      'trip', 'callback', 'warranty', 'visit', 'again', 'twice',
    ],
    tradeTerms: [
      'service call',
      'diagnostic fee',
      'trip charge',
      'callback',
      'warranty',
      'return visit',
      'repair',
    ],
    negativeKeywords: [
      'installation estimate',
      'new system pricing',
      'duct cleaning pricing',
      'maintenance plan pricing',
      'thermostat install pricing',
      'refrigerant recharge quote',
    ],
  },

  { // Pattern B
    label: 'No Cooling — New Symptom After Recent Technician Visit',
    content: 'Thanks for letting us know the tech was just out. I will log the recent repair with this new symptom and get someone back out to take a look. Let me grab your name and address so dispatch can pull the original ticket.',
    groqKey: 'new_symptom_after_recent_visit',
    callerPhrases: [
      'the tech was just here and now it is not cooling',
      'your guy came yesterday and now it is leaking',
      'the technician changed the motor and now water is leaking',
      'he just fixed it and now it is broken again',
      'someone was here last week and now it is not cold',
      'your tech replaced a part and now a new thing is wrong',
      'the repair guy left and now it is not working right',
      'Tony was here and now the unit is leaking water',
      'the guy fixed the ac and now it is freezing up',
      'you just sent someone and now it is making a weird noise',
      'the technician finished the job and now a different thing broke',
      'the tech came Tuesday and now there is water on the floor',
      'your company was just out and now it stopped cooling again',
      'he swapped the capacitor and now there is no air coming out',
      'the repair was done and now a new symptom started',
    ],
    anchorWords: [
      'tech', 'technician', 'just', 'came', 'here', 'yesterday', 'last',
      'week', 'now', 'leaking', 'water', 'motor', 'cooling', 'broken',
      'again', 'new', 'different', 'after',
    ],
    tradeTerms: [
      'technician',
      'cooling',
      'leaking',
      'water',
      'motor',
      'compressor',
      'capacitor',
      'refrigerant',
      'drain line',
      'repair',
    ],
    negativeKeywords: [
      'new installation quote',
      'maintenance plan sale',
      'duct cleaning pricing',
      'thermostat upgrade quote',
      'rebate program',
      'financing question',
    ],
  },

];

// ═══════════════════════════════════════════════════════════════════════════
// BUILD & VALIDATE
// ═══════════════════════════════════════════════════════════════════════════

const output = {
  kcTitle:        'No Cooling',
  exportType:     'append-sections',
  generatedAt:    new Date().toISOString(),
  sectionCount:   sections.length,
  sections: sections.map((s, i) => ({
    index:            i,
    label:            s.label,
    content:          s.content,
    groqContent:      groqCat[s.groqKey] || null,
    callerPhrases:    s.callerPhrases.map(text => ({
      text,
      anchorWords: s.anchorWords.filter(aw =>
        text.toLowerCase().split(/\s+/).some(w => w.replace(/[^a-z]/g, '').includes(aw))
      ),
    })),
    tradeTerms:       s.tradeTerms,
    negativeKeywords: s.negativeKeywords,
    useFixedResponse: true,
    isActive:         true,
  })),
};

// ── Validation ───────────────────────────────────────────────────────────
let errors = 0;
for (const s of output.sections) {
  const wc = s.content.split(/\s+/).length;
  if (wc < 25 || wc > 55) {
    console.warn(`⚠ Section ${s.index} "${s.label}" content: ${wc} words (target 30-42)`);
  }
  if (!s.groqContent) {
    console.error(`✗ Section ${s.index} "${s.label}" missing groqContent`);
    errors++;
  } else {
    const gwc = s.groqContent.split(/\s+/).length;
    if (gwc < 300 || gwc > 500) {
      console.warn(`⚠ Section ${s.index} "${s.label}" groqContent: ${gwc} words (target 350-400)`);
    }
  }
  if (s.callerPhrases.length < 10) {
    console.error(`✗ Section ${s.index} "${s.label}" only ${s.callerPhrases.length} phrases (min 10)`);
    errors++;
  }
  if (!Array.isArray(s.tradeTerms) || s.tradeTerms.length === 0) {
    console.warn(`⚠ Section ${s.index} "${s.label}" has no tradeTerms pre-populated`);
  }
  const emptyPhrases = s.callerPhrases.filter(p => !p.text.trim());
  if (emptyPhrases.length) {
    console.error(`✗ Section ${s.index} "${s.label}" has ${emptyPhrases.length} empty phrases`);
    errors++;
  }
}

if (errors > 0) {
  console.error(`\n✗ ${errors} error(s) found. Fix before importing.`);
  process.exit(1);
}

// ── Write ────────────────────────────────────────────────────────────────
const outPath = path.join(__dirname, 'kc-nocooling-repeat.json');
fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

console.log(`\n✅ Generated ${outPath}`);
console.log(`   ${output.sectionCount} sections`);
console.log(`   ${output.sections.reduce((n, s) => n + s.callerPhrases.length, 0)} total callerPhrases`);
console.log(`   ${output.sections.reduce((n, s) => n + (s.tradeTerms?.length || 0), 0)} total tradeTerms (pre-populated)`);
console.log(`   Import into "No Cooling" container → Re-score All → Fix All → Generate Missing Audio`);
