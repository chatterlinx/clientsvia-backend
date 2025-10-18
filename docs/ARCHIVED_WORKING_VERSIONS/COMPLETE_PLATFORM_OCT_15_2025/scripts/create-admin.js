#!/usr/bin/env node

/**
 * Create Admin User Script
 * Creates an admin user for the ClientsVia Backend system
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/v2User');
require('dotenv').config();

async function createAdminUser() {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/clientsvia');
        console.log('✅ Connected to MongoDB');

        // Check if admin user already exists
        const existingAdmin = await User.findOne({ email: 'admin@clientsvia.com' });
        if (existingAdmin) {
            console.log('⚠️  Admin user already exists with email: admin@clientsvia.com');
            console.log('   Role:', existingAdmin.role);
            console.log('   Status:', existingAdmin.status);
            
            // Auto-reset password without prompting
            console.log('🔄 Auto-resetting password...');
            const hashedPassword = await bcrypt.hash('admin123', 10);
            existingAdmin.password = hashedPassword;
            existingAdmin.status = 'active';
            await existingAdmin.save();
            console.log('✅ Admin password reset successfully!');
            console.log('');
            console.log('📝 Login Credentials:');
            console.log('   Email: admin@clientsvia.com');
            console.log('   Password: admin123');
            console.log('   Role: admin');
            
            await mongoose.disconnect();
            return;
        }

        // Create new admin user
        const hashedPassword = await bcrypt.hash('admin123', 10);
        
        const adminUser = new User({
            email: 'admin@clientsvia.com',
            password: hashedPassword,
            name: 'System Administrator',
            role: 'admin',
            status: 'active',
            createdAt: new Date(),
            lastLogin: null
        });

        await adminUser.save();
        
        console.log('🎉 Admin user created successfully!');
        console.log('');
        console.log('📝 Login Credentials:');
        console.log('   Email: admin@clientsvia.com');
        console.log('   Password: admin123');
        console.log('   Role: admin');
        console.log('');
        console.log('🔗 You can now login at: http://localhost:3000/login.html');
        console.log('');
        console.log('⚠️  IMPORTANT: Change the default password after first login!');

    } catch (error) {
        console.error('❌ Error creating admin user:', error.message);
        console.error('   Stack:', error.stack);
    } finally {
        await mongoose.disconnect();
        console.log('✅ Disconnected from MongoDB');
    }
}

// Handle command line execution
if (require.main === module) {
    createAdminUser()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error('Fatal error:', error);
            process.exit(1);
        });
}

module.exports = createAdminUser;
