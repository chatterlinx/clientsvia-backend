/**
 * ════════════════════════════════════════════════════════════════════════════
 * TRUTH EXPORT ENDPOINT
 * ClientVia Agent Console · Complete System Truth Contract Generator
 * ════════════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE:
 * ────────────────────────────────────────────────────────────────────────────
 * Generate complete, verifiable Truth JSON that proves:
 * 
 * LANE A — UI SOURCE TRUTH: What files are deployed in Agent Console
 * LANE B — RUNTIME TRUTH: What config will be used for this company
 * LANE C — BUILD TRUTH: What build/deployment is running
 * LANE D — COMPLIANCE TRUTH: What violations exist (UI coverage gaps)
 * 
 * RULE:
 * ────────────────────────────────────────────────────────────────────────────
 * "If it's not in UI, it does NOT exist."
 * 
 * This is a CONTRACT, not a feature. It provides an enforceable guarantee
 * that prevents silent failures, missing pages, and hardcoded responses.
 * 
 * The Truth export:
 * 1. Proves what's deployed (UI files + hashes)
 * 2. Proves what's configured (runtime config for company)
 * 3. Proves what build is running (git commit, timestamp)
 * 4. Proves what's broken (compliance violations)
 * 
 * ARCHITECTURE:
 * ────────────────────────────────────────────────────────────────────────────
 * - Glob-based file discovery (never miss a new page)
 * - Deterministic JSON (stable key ordering for hashing)
 * - Self-validating (truthStatus: COMPLETE or INCOMPLETE with reasons)
 * - Scalable (optional content embedding, default is metadata only)
 * - Parallel execution (all lanes run simultaneously)
 * 
 * API:
 * ────────────────────────────────────────────────────────────────────────────
 * GET /api/agent-console/truth/export?companyId={id}[&includeContents=1]
 * 
 * Query Parameters:
 * - companyId (required) - Company ID to scope runtime config
 * - includeContents (optional, 0|1) - Include base64 file contents
 * - includeLargeAssets (optional, 0|1) - Include images, fonts, etc.
 * 
 * Response:
 * - 200: Truth JSON (see TruthExportV1 schema)
 * - 400: Missing companyId
 * - 401: Unauthorized
 * - 500: Export failed
 * 
 * ════════════════════════════════════════════════════════════════════════════
 * @module routes/agentConsole/truthExport
 * @version 1.0.0
 * @date February 2026
 * ════════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();
const { authenticateJWT } = require('../../middleware/auth');
const { requirePermission, PERMISSIONS } = require('../../middleware/rbac');
const v2Company = require('../../models/v2Company');
const logger = require('../../utils/logger');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const glob = require('glob');
const { promisify } = require('util');

const globAsync = promisify(glob);

// Compliance scanner
const { scanForHardcodedSpeech } = require('../../services/compliance/HardcodedSpeechScanner');

// Truth manifest (required files, modals, etc.)
const truthManifest = require('../../config/truthManifest');

// Constants
const MODULE_ID = 'TRUTH_EXPORT';
const TRUTH_VERSION = '1.1.0'; // Bumped for manifest-based completeness
const AGENT_CONSOLE_DIR = path.join(__dirname, '../../public/agent-console');
const REPO_ROOT = path.join(__dirname, '../../');
const BACKEND_SOURCE_FILES = [
  'routes/v2twilio.js',
  'services/engine/booking/BookingLogicEngine.js',
  'services/engine/agent2/Agent2DiscoveryEngine.js',
  'routes/agentConsole/agentConsole.js',
  'routes/agentConsole/truthExport.js'
];

/**
 * ════════════════════════════════════════════════════════════════════════════
 * LANE A: UI SOURCE TRUTH
 * ════════════════════════════════════════════════════════════════════════════
 * 
 * Scans public/agent-console/** for all UI files.
 * Returns file manifests with paths, sizes, hashes, and optional contents.
 * 
 * GLOB-BASED: Automatically includes new pages without code changes.
 * DETERMINISTIC: Stable ordering, consistent hashing.
 * SCALABLE: Contents optional (prevents JSON explosion).
 * ════════════════════════════════════════════════════════════════════════════
 */
async function buildUiSourceTruth(includeContents = false, includeLargeAssets = false) {
  const startTime = Date.now();
  
  logger.debug(`[${MODULE_ID}] Building UI Source Truth`, {
    includeContents,
    includeLargeAssets,
    agentConsoleDir: AGENT_CONSOLE_DIR
  });
  
  // Verify directory exists (helps diagnose production path issues)
  try {
    await fs.access(AGENT_CONSOLE_DIR);
  } catch (err) {
    throw new Error(`Agent Console directory not found: ${AGENT_CONSOLE_DIR}`);
  }
  
  // File type patterns to include
  const patterns = [
    '**/*.html',
    '**/*.js',
    '**/*.css',
    'lib/**/*'
  ];
  
  if (includeLargeAssets) {
    patterns.push('**/*.png', '**/*.jpg', '**/*.svg', '**/*.woff', '**/*.woff2');
  }
  
  // Denylist: Exclude junk
  const denylist = [
    '**/*.map',
    '**/.DS_Store',
    '**/node_modules/**',
    '**/.git/**'
  ];
  
  // Discover all files
  const allFiles = [];
  
  for (const pattern of patterns) {
    try {
      const files = await globAsync(pattern, {
        cwd: AGENT_CONSOLE_DIR,
        ignore: denylist,
        nodir: true,
        dot: false
      });
      allFiles.push(...files);
    } catch (error) {
      logger.warn(`[${MODULE_ID}] Glob pattern failed: ${pattern}`, {
        error: error.message
      });
    }
  }
  
  // Remove duplicates, sort for deterministic output
  const uniqueFiles = [...new Set(allFiles)].sort();
  
  logger.info(`[${MODULE_ID}] UI files discovered`, {
    count: uniqueFiles.length,
    patterns
  });
  
  // Build file manifests (parallel)
  const fileManifests = await Promise.all(uniqueFiles.map(async (relPath) => {
    return await buildFileManifest(relPath, includeContents);
  }));
  
  // Discover pages (HTML files at root)
  const pageDiscovery = await discoverPages(uniqueFiles);
  
  // Discover modals (scan HTML for modal-backdrop)
  const modalDiscovery = await discoverModals(uniqueFiles);
  
  // Validate internal links
  const linkValidation = await validateLinks(fileManifests, uniqueFiles);
  
  const duration = Date.now() - startTime;
  
  return {
    totalFiles: fileManifests.length,
    totalBytes: fileManifests.reduce((sum, file) => sum + (file.size || 0), 0),
    totalLines: fileManifests.reduce((sum, file) => sum + (file.lineCount || 0), 0),
    includeContents,
    files: fileManifests,
    pageDiscovery,
    modalDiscovery,
    linkValidation,
    scannedAt: new Date().toISOString(),
    scanDuration: `${duration}ms`
  };
}

