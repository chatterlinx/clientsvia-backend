#!/usr/bin/env node

/**
 * Test script to verify monitoring service loads without errors
 */

console.log('🧪 Testing monitoring service load...');

try {
    // Test loading the monitoring service
    const agentMonitoring = require('./services/agentMonitoring');
    console.log('✅ Monitoring service loaded successfully');
    
    // Test loading the monitoring routes
    const monitoringRoutes = require('./routes/monitoring');
    console.log('✅ Monitoring routes loaded successfully');
    
    console.log('🎯 All monitoring modules loaded without errors');
} catch (error) {
    console.error('❌ Error loading monitoring modules:', error);
    console.error('Stack trace:', error.stack);
}
