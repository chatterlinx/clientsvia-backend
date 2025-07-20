// test-transfer-router.js
// Test script for the Transfer Router system

const TransferRouter = require('./services/transferRouter');
const personnelConfig = require('./config/personnelConfig.json');
const moment = require('moment');

async function testTransferRouter() {
    console.log('🚀 Testing Transfer Router System...\n');

    // Initialize transfer router with personnel config
    const transferRouter = new TransferRouter(personnelConfig);
    
    console.log('👥 Loaded Personnel Configuration:');
    personnelConfig.forEach((person, index) => {
        console.log(`  ${index + 1}. ${person.name} (${person.label})`);
        console.log(`     Roles: ${person.roles.join(', ')}`);
        console.log(`     Transfer: ${person.allowDirectTransfer ? 'Yes' : 'Message Only'}`);
        console.log(`     Contact: ${person.phone || person.email}`);
        console.log('');
    });

    // Test different scenarios
    const testScenarios = [
        {
            query: "I want to talk to billing",
            description: "Customer wants billing department"
        },
        {
            query: "I need to speak with the manager",
            description: "Customer wants manager"
        },
        {
            query: "Can I talk to dispatch?",
            description: "Customer wants dispatch"
        },
        {
            query: "I want to speak with the owner",
            description: "Customer wants owner (message only)"
        },
        {
            query: "I need help with scheduling",
            description: "Customer wants scheduling help"
        },
        {
            query: "I want to talk to someone about quotes",
            description: "Customer wants quotes"
        }
    ];

    console.log('🎯 Testing Transfer Scenarios:\n');

    // Test during business hours (Monday 2 PM)
    const businessHour = moment().day(1).hour(14).minute(0); // Monday 2 PM
    console.log(`⏰ Testing during business hours: ${businessHour.format('dddd, MMMM Do YYYY, h:mm A')}\n`);

    testScenarios.forEach((scenario, index) => {
        console.log(`${index + 1}. ${scenario.description}`);
        console.log(`   Query: "${scenario.query}"`);
        
        const result = transferRouter.findBestTransferOption(scenario.query, businessHour);
        
        console.log(`   Result: ${result.type}`);
        console.log(`   Message: "${result.message}"`);
        
        if (result.target) {
            console.log(`   Target: ${result.target.name} (${result.target.label})`);
            if (result.fallback) {
                console.log(`   Fallback: ${result.fallback.via} to ${result.fallback.to}`);
            }
        }
        console.log('');
    });

    // Test during off hours (Sunday 10 PM)
    const offHour = moment().day(0).hour(22).minute(0); // Sunday 10 PM
    console.log(`🌙 Testing during off hours: ${offHour.format('dddd, MMMM Do YYYY, h:mm A')}\n`);

    testScenarios.slice(0, 3).forEach((scenario, index) => {
        console.log(`${index + 1}. ${scenario.description} (Off Hours)`);
        
        const result = transferRouter.findBestTransferOption(scenario.query, offHour);
        
        console.log(`   Result: ${result.type}`);
        console.log(`   Message: "${result.message}"`);
        console.log('');
    });

    // Test transfer statistics
    console.log('📊 Transfer Statistics:\n');
    
    const businessStats = transferRouter.getTransferStats(businessHour);
    console.log('During Business Hours:');
    console.log(`   Total Personnel: ${businessStats.totalPersonnel}`);
    console.log(`   Available: ${businessStats.available}`);
    console.log(`   Unavailable: ${businessStats.unavailable}`);
    console.log(`   Message Only: ${businessStats.messageOnly}`);
    console.log(`   Available Personnel: ${businessStats.availablePersonnel.map(p => p.name).join(', ')}`);
    console.log('');

    const offStats = transferRouter.getTransferStats(offHour);
    console.log('During Off Hours:');
    console.log(`   Total Personnel: ${offStats.totalPersonnel}`);
    console.log(`   Available: ${offStats.available}`);
    console.log(`   Unavailable: ${offStats.unavailable}`);
    console.log(`   Message Only: ${offStats.messageOnly}`);
    console.log(`   Available Personnel: ${offStats.availablePersonnel.map(p => p.name).join(', ') || 'None'}`);
    console.log('');

    // Test specific personnel lookup
    console.log('🔍 Testing Personnel Lookup:\n');
    
    const lookupTests = ['manager', 'owner', 'dispatcher'];
    lookupTests.forEach(role => {
        const escalation = transferRouter.getEscalationPolicy(role);
        if (escalation) {
            console.log(`${role.toUpperCase()}:`);
            console.log(`   Name: ${escalation.name}`);
            console.log(`   Can Transfer: ${escalation.canTransfer}`);
            console.log(`   Fallback Message: "${escalation.fallbackMessage}"`);
        } else {
            console.log(`${role.toUpperCase()}: Not found`);
        }
        console.log('');
    });

    console.log('🎯 Transfer Router test completed!');
}

// Test working hours validation
function testWorkingHours() {
    console.log('\n⏰ Testing Working Hours Validation:\n');
    
    const transferRouter = new TransferRouter(personnelConfig);
    const manager = personnelConfig.find(p => p.name === 'Steven Ferris');
    
    const testTimes = [
        moment().day(1).hour(9).minute(0),   // Monday 9 AM
        moment().day(1).hour(19).minute(0),  // Monday 7 PM
        moment().day(6).hour(12).minute(0),  // Saturday 12 PM
        moment().day(0).hour(15).minute(0)   // Sunday 3 PM
    ];
    
    testTimes.forEach(time => {
        const isAvailable = transferRouter.isWithinWorkingHours(manager, time);
        console.log(`${time.format('dddd h:mm A')}: ${isAvailable ? '✅ Available' : '❌ Unavailable'}`);
    });
}

// Run tests
if (require.main === module) {
    Promise.resolve()
        .then(() => testTransferRouter())
        .then(() => testWorkingHours())
        .catch(console.error);
}

module.exports = { testTransferRouter, testWorkingHours };
