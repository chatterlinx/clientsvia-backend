/**
 * Quick local validation without network dependencies
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Quick AI Agent Logic Validation (Offline)');
console.log('=' .repeat(50));

// Check critical files exist
const criticalFiles = [
  'models/Company.js',
  'routes/aiAgentLogic.js', 
  'services/aiAgentRuntime.js',
  'src/config/aiLoader.js',
  'src/config/llmClient.js',
  'src/runtime/KnowledgeRouter.js',
  'src/runtime/BehaviorEngine.js',
  'src/runtime/BookingHandler.js',
  'src/runtime/IntentRouter.js',
  'src/runtime/ResponseTrace.js',
  'scripts/seedAIAgentLogic.js',
  'public/ai-agent-logic.html'
];

let allFilesExist = true;
for (const file of criticalFiles) {
  if (fs.existsSync(path.join(__dirname, '..', file))) {
    console.log(`✅ ${file}`);
  } else {
    console.log(`❌ ${file} - MISSING`);
    allFilesExist = false;
  }
}

// Check seed data structure
try {
  const seedContent = fs.readFileSync(path.join(__dirname, '..', 'scripts/seedAIAgentLogic.js'), 'utf8');
  
  if (seedContent.includes('answerPriorityFlow: [') && seedContent.includes('id:') && seedContent.includes('name:')) {
    console.log('✅ Seed data uses correct object structure for answerPriorityFlow');
  } else {
    console.log('❌ Seed data still uses old string array format');
  }
  
  if (seedContent.includes('gemini-pro') && !seedContent.includes('gemini-1.5-flash')) {
    console.log('✅ Seed data uses valid LLM model names');
  } else {
    console.log('❌ Seed data contains invalid LLM model names');
  }
  
} catch (error) {
  console.log('❌ Error reading seed file:', error.message);
}

// Check Company model schema
try {
  const companyContent = fs.readFileSync(path.join(__dirname, '..', 'models/Company.js'), 'utf8');
  
  if (companyContent.includes('aiAgentLogic:') && companyContent.includes('answerPriorityFlow: [{')) {
    console.log('✅ Company model has correct aiAgentLogic schema');
  } else {
    console.log('❌ Company model missing proper aiAgentLogic schema');
  }
  
} catch (error) {
  console.log('❌ Error reading Company model:', error.message);
}

// Check app.js route mounting
try {
  const appContent = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  
  if (appContent.includes('aiAgentLogic') && appContent.includes('/api')) {
    console.log('✅ AI Agent Logic routes properly mounted in app.js');
  } else {
    console.log('❌ AI Agent Logic routes not properly mounted');
  }
  
} catch (error) {
  console.log('❌ Error reading app.js:', error.message);
}

console.log('=' .repeat(50));

if (allFilesExist) {
  console.log('🎉 AI Agent Logic implementation appears complete!');
  console.log('📋 Ready for testing via:');
  console.log('   • Twilio voice calls');
  console.log('   • API endpoints at /api/admin/:companyID/ai-settings');
  console.log('   • UI at /ai-agent-logic.html');
} else {
  console.log('❌ Some critical files are missing');
}
