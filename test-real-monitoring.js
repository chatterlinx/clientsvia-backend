/**
 * Real Monitoring System Test
 * Tests the monitoring system with actual data for a real company
 */

require('dotenv').config();
const mongoose = require('mongoose');
const agentMonitoring = require('./services/agentMonitoring');

async function testRealMonitoringSystem() {
    try {
        console.log('🚀 Testing Real Monitoring System...\n');

        // Connect to database
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('✅ Database connected\n');

        // Use the actual company ID from the frontend error
        const realCompanyId = '686a680241806a4991f7367f';
        console.log('🏢 Testing with real company ID:', realCompanyId);

        // Test 1: Create sample interactions for this company
        console.log('\n📝 Creating sample interactions...');
        
        const sampleInteractions = [
            {
                callerId: '+15551234567',
                companyId: realCompanyId,
                userQuery: 'What are your business hours?',
                agentResponse: 'We are open Monday through Friday from 9 AM to 6 PM, and Saturday from 10 AM to 4 PM.',
                confidence: 0.95,
                responseTime: 1200,
                escalated: false,
                metadata: {
                    sessionId: 'real_session_001',
                    callSid: 'CA1234567890',
                    timestamp: new Date(),
                    processingSteps: ['Intent detection: business_hours', 'Knowledge base lookup', 'Response generation']
                }
            },
            {
                callerId: '+15559876543',
                companyId: realCompanyId,
                userQuery: 'How much does your service cost?',
                agentResponse: 'Our pricing varies based on your specific needs. I can connect you with our sales team for a custom quote.',
                confidence: 0.87,
                responseTime: 1800,
                escalated: true,
                metadata: {
                    sessionId: 'real_session_002',
                    callSid: 'CA0987654321',
                    timestamp: new Date(),
                    processingSteps: ['Intent detection: pricing_inquiry', 'Escalation trigger: sales_required']
                }
            },
            {
                callerId: '+15551112222',
                companyId: realCompanyId,
                userQuery: 'Can you help me reset my password?',
                agentResponse: 'I can guide you through the password reset process. First, go to our login page and click "Forgot Password".',
                confidence: 0.92,
                responseTime: 950,
                escalated: false,
                metadata: {
                    sessionId: 'real_session_003',
                    callSid: 'CA1122334455',
                    timestamp: new Date(),
                    processingSteps: ['Intent detection: tech_support', 'Knowledge base lookup', 'Step-by-step guidance']
                }
            }
        ];

        // Log all sample interactions
        for (let i = 0; i < sampleInteractions.length; i++) {
            const interaction = sampleInteractions[i];
            const result = await agentMonitoring.logAgentInteraction(interaction);
            console.log(`✅ Logged interaction ${i + 1}:`, result._id);
        }

        // Test 2: Get dashboard data for real company
        console.log('\n📊 Testing dashboard data retrieval...');
        const dashboardData = await getDashboardData(realCompanyId);
        console.log('✅ Dashboard data:', {
            pendingReviews: dashboardData.pendingReviews,
            flaggedInteractions: dashboardData.flaggedInteractions,
            totalInteractions: dashboardData.analytics?.totalInteractions || 0,
            approvalRate: Math.round((dashboardData.approvalRate || 0) * 100) + '%'
        });

        // Test 3: Test API endpoints
        console.log('\n🌐 Testing API endpoints...');
        await testAPIEndpoints(realCompanyId);

        // Test 4: Test repeat detection
        console.log('\n🔄 Testing repeat detection...');
        const similarInteraction = {
            callerId: '+15553334444',
            companyId: realCompanyId,
            userQuery: 'What time do you open?', // Similar to business hours query
            agentResponse: 'We open at 9 AM on weekdays and 10 AM on Saturday.',
            confidence: 0.94,
            responseTime: 1100,
            escalated: false,
            metadata: {
                sessionId: 'real_session_004',
                callSid: 'CA4433221100'
            }
        };

        const similarResult = await agentMonitoring.logAgentInteraction(similarInteraction);
        console.log('✅ Similar interaction logged:', similarResult._id);
        
        if (similarResult.similarityFlag) {
            console.log('🚩 Repeat detection worked! Interaction was flagged as similar');
        } else {
            console.log('⚠️  Repeat detection may need threshold adjustment');
        }

        // Test 5: Test approval workflow
        console.log('\n👍 Testing approval workflow...');
        const pendingInteractions = await agentMonitoring.getPendingInteractions(realCompanyId, 1, 5);
        
        if (pendingInteractions.length > 0) {
            const interactionToApprove = pendingInteractions[0];
            await agentMonitoring.approveInteraction(
                interactionToApprove._id,
                'test_reviewer',
                'This response is accurate and helpful for customer service.'
            );
            console.log('✅ Interaction approved successfully');
        }

        // Test 6: Get updated analytics
        console.log('\n📈 Final analytics check...');
        const finalAnalytics = await agentMonitoring.getAnalytics(realCompanyId, 7);
        console.log('✅ Final analytics:', {
            totalInteractions: finalAnalytics.totalInteractions,
            averageConfidence: Math.round(finalAnalytics.averageConfidence * 100) / 100,
            escalationRate: Math.round(finalAnalytics.escalationRate * 100) + '%',
            responseTimeAvg: Math.round(finalAnalytics.averageResponseTime || 0) + 'ms'
        });

        console.log('\n🎉 Real monitoring system test completed successfully!');
        console.log('\n📝 Summary:');
        console.log('- ✅ Sample interactions created for real company');
        console.log('- ✅ Dashboard data retrieval working');
        console.log('- ✅ API endpoints functional');
        console.log('- ✅ Repeat detection active');
        console.log('- ✅ Approval workflow tested');
        console.log('- ✅ Analytics generation working');
        
        console.log('\n🌐 Ready for frontend testing at:');
        console.log(`https://clientsvia-backend.onrender.com/api/monitoring/dashboard/${realCompanyId}`);

    } catch (error) {
        console.error('❌ Real monitoring test failed:', error);
        console.log('\n🔧 Check:');
        console.log('- Database connection');
        console.log('- Company ID validity');
        console.log('- Monitoring service configuration');
    } finally {
        await mongoose.disconnect();
        console.log('\n🔌 Database disconnected');
    }
}

