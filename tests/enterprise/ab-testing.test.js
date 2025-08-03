/**
 * A/B Testing Framework Feature Tests
 */

const EnterpriseTestSuite = require('./integration.test');

class ABTestingTests extends EnterpriseTestSuite {
    constructor() {
        super();
        this.testCategory = 'abTesting';
    }

    async runABTestingSpecificTests() {
        this.log('🧪 Running A/B Testing-Specific Tests...', 'header');
        
        await this.testABTestingFramework();
        await this.testABTestLifecycle();
        
        return this.generateReport();
    }

    async testABTestLifecycle() {
        this.log('🔄 Testing A/B Test Lifecycle...', 'info');
        
        // Create a test
        const testConfig = {
            name: `Lifecycle Test ${Date.now()}`,
            type: 'response-tone',
            variants: [
                { name: 'Formal', traffic: 50, config: { tone: 'formal' } },
                { name: 'Casual', traffic: 50, config: { tone: 'casual' } }
            ]
        };

        await this.testEndpoint(
            'A/B Test Lifecycle - Creation',
            'abTesting',
            `/api/ai-agent-logic/ab-testing/${this.config.COMPANY_ID}/create`,
            'POST',
            testConfig
        );

        // Retrieve tests to verify creation
        await this.testEndpoint(
            'A/B Test Lifecycle - Retrieval',
            'abTesting',
            `/api/ai-agent-logic/ab-testing/${this.config.COMPANY_ID}/tests`
        );
    }

    generateReport() {
        const category = this.results.abTesting;
        const total = category.passed + category.failed;
        const successRate = total > 0 ? (category.passed / total * 100).toFixed(1) : 0;
        
        console.log('\n🧪 A/B TESTING FRAMEWORK TEST REPORT'.blue.bold);
        console.log('='.repeat(50).blue);
        console.log(`✅ Passed: ${category.passed.toString().green}`);
        console.log(`❌ Failed: ${category.failed.toString().red}`);
        console.log(`📈 Success Rate: ${successRate}%`.cyan);
        
        return {
            category: 'abTesting',
            passed: category.passed,
            failed: category.failed,
            successRate: parseFloat(successRate),
            tests: category.tests
        };
    }
}

if (require.main === module) {
    (async () => {
        const tests = new ABTestingTests();
        const results = await tests.runABTestingSpecificTests();
        process.exit(results.failed > 0 ? 1 : 0);
    })();
}

module.exports = ABTestingTests;
