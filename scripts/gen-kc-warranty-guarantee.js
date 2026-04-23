#!/usr/bin/env node
/**
 * gen-kc-warranty-guarantee.js
 * Generates kc-warranty-guarantee.json — general warranty & service guarantee questions.
 *
 * PURPOSE:
 *   Handles warranty and guarantee questions that are NOT tied to a specific
 *   service container. "Do you guarantee your work?", "What if it breaks again?",
 *   "How long is the warranty?" These are trust-building questions.
 *
 * ROUTING SAFETY:
 *   - noAnchor=true — warranty questions should NOT steal anchor
 *   - HVAC-specific negativeKeywords prevent matching on service questions
 *   - no tradeVocabularyKey
 *
 * WORKFLOW:
 *   1. Create empty container titled "Warranty & Guarantee" in services.html
 *   2. Run: node scripts/gen-kc-warranty-guarantee.js
 *   3. Import kc-warranty-guarantee.json into the container
 *   4. Enable "No anchor (meta-container)" toggle
 *   5. Re-score All → Fix All → Generate Missing Audio
 *
 * 10 sections covering:
 *   - Work guarantee (0-3)
 *   - Manufacturer warranty (4-6)
 *   - Satisfaction & recourse (7-9)
 */
const fs = require('fs');
const path = require('path');

const HVAC_NEG_KEYWORDS = [
  'air conditioning', 'air conditioner', 'ac unit', 'heating', 'furnace',
  'thermostat', 'duct cleaning', 'duct work', 'compressor', 'refrigerant',
  'coolant', 'coil', 'condenser', 'evaporator', 'tune-up',
  'diagnostic fee', 'installation', 'replacement', 'hvac', 'blower',
  'filter', 'freon', 'capacitor', 'heat pump', 'dryer vent',
  'not cooling', 'not heating', 'no cool', 'no heat', 'frozen line',
  'ice on', 'leaking water', 'strange noise', 'burning smell',
  'maintenance plan', 'membership', 'price', 'cost', 'charge',
];

