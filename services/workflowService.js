// services/workflowService.js
// Comprehensive workflow execution engine

const Workflow = require('../models/Workflow');
const Action = require('../models/Action');
const Company = require('../models/Company');
const mongoose = require('mongoose');

class WorkflowService {
    constructor() {
        this.initialized = false;
    }

    async initialize() {
        console.log('[WorkflowService] Service initialized');
        this.initialized = true;
        return true;
    }

    isInitialized() {
        return this.initialized;
    }

    // Get workflows for a company
    async getWorkflows(companyId) {
        try {
            const workflows = await Workflow.find({ companyId })
                .populate('steps.actionId')
                .sort({ updatedAt: -1 });
            
            return workflows;
        } catch (error) {
            console.error('[WorkflowService] Error getting workflows:', error);
            return [];
        }
    }

    // Get a single workflow by ID
    async getWorkflow(workflowId) {
        try {
            const workflow = await Workflow.findById(workflowId)
                .populate('steps.actionId');
            
            return workflow;
        } catch (error) {
            console.error('[WorkflowService] Error getting workflow:', error);
            return null;
        }
    }

    // Create a new workflow
    async createWorkflow(workflowData) {
        try {
            const workflow = new Workflow({
                name: workflowData.name,
                description: workflowData.description || '',
                companyId: workflowData.companyId,
                category: workflowData.category || 'customer_service',
                triggers: [{
                    type: workflowData.triggerType || 'manual',
                    enabled: true,
                    conditions: workflowData.triggerConditions || []
                }],
                steps: workflowData.steps || [],
                settings: {
                    enabled: true,
                    maxConcurrentExecutions: 10,
                    timeout: 3600
                }
            });

            await workflow.save();
            return workflow;
        } catch (error) {
            console.error('[WorkflowService] Error creating workflow:', error);
            throw error;
        }
    }

    // Update workflow
    async updateWorkflow(workflowId, updateData) {
        try {
            const workflow = await Workflow.findByIdAndUpdate(
                workflowId,
                { ...updateData, updatedAt: new Date() },
                { new: true }
            ).populate('steps.actionId');

            return workflow;
        } catch (error) {
            console.error('[WorkflowService] Error updating workflow:', error);
            throw error;
        }
    }

    // Delete workflow
    async deleteWorkflow(workflowId) {
        try {
            await Workflow.findByIdAndDelete(workflowId);
            return true;
        } catch (error) {
            console.error('[WorkflowService] Error deleting workflow:', error);
            throw error;
        }
    }

    // Execute workflow
    async executeWorkflow(workflow, context = {}, triggerType = 'manual') {
        const startTime = Date.now();
        const executionId = new mongoose.Types.ObjectId();

        try {
            console.log(`[WorkflowService] Executing workflow: ${workflow.name}`);

            // Check if workflow can execute
            if (!workflow.canExecute(context)) {
                throw new Error('Workflow execution conditions not met');
            }

            // Create execution record
            const WorkflowExecution = mongoose.model('WorkflowExecution');
            const execution = new WorkflowExecution({
                _id: executionId,
                workflowId: workflow._id,
                companyId: workflow.companyId,
                triggerType,
                triggerData: context,
                context,
                status: 'running'
            });
            await execution.save();

            // Execute steps
            const results = await this.executeSteps(workflow, context, execution);

            // Update execution record
            const endTime = Date.now();
            const duration = endTime - startTime;

            await WorkflowExecution.findByIdAndUpdate(executionId, {
                status: 'completed',
                endTime: new Date(),
                totalDuration: duration,
                finalOutput: results
            });

            // Update workflow analytics
            await this.updateWorkflowAnalytics(workflow._id, true, duration);

            return {
                success: true,
                executionId,
                results,
                duration
            };

        } catch (error) {
            console.error('[WorkflowService] Workflow execution failed:', error);

            // Update execution record with error
            const endTime = Date.now();
            const duration = endTime - startTime;

            const WorkflowExecution = mongoose.model('WorkflowExecution');
            await WorkflowExecution.findByIdAndUpdate(executionId, {
                status: 'failed',
                endTime: new Date(),
                totalDuration: duration,
                errorMessage: error.message
            });

            // Update workflow analytics
            await this.updateWorkflowAnalytics(workflow._id, false, duration);

            return {
                success: false,
                error: error.message,
                duration
            };
        }
    }

