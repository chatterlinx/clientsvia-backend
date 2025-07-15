// Quick test to verify company ID availability
console.log('Testing Company ID availability...');
console.log('window.currentCompanyId:', window.currentCompanyId);
console.log('URL params:', new URLSearchParams(window.location.search).get('id'));

// Test the AI Agent Setup connection
if (window.aiAgentSetup && window.aiAgentSetup.getCompanyIdFromUrl) {
    const companyId = window.aiAgentSetup.getCompanyIdFromUrl();
    console.log('AI Agent Setup - Company ID:', companyId);
} else {
    console.log('AI Agent Setup not initialized or method missing');
}
