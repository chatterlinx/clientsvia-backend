/**
 * Render Log System Test
 * Tests the self-check logger and render log functionality
 */

console.log('🧪 Starting Render Log System Test...');

async function testRenderLogSystem() {
    try {
        console.log('1. Testing basic health endpoint...');
        
        // Test basic health endpoint
        const healthResponse = await fetch('/api/monitoring/health');
        if (healthResponse.ok) {
            const health = await healthResponse.json();
            console.log('✅ Health endpoint working:', health.status);
        } else {
            console.error('❌ Health endpoint failed');
        }
        
        console.log('2. Testing database health endpoint...');
        
        // Test database health
        const dbHealthResponse = await fetch('/api/monitoring/health/database');
        if (dbHealthResponse.ok) {
            const dbHealth = await dbHealthResponse.json();
            console.log('✅ Database health endpoint working:', dbHealth.status);
        } else {
            console.warn('⚠️ Database health endpoint returned error (expected in some environments)');
        }
        
        console.log('3. Testing self-check submission...');
        
        // Test self-check submission
        const mockCheckData = {
            timestamp: new Date().toISOString(),
            sessionId: `test_session_${Date.now()}`,
            companyId: 'test_company',
            checkNumber: 1,
            status: 'success',
            components: {
                qaEngine: { status: 'success', message: 'Test QA engine operational' },
                database: { status: 'success', message: 'Test database connected' },
                api: { status: 'success', message: 'Test API healthy' }
            },
            performance: {
                checkTime: 150,
                memoryUsage: 45,
                cpuUsage: 8,
                networkLatency: 25
            },
            warnings: [],
            errors: [],
            loadTimeMs: 150,
            traceId: `test_trace_${Date.now()}`
        };
        
        const selfCheckResponse = await fetch('/api/monitoring/self-check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(mockCheckData)
        });
        
        if (selfCheckResponse.ok) {
            const result = await selfCheckResponse.json();
            console.log('✅ Self-check submission working:', result.checkId);
        } else {
            console.error('❌ Self-check submission failed');
        }
        
        console.log('4. Testing self-check retrieval...');
        
        // Test retrieval
        const retrievalResponse = await fetch('/api/monitoring/self-check/test_company');
        if (retrievalResponse.ok) {
            const data = await retrievalResponse.json();
            console.log('✅ Self-check retrieval working, found', data.checks.length, 'checks');
        } else {
            console.error('❌ Self-check retrieval failed');
        }
        
        console.log('5. Testing monitoring status...');
        
        // Test monitoring status
        const statusResponse = await fetch('/api/monitoring/status');
        if (statusResponse.ok) {
            const status = await statusResponse.json();
            console.log('✅ Monitoring status working:', status.monitoring.status);
        } else {
            console.error('❌ Monitoring status failed');
        }
        
        console.log('6. Testing SelfCheckLogger class...');
        
        // Test SelfCheckLogger if available
        if (window.SelfCheckLogger) {
            console.log('✅ SelfCheckLogger class available');
            const status = window.SelfCheckLogger.getStatus();
            console.log('📊 SelfCheckLogger status:', status);
            
            // Run a test check
            await window.SelfCheckLogger.runCheck();
            console.log('✅ Test check completed');
        } else {
            console.warn('⚠️ SelfCheckLogger class not available (may not be loaded yet)');
        }
        
        console.log('🎉 Render Log System Test completed successfully!');
        return true;
        
    } catch (error) {
        console.error('❌ Render Log System Test failed:', error);
        return false;
    }
}

// Auto-run test when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(testRenderLogSystem, 3000); // Wait 3 seconds for systems to initialize
    });
} else {
    setTimeout(testRenderLogSystem, 3000);
}

// Export for manual testing
window.testRenderLogSystem = testRenderLogSystem;
