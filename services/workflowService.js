// services/workflowService.js
// Basic workflow service - Step 2 (Clean implementation)

const mongoose = require('mongoose');
const Workflow = require('../models/Workflow');
const Action = require('../models/Action');
const WorkflowExecution = require('../models/WorkflowExecution');

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

    // Get active workflows for a company
    async getActiveWorkflowsForCompany(companyId) {
        try {
            const workflows = await Workflow.find({
                companyId,
                isActive: true
            }).populate({
                path: 'steps.actionId',
                model: 'Action'
            });
            
            return workflows;
        } catch (error) {
            console.error('[WORKFLOW] Error getting active workflows:', error);
            return [];
        }
    }

    // Get all workflows for a company
    async getWorkflows(companyId) {
        try {
            console.log(`[WorkflowService] Getting workflows for company: ${companyId}`);
            const workflows = await Workflow.find({ companyId })
                .populate('steps.actionId')
                .sort({ createdAt: -1 });
            return workflows;
        } catch (error) {
            console.error('[WorkflowService] Error getting workflows:', error);
            return [];
        }
    }

    // Create a new workflow
    async createWorkflow(workflowData) {
        try {
            console.log(`[WorkflowService] Creating workflow: ${workflowData.name}`);
            const workflow = new Workflow(workflowData);
            await workflow.save();
            return workflow;
        } catch (error) {
            console.error('[WorkflowService] Error creating workflow:', error);
            throw error;
        }
    }

    // Execute a workflow (basic implementation)
    async executeWorkflow(workflowId, context = {}) {
        try {
            const workflow = await Workflow.findById(workflowId)
                .populate('steps.actionId');
                
            if (!workflow || !workflow.isActive) {
                throw new Error('Workflow not found or inactive');
            }

            // Create execution record
            const executionId = new mongoose.Types.ObjectId().toString();
            const execution = new WorkflowExecution({
                workflowId: workflow._id,
                companyId: workflow.companyId,
                triggerEvent: context.event || 'manual',
                context,
                executionId,
                status: 'running'
            });

            await execution.save();

            console.log(`[WorkflowService] Started execution ${executionId} for workflow ${workflow.name}`);
            
            return {
                success: true,
                executionId,
                message: `Workflow ${workflow.name} execution started`
            };

        } catch (error) {
            console.error('[WorkflowService] Error executing workflow:', error);
            throw error;
        }
    }

    // Get workflow execution status
    async getExecutionStatus(executionId) {
        try {
            const execution = await WorkflowExecution.findOne({ executionId })
                .populate('workflowId');
            return execution;
        } catch (error) {
            console.error('[WorkflowService] Error getting execution status:', error);
            return null;
        }
    }
}

const workflowService = new WorkflowService();

module.exports = { 
    WorkflowService: workflowService,
    getActiveWorkflowsForCompany: workflowService.getActiveWorkflowsForCompany.bind(workflowService)
};
