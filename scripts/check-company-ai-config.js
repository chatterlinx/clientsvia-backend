#!/usr/bin/env node

/**
 * Check and Fix Company AI Agent Logic Configuration
 * 
 * This script checks if a company has proper AI Agent Logic configuration
 * and can optionally fix missing configurations to prevent hardcoded fallbacks.
 * 
 * Usage:
 *   node scripts/check-company-ai-config.js <companyId> [--fix]
 * 
 * Example:
 *   node scripts/check-company-ai-config.js 68813026dd95f599c74e49c7 --fix
 */

require('dotenv').config(); // Must be first
const mongoose = require('mongoose');
const Company = require('../models/Company');
const { connectDB } = require('../db');

const REQUIRED_RESPONSE_CATEGORIES = [
    'greeting-response',
    'no-match-response', 
    'transfer-unavailable-response',
    'final-fallback-response',
    'conversation-fallback-response',
    'technical-difficulty-response',
    'no-input-fallback-response',
    'ai-not-enabled-response'
];

async function checkCompanyConfig(companyId, shouldFix = false) {
    try {
        console.log(`🔍 Checking AI Agent Logic configuration for company: ${companyId}`);
        
        // Connect to MongoDB using existing connection logic
        await connectDB();
        console.log('✅ Connected to MongoDB');
        
        // Find the company
        const company = await Company.findById(companyId);
        if (!company) {
            console.error(`❌ Company not found: ${companyId}`);
            return false;
        }
        
        console.log(`📋 Company: ${company.businessName || company.companyName} (ID: ${companyId})`);
        
        // Check AI Agent Logic configuration
        const aiLogic = company.aiAgentLogic || {};
        console.log(`🤖 AI Agent Logic enabled: ${aiLogic.enabled !== false ? 'YES' : 'NO'}`);
        
        // Check thresholds
        const thresholds = aiLogic.thresholds || {};
        console.log(`📊 Thresholds configured:`, {
            companyQnA: thresholds.companyQnA || 'MISSING',
            tradeQnA: thresholds.tradeQnA || 'MISSING', 
            templates: thresholds.templates || 'MISSING',
            inHouseFallback: thresholds.inHouseFallback || 'MISSING'
        });
        
        // Check response categories
        const responseCategories = aiLogic.responseCategories?.core || {};
        console.log(`💬 Response Categories Status:`);
        
        const missingResponses = [];
        REQUIRED_RESPONSE_CATEGORIES.forEach(category => {
            const exists = responseCategories[category];
            console.log(`  ${category}: ${exists ? '✅ CONFIGURED' : '❌ MISSING'}`);
            if (!exists) {
                missingResponses.push(category);
            }
        });
        
        // Check knowledge source priorities
        const priorities = aiLogic.knowledgeSourcePriorities || [];
        console.log(`🎯 Knowledge Source Priorities: ${priorities.length > 0 ? priorities.join(' → ') : '❌ MISSING'}`);
        
        // Summary
        const hasThresholds = Object.keys(thresholds).length > 0;
        const hasResponses = missingResponses.length === 0;
        const hasPriorities = priorities.length > 0;
        
        console.log(`\n📋 CONFIGURATION SUMMARY:`);
        console.log(`  Thresholds: ${hasThresholds ? '✅' : '❌'}`);
        console.log(`  Response Categories: ${hasResponses ? '✅' : '❌'} (${missingResponses.length} missing)`);
        console.log(`  Knowledge Priorities: ${hasPriorities ? '✅' : '❌'}`);
        
        const isFullyConfigured = hasThresholds && hasResponses && hasPriorities;
        console.log(`  Overall Status: ${isFullyConfigured ? '✅ FULLY CONFIGURED' : '❌ NEEDS CONFIGURATION'}`);
        
        // Fix if requested and needed
        if (shouldFix && !isFullyConfigured) {
            console.log(`\n🔧 FIXING MISSING CONFIGURATION...`);
            
            const updates = {};
            
            // Fix thresholds if missing
            if (!hasThresholds) {
                updates['aiAgentLogic.thresholds'] = {
                    companyQnA: 0.8,
                    tradeQnA: 0.75,
                    templates: 0.7,
                    inHouseFallback: 0.5
                };
                console.log(`  ✅ Added default thresholds`);
            }
            
            // Fix missing response categories
            if (missingResponses.length > 0) {
                const coreResponses = responseCategories;
                
                missingResponses.forEach(category => {
                    const companyName = company.businessName || company.companyName || 'our company';
                    
                    switch(category) {
                        case 'greeting-response':
                            coreResponses[category] = `Hello! Thank you for calling ${companyName}. How can I help you today?`;
                            break;
                        case 'no-match-response':
                            coreResponses[category] = `I want to make sure I give you accurate information. Let me connect you with one of our specialists who can help.`;
                            break;
                        case 'transfer-unavailable-response':
                            coreResponses[category] = `I apologize, but I'm unable to transfer your call right now. Please try calling back later or visit our website for assistance.`;
                            break;
                        case 'final-fallback-response':
                            coreResponses[category] = `Thank you for calling ${companyName}. Please visit our website or call back later for assistance.`;
                            break;
                        case 'conversation-fallback-response':
                            coreResponses[category] = `I want to make sure I provide you with accurate information. Let me connect you with a specialist.`;
                            break;
                        case 'technical-difficulty-response':
                            coreResponses[category] = `I'm experiencing some technical difficulties. Please try calling back in a few minutes or visit our website.`;
                            break;
                        case 'no-input-fallback-response':
                            coreResponses[category] = `I didn't hear anything. If you need assistance, please speak clearly or try calling back.`;
                            break;
                        case 'ai-not-enabled-response':
                            coreResponses[category] = `Thank you for calling ${companyName}. Please visit our website or call back later for assistance.`;
                            break;
                    }
                });
                
                updates['aiAgentLogic.responseCategories.core'] = coreResponses;
                console.log(`  ✅ Added ${missingResponses.length} missing response categories`);
            }
            
            // Fix knowledge source priorities if missing
            if (!hasPriorities) {
                updates['aiAgentLogic.knowledgeSourcePriorities'] = [
                    'companyQnA',
                    'tradeQnA', 
                    'templates',
                    'inHouseFallback'
                ];
                console.log(`  ✅ Added default knowledge source priorities`);
            }
            
            // Enable AI Agent Logic
            updates['aiAgentLogic.enabled'] = true;
            updates['aiAgentLogic.lastUpdated'] = new Date();
            
            // Apply updates
            await Company.findByIdAndUpdate(companyId, { $set: updates });
            console.log(`\n✅ CONFIGURATION FIXED! Company ${companyId} now has proper AI Agent Logic setup.`);
            console.log(`🚨 IMPORTANT: Admin should review and customize these default responses in the platform.`);
            
        } else if (shouldFix && isFullyConfigured) {
            console.log(`\n✅ No fixes needed - company is already fully configured!`);
        }
        
        return isFullyConfigured;
        
    } catch (error) {
        console.error('❌ Error checking company configuration:', error);
        return false;
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Disconnected from MongoDB');
    }
}

