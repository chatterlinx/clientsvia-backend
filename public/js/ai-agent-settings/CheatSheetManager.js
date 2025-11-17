// public/js/ai-agent-settings/CheatSheetManager.js
// ============================================================================
// CHEAT SHEET MANAGER - Admin UI Controller
// ============================================================================
// PURPOSE: Manage company-specific cheat sheet rules and policies
// FEATURES: Visual editor, live compilation, conflict detection, test harness
// ARCHITECTURE: Load → Edit → Compile → Test → Deploy
// ============================================================================

class CheatSheetManager {
  
  constructor(options = {}) {
    this.companyId = null;
    this.cheatSheet = null;
    this.compilationStatus = null;
    this.isDirty = false;
    this.currentSubTab = 'triage'; // Default sub-tab
    this.rootSelector = options.rootSelector || '#cheatsheet-container';
    this.rootElement = (typeof document !== 'undefined') ? document.querySelector(this.rootSelector) : null;
    
    this.ensureBaseLayout();
    console.log('✅ [CHEAT SHEET MANAGER] Initialized');
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // SUB-TAB NAVIGATION
  // ═══════════════════════════════════════════════════════════════════
  
  switchSubTab(subTab) {
    console.log(`[CHEAT SHEET] Switching to sub-tab: ${subTab}`);
    
    this.currentSubTab = subTab;
    
    // Hide all sub-tab contents
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

    this.attachQuickSetupToggle();
  }

  getDefaultLayoutMarkup() {
    return `
      <div data-cheatsheet-layout="control-plane-v2" style="display:flex; flex-direction:column; gap:24px;">
        <div id="cheatsheet-status"></div>

        <div data-cheatsheet-quicksetup style="border:1px solid #e0e7ff; border-radius:12px; background:linear-gradient(90deg,#eef2ff,#f5f3ff); padding:12px 16px;">
          <button id="cheatsheet-quicksetup-toggle" type="button" style="width:100%; display:flex; align-items:center; justify-content:space-between; background:none; border:none; color:#4338ca; font-weight:600; font-size:14px; cursor:pointer;">
            <span style="display:flex; align-items:center; gap:8px;">
              <i class="fas fa-magic"></i>
              Quick Setup Shortcuts
            </span>
            <i class="fas fa-chevron-down" aria-hidden="true"></i>
          </button>
          <div id="cheatsheet-quicksetup-content" style="margin-top:12px; display:none; flex-wrap:wrap; gap:8px;">
            <button onclick="cheatSheetManager?.showImportFromTemplateModal()" style="padding:10px 14px; border-radius:999px; border:none; background:#4f46e5; color:#fff; font-weight:600; display:flex; align-items:center; gap:6px;">
              <i class="fas fa-download"></i>
              Import from Template
            </button>
            <button onclick="cheatSheetManager?.showImportFromCompanyModal()" style="padding:10px 14px; border-radius:999px; border:none; background:#7c3aed; color:#fff; font-weight:600; display:flex; align-items:center; gap:6px;">
              <i class="fas fa-copy"></i>
              Copy from Company
            </button>
            <button onclick="cheatSheetManager?.exportAsJSON()" style="padding:10px 14px; border-radius:999px; border:none; background:#475569; color:#fff; font-weight:600; display:flex; align-items:center; gap:6px;">
              <i class="fas fa-file-export"></i>
              Export JSON
            </button>
            <button onclick="cheatSheetManager?.resetToDefaults()" style="padding:10px 14px; border-radius:999px; border:none; background:#d97706; color:#fff; font-weight:600; display:flex; align-items:center; gap:6px;">
              <i class="fas fa-undo"></i>
              Reset Defaults
            </button>
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
          <div id="transfer-rules-section">
            <div id="transfer-rules-list"></div>
          </div>
        </div>

        <div id="cheatsheet-subtab-edge-cases" class="cheatsheet-subtab-content hidden">
          <div id="edge-cases-section">
            <div id="edge-cases-list"></div>
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
      </div>
    `;
  }

  attachQuickSetupToggle() {
    if (!this.rootElement) return;
    const toggle = this.rootElement.querySelector('#cheatsheet-quicksetup-toggle');
    const content = this.rootElement.querySelector('#cheatsheet-quicksetup-content');
    if (!toggle || !content || toggle.dataset.initialized) {
      return;
    }

    toggle.dataset.initialized = 'true';
    let open = false;
    const icon = toggle.querySelector('i[aria-hidden="true"]');

    const setState = () => {
      content.style.display = open ? 'flex' : 'none';
      if (icon) {
        icon.classList.toggle('fa-chevron-up', open);
        icon.classList.toggle('fa-chevron-down', !open);
      }
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    };

    setState();

    toggle.addEventListener('click', () => {
      open = !open;
      setState();
    });
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // LOAD CHEAT SHEET
  // ═══════════════════════════════════════════════════════════════════
  
  async load(companyId) {
    this.companyId = companyId;
    
    console.log('[CHEAT SHEET] Loading for company:', companyId);
    
    try {
      const token = localStorage.getItem('adminToken');
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
      
      this.cheatSheet = company.aiAgentSettings?.cheatSheet || this.getDefaultCheatSheet();
      
      console.log('[CHEAT SHEET] Loaded successfully:', this.cheatSheet);
      
      this.render();
      this.switchSubTab('triage'); // Initialize to Triage sub-tab
      this.isDirty = false;
      
    } catch (error) {
      console.error('[CHEAT SHEET] Load failed:', error);
      this.showNotification('Failed to load cheat sheet', 'error');
      
      // Load defaults
      this.cheatSheet = this.getDefaultCheatSheet();
      this.render();
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
      allowedActions: []
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // RENDER UI
  // ═══════════════════════════════════════════════════════════════════
  
  render() {
    this.renderStatus();
    this.renderCompanyInstructions();
    this.renderTriageCardsList(); // 🎯 Triage Cards Management (atomic source of truth) - FIRST
    this.renderManualTriageTable(); // 📋 Manual Triage Rules Editor (quick add/edit) - SECOND
    this.renderTriageBuilder(); // 🤖 AI Triage Builder (enterprise content generator) - THIRD
    this.renderBehaviorRules();
    this.renderEdgeCases();
    this.renderTransferRules();
    this.renderGuardrails();
    this.renderActionAllowlist();
  }
  
  renderStatus() {
    const statusEl = document.getElementById('cheatsheet-status');
    if (!statusEl) return;
    
    const isDraft = this.cheatSheet.status === 'draft';
    const hasChecksum = Boolean(this.cheatSheet.checksum);
    
    statusEl.innerHTML = `
      <div class="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg p-4">
        <div class="flex items-center space-x-4">
          <div class="flex items-center">
            <span class="text-sm font-medium text-gray-700 mr-2">Status:</span>
            <span class="px-3 py-1 rounded-full text-sm font-medium ${isDraft ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}">
              ${isDraft ? '📝 Draft' : '✅ Active'}
            </span>
          </div>
          
          ${hasChecksum ? `
            <div class="flex items-center">
              <span class="text-sm font-medium text-gray-700 mr-2">Checksum:</span>
              <code class="px-2 py-1 bg-gray-100 rounded text-xs font-mono">${this.cheatSheet.checksum.substring(0, 12)}...</code>
            </div>
          ` : '<span class="text-sm text-gray-500 italic">Not compiled yet</span>'}
          
          <div class="flex items-center">
            <span class="text-sm font-medium text-gray-700 mr-2">Version:</span>
            <span class="text-sm text-gray-600">${this.cheatSheet.version}</span>
          </div>
        </div>
        
        <div class="flex items-center space-x-2">
          ${hasChecksum ? `
            <button onclick="cheatSheetManager.testCheatSheet()" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">
              🧪 Test Rules
            </button>
          ` : ''}
          
          <button onclick="cheatSheetManager.compileCheatSheet()" class="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium" ${!this.isDirty ? 'disabled opacity-50 cursor-not-allowed' : ''}>
            🔧 ${hasChecksum ? 'Recompile' : 'Compile'} Policy
          </button>
          
          ${!isDraft ? `
            <button onclick="cheatSheetManager.setStatus('draft')" class="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors text-sm font-medium">
              📝 Mark as Draft
            </button>
          ` : `
            <button onclick="cheatSheetManager.setStatus('active')" class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium" ${!hasChecksum ? 'disabled opacity-50 cursor-not-allowed' : ''}>
              ✅ Activate
            </button>
          `}
        </div>
      </div>
    `;
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // RENDER COMPANY INSTRUCTIONS
  // ═══════════════════════════════════════════════════════════════════
  
  renderCompanyInstructions() {
    const container = document.getElementById('company-instructions-section');
    if (!container) return;
    
    const instructions = this.cheatSheet.frontlineIntel || '';
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
    
    try {
      const token = localStorage.getItem('adminToken'); // FIX: Use correct token key
      const response = await fetch(`/api/admin/cheat-sheet/${this.companyId}/reset-instructions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) throw new Error('Reset failed');
      
      const result = await response.json();
      
      // Update local state
      this.cheatSheet.frontlineIntel = result.frontlineIntel;
      
      // Re-render to show updated instructions
      this.renderCompanyInstructions();
      this.markDirty();
      
      this.showNotification('✅ Frontline-Intel reset to default template!', 'success');
      
    } catch (error) {
      console.error('[CHEAT SHEET] Reset failed:', error);
      this.showNotification(`Failed to reset: ${error.message}`, 'error');
    }
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
        <div class="text-center py-12 text-gray-500">
          <i class="fas fa-phone-square text-4xl mb-3 opacity-50"></i>
          <p class="text-sm">No transfer rules defined yet</p>
          <p class="text-xs mt-1">Transfer rules route calls to specific departments or people</p>
        </div>
      `;
      return;
    }
    
    // Render transfer rules (implementation similar to edge cases)
    container.innerHTML = '<p class="text-sm text-gray-600 italic">Transfer rules UI coming next...</p>';
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
    if (!this.cheatSheet.edgeCases) {
      this.cheatSheet.edgeCases = [];
    }
    
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
    if (!this.cheatSheet.transferRules) {
      this.cheatSheet.transferRules = [];
    }
    
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
  
  // ═══════════════════════════════════════════════════════════════════
  // SAVE & COMPILE
  // ═══════════════════════════════════════════════════════════════════
  
  async save() {
    if (!this.companyId) {
      this.showNotification('No company selected', 'error');
      return;
    }
    
    console.log('[CHEAT SHEET] Saving...');
    
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`/api/company/${this.companyId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          'aiAgentSettings.cheatSheet': {
            ...this.cheatSheet,
            updatedAt: new Date().toISOString(),
            updatedBy: 'admin'
          }
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      console.log('[CHEAT SHEET] Saved successfully');
      this.showNotification('Cheat sheet saved successfully', 'success');
      this.isDirty = false;
      this.renderStatus();
      
    } catch (error) {
      console.error('[CHEAT SHEET] Save failed:', error);
      this.showNotification('Failed to save cheat sheet', 'error');
    }
  }
  
  async compileCheatSheet() {
    await this.save();
    
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
  
  async showImportFromTemplateModal() {
    console.log('[CHEAT SHEET] Showing import from template modal');
    
    try {
      // Get company's active template
      const token = localStorage.getItem('adminToken');
      const companyResponse = await fetch(`/api/company/${this.companyId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!companyResponse.ok) throw new Error('Failed to load company data');
      
      const companyData = await companyResponse.json();
      const company = companyData.company || companyData;
      const templateId = company.instantResponseTemplateId;
      
      if (!templateId) {
        this.showNotification('Company does not have an active template assigned', 'error');
        return;
      }
      
      // Confirm import
      const confirmed = confirm(
        `This will import default cheat sheet rules from your template.\n\n` +
        `Current data will be replaced with industry-optimized defaults.\n\n` +
        `Continue?`
      );
      
      if (!confirmed) return;
      
      // Import from template
      const importResponse = await fetch(`/api/admin/cheat-sheet/import/${this.companyId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ templateId })
      });
      
      if (!importResponse.ok) throw new Error('Import failed');
      
      const result = await importResponse.json();
      
      this.cheatSheet = result.cheatSheet;
      this.render();
      this.showNotification('✅ Template defaults imported successfully! Review and customize for this company.', 'success');
      
    } catch (error) {
      console.error('[CHEAT SHEET] Import from template failed:', error);
      this.showNotification(`Failed to import: ${error.message}`, 'error');
    }
  }
  
  async showImportFromCompanyModal() {
    console.log('[CHEAT SHEET] Showing import from company modal');
    
    try {
      // Get list of companies
      const token = localStorage.getItem('adminToken');
      const companiesResponse = await fetch('/api/company', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!companiesResponse.ok) throw new Error('Failed to load companies');
      
      const companiesData = await companiesResponse.json();
      const companies = companiesData.companies || companiesData || [];
      
      // Filter out current company
      const otherCompanies = companies.filter(c => c._id !== this.companyId);
      
      if (otherCompanies.length === 0) {
        this.showNotification('No other companies available to copy from', 'info');
        return;
      }
      
      // Show selection prompt
      const companyList = otherCompanies.map((c, i) => `${i + 1}. ${c.name}`).join('\n');
      const selection = prompt(
        `Select a company to copy cheat sheet from:\n\n${companyList}\n\nEnter number (1-${otherCompanies.length}):`
      );
      
      if (!selection) return;
      
      const index = parseInt(selection) - 1;
      if (index < 0 || index >= otherCompanies.length) {
        this.showNotification('Invalid selection', 'error');
        return;
      }
      
      const sourceCompany = otherCompanies[index];
      
      // Confirm import
      const confirmed = confirm(
        `Copy cheat sheet from "${sourceCompany.name}"?\n\n` +
        `This will replace your current configuration.\n\n` +
        `Continue?`
      );
      
      if (!confirmed) return;
      
      // Import from company
      const importResponse = await fetch(`/api/admin/cheat-sheet/import/${this.companyId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sourceCompanyId: sourceCompany._id })
      });
      
      if (!importResponse.ok) throw new Error('Import failed');
      
      const result = await importResponse.json();
      
      this.cheatSheet = result.cheatSheet;
      this.render();
      this.showNotification(`✅ Cheat sheet copied from "${sourceCompany.name}"! Review and customize for this company.`, 'success');
      
    } catch (error) {
      console.error('[CHEAT SHEET] Import from company failed:', error);
      this.showNotification(`Failed to import: ${error.message}`, 'error');
    }
  }
  
  async exportAsJSON() {
    console.log('[CHEAT SHEET] Exporting as JSON');
    
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`/api/admin/cheat-sheet/export-json/${this.companyId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ stripMetadata: false })
      });
      
      if (!response.ok) throw new Error('Export failed');
      
      const result = await response.json();
      
      // Create downloadable file
      const blob = new Blob([JSON.stringify(result.cheatSheet, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename || 'cheatsheet.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      this.showNotification('✅ Cheat sheet exported successfully!', 'success');
      
    } catch (error) {
      console.error('[CHEAT SHEET] Export failed:', error);
      this.showNotification(`Failed to export: ${error.message}`, 'error');
    }
  }
  
  async resetToDefaults() {
    console.log('[CHEAT SHEET] Resetting to template defaults');
    
    // Confirm reset
    const confirmed = confirm(
      `⚠️ RESET TO TEMPLATE DEFAULTS\n\n` +
      `This will DELETE all your current cheat sheet rules and reload defaults from your template.\n\n` +
      `This action cannot be undone.\n\n` +
      `Continue?`
    );
    
    if (!confirmed) return;
    
    try {
      // Get company's active template
      const token = localStorage.getItem('adminToken');
      const companyResponse = await fetch(`/api/company/${this.companyId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!companyResponse.ok) throw new Error('Failed to load company data');
      
      const companyData = await companyResponse.json();
      const company = companyData.company || companyData;
      const templateId = company.instantResponseTemplateId;
      
      if (!templateId) {
        this.showNotification('Company does not have an active template assigned', 'error');
        return;
      }
      
      // Import from template
      const importResponse = await fetch(`/api/admin/cheat-sheet/import/${this.companyId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ templateId })
      });
      
      if (!importResponse.ok) throw new Error('Reset failed');
      
      const result = await importResponse.json();
      
      this.cheatSheet = result.cheatSheet;
      this.render();
      this.showNotification('✅ Cheat sheet reset to template defaults!', 'success');
      
    } catch (error) {
      console.error('[CHEAT SHEET] Reset failed:', error);
      this.showNotification(`Failed to reset: ${error.message}`, 'error');
    }
  }
  
  /**
   * Open Full Screen Editor for Frontline-Intel
   * Opens a new window with a large textarea for easier editing
   */
  openFullEditor() {
    if (!this.companyId) {
      this.showNotification('Error: No company ID', 'error');
      return;
    }
    
    const width = Math.min(1400, window.screen.availWidth * 0.9);
    const height = Math.min(900, window.screen.availHeight * 0.9);
    const left = (window.screen.availWidth - width) / 2;
    const top = (window.screen.availHeight - height) / 2;
    
    const editorWindow = window.open(
      `/frontline-intel-editor.html?companyId=${this.companyId}`,
      'FrontlineIntelEditor',
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );
    
    if (!editorWindow) {
      this.showNotification('❌ Please allow popups for this site', 'error');
      return;
    }
    
    // Listen for updates from the editor
    window.addEventListener('message', (event) => {
      if (event.data.type === 'frontlineIntelUpdated') {
        console.log('[CHEAT SHEET] Frontline-Intel updated from full editor');
        // Reload to get latest data
        this.load(this.companyId);
      }
    });
    
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
    this.renderStatus();
  }
  
  showNotification(message, type = 'info') {
    // Use existing notification system if available
    if (typeof showNotification === 'function') {
      showNotification(message);
    } else {
      console.log(`[NOTIFICATION ${type.toUpperCase()}]`, message);
    }
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

