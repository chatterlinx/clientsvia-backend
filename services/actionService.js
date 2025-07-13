// services/actionService.js
// Action Execution Engine - Handles all action types and integrations
// Core service for workflow automation system

const Contact = require('../models/Contact');
const Company = require('../models/Company');
const { schedulingService } = require('./schedulingService');

class ActionService {
    
    /**
     * Execute an action with given context
     */
    static async executeAction(action, context = {}) {
        const startTime = Date.now();
        
        try {
            // Validate action can execute
            if (action.canExecute && !action.canExecute(context)) {
                throw new Error('Action conditions not met');
            }
            
            // Skip conditions check if canExecute method doesn't exist (simple actions)
            if (!action.canExecute && !action.isActive) {
                throw new Error('Action is not active');
            }
            
            // Execute based on action type
            let result;
            switch (action.type) {
                // Communication Actions
                case 'send_sms':
                    result = await this.executeSendSms(action, context);
                    break;
                case 'send_email':
                    result = await this.executeSendEmail(action, context);
                    break;
                case 'make_call':
                    result = await this.executeMakeCall(action, context);
                    break;
                case 'send_voicemail':
                    result = await this.executeSendVoicemail(action, context);
                    break;
                
                // Scheduling Actions
                case 'book_appointment':
                    result = await this.executeBookAppointment(action, context);
                    break;
                case 'send_calendar_invite':
                    result = await this.executeSendCalendarInvite(action, context);
                    break;
                case 'reschedule_appointment':
                    result = await this.executeRescheduleAppointment(action, context);
                    break;
                
                // Contact Management
                case 'create_contact':
                    result = await this.executeCreateContact(action, context);
                    break;
                case 'update_contact':
                    result = await this.executeUpdateContact(action, context);
                    break;
                case 'add_tag':
                    result = await this.executeAddTag(action, context);
                    break;
                case 'remove_tag':
                    result = await this.executeRemoveTag(action, context);
                    break;
                
                // Data & Intelligence
                case 'extract_data':
                    result = await this.executeExtractData(action, context);
                    break;
                case 'ai_analysis':
                    result = await this.executeAiAnalysis(action, context);
                    break;
                case 'sentiment_analysis':
                    result = await this.executeSentimentAnalysis(action, context);
                    break;
                
                // Integration Actions
                case 'webhook':
                    result = await this.executeWebhook(action, context);
                    break;
                case 'api_call':
                    result = await this.executeApiCall(action, context);
                    break;
                
                // Service Management
                case 'create_service_request':
                    result = await this.executeCreateServiceRequest(action, context);
                    break;
                
                // Workflow Control
                case 'wait':
                    result = await this.executeWait(action, context);
                    break;
                case 'condition':
                    result = await this.executeCondition(action, context);
                    break;
                
                default:
                    throw new Error(`Unsupported action type: ${action.type}`);
            }
            
            // Update action statistics
            const duration = Date.now() - startTime;
            await this.updateActionStats(action, true, duration);
            
            return {
                success: true,
                result,
                duration,
                executedAt: new Date()
            };
            
        } catch (error) {
            const duration = Date.now() - startTime;
            await this.updateActionStats(action, false, duration);
            
            return {
                success: false,
                error: error.message,
                duration,
                executedAt: new Date()
            };
        }
    }
    
    // Communication Action Implementations
    
    static async executeSendSms(action, context) {
        const { messageTemplate, phoneNumber } = action.config;
        const targetPhone = phoneNumber || context.contact?.phone;
        
        if (!targetPhone) {
            throw new Error('No phone number available for SMS');
        }
        
        // Template processing
        const message = this.processTemplate(messageTemplate, context);
        
        // Integration with Twilio SMS (if available)
        // For now, we'll log and return success
        console.log(`SMS Action: Sending to ${targetPhone}: ${message}`);
        
        return {
            type: 'sms_sent',
            recipient: targetPhone,
            message,
            provider: 'twilio'
        };
    }
    
    static async executeSendEmail(action, context) {
        const { emailTemplate, emailSubject } = action.config;
        const targetEmail = context.contact?.email;
        
        if (!targetEmail) {
            throw new Error('No email address available');
        }
        
        const subject = this.processTemplate(emailSubject, context);
        const body = this.processTemplate(emailTemplate, context);
        
        console.log(`Email Action: Sending to ${targetEmail}: ${subject}`);
        
        return {
            type: 'email_sent',
            recipient: targetEmail,
            subject,
            body
        };
    }
    
    static async executeMakeCall(action, context) {
        const { phoneNumber, voicemailScript } = action.config;
        const targetPhone = phoneNumber || context.contact?.phone;
        
        if (!targetPhone) {
            throw new Error('No phone number available for call');
        }
        
        console.log(`Call Action: Calling ${targetPhone}`);
        
        return {
            type: 'call_initiated',
            recipient: targetPhone,
            script: voicemailScript
        };
    }
    