const groqCat = {

  work_guarantee: `The caller wants to know if the company guarantees its work. This is a trust and confidence question — they want assurance that if something goes wrong after the service, they are not left paying again.

RESPONSE APPROACH: Answer with confidence and specifics. Explain what the guarantee covers — labor, parts, or both. Give a time frame if one exists. The caller wants to hear that the company stands behind its work, not a vague "we guarantee everything."

TONE RULES: Confident and clear. A strong guarantee communicated confidently is one of the most persuasive things an agent can say. Do not hedge or add excessive caveats. Lead with what IS covered, not what is not.

REDIRECT STRATEGY: After explaining the guarantee, transition to scheduling. The guarantee often resolves the caller's last hesitation. "So you are covered. Would you like to go ahead and get this on the schedule?"

WHAT TO AVOID: Never be vague about what the guarantee covers. Never say "it depends" without explaining on what. Never make the guarantee sound complicated. Simple and strong is the goal.

RECOVERY FORMULA: Confirm guarantee exists → Explain what is covered and for how long → Reassure → Offer to schedule.`,

  breaks_again: `The caller is worried about paying for a repair and then having the same problem come back. This is a value and trust concern — they want protection against repeat failures.

RESPONSE APPROACH: Explain the warranty on the specific work. If the same issue recurs within the warranty period, the company comes back at no additional charge. This is the single most important thing the caller needs to hear. Be specific about the time frame and what "same issue" means.

TONE RULES: Reassuring and specific. The caller has probably been burned before. Give them the confidence that this time is different. Specificity builds trust — "if the same problem comes back within 90 days, we come back at no charge" is powerful.

REDIRECT STRATEGY: The warranty on repair work is often the final piece a hesitant caller needs. After explaining it, ask if they are ready to schedule. The protection is in place — now it is about getting the work done.

WHAT TO AVOID: Never say "that rarely happens" — it dismisses their concern. Never be vague about the warranty period. Never add so many caveats that the guarantee sounds meaningless. Lead with the coverage, add limits only if asked.

RECOVERY FORMULA: Acknowledge concern → Explain warranty specifically → Reassure ("We come back at no charge") → Schedule.`,

  warranty_duration: `The caller wants to know how long the warranty lasts. Simple but important question.

RESPONSE APPROACH: Give the specific time frame. If different types of work have different warranty periods (repairs vs installation vs parts), clarify which one applies to their situation. If you do not know their specific situation, give the general range and offer to confirm once the work is done.

TONE RULES: Informative and straightforward. This is a factual question — answer it with facts. If the warranty period is strong, let the number speak for itself.

REDIRECT STRATEGY: After stating the duration, check if they have other questions or if they are ready to schedule. A confident warranty answer often clears the path to scheduling.

WHAT TO AVOID: Never guess at warranty periods. If it varies, say so and explain the range. Never make promises about warranty coverage you are not sure about.

RECOVERY FORMULA: State duration clearly → Distinguish types if applicable → Offer to confirm specifics → Schedule.`,

  parts_vs_labor: `The caller wants to understand whether the warranty covers parts, labor, or both. This level of detail shows they are serious about making a decision.

RESPONSE APPROACH: Break it down clearly. Parts warranty often comes from the manufacturer. Labor warranty comes from the service company. Explain both components so the caller understands their full coverage. If the company provides a combined warranty, say that — it is simpler and more reassuring.

TONE RULES: Detailed and helpful. This caller wants specifics — give them. The more precise you are, the more confidence they have. Do not oversimplify to the point of being inaccurate.

REDIRECT STRATEGY: After the breakdown, confirm they feel comfortable with the coverage and offer to schedule. This caller is doing their due diligence — respect it and help them through it.

WHAT TO AVOID: Never lump parts and labor together if they have different terms. Never be vague about which warranty covers what. Precision builds trust with detail-oriented callers.

RECOVERY FORMULA: Explain parts warranty → Explain labor warranty → Clarify the full picture → Schedule.`,

  manufacturer_warranty: `The caller is asking about the manufacturer warranty on their system — whether it is still valid, what it covers, or how to use it.

RESPONSE APPROACH: Explain that manufacturer warranties typically cover major components like compressors and heat exchangers for a set number of years. The terms depend on the manufacturer and installation date. The technician can check warranty status during the visit. Encourage them to have any paperwork available but reassure that the tech can look it up.

TONE RULES: Knowledgeable and helpful. Warranty terms can be confusing — help the caller understand the basics without overwhelming them with details they do not need yet.

REDIRECT STRATEGY: Position the service visit as the way to get warranty questions answered definitively. "The technician can check your warranty status when they are there and let you know exactly what is covered." This moves toward scheduling.

WHAT TO AVOID: Never make promises about manufacturer warranty coverage without seeing the system. Never say "it should be covered" — the tech needs to verify. Be helpful without making claims.

RECOVERY FORMULA: Explain general manufacturer warranty → Note tech can verify specifics → Encourage scheduling → Offer to help.`,

  void_warranty: `The caller is worried about whether something they did or did not do (like skipping maintenance) may have voided their warranty. This is a concern-driven question.

RESPONSE APPROACH: Be honest without alarming them. Most manufacturers require annual maintenance but do not automatically void the entire warranty for missing one year. The technician can assess the specific situation. Encourage them to get service to protect their coverage going forward even if past maintenance was missed.

TONE RULES: Reassuring but honest. Do not guarantee coverage that may not exist, but do not alarm them about coverage they may still have. Position the service visit as the next step to clarity.

REDIRECT STRATEGY: Frame the visit as protective. "Getting maintenance now helps protect your warranty going forward, and the tech can check on your current coverage." This gives them a reason to schedule regardless of past history.

WHAT TO AVOID: Never say their warranty is definitely voided. Never guarantee it is definitely valid. Position the tech visit as the answer to their question. Never make them feel guilty about skipping maintenance.

RECOVERY FORMULA: Reassure without guaranteeing → Explain general rules → Position visit as the answer → Schedule.`,

  satisfaction_guarantee: `The caller wants to know what happens if they are not satisfied with the work. They want to understand the recourse if things do not go well.

RESPONSE APPROACH: Explain the satisfaction process. Most companies will come back and address any concerns at no additional charge. The goal is to make the caller feel safe making the decision to hire the company. A satisfaction guarantee removes the last barrier to saying yes.

TONE RULES: Confident and customer-focused. The company stands behind its work. Communicate that clearly and without hesitation. A strong satisfaction guarantee is a competitive advantage — present it that way.

REDIRECT STRATEGY: The satisfaction guarantee is often the final confidence boost a caller needs. After explaining it, move to scheduling. "We stand behind our work, and if you are not satisfied, we come back and make it right. Ready to get this scheduled?"

WHAT TO AVOID: Never make the satisfaction guarantee sound conditional or bureaucratic. Keep it simple and strong. Never add fine print in conversation. If there are limitations, they can be addressed if they come up — do not lead with them.

RECOVERY FORMULA: State the guarantee clearly → Explain the process if needed → Reassure → Schedule.`,

  callback_for_issues: `The caller wants to know what happens if they have a problem after the technician leaves. They want to know the process for getting follow-up help.

RESPONSE APPROACH: Explain the process simply. If something comes up after the visit, they call back and the company sends someone out to address it. If it is related to the original work and within the warranty period, there is no additional charge. Make it sound easy because it should be easy.

TONE RULES: Reassuring and practical. The caller wants to know they will not be abandoned after the visit. A clear follow-up process provides that comfort.

REDIRECT STRATEGY: After explaining the follow-up process, offer to schedule the initial visit. The caller now knows they have support after the work is done.

WHAT TO AVOID: Never make the follow-up process sound complicated. Never suggest that issues after service are unusual. Never make the caller feel like following up is a burden to the company.

RECOVERY FORMULA: Explain the process ("Just call us back") → Clarify warranty coverage → Reassure it is simple → Schedule initial visit.`,
};

