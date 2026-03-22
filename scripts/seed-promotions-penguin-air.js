'use strict';

/**
 * ============================================================================
 * SEED: Penguin Air — Promotions + Voice Settings
 * ============================================================================
 *
 * Seeds 4 realistic HVAC promotions and fully-configured voice settings so
 * every code path in PromotionsInterceptor can be demonstrated and tested:
 *
 *   SPRING25   — flat_discount  — Maintenance / Tune-Up  (HAS_COUPON path)
 *   NEWAC500   — flat_discount  — New Installation        (HAS_COUPON path)
 *   WIFI99     — fixed_price    — WiFi Thermostat add-on  (service-type match)
 *   (no code)  — percent_off    — Diagnostic special      (ASKING_SPECIALS)
 *
 * Voice settings are customised for Penguin Air — every line the agent speaks
 * during a promo interaction is stored in MongoDB (not hardcoded).
 *
 * Usage:
 *   node scripts/seed-promotions-penguin-air.js [companyId]
 *
 * Defaults to PENGUIN_AIR_ID if no arg provided.
 * Safe to re-run — idempotent (upserts on companyId + name).
 *
 * ============================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');

const PENGUIN_AIR_ID = '68e3f77a9d623b8058c700c4';
const COMPANY_ID     = process.argv[2] || PENGUIN_AIR_ID;

// ─────────────────────────────────────────────────────────────────────────────
// PROMOTIONS
// ─────────────────────────────────────────────────────────────────────────────

const PROMOTIONS = [
  // ── 1. Spring Tune-Up — demonstrates HAS_COUPON → code validation ──────────
  {
    name:            'Spring Tune-Up Special',
    code:            'SPRING25',
    serviceType:     'maintenance',
    serviceLabel:    'spring tune-up',
    discountType:    'flat_discount',
    discountValue:   25,
    priority:        90,
    description:
      'We currently have our Spring Tune-Up Special — $25 off any maintenance visit. ' +
      'That includes a full system inspection, filter check, coil cleaning, and refrigerant level test.',
    bookingPrompt:
      'Would you like to go ahead and get that on the schedule today?',
    noCouponResponse:
      "We don't have any active promotions running right now, but I'd be happy to get you scheduled at our standard rate.",
    terms:
      'Valid for residential systems only. Cannot be combined with other discounts. One per household.',
    isActive:  true,
    validFrom: null,
    validTo:   null,
  },

  // ── 2. New System Installation — demonstrates a high-value code promo ──────
  {
    name:            'New System Installation Discount',
    code:            'NEWAC500',
    serviceType:     'installation',
    serviceLabel:    'new system installation',
    discountType:    'flat_discount',
    discountValue:   500,
    priority:        80,
    description:
      'We have a $500 discount available on any new system installation. ' +
      'That applies to the full equipment and labor package — no fine print.',
    bookingPrompt:
      'Would you like to have one of our comfort advisors come out and give you a free estimate with that discount applied?',
    noCouponResponse: null,
    terms:
      'Valid on complete system replacements only. Cannot be combined with financing promotions. ' +
      'Must be presented at time of estimate.',
    isActive:  true,
    validFrom: null,
    validTo:   null,
  },

  // ── 3. WiFi Thermostat Add-On — demonstrates service-type matching ─────────
  //    Fires when caller asks about thermostat / smart home promos
  //    even mid-maintenance call (callContext fallback in _inferServiceType)
  {
    name:            'WiFi Thermostat Add-On Special',
    code:            'WIFI99',
    serviceType:     'thermostat',
    serviceLabel:    'WiFi thermostat installation',
    discountType:    'fixed_price',
    discountValue:   99,
    priority:        110,
    description:
      'We have a special on WiFi thermostat installation — just $99 installed. ' +
      "That includes a Nest or Ecobee of your choice, and we'll walk you through the app setup before we leave.",
    bookingPrompt:
      'Would you like to add that onto your appointment today?',
    noCouponResponse: null,
    terms:
      'Standard installation wiring only. Additional charges may apply for systems requiring new wiring runs.',
    isActive:  true,
    validFrom: null,
    validTo:   null,
  },

  // ── 4. Free Diagnostic Special — no code, demonstrates ASKING_SPECIALS ─────
  //    When caller asks "do you have any deals?" this is what gets listed
  {
    name:            'Free Diagnostic with Any Repair',
    code:            '',           // no code — specials-only promo
    serviceType:     'diagnostic',
    serviceLabel:    'diagnostic visit',
    discountType:    'free_service',
    discountValue:   0,
    priority:        70,
    description:
      "Right now we're waiving the diagnostic fee on any repair — so if we find the problem and fix it the same visit, the diagnostic is on us.",
    bookingPrompt:
      'Would you like to go ahead and get a tech out to take a look?',
    noCouponResponse: null,
    terms:
      'Diagnostic fee waived only when repair is completed during the same visit. ' +
      'Diagnostic fee applies if no repair is performed.',
    isActive:  true,
    validFrom: null,
    validTo:   null,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// VOICE SETTINGS
// Customised for Penguin Air — replaces every built-in default voice line
// with branded, natural-sounding HVAC copy.
// ─────────────────────────────────────────────────────────────────────────────

const VOICE_SETTINGS = {
  companyId:   COMPANY_ID,

  enableClarifyingQuestion: true,

  clarifyingQuestion:
    "Hi {callerName}! Quick question — are you calling about a coupon or promo code you'd like to use, " +
    "or are you asking what specials we have available right now?",

  askForCodePrompt:
    "Of course — go ahead and read me that code whenever you're ready and I'll pull it right up.",

  codeRetryPrompt:
    "Sorry about that, I didn't quite catch that one. " +
    'Could you read the code off one more time? Spelling it out helps if the letters are tricky.',

  validCodePrefix:
    'Great news —',

  validCodeBookingSuffix:
    "I've got that noted, and we'll make sure it's applied to your appointment.",

  noActiveSpecials:
    "We don't have any active promotions running at the moment, " +
    'but we do offer competitive pricing and our techs are background-checked and NATE-certified.',

  noActiveSpecialsCta:
    'Would you still like to get something on the schedule today?',
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('══════════════════════════════════════════════════════════════');
  console.log('  🎟️  Seed: Penguin Air — Promotions + Voice Settings');
  console.log(`  Company: ${COMPANY_ID}`);
  console.log('══════════════════════════════════════════════════════════════');
  console.log('');

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌  MONGODB_URI env var is not set. Run: source .env or check your .env file.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('  ✅  MongoDB connected\n');

  const CompanyPromotion         = require('../models/CompanyPromotion');
  const CompanyPromotionSettings = require('../models/CompanyPromotionSettings');

  // ── Seed promotions ─────────────────────────────────────────────────────────
  console.log('  Promotions:');
  let created = 0, updated = 0;

  for (const p of PROMOTIONS) {
    const doc = {
      companyId:        COMPANY_ID,
      name:             p.name,
      code:             p.code || '',
      serviceType:      p.serviceType,
      serviceLabel:     p.serviceLabel,
      discountType:     p.discountType,
      discountValue:    p.discountValue,
      priority:         p.priority,
      description:      p.description,
      bookingPrompt:    p.bookingPrompt,
      noCouponResponse: p.noCouponResponse || '',
      terms:            p.terms || '',
      isActive:         p.isActive,
      validFrom:        p.validFrom,
      validTo:          p.validTo,
    };

    const existing = await CompanyPromotion.findOne({ companyId: COMPANY_ID, name: p.name });

    if (existing) {
      Object.assign(existing, doc);
      existing.updatedAt = new Date();
      await existing.save();
      updated++;
      console.log(`    ↻  ${p.name}${p.code ? ` [${p.code}]` : ' [no code]'}`);
    } else {
      await CompanyPromotion.create(doc);
      created++;
      console.log(`    ✚  ${p.name}${p.code ? ` [${p.code}]` : ' [no code]'}`);
    }
  }

  console.log('');
  console.log(`    Created: ${created}   Updated: ${updated}`);

  // ── Seed voice settings ──────────────────────────────────────────────────────
  console.log('');
  console.log('  Voice Settings:');

  await CompanyPromotionSettings.findOneAndUpdate(
    { companyId: COMPANY_ID },
    { $set: { ...VOICE_SETTINGS, updatedAt: new Date() } },
    { upsert: true, new: true }
  );

  console.log('    ✅  Voice settings saved');
  console.log('');
  console.log('──────────────────────────────────────────────────────────────');
  console.log('');
  console.log('  🎉  Done!');
  console.log('');
  console.log('  What to test next:');
  console.log('  ┌─────────────────────────────────────────────────────────┐');
  console.log('  │  CALL SAYS           → PATH FIRES                       │');
  console.log('  │  "I have a coupon"   → AMBIGUOUS → clarifying question  │');
  console.log('  │  "my code SPRING25"  → HAS_COUPON → validates code      │');
  console.log('  │  "code BADCODE123"   → HAS_COUPON → invalid code resp   │');
  console.log('  │  "any specials?"     → ASKING_SPECIALS → lists promos   │');
  console.log('  │  "thermostat deal?"  → service-type match → WIFI99 promo│');
  console.log('  │  "promo" (just that) → AMBIGUOUS → clarifying question  │');
  console.log('  └─────────────────────────────────────────────────────────┘');
  console.log('');
  console.log('  Then visit promotions.html → Agent Voice Settings to see');
  console.log('  all 8 fields populated with the Penguin Air copy.');
  console.log('');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ Seed failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
