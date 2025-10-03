/**
 * Change Admin Password
 */

require('dotenv').config();
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const User = require('./models/v2User');

async function changePassword() {
    try {
        console.log('🔧 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        const email = 'admin@clientsvia.com';
        // Generate a unique, secure password
        const newPassword = `ClientsVia2025!${Math.random().toString(36).substring(7)}`;

        console.log(`🔐 Changing password for: ${email}`);
        
        const user = await User.findOne({ email });
        
        if (!user) {
            console.log('❌ User not found!');
            process.exit(1);
        }

        // Hash the new password
        const saltRounds = 12;
        const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
        user.password = hashedPassword;
        await user.save();

        console.log('\n✅ Password changed successfully!\n');
        console.log('📝 NEW LOGIN CREDENTIALS:');
        console.log(`   Email: ${email}`);
        console.log(`   Password: ${newPassword}`);
        console.log('\n⚠️  SAVE THIS PASSWORD - It won\'t be shown again!\n');
        console.log('🌐 Login URL: https://clientsvia-backend.onrender.com/login.html');

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await mongoose.connection.close();
        process.exit(0);
    }
}

changePassword();

