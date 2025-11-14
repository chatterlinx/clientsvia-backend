/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CALL FLOW MANAGER
 * Frontend controller for managing dynamic call processing sequence
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Purpose: Visual interface for reordering + configuring call flow steps
 * Features:
 * - Performance dashboard (avg response time, cost per call, monthly estimate)
 * - Flow sequence editor (up/down arrows, enable/disable)
 * - Real-time impact analysis (cost + time estimates)
 * - Validation warnings (dependencies, locked steps)
 * - Save/Reset functionality
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

class CallFlowManager {
  constructor() {
    this.companyId = null;
    this.callFlowConfig = [];
    this.originalConfig = [];  // For detecting changes
    this.isDirty = false;
    
    console.log('[CALL FLOW] Manager initialized');
  }
  
  /**
   * Load call flow configuration for a company
   */
  async load(companyId) {
    this.companyId = companyId;
    
    console.log('[CALL FLOW] Loading config for company:', companyId);
    
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`/api/admin/call-flow/${companyId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.message || 'Failed to load call flow config');
      }
      
      this.callFlowConfig = result.data.callFlowConfig;
      this.originalConfig = JSON.parse(JSON.stringify(result.data.callFlowConfig));  // Deep clone
      
      console.log('[CALL FLOW] Config loaded:', this.callFlowConfig.length, 'steps');
      
      this.render();
      
    } catch (error) {
      console.error('[CALL FLOW] Load failed:', error);
      this.showNotification(`Failed to load call flow: ${error.message}`, 'error');
    }
  }
  
  /**
   * Render the complete Call Flow UI
   */
  render() {
    const container = document.getElementById('callflow-container');
    if (!container) {
      console.error('[CALL FLOW] Container not found');
      return;
    }
    
    console.log('[CALL FLOW] Rendering UI...');
    
    const performanceEstimate = this.calculatePerformance();
    
    container.innerHTML = `
      <!-- Header -->
      <div class="mb-6">
        <h2 class="text-3xl font-bold text-gray-900 mb-2">
          <i class="fas fa-project-diagram mr-3 text-indigo-600"></i>Call Flow Management
        </h2>
        <p class="text-gray-600 text-sm">
          Manage the dynamic processing sequence for incoming calls. Reorder steps to optimize performance or enable/disable features.
        </p>
      </div>
      
      <!-- Performance Dashboard -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        
        <!-- Avg Response Time -->
        <div class="bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 rounded-lg p-6 shadow-sm">
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm font-medium text-blue-700">⚡ Avg Response Time</span>
            <i class="fas fa-clock text-blue-500"></i>
          </div>
          <div class="text-3xl font-bold text-blue-900">${performanceEstimate.avgResponseTimeMs}ms</div>
          <div class="text-xs text-blue-600 mt-1">
            ${performanceEstimate.avgResponseTimeMs < 900 ? '✅ Excellent' : performanceEstimate.avgResponseTimeMs < 1200 ? '⚠️ Acceptable' : '❌ Slow'}
          </div>
        </div>
        
        <!-- Avg Cost Per Call -->
        <div class="bg-gradient-to-br from-green-50 to-green-100 border border-green-200 rounded-lg p-6 shadow-sm">
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm font-medium text-green-700">💰 Avg Cost Per Call</span>
            <i class="fas fa-dollar-sign text-green-500"></i>
          </div>
          <div class="text-3xl font-bold text-green-900">$${performanceEstimate.avgCostPerCall}</div>
          <div class="text-xs text-green-600 mt-1">
            ${parseFloat(performanceEstimate.avgCostPerCall) < 0.005 ? '✅ Excellent' : '⚠️ Acceptable'}
          </div>
        </div>
        
        <!-- Monthly Estimate (1000 calls) -->
        <div class="bg-gradient-to-br from-purple-50 to-purple-100 border border-purple-200 rounded-lg p-6 shadow-sm">
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm font-medium text-purple-700">📊 Monthly Cost (1000 calls)</span>
            <i class="fas fa-chart-line text-purple-500"></i>
          </div>
          <div class="text-3xl font-bold text-purple-900">$${performanceEstimate.monthlyEstimate1000Calls}</div>
          <div class="text-xs text-purple-600 mt-1">
            Negligible for enterprise
          </div>
        </div>
        
      </div>
      
      <!-- Flow Sequence Editor -->
      <div class="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden mb-8">
        
        <!-- Header -->
        <div class="bg-gradient-to-r from-indigo-50 to-purple-50 border-b border-gray-200 px-6 py-4">
          <h3 class="text-lg font-semibold text-gray-900">
            Call Flow Sequence
          </h3>
          <p class="text-sm text-gray-600 mt-1">
            Reorder steps using ↑/↓ arrows. Enable/disable with checkboxes. Locked steps cannot be reordered.
          </p>
        </div>
        
        <!-- Flow Steps -->
        <div class="p-6">
          <div class="space-y-3" id="flow-steps-container">
            ${this.renderFlowSteps()}
          </div>
        </div>
        
      </div>
      
      <!-- Action Buttons -->
      <div class="flex items-center justify-between">
        <button 
          onclick="callFlowManager.reset()" 
          class="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
        >
          🔄 Reset to Defaults
        </button>
        <button 
          onclick="callFlowManager.save()" 
          class="px-8 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium shadow-md hover:shadow-lg"
          ${this.isDirty ? '' : 'disabled style="opacity: 0.5; cursor: not-allowed;"'}
        >
          💾 Save Changes
        </button>
      </div>
      
      <!-- Documentation -->
      <div class="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h4 class="text-lg font-semibold text-blue-900 mb-3">📖 How Call Flow Works</h4>
        <div class="text-sm text-blue-800 space-y-2">
          <p>
            <strong>Execution Order:</strong> Steps are executed in order from top to bottom. Use ↑/↓ arrows to reorder.
          </p>
          <p>
            <strong>Short-Circuit:</strong> Some steps (Spam Filter, Edge Cases, Transfer Rules, Frontline-Intel) can short-circuit and skip remaining steps.
          </p>
          <p>
            <strong>Performance Impact:</strong> Reordering steps affects avg response time. Disabled steps are skipped entirely.
          </p>
          <p>
            <strong>Locked Steps:</strong> Spam Filter is always first and locked. Other steps can be reordered freely.
          </p>
        </div>
      </div>
    `;
    
    // ⚠️ DO NOT reset isDirty here! It should only reset after successful save
    // this.isDirty = false;  // BUG: This was resetting change tracking every render
  }
  
  /**
   * Render individual flow steps
   */
  renderFlowSteps() {
    if (!this.callFlowConfig || this.callFlowConfig.length === 0) {
      return '<p class="text-gray-500 text-center py-8">No flow steps configured</p>';
    }
    
    return this.callFlowConfig.map((step, index) => {
      const stepInfo = this.getStepInfo(step.id);
      const isFirst = index === 0;
      const isLast = index === this.callFlowConfig.length - 1;
      const isLocked = step.locked || false;
      
      return `
        <div class="flex items-center gap-4 p-4 bg-gray-50 border border-gray-200 rounded-lg hover:shadow-md transition-shadow">
          
          <!-- Reorder Buttons -->
          <div class="flex flex-col gap-1">
            <button 
              onclick="callFlowManager.moveUp(${index})" 
              class="w-8 h-8 flex items-center justify-center bg-white border border-gray-300 rounded hover:bg-gray-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              ${isFirst || isLocked ? 'disabled' : ''}
              title="${isLocked ? 'Locked step cannot be reordered' : 'Move up'}"
            >
              <i class="fas fa-chevron-up text-gray-600 text-xs"></i>
            </button>
            <button 
              onclick="callFlowManager.moveDown(${index})" 
              class="w-8 h-8 flex items-center justify-center bg-white border border-gray-300 rounded hover:bg-gray-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              ${isLast || isLocked ? 'disabled' : ''}
              title="${isLocked ? 'Locked step cannot be reordered' : 'Move down'}"
            >
              <i class="fas fa-chevron-down text-gray-600 text-xs"></i>
            </button>
          </div>
          
          <!-- Enable/Disable Checkbox -->
          <div>
            <input 
              type="checkbox" 
              id="step-enabled-${index}" 
              ${step.enabled ? 'checked' : ''}
              ${isLocked ? 'disabled' : ''}
              onchange="callFlowManager.toggleEnabled(${index})"
              class="w-5 h-5 text-indigo-600 rounded focus:ring-indigo-500 disabled:opacity-30"
              title="${isLocked ? 'Locked step cannot be disabled' : 'Enable/disable this step'}"
            />
          </div>
          
          <!-- Step Info -->
          <div class="flex-1">
            <div class="flex items-center gap-2 mb-1">
              <span class="text-lg">${stepInfo.icon}</span>
              <h4 class="text-sm font-semibold text-gray-900">
                ${stepInfo.name}
                ${isLocked ? '<span class="ml-2 px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded">🔒 Locked</span>' : ''}
              </h4>
            </div>
            <p class="text-xs text-gray-600">${stepInfo.description}</p>
            <div class="flex items-center gap-4 mt-2 text-xs">
              <span class="text-gray-500">⚡ ${stepInfo.timeMs}ms</span>
              <span class="text-gray-500">💰 $${stepInfo.cost.toFixed(4)}</span>
              ${stepInfo.canShortCircuit ? '<span class="text-orange-600">⚠️ Can short-circuit</span>' : ''}
            </div>
          </div>
          
        </div>
      `;
    }).join('');
  }
  
  /**
   * Get human-readable info for a step
   */
  getStepInfo(stepId) {
    const info = {
      spamFilter: {
        name: 'Spam Filter',
        icon: '🛡️',
        description: 'Phone number blacklist/whitelist check (Layer 0 - always first)',
        timeMs: 2,
        cost: 0,
        canShortCircuit: true
      },
      edgeCases: {
        name: 'Edge Case Detection',
        icon: '🎯',
        description: 'AI spam, robocalls, dead air detection',
        timeMs: 10,
        cost: 0,
        canShortCircuit: true
      },
      transferRules: {
        name: 'Transfer Rules',
        icon: '📞',
        description: 'Emergency, billing, scheduling transfers',
        timeMs: 15,
        cost: 0,
        canShortCircuit: true
      },
      frontlineIntel: {
        name: 'Frontline-Intel',
        icon: '🧠',
        description: 'THE HUB - Intelligent gatekeeper (intent extraction, customer lookup, validation)',
        timeMs: 800,
        cost: 0.003,
        canShortCircuit: true
      },
      scenarioMatching: {
        name: 'Scenario Matching',
        icon: '🎭',
        description: '3-tier intelligence (keywords → semantic → LLM)',
        timeMs: 12,
        cost: 0,
        canShortCircuit: false
      },
      guardrails: {
        name: 'Guardrails',
        icon: '🚧',
        description: 'Content filtering (prices, phone numbers, etc.)',
        timeMs: 8,
        cost: 0,
        canShortCircuit: false
      },
      behaviorPolish: {
        name: 'Behavior Polish',
        icon: '✨',
        description: 'Text polishing (ACK_OK, POLITE_PROFESSIONAL)',
        timeMs: 3,
        cost: 0,
        canShortCircuit: false
      },
      contextInjection: {
        name: 'Context Injection',
        icon: '💬',
        description: 'Inject context from Frontline-Intel',
        timeMs: 2,
        cost: 0,
        canShortCircuit: false
      }
    };
    
    return info[stepId] || {
      name: stepId,
      icon: '❓',
      description: 'Unknown step',
      timeMs: 0,
      cost: 0,
      canShortCircuit: false
    };
  }
  
  /**
   * Calculate performance estimates
   */
  calculatePerformance() {
    let totalTimeMs = 0;
    let totalCost = 0;
    
    for (const step of this.callFlowConfig) {
      if (step.enabled) {
        const info = this.getStepInfo(step.id);
        totalTimeMs += info.timeMs;
        totalCost += info.cost;
      }
    }
    
    return {
      avgResponseTimeMs: totalTimeMs,
      avgCostPerCall: totalCost.toFixed(4),
      monthlyEstimate1000Calls: (totalCost * 1000).toFixed(2)
    };
  }
  
  /**
   * Move step up in sequence
   */
  moveUp(index) {
    if (index <= 0 || this.callFlowConfig[index].locked) return;
    
    // Swap with previous step
    const temp = this.callFlowConfig[index];
    this.callFlowConfig[index] = this.callFlowConfig[index - 1];
    this.callFlowConfig[index - 1] = temp;
    
    this.markDirty();
    this.render();
    
    console.log('[CALL FLOW] Moved step up:', index);
  }
  
  /**
   * Move step down in sequence
   */
  moveDown(index) {
    if (index >= this.callFlowConfig.length - 1 || this.callFlowConfig[index].locked) return;
    
    // Swap with next step
    const temp = this.callFlowConfig[index];
    this.callFlowConfig[index] = this.callFlowConfig[index + 1];
    this.callFlowConfig[index + 1] = temp;
    
    this.markDirty();
    this.render();
    
    console.log('[CALL FLOW] Moved step down:', index);
  }
  
  /**
   * Toggle step enabled status
   */
  toggleEnabled(index) {
    if (this.callFlowConfig[index].locked) return;
    
    this.callFlowConfig[index].enabled = !this.callFlowConfig[index].enabled;
    
    this.markDirty();
    this.render();
    
    console.log('[CALL FLOW] Toggled step enabled:', index, this.callFlowConfig[index].enabled);
  }
  
  /**
   * Save changes to backend
   */
  async save() {
    if (!this.isDirty) {
      this.showNotification('No changes to save', 'info');
      return;
    }
    
    console.log('[CALL FLOW] Saving changes...');
    
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`/api/admin/call-flow/${this.companyId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          callFlowConfig: this.callFlowConfig
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.message || 'Save failed');
      }
      
