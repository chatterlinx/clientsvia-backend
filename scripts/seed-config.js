#!/usr/bin/env node

/**
 * Quick script to seed minimal valid AI Agent Logic config
 * Resolves router_config_missing by setting required fields
 */

const mongoose = require('mongoose');
const Company = require('../models/Company');

async function seedConfig() {
    try {
        // Connect to MongoDB using same connection string as app
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://chatter:VDQn4W5pfqOxXqmx@clientsvia.vbhqcga.mongodb.net/clientsvia?retryWrites=true&w=majority');
        console.log('📦 Connected to MongoDB');

        const companyId = '68813026dd95f599c74e49c7'; // Atlas Air from logs
        
        console.log(`🔍 Finding company: ${companyId}`);
        const company = await Company.findById(companyId);
        
        if (!company) {
            console.error(`❌ Company not found: ${companyId}`);
            process.exit(1);
        }
        
        console.log(`✅ Found company: ${company.companyName || company.name || 'Unnamed'}`);

        // Initialize AI Agent Logic config if it doesn't exist
        if (!company.aiAgentLogic) {
            company.aiAgentLogic = {};
        }

        // Set the minimal required config that the validator expects
        const newConfig = {
            routing: {
                priority: ["template", "company_kb", "trade_kb", "vector", "llm"]
            },
            knowledge: {
                sources: {
                    company_kb: true,
                    trade_kb: true, 
                    vector: true
                },
                thresholds: {
                    company_kb: 0.60,
                    trade_kb: 0.62,
                    vector: 0.64
                }
            },
            enterprise: {
                composite: {
                    threshold: 0.62
                }
            },
            fallback: {
                message: "Thanks for calling Atlas Air. I'm having trouble right now - please text our booking link or visit atlas-air.example/booking for immediate assistance."
            },
            // Add metadata
            version: (company.aiAgentLogic.version || 0) + 1,
            lastUpdated: new Date(),
            seedStatus: 'seeded-for-router-fix'
        };

        // Merge with existing config
        company.aiAgentLogic = { ...company.aiAgentLogic, ...newConfig };

        console.log('💾 Saving config...');
        await company.save();

        console.log('✅ Config seeded successfully!');
        console.log('📊 Config summary:', {
            version: company.aiAgentLogic.version,
            routing_priority_count: company.aiAgentLogic.routing.priority.length,
            knowledge_sources_count: Object.keys(company.aiAgentLogic.knowledge.sources).length,
            has_enterprise_threshold: !!company.aiAgentLogic.enterprise.composite.threshold
        });

        // Verify the saved config
        const verifyCompany = await Company.findById(companyId);
        const config = verifyCompany.aiAgentLogic;
        
        console.log('🔍 Verification:');
        console.log('  routing.priority:', Array.isArray(config.routing?.priority) ? '✅ Array' : '❌ Not array');
        console.log('  knowledge.sources:', config.knowledge?.sources ? '✅ Present' : '❌ Missing');
        console.log('  knowledge.thresholds:', config.knowledge?.thresholds ? '✅ Present' : '❌ Missing');
        console.log('  enterprise.composite.threshold:', typeof config.enterprise?.composite?.threshold === 'number' ? '✅ Number' : '❌ Not number');

        console.log('\n🎯 Next call should show: config.load {validation: ok} instead of router_config_missing');
        
    } catch (error) {
        console.error('❌ Error seeding config:', error);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('📦 Disconnected from MongoDB');
    }
}

// Run the script
seedConfig();
