#!/usr/bin/env node
/**
 * Fix Universal Template - Set isPublished to true
 * 
 * This script updates the Universal AI Brain template to be published
 * so it appears in the "Clone From" dropdown.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');

async function fixUniversalTemplate() {
    try {
        console.log('🔧 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        // Find Universal template (by templateType or name)
        const universal = await GlobalInstantResponseTemplate.findOne({
            $or: [
                { templateType: 'universal' },
                { name: /Universal AI Brain/i }
            ]
        });

        if (!universal) {
            console.log('❌ Universal template not found!');
            console.log('   Templates in database:');
            const all = await GlobalInstantResponseTemplate.find().select('name templateType isPublished isDefaultTemplate');
            all.forEach(t => console.log(`   - ${t.name} (${t.templateType}) - Published: ${t.isPublished}, Default: ${t.isDefaultTemplate}`));
            process.exit(1);
        }

        console.log(`📋 Found Universal template:`);
        console.log(`   Name: ${universal.name}`);
        console.log(`   Type: ${universal.templateType}`);
        console.log(`   Published: ${universal.isPublished}`);
        console.log(`   Default: ${universal.isDefaultTemplate}`);
        console.log(`   Active: ${universal.isActive}`);

        if (universal.isPublished) {
            console.log('\n✅ Universal template is already published!');
        } else {
            console.log('\n🔧 Setting isPublished = true...');
            universal.isPublished = true;
            await universal.save();
            console.log('✅ Universal template is now published!');
        }

        console.log('\n📊 All templates:');
        const all = await GlobalInstantResponseTemplate.find().select('name templateType isPublished isDefaultTemplate');
        all.forEach(t => {
            console.log(`   ${t.isPublished ? '✅' : '❌'} ${t.name} (${t.templateType}) ${t.isDefaultTemplate ? '⭐ DEFAULT' : ''}`);
        });

        await mongoose.connection.close();
        console.log('\n✅ Done!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

fixUniversalTemplate();

