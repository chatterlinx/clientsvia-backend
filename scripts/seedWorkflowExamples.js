// scripts/seedWorkflowExamples.js
// Seed Example Workflows and Actions for Automation Platform Demo

const mongoose = require('mongoose');
require('dotenv').config();

const Company = require('../models/Company');
const Action = require('../models/Action');
const Workflow = require('../models/Workflow');

async function seedWorkflowExamples() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');
        
        // Find first company for demo
        const company = await Company.findOne({});
        if (!company) {
            console.log('No company found. Please create a company first.');
            return;
        }
        
        console.log(`Seeding workflows for company: ${company.companyName}`);
        
        // Clear existing demo data
        await Action.deleteMany({ companyId: company._id, tags: 'demo' });
        await Workflow.deleteMany({ companyId: company._id, tags: 'demo' });
        
        // Create example actions
        const actions = await createExampleActions(company._id);
        console.log(`Created ${actions.length} example actions`);
        
        // Create example workflows
        const workflows = await createExampleWorkflows(company._id, actions);
        console.log(`Created ${workflows.length} example workflows`);
        
        console.log('✅ Workflow examples seeded successfully');
        
    } catch (error) {
        console.error('Error seeding workflow examples:', error);
    } finally {
        await mongoose.disconnect();
    }
}

async function createExampleActions(companyId) {
    const actions = [];
    
    // 1. Send Welcome SMS
    const welcomeSmsAction = new Action({
        name: 'Send Welcome SMS',
        description: 'Send welcoming SMS to new contacts',
        type: 'send_sms',
        category: 'communication',
        config: {
            messageTemplate: 'Hi {{contact.name}}! Thank you for calling {{company.name}}. We received your request and will follow up within 24 hours. Reply STOP to opt out.',
            fromNumber: '{{company.twilioPhoneNumber}}'
        },
        companyId,
        tags: ['demo', 'welcome', 'sms'],
        isActive: true
    });
    await welcomeSmsAction.save();
    actions.push(welcomeSmsAction);
    
    // 2. Create Service Request Follow-up Email
    const followUpEmailAction = new Action({
        name: 'Service Request Follow-up Email',
        description: 'Send follow-up email after service request',
        type: 'send_email',
        category: 'communication',
        config: {
            subject: 'Your {{serviceType}} Request - {{company.name}}',
            messageTemplate: `Hello {{contact.name}},

Thank you for contacting {{company.name}} regarding your {{serviceType}} needs.

We've received your request and our team will reach out within 24 hours to schedule an appointment.

Request Details:
- Service: {{serviceType}}
- Urgency: {{urgency}}
- Requested Date: {{preferredDate}}

If you have any questions, please call us at {{company.phone}}.

Best regards,
The {{company.name}} Team`,
            fromEmail: '{{company.email}}'
        },
        companyId,
        tags: ['demo', 'follow-up', 'email'],
        isActive: true
    });
    await followUpEmailAction.save();
    actions.push(followUpEmailAction);
    
    // 3. Update Contact Status
    const updateContactAction = new Action({
        name: 'Mark Contact as Qualified Lead',
        description: 'Update contact status to qualified when service request created',
        type: 'update_contact',
        category: 'contact_management',
        config: {
            updates: {
                status: 'qualified_lead',
                tags: ['service_request', 'needs_follow_up']
            }
        },
        companyId,
        tags: ['demo', 'contact', 'qualification'],
        isActive: true
    });
    await updateContactAction.save();
    actions.push(updateContactAction);
    
    // 4. Emergency Alert Webhook
    const emergencyWebhookAction = new Action({
        name: 'Emergency Alert Webhook',
        description: 'Send immediate alert for emergency calls',
        type: 'webhook',
        category: 'integrations',
        config: {
            url: 'https://hooks.zapier.com/hooks/catch/your-emergency-webhook/',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer your-token'
            },
            body: {
                type: 'emergency_alert',
                contact: {
                    name: '{{contact.name}}',
                    phone: '{{contact.phone}}',
                    location: '{{contact.address}}'
                },
                emergency: {
                    type: '{{emergencyType}}',
                    description: '{{emergencyDescription}}',
                    priority: 'HIGH'
                },
                company: '{{company.name}}',
                timestamp: '{{timestamp}}'
            }
        },
        companyId,
        tags: ['demo', 'emergency', 'webhook'],
        isActive: true
    });
    await emergencyWebhookAction.save();
    actions.push(emergencyWebhookAction);
    
    // 5. Schedule Appointment Action
    const scheduleAppointmentAction = new Action({
        name: 'Auto-Schedule Consultation',
        description: 'Automatically schedule consultation appointment',
        type: 'book_appointment',
        category: 'scheduling',
        config: {
            serviceType: '{{serviceType}}',
            duration: 60,
            preferredTimeSlots: ['9:00 AM', '1:00 PM', '3:00 PM'],
            autoConfirm: false,
            bufferTime: 15
        },
        companyId,
        tags: ['demo', 'scheduling', 'appointment'],
        isActive: true
    });
    await scheduleAppointmentAction.save();
    actions.push(scheduleAppointmentAction);
    
    // 6. Add Service Request Tag
    const addTagAction = new Action({
        name: 'Tag High-Value Lead',
        description: 'Add high-value tag for expensive service requests',
        type: 'add_tag',
        category: 'contact_management',
        config: {
            tags: ['high-value', 'priority-follow-up']
        },
        conditions: [
            {
                field: 'serviceRequest.estimatedValue',
                operator: 'greater_than',
                value: 1000
            }
        ],
        companyId,
        tags: ['demo', 'tagging', 'high-value'],
        isActive: true
    });
    await addTagAction.save();
    actions.push(addTagAction);
    
    return actions;
}

