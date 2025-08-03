/**
 * Flow Designer Feature Tests
 */

const EnterpriseTestSuite = require('./integration.test');

class FlowDesignerTests extends EnterpriseTestSuite {
    constructor() {
        super();
        this.testCategory = 'flowDesigner';
    }

    async runFlowDesignerSpecificTests() {
        this.log('🎨 Running Flow Designer-Specific Tests...', 'header');
        
        await this.testFlowDesigner();
        await this.testComplexFlowCreation();
        
        return this.generateReport();
    }

    async testComplexFlowCreation() {
        this.log('🏗️ Testing Complex Flow Creation...', 'info');
        
        // Test complex conversation flow
        const complexFlow = {
            id: `complex_flow_${Date.now()}`,
            name: 'Multi-Branch Customer Service Flow',
            nodes: [
                { id: 'start', type: 'greeting', position: { x: 100, y: 100 }, config: { message: 'Welcome!' } },
                { id: 'intent_detection', type: 'question', position: { x: 300, y: 100 }, config: { prompt: 'How can I help?' } },
                { id: 'billing_branch', type: 'response', position: { x: 500, y: 50 }, config: { department: 'billing' } },
                { id: 'support_branch', type: 'response', position: { x: 500, y: 150 }, config: { department: 'support' } },
                { id: 'escalation', type: 'escalation', position: { x: 700, y: 100 }, config: { level: 'supervisor' } }
            ],
            connections: [
                { from: 'start', to: 'intent_detection', condition: '' },
                { from: 'intent_detection', to: 'billing_branch', condition: 'intent=billing' },
                { from: 'intent_detection', to: 'support_branch', condition: 'intent=support' },
                { from: 'billing_branch', to: 'escalation', condition: 'escalation_needed' },
                { from: 'support_branch', to: 'escalation', condition: 'escalation_needed' }
            ],
            version: '2.0',
            active: true
        };

        await this.testEndpoint(
            'Complex Flow Creation',
            'flowDesigner',
            `/api/ai-agent-logic/flow-designer/${this.config.COMPANY_ID}/flows`,
            'POST',
            complexFlow
        );

        // Test flow retrieval to verify save
        await this.testEndpoint(
            'Complex Flow Retrieval Verification',
            'flowDesigner',
            `/api/ai-agent-logic/flow-designer/${this.config.COMPANY_ID}/flows`
        );
    }

    generateReport() {
        const category = this.results.flowDesigner;
        const total = category.passed + category.failed;
        const successRate = total > 0 ? (category.passed / total * 100).toFixed(1) : 0;
        
        console.log('\n🎨 FLOW DESIGNER TEST REPORT'.blue.bold);
        console.log('='.repeat(50).blue);
        console.log(`✅ Passed: ${category.passed.toString().green}`);
        console.log(`❌ Failed: ${category.failed.toString().red}`);
        console.log(`📈 Success Rate: ${successRate}%`.cyan);
        
        return {
            category: 'flowDesigner',
            passed: category.passed,
            failed: category.failed,
            successRate: parseFloat(successRate),
            tests: category.tests
        };
    }
}

if (require.main === module) {
    (async () => {
        const tests = new FlowDesignerTests();
        const results = await tests.runFlowDesignerSpecificTests();
        process.exit(results.failed > 0 ? 1 : 0);
    })();
}

module.exports = FlowDesignerTests;
