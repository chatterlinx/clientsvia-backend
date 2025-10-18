/**
 * Change Admin Password
 */

require('dotenv').config();
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const User = require('./models/v2User');
const logger = require('./utils/logger');

async function changePassword() {
    try {
        logger.info('🔧 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        logger.info('✅ Connected to MongoDB\n');

        const email = 'admin@clientsvia.com';
        // Generate a unique, secure password
        const newPassword = `ClientsVia2025!${Math.random().toString(36).substring(7)}`;

        logger.info(`🔐 Changing password for: ${email}`);

        const user = await User.findOne({ email });

        if (!user) {
            logger.error('❌ User not found!');
            process.exit(1);
        }

        // Hash the new password
        const saltRounds = 12;
        const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
        user.password = hashedPassword;
        await user.save();

        logger.info('\n✅ Password changed successfully!\n');
        logger.info('📝 NEW LOGIN CREDENTIALS:');
        logger.info(`   Email: ${email}`);
        logger.info(`   Password: ${newPassword}`);
        logger.info('\n⚠️  SAVE THIS PASSWORD - It won\'t be shown again!\n');
        logger.info('🌐 Login URL: https://clientsvia-backend.onrender.com/login.html');

    } catch (error) {
        logger.error('❌ Error changing password', { error: error.message });
    } finally {
        await mongoose.connection.close();
        process.exit(0);
    }
}

changePassword();

