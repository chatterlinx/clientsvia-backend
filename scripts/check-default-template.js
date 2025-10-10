#!/usr/bin/env node

/**
 * CHECK DEFAULT TEMPLATE
 * Verifies which Global AI Brain template is set as default for new companies
 */

require('dotenv').config();
const mongoose = require('mongoose');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');

async function checkDefaultTemplate() {
    try {
        console.log('\n🔍 CHECKING DEFAULT TEMPLATE IN DATABASE...\n');

        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        // Find all templates
        const allTemplates = await GlobalInstantResponseTemplate.find({})
            .select('name version templateType industryLabel isDefaultTemplate isPublished isActive')
            .sort({ createdAt: 1 });

        console.log('📚 ALL TEMPLATES:');
        console.log('─'.repeat(80));
        allTemplates.forEach((template, index) => {
            const defaultBadge = template.isDefaultTemplate ? '⭐ DEFAULT' : '';
            const publishedBadge = template.isPublished ? '📢 Published' : '📝 Draft';
            const activeBadge = template.isActive ? '✅ Active' : '❌ Inactive';
            
            console.log(`\n${index + 1}. ${template.name} (${template.version})`);
            console.log(`   ID: ${template._id}`);
            console.log(`   Industry: ${template.industryLabel || template.templateType || 'Universal'}`);
            console.log(`   Status: ${defaultBadge} ${publishedBadge} ${activeBadge}`);
        });

        console.log('\n' + '─'.repeat(80));

        // Find the default template
        const defaultTemplate = await GlobalInstantResponseTemplate.findOne({ 
            isDefaultTemplate: true 
        });

        if (defaultTemplate) {
            console.log('\n✅ DEFAULT TEMPLATE FOUND:');
            console.log(`   Name: ${defaultTemplate.name}`);
            console.log(`   Version: ${defaultTemplate.version}`);
            console.log(`   Industry: ${defaultTemplate.industryLabel || defaultTemplate.templateType}`);
            console.log(`   Categories: ${defaultTemplate.categories?.length || 0}`);
            console.log(`   Published: ${defaultTemplate.isPublished ? 'Yes ✅' : 'No ❌'}`);
            console.log(`\n   📌 This template will be cloned for ALL new companies!\n`);
        } else {
            console.log('\n⚠️  WARNING: NO DEFAULT TEMPLATE SET!');
            console.log('   New companies will start with ZERO scenarios.\n');
        }

        await mongoose.connection.close();
        console.log('✅ Connection closed\n');
        process.exit(0);

    } catch (error) {
        console.error('❌ ERROR:', error.message);
        process.exit(1);
    }
}

checkDefaultTemplate();

