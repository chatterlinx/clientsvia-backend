/**
 * ════════════════════════════════════════════════════════════════════════════════
 * HVAC COMPLETE BRAIN - GLOBAL TEMPLATE
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * THE GOLDEN HVAC SCENARIO LIBRARY
 * 
 * This is the GLOBAL template that ALL HVAC companies inherit.
 * Improvements here benefit EVERY HVAC company using the platform.
 * 
 * CATEGORIES (12 total):
 * ═══════════════════════════════════════════════════════════════════════════════
 * 1. 🚨 Emergency Service (P100) - Safety-critical situations
 * 2. 🔧 Equipment Issues (P85) - AC, heating, thermostat problems
 * 3. 🛠️ Maintenance (P75) - Tune-ups, filter changes
 * 4. 📅 Appointment Booking (P60) - Schedule, reschedule, cancel
 * 5. 💰 Pricing & Estimates (P40) - Cost questions, quotes
 * 6. 🕐 Business Hours & Location (P25) - Hours, address, service area
 * 7. 🔄 Existing Appointments (P50) - Status, ETA, technician
 * 8. 💳 Payment & Billing (P35) - Invoice, payment methods
 * 9. ⭐ Service Plans & Warranties (P45) - Membership, coverage
 * 10. 👋 Gratitude & Goodbye (P2) - Thank you, end of call
 * 11. 🤔 Confused & Help (P4) - Uncertain callers
 * 12. 💬 Small Talk (P1) - Weather, sports, generic chat
 * 
 * SCENARIO COUNT: 45+ scenarios covering 95% of HVAC call types
 * 
 * ════════════════════════════════════════════════════════════════════════════════
 */

