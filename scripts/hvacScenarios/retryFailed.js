/**
 * Retry script for failed scenarios
 */

const { buildScenarioPayload } = require('./seedScenarios');

const TEMPLATE_ID = '68fb535130d19aec696d8123';
const API_BASE_URL = process.env.API_URL || 'https://cv-backend-va.onrender.com';
const AUTH_TOKEN = process.env.AUTH_TOKEN;

// Only the failed scenarios with corrected handoffPolicy values
const FAILED_SCENARIOS = [
    {
        categoryId: 'cat-1764754970040',
        categoryName: 'System Not Turning On / Total Failure',
        scenarios: [
            {
                name: 'Complete System Failure',
                priority: 9,
                triggers: [
                    "my ac won't turn on", "my ac is not turning on", "ac won't start",
                    "heating won't turn on", "hvac not working at all", "system is completely dead",
                    "nothing happens when I turn on the ac", "unit won't power on",
                    "system not responding", "hvac is dead", "ac completely stopped",
                    "furnace won't start", "heat pump not turning on", "no power to the unit",
                    "thermostat not turning on system", "system not kicking on"
                ],
                negativeTriggers: ["just a question", "checking price", "routine maintenance", "working fine now", "fixed itself"],
                quickReplies: [
                    "I'm sorry to hear your system isn't turning on. Let me help you troubleshoot.",
                    "A complete system failure is definitely concerning. Let's see what's going on.",
                    "I understand the frustration when your HVAC won't start. Let's figure this out.",
                    "That sounds like it needs immediate attention. I'm here to help.",
                    "A non-responsive system is a priority for us. Let's get you scheduled."
                ],
                fullReplies: [
                    "When a system won't turn on at all, it could be several things—a tripped breaker, a safety switch, or an electrical issue. First, check your breaker panel to make sure nothing's tripped. If that's not it, we should definitely have a technician take a look. Would you like me to schedule a diagnostic visit?",
                    "A complete system failure is something we take seriously. It could be electrical, a failed component, or a safety mechanism. Before we send someone out, have you checked if the breaker is tripped? If you've done that and it's still not working, let's get a technician out there today or tomorrow.",
                    "I understand how uncomfortable this must be. When an HVAC system won't power on, it typically means something's wrong with the electrical supply, the control board, or a safety switch. We can have a technician diagnose the issue—would you like me to check availability?"
                ],
                actionHooks: ['offer_scheduling', 'capture_address'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.8
            },
            {
                name: 'Breaker Keeps Tripping',
                priority: 8,
                triggers: [
                    "breaker keeps tripping", "ac trips the breaker", "hvac blows fuse",
                    "circuit breaker keeps shutting off", "keeps blowing fuses",
                    "electrical issue with ac", "breaker pops when ac turns on",
                    "ac overloading circuit", "system trips breaker immediately"
                ],
                negativeTriggers: ["other appliance", "not the ac", "lights flickering", "unrelated"],
                quickReplies: [
                    "A tripping breaker with your HVAC is a safety concern. Let me help.",
                    "Breakers trip for a reason—often it's a sign of an electrical issue.",
                    "That's definitely something that needs professional attention.",
                    "Repeated breaker trips indicate your system needs to be inspected.",
                    "This is something our technicians can diagnose and fix safely."
                ],
                fullReplies: [
                    "When your HVAC keeps tripping the breaker, it's usually a sign of an electrical problem—could be a short, a failing compressor, or the unit drawing too much current. This isn't something you should try to fix yourself because of the electrical risks. I'd recommend having one of our technicians come out to safely diagnose and repair it.",
                    "Breakers are designed to trip when there's too much electrical load or a short circuit. If your HVAC is causing this repeatedly, something inside the system is likely failing. It could be the compressor, a motor, or wiring issues. We should have a technician inspect it before it causes more damage.",
                    "A breaker that keeps tripping when you run your HVAC is definitely a red flag. It protects your home from electrical fires, so this needs attention. Our technicians can safely diagnose whether it's the unit itself or perhaps an undersized circuit."
                ],
                actionHooks: ['offer_scheduling', 'flag_urgent'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.85
            }
        ]
    },
    {
        categoryId: 'cat-1764755836130',
        categoryName: 'After-Hours Emergency',
        scenarios: [
            {
                name: 'After Hours Emergency Service',
                priority: 10,
                triggers: [
                    "emergency hvac service", "after hours emergency", "urgent ac repair",
                    "emergency heating repair", "middle of the night ac problem",
                    "weekend hvac emergency", "holiday hvac service", "24 hour service",
                    "emergency technician", "urgent system failure", "can't wait until tomorrow",
                    "need someone tonight", "is there emergency service", "overnight repair"
                ],
                negativeTriggers: ["not an emergency", "can wait", "just asking", "regular appointment", "routine service", "next week is fine"],
                quickReplies: [
                    "We understand emergencies don't follow business hours. Let me help.",
                    "I'm here to assist with your urgent HVAC situation.",
                    "Emergency service is available. Let's get you the help you need.",
                    "We have after-hours technicians for exactly these situations.",
                    "Your comfort and safety are our priority, even after hours."
                ],
                fullReplies: [
                    "We do offer emergency after-hours service for situations that can't wait. There may be an additional charge for emergency calls, but we understand that no heat in winter or no AC in extreme heat is a real emergency. Let me connect you with our on-call technician or get you scheduled for the first available slot.",
                    "Emergencies happen at the worst times, and we're here to help. Our after-hours service is available for urgent situations like no heat, no cooling in extreme weather, or safety concerns like gas smells. What's the nature of your emergency?",
                    "I completely understand that some HVAC problems can't wait until morning. We have technicians available for true emergencies. Can you tell me more about what's happening so I can determine the urgency and get someone dispatched if needed?"
                ],
                actionHooks: ['flag_emergency', 'dispatch_oncall', 'capture_phone'],
                handoffPolicy: 'always_on_keyword',
                contextWeight: 0.95
            },
            {
                name: 'No Heat Emergency',
                priority: 10,
                triggers: [
                    "no heat and it's freezing", "heater emergency", "house is ice cold",
                    "pipes might freeze", "family freezing", "elderly no heat",
                    "baby in house no heat", "heat emergency", "furnace emergency"
                ],
                negativeTriggers: ["just a little cold", "can use space heaters", "not urgent"],
                quickReplies: [
                    "No heat in cold weather is definitely an emergency. I'm prioritizing this.",
                    "I understand the urgency—cold homes can be dangerous.",
                    "Let's get heat restored to your home as quickly as possible.",
                    "This is a priority situation. I'm here to help immediately.",
                    "Your family's safety comes first. Let's get a technician out there."
                ],
                fullReplies: [
                    "No heat in freezing weather is absolutely an emergency, especially if you have young children, elderly family members, or are concerned about pipes freezing. I'm treating this as a priority call. Let me get you connected with our emergency dispatch to get a technician out as soon as possible.",
                    "I completely understand the urgency here. A home without heat in cold weather isn't just uncomfortable—it can be dangerous. We'll do everything we can to get someone to you quickly. Can I get your address and confirm contact information so we can dispatch a technician?",
                    "This is definitely a situation we take seriously. Frozen pipes, health risks from cold exposure—we want to prevent all of that. Our emergency team can usually respond within a few hours. Let me get your information and we'll get someone on the way."
                ],
                actionHooks: ['flag_emergency', 'dispatch_oncall', 'capture_address', 'capture_phone'],
                handoffPolicy: 'always_on_keyword',
                contextWeight: 0.98
            },
            {
                name: 'No AC Emergency - Extreme Heat',
                priority: 10,
                triggers: [
                    "no ac and it's extremely hot", "ac emergency", "heat stroke risk",
                    "house is dangerously hot", "elderly person no cooling",
                    "medical condition needs ac", "baby in hot house", "can't sleep it's so hot"
                ],
                negativeTriggers: ["just warm", "can use fans", "not that bad"],
                quickReplies: [
                    "Extreme heat without AC can be dangerous. Let's get this resolved.",
                    "I understand—heat emergencies are just as serious as no heat.",
                    "Your safety is our priority. Let me help right away.",
                    "No cooling in dangerous heat is definitely urgent.",
                    "We treat extreme heat situations as emergencies."
                ],
                fullReplies: [
                    "When temperatures are dangerous and you have no cooling, that's absolutely an emergency—especially for children, elderly, or anyone with health conditions. Heat stroke is a real risk. Let me get our emergency team on this right away. Can I get your address?",
                    "I hear the urgency in your situation. Extreme heat without AC is just as dangerous as no heat in winter. We can dispatch an emergency technician to help restore your cooling. Let me get your information and we'll prioritize this call.",
                    "No AC in extreme heat is something we take very seriously. If you have vulnerable family members or it's a health concern, this is definitely an emergency call. Let me connect you with our on-call team to get someone out to you as quickly as possible."
                ],
                actionHooks: ['flag_emergency', 'dispatch_oncall', 'capture_address', 'capture_phone'],
                handoffPolicy: 'always_on_keyword',
                contextWeight: 0.98
            }
        ]
    },
    {
        categoryId: 'cat-1764755534854',
        categoryName: 'Membership / Plan Questions',
        scenarios: [
            {
                name: 'Cancel Membership',
                priority: 6,
                triggers: [
                    "cancel my membership", "end my plan", "stop my subscription",
                    "want out of maintenance agreement", "cancel service contract",
                    "don't want to renew", "discontinue membership"
                ],
                negativeTriggers: ["want to join", "sign up", "interested in membership"],
                quickReplies: [
                    "I'm sorry to hear you want to cancel. Let me help with that.",
                    "I can assist with your cancellation request.",
                    "Let me look into your membership and help you with this.",
                    "I understand. Let me get your account information.",
                    "I'll help you with your cancellation. May I ask why you're leaving?"
                ],
                fullReplies: [
                    "I'm sorry to hear you'd like to cancel your membership. I can certainly help with that. Before we proceed, is there anything we could do differently? Sometimes members aren't aware of all the benefits included. But if you've made up your mind, I'll need to pull up your account to process the cancellation.",
                    "I understand, and I can help you with canceling your membership. I would like to mention that if it's been a while since you've used your included tune-ups, you might want to schedule those first since they're already paid for. But either way, I can take care of the cancellation for you.",
                    "No problem, I can process that for you. Just so you know, many members don't realize they have unused benefits like tune-ups or that their discount extends to all services. If you're canceling due to a bad experience, I'd also like to make sure we address that. What's driving your decision to cancel?"
                ],
                actionHooks: ['flag_retention', 'lookup_account'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.7
            }
        ]
    },
    {
        categoryId: 'cat-1764755339971',
        categoryName: 'Water Leak / Ceiling Leak / Drain Issues',
        scenarios: [
            {
                name: 'Water Leaking From Unit',
                priority: 8,
                triggers: [
                    "water leaking from ac", "ac is leaking water", "puddle under ac unit",
                    "water dripping from air handler", "condensate leak", "drain line clogged",
                    "water on floor near hvac", "ac dripping water inside",
                    "water damage from ac", "hvac causing water leak"
                ],
                negativeTriggers: ["outside unit normal condensation", "just a little moisture"],
                quickReplies: [
                    "Water leaks from your AC can cause damage. Let's address this quickly.",
                    "A leaking AC unit needs attention to prevent water damage.",
                    "I understand the concern—let me help you with this leak issue.",
                    "Water leaks can indicate a drain problem or other issue.",
                    "Let's get that water leak taken care of before it causes damage."
                ],
                fullReplies: [
                    "Water leaking from your AC is usually caused by a clogged condensate drain line. The drain can get blocked with algae, mold, or debris, and when it can't drain properly, water backs up and overflows. This can cause water damage if not addressed. We can clear the drain and check for any other issues. Would you like to schedule a service call?",
                    "A leaking AC is definitely something to take care of quickly to avoid water damage to your home. The most common cause is a clogged drain line, but it could also be a cracked drain pan, a frozen evaporator coil that's thawing, or an improperly installed unit. I'd recommend having a technician inspect it soon.",
                    "Water leaks from HVAC equipment are usually a drain issue. Your AC produces condensation, and if the drain gets clogged or the pan cracks, that water has nowhere to go except onto your floor or ceiling. This is definitely something we should address before it damages your home. Can we schedule a service visit?"
                ],
                actionHooks: ['offer_scheduling', 'flag_urgent'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.8
            },
            {
                name: 'Ceiling Water Stain or Leak',
                priority: 8,
                triggers: [
                    "water stain on ceiling from ac", "ceiling leak hvac", "water coming through ceiling",
                    "ac in attic leaking", "ceiling wet from air handler", "brown spot on ceiling from ac"
                ],
                negativeTriggers: ["roof leak", "plumbing issue", "not from hvac"],
                quickReplies: [
                    "Ceiling leaks from HVAC can cause serious damage. Let's address this.",
                    "That sounds like a drain issue in your attic unit. We should look at this.",
                    "Water damage to ceilings is concerning. Let me help you.",
                    "If your AC is leaking through the ceiling, we need to act quickly.",
                    "Attic air handler leaks are common but need immediate attention."
                ],
                fullReplies: [
                    "If you have an air handler in your attic and you're seeing water stains or leaks on the ceiling, it's almost certainly a drain problem. The drain line may be clogged, or the emergency drain pan may have failed. This is important to address quickly because water damage to ceilings and insulation can get expensive fast. Let's get a technician out there.",
                    "Ceiling water stains from your HVAC system usually mean the condensate drain is blocked and water is overflowing. If you have an attic unit, this is especially common. The good news is it's usually a straightforward fix—clearing the drain and possibly treating it to prevent future clogs. But we should take care of it before more damage occurs.",
                    "Water coming through the ceiling from your AC is definitely urgent. It typically means the primary drain is clogged and the overflow pan is now full or leaking too. We need to clear the drain, check the pan, and make sure no damage has been done to your equipment. I'd recommend scheduling this as a priority call."
                ],
                actionHooks: ['flag_urgent', 'offer_scheduling'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.85
            }
        ]
    },
    {
        categoryId: 'cat-1764755375066',
        categoryName: 'Ice / Frozen Coil',
        scenarios: [
            {
                name: 'AC Unit Frozen / Ice on Coils',
                priority: 7,
                triggers: [
                    "ice on ac", "ac is frozen", "coils are iced over", "frozen evaporator",
                    "ice on refrigerant line", "ac freezing up", "frost on ac unit",
                    "indoor coil frozen", "ice building up on ac", "ac turned into ice block"
                ],
                negativeTriggers: ["ice maker", "refrigerator", "freezer"],
                quickReplies: [
                    "A frozen AC usually indicates a problem we need to diagnose.",
                    "Ice on your system is a sign something's not right.",
                    "Frozen coils are a common issue with a few possible causes.",
                    "Let's figure out why your AC is icing up.",
                    "Ice buildup needs attention to prevent damage to your system."
                ],
                fullReplies: [
                    "Ice forming on your AC is definitely not normal and could indicate a few problems: restricted airflow from a dirty filter, low refrigerant from a leak, or a failing blower motor. First thing to do is turn off the AC and let it thaw—running it frozen can damage the compressor. Have you checked your filter recently?",
                    "A frozen AC is trying to tell you something. The most common causes are airflow restriction (usually a dirty filter or blocked vents), low refrigerant charge (which means you probably have a leak), or blower problems. You should turn the system off and let it defrost. Then we should have a technician diagnose the root cause.",
                    "Ice on the coils or refrigerant lines is a symptom, not the actual problem. Something is causing the system to get too cold—either not enough air moving across the coils or not enough refrigerant. Running it while frozen can seriously damage the compressor. Turn it off, let it thaw, and let's get a technician to find the real issue."
                ],
                actionHooks: ['troubleshoot_first', 'offer_scheduling'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.75
            }
        ]
    },
    {
        categoryId: 'cat-1764755431658',
        categoryName: 'Bad Smell / Odor Issues',
        scenarios: [
            {
                name: 'Strange Smell From HVAC',
                priority: 7,
                triggers: [
                    "bad smell from ac", "hvac smells weird", "musty smell from vents",
                    "burning smell from furnace", "rotten egg smell", "moldy smell from ac",
                    "stinky air from vents", "foul odor from hvac", "smells like something died",
                    "chemical smell from ac", "sulfur smell"
                ],
                negativeTriggers: ["smell is gone", "was cooking", "candle"],
                quickReplies: [
                    "Certain smells can indicate important issues. Let's identify it.",
                    "Odors from your HVAC shouldn't be ignored.",
                    "Different smells mean different things. Can you describe it?",
                    "I want to make sure this isn't a safety concern. What does it smell like?",
                    "Let me help you figure out what's causing that smell."
                ],
                fullReplies: [
                    "HVAC odors can indicate various issues. A musty smell usually means mold or mildew in the system or ducts. A burning smell could be dust burning off after the system's been off, or it could indicate an electrical issue. A rotten egg or sulfur smell is serious—if you have gas appliances, that could be a gas leak and you should leave the house and call the gas company immediately. What does the smell remind you of?",
                    "The type of smell matters a lot. Musty or moldy odors typically mean there's moisture and possibly mold somewhere in the system or ductwork. An electrical or burning smell, especially if it persists, could mean a motor overheating or wiring issue. If you smell rotten eggs or gas, that's a potential emergency. Can you describe the smell more specifically?",
                    "I take odor complaints seriously because some can indicate safety issues. A sulfur or rotten egg smell with a gas furnace or appliance is a gas leak warning—get out and call the gas company. Musty smells usually mean mold, which affects air quality. Burning smells need investigation. What would you compare the smell to?"
                ],
                actionHooks: ['assess_safety', 'offer_scheduling'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.8
            },
            {
                name: 'Gas Smell Emergency',
                priority: 10,
                triggers: [
                    "smell gas", "gas leak smell", "rotten egg smell from furnace",
                    "sulfur smell near heater", "think there's a gas leak", "natural gas smell"
                ],
                negativeTriggers: ["not gas", "musty smell", "burning dust"],
                quickReplies: [
                    "If you smell gas, please leave the house immediately and call 911.",
                    "Gas smells are serious. Your safety comes first.",
                    "This could be a gas leak. Please get to safety right away.",
                    "Don't use any electrical switches. Leave and call the gas company.",
                    "Gas leaks are emergencies. Please evacuate and call emergency services."
                ],
                fullReplies: [
                    "IMPORTANT: If you smell gas, you should leave your home immediately without turning on or off any electrical switches, lights, or appliances. Don't use your phone inside the house. Once you're safely outside, call 911 or your gas company's emergency line. This is a safety emergency that takes priority over HVAC service.",
                    "A gas smell is a potential emergency. Please don't take any chances—leave the house right now, don't flip any switches or use anything electrical, and call 911 or your gas utility's emergency number from outside or a neighbor's house. Once the gas company clears the situation, we can help with any HVAC-related issues.",
                    "Your safety is the most important thing right now. If you're smelling gas, please evacuate your home immediately. Don't create any sparks—that means no light switches, no starting cars in the garage. Call emergency services from a safe distance. The gas company will come out for free to check for leaks. Once it's safe, give us a call back."
                ],
                actionHooks: ['flag_emergency', 'advise_evacuate'],
                handoffPolicy: 'always_on_keyword',
                contextWeight: 0.99
            }
        ]
    },
    {
        categoryId: 'cat-1764755666989',
        categoryName: 'Commercial Service Request',
        scenarios: [
            {
                name: 'Commercial HVAC Service Call',
                priority: 6,
                triggers: [
                    "commercial hvac service", "business ac repair", "office hvac problem",
                    "commercial building cooling", "rooftop unit service", "rtu repair",
                    "store hvac not working", "restaurant ac", "warehouse cooling",
                    "commercial maintenance", "business hvac"
                ],
                negativeTriggers: ["home ac", "residential", "my house"],
                quickReplies: [
                    "We service commercial HVAC systems. How can we help?",
                    "Commercial equipment is one of our specialties.",
                    "Business downtime is costly—let's get your system running.",
                    "We understand commercial needs are different. Let me help.",
                    "Our commercial team can handle your HVAC needs."
                ],
                fullReplies: [
                    "We absolutely service commercial HVAC equipment. Commercial systems have different demands—you can't just close up shop when the AC goes out. We understand the urgency and can usually prioritize commercial calls. Can you tell me about your equipment? Is it a rooftop unit, split system, or something else? And what's the issue you're experiencing?",
                    "Commercial HVAC is definitely something we handle. Whether it's rooftop units, split systems, or packaged equipment, our technicians are trained on commercial equipment. We know that keeping your business comfortable is critical for customers and employees. What type of building and equipment are we talking about?",
                    "We have a commercial service team that handles businesses just like yours. Restaurants, offices, retail stores, warehouses—we've seen it all. Commercial equipment often needs faster response times, and we prioritize those calls. Tell me about your situation and we'll get you taken care of."
                ],
                actionHooks: ['route_commercial', 'capture_business_info'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.7
            }
        ]
    },
    {
        categoryId: 'cat-1764755971979',
        categoryName: 'Previous Technician Follow-Up',
        scenarios: [
            {
                name: 'Follow-Up After Service',
                priority: 6,
                triggers: [
                    "technician was just here", "follow up on recent service", "same problem after repair",
                    "issue came back", "problem not fixed", "still having issues after service",
                    "need someone to come back", "return visit needed", "warranty on repair"
                ],
                negativeTriggers: ["new problem", "different issue", "never had service before"],
                quickReplies: [
                    "I'm sorry the issue persists. Let me help you with a follow-up.",
                    "We stand behind our work—let's get this resolved.",
                    "I apologize for the inconvenience. We'll take care of this.",
                    "If the repair didn't hold, we need to make it right.",
                    "Let me look into your recent service and get you scheduled."
                ],
                fullReplies: [
                    "I'm sorry to hear you're still having issues after our recent service. We definitely want to make this right. Our repairs come with a warranty, so if it's the same problem, we'll come back at no additional charge. Can you give me some details about what's happening and when we were last there?",
                    "We stand behind our work, and if something we repaired isn't working properly, we want to address it. Can you tell me what's happening now and when our technician was there? I'll pull up your service record and we'll get someone back out to resolve this.",
                    "I apologize that you're dealing with continued issues. Quality is important to us, and if our repair didn't solve the problem, we need to make it right. We have a warranty on our work, so let's get this scheduled for a follow-up visit at no extra charge."
                ],
                actionHooks: ['flag_callback', 'lookup_history', 'priority_schedule'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.75
            }
        ]
    },
    {
        categoryId: 'cat-1765022391681',
        categoryName: 'Booking',
        scenarios: [
            {
                name: 'Ready to Schedule Appointment',
                priority: 8,
                triggers: [
                    "schedule an appointment", "book a service call", "need someone to come out",
                    "want to schedule service", "set up an appointment", "book a technician",
                    "schedule a visit", "make an appointment", "book time"
                ],
                negativeTriggers: ["just asking questions", "not ready to book", "thinking about it"],
                quickReplies: [
                    "Great! Let me get you scheduled.",
                    "I'd be happy to book that for you.",
                    "Let's find a time that works for you.",
                    "Perfect—let's get you on the schedule.",
                    "Absolutely, let's set that up."
                ],
                fullReplies: [
                    "Perfect, let's get you scheduled! I'll need to get some information from you—your name, address, contact number, and the best time for someone to come out. We have morning and afternoon windows available. What day works best for you?",
                    "I'd be happy to book a service call for you. To get started, can you give me your name and the service address? Then we'll find a time that works with your schedule. Do you prefer mornings or afternoons?",
                    "Let's get that appointment set up. I'll need your name, address, phone number, and a brief description of what's going on with your system. Then we can pick a date and time that works for you. What's the best day?"
                ],
                actionHooks: ['start_booking', 'capture_contact_info', 'capture_address'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.85
            },
            {
                name: 'Reschedule or Cancel Appointment',
                priority: 7,
                triggers: [
                    "reschedule my appointment", "change my appointment time", "need to cancel",
                    "can't make my appointment", "move my service call", "different day please",
                    "change the date", "cancel service call"
                ],
                negativeTriggers: ["new appointment", "first time booking"],
                quickReplies: [
                    "I can help you reschedule or cancel.",
                    "No problem, let me pull up your appointment.",
                    "Let me find your booking and make that change.",
                    "I understand things come up. Let me help you.",
                    "I can adjust your appointment."
                ],
                fullReplies: [
                    "No problem, I can help you reschedule or cancel. Can you give me the name or phone number the appointment is under? I'll pull it up and we can make the change. What day or time would work better for you, or do you need to cancel entirely?",
                    "I understand—things come up. Let me find your appointment in the system. Can you tell me your name and the original appointment date? Then we'll get it rescheduled to a time that works better.",
                    "Of course, I can help with that. Give me the details of your current appointment and I'll look it up. We try to be flexible, so just let me know what change you need and we'll get it sorted out."
                ],
                actionHooks: ['lookup_appointment', 'reschedule'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.7
            }
        ]
    }
];

async function createScenario(categoryId, scenario) {
    const payload = buildScenarioPayload(scenario, categoryId);
    const url = `${API_BASE_URL}/api/admin/global-instant-responses/${TEMPLATE_ID}/categories/${categoryId}/scenarios`;
    
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${AUTH_TOKEN}`
        },
        body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
        const error = await response.text();
        throw new Error(`${response.status} - ${error}`);
    }
    
    return await response.json();
}

async function main() {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  RETRY FAILED SCENARIOS');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    if (!AUTH_TOKEN) {
        console.error('❌ AUTH_TOKEN required');
        process.exit(1);
    }
    
    let created = 0, failed = 0;
    
    for (const cat of FAILED_SCENARIOS) {
        console.log(`\n📂 ${cat.categoryName}`);
        for (const scenario of cat.scenarios) {
            try {
                console.log(`   └─ Creating: ${scenario.name}...`);
                await createScenario(cat.categoryId, scenario);
                console.log(`      ✅ Created (${scenario.triggers.length} triggers)`);
                created++;
                await new Promise(r => setTimeout(r, 200));
            } catch (e) {
                console.log(`      ❌ Failed: ${e.message}`);
                failed++;
            }
        }
    }
    
    console.log(`\n═══════════════════════════════════════════════════════════════`);
    console.log(`  Created: ${created}, Failed: ${failed}`);
    console.log(`═══════════════════════════════════════════════════════════════\n`);
}

main();

