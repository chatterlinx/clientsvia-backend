// scripts/examples/weeklyAnalyticsScript.js
// Weekly analytics and reporting script
// Generates performance reports and triggers follow-up workflows

const mongoose = require('mongoose');
const moment = require('moment');
require('dotenv').config();

const Contact = require('../../models/Contact');
const Company = require('../../models/Company');
const WorkflowExecution = require('../../models/WorkflowExecution');
const { WorkflowService } = require('../../services/workflowService');

async function runWeeklyAnalytics() {
    try {
        console.log('📊 Starting weekly analytics script...');
        
        await mongoose.connect(process.env.MONGODB_URI);
        
        const companies = await Company.find({ isActive: true });
        const startOfWeek = moment().startOf('week').toDate();
        const endOfWeek = moment().endOf('week').toDate();
        
        for (const company of companies) {
            console.log(`📈 Generating analytics for: ${company.companyName}`);
            
            // Calculate weekly metrics
            const weeklyMetrics = await calculateWeeklyMetrics(company._id, startOfWeek, endOfWeek);
            
            // Generate insights and recommendations
            const insights = generateInsights(weeklyMetrics);
            
            // Trigger analytics workflow if configured
            await WorkflowService.triggerWorkflowByEvent('weekly_analytics', {
                company: company.toObject(),
                metrics: weeklyMetrics,
                insights: insights,
                reportPeriod: {
                    start: startOfWeek,
                    end: endOfWeek,
                    week: moment().week()
                }
            }, company._id);
            
            console.log(`✅ Analytics generated for ${company.companyName}:`, {
                newContacts: weeklyMetrics.newContacts,
                totalCalls: weeklyMetrics.totalCalls,
                serviceRequests: weeklyMetrics.serviceRequests
            });
        }
        
        console.log('✅ Weekly analytics script completed');
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Weekly analytics script error:', error);
        process.exit(1);
    }
}

async function calculateWeeklyMetrics(companyId, startDate, endDate) {
    // New contacts this week
    const newContacts = await Contact.countDocuments({
        companyId,
        createdAt: { $gte: startDate, $lte: endDate }
    });
    
    // Total calls this week
    const contactsWithCalls = await Contact.find({
        companyId,
        'interactions.timestamp': { $gte: startDate, $lte: endDate },
        'interactions.type': 'call'
    });
    
    const totalCalls = contactsWithCalls.reduce((total, contact) => {
        return total + contact.interactions.filter(i => 
            i.type === 'call' && 
            i.timestamp >= startDate && 
            i.timestamp <= endDate
        ).length;
    }, 0);
    
    // Service requests this week
    const serviceRequests = await Contact.aggregate([
        { $match: { companyId } },
        { $unwind: '$serviceRequests' },
        {
            $match: {
                'serviceRequests.requestDate': { $gte: startDate, $lte: endDate }
            }
        },
        { $count: 'total' }
    ]);
    
    // Workflow executions this week
    const workflowExecutions = await WorkflowExecution.countDocuments({
        companyId,
        startedAt: { $gte: startDate, $lte: endDate }
    });
    
    const successfulExecutions = await WorkflowExecution.countDocuments({
        companyId,
        startedAt: { $gte: startDate, $lte: endDate },
        status: 'completed'
    });
    
    return {
        newContacts,
        totalCalls,
        serviceRequests: serviceRequests[0]?.total || 0,
        workflowExecutions,
        successfulExecutions,
        workflowSuccessRate: workflowExecutions > 0 ? (successfulExecutions / workflowExecutions * 100).toFixed(1) : 0
    };
}

function generateInsights(metrics) {
    const insights = [];
    
    // Contact growth insights
    if (metrics.newContacts > 10) {
        insights.push({
            type: 'positive',
            message: `Strong week! You gained ${metrics.newContacts} new contacts.`,
            recommendation: 'Consider increasing follow-up workflows to nurture these leads.'
        });
    } else if (metrics.newContacts < 3) {
        insights.push({
            type: 'attention',
            message: `Only ${metrics.newContacts} new contacts this week.`,
            recommendation: 'Review marketing efforts and call-to-action effectiveness.'
        });
    }
    
    // Call volume insights
    const callsPerContact = metrics.newContacts > 0 ? (metrics.totalCalls / metrics.newContacts).toFixed(1) : 0;
    if (callsPerContact > 2) {
        insights.push({
            type: 'attention',
            message: `High call volume per contact (${callsPerContact} calls/contact).`,
            recommendation: 'Consider improving initial call scripts to reduce callback needs.'
        });
    }
    
    // Workflow performance
    if (metrics.workflowSuccessRate < 80) {
        insights.push({
            type: 'action_required',
            message: `Workflow success rate is ${metrics.workflowSuccessRate}%.`,
            recommendation: 'Review failed workflows and optimize automation rules.'
        });
    }
    
    return insights;
}

if (require.main === module) {
    runWeeklyAnalytics();
}

module.exports = { runWeeklyAnalytics };
