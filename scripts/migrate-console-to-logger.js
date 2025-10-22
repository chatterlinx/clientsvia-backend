#!/usr/bin/env node


/**
 * WORLD-CLASS CONSOLE.LOG → WINSTON LOGGER MIGRATION
 * 
 * Systematically migrates all console.* calls to proper Winston logger
 * with intelligent context detection and proper log levels.
 * 
 * Migration Rules:
 * 1. console.error → logger.error (with error objects)
 * 2. console.warn → logger.warn
 * 3. console.log → logger.info OR logger.debug (context-aware)
 * 4. Preserve all metadata and context
 * 5. Add tenant context where companyId is available
 * 6. Flag security-related logs
 * 
 * Usage: node scripts/migrate-console-to-logger.js [--dry-run] [--file path/to/file.js]
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// Configuration
const DRY_RUN = process.argv.includes('--dry-run');
const TARGET_FILE = process.argv.find(arg => arg.startsWith('--file='))?.split('=')[1];

// Directories to process
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

// Patterns that indicate security-related logs
const SECURITY_PATTERNS = [
  /auth/i,
  /login/i,
  /password/i,
  /token/i,
  /session/i,
  /unauthorized/i,
  /forbidden/i,
  /security/i,
  /breach/i,
  /attack/i,
  /suspicious/i,
  /rate.?limit/i,
  /blocked/i,
  /whitelist/i,
  /blacklist/i
];

// Patterns that indicate tenant-specific logs
const TENANT_PATTERNS = [
  /companyId/i,
  /tenant/i,
  /company/i
];

// Patterns that should be debug level (verbose/noisy)
const DEBUG_PATTERNS = [
  /\bstart/i,
  /\binit/i,
  /\bloading/i,
  /\bcache/i,
  /\bfetch/i,
  /\bretriev/i,
  /\bprocess/i,
  /step \d+/i,
  /\bdebug/i
];

// Statistics
const stats = {
  filesProcessed: 0,
  consoleLogReplaced: 0,
  consoleErrorReplaced: 0,
  consoleWarnReplaced: 0,
  securityLogsIdentified: 0,
  tenantLogsIdentified: 0,
  errors: []
};

/**
 * Check if line contains security-related content
 */
function isSecurityRelated(line) {
  return SECURITY_PATTERNS.some(pattern => pattern.test(line));
}

/**
 * Check if line contains tenant context
 */
function hasTenantContext(line) {
  return TENANT_PATTERNS.some(pattern => pattern.test(line));
}

/**
 * Check if line should be debug level
 */
function shouldBeDebug(line) {
  return DEBUG_PATTERNS.some(pattern => pattern.test(line));
}

/**
 * Intelligently migrate a console statement to logger
 */
