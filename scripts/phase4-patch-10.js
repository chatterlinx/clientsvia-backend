#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * PHASE 4: PATCH 10 SCENARIOS (SCENARIO-OPS COMPLIANT)
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Enforcement minimums:
 * - triggers: 8 minimum
 * - negativeUserPhrases: 3 minimum
 * - quickReplies: 7 minimum
 * - fullReplies: 7 minimum
 * 
 * USAGE:
 *   DRY RUN:  node scripts/phase4-patch-10.js --dry-run
 *   APPLY:    node scripts/phase4-patch-10.js --apply
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const mongoose = require('mongoose');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');

const TEMPLATE_ID = '68fb535130d19aec696d8123';

const PHASE4_SCENARIOS = [
    'scenario-1766498035295-edupa8vgg',  // Commercial HVAC Service Call
    'scenario-1766497683784-wh6o3ub2w',  // New Commercial HVAC System
    'scenario-1766497682036-0b609hdzj',  // One Room Too Hot or Cold
    'scenario-1766497684196-p1ck6o2w3',  // AC Not Starting - Possible Capacitor
    'scenario-1766497684697-8w6qie0eo',  // AC Low on Refrigerant
    'scenario-1766497685515-2uvzbbtun',  // Service Pricing Inquiry
    'scenario-1766497685923-v59byvghp',  // Appointment Availability
    'scenario-1766498030663-00obwhi86',  // After Hours Emergency Service
    'scenario-1766498031162-ed2ql0pw7',  // No Heat Emergency
    'scenario-1766498031630-yuhw8xc2p',  // No AC Emergency - Extreme Heat
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
    // 1. Commercial HVAC Service Call - TROUBLESHOOT
    'scenario-1766498035295-edupa8vgg': {
        triggers: [],
        negativeUserPhrases: [
            'residential home service',
            'my house not business',
            'personal home ac'
        ],
        quickReplies: [
            "We handle commercial HVAC! Let me get some details about your business and the issue.",
            "Commercial service is one of our specialties. What's the nature of the problem?"
        ],
        fullReplies: [
            "We absolutely service commercial properties! Commercial HVAC systems have different needs than residential, and our technicians are trained for both. To get started, I'll need some information: What type of business or building is this? What's the square footage roughly? And what issue are you experiencing — no cooling, no heating, strange noises, or something else? This helps us send the right technician with the right equipment.",
            "Yes, we provide commercial HVAC services! Whether it's an office, retail space, restaurant, or warehouse, we've got you covered. Commercial systems require specialized knowledge, and our team has that expertise. Can you tell me about the building and what's going on with the system? Also, is this affecting your business operations right now, or is it something we can schedule for a convenient time?",
            "Commercial HVAC is definitely something we handle. These systems are more complex than residential, so I want to make sure we send the right team. A few questions: What type of commercial space is this? Is it a rooftop unit, split system, or something else? And what symptoms are you seeing — temperature issues, strange sounds, or the system not running at all? We can often dispatch same-day for commercial emergencies.",
            "We'd be happy to help with your commercial HVAC needs! Our technicians work on everything from small office units to large commercial systems. To get you scheduled properly, I need to know: What kind of business is this? What type of system do you have — rooftop, split, VRF? And what's the issue you're experiencing? If it's affecting your customers or employees, we'll prioritize getting someone out quickly."
        ]
    },

    // 2. New Commercial HVAC System - FAQ
    'scenario-1766497683784-wh6o3ub2w': {
        triggers: [],
        negativeUserPhrases: [
            'home ac replacement',
            'residential system quote',
            'house not business'
        ],
        quickReplies: [
            "Commercial system installs require a site assessment. I can schedule our commercial team to evaluate your space.",
            "New commercial HVAC is a big decision. We'll need to assess your building to recommend the right system."
        ],
        fullReplies: [
            "A new commercial HVAC system is a significant investment, and we want to make sure you get the right one for your space. The first step is a site assessment where our commercial team evaluates your building — square footage, ceiling height, occupancy, existing ductwork, and energy requirements. From there, we can recommend systems that fit your needs and budget, whether that's rooftop units, split systems, or VRF technology. Would you like to schedule that assessment?",
            "We handle commercial HVAC installations! The process starts with understanding your building and needs. Commercial systems are sized differently than residential — we look at building load, occupancy patterns, ventilation requirements, and more. Our commercial specialist will visit your site, take measurements, and discuss your goals. Then we provide options with different efficiency levels and price points. No pressure, just information to help you decide. Ready to set up that site visit?",
            "New commercial systems are what we do! Unlike residential, commercial installations require careful engineering to ensure proper comfort and efficiency for your space. We'll need to do a load calculation based on your building's specifics — size, insulation, windows, occupancy, and use type. Our team will also look at your electrical infrastructure and ductwork. After the assessment, you'll get a detailed proposal with options. Want me to schedule our commercial team to come out?",
            "Absolutely — we install commercial HVAC systems of all sizes. The key to a good commercial installation is proper sizing and design. Too small and it won't keep up; too large and you waste energy and money. Our process starts with a comprehensive site survey where we assess everything that affects your heating and cooling needs. Then we design a system that fits your building and budget. The assessment is free — would you like to get on the schedule?"
        ]
    },

    // 3. One Room Too Hot or Cold - TROUBLESHOOT
    'scenario-1766497682036-0b609hdzj': {
        triggers: [],
        negativeUserPhrases: [
            'whole house uncomfortable',
            'no rooms are comfortable',
            'entire home too hot'
        ],
        quickReplies: [
            "Hot or cold spots usually mean airflow issues. Let's figure out which room and get it balanced.",
            "One room being different is common — could be ducts, vents, or insulation. We can diagnose it."
        ],
        fullReplies: [
            "Having one room that's always too hot or cold is frustrating, but it's usually fixable. Common causes include: closed or blocked vents, duct leaks or disconnections, inadequate insulation in that area, or the room being at the end of a long duct run. Sometimes it's as simple as adjusting dampers; other times the ductwork needs modification. Can you tell me which room it is and whether it's consistently the problem or only at certain times? That helps us narrow down the cause.",
            "Temperature differences between rooms are one of the most common comfort complaints, and there are several possible causes. First, check that the vents in that room are fully open and not blocked by furniture. If that's fine, the issue could be duct leaks, poor insulation, sun exposure, or the room being far from the system. In some cases, adding a damper or even a mini-split for that zone is the best solution. Would you like a technician to diagnose the specific cause?",
            "I hear this a lot — one room that just won't cooperate. The good news is there's usually a reason and a fix. Start by checking: Are the vents open? Is the filter clean? Is there anything blocking airflow to that room? If those look fine, it could be undersized ducts to that room, air leaks in the duct system, or that room having different thermal characteristics (more windows, poor insulation, above a garage). Our techs can do an airflow assessment and recommend the right solution. Want me to schedule that?",
            "One room being uncomfortable while the rest of the house is fine points to an airflow or insulation issue. Questions that help diagnose it: Is it always the same room? Is it worse in summer, winter, or both? Is the room at the end of a long hallway or above a garage? Does it have more windows than other rooms? Your answers help us figure out if it's a duct problem, insulation issue, or something else. I can have a technician come out and pinpoint the cause. Would that help?"
        ]
    },

    // 4. AC Not Starting - Possible Capacitor - TROUBLESHOOT
    'scenario-1766497684196-p1ck6o2w3': {
        triggers: [],
        negativeUserPhrases: [
            'ac running fine',
            'system starts no problem',
            'already replaced capacitor'
        ],
        quickReplies: [
            "If your AC won't start, it could be the capacitor, breaker, or thermostat. Don't touch the capacitor — they hold dangerous charge.",
            "A failed capacitor is common. We can usually diagnose and replace it same-day."
        ],
        fullReplies: [
            "When an AC won't start, the capacitor is definitely one of the most common culprits, especially in hot weather. Capacitors store electrical charge to help motors start, and they wear out over time. Signs of a bad capacitor include: the unit hums but doesn't start, the fan spins slowly, or you hear clicking. Important safety note: don't try to test or replace a capacitor yourself — they hold a dangerous electrical charge even when the power is off. Our technicians can diagnose and replace it safely, usually in under an hour. Want me to schedule a service call?",
            "A capacitor issue is very possible if your AC isn't starting. These components work hard, especially during peak summer, and eventually fail. You might notice humming sounds when it tries to start, or the outdoor unit just sits there doing nothing. Before we assume it's the capacitor, though, there are other possibilities: tripped breaker, faulty thermostat, or a safety switch that's been triggered. Our technicians will diagnose the actual cause. Never try to access the capacitor yourself — it's dangerous. Should I get someone out there?",
            "If your AC won't start and you're thinking capacitor, you might be right — it's one of the most common failures we see. Capacitors help the compressor and fan motors start, and when they go bad, the system can't get going. Other symptoms include the fan running slowly or the unit making a humming or clicking noise. That said, it could also be a contactor, breaker, or wiring issue. Please don't open the unit to check — capacitors are dangerous. Let our technician diagnose it safely. Want me to schedule a visit?",
            "You're thinking like a technician — capacitors are indeed a common reason for an AC not starting. They degrade over time, especially with heavy use. When they fail, the motor can't start, and you might hear humming or see the unit struggling. However, I want to make sure we diagnose correctly before assuming. It could also be a contactor, a blown fuse in the disconnect, or even low refrigerant causing safety lockout. Our tech will test everything and give you an honest answer. Can I schedule that?"
        ]
    },

    // 5. AC Low on Refrigerant - BILLING
    'scenario-1766497684697-8w6qie0eo': {
        triggers: [],
        negativeUserPhrases: [
            'refrigerant is full',
            'just had freon added',
            'system doesnt use refrigerant'
        ],
        quickReplies: [
            "If your AC is low on refrigerant, there's a leak somewhere. Adding more without fixing the leak is just temporary.",
            "Low refrigerant means a leak — we'll find it and discuss repair vs. recharge options with you."
        ],
        fullReplies: [
            "If someone told you your system is low on refrigerant, here's what you need to know: AC systems are sealed, so if you're low, there's a leak somewhere. Just adding refrigerant without fixing the leak is like filling a tire with a hole — temporary at best. The right approach is to find and repair the leak first, then recharge the system. We can do a leak search to locate the problem. Depending on the leak's location and your system's age, we'll give you options: repair and recharge, or consider replacement if the repair cost doesn't make sense. Want us to take a look?",
            "Low refrigerant is a common issue, but it's important to understand: refrigerant doesn't get 'used up' — if you're low, you have a leak. Adding more without fixing the leak just delays the problem and wastes money. Our technicians can locate the leak using electronic detection or UV dye, then give you options. Small leaks can often be repaired cost-effectively. Larger leaks or leaks in the evaporator coil might make replacement more sensible. We'll give you honest options. Should I schedule a leak diagnosis?",
            "So here's the deal with low refrigerant: your AC system is a closed loop, meaning it shouldn't lose refrigerant over time. If it's low, there's a leak — could be small and slow, or bigger. We need to find that leak before just adding refrigerant, otherwise you'll be back in the same situation soon. Our process is: pressure test, leak search, give you a quote for repair, and if you approve, repair and recharge. We'll also let you know if the repair cost makes sense for your system's age. Want to get started?",
            "Low refrigerant typically means there's a leak in the system that needs to be addressed. I know some companies will just top it off and send you a bill, but that doesn't fix the problem — you'll be low again in months. The right approach is a leak search to find where it's escaping, then a discussion about repair options. Sometimes it's a simple fix; sometimes the leak is in an expensive component like the evaporator coil. We'll give you honest information so you can make a good decision. Ready to schedule the diagnostic?"
        ]
    },

    // 6. Service Pricing Inquiry - FAQ
    'scenario-1766497685515-2uvzbbtun': {
        triggers: [],
        negativeUserPhrases: [
            'already know the price',
            'just schedule dont need price',
            'price doesnt matter'
        ],
        quickReplies: [
            "Pricing depends on the service needed. I can give you general ranges or schedule a diagnostic for an exact quote.",
            "Our diagnostic fee is waived if you proceed with repairs. What type of service are you looking for?"
        ],
        fullReplies: [
            "I'm happy to discuss pricing! For service calls, we charge a diagnostic fee that covers the technician's visit and troubleshooting to identify the problem. If you proceed with the repair, that fee is typically waived or applied to the repair cost. The repair price itself depends on what's wrong — simple fixes like a capacitor are less expensive, while compressor or coil replacements cost more. For maintenance tune-ups, we have set pricing. What type of service are you looking for? I can give you a better estimate.",
            "Great question! Our pricing is straightforward. We have a service call/diagnostic fee, which covers having a technician come out and identify the issue. From there, you get a quote for any needed repairs before any work is done — no surprises. If you approve the repair, we typically credit the diagnostic fee. For maintenance, we have flat-rate pricing. If you're a member, you get discounts on all of this. What specifically were you looking to get done?",
            "I appreciate you asking about pricing upfront! Here's how it works: there's a diagnostic fee for service calls, which gets our technician to your door to figure out the problem. Once diagnosed, you get a clear quote before we do any work. Many repairs have standard pricing; others depend on parts and labor involved. We're always upfront — no hidden fees. For maintenance tune-ups, those are flat rate. Are you dealing with a specific issue, or looking for routine maintenance?",
            "Pricing varies by service, but I can give you an idea. For repair calls, there's a diagnostic fee that covers the visit and troubleshooting. Repair costs beyond that depend on what's needed. Simple things like capacitors or contactors are on the lower end; bigger components like compressors or coils cost more. Maintenance tune-ups are flat rate. We always quote before we work, so you're never surprised. What's going on with your system? I can point you toward what you might need."
        ]
    },

    // 7. Appointment Availability - BOOKING
    'scenario-1766497685923-v59byvghp': {
        triggers: [],
        negativeUserPhrases: [
            'dont want appointment',
            'just checking not scheduling',
            'calling for someone else'
        ],
        quickReplies: [
            "We usually have same-day or next-day availability. What day and time work best for you?",
            "Let me check our schedule. What's your preferred day — today, tomorrow, or later this week?"
        ],
        fullReplies: [
            "We typically have good availability and can often accommodate same-day or next-day appointments, especially for urgent issues. For routine maintenance, we can usually get you in within a few days. What works best for your schedule? I can look for morning or afternoon slots, and we give you a time window so you're not waiting around all day. What day were you thinking?",
            "I'd be happy to get you scheduled! Our availability varies day to day, but we usually have openings within 24-48 hours for repairs, and this week for maintenance. What's your preference — do you need someone out as soon as possible, or is there a specific day that works better for your schedule? I can also note if you prefer morning or afternoon.",
            "Let's get you on the schedule! For emergencies or urgent repairs, we often have same-day availability. For less urgent repairs or maintenance, we can usually get you in within a day or two. What kind of service do you need, and is there a particular day or time that's most convenient? I'll find the best slot for you.",
            "Absolutely, let's find a time that works! How urgent is the issue? If you're without heat or AC, we prioritize those and can often get someone out today. For other repairs or tune-ups, we usually have availability within a couple days. Do you have a preference for morning or afternoon? And any days this week that work better than others?"
        ]
    },

    // 8. After Hours Emergency Service - EMERGENCY
    'scenario-1766498030663-00obwhi86': {
        triggers: [],
        negativeUserPhrases: [
            'can wait until tomorrow',
            'not urgent just calling',
            'regular business hours fine'
        ],
        quickReplies: [
            "We provide 24/7 emergency service. If you're without heat or AC, we can dispatch a technician now.",
            "After-hours emergencies are what we're here for. Tell me what's happening and we'll get help on the way."
        ],
        fullReplies: [
            "We absolutely provide after-hours emergency service — no one should be without heat in winter or AC in summer. If you're dealing with an emergency right now, I can dispatch a technician to you tonight. There is an after-hours fee, but your comfort and safety come first. Tell me what's happening with your system and give me your address so we can get someone on the way.",
            "You've reached the right place! We offer 24/7 emergency HVAC service because we know breakdowns don't wait for business hours. Whether it's no heat on a freezing night or no AC during a heat wave, we'll get a technician to you. There is an after-hours service fee, but we never want you to suffer through the night. What's going on, and what's your location?",
            "We're here for after-hours emergencies, so you called the right number. If your heat or AC is out and you need help tonight, we can send someone. Our emergency technicians are on call 24/7. There's an after-hours rate, but we can discuss that — the important thing is getting your system running. What's the issue you're dealing with?",
            "After-hours emergencies are exactly why we have technicians on call around the clock. No heat in winter? Dangerous for your family and pipes. No AC in extreme heat? That's a health concern too. We'll get someone out to help you. There is an after-hours premium, but I want to make sure you're safe and comfortable tonight. Tell me what's happening and let's get you scheduled."
        ]
    },

    // 9. No Heat Emergency - EMERGENCY
    'scenario-1766498031162-ed2ql0pw7': {
        triggers: [],
        negativeUserPhrases: [
            'heat is working fine',
            'just testing not emergency',
            'ac problem not heat'
        ],
        quickReplies: [
            "No heat is an emergency, especially in cold weather. Let's get a technician to you right away.",
            "We treat no-heat calls as priority. I'm getting your information now to dispatch help."
        ],
        fullReplies: [
            "No heat is absolutely an emergency — it's not just uncomfortable, it's potentially dangerous for your family and your pipes. We're going to prioritize getting a technician to you as quickly as possible. While you wait, if you have space heaters, use them safely away from anything flammable. If temperatures are extreme, consider going to a warm location temporarily. Give me your address and I'll get someone dispatched right now.",
            "I'm treating this as an emergency because no heat in cold weather is serious. Frozen pipes can burst, and prolonged cold exposure is a health risk. We'll get a technician out to you as soon as possible. In the meantime, keep cabinet doors under sinks open to let warm air reach pipes, and if you have portable heaters, use them carefully. What's your address? Let's get you scheduled immediately.",
            "No heat is one of the most urgent calls we take. Your safety and your home are at risk when there's no heat in cold weather. I'm going to get you on the emergency schedule right now. While a technician is on the way, here are some tips: open faucets to a slow drip to prevent freezing, keep interior doors open to circulate any available warmth, and layer up. What's your address?",
            "We take no-heat emergencies very seriously. It's more than discomfort — it's a safety issue for you and your home. Burst pipes from freezing can cause thousands in damage. I'm prioritizing your call. To help while you wait: keep water dripping from faucets, open cabinet doors under sinks, and use space heaters safely if you have them. Let me get your information so we can dispatch a technician right away."
        ]
    },

    // 10. No AC Emergency - Extreme Heat - EMERGENCY
    'scenario-1766498031630-yuhw8xc2p': {
        triggers: [],
        negativeUserPhrases: [
            'ac is working fine',
            'not that hot outside',
            'heat problem not ac'
        ],
        quickReplies: [
            "No AC in extreme heat is dangerous. Let's get a technician out to you as soon as possible.",
            "We prioritize no-AC calls in heat waves. Stay cool — I'm dispatching help now."
        ],
        fullReplies: [
            "No AC during extreme heat is a serious situation, especially for children, elderly family members, or anyone with health conditions. We're going to get you to the front of the line. While you wait for the technician: close blinds to block sun, stay on the lowest level of your home (heat rises), drink plenty of water, and consider going to a cooled public place if the heat becomes dangerous. What's your address? I'm dispatching someone now.",
            "I'm treating this as an emergency. Extreme heat without AC can be dangerous, and we don't want anyone suffering or at risk. Our technicians are prioritizing no-AC calls. While help is on the way, try to stay cool: close curtains, use fans to circulate air, stay hydrated, and avoid using the oven or other heat-generating appliances. If anyone in the home is vulnerable to heat, consider temporary relocation to somewhere cool. Give me your address.",
            "No AC in a heat wave is an emergency — heat-related illness is a real danger. We're going to prioritize getting someone to you. In the meantime, some survival tips: draw the blinds, stay downstairs if you have two stories, put damp towels on your neck and wrists, drink lots of water, and if you have a basement, it'll be cooler down there. If the heat is severe and anyone is feeling ill, please don't hesitate to seek medical attention. What's your address?",
            "When it's extremely hot and your AC is out, that's an emergency in my book. Heat can be dangerous, especially for the young, elderly, or those with health issues. I'm putting you on the priority list. Stay as cool as you can while you wait: close blinds, use fans, hydrate, and stay on the lowest floor. Avoid cooking or running appliances that generate heat. If anyone feels dizzy, nauseous, or overheated, get them to a cool place or seek medical help. Let me get your location so we can dispatch."
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
        console.log('  node scripts/phase4-patch-10.js --dry-run   Preview changes');
        console.log('  node scripts/phase4-patch-10.js --apply     Apply changes');
        process.exit(1);
    }

    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log(isDryRun ? '🔍 PHASE 4: DRY RUN - 10 SCENARIOS' : '🚀 PHASE 4: APPLYING - 10 SCENARIOS');
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log(`Template ID: ${TEMPLATE_ID}`);
    console.log(`Scenarios to update: ${PHASE4_SCENARIOS.length}`);
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

        for (const scenarioId of PHASE4_SCENARIOS) {
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

        if (isApply && opsCount > 0) {
            template.updatedAt = new Date();
            await template.save();
            console.log('✅ Template saved');
        }

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
            console.log('  node scripts/phase4-patch-10.js --apply');
        } else {
            console.log('✅ APPLIED - Changes written to database\n');
            console.log('To verify, run:');
            console.log('  node scripts/phase4-patch-10.js --dry-run');
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

