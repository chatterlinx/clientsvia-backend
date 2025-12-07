/**
 * ============================================================================
 * BOOKING FLOW ENGINE
 * ============================================================================
 * 
 * STATE MACHINE FOR ALL FLOWS
 * 
 * This service manages the state machine for each flow type. It determines
 * what information needs to be collected and what the next step is.
 * 
 * SUPPORTED FLOWS:
 * - BOOKING: Collect name, phone, address, service type, preferred time
 * - CANCEL: Verify customer, find appointment, confirm cancellation
 * - RESCHEDULE: Verify customer, find appointment, get new time
 * - MESSAGE: Collect name, phone, message content
 * - EMERGENCY: Collect name, phone, address, issue description, dispatch
 * - TRANSFER: Collect name, phone, reason, then transfer
 * 
 * KEY FEATURES:
 * - Configurable fields per company
 * - Tracks what's collected vs what's needed
 * - Determines next step automatically
 * - Supports field validation
 * - Generates LLM prompts for each step
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');

// ============================================================================
// DEFAULT FLOW CONFIGURATIONS
// ============================================================================

const DEFAULT_FLOW_CONFIGS = {
    BOOKING: {
        name: 'Booking',
        description: 'Schedule a new appointment',
        fields: [
            { key: 'name', label: 'Name', required: true, order: 1, prompt: 'What is your name?' },
            { key: 'phone', label: 'Phone', required: true, order: 2, prompt: 'What is the best phone number to reach you?' },
            { key: 'address', label: 'Address', required: true, order: 3, prompt: 'What is the service address?' },
            { key: 'serviceType', label: 'Service Type', required: false, order: 4, prompt: 'What type of service do you need?' },
            { key: 'preferredTime', label: 'Preferred Time', required: false, order: 5, prompt: 'When would you like us to come out?' }
        ],
        confirmationPrompt: 'Let me confirm: I have {name} at {phone}, service address {address}. Is that correct?',
        completionPrompt: 'Great! Your appointment has been scheduled. Is there anything else I can help you with?'
    },
    
    CANCEL: {
        name: 'Cancel Appointment',
        description: 'Cancel an existing appointment',
        fields: [
            { key: 'name', label: 'Name', required: true, order: 1, prompt: 'Can I get your name please?' },
            { key: 'phone', label: 'Phone', required: true, order: 2, prompt: 'And the phone number on the account?' },
            { key: 'appointmentId', label: 'Appointment', required: false, order: 3, prompt: 'Which appointment would you like to cancel?' },
            { key: 'cancelReason', label: 'Reason', required: false, order: 4, prompt: 'May I ask why you need to cancel?' }
        ],
        confirmationPrompt: 'I have your appointment on {appointmentDate}. Are you sure you want to cancel?',
        completionPrompt: 'Your appointment has been cancelled. Would you like to reschedule for another time?'
    },
    
    RESCHEDULE: {
        name: 'Reschedule Appointment',
        description: 'Reschedule an existing appointment',
        fields: [
            { key: 'name', label: 'Name', required: true, order: 1, prompt: 'Can I get your name please?' },
            { key: 'phone', label: 'Phone', required: true, order: 2, prompt: 'And the phone number on the account?' },
            { key: 'appointmentId', label: 'Appointment', required: false, order: 3, prompt: 'Which appointment would you like to reschedule?' },
            { key: 'newTime', label: 'New Time', required: true, order: 4, prompt: 'When would you like to reschedule to?' }
        ],
        confirmationPrompt: 'I can move your appointment to {newTime}. Does that work for you?',
        completionPrompt: 'Your appointment has been rescheduled. Is there anything else I can help with?'
    },
    
    MESSAGE: {
        name: 'Take Message',
        description: 'Take a message for callback',
        fields: [
            { key: 'name', label: 'Name', required: true, order: 1, prompt: 'Who should we call back?' },
            { key: 'phone', label: 'Phone', required: true, order: 2, prompt: 'What is the best number to reach you?' },
            { key: 'message', label: 'Message', required: true, order: 3, prompt: 'What would you like me to tell them?' }
        ],
        confirmationPrompt: 'I have your message for a callback. Is there anything you would like to add?',
        completionPrompt: 'I have your message and someone will call you back shortly. Is there anything else?'
    },
    
    EMERGENCY: {
        name: 'Emergency Dispatch',
        description: 'Handle emergency service request',
        fields: [
            { key: 'name', label: 'Name', required: true, order: 1, prompt: 'Can I get your name?' },
            { key: 'phone', label: 'Phone', required: true, order: 2, prompt: 'What is your phone number?' },
            { key: 'address', label: 'Address', required: true, order: 3, prompt: 'What is the address of the emergency?' },
            { key: 'issueDescription', label: 'Issue', required: true, order: 4, prompt: 'Can you describe the emergency?' }
        ],
        confirmationPrompt: 'I have an emergency at {address}. A technician will be dispatched immediately.',
        completionPrompt: 'Help is on the way. Please stay safe. Is there anything else I should know?'
    },
    
    TRANSFER: {
        name: 'Transfer to Human',
        description: 'Transfer call to a human agent',
        fields: [
            { key: 'name', label: 'Name', required: false, order: 1, prompt: 'Before I transfer you, may I have your name?' },
            { key: 'phone', label: 'Phone', required: false, order: 2, prompt: 'And a callback number in case we get disconnected?' },
            { key: 'reason', label: 'Reason', required: false, order: 3, prompt: 'Can you briefly tell me what this is about so I can connect you with the right person?' }
        ],
        confirmationPrompt: 'I will transfer you now. Please hold.',
        completionPrompt: 'Transferring your call now.'
    },
    
    GENERAL_INQUIRY: {
        name: 'General Inquiry',
        description: 'Handle general questions (routes to triage)',
        fields: [],
        confirmationPrompt: null,
        completionPrompt: 'Is there anything else I can help you with?'
    }
};

// ============================================================================
// STEP TYPES
// ============================================================================

const STEP_TYPES = {
    ASK_FIELD: 'ASK_FIELD',           // Asking for a specific field
    CONFIRM: 'CONFIRM',                // Confirming collected info
    EXECUTE: 'EXECUTE',                // Executing the action (save, cancel, etc.)
    COMPLETE: 'COMPLETE',              // Flow complete
    LOOKUP_CUSTOMER: 'LOOKUP_CUSTOMER', // Looking up customer in DB
    LOOKUP_APPOINTMENT: 'LOOKUP_APPOINTMENT', // Looking up appointment
    TRANSFER_CALL: 'TRANSFER_CALL',    // Transferring the call
    DISPATCH: 'DISPATCH'               // Dispatching emergency
};

// ============================================================================
// MAIN ENGINE
// ============================================================================

class BookingFlowEngine {
    
    /**
     * ========================================================================
     * GET NEXT STEP
     * ========================================================================
     * 
     * Determines the next step in the flow based on current state.
     * 
     * @param {object} callState - Current call state
     * @param {string} callState.flow - Current flow (BOOKING, CANCEL, etc.)
     * @param {object} callState.data - Collected data
     * @param {string} callState.currentStep - Current step (if any)
     * @param {object} companyConfig - Company's flow configuration
     * 
     * @returns {object} Next step info:
     *   {
     *     step: 'ASK_NAME' | 'CONFIRM' | etc.,
     *     stepType: 'ASK_FIELD' | 'CONFIRM' | etc.,
     *     field: { key, label, prompt } | null,
     *     prompt: 'What is your name?',
     *     progress: { collected: 2, total: 5, percent: 40 }
     *   }
     */
    static getNextStep(callState, companyConfig = {}) {
        const flow = callState.flow || 'GENERAL_INQUIRY';
        const collectedData = callState.data || {};
        
        // Get flow config (company override or default)
        const flowConfig = this.getFlowConfig(flow, companyConfig);
        
        if (!flowConfig) {
            logger.warn(`[BOOKING FLOW] Unknown flow: ${flow}`);
            return {
                step: 'UNKNOWN',
                stepType: 'COMPLETE',
                field: null,
                prompt: 'How can I help you?',
                progress: { collected: 0, total: 0, percent: 100 }
            };
        }
        
        // Get fields sorted by order
        const fields = [...(flowConfig.fields || [])].sort((a, b) => a.order - b.order);
        
        // Count progress
        const requiredFields = fields.filter(f => f.required);
        const collectedRequired = requiredFields.filter(f => collectedData[f.key]).length;
        const totalRequired = requiredFields.length;
        
        // Find first missing required field
        for (const field of fields) {
            if (field.required && !collectedData[field.key]) {
                return {
                    step: `ASK_${field.key.toUpperCase()}`,
                    stepType: STEP_TYPES.ASK_FIELD,
                    field,
                    prompt: field.prompt,
                    progress: {
                        collected: collectedRequired,
                        total: totalRequired,
                        percent: totalRequired > 0 ? Math.round((collectedRequired / totalRequired) * 100) : 100
                    }
                };
            }
        }
        
        // All required fields collected - check if we need confirmation
        if (!callState.confirmed && flowConfig.confirmationPrompt) {
            return {
                step: 'CONFIRM',
                stepType: STEP_TYPES.CONFIRM,
                field: null,
                prompt: this.interpolatePrompt(flowConfig.confirmationPrompt, collectedData),
                progress: {
                    collected: collectedRequired,
                    total: totalRequired,
                    percent: 100
                }
            };
        }
        
        // Confirmed - execute the action
        if (!callState.executed) {
            return {
                step: this.getExecuteStep(flow),
                stepType: this.getExecuteStepType(flow),
                field: null,
                prompt: null, // No prompt - this is an action
                progress: {
                    collected: collectedRequired,
                    total: totalRequired,
                    percent: 100
                }
            };
        }
        
        // Complete
        return {
            step: 'COMPLETE',
            stepType: STEP_TYPES.COMPLETE,
            field: null,
            prompt: flowConfig.completionPrompt,
            progress: {
                collected: collectedRequired,
                total: totalRequired,
                percent: 100
            }
        };
    }
    
    /**
     * ========================================================================
     * GET FLOW CONFIG
     * ========================================================================
     */
    static getFlowConfig(flow, companyConfig = {}) {
        // Check company override first
        const companyFlowConfig = companyConfig.flows?.[flow];
        if (companyFlowConfig) {
            // Merge with defaults
            return {
                ...DEFAULT_FLOW_CONFIGS[flow],
                ...companyFlowConfig,
                fields: companyFlowConfig.fields || DEFAULT_FLOW_CONFIGS[flow]?.fields || []
            };
        }
        
        return DEFAULT_FLOW_CONFIGS[flow];
    }
    
    /**
     * ========================================================================
     * GET EXECUTE STEP
     * ========================================================================
     */
    static getExecuteStep(flow) {
        switch (flow) {
            case 'BOOKING': return 'SAVE_BOOKING';
            case 'CANCEL': return 'CANCEL_APPOINTMENT';
            case 'RESCHEDULE': return 'UPDATE_APPOINTMENT';
            case 'MESSAGE': return 'SAVE_MESSAGE';
            case 'EMERGENCY': return 'DISPATCH_EMERGENCY';
            case 'TRANSFER': return 'TRANSFER_CALL';
            default: return 'COMPLETE';
        }
    }
    
    /**
     * ========================================================================
     * GET EXECUTE STEP TYPE
     * ========================================================================
     */
    static getExecuteStepType(flow) {
        switch (flow) {
            case 'EMERGENCY': return STEP_TYPES.DISPATCH;
            case 'TRANSFER': return STEP_TYPES.TRANSFER_CALL;
            default: return STEP_TYPES.EXECUTE;
        }
    }
    
    /**
     * ========================================================================
     * INTERPOLATE PROMPT
     * ========================================================================
     * 
     * Replace {placeholders} with actual values.
     */
    static interpolatePrompt(prompt, data) {
        if (!prompt) return prompt;
        
        return prompt.replace(/\{(\w+)\}/g, (match, key) => {
            return data[key] || match;
        });
    }
    
    /**
     * ========================================================================
     * EXTRACT FIELD VALUE
     * ========================================================================
     * 
     * Extract a field value from caller input based on the field type.
     * This is a basic implementation - can be enhanced with NLP.
     * 
     * @param {string} input - Caller's response
     * @param {object} field - Field definition
     * @param {object} context - Additional context
     * @returns {string|null} Extracted value or null
     */
    static extractFieldValue(input, field, context = {}) {
        if (!input || !field) return null;
        
        const text = input.trim();
        
        switch (field.key) {
            case 'name':
                // Extract name - take the input as-is or extract from "my name is X"
                const nameMatch = text.match(/(?:my name is|i'm|this is|it's)\s+(.+)/i);
                return nameMatch ? nameMatch[1].trim() : text;
                
            case 'phone':
                // Extract phone number
                const phoneMatch = text.match(/[\d\-\(\)\s]{10,}/);
                return phoneMatch ? phoneMatch[0].replace(/\D/g, '') : null;
                
            case 'address':
                // Take address as-is (complex extraction would need NLP)
                return text;
                
            case 'serviceType':
                // Take as-is
                return text;
                
            case 'preferredTime':
            case 'newTime':
                // Take as-is (date/time parsing would need NLP)
                return text;
                
            case 'message':
            case 'issueDescription':
            case 'reason':
            case 'cancelReason':
                // Take as-is
                return text;
                
            default:
                return text;
        }
    }
    
    /**
     * ========================================================================
     * VALIDATE FIELD VALUE
     * ========================================================================
     */
    static validateFieldValue(value, field) {
        if (!value) return { valid: false, error: 'Value is required' };
        
        switch (field.key) {
            case 'phone':
                const digits = value.replace(/\D/g, '');
                if (digits.length < 10) {
                    return { valid: false, error: 'Please provide a valid phone number' };
                }
                return { valid: true };
                
            case 'name':
                if (value.length < 2) {
                    return { valid: false, error: 'Please provide your name' };
                }
                return { valid: true };
                
            default:
                return { valid: true };
        }
    }
    
    /**
     * ========================================================================
     * UPDATE CALL STATE
     * ========================================================================
     * 
     * Update call state with new field value.
     */
    static updateCallState(callState, fieldKey, value) {
        return {
            ...callState,
            data: {
                ...callState.data,
                [fieldKey]: value
            }
        };
    }
    
    /**
     * ========================================================================
     * BUILD LLM PROMPT
     * ========================================================================
     * 
     * Build a minimal, focused prompt for the LLM based on current step.
     * The LLM is just the "mouth" - it phrases the question/response.
     * 
     * @param {object} nextStep - Result from getNextStep()
     * @param {object} callState - Current call state
     * @param {object} style - Company's style configuration
     * @returns {string} LLM prompt
     */
    static buildLLMPrompt(nextStep, callState, style = {}) {
        const tone = style.preset || 'friendly';
        const customNotes = style.customNotes || '';
        
        let prompt = `You are a ${tone} AI receptionist. `;
        
        if (customNotes) {
            prompt += `Style notes: ${customNotes.substring(0, 200)}. `;
        }
        
        switch (nextStep.stepType) {
            case STEP_TYPES.ASK_FIELD:
                prompt += `\n\nYour task: Ask for the caller's ${nextStep.field.label.toLowerCase()}.`;
                prompt += `\nSuggested phrasing: "${nextStep.prompt}"`;
                prompt += `\n\nGenerate a natural, conversational question. Keep it under 25 words.`;
                break;
                
            case STEP_TYPES.CONFIRM:
                prompt += `\n\nYour task: Confirm the information collected.`;
                prompt += `\nData to confirm: ${JSON.stringify(callState.data)}`;
                prompt += `\nSuggested phrasing: "${nextStep.prompt}"`;
                prompt += `\n\nGenerate a natural confirmation. Keep it under 40 words.`;
                break;
                
            case STEP_TYPES.COMPLETE:
                prompt += `\n\nYour task: Thank the caller and close the conversation.`;
                prompt += `\nSuggested phrasing: "${nextStep.prompt}"`;
                prompt += `\n\nGenerate a warm closing. Keep it under 30 words.`;
                break;
                
            default:
                prompt += `\n\nGenerate a brief, helpful response. Keep it under 30 words.`;
        }
        
        return prompt;
    }
    
    /**
     * ========================================================================
     * GET FLOW STATUS
     * ========================================================================
     * 
     * Get a summary of current flow status for debugging/logging.
     */
    static getFlowStatus(callState, companyConfig = {}) {
        const flow = callState.flow || 'GENERAL_INQUIRY';
        const flowConfig = this.getFlowConfig(flow, companyConfig);
        const nextStep = this.getNextStep(callState, companyConfig);
        
        const fields = flowConfig?.fields || [];
        const collectedFields = fields.filter(f => callState.data?.[f.key]);
        const missingRequired = fields.filter(f => f.required && !callState.data?.[f.key]);
        
        return {
            flow,
            flowName: flowConfig?.name || flow,
            currentStep: nextStep.step,
            stepType: nextStep.stepType,
            progress: nextStep.progress,
            collected: collectedFields.map(f => ({ key: f.key, value: callState.data[f.key] })),
            missingRequired: missingRequired.map(f => f.key),
            confirmed: callState.confirmed || false,
            executed: callState.executed || false,
            isComplete: nextStep.stepType === STEP_TYPES.COMPLETE
        };
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = BookingFlowEngine;
module.exports.DEFAULT_FLOW_CONFIGS = DEFAULT_FLOW_CONFIGS;
module.exports.STEP_TYPES = STEP_TYPES;

