/**
 * Analytics Dashboard Feature Tests
 * Tests specifically for the real-time analytics dashboard
 */

const EnterpriseTestSuite = require('./integration.test');

class AnalyticsTests extends EnterpriseTestSuite {
    constructor() {
        super();
        this.testCategory = 'analytics';
    }

    async runAnalyticsSpecificTests() {
        this.log('📊 Running Analytics-Specific Tests...', 'header');
        
        await this.testAnalyticsDashboard();
        await this.testAnalyticsDataValidation();
        await this.testAnalyticsPerformance();
        
        return this.generateReport();
    }

    async testAnalyticsDataValidation() {
        this.log('🔍 Testing Analytics Data Validation...', 'info');
        
        // Test multiple data points for consistency
        const results = [];
        for (let i = 0; i < 5; i++) {
            const result = await this.testEndpoint(
                `Analytics Data Point ${i + 1}`,
                'analytics',
                `/api/ai-agent-logic/test/analytics/${this.config.COMPANY_ID}/realtime`
            );
            if (result.success) {
                results.push(result.data.data);
            }
        }

        // Validate data consistency
        if (results.length > 0) {
            const avgSuccessRate = results.reduce((sum, data) => sum + data.successRate, 0) / results.length;
            const avgResponseTime = results.reduce((sum, data) => sum + parseFloat(data.avgResponseTime), 0) / results.length;
            
            this.log(`Analytics Consistency - Avg Success Rate: ${avgSuccessRate.toFixed(1)}%`, 'info');
            this.log(`Analytics Consistency - Avg Response Time: ${avgResponseTime.toFixed(2)}s`, 'info');
        }
    }

    async testAnalyticsPerformance() {
        this.log('⚡ Testing Analytics Performance...', 'info');
        
        const startTime = Date.now();
        const promises = [];
        
        // Test concurrent requests
        for (let i = 0; i < 10; i++) {
            promises.push(
                this.testEndpoint(
                    `Concurrent Analytics Request ${i + 1}`,
                    'analytics',
                    `/api/ai-agent-logic/test/analytics/${this.config.COMPANY_ID}/realtime`
                )
            );
        }
        
        await Promise.all(promises);
        const totalTime = Date.now() - startTime;
        
        this.log(`Concurrent Analytics Performance: ${totalTime}ms for 10 requests`, 'info');
    }

    generateReport() {
        const category = this.results.analytics;
        const total = category.passed + category.failed;
        const successRate = total > 0 ? (category.passed / total * 100).toFixed(1) : 0;
        
        console.log('\n📊 ANALYTICS DASHBOARD TEST REPORT'.blue.bold);
        console.log('='.repeat(50).blue);
        console.log(`✅ Passed: ${category.passed.toString().green}`);
        console.log(`❌ Failed: ${category.failed.toString().red}`);
        console.log(`📈 Success Rate: ${successRate}%`.cyan);
        
        return {
            category: 'analytics',
            passed: category.passed,
            failed: category.failed,
            successRate: parseFloat(successRate),
            tests: category.tests
        };
    }
}

// Run if called directly
if (require.main === module) {
    (async () => {
        const tests = new AnalyticsTests();
        const results = await tests.runAnalyticsSpecificTests();
        process.exit(results.failed > 0 ? 1 : 0);
    })();
}

module.exports = AnalyticsTests;