async function createExampleWorkflows(companyId, actions) {
    const workflows = [];
    
    // Find actions by name for easy reference
    const findAction = (name) => actions.find(a => a.name === name);
    
    // 1. New Lead Welcome Workflow
    const newLeadWorkflow = new Workflow({
        name: 'New Lead Welcome Sequence',
        description: 'Automated welcome sequence for new contacts calling in',
        category: 'lead_nurturing',
        trigger: {
            event: 'call_received',
            conditions: [
                {
                    field: 'contact.isNew',
                    operator: 'equals',
                    value: true
                }
            ]
        },
        steps: [
            {
                stepId: 'step_1',
                name: 'Mark as Qualified Lead',
                actionId: findAction('Mark Contact as Qualified Lead')._id,
                config: {},
                conditions: []
            },
            {
                stepId: 'step_2',
                name: 'Send Welcome SMS',
                actionId: findAction('Send Welcome SMS')._id,
                config: {},
                conditions: [],
                flowControl: {
                    onSuccess: { action: 'continue' },
                    onFailure: { action: 'continue' }
                }
            }
        ],
        variables: {
            welcomeDelay: 300000 // 5 minutes
        },
        settings: {
            maxExecutionTime: 600000,
            retryPolicy: {
                maxRetries: 2,
                retryDelay: 5000
            }
        },
        companyId,
        tags: ['demo', 'new-lead', 'welcome'],
        isActive: true
    });
    await newLeadWorkflow.save();
    workflows.push(newLeadWorkflow);
    
    // 2. Service Request Follow-up Workflow
    const serviceRequestWorkflow = new Workflow({
        name: 'Service Request Follow-up',
        description: 'Automated follow-up for service requests',
        category: 'customer_service',
        trigger: {
            event: 'service_request_created',
            conditions: []
        },
        steps: [
            {
                stepId: 'step_1',
                name: 'Tag High-Value Leads',
                actionId: findAction('Tag High-Value Lead')._id,
                config: {},
                conditions: [
                    {
                        field: 'serviceRequest.estimatedValue',
                        operator: 'greater_than',
                        value: 1000
                    }
                ]
            },
            {
                stepId: 'step_2',
                name: 'Send Follow-up Email',
                actionId: findAction('Service Request Follow-up Email')._id,
                config: {
                    delay: 1800000 // 30 minutes delay
                },
                conditions: []
            },
            {
                stepId: 'step_3',
                name: 'Schedule Consultation',
                actionId: findAction('Auto-Schedule Consultation')._id,
                config: {},
                conditions: [
                    {
                        field: 'serviceRequest.urgency',
                        operator: 'not_equals',
                        value: 'high'
                    }
                ]
            }
        ],
        variables: {
            followUpDelay: 1800000,
            maxFollowUps: 3
        },
        companyId,
        tags: ['demo', 'service-request', 'follow-up'],
        isActive: true
    });
    await serviceRequestWorkflow.save();
    workflows.push(serviceRequestWorkflow);
    
    // 3. Emergency Response Workflow
    const emergencyWorkflow = new Workflow({
        name: 'Emergency Response Protocol',
        description: 'Immediate response for emergency service calls',
        category: 'emergency_response',
        trigger: {
            event: 'emergency_service_request',
            conditions: [
                {
                    field: 'serviceRequest.urgency',
                    operator: 'equals',
                    value: 'high'
                }
            ]
        },
        steps: [
            {
                stepId: 'step_1',
                name: 'Send Emergency Alert',
                actionId: findAction('Emergency Alert Webhook')._id,
                config: {},
                conditions: []
            },
            {
                stepId: 'step_2',
                name: 'Priority Contact Update',
                actionId: findAction('Mark Contact as Qualified Lead')._id,
                config: {
                    updates: {
                        status: 'emergency_priority',
                        tags: ['emergency', 'immediate_attention']
                    }
                },
                conditions: []
            }
        ],
        variables: {
            alertTimeout: 300000 // 5 minutes
        },
        settings: {
            maxExecutionTime: 120000, // 2 minutes max
            retryPolicy: {
                maxRetries: 0 // No retries for emergency
            }
        },
        companyId,
        tags: ['demo', 'emergency', 'priority'],
        isActive: true
    });
    await emergencyWorkflow.save();
    workflows.push(emergencyWorkflow);
    
    // 4. Call Completion Follow-up
    const callCompletionWorkflow = new Workflow({
        name: 'Call Completion Follow-up',
        description: 'Follow-up actions after successful calls',
        category: 'follow_up',
        trigger: {
            event: 'call_completed',
            conditions: [
                {
                    field: 'call.outcome',
                    operator: 'equals',
                    value: 'completed_with_service_request'
                }
            ]
        },
        steps: [
            {
                stepId: 'step_1',
                name: 'Send Thank You SMS',
                actionId: findAction('Send Welcome SMS')._id,
                config: {
                    messageTemplate: 'Thank you for calling {{company.name}}! We\'ve logged your {{serviceType}} request and will follow up within 24 hours.'
                },
                conditions: [],
                flowControl: {
                    onSuccess: { action: 'wait', timeout: 3600000 }, // Wait 1 hour
                    onFailure: { action: 'continue' }
                }
            },
            {
                stepId: 'step_2',
                name: 'Send Detailed Follow-up Email',
                actionId: findAction('Service Request Follow-up Email')._id,
                config: {},
                conditions: []
            }
        ],
        companyId,
        tags: ['demo', 'call-completion', 'follow-up'],
        isActive: true
    });
    await callCompletionWorkflow.save();
    workflows.push(callCompletionWorkflow);
    
    return workflows;
}

// Run the seeding
if (require.main === module) {
    seedWorkflowExamples();
}

module.exports = { seedWorkflowExamples };