    // Execute workflow steps
    async executeSteps(workflow, context, execution) {
        const results = [];
        const stepResults = new Map();

        // Sort steps by dependencies
        const sortedSteps = this.topologicalSort(workflow.steps);

        for (const step of sortedSteps) {
            try {
                console.log(`[WorkflowService] Executing step: ${step.name}`);

                // Check step conditions
                if (!this.evaluateStepConditions(step, context, stepResults)) {
                    console.log(`[WorkflowService] Skipping step ${step.name} - conditions not met`);
                    continue;
                }

                // Execute the step
                const stepResult = await this.executeStep(step, context, stepResults);
                
                stepResults.set(step.stepId, stepResult);
                results.push({
                    stepId: step.stepId,
                    name: step.name,
                    result: stepResult,
                    timestamp: new Date()
                });

                // Apply any delays
                if (step.config?.delay) {
                    await this.delay(step.config.delay * 60 * 1000); // Convert minutes to ms
                }

            } catch (error) {
                console.error(`[WorkflowService] Step ${step.name} failed:`, error);

                // Handle error based on step configuration
                const errorAction = step.config?.onError || 'stop';
                
                if (errorAction === 'stop') {
                    throw error;
                } else if (errorAction === 'continue') {
                    results.push({
                        stepId: step.stepId,
                        name: step.name,
                        error: error.message,
                        timestamp: new Date()
                    });
                    continue;
                }
            }
        }

        return results;
    }

    // Execute individual step
    async executeStep(step, context, previousResults) {
        // Load the action
        const action = await Action.findById(step.actionId);
        if (!action) {
            throw new Error(`Action not found for step ${step.stepId}`);
        }

        // Prepare step context
        const stepContext = {
            ...context,
            stepConfig: step.config,
            previousResults: Object.fromEntries(previousResults)
        };

        // Execute based on action type
        switch (action.type) {
            case 'send_sms':
                return await this.executeSMSAction(action, stepContext);
            case 'send_email':
                return await this.executeEmailAction(action, stepContext);
            case 'wait':
                return await this.executeWaitAction(action, stepContext);
            case 'webhook':
                return await this.executeWebhookAction(action, stepContext);
            case 'condition':
                return await this.executeConditionAction(action, stepContext);
            default:
                console.log(`[WorkflowService] Action type ${action.type} not implemented yet`);
                return { success: true, message: `Action ${action.type} executed (placeholder)` };
        }
    }

    // Action executors
    async executeSMSAction(action, context) {
        // Placeholder for SMS action
        console.log('[WorkflowService] Executing SMS action:', action.name);
        return { success: true, message: 'SMS sent (placeholder)' };
    }

    async executeEmailAction(action, context) {
        // Placeholder for email action
        console.log('[WorkflowService] Executing email action:', action.name);
        return { success: true, message: 'Email sent (placeholder)' };
    }

    async executeWaitAction(action, context) {
        const duration = action.config?.duration || 1000;
        await this.delay(duration);
        return { success: true, message: `Waited ${duration}ms` };
    }

    async executeWebhookAction(action, context) {
        // Placeholder for webhook action
        console.log('[WorkflowService] Executing webhook action:', action.name);
        return { success: true, message: 'Webhook called (placeholder)' };
    }

    async executeConditionAction(action, context) {
        // Evaluate condition logic
        const conditions = action.config?.conditions || [];
        const result = this.evaluateConditions(conditions, context);
        return { success: true, conditionMet: result };
    }

