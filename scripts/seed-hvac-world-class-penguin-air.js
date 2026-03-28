'use strict';

/**
 * =============================================================================
 * PENGUIN AIR — WORLD-CLASS HVAC RECEPTIONIST SEED
 * =============================================================================
 *
 * Complete production-ready configuration for a world-class HVAC receptionist:
 *
 *   ✅  12  Knowledge Containers — rich factual HVAC content Groq synthesizes
 *   ✅  12  Behavior Cards       — tone, rules, examples per category + flows
 *   ✅   6  Interceptors         — high-confidence keyword → action routing
 *   ✅   1  Arbitration Policy   — intent resolution settings optimized for HVAC
 *   ✅   8  Pricing Items        — 3-layer service pricing with booking CTAs
 *   ✅   4  Promotions           — active specials for promo interceptor
 *   ✅   Company settings        — enables arbitration engine (CHECKPOINT D)
 *
 * COVERED SCENARIOS:
 *   AC/heating repair, emergency service, tune-ups, maintenance plans,
 *   new system installation, indoor air quality, duct cleaning, financing,
 *   commercial accounts, payments/billing, manager requests, escalation,
 *   hours & service area, live agent transfer, and booking intent.
 *
 * RUN IN RENDER SHELL:
 *   node scripts/seed-hvac-world-class-penguin-air.js
 *   node scripts/seed-hvac-world-class-penguin-air.js <customCompanyId>
 *
 * Idempotent — every write uses upsert. Safe to re-run without duplication.
 *
 * ⚠️  BEFORE RUNNING: set DISPATCH_PHONE to the company's actual phone number:
 *   DISPATCH_PHONE=+12025550100 node scripts/seed-hvac-world-class-penguin-air.js
 *
 * =============================================================================
 */

const { MongoClient, ObjectId } = require('mongodb');

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const COMPANY_ID  = process.argv[2] || '68e3f77a9d623b8058c700c4';
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME     = 'clientsvia';
const KC_PREFIX   = COMPANY_ID.slice(-5);   // '700c4' for default Penguin Air
const NOW         = new Date();

// Transfer target for live agent, dispatch, and billing transfers.
// Override: DISPATCH_PHONE=+12025550100 node scripts/seed-...
const DISPATCH_PHONE = process.env.DISPATCH_PHONE || '+18005550000';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Build KC ID string: {last5ofCompanyId}-{seq padded to 2 digits} */
const kid = (seq) => `${KC_PREFIX}-${String(seq).padStart(2, '0')}`;

const RESET = '\x1b[0m', BOLD = '\x1b[1m', GREEN = '\x1b[32m',
      CYAN  = '\x1b[36m', YELLOW = '\x1b[33m', DIM = '\x1b[2m';

function banner(text) {
  console.log(`\n${BOLD}${CYAN}── ${text} ${'─'.repeat(Math.max(0, 54 - text.length))}${RESET}`);
}
function ok(label, msg)   { console.log(`  ${GREEN}✅${RESET} [${label}] ${msg}`); }
function note(label, msg) { console.log(`  ${YELLOW}ℹ️ ${RESET} [${label}] ${DIM}${msg}${RESET}`); }

// ─────────────────────────────────────────────────────────────────────────────
// 1. KNOWLEDGE CONTAINERS
// 12 containers covering the full HVAC receptionist knowledge surface.
// Each is seeded with rich, voice-ready content Groq synthesizes into answers.
// ─────────────────────────────────────────────────────────────────────────────

