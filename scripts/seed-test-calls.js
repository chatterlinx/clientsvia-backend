// ============================================================================
// TEST CALL LOGS SEEDER
// ============================================================================
// 📋 PURPOSE: Create realistic test data for Call Archives testing
// 🎯 CREATES:
//    - 20 sample call logs with realistic transcripts
//    - Mix of confidence scores (high, medium, low)
//    - Mix of sources (Company Q&A, Trade Q&A, Templates, Fallback)
//    - Mix of sentiments (positive, neutral, negative)
//    - Date range: Last 7 days
// ============================================================================

require('dotenv').config();
const mongoose = require('mongoose');
const v2AIAgentCallLog = require('../models/v2AIAgentCallLog');

// Sample realistic call transcripts
const SAMPLE_CALLS = [
    {
        userMessage: "Do you offer emergency plumbing services?",
        transcript: "Customer: Do you offer emergency plumbing services?\nAI: Yes, we provide 24/7 emergency plumbing services. Our team can respond within 2 hours for urgent issues like burst pipes or major leaks.",
        confidence: 0.95,
        source: 'companyQnA',
        sentiment: 'positive'
    },
    {
        userMessage: "What are your business hours?",
        transcript: "Customer: What are your business hours?\nAI: We're open Monday through Friday from 8 AM to 6 PM, and Saturday from 9 AM to 3 PM. For emergencies, we have on-call service 24/7.",
        confidence: 0.98,
        source: 'companyQnA',
        sentiment: 'neutral'
    },
    {
        userMessage: "How much does it cost to fix a leaky faucet?",
        transcript: "Customer: How much does it cost to fix a leaky faucet?\nAI: The typical cost for faucet repair ranges from $150 to $300, depending on the type of faucet and the complexity of the issue. We can provide a detailed quote after inspection.",
        confidence: 0.87,
        source: 'tradeQnA',
        sentiment: 'neutral'
    },
    {
        userMessage: "Can you come today?",
        transcript: "Customer: Can you come today?\nAI: Let me check our schedule. We have availability this afternoon between 2-4 PM. Would that work for you?",
        confidence: 0.92,
        source: 'templates',
        sentiment: 'positive'
    },
    {
        userMessage: "My basement is flooding!",
        transcript: "Customer: My basement is flooding!\nAI: This is an emergency. I'm dispatching our emergency crew to your location right away. Please turn off the main water valve if you can safely access it. We'll be there within the hour.",
        confidence: 0.96,
        source: 'companyQnA',
        sentiment: 'negative'
    },
    {
        userMessage: "Do you install water heaters?",
        transcript: "Customer: Do you install water heaters?\nAI: Yes, we install all types of water heaters including tankless, electric, and gas models. We offer free estimates and can usually complete installation within 1-2 days.",
        confidence: 0.94,
        source: 'tradeQnA',
        sentiment: 'positive'
    },
    {
        userMessage: "What payment methods do you accept?",
        transcript: "Customer: What payment methods do you accept?\nAI: We accept all major credit cards, debit cards, cash, and checks. We also offer financing options for larger projects.",
        confidence: 0.99,
        source: 'companyQnA',
        sentiment: 'neutral'
    },
    {
        userMessage: "My toilet won't stop running",
        transcript: "Customer: My toilet won't stop running\nAI: A running toilet is usually caused by a faulty flapper or fill valve. This is a common issue we can fix quickly. Would you like to schedule a service call?",
        confidence: 0.89,
        source: 'tradeQnA',
        sentiment: 'neutral'
    },
    {
        userMessage: "Are you licensed and insured?",
        transcript: "Customer: Are you licensed and insured?\nAI: Yes, we are fully licensed, bonded, and insured. Our license number is #12345 and we carry comprehensive liability insurance for your protection.",
        confidence: 0.97,
        source: 'companyQnA',
        sentiment: 'positive'
    },
    {
        userMessage: "How long have you been in business?",
        transcript: "Customer: How long have you been in business?\nAI: We've been serving the local community for over 15 years. Our experienced team has handled thousands of plumbing projects ranging from simple repairs to complex installations.",
        confidence: 0.93,
        source: 'companyQnA',
        sentiment: 'positive'
    },
    {
        userMessage: "Can you snake my drain?",
        transcript: "Customer: Can you snake my drain?\nAI: Yes, we provide professional drain cleaning and snaking services. We use advanced equipment to clear even the toughest clogs. Standard drain cleaning starts at $125.",
        confidence: 0.91,
        source: 'tradeQnA',
        sentiment: 'positive'
    },
    {
        userMessage: "I need a quote for bathroom remodel",
        transcript: "Customer: I need a quote for bathroom remodel\nAI: I'd be happy to help with that. Bathroom remodels typically include plumbing updates, fixture installation, and pipe rerouting. We offer free consultations and detailed quotes. When would you like to schedule an assessment?",
        confidence: 0.85,
        source: 'templates',
        sentiment: 'positive'
    },
    {
        userMessage: "Do you work on weekends?",
        transcript: "Customer: Do you work on weekends?\nAI: Yes, we're available on Saturdays from 9 AM to 3 PM for scheduled appointments. For emergency services, we're available 24/7 including weekends and holidays.",
        confidence: 0.96,
        source: 'companyQnA',
        sentiment: 'neutral'
    },
    {
        userMessage: "My water pressure is really low",
        transcript: "Customer: My water pressure is really low\nAI: Low water pressure can be caused by several issues including clogged aerators, valve problems, or pipe corrosion. We can diagnose and fix the issue. Would you like to schedule an inspection?",
        confidence: 0.88,
        source: 'tradeQnA',
        sentiment: 'neutral'
    },
    {
        userMessage: "Do you offer warranties?",
        transcript: "Customer: Do you offer warranties?\nAI: Yes, we provide a 1-year warranty on all labor and installation work. Parts are covered by manufacturer warranties which we'll help you with if any issues arise.",
        confidence: 0.95,
        source: 'companyQnA',
        sentiment: 'positive'
    },
    {
        userMessage: "Can you repair a slab leak?",
        transcript: "Customer: Can you repair a slab leak?\nAI: Yes, we specialize in slab leak detection and repair. We use electronic leak detection equipment to locate the issue without unnecessary excavation. This is a complex job that requires experienced professionals.",
        confidence: 0.84,
        source: 'tradeQnA',
        sentiment: 'neutral'
    },
    {
        userMessage: "What's your phone number?",
        transcript: "Customer: What's your phone number?\nAI: I'm sorry, I don't have that information readily available. You can find our contact details on our website or I can have someone call you back with that information.",
        confidence: 0.45,
        source: 'inHouseFallback',
        sentiment: 'neutral'
    },
    {
        userMessage: "Do you have references?",
        transcript: "Customer: Do you have references?\nAI: Yes, we have hundreds of satisfied customers and maintain a 4.8-star rating on Google. We'd be happy to provide references from recent customers in your area. We also have testimonials on our website.",
        confidence: 0.92,
        source: 'companyQnA',
        sentiment: 'positive'
    },
    {
        userMessage: "My garbage disposal is broken",
        transcript: "Customer: My garbage disposal is broken\nAI: Garbage disposal issues are common and usually fixable. Sometimes it's just a reset button or a jam that needs clearing. If it needs replacement, we can install a new one the same day. Would you like to schedule a service call?",
        confidence: 0.90,
        source: 'tradeQnA',
        sentiment: 'neutral'
    },
    {
        userMessage: "How do I turn off my water main?",
        transcript: "Customer: How do I turn off my water main?\nAI: The main water shutoff valve is usually located near your water meter, often in the basement, garage, or outside near the street. Turn the valve clockwise to shut off the water. If you can't locate it or need immediate assistance, we can send someone right away.",
        confidence: 0.86,
        source: 'templates',
        sentiment: 'positive'
    }
];

