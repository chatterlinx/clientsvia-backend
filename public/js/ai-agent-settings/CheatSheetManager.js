// public/js/ai-agent-settings/CheatSheetManager.js
// ============================================================================
// CHEAT SHEET MANAGER - Admin UI Controller
// ============================================================================
// PURPOSE: Manage company-specific cheat sheet rules and policies
// FEATURES: Visual editor, live compilation, conflict detection, test harness
// ARCHITECTURE: Load → Edit → Compile → Test → Deploy
// ============================================================================

// ---------------------------------------------
// COMING SOON TABS (V2-ONLY PLACEHOLDERS)
// ---------------------------------------------
const CHEATSHEET_COMING_SOON_TABS = {
  // 'booking' removed - now fully implemented
  // 'company-contacts' removed - now fully implemented
  // 'links' removed - now fully implemented
  // 'calculator' removed - now fully implemented
  'cheat-active-instructions': {
    title: 'Active Instructions Preview – Coming Soon',
    description: 'This section will show a live preview of the final playbook the AI is running: triage rules, edge cases, behavior rules, and booking logic compiled into one instruction set.'
  }
};

class CheatSheetManager {
  
  constructor(options = {}) {
    console.log('[CHEAT SHEET MANAGER] 🏗️ Constructor called');
    this.companyId = null;
    this.cheatSheet = null;
    this.compilationStatus = null;
    this.isDirty = false;
    this.isReady = false; // NEW: Ready flag to prevent premature actions
    this.currentSubTab = 'triage'; // Default sub-tab
    this.rootSelector = options.rootSelector || '#cheatsheet-container';
    this.rootElement = (typeof document !== 'undefined') ? document.querySelector(this.rootSelector) : null;
    
    // Version System Integration
    this.versioningAdapter = null; // Will be initialized in load()
    this.versionStatus = null; // { live: {...}, draft: {...} }
    this.useVersioning = true; // Feature flag - can be disabled for gradual rollout
    
    // Version Console State (Option A - Dropdown Driven)
    this.useVersionConsole = true; // Feature flag - set to true to use new Version Console
    this.csVersions = []; // All versions for this company
    this.csLiveVersionId = null; // Current live version ID
    this.csWorkspaceVersion = null; // Currently selected workspace version
    this.csHasUnsavedChanges = false; // Dirty flag for workspace
    
    console.log('[CHEAT SHEET MANAGER] 🏗️ About to ensureBaseLayout');
    this.ensureBaseLayout();
    console.log('[CHEAT SHEET MANAGER] 🏗️ Base layout ensured');
    console.log('✅ [CHEAT SHEET MANAGER] Initialized');
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // SUB-TAB NAVIGATION
  // ═══════════════════════════════════════════════════════════════════
  
  /**
   * Update active state on tab navigation buttons
   */
  updateTabActiveState(activeTabId) {
    // Find all tab buttons in the CheatSheet sub-navigation
    const tabButtons = document.querySelectorAll('[data-cheat-target], button[onclick*="switchSubTab"]');
    
    tabButtons.forEach(btn => {
      // Get the tab ID from data attribute or onclick
      let tabId = btn.getAttribute('data-cheat-target');
      if (!tabId) {
        const onclickAttr = btn.getAttribute('onclick');
        if (onclickAttr) {
          const match = onclickAttr.match(/switchSubTab\(['"]([^'"]+)['"]\)/);
          if (match) tabId = match[1];
        }
      }
      
      // Update active state
      if (tabId === activeTabId) {
        btn.classList.add('active');
        // Add inline styles for immediate visual feedback
        btn.style.background = 'rgba(255, 255, 255, 0.2)';
        btn.style.fontWeight = '600';
      } else {
        btn.classList.remove('active');
        // Remove inline styles
        btn.style.background = '';
        btn.style.fontWeight = '';
      }
    });
    
    console.log(`[CHEAT SHEET] 🎨 Updated tab active state: ${activeTabId}`);
  }
  
  switchSubTab(subTab) {
    console.log(`[CHEAT SHEET] Switching to sub-tab: ${subTab}`);
    
    this.currentSubTab = subTab;
    
    // Update active state on tab navigation buttons
    this.updateTabActiveState(subTab);
    
    // Define which tabs are dynamically rendered (V2-only)
    const dynamicTabs = ['booking', 'company-contacts', 'links', 'calculator'];
    const isDynamicTab = dynamicTabs.includes(subTab) || CHEATSHEET_COMING_SOON_TABS[subTab];
    
    // Check if this is a Coming Soon tab (V2-only placeholders)
    if (CHEATSHEET_COMING_SOON_TABS[subTab]) {
      console.log('[CHEAT SHEET] 📋 Routing to Coming Soon renderer for:', subTab);
      
      // Hide lockout screen (admin tabs are always accessible)
      const lockoutScreen = document.getElementById('workspace-lockout-screen');
      if (lockoutScreen) {
        lockoutScreen.style.display = 'none';
      }
      
      this.renderComingSoon(subTab);
      // Hide all V1 sub-tab contents and show V2 container
      document.querySelectorAll('.cheatsheet-subtab-content:not(#cheatsheet-v2-dynamic-content)').forEach(el => {
        el.classList.add('hidden');
      });
      const v2Container = document.getElementById('cheatsheet-v2-dynamic-content');
      if (v2Container) {
        v2Container.classList.remove('hidden');
        v2Container.style.display = ''; // Ensure visible
      }
      console.log(`[CHEAT SHEET] ✅ Switched to Coming Soon tab: ${subTab}`);
      return;
    }
    
    // Check if this is Booking Rules tab (V2-only, fully implemented)
    if (subTab === 'booking') {
      console.log('[CHEAT SHEET] 📅 Routing to Booking Rules renderer');
      
      // If no workspace, show lockout screen instead of content
      if (!this.csWorkspaceVersion) {
        console.log('[CHEAT SHEET] ⚠️ No workspace selected, showing lockout screen');
        const lockoutScreen = document.getElementById('workspace-lockout-screen');
        if (lockoutScreen) {
          lockoutScreen.style.display = 'block';
        }
        // Hide all content
        document.querySelectorAll('.cheatsheet-subtab-content').forEach(el => {
          el.classList.add('hidden');
        });
        const v2Container = document.getElementById('cheatsheet-v2-dynamic-content');
        if (v2Container) {
          v2Container.classList.add('hidden');
        }
        return;
      }
      
      // Hide lockout screen when workspace is active
      const lockoutScreen = document.getElementById('workspace-lockout-screen');
      if (lockoutScreen) {
        lockoutScreen.style.display = 'none';
      }
      
      this.renderBookingRules();
      // Hide all V1 sub-tab contents and show V2 container
      document.querySelectorAll('.cheatsheet-subtab-content:not(#cheatsheet-v2-dynamic-content)').forEach(el => {
        el.classList.add('hidden');
      });
      const v2Container = document.getElementById('cheatsheet-v2-dynamic-content');
      if (v2Container) {
        v2Container.classList.remove('hidden');
        v2Container.style.display = ''; // Ensure visible
      }
      console.log(`[CHEAT SHEET] ✅ Switched to Booking Rules tab`);
      return;
    }
    
    // Check if this is Company Contacts tab (V2-only, fully implemented)
    if (subTab === 'company-contacts') {
      console.log('[CHEAT SHEET] 📞 Routing to Company Contacts renderer');
      
      // If no workspace, show lockout screen instead of content
      if (!this.csWorkspaceVersion) {
        console.log('[CHEAT SHEET] ⚠️ No workspace selected, showing lockout screen');
        const lockoutScreen = document.getElementById('workspace-lockout-screen');
        if (lockoutScreen) lockoutScreen.style.display = 'block';
        document.querySelectorAll('.cheatsheet-subtab-content').forEach(el => el.classList.add('hidden'));
        const v2Container = document.getElementById('cheatsheet-v2-dynamic-content');
        if (v2Container) v2Container.classList.add('hidden');
        return;
      }
      
      // Hide lockout, show content
      const lockoutScreen = document.getElementById('workspace-lockout-screen');
      if (lockoutScreen) lockoutScreen.style.display = 'none';
      
      this.renderCompanyContacts();
      document.querySelectorAll('.cheatsheet-subtab-content:not(#cheatsheet-v2-dynamic-content)').forEach(el => {
        el.classList.add('hidden');
      });
      const v2Container = document.getElementById('cheatsheet-v2-dynamic-content');
      if (v2Container) {
        v2Container.classList.remove('hidden');
        v2Container.style.display = '';
      }
      console.log(`[CHEAT SHEET] ✅ Switched to Company Contacts tab`);
      return;
    }
    
    // Check if this is Links tab (V2-only, fully implemented)
    if (subTab === 'links') {
      console.log('[CHEAT SHEET] 🔗 Routing to Links renderer');
      
      // If no workspace, show lockout screen instead of content
      if (!this.csWorkspaceVersion) {
        console.log('[CHEAT SHEET] ⚠️ No workspace selected, showing lockout screen');
        const lockoutScreen = document.getElementById('workspace-lockout-screen');
        if (lockoutScreen) lockoutScreen.style.display = 'block';
        document.querySelectorAll('.cheatsheet-subtab-content').forEach(el => el.classList.add('hidden'));
        const v2Container = document.getElementById('cheatsheet-v2-dynamic-content');
        if (v2Container) v2Container.classList.add('hidden');
        return;
      }
      
      // Hide lockout, show content
      const lockoutScreen = document.getElementById('workspace-lockout-screen');
      if (lockoutScreen) lockoutScreen.style.display = 'none';
      
      this.renderLinks();
      document.querySelectorAll('.cheatsheet-subtab-content:not(#cheatsheet-v2-dynamic-content)').forEach(el => {
        el.classList.add('hidden');
      });
      const v2Container = document.getElementById('cheatsheet-v2-dynamic-content');
      if (v2Container) {
        v2Container.classList.remove('hidden');
        v2Container.style.display = '';
      }
      console.log(`[CHEAT SHEET] ✅ Switched to Links tab`);
      return;
    }
    
    // Check if this is Calculator tab (V2-only, fully implemented)
    if (subTab === 'calculator') {
      console.log('[CHEAT SHEET] 🧮 Routing to Calculator renderer');
      
      // If no workspace, show lockout screen instead of content
      if (!this.csWorkspaceVersion) {
        console.log('[CHEAT SHEET] ⚠️ No workspace selected, showing lockout screen');
        const lockoutScreen = document.getElementById('workspace-lockout-screen');
        if (lockoutScreen) lockoutScreen.style.display = 'block';
        document.querySelectorAll('.cheatsheet-subtab-content').forEach(el => el.classList.add('hidden'));
        const v2Container = document.getElementById('cheatsheet-v2-dynamic-content');
        if (v2Container) v2Container.classList.add('hidden');
        return;
      }
      
      // Hide lockout, show content
      const lockoutScreen = document.getElementById('workspace-lockout-screen');
      if (lockoutScreen) lockoutScreen.style.display = 'none';
      
      this.renderCalculator();
      document.querySelectorAll('.cheatsheet-subtab-content:not(#cheatsheet-v2-dynamic-content)').forEach(el => {
        el.classList.add('hidden');
      });
      const v2Container = document.getElementById('cheatsheet-v2-dynamic-content');
      if (v2Container) {
        v2Container.classList.remove('hidden');
        v2Container.style.display = '';
      }
      console.log(`[CHEAT SHEET] ✅ Switched to Calculator tab`);
      return;
    }
    
    // Check if this is Version History tab (V2-only, fully implemented)
    if (subTab === 'version-history') {
      console.log('[CHEAT SHEET] 📚 Routing to Version History renderer');
      
      // Hide lockout screen (admin tabs are always accessible)
      const lockoutScreen = document.getElementById('workspace-lockout-screen');
      if (lockoutScreen) {
        lockoutScreen.style.display = 'none';
      }
      
      this.renderVersionHistory();
      // Hide all V1 sub-tab contents and show V2 container
      document.querySelectorAll('.cheatsheet-subtab-content:not(#cheatsheet-v2-dynamic-content)').forEach(el => {
        el.classList.add('hidden');
      });
      const v2Container = document.getElementById('cheatsheet-v2-dynamic-content');
      if (v2Container) {
        v2Container.classList.remove('hidden');
        v2Container.style.display = ''; // Ensure visible
      }
      console.log(`[CHEAT SHEET] ✅ Switched to Version History tab`);
      return;
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // OLD V1 TABS (triage, transfer-calls, edge-cases, behavior, guardrails, frontline-intel)
    // ═══════════════════════════════════════════════════════════════════
    
    // Hide the V2 dynamic content container
    const v2Container = document.getElementById('cheatsheet-v2-dynamic-content');
    if (v2Container) {
      v2Container.classList.add('hidden');
      console.log('[CHEAT SHEET] 🧹 Hidden V2 dynamic content container to show V1 tab');
    }
    
    // Hide all sub-tab contents (both V1 and V2)
    document.querySelectorAll('.cheatsheet-subtab-content').forEach(el => {
      el.classList.add('hidden');
    });
    
    // Remove active state from all buttons
    document.querySelectorAll('.cheatsheet-subtab-btn').forEach(btn => {
      btn.classList.remove('border-indigo-600', 'text-indigo-600');
      btn.classList.add('border-transparent', 'text-gray-500', 'hover:text-gray-700', 'hover:border-gray-300');
    });
    
    // Show selected sub-tab content
    const contentEl = document.getElementById(`cheatsheet-subtab-${subTab}`);
    if (contentEl) {
      contentEl.classList.remove('hidden');
    }
    
    // Set active state on selected button
    const activeBtn = document.querySelector(`.cheatsheet-subtab-btn[data-subtab="${subTab}"]`);
    if (activeBtn) {
      activeBtn.classList.add('border-indigo-600', 'text-indigo-600');
      activeBtn.classList.remove('border-transparent', 'text-gray-500', 'hover:text-gray-700', 'hover:border-gray-300');
    }
    
    console.log(`[CHEAT SHEET] ✅ Switched to: ${subTab}`);
  }

  ensureBaseLayout() {
    if (!this.rootElement && typeof document !== 'undefined') {
      this.rootElement = document.querySelector(this.rootSelector);
    }

    if (!this.rootElement) {
      console.warn('[CHEAT SHEET] Root container not found - expected selector:', this.rootSelector);
      return;
    }

    if (!this.rootElement.querySelector('#triage-cards-list-section')) {
      console.log('[CHEAT SHEET] Injecting default layout into', this.rootSelector);
      this.rootElement.innerHTML = this.getDefaultLayoutMarkup();
    }

    this.attachLayoutActionHandlers();
  }

  getDefaultLayoutMarkup() {
    return `
      <div data-cheatsheet-layout="control-plane-v2" style="display:flex; flex-direction:column; gap:24px;">
        <div id="cheatsheet-status"></div>

        <!-- WORKSPACE LOCKOUT SCREEN (shown when no version selected) -->
        <div id="workspace-lockout-screen" style="display: none; background: #ffffff; border-radius: 16px; padding: 80px 40px; text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,0.08); border: 2px dashed #d1d5db;">
          <div style="max-width: 600px; margin: 0 auto;">
            <div style="font-size: 64px; margin-bottom: 24px; opacity: 0.3;">🔒</div>
            <h2 style="font-size: 28px; font-weight: 700; color: #111827; margin: 0 0 16px 0;">
              Select a Version to Edit
            </h2>
            <p style="font-size: 16px; color: #6b7280; line-height: 1.6; margin: 0 0 32px 0;">
              Configuration tabs are locked until you select a workspace version from the dropdown above.
            </p>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 32px; text-align: left;">
              <div style="padding: 20px; background: #f0fdf4; border-radius: 12px; border: 2px solid #10b981;">
                <div style="font-size: 20px; margin-bottom: 8px;">✅</div>
                <h3 style="font-size: 14px; font-weight: 600; color: #166534; margin: 0 0 8px 0;">What you can do:</h3>
                <ul style="font-size: 13px; color: #166534; margin: 0; padding-left: 20px; line-height: 1.8;">
                  <li>View Version History</li>
                  <li>Create a new draft</li>
                  <li>Edit an existing version</li>
                </ul>
              </div>
              
              <div style="padding: 20px; background: #fef2f2; border-radius: 12px; border: 2px solid #ef4444;">
                <div style="font-size: 20px; margin-bottom: 8px;">⚠️</div>
                <h3 style="font-size: 14px; font-weight: 600; color: #991b1b; margin: 0 0 8px 0;">What's locked:</h3>
                <ul style="font-size: 13px; color: #991b1b; margin: 0; padding-left: 20px; line-height: 1.8;">
                  <li>🔴 AI Behavior Config (8 tabs)</li>
                  <li>🔵 Reference Data (2 tabs)</li>
                  <li>All editing capabilities</li>
                </ul>
              </div>
            </div>
            
            <div style="padding: 16px; background: #eff6ff; border-radius: 8px; border-left: 4px solid #3b82f6;">
              <p style="font-size: 13px; color: #1e40af; margin: 0; font-weight: 500;">
                💡 <strong>Tip:</strong> Use the "Select version to edit" dropdown at the top to choose a workspace, or click "Version History" to create a new draft.
              </p>
            </div>
          </div>
        </div>

        <div id="cheatsheet-subtab-triage" class="cheatsheet-subtab-content">
          <div id="triage-cards-list-section"></div>
          <div id="manual-triage-table-section"></div>
          <div id="triage-builder-section"></div>
        </div>

        <div id="cheatsheet-subtab-frontline-intel" class="cheatsheet-subtab-content hidden">
          <div id="company-instructions-section"></div>
        </div>

        <div id="cheatsheet-subtab-transfer-calls" class="cheatsheet-subtab-content hidden">
          <div class="mb-6">
            <h3 style="font-size: 20px; font-weight: 700; color: #111827; margin-bottom: 6px;">
              <i class="fas fa-phone-square" style="margin-right: 8px; color: #2563eb;"></i>Transfer Calls - Routing Department
            </h3>
            <p style="font-size: 13px; color: #6b7280;">
              Configure transfer routing rules. Route calls to specific departments or people based on intent. Second priority after edge cases.
            </p>
          </div>

          <div id="transfer-rules-section" class="bg-white rounded-lg shadow-sm border border-blue-200 p-6">
            <div class="flex" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
              <div>
                <h4 style="font-size: 16px; font-weight: 600; color: #111827; margin:0;">
                  <i class="fas fa-phone" style="margin-right:6px; color:#2563eb;"></i>Transfer Rules
                </h4>
                <p style="font-size: 12px; color:#6b7280; margin-top:4px;">
                  Transfer rules route calls to specific departments or people based on intent.
                </p>
              </div>
              <button type="button" data-cheatsheet-action="add-transfer-rule" style="padding:8px 14px; border-radius:8px; border:none; background:#2563eb; color:#fff; font-size:13px; font-weight:600; display:flex; align-items:center; gap:6px;">
                <i class="fas fa-plus"></i>Add Transfer Rule
              </button>
            </div>

            <div id="transfer-rules-list" class="space-y-3" style="display:flex; flex-direction:column; gap:12px;">
              <!-- Transfer rules render here -->
            </div>
          </div>
        </div>

        <div id="cheatsheet-subtab-edge-cases" class="cheatsheet-subtab-content hidden">
          <div class="mb-6">
            <h3 style="font-size: 20px; font-weight: 700; color: #111827; margin-bottom: 6px;">
              <i class="fas fa-exclamation-triangle" style="margin-right: 8px; color: #f59e0b;"></i>Edge Cases - Spam + Abnormal Handling
            </h3>
            <p style="font-size: 13px; color: #6b7280;">
              Handle unusual caller inputs (machine detection, delays, wrong numbers, spam, etc.). Highest priority - short-circuits all other rules when matched.
            </p>
          </div>

          <div id="edge-cases-section" class="bg-white rounded-lg shadow-sm border border-yellow-200 p-6">
            <div class="flex" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
              <div>
                <h4 style="font-size: 16px; font-weight: 600; color: #111827; margin:0;">
                  <i class="fas fa-exclamation-triangle" style="margin-right:6px; color:#f59e0b;"></i>Edge Cases
                </h4>
                <p style="font-size: 12px; color:#6b7280; margin-top:4px;">
                  Edge cases short-circuit everything else. Use for spam, IVR detection, wrong number, etc.
                </p>
              </div>
              <button type="button" data-cheatsheet-action="add-edge-case" style="padding:8px 14px; border-radius:8px; border:none; background:#f59e0b; color:#fff; font-size:13px; font-weight:600; display:flex; align-items:center; gap:6px;">
                <i class="fas fa-plus"></i>Add Edge Case
              </button>
            </div>

            <div id="edge-cases-list" class="space-y-3" style="display:flex; flex-direction:column; gap:12px;">
              <!-- Edge cases render here -->
            </div>
          </div>
        </div>

        <div id="cheatsheet-subtab-behavior" class="cheatsheet-subtab-content hidden">
          <div id="behavior-rules-section">
            <div id="behavior-rules-list"></div>
          </div>
        </div>

        <div id="cheatsheet-subtab-guardrails" class="cheatsheet-subtab-content hidden">
          <div id="guardrails-section">
            <div id="guardrails-list"></div>
          </div>
          <div id="action-allowlist"></div>
        </div>

        <!-- V2-ONLY DYNAMIC CONTENT CONTAINER -->
        <div id="cheatsheet-v2-dynamic-content" class="cheatsheet-subtab-content hidden" data-dynamic-cheat-content style="background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 50%, #2563eb 100%); border-radius: 16px; padding: 0; min-height: 400px; box-shadow: 0 4px 20px rgba(30, 58, 138, 0.15);">
          <!-- Booking Rules, Company Contacts, Links, Calculator, Coming Soon render here -->
          <!-- Modern blue gradient background distinguishes V2 tabs from V1 white sections -->
        </div>
      </div>
    `;
  }

  attachLayoutActionHandlers() {
    if (!this.rootElement) return;
    if (this.rootElement.dataset.actionsBound === 'true') return;

    this.rootElement.dataset.actionsBound = 'true';

    this.rootElement.addEventListener('click', (event) => {
      const actionBtn = event.target.closest('[data-cheatsheet-action]');
      if (!actionBtn) return;

      const action = actionBtn.getAttribute('data-cheatsheet-action');
      event.preventDefault();

      if (action === 'add-transfer-rule') {
        console.log('🔘 [CHEAT SHEET BUTTON] Add Transfer Rule clicked');
        this.addTransferRule();
      } else if (action === 'add-edge-case') {
        console.log('🔘 [CHEAT SHEET BUTTON] Add Edge Case clicked');
        this.addEdgeCase();
      }
    });
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // LOAD CHEAT SHEET
  // ═══════════════════════════════════════════════════════════════════
  
  async loadGlobalCategories() {
    // Cache to avoid repeated network calls
    if (this.globalCategories && Array.isArray(this.globalCategories)) {
      return this.globalCategories;
    }
    
    try {
      const response = await fetch('/api/global-config/categories', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('adminToken')}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        console.error('[CHEAT SHEET] Failed to load global categories', response.status);
        this.globalCategories = [];
        return this.globalCategories;
      }
      
      const result = await response.json();
      if (!result || !result.success) {
        console.error('[CHEAT SHEET] Global categories response not successful', result);
        this.globalCategories = [];
        return this.globalCategories;
      }
      
      this.globalCategories = Array.isArray(result.data) ? result.data : [];
      console.log('[CHEAT SHEET] ✅ Global categories loaded:', this.globalCategories.length);
      
      // After categories loaded, detect if this company already has a shared global config
      if (this.companyId && this.companyCategoryId) {
        try {
          const sharedResponse = await fetch(`/api/global-config?categoryId=${encodeURIComponent(this.companyCategoryId)}`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('adminToken')}`,
              'Content-Type': 'application/json'
            }
          });
          
          if (sharedResponse.ok) {
            const sharedResult = await sharedResponse.json();
            if (sharedResult && sharedResult.success && Array.isArray(sharedResult.data)) {
              const match = sharedResult.data.find((item) => item.companyId === this.companyId);
              if (match) {
                this.hasSharedGlobalConfig = true;
                // Store the MongoDB ObjectId (_id) of the shared version, not versionId
                this.sharedGlobalVersionMongoId = match.cheatSheetVersionId;
                console.log('[CHEAT SHEET] ✅ Company has already shared config to global (MongoDB ID):', this.sharedGlobalVersionMongoId);
              }
            }
          }
        } catch (e) {
          console.error('[CHEAT SHEET] Error checking shared global config state', e);
        }
      }
      
      return this.globalCategories;
    } catch (err) {
      console.error('[CHEAT SHEET] Error loading global categories', err);
      this.globalCategories = [];
      return this.globalCategories;
    }
  }
  
  async load(companyId) {
    this.companyId = companyId;
    this.isReady = false; // Reset ready flag during load
    
    console.log('[CHEAT SHEET] Loading for company:', companyId);
    
    try {
      const token = localStorage.getItem('adminToken');
      
      // Initialize versioning adapter if enabled
      if (this.useVersioning && typeof CheatSheetVersioningAdapter !== 'undefined') {
        console.log('[CHEAT SHEET] 🔄 Initializing versioning adapter...');
        this.versioningAdapter = new CheatSheetVersioningAdapter(companyId);
        
        try {
          // Initialize adapter (fetches status and sets up token)
          await this.versioningAdapter.initialize();
          
          // Access status from adapter's property
          this.versionStatus = {
            liveVersion: this.versioningAdapter.getLive(),
            draftVersion: this.versioningAdapter.getDraft()
          };
          console.log('[CHEAT SHEET] ✅ Version status loaded:', this.versionStatus);
        } catch (versionError) {
          console.warn('[CHEAT SHEET] ⚠️ Version system not available, falling back to legacy mode:', versionError);
          this.useVersioning = false; // Graceful degradation
        }
      }
      
      const response = await fetch(`/api/company/${companyId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      const company = data.company || data;
      
      // Store company category ID for Global Config Sharing feature
      this.companyCategoryId = company.cheatSheetCategoryId || null;
      this.hasSharedGlobalConfig = false; // Will be set to true if company has shared config
      this.sharedGlobalVersionMongoId = null; // Track which specific version is shared (MongoDB _id)
      
      this.cheatSheet = company.aiAgentSettings?.cheatSheet || this.getDefaultCheatSheet();
      
      // ✅ CHECKPOINT: Initialize V2 fields if they don't exist (for existing cheatSheets from MongoDB)
      console.log('[CHEAT SHEET] 📊 CHECKPOINT: Raw loaded data:', this.cheatSheet);
      console.log('[CHEAT SHEET] 🔍 LOAD DEBUG: V2 arrays in raw data?', {
        hasBookingRules: 'bookingRules' in this.cheatSheet,
        bookingRulesIsArray: Array.isArray(this.cheatSheet.bookingRules),
        bookingRulesValue: this.cheatSheet.bookingRules,
        hasCompanyContacts: 'companyContacts' in this.cheatSheet,
        hasLinks: 'links' in this.cheatSheet,
        hasCalculators: 'calculators' in this.cheatSheet
      });
      
      if (!Array.isArray(this.cheatSheet.bookingRules)) {
        console.log('[CHEAT SHEET] 🔧 Initializing bookingRules array (was missing)');
        this.cheatSheet.bookingRules = [];
      }
      if (!Array.isArray(this.cheatSheet.companyContacts)) {
        console.log('[CHEAT SHEET] 🔧 Initializing companyContacts array (was missing)');
        this.cheatSheet.companyContacts = [];
      }
      if (!Array.isArray(this.cheatSheet.links)) {
        console.log('[CHEAT SHEET] 🔧 Initializing links array (was missing)');
        this.cheatSheet.links = [];
      }
      if (!Array.isArray(this.cheatSheet.calculators)) {
        console.log('[CHEAT SHEET] 🔧 Initializing calculators array (was missing)');
        this.cheatSheet.calculators = [];
      }
      
      console.log('[CHEAT SHEET] ✅ Loaded successfully with V2 fields initialized');
      console.log('[CHEAT SHEET] 📊 bookingRules:', this.cheatSheet.bookingRules?.length || 0);
      console.log('[CHEAT SHEET] 📊 companyContacts:', this.cheatSheet.companyContacts?.length || 0);
      console.log('[CHEAT SHEET] 📊 links:', this.cheatSheet.links?.length || 0);
      console.log('[CHEAT SHEET] 📊 calculators:', this.cheatSheet.calculators?.length || 0);
      console.log('[CHEAT SHEET] 📊 About to render() - cheatSheet exists:', !!this.cheatSheet);
      
      // Load global categories for Version History → Global Configurations feature
      await this.loadGlobalCategories();
      
      // Initialize Version Console (if enabled)
      if (this.useVersionConsole && this.versioningAdapter) {
        console.log('[CHEAT SHEET] 🎮 Initializing Version Console...');
        await this.csInit();
        console.log('[CHEAT SHEET] ✅ Version Console initialized');
      }
      
      this.render();
      console.log('[CHEAT SHEET] 📊 render() completed, about to switchSubTab');
      this.switchSubTab('triage'); // Initialize to Triage sub-tab
      console.log('[CHEAT SHEET] 📊 switchSubTab completed, marking as ready');
      this.isDirty = false;
      this.isReady = true; // Mark as ready after successful load
      console.log('[CHEAT SHEET] ✅ Manager is now ready for user actions');
      
    } catch (error) {
      console.error('[CHEAT SHEET] Load failed:', error);
      this.showNotification('Failed to load cheat sheet', 'error');
      
      // Load defaults
      this.cheatSheet = this.getDefaultCheatSheet();
      this.render();
      this.isReady = true; // Still mark as ready even with defaults
      console.log('[CHEAT SHEET] ✅ Manager is now ready (loaded with defaults)');
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // GET DEFAULT CHEAT SHEET
  // ═══════════════════════════════════════════════════════════════════
  
  getDefaultCheatSheet() {
    return {
      version: 1,
      status: 'draft',
      updatedBy: 'admin',
      updatedAt: new Date().toISOString(),
      
      frontlineIntel: null, // Will be populated from backend with default template
      behaviorRules: [],
      edgeCases: [],
      transferRules: [],
      guardrails: [],
      allowedActions: [],
      
      // V2-only fields
      bookingRules: [],
      companyContacts: [],
      links: [],
      calculators: []
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // RENDER UI
  // ═══════════════════════════════════════════════════════════════════
  
  render() {
    console.log('[CHEAT SHEET] 🎨 render() called - cheatSheet exists?', !!this.cheatSheet);
    
    // Render Version Console (ONLY UI)
    if (this.useVersionConsole && this.versioningAdapter) {
      this.renderVersionConsole();
    }
    
    this.renderCompanyInstructions();
    this.renderTriageCardsList(); // 🎯 Triage Cards Management (atomic source of truth) - FIRST
    this.renderManualTriageTable(); // 📋 Manual Triage Rules Editor (quick add/edit) - SECOND
    this.renderTriageBuilder(); // 🤖 AI Triage Builder (enterprise content generator) - THIRD
    this.renderBehaviorRules();
    console.log('[CHEAT SHEET] 🎨 About to renderEdgeCases - cheatSheet exists?', !!this.cheatSheet);
    this.renderEdgeCases();
    console.log('[CHEAT SHEET] 🎨 About to renderTransferRules - cheatSheet exists?', !!this.cheatSheet);
    this.renderTransferRules();
    this.renderGuardrails();
    this.renderActionAllowlist();
    console.log('[CHEAT SHEET] 🎨 render() complete');
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // RENDER COMPANY INSTRUCTIONS
  // ═══════════════════════════════════════════════════════════════════
  
  renderCompanyInstructions() {
    const container = document.getElementById('company-instructions-section');
    if (!container) return;
    
    // Extract frontlineIntel text (may be string or {instructions: "text"} object)
    let instructions = '';
    if (typeof this.cheatSheet.frontlineIntel === 'string') {
      instructions = this.cheatSheet.frontlineIntel;
    } else if (typeof this.cheatSheet.frontlineIntel === 'object' && this.cheatSheet.frontlineIntel) {
      instructions = this.cheatSheet.frontlineIntel.instructions || '';
    }
    
    const charCount = instructions.length;
    
    container.innerHTML = `
      <div class="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
        
        <!-- Header -->
        <div class="bg-gradient-to-r from-indigo-50 to-purple-50 border-b border-gray-200 px-6 py-4">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-lg font-semibold text-gray-900 flex items-center">
                <span class="mr-2">🧠</span>
                Frontline-Intel
              </h3>
              <p class="text-sm text-gray-600 mt-1">
                The intelligent command layer that processes EVERY call before routing
              </p>
            </div>
            <div class="flex items-center space-x-3">
              <button 
                onclick="cheatSheetManager.openFullEditor()" 
                class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium flex items-center space-x-2"
              >
                <span>📝</span>
                <span>Open Full Editor</span>
              </button>
              <button 
                onclick="cheatSheetManager.resetFrontlineIntel()" 
                class="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium flex items-center space-x-2"
              >
                <span>🔄</span>
                <span>Reset to Default</span>
              </button>
            </div>
          </div>
        </div>
        
        <!-- Content -->
        <div class="p-6">
          
          <!-- Info Box -->
          <div class="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div class="flex items-start space-x-3">
              <span class="text-blue-600 text-xl">💡</span>
              <div class="flex-1">
                <h4 class="text-sm font-semibold text-blue-900 mb-1">What is Frontline-Intel?</h4>
                <p class="text-sm text-blue-800 mb-2">
                  Frontline-Intel is your AI receptionist - an intelligent gatekeeper that extracts intent, looks up customers, validates company/service, and normalizes input before routing.
                  Acts like a human front desk, but smarter!
                </p>
                <ul class="text-sm text-blue-800 space-y-1">
                  <li>• <strong>Conversational Tone:</strong> "Never interrupt the caller", "Always say 'Ok' instead of 'Got it!'"</li>
                  <li>• <strong>Booking Protocols:</strong> "Round appointment times to next hour + 2 hour buffer"</li>
                  <li>• <strong>Transfer Rules:</strong> "Before transferring, collect name, phone, and reason for call"</li>
                  <li>• <strong>Emergency Handling:</strong> "If caller says 'emergency', connect immediately"</li>
                </ul>
                <p class="text-sm text-blue-700 mt-2 font-medium">
                  ✏️ Fully customizable • 🔄 Resettable to default template • 📋 Works alongside structured rules
                </p>
              </div>
            </div>
          </div>
          
          <!-- Textarea -->
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-2">
              Instructions (Natural Language)
            </label>
            <textarea 
              id="company-instructions-textarea"
              class="w-full h-96 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono text-sm resize-y"
              placeholder="Enter your Frontline-Intel protocols here..."
              onchange="cheatSheetManager.updateFrontlineIntel()"
            >${instructions}</textarea>
            
            <!-- Character Counter -->
            <div class="flex items-center justify-between mt-2">
              <span class="text-xs text-gray-500">
                <strong>${charCount.toLocaleString()}</strong> characters
              </span>
              <span class="text-xs text-gray-400 italic">
                Changes auto-save when you edit
              </span>
            </div>
          </div>
          
          <!-- Action Buttons -->
          <div class="flex items-center justify-end space-x-3 pt-4 border-t border-gray-200">
            <button 
              onclick="cheatSheetManager.resetFrontlineIntel()" 
              class="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
            >
              🔄 Reset to Default
            </button>
            <button 
              onclick="cheatSheetManager.saveFrontlineIntel()" 
              class="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
            >
              💾 Save Frontline-Intel
            </button>
          </div>
          
        </div>
      </div>
    `;
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // COMPANY INSTRUCTIONS HANDLERS
  // ═══════════════════════════════════════════════════════════════════
  
  updateFrontlineIntel() {
    const textarea = document.getElementById('company-instructions-textarea');
    if (!textarea) return;
    
    this.cheatSheet.frontlineIntel = textarea.value;
    this.markDirty();
    
    console.log('[CHEAT SHEET] Company instructions updated:', textarea.value.length, 'characters');
  }
  
  async saveFrontlineIntel() {
    console.log('[CHEAT SHEET] Saving Frontline-Intel...');
    
    const textarea = document.getElementById('company-instructions-textarea');
    if (!textarea) return;
    
    this.cheatSheet.frontlineIntel = textarea.value;
    
    await this.save();
    this.showNotification('✅ Frontline-Intel saved successfully!', 'success');
  }
  
  async resetFrontlineIntel() {
    const confirmed = confirm(
      '🔄 Reset Frontline-Intel to Default Template?\n\n' +
      'This will restore the professional starter template.\n' +
      'Your custom Frontline-Intel protocols will be replaced.\n\n' +
      'Continue?'
    );
    
    if (!confirmed) return;
    
    console.log('[CHEAT SHEET] Resetting company instructions to default...');
    
    // TEMPORARY FIX: Just set default content directly
    // The API endpoint exists but might be having issues
    this.cheatSheet.frontlineIntel = `# Frontline-Intel Protocol

## Core Mission
You are the intelligent first point of contact. Understand WHY the customer is calling, validate info, and route appropriately.

## Key Protocols

### 1. Greeting
"Thank you for calling, how can I help you today?"

### 2. Information Gathering
- Name, Phone, Address, Issue Details

### 3. Service Classification
- Emergency, Repair, Maintenance, Installation, Question

### 4. Booking
- Emergency: Same-day
- Repairs: Next day + buffer
- Maintenance: Flexible

Remember: Make every caller feel heard and confident they're in good hands.`;
    
    // Re-render to show updated instructions
    this.renderCompanyInstructions();
    this.markDirty();
    
    console.log('[CHEAT SHEET] ✅ Reset complete (using default template)');
    this.showNotification('✅ Frontline-Intel reset to default template!', 'success');
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // AI TRIAGE BUILDER - ENTERPRISE CONTENT GENERATOR
  // ═══════════════════════════════════════════════════════════════════
  // Purpose: LLM-powered triage content generator for service type classification
  // Role: Offline admin tool - generates content for human review/approval
  // Output: Frontline-Intel section, Cheat Sheet map, Response Library
  // ═══════════════════════════════════════════════════════════════════
  
  renderTriageBuilder() {
    const container = document.getElementById('triage-builder-section');
    if (!container) return;
    
    // Get company data for context
    const companyData = this.getCompanyContext();
    
    container.innerHTML = `
      <div class="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
        
        <!-- Header -->
        <div class="bg-gradient-to-r from-purple-50 to-indigo-50 border-b border-gray-200 px-6 py-4">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-lg font-semibold text-gray-900 flex items-center">
                <span class="mr-2">✨</span>
                AI Triage Builder
                <span class="ml-3 px-2 py-1 text-xs font-semibold bg-purple-100 text-purple-700 rounded-full">
                  ENTERPRISE
                </span>
              </h3>
              <p class="text-sm text-gray-600 mt-1">
                LLM-powered content generator for service type triage rules & response scripts
              </p>
            </div>
            <button 
              onclick="cheatSheetManager.toggleTriageBuilder()" 
              id="triage-builder-toggle-btn"
              class="p-2 text-gray-600 hover:text-gray-900 transition-colors"
              title="Expand/Collapse"
            >
              <i class="fas fa-chevron-down" id="triage-builder-toggle-icon"></i>
            </button>
          </div>
        </div>
        
        <!-- Collapsible Content -->
        <div id="triage-builder-content" class="hidden">
          
          <!-- Info Banner -->
          <div class="px-6 pt-4">
            <div class="p-4 bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 rounded-lg">
              <div class="flex items-start space-x-3">
                <span class="text-purple-600 text-xl">💡</span>
                <div class="flex-1">
                  <h4 class="text-sm font-semibold text-purple-900 mb-1">How This Works</h4>
                  <p class="text-sm text-purple-800 mb-2">
                    Describe a triage scenario (e.g., "customer wants cheap maintenance but AC isn't cooling"), and the AI will generate:
                  </p>
                  <ul class="text-sm text-purple-800 space-y-1">
                    <li>• <strong>Frontline-Intel procedural text</strong> — How to handle the scenario step-by-step</li>
                    <li>• <strong>Cheat Sheet triage map</strong> — Symptom keywords → service type classification</li>
                    <li>• <strong>Response Library</strong> — 7-10 natural, human-like phrase variations</li>
                  </ul>
                  <p class="text-sm text-purple-700 mt-2 font-medium">
                    ⚠️ Output is for admin review only — NOT used for live calls until you approve & paste it in.
                  </p>
                </div>
              </div>
            </div>
          </div>
          
          <!-- Input Form -->
          <div class="px-6 py-4">
            <form id="triage-builder-form" onsubmit="cheatSheetManager.handleTriageGenerate(event); return false;">
              
              <!-- Trade Selection -->
              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  <i class="fas fa-industry mr-1 text-indigo-600"></i>
                  Trade / Industry
                </label>
                <select 
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500" 
                  id="triage-trade-select" 
                  required
                >
                  <option value="">-- Select Trade --</option>
                  <option value="HVAC" ${companyData.trade === 'HVAC' ? 'selected' : ''}>HVAC</option>
                  <option value="Plumbing" ${companyData.trade === 'Plumbing' ? 'selected' : ''}>Plumbing</option>
                  <option value="Electrical" ${companyData.trade === 'Electrical' ? 'selected' : ''}>Electrical</option>
                  <option value="Dental" ${companyData.trade === 'Dental' ? 'selected' : ''}>Dental</option>
                  <option value="Medical" ${companyData.trade === 'Medical' ? 'selected' : ''}>Medical</option>
                  <option value="Veterinary" ${companyData.trade === 'Veterinary' ? 'selected' : ''}>Veterinary</option>
                  <option value="Roofing" ${companyData.trade === 'Roofing' ? 'selected' : ''}>Roofing</option>
                  <option value="Landscaping" ${companyData.trade === 'Landscaping' ? 'selected' : ''}>Landscaping</option>
                  <option value="Pest Control" ${companyData.trade === 'Pest Control' ? 'selected' : ''}>Pest Control</option>
                  <option value="Locksmith" ${companyData.trade === 'Locksmith' ? 'selected' : ''}>Locksmith</option>
                  <option value="Appliance Repair" ${companyData.trade === 'Appliance Repair' ? 'selected' : ''}>Appliance Repair</option>
                  <option value="Auto Repair" ${companyData.trade === 'Auto Repair' ? 'selected' : ''}>Auto Repair</option>
                </select>
              </div>

              <!-- Situation Description -->
              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  <i class="fas fa-file-alt mr-1 text-indigo-600"></i>
                  Triage Situation / Scenario
                  <button 
                    type="button"
                    onclick="cheatSheetManager.openTriageExamplesModal()"
                    class="ml-2 text-blue-600 hover:text-blue-800 transition-colors"
                    title="See example triage scenarios"
                  >
                    <i class="fas fa-info-circle"></i>
                  </button>
                </label>
                <textarea 
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 font-mono text-sm" 
                  id="triage-situation-textarea" 
                  rows="4" 
                  placeholder="Example: Customer wants a cheap maintenance special even though their AC is not cooling."
                  required
                ></textarea>
                <p class="mt-1 text-xs text-gray-500">
                  <i class="fas fa-lightbulb mr-1"></i>
                  Describe the scenario where the AI needs to correctly classify service type and prevent downgrades.
                </p>
              </div>

              <!-- Service Types -->
              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  <i class="fas fa-list-check mr-1 text-indigo-600"></i>
                  Service Types to Include
                </label>
                <div class="grid grid-cols-2 gap-3">
                  <div class="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                    <label class="flex items-center cursor-pointer">
                      <input type="checkbox" class="h-4 w-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500" value="REPAIR" id="triage-service-repair" checked>
                      <span class="ml-2 text-sm">
                        <strong class="text-gray-900">REPAIR</strong>
                        <span class="block text-xs text-gray-600">Something is broken</span>
                      </span>
                    </label>
                  </div>
                  <div class="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                    <label class="flex items-center cursor-pointer">
                      <input type="checkbox" class="h-4 w-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500" value="MAINTENANCE" id="triage-service-maintenance" checked>
                      <span class="ml-2 text-sm">
                        <strong class="text-gray-900">MAINTENANCE</strong>
                        <span class="block text-xs text-gray-600">Routine service, tune-up</span>
                      </span>
                    </label>
                  </div>
                  <div class="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                    <label class="flex items-center cursor-pointer">
                      <input type="checkbox" class="h-4 w-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500" value="EMERGENCY" id="triage-service-emergency" checked>
                      <span class="ml-2 text-sm">
                        <strong class="text-gray-900">EMERGENCY</strong>
                        <span class="block text-xs text-gray-600">Urgent, after-hours</span>
                      </span>
                    </label>
                  </div>
                  <div class="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                    <label class="flex items-center cursor-pointer">
                      <input type="checkbox" class="h-4 w-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500" value="OTHER" id="triage-service-other" checked>
                      <span class="ml-2 text-sm">
                        <strong class="text-gray-900">OTHER</strong>
                        <span class="block text-xs text-gray-600">Quotes, consultations</span>
                      </span>
                    </label>
                  </div>
                </div>
              </div>

              <!-- Generate Button -->
              <div class="flex justify-end">
                <button 
                  type="submit" 
                  id="triage-generate-btn"
                  class="px-6 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg hover:from-purple-700 hover:to-indigo-700 transition-all transform hover:scale-105 shadow-md font-medium flex items-center space-x-2"
                >
                  <i class="fas fa-sparkles"></i>
                  <span>Generate Triage Package</span>
                </button>
              </div>
            </form>
          </div>
          
          <!-- Error Display -->
          <div id="triage-error-container" class="px-6 pb-4 hidden">
            <div class="p-4 bg-red-50 border border-red-200 rounded-lg">
              <div class="flex items-start space-x-3">
                <i class="fas fa-exclamation-triangle text-red-600 text-xl"></i>
                <div class="flex-1">
                  <h4 class="text-sm font-semibold text-red-900 mb-1">Generation Failed</h4>
                  <p id="triage-error-message" class="text-sm text-red-800"></p>
                </div>
              </div>
            </div>
          </div>
          
          <!-- Results Container -->
          <div id="triage-results-container" class="hidden px-6 pb-6 space-y-4">
            
            <!-- Success Banner -->
            <div class="p-4 bg-green-50 border border-green-200 rounded-lg">
              <div class="flex items-center space-x-2">
                <i class="fas fa-circle-check text-green-600"></i>
                <span class="text-sm font-semibold text-green-900">Triage package generated successfully!</span>
                <span class="text-sm text-green-700">Review content below and copy sections as needed.</span>
              </div>
            </div>
            
            <!-- Section 1: Frontline-Intel -->
            <div class="border border-gray-200 rounded-lg overflow-hidden">
              <div class="bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-3 flex items-center justify-between border-b border-gray-200">
                <div class="flex items-center space-x-2">
                  <i class="fas fa-brain text-blue-600"></i>
                  <h4 class="text-sm font-semibold text-gray-900">Frontline-Intel Section</h4>
                  <span id="frontline-stats" class="px-2 py-1 text-xs font-semibold bg-gray-100 text-gray-600 rounded-full"></span>
                </div>
                <button 
                  onclick="cheatSheetManager.copyTriageSection('frontline')" 
                  class="px-3 py-1.5 text-xs font-medium bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors flex items-center space-x-1"
                  data-section="frontline"
                >
                  <i class="fas fa-copy"></i>
                  <span>Copy</span>
                </button>
              </div>
              <div class="p-4 bg-gray-50">
                <pre id="frontline-content" class="bg-white border border-gray-200 rounded p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-words max-h-96 overflow-y-auto"></pre>
              </div>
            </div>
            
            <!-- Section 2: Cheat Sheet Triage Map (Table View) -->
            <div class="border border-gray-200 rounded-lg overflow-hidden">
              <div class="bg-gradient-to-r from-purple-50 to-pink-50 px-4 py-3 flex items-center justify-between border-b border-gray-200">
                <div class="flex items-center space-x-2">
                  <i class="fas fa-table text-purple-600"></i>
                  <h4 class="text-sm font-semibold text-gray-900">Cheat Sheet Triage Map</h4>
                  <span id="cheatsheet-stats" class="px-2 py-1 text-xs font-semibold bg-gray-100 text-gray-600 rounded-full"></span>
                </div>
                <button 
                  onclick="cheatSheetManager.copyTriageSection('cheatsheet')" 
                  class="px-3 py-1.5 text-xs font-medium bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors flex items-center space-x-1"
                  data-section="cheatsheet"
                >
                  <i class="fas fa-copy"></i>
                  <span>Copy</span>
                </button>
              </div>
              <div class="p-4 bg-gray-50">
                <div id="cheatsheet-content" class="overflow-x-auto max-h-96 overflow-y-auto">
                  <!-- Table will be rendered here -->
                </div>
              </div>
            </div>
            
            <!-- Section 3: Response Library -->
            <div class="border border-gray-200 rounded-lg overflow-hidden">
              <div class="bg-gradient-to-r from-green-50 to-teal-50 px-4 py-3 flex items-center justify-between border-b border-gray-200">
                <div class="flex items-center space-x-2">
                  <i class="fas fa-comments text-green-600"></i>
                  <h4 class="text-sm font-semibold text-gray-900">Response Library</h4>
                  <span id="response-stats" class="px-2 py-1 text-xs font-semibold bg-gray-100 text-gray-600 rounded-full"></span>
                </div>
                <button 
                  onclick="cheatSheetManager.copyTriageSection('responses')" 
                  class="px-3 py-1.5 text-xs font-medium bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors flex items-center space-x-1"
                  data-section="responses"
                >
                  <i class="fas fa-copy"></i>
                  <span>Copy All</span>
                </button>
              </div>
              <div id="response-library-container" class="p-4 bg-gray-50 space-y-2"></div>
            </div>
            
          </div>
          
        </div>
        
      </div>
    `;
  }
  
  /**
   * Get company context for auto-populating triage builder
   */
  getCompanyContext() {
    // Try to extract trade from company data
    // This will be populated when we have access to full company object
    return {
      trade: this.companyTrade || 'HVAC' // Default to HVAC
    };
  }
  
  /**
   * Toggle triage builder expand/collapse
   */
  toggleTriageBuilder() {
    const content = document.getElementById('triage-builder-content');
    const icon = document.getElementById('triage-builder-toggle-icon');
    
    if (!content || !icon) return;
    
    if (content.classList.contains('hidden')) {
      content.classList.remove('hidden');
      icon.classList.remove('fa-chevron-down');
      icon.classList.add('fa-chevron-up');
    } else {
      content.classList.add('hidden');
      icon.classList.remove('fa-chevron-up');
      icon.classList.add('fa-chevron-down');
    }
  }
  
  /**
   * Handle triage generation form submit
   */
  async handleTriageGenerate(event) {
    event.preventDefault();
    
    console.log('[TRIAGE BUILDER] Generate button clicked');
    
    // Get form values
    const trade = document.getElementById('triage-trade-select').value;
    const situation = document.getElementById('triage-situation-textarea').value.trim();
    const serviceTypes = this.getSelectedServiceTypes();
    
    // Validation
    if (!trade) {
      this.showTriageError('Please select a trade/industry');
      return;
    }
    
    if (!situation) {
      this.showTriageError('Please describe the triage situation');
      return;
    }
    
    if (serviceTypes.length === 0) {
      this.showTriageError('Please select at least one service type');
      return;
    }
    
    console.log('[TRIAGE BUILDER] Input validation passed', { trade, situation, serviceTypes });
    
    // Hide errors/results
    this.hideTriageError();
    this.hideTriageResults();
    
    // Show loading state
    this.setTriageGenerating(true);
    
    try {
      // Call backend API
      const result = await this.callTriageBuilderAPI(trade, situation, serviceTypes);
      
      console.log('[TRIAGE BUILDER] Generation successful', {
        frontlineLength: result.frontlineIntelSection.length,
        cheatsheetLength: result.cheatSheetTriageMap.length,
        responseCount: result.responseLibrary.length
      });
      
      // Store results
      this.triageResults = result;
      
      // Display results
      this.displayTriageResults(result);
      
    } catch (error) {
      console.error('[TRIAGE BUILDER] Generation failed:', error);
      this.showTriageError(error.message || 'An unexpected error occurred');
    } finally {
      this.setTriageGenerating(false);
    }
  }
  
  /**
   * Get selected service types from checkboxes
   */
  getSelectedServiceTypes() {
    const serviceTypes = [];
    
    if (document.getElementById('triage-service-repair')?.checked) {
      serviceTypes.push('REPAIR');
    }
    if (document.getElementById('triage-service-maintenance')?.checked) {
      serviceTypes.push('MAINTENANCE');
    }
    if (document.getElementById('triage-service-emergency')?.checked) {
      serviceTypes.push('EMERGENCY');
    }
    if (document.getElementById('triage-service-other')?.checked) {
      serviceTypes.push('OTHER');
    }
    
    return serviceTypes;
  }
  
  /**
   * Call backend triage builder API
   */
  async callTriageBuilderAPI(trade, situation, serviceTypes) {
    const token = localStorage.getItem('adminToken');
    
    if (!token) {
      throw new Error('Authentication required. Please log in.');
    }
    
    console.log('[TRIAGE BUILDER] Calling API endpoint...');
    
    const response = await fetch('/api/admin/triage-builder/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        trade,
        situation,
        serviceTypes
      })
    });
    
    console.log('[TRIAGE BUILDER] API response status:', response.status);
    
    if (!response.ok) {
      let errorMsg = `HTTP ${response.status}`;
      
      try {
        const errorData = await response.json();
        errorMsg = errorData.error || errorMsg;
      } catch (e) {
        // Failed to parse error JSON
      }
      
      throw new Error(errorMsg);
    }
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Generation failed');
    }
    
    // Validate response structure
    if (!data.frontlineIntelSection || !data.cheatSheetTriageMap || !data.responseLibrary) {
      throw new Error('Invalid response structure from API');
    }
    
    return {
      frontlineIntelSection: data.frontlineIntelSection,
      cheatSheetTriageMap: data.cheatSheetTriageMap,
      responseLibrary: data.responseLibrary
    };
  }
  
  /**
   * Display triage results in UI
   */
  displayTriageResults(result) {
    console.log('[TRIAGE BUILDER] Displaying results', result);
    
    // Store the full result for later use (saving)
    this.triageResults = result;
    
    // Section 1: Frontline Intel
    document.getElementById('frontline-content').textContent = result.frontlineIntelBlock || result.frontlineIntelSection || '';
    document.getElementById('frontline-stats').textContent = `${(result.frontlineIntelBlock || result.frontlineIntelSection || '').length} chars`;
    
    // Section 2: Cheat Sheet Triage Map - DISPLAY AS TABLE!
    const cheatsheetContainer = document.getElementById('cheatsheet-content');
    if (result.triageMap && Array.isArray(result.triageMap)) {
      // Display structured triageMap as a beautiful table
      cheatsheetContainer.innerHTML = this.renderTriageMapTable(result.triageMap);
      document.getElementById('cheatsheet-stats').textContent = `${result.triageMap.length} rules`;
    } else {
      // Fallback to raw text if triageMap is not structured
      cheatsheetContainer.textContent = result.cheatSheetTriageMap || 'No triage map generated';
      document.getElementById('cheatsheet-stats').textContent = `${(result.cheatSheetTriageMap || '').length} chars`;
    }
    
    // Section 3: Response Library
    const responses = result.responses || result.responseLibrary || [];
    document.getElementById('response-stats').textContent = `${responses.length} responses`;
    const responseContainer = document.getElementById('response-library-container');
    responseContainer.innerHTML = '';
    
    responses.forEach((response, index) => {
      const item = document.createElement('div');
      item.className = 'flex items-start space-x-3 p-3 bg-white border border-gray-200 rounded-lg';
      
      item.innerHTML = `
        <div class="flex-shrink-0 w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">
          ${index + 1}
        </div>
        <div class="flex-1 text-sm text-gray-800 leading-relaxed">${this.escapeHtml(response)}</div>
        <button 
          onclick="cheatSheetManager.copyIndividualResponse(${index})" 
          class="flex-shrink-0 px-2 py-1 text-xs font-medium bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50 transition-colors"
          title="Copy this response"
        >
          <i class="fas fa-copy"></i>
        </button>
      `;
      
      responseContainer.appendChild(item);
    });
    
    // Show results container
    this.showTriageResults();
  }
  
  /**
   * Copy triage section to clipboard
   */
  async copyTriageSection(section) {
    if (!this.triageResults) {
      console.warn('[TRIAGE BUILDER] No results to copy');
      return;
    }
    
    let content = '';
    let buttonSelector = '';
    
    switch (section) {
      case 'frontline':
        content = this.triageResults.frontlineIntelSection;
        buttonSelector = '[data-section="frontline"]';
        break;
      case 'cheatsheet':
        content = this.triageResults.cheatSheetTriageMap;
        buttonSelector = '[data-section="cheatsheet"]';
        break;
      case 'responses':
        content = this.triageResults.responseLibrary.join('\n\n');
        buttonSelector = '[data-section="responses"]';
        break;
      default:
        console.error('[TRIAGE BUILDER] Unknown section:', section);
        return;
    }
    
    await this.copyToClipboard(content, buttonSelector);
  }
  
  /**
   * Copy individual response to clipboard
   */
  async copyIndividualResponse(index) {
    if (!this.triageResults || !this.triageResults.responseLibrary[index]) {
      console.warn('[TRIAGE BUILDER] Invalid response index');
      return;
    }
    
    const content = this.triageResults.responseLibrary[index];
    await this.copyToClipboard(content, null);
  }
  
  /**
   * Copy content to clipboard with visual feedback
   */
  async copyToClipboard(content, buttonSelector) {
    try {
      await navigator.clipboard.writeText(content);
      
      // Visual feedback
      if (buttonSelector) {
        const button = document.querySelector(buttonSelector);
        if (button) {
          const originalHTML = button.innerHTML;
          button.classList.add('bg-green-50', 'border-green-300', 'text-green-700');
          button.innerHTML = '<i class="fas fa-check"></i><span>Copied!</span>';
          
          setTimeout(() => {
            button.classList.remove('bg-green-50', 'border-green-300', 'text-green-700');
            button.innerHTML = originalHTML;
          }, 2000);
        }
      }
      
      this.showNotification('✅ Copied to clipboard!', 'success');
      console.log('[TRIAGE BUILDER] Content copied to clipboard');
    } catch (error) {
      console.error('[TRIAGE BUILDER] Failed to copy:', error);
      this.showNotification('❌ Failed to copy to clipboard', 'error');
    }
  }
  
  /**
   * Set generating state
   */
  setTriageGenerating(isGenerating) {
    const button = document.getElementById('triage-generate-btn');
    if (!button) return;
    
    if (isGenerating) {
      button.disabled = true;
      button.innerHTML = `
        <svg class="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <span>Generating...</span>
      `;
    } else {
      button.disabled = false;
      button.innerHTML = `
        <i class="fas fa-sparkles"></i>
        <span>Generate Triage Package</span>
      `;
    }
  }
  
  /**
   * Show triage error
   */
  showTriageError(message) {
    const container = document.getElementById('triage-error-container');
    const messageEl = document.getElementById('triage-error-message');
    
    if (container && messageEl) {
      messageEl.textContent = message;
      container.classList.remove('hidden');
      
      // Scroll to error
      container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
  
  /**
   * Hide triage error
   */
  hideTriageError() {
    const container = document.getElementById('triage-error-container');
    if (container) {
      container.classList.add('hidden');
    }
  }
  
  /**
   * Show triage results
   */
  showTriageResults() {
    const container = document.getElementById('triage-results-container');
    if (container) {
      container.classList.remove('hidden');
      
      // Scroll to results
      setTimeout(() => {
        container.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }
  
  /**
   * Hide triage results
   */
  hideTriageResults() {
    const container = document.getElementById('triage-results-container');
    if (container) {
      container.classList.add('hidden');
    }
  }
  
  /**
   * Escape HTML for safe display
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  renderBehaviorRules() {
    const container = document.getElementById('behavior-rules-list');
    if (!container) return;
    
    const availableRules = [
      { id: 'ACK_OK', label: 'Acknowledge with "Ok"', description: 'Prepend "Ok" to responses for natural flow' },
      { id: 'USE_COMPANY_NAME', label: 'Use Company Name', description: 'Inject company name in first-turn greeting' },
      { id: 'CONFIRM_ENTITIES', label: 'Confirm Captured Info', description: 'Repeat back collected entities for verification' },
      { id: 'POLITE_PROFESSIONAL', label: 'Polite & Professional', description: 'Expand contractions, use formal tone' },
      { id: 'NEVER_INTERRUPT', label: 'Never Interrupt', description: 'Wait for caller to finish speaking' },
      { id: 'WAIT_FOR_PAUSE', label: 'Wait for Pause', description: 'Brief pause before responding' }
    ];
    
    const selectedRules = this.cheatSheet.behaviorRules || [];
    
    container.innerHTML = availableRules.map(rule => `
      <div class="flex items-start space-x-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
        <input 
          type="checkbox" 
          id="behavior-${rule.id}" 
          ${selectedRules.includes(rule.id) ? 'checked' : ''}
          onchange="cheatSheetManager.toggleBehaviorRule('${rule.id}')"
          class="mt-1 h-5 w-5 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
        >
        <label for="behavior-${rule.id}" class="flex-1 cursor-pointer">
          <div class="text-sm font-medium text-gray-900">${rule.label}</div>
          <div class="text-xs text-gray-500 mt-1">${rule.description}</div>
        </label>
      </div>
    `).join('');
  }
  
  renderEdgeCases() {
    const container = document.getElementById('edge-cases-list');
    if (!container) return;
    
    const edgeCases = this.cheatSheet.edgeCases || [];
    
    if (edgeCases.length === 0) {
      container.innerHTML = `
        <div class="text-center py-12 text-gray-500">
          <i class="fas fa-exclamation-triangle text-4xl mb-3 opacity-50"></i>
          <p class="text-sm">No edge cases defined yet</p>
          <p class="text-xs mt-1">Edge cases handle unusual caller inputs (machine detection, delays, etc.)</p>
        </div>
      `;
      return;
    }
    
    container.innerHTML = edgeCases.map((ec, index) => `
      <div class="border border-gray-200 rounded-lg p-4 hover:border-indigo-300 transition-colors">
        <div class="flex items-start justify-between mb-3">
          <div class="flex-1">
            <input 
              type="text" 
              value="${ec.name || ''}" 
              onchange="cheatSheetManager.updateEdgeCase(${index}, 'name', this.value)"
              placeholder="Edge case name..."
              class="text-sm font-medium text-gray-900 border-0 border-b border-transparent hover:border-gray-300 focus:border-indigo-500 focus:ring-0 w-full"
            >
            <div class="flex items-center space-x-3 mt-2">
              <label class="text-xs text-gray-600">Priority:</label>
              <input 
                type="number" 
                value="${ec.priority || 10}" 
                onchange="cheatSheetManager.updateEdgeCase(${index}, 'priority', parseInt(this.value))"
                class="w-20 px-2 py-1 text-xs border border-gray-300 rounded"
                min="1"
                max="100"
              >
              <label class="flex items-center space-x-2">
                <input 
                  type="checkbox" 
                  ${ec.enabled !== false ? 'checked' : ''}
                  onchange="cheatSheetManager.updateEdgeCase(${index}, 'enabled', this.checked)"
                  class="h-4 w-4 text-indigo-600 border-gray-300 rounded"
                >
                <span class="text-xs text-gray-600">Enabled</span>
              </label>
            </div>
          </div>
          <button onclick="cheatSheetManager.removeEdgeCase(${index})" class="ml-3 text-red-600 hover:text-red-800 transition-colors">
            <i class="fas fa-trash text-sm"></i>
          </button>
        </div>
        
        <div class="space-y-2">
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1">Trigger Patterns (one per line):</label>
            <textarea 
              onchange="cheatSheetManager.updateEdgeCase(${index}, 'triggerPatterns', this.value.split('\\n').filter(Boolean))"
              rows="2"
              class="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono"
              placeholder="machine&#10;robot&#10;ai"
            >${(ec.triggerPatterns || []).join('\n')}</textarea>
          </div>
          
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1">Response Text:</label>
            <textarea 
              onchange="cheatSheetManager.updateEdgeCase(${index}, 'responseText', this.value)"
              rows="2"
              class="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="I'm a real person here to help!"
            >${ec.responseText || ''}</textarea>
          </div>
        </div>
      </div>
    `).join('');
  }
  
  renderTransferRules() {
    const container = document.getElementById('transfer-rules-list');
    if (!container) return;
    
    const transferRules = this.cheatSheet.transferRules || [];
    
    if (transferRules.length === 0) {
      container.innerHTML = `
        <div class="text-center py-10 text-gray-500">
          <i class="fas fa-phone-square text-4xl mb-3 opacity-50"></i>
          <p class="text-sm font-medium">No transfer rules defined yet</p>
          <p class="text-xs mt-1">Transfer rules route calls to specific departments or people based on intent.</p>
        </div>
      `;
      return;
    }
    
    container.innerHTML = transferRules.map((rule, index) => `
      <div class="border border-blue-100 rounded-lg p-4 bg-blue-50/40">
        <div class="flex flex-wrap gap-4 items-center justify-between border-b border-blue-100 pb-3 mb-3">
          <div style="display:flex; gap:12px; flex-wrap:wrap;">
            <label style="font-size:11px; text-transform:uppercase; color:#6b7280; font-weight:600;">
              Priority
              <input type="number" min="1" max="100" value="${rule.priority ?? 10}"
                onchange="cheatSheetManager.updateTransferRule(${index}, 'priority', Number(this.value))"
                style="display:block; margin-top:4px; width:70px; padding:6px 8px; border:1px solid #c7d2fe; border-radius:8px; font-size:14px;">
            </label>
            <label style="font-size:11px; text-transform:uppercase; color:#6b7280; font-weight:600;">
              Intent Tag
              <input type="text" value="${this.escapeHtml(rule.intentTag || '')}"
                onchange="cheatSheetManager.updateTransferRule(${index}, 'intentTag', this.value)"
                placeholder="booking.readyToBook"
                style="display:block; margin-top:4px; min-width:180px; padding:6px 10px; border:1px solid #c7d2fe; border-radius:8px; font-size:14px;">
            </label>
          </div>
          <div style="display:flex; gap:16px; align-items:center;">
            <label style="display:flex; align-items:center; gap:6px; font-size:12px; font-weight:600; color:#1d4ed8;">
              <input type="checkbox" ${rule.enabled !== false ? 'checked' : ''} onchange="cheatSheetManager.updateTransferRule(${index}, 'enabled', this.checked)">
              Enabled
            </label>
            <label style="display:flex; align-items:center; gap:6px; font-size:12px; font-weight:600; color:#7c3aed;">
              <input type="checkbox" ${rule.afterHoursOnly ? 'checked' : ''} onchange="cheatSheetManager.updateTransferRule(${index}, 'afterHoursOnly', this.checked)">
              After-hours only
            </label>
            <button onclick="cheatSheetManager.removeTransferRule(${index})" title="Delete rule"
              style="background:none; border:none; color:#dc2626; font-size:18px;">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>

        <div class="grid" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:16px;">
            <label style="font-size:12px; font-weight:600; color:#374151;">
            Target Contact / Queue
            <input type="text" value="${this.escapeHtml(rule.contactNameOrQueue || '')}"
              onchange="cheatSheetManager.updateTransferRule(${index}, 'contactNameOrQueue', this.value)"
              placeholder="Office Manager Desk / Queue ID"
              style="display:block; margin-top:4px; width:100%; padding:8px 10px; border:1px solid #c7d2fe; border-radius:8px;">
          </label>

          <label style="font-size:12px; font-weight:600; color:#374151;">
            Phone Number / Extension
            <input type="text" value="${this.escapeHtml(rule.phoneNumber || '')}"
              onchange="cheatSheetManager.updateTransferRule(${index}, 'phoneNumber', this.value)"
              placeholder="+1 (222) 555-1212"
              style="display:block; margin-top:4px; width:100%; padding:8px 10px; border:1px solid #c7d2fe; border-radius:8px;">
          </label>

          <label style="font-size:12px; font-weight:600; color:#374151;">
            Entities to Collect (comma separated)
            <input type="text" value="${this.escapeHtml((rule.collectEntities || []).join(', '))}"
              onchange="cheatSheetManager.updateTransferRule(${index}, 'collectEntities', this.value.split(',').map(v => v.trim()).filter(Boolean))"
              placeholder="name, phone, appointmentDate"
              style="display:block; margin-top:4px; width:100%; padding:8px 10px; border:1px solid #c7d2fe; border-radius:8px;">
          </label>
        </div>

        <div style="margin-top:16px;">
          <label style="font-size:12px; font-weight:600; color:#374151; display:block; margin-bottom:6px;">
            Transfer Script (what the AI says before transferring)
          </label>
          <textarea rows="2"
            onchange="cheatSheetManager.updateTransferRule(${index}, 'script', this.value)"
            style="width:100%; padding:10px 12px; border:1px solid #c7d2fe; border-radius:8px; font-size:13px;">${this.escapeHtml(rule.script || '')}</textarea>
        </div>
      </div>
    `).join('');
  }
  
  renderGuardrails() {
    const container = document.getElementById('guardrails-list');
    if (!container) return;
    
    const availableGuardrails = [
      { id: 'NO_PRICES', label: 'Block Prices', description: 'Prevent unauthorized pricing information' },
      { id: 'NO_PHONE_NUMBERS', label: 'Block Phone Numbers', description: 'Block phone numbers unless whitelisted' },
      { id: 'NO_URLS', label: 'Block URLs', description: 'Strip all website links' },
      { id: 'NO_APOLOGIES_SPAM', label: 'Limit Apologies', description: 'Maximum 1 "sorry" per response' },
      { id: 'NO_MEDICAL_ADVICE', label: 'Block Medical Advice', description: 'Prevent medical diagnosis or recommendations' },
      { id: 'NO_LEGAL_ADVICE', label: 'Block Legal Advice', description: 'Prevent legal guidance or interpretation' },
      { id: 'NO_INTERRUPTING', label: 'No Interrupting', description: 'Wait for caller to finish speaking' }
    ];
    
    const selectedGuardrails = this.cheatSheet.guardrails || [];
    
    container.innerHTML = availableGuardrails.map(rule => `
      <div class="flex items-start space-x-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
        <input 
          type="checkbox" 
          id="guardrail-${rule.id}" 
          ${selectedGuardrails.includes(rule.id) ? 'checked' : ''}
          onchange="cheatSheetManager.toggleGuardrail('${rule.id}')"
          class="mt-1 h-5 w-5 text-red-600 border-gray-300 rounded focus:ring-red-500"
        >
        <label for="guardrail-${rule.id}" class="flex-1 cursor-pointer">
          <div class="text-sm font-medium text-gray-900">${rule.label}</div>
          <div class="text-xs text-gray-500 mt-1">${rule.description}</div>
        </label>
      </div>
    `).join('');
  }
  
  renderActionAllowlist() {
    const container = document.getElementById('action-allowlist');
    if (!container) return;
    
    const availableActions = [
      { id: 'BOOK_APPT', label: 'Book Appointment', description: 'Schedule appointments' },
      { id: 'TAKE_MESSAGE', label: 'Take Message', description: 'Record caller messages' },
      { id: 'TRANSFER_BILLING', label: 'Transfer to Billing', description: 'Route to billing department' },
      { id: 'TRANSFER_EMERGENCY', label: 'Transfer to Emergency', description: 'Route to emergency line' },
      { id: 'TRANSFER_GENERAL', label: 'Transfer to General', description: 'Route to main support' },
      { id: 'COLLECT_INFO', label: 'Collect Information', description: 'Gather caller details' },
      { id: 'PROVIDE_HOURS', label: 'Provide Hours', description: 'Share business hours' },
      { id: 'PROVIDE_PRICING', label: 'Provide Pricing', description: 'Share approved pricing' }
    ];
    
    const selectedActions = this.cheatSheet.allowedActions || [];
    
    container.innerHTML = availableActions.map(action => `
      <div class="flex items-start space-x-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
        <input 
          type="checkbox" 
          id="action-${action.id}" 
          ${selectedActions.includes(action.id) ? 'checked' : ''}
          onchange="cheatSheetManager.toggleAction('${action.id}')"
          class="mt-1 h-5 w-5 text-green-600 border-gray-300 rounded focus:ring-green-500"
        >
        <label for="action-${action.id}" class="flex-1 cursor-pointer">
          <div class="text-sm font-medium text-gray-900">${action.label}</div>
          <div class="text-xs text-gray-500 mt-1">${action.description}</div>
        </label>
      </div>
    `).join('');
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // BOOKING RULES RENDERER & HANDLERS
  // ═══════════════════════════════════════════════════════════════════
  
  renderBookingRules() {
    console.log('[CHEAT SHEET] 🎨 renderBookingRules called');
    
    if (!this.cheatSheet) {
      console.warn('[CHEAT SHEET] ⚠️ No cheatSheet loaded yet for Booking Rules');
      return;
    }
    
    // Ensure array exists
    if (!Array.isArray(this.cheatSheet.bookingRules)) {
      this.cheatSheet.bookingRules = [];
    }
    
    // Find the dedicated V2 dynamic content container
    const container = document.getElementById('cheatsheet-v2-dynamic-content');
    
    if (!container) {
      console.warn('[CHEAT SHEET] ⚠️ V2 dynamic content container not found');
      return;
    }
    
    const rules = this.cheatSheet.bookingRules;
    
    container.innerHTML = `
      <div style="padding: 24px; background: #ffffff; border-radius: 12px; margin: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
          <div>
            <h3 style="font-size: 20px; font-weight: 700; color: #111827; margin: 0 0 4px 0;">
              📅 Booking Rules
            </h3>
            <p style="font-size: 13px; color: #6b7280; margin: 0;">
              Define how this company books appointments by trade, service type, and priority.
            </p>
          </div>
          <button
            id="btn-add-booking-rule"
            ${!this.csWorkspaceVersion || (this.csWorkspaceVersion && this.csWorkspaceVersion.readOnly) ? 'disabled' : ''}
            style="display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; font-size: 14px; font-weight: 600; border-radius: 8px; border: none; background: ${!this.csWorkspaceVersion || (this.csWorkspaceVersion && this.csWorkspaceVersion.readOnly) ? '#e5e7eb' : '#4f46e5'}; color: ${!this.csWorkspaceVersion || (this.csWorkspaceVersion && this.csWorkspaceVersion.readOnly) ? '#9ca3af' : '#ffffff'}; cursor: ${!this.csWorkspaceVersion || (this.csWorkspaceVersion && this.csWorkspaceVersion.readOnly) ? 'not-allowed' : 'pointer'}; box-shadow: ${!this.csWorkspaceVersion || (this.csWorkspaceVersion && this.csWorkspaceVersion.readOnly) ? 'none' : '0 2px 4px rgba(79, 70, 229, 0.3)'}; transition: all 0.2s;"
            ${this.csWorkspaceVersion && !this.csWorkspaceVersion.readOnly ? `onmouseover="this.style.background='#4338ca'" onmouseout="this.style.background='#4f46e5'"` : ''}
            title="${!this.csWorkspaceVersion ? '⚠️ Select a version to edit first' : (this.csWorkspaceVersion && this.csWorkspaceVersion.readOnly ? '🔒 READ-ONLY: Cannot edit LIVE version' : 'Add a new booking rule')}"
          >
            <span style="font-size: 16px;">＋</span>
            <span>Add Booking Rule</span>
          </button>
        </div>
        
        <div id="booking-rules-list" style="display: flex; flex-direction: column; gap: 12px;">
          ${rules.length === 0 ? `
            <div style="border: 2px dashed #d1d5db; border-radius: 12px; padding: 32px; background: #f9fafb; text-align: center;">
              <div style="font-size: 48px; margin-bottom: 12px;">📋</div>
              <p style="font-size: 14px; color: #6b7280; margin: 0;">
                No booking rules yet. Click <span style="font-weight: 600; color: #111827;">"Add Booking Rule"</span> to create your first rule.
              </p>
            </div>
          ` : ''}
        </div>
      </div>
    `;
    
    const listEl = container.querySelector('#booking-rules-list');
    if (!listEl) {
      console.warn('[CHEAT SHEET] ⚠️ booking-rules-list not found');
      return;
    }
    
    // Render each rule as a card
    rules.forEach((rule, index) => {
      const card = document.createElement('div');
      card.style.cssText = 'border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; background: #ffffff; box-shadow: 0 1px 3px rgba(0,0,0,0.1);';
      card.setAttribute('data-booking-rule-id', rule.id || `idx-${index}`);
      
      card.innerHTML = `
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;">
          <div style="flex: 1;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
              <span style="font-size: 16px; font-weight: 600; color: #111827;">
                ${rule.label || 'Untitled Booking Rule'}
              </span>
              <span style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; padding: 3px 8px; border-radius: 999px; background: #eff6ff; color: #1e40af; font-weight: 600;">
                ${rule.trade || 'All Trades'} · ${rule.serviceType || 'All Services'}
              </span>
            </div>
            <div style="font-size: 12px; color: #6b7280; line-height: 1.6;">
              <span>Priority: <strong style="color: #111827;">${rule.priority || 'normal'}</strong></span>
              <span style="margin: 0 8px;">•</span>
              <span>Days: <strong style="color: #111827;">${(rule.daysOfWeek || []).join(', ') || 'All'}</strong></span>
              <span style="margin: 0 8px;">•</span>
              <span>Window: <strong style="color: #111827;">
                ${(rule.timeWindow && rule.timeWindow.start) || '--:--'} - ${(rule.timeWindow && rule.timeWindow.end) || '--:--'}
              </strong></span>
            </div>
            ${rule.notes ? `
              <div style="margin-top: 12px; padding: 12px; background: #f9fafb; border-left: 3px solid #4f46e5; border-radius: 4px; font-size: 12px; color: #374151; line-height: 1.5;">
                ${rule.notes}
              </div>
            ` : ''}
          </div>
          <div style="display: flex; gap: 8px;">
            <button
              class="btn-edit-booking-rule"
              ${!this.csWorkspaceVersion || (this.csWorkspaceVersion && this.csWorkspaceVersion.readOnly) ? 'disabled' : ''}
              style="padding: 8px 14px; font-size: 13px; font-weight: 500; border-radius: 6px; border: 1px solid ${!this.csWorkspaceVersion || (this.csWorkspaceVersion && this.csWorkspaceVersion.readOnly) ? '#e5e7eb' : '#d1d5db'}; background: ${!this.csWorkspaceVersion || (this.csWorkspaceVersion && this.csWorkspaceVersion.readOnly) ? '#f9fafb' : '#ffffff'}; color: ${!this.csWorkspaceVersion || (this.csWorkspaceVersion && this.csWorkspaceVersion.readOnly) ? '#9ca3af' : '#374151'}; cursor: ${!this.csWorkspaceVersion || (this.csWorkspaceVersion && this.csWorkspaceVersion.readOnly) ? 'not-allowed' : 'pointer'}; transition: all 0.2s;"
              ${this.csWorkspaceVersion && !this.csWorkspaceVersion.readOnly ? `onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='#ffffff'"` : ''}
              title="${!this.csWorkspaceVersion ? '⚠️ Select a version to edit first' : (this.csWorkspaceVersion && this.csWorkspaceVersion.readOnly ? '🔒 READ-ONLY: Cannot edit LIVE version' : 'Edit this booking rule')}"
            >
              Edit
            </button>
            <button
              class="btn-delete-booking-rule"
              ${!this.csWorkspaceVersion || (this.csWorkspaceVersion && this.csWorkspaceVersion.readOnly) ? 'disabled' : ''}
              style="padding: 8px 14px; font-size: 13px; font-weight: 500; border-radius: 6px; border: 1px solid ${!this.csWorkspaceVersion || (this.csWorkspaceVersion && this.csWorkspaceVersion.readOnly) ? '#e5e7eb' : '#fecaca'}; background: ${!this.csWorkspaceVersion || (this.csWorkspaceVersion && this.csWorkspaceVersion.readOnly) ? '#f9fafb' : '#ffffff'}; color: ${!this.csWorkspaceVersion || (this.csWorkspaceVersion && this.csWorkspaceVersion.readOnly) ? '#9ca3af' : '#dc2626'}; cursor: ${!this.csWorkspaceVersion || (this.csWorkspaceVersion && this.csWorkspaceVersion.readOnly) ? 'not-allowed' : 'pointer'}; transition: all 0.2s;"
              ${this.csWorkspaceVersion && !this.csWorkspaceVersion.readOnly ? `onmouseover="this.style.background='#fef2f2'" onmouseout="this.style.background='#ffffff'"` : ''}
              title="${!this.csWorkspaceVersion ? '⚠️ Select a version to edit first' : (this.csWorkspaceVersion && this.csWorkspaceVersion.readOnly ? '🔒 READ-ONLY: Cannot edit LIVE version' : 'Delete this booking rule')}"
            >
              Delete
            </button>
          </div>
        </div>
      `;
      
      listEl.appendChild(card);
    });
    
    // Hook Add button
    const addBtn = container.querySelector('#btn-add-booking-rule');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        console.log('[CHEAT SHEET] 🔘 Add Booking Rule clicked');
        this.handleAddBookingRule();
      });
    }
    
    // Hook Edit/Delete buttons
    listEl.querySelectorAll('.btn-edit-booking-rule').forEach((btn, index) => {
      btn.addEventListener('click', () => {
        const rule = this.cheatSheet.bookingRules[index];
        if (!rule) return;
        console.log('[CHEAT SHEET] 🔘 Edit Booking Rule clicked:', rule);
        this.handleEditBookingRule(index);
      });
    });
    
    listEl.querySelectorAll('.btn-delete-booking-rule').forEach((btn, index) => {
      btn.addEventListener('click', () => {
        const rule = this.cheatSheet.bookingRules[index];
        if (!rule) return;
        console.log('[CHEAT SHEET] 🔘 Delete Booking Rule clicked:', rule);
        this.handleDeleteBookingRule(index);
      });
    });
    
    console.log('[CHEAT SHEET] ✅ Booking Rules rendered. Count:', this.cheatSheet.bookingRules.length);
  }
  
  handleAddBookingRule() {
    // CRITICAL: Must have workspace selected
    if (!this.csWorkspaceVersion) {
      console.warn('[CHEAT SHEET] ⚠️ Cannot add booking rule - no workspace selected');
      alert('⚠️ Please select a version to edit first from the dropdown above.');
      return;
    }
    
    // CRITICAL: Cannot edit in READ-ONLY mode
    if (this.csWorkspaceVersion && this.csWorkspaceVersion.readOnly) {
      console.warn('[CHEAT SHEET] 🔒 Cannot add booking rule - READ-ONLY mode');
      alert('🔒 This is a LIVE version and cannot be edited.\n\nClick "Create Draft from This" to make changes.');
      return;
    }
    
    if (!this.cheatSheet) return;
    
    if (!Array.isArray(this.cheatSheet.bookingRules)) {
      this.cheatSheet.bookingRules = [];
    }
    
    // Open modal for new rule (pass null for both params)
    this.openBookingRuleModal(null, null);
  }
  
  handleEditBookingRule(index) {
    // CRITICAL: Must have workspace selected
    if (!this.csWorkspaceVersion) {
      console.warn('[CHEAT SHEET] ⚠️ Cannot edit booking rule - no workspace selected');
      alert('⚠️ Please select a version to edit first from the dropdown above.');
      return;
    }
    
    // CRITICAL: Cannot edit in READ-ONLY mode
    if (this.csWorkspaceVersion && this.csWorkspaceVersion.readOnly) {
      console.warn('[CHEAT SHEET] 🔒 Cannot edit booking rule - READ-ONLY mode');
      alert('🔒 This is a LIVE version and cannot be edited.\n\nClick "Create Draft from This" to make changes.');
      return;
    }
    
    if (!this.cheatSheet || !Array.isArray(this.cheatSheet.bookingRules)) return;
    const rule = this.cheatSheet.bookingRules[index];
    if (!rule) return;
    
    this.openBookingRuleModal(rule, index);
  }
  
  /**
   * Open enterprise-grade modal for Add/Edit Booking Rule
   * @param {Object|null} rule - Existing rule to edit, or null for new rule
   * @param {number|null} index - Index of rule being edited, or null for new
   */
  openBookingRuleModal(rule = null, index = null) {
    const isEdit = rule !== null;
    const modalTitle = isEdit ? 'Edit Booking Rule' : 'Add Booking Rule';
    
    // Inject CSS animations if not already present
    if (!document.getElementById('cheatsheet-modal-animations')) {
      const style = document.createElement('style');
      style.id = 'cheatsheet-modal-animations';
      style.textContent = `
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from { transform: translateY(30px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }
    
    // Default values for new rule
    const defaultRule = {
      label: '',
      trade: '',
      serviceType: '',
      priority: 'normal',
      daysOfWeek: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
      timeWindow: { start: '08:00', end: '17:00' },
      sameDayAllowed: true,
      weekendAllowed: false,
      notes: ''
    };
    
    const data = isEdit ? rule : defaultRule;
    
    // Create modal overlay
    const modal = document.createElement('div');
    modal.id = 'booking-rule-modal';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      animation: fadeIn 0.2s ease-out;
    `;
    
    modal.innerHTML = `
      <div style="
        background: #ffffff;
        border-radius: 16px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        width: 90%;
        max-width: 700px;
        max-height: 90vh;
        overflow-y: auto;
        animation: slideUp 0.3s ease-out;
      ">
        <!-- Header -->
        <div style="
          padding: 24px;
          border-bottom: 2px solid #e5e7eb;
          display: flex;
          align-items: center;
          justify-content: space-between;
        ">
          <h2 style="
            font-size: 24px;
            font-weight: 700;
            color: #111827;
            margin: 0;
          ">
            📋 ${modalTitle}
          </h2>
          <button
            onclick="document.getElementById('booking-rule-modal').remove()"
            style="
              background: none;
              border: none;
              font-size: 28px;
              color: #9ca3af;
              cursor: pointer;
              padding: 0;
              width: 32px;
              height: 32px;
              display: flex;
              align-items: center;
              justify-content: center;
              border-radius: 4px;
              transition: all 0.2s;
            "
            onmouseover="this.style.background='#f3f4f6'; this.style.color='#111827';"
            onmouseout="this.style.background='none'; this.style.color='#9ca3af';"
          >
            ×
          </button>
        </div>
        
        <!-- Form -->
        <form id="booking-rule-form" style="padding: 24px;">
          
          <!-- Label -->
          <div style="margin-bottom: 20px;">
            <label style="display: block; font-size: 14px; font-weight: 600; color: #374151; margin-bottom: 6px;">
              Rule Name / Label <span style="color: #ef4444;">*</span>
            </label>
            <input
              type="text"
              name="label"
              value="${this.escapeHtml(data.label)}"
              required
              placeholder="e.g., HVAC Emergency Repair"
              style="
                width: 100%;
                padding: 10px 12px;
                font-size: 14px;
                border: 2px solid #d1d5db;
                border-radius: 8px;
                transition: all 0.2s;
                box-sizing: border-box;
              "
              onfocus="this.style.borderColor='#4f46e5'; this.style.outline='none';"
              onblur="this.style.borderColor='#d1d5db';"
            />
          </div>
          
          <!-- Trade and Service Type (side by side) -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px;">
            <div>
              <label style="display: block; font-size: 14px; font-weight: 600; color: #374151; margin-bottom: 6px;">
                Trade
              </label>
              <input
                type="text"
                name="trade"
                value="${this.escapeHtml(data.trade)}"
                placeholder="e.g., HVAC, Plumbing"
                style="
                  width: 100%;
                  padding: 10px 12px;
                  font-size: 14px;
                  border: 2px solid #d1d5db;
                  border-radius: 8px;
                  transition: all 0.2s;
                  box-sizing: border-box;
                "
                onfocus="this.style.borderColor='#4f46e5'; this.style.outline='none';"
                onblur="this.style.borderColor='#d1d5db';"
              />
            </div>
            <div>
              <label style="display: block; font-size: 14px; font-weight: 600; color: #374151; margin-bottom: 6px;">
                Service Type
              </label>
              <input
                type="text"
                name="serviceType"
                value="${this.escapeHtml(data.serviceType)}"
                placeholder="e.g., Repair, Maintenance"
                style="
                  width: 100%;
                  padding: 10px 12px;
                  font-size: 14px;
                  border: 2px solid #d1d5db;
                  border-radius: 8px;
                  transition: all 0.2s;
                  box-sizing: border-box;
                "
                onfocus="this.style.borderColor='#4f46e5'; this.style.outline='none';"
                onblur="this.style.borderColor='#d1d5db';"
              />
            </div>
          </div>
          
          <!-- Priority -->
          <div style="margin-bottom: 20px;">
            <label style="display: block; font-size: 14px; font-weight: 600; color: #374151; margin-bottom: 6px;">
              Priority
            </label>
            <select
              name="priority"
              style="
                width: 100%;
                padding: 10px 12px;
                font-size: 14px;
                border: 2px solid #d1d5db;
                border-radius: 8px;
                transition: all 0.2s;
                box-sizing: border-box;
                background: #ffffff;
              "
              onfocus="this.style.borderColor='#4f46e5'; this.style.outline='none';"
              onblur="this.style.borderColor='#d1d5db';"
            >
              <option value="normal" ${data.priority === 'normal' ? 'selected' : ''}>Normal</option>
              <option value="high" ${data.priority === 'high' ? 'selected' : ''}>High</option>
              <option value="emergency" ${data.priority === 'emergency' ? 'selected' : ''}>Emergency</option>
            </select>
          </div>
          
          <!-- Days of Week -->
          <div style="margin-bottom: 20px;">
            <label style="display: block; font-size: 14px; font-weight: 600; color: #374151; margin-bottom: 8px;">
              Days of Week
            </label>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => `
                <label style="
                  display: flex;
                  align-items: center;
                  gap: 6px;
                  padding: 8px 12px;
                  border: 2px solid ${(data.daysOfWeek || []).includes(day) ? '#4f46e5' : '#d1d5db'};
                  border-radius: 8px;
                  font-size: 13px;
                  font-weight: 500;
                  cursor: pointer;
                  transition: all 0.2s;
                  background: ${(data.daysOfWeek || []).includes(day) ? '#eef2ff' : '#ffffff'};
                  color: ${(data.daysOfWeek || []).includes(day) ? '#4f46e5' : '#6b7280'};
                ">
                  <input
                    type="checkbox"
                    name="daysOfWeek"
                    value="${day}"
                    ${(data.daysOfWeek || []).includes(day) ? 'checked' : ''}
                    style="width: 16px; height: 16px; cursor: pointer;"
                  />
                  ${day}
                </label>
              `).join('')}
            </div>
          </div>
          
          <!-- Time Window -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px;">
            <div>
              <label style="display: block; font-size: 14px; font-weight: 600; color: #374151; margin-bottom: 6px;">
                Start Time
              </label>
              <input
                type="time"
                name="timeStart"
                value="${data.timeWindow?.start || '08:00'}"
                style="
                  width: 100%;
                  padding: 10px 12px;
                  font-size: 14px;
                  border: 2px solid #d1d5db;
                  border-radius: 8px;
                  transition: all 0.2s;
                  box-sizing: border-box;
                "
                onfocus="this.style.borderColor='#4f46e5'; this.style.outline='none';"
                onblur="this.style.borderColor='#d1d5db';"
              />
            </div>
            <div>
              <label style="display: block; font-size: 14px; font-weight: 600; color: #374151; margin-bottom: 6px;">
                End Time
              </label>
              <input
                type="time"
                name="timeEnd"
                value="${data.timeWindow?.end || '17:00'}"
                style="
                  width: 100%;
                  padding: 10px 12px;
                  font-size: 14px;
                  border: 2px solid #d1d5db;
                  border-radius: 8px;
                  transition: all 0.2s;
                  box-sizing: border-box;
                "
                onfocus="this.style.borderColor='#4f46e5'; this.style.outline='none';"
                onblur="this.style.borderColor='#d1d5db';"
              />
            </div>
          </div>
          
          <!-- Toggles -->
          <div style="margin-bottom: 20px; display: flex; flex-direction: column; gap: 12px;">
            <label style="
              display: flex;
              align-items: center;
              gap: 10px;
              padding: 12px;
              border: 2px solid #d1d5db;
              border-radius: 8px;
              cursor: pointer;
              transition: all 0.2s;
            ">
              <input
                type="checkbox"
                name="sameDayAllowed"
                ${data.sameDayAllowed !== false ? 'checked' : ''}
                style="width: 18px; height: 18px; cursor: pointer;"
              />
              <span style="font-size: 14px; font-weight: 500; color: #374151;">
                Allow same-day booking
              </span>
            </label>
            
            <label style="
              display: flex;
              align-items: center;
              gap: 10px;
              padding: 12px;
              border: 2px solid #d1d5db;
              border-radius: 8px;
              cursor: pointer;
              transition: all 0.2s;
            ">
              <input
                type="checkbox"
                name="weekendAllowed"
                ${data.weekendAllowed ? 'checked' : ''}
                style="width: 18px; height: 18px; cursor: pointer;"
              />
              <span style="font-size: 14px; font-weight: 500; color: #374151;">
                Allow weekend booking
              </span>
            </label>
          </div>
          
          <!-- Notes -->
          <div style="margin-bottom: 24px;">
            <label style="display: block; font-size: 14px; font-weight: 600; color: #374151; margin-bottom: 6px;">
              Notes / Instructions
            </label>
            <textarea
              name="notes"
              placeholder="Add any special instructions or notes for this booking rule..."
              rows="3"
              style="
                width: 100%;
                padding: 10px 12px;
                font-size: 14px;
                border: 2px solid #d1d5db;
                border-radius: 8px;
                transition: all 0.2s;
                box-sizing: border-box;
                font-family: inherit;
                resize: vertical;
              "
              onfocus="this.style.borderColor='#4f46e5'; this.style.outline='none';"
              onblur="this.style.borderColor='#d1d5db';"
            >${this.escapeHtml(data.notes || '')}</textarea>
          </div>
          
          <!-- Footer Buttons -->
          <div style="display: flex; gap: 12px; justify-content: flex-end; padding-top: 20px; border-top: 2px solid #e5e7eb;">
            <button
              type="button"
              onclick="document.getElementById('booking-rule-modal').remove()"
              style="
                padding: 10px 20px;
                font-size: 14px;
                font-weight: 600;
                border-radius: 8px;
                border: 2px solid #d1d5db;
                background: #ffffff;
                color: #6b7280;
                cursor: pointer;
                transition: all 0.2s;
              "
              onmouseover="this.style.background='#f3f4f6'; this.style.borderColor='#9ca3af';"
              onmouseout="this.style.background='#ffffff'; this.style.borderColor='#d1d5db';"
            >
              Cancel
            </button>
            <button
              type="submit"
              style="
                padding: 10px 24px;
                font-size: 14px;
                font-weight: 600;
                border-radius: 8px;
                border: none;
                background: #4f46e5;
                color: #ffffff;
                cursor: pointer;
                transition: all 0.2s;
                box-shadow: 0 2px 8px rgba(79, 70, 229, 0.3);
              "
              onmouseover="this.style.background='#4338ca';"
              onmouseout="this.style.background='#4f46e5';"
            >
              ${isEdit ? 'Update Rule' : 'Create Rule'}
            </button>
          </div>
        </form>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // Handle form submission
    const form = document.getElementById('booking-rule-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      
      const formData = new FormData(form);
      
      // Collect days of week checkboxes
      const daysOfWeek = [];
      form.querySelectorAll('input[name="daysOfWeek"]:checked').forEach(cb => {
        daysOfWeek.push(cb.value);
      });
      
      const ruleData = {
        id: isEdit ? rule.id : `br-${Date.now()}`,
        label: formData.get('label'),
        trade: formData.get('trade'),
        serviceType: formData.get('serviceType'),
        priority: formData.get('priority'),
        daysOfWeek: daysOfWeek,
        timeWindow: {
          start: formData.get('timeStart'),
          end: formData.get('timeEnd')
        },
        sameDayAllowed: formData.get('sameDayAllowed') === 'on',
        weekendAllowed: formData.get('weekendAllowed') === 'on',
        notes: formData.get('notes')
      };
      
      if (isEdit) {
        // Update existing rule
        Object.assign(this.cheatSheet.bookingRules[index], ruleData);
        console.log('[CHEAT SHEET] ✅ Booking rule updated:', ruleData);
      } else {
        // Add new rule
        this.cheatSheet.bookingRules.push(ruleData);
        console.log('[CHEAT SHEET] ✅ New booking rule added:', ruleData);
      }
      
      // Close modal
      modal.remove();
      
      // Re-render and mark dirty
      this.renderBookingRules();
      this.markDirty();
    });
    
    // Close on background click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });
  }
  
  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  handleDeleteBookingRule(index) {
    // CRITICAL: Must have workspace selected
    if (!this.csWorkspaceVersion) {
      console.warn('[CHEAT SHEET] ⚠️ Cannot delete booking rule - no workspace selected');
      alert('⚠️ Please select a version to edit first from the dropdown above.');
      return;
    }
    
    // CRITICAL: Cannot delete in READ-ONLY mode
    if (this.csWorkspaceVersion && this.csWorkspaceVersion.readOnly) {
      console.warn('[CHEAT SHEET] 🔒 Cannot delete booking rule - READ-ONLY mode');
      alert('🔒 This is a LIVE version and cannot be edited.\n\nClick "Create Draft from This" to make changes.');
      return;
    }
    
    if (!this.cheatSheet || !Array.isArray(this.cheatSheet.bookingRules)) return;
    const rule = this.cheatSheet.bookingRules[index];
    if (!rule) return;
    
    if (!window.confirm(`Delete booking rule "${rule.label}"?`)) return;
    
    this.cheatSheet.bookingRules.splice(index, 1);
    
    console.log('[CHEAT SHEET] 🗑️ Booking rule deleted (local only)', rule);
    
    this.renderBookingRules();
    
    if (typeof this.markDirty === 'function') {
      this.markDirty();
    }
    this.markDirty(); // Update UI (respects Version Console)
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // COMPANY CONTACTS RENDERER & HANDLERS
  // ═══════════════════════════════════════════════════════════════════
  
  renderCompanyContacts() {
    console.log('[CHEAT SHEET] 🎨 renderCompanyContacts called');
    
    if (!this.cheatSheet) {
      console.warn('[CHEAT SHEET] ⚠️ No cheatSheet loaded yet for Company Contacts');
      return;
    }
    
    if (!Array.isArray(this.cheatSheet.companyContacts)) {
      this.cheatSheet.companyContacts = [];
    }
    
    const container = document.getElementById('cheatsheet-v2-dynamic-content');
    
    if (!container) {
      console.warn('[CHEAT SHEET] ⚠️ V2 dynamic content container not found');
      return;
    }
    
    const contacts = this.cheatSheet.companyContacts;
    
    container.innerHTML = `
      <div style="padding: 24px; background: #ffffff; border-radius: 12px; margin: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
          <div>
            <h3 style="font-size: 20px; font-weight: 700; color: #111827; margin: 0 0 4px 0;">
              📞 Company Contacts
            </h3>
            <p style="font-size: 13px; color: #6b7280; margin: 0;">
              Define who the AI can transfer to, notify, or escalate to during calls.
            </p>
          </div>
          <button
            id="btn-add-company-contact"
            style="display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; font-size: 14px; font-weight: 600; border-radius: 8px; border: none; background: #4f46e5; color: #ffffff; cursor: pointer; box-shadow: 0 2px 4px rgba(79, 70, 229, 0.3); transition: all 0.2s;"
            onmouseover="this.style.background='#4338ca'"
            onmouseout="this.style.background='#4f46e5'"
          >
            <span style="font-size: 16px;">＋</span>
            <span>Add Contact</span>
          </button>
        </div>
        
        <div id="company-contacts-list" style="display: flex; flex-direction: column; gap: 12px;">
          ${contacts.length === 0 ? `
            <div style="border: 2px dashed #d1d5db; border-radius: 12px; padding: 32px; background: #f9fafb; text-align: center;">
              <div style="font-size: 48px; margin-bottom: 12px;">👥</div>
              <p style="font-size: 14px; color: #6b7280; margin: 0;">
                No contacts configured yet. Click <span style="font-weight: 600; color: #111827;">"Add Contact"</span> to create your first contact. These entries will be used by transfer rules and after-hours routing.
              </p>
            </div>
          ` : ''}
        </div>
      </div>
    `;
    
    const listEl = container.querySelector('#company-contacts-list');
    if (!listEl) {
      console.warn('[CHEAT SHEET] ⚠️ company-contacts-list not found');
      return;
    }
    
    contacts.forEach((contact, index) => {
      const card = document.createElement('div');
      card.style.cssText = 'border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; background: #ffffff; box-shadow: 0 1px 3px rgba(0,0,0,0.1);';
      card.setAttribute('data-company-contact-id', contact.id || `idx-${index}`);
      
      const badges = [];
      
      if (contact.role) {
        badges.push(
          `<span style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; padding: 3px 8px; border-radius: 999px; background: #f3f4f6; color: #374151; font-weight: 600;">
            ${contact.role}
          </span>`
        );
      }
      
      if (contact.isPrimary) {
        badges.push(
          `<span style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; padding: 3px 8px; border-radius: 999px; background: #10b981; color: #ffffff; font-weight: 600;">
            Primary
          </span>`
        );
      }
      
      card.innerHTML = `
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;">
          <div style="flex: 1;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap;">
              <span style="font-size: 16px; font-weight: 600; color: #111827;">
                ${contact.name || 'Unnamed Contact'}
              </span>
              ${badges.join('')}
            </div>
            <div style="font-size: 12px; color: #6b7280; line-height: 1.6;">
              ${contact.phone ? `Phone: <strong style="color: #111827;">${contact.phone}</strong>` : ''}
              ${contact.email ? ` · Email: <strong style="color: #111827;">${contact.email}</strong>` : ''}
              ${contact.availableHours ? ` · Hours: <strong style="color: #111827;">${contact.availableHours}</strong>` : ''}
            </div>
            ${contact.notes ? `
              <div style="margin-top: 12px; padding: 12px; background: #f9fafb; border-left: 3px solid #4f46e5; border-radius: 4px; font-size: 12px; color: #374151; line-height: 1.5;">
                ${contact.notes}
              </div>
            ` : ''}
          </div>
          <div style="display: flex; gap: 8px;">
            <button
              class="btn-edit-company-contact"
              style="padding: 8px 14px; font-size: 13px; font-weight: 500; border-radius: 6px; border: 1px solid #d1d5db; background: #ffffff; color: #374151; cursor: pointer; transition: all 0.2s;"
              onmouseover="this.style.background='#f3f4f6'"
              onmouseout="this.style.background='#ffffff'"
            >
              Edit
            </button>
            <button
              class="btn-delete-company-contact"
              style="padding: 8px 14px; font-size: 13px; font-weight: 500; border-radius: 6px; border: 1px solid #fecaca; background: #ffffff; color: #dc2626; cursor: pointer; transition: all 0.2s;"
              onmouseover="this.style.background='#fef2f2'"
              onmouseout="this.style.background='#ffffff'"
            >
              Delete
            </button>
          </div>
        </div>
      `;
      
      listEl.appendChild(card);
    });
    
    const addBtn = container.querySelector('#btn-add-company-contact');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        console.log('[CHEAT SHEET] 🔘 Add Company Contact clicked');
        this.handleAddCompanyContact();
      });
    }
    
    listEl.querySelectorAll('.btn-edit-company-contact').forEach((btn, index) => {
      btn.addEventListener('click', () => {
        const contact = this.cheatSheet.companyContacts[index];
        if (!contact) return;
        console.log('[CHEAT SHEET] 🔘 Edit Company Contact clicked:', contact);
        this.handleEditCompanyContact(index);
      });
    });
    
    listEl.querySelectorAll('.btn-delete-company-contact').forEach((btn, index) => {
      btn.addEventListener('click', () => {
        const contact = this.cheatSheet.companyContacts[index];
        if (!contact) return;
        console.log('[CHEAT SHEET] 🔘 Delete Company Contact clicked:', contact);
        this.handleDeleteCompanyContact(index);
      });
    });
    
    console.log('[CHEAT SHEET] ✅ Company Contacts rendered. Count:', this.cheatSheet.companyContacts.length);
  }
  
  handleAddCompanyContact() {
    if (!this.cheatSheet) return;
    
    if (!Array.isArray(this.cheatSheet.companyContacts)) {
      this.cheatSheet.companyContacts = [];
    }
    
    // Open modal for new contact
    this.showCompanyContactModal();
  }
  
  handleEditCompanyContact(index) {
    if (!this.cheatSheet || !Array.isArray(this.cheatSheet.companyContacts)) return;
    const contact = this.cheatSheet.companyContacts[index];
    if (!contact) return;
    
    // Open modal for existing contact
    this.showCompanyContactModal(index);
  }
  
  /**
   * Show Company Contact Modal (Enterprise Form)
   * @param {number|null} contactIndex - Index of contact being edited, or null for new
   */
  showCompanyContactModal(contactIndex = null) {
    const isEdit = contactIndex !== null;
    const contact = isEdit ? this.cheatSheet.companyContacts[contactIndex] : null;
    
    // Create modal HTML
    const modalHTML = `
      <div id="company-contact-modal" style="
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.75);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        animation: fadeIn 0.2s ease-out;
      ">
        <div style="
          background: #ffffff;
          border-radius: 12px;
          width: 90%;
          max-width: 600px;
          max-height: 90vh;
          overflow-y: auto;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          animation: slideUp 0.3s ease-out;
        ">
          <!-- Header -->
          <div style="
            padding: 24px 24px 16px;
            border-bottom: 1px solid #e5e7eb;
            position: sticky;
            top: 0;
            background: #ffffff;
            z-index: 1;
          ">
            <h2 style="margin: 0; font-size: 20px; font-weight: 600; color: #111827;">
              ${isEdit ? '✏️ Edit Company Contact' : '➕ Add Company Contact'}
            </h2>
          </div>
          
          <!-- Form Body -->
          <div style="padding: 24px;">
            <form id="company-contact-form" style="display: flex; flex-direction: column; gap: 20px;">
              
              <!-- Name -->
              <div>
                <label style="display: block; font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px;">
                  Contact Name *
                </label>
                <input 
                  type="text" 
                  id="cc-name" 
                  value="${contact?.name || ''}" 
                  placeholder="e.g., John Smith"
                  required
                  style="
                    width: 100%;
                    padding: 10px 12px;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    font-size: 14px;
                    font-family: inherit;
                  "
                />
              </div>
              
              <!-- Role -->
              <div>
                <label style="display: block; font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px;">
                  Role/Title *
                </label>
                <select 
                  id="cc-role"
                  required
                  style="
                    width: 100%;
                    padding: 10px 12px;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    font-size: 14px;
                    font-family: inherit;
                    background: #ffffff;
                  "
                >
                  <option value="owner" ${contact?.role === 'owner' ? 'selected' : ''}>Owner</option>
                  <option value="manager" ${contact?.role === 'manager' ? 'selected' : ''}>Manager</option>
                  <option value="dispatcher" ${contact?.role === 'dispatcher' ? 'selected' : ''}>Dispatcher</option>
                  <option value="tech" ${contact?.role === 'tech' ? 'selected' : ''}>Technician</option>
                  <option value="front-desk" ${contact?.role === 'front-desk' ? 'selected' : ''}>Front Desk</option>
                  <option value="billing" ${contact?.role === 'billing' ? 'selected' : ''}>Billing</option>
                  <option value="other" ${contact?.role === 'other' ? 'selected' : ''}>Other</option>
                </select>
              </div>
              
              <!-- Phone & Email (2-column) -->
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                <div>
                  <label style="display: block; font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px;">
                    Phone Number
                  </label>
                  <input 
                    type="tel" 
                    id="cc-phone" 
                    value="${contact?.phone || ''}" 
                    placeholder="(555) 123-4567"
                    style="
                      width: 100%;
                      padding: 10px 12px;
                      border: 1px solid #d1d5db;
                      border-radius: 6px;
                      font-size: 14px;
                      font-family: inherit;
                    "
                  />
                </div>
                
                <div>
                  <label style="display: block; font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px;">
                    Email Address
                  </label>
                  <input 
                    type="email" 
                    id="cc-email" 
                    value="${contact?.email || ''}" 
                    placeholder="name@company.com"
                    style="
                      width: 100%;
                      padding: 10px 12px;
                      border: 1px solid #d1d5db;
                      border-radius: 6px;
                      font-size: 14px;
                      font-family: inherit;
                    "
                  />
                </div>
              </div>
              
              <!-- Available Hours -->
              <div>
                <label style="display: block; font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px;">
                  Available Hours
                </label>
                <input 
                  type="text" 
                  id="cc-available-hours" 
                  value="${contact?.availableHours || '24/7'}" 
                  placeholder="e.g., Mon-Fri 9-5, 24/7, After 6pm"
                  style="
                    width: 100%;
                    padding: 10px 12px;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    font-size: 14px;
                    font-family: inherit;
                  "
                />
              </div>
              
              <!-- Primary Contact Toggle -->
              <div style="
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 12px;
                background: #f9fafb;
                border-radius: 6px;
              ">
                <input 
                  type="checkbox" 
                  id="cc-is-primary" 
                  ${contact?.isPrimary ? 'checked' : ''}
                  style="
                    width: 18px;
                    height: 18px;
                    cursor: pointer;
                  "
                />
                <label for="cc-is-primary" style="
                  font-size: 14px;
                  font-weight: 500;
                  color: #374151;
                  cursor: pointer;
                  user-select: none;
                ">
                  ⭐ Primary Contact
                </label>
              </div>
              
              <!-- Notes -->
              <div>
                <label style="display: block; font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px;">
                  Notes / Routing Instructions
                </label>
                <textarea 
                  id="cc-notes" 
                  rows="3"
                  placeholder="Optional: Add internal notes, routing instructions, or special handling..."
                  style="
                    width: 100%;
                    padding: 10px 12px;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    font-size: 14px;
                    font-family: inherit;
                    resize: vertical;
                  "
                >${contact?.notes || ''}</textarea>
              </div>
              
            </form>
          </div>
          
          <!-- Footer Actions -->
          <div style="
            padding: 16px 24px;
            border-top: 1px solid #e5e7eb;
            display: flex;
            gap: 12px;
            justify-content: flex-end;
            position: sticky;
            bottom: 0;
            background: #ffffff;
          ">
            <button 
              type="button" 
              id="cc-modal-cancel"
              style="
                padding: 10px 20px;
                border: 1px solid #d1d5db;
                border-radius: 6px;
                background: #ffffff;
                color: #374151;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s;
              "
              onmouseover="this.style.background='#f9fafb'"
              onmouseout="this.style.background='#ffffff'"
            >
              Cancel
            </button>
            <button 
              type="button" 
              id="cc-modal-save"
              style="
                padding: 10px 20px;
                border: none;
                border-radius: 6px;
                background: #3b82f6;
                color: #ffffff;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s;
              "
              onmouseover="this.style.background='#2563eb'"
              onmouseout="this.style.background='#3b82f6'"
            >
              💾 Save Contact
            </button>
          </div>
        </div>
      </div>
    `;
    
    // Inject modal into DOM
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Wire up events
    document.getElementById('cc-modal-cancel').addEventListener('click', () => {
      document.getElementById('company-contact-modal').remove();
    });
    
    document.getElementById('cc-modal-save').addEventListener('click', () => {
      this.saveCompanyContactForm(contactIndex);
    });
    
    // Focus first field
    setTimeout(() => {
      document.getElementById('cc-name')?.focus();
    }, 100);
  }
  
  /**
   * Save Company Contact Form Data
   */
  saveCompanyContactForm(contactIndex = null) {
    const isEdit = contactIndex !== null;
    
    // Collect form data
    const name = document.getElementById('cc-name').value.trim();
    const role = document.getElementById('cc-role').value;
    const phone = document.getElementById('cc-phone').value.trim();
    const email = document.getElementById('cc-email').value.trim();
    const availableHours = document.getElementById('cc-available-hours').value.trim();
    const isPrimary = document.getElementById('cc-is-primary').checked;
    const notes = document.getElementById('cc-notes').value.trim();
    
    // Validate required fields
    if (!name) {
      alert('⚠️ Contact name is required');
      document.getElementById('cc-name').focus();
      return;
    }
    
    // Build contact object
    const contactData = {
      id: isEdit ? this.cheatSheet.companyContacts[contactIndex].id : `cc-${Date.now()}`,
      name,
      role,
      phone,
      email,
      availableHours: availableHours || '24/7',
      isPrimary,
      notes
    };
    
    // Update or add contact
    if (isEdit) {
      this.cheatSheet.companyContacts[contactIndex] = contactData;
      console.log('[CHEAT SHEET] ✅ Company contact updated:', contactData);
    } else {
      this.cheatSheet.companyContacts.push(contactData);
      console.log('[CHEAT SHEET] ✅ Company contact added:', contactData);
    }
    
    // Close modal
    document.getElementById('company-contact-modal').remove();
    
    // Re-render and mark dirty
    this.renderCompanyContacts();
    this.markDirty();
  }
  
  handleDeleteCompanyContact(index) {
    if (!this.cheatSheet || !Array.isArray(this.cheatSheet.companyContacts)) return;
    const contact = this.cheatSheet.companyContacts[index];
    if (!contact) return;
    
    if (!window.confirm(`Delete contact "${contact.label}"?`)) return;
    
    this.cheatSheet.companyContacts.splice(index, 1);
    
    console.log('[CHEAT SHEET] 🗑️ Company contact deleted (local only)', contact);
    
    this.renderCompanyContacts();
    
    if (typeof this.markDirty === 'function') {
      this.markDirty();
    }
    this.markDirty(); // Update UI (respects Version Console)
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // LINKS RENDERER & HANDLERS
  // ═══════════════════════════════════════════════════════════════════
  
  renderLinks() {
    console.log('[CHEAT SHEET] 🎨 renderLinks called');
    
    if (!this.cheatSheet) {
      console.warn('[CHEAT SHEET] ⚠️ No cheatSheet loaded yet for Links');
      return;
    }
    
    if (!Array.isArray(this.cheatSheet.links)) {
      this.cheatSheet.links = [];
    }
    
    const container = document.getElementById('cheatsheet-v2-dynamic-content');
    
    if (!container) {
      console.warn('[CHEAT SHEET] ⚠️ V2 dynamic content container not found');
      return;
    }
    
    const links = this.cheatSheet.links;
    
    container.innerHTML = `
      <div style="padding: 24px; background: #ffffff; border-radius: 12px; margin: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
          <div>
            <h3 style="font-size: 20px; font-weight: 700; color: #111827; margin: 0 0 4px 0;">
              🔗 Links
            </h3>
            <p style="font-size: 13px; color: #6b7280; margin: 0;">
              Financing, portals, policies, catalogs the AI can reference.
            </p>
          </div>
          <button
            id="btn-add-link"
            style="display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; font-size: 14px; font-weight: 600; border-radius: 8px; border: none; background: #4f46e5; color: #ffffff; cursor: pointer; box-shadow: 0 2px 4px rgba(79, 70, 229, 0.3); transition: all 0.2s;"
            onmouseover="this.style.background='#4338ca'"
            onmouseout="this.style.background='#4f46e5'"
          >
            <span style="font-size: 16px;">＋</span>
            <span>Add Link</span>
          </button>
        </div>
        
        <div id="links-list" style="display: flex; flex-direction: column; gap: 12px;">
          ${links.length === 0 ? `
            <div style="border: 2px dashed #d1d5db; border-radius: 12px; padding: 32px; background: #f9fafb; text-align: center;">
              <div style="font-size: 48px; margin-bottom: 12px;">🌐</div>
              <p style="font-size: 14px; color: #6b7280; margin: 0;">
                No links configured yet. Click <span style="font-weight: 600; color: #111827;">"Add Link"</span> to create your first link. These URLs can be referenced by the AI during calls.
              </p>
            </div>
          ` : ''}
        </div>
      </div>
    `;
    
    const listEl = container.querySelector('#links-list');
    if (!listEl) {
      console.warn('[CHEAT SHEET] ⚠️ links-list not found');
      return;
    }
    
    links.forEach((link, index) => {
      const card = document.createElement('div');
      card.style.cssText = 'border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; background: #ffffff; box-shadow: 0 1px 3px rgba(0,0,0,0.1);';
      card.setAttribute('data-link-id', link.id || `idx-${index}`);
      
      const categoryColors = {
        'financing': '#10b981',
        'portal': '#3b82f6',
        'policy': '#8b5cf6',
        'catalog': '#f59e0b',
        'other': '#6b7280'
      };
      const categoryColor = categoryColors[link.category] || categoryColors['other'];
      
      card.innerHTML = `
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;">
          <div style="flex: 1;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
              <span style="font-size: 16px; font-weight: 600; color: #111827;">
                ${link.label || 'Unnamed Link'}
              </span>
              ${link.category ? `
                <span style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; padding: 3px 8px; border-radius: 999px; background: ${categoryColor}; color: #ffffff; font-weight: 600;">
                  ${link.category}
                </span>
              ` : ''}
            </div>
            <div style="font-size: 12px; color: #6b7280; line-height: 1.6; margin-bottom: 6px;">
              <a href="${link.url || '#'}" target="_blank" rel="noopener noreferrer" style="color: #4f46e5; text-decoration: none; word-break: break-all;">
                ${link.url || 'No URL set'}
              </a>
            </div>
            ${link.shortDescription ? `
              <div style="font-size: 13px; color: #374151; margin-bottom: 8px;">
                ${link.shortDescription}
              </div>
            ` : ''}
            ${link.notes ? `
              <div style="margin-top: 12px; padding: 12px; background: #f9fafb; border-left: 3px solid #4f46e5; border-radius: 4px; font-size: 12px; color: #374151; line-height: 1.5;">
                ${link.notes}
              </div>
            ` : ''}
          </div>
          <div style="display: flex; gap: 8px;">
            <button
              class="btn-edit-link"
              style="padding: 8px 14px; font-size: 13px; font-weight: 500; border-radius: 6px; border: 1px solid #d1d5db; background: #ffffff; color: #374151; cursor: pointer; transition: all 0.2s;"
              onmouseover="this.style.background='#f3f4f6'"
              onmouseout="this.style.background='#ffffff'"
            >
              Edit
            </button>
            <button
              class="btn-delete-link"
              style="padding: 8px 14px; font-size: 13px; font-weight: 500; border-radius: 6px; border: 1px solid #fecaca; background: #ffffff; color: #dc2626; cursor: pointer; transition: all 0.2s;"
              onmouseover="this.style.background='#fef2f2'"
              onmouseout="this.style.background='#ffffff'"
            >
              Delete
            </button>
          </div>
        </div>
      `;
      
      listEl.appendChild(card);
    });
    
    const addBtn = container.querySelector('#btn-add-link');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        console.log('[CHEAT SHEET] 🔘 Add Link clicked');
        this.handleAddLink();
      });
    }
    
    listEl.querySelectorAll('.btn-edit-link').forEach((btn, index) => {
      btn.addEventListener('click', () => {
        const link = this.cheatSheet.links[index];
        if (!link) return;
        console.log('[CHEAT SHEET] 🔘 Edit Link clicked:', link);
        this.handleEditLink(index);
      });
    });
    
    listEl.querySelectorAll('.btn-delete-link').forEach((btn, index) => {
      btn.addEventListener('click', () => {
        const link = this.cheatSheet.links[index];
        if (!link) return;
        console.log('[CHEAT SHEET] 🗑️ Delete Link clicked:', link);
        this.handleDeleteLink(index);
      });
    });
    
    console.log('[CHEAT SHEET] ✅ Links rendered. Count:', this.cheatSheet.links.length);
  }
  
  handleAddLink() {
    if (!this.cheatSheet) return;
    
    if (!Array.isArray(this.cheatSheet.links)) {
      this.cheatSheet.links = [];
    }
    
    // Open modal for new link
    this.showLinkModal();
  }
  
  handleEditLink(index) {
    if (!this.cheatSheet || !Array.isArray(this.cheatSheet.links)) return;
    const link = this.cheatSheet.links[index];
    if (!link) return;
    
    // Open modal for existing link
    this.showLinkModal(index);
  }
  
  /**
   * Show Link Modal (Enterprise Form)
   * @param {number|null} linkIndex - Index of link being edited, or null for new
   */
  showLinkModal(linkIndex = null) {
    const isEdit = linkIndex !== null;
    const link = isEdit ? this.cheatSheet.links[linkIndex] : null;
    
    // Create modal HTML
    const modalHTML = `
      <div id="link-modal" style="
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.75);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        animation: fadeIn 0.2s ease-out;
      ">
        <div style="
          background: #ffffff;
          border-radius: 12px;
          width: 90%;
          max-width: 600px;
          max-height: 90vh;
          overflow-y: auto;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          animation: slideUp 0.3s ease-out;
        ">
          <!-- Header -->
          <div style="
            padding: 24px 24px 16px;
            border-bottom: 1px solid #e5e7eb;
            position: sticky;
            top: 0;
            background: #ffffff;
            z-index: 1;
          ">
            <h2 style="margin: 0; font-size: 20px; font-weight: 600; color: #111827;">
              ${isEdit ? '✏️ Edit Link' : '🔗 Add Link'}
            </h2>
          </div>
          
          <!-- Form Body -->
          <div style="padding: 24px;">
            <form id="link-form" style="display: flex; flex-direction: column; gap: 20px;">
              
              <!-- Label -->
              <div>
                <label style="display: block; font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px;">
                  Link Label / Title *
                </label>
                <input 
                  type="text" 
                  id="link-label" 
                  value="${link?.label || ''}" 
                  placeholder="e.g., Payment Portal, Service Area Map"
                  required
                  style="
                    width: 100%;
                    padding: 10px 12px;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    font-size: 14px;
                    font-family: inherit;
                  "
                />
              </div>
              
              <!-- Category -->
              <div>
                <label style="display: block; font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px;">
                  Category *
                </label>
                <select 
                  id="link-category"
                  required
                  style="
                    width: 100%;
                    padding: 10px 12px;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    font-size: 14px;
                    font-family: inherit;
                    background: #ffffff;
                  "
                >
                  <option value="payment" ${link?.category === 'payment' ? 'selected' : ''}>💳 Payment / Billing</option>
                  <option value="scheduling" ${link?.category === 'scheduling' ? 'selected' : ''}>📅 Scheduling</option>
                  <option value="service-area" ${link?.category === 'service-area' ? 'selected' : ''}>🗺️ Service Area Map</option>
                  <option value="faq" ${link?.category === 'faq' ? 'selected' : ''}>❓ FAQ / Help</option>
                  <option value="portal" ${link?.category === 'portal' ? 'selected' : ''}>🔐 Customer Portal</option>
                  <option value="financing" ${link?.category === 'financing' ? 'selected' : ''}>💰 Financing Options</option>
                  <option value="catalog" ${link?.category === 'catalog' ? 'selected' : ''}>📦 Product Catalog</option>
                  <option value="policy" ${link?.category === 'policy' ? 'selected' : ''}>📜 Policies / Terms</option>
                  <option value="other" ${link?.category === 'other' ? 'selected' : ''}>🔗 Other</option>
                </select>
              </div>
              
              <!-- URL -->
              <div>
                <label style="display: block; font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px;">
                  URL *
                </label>
                <input 
                  type="url" 
                  id="link-url" 
                  value="${link?.url || ''}" 
                  placeholder="https://company.com/portal"
                  required
                  style="
                    width: 100%;
                    padding: 10px 12px;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    font-size: 14px;
                    font-family: inherit;
                  "
                />
                <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">
                  Must start with https:// or http://
                </div>
              </div>
              
              <!-- Short Description -->
              <div>
                <label style="display: block; font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px;">
                  Short Description
                </label>
                <textarea 
                  id="link-description" 
                  rows="2"
                  placeholder="Brief description for customers (e.g., 'Pay your invoice securely online')"
                  style="
                    width: 100%;
                    padding: 10px 12px;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    font-size: 14px;
                    font-family: inherit;
                    resize: vertical;
                  "
                >${link?.shortDescription || ''}</textarea>
              </div>
              
              <!-- Notes (AI Usage) -->
              <div>
                <label style="display: block; font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px;">
                  AI Usage Notes
                </label>
                <textarea 
                  id="link-notes" 
                  rows="3"
                  placeholder="Internal: When/how should AI use this link? (e.g., 'Send when customer asks about payment options')"
                  style="
                    width: 100%;
                    padding: 10px 12px;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    font-size: 14px;
                    font-family: inherit;
                    resize: vertical;
                  "
                >${link?.notes || ''}</textarea>
              </div>
              
            </form>
          </div>
          
          <!-- Footer Actions -->
          <div style="
            padding: 16px 24px;
            border-top: 1px solid #e5e7eb;
            display: flex;
            gap: 12px;
            justify-content: flex-end;
            position: sticky;
            bottom: 0;
            background: #ffffff;
          ">
            <button 
              type="button" 
              id="link-modal-cancel"
              style="
                padding: 10px 20px;
                border: 1px solid #d1d5db;
                border-radius: 6px;
                background: #ffffff;
                color: #374151;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s;
              "
              onmouseover="this.style.background='#f9fafb'"
              onmouseout="this.style.background='#ffffff'"
            >
              Cancel
            </button>
            <button 
              type="button" 
              id="link-modal-save"
              style="
                padding: 10px 20px;
                border: none;
                border-radius: 6px;
                background: #3b82f6;
                color: #ffffff;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s;
              "
              onmouseover="this.style.background='#2563eb'"
              onmouseout="this.style.background='#3b82f6'"
            >
              💾 Save Link
            </button>
          </div>
        </div>
      </div>
    `;
    
    // Inject modal into DOM
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Wire up events
    document.getElementById('link-modal-cancel').addEventListener('click', () => {
      document.getElementById('link-modal').remove();
    });
    
    document.getElementById('link-modal-save').addEventListener('click', () => {
      this.saveLinkForm(linkIndex);
    });
    
    // Focus first field
    setTimeout(() => {
      document.getElementById('link-label')?.focus();
    }, 100);
  }
  
  /**
   * Save Link Form Data
   */
  saveLinkForm(linkIndex = null) {
    const isEdit = linkIndex !== null;
    
    // Collect form data
    const label = document.getElementById('link-label').value.trim();
    const category = document.getElementById('link-category').value;
    const url = document.getElementById('link-url').value.trim();
    const shortDescription = document.getElementById('link-description').value.trim();
    const notes = document.getElementById('link-notes').value.trim();
    
    // Validate required fields
    if (!label) {
      alert('⚠️ Link label is required');
      document.getElementById('link-label').focus();
      return;
    }
    
    if (!url) {
      alert('⚠️ URL is required');
      document.getElementById('link-url').focus();
      return;
    }
    
    // Validate URL format
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      alert('⚠️ URL must start with http:// or https://');
      document.getElementById('link-url').focus();
      return;
    }
    
    // Build link object
    const linkData = {
      id: isEdit ? this.cheatSheet.links[linkIndex].id : `link-${Date.now()}`,
      label,
      category,
      url,
      shortDescription,
      notes
    };
    
    // Update or add link
    if (isEdit) {
      this.cheatSheet.links[linkIndex] = linkData;
      console.log('[CHEAT SHEET] ✅ Link updated:', linkData);
    } else {
      this.cheatSheet.links.push(linkData);
      console.log('[CHEAT SHEET] ✅ Link added:', linkData);
    }
    
    // Close modal
    document.getElementById('link-modal').remove();
    
    // Re-render and mark dirty
    this.renderLinks();
    this.markDirty();
  }
  
  handleDeleteLink(index) {
    if (!this.cheatSheet || !Array.isArray(this.cheatSheet.links)) return;
    const link = this.cheatSheet.links[index];
    if (!link) return;
    
    if (!window.confirm(`Delete link "${link.label}"?`)) return;
    
    this.cheatSheet.links.splice(index, 1);
    
    console.log('[CHEAT SHEET] 🗑️ Link deleted (local only)', link);
    
    this.renderLinks();
    
    if (typeof this.markDirty === 'function') {
      this.markDirty();
    }
    this.markDirty(); // Update UI (respects Version Console)
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // CALCULATOR RENDERER & HANDLERS
  // ═══════════════════════════════════════════════════════════════════
  
  renderCalculator() {
    console.log('[CHEAT SHEET] 🎨 renderCalculator called');
    
    if (!this.cheatSheet) {
      console.warn('[CHEAT SHEET] ⚠️ No cheatSheet loaded yet for Calculator');
      return;
    }
    
    if (!Array.isArray(this.cheatSheet.calculators)) {
      this.cheatSheet.calculators = [];
    }
    
    const container = document.getElementById('cheatsheet-v2-dynamic-content');
    
    if (!container) {
      console.warn('[CHEAT SHEET] ⚠️ V2 dynamic content container not found');
      return;
    }
    
    const calculators = this.cheatSheet.calculators;
    
    container.innerHTML = `
      <div style="padding: 24px; background: #ffffff; border-radius: 12px; margin: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
          <div>
            <h3 style="font-size: 20px; font-weight: 700; color: #111827; margin: 0 0 4px 0;">
              🧮 Calculator
            </h3>
            <p style="font-size: 13px; color: #6b7280; margin: 0;">
              Diagnostic fees, discounts, membership pricing the AI can use for consistent quotes.
            </p>
          </div>
          <button
            id="btn-add-calculator"
            style="display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; font-size: 14px; font-weight: 600; border-radius: 8px; border: none; background: #4f46e5; color: #ffffff; cursor: pointer; box-shadow: 0 2px 4px rgba(79, 70, 229, 0.3); transition: all 0.2s;"
            onmouseover="this.style.background='#4338ca'"
            onmouseout="this.style.background='#4f46e5'"
          >
            <span style="font-size: 16px;">＋</span>
            <span>Add Calculator</span>
          </button>
        </div>
        
        <div id="calculators-list" style="display: flex; flex-direction: column; gap: 12px;">
          ${calculators.length === 0 ? `
            <div style="border: 2px dashed #d1d5db; border-radius: 12px; padding: 32px; background: #f9fafb; text-align: center;">
              <div style="font-size: 48px; margin-bottom: 12px;">💰</div>
              <p style="font-size: 14px; color: #6b7280; margin: 0;">
                No calculators configured yet. Click <span style="font-weight: 600; color: #111827;">"Add Calculator"</span> to create your first calculator. These pre-approved amounts ensure the AI gives consistent pricing.
              </p>
            </div>
          ` : ''}
        </div>
      </div>
    `;
    
    const listEl = container.querySelector('#calculators-list');
    if (!listEl) {
      console.warn('[CHEAT SHEET] ⚠️ calculators-list not found');
      return;
    }
    
    calculators.forEach((calc, index) => {
      const card = document.createElement('div');
      card.style.cssText = 'border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; background: #ffffff; box-shadow: 0 1px 3px rgba(0,0,0,0.1);';
      card.setAttribute('data-calculator-id', calc.id || `idx-${index}`);
      
      card.innerHTML = `
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;">
          <div style="flex: 1;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
              <span style="font-size: 16px; font-weight: 600; color: #111827;">
                ${calc.label || 'Unnamed Calculator'}
              </span>
              <span style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; padding: 3px 8px; border-radius: 999px; background: #10b981; color: #ffffff; font-weight: 600;">
                ${calc.type || 'flat-fee'}
              </span>
            </div>
            <div style="font-size: 18px; font-weight: 700; color: #10b981; margin-bottom: 6px;">
              $${typeof calc.baseAmount === 'number' ? calc.baseAmount.toFixed(2) : '0.00'}
            </div>
            ${calc.notes ? `
              <div style="margin-top: 12px; padding: 12px; background: #f9fafb; border-left: 3px solid #4f46e5; border-radius: 4px; font-size: 12px; color: #374151; line-height: 1.5;">
                ${calc.notes}
              </div>
            ` : ''}
          </div>
          <div style="display: flex; gap: 8px;">
            <button
              class="btn-edit-calculator"
              style="padding: 8px 14px; font-size: 13px; font-weight: 500; border-radius: 6px; border: 1px solid #d1d5db; background: #ffffff; color: #374151; cursor: pointer; transition: all 0.2s;"
              onmouseover="this.style.background='#f3f4f6'"
              onmouseout="this.style.background='#ffffff'"
            >
              Edit
            </button>
            <button
              class="btn-delete-calculator"
              style="padding: 8px 14px; font-size: 13px; font-weight: 500; border-radius: 6px; border: 1px solid #fecaca; background: #ffffff; color: #dc2626; cursor: pointer; transition: all 0.2s;"
              onmouseover="this.style.background='#fef2f2'"
              onmouseout="this.style.background='#ffffff'"
            >
              Delete
            </button>
          </div>
        </div>
      `;
      
      listEl.appendChild(card);
    });
    
    const addBtn = container.querySelector('#btn-add-calculator');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        console.log('[CHEAT SHEET] 🔘 Add Calculator clicked');
        this.handleAddCalculator();
      });
    }
    
    listEl.querySelectorAll('.btn-edit-calculator').forEach((btn, index) => {
      btn.addEventListener('click', () => {
        const calc = this.cheatSheet.calculators[index];
        if (!calc) return;
        console.log('[CHEAT SHEET] 🔘 Edit Calculator clicked:', calc);
        this.handleEditCalculator(index);
      });
    });
    
    listEl.querySelectorAll('.btn-delete-calculator').forEach((btn, index) => {
      btn.addEventListener('click', () => {
        const calc = this.cheatSheet.calculators[index];
        if (!calc) return;
        console.log('[CHEAT SHEET] 🗑️ Delete Calculator clicked:', calc);
        this.handleDeleteCalculator(index);
      });
    });
    
    console.log('[CHEAT SHEET] ✅ Calculator rendered. Count:', this.cheatSheet.calculators.length);
  }
  
  handleAddCalculator() {
    if (!this.cheatSheet) return;
    
    if (!Array.isArray(this.cheatSheet.calculators)) {
      this.cheatSheet.calculators = [];
    }
    
    // Open modal for new calculator
    this.showCalculatorModal();
  }
  
  handleEditCalculator(index) {
    if (!this.cheatSheet || !Array.isArray(this.cheatSheet.calculators)) return;
    const calc = this.cheatSheet.calculators[index];
    if (!calc) return;
    
    // Open modal for existing calculator
    this.showCalculatorModal(index);
  }
  
  /**
   * Show Calculator Modal (Enterprise Form)
   * @param {number|null} calcIndex - Index of calculator being edited, or null for new
   */
  showCalculatorModal(calcIndex = null) {
    const isEdit = calcIndex !== null;
    const calc = isEdit ? this.cheatSheet.calculators[calcIndex] : null;
    
    // Create modal HTML
    const modalHTML = `
      <div id="calculator-modal" style="
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.75);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        animation: fadeIn 0.2s ease-out;
      ">
        <div style="
          background: #ffffff;
          border-radius: 12px;
          width: 90%;
          max-width: 600px;
          max-height: 90vh;
          overflow-y: auto;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          animation: slideUp 0.3s ease-out;
        ">
          <!-- Header -->
          <div style="
            padding: 24px 24px 16px;
            border-bottom: 1px solid #e5e7eb;
            position: sticky;
            top: 0;
            background: #ffffff;
            z-index: 1;
          ">
            <h2 style="margin: 0; font-size: 20px; font-weight: 600; color: #111827;">
              ${isEdit ? '✏️ Edit Calculator' : '🧮 Add Calculator'}
            </h2>
          </div>
          
          <!-- Form Body -->
          <div style="padding: 24px;">
            <form id="calculator-form" style="display: flex; flex-direction: column; gap: 20px;">
              
              <!-- Label -->
              <div>
                <label style="display: block; font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px;">
                  Calculator Name *
                </label>
                <input 
                  type="text" 
                  id="calc-label" 
                  value="${calc?.label || ''}" 
                  placeholder="e.g., Service Call Fee, HVAC System Size"
                  required
                  style="
                    width: 100%;
                    padding: 10px 12px;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    font-size: 14px;
                    font-family: inherit;
                  "
                />
              </div>
              
              <!-- Type -->
              <div>
                <label style="display: block; font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px;">
                  Calculator Type *
                </label>
                <select 
                  id="calc-type"
                  required
                  style="
                    width: 100%;
                    padding: 10px 12px;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    font-size: 14px;
                    font-family: inherit;
                    background: #ffffff;
                  "
                >
                  <option value="flat-fee" ${calc?.type === 'flat-fee' ? 'selected' : ''}>💵 Flat Fee</option>
                  <option value="square-footage" ${calc?.type === 'square-footage' ? 'selected' : ''}>📐 Square Footage Based</option>
                  <option value="btu" ${calc?.type === 'btu' ? 'selected' : ''}>🔥 BTU Calculator</option>
                  <option value="tonnage" ${calc?.type === 'tonnage' ? 'selected' : ''}>⚖️ Tonnage Calculator</option>
                  <option value="cost-estimator" ${calc?.type === 'cost-estimator' ? 'selected' : ''}>💰 Cost Estimator</option>
                  <option value="custom" ${calc?.type === 'custom' ? 'selected' : ''}>⚙️ Custom Formula</option>
                </select>
              </div>
              
              <!-- Base Amount -->
              <div>
                <label style="display: block; font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px;">
                  Base Amount / Value *
                </label>
                <div style="position: relative;">
                  <span style="
                    position: absolute;
                    left: 12px;
                    top: 50%;
                    transform: translateY(-50%);
                    font-size: 14px;
                    color: #6b7280;
                    font-weight: 500;
                  ">$</span>
                  <input 
                    type="number" 
                    id="calc-base-amount" 
                    value="${calc?.baseAmount || 0}" 
                    placeholder="0.00"
                    step="0.01"
                    min="0"
                    required
                    style="
                      width: 100%;
                      padding: 10px 12px 10px 28px;
                      border: 1px solid #d1d5db;
                      border-radius: 6px;
                      font-size: 14px;
                      font-family: inherit;
                    "
                  />
                </div>
                <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">
                  For flat fees, this is the total. For calculators, this is the base value.
                </div>
              </div>
              
              <!-- Description -->
              <div>
                <label style="display: block; font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px;">
                  Description
                </label>
                <textarea 
                  id="calc-description" 
                  rows="2"
                  placeholder="Explain what this calculator does (e.g., 'Calculates recommended HVAC size based on square footage')"
                  style="
                    width: 100%;
                    padding: 10px 12px;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    font-size: 14px;
                    font-family: inherit;
                    resize: vertical;
                  "
                >${calc?.description || ''}</textarea>
              </div>
              
              <!-- Formula/Logic -->
              <div>
                <label style="display: block; font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px;">
                  Formula / Logic
                </label>
                <textarea 
                  id="calc-formula" 
                  rows="3"
                  placeholder="e.g., 'sqft * 25 = BTU needed' or 'Base fee + ($X per unit)'"
                  style="
                    width: 100%;
                    padding: 10px 12px;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    font-size: 14px;
                    font-family: 'Courier New', monospace;
                    resize: vertical;
                  "
                >${calc?.formula || ''}</textarea>
              </div>
              
              <!-- Units -->
              <div>
                <label style="display: block; font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px;">
                  Output Units
                </label>
                <input 
                  type="text" 
                  id="calc-units" 
                  value="${calc?.units || ''}" 
                  placeholder="e.g., BTU, Tons, $, sq ft"
                  style="
                    width: 100%;
                    padding: 10px 12px;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    font-size: 14px;
                    font-family: inherit;
                  "
                />
              </div>
              
              <!-- Notes -->
              <div>
                <label style="display: block; font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px;">
                  AI Usage Notes
                </label>
                <textarea 
                  id="calc-notes" 
                  rows="3"
                  placeholder="Internal: When should AI use this calculator? (e.g., 'Use when customer asks about service call pricing')"
                  style="
                    width: 100%;
                    padding: 10px 12px;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    font-size: 14px;
                    font-family: inherit;
                    resize: vertical;
                  "
                >${calc?.notes || ''}</textarea>
              </div>
              
            </form>
          </div>
          
          <!-- Footer Actions -->
          <div style="
            padding: 16px 24px;
            border-top: 1px solid #e5e7eb;
            display: flex;
            gap: 12px;
            justify-content: flex-end;
            position: sticky;
            bottom: 0;
            background: #ffffff;
          ">
            <button 
              type="button" 
              id="calc-modal-cancel"
              style="
                padding: 10px 20px;
                border: 1px solid #d1d5db;
                border-radius: 6px;
                background: #ffffff;
                color: #374151;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s;
              "
              onmouseover="this.style.background='#f9fafb'"
              onmouseout="this.style.background='#ffffff'"
            >
              Cancel
            </button>
            <button 
              type="button" 
              id="calc-modal-save"
              style="
                padding: 10px 20px;
                border: none;
                border-radius: 6px;
                background: #3b82f6;
                color: #ffffff;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s;
              "
              onmouseover="this.style.background='#2563eb'"
              onmouseout="this.style.background='#3b82f6'"
            >
              💾 Save Calculator
            </button>
          </div>
        </div>
      </div>
    `;
    
    // Inject modal into DOM
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Wire up events
    document.getElementById('calc-modal-cancel').addEventListener('click', () => {
      document.getElementById('calculator-modal').remove();
    });
    
    document.getElementById('calc-modal-save').addEventListener('click', () => {
      this.saveCalculatorForm(calcIndex);
    });
    
    // Focus first field
    setTimeout(() => {
      document.getElementById('calc-label')?.focus();
    }, 100);
  }
  
  /**
   * Save Calculator Form Data
   */
  saveCalculatorForm(calcIndex = null) {
    const isEdit = calcIndex !== null;
    
    // Collect form data
    const label = document.getElementById('calc-label').value.trim();
    const type = document.getElementById('calc-type').value;
    const baseAmount = parseFloat(document.getElementById('calc-base-amount').value);
    const description = document.getElementById('calc-description').value.trim();
    const formula = document.getElementById('calc-formula').value.trim();
    const units = document.getElementById('calc-units').value.trim();
    const notes = document.getElementById('calc-notes').value.trim();
    
    // Validate required fields
    if (!label) {
      alert('⚠️ Calculator name is required');
      document.getElementById('calc-label').focus();
      return;
    }
    
    if (isNaN(baseAmount) || baseAmount < 0) {
      alert('⚠️ Base amount must be a valid number (0 or greater)');
      document.getElementById('calc-base-amount').focus();
      return;
    }
    
    // Build calculator object
    const calcData = {
      id: isEdit ? this.cheatSheet.calculators[calcIndex].id : `calc-${Date.now()}`,
      label,
      type,
      baseAmount,
      description,
      formula,
      units,
      notes
    };
    
    // Update or add calculator
    if (isEdit) {
      this.cheatSheet.calculators[calcIndex] = calcData;
      console.log('[CHEAT SHEET] ✅ Calculator updated:', calcData);
    } else {
      this.cheatSheet.calculators.push(calcData);
      console.log('[CHEAT SHEET] ✅ Calculator added:', calcData);
    }
    
    // Close modal
    document.getElementById('calculator-modal').remove();
    
    // Re-render and mark dirty
    this.renderCalculator();
    this.markDirty();
  }
  
  handleDeleteCalculator(index) {
    if (!this.cheatSheet || !Array.isArray(this.cheatSheet.calculators)) return;
    const calc = this.cheatSheet.calculators[index];
    if (!calc) return;
    
    if (!window.confirm(`Delete calculator "${calc.label}"?`)) return;
    
    this.cheatSheet.calculators.splice(index, 1);
    
    console.log('[CHEAT SHEET] 🗑️ Calculator deleted (local only)', calc);
    
    this.renderCalculator();
    
    if (typeof this.markDirty === 'function') {
      this.markDirty();
    }
    this.markDirty(); // Update UI (respects Version Console)
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // COMING SOON RENDERER (V2-ONLY PLACEHOLDERS)
  // ═══════════════════════════════════════════════════════════════════
  
  renderComingSoon(tabId) {
    console.log('[CHEAT SHEET] 🎨 renderComingSoon called for tab:', tabId);
    
    const config = CHEATSHEET_COMING_SOON_TABS[tabId] || {
      title: 'Coming Soon',
      description: 'This section is under construction.'
    };
    
    // Find the dedicated V2 dynamic content container
    const container = document.getElementById('cheatsheet-v2-dynamic-content');
    
    if (!container) {
      console.warn('[CHEAT SHEET] ⚠️ V2 dynamic content container not found');
      return;
    }
    
    container.innerHTML = `
      <div style="padding: 24px; background: #ffffff; border-radius: 12px; margin: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
        <div style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border: 2px solid #334155; border-radius: 16px; padding: 32px; box-shadow: 0 10px 30px rgba(0,0,0,0.3);">
          <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 20px;">
            <div style="display: inline-flex; height: 48px; width: 48px; align-items: center; justify-content: center; border-radius: 50%; background: rgba(99, 102, 241, 0.2); border: 2px solid rgba(99, 102, 241, 0.4);">
              <span style="font-size: 24px;">🚧</span>
            </div>
            <div>
              <h3 style="font-weight: 700; font-size: 22px; color: #f1f5f9; margin: 0;">${config.title}</h3>
              <p style="font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #94a3b8; margin: 4px 0 0 0;">
                Feature in development
              </p>
            </div>
          </div>
          <p style="font-size: 15px; color: #cbd5e1; line-height: 1.6; margin-bottom: 20px;">
            ${config.description}
          </p>
          <div style="display: inline-flex; align-items: center; gap: 12px; font-size: 12px; color: #94a3b8;">
            <span style="padding: 6px 12px; border-radius: 999px; background: #1e293b; border: 1px solid #334155; font-weight: 600;">
              ClientsVia Control Plane · V2
            </span>
            <span>Roadmap: this tab will become fully configurable inside AiCore Control Center.</span>
          </div>
        </div>
      </div>
    `;
    
    console.log('[CHEAT SHEET] ✅ Coming Soon content rendered for tab:', tabId);
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // VERSION HISTORY RENDERER
  // ═══════════════════════════════════════════════════════════════════
  
  async renderVersionHistory() {
    console.log('[CHEAT SHEET] 🎨 renderVersionHistory called');
    
    if (!this.versioningAdapter) {
      console.warn('[CHEAT SHEET] ⚠️ Versioning adapter not available');
      this.renderComingSoon('version-history');
      return;
    }
    
    const container = document.getElementById('cheatsheet-v2-dynamic-content');
    if (!container) {
      console.warn('[CHEAT SHEET] ⚠️ V2 dynamic content container not found');
      return;
    }
    
    // Show loading state
    container.innerHTML = `
      <div style="padding: 24px; background: #ffffff; border-radius: 12px; margin: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
        <div style="text-align: center; padding: 40px;">
          <div style="font-size: 48px; margin-bottom: 16px;">⏳</div>
          <div style="font-size: 16px; color: #6b7280;">Loading version history...</div>
        </div>
      </div>
    `;
    
    try {
      // Fetch version history from API (or use cached csVersions if Version Console is active)
      let history;
      if (this.useVersionConsole && Array.isArray(this.csVersions) && this.csVersions.length > 0) {
        // Use cached versions from Version Console (single source of truth)
        history = this.csVersions;
        console.log('[CHEAT SHEET] ✅ Using cached versions from Version Console:', history.length);
      } else {
        // Fetch fresh (legacy mode or initial load)
        history = await this.versioningAdapter.getVersionHistory();
        console.log('[CHEAT SHEET] ✅ Version history loaded:', history);
      }
      
      // Render version history UI
      container.innerHTML = `
        <div style="padding: 24px; background: #ffffff; border-radius: 12px; margin: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
          
          <!-- Header -->
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid #e5e7eb;">
            <div>
              <h3 style="font-size: 24px; font-weight: 700; color: #111827; margin: 0 0 4px 0;">
                📚 Version History
              </h3>
              <p style="font-size: 14px; color: #6b7280; margin: 0;">
                Browse, compare, and restore previous configurations
              </p>
            </div>
            <div style="display: flex; align-items: center; gap: 12px;">
              <div style="padding: 8px 16px; border-radius: 8px; background: #f0f9ff; border: 1px solid #0ea5e9;">
                <span style="font-size: 13px; font-weight: 600; color: #0369a1;">
                  ${history.length} Version${history.length !== 1 ? 's' : ''}
                </span>
              </div>
            </div>
          </div>
          
          <!-- Sub-tabs -->
          <div id="version-history-subtabs" style="display:flex; gap:16px; border-bottom:1px solid #e5e7eb; margin-bottom:16px;">
            <button
              type="button"
              class="version-subtab-btn active"
              data-tab="local"
              style="
                padding: 0 0 8px;
                border: none;
                border-bottom: 2px solid #1976d2;
                background: none;
                cursor: pointer;
                font-size: 13px;
                font-weight: 600;
                color: #1976d2;
              "
            >
              Local Configurations
              <span style="
                display: inline-block;
                margin-left: 8px;
                padding: 2px 8px;
                border-radius: 4px;
                background: #f0f9ff;
                color: #0369a1;
                font-size: 11px;
                font-weight: 600;
                font-family: 'Monaco', monospace;
              ">
                ${this.companyId ? `ID: ${this.companyId.substring(0, 8)}...` : ''}
              </span>
            </button>
            <button
              type="button"
              class="version-subtab-btn"
              data-tab="global"
              style="
                padding: 0 0 8px;
                border: none;
                border-bottom: 2px solid transparent;
                background: none;
                cursor: pointer;
                font-size: 13px;
                font-weight: 500;
                color: #6b7280;
              "
            >
              Global Configurations
            </button>
          </div>
          
          <!-- Local Configurations Tab -->
          <div
            id="local-configs-tab"
            class="version-subtab-content"
            data-tab="local"
            style="margin-top: 8px;"
          >
            <!-- Info Icon -->
            <div style="display: flex; align-items: center; justify-content: flex-start; margin-bottom: 16px;">
              <button
                id="btn-local-config-info"
                type="button"
                style="
                  display: inline-flex;
                  align-items: center;
                  gap: 6px;
                  padding: 6px 12px;
                  border-radius: 6px;
                  border: 1px solid #0ea5e9;
                  background: #f0f9ff;
                  color: #0369a1;
                  font-size: 12px;
                  font-weight: 600;
                  cursor: pointer;
                  transition: all 0.2s;
                "
                title="Learn how configuration versions work"
              >
                <span style="font-size: 16px;">ℹ️</span>
                <span>How Versions Work</span>
              </button>
            </div>
            
            <!-- Category selector block will be injected here in Phase 2 -->
            <div id="category-selector-block" style="margin-bottom: 16px;"></div>
            
            <!-- Existing Version Cards List -->
            <div id="version-cards-list" style="display: flex; flex-direction: column; gap: 16px;">
              ${history.length === 0 ? `
                <div style="border: 2px dashed #d1d5db; border-radius: 12px; padding: 48px; background: #f9fafb; text-align: center;">
                  <div style="font-size: 64px; margin-bottom: 16px; opacity: 0.5;">📦</div>
                  <div style="font-size: 18px; font-weight: 600; color: #374151; margin-bottom: 8px;">
                    No Version History Yet
                  </div>
                  <p style="font-size: 14px; color: #6b7280; margin: 0;">
                    Version history will appear here as you create and push drafts.
                  </p>
                </div>
              ` : '<!-- Version cards will be rendered dynamically -->'}
            </div>
          </div>
          
          <!-- Global Configurations Tab -->
          <div
            id="global-configs-tab"
            class="version-subtab-content"
            data-tab="global"
            style="margin-top: 8px; display: none;"
          >
            <!-- Placeholder for now; real content comes in later phases -->
            <div id="global-configs-empty-state" style="font-size: 13px; color: #6b7280;">
              Select a category in the Global tab to view shared configurations.
            </div>
            <div id="global-configs-list" style="margin-top: 16px; display:flex; flex-direction:column; gap:12px;"></div>
          </div>
          
        </div>
      `;
      
      // Render category selector block (Local Configurations tab)
      this.renderCategorySelectorBlock();
      
      // Render individual version cards
      if (history.length > 0) {
        const listEl = container.querySelector('#version-cards-list');
        if (listEl) {
          history.forEach((version, index) => {
            const card = this.renderVersionCard(version, index);
            listEl.appendChild(card);
          });
        }
      }
      
      console.log('[CHEAT SHEET] ✅ Version history rendered. Count:', history.length);
      
      // Initialize sub-tab switching behavior
      this.initVersionHistorySubtabs();
      
      // Wire Version History edit buttons to Version Console (Phase 3)
      if (this.useVersionConsole) {
        this.bindVersionHistoryEvents();
      }
      
    } catch (error) {
      console.error('[CHEAT SHEET] ❌ Failed to load version history:', error);
      
      container.innerHTML = `
        <div style="padding: 24px; background: #ffffff; border-radius: 12px; margin: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
          <div style="text-align: center; padding: 40px;">
            <div style="font-size: 64px; margin-bottom: 16px;">❌</div>
            <div style="font-size: 18px; font-weight: 600; color: #dc2626; margin-bottom: 8px;">
              Failed to Load Version History
            </div>
            <p style="font-size: 14px; color: #6b7280; margin: 0;">
              ${error.message || 'Unknown error occurred'}
            </p>
          </div>
        </div>
      `;
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // VERSION HISTORY SUB-TABS (Local / Global Configurations)
  // ═══════════════════════════════════════════════════════════════════
  
  renderCategorySelectorBlock() {
    const container = document.getElementById('cheatsheet-v2-dynamic-content');
    if (!container) return;
    
    const block = container.querySelector('#category-selector-block');
    if (!block) return;
    
    const categories = this.globalCategories || [];
    const hasCategory = !!this.companyCategoryId;
    
    // If company already has a locked category
    if (hasCategory) {
      const matched = categories.find((c) => c._id === this.companyCategoryId);
      const name = matched ? matched.name : 'Unknown category';
      
      block.innerHTML = `
        <div style="
          background: #ecfdf3;
          border: 2px solid #10b981;
          border-radius: 8px;
          padding: 12px 16px;
          display: flex;
          align-items: center;
          gap: 10px;
        ">
          <span style="font-size: 20px;">🏷️</span>
          <div>
            <div style="font-size: 11px; font-weight: 600; color: #065f46; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">
              Category (Locked)
            </div>
            <div style="font-size: 15px; font-weight: 700; color: #047857;">
              ${name}
            </div>
          </div>
          <span style="margin-left: auto; font-size: 18px;">🔒</span>
        </div>
      `;
      return;
    }
    
    // No category assigned yet
    if (!categories.length) {
      block.innerHTML = `
        <div style="
          background: #fef3c7;
          border: 2px solid #f59e0b;
          border-radius: 8px;
          padding: 12px 16px;
        ">
          <div style="font-size: 13px; font-weight: 600; color: #92400e; margin-bottom: 4px;">
            ⚠️ No Categories Available
          </div>
          <div style="font-size: 12px; color: #78350f;">
            Create at least one category in the <strong>Global Configurations</strong> tab to enable sharing.
          </div>
        </div>
      `;
      return;
    }
    
    // Build dropdown + button
    const optionsHtml = categories
      .map((c) => `<option value="${c._id}">${c.name}</option>`)
      .join('');
    
    block.innerHTML = `
      <div style="
        background: #f0f9ff;
        border: 2px solid #0ea5e9;
        border-radius: 8px;
        padding: 16px;
      ">
        <div style="margin-bottom: 12px;">
          <div style="font-size: 13px; font-weight: 600; color: #0369a1; margin-bottom: 4px;">
            🏷️ Set Category
          </div>
          <div style="font-size: 11px; color: #0c4a6e;">
            Choose a category to enable sharing to Global. <strong>This cannot be changed later.</strong>
          </div>
        </div>
        
        <div style="display:flex; align-items:flex-end; gap:12px;">
          <div style="display:flex; flex-direction:column; gap:6px; flex:1; max-width: 300px;">
            <label for="cheatsheet-category-select" style="font-size:12px; font-weight:600; color:#0369a1;">
              Select Category
            </label>
            <select
              id="cheatsheet-category-select"
              style="
                padding:8px 12px;
                border-radius:6px;
                border:1px solid #0ea5e9;
                font-size:13px;
                color:#111827;
                background:#fff;
              "
            >
              <option value="">-- Select category --</option>
              ${optionsHtml}
            </select>
          </div>
          
          <button
            type="button"
            id="cheatsheet-category-lock-btn"
            style="
              padding:8px 16px;
              border-radius:6px;
              border:none;
              font-size:13px;
              font-weight:600;
              cursor:not-allowed;
              background:#e5e7eb;
              color:#9ca3af;
              box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            "
            disabled
          >
            🔒 Lock Category
          </button>
        </div>
      </div>
    `;
    
    const selectEl = block.querySelector('#cheatsheet-category-select');
    const buttonEl = block.querySelector('#cheatsheet-category-lock-btn');
    
    if (!selectEl || !buttonEl) return;
    
    // Enable button when a category is chosen
    selectEl.addEventListener('change', () => {
      if (selectEl.value) {
        buttonEl.disabled = false;
        buttonEl.style.cursor = 'pointer';
        buttonEl.style.background = '#10b981';
        buttonEl.style.color = '#ffffff';
        buttonEl.style.boxShadow = '0 2px 8px rgba(16, 185, 129, 0.3)';
      } else {
        buttonEl.disabled = true;
        buttonEl.style.cursor = 'not-allowed';
        buttonEl.style.background = '#e5e7eb';
        buttonEl.style.color = '#9ca3af';
        buttonEl.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.1)';
      }
    });
    
    buttonEl.addEventListener('click', () => {
      if (!selectEl.value) return;
      this.setCategoryAndLock(selectEl.value);
    });
  }
  
  async setCategoryAndLock(categoryId) {
    if (!this.companyId) {
      console.error('[CHEAT SHEET] Cannot set category – companyId is missing');
      return;
    }
    
    if (!categoryId) {
      console.error('[CHEAT SHEET] Cannot set category – categoryId is missing');
      return;
    }
    
    // If already locked in memory, do nothing
    if (this.companyCategoryId) {
      console.debug('[CHEAT SHEET] Category already locked for this company, skipping setCategoryAndLock');
      return;
    }
    
    try {
      console.log('[CHEAT SHEET] Setting and locking category:', categoryId);
      
      const response = await fetch('/api/cheatsheet/category', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('adminToken')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          companyId: this.companyId,
          categoryId
        })
      });
      
      const result = await response.json();
      
      if (!response.ok || !result || !result.success) {
        console.error('[CHEAT SHEET] Failed to set and lock category', { status: response.status, result });
        return;
      }
      
      console.log('[CHEAT SHEET] ✅ Category locked successfully');
      
      // Lock locally
      this.companyCategoryId = categoryId;
      
      // Re-render selector block in locked state
      this.renderCategorySelectorBlock();
    } catch (err) {
      console.error('[CHEAT SHEET] Error setting and locking category', err);
    }
  }
  
  async shareToGlobal(versionId) {
    if (!this.companyId) {
      console.error('[CHEAT SHEET] Cannot share to global – companyId is missing');
      return;
    }
    
    if (!this.companyCategoryId) {
      console.error('[CHEAT SHEET] Cannot share to global – category is not set');
      return;
    }
    
    // Find and disable the share button
    const shareBtn = document.querySelector(`.share-global-btn[data-version-id="${versionId}"]`);
    if (shareBtn) {
      shareBtn.disabled = true;
      shareBtn.style.cursor = 'wait';
      shareBtn.style.background = '#9ca3af';
      shareBtn.textContent = 'Sharing...';
    }
    
    try {
      console.log('[CHEAT SHEET] 🔄 Sharing live config to global:', {
        companyId: this.companyId,
        categoryId: this.companyCategoryId,
        versionId
      });
      
      const response = await fetch('/api/global-config/share', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('adminToken')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          companyId: this.companyId
        })
      });
      
      const result = await response.json();
      
      if (!response.ok || !result || !result.success) {
        console.error('[CHEAT SHEET] ❌ Failed to share live config to global', {
          status: response.status,
          result
        });
        
        // Re-enable button on failure
        if (shareBtn) {
          shareBtn.disabled = false;
          shareBtn.style.cursor = 'pointer';
          shareBtn.style.background = '#111827';
          shareBtn.textContent = 'Share to Global';
        }
        return;
      }
      
      console.log('[CHEAT SHEET] ✅ Config shared to global successfully:', {
        companyId: result.data.companyId,
        categoryId: result.data.categoryId,
        cheatSheetVersionId: result.data.cheatSheetVersionId
      });
      
      // Mark locally as shared and track which version (MongoDB _id)
      this.hasSharedGlobalConfig = true;
      this.sharedGlobalVersionMongoId = result.data.cheatSheetVersionId;
      
      // Re-render version history so the button state updates
      await this.renderVersionHistory();
      
      alert(`✅ Version shared to Global successfully!\n\nOther companies in the "${this.globalCategories.find(c => c._id === this.companyCategoryId)?.name || 'category'}" category can now import this configuration.`);
    } catch (err) {
      console.error('[CHEAT SHEET] ❌ Error sharing live config to global', err);
      
      // Re-enable button on error
      if (shareBtn) {
        shareBtn.disabled = false;
        shareBtn.style.cursor = 'pointer';
        shareBtn.style.background = '#111827';
        shareBtn.textContent = 'Share to Global';
      }
    }
  }
  
  async unshareFromGlobal(versionId) {
    if (!this.companyId) {
      console.error('[CHEAT SHEET] Cannot unshare from global – companyId is missing');
      return;
    }
    
    const confirmed = confirm(
      '⚠️ UNSHARE FROM GLOBAL?\n\n' +
      'This will remove your shared configuration from Global.\n\n' +
      'Other companies will no longer be able to import it.\n\n' +
      'Are you sure?'
    );
    
    if (!confirmed) {
      console.log('[CHEAT SHEET] Unshare cancelled by user');
      return;
    }
    
    // Find and disable the unshare button
    const unshareBtn = document.querySelector(`.unshare-global-btn[data-version-id="${versionId}"]`);
    if (unshareBtn) {
      unshareBtn.disabled = true;
      unshareBtn.style.cursor = 'wait';
      unshareBtn.style.background = '#9ca3af';
      unshareBtn.textContent = 'Unsharing...';
    }
    
    try {
      console.log('[CHEAT SHEET] 🔄 Unsharing config from global:', {
        companyId: this.companyId,
        versionId
      });
      
      // Call backend to delete GlobalConfigReference
      const response = await fetch(`/api/global-config/unshare/${this.companyId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('adminToken')}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }
      
      const result = await response.json();
      console.log('[CHEAT SHEET] ✅ Config unshared from global successfully');
      
      // Mark locally as not shared
      this.hasSharedGlobalConfig = false;
      this.sharedGlobalVersionMongoId = null;
      
      // Re-render version history so button state updates
      await this.renderVersionHistory();
      
      alert('✅ Configuration unshared from Global successfully!\n\nIt is no longer visible to other companies.');
      
    } catch (err) {
      console.error('[CHEAT SHEET] ❌ Error unsharing from global', err);
      alert(`Failed to unshare: ${err.message}`);
      
      // Re-enable button on error
      if (unshareBtn) {
        unshareBtn.disabled = false;
        unshareBtn.style.cursor = 'pointer';
        unshareBtn.style.background = '#10b981';
        unshareBtn.textContent = '✓ Shared to Global';
      }
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // GLOBAL CONFIGURATIONS TAB (Import System)
  // ═══════════════════════════════════════════════════════════════════
  
  renderGlobalConfigsTab() {
    const container = document.getElementById('global-configs-tab');
    if (!container) return;
    
    const categories = this.globalCategories || [];
    
    // SECTION 1: Category Management (Admin)
    const categoryManagementHtml = `
      <div style="background: #f0f9ff; border: 2px solid #0ea5e9; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
          <div>
            <h4 style="font-size: 16px; font-weight: 700; color: #0369a1; margin: 0 0 4px 0;">
              🏷️ Category Management
            </h4>
            <p style="font-size: 12px; color: #0c4a6e; margin: 0;">
              Categories organize shared configurations by industry
            </p>
          </div>
          <button
            id="btn-create-category"
            style="
              padding: 8px 16px;
              font-size: 13px;
              font-weight: 600;
              border-radius: 8px;
              border: none;
              background: #0ea5e9;
              color: #ffffff;
              cursor: pointer;
              box-shadow: 0 2px 4px rgba(14, 165, 233, 0.3);
              transition: all 0.2s;
            "
            onmouseover="this.style.background='#0284c7'"
            onmouseout="this.style.background='#0ea5e9'"
          >
            ＋ Create Category
          </button>
        </div>
        
        ${categories.length > 0 ? `
          <div style="margin-top: 16px;">
            <div style="font-size: 12px; font-weight: 600; color: #0369a1; margin-bottom: 8px;">
              Existing Categories (${categories.length}):
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 8px;">
              ${categories.map(cat => `
                <span style="
                  display: inline-flex;
                  align-items: center;
                  padding: 6px 12px;
                  border-radius: 999px;
                  background: #ffffff;
                  border: 1px solid #0ea5e9;
                  color: #0369a1;
                  font-size: 12px;
                  font-weight: 600;
                ">
                  ${cat.name}
                </span>
              `).join('')}
            </div>
          </div>
        ` : `
          <div style="margin-top: 12px; padding: 12px; background: #fef3c7; border-left: 3px solid #f59e0b; border-radius: 4px;">
            <div style="font-size: 12px; color: #92400e; font-weight: 600;">
              ⚠️ No categories created yet
            </div>
            <div style="font-size: 11px; color: #78350f; margin-top: 4px;">
              Click "Create Category" to add your first industry category (e.g., HVAC, Plumbing, Dental)
            </div>
          </div>
        `}
      </div>
    `;
    
    // Handle empty categories case (but still show create button)
    if (categories.length === 0) {
      container.innerHTML = categoryManagementHtml + `
        <div style="padding:20px; background:#f9fafb; border:1px solid #e5e7eb; border-radius:8px; text-align:center;">
          <div style="font-size: 48px; margin-bottom: 12px;">📦</div>
          <div style="font-size:14px; color:#6b7280; font-weight: 600;">
            No Shared Configurations Yet
          </div>
          <div style="font-size:12px; color:#9ca3af; margin-top: 4px;">
            Create a category above, then companies can start sharing configurations
          </div>
        </div>
      `;
      
      // Wire create button
      this.wireCreateCategoryButton();
      
      console.warn('[CHEAT SHEET] ⚠️ No global categories found. Showing create interface.');
      return;
    }
    
    // Build category dropdown
    const categoryOptionsHtml = categories
      .map((c) => `<option value="${c._id}">${c.name}</option>`)
      .join('');
    
    container.innerHTML = categoryManagementHtml + `
      <div style="background: #ffffff; border: 2px solid #e5e7eb; border-radius: 12px; padding: 20px;">
        <h4 style="font-size: 16px; font-weight: 700; color: #111827; margin: 0 0 16px 0;">
          🌍 Browse Shared Configurations
        </h4>
        
        <div style="margin-bottom: 24px;">
          <label for="global-category-select" style="display:block; font-size:13px; font-weight:600; color:#374151; margin-bottom:8px;">
            Select Category to View
          </label>
          <select
            id="global-category-select"
            style="
              padding:8px 12px;
              border-radius:4px;
              border:1px solid #d1d5db;
              font-size:13px;
              color:#111827;
              background:#fff;
              min-width:220px;
            "
          >
            <option value="">-- Select category --</option>
            ${categoryOptionsHtml}
          </select>
        </div>
        
        <div id="global-configs-content" style="margin-top:16px;">
          <div style="font-size:13px; color:#6b7280; padding:20px; text-align:center; background:#f9fafb; border-radius:8px;">
            Select a category above to view shared configurations.
          </div>
        </div>
      </div>
    `;
    
    const selectEl = container.querySelector('#global-category-select');
    if (selectEl) {
      selectEl.addEventListener('change', async () => {
        const categoryId = selectEl.value;
        if (categoryId) {
          this.currentGlobalCategoryId = categoryId; // Track selected category
          await this.loadGlobalConfigsByCategory(categoryId);
          this.renderGlobalConfigCards();
        } else {
          this.currentGlobalCategoryId = null;
          // Reset to empty state
          const contentEl = container.querySelector('#global-configs-content');
          if (contentEl) {
            contentEl.innerHTML = `
              <div style="font-size:13px; color:#6b7280; padding:20px; text-align:center; background:#f9fafb; border-radius:8px;">
                Select a category above to view shared configurations.
              </div>
            `;
          }
        }
      });
    }
    
    // Wire create category button
    this.wireCreateCategoryButton();
  }
  
  wireCreateCategoryButton() {
    const container = document.getElementById('global-configs-tab');
    if (!container) return;
    
    const btn = container.querySelector('#btn-create-category');
    if (btn) {
      btn.addEventListener('click', () => this.showCreateCategoryModal());
    }
  }
  
  showCreateCategoryModal() {
    const modalHtml = `
      <div id="create-category-modal" style="
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.75);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        animation: fadeIn 0.2s ease-out;
      ">
        <div style="
          background: #ffffff;
          border-radius: 12px;
          width: 90%;
          max-width: 500px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          animation: slideUp 0.3s ease-out;
        ">
          <!-- Header -->
          <div style="
            padding: 24px 24px 16px;
            border-bottom: 1px solid #e5e7eb;
          ">
            <h2 style="margin: 0; font-size: 20px; font-weight: 600; color: #111827;">
              🏷️ Create Global Category
            </h2>
            <p style="margin: 8px 0 0 0; font-size: 13px; color: #6b7280;">
              Categories organize shared configurations by industry
            </p>
          </div>
          
          <!-- Form Body -->
          <div style="padding: 24px;">
            <form id="create-category-form">
              <div style="margin-bottom: 20px;">
                <label style="display: block; font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px;">
                  Category Name *
                </label>
                <input 
                  type="text" 
                  id="category-name-input" 
                  placeholder="e.g., HVAC, Plumbing, Dental, Legal"
                  required
                  style="
                    width: 100%;
                    padding: 10px 12px;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    font-size: 14px;
                    font-family: inherit;
                  "
                />
                <div style="margin-top: 6px; font-size: 11px; color: #6b7280;">
                  💡 Examples: HVAC, Plumbing, Dental, Legal, Roofing, Landscaping
                </div>
              </div>
            </form>
          </div>
          
          <!-- Footer -->
          <div style="
            padding: 16px 24px;
            background: #f9fafb;
            border-top: 1px solid #e5e7eb;
            display: flex;
            justify-content: flex-end;
            gap: 12px;
            border-radius: 0 0 12px 12px;
          ">
            <button
              id="btn-cancel-category"
              type="button"
              style="
                padding: 8px 16px;
                font-size: 13px;
                font-weight: 500;
                border-radius: 6px;
                border: 1px solid #d1d5db;
                background: #ffffff;
                color: #374151;
                cursor: pointer;
              "
            >
              Cancel
            </button>
            <button
              id="btn-save-category"
              type="submit"
              style="
                padding: 8px 16px;
                font-size: 13px;
                font-weight: 600;
                border-radius: 6px;
                border: none;
                background: #0ea5e9;
                color: #ffffff;
                cursor: pointer;
                box-shadow: 0 2px 4px rgba(14, 165, 233, 0.3);
              "
            >
              Create Category
            </button>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // Focus input
    const input = document.getElementById('category-name-input');
    if (input) input.focus();
    
    // Wire cancel button
    const btnCancel = document.getElementById('btn-cancel-category');
    if (btnCancel) {
      btnCancel.addEventListener('click', () => {
        const modal = document.getElementById('create-category-modal');
        if (modal) modal.remove();
      });
    }
    
    // Wire save button
    const btnSave = document.getElementById('btn-save-category');
    if (btnSave) {
      btnSave.addEventListener('click', async (e) => {
        e.preventDefault();
        await this.handleCreateCategory();
      });
    }
    
    // Wire form submit
    const form = document.getElementById('create-category-form');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleCreateCategory();
      });
    }
  }
  
  async handleCreateCategory() {
    const input = document.getElementById('category-name-input');
    if (!input) return;
    
    const name = input.value.trim();
    if (!name) {
      alert('Please enter a category name');
      return;
    }
    
    try {
      const response = await fetch('/api/global-config/categories', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('adminToken')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }
      
      const result = await response.json();
      console.log('[CHEAT SHEET] ✅ Category created:', result.data);
      
      // Refresh global categories
      await this.loadGlobalCategories();
      
      // Close modal
      const modal = document.getElementById('create-category-modal');
      if (modal) modal.remove();
      
      // Re-render Global tab
      this.renderGlobalConfigsTab();
      
      // ALSO refresh the category selector in Local tab
      this.renderCategorySelectorBlock();
      
      alert(`✅ Category "${name}" created successfully!\n\nYou can now:\n• Select this category in the "Local Configurations" tab\n• Share your live configuration to global after locking the category`);
      
    } catch (error) {
      console.error('[CHEAT SHEET] ❌ Error creating category:', error);
      alert(`Failed to create category: ${error.message}`);
    }
  }
  
  async loadGlobalConfigsByCategory(categoryId) {
    if (!categoryId) {
      console.error('[CHEAT SHEET] Cannot load global configs – categoryId is missing');
      this.globalConfigs = [];
      return;
    }
    
    try {
      console.log('[CHEAT SHEET] 🔄 Loading global configs for category:', categoryId);
      
      const response = await fetch(`/api/global-config?categoryId=${encodeURIComponent(categoryId)}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('adminToken')}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        console.error('[CHEAT SHEET] ❌ Failed to load global configs', {
          status: response.status,
          categoryId
        });
        this.globalConfigs = [];
        return;
      }
      
      const result = await response.json();
      if (!result || !result.success) {
        console.error('[CHEAT SHEET] ❌ Global configs response not successful', result);
        this.globalConfigs = [];
        return;
      }
      
      this.globalConfigs = Array.isArray(result.data) ? result.data : [];
      console.log('[CHEAT SHEET] ✅ Global configs loaded:', {
        categoryId,
        count: this.globalConfigs.length,
        configs: this.globalConfigs.map(c => ({
          id: c.globalConfigId,
          company: c.companyName,
          name: c.configName
        }))
      });
    } catch (err) {
      console.error('[CHEAT SHEET] ❌ Error loading global configs', err);
      this.globalConfigs = [];
    }
  }
  
  renderGlobalConfigCards() {
    const container = document.getElementById('global-configs-tab');
    if (!container) return;
    
    const contentEl = container.querySelector('#global-configs-content');
    if (!contentEl) return;
    
    const configs = this.globalConfigs || [];
    
    // Empty state
    if (configs.length === 0) {
      contentEl.innerHTML = `
        <div style="font-size:13px; color:#6b7280; padding:20px; text-align:center; background:#f9fafb; border-radius:8px;">
          No shared configurations exist for this category yet.
        </div>
      `;
      return;
    }
    
    // Render stacked cards
    const cardsHtml = configs.map((config) => {
      const updatedDate = new Date(config.updatedAt);
      const formattedDate = updatedDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      // Find category name
      const category = (this.globalCategories || []).find(c => c._id === this.currentGlobalCategoryId);
      const categoryName = category ? category.name : 'Unknown';
      
      return `
        <div style="
          border:1px solid #e5e7eb;
          border-radius:8px;
          padding:16px;
          background:#ffffff;
          box-shadow:0 1px 3px rgba(0,0,0,0.05);
        ">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px;">
            <div style="flex:1;">
              <div style="margin-bottom:8px;">
                <span style="
                  display:inline-block;
                  padding:2px 8px;
                  border-radius:999px;
                  font-size:11px;
                  font-weight:600;
                  background:#eff6ff;
                  color:#1e40af;
                ">
                  ${categoryName}
                </span>
              </div>
              
              <h4 style="font-size:16px; font-weight:600; color:#111827; margin:0 0 4px 0;">
                ${config.configName || 'Unnamed Configuration'}
              </h4>
              
              <div style="font-size:13px; color:#6b7280; margin-bottom:4px;">
                <span style="font-weight:500;">Source:</span> ${config.companyName || 'Unknown Company'}
              </div>
              
              <div style="font-size:12px; color:#9ca3af;">
                Last updated: ${formattedDate}
              </div>
            </div>
            
            <button
              type="button"
              class="import-global-btn"
              data-global-config-id="${config.globalConfigId}"
              style="
                padding:6px 12px;
                border-radius:4px;
                border:none;
                font-size:12px;
                font-weight:500;
                background:#111827;
                color:#ffffff;
                cursor:pointer;
                white-space:nowrap;
              "
              onmouseover="this.style.background='#374151'"
              onmouseout="this.style.background='#111827'"
            >
              Import as Draft
            </button>
          </div>
        </div>
      `;
    }).join('');
    
    contentEl.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:12px;">
        ${cardsHtml}
      </div>
    `;
    
    // Wire up import buttons - SHOW PREVIEW FIRST
    const importButtons = contentEl.querySelectorAll('.import-global-btn');
    importButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const globalConfigId = btn.getAttribute('data-global-config-id');
        if (globalConfigId) {
          // Find the config data
          const configData = this.globalConfigs.find(c => c.globalConfigId === globalConfigId);
          if (configData) {
            this.showImportPreviewModal(configData);
          }
        }
      });
    });
  }
  
  showImportPreviewModal(configData) {
    // Fetch the actual config details to show preview
    const modalHtml = `
      <div id="import-preview-modal" style="
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.75);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        animation: fadeIn 0.2s ease-out;
      ">
        <div style="
          background: #ffffff;
          border-radius: 12px;
          width: 90%;
          max-width: 700px;
          max-height: 80vh;
          overflow: hidden;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          animation: slideUp 0.3s ease-out;
          display: flex;
          flex-direction: column;
        ">
          <!-- Header -->
          <div style="
            padding: 24px 24px 16px;
            border-bottom: 1px solid #e5e7eb;
            background: #f0f9ff;
          ">
            <h2 style="margin: 0; font-size: 20px; font-weight: 600; color: #0369a1;">
              📦 Import Configuration Preview
            </h2>
            <p style="margin: 8px 0 0 0; font-size: 13px; color: #0c4a6e;">
              Review this shared configuration before importing as a new draft
            </p>
          </div>
          
          <!-- Body (scrollable) -->
          <div style="
            padding: 24px;
            overflow-y: auto;
            flex: 1;
          ">
            <!-- Source Info -->
            <div style="
              background: #ecfdf3;
              border: 2px solid #10b981;
              border-radius: 8px;
              padding: 16px;
              margin-bottom: 20px;
            ">
              <div style="font-size: 12px; font-weight: 600; color: #065f46; text-transform: uppercase; margin-bottom: 8px;">
                Source Company
              </div>
              <div style="font-size: 16px; font-weight: 700; color: #047857; margin-bottom: 4px;">
                ${configData.companyName}
              </div>
              <div style="font-size: 13px; color: #059669;">
                <strong>Config Name:</strong> ${configData.configName}
              </div>
              <div style="font-size: 12px; color: #10b981; margin-top: 6px;">
                <strong>Last Updated:</strong> ${new Date(configData.updatedAt).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </div>
            </div>
            
            <!-- What Happens -->
            <div style="
              background: #fef3c7;
              border-left: 4px solid #f59e0b;
              padding: 16px;
              margin-bottom: 20px;
              border-radius: 4px;
            ">
              <div style="font-size: 13px; font-weight: 600; color: #92400e; margin-bottom: 8px;">
                📋 What will happen:
              </div>
              <ul style="margin: 0; padding-left: 20px; font-size: 12px; color: #78350f; line-height: 1.8;">
                <li>A <strong>new draft</strong> will be created for your company</li>
                <li>The draft will contain a <strong>copy</strong> of this configuration</li>
                <li>Your current live configuration will <strong>not</strong> be affected</li>
                <li>You can edit the draft before going live</li>
                <li>No ongoing link to the source company</li>
              </ul>
            </div>
            
            <!-- Loading indicator for config details -->
            <div id="import-preview-loading" style="
              padding: 20px;
              text-align: center;
              color: #6b7280;
              font-size: 13px;
            ">
              <div style="font-size: 32px; margin-bottom: 8px;">⏳</div>
              Loading configuration details...
            </div>
            
            <!-- Config details (will be loaded) -->
            <div id="import-preview-details" style="display: none;">
              <!-- Will be populated dynamically -->
            </div>
          </div>
          
          <!-- Footer -->
          <div style="
            padding: 16px 24px;
            background: #f9fafb;
            border-top: 1px solid #e5e7eb;
            display: flex;
            justify-content: space-between;
            align-items: center;
          ">
            <button
              id="btn-cancel-import"
              type="button"
              style="
                padding: 8px 16px;
                font-size: 13px;
                font-weight: 500;
                border-radius: 6px;
                border: 1px solid #d1d5db;
                background: #ffffff;
                color: #374151;
                cursor: pointer;
              "
            >
              Cancel
            </button>
            <button
              id="btn-confirm-import"
              type="button"
              style="
                padding: 10px 20px;
                font-size: 14px;
                font-weight: 600;
                border-radius: 6px;
                border: none;
                background: #10b981;
                color: #ffffff;
                cursor: pointer;
                box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3);
              "
              onmouseover="this.style.background='#059669'"
              onmouseout="this.style.background='#10b981'"
            >
              ✅ Import as Draft
            </button>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // Load config details asynchronously
    this.loadImportPreviewDetails(configData);
    
    // Wire cancel button
    const btnCancel = document.getElementById('btn-cancel-import');
    if (btnCancel) {
      btnCancel.addEventListener('click', () => {
        const modal = document.getElementById('import-preview-modal');
        if (modal) modal.remove();
      });
    }
    
    // Wire confirm button
    const btnConfirm = document.getElementById('btn-confirm-import');
    if (btnConfirm) {
      btnConfirm.addEventListener('click', async () => {
        btnConfirm.disabled = true;
        btnConfirm.textContent = 'Importing...';
        btnConfirm.style.cursor = 'wait';
        btnConfirm.style.background = '#9ca3af';
        
        await this.importFromGlobal(configData.globalConfigId, null);
        
        // Close modal
        const modal = document.getElementById('import-preview-modal');
        if (modal) modal.remove();
        
        // Show success message
        alert('✅ Configuration imported successfully as a new draft!');
      });
    }
  }
  
  async loadImportPreviewDetails(configData) {
    const loadingEl = document.getElementById('import-preview-loading');
    const detailsEl = document.getElementById('import-preview-details');
    
    if (!loadingEl || !detailsEl) return;
    
    try {
      // Fetch the actual version config to show stats
      const response = await fetch(`/api/cheatsheet/versions/${configData.cheatSheetVersionId}?includeConfig=true`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('adminToken')}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) throw new Error('Failed to load config details');
      
      const result = await response.json();
      const config = result.data?.config || {};
      
      // Calculate stats
      const stats = {
        triageCards: (config.triageCards || []).length,
        transferRules: (config.transferRules || []).length,
        edgeCases: (config.edgeCases || []).length,
        bookingRules: (config.bookingRules || []).length,
        companyContacts: (config.companyContacts || []).length,
        links: (config.links || []).length,
        calculators: (config.calculators || []).length
      };
      
      const totalRules = Object.values(stats).reduce((sum, val) => sum + val, 0);
      
      // Render stats
      detailsEl.innerHTML = `
        <div style="
          background: #ffffff;
          border: 2px solid #e5e7eb;
          border-radius: 8px;
          padding: 16px;
        ">
          <div style="font-size: 13px; font-weight: 600; color: #111827; margin-bottom: 12px;">
            📊 Configuration Contents:
          </div>
          
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
            <div style="padding: 10px; background: #f9fafb; border-radius: 6px;">
              <div style="font-size: 20px; font-weight: 700; color: #0ea5e9;">${totalRules}</div>
              <div style="font-size: 11px; color: #6b7280; text-transform: uppercase;">Total Rules</div>
            </div>
            
            ${stats.bookingRules > 0 ? `
              <div style="padding: 10px; background: #f0f9ff; border-radius: 6px;">
                <div style="font-size: 20px; font-weight: 700; color: #0369a1;">${stats.bookingRules}</div>
                <div style="font-size: 11px; color: #0c4a6e;">📅 Booking Rules</div>
              </div>
            ` : ''}
            
            ${stats.companyContacts > 0 ? `
              <div style="padding: 10px; background: #ecfdf3; border-radius: 6px;">
                <div style="font-size: 20px; font-weight: 700; color: #065f46;">${stats.companyContacts}</div>
                <div style="font-size: 11px; color: #047857;">👥 Company Contacts</div>
              </div>
            ` : ''}
            
            ${stats.triageCards > 0 ? `
              <div style="padding: 10px; background: #fef3c7; border-radius: 6px;">
                <div style="font-size: 20px; font-weight: 700; color: #92400e;">${stats.triageCards}</div>
                <div style="font-size: 11px; color: #78350f;">🎯 Triage Cards</div>
              </div>
            ` : ''}
            
            ${stats.transferRules > 0 ? `
              <div style="padding: 10px; background: #fef3c7; border-radius: 6px;">
                <div style="font-size: 20px; font-weight: 700; color: #92400e;">${stats.transferRules}</div>
                <div style="font-size: 11px; color: #78350f;">📞 Transfer Rules</div>
              </div>
            ` : ''}
            
            ${stats.links > 0 ? `
              <div style="padding: 10px; background: #f0f9ff; border-radius: 6px;">
                <div style="font-size: 20px; font-weight: 700; color: #0369a1;">${stats.links}</div>
                <div style="font-size: 11px; color: #0c4a6e;">🔗 Links</div>
              </div>
            ` : ''}
            
            ${stats.calculators > 0 ? `
              <div style="padding: 10px; background: #ecfdf3; border-radius: 6px;">
                <div style="font-size: 20px; font-weight: 700; color: #065f46;">${stats.calculators}</div>
                <div style="font-size: 11px; color: #047857;">🧮 Calculators</div>
              </div>
            ` : ''}
          </div>
        </div>
      `;
      
      loadingEl.style.display = 'none';
      detailsEl.style.display = 'block';
      
    } catch (error) {
      console.error('[CHEAT SHEET] Failed to load import preview details:', error);
      loadingEl.innerHTML = `
        <div style="color: #dc2626; font-size: 13px;">
          ⚠️ Could not load configuration details
        </div>
      `;
    }
  }
  
  async importFromGlobal(globalConfigId, buttonElement) {
    if (!this.companyId) {
      console.error('[CHEAT SHEET] Cannot import from global – companyId is missing');
      return;
    }
    
    if (!globalConfigId) {
      console.error('[CHEAT SHEET] Cannot import from global – globalConfigId is missing');
      return;
    }
    
    // Disable button during POST
    if (buttonElement) {
      buttonElement.disabled = true;
      buttonElement.style.cursor = 'wait';
      buttonElement.style.background = '#9ca3af';
      buttonElement.textContent = 'Importing...';
    }
    
    try {
      console.log('[CHEAT SHEET] 🔄 Importing global config:', {
        targetCompanyId: this.companyId,
        globalConfigId
      });
      
      const response = await fetch('/api/global-config/import', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('adminToken')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          targetCompanyId: this.companyId,
          globalConfigId
        })
      });
      
      const result = await response.json();
      
      if (!response.ok || !result || !result.success) {
        console.error('[CHEAT SHEET] ❌ Failed to import from global', {
          status: response.status,
          result
        });
        
        // Re-enable button on failure
        if (buttonElement) {
          buttonElement.disabled = false;
          buttonElement.style.cursor = 'pointer';
          buttonElement.style.background = '#111827';
          buttonElement.textContent = 'Import as Draft';
        }
        return;
      }
      
      console.log('[CHEAT SHEET] ✅ Config imported successfully as draft:', {
        newDraftId: result.data.cheatSheetVersionId,
        targetCompanyId: result.data.companyId
      });
      
      // Re-render version history so Local tab shows new draft
      await this.renderVersionHistory();
      
      // Note: Button will be replaced by re-render, so no need to re-enable
    } catch (err) {
      console.error('[CHEAT SHEET] ❌ Error importing from global', err);
      
      // Re-enable button on error
      if (buttonElement) {
        buttonElement.disabled = false;
        buttonElement.style.cursor = 'pointer';
        buttonElement.style.background = '#111827';
        buttonElement.textContent = 'Import as Draft';
      }
    }
  }
  
  initVersionHistorySubtabs() {
    const container = document.getElementById('cheatsheet-v2-dynamic-content');
    if (!container) return;
    
    const buttons = container.querySelectorAll('.version-subtab-btn');
    const panels = container.querySelectorAll('.version-subtab-content');
    
    if (!buttons.length || !panels.length) return;
    
    const setActiveTab = (tabName) => {
      // Update buttons
      buttons.forEach((btn) => {
        const isActive = btn.getAttribute('data-tab') === tabName;
        if (isActive) {
          btn.classList.add('active');
          btn.style.color = '#1976d2';
          btn.style.fontWeight = '600';
          btn.style.borderBottom = '2px solid #1976d2';
        } else {
          btn.classList.remove('active');
          btn.style.color = '#6b7280';
          btn.style.fontWeight = '500';
          btn.style.borderBottom = '2px solid transparent';
        }
      });
      
      // Update panels
      panels.forEach((panel) => {
        const isActive = panel.getAttribute('data-tab') === tabName;
        panel.style.display = isActive ? '' : 'none';
      });
      
      // Trigger Global tab rendering when switched to
      if (tabName === 'global') {
        this.renderGlobalConfigsTab();
      }
    };
    
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const tabName = btn.getAttribute('data-tab');
        setActiveTab(tabName);
      });
    });
    
    // Ensure Local is active by default
    setActiveTab('local');
    
    // Wire info button
    const infoBtn = container.querySelector('#btn-local-config-info');
    if (infoBtn) {
      infoBtn.addEventListener('click', () => this.showLocalConfigInfoModal());
    }
  }
  
  showLocalConfigInfoModal() {
    const modalHtml = `
      <div id="local-config-info-modal" style="
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.75);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        animation: fadeIn 0.2s ease-out;
      ">
        <div style="
          background: #ffffff;
          border-radius: 12px;
          width: 90%;
          max-width: 800px;
          max-height: 85vh;
          overflow-y: auto;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          animation: slideUp 0.3s ease-out;
        ">
          <!-- Header -->
          <div style="
            padding: 24px 24px 16px;
            border-bottom: 1px solid #e5e7eb;
            background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
            border-radius: 12px 12px 0 0;
          ">
            <h2 style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff;">
              ℹ️ How Configuration Versions Work
            </h2>
            <p style="margin: 8px 0 0 0; font-size: 13px; color: #f0f9ff;">
              Understanding drafts, live versions, and what gets saved
            </p>
          </div>
          
          <!-- Body -->
          <div style="padding: 24px;">
            
            <!-- What Gets Saved Section -->
            <div style="margin-bottom: 24px;">
              <h3 style="font-size: 18px; font-weight: 700; color: #111827; margin: 0 0 12px 0;">
                📋 What Gets Saved in Each Version
              </h3>
              <div style="background: #f0f9ff; border-left: 4px solid #0ea5e9; padding: 16px; border-radius: 4px; margin-bottom: 12px;">
                <div style="font-size: 14px; color: #0c4a6e; line-height: 1.6;">
                  Each configuration version saves a <strong>complete snapshot</strong> of all your AI Agent settings:
                </div>
              </div>
              
              <div style="display: grid; gap: 12px; margin-top: 16px;">
                <!-- V2 Structured Tabs -->
                <div style="background: #ecfdf3; border: 1px solid #10b981; border-radius: 8px; padding: 12px;">
                  <div style="font-size: 13px; font-weight: 600; color: #065f46; margin-bottom: 6px;">
                    📅 <strong>V2 Structured Tabs:</strong>
                  </div>
                  <ul style="margin: 4px 0 0 20px; padding: 0; font-size: 12px; color: #047857; line-height: 1.8;">
                    <li><strong>Booking Rules</strong> - Hours, days, same-day, weekend settings</li>
                    <li><strong>Company Contacts</strong> - Names, roles, phone, email, hours</li>
                    <li><strong>Links</strong> - Payment portals, maps, catalogs, FAQs</li>
                    <li><strong>Calculators</strong> - Pricing formulas, estimates, units</li>
                  </ul>
                </div>
                
                <!-- V1 Legacy Tabs -->
                <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 12px;">
                  <div style="font-size: 13px; font-weight: 600; color: #92400e; margin-bottom: 6px;">
                    📝 <strong>V1 Legacy Tabs:</strong>
                  </div>
                  <ul style="margin: 4px 0 0 20px; padding: 0; font-size: 12px; color: #78350f; line-height: 1.8;">
                    <li><strong>Triage Cards</strong> - Free-form scenario rules</li>
                    <li><strong>Frontline Intel</strong> - Company knowledge, context</li>
                    <li><strong>Transfer Rules</strong> - When/who to transfer to</li>
                    <li><strong>Edge Cases</strong> - Unusual scenarios, exceptions</li>
                    <li><strong>Behavior Guidelines</strong> - Tone, style, constraints</li>
                    <li><strong>Guardrails</strong> - Never say, always avoid</li>
                  </ul>
                </div>
              </div>
            </div>
            
            <!-- Version Workflow Section -->
            <div style="margin-bottom: 24px;">
              <h3 style="font-size: 18px; font-weight: 700; color: #111827; margin: 0 0 12px 0;">
                🔄 Version Workflow
              </h3>
              
              <div style="display: flex; flex-direction: column; gap: 12px;">
                <!-- Draft -->
                <div style="background: #fef3c7; border: 2px solid #f59e0b; border-radius: 8px; padding: 14px;">
                  <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                    <span style="font-size: 20px;">✏️</span>
                    <div style="font-size: 15px; font-weight: 700; color: #92400e;">DRAFT</div>
                  </div>
                  <div style="font-size: 12px; color: #78350f; line-height: 1.6;">
                    • Work in progress - not visible to AI Agent<br>
                    • Edit any tab - all changes saved to this draft<br>
                    • Review, test, and perfect before going live<br>
                    • Can have multiple drafts, but only edit one at a time
                  </div>
                </div>
                
                <!-- Live -->
                <div style="background: #ecfdf3; border: 2px solid #10b981; border-radius: 8px; padding: 14px;">
                  <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                    <span style="font-size: 20px;">🔴</span>
                    <div style="font-size: 15px; font-weight: 700; color: #065f46;">LIVE</div>
                  </div>
                  <div style="font-size: 12px; color: #047857; line-height: 1.6;">
                    • Currently active - AI Agent uses this configuration<br>
                    • Read-only - cannot edit live version directly<br>
                    • Only one live version at a time<br>
                    • Previous live version auto-archived when new one published
                  </div>
                </div>
                
                <!-- Archived -->
                <div style="background: #f3f4f6; border: 2px solid #9ca3af; border-radius: 8px; padding: 14px;">
                  <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                    <span style="font-size: 20px;">📦</span>
                    <div style="font-size: 15px; font-weight: 700; color: #4b5563;">ARCHIVED</div>
                  </div>
                  <div style="font-size: 12px; color: #6b7280; line-height: 1.6;">
                    • Historical versions - safe backup<br>
                    • Read-only - preserved for reference<br>
                    • Restore as Draft - create copy to edit<br>
                    • ⚡ Restore as LIVE - emergency rollback (instant)
                  </div>
                </div>
              </div>
            </div>
            
            <!-- Key Points Section -->
            <div style="background: #f0f9ff; border: 2px solid #0ea5e9; border-radius: 8px; padding: 16px;">
              <h4 style="font-size: 14px; font-weight: 700; color: #0369a1; margin: 0 0 10px 0;">
                💡 Key Points to Remember
              </h4>
              <ul style="margin: 0; padding-left: 20px; font-size: 12px; color: #0c4a6e; line-height: 1.8;">
                <li><strong>All tabs saved together</strong> - Each version is a complete snapshot</li>
                <li><strong>Edit in workspace</strong> - Select a draft version in Version Console</li>
                <li><strong>Always save</strong> - Click "💾 Save" before "🚀 Go Live"</li>
                <li><strong>Test before live</strong> - Drafts are your safe testing environment</li>
                <li><strong>Keep history</strong> - Archived versions = rollback safety net</li>
              </ul>
            </div>
            
          </div>
          
          <!-- Footer -->
          <div style="
            padding: 16px 24px;
            background: #f9fafb;
            border-top: 1px solid #e5e7eb;
            display: flex;
            justify-content: flex-end;
            border-radius: 0 0 12px 12px;
          ">
            <button
              id="btn-close-info-modal"
              type="button"
              style="
                padding: 10px 20px;
                font-size: 14px;
                font-weight: 600;
                border-radius: 6px;
                border: none;
                background: #0ea5e9;
                color: #ffffff;
                cursor: pointer;
                box-shadow: 0 2px 4px rgba(14, 165, 233, 0.3);
              "
            >
              Got it! ✓
            </button>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // Wire close button
    const btnClose = document.getElementById('btn-close-info-modal');
    if (btnClose) {
      btnClose.addEventListener('click', () => {
        const modal = document.getElementById('local-config-info-modal');
        if (modal) modal.remove();
      });
    }
    
    // Close on background click
    const modal = document.getElementById('local-config-info-modal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.remove();
        }
      });
    }
  }
  
  renderVersionCard(version, index) {
    const card = document.createElement('div');
    
    // Determine status color and icon
    const statusConfig = {
      'live': { color: '#10b981', bg: '#d1fae5', icon: '🔴', label: 'LIVE' },
      'draft': { color: '#f59e0b', bg: '#fef3c7', icon: '✏️', label: 'DRAFT' },
      'archived': { color: '#6b7280', bg: '#f3f4f6', icon: '📦', label: 'ARCHIVED' }
    };
    
    const status = statusConfig[version.status] || statusConfig['archived'];
    
    // Format timestamp
    const timestamp = version.activatedAt || version.createdAt;
    const date = new Date(timestamp);
    const formattedDate = date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    // Calculate quick stats from config
    const config = version.config || {};
    const stats = {
      triageCards: (config.triageCards || []).length,
      transferRules: (config.transferRules || []).length,
      edgeCases: (config.edgeCases || []).length,
      bookingRules: (config.bookingRules || []).length,
      companyContacts: (config.companyContacts || []).length,
      links: (config.links || []).length,
      calculators: (config.calculators || []).length
    };
    
    const totalRules = Object.values(stats).reduce((sum, val) => sum + val, 0);
    
    card.style.cssText = 'border: 2px solid #e5e7eb; border-radius: 12px; padding: 20px; background: #ffffff; box-shadow: 0 2px 4px rgba(0,0,0,0.05); transition: all 0.2s; cursor: pointer;';
    card.setAttribute('data-version-id', version.versionId);
    
    // Hover effect
    card.onmouseenter = () => {
      card.style.borderColor = '#0ea5e9';
      card.style.boxShadow = '0 4px 12px rgba(14, 165, 233, 0.2)';
    };
    card.onmouseleave = () => {
      card.style.borderColor = '#e5e7eb';
      card.style.boxShadow = '0 2px 4px rgba(0,0,0,0.05)';
    };
    
    card.innerHTML = `
      <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 20px;">
        
        <!-- Left: Version Info -->
        <div style="flex: 1;">
          
          <!-- Top Row: Name + Status Badge -->
          <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
            <h4 style="font-size: 18px; font-weight: 600; color: #111827; margin: 0;">
              ${version.name}
            </h4>
            <span style="padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: ${status.color}; background: ${status.bg};">
              ${status.icon} ${status.label}
            </span>
            ${version.status === 'live' && this.hasSharedGlobalConfig ? `
              <span style="
                display:inline-flex;
                align-items:center;
                padding:4px 10px;
                border-radius:999px;
                font-size:11px;
                font-weight:600;
                background:#ecfdf3;
                color:#166534;
              ">
                🌍 Shared to Global
              </span>
            ` : ''}
          </div>
          
          <!-- Version ID + Timestamps -->
          <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 12px; flex-wrap: wrap;">
            <div style="font-size: 12px; color: #6b7280;">
              <span style="font-weight: 600;">Version:</span>
              <code style="font-family: 'Monaco', 'Courier New', monospace; background: #f3f4f6; padding: 2px 6px; border-radius: 4px; margin-left: 4px;">
                ${version.versionId.substring(0, 12)}...
              </code>
            </div>
            <div style="font-size: 12px; color: #6b7280;">
              <span style="font-weight: 600;">Created:</span> ${formattedDate}
            </div>
            ${version.updatedAt && new Date(version.updatedAt).getTime() !== new Date(version.createdAt).getTime() ? `
              <div style="font-size: 12px; color: #0369a1; font-weight: 600;">
                <span style="font-weight: 700;">Last Updated:</span> ${new Date(version.updatedAt).toLocaleDateString('en-US', { 
                  month: 'short', 
                  day: 'numeric', 
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </div>
            ` : ''}
            ${version.createdBy ? `
              <div style="font-size: 12px; color: #6b7280;">
                <span style="font-weight: 600;">By:</span> ${version.createdBy}
              </div>
            ` : ''}
          </div>
          
          <!-- Quick Stats -->
          <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
            <span style="font-size: 13px; color: #6b7280; font-weight: 600;">
              📊 ${totalRules} Total Rules
            </span>
            ${stats.triageCards > 0 ? `<span style="font-size: 12px; color: #6b7280;">🎯 ${stats.triageCards} Triage</span>` : ''}
            ${stats.transferRules > 0 ? `<span style="font-size: 12px; color: #6b7280;">📞 ${stats.transferRules} Transfer</span>` : ''}
            ${stats.edgeCases > 0 ? `<span style="font-size: 12px; color: #6b7280;">⚠️ ${stats.edgeCases} Edge Cases</span>` : ''}
            ${stats.bookingRules > 0 ? `<span style="font-size: 12px; color: #6b7280;">📅 ${stats.bookingRules} Booking</span>` : ''}
            ${stats.companyContacts > 0 ? `<span style="font-size: 12px; color: #6b7280;">👥 ${stats.companyContacts} Contacts</span>` : ''}
          </div>
          
          <!-- Notes (if any) -->
          ${version.notes ? `
            <div style="margin-top: 12px; padding: 10px 12px; background: #f0f9ff; border-left: 3px solid #0ea5e9; border-radius: 4px;">
              <div style="font-size: 12px; color: #0369a1; line-height: 1.5;">
                ${version.notes}
              </div>
            </div>
          ` : ''}
          
        </div>
        
        <!-- Right: Action Buttons -->
        <div style="display: flex; flex-direction: column; gap: 8px; min-width: 120px;">
          
          <button 
            onclick="cheatSheetManager.viewVersionDetail('${version.versionId}')"
            style="padding: 8px 16px; font-size: 13px; font-weight: 500; border-radius: 6px; border: 1px solid #0ea5e9; background: #ffffff; color: #0ea5e9; cursor: pointer; transition: all 0.2s; text-align: center;"
            onmouseover="this.style.background='#f0f9ff'" 
            onmouseout="this.style.background='#ffffff'"
          >
            👁️ View
          </button>
          
          <button 
            class="js-cs-version-edit"
            data-version-id="${version.versionId}"
            style="padding: 8px 16px; font-size: 13px; font-weight: 600; border-radius: 6px; border: none; background: #3b82f6; color: #ffffff; cursor: pointer; transition: all 0.2s; text-align: center; box-shadow: 0 2px 4px rgba(59, 130, 246, 0.3);"
            onmouseover="this.style.background='#2563eb'" 
            onmouseout="this.style.background='#3b82f6'"
          >
            ✏️ Edit in Workspace
          </button>
          
          ${version.status === 'archived' ? `
            <button 
              onclick="cheatSheetManager.restoreVersion('${version.versionId}', '${version.name}')"
              style="padding: 8px 16px; font-size: 13px; font-weight: 500; border-radius: 6px; border: 1px solid #10b981; background: #ffffff; color: #10b981; cursor: pointer; transition: all 0.2s; text-align: center;"
              onmouseover="this.style.background='#d1fae5'" 
              onmouseout="this.style.background='#ffffff'"
            >
              🔄 Restore as Draft
            </button>
            
            <button 
              onclick="cheatSheetManager.restoreAsLive('${version.versionId}', '${version.name}')"
              style="padding: 8px 16px; font-size: 13px; font-weight: 600; border-radius: 6px; border: none; background: #f59e0b; color: #ffffff; cursor: pointer; transition: all 0.2s; text-align: center; box-shadow: 0 2px 6px rgba(245, 158, 11, 0.4);"
              onmouseover="this.style.background='#d97706'" 
              onmouseout="this.style.background='#f59e0b'"
              title="Emergency rollback - Restore this version as LIVE immediately"
            >
              ⚡ Restore as LIVE
            </button>
            
            <button 
              onclick="cheatSheetManager.deleteVersion('${version.versionId}', '${version.name}')"
              style="padding: 8px 16px; font-size: 13px; font-weight: 500; border-radius: 6px; border: 1px solid #ef4444; background: #ffffff; color: #ef4444; cursor: pointer; transition: all 0.2s; text-align: center;"
              onmouseover="this.style.background='#fef2f2'" 
              onmouseout="this.style.background='#ffffff'"
            >
              🗑️ Delete
            </button>
          ` : version.status === 'live' ? `
            <div style="padding: 8px 12px; font-size: 12px; text-align: center; color: #6b7280; font-style: italic;">
              Currently active
            </div>
          ` : ''}
          
          <!-- Share to Global button - Available for ALL versions -->
          ${(() => {
            // Compare by MongoDB _id, not versionId
            const isThisVersionShared = this.sharedGlobalVersionMongoId === version._id;
            const canShare = !!this.companyCategoryId;
            
            if (isThisVersionShared) {
              // This version is currently shared
              return `
                <button 
                  type="button"
                  class="unshare-global-btn"
                  data-version-id="${version.versionId}"
                  style="
                    margin-top: 8px;
                    padding: 8px 14px;
                    border-radius: 6px;
                    border: none;
                    font-size: 12px;
                    font-weight: 600;
                    cursor: pointer;
                    background: #10b981;
                    color: #ffffff;
                    box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3);
                    transition: all 0.2s;
                  "
                  title="This version is shared globally. Click to unshare."
                >
                  ✓ Shared to Global
                </button>
              `;
            } else {
              // Not shared yet
              return `
                <button 
                  type="button"
                  class="share-global-btn"
                  data-version-id="${version.versionId}"
                  style="
                    margin-top: 8px;
                    padding: 8px 14px;
                    border-radius: 6px;
                    border: none;
                    font-size: 12px;
                    font-weight: 600;
                    cursor: ${canShare ? 'pointer' : 'not-allowed'};
                    background: ${canShare ? '#0ea5e9' : '#e5e7eb'};
                    color: ${canShare ? '#ffffff' : '#9ca3af'};
                    box-shadow: ${canShare ? '0 2px 8px rgba(14, 165, 233, 0.3)' : 'none'};
                    transition: all 0.2s;
                  "
                  ${canShare ? '' : 'disabled'}
                  title="${canShare ? 'Share this version to Global' : 'Set category first'}"
                >
                  🌍 Share to Global
                </button>
              `;
            }
          })()}
          
        </div>
        
      </div>
    `;
    
    // Wire up Share/Unshare buttons for ALL versions
    setTimeout(() => {
      const shareBtn = card.querySelector('.share-global-btn');
      const unshareBtn = card.querySelector('.unshare-global-btn');
      
      // Share button
      if (shareBtn && this.companyCategoryId) {
        shareBtn.addEventListener('click', (e) => {
          e.stopPropagation(); // Prevent card click
          this.shareToGlobal(version.versionId);
        });
        
        // Add hover effects
        shareBtn.addEventListener('mouseenter', () => {
          shareBtn.style.background = '#0284c7';
        });
        shareBtn.addEventListener('mouseleave', () => {
          shareBtn.style.background = '#0ea5e9';
        });
      }
      
      // Unshare button
      if (unshareBtn) {
        unshareBtn.addEventListener('click', (e) => {
          e.stopPropagation(); // Prevent card click
          this.unshareFromGlobal(version.versionId);
        });
        
        // Add hover effects (red for unshare)
        unshareBtn.addEventListener('mouseenter', () => {
          unshareBtn.style.background = '#ef4444';
          unshareBtn.textContent = '✕ Unshare';
        });
        unshareBtn.addEventListener('mouseleave', () => {
          unshareBtn.style.background = '#10b981';
          unshareBtn.textContent = '✓ Shared to Global';
        });
      }
    }, 0);
    
    return card;
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // VERSION ACTIONS (View, Restore, Delete)
  // ═══════════════════════════════════════════════════════════════════
  
  async viewVersionDetail(versionId) {
    console.log('[CHEAT SHEET] 👁️ Viewing version detail:', versionId);
    
    try {
      const config = await this.versioningAdapter.getVersionConfig(versionId);
      console.log('[CHEAT SHEET] ✅ Version config loaded:', config);
      
      // Create modal overlay
      const modal = document.createElement('div');
      modal.id = 'version-detail-modal';
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        padding: 24px;
      `;
      
      modal.innerHTML = `
        <div style="background: #ffffff; border-radius: 16px; max-width: 900px; width: 100%; max-height: 90vh; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.3); display: flex; flex-direction: column;">
          
          <!-- Modal Header -->
          <div style="padding: 24px; border-bottom: 2px solid #e5e7eb; display: flex; align-items: center; justify-content: space-between;">
            <div>
              <h2 style="font-size: 24px; font-weight: 700; color: #111827; margin: 0 0 4px 0;">
                📄 Version Details
              </h2>
              <p style="font-size: 14px; color: #6b7280; margin: 0;">
                Read-only snapshot of configuration
              </p>
            </div>
            <button 
              onclick="document.getElementById('version-detail-modal').remove()"
              style="padding: 8px 12px; border-radius: 8px; border: none; background: #f3f4f6; color: #6b7280; cursor: pointer; font-size: 20px; line-height: 1; transition: all 0.2s;"
              onmouseover="this.style.background='#e5e7eb'"
              onmouseout="this.style.background='#f3f4f6'"
            >
              ✕
            </button>
          </div>
          
          <!-- Modal Body (Scrollable) -->
          <div style="padding: 24px; overflow-y: auto; flex: 1;">
            ${config ? `
              <pre style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; font-size: 12px; font-family: 'Monaco', 'Courier New', monospace; line-height: 1.6; overflow-x: auto; margin: 0;">${JSON.stringify(config, null, 2)}</pre>
            ` : `
              <div style="text-align: center; padding: 40px; background: #f9fafb; border: 2px dashed #e5e7eb; border-radius: 12px;">
                <div style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;">📦</div>
                <div style="font-size: 16px; font-weight: 600; color: #6b7280; margin-bottom: 8px;">
                  No Configuration Snapshot
                </div>
                <p style="font-size: 14px; color: #9ca3af; margin: 0;">
                  No configuration snapshot was saved for this version yet.
                </p>
              </div>
            `}
          </div>
          
          <!-- Modal Footer -->
          <div style="padding: 16px 24px; border-top: 2px solid #e5e7eb; background: #f9fafb; display: flex; justify-content: flex-end;">
            <button 
              onclick="document.getElementById('version-detail-modal').remove()"
              style="padding: 10px 24px; border-radius: 8px; border: none; background: #0ea5e9; color: #ffffff; cursor: pointer; font-size: 14px; font-weight: 600; transition: all 0.2s;"
              onmouseover="this.style.background='#0284c7'"
              onmouseout="this.style.background='#0ea5e9'"
            >
              Close
            </button>
          </div>
          
        </div>
      `;
      
      document.body.appendChild(modal);
      
    } catch (error) {
      console.error('[CHEAT SHEET] ❌ Failed to load version detail:', error);
      this.showNotification(`Failed to load version: ${error.message}`, 'error');
    }
  }
  
  async restoreVersion(versionId, versionName) {
    console.log('[CHEAT SHEET] 🔄 Restoring version:', versionId);
    
    const confirmed = window.confirm(
      `🔄 RESTORE VERSION?\n\n` +
      `This will create a new draft from "${versionName}".\n\n` +
      `You can review the restored configuration before pushing it live.\n\n` +
      `Continue?`
    );
    
    if (!confirmed) {
      console.log('[CHEAT SHEET] ⚠️ Restore cancelled by user');
      return;
    }
    
    try {
      const newDraftName = window.prompt(
        'Name for the restored draft:',
        `Restored: ${versionName}`
      );
      
      if (!newDraftName) {
        console.log('[CHEAT SHEET] ⚠️ Restore cancelled (no name provided)');
        return;
      }
      
      console.log('[CHEAT SHEET] 🔄 Creating draft from archived version...');
      const draft = await this.versioningAdapter.restoreVersion(versionId, newDraftName);
      console.log('[CHEAT SHEET] ✅ Version restored as draft:', draft);
      
      // Reload to fetch the new draft
      await this.load(this.companyId);
      this.render();
      
      // Switch back to a main tab to see the draft status banner
      this.switchSubTab('triage');
      
      this.showNotification(`✅ Version restored as "${newDraftName}"! Review and push live when ready.`, 'success');
      
    } catch (error) {
      console.error('[CHEAT SHEET] ❌ Failed to restore version:', error);
      this.showNotification(`Failed to restore version: ${error.message}`, 'error');
    }
  }
  
  async restoreAsLive(versionId, versionName) {
    console.log('[CHEAT SHEET] ⚡ EMERGENCY ROLLBACK: Restoring version directly as LIVE:', versionId);
    
    const confirmed = window.confirm(
      `⚡ EMERGENCY ROLLBACK?\n\n` +
      `This will IMMEDIATELY restore "${versionName}" as your LIVE configuration.\n\n` +
      `⚠️ WARNING:\n` +
      `• Your current LIVE version will be archived\n` +
      `• This version will become active instantly\n` +
      `• AI Agent will use this configuration immediately\n\n` +
      `Use this for emergency rollbacks only.\n\n` +
      `Are you absolutely sure?`
    );
    
    if (!confirmed) {
      console.log('[CHEAT SHEET] ⚠️ Emergency rollback cancelled by user');
      return;
    }
    
    try {
      console.log('[CHEAT SHEET] ⚡ Promoting archived version directly to LIVE...');
      
      // Use the push-live endpoint directly with the archived version
      const response = await fetch(`/api/cheatsheet/versions/${this.companyId}/${versionId}/publish`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('adminToken')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          notes: `Emergency rollback from archived version: ${versionName}`
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }
      
      const result = await response.json();
      console.log('[CHEAT SHEET] ✅ Emergency rollback successful:', result);
      
      // Reload everything
      await this.load(this.companyId);
      this.render();
      
      // Re-init Version Console to reflect new live version
      if (this.useVersionConsole) {
        await this.csInit();
      }
      
      // Switch to Version History to show the change
      this.switchSubTab('version-history');
      
      alert(`✅ EMERGENCY ROLLBACK SUCCESSFUL!\n\n"${versionName}" is now LIVE and active.`);
      
    } catch (error) {
      console.error('[CHEAT SHEET] ❌ Emergency rollback failed:', error);
      alert(`❌ Emergency rollback failed:\n\n${error.message}\n\nPlease contact support if this persists.`);
    }
  }
  
  async deleteVersion(versionId, versionName) {
    console.log('[CHEAT SHEET] 🗑️ Deleting version:', versionId);
    
    const confirmed = window.confirm(
      `🗑️ DELETE ARCHIVED VERSION?\n\n` +
      `This will permanently delete "${versionName}".\n\n` +
      `This action cannot be undone. Continue?`
    );
    
    if (!confirmed) {
      console.log('[CHEAT SHEET] ⚠️ Delete cancelled by user');
      return;
    }
    
    try {
      console.log('[CHEAT SHEET] 🗑️ Deleting archived version...');
      await this.versioningAdapter.deleteVersion(versionId);
      console.log('[CHEAT SHEET] ✅ Version deleted successfully');
      
      // Re-render version history to remove the deleted card
      this.renderVersionHistory();
      
      this.showNotification(`✅ Version "${versionName}" deleted permanently.`, 'success');
      
    } catch (error) {
      console.error('[CHEAT SHEET] ❌ Failed to delete version:', error);
      this.showNotification(`Failed to delete version: ${error.message}`, 'error');
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // TOGGLE HELPERS
  // ═══════════════════════════════════════════════════════════════════
  
  toggleBehaviorRule(ruleId) {
    const index = this.cheatSheet.behaviorRules.indexOf(ruleId);
    
    if (index > -1) {
      this.cheatSheet.behaviorRules.splice(index, 1);
    } else {
      this.cheatSheet.behaviorRules.push(ruleId);
    }
    
    this.markDirty();
  }
  
  toggleGuardrail(guardrailId) {
    const index = this.cheatSheet.guardrails.indexOf(guardrailId);
    
    if (index > -1) {
      this.cheatSheet.guardrails.splice(index, 1);
    } else {
      this.cheatSheet.guardrails.push(guardrailId);
    }
    
    this.markDirty();
  }
  
  toggleAction(actionId) {
    const index = this.cheatSheet.allowedActions.indexOf(actionId);
    
    if (index > -1) {
      this.cheatSheet.allowedActions.splice(index, 1);
    } else {
      this.cheatSheet.allowedActions.push(actionId);
    }
    
    this.markDirty();
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // EDGE CASE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════
  
  addEdgeCase() {
    console.log('🔘 [CHEAT SHEET] Add Edge Case method called - isReady:', this.isReady, 'cheatSheet exists:', !!this.cheatSheet);
    
    if (!this.isReady) {
      console.warn('[CHEAT SHEET] ⚠️ addEdgeCase called before manager is ready - ignoring');
      return;
    }
    
    if (!this.cheatSheet) {
      console.warn('[CHEAT SHEET] ⚠️ addEdgeCase called but cheatSheet is null - ignoring');
      return;
    }
    
    if (!this.cheatSheet.edgeCases) {
      this.cheatSheet.edgeCases = [];
    }
    
    console.log('[CHEAT SHEET] ✅ Adding new edge case');
    this.cheatSheet.edgeCases.push({
      id: `ec-${Date.now()}`,
      name: 'New Edge Case',
      triggerPatterns: [],
      responseText: '',
      priority: 10,
      enabled: true,
      createdAt: new Date().toISOString(),
      createdBy: 'admin'
    });
    
    this.markDirty();
    this.renderEdgeCases();
  }
  
  updateEdgeCase(index, field, value) {
    if (this.cheatSheet.edgeCases[index]) {
      this.cheatSheet.edgeCases[index][field] = value;
      this.markDirty();
    }
  }
  
  removeEdgeCase(index) {
    if (confirm('Are you sure you want to remove this edge case?')) {
      this.cheatSheet.edgeCases.splice(index, 1);
      this.markDirty();
      this.renderEdgeCases();
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // TRANSFER RULE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════
  
  addTransferRule() {
    console.log('🔘 [CHEAT SHEET] Add Transfer Rule method called - isReady:', this.isReady, 'cheatSheet exists:', !!this.cheatSheet);
    
    if (!this.isReady) {
      console.warn('[CHEAT SHEET] ⚠️ addTransferRule called before manager is ready - ignoring');
      return;
    }
    
    if (!this.cheatSheet) {
      console.warn('[CHEAT SHEET] ⚠️ addTransferRule called but cheatSheet is null - ignoring');
      return;
    }
    
    if (!this.cheatSheet.transferRules) {
      this.cheatSheet.transferRules = [];
    }
    
    console.log('[CHEAT SHEET] ✅ Adding new transfer rule');
    this.cheatSheet.transferRules.push({
      id: `tr-${Date.now()}`,
      intentTag: 'general',
      contactNameOrQueue: '',
      phoneNumber: '',
      script: 'Transferring your call...',
      collectEntities: [],
      afterHoursOnly: false,
      priority: 10,
      enabled: true,
      createdAt: new Date().toISOString(),
      createdBy: 'admin'
    });
    
    this.markDirty();
    this.renderTransferRules();
  }

  updateTransferRule(index, field, value) {
    if (!this.cheatSheet || !this.cheatSheet.transferRules) return;
    if (!this.cheatSheet.transferRules || !this.cheatSheet.transferRules[index]) return;
    this.cheatSheet.transferRules[index][field] = value;
    this.markDirty();
  }

  removeTransferRule(index) {
    if (!this.cheatSheet || !this.cheatSheet.transferRules) return;
    if (!this.cheatSheet.transferRules || !this.cheatSheet.transferRules[index]) return;
    if (!confirm('Remove this transfer rule?')) return;
    this.cheatSheet.transferRules.splice(index, 1);
    this.markDirty();
    this.renderTransferRules();
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // SAVE & COMPILE
  // ═══════════════════════════════════════════════════════════════════
  
  async save() {
    console.log('[CHEAT SHEET] 💾 CHECKPOINT 1: save() called');
    
    if (!this.companyId) {
      console.error('[CHEAT SHEET] ❌ CHECKPOINT 2: No company ID - aborting save');
      this.showNotification('No company selected', 'error');
      return;
    }
    
    console.log('[CHEAT SHEET] ✅ CHECKPOINT 2: Company ID verified:', this.companyId);
    console.log('[CHEAT SHEET] 📊 CHECKPOINT 3: isDirty flag:', this.isDirty);
    console.log('[CHEAT SHEET] 💾 CHECKPOINT 4: Preparing to save cheat sheet...');
    console.log('[CHEAT SHEET] 📊 Booking rules count:', 
      Array.isArray(this.cheatSheet.bookingRules) ? this.cheatSheet.bookingRules.length : 0
    );
    console.log('[CHEAT SHEET] 📊 Company contacts count:', 
      Array.isArray(this.cheatSheet.companyContacts) ? this.cheatSheet.companyContacts.length : 0
    );
    console.log('[CHEAT SHEET] 📊 Links count:', 
      Array.isArray(this.cheatSheet.links) ? this.cheatSheet.links.length : 0
    );
    console.log('[CHEAT SHEET] 📊 Calculators count:', 
      Array.isArray(this.cheatSheet.calculators) ? this.cheatSheet.calculators.length : 0
    );
    
    try {
      console.log('[CHEAT SHEET] 🔑 CHECKPOINT 5: Getting auth token...');
      const token = localStorage.getItem('adminToken');
      console.log('[CHEAT SHEET] ✅ CHECKPOINT 6: Auth token exists?', !!token);
      
      // CRITICAL DEBUG: Log what's in this.cheatSheet BEFORE creating payload
      console.log('[CHEAT SHEET] 🔍 PRE-SAVE DEBUG: this.cheatSheet contains:', {
        hasBookingRules: Array.isArray(this.cheatSheet.bookingRules),
        bookingRulesCount: Array.isArray(this.cheatSheet.bookingRules) ? this.cheatSheet.bookingRules.length : 'NOT AN ARRAY',
        bookingRulesData: this.cheatSheet.bookingRules,
        hasCompanyContacts: Array.isArray(this.cheatSheet.companyContacts),
        companyContactsCount: Array.isArray(this.cheatSheet.companyContacts) ? this.cheatSheet.companyContacts.length : 'NOT AN ARRAY',
        hasLinks: Array.isArray(this.cheatSheet.links),
        linksCount: Array.isArray(this.cheatSheet.links) ? this.cheatSheet.links.length : 'NOT AN ARRAY',
        hasCalculators: Array.isArray(this.cheatSheet.calculators),
        calculatorsCount: Array.isArray(this.cheatSheet.calculators) ? this.cheatSheet.calculators.length : 'NOT AN ARRAY'
      });
      
      const payload = {
        'aiAgentSettings.cheatSheet': {
          ...this.cheatSheet,
          updatedAt: new Date().toISOString(),
          updatedBy: 'admin'
        }
      };
      
      // Verify V2 arrays made it into payload
      console.log('[CHEAT SHEET] 🔍 PAYLOAD V2 ARRAYS:', {
        bookingRules: payload['aiAgentSettings.cheatSheet'].bookingRules?.length || 0,
        companyContacts: payload['aiAgentSettings.cheatSheet'].companyContacts?.length || 0,
        links: payload['aiAgentSettings.cheatSheet'].links?.length || 0,
        calculators: payload['aiAgentSettings.cheatSheet'].calculators?.length || 0
      });
      
      console.log('[CHEAT SHEET] 📦 CHECKPOINT 7: Payload prepared (truncated for readability)');
      console.log('[CHEAT SHEET] 🌐 CHECKPOINT 8: Sending PATCH request to:', `/api/company/${this.companyId}`);
      
      const response = await fetch(`/api/company/${this.companyId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      
      console.log('[CHEAT SHEET] 📥 CHECKPOINT 9: Response received. Status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[CHEAT SHEET] ❌ CHECKPOINT 10: Response NOT OK. Status:', response.status, 'Body:', errorText);
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
      
      const responseData = await response.json();
      console.log('[CHEAT SHEET] ✅ CHECKPOINT 10: Response OK. Data:', responseData);
      console.log('[CHEAT SHEET] ✅ CHECKPOINT 11: Saved successfully to MongoDB');
      
      // Show prominent success popup
      this.showSuccessPopup('✅ SAVED SUCCESSFULLY!', 'All changes have been saved to MongoDB.');
      
      this.isDirty = false;
      
      // Update UI based on active system
      if (this.useVersionConsole && this.csWorkspaceVersion) {
        this.renderVersionConsole();
      }
      
      console.log('[CHEAT SHEET] ✅ CHECKPOINT 12: Save complete. isDirty now:', this.isDirty);
      
    } catch (error) {
      console.error('[CHEAT SHEET] ❌ CHECKPOINT ERROR: Save failed:', error);
      console.error('[CHEAT SHEET] ❌ Error details:', {
        message: error.message,
        stack: error.stack
      });
      
      // Show prominent error popup
      this.showErrorPopup('❌ SAVE FAILED', `Could not save to MongoDB: ${error.message}`);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // VERSION SYSTEM HANDLERS (Draft/Live Workflow)
  // ═══════════════════════════════════════════════════════════════════
  
  /**
   * Quick Save - Saves changes directly without version system (legacy mode)
   * Used when no draft exists and user just wants to save current state
   */
  async quickSave() {
    console.log('[CHEAT SHEET] 💾 Quick Save initiated (bypassing version system)');
    
    if (!this.isDirty) {
      console.log('[CHEAT SHEET] ⚠️ No changes to save');
      this.showNotification('No changes to save', 'info');
      return;
    }
    
    try {
      // Save directly without changing versioning flag
      // This prevents the status banner from switching during save
      
      const token = localStorage.getItem('adminToken');
      if (!token) {
        throw new Error('No auth token found');
      }
      
      console.log('[CHEAT SHEET] 💾 Quick saving to database...');
      
      const payload = {
        aiAgentSettings: {
          cheatSheet: this.cheatSheet
        }
      };
      
      const response = await fetch(`/api/company/${this.companyId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('[CHEAT SHEET] ✅ Quick save successful:', data);
      
      // Mark as clean
      this.isDirty = false;
      
      // Re-render console/banner based on active system
      if (this.useVersionConsole && this.csWorkspaceVersion) {
        this.renderVersionConsole();
      }
      
      this.showNotification('✅ Changes saved successfully!', 'success');
      
    } catch (error) {
      console.error('[CHEAT SHEET] ❌ Quick save failed:', error);
      this.showNotification(`Failed to save: ${error.message}`, 'error');
    }
  }
  
  async createDraft() {
    if (!this.versioningAdapter) {
      console.error('[CHEAT SHEET] ❌ Versioning adapter not initialized');
      this.showNotification('Version system not available', 'error');
      return;
    }
    
    try {
      console.log('[CHEAT SHEET] 📝 Creating new draft...');
      const draftName = window.prompt('Name for this draft:', 'Working Draft ' + new Date().toLocaleDateString());
      
      if (!draftName) {
        console.log('[CHEAT SHEET] ⚠️ Draft creation cancelled (no name provided)');
        return;
      }
      
      const notes = window.prompt('Notes for this draft (optional):', '');
      
      // Create draft from current live version
      const draft = await this.versioningAdapter.createDraft(draftName, notes || '', null);
      console.log('[CHEAT SHEET] ✅ Draft created:', draft);
      
      // Reload to fetch the new draft
      await this.load(this.companyId);
      this.render();
      
      this.showNotification(`✅ Draft "${draftName}" created successfully!`, 'success');
    } catch (error) {
      console.error('[CHEAT SHEET] ❌ Failed to create draft:', error);
      this.showNotification(`Failed to create draft: ${error.message}`, 'error');
    }
  }
  
  async saveDraft() {
    if (!this.versioningAdapter || !this.versionStatus?.draft) {
      console.error('[CHEAT SHEET] ❌ No draft to save');
      this.showNotification('No draft in progress', 'error');
      return;
    }
    
    if (!this.isDirty) {
      console.log('[CHEAT SHEET] ℹ️ No changes to save');
      this.showNotification('No changes to save', 'info');
      return;
    }
    
    try {
      console.log('[CHEAT SHEET] 💾 Saving draft...', this.versionStatus.draft.versionId);
      
      // Save the draft with current config
      await this.versioningAdapter.saveDraft(this.versionStatus.draft.versionId, this.cheatSheet);
      console.log('[CHEAT SHEET] ✅ Draft saved successfully');
      
      this.isDirty = false;
      
      // Reload status (to get updated timestamps, etc.)
      this.versionStatus = await this.versioningAdapter.getStatus();
      
      // Update UI based on active system
      if (this.useVersionConsole && this.csWorkspaceVersion) {
        this.renderVersionConsole();
      }
      
      this.showNotification('✅ Draft saved successfully!', 'success');
    } catch (error) {
      console.error('[CHEAT SHEET] ❌ Failed to save draft:', error);
      
      if (error.statusCode === 409) {
        // Optimistic concurrency conflict
        this.showNotification('⚠️ Draft was modified elsewhere. Please refresh and try again.', 'error');
      } else {
        this.showNotification(`Failed to save draft: ${error.message}`, 'error');
      }
    }
  }
  
  async pushDraftLive() {
    if (!this.versioningAdapter || !this.versionStatus?.draft) {
      console.error('[CHEAT SHEET] ❌ No draft to push live');
      this.showNotification('No draft to push live', 'error');
      return;
    }
    
    if (this.isDirty) {
      const saveFirst = window.confirm('You have unsaved changes. Save draft before pushing live?');
      if (saveFirst) {
        await this.saveDraft();
      } else {
        return; // Don't proceed if user cancels
      }
    }
    
    const confirmed = window.confirm(
      `🚀 PUSH DRAFT LIVE?\n\n` +
      `This will:\n` +
      `1. Make "${this.versionStatus.draft.name}" the new LIVE configuration\n` +
      `2. Archive the current live version\n` +
      `3. Delete the draft\n\n` +
      `This change will affect all incoming calls immediately.\n\n` +
      `Continue?`
    );
    
    if (!confirmed) {
      console.log('[CHEAT SHEET] ⚠️ Push live cancelled by user');
      return;
    }
    
    try {
      console.log('[CHEAT SHEET] 🚀 Pushing draft live...', this.versionStatus.draft.versionId);
      
      await this.versioningAdapter.pushLive(this.versionStatus.draft.versionId);
      console.log('[CHEAT SHEET] ✅ Draft pushed live successfully!');
      
      // Reload everything (draft is now deleted, we're back to live-only mode)
      await this.load(this.companyId);
      this.render();
      
      this.showNotification('✅ Draft pushed live! Configuration is now active.', 'success');
    } catch (error) {
      console.error('[CHEAT SHEET] ❌ Failed to push draft live:', error);
      this.showNotification(`Failed to push live: ${error.message}`, 'error');
    }
  }
  
  async discardDraft() {
    if (!this.versioningAdapter || !this.versionStatus?.draft) {
      console.error('[CHEAT SHEET] ❌ No draft to discard');
      this.showNotification('No draft to discard', 'error');
      return;
    }
    
    const confirmed = window.confirm(
      `🗑️ DISCARD DRAFT?\n\n` +
      `This will permanently delete "${this.versionStatus.draft.name}".\n\n` +
      `${this.isDirty ? 'You have unsaved changes that will be lost.\n\n' : ''}` +
      `This action cannot be undone. Continue?`
    );
    
    if (!confirmed) {
      console.log('[CHEAT SHEET] ⚠️ Discard cancelled by user');
      return;
    }
    
    try {
      console.log('[CHEAT SHEET] 🗑️ Discarding draft...', this.versionStatus.draft.versionId);
      
      await this.versioningAdapter.discardDraft(this.versionStatus.draft.versionId);
      console.log('[CHEAT SHEET] ✅ Draft discarded successfully');
      
      // Reload (draft is now gone, back to live)
      await this.load(this.companyId);
      this.render();
      
      this.showNotification('✅ Draft discarded. Reverted to live configuration.', 'success');
    } catch (error) {
      console.error('[CHEAT SHEET] ❌ Failed to discard draft:', error);
      this.showNotification(`Failed to discard draft: ${error.message}`, 'error');
    }
  }
  
  async showVersionHistory() {
    console.log('[CHEAT SHEET] 📚 Opening version history...');
    // Switch to version-history tab
    this.switchSubTab('version-history');
  }
  
  async compileCheatSheet() {
    console.log('[CHEAT SHEET] 🔧 Compile requested. Checking for unsaved changes...');
    
    // Check if there are unsaved changes
    if (this.isDirty) {
      console.warn('[CHEAT SHEET] ⚠️ Unsaved changes detected. Prompting user to save first.');
      const shouldSave = window.confirm('⚠️ You have unsaved changes!\n\nWould you like to save them before compiling?');
      
      if (shouldSave) {
        console.log('[CHEAT SHEET] 💾 User chose to save first. Calling save()...');
        await this.save();
        console.log('[CHEAT SHEET] ✅ Save complete. Proceeding with compile...');
      } else {
        console.log('[CHEAT SHEET] ❌ User chose NOT to save. Aborting compile.');
        this.showNotification('⚠️ Compile cancelled. Please save changes first.', 'warning');
        return;
      }
    }
    
    console.log('[CHEAT SHEET] Compiling policy...');
    this.showNotification('Compiling policy...', 'info');
    
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`/api/admin/cheat-sheet/compile/${this.companyId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const result = await response.json();
      
      console.log('[CHEAT SHEET] Compilation result:', result);
      
      // Update checksum
      if (result.checksum) {
        this.cheatSheet.checksum = result.checksum;
        this.cheatSheet.lastCompiledAt = new Date().toISOString();
      }
      
      // Show conflicts if any
      if (result.conflicts && result.conflicts.length > 0) {
        this.showConflicts(result.conflicts);
      } else {
        this.showNotification('Policy compiled successfully', 'success');
      }
      
      this.render();
      
    } catch (error) {
      console.error('[CHEAT SHEET] Compilation failed:', error);
      this.showNotification('Policy compilation failed', 'error');
    }
  }
  
  async setStatus(newStatus) {
    this.cheatSheet.status = newStatus;
    await this.save();
    
    if (newStatus === 'active') {
      await this.compileCheatSheet();
    }
    
    this.render();
  }
  
  async testCheatSheet() {
    // TODO: Implement test harness UI
    this.showNotification('Test harness coming soon', 'info');
  }
  
  showConflicts(conflicts) {
    const message = `⚠️ ${conflicts.length} conflict(s) detected and auto-resolved:\n\n` +
      conflicts.map(c => `• ${c.type}: ${c.rule1Name} vs ${c.rule2Name} (${(c.overlapScore * 100).toFixed(0)}% overlap)`).join('\n');
    
    alert(message);
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // IMPORT/EXPORT METHODS
  // ═══════════════════════════════════════════════════════════════════
  
  /**
   * Open Full Screen Editor for Frontline-Intel
   * Opens a new window with a large textarea for easier editing
   */
  openFullEditor() {
    if (!this.companyId) {
      this.showNotification('Error: No company ID', 'error');
      return;
    }
    
    // Get current Frontline-Intel value
    const currentValue = this.cheatSheet.frontlineIntel || '';
    
    // Check if we're editing a draft
    const isDraft = this.csWorkspaceVersion && this.csWorkspaceVersion.versionId;
    const versionId = isDraft ? this.csWorkspaceVersion.versionId : null;
    
    console.log('[CHEAT SHEET] Opening full editor', { isDraft, versionId, valueLength: currentValue.length });
    
    const width = Math.min(1400, window.screen.availWidth * 0.9);
    const height = Math.min(900, window.screen.availHeight * 0.9);
    const left = (window.screen.availWidth - width) / 2;
    const top = (window.screen.availHeight - height) / 2;
    
    const editorWindow = window.open(
      `/frontline-intel-editor.html?companyId=${this.companyId}${versionId ? `&versionId=${versionId}` : ''}`,
      'FrontlineIntelEditor',
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );
    
    if (!editorWindow) {
      this.showNotification('❌ Please allow popups for this site', 'error');
      return;
    }
    
    // Send initial data to the editor once it's loaded
    // Use a small delay to ensure the editor window is ready to receive messages
    const sendInitialData = () => {
      console.log('[CHEAT SHEET] Sending initial data to editor window');
      editorWindow.postMessage({
        type: 'initFrontlineIntel',
        value: currentValue,
        versionId: versionId
      }, '*');
    };
    
    // Try multiple times to ensure the message is received
    setTimeout(sendInitialData, 100);
    setTimeout(sendInitialData, 300);
    setTimeout(sendInitialData, 500);
    
    // Listen for updates from the editor (ONE-TIME listener)
    const messageHandler = (event) => {
      if (event.data.type === 'frontlineIntelUpdated') {
        console.log('[CHEAT SHEET] Frontline-Intel updated from full editor');
        
        // Remove listener immediately to prevent duplicate handling
        window.removeEventListener('message', messageHandler);
        
        // Update local state with new value
        const newValue = event.data.value;
        this.cheatSheet.frontlineIntel = newValue;
        
        // If we're in a draft, save it immediately
        if (versionId) {
          console.log('[CHEAT SHEET] Saving updated Frontline-Intel to draft:', versionId);
          
          // Collect full config and save
          const config = this.csCollectConfigFromCheatSheetUI();
          this.versioningAdapter.saveDraft(config)
            .then(() => {
              console.log('[CHEAT SHEET] ✅ Draft saved successfully');
              this.showNotification('✅ Frontline-Intel saved to draft', 'success');
              
              // Re-render to show updated content
              this.render();
            })
            .catch((err) => {
              console.error('[CHEAT SHEET] ❌ Failed to save draft:', err);
              this.showNotification('❌ Failed to save draft', 'error');
            });
        } else {
          // Not in a draft, just re-render
          this.render();
        }
      }
    };
    
    window.addEventListener('message', messageHandler);
    
    console.log('[CHEAT SHEET] Opened full screen editor');
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // TRIAGE CARDS LIST - MANAGEMENT UI
  // ═══════════════════════════════════════════════════════════════════
  // Purpose: Display and manage all Triage Cards for this company
  // Features: List view, edit, activate/deactivate, test, delete
  // ═══════════════════════════════════════════════════════════════════
  
  async renderTriageCardsList() {
    const container = document.getElementById('triage-cards-list-section');
    if (!container) return;
    
    console.log('[TRIAGE CARDS LIST] Rendering...');
    
    // Fetch all triage cards for this company
    let cards = [];
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`/api/company/${this.companyId}/triage-cards`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        cards = data.cards || [];
        console.log(`[TRIAGE CARDS LIST] Loaded ${cards.length} cards`);
      }
    } catch (error) {
      console.error('[TRIAGE CARDS LIST] Load failed:', error);
    }
    
    container.innerHTML = `
      <div class="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
        
        <!-- Header -->
        <div class="bg-gradient-to-r from-indigo-50 to-purple-50 border-b border-gray-200 px-6 py-4">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-lg font-semibold text-gray-900 flex items-center">
                <span class="mr-2">🎯</span>
                Triage Cards
                <span class="ml-3 px-2 py-1 text-xs font-semibold bg-indigo-100 text-indigo-700 rounded-full">
                  ${cards.length} CARDS
                </span>
              </h3>
              <p class="text-sm text-gray-600 mt-1">
                Atomic source of truth for Frontline-Intel call distribution
              </p>
            </div>
          </div>
        </div>
        
        <!-- Cards List -->
        <div id="triage-cards-container" class="p-6 space-y-4">
          ${cards.length === 0 ? this.renderEmptyState() : cards.map(card => this.renderTriageCard(card)).join('')}
        </div>
        
        <!-- 🧪 Test THE BRAIN Section -->
        ${cards.length > 0 ? this.renderTestBrainSection() : ''}
        
      </div>
    `;
  }
  
  renderEmptyState() {
    return `
      <div class="text-center py-12">
        <div class="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
          <span class="text-3xl">📋</span>
        </div>
        <h4 class="text-lg font-semibold text-gray-900 mb-2">No Triage Cards Yet</h4>
        <p class="text-sm text-gray-600 mb-4">
          Use the AI Triage Builder below to generate your first card, or add manual rules in the Quick Rules table.
        </p>
      </div>
    `;
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // TEST THE BRAIN SECTION
  // ═══════════════════════════════════════════════════════════════════
  
  renderTestBrainSection() {
    return `
      <div class="border-t border-gray-200 bg-gray-50 px-6 py-6">
        <div class="max-w-3xl">
          <div class="flex items-center justify-between mb-4">
            <div>
              <h4 class="text-md font-semibold text-gray-900 flex items-center">
                <span class="mr-2">🧪</span>
                Test THE BRAIN
              </h4>
              <p class="text-xs text-gray-600 mt-1">
                Enter sample caller input to see which triage rule fires
              </p>
            </div>
          </div>
          
          <div class="space-y-3">
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Sample Caller Input</label>
              <input 
                type="text" 
                id="test-brain-input" 
                placeholder="e.g., my ac is not cooling at all"
                class="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            
            <div class="flex items-center space-x-2">
              <button 
                onclick="cheatSheetManager.testTriageInput()" 
                class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium flex items-center space-x-2"
              >
                <i class="fas fa-flask"></i>
                <span>Test</span>
              </button>
              
              <span class="text-xs text-gray-500">
                Uses same matching logic as production
              </span>
            </div>
            
            <!-- Test Results -->
            <div id="test-brain-results" class="hidden mt-4 p-4 bg-white border border-gray-200 rounded-lg">
              <!-- Results will be dynamically inserted here -->
            </div>
          </div>
        </div>
      </div>
    `;
  }
  
  async testTriageInput() {
    console.log('[TEST BRAIN] Testing input...');
    
    try {
      const input = document.getElementById('test-brain-input').value.trim();
      
      if (!input) {
        this.showNotification('Please enter sample caller input', 'error');
        return;
      }
      
      const token = localStorage.getItem('adminToken');
      
      if (!token) {
        throw new Error('Not authenticated');
      }
      
      // Call test endpoint
      const response = await fetch(`/api/company/${this.companyId}/triage-cards/test-match`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          callerInput: input,
          llmKeywords: [] // In production, LLM extracts these
        })
      });
      
      if (!response.ok) {
        throw new Error('Test failed');
      }
      
      const result = await response.json();
      
      // Display results
      this.displayTestResults(result, input);
      
    } catch (error) {
      console.error('[TEST BRAIN] Test failed:', error);
      this.showNotification(`❌ Test failed: ${error.message}`, 'error');
    }
  }
  
  displayTestResults(result, input) {
    const container = document.getElementById('test-brain-results');
    
    if (!container) return;
    
    if (result.matched && result.result.ruleMatched) {
      const rule = result.result.ruleMatched;
      
      container.innerHTML = `
        <div class="space-y-3">
          <div class="flex items-start space-x-3">
            <div class="flex-shrink-0">
              <div class="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                <i class="fas fa-check text-green-600"></i>
              </div>
            </div>
            <div class="flex-1">
              <h5 class="font-semibold text-gray-900 mb-1">✅ Rule Matched</h5>
              <p class="text-xs text-gray-600 mb-3">Input: "${this.escapeHtml(input)}"</p>
              
              <div class="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span class="font-medium text-gray-700">Source:</span>
                  <span class="ml-2 px-2 py-1 bg-${rule.source === 'MANUAL' ? 'blue' : rule.source === 'AI_CARD' ? 'purple' : 'gray'}-100 text-${rule.source === 'MANUAL' ? 'blue' : rule.source === 'AI_CARD' ? 'purple' : 'gray'}-700 rounded">${rule.source}</span>
                </div>
                <div>
                  <span class="font-medium text-gray-700">Priority:</span>
                  <span class="ml-2">${rule.priority}</span>
                </div>
                <div>
                  <span class="font-medium text-gray-700">Service Type:</span>
                  <span class="ml-2 px-2 py-1 bg-yellow-100 text-yellow-800 rounded font-mono">${rule.serviceType}</span>
                </div>
                <div>
                  <span class="font-medium text-gray-700">Action:</span>
                  <span class="ml-2 px-2 py-1 bg-indigo-100 text-indigo-800 rounded font-mono text-xs">${rule.action}</span>
                </div>
              </div>
              
              <div class="mt-3 p-3 bg-gray-50 rounded border border-gray-200">
                <div class="text-xs space-y-2">
                  <div>
                    <span class="font-medium text-gray-700">Keywords:</span>
                    <div class="mt-1 flex flex-wrap gap-1">
                      ${rule.keywords.map(kw => `<span class="px-2 py-1 bg-green-100 text-green-700 rounded text-xs">${this.escapeHtml(kw)}</span>`).join('')}
                    </div>
                  </div>
                  
                  ${rule.excludeKeywords && rule.excludeKeywords.length > 0 ? `
                    <div>
                      <span class="font-medium text-gray-700">Exclude Keywords:</span>
                      <div class="mt-1 flex flex-wrap gap-1">
                        ${rule.excludeKeywords.map(kw => `<span class="px-2 py-1 bg-red-100 text-red-700 rounded text-xs">${this.escapeHtml(kw)}</span>`).join('')}
                      </div>
                    </div>
                  ` : ''}
                  
                  ${rule.categorySlug ? `
                    <div>
                      <span class="font-medium text-gray-700">Category:</span>
                      <span class="ml-2 font-mono text-gray-600">${this.escapeHtml(rule.categorySlug)}</span>
                    </div>
                  ` : ''}
                  
                  ${rule.explanation ? `
                    <div>
                      <span class="font-medium text-gray-700">Explanation:</span>
                      <p class="mt-1 text-gray-600">${this.escapeHtml(rule.explanation)}</p>
                    </div>
                  ` : ''}
                </div>
              </div>
              
              <div class="mt-3 p-3 bg-blue-50 rounded border border-blue-200">
                <span class="text-xs font-medium text-blue-900">What happens next:</span>
                <p class="text-xs text-blue-700 mt-1">${this.escapeHtml(result.result.whatHappensNext)}</p>
              </div>
              
              <div class="mt-2 text-xs text-gray-500">
                Matched at index ${result.result.matchedAtIndex} of ${result.result.totalRulesChecked} total rules
              </div>
            </div>
          </div>
        </div>
      `;
      
    } else {
      container.innerHTML = `
        <div class="flex items-start space-x-3">
          <div class="flex-shrink-0">
            <div class="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
              <i class="fas fa-times text-red-600"></i>
            </div>
          </div>
          <div class="flex-1">
            <h5 class="font-semibold text-gray-900 mb-1">❌ No Match</h5>
            <p class="text-xs text-gray-600">Input: "${this.escapeHtml(input)}"</p>
            <p class="text-xs text-yellow-700 mt-2">
              ⚠️ This should not happen if fallback rule exists!
            </p>
          </div>
        </div>
      `;
    }
    
    // Show results container
    container.classList.remove('hidden');
    
    // Scroll to results
    container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // MANUAL TRIAGE TABLE EDITOR
  // ═══════════════════════════════════════════════════════════════════
  
  renderManualTriageTable() {
    const container = document.getElementById('manual-triage-table-section');
    if (!container) return;
    
    // Get existing manual rules from cheatSheet
    const manualRules = this.cheatSheet.manualTriageRules || [];
    
    container.innerHTML = `
      <div class="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
        
        <!-- Header -->
        <div class="bg-gradient-to-r from-blue-50 to-cyan-50 border-b border-gray-200 px-6 py-4">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-lg font-semibold text-gray-900 flex items-center">
                <span class="mr-2">📋</span>
                Quick Triage Rules
                <span class="ml-3 px-2 py-1 text-xs font-semibold bg-blue-100 text-blue-700 rounded-full">
                  ${manualRules.length} RULES
                </span>
              </h3>
              <p class="text-sm text-gray-600 mt-1">
                Simple keyword matching rules (no full card needed)
              </p>
            </div>
            <button 
              onclick="cheatSheetManager.addManualRule()" 
              class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium flex items-center space-x-2"
            >
              <i class="fas fa-plus"></i>
              <span>Add Rule</span>
            </button>
          </div>
        </div>
        
        <!-- Rules Table -->
        <div class="p-6">
          ${manualRules.length === 0 ? this.renderManualTableEmpty() : this.renderManualTableContent(manualRules)}
        </div>
        
      </div>
    `;
  }
  
  renderManualTableEmpty() {
    return `
      <div class="text-center py-12 text-gray-500">
        <i class="fas fa-table text-4xl mb-3 opacity-50"></i>
        <p class="text-sm font-medium">No manual rules yet</p>
        <p class="text-xs mt-1">Click "Add Rule" to create simple triage rules</p>
        <p class="text-xs text-gray-400 mt-2">Example: "not cooling" + "repair" → DIRECT_TO_3TIER</p>
      </div>
    `;
  }
  
  renderManualTableContent(rules) {
    return `
      <div class="overflow-x-auto">
        <table class="w-full text-sm border-collapse border border-gray-300">
          <thead>
            <tr class="bg-gray-100">
              <th class="border border-gray-300 px-3 py-2 text-left font-semibold text-xs">Keywords (Must Have)</th>
              <th class="border border-gray-300 px-3 py-2 text-left font-semibold text-xs">Exclude Keywords</th>
              <th class="border border-gray-300 px-3 py-2 text-left font-semibold text-xs">Service Type</th>
              <th class="border border-gray-300 px-3 py-2 text-left font-semibold text-xs">Action</th>
              <th class="border border-gray-300 px-3 py-2 text-left font-semibold text-xs">Explanation / Reason</th>
              <th class="border border-gray-300 px-3 py-2 text-left font-semibold text-xs">QnA Card</th>
              <th class="border border-gray-300 px-3 py-2 text-center font-semibold text-xs">Priority</th>
              <th class="border border-gray-300 px-3 py-2 text-center font-semibold text-xs w-24">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rules.map((rule, index) => this.renderManualTableRow(rule, index)).join('')}
          </tbody>
        </table>
      </div>
      
      <div class="mt-4 flex justify-end space-x-2">
        <button 
          onclick="cheatSheetManager.saveManualRules()" 
          class="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
          ${!this.isDirty ? 'disabled opacity-50 cursor-not-allowed' : ''}
        >
          💾 Save Rules
        </button>
      </div>
    `;
  }
  
  renderManualTableRow(rule, index) {
    const serviceTypes = ['REPAIR', 'MAINTENANCE', 'EMERGENCY', 'INSTALL', 'INSPECTION', 'QUOTE', 'OTHER', 'UNKNOWN'];
    const actions = ['DIRECT_TO_3TIER', 'EXPLAIN_AND_PUSH', 'ESCALATE_TO_HUMAN', 'TAKE_MESSAGE', 'END_CALL_POLITE'];
    
    return `
      <tr class="hover:bg-gray-50" data-rule-index="${index}">
        <td class="border border-gray-300 px-2 py-2">
          <input 
            type="text" 
            value="${(rule.keywords || []).join(', ')}" 
            onchange="cheatSheetManager.updateManualRuleField(${index}, 'keywords', this.value)"
            placeholder="e.g., not cooling, hot"
            class="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </td>
        <td class="border border-gray-300 px-2 py-2">
          <input 
            type="text" 
            value="${(rule.excludeKeywords || []).join(', ')}" 
            onchange="cheatSheetManager.updateManualRuleField(${index}, 'excludeKeywords', this.value)"
            placeholder="e.g., maintenance, $89"
            class="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </td>
        <td class="border border-gray-300 px-2 py-2">
          <select 
            onchange="cheatSheetManager.updateManualRuleField(${index}, 'serviceType', this.value)"
            class="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            ${serviceTypes.map(st => `<option value="${st}" ${rule.serviceType === st ? 'selected' : ''}>${st}</option>`).join('')}
          </select>
        </td>
        <td class="border border-gray-300 px-2 py-2">
          <select 
            onchange="cheatSheetManager.updateManualRuleField(${index}, 'action', this.value)"
            class="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            ${actions.map(act => `<option value="${act}" ${rule.action === act ? 'selected' : ''}>${act}</option>`).join('')}
          </select>
        </td>
        <td class="border border-gray-300 px-2 py-2">
          <input 
            type="text" 
            value="${this.escapeHtml(rule.explanation || '')}" 
            onchange="cheatSheetManager.updateManualRuleField(${index}, 'explanation', this.value)"
            placeholder="e.g., Prevent downgrade to maintenance when AC broken"
            class="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </td>
        <td class="border border-gray-300 px-2 py-2">
          <input 
            type="text" 
            value="${this.escapeHtml(rule.qnaCard || '')}" 
            onchange="cheatSheetManager.updateManualRuleField(${index}, 'qnaCard', this.value)"
            placeholder="e.g., ac-not-cooling-repair"
            class="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono"
          />
        </td>
        <td class="border border-gray-300 px-2 py-2 text-center">
          <input 
            type="number" 
            value="${rule.priority || 100}" 
            onchange="cheatSheetManager.updateManualRuleField(${index}, 'priority', parseInt(this.value))"
            min="1"
            max="1000"
            class="w-16 px-2 py-1 text-xs text-center border border-gray-200 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </td>
        <td class="border border-gray-300 px-2 py-2 text-center">
          <button 
            onclick="cheatSheetManager.deleteManualRule(${index})" 
            class="px-2 py-1 text-xs bg-red-100 text-red-700 border border-red-300 rounded hover:bg-red-200 transition-colors"
            title="Delete rule"
          >
            🗑️
          </button>
        </td>
      </tr>
    `;
  }
  
  renderTriageCard(card) {
    const statusColors = {
      'ACTIVE': 'bg-green-100 text-green-800 border-green-200',
      'DRAFT': 'bg-yellow-100 text-yellow-800 border-yellow-200',
      'ARCHIVED': 'bg-gray-100 text-gray-800 border-gray-200'
    };
    
    const statusColor = statusColors[card.status] || statusColors['DRAFT'];
    
    return `
      <div class="border border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition-shadow" data-card-id="${card._id}">
        
        <!-- Card Header -->
        <div class="bg-gradient-to-r from-gray-50 to-indigo-50 px-4 py-3 border-b border-gray-200">
          <div class="flex items-center justify-between">
            <div class="flex-1">
              <div class="flex items-center space-x-3">
                <h4 class="text-base font-semibold text-gray-900">${this.escapeHtml(card.category?.name || 'Untitled')}</h4>
                <span class="px-2 py-1 text-xs font-semibold ${statusColor} rounded-full border">
                  ${card.status}
                </span>
                <span class="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">
                  ${card.trade}
                </span>
              </div>
              <p class="text-xs text-gray-600 mt-1">
                ${card.serviceTypes.join(', ')} • ${card.triageMap.length} rules • ${card.responses.length} responses
              </p>
            </div>
            <div class="flex items-center space-x-2">
              ${card.status === 'ACTIVE' 
                ? `<button onclick="cheatSheetManager.deactivateTriageCard('${card._id}')" class="px-3 py-1.5 text-xs bg-yellow-100 text-yellow-700 border border-yellow-300 rounded-md hover:bg-yellow-200 transition-colors font-medium">
                     ⏸️ Deactivate
                   </button>`
                : `<button onclick="cheatSheetManager.activateTriageCard('${card._id}')" class="px-3 py-1.5 text-xs bg-green-100 text-green-700 border border-green-300 rounded-md hover:bg-green-200 transition-colors font-medium">
                     ▶️ Activate
                   </button>`
              }
              <button onclick="cheatSheetManager.deleteTriageCard('${card._id}')" class="px-3 py-1.5 text-xs bg-red-100 text-red-700 border border-red-300 rounded-md hover:bg-red-200 transition-colors font-medium">
                🗑️ Delete
              </button>
              <button onclick="cheatSheetManager.toggleCardAccordion('${card._id}')" class="p-2 text-gray-600 hover:text-gray-900 transition-colors">
                <i class="fas fa-chevron-down" id="accordion-icon-${card._id}"></i>
              </button>
            </div>
          </div>
        </div>
        
        <!-- Accordion Content (Collapsed by default) -->
        <div id="accordion-content-${card._id}" class="hidden">
          
          <!-- Part 1: Frontline-Intel Block -->
          <div class="border-b border-gray-200">
            <div class="bg-blue-50 px-4 py-2 flex items-center justify-between">
              <div class="flex items-center space-x-2">
                <i class="fas fa-brain text-blue-600"></i>
                <span class="text-sm font-semibold text-gray-900">Frontline-Intel Block</span>
                <span class="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">${card.frontlineIntelBlock.length} chars</span>
              </div>
              <button onclick="cheatSheetManager.copyToClipboard(\`${this.escapeForTemplate(card.frontlineIntelBlock)}\`, 'Frontline-Intel')" class="px-2 py-1 text-xs bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50 transition-colors">
                <i class="fas fa-copy mr-1"></i> Copy
              </button>
            </div>
            <div class="p-4 bg-gray-50">
              <pre class="text-xs font-mono whitespace-pre-wrap break-words bg-white border border-gray-200 rounded p-3 max-h-64 overflow-y-auto">${this.escapeHtml(card.frontlineIntelBlock)}</pre>
            </div>
          </div>
          
          <!-- Part 2: Triage Map Table (THE BRAIN) -->
          <div class="border-b border-gray-200">
            <div class="bg-purple-50 px-4 py-2 flex items-center justify-between">
              <div class="flex items-center space-x-2">
                <i class="fas fa-table text-purple-600"></i>
                <span class="text-sm font-semibold text-gray-900">Triage Map (Decision Table)</span>
                <span class="px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded-full">${card.triageMap.length} rules</span>
              </div>
            </div>
            <div class="p-4 bg-gray-50 overflow-x-auto">
              ${this.renderTriageMapTable(card.triageMap)}
            </div>
          </div>
          
          <!-- Part 3: Response Library -->
          <div class="border-b border-gray-200">
            <div class="bg-green-50 px-4 py-2 flex items-center justify-between">
              <div class="flex items-center space-x-2">
                <i class="fas fa-comments text-green-600"></i>
                <span class="text-sm font-semibold text-gray-900">Response Library</span>
                <span class="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded-full">${card.responses.length} variations</span>
              </div>
              <button onclick="cheatSheetManager.copyToClipboard(\`${this.escapeForTemplate(card.responses.join('\\n'))}\`, 'Responses')" class="px-2 py-1 text-xs bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50 transition-colors">
                <i class="fas fa-copy mr-1"></i> Copy All
              </button>
            </div>
            <div class="p-4 bg-gray-50 space-y-2 max-h-96 overflow-y-auto">
              ${card.responses.map((resp, idx) => `
                <div class="flex items-start space-x-2 p-2 bg-white border border-gray-200 rounded">
                  <span class="text-xs font-semibold text-gray-500 mt-0.5">${idx + 1}.</span>
                  <span class="text-xs text-gray-800 flex-1">${this.escapeHtml(resp)}</span>
                </div>
              `).join('')}
            </div>
          </div>
          
          <!-- Part 4: Category & Scenario Seeds -->
          <div class="border-b border-gray-200">
            <div class="bg-indigo-50 px-4 py-2 flex items-center justify-between">
              <div class="flex items-center space-x-2">
                <i class="fas fa-sitemap text-indigo-600"></i>
                <span class="text-sm font-semibold text-gray-900">Category & Scenario Seeds</span>
                <span class="px-2 py-0.5 text-xs bg-indigo-100 text-indigo-700 rounded-full">${card.category?.scenarioSeeds?.length || 0} seeds</span>
              </div>
            </div>
            <div class="p-4 bg-gray-50">
              <div class="mb-3">
                <span class="text-xs font-semibold text-gray-700">Category:</span>
                <span class="ml-2 text-xs font-mono text-gray-900">${this.escapeHtml(card.category?.slug || '')}</span>
              </div>
              <div class="mb-3">
                <span class="text-xs font-semibold text-gray-700">Description:</span>
                <p class="text-xs text-gray-800 mt-1">${this.escapeHtml(card.category?.description || '')}</p>
              </div>
              <div>
                <span class="text-xs font-semibold text-gray-700 mb-2 block">Scenario Seeds:</span>
                <div class="space-y-1 max-h-48 overflow-y-auto">
                  ${(card.category?.scenarioSeeds || []).map((seed, idx) => `
                    <div class="text-xs text-gray-800 p-2 bg-white border border-gray-200 rounded">
                      <span class="font-semibold text-gray-500">${idx + 1}.</span> ${this.escapeHtml(seed)}
                    </div>
                  `).join('')}
                </div>
              </div>
            </div>
          </div>
          
          <!-- Test This Card Feature -->
          <div class="bg-yellow-50 border-t border-yellow-200">
            <div class="px-4 py-2 flex items-center space-x-2">
              <i class="fas fa-vial text-yellow-600"></i>
              <span class="text-sm font-semibold text-gray-900">Test This Card</span>
            </div>
            <div class="p-4">
              <div class="mb-3">
                <label class="block text-xs font-medium text-gray-700 mb-1">Type a sample sentence:</label>
                <input 
                  type="text" 
                  id="test-input-${card._id}"
                  class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500"
                  placeholder="e.g., My AC isn't cooling, can I get the maintenance special?"
                />
              </div>
              <button 
                onclick="cheatSheetManager.testTriageCard('${card._id}')"
                class="px-4 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 transition-colors text-sm font-medium"
              >
                🧪 Run Test
              </button>
              <div id="test-result-${card._id}" class="mt-3 hidden">
                <!-- Test results will appear here -->
              </div>
            </div>
          </div>
          
        </div>
      </div>
    `;
  }
  
  renderTriageMapTable(triageMap) {
    if (!triageMap || triageMap.length === 0) {
      return '<p class="text-sm text-gray-500">No triage rules defined.</p>';
    }
    
    return `
      <table class="w-full text-xs border-collapse bg-white border border-gray-300 rounded">
        <thead>
          <tr class="bg-gray-100">
            <th class="border border-gray-300 px-3 py-2 text-left font-semibold">Priority</th>
            <th class="border border-gray-300 px-3 py-2 text-left font-semibold">Keywords (Must Have)</th>
            <th class="border border-gray-300 px-3 py-2 text-left font-semibold">Exclude Keywords</th>
            <th class="border border-gray-300 px-3 py-2 text-left font-semibold">Service Type</th>
            <th class="border border-gray-300 px-3 py-2 text-left font-semibold">Action</th>
            <th class="border border-gray-300 px-3 py-2 text-left font-semibold">Category Slug</th>
          </tr>
        </thead>
        <tbody>
          ${triageMap.map(rule => `
            <tr class="hover:bg-gray-50">
              <td class="border border-gray-300 px-3 py-2">
                <span class="px-2 py-1 bg-purple-100 text-purple-800 rounded font-semibold">${rule.priority}</span>
              </td>
              <td class="border border-gray-300 px-3 py-2">
                <div class="flex flex-wrap gap-1">
                  ${rule.keywords.map(kw => `<span class="px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-xs font-mono">${this.escapeHtml(kw)}</span>`).join('')}
                </div>
              </td>
              <td class="border border-gray-300 px-3 py-2">
                ${rule.excludeKeywords && rule.excludeKeywords.length > 0 
                  ? `<div class="flex flex-wrap gap-1">${rule.excludeKeywords.map(kw => `<span class="px-2 py-0.5 bg-red-100 text-red-800 rounded text-xs font-mono">${this.escapeHtml(kw)}</span>`).join('')}</div>`
                  : '<span class="text-gray-400 italic">none</span>'
                }
              </td>
              <td class="border border-gray-300 px-3 py-2">
                <span class="px-2 py-1 bg-green-100 text-green-800 rounded font-semibold">${rule.serviceType}</span>
              </td>
              <td class="border border-gray-300 px-3 py-2">
                <span class="px-2 py-1 ${this.getActionBadgeColor(rule.action)} rounded font-semibold">${rule.action}</span>
              </td>
              <td class="border border-gray-300 px-3 py-2 font-mono text-gray-700">${this.escapeHtml(rule.categorySlug || '')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }
  
  getActionBadgeColor(action) {
    const colors = {
      'DIRECT_TO_3TIER': 'bg-blue-100 text-blue-800',
      'EXPLAIN_AND_PUSH': 'bg-yellow-100 text-yellow-800',
      'ESCALATE_TO_HUMAN': 'bg-orange-100 text-orange-800',
      'TAKE_MESSAGE': 'bg-purple-100 text-purple-800',
      'END_CALL_POLITE': 'bg-gray-100 text-gray-800'
    };
    return colors[action] || 'bg-gray-100 text-gray-800';
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // TRIAGE CARD ACTIONS
  // ═══════════════════════════════════════════════════════════════════
  
  toggleCardAccordion(cardId) {
    const content = document.getElementById(`accordion-content-${cardId}`);
    const icon = document.getElementById(`accordion-icon-${cardId}`);
    
    if (!content || !icon) return;
    
    if (content.classList.contains('hidden')) {
      content.classList.remove('hidden');
      icon.classList.remove('fa-chevron-down');
      icon.classList.add('fa-chevron-up');
    } else {
      content.classList.add('hidden');
      icon.classList.remove('fa-chevron-up');
      icon.classList.add('fa-chevron-down');
    }
  }
  
  async activateTriageCard(cardId) {
    console.log('[TRIAGE CARDS] Activating card:', cardId);
    
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`/api/company/${this.companyId}/triage-cards/${cardId}/activate`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!response.ok) throw new Error('Activation failed');
      
      this.showNotification('✅ Triage Card activated!', 'success');
      this.renderTriageCardsList(); // Reload list
      
    } catch (error) {
      console.error('[TRIAGE CARDS] Activation failed:', error);
      this.showNotification('❌ Failed to activate card', 'error');
    }
  }
  
  async deactivateTriageCard(cardId) {
    console.log('[TRIAGE CARDS] Deactivating card:', cardId);
    
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`/api/company/${this.companyId}/triage-cards/${cardId}/deactivate`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!response.ok) throw new Error('Deactivation failed');
      
      this.showNotification('✅ Triage Card deactivated', 'success');
      this.renderTriageCardsList(); // Reload list
      
    } catch (error) {
      console.error('[TRIAGE CARDS] Deactivation failed:', error);
      this.showNotification('❌ Failed to deactivate card', 'error');
    }
  }
  
  async deleteTriageCard(cardId) {
    const confirmed = confirm('🗑️ Delete this Triage Card?\n\nThis action cannot be undone.');
    if (!confirmed) return;
    
    console.log('[TRIAGE CARDS] Deleting card:', cardId);
    
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`/api/company/${this.companyId}/triage-cards/${cardId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!response.ok) throw new Error('Deletion failed');
      
      this.showNotification('✅ Triage Card deleted', 'success');
      this.renderTriageCardsList(); // Reload list
      
    } catch (error) {
      console.error('[TRIAGE CARDS] Deletion failed:', error);
      this.showNotification('❌ Failed to delete card', 'error');
    }
  }
  
  async testTriageCard(cardId) {
    const input = document.getElementById(`test-input-${cardId}`);
    const resultContainer = document.getElementById(`test-result-${cardId}`);
    
    if (!input || !resultContainer) return;
    
    const testText = input.value.trim();
    if (!testText) {
      alert('Please enter a test sentence first.');
      return;
    }
    
    console.log('[TRIAGE CARDS] Testing card:', cardId, 'with text:', testText);
    
    // Fetch the card data
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`/api/company/${this.companyId}/triage-cards/${cardId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!response.ok) throw new Error('Failed to fetch card');
      
      const { card } = await response.json();
      
      // Run local triage simulation
      const result = this.simulateTriageMatching(testText, card.triageMap);
      
      // Display results
      resultContainer.classList.remove('hidden');
      
      if (result.matched) {
        resultContainer.innerHTML = `
          <div class="p-4 bg-green-50 border border-green-200 rounded-lg">
            <div class="flex items-start space-x-3">
              <i class="fas fa-check-circle text-green-600 text-xl mt-0.5"></i>
              <div class="flex-1">
                <h5 class="text-sm font-semibold text-green-900 mb-2">✅ Match Found (Priority: ${result.rule.priority})</h5>
                <div class="space-y-1 text-xs">
                  <div><strong class="text-green-800">Keywords Matched:</strong> <span class="text-green-700">${result.rule.keywords.join(', ')}</span></div>
                  <div><strong class="text-green-800">Service Type:</strong> <span class="px-2 py-0.5 bg-green-100 text-green-800 rounded font-semibold">${result.rule.serviceType}</span></div>
                  <div><strong class="text-green-800">Action:</strong> <span class="px-2 py-0.5 ${this.getActionBadgeColor(result.rule.action)} rounded font-semibold">${result.rule.action}</span></div>
                  <div><strong class="text-green-800">Category Slug:</strong> <code class="text-green-700">${result.rule.categorySlug || 'N/A'}</code></div>
                  ${result.rule.reason ? `<div class="mt-2 text-green-700"><strong>Reason:</strong> ${this.escapeHtml(result.rule.reason)}</div>` : ''}
                </div>
              </div>
            </div>
          </div>
        `;
      } else {
        resultContainer.innerHTML = `
          <div class="p-4 bg-red-50 border border-red-200 rounded-lg">
            <div class="flex items-start space-x-3">
              <i class="fas fa-times-circle text-red-600 text-xl mt-0.5"></i>
              <div class="flex-1">
                <h5 class="text-sm font-semibold text-red-900 mb-1">❌ No Match</h5>
                <p class="text-xs text-red-700">
                  None of the triage rules matched this input. In production, this would trigger:
                  <br/>
                  <strong>serviceType: UNKNOWN</strong> → <strong>action: ESCALATE_TO_HUMAN</strong>
                </p>
              </div>
            </div>
          </div>
        `;
      }
      
    } catch (error) {
      console.error('[TRIAGE CARDS] Test failed:', error);
      resultContainer.classList.remove('hidden');
      resultContainer.innerHTML = `
        <div class="p-4 bg-red-50 border border-red-200 rounded-lg">
          <p class="text-xs text-red-700">❌ Test failed: ${error.message}</p>
        </div>
      `;
    }
  }
  
  simulateTriageMatching(text, triageMap) {
    const normalized = text.toLowerCase();
    
    // Loop through rules (already sorted by priority)
    for (const rule of triageMap) {
      // Check if ALL keywords are present
      const allKeywordsPresent = rule.keywords.every(kw => normalized.includes(kw.toLowerCase()));
      
      // Check if NO excludeKeywords are present
      const noExcludesPresent = !rule.excludeKeywords || rule.excludeKeywords.every(kw => !normalized.includes(kw.toLowerCase()));
      
      if (allKeywordsPresent && noExcludesPresent) {
        return { matched: true, rule };
      }
    }
    
    return { matched: false };
  }
  
  escapeForTemplate(str) {
    if (!str) return '';
    return str.replace(/`/g, '\\`').replace(/\$/g, '\\$').replace(/\\/g, '\\\\');
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════
  
  // ═══════════════════════════════════════════════════════════════════
  // MANUAL TRIAGE TABLE CRUD OPERATIONS
  // ═══════════════════════════════════════════════════════════════════
  
  addManualRule() {
    console.log('[MANUAL TRIAGE] Adding new rule');
    
    // Initialize manualTriageRules array if it doesn't exist
    if (!this.cheatSheet.manualTriageRules) {
      this.cheatSheet.manualTriageRules = [];
    }
    
    // Add new empty rule
    const newRule = {
      keywords: [],
      excludeKeywords: [],
      serviceType: 'REPAIR',
      action: 'DIRECT_TO_3TIER',
      explanation: '',
      qnaCard: '',
      priority: 100
    };
    
    this.cheatSheet.manualTriageRules.push(newRule);
    this.markDirty();
    this.renderManualTriageTable();
    
    // Scroll to the new rule
    setTimeout(() => {
      const table = document.querySelector('#manual-triage-table-section table tbody');
      if (table) {
        table.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  }
  
  updateManualRuleField(index, field, value) {
    console.log('[MANUAL TRIAGE] Updating rule', { index, field, value });
    
    if (!this.cheatSheet.manualTriageRules || !this.cheatSheet.manualTriageRules[index]) {
      console.error('[MANUAL TRIAGE] Rule not found at index:', index);
      return;
    }
    
    const rule = this.cheatSheet.manualTriageRules[index];
    
    // Handle array fields (keywords, excludeKeywords)
    if (field === 'keywords' || field === 'excludeKeywords') {
      // Split by comma, trim, filter empty
      rule[field] = value.split(',').map(k => k.trim()).filter(k => k.length > 0);
    } else {
      rule[field] = value;
    }
    
    this.markDirty();
    console.log('[MANUAL TRIAGE] Rule updated:', rule);
  }
  
  deleteManualRule(index) {
    console.log('[MANUAL TRIAGE] Deleting rule at index:', index);
    
    if (!this.cheatSheet.manualTriageRules || !this.cheatSheet.manualTriageRules[index]) {
      console.error('[MANUAL TRIAGE] Rule not found at index:', index);
      return;
    }
    
    // Confirm deletion
    if (!confirm('Delete this triage rule?')) {
      return;
    }
    
    this.cheatSheet.manualTriageRules.splice(index, 1);
    this.markDirty();
    this.renderManualTriageTable();
    this.showNotification('Rule deleted', 'success');
  }
  
  async saveManualRules() {
    console.log('[MANUAL TRIAGE] Saving rules...');
    
    try {
      const token = localStorage.getItem('adminToken');
      
      if (!token) {
        throw new Error('Not authenticated');
      }
      
      // Save entire cheatSheet (which includes manualTriageRules)
      const response = await fetch(`/api/company/${this.companyId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          aiAgentSettings: {
            cheatSheet: this.cheatSheet
          }
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Save failed');
      }
      
      // 🧠 Invalidate compiled triage cache (manual rules changed!)
      try {
        const cacheInvalidateResponse = await fetch(`/api/company/${this.companyId}/triage-cards/invalidate-cache`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (cacheInvalidateResponse.ok) {
          console.log('[MANUAL TRIAGE] ✅ Compiled triage cache invalidated - THE BRAIN will rebuild on next call');
        } else {
          console.warn('[MANUAL TRIAGE] ⚠️ Cache invalidation failed (non-critical)');
        }
      } catch (cacheErr) {
        console.warn('[MANUAL TRIAGE] ⚠️ Cache invalidation error (non-critical):', cacheErr.message);
      }
      
      this.isDirty = false;
      this.renderManualTriageTable();
      this.showNotification('✅ Manual rules saved successfully! THE BRAIN will use updated rules on next call.', 'success');
      
      console.log('[MANUAL TRIAGE] Save successful');
      
    } catch (error) {
      console.error('[MANUAL TRIAGE] Save failed:', error);
      this.showNotification(`❌ Save failed: ${error.message}`, 'error');
    }
  }
  
  markDirty() {
    this.isDirty = true;
    
    // Update Version Console if active
    if (this.useVersionConsole && this.csWorkspaceVersion) {
      this.csMarkDirty();
    }
  }
  
  showNotification(message, type = 'info') {
    // Use existing notification system if available
    if (typeof showNotification === 'function') {
      showNotification(message);
    } else {
      console.log(`[NOTIFICATION ${type.toUpperCase()}]`, message);
    }
  }

  /**
   * Show prominent success popup modal
   */
  showSuccessPopup(title, message) {
    console.log('[CHEAT SHEET] 🎉 Showing success popup:', title);
    
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 99999;
      animation: fadeIn 0.2s ease-in;
    `;
    
    // Create modal content
    const modal = document.createElement('div');
    modal.style.cssText = `
      background: white;
      border-radius: 16px;
      padding: 32px;
      max-width: 500px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      animation: slideIn 0.3s ease-out;
      text-align: center;
    `;
    
    modal.innerHTML = `
      <div style="font-size: 64px; margin-bottom: 16px; animation: bounce 0.6s ease-in-out;">
        ✅
      </div>
      <h2 style="font-size: 24px; font-weight: 700; color: #059669; margin-bottom: 12px;">
        ${title}
      </h2>
      <p style="font-size: 16px; color: #6b7280; margin-bottom: 24px;">
        ${message}
      </p>
      <button 
        onclick="this.closest('[style*=fixed]').remove()" 
        style="
          background: #059669;
          color: white;
          border: none;
          padding: 12px 32px;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        "
        onmouseover="this.style.background='#047857'"
        onmouseout="this.style.background='#059669'"
      >
        Got it!
      </button>
    `;
    
    // Add CSS animations
    const style = document.createElement('style');
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes slideIn {
        from { transform: translateY(-50px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      @keyframes bounce {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.2); }
      }
    `;
    document.head.appendChild(style);
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    // Auto-close after 3 seconds
    setTimeout(() => {
      if (overlay.parentNode) {
        overlay.style.animation = 'fadeOut 0.3s ease-out';
        setTimeout(() => overlay.remove(), 300);
      }
    }, 3000);
    
    console.log('[CHEAT SHEET] ✅ Success popup displayed');
  }

  /**
   * Show prominent error popup modal
   */
  showErrorPopup(title, message) {
    console.log('[CHEAT SHEET] ⚠️ Showing error popup:', title);
    
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 99999;
      animation: fadeIn 0.2s ease-in;
    `;
    
    // Create modal content
    const modal = document.createElement('div');
    modal.style.cssText = `
      background: white;
      border-radius: 16px;
      padding: 32px;
      max-width: 500px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      animation: slideIn 0.3s ease-out;
      text-align: center;
    `;
    
    modal.innerHTML = `
      <div style="font-size: 64px; margin-bottom: 16px; animation: shake 0.5s ease-in-out;">
        ❌
      </div>
      <h2 style="font-size: 24px; font-weight: 700; color: #dc2626; margin-bottom: 12px;">
        ${title}
      </h2>
      <p style="font-size: 16px; color: #6b7280; margin-bottom: 24px;">
        ${message}
      </p>
      <button 
        onclick="this.closest('[style*=fixed]').remove()" 
        style="
          background: #dc2626;
          color: white;
          border: none;
          padding: 12px 32px;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        "
        onmouseover="this.style.background='#b91c1c'"
        onmouseout="this.style.background='#dc2626'"
      >
        Understood
      </button>
    `;
    
    // Add CSS animations
    const style = document.createElement('style');
    style.textContent = `
      @keyframes shake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-10px); }
        75% { transform: translateX(10px); }
      }
      @keyframes fadeOut {
        from { opacity: 1; }
        to { opacity: 0; }
      }
    `;
    document.head.appendChild(style);
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    console.log('[CHEAT SHEET] ⚠️ Error popup displayed');
  }

  // ═══════════════════════════════════════════════════════════════════
  // TRIAGE EXAMPLES MODAL (Help System)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Open modal showing triage scenario examples
   */
  async openTriageExamplesModal() {
    console.log('[TRIAGE EXAMPLES] Opening examples modal...');
    
    try {
      // Get current selected trade
      const tradeSelect = document.getElementById('triage-trade-select');
      const selectedTrade = tradeSelect ? tradeSelect.value : '';
      
      // Dynamically import the examples data
      const { TRIAGE_EXAMPLES, getExamplesForIndustry, getAvailableIndustries } = await import('/js/aicore/triageExamples.js');
      
      // Get examples for the selected trade
      let examples = [];
      let industryKey = '';
      
      if (selectedTrade) {
        examples = getExamplesForIndustry(selectedTrade);
        industryKey = selectedTrade;
      }
      
      // If no examples for selected trade, show HVAC as default
      if (!examples || examples.length === 0) {
        examples = TRIAGE_EXAMPLES.HVAC.categories;
        industryKey = 'HVAC';
      }
      
      // Render the modal
      this.renderTriageExamplesModal(examples, industryKey, getAvailableIndustries());
      
    } catch (error) {
      console.error('[TRIAGE EXAMPLES] Error loading examples:', error);
      alert('Failed to load triage examples. Please try again.');
    }
  }

  /**
   * Render the triage examples modal
   */
  renderTriageExamplesModal(examples, industryKey, availableIndustries) {
    // Generate industry options
    const industryOptions = availableIndustries.map(ind => 
      `<option value="${ind.key}" ${ind.key === industryKey ? 'selected' : ''}>${ind.label} (${ind.count} examples)</option>`
    ).join('');
    
    // Create modal HTML
    const modalHTML = `
      <div id="triage-examples-modal" class="fixed inset-0 z-50 overflow-y-auto" style="background-color: rgba(0, 0, 0, 0.5);" onclick="if(event.target.id === 'triage-examples-modal') this.remove();">
        <div class="flex items-start justify-center min-h-screen px-4 pt-4 pb-20">
          <div onclick="event.stopPropagation();" class="relative bg-white rounded-lg shadow-xl max-w-6xl w-full my-8">
            
            <!-- Header -->
            <div class="sticky top-0 z-10 bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-6 py-5 rounded-t-lg">
              <div class="flex items-center justify-between">
                <div>
                  <h2 class="text-2xl font-bold">📚 How to Write a Good Triage Scenario</h2>
                  <p class="text-indigo-100 mt-1">Pick an example close to your business, then adjust the details</p>
                </div>
                <button 
                  onclick="document.getElementById('triage-examples-modal').remove()" 
                  class="text-white hover:text-gray-200 transition-colors"
                  title="Close"
                >
                  <i class="fas fa-times text-2xl"></i>
                </button>
              </div>
              
              <!-- Industry Selector -->
              <div class="mt-4">
                <label class="text-sm font-medium text-indigo-100 mb-2 block">View examples for:</label>
                <select 
                  id="examples-industry-selector" 
                  onchange="cheatSheetManager.switchExampleIndustry(this.value)"
                  class="px-4 py-2 bg-white text-gray-900 rounded-lg border-2 border-indigo-300 focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
                >
                  ${industryOptions}
                </select>
              </div>
            </div>
            
            <!-- Content -->
            <div id="examples-content-container" class="px-6 py-6 max-h-[70vh] overflow-y-auto">
              ${this.renderExampleCards(examples, industryKey)}
            </div>
            
            <!-- Footer -->
            <div class="sticky bottom-0 bg-gray-50 px-6 py-4 rounded-b-lg border-t border-gray-200">
              <div class="flex items-center justify-between">
                <p class="text-sm text-gray-600">
                  <i class="fas fa-lightbulb mr-1 text-yellow-500"></i>
                  <strong>Tip:</strong> Click <strong>"Insert"</strong> to paste an example directly into your scenario box
                </p>
                <button 
                  onclick="document.getElementById('triage-examples-modal').remove()" 
                  class="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    
    // Append to body
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    console.log('[TRIAGE EXAMPLES] Modal rendered');
  }

  /**
   * Render example cards (supports both categorized and flat structures)
   */
  renderExampleCards(examples, industryKey) {
    if (!examples || examples.length === 0) {
      return `
        <div class="text-center py-12">
          <i class="fas fa-info-circle text-4xl text-gray-400 mb-4"></i>
          <p class="text-gray-600">No examples available for this industry yet.</p>
          <p class="text-sm text-gray-500 mt-2">Use HVAC examples as a pattern.</p>
        </div>
      `;
    }
    
    // Check if this is categorized (HVAC) or flat (others)
    const isCategorized = examples[0] && examples[0].hasOwnProperty('name') && examples[0].hasOwnProperty('examples');
    
    if (isCategorized) {
      // HVAC: Categorized accordion structure
      const totalCount = examples.reduce((sum, cat) => sum + cat.examples.length, 0);
      
      return `
        <div class="mb-6">
          <h3 class="text-xl font-bold text-gray-900 mb-2">
            HVAC – ${totalCount} Triage Examples
          </h3>
          <p class="text-sm text-gray-600 mb-4">
            Organized by scenario type. Click any category to expand and view examples.
          </p>
        </div>
        
        <div class="space-y-3">
          ${examples.map((category, catIndex) => `
            <div class="border-2 border-gray-200 rounded-lg overflow-hidden">
              <!-- Category Header (Clickable) -->
              <button 
                onclick="this.nextElementSibling.classList.toggle('hidden'); this.querySelector('.accordion-icon').classList.toggle('rotate-180');"
                class="w-full px-5 py-4 bg-gradient-to-r from-indigo-50 to-purple-50 hover:from-indigo-100 hover:to-purple-100 transition-colors flex items-center justify-between text-left"
              >
                <div>
                  <h4 class="text-lg font-bold text-indigo-900 mb-1">
                    🔥 ${category.name}
                  </h4>
                  <p class="text-sm text-indigo-700">
                    ${category.subtitle} — ${category.examples.length} scenarios
                  </p>
                </div>
                <i class="fas fa-chevron-down accordion-icon text-indigo-600 transition-transform duration-200"></i>
              </button>
              
              <!-- Category Content (Initially Hidden) -->
              <div class="hidden bg-white">
                <div class="p-4 space-y-3">
                  ${category.examples.map((example, exIndex) => this.renderSingleExampleCard(example, exIndex + 1)).join('')}
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    } else {
      // DENTAL, ATTORNEY, APPOINTMENT_MANAGEMENT: Flat list
      const industryLabels = {
        'DENTAL': 'Dental Office',
        'ATTORNEY': 'Attorney/Law Firm',
        'APPOINTMENT_MANAGEMENT': 'Appointment Management'
      };
      
      const displayName = industryLabels[industryKey] || industryKey;
      
      return `
        <div class="mb-6">
          <h3 class="text-xl font-bold text-gray-900 mb-2">
            ${displayName} – ${examples.length} Triage Examples
          </h3>
          <p class="text-sm text-gray-600 mb-4">
            ${industryKey === 'APPOINTMENT_MANAGEMENT' 
              ? 'Universal scenarios for appointment logistics (applies to all industries).'
              : 'These examples show how to describe scenarios where the AI needs to correctly classify service type and prevent misclassification.'
            }
          </p>
        </div>
        
        <div class="space-y-4">
          ${examples.map((example, index) => this.renderSingleExampleCard(example, index + 1)).join('')}
        </div>
      `;
    }
  }

  /**
   * Render a single example card
   */
  renderSingleExampleCard(example, number) {
    return `
      <div class="bg-white border-2 border-gray-200 rounded-lg p-5 hover:border-indigo-300 transition-colors">
        <!-- Header -->
        <div class="flex items-start justify-between mb-3">
          <div class="flex-1">
            <div class="flex items-center gap-2 mb-2">
              <span class="inline-flex items-center justify-center w-8 h-8 bg-indigo-600 text-white rounded-full font-bold text-sm">
                ${number}
              </span>
              <h4 class="text-lg font-bold text-gray-900">${example.title}</h4>
            </div>
          </div>
        </div>
        
        <!-- Content -->
        <div class="bg-gray-50 rounded-lg p-4 mb-3 border border-gray-200">
          <p class="text-sm text-gray-700 leading-relaxed">${example.text}</p>
        </div>
        
        <!-- Actions -->
        <div class="flex gap-2">
          <button 
            onclick="cheatSheetManager.copyTriageExample('${example.id}')"
            class="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium text-sm"
          >
            <i class="fas fa-copy mr-2"></i>
            Copy Text
          </button>
          <button 
            onclick="cheatSheetManager.insertTriageExample('${example.id}')"
            class="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium text-sm"
          >
            <i class="fas fa-arrow-right mr-2"></i>
            Insert into Form
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Switch industry in examples modal
   */
  async switchExampleIndustry(industry) {
    console.log('[TRIAGE EXAMPLES] Switching to:', industry);
    
    try {
      // Import examples
      const { TRIAGE_EXAMPLES, getExamplesForIndustry } = await import('/js/aicore/triageExamples.js');
      
      // Get examples
      const examples = getExamplesForIndustry(industry);
      const industryName = industry;
      
      // Update content
      const container = document.getElementById('examples-content-container');
      if (container) {
        container.innerHTML = this.renderExampleCards(examples, industryName);
      }
      
    } catch (error) {
      console.error('[TRIAGE EXAMPLES] Error switching industry:', error);
    }
  }

  /**
   * Copy triage example to clipboard
   */
  async copyTriageExample(exampleId) {
    try {
      // Import examples
      const { TRIAGE_EXAMPLES } = await import('/js/aicore/triageExamples.js');
      
      // Find the example (search in both flat and categorized structures)
      let example = null;
      for (const industry in TRIAGE_EXAMPLES) {
        const data = TRIAGE_EXAMPLES[industry];
        
        // Check if categorized (HVAC)
        if (data.categories) {
          for (const category of data.categories) {
            const found = category.examples.find(ex => ex.id === exampleId);
            if (found) {
              example = found;
              break;
            }
          }
        } else if (Array.isArray(data)) {
          // Flat array (DENTAL, ATTORNEY, APPOINTMENT_MANAGEMENT)
          const found = data.find(ex => ex.id === exampleId);
          if (found) {
            example = found;
            break;
          }
        }
        
        if (example) break;
      }
      
      if (!example) {
        console.error('[TRIAGE EXAMPLES] Example not found:', exampleId);
        return;
      }
      
      // Copy to clipboard
      await navigator.clipboard.writeText(example.text);
      
      // Show success feedback
      this.showNotification('✅ Example copied to clipboard!', 'success');
      
      console.log('[TRIAGE EXAMPLES] Copied:', example.title);
      
    } catch (error) {
      console.error('[TRIAGE EXAMPLES] Copy failed:', error);
      this.showNotification('❌ Failed to copy to clipboard', 'error');
    }
  }

  /**
   * Insert triage example into textarea and close modal
   */
  async insertTriageExample(exampleId) {
    try {
      // Import examples
      const { TRIAGE_EXAMPLES } = await import('/js/aicore/triageExamples.js');
      
      // Find the example (search in both flat and categorized structures)
      let example = null;
      for (const industry in TRIAGE_EXAMPLES) {
        const data = TRIAGE_EXAMPLES[industry];
        
        // Check if categorized (HVAC)
        if (data.categories) {
          for (const category of data.categories) {
            const found = category.examples.find(ex => ex.id === exampleId);
            if (found) {
              example = found;
              break;
            }
          }
        } else if (Array.isArray(data)) {
          // Flat array (DENTAL, ATTORNEY, APPOINTMENT_MANAGEMENT)
          const found = data.find(ex => ex.id === exampleId);
          if (found) {
            example = found;
            break;
          }
        }
        
        if (example) break;
      }
      
      if (!example) {
        console.error('[TRIAGE EXAMPLES] Example not found:', exampleId);
        return;
      }
      
      // Insert into textarea
      const textarea = document.getElementById('triage-situation-textarea');
      if (textarea) {
        textarea.value = example.text;
        textarea.focus();
        
        // Scroll textarea into view
        textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      
      // Close modal
      const modal = document.getElementById('triage-examples-modal');
      if (modal) {
        modal.remove();
      }
      
      // Show success feedback
      this.showNotification('✅ Example inserted into scenario box!', 'success');
      
      console.log('[TRIAGE EXAMPLES] Inserted:', example.title);
      
    } catch (error) {
      console.error('[TRIAGE EXAMPLES] Insert failed:', error);
      this.showNotification('❌ Failed to insert example', 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // VERSION CONSOLE (Option A - Dropdown Driven Workspace Selection)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Render the Version Console (replaces old banner)
   * Shows dropdown to select workspace version, then shows/hides details panel
   */
  renderVersionConsole() {
    const statusEl = document.getElementById('cheatsheet-status');
    if (!statusEl) return;

    // Check if we have a workspace active
    const hasWorkspace = !!this.csWorkspaceVersion;
    
    // Determine live version details
    const hasLive = !!this.csLiveVersionId;
    const liveVersion = hasLive ? this.csVersions.find(v => v.versionId === this.csLiveVersionId) : null;
    const liveName = liveVersion?.name || 'Unnamed Version';
    
    // Format CREATED date from createdAt field
    const createdDate = liveVersion?.createdAt ? new Date(liveVersion.createdAt).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }) : null;
    
    // Format PUBLISHED LIVE date from activatedAt field
    const publishedDate = liveVersion?.activatedAt ? new Date(liveVersion.activatedAt).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }) : null;

    statusEl.innerHTML = `
      <!-- LIVE STATUS BANNER (Above Console) -->
      <div style="
        background: ${hasLive ? 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)' : 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)'};
        border: 2px solid ${hasLive ? '#10b981' : '#ef4444'};
        border-radius: 10px;
        padding: 12px 16px;
        margin-bottom: 12px;
        display: flex;
        align-items: center;
        gap: 12px;
      ">
        <!-- Status Light -->
        <div style="
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: ${hasLive ? '#10b981' : '#ef4444'};
          box-shadow: 0 0 8px ${hasLive ? 'rgba(16, 185, 129, 0.6)' : 'rgba(239, 68, 68, 0.6)'};
          animation: pulse 2s infinite;
        "></div>
        
        <!-- Status Text -->
        <div style="flex: 1;">
          ${hasLive ? `
            <div style="font-size: 13px; font-weight: 600; color: #065f46;">
              ✅ Live Configuration Active
            </div>
            <div style="font-size: 12px; color: #047857; margin-top: 2px;">
              <strong>${liveName}</strong>
            </div>
            ${createdDate ? `
              <div style="font-size: 11px; color: #059669; margin-top: 4px;">
                Created: ${createdDate}
              </div>
            ` : ''}
            ${publishedDate ? `
              <div style="font-size: 11px; color: #059669; font-weight: 600;">
                Published Live: ${publishedDate}
              </div>
            ` : ''}
          ` : `
            <div style="font-size: 13px; font-weight: 600; color: #991b1b;">
              ⚠️ No Live Configuration
            </div>
            <div style="font-size: 12px; color: #b91c1c; margin-top: 2px;">
              Create and publish a version to activate AI responses
            </div>
          `}
        </div>
      </div>
      
      <!-- VERSION CONSOLE -->
      <div id="cs-version-console" style="background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); border: 2px solid #0ea5e9; border-radius: 12px; padding: 16px; margin-bottom: 16px;">
        
        <!-- TOP ROW: DROPDOWN ONLY -->
        <div style="margin-bottom: ${hasWorkspace ? '16px' : '0'};">
          <div style="display: flex; align-items: center; gap: 12px;">
            <label for="cs-version-select" style="font-size: 13px; font-weight: 600; color: #0c4a6e; min-width: 140px;">
              Select version to edit:
            </label>
            <select 
              id="cs-version-select" 
              style="flex: 1; max-width: 400px; padding: 8px 12px; border: 2px solid #0ea5e9; border-radius: 8px; font-size: 13px; font-weight: 500; color: #0c4a6e; background: white; cursor: pointer;"
            >
              <option value="" disabled ${!hasWorkspace ? 'selected' : ''}>Choose version…</option>
            </select>
          </div>
        </div>

        <!-- SECOND ROW: ONLY VISIBLE WHEN A WORKSPACE IS ACTIVE -->
        <div id="cs-console-details" style="display: ${hasWorkspace ? 'block' : 'none'};">
          
          <!-- READ-ONLY BANNER (shown for Live/Archived versions) -->
          ${hasWorkspace && this.csWorkspaceVersion.readOnly ? `
            <div style="background: linear-gradient(135deg, #ecfdf3 0%, #d1fae5 100%); border: 2px solid #10b981; border-radius: 8px; padding: 12px 16px; margin-bottom: 12px; display: flex; align-items: center; gap: 12px;">
              <span style="font-size: 24px;">👁️</span>
              <div style="flex: 1;">
                <div style="font-size: 14px; font-weight: 700; color: #166534; margin-bottom: 2px;">
                  VIEW ONLY MODE
                </div>
                <div style="font-size: 12px; color: #166534;">
                  This is a ${this.csWorkspaceVersion.isLive || this.csWorkspaceVersion.status === 'live' ? 'LIVE' : 'ARCHIVED'} version and cannot be edited. To make changes, create a new draft from this version.
                </div>
              </div>
              <button 
                onclick="document.getElementById('cs-version-select').value = '__NEW_DRAFT__'; document.getElementById('cs-version-select').dispatchEvent(new Event('change'));"
                style="padding: 8px 16px; font-size: 13px; font-weight: 600; border-radius: 8px; border: none; background: #10b981; color: #ffffff; cursor: pointer; white-space: nowrap; box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3);"
              >
                🆕 Create Draft from This
              </button>
            </div>
          ` : ''}
          
          <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 12px;">
            
            <!-- Version ID (read-only) -->
            <div style="flex: 0 0 200px;">
              <label style="font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 4px;">
                Version ID
              </label>
              <input 
                id="cs-version-id" 
                type="text" 
                readonly 
                value="${hasWorkspace ? this.csWorkspaceVersion.versionId.substring(0, 12) + '...' : ''}"
                style="width: 100%; padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 12px; font-family: 'Monaco', monospace; background: #f8fafc; color: #475569;"
              />
            </div>

            <!-- Name of version (read-only - set at creation) -->
            <div style="flex: 1;">
              <label for="cs-version-name" style="font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 4px;">
                Name of version
              </label>
              <input 
                id="cs-version-name" 
                type="text" 
                readonly
                value="${hasWorkspace ? (this.csWorkspaceVersion.name || '') : ''}"
                style="width: 100%; padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; color: #475569; background: #f8fafc;"
                title="Version name is set at creation and cannot be changed"
              />
            </div>

            <!-- Action Buttons (HIDDEN in read-only mode) -->
            <div style="display: ${hasWorkspace && this.csWorkspaceVersion.readOnly ? 'none' : 'flex'}; align-items: flex-end; gap: 8px;">
              <button 
                id="cs-btn-save" 
                style="padding: 8px 16px; font-size: 13px; font-weight: 600; border-radius: 8px; border: none; cursor: pointer; transition: all 0.2s; ${
                  this.csHasUnsavedChanges 
                    ? 'background: #f59e0b; color: #ffffff; box-shadow: 0 2px 8px rgba(245, 158, 11, 0.3);' 
                    : 'background: #e5e7eb; color: #9ca3af; cursor: not-allowed;'
                }"
                ${!this.csHasUnsavedChanges ? 'disabled' : ''}
              >
                💾 Save
              </button>
              <button 
                id="cs-btn-close" 
                style="padding: 8px 16px; font-size: 13px; font-weight: 500; border-radius: 8px; border: 1px solid #64748b; background: transparent; color: #64748b; cursor: pointer; transition: all 0.2s;"
              >
                ✖ Close
              </button>
              <button 
                id="cs-btn-go-live" 
                style="padding: 8px 16px; font-size: 13px; font-weight: 600; border-radius: 8px; border: none; background: #10b981; color: #ffffff; cursor: pointer; box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3); transition: all 0.2s;"
              >
                🚀 Go Live
              </button>
            </div>
          </div>

          <!-- Status Pills -->
          <div style="display: flex; align-items: center; gap: 12px;">
            <span id="cs-status-live" style="display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; background: #ecfdf3; color: #166534;">
              Live: ${this.csLiveVersionId ? (this.csVersions.find(v => v.versionId === this.csLiveVersionId)?.name || this.csLiveVersionId.substring(0, 8)) : 'none'}
            </span>
            <span id="cs-status-workspace" style="display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; ${
              hasWorkspace && this.csWorkspaceVersion.readOnly 
                ? 'background: #ecfdf3; color: #166534;' 
                : 'background: #fef3c7; color: #92400e;'
            }">
              ${hasWorkspace && this.csWorkspaceVersion.readOnly ? '👁️ ' : ''}Workspace: ${hasWorkspace ? `${this.csWorkspaceVersion.name || this.csWorkspaceVersion.versionId.substring(0, 8)} (${this.csWorkspaceVersion.readOnly ? 'VIEW ONLY' : this.csWorkspaceVersion.status || 'DRAFT'})` : 'none selected'}
            </span>
          </div>
        </div>

      </div>
    `;

    // Render dropdown options
    this.csRenderDropdown();

    // Wire events
    this.csWireEvents();
  }

  /**
   * Populate the dropdown with versions
   * Structure: New Draft → Live Section (with indented drafts) → Archived Section
   */
  csRenderDropdown() {
    console.log('[VERSION CONSOLE] 🎨 csRenderDropdown HIERARCHICAL v2.1.0 - Rendering with visual structure');
    
    const select = document.getElementById('cs-version-select');
    if (!select) return;

    // Clear existing options except placeholder
    while (select.options.length > 1) {
      select.remove(1);
    }

    // New Draft button
    const optNew = document.createElement('option');
    optNew.value = '__NEW_DRAFT__';
    optNew.textContent = '🆕 New Draft (clone from Live)';
    select.appendChild(optNew);
    
    console.log('[VERSION CONSOLE] 📝 Added "New Draft" option');

    if (!Array.isArray(this.csVersions) || this.csVersions.length === 0) {
      console.log('[VERSION CONSOLE] ⚠️ No versions available');
      // If a workspace is active, select it
      if (this.csWorkspaceVersion) {
        select.value = this.csWorkspaceVersion.versionId;
      }
      return;
    }

    console.log('[VERSION CONSOLE] 📊 Total versions to render:', this.csVersions.length);

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // SECTION 1: LIVE VERSION + INDENTED DRAFTS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    // Find current live version
    const liveVersion = this.csVersions.find(v => v.isLive || v.status === 'live');
    console.log('[VERSION CONSOLE] ⭐ Live version found:', !!liveVersion);
    
    if (liveVersion) {
      // Section header (disabled option)
      const headerLive = document.createElement('option');
      headerLive.disabled = true;
      headerLive.textContent = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
      select.appendChild(headerLive);
      
      const sectionLabel = document.createElement('option');
      sectionLabel.disabled = true;
      sectionLabel.textContent = '⭐ LIVE VERSION';
      sectionLabel.style.fontWeight = '700';
      sectionLabel.style.background = '#ecfdf3';
      sectionLabel.style.color = '#166534';
      select.appendChild(sectionLabel);
      
      // Live version (read-only)
      const optLive = document.createElement('option');
      optLive.value = liveVersion.versionId;
      const last5Live = liveVersion.versionId.slice(-5);
      optLive.textContent = `⭐ ${liveVersion.name || 'Unnamed'} (${last5Live}) [VIEW ONLY]`;
      optLive.style.background = '#ecfdf3';
      optLive.style.color = '#166534';
      optLive.style.fontWeight = '600';
      select.appendChild(optLive);
      
      // Find drafts that belong to this live version (created after it)
      // For now, we'll treat ALL drafts as belonging to current live
      const drafts = this.csVersions.filter(v => v.status === 'draft');
      
      // Add DRAFTS section header if there are any drafts
      if (drafts.length > 0) {
        const draftsSectionLabel = document.createElement('option');
        draftsSectionLabel.disabled = true;
        draftsSectionLabel.textContent = '📝 DRAFTS';
        draftsSectionLabel.style.fontWeight = '700';
        draftsSectionLabel.style.background = '#fef3c7';
        draftsSectionLabel.style.color = '#92400e';
        draftsSectionLabel.style.paddingLeft = '8px';
        draftsSectionLabel.style.marginTop = '4px';
        select.appendChild(draftsSectionLabel);
      }
      
      drafts.forEach(draft => {
        const opt = document.createElement('option');
        opt.value = draft.versionId;
        const last5 = draft.versionId.slice(-5);
        
        // Extract timestamp for readable date
        const timestamp = draft.versionId.split('-')[1];
        const date = timestamp ? new Date(parseInt(timestamp)).toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit'
        }) : '';
        
        // INDENT with spaces (HTML entities for proper spacing in <option>)
        opt.textContent = `   📝 ${draft.name || 'Draft'} – ${date} (${last5})`;
        opt.style.paddingLeft = '24px';
        opt.style.background = '#fef3c7';
        opt.style.color = '#92400e';
        select.appendChild(opt);
      });
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // SECTION 2: ARCHIVED VERSIONS (if any)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    const archivedVersions = this.csVersions.filter(v => v.status === 'archived');
    
    if (archivedVersions.length > 0) {
      // Section divider
      const divider = document.createElement('option');
      divider.disabled = true;
      divider.textContent = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
      select.appendChild(divider);
      
      const archLabel = document.createElement('option');
      archLabel.disabled = true;
      archLabel.textContent = '📦 ARCHIVED VERSIONS';
      archLabel.style.fontWeight = '700';
      archLabel.style.color = '#64748b';
      select.appendChild(archLabel);
      
      archivedVersions.forEach(archived => {
        const opt = document.createElement('option');
        opt.value = archived.versionId;
        const last5 = archived.versionId.slice(-5);
        opt.textContent = `📦 ${archived.name || 'Archived'} (${last5}) [VIEW ONLY]`;
        opt.style.color = '#64748b';
        select.appendChild(opt);
      });
    }

    // If a workspace is active, select it
    if (this.csWorkspaceVersion) {
      select.value = this.csWorkspaceVersion.versionId;
    }
  }

  /**
   * Wire all event handlers for Version Console
   */
  csWireEvents() {
    const select = document.getElementById('cs-version-select');
    const btnSave = document.getElementById('cs-btn-save');
    const btnClose = document.getElementById('cs-btn-close');
    const btnGoLive = document.getElementById('cs-btn-go-live');
    const inputName = document.getElementById('cs-version-name');

    if (select) {
      select.removeEventListener('change', this.csHandleVersionSelectBound);
      this.csHandleVersionSelectBound = this.csHandleVersionSelect.bind(this);
      select.addEventListener('change', this.csHandleVersionSelectBound);
    }

    if (btnSave) {
      btnSave.removeEventListener('click', this.csHandleSaveBound);
      this.csHandleSaveBound = this.csHandleSave.bind(this);
      btnSave.addEventListener('click', this.csHandleSaveBound);
    }

    if (btnClose) {
      btnClose.removeEventListener('click', this.csHandleCloseBound);
      this.csHandleCloseBound = this.csHandleClose.bind(this);
      btnClose.addEventListener('click', this.csHandleCloseBound);
    }

    if (btnGoLive) {
      btnGoLive.removeEventListener('click', this.csHandleGoLiveBound);
      this.csHandleGoLiveBound = this.csHandleGoLive.bind(this);
      btnGoLive.addEventListener('click', this.csHandleGoLiveBound);
    }

    // Name input is read-only, no event handler needed
  }

  /**
   * Handle version selection from dropdown
   */
  async csHandleVersionSelect() {
    const select = document.getElementById('cs-version-select');
    if (!select) return;

    const val = select.value;
    if (!val) return;

    // If current workspace has unsaved changes, confirm before switching
    if (this.csWorkspaceVersion && this.csHasUnsavedChanges) {
      const confirmLeave = window.confirm(
        'You have unsaved changes in the current version. Switch anyway and lose them?'
      );
      if (!confirmLeave) {
        // Revert dropdown back to current workspace
        select.value = this.csWorkspaceVersion.versionId;
        return;
      }
    }

    if (val === '__NEW_DRAFT__') {
      // Create a new draft by cloning from Live
      await this.csCreateDraftFromLive();
    } else {
      // Check if selected version is LIVE or ARCHIVED (read-only)
      const selectedVersion = this.csVersions.find(v => v.versionId === val);
      const isReadOnly = selectedVersion && (selectedVersion.isLive || selectedVersion.status === 'live' || selectedVersion.status === 'archived');
      
      if (isReadOnly) {
        // Load as read-only (VIEW ONLY mode)
        await this.csLoadExistingVersion(val, true); // true = read-only
      } else {
        // Load as editable (DRAFT mode)
        await this.csLoadExistingVersion(val, false);
      }
    }

    this.csHasUnsavedChanges = false;
    this.renderVersionConsole();
    
    // Only unlock editing if NOT read-only
    const selectedVersion = this.csVersions.find(v => v.versionId === val);
    const isReadOnly = selectedVersion && (selectedVersion.isLive || selectedVersion.status === 'live' || selectedVersion.status === 'archived');
    
    if (!isReadOnly) {
      this.csUnlockCheatSheetEditing();
    } else {
      // Show content in read-only mode (visible but not editable)
      this.csShowReadOnlyMode();
      console.log('[VERSION CONSOLE] Loaded read-only version (VIEW ONLY mode)');
    }
  }

  /**
   * Create a new draft
   */
  async csCreateNewDraft() {
    try {
      const response = await this.versioningAdapter.createDraft('Untitled Draft', '');
      
      // Refresh version list
      await this.csFetchVersions();
      
      // Set as workspace
      this.csWorkspaceVersion = response;
      
      // Load empty config into UI
      this.csLoadConfigIntoCheatSheetUI(this.getDefaultCheatSheet());
      
      console.log('[VERSION CONSOLE] New draft created:', response.versionId);
    } catch (error) {
      console.error('[VERSION CONSOLE] Error creating new draft:', error);
      alert(`Failed to create draft: ${error.message}`);
    }
  }

  /**
   * Create draft from live (safe "edit live")
   * If liveId is not provided, uses the current live version
   */
  async csCreateDraftFromLive(liveId = null) {
    try {
      // Find live version if not provided
      if (!liveId) {
        const liveVersion = this.csVersions.find(v => v.isLive || v.status === 'live');
        if (!liveVersion) {
          alert('No live version found. Cannot create draft from live.');
          console.warn('[VERSION CONSOLE] No live version available to clone from');
          return;
        }
        liveId = liveVersion.versionId;
      }
      
      // Fetch the live version's full config
      const liveConfig = await this.versioningAdapter.getVersionConfig(liveId);
      
      if (!liveConfig) {
        alert('Failed to load live version configuration.');
        return;
      }
      
      // Create a new draft with that config
      const response = await this.versioningAdapter.createDraft(
        `Draft from Live – ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`,
        '',
        liveConfig
      );
      
      // Refresh version list
      await this.csFetchVersions();
      
      // Set as workspace
      this.csWorkspaceVersion = response;
      
      // Load config into UI
      this.csLoadConfigIntoCheatSheetUI(liveConfig);
      
      console.log('[VERSION CONSOLE] Draft created from live:', response.versionId);
    } catch (error) {
      console.error('[VERSION CONSOLE] Error creating draft from live:', error);
      
      // Check if error is due to existing draft
      if (error.message && error.message.includes('already has an active draft')) {
        // Find the existing draft mentioned in error message
        const draftIdMatch = error.message.match(/draft-[\d]+-[a-z0-9]+/);
        const existingDraftId = draftIdMatch ? draftIdMatch[0] : null;
        
        if (existingDraftId) {
          const confirmSwitch = confirm(
            'You already have an active draft. Would you like to edit that draft instead?\n\n' +
            'Click OK to load the existing draft, or Cancel to keep viewing the live version.'
          );
          
          if (confirmSwitch) {
            // Load the existing draft
            await this.csLoadExistingVersion(existingDraftId, false);
            this.csHasUnsavedChanges = false;
            this.renderVersionConsole();
            this.csUnlockCheatSheetEditing();
            return;
          } else {
            // User cancelled, keep live version selected and in read-only mode
            const select = document.getElementById('cs-version-select');
            if (select && this.csLiveVersionId) {
              select.value = this.csLiveVersionId;
            }
            return;
          }
        }
      }
      
      alert(`Failed to create draft from live: ${error.message}`);
    }
  }

  /**
   * Load an existing version (from Local Configs)
   * @param {string} versionId - The version ID to load
   * @param {boolean} readOnly - If true, loads in VIEW ONLY mode (no editing)
   */
  async csLoadExistingVersion(versionId, readOnly = false) {
    try {
      const config = await this.versioningAdapter.getVersionConfig(versionId);
      const version = this.csVersions.find(v => v.versionId === versionId);
      
      if (!version) {
        throw new Error('Version not found in local list');
      }
      
      // Set as workspace (even in read-only mode, to display details)
      this.csWorkspaceVersion = {
        ...version,
        readOnly: readOnly
      };
      
      // Load config into UI
      this.csLoadConfigIntoCheatSheetUI(config);
      
      if (readOnly) {
        console.log('[VERSION CONSOLE] Loaded existing version (READ-ONLY):', versionId);
      } else {
        console.log('[VERSION CONSOLE] Loaded existing version:', versionId);
      }
    } catch (error) {
      console.error('[VERSION CONSOLE] Error loading existing version:', error);
      alert(`Failed to load version: ${error.message}`);
    }
  }

  /**
   * Handle Save button click
   * Saves current workspace version config (name is read-only after creation)
   */
  async csHandleSave() {
    if (!this.csWorkspaceVersion) return;

    try {
      // Collect current config from UI
      const config = this.csCollectConfigFromCheatSheetUI();
      
      // Debug: Log what we're sending
      console.log('[VERSION CONSOLE] 🔍 Config being saved:', {
        hasSchemaVersion: !!config.schemaVersion,
        schemaVersion: config.schemaVersion,
        configKeys: Object.keys(config),
        configSample: {
          schemaVersion: config.schemaVersion,
          bookingRulesCount: config.bookingRules?.length,
          linksCount: config.links?.length
        }
      });
      
      // Disable save button during save
      const btnSave = document.getElementById('cs-btn-save');
      if (btnSave) {
        btnSave.disabled = true;
        btnSave.textContent = '💾 Saving...';
      }
      
      // Save via adapter (uses correct saveDraft method)
      await this.versioningAdapter.saveDraft(config);
      
      // Update local state
      this.csWorkspaceVersion.config = config;
      
      // Refresh version list to get updated timestamps
      await this.csFetchVersions();
      
      this.csHasUnsavedChanges = false;
      this.renderVersionConsole();
      
      // If Version History is currently visible, refresh it to show updated data
      this.csRefreshVersionHistoryIfVisible();
      
      console.log('[VERSION CONSOLE] ✅ Version saved:', this.csWorkspaceVersion.versionId);
      
      // Show brief success indicator
      if (btnSave) {
        btnSave.textContent = '✅ Saved';
        setTimeout(() => {
          if (btnSave && !this.csHasUnsavedChanges) {
            btnSave.textContent = '💾 Save';
          }
        }, 1500);
      }
      
    } catch (error) {
      console.error('[VERSION CONSOLE] ❌ Error saving version:', error);
      alert(`❌ Failed to save version:\n\n${error.message}`);
      
      // Reset button
      const btnSave = document.getElementById('cs-btn-save');
      if (btnSave) {
        btnSave.disabled = false;
        btnSave.textContent = '💾 Save';
      }
    }
  }

  /**
   * Handle Close button click
   * Prompts to save if dirty, then deselects workspace
   */
  async csHandleClose() {
    if (!this.csWorkspaceVersion) return;

    if (this.csHasUnsavedChanges) {
      const proceed = window.confirm(
        '⚠️ UNSAVED CHANGES\n\n' +
        `You have unsaved changes in "${this.csWorkspaceVersion.name}".\n\n` +
        'Click OK to save before closing, or Cancel to discard changes.'
      );
      
      if (proceed) {
        // User chose to save
        await this.csHandleSave();
        // After save, confirm they still want to close
        const confirmClose = window.confirm('Changes saved. Close this workspace now?');
        if (!confirmClose) return; // User cancelled close
      } else {
        // User chose to discard - confirm one more time
        const confirmDiscard = window.confirm(
          '⚠️ CONFIRM DISCARD\n\n' +
          'Are you sure you want to close without saving?\n\n' +
          'All unsaved changes will be lost.'
        );
        if (!confirmDiscard) return; // User cancelled discard
      }
    }

    // Close workspace
    this.csWorkspaceVersion = null;
    this.csHasUnsavedChanges = false;
    
    const select = document.getElementById('cs-version-select');
    if (select) select.value = '';
    
    this.renderVersionConsole();
    this.csLockCheatSheetEditing();
    this.csClearCheatSheetUI();
    
    console.log('[VERSION CONSOLE] Workspace closed');
  }

  /**
   * Handle Go Live button click
   * OPTION A: STRICT RULES - Must save before going live
   */
  async csHandleGoLive() {
    if (!this.csWorkspaceVersion) return;

    // OPTION A: STRICT - Require save first (no dirty publish allowed)
    if (this.csHasUnsavedChanges) {
      alert('⚠️ You must save your changes before going live.\n\nClick the "💾 Save" button first, then try "Go Live" again.');
      return;
    }

    const confirmLive = window.confirm(
      '🚀 PUBLISH TO LIVE\n\n' +
      `This will make "${this.csWorkspaceVersion.name}" the active live configuration.\n\n` +
      'All customer calls will use this configuration immediately.\n\n' +
      'Continue?'
    );
    if (!confirmLive) return;

    try {
      // Call the new /publish endpoint
      const token = localStorage.getItem('adminToken');
      const response = await fetch(
        `/api/cheatsheet/versions/${this.companyId}/${this.csWorkspaceVersion.versionId}/publish`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({})
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      
      // Update local state
      this.csVersions = data.data.versions;
      this.csLiveVersionId = data.data.liveVersionId;
      
      // Update workspace to point to the now-live version
      const ws = this.csVersions.find(v => v.versionId === this.csWorkspaceVersion.versionId);
      this.csWorkspaceVersion = ws || this.csWorkspaceVersion;
      
      this.renderVersionConsole();
      
      // If Version History is currently visible, refresh it to show updated data
      this.csRefreshVersionHistoryIfVisible();
      
      console.log('[VERSION CONSOLE] Version published as live:', this.csLiveVersionId);
      alert('✅ Version published successfully!');
    } catch (error) {
      console.error('[VERSION CONSOLE] Error publishing version:', error);
      alert(`Failed to publish version: ${error.message}`);
    }
  }

  /**
   * Mark workspace as having unsaved changes
   */
  csMarkDirty() {
    this.csHasUnsavedChanges = true;
    const btnSave = document.getElementById('cs-btn-save');
    if (btnSave) {
      btnSave.disabled = false;
      btnSave.style.background = '#f59e0b';
      btnSave.style.color = '#ffffff';
      btnSave.style.boxShadow = '0 2px 8px rgba(245, 158, 11, 0.3)';
      btnSave.style.cursor = 'pointer';
    }
  }

  /**
   * Load a config object into the CheatSheet UI
   * Converts V1 object sections back to strings for UI compatibility
   */
  csLoadConfigIntoCheatSheetUI(config) {
    // Denormalize V1 sections from objects back to strings
    const denormalizeV1Section = (value) => {
      if (!value) return '';
      if (typeof value === 'string') return value;
      if (typeof value === 'object' && value.instructions) return value.instructions;
      return '';
    };
    
    this.cheatSheet = {
      ...config,
      // Convert V1 object sections back to strings for UI
      triage: denormalizeV1Section(config.triage),
      frontlineIntel: denormalizeV1Section(config.frontlineIntel),
      transferRules: denormalizeV1Section(config.transferRules),
      edgeCases: denormalizeV1Section(config.edgeCases),
      behavior: denormalizeV1Section(config.behavior),
      guardrails: denormalizeV1Section(config.guardrails)
    };
    
    this.render();
  }

  /**
   * Collect current config from CheatSheet UI
   * Returns config in the format expected by backend validator
   */
  csCollectConfigFromCheatSheetUI() {
    // Extract only the config fields, ensuring schemaVersion is present
    // ⚠️ CRITICAL: V1 sections MUST be objects, not strings
    // If stored as strings in this.cheatSheet, wrap them in {instructions: "..."} format
    
    const normalizeV1Section = (value) => {
      if (!value) return {};
      if (typeof value === 'string') return { instructions: value };
      if (typeof value === 'object') return value;
      return {};
    };
    
    return {
      schemaVersion: this.cheatSheet.schemaVersion || 1,
      
      // V1 Legacy sections (MUST be objects)
      triage: normalizeV1Section(this.cheatSheet.triage),
      frontlineIntel: normalizeV1Section(this.cheatSheet.frontlineIntel),
      transferRules: normalizeV1Section(this.cheatSheet.transferRules),
      edgeCases: normalizeV1Section(this.cheatSheet.edgeCases),
      behavior: normalizeV1Section(this.cheatSheet.behavior),
      guardrails: normalizeV1Section(this.cheatSheet.guardrails),
      
      // V2 Structured sections
      bookingRules: this.cheatSheet.bookingRules || [],
      companyContacts: this.cheatSheet.companyContacts || [],
      links: this.cheatSheet.links || [],
      calculators: this.cheatSheet.calculators || []
    };
  }

  /**
   * Lock CheatSheet editing (when no workspace selected)
   * - Shows lockout screen
   * - Fades config tabs (orange + blue groups)
   * - Hides all config tab content
   */
  csLockCheatSheetEditing() {
    console.log('[VERSION CONSOLE] 🔒 CheatSheet editing locked');
    
    // Show lockout screen
    const lockoutScreen = document.getElementById('workspace-lockout-screen');
    if (lockoutScreen) {
      lockoutScreen.style.display = 'block';
    }
    
    // Hide all config tab content areas
    const configContentAreas = [
      'cheatsheet-subtab-triage',
      'cheatsheet-subtab-frontline-intel',
      'cheatsheet-subtab-transfer-calls',
      'cheatsheet-subtab-edge-cases',
      'cheatsheet-subtab-behavior',
      'cheatsheet-subtab-guardrails',
      'cheatsheet-v2-dynamic-content'
    ];
    
    configContentAreas.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    
    // HIDE config tabs completely (orange + blue groups, NOT green admin group)
    const configTabs = document.querySelectorAll('.tab-ai-behavior, .tab-reference');
    configTabs.forEach(tab => {
      tab.style.display = 'none';
      tab.setAttribute('data-locked', 'true');
    });
    
    // Ensure green admin tabs stay visible and accessible (explicit override)
    const adminTabs = document.querySelectorAll('.tab-admin');
    adminTabs.forEach(tab => {
      tab.style.display = '';
      tab.style.opacity = '1';
      tab.style.cursor = 'pointer';
      tab.style.pointerEvents = 'auto';
      tab.removeAttribute('data-locked');
    });
  }

  /**
   * Unlock CheatSheet editing (when workspace selected)
   * - Hides lockout screen
   * - Restores config tab visibility
   * - Enables config tab interactions
   */
  csUnlockCheatSheetEditing() {
    console.log('[VERSION CONSOLE] ✅ CheatSheet editing unlocked');
    
    // Hide lockout screen
    const lockoutScreen = document.getElementById('workspace-lockout-screen');
    if (lockoutScreen) {
      lockoutScreen.style.display = 'none';
    }
    
    // Restore config tab content areas to be ready for display
    const configContentAreas = [
      'cheatsheet-subtab-triage',
      'cheatsheet-subtab-frontline-intel',
      'cheatsheet-subtab-transfer-calls',
      'cheatsheet-subtab-edge-cases',
      'cheatsheet-subtab-behavior',
      'cheatsheet-subtab-guardrails',
      'cheatsheet-v2-dynamic-content'
    ];
    
    configContentAreas.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        // Remove the forced display:none from lockdown
        // switchSubTab will handle showing the correct one
        el.style.display = '';
      }
    });
    
    // SHOW and restore config tabs to full visibility
    const configTabs = document.querySelectorAll('.tab-ai-behavior, .tab-reference');
    configTabs.forEach(tab => {
      tab.style.display = ''; // SHOW the tab (remove display:none)
      tab.style.opacity = '1';
      tab.style.cursor = 'pointer';
      tab.style.pointerEvents = 'auto';
      tab.removeAttribute('data-locked');
    });
    
    console.log('[VERSION CONSOLE] 🔓 Unlocked and restored', configTabs.length, 'config tabs');
    
    // Auto-switch to Booking Rules for clean UX (first config tab users typically need)
    console.log('[VERSION CONSOLE] 📅 Switching to Booking Rules tab');
    this.switchSubTab('booking');
  }

  /**
   * Show content in READ-ONLY mode (visible but not editable)
   * Used when viewing LIVE or ARCHIVED versions
   */
  csShowReadOnlyMode() {
    console.log('[VERSION CONSOLE] 👁️ Showing content in READ-ONLY mode');
    
    // Hide lockout screen (we want to see content)
    const lockoutScreen = document.getElementById('workspace-lockout-screen');
    if (lockoutScreen) {
      lockoutScreen.style.display = 'none';
    }
    
    // Show all config tab content areas
    const configContentAreas = [
      'cheatsheet-subtab-triage',
      'cheatsheet-subtab-frontline-intel',
      'cheatsheet-subtab-transfer-calls',
      'cheatsheet-subtab-edge-cases',
      'cheatsheet-subtab-behavior',
      'cheatsheet-subtab-guardrails',
      'cheatsheet-v2-dynamic-content'
    ];
    
    configContentAreas.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = '';
    });
    
    // Show config tabs (make them visible and clickable)
    const configTabs = document.querySelectorAll('.tab-ai-behavior, .tab-reference');
    configTabs.forEach(tab => {
      tab.style.display = '';
      tab.style.opacity = '0.7'; // Slightly faded to indicate read-only
      tab.style.cursor = 'pointer';
      tab.style.pointerEvents = 'auto';
      tab.removeAttribute('data-locked');
    });
    
    // Ensure admin tabs stay fully visible
    const adminTabs = document.querySelectorAll('.tab-admin');
    adminTabs.forEach(tab => {
      tab.style.display = '';
      tab.style.opacity = '1';
      tab.style.cursor = 'pointer';
      tab.style.pointerEvents = 'auto';
    });
    
    console.log('[VERSION CONSOLE] 👁️ Content visible in READ-ONLY mode');
    
    // Auto-switch to Booking Rules to show content
    this.switchSubTab('booking');
    
    // Disable all "Add" and "Edit" buttons after rendering
    setTimeout(() => this.csDisableEditButtons(), 100);
  }

  /**
   * Disable all edit/add/delete buttons in READ-ONLY mode
   */
  csDisableEditButtons() {
    // Disable all buttons that modify data
    const editButtons = document.querySelectorAll(
      'button[onclick*="add"], button[onclick*="edit"], button[onclick*="delete"], ' +
      '.add-booking-rule-btn, .add-contact-btn, .add-link-btn, .add-calculator-btn, ' +
      'button:not(.cheatsheet-subtab-btn):not(#cs-btn-close)'
    );
    
    editButtons.forEach(btn => {
      const btnText = btn.textContent.toLowerCase();
      if (btnText.includes('add') || btnText.includes('edit') || btnText.includes('delete') || btnText.includes('save')) {
        btn.disabled = true;
        btn.style.opacity = '0.4';
        btn.style.cursor = 'not-allowed';
        btn.title = '🔒 READ-ONLY: Cannot edit LIVE version';
      }
    });
    
    console.log('[VERSION CONSOLE] 🔒 Disabled all edit buttons (READ-ONLY mode)');
  }

  /**
   * Clear CheatSheet UI
   */
  csClearCheatSheetUI() {
    // Optionally clear all fields or show a message
    console.log('[VERSION CONSOLE] CheatSheet UI cleared');
  }

  /**
   * Fetch all versions for this company
   */
  async csFetchVersions() {
    try {
      const versions = await this.versioningAdapter.getVersionHistory(100);
      this.csVersions = Array.isArray(versions) ? versions : [];
      
      // Determine live version ID
      const live = this.csVersions.find(v => v.isLive || v.status === 'live');
      this.csLiveVersionId = live ? live.versionId : null;
      
      console.log('[VERSION CONSOLE] Fetched versions:', this.csVersions.length);
    } catch (error) {
      console.error('[VERSION CONSOLE] Error fetching versions:', error);
      this.csVersions = [];
      this.csLiveVersionId = null;
    }
  }

  /**
   * Initialize Version Console state
   */
  async csInit() {
    this.csVersions = [];
    this.csLiveVersionId = null;
    this.csWorkspaceVersion = null;
    this.csHasUnsavedChanges = false;

    await this.csFetchVersions();
    this.renderVersionConsole();
    this.csLockCheatSheetEditing();
  }

  /**
   * Bridge: Called from Version History to load a version into the Workspace
   * This is the single integration point between Version History and Version Console
   */
  async csSetWorkspaceFromHistory(versionId) {
    const select = document.getElementById('cs-version-select');
    if (!select) return;

    // If there are unsaved changes in current workspace, reuse the same logic as dropdown
    if (this.csWorkspaceVersion && this.csHasUnsavedChanges) {
      const confirmLeave = window.confirm(
        'You have unsaved changes in the current version. Switch anyway and lose them?'
      );
      if (!confirmLeave) {
        // Keep current workspace, do not switch
        select.value = this.csWorkspaceVersion.versionId;
        return;
      }
    }

    // Set the dropdown value and trigger its normal handler
    select.value = versionId;
    
    // Reuse the same handler we wired for the dropdown
    await this.csHandleVersionSelect();
    
    console.log('[VERSION CONSOLE] Workspace set from Version History:', versionId);
  }

  /**
   * Wire Version History "Edit" buttons to the Version Console
   * Called after Version History DOM is rendered
   */
  bindVersionHistoryEvents() {
    const buttons = document.querySelectorAll('.js-cs-version-edit');
    if (!buttons.length) {
      console.log('[VERSION CONSOLE] No Version History edit buttons found yet');
      return;
    }

    buttons.forEach(btn => {
      btn.removeEventListener('click', this.handleVersionHistoryEditBound);
      
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const versionId = btn.getAttribute('data-version-id');
        if (!versionId) {
          console.error('[VERSION CONSOLE] Edit button missing data-version-id');
          return;
        }

        await this.csSetWorkspaceFromHistory(versionId);
      });
    });

    console.log('[VERSION CONSOLE] Wired', buttons.length, 'Version History edit buttons');
  }

  /**
   * Refresh Version History UI if it's currently visible
   * Called after Save or Go Live to keep both views in sync
   */
  csRefreshVersionHistoryIfVisible() {
    // Check if Version History tab is currently active
    const versionHistoryContainer = document.getElementById('cheatsheet-v2-dynamic-content');
    if (versionHistoryContainer && versionHistoryContainer.style.display !== 'none') {
      // Check if we're on the version-history sub-tab
      if (this.currentSubTab === 'version-history') {
        console.log('[VERSION CONSOLE] Refreshing Version History UI after change');
        this.renderVersionHistory();
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // END VERSION CONSOLE
  // ═══════════════════════════════════════════════════════════════════════
}

// ═══════════════════════════════════════════════════════════════════
// EXPOSE CLASS AND CREATE GLOBAL INSTANCE
// ═══════════════════════════════════════════════════════════════════
// Export class for Control Plane to create its own instance
if (typeof window !== 'undefined') {
    window.CheatSheetManager = CheatSheetManager;
}

// Create global instance for company-profile.html
window.cheatSheetManager = new CheatSheetManager();
console.log('✅ CheatSheetManager loaded and available globally');