const KC_CONTAINERS = [

  // ── AC & Cooling Repair ──────────────────────────────────────────────────
  {
    companyId: COMPANY_ID,
    kcId:      kid(1),
    title:     'AC & Cooling Repair',
    category:  'Services',
    keywords: [
      'ac not working', 'air conditioning broken', 'ac stopped working', 'not cooling',
      'no cold air', 'ac repair', 'cooling repair', 'fix my ac', 'air conditioner not working',
      'service call', 'diagnostic', 'hvac repair', 'cooling problem',
      'ac running but not cooling', 'ac making noise', 'ac leaking', 'warm air blowing',
      'ac turned off', 'unit not working', 'compressor', 'refrigerant', 'my ac broken'
    ],
    // Negative keywords: prevent this REPAIR container from winning on
    // maintenance / tune-up price questions. "Maintenance" callers go to
    // the Tune-Up or Comfort Club container instead.
    negativeKeywords: [
      'maintenance', 'tune-up', 'tune up', 'tuneup',
      'annual service', 'seasonal service', 'preventive',
      'maintenance plan', 'service plan', 'service agreement', 'comfort club',
      'maintenance visit', 'annual maintenance',
    ],
    sections: [
      {
        label:   'Our AC Repair Service',
        content: 'We repair all makes and models — Carrier, Trane, Lennox, Goodman, Rheem, York, and more. Factory-trained technicians arrive in fully-stocked trucks to complete most repairs same day. Every repair includes a 1-year parts and labor warranty.',
        order: 1
      },
      {
        label:   'Diagnostic Service Call',
        content: 'Diagnostic fee is $89, applied toward your repair if you proceed. We arrive in a 2-hour window and call 30 minutes ahead. The technician runs a full system inspection, identifies the root cause, and provides upfront pricing before starting any work.',
        order: 2
      },
      {
        label:   'Common AC Repairs',
        content: 'Frequent fixes include bad capacitors and contactors, refrigerant leaks and recharges, dirty or frozen coils, failed blower or condenser fan motors, clogged drain lines, and thermostat failures. Most are resolved in a single visit.',
        order: 3
      },
      {
        label:   'Repair Warranty',
        content: 'Every repair includes a 1-year parts and labor warranty. If the same issue returns within 12 months, we come back at no charge. If your system needs more than a repair, we give honest repair-vs-replace options with no pressure.',
        order: 4
      }
    ],
    wordLimit:     70,
    bookingAction: 'offer_to_book',
    followUpDepth: 4,
    closingPrompt: 'After answering, naturally offer to schedule the service call today. Acknowledge any discomfort the caller may be experiencing (heat, noise, water, etc.).',
    priority:      10,
    isActive:      true
  },

  // ── Heating & Furnace Repair ─────────────────────────────────────────────
  {
    companyId: COMPANY_ID,
    kcId:      kid(2),
    title:     'Heating & Furnace Repair',
    category:  'Services',
    keywords: [
      'heat not working', 'furnace not working', 'no heat', 'heater broken',
      'furnace repair', 'heating repair', 'furnace diagnostic', 'heat pump repair',
      'not heating', 'cold house', 'furnace stopped', 'pilot light', 'burner',
      'heat pump not working', 'heating problem', 'furnace won\'t start',
      'furnace making noise', 'gas furnace issue', 'blower not working', 'no hot air'
    ],
    // Negative keywords: prevent this REPAIR container from winning on
    // maintenance / tune-up price questions.
    negativeKeywords: [
      'maintenance', 'tune-up', 'tune up', 'tuneup',
      'annual service', 'seasonal service', 'preventive',
      'maintenance plan', 'service plan', 'service agreement', 'comfort club',
      'maintenance visit', 'annual maintenance',
    ],
    sections: [
      {
        label:   'Our Heating Repair Service',
        content: 'We repair gas furnaces, heat pumps, electric air handlers, boilers, and packaged heating systems of all major brands. Technicians carry the most common parts to resolve most heating failures same day. All repairs include a 1-year warranty.',
        order: 1
      },
      {
        label:   'Heating Diagnostic Call',
        content: 'Diagnostic fee is $89, applied toward any repair. We prioritize heating calls November through March for fast response. The technician diagnoses all components — heat exchanger, burner assembly, ignitor, blower — and explains findings before starting work.',
        order: 2
      },
      {
        label:   'Common Heating Repairs',
        content: 'Frequent repairs include ignitor and flame sensor replacement, heat exchanger inspection, blower motor failure, gas valve issues, control board replacement, and refrigerant service for heat pumps. Most are completed same day.',
        order: 3
      },
      {
        label:   'Carbon Monoxide & Gas Safety',
        content: 'Any suspected carbon monoxide issue or gas smell is treated as an immediate safety emergency. If you smell gas or suspect a CO issue, exit the home first and call from outside. We respond to gas/CO calls as highest priority.',
        order: 4
      }
    ],
    wordLimit:     70,
    bookingAction: 'offer_to_book',
    followUpDepth: 4,
    closingPrompt: 'Emphasize fast response times for heating failures, especially in winter. Offer same-day scheduling. Note the 1-year warranty to build confidence.',
    priority:      11,
    isActive:      true
  },

  // ── Annual HVAC Tune-Up ──────────────────────────────────────────────────
  {
    companyId: COMPANY_ID,
    kcId:      kid(3),
    title:     'Annual HVAC Tune-Up',
    category:  'Maintenance',
    keywords: [
      // Topic trigger phrases
      'tune up', 'tuneup', 'tune-up', 'maintenance visit', 'annual service',
      'ac check', 'hvac check', 'system checkup', 'spring tune up', 'fall tune up',
      'preventive service', 'maintenance appointment', 'annual maintenance',
      'ac service', 'hvac service visit', 'seasonal service', 'system inspection',
      'coil cleaning', 'ac cleaned', 'spring service', 'fall service',
      // Pricing / cost question phrases — exact-match scores beat generic "how much"
      // Each phrase scores LENGTH × 2 so:
      //   "how much for maintenance"  → 24×2=48  beats "how much" (8×2=16) ✓
      //   "maintenance cost"          → 15×2=30  beats "how much" (8×2=16) ✓
      'how much is a tune up', 'how much does a tune up cost', 'how much for a tune up',
      'tune up cost', 'tune up price', 'tune up fee',
      'how much for maintenance', 'how much is maintenance', 'how much does maintenance cost',
      'how much is a maintenance', 'how much do you charge for maintenance',
      'maintenance cost', 'maintenance price', 'maintenance fee', 'maintenance charge',
      'annual service cost', 'annual service price', 'annual service fee',
      'how much annual service', 'seasonal service cost', 'preventive maintenance cost',
      'maintenance appointment cost', 'service visit cost', 'service visit price',
    ],
    sections: [
      {
        label:   'What Is a Tune-Up',
        content: 'Our 21-point tune-up is a comprehensive inspection and cleaning of your entire HVAC system. It covers refrigerant level check, electrical connection tightening, condenser and evaporator coil cleaning, lubrication of all moving parts, thermostat calibration, filter check, and drain line flush.',
        order: 1
      },
      {
        label:   'Tune-Up Pricing',
        content: 'Spring AC tune-ups start at $89. Fall heating tune-ups also start at $89. Comfort Club members receive both tune-ups included at no additional charge every year.',
        order: 2
      },
      {
        label:   'Why Annual Service Matters',
        content: 'Annual tune-ups improve system efficiency by up to 15%, extend equipment life by 3–5 years, and prevent up to 85% of breakdowns before they happen. Most manufacturer warranties require annual professional maintenance to remain valid.',
        order: 3
      }
    ],
    wordLimit:     65,
    bookingAction: 'offer_to_book',
    followUpDepth: 4,
    closingPrompt: 'After explaining the tune-up, offer to schedule one. Mention the Comfort Club as a cost-saving option that includes tune-ups. Encourage booking before the busy season.',
    priority:      20,
    isActive:      true
  },

  // ── Comfort Club Maintenance Plan ────────────────────────────────────────
  {
    companyId: COMPANY_ID,
    kcId:      kid(4),
    title:     'Comfort Club Maintenance Plan',
    category:  'Maintenance',
    keywords: [
      // Topic trigger phrases
      'maintenance plan', 'service plan', 'service agreement', 'comfort club',
      'hvac membership', 'maintenance contract', 'maintenance program', 'annual plan',
      'service membership', 'monthly hvac plan', 'maintenance subscription',
      'hvac agreement', 'protection plan', 'service protection', 'preventive plan',
      'comfort plan', 'service contract', 'annual hvac plan', 'hvac protection',
      // Plan pricing / cost question phrases — exact-match beats generic "how much"
      'how much is the maintenance plan', 'how much does the maintenance plan cost',
      'maintenance plan cost', 'maintenance plan price', 'maintenance plan fee',
      'how much is the service plan', 'service plan cost', 'service plan price',
      'service agreement cost', 'comfort club cost', 'comfort club price',
      'how much is comfort club', 'comfort club fee',
      'monthly hvac plan cost', 'annual plan cost', 'annual plan price',
    ],
    sections: [
      {
        label:   'What Is the Comfort Club',
        content: 'The Comfort Club is our annual maintenance membership. For one low fee, members get two full tune-ups per year (spring AC + fall heating), priority dispatch ahead of non-members, a 15% discount on all repair labor and parts, and no diagnostic fees for service calls.',
        order: 1
      },
      {
        label:   'Plan Pricing',
        content: 'The Comfort Club is $19.95 per month billed annually, or $199 paid up front for the year. A second system can be added for $14.95 per month. No long-term contract — cancel any time. The plan is transferable to new homeowners.',
        order: 2
      },
      {
        label:   'Complete Member Benefits',
        content: 'Two full tune-ups per year, priority emergency dispatch, 15% off all repair labor and parts, waived diagnostic fees, no overtime or after-hours charges, reminder calls for both seasonal services, and a dedicated member service line.',
        order: 3
      },
      {
        label:   'How to Enroll',
        content: 'We can enroll you right now over the phone. There are no setup fees. Your first tune-up gets scheduled when you join. Most members find the plan pays for itself with just one avoided repair or skipped diagnostic fee.',
        order: 4
      }
    ],
    wordLimit:     85,
    bookingAction: 'offer_to_book',
    followUpDepth: 4,
    closingPrompt: 'Offer to enroll the caller right now or schedule their first tune-up. This is a high-value retention play — be helpful and value-focused, not pushy.',
    priority:      21,
    isActive:      true
  },

  // ── New AC System Installation ───────────────────────────────────────────
  {
    companyId: COMPANY_ID,
    kcId:      kid(5),
    title:     'New AC System Installation',
    category:  'Installations',
    keywords: [
      'new ac', 'new air conditioner', 'replace ac', 'ac replacement', 'new system',
      'new central air', 'install new ac', 'hvac installation', 'new hvac system',
      'new equipment', 'new condenser', 'new unit', 'upgrade ac', 'new split system',
      'mini split', 'mini split installation', 'central air installation',
      'replace my ac', 'new cooling system', 'ac install', 'new ductless'
    ],
    // Negative keywords: INSTALLATION containers must NEVER win on maintenance
    // or tune-up queries. Any utterance containing these words is NOT about
    // buying a new system — it's about maintaining an existing one.
    negativeKeywords: [
      'maintenance', 'tune-up', 'tune up', 'tuneup',
      'annual service', 'seasonal service', 'preventive',
      'maintenance plan', 'service plan', 'service agreement', 'comfort club',
    ],
    sections: [
      {
        label:   'New AC Systems We Install',
        content: 'We install Carrier, Trane, Lennox, Goodman, and Rheem systems including central split systems, ductless mini-splits, heat pumps in cooling mode, and package units. All installations include a free in-home load calculation — we never guess at system size.',
        order: 1
      },
      {
        label:   'System Options & Efficiency',
        content: 'We offer single-stage, two-stage, and variable-speed systems from 14 SEER2 to 22 SEER2. Higher efficiency models qualify for utility rebates and typically pay back their cost premium in 4–6 years through reduced energy bills.',
        order: 2
      },
      {
        label:   'Installation Pricing',
        content: 'Installed costs for central AC systems typically range from $4,500 to $9,500 depending on system size, efficiency rating, and installation complexity. Exact pricing requires an in-home assessment. Zero-percent financing is available for up to 18 months with approved credit.',
        order: 3
      },
      {
        label:   'Our Guarantee',
        content: 'Every new installation includes a 10-year parts warranty, 2-year labor warranty, and our 100% satisfaction guarantee. We pull all permits, handle manufacturer warranty registration, and assist with utility rebate paperwork.',
        order: 4
      }
    ],
    wordLimit:     85,
    bookingAction: 'advisor_callback',
    followUpDepth: 4,
    closingPrompt: 'Always offer a free in-home assessment — never quote a final price without one. This is a major purchase decision. Be consultative and educational, never pushy.',
    priority:      30,
    isActive:      true
  },

  // ── New Heating System Installation ─────────────────────────────────────
  {
    companyId: COMPANY_ID,
    kcId:      kid(6),
    title:     'New Heating System Installation',
    category:  'Installations',
    keywords: [
      'new furnace', 'new heating system', 'replace furnace', 'furnace replacement',
      'new heater', 'new heat pump', 'install furnace', 'furnace installation',
      'new boiler', 'heating system replacement', 'new gas furnace',
      'furnace install', 'replace my furnace', 'new heating unit',
      'gas furnace cost', 'new electric furnace', 'dual fuel system'
    ],
    // Negative keywords: INSTALLATION containers must NEVER win on maintenance
    // or tune-up queries.
    negativeKeywords: [
      'maintenance', 'tune-up', 'tune up', 'tuneup',
      'annual service', 'seasonal service', 'preventive',
      'maintenance plan', 'service plan', 'service agreement', 'comfort club',
    ],
    sections: [
      {
        label:   'Heating Systems We Install',
        content: 'We install gas furnaces, heat pumps, electric air handlers, dual-fuel systems, and boilers of all major brands. We size the system to your home with a proper load calculation and match or upgrade your existing ductwork for correct airflow.',
        order: 1
      },
      {
        label:   'Pricing Range',
        content: 'Gas furnace installations typically range from $3,500 to $7,500 installed. Heat pump systems range from $5,000 to $12,000 depending on size and efficiency. High-efficiency heat pumps may qualify for federal tax credits of up to $2,000.',
        order: 2
      },
      {
        label:   'Process & Timeline',
        content: 'We start with a free in-home load calculation. Most installations complete in one day. We pull all required permits and coordinate the utility inspection. Manufacturer warranty registration is handled for you at no charge.',
        order: 3
      },
      {
        label:   'Energy & Cost Savings',
        content: 'Upgrading from an 80% efficiency furnace to a 96% model typically cuts heating bills by 15–25% annually. We provide an estimated payback period and energy savings projection during the free assessment.',
        order: 4
      }
    ],
    wordLimit:     85,
    bookingAction: 'advisor_callback',
    followUpDepth: 4,
    closingPrompt: 'Offer a free in-home assessment. Mention available federal tax credits and 0% financing. Be consultative and patient — this is a major purchase.',
    priority:      31,
    isActive:      true
  },

  // ── Emergency HVAC Service ───────────────────────────────────────────────
  {
    companyId: COMPANY_ID,
    kcId:      kid(7),
    title:     'Emergency HVAC Service',
    category:  'Emergency',
    keywords: [
      'emergency', 'urgent', 'asap', 'right now', 'no ac', 'no heat',
      'not working now', 'same day', 'immediate', 'after hours', '24 hour',
      '24 7', 'weekend service', 'its hot', 'it is hot', 'too hot',
      'its freezing', 'freezing cold', 'baby', 'infant', 'elderly', 'medical',
      'health issue', 'emergency service', 'someone today', 'need help now',
      'can not wait', 'been out all day', 'house is hot', 'house is cold'
    ],
    sections: [
      {
        label:   'Emergency Response',
        content: 'Same-day emergency service available 7 days a week including weekends and holidays. Our dispatcher works to have a technician on site within 2–4 hours. Medical necessity situations — infants, elderly residents, or documented health conditions — receive immediate priority.',
        order: 1
      },
      {
        label:   'Emergency Service Fees',
        content: 'After-hours and weekend diagnostic fee is $149, applied toward repair. Same-day emergency dispatch during normal business hours is $119. All repair costs are quoted upfront before any work begins — no surprises.',
        order: 2
      },
      {
        label:   'While You Wait',
        content: 'For heat emergencies: close blinds and curtains, run ceiling fans, move to the lowest level of the home, and stay hydrated. For no-heat emergencies: use electric space heaters safely on hard floors away from curtains, add layers, and seal gaps under doors.',
        order: 3
      }
    ],
    wordLimit:     60,
    bookingAction: 'offer_to_book',
    followUpDepth: 2,
    closingPrompt: 'EMERGENCY — move immediately to scheduling. Acknowledge their distress first. Do not make them listen through lengthy explanations before booking.',
    priority:      5,
    isActive:      true
  },

  // ── Indoor Air Quality Solutions ─────────────────────────────────────────
  {
    companyId: COMPANY_ID,
    kcId:      kid(8),
    title:     'Indoor Air Quality Solutions',
    category:  'Air Quality',
    keywords: [
      'air quality', 'air purifier', 'indoor air', 'air filter', 'uv light',
      'air scrubber', 'allergies', 'allergens', 'dust', 'mold', 'pet dander',
      'air cleaner', 'whole home purifier', 'humidifier', 'dehumidifier', 'iaq',
      'pollutants', 'airborne bacteria', 'airborne virus', 'smoke smell',
      'musty smell', 'healthy air', 'breathing problem', 'air quality test', 'ionizer'
    ],
    sections: [
      {
        label:   'IAQ Products We Install',
        content: 'We install whole-home air purifiers, UV germicidal lights, iWave ionizers, air scrubbers, media air cleaners, electronic air filters, whole-home humidifiers, whole-home dehumidifiers, and energy recovery ventilators — all integrating with your existing system.',
        order: 1
      },
      {
        label:   'UV Light & Purification Systems',
        content: 'UV germicidal lights kill airborne viruses, bacteria, and mold spores 24/7 as air circulates through your system — no maintenance required. Air scrubbers and ionizers reduce allergens, odors, and particulates by up to 99%. Most systems have no ongoing filter costs.',
        order: 2
      },
      {
        label:   'Humidity Control',
        content: 'Whole-home humidifiers maintain ideal 40–50% humidity in winter, eliminating dry skin, static electricity, and wood cracking. Whole-home dehumidifiers improve summer comfort and prevent mold growth. Both run automatically and require minimal maintenance.',
        order: 3
      },
      {
        label:   'Pricing',
        content: 'UV light systems start at $299 installed. Whole-home air purifiers range from $799 to $1,499 installed. Humidifiers and dehumidifiers range from $699 to $1,299. All IAQ solutions qualify for financing. Free in-home air quality assessment available.',
        order: 4
      }
    ],
    wordLimit:     75,
    bookingAction: 'offer_to_book',
    followUpDepth: 4,
    closingPrompt: 'Connect the solution to the caller\'s specific concern (allergies, odors, dust, viruses). Offer a free IAQ assessment as the natural next step.',
    priority:      40,
    isActive:      true
  },

  // ── Duct Cleaning & Sealing ──────────────────────────────────────────────
  {
    companyId: COMPANY_ID,
    kcId:      kid(9),
    title:     'Duct Cleaning & Sealing',
    category:  'Air Quality',
    keywords: [
      'duct cleaning', 'air ducts', 'clean ducts', 'dirty vents', 'dusty vents',
      'vent cleaning', 'ductwork', 'duct sealing', 'leaky ducts', 'duct work repair',
      'air flow problem', 'poor air flow', 'rooms not cooling', 'uneven temperatures',
      'energy loss', 'dirty air ducts', 'clean my vents', 'air quality from vents',
      'musty from vents', 'duct inspection', 'aeroseal'
    ],
    sections: [
      {
        label:   'Our Duct Cleaning Service',
        content: 'Professional duct cleaning uses truck-mounted high-power vacuum systems with rotating brush agitation to remove dust, debris, mold spores, pet dander, and construction debris from all duct runs. We also clean supply and return registers and the air handler compartment.',
        order: 1
      },
      {
        label:   'Signs You Need Duct Cleaning',
        content: 'Consider duct cleaning if dust blows visibly from vents, you have unexplained indoor allergies, notice musty odors when the system runs, recently completed renovation work, or haven\'t had ducts cleaned in 5+ years.',
        order: 2
      },
      {
        label:   'Duct Sealing with Aeroseal',
        content: 'Up to 30% of conditioned air is lost through duct leaks in average homes. We use Aeroseal — a certified duct sealing technology that seals leaks from the inside out — reducing energy bills by 15–25% and fixing hard-to-cool or hot rooms.',
        order: 3
      },
      {
        label:   'Pricing',
        content: 'Duct cleaning for a standard home starts at $299. Aeroseal duct sealing starts at $999. Cleaning and sealing combination packages are available. Utility rebates of up to $400 may apply for duct sealing in qualifying service areas.',
        order: 4
      }
    ],
    wordLimit:     70,
    bookingAction: 'offer_to_book',
    followUpDepth: 4,
    closingPrompt: 'Offer a free duct assessment or to book the service. If caller has comfort or uneven temperature complaints, mention duct sealing energy savings.',
    priority:      41,
    isActive:      true
  },

  // ── Financing & Payment Options ──────────────────────────────────────────
  {
    companyId: COMPANY_ID,
    kcId:      kid(10),
    title:     'Financing & Payment Options',
    category:  'Financing',
    keywords: [
      'financing', 'payment plan', 'monthly payments', 'payment options',
      'payment methods', 'can i finance', 'zero percent', 'same as cash',
      'no money down', 'afford', 'credit', 'pay over time', 'affordable',
      'how to pay', 'credit card', 'check', 'billing question', 'invoice',
      'how much per month', 'payment due', 'no interest'
    ],
    sections: [
      {
        label:   'Financing Available',
        content: 'We offer flexible financing through GreenSky and Synchrony Financial. Approved customers receive 0% interest for 12, 18, or 24 months on new equipment installations. Monthly payments on a $5,000 system at 18 months are approximately $278/month with approved credit.',
        order: 1
      },
      {
        label:   'Payment Methods We Accept',
        content: 'We accept all major credit cards — Visa, Mastercard, Amex, Discover — plus personal checks, ACH bank transfer, and cash. Service calls are due on completion. New installations require a 50% deposit with balance due at job completion.',
        order: 2
      },
      {
        label:   'Financing for Repairs',
        content: 'For qualifying repairs over $1,000, we offer 6-month same-as-cash financing. Applications take about 2 minutes with instant decisions. The technician can apply on-site, or we can process it over the phone before the appointment.',
        order: 3
      },
      {
        label:   'Other Ways to Save',
        content: 'The Comfort Club plan spreads maintenance costs to a predictable $19.95/month. Many utility providers offer rebates of $100–$500 on high-efficiency equipment. We handle all rebate paperwork on new installations at no extra charge.',
        order: 4
      }
    ],
    wordLimit:     80,
    bookingAction: 'none',
    followUpDepth: 4,
    closingPrompt: 'Be reassuring — money is a real barrier for many callers. Be specific with numbers. If they want detailed financing info, offer a callback from the finance team.',
    priority:      50,
    isActive:      true
  },

  // ── Commercial HVAC Services ─────────────────────────────────────────────
  {
    companyId: COMPANY_ID,
    kcId:      kid(11),
    title:     'Commercial HVAC Services',
    category:  'Commercial',
    keywords: [
      'commercial', 'business', 'commercial hvac', 'office building', 'restaurant',
      'retail', 'warehouse', 'commercial service', 'business account',
      'commercial account', 'rooftop unit', 'rtu', 'commercial installation',
      'commercial repair', 'multi unit', 'apartment complex', 'property manager',
      'facility manager', 'commercial maintenance', 'vrf system', 'commercial bid'
    ],
    sections: [
      {
        label:   'Commercial Services We Provide',
        content: 'We serve light and mid-commercial properties: office buildings, restaurants, retail, medical offices, schools, warehouses, and multi-unit residential. We service rooftop units, split systems, VRF systems, chillers, and commercial heat pumps of all brands.',
        order: 1
      },
      {
        label:   'Commercial Service Agreements',
        content: 'Customized commercial maintenance agreements are available with monthly, quarterly, or semi-annual visit schedules. Agreements include priority emergency dispatch, 24/7 phone support, discounted parts pricing, and detailed service reports for your records.',
        order: 2
      },
      {
        label:   'New Commercial Installation',
        content: 'We design and install commercial HVAC for new construction and tenant build-outs. Our commercial team provides load calculations, equipment submittals, permit management, MEP coordination, and full commissioning documentation.',
        order: 3
      },
      {
        label:   '24/7 Commercial Emergency',
        content: 'Emergency service is available 24/7 for commercial service agreement customers. We understand equipment failure costs you business — commercial emergency calls receive priority dispatch over standard residential calls.',
        order: 4
      }
    ],
    wordLimit:     80,
    bookingAction: 'advisor_callback',
    followUpDepth: 4,
    closingPrompt: 'Commercial callers are high-value B2B accounts. Offer to connect them with a commercial account manager for a custom proposal. Be professional and business-focused.',
    priority:      60,
    isActive:      true
  },

  // ── Service Area & Business Hours ────────────────────────────────────────
  {
    companyId: COMPANY_ID,
    kcId:      kid(12),
    title:     'Service Area & Business Hours',
    category:  'General',
    keywords: [
      'hours', 'open', 'business hours', 'when are you open', 'what time',
      'service area', 'where do you service', 'what areas', 'do you service my area',
      'location', 'how far do you go', 'cover', 'are you available',
      'weekend hours', 'holiday hours', 'after hours',
      'are you open', 'what zip codes', 'do you come to', 'nearby'
    ],
    sections: [
      {
        label:   'Business Hours',
        content: 'Our office is open Monday through Friday 8 AM to 6 PM, Saturday 9 AM to 3 PM, and closed Sunday. Emergency service is available every day of the week including evenings and holidays. After-hours calls are answered by our on-call dispatcher around the clock.',
        order: 1
      },
      {
        label:   'Our Service Area',
        content: 'We serve the greater metropolitan area within approximately 50 miles of our main office, including all surrounding suburbs and communities. Confirm service availability by sharing your zip code or city — we can usually tell you right away.',
        order: 2
      },
      {
        label:   'Appointment Scheduling',
        content: 'We schedule appointments in 2-hour arrival windows. The technician calls 30 minutes ahead. Same-day appointments are available based on technician availability — calling early in the morning gives the best chance at a same-day slot.',
        order: 3
      }
    ],
    wordLimit:     55,
    bookingAction: 'offer_to_book',
    followUpDepth: 2,
    closingPrompt: 'After answering hours or area questions, offer to schedule an appointment.',
    priority:      70,
    isActive:      true
  }

];

