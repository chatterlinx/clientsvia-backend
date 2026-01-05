#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * PHASE 2: PATCH 10 WORST SCENARIOS (SCENARIO-OPS COMPLIANT)
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Brings the next 10 worst scenarios up to enforcement minimums:
 * - triggers: 8 minimum
 * - negativeUserPhrases: 3 minimum
 * - quickReplies: 7 minimum
 * - fullReplies: 7 minimum
 * 
 * USAGE:
 *   DRY RUN:  node scripts/phase2-patch-10-worst.js --dry-run
 *   APPLY:    node scripts/phase2-patch-10-worst.js --apply
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const mongoose = require('mongoose');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const TEMPLATE_ID = '68fb535130d19aec696d8123';

const PHASE2_SCENARIOS = [
    'scenario-1766498033258-arujgot50',  // Ceiling Water Stain or Leak
    'scenario-1766498034803-p3i79fb2f',  // Gas Smell Emergency
    'scenario-1766497675995-yr454an3i',  // Thermostat Screen Blank
    'scenario-1766497677582-hcdl24jv3',  // First Time Maintenance
    'scenario-1766498032141-6sib4qbpj',  // Cancel Membership
    'scenario-1766498028480-8v0gba1m4',  // Complete System Failure
    'scenario-1766498029591-of6q2ltl1',  // Breaker Keeps Tripping
    'scenario-1766497689882-06dn1hgrs',  // Caller Not Sure What They Need
    'scenario-1766497679986-n7bca6fbw',  // Weak Air Coming From Vents
    'scenario-1766498032756-tbnham3wq',  // Water Leaking From Unit
];

const MINIMUMS = {
    triggers: 8,
    negativeUserPhrases: 3,
    quickReplies: 7,
    fullReplies: 7
};

// ═══════════════════════════════════════════════════════════════════════════════
// GOLD STANDARD CONTENT TO ADD
// ═══════════════════════════════════════════════════════════════════════════════

