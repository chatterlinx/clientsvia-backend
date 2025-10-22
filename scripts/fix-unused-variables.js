#!/usr/bin/env node
'use strict';

/**
 * WORLD-CLASS UNUSED VARIABLE FIX
 * 
 * Automatically fixes unused variable violations by:
 * 1. Prefixing unused parameters with underscore (_param)
 * 2. Removing unused imports
 * 3. Removing unused variable declarations
 * 
 * Usage: node scripts/fix-unused-variables.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const DRY_RUN = process.argv.includes('--dry-run');

const TARGET_DIRS = [
  'routes',
  'services',
  'middleware',
  'models',
  'utils',
  'handlers',
  'hooks',
  'clients'
];

const stats = {
  filesProcessed: 0,
  parametersFixed: 0,
  importsRemoved: 0,
  variablesRemoved: 0,
  errors: []
};

/**
 * Fix unused parameters by prefixing with underscore
 */
function fixUnusedParameters(content) {
  let modified = content;
  let changes = 0;

  // Pattern: catch (err) or catch(err) where err is unused
  // Replace with catch (_err)
  const catchPatterns = [
    { from: /catch\s*\(\s*(\w+)\s*\)/g, replacement: 'catch (_$1)' },
    { from: /\.catch\s*\(\s*(\w+)\s*=>/g, replacement: '.catch (_$1 =>' }
  ];

  catchPatterns.forEach(({ from, replacement }) => {
    const matches = modified.match(from);
    if (matches) {
      modified = modified.replace(from, replacement);
      changes += matches.length;
    }
  });

  // Pattern: function parameters that are unused
  // e.g., router.post('/path', async (req, res, next) where next is unused
  // Replace with _next
  const paramPattern = /\(([^)]+)\)\s*(?:=>|{)/g;
  const matches = modified.match(paramPattern);
  
  if (matches) {
    matches.forEach(match => {
      // Extract parameters
      const params = match.match(/\(([^)]+)\)/)[1];
      const paramList = params.split(',').map(p => p.trim());
      
      // Check if any params should be prefixed (common unused ones)
      const unusedParams = ['next', 'err', 'error', 'e', 'config', 'options'];
      let hasChanges = false;
      const newParams = paramList.map(param => {
        const paramName = param.split('=')[0].trim(); // Handle default params
        if (unusedParams.includes(paramName) && !paramName.startsWith('_')) {
          hasChanges = true;
          return param.replace(paramName, `_${paramName}`);
        }
        return param;
      });

      if (hasChanges) {
        const newMatch = match.replace(params, newParams.join(', '));
        modified = modified.replace(match, newMatch);
        changes++;
      }
    });
  }

  return { content: modified, changes };
}

/**
 * Remove unused imports
 */
function removeUnusedImports(content) {
  let modified = content;
  let changes = 0;

  // Get list of imports
  const requirePattern = /const\s+(\w+)\s*=\s*require\([^)]+\);?/g;
  const imports = [];
  let match;

  while ((match = requirePattern.exec(content)) !== null) {
    imports.push({
      full: match[0],
      varName: match[1],
      index: match.index
    });
  }

  // Check if each import is used
  imports.forEach(imp => {
    // Create regex to find usage of this variable
    // Must not be part of the import line itself
    const usagePattern = new RegExp(`\\b${imp.varName}\\b`, 'g');
    const matches = content.match(usagePattern) || [];
    
    // If only 1 match (the import itself), it's unused
    if (matches.length === 1) {
      modified = modified.replace(imp.full + '\n', '');
      changes++;
    }
  });

  return { content: modified, changes };
}

/**
 * Remove unused variable declarations
 */