// ─────────────────────────────────────────────────────────────────────────────
// 2. BEHAVIOR CARDS — CATEGORY-LINKED
// One BC per KC category governs HOW the agent responds within that category.
// Linked via exact category string match against KC.category.
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORY_BCS = [

  {
    companyId:   COMPANY_ID,
    name:        'Services — Repair & Diagnostic',
    type:        'category_linked',
    category:    'Services',
    tone:        'Professional, efficient, and solution-focused. Sound like a knowledgeable service advisor — not a salesperson. Lead with empathy for the caller\'s discomfort before explaining.',
    rules: {
      do: [
        'Acknowledge the caller\'s discomfort (heat, cold, noise) before explaining anything',
        'Quote the $89 diagnostic fee confidently — it\'s applied toward repair',
        'Mention the 1-year parts and labor warranty to build confidence',
        'Offer to schedule the service call before ending the response',
        'State that most repairs are completed same day with fully-stocked trucks'
      ],
      doNot: [
        'Never hedge — avoid "it might be" or "could be many things"',
        'Never skip quoting the diagnostic fee — transparency builds trust',
        'Never over-explain every possible failure — stay focused on the next step',
        'Never end without attempting to book the service call'
      ],
      exampleResponses: [
        'Of course — sounds like your system needs a diagnostic visit. Our techs carry all the common parts so most repairs are done same day. The service call is $89 and that\'s credited toward the repair. Can I get you on the schedule?',
        'Absolutely, we repair all makes and models. Every repair comes with a 1-year warranty on parts and labor, so you\'re covered. The quickest way to know what\'s going on is to get a tech out there. Can I get you scheduled today?'
      ]
    },
    afterAction: 'collect_info_then_book',
    enabled:     true
  },

  {
    companyId:   COMPANY_ID,
    name:        'Maintenance — Plans & Tune-Ups',
    type:        'category_linked',
    category:    'Maintenance',
    tone:        'Value-driven and membership-focused. Position the Comfort Club as the smart financial move. Sound like an advisor helping the caller save money — not a salesperson.',
    rules: {
      do: [
        'Highlight Comfort Club value relative to single-visit costs',
        'Mention priority scheduling as a key member benefit — no waiting in a heatwave',
        'Offer to schedule the first tune-up immediately',
        'Mention that the plan typically pays for itself with one avoided repair'
      ],
      doNot: [
        'Never pressure the caller to join the Comfort Club',
        'Never dismiss the single-visit tune-up option if that\'s all they want',
        'Never be vague about pricing — quote the plan cost clearly'
      ],
      exampleResponses: [
        'Sure! Our tune-up is $89 and covers a full 21-point inspection of your system. If you\'d like ongoing coverage, our Comfort Club at just under $20 a month includes two tune-ups a year, priority scheduling, and 15% off any repairs. It pays for itself with one repair. Want me to get a tune-up on the books?',
        'Great timing — spring is the best time to service your AC before the heat hits. We have openings this week. Would you like me to get you scheduled?'
      ]
    },
    afterAction: 'collect_info_then_book',
    enabled:     true
  },

  {
    companyId:   COMPANY_ID,
    name:        'Installations — New System Consulting',
    type:        'category_linked',
    category:    'Installations',
    tone:        'Consultative, educational, and never pushy. This is a major purchase. Sound like a trusted advisor helping the caller make the right long-term investment decision.',
    rules: {
      do: [
        'Always offer a free in-home assessment — never quote a final price without one',
        'Mention available financing and federal tax credits to reduce cost anxiety',
        'Give brief context on efficiency ratings — callers want to make smart choices',
        'Mention the 10-year parts warranty to build confidence in the investment'
      ],
      doNot: [
        'Never quote a firm final price without a site assessment',
        'Never dismiss the caller\'s existing system without knowing its condition',
        'Never pressure — new systems are a trust-based, relationship sale',
        'Don\'t overwhelm with technical specs — keep the response digestible'
      ],
      exampleResponses: [
        'We\'d love to help with that. The best way to give you accurate pricing is to have one of our comfort consultants come out for a free in-home assessment — no obligation at all. They\'ll size the system to your home and walk you through the options and financing. Can I schedule that for you?',
        'New systems range depending on size and efficiency, but we\'d need to see your home first for an accurate number. We also have 0% financing and some high-efficiency models qualify for federal tax credits. Can I set up a free consultation?'
      ]
    },
    afterAction: 'collect_info_then_book',
    enabled:     true
  },

  {
    companyId:   COMPANY_ID,
    name:        'Emergency — Urgent HVAC Response',
    type:        'category_linked',
    category:    'Emergency',
    tone:        'Calm, urgent, and deeply empathetic. The caller is stressed and may be hot, cold, or worried about their family. Be their anchor — solve the problem immediately without adding to their anxiety.',
    rules: {
      do: [
        'Open with genuine empathy — acknowledge their situation before anything else',
        'Move to scheduling IMMEDIATELY — this is the absolute priority',
        'Give a realistic arrival window to set expectations',
        'Provide comfort tips while they wait if time permits'
      ],
      doNot: [
        'Never make them sit through a long explanation before offering to book',
        'Never minimize the urgency — treat every emergency as completely real',
        'Never give a vague or long wait time without offering alternatives',
        'Never sound robotic — this is when human warmth matters most'
      ],
      exampleResponses: [
        'I\'m so sorry — we\'re going to get someone out to you as quickly as possible. We have emergency dispatch available today. Let me get you on the priority schedule right now. Can I get your address?',
        'Understood — no AC in this heat is serious. We\'re dispatching today. I\'m getting your information right now and making sure you\'re at the top of our list. What\'s your address?'
      ]
    },
    afterAction: 'collect_info_then_book',
    enabled:     true
  },

  {
    companyId:   COMPANY_ID,
    name:        'Air Quality — Health & Indoor Environment',
    type:        'category_linked',
    category:    'Air Quality',
    tone:        'Educational and health-focused. Position IAQ solutions as a health investment for the family. Sound like an advisor who genuinely cares — not someone pushing an add-on product.',
    rules: {
      do: [
        'Connect the solution directly to the caller\'s specific concern (allergies, odors, dust)',
        'Use concrete effectiveness numbers (99%, etc.) to build credibility',
        'Mention that solutions integrate with their existing system — minimal disruption',
        'Offer a free IAQ assessment as the natural next step'
      ],
      doNot: [
        'Don\'t list every product — focus on what matches the caller\'s concern',
        'Never sound like you\'re selling an add-on — you\'re solving a health issue',
        'Don\'t skip the assessment offer — right-sizing IAQ requires a site visit'
      ],
      exampleResponses: [
        'That\'s a great concern — indoor air is actually 2 to 5 times more polluted than outdoor air in most homes. We have solutions that connect right to your existing system. Would a quick in-home air quality check be helpful so we can see exactly what\'s going on?',
        'For allergies and dust, a whole-home purifier with UV makes a real difference. Most customers notice improvement within the first week. We could have one installed in a couple of hours. Want to schedule that?'
      ]
    },
    afterAction: 'collect_info_then_book',
    enabled:     true
  },

  {
    companyId:   COMPANY_ID,
    name:        'Financing — Payment Options & Accessibility',
    type:        'category_linked',
    category:    'Financing',
    tone:        'Reassuring, accessible, and barrier-removing. The caller is worried about cost. Make them feel confident that there is a path forward regardless of their budget.',
    rules: {
      do: [
        'Lead with the reassurance that flexible options are available',
        'Quote specific terms (0%, 18 months) to make financing feel real and achievable',
        'Mention that financing approval takes 2 minutes with an instant decision',
        'Always close with a next step — offer a free estimate or schedule a callback'
      ],
      doNot: [
        'Never make cost feel like an insurmountable barrier',
        'Never be vague about numbers — specifics build trust',
        'Never skip offering a next step — always move the conversation forward'
      ],
      exampleResponses: [
        'Absolutely — we have financing available at 0% interest for up to 18 months on new equipment. Most approvals take about 2 minutes and decisions are instant. Want me to schedule a free estimate so we can look at options at the same time?',
        'We take all major credit cards, checks, and also offer financing for larger jobs. If you\'re looking at a repair or new system, we can walk through all the payment options when we come out. Would you like to get something scheduled?'
      ]
    },
    afterAction: 'none',
    enabled:     true
  },

  {
    companyId:   COMPANY_ID,
    name:        'Commercial — Business Accounts',
    type:        'category_linked',
    category:    'Commercial',
    tone:        'Professional, B2B-focused, and relationship-oriented. Speak to business needs: reliability, minimal downtime, compliance, and ROI. This is a high-value account conversation.',
    rules: {
      do: [
        'Recognize this as a high-value commercial account from the start',
        'Lead with your commercial capabilities and experience with their facility type',
        'Mention commercial service agreements as the standard business approach',
        'Offer to connect them with a commercial account manager for a custom proposal'
      ],
      doNot: [
        'Never treat a commercial caller like a residential customer',
        'Never quote residential pricing for commercial work',
        'Never rush — commercial accounts are relationship-based, high-LTV sales'
      ],
      exampleResponses: [
        'Absolutely — we have a dedicated commercial division handling everything from rooftop units to VRF systems. Most of our commercial customers are on service agreements that include priority dispatch and discounted parts. Can I connect you with our commercial account manager for a custom proposal?',
        'We service all types of commercial properties — offices, restaurants, warehouses, and more. Our commercial agreements are fully customized to your equipment and visit schedule. What type of facility are you operating?'
      ]
    },
    afterAction: 'advisor_callback',
    enabled:     true
  }

];

