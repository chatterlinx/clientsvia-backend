/**
 * Add Trade Category Q&As for Testing
 * Adds HVAC trade category Q&As to test the fallback chain
 */

const mongoose = require('mongoose');

async function addTradeQAs() {
    try {
        // Connect to database
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://macbookuser:YiS3BmhGoGLJIeKZ@cluster0.jh1hcdq.mongodb.net/clientsvia?retryWrites=true&w=majority&appName=Cluster0');
        console.log('📋 Connected to database');
        
        const db = mongoose.connection.db;
        const tradeCategoryQAs = db.collection('tradecategoryqas');
        
        // Check existing count
        const existingCount = await tradeCategoryQAs.countDocuments();
        console.log(`📊 Existing trade category Q&As: ${existingCount}`);
        
        // Sample HVAC trade category Q&As for testing
        const hvacQAs = [
            {
                categoryID: 'hvac-residential',
                trade: 'HVAC',
                question: 'How often should I change my air filter?',
                answer: 'Air filters should typically be changed every 1-3 months, depending on usage and air quality. During peak seasons (summer/winter), check monthly.',
                keywords: ['air', 'filter', 'change', 'replace', 'maintenance']
            },
            {
                categoryID: 'hvac-residential',
                trade: 'HVAC',
                question: 'My air conditioner is not cooling properly',
                answer: 'Check your air filter first, ensure all vents are open, and verify the thermostat is set correctly. If issues persist, you may need refrigerant service or coil cleaning.',
                keywords: ['air', 'conditioner', 'cooling', 'not', 'working', 'cold']
            },
            {
                categoryID: 'hvac-residential',
                trade: 'HVAC',
                question: 'Why is my heating system making strange noises?',
                answer: 'Unusual noises can indicate loose components, worn belts, or airflow issues. Turn off the system and contact a professional for inspection.',
                keywords: ['heating', 'noises', 'sounds', 'strange', 'loud', 'noise']
            },
            {
                categoryID: 'hvac-residential',
                trade: 'HVAC',
                question: 'What maintenance should I do regularly?',
                answer: 'Regular maintenance includes changing air filters monthly, keeping outdoor units clear of debris, and scheduling annual professional inspections.',
                keywords: ['maintenance', 'regular', 'schedule', 'service', 'care']
            },
            {
                categoryID: 'hvac-residential',
                trade: 'HVAC',
                question: 'My thermostat display issues troubleshooting',
                answer: 'For display problems, check batteries first, verify wiring connections, and ensure the circuit breaker is on. A blank display often indicates power issues.',
                keywords: ['thermostat', 'display', 'blank', 'screen', 'troubleshoot']
            }
        ];
        
        // Insert the Q&As
        if (existingCount === 0) {
            const result = await tradeCategoryQAs.insertMany(hvacQAs);
            console.log(`✅ Added ${result.insertedCount} trade category Q&As`);
        } else {
            console.log('📋 Trade Q&As already exist, skipping insert');
        }
        
        // Verify the insert
        const newCount = await tradeCategoryQAs.countDocuments();
        console.log(`📊 Total trade category Q&As: ${newCount}`);
        
        // Show sample
        const sample = await tradeCategoryQAs.find({ categoryID: 'hvac-residential' }).limit(3).toArray();
        console.log('🔍 Sample HVAC Q&As:');
        sample.forEach((qa, i) => {
            console.log(`   ${i+1}. Q: ${qa.question}`);
            console.log(`      A: ${qa.answer.substring(0, 100)}...`);
        });
        
        console.log('✅ Trade category Q&As setup complete');
        
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

addTradeQAs();
