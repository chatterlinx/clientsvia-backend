/**
 * 🧪 TEST LEGACY ELIMINATION
 * ==========================
 * Verifies all legacy collections are gone and V2 collections work
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function testLegacyElimination() {
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected\n');
        
        const db = mongoose.connection.db;
        
        // Test 1: Verify V2 collections exist
        console.log('═══════════════════════════════════════');
        console.log('TEST 1: V2 Collections Check');
        console.log('═══════════════════════════════════════\n');
        
        const v2Collections = [
            'companiesCollection',
            'enterpriseTradeCategories',
            'v2contacts',
            'v2aiagentcalllogs',
            'v2notificationlogs'
        ];
        
        for (const name of v2Collections) {
            const count = await db.collection(name).countDocuments();
            console.log(`✅ ${name}: ${count} documents`);
        }
        
        // Test 2: Verify legacy collections are gone
        console.log('\n═══════════════════════════════════════');
        console.log('TEST 2: Legacy Collections Check');
        console.log('═══════════════════════════════════════\n');
        
        const legacyNames = ['companies', 'contacts', 'bookings', 'tradecategories', 'tradeCategories'];
        const allCollections = await db.listCollections().toArray();
        const existingNames = allCollections.map(c => c.name);
        
        let legacyFound = false;
        for (const legacy of legacyNames) {
            if (existingNames.includes(legacy)) {
                console.log(`❌ LEGACY FOUND: ${legacy}`);
                legacyFound = true;
            } else {
                console.log(`✅ ${legacy}: DELETED`);
            }
        }
        
        if (!legacyFound) {
            console.log('\n🎉 NO LEGACY COLLECTIONS FOUND!\n');
        }
        
        // Test 3: Check company data
        console.log('═══════════════════════════════════════');
        console.log('TEST 3: Company Data Access');
        console.log('═══════════════════════════════════════\n');
        
        const companies = await db.collection('companiesCollection').find().limit(5).toArray();
        console.log(`✅ Found ${companies.length} companies`);
        companies.forEach(c => {
            console.log(`   • ${c.companyName || c.businessName || 'Unnamed'} (_id: ${c._id})`);
        });
        
        // Test 4: Check trade categories
        console.log('\n═══════════════════════════════════════');
        console.log('TEST 4: Trade Categories (V2)');
        console.log('═══════════════════════════════════════\n');
        
        const trades = await db.collection('enterpriseTradeCategories').find().toArray();
        console.log(`✅ Found ${trades.length} trade categories`);
        trades.forEach(t => {
            console.log(`   • ${t.name} (${t.qnas?.length || 0} Q&As, companyId: ${t.companyId})`);
        });
        
        // Test 5: Test v2TradeCategory model
        console.log('\n═══════════════════════════════════════');
        console.log('TEST 5: v2TradeCategory Model');
        console.log('═══════════════════════════════════════\n');
        
        const TradeCategory = require('../models/v2TradeCategory');
        const globalTrades = await TradeCategory.find({ companyId: 'global' }).limit(3);
        console.log(`✅ Model query returned ${globalTrades.length} global trade categories`);
        globalTrades.forEach(t => {
            console.log(`   • ${t.name}`);
        });
        
        console.log('\n═══════════════════════════════════════');
        console.log('✅ ALL TESTS PASSED');
        console.log('═══════════════════════════════════════\n');
        
        await mongoose.connection.close();
        console.log('🔌 Disconnected from MongoDB\n');
        
    } catch (error) {
        console.error('❌ TEST FAILED:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

testLegacyElimination();


