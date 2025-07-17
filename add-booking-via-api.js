// add-booking-via-api.js
// Add booking script data using the existing API endpoints

const companyId = '686a680241806a4991f7367f'; // Penguin Air

// Booking scripts to add
const bookingScripts = [
    {
        companyId: companyId,
        trade: 'HVAC',
        serviceType: 'Repair',
        flowSteps: {
            "step1": "Is this for your home or business?",
            "step2": "What's your full address?", 
            "step3": "What day and time works best for you?",
            "step4": "Do you prefer morning or afternoon appointments?",
            "step5": "Perfect! I've scheduled your HVAC repair. A technician will contact you to confirm the appointment."
        },
        estimatedDuration: "2-3 hours",
        description: "Complete HVAC system repair process"
    },
    {
        companyId: companyId,
        trade: 'HVAC', 
        serviceType: 'Maintenance',
        flowSteps: {
            "step1": "Is this for your seasonal tune-up service?",
            "step2": "Home or business address please?",
            "step3": "We have morning and afternoon slots available - which works better?",
            "step4": "Great! Your HVAC maintenance is scheduled. We'll send a confirmation shortly."
        },
        estimatedDuration: "1-2 hours", 
        description: "Regular HVAC maintenance and tune-up"
    },
    {
        companyId: companyId,
        trade: 'HVAC',
        serviceType: 'Installation', 
        flowSteps: {
            "step1": "What type of HVAC system are you looking to install?",
            "step2": "Is this for a home or commercial property?", 
            "step3": "What's the property address?",
            "step4": "When would you like to schedule the installation assessment?",
            "step5": "Perfect! We'll schedule your HVAC installation consultation."
        },
        estimatedDuration: "4-8 hours",
        description: "New HVAC system installation"
    },
    {
        companyId: companyId,
        trade: 'Plumbing',
        serviceType: 'Emergency',
        flowSteps: {
            "step1": "What plumbing emergency are you experiencing?",
            "step2": "Is there active water damage or flooding?",
            "step3": "What's your address so we can dispatch someone immediately?",
            "step4": "We're sending an emergency plumber right away. Please turn off the main water if possible."
        },
        estimatedDuration: "1-2 hours",
        description: "Emergency plumbing response"
    },
    {
        companyId: companyId,
        trade: 'Plumbing',
        serviceType: 'Repair',
        flowSteps: {
            "step1": "What plumbing issue needs repair?",
            "step2": "Is this for your home or business?",
            "step3": "What's your address?", 
            "step4": "When would you prefer the appointment?",
            "step5": "Your plumbing repair is scheduled. We'll confirm the appointment time."
        },
        estimatedDuration: "1-3 hours",
        description: "Standard plumbing repairs"
    }
];

async function addBookingScriptsViaAPI() {
    console.log('🚀 Adding booking scripts to Penguin Air via API...');
    
    for (const script of bookingScripts) {
        try {
            const response = await fetch('http://localhost:4000/api/booking-scripts', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(script)
            });
            
            if (response.ok) {
                const result = await response.json();
                console.log(`✅ Added ${script.trade} - ${script.serviceType} booking script`);
            } else {
                const error = await response.text();
                console.log(`❌ Failed to add ${script.trade} - ${script.serviceType}: ${error}`);
            }
        } catch (error) {
            console.log(`❌ Error adding ${script.trade} - ${script.serviceType}: ${error.message}`);
        }
    }
    
    console.log('🎉 Finished adding booking scripts!');
}

// If running directly (not as module), execute the function
if (require.main === module) {
    // Check if fetch is available (Node 18+) or use a polyfill
    if (typeof fetch === 'undefined') {
        console.log('❌ This script requires Node.js 18+ for fetch support');
        console.log('💡 Alternative: Use curl commands instead');
        
        // Print curl commands as alternative
        console.log('\n📋 Use these curl commands instead:');
        bookingScripts.forEach(script => {
            console.log(`\ncurl -X POST "http://localhost:4000/api/booking-scripts" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(script, null, 2).replace(/'/g, "'\"'\"'")}'`);
        });
    } else {
        addBookingScriptsViaAPI();
    }
}

module.exports = { bookingScripts, addBookingScriptsViaAPI };
