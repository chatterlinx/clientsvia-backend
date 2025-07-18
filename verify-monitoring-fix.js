/**
 * Quick verification that the monitoring system is working
 * Run this in browser console on the company profile page
 */

function verifyMonitoringFix() {
    console.log('🔍 Verifying Monitoring System Fix...');
    
    // Check if monitoring section exists
    const monitoringSection = document.getElementById('agent-monitoring-section');
    console.log('✅ Monitoring section found:', !!monitoringSection);
    
    // Check if key buttons exist
    const dashboardBtn = document.getElementById('open-monitoring-dashboard');
    const reviewBtn = document.getElementById('review-pending-interactions');
    
    console.log('✅ Dashboard button found:', !!dashboardBtn);
    console.log('✅ Review button found:', !!reviewBtn);
    
    // Check if monitoring system initialized
    if (typeof window.initializeMonitoringSystem === 'function') {
        console.log('✅ Monitoring system function available');
        
        // Check if it's already initialized
        if (window.currentCompanyData && window.currentCompanyData._id) {
            console.log('✅ Company data loaded, monitoring should be active');
            console.log('🎯 Company ID:', window.currentCompanyData._id);
            
            // Test if monitoring is working
            if (monitoringSection && dashboardBtn && reviewBtn) {
                console.log('🎉 MONITORING SYSTEM IS WORKING!');
                return true;
            } else {
                console.log('⚠️ Some monitoring elements missing');
                return false;
            }
        } else {
            console.log('⚠️ Company data not loaded yet');
            return false;
        }
    } else {
        console.log('❌ Monitoring system function not available');
        return false;
    }
}

// Make available globally
if (typeof window !== 'undefined') {
    window.verifyMonitoringFix = verifyMonitoringFix;
    console.log('🔧 Run verifyMonitoringFix() to test monitoring system');
}
