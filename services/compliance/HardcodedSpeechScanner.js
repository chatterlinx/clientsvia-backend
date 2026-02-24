/**
 * ============================================================================
 * HARDCODED SPEECH SCANNER
 * ClientVia Compliance Engine · Detect Hardcoded Agent Responses
 * ============================================================================
 * 
 * PURPOSE:
 * ────────────────────────────────────────────────────────────────────────────
 * Scan codebase for hardcoded agent speech that violates the rule:
 * "All agent responses MUST be UI-driven. If it's not in UI, it does NOT exist."
 * 
 * DETECTION STRATEGY:
 * ────────────────────────────────────────────────────────────────────────────
 * Searches for common patterns in service and route files:
 * - replyText = "I'm sorry..."
 * - responseText: "Thank you..."
 * - nextPrompt = "Could you repeat..."
 * - say("Hello...")
 * 
 * ALLOWED EXCEPTIONS:
 * ────────────────────────────────────────────────────────────────────────────
 * - Test files (/tests/, test-)
 * - Seed data (DEFAULT_ constants with UI editing)
 * - Emergency fallbacks (with logger.error() calls)
 * - UI-backed speech (lines with 'uiPath' or 'uiConfig')
 * 
 * ARCHITECTURE:
 * ────────────────────────────────────────────────────────────────────────────
 * - Async file scanning with glob
 * - Line-by-line regex pattern matching
 * - Context-aware exception detection
 * - Severity classification (CRITICAL, HIGH, MEDIUM)
 * - Capped results (prevents JSON explosion)
 * 
 * USAGE:
 * ────────────────────────────────────────────────────────────────────────────
 * const scanner = new HardcodedSpeechScanner();
 * const report = await scanner.scan();
 * 
 * report.violations → Array of { file, line, code, severity, context }
 * 
 * ============================================================================
 * @module services/compliance/HardcodedSpeechScanner
 * @version 1.0.0
 * @date February 2026
 * ============================================================================
 */

const fs = require('fs').promises;
const path = require('path');
const glob = require('glob');
const { promisify } = require('util');
const logger = require('../../utils/logger');

const globAsync = promisify(glob);

const MODULE_ID = 'HARDCODED_SPEECH_SCANNER';

/**
 * ============================================================================
 * SCANNER CONFIGURATION
 * ============================================================================
 */
const SCAN_CONFIG = {
  // Directories to scan for violations
  scanDirs: [
    'services/engine',
    'services/engine/agent2',
    'services/engine/booking',
    'routes',
    'routes/admin'
  ],
  
  // File patterns to include
  includePatterns: ['**/*.js'],
  
  // Paths to exclude (never scan)
  excludePaths: [
    '**/node_modules/**',
    '**/tests/**',
    '**/test/**',
    '**/*.test.js',
    '**/*.spec.js',
    '**/test-*.js'
  ],
  
  // Max violations to return (prevent JSON explosion)
  maxViolations: 100,
  
  // Max line length in report (prevent massive code blocks)
  maxLineLength: 150
};

/**
 * ============================================================================
 * VIOLATION PATTERNS
 * ============================================================================
 */