// ─────────────────────────────────────────────────────────────────────────────
// 3. BEHAVIOR CARDS — STANDALONE
// Govern specific call flow scenarios that span across all KC categories.
// ─────────────────────────────────────────────────────────────────────────────

const STANDALONE_BCS = [

  {
    companyId:      COMPANY_ID,
    name:           'Inbound Greeting',
    type:           'standalone',
    standaloneType: 'inbound_greeting',
    category:       '',
    tone:           'Warm, welcoming, and natural. First impressions matter. Sound like a genuine, helpful person — not a system prompt.',
    rules: {
      do: [
        'Always greet with the company name clearly and warmly',
        'Use the caller\'s name if it is known',
        'Ask one open-ended question to discover what they need',
        'Set an immediately warm and helpful tone for the entire call'
      ],
      doNot: [
        'Never sound rushed or transactional in the greeting',
        'Never ask for an account number before asking how you can help',
        'Never use empty filler phrases like "your call is important to us"'
      ],
      exampleResponses: [
        'Thank you for calling Penguin Air — how can I help you today?',
        'Hi there, you\'ve reached Penguin Air! What can we help you with today?'
      ]
    },
    afterAction: 'none',
    enabled:     true
  },

  {
    companyId:      COMPANY_ID,
    name:           'Discovery Flow',
    type:           'standalone',
    standaloneType: 'discovery_flow',
    category:       '',
    tone:           'Conversational, patient, and natural. Guide the caller through understanding their need without making them feel interrogated. Mirror their energy and pace.',
    rules: {
      do: [
        'Ask one question at a time — never stack multiple questions in one turn',
        'Confirm understanding before moving to the next step',
        'Acknowledge what the caller has shared before asking for more information',
        'Use natural bridges: "That makes sense", "Got it", "Absolutely"'
      ],
      doNot: [
        'Never ask for contact information before understanding what they need',
        'Never rush through discovery to reach the booking form',
        'Never be robotic — match the caller\'s communication style',
        'Never ask for information the caller already provided earlier in the call'
      ],
      exampleResponses: [
        'Got it — and roughly how long has it been doing that?',
        'That makes sense. And is this for your home or a business property?'
      ]
    },
    afterAction: 'none',
    enabled:     true
  },

  {
    companyId:      COMPANY_ID,
    name:           'Escalation Ladder',
    type:           'standalone',
    standaloneType: 'escalation_ladder',
    category:       '',
    tone:           'De-escalating, empathetic, and solution-focused. When callers are upset, make them feel heard first. Never match negative energy. Slow down and focus on resolution.',
    rules: {
      do: [
        'Acknowledge their frustration genuinely before any explanation or defense',
        'Take ownership of the experience — avoid deflecting or blaming',
        'Offer a concrete next step, not just an apology',
        'Connect them with a supervisor promptly if they request it'
      ],
      doNot: [
        'Never argue or defend company policy when someone is upset',
        'Never dismiss or minimize a complaint',
        'Never transfer immediately without first acknowledging the concern',
        'Never make promises that cannot be kept'
      ],
      exampleResponses: [
        'I completely understand your frustration, and I\'m sorry this has been your experience. That\'s not the standard we hold ourselves to. Let me get this to the right person right away. Can I get your name and account information so they\'re prepared?'
      ]
    },
    afterAction:      'escalate_to_human',
    escalationConfig: {
      tryHoldAndDeescalate: true,
      confirmBeforeTransfer: true,
      offerAlternatives: {
        voicemail:           true,
        callbackScheduling:  true,
        serviceAppointment:  false
      },
      emergencyLine: {
        enabled: false,
        number:  ''
      }
    },
    enabled: true
  },

  {
    companyId:      COMPANY_ID,
    name:           'Payment Routing',
    type:           'standalone',
    standaloneType: 'payment_routing',
    category:       '',
    tone:           'Helpful, efficient, and clear. Payment callers have a specific transactional task. Be direct and warm. Get them to the right place quickly.',
    rules: {
      do: [
        'Identify quickly whether this is a payment, billing question, or invoice dispute',
        'Mention all accepted payment methods clearly and confidently',
        'Offer to transfer to a billing specialist if their need is more complex',
        'Move quickly — payment callers want efficiency, not conversation'
      ],
      doNot: [
        'Never ask for full payment card information over the phone',
        'Never redirect payment callers to a service scheduling conversation',
        'Never leave a payment caller without a clear next step'
      ],
      exampleResponses: [
        'Of course — we accept all major credit cards, check, or ACH transfer. Would you like to make a payment now, or do you have a question about your invoice?'
      ]
    },
    afterAction: 'route_to_payment',
    enabled:     true
  },

  {
    companyId:      COMPANY_ID,
    name:           'Manager Request',
    type:           'standalone',
    standaloneType: 'manager_request',
    category:       '',
    tone:           'Professional, calm, and non-defensive. A manager request is a reasonable ask. Acknowledge it respectfully and route quickly — no friction, no questions that feel like a barrier.',
    rules: {
      do: [
        'Acknowledge the request calmly and without pushback',
        'Ask briefly what the concern is so the supervisor can be prepared',
        'If the caller insists immediately, transfer promptly without hesitation',
        'Let them know the supervisor will be connected shortly'
      ],
      doNot: [
        'Never argue that a manager is not needed',
        'Never make the caller feel like their request is unusual or problematic',
        'Never put them on hold without explanation'
      ],
      exampleResponses: [
        'Absolutely — let me connect you with a supervisor. Can I ask briefly what this is regarding so they\'re prepared when they pick up?',
        'Of course — transferring you to a manager right now. One moment please.'
      ]
    },
    afterAction: 'escalate_to_human',
    enabled:     true
  }

];