/**
 * ───────────────────────────────────────────────────────────────────────────
 * BUILD FILE MANIFEST
 * ───────────────────────────────────────────────────────────────────────────
 */
async function buildFileManifest(relPath, includeContents) {
  const fullPath = path.join(AGENT_CONSOLE_DIR, relPath);
  
  try {
    const stats = await fs.stat(fullPath);
    const content = await fs.readFile(fullPath);
    
    // Compute SHA-256 hash
    const hash = crypto.createHash('sha256');
    hash.update(content);
    const sha256 = hash.digest('hex');
    
    const lineCount = content.toString('utf-8').split('\n').length;
    const manifest = {
      path: `/agent-console/${relPath}`,
      relativePath: relPath,
      size: stats.size,
      lineCount,
      lastModified: stats.mtime.toISOString(),
      sha256,
      contentBase64: null
    };
    
    // Include contents if requested
    if (includeContents) {
      manifest.contentBase64 = content.toString('base64');
    }
    
    return manifest;
    
  } catch (error) {
    logger.warn(`[${MODULE_ID}] Failed to process file: ${relPath}`, {
      error: error.message
    });
    
    return {
      path: `/agent-console/${relPath}`,
      relativePath: relPath,
      error: error.message
    };
  }
}

/**
 * ───────────────────────────────────────────────────────────────────────────
 * DISCOVER PAGES (manifest-based)
 * ───────────────────────────────────────────────────────────────────────────
 */
async function discoverPages(allFiles) {
  const htmlFiles = allFiles.filter(f => f.endsWith('.html') && !f.includes('/'));
  
  // Use manifest for expected pages
  const expectedPages = Object.keys(truthManifest.PAGE_CONTROLLER_MAP);
  
  const pages = htmlFiles.map(file => {
    const expectedController = truthManifest.PAGE_CONTROLLER_MAP[file];
    return {
      filename: file,
      url: `/agent-console/${file}`,
      jsController: expectedController || file.replace('.html', '.js'),
      jsControllerExists: allFiles.includes(expectedController || file.replace('.html', '.js')),
      inManifest: expectedPages.includes(file)
    };
  });
  
  // Missing = in manifest but not found
  const missingPages = expectedPages.filter(p => !htmlFiles.includes(p));
  
  // Extra = found but not in manifest (requires manifest update)
  const extraPages = pages.filter(p => !p.inManifest);
  
  // Determine status
  let status = 'COMPLETE';
  if (missingPages.length > 0) {
    status = 'REQUIRED_PAGES_MISSING';
  } else if (extraPages.length > 0) {
    status = 'MANIFEST_UPDATE_NEEDED';
  }
  
  return {
    totalPages: pages.length,
    pages,
    manifestExpected: expectedPages,
    missingRequired: missingPages,
    extraNotInManifest: extraPages.map(p => p.filename),
    status,
    note: extraPages.length > 0 
      ? 'Extra pages found - update config/truthManifest.js to include them'
      : null
  };
}

/**
 * ───────────────────────────────────────────────────────────────────────────
 * DISCOVER MODALS (manifest-based)
 * ───────────────────────────────────────────────────────────────────────────
 */
async function discoverModals(allFiles) {
  const htmlFiles = allFiles.filter(f => f.endsWith('.html'));
  const foundModals = [];
  
  for (const file of htmlFiles) {
    const fullPath = path.join(AGENT_CONSOLE_DIR, file);
    
    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      
      // Find all modal IDs
      const modalMatches = content.matchAll(/id=["'](modal-[^"']+)["']/g);
      
      for (const match of modalMatches) {
        const modalId = match[1];
        
        // Skip ignored IDs (close buttons, sub-elements, etc.)
        if (truthManifest.IGNORED_MODAL_IDS.includes(modalId)) {
          continue;
        }
        
        const manifestEntry = truthManifest.REQUIRED_MODALS.find(m => m.id === modalId);
        
        foundModals.push({
          modalId,
          page: file,
          pageUrl: `/agent-console/${file}`,
          inManifest: !!manifestEntry,
          purpose: manifestEntry?.purpose || 'Not documented in manifest'
        });
      }
      
    } catch (error) {
      logger.warn(`[${MODULE_ID}] Failed to scan ${file} for modals`, {
        error: error.message
      });
    }
  }
  
  // Expected from manifest
  const expectedModalIds = truthManifest.REQUIRED_MODALS.map(m => m.id);
  const foundModalIds = foundModals.map(m => m.modalId);
  
  // Missing = in manifest but not found
  const missingModals = truthManifest.REQUIRED_MODALS
    .filter(m => !foundModalIds.includes(m.id))
    .map(m => ({ id: m.id, expectedPage: m.page, purpose: m.purpose }));
  
  // Extra = found but not in manifest (requires manifest update)
  const extraModals = foundModals.filter(m => !m.inManifest);
  
  // Determine status
  let status = 'COMPLETE';
  if (missingModals.length > 0) {
    status = 'REQUIRED_MODALS_MISSING';
  } else if (extraModals.length > 0) {
    status = 'MANIFEST_UPDATE_NEEDED';
  }
  
  return {
    totalModals: foundModals.length,
    modals: foundModals,
    manifestExpected: truthManifest.REQUIRED_MODALS,
    missingRequired: missingModals,
    extraNotInManifest: extraModals,
    ignoredIds: truthManifest.IGNORED_MODAL_IDS,
    status,
    note: extraModals.length > 0 
      ? 'Extra modals found - update config/truthManifest.js to include them'
      : null
  };
}

/**
 * ───────────────────────────────────────────────────────────────────────────
 * VALIDATE LINKS
 * ───────────────────────────────────────────────────────────────────────────
 */