const sections = [

  // ════════════════════════════════════════════════════════════════════════
  // WORK GUARANTEE (0-3)
  // ════════════════════════════════════════════════════════════════════════

  { // 0
    label: 'Do You Guarantee Your Work',
    content: 'Absolutely. We stand behind every job we do. Our work comes with a warranty so if something is not right we come back and make it right at no additional charge to you. That is our commitment.',
    groqKey: 'work_guarantee',
    callerPhrases: [
      'do you guarantee your work',
      'is the work guaranteed',
      'do you stand behind your work',
      'what kind of guarantee do you offer',
      'is there a warranty on the service',
      'do you warranty your repairs',
      'do you guarantee the job will be done right',
      'what guarantees do I have',
      'is your work backed by a warranty',
      'do I get any kind of guarantee',
      'are your services guaranteed',
      'what if the work is not done right',
      'how do I know the job will be done properly',
      'do you back up your service',
      'is there any guarantee on the labor',
    ],
    negativeKeywords: HVAC_NEG_KEYWORDS,
  },

  { // 1
    label: 'What If It Breaks Again',
    content: 'If the same issue comes back within the warranty period we come back and take care of it at no additional charge. You will not have to pay twice for the same problem. That is part of how we do business.',
    groqKey: 'breaks_again',
    callerPhrases: [
      'what if it breaks again after you fix it',
      'what happens if the same problem comes back',
      'what if the repair does not hold',
      'do I pay again if it is not fixed',
      'what if the issue returns after the repair',
      'what if it stops working again right after',
      'am I covered if the same thing happens again',
      'what if it fails again in a week',
      'what if it goes out again after the service',
      'what happens if the fix does not last',
      'will I be charged if the problem comes back',
      'what if I need you to come back for the same issue',
      'do you charge for a callback on the same problem',
      'what protection do I have if it breaks again',
      'how do I know this will actually fix it',
    ],
    negativeKeywords: HVAC_NEG_KEYWORDS,
  },

  { // 2
    label: 'How Long Is The Warranty',
    content: 'Our warranty covers the work for a set period after service is completed. The exact duration depends on the type of work done. The technician will go over all the warranty details with you so you know exactly what is covered and for how long.',
    groqKey: 'warranty_duration',
    callerPhrases: [
      'how long is the warranty',
      'what is the warranty period',
      'how long am I covered',
      'how many days is the warranty',
      'is the warranty 30 days or longer',
      'what is the guarantee time frame',
      'how long does the warranty last',
      'for how long is the work covered',
      'is there a 90 day warranty',
      'do you offer a one year warranty',
      'when does the warranty expire',
      'how long after the service am I covered',
      'what is the duration of your guarantee',
      'how long until the warranty runs out',
      'is the warranty the same for all services',
    ],
    negativeKeywords: HVAC_NEG_KEYWORDS,
  },

  { // 3
    label: 'Parts vs Labor Warranty',
    content: 'Great question. Parts typically carry the manufacturer warranty and our labor is covered by our own service warranty. Between the two you have protection on both sides. The technician can walk you through the specifics.',
    groqKey: 'parts_vs_labor',
    callerPhrases: [
      'does the warranty cover parts and labor',
      'is labor included in the warranty',
      'are parts covered under the warranty',
      'what does the warranty actually cover',
      'does the warranty include the parts you install',
      'am I covered on parts or just labor',
      'is the labor guaranteed separately from parts',
      'do you warranty the parts you use',
      'what exactly is covered under warranty',
      'does the guarantee include everything',
      'if a part fails is that covered',
      'who covers the parts the manufacturer or you',
      'is there a separate warranty for parts',
      'what is the breakdown of the warranty coverage',
      'are replacement parts under warranty too',
    ],
    negativeKeywords: HVAC_NEG_KEYWORDS,
  },

  // ════════════════════════════════════════════════════════════════════════
  // MANUFACTURER WARRANTY (4-6)
  // ════════════════════════════════════════════════════════════════════════

  { // 4
    label: 'Manufacturer Warranty Question',
    content: 'Manufacturer warranties typically cover major components for a set number of years. The technician can check your specific warranty status during the visit and let you know exactly what is covered. Having any paperwork helps but is not required.',
    groqKey: 'manufacturer_warranty',
    callerPhrases: [
      'is my system still under warranty',
      'does the manufacturer warranty cover this',
      'how do I check my warranty',
      'is my unit still covered by the manufacturer',
      'what does the factory warranty include',
      'how long is the manufacturer warranty on my system',
      'can you check if my warranty is still valid',
      'does my warranty cover this type of repair',
      'I think my system is still under warranty',
      'the manufacturer should cover this right',
      'how do I use my manufacturer warranty',
      'who do I contact about my warranty',
      'is the warranty based on when it was installed',
      'what parts are under the manufacturer warranty',
      'does the warranty transfer to new homeowners',
    ],
    negativeKeywords: HVAC_NEG_KEYWORDS,
  },

  { // 5
    label: 'Worried About Voiding Warranty',
    content: 'I understand that concern. Missing maintenance does not automatically void everything. The best step is to get service now to protect your coverage going forward. The technician can check your specific warranty status on site.',
    groqKey: 'void_warranty',
    callerPhrases: [
      'will this void my warranty',
      'I skipped maintenance will that affect my warranty',
      'can you void the warranty by not doing maintenance',
      'if I did not do annual maintenance is the warranty gone',
      'does the warranty require yearly service',
      'I missed a year of maintenance is my warranty void',
      'can the manufacturer deny my warranty claim',
      'what happens to my warranty if I skipped maintenance',
      'will they still honor the warranty',
      'does the warranty require professional maintenance',
      'am I in trouble for not doing maintenance',
      'I have not had the system serviced in a while',
      'do I need maintenance records for the warranty',
      'is my warranty still good if I missed a year',
      'what if I cannot prove I had maintenance done',
    ],
    negativeKeywords: HVAC_NEG_KEYWORDS,
  },

  { // 6
    label: 'Extended Warranty Question',
    content: 'Extended warranties can provide additional coverage beyond the manufacturer standard period. The technician can review your current coverage and explain what options might make sense for your system and situation.',
    groqKey: 'warranty_duration',
    callerPhrases: [
      'do you offer extended warranties',
      'can I buy extra warranty coverage',
      'is there an extended warranty option',
      'can I extend my warranty',
      'do you have an extended service agreement',
      'what happens after the warranty expires',
      'is there a way to get more coverage',
      'can I purchase additional protection',
      'do you sell extended warranty plans',
      'what are my options for longer coverage',
      'my warranty is about to expire what can I do',
      'is there a protection plan I can buy',
      'can I get more warranty time',
      'do you offer warranty extensions',
      'what is available beyond the standard warranty',
    ],
    negativeKeywords: HVAC_NEG_KEYWORDS,
  },

  // ════════════════════════════════════════════════════════════════════════
  // SATISFACTION & RECOURSE (7-9)
  // ════════════════════════════════════════════════════════════════════════

  { // 7
    label: 'Satisfaction Guarantee',
    content: 'Your satisfaction is our priority. If you are not happy with the work we come back and address it until it is right. We do not consider the job done until you are satisfied. That is how we operate.',
    groqKey: 'satisfaction_guarantee',
    callerPhrases: [
      'do you have a satisfaction guarantee',
      'what if I am not happy with the work',
      'what happens if I am not satisfied',
      'can I get my money back if I am not happy',
      'what is your satisfaction policy',
      'do you guarantee customer satisfaction',
      'what recourse do I have if the work is bad',
      'what if the technician does a poor job',
      'will you make it right if I am not satisfied',
      'what is your policy on unsatisfied customers',
      'do you offer any kind of money back guarantee',
      'what if the job is not up to my standards',
      'how do you handle unhappy customers',
      'can I complain if the service is not good',
      'what happens if I have a problem with the work',
    ],
    negativeKeywords: HVAC_NEG_KEYWORDS,
  },

  { // 8
    label: 'Follow Up After Service',
    content: 'If anything comes up after the visit just give us a call. We will get someone back out to address it. If it is related to the original work and within the warranty period there is no additional charge. We have got you covered.',
    groqKey: 'callback_for_issues',
    callerPhrases: [
      'what if I have a problem after the tech leaves',
      'who do I call if something goes wrong after',
      'what if the issue comes back the next day',
      'can I call back if something is not right',
      'what is the process if I need a follow up',
      'how do I reach you if there is an issue after the visit',
      'what if I notice a problem after they leave',
      'is there support after the service is done',
      'what happens if I need someone to come back',
      'can I get a callback if it is not working right',
      'what if I have questions after the appointment',
      'who do I contact if there is a follow up issue',
      'do you do follow up visits',
      'what if something else goes wrong after the repair',
      'is there a way to reach someone after hours if there is a problem',
    ],
    negativeKeywords: HVAC_NEG_KEYWORDS,
  },

  { // 9
    label: 'Written Warranty Or Documentation',
    content: 'The technician will provide documentation of the work completed and the warranty details before they leave. You will have everything in writing so you know exactly what was done and what is covered.',
    groqKey: 'work_guarantee',
    callerPhrases: [
      'will I get the warranty in writing',
      'do you provide documentation of the work',
      'can I get a written warranty',
      'will I get a receipt with warranty info',
      'do you leave paperwork after the service',
      'can I get everything documented',
      'will there be a written record of what was done',
      'do you give an invoice with warranty terms',
      'I want the warranty in writing',
      'is there a warranty certificate',
      'do you email a summary after the visit',
      'will I get proof of the work done',
      'can I get a copy of the warranty',
      'do you provide a detailed invoice',
      'I need documentation for my records',
    ],
    negativeKeywords: HVAC_NEG_KEYWORDS,
  },
];

