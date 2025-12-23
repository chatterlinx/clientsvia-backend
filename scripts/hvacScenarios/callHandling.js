/**
 * ============================================================================
 * HVAC SCENARIOS - Call Handling Categories
 * ============================================================================
 * Part 6: Confused callers, wrong numbers, booking, misclassification
 */

const TEMPLATE_ID = '68fb535130d19aec696d8123';

const CATEGORIES = {
    confusedCaller: {
        id: 'cat-1764755161093',
        name: 'Confused Caller / Unclear Intent',
        scenarios: [
            {
                name: 'Caller Not Sure What They Need',
                priority: 5,
                triggers: [
                    "not sure what's wrong", "something is off with my hvac", "don't know what I need",
                    "ac is acting weird", "something's not right", "just doesn't seem right",
                    "it's doing something strange", "hard to explain", "I don't know"
                ],
                negativeTriggers: [
                    "specific problem", "know exactly what's wrong"
                ],
                quickReplies: [
                    "No problem—let me help you figure it out.",
                    "That's okay, let's narrow it down together.",
                    "I can ask a few questions to understand what's happening.",
                    "Don't worry, we'll figure out what's going on.",
                    "Let me help you identify the issue."
                ],
                fullReplies: [
                    "That's totally okay—you don't need to know what's wrong, that's our job! Let me ask a few questions to help narrow it down. Is this a heating issue, a cooling issue, or both? Is the system running at all, or is it completely quiet? Any unusual sounds or smells?",
                    "No worries, a lot of people call not knowing exactly what's going on—that's what we're here for. Let's troubleshoot a bit. Is your system running but not cooling or heating well? Or is it not turning on at all? That's usually a good starting point.",
                    "I hear you—sometimes HVAC issues are hard to pin down. Let me guide you through a few questions. What's the main thing that made you call today? Too hot? Too cold? Strange behavior from the system? We'll figure it out together."
                ],
                actionHooks: ['guided_discovery', 'offer_diagnostic'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.6
            },
            {
                name: 'Caller Vague About Symptoms',
                priority: 4,
                triggers: [
                    "it's just not working right", "feels off", "doesn't feel like it used to",
                    "performance seems worse", "just not the same", "something changed"
                ],
                negativeTriggers: [
                    "no change", "always been this way"
                ],
                quickReplies: [
                    "I understand. Let me ask some questions to pinpoint the issue.",
                    "Changes in performance can have many causes. Let's investigate.",
                    "We can definitely look into that.",
                    "Let me help you describe what's different.",
                    "Let's figure out what's changed."
                ],
                fullReplies: [
                    "I understand—sometimes you just know something isn't right even if it's hard to put your finger on it. Let me ask a few things: Is the house getting to the temperature you set? Are you hearing anything different? Has your energy bill changed? These clues can help us figure out what's going on.",
                    "Performance changes can be subtle. Has the system been running more often than usual? Taking longer to reach temperature? Making different sounds? Even small details can help us understand what might be happening with your system.",
                    "Those kinds of gradual changes often point to something worth checking out. It could be as simple as a dirty filter or as complex as a failing component. A tune-up or diagnostic visit can often identify what's different and get things back to how they should be."
                ],
                actionHooks: ['guided_discovery', 'offer_diagnostic'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.5
            }
        ]
    },

    maintenanceVsRepair: {
        id: 'cat-1764755196792',
        name: 'Maintenance vs. Repair Misclassification',
        scenarios: [
            {
                name: 'Needs Repair But Asking for Maintenance',
                priority: 5,
                triggers: [
                    "want a tune up but system not cooling", "maintenance but ac won't start",
                    "tune up needed and it's making noise", "annual service but system broken"
                ],
                negativeTriggers: [
                    "just maintenance", "system works fine"
                ],
                quickReplies: [
                    "It sounds like you might need a repair rather than just maintenance.",
                    "Let me clarify—if the system isn't working, that's a repair situation.",
                    "A tune-up is for working systems. Let's address your repair first.",
                    "We should fix what's wrong first, then discuss maintenance.",
                    "Sounds like we need to send someone for a repair visit."
                ],
                fullReplies: [
                    "I hear you wanting a tune-up, but it sounds like your system has an issue that needs repair first—not cooling, not starting, or making noise goes beyond maintenance. Let's schedule a repair visit to diagnose and fix the problem. Once it's running properly, then we can talk about preventive maintenance to keep it that way.",
                    "Just to clarify: a tune-up is preventive maintenance for a working system. What you're describing sounds like the system needs repair. We should address the immediate problem first. Once it's fixed, a maintenance plan can help prevent future issues.",
                    "It sounds like there's an active problem that needs to be fixed before we talk about maintenance. A tune-up on a system that's not working properly won't solve the underlying issue. Let's get a technician out to diagnose what's wrong first."
                ],
                actionHooks: ['redirect_to_repair', 'offer_scheduling'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.6
            },
            {
                name: 'Needs Maintenance But Describing Like Repair',
                priority: 4,
                triggers: [
                    "ac needs fixing but it's working", "repair my system it's fine though",
                    "something wrong but it works", "needs service but no problems"
                ],
                negativeTriggers: [
                    "actual problem", "not working"
                ],
                quickReplies: [
                    "If it's working but you want it checked, that's maintenance.",
                    "Sounds like preventive maintenance is what you're after.",
                    "Good thinking—proactive service prevents problems.",
                    "A tune-up would be perfect for your situation.",
                    "Let's set you up with maintenance service."
                ],
                fullReplies: [
                    "If your system is working okay but you want it checked out, that's actually preventive maintenance rather than repair—and that's smart! A tune-up will make sure everything is running efficiently and catch any potential issues before they become problems. Would you like to schedule one?",
                    "What you're describing sounds like routine maintenance, which is great because you're being proactive. A tune-up will ensure your system is clean, running efficiently, and not developing any issues. That's the best way to avoid unexpected breakdowns.",
                    "Perfect—if the system is functioning but you want to make sure it stays that way, maintenance is the right call. We'll clean the coils, check refrigerant levels, inspect electrical connections, and make sure everything is in good shape."
                ],
                actionHooks: ['redirect_to_maintenance', 'offer_scheduling'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.5
            }
        ]
    },

    wrongDepartment: {
        id: 'cat-1764756074554',
        name: 'Wrong Department / Wrong Number',
        scenarios: [
            {
                name: 'Called Wrong Company',
                priority: 7,
                triggers: [
                    "wrong number", "is this", "thought this was", "looking for different company",
                    "trying to reach", "meant to call", "didn't mean to call you",
                    "who is this", "what company is this"
                ],
                negativeTriggers: [
                    "hvac service", "air conditioning", "heating"
                ],
                quickReplies: [
                    "This is {{companyName}}, an HVAC company. How can I help?",
                    "You've reached {{companyName}}. We do heating and cooling.",
                    "Hi, this is {{companyName}}. Were you looking for HVAC service?",
                    "This is {{companyName}}—we handle heating and air conditioning.",
                    "You've reached {{companyName}}. What can I help you with?"
                ],
                fullReplies: [
                    "Hi, you've reached {{companyName}}. We're a heating and air conditioning company. If you need HVAC service, you're in the right place! If you were looking for something else, I'd be happy to help you figure out the right number.",
                    "This is {{companyName}}, and we specialize in HVAC—heating, cooling, and air quality. If that's what you need, I can definitely help. If you were trying to reach a different type of business, I apologize for any confusion.",
                    "You've reached {{companyName}}. We handle all things HVAC—repairs, maintenance, and installations for heating and cooling systems. If that's not what you're looking for, no worries. Otherwise, how can I help you today?"
                ],
                actionHooks: ['clarify_company'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.3
            },
            {
                name: 'Non-HVAC Request',
                priority: 6,
                triggers: [
                    "plumbing problem", "electrical issue", "appliance repair",
                    "roof leak", "pest control", "landscaping", "general contractor",
                    "do you do plumbing", "can you fix my refrigerator"
                ],
                negativeTriggers: [
                    "hvac", "heating", "cooling", "air conditioning"
                ],
                quickReplies: [
                    "We specialize in HVAC, not that type of service.",
                    "That's outside our expertise—we focus on heating and cooling.",
                    "We only handle HVAC. You'd need a different company for that.",
                    "Sorry, we're specifically an HVAC company.",
                    "That's not something we do, but I can clarify what we handle."
                ],
                fullReplies: [
                    "I appreciate you calling, but that's not something we handle. We specialize specifically in heating and cooling systems—furnaces, air conditioners, heat pumps, and related equipment. For plumbing, electrical, or appliance issues, you'd need to contact a different company. Is there anything HVAC-related I can help with?",
                    "We're strictly an HVAC company, so we handle heating, air conditioning, and indoor air quality. What you're describing would need a different type of contractor. If you do have any heating or cooling needs, I'd be happy to help with that.",
                    "Sorry, that's outside what we do. We focus exclusively on HVAC—air conditioners, furnaces, heat pumps, and ventilation. For other home services, you'd need to reach out to the appropriate specialist. But if you have heating or cooling needs, we're your company!"
                ],
                actionHooks: ['clarify_services'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.4
            }
        ]
    },

    booking: {
        id: 'cat-1765022391681',
        name: 'Booking',
        scenarios: [
            {
                name: 'Ready to Schedule Appointment',
                priority: 8,
                triggers: [
                    "schedule an appointment", "book a service call", "need someone to come out",
                    "want to schedule service", "set up an appointment", "book a technician",
                    "schedule a visit", "make an appointment", "book time"
                ],
                negativeTriggers: [
                    "just asking questions", "not ready to book", "thinking about it"
                ],
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
                negativeTriggers: [
                    "new appointment", "first time booking"
                ],
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
            },
            {
                name: 'Confirm Appointment',
                priority: 5,
                triggers: [
                    "confirm my appointment", "verify my service call", "do I have an appointment",
                    "check my booking", "when is my appointment", "confirm technician coming",
                    "what time is my service"
                ],
                negativeTriggers: [
                    "schedule new", "book appointment"
                ],
                quickReplies: [
                    "Let me look up your appointment.",
                    "I can verify that for you.",
                    "Let me check your booking status.",
                    "I'll pull up your appointment details.",
                    "Let me confirm your service call."
                ],
                fullReplies: [
                    "I can definitely check on your appointment. Can you give me the name or phone number it's under? I'll pull up the details and confirm the date, time, and what service is scheduled.",
                    "Of course! Let me look up your booking. What's the name on the account? I'll verify the appointment date and arrival window for you.",
                    "Happy to confirm that for you. Once you give me your name or phone number, I can see exactly when your technician is scheduled to arrive and what service is on the books."
                ],
                actionHooks: ['lookup_appointment'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.6
            }
        ]
    }
};

module.exports = { TEMPLATE_ID, CATEGORIES };

