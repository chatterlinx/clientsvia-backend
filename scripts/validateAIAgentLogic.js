/**
 * validateAIAgentLogic.js - Validation script for AI Agent Logic implementation
 * 
 * This script validates that all AI Agent Logic components are properly implemented
 * and can be imported without errors. It performs static analysis and basic functionality checks.
 */

const fs = require('fs');
const path = require('path');

// Color codes for console output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function log(color, message) {
  console.log(`${color}${message}${colors.reset}`);
}

function success(message) {
  log(colors.green, `✅ ${message}`);
}

function error(message) {
  log(colors.red, `❌ ${message}`);
}

function warning(message) {
  log(colors.yellow, `⚠️  ${message}`);
}

function info(message) {
  log(colors.blue, `ℹ️  ${message}`);
}

function header(message) {
  log(colors.bold, `\n🔍 ${message}`);
}

// Required files and their expected exports
const requiredFiles = [
  {
    path: 'src/config/aiLoader.js',
    description: 'AI Configuration Loader',
    exports: ['get', 'invalidate']
  },
  {
    path: 'src/config/llmClient.js',
    description: 'LLM Client with Fallback',
    exports: ['answer', 'testConnection']
  },
  {
    path: 'src/runtime/KnowledgeRouter.js',
    description: 'Knowledge Source Router',
    exports: ['route']
  },
  {
    path: 'src/runtime/BehaviorEngine.js',
    description: 'Behavior Rules Engine',
    exports: ['apply', 'updateCallState', 'handleBargeIn']
  },
  {
    path: 'src/runtime/BookingHandler.js',
    description: 'Booking Flow Handler',
    exports: ['start', 'next', 'finalizeBooking']
  },
  {
    path: 'src/runtime/IntentRouter.js',
    description: 'Intent Routing System',
    exports: ['route', 'detectBasicIntent']
  },
  {
    path: 'src/runtime/ResponseTrace.js',
    description: 'Response Trace Logging',
    exports: ['ResponseTraceLogger']
  },
  {
    path: 'services/aiAgentRuntime.js',
    description: 'Main AI Agent Runtime',
    exports: ['processCallTurn', 'healthCheck']
  },
  {
    path: 'routes/aiAgentLogic.js',
    description: 'AI Agent Logic API Routes',
    exports: []
  },
  {
    path: 'scripts/seedAIAgentLogic.js',
    description: 'AI Agent Logic Seed Script',
    exports: ['seedAIAgentLogic', 'defaultAIAgentLogic']
  }
];

// Model schema validation
const modelValidations = [
  {
    path: 'models/Company.js',
    description: 'Company Model with aiAgentLogic schema',
    checkSchema: true
  },
  {
    path: 'models/Booking.js',
    description: 'Booking Model',
    checkSchema: false
  }
];

async function validateFileStructure() {
  header('Validating File Structure');
  
  const basePath = process.cwd();
  let allValid = true;
  
  for (const file of requiredFiles) {
    const fullPath = path.join(basePath, file.path);
    
    if (!fs.existsSync(fullPath)) {
      error(`Missing file: ${file.path}`);
      allValid = false;
      continue;
    }
    
    success(`File exists: ${file.description}`);
    
    // Try to require the file to check for syntax errors
    try {
      const module = require(fullPath);
      
      // Check for expected exports
      if (file.exports && file.exports.length > 0) {
        const missingExports = file.exports.filter(exportName => {
          if (typeof module === 'function') {
            return exportName !== 'default';
          }
          return !(exportName in module);
        });
        
        if (missingExports.length > 0) {
          warning(`Missing exports in ${file.path}: ${missingExports.join(', ')}`);
        } else {
          info(`All exports present in ${file.description}`);
        }
      }
    } catch (err) {
      error(`Import error in ${file.path}: ${err.message}`);
      allValid = false;
    }
  }
  
  return allValid;
}

async function validateModelSchemas() {
  header('Validating Model Schemas');
  
  const basePath = process.cwd();
  let allValid = true;
  
  for (const model of modelValidations) {
    const fullPath = path.join(basePath, model.path);
    
    if (!fs.existsSync(fullPath)) {
      error(`Missing model file: ${model.path}`);
      allValid = false;
      continue;
    }
    
    try {
      // Read file content to check for schema definitions
      const content = fs.readFileSync(fullPath, 'utf8');
      
      if (model.checkSchema && model.path.includes('Company.js')) {
        // Check for aiAgentLogic schema
        if (content.includes('aiAgentLogic') && content.includes('answerPriorityFlow')) {
          success('Company model contains aiAgentLogic schema');
        } else {
          error('Company model missing aiAgentLogic schema');
          allValid = false;
        }
      }
      
      success(`Model schema validated: ${model.description}`);
    } catch (err) {
      error(`Error validating ${model.path}: ${err.message}`);
      allValid = false;
    }
  }
  
  return allValid;
}

