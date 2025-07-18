/**
 * Browser-based test for monitoring DOM elements
 * Run in browser console: testMonitoringDOM()
 */

function testMonitoringDOM() {
    console.log('🧪 Testing Monitoring DOM Elements...');
    
    const elements = {
        'Agent Monitoring Section': 'agent-monitoring-section',
        'Dashboard Button': 'open-monitoring-dashboard',
        'Review Pending Button': 'review-pending-interactions',
        'View Flagged Button': 'view-flagged-items',
        'Export Data Button': 'export-monitoring-data',
        'Activity Feed': 'activity-feed',
        'Monitoring Stats': 'monitoring-stats'
    };
    
    console.log('🔍 DOM Element Check Results:');
    
    let allFound = true;
    Object.entries(elements).forEach(([name, id]) => {
        const element = document.getElementById(id);
        const found = !!element;
        console.log(`  ${name}: ${found ? '✅ Found' : '❌ Missing'} (ID: ${id})`);
        
        if (!found) {
            allFound = false;
        }
    });
    
    console.log(`\n📊 Overall Result: ${allFound ? '✅ All elements found' : '❌ Some elements missing'}`);
    
    // Test monitoring initialization
    if (typeof window.initializeMonitoring === 'function') {
        console.log('\n🔄 Testing monitoring initialization...');
        try {
            window.initializeMonitoring();
            console.log('✅ Monitoring initialization completed');
        } catch (error) {
            console.error('❌ Monitoring initialization failed:', error);
        }
    } else {
        console.log('⚠️ initializeMonitoring function not found');
    }
    
    return allFound;
}

// Auto-run when script loads
if (typeof window !== 'undefined') {
    window.testMonitoringDOM = testMonitoringDOM;
    console.log('🔧 testMonitoringDOM() function available - run in console to test');
}
