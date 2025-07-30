/**
 * Template Intelligence Engine Test
 * Quick test to verify integration with Answer Priority Flow
 */

const TemplateIntelligenceEngine = require('./templateIntelligenceEngine');
const Company = require('../models/Company');

async function testTemplateEngine() {
    console.log('🧪 Testing Template Intelligence Engine...\n');

    // Mock company data (simulating your multi-tenant structure)
    const mockCompany = {
        _id: 'test-company-123',
        companyName: 'ABC Plumbing Services',
        tradeTypes: ['Plumbing', 'Drain Cleaning'],
        businessHours: 'Monday-Friday 8AM-6PM',
        website: 'www.abcplumbing.com',
        agentPersonality: {
            voiceTone: 'friendly',
            speechPace: 'normal',
            useEmojis: true,
            allowBargeIn: true,
            acknowledgeEmotion: true
        },
        responseCategories: {
            greeting: "Hi {{callerName}}! Thanks for calling {{companyName}}. How can I help you today?",
            farewell: "Thanks for calling {{companyName}}! Have a great day!",
            hold: "Please hold for just a moment while I {{estimatedTime}} look that up for you.",
            transfer: "Let me connect you with {{departmentName}} who can better assist you.",
            businessHours: "We're open {{businessHours}}. You can also visit our website at {{website}}."
        }
    };

    const engine = new TemplateIntelligenceEngine();
    
    // Test cases that should match your Response Categories
    const testQueries = [
        { query: "Hello, good morning", expected: "greeting" },
        { query: "What are your business hours?", expected: "business_hours" },
        { query: "I need to schedule an appointment", expected: "scheduling" },
        { query: "This is an emergency, my pipe burst!", expected: "emergency" },
        { query: "What services do you provide?", expected: "service_inquiry" },
        { query: "Can you transfer me to a manager?", expected: "transfer" },
        { query: "Thanks, goodbye!", expected: "farewell" }
    ];

    console.log('Testing Template Intelligence responses:\n');

    for (const test of testQueries) {
        const result = await engine.processQuery(test.query, mockCompany._id, {
            callerName: 'John',
            departmentName: 'our specialist'
        });

        if (result) {
            console.log(`✅ Query: "${test.query}"`);
            console.log(`   Category: ${result.category} (${(result.confidence * 100).toFixed(1)}%)`);
            console.log(`   Response: "${result.response}"`);
            console.log(`   Template: ${result.templateUsed}`);
            console.log(`   Personality: ${JSON.stringify(result.personalityApplied)}\n`);
        } else {
            console.log(`❌ Query: "${test.query}" - No template match\n`);
        }
    }

    console.log('🎯 Template Intelligence Engine test completed!');
}

// Uncomment to run test
// testTemplateEngine().catch(console.error);

module.exports = { testTemplateEngine };