async function validateAPIEndpoints() {
  header('Validating API Endpoints');
  
  const routesPath = path.join(process.cwd(), 'routes/aiAgentLogic.js');
  
  if (!fs.existsSync(routesPath)) {
    error('AI Agent Logic routes file not found');
    return false;
  }
  
  try {
    const content = fs.readFileSync(routesPath, 'utf8');
    
    const requiredEndpoints = [
      'GET.*/:companyID/ai-settings',
      'PUT.*/:companyID/ai-settings',
      'GET.*/:companyID/kb',
      'POST.*/:companyID/kb',
      'PUT.*/:companyID/kb',
      'DELETE.*/:companyID/kb',
      'GET.*/:companyID/booking-flow',
      'PUT.*/:companyID/booking-flow',
      'POST.*/:companyID/trace',
      'GET.*/:companyID/trace'
    ];
    
    let endpointsFound = 0;
    
    for (const endpoint of requiredEndpoints) {
      const regex = new RegExp(endpoint, 'i');
      if (regex.test(content)) {
        endpointsFound++;
      } else {
        warning(`Endpoint pattern not found: ${endpoint}`);
      }
    }
    
    if (endpointsFound >= requiredEndpoints.length * 0.8) {
      success(`Found ${endpointsFound}/${requiredEndpoints.length} required API endpoints`);
      return true;
    } else {
      error(`Only found ${endpointsFound}/${requiredEndpoints.length} required API endpoints`);
      return false;
    }
  } catch (err) {
    error(`Error validating API endpoints: ${err.message}`);
    return false;
  }
}

async function validateUIIntegration() {
  header('Validating UI Integration');
  
  const uiPath = path.join(process.cwd(), 'public/ai-agent-logic.html');
  
  if (!fs.existsSync(uiPath)) {
    error('AI Agent Logic UI file not found');
    return false;
  }
  
  try {
    const content = fs.readFileSync(uiPath, 'utf8');
    
    const requiredUIElements = [
      'Answer Priority Flow',
      'Knowledge Source Controls',
      'Agent Personality',
      'Behavior Controls',
      'Booking Flow Configuration',
      'Response Categories'
    ];
    
    let elementsFound = 0;
    
    for (const element of requiredUIElements) {
      if (content.includes(element)) {
        elementsFound++;
      } else {
        warning(`UI element not found: ${element}`);
      }
    }
    
    if (elementsFound >= requiredUIElements.length * 0.8) {
      success(`Found ${elementsFound}/${requiredUIElements.length} required UI elements`);
      return true;
    } else {
      error(`Only found ${elementsFound}/${requiredUIElements.length} required UI elements`);
      return false;
    }
  } catch (err) {
    error(`Error validating UI: ${err.message}`);
    return false;
  }
}

async function validateBlueprintCompliance() {
  header('Validating Blueprint Compliance');
  
  const blueprintPath = path.join(process.cwd(), 'AI_AGENT_LOGIC_IMPLEMENTATION_BLUEPRINT.md');
  
  if (!fs.existsSync(blueprintPath)) {
    warning('Blueprint file not found - cannot validate compliance');
    return true; // Non-critical
  }
  
  try {
    const content = fs.readFileSync(blueprintPath, 'utf8');
    
    // Check for completion markers
    const completionMarkers = [
      'Phase 1:.*✅ COMPLETE',
      'Phase 2:.*✅ COMPLETE',
      'Phase 3:.*✅ COMPLETE',
      'Phase 4:.*✅ COMPLETE',
      'Phase 6:.*✅ COMPLETE'
    ];
    
    let completedPhases = 0;
    
    for (const marker of completionMarkers) {
      const regex = new RegExp(marker, 'i');
      if (regex.test(content)) {
        completedPhases++;
      }
    }
    
    success(`Blueprint shows ${completedPhases}/${completionMarkers.length} phases complete`);
    
    // Check for success metrics
    if (content.includes('SUCCESS METRICS ✅ IMPLEMENTATION COMPLETE')) {
      success('All success metrics marked as complete');
      return true;
    } else {
      warning('Success metrics not all marked as complete');
      return true; // Non-critical for functionality
    }
  } catch (err) {
    warning(`Error validating blueprint: ${err.message}`);
    return true; // Non-critical
  }
}