const VIOLATION_PATTERNS = [
  // Pattern 1: Response text assignments
  {
    name: 'RESPONSE_TEXT_ASSIGNMENT',
    regex: /(?:replyText|responseText|nextPrompt|response|answer)\s*[=:]\s*["'`](Thank|I'm sorry|I am sorry|How can|Good |Hi |Hello|Could you|Please |Let me|Say that|One more|Repeat)/i,
    severity: 'CRITICAL',
    description: 'Hardcoded response text assignment'
  },
  
  // Pattern 2: Direct TTS/Say calls with hardcoded text
  {
    name: 'DIRECT_SAY_HARDCODED',
    regex: /\.say\s*\(\s*["'`](Thank|I'm sorry|How can|Good |Hi |Hello|Could you|Please)/i,
    severity: 'CRITICAL',
    description: 'Direct say() call with hardcoded text'
  },
  
  // Pattern 3: Greeting assignments
  {
    name: 'GREETING_ASSIGNMENT',
    regex: /(?:greeting|greetingText)\s*[=:]\s*["'`](?!.*\{.*\})(Thank|Good |Hi |Hello|Welcome)/i,
    severity: 'HIGH',
    description: 'Hardcoded greeting assignment'
  },
  
  // Pattern 4: Fallback/default text
  {
    name: 'FALLBACK_TEXT',
    regex: /(?:fallback|default|defaultText)\s*[=:]\s*["'`](Thank|I'm sorry|How can|Good |Hi |Hello)/i,
    severity: 'HIGH',
    description: 'Hardcoded fallback/default text'
  },
  
  // Pattern 5: Array of response variants
  {
    name: 'RESPONSE_ARRAY',
    regex: /\[\s*["'`](I'm sorry|Thank you|Could you|Please |Say that)/i,
    severity: 'MEDIUM',
    description: 'Hardcoded response variant array'
  }
];

/**
 * ============================================================================
 * ALLOWED CONTEXT PATTERNS (Exceptions)
 * ============================================================================
 */
const ALLOWED_CONTEXTS = [
  // Test files (already excluded by path, but double-check)
  { pattern: /test|spec|mock/i, reason: 'Test file' },
  
  // Seed data (acceptable if users can edit via UI)
  { pattern: /SEED|seed.*global|default.*rules/i, reason: 'Seed data (editable via UI)' },
  
  // UI-backed speech (safe - has UI editor)
  { pattern: /uiPath|uiConfig|fromUi|configPath/i, reason: 'UI-backed (has UI editor)' },
  
  // Emergency fallbacks (acceptable if logged)
  { pattern: /emergency.*fallback.*logger|logger.*emergency/i, reason: 'Emergency fallback (with logging)' },
  
  // Comments (not executed code)
  { pattern: /^\s*\/\/|^\s*\*/, reason: 'Comment (not code)' },
  
  // Database schema defaults (acceptable if UI exists)
  { pattern: /default:\s*["']/, reason: 'Database default (must have UI)' }
];

/**
 * ============================================================================
 * HARDCODED SPEECH SCANNER CLASS
 * ============================================================================
 */
class HardcodedSpeechScanner {
  constructor(options = {}) {
    this.config = { ...SCAN_CONFIG, ...options };
    this.violations = [];
    this.scannedFiles = 0;
    this.scannedLines = 0;
  }

  /**
   * ───────────────────────────────────────────────────────────────────────
   * MAIN SCAN FUNCTION
   * ───────────────────────────────────────────────────────────────────────
   */
  async scan() {
    const startTime = Date.now();
    this.violations = [];
    this.scannedFiles = 0;
    this.scannedLines = 0;
    
    logger.info(`[${MODULE_ID}] Starting scan`, {
      scanDirs: this.config.scanDirs
    });
    
    try {
      for (const dir of this.config.scanDirs) {
        await this.scanDirectory(dir);
      }
      
      const duration = Date.now() - startTime;
      
      logger.info(`[${MODULE_ID}] Scan complete`, {
        scannedFiles: this.scannedFiles,
        scannedLines: this.scannedLines,
        violations: this.violations.length,
        duration: `${duration}ms`
      });
      
      return this.buildReport(duration);
      
    } catch (error) {
      logger.error(`[${MODULE_ID}] Scan failed`, {
        error: error.message,
        stack: error.stack
      });
      
      return this.buildErrorReport(error);
    }
  }

  /**
   * ───────────────────────────────────────────────────────────────────────
   * SCAN DIRECTORY
   * ───────────────────────────────────────────────────────────────────────
   */
  async scanDirectory(dir) {
    const basePath = path.join(__dirname, '../../', dir);
    
    try {
      const files = await globAsync(this.config.includePatterns[0], {
        cwd: basePath,
        ignore: this.config.excludePaths,
        nodir: true
      });
      
      for (const file of files) {
        const fullPath = path.join(basePath, file);
        await this.scanFile(fullPath, `${dir}/${file}`);
      }
      
    } catch (error) {
      logger.warn(`[${MODULE_ID}] Failed to scan directory: ${dir}`, {
        error: error.message
      });
    }
  }

  /**
   * ───────────────────────────────────────────────────────────────────────
   * SCAN FILE
   * ───────────────────────────────────────────────────────────────────────
   */
  async scanFile(fullPath, relativePath) {
    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      const lines = content.split('\n');
      
      this.scannedFiles++;
      this.scannedLines += lines.length;
      
      lines.forEach((line, index) => {
        this.scanLine(line, relativePath, index + 1);
      });
      
    } catch (error) {
      logger.warn(`[${MODULE_ID}] Failed to read file: ${relativePath}`, {
        error: error.message
      });
    }
  }

  /**
   * ───────────────────────────────────────────────────────────────────────
   * SCAN LINE
   * ───────────────────────────────────────────────────────────────────────
   */
  scanLine(line, file, lineNumber) {
    // Check if line is in allowed context (exception)
    for (const allowedContext of ALLOWED_CONTEXTS) {
      if (allowedContext.pattern.test(line)) {
        return; // Skip - allowed exception
      }
    }
    
    // Check each violation pattern
    for (const pattern of VIOLATION_PATTERNS) {
      if (pattern.regex.test(line)) {
        // Cap violations to prevent memory issues
        if (this.violations.length >= this.config.maxViolations) {
          return;
        }
        
        this.violations.push({
          file,
          line: lineNumber,
          code: this.truncateLine(line.trim()),
          pattern: pattern.name,
          severity: pattern.severity,
          description: pattern.description,
          rule: 'All agent speech must be UI-driven'
        });
      }
    }
  }

  /**
   * ───────────────────────────────────────────────────────────────────────
   * TRUNCATE LINE (Prevent huge code blocks in report)
   * ───────────────────────────────────────────────────────────────────────
   */
  truncateLine(line) {
    if (line.length <= this.config.maxLineLength) {
      return line;
    }
    return line.substring(0, this.config.maxLineLength) + '...';
  }

  /**
   * ───────────────────────────────────────────────────────────────────────
   * BUILD REPORT
   * ───────────────────────────────────────────────────────────────────────
   */
  buildReport(duration) {
    const criticalCount = this.violations.filter(v => v.severity === 'CRITICAL').length;
    const highCount = this.violations.filter(v => v.severity === 'HIGH').length;
    const mediumCount = this.violations.filter(v => v.severity === 'MEDIUM').length;
    
    return {
      scanStatus: 'SUCCESS',
      scannedAt: new Date().toISOString(),
      duration: `${duration}ms`,
      scannedFiles: this.scannedFiles,
      scannedLines: this.scannedLines,
      scannedDirs: this.config.scanDirs,
      
      violations: {
        total: this.violations.length,
        critical: criticalCount,
        high: highCount,
        medium: mediumCount,
        list: this.violations,
        capped: this.violations.length >= this.config.maxViolations,
        capNote: this.violations.length >= this.config.maxViolations 
          ? `Showing first ${this.config.maxViolations} violations only` 
          : null
      },
      
      summary: {
        status: criticalCount > 0 ? 'VIOLATIONS_FOUND' : 'CLEAN',
        message: criticalCount > 0 
          ? `${criticalCount} critical violation(s) detected` 
          : 'No critical violations found',
        recommendation: criticalCount > 0 
          ? 'Fix critical violations before production deployment' 
          : 'System is compliant'
      }
    };
  }

  /**
   * ───────────────────────────────────────────────────────────────────────
   * BUILD ERROR REPORT
   * ───────────────────────────────────────────────────────────────────────
   */
  buildErrorReport(error) {
    return {
      scanStatus: 'ERROR',
      error: error.message,
      scannedAt: new Date().toISOString(),
      violations: {
        total: 0,
        list: [],
        note: 'Scan failed - no results available'
      }
    };
  }
}

/**
 * ============================================================================
 * CONVENIENCE FUNCTION (for Truth Export)
 * ============================================================================
 */
async function scanForHardcodedSpeech() {
  const scanner = new HardcodedSpeechScanner();
  return await scanner.scan();
}

/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 */
module.exports = {
  HardcodedSpeechScanner,
  scanForHardcodedSpeech
};
