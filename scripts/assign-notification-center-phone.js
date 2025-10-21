// ============================================================================
// 🔔 ASSIGN PHONE TO NOTIFICATION CENTER
// ============================================================================
// Purpose: Assign your Twilio number to the Notification Center company
//
// Usage: node scripts/assign-notification-center-phone.js
//
// This ensures the Notification Center company owns +18885222241 so:
// 1. Calls to that number are properly routed
// 2. System test greeting plays when no company is found
// 3. SMS webhooks work for alert acknowledgments
// ============================================================================

require('dotenv').config();
const mongoose = require('mongoose');
const v2Company = require('../models/v2Company');

async function assignPhone() {
    console.log('🔔 [ASSIGN] Assigning Twilio number to Notification Center...');
    
    try {
        // Connect to database
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ [ASSIGN] Connected to MongoDB');
        
        const twilioNumber = '+18885222241';  // Your actual Twilio number
        
        // Find or create Notification Center
        let notificationCenter = await v2Company.findOne({
            'metadata.isNotificationCenter': true
        });
        
        if (!notificationCenter) {
            console.log('📝 [ASSIGN] Notification Center does not exist. Creating...');
            
            notificationCenter = await v2Company.create({
                companyName: '🔔 Admin Notification Center',
                businessName: 'Notification Center',
                businessPhone: twilioNumber,  // ACTUAL PHONE
                email: 'notifications@clientsvia.com',
                status: 'LIVE',
                
                contacts: [],  // Admin contacts managed via AdminSettings now
                
                metadata: {
                    isNotificationCenter: true,
                    purpose: 'Platform-wide admin alerts and test call system',
                    createdBy: 'assign-phone-script',
                    setupAt: new Date()
                }
            });
            
            console.log(`✅ [ASSIGN] Notification Center CREATED with phone: ${twilioNumber}`);
            console.log(`   Company ID: ${notificationCenter._id}`);
            
        } else {
            console.log(`📋 [ASSIGN] Notification Center found: ${notificationCenter._id}`);
            console.log(`   Old phone: ${notificationCenter.businessPhone}`);
            
            // Update phone number
            notificationCenter.businessPhone = twilioNumber;
            notificationCenter.metadata.phoneUpdatedAt = new Date();
            
            await notificationCenter.save();
            
            console.log(`✅ [ASSIGN] Phone updated to: ${twilioNumber}`);
        }
        
        console.log('\n🎉 [ASSIGN] Assignment complete!');
        console.log('\n📞 TEST IT:');
        console.log(`   1. Call ${twilioNumber}`);
        console.log('   2. You should hear your custom test greeting');
        console.log('   3. Check Render logs for "[SYSTEM TEST]" messages');
        
    } catch (error) {
        console.error('❌ [ASSIGN] Failed:', error);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('\n✅ [ASSIGN] Disconnected from MongoDB');
    }
}

// Run if called directly
if (require.main === module) {
    assignPhone();
}

module.exports = { assignPhone };