async function validateLinks(fileManifests, allFiles) {
  const issues = [];
  const filePaths = new Set(allFiles.map(f => `/agent-console/${f}`));
  
  // Only validate HTML files
  const htmlManifests = fileManifests.filter(f => f.relativePath && f.relativePath.endsWith('.html'));
  
  for (const file of htmlManifests) {
    if (file.error) continue; // Skip files with read errors
    
    const fullPath = path.join(AGENT_CONSOLE_DIR, file.relativePath);
    
    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      
      // Find all href and src attributes
      const linkMatches = content.matchAll(/(?:href|src)=["']([^"']+)["']/g);
      
      for (const match of linkMatches) {
        const link = match[1];
        
        // Only check internal agent-console links
        if (link.includes('/agent-console/') && !link.startsWith('http') && !link.startsWith('//')) {
          // Remove query params and hash
          const cleanLink = link.split('?')[0].split('#')[0];
          
          // Check if file exists in our discovered files
          if (!filePaths.has(cleanLink)) {
            issues.push({
              sourceFile: file.path,
              missingLink: cleanLink,
              fullLink: link,
              severity: 'WARNING'
            });
          }
        }
      }
      
    } catch (error) {
      logger.warn(`[${MODULE_ID}] Failed to validate links in ${file.relativePath}`, {
        error: error.message
      });
    }
  }
  
  return {
    totalIssues: issues.length,
    brokenLinks: issues,
    status: issues.length > 0 ? 'BROKEN_LINKS_FOUND' : 'VALID'
  };
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * LANE B: RUNTIME TRUTH
 * ════════════════════════════════════════════════════════════════════════════
 * 
 * Extracts effective configuration for this company.
 * This is what will ACTUALLY run when a call comes in.
 * 
 * Includes:
 * - Agent 2.0 settings (greetings, triggers, discovery)
 * - Booking settings
 * - Voice settings
 * - LLM controls
 * - Calendar connection
 * 
 * HASH: Computed from canonical JSON (stable key order) for verification.
 * ════════════════════════════════════════════════════════════════════════════
 */
async function buildRuntimeTruth(companyId) {
  const startTime = Date.now();
  
  logger.debug(`[${MODULE_ID}] Building Runtime Truth`, { companyId });
  
  // Use .lean() to get plain JS object (avoids Mongoose document circular refs)
  const company = await v2Company.findById(companyId).lean();
  
  if (!company) {
    throw new Error(`Company ${companyId} not found`);
  }
  
  // Extract effective configuration (what will actually run)
  const returnCallerGreeting = normalizeReturnCallerGreeting(company.aiAgentSettings?.agent2?.greetings?.returnCaller);
  const effectiveConfig = {
    companyId: company._id.toString(),
    companyName: company.companyName || company.businessName || 'Unknown',
    
    // Agent 2.0 configuration
    agent2: {
      greetings: {
        callStart: company.aiAgentSettings?.agent2?.greetings?.callStart || {},
        interceptor: company.aiAgentSettings?.agent2?.greetings?.interceptor || {},
        returnCaller: returnCallerGreeting
      },
      triggers: {
        activeGroupId: company.aiAgentSettings?.agent2?.globalTriggerGroupId || null,
        localTriggers: company.aiAgentSettings?.agent2?.triggers || [],
        localTriggersCount: (company.aiAgentSettings?.agent2?.triggers || []).length
      },
      discovery: company.aiAgentSettings?.agent2?.discovery || {},
      consentPhrases: company.aiAgentSettings?.agent2?.consentPhrases || [],
      escalationPhrases: company.aiAgentSettings?.agent2?.escalationPhrases || [],
      bookingPrompts: company.aiAgentSettings?.agent2?.bookingPrompts || {}
    },
    
    // Booking Logic configuration
    booking: {
      slotDuration: company.aiAgentSettings?.booking?.slotDuration || 60,
      bufferMinutes: company.aiAgentSettings?.booking?.bufferMinutes || 0,
      advanceBookingDays: company.aiAgentSettings?.booking?.advanceBookingDays || 14,
      confirmationMessage: company.aiAgentSettings?.booking?.confirmationMessage || '',
      enableSmsConfirmation: company.aiAgentSettings?.booking?.enableSmsConfirmation || false
    },
    
    // Voice settings
    voice: {
      provider: company.aiAgentSettings?.voiceSettings?.provider || 'elevenlabs',
      voiceId: company.aiAgentSettings?.voiceSettings?.voiceId || null,
      model: company.aiAgentSettings?.voiceSettings?.model_id || null,
      stability: company.aiAgentSettings?.voiceSettings?.stability || null,
      similarity_boost: company.aiAgentSettings?.voiceSettings?.similarity_boost || null
    },
    
    // LLM controls (recovery messages, etc.)
    llmControls: {
      recoveryMessages: company.aiAgentSettings?.llm0Controls?.recoveryMessages || {},
      llmFallback: company.aiAgentSettings?.llm0Controls?.llmFallback || {}
    },
    
    // Calendar integration
    calendar: {
      connected: !!company.googleCalendar?.refreshToken,
      calendarId: company.googleCalendar?.calendarId || null,
      connectedAt: company.googleCalendar?.connectedAt || null
    },
    
    // Twilio configuration
    twilio: {
      configured: !!(company.twilioConfig?.accountSid && company.twilioConfig?.authToken),
      accountStatus: company.twilioConfig?.accountStatus || 'unknown'
    }
  };
  
  // Compute canonical hash (deterministic key ordering)
  const canonicalJson = JSON.stringify(sortKeysDeep(effectiveConfig));
  const effectiveConfigHash = crypto.createHash('sha256').update(canonicalJson).digest('hex');
  
  const duration = Date.now() - startTime;
  
  logger.info(`[${MODULE_ID}] Runtime Truth built`, {
    companyId,
    hash: effectiveConfigHash.substring(0, 16) + '...',
    duration: `${duration}ms`
  });
  
  return {
    effectiveConfig,
    effectiveConfigHash,
    effectiveConfigVersion: company.updatedAt?.toISOString() || null,
    capturedAt: new Date().toISOString(),
    buildDuration: `${duration}ms`
  };
}

function normalizeReturnCallerGreeting(value) {
  if (!value) {
    return { enabled: false, text: '' };
  }
  if (typeof value === 'string') {
    return { enabled: Boolean(value.trim()), text: value.trim() };
  }
  return {
    enabled: value.enabled !== false && Boolean((value.text || '').trim()),
    text: (value.text || '').trim()
  };
}

