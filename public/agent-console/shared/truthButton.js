/**
 * ============================================================================
 * TRUTH BUTTON — SHARED COMPONENT
 * ClientVia Agent Console · Universal Truth Contract Exporter
 * ============================================================================
 * 
 * PURPOSE:
 * ────────────────────────────────────────────────────────────────────────────
 * Injects "Master Download Truth JSON" button into every Agent Console page.
 * The Truth button is a CONTRACT, not a feature. It provides:
 * 
 * 1. UI Source Truth - All deployed files (HTML/JS/CSS)
 * 2. Runtime Truth - Exact config used by this company
 * 3. Build Truth - Deployment identity (git commit, build time)
 * 4. Compliance Truth - Hardcoded violations and UI coverage gaps
 * 
 * RULE:
 * ────────────────────────────────────────────────────────────────────────────
 * If it's not in UI, it does NOT exist.
 * Truth export enforces this by exposing violations.
 * 
 * ARCHITECTURE:
 * ────────────────────────────────────────────────────────────────────────────
 * - Single shared file included on all Agent Console pages
 * - Auto-mounts on DOM ready
 * - Finds mount point via fallback cascade
 * - Logs loudly if can't mount (prevents silent failures)
 * - Replaces existing download button OR creates new one
 * 
 * USAGE:
 * ────────────────────────────────────────────────────────────────────────────
 * Add to every Agent Console page:
 * <script src="/agent-console/shared/truthButton.js"></script>
 * 
 * No configuration needed. Automatically:
 * - Reads companyId from URL
 * - Calls /api/agent-console/truth/export
 * - Downloads truth_{companyId}_{timestamp}.json
 * 
 * ============================================================================
 * @module agent-console/shared/truthButton
 * @version 1.0.0
 * @date February 2026
 * ============================================================================
 */

