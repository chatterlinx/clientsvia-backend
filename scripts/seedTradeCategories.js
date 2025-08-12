#!/usr/bin/env node

/**
 * CLIENTSVIA GLOBAL TRADE CATEGORIES SEED SCRIPT
 * ================================================
 * 
 * This script creates comprehensive trade categories with rich Q&A data
 * that companies can select from for their AI agent configurations.
 * 
 * Each category includes:
 * - Common questions customers ask
 * - Professional answers
 * - Service types and specializations
 * - Industry-specific terminology
 * 
 * Usage: node scripts/seedTradeCategories.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');
    } catch (error) {
        console.error('❌ MongoDB connection failed:', error);
        process.exit(1);
    }
};

// Trade Category Schema (matching the existing model)
const TradeCategorySchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    description: { type: String, default: '' },
    commonQAs: [{
        question: { type: String, required: true },
        answer: { type: String, required: true },
        category: { type: String, default: 'general' },
        tags: [String],
        priority: { type: Number, default: 1 },
        isActive: { type: Boolean, default: true }
    }],
    serviceTypes: [String],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const TradeCategory = mongoose.model('TradeCategory', TradeCategorySchema);

// Comprehensive Trade Categories Data
const tradeCategories = [
    {
        name: "Plumbing",
        description: "Comprehensive plumbing services including installation, repair, and maintenance of water and drainage systems.",
        serviceTypes: [
            "Emergency Plumbing",
            "Pipe Repair & Replacement",
            "Drain Cleaning",
            "Water Heater Services",
            "Fixture Installation",
            "Leak Detection",
            "Sewer Line Services",
            "Bathroom Remodeling",
            "Kitchen Plumbing"
        ],
        commonQAs: [
            {
                question: "What should I do if I have a plumbing emergency?",
                answer: "For plumbing emergencies like burst pipes or major leaks, immediately turn off your main water supply and call our 24/7 emergency line. We provide rapid response services and can typically be at your location within 30-60 minutes.",
                category: "emergency",
                tags: ["emergency", "burst pipes", "leaks", "24/7"],
                priority: 10,
                isActive: true
            },
            {
                question: "How much does it cost to fix a leaky faucet?",
                answer: "Leaky faucet repairs typically range from $75-$200 depending on the type of faucet and complexity of the issue. Simple washer replacements are on the lower end, while complete cartridge replacements may cost more. We provide free estimates before starting any work.",
                category: "pricing",
                tags: ["cost", "faucet", "repair", "estimate"],
                priority: 8,
                isActive: true
            },
            {
                question: "Do you offer same-day service?",
                answer: "Yes, we offer same-day service for most plumbing issues when you call before 2 PM. Emergency services are available 24/7. We understand plumbing problems can't wait, so we prioritize quick response times.",
                category: "scheduling",
                tags: ["same-day", "emergency", "scheduling", "availability"],
                priority: 9,
                isActive: true
            },
            {
                question: "Are you licensed and insured?",
                answer: "Absolutely! We are fully licensed, bonded, and insured. All our plumbers are certified professionals with years of experience. We carry comprehensive liability insurance to protect your property and our workers.",
                category: "credentials",
                tags: ["licensed", "insured", "certified", "professional"],
                priority: 7,
                isActive: true
            },
            {
                question: "What's included in your drain cleaning service?",
                answer: "Our drain cleaning service includes camera inspection to identify blockages, professional-grade snaking or hydro-jetting to clear clogs, and a follow-up inspection to ensure proper flow. We also provide maintenance tips to prevent future clogs.",
                category: "services",
                tags: ["drain cleaning", "camera inspection", "hydro-jetting", "maintenance"],
                priority: 6,
                isActive: true
            },
            {
                question: "How long do water heaters typically last?",
                answer: "Traditional tank water heaters last 8-12 years on average, while tankless units can last 15-20 years with proper maintenance. Signs it's time for replacement include rust-colored water, strange noises, or frequent repairs. We offer energy-efficient replacement options.",
                category: "maintenance",
                tags: ["water heater", "lifespan", "replacement", "maintenance"],
                priority: 5,
                isActive: true
            }
        ]
    },
    {
        name: "HVAC",
        description: "Heating, ventilation, and air conditioning services including installation, repair, maintenance, and energy efficiency solutions.",
        serviceTypes: [
            "AC Installation & Repair",
            "Heating System Services",
            "Ductwork Installation",
            "Air Quality Solutions",
            "Preventive Maintenance",
            "Energy Audits",
            "Smart Thermostat Installation",
            "Emergency HVAC Services",
            "Commercial HVAC"
        ],
        commonQAs: [
            {
                question: "Why is my air conditioner not cooling properly?",
                answer: "Common causes include dirty air filters, low refrigerant levels, blocked condensers, or thermostat issues. Our technicians will diagnose the problem and provide solutions. Regular maintenance helps prevent most cooling issues.",
                category: "troubleshooting",
                tags: ["AC", "cooling", "maintenance", "diagnosis"],
                priority: 10,
                isActive: true
            },
            {
                question: "How often should I replace my air filter?",
                answer: "Standard 1-inch filters should be replaced every 1-3 months, depending on usage and home conditions. Homes with pets or allergies may need monthly changes. High-efficiency filters can last 3-6 months. We provide filter replacement reminders.",
                category: "maintenance",
                tags: ["air filter", "replacement", "maintenance", "schedule"],
                priority: 8,
                isActive: true
            },
            {
                question: "What size AC unit do I need for my home?",
                answer: "AC sizing depends on square footage, insulation, windows, and local climate. A Manual J calculation ensures proper sizing. Oversized units waste energy and don't dehumidify well, while undersized units struggle to cool. We provide free sizing consultations.",
                category: "installation",
                tags: ["AC sizing", "installation", "consultation", "energy efficiency"],
                priority: 7,
                isActive: true
            },
            {
                question: "Do you offer maintenance plans?",
                answer: "Yes! Our maintenance plans include bi-annual tune-ups, priority scheduling, discounted repairs, and extended warranties. Regular maintenance extends equipment life, improves efficiency, and prevents costly breakdowns.",
                category: "maintenance",
                tags: ["maintenance plan", "tune-up", "warranty", "savings"],
                priority: 9,
                isActive: true
            },
            {
                question: "What are signs I need a new heating system?",
                answer: "Warning signs include frequent repairs, rising energy bills, uneven heating, strange noises, or a system over 15-20 years old. We offer free assessments to determine if repair or replacement is more cost-effective.",
                category: "replacement",
                tags: ["heating system", "replacement", "assessment", "energy bills"],
                priority: 6,
                isActive: true
            }
        ]
    },
    {
        name: "Electrical",
        description: "Professional electrical services including installations, repairs, safety inspections, and electrical system upgrades.",
        serviceTypes: [
            "Electrical Repairs",
            "Panel Upgrades",
            "Outlet Installation",
            "Lighting Installation",
            "Safety Inspections",
            "Generator Installation",
            "Smart Home Wiring",
            "Emergency Electrical",
            "Commercial Electrical"
        ],
        commonQAs: [
            {
                question: "When should I call an electrician vs. doing it myself?",
                answer: "Call a professional for any work involving the electrical panel, new circuits, or anything beyond basic outlet/switch replacement. Electrical work can be dangerous and often requires permits. Our licensed electricians ensure safety and code compliance.",
                category: "safety",
                tags: ["safety", "professional", "licensed", "permits"],
                priority: 10,
                isActive: true
            },
            {
                question: "Why does my circuit breaker keep tripping?",
                answer: "Circuit breakers trip due to overloaded circuits, short circuits, or ground faults. This is a safety feature preventing fires. If breakers trip frequently, you may need additional circuits or there could be a wiring issue requiring professional diagnosis.",
                category: "troubleshooting",
                tags: ["circuit breaker", "tripping", "overload", "safety"],
                priority: 9,
                isActive: true
            },
            {
                question: "How do I know if my electrical panel needs upgrading?",
                answer: "Signs include frequent breaker trips, dimming lights when appliances start, burning smells, or panels over 25 years old. Modern homes need 200-amp service. We provide free panel assessments and can upgrade to meet current electrical demands safely.",
                category: "upgrade",
                tags: ["panel upgrade", "assessment", "200-amp", "modern demands"],
                priority: 8,
                isActive: true
            },
            {
                question: "Do you install whole house generators?",
                answer: "Yes, we install and service automatic standby generators that power your entire home during outages. We handle permits, gas connections, and electrical connections. Generators provide peace of mind and protect your home during extended power outages.",
                category: "installation",
                tags: ["generator", "installation", "standby", "power outage"],
                priority: 6,
                isActive: true
            },
            {
                question: "Can you help with smart home installations?",
                answer: "Absolutely! We install smart switches, outlets, thermostats, and home automation systems. Our electricians are trained in modern smart home technology and can integrate systems for lighting, security, and energy management.",
                category: "smart home",
                tags: ["smart home", "automation", "smart switches", "integration"],
                priority: 5,
                isActive: true
            }
        ]
    },
    {
        name: "Roofing",
        description: "Complete roofing services including installation, repair, maintenance, and inspection for residential and commercial properties.",
        serviceTypes: [
            "Roof Installation",
            "Roof Repair",
            "Roof Inspection",
            "Gutter Installation",
            "Emergency Roof Services",
            "Roof Maintenance",
            "Skylight Installation",
            "Commercial Roofing",
            "Insurance Claims"
        ],
        commonQAs: [
            {
                question: "How do I know if I need a roof replacement or just repairs?",
                answer: "We assess age, damage extent, and cost-effectiveness. Roofs over 20 years with multiple issues often benefit from replacement. We provide detailed inspections and honest recommendations, helping you make informed decisions about repair vs. replacement.",
                category: "assessment",
                tags: ["roof replacement", "repair", "inspection", "assessment"],
                priority: 10,
                isActive: true
            },
            {
                question: "Do you work with insurance companies?",
                answer: "Yes, we're experienced with insurance claims and can help document damage, provide detailed estimates, and work directly with adjusters. We assist throughout the claims process to ensure you receive fair coverage for necessary repairs.",
                category: "insurance",
                tags: ["insurance", "claims", "adjusters", "documentation"],
                priority: 9,
                isActive: true
            },
            {
                question: "What roofing materials do you recommend?",
                answer: "We recommend materials based on climate, budget, and style preferences. Options include asphalt shingles, metal roofing, tile, and slate. Each has different lifespans, maintenance needs, and costs. We'll help you choose the best option for your situation.",
                category: "materials",
                tags: ["roofing materials", "asphalt", "metal", "recommendations"],
                priority: 7,
                isActive: true
            },
            {
                question: "How long does a roof installation take?",
                answer: "Most residential roof replacements take 1-3 days, depending on size, complexity, and weather. We work efficiently while maintaining quality standards. Weather delays may extend timelines, but we keep you informed throughout the process.",
                category: "timeline",
                tags: ["installation time", "timeline", "weather", "efficiency"],
                priority: 6,
                isActive: true
            },
            {
                question: "Do you offer emergency roof services?",
                answer: "Yes, we provide 24/7 emergency services for storm damage, leaks, and urgent repairs. We can provide temporary solutions to prevent further damage and schedule permanent repairs as soon as possible.",
                category: "emergency",
                tags: ["emergency", "24/7", "storm damage", "leaks"],
                priority: 8,
                isActive: true
            }
        ]
    },
    {
        name: "General Contracting",
        description: "Full-service general contracting including home renovations, additions, kitchen and bathroom remodeling, and custom construction projects.",
        serviceTypes: [
            "Home Renovations",
            "Kitchen Remodeling",
            "Bathroom Remodeling",
            "Room Additions",
            "Basement Finishing",
            "Custom Home Building",
            "Deck Construction",
            "Flooring Installation",
            "Project Management"
        ],
        commonQAs: [
            {
                question: "How long does a typical kitchen remodel take?",
                answer: "Kitchen remodels typically take 4-8 weeks depending on scope and complexity. Simple updates may take 2-3 weeks, while full gut renovations can take 8-12 weeks. We provide detailed timelines and keep projects on schedule with regular updates.",
                category: "timeline",
                tags: ["kitchen remodel", "timeline", "scope", "updates"],
                priority: 9,
                isActive: true
            },
            {
                question: "Do you handle permits and inspections?",
                answer: "Yes, we manage all permits and coordinate required inspections. We're familiar with local building codes and ensure all work meets or exceeds standards. This takes the burden off homeowners and ensures compliant, safe construction.",
                category: "permits",
                tags: ["permits", "inspections", "building codes", "compliance"],
                priority: 8,
                isActive: true
            },
            {
                question: "Can you work within my budget?",
                answer: "Absolutely! We work with various budgets and help prioritize improvements for maximum impact. We provide detailed estimates, suggest cost-saving alternatives, and offer flexible scheduling to accommodate your financial planning.",
                category: "budget",
                tags: ["budget", "estimates", "cost-saving", "flexible"],
                priority: 10,
                isActive: true
            },
            {
                question: "Do you provide design services?",
                answer: "Yes, we offer design consultation and work with trusted architects and designers. We can help with space planning, material selection, and design coordination to ensure your vision becomes reality within budget and timeline constraints.",
                category: "design",
                tags: ["design", "consultation", "architects", "planning"],
                priority: 6,
                isActive: true
            },
            {
                question: "What's your warranty policy?",
                answer: "We provide comprehensive warranties on our work - typically 1-2 years on labor and pass through manufacturer warranties on materials. We stand behind our quality and address any issues promptly. Your satisfaction is our priority.",
                category: "warranty",
                tags: ["warranty", "quality", "satisfaction", "guarantee"],
                priority: 7,
                isActive: true
            }
        ]
    },
    {
        name: "Landscaping",
        description: "Professional landscaping services including design, installation, maintenance, and seasonal services for residential and commercial properties.",
        serviceTypes: [
            "Landscape Design",
            "Lawn Care & Maintenance",
            "Irrigation Systems",
            "Tree & Shrub Services",
            "Seasonal Cleanup",
            "Hardscape Installation",
            "Garden Installation",
            "Snow Removal",
            "Commercial Landscaping"
        ],
        commonQAs: [
            {
                question: "When is the best time to plant new landscaping?",
                answer: "Spring and fall are typically best for most plantings, avoiding summer heat stress and winter dormancy. Specific timing depends on plant types and local climate. We can advise on optimal planting schedules for your specific landscape goals.",
                category: "planting",
                tags: ["planting season", "timing", "climate", "plant care"],
                priority: 8,
                isActive: true
            },
            {
                question: "Do you offer maintenance packages?",
                answer: "Yes, we offer seasonal and year-round maintenance packages including mowing, fertilizing, pruning, and seasonal cleanups. Packages are customized to your landscape needs and budget, ensuring your property looks great all year long.",
                category: "maintenance",
                tags: ["maintenance packages", "seasonal", "customized", "year-round"],
                priority: 9,
                isActive: true
            },
            {
                question: "Can you help with drainage problems?",
                answer: "Absolutely! We assess drainage issues and provide solutions like French drains, grading adjustments, rain gardens, or irrigation modifications. Proper drainage protects your landscape investment and prevents water damage to your property.",
                category: "drainage",
                tags: ["drainage", "French drains", "grading", "water management"],
                priority: 7,
                isActive: true
            },
            {
                question: "Do you install irrigation systems?",
                answer: "Yes, we design and install efficient irrigation systems including sprinklers, drip irrigation, and smart controllers. We focus on water conservation while ensuring your landscape receives proper hydration for optimal health and appearance.",
                category: "irrigation",
                tags: ["irrigation", "sprinklers", "water conservation", "smart controllers"],
                priority: 6,
                isActive: true
            },
            {
                question: "What's included in landscape design services?",
                answer: "Our design process includes site analysis, concept development, detailed plans, plant selection, and material specifications. We consider your lifestyle, budget, maintenance preferences, and local conditions to create beautiful, functional landscapes.",
                category: "design",
                tags: ["landscape design", "planning", "plant selection", "specifications"],
                priority: 5,
                isActive: true
            }
        ]
    },
    {
        name: "Pest Control",
        description: "Comprehensive pest control services including inspection, treatment, prevention, and ongoing maintenance for residential and commercial properties.",
        serviceTypes: [
            "General Pest Control",
            "Termite Treatment",
            "Rodent Control",
            "Ant Control",
            "Spider Control",
            "Bed Bug Treatment",
            "Wildlife Removal",
            "Preventive Services",
            "Commercial Pest Control"
        ],
        commonQAs: [
            {
                question: "How often should I have pest control treatments?",
                answer: "We typically recommend quarterly treatments for general pest control, with monthly services during peak seasons. Treatment frequency depends on pest pressure, property type, and infestation history. We customize schedules based on your specific needs.",
                category: "scheduling",
                tags: ["treatment frequency", "quarterly", "seasonal", "customized"],
                priority: 9,
                isActive: true
            },
            {
                question: "Are your treatments safe for pets and children?",
                answer: "Yes, we use EPA-approved products and follow strict safety protocols. We can discuss pet and child-safe options, including organic treatments when appropriate. We provide detailed instructions for any necessary precautions after treatment.",
                category: "safety",
                tags: ["pet safe", "child safe", "EPA approved", "organic options"],
                priority: 10,
                isActive: true
            },
            {
                question: "Do you offer warranties on your services?",
                answer: "Yes, we provide service guarantees and will return at no charge if pests return between scheduled treatments. Our goal is complete customer satisfaction and effective long-term pest management for your property.",
                category: "warranty",
                tags: ["warranty", "guarantee", "satisfaction", "long-term"],
                priority: 8,
                isActive: true
            },
            {
                question: "Can you help identify what type of pest I have?",
                answer: "Absolutely! Our trained technicians can identify pest types during our free inspection. Proper identification is crucial for effective treatment. We'll explain what we find and recommend the best treatment approach for your specific situation.",
                category: "identification",
                tags: ["pest identification", "inspection", "trained technicians", "treatment approach"],
                priority: 7,
                isActive: true
            },
            {
                question: "Do you handle emergency pest situations?",
                answer: "Yes, we provide emergency services for urgent situations like wasp nests, rodent infestations, or bed bug discoveries. We understand pest problems can't wait and offer rapid response for urgent situations.",
                category: "emergency",
                tags: ["emergency", "urgent", "rapid response", "wasp nests"],
                priority: 6,
                isActive: true
            }
        ]
    },
    {
        name: "Cleaning Services",
        description: "Professional cleaning services for residential and commercial properties including regular maintenance, deep cleaning, and specialized services.",
        serviceTypes: [
            "Regular House Cleaning",
            "Deep Cleaning",
            "Move-in/Move-out Cleaning",
            "Office Cleaning",
            "Carpet Cleaning",
            "Window Cleaning",
            "Post-Construction Cleanup",
            "Green Cleaning",
            "Commercial Cleaning"
        ],
        commonQAs: [
            {
                question: "What's included in your regular cleaning service?",
                answer: "Our regular service includes dusting, vacuuming, mopping, bathroom cleaning, kitchen cleaning, and trash removal. We can customize services based on your needs and priorities. We bring all supplies and equipment unless you prefer we use yours.",
                category: "services",
                tags: ["regular cleaning", "customized", "supplies included", "comprehensive"],
                priority: 10,
                isActive: true
            },
            {
                question: "Are you bonded and insured?",
                answer: "Yes, we are fully bonded and insured for your protection and peace of mind. All our cleaning professionals are background-checked and trained. We carry comprehensive liability insurance to protect your property and belongings.",
                category: "credentials",
                tags: ["bonded", "insured", "background checked", "liability insurance"],
                priority: 9,
                isActive: true
            },
            {
                question: "Do you bring your own cleaning supplies?",
                answer: "Yes, we bring all professional-grade cleaning supplies and equipment. We use eco-friendly products when possible. If you prefer specific products or have allergies, we're happy to use your supplies or discuss alternative options.",
                category: "supplies",
                tags: ["supplies included", "professional grade", "eco-friendly", "custom products"],
                priority: 7,
                isActive: true
            },
            {
                question: "Can I schedule one-time or recurring services?",
                answer: "We offer both one-time and recurring services. Recurring options include weekly, bi-weekly, or monthly schedules. One-time services are perfect for deep cleaning, special events, or trying our services before committing to regular cleaning.",
                category: "scheduling",
                tags: ["one-time", "recurring", "flexible scheduling", "deep cleaning"],
                priority: 8,
                isActive: true
            },
            {
                question: "What if I'm not satisfied with the cleaning?",
                answer: "We guarantee your satisfaction! If you're not happy with any aspect of our cleaning, we'll return within 24 hours to re-clean those areas at no charge. Your satisfaction is our top priority, and we'll make it right.",
                category: "satisfaction",
                tags: ["satisfaction guarantee", "re-clean", "no charge", "priority"],
                priority: 6,
                isActive: true
            }
        ]
    }
];

// Seed function
const seedTradeCategories = async () => {
    try {
        console.log('🌱 Starting trade categories seed process...');
        
        // Clear existing categories
        await TradeCategory.deleteMany({});
        console.log('🗑️  Cleared existing trade categories');
        
        // Insert new categories
        const insertedCategories = await TradeCategory.insertMany(tradeCategories);
        console.log(`✅ Successfully seeded ${insertedCategories.length} trade categories:`);
        
        insertedCategories.forEach(category => {
            console.log(`   📂 ${category.name} (${category.commonQAs.length} Q&As)`);
        });
        
        console.log('\n🎉 Trade categories seed completed successfully!');
        console.log('\n📊 Summary:');
        console.log(`   Categories created: ${insertedCategories.length}`);
        
        const totalQAs = insertedCategories.reduce((sum, cat) => sum + cat.commonQAs.length, 0);
        console.log(`   Total Q&As created: ${totalQAs}`);
        
        const totalServiceTypes = insertedCategories.reduce((sum, cat) => sum + cat.serviceTypes.length, 0);
        console.log(`   Total service types: ${totalServiceTypes}`);
        
    } catch (error) {
        console.error('❌ Error seeding trade categories:', error);
        throw error;
    }
};

// Run the seed if called directly
if (require.main === module) {
    (async () => {
        try {
            await connectDB();
            await seedTradeCategories();
            console.log('\n🚀 Database seeding completed! You can now refresh the trade categories page.');
            process.exit(0);
        } catch (error) {
            console.error('💥 Seed process failed:', error);
            process.exit(1);
        }
    })();
}

module.exports = { seedTradeCategories, tradeCategories };
