/**
 * Enterprise AI Agent Logic Integration Test
 * Tests all new enterprise features for production readiness
 */

const axios = require('axios');

// Test configuration
const BASE_URL = 'http://localhost:3000';
const TEST_COMPANY_ID = '507f1f77bcf86cd799439011'; // Example MongoDB ObjectId

class EnterpriseFeatureTest {
    constructor() {
        this.baseURL = BASE_URL;
        this.companyId = TEST_COMPANY_ID;
        this.results = {
            analytics: { passed: 0, failed: 0, tests: [] },
            abTesting: { passed: 0, failed: 0, tests: [] },
            personalization: { passed: 0, failed: 0, tests: [] },
            flowDesigner: { passed: 0, failed: 0, tests: [] }
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

    async testAnalyticsFeatures() {
        this.log('🔥 Testing Real-time Analytics Dashboard Features...');

        // Test real-time analytics endpoint
        await this.testEndpoint(
            'Real-time Analytics Data Fetch',
            'analytics',
            `/api/ai-agent-logic/analytics/${this.companyId}/realtime`
        );

        // Test analytics export
        await this.testEndpoint(
            'Analytics Report Export',
            'analytics',
            `/api/ai-agent-logic/analytics/${this.companyId}/export`,
            'POST',
            { format: 'csv', timeframe: '7d' }
        );
    }

    async testABTestingFeatures() {
        this.log('🧪 Testing A/B Testing Framework Features...');

        // Test A/B test creation
        const testConfig = {
            name: 'Greeting Tone Test',
            type: 'greeting',
            variantA: { tone: 'professional' },
            variantB: { tone: 'friendly' },
            variants: [
                { name: 'Professional', traffic: 50, config: { tone: 'professional' } },
                { name: 'Friendly', traffic: 50, config: { tone: 'friendly' } }
            ]
        };

        await this.testEndpoint(
            'A/B Test Creation',
            'abTesting',
            `/api/ai-agent-logic/ab-testing/${this.companyId}/create`,
            'POST',
            testConfig
        );

        // Test A/B test retrieval
        await this.testEndpoint(
            'A/B Tests Retrieval',
            'abTesting',
            `/api/ai-agent-logic/ab-testing/${this.companyId}/tests`
        );
    }

    async testPersonalizationFeatures() {
        this.log('👤 Testing Advanced Personalization Engine Features...');

        // Test personalization rules update
        const rules = {
            dynamic: [
                {
                    id: 'rule_1',
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
            `/api/ai-agent-logic/personalization/${this.companyId}/rules`,
            'POST',
            rules
        );

        // Test customer segment creation
        const segmentConfig = {
            name: 'High-Value Customers',
            criteria: [
                { field: 'total_spent', operator: 'greater_than', value: 5000 },
                { field: 'call_frequency', operator: 'greater_than', value: 5 }
            ],
            actions: ['vip_treatment', 'dedicated_support']
        };

        await this.testEndpoint(
            'Customer Segment Creation',
            'personalization',
            `/api/ai-agent-logic/personalization/${this.companyId}/segments`,
            'POST',
            segmentConfig
        );
    }

    async testFlowDesignerFeatures() {
        this.log('🎨 Testing Conversation Flow Designer Features...');

        // Test flow save
        const flowData = {
            id: 'flow_test_001',
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
            `/api/ai-agent-logic/flow-designer/${this.companyId}/flows`,
            'POST',
            flowData
        );

        // Test flow retrieval
        await this.testEndpoint(
            'Conversation Flows Retrieval',
            'flowDesigner',
            `/api/ai-agent-logic/flow-designer/${this.companyId}/flows`
        );
    }

    generateReport() {
        this.log('📊 ENTERPRISE FEATURES TEST REPORT', 'info');
        console.log('='.repeat(60));

        const categories = ['analytics', 'abTesting', 'personalization', 'flowDesigner'];
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

        console.log('\n' + '='.repeat(60));
        console.log(`📊 OVERALL RESULTS:`);
        console.log(`   ✅ Total Passed: ${totalPassed}`);
        console.log(`   ❌ Total Failed: ${totalFailed}`);
        console.log(`   📈 Success Rate: ${((totalPassed / (totalPassed + totalFailed)) * 100).toFixed(1)}%`);

        const isProductionReady = totalFailed === 0;
        console.log(`\n🚀 PRODUCTION READINESS: ${isProductionReady ? '✅ READY' : '❌ NEEDS WORK'}`);
        
        return {
            totalPassed,
            totalFailed,
            successRate: (totalPassed / (totalPassed + totalFailed)) * 100,
            productionReady: isProductionReady,
            details: this.results
        };
    }

    async runAllTests() {
        this.log('🚀 Starting Enterprise AI Agent Logic Integration Tests...');
        
        try {
            await this.testAnalyticsFeatures();
            await this.testABTestingFeatures();
            await this.testPersonalizationFeatures();
            await this.testFlowDesignerFeatures();
        } catch (error) {
            this.log(`Test execution failed: ${error.message}`, 'error');
        }

        return this.generateReport();
    }
}

// Run tests if called directly
if (require.main === module) {
    (async () => {
        const test = new EnterpriseFeatureTest();
        const results = await test.runAllTests();
        
        // Exit with appropriate code
        process.exit(results.productionReady ? 0 : 1);
    })();
}

module.exports = EnterpriseFeatureTest;