(function() {
  'use strict';

  /* --------------------------------------------------------------------------
     CONFIGURATION
     -------------------------------------------------------------------------- */
  const CONFIG = {
    API_ENDPOINT: '/api/agent-console/truth/export',
    BUTTON_ID: 'btn-truth-export',
    EXISTING_BUTTON_ID: 'btn-download-truth', // Legacy button to replace
    INCLUDE_CONTENTS: true,
    INCLUDE_BACKEND: true,
    
    // Mount point cascade (tries in order)
    MOUNT_SELECTORS: [
      '#truth-button-mount',           // Preferred: Explicit anchor
      'header.header .header-right',   // Current structure
      '#page-header .header-right',    // Alternative
      '.page-header-right',            // Alternative
      'header .header-right',          // Generic header
      'header',                        // Last resort
    ],
    
    // Button SVG icon (download arrow)
    ICON_SVG: `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 10V2M8 10L5 7M8 10L11 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M2 13H14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    `
  };

  /* --------------------------------------------------------------------------
     INITIALIZATION
     -------------------------------------------------------------------------- */
  function init() {
    try {
      const companyId = extractCompanyId();
      const mountPoint = findMountPoint();
      
      if (!mountPoint) {
        logMountFailure();
        return;
      }
      
      const button = createTruthButton(companyId);
      mountButton(button, mountPoint);
      
      logSuccess(mountPoint, companyId);
      
    } catch (error) {
      console.error('[TRUTH BUTTON] Initialization failed', {
        error: error.message,
        stack: error.stack,
        page: window.location.pathname
      });
    }
  }

  /* --------------------------------------------------------------------------
     COMPANY ID EXTRACTION
     -------------------------------------------------------------------------- */
  function extractCompanyId() {
    const params = new URLSearchParams(window.location.search);
    const companyId = params.get('companyId');
    
    if (!companyId) {
      console.warn('[TRUTH BUTTON] No companyId in URL - button will be disabled', {
        url: window.location.href,
        page: window.location.pathname
      });
    }
    
    return companyId;
  }

  /* --------------------------------------------------------------------------
     MOUNT POINT DISCOVERY
     -------------------------------------------------------------------------- */
  function findMountPoint() {
    for (const selector of CONFIG.MOUNT_SELECTORS) {
      const element = document.querySelector(selector);
      if (element) {
        console.debug('[TRUTH BUTTON] Mount point found', {
          selector,
          element: element.tagName + (element.id ? '#' + element.id : '') + (element.className ? '.' + element.className.split(' ')[0] : '')
        });
        return element;
      }
    }
    return null;
  }

  function logMountFailure() {
    console.error('[TRUTH BUTTON] ⚠️ Could not find mount point for Truth button', {
      attemptedSelectors: CONFIG.MOUNT_SELECTORS,
      page: window.location.pathname,
      recommendation: 'Add id="truth-button-mount" to header or page-header element',
      impact: 'Truth export button NOT available on this page'
    });
  }

  /* --------------------------------------------------------------------------
     BUTTON CREATION
     -------------------------------------------------------------------------- */
  function createTruthButton(companyId) {
    const button = document.createElement('button');
    button.className = 'btn btn-primary';
    button.id = CONFIG.BUTTON_ID;
    button.disabled = !companyId;
    button.innerHTML = `
      ${CONFIG.ICON_SVG}
      Master Download Truth JSON
    `;
    
    if (!companyId) {
      button.title = 'No companyId in URL - cannot export Truth';
    } else {
      button.title = 'Download complete Truth JSON (UI + Runtime + Build + Compliance)';
    }
    
    // Click handler
    button.addEventListener('click', () => handleTruthExport(companyId, button));
    
    return button;
  }

  /* --------------------------------------------------------------------------
     BUTTON MOUNTING
     -------------------------------------------------------------------------- */
  function mountButton(button, mountPoint) {
    // Strategy 1: Replace existing download button (if exists)
    const existingButton = document.getElementById(CONFIG.EXISTING_BUTTON_ID);
    if (existingButton) {
      console.info('[TRUTH BUTTON] Replacing existing download button', {
        existingId: CONFIG.EXISTING_BUTTON_ID
      });
      existingButton.replaceWith(button);
      return;
    }
    
    // Strategy 2: Prepend to mount point (appears first)
    console.info('[TRUTH BUTTON] Prepending to mount point (no existing button found)');
    mountPoint.insertBefore(button, mountPoint.firstChild);
  }

  /* --------------------------------------------------------------------------
     TRUTH EXPORT HANDLER
     -------------------------------------------------------------------------- */
  async function handleTruthExport(companyId, button) {
    // Disable button during export
    button.disabled = true;
    const originalHtml = button.innerHTML;
    button.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" class="spin">
        <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" opacity="0.25"/>
        <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      Generating Truth...
    `;
    
    // Add spinner animation
    const style = document.createElement('style');
    style.textContent = '@keyframes spin { to { transform: rotate(360deg); } } .spin { animation: spin 1s linear infinite; }';
    document.head.appendChild(style);
    
    try {
      console.info('[TRUTH EXPORT] Starting export', {
        companyId,
        page: window.location.pathname,
        timestamp: new Date().toISOString()
      });
      
      const startTime = Date.now();
      
      // Fetch truth JSON using centralized auth (same as other Agent Console endpoints)
      const params = new URLSearchParams({
        companyId,
        includeContents: CONFIG.INCLUDE_CONTENTS ? '1' : '0',
        includeBackend: CONFIG.INCLUDE_BACKEND ? '1' : '0'
      });
      const url = `${CONFIG.API_ENDPOINT}?${params.toString()}`;
      
      // Check if AgentConsoleAuth is available (should be loaded before this script)
      if (typeof AgentConsoleAuth === 'undefined' || !AgentConsoleAuth.apiFetch) {
        throw new Error('AgentConsoleAuth not available - ensure lib/auth.js is loaded first');
      }
      
      const truth = await AgentConsoleAuth.apiFetch(url);
      const fetchTime = Date.now() - startTime;

      // Verify embedded content integrity (sha256 must match contentBase64)
      await verifyEmbeddedContentIntegrity(truth);
      
      // Validate truth structure
      if (!truth.truthVersion) {
        console.warn('[TRUTH EXPORT] Missing truthVersion in response', truth);
      }
      
      // Download as file
      const jsonString = JSON.stringify(truth, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const downloadUrl = URL.createObjectURL(blob);
      
      // Generate filename with timestamp
      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 16);
      const filename = `agent-console-truth_${companyId}_${timestamp}.json`;
      
      // Trigger download
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
      
      // Log success with rich details
      console.info('[TRUTH EXPORT] ✅ Export successful', {
        filename,
        size: `${Math.round(blob.size / 1024)}KB`,
        truthVersion: truth.truthVersion,
        truthStatus: truth.truthStatus,
        uiFiles: truth.uiSource?.totalFiles || 0,
        complianceIssues: truth.compliance?.uiCoverageReport?.totalIssues || 0,
        fetchTime: `${fetchTime}ms`,
        page: window.location.pathname
      });
      
      // Show compliance warnings if any
      if (truth.truthStatus === 'INCOMPLETE') {
        console.warn('[TRUTH EXPORT] ⚠️ Truth status: INCOMPLETE', {
          issues: truth.truthStatusDetails?.issues || [],
          compliancePercentage: truth.compliance?.uiCoverageReport?.compliantPercentage || 0
        });
      }
      
      // Visual feedback - log to console, don't block with alert
      // The file download dialog is sufficient user feedback
      console.info(`[TRUTH EXPORT] Download initiated: ${filename} (${Math.round(blob.size / 1024)}KB, status: ${truth.truthStatus})`);
      
      // Use toast if available (non-blocking)
      if (typeof showToast === 'function') {
        if (truth.truthStatus === 'COMPLETE') {
          showToast('success', 'Truth Exported', `Complete system snapshot saved`);
        } else {
          showToast('warning', 'Truth Exported', `Status: ${truth.truthStatus}. Check console for details.`);
        }
      }
      // No alert fallback - the Save As dialog is sufficient feedback
      
    } catch (error) {
      // Log detailed error info including lane failures if available
      const errorDetails = {
        error: error.message,
        stack: error.stack,
        companyId,
        page: window.location.pathname
      };
      
      // Check for lane failures (from improved API error response)
      if (error.data?.laneFailures) {
        errorDetails.laneFailures = error.data.laneFailures;
        console.error('[TRUTH EXPORT] ❌ Lane failures detected:', error.data.laneFailures);
      }
      
      console.error('[TRUTH EXPORT] ❌ Export failed', errorDetails);
      
      // Build user-friendly error message
      let userMessage = error.message || 'Could not generate Truth JSON';
      if (error.data?.laneFailures?.length > 0) {
        const failedLanes = error.data.laneFailures.map(f => `${f.lane}: ${f.error}`).join('; ');
        userMessage = `Lane errors: ${failedLanes}`;
      }
      
      // Visual feedback - use toast if available, otherwise show brief console-visible error
      if (typeof showToast === 'function') {
        showToast('error', 'Export Failed', userMessage);
      } else {
        // Use non-blocking notification - change button color briefly to indicate error
        button.style.backgroundColor = '#dc3545';
        button.style.color = 'white';
        button.textContent = 'Export Failed';
        setTimeout(() => {
          button.style.backgroundColor = '';
          button.style.color = '';
        }, 3000);
      }
      
    } finally {
      // Restore button
      button.disabled = false;
      button.innerHTML = originalHtml;
      style.remove();
    }
  }

  async function verifyEmbeddedContentIntegrity(truth) {
    const uiFiles = truth?.uiSource?.files || [];
    const missingContents = [];
    const hashMismatches = [];

    for (const file of uiFiles) {
      if (file.error) continue;
      if (!file.contentBase64) {
        missingContents.push(file.relativePath || file.path);
        continue;
      }

      const computed = await sha256FromBase64(file.contentBase64);
      if (computed !== file.sha256) {
        hashMismatches.push({
          file: file.relativePath || file.path,
          expected: file.sha256,
          actual: computed
        });
      }
    }

    if (missingContents.length > 0 || hashMismatches.length > 0) {
      throw new Error(
        `Proof verification failed (missingContents=${missingContents.length}, hashMismatches=${hashMismatches.length})`
      );
    }
  }

  async function sha256FromBase64(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /* --------------------------------------------------------------------------
     SUCCESS LOGGING
     -------------------------------------------------------------------------- */
  function logSuccess(mountPoint, companyId) {
    console.info('[TRUTH BUTTON] ✅ Injected successfully', {
      mountPoint: mountPoint.tagName + (mountPoint.id ? '#' + mountPoint.id : '') + (mountPoint.className ? '.' + mountPoint.className.split(' ')[0] : ''),
      companyId: companyId || 'MISSING (button disabled)',
      page: window.location.pathname,
      buttonId: CONFIG.BUTTON_ID
    });
  }

  /* --------------------------------------------------------------------------
     BOOTSTRAP
     -------------------------------------------------------------------------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
