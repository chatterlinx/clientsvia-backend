#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * PHASE 5: PATCH 10 SCENARIOS (FAQ/ADMIN BATCH)
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Scenarios in this batch:
 * - Warranty Coverage Question (FAQ)
 * - Financing Options Available (FAQ)
 * - Payment Methods Accepted (FAQ)
 * - System Upgrade Inquiry (FAQ)
 * - Filter Delivery Service (FAQ)
 * - Follow-Up After Service (FAQ)
 * - Commercial Billing Questions (BILLING)
 * - First Time Caller / New Customer (FAQ)
 * - Do You Service My Area (FAQ)
 * - Called Wrong Company (SMALL_TALK)
 * 
 * USAGE:
 *   DRY RUN:  node scripts/phase5-patch-10.js --dry-run
 *   APPLY:    node scripts/phase5-patch-10.js --apply
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const mongoose = require('mongoose');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');

const TEMPLATE_ID = '68fb535130d19aec696d8123';

const PHASE5_SCENARIOS = [
    'scenario-1766497686334-vrjjzbxnf',  // Warranty Coverage Question
    'scenario-1766497686687-hmuy8scbd',  // Financing Options Available
    'scenario-1766497687207-yaaevruve',  // Payment Methods Accepted
    'scenario-1766497688996-9j6kr2756',  // System Upgrade Inquiry
    'scenario-1766497679595-jgfg7m5m9',  // Filter Delivery Service
    'scenario-1766498036078-16gg1623a',  // Follow-Up After Service
    'scenario-1766497689400-ua7xkxrq6',  // Commercial Billing Questions
    'scenario-1766497687854-pzhnzl5a0',  // First Time Caller / New Customer
    'scenario-1766497688486-gc1d03ii2',  // Do You Service My Area
    'scenario-1766497691864-u3ymtmd38',  // Called Wrong Company
];

const MINIMUMS = {
    triggers: 8,
    negativeUserPhrases: 3,
    quickReplies: 7,
    fullReplies: 7
};

// ═══════════════════════════════════════════════════════════════════════════════
// GOLD STANDARD CONTENT - FAQ/ADMIN BATCH
// ═══════════════════════════════════════════════════════════════════════════════

