/**
 * ============================================================================
 * HVAC SCENARIOS - Sales, Estimates & Commercial Categories
 * ============================================================================
 * Part 4: New system quotes, commercial services, IAQ
 */

const TEMPLATE_ID = '68fb535130d19aec696d8123';

const CATEGORIES = {
    newSystemEstimate: {
        id: 'cat-1764755563321',
        name: 'New System Estimate / Replacement Quote',
        scenarios: [
            {
                name: 'New AC/Heating System Quote',
                priority: 5,
                triggers: [
                    "need a new ac unit", "get a quote for new system", "how much for new hvac",
                    "replace my air conditioner", "new furnace cost", "system replacement estimate",
                    "pricing on new unit", "want to upgrade my system", "ac replacement cost",
                    "need estimate for new hvac", "shopping for new system", "new heat pump price"
                ],
                negativeTriggers: [
                    "repair estimate", "just need service", "maintenance"
                ],
                quickReplies: [
                    "I'd be happy to help you explore new system options.",
                    "New systems are an investment—let's find the right fit for you.",
                    "We can schedule a free estimate for a new system.",
                    "There are several factors that determine the right system for your home.",
                    "A comfort advisor can give you personalized options and pricing."
                ],
                fullReplies: [
                    "Great! Getting a new system estimate involves a home visit where we assess your space, discuss your comfort goals, and recommend equipment that fits your needs and budget. This consultation is typically free and there's no obligation. The advisor can also explain financing options if that's helpful. Would you like to schedule a visit?",
                    "New HVAC systems vary quite a bit in price depending on the size of your home, the type of equipment, efficiency ratings, and features you want. Rather than give you a number that might not apply to your situation, we'd like to have a comfort advisor come out, do a proper assessment, and provide accurate options. Sound good?",
                    "Investing in a new system is a big decision, and we want to make sure you get the right equipment at a fair price. We offer free in-home estimates where we measure your home, assess your ductwork, discuss any comfort issues you've had, and provide options at different price points. There's no pressure to buy. Would you like to set that up?"
                ],
                actionHooks: ['schedule_estimate', 'assign_sales'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.5
            },
            {
                name: 'System Age / When to Replace',
                priority: 4,
                triggers: [
                    "how old is too old for ac", "when should I replace my system",
                    "my system is 15 years old", "old hvac should I replace", "lifespan of ac unit",
                    "how long do furnaces last", "is my system too old", "system at end of life"
                ],
                negativeTriggers: [
                    "new system", "just installed", "brand new"
                ],
                quickReplies: [
                    "Age is one factor—let me give you some guidelines.",
                    "System lifespan depends on several factors.",
                    "I can help you decide whether repair or replacement makes sense.",
                    "Knowing when to replace is an important decision.",
                    "Let me give you some information to help you decide."
                ],
                fullReplies: [
                    "Generally, AC systems last 15-20 years and furnaces can last 20-30 years with good maintenance. But age isn't the only factor—how well it's been maintained, how often it runs, and repair history all matter. If your system is 12-15+ years old and needs a major repair, it often makes more financial sense to replace than repair. We can help you evaluate your specific situation.",
                    "The lifespan question depends on the equipment type and maintenance history. Heat pumps typically last 10-15 years, AC units 15-20, and furnaces 20-30. However, efficiency drops as systems age, so even a working older system might cost more to operate than a new one. If you're experiencing frequent repairs or high bills, it might be time to consider replacement.",
                    "Great question! While there's no magic number, here are some signs it might be time: the system is over 15 years old, repairs are becoming frequent, energy bills keep climbing, or it struggles to keep your home comfortable. If you're facing a repair that costs more than half what a new system would cost, replacement usually makes more sense. Want us to take a look at your system?"
                ],
                actionHooks: ['offer_assessment', 'schedule_estimate'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.45
            }
        ]
    },

    indoorAirQuality: {
        id: 'cat-1764755636314',
        name: 'Indoor Air Quality (IAQ) / Filters / UV Lights',
        scenarios: [
            {
                name: 'Indoor Air Quality Concerns',
                priority: 5,
                triggers: [
                    "indoor air quality", "air quality in my home", "iaq solutions",
                    "air purifier for hvac", "whole house air cleaner", "uv light for ac",
                    "better air filtration", "allergies from hvac", "air quality improvement",
                    "hepa filter for hvac", "dust everywhere", "pollen in house"
                ],
                negativeTriggers: [
                    "outdoor air", "car air quality", "industrial"
                ],
                quickReplies: [
                    "Indoor air quality is so important. Let me help you improve it.",
                    "We have several solutions for cleaner indoor air.",
                    "Better air quality can really improve your comfort and health.",
                    "There are great options for whole-home air purification.",
                    "Let's discuss what might work best for your needs."
                ],
                fullReplies: [
                    "Indoor air quality solutions can make a big difference, especially for those with allergies, asthma, or other sensitivities. Options include upgraded filters, whole-house air purifiers, UV lights that kill airborne germs, and humidity control. The right solution depends on your specific concerns—dust, allergens, germs, or odors. What's your main concern?",
                    "We offer several IAQ solutions. For particles like dust and pollen, a better filter or media air cleaner works great. For germs and mold, UV lights installed in your system can help. For overall air quality, whole-house purifiers with HEPA and carbon filtration are excellent. We can recommend the best approach based on your home and concerns.",
                    "The air inside your home can be 2-5 times more polluted than outdoor air, so addressing IAQ is smart. We can install air cleaners, UV germicidal lights, or upgraded filtration to target whatever concerns you most—whether that's allergens, bacteria, viruses, or odors. Would you like to discuss options?"
                ],
                actionHooks: ['discuss_iaq_options', 'offer_assessment'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.5
            }
        ]
    },

    commercialService: {
        id: 'cat-1764755666989',
        name: 'Commercial Service Request',
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
                negativeTriggers: [
                    "home ac", "residential", "my house"
                ],
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

    commercialInstall: {
        id: 'cat-1764755696151',
        name: 'Commercial Install / Replacement',
        scenarios: [
            {
                name: 'New Commercial HVAC System',
                priority: 5,
                triggers: [
                    "new commercial hvac", "business needs new ac", "commercial system replacement",
                    "new building hvac", "commercial installation", "rooftop unit replacement",
                    "commercial quote", "new construction hvac", "tenant improvement hvac"
                ],
                negativeTriggers: [
                    "residential", "home", "house"
                ],
                quickReplies: [
                    "Commercial installations are one of our services.",
                    "We can help with new commercial HVAC projects.",
                    "Let me connect you with our commercial sales team.",
                    "New commercial systems require careful planning—we can help.",
                    "We'd be happy to provide a commercial installation quote."
                ],
                fullReplies: [
                    "Commercial HVAC installations require careful sizing, load calculations, and planning. We work with businesses on new construction, tenant improvements, and system replacements. Our commercial team can visit your property, assess your needs, and provide a detailed proposal. Would you like to schedule a consultation?",
                    "For commercial projects, we typically start with a site visit to understand your building, usage patterns, and specific needs. Then we provide equipment options with different efficiency levels and features. We handle everything from permits to installation to commissioning. What kind of commercial space are we talking about?",
                    "New commercial HVAC is a significant investment, and we want to make sure you get the right system for your business. We can provide options ranging from standard efficiency to high-efficiency equipment, and we'll factor in things like occupancy, operating hours, and future expansion plans. Let's start with a site assessment."
                ],
                actionHooks: ['route_commercial_sales', 'schedule_site_visit'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.5
            }
        ]
    },

    capacitorElectrical: {
        id: 'cat-1764755747418',
        name: 'Capacitor / Electrical Issues',
        scenarios: [
            {
                name: 'AC Not Starting - Possible Capacitor',
                priority: 7,
                triggers: [
                    "capacitor bad", "ac hums but won't start", "fan not spinning",
                    "compressor won't kick on", "motor hums but doesn't run",
                    "ac buzzes but nothing happens", "need a capacitor", "start capacitor failed",
                    "run capacitor dead"
                ],
                negativeTriggers: [
                    "runs fine", "just noisy", "works sometimes"
                ],
                quickReplies: [
                    "That sounds like it could be a capacitor issue.",
                    "If it hums but won't start, the capacitor is a likely culprit.",
                    "Capacitors are a common failure point we can fix.",
                    "Electrical components like capacitors do fail over time.",
                    "Let's get that diagnosed and fixed."
                ],
                fullReplies: [
                    "When an AC hums but won't actually start, it's often the capacitor. Capacitors are like batteries that give motors the boost they need to start. They wear out over time and are actually one of the most common repair items. This is a relatively quick and affordable repair. Would you like to schedule a service call?",
                    "What you're describing—humming but not running—is a classic sign of a failed capacitor. The motor wants to run but can't get the electrical boost it needs to start. Good news is capacitors are usually inexpensive to replace. A technician can test it and replace it on the spot if that's the issue.",
                    "A failing capacitor is one of the most common AC problems. If the unit is humming, clicking, or trying to start but failing, the capacitor has probably given out. It's usually a straightforward repair, but don't try to spin the fan manually or anything like that—there's high voltage involved. Let's get a technician out there."
                ],
                actionHooks: ['offer_scheduling', 'common_repair_flag'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.7
            }
        ]
    },

    refrigerantFreon: {
        id: 'cat-1764755773080',
        name: 'Refrigerant / Freon Issues',
        scenarios: [
            {
                name: 'AC Low on Refrigerant',
                priority: 6,
                triggers: [
                    "ac low on freon", "need refrigerant", "ac needs recharged",
                    "add freon to ac", "refrigerant leak", "r22 recharge",
                    "r410a low", "freon is low", "system low on charge"
                ],
                negativeTriggers: [
                    "just curious", "general question"
                ],
                quickReplies: [
                    "Low refrigerant usually means there's a leak somewhere.",
                    "We can check your refrigerant levels and find any leaks.",
                    "Refrigerant issues are something we deal with regularly.",
                    "If it's low, we need to find out why before just adding more.",
                    "Let's diagnose why your refrigerant is low."
                ],
                fullReplies: [
                    "Here's an important thing to know: refrigerant doesn't get 'used up.' If it's low, it means there's a leak somewhere in the system. Simply adding more refrigerant without fixing the leak is like putting air in a tire with a nail in it. We should diagnose the leak, repair it, and then recharge the system properly. Want to schedule a diagnostic visit?",
                    "If your system is low on refrigerant, there's a leak that needs to be found and fixed. Just adding more refrigerant is a temporary fix at best and bad for the environment. Our technicians can perform a leak search, repair the leak, and recharge the system with the correct amount. That's the right way to handle it.",
                    "Low refrigerant is a symptom of a leak, not normal wear. Adding refrigerant without fixing the leak just postpones the problem and wastes money. We can test your system, find the leak location, repair it, and then properly charge the system. If you have an older system using R-22 (Freon), there are some additional considerations we should discuss."
                ],
                actionHooks: ['offer_leak_search', 'offer_scheduling'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.65
            }
        ]
    }
};

module.exports = { TEMPLATE_ID, CATEGORIES };

