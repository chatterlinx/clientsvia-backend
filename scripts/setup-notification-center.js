// ============================================================================
// 🔔 SETUP NOTIFICATION CENTER COMPANY
// ============================================================================
// Purpose: Create the special "Notification Center" company for admin alerts
//
// This script creates a virtual company in the database that serves as the
// notification hub for admin SMS/email alerts.
//
// Usage: node scripts/setup-notification-center.js
//
// What it does:
// 1. Creates a company with metadata.isNotificationCenter = true
// 2. Adds admin contacts with SMS/email enabled
// 3. Validates the notification system
//
// Related Files:
// - services/AdminNotificationService.js (uses this company)
// - models/v2Company.js (schema)
// ============================================================================

require('dotenv').config();
const mongoose = require('mongoose');
const v2Company = require('../models/v2Company');

async function setupNotificationCenter() {
    console.log('🔔 [SETUP] Starting Notification Center setup...');
    
    try {
        // Connect to database
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ [SETUP] Connected to MongoDB');
        
        // Check if Notification Center already exists
        const existing = await v2Company.findOne({
            'metadata.isNotificationCenter': true
        });
        
        if (existing) {
            console.log('⚠️  [SETUP] Notification Center already exists!');
            console.log(`   Company ID: ${existing._id}`);
            console.log(`   Admin Contacts: ${existing.contacts?.length || 0}`);
            
            const response = require('readline-sync').question('\nDo you want to UPDATE admin contacts? (yes/no): ');
            
            if (response.toLowerCase() !== 'yes') {
                console.log('❌ [SETUP] Setup cancelled');
                process.exit(0);
            }
            
            // Update existing
            return await updateAdminContacts(existing);
        }
        
        // Create new Notification Center
        console.log('\n📝 [SETUP] Creating new Notification Center...');
        
        const readline = require('readline-sync');
        
        console.log('\n👤 Enter admin contact details:');
        console.log('   (You can add more admins later via the database)\n');
        
        const adminName = readline.question('Admin Name: ');
        const adminPhone = readline.question('Admin Phone (E.164 format, e.g., +15551234567): ');
        const adminEmail = readline.question('Admin Email (optional): ');
        
        // Create Notification Center company
        const notificationCenter = await v2Company.create({
            companyName: '🔔 Admin Notification Center',
            businessName: 'Notification Center',
            businessPhone: '+10000000000',  // Dummy phone (not used for calls)
            email: 'notifications@clientsvia.com',
            status: 'LIVE',
            
            contacts: [{
                name: adminName,
                phoneNumber: adminPhone,
                email: adminEmail || null,
                type: 'admin-alert',
                smsNotifications: true,
                emailNotifications: Boolean(adminEmail),
                phoneCallAlerts: true,  // For CRITICAL level 4+
                addedAt: new Date()
            }],
            
            metadata: {
                isNotificationCenter: true,
                purpose: 'Platform-wide admin alerts and notifications',
                createdBy: 'setup-script',
                setupAt: new Date()
            }
        });
        
        console.log('\n✅ [SETUP] Notification Center created successfully!');
        console.log(`   Company ID: ${notificationCenter._id}`);
        console.log(`   Admin Contact: ${adminName} (${adminPhone})`);
        
        // Validate notification system
        console.log('\n🔍 [SETUP] Validating notification system...');
        
        const AdminNotificationService = require('../services/AdminNotificationService');
        const validation = await AdminNotificationService.validateNotificationSystem();
        
        if (validation.isValid) {
            console.log('✅ [SETUP] Notification system validation PASSED');
        } else {
            console.log('⚠️  [SETUP] Notification system validation WARNINGS:');
            validation.errors.forEach(err => console.log(`   - ${err}`));
        }
        
        console.log('\n🎉 [SETUP] Setup complete!');
        console.log('\nNext steps:');
        console.log('1. Configure Twilio SMS webhook: POST https://your-domain.com/api/twilio/sms');
        console.log('2. Test notification system from admin dashboard');
        console.log('3. Add more admin contacts if needed (edit company document)');
        
    } catch (error) {
        console.error('❌ [SETUP] Setup failed:', error);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('\n✅ [SETUP] Disconnected from MongoDB');
    }
}

async function updateAdminContacts(company) {
    const readline = require('readline-sync');
    
    console.log('\n📝 [SETUP] Current admin contacts:');
    company.contacts.forEach((contact, i) => {
        console.log(`   ${i + 1}. ${contact.name} - ${contact.phoneNumber} (${contact.email || 'no email'})`);
    });
    
    const addMore = readline.question('\nAdd another admin contact? (yes/no): ');
    
    if (addMore.toLowerCase() !== 'yes') {
        console.log('❌ [SETUP] No changes made');
        return;
    }
    
    const adminName = readline.question('Admin Name: ');
    const adminPhone = readline.question('Admin Phone (E.164 format): ');
    const adminEmail = readline.question('Admin Email (optional): ');
    
    company.contacts.push({
        name: adminName,
        phoneNumber: adminPhone,
        email: adminEmail || null,
        type: 'admin-alert',
        smsNotifications: true,
        emailNotifications: Boolean(adminEmail),
        phoneCallAlerts: true,
        addedAt: new Date()
    });
    
    await company.save();
    
    console.log(`\n✅ [SETUP] Admin contact added: ${adminName} (${adminPhone})`);
    console.log(`   Total admin contacts: ${company.contacts.length}`);
}

// Run setup if called directly
if (require.main === module) {
    setupNotificationCenter();
}

module.exports = { setupNotificationCenter };