// ─────────────────────────────────────────────────────────────────────────────
// 4. CUSTOM INTERCEPTORS
// High-confidence keyword-triggered routing rules that fire BEFORE the KC engine.
// Lower priority number = fires first.
// ─────────────────────────────────────────────────────────────────────────────

const INTERCEPTORS = [

  {
    companyId:   COMPANY_ID,
    name:        'Emergency / Urgent Service',
    description: 'Fires when caller signals urgency or immediate need. Routes directly to the booking engine.',
    enabled:     true,
    priority:    1,
    keywords:    [
      'emergency', 'no ac', 'no heat', 'not working now', 'asap',
      'right now', 'urgent', 'same day service', 'need someone today',
      'its too hot', 'its too cold', 'freezing in here', 'house is hot',
      'been out all day', 'need help now', 'baby', 'no air conditioning'
    ],
    matchMode: 'ANY',
    action: {
      type:        'BOOK',
      bookingMode: 'emergency_service_call'
    }
  },

  {
    companyId:   COMPANY_ID,
    name:        'Transfer to Live Agent',
    description: 'Fires when caller explicitly requests to speak with a person, agent, or dispatcher. Routes to live transfer.',
    enabled:     true,
    priority:    5,
    keywords:    [
      'speak to someone', 'talk to someone', 'speak to a person',
      'talk to a person', 'live agent', 'real person', 'live person',
      'human agent', 'transfer me', 'connect me to someone',
      'speak to an agent', 'talk to an agent', 'get a person on the line'
    ],
    matchMode: 'ANY',
    action: {
      type:           'TRANSFER',
      transferTarget: DISPATCH_PHONE
    }
  },

  {
    companyId:   COMPANY_ID,
    name:        'Schedule / Book Appointment',
    description: 'Fires when caller clearly states they want to schedule or book. Routes directly to booking engine.',
    enabled:     true,
    priority:    10,
    keywords:    [
      'schedule', 'book an appointment', 'set up an appointment',
      'make an appointment', 'come out', 'send a technician',
      'send someone out', 'book a service', 'set up service',
      'i want to schedule', 'can you come out', 'get someone out'
    ],
    matchMode: 'ANY',
    action: {
      type:        'BOOK',
      bookingMode: 'service_call'
    }
  },

  {
    companyId:   COMPANY_ID,
    name:        'Maintenance Plan Inquiry',
    description: 'Fires when caller asks about the maintenance plan or service agreement. Routes to the Comfort Club KC.',
    enabled:     true,
    priority:    20,
    keywords:    [
      'maintenance plan', 'service plan', 'service agreement',
      'comfort club', 'hvac membership', 'service contract',
      'monthly plan', 'annual plan', 'tell me about the plan',
      'maintenance program', 'maintenance subscription'
    ],
    matchMode: 'ANY',
    action: {
      type:             'ROUTE_KC',
      kcContainerId:    kid(4),
      kcContainerName:  'Comfort Club Maintenance Plan'
    }
  },

  {
    companyId:   COMPANY_ID,
    name:        'Billing & Payment Request',
    description: 'Fires when caller asks about paying a bill or invoice. Routes to dispatch/billing for live assistance.',
    enabled:     true,
    priority:    25,
    keywords:    [
      'pay my bill', 'billing', 'my invoice', 'payment due',
      'i owe', 'make a payment', 'account balance',
      'my account', 'billing department', 'pay what i owe'
    ],
    matchMode: 'ANY',
    action: {
      type:           'TRANSFER',
      transferTarget: DISPATCH_PHONE
    }
  },

  {
    companyId:   COMPANY_ID,
    name:        'Manager / Supervisor Request',
    description: 'Fires when caller explicitly asks for a manager or supervisor. Routes to live transfer.',
    enabled:     true,
    priority:    30,
    keywords:    [
      'manager', 'supervisor', 'speak to a manager', 'get a manager',
      'talk to a supervisor', 'speak to your manager',
      'i want a manager', 'get me a supervisor', 'your boss'
    ],
    matchMode: 'ANY',
    action: {
      type:           'TRANSFER',
      transferTarget: DISPATCH_PHONE
    }
  }

];

