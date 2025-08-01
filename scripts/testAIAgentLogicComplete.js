/**
 * AI Agent Logic - End-to-End Test
 * Tests the complete save and load functionality
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/Company');

async function testAIAgentLogic() {
    console.log('🧪 AI AGENT LOGIC END-TO-END TEST');
    console.log('=====================================');
    
    try {
        // Connect to database
        console.log('📡 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');
        
        // Find the first company or create a test one
        let company = await Company.findOne();
        if (!company) {
            console.log('📝 Creating test company...');
            company = new Company({
                companyName: 'Test Company for AI Agent Logic',
                email: 'test@aiagentlogic.com',
                twilioConfig: {
                    phoneNumber: '+15551234567'
                }
            });
            await company.save();
            console.log('✅ Test company created:', company._id);
        } else {
            console.log('✅ Using existing company:', company._id, company.companyName);
        }
        
        // Test saving AI Agent Logic data
        console.log('\n💾 Testing AI Agent Logic save...');
        const testData = {
            enabled: true,
            answerPriorityFlow: [
                {
                    id: 'company_knowledge',
                    name: 'Company Knowledge Base',
                    description: 'Company-specific Q&A and internal documentation',
                    active: true,
                    primary: true,
                    priority: 1,
                    icon: 'building',
                    category: 'primary',
                    confidenceThreshold: 0.8,
                    intelligenceLevel: 'high',
                    performance: {
                        successRate: 0.92,
                        avgConfidence: 0.87,
                        usageCount: 1247
                    }
                },
                {
                    id: 'trade_categories',
                    name: 'Trade Categories Q&A',
                    description: 'Industry-specific questions and answers',
                    active: true,
                    primary: false,
                    priority: 2,
                    icon: 'industry',
                    category: 'industry',
                    confidenceThreshold: 0.75,
                    intelligenceLevel: 'medium',
                    performance: {
                        successRate: 0.84,
                        avgConfidence: 0.79,
                        usageCount: 856
                    }
                }
            ],
            agentPersonality: {
                voiceTone: 'friendly',
                speechPace: 'moderate'
            },
            behaviorControls: {
                allowBargeIn: true,
                acknowledgeEmotion: true,
                useEmails: false
            },
            responseCategories: {
                core: {
                    greeting: 'Hello! Thank you for calling {{companyName}}. How can I help you today?',
                    farewell: 'Thank you for calling {{companyName}}. Have a great day!',
                    transfer: 'Let me transfer you to someone who can better assist you.',
                    serviceUnavailable: 'I apologize, but that service is currently unavailable.',
                    hold: 'Please hold while I look that up for you.',
                    businessHours: 'Our business hours are Monday through Friday, 9 AM to 5 PM.'
                },
                advanced: {
                    emergency: 'This appears to be an emergency. Let me connect you with our emergency line immediately.',
                    afterHours: 'Thank you for calling. We are currently closed but will return your call first thing tomorrow.',
                    appointmentConfirmation: 'I have confirmed your appointment for {{appointmentTime}}.',
                    schedulingConflict: 'I see there may be a scheduling conflict. Let me check our availability.'
                },
                emotional: {
                    frustrated: 'I understand your frustration, and I want to help resolve this for you.',
                    appreciative: 'You\'re very welcome! I\'m glad I could help.',
                    problemResolution: 'Let me work with you to find the best solution for this issue.',
                    qualityAssurance: 'We value your feedback and will use it to improve our service.'
                }
            },
            lastUpdated: new Date(),
            version: 1
        };
        
        // Save the data
        company.aiAgentLogic = testData;
        await company.save();
        console.log('✅ AI Agent Logic data saved successfully');
        
        // Verify the data was saved
        console.log('\n🔍 Verifying saved data...');
        const verifyCompany = await Company.findById(company._id);
        const savedData = verifyCompany.aiAgentLogic;
        
        console.log('✅ Data verification results:');
        console.log('  - Enabled:', savedData.enabled);
        console.log('  - Answer Priority Flow items:', savedData.answerPriorityFlow?.length || 0);
        console.log('  - Voice Tone:', savedData.agentPersonality?.voiceTone);
        console.log('  - Speech Pace:', savedData.agentPersonality?.speechPace);
        console.log('  - Allow Barge-In:', savedData.behaviorControls?.allowBargeIn);
        console.log('  - Acknowledge Emotion:', savedData.behaviorControls?.acknowledgeEmotion);
        console.log('  - Use Emails:', savedData.behaviorControls?.useEmails);
        console.log('  - Core Responses:', Object.keys(savedData.responseCategories?.core || {}).length);
        console.log('  - Advanced Responses:', Object.keys(savedData.responseCategories?.advanced || {}).length);
        console.log('  - Emotional Responses:', Object.keys(savedData.responseCategories?.emotional || {}).length);
        console.log('  - Last Updated:', savedData.lastUpdated);
        console.log('  - Version:', savedData.version);
        
        // Test data integrity
        console.log('\n🧪 Testing data integrity...');
        let allTestsPassed = true;
        
        if (!savedData.enabled) {
            console.log('❌ Enabled flag not saved correctly');
            allTestsPassed = false;
        }
        
        if (savedData.answerPriorityFlow?.length !== 2) {
            console.log('❌ Answer Priority Flow not saved correctly');
            allTestsPassed = false;
        }
        
        if (savedData.agentPersonality?.voiceTone !== 'friendly') {
            console.log('❌ Voice tone not saved correctly');
            allTestsPassed = false;
        }
        
        if (!savedData.behaviorControls?.allowBargeIn) {
            console.log('❌ Behavior controls not saved correctly');
            allTestsPassed = false;
        }
        
        if (!savedData.responseCategories?.core?.greeting) {
            console.log('❌ Response categories not saved correctly');
            allTestsPassed = false;
        }
        
        if (allTestsPassed) {
            console.log('✅ ALL TESTS PASSED! AI Agent Logic system is working correctly.');
        } else {
            console.log('❌ Some tests failed. Check the data integrity issues above.');
        }
        
        console.log('\n🎯 COMPANY ID FOR TESTING:', company._id);
        console.log('📋 You can test the UI with: /ai-agent-logic.html?id=' + company._id);
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    } finally {
        await mongoose.disconnect();
        console.log('\n📡 Disconnected from MongoDB');
    }
}

// Run the test
testAIAgentLogic().then(() => {
    console.log('\n🏁 Test completed');
    process.exit(0);
}).catch(error => {
    console.error('❌ Test suite failed:', error);
    process.exit(1);
});