    static async executeSendVoicemail(action, context) {
        const { voicemailScript, phoneNumber } = action.config;
        const targetPhone = phoneNumber || context.contact?.phone;
        
        if (!targetPhone) {
            throw new Error('No phone number available for voicemail');
        }
        
        const script = this.processTemplate(voicemailScript, context);
        
        console.log(`Voicemail Action: Sending to ${targetPhone}: ${script}`);
        
        return {
            type: 'voicemail_sent',
            recipient: targetPhone,
            script
        };
    }
    
    // Scheduling Action Implementations
    
    static async executeBookAppointment(action, context) {
        const { serviceType, duration, bufferTime } = action.config;
        
        if (!context.contact) {
            throw new Error('Contact required for appointment booking');
        }
        
        // Use existing scheduling service
        const company = await Company.findById(action.companyId);
        const schedulingResult = schedulingService.generateSchedulingResponse(
            company, 
            serviceType, 
            context.contact
        );
        
        if (!schedulingResult.canSchedule) {
            throw new Error(`Cannot schedule appointment: ${schedulingResult.response}`);
        }
        
        // Create service request on contact
        const serviceRequest = {
            serviceType,
            status: 'scheduled',
            requestedDate: context.requestedDate || new Date(),
            duration,
            notes: `Automatically scheduled via workflow`,
            source: 'action_system'
        };
        
        await Contact.findByIdAndUpdate(context.contact._id, {
            $push: { serviceRequests: serviceRequest }
        });
        
        return {
            type: 'appointment_booked',
            serviceType,
            contact: context.contact._id,
            schedulingResult
        };
    }
    
    static async executeSendCalendarInvite(action, context) {
        const { calendarId, duration } = action.config;
        
        console.log(`Calendar Invite Action: Creating invite for ${context.contact?.email}`);
        
        return {
            type: 'calendar_invite_sent',
            recipient: context.contact?.email,
            duration,
            calendarId
        };
    }
    
    // Contact Management Action Implementations
    
    static async executeCreateContact(action, context) {
        const { fieldMappings } = action.config;
        
        const contactData = {
            companyId: action.companyId,
            source: 'action_system',
            createdAt: new Date()
        };
        
        // Apply field mappings
        if (fieldMappings) {
            Object.keys(fieldMappings).forEach(key => {
                const value = this.resolveValue(fieldMappings[key], context);
                if (value !== undefined) {
                    contactData[key] = value;
                }
            });
        }
        
        const contact = new Contact(contactData);
        await contact.save();
        
        return {
            type: 'contact_created',
            contactId: contact._id,
            contactData
        };
    }
    
    static async executeUpdateContact(action, context) {
        if (!context.contact) {
            throw new Error('Contact required for update');
        }
        
        const { fieldMappings } = action.config;
        const updateData = {};
        
        if (fieldMappings) {
            Object.keys(fieldMappings).forEach(key => {
                const value = this.resolveValue(fieldMappings[key], context);
                if (value !== undefined) {
                    updateData[key] = value;
                }
            });
        }
        
        updateData.updatedAt = new Date();
        
        await Contact.findByIdAndUpdate(context.contact._id, updateData);
        
        return {
            type: 'contact_updated',
            contactId: context.contact._id,
            updateData
        };
    }
    
    static async executeAddTag(action, context) {
        if (!context.contact) {
            throw new Error('Contact required for tag addition');
        }
        
        const { tags } = action.config;
        
        await Contact.findByIdAndUpdate(context.contact._id, {
            $addToSet: { tags: { $each: tags } }
        });
        
        return {
            type: 'tags_added',
            contactId: context.contact._id,
            tags
        };
    }
    
    static async executeRemoveTag(action, context) {
        if (!context.contact) {
            throw new Error('Contact required for tag removal');
        }
        
        const { tags } = action.config;
        
        await Contact.findByIdAndUpdate(context.contact._id, {
            $pullAll: { tags }
        });
        
        return {
            type: 'tags_removed',
            contactId: context.contact._id,
            tags
        };
    }
    
    // Data & Intelligence Action Implementations
    
    static async executeExtractData(action, context) {
        const { extractionRules } = action.config;
        const sourceText = context.speechText || context.text || '';
        
        const extractedData = {};
        
        extractionRules.forEach(rule => {
            const regex = new RegExp(rule.pattern, 'i');
            const match = sourceText.match(regex);
            
            if (match) {
                let value = match[1] || match[0];
                
                // Type conversion
                switch (rule.type) {
                    case 'number':
                        value = parseFloat(value);
                        break;
                    case 'date':
                        value = new Date(value);
                        break;
                    case 'phone':
                        value = value.replace(/[^\d]/g, '');
                        break;
                }
                
                extractedData[rule.field] = value;
            }
        });
        
        return {
            type: 'data_extracted',
            extractedData,
            sourceText: sourceText.substring(0, 100) + '...'
        };
    }
    
