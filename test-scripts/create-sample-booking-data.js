// test-scripts/create-sample-booking-data.js
// Script to insert sample booking flow data for testing

require('dotenv').config(); // Load environment variables
const { MongoClient, ObjectId } = require('mongodb');

// MongoDB connection configuration - use the same as main app
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://chatterlinx:eSnQuCbvZUXTJ6ZV@cluster0.0bqzx.mongodb.net/';
const DB_NAME = process.env.MONGODB_DB_NAME || 'clientsvia';

async function createSampleBookingData() {
    console.log('Creating sample booking flow data...');
    
    const client = new MongoClient(MONGODB_URI);
    
    try {
        await client.connect();
        const db = client.db(DB_NAME);
        const companiesCollection = db.collection('companiesCollection');
        
        // Sample company ID (you can change this to match your test company)
        const testCompanyId = '673c5c5c0b7bf5dfcc02b09b'; // Replace with your actual company ID
        
        // Sample booking scripts structure
        const sampleBookingScripts = [
            {
                tradeType: 'HVAC',
                serviceType: 'Repair',
                name: 'HVAC Repair Booking',
                description: 'Book emergency or scheduled HVAC repair service',
                isActive: true,
                flowSteps: [
                    {
                        prompt: "Is this for your home or business?",
                        placeholders: ["{{customer_name}}", "{{location_type}}"]
                    },
                    {
                        prompt: "What's your full address including city and zip code?",
                        placeholders: ["{{address}}", "{{city}}", "{{zip_code}}"]
                    },
                    {
                        prompt: "What type of HVAC issue are you experiencing?",
                        placeholders: ["{{issue_description}}"]
                    },
                    {
                        prompt: "What day and time would work best for your service appointment?",
                        placeholders: ["{{preferred_date}}", "{{preferred_time}}"]
                    },
                    {
                        prompt: "Do you prefer morning (8AM-12PM) or afternoon (12PM-5PM) appointments?",
                        placeholders: ["{{time_preference}}"]
                    }
                ],
                completionMessage: "Thank you! Your HVAC repair appointment has been scheduled. A technician will contact you within 24 hours to confirm the details."
            },
            {
                tradeType: 'HVAC',
                serviceType: 'Maintenance',
                name: 'HVAC Maintenance Booking',
                description: 'Schedule routine HVAC maintenance and tune-ups',
                isActive: true,
                flowSteps: [
                    {
                        prompt: "Are you calling to schedule your seasonal HVAC tune-up?",
                        placeholders: ["{{service_type}}", "{{customer_name}}"]
                    },
                    {
                        prompt: "What's your home or business address?",
                        placeholders: ["{{address}}", "{{location_type}}"]
                    },
                    {
                        prompt: "When was your HVAC system last serviced?",
                        placeholders: ["{{last_service_date}}"]
                    },
                    {
                        prompt: "We have morning and afternoon slots available. Which time frame works better for you?",
                        placeholders: ["{{preferred_time_frame}}"]
                    }
                ],
                completionMessage: "Perfect! Your HVAC maintenance appointment is being scheduled. We'll call you within 2 business hours to confirm the date and time."
            },
            {
                tradeType: 'HVAC',
                serviceType: 'Installation',
                name: 'HVAC Installation Booking',
                description: 'Schedule new HVAC system installation',
                isActive: true,
                flowSteps: [
                    {
                        prompt: "Are you looking to install a new HVAC system or replace an existing one?",
                        placeholders: ["{{installation_type}}", "{{system_type}}"]
                    },
                    {
                        prompt: "What's the address where the installation will take place?",
                        placeholders: ["{{installation_address}}"]
                    },
                    {
                        prompt: "What's the square footage of the area that needs heating and cooling?",
                        placeholders: ["{{square_footage}}"]
                    },
                    {
                        prompt: "Do you have any specific brand preferences or energy efficiency requirements?",
                        placeholders: ["{{brand_preference}}", "{{efficiency_requirements}}"]
                    },
                    {
                        prompt: "When would you like to schedule a consultation for the installation estimate?",
                        placeholders: ["{{consultation_date}}"]
                    }
                ],
                completionMessage: "Thank you! We'll schedule a consultation to assess your HVAC installation needs. Our team will contact you within 24 hours to arrange the estimate appointment."
            },
            {
                tradeType: 'Plumbing',
                serviceType: 'Emergency',
                name: 'Emergency Plumbing Service',
                description: 'Immediate plumbing emergency response',
                isActive: true,
                flowSteps: [
                    {
                        prompt: "Is this a plumbing emergency with active water damage or flooding?",
                        placeholders: ["{{emergency_type}}", "{{water_damage_status}}"]
                    },
                    {
                        prompt: "Where exactly is the plumbing problem located in your home or business?",
                        placeholders: ["{{problem_location}}", "{{building_type}}"]
                    },
                    {
                        prompt: "Have you been able to turn off the main water supply?",
                        placeholders: ["{{water_shutoff_status}}"]
                    },
                    {
                        prompt: "What's your address so we can dispatch our nearest available plumber?",
                        placeholders: ["{{emergency_address}}"]
                    }
                ],
                completionMessage: "Emergency dispatch in progress! A plumber is being sent to your location immediately. You should receive a call within 15 minutes with the estimated arrival time."
            },
            {
                tradeType: 'Plumbing',
                serviceType: 'Repair',
                name: 'Plumbing Repair Service',
                description: 'Schedule non-emergency plumbing repairs',
                isActive: true,
                flowSteps: [
                    {
                        prompt: "What type of plumbing repair do you need?",
                        placeholders: ["{{repair_type}}", "{{plumbing_fixture}}"]
                    },
                    {
                        prompt: "Is this affecting your home or business?",
                        placeholders: ["{{location_type}}"]
                    },
                    {
                        prompt: "What's your address for the service call?",
                        placeholders: ["{{service_address}}"]
                    },
                    {
                        prompt: "When would you prefer to schedule this repair?",
                        placeholders: ["{{preferred_date}}", "{{preferred_time}}"]
                    }
                ],
                completionMessage: "Your plumbing repair appointment has been scheduled. We'll confirm the date and time with you via phone call within 4 hours."
            },
            {
                tradeType: 'Electrical',
                serviceType: 'Repair',
                name: 'Electrical Repair Service',
                description: 'Schedule electrical repairs and troubleshooting',
                isActive: true,
                flowSteps: [
                    {
                        prompt: "What type of electrical issue are you experiencing?",
                        placeholders: ["{{electrical_issue}}", "{{safety_concern}}"]
                    },
                    {
                        prompt: "Is this a safety concern or emergency situation?",
                        placeholders: ["{{safety_level}}", "{{urgency}}"]
                    },
                    {
                        prompt: "What's the location for this electrical service?",
                        placeholders: ["{{service_location}}"]
                    },
                    {
                        prompt: "When would you like to schedule the electrical repair?",
                        placeholders: ["{{appointment_preference}}"]
                    }
                ],
                completionMessage: "Your electrical repair appointment is being scheduled. For safety reasons, our electrician will contact you within 2 hours to confirm details and provide safety guidance."
            }
        ];
        
        // Update the company with sample booking scripts
        const result = await companiesCollection.updateOne(
            { _id: new ObjectId(testCompanyId) },
            { 
                $set: { 
                    bookingScripts: sampleBookingScripts,
                    bookingScriptsLastUpdated: new Date()
                }
            },
            { upsert: false }
        );
        
        if (result.matchedCount > 0) {
            console.log(`✅ Successfully added ${sampleBookingScripts.length} booking scripts to company ${testCompanyId}`);
            console.log('Sample booking scripts created:');
            sampleBookingScripts.forEach((script, index) => {
                console.log(`  ${index + 1}. ${script.tradeType} - ${script.serviceType} (${script.flowSteps.length} steps)`);
            });
        } else {
            console.warn(`⚠️  Company ${testCompanyId} not found. Please check the company ID.`);
        }
        
    } catch (error) {
        console.error('Error creating sample booking data:', error);
    } finally {
        await client.close();
    }
}

// Run if called directly
if (require.main === module) {
    createSampleBookingData()
        .then(() => {
            console.log('Sample booking data creation completed.');
            process.exit(0);
        })
        .catch(error => {
            console.error('Failed to create sample booking data:', error);
            process.exit(1);
        });
}

module.exports = { createSampleBookingData };
