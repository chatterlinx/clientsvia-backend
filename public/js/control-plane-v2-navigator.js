/**
 * ============================================================================
 * CONTROL PLANE V2 NAVIGATOR
 * ============================================================================
 * Purpose: Navigate between tabs from diagnostic "Fix Now" buttons
 * Architecture: Universal navigation system for multi-level tabs
 * Usage: navigateToV2('templates') or navigateToV2('cheat-sheet', 'triage')
 * 
 * Supports:
 * - Main tabs (AiCore, CompanyOps, Billing, Intelligence)
 * - Sub-tabs (Templates, Variables, Live Scenarios, CheatSheet, etc.)
 * - Tertiary tabs (CheatSheet sub-sections like Triage, Frontline-Intel)
 * - Field highlighting (scroll to specific form field)
 * 
 * ============================================================================
 */

class ControlPlaneV2Navigator {
  
  /**
   * Navigate to a specific location in Control Plane V2
   * @param {string} target - The diagnostic target (e.g., "templates", "variables")
   * @param {string} subTarget - Optional tertiary target (e.g., "triage" for CheatSheet)
   * @param {string} fieldId - Optional field ID to highlight
   */
  static navigateTo(target, subTarget = null, fieldId = null) {
    console.log(`🧭 [NAVIGATOR] Navigating to: ${target}`, { subTarget, fieldId });
    
    // ============================================
    // CRITICAL: Check if we're on control-plane-v2.html
    // If not, redirect there first with navigation state
    // ============================================
    const currentPage = window.location.pathname;
    const isOnControlPlane = currentPage.includes('control-plane-v2.html');
    
    if (!isOnControlPlane) {
      console.log(`🧭 [NAVIGATOR] Not on Control Plane V2, redirecting...`);
      
      // Extract companyId from current URL
      const urlParams = new URLSearchParams(window.location.search);
      const companyId = urlParams.get('companyId') || urlParams.get('id');
      
      if (!companyId) {
        console.error(`🧭 [NAVIGATOR] Cannot redirect: companyId not found in URL`);
        return;
      }
      
      // Build navigation state for V2 to restore after load
      const navState = {
        target,
        subTarget,
        fieldId,
        timestamp: Date.now()
      };
      
      // Store in sessionStorage so V2 can pick it up
      sessionStorage.setItem('v2NavigationPending', JSON.stringify(navState));
      
      // Redirect to Control Plane V2
      const redirectUrl = `/control-plane-v2.html?companyId=${companyId}`;
      console.log(`🧭 [NAVIGATOR] Redirecting to: ${redirectUrl}`);
      window.location.href = redirectUrl;
      return;
    }
    
    // Map diagnostic targets to V2 structure
    const navigationMap = {
      // ============================================
      // AICORE TABS
      // ============================================
      'templates': { main: 'aicore', sub: 'templates' },
      'aicore-templates': { main: 'aicore', sub: 'templates' },
      
      'variables': { main: 'aicore', sub: 'variables' },
      'aicore-variables': { main: 'aicore', sub: 'variables' },
      
      'live-scenarios': { main: 'aicore', sub: 'live-scenarios' },
      'aicore-live-scenarios': { main: 'aicore', sub: 'live-scenarios' },
      'scenarios': { main: 'aicore', sub: 'live-scenarios' },
      
      'cheat-sheet': { main: 'aicore', sub: 'cheat-sheet', tertiary: subTarget },
      'cheatsheet': { main: 'aicore', sub: 'cheat-sheet', tertiary: subTarget },
      
      'call-flow': { main: 'aicore', sub: 'call-flow' },
      'knowledgebase': { main: 'aicore', sub: 'knowledgebase' },
      'simulator': { main: 'aicore', sub: 'simulator' },
      'knowledge-ingestion': { main: 'aicore', sub: 'knowledge-ingestion' },
      'versioning': { main: 'aicore', sub: 'versioning' },
      'observability': { main: 'aicore', sub: 'observability' },
      'llm-cortex-intel': { main: 'aicore', sub: 'llm-cortex-intel' },
      
      // ============================================
      // COMPANYOPS TABS
      // ============================================
      'voice-settings': { main: 'companyops', sub: 'voicecore' },
      'voicecore': { main: 'companyops', sub: 'voicecore' },
      'twilio': { main: 'companyops', sub: 'voicecore' },
      'voice': { main: 'companyops', sub: 'voicecore' },
      
      // ============================================
      // BILLING TABS
      // ============================================
      'billing': { main: 'billing', sub: null },
      
      // ============================================
      // INTELLIGENCE TABS
      // ============================================
      'intelligence': { main: 'intelligence', sub: null },
    };
    
    const nav = navigationMap[target];
    
    if (!nav) {
      console.warn(`🧭 [NAVIGATOR] Unknown target: ${target}`);
      console.warn(`🧭 [NAVIGATOR] Available targets:`, Object.keys(navigationMap));
      return;
    }
    
    // Execute navigation
    this._executeNavigation(nav, fieldId);
  }
  
