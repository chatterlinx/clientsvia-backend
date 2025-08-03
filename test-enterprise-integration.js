/**
 * Enterprise AI Agent Logic Integration Test (Test Mode)
 * Tests all new enterprise features using test endpoints (no auth required)
 */

const axios = require('axios');

// Test configuration
const BASE_URL = 'http://localhost:3000';
const TEST_COMPANY_ID = '507f1f77bcf86cd799439011'; // Example MongoDB ObjectId

class EnterpriseFeatureTestMode {
    constructor() {
        this.baseURL = BASE_URL;
        this.companyId = TEST_COMPANY_ID;
        this.results = {
            analytics: { passed: 0, failed: 0, tests: [] },
            routing: { passed: 0, failed: 0, tests: [] },
            system: { passed: 0, failed: 0, tests: [] }
        };
    }

    log(message, type = 'info') {
        const timestamp = new Date().toISOString();
        const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : '🔍';
        console.log(`${prefix} [${timestamp}] ${message}`);
    }

    async testEndpoint(testName, category, url, method = 'GET', data = null) {
        try {
            const config = {
                method,
                url: `${this.baseURL}${url}`,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            };

            if (data && (method === 'POST' || method === 'PUT')) {
                config.data = data;
            }

            const response = await axios(config);
            
            if (response.status >= 200 && response.status < 300) {
                this.results[category].passed++;
                this.results[category].tests.push({ name: testName, status: 'PASSED', response: response.status });
                this.log(`${testName}: PASSED (${response.status})`, 'success');
                return { success: true, data: response.data, status: response.status };
            } else {
                throw new Error(`Unexpected status: ${response.status}`);
            }
        } catch (error) {
            this.results[category].failed++;
            this.results[category].tests.push({ 
                name: testName, 
                status: 'FAILED', 
                error: error.response?.status || error.message 
            });
            this.log(`${testName}: FAILED (${error.response?.status || error.message})`, 'error');
            return { success: false, error: error.message };
        }
    }

    async testSystemHealth() {
        this.log('🔥 Testing System Health & Route Registration...');

        // Test health endpoint
        await this.testEndpoint(
            'Enterprise Features Health Check',
            'system',
            `/api/ai-agent-logic/test/health`
        );
    }

    async testAnalyticsRouting() {
        this.log('📊 Testing Analytics Route & Data Structure...');

        // Test analytics data endpoint
        const result = await this.testEndpoint(
            'Real-time Analytics Data Structure',
            'analytics',
            `/api/ai-agent-logic/test/analytics/${this.companyId}/realtime`
        );

        // Validate response structure
        if (result.success && result.data) {
            const data = result.data.data;
            const requiredFields = ['successRate', 'avgResponseTime', 'confidence', 'activeSessions', 'timestamp'];
            const missingFields = requiredFields.filter(field => !(field in data));
            
            if (missingFields.length === 0) {
                this.results.analytics.passed++;
                this.results.analytics.tests.push({ 
                    name: 'Analytics Data Structure Validation', 
                    status: 'PASSED', 
                    response: 'All required fields present' 
                });
                this.log('Analytics Data Structure Validation: PASSED', 'success');
            } else {
                this.results.analytics.failed++;
                this.results.analytics.tests.push({ 
                    name: 'Analytics Data Structure Validation', 
                    status: 'FAILED', 
                    error: `Missing fields: ${missingFields.join(', ')}` 
                });
                this.log(`Analytics Data Structure Validation: FAILED (Missing: ${missingFields.join(', ')})`, 'error');
            }
        }
    }

    async testEnterpriseRoutingSetup() {
        this.log('🔀 Testing Enterprise Route Registration...');

        // Test all main enterprise route patterns
        const routeTests = [
            {
                name: 'Health Check Route',
                path: '/api/ai-agent-logic/test/health',
                expectedStatus: 200
            },
            {
                name: 'Analytics Test Route',
                path: `/api/ai-agent-logic/test/analytics/${this.companyId}/realtime`,
                expectedStatus: 200
            }
        ];

        for (const test of routeTests) {
            await this.testEndpoint(test.name, 'routing', test.path);
        }
    }

