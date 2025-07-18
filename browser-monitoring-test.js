/**
 * Browser-based Agent Monitoring System Test
 * To be run in browser console on company-profile.html page
 */

// Add this function to the global scope for browser testing
window.testMonitoringSystem = async function() {
    console.log('🧪 Testing Agent Monitoring System in Browser...');
    console.log('=' .repeat(50));
    
    // Test 1: Check if monitoring functions are loaded
    console.log('🔍 [TEST 1] Checking monitoring functions...');
    const monitoringFunctions = [
        'loadMonitoringData',
        'updateMonitoringDisplay', 
        'setupMonitoringEventListeners',
        'openMonitoringDashboard',
        'openPendingReviews',
        'startRealTimeUpdates'
    ];
    
    const availableFunctions = monitoringFunctions.filter(func => typeof window[func] === 'function');
    console.log(`✅ [TEST 1] Available functions: ${availableFunctions.length}/${monitoringFunctions.length}`);
    availableFunctions.forEach(func => console.log(`  - ${func}`));
    
    // Test 2: Check if monitoring UI elements exist
    console.log('🎨 [TEST 2] Checking monitoring UI elements...');
    const uiElements = [
        'monitoring-status',
        'pending-reviews',
        'flagged-interactions', 
        'approval-rate',
        'monitoring-activity-feed',
        'open-monitoring-dashboard',
        'review-pending-interactions',
        'view-flagged-items',
        'export-monitoring-data'
    ];
    
    const availableElements = uiElements.filter(id => document.getElementById(id));
    console.log(`✅ [TEST 2] Available UI elements: ${availableElements.length}/${uiElements.length}`);
    availableElements.forEach(id => console.log(`  - ${id}`));
    
    // Test 3: Check if company ID is available
    console.log('🏢 [TEST 3] Checking company ID...');
    const companyId = window.companyId || new URLSearchParams(window.location.search).get('companyId');
    console.log(`✅ [TEST 3] Company ID: ${companyId}`);
    
    // Test 4: Test monitoring data loading
    console.log('📡 [TEST 4] Testing monitoring data loading...');
    if (typeof window.loadMonitoringData === 'function') {
        try {
            await window.loadMonitoringData();
            console.log('✅ [TEST 4] loadMonitoringData executed successfully');
        } catch (error) {
            console.error('❌ [TEST 4] loadMonitoringData failed:', error);
        }
    } else {
        console.error('❌ [TEST 4] loadMonitoringData function not found');
    }
    
    // Test 5: Test dashboard opening
    console.log('🎛️ [TEST 5] Testing dashboard opening...');
    if (typeof window.openMonitoringDashboard === 'function') {
        try {
            // Don't actually open the dashboard, just test the function exists
            console.log('✅ [TEST 5] openMonitoringDashboard function available');
        } catch (error) {
            console.error('❌ [TEST 5] openMonitoringDashboard error:', error);
        }
    } else {
        console.error('❌ [TEST 5] openMonitoringDashboard function not found');
    }
    
    // Test 6: Test event listeners setup
    console.log('🎯 [TEST 6] Testing event listeners...');
    if (typeof window.setupMonitoringEventListeners === 'function') {
        try {
            window.setupMonitoringEventListeners();
            console.log('✅ [TEST 6] setupMonitoringEventListeners executed successfully');
        } catch (error) {
            console.error('❌ [TEST 6] setupMonitoringEventListeners failed:', error);
        }
    } else {
        console.error('❌ [TEST 6] setupMonitoringEventListeners function not found');
    }
    
    // Test 7: Test button clicks
    console.log('🖱️ [TEST 7] Testing button functionality...');
    const dashboardBtn = document.getElementById('open-monitoring-dashboard');
    if (dashboardBtn) {
        console.log('✅ [TEST 7] Dashboard button found and clickable');
        // Test click (but don't actually click to avoid modal)
        console.log('  - Button onclick:', dashboardBtn.onclick ? 'assigned' : 'not assigned');
        console.log('  - Button listeners:', dashboardBtn.addEventListener ? 'supported' : 'not supported');
    } else {
        console.error('❌ [TEST 7] Dashboard button not found');
    }
    
    console.log('\n🎉 Browser testing complete!');
    console.log('💡 To test dashboard: window.openMonitoringDashboard()');
    console.log('💡 To test data loading: window.loadMonitoringData()');
    console.log('💡 To test real-time updates: window.startRealTimeUpdates()');
};

// Auto-run test if this script is included
if (typeof window !== 'undefined') {
    console.log('🌐 Browser monitoring test loaded. Run: window.testMonitoringSystem()');
}