const GOLD_STANDARD_ADDITIONS = {
    // 1. Warranty Coverage Question - FAQ
    'scenario-1766497686334-vrjjzbxnf': {
        triggers: [],
        negativeUserPhrases: [
            'extended warranty purchase',
            'warranty on new system quote',
            'home warranty company'
        ],
        quickReplies: [
            "Warranty coverage depends on your system and when it was installed. Let me look that up for you.",
            "Our work comes with a warranty. What specifically are you wondering about — parts, labor, or both?"
        ],
        fullReplies: [
            "Great question about warranty! Most of our repairs come with a warranty on both parts and labor. The exact coverage depends on what was done and when. For new system installations, manufacturers typically offer 5-10 year warranties on major components, and we add our own labor warranty on top of that. If you have a specific repair or installation you're asking about, I can look up the details. Do you have an invoice or date of service?",
            "Warranty coverage varies based on the work performed. For repairs, we typically warranty our labor for a set period, and any parts we install carry either manufacturer or supplier warranties. For new system installations, you usually get manufacturer coverage on the equipment plus our installation warranty. What's the situation — are you having an issue with something we previously worked on, or are you asking about coverage before scheduling service?",
            "We stand behind our work! For service calls and repairs, we offer a labor warranty, and parts are covered under manufacturer or supplier warranties. New installations come with both manufacturer warranties on the equipment and our workmanship guarantee. The specific terms depend on what was installed and when. If you're experiencing a problem with something we did, let me know and we'll make it right. What's going on?",
            "Happy to help with warranty questions! Here's the general breakdown: our labor has a warranty period, parts we install are covered by manufacturer warranties, and new system installations have comprehensive coverage from both the manufacturer and us. The exact terms are in your paperwork, but I can look up your history if you give me your address or the date of service. Are you having an issue, or just checking for future reference?"
        ]
    },

    // 2. Financing Options Available - FAQ
    'scenario-1766497686687-hmuy8scbd': {
        triggers: [],
        negativeUserPhrases: [
            'paying cash no financing',
            'dont need payment plan',
            'already have financing'
        ],
        quickReplies: [
            "Yes, we offer financing! I can give you details or have our comfort advisor discuss options during your estimate.",
            "We have several financing options with approved credit. Want me to explain them or schedule a consultation?"
        ],
        fullReplies: [
            "We do offer financing options to help make larger repairs or new system installations more manageable! We work with financing partners that offer various plans, including options with promotional periods. Approval is based on credit, and you can often apply quickly. The best way to explore this is during an in-home estimate, where our comfort advisor can walk you through the numbers. Want me to schedule that consultation?",
            "Absolutely — we understand that HVAC repairs and especially new systems can be a significant investment. That's why we offer financing through trusted partners. Depending on your credit approval, you may qualify for plans with promotional rates or extended terms. Our comfort advisors can explain all the options during your estimate appointment. Would you like to get that scheduled?",
            "Yes, financing is available! We partner with reputable financing companies to offer payment plans for qualifying customers. This is especially helpful for larger repairs or new system installations. The application process is usually quick, and our team can walk you through everything. To give you accurate information on rates and terms, I'd recommend scheduling a consultation where we can discuss your specific situation. Interested?",
            "We definitely have financing available for customers who prefer to spread out payments. The specific terms and rates depend on the financing partner and your credit approval, but we have options to fit different budgets. For new installations, we can usually present financing options right during the estimate. For repairs, we can discuss it when the technician diagnoses the issue. What type of work are you looking at?"
        ]
    },

    // 3. Payment Methods Accepted - FAQ
    'scenario-1766497687207-yaaevruve': {
        triggers: [],
        negativeUserPhrases: [
            'already know payment options',
            'payment not the issue',
            'will pay later not now'
        ],
        quickReplies: [
            "We accept all major credit cards, checks, and cash. We also have financing for larger jobs.",
            "Most payment methods are fine — cards, cash, checks. For bigger projects, financing is an option too."
        ],
        fullReplies: [
            "We accept all major forms of payment! That includes Visa, Mastercard, American Express, Discover, personal checks, and cash. For larger repairs or new system installations, we also offer financing options with approved credit. Payment is typically collected when the work is completed, so you'll know the full cost before you pay. Is there anything specific about payment you wanted to clarify?",
            "Good question! We're pretty flexible on payments. We take all major credit cards, debit cards, personal checks, and cash. For bigger jobs like system replacements or major repairs, we also have financing available if you'd prefer to spread out the cost. Our technicians can process card payments on-site, so it's convenient. Anything else I can help with?",
            "We accept credit cards (Visa, MC, Amex, Discover), debit cards, checks, and cash. For larger investments like new systems, we offer financing options through our financing partners — the application is quick and our team can help you through it. Is there a particular payment method you were hoping to use?",
            "We make payment easy! All major credit and debit cards are accepted, as well as checks and cash. Our technicians carry card readers, so you can pay right when the job is done. If you're looking at a larger expense like a new system, we have financing options available too. Just let us know what works best for you."
        ]
    },

    // 4. System Upgrade Inquiry - FAQ
    'scenario-1766497688996-9j6kr2756': {
        triggers: [],
        negativeUserPhrases: [
            'not interested in upgrade',
            'system is brand new',
            'just need repair not replacement'
        ],
        quickReplies: [
            "Thinking about upgrading? I can schedule a free estimate to discuss your options and see what makes sense.",
            "Upgrades are a big decision. Our comfort advisor can evaluate your current system and explain what's available."
        ],
        fullReplies: [
            "If you're thinking about upgrading your HVAC system, that's a great conversation to have! Newer systems are significantly more efficient, which means lower energy bills and better comfort. The right time to upgrade depends on your current system's age, repair history, and your comfort goals. I can schedule a free in-home estimate where our comfort advisor evaluates your setup and presents options with pricing. No pressure — it's just information to help you decide. Want me to set that up?",
            "Upgrading your system is definitely worth exploring, especially if your current one is older or giving you trouble. Today's equipment is more efficient, quieter, and often comes with smart features. Our process starts with a home evaluation where we look at your current system, assess your home's needs, and present options at different price points. The estimate is free and no obligation. Would you like to schedule that?",
            "Great question! An upgrade might make sense depending on your situation. If your system is 10-15+ years old, needs frequent repairs, or isn't keeping you comfortable, a new system could save you money in the long run and improve your quality of life. The best way to know is a free in-home assessment. Our comfort advisor will look at everything and give you honest recommendations — upgrade, repair, or stay the course. Interested in scheduling?",
            "Thinking about an upgrade is smart planning! The decision usually comes down to: How old is your system? How often does it need repairs? Are your energy bills higher than they should be? Are some rooms uncomfortable? If you're checking multiple boxes, an upgrade could be the right move. I can schedule our comfort advisor to come out, evaluate your home, and show you options. The consultation is free. Want to book that?"
        ]
    },

    // 5. Filter Delivery Service - FAQ
    'scenario-1766497679595-jgfg7m5m9': {
        triggers: [],
        negativeUserPhrases: [
            'buy filters myself',
            'dont need filter delivery',
            'get filters at store'
        ],
        quickReplies: [
            "We offer filter delivery so you never forget to change your filter. I can sign you up or give you details.",
            "Filter delivery is convenient — we send the right size on a schedule. Want me to explain how it works?"
        ],
        fullReplies: [
            "We do offer a filter delivery service! It's a convenient way to make sure you always have the right filters on hand and never forget to change them. We'll deliver the correct size for your system on a schedule that matches your filter change needs — usually every 1-3 months depending on your filter type. It's one less thing to think about, and it helps keep your system running efficiently. Want me to get you signed up?",
            "Our filter delivery program is designed to make filter changes easy! We find out what size filter you need, set you up on a delivery schedule, and ship them right to your door. Regular filter changes are one of the best things you can do for your system — it improves efficiency, air quality, and prevents unnecessary strain on your equipment. Interested in getting set up?",
            "Yes! We have a filter subscription service. You'll get the correct filters for your system delivered on a regular schedule — no more guessing at sizes or forgetting to buy them. It's affordable and keeps your system healthy. Poor filter maintenance is actually one of the top causes of HVAC problems, so this is a simple way to protect your investment. Should I explain the options?",
            "Filter delivery is something we offer to help our customers stay on top of maintenance! Here's how it works: we identify the right filter for your system, set a delivery schedule based on how often you should change it, and send them automatically. You never have to think about it. Clean filters mean better airflow, lower energy bills, and a happier system. Want to get started?"
        ]
    },

    // 6. Follow-Up After Service - FAQ
    'scenario-1766498036078-16gg1623a': {
        triggers: [],
        negativeUserPhrases: [
            'first time calling no previous service',
            'never had service before',
            'new customer no history'
        ],
        quickReplies: [
            "Following up on recent service? I can look up your work order. What's your address or the service date?",
            "Happy to help with a follow-up. Was there an issue with the repair, or do you have questions about what was done?"
        ],
        fullReplies: [
            "Thanks for calling back! I'd be happy to help with anything related to your recent service. Are you calling because something's not working right, or do you have questions about the work that was performed? Either way, let me pull up your record. What's your address or the date of service?",
            "Of course — following up after service is totally normal, and we want to make sure everything is working well. Let me find your work order. Are you having an issue with the repair, or did you want clarification on something the technician mentioned? I can look up the notes and help from there.",
            "I'm glad you called! We want to make sure our service met your expectations. What's going on — is the system not working as expected, or do you have questions about the work? Give me your address and I'll pull up the details from your visit.",
            "Happy to help with your follow-up! Whether it's a question about the repair, something not working right, or just wanting to understand what was done — we're here. Let me look up your service record. What's the address, or do you have the date the technician came out?"
        ]
    },

    // 7. Commercial Billing Questions - BILLING
    'scenario-1766497689400-ua7xkxrq6': {
        triggers: [],
        negativeUserPhrases: [
            'residential billing not commercial',
            'home account not business',
            'personal not company billing'
        ],
        quickReplies: [
            "For commercial billing questions, let me connect you with our commercial accounts team or look up your account.",
            "Commercial accounts work a bit differently. I can help or transfer you to our commercial department."
        ],
        fullReplies: [
            "For commercial billing questions, I'd be happy to help or connect you with the right person. Commercial accounts sometimes have different terms, invoicing, and payment options than residential. Can you give me your business name or account number? I'll pull up your information and see how I can assist, or get you to our commercial accounts team if needed.",
            "Commercial billing is handled a bit differently than residential, and I want to make sure you get accurate information. Let me find your account — what's your business name? Depending on your question, I can help directly or connect you with our commercial accounts specialist who handles invoicing and terms.",
            "I can help with commercial billing! Commercial accounts often have specific arrangements, so let me pull up your information. What's the business name or your account number? If it's a complex billing issue, I may need to have our commercial department follow up, but I'll do what I can right now.",
            "Commercial billing questions are totally fine — we work with many businesses. Your account may have special terms or invoicing arrangements, so let me look you up. What's your company name? I'll check your billing details and either answer your question or make sure the right person gets back to you promptly."
        ]
    },

    // 8. First Time Caller / New Customer - FAQ
    'scenario-1766497687854-pzhnzl5a0': {
        triggers: [],
        negativeUserPhrases: [
            'existing customer account',
            'called before have history',
            'returning customer'
        ],
        quickReplies: [
            "Welcome! We're glad you called. I'll get your information and we'll take great care of you.",
            "First time calling? Awesome! Let me tell you a bit about us and then help with whatever you need."
        ],
        fullReplies: [
            "Welcome! We're so glad you reached out. As a new customer, here's what you can expect from us: upfront pricing, professional technicians who respect your home, and quality work we stand behind. Whether you need a repair, maintenance, or just have questions, we're here to help. What can I do for you today?",
            "Thanks for giving us a call! We love helping new customers. Just so you know, we've been serving this area for years, our technicians are trained and background-checked, and we give you pricing before any work is done — no surprises. Now, how can I help you? Is this for a repair, maintenance, or something else?",
            "Welcome to the family! We appreciate you calling us first. Here's our promise: honest recommendations, fair pricing, and work we guarantee. We treat every home like it's our own. What brought you to us today — is there an issue with your heating or cooling, or are you looking for maintenance?",
            "Hi there! So happy to have you. As a first-time customer, I want you to know we take pride in earning your trust. We'll explain everything before we do it, give you options, and make sure you're comfortable. Our goal is to turn first-time callers into lifelong customers. What can I help you with today?"
        ]
    },

    // 9. Do You Service My Area - FAQ
    'scenario-1766497688486-gc1d03ii2': {
        triggers: [],
        negativeUserPhrases: [
            'already know you service here',
            'confirmed service area',
            'technician already came out'
        ],
        quickReplies: [
            "We serve a wide area! What's your zip code or city? I'll confirm we can get to you.",
            "Let me check — what's your location? We cover a pretty broad service area."
        ],
        fullReplies: [
            "Great question! We service a wide area and chances are we can help you. What's your zip code or city? I'll confirm right away. If you're in our coverage zone, I can get you scheduled. If not, I may be able to recommend someone reputable in your area.",
            "We cover a large service area! Give me your zip code or the city you're in and I'll let you know immediately. We want to make sure we can get a technician to you in a reasonable time. What's your location?",
            "I'd be happy to check! What city or zip code are you in? We have a broad service area and serve many communities. If you're within our range, I can get you on the schedule right away. If you're outside our area, I'll do my best to point you in the right direction.",
            "Let's find out! What's your zip code? We service quite a few areas and are always happy to help when we can. Just give me your location and I'll confirm whether we can get a technician out to you."
        ]
    },

    // 10. Called Wrong Company - SMALL_TALK
    'scenario-1766497691864-u3ymtmd38': {
        triggers: [],
        negativeUserPhrases: [
            'yes this is the right company',
            'i meant to call you',
            'correct number wanted hvac'
        ],
        quickReplies: [
            "No problem! Happens all the time. Good luck finding the right number.",
            "That's okay! If you ever need HVAC help in the future, we're here. Have a great day!"
        ],
        fullReplies: [
            "No worries at all! It happens. We're an HVAC company, so if you ever need heating, cooling, or air quality help, feel free to call back. Good luck reaching the right place, and have a great day!",
            "That's okay — wrong numbers happen to everyone! We specialize in heating and air conditioning, so if that's ever something you need, we'd be happy to help. Hope you find who you're looking for. Take care!",
            "No problem! We're actually an HVAC company for heating and cooling services. If that's ever something you need in the future, keep our number handy. Good luck getting to the right place!",
            "Happens all the time — no worries! We do heating, cooling, and indoor air quality, so if you ever need help with any of that, give us a call. Hope you get connected to the right company. Have a good one!"
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
        console.log('  node scripts/phase5-patch-10.js --dry-run   Preview changes');
        console.log('  node scripts/phase5-patch-10.js --apply     Apply changes');
        process.exit(1);
    }

    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log(isDryRun ? '🔍 PHASE 5: DRY RUN - 10 FAQ/ADMIN SCENARIOS' : '🚀 PHASE 5: APPLYING - 10 FAQ/ADMIN SCENARIOS');
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log(`Template ID: ${TEMPLATE_ID}`);
    console.log(`Scenarios to update: ${PHASE5_SCENARIOS.length}`);
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

        for (const scenarioId of PHASE5_SCENARIOS) {
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
            console.log('  node scripts/phase5-patch-10.js --apply');
        } else {
            console.log('✅ APPLIED - Changes written to database\n');
            console.log('To verify, run:');
            console.log('  node scripts/phase5-patch-10.js --dry-run');
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

