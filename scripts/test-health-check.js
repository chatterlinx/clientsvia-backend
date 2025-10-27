/**
 * ============================================================================
 * TEST CRITICAL DATA HEALTH CHECK
 * ============================================================================
 * Runs the health check immediately to test the notification system
 * ============================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');
const CriticalDataHealthCheck = require('../services/CriticalDataHealthCheck');

async function testHealthCheck() {
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');
        console.log('');
        
        console.log('🏥 Running Critical Data Health Check...');
        console.log('');
        
        const results = await CriticalDataHealthCheck.runAllChecks();
        
        console.log('');
        console.log('═'.repeat(80));
        console.log('📊 HEALTH CHECK RESULTS');
        console.log('═'.repeat(80));
        console.log('');
        console.log(`⏱️  Timestamp: ${results.timestamp}`);
        console.log(`✅ Passed: ${results.passed}`);
        console.log(`❌ Failed: ${results.failed}`);
        console.log(`⚠️  Warnings: ${results.warnings}`);
        console.log('');
        console.log('CHECKS:');
        results.checks.forEach((check, i) => {
            const icon = check.status === 'PASS' ? '✅' : 
                        check.status === 'WARNING' ? '⚠️' : 
                        check.status === 'CRITICAL' ? '🔴' : '❌';
            console.log(`  ${i + 1}. ${icon} ${check.name}: ${check.status}`);
            if (check.issue) {
                console.log(`     Issue: ${check.issue}`);
            }
            if (check.impact) {
                console.log(`     Impact: ${check.impact}`);
            }
            if (check.count !== undefined) {
                console.log(`     Count: ${check.count}`);
            }
        });
        console.log('');
        console.log('═'.repeat(80));
        console.log('');
        
        if (results.failed > 0 || results.warnings > 0) {
            console.log('🚨 ALERTS SENT TO NOTIFICATION CENTER!');
            console.log('');
            console.log('📋 NEXT STEPS:');
            console.log('   1. Check Notification Center tab for new alerts');
            console.log('   2. Review alert details and suggested fixes');
            console.log('   3. Fix critical issues immediately');
            console.log('');
        } else {
            console.log('🎉 ALL CHECKS PASSED! System is healthy.');
            console.log('');
        }
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Health check failed:', error);
        process.exit(1);
    }
}

testHealthCheck();

