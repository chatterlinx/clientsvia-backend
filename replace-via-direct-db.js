// replace-via-direct-db.js
// Replace booking scripts using the existing server's database connection

const { getDB } = require('./db');
const { ObjectId } = require('mongodb');

const newBookingScripts = [
    {
        trade: "HVAC",
        serviceType: "Repair",
        flowSteps: {
            "step1": "Hi! I understand you need HVAC repair service. Is this for your home or a business location?",
            "step2": "What specific issue are you experiencing with your HVAC system? For example, no heating, no cooling, strange noises, or something else?",
            "step3": "I can definitely help you get this resolved. What's the full address where the service is needed?",
            "step4": "Is this an urgent repair that needs immediate attention, or can we schedule it for a convenient time?",
            "step5": "What day works best for you? We have availability throughout the week.",
            "step6": "Would you prefer a morning appointment (8 AM - 12 PM) or afternoon slot (1 PM - 5 PM)?",
            "step7": "Perfect! I have you scheduled for HVAC repair service. You'll receive a confirmation text with the technician's details and arrival window. Is there anything else I can help you with today?"
        },
        template: "comprehensive",
        estimatedDuration: "2-4 hours",
        description: "Complete HVAC system repair with detailed troubleshooting"
    },
    {
        trade: "HVAC", 
        serviceType: "Maintenance",
        flowSteps: {
            "step1": "Hello! I see you're calling about HVAC maintenance. Is this for your seasonal tune-up service?",
            "step2": "That's great! Regular maintenance keeps your system running efficiently. Is this for your home or business?",
            "step3": "What's the address where we'll be providing the maintenance service?",
            "step4": "When was your system last serviced? This helps our technician prepare the right tools and parts.",
            "step5": "We have several time slots available this week. What day works best for your schedule?",
            "step6": "Would you prefer a morning visit (8 AM - 12 PM) or afternoon (1 PM - 5 PM)?",
            "step7": "Excellent! Your HVAC maintenance is scheduled. We'll send you a confirmation with all the details. Our technician will perform a complete system check and tune-up."
        },
        template: "maintenance",
        estimatedDuration: "1-2 hours",
        description: "Seasonal HVAC maintenance and system optimization"
    },
    {
        trade: "HVAC",
        serviceType: "Installation", 
        flowSteps: {
            "step1": "Hi there! I understand you're interested in HVAC installation. What type of system are you looking to install?",
            "step2": "Is this for a new construction project, replacing an existing system, or adding HVAC to a space that doesn't currently have it?",
            "step3": "What's the address where the installation will take place?",
            "step4": "What's the approximate square footage of the area that needs heating and cooling?",
            "step5": "Would you like to schedule a free consultation? Our technician can assess your space and provide recommendations and pricing.",
            "step6": "When would be convenient for the consultation visit? We can usually schedule within 2-3 business days.",
            "step7": "Perfect! I've scheduled your HVAC installation consultation. Our expert will evaluate your needs and provide a detailed proposal. You'll receive confirmation details shortly."
        },
        template: "consultation",
        estimatedDuration: "4-8 hours",
        description: "New HVAC system installation with consultation"
    },
    {
        trade: "Plumbing",
        serviceType: "Emergency",
        flowSteps: {
            "step1": "This is an emergency plumbing line. What's the urgent plumbing issue you're experiencing right now?",
            "step2": "Is there any active water damage, flooding, or risk to your property that I should know about?",
            "step3": "For safety, if there's flooding, please turn off electricity to affected areas. Do you know where your main water shutoff valve is located?",
            "step4": "I need your address to dispatch our emergency plumber immediately. Where are you located?",
            "step5": "Our emergency plumber is being dispatched now and will arrive within 60-90 minutes. They'll call you when they're en route. Please stay safe and keep the area clear."
        },
        template: "emergency",
        estimatedDuration: "1-3 hours", 
        description: "Emergency plumbing response service"
    },
    {
        trade: "Plumbing",
        serviceType: "Repair",
        flowSteps: {
            "step1": "Hi! I can help you with your plumbing repair needs. What plumbing issue are you experiencing?",
            "step2": "Is this affecting your daily routine significantly, or is it something that can wait a day or two?",
            "step3": "What's the address where the plumbing repair is needed?",
            "step4": "Is this for a home or business location?",
            "step5": "When would be the most convenient time for our plumber to visit? We have openings throughout the week.",
            "step6": "Would a morning appointment (8 AM - 12 PM) or afternoon slot (1 PM - 5 PM) work better for you?",
            "step7": "Great! I have your plumbing repair scheduled. Our licensed plumber will diagnose the issue and provide upfront pricing before starting any work. You'll get a confirmation text soon."
        },
        template: "standard",
        estimatedDuration: "1-3 hours",
        description: "Standard plumbing repair service"
    },
    {
        trade: "Plumbing", 
        serviceType: "Installation",
        flowSteps: {
            "step1": "Hello! I see you need plumbing installation service. What type of plumbing installation are you looking for?",
            "step2": "Is this part of a renovation project, new construction, or replacing existing fixtures?",
            "step3": "What's the address where the installation will take place?",
            "step4": "Do you already have the fixtures/materials, or would you like our plumber to provide recommendations and supply them?",
            "step5": "When would you like to schedule this installation? Some installations may require permits or multiple visits.",
            "step6": "Would you prefer a morning (8 AM - 12 PM) or afternoon appointment (1 PM - 5 PM)?",
            "step7": "Perfect! I have your plumbing installation scheduled. Our licensed plumber will assess the work needed and provide a detailed quote. You'll receive confirmation details shortly."
        },
        template: "installation",
        estimatedDuration: "2-6 hours",
        description: "Professional plumbing installation service"
    }
];

async function replaceBookingScriptsDirectly() {
    console.log('🚀 Replacing booking scripts using existing database connection...');
    
    const db = getDB();
    if (!db) {
        console.error('❌ Database not connected. Make sure the server is running.');
        return;
    }
    
    try {
        const companiesCollection = db.collection('companiesCollection');
        const companyId = new ObjectId('686a680241806a4991f7367f');
        
        // Replace the existing booking scripts with new ones
        const updateResult = await companiesCollection.updateOne(
            { _id: companyId },
            { 
                $set: { 
                    bookingScripts: newBookingScripts.map(script => ({
                        ...script,
                        _id: new ObjectId(),
                        script: [], // Keep this for mongoose schema compatibility
                        isActive: true,
                        active: true,
                        lastUpdated: new Date()
                    })),
                    updatedAt: new Date()
                }
            }
        );
        
        if (updateResult.modifiedCount > 0) {
            console.log('✅ Successfully replaced booking scripts!');
            console.log(`📋 Added ${newBookingScripts.length} improved booking flows:`);
            newBookingScripts.forEach(script => {
                console.log(`   • ${script.trade} - ${script.serviceType} (${Object.keys(script.flowSteps).length} steps)`);
            });
            
            // Test one of the new flows
            console.log('\n🧪 Testing new booking flow...');
            const testScript = newBookingScripts[0]; // HVAC Repair
            console.log(`Sample flow for ${testScript.trade} - ${testScript.serviceType}:`);
            Object.entries(testScript.flowSteps).forEach(([step, text]) => {
                console.log(`   ${step}: "${text}"`);
            });
            
        } else {
            console.log('❌ Failed to update booking scripts');
        }
        
    } catch (error) {
        console.error('❌ Error replacing booking scripts:', error.message);
    }
}

module.exports = { newBookingScripts, replaceBookingScriptsDirectly };

// If running as a script
if (require.main === module) {
    replaceBookingScriptsDirectly();
}
