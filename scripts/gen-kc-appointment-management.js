#!/usr/bin/env node
/**
 * gen-kc-appointment-management.js
 * Generates kc-appointment-management.json — cancellations, reschedules, confirmations.
 *
 * PURPOSE:
 *   Handles callers managing existing appointments — cancelling, rescheduling,
 *   confirming, running late, or asking about their upcoming visit. These are
 *   logistics actions, not service questions.
 *
 * ROUTING SAFETY:
 *   - noAnchor=true — appointment management should NOT steal anchor
 *   - HVAC-specific negativeKeywords prevent matching on service questions
 *   - tradeTerms empty
 *
 * WORKFLOW:
 *   1. Create empty container titled "Appointment Management" in services.html
 *   2. Run: node scripts/gen-kc-appointment-management.js
 *   3. Import kc-appointment-management.json into the container
 *   4. Enable "No anchor (meta-container)" toggle
 *   5. Re-score All → Fix All → Generate Missing Audio
 *
 * 10 sections covering:
 *   - Cancel & reschedule (0-3)
 *   - Confirmation & status (4-6)
 *   - Day-of logistics (7-9)
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
  'warranty', 'guarantee',
];

const groqCat = {

  cancel_appointment: `The caller wants to cancel an existing appointment. Handle this smoothly without making them feel guilty or pressured to keep it.

RESPONSE APPROACH: Accept the cancellation gracefully. Confirm which appointment they are referring to if there could be any ambiguity. Process the cancellation and let them know it is taken care of. Offer to reschedule if appropriate, but do not push. The caller has made their decision.

TONE RULES: Professional and understanding. Life happens — people need to cancel. Do not guilt them, do not ask why, do not try to talk them out of it unless they seem undecided. If they volunteer a reason, acknowledge it naturally.

REDIRECT STRATEGY: After confirming the cancellation, offer to reschedule. "Would you like to reschedule for another time, or would you prefer to call back when you are ready?" This keeps the door open without pressure.

WHAT TO AVOID: Never guilt the caller about cancelling. Never charge a cancellation fee without being upfront about it beforehand. Never ask "why" in a way that sounds like you are questioning their decision. Never make cancellation difficult or bureaucratic.

RECOVERY FORMULA: Accept gracefully → Confirm cancellation → Offer to reschedule → Leave door open warmly.`,

  reschedule: `The caller wants to move their appointment to a different date or time. They are not cancelling — they still want the service.

RESPONSE APPROACH: This is a positive situation — the caller still wants service, they just need a different time. Be flexible and efficient. Pull up availability quickly and offer options. The faster you can confirm the new time, the better.

TONE RULES: Accommodating and efficient. The caller is juggling their schedule. Help them find a time that works. Do not make them feel like rescheduling is an inconvenience — it is a normal part of scheduling.

REDIRECT STRATEGY: Offer the closest available alternatives to their preferred time. "We have Tuesday afternoon or Wednesday morning open — which works better for you?" Give them choices and confirm quickly.

WHAT TO AVOID: Never make rescheduling sound like a hassle. Never limit their options unnecessarily. Never charge for rescheduling unless it is a clear policy communicated upfront. Make it easy.

RECOVERY FORMULA: Acknowledge the need → Check availability → Offer options → Confirm new time → Done.`,

  something_came_up: `The caller had something unexpected come up — emergency, work conflict, family situation — and needs to change or cancel their appointment. They may feel apologetic.

RESPONSE APPROACH: Be completely understanding. "No problem at all, these things happen." Take the pressure off and handle the change quickly. If they need to cancel, do it without guilt. If they can reschedule, find them a new time. Either way, make it easy.

TONE RULES: Warm and accommodating. The caller may be stressed about whatever came up AND about inconveniencing the company. Remove both sources of stress. "Do not worry about it at all" goes a long way.

REDIRECT STRATEGY: Ask whether they want to cancel or reschedule. If reschedule, find the next available time. If cancel, leave the door open. "Just call us whenever you are ready and we will get you right back on the schedule."

WHAT TO AVOID: Never make them explain what came up. Never sound annoyed or inconvenienced. Never make them feel bad about the situation. Handle it quickly and warmly.

RECOVERY FORMULA: Reassure ("No problem at all") → Ask cancel or reschedule → Handle it → Leave door open.`,

  cancel_fee: `The caller is asking about cancellation fees or penalties for changing their appointment. They want to know the financial consequences before making a change.

RESPONSE APPROACH: Be transparent about the policy. If there is no cancellation fee, say so — it is a selling point. If there is a fee, explain it clearly and fairly. Most service companies do not charge cancellation fees for standard appointments. Be clear about the distinction between cancellation and no-show.

TONE RULES: Transparent and fair. The caller is asking a reasonable question. Answer it directly. If the policy is customer-friendly (no fee), present it confidently. If there is a fee, explain it without being defensive.

REDIRECT STRATEGY: After explaining the policy, ask what they would like to do. If the policy is favorable, it may make them more comfortable proceeding with the change.

WHAT TO AVOID: Never surprise the caller with a fee they did not expect. Never be vague about the policy. Never make the fee sound punitive — frame it as a standard policy if it exists.

RECOVERY FORMULA: Explain policy clearly → If no fee, reassure → If fee, explain fairly → Ask what they want to do.`,

  confirm_appointment: `The caller wants to confirm that their appointment is still on. They want reassurance that someone is actually coming.

RESPONSE APPROACH: Confirm the appointment with specifics — date, time window, type of service. This gives the caller confidence that everything is set. Remind them about the courtesy call before arrival. Make them feel their appointment is solid.

TONE RULES: Confident and reassuring. The caller wants to hear "yes, you are all set." Give them that clearly. Review the details so they know you have them in the system.

REDIRECT STRATEGY: After confirming, ask if they have any other questions or changes. "You are all set for Thursday afternoon. Is there anything else you need before then?" This shows proactive care.

WHAT TO AVOID: Never be uncertain about the appointment. If you need to check, do so quickly and come back with a definitive answer. Never leave the caller with any doubt that the appointment is confirmed.

RECOVERY FORMULA: Confirm with specifics → Remind about courtesy call → Ask if they need anything else → Done.`,

  check_status: `The caller wants to check on the status of their appointment or a pending service request. They may be waiting for a callback or confirmation.

RESPONSE APPROACH: Look up their information and give them a status update. Be specific — if the appointment is confirmed, tell them when. If a callback is pending, give them a timeline. If there is a delay, be honest and give them a new estimate. Proactive communication prevents frustration.

TONE RULES: Informative and responsive. The caller reached out because they want information. Give it to them clearly and quickly. If news is good, share it. If there is a delay, own it honestly.

REDIRECT STRATEGY: After the update, ask if the current plan works for them or if they need to make changes. "Does that still work for you, or would you like to adjust?"

WHAT TO AVOID: Never say "someone will call you back" without a time frame. Never leave the status vague. Never blame other departments for delays. Own the communication.

RECOVERY FORMULA: Look up status → Give specific update → Offer adjustments if needed → Confirm next steps.`,

  technician_eta: `The caller is expecting a technician and wants to know when they will arrive. The appointment is today and they want an ETA.

RESPONSE APPROACH: Check the technician's schedule and provide the best estimate you can. If the tech is on the way, say so. If they are finishing a previous job, give an honest estimate. The courtesy call before arrival is the key reassurance — remind them about it.

TONE RULES: Responsive and specific. This caller is waiting at home. Respect that by being as precise as possible. If you cannot give an exact time, give a window and explain why. Active communication prevents frustration.

REDIRECT STRATEGY: Give the ETA, reassure about the courtesy call, and ask if the timing still works. If it does not, offer to adjust.

WHAT TO AVOID: Never say "they should be there soon" without a time frame. Never leave the caller guessing. Never forget to mention the courtesy call. If the tech is delayed, be honest immediately rather than letting the caller discover it.

RECOVERY FORMULA: Check schedule → Give best ETA → Mention courtesy call → Confirm it works for them.`,

  running_late: `The caller or the technician is running late. The caller may be letting the company know they will not be home on time, or they may be asking why the tech has not arrived yet.

RESPONSE APPROACH: If the caller is running late, reassure them. "No problem, the technician can adjust." If the technician is running late, apologize and give a new ETA. Either way, the goal is to keep the appointment on track with minimal stress.

TONE RULES: Flexible and understanding. Delays happen on both sides. Be gracious about it. If the tech is late, own it with a genuine apology and a specific new time. If the caller is late, be accommodating.

REDIRECT STRATEGY: Confirm the adjusted timing works for everyone and proceed with the appointment. Keep things moving forward rather than dwelling on the delay.

WHAT TO AVOID: Never blame the caller for being late. Never blame the tech without offering a solution. Never cancel the appointment due to a short delay without discussing options first.

RECOVERY FORMULA: Acknowledge the delay → Provide adjusted timing → Confirm it works → Proceed.`,
};

const sections = [

  // ════════════════════════════════════════════════════════════════════════
  // CANCEL & RESCHEDULE (0-3)
  // ════════════════════════════════════════════════════════════════════════

  { // 0
    label: 'Cancel Appointment',
    content: 'No problem at all, I can take care of that for you. Let me pull up your appointment and get it cancelled. If you want to reschedule for another time just give us a call whenever you are ready.',
    groqKey: 'cancel_appointment',
    callerPhrases: [
      'I need to cancel my appointment',
      'can I cancel the service call',
      'I want to cancel my appointment',
      'please cancel my upcoming appointment',
      'I need to cancel the technician visit',
      'can you cancel my service for me',
      'I am not going to be able to make the appointment',
      'go ahead and cancel my appointment',
      'I would like to cancel the visit',
      'please take me off the schedule',
      'I do not need the appointment anymore',
      'can you remove my appointment',
      'cancel the tech coming out please',
      'I changed my mind I want to cancel',
      'I will not be needing the service anymore',
    ],
    negativeKeywords: HVAC_NEG_KEYWORDS,
  },

  { // 1
    label: 'Reschedule Appointment',
    content: 'Of course, let me find you a new time. What works better for you and I will check what we have available? We will get you moved to a time that fits your schedule with no hassle at all.',
    groqKey: 'reschedule',
    callerPhrases: [
      'I need to reschedule my appointment',
      'can I move my appointment to another day',
      'I need to change the date of my appointment',
      'can we push my appointment back',
      'I need to move my appointment to next week',
      'can I switch to a different time',
      'I need to reschedule for a later date',
      'can I change my appointment time',
      'the current time does not work can I change it',
      'I need to bump my appointment to another day',
      'is it possible to move my appointment',
      'I want to reschedule to a different day',
      'can I get a different time slot',
      'the day you gave me does not work',
      'I need to move my appointment up sooner',
    ],
    negativeKeywords: HVAC_NEG_KEYWORDS,
  },

  { // 2
    label: 'Something Came Up',
    content: 'No worries at all, these things happen. Would you like to reschedule for another time or would you prefer to cancel for now and call back when things settle down? Either way is perfectly fine.',
    groqKey: 'something_came_up',
    callerPhrases: [
      'something came up I cannot make it',
      'I have an emergency I need to change my appointment',
      'something unexpected happened can I reschedule',
      'I have a conflict with my appointment',
      'my schedule changed I cannot do that day',
      'I had something come up at work',
      'a family thing came up I need to reschedule',
      'I am not going to be able to be there',
      'I just found out I have a conflict',
      'I have to deal with something else that day',
      'plans changed on my end',
      'I cannot make it anymore something came up',
      'I had an unexpected situation I need to move it',
      'my availability changed can we adjust',
      'I am sorry but I need to change my appointment',
    ],
    negativeKeywords: HVAC_NEG_KEYWORDS,
  },

  { // 3
    label: 'Cancellation Fee Question',
    content: 'There is no charge for cancelling or rescheduling your appointment. We understand that things change and we want to make this as easy as possible for you. Just let us know what you need.',
    groqKey: 'cancel_fee',
    callerPhrases: [
      'is there a cancellation fee',
      'do you charge to cancel',
      'will I be charged for cancelling',
      'is there a penalty for cancelling',
      'do you charge a cancellation fee',
      'will it cost me to reschedule',
      'is there a fee for changing my appointment',
      'what happens if I cancel last minute',
      'do you charge for no shows',
      'is there a penalty for rescheduling',
      'am I going to get charged for cancelling',
      'what is the cancellation policy',
      'do you have a cancellation fee policy',
      'will I lose money if I cancel',
      'is it free to cancel or reschedule',
    ],
    negativeKeywords: HVAC_NEG_KEYWORDS,
  },

  // ════════════════════════════════════════════════════════════════════════
  // CONFIRMATION & STATUS (4-6)
  // ════════════════════════════════════════════════════════════════════════

  { // 4
    label: 'Confirm My Appointment',
    content: 'Let me pull that up for you. I can confirm your appointment details and make sure everything is set. The technician will also give you a courtesy call on the way so you know exactly when to expect them.',
    groqKey: 'confirm_appointment',
    callerPhrases: [
      'I want to confirm my appointment',
      'is my appointment still on',
      'can you confirm my service call',
      'I just want to make sure my appointment is still scheduled',
      'is someone still coming out today',
      'I want to verify my appointment',
      'can you check if my appointment is confirmed',
      'I want to make sure I am on the schedule',
      'is the technician still coming',
      'just checking on my appointment',
      'I want to double check my appointment time',
      'am I still on the schedule for today',
      'can you verify the time for my appointment',
      'is everything still good for my appointment',
      'confirming that someone is coming out',
    ],
    negativeKeywords: HVAC_NEG_KEYWORDS,
  },

  { // 5
    label: 'Check Appointment Status',
    content: 'Let me look into that for you right now. I will check the status and give you an update on exactly where things stand. I want to make sure you have the information you need.',
    groqKey: 'check_status',
    callerPhrases: [
      'what is the status of my appointment',
      'I am checking on my service request',
      'has my appointment been confirmed yet',
      'I am waiting to hear back about my appointment',
      'was my appointment scheduled',
      'did someone process my request',
      'I called earlier and I am following up',
      'I have not heard back about my appointment',
      'can you check where my request stands',
      'what happened with my service request',
      'I am calling to follow up on my appointment',
      'is there an update on my service call',
      'I submitted a request and I am checking in',
      'has anyone looked at my appointment yet',
      'I just want to know where things are at',
    ],
    negativeKeywords: HVAC_NEG_KEYWORDS,
  },

  { // 6
    label: 'Technician ETA',
    content: 'Let me check on that for you. The technician will call you when they are on the way so you will have a heads up. Let me see where they are in the schedule right now and give you the best estimate.',
    groqKey: 'technician_eta',
    callerPhrases: [
      'when is the technician coming',
      'what time will they be here',
      'where is the tech',
      'how far away is the technician',
      'when should I expect someone',
      'the tech has not arrived yet',
      'I am still waiting for the technician',
      'when will someone get here',
      'is the tech on the way',
      'how much longer until they arrive',
      'nobody has shown up yet',
      'I was told someone would be here by now',
      'can you check where the technician is',
      'my window was supposed to start already',
      'they are late where are they',
    ],
    negativeKeywords: HVAC_NEG_KEYWORDS,
  },

  // ════════════════════════════════════════════════════════════════════════
  // DAY-OF LOGISTICS (7-9)
  // ════════════════════════════════════════════════════════════════════════

  { // 7
    label: 'Running Late',
    content: 'No problem at all, I appreciate you letting us know. The technician can adjust the timing. Just let us know when you will be available and we will make sure everything lines up for you.',
    groqKey: 'running_late',
    callerPhrases: [
      'I am running late for my appointment',
      'I will not be home on time',
      'I am going to be a few minutes late',
      'I am stuck in traffic can you push it back',
      'I need a little more time before the tech comes',
      'can you have the tech wait I am almost there',
      'I am behind schedule today',
      'my meeting ran over I will be late',
      'tell the technician I am running behind',
      'I just need another 30 minutes',
      'I am not quite ready yet',
      'can you push the appointment back a little',
      'I will be there soon just running late',
      'the tech might beat me there I am on my way',
      'I need to push back the time a little bit',
    ],
    negativeKeywords: HVAC_NEG_KEYWORDS,
  },

  { // 8
    label: 'Appointment Reminder',
    content: 'Yes your appointment is all set. I have you down and the technician will give you a call before heading your way. Is there anything else you need before then or any changes you want to make?',
    groqKey: 'confirm_appointment',
    callerPhrases: [
      'I am calling about my appointment tomorrow',
      'just wanted to make sure we are still good for tomorrow',
      'I have an appointment coming up',
      'reminding you about my appointment',
      'my appointment is soon I just want to confirm',
      'we have something scheduled I want to check on it',
      'is everything still on for my visit this week',
      'I have a tech coming soon is that still happening',
      'I want to make sure everything is set for my appointment',
      'just touching base about my upcoming appointment',
      'I have service scheduled can you confirm',
      'checking in about my appointment for this week',
      'making sure my appointment did not fall through the cracks',
      'I set up an appointment and want to make sure it is still on',
      'did my appointment get scheduled like I was told',
    ],
    negativeKeywords: HVAC_NEG_KEYWORDS,
  },

  { // 9
    label: 'Add Or Change Details',
    content: 'Of course, I can update that for you. Let me pull up your appointment and make the change so the technician has the right information. What do you need me to update?',
    groqKey: 'reschedule',
    callerPhrases: [
      'I need to update the address for my appointment',
      'can I change the contact number on my appointment',
      'I need to add a note for the technician',
      'the phone number on file is wrong',
      'can I update my information',
      'I need to change who will be there for the appointment',
      'I want to add a gate code for the tech',
      'can I leave a note about parking',
      'I need to change the name on the appointment',
      'there is a dog in the yard I want to let the tech know',
      'I need to update my callback number',
      'can I add instructions for finding my unit',
      'the access information needs to be updated',
      'I want to add a note that the tech should call first',
      'can I change some details on my appointment',
    ],
    negativeKeywords: HVAC_NEG_KEYWORDS,
  },
];

const output = {
  kcTitle: 'Appointment Management',
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

const outPath = path.join(__dirname, 'kc-appointment-management.json');
fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(`\n\u2705 Generated ${outPath}`);
console.log(`   ${output.sectionCount} sections, ${output.sections.reduce((n, s) => n + s.callerPhrases.length, 0)} callerPhrases`);
const cw = output.sections.map(s => s.content.split(/\s+/).length);
console.log(`   Content words: min=${Math.min(...cw)} max=${Math.max(...cw)} avg=${Math.round(cw.reduce((a,b)=>a+b,0)/cw.length)}`);
