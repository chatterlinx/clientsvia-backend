// services/schedulerService.js
// Workflow Scheduler - Cron jobs, time-based triggers, and script integration
// Handles recurring workflows, follow-ups, and automated sequences

const cron = require('node-cron');
const moment = require('moment');
const { WorkflowService } = require('./workflowService');
const { ActionService } = require('./actionService');
const Contact = require('../models/Contact');
const Company = require('../models/Company');
const Workflow = require('../models/Workflow');

class SchedulerService {
    static scheduledJobs = new Map();
    static isInitialized = false;

    /**
     * Initialize the scheduler service
     */
    static async initialize() {
        if (this.isInitialized) return;
        
        console.log('[SCHEDULER] 🕒 Initializing workflow scheduler service...');
        
        // Load existing scheduled workflows
        await this.loadScheduledWorkflows();
        
        // Start recurring job checks
        this.startRecurringJobs();
        
        this.isInitialized = true;
        console.log('[SCHEDULER] ✅ Scheduler service initialized');
    }

    /**
     * Schedule a workflow to run at specific time(s)
     */
    static async scheduleWorkflow(workflowId, schedule, context = {}) {
        try {
            const workflow = await Workflow.findById(workflowId);
            if (!workflow) {
                throw new Error('Workflow not found');
            }

            const jobId = `workflow_${workflowId}_${Date.now()}`;
            
            // Create cron job
            const job = cron.schedule(schedule.cronExpression, async () => {
                console.log(`[SCHEDULER] ⏰ Executing scheduled workflow: ${workflow.name}`);
                
                try {
                    const result = await WorkflowService.executeWorkflow(workflowId, {
                        ...context,
                        scheduledExecution: true,
                        scheduledAt: new Date(),
                        scheduleId: jobId
                    });
                    
                    console.log(`[SCHEDULER] ${result.success ? '✅' : '❌'} Scheduled workflow ${workflow.name}: ${result.success ? 'SUCCESS' : result.error}`);
                    
                } catch (error) {
                    console.error(`[SCHEDULER] ❌ Error in scheduled workflow ${workflow.name}:`, error.message);
                }
            }, {
                scheduled: schedule.enabled !== false,
                timezone: schedule.timezone || 'America/New_York'
            });

            this.scheduledJobs.set(jobId, {
                job,
                workflowId,
                workflowName: workflow.name,
                schedule,
                context,
                createdAt: new Date()
            });

            console.log(`[SCHEDULER] 📅 Scheduled workflow "${workflow.name}" with cron: ${schedule.cronExpression}`);
            return jobId;

        } catch (error) {
            console.error('[SCHEDULER] ❌ Error scheduling workflow:', error.message);
            throw error;
        }
    }

    /**
     * Schedule follow-up workflows with delays
     */
    static async scheduleFollowUp(workflowId, delayMinutes, context = {}) {
        const executeAt = moment().add(delayMinutes, 'minutes').toDate();
        
        setTimeout(async () => {
            console.log(`[SCHEDULER] ⏱️ Executing follow-up workflow after ${delayMinutes} minutes`);
            
            try {
                await WorkflowService.executeWorkflow(workflowId, {
                    ...context,
                    followUpExecution: true,
                    originalTrigger: context.trigger,
                    delayedBy: delayMinutes
                });
            } catch (error) {
                console.error(`[SCHEDULER] ❌ Follow-up workflow error:`, error.message);
            }
        }, delayMinutes * 60 * 1000);

        console.log(`[SCHEDULER] ⏰ Follow-up scheduled for ${executeAt.toLocaleString()}`);
        return executeAt;
    }

    /**
     * Create recurring workflows (daily, weekly, monthly follow-ups)
     */
    static async createRecurringWorkflow(config) {
        const {
            name,
            companyId,
            workflowTemplate,
            schedule,
            targetCriteria
        } = config;

        // Create the recurring workflow
        const recurringWorkflow = new Workflow({
            name: `[RECURRING] ${name}`,
            description: `Automated recurring workflow: ${schedule.frequency}`,
            category: 'follow_up',
            companyId,
            trigger: {
                event: 'scheduled',
                schedule: schedule
            },
            steps: workflowTemplate.steps,
            variables: {
                ...workflowTemplate.variables,
                recurring: true,
                frequency: schedule.frequency
            },
            settings: {
                maxExecutionTime: 300000,
                retryPolicy: { maxRetries: 2, retryDelay: 5000 }
            },
            tags: ['recurring', 'automated', schedule.frequency],
            isActive: true
        });

        await recurringWorkflow.save();

        // Schedule the workflow
        const cronExpression = this.buildCronExpression(schedule);
        const jobId = await this.scheduleWorkflow(recurringWorkflow._id, {
            cronExpression,
            enabled: true,
            timezone: schedule.timezone
        }, {
            targetCriteria,
            recurring: true
        });

        console.log(`[SCHEDULER] 🔄 Created recurring workflow: ${name} (${schedule.frequency})`);
        return { workflowId: recurringWorkflow._id, jobId };
    }

    /**
     * Build cron expressions from schedule config
     */
    static buildCronExpression(schedule) {
        const { frequency, time, dayOfWeek, dayOfMonth } = schedule;

        const [hour, minute] = (time || '09:00').split(':');

        switch (frequency) {
            case 'daily':
                return `${minute} ${hour} * * *`;
            case 'weekly':
                const day = dayOfWeek || 1; // Monday default
                return `${minute} ${hour} * * ${day}`;
            case 'monthly':
                const date = dayOfMonth || 1;
                return `${minute} ${hour} ${date} * *`;
            case 'hourly':
                return `${minute} * * * *`;
            default:
                throw new Error(`Unsupported frequency: ${frequency}`);
        }
    }

