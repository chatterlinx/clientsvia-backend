/**
 * Test Login Diagnostic Script
 */

require('dotenv').config();
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const User = require('./models/v2User');

async function testLogin() {
    try {
        console.log('🔧 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        const testEmail = 'admin@clientsvia.com';
        const testPassword = 'admin123';

        console.log(`🔍 Testing login for: ${testEmail}`);
        console.log(`🔑 Password: ${testPassword}\n`);

        // Find user
        const user = await User.findOne({ email: testEmail });
        
        if (!user) {
            console.log('❌ User NOT FOUND in database!');
            console.log('\n📋 All users in database:');
            const allUsers = await User.find({}, 'email role status');
            allUsers.forEach(u => {
                console.log(`   - ${u.email} | ${u.role} | ${u.status}`);
            });
            process.exit(1);
        }

        console.log('✅ User found in database:');
        console.log(`   Email: ${user.email}`);
        console.log(`   Role: ${user.role}`);
        console.log(`   Status: ${user.status}`);
        console.log(`   Company ID: ${user.companyId || 'None'}`);
        console.log(`   Password Hash: ${user.password.substring(0, 20)}...\n`);

        // Test password
        console.log('🔐 Testing password comparison...');
        const isMatch = await bcrypt.compare(testPassword, user.password);
        
        if (isMatch) {
            console.log('✅ PASSWORD MATCHES! Login should work.\n');
            console.log('📝 Use these credentials:');
            console.log(`   Email: ${testEmail}`);
            console.log(`   Password: ${testPassword}`);
            console.log('\n🌐 Login URL: https://clientsvia-backend.onrender.com/login.html');
        } else {
            console.log('❌ PASSWORD DOES NOT MATCH!');
            console.log('\n🔧 Resetting password...');
            
            const saltRounds = 12;
            const hashedPassword = await bcrypt.hash(testPassword, saltRounds);
            user.password = hashedPassword;
            await user.save();
            
            console.log('✅ Password reset successfully!');
            console.log(`   New password: ${testPassword}`);
        }

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await mongoose.connection.close();
        console.log('\n✅ MongoDB connection closed');
        process.exit(0);
    }
}

testLogin();

