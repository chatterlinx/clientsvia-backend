/**
 * ============================================================================
 * HVAC SCENARIOS - System Issues Categories
 * ============================================================================
 * Part 3: Airflow, noise, smell, leak, ice issues
 */

const TEMPLATE_ID = '68fb535130d19aec696d8123';

const CATEGORIES = {
    weakAirflow: {
        id: 'cat-1764755268704',
        name: 'Weak Airflow / Poor Airflow',
        scenarios: [
            {
                name: 'Weak Air Coming From Vents',
                priority: 6,
                triggers: [
                    "weak airflow", "low air pressure from vents", "barely any air coming out",
                    "air not blowing strong", "weak air from ac", "poor airflow",
                    "vents not blowing hard enough", "reduced airflow", "air is weak",
                    "fan not blowing hard", "low air output"
                ],
                negativeTriggers: [
                    "airflow fine", "blowing strong", "too much air"
                ],
                quickReplies: [
                    "Weak airflow can have several causes. Let's troubleshoot.",
                    "Reduced airflow often indicates a problem we can fix.",
                    "Poor airflow affects comfort and efficiency. Let me help.",
                    "Several things can cause weak airflow. Let's figure it out.",
                    "Airflow issues are common and usually fixable."
                ],
                fullReplies: [
                    "Weak airflow from your vents could be caused by a dirty filter, blocked ducts, a failing blower motor, or frozen coils. First question: when did you last change your air filter? A clogged filter is the most common cause and an easy fix. If that's not it, we may need to have a technician take a look.",
                    "Reduced airflow is definitely something to address—it makes your system work harder and costs you money. Common causes include dirty filters, duct obstructions, or blower motor issues. Have you noticed this in all rooms or just certain areas? That can help us narrow down the problem.",
                    "Poor airflow can mean a few different things. If it's just one or two vents, you might have a duct issue. If it's the whole house, it could be the blower motor, a dirty filter, or even low refrigerant causing frozen coils. Let's start with the basics—how's your filter looking?"
                ],
                actionHooks: ['troubleshoot_first', 'offer_scheduling'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.65
            }
        ]
    },

    waterLeak: {
        id: 'cat-1764755339971',
        name: 'Water Leak / Ceiling Leak / Drain Issues',
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
                negativeTriggers: [
                    "outside unit normal condensation", "just a little moisture"
                ],
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
                negativeTriggers: [
                    "roof leak", "plumbing issue", "not from hvac"
                ],
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

    iceFrozenCoil: {
        id: 'cat-1764755375066',
        name: 'Ice / Frozen Coil',
        scenarios: [
            {
                name: 'AC Unit Frozen / Ice on Coils',
                priority: 7,
                triggers: [
                    "ice on ac", "ac is frozen", "coils are iced over", "frozen evaporator",
                    "ice on refrigerant line", "ac freezing up", "frost on ac unit",
                    "indoor coil frozen", "ice building up on ac", "ac turned into ice block"
                ],
                negativeTriggers: [
                    "ice maker", "refrigerator", "freezer"
                ],
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

    strangeNoise: {
        id: 'cat-1764755405667',
        name: 'Strange Noise / Vibration',
        scenarios: [
            {
                name: 'AC Making Strange Noises',
                priority: 6,
                triggers: [
                    "ac making weird noise", "strange sound from hvac", "loud noise from unit",
                    "banging noise from ac", "squealing sound", "grinding noise hvac",
                    "hvac is loud", "clicking noise from ac", "rattling sound",
                    "buzzing noise from unit", "humming sound from ac", "screeching noise"
                ],
                negativeTriggers: [
                    "normal sounds", "always made that noise", "just curious"
                ],
                quickReplies: [
                    "Strange noises often indicate something needs attention.",
                    "Unusual sounds can help us diagnose what's going on.",
                    "Let me help you figure out what that noise means.",
                    "Different noises point to different issues. Can you describe it?",
                    "We should definitely look into that noise."
                ],
                fullReplies: [
                    "Different noises mean different things. Squealing often indicates a belt or motor bearing issue. Banging could be a loose component or compressor problem. Grinding might mean motor failure. Clicking at startup is often normal, but continuous clicking could be a relay issue. Can you describe the sound more specifically—when does it happen and what does it sound like?",
                    "Noises from your HVAC shouldn't be ignored—they're usually your system telling you something's wrong. A rattling might just be a loose panel, but grinding or screeching could mean a motor is failing. If the noise is new or getting worse, I'd recommend having a technician take a look before a small issue becomes a big repair.",
                    "I'm glad you called about this. Strange noises are one of the best early warning signs that something needs attention. Whether it's buzzing, banging, squealing, or something else, these sounds usually have a specific cause. Let me get some more details and we can either troubleshoot or schedule a diagnostic visit."
                ],
                actionHooks: ['diagnose_by_sound', 'offer_scheduling'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.6
            }
        ]
    },

    badSmell: {
        id: 'cat-1764755431658',
        name: 'Bad Smell / Odor Issues',
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
                negativeTriggers: [
                    "smell is gone", "was cooking", "candle"
                ],
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
                negativeTriggers: [
                    "not gas", "musty smell", "burning dust"
                ],
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

    airflowImbalance: {
        id: 'cat-1764755722843',
        name: 'Airflow Imbalance / Hot Room / Cold Room',
        scenarios: [
            {
                name: 'One Room Too Hot or Cold',
                priority: 5,
                triggers: [
                    "one room is always hot", "bedroom won't cool down", "upstairs too warm",
                    "cold spot in house", "room doesn't get warm", "uneven temperatures",
                    "master bedroom too hot", "kids room won't heat", "basement too cold",
                    "hot spots in house", "temperature difference between rooms"
                ],
                negativeTriggers: [
                    "whole house hot", "entire home cold", "thermostat broken"
                ],
                quickReplies: [
                    "Uneven temperatures are frustrating but usually fixable.",
                    "Hot and cold spots often have specific causes we can address.",
                    "Let's figure out why that room isn't comfortable.",
                    "Airflow imbalance is a common issue we can help with.",
                    "Temperature differences between rooms can often be improved."
                ],
                fullReplies: [
                    "Hot or cold spots in a home usually come down to airflow issues, duct problems, or the room's location and construction. Rooms far from the air handler, over garages, or with lots of windows often struggle. We can check your duct system for proper sizing and airflow, and there are solutions like damper adjustments, duct modifications, or even zoning systems for more challenging cases.",
                    "When one room just won't cooperate, it's usually due to ductwork issues—maybe a disconnected duct, poor design, or dampers that need adjustment. Sometimes it's the room itself—lots of sun exposure, poor insulation, or being at the end of a long duct run. A technician can assess the situation and recommend the best solution for your specific case.",
                    "Uneven temperatures are one of the most common comfort complaints, and there are usually good solutions. It could be as simple as adjusting dampers or cleaning ducts, or it might require rebalancing the system or adding a return. In some cases, a zoning system that lets you control different areas independently is the answer. Would you like someone to evaluate your situation?"
                ],
                actionHooks: ['offer_assessment', 'offer_scheduling'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.55
            }
        ]
    }
};

module.exports = { TEMPLATE_ID, CATEGORIES };

