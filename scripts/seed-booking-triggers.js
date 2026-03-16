/**
 * ============================================================================
 * SEED BOOKING TRIGGERS — Demo / Starter Pack
 * ============================================================================
 *
 * Seeds 22 realistic booking trigger scenarios into CompanyBookingTrigger.
 * Covers all 3 behaviors (INFO, BLOCK, REDIRECT) across all booking steps.
 * Written as HVAC/home-services examples — rename labels/answers per tenant.
 *
 * Usage:
 *   node scripts/seed-booking-triggers.js [companyId]
 *
 *   Defaults to PENGUIN_AIR_ID if no arg provided.
 *   Safe to re-run — idempotent (upserts on ruleId).
 *
 * ============================================================================
 */

'use strict';

require('dotenv').config();
const mongoose = require('mongoose');

const PENGUIN_AIR_ID = '68e3f77a9d623b8058c700c4';
const COMPANY_ID = process.argv[2] || PENGUIN_AIR_ID;

// ─────────────────────────────────────────────────────────────────────────────
// SEED DATA — 22 scenarios
// ─────────────────────────────────────────────────────────────────────────────
//
// BEHAVIOR GUIDE:
//   INFO     — play response, HOLD the current step (booking resumes next turn)
//   BLOCK    — play response, FREEZE step (must change intent to advance)
//   REDIRECT — play response, SWITCH bookingMode + clear slots + re-fetch times
//
// firesOnSteps: ['ANY'] fires on every step. Use specific steps to avoid noise.
// ─────────────────────────────────────────────────────────────────────────────

