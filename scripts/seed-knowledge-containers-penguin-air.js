/**
 * =============================================================================
 * SEED: Knowledge Containers — Penguin Air (HVAC Demo)
 * =============================================================================
 *
 * Demonstrates the full capability of the Knowledge Container system:
 *   - All three booking actions  (offer_to_book | advisor_callback | none)
 *   - Custom word limits vs global default
 *   - Multiple categories        (Services, Specials, Policies, Plans, Financing, Commercial)
 *   - Rich multi-section cards   (2–5 sections per container)
 *   - Active and inactive items  (shows the toggle feature)
 *   - Priority ordering          (lower number = matched first in ties)
 *   - Diverse keyword sets       (short phrases a real caller would say)
 *
 * Also sets knowledgeBaseSettings on the company document to sensible demo
 * values so the Global Settings card in services.html shows real data.
 *
 * RENDER SHELL USAGE:
 *   node scripts/seed-knowledge-containers-penguin-air.js
 *
 * =============================================================================
 */

'use strict';

const { MongoClient, ObjectId } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const COMPANY_ID  = '68e3f77a9d623b8058c700c4'; // Penguin Air
const COMPANY_OID = new ObjectId(COMPANY_ID);
const DB_NAME     = 'clientsvia';
const COLL        = 'companyKnowledgeContainers';
const COMPANIES   = 'companiesCollection';

const NOW = new Date();

// ─────────────────────────────────────────────────────────────────────────────
// CONTAINERS
// 15 examples — every feature exercised at least once
// ─────────────────────────────────────────────────────────────────────────────