      this.originalConfig = JSON.parse(JSON.stringify(this.callFlowConfig));  // Update original
      this.isDirty = false;
      
      this.showNotification('✅ Call flow saved successfully!', 'success');
      this.render();  // Re-render to update UI state
      
      console.log('[CALL FLOW] Save successful');
      
    } catch (error) {
      console.error('[CALL FLOW] Save failed:', error);
      this.showNotification(`Failed to save: ${error.message}`, 'error');
    }
  }
  
  /**
   * Reset to default configuration
   */
  async reset() {
    const confirmed = confirm(
      '🔄 Reset Call Flow to Defaults?\n\n' +
      'This will restore the default processing sequence.\n' +
      'Your custom flow will be replaced.\n\n' +
      'Continue?'
    );
    
    if (!confirmed) return;
    
    console.log('[CALL FLOW] Resetting to defaults...');
    
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`/api/admin/call-flow/${this.companyId}/reset`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.message || 'Reset failed');
      }
      
      this.callFlowConfig = result.data.callFlowConfig;
      this.originalConfig = JSON.parse(JSON.stringify(result.data.callFlowConfig));
      this.isDirty = false;
      
      this.showNotification('✅ Call flow reset to defaults!', 'success');
      this.render();
      
      console.log('[CALL FLOW] Reset successful');
      
    } catch (error) {
      console.error('[CALL FLOW] Reset failed:', error);
      this.showNotification(`Failed to reset: ${error.message}`, 'error');
    }
  }
  
  /**
   * Mark configuration as dirty (has unsaved changes)
   */
  markDirty() {
    this.isDirty = true;
  }
  
  /**
   * Show notification to user
   */
  showNotification(message, type = 'info') {
    // Reuse the notification system from cheat sheet or implement your own
    if (typeof ToastManager !== 'undefined' && ToastManager.show) {
      ToastManager.show(message, type);
    } else {
      console.log(`[CALL FLOW] Notification (${type}):`, message);
      alert(message);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GLOBAL INSTANCE
// ═══════════════════════════════════════════════════════════════════════════
const callFlowManager = new CallFlowManager();
console.log('[CALL FLOW] ✅ Global instance created: window.callFlowManager');

