#!/usr/bin/env node

/**
 * 🌱 SEED V2 GLOBAL TRADE CATEGORIES
 * 
 * This script creates the initial trade categories for the V2 system
 * to match what was shown in the frontend (Dental Office, Electrical, HVAC Residential, Plumbing Residential)
 */

require('dotenv').config();
const mongoose = require('mongoose');
const TradeCategory = require('../models/TradeCategory');
const { redisClient } = require('../clients');

const categories = [
    {
        name: 'Dental Office',
        description: 'dental office',
        qnas: [
            {
                id: new mongoose.Types.ObjectId().toString(),
                _id: new mongoose.Types.ObjectId(),
                question: 'What are your office hours?',
                answer: 'Our office hours are Monday through Friday, 8:00 AM to 5:00 PM. We are closed on weekends and major holidays.',
                keywords: ['hours', 'office', 'schedule', 'open', 'closed'],
                confidence: 0.9,
                isActive: true,
                status: 'active',
                createdAt: new Date(),
                updatedAt: new Date()
            },
            {
                id: new mongoose.Types.ObjectId().toString(),
                _id: new mongoose.Types.ObjectId(),
                question: 'Do you accept insurance?',
                answer: 'Yes, we accept most major dental insurance plans. Please call our office to verify if we accept your specific insurance plan.',
                keywords: ['insurance', 'coverage', 'dental', 'plan', 'accept'],
                confidence: 0.9,
                isActive: true,
                status: 'active',
                createdAt: new Date(),
                updatedAt: new Date()
            }
        ]
    },
    {
        name: 'Electrical',
        description: 'electrical residential',
        qnas: [
            {
                id: new mongoose.Types.ObjectId().toString(),
                _id: new mongoose.Types.ObjectId(),
                question: 'Do you provide emergency electrical services?',
                answer: 'Yes, we offer 24/7 emergency electrical services. Call us anytime for urgent electrical issues like power outages, sparking outlets, or electrical fires.',
                keywords: ['emergency', 'electrical', '24/7', 'urgent', 'power', 'outage'],
                confidence: 0.9,
                isActive: true,
                status: 'active',
                createdAt: new Date(),
                updatedAt: new Date()
            },
            {
                id: new mongoose.Types.ObjectId().toString(),
                _id: new mongoose.Types.ObjectId(),
                question: 'What electrical services do you offer?',
                answer: 'We provide comprehensive electrical services including wiring, panel upgrades, outlet installation, lighting installation, electrical repairs, and electrical inspections.',
                keywords: ['electrical', 'services', 'wiring', 'panel', 'outlet', 'lighting', 'repair'],
                confidence: 0.9,
                isActive: true,
                status: 'active',
                createdAt: new Date(),
                updatedAt: new Date()
            }
        ]
    },
    {
        name: 'HVAC Residential',
        description: 'residential air conditioning service company',
        qnas: [
            {
                id: new mongoose.Types.ObjectId().toString(),
                _id: new mongoose.Types.ObjectId(),
                question: 'Do you provide air conditioning repair services?',
                answer: 'Yes, we provide comprehensive air conditioning repair services for all major brands. Our certified technicians can diagnose and fix any AC issue quickly and efficiently.',
                keywords: ['air conditioning', 'ac', 'repair', 'hvac', 'cooling', 'technician'],
                confidence: 0.9,
                isActive: true,
                status: 'active',
                createdAt: new Date(),
                updatedAt: new Date()
            },
            {
                id: new mongoose.Types.ObjectId().toString(),
                _id: new mongoose.Types.ObjectId(),
                question: 'Do you install new HVAC systems?',
                answer: 'Absolutely! We install high-efficiency HVAC systems from top manufacturers. We provide free estimates and can help you choose the right system for your home.',
                keywords: ['hvac', 'install', 'installation', 'system', 'new', 'efficiency'],
                confidence: 0.9,
                isActive: true,
                status: 'active',
                createdAt: new Date(),
                updatedAt: new Date()
            }
        ]
    },
    {
        name: 'Plumbing Residential',
        description: 'plumbing residential services',
        qnas: [
            {
                id: new mongoose.Types.ObjectId().toString(),
                _id: new mongoose.Types.ObjectId(),
                question: 'Do you fix leaky pipes and faucets?',
                answer: 'Yes, we repair all types of leaks including pipes, faucets, toilets, and water heaters. We provide fast, reliable plumbing repair services with upfront pricing.',
                keywords: ['plumbing', 'leak', 'pipe', 'faucet', 'repair', 'water'],
                confidence: 0.9,
                isActive: true,
                status: 'active',
                createdAt: new Date(),
                updatedAt: new Date()
            },
            {
                id: new mongoose.Types.ObjectId().toString(),
                _id: new mongoose.Types.ObjectId(),
                question: 'Do you provide emergency plumbing services?',
                answer: 'Yes, we offer 24/7 emergency plumbing services for burst pipes, major leaks, clogged drains, and other urgent plumbing issues.',
                keywords: ['emergency', 'plumbing', '24/7', 'burst', 'pipe', 'leak', 'drain'],
                confidence: 0.9,
                isActive: true,
                status: 'active',
                createdAt: new Date(),
                updatedAt: new Date()
            }
        ]
    }
];