// ─────────────────────────────────────────────────────────────────────────────
// 5. ARBITRATION POLICY
// Singleton per company — governs the ArbitrationEngine decision logic.
// Optimized for HVAC: booking is the primary conversion goal.
// ─────────────────────────────────────────────────────────────────────────────

const ARBITRATION_POLICY = {
  companyId: COMPANY_ID,

  // Lane locking: once in BOOKING/DISCOVERY/etc., stay there
  laneStickyEnabled: true,
  laneTimeoutMs:     600000,  // 10 minutes — HVAC calls run longer than most

  // Caller phrases that break a lane lock and reopen competition
  escapeKeywords: [
    'cancel', 'stop', 'never mind', 'nevermind', 'actually',
    'wait', 'hold on', 'different question', 'something else',
    'forget it', 'different topic', 'one more thing', 'also'
  ],

  // Signal weights — booking and transfer are hard priorities for HVAC
  weights: {
    booking:    0.95,   // Booking is the goal — weight it high
    transfer:   1.00,   // Transfer requests are always honored
    pricing:    0.65,   // Pricing questions are common and important
    promo:      0.60,   // Promos are secondary to service
    customRule: 1.00,   // Custom rules are intentional — always honored
    kc:         0.70    // KC semantic scoring gets a good base weight
  },

  // Multi-intent: if booking intent is present at all, it wins
  bookingBeatsAll:      true,
  queueSecondaryIntent: true,  // Remember the secondary intent for post-booking

  // Scoring thresholds
  autoRouteMinScore:       0.75,   // Score needed to auto-route without disambiguation
  minScoreGap:             0.20,   // Gap between top-2 needed to auto-route
  disambiguateFloor:       0.35,   // Below this floor → graceful ack, not disambiguation
  maxDisambiguateAttempts: 2       // How many clarifying attempts before graceful ack
};

// ─────────────────────────────────────────────────────────────────────────────
// 6. PRICING ITEMS
// 3-layer service pricing facts with booking CTAs.
// ─────────────────────────────────────────────────────────────────────────────