    static async executeAiAnalysis(action, context) {
        // Placeholder for AI analysis integration
        const analysisType = action.config.analysisType || 'general';
        const text = context.speechText || context.text || '';
        
        console.log(`AI Analysis Action: Analyzing ${text.length} characters`);
        
        return {
            type: 'ai_analysis_completed',
            analysisType,
            insights: ['Analysis placeholder - integrate with AI service'],
            confidence: 0.85
        };
    }
    
    static async executeSentimentAnalysis(action, context) {
        const text = context.speechText || context.text || '';
        
        // Simple sentiment analysis (integrate with proper service)
        const positiveWords = ['good', 'great', 'excellent', 'happy', 'satisfied'];
        const negativeWords = ['bad', 'terrible', 'awful', 'angry', 'frustrated'];
        
        const words = text.toLowerCase().split(' ');
        const positive = words.filter(w => positiveWords.includes(w)).length;
        const negative = words.filter(w => negativeWords.includes(w)).length;
        
        let sentiment = 'neutral';
        if (positive > negative) sentiment = 'positive';
        if (negative > positive) sentiment = 'negative';
        
        return {
            type: 'sentiment_analyzed',
            sentiment,
            score: (positive - negative) / words.length,
            details: { positive, negative, total: words.length }
        };
    }
    
    // Integration Action Implementations
    
    static async executeWebhook(action, context) {
        const { webhookUrl, apiHeaders, apiPayload } = action.config;
        
        const payload = this.processObjectTemplate(apiPayload, context);
        
        console.log(`Webhook Action: Sending to ${webhookUrl}`);
        
        // Simulate webhook call
        return {
            type: 'webhook_sent',
            url: webhookUrl,
            payload,
            status: 'success'
        };
    }
    
    static async executeApiCall(action, context) {
        const { apiEndpoint, apiMethod, apiHeaders, apiPayload } = action.config;
        
        console.log(`API Call Action: ${apiMethod} ${apiEndpoint}`);
        
        return {
            type: 'api_call_completed',
            endpoint: apiEndpoint,
            method: apiMethod,
            status: 'success'
        };
    }
    
    // Service Management Action Implementations
    
    static async executeCreateServiceRequest(action, context) {
        if (!context.contact) {
            throw new Error('Contact required for service request');
        }
        
        const { serviceCategory, priority } = action.config;
        
        const serviceRequest = {
            serviceType: serviceCategory,
            status: 'pending',
            priority: priority || 'medium',
            requestedDate: new Date(),
            notes: context.notes || 'Created via action system',
            source: 'action_system'
        };
        
        await Contact.findByIdAndUpdate(context.contact._id, {
            $push: { serviceRequests: serviceRequest }
        });
        
        return {
            type: 'service_request_created',
            contactId: context.contact._id,
            serviceRequest
        };
    }
    
    // Workflow Control Action Implementations
    
    static async executeWait(action, context) {
        const { waitDuration } = action.config;
        
        console.log(`Wait Action: Waiting ${waitDuration} minutes`);
        
        return {
            type: 'wait_completed',
            duration: waitDuration,
            nextExecuteAt: new Date(Date.now() + waitDuration * 60000)
        };
    }
    
    static async executeCondition(action, context) {
        const { conditions } = action.config;
        
        const results = conditions.map(condition => {
            const value = this.resolveValue(condition.field, context);
            
            switch (condition.operator) {
                case 'equals':
                    return value === condition.value;
                case 'contains':
                    return String(value).toLowerCase().includes(String(condition.value).toLowerCase());
                case 'greater_than':
                    return Number(value) > Number(condition.value);
                case 'less_than':
                    return Number(value) < Number(condition.value);
                case 'exists':
                    return value !== undefined && value !== null;
                default:
                    return false;
            }
        });
        
        const passed = results.every(r => r);
        
        return {
            type: 'condition_evaluated',
            passed,
            results
        };
    }
    
    // Utility Methods
    
    static processTemplate(template, context) {
        if (!template) return '';
        
        return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, path) => {
            return this.resolveValue(path, context) || match;
        });
    }
    
    static processObjectTemplate(obj, context) {
        if (!obj) return {};
        
        const result = {};
        Object.keys(obj).forEach(key => {
            if (typeof obj[key] === 'string') {
                result[key] = this.processTemplate(obj[key], context);
            } else {
                result[key] = obj[key];
            }
        });
        
        return result;
    }
    
    static resolveValue(path, context) {
        return path.split('.').reduce((obj, key) => obj && obj[key], context);
    }
    
    static async updateActionStats(action, success, duration) {
        const updateData = {
            $inc: {
                'stats.totalExecutions': 1,
                ...(success ? { 'stats.successfulExecutions': 1 } : { 'stats.failedExecutions': 1 })
            },
            $set: {
                'stats.lastExecuted': new Date(),
                'stats.avgExecutionTime': duration // Simplified - should calculate proper average
            }
        };
        
        const Action = require('../models/Action');
        await Action.findByIdAndUpdate(action._id, updateData);
    }
}

module.exports = { ActionService };
