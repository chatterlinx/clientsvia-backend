// scripts/createTestWorkflow.js
// Script to create a test workflow for demonstration

const mongoose = require('mongoose');
const Workflow = require('../models/Workflow');
const Action = require('../models/Action');

async function createTestWorkflow() {
    try {
        // Connect to database
        const dbUrl = process.env.MONGODB_URI || 'mongodb://localhost:27017/clientsvia';
        await mongoose.connect(dbUrl);
        console.log('Connected to database');

        // Test company ID (Penguin Air)
        const companyId = '6770d1234567890123456789';

        // Create a test action first
        const testAction = new Action({
            name: 'Send Welcome Email',
            type: 'email',
            config: {
                to: '{{customer.email}}',
                subject: 'Welcome to our service!',
                template: 'welcome',
                body: 'Thank you for choosing our service. We look forward to working with you!'
            },
            timeout: 30000, // 30 seconds
            retry: {
                maxAttempts: 3,
                delay: 5000
            }
        });

        await testAction.save();
        console.log('Test action created:', testAction._id);

        // Create a test workflow
        const testWorkflow = new Workflow({
            companyId: companyId,
            name: 'Customer Onboarding',
            description: 'Automated workflow to onboard new customers',
            trigger: {
                type: 'manual',
                config: {}
            },
            steps: [
                {
                    stepId: 'step1',
                    actionId: testAction._id,
                    condition: null,
                    timeout: 30000,
                    onSuccess: 'step2',
                    onFailure: 'end',
                    onTimeout: 'retry'
                }
            ],
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date()
        });

        await testWorkflow.save();
        console.log('Test workflow created:', testWorkflow._id);

        console.log('Test workflow setup complete!');
        
    } catch (error) {
        console.error('Error creating test workflow:', error);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected from database');
        process.exit(0);
    }
}

if (require.main === module) {
    createTestWorkflow();
}

module.exports = { createTestWorkflow };