    // Helper methods
    evaluateStepConditions(step, context, previousResults) {
        if (!step.config?.conditions || step.config.conditions.length === 0) {
            return true;
        }

        return step.config.conditions.every(condition => {
            const value = this.getContextValue(condition.field, context, previousResults);
            return this.compareValues(value, condition.operator, condition.value);
        });
    }

    evaluateConditions(conditions, context) {
        return conditions.every(condition => {
            const value = this.getContextValue(condition.field, context);
            return this.compareValues(value, condition.operator, condition.value);
        });
    }

    compareValues(actual, operator, expected) {
        switch (operator) {
            case 'equals':
                return actual === expected;
            case 'not_equals':
                return actual !== expected;
            case 'contains':
                return String(actual).toLowerCase().includes(String(expected).toLowerCase());
            case 'greater_than':
                return Number(actual) > Number(expected);
            case 'less_than':
                return Number(actual) < Number(expected);
            case 'exists':
                return actual !== undefined && actual !== null;
            default:
                return false;
        }
    }

    getContextValue(field, context, previousResults = new Map()) {
        // Check previous step results first
        if (field.startsWith('step.')) {
            const stepId = field.replace('step.', '');
            return previousResults.get(stepId);
        }

        // Check context
        return context[field];
    }

    topologicalSort(steps) {
        // Simple topological sort for step dependencies
        const sorted = [];
        const visited = new Set();
        const visiting = new Set();

        const visit = (step) => {
            if (visiting.has(step.stepId)) {
                throw new Error(`Circular dependency detected involving step ${step.stepId}`);
            }
            if (visited.has(step.stepId)) {
                return;
            }

            visiting.add(step.stepId);

            // Visit dependencies first
            if (step.dependsOn) {
                step.dependsOn.forEach(depId => {
                    const depStep = steps.find(s => s.stepId === depId);
                    if (depStep) {
                        visit(depStep);
                    }
                });
            }

            visiting.delete(step.stepId);
            visited.add(step.stepId);
            sorted.push(step);
        };

        steps.forEach(step => {
            if (!visited.has(step.stepId)) {
                visit(step);
            }
        });

        return sorted;
    }

    async updateWorkflowAnalytics(workflowId, success, duration) {
        try {
            const update = {
                $inc: {
                    'analytics.totalExecutions': 1,
                    'analytics.successfulExecutions': success ? 1 : 0,
                    'analytics.failedExecutions': success ? 0 : 1
                },
                $set: {
                    'analytics.lastExecuted': new Date()
                }
            };

            await Workflow.findByIdAndUpdate(workflowId, update);

            // Update average execution time
            const workflow = await Workflow.findById(workflowId);
            if (workflow.analytics.totalExecutions > 0) {
                const avgTime = (workflow.analytics.avgExecutionTime || 0) * (workflow.analytics.totalExecutions - 1);
                workflow.analytics.avgExecutionTime = (avgTime + duration) / workflow.analytics.totalExecutions;
                await workflow.save();
            }
        } catch (error) {
            console.error('[WorkflowService] Error updating analytics:', error);
        }
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Get workflow templates
    async getWorkflowTemplates(category = null) {
        try {
            return await Workflow.getTemplates(category);
        } catch (error) {
            console.error('[WorkflowService] Error getting templates:', error);
            return [];
        }
    }

    // Trigger workflows by event
    async triggerWorkflowsByEvent(eventType, eventData, companyId) {
        try {
            const workflows = await Workflow.findByTrigger(eventType, companyId);
            const results = [];

            for (const workflow of workflows) {
                if (workflow.canExecute(eventData)) {
                    const result = await this.executeWorkflow(workflow, eventData, eventType);
                    results.push({
                        workflowId: workflow._id,
                        workflowName: workflow.name,
                        result
                    });
                }
            }

            return results;
        } catch (error) {
            console.error('[WorkflowService] Error triggering workflows:', error);
            return [];
        }
    }
}

module.exports = new WorkflowService();
