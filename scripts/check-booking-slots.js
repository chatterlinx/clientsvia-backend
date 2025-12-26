/**
 * Quick diagnostic: Check what booking slots exist in the database for Penguin Air
 */
const mongoose = require('mongoose');
require('dotenv').config();

async function checkBookingSlots() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');
        
        const Company = require('../models/v2Company');
        const company = await Company.findById('68e3f77a9d623b8058c700c4').lean();
        
        if (!company) {
            console.log('Company not found!');
            return;
        }
        
        console.log('\n=== COMPANY: ' + company.companyName + ' ===\n');
        
        // Check all possible paths
        console.log('PATH 1: aiAgentSettings.frontDeskBehavior.bookingSlots');
        const path1 = company?.aiAgentSettings?.frontDeskBehavior?.bookingSlots;
        console.log('  Exists:', !!path1);
        console.log('  Is Array:', Array.isArray(path1));
        console.log('  Length:', path1?.length || 0);
        if (path1?.length > 0) {
            console.log('  First slot:', JSON.stringify(path1[0], null, 2));
        }
        
        console.log('\nPATH 2: aiAgentSettings.callFlowEngine.bookingFields');
        const path2 = company?.aiAgentSettings?.callFlowEngine?.bookingFields;
        console.log('  Exists:', !!path2);
        console.log('  Length:', path2?.length || 0);
        
        console.log('\nPATH 3: aiAgentSettings.frontDeskBehavior.bookingPrompts');
        const path3 = company?.aiAgentSettings?.frontDeskBehavior?.bookingPrompts;
        console.log('  Exists:', !!path3);
        console.log('  askName:', path3?.askName);
        console.log('  askPhone:', path3?.askPhone);
        
        console.log('\nFULL frontDeskBehavior keys:');
        const fdb = company?.aiAgentSettings?.frontDeskBehavior;
        console.log('  ', fdb ? Object.keys(fdb) : 'NOT FOUND');
        
    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await mongoose.disconnect();
    }
}

checkBookingSlots();
