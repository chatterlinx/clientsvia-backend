// add-booking-data-to-existing.js
// Add booking script data to existing Penguin Air company

const { MongoClient, ObjectId } = require('mongodb');

async function addBookingDataToExisting() {
    const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://localhost:27017/clientsvia');
    
    try {
        await client.connect();
        console.log('✅ Connected to MongoDB');
        
        const db = client.db();
        const companiesCollection = db.collection('companiesCollection');
        
        // Company ID from your existing data
        const companyId = new ObjectId('686a680241806a4991f7367f');
        
        // Check if company exists
        const existingCompany = await companiesCollection.findOne({ _id: companyId });
        if (!existingCompany) {
            console.log('❌ Company not found with ID:', companyId);
            return;
        }
        
        console.log('✅ Found existing company:', existingCompany.companyName);
        
        // Booking script data to add
        const bookingScriptsData = {
            "HVAC": {
                "Repair": {
                    "flowSteps": {
                        "step1": "Is this for your home or business?",
                        "step2": "What's your full address?", 
                        "step3": "What day and time works best for you?",
                        "step4": "Do you prefer morning or afternoon appointments?",
                        "step5": "Perfect! I've scheduled your HVAC repair. A technician will contact you to confirm the appointment."
                    },
                    "estimatedDuration": "2-3 hours",
                    "description": "Complete HVAC system repair process"
                },
                "Maintenance": {
                    "flowSteps": {
                        "step1": "Is this for your seasonal tune-up service?",
                        "step2": "Home or business address please?",
                        "step3": "We have morning and afternoon slots available - which works better?",
                        "step4": "Great! Your HVAC maintenance is scheduled. We'll send a confirmation shortly."
                    },
                    "estimatedDuration": "1-2 hours", 
                    "description": "Regular HVAC maintenance and tune-up"
                },
                "Installation": {
                    "flowSteps": {
                        "step1": "What type of HVAC system are you looking to install?",
                        "step2": "Is this for a home or commercial property?", 
                        "step3": "What's the property address?",
                        "step4": "When would you like to schedule the installation assessment?",
                        "step5": "Perfect! We'll schedule your HVAC installation consultation."
                    },
                    "estimatedDuration": "4-8 hours",
                    "description": "New HVAC system installation"
                }
            },
            "Plumbing": {
                "Emergency": {
                    "flowSteps": {
                        "step1": "What plumbing emergency are you experiencing?",
                        "step2": "Is there active water damage or flooding?",
                        "step3": "What's your address so we can dispatch someone immediately?",
                        "step4": "We're sending an emergency plumber right away. Please turn off the main water if possible."
                    },
                    "estimatedDuration": "1-2 hours",
                    "description": "Emergency plumbing response"
                },
                "Repair": {
                    "flowSteps": {
                        "step1": "What plumbing issue needs repair?",
                        "step2": "Is this for your home or business?",
                        "step3": "What's your address?", 
                        "step4": "When would you prefer the appointment?",
                        "step5": "Your plumbing repair is scheduled. We'll confirm the appointment time."
                    },
                    "estimatedDuration": "1-3 hours",
                    "description": "Standard plumbing repairs"
                }
            }
        };
        
        // Update the company with booking scripts
        const updateResult = await companiesCollection.updateOne(
            { _id: companyId },
            { 
                $set: { 
                    bookingScripts: bookingScriptsData,
                    updatedAt: new Date()
                }
            }
        );
        
        if (updateResult.modifiedCount > 0) {
            console.log('✅ Successfully added booking scripts to Penguin Air!');
            console.log('📋 Added booking flows for:');
            console.log('   • HVAC: Repair, Maintenance, Installation');
            console.log('   • Plumbing: Emergency, Repair');
        } else {
            console.log('❌ Failed to update company with booking scripts');
        }
        
        // Verify the data was saved
        const updatedCompany = await companiesCollection.findOne({ _id: companyId });
        if (updatedCompany.bookingScripts) {
            console.log('✅ Verification: Booking scripts successfully saved to database');
            console.log('📊 Total flows created:', 
                Object.keys(updatedCompany.bookingScripts.HVAC).length + 
                Object.keys(updatedCompany.bookingScripts.Plumbing).length
            );
        }
        
    } catch (error) {
        console.error('❌ Error adding booking data:', error.message);
    } finally {
        await client.close();
        console.log('🔌 Database connection closed');
    }
}

// Run the script
if (require.main === module) {
    addBookingDataToExisting();
}

module.exports = { addBookingDataToExisting };
