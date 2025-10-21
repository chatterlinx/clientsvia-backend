// ============================================================================
// DIAGNOSE SMS TEST - Why isn't it working?
// ============================================================================

require('dotenv').config();

console.log('\n' + '='.repeat(80));
console.log('SMS TEST DIAGNOSTIC REPORT');
console.log('='.repeat(80) + '\n');

// ============================================================================
// 1. ENVIRONMENT VARIABLES CHECK
// ============================================================================
console.log('📋 STEP 1: Checking Environment Variables\n');

const checks = {
    gmail: {
        user: !!process.env.GMAIL_USER,
        password: !!process.env.GMAIL_APP_PASSWORD
    },
    twilio: {
        accountSid: !!process.env.TWILIO_ACCOUNT_SID,
        authToken: !!process.env.TWILIO_AUTH_TOKEN,
        phoneNumber: !!process.env.TWILIO_PHONE_NUMBER
    }
};

console.log('Gmail Configuration:');
console.log(`  ✅ GMAIL_USER: ${checks.gmail.user ? 'SET' : '❌ NOT SET'}`);
console.log(`  ✅ GMAIL_APP_PASSWORD: ${checks.gmail.password ? 'SET' : '❌ NOT SET'}`);

console.log('\nTwilio Configuration:');
console.log(`  ${checks.twilio.accountSid ? '✅' : '❌'} TWILIO_ACCOUNT_SID: ${checks.twilio.accountSid ? 'SET' : 'NOT SET'}`);
console.log(`  ${checks.twilio.authToken ? '✅' : '❌'} TWILIO_AUTH_TOKEN: ${checks.twilio.authToken ? 'SET' : 'NOT SET'}`);
console.log(`  ${checks.twilio.phoneNumber ? '✅' : '❌'} TWILIO_PHONE_NUMBER: ${checks.twilio.phoneNumber ? 'SET' : 'NOT SET'}`);

// ============================================================================
// 2. DATABASE CONNECTION CHECK
// ============================================================================
console.log('\n' + '='.repeat(80));
console.log('📋 STEP 2: Checking Database Connection\n');