const TRIGGERS = [

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 1 — PRICING & PROMOTIONS (INFO / REDIRECT)
  // ══════════════════════════════════════════════════════════════════════════

  {
    ruleId:      'promo.service_call_special',
    label:       '$89 Service Call Special',
    description: 'Caller asks about or references a promotional service call price',
    priority:    10,
    firesOnSteps: ['ANY'],
    behavior:    'INFO',
    keywords:    ['89', 'special', 'promo', 'deal', 'discount', 'promotion'],
    phrases:     ['$89', '89 dollar', 'service call special', 'current special'],
    answerText:  'Yes! Our standard service call is $89, which includes the diagnostic and the first 30 minutes of labor. If a repair is needed, we give you a full quote before we start. Would you like to go ahead and schedule?',
    followUpQuestion: ''
  },

  {
    ruleId:      'promo.maintenance_39',
    label:       '$39 Maintenance Special — REDIRECT',
    description: 'Caller wants the $39 maintenance promo — redirects booking to maintenance service type',
    priority:    5,
    firesOnSteps: ['ANY'],
    behavior:    'REDIRECT',
    redirectMode: 'maintenance',
    keywords:    ['39', 'maintenance', 'special', 'tune', 'tuneup', 'deal'],
    phrases:     ['$39', '39 dollar', 'maintenance special', 'tune up special', 'maintenance deal'],
    answerText:  "Great choice — our $39 maintenance special is running this week. I'm switching you over to our maintenance schedule right now.",
    followUpQuestion: ''
  },

  {
    ruleId:      'promo.financing',
    label:       'Financing / Payment Plans',
    description: 'Caller asks about financing or payment options',
    priority:    20,
    firesOnSteps: ['ANY'],
    behavior:    'INFO',
    keywords:    ['finance', 'financing', 'payment', 'plan', 'monthly', 'credit', 'loan', 'afford'],
    phrases:     ['payment plan', 'financing options', 'pay monthly', 'no credit check', '0 percent'],
    answerText:  "We do offer financing through Wells Fargo and GreenSky — 12 months same as cash with approved credit. I can have someone from our office call you right after booking to go over options. Let's get your appointment locked in first.",
    followUpQuestion: ''
  },

  {
    ruleId:      'promo.senior_discount',
    label:       'Senior / Military Discount',
    description: 'Caller asks about senior citizen or military discounts',
    priority:    20,
    firesOnSteps: ['ANY'],
    behavior:    'INFO',
    keywords:    ['senior', 'military', 'veteran', 'discount', 'retired'],
    phrases:     ['senior discount', 'military discount', 'veteran discount', 'aarp'],
    answerText:  "Yes, we offer a 10% discount for seniors 65+ and all active and retired military. Just mention it when the tech arrives and they'll apply it to your invoice automatically.",
    followUpQuestion: ''
  },

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 2 — SERVICE TYPE CHANGES / REDIRECTS
  // ══════════════════════════════════════════════════════════════════════════

  {
    ruleId:      'redirect.emergency',
    label:       'Emergency / Same-Day → Emergency Service',
    description: 'Caller mentions no AC/heat, emergency, or same-day urgency mid-booking',
    priority:    1,
    firesOnSteps: ['OFFER_TIMES', 'CONFIRM'],
    behavior:    'REDIRECT',
    redirectMode: 'emergency',
    keywords:    ['emergency', 'asap', 'today', 'now', 'urgent', 'hot', 'cold', 'freezing', 'burning'],
    phrases:     ['no air', 'no heat', 'not working', 'broke down', 'same day', 'right now', 'cant wait', "can't wait"],
    negativeKeywords: ['schedule', 'next week', 'whenever'],
    answerText:  "That sounds like it needs immediate attention — I'm switching you to our same-day emergency line. We have priority slots available.",
    followUpQuestion: ''
  },

  {
    ruleId:      'redirect.new_install',
    label:       'New Installation → Install Service Type',
    description: 'Caller realizes they want a new unit installed, not a repair',
    priority:    15,
    firesOnSteps: ['ANY'],
    behavior:    'REDIRECT',
    redirectMode: 'new_install',
    keywords:    ['new', 'install', 'replace', 'replacement', 'unit', 'system'],
    phrases:     ['new unit', 'new system', 'full replacement', 'install a new', 'replace my', 'new ac', 'new heat'],
    negativeKeywords: ['filter', 'thermostat', 'part'],
    answerText:  "Got it — a new installation is a bigger job and we'd love to help. I'm switching you to our installation scheduling so we can set up the right appointment.",
    followUpQuestion: ''
  },

  {
    ruleId:      'redirect.duct_cleaning',
    label:       'Duct Cleaning → Duct Service Type',
    description: 'Caller pivots to duct cleaning mid-booking',
    priority:    30,
    firesOnSteps: ['ANY'],
    behavior:    'REDIRECT',
    redirectMode: 'duct_cleaning',
    keywords:    ['duct', 'ducts', 'vents', 'cleaning', 'clean', 'air quality', 'dusty'],
    phrases:     ['duct cleaning', 'clean my ducts', 'clean the vents', 'air duct'],
    answerText:  "Duct cleaning — great idea. I'm pulling up our duct cleaning availability for you now.",
    followUpQuestion: ''
  },

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 3 — TIMING & SCHEDULING QUESTIONS (INFO)
  // ══════════════════════════════════════════════════════════════════════════

  {
    ruleId:      'schedule.weekend',
    label:       'Weekend / After-Hours Availability',
    description: 'Caller asks about weekend or evening appointments',
    priority:    25,
    firesOnSteps: ['OFFER_TIMES', 'COLLECT_ADDRESS'],
    behavior:    'INFO',
    keywords:    ['weekend', 'saturday', 'sunday', 'evening', 'night', 'after hours', 'after 5'],
    phrases:     ['weekend appointment', 'saturday available', 'sunday available', 'after 5', 'after hours'],
    answerText:  "Yes, we have weekend and evening slots available. I'm pulling up the next available times right now — let's see what works for you.",
    followUpQuestion: ''
  },

  {
    ruleId:      'schedule.how_long',
    label:       'How Long Will It Take?',
    description: 'Caller asks how long the appointment will take',
    priority:    40,
    firesOnSteps: ['OFFER_TIMES', 'CONFIRM'],
    behavior:    'INFO',
    keywords:    ['long', 'hours', 'time', 'duration', 'how long', 'quick'],
    phrases:     ['how long will it take', 'how long does it take', 'how many hours', 'quick visit'],
    answerText:  "A standard service call is typically 1 to 2 hours. If it's a more involved repair we'll give you a heads-up before extending. Our tech will call you 30 minutes before arriving.",
    followUpQuestion: ''
  },

  {
    ruleId:      'schedule.arrival_window',
    label:       'Arrival Window / Exact Time',
    description: 'Caller wants to know exact arrival time or tight window',
    priority:    40,
    firesOnSteps: ['OFFER_TIMES', 'CONFIRM'],
    behavior:    'INFO',
    keywords:    ['exact', 'window', 'arrive', 'arrival', 'precise', 'morning', 'afternoon'],
    phrases:     ['what time exactly', 'arrival window', 'narrow window', '2 hour window', 'morning slot', 'afternoon slot'],
    answerText:  "We give a 2-hour arrival window and our tech will call or text you 30 minutes ahead. We do our best to be on the earlier side of the window.",
    followUpQuestion: ''
  },

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 4 — QUALIFICATION / COVERAGE (INFO)
  // ══════════════════════════════════════════════════════════════════════════

  {
    ruleId:      'qualify.service_area',
    label:       'Service Area / Location Coverage',
    description: 'Caller asks if their area or city is covered',
    priority:    15,
    firesOnSteps: ['COLLECT_ADDRESS', 'ANY'],
    behavior:    'INFO',
    keywords:    ['area', 'cover', 'service', 'location', 'come to', 'travel', 'far'],
    phrases:     ['do you cover', 'do you come to', 'service my area', 'too far', 'within range'],
    answerText:  "We service the greater metro area and surrounding counties. Once you give me your address I can confirm coverage in just a second.",
    followUpQuestion: ''
  },

  {
    ruleId:      'qualify.brand',
    label:       'Brand / Equipment Type Question',
    description: 'Caller asks if we service their specific brand',
    priority:    30,
    firesOnSteps: ['ANY'],
    behavior:    'INFO',
    keywords:    ['brand', 'carrier', 'trane', 'lennox', 'rheem', 'goodman', 'york', 'american standard', 'model'],
    phrases:     ['do you service', 'do you work on', 'brand you work on'],
    answerText:  "We service all major brands — Carrier, Trane, Lennox, Rheem, Goodman, York, and more. As long as it's a standard residential system we can handle it.",
    followUpQuestion: ''
  },

  {
    ruleId:      'qualify.warranty',
    label:       'Warranty / Covered Under Warranty',
    description: 'Caller asks about warranty coverage on existing equipment',
    priority:    20,
    firesOnSteps: ['ANY'],
    behavior:    'INFO',
    keywords:    ['warranty', 'warrantied', 'covered', 'manufacturer', 'parts warranty'],
    phrases:     ['under warranty', 'still under warranty', 'warranty cover', 'is it covered'],
    answerText:  "We honor all manufacturer warranties and our own 1-year labor warranty on every repair. If your unit is still under manufacturer warranty, we can work directly with them — just have your model and serial number handy for the tech.",
    followUpQuestion: ''
  },

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 5 — CALLER HESITATIONS / OBJECTIONS (INFO or BLOCK)
  // ══════════════════════════════════════════════════════════════════════════

  {
    ruleId:      'objection.too_expensive',
    label:       'Price Too High / Too Expensive',
    description: 'Caller objects to pricing during booking',
    priority:    10,
    firesOnSteps: ['OFFER_TIMES', 'CONFIRM'],
    behavior:    'BLOCK',
    keywords:    ['expensive', 'pricey', 'too much', 'cheap', 'cheaper', 'competitor', 'price'],
    phrases:     ['too expensive', 'too much money', 'can you do better', 'beat that price', 'cheaper elsewhere'],
    negativeKeywords: ['not too expensive', 'not expensive'],
    answerText:  "I completely understand. Our pricing includes a full diagnostic and our techs are background-checked and certified. We also match any written quote from a licensed competitor. Would you like me to note that for your appointment so the dispatcher can assist?",
    followUpQuestion: "Would you like to speak with someone about pricing before we confirm your booking?"
  },

  {
    ruleId:      'objection.need_to_think',
    label:       'Need to Think About It / Not Sure',
    description: 'Caller expresses hesitation or wants time to decide',
    priority:    15,
    firesOnSteps: ['CONFIRM', 'OFFER_TIMES'],
    behavior:    'BLOCK',
    keywords:    ['think', 'decide', 'sure', 'unsure', 'maybe', 'call back', 'not ready'],
    phrases:     ['need to think', 'call back later', "i'll think about it", 'not sure yet', 'let me check', "i'm not ready"],
    answerText:  "No problem at all — take your time. I can hold a tentative slot for you for up to an hour. If you'd like to confirm just call us back or I can reach back out. Is there anything I can clarify to help you decide?",
    followUpQuestion: ''
  },

  {
    ruleId:      'objection.already_have_someone',
    label:       'Already Have Another Company',
    description: 'Caller mentions they already called another company',
    priority:    10,
    firesOnSteps: ['ANY'],
    behavior:    'BLOCK',
    keywords:    ['another', 'other', 'company', 'someone else', 'competitor', 'already called'],
    phrases:     ['already have someone', 'already called', 'going with another', 'someone else coming'],
    answerText:  "Totally understood! If that doesn't work out or you want a second opinion, we're always here. We offer free second opinions on any diagnosis. Just give us a call.",
    followUpQuestion: ''
  },

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 6 — SPECIFIC BOOKING-STEP SCENARIOS
  // ══════════════════════════════════════════════════════════════════════════

  {
    ruleId:      'name.business',
    label:       'Caller Gives Business Name Instead of Personal',
    description: 'Caller gives a company or business name during name collection',
    priority:    20,
    firesOnSteps: ['COLLECT_NAME'],
    behavior:    'INFO',
    keywords:    ['llc', 'inc', 'company', 'business', 'properties', 'management', 'commercial'],
    phrases:     ['property management', 'commercial account', 'business account'],
    answerText:  "Got it — I'll note the business name. I'll also need the name of the primary contact we should ask for when we arrive.",
    followUpQuestion: "What's the name of the contact person at that location?"
  },

  {
    ruleId:      'phone.different_number',
    label:       'Use a Different Callback Number',
    description: 'Caller wants to give a different number than the one they called from',
    priority:    20,
    firesOnSteps: ['COLLECT_PHONE'],
    behavior:    'INFO',
    keywords:    ['different', 'other', 'cell', 'mobile', 'work phone', 'another number'],
    phrases:     ['different number', 'other number', 'use my cell', 'call me at', 'reach me at'],
    answerText:  "Of course — go ahead and give me the best number to reach you.",
    followUpQuestion: ''
  },

  {
    ruleId:      'address.rental',
    label:       'Rental Property / Landlord vs Tenant',
    description: 'Caller mentions it is a rental or they are a tenant',
    priority:    25,
    firesOnSteps: ['COLLECT_ADDRESS'],
    behavior:    'INFO',
    keywords:    ['rental', 'rent', 'tenant', 'landlord', 'renting', 'lease'],
    phrases:     ['rental property', 'my landlord', "i'm renting", 'i rent', 'tenant here'],
    answerText:  "No problem — we work with both tenants and property owners. If the landlord needs to approve the work, just let us know and we can send a quote directly to them as well.",
    followUpQuestion: ''
  },

  {
    ruleId:      'confirm.reschedule',
    label:       'Wants to Reschedule Before Confirming',
    description: 'Caller wants to change the time right at the confirm step',
    priority:    10,
    firesOnSteps: ['CONFIRM'],
    behavior:    'INFO',
    keywords:    ['reschedule', 'change', 'different', 'another', 'earlier', 'later', 'move'],
    phrases:     ['different time', 'can we change', 'move it to', 'earlier time', 'later time', 'reschedule'],
    answerText:  "Absolutely — let me pull up the other available times for you.",
    followUpQuestion: ''
  },

  {
    ruleId:      'confirm.add_service',
    label:       'Wants to Add a Second Service at Confirm Step',
    description: 'Caller tries to add another service while confirming booking',
    priority:    20,
    firesOnSteps: ['CONFIRM'],
    behavior:    'INFO',
    keywords:    ['also', 'add', 'while', 'same', 'another', 'plus', 'and also'],
    phrases:     ['can you also', 'while you are here', 'same visit', 'add on', 'second unit'],
    answerText:  "Definitely — I'll add that note to the work order so the tech comes prepared. If it turns into a separate job they'll let you know up front before starting.",
    followUpQuestion: ''
  },

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 7 — TRUST / MISC (INFO)
  // ══════════════════════════════════════════════════════════════════════════

  {
    ruleId:      'trust.licensed',
    label:       'Are You Licensed / Insured?',
    description: 'Caller asks about licensing, insurance, or certifications',
    priority:    30,
    firesOnSteps: ['ANY'],
    behavior:    'INFO',
    keywords:    ['licensed', 'insured', 'certified', 'background', 'bonded', 'verified'],
    phrases:     ['are you licensed', 'are you insured', 'background check', 'epa certified', 'nate certified'],
    answerText:  "Yes — all of our technicians are EPA certified, NATE certified, background-checked, and fully insured. Our company is licensed in the state and we carry full liability and workers comp coverage.",
    followUpQuestion: ''
  },

];