    async testDataValidity() {
        this.log('🧮 Testing Data Validity & Ranges...');

        const result = await this.testEndpoint(
            'Analytics Data Range Validation',
            'analytics',
            `/api/ai-agent-logic/test/analytics/${this.companyId}/realtime`
        );

        if (result.success && result.data) {
            const data = result.data.data;
            let validationsPassed = 0;
            let validationsFailed = 0;

            // Validate data ranges
            const validations = [
                { field: 'successRate', min: 0, max: 100, value: data.successRate },
                { field: 'confidence', min: 0, max: 100, value: data.confidence },
                { field: 'activeSessions', min: 0, max: 1000, value: data.activeSessions },
                { field: 'avgResponseTime', min: 0, max: 10, value: parseFloat(data.avgResponseTime) }
            ];

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
    }

    generateReport() {
        this.log('📊 ENTERPRISE FEATURES INTEGRATION TEST REPORT', 'info');
        console.log('='.repeat(70));

        const categories = ['system', 'routing', 'analytics'];
        let totalPassed = 0;
        let totalFailed = 0;

        categories.forEach(category => {
            const result = this.results[category];
            totalPassed += result.passed;
            totalFailed += result.failed;
            
            console.log(`\n📋 ${category.toUpperCase()}:`);
            console.log(`   ✅ Passed: ${result.passed}`);
            console.log(`   ❌ Failed: ${result.failed}`);
            
            result.tests.forEach(test => {
                const status = test.status === 'PASSED' ? '✅' : '❌';
                const details = test.status === 'PASSED' ? test.response : test.error;
                console.log(`   ${status} ${test.name} (${details})`);
            });
        });

        console.log('\n' + '='.repeat(70));
        console.log(`📊 OVERALL RESULTS:`);
        console.log(`   ✅ Total Passed: ${totalPassed}`);
        console.log(`   ❌ Total Failed: ${totalFailed}`);
        console.log(`   📈 Success Rate: ${((totalPassed / (totalPassed + totalFailed)) * 100).toFixed(1)}%`);

        const isProductionReady = totalFailed === 0;
        console.log(`\n🚀 ENTERPRISE INTEGRATION STATUS: ${isProductionReady ? '✅ READY' : '❌ NEEDS WORK'}`);
        
        // Additional insights
        console.log('\n📋 INTEGRATION ANALYSIS:');
        console.log(`   🔗 Route Registration: ${this.results.routing.passed > 0 ? '✅ Working' : '❌ Failed'}`);
        console.log(`   📊 Analytics System: ${this.results.analytics.passed > 0 ? '✅ Working' : '❌ Failed'}`);
        console.log(`   🏥 System Health: ${this.results.system.passed > 0 ? '✅ Working' : '❌ Failed'}`);
        
        if (isProductionReady) {
            console.log('\n🎉 RECOMMENDATION: Enterprise AI Agent Logic features are ready for production deployment!');
        } else {
            console.log('\n⚠️  RECOMMENDATION: Review failed tests before production deployment.');
        }
        
        return {
            totalPassed,
            totalFailed,
            successRate: (totalPassed / (totalPassed + totalFailed)) * 100,
            productionReady: isProductionReady,
            details: this.results
        };
    }

    async runAllTests() {
        this.log('🚀 Starting Enterprise AI Agent Logic Integration Tests (Test Mode)...');
        
        try {
            await this.testSystemHealth();
            await this.testEnterpriseRoutingSetup();
            await this.testAnalyticsRouting();
            await this.testDataValidity();
        } catch (error) {
            this.log(`Test execution failed: ${error.message}`, 'error');
        }

        return this.generateReport();
    }
}

// Run tests if called directly
if (require.main === module) {
    (async () => {
        const test = new EnterpriseFeatureTestMode();
        const results = await test.runAllTests();
        
        // Exit with appropriate code
        process.exit(results.productionReady ? 0 : 1);
    })();
}

module.exports = EnterpriseFeatureTestMode;
