/**
 * Render Log Demo Script
 * Generates sample render log data to demonstrate the system
 */

console.log('🎭 Starting Render Log Demo...');

async function generateSampleRenderLogData() {
    try {
        const companyId = getCurrentCompanyId() || 'demo_company';
        const sessionId = `demo_session_${Date.now()}`;
        
        console.log('🎯 Generating sample render log data for company:', companyId);
        
        // Generate a series of sample self-checks with varying results
        const sampleChecks = [
            {
                status: 'success',
                componentOverrides: { ollama: false }, // Ollama offline
                description: 'Normal operation with Ollama offline'
            },
            {
                status: 'partial_success', 
                componentOverrides: { bookingFlow: false, calendarSync: false },
                description: 'Booking system issues detected'
            },
            {
                status: 'success',
                componentOverrides: {},
                description: 'All systems operational'
            },
            {
                status: 'error',
                componentOverrides: { database: false, api: false },
                description: 'Critical system failure'
            },
            {
                status: 'partial_success',
                componentOverrides: { transferRouter: false },
                description: 'Transfer routing degraded'
            },
            {
                status: 'success',
                componentOverrides: { ollama: true }, // Ollama back online
                description: 'Recovery complete - all systems online'
            }
        ];
        
        // Send sample checks with delays to simulate real-time monitoring
        for (let i = 0; i < sampleChecks.length; i++) {
            const check = sampleChecks[i];
            
            console.log(`📊 Generating sample check ${i + 1}: ${check.description}`);
            
            // Create mock check data
            const mockCheckData = {
                timestamp: new Date(Date.now() - (sampleChecks.length - i - 1) * 60000).toISOString(), // Spread over last few minutes
                sessionId: sessionId,
                companyId: companyId,
                checkNumber: i + 1,
                status: check.status,
                components: generateMockComponents(check.componentOverrides),
                performance: {
                    checkTime: Math.floor(Math.random() * 200) + 50,
                    memoryUsage: Math.floor(Math.random() * 50) + 30,
                    cpuUsage: Math.floor(Math.random() * 20) + 5,
                    networkLatency: Math.floor(Math.random() * 100) + 20
                },
                warnings: check.status === 'partial_success' ? ['Some components degraded'] : [],
                errors: check.status === 'error' ? ['Critical system failure detected'] : [],
                loadTimeMs: Math.floor(Math.random() * 300) + 100,
                traceId: `demo_trace_${Date.now()}_${i}`
            };
            
            // Submit to backend
            try {
                const response = await fetch('/api/monitoring/self-check', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(mockCheckData)
                });
                
                if (response.ok) {
                    const result = await response.json();
                    console.log(`✅ Sample check ${i + 1} submitted:`, result.checkId);
                } else {
                    console.warn(`⚠️ Failed to submit sample check ${i + 1}`);
                }
            } catch (error) {
                console.error(`❌ Error submitting sample check ${i + 1}:`, error);
            }
            
            // Simulate the check in the UI
            if (window.SelfCheckLogger) {
                // Add directly to render log for immediate visual feedback
                window.SelfCheckLogger.addToRenderLog({
                    timestamp: mockCheckData.timestamp,
                    status: mockCheckData.status,
                    errors: mockCheckData.errors,
                    warnings: mockCheckData.warnings,
                    loadTimeMs: mockCheckData.loadTimeMs,
                    traceId: mockCheckData.traceId,
                    checkNumber: mockCheckData.checkNumber,
                    components: mockCheckData.components
                });
            }
            
            // Wait before next check (unless it's the last one)
            if (i < sampleChecks.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        console.log('🎉 Sample render log data generation completed!');
        console.log('📈 Check the "System Health & Render Log" section to see the results');
        
        // Add a completion message to the render log
        if (window.SelfCheckLogger) {
            window.SelfCheckLogger.log('info', '🎭 Demo data generation completed', {
                totalChecks: sampleChecks.length,
                companyId: companyId,
                sessionId: sessionId
            });
        }
        
    } catch (error) {
        console.error('❌ Demo generation failed:', error);
    }
}

function generateMockComponents(overrides = {}) {
    const defaultComponents = {
        qaEngine: true,
        bookingFlow: true,
        tradeConfig: true,
        calendarSync: true,
        transferRouter: true,
        agentPersonality: true,
        customFields: true,
        ollama: false, // Often offline in demo
        database: true,
        api: true,
        auth: true,
        notifications: true
    };
    
    // Apply overrides
    const components = { ...defaultComponents, ...overrides };
    
    // Convert to the format expected by the self-check logger
    const result = {};
    Object.entries(components).forEach(([component, isWorking]) => {
        if (isWorking) {
            result[component] = {
                status: 'success',
                message: `${component} operational`,
                responseTime: Math.floor(Math.random() * 100) + 20
            };
        } else {
            result[component] = {
                status: 'error',
                error: `${component} not responding`,
                responseTime: 0
            };
        }
    });
    
    return result;
}

function getCurrentCompanyId() {
    // Try to get company ID from various sources
    if (window.companyId) return window.companyId;
    
    const urlParams = new URLSearchParams(window.location.search);
    const companyId = urlParams.get('id');
    if (companyId) return companyId;
    
    return null;
}

// Auto-run demo in development
if (window.location.hostname === 'localhost' || window.location.hostname.includes('127.0.0.1')) {
    // Wait for systems to initialize, then offer to run demo
    setTimeout(() => {
        if (confirm('🎭 Would you like to generate sample render log data to test the system?')) {
            generateSampleRenderLogData();
        }
    }, 5000);
}

// Export for manual use
window.generateSampleRenderLogData = generateSampleRenderLogData;
window.runRenderLogDemo = generateSampleRenderLogData;