  /**
   * Execute the actual navigation
   */
  static _executeNavigation(nav, fieldId) {
    // Step 1: Activate main tab
    this._activateMainTab(nav.main);
    
    // Step 2: Wait for sub-tabs to render
    setTimeout(() => {
      // Step 3: Activate sub-tab (if specified)
      if (nav.sub) {
        this._activateSubTab(nav.main, nav.sub);
      }
      
      // Step 4: If tertiary tab (CheatSheet), activate it
      if (nav.tertiary) {
        setTimeout(() => {
          this._activateTertiaryTab(nav.tertiary);
        }, 300);
      }
      
      // Step 5: If field specified, scroll to it
      if (fieldId) {
        setTimeout(() => {
          this._scrollToField(fieldId);
        }, nav.tertiary ? 800 : 500);
      }
    }, 100);
    
    console.log(`✅ [NAVIGATOR] Navigation complete`);
  }
  
  /**
   * Activate main tab
   */
  static _activateMainTab(mainTab) {
    console.log(`🧭 [NAVIGATOR] Step 1: Activating main tab: ${mainTab}`);
    
    // Remove active from all main tabs
    document.querySelectorAll('.js-main-tab').forEach(btn => {
      btn.classList.remove('active');
    });
    
    // Add active to target main tab
    const mainBtn = document.querySelector(`[data-main-target="${mainTab}"]`);
    if (mainBtn) {
      mainBtn.classList.add('active');
    } else {
      console.warn(`🧭 [NAVIGATOR] Main tab button not found: ${mainTab}`);
      return;
    }
    
    // Hide all main panels
    document.querySelectorAll('[data-main-panel]').forEach(panel => {
      panel.classList.remove('active');
    });
    
    // Show target main panel
    const mainPanel = document.querySelector(`[data-main-panel="${mainTab}"]`);
    if (mainPanel) {
      mainPanel.classList.add('active');
    } else {
      console.warn(`🧭 [NAVIGATOR] Main panel not found: ${mainTab}`);
    }
    
    // Show/hide secondary nav
    const secondaryNav = document.getElementById(`${mainTab}-subnav`);
    if (secondaryNav) {
      secondaryNav.style.display = 'flex';
    }
    
    // Hide other secondary navs
    document.querySelectorAll('.subnav').forEach(nav => {
      if (nav.id !== `${mainTab}-subnav` && nav.id !== 'cheat-subnav') {
        nav.style.display = 'none';
      }
    });
    
    // Hide CheatSheet nav initially
    const cheatNav = document.getElementById('cheat-subnav');
    if (cheatNav && mainTab !== 'aicore') {
      cheatNav.style.display = 'none';
    }
  }
  
  /**
   * Activate sub-tab (AiCore or CompanyOps)
   */
  static _activateSubTab(mainTab, subTab) {
    console.log(`🧭 [NAVIGATOR] Step 2: Activating sub-tab: ${mainTab} → ${subTab}`);
    
    const tabClass = mainTab === 'aicore' ? 'js-aicore-tab' : 
                     mainTab === 'companyops' ? 'js-companyops-tab' : null;
    
    if (!tabClass) {
      console.warn(`🧭 [NAVIGATOR] No tab class for main tab: ${mainTab}`);
      return;
    }
    
    // Remove active from all sub-tabs
    document.querySelectorAll(`.${tabClass}`).forEach(btn => {
      btn.classList.remove('active');
    });
    
    // Add active to target sub-tab
    const subBtn = document.querySelector(`[data-${mainTab}-target="${subTab}"]`);
    if (subBtn) {
      subBtn.classList.add('active');
      // Trigger click to load content
      subBtn.click();
    } else {
      console.warn(`🧭 [NAVIGATOR] Sub-tab button not found: ${mainTab} → ${subTab}`);
    }
    
    // Show/hide CheatSheet nav if CheatSheet tab
    const cheatNav = document.getElementById('cheat-subnav');
    if (cheatNav) {
      cheatNav.style.display = subTab === 'cheat-sheet' ? 'flex' : 'none';
    }
  }
  
