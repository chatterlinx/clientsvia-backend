/**
 * ClientsVia Enterprise Integration Test Suite
 * Comprehensive testing for all enterprise AI Agent Logic features
 * 
 * This is the enhanced version of our beautiful test that can be saved
 * and reused for future development and validation
 */

const axios = require('axios');
const colors = require('colors');

// Test configuration
const CONFIG = {
    BASE_URL: process.env.TEST_BASE_URL || 'http://localhost:3000',
    COMPANY_ID: process.env.TEST_COMPANY_ID || '507f1f77bcf86cd799439011',
    TIMEOUT: parseInt(process.env.TEST_TIMEOUT) || 10000,
    RETRIES: parseInt(process.env.TEST_RETRIES) || 3,
    USE_AUTH: process.env.TEST_USE_AUTH === 'true'
};

class EnterpriseTestSuite {
    constructor() {
        this.config = CONFIG;
        this.results = {
            analytics: { passed: 0, failed: 0, tests: [] },
            abTesting: { passed: 0, failed: 0, tests: [] },
            personalization: { passed: 0, failed: 0, tests: [] },
            flowDesigner: { passed: 0, failed: 0, tests: [] },
            system: { passed: 0, failed: 0, tests: [] },
            integration: { passed: 0, failed: 0, tests: [] }
        };
        this.startTime = Date.now();
    }

    /**
     * Enhanced logging with colors and timestamps
     */
    log(message, type = 'info') {
        const timestamp = new Date().toISOString().substring(11, 23);
        let prefix = '🔍';
        let coloredMessage = message;

        switch (type) {
            case 'success':
                prefix = '✅';
                coloredMessage = message.green;
                break;
            case 'error':
                prefix = '❌';
                coloredMessage = message.red;
                break;
            case 'warning':
                prefix = '⚠️ ';
                coloredMessage = message.yellow;
                break;
            case 'info':
                prefix = '🔍';
                coloredMessage = message.cyan;
                break;
            case 'header':
                prefix = '🚀';
                coloredMessage = message.blue.bold;
                break;
        }

        console.log(`${prefix} [${timestamp}] ${coloredMessage}`);
    }

