#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * PHASE 3: PATCH 10 SCENARIOS (SCENARIO-OPS COMPLIANT)
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Enforcement minimums:
 * - triggers: 8 minimum
 * - negativeUserPhrases: 3 minimum
 * - quickReplies: 7 minimum
 * - fullReplies: 7 minimum
 * 
 * USAGE:
 *   DRY RUN:  node scripts/phase3-patch-10.js --dry-run
 *   APPLY:    node scripts/phase3-patch-10.js --apply
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const mongoose = require('mongoose');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');

const TEMPLATE_ID = '68fb535130d19aec696d8123';

const PHASE3_SCENARIOS = [
    'scenario-1766498033778-2iudas76x',  // AC Unit Frozen / Ice on Coils
    'scenario-1766497680972-v9rvh6njr',  // AC Making Strange Noises
    'scenario-1766498034291-alyxjy73h',  // Strange Smell From HVAC
    'scenario-1766497677224-e7k62af07',  // Seasonal Tune-Up Request
    'scenario-1766497677958-4lt5m8u5q',  // Membership Plan Inquiry
    'scenario-1766497682544-ab1o1rzij',  // New AC/Heating System Quote
    'scenario-1766497682887-xjwr5ysnm',  // System Age / When to Replace
    'scenario-1766497678466-4d5o8dmxz',  // Duct Cleaning Request
    'scenario-1766497679176-agw83hkrp',  // Duct Repair or Replacement
    'scenario-1766497683278-lgpzyjjw1',  // Indoor Air Quality Concerns
];

const MINIMUMS = {
    triggers: 8,
    negativeUserPhrases: 3,
    quickReplies: 7,
    fullReplies: 7
};

// ═══════════════════════════════════════════════════════════════════════════════
// GOLD STANDARD CONTENT
// ═══════════════════════════════════════════════════════════════════════════════

