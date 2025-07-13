// scripts/examples/dailyFollowUpScript.js
// Example script for daily follow-up automation
// This script runs as part of scheduled workflows

const mongoose = require('mongoose');
require('dotenv').config();

const Contact = require('../../models/Contact');
const Company = require('../../models/Company');
const { WorkflowService } = require('../../services/workflowService');

async function runDailyFollowUp() {
    try {
        console.log('🌅 Starting daily follow-up script...');
        
        // Get workflow context from environment
        const context = JSON.parse(process.env.WORKFLOW_CONTEXT || '{}');
        const parameters = JSON.parse(process.env.SCRIPT_PARAMETERS || '{}');
        
        await mongoose.connect(process.env.MONGODB_URI);
        
        const companies = await Company.find({ isActive: true });
        
        for (const company of companies) {
            console.log(`📞 Processing follow-ups for: ${company.companyName}`);
            
            // Find contacts that need follow-up (haven't been contacted in 2+ days)
            const contactsNeedingFollowUp = await Contact.find({
                companyId: company._id,
                status: { $in: ['new_lead', 'qualified_lead'] },
                lastContactDate: { 
                    $lt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) // 2 days ago
                },
                tags: { $nin: ['do_not_contact', 'unsubscribed'] }
            }).limit(parameters.maxContactsPerCompany || 10);
            
            console.log(`Found ${contactsNeedingFollowUp.length} contacts needing follow-up`);
            
            for (const contact of contactsNeedingFollowUp) {
                // Trigger follow-up workflow
                await WorkflowService.triggerWorkflowByEvent('daily_follow_up', {
                    contact: contact.toObject(),
                    company: company.toObject(),
                    scriptGenerated: true,
                    daysSinceLastContact: Math.floor((Date.now() - contact.lastContactDate) / (24 * 60 * 60 * 1000))
                }, company._id);
                
                console.log(`✅ Triggered follow-up for: ${contact.displayName}`);
            }
        }
        
        console.log('✅ Daily follow-up script completed successfully');
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Daily follow-up script error:', error);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    runDailyFollowUp();
}

module.exports = { runDailyFollowUp };