  /**
   * Activate tertiary tab (CheatSheet sub-tabs)
   */
  static _activateTertiaryTab(tertiaryTab) {
    console.log(`🧭 [NAVIGATOR] Step 3: Activating tertiary tab: ${tertiaryTab}`);
    
    // Show CheatSheet tertiary nav
    const cheatNav = document.getElementById('cheat-subnav');
    if (cheatNav) {
      cheatNav.style.display = 'flex';
    } else {
      console.warn(`🧭 [NAVIGATOR] CheatSheet nav not found`);
      return;
    }
    
    // Remove active from all CheatSheet tabs
    document.querySelectorAll('.js-cheat-tab').forEach(btn => {
      btn.classList.remove('active');
    });
    
    // Add active to target tertiary tab
    const tertiaryBtn = document.querySelector(`[data-cheat-target="${tertiaryTab}"]`);
    if (tertiaryBtn) {
      tertiaryBtn.classList.add('active');
      // Trigger click to load content
      tertiaryBtn.click();
    } else {
      console.warn(`🧭 [NAVIGATOR] Tertiary tab button not found: ${tertiaryTab}`);
    }
  }
  
  /**
   * Scroll to and highlight a specific field
   */
  static _scrollToField(fieldId) {
    console.log(`🧭 [NAVIGATOR] Step 4: Scrolling to field: ${fieldId}`);
    
    // Try multiple selectors
    const selectors = [
      `[data-var-key="${fieldId}"]`,
      `#${fieldId}`,
      `[name="${fieldId}"]`,
      `input[placeholder*="${fieldId}"]`,
      `label[for="${fieldId}"]`
    ];
    
    let field = null;
    for (const selector of selectors) {
      field = document.querySelector(selector);
      if (field) break;
    }
    
    if (field) {
      // Scroll into view
      field.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      // Focus if input
      if (field.tagName === 'INPUT' || field.tagName === 'TEXTAREA' || field.tagName === 'SELECT') {
        setTimeout(() => field.focus(), 300);
      }
      
      // Highlight temporarily
      const originalBoxShadow = field.style.boxShadow;
      const originalTransition = field.style.transition;
      
      field.style.transition = 'box-shadow 0.3s';
      field.style.boxShadow = '0 0 0 4px rgba(59, 130, 246, 0.5)';
      
      setTimeout(() => {
        field.style.boxShadow = originalBoxShadow;
        setTimeout(() => {
          field.style.transition = originalTransition;
        }, 300);
      }, 2000);
      
      console.log(`✅ [NAVIGATOR] Field found and highlighted: ${fieldId}`);
    } else {
      console.warn(`🧭 [NAVIGATOR] Field not found: ${fieldId}`);
      console.warn(`🧭 [NAVIGATOR] Tried selectors:`, selectors);
    }
  }
}

// Export globally
window.ControlPlaneV2Navigator = ControlPlaneV2Navigator;

// Convenience function
window.navigateToV2 = (target, subTarget, fieldId) => {
  ControlPlaneV2Navigator.navigateTo(target, subTarget, fieldId);
};

console.log('✅ [NAVIGATOR] Control Plane V2 Navigator loaded and ready');

// ============================================
// AUTO-NAVIGATION: Check for pending navigation on page load
// ============================================
// This runs when control-plane-v2.html loads and restores
// navigation state from diagnostic "Fix Now" buttons
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  const pendingNav = sessionStorage.getItem('v2NavigationPending');
  
  if (pendingNav) {
    console.log('🧭 [NAVIGATOR] Found pending navigation from diagnostic');
    
    try {
      const navState = JSON.parse(pendingNav);
      
      // Clear the pending navigation
      sessionStorage.removeItem('v2NavigationPending');
      
      // Execute navigation after a short delay to let page initialize
      setTimeout(() => {
        console.log('🧭 [NAVIGATOR] Executing pending navigation:', navState);
        ControlPlaneV2Navigator.navigateTo(
          navState.target,
          navState.subTarget,
          navState.fieldId
        );
      }, 500);
      
    } catch (error) {
      console.error('🧭 [NAVIGATOR] Failed to parse pending navigation:', error);
      sessionStorage.removeItem('v2NavigationPending');
    }
  }
});