const GOLD_STANDARD_ADDITIONS = {
    // 1. AC Unit Frozen / Ice on Coils - EMERGENCY
    'scenario-1766498033778-2iudas76x': {
        triggers: [], // Already has 10
        negativeUserPhrases: [
            'ice maker not working',
            'refrigerator freezing up',
            'freezer problem'
        ],
        quickReplies: [
            "A frozen AC needs to be turned off to thaw safely. Let's get a tech out to find the cause.",
            "Ice on your coils usually means airflow or refrigerant issues. Don't chip at the ice — we'll handle it."
        ],
        fullReplies: [
            "I'm sorry you're dealing with a frozen system — that's frustrating. Here's what I need you to do first: turn your AC completely off at the thermostat, but leave the fan set to ON. This will help the ice melt safely without causing water damage. Don't try to chip or scrape the ice off — that can damage the coils. Once it's thawed, we need a technician to figure out why it froze. It's usually a dirty filter, low refrigerant, or airflow problem. Can I schedule someone to come out?",
            "A frozen AC is definitely something to address, but safely. Step one: turn off the cooling at your thermostat right now to let it thaw. You can leave the fan running to speed up the process. Do NOT try to remove the ice yourself — you could puncture the coils. The most common causes are restricted airflow from a dirty filter or low refrigerant from a leak. Either way, you'll need a pro to diagnose it. Let's get a technician scheduled. What works for you?",
            "Ice on your AC coils means something is preventing proper heat exchange. First, shut the system off so it can thaw — this usually takes a few hours. Check your air filter while you wait; if it's clogged, that's often the culprit. But even if the filter looks fine, you'll want a technician to check refrigerant levels and airflow. Running a frozen system can damage the compressor, which is expensive. I can have someone out today or tomorrow. Which do you prefer?",
            "When an AC freezes up, it's telling you something is wrong. Turn it off right away — running it frozen can cause serious damage. Let the ice melt naturally; don't use tools or hot water to speed it up. While it thaws, check if your filter is dirty and replace it if so. But the freeze could also be from low refrigerant, a failing blower motor, or blocked return vents. Our technician will diagnose the root cause so this doesn't keep happening. Want me to get you on the schedule?"
        ]
    },

    // 2. AC Making Strange Noises - TROUBLESHOOT
    'scenario-1766497680972-v9rvh6njr': {
        triggers: [], // Already has 12
        negativeUserPhrases: [
            'noise from outside not ac',
            'neighbor making noise',
            'normal startup sound'
        ],
        quickReplies: [
            "Strange noises usually mean something's loose or failing. Can you describe the sound — grinding, squealing, banging?",
            "If it's a loud grinding or banging, turn it off to prevent damage. We can diagnose it today."
        ],
        fullReplies: [
            "Strange noises from your HVAC are definitely worth investigating. Can you describe what you're hearing? A squealing sound often means a belt or motor bearing issue. Grinding usually points to motor problems. Banging or clanking could be a loose or broken part. Rattling might just be a loose panel. If the noise is loud or sounds like metal-on-metal, I'd recommend turning the system off to prevent further damage until a technician can look at it. What kind of sound is it making?",
            "I understand — unusual sounds are concerning. Here's a quick guide: high-pitched squealing is often a belt or blower motor issue. Grinding or scraping sounds mean something is rubbing that shouldn't be — shut it off if you hear this. Clicking at startup is usually normal, but constant clicking isn't. Banging could be a loose or broken component in the blower. If the noise is severe, it's safest to turn the system off. Either way, let's get a tech out to diagnose it. What does the noise sound like?",
            "Noises from your AC shouldn't be ignored — they're usually an early warning sign. Tell me more about the sound. Is it a whine or squeal? That's often the blower motor or belt. Is it a grinding or scraping? That could mean the motor bearings are failing, and you should turn it off to avoid bigger damage. Banging or rattling might be a loose part or something stuck in the blower. Once I know what you're hearing, I can tell you if it's urgent or can wait a day or two. What's it sound like?",
            "You're smart to call about this — catching noise issues early can save you from expensive repairs. Different sounds mean different things: squealing is usually belt or motor related, buzzing might be electrical, grinding is often a motor going bad, and banging could be a broken part bouncing around. If it's grinding or banging, I'd turn it off until we can look at it. Our technicians can diagnose the sound and fix whatever's causing it. Would you like to schedule a service call?"
        ]
    },

    // 3. Strange Smell From HVAC - EMERGENCY
    'scenario-1766498034291-alyxjy73h': {
        triggers: [], // Already has 11
        negativeUserPhrases: [
            'smell from kitchen cooking',
            'bathroom odor',
            'new furniture smell'
        ],
        quickReplies: [
            "What kind of smell — burning, musty, or rotten egg? Burning means turn it off immediately.",
            "A burning smell from your HVAC is urgent — shut it off and we'll come diagnose it right away."
        ],
        fullReplies: [
            "Strange smells from your HVAC need attention, and the type of smell tells us a lot. Burning or electrical smell: turn your system off immediately at the thermostat AND the breaker — this could be a serious safety issue. Musty or moldy smell: usually means moisture in your ducts or a dirty evaporator coil — not an emergency but should be addressed. Rotten egg smell: if it smells like gas, leave your home and call the gas company immediately. Which of these sounds like what you're experiencing?",
            "The smell you're noticing is important — can you describe it? If it smells like something is burning or like hot electrical wires, shut the system off right now and don't turn it back on until we've inspected it. That could be an overheating motor or electrical issue. If it's more of a musty, moldy smell, that's usually biological growth in your ducts or on your coils — not dangerous immediately but definitely needs cleaning. If it smells like rotten eggs, that could be a gas leak — leave the house and call your gas company. What does it smell like?",
            "Smells from your HVAC can range from minor annoyances to serious hazards. Here's the breakdown: Burning smell = turn off immediately, could be electrical or a failing motor. Musty smell = probably mold or mildew in the system, needs duct cleaning or coil cleaning. Chemical smell = could be a refrigerant leak, which needs professional repair. Rotten egg = natural gas, evacuate and call 911 or your gas company. Which of these matches what you're smelling? We'll know how urgently to respond.",
            "I want to make sure you're safe, so let me ask: what does the smell remind you of? If it's burning, smoky, or smells like hot electronics, please turn your system off at the breaker right now — that's a fire risk. If it's musty or stale, that's typically mold or mildew in your ducts and needs cleaning. If it's a sweet chemical smell, you might have a refrigerant leak. And if it smells like rotten eggs or sulfur, treat it as a potential gas leak — leave the house immediately. What are you smelling?"
        ]
    },

    // 4. Seasonal Tune-Up Request - BOOKING
    'scenario-1766497677224-e7k62af07': {
        triggers: [], // Already has 15
        negativeUserPhrases: [
            'system is broken need repair',
            'ac not working at all',
            'emergency service needed'
        ],
        quickReplies: [
            "Great idea! A seasonal tune-up keeps your system efficient and prevents breakdowns. Let's get you scheduled.",
            "Perfect timing — tune-ups before the season rush help avoid problems when you need your system most."
        ],
        fullReplies: [
            "You're being proactive, and I love that! Seasonal tune-ups are the best way to keep your system running efficiently and catch small problems before they become expensive repairs. During the visit, our technician will clean your coils, check refrigerant levels, inspect electrical connections, test the thermostat, and make sure everything is running at peak performance. Most manufacturers actually require annual maintenance to keep your warranty valid. What day works best for you?",
            "That's a smart move! Regular maintenance is the key to a long-lasting, efficient HVAC system. A tune-up includes cleaning components that get dirty over time, checking that all the electrical connections are safe, verifying refrigerant levels, testing your thermostat's accuracy, and inspecting for any wear and tear. It's like an annual physical for your system. We recommend twice a year — before summer and before winter. Would you like to schedule one now?",
            "Excellent! Preventive maintenance is the best investment you can make in your HVAC system. Our tune-up covers a comprehensive checklist: cleaning the indoor and outdoor coils, checking refrigerant, inspecting the blower motor and fan, testing safety controls, and verifying efficient operation. This keeps your energy bills down and helps prevent those inconvenient mid-summer breakdowns. We have appointments available this week. What works for your schedule?",
            "You're ahead of the game! A lot of people wait until something breaks, so scheduling maintenance proactively is the way to go. Our seasonal tune-up includes everything your system needs to run smoothly — coil cleaning, electrical inspection, refrigerant check, filter replacement recommendation, and a full performance test. It typically takes about an hour. Plus, if we spot any issues, we'll let you know before they become emergencies. Ready to book?"
        ]
    },

    // 5. Membership Plan Inquiry - FAQ
    'scenario-1766497677958-4lt5m8u5q': {
        triggers: [], // Already has 12
        negativeUserPhrases: [
            'cancel my membership',
            'want to quit the plan',
            'stop billing me'
        ],
        quickReplies: [
            "Our membership includes annual tune-ups, priority scheduling, and discounts on repairs. Want me to explain the options?",
            "Great question! Members save money on maintenance and get priority service during peak season."
        ],
        fullReplies: [
            "I'm happy to tell you about our membership plans! The biggest benefits are: annual tune-ups included at no extra charge, priority scheduling so you skip the line during summer and winter rushes, discounts on any repairs you need, and no overtime charges for emergency calls. A lot of our members tell us the peace of mind alone is worth it — knowing their system is maintained and they're covered if something goes wrong. Would you like me to go over the specific plan options?",
            "Our membership plans are designed to save you money and hassle. Here's what's included: one or two tune-ups per year depending on the plan, priority scheduling for service calls, typically 15-20% off parts and labor for any repairs, and waived diagnostic fees. The tune-ups alone usually pay for the membership cost, and the discounts are a bonus. Plus, you'll never be stuck waiting in a long queue during the hottest or coldest days. Want me to explain the different tiers?",
            "Great question! Our membership is all about taking care of your system and giving you priority treatment. Members get their annual maintenance visits included, so you never have to remember to schedule — we'll call you. You also get moved to the front of the line for service calls, which really matters when it's 100 degrees outside. And you'll save money on any repairs with your member discount. Most members save more than the cost of the plan within the first year. Interested?",
            "Our maintenance plans are one of the best values we offer. Here's the breakdown: you get your seasonal tune-ups included, which keeps your system running efficiently and your warranty valid. You get priority scheduling, meaning you're not waiting days for service during peak season. And you get a discount on any repairs — parts and labor. Some plans also include no emergency fees for after-hours calls. It's really about convenience and savings. Would you like to hear about pricing?"
        ]
    },

    // 6. New AC/Heating System Quote - FAQ
    'scenario-1766497682544-ab1o1rzij': {
        triggers: [], // Already has 12
        negativeUserPhrases: [
            'just need a repair',
            'dont want to replace',
            'fix my current system'
        ],
        quickReplies: [
            "We'd be happy to provide a free estimate! I'll have someone come out to assess your home and needs.",
            "Great — a new system quote requires a home visit to size it correctly. When's a good time?"
        ],
        fullReplies: [
            "Absolutely — we provide free, no-obligation estimates for new systems! Here's how it works: one of our comfort advisors will come to your home to assess your current setup, measure your space, and discuss your comfort goals and budget. They'll then recommend options that fit your needs — we're not about overselling. The visit typically takes about an hour. There's no pressure, and you'll get a detailed written quote to review. Would you like to schedule that assessment?",
            "I'd be happy to set that up for you! Getting an accurate quote for a new system requires a home visit — we need to see your current ductwork, measure your square footage, check insulation, and understand your comfort needs. Our comfort advisor will walk you through all your options, from budget-friendly to top-of-the-line, and you'll get a written quote with no pressure to decide on the spot. Financing options are available too. What day works for the assessment?",
            "Great question! For new system quotes, we send a comfort advisor to your home for a free assessment. They'll evaluate your current system, check your home's specifications, and ask about any comfort issues you're experiencing. Then they'll present options that make sense for your situation — not just the most expensive one. You'll leave with a detailed quote and information about any rebates or financing available. No obligation, no pressure. Want me to schedule that visit?",
            "We'd love to help you explore your options! A new system is a significant investment, so we make sure to do it right. Our comfort advisor will visit your home, look at your existing setup, take measurements, and discuss what you're looking for — efficiency, quiet operation, budget, whatever matters to you. Then they'll put together a custom quote with a few options at different price points. The assessment is free and there's zero pressure. Ready to set up an appointment?"
        ]
    },

    // 7. System Age / When to Replace - FAQ
    'scenario-1766497682887-xjwr5ysnm': {
        triggers: [], // Already has 8
        negativeUserPhrases: [
            'brand new system',
            'just installed last year',
            'system is only 2 years old'
        ],
        quickReplies: [
            "Most AC systems last 15-20 years, but efficiency drops after 10-12. What's yours doing that concerns you?",
            "Age matters, but so does repair frequency. If repairs are adding up, replacement might make more sense."
        ],
        fullReplies: [
            "Great question! Most air conditioning systems last 15-20 years, and furnaces can go 20-25 years with good maintenance. However, efficiency starts declining noticeably after about 10-12 years. So it's not just about whether it runs — it's about how much it costs to run and repair. If your system is over 10 years old and you're facing a major repair, it often makes financial sense to put that money toward a new, efficient system instead. How old is your current system, and what's it doing?",
            "System age is a factor, but it's not the only one. Generally, AC units last 15-20 years. But here's the thing: if you're repairing a 12-year-old system every year, those repair costs add up. A good rule of thumb is the '5,000 rule' — multiply the age by the repair cost. If it's over $5,000, consider replacing. Also, newer systems are significantly more efficient, which means lower utility bills. What's going on with your system that has you asking about replacement?",
            "That's a smart thing to think about. Typically, air conditioners last 15-20 years, heat pumps 10-15 years, and furnaces 20-25 years. But age alone doesn't tell the whole story. A well-maintained 15-year-old system might have life left, while a neglected 10-year-old might be on its last legs. What usually tips the scales toward replacement is frequent repairs, rising energy bills, or inconsistent comfort. Is your system giving you trouble, or are you just planning ahead?",
            "Here's how I think about it: most systems are designed to last 15-20 years, but realistically, after 10-12 years, you're operating on borrowed time. The technology has improved so much that a new system can be 30-50% more efficient than one from 2010. So if you're facing a $1,500+ repair on an older system, that money might be better spent toward a new unit that will save you monthly on utilities. What's happening with your system right now?"
        ]
    },

    // 8. Duct Cleaning Request - FAQ
    'scenario-1766497678466-4d5o8dmxz': {
        triggers: [], // Already has 10
        negativeUserPhrases: [
            'duct repair not cleaning',
            'ducts are damaged',
            'need new ductwork installed'
        ],
        quickReplies: [
            "Duct cleaning can improve air quality and system efficiency. We'd need to assess your ducts first.",
            "We offer duct cleaning! An assessment helps us give you an accurate quote based on your system size."
        ],
        fullReplies: [
            "Duct cleaning is a great service, especially if you've noticed more dust than usual, musty smells, or if it's been several years since your last cleaning. Our process involves a thorough inspection first to assess the condition of your ducts and identify any areas of concern. Then we use professional equipment to remove dust, debris, and any buildup throughout your duct system. This can improve your indoor air quality and help your system run more efficiently. Want me to schedule an assessment?",
            "We do offer duct cleaning! Here's how we approach it: we start with an inspection using a camera to see what's actually in your ducts. This helps us give you an honest assessment — sometimes people need cleaning, sometimes they don't. If cleaning is recommended, we'll use professional-grade equipment to thoroughly clean your entire duct system, including the main trunk lines and individual branches. The result is cleaner air and often better airflow. Interested in scheduling the assessment?",
            "Great question about duct cleaning! It's beneficial if you have visible dust or debris in your vents, if you've had recent construction or renovation, if you have pets or allergy sufferers in the home, or if it's simply been 5+ years. We always start with an inspection so we can show you what we're seeing and give you an accurate quote. We don't believe in scaring people into services they don't need. Would you like to set up that inspection?",
            "Duct cleaning can definitely make a difference in air quality and system performance. Our service includes a pre-inspection to assess your ducts, professional cleaning using high-powered vacuum and agitation tools, and sanitizing if needed. We clean the supply ducts, return ducts, and the main trunk lines. It typically takes a few hours depending on the size of your home. Should I schedule an assessment to see what your ducts look like and give you a quote?"
        ]
    },

    // 9. Duct Repair or Replacement - TROUBLESHOOT
    'scenario-1766497679176-agw83hkrp': {
        triggers: [], // Already has 11
        negativeUserPhrases: [
            'just want duct cleaning',
            'ducts are fine just dirty',
            'ac unit problem not ducts'
        ],
        quickReplies: [
            "Duct problems can cause uneven temperatures and high bills. We'd need to inspect to give you options.",
            "Damaged or leaky ducts waste a lot of energy. An inspection will show us what's needed."
        ],
        fullReplies: [
            "Duct repair or replacement is something we definitely handle. Signs you might need it include rooms that are always too hot or cold, visible damage or disconnected ducts in your attic or crawl space, excessive dust, or energy bills that seem too high. Our technician can inspect your ductwork, test for leaks, and let you know what's actually needed — sometimes it's a simple seal, sometimes sections need replacement, and occasionally a full redo makes sense. Want me to schedule a duct inspection?",
            "Ducts are often the forgotten part of HVAC systems, but they're critical for comfort and efficiency. If your ducts are damaged, disconnected, or poorly designed, you could be losing 20-30% of your conditioned air before it ever reaches your rooms. We offer duct inspections where we assess the condition, test for leaks, and check the layout. Then we can recommend repair, partial replacement, or redesign depending on what we find. Want to start with an inspection?",
            "Good thinking — ductwork problems are more common than people realize. If you're experiencing uneven temperatures, weak airflow to certain rooms, or energy bills that seem higher than they should be, your ducts might be the culprit. Our inspection process checks for leaks, disconnections, poor insulation, and design issues. From there, we can recommend sealing, repairs, or replacement based on what we actually find. No guessing. Would you like to set that up?",
            "Duct issues can really affect your comfort and efficiency. Here's what we look for: holes or tears in the ductwork, disconnected sections, poor insulation that causes temperature loss, and design problems that restrict airflow. Depending on what we find, solutions range from simple sealing to section replacement to complete duct redesign. We always start with an honest assessment so you know exactly what you're dealing with. Should I schedule a duct inspection for you?"
        ]
    },

    // 10. Indoor Air Quality Concerns - FAQ
    'scenario-1766497683278-lgpzyjjw1': {
        triggers: [], // Already has 12
        negativeUserPhrases: [
            'outdoor air quality',
            'car exhaust outside',
            'neighbor burning something'
        ],
        quickReplies: [
            "Indoor air quality is important! There are several solutions depending on your concerns — filters, UV lights, humidity control.",
            "We can definitely help with air quality. What symptoms are you noticing — allergies, dust, odors, humidity?"
        ],
        fullReplies: [
            "Indoor air quality is something we take seriously! There are several solutions depending on what you're experiencing. For allergies and dust, better filtration like HEPA filters or media filters can make a big difference. For odors and germs, UV lights installed in your system can help. For dry air or humidity problems, whole-home humidifiers or dehumidifiers are the answer. Can you tell me more about what you're noticing? Allergies? Excessive dust? Stuffy air? That'll help me point you to the right solution.",
            "Great question — indoor air quality affects comfort and health. Let me ask: what specifically are you concerned about? If it's allergies or asthma, we can upgrade your filtration system. If it's odors or you're worried about germs, UV lights installed in your ductwork can help neutralize airborne contaminants. If your air feels too dry or too humid, we have whole-home solutions for that too. Each situation is different, so tell me what you're experiencing and I'll recommend the best options.",
            "We offer several indoor air quality solutions! The right one depends on your specific concerns. High-efficiency filters and air purifiers are great for reducing allergens, dust, and particles. UV germicidal lights can reduce mold, bacteria, and viruses in your system. Humidifiers add moisture in dry winters, and dehumidifiers remove excess moisture in humid summers. Some people also benefit from ventilation systems that bring in fresh air. What issues are you experiencing at home?",
            "Indoor air quality is definitely something we can help improve. Here's what we typically recommend based on common concerns: For dust and allergies, upgraded filtration is usually the first step — there are different levels depending on your needs. For musty or stale air, a combination of UV lights and fresh air ventilation works well. For humidity problems, whole-home humidifiers or dehumidifiers can be added to your system. What's prompting your question — are you noticing symptoms or just want to improve your home's air?"
        ]
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN EXECUTION
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
    const args = process.argv.slice(2);
    const isDryRun = args.includes('--dry-run');
    const isApply = args.includes('--apply');

    if (!isDryRun && !isApply) {
        console.log('Usage:');
        console.log('  node scripts/phase3-patch-10.js --dry-run   Preview changes');
        console.log('  node scripts/phase3-patch-10.js --apply     Apply changes');
        process.exit(1);
    }

    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log(isDryRun ? '🔍 PHASE 3: DRY RUN - 10 SCENARIOS' : '🚀 PHASE 3: APPLYING - 10 SCENARIOS');
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log(`Template ID: ${TEMPLATE_ID}`);
    console.log(`Scenarios to update: ${PHASE3_SCENARIOS.length}`);
    console.log('');

    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        console.error('❌ MONGODB_URI environment variable not set');
        process.exit(1);
    }

    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    try {
        const template = await GlobalInstantResponseTemplate.findById(TEMPLATE_ID);
        if (!template) {
            console.error(`❌ Template ${TEMPLATE_ID} not found`);
            process.exit(1);
        }

        console.log(`✅ Loaded template: ${template.name}`);
        console.log('');

        const report = [];
        let opsCount = 0;

        for (const scenarioId of PHASE3_SCENARIOS) {
            let currentScenario = null;
            let categoryName = null;
            let categoryIndex = -1;
            let scenarioIndex = -1;

            for (let ci = 0; ci < template.categories.length; ci++) {
                const cat = template.categories[ci];
                for (let si = 0; si < (cat.scenarios || []).length; si++) {
                    if (cat.scenarios[si].scenarioId === scenarioId) {
                        currentScenario = cat.scenarios[si];
                        categoryName = cat.name;
                        categoryIndex = ci;
                        scenarioIndex = si;
                        break;
                    }
                }
                if (currentScenario) break;
            }

            if (!currentScenario) {
                console.warn(`⚠️  Scenario ${scenarioId} not found - skipping`);
                continue;
            }

            const additions = GOLD_STANDARD_ADDITIONS[scenarioId];
            if (!additions) {
                console.warn(`⚠️  No Gold Standard content for ${scenarioId} - skipping`);
                continue;
            }

            const before = {
                triggers: currentScenario.triggers?.length || 0,
                negatives: currentScenario.negativeUserPhrases?.length || 0,
                quickReplies: currentScenario.quickReplies?.length || 0,
                fullReplies: currentScenario.fullReplies?.length || 0
            };

            // Check if already meets minimums
            const alreadyMeets = 
                before.triggers >= MINIMUMS.triggers &&
                before.negatives >= MINIMUMS.negativeUserPhrases &&
                before.quickReplies >= MINIMUMS.quickReplies &&
                before.fullReplies >= MINIMUMS.fullReplies;

            if (alreadyMeets) {
                report.push({
                    name: currentScenario.name,
                    category: categoryName,
                    status: 'SKIP',
                    reason: 'Already meets minimums',
                    before,
                    after: before
                });
                continue;
            }

            // Merge arrays (dedupe)
            const newTriggers = [...new Set([
                ...(currentScenario.triggers || []),
                ...(additions.triggers || [])
            ])];
            const newNegatives = [...new Set([
                ...(currentScenario.negativeUserPhrases || []),
                ...(additions.negativeUserPhrases || [])
            ])];
            const newQuickReplies = [...new Set([
                ...(currentScenario.quickReplies || []),
                ...(additions.quickReplies || [])
            ])];
            const newFullReplies = [...new Set([
                ...(currentScenario.fullReplies || []),
                ...(additions.fullReplies || [])
            ])];

            const after = {
                triggers: newTriggers.length,
                negatives: newNegatives.length,
                quickReplies: newQuickReplies.length,
                fullReplies: newFullReplies.length
            };

            const hasChanges = 
                after.triggers !== before.triggers ||
                after.negatives !== before.negatives ||
                after.quickReplies !== before.quickReplies ||
                after.fullReplies !== before.fullReplies;

            if (!hasChanges) {
                report.push({
                    name: currentScenario.name,
                    category: categoryName,
                    status: 'SKIP',
                    reason: 'No new content to add',
                    before,
                    after
                });
                continue;
            }

            opsCount++;

            if (isApply) {
                template.categories[categoryIndex].scenarios[scenarioIndex].triggers = newTriggers;
                template.categories[categoryIndex].scenarios[scenarioIndex].negativeUserPhrases = newNegatives;
                template.categories[categoryIndex].scenarios[scenarioIndex].quickReplies = newQuickReplies;
                template.categories[categoryIndex].scenarios[scenarioIndex].fullReplies = newFullReplies;
                template.categories[categoryIndex].scenarios[scenarioIndex].updatedAt = new Date();
            }

            report.push({
                name: currentScenario.name,
                category: categoryName,
                status: isApply ? 'APPLIED' : 'WILL_UPDATE',
                before,
                after
            });
        }

        // Save if applying
        if (isApply && opsCount > 0) {
            template.updatedAt = new Date();
            await template.save();
            console.log('✅ Template saved');
        }

        // Print report
        console.log('\n📋 PATCH REPORT');
        console.log('─────────────────────────────────────────────────────────────────────────────');

        for (const item of report) {
            console.log(`\n📝 ${item.name}`);
            console.log(`   Category: ${item.category}`);
            console.log(`   Status: ${item.status}${item.reason ? ` (${item.reason})` : ''}`);
            if (item.status !== 'SKIP' || item.reason !== 'Already meets minimums') {
                console.log(`   Changes:`);
                console.log(`   • triggers: ${item.before.triggers} → ${item.after.triggers}`);
                console.log(`   • negatives: ${item.before.negatives} → ${item.after.negatives}`);
                console.log(`   • quickReplies: ${item.before.quickReplies} → ${item.after.quickReplies}`);
                console.log(`   • fullReplies: ${item.before.fullReplies} → ${item.after.fullReplies}`);
            }
        }

        console.log(`\nTotal operations: ${opsCount}`);
        console.log('');

        if (isDryRun) {
            console.log('🔍 DRY RUN - No changes written\n');
            console.log('To apply these changes, run:');
            console.log('  node scripts/phase3-patch-10.js --apply');
        } else {
            console.log('✅ APPLIED - Changes written to database\n');
            console.log('To verify, run:');
            console.log('  node scripts/phase3-patch-10.js --dry-run');
            console.log('  (Should show 0 operations)');
        }

    } finally {
        await mongoose.disconnect();
        console.log('✅ Disconnected from MongoDB');
    }
}

main().catch(err => {
    console.error('❌ Script failed:', err);
    process.exit(1);
});

