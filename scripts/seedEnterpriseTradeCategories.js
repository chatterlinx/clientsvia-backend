// scripts/seedEnterpriseTradeCategories.js
// Seed script to populate enterprise trade categories with Q&As and auto-generated keywords

const { MongoClient } = require('mongodb');
require('dotenv').config();

const COLLECTION_NAME = 'enterpriseTradeCategories';

// AI-powered keyword generator (same as in the route)
function generateKeywords(question, answer, categoryName) {
    const text = `${question} ${answer} ${categoryName}`.toLowerCase();
    
    // Extract technical terms, brand names, and service types
    const technicalTerms = text.match(/\b(?:hvac|plumbing|electrical|repair|maintenance|installation|service|emergency|commercial|residential|industrial)\b/g) || [];
    
    // Extract specific equipment/systems
    const equipment = text.match(/\b(?:furnace|boiler|water\s*heater|ac|air\s*conditioner|pipe|drain|circuit|breaker|outlet|switch|pump|valve|thermostat|duct|filter)\b/g) || [];
    
    // Extract service actions
    const actions = text.match(/\b(?:install|repair|replace|maintain|clean|inspect|diagnose|fix|upgrade|service|troubleshoot)\b/g) || [];
    
    // Extract urgency indicators
    const urgency = text.match(/\b(?:emergency|urgent|immediate|asap|leak|flood|no\s*heat|no\s*cooling|outage|broken)\b/g) || [];
    
    // Extract location indicators
    const locations = text.match(/\b(?:basement|attic|kitchen|bathroom|garage|office|warehouse|retail|home|business)\b/g) || [];
    
    // Combine and deduplicate
    const allKeywords = [...new Set([
        ...technicalTerms,
        ...equipment,
        ...actions,
        ...urgency,
        ...locations
    ])];
    
    // Add category-specific keywords
    const categoryKeywords = {
        'hvac': ['heating', 'cooling', 'ventilation', 'climate', 'temperature'],
        'plumbing': ['water', 'sewer', 'drainage', 'pipes', 'fixtures'],
        'electrical': ['power', 'wiring', 'outlets', 'lighting', 'voltage'],
        'general': ['maintenance', 'repair', 'service', 'inspection']
    };
    
    const categoryKey = categoryName.toLowerCase();
    if (categoryKeywords[categoryKey]) {
        allKeywords.push(...categoryKeywords[categoryKey]);
    }
    
    return [...new Set(allKeywords)].slice(0, 15);
}