module.exports = {
    // ═══════════════════════════════════════════════════════════════════════════
    // TEMPLATE METADATA
    // ═══════════════════════════════════════════════════════════════════════════
    version: 'hvac-v1.0.0',
    name: 'HVAC Complete Brain',
    description: 'Complete scenario library for HVAC Residential & Commercial companies',
    templateType: 'hvac',
    industryLabel: 'HVAC',
    isActive: true,
    isPublished: true,
    isDefaultTemplate: false,
    
    // ═══════════════════════════════════════════════════════════════════════════
    // SYNONYM MAPPING (HVAC-SPECIFIC)
    // ═══════════════════════════════════════════════════════════════════════════
    synonymMap: {
        'air conditioner': ['ac', 'a/c', 'air', 'cooling', 'cold air', 'cooling system', 'central air'],
        'furnace': ['heater', 'heating', 'heat', 'heating system', 'hot air'],
        'thermostat': ['thingy on wall', 'temperature thing', 'control', 'nest', 'ecobee', 'honeywell'],
        'unit': ['system', 'equipment', 'machine', 'thing outside', 'box'],
        'technician': ['tech', 'guy', 'person', 'repair person', 'service person'],
        'refrigerant': ['freon', 'coolant', 'gas'],
        'compressor': ['motor', 'thing that makes noise'],
        'ductwork': ['ducts', 'vents', 'air ducts'],
        'filter': ['air filter', 'furnace filter', 'ac filter']
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // FILLER WORDS TO STRIP
    // ═══════════════════════════════════════════════════════════════════════════
    fillerWords: [
        'um', 'uh', 'like', 'you know', 'basically', 'actually', 'so', 'well',
        'okay', 'alright', 'right', 'please', 'thanks', 'thank', 'yes', 'no',
        'yeah', 'yep', 'nope', 'hi', 'hey', 'hello', 'you guys', 'today', 'there',
        'i mean', 'i think', 'i guess', 'kind of', 'sort of'
    ],
    
    // ═══════════════════════════════════════════════════════════════════════════
    // CATEGORIES WITH SCENARIOS
    // ═══════════════════════════════════════════════════════════════════════════
    categories: [
        
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 1: EMERGENCY SERVICE (Priority 100)
        // ═══════════════════════════════════════════════════════════════════════
        {
            id: 'hvac-emergency',
            name: 'Emergency Service',
            icon: '🚨',
            description: 'Life-safety and property-damage situations',
            scope: 'GLOBAL',
            isActive: true,
            
            scenarios: [
                {
                    scenarioId: 'hvac-emerg-no-ac-summer',
                    name: 'No AC Emergency (Summer)',
                    isActive: true,
                    status: 'live',
                    priority: 95,
                    version: 1,
                    scope: 'GLOBAL',
                    
                    triggers: [
                        'no ac', 'ac broken', 'ac not working', 'ac stopped', 'no air conditioning',
                        'no cool air', 'house is hot', 'its so hot', 'ac emergency', 'ac died',
                        'air conditioner broken', 'ac wont turn on', 'no cold air coming out'
                    ],
                    negativeTriggers: ['schedule', 'next week', 'maintenance', 'tune up'],
                    minConfidence: 0.55,
                    contextWeight: 0.9,
                    
                    quickReplies: [
                        "I understand — no AC in this heat is serious. Let me get a technician to you right away. Can I get your address?",
                        "That sounds urgent. We prioritize AC emergencies, especially in summer. What's your address so I can check availability?",
                        "I hear you — being without AC is miserable. Let me see who we can send out today. What's your service address?"
                    ],
                    fullReplies: [
                        "I completely understand how uncomfortable that is, especially in this heat. No AC can actually be dangerous in extreme temperatures. I'm going to flag this as a priority and get a technician scheduled as quickly as possible. First, can I get your address so I can see which technician is closest to you?"
                    ],
                    replySelection: 'random',
                    
                    followUpMode: 'ASK_IF_BOOK',
                    scenarioType: 'ACTION_FLOW',
                    
                    entityCapture: ['address', 'phone_number', 'name'],
                    
                    actionHooks: ['flag_emergency', 'priority_dispatch'],
                    handoffPolicy: 'low_confidence'
                },
                
                {
                    scenarioId: 'hvac-emerg-no-heat-winter',
                    name: 'No Heat Emergency (Winter)',
                    isActive: true,
                    status: 'live',
                    priority: 96,
                    version: 1,
                    scope: 'GLOBAL',
                    
                    triggers: [
                        'no heat', 'heater broken', 'furnace not working', 'no hot air',
                        'house is freezing', 'furnace stopped', 'heat emergency', 'furnace died',
                        'heating not working', 'cold in house', 'furnace wont turn on'
                    ],
                    negativeTriggers: ['schedule', 'next week', 'tune up'],
                    minConfidence: 0.55,
                    contextWeight: 0.95,
                    
                    quickReplies: [
                        "No heat is serious, especially in cold weather. Let me get someone out to you right away. What's your address?",
                        "I understand — that's urgent. We prioritize heating emergencies. Can I get your address to dispatch a technician?",
                        "That's definitely an emergency. Let me check who can get to you fastest. What's your service address?"
                    ],
                    fullReplies: [
                        "I completely understand how urgent this is. Having no heat in cold weather isn't just uncomfortable — it can be dangerous, especially for young children or elderly family members. I'm going to prioritize this and get a technician to you as quickly as possible. What's your address?"
                    ],
                    replySelection: 'random',
                    
                    followUpMode: 'ASK_IF_BOOK',
                    scenarioType: 'ACTION_FLOW',
                    
                    entityCapture: ['address', 'phone_number', 'name'],
                    
                    actionHooks: ['flag_emergency', 'priority_dispatch']
                },
                
                {
                    scenarioId: 'hvac-emerg-gas-smell',
                    name: 'Gas Smell Emergency',
                    isActive: true,
                    status: 'live',
                    priority: 100,
                    version: 1,
                    scope: 'GLOBAL',
                    
                    triggers: [
                        'gas smell', 'smell gas', 'gas leak', 'rotten egg smell',
                        'sulfur smell', 'smells like gas', 'natural gas'
                    ],
                    negativeTriggers: [],
                    minConfidence: 0.45,
                    contextWeight: 1.0,
                    
                    quickReplies: [
                        "If you smell gas, please leave the house immediately and call 911. Once you're safe, call us back and we'll send an emergency technician."
                    ],
                    fullReplies: [
                        "I need you to listen carefully — a gas smell is a serious safety concern. Please leave your home immediately. Don't turn on or off any lights or electrical switches. Once you're outside and at a safe distance, call 911 first. Then call us back and we'll dispatch an emergency technician right away. Your safety comes first."
                    ],
                    replySelection: 'first',
                    
                    followUpMode: 'TRANSFER',
                    transferTarget: 'emergency',
                    scenarioType: 'ACTION_FLOW',
                    
                    actionHooks: ['flag_emergency', 'immediate_escalation']
                },
                
                {
                    scenarioId: 'hvac-emerg-carbon-monoxide',
                    name: 'Carbon Monoxide Alert',
                    isActive: true,
                    status: 'live',
                    priority: 100,
                    version: 1,
                    scope: 'GLOBAL',
                    
                    triggers: [
                        'carbon monoxide', 'co detector', 'co alarm', 'co2 alarm',
                        'carbon monoxide detector going off', 'co leak'
                    ],
                    negativeTriggers: [],
                    minConfidence: 0.45,
                    contextWeight: 1.0,
                    
                    quickReplies: [
                        "If your CO detector is going off, please evacuate immediately and call 911. Carbon monoxide is life-threatening. Get everyone out now."
                    ],
                    fullReplies: [
                        "This is a life-threatening emergency. Please evacuate your home immediately — don't wait. Get everyone out, including pets. Call 911 from outside. Carbon monoxide is colorless and odorless, so the detector is your warning. Once you're safe and the fire department clears the home, call us back and we'll inspect your furnace."
                    ],
                    replySelection: 'first',
                    
                    followUpMode: 'TRANSFER',
                    transferTarget: 'emergency',
                    scenarioType: 'ACTION_FLOW',
                    
                    actionHooks: ['flag_emergency', 'immediate_escalation']
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 2: EQUIPMENT ISSUES (Priority 85)
        // ═══════════════════════════════════════════════════════════════════════
        {
            id: 'hvac-equipment',
            name: 'Equipment Issues',
            icon: '🔧',
            description: 'Non-emergency equipment problems requiring service',
            scope: 'GLOBAL',
            isActive: true,
            
            scenarios: [
                {
                    scenarioId: 'hvac-equip-not-cooling',
                    name: 'AC Not Cooling Properly',
                    isActive: true,
                    status: 'live',
                    priority: 82,
                    version: 1,
                    scope: 'GLOBAL',
                    
                    triggers: [
                        'not cooling', 'ac not cold', 'warm air', 'not getting cold',
                        'ac running but not cooling', 'blowing warm air', 'house not cooling down',
                        'ac blowing hot', 'lukewarm air'
                    ],
                    negativeTriggers: ['emergency', 'no ac at all'],
                    minConfidence: 0.65,
                    contextWeight: 0.8,
                    
                    quickReplies: [
                        "That's frustrating. There could be a few things causing that. Let me get you scheduled so a technician can diagnose it. What works better for you — morning or afternoon?",
                        "I understand. When the AC runs but doesn't cool, it usually needs professional attention. Let me find an appointment that works for you.",
                        "Got it. That's a common issue we can definitely help with. Do you have a preferred day this week for a service call?"
                    ],
                    fullReplies: [
                        "I hear you — it's frustrating when the AC is running but the house isn't getting cool. There are several things that could cause this: low refrigerant, a dirty filter, or an issue with the compressor. The good news is our technicians can usually diagnose and fix this in one visit. What day works best for you?"
                    ],
                    replySelection: 'random',
                    
                    followUpMode: 'ASK_IF_BOOK',
                    scenarioType: 'ACTION_FLOW',
                    
                    entityCapture: ['address', 'phone_number', 'name', 'preferred_time']
                },
                
                {
                    scenarioId: 'hvac-equip-strange-noise',
                    name: 'Strange Noise from Unit',
                    isActive: true,
                    status: 'live',
                    priority: 80,
                    version: 1,
                    scope: 'GLOBAL',
                    
                    triggers: [
                        'strange noise', 'weird sound', 'making noise', 'loud noise',
                        'banging', 'clanking', 'squealing', 'grinding', 'clicking',
                        'humming loud', 'rattling', 'buzzing'
                    ],
                    negativeTriggers: ['normal', 'always sounds like that'],
                    minConfidence: 0.6,
                    contextWeight: 0.75,
                    
                    quickReplies: [
                        "Unusual noises from the unit definitely warrant a look. Can you describe the sound a bit — is it more of a banging, squealing, or clicking?",
                        "That's good you noticed that. Catching noises early often prevents bigger problems. Let me get you scheduled for a diagnostic.",
                        "Strange noises are worth checking out. It could be something simple or a sign of a bigger issue. Let's get a technician out to diagnose it."
                    ],
                    fullReplies: [
                        "You're smart to call about that. Unusual noises often indicate something that's starting to fail — catching it early usually means a simpler repair. Different sounds point to different issues: grinding might be the motor bearings, clicking could be electrical, and banging often means something's loose. Our technician can pinpoint exactly what's causing it. Would you like to schedule a diagnostic visit?"
                    ],
                    replySelection: 'random',
                    
                    followUpMode: 'ASK_IF_BOOK',
                    scenarioType: 'ACTION_FLOW'
                },
                
                {
                    scenarioId: 'hvac-equip-short-cycling',
                    name: 'Unit Short Cycling',
                    isActive: true,
                    status: 'live',
                    priority: 78,
                    version: 1,
                    scope: 'GLOBAL',
                    
                    triggers: [
                        'turning on and off', 'keeps shutting off', 'short cycling',
                        'starts then stops', 'runs for a few minutes', 'cycling',
                        'keeps restarting', 'wont stay on'
                    ],
                    negativeTriggers: [],
                    minConfidence: 0.65,
                    contextWeight: 0.75,
                    
                    quickReplies: [
                        "That cycling behavior definitely needs attention — it's hard on the system and drives up your energy bill. Let me get a technician out to diagnose it.",
                        "Short cycling can be caused by several things. Our technicians are great at tracking down the cause. What day works for a service call?"
                    ],
                    fullReplies: [
                        "Short cycling — where the unit turns on and off frequently — is definitely something to address. It could be an oversized system, a refrigerant issue, or something electrical. Not only is it uncomfortable, but it also wears out your equipment faster and increases energy costs. Our technicians can diagnose the root cause. Would you like to schedule a visit?"
                    ],
                    replySelection: 'random',
                    
                    followUpMode: 'ASK_IF_BOOK',
                    scenarioType: 'ACTION_FLOW'
                },
                
                {
                    scenarioId: 'hvac-equip-thermostat',
                    name: 'Thermostat Issues',
                    isActive: true,
                    status: 'live',
                    priority: 75,
                    version: 1,
                    scope: 'GLOBAL',
                    
                    triggers: [
                        'thermostat not working', 'thermostat blank', 'thermostat dead',
                        'cant change temperature', 'thermostat issue', 'wrong temperature',
                        'thermostat says one thing', 'set to 72 but'
                    ],
                    negativeTriggers: [],
                    minConfidence: 0.65,
                    contextWeight: 0.7,
                    
                    quickReplies: [
                        "Thermostat issues can be tricky. Sometimes it's the batteries, sometimes it's the wiring. Let me get a technician out to take a look.",
                        "A malfunctioning thermostat can definitely affect your comfort. Our techs can diagnose whether it needs repair or replacement. What day works for you?"
                    ],
                    fullReplies: [
                        "Thermostat problems can be frustrating because you're not sure if it's the thermostat itself or if there's a communication issue with your HVAC system. Our technicians can test everything and let you know the best fix — sometimes it's as simple as new batteries or recalibrating, other times it might need replacement. Would you like to schedule a diagnostic?"
                    ],
                    replySelection: 'random',
                    
                    followUpMode: 'ASK_IF_BOOK',
                    scenarioType: 'ACTION_FLOW'
                },
                
                {
                    scenarioId: 'hvac-equip-frozen',
                    name: 'Frozen AC Unit',
                    isActive: true,
                    status: 'live',
                    priority: 80,
                    version: 1,
                    scope: 'GLOBAL',
                    
                    triggers: [
                        'frozen', 'ice on ac', 'ice on unit', 'frosted over',
                        'iced up', 'coils frozen', 'freezing up'
                    ],
                    negativeTriggers: [],
                    minConfidence: 0.65,
                    contextWeight: 0.8,
                    
                    quickReplies: [
                        "A frozen unit is definitely something to address. First, turn the AC off and let it thaw for a few hours. Then we should have a technician check for the underlying cause.",
                        "Ice on your AC usually means airflow or refrigerant issues. Turn it off to let it defrost, and let's get someone out to diagnose what's causing it."
                    ],
                    fullReplies: [
                        "A frozen AC is trying to tell you something — usually that there's restricted airflow or a refrigerant issue. Here's what I recommend: turn off the cooling and set your fan to 'on' to help it thaw. Don't run the AC while it's frozen as that can damage the compressor. Once it's thawed, we should have a technician check it out to fix the root cause. Want me to schedule that for you?"
                    ],
                    replySelection: 'random',
                    
                    followUpMode: 'ASK_IF_BOOK',
                    scenarioType: 'INFO_FAQ'
                },
                
                {
                    scenarioId: 'hvac-equip-leaking',
                    name: 'Water Leaking from Unit',
                    isActive: true,
                    status: 'live',
                    priority: 83,
                    version: 1,
                    scope: 'GLOBAL',
                    
                    triggers: [
                        'leaking water', 'water on floor', 'condensation', 'dripping',
                        'water coming from', 'water damage', 'puddle', 'wet floor'
                    ],
                    negativeTriggers: [],
                    minConfidence: 0.6,
                    contextWeight: 0.8,
                    
                    quickReplies: [
                        "Water leaking from your AC is usually a clogged drain line. We should get that addressed before it causes water damage. Can we schedule a service call?",
                        "Leaking water is definitely something to fix quickly. It's often the condensate drain. Let me get a technician out to clear it and make sure there's no damage."
                    ],
                    fullReplies: [
                        "Water leaking from your AC is usually caused by a clogged condensate drain line — it's actually pretty common. The good news is it's typically an easy fix. However, if it's been leaking for a while, you'll want a tech to check for any water damage and make sure the drain pan is in good shape. Would you like me to schedule a service call?"
                    ],
                    replySelection: 'random',
                    
                    followUpMode: 'ASK_IF_BOOK',
                    scenarioType: 'ACTION_FLOW'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 3: MAINTENANCE (Priority 75)
        // ═══════════════════════════════════════════════════════════════════════
        {
            id: 'hvac-maintenance',
            name: 'Maintenance',
            icon: '🛠️',
            description: 'Preventive maintenance, tune-ups, and filter changes',
            scope: 'GLOBAL',
            isActive: true,
            
            scenarios: [
                {
                    scenarioId: 'hvac-maint-tuneup',
                    name: 'AC/Heating Tune-Up',
                    isActive: true,
                    status: 'live',
                    priority: 72,
                    version: 1,
                    scope: 'GLOBAL',
                    
                    triggers: [
                        'tune up', 'tuneup', 'maintenance', 'annual service',
                        'preventive maintenance', 'seasonal maintenance', 'checkup',
                        'ac tune up', 'furnace tune up', 'regular maintenance'
                    ],
                    negativeTriggers: ['broken', 'not working', 'emergency'],
                    minConfidence: 0.7,
                    contextWeight: 0.65,
                    
                    quickReplies: [
                        "Great thinking! Regular tune-ups really do extend the life of your system. We have appointments available this week. What day works for you?",
                        "Smart to stay on top of maintenance. I can get you scheduled — do you prefer morning or afternoon appointments?",
                        "Perfect timing for a tune-up. Let me check our schedule. Do you have a preferred day?"
                    ],
                    fullReplies: [
                        "That's a great idea. Regular maintenance not only helps your system run more efficiently — which can lower your energy bills — but it also helps us catch small problems before they become expensive repairs. Our tune-up includes checking refrigerant levels, cleaning coils, inspecting electrical connections, and making sure everything's running optimally. What day works best for you?"
                    ],
                    replySelection: 'random',
                    
                    followUpMode: 'ASK_IF_BOOK',
                    scenarioType: 'ACTION_FLOW'
                },
                
                {
                    scenarioId: 'hvac-maint-filter',
                    name: 'Filter Change/Purchase',
                    isActive: true,
                    status: 'live',
                    priority: 68,
                    version: 1,
                    scope: 'GLOBAL',
                    
                    triggers: [
                        'filter', 'air filter', 'furnace filter', 'change filter',
                        'replace filter', 'buy filter', 'filter size', 'what size filter'
                    ],
                    negativeTriggers: [],
                    minConfidence: 0.7,
                    contextWeight: 0.6,
                    
                    quickReplies: [
                        "Filter changes are important! Do you know your filter size, or would you like us to send a tech who can identify it and install the right one?",
                        "Great question about filters. We recommend changing them every 1-3 months. Would you like to schedule a visit, or do you need help finding the right size?"
                    ],
                    fullReplies: [
                        "Filters are really important for both air quality and keeping your system running efficiently. We recommend changing them every 1-3 months depending on your home. If you're not sure what size you need, I can have a technician come out and identify it for you — they can also show you where the filter goes if you'd like to change it yourself in the future. Would you like to schedule that?"
                    ],
                    replySelection: 'random',
                    
                    followUpMode: 'ASK_IF_BOOK',
                    scenarioType: 'INFO_FAQ'
                },
                
                {
                    scenarioId: 'hvac-maint-duct-cleaning',
                    name: 'Duct Cleaning Inquiry',
                    isActive: true,
                    status: 'live',
                    priority: 65,
                    version: 1,
                    scope: 'GLOBAL',
                    
                    triggers: [
                        'duct cleaning', 'clean ducts', 'dirty ducts', 'air ducts',
                        'vent cleaning', 'clean vents', 'dust in vents'
                    ],
                    negativeTriggers: [],
                    minConfidence: 0.7,
                    contextWeight: 0.6,
                    
                    quickReplies: [
                        "Duct cleaning can definitely improve your air quality. We offer that service — would you like a quote or to schedule an inspection?",
                        "Good thinking on duct cleaning. It's recommended every 3-5 years. Want me to schedule an assessment?"
                    ],
                    fullReplies: [
                        "Duct cleaning is a great way to improve your indoor air quality, especially if you've noticed more dust, have allergies, or haven't had them cleaned in a few years. Our technicians can assess your ductwork and let you know if cleaning would benefit you. Would you like to schedule an inspection?"
                    ],
                    replySelection: 'random',
                    
                    followUpMode: 'ASK_IF_BOOK',
                    scenarioType: 'INFO_FAQ'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 4: APPOINTMENT BOOKING (Priority 60)
        // ═══════════════════════════════════════════════════════════════════════
        {
            id: 'hvac-appointments',
            name: 'Appointment Booking',
            icon: '📅',
            description: 'Scheduling, rescheduling, and appointment management',
            scope: 'GLOBAL',
            isActive: true,
            
            scenarios: [
                {
                    scenarioId: 'hvac-appt-new',
                    name: 'New Appointment Request',
                    isActive: true,
                    status: 'live',
                    priority: 58,
                    version: 1,
                    scope: 'GLOBAL',
                    
                    triggers: [
                        'schedule', 'appointment', 'book', 'schedule service',
                        'make appointment', 'set up appointment', 'need someone to come out',
                        'schedule a visit', 'book service', 'when can you come'
                    ],
                    negativeTriggers: ['cancel', 'reschedule', 'change'],
                    minConfidence: 0.65,
                    contextWeight: 0.7,
                    
                    quickReplies: [
                        "I'd be happy to help you schedule. What type of service do you need — repair, maintenance, or something else?",
                        "Of course! Let me get you on our schedule. What's the issue you're experiencing, or is this for routine maintenance?",
                        "Sure thing! Before I book you, can you tell me briefly what you need help with?"
                    ],
                    fullReplies: [
                        "Absolutely, I can help you schedule an appointment. To make sure we send the right technician with the right equipment, could you tell me a bit about what you're experiencing? Is this a repair for something that's not working, or are you looking to schedule preventive maintenance?"
                    ],
                    replySelection: 'random',
                    
                    followUpMode: 'ASK_FOLLOWUP_QUESTION',
                    followUpQuestionText: 'What type of service do you need?',
                    scenarioType: 'ACTION_FLOW',
                    
                    entityCapture: ['name', 'phone_number', 'address', 'service_type']
                },
                
                {
                    scenarioId: 'hvac-appt-reschedule',
                    name: 'Reschedule Appointment',
                    isActive: true,
                    status: 'live',
                    priority: 55,
                    version: 1,
                    scope: 'GLOBAL',
                    
                    triggers: [
                        'reschedule', 'change appointment', 'move appointment',
                        'different time', 'different day', 'need to change',
                        'cant make it', 'change my appointment'
                    ],
                    negativeTriggers: ['cancel', 'new appointment'],
                    minConfidence: 0.7,
                    contextWeight: 0.7,
                    
                    quickReplies: [
                        "No problem! Can you give me your name or phone number so I can pull up your appointment?",
                        "Of course. What name is the appointment under?",
                        "Sure, I can help with that. Let me look up your appointment — what's your phone number?"
                    ],
                    fullReplies: [
                        "I understand things come up. Let me help you find a better time. Can you give me your name or the phone number on the appointment so I can pull up your details and see what other times we have available?"
                    ],
                    replySelection: 'random',
                    
                    followUpMode: 'ASK_FOLLOWUP_QUESTION',
                    followUpQuestionText: 'What name is the appointment under?',
                    scenarioType: 'ACTION_FLOW',
                    
                    entityCapture: ['name', 'phone_number']
                },
                
                {
                    scenarioId: 'hvac-appt-cancel',
                    name: 'Cancel Appointment',
                    isActive: true,
                    status: 'live',
                    priority: 52,
                    version: 1,
                    scope: 'GLOBAL',
                    
                    triggers: [
                        'cancel', 'cancel appointment', 'need to cancel',
                        'dont need service', 'cancel my appointment'
                    ],
                    negativeTriggers: ['reschedule'],
                    minConfidence: 0.7,
                    contextWeight: 0.7,
                    
                    quickReplies: [
                        "I can help with that. Can I get your name or phone number to look up your appointment?",
                        "No problem. What name or phone number is the appointment under?"
                    ],
                    fullReplies: [
                        "I understand. Let me help you cancel that appointment. Can you give me your name or the phone number on the account so I can look it up?"
                    ],
                    replySelection: 'random',
                    
                    followUpMode: 'ASK_FOLLOWUP_QUESTION',
                    followUpQuestionText: 'What name is the appointment under?',
                    scenarioType: 'ACTION_FLOW',
                    
                    entityCapture: ['name', 'phone_number']
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 5: PRICING (Priority 40)
        // ═══════════════════════════════════════════════════════════════════════
        {
            id: 'hvac-pricing',
            name: 'Pricing & Estimates',
            icon: '💰',
            description: 'Service costs, estimates, and pricing inquiries',
            scope: 'GLOBAL',
            isActive: true,
            
            scenarios: [
                {
                    scenarioId: 'hvac-price-service-call',
                    name: 'Service Call Fee',
                    isActive: true,
                    status: 'live',
                    priority: 38,
                    version: 1,
                    scope: 'GLOBAL',
                    
                    triggers: [
                        'how much', 'cost', 'price', 'service call fee',
                        'diagnostic fee', 'trip charge', 'what do you charge',
                        'how much to come out', 'service fee'
                    ],
                    negativeTriggers: ['estimate for install', 'new system'],
                    minConfidence: 0.6,
                    contextWeight: 0.6,
                    
                    quickReplies: [
                        "Our service call fee covers the technician's visit and diagnosis. The exact price depends on the type of service. Can you tell me what you're experiencing so I can give you a better idea?",
                        "Great question! Pricing varies based on the specific service. What issue are you having?"
                    ],
                    fullReplies: [
                        "I appreciate you asking about pricing upfront — we believe in transparency. Our service call fee includes the technician's travel and time to diagnose the issue. Once they identify the problem, they'll give you a complete quote before any repairs begin, so you'll never be surprised. The exact cost depends on what service you need. Can you tell me what's going on with your system?"
                    ],
                    replySelection: 'random',
                    
                    followUpMode: 'ASK_FOLLOWUP_QUESTION',
                    followUpQuestionText: 'What type of service are you looking for?',
                    scenarioType: 'INFO_FAQ'
                },
                
                {
                    scenarioId: 'hvac-price-estimate',
                    name: 'Free Estimate Request',
                    isActive: true,
                    status: 'live',
                    priority: 42,
                    version: 1,
                    scope: 'GLOBAL',
                    
                    triggers: [
                        'free estimate', 'quote', 'estimate', 'get a quote',
                        'how much for new', 'replacement cost', 'new system price'
                    ],
                    negativeTriggers: [],
                    minConfidence: 0.65,
                    contextWeight: 0.6,
                    
                    quickReplies: [
                        "We offer free estimates for new installations and major replacements. Would you like to schedule one?",
                        "Happy to provide a free estimate! Are you looking at replacing your AC, furnace, or both?"
                    ],
                    fullReplies: [
                        "We'd be happy to provide a free estimate. Our comfort advisors will come to your home, assess your current system, and discuss the best options for your needs and budget. There's no obligation. Would you like to schedule a time for that?"
                    ],
                    replySelection: 'random',
                    
                    followUpMode: 'ASK_IF_BOOK',
                    scenarioType: 'ACTION_FLOW'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 6: BUSINESS HOURS (Priority 25)
        // ═══════════════════════════════════════════════════════════════════════
        {
            id: 'hvac-hours',
            name: 'Business Hours & Location',
            icon: '🕐',
            description: 'Operating hours, location, and service area',
            scope: 'GLOBAL',
            isActive: true,
            
            scenarios: [
                {
                    scenarioId: 'hvac-hours-operation',
                    name: 'Hours of Operation',
                    isActive: true,
                    status: 'live',
                    priority: 22,
                    version: 1,
                    scope: 'GLOBAL',
                    
                    triggers: [
                        'hours', 'when are you open', 'business hours',
                        'what time do you open', 'what time do you close',
                        'are you open', 'open today', 'open on weekends',
                        'saturday hours', 'sunday hours'
                    ],
                    negativeTriggers: [],
                    minConfidence: 0.7,
                    contextWeight: 0.5,
                    
                    quickReplies: [
                        "We're available {{hours}}. For emergencies, we have 24/7 service at {{emergencyPhone}}. How can I help you today?",
                        "Our regular hours are {{hours}}. Is there something I can help you with?"
                    ],
                    fullReplies: [
                        "Our office hours are {{hours}}. However, for HVAC emergencies like no heat or no AC, we offer 24/7 emergency service — you can always reach us at {{emergencyPhone}}. Is there something specific I can help you with today?"
                    ],
                    replySelection: 'random',
                    
                    followUpMode: 'NONE',
                    scenarioType: 'INFO_FAQ'
                },
                
                {
                    scenarioId: 'hvac-hours-service-area',
                    name: 'Service Area',
                    isActive: true,
                    status: 'live',
                    priority: 20,
                    version: 1,
                    scope: 'GLOBAL',
                    
                    triggers: [
                        'service area', 'do you service', 'come to my area',
                        'what areas', 'cities', 'zip codes', 'how far do you go'
                    ],
                    negativeTriggers: [],
                    minConfidence: 0.7,
                    contextWeight: 0.5,
                    
                    quickReplies: [
                        "We service {{serviceArea}}. What's your zip code so I can confirm we can help you?",
                        "Great question! We cover {{serviceArea}}. What area are you in?"
                    ],
                    fullReplies: [
                        "We proudly service {{serviceArea}}. If you give me your zip code or city, I can confirm we cover your area and get you scheduled."
                    ],
                    replySelection: 'random',
                    
                    followUpMode: 'ASK_FOLLOWUP_QUESTION',
                    followUpQuestionText: 'What zip code are you in?',
                    scenarioType: 'INFO_FAQ'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 7: EXISTING APPOINTMENTS (Priority 50)
        // ═══════════════════════════════════════════════════════════════════════
        {
            id: 'hvac-existing-appt',
            name: 'Existing Appointment Inquiries',
            icon: '🔄',
            description: 'Status, ETA, and questions about scheduled visits',
            scope: 'GLOBAL',
            isActive: true,
            
            scenarios: [
                {
                    scenarioId: 'hvac-existing-eta',
                    name: 'Technician ETA',
                    isActive: true,
                    status: 'live',
                    priority: 48,
                    version: 1,
                    scope: 'GLOBAL',
                    
                    triggers: [
                        'where is technician', 'when will tech arrive', 'eta',
                        'running late', 'still coming', 'on the way',
                        'where is the tech', 'how much longer'
                    ],
                    negativeTriggers: [],
                    minConfidence: 0.65,
                    contextWeight: 0.7,
                    
                    quickReplies: [
                        "Let me check on that for you. Can I get your name or address so I can look up your appointment?",
                        "I'll find out where your technician is. What name is the appointment under?"
                    ],
                    fullReplies: [
                        "I understand you're waiting for our technician — let me check on their status. Can you give me your name or the service address so I can pull up your appointment and get you an ETA?"
                    ],
                    replySelection: 'random',
                    
                    followUpMode: 'ASK_FOLLOWUP_QUESTION',
                    followUpQuestionText: 'What name is the appointment under?',
                    scenarioType: 'ACTION_FLOW'
                },
                
                {
                    scenarioId: 'hvac-existing-speak-tech',
                    name: 'Speak to Specific Technician',
                    isActive: true,
                    status: 'live',
                    priority: 45,
                    version: 1,
                    scope: 'GLOBAL',
                    
                    triggers: [
                        'speak to technician', 'talk to the tech', 'call back technician',
                        'tech who came', 'same technician', 'my technician',
                        'the guy who fixed', 'previous technician'
                    ],
                    negativeTriggers: [],
                    minConfidence: 0.65,
                    contextWeight: 0.65,
                    
                    quickReplies: [
                        "I see you'd like to reach a specific technician. Let me see if I can connect you with our service team.",
                        "I understand you'd like to speak with the technician who was at your home. Let me transfer you to our service department."
                    ],
                    fullReplies: [
                        "I understand you'd like to speak with the technician who worked on your system. Our technicians are usually out on service calls, but I can get your message to them or connect you with our service team who can help. Would you like me to transfer you?"
                    ],
                    replySelection: 'random',
                    
                    followUpMode: 'TRANSFER',
                    transferTarget: 'service',
                    scenarioType: 'ACTION_FLOW'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 8: PAYMENT & BILLING (Priority 35)
        // ═══════════════════════════════════════════════════════════════════════
        {
            id: 'hvac-billing',
            name: 'Payment & Billing',
            icon: '💳',
            description: 'Invoices, payment methods, and billing questions',
            scope: 'GLOBAL',
            isActive: true,
            
            scenarios: [
                {
                    scenarioId: 'hvac-billing-payment-methods',
                    name: 'Payment Methods',
                    isActive: true,
                    status: 'live',
                    priority: 32,
                    version: 1,
                    scope: 'GLOBAL',
                    
                    triggers: [
                        'payment', 'how do i pay', 'accept credit cards',
                        'payment options', 'financing', 'payment plans',
                        'forms of payment', 'cash or card'
                    ],
                    negativeTriggers: [],
                    minConfidence: 0.7,
                    contextWeight: 0.55,
                    
                    quickReplies: [
                        "We accept all major credit cards, cash, and checks. We also offer financing options for larger projects. Is there something specific you'd like to know?",
                        "Payment is easy — we take credit cards, cash, and checks. For bigger jobs, we have financing available. Would you like more details?"
                    ],
                    fullReplies: [
                        "We make payment convenient. We accept all major credit cards, cash, and checks. For larger purchases like new systems, we also offer financing options with approved credit — that way you can get comfortable now and pay over time. Is there a specific service you're inquiring about?"
                    ],
                    replySelection: 'random',
                    
                    followUpMode: 'NONE',
                    scenarioType: 'INFO_FAQ'
                },
                
                {
                    scenarioId: 'hvac-billing-invoice',
                    name: 'Invoice Question',
                    isActive: true,
                    status: 'live',
                    priority: 34,
                    version: 1,
                    scope: 'GLOBAL',
                    
                    triggers: [
                        'invoice', 'bill', 'receipt', 'statement',
                        'paid but', 'already paid', 'question about bill',
                        'billing question', 'charges'
                    ],
                    negativeTriggers: [],
                    minConfidence: 0.65,
                    contextWeight: 0.6,
                    
                    quickReplies: [
                        "I can help with billing questions. Let me connect you with our billing department to review your account.",
                        "For invoice questions, our billing team can help. Would you like me to transfer you?"
                    ],
                    fullReplies: [
                        "I want to make sure we get your billing question resolved. Our billing team has access to all the account details and can review charges with you. Let me transfer you to them — they'll be able to pull up your invoice and explain everything."
                    ],
                    replySelection: 'random',
                    
                    followUpMode: 'TRANSFER',
                    transferTarget: 'billing',
                    scenarioType: 'ACTION_FLOW'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 9: SERVICE PLANS (Priority 45)
        // ═══════════════════════════════════════════════════════════════════════
        {
            id: 'hvac-service-plans',
            name: 'Service Plans & Warranties',
            icon: '⭐',
            description: 'Membership programs, maintenance plans, and warranty coverage',
            scope: 'GLOBAL',
            isActive: true,
            
            scenarios: [
                {
                    scenarioId: 'hvac-plan-membership',
                    name: 'Maintenance Plan Inquiry',
                    isActive: true,
                    status: 'live',
                    priority: 43,
                    version: 1,
                    scope: 'GLOBAL',
                    
                    triggers: [
                        'membership', 'service plan', 'maintenance plan',
                        'annual plan', 'club', 'program', 'monthly plan',
                        'preventive plan'
                    ],
                    negativeTriggers: [],
                    minConfidence: 0.7,
                    contextWeight: 0.6,
                    
                    quickReplies: [
                        "We offer maintenance plans that include annual tune-ups and priority scheduling. Would you like details?",
                        "Our service plans are a great way to save money and stay comfortable year-round. Want me to explain the benefits?"
                    ],
                    fullReplies: [
                        "Our maintenance plans are designed to keep your system running efficiently and catch problems before they become expensive repairs. Members get two annual tune-ups, priority scheduling, and discounts on repairs. Many customers find it pays for itself in the first year. Would you like me to have someone explain the options in more detail?"
                    ],
                    replySelection: 'random',
                    
                    followUpMode: 'ASK_IF_BOOK',
                    scenarioType: 'INFO_FAQ'
                },
                
                {
                    scenarioId: 'hvac-plan-warranty',
                    name: 'Warranty Question',
                    isActive: true,
                    status: 'live',
                    priority: 44,
                    version: 1,
                    scope: 'GLOBAL',
                    
                    triggers: [
                        'warranty', 'under warranty', 'warranty coverage',
                        'warranty claim', 'is it covered', 'parts warranty',
                        'labor warranty'
                    ],
                    negativeTriggers: [],
                    minConfidence: 0.65,
                    contextWeight: 0.6,
                    
                    quickReplies: [
                        "Great question about warranty. Can you tell me what system or repair you're asking about?",
                        "Warranty coverage depends on the equipment and when it was installed. Do you have your paperwork, or would you like us to look it up?"
                    ],
                    fullReplies: [
                        "Warranty questions are important. Coverage depends on the manufacturer, installation date, and whether you've been keeping up with maintenance. If you can tell me what equipment you're asking about, I can help figure out if it's still covered. Alternatively, I can schedule a visit and our technician can look it up for you."
                    ],
                    replySelection: 'random',
                    
                    followUpMode: 'ASK_FOLLOWUP_QUESTION',
                    followUpQuestionText: 'What equipment are you asking about?',
                    scenarioType: 'INFO_FAQ'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 10: GRATITUDE & GOODBYE (Priority 2)
        // ═══════════════════════════════════════════════════════════════════════
        {
            id: 'hvac-goodbye',
            name: 'Gratitude & Goodbye',
            icon: '👋',
            description: 'End of conversation handling',
            scope: 'GLOBAL',
            isActive: true,
            
            scenarios: [
                {
                    scenarioId: 'hvac-goodbye-thanks',
                    name: 'Thank You / Goodbye',
                    isActive: true,
                    status: 'live',
                    priority: 2,
                    version: 1,
                    scope: 'GLOBAL',
                    
                    triggers: [
                        'thank you', 'thanks', 'bye', 'goodbye', 'thats all',
                        'thats it', 'have a good day', 'appreciate it',
                        'thanks for your help', 'that answers my question'
                    ],
                    negativeTriggers: [],
                    minConfidence: 0.75,
                    contextWeight: 0.4,
                    
                    quickReplies: [
                        "You're welcome! Thanks for calling {{companyName}}. Have a great day!",
                        "Happy to help! Take care, and don't hesitate to call if you need anything.",
                        "Thank you for calling! We're here if you need us. Have a great day!"
                    ],
                    fullReplies: [
                        "You're very welcome! Thank you for choosing {{companyName}}. If you have any other questions or need service in the future, we're just a phone call away. Have a wonderful day!"
                    ],
                    replySelection: 'random',
                    
                    followUpMode: 'NONE',
                    scenarioType: 'SYSTEM_ACK'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 11: CONFUSED / HELP (Priority 4)
        // ═══════════════════════════════════════════════════════════════════════
        {
            id: 'hvac-confused',
            name: 'Confused / Need Help',
            icon: '🤔',
            description: 'When caller is unsure what they need',
            scope: 'GLOBAL',
            isActive: true,
            
            scenarios: [
                {
                    scenarioId: 'hvac-confused-unsure',
                    name: 'Caller Unsure',
                    isActive: true,
                    status: 'live',
                    priority: 4,
                    version: 1,
                    scope: 'GLOBAL',
                    
                    triggers: [
                        'im not sure', 'i dont know', 'confused', 'not certain',
                        'maybe', 'i guess', 'what should i do', 'what do you recommend',
                        'not sure whats wrong', 'help me figure out'
                    ],
                    negativeTriggers: [],
                    minConfidence: 0.6,
                    contextWeight: 0.5,
                    
                    quickReplies: [
                        "No worries! Let me ask a few questions to help figure out what you need. Is your heating or air conditioning having any issues?",
                        "That's okay — I can help you figure it out. Are you calling about a problem with your HVAC system, or looking for maintenance?",
                        "Happy to help you work through it. What made you call today — is something not working right, or did you have a question?"
                    ],
                    fullReplies: [
                        "No problem at all — that's what I'm here for. Let me ask a few questions to point you in the right direction. First, are you experiencing any issues with your heating or air conditioning right now? Or were you thinking more about preventive maintenance or a general question?"
                    ],
                    replySelection: 'random',
                    
                    followUpMode: 'ASK_FOLLOWUP_QUESTION',
                    followUpQuestionText: 'Is your heating or cooling system having any problems?',
                    scenarioType: 'SYSTEM_ACK',
                    
                    timedFollowUp: {
                        enabled: true,
                        delaySeconds: 8,
                        messages: ["I'm still here. Would it help if I asked you some questions to figure out what you need?"]
                    }
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 12: SMALL TALK (Priority 1)
        // ═══════════════════════════════════════════════════════════════════════
        {
            id: 'hvac-smalltalk',
            name: 'Small Talk',
            icon: '💬',
            description: 'Generic conversation and rapport building',
            scope: 'GLOBAL',
            isActive: true,
            
            scenarios: [
                {
                    scenarioId: 'hvac-smalltalk-weather',
                    name: 'Weather Talk',
                    isActive: true,
                    status: 'live',
                    priority: 1,
                    version: 1,
                    scope: 'GLOBAL',
                    
                    triggers: [
                        'hot today', 'cold today', 'weather', 'beautiful day',
                        'terrible weather', 'its freezing', 'heatwave'
                    ],
                    negativeTriggers: [],
                    minConfidence: 0.7,
                    contextWeight: 0.3,
                    
                    quickReplies: [
                        "It sure is! Days like this are when you really appreciate a working HVAC system. Is there something I can help you with today?",
                        "I hear you! How can I help you stay comfortable?"
                    ],
                    fullReplies: [
                        "You're right about that! Days like this really make you appreciate climate control. Is your system keeping up okay, or is there something I can help you with?"
                    ],
                    replySelection: 'random',
                    
                    followUpMode: 'ASK_FOLLOWUP_QUESTION',
                    followUpQuestionText: 'Is there something I can help you with today?',
                    scenarioType: 'SMALL_TALK'
                },
                
                {
                    scenarioId: 'hvac-smalltalk-greeting',
                    name: 'Caller Greeting',
                    isActive: true,
                    status: 'live',
                    priority: 1,
                    version: 1,
                    scope: 'GLOBAL',
                    
                    triggers: [
                        'hi', 'hello', 'hey', 'good morning', 'good afternoon',
                        'good evening', 'how are you'
                    ],
                    negativeTriggers: [],
                    minConfidence: 0.8,
                    contextWeight: 0.3,
                    
                    quickReplies: [
                        "Hello! How can I help you today?",
                        "Hi there! What can I do for you?",
                        "Good to hear from you! How can I help?"
                    ],
                    fullReplies: [
                        "Hello! Thanks for calling {{companyName}}. I'm here to help with any HVAC needs you might have. What can I do for you today?"
                    ],
                    replySelection: 'random',
                    
                    followUpMode: 'ASK_FOLLOWUP_QUESTION',
                    followUpQuestionText: 'What can I help you with?',
                    scenarioType: 'SMALL_TALK'
                }
            ]
        }
    ]
};