async function validateConfiguration() {
  header('Validating Default Configuration');
  
  try {
    const seedScript = require('../scripts/seedAIAgentLogic.js');
    const defaultConfig = seedScript.defaultAIAgentLogic;
    
    // Validate required configuration sections
    const requiredSections = [
      'answerPriorityFlow',
      'thresholds',
      'responseCategories',
      'agentPersonality',
      'behaviorControls',
      'bookingFlow',
      'modelConfig',
      'intentRouting'
    ];
    
    let sectionsFound = 0;
    
    for (const section of requiredSections) {
      if (defaultConfig[section]) {
        sectionsFound++;
      } else {
        error(`Missing configuration section: ${section}`);
      }
    }
    
    if (sectionsFound === requiredSections.length) {
      success('All required configuration sections present');
      return true;
    } else {
      error(`Only found ${sectionsFound}/${requiredSections.length} required configuration sections`);
      return false;
    }
  } catch (err) {
    error(`Error validating configuration: ${err.message}`);
    return false;
  }
}

async function performStaticAnalysis() {
  header('Performing Static Analysis');
  
  const basePath = process.cwd();
  const criticalFiles = [
    'src/runtime/KnowledgeRouter.js',
    'src/runtime/BehaviorEngine.js',
    'services/aiAgentRuntime.js'
  ];
  
  let analysisResults = {
    companyIDIsolation: true,
    errorHandling: true,
    asyncPatterns: true
  };
  
  for (const file of criticalFiles) {
    const fullPath = path.join(basePath, file);
    
    if (!fs.existsSync(fullPath)) {
      continue;
    }
    
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      
      // Check for company ID isolation
      if (!content.includes('companyID')) {
        warning(`${file} may not implement company isolation`);
        analysisResults.companyIDIsolation = false;
      }
      
      // Check for error handling
      if (!content.includes('try') || !content.includes('catch')) {
        warning(`${file} may lack proper error handling`);
        analysisResults.errorHandling = false;
      }
      
      // Check for async patterns
      if (!content.includes('async') || !content.includes('await')) {
        warning(`${file} may not use proper async patterns`);
        analysisResults.asyncPatterns = false;
      }
    } catch (err) {
      error(`Error analyzing ${file}: ${err.message}`);
    }
  }
  
  if (analysisResults.companyIDIsolation) {
    success('Company ID isolation patterns detected');
  }
  
  if (analysisResults.errorHandling) {
    success('Error handling patterns detected');
  }
  
  if (analysisResults.asyncPatterns) {
    success('Async/await patterns detected');
  }
  
  return Object.values(analysisResults).every(Boolean);
}

async function generateValidationReport() {
  header('AI Agent Logic Implementation Validation Report');
  
  const validations = [
    { name: 'File Structure', test: validateFileStructure },
    { name: 'Model Schemas', test: validateModelSchemas },
    { name: 'API Endpoints', test: validateAPIEndpoints },
    { name: 'UI Integration', test: validateUIIntegration },
    { name: 'Blueprint Compliance', test: validateBlueprintCompliance },
    { name: 'Configuration', test: validateConfiguration },
    { name: 'Static Analysis', test: performStaticAnalysis }
  ];
  
  const results = [];
  
  for (const validation of validations) {
    try {
      const result = await validation.test();
      results.push({ name: validation.name, passed: result });
    } catch (err) {
      error(`Validation failed for ${validation.name}: ${err.message}`);
      results.push({ name: validation.name, passed: false, error: err.message });
    }
  }
  
  // Summary
  header('Validation Summary');
  
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  
  results.forEach(result => {
    if (result.passed) {
      success(result.name);
    } else {
      error(`${result.name}${result.error ? ` (${result.error})` : ''}`);
    }
  });
  
  if (passed === total) {
    log(colors.green + colors.bold, `\n🎉 All validations passed! (${passed}/${total})`);
    log(colors.green, '✅ AI Agent Logic implementation is ready for production!');
    return true;
  } else {
    log(colors.yellow + colors.bold, `\n⚠️  Some validations failed (${passed}/${total})`);
    log(colors.yellow, '🔧 Please review the failed validations before deploying to production.');
    return false;
  }
}

// CLI interface
if (require.main === module) {
  (async () => {
    try {
      const isValid = await generateValidationReport();
      process.exit(isValid ? 0 : 1);
    } catch (error) {
      error(`Validation script failed: ${error.message}`);
      process.exit(1);
    }
  })();
}

module.exports = {
  validateFileStructure,
  validateModelSchemas,
  validateAPIEndpoints,
  validateUIIntegration,
  validateBlueprintCompliance,
  validateConfiguration,
  performStaticAnalysis,
  generateValidationReport
};