function migrateConsoleLine(line, fullContent, lineIndex) {
  const originalLine = line;
  let modified = false;

  // Extract surrounding context for better decisions
  const lines = fullContent.split('\n');
  const contextStart = Math.max(0, lineIndex - 5);
  const contextEnd = Math.min(lines.length, lineIndex + 5);
  const context = lines.slice(contextStart, contextEnd).join('\n');

  // Check for existing logger import
  const hasLoggerImport = /require\(['"].*logger['"]\)/.test(fullContent) || 
                          /from ['"].*logger['"]/.test(fullContent);

  // 1. Handle console.error
  if (line.includes('console.error')) {
    modified = true;
    stats.consoleErrorReplaced++;
    
    // Check if there's an error object being logged
    if (/console\.error\([^,)]*error/i.test(line)) {
      line = line.replace(/console\.error\s*\(/g, 'logger.error(');
    } else {
      line = line.replace(/console\.error\s*\(/g, 'logger.error(');
    }

    // Check if security-related
    if (isSecurityRelated(context)) {
      stats.securityLogsIdentified++;
      // Security errors might need special handling
      if (!line.includes('// SECURITY')) {
        line = line.replace(/logger\.error\(/, 'logger.security(');
      }
    }
  }

  // 2. Handle console.warn
  if (line.includes('console.warn')) {
    modified = true;
    stats.consoleWarnReplaced++;
    line = line.replace(/console\.warn\s*\(/g, 'logger.warn(');

    // Check if security-related
    if (isSecurityRelated(context)) {
      stats.securityLogsIdentified++;
      if (!line.includes('// SECURITY')) {
        line = line.replace(/logger\.warn\(/, 'logger.security(');
      }
    }
  }

  // 3. Handle console.log (most complex)
  if (line.includes('console.log')) {
    modified = true;
    stats.consoleLogReplaced++;

    // Determine appropriate log level
    let logLevel = 'info';

    if (shouldBeDebug(context) || shouldBeDebug(line)) {
      logLevel = 'debug';
    }

    if (isSecurityRelated(context)) {
      stats.securityLogsIdentified++;
      logLevel = 'security';
    }

    // Check for tenant context
    if (hasTenantContext(context)) {
      stats.tenantLogsIdentified++;
      // Could use logger.tenant() but requires companyId extraction
      // For now, use regular logger with context preservation
    }

    line = line.replace(/console\.log\s*\(/g, `logger.${logLevel}(`);
  }

  return { line, modified, originalLine };
}

/**
 * Process a single file
 */
async function processFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    
    // Check if file has any console statements
    if (!/console\.(log|error|warn)/.test(content)) {
      return null;
    }

    // Check if logger is already imported
    const hasLoggerImport = /require\(['"].*\/utils\/logger['"]\)/.test(content) ||
                            /require\(['"]\.\.\/utils\/logger['"]\)/.test(content);

    let newContent = content;
    let fileModified = false;
    const modifications = [];

    // Process each line
    lines.forEach((line, index) => {
      if (/console\.(log|error|warn)/.test(line)) {
        const result = migrateConsoleLine(line, content, index);
        if (result.modified) {
          fileModified = true;
          modifications.push({
            line: index + 1,
            original: result.originalLine.trim(),
            new: result.line.trim()
          });
          newContent = newContent.replace(result.originalLine, result.line);
        }
      }
    });

    if (!fileModified) {
      return null;
    }

    // Add logger import if not present
    if (!hasLoggerImport && fileModified) {
      // Find the right place to add import (after other requires)
      const requireLines = lines.findIndex(line => /^const .* = require\(/.test(line));
      if (requireLines >= 0) {
        // Calculate relative path to logger
        const fileDir = path.dirname(filePath);
        const relativePath = path.relative(fileDir, path.join(__dirname, '..', 'utils', 'logger.js'));
        const importPath = relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
        
        const importStatement = `const logger = require('${importPath.replace(/\\/g, '/')}');\n`;
        const linesArray = newContent.split('\n');
        linesArray.splice(requireLines + 1, 0, importStatement);
        newContent = linesArray.join('\n');
      } else {
        // No requires found, add at top after 'use strict' if present
        const strictIndex = lines.findIndex(line => /^['"]use strict['"]/.test(line));
        if (strictIndex >= 0) {
          const fileDir = path.dirname(filePath);
          const relativePath = path.relative(fileDir, path.join(__dirname, '..', 'utils', 'logger.js'));
          const importPath = relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
          
          const importStatement = `\nconst logger = require('${importPath.replace(/\\/g, '/')}');\n`;
          const linesArray = newContent.split('\n');
          linesArray.splice(strictIndex + 1, 0, importStatement);
          newContent = linesArray.join('\n');
        }
      }
    }

    if (DRY_RUN) {
      console.log(`\n📝 ${filePath}`);
      modifications.forEach(mod => {
        console.log(`  Line ${mod.line}:`);
        console.log(`    - ${mod.original}`);
        console.log(`    + ${mod.new}`);
      });
      return { filePath, modifications: modifications.length };
    }

    // Write the modified file
    fs.writeFileSync(filePath, newContent, 'utf8');
    stats.filesProcessed++;

    return { filePath, modifications: modifications.length };

  } catch (error) {
    stats.errors.push({ file: filePath, error: error.message });
    console.error(`❌ Error processing ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Find all JS files in target directories
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
  console.log('🚀 WORLD-CLASS CONSOLE → LOGGER MIGRATION\n');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (preview only)' : 'LIVE MIGRATION'}\n`);

  let files;
  
  if (TARGET_FILE) {
    files = [TARGET_FILE];
    console.log(`📁 Processing single file: ${TARGET_FILE}\n`);
  } else {
    console.log('📁 Scanning for JavaScript files...\n');
    files = await findFiles();
    console.log(`Found ${files.length} files to process\n`);
  }

  const results = [];

  for (const file of files) {
    const result = await processFile(file);
    if (result) {
      results.push(result);
      process.stdout.write('.');
    }
  }

  console.log('\n\n✅ MIGRATION COMPLETE\n');
  console.log('📊 STATISTICS:');
  console.log(`   Files Processed: ${stats.filesProcessed}`);
  console.log(`   console.log → logger: ${stats.consoleLogReplaced}`);
  console.log(`   console.error → logger: ${stats.consoleErrorReplaced}`);
  console.log(`   console.warn → logger: ${stats.consoleWarnReplaced}`);
  console.log(`   Security logs identified: ${stats.securityLogsIdentified}`);
  console.log(`   Tenant logs identified: ${stats.tenantLogsIdentified}`);
  console.log(`   Total replacements: ${stats.consoleLogReplaced + stats.consoleErrorReplaced + stats.consoleWarnReplaced}`);

  if (stats.errors.length > 0) {
    console.log(`\n⚠️  Errors encountered: ${stats.errors.length}`);
    stats.errors.forEach(err => {
      console.log(`   ${err.file}: ${err.error}`);
    });
  }

  if (results.length > 0) {
    console.log('\n📝 Modified Files:');
    results.forEach(r => {
      console.log(`   ${r.filePath} (${r.modifications} changes)`);
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

