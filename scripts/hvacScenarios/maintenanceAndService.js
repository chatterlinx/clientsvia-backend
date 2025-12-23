/**
 * ============================================================================
 * HVAC SCENARIOS - Maintenance & Service Categories
 * ============================================================================
 * Part 2: Maintenance requests, tune-ups, memberships
 */

const TEMPLATE_ID = '68fb535130d19aec696d8123';

const CATEGORIES = {
    maintenanceTuneUp: {
        id: 'cat-1764755460653',
        name: 'Maintenance / Tune-Up Request',
        scenarios: [
            {
                name: 'Seasonal Tune-Up Request',
                priority: 5,
                triggers: [
                    "need a tune up", "schedule maintenance", "seasonal checkup",
                    "annual maintenance", "hvac tune up", "ac tune up", "furnace tune up",
                    "preventive maintenance", "system check up", "routine maintenance",
                    "want to get my system checked", "maintenance appointment",
                    "pre-season tune up", "winterize my system", "spring ac checkup"
                ],
                negativeTriggers: [
                    "repair needed", "something wrong", "not working", "broken", "emergency"
                ],
                quickReplies: [
                    "Great thinking! Regular maintenance keeps your system running efficiently.",
                    "Preventive maintenance is the best way to avoid costly repairs.",
                    "I'd be happy to schedule a tune-up for you.",
                    "A tune-up can extend your system's life and lower energy bills.",
                    "Smart choice—maintenance now prevents problems later."
                ],
                fullReplies: [
                    "A seasonal tune-up is a great way to keep your system running at peak efficiency. During a tune-up, our technician will clean the coils, check refrigerant levels, inspect electrical connections, and make sure everything is operating safely. This can help prevent breakdowns and lower your energy bills. When would be a good time to schedule?",
                    "Regular maintenance is one of the best things you can do for your HVAC system. It helps catch small problems before they become big repairs, keeps your system efficient, and can extend its lifespan by years. Our tune-up service includes a comprehensive inspection and cleaning. Would you like to schedule one?",
                    "Absolutely! Preventive maintenance typically includes checking and cleaning coils, verifying refrigerant charge, inspecting ductwork, testing safety controls, and lubricating moving parts. Most manufacturers actually require annual maintenance to keep warranties valid. Let me get you scheduled—do you have a preferred day?"
                ],
                actionHooks: ['offer_scheduling', 'mention_membership'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.6
            },
            {
                name: 'First Time Maintenance',
                priority: 5,
                triggers: [
                    "never had maintenance before", "first time tune up",
                    "new homeowner maintenance", "just bought the house",
                    "don't know when system was last serviced", "inherited old system",
                    "moved into new house need hvac check"
                ],
                negativeTriggers: [
                    "regular customer", "been using you for years", "annual plan"
                ],
                quickReplies: [
                    "Welcome! Getting your system checked is a smart first step.",
                    "As a new homeowner, a system inspection is a great idea.",
                    "Let's see what shape your HVAC is in.",
                    "We can give you a full assessment of your system's condition.",
                    "Starting with maintenance is exactly the right approach."
                ],
                fullReplies: [
                    "Congratulations on your new home! Getting your HVAC system inspected is a smart move, especially if you don't know its service history. We can do a comprehensive inspection to assess the condition of your equipment, check for any issues, and give you peace of mind. We'll also let you know the system's age and expected lifespan.",
                    "That's actually really common—most people don't know when the previous owners last had the system serviced. We recommend a full inspection for new homeowners. We'll check everything from the air handler to the outdoor unit, test all safety controls, and give you a detailed report. Would you like to schedule that?",
                    "New homeowners who get their HVAC inspected are doing themselves a huge favor. You'll know exactly what you're working with, whether there are any concerns, and what maintenance schedule makes sense going forward. Our technicians can also answer any questions about how to best use and maintain your specific system."
                ],
                actionHooks: ['offer_scheduling', 'new_customer_setup'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.65
            }
        ]
    },
    
    membershipPlanQuestions: {
        id: 'cat-1764755534854',
        name: 'Membership / Plan Questions',
        scenarios: [
            {
                name: 'Membership Plan Inquiry',
                priority: 4,
                triggers: [
                    "do you have a maintenance plan", "membership program",
                    "annual service plan", "what's included in membership",
                    "service agreement", "hvac membership", "maintenance agreement",
                    "prepaid maintenance", "loyalty program", "vip membership",
                    "comfort club", "preferred customer program"
                ],
                negativeTriggers: [
                    "cancel membership", "end subscription", "stop charging me"
                ],
                quickReplies: [
                    "Yes! Our membership program offers great benefits and savings.",
                    "I'd be happy to tell you about our maintenance plan.",
                    "Our membership includes priority service and discounts.",
                    "Great question—let me explain our service agreement options.",
                    "Our maintenance plan members save money and get priority scheduling."
                ],
                fullReplies: [
                    "We do have a maintenance membership program! It typically includes two tune-ups per year—one for heating, one for cooling—plus discounts on repairs, priority scheduling, and no overtime charges for emergency calls. Many customers find it saves them money over paying for individual services. Would you like more details on pricing?",
                    "Our membership plan is designed to keep your system running smoothly year-round. Members get annual or semi-annual tune-ups, a discount on parts and labor if repairs are needed, and they go to the front of the line when scheduling. There are usually a few tier options depending on your needs. Should I go over the specifics?",
                    "Yes, we offer a service agreement that covers your preventive maintenance and provides additional benefits. Most plans include priority service, discounted repair rates, no trip charges for service calls, and regular tune-ups to keep your system efficient. It's a great way to protect your investment and budget for HVAC care."
                ],
                actionHooks: ['send_membership_info', 'offer_signup'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.5
            },
            {
                name: 'Cancel Membership',
                priority: 6,
                triggers: [
                    "cancel my membership", "end my plan", "stop my subscription",
                    "want out of maintenance agreement", "cancel service contract",
                    "don't want to renew", "discontinue membership"
                ],
                negativeTriggers: [
                    "want to join", "sign up", "interested in membership"
                ],
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
    
    ductCleaning: {
        id: 'cat-1764755607387',
        name: 'Duct Cleaning / Duct Services',
        scenarios: [
            {
                name: 'Duct Cleaning Request',
                priority: 4,
                triggers: [
                    "need duct cleaning", "clean my air ducts", "ductwork cleaning",
                    "dusty air ducts", "hvac duct cleaning service", "air duct cleaning",
                    "how much for duct cleaning", "should I get ducts cleaned",
                    "dirty ductwork", "dust coming from vents"
                ],
                negativeTriggers: [
                    "duct repair", "duct replacement", "ductwork damage", "duct leak"
                ],
                quickReplies: [
                    "Duct cleaning can improve air quality and system efficiency.",
                    "I can help you with information on our duct cleaning service.",
                    "Clean ducts mean cleaner air. Let me help you with that.",
                    "Duct cleaning is a great way to improve your indoor air quality.",
                    "We offer professional duct cleaning services."
                ],
                fullReplies: [
                    "Duct cleaning can be beneficial, especially if you've noticed more dust than usual, had recent construction or renovation, or it's been many years since they were cleaned. Our duct cleaning service removes dust, debris, and potential allergens from your ductwork. Would you like to schedule an inspection or get a quote?",
                    "Professional duct cleaning involves cleaning out the supply and return ducts, registers, and grilles. It can help if you have allergy concerns, excessive dust, or visible debris in your vents. The EPA recommends cleaning if there's visible mold, vermin, or significant debris. Want me to schedule an assessment?",
                    "Great question about duct cleaning. While not everyone needs it regularly, it's worth considering if you have pets, smokers in the home, recent renovations, or notice musty odors or excessive dust. Our technicians can inspect your ducts and let you know if cleaning would benefit your system and air quality."
                ],
                actionHooks: ['offer_inspection', 'provide_quote'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.5
            },
            {
                name: 'Duct Repair or Replacement',
                priority: 6,
                triggers: [
                    "duct repair", "damaged ductwork", "duct is disconnected",
                    "air leaking from ducts", "ducts falling apart", "replace ductwork",
                    "old duct system", "duct insulation damaged", "flex duct broken",
                    "ductwork falling down", "ducts in attic damaged"
                ],
                negativeTriggers: [
                    "just cleaning", "duct cleaning only", "no damage"
                ],
                quickReplies: [
                    "Damaged ductwork can waste a lot of energy. Let's get it fixed.",
                    "Duct repairs are important for system efficiency.",
                    "I can help you with ductwork repair or replacement.",
                    "Leaky ducts cost you money. Let's address that.",
                    "We can inspect and repair your duct system."
                ],
                fullReplies: [
                    "Damaged or leaky ductwork can waste 20-30% of your heating and cooling energy. If you've noticed hot or cold spots, rooms that don't condition well, or can see damage to your ducts, it's definitely worth having them inspected. Our technicians can repair sections or recommend replacement if needed. Want me to schedule an inspection?",
                    "Duct problems are often overlooked but can really impact your comfort and energy bills. Disconnected ducts, torn insulation, or crushed flex duct all reduce your system's effectiveness. We can assess the condition of your ductwork and provide options for repair or replacement. Would you like to schedule a duct inspection?",
                    "If you're seeing visible damage to your ductwork or experiencing issues like some rooms being much hotter or cooler than others, your ducts likely need attention. We can seal leaks, repair damaged sections, or replace ductwork that's beyond repair. The first step is having a technician inspect the system."
                ],
                actionHooks: ['offer_inspection', 'offer_scheduling'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.6
            }
        ]
    },
    
    filterDeliverySubscription: {
        id: 'cat-1764755948571',
        name: 'Filter Delivery / Subscription',
        scenarios: [
            {
                name: 'Filter Delivery Service',
                priority: 3,
                triggers: [
                    "filter delivery", "filter subscription", "send me filters",
                    "auto ship filters", "need filters delivered", "mail me filters",
                    "filter replacement program", "recurring filter delivery",
                    "sign up for filter service", "how do I get filters delivered"
                ],
                negativeTriggers: [
                    "buy filter in store", "what size filter", "filter problem"
                ],
                quickReplies: [
                    "Filter delivery makes maintenance easy. Let me help you set that up.",
                    "We can set you up with automatic filter delivery.",
                    "Never forget to change your filter with our delivery service.",
                    "Filter subscriptions are convenient and save you time.",
                    "I can help you with our filter delivery program."
                ],
                fullReplies: [
                    "Our filter delivery subscription is a convenient way to make sure you always have fresh filters on hand. We'll send the right size filter for your system on a schedule that works for you—typically every 1-3 months depending on your needs. Would you like me to check what filter size your system uses and set that up?",
                    "Great question! We offer a filter subscription service that delivers high-quality filters right to your door. Regular filter changes are one of the easiest ways to keep your system running efficiently and your air clean. We can customize the delivery frequency based on your household needs—pets, allergies, etc.",
                    "Filter delivery is one of our most popular services. You pick the schedule, and we make sure you never run out. It's an easy way to stay on top of maintenance. If you're on our membership plan, you may already get discounted or free filters. Let me look into that for you."
                ],
                actionHooks: ['setup_subscription', 'lookup_filter_size'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.4
            }
        ]
    }
};

module.exports = { TEMPLATE_ID, CATEGORIES };

