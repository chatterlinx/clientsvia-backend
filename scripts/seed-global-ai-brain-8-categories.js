/**
 * ============================================================================
 * GLOBAL AI BRAIN - TESTING VERSION (8 CATEGORIES)
 * ============================================================================
 * 
 * PURPOSE: Create a lean, focused set of 8 most critical conversation scenarios
 * for testing and validation before scaling to 100+
 * 
 * CATEGORIES:
 * 1. Empathy/Compassion - Upset callers
 * 2. Urgent/Action-Oriented - Emergency requests
 * 3. De-escalation/Frustration - Angry callers
 * 4. Positive/Enthusiastic - Happy customers
 * 5. Hold/Wait - "Let me check my calendar"
 * 6. Booking/Confirming - Schedule appointments
 * 7. Price Inquiry - "How much does it cost?"
 * 8. Greeting/Welcome - "How are you?"
 * 
 * ============================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');

console.log('🧠 Creating Focused 8-Category Global AI Brain for Testing...\n');

const eightCategories = [
    {
        id: 'empathy-compassion',
        name: 'Empathy / Compassion',
        icon: '❤️',
        description: 'Calm, validating feelings, brief reassurance then action',
        priority: 10,
        type: 'emotional_intelligence',
        scenarios: [
            {
                id: 'upset-crying',
                name: 'Upset / Distressed',
                triggers: ["i'm so upset", "this is terrible", "i'm crying", "i don't know what to do", "i'm devastated"],
                quickReply: "I'm so sorry — I can help.",
                fullReply: "I'm really sorry you're going through that. I hear how upsetting this is — I'll stay with you and get this sorted. Can I confirm a few quick details so I can help right away?",
                tone: 'empathetic',
                pace: 'slow',
                priority: 10,
                escalationFlags: ['immediate_human_transfer_if_requested'],
                examples: [{ caller: "I'm so upset about this!", ai: "I'm really sorry — tell me the best way I can help right now." }]
            }
        ]
    },
    {
        id: 'urgent-action',
        name: 'Urgent / Action-Oriented',
        icon: '🚨',
        description: 'Short sentences, decisive verbs, immediate action',
        priority: 9,
        type: 'emotional_intelligence',
        scenarios: [
            {
                id: 'urgent-asap',
                name: 'Urgent / ASAP',
                triggers: ["asap", "right now", "can't wait", "emergency", "immediately", "urgent"],
                quickReply: "Understood — I'll prioritize this now.",
                fullReply: "I understand the urgency. I'm marking this as high priority and connecting you with the next available team member. Can you confirm your address while I connect?",
                tone: 'urgent',
                pace: 'fast',
                priority: 9,
                escalationFlags: ['immediate_transfer', 'priority_ticket'],
                examples: [{ caller: "I need someone right now!", ai: "Understood. I'm prioritizing this and will connect you immediately." }]
            }
        ]
    },
    {
        id: 'deescalation-frustration',
        name: 'De-escalation / Frustration',
        icon: '😤',
        description: 'Short empathy + ownership + immediate corrective steps',
        priority: 9,
        type: 'emotional_intelligence',
        scenarios: [
            {
                id: 'angry-frustrated',
                name: 'Angry / Frustrated',
                triggers: ["this is ridiculous", "i want a manager", "this is unacceptable", "i'm so frustrated", "this is terrible"],
                quickReply: "I'm sorry this happened — let me make it right.",
                fullReply: "I'm sorry you've been inconvenienced. I'll do everything I can to fix this quickly — can I get your account number so I can escalate if needed?",
                tone: 'apologetic',
                pace: 'normal',
                priority: 9,
                escalationFlags: ['immediate_manager_notification', 'log_complaint'],
                examples: [{ caller: "This is ridiculous!", ai: "I'm really sorry. Tell me what happened and I'll take care of it." }]
            }
        ]
    },
    {
        id: 'positive-enthusiastic',
        name: 'Positive / Enthusiastic',
        icon: '😊',
        description: 'Warm, upbeat, match energy but remain professional',
        priority: 5,
        type: 'emotional_intelligence',
        scenarios: [
            {
                id: 'happy-excited',
                name: 'Happy / Excited',
                triggers: ["great", "thanks", "that sounds good", "awesome", "perfect", "fantastic"],
                quickReply: "Fantastic — glad we could help!",
                fullReply: "That's great to hear! I've booked that for you — you'll get a confirmation by text/email shortly. Anything else I can do?",
                tone: 'enthusiastic',
                pace: 'normal',
                priority: 5,
                escalationFlags: ['upsell_opportunity'],
                examples: [{ caller: "That sounds perfect!", ai: "Fantastic! I'll get that set up for you right away." }]
            }
        ]
    },
    {
        id: 'hold-wait',
        name: 'Hold / Wait ("Let me check")',
        icon: '⏸️',
        description: 'Offer options, set expectations, handle silence gracefully',
        priority: 7,
        type: 'call_flow',
        scenarios: [
            {
                id: 'check-calendar',
                name: 'Checking Calendar / Need Moment',
                triggers: ["hold on", "let me check", "hang on", "one moment", "let me see", "hmm that day", "checking my calendar"],
                quickReply: "No problem — take your time.",
                fullReply: "Sure — take your time. I can hold or call you back at a time you choose. Which would you prefer?",
                tone: 'professional',
                pace: 'normal',
                priority: 7,
                escalationFlags: ['silence_threshold_60s'],
                examples: [
                    { caller: "Hmm that day sounds good let me check my calendar", ai: "Absolutely — let me know. I can hold or set a callback." },
                    { caller: "Hold on a moment", ai: "No problem, I'll wait." }
                ]
            }
        ]
    },
    {
        id: 'booking-confirming',
        name: 'Booking / Confirming Appointment',
        icon: '📅',
        description: 'Repeat back details, give next steps, send confirmation',
        priority: 8,
        type: 'scheduling',
        scenarios: [
            {
                id: 'schedule-appointment',
                name: 'Schedule / Book Appointment',
                triggers: ["book", "schedule", "appointment", "make a reservation", "set up a time", "when can you come"],
                quickReply: "I can schedule that for you.",
                fullReply: "I'd be happy to schedule that. What day and time works best for you?",
                tone: 'professional',
                pace: 'normal',
                priority: 8,
                escalationFlags: ['check_availability'],
                examples: [{ caller: "I need to book an appointment", ai: "I'd be happy to schedule that. What day works best for you?" }]
            }
        ]
    },
    {
        id: 'price-inquiry',
        name: 'Price Inquiry / Estimate',
        icon: '💰',
        description: 'Clear answer if available, otherwise promise follow-up with ETA',
        priority: 7,
        type: 'payment',
        scenarios: [
            {
                id: 'how-much',
                name: 'How Much / Cost / Price',
                triggers: ["how much", "price", "cost", "estimate", "how much does it cost", "what do you charge"],
                quickReply: "Typical costs range from [range].",
                fullReply: "For that service, typical costs range from $X to $Y depending on scope. I can get a precise estimate if you share more details, or schedule a technician for an exact quote.",
                tone: 'professional',
                pace: 'normal',
                priority: 7,
                escalationFlags: ['needs_detailed_info_for_quote'],
                examples: [{ caller: "How much does it cost?", ai: "For that service, typical costs range from $X-$Y. I can get an exact quote with more details." }]
            }
        ]
    },
    {
        id: 'greeting-welcome',
        name: 'Greeting / Small Talk',
        icon: '👋',
        description: 'Brief friendly response then redirect to purpose',
        priority: 4,
        type: 'small_talk',
        scenarios: [
            {
                id: 'how-are-you',
                name: 'How Are You / What\'s Up',
                triggers: ["how are you", "what's up", "how's it going", "good morning", "good afternoon", "hi", "hello"],
                quickReply: "Doing well, thanks — how can I help?",
                fullReply: "I'm doing well, thanks! How can I help you with your appointment or service today?",
                tone: 'friendly',
                pace: 'normal',
                priority: 4,
                escalationFlags: [],
                examples: [{ caller: "How are you?", ai: "I'm doing well, thanks! How can I help you today?" }]
            }
        ]
    }
];

async function seedEightCategories() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');
        
        const existingTemplate = await GlobalInstantResponseTemplate.findOne({ version: 'v1.0.0-test' });
        if (existingTemplate) {
            console.log('⚠️  Test template already exists, deleting...');
            await GlobalInstantResponseTemplate.deleteOne({ version: 'v1.0.0-test' });
        }
        
        const template = new GlobalInstantResponseTemplate({
            version: 'v1.0.0-test',
            name: 'ClientVia.ai Global AI Brain (Testing)',
            description: 'Focused 8-category set for testing and validation',
            isActive: true,
            categories: eightCategories,
            createdBy: 'Platform Admin',
            changeLog: [{
                changes: 'Created focused 8-category test version',
                changedBy: 'Platform Admin'
            }]
        });
        
        await template.save();
        
        console.log('✅ ============================================================================');
        console.log('✅ GLOBAL AI BRAIN TEST VERSION CREATED!');
        console.log('✅ ============================================================================\n');
        console.log(`📊 Template Stats:`);
        console.log(`   - Version: ${template.version}`);
        console.log(`   - Categories: ${template.stats.totalCategories}`);
        console.log(`   - Scenarios: ${template.stats.totalScenarios}`);
        console.log(`   - Triggers: ${template.stats.totalTriggers}`);
        console.log(`   - Active: ${template.isActive ? 'YES ✅' : 'NO'}\n`);
        
        console.log('🎯 Next Steps:');
        console.log('   1. Visit /admin-global-instant-responses.html');
        console.log('   2. Verify all 8 categories display correctly');
        console.log('   3. Test frontend functionality');
        console.log('   4. Once solid, expand to full 100+ categories\n');
        
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

seedEightCategories();