const output = {
  kcTitle: 'Warranty & Guarantee',
  kcId: null,
  exportedAt: new Date().toISOString(),
  sectionCount: sections.length,
  sections: sections.map((s, i) => ({
    index: i, label: s.label, content: s.content,
    groqContent: groqCat[s.groqKey] || null,
    callerPhrases: s.callerPhrases, negativeKeywords: s.negativeKeywords,
    isFixed: true, hasAudio: false, isActive: true,
  })),
};

let errors = 0;
for (const s of output.sections) {
  const wc = s.content.split(/\s+/).length;
  if (wc < 25 || wc > 50) console.warn(`\u26A0 Section ${s.index} "${s.label}" content: ${wc} words`);
  if (!s.groqContent) { console.error(`\u2717 Section ${s.index} "${s.label}" missing groqContent`); errors++; }
  else if (s.groqContent.length < 400) { console.error(`\u2717 Section ${s.index} "${s.label}" groqContent only ${s.groqContent.length} chars`); errors++; }
  if (s.callerPhrases.length < 5) { console.error(`\u2717 Section ${s.index} "${s.label}" only ${s.callerPhrases.length} phrases`); errors++; }
  if (s.callerPhrases.filter(p => !p.trim()).length) { console.error(`\u2717 Section ${s.index} "${s.label}" has empty phrases`); errors++; }
}
if (errors > 0) { console.error(`\n\u2717 ${errors} error(s).`); process.exit(1); }

const outPath = path.join(__dirname, 'kc-warranty-guarantee.json');
fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(`\n\u2705 Generated ${outPath}`);
console.log(`   ${output.sectionCount} sections, ${output.sections.reduce((n, s) => n + s.callerPhrases.length, 0)} callerPhrases`);
const cw = output.sections.map(s => s.content.split(/\s+/).length);
console.log(`   Content words: min=${Math.min(...cw)} max=${Math.max(...cw)} avg=${Math.round(cw.reduce((a,b)=>a+b,0)/cw.length)}`);