const PRICING_ITEMS = [

  {
    companyId:      COMPANY_ID,
    label:          'AC Diagnostic Service Call',
    category:       'Diagnostics',
    isActive:       true,
    priority:       10,
    keywords:       ['service call', 'diagnostic fee', 'how much to come out', 'come out fee', 'ac diagnostic', 'call out fee'],
    response:       'Our AC diagnostic service call is $89, and that fee is applied toward any repair we do. We arrive in a 2-hour window and call 30 minutes ahead.',
    includesDetail: 'Includes full visual inspection, electrical testing, refrigerant pressure check, thermostat test, and written diagnosis report.',
    layer2Keywords: ['what does it include', 'what do you check', 'what does that cover'],
    layer2Response: 'The diagnostic covers a full inspection of your compressor, capacitors, contactors, refrigerant pressure, airflow, thermostat, and all electrical connections.',
    layer3Keywords: ['still want to know more', 'anything else'],
    layer3Response: 'We also check your filter, drain line, and indoor coil condition. You\'ll receive a written report with our findings and recommended next steps.',
    action:         'RESPOND_THEN_BOOK',
    actionPrompt:   'Want me to get a technician scheduled for a diagnosis?'
  },

  {
    companyId:      COMPANY_ID,
    label:          'Heating Diagnostic Service Call',
    category:       'Diagnostics',
    isActive:       true,
    priority:       11,
    keywords:       ['furnace diagnostic', 'heating service call', 'furnace service fee', 'heater diagnostic', 'heat diagnostic'],
    response:       'Our heating diagnostic is $89, applied toward any repair. We prioritize heating calls in winter and can often be there same day or next day.',
    includesDetail: 'Includes combustion analysis, heat exchanger inspection, ignitor and flame sensor test, gas pressure check, blower performance, and safety limit testing.',
    layer2Keywords: ['what does heating diagnostic include', 'what do you test on furnace'],
    layer2Response: 'We test the heat exchanger for cracks, check the burner and ignitor, test all safety limits, measure gas pressure, and inspect the flue for safe venting.',
    layer3Keywords: [],
    layer3Response: '',
    action:         'RESPOND_THEN_BOOK',
    actionPrompt:   'Want me to get a heating diagnostic scheduled?'
  },

  {
    companyId:      COMPANY_ID,
    label:          'Spring AC Tune-Up',
    category:       'Maintenance',
    isActive:       true,
    priority:       20,
    keywords:       ['tune up price', 'tune up cost', 'ac tune up', 'spring tune up', 'maintenance visit cost', 'how much is a tune up'],
    response:       'Our spring AC tune-up is $89 and includes a 21-point inspection, coil cleaning, electrical testing, refrigerant check, and lubrication. Comfort Club members get tune-ups included at no extra charge.',
    includesDetail: 'Full 21-point inspection: condenser coil cleaning, evaporator coil inspection, refrigerant pressure check, electrical connection tightening, capacitor test, thermostat calibration, filter check, drain line flush, and lubrication.',
    layer2Keywords: ['what does tune up include', 'whats included in tune up'],
    layer2Response: 'The tune-up covers everything from cleaning the condenser coils to checking your refrigerant charge, tightening electrical connections, and flushing the drain line.',
    layer3Keywords: [],
    layer3Response: '',
    action:         'RESPOND_THEN_BOOK',
    actionPrompt:   'Would you like to get a tune-up scheduled?'
  },

  {
    companyId:      COMPANY_ID,
    label:          'Fall Heating Tune-Up',
    category:       'Maintenance',
    isActive:       true,
    priority:       21,
    keywords:       ['heating tune up', 'furnace tune up', 'fall tune up', 'furnace checkup', 'furnace maintenance cost', 'fall service'],
    response:       'Our fall heating tune-up is $89 and prepares your system for winter. Includes combustion efficiency test, heat exchanger inspection, burner cleaning, and all safety checks.',
    includesDetail: 'Burner cleaning, heat exchanger inspection, combustion efficiency test, flue inspection, blower motor check, ignitor test, safety limit test, thermostat calibration, and filter inspection.',
    layer2Keywords: ['what does heating tune up include', 'whats in the fall service'],
    layer2Response: 'The fall tune-up includes a full combustion analysis, safety limit testing, burner cleaning, flue inspection, and blower performance check — everything to make sure your system runs safely all winter.',
    layer3Keywords: [],
    layer3Response: '',
    action:         'RESPOND_THEN_BOOK',
    actionPrompt:   'Want to get ahead of winter and schedule your heating tune-up?'
  },

  {
    companyId:      COMPANY_ID,
    label:          'Emergency After-Hours Service Call',
    category:       'Emergency',
    isActive:       true,
    priority:       5,
    keywords:       ['emergency fee', 'after hours fee', 'weekend service fee', 'how much after hours', 'emergency service cost'],
    response:       'After-hours and weekend emergency diagnostic fee is $149, applied toward any repair. Same-day emergency dispatch during business hours is $119. Available 7 days a week including holidays.',
    includesDetail: 'Includes priority emergency dispatch, full system diagnosis, upfront repair quote before work begins, and all after-hours technician costs.',
    layer2Keywords: ['why is emergency more expensive', 'why after hours costs more'],
    layer2Response: 'The emergency rate covers our on-call technician\'s dedicated availability outside normal business hours — it ensures someone is always ready to respond when you need it most.',
    layer3Keywords: [],
    layer3Response: '',
    action:         'RESPOND_THEN_BOOK',
    actionPrompt:   'Want me to dispatch a technician right now?'
  },

  {
    companyId:      COMPANY_ID,
    label:          'New Central AC System — Installed',
    category:       'Installations',
    isActive:       true,
    priority:       30,
    keywords:       ['new ac cost', 'new ac price', 'central air cost', 'ac replacement cost', 'new unit price', 'install new ac'],
    response:       'New central AC systems installed typically range from $4,500 to $9,500 depending on system size, brand, and efficiency. We offer free in-home assessments and 0% financing for up to 18 months.',
    includesDetail: 'Price includes equipment, all installation labor, new refrigerant lines if needed, thermostat, permit where required, factory start-up checklist, and 10-year parts warranty registration.',
    layer2Keywords: ['what does installation include', 'whats included in new ac'],
    layer2Response: 'The installation includes removal of old equipment, all labor, refrigerant lines, line set insulation, electrical connections, thermostat, permit management, and factory start-up.',
    layer3Keywords: ['what brands do you carry', 'what brand of ac'],
    layer3Response: 'We install Carrier, Trane, Lennox, Goodman, and Rheem. Our comfort consultant will recommend the best fit for your home and budget during the free assessment.',
    action:         'ADVISOR_CALLBACK',
    actionPrompt:   'For accurate pricing, I can schedule a free in-home assessment with no obligation. Want me to set that up?'
  },

  {
    companyId:      COMPANY_ID,
    label:          'New Furnace — Installed',
    category:       'Installations',
    isActive:       true,
    priority:       31,
    keywords:       ['new furnace cost', 'furnace replacement price', 'how much for new furnace', 'furnace install cost', 'new heater price'],
    response:       'New furnace installations range from $3,500 to $7,500 installed depending on size and efficiency. High-efficiency models may qualify for federal tax credits of up to $2,000.',
    includesDetail: 'Price includes furnace, all installation labor, flue venting, gas line connection, thermostat, permit where required, and 10-year parts warranty registration.',
    layer2Keywords: ['what does furnace installation include', 'furnace install includes what'],
    layer2Response: 'Furnace installation includes removal of old equipment, gas line connection, flue venting, thermostat, electrical hook-up, permit management, and a full combustion test at start-up.',
    layer3Keywords: ['what efficiency furnaces do you install'],
    layer3Response: 'We install 80%, 96%, and 98% efficiency furnaces. The 96% and 98% models qualify for federal energy tax credits. We\'ll recommend the right match during the free assessment.',
    action:         'ADVISOR_CALLBACK',
    actionPrompt:   'Can I schedule a free in-home estimate for you?'
  },

  {
    companyId:      COMPANY_ID,
    label:          'Comfort Club Membership Plan',
    category:       'Maintenance',
    isActive:       true,
    priority:       22,
    keywords:       ['maintenance plan cost', 'comfort club price', 'how much is the plan', 'monthly plan cost', 'service plan pricing'],
    response:       'The Comfort Club is $19.95 per month billed annually, or $199 paid up front. Includes two full tune-ups per year, priority scheduling, 15% off all repairs, and waived diagnostic fees.',
    includesDetail: 'Two seasonal tune-ups (spring AC + fall heating), priority emergency dispatch, 15% off all labor and parts, waived diagnostic fees, no overtime charges, transferable to new homeowners.',
    layer2Keywords: ['what does comfort club include', 'what do i get with comfort club'],
    layer2Response: 'Members get two full tune-ups per year, priority dispatch ahead of non-members, 15% off all repairs, and we waive the diagnostic fee every time you need service.',
    layer3Keywords: ['can i cancel', 'is there a contract'],
    layer3Response: 'No long-term contract at all — you can cancel any time. The plan renews automatically each year and we\'ll send you a reminder before it does.',
    action:         'RESPOND_THEN_BOOK',
    actionPrompt:   'Want me to get you enrolled in the Comfort Club today?'
  }

];

// ─────────────────────────────────────────────────────────────────────────────
// 7. PROMOTIONS
// Active specials the promo interceptor presents when callers ask about deals.
// ─────────────────────────────────────────────────────────────────────────────

const PROMOTIONS = [

  {
    companyId:       COMPANY_ID,
    name:            'Spring AC Tune-Up Special',
    code:            '',
    serviceType:     'maintenance',
    serviceLabel:    'AC Tune-Up',
    discountType:    'custom',
    discountValue:   0,
    description:     'Spring special — complete 21-point AC tune-up for just $79 (regularly $89). Book now before the summer rush fills our schedule.',
    bookingPrompt:   'Would you like to lock in the spring rate while it\'s still available?',
    noCouponResponse:'No coupon needed — just mention the spring special when you call and we\'ll apply the discount.',
    terms:           'Valid for new appointments booked this spring season. One system per household. Not combinable with other offers. Comfort Club members already receive tune-ups at no charge.',
    isActive:        true,
    priority:        10
  },

  {
    companyId:       COMPANY_ID,
    name:            'New Customer Free Diagnostic',
    code:            'NEWCUST',
    serviceType:     'repair',
    serviceLabel:    'Free Diagnostic with Comfort Club Enrollment',
    discountType:    'custom',
    discountValue:   0,
    description:     'New customers receive their first diagnostic service call free when enrolling in the Comfort Club membership on the same visit.',
    bookingPrompt:   'Are you a new customer? If so, I can get you enrolled in the Comfort Club and schedule your free diagnostic in the same call.',
    noCouponResponse:'No coupon code needed — just let us know you\'re a new customer when we arrive and we\'ll waive the diagnostic with your Comfort Club enrollment.',
    terms:           'Valid for first-time customers only. Diagnostic fee waived with same-day Comfort Club enrollment. Cannot be combined with other diagnostic offers.',
    isActive:        true,
    priority:        20
  },

  {
    companyId:       COMPANY_ID,
    name:            'Comfort Club — First Month Free',
    code:            'CLUB30',
    serviceType:     'all',
    serviceLabel:    'Comfort Club Membership',
    discountType:    'custom',
    discountValue:   0,
    description:     'Join the Comfort Club this month and get your first month free — two full tune-ups, priority service, and 15% off all repairs starting immediately.',
    bookingPrompt:   'Want to go ahead and enroll? We can schedule your first tune-up at the same time.',
    noCouponResponse:'Mention code CLUB30 when signing up or we can apply it right now over the phone.',
    terms:           'First month free for new Comfort Club members only. Plan renews at $19.95/month after the first month. Offer valid for a limited time.',
    isActive:        true,
    priority:        30
  },

  {
    companyId:       COMPANY_ID,
    name:            'Smart Thermostat — $50 Off Installed',
    code:            'SMART50',
    serviceType:     'all',
    serviceLabel:    'WiFi Smart Thermostat Installation',
    discountType:    'flat_discount',
    discountValue:   50,
    description:     '$50 off a WiFi smart thermostat installed with any service visit, new system, or tune-up. Control your comfort from anywhere on your phone.',
    bookingPrompt:   'Want to add a smart thermostat to your visit? That\'s $50 off when combined with your service today.',
    noCouponResponse:'Mention code SMART50 when scheduling or the technician can apply it on-site.',
    terms:           '$50 discount applied to thermostat installation labor. Valid with any scheduled service, tune-up, or new system installation. One per household.',
    isActive:        true,
    priority:        40
  }

];

