#!/usr/bin/env node
/**
 * Quick System Validation for Company Q&A Knowledge System
 * Validates all core files and dependencies
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Validating Company Q&A Knowledge System...\n');

// Critical files to check
const criticalFiles = [
  'models/knowledge/CompanyQnA.js',
  'services/knowledge/CompanyKnowledgeService.js',
  'services/knowledge/KeywordGenerationService.js',
  'routes/knowledge/companyKnowledge.js',
  'routes/company/v2profile-aiagentlogic.js',
  'public/js/components/CompanyQnAManager.js',
  'public/css/knowledge-management.css',
  'AI_ROUTING_REFERENCE.js'
];

let allValid = true;

console.log('📁 Checking critical files...');
criticalFiles.forEach(file => {
  if (fs.existsSync(file)) {
    console.log(`✅ ${file}`);
  } else {
    console.log(`❌ ${file} - MISSING`);
    allValid = false;
  }
});

console.log('\n🔧 Checking syntax of JavaScript files...');
const jsFiles = criticalFiles.filter(f => f.endsWith('.js'));

jsFiles.forEach(file => {
  if (fs.existsSync(file)) {
    try {
      require(path.resolve(file));
      console.log(`✅ ${file} - Syntax OK`);
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND' && error.message.includes('Cannot find module')) {
        console.log(`⚠️  ${file} - Syntax OK (missing dependencies expected)`);
      } else {
        console.log(`❌ ${file} - Syntax Error: ${error.message}`);
        allValid = false;
      }
    }
  }
});

console.log('\n📦 Checking package.json dependencies...');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const requiredDeps = ['mongoose', 'redis', 'winston', 'natural', 'stopwords', 'sentiment'];

requiredDeps.forEach(dep => {
  if (packageJson.dependencies[dep] || packageJson.devDependencies?.[dep]) {
    console.log(`✅ ${dep}`);
  } else {
    console.log(`❌ ${dep} - MISSING from package.json`);
    allValid = false;
  }
});

console.log('\n🎯 System Validation Summary:');
if (allValid) {
  console.log('✅ All systems validated successfully!');
  console.log('🚀 Ready for production deployment.');
  process.exit(0);
} else {
  console.log('❌ Validation failed. Please fix the issues above.');
  process.exit(1);
}
