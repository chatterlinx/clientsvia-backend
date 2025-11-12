// public/js/ai-agent-settings/CheatSheetManager.js
// ============================================================================
// CHEAT SHEET MANAGER - Admin UI Controller
// ============================================================================
// PURPOSE: Manage company-specific cheat sheet rules and policies
// FEATURES: Visual editor, live compilation, conflict detection, test harness
// ARCHITECTURE: Load → Edit → Compile → Test → Deploy
// ============================================================================

class CheatSheetManager {
  
  constructor() {
    this.companyId = null;
    this.cheatSheet = null;
    this.compilationStatus = null;
    this.isDirty = false;
    
    console.log('✅ [CHEAT SHEET MANAGER] Initialized');
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // LOAD CHEAT SHEET
  // ═══════════════════════════════════════════════════════════════════
  
  async load(companyId) {
    this.companyId = companyId;
    
    console.log('[CHEAT SHEET] Loading for company:', companyId);
    
    try {
      const token = localStorage.getItem('authToken');
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
  // SAVE & COMPILE
  // ═══════════════════════════════════════════════════════════════════
  
  async save() {
    if (!this.companyId) {
      this.showNotification('No company selected', 'error');
      return;
    }
    
    console.log('[CHEAT SHEET] Saving...');
    
    try {
      const token = localStorage.getItem('authToken');
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
      const token = localStorage.getItem('authToken');
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
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════
  
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
}

// ═══════════════════════════════════════════════════════════════════
// GLOBAL INSTANCE
// ═══════════════════════════════════════════════════════════════════
window.cheatSheetManager = new CheatSheetManager();
console.log('✅ CheatSheetManager loaded and available globally');

