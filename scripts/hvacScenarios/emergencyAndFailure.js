/**
 * ============================================================================
 * HVAC SCENARIOS - Emergency & System Failure Categories
 * ============================================================================
 * Part 1: System failures, emergencies, and critical issues
 */

const TEMPLATE_ID = '68fb535130d19aec696d8123';

const CATEGORIES = {
    systemNotTurningOn: {
        id: 'cat-1764754970040',
        name: 'System Not Turning On / Total Failure',
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
                negativeTriggers: [
                    "just a question", "checking price", "routine maintenance",
                    "working fine now", "fixed itself"
                ],
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
                negativeTriggers: [
                    "other appliance", "not the ac", "lights flickering", "unrelated"
                ],
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
            },
            {
                name: 'Thermostat Screen Blank',
                priority: 6,
                triggers: [
                    "thermostat screen is blank", "thermostat display not working",
                    "thermostat has no power", "screen went black on thermostat",
                    "thermostat died", "no display on thermostat", "thermostat not lighting up"
                ],
                negativeTriggers: [
                    "just changed batteries", "screen works now", "programming question"
                ],
                quickReplies: [
                    "A blank thermostat screen could be a simple fix or something more.",
                    "Let's figure out why your thermostat display isn't working.",
                    "This happens sometimes—could be batteries or something else.",
                    "I can help you troubleshoot your thermostat issue.",
                    "Let's see if we can get your thermostat working again."
                ],
                fullReplies: [
                    "If your thermostat screen is completely blank, the first thing to check is if it uses batteries—try replacing them. If it's hardwired and still blank, there might be an issue with the power supply from your HVAC system, possibly a blown fuse on the control board. Would you like to try the battery trick first, or should we schedule a technician?",
                    "A blank thermostat is usually one of two things: dead batteries if it's battery-powered, or a power issue from the HVAC system if it's wired directly. Have you checked the batteries recently? If that doesn't fix it, we may need to send someone out to check the control board.",
                    "Thermostat screens going blank can be frustrating. For battery-powered models, new batteries usually fix it. For hardwired ones, it could mean the HVAC's transformer or control board has an issue. Let me know if you've already tried batteries, and we can go from there."
                ],
                actionHooks: ['troubleshoot_first', 'offer_scheduling'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.7
            }
        ]
    },
    
    afterHoursEmergency: {
        id: 'cat-1764755836130',
        name: 'After-Hours Emergency',
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
                negativeTriggers: [
                    "not an emergency", "can wait", "just asking", "regular appointment",
                    "routine service", "next week is fine"
                ],
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
                negativeTriggers: [
                    "just a little cold", "can use space heaters", "not urgent"
                ],
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
                negativeTriggers: [
                    "just warm", "can use fans", "not that bad"
                ],
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
    }
};

module.exports = { TEMPLATE_ID, CATEGORIES };