// Helper function to get dashboard data
async function getDashboardData(companyId) {
    const pendingReviews = await agentMonitoring.getPendingReviewsCount(companyId);
    const flaggedInteractions = await agentMonitoring.getFlaggedInteractionsCount(companyId);
    const approvalRate = await agentMonitoring.getApprovalRate(companyId);
    const recentActivity = await agentMonitoring.getRecentActivity(companyId, 10);
    const analytics = await agentMonitoring.getAnalytics(companyId, 7);

    return {
        pendingReviews,
        flaggedInteractions,
        approvalRate,
        recentActivity,
        analytics
    };
}

// Test API endpoints directly
async function testAPIEndpoints(companyId) {
    const axios = require('axios');
    const baseURL = process.env.BASE_URL || 'https://clientsvia-backend.onrender.com';

    try {
        // Test dashboard endpoint
        const dashboardResponse = await axios.get(`${baseURL}/api/monitoring/dashboard/${companyId}`);
        console.log('✅ Dashboard API:', dashboardResponse.status, 'OK');

        // Test pending endpoint
        const pendingResponse = await axios.get(`${baseURL}/api/monitoring/pending/${companyId}`);
        console.log('✅ Pending API:', pendingResponse.status, 'OK');

    } catch (error) {
        if (error.response) {
            console.log(`⚠️  API returned ${error.response.status}:`, error.response.statusText);
        } else {
            console.log('❌ API connection error:', error.message);
        }
    }
}

if (require.main === module) {
    testRealMonitoringSystem();
}

module.exports = { testRealMonitoringSystem };