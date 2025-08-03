/**
 * Personalization Engine Feature Tests
 */

const EnterpriseTestSuite = require('./integration.test');

class PersonalizationTests extends EnterpriseTestSuite {
    constructor() {
        super();
        this.testCategory = 'personalization';
    }

    async runPersonalizationSpecificTests() {
        this.log('👤 Running Personalization-Specific Tests...', 'header');
        
        await this.testPersonalizationEngine();
        await this.testPersonalizationRulesValidation();
        
        return this.generateReport();
    }

    async testPersonalizationRulesValidation() {
        this.log('🔍 Testing Personalization Rules Validation...', 'info');
        
        // Test various rule configurations
        const ruleConfigs = [
            {
                name: 'VIP Customer Rules',
                rules: {
                    dynamic: [{
                        id: `vip_rule_${Date.now()}`,
                        name: 'VIP Treatment',
                        trigger: 'high_value',
                        conditions: [{ field: 'lifetime_value', operator: 'greater_than', value: 50000 }],
                        actions: ['premium_support', 'priority_queue']
                    }]
                }
            },
            {
                name: 'New Customer Rules',
                rules: {
                    dynamic: [{
                        id: `new_rule_${Date.now()}`,
                        name: 'Welcome Treatment',
                        trigger: 'first_call',
                        conditions: [{ field: 'call_count', operator: 'equals', value: 1 }],
                        actions: ['welcome_greeting', 'onboarding_flow']
                    }]
                }
            }
        ];

        for (const config of ruleConfigs) {
            await this.testEndpoint(
                `Rule Validation - ${config.name}`,
                'personalization',
                `/api/ai-agent-logic/personalization/${this.config.COMPANY_ID}/rules`,
                'POST',
                config.rules
            );
        }
    }

    generateReport() {
        const category = this.results.personalization;
        const total = category.passed + category.failed;
        const successRate = total > 0 ? (category.passed / total * 100).toFixed(1) : 0;
        
        console.log('\n👤 PERSONALIZATION ENGINE TEST REPORT'.blue.bold);
        console.log('='.repeat(50).blue);
        console.log(`✅ Passed: ${category.passed.toString().green}`);
        console.log(`❌ Failed: ${category.failed.toString().red}`);
        console.log(`📈 Success Rate: ${successRate}%`.cyan);
        
        return {
            category: 'personalization',
            passed: category.passed,
            failed: category.failed,
            successRate: parseFloat(successRate),
            tests: category.tests
        };
    }
}

if (require.main === module) {
    (async () => {
        const tests = new PersonalizationTests();
        const results = await tests.runPersonalizationSpecificTests();
        process.exit(results.failed > 0 ? 1 : 0);
    })();
}

module.exports = PersonalizationTests;
