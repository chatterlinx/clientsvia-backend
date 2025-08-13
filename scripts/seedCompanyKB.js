/**
 * Seed Company Knowledge Base with sample Q&A entries
 * Run: node scripts/seedCompanyKB.js
 */

const mongoose = require('mongoose');
const Company = require('../models/Company');

async function connectDB() {
    try {
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/myapp');
        console.log('✅ Connected to MongoDB');
    } catch (error) {
        console.error('❌ MongoDB connection error:', error);
        process.exit(1);
    }
}

async function seedCompanyKB() {
    const companyId = '66fbb89ca9b5fb8df6c62e95'; // Default company ID
    
    const sampleQAs = [
        {
            id: 'pricing-service-call',
            question: 'What is your service call fee?',
            answer: 'Our service call is $49. If you\'re on our maintenance plan, the service call is free with any repair of $49 or more.',
            category: 'pricing',
            priority: 'high',
            isActive: true,
            confidenceBoost: 0.95,
            createdBy: 'admin'
        },
        {
            id: 'pricing-maintenance-plan',
            question: 'How much is your maintenance plan?',
            answer: 'Our maintenance plan is $179 for two visits per year. The service call is free with any repair of $49 or more.',
            category: 'pricing',
            priority: 'high',
            isActive: true,
            confidenceBoost: 0.95,
            createdBy: 'admin'
        },
        {
            id: 'service-filters-policy',
            question: 'Do you provide filters during service?',
            answer: 'We don\'t supply filters by default. If you provide them, the technician will install them during maintenance. We can also order and bring filters at the time of service for an additional charge. Would you like a callback with a quote, or will you provide the filters?',
            category: 'service',
            priority: 'normal',
            isActive: true,
            confidenceBoost: 0.90,
            createdBy: 'admin'
        },
        {
            id: 'hours-business',
            question: 'What are your business hours?',
            answer: 'We\'re open Monday through Friday from 8 AM to 6 PM, and Saturday from 9 AM to 4 PM. We offer emergency service 24/7 for urgent repairs.',
            category: 'hours',
            priority: 'normal',
            isActive: true,
            confidenceBoost: 0.92,
            createdBy: 'admin'
        },
        {
            id: 'service-area-coverage',
            question: 'What areas do you service?',
            answer: 'We service all of Orange County and parts of Los Angeles County. Our primary service area includes Irvine, Newport Beach, Costa Mesa, Huntington Beach, and surrounding communities.',
            category: 'service',
            priority: 'normal',
            isActive: true,
            confidenceBoost: 0.88,
            createdBy: 'admin'
        }
    ];

    try {
        const company = await Company.findById(companyId);
        if (!company) {
            console.error('❌ Company not found with ID:', companyId);
            return;
        }

        // Initialize companyKB and companyKBSettings if not exist
        if (!company.companyKB) {
            company.companyKB = [];
        }
        if (!company.companyKBSettings) {
            company.companyKBSettings = {
                enabled: true,
                autoPublish: false,
                requireApproval: true,
                maxQuestions: 100,
                confidenceThreshold: 0.80,
                fuzzyMatchEnabled: true,
                fuzzyMatchThreshold: 0.85
            };
        }

        // Add sample Q&As (avoid duplicates)
        for (const qa of sampleQAs) {
            const existing = company.companyKB.find(existingQA => existingQA.id === qa.id);
            if (!existing) {
                company.companyKB.push(qa);
                console.log(`✅ Added Q&A: ${qa.question}`);
            } else {
                console.log(`⚠️ Q&A already exists: ${qa.question}`);
            }
        }

        await company.save();
        console.log('🎉 Company KB seeded successfully!');
        console.log(`📊 Total Q&As: ${company.companyKB.length}`);

    } catch (error) {
        console.error('❌ Error seeding Company KB:', error);
    }
}

async function main() {
    await connectDB();
    await seedCompanyKB();
    await mongoose.disconnect();
    console.log('✅ Seeding complete');
}

if (require.main === module) {
    main();
}

module.exports = { seedCompanyKB };