const containers = [

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Spring AC Tune-Up Special
  //    ▸ Category: Specials   ▸ Booking: offer_to_book
  //    ▸ wordLimit: 20 (short — specials need punchy delivery)
  //    ▸ Priority: 5 (highest — active special beats all others in ties)
  // ──────────────────────────────────────────────────────────────────────────
  {
    companyId:     COMPANY_ID,
    title:         'Spring AC Tune-Up Special',
    category:      'Specials',
    sections: [
      {
        label:   'The Deal',
        content: 'Spring tune-up special is $79 — normally $129. Includes everything in our standard tune-up. Runs through May 31st. Mention the spring special when you book to lock in the price.',
        order:   0
      },
      {
        label:   "What's Included",
        content: 'Full system inspection, coil cleaning (evaporator and condenser), refrigerant level check, electrical connections tightened, thermostat calibration, drain line flush, filter check, and a written report of anything we find.',
        order:   1
      },
      {
        label:   'How to Book',
        content: 'We can usually get you in within 3–5 business days. Appointments run Monday–Saturday, 8am–6pm. We give a 2-hour arrival window and text you when the tech is 30 minutes out.',
        order:   2
      }
    ],
    keywords: [
      'spring special', 'spring deal', 'tune-up special', 'AC special', 'discount',
      'deal', 'coupon', 'promotion', 'savings', 'do you have any specials',
      'any deals going on', 'current promotion', 'how much is the special'
    ],
    wordLimit:     20,
    bookingAction: 'offer_to_book',
    isActive:      true,
    priority:      5,
    createdAt:     NOW,
    updatedAt:     NOW
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Senior & Military Discount
  //    ▸ Category: Specials   ▸ Booking: offer_to_book
  //    ▸ wordLimit: 20   ▸ Priority: 7
  // ──────────────────────────────────────────────────────────────────────────
  {
    companyId:     COMPANY_ID,
    title:         'Senior & Military Discount',
    category:      'Specials',
    sections: [
      {
        label:   'Discount',
        content: '10% off all services and parts for seniors (65+) and active or retired military. Discount applies to labor and parts — not to already-discounted specials or promotions.',
        order:   0
      },
      {
        label:   'How to Claim',
        content: 'Just mention it when you book. No paperwork needed for seniors — we take your word for it. Military customers, our tech may ask to see a military ID or card on-site.',
        order:   1
      },
      {
        label:   'Does It Stack?',
        content: 'The senior and military discount cannot be combined with other promotions or specials. We will apply whichever gives you the bigger saving.',
        order:   2
      }
    ],
    keywords: [
      'senior discount', 'senior citizen', 'military discount', 'veteran discount',
      'AARP', 'retired', 'do you have a senior discount', 'military',
      'active duty', 'do seniors get a discount', 'disabled veteran'
    ],
    wordLimit:     20,
    bookingAction: 'offer_to_book',
    isActive:      true,
    priority:      7,
    createdAt:     NOW,
    updatedAt:     NOW
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Emergency After-Hours Service
  //    ▸ Category: Services   ▸ Booking: offer_to_book
  //    ▸ wordLimit: 30 (caller is stressed, needs clear facts)
  //    ▸ Priority: 8
  // ──────────────────────────────────────────────────────────────────────────
  {
    companyId:     COMPANY_ID,
    title:         'Emergency After-Hours Service',
    category:      'Services',
    sections: [
      {
        label:   'Availability',
        content: '24 hours a day, 7 days a week including holidays. We never send callers to voicemail for emergencies — a dispatcher picks up immediately after hours.',
        order:   0
      },
      {
        label:   'Pricing',
        content: 'After-hours emergency service call is $149 (evenings after 6pm and weekends) or $199 (overnight 10pm–7am and holidays). That covers the dispatch and first hour of labor. Parts and additional labor billed at standard rates.',
        order:   1
      },
      {
        label:   'Response Time',
        content: 'We aim to have a tech on-site within 2 hours. In peak summer, it can stretch to 3–4 hours. We will give you an honest ETA when you call.',
        order:   2
      },
      {
        label:   'What Counts as an Emergency',
        content: 'No cooling over 85°F inside, system blowing hot air, refrigerant leak, burning smell or sparks, flooded drain pan, or any electrical issue. If you are unsure, call us — we would rather help than have you wait.',
        order:   3
      }
    ],
    keywords: [
      'emergency', 'after hours', 'not working', 'AC broken', 'AC out',
      'no air conditioning', 'urgent', 'ASAP', 'tonight', 'right now',
      'weekend service', 'do you work weekends', 'holiday', 'broken down',
      'not cooling', 'blowing hot air', 'burning smell'
    ],
    wordLimit:     30,
    bookingAction: 'offer_to_book',
    isActive:      true,
    priority:      8,
    createdAt:     NOW,
    updatedAt:     NOW
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Residential Maintenance Visit
  //    ▸ Category: Services   ▸ Booking: offer_to_book
  //    ▸ wordLimit: null → uses global default (25)
  //    ▸ Priority: 10
  // ──────────────────────────────────────────────────────────────────────────
  {
    companyId:     COMPANY_ID,
    title:         'Residential Maintenance Visit',
    category:      'Services',
    sections: [
      {
        label:   'Price',
        content: 'Standard maintenance visit is $129 per system. If you have two units (upstairs and downstairs) it is $109 each when done same day.',
        order:   0
      },
      {
        label:   "What's Included",
        content: 'Full 21-point inspection covering: refrigerant levels, coil cleaning, electrical connections, capacitor test, contactor check, blower motor, filter, thermostat calibration, condensate drain flush, duct visual, and a written health report.',
        order:   1
      },
      {
        label:   'Duration',
        content: 'About 60–90 minutes per system. Two systems in the same house is usually done in under 2 hours.',
        order:   2
      },
      {
        label:   'How Often',
        content: 'We recommend once a year minimum — ideally in spring before the heat hits. Customers on our maintenance plan get two visits per year plus priority scheduling.',
        order:   3
      }
    ],
    keywords: [
      'maintenance', 'tune-up', 'service visit', 'annual service', 'AC checkup',
      'how much is a tune-up', 'service my AC', 'maintenance visit', 'check my AC',
      'inspection', 'how much does maintenance cost', 'yearly service'
    ],
    wordLimit:     null,
    bookingAction: 'offer_to_book',
    isActive:      true,
    priority:      10,
    createdAt:     NOW,
    updatedAt:     NOW
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Maintenance Plan / Service Agreement
  //    ▸ Category: Plans   ▸ Booking: offer_to_book
  //    ▸ wordLimit: 35   ▸ Priority: 12
  // ──────────────────────────────────────────────────────────────────────────
  {
    companyId:     COMPANY_ID,
    title:         'Maintenance Plan — Penguin Protection Plan',
    category:      'Plans',
    sections: [
      {
        label:   'Monthly Cost',
        content: '$19.99/month per system billed annually ($239.88/year), or $24.99/month if you prefer month-to-month. Cancel anytime with 30 days notice.',
        order:   0
      },
      {
        label:   "What's Included",
        content: 'Two full maintenance visits per year (spring and fall), 15% discount on all repairs and parts, no service call fee on covered visits, refrigerant top-off up to 1 lb included if needed, and annual duct inspection.',
        order:   1
      },
      {
        label:   'Priority Scheduling',
        content: 'Plan members go to the front of the queue — in summer emergencies you are treated as a priority customer. Average wait for members during peak season is under 4 hours vs 8+ for non-members.',
        order:   2
      },
      {
        label:   'Is It Worth It?',
        content: 'Two maintenance visits alone would cost $258. The plan is $240 and adds priority service plus a 15% repair discount. Most customers who have one repair in a year break even or come out ahead.',
        order:   3
      }
    ],
    keywords: [
      'maintenance plan', 'service plan', 'service agreement', 'monthly plan',
      'annual plan', 'protection plan', 'membership', 'service contract',
      'do you have a plan', 'monthly service', 'how much is the plan',
      'Penguin plan', 'protect my AC'
    ],
    wordLimit:     35,
    bookingAction: 'offer_to_book',
    isActive:      true,
    priority:      12,
    createdAt:     NOW,
    updatedAt:     NOW
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 6. New System Installation
  //    ▸ Category: Services   ▸ Booking: advisor_callback
  //    ▸ wordLimit: 40 (complex topic — caller needs more context)
  //    ▸ Priority: 15
  //    ▸ Uses advisor_callback because installs need a site assessment
  // ──────────────────────────────────────────────────────────────────────────
  {
    companyId:     COMPANY_ID,
    title:         'New System Installation',
    category:      'Services',
    sections: [
      {
        label:   'Price Range',
        content: 'New central AC system (equipment + installation) typically runs $4,500–$9,000 depending on size, efficiency rating, and existing ductwork condition. We do not quote over the phone — a free in-home assessment takes 30 minutes and gives you an exact number.',
        order:   0
      },
      {
        label:   "What's Included",
        content: 'Equipment, installation labor, electrical connections, refrigerant charge, permit (where required), haul-away of old unit, and a 1-year labor warranty. We install Carrier, Trane, and Lennox systems.',
        order:   1
      },
      {
        label:   'Timeline',
        content: 'Most installs are completed same day or next day once you approve the quote. Complex jobs with duct modifications may take 1–2 days.',
        order:   2
      },
      {
        label:   'Financing Available',
        content: '0% financing for 18 months on approved credit through our partner GreenSky. No money down, payments start 30 days after install.',
        order:   3
      },
      {
        label:   'Free Assessment',
        content: 'Our advisor will measure your home, inspect existing ducts, check electrical capacity, and recommend the right size and efficiency level. No sales pressure — you get a written quote to review on your timeline.',
        order:   4
      }
    ],
    keywords: [
      'new system', 'replace AC', 'new AC', 'new unit', 'full replacement',
      'install new', 'how much for a new system', 'replace my unit',
      'new air conditioner', 'brand new system', 'install AC', 'new HVAC',
      'upgrade my system', 'how much does a new AC cost'
    ],
    wordLimit:     40,
    bookingAction: 'advisor_callback',
    isActive:      true,
    priority:      15,
    createdAt:     NOW,
    updatedAt:     NOW
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 7. Air Duct Cleaning
  //    ▸ Category: Services   ▸ Booking: offer_to_book
  //    ▸ wordLimit: null → global default   ▸ Priority: 20
  // ──────────────────────────────────────────────────────────────────────────
  {
    companyId:     COMPANY_ID,
    title:         'Air Duct Cleaning',
    category:      'Services',
    sections: [
      {
        label:   'Price',
        content: '$299 for up to 10 vents, $19 per vent after that. Average 3-bedroom home with 14 vents runs $385. Includes supply vents, return vents, and main trunk lines.',
        order:   0
      },
      {
        label:   "What's Included",
        content: 'Negative-pressure vacuum system cleans all ducts from inside. We sanitize with an EPA-registered antimicrobial agent, replace the main filter, and take before/after photos for your records.',
        order:   1
      },
      {
        label:   'Duration',
        content: 'Most homes take 2–3 hours. Larger homes or heavily contaminated systems can take up to 5 hours.',
        order:   2
      },
      {
        label:   'Do You Actually Need It?',
        content: 'Signs you need duct cleaning: visible dust blowing out of vents, musty or stale smell when the AC runs, allergy symptoms that are worse indoors, or if it has been more than 5 years. We will tell you honestly if your ducts do not need it.',
        order:   3
      }
    ],
    keywords: [
      'duct cleaning', 'air ducts', 'clean my ducts', 'duct cleaning cost',
      'dirty ducts', 'dust in vents', 'smell from vents', 'air quality',
      'clean vents', 'how much to clean ducts', 'duct service'
    ],
    wordLimit:     null,
    bookingAction: 'offer_to_book',
    isActive:      true,
    priority:      20,
    createdAt:     NOW,
    updatedAt:     NOW
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 8. Refrigerant Recharge
  //    ▸ Category: Services   ▸ Booking: advisor_callback
  //    ▸ wordLimit: null   ▸ Priority: 25
  //    ▸ advisor_callback because low refrigerant always means a leak —
  //      needs diagnosis before quoting
  // ──────────────────────────────────────────────────────────────────────────
  {
    companyId:     COMPANY_ID,
    title:         'Refrigerant Recharge (Freon)',
    category:      'Services',
    sections: [
      {
        label:   'Price',
        content: 'R-410A refrigerant is $95–$120 per pound. Most residential systems need 1–3 lbs to recharge. The service call ($89) includes the diagnostic — if you book the repair same day, the service call fee is waived.',
        order:   0
      },
      {
        label:   'Important — Low Refrigerant Means a Leak',
        content: 'Refrigerant does not get used up like fuel — if your system is low, there is a leak somewhere. Topping it off without fixing the leak is a temporary fix. Our tech will locate and quote the leak repair at the same visit.',
        order:   1
      },
      {
        label:   'R-22 (Old Freon)',
        content: 'If your system uses R-22 (systems made before 2010), it is now a controlled substance and very expensive — $150–$200 per pound. We will tell you honestly if it is more cost-effective to replace the system.',
        order:   2
      },
      {
        label:   'Signs You Need a Recharge',
        content: 'AC runs but barely cools, ice forming on the refrigerant lines or coil, hissing or bubbling sound, higher electric bills. Call us before the system completely stops cooling.',
        order:   3
      }
    ],
    keywords: [
      'refrigerant', 'Freon', 'recharge', 'low refrigerant', 'add refrigerant',
      'needs Freon', 'top off refrigerant', 'refrigerant leak', 'R-410A',
      'R-22', 'how much is Freon', 'ice on AC line', 'not cooling enough'
    ],
    wordLimit:     null,
    bookingAction: 'advisor_callback',
    isActive:      true,
    priority:      25,
    createdAt:     NOW,
    updatedAt:     NOW
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 9. Financing Options
  //    ▸ Category: Financing   ▸ Booking: advisor_callback
  //    ▸ wordLimit: 40   ▸ Priority: 30
  //    ▸ advisor_callback — financing needs a person to walk through options
  // ──────────────────────────────────────────────────────────────────────────
  {
    companyId:     COMPANY_ID,
    title:         'Financing Options',
    category:      'Financing',
    sections: [
      {
        label:   'Available Plans',
        content: 'We offer financing through GreenSky: 0% interest for 18 months, 3.99% for 60 months, and 6.99% for 120 months (10 years). All plans have no prepayment penalty.',
        order:   0
      },
      {
        label:   'Approval',
        content: 'Soft credit check — no hard pull until you accept. Most customers get an answer in under 2 minutes. Minimum job size $1,000 to qualify.',
        order:   1
      },
      {
        label:   'Monthly Payment Examples',
        content: 'A $6,000 system on the 18-month 0% plan is $333/month. On the 60-month plan it is about $110/month. On the 10-year plan, roughly $66/month. Our advisor will run exact numbers based on your job total.',
        order:   2
      },
      {
        label:   'How to Apply',
        content: 'Our advisor calls you, walks through options, and can start the application over the phone. You e-sign and we schedule install. The whole process takes about 15 minutes.',
        order:   3
      }
    ],
    keywords: [
      'financing', 'finance', 'payment plan', 'monthly payments', 'pay monthly',
      'can I finance', 'payment options', 'cannot afford', 'afford it',
      'no money down', 'credit', 'loan', 'interest free', '0 percent',
      'how do I pay', 'installments'
    ],
    wordLimit:     40,
    bookingAction: 'advisor_callback',
    isActive:      true,
    priority:      30,
    createdAt:     NOW,
    updatedAt:     NOW
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 10. Indoor Air Quality Assessment
  //     ▸ Category: Services   ▸ Booking: offer_to_book
  //     ▸ wordLimit: null   ▸ Priority: 35
  // ──────────────────────────────────────────────────────────────────────────
  {
    companyId:     COMPANY_ID,
    title:         'Indoor Air Quality Assessment',
    category:      'Services',
    sections: [
      {
        label:   'Price',
        content: '$149 for a full indoor air quality assessment. Includes a written report and recommendations. If you purchase any recommended equipment same day, the assessment fee is credited toward the purchase.',
        order:   0
      },
      {
        label:   'What We Test',
        content: 'Particulate matter (dust, allergens, pet dander), VOCs (volatile organic compounds from paint, cleaning products, furniture), carbon monoxide, humidity levels, mold spore count, and CO2 levels.',
        order:   1
      },
      {
        label:   'What You Get',
        content: 'A printed and emailed report with your readings, what they mean, and specific product recommendations if any levels are elevated. No obligation to buy anything.',
        order:   2
      },
      {
        label:   'Solutions',
        content: 'Depending on results we may recommend a whole-home air purifier ($399–$899 installed), UV germicidal light ($349 installed), whole-home humidifier or dehumidifier, or upgraded filtration. All are optional.',
        order:   3
      }
    ],
    keywords: [
      'air quality', 'indoor air quality', 'air quality test', 'IAQ',
      'allergies', 'dust', 'air quality assessment', 'pollutants',
      'clean air', 'air purifier', 'test my air', 'mold', 'VOCs',
      'is my air clean', 'air quality inside'
    ],
    wordLimit:     null,
    bookingAction: 'offer_to_book',
    isActive:      true,
    priority:      35,
    createdAt:     NOW,
    updatedAt:     NOW
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 11. Commercial HVAC Services
  //     ▸ Category: Commercial   ▸ Booking: advisor_callback
  //     ▸ wordLimit: 35   ▸ Priority: 40
  //     ▸ advisor_callback — commercial always needs a site visit
  // ──────────────────────────────────────────────────────────────────────────
  {
    companyId:     COMPANY_ID,
    title:         'Commercial HVAC Services',
    category:      'Commercial',
    sections: [
      {
        label:   'What We Cover',
        content: 'Office buildings, retail spaces, restaurants, medical offices, warehouses, and multi-unit residential up to 20 tons per unit. Rooftop units, chillers, split systems, and packaged units. We do not service industrial refrigeration.',
        order:   0
      },
      {
        label:   'Service Agreements',
        content: 'Commercial service agreements start at $199/month for a single rooftop unit and include quarterly maintenance, priority emergency response (target 2 hours), and 10% off all repairs. Multi-unit pricing available.',
        order:   1
      },
      {
        label:   'Emergency Response',
        content: 'Commercial emergency calls are handled by a dedicated commercial dispatcher. We prioritize medical offices and food service above all others. Target on-site time is 90 minutes for commercial emergencies.',
        order:   2
      },
      {
        label:   'How to Get a Quote',
        content: 'Our commercial advisor will do a free site walk-through — usually within 48 hours of your call. We will assess your equipment, current maintenance status, and recommend a service plan or repair scope.',
        order:   3
      }
    ],
    keywords: [
      'commercial', 'business', 'office', 'commercial HVAC', 'rooftop unit',
      'commercial service', 'restaurant', 'retail', 'commercial building',
      'commercial AC', 'commercial maintenance', 'multi-unit', 'commercial repair'
    ],
    wordLimit:     35,
    bookingAction: 'advisor_callback',
    isActive:      true,
    priority:      40,
    createdAt:     NOW,
    updatedAt:     NOW
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 12. Service Call / Diagnostic Fee
  //     ▸ Category: Pricing   ▸ Booking: none (just answer the question)
  //     ▸ wordLimit: 15 (caller only needs one fact — waive the fee)
  //     ▸ Priority: 45
  //     ▸ Shows bookingAction: 'none' — answer only, no follow-up
  // ──────────────────────────────────────────────────────────────────────────
  {
    companyId:     COMPANY_ID,
    title:         'Service Call & Diagnostic Fee',
    category:      'Pricing',
    sections: [
      {
        label:   'Service Call Fee',
        content: '$89 service call fee covers the dispatch and first 30 minutes of diagnostic time. The tech will find the problem and give you a repair quote before starting any work.',
        order:   0
      },
      {
        label:   'Fee Waiver',
        content: 'If you book the repair with us at the same visit, the $89 service call fee is waived — you only pay for the repair. The fee is only charged if you choose not to proceed with the repair.',
        order:   1
      },
      {
        label:   'After-Hours Service Call',
        content: 'Evening/weekend diagnostic is $149, overnight and holiday is $199. Same waiver applies — book the repair and the fee drops off the invoice.',
        order:   2
      }
    ],
    keywords: [
      'service call fee', 'diagnostic fee', 'trip charge', 'how much just to come out',
      'do you charge to come out', 'is there a fee', 'call fee', 'dispatch fee',
      'just to look at it', 'just to diagnose', 'service call cost'
    ],
    wordLimit:     15,
    bookingAction: 'none',
    isActive:      true,
    priority:      45,
    createdAt:     NOW,
    updatedAt:     NOW
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 13. Warranty & Parts Policy
  //     ▸ Category: Policies   ▸ Booking: none
  //     ▸ wordLimit: 30   ▸ Priority: 50
  // ──────────────────────────────────────────────────────────────────────────
  {
    companyId:     COMPANY_ID,
    title:         'Warranty & Parts Policy',
    category:      'Policies',
    sections: [
      {
        label:   'Labor Warranty',
        content: '1-year labor warranty on all repairs we perform. If the same component fails within 12 months due to our workmanship, we fix it at no charge.',
        order:   0
      },
      {
        label:   'Parts Warranty',
        content: 'All parts we install carry a minimum 1-year warranty. OEM (original manufacturer) parts often come with a 5-year warranty — we will tell you which warranty applies to your specific part at the time of repair.',
        order:   1
      },
      {
        label:   'Manufacturer Warranty on New Systems',
        content: 'New Carrier, Trane, or Lennox systems installed by us come with 10-year parts warranty (requires registration within 90 days of install — we handle that for you). Labor warranty on new installs is 2 years.',
        order:   2
      },
      {
        label:   'What Is Not Covered',
        content: 'Warranty does not cover damage from power surges, improper use, failure to maintain filters, or repairs made by another company after ours. It also does not cover refrigerant added due to a new leak unrelated to our repair.',
        order:   3
      }
    ],
    keywords: [
      'warranty', 'guarantee', 'parts warranty', 'labor warranty', 'how long warranty',
      'what is covered', 'warranty on repair', 'do you warranty your work',
      'warranty period', 'parts and labor warranty', 'warranty covered'
    ],
    wordLimit:     30,
    bookingAction: 'none',
    isActive:      true,
    priority:      50,
    createdAt:     NOW,
    updatedAt:     NOW
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 14. Cancellation & No-Show Policy
  //     ▸ Category: Policies   ▸ Booking: none
  //     ▸ wordLimit: 20   ▸ Priority: 60
  // ──────────────────────────────────────────────────────────────────────────
  {
    companyId:     COMPANY_ID,
    title:         'Cancellation & No-Show Policy',
    category:      'Policies',
    sections: [
      {
        label:   'Cancellation',
        content: 'Cancel or reschedule any time up to 2 hours before your appointment at no charge. Same-day cancellations inside 2 hours incur a $39 cancellation fee.',
        order:   0
      },
      {
        label:   'No-Show Fee',
        content: 'If our tech arrives and no one is home and we were not notified, a $59 no-show fee applies. We will attempt to call and text before leaving.',
        order:   1
      },
      {
        label:   'How to Reschedule',
        content: 'Call us, text us, or use the confirmation link in your appointment email. We will get you rescheduled, usually same week. No penalty for early reschedules.',
        order:   2
      }
    ],
    keywords: [
      'cancel appointment', 'reschedule', 'cancellation fee', 'no-show',
      'cancel my appointment', 'how to cancel', 'change my appointment',
      'cancellation policy', 'do I get charged to cancel', 'reschedule my visit'
    ],
    wordLimit:     20,
    bookingAction: 'none',
    isActive:      true,
    priority:      60,
    createdAt:     NOW,
    updatedAt:     NOW
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 15. Winter Heating Tune-Up Special  ← INACTIVE (expired special)
  //     ▸ Category: Specials   ▸ Booking: offer_to_book
  //     ▸ wordLimit: 20   ▸ Priority: 6   ▸ isActive: FALSE
  //     ▸ Shows the isActive toggle — this special has ended
  //       but the card is preserved for re-activation next winter
  // ──────────────────────────────────────────────────────────────────────────
  {
    companyId:     COMPANY_ID,
    title:         'Winter Heating Tune-Up Special',
    category:      'Specials',
    sections: [
      {
        label:   'The Deal',
        content: 'Winter heating tune-up for $69 — normally $109. Includes full furnace or heat pump inspection, heat exchanger check, burner cleaning, filter replacement, and thermostat calibration. Runs through February 28th.',
        order:   0
      },
      {
        label:   "What's Included",
        content: 'Furnace: heat exchanger inspection (critical safety check), burner and igniter, flue check, blower motor, filter. Heat pump: heating mode test, reversing valve check, defrost cycle, refrigerant level.',
        order:   1
      },
      {
        label:   'Why It Matters',
        content: 'Cracked heat exchangers are a safety issue — carbon monoxide risk. A fall tune-up catches problems before you need heat on the first cold night.',
        order:   2
      }
    ],
    keywords: [
      'winter special', 'heating tune-up', 'furnace tune-up', 'heating deal',
      'heat pump tune-up', 'furnace service', 'heating inspection',
      'furnace check', 'winter heating special', 'heating system tune-up'
    ],
    wordLimit:     20,
    bookingAction: 'offer_to_book',
    isActive:      false,   // ← INACTIVE — expired, kept for next winter
    priority:      6,
    createdAt:     NOW,
    updatedAt:     NOW
  }

];

// ─────────────────────────────────────────────────────────────────────────────
// SEED
// ─────────────────────────────────────────────────────────────────────────────

async function seed() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  console.log('Connected to MongoDB');

  const db   = client.db(DB_NAME);
  const coll = db.collection(COLL);

  // 1. Clear existing containers for Penguin Air (clean slate)
  const del = await coll.deleteMany({ companyId: COMPANY_ID });
  console.log(`Deleted ${del.deletedCount} existing knowledge containers for Penguin Air\n`);

  // 2. Insert all 15 containers
  const result = await coll.insertMany(containers);
  console.log(`Inserted ${result.insertedCount} knowledge containers\n`);

  // 3. Set knowledgeBaseSettings on the company document
  const companyUpdate = await db.collection(COMPANIES).updateOne(
    { _id: COMPANY_OID },
    {
      $set: {
        'knowledgeBaseSettings.enabled':            true,
        'knowledgeBaseSettings.defaultWordLimit':   25,
        'knowledgeBaseSettings.bookingOfferMode':   'groq',
        'knowledgeBaseSettings.bookingOfferPhrase': ''
      }
    }
  );
  console.log(`Company knowledgeBaseSettings updated: ${companyUpdate.modifiedCount === 1 ? '✅' : '⚠️  no match'}\n`);

  // 4. Summary
  console.log('─'.repeat(72));
  console.log(' #  Title                                  Cat          Action      Limit  Active');
  console.log('─'.repeat(72));
  containers.forEach((c, i) => {
    const title  = c.title.padEnd(40).slice(0, 40);
    const cat    = (c.category || '').padEnd(12).slice(0, 12);
    const action = c.bookingAction.padEnd(18).slice(0, 18);
    const limit  = (c.wordLimit != null ? `${c.wordLimit}w` : 'default').padStart(7);
    const active = c.isActive ? '✅' : '⛔ (off)';
    console.log(`${String(i + 1).padStart(2)}  ${title}  ${cat}  ${action}  ${limit}  ${active}`);
  });
  console.log('─'.repeat(72));
  console.log('\nGlobal knowledgeBaseSettings set:');
  console.log('  enabled: true | defaultWordLimit: 25 | bookingOfferMode: groq');
  console.log('\n✅  Seed complete — open services.html to see all containers');

  await client.close();
}

seed().catch(err => {
  console.error('\n❌  Seed failed:', err.message);
  process.exit(1);
});
