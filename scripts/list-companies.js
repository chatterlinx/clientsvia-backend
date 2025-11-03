/**
 * ============================================================================
 * LIST ALL COMPANIES
 * ============================================================================
 * 
 * PURPOSE: Show all companies in database to help choose which one to assign to user
 * 
 * ============================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/v2Company');
const logger = require('../utils/logger');

async function listCompanies() {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI);
        logger.info('✅ Connected to MongoDB\n');
        
        // Get all companies
        const companies = await Company.find({}).select('_id companyName businessName status accountStatus.status createdAt').lean();
        
        if (companies.length === 0) {
            logger.error('❌ No companies found in database!');
            logger.info('💡 You need to create a company first');
            process.exit(1);
        }
        
        logger.info(`📋 Found ${companies.length} companies:\n`);
        
        companies.forEach((company, index) => {
            const name = company.companyName || company.businessName || 'Unnamed';
            const status = company.accountStatus?.status || company.status || 'unknown';
            const created = company.createdAt ? new Date(company.createdAt).toLocaleDateString() : 'unknown';
            
            console.log(`${index + 1}. ${name}`);
            console.log(`   ID: ${company._id}`);
            console.log(`   Status: ${status}`);
            console.log(`   Created: ${created}`);
            console.log('');
        });
        
        logger.info('💡 To fix user association, copy one of these company IDs');
        logger.info('💡 Then edit scripts/fix-user-company-association.js and set the company ID\n');
        
        process.exit(0);
        
    } catch (error) {
        logger.error('❌ Error listing companies:', error);
        process.exit(1);
    }
}

listCompanies();