const GOLD_STANDARD_ADDITIONS = {
    // 1. Ceiling Water Stain or Leak - EMERGENCY
    'scenario-1766498033258-arujgot50': {
        triggers: [
            'water dripping from ceiling',
            'wet spot on ceiling'
        ],
        negativeUserPhrases: [
            'roof leak from rain',
            'plumbing issue upstairs',
            'old stain dried up'
        ],
        quickReplies: [
            "A ceiling leak near your AC unit is urgent — let's get a tech out right away.",
            "Water from the ceiling usually means a clogged drain line. We can fix that today."
        ],
        fullReplies: [
            "I'm sorry you're dealing with that — ceiling water damage is stressful. When it's near your HVAC system, it's usually a clogged condensate drain line. The good news is this is a common fix. I'd recommend getting a technician out today before it causes more damage. They'll clear the drain, check for any damage, and make sure it's draining properly. Would you like me to get someone scheduled?",
            "Ceiling leaks near your AC are definitely something we want to address right away. What's likely happening is the condensate drain line is clogged, causing water to back up and overflow. Our technicians can clear it, treat it to prevent future clogs, and check for any water damage. The sooner we catch it, the less damage to your ceiling. Can I get you on today's schedule?",
            "That's concerning, and you're right to call. Water stains on the ceiling near your HVAC usually point to a drain line issue. Over time, algae and debris can clog the line, and the water has nowhere to go but your ceiling. We can get someone out to clear it and install a drain line treatment to prevent this from happening again. What time works for you today?",
            "I understand — nobody wants water coming through their ceiling. When it's near your AC unit, it's almost always the condensate drain backing up. This is fixable, usually in under an hour. Our tech will clear the clog, flush the line, and make sure everything is draining away from your home properly. I'd recommend getting this done today before it gets worse. Should I schedule that?"
        ]
    },

    // 2. Gas Smell Emergency - EMERGENCY (LIFE SAFETY)
    'scenario-1766498034803-p3i79fb2f': {
        triggers: [
            'smell gas in house',
            'natural gas odor'
        ],
        negativeUserPhrases: [
            'sewer smell',
            'rotten egg from drain',
            'musty odor'
        ],
        quickReplies: [
            "If you smell gas, please leave your home immediately and call your gas company or 911.",
            "Gas smell is an emergency — evacuate first, then call the gas company before calling us."
        ],
        fullReplies: [
            "I need to stop you right there — if you smell gas, please leave your home immediately. Don't turn on any lights or electrical switches. Once you're outside and safe, call your gas company's emergency line or 911. They'll come out and make sure there's no leak. After they've cleared your home, give us a call back and we can help with any HVAC-related issues. Your safety comes first.",
            "Gas smell is a serious emergency. Here's what I need you to do: Leave your home right now — don't flip any switches or use your phone inside. Once you're outside and away from the house, call your gas utility's emergency number or 911. They have special equipment to detect leaks and will make sure your home is safe. After they've confirmed there's no active leak, we can help with furnace or appliance issues. Please go outside now.",
            "I want to make sure you're safe. A gas smell could indicate a leak, which is dangerous. Please evacuate your home immediately — don't use any electrical switches, don't start your car in the garage, just get outside. Call your gas company or 911 from outside. They'll handle the emergency. Once your home is cleared as safe, call us back and we'll help with whatever HVAC service you need. Safety first, okay?",
            "This is important: if you're smelling gas, you need to leave your home right now. Gas leaks can be extremely dangerous. Exit the house, take your family and pets, and call the gas company emergency line or 911 from outside or a neighbor's house. Do not turn on lights or anything electrical. Once the gas company confirms you're safe, give us a call and we'll take care of any heating system issues. Please get outside now."
        ]
    },

    // 3. Thermostat Screen Blank - EMERGENCY
    'scenario-1766497675995-yr454an3i': {
        triggers: [
            'thermostat display dead'
        ],
        negativeUserPhrases: [
            'just replaced batteries',
            'screen works but no response',
            'display is dim not blank'
        ],
        quickReplies: [
            "A blank thermostat screen often means a power issue or dead batteries. Let's troubleshoot or send a tech.",
            "No display usually points to a tripped breaker, blown fuse, or the thermostat needs power."
        ],
        fullReplies: [
            "A completely blank thermostat can be frustrating, but it's usually something simple. First, check if it uses batteries — if so, try replacing them. If it's hardwired, check your breaker panel and see if anything is tripped. Sometimes the HVAC breaker or a dedicated thermostat breaker can trip. If you've tried those and it's still blank, there might be a wiring issue or the thermostat itself may need replacement. Want me to send a technician to diagnose it?",
            "When your thermostat screen goes completely blank, it's lost power somehow. Here's what to check: If your thermostat has batteries, replace them first. If it's wired to your system, go to your electrical panel and look for any tripped breakers — flip them off and back on. Also check for a small switch near your furnace or air handler. If none of that works, it could be a wiring issue or a failed thermostat. Our techs can diagnose and fix it — should I schedule someone?",
            "No display on your thermostat means it's not getting power. A few quick things to try: Replace the batteries if it has them, check your breaker panel for anything that's tripped, and make sure any power switches near your HVAC equipment are on. If the screen is still blank after that, we might be looking at a wiring problem or a thermostat that needs replacement. I can get a technician out to take a look — would today work?",
            "That's definitely something we can help with. A blank thermostat screen is typically a power problem. Start by checking if the batteries are dead — even some wired thermostats have backup batteries. Next, look at your breaker panel for any tripped breakers. There might also be a safety switch on your furnace that got tripped. If you've done all that and it's still blank, it's time for a pro to look at the wiring. Can I schedule a service call for you?"
        ]
    },

    // 4. First Time Maintenance - FAQ
    'scenario-1766497677582-hcdl24jv3': {
        triggers: [
            'never had maintenance before'
        ],
        negativeUserPhrases: [
            'had it serviced last year',
            'just got it tuned up',
            'regular maintenance customer'
        ],
        quickReplies: [
            "First maintenance visit is a great decision — we'll do a full inspection and get your system running efficiently.",
            "Never too late to start! A tune-up now can prevent breakdowns and extend your system's life."
        ],
        fullReplies: [
            "It's great that you're thinking about maintenance! Even if your system has been running fine, regular tune-ups catch small issues before they become expensive repairs. On your first visit, our technician will do a comprehensive inspection — checking electrical connections, cleaning coils, testing refrigerant levels, and making sure everything is running efficiently. Most manufacturers actually require annual maintenance to keep the warranty valid. Would you like to schedule your first tune-up?",
            "You're making a smart decision. A lot of people don't think about maintenance until something breaks, so you're ahead of the game. For a first-time maintenance visit, we'll do a complete system check — electrical, mechanical, refrigerant, airflow, the works. We'll clean what needs cleaning and let you know if anything needs attention. It usually takes about an hour. What day works best for you?",
            "Welcome! Getting your first maintenance visit scheduled is one of the best things you can do for your HVAC system. Think of it like an oil change for your car — it keeps everything running smoothly and helps prevent breakdowns. Our technician will inspect your entire system, clean the components, check for any wear and tear, and make sure you're not wasting energy. Plus, you'll have peace of mind. Ready to get on the schedule?",
            "That's a great call! First-time maintenance visits are super important, especially if the system has been running without checkups. We'll give it a thorough going-over — cleaning the coils, checking refrigerant, tightening electrical connections, inspecting the blower motor, and more. If we find anything concerning, we'll let you know before it becomes a bigger problem. Regular maintenance can add years to your system's life. Want me to book that for you?"
        ]
    },

    // 5. Cancel Membership - FAQ
    'scenario-1766498032141-6sib4qbpj': {
        triggers: [
            'want to end my plan'
        ],
        negativeUserPhrases: [
            'sign up for membership',
            'interested in joining',
            'tell me about your plans'
        ],
        quickReplies: [
            "I'm sorry to hear that. Before we cancel, can I ask what's prompting the change?",
            "I can help with that. Is there anything we can do to make the membership work better for you?"
        ],
        fullReplies: [
            "I'm sorry to hear you're thinking about canceling your membership. Before we process that, I'd love to understand what's prompting the change. Sometimes there are concerns we can address, or benefits you might not be aware of. If you've had a negative experience, I'd like to know so we can make it right. And if you still want to cancel after we talk, I'll make sure it's taken care of. What's going on?",
            "I understand, and I can definitely help with that. Before we cancel, I just want to make sure you're aware of everything included in your membership — priority scheduling, discounts on repairs, and the annual tune-ups. Sometimes people forget about benefits they haven't used yet. If there's something about the service that hasn't met your expectations, I'd like the chance to fix it. Can you tell me more about why you want to cancel?",
            "Of course, I can help you with that. We never want anyone to feel locked into something that isn't working for them. Can I ask what's making you want to cancel? If it's something we did wrong, I'd like to try to make it right. If it's just not the right fit for you, I totally understand and will get the cancellation processed. Either way, I appreciate you being a member.",
            "I can take care of that for you. Before I do, though, I want to make sure you're making the decision with all the information. Your membership includes some valuable benefits that a lot of folks don't realize — like discounts on emergency calls, priority scheduling during peak season, and your annual maintenance visits. Is there something specific that's not working for you? I'm happy to see if there's anything we can do."
        ]
    },

    // 6. Complete System Failure - EMERGENCY
    'scenario-1766498028480-8v0gba1m4': {
        triggers: [],  // Already has 16
        negativeUserPhrases: [
            'fan running but no heat',
            'unit running just not cooling',
            'only the fan stopped'
        ],
        quickReplies: [
            "Complete system failure is urgent — let's get a technician out to diagnose it right away.",
            "When nothing works at all, it's often electrical. We can have someone out today."
        ],
        fullReplies: [
            "I'm really sorry you're dealing with a complete system failure — that's stressful, especially in extreme weather. When nothing is working at all, it's often an electrical issue like a tripped breaker, blown fuse, or a safety switch. As a quick check: look at your breaker panel for anything that's tripped, and check if there's a power switch near your furnace or air handler. If that doesn't help, we need to get a technician out there. I can get someone scheduled today. What time works?",
            "No heat and no AC at all is definitely an emergency. First thing: check your electrical panel and make sure nothing is tripped. There's also usually a power switch on or near your HVAC equipment — make sure that's in the ON position. If you've checked those and still nothing, there might be a control board issue, a blown transformer, or something else that needs diagnosis. Let me get a tech out to you as soon as possible. Are you available today?",
            "Complete system failure sounds scary, but a lot of times it's something we can fix quickly. Before a tech arrives, try this: go to your breaker panel and flip the HVAC breaker off and back on. Check for any emergency shutoff switches near your equipment. If the system still won't respond at all, we're probably looking at an electrical component failure. Our technicians can diagnose it and often have the parts to fix it same-day. What's a good time for you?",
            "That's definitely not a situation you can wait on. When the entire system is dead — no fan, no heating, no cooling — it's usually an electrical problem. Could be a breaker, could be a control board, could be a transformer. Check your breaker panel first, but if that doesn't bring it back, you'll need a professional diagnosis. I can get someone out there today to figure out what's going on and get you back up and running. Should I book that now?"
        ]
    },

    // 7. Breaker Keeps Tripping - EMERGENCY
    'scenario-1766498029591-of6q2ltl1': {
        triggers: [],  // Already has 9
        negativeUserPhrases: [
            'breaker trip just once',
            'other appliances tripping breaker',
            'whole house power issue'
        ],
        quickReplies: [
            "A repeatedly tripping breaker is a safety concern — please don't keep resetting it. Let's get it diagnosed.",
            "Breakers trip for a reason. Repeated tripping means something's wrong. We should look at it today."
        ],
        fullReplies: [
            "A breaker that keeps tripping is telling you something's wrong, and it's important not to ignore it. Please don't keep resetting it — that's the breaker doing its job protecting your home. When it's the HVAC breaker, it usually means there's an electrical issue in the system — could be a short, a failing motor, or a compressor problem. This needs professional diagnosis. I can have a technician come out today to find the root cause. Sound good?",
            "Repeatedly tripping breakers are definitely a safety concern. The breaker is designed to trip when there's too much current — either an overload or a short circuit. If it's your HVAC breaker specifically, something in your system is drawing too much power or has an electrical fault. I'd strongly recommend not resetting it again until a technician can look at it. We can get someone out today to diagnose the problem safely. What time works?",
            "That's something we need to address right away. A breaker that keeps tripping isn't just annoying — it's a warning sign. It could be a failing compressor, a motor going bad, a wiring issue, or even a capacitor problem. The worst thing you can do is keep resetting it, because that can cause more damage or create a fire hazard. Let's get a technician out there to find the cause and fix it properly. Are you available today?",
            "I'm glad you called about this. When an HVAC breaker trips repeatedly, there's definitely something wrong that needs professional attention. It's the electrical system's way of preventing damage or fire. The cause could be anything from a bad capacitor to a compressor issue to damaged wiring. Please leave it tripped for now — our technician will do a full electrical diagnostic when they arrive. I can schedule someone for today. Does that work?"
        ]
    },

    // 8. Caller Not Sure What They Need - TROUBLESHOOT
    'scenario-1766497689882-06dn1hgrs': {
        triggers: [],  // Already has 9
        negativeUserPhrases: [
            'know exactly what I need',
            'just want to schedule service',
            'already diagnosed the problem'
        ],
        quickReplies: [
            "No problem — let's figure it out together. What's your system doing or not doing?",
            "That's okay! Tell me what you're experiencing and we'll sort out the best next step."
        ],
        fullReplies: [
            "No worries at all — that's what we're here for! Let's figure this out together. Can you describe what's happening with your system? Is it making unusual noises, not heating or cooling properly, or just not turning on at all? Even if it just 'feels different,' that helps. Once I understand what's going on, I can point you toward the right service — whether that's a repair visit, a diagnostic call, or maybe just a tune-up.",
            "That's totally fine — a lot of people call without knowing exactly what they need, and that's okay. Just tell me what's going on. Is your house not getting to the temperature you want? Is the system making strange sounds? Running constantly or not at all? Any detail helps me figure out whether you need a repair, a service call, or something else. Take your time.",
            "Don't worry about that — we'll figure it out together. Start by telling me what's happening. Is it a comfort issue, like some rooms being too hot or cold? Is the system behaving strangely? Running too much or not enough? Sometimes it's obvious what's needed, and sometimes we need to send a technician out to diagnose it. Either way, I'll help you figure out the right next step.",
            "That happens more often than you'd think, and it's perfectly okay. Here's what usually helps: just describe what you're noticing. Maybe it's a weird noise, maybe the house isn't comfortable, maybe your energy bills spiked. Once you tell me what's going on, I can tell you whether it sounds like a simple fix, something that needs a pro, or just a normal maintenance visit. What are you experiencing?"
        ]
    },

    // 9. Weak Air Coming From Vents - FAQ
    'scenario-1766497679986-n7bca6fbw': {
        triggers: [],  // Already has 11
        negativeUserPhrases: [
            'great airflow no issues',
            'strong air from vents',
            'airflow just started weak'  // Different scenario - sudden vs gradual
        ],
        quickReplies: [
            "Weak airflow usually means a dirty filter, duct issue, or blower problem. Let's figure it out.",
            "Poor airflow is one of the most common calls we get — and usually very fixable."
        ],
        fullReplies: [
            "Weak airflow is frustrating, but it's usually something we can fix. The most common cause is a dirty air filter — when did you last change yours? If the filter is fine, it could be blocked or disconnected ducts, a failing blower motor, or even frozen evaporator coils. A quick thing to check: look at your filter and see if it's clogged. If it is, replace it and see if airflow improves in a few hours. If not, we should send a tech to diagnose it. Want me to schedule that?",
            "That's a really common issue, and there are several things that can cause it. First, check your air filter — if it's clogged, that restricts airflow significantly. If the filter is clean, we might be looking at duct problems, a blower motor issue, or even a frozen coil blocking airflow. Sometimes ducts come loose in the attic or crawl space. Our technicians can do a full airflow diagnostic and pinpoint the problem. Would you like to schedule a service call?",
            "Weak air from the vents can have a few causes. Start with the easy one: check your air filter. A dirty filter is the number one cause of poor airflow. If that's not it, the blower motor might be failing, there could be duct leaks or blockages, or your evaporator coil might be dirty. Some of these are easy fixes, some need a pro. If you've already checked the filter and it's not the issue, let's get a technician out to diagnose it properly. Sound good?",
            "Poor airflow is one of the most common things we help with. The usual suspects are: a clogged filter (easy fix), leaky or disconnected ducts (needs inspection), a weak blower motor (needs repair), or a dirty evaporator coil (needs cleaning). Check your filter first — if it's more than a month old or looks dirty, replace it and see if things improve. If the filter isn't the problem, I'd recommend a service visit so we can find the root cause. Want me to schedule that?"
        ]
    },

    // 10. Water Leaking From Unit - EMERGENCY
    'scenario-1766498032756-tbnham3wq': {
        triggers: [],  // Already has 10
        negativeUserPhrases: [
            'condensation on windows',
            'humidity issue',
            'water heater leaking'
        ],
        quickReplies: [
            "Water from your AC unit usually means a clogged drain line. We should get that cleared today.",
            "Leaking water is urgent — it can cause damage fast. Let's get a tech out to stop it."
        ],
        fullReplies: [
            "Water leaking from your HVAC unit needs attention right away — it can cause water damage to your home. The most likely cause is a clogged condensate drain line. Your AC produces a lot of moisture, and when the drain line gets blocked by algae or debris, the water backs up and overflows. Our technicians can clear the line, treat it to prevent future clogs, and check for any damage. I'd recommend getting this done today. Can I schedule someone?",
            "A leaking unit is definitely something to address quickly. Most of the time, it's the condensate drain — your AC removes humidity from the air, and that water has to go somewhere. If the drain line is clogged, the water ends up on your floor instead. We can clear it, usually in under an hour. If it's something else, like a cracked drain pan or a refrigerant issue causing a frozen coil, we'll diagnose that too. Want me to get you on today's schedule?",
            "Water where it shouldn't be is always urgent. When an HVAC unit is leaking, it's usually the condensate drain line that's clogged — but it could also be a cracked drain pan, a frozen evaporator coil that's thawing, or even a bad pump if your unit uses one. The important thing is to address it before you have water damage to your floors or ceilings. I can have someone out today to find the source and fix it. What time works?",
            "I'm sorry you're dealing with that — water leaks are stressful. The good news is, it's usually a fixable problem. Most likely, your drain line is clogged and the condensate has nowhere to go. Less commonly, it's a cracked pan or a frozen coil melting off. Either way, we can get it sorted. Our technician will clear any clogs, inspect for damage, and make sure the water is draining properly. Let's get this taken care of today. Does that work for you?"
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
        console.log('  node scripts/phase2-patch-10-worst.js --dry-run   Preview changes');
        console.log('  node scripts/phase2-patch-10-worst.js --apply     Apply changes');
        process.exit(1);
    }

    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log(isDryRun ? '🔍 PHASE 2: DRY RUN - 10 WORST SCENARIOS' : '🚀 PHASE 2: APPLYING - 10 WORST SCENARIOS');
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log(`Template ID: ${TEMPLATE_ID}`);
    console.log(`Scenarios to update: ${PHASE2_SCENARIOS.length}`);
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

        for (const scenarioId of PHASE2_SCENARIOS) {
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
            console.log('  node scripts/phase2-patch-10-worst.js --apply');
        } else {
            console.log('✅ APPLIED - Changes written to database\n');
            console.log('To verify, run:');
            console.log('  node scripts/phase2-patch-10-worst.js --dry-run');
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

