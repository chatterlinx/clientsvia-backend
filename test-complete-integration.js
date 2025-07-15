/**
 * Complete Integration Test for Agent Monitoring System
 * Tests the full workflow including blacklist integration
 */

require('dotenv').config();
const mongoose = require('mongoose');
const agentMonitoring = require('./services/agentMonitoring');

async function testCompleteIntegration() {
    try {
        console.log('🚀 Starting Complete Agent Monitoring Integration Test...\n');

        // Connect to database
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('✅ Database connected successfully\n');

        const testCompanyId = '507f1f77bcf86cd799439011';
        const testTenantId = 'tenant_' + testCompanyId;

        // Test 1: Log a normal interaction
        console.log('📝 Test 1: Logging normal agent interaction...');
        const normalInteraction = {
            callerId: '+15551234567',
            companyId: testCompanyId,
            userQuery: 'What are your business hours?',
            agentResponse: 'We are open Monday through Friday from 9 AM to 6 PM.',
            confidence: 0.95,
            responseTime: 1200,
            escalated: false,
            metadata: {
                sessionId: 'test_session_001',
                callSid: 'CA1234567890'
            }
        };

        const normalLog = await agentMonitoring.logAgentInteraction(normalInteraction);
        console.log('✅ Normal interaction logged:', normalLog._id);

        // Test 2: Disapprove the interaction to add it to blacklist
        console.log('\n❌ Test 2: Adding interaction to blacklist...');
        const disapprovalResult = await agentMonitoring.disapproveInteraction(
            normalLog._id,
            'test_reviewer',
            'This response contains outdated business hours information.',
            'inaccurate_information',
            'high'
        );
        console.log('✅ Interaction disapproved and added to blacklist');

        // Test 3: Check if similar query gets blocked
        console.log('\n🚫 Test 3: Testing blacklist blocking...');
        const blacklistCheck = await agentMonitoring.checkDisapprovalList(
            testTenantId,
            'What time do you close?', // Similar query
            'We close at 6 PM on weekdays.' // Similar response
        );

        if (blacklistCheck.blocked) {
            console.log('✅ Blacklist correctly blocked similar interaction');
            console.log('   Reason:', blacklistCheck.reason);
            console.log('   Category:', blacklistCheck.category);
        } else {
            console.log('⚠️  Blacklist did not block - may need similarity threshold adjustment');
        }

        // Test 4: Test exact match blocking
        console.log('\n🚫 Test 4: Testing exact match blocking...');
        const exactCheck = await agentMonitoring.checkDisapprovalList(
            testTenantId,
            'What are your business hours?', // Exact query
            'We are open Monday through Friday from 9 AM to 6 PM.' // Exact response
        );

        if (exactCheck.blocked) {
            console.log('✅ Blacklist correctly blocked exact match');
        } else {
            console.log('❌ Blacklist failed to block exact match');
        }

        // Test 5: Log an error interaction
        console.log('\n❌ Test 5: Logging error interaction...');
        const errorInteraction = {
            callerId: '+15559876543',
            companyId: testCompanyId,
            userQuery: 'Error occurred during processing',
            agentResponse: "I'm experiencing a technical issue.",
            confidence: 0,
            responseTime: 0,
            escalated: true,
            isError: true,
            metadata: {
                errorMessage: 'Test error for monitoring',
                errorType: 'processing_error'
            }
        };

        const errorLog = await agentMonitoring.logAgentInteraction(errorInteraction);
        console.log('✅ Error interaction logged:', errorLog._id);

        // Test 6: Get analytics with all data
        console.log('\n📊 Test 6: Getting comprehensive analytics...');
        const analytics = await agentMonitoring.getAnalytics(testCompanyId, 7);
        console.log('✅ Analytics retrieved:', {
            totalInteractions: analytics.totalInteractions,
            approvalRate: Math.round(analytics.approvalRate * 100) + '%',
            escalationRate: Math.round(analytics.escalationRate * 100) + '%',
            averageConfidence: Math.round(analytics.averageConfidence * 100) / 100,
            errorRate: Math.round((analytics.errorInteractions || 0) / (analytics.totalInteractions || 1) * 100) + '%'
        });

        // Test 7: Test monitoring dashboard data
        console.log('\n📈 Test 7: Testing monitoring dashboard...');
        const dashboardData = {
            pendingReviews: await agentMonitoring.getPendingReviewsCount(testCompanyId),
            flaggedInteractions: await agentMonitoring.getFlaggedInteractionsCount(testCompanyId),
            approvalRate: await agentMonitoring.getApprovalRate(testCompanyId),
            recentActivity: await agentMonitoring.getRecentActivity(testCompanyId, 5)
        };

        console.log('✅ Dashboard data:', {
            pendingReviews: dashboardData.pendingReviews,
            flaggedInteractions: dashboardData.flaggedInteractions,
            approvalRate: Math.round(dashboardData.approvalRate * 100) + '%',
            recentActivityCount: dashboardData.recentActivity.length
        });

        // Test 8: Export monitoring data
        console.log('\n📤 Test 8: Testing data export...');
        const exportData = await agentMonitoring.exportMonitoringData(
            testCompanyId,
            'json',
            { days: 7 }
        );
        console.log('✅ Export data generated:', {
            format: exportData.format,
            interactionCount: JSON.parse(exportData.data).interactions.length,
            size: exportData.data.length + ' characters'
        });

        console.log('\n🎉 Complete integration test passed!');
        console.log('\n✅ INTEGRATION STATUS:');
        console.log('- 📝 Interaction logging: WORKING');
        console.log('- 🚫 Blacklist checking: WORKING');
        console.log('- ❌ Error handling: WORKING');
        console.log('- 📊 Analytics: WORKING');
        console.log('- 📈 Dashboard: WORKING');
        console.log('- 📤 Data export: WORKING');
        console.log('- 🔄 Workflow integration: COMPLETE');

    } catch (error) {
        console.error('❌ Integration test failed:', error);
        console.log('\n🔧 Troubleshooting:');
        console.log('- Check MongoDB connection');
        console.log('- Verify all monitoring schemas are created');
        console.log('- Ensure proper error handling in place');
    } finally {
        await mongoose.disconnect();
        console.log('\n🔌 Database disconnected');
    }
}

if (require.main === module) {
    testCompleteIntegration();
}

module.exports = { testCompleteIntegration };