(async () => {
    try {
        const mongoose = require('mongoose');
        
        if (mongoose.connection.readyState === 0) {
            console.log('Connecting to MongoDB...');
            await mongoose.connect(process.env.MONGODB_URI, {
                serverSelectionTimeoutMS: 5000
            });
        }
        
        console.log('✅ MongoDB connected');
        
        // ============================================================================
        // 3. ADMIN SETTINGS CHECK
        // ============================================================================
        console.log('\n' + '='.repeat(80));
        console.log('📋 STEP 3: Checking Admin Settings & Contacts\n');
        
        const AdminSettings = require('../models/AdminSettings');
        const settings = await AdminSettings.findOne({});
        
        if (!settings) {
            console.log('❌ No AdminSettings document found in database');
            console.log('\n⚠️  ACTION REQUIRED:');
            console.log('   1. Go to Notification Center in admin UI');
            console.log('   2. Add an admin contact with email enabled');
            console.log('   3. Save settings\n');
        } else {
            console.log('✅ AdminSettings document exists');
            
            const adminContacts = settings?.notificationCenter?.adminContacts || [];
            console.log(`\n📧 Admin Contacts: ${adminContacts.length} total`);
            
            if (adminContacts.length === 0) {
                console.log('❌ No admin contacts configured');
                console.log('\n⚠️  ACTION REQUIRED:');
                console.log('   1. Go to https://clientsvia-backend.onrender.com/admin-notification-center.html');
                console.log('   2. Click "Settings" tab');
                console.log('   3. Add an admin contact:');
                console.log('      - Name: Your Name');
                console.log('      - Phone: +12395652202');
                console.log('      - Email: clientsvia@gmail.com (from dropdown)');
                console.log('      - Check "Receive SMS" and "Receive Email"');
                console.log('   4. Click "Add Contact"\n');
            } else {
                adminContacts.forEach((contact, i) => {
                    console.log(`\nContact #${i + 1}:`);
                    console.log(`  Name: ${contact.name}`);
                    console.log(`  Phone: ${contact.phone}`);
                    console.log(`  Email: ${contact.email || 'NOT SET'}`);
                    console.log(`  Receive SMS: ${contact.receiveSMS ? '✅' : '❌'}`);
                    console.log(`  Receive Email: ${contact.receiveEmail ? '✅' : '❌'}`);
                    console.log(`  Receive Calls: ${contact.receiveCalls ? '✅' : '❌'}`);
                    
                    if (contact.receiveEmail && contact.email) {
                        console.log(`  ✅ READY to receive email notifications`);
                    } else {
                        console.log(`  ⚠️  Will NOT receive email notifications`);
                    }
                });
            }
            
            // Twilio Test Config
            console.log('\n' + '='.repeat(80));
            console.log('📞 Twilio Test Configuration:\n');
            
            const twilioTest = settings?.notificationCenter?.twilioTest;
            if (twilioTest) {
                console.log(`  Enabled: ${twilioTest.enabled ? '✅' : '❌'}`);
                console.log(`  Phone: ${twilioTest.phoneNumber || 'NOT SET'}`);
                console.log(`  Test Call Count: ${twilioTest.testCallCount || 0}`);
                console.log(`  Last Tested: ${twilioTest.lastTestedAt || 'Never'}`);
            } else {
                console.log('  ❌ No Twilio test configuration found');
            }
        }
        
        // ============================================================================
        // 4. EMAIL CLIENT CHECK
        // ============================================================================
        console.log('\n' + '='.repeat(80));
        console.log('📋 STEP 4: Testing Email Client\n');
        
        const emailClient = require('../clients/emailClient');
        const stats = emailClient.getStats();
        
        console.log('Email Client Stats:');
        console.log(`  Admin Email System: ${stats.adminEmailSystem}`);
        console.log(`  Customer Email System: ${stats.customerEmailSystem}`);
        console.log(`  Test Mode: ${stats.testMode}`);
        console.log(`  Emails Sent: ${stats.adminEmailsSent}`);
        console.log(`  Emails Failed: ${stats.adminEmailsFailed}`);
        
        // ============================================================================
        // 5. SUMMARY & RECOMMENDATIONS
        // ============================================================================
        console.log('\n' + '='.repeat(80));
        console.log('📊 SUMMARY & RECOMMENDATIONS\n');
        
        const issues = [];
        const warnings = [];
        
        if (!checks.gmail.user || !checks.gmail.password) {
            issues.push('Gmail not configured - emails won\'t send');
        }
        
        if (!checks.twilio.accountSid || !checks.twilio.authToken) {
            warnings.push('Twilio credentials not set - SMS replies may not work');
        }
        
        if (!settings) {
            issues.push('AdminSettings not initialized - add admin contact via UI');
        } else if ((settings?.notificationCenter?.adminContacts || []).length === 0) {
            issues.push('No admin contacts configured - no one will receive notifications');
        } else {
            const emailContacts = (settings?.notificationCenter?.adminContacts || [])
                .filter(c => c.receiveEmail && c.email);
            if (emailContacts.length === 0) {
                issues.push('No admin contacts have email enabled - emails won\'t be received');
            }
        }
        
        if (issues.length > 0) {
            console.log('🚨 CRITICAL ISSUES:\n');
            issues.forEach((issue, i) => {
                console.log(`  ${i + 1}. ${issue}`);
            });
            console.log('');
        }
        
        if (warnings.length > 0) {
            console.log('⚠️  WARNINGS:\n');
            warnings.forEach((warning, i) => {
                console.log(`  ${i + 1}. ${warning}`);
            });
            console.log('');
        }
        
        if (issues.length === 0 && warnings.length === 0) {
            console.log('✅ All systems operational!\n');
            console.log('📱 To test: Send "TEST" to your Twilio number');
            console.log('📧 You should receive:');
            console.log('   1. SMS reply from Twilio (if toll-free verified)');
            console.log('   2. Email to configured admin contacts');
        } else {
            console.log('\n🔧 QUICK FIX:\n');
            console.log('1. Set environment variables in Render:');
            console.log('   - GMAIL_USER=clientsvia@gmail.com');
            console.log('   - GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx');
            console.log('');
            console.log('2. Add admin contact:');
            console.log('   - Go to Notification Center → Settings');
            console.log('   - Add contact with email enabled');
            console.log('   - Select clientsvia@gmail.com from dropdown');
            console.log('');
            console.log('3. Restart Render service');
            console.log('');
            console.log('4. Test again with SMS "TEST"');
        }
        
        console.log('\n' + '='.repeat(80));
        
        process.exit(0);
        
    } catch (error) {
        console.error('❌ DIAGNOSTIC ERROR:', error);
        process.exit(1);
    }
})();