/**
 * ───────────────────────────────────────────────────────────────────────────
 * SORT KEYS DEEP (for deterministic JSON)
 * Handles circular references and Mongoose documents safely
 * ───────────────────────────────────────────────────────────────────────────
 */
function sortKeysDeep(obj, seen = new WeakSet()) {
  // Handle primitives and null
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  // Handle circular references
  if (seen.has(obj)) {
    return '[Circular]';
  }
  seen.add(obj);
  
  // Handle Date objects
  if (obj instanceof Date) {
    return obj.toISOString();
  }
  
  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => sortKeysDeep(item, seen));
  }
  
  // Handle plain objects
  return Object.keys(obj).sort().reduce((sorted, key) => {
    sorted[key] = sortKeysDeep(obj[key], seen);
    return sorted;
  }, {});
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * LANE C: BUILD TRUTH
 * ════════════════════════════════════════════════════════════════════════════
 * 
 * Deployment identity information.
 * Proves what build is running (git commit, timestamp, environment).
 * ════════════════════════════════════════════════════════════════════════════
 */
function buildBuildTruth() {
  return {
    gitCommit: process.env.GIT_COMMIT || 
               process.env.RENDER_GIT_COMMIT || 
               process.env.VERCEL_GIT_COMMIT_SHA || 
               'unknown',
    buildTime: process.env.BUILD_TIME || 
               process.env.RENDER_GIT_COMMIT_DATE || 
               'unknown',
    serverVersion: getServerVersion(),
    environment: process.env.NODE_ENV || 'development',
    nodeVersion: process.version,
    platform: process.platform,
    deploymentId: process.env.RENDER_INSTANCE_ID || 
                  process.env.VERCEL_DEPLOYMENT_ID || 
                  'local'
  };
}

