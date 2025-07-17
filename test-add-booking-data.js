// test-add-booking-data.js
// Script to add sample booking scripts to the existing company

const { connectDB, getDB } = require('./db');
const { ObjectId } = require('mongodb');

async function addBookingData() {
    console.log('🔄 Adding sample booking scripts to existing company...');
    
    try {
        // Connect to database
        await connectDB();
        const db = getDB();
        
        const companyId = '673c5c5c0b7bf5dfcc02b09b'; // Existing company ID
        
        // Sample booking scripts in the correct format
        const sampleBookingScripts = [
            {
                tradeType: 'HVAC',
                serviceType: 'Repair',
                name: 'HVAC Repair Booking',
                description: 'Book HVAC repair service',
                flowSteps: [
                    'Is this for your home or business?',
                    'What specific HVAC issue are you experiencing?',
                    'What\'s your full address?',
                    'What day and time would work best for your appointment?',
                    'Perfect! We\'ll schedule a technician and send you a confirmation.'
                ],
                completionMessage: 'Your HVAC repair has been scheduled. A technician will contact you shortly.',
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date()
            },
            {
                tradeType: 'HVAC',
                serviceType: 'Maintenance',
                name: 'HVAC Maintenance Booking',
                description: 'Schedule routine HVAC maintenance',
                flowSteps: [
                    'Is this for a seasonal tune-up?',
                    'Is this for your home or business?',
                    'What\'s your address?',
                    'When was your last maintenance service?',
                    'What day works best for your maintenance appointment?',
                    'Great! Your maintenance appointment is scheduled.'
                ],
                completionMessage: 'Your HVAC maintenance is scheduled. We\'ll send you a reminder before the appointment.',
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date()
            },
            {
                tradeType: 'Plumbing',
                serviceType: 'Emergency',
                name: 'Emergency Plumbing',
                description: 'Emergency plumbing service',
                flowSteps: [
                    'What plumbing emergency are you experiencing?',
                    'Is there currently water damage or flooding?',
                    'What\'s your address for emergency dispatch?',
                    'Are you available to meet the technician now?',
                    'We\'re dispatching an emergency technician immediately.'
                ],
                completionMessage: 'Emergency plumber dispatched! They will contact you within 15 minutes.',
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date()
            },
            {
                tradeType: 'Plumbing',
                serviceType: 'Repair',
                name: 'Plumbing Repair Booking',
                description: 'Schedule plumbing repair service',
                flowSteps: [
                    'What plumbing issue needs repair?',
                    'Is this for your home or business?',
                    'What\'s your address?',
                    'How urgent is this repair?',
                    'What day and time would work for your appointment?',
                    'Your plumbing repair appointment is confirmed.'
                ],
                completionMessage: 'Your plumbing repair is scheduled. A plumber will contact you to confirm.',
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date()
            },
            {
                tradeType: 'Electrical',
                serviceType: 'Installation',
                name: 'Electrical Installation',
                description: 'Schedule electrical installation service',
                flowSteps: [
                    'What type of electrical installation do you need?',
                    'Is this for residential or commercial?',
                    'What\'s the installation address?',
                    'Do you have the necessary permits?',
                    'When would you like to schedule the installation?',
                    'Your electrical installation is scheduled.'
                ],
                completionMessage: 'Your electrical installation is booked. Our electrician will call to confirm details.',
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date()
            }
        ];
        
        // Update the existing company with booking scripts
        const result = await db.collection('companiesCollection').updateOne(
            { _id: new ObjectId(companyId) },
            { 
                $set: { 
                    bookingScripts: sampleBookingScripts,
                    updatedAt: new Date()
                }
            }
        );
        
        if (result.matchedCount === 0) {
            console.log('❌ Company not found!');
            return;
        }
        
        if (result.modifiedCount === 1) {
            console.log('✅ Successfully added booking scripts to company!');
            console.log(`📊 Added ${sampleBookingScripts.length} booking scripts:`);
            sampleBookingScripts.forEach((script, index) => {
                console.log(`   ${index + 1}. ${script.tradeType} - ${script.serviceType} (${script.flowSteps.length} steps)`);
            });
        }
        
        // Verify the data was added
        const updatedCompany = await db.collection('companiesCollection').findOne(
            { _id: new ObjectId(companyId) },
            { projection: { companyName: 1, bookingScripts: 1 } }
        );
        
        console.log(`\n📈 Company "${updatedCompany.companyName}" now has ${updatedCompany.bookingScripts?.length || 0} booking scripts`);
        
    } catch (error) {
        console.error('❌ Error adding booking data:', error);
    } finally {
        process.exit(0);
    }
}

// Run the script
addBookingData();