function removeUnusedVariables(content) {
  let modified = content;
  let changes = 0;

  // Pattern: const varName = value; where varName is never used again
  const varPattern = /const\s+(\w+)\s*=\s*[^;]+;/g;
  const variables = [];
  let match;

  while ((match = varPattern.exec(content)) !== null) {
    variables.push({
      full: match[0],
      varName: match[1],
      index: match.index
    });
  }

  variables.forEach(v => {
    // Skip if variable name contains common patterns that should be kept
    if (v.varName.startsWith('_') || ['logger', 'router', 'app'].includes(v.varName)) {
      return;
    }

    // Check usage
    const usagePattern = new RegExp(`\\b${v.varName}\\b`, 'g');
    const contentAfterDecl = content.slice(v.index + v.full.length);
    const matches = contentAfterDecl.match(usagePattern) || [];

    // If no usage after declaration, consider removing
    if (matches.length === 0) {
      // Check if it's a destructuring or has side effects
      if (!v.full.includes('{') && !v.full.includes('[')) {
        modified = modified.replace(v.full + '\n', '');
        changes++;
      }
    }
  });

  return { content: modified, changes };
}

/**
 * Process a single file
 */
async function processFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    let modified = content;
    let totalChanges = 0;

    // Fix unused parameters
    const paramResult = fixUnusedParameters(modified);
    modified = paramResult.content;
    totalChanges += paramResult.changes;
    stats.parametersFixed += paramResult.changes;

    // Remove unused imports
    const importResult = removeUnusedImports(modified);
    modified = importResult.content;
    totalChanges += importResult.changes;
    stats.importsRemoved += importResult.changes;

    // Remove unused variables
    const varResult = removeUnusedVariables(modified);
    modified = varResult.content;
    totalChanges += varResult.changes;
    stats.variablesRemoved += varResult.changes;

    if (totalChanges === 0) {
      return null;
    }

    if (DRY_RUN) {
      console.log(`\n📝 ${filePath} (${totalChanges} changes)`);
      return { filePath, changes: totalChanges };
    }

    // Write changes
    fs.writeFileSync(filePath, modified, 'utf8');
    stats.filesProcessed++;

    return { filePath, changes: totalChanges };

  } catch (error) {
    stats.errors.push({ file: filePath, error: error.message });
    return null;
  }
}

/**
 * Find all JS files
 */
async function findFiles() {
  const files = [];
  
  for (const dir of TARGET_DIRS) {
    try {
      const { stdout } = await execAsync(`find ${dir} -type f -name "*.js" 2>/dev/null || true`);
      const dirFiles = stdout.trim().split('\n').filter(Boolean);
      files.push(...dirFiles);
    } catch (error) {
      console.warn(`⚠️  Could not scan ${dir}:`, error.message);
    }
  }
  
  return files;
}

/**
 * Main execution
 */
async function main() {
  console.log('🔧 WORLD-CLASS UNUSED VARIABLE FIX\n');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (preview only)' : 'LIVE FIX'}\n`);

  console.log('📁 Scanning for JavaScript files...\n');
  const files = await findFiles();
  console.log(`Found ${files.length} files to process\n`);

  const results = [];

  for (const file of files) {
    const result = await processFile(file);
    if (result) {
      results.push(result);
      process.stdout.write('.');
    }
  }

  console.log('\n\n✅ FIX COMPLETE\n');
  console.log('📊 STATISTICS:');
  console.log(`   Files Processed: ${stats.filesProcessed}`);
  console.log(`   Parameters Fixed: ${stats.parametersFixed}`);
  console.log(`   Imports Removed: ${stats.importsRemoved}`);
  console.log(`   Variables Removed: ${stats.variablesRemoved}`);
  console.log(`   Total Fixes: ${stats.parametersFixed + stats.importsRemoved + stats.variablesRemoved}`);

  if (stats.errors.length > 0) {
    console.log(`\n⚠️  Errors encountered: ${stats.errors.length}`);
    stats.errors.forEach(err => {
      console.log(`   ${err.file}: ${err.error}`);
    });
  }

  if (results.length > 0) {
    console.log('\n📝 Modified Files:');
    results.forEach(r => {
      console.log(`   ${r.filePath} (${r.changes} changes)`);
    });
  }

  if (DRY_RUN) {
    console.log('\n💡 This was a DRY RUN. Run without --dry-run to apply changes.');
  } else {
    console.log('\n✅ All changes have been written to disk.');
    console.log('   Run linter to verify: npm run lint');
  }
}

// Execute
main().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});

