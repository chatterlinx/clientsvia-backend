/**
 * Create a sample company with proper AI agent knowledge base data
 * This will help test and demonstrate the AI agent's capabilities
 */

const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');

async function setupSampleCompany() {
    try {
        // Connect to MongoDB using mongoose (same as server)
        const mongoUri = 'mongodb://localhost:27017/clientsvia-test'; // Match the server's database
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB');
        
        console.log('🏗️  Setting up sample company with AI knowledge base...');
        
        // Use mongoose connection to get db
        const db = mongoose.connection.db;
        
        // Sample HVAC company with comprehensive knowledge base
        const sampleCompany = {
            _id: new ObjectId(),
            companyName: "Elite HVAC Services",
            businessType: "HVAC Contractor",
            tradeTypes: ["hvac-residential", "hvac-commercial", "plumbing"],
            city: "San Francisco",
            state: "CA",
            phone: "+1-555-HVAC-123",
            email: "info@elitehvac.com",
            
            // AI Agent Setup with comprehensive knowledge
            agentSetup: {
                mainAgentScript: `Welcome to Elite HVAC Services! I'm your AI assistant, ready to help with all your heating, cooling, and plumbing needs.

We're a family-owned business serving San Francisco and the Bay Area for over 15 years. Our certified technicians specialize in:
- Residential and commercial HVAC systems
- Emergency heating and cooling repairs
- Air conditioning installation and maintenance  
- Furnace repair and replacement
- Duct cleaning and indoor air quality
- Plumbing services and water heaters

We're available 24/7 for emergency services and offer free estimates on new installations. Our goal is to keep your home comfortable year-round with reliable, professional service.

How can I help you today?`,

                categoryQAs: `Q: My heater isn't working, what should I do?
A: I'm sorry to hear your heater isn't working! Let me help you troubleshoot. First, check if your thermostat is set to "heat" and the temperature is higher than the current room temperature. Also check if your circuit breaker has tripped. If these look good, you may need professional service. Would you like me to schedule an emergency repair visit?

Q: How much does a new air conditioner cost?
A: Air conditioner costs vary based on your home size and efficiency needs. For a typical San Francisco home, you can expect $3,500-$7,500 for a quality central AC system including installation. We offer free in-home estimates and financing options. Would you like to schedule a consultation?

Q: Do you provide emergency services?
A: Yes! We provide 24/7 emergency HVAC services throughout San Francisco and the Bay Area. Emergency service calls are $150, which goes toward any repair work. We typically arrive within 2 hours for emergencies. Would you like me to dispatch a technician?

Q: My air conditioner is making strange noises
A: Strange noises from your AC usually indicate a mechanical issue that needs attention. Common causes include loose parts, refrigerant leaks, or motor problems. I'd recommend scheduling a service call to prevent further damage. Our diagnostic fee is $95 and goes toward any repairs. Shall I book an appointment?

Q: How often should I change my air filter?
A: You should change your air filter every 1-3 months, depending on usage and filter type. During peak seasons (summer/winter), check monthly. Signs you need a new filter include reduced airflow, dusty home, or increased energy bills. We can set up a maintenance plan to remind you!

Q: What's included in your maintenance service?
A: Our comprehensive maintenance includes: cleaning and inspecting all components, checking refrigerant levels, testing electrical connections, lubricating moving parts, and a full system performance check. Annual maintenance costs $150 and can prevent 85% of common breakdowns.`,

                categories: ["hvac-residential", "hvac-commercial", "plumbing", "emergency-service"],
                
                placeholders: [
                    { name: "company_name", value: "Elite HVAC Services" },
                    { name: "phone", value: "555-HVAC-123" },
                    { name: "service_area", value: "San Francisco and Bay Area" },
                    { name: "emergency_fee", value: "$150" },
                    { name: "diagnostic_fee", value: "$95" },
                    { name: "maintenance_cost", value: "$150" }
                ]
            },
            
            // AI Settings
            aiSettings: {
                model: "gemini-1.5-flash-002",
                fuzzyMatchThreshold: 0.15,
                llmFallbackEnabled: true,
                ollamaFallbackEnabled: true,
                customEscalationMessage: "Let me connect you with one of our experienced technicians who can provide specialized assistance.",
                personality: "professional and helpful",
                
                // Company-specific Q&As in new format
                companyQAs: [
                    {
                        question: "What are your hours?",
                        answer: "We're open Monday-Friday 7 AM to 6 PM, and Saturday 8 AM to 4 PM for regular service. We provide 24/7 emergency services for heating and cooling emergencies."
                    },
                    {
                        question: "Do you offer financing?",
                        answer: "Yes! We offer flexible financing options with approved credit, including 0% interest for 12 months on qualifying purchases. We also accept all major credit cards and offer senior discounts."
                    },
                    {
                        question: "Are you licensed and insured?",
                        answer: "Absolutely! We're fully licensed (License #12345), bonded, and insured. All our technicians are EPA certified and regularly trained on the latest HVAC technologies."
                    }
                ]
            },
            
            // Agent Intelligence Settings for the new system
            agentIntelligenceSettings: {
                tradeCategories: ["hvac-residential", "hvac-commercial", "plumbing"],
                useLLM: true,
                primaryLLM: "gemini-pro",
                fallbackLLM: "gemini-pro",
                allowedLLMs: ["gemini-pro"],
                memoryMode: "conversation",
                fallbackThreshold: 0.5,
                escalationMode: "ask",
                rePromptAfterTurns: 2,
                maxPromptsPerCall: 3,
                semanticSearchEnabled: true,
                confidenceScoring: true,
                autoLearningQueue: true
            },
            
            // Booking flow configuration
            bookingFlow: [
                {
                    step: "contact_info",
                    prompt: "I'll be happy to schedule a service call. May I have your name and phone number?",
                    required_fields: ["name", "phone"]
                },
                {
                    step: "service_type", 
                    prompt: "What type of service do you need - heating, cooling, or plumbing?",
                    required_fields: ["service_type"]
                },
                {
                    step: "urgency",
                    prompt: "Is this an emergency that needs immediate attention, or can we schedule for regular business hours?",
                    required_fields: ["urgency"]
                },
                {
                    step: "confirmation",
                    prompt: "Perfect! I've scheduled your {service_type} service call. A technician will contact you within {timeframe} to confirm the appointment time."
                }
            ],
            
            createdAt: new Date(),
            updatedAt: new Date()
        };
        
        // Insert the sample company
        const result = await db.collection('companiesCollection').insertOne(sampleCompany);
        console.log(`✅ Created sample company: ${sampleCompany.companyName}`);
        console.log(`   Company ID: ${result.insertedId}`);
        console.log(`   Trade Categories: ${sampleCompany.tradeTypes.join(', ')}`);
        console.log(`   Knowledge Base: ${sampleCompany.agentSetup.categoryQAs.length} chars of Q&As`);
        console.log(`   Company Q&As: ${sampleCompany.aiSettings.companyQAs.length} entries`);
        
        // Also create trade category data if it doesn't exist
        console.log('\n🏭 Setting up trade category knowledge base...');
        
        const tradeCategories = [
            {
                name: "hvac-residential",
                displayName: "Residential HVAC",
                commonQAs: [
                    {
                        question: "Why is my furnace not heating properly?",
                        answer: "Common causes include a dirty air filter, thermostat issues, pilot light problems, or a malfunctioning heat exchanger. I recommend having a certified technician diagnose the issue to ensure safe operation."
                    },
                    {
                        question: "How can I improve my home's energy efficiency?",
                        answer: "Consider upgrading to a high-efficiency HVAC system, sealing air leaks, improving insulation, and scheduling regular maintenance. A programmable thermostat can also reduce energy costs by 10-15%."
                    },
                    {
                        question: "What size AC unit do I need?",
                        answer: "AC sizing depends on your home's square footage, insulation, windows, and climate. A unit that's too small won't cool effectively, while an oversized unit wastes energy. We provide free load calculations to determine the perfect size."
                    }
                ]
            },
            {
                name: "hvac-commercial", 
                displayName: "Commercial HVAC",
                commonQAs: [
                    {
                        question: "How often should commercial HVAC systems be serviced?",
                        answer: "Commercial systems should be serviced quarterly due to heavy usage. This includes filter changes, coil cleaning, belt inspection, and system performance checks to maintain efficiency and prevent costly breakdowns."
                    },
                    {
                        question: "What are the benefits of a maintenance contract?",
                        answer: "Maintenance contracts provide priority service, reduced repair costs, extended equipment life, improved energy efficiency, and compliance with warranty requirements. Most contracts pay for themselves through energy savings alone."
                    }
                ]
            },
            {
                name: "plumbing",
                displayName: "Plumbing Services", 
                commonQAs: [
                    {
                        question: "How do I know if I need a new water heater?",
                        answer: "Signs include inconsistent water temperature, rusty water, strange noises, leaks around the unit, or a unit over 8-10 years old. We can assess your current unit and recommend repair or replacement options."
                    },
                    {
                        question: "What should I do if my pipes freeze?",
                        answer: "Turn off your main water supply immediately, then gently warm pipes with a hairdryer or heating pad. Never use an open flame. If pipes have burst, call for emergency service right away to minimize water damage."
                    }
                ]
            }
        ];
        
        for (const category of tradeCategories) {
            await db.collection('tradecategories').updateOne(
                { name: category.name },
                { $set: category },
                { upsert: true }
            );
            console.log(`   ✅ ${category.displayName}: ${category.commonQAs.length} Q&As`);
        }
        
        console.log(`\n🎉 Sample company setup complete!`);
        console.log(`\nTo test the agent, use company ID: ${result.insertedId}`);
        console.log(`\nExample test questions:`);
        console.log(`- "My heater isn't working"`);
        console.log(`- "How much does a new AC cost?"`);
        console.log(`- "Do you offer emergency service?"`);
        console.log(`- "What are your hours?"`);
        
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Error setting up sample company:', error);
        process.exit(1);
    }
}

setupSampleCompany();
