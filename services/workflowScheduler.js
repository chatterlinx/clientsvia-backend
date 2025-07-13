// Simple scheduler - Add this to your existing codebase
const cron = require('node-cron');
const { WorkflowService } = require('./workflowService');
const Company = require('../models/Company');

// Schedule workflows to run at specific times
class WorkflowScheduler {
    static init() {
        // Daily follow-ups at 9 AM
        cron.schedule('0 9 * * *', async () => {
            console.log('Running daily follow-up workflows...');
            await this.runDailyFollowUps();
        });
        
        // Weekly reports on Mondays at 8 AM
        cron.schedule('0 8 * * 1', async () => {
            console.log('Running weekly reports...');
            await this.runWeeklyReports();
        });
        
        // Check for missed appointments every hour
        cron.schedule('0 * * * *', async () => {
            await this.checkMissedAppointments();
        });
    }
    
    static async runDailyFollowUps() {
        // Trigger follow-up workflows for contacts that need them
        const companies = await Company.find({});
        
        for (const company of companies) {
            await WorkflowService.triggerWorkflowByEvent(
                'daily_follow_up',
                { scheduledTime: new Date() },
                company._id
            );
        }
    }
    
    static async runWeeklyReports() {
        // Generate weekly analytics reports
        const companies = await Company.find({});
        
        for (const company of companies) {
            await WorkflowService.triggerWorkflowByEvent(
                'weekly_report',
                { 
                    reportType: 'weekly',
                    generatedAt: new Date() 
                },
                company._id
            );
        }
    }
    
    static async checkMissedAppointments() {
        // Check for missed appointments and trigger workflows
        console.log('Checking for missed appointments...');
        // Add your appointment checking logic here
    }
}

module.exports = { WorkflowScheduler };