// ─────────────────────────────────────────────────────────────────────────────
// MAIN — execute all upserts
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  if (!MONGODB_URI) {
    console.error('\n❌  MONGODB_URI environment variable is not set.\n');
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  console.log('\n' + BOLD + CYAN + '╔══════════════════════════════════════════════════════╗' + RESET);
  console.log(BOLD + CYAN     + '║   PENGUIN AIR — HVAC WORLD-CLASS RECEPTIONIST SEED  ║' + RESET);
  console.log(BOLD + CYAN     + '╚══════════════════════════════════════════════════════╝' + RESET);
  console.log(`\n  Company   : ${COMPANY_ID}`);
  console.log(`  KC Prefix : ${KC_PREFIX}`);
  console.log(`  Dispatch  : ${DISPATCH_PHONE}`);
  console.log(`  Database  : ${DB_NAME}\n`);

  const counts = { settings: 0, kc: 0, bc: 0, interceptor: 0, policy: 0, pricing: 0, promo: 0 };

  // ── 0. Company settings ──────────────────────────────────────────────────
  banner('0. COMPANY SETTINGS');

  const settingsRes = await db.collection('companiesCollection').updateOne(
    { _id: new ObjectId(COMPANY_ID) },
    {
      $set:  { 'aiAgentSettings.agent2.discovery.arbitrationEnabled': true },
      $max:  { 'aiAgentSettings.kcSeq': 12 }
    }
  );
  counts.settings++;
  if (settingsRes.matchedCount === 0) {
    note('Settings', `Company not found — check COMPANY_ID (${COMPANY_ID})`);
  } else {
    ok('Settings', `arbitrationEnabled=true | kcSeq ensured ≥ 12 (modified: ${settingsRes.modifiedCount})`);
  }

  // ── 1. Knowledge Containers ──────────────────────────────────────────────
  banner('1. KNOWLEDGE CONTAINERS');

  for (const kc of KC_CONTAINERS) {
    await db.collection('companyKnowledgeContainers').updateOne(
      { companyId: COMPANY_ID, kcId: kc.kcId },
      { $set: { ...kc, updatedAt: NOW }, $setOnInsert: { createdAt: NOW } },
      { upsert: true }
    );
    counts.kc++;
    const negKwCount = kc.negativeKeywords?.length || 0;
    const negSuffix  = negKwCount ? `, ${negKwCount} neg` : '';
    ok('KC', `${kc.kcId} — ${kc.title} [${kc.category}] (${kc.keywords.length} keywords${negSuffix})`);
  }

  // ── 2. Behavior Cards — Category-linked ──────────────────────────────────
  banner('2. BEHAVIOR CARDS — CATEGORY-LINKED');

  for (const bc of CATEGORY_BCS) {
    await db.collection('behaviorCards').updateOne(
      { companyId: COMPANY_ID, type: 'category_linked', category: bc.category },
      { $set: { ...bc, updatedAt: NOW }, $setOnInsert: { createdAt: NOW } },
      { upsert: true }
    );
    counts.bc++;
    ok('BC', `${bc.category} → afterAction: ${bc.afterAction}`);
  }

  // ── 3. Behavior Cards — Standalone ───────────────────────────────────────
  banner('3. BEHAVIOR CARDS — STANDALONE');

  for (const bc of STANDALONE_BCS) {
    await db.collection('behaviorCards').updateOne(
      { companyId: COMPANY_ID, standaloneType: bc.standaloneType },
      { $set: { ...bc, updatedAt: NOW }, $setOnInsert: { createdAt: NOW } },
      { upsert: true }
    );
    counts.bc++;
    ok('BC', `${bc.standaloneType} → afterAction: ${bc.afterAction}`);
  }

  // ── 4. Interceptors ───────────────────────────────────────────────────────
  banner('4. CUSTOM INTERCEPTORS');

  for (const interceptor of INTERCEPTORS) {
    await db.collection('companyInterceptors').updateOne(
      { companyId: COMPANY_ID, name: interceptor.name },
      { $set: { ...interceptor, updatedAt: NOW }, $setOnInsert: { createdAt: NOW, stats: { matchCount: 0, lastMatchedAt: null } } },
      { upsert: true }
    );
    counts.interceptor++;
    ok('INT', `[P${interceptor.priority}] "${interceptor.name}" → ${interceptor.action.type} (${interceptor.matchMode}/${interceptor.keywords.length} kw)`);
  }

  // ── 5. Arbitration Policy ─────────────────────────────────────────────────
  banner('5. ARBITRATION POLICY');

  await db.collection('companyArbitrationPolicies').updateOne(
    { companyId: COMPANY_ID },
    { $set: { ...ARBITRATION_POLICY, updatedAt: NOW }, $setOnInsert: { createdAt: NOW } },
    { upsert: true }
  );
  counts.policy++;
  ok('POLICY', `bookingBeatsAll=${ARBITRATION_POLICY.bookingBeatsAll} | laneTimeout=${ARBITRATION_POLICY.laneTimeoutMs/60000}min | ${ARBITRATION_POLICY.escapeKeywords.length} escape keywords`);

  // ── 6. Pricing Items ──────────────────────────────────────────────────────
  banner('6. PRICING ITEMS');

  for (const item of PRICING_ITEMS) {
    await db.collection('companyPricingItems').updateOne(
      { companyId: COMPANY_ID, label: item.label },
      { $set: { ...item, updatedAt: NOW }, $setOnInsert: { createdAt: NOW } },
      { upsert: true }
    );
    counts.pricing++;
    ok('PRICE', `"${item.label}" [${item.category}] → ${item.action}`);
  }

  // ── 7. Promotions ─────────────────────────────────────────────────────────
  banner('7. PROMOTIONS');

  for (const promo of PROMOTIONS) {
    await db.collection('companyPromotions').updateOne(
      { companyId: COMPANY_ID, name: promo.name },
      { $set: { ...promo, updatedAt: NOW }, $setOnInsert: { createdAt: NOW } },
      { upsert: true }
    );
    counts.promo++;
    ok('PROMO', `"${promo.name}"${promo.code ? ` [${promo.code}]` : ''} → ${promo.discountType}`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n' + BOLD + GREEN + '╔══════════════════════════════════════════════════════╗' + RESET);
  console.log(BOLD + GREEN         + '║                 ✅  SEED COMPLETE                   ║' + RESET);
  console.log(BOLD + GREEN         + '╚══════════════════════════════════════════════════════╝' + RESET);
  console.log(`
  ${BOLD}What was seeded:${RESET}
    📚  ${counts.kc}  Knowledge Containers  (12 HVAC topics, fully keyworded)
    🃏  ${counts.bc}  Behavior Cards        (7 category-linked + 5 standalone flows)
    🔀  ${counts.interceptor}   Interceptors          (emergency, booking, transfer, plan, billing)
    ⚖️   ${counts.policy}   Arbitration Policy    (bookingBeatsAll, 10-min lane lock, HVAC-optimized)
    💰  ${counts.pricing}   Pricing Items         (3-layer responses with booking CTAs)
    🎟️   ${counts.promo}   Promotions            (spring special, new customer, Comfort Club, thermostat)
    ⚙️   ${counts.settings}   Company Settings      (arbitrationEnabled=true, kcSeq≥12)

  ${BOLD}Next steps:${RESET}
    1. Update DISPATCH_PHONE in Render env vars to actual company phone number
    2. Enable Arbitration Engine per company in Agent Console → Agent 2.0 settings
    3. Review KC containers in Knowledge Base UI and adjust pricing/details per company
    4. Test a call with emergency, booking, maintenance plan, and pricing scenarios
    5. Use Trace Replay in ⚖️ Intent Arbitration Console to verify routing decisions
  `);

  await client.close();
}

main().catch((err) => {
  console.error('\n❌  Seed failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