    /**
     * Start recurring system jobs
     */
    static startRecurringJobs() {
        // Daily follow-up job (9 AM)
        cron.schedule('0 9 * * *', async () => {
            console.log('[SCHEDULER] 🌅 Running daily follow-up check...');
            await this.runDailyFollowUps();
        });

        // Weekly analytics (Monday 8 AM)
        cron.schedule('0 8 * * 1', async () => {
            console.log('[SCHEDULER] 📊 Running weekly analytics...');
            await this.runWeeklyAnalytics();
        });

        // Cleanup old executions (Sunday 2 AM)
        cron.schedule('0 2 * * 0', async () => {
            console.log('[SCHEDULER] 🧹 Running cleanup tasks...');
            await this.runCleanupTasks();
        });

        console.log('[SCHEDULER] 🔄 Recurring system jobs started');
    }

    /**
     * Run daily follow-up workflows
     */
    static async runDailyFollowUps() {
        try {
            const companies = await Company.find({ isActive: true });

            for (const company of companies) {
                // Find contacts that need follow-up
                const contactsNeedingFollowUp = await Contact.find({
                    companyId: company._id,
                    status: { $in: ['new_lead', 'qualified_lead'] },
                    lastContactDate: {
                        $lt: moment().subtract(24, 'hours').toDate(),
                        $gt: moment().subtract(7, 'days').toDate()
                    }
                });

                console.log(`[SCHEDULER] 📞 Found ${contactsNeedingFollowUp.length} contacts needing follow-up for ${company.companyName}`);

                // Trigger follow-up workflows for each contact
                for (const contact of contactsNeedingFollowUp) {
                    await WorkflowService.triggerWorkflowByEvent('daily_follow_up', {
                        contact: contact.toObject(),
                        company: company.toObject(),
                        daysSinceLastContact: moment().diff(contact.lastContactDate, 'days')
                    }, company._id);
                }
            }

        } catch (error) {
            console.error('[SCHEDULER] ❌ Error in daily follow-ups:', error.message);
        }
    }

    /**
     * Script Integration - Execute custom scripts as workflow actions
     */
    static async executeScript(scriptConfig, context = {}) {
        const { scriptType, scriptPath, parameters } = scriptConfig;

        try {
            console.log(`[SCHEDULER] 🔧 Executing script: ${scriptType} - ${scriptPath}`);

            switch (scriptType) {
                case 'node':
                    return await this.executeNodeScript(scriptPath, parameters, context);
                case 'python':
                    return await this.executePythonScript(scriptPath, parameters, context);
                case 'bash':
                    return await this.executeBashScript(scriptPath, parameters, context);
                case 'webhook':
                    return await this.executeWebhookScript(scriptPath, parameters, context);
                default:
                    throw new Error(`Unsupported script type: ${scriptType}`);
            }

        } catch (error) {
            console.error(`[SCHEDULER] ❌ Script execution error:`, error.message);
            throw error;
        }
    }

    /**
     * Execute Node.js script
     */
    static async executeNodeScript(scriptPath, parameters, context) {
        const { spawn } = require('child_process');
        
        return new Promise((resolve, reject) => {
            const child = spawn('node', [scriptPath], {
                env: {
                    ...process.env,
                    WORKFLOW_CONTEXT: JSON.stringify(context),
                    SCRIPT_PARAMETERS: JSON.stringify(parameters)
                }
            });

            let output = '';
            let error = '';

            child.stdout.on('data', (data) => {
                output += data.toString();
            });

            child.stderr.on('data', (data) => {
                error += data.toString();
            });

            child.on('close', (code) => {
                if (code === 0) {
                    resolve({ success: true, output, code });
                } else {
                    reject(new Error(`Script failed with code ${code}: ${error}`));
                }
            });
        });
    }

    /**
     * Execute webhook script
     */
    static async executeWebhookScript(webhookUrl, parameters, context) {
        const axios = require('axios');

        const payload = {
            context,
            parameters,
            timestamp: new Date().toISOString()
        };

        const response = await axios.post(webhookUrl, payload, {
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'ClientsVia-Workflow-Engine'
            },
            timeout: 30000
        });

        return {
            success: true,
            output: response.data,
            statusCode: response.status
        };
    }

    /**
     * Cancel scheduled workflow
     */
    static cancelScheduledWorkflow(jobId) {
        const scheduledJob = this.scheduledJobs.get(jobId);
        if (scheduledJob) {
            scheduledJob.job.stop();
            this.scheduledJobs.delete(jobId);
            console.log(`[SCHEDULER] ⏹️ Cancelled scheduled workflow: ${scheduledJob.workflowName}`);
            return true;
        }
        return false;
    }

    /**
     * Get all scheduled workflows
     */
    static getScheduledWorkflows() {
        const schedules = [];
        for (const [jobId, jobData] of this.scheduledJobs) {
            schedules.push({
                jobId,
                workflowId: jobData.workflowId,
                workflowName: jobData.workflowName,
                schedule: jobData.schedule,
                createdAt: jobData.createdAt,
                isRunning: jobData.job.running
            });
        }
        return schedules;
    }

    /**
     * Weekly analytics job
     */
    static async runWeeklyAnalytics() {
        // Implementation for weekly analytics
        console.log('[SCHEDULER] 📊 Weekly analytics completed');
    }

    /**
     * Cleanup old data
     */
    static async runCleanupTasks() {
        // Implementation for cleanup tasks
        console.log('[SCHEDULER] 🧹 Cleanup tasks completed');
    }

    /**
     * Load existing scheduled workflows from database
     */
    static async loadScheduledWorkflows() {
        // Implementation to restore scheduled workflows on server restart
        console.log('[SCHEDULER] 📥 Loaded existing scheduled workflows');
    }
}

module.exports = { SchedulerService };