// Main execution
async function main() {
    const args = process.argv.slice(2);
    const companyId = args[0];
    const shouldFix = args.includes('--fix');
    
    if (!companyId) {
        console.error('❌ Usage: node scripts/check-company-ai-config.js <companyId> [--fix]');
        console.error('❌ Example: node scripts/check-company-ai-config.js 68813026dd95f599c74e49c7 --fix');
        process.exit(1);
    }
    
    console.log(`🚀 ClientsVia AI Agent Logic Configuration Checker`);
    console.log(`📋 Company ID: ${companyId}`);
    console.log(`🔧 Fix Mode: ${shouldFix ? 'ENABLED' : 'DISABLED'}`);
    console.log(`─────────────────────────────────────────────────\n`);
    
    const success = await checkCompanyConfig(companyId, shouldFix);
    
    console.log(`\n─────────────────────────────────────────────────`);
    console.log(`🎯 RESULT: ${success ? 'SUCCESS' : 'NEEDS ATTENTION'}`);
    
    if (!success && !shouldFix) {
        console.log(`💡 TIP: Run with --fix flag to automatically configure missing settings`);
        console.log(`💡 COMMAND: node scripts/check-company-ai-config.js ${companyId} --fix`);
    }
    
    process.exit(success ? 0 : 1);
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { checkCompanyConfig };