// Sample trade categories with Q&As
const tradeCategories = [
    {
        name: 'HVAC',
        description: 'Heating, ventilation, and air conditioning services including installation, repair, and maintenance',
        companyId: 'global',
        qnas: [
            {
                question: 'My air conditioner is not cooling properly, what could be wrong?',
                answer: 'Common issues include dirty air filters, low refrigerant levels, blocked condenser coils, or thermostat problems. Check your air filter first - if it\'s dirty, replace it. If the problem persists, contact a professional HVAC technician for diagnosis.',
                manualKeywords: ['cooling', 'troubleshooting']
            },
            {
                question: 'How often should I replace my HVAC air filters?',
                answer: 'Generally, air filters should be replaced every 1-3 months depending on usage, filter type, and environmental factors. Homes with pets or allergies may need more frequent changes. Check your filter monthly and replace when visibly dirty.',
                manualKeywords: ['maintenance', 'schedule']
            },
            {
                question: 'What temperature should I set my thermostat to save energy?',
                answer: 'For optimal energy savings, set your thermostat to 68°F in winter and 78°F in summer when home. When away, adjust by 7-10 degrees. Using a programmable or smart thermostat can automate these changes and save 10% annually on heating and cooling costs.',
                manualKeywords: ['energy', 'savings', 'optimization']
            },
            {
                question: 'My furnace is making strange noises, should I be concerned?',
                answer: 'Yes, unusual furnace noises warrant attention. Grinding may indicate motor bearing issues, squealing could mean belt problems, and banging might suggest delayed ignition. Turn off your system and contact a professional immediately for safety.',
                manualKeywords: ['noise', 'safety', 'emergency']
            },
            {
                question: 'How do I know if my HVAC system needs professional maintenance?',
                answer: 'Signs include uneven heating/cooling, increased energy bills, frequent cycling, poor air quality, or system age over 10 years. Schedule professional maintenance twice yearly - spring for AC, fall for heating. Regular maintenance extends equipment life and maintains efficiency.',
                manualKeywords: ['professional', 'maintenance', 'signs']
            }
        ]
    },
    {
        name: 'Plumbing',
        description: 'Residential and commercial plumbing services including pipe repair, fixture installation, drain cleaning, and water heater services',
        companyId: 'global',
        qnas: [
            {
                question: 'My toilet is constantly running, how do I fix it?',
                answer: 'A running toilet is usually caused by a faulty flapper, chain, or fill valve. Check if the flapper is sealing properly, adjust the chain length, or replace the fill valve if necessary. Turn off water supply if you can\'t stop the running.',
                manualKeywords: ['toilet', 'running', 'fix']
            },
            {
                question: 'What should I do if my sink is draining slowly?',
                answer: 'Slow drains are often caused by hair, soap scum, or food debris. Try a plunger first, then a drain snake. For kitchen sinks, avoid chemical drain cleaners as they can damage pipes. If the problem persists, contact a plumber.',
                manualKeywords: ['drain', 'slow', 'clog']
            },
            {
                question: 'How do I shut off my water in case of an emergency?',
                answer: 'Locate your main water shut-off valve, typically near where the water line enters your home, often in the basement, crawl space, or near the water meter. Turn clockwise to shut off. Every household member should know this location.',
                manualKeywords: ['emergency', 'shutoff', 'valve']
            },
            {
                question: 'My water heater is not producing hot water, what could be wrong?',
                answer: 'Check if the pilot light is lit (gas) or circuit breaker hasn\'t tripped (electric). For gas units, ensure gas supply is on. If these don\'t resolve the issue, you may need professional service for thermostat, heating element, or gas valve problems.',
                manualKeywords: ['water heater', 'hot water', 'troubleshooting']
            },
            {
                question: 'How often should I have my drains professionally cleaned?',
                answer: 'Professional drain cleaning is recommended annually for preventive maintenance, or immediately if you notice multiple slow drains, frequent clogs, or sewage odors. Regular cleaning prevents major blockages and extends your plumbing system\'s life.',
                manualKeywords: ['professional', 'cleaning', 'maintenance']
            }
        ]
    },
    {
        name: 'Electrical',
        description: 'Electrical services including wiring, outlet installation, circuit breaker repair, and electrical safety inspections',
        companyId: 'global',
        qnas: [
            {
                question: 'My circuit breaker keeps tripping, what should I do?',
                answer: 'A tripping breaker indicates circuit overload, short circuit, or ground fault. Unplug devices on that circuit, then reset the breaker. If it immediately trips again, stop and call an electrician - this could indicate a serious electrical problem.',
                manualKeywords: ['breaker', 'tripping', 'overload']
            },
            {
                question: 'How do I know if my home needs electrical rewiring?',
                answer: 'Signs include frequently blown fuses, flickering lights, burning smells, discolored outlets, or homes over 40 years old with original wiring. Professional electrical inspection is recommended to assess safety and code compliance.',
                manualKeywords: ['rewiring', 'signs', 'safety']
            },
            {
                question: 'What should I do if an outlet is not working?',
                answer: 'First, check if other outlets on the same circuit work. Test the GFCI reset button if applicable. Check the circuit breaker panel for tripped breakers. If these steps don\'t resolve the issue, contact a qualified electrician.',
                manualKeywords: ['outlet', 'not working', 'GFCI']
            },
            {
                question: 'How often should I test my GFCI outlets?',
                answer: 'GFCI outlets should be tested monthly by pressing the "Test" button, which should cut power to the outlet. Press "Reset" to restore power. If the outlet doesn\'t respond properly to testing, replace it immediately for safety.',
                manualKeywords: ['GFCI', 'testing', 'safety']
            },
            {
                question: 'When should I upgrade my electrical panel?',
                answer: 'Consider upgrading if your panel is over 25 years old, has fewer than 100 amps service, uses fuses instead of breakers, or if you\'re adding major appliances. Modern panels improve safety and support today\'s electrical demands.',
                manualKeywords: ['panel', 'upgrade', 'safety']
            }
        ]
    },
    {
        name: 'General Repair',
        description: 'General home and commercial maintenance and repair services including handyman work, appliance repair, and property maintenance',
        companyId: 'global',
        qnas: [
            {
                question: 'How do I fix a squeaky door hinge?',
                answer: 'Apply a few drops of household oil (3-in-1 oil, WD-40, or even olive oil) to the hinge pins and pivot points. Work the door back and forth several times. For persistent squeaks, remove the hinge pin, clean it, and apply lubricant before reinstalling.',
                manualKeywords: ['door', 'squeak', 'hinge']
            },
            {
                question: 'What basic tools should every homeowner have?',
                answer: 'Essential tools include: hammer, screwdriver set, adjustable wrench, pliers, level, measuring tape, utility knife, drill with bits, stud finder, and safety equipment. These handle most basic repairs and maintenance tasks.',
                manualKeywords: ['tools', 'homeowner', 'basic']
            },
            {
                question: 'How do I patch a small hole in drywall?',
                answer: 'For holes smaller than a nail, use spackling compound. For larger holes up to 3 inches, use a self-adhesive mesh patch and joint compound. Apply compound, let dry, sand smooth, and paint to match existing wall.',
                manualKeywords: ['drywall', 'patch', 'hole']
            },
            {
                question: 'My garbage disposal is jammed, how do I fix it?',
                answer: 'Turn off power and water. Use the hex wrench (usually provided with disposal) to manually turn the motor from underneath. Remove visible obstructions with tongs (never hands). Press reset button and test. If still jammed, call a professional.',
                manualKeywords: ['garbage disposal', 'jam', 'fix']
            },
            {
                question: 'How often should I perform basic home maintenance?',
                answer: 'Monthly: test smoke detectors, check GFCI outlets. Seasonally: clean gutters, service HVAC, check weatherstripping. Annually: inspect roof, service appliances, check caulking. Create a maintenance schedule to prevent major issues.',
                manualKeywords: ['maintenance', 'schedule', 'preventive']
            }
        ]
    }
];

