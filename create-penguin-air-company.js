// create-penguin-air-company.js
// Script to create the Penguin Air test company in the database

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

// Use the same MongoDB URI as the server
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://chatterlinx:eSnQuCbvZUXTJ6ZV@cluster0.0bqzx.mongodb.net/';
const DB_NAME = 'clientsvia'; // Explicitly set database name

// Penguin Air company data
const penguinAirData = {
    _id: new ObjectId('686a680241806a4991f7367f'),
    companyID: '686a680241806a4991f7367f',
    companyName: 'Penguin Air Conditioning',
    name: 'Penguin Air Conditioning',
    industry: 'HVAC',
    phone: '(555) 123-4567',
    email: 'info@penguinair.com',
    address: '123 Cool Street, Frostville, AK 99501',
    website: 'https://penguinair.com',
    description: 'Professional HVAC services specializing in air conditioning installation, repair, and maintenance.',
    createdAt: new Date(),
    updatedAt: new Date(),
    
    // Agent configuration
    agentSetup: {
        agentName: 'Sarah',
        greeting: 'Hi, thank you for calling Penguin Air Conditioning! This is Sarah, how can I help you today?',
        personality: 'friendly, professional, helpful',
        voiceSettings: {
            voice: 'nova',
            speed: 1.0,
            pitch: 1.0
        },
        categories: ['HVAC', 'Heating', 'Cooling', 'Air Conditioning'],
        categoryQAs: `Q: What services do you offer?
A: We offer comprehensive HVAC services including air conditioning installation, repair, and maintenance, heating system installation and repair, ductwork installation, indoor air quality solutions, and emergency HVAC services.

Q: What are your business hours?
A: We're open Monday through Friday from 8:00 AM to 6:00 PM, Saturday from 9:00 AM to 4:00 PM, and closed on Sundays. We also offer emergency services 24/7.

Q: Do you offer emergency services?
A: Yes, we provide 24/7 emergency HVAC services. If you have an urgent heating or cooling issue, please let us know and we'll dispatch a technician as soon as possible.

Q: How much does AC installation cost?
A: AC installation costs vary depending on the unit size, type, and complexity of the installation. We offer free estimates and will provide you with a detailed quote after assessing your specific needs.

Q: Do you provide warranties?
A: Yes, we provide warranties on all our installations and repairs. New equipment comes with manufacturer warranties, and our labor is guaranteed for one year.

Q: How often should I service my AC?
A: We recommend servicing your air conditioning system at least once a year, ideally before the cooling season begins. Regular maintenance helps ensure optimal performance and extends the life of your equipment.

Q: What brands do you work with?
A: We work with all major HVAC brands including Carrier, Trane, Lennox, Rheem, Goodman, and many others. We can service any brand and will recommend the best option for your specific needs and budget.

Q: Do you offer financing options?
A: Yes, we offer flexible financing options to help make your HVAC investment more affordable. We can discuss various payment plans and financing options during your consultation.

Q: My thermostat screen is blank, what should I do?
A: If your thermostat screen is blank, first check if it needs new batteries. If it's hardwired, check the circuit breaker. If the problem persists, there may be a wiring issue that requires professional attention.

Q: Why is my AC not cooling?
A: There are several reasons why your AC might not be cooling properly: dirty air filter, low refrigerant, blocked condenser unit, or faulty thermostat. We recommend checking your air filter first and scheduling a service call if the problem continues.

Q: How do I know if I need a new AC unit?
A: Consider replacing your AC unit if it's over 10-15 years old, requires frequent repairs, has rising energy bills, or isn't cooling effectively. We can assess your current unit and recommend whether repair or replacement is more cost-effective.`
    },
    
    // Services offered
    services: [
        'Air Conditioning Installation',
        'AC Repair',
        'AC Maintenance',
        'Heating System Installation',
        'Heating Repair',
        'Ductwork Installation',
        'Indoor Air Quality Solutions',
        'Emergency HVAC Services'
    ],
    
    // Business hours
    businessHours: {
        monday: '8:00 AM - 6:00 PM',
        tuesday: '8:00 AM - 6:00 PM',
        wednesday: '8:00 AM - 6:00 PM',
        thursday: '8:00 AM - 6:00 PM',
        friday: '8:00 AM - 6:00 PM',
        saturday: '9:00 AM - 4:00 PM',
        sunday: 'Closed'
    },
    
    // Intent routing configuration
    intentRouting: {
        enabled: true,
        routes: [
            {
                intent: 'service_inquiry',
                keywords: ['service', 'repair', 'installation', 'maintenance', 'fix', 'install'],
                response: 'I can help you with our HVAC services. What specific service are you interested in?'
            },
            {
                intent: 'pricing_inquiry',
                keywords: ['cost', 'price', 'estimate', 'quote', 'how much', 'expensive'],
                response: 'I\'d be happy to provide you with pricing information. Let me connect you with someone who can give you a detailed quote.'
            },
            {
                intent: 'emergency_service',
                keywords: ['emergency', 'urgent', 'broken', 'not working', 'no heat', 'no cool'],
                response: 'I understand this is an emergency. Let me get you connected with our emergency dispatch team right away.'
            },
            {
                intent: 'schedule_appointment',
                keywords: ['schedule', 'appointment', 'book', 'when', 'available', 'visit'],
                response: 'I can help you schedule an appointment. What day and time works best for you?'
            },
            {
                intent: 'business_hours',
                keywords: ['hours', 'open', 'closed', 'when', 'available'],
                response: 'We\'re open Monday through Friday from 8:00 AM to 6:00 PM, Saturday from 9:00 AM to 4:00 PM, and closed on Sundays.'
            }
        ]
    },
    
    // Status
    status: 'active',
    isTestCompany: true
};