async function seedV2TradeCategories() {
    try {
        console.log('🌱 SEEDING V2 GLOBAL TRADE CATEGORIES');
        console.log('=' .repeat(50));

        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/clientsvia');
        console.log('✅ Connected to MongoDB');

        // Check if categories already exist
        const existingCount = await TradeCategory.countDocuments({ companyId: 'global' });
        console.log(`📊 Found ${existingCount} existing V2 categories`);

        if (existingCount > 0) {
            console.log('⚠️  Categories already exist. Skipping seed to avoid duplicates.');
            console.log('💡 To reseed, first delete existing categories or use --force flag');
            return;
        }

        // Create categories
        console.log('\n🏗️  Creating V2 trade categories...');
        let createdCount = 0;

        for (const categoryData of categories) {
            // Calculate metadata
            const totalQAs = categoryData.qnas.length;
            const totalKeywords = categoryData.qnas.reduce((total, qna) => total + qna.keywords.length, 0);

            const category = new TradeCategory({
                name: categoryData.name,
                description: categoryData.description,
                companyId: 'global',
                qnas: categoryData.qnas,
                isActive: true,
                
                // Metadata
                metadata: {
                    totalQAs,
                    totalKeywords,
                    lastUpdated: new Date(),
                    version: '2.0.0'
                },
                
                // Audit trail
                audit: {
                    createdAt: new Date(),
                    createdBy: 'seed-script',
                    updatedAt: new Date(),
                    updatedBy: 'seed-script'
                }
            });

            await category.save();
            console.log(`   ✅ Created: ${category.name} (${totalQAs} Q&As, ${totalKeywords} keywords)`);
            createdCount++;
        }

        // Clear Redis cache
        console.log('\n🗑️  Clearing Redis cache...');
        try {
            const cacheKeys = await redisClient.keys('v2-global-trade-categories:*');
            if (cacheKeys.length > 0) {
                await redisClient.del(...cacheKeys);
                console.log(`✅ Cleared ${cacheKeys.length} cache keys`);
            } else {
                console.log('📋 No cache keys to clear');
            }
        } catch (cacheError) {
            console.warn('⚠️  Cache clear failed:', cacheError.message);
        }

        console.log('\n' + '=' .repeat(50));
        console.log('🎉 V2 TRADE CATEGORIES SEEDED SUCCESSFULLY!');
        console.log(`📊 Created ${createdCount} categories`);
        console.log('🔍 You can now test the V2 Global Trade Categories system');
        console.log('🌐 Visit: /v2global-trade-categories.html');

    } catch (error) {
        console.error('❌ Seeding failed:', error);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        if (redisClient) {
            redisClient.disconnect();
        }
        console.log('🔌 Disconnected from databases');
    }
}

// Run seeding
if (require.main === module) {
    seedV2TradeCategories();
}

module.exports = { seedV2TradeCategories };