async function seedTradeCategories() {
    let client;
    
    try {
        console.log('Connecting to MongoDB...');
        client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
        
        const db = client.db();
        const collection = db.collection(COLLECTION_NAME);
        
        console.log('Clearing existing enterprise trade categories...');
        await collection.deleteMany({});
        
        console.log('Creating enterprise trade categories with Q&As and keywords...');
        
        for (const category of tradeCategories) {
            // Process Q&As to add auto-generated keywords and metadata
            const processedQnAs = category.qnas.map(qna => {
                const autoKeywords = generateKeywords(qna.question, qna.answer, category.name);
                const allKeywords = [...new Set([...(qna.manualKeywords || []), ...autoKeywords])];
                
                return {
                    id: new Date().getTime() + Math.random(), // Simple ID generation
                    question: qna.question,
                    answer: qna.answer,
                    keywords: allKeywords,
                    autoGenerated: autoKeywords,
                    manualKeywords: qna.manualKeywords || [],
                    confidence: 0.85,
                    isActive: true,
                    metadata: {
                        createdAt: new Date(),
                        createdBy: 'system-seed',
                        updatedAt: new Date(),
                        usage: {
                            timesMatched: 0,
                            lastMatched: null,
                            averageConfidence: 0.85
                        }
                    }
                };
            });
            
            const categoryDoc = {
                name: category.name,
                description: category.description,
                companyId: category.companyId,
                qnas: processedQnAs,
                isActive: true,
                metadata: {
                    totalQAs: processedQnAs.length,
                    totalKeywords: processedQnAs.reduce((sum, qna) => sum + qna.keywords.length, 0),
                    lastUpdated: new Date(),
                    version: '1.0.0'
                },
                audit: {
                    createdAt: new Date(),
                    createdBy: 'system-seed',
                    updatedAt: new Date(),
                    updatedBy: 'system-seed'
                }
            };
            
            await collection.insertOne(categoryDoc);
            console.log(`✅ Created category: ${category.name} with ${processedQnAs.length} Q&As`);
        }
        
        console.log('\n🎉 Enterprise trade categories seeded successfully!');
        
        // Display summary
        const totalCategories = tradeCategories.length;
        const totalQnAs = tradeCategories.reduce((sum, cat) => sum + cat.qnas.length, 0);
        const totalKeywords = await collection.aggregate([
            { $unwind: '$qnas' },
            { $project: { keywordCount: { $size: '$qnas.keywords' } } },
            { $group: { _id: null, total: { $sum: '$keywordCount' } } }
        ]).toArray();
        
        console.log(`\n📊 Summary:`);
        console.log(`   Categories: ${totalCategories}`);
        console.log(`   Q&As: ${totalQnAs}`);
        console.log(`   Keywords: ${totalKeywords[0]?.total || 0}`);
        
    } catch (error) {
        console.error('❌ Error seeding trade categories:', error);
    } finally {
        if (client) {
            await client.close();
            console.log('Database connection closed.');
        }
    }
}

// Run the seed script
if (require.main === module) {
    seedTradeCategories().then(() => {
        process.exit(0);
    }).catch(error => {
        console.error('Failed to seed trade categories:', error);
        process.exit(1);
    });
}

module.exports = { seedTradeCategories };
