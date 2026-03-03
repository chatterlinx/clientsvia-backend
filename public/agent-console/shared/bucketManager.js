/**
 * ============================================================================
 * BUCKET MANAGER - Trigger Bucket UI Module
 * ============================================================================
 * 
 * Reusable bucket management module for Trigger Console.
 * Handles bucket CRUD operations and UI rendering.
 * 
 * FEATURES:
 * - Bucket Builder Modal (create/edit buckets)
 * - Health Summary Bar (bucket coverage stats)
 * - Bucket Status Icons (✓/✗/🚨 checkmarks)
 * - Quick Assign Dropdown (assign triggers to buckets)
 * 
 * USAGE:
 *   Import this module in triggers.js:
 *   <script src="/agent-console/shared/bucketManager.js"></script>
 *   
 *   Then call:
 *   BucketManager.init(companyId, apiBase);
 *   BucketManager.renderHealthBar(healthData);
 *   BucketManager.getBucketStatusIcon(trigger, buckets);
 * 
 * ============================================================================
 */

window.BucketManager = (function() {
  'use strict';
  
  let companyId = null;
  let apiBase = '/api/agent-console';
  let buckets = [];
  let onBucketsChanged = null;  // Callback when buckets change
  
  /* ══════════════════════════════════════════════════════════════════════
     INITIALIZATION
     ══════════════════════════════════════════════════════════════════════ */
  
  function init(compId, apiBasePath, changeCallback) {
    companyId = compId;
    apiBase = apiBasePath || '/api/agent-console';
    onBucketsChanged = changeCallback;
  }
  
  /* ══════════════════════════════════════════════════════════════════════
     DATA LOADING
     ══════════════════════════════════════════════════════════════════════ */
  
  async function loadBuckets() {
    try {
      // Use parent page's apiFetch if available (includes auth token and unwraps data)
      if (window.apiFetch) {
        const data = await window.apiFetch(`${apiBase}/trigger-buckets/${companyId}`);
        buckets = Array.isArray(data) ? data : (data.data || []);
        return buckets;
      } else {
        // Fallback to plain fetch (for standalone use)
        const response = await fetch(`${apiBase}/trigger-buckets/${companyId}`);
        const result = await response.json();
        buckets = result.data || [];
        return buckets;
      }
    } catch (error) {
      console.error('[BucketManager] Load error:', error);
      return [];
    }
  }
  
  async function loadHealth() {
    try {
      if (window.apiFetch) {
        const data = await window.apiFetch(`${apiBase}/trigger-buckets/${companyId}/health`);
        return data;
      } else {
        const response = await fetch(`${apiBase}/trigger-buckets/${companyId}/health`);
        const result = await response.json();
        return result.data;
      }
    } catch (error) {
      console.error('[BucketManager] Health check error:', error);
      return null;
    }
  }
  
  /* ══════════════════════════════════════════════════════════════════════
     HEALTH SUMMARY BAR
     ══════════════════════════════════════════════════════════════════════ */
  
  function renderHealthBar(healthData) {
    const container = document.getElementById('bucket-health-bar');
    if (!container || !healthData) return;
    
    const {
      totalTriggers,
      bucketed,
      unbucketed,
      emergency,
      invalidBucket,
      bucketedPercent
    } = healthData;
    
    const unbucketedPercent = totalTriggers > 0 
      ? Math.round((unbucketed / totalTriggers) * 100) 
      : 0;
    const emergencyPercent = totalTriggers > 0 
      ? Math.round((emergency / totalTriggers) * 100) 
      : 0;
    
    let html = '';
    let cssClass = 'health-bar-healthy';
    
    // Critical - invalid bucket assignments
    if (invalidBucket > 0) {
      cssClass = 'health-bar-critical';
      html = `
        <span>
          ❌ CRITICAL: ${invalidBucket} trigger${invalidBucket > 1 ? 's' : ''} 
          ${invalidBucket > 1 ? 'have' : 'has'} invalid bucket assignments
        </span>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-sm btn-danger" onclick="BucketManager.fixInvalidBuckets()">
            Fix Now
          </button>
          <button class="btn btn-sm" onclick="BucketManager.openBucketModal()">
            🗂️ Manage Buckets
          </button>
        </div>
      `;
    }
    // Warning - low bucket coverage
    else if (bucketedPercent < 50 && unbucketed > 0) {
      cssClass = 'health-bar-warning';
      html = `
        <span>
          ⚠️ Only ${bucketedPercent}% bucketed — ${unbucketed} trigger${unbucketed > 1 ? 's' : ''} need assignment
        </span>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-sm btn-warning" onclick="BucketManager.showUnbucketed()">
            Review
          </button>
          <button class="btn btn-sm" onclick="BucketManager.openBucketModal()">
            🗂️ Manage Buckets
          </button>
        </div>
      `;
    }
    // Info - some unbucketed
    else if (unbucketed > 0) {
      cssClass = 'health-bar-info';
      html = `
        <span>
          📊 ${bucketed}/${totalTriggers} bucketed (${bucketedPercent}%) 🟢 | 
          ${unbucketed} unbucketed (${unbucketedPercent}%) 🔴 | 
          ${emergency} emergency (${emergencyPercent}%) 🟡
        </span>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-sm" onclick="BucketManager.showUnbucketed()">
            Assign Remaining
          </button>
          <button class="btn btn-sm" onclick="BucketManager.openBucketModal()">
            🗂️ Manage Buckets
          </button>
        </div>
      `;
    }
    // All good
    else {
      cssClass = 'health-bar-healthy';
      html = `
        <span>
          ✅ ${bucketed}/${totalTriggers} bucketed (${bucketedPercent}%) 🟢 | 
          ${emergency} emergency (${emergencyPercent}%) 🟡 | 
          All triggers healthy!
        </span>
        <button class="btn btn-sm" onclick="BucketManager.openBucketModal()">
          🗂️ Manage Buckets
        </button>
      `;
    }
    
    container.className = `bucket-health-bar ${cssClass}`;
    container.innerHTML = html;
  }
  
  /* ══════════════════════════════════════════════════════════════════════
     BUCKET STATUS ICONS (for trigger list)
     ══════════════════════════════════════════════════════════════════════ */
  
  function getBucketStatusIcon(trigger, allBuckets) {
    // Emergency - always evaluate
    if (trigger.alwaysEvaluate) {
      return {
        icon: '🚨',
        color: 'status-emergency',
        title: 'Emergency - Always Active (bypasses buckets)',
        status: 'emergency'
      };
    }
    
    // Has bucket assignment
    if (trigger.bucket) {
      const bucket = allBuckets.find(b => b.bucketId === trigger.bucket);
      
      if (bucket) {
        return {
          icon: '✓',
          color: 'status-bucketed',
          title: `Bucket: ${bucket.icon} ${bucket.name}`,
          status: 'bucketed',
          bucketName: bucket.name,
          bucketIcon: bucket.icon
        };
      } else {
        return {
          icon: '✗',
          color: 'status-invalid',
          title: `Invalid bucket: ${trigger.bucket}`,
          status: 'invalid',
          clickable: true
        };
      }
    }
    
    // No bucket - unbucketed
    return {
      icon: '✗',
      color: 'status-unbucketed',
      title: 'Not bucketed - Click to assign',
      status: 'unbucketed',
      clickable: true
    };
  }
  
  function renderBucketStatusCell(trigger, allBuckets, ruleId) {
    const status = getBucketStatusIcon(trigger, allBuckets);
    const clickHandler = status.clickable 
      ? `onclick="BucketManager.quickAssign('${ruleId}')"`
      : '';
    const cursorClass = status.clickable ? 'cursor-pointer' : '';
    
    return `
      <span class="status-icon ${status.color} ${cursorClass}" 
            title="${status.title}" 
            ${clickHandler}>
        ${status.icon}
      </span>
    `;
  }
  
  /* ══════════════════════════════════════════════════════════════════════
     BUCKET MODAL (Full Management UI)
     ══════════════════════════════════════════════════════════════════════ */
  
  function openBucketModal() {
    const modal = document.createElement('div');
    modal.id = 'bucket-manager-modal';
    modal.className = 'modal active';
    modal.innerHTML = `
      <div class="modal-backdrop" onclick="BucketManager.closeBucketModal()"></div>
      <div class="modal-content large">
        <div class="modal-header">
          <h2>🗂️ Trigger Bucket Manager</h2>
          <button class="btn-close" onclick="BucketManager.closeBucketModal()">&times;</button>
        </div>
        
        <div class="modal-body">
          <div class="bucket-manager-intro">
            <p>
              Organize triggers into buckets for faster responses. 
              ScrabEngine automatically detects which bucket applies to each call.
            </p>
          </div>
          
          <div id="bucket-list-container">
            <div class="loading">Loading buckets...</div>
          </div>
          
          <button class="btn btn-primary" onclick="BucketManager.createBucket()">
            + Create New Bucket
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    loadAndRenderBuckets();
  }
  
  function closeBucketModal() {
    const modal = document.getElementById('bucket-manager-modal');
    if (modal) {
      modal.remove();
    }
  }
  
  async function loadAndRenderBuckets() {
    const container = document.getElementById('bucket-list-container');
    if (!container) return;
    
    const allBuckets = await loadBuckets();
    
    if (allBuckets.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>📦 No buckets created yet</p>
          <p class="text-muted">Create your first bucket to start organizing triggers</p>
        </div>
      `;
      return;
    }
    
    const html = allBuckets.map(bucket => `
      <div class="bucket-card" data-bucket-id="${bucket.bucketId}">
        <div class="bucket-card-header">
          <span class="bucket-icon-large">${bucket.icon}</span>
          <div class="bucket-info">
            <h3>${escapeHtml(bucket.name)}</h3>
            <p class="text-muted">${escapeHtml(bucket.description || '')}</p>
          </div>
          <div class="bucket-meta">
            <span class="badge">${bucket.triggerCount} triggers</span>
            ${bucket.alwaysEvaluate ? '<span class="badge badge-warning">Always Active</span>' : ''}
            ${!bucket.isActive ? '<span class="badge badge-danger">Inactive</span>' : ''}
          </div>
        </div>
        
        <div class="bucket-keywords">
          <strong>Keywords:</strong>
          ${bucket.classificationKeywords.map(kw => 
            `<span class="keyword-chip">${escapeHtml(kw)}</span>`
          ).join(' ')}
        </div>
        
        <div class="bucket-stats">
          <span title="Priority (lower = higher)">Priority: ${bucket.priority}</span>
          <span title="Confidence threshold">Threshold: ${Math.round(bucket.confidenceThreshold * 100)}%</span>
          ${bucket.usageCount > 0 ? `<span>Used: ${bucket.usageCount}x</span>` : ''}
          ${bucket.lastUsedAt ? `<span>Last: ${formatRelativeTime(bucket.lastUsedAt)}</span>` : ''}
        </div>
        
        <div class="bucket-actions">
          <button class="btn btn-sm" onclick="BucketManager.editBucket('${bucket.bucketId}')">
            Edit
          </button>
          <button class="btn btn-sm" onclick="BucketManager.viewBucketTriggers('${bucket.bucketId}')">
            View Triggers (${bucket.triggerCount})
          </button>
          <button class="btn btn-sm btn-danger" onclick="BucketManager.deleteBucket('${bucket.bucketId}')">
            Delete
          </button>
        </div>
      </div>
    `).join('');
    
    container.innerHTML = html;
  }
  
  /* ══════════════════════════════════════════════════════════════════════
     BUCKET CREATE/EDIT
     ══════════════════════════════════════════════════════════════════════ */
  
  function createBucket() {
    showBucketForm(null);
  }
  
  function editBucket(bucketId) {
    const bucket = buckets.find(b => b.bucketId === bucketId);
    if (!bucket) {
      alert('Bucket not found');
      return;
    }
    showBucketForm(bucket);
  }
  
  function showBucketForm(bucket = null) {
    const isEdit = bucket !== null;
    
    const modal = document.createElement('div');
    modal.id = 'bucket-form-modal';
    modal.className = 'modal active';
    modal.innerHTML = `
      <div class="modal-backdrop" onclick="BucketManager.closeBucketForm()"></div>
      <div class="modal-content medium">
        <div class="modal-header">
          <h2>${isEdit ? 'Edit' : 'Create'} Trigger Bucket</h2>
          <button class="btn-close" onclick="BucketManager.closeBucketForm()">&times;</button>
        </div>
        
        <form id="bucket-form" class="modal-body">
          <!-- Name -->
          <div class="form-group">
            <label>Bucket Name <span class="required">*</span></label>
            <input type="text" id="bucket-name" class="form-control" required
                   maxlength="100" value="${escapeHtml(bucket?.name || '')}"
                   placeholder="e.g., Cooling Issues">
          </div>
          
          <!-- Description -->
          <div class="form-group">
            <label>Description</label>
            <textarea id="bucket-description" class="form-control" maxlength="500"
                      placeholder="What types of calls does this bucket handle?">${escapeHtml(bucket?.description || '')}</textarea>
          </div>
          
          <!-- Icon Picker -->
          <div class="form-group">
            <label>Icon</label>
            <div class="icon-picker" id="icon-picker">
              ${['🧊', '🔥', '💰', '📅', '🚨', '🔧', '📞', '📦', '⚡', '🛠️', '💳', '🏠'].map(icon => `
                <button type="button" class="icon-option ${(bucket?.icon || '📦') === icon ? 'selected' : ''}" 
                        data-icon="${icon}" onclick="BucketManager.selectIcon('${icon}')">
                  ${icon}
                </button>
              `).join('')}
            </div>
            <input type="hidden" id="bucket-icon" value="${bucket?.icon || '📦'}">
          </div>
          
          <!-- Classification Keywords -->
          <div class="form-group">
            <label>
              Classification Keywords <span class="required">*</span>
              <span class="help-text">
                ScrabEngine uses these to detect this bucket
              </span>
            </label>
            <div class="keyword-input-container">
              <input type="text" id="keyword-input" class="form-control"
                     placeholder="Type keyword and press Enter"
                     onkeydown="if(event.key==='Enter'){event.preventDefault();BucketManager.addKeyword();}">
              <button type="button" class="btn btn-sm" onclick="BucketManager.addKeyword()">
                + Add
              </button>
            </div>
            <div id="keywords-container" class="chips-container">
              ${(bucket?.classificationKeywords || []).map(kw => `
                <span class="chip">
                  ${escapeHtml(kw)}
                  <button type="button" class="chip-remove" 
                          onclick="BucketManager.removeKeyword('${escapeHtml(kw)}')">&times;</button>
                </span>
              `).join('')}
            </div>
            <small class="form-hint">
              Add 5-10 keywords. Example for Cooling: "cooling", "not cooling", "warm air"
            </small>
          </div>
          
          <!-- Advanced Settings (Collapsible) -->
          <details>
            <summary>Advanced Settings</summary>
            
            <div class="form-group">
              <label>Priority (1-999, lower = higher)</label>
              <input type="number" id="bucket-priority" class="form-control"
                     min="1" max="999" value="${bucket?.priority || 50}">
            </div>
            
            <div class="form-group">
              <label>
                Confidence Threshold
                <span id="threshold-display">${Math.round((bucket?.confidenceThreshold || 0.70) * 100)}%</span>
              </label>
              <input type="range" id="bucket-threshold" min="0" max="100" 
                     value="${Math.round((bucket?.confidenceThreshold || 0.70) * 100)}"
                     oninput="document.getElementById('threshold-display').textContent = this.value + '%'">
              <small class="form-hint">
                Lower = more aggressive (faster but riskier) | Higher = more conservative
              </small>
            </div>
            
            <div class="form-group">
              <label>
                <input type="checkbox" id="bucket-always-evaluate" 
                       ${bucket?.alwaysEvaluate ? 'checked' : ''}>
                Emergency Bucket (Always Active)
              </label>
              <small class="form-hint">
                Emergency buckets are always evaluated regardless of classification
              </small>
            </div>
            
            <div class="form-group">
              <label>
                <input type="checkbox" id="bucket-active" 
                       ${bucket?.isActive !== false ? 'checked' : ''}>
                Active
              </label>
            </div>
          </details>
          
          <!-- Form Actions -->
          <div class="form-actions">
            <button type="button" class="btn" onclick="BucketManager.closeBucketForm()">
              Cancel
            </button>
            <button type="submit" class="btn btn-primary">
              ${isEdit ? 'Update' : 'Create'} Bucket
            </button>
          </div>
        </form>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // Handle form submit
    document.getElementById('bucket-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await saveBucket(bucket?.bucketId || null);
    });
  }
  
  function closeBucketForm() {
    const modal = document.getElementById('bucket-form-modal');
    if (modal) modal.remove();
  }
  
  /* ══════════════════════════════════════════════════════════════════════
     KEYWORD MANAGEMENT (in form)
     ══════════════════════════════════════════════════════════════════════ */
  
  function addKeyword() {
    const input = document.getElementById('keyword-input');
    const keyword = input.value.trim().toLowerCase();
    
    if (!keyword) return;
    
    const container = document.getElementById('keywords-container');
    
    // Check if already exists
    const existing = Array.from(container.querySelectorAll('.chip'))
      .find(chip => chip.textContent.trim().replace('×', '').trim() === keyword);
    
    if (existing) {
      input.value = '';
      input.focus();
      return;
    }
    
    // Add chip
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `
      ${escapeHtml(keyword)}
      <button type="button" class="chip-remove" 
              onclick="BucketManager.removeKeyword('${escapeHtml(keyword)}')">&times;</button>
    `;
    
    container.appendChild(chip);
    input.value = '';
    input.focus();
  }
  
  function removeKeyword(keyword) {
    const container = document.getElementById('keywords-container');
    const chips = Array.from(container.querySelectorAll('.chip'));
    
    chips.forEach(chip => {
      const text = chip.textContent.trim().replace('×', '').trim();
      if (text === keyword) {
        chip.remove();
      }
    });
  }
  
  function selectIcon(icon) {
    // Update hidden input
    document.getElementById('bucket-icon').value = icon;
    
    // Update UI selection
    document.querySelectorAll('.icon-option').forEach(btn => {
      btn.classList.remove('selected');
    });
    document.querySelector(`[data-icon="${icon}"]`).classList.add('selected');
  }
  
  function getFormKeywords() {
    const container = document.getElementById('keywords-container');
    const chips = Array.from(container.querySelectorAll('.chip'));
    
    return chips.map(chip => 
      chip.textContent.trim().replace('×', '').trim()
    ).filter(Boolean);
  }
  
  /* ══════════════════════════════════════════════════════════════════════
     SAVE BUCKET (Create or Update)
     ══════════════════════════════════════════════════════════════════════ */
  
  async function saveBucket(bucketId = null) {
    const name = document.getElementById('bucket-name').value.trim();
    const description = document.getElementById('bucket-description').value.trim();
    const icon = document.getElementById('bucket-icon').value;
    const keywords = getFormKeywords();
    const priority = parseInt(document.getElementById('bucket-priority').value);
    const threshold = parseFloat(document.getElementById('bucket-threshold').value) / 100;
    const alwaysEvaluate = document.getElementById('bucket-always-evaluate').checked;
    const isActive = document.getElementById('bucket-active').checked;
    
    // Validation
    if (!name) {
      alert('Bucket name is required');
      return;
    }
    
    if (keywords.length === 0) {
      alert('At least one classification keyword is required');
      return;
    }
    
    const payload = {
      name,
      description,
      icon,
      classificationKeywords: keywords,
      priority,
      confidenceThreshold: threshold,
      alwaysEvaluate,
      isActive
    };
    
    try {
      const url = bucketId 
        ? `${apiBase}/trigger-buckets/${companyId}/${bucketId}`
        : `${apiBase}/trigger-buckets/${companyId}`;
      
      const method = bucketId ? 'PUT' : 'POST';
      
      if (window.apiFetch) {
        await window.apiFetch(url, { method, body: payload });
      } else {
        const response = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!result.success) {
          throw new Error(result.error || 'Save failed');
        }
      }
      
      // Success
      showToast(`Bucket ${bucketId ? 'updated' : 'created'} successfully`, 'success');
      closeBucketForm();
      loadAndRenderBuckets();
      
      // Notify parent (trigger list needs to reload)
      if (onBucketsChanged) {
        onBucketsChanged();
      }
      
    } catch (error) {
      console.error('[BucketManager] Save failed:', error);
      alert(`Failed to ${bucketId ? 'update' : 'create'} bucket: ${error.message}`);
    }
  }
  
  /* ══════════════════════════════════════════════════════════════════════
     DELETE BUCKET
     ══════════════════════════════════════════════════════════════════════ */
  
  async function deleteBucket(bucketId) {
    const bucket = buckets.find(b => b.bucketId === bucketId);
    if (!bucket) return;
    
    const hasTriggersPromise = bucket.triggerCount > 0;
    
    let confirmMessage = `Delete bucket "${bucket.name}"?`;
    if (bucket.triggerCount > 0) {
      confirmMessage += `\n\nThis bucket has ${bucket.triggerCount} trigger(s) assigned.\nTriggers will be unassigned and evaluated on every call.`;
    }
    
    if (!confirm(confirmMessage)) {
      return;
    }
    
    try {
      const url = `${apiBase}/trigger-buckets/${companyId}/${bucketId}${
        bucket.triggerCount > 0 ? '?force=true' : ''
      }`;
      
      if (window.apiFetch) {
        await window.apiFetch(url, { method: 'DELETE' });
      } else {
        const response = await fetch(url, { method: 'DELETE' });
        const result = await response.json();
        if (!result.success) {
          throw new Error(result.error || 'Delete failed');
        }
      }
      
      showToast('Bucket deleted successfully', 'success');
      loadAndRenderBuckets();
      
      if (onBucketsChanged) {
        onBucketsChanged();
      }
      
    } catch (error) {
      console.error('[BucketManager] Delete failed:', error);
      alert(`Failed to delete bucket: ${error.message}`);
    }
  }
  
  /* ══════════════════════════════════════════════════════════════════════
     QUICK ASSIGN (from trigger list)
     ══════════════════════════════════════════════════════════════════════ */
  
  function quickAssign(ruleId) {
    // This will be called by parent (triggers.js)
    // because it needs access to trigger data and reload functions
    if (window.quickAssignBucket) {
      window.quickAssignBucket(ruleId);
    }
  }
  
  /* ══════════════════════════════════════════════════════════════════════
     HELPERS
     ══════════════════════════════════════════════════════════════════════ */
  
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  function formatRelativeTime(date) {
    const now = new Date();
    const then = new Date(date);
    const diffMs = now - then;
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return then.toLocaleDateString();
  }
  
  function showToast(message, type = 'info') {
    // Use parent page's toast system if available
    if (window.showToast) {
      window.showToast(message, type);
    } else {
      console.log(`[Toast ${type}]`, message);
    }
  }
  
  /* ══════════════════════════════════════════════════════════════════════
     PUBLIC API
     ══════════════════════════════════════════════════════════════════════ */
  
  return {
    // Initialization
    init,
    
    // Data loading
    loadBuckets,
    loadHealth,
    getBuckets: () => buckets,
    
    // Rendering
    renderHealthBar,
    getBucketStatusIcon,
    renderBucketStatusCell,
    
    // Modal management
    openBucketModal,
    closeBucketModal,
    createBucket,
    editBucket,
    deleteBucket,
    viewBucketTriggers: (bucketId) => {
      // Filter trigger list to show only this bucket
      if (window.filterTriggersByBucket) {
        window.filterTriggersByBucket(bucketId);
      }
    },
    
    // Form management
    closeBucketForm,
    selectIcon,
    addKeyword,
    removeKeyword,
    
    // Actions
    quickAssign,
    showUnbucketed: () => {
      if (window.filterTriggersByBucketStatus) {
        window.filterTriggersByBucketStatus('unbucketed');
      }
    },
    fixInvalidBuckets: () => {
      if (window.filterTriggersByBucketStatus) {
        window.filterTriggersByBucketStatus('invalid');
      }
    }
  };
})();