    /**
     * Enhanced test endpoint with retry logic and better error handling
     */
    async testEndpoint(testName, category, url, method = 'GET', data = null, options = {}) {
        const fullUrl = `${this.config.BASE_URL}${url}`;
        let attempt = 1;
        
        while (attempt <= this.config.RETRIES) {
            try {
                const config = {
                    method,
                    url: fullUrl,
                    timeout: this.config.TIMEOUT,
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        ...options.headers
                    }
                };

                if (data && (method === 'POST' || method === 'PUT')) {
                    config.data = data;
                }

                const startTime = Date.now();
                const response = await axios(config);
                const responseTime = Date.now() - startTime;
                
                if (response.status >= 200 && response.status < 300) {
                    this.results[category].passed++;
                    this.results[category].tests.push({ 
                        name: testName, 
                        status: 'PASSED', 
                        response: response.status,
                        responseTime,
                        attempt
                    });
                    
                    this.log(`${testName}: PASSED (${response.status}) [${responseTime}ms]`, 'success');
                    return { 
                        success: true, 
                        data: response.data, 
                        status: response.status,
                        responseTime 
                    };
                } else {
                    throw new Error(`Unexpected status: ${response.status}`);
                }
            } catch (error) {
                if (attempt === this.config.RETRIES) {
                    this.results[category].failed++;
                    this.results[category].tests.push({ 
                        name: testName, 
                        status: 'FAILED', 
                        error: error.response?.status || error.message,
                        attempts: attempt
                    });
                    
                    this.log(`${testName}: FAILED (${error.response?.status || error.message}) [${attempt} attempts]`, 'error');
                    return { success: false, error: error.message };
                } else {
                    this.log(`${testName}: Retry ${attempt}/${this.config.RETRIES} (${error.message})`, 'warning');
                    attempt++;
                    await this.sleep(1000 * attempt); // Exponential backoff
                }
            }
        }
    }

    /**
     * Sleep utility for retry logic
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * System Health & Infrastructure Tests
     */
    async testSystemHealth() {
        this.log('🏥 Testing System Health & Infrastructure...', 'header');

        // Test server health
        await this.testEndpoint(
            'Server Health Check',
            'system',
            '/api/ai-agent-logic/test/health'
        );

        // Test database connectivity (if available)
        await this.testEndpoint(
            'Database Connectivity',
            'system',
            '/health'
        );
    }

    /**
     * Analytics Dashboard Tests
     */
    async testAnalyticsDashboard() {
        this.log('📊 Testing Real-time Analytics Dashboard...', 'header');

        // Test real-time analytics endpoint
        const analyticsResult = await this.testEndpoint(
            'Real-time Analytics Data',
            'analytics',
            `/api/ai-agent-logic/test/analytics/${this.config.COMPANY_ID}/realtime`
        );

        // Validate data structure
        if (analyticsResult.success && analyticsResult.data) {
            const data = analyticsResult.data.data || analyticsResult.data;
            const requiredFields = ['successRate', 'avgResponseTime', 'confidence', 'activeSessions', 'timestamp'];
            const missingFields = requiredFields.filter(field => !(field in data));
            
            if (missingFields.length === 0) {
                this.results.analytics.passed++;
                this.results.analytics.tests.push({ 
                    name: 'Analytics Data Structure Validation', 
                    status: 'PASSED', 
                    response: 'All required fields present' 
                });
                this.log('Analytics Data Structure: VALID', 'success');
                
                // Validate data ranges
                await this.validateDataRanges(data);
            } else {
                this.results.analytics.failed++;
                this.results.analytics.tests.push({ 
                    name: 'Analytics Data Structure Validation', 
                    status: 'FAILED', 
                    error: `Missing fields: ${missingFields.join(', ')}` 
                });
                this.log(`Analytics Data Structure: INVALID (Missing: ${missingFields.join(', ')})`, 'error');
            }
        }

        // Test analytics export functionality
        await this.testEndpoint(
            'Analytics Export Endpoint',
            'analytics',
            `/api/ai-agent-logic/analytics/${this.config.COMPANY_ID}/export`,
            'POST',
            { format: 'csv', timeframe: '7d' }
        );
    }

    /**
     * Validate analytics data ranges
     */
    async validateDataRanges(data) {
        const validations = [
            { field: 'successRate', min: 0, max: 100, value: data.successRate },
            { field: 'confidence', min: 0, max: 100, value: data.confidence },
            { field: 'activeSessions', min: 0, max: 1000, value: data.activeSessions },
            { field: 'avgResponseTime', min: 0, max: 10, value: parseFloat(data.avgResponseTime) }
        ];

        let validationsPassed = 0;
        let validationsFailed = 0;

        validations.forEach(validation => {
            if (validation.value >= validation.min && validation.value <= validation.max) {
                validationsPassed++;
                this.log(`✓ ${validation.field}: ${validation.value} (valid range)`, 'success');
            } else {
                validationsFailed++;
                this.log(`✗ ${validation.field}: ${validation.value} (out of range ${validation.min}-${validation.max})`, 'error');
            }
        });

        if (validationsFailed === 0) {
            this.results.analytics.passed++;
            this.results.analytics.tests.push({ 
                name: 'Data Range Validation', 
                status: 'PASSED', 
                response: `All ${validationsPassed} validations passed` 
            });
        } else {
            this.results.analytics.failed++;
            this.results.analytics.tests.push({ 
                name: 'Data Range Validation', 
                status: 'FAILED', 
                error: `${validationsFailed} validations failed` 
            });
        }
    }

    /**
     * A/B Testing Framework Tests
     */
    async testABTestingFramework() {
        this.log('🧪 Testing A/B Testing Framework...', 'header');

        // Test A/B test creation
        const testConfig = {
            name: `Test AB ${Date.now()}`,
            type: 'greeting',
            variants: [
                { name: 'Professional', traffic: 50, config: { tone: 'professional' } },
                { name: 'Friendly', traffic: 50, config: { tone: 'friendly' } }
            ]
        };

        await this.testEndpoint(
            'A/B Test Creation',
            'abTesting',
            `/api/ai-agent-logic/ab-testing/${this.config.COMPANY_ID}/create`,
            'POST',
            testConfig
        );

        // Test A/B test retrieval
        await this.testEndpoint(
            'A/B Tests Retrieval',
            'abTesting',
            `/api/ai-agent-logic/ab-testing/${this.config.COMPANY_ID}/tests`
        );
    }

    /**
     * Personalization Engine Tests
     */
    async testPersonalizationEngine() {
        this.log('👤 Testing Advanced Personalization Engine...', 'header');

        // Test personalization rules
        const rules = {
            dynamic: [
                {
                    id: `rule_${Date.now()}`,
                    name: 'VIP Customer Treatment',
                    trigger: 'high_value_customer',
                    conditions: [{ field: 'total_spent', operator: 'greater_than', value: 10000 }],
                    actions: ['use_vip_greeting', 'priority_escalation']
                }
            ]
        };

        await this.testEndpoint(
            'Personalization Rules Update',
            'personalization',
            `/api/ai-agent-logic/personalization/${this.config.COMPANY_ID}/rules`,
            'POST',
            rules
        );

        // Test customer segment creation
        const segmentConfig = {
            name: `High-Value Customers ${Date.now()}`,
            criteria: [
                { field: 'total_spent', operator: 'greater_than', value: 5000 },
                { field: 'call_frequency', operator: 'greater_than', value: 5 }
            ],
            actions: ['vip_treatment', 'dedicated_support']
        };

        await this.testEndpoint(
            'Customer Segment Creation',
            'personalization',
            `/api/ai-agent-logic/personalization/${this.config.COMPANY_ID}/segments`,
            'POST',
            segmentConfig
        );
    }

    /**
     * Flow Designer Tests
     */
    async testFlowDesigner() {
        this.log('🎨 Testing Conversation Flow Designer...', 'header');

        // Test flow creation
        const flowData = {
            id: `flow_${Date.now()}`,
            name: 'Customer Support Flow',
            nodes: [
                { id: 'start', type: 'greeting', position: { x: 100, y: 100 }, config: {} },
                { id: 'classify', type: 'question', position: { x: 300, y: 100 }, config: {} },
                { id: 'resolve', type: 'response', position: { x: 500, y: 100 }, config: {} }
            ],
            connections: [
                { from: 'start', to: 'classify', condition: '' },
                { from: 'classify', to: 'resolve', condition: 'support_needed' }
            ],
            version: '1.0',
            active: true
        };

        await this.testEndpoint(
            'Conversation Flow Save',
            'flowDesigner',
            `/api/ai-agent-logic/flow-designer/${this.config.COMPANY_ID}/flows`,
            'POST',
            flowData
        );

        // Test flow retrieval
        await this.testEndpoint(
            'Conversation Flows Retrieval',
            'flowDesigner',
            `/api/ai-agent-logic/flow-designer/${this.config.COMPANY_ID}/flows`
        );
    }

    /**
     * Integration Tests
     */
    async testIntegration() {
        this.log('🔄 Testing End-to-End Integration...', 'header');

        // Test frontend accessibility
        const frontendResult = await this.testEndpoint(
            'Frontend Page Access',
            'integration',
            '/company-profile.html'
        );

        // Test route registration completeness
        const routes = [
            '/api/ai-agent-logic/test/health',
            `/api/ai-agent-logic/test/analytics/${this.config.COMPANY_ID}/realtime`
        ];

        for (const route of routes) {
            await this.testEndpoint(
                `Route Registration: ${route}`,
                'integration',
                route
            );
        }
    }

    /**
     * Performance Benchmarking
     */
    async runPerformanceBenchmarks() {
        this.log('🏃 Running Performance Benchmarks...', 'header');

        const benchmarks = [];
        const iterations = 5;

        for (let i = 0; i < iterations; i++) {
            const result = await this.testEndpoint(
                `Performance Test ${i + 1}`,
                'system',
                `/api/ai-agent-logic/test/analytics/${this.config.COMPANY_ID}/realtime`
            );

            if (result.success) {
                benchmarks.push(result.responseTime);
            }
        }

        if (benchmarks.length > 0) {
            const avgResponseTime = benchmarks.reduce((a, b) => a + b, 0) / benchmarks.length;
            const maxResponseTime = Math.max(...benchmarks);
            const minResponseTime = Math.min(...benchmarks);

            this.log(`Performance Results:`, 'info');
            this.log(`  Average: ${avgResponseTime.toFixed(2)}ms`, 'info');
            this.log(`  Min: ${minResponseTime}ms`, 'info');
            this.log(`  Max: ${maxResponseTime}ms`, 'info');

            if (avgResponseTime < 2000) {
                this.log(`Performance: EXCELLENT (< 2s average)`, 'success');
            } else if (avgResponseTime < 5000) {
                this.log(`Performance: GOOD (< 5s average)`, 'warning');
            } else {
                this.log(`Performance: NEEDS IMPROVEMENT (> 5s average)`, 'error');
            }
        }
    }

    /**
     * Generate comprehensive test report
     */
    generateDetailedReport() {
        const totalTime = Date.now() - this.startTime;
        const categories = Object.keys(this.results);
        let totalPassed = 0;
        let totalFailed = 0;

        this.log('📊 ENTERPRISE FEATURES COMPREHENSIVE TEST REPORT', 'header');
        console.log('='.repeat(80).blue);

        categories.forEach(category => {
            const result = this.results[category];
            totalPassed += result.passed;
            totalFailed += result.failed;
            
            if (result.tests.length > 0) {
                console.log(`\n📋 ${category.toUpperCase().yellow}:`);
                console.log(`   ✅ Passed: ${result.passed.toString().green}`);
                console.log(`   ❌ Failed: ${result.failed.toString().red}`);
                
                result.tests.forEach(test => {
                    const status = test.status === 'PASSED' ? '✅'.green : '❌'.red;
                    const details = test.status === 'PASSED' 
                        ? `${test.response}${test.responseTime ? ` [${test.responseTime}ms]` : ''}`
                        : test.error;
                    console.log(`   ${status} ${test.name} (${details})`);
                });
            }
        });

        console.log('\n' + '='.repeat(80).blue);
        console.log(`📊 OVERALL RESULTS:`.blue.bold);
        console.log(`   ✅ Total Passed: ${totalPassed.toString().green.bold}`);
        console.log(`   ❌ Total Failed: ${totalFailed.toString().red.bold}`);
        console.log(`   📈 Success Rate: ${((totalPassed / (totalPassed + totalFailed)) * 100).toFixed(1)}%`.cyan.bold);
        console.log(`   ⏱️  Total Time: ${(totalTime / 1000).toFixed(2)}s`.cyan);

        const isProductionReady = totalFailed === 0;
        const status = isProductionReady ? '✅ PRODUCTION READY'.green.bold : '❌ NEEDS WORK'.red.bold;
        console.log(`\n🚀 ENTERPRISE STATUS: ${status}`);
        
        if (isProductionReady) {
            console.log('\n🎉 RECOMMENDATION: All enterprise features are ready for production deployment!'.green);
        } else {
            console.log('\n⚠️  RECOMMENDATION: Review failed tests before production deployment.'.yellow);
        }

        // Generate summary for CI/CD
        const summary = {
            timestamp: new Date().toISOString(),
            totalTests: totalPassed + totalFailed,
            passed: totalPassed,
            failed: totalFailed,
            successRate: (totalPassed / (totalPassed + totalFailed)) * 100,
            executionTime: totalTime,
            productionReady: isProductionReady,
            details: this.results
        };

        return summary;
    }

    /**
     * Run complete test suite
     */
    async runCompleteSuite() {
        this.log('🚀 Starting Enterprise AI Agent Logic Test Suite...', 'header');
        this.log(`Configuration: ${JSON.stringify(this.config, null, 2)}`, 'info');
        
        try {
            await this.testSystemHealth();
            await this.testAnalyticsDashboard();
            await this.testABTestingFramework();
            await this.testPersonalizationEngine();
            await this.testFlowDesigner();
            await this.testIntegration();
            await this.runPerformanceBenchmarks();
        } catch (error) {
            this.log(`Test suite execution failed: ${error.message}`, 'error');
        }

        return this.generateDetailedReport();
    }
}

// Export for use as module
module.exports = EnterpriseTestSuite;

// Run tests if called directly
if (require.main === module) {
    (async () => {
        const testSuite = new EnterpriseTestSuite();
        const results = await testSuite.runCompleteSuite();
        
        // Save results to file for CI/CD
        const fs = require('fs');
        const path = require('path');
        const resultsDir = path.join(__dirname, '..', 'test-results');
        
        if (!fs.existsSync(resultsDir)) {
            fs.mkdirSync(resultsDir, { recursive: true });
        }
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const resultsFile = path.join(resultsDir, `enterprise-test-results-${timestamp}.json`);
        fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
        
        console.log(`\n📁 Test results saved to: ${resultsFile}`.cyan);
        
        // Exit with appropriate code
        process.exit(results.productionReady ? 0 : 1);
    })();
}
