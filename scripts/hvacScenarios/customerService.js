/**
 * ============================================================================
 * HVAC SCENARIOS - Customer Service Categories
 * ============================================================================
 * Part 5: General questions, pricing, warranty, financing, follow-ups
 */

const TEMPLATE_ID = '68fb535130d19aec696d8123';

const CATEGORIES = {
    generalQuestions: {
        id: 'cat-1764755800466',
        name: 'General Questions / Pricing / Availability',
        scenarios: [
            {
                name: 'Service Pricing Inquiry',
                priority: 4,
                triggers: [
                    "how much do you charge", "what's your service fee", "diagnostic cost",
                    "trip charge", "hourly rate", "how much for a service call",
                    "pricing for repair", "cost to come out", "what are your rates"
                ],
                negativeTriggers: [
                    "free estimate", "no cost", "complimentary"
                ],
                quickReplies: [
                    "I can give you general pricing information.",
                    "Our service fees are competitive. Let me explain.",
                    "Pricing depends on the service needed, but I can help.",
                    "We're transparent about our pricing. Here's how it works.",
                    "I'd be happy to explain our pricing structure."
                ],
                fullReplies: [
                    "We charge a diagnostic or service call fee that covers the technician coming out and identifying the problem. This fee varies but typically covers the first portion of work. Once we know what's wrong, we provide upfront pricing for the repair before any work is done, so you're never surprised. Would you like me to schedule a visit?",
                    "Our pricing structure is straightforward. There's a service call fee to dispatch a technician and diagnose the issue. Repair costs are then quoted before we do any work, so you can approve the cost. We also offer memberships that reduce or eliminate the service fee. What type of service do you need?",
                    "We believe in transparent pricing. The service call fee gets a trained technician to your home to diagnose the problem. After diagnosis, you'll receive a clear quote for repairs with no hidden costs. If you decide not to proceed with repairs, you only pay the service call fee. Does that help?"
                ],
                actionHooks: ['provide_pricing_info'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.4
            },
            {
                name: 'Appointment Availability',
                priority: 5,
                triggers: [
                    "when can you come out", "next available appointment", "soonest availability",
                    "can you come today", "schedule for tomorrow", "what times do you have",
                    "availability this week", "how soon can someone come"
                ],
                negativeTriggers: [
                    "not scheduling yet", "just asking", "future maybe"
                ],
                quickReplies: [
                    "Let me check our schedule for you.",
                    "We try to accommodate appointments quickly.",
                    "I can help you find a time that works.",
                    "Availability varies—let me see what we have.",
                    "We may have openings sooner than you think."
                ],
                fullReplies: [
                    "We typically have appointments available within 1-2 days, sometimes same-day depending on the situation. For emergencies or no-cooling/no-heating situations, we prioritize getting someone out quickly. What day and time frame works best for you?",
                    "Our schedule fills up, but we always keep some slots open for urgent needs. If you're flexible on timing, we can often get you in quickly. Morning, afternoon, or a specific day that works best for you?",
                    "Availability depends on the day and urgency of your situation. If it's an emergency, we'll work to get you seen as soon as possible. For routine service, we usually have appointments within a few days. Would you like me to check what's open?"
                ],
                actionHooks: ['check_availability', 'offer_scheduling'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.5
            }
        ]
    },

    warrantyParts: {
        id: 'cat-1764755861421',
        name: 'Warranty / Parts Warranty',
        scenarios: [
            {
                name: 'Warranty Coverage Question',
                priority: 5,
                triggers: [
                    "is this covered under warranty", "warranty on my system", "parts warranty",
                    "labor warranty", "manufacturer warranty", "how long is warranty",
                    "warranty claim", "unit still under warranty", "check my warranty"
                ],
                negativeTriggers: [
                    "extended warranty purchase", "warranty for sale"
                ],
                quickReplies: [
                    "Warranty coverage depends on several factors. Let me help.",
                    "I can help you understand your warranty situation.",
                    "Warranties vary by manufacturer and type of coverage.",
                    "Let me look into your warranty status.",
                    "Good question—warranties can be confusing. Let me explain."
                ],
                fullReplies: [
                    "Warranty coverage depends on when your system was installed, who manufactured it, and whether it was registered. Most manufacturers offer 5-10 years on parts, but labor is often separate. Do you know when your system was installed and what brand it is? That will help us determine what might be covered.",
                    "Manufacturer warranties typically cover parts but not labor after the first year. The length varies—some are 5 years, some are 10, and extended warranties may add more coverage. If you have your original paperwork or know the installation date, we can help verify what's covered.",
                    "Great question about warranty. Most new systems come with a parts warranty from the manufacturer, and labor may be covered for the first year or through an extended warranty. If you're not sure about your coverage, we can look up your equipment when a technician visits. We always check warranty status before quoting repairs."
                ],
                actionHooks: ['lookup_warranty', 'capture_system_info'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.5
            }
        ]
    },

    financingPayment: {
        id: 'cat-1764755889326',
        name: 'Financing / Payment Questions',
        scenarios: [
            {
                name: 'Financing Options Available',
                priority: 4,
                triggers: [
                    "do you offer financing", "payment plans available", "can I finance",
                    "monthly payments", "financing options", "0% interest",
                    "can't afford to pay all at once", "payment options", "credit available"
                ],
                negativeTriggers: [
                    "paying cash", "no financing needed"
                ],
                quickReplies: [
                    "Yes, we offer financing options for qualified customers.",
                    "We have several financing programs available.",
                    "Financing can make repairs or new systems more manageable.",
                    "Let me tell you about our payment options.",
                    "We understand unexpected repairs can strain budgets. We have options."
                ],
                fullReplies: [
                    "We do offer financing options for both repairs and new system installations. We work with financing partners that offer various terms, and there are sometimes promotional rates available. Approval is usually quick and can be done right at the time of service. Would you like more details about our current financing options?",
                    "Financing is available for qualified customers. Options include same-as-cash plans, low monthly payment options, and sometimes 0% interest promotions for new systems. The application process is quick and doesn't affect your credit to check if you're pre-approved. Let me know if you'd like to explore this option.",
                    "We understand that HVAC repairs or replacements can be unexpected expenses. That's why we offer financing through several programs. You can spread payments over time, and approval is often quick. When you're ready, a technician or comfort advisor can walk you through the options that best fit your situation."
                ],
                actionHooks: ['provide_financing_info'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.4
            },
            {
                name: 'Payment Methods Accepted',
                priority: 3,
                triggers: [
                    "what payment do you accept", "do you take credit cards", "cash only",
                    "check payment", "forms of payment", "can I pay with card",
                    "payment at time of service", "how do I pay"
                ],
                negativeTriggers: [
                    "financing", "payment plan"
                ],
                quickReplies: [
                    "We accept multiple forms of payment.",
                    "Payment is easy—we accept cards, cash, and checks.",
                    "We're flexible with payment methods.",
                    "You can pay however is most convenient for you.",
                    "We make paying easy."
                ],
                fullReplies: [
                    "We accept all major credit cards, debit cards, cash, and checks. Payment is typically due at the time of service, but we also offer financing options if you prefer to spread payments out over time. Our technicians can process card payments on-site.",
                    "We make it easy to pay. Credit cards, debit cards, cash, and checks are all accepted. If you need financing, we have that too. You'll receive a detailed invoice either printed or emailed, and payment is collected when the work is complete.",
                    "We accept pretty much everything—Visa, Mastercard, American Express, Discover, cash, and checks. Financing is also available if you need it. Our technicians carry mobile payment devices, so card payments are processed securely on the spot."
                ],
                actionHooks: [],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.3
            }
        ]
    },

    previousTechnicianFollowUp: {
        id: 'cat-1764755971979',
        name: 'Previous Technician Follow-Up',
        scenarios: [
            {
                name: 'Follow-Up After Service',
                priority: 6,
                triggers: [
                    "technician was just here", "follow up on recent service", "same problem after repair",
                    "issue came back", "problem not fixed", "still having issues after service",
                    "need someone to come back", "return visit needed", "warranty on repair"
                ],
                negativeTriggers: [
                    "new problem", "different issue", "never had service before"
                ],
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

    newCustomerSetup: {
        id: 'cat-1764756025359',
        name: 'New Customer Setup',
        scenarios: [
            {
                name: 'First Time Caller / New Customer',
                priority: 4,
                triggers: [
                    "first time calling", "new customer", "never used you before",
                    "looking for a new hvac company", "switching companies", "new to the area",
                    "just moved here", "trying to find good hvac company"
                ],
                negativeTriggers: [
                    "existing customer", "been using you for years", "returning customer"
                ],
                quickReplies: [
                    "Welcome! We're glad you called.",
                    "We appreciate new customers. How can we help?",
                    "Thank you for choosing us. What brings you in today?",
                    "We're happy to have you. Let me get your information.",
                    "Welcome aboard! Let me tell you a little about us."
                ],
                fullReplies: [
                    "Welcome! We're glad you're considering us for your HVAC needs. We've been serving the area for years and pride ourselves on honest, quality service. Let me get some basic information to set up your account, and then we can discuss how we can help you today.",
                    "Thank you for calling! As a new customer, you'll find we're pretty easy to work with. We give upfront pricing, stand behind our work, and treat your home like our own. What HVAC needs can we help you with today?",
                    "We love new customers! Whether you've just moved to the area or are looking for a more reliable HVAC company, we'd be happy to earn your business. Let me get your contact information, and then we can discuss what you need."
                ],
                actionHooks: ['new_customer_setup', 'capture_contact_info'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.4
            }
        ]
    },

    serviceAreaCoverage: {
        id: 'cat-1764756051863',
        name: 'Service Area / Coverage Check',
        scenarios: [
            {
                name: 'Do You Service My Area',
                priority: 5,
                triggers: [
                    "do you service my area", "what areas do you cover", "service my zip code",
                    "do you come to", "is my city in your service area", "how far do you travel",
                    "coverage area", "service radius"
                ],
                negativeTriggers: [
                    "commercial service", "international"
                ],
                quickReplies: [
                    "Let me check if we service your area.",
                    "We serve a wide area. What's your location?",
                    "I can verify our coverage for you.",
                    "Tell me your city or zip code and I'll check.",
                    "We want to help—let's see if you're in our service area."
                ],
                fullReplies: [
                    "We serve a wide area including many surrounding cities and neighborhoods. If you give me your zip code or city, I can quickly confirm whether you're in our service area. Even if you're on the edge, we often can still accommodate you.",
                    "Our service area covers the greater metropolitan area and surrounding communities. Some distant areas may have an additional trip charge, but we try to accommodate everyone. What's your location? I'll check our coverage map.",
                    "We service most of the local area and regularly travel to neighboring cities. Let me know your address or zip code and I can confirm we service your location. If there's any question about coverage, I'll get a clear answer for you."
                ],
                actionHooks: ['check_service_area', 'capture_address'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.5
            }
        ]
    },

    systemAgeUpgrade: {
        id: 'cat-1764755918659',
        name: 'System Age / Upgrade Inquiry',
        scenarios: [
            {
                name: 'System Upgrade Inquiry',
                priority: 4,
                triggers: [
                    "upgrade my system", "more efficient unit", "energy efficient hvac",
                    "better system available", "high efficiency options", "smart thermostat upgrade",
                    "variable speed upgrade", "newer technology available"
                ],
                negativeTriggers: [
                    "system is new", "just installed", "happy with current"
                ],
                quickReplies: [
                    "Upgrades can improve comfort and reduce energy costs.",
                    "There are some great high-efficiency options available.",
                    "We can discuss upgrade options that might benefit you.",
                    "Modern systems have come a long way in efficiency.",
                    "An upgrade could save you money in the long run."
                ],
                fullReplies: [
                    "There are definitely some exciting options if you're thinking about upgrading. Modern systems are significantly more efficient than older ones—sometimes 30-50% more efficient. Features like variable speed motors, smart thermostats, and zoning can dramatically improve comfort and reduce energy bills. Would you like to explore options?",
                    "Great question! If your system is older, upgrading to a high-efficiency unit could lower your energy bills significantly. Newer features like variable speed technology mean better humidity control and more consistent temperatures. We can do an assessment and show you what options make sense for your home.",
                    "Upgrading makes sense for many homeowners, especially if your current system is 10-15+ years old. The efficiency improvements alone can pay for the upgrade over time. Plus, newer systems are quieter and provide more consistent comfort. Want me to schedule a consultation to discuss your options?"
                ],
                actionHooks: ['schedule_consultation', 'provide_upgrade_info'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.45
            }
        ]
    },

    meteringBillingCommercial: {
        id: 'cat-1764755998957',
        name: 'Metering / Billing for Commercial',
        scenarios: [
            {
                name: 'Commercial Billing Questions',
                priority: 4,
                triggers: [
                    "commercial billing", "business account invoice", "billing for our company",
                    "corporate account", "purchase order", "net terms", "invoice question",
                    "accounts payable contact"
                ],
                negativeTriggers: [
                    "residential billing", "home account"
                ],
                quickReplies: [
                    "I can help with commercial billing questions.",
                    "Let me assist with your business account.",
                    "Commercial accounts have different billing options.",
                    "I can look into your invoice or billing concern.",
                    "Our commercial billing team can help with that."
                ],
                fullReplies: [
                    "For commercial accounts, we can set up invoicing with net terms for established businesses. If you have questions about a specific invoice or need to update billing information, I can help with that or connect you with our commercial accounts team. What do you need assistance with?",
                    "We handle commercial billing differently than residential. Many businesses prefer invoicing rather than payment at time of service, and we can accommodate purchase orders and net terms for qualified accounts. Is this about setting up terms or a question about an existing invoice?",
                    "Commercial billing is handled by our business accounts department. They can assist with invoice questions, payment arrangements, setting up terms, or updating your account information. I can transfer you there or have someone call you back. Which would you prefer?"
                ],
                actionHooks: ['route_commercial_billing'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.4
            }
        ]
    }
};

module.exports = { TEMPLATE_ID, CATEGORIES };

