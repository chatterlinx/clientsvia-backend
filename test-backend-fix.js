/**
 * Test Backend Fix for Trade Q&A Chain Break
 * Verifies that trade category Q&As are returned when company Q&As have no good matches
 */

const mongoose = require('mongoose');
const Company = require('./models/Company');
const SuperIntelligentAgentEngine = require('./services/superIntelligentAgent');

async function testBackendFix() {
    try {
        console.log('🔧 BACKEND FIX TEST');
        console.log('===================');
        
        // Connect to database using production URI
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost/ClientsViaDB';
        console.log('📋 Connecting to database...');
        await mongoose.connect(mongoUri);
        console.log('📋 Connected to database');
        
        // Get Penguin Air company
        const company = await Company.findOne({ name: 'Penguin Air Conditioning' });
        if (!company) {
            console.error('❌ Penguin Air not found');
            return;
        }
        
        console.log('✅ Company: Penguin Air Conditioning');
        console.log(`   ID: ${company._id}`);
        console.log(`   Custom Q&As: ${company.customQAs?.length || 0}`);
        console.log(`   Trade Q&As: ${company.tradeCategoryQAs?.length || 0}`);
        
        // Initialize the intelligent agent
        const engine = new SuperIntelligentAgentEngine();
        
        // Test queries that should trigger trade Q&A fallback
        const testQueries = [
            'blank thermostat',
            'thermostat screen blank',
            'thermostat display not working',
            'air filter replacement',
            'heating system maintenance'
        ];
        
        console.log('\n🎯 TESTING QUERIES');
        console.log('==================');
        
        for (const query of testQueries) {
            console.log(`\n📝 Query: "${query}"`);
            
            try {
                const result = await engine.semanticSearch(query, company._id);
                console.log(`   Best Match: ${result.confidence ? (result.confidence * 100).toFixed(1) + '%' : 'None'}`);
                console.log(`   Source: ${result.source || 'None'}`);
                console.log(`   Question: ${result.matchedQuery || 'None'}`);
                
                if (result.answer) {
                    console.log(`   Answer: ${result.answer.substring(0, 100)}${result.answer.length > 100 ? '...' : ''}`);
                }
                
                // Test the full handle query flow
                const handleResult = await engine.handleQuery(query, company._id);
                console.log(`   Final Response: ${handleResult.response.substring(0, 100)}${handleResult.response.length > 100 ? '...' : ''}`);
                console.log(`   Final Confidence: ${(handleResult.confidence * 100).toFixed(1)}%`);
                console.log(`   Should Escalate: ${handleResult.shouldEscalate}`);
                
            } catch (error) {
                console.error(`   ❌ Error: ${error.message}`);
            }
        }
        
        console.log('\n✅ Backend fix test completed');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

testBackendFix();
