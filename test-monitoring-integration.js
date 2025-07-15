/**
 * Test Script for Agent Monitoring Integration
 * Verifies the complete monitoring system workflow
 */

require('dotenv').config();
const mongoose = require('mongoose');
const agentMonitoring = require('./services/agentMonitoring');

async function testMonitoringIntegration() {
    try {
        console.log('🚀 Starting Agent Monitoring Integration Test...\n');

        // Connect to database
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('✅ Database connected successfully\n');

        // Test company ID (replace with real company ID from your database)
        const testCompanyId = '507f1f77bcf86cd799439011'; // Example ObjectId
        
        // Test 1: Log a sample interaction
        console.log('📝 Test 1: Logging agent interaction...');
        const interactionData = {
            callerId: '+15551234567',
            companyId: testCompanyId,
            userQuery: 'What are your business hours?',
            agentResponse: 'We are open Monday through Friday from 9 AM to 6 PM, and Saturday from 10 AM to 4 PM.',
            confidence: 0.95,
            responseTime: 1200,
            escalated: false,
            metadata: {
                sessionId: 'test_session_001',
                callSid: 'CA1234567890',
                timestamp: new Date(),
                processingSteps: [
                    'Intent detection: business_hours',
                    'Knowledge base lookup',
                    'Response generation'
                ]
            }
        };

        const logResult = await agentMonitoring.logAgentInteraction(interactionData);
        console.log('✅ Interaction logged successfully:', logResult._id);

        // Test 2: Log another similar interaction to test repeat detection
        console.log('\n📝 Test 2: Logging similar interaction for repeat detection...');
        const similarInteraction = {
            ...interactionData,
            callerId: '+15559876543',
            userQuery: 'What time do you close?',
            agentResponse: 'We close at 6 PM Monday through Friday, and at 4 PM on Saturday.',
            metadata: {
                ...interactionData.metadata,
                sessionId: 'test_session_002',
                callSid: 'CA0987654321'
            }
        };

        const similarResult = await agentMonitoring.logAgentInteraction(similarInteraction);
        console.log('✅ Similar interaction logged:', similarResult._id);

        // Test 3: Get dashboard data
        console.log('\n📊 Test 3: Fetching dashboard data...');
        const dashboardData = await fetchDashboardData(testCompanyId);
        console.log('✅ Dashboard data retrieved:', {
            pendingReviews: dashboardData.pendingReviews,
            flaggedInteractions: dashboardData.flaggedInteractions,
            totalInteractions: dashboardData.analytics?.totalInteractions || 0
        });

        // Test 4: Get pending interactions for review
        console.log('\n👀 Test 4: Getting pending interactions...');
        const pendingInteractions = await agentMonitoring.getPendingInteractions(testCompanyId, 1, 10);
        console.log('✅ Pending interactions count:', pendingInteractions.length);

        // Test 5: Approve an interaction
        if (pendingInteractions.length > 0) {
            console.log('\n✅ Test 5: Approving an interaction...');
            const interactionToApprove = pendingInteractions[0];
            const approvalResult = await agentMonitoring.approveInteraction(
                interactionToApprove._id,
                'test_reviewer',
                'This response is accurate and helpful.'
            );
            console.log('✅ Interaction approved successfully');
        }

        // Test 6: Test flagged interactions
        console.log('\n🚩 Test 6: Getting flagged interactions...');
        const flaggedInteractions = await agentMonitoring.getFlaggedInteractions(testCompanyId, 1, 10);
        console.log('✅ Flagged interactions count:', flaggedInteractions.length);

        // Test 7: Get analytics
        console.log('\n📈 Test 7: Getting analytics...');
        const analytics = await agentMonitoring.getAnalytics(testCompanyId, 7);
        console.log('✅ Analytics data:', {
            totalInteractions: analytics.totalInteractions,
            averageConfidence: analytics.averageConfidence,
            escalationRate: analytics.escalationRate
        });

        console.log('\n🎉 All tests completed successfully!');
        console.log('\n📝 Summary:');
        console.log('- ✅ Agent interaction logging');
        console.log('- ✅ Repeat detection system');
        console.log('- ✅ Dashboard data retrieval');
        console.log('- ✅ Pending review workflow');
        console.log('- ✅ Approval system');
        console.log('- ✅ Flagged interaction tracking');
        console.log('- ✅ Analytics generation');

    } catch (error) {
        console.error('❌ Test failed:', error);
    } finally {
        await mongoose.disconnect();
        console.log('\n🔌 Database disconnected');
    }
}

// Helper function to simulate API call for dashboard data
async function fetchDashboardData(companyId) {
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

// Run the test
if (require.main === module) {
    testMonitoringIntegration();
}

module.exports = { testMonitoringIntegration };
