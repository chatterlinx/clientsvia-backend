#!/usr/bin/env node

/**
 * Fix Corrupt Company Data
 * 
 * Scans company documents for corrupt "default" string values
 * that should be objects with nested properties.
 * 
 * Run: node scripts/fix-corrupt-company-data.js [companyId]
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function fixCorruptData() {
    await mongoose.connect(process.env.MONGODB_URI);
    
    const db = mongoose.connection.db;
    const companies = db.collection('v2companies');
    
    const companyId = process.argv[2] || '68e3f77a9d623b8058c700c4'; // Royal Plumbing
    
    console.log(`\n🔍 Scanning company ${companyId} for corrupt data...\n`);
    
    const company = await companies.findOne({ _id: new mongoose.Types.ObjectId(companyId) });
    
    if (!company) {
        console.log('❌ Company not found');
        await mongoose.disconnect();
        process.exit(1);
    }
    
    console.log(`✅ Found company: ${company.companyName}\n`);
    
    const fixes = [];
    
    // Recursively find fields with string "default" or "Default"
    function findCorruptFields(obj, path = '', parentObj = null, parentKey = null) {
        if (!obj || typeof obj !== 'object') return;
        
        for (const [key, value] of Object.entries(obj)) {
            const currentPath = path ? `${path}.${key}` : key;
            
            if (value === 'default' || value === 'Default') {
                console.log(`❌ CORRUPT FIELD: ${currentPath} = "${value}"`);
                fixes.push({ path: currentPath, value, parentObj, parentKey: key });
            } else if (typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)) {
                findCorruptFields(value, currentPath, obj, key);
            } else if (Array.isArray(value)) {
                value.forEach((item, index) => {
                    if (typeof item === 'object' && item !== null) {
                        findCorruptFields(item, `${currentPath}[${index}]`, value, index);
                    }
                });
            }
        }
    }
    
    findCorruptFields(company);
    
    if (fixes.length === 0) {
        console.log('\n✅ No corrupt fields found!\n');
        await mongoose.disconnect();
        process.exit(0);
    }
    
    console.log(`\n⚠️  Found ${fixes.length} corrupt field(s)\n`);
    console.log('🔧 Fixes needed:');
    fixes.forEach((fix, i) => {
        console.log(`  ${i + 1}. ${fix.path} = "${fix.value}" → should be removed or replaced with valid object`);
    });
    
    console.log('\n💡 To fix automatically, uncomment the fix code in this script and re-run.\n');
    
    // UNCOMMENT TO AUTO-FIX:
    // const updates = {};
    // fixes.forEach(fix => {
    //     updates[fix.path] = null; // or set to proper default object
    // });
    // 
    // await companies.updateOne(
    //     { _id: new mongoose.Types.ObjectId(companyId) },
    //     { $unset: updates }
    // );
    // 
    // console.log('✅ Corrupt fields removed!\n');
    
    await mongoose.disconnect();
    process.exit(0);
}

fixCorruptData().catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
});

