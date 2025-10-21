// ============================================================================
// 🔔 CREATE NOTIFICATION CENTER IN PRODUCTION
// ============================================================================
// This creates the Notification Center company with proper twilioConfig
// so the existing phone lookup logic finds it.
// ============================================================================

require('dotenv').config();
const mongoose = require('mongoose');
const v2Company = require('../models/v2Company');

async function createNotificationCenter() {
    console.log('🔔 [CREATE] Creating Notification Center in production...');
    
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ [CREATE] Connected to MongoDB');
        console.log(`   Database: ${process.env.MONGODB_URI.includes('localhost') ? 'LOCAL' : 'PRODUCTION'}`);
        
        // Check if exists
        let company = await v2Company.findOne({ 'metadata.isNotificationCenter': true });
        
        if (company) {
            console.log('📋 [CREATE] Notification Center already exists!');
            console.log(`   Company ID: ${company._id}`);
            console.log(`   businessPhone: ${company.businessPhone}`);
            console.log(`   twilioConfig.phoneNumber: ${company.twilioConfig?.phoneNumber}`);
            
            // Update twilioConfig if missing
            if (!company.twilioConfig?.phoneNumber) {
                console.log('🔧 [CREATE] Fixing twilioConfig...');
                
                company.twilioConfig = {
                    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
                    authToken: process.env.TWILIO_AUTH_TOKEN || '',
                    phoneNumber: '+18885222241'
                };
                
                await company.save();
                console.log('✅ [CREATE] twilioConfig updated');
            } else {
                console.log('✅ [CREATE] twilioConfig already correct');
            }
            
        } else {
            console.log('📝 [CREATE] Creating new Notification Center...');
            
            company = await v2Company.create({
                companyName: '🔔 Admin Notification Center',
                businessName: 'Notification Center',
                businessPhone: '+18885222241',
                email: 'notifications@clientsvia.com',
                status: 'LIVE',
                
                // CRITICAL: Set twilioConfig so getCompanyByPhoneNumber finds it
                twilioConfig: {
                    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
                    authToken: process.env.TWILIO_AUTH_TOKEN || '',
                    phoneNumber: '+18885222241'
                },
                
                metadata: {
                    isNotificationCenter: true,
                    purpose: 'Platform-wide admin test calls and system verification',
                    createdBy: 'create-notification-center-production',
                    setupAt: new Date()
                }
            });
            
            console.log('✅ [CREATE] Notification Center created!');
            console.log(`   Company ID: ${company._id}`);
        }
        
        console.log('\n🎉 [CREATE] Setup complete!');
        console.log('\n📞 TEST IT:');
        console.log('   Call +18885222241');
        console.log('   You should hear your test greeting');
        
    } catch (error) {
        console.error('❌ [CREATE] Failed:', error);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('\n✅ [CREATE] Disconnected from MongoDB');
    }
}

if (require.main === module) {
    createNotificationCenter();
}

module.exports = { createNotificationCenter };