function getServerVersion() {
  try {
    const pkg = require('../../package.json');
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * BACKEND SOURCE TRUTH (Optional)
 * ════════════════════════════════════════════════════════════════════════════
 */
async function buildBackendSourceTruth(includeContents = false, hardcodedSpeechScan = null) {
  const files = [];

  for (const relPath of BACKEND_SOURCE_FILES) {
    const fullPath = path.join(REPO_ROOT, relPath);
    try {
      const stats = await fs.stat(fullPath);
      const content = await fs.readFile(fullPath);
      const sha256 = crypto.createHash('sha256').update(content).digest('hex');
      files.push({
        path: relPath,
        size: stats.size,
        lineCount: content.toString('utf-8').split('\n').length,
        lastModified: stats.mtime.toISOString(),
        sha256,
        contentBase64: includeContents ? content.toString('base64') : null
      });
    } catch (error) {
      files.push({
        path: relPath,
        error: error.message
      });
    }
  }

  return {
    includeContents,
    totalFiles: files.length,
    totalBytes: files.reduce((sum, file) => sum + (file.size || 0), 0),
    files,
    hardcodedResponsesScan: hardcodedSpeechScan ? {
      total: hardcodedSpeechScan.violations?.total || 0,
      critical: hardcodedSpeechScan.violations?.critical || 0,
      high: hardcodedSpeechScan.violations?.high || 0,
      medium: hardcodedSpeechScan.violations?.medium || 0,
      list: hardcodedSpeechScan.violations?.list || []
    } : null
  };
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * AUDIT PROOF BLOCK
 * ════════════════════════════════════════════════════════════════════════════
 */
function buildAuditProof(uiTruth, complianceTruth) {
  const findings = (complianceTruth?.hardcodedSpeechScan?.violations?.list || []).map((violation, index) => ({
    id: `HCS-${String(index + 1).padStart(4, '0')}`,
    severity: violation.severity,
    filePath: violation.file,
    lineRange: `${violation.line}-${violation.line}`,
    snippetHash: crypto.createHash('sha256').update(violation.code || '').digest('hex')
  }));

  const hardcodedTotal = complianceTruth?.hardcodedSpeechScan?.violations?.total || 0;
  const uiDrivenSpeechPercent = complianceTruth?.uiCoverageReport?.compliantPercentage || 0;
  const hardcodedSpeechPercent = findings.length > 0
    ? Math.round((findings.length / Math.max(uiTruth.totalFiles || 1, 1)) * 100)
    : 0;
  const hardcodedFreePercent = hardcodedTotal === 0 ? 100 : 0;

  return {
    totalUiBytes: uiTruth.totalBytes || 0,
    totalUiFiles: uiTruth.totalFiles || 0,
    totalUiLines: uiTruth.totalLines || 0,
    modalCount: uiTruth.modalDiscovery?.totalModals || 0,
    pageCount: uiTruth.pageDiscovery?.totalPages || 0,
    hardcodedFindings: findings,
    complianceScore: {
      uiDrivenSpeechPercent,
      hardcodedSpeechPercent,
      hardcodedFreePercent,
      method: 'uiDrivenSpeechPercent is from UI coverage; hardcodedSpeechPercent is findings/file ratio; hardcodedFreePercent is 100 only when hardcoded findings = 0'
    }
  };
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * LANE D: COMPLIANCE TRUTH
 * ════════════════════════════════════════════════════════════════════════════
 * 
 * Detects violations of "UI-driven" rule.
 * 
 * Checks:
 * 1. UI Coverage - Components that exist in DB but have no UI editor
 * 2. Hardcoded Speech - Scan code for hardcoded agent responses
 * 
 * SELF-ENFORCING: Exposes violations, doesn't hide them.
 * ════════════════════════════════════════════════════════════════════════════
 */
async function buildComplianceTruth(companyId) {
  const startTime = Date.now();
  
  logger.debug(`[${MODULE_ID}] Building Compliance Truth`, { companyId });
  
  // Use .lean() to get plain JS object (avoids Mongoose document circular refs)
  const company = await v2Company.findById(companyId).lean();
  
  // Build UI coverage report
  const uiCoverageReport = await checkUiCoverage(company);
  
  // Scan for hardcoded speech (can be slow, run in background)
  let hardcodedSpeechScan = null;
  
  try {
    hardcodedSpeechScan = await scanForHardcodedSpeech();
  } catch (error) {
    logger.warn(`[${MODULE_ID}] Hardcoded speech scan failed`, {
      error: error.message
    });
    
    hardcodedSpeechScan = {
      scanStatus: 'ERROR',
      error: error.message,
      violations: { total: 0, list: [] }
    };
  }
  
  const duration = Date.now() - startTime;
  
  return {
    uiCoverageReport,
    hardcodedSpeechScan,
    scannedAt: new Date().toISOString(),
    scanDuration: `${duration}ms`
  };
}

/**
 * ───────────────────────────────────────────────────────────────────────────
 * CHECK UI COVERAGE
 * ───────────────────────────────────────────────────────────────────────────
 */
async function checkUiCoverage(company) {
  const issues = [];
  
  // Check 1: Booking Prompts (CRITICAL)
  const bookingPrompts = company.aiAgentSettings?.agent2?.bookingPrompts;
  if (!bookingPrompts || !bookingPrompts.askName || !bookingPrompts.askPhone) {
    issues.push({
      component: 'bookingPrompts',
      severity: 'CRITICAL',
      issue: 'Booking prompts not configured in UI (hardcoded in BookingLogicEngine.js)',
      uiPath: 'MISSING',
      expectedUiLocation: 'booking.html → Booking Prompts card',
      backendFile: 'services/engine/booking/BookingLogicEngine.js',
      impact: '100% of booking flows use hardcoded prompts'
    });
  }
  
  // Check 2: Recovery Messages (CRITICAL)
  const recoveryMessages = company.aiAgentSettings?.llm0Controls?.recoveryMessages;
  if (!recoveryMessages || Object.keys(recoveryMessages).length === 0) {
    issues.push({
      component: 'recoveryMessages',
      severity: 'CRITICAL',
      issue: 'Recovery messages not configured in UI (hardcoded in v2twilio.js)',
      uiPath: 'MISSING',
      expectedUiLocation: 'agent2.html → Recovery Messages card',
      backendFile: 'routes/v2twilio.js',
      impact: '5-10% of calls (connection issues) use hardcoded messages'
    });
  }
  
  // Check 3: Emergency Fallback (CRITICAL)
  const emergencyFallback = company.aiAgentSettings?.agent2?.greetings?.callStart?.emergencyFallback;
  if (!emergencyFallback || !emergencyFallback.trim()) {
    issues.push({
      component: 'emergencyFallback',
      severity: 'CRITICAL',
      issue: 'Emergency fallback greeting not configured in UI',
      uiPath: 'MISSING',
      expectedUiLocation: 'agent2.html → Call Start Greeting → Emergency Fallback field',
      backendFile: 'routes/v2twilio.js',
      impact: 'Rare but catastrophic (data corruption scenarios)'
    });
  }
  
  // Check 4: Return Caller Greeting (HIGH)
  const returnCaller = normalizeReturnCallerGreeting(company.aiAgentSettings?.agent2?.greetings?.returnCaller);
  if (!returnCaller.enabled || !returnCaller.text) {
    issues.push({
      component: 'returnCallerGreeting',
      severity: 'HIGH',
      issue: 'Return caller greeting not configured in UI',
      uiPath: 'MISSING',
      expectedUiLocation: 'agent2.html → Return Caller Recognition card',
      backendFile: 'services/engine/agent2/Agent2DiscoveryEngine.js',
      impact: '~30% of calls (returning customers) miss personalization'
    });
  }
  
  // Check 5: Hold Line Message (HIGH)
  const holdMessage = company.aiAgentSettings?.agent2?.discovery?.holdMessage;
  if (!holdMessage || !holdMessage.trim()) {
    issues.push({
      component: 'holdMessage',
      severity: 'HIGH',
      issue: 'Hold line message not configured in UI',
      uiPath: 'MISSING',
      expectedUiLocation: 'booking.html → Hold Message field',
      backendFile: 'services/engine/agent2/Agent2DiscoveryEngine.js',
      impact: 'All booking flows with calendar use hardcoded hold message'
    });
  }
  
  // Calculate compliance percentage
  const totalComponents = 13; // Total components that should be UI-driven
  const compliantComponents = totalComponents - issues.length;
  const compliantPercentage = Math.round((compliantComponents / totalComponents) * 100);
  
  return {
    totalComponents,
    compliantComponents,
    totalIssues: issues.length,
    issues,
    compliantPercentage,
    status: issues.filter(i => i.severity === 'CRITICAL').length > 0 ? 'VIOLATIONS_FOUND' : 'COMPLIANT'
  };
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * TRUTH STATUS AGGREGATOR (Manifest-Based)
 * ════════════════════════════════════════════════════════════════════════════
 * 
 * Combines all lane statuses into overall Truth status.
 * 
 * STATUS DEFINITIONS:
 * - COMPLETE: All manifest requirements met, no critical issues
 * - INCOMPLETE: Missing required files/modals OR critical compliance violations
 * - MANIFEST_UPDATE_NEEDED: Extra files/modals found (not a failure, but needs update)
 * 
 * Evidence-based: Every issue includes file path, line number, or specific ID.
 * ════════════════════════════════════════════════════════════════════════════
 */
function computeTruthStatus(uiTruth, complianceTruth, options = {}) {
  const issues = [];
  const manifestGaps = [];
  const includeContents = options.includeContents === true;

  // Check 0: Reproducibility requires embedded file contents
  const filesMissingContent = (uiTruth.files || []).filter(file => !file.error && !file.contentBase64);
  if (!includeContents) {
    issues.push({
      type: 'CONTENTS_NOT_INCLUDED',
      severity: 'CRITICAL',
      message: 'Truth export is inventory-only (includeContents=0); reproducible audit artifact requires embedded file contents',
      action: 'Re-run export with includeContents=1'
    });
  } else if (filesMissingContent.length > 0) {
    issues.push({
      type: 'MISSING_FILE_CONTENTS',
      severity: 'CRITICAL',
      message: `${filesMissingContent.length} UI file(s) missing embedded content`,
      evidence: filesMissingContent.map(f => f.relativePath),
      action: 'Fix file read failures and re-run export'
    });
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // Check 1: Required pages from manifest
  // ─────────────────────────────────────────────────────────────────────────
  if (uiTruth.pageDiscovery.missingRequired?.length > 0) {
    issues.push({
      type: 'REQUIRED_PAGES_MISSING',
      severity: 'CRITICAL',
      message: `${uiTruth.pageDiscovery.missingRequired.length} required page(s) missing from deployment`,
      evidence: uiTruth.pageDiscovery.missingRequired,
      manifestFile: 'config/truthManifest.js',
      action: 'Deploy missing pages or remove from manifest if intentionally removed'
    });
  }
  
  // Extra pages = manifest needs update (not a failure)
  if (uiTruth.pageDiscovery.extraNotInManifest?.length > 0) {
    manifestGaps.push({
      type: 'EXTRA_PAGES',
      severity: 'INFO',
      message: `${uiTruth.pageDiscovery.extraNotInManifest.length} page(s) not in manifest`,
      evidence: uiTruth.pageDiscovery.extraNotInManifest,
      action: 'Add to config/truthManifest.js PAGE_CONTROLLER_MAP'
    });
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // Check 2: Required modals from manifest
  // ─────────────────────────────────────────────────────────────────────────
  if (uiTruth.modalDiscovery.missingRequired?.length > 0) {
    issues.push({
      type: 'REQUIRED_MODALS_MISSING',
      severity: 'CRITICAL',
      message: `${uiTruth.modalDiscovery.missingRequired.length} required modal(s) missing from HTML`,
      evidence: uiTruth.modalDiscovery.missingRequired,
      manifestFile: 'config/truthManifest.js',
      action: 'Add missing modals to HTML or remove from manifest if intentionally removed'
    });
  }
  
  // Extra modals = manifest needs update (not a failure)
  if (uiTruth.modalDiscovery.extraNotInManifest?.length > 0) {
    manifestGaps.push({
      type: 'EXTRA_MODALS',
      severity: 'INFO',
      message: `${uiTruth.modalDiscovery.extraNotInManifest.length} modal(s) not in manifest`,
      evidence: uiTruth.modalDiscovery.extraNotInManifest.map(m => ({
        id: m.modalId,
        page: m.page
      })),
      action: 'Add to config/truthManifest.js REQUIRED_MODALS or IGNORED_MODAL_IDS'
    });
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // Check 3: Broken internal links
  // ─────────────────────────────────────────────────────────────────────────
  if (uiTruth.linkValidation.totalIssues > 0) {
    issues.push({
      type: 'BROKEN_LINKS',
      severity: 'WARNING',
      message: `${uiTruth.linkValidation.totalIssues} broken internal link(s) detected`,
      evidence: uiTruth.linkValidation.brokenLinks.slice(0, 10), // Cap at 10
      action: 'Fix broken links or verify they are external/dynamic'
    });
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // Check 4: UI coverage violations (components without UI editors)
  // ─────────────────────────────────────────────────────────────────────────
  if (complianceTruth.uiCoverageReport?.totalIssues > 0) {
    issues.push({
      type: 'UI_COVERAGE_GAPS',
      severity: 'CRITICAL',
      message: `${complianceTruth.uiCoverageReport.totalIssues} backend component(s) lack UI editors`,
      evidence: complianceTruth.uiCoverageReport.issues,
      complianceScore: {
        total: complianceTruth.uiCoverageReport.totalComponents,
        compliant: complianceTruth.uiCoverageReport.compliantComponents,
        percentage: complianceTruth.uiCoverageReport.compliantPercentage
      },
      action: 'Build UI editors for each listed component'
    });
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // Check 5: Hardcoded speech in backend code
  // ─────────────────────────────────────────────────────────────────────────
  const hardcodedCount = complianceTruth.hardcodedSpeechScan?.violations?.total || 0;
  if (hardcodedCount > 0) {
    issues.push({
      type: 'HARDCODED_SPEECH',
      severity: 'CRITICAL',
      message: `${hardcodedCount} hardcoded speech string(s) found in backend code`,
      evidence: {
        total: hardcodedCount,
        critical: complianceTruth.hardcodedSpeechScan.violations.critical || 0,
        high: complianceTruth.hardcodedSpeechScan.violations.high || 0,
        medium: complianceTruth.hardcodedSpeechScan.violations.medium || 0,
        sample: complianceTruth.hardcodedSpeechScan.violations.list?.slice(0, 5) || []
      },
      action: 'Move hardcoded text to database fields with UI editors'
    });
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // Compute overall status
  // ─────────────────────────────────────────────────────────────────────────
  const criticalCount = issues.filter(i => i.severity === 'CRITICAL').length;
  const warningCount = issues.filter(i => i.severity === 'WARNING').length;
  
  let status;
  if (criticalCount > 0) {
    status = 'INCOMPLETE';
  } else if (manifestGaps.length > 0) {
    status = 'MANIFEST_UPDATE_NEEDED';
  } else {
    status = 'COMPLETE';
  }
  
  // Calculate compliance score
  const uiCompliancePercent = complianceTruth.uiCoverageReport?.compliantPercentage || 0;
  const speechCompliancePercent = hardcodedCount === 0 ? 100 : 0;
  const overallCompliance = Math.round((uiCompliancePercent + speechCompliancePercent) / 2);
  
  return {
    status,
    statusExplanation: {
      COMPLETE: 'All manifest requirements met and no critical compliance issues',
      INCOMPLETE: 'Missing required files/modals or critical compliance violations exist',
      MANIFEST_UPDATE_NEEDED: 'Deployment has extra files/modals - update manifest to match'
    }[status],
    summary: {
      criticalIssues: criticalCount,
      warnings: warningCount,
      manifestGaps: manifestGaps.length,
      overallCompliancePercent: overallCompliance
    },
    issues,
    manifestGaps,
    complianceScoring: {
      method: 'Average of UI coverage (% of components with editors) and speech compliance (0% if any hardcoded, 100% if none)',
      uiCoveragePercent: uiCompliancePercent,
      speechCompliancePercent,
      overallPercent: overallCompliance,
      denominator: `${complianceTruth.uiCoverageReport?.totalComponents || 0} UI components + hardcoded speech scan`
    },
    manifestVersion: truthManifest.manifestVersion
  };
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * MAIN EXPORT ENDPOINT
 * ════════════════════════════════════════════════════════════════════════════
 * 
 * GET /api/agent-console/truth/export?companyId={id}[&includeContents=1]
 * 
 * Returns complete Truth JSON with all 4 lanes.
 * ════════════════════════════════════════════════════════════════════════════
 */
router.get(
  '/export',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_READ),
  async (req, res) => {
    const requestStartTime = Date.now();
    
    try {
      const { companyId, includeContents, includeLargeAssets, includeBackend } = req.query;
      const includeContentsFlag = includeContents !== '0';
      const includeLargeAssetsFlag = includeLargeAssets === '1';
      const includeBackendFlag = includeBackend === '1';
      
      // Validate required parameters
      if (!companyId) {
        return res.status(400).json({
          error: 'Missing required parameter',
          message: 'companyId query parameter is required',
          usage: '/api/agent-console/truth/export?companyId={id}'
        });
      }
      
      logger.info(`[${MODULE_ID}] Truth export requested`, {
        companyId,
        includeContents: includeContentsFlag,
        includeLargeAssets: includeLargeAssetsFlag,
        includeBackend: includeBackendFlag,
        user: req.user?.email || 'unknown',
        userAgent: req.get('user-agent')
      });
      
      // Build all lanes in parallel (maximum performance)
      // Wrap each lane in try-catch for better error diagnostics
      const results = await Promise.allSettled([
        buildUiSourceTruth(includeContentsFlag, includeLargeAssetsFlag),
        buildRuntimeTruth(companyId),
        Promise.resolve(buildBuildTruth()),
        buildComplianceTruth(companyId),
        includeBackendFlag ? buildBackendSourceTruth(includeContentsFlag) : Promise.resolve(null)
      ]);
      
      // Check for failures and provide detailed error info
      const laneNames = ['uiSource', 'runtime', 'build', 'compliance', 'backendSource'];
      const failures = results
        .map((r, i) => r.status === 'rejected' ? { lane: laneNames[i], error: r.reason?.message || 'Unknown error' } : null)
        .filter(Boolean);
      
      if (failures.length > 0) {
        logger.error(`[${MODULE_ID}] Lane failures detected`, {
          companyId,
          failures,
          user: req.user?.email
        });
        
        return res.status(500).json({
          error: 'Truth export failed - lane errors',
          laneFailures: failures,
          truthVersion: TRUTH_VERSION
        });
      }
      
      const [uiTruth, runtimeTruth, buildTruth, complianceTruth, backendTruth] = results.map(r => r.value);
      if (backendTruth) {
        backendTruth.hardcodedResponsesScan = {
          total: complianceTruth.hardcodedSpeechScan?.violations?.total || 0,
          critical: complianceTruth.hardcodedSpeechScan?.violations?.critical || 0,
          high: complianceTruth.hardcodedSpeechScan?.violations?.high || 0,
          medium: complianceTruth.hardcodedSpeechScan?.violations?.medium || 0,
          list: complianceTruth.hardcodedSpeechScan?.violations?.list || []
        };
      }
      
      // Compute overall truth status
      const truthStatus = computeTruthStatus(uiTruth, complianceTruth, {
        includeContents: includeContentsFlag
      });
      const auditProof = buildAuditProof(uiTruth, complianceTruth);
      
      // Assemble complete Truth contract
      const truth = {
        // Header
        truthVersion: TRUTH_VERSION,
        truthStatus: truthStatus.status,
        exportedAt: new Date().toISOString(),
        exportedBy: req.user?.email || 'unknown',
        exportedFromPage: req.get('referer') || 'unknown',
        
        // Lane A: UI Source Truth
        uiSource: {
          totalFiles: uiTruth.totalFiles,
          files: uiTruth.files,
          pageDiscovery: uiTruth.pageDiscovery,
          modalDiscovery: uiTruth.modalDiscovery,
          linkValidation: uiTruth.linkValidation,
          scannedAt: uiTruth.scannedAt,
          scanDuration: uiTruth.scanDuration,
          includeContents: includeContentsFlag
        },
        
        // Lane B: Runtime Truth
        runtime: {
          effectiveConfig: runtimeTruth.effectiveConfig,
          effectiveConfigHash: runtimeTruth.effectiveConfigHash,
          effectiveConfigVersion: runtimeTruth.effectiveConfigVersion,
          capturedAt: runtimeTruth.capturedAt,
          buildDuration: runtimeTruth.buildDuration
        },
        
        // Lane C: Build Truth
        build: buildTruth,
        
        // Lane D: Compliance Truth
        compliance: complianceTruth,

        // Optional backend source lane
        backendSource: backendTruth,

        // Reproducibility proof block
        auditProof,
        
        // Aggregated status (combines all lanes)
        truthStatusDetails: truthStatus,
        
        // Metadata
        meta: {
          note: 'This is the TRUTH contract for Agent Console',
          rule: 'If it is not in UI, it does NOT exist',
          purpose: 'Proves: (1) what UI is deployed, (2) what config will run, (3) what build is running, (4) what violations exist',
          usage: [
            'Call 2.0: Verify exact config used during historic calls',
            'Compliance: Detect hardcoded speech violations',
            'Deployment: Verify what code is running in production',
            'Debugging: Understand complete system state'
          ],
          contractVersion: 'TruthExportV1',
          documentation: '/truth/ folder contains complete audit documentation',
          includeContents: includeContentsFlag,
          includeBackend: includeBackendFlag
        }
      };
      
      const totalDuration = Date.now() - requestStartTime;
      
      // Log export completion
      logger.info(`[${MODULE_ID}] Truth export completed`, {
        companyId,
        truthVersion: TRUTH_VERSION,
        truthStatus: truth.truthStatus,
        uiFiles: truth.uiSource.totalFiles,
        pages: truth.uiSource.pageDiscovery.totalPages,
        modals: truth.uiSource.modalDiscovery.totalModals,
        complianceIssues: complianceTruth.uiCoverageReport.totalIssues,
        hardcodedViolations: complianceTruth.hardcodedSpeechScan?.violations?.total || 0,
        totalDuration: `${totalDuration}ms`
      });
      
      // Add performance header
      res.set('X-Truth-Export-Duration', `${totalDuration}ms`);
      res.set('X-Truth-Version', TRUTH_VERSION);
      res.set('X-Truth-Status', truth.truthStatus);
      
      res.json(truth);
      
    } catch (error) {
      logger.error(`[${MODULE_ID}] Export failed`, {
        error: error.message,
        stack: error.stack,
        companyId: req.query.companyId,
        user: req.user?.email
      });
      
      res.status(500).json({
        error: 'Truth export failed',
        message: error.message,
        truthVersion: TRUTH_VERSION
      });
    }
  }
);

/**
 * ════════════════════════════════════════════════════════════════════════════
 * SELFTEST ENDPOINT
 * ════════════════════════════════════════════════════════════════════════════
 * 
 * GET /api/agent-console/truth/selftest
 * 
 * Verifies Truth system integrity without requiring companyId.
 * Tests: manifest validity, file existence, modal extraction, scanner.
 * ════════════════════════════════════════════════════════════════════════════
 */
router.get(
  '/selftest',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_READ),
  async (req, res) => {
    const startTime = Date.now();
    const tests = [];
    
    try {
      // ───────────────────────────────────────────────────────────────────────
      // Test 1: Manifest loads correctly
      // ───────────────────────────────────────────────────────────────────────
      try {
        const manifestTest = {
          name: 'manifest_loads',
          description: 'Truth manifest file loads without errors'
        };
        
        if (truthManifest.REQUIRED_FILES && truthManifest.REQUIRED_MODALS) {
          manifestTest.status = 'PASS';
          manifestTest.details = {
            requiredFiles: truthManifest.REQUIRED_FILES.length,
            requiredModals: truthManifest.REQUIRED_MODALS.length,
            manifestVersion: truthManifest.manifestVersion
          };
        } else {
          manifestTest.status = 'FAIL';
          manifestTest.error = 'Missing REQUIRED_FILES or REQUIRED_MODALS';
        }
        tests.push(manifestTest);
      } catch (err) {
        tests.push({
          name: 'manifest_loads',
          status: 'FAIL',
          error: err.message
        });
      }
      
      // ───────────────────────────────────────────────────────────────────────
      // Test 2: Agent Console directory exists
      // ───────────────────────────────────────────────────────────────────────
      try {
        await fs.access(AGENT_CONSOLE_DIR);
        tests.push({
          name: 'agent_console_dir_exists',
          description: 'Agent Console directory is accessible',
          status: 'PASS',
          details: { path: AGENT_CONSOLE_DIR }
        });
      } catch (err) {
        tests.push({
          name: 'agent_console_dir_exists',
          status: 'FAIL',
          error: `Directory not found: ${AGENT_CONSOLE_DIR}`
        });
      }
      
      // ───────────────────────────────────────────────────────────────────────
      // Test 3: All required files exist
      // ───────────────────────────────────────────────────────────────────────
      const missingFiles = [];
      for (const file of truthManifest.REQUIRED_FILES) {
        const fullPath = path.join(AGENT_CONSOLE_DIR, file);
        try {
          await fs.access(fullPath);
        } catch {
          missingFiles.push(file);
        }
      }
      
      tests.push({
        name: 'required_files_exist',
        description: 'All manifest-required files exist on disk',
        status: missingFiles.length === 0 ? 'PASS' : 'FAIL',
        details: {
          total: truthManifest.REQUIRED_FILES.length,
          found: truthManifest.REQUIRED_FILES.length - missingFiles.length,
          missing: missingFiles
        }
      });
      
      // ───────────────────────────────────────────────────────────────────────
      // Test 4: Modal extraction works
      // ───────────────────────────────────────────────────────────────────────
      try {
        const htmlFiles = truthManifest.REQUIRED_FILES.filter(f => f.endsWith('.html'));
        let totalModalsFound = 0;
        
        for (const file of htmlFiles) {
          const fullPath = path.join(AGENT_CONSOLE_DIR, file);
          try {
            const content = await fs.readFile(fullPath, 'utf-8');
            const matches = content.matchAll(/id=["'](modal-[^"']+)["']/g);
            for (const _ of matches) totalModalsFound++;
          } catch { /* ignore individual file errors */ }
        }
        
        tests.push({
          name: 'modal_extraction',
          description: 'Modal IDs can be extracted from HTML files',
          status: totalModalsFound > 0 ? 'PASS' : 'WARN',
          details: {
            totalModalsFound,
            htmlFilesScanned: htmlFiles.length
          }
        });
      } catch (err) {
        tests.push({
          name: 'modal_extraction',
          status: 'FAIL',
          error: err.message
        });
      }
      
      // ───────────────────────────────────────────────────────────────────────
      // Test 5: Hardcoded speech scanner runs
      // ───────────────────────────────────────────────────────────────────────
      try {
        const scanResult = await scanForHardcodedSpeech();
        tests.push({
          name: 'speech_scanner',
          description: 'Hardcoded speech scanner runs without errors',
          status: scanResult.scanStatus === 'SUCCESS' ? 'PASS' : 'WARN',
          details: {
            scanStatus: scanResult.scanStatus,
            scannedFiles: scanResult.scannedFiles,
            violationsFound: scanResult.violations?.total || 0
          }
        });
      } catch (err) {
        tests.push({
          name: 'speech_scanner',
          status: 'FAIL',
          error: err.message
        });
      }
      
      // ───────────────────────────────────────────────────────────────────────
      // Aggregate results
      // ───────────────────────────────────────────────────────────────────────
      const passed = tests.filter(t => t.status === 'PASS').length;
      const failed = tests.filter(t => t.status === 'FAIL').length;
      const warned = tests.filter(t => t.status === 'WARN').length;
      
      const duration = Date.now() - startTime;
      
      res.json({
        selftest: 'TRUTH_SYSTEM',
        version: TRUTH_VERSION,
        timestamp: new Date().toISOString(),
        duration: `${duration}ms`,
        summary: {
          total: tests.length,
          passed,
          failed,
          warnings: warned,
          overallStatus: failed > 0 ? 'FAIL' : (warned > 0 ? 'WARN' : 'PASS')
        },
        tests,
        manifestInfo: {
          version: truthManifest.manifestVersion,
          lastUpdated: truthManifest.lastUpdated,
          requiredFilesCount: truthManifest.REQUIRED_FILES.length,
          requiredModalsCount: truthManifest.REQUIRED_MODALS.length
        }
      });
      
    } catch (error) {
      logger.error(`[${MODULE_ID}] Selftest failed`, {
        error: error.message,
        stack: error.stack
      });
      
      res.status(500).json({
        selftest: 'TRUTH_SYSTEM',
        version: TRUTH_VERSION,
        summary: { overallStatus: 'ERROR' },
        error: error.message
      });
    }
  }
);

/**
 * ════════════════════════════════════════════════════════════════════════════
 * EXPORTS
 * ════════════════════════════════════════════════════════════════════════════
 */
module.exports = router;