// ─────────────────────────────────────────────────────────────────────────────
// RUNNER
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║        BOOKING TRIGGERS — SEED SCRIPT                   ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  Target company : ${COMPANY_ID}`);
  console.log(`  Triggers       : ${TRIGGERS.length}`);
  console.log('');

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ MongoDB connected');

  const CompanyBookingTrigger = require('../models/CompanyBookingTrigger');

  let created = 0;
  let updated = 0;
  let errored = 0;

  for (const t of TRIGGERS) {
    try {
      const filter = { companyId: COMPANY_ID, ruleId: t.ruleId };
      const doc = {
        companyId:        COMPANY_ID,
        ruleId:           t.ruleId,
        label:            t.label,
        description:      t.description || '',
        enabled:          true,
        priority:         t.priority || 50,

        // Matching
        keywords:         t.keywords         || [],
        phrases:          t.phrases          || [],
        negativeKeywords: t.negativeKeywords || [],
        negativePhrases:  [],
        maxInputWords:    null,

        // Response
        responseMode:     'standard',
        answerText:       t.answerText,
        llmFactPack:      undefined,
        followUpQuestion: t.followUpQuestion || '',

        // Booking-specific
        firesOnSteps:     t.firesOnSteps || ['ANY'],
        behavior:         t.behavior,
        redirectMode:     t.redirectMode || null,

        tags:         [],
        state:        'published',
        publishedAt:  new Date(),
        createdBy:    'seed-script',
        updatedBy:    'seed-script'
      };

      const existing = await CompanyBookingTrigger.findOne(filter);

      if (existing) {
        Object.assign(existing, doc);
        existing.isDeleted  = false;
        existing.deletedAt  = null;
        existing.updatedAt  = new Date();
        await existing.save();
        updated++;
        console.log(`  ↻  [${t.behavior.padEnd(8)}] ${t.ruleId}`);
      } else {
        await CompanyBookingTrigger.create(doc);
        created++;
        console.log(`  ✚  [${t.behavior.padEnd(8)}] ${t.ruleId}`);
      }
    } catch (err) {
      errored++;
      console.error(`  ✗  ${t.ruleId} — ${err.message}`);
    }
  }

  console.log('');
  console.log('──────────────────────────────────────────────────────────');
  console.log(`  ✅ Created : ${created}`);
  console.log(`  ↻  Updated : ${updated}`);
  if (errored) console.log(`  ✗  Errors  : ${errored}`);
  console.log('──────────────────────────────────────────────────────────');
  console.log('');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ Seed failed:', err.message);
  process.exit(1);
});
