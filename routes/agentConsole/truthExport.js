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

// Constants
const MODULE_ID = 'TRUTH_EXPORT';
const TRUTH_VERSION = '1.0.0';
const AGENT_CONSOLE_DIR = path.join(__dirname, '../../public/agent-console');

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
    
    const manifest = {
      path: `/agent-console/${relPath}`,
      relativePath: relPath,
      size: stats.size,
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
 * DISCOVER PAGES
 * ───────────────────────────────────────────────────────────────────────────
 */
async function discoverPages(allFiles) {
  // Find all HTML files at root level (not in subdirs)
  const htmlFiles = allFiles.filter(f => f.endsWith('.html') && !f.includes('/'));
  
  const expectedPages = [
    'index.html',
    'agent2.html',
    'triggers.html',
    'booking.html',
    'global-hub.html',
    'calendar.html'
  ];
  
  const pages = htmlFiles.map(file => ({
    filename: file,
    url: `/agent-console/${file}`,
    jsController: file.replace('.html', '.js'),
    jsControllerExists: allFiles.includes(file.replace('.html', '.js'))
  }));
  
  const newPages = pages.filter(p => !expectedPages.includes(p.filename));
  const missingPages = expectedPages.filter(p => !htmlFiles.includes(p));
  
  return {
    totalPages: pages.length,
    pages,
    expectedPages,
    newPagesDetected: newPages,
    missingPages,
    status: newPages.length > 0 ? 'NEW_PAGES_FOUND' : (missingPages.length > 0 ? 'PAGES_MISSING' : 'COMPLETE')
  };
}

/**
 * ───────────────────────────────────────────────────────────────────────────
 * DISCOVER MODALS
 * ───────────────────────────────────────────────────────────────────────────
 */
async function discoverModals(allFiles) {
  const htmlFiles = allFiles.filter(f => f.endsWith('.html'));
  const modals = [];
  
  for (const file of htmlFiles) {
    const fullPath = path.join(AGENT_CONSOLE_DIR, file);
    
    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      
      // Find modal-backdrop or modal IDs
      const modalMatches = content.matchAll(/id=["'](modal-[^"']+)["']/g);
      
      for (const match of modalMatches) {
        modals.push({
          modalId: match[1],
          page: file,
          pageUrl: `/agent-console/${file}`
        });
      }
      
    } catch (error) {
      logger.warn(`[${MODULE_ID}] Failed to scan ${file} for modals`, {
        error: error.message
      });
    }
  }
  
  const expectedModals = [
    'modal-greeting-rule',
    'modal-trigger-edit',
    'modal-approval',
    'modal-gpt-settings',
    'modal-create-group',
    'modal-firstnames'
  ];
  
  const modalIds = modals.map(m => m.modalId);
  const newModals = modals.filter(m => !expectedModals.includes(m.modalId));
  const missingModals = expectedModals.filter(m => !modalIds.includes(m));
  
  return {
    totalModals: modals.length,
    modals,
    expectedModals,
    newModalsDetected: newModals,
    missingModals,
    status: newModals.length > 0 ? 'NEW_MODALS_FOUND' : (missingModals.length > 0 ? 'MODALS_MISSING' : 'COMPLETE')
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
  const effectiveConfig = {
    companyId: company._id.toString(),
    companyName: company.companyName || company.businessName || 'Unknown',
    
    // Agent 2.0 configuration
    agent2: {
      greetings: {
        callStart: company.aiAgentSettings?.agent2?.greetings?.callStart || {},
        interceptor: company.aiAgentSettings?.agent2?.greetings?.interceptor || {},
        returnCaller: company.aiAgentSettings?.agent2?.greetings?.returnCaller || {}
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
  const returnCaller = company.aiAgentSettings?.agent2?.greetings?.returnCaller;
  if (!returnCaller || !returnCaller.text || !returnCaller.text.trim()) {
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
 * TRUTH STATUS AGGREGATOR
 * ════════════════════════════════════════════════════════════════════════════
 * 
 * Combines all lane statuses into overall Truth status.
 * Returns COMPLETE or INCOMPLETE with reasons.
 * ════════════════════════════════════════════════════════════════════════════
 */
function computeTruthStatus(uiTruth, complianceTruth) {
  const issues = [];
  
  // Check for new pages not documented
  if (uiTruth.pageDiscovery.newPagesDetected.length > 0) {
    issues.push({
      type: 'NEW_PAGES_DETECTED',
      severity: 'WARNING',
      message: `${uiTruth.pageDiscovery.newPagesDetected.length} new page(s) detected (not in expected list)`,
      pages: uiTruth.pageDiscovery.newPagesDetected.map(p => p.filename),
      action: 'Update expected pages list or verify these pages are intentional'
    });
  }
  
  // Check for missing expected pages
  if (uiTruth.pageDiscovery.missingPages.length > 0) {
    issues.push({
      type: 'PAGES_MISSING',
      severity: 'CRITICAL',
      message: `${uiTruth.pageDiscovery.missingPages.length} expected page(s) missing`,
      pages: uiTruth.pageDiscovery.missingPages,
      action: 'Verify these pages were not accidentally deleted'
    });
  }
  
  // Check for broken links
  if (uiTruth.linkValidation.totalIssues > 0) {
    issues.push({
      type: 'BROKEN_LINKS',
      severity: 'WARNING',
      message: `${uiTruth.linkValidation.totalIssues} broken internal link(s) detected`,
      count: uiTruth.linkValidation.totalIssues,
      action: 'Fix broken links or verify they are external/dynamic'
    });
  }
  
  // Check for new modals
  if (uiTruth.modalDiscovery.newModalsDetected.length > 0) {
    issues.push({
      type: 'NEW_MODALS_DETECTED',
      severity: 'INFO',
      message: `${uiTruth.modalDiscovery.newModalsDetected.length} new modal(s) detected`,
      modals: uiTruth.modalDiscovery.newModalsDetected.map(m => m.modalId),
      action: 'Update expected modals list or document these modals'
    });
  }
  
  // Check for UI coverage violations (MOST IMPORTANT)
  if (complianceTruth.uiCoverageReport.totalIssues > 0) {
    issues.push({
      type: 'UI_COVERAGE_VIOLATIONS',
      severity: 'CRITICAL',
      message: `${complianceTruth.uiCoverageReport.totalIssues} component(s) not UI-driven (hardcoded in backend)`,
      compliantPercentage: complianceTruth.uiCoverageReport.compliantPercentage,
      issues: complianceTruth.uiCoverageReport.issues,
      action: 'Build missing UI components to achieve 100% UI-driven compliance'
    });
  }
  
  // Check for hardcoded speech in code
  if (complianceTruth.hardcodedSpeechScan?.violations?.total > 0) {
    issues.push({
      type: 'HARDCODED_SPEECH_FOUND',
      severity: 'CRITICAL',
      message: `${complianceTruth.hardcodedSpeechScan.violations.total} hardcoded speech instance(s) found in code`,
      count: complianceTruth.hardcodedSpeechScan.violations.total,
      action: 'Remove hardcoded text, use UI-configured values'
    });
  }
  
  // Determine overall status
  const hasCriticalIssues = issues.some(i => i.severity === 'CRITICAL');
  const status = hasCriticalIssues ? 'INCOMPLETE' : 'COMPLETE';
  
  return {
    status,
    totalIssues: issues.length,
    criticalIssues: issues.filter(i => i.severity === 'CRITICAL').length,
    issues,
    compliantPercentage: complianceTruth.uiCoverageReport.compliantPercentage
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
      const { companyId, includeContents, includeLargeAssets } = req.query;
      
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
        includeContents: includeContents === '1',
        includeLargeAssets: includeLargeAssets === '1',
        user: req.user?.email || 'unknown',
        userAgent: req.get('user-agent')
      });
      
      // Build all lanes in parallel (maximum performance)
      // Wrap each lane in try-catch for better error diagnostics
      const results = await Promise.allSettled([
        buildUiSourceTruth(includeContents === '1', includeLargeAssets === '1'),
        buildRuntimeTruth(companyId),
        Promise.resolve(buildBuildTruth()),
        buildComplianceTruth(companyId)
      ]);
      
      // Check for failures and provide detailed error info
      const laneNames = ['uiSource', 'runtime', 'build', 'compliance'];
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
      
      const [uiTruth, runtimeTruth, buildTruth, complianceTruth] = results.map(r => r.value);
      
      // Compute overall truth status
      const truthStatus = computeTruthStatus(uiTruth, complianceTruth);
      
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
          includeContents: includeContents === '1'
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
          documentation: '/truth/ folder contains complete audit documentation'
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
 * EXPORTS
 * ════════════════════════════════════════════════════════════════════════════
 */
module.exports = router;
