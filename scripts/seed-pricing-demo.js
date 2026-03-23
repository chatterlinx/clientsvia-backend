'use strict';
// ============================================================
// PRICING SEED — Full Design Demonstration
// ============================================================
//
// Shows every action type, every layer combination, keyword
// patterns, voice settings, and the multi-tenant architecture.
//
// Target: Penguin Air (dev/demo company)
// Company ID: 68e3f77a9d623b8058c700c4
//
// Run in Render Shell:
//   node scripts/seed-pricing-demo.js
//
// ============================================================

const { MongoClient, ObjectId } = require('mongodb');

const COMPANY_ID = '68e3f77a9d623b8058c700c4';
const DB_NAME    = 'clientsvia';
const COL_ITEMS  = 'companyPricingItems';
const COL_COS    = 'companiesCollection';

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  // ── Wipe existing pricing items for this company ─────────────────────────
  const { deletedCount } = await db.collection(COL_ITEMS).deleteMany({ companyId: COMPANY_ID });
  console.log(`🗑  Cleared ${deletedCount} existing pricing items`);

  const now = new Date();

  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  PRICING ITEMS — 7 items covering all 5 action types                   ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  const items = [

    // ─────────────────────────────────────────────────────────────────────────
    // 1. RESIDENTIAL SERVICE CALL — RESPOND
    //    Demonstrates: all 3 layers + includesDetail fallback
    //    L1 → price answer
    //    L2 → "does that get credited?" follow-up
    //    L3 → "what does it include?" deep follow-up
    // ─────────────────────────────────────────────────────────────────────────
    {
      companyId: COMPANY_ID,
      label:     'Residential Service Call',
      category:  'Service Call',

      // Layer 1 — Primary answer
      keywords: [
        'service call', 'diagnostic fee', 'diagnostic',
        'how much is a service call', 'service fee', 'visit fee',
        'trip charge', 'call out', 'come out', 'send someone',
        'how much to come out', 'how much do you charge'
      ],
      response: 'Our residential service call and diagnostic fee is $89. If you move forward with a repair, that fee is credited toward your invoice.',
      includesDetail: 'The diagnostic includes a full system inspection, fault identification, and a written estimate — before any repair work begins.',

      // Layer 2 — "Does that get credited?" follow-up
      layer2Keywords: [
        'credited', 'applied to repair', 'go towards', 'waived',
        'does that get credited', 'does it apply', 'apply toward',
        'does the fee go towards', 'service call credit'
      ],
      layer2Response: 'Yes — for any repair over $200, the $89 diagnostic fee is credited back to your invoice automatically. You only pay the difference.',

      // Layer 3 — "What does it include?" deep follow-up
      layer3Keywords: [
        'what does it include', 'what comes with', 'what do you do',
        'what is included', 'what do your technicians do',
        'what does the diagnostic include', 'what does the service include'
      ],
      layer3Response: 'Your technician will do a complete system inspection, test all major components, identify the fault, and hand you a written estimate — all before any work starts. No surprises.',

      action:   'RESPOND',
      isActive: true,
      priority: 10,
      createdAt: now, updatedAt: now
    },

    // ─────────────────────────────────────────────────────────────────────────
    // 2. COMMERCIAL SERVICE CALL — RESPOND
    //    Demonstrates: separate item for same category, different pricing tier
    //    L1 → commercial price
    //    L2 → multi-zone / rooftop follow-up
    // ─────────────────────────────────────────────────────────────────────────
    {
      companyId: COMPANY_ID,
      label:     'Commercial Service Call',
      category:  'Service Call',

      keywords: [
        'commercial', 'commercial service call', 'commercial diagnostic',
        'business service call', 'commercial hvac', 'rooftop unit',
        'commercial system', 'commercial building', 'office hvac'
      ],
      response: 'Our commercial diagnostic and service call starts at $149 for single-zone systems. Multi-zone systems and rooftop units are quoted on-site.',
      includesDetail: 'The commercial diagnostic covers a full inspection of your rooftop or split system, refrigerant levels, controls, and a written service report.',

      layer2Keywords: [
        'multi zone', 'multi-zone', 'rooftop', 'chiller',
        'multiple units', 'multiple zones', 'large building'
      ],
      layer2Response: 'For multi-zone and chiller systems, pricing varies by system size and access. Our commercial team provides a firm site quote within 24 hours of a walkthrough.',

      action:   'RESPOND',
      isActive: true,
      priority: 20,
      createdAt: now, updatedAt: now
    },

    // ─────────────────────────────────────────────────────────────────────────
    // 3. ANNUAL MAINTENANCE PLAN — RESPOND_THEN_BOOK
    //    Demonstrates: give price THEN offer to schedule
    //    The bookingOfferSuffix from Voice Settings is appended automatically.
    //    L1 → plan price + what you get
    //    L2 → detailed "what's included" follow-up
    // ─────────────────────────────────────────────────────────────────────────
    {
      companyId: COMPANY_ID,
      label:     'Annual Maintenance Plan',
      category:  'Maintenance',

      keywords: [
        'maintenance plan', 'tune up', 'tune-up', 'annual plan',
        'service plan', 'maintenance contract', 'seasonal service',
        'yearly service', 'annual tune up', 'maintenance agreement',
        'how much is a tune up', 'maintenance cost'
      ],
      response: 'Our annual maintenance plan is $149 and covers two tune-ups per year — one heating season, one cooling season. Members get priority scheduling and 15% off any repairs.',
      includesDetail: 'Each visit includes a full system tune-up, filter swap, coil cleaning, refrigerant level check, and a safety inspection.',

      layer2Keywords: [
        'whats included', "what's included", 'what is included',
        'what comes with the plan', 'what do i get', 'benefits',
        'what does the plan cover', 'what does it include'
      ],
      layer2Response: 'The plan includes two annual tune-ups, priority scheduling, 15% off all repairs, a free filter at every visit, and no service call fees for covered maintenance. Covers one system.',

      // No layer 3 needed — L2 covers the inclusion question fully
      action:   'RESPOND_THEN_BOOK',
      isActive: true,
      priority: 30,
      createdAt: now, updatedAt: now
    },

    // ─────────────────────────────────────────────────────────────────────────
    // 4. DUCT CLEANING — ADVISOR_CALLBACK
    //    Demonstrates: no price given, collect contact for specialist call-back
    //    actionPrompt = item-level phrase (overrides Voice Settings default)
    //    Agent collects name + phone → BookingLogicEngine (bookingType=ADVISOR_CALLBACK)
    // ─────────────────────────────────────────────────────────────────────────
    {
      companyId: COMPANY_ID,
      label:     'Duct Cleaning',
      category:  'Duct Cleaning',

      keywords: [
        'duct cleaning', 'air duct', 'duct cleaning cost', 'hvac cleaning',
        'clean the ducts', 'vent cleaning', 'air duct cleaning cost',
        'how much is duct cleaning', 'clean my vents', 'duct work cleaning'
      ],
      response: '',   // Not used — ADVISOR_CALLBACK skips response layers

      // Item-level custom phrase — overrides the company Voice Settings fallback
      actionPrompt: 'Duct cleaning is priced by home size and number of vents — I can have one of our air quality specialists call you with an accurate quote. Can I get your name and the best number to reach you?',

      action:   'ADVISOR_CALLBACK',
      isActive: true,
      priority: 40,
      createdAt: now, updatedAt: now
    },

    // ─────────────────────────────────────────────────────────────────────────
    // 5. SYSTEM REPLACEMENT / NEW INSTALL — SCHEDULE_ESTIMATE
    //    Demonstrates: no price, pivot to booking a free in-home estimate
    //    Agent speaks actionPrompt then enters booking flow for an estimate visit
    // ─────────────────────────────────────────────────────────────────────────
    {
      companyId: COMPANY_ID,
      label:     'System Replacement / New Install',
      category:  'Installation',

      keywords: [
        'new system', 'replacement', 'install a new',
        'replace my unit', 'new hvac', 'new air conditioner',
        'new furnace', 'new heat pump', 'how much to replace',
        'replacement cost', 'installation cost', 'buy a new system',
        'how much is a new unit', 'cost of a new hvac'
      ],
      response: '',   // Not used — SCHEDULE_ESTIMATE skips response layers

      // No item-level actionPrompt — falls back to Voice Settings advisorCallbackFallback
      // (or built-in ultimate fallback if Voice Settings is also blank)
      // This demonstrates the three-tier fallback chain

      action:   'SCHEDULE_ESTIMATE',
      isActive: true,
      priority: 50,
      createdAt: now, updatedAt: now
    },

    // ─────────────────────────────────────────────────────────────────────────
    // 6. EMERGENCY / AFTER-HOURS — TRANSFER
    //    Demonstrates: no price, agent speaks actionPrompt then transfers call
    //    On-call team handles pricing live
    // ─────────────────────────────────────────────────────────────────────────
    {
      companyId: COMPANY_ID,
      label:     'Emergency & After-Hours Service',
      category:  'Emergency',

      keywords: [
        'emergency', 'after hours', 'after-hours', 'weekend rate',
        'emergency fee', 'emergency service', 'same day', 'urgent',
        'no heat', 'no cool', 'not cooling', 'not heating',
        'emergency call', 'how much is emergency', 'overnight service'
      ],
      response: '',   // Not used — TRANSFER skips response layers

      actionPrompt: 'Emergency and after-hours pricing is handled directly by our on-call team — let me connect you with them right now so they can get someone to you as quickly as possible.',

      action:   'TRANSFER',
      isActive: true,
      priority: 60,
      createdAt: now, updatedAt: now
    },

    // ─────────────────────────────────────────────────────────────────────────
    // 7. FILTER REPLACEMENT — RESPOND
    //    Demonstrates: simple L1-only item, no follow-up layers needed
    //    Quick factual answer, no booking or callback required
    // ─────────────────────────────────────────────────────────────────────────
    {
      companyId: COMPANY_ID,
      label:     'Filter Replacement',
      category:  'Repair',

      keywords: [
        'filter', 'air filter', 'replace filter', 'filter cost',
        'filter price', 'change filter', 'filter replacement cost',
        'how much is a filter', 'furnace filter', 'air filter cost'
      ],
      response: 'Standard 1-inch filters start at $18 installed. High-efficiency 4-inch media filters range from $45 to $75 depending on brand. We stock most standard sizes.',

      // No layers 2 or 3 — single-fact answer, no common follow-ups

      action:   'RESPOND',
      isActive: true,
      priority: 70,
      createdAt: now, updatedAt: now
    }

  ]; // end items

  const inserted = await db.collection(COL_ITEMS).insertMany(items);
  console.log(`✅ Inserted ${inserted.insertedCount} pricing items`);

  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  VOICE SETTINGS — Company-level defaults                                ║
  // ║  Stored in companiesCollection as pricingVoiceSettings                  ║
  // ║  These are the fallbacks when a pricing item has no actionPrompt set.   ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  const vsResult = await db.collection(COL_COS).updateOne(
    { _id: new ObjectId(COMPANY_ID) },
    {
      $set: {
        pricingVoiceSettings: {
          // Spoken for ADVISOR_CALLBACK / SCHEDULE_ESTIMATE items with NO item-level actionPrompt
          // Item 5 (System Replacement) has NO actionPrompt — it will use this fallback
          advisorCallbackFallback: 'Pricing for this service varies by job — I can have one of our specialists call you with an accurate quote. Can I get your name and best callback number?',

          // Appended after the price for RESPOND_THEN_BOOK items (Item 3 — Maintenance Plan)
          bookingOfferSuffix: 'Would you like to get that on the schedule today?',

          // Spoken when a caller asks about pricing but NO item matches their keywords.
          // Leave blank to let the AI handle it (safe degrade).
          // Here we set a value to demonstrate the feature:
          notFoundResponse: "I don't have pricing on that service in front of me — let me have one of our team members follow up with you directly. Can I get your name and a good number?"
        }
      }
    }
  );
  console.log(`✅ Voice settings saved — matched: ${vsResult.matchedCount}, modified: ${vsResult.modifiedCount}`);

  // ── Summary report ────────────────────────────────────────────────────────
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  PRICING SEED COMPLETE — Penguin Air                         ║
╠══════════════════════════════════════════════════════════════╣
║  ACTION TYPES SEEDED:                                        ║
║                                                              ║
║  RESPOND            #1 Residential Service Call              ║
║                         (L1 + L2 credit + L3 includes)       ║
║                     #2 Commercial Service Call               ║
║                         (L1 + L2 multi-zone follow-up)       ║
║                     #7 Filter Replacement                    ║
║                         (L1 only — simple fact)              ║
║                                                              ║
║  RESPOND_THEN_BOOK  #3 Annual Maintenance Plan               ║
║                         (L1 + L2, appends booking offer)     ║
║                                                              ║
║  ADVISOR_CALLBACK   #4 Duct Cleaning                         ║
║                         (item-level actionPrompt set)        ║
║                                                              ║
║  SCHEDULE_ESTIMATE  #5 System Replacement / New Install      ║
║                         (NO actionPrompt → uses VS default)  ║
║                                                              ║
║  TRANSFER           #6 Emergency & After-Hours               ║
║                         (item-level actionPrompt set)        ║
║                                                              ║
╠══════════════════════════════════════════════════════════════╣
║  LAYER COVERAGE:                                             ║
║  L1 + L2 + L3  → Residential Service Call                    ║
║  L1 + L2 only  → Commercial, Maintenance Plan                ║
║  L1 only       → Filter Replacement                          ║
║  No layers     → Duct Cleaning, Replacement, Emergency       ║
║                  (action phrase only)                        ║
║                                                              ║
╠══════════════════════════════════════════════════════════════╣
║  VOICE SETTINGS (company-level fallbacks):                   ║
║  advisorCallbackFallback → used by item #5 (no actionPrompt) ║
║  bookingOfferSuffix      → appended to item #3 L1 response   ║
║  notFoundResponse        → spoken when no item keyword hits  ║
║                                                              ║
╠══════════════════════════════════════════════════════════════╣
║  VIEW IN BROWSER:                                            ║
║  /agent-console/pricing.html?companyId=68e3f77a9d623b8058c700c4
╚══════════════════════════════════════════════════════════════╝
`);

  await client.close();
}

run().catch(err => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
