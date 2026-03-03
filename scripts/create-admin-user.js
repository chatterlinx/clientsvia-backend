#!/usr/bin/env node
/**
 * CREATE ADMIN USER
 * 
 * Usage on Render SSH:
 * node scripts/create-admin-user.js <email> <password>
 * 
 * Example:
 * node scripts/create-admin-user.js admin@clientsvia.com YourPassword123
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

async function createAdminUser(email, password) {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  
  if (!mongoUri) {
    console.error('❌ No MongoDB URI found');
    process.exit(1);
  }

  try {
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB:', mongoose.connection.name);
    console.log('');

    // Use the v2User model (check your actual user model)
    const User = require('../models/v2User');
    
    // Check if user already exists
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      console.log(`⚠️  User already exists: ${email}`);
      console.log('   Role:', existing.role);
      console.log('   Active:', existing.isActive);
      console.log('');
      console.log('To reset password, delete this user first or use a different email');
      process.exit(0);
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create admin user
    const user = new User({
      email: email.toLowerCase(),
      password: hashedPassword,
      role: 'admin',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await user.save();

    console.log('✅ Admin user created successfully!');
    console.log('');
    console.log('   Email:', email);
    console.log('   Role:  admin');
    console.log('   Active: true');
    console.log('');
    console.log('You can now log in at: https://cv-backend-va.onrender.com/login.html');
    console.log('');

    await mongoose.connection.close();
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.code === 11000) {
      console.error('   Duplicate key error - user might already exist');
    }
    process.exit(1);
  }
}

const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
  console.error('Usage: node scripts/create-admin-user.js <email> <password>');
  console.error('Example: node scripts/create-admin-user.js admin@clientsvia.com YourPassword123');
  process.exit(1);
}

createAdminUser(email, password);