async function seedTestCalls() {
    try {
        console.log('🌱 [SEED] Starting test call logs seeding...');
        console.log('🌱 [SEED] CHECKPOINT 1: Connecting to MongoDB...');

        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ [SEED] CHECKPOINT 2: Connected to MongoDB');

        // Get first company from database
        const v2Company = require('../models/v2Company');
        const company = await v2Company.findOne();

        if (!company) {
            console.error('❌ [SEED] No company found in database. Please create a company first.');
            process.exit(1);
        }

        console.log(`✅ [SEED] CHECKPOINT 3: Using company: ${company.companyName} (${company._id})`);

        // Check existing test calls
        const existingCalls = await v2AIAgentCallLog.countDocuments({ 
            companyId: company._id,
            userMessage: { $in: SAMPLE_CALLS.map(c => c.userMessage) }
        });

        if (existingCalls > 0) {
            console.log(`⚠️ [SEED] Found ${existingCalls} existing test calls. Deleting...`);
            await v2AIAgentCallLog.deleteMany({ 
                companyId: company._id,
                userMessage: { $in: SAMPLE_CALLS.map(c => c.userMessage) }
            });
            console.log('✅ [SEED] CHECKPOINT 4: Cleaned up existing test calls');
        }

        // Create test calls
        console.log('🌱 [SEED] CHECKPOINT 5: Creating 20 test call logs...');

        const callsToInsert = SAMPLE_CALLS.map((call, index) => {
            // Distribute calls over last 7 days
            const daysAgo = Math.floor(index / 3);
            const createdAt = new Date();
            createdAt.setDate(createdAt.getDate() - daysAgo);

            return {
                companyId: company._id,
                userMessage: call.userMessage,
                finalConfidenceScore: call.confidence,
                finalMatchedSource: call.source,
                wasSuccessful: call.confidence > 0.7,
                queryType: 'voice',
                
                // Transcript data (System 2 - Call Archives)
                conversation: {
                    fullTranscript: {
                        plainText: call.transcript,
                        formatted: call.transcript
                    },
                    recordingStatus: 'completed'
                },
                
                // Searchability metadata
                searchMetadata: {
                    sentiment: call.sentiment,
                    keywords: call.userMessage.toLowerCase().split(' ').filter(w => w.length > 3),
                    language: 'en'
                },
                
                createdAt,
                updatedAt: createdAt
            };
        });

        const insertedCalls = await v2AIAgentCallLog.insertMany(callsToInsert);

        console.log('✅ [SEED] CHECKPOINT 6: Successfully created test calls');
        console.log(`✅ [SEED] Created ${insertedCalls.length} call logs`);
        console.log('');
        console.log('📊 [SEED] BREAKDOWN:');
        console.log(`   - High Confidence (>0.9): ${callsToInsert.filter(c => c.finalConfidenceScore > 0.9).length}`);
        console.log(`   - Medium Confidence (0.7-0.9): ${callsToInsert.filter(c => c.finalConfidenceScore >= 0.7 && c.finalConfidenceScore <= 0.9).length}`);
        console.log(`   - Low Confidence (<0.7): ${callsToInsert.filter(c => c.finalConfidenceScore < 0.7).length}`);
        console.log('');
        console.log(`   - Company Q&A: ${callsToInsert.filter(c => c.finalMatchedSource === 'companyQnA').length}`);
        console.log(`   - Trade Q&A: ${callsToInsert.filter(c => c.finalMatchedSource === 'tradeQnA').length}`);
        console.log(`   - Templates: ${callsToInsert.filter(c => c.finalMatchedSource === 'templates').length}`);
        console.log(`   - Fallback: ${callsToInsert.filter(c => c.finalMatchedSource === 'inHouseFallback').length}`);
        console.log('');
        console.log(`   - Positive: ${callsToInsert.filter(c => c.searchMetadata.sentiment === 'positive').length}`);
        console.log(`   - Neutral: ${callsToInsert.filter(c => c.searchMetadata.sentiment === 'neutral').length}`);
        console.log(`   - Negative: ${callsToInsert.filter(c => c.searchMetadata.sentiment === 'negative').length}`);
        console.log('');
        console.log('🎉 [SEED] Seeding complete! You can now test Call Archives with real data.');
        console.log('');
        console.log('🧪 TEST EXAMPLES:');
        console.log('   - Search for "emergency" or "plumbing" in Call Archives');
        console.log('   - Filter by confidence score: 0.9-1.0');
        console.log('   - Filter by source: companyQnA, tradeQnA, templates');
        console.log('   - Filter by sentiment: positive, neutral, negative');
        console.log('   - Export to CSV and verify all fields');

        await mongoose.disconnect();
        console.log('✅ [SEED] Disconnected from MongoDB');
        process.exit(0);

    } catch (error) {
        console.error('❌ [SEED] ERROR:', error);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run seeder
seedTestCalls();