async function createPenguinAirCompany() {
    console.log('🐧 Creating Penguin Air test company...');
    
    const client = new MongoClient(MONGODB_URI);
    
    try {
        await client.connect();
        const db = client.db(DB_NAME);
        const companiesCollection = db.collection('companiesCollection');
        
        // Check if company already exists
        const existingCompany = await companiesCollection.findOne({ _id: penguinAirData._id });
        
        if (existingCompany) {
            console.log('⚠️  Penguin Air company already exists. Updating...');
            await companiesCollection.replaceOne({ _id: penguinAirData._id }, penguinAirData);
            console.log('✅ Penguin Air company updated successfully!');
        } else {
            console.log('🆕 Creating new Penguin Air company...');
            await companiesCollection.insertOne(penguinAirData);
            console.log('✅ Penguin Air company created successfully!');
        }
        
        // Verify the company was created
        const verifyCompany = await companiesCollection.findOne({ _id: penguinAirData._id });
        console.log(`\n📊 Company verification:`);
        console.log(`   Name: ${verifyCompany.companyName}`);
        console.log(`   ID: ${verifyCompany._id}`);
        console.log(`   Category Q&As: ${verifyCompany.agentSetup?.categoryQAs ? 'Available' : 'Not found'}`);
        console.log(`   Categories: ${verifyCompany.agentSetup?.categories?.length || 0}`);
        console.log(`   Intent routes: ${verifyCompany.intentRouting?.routes?.length || 0}`);
        console.log(`   Services: ${verifyCompany.services?.length || 0}`);
        
    } catch (error) {
        console.error('❌ Error creating Penguin Air company:', error);
        throw error;
    } finally {
        await client.close();
    }
}

// Run the script
if (require.main === module) {
    createPenguinAirCompany()
        .then(() => {
            console.log('🎉 Penguin Air company setup complete!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('💥 Script failed:', error);
            process.exit(1);
        });
}

module.exports = { createPenguinAirCompany, penguinAirData };
