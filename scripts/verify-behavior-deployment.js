// scripts/verify-behavior-deployment.js
// Quick verification script to ensure behavior engine is properly deployed

const fs = require('fs');
const path = require('path');

function verifyBehaviorEngineDeployment() {
  console.log('🔍 Verifying Behavior Engine Deployment\n');
  
  const requiredFiles = [
    'utils/behaviorRules.js',
    'middleware/behaviorMiddleware.js', 
    'scripts/test-behavior-engine.js',
    'examples/agent-route-integration.js',
    'BEHAVIOR_ENGINE_DEPLOYMENT_GUIDE.md'
  ];
  
  let allFilesPresent = true;
  
  requiredFiles.forEach((file) => {
    const filePath = path.join(__dirname, '..', file);
    if (fs.existsSync(filePath)) {
      console.log(`✅ ${file}`);
    } else {
      console.log(`❌ ${file} - Missing!`);
      allFilesPresent = false;
    }
  });
  
  console.log('\n📋 Functionality Checks:');
  
  try {
    // Test core modules can be imported
    const { evaluateBehavior, getPenguinAirBehaviorRules } = require('../utils/behaviorRules');
    const { behaviorMiddleware } = require('../middleware/behaviorMiddleware');
    console.log('✅ Core modules import successfully');
    
    // Test basic behavior evaluation
    const mockCompany = { behaviorRules: getPenguinAirBehaviorRules() };
    const result = evaluateBehavior({
      transcript: "Are you a robot?",
      companyProfile: mockCompany,
      context: {}
    });
    
    if (result.action === 'humanize_response') {
      console.log('✅ Robot detection working correctly');
    } else {
      console.log('❌ Robot detection not working');
      allFilesPresent = false;
    }
    
    // Test technician detection
    const techResult = evaluateBehavior({
      transcript: "I need Dustin",
      companyProfile: mockCompany,
      context: {}
    });
    
    if (techResult.action === 'confirm_technician_request') {
      console.log('✅ Technician detection working correctly');
    } else {
      console.log('❌ Technician detection not working');
      allFilesPresent = false;
    }
    
  } catch (error) {
    console.log('❌ Module import/execution error:', error.message);
    allFilesPresent = false;
  }
  
  console.log('\n🎯 Deployment Status:');
  
  if (allFilesPresent) {
    console.log('🎉 DEPLOYMENT SUCCESSFUL!');
    console.log('\n📋 Ready for Production:');
    console.log('   1. Add behaviorMiddleware to your agent routes');
    console.log('   2. Test with live calls to Penguin Air');
    console.log('   3. Monitor behavioral event logs');
    console.log('\n🚀 Command to integrate:');
    console.log('   const { behaviorMiddleware } = require("./middleware/behaviorMiddleware");');
    console.log('   router.post("/agent/:companyId/voice", behaviorMiddleware, yourHandler);');
  } else {
    console.log('❌ DEPLOYMENT INCOMPLETE');
    console.log('Please ensure all required files are present and functional.');
  }
  
  return allFilesPresent;
}

if (require.main === module) {
  verifyBehaviorEngineDeployment();
}

module.exports = { verifyBehaviorEngineDeployment };
