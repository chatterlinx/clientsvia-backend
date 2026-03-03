# Trigger Bucket System - Implementation Guide

## ✅ COMPLETED: Backend (Phases 1-4)

### What's Been Built

**Database Layer:**
- ✅ `TriggerBucket` model with full validation
- ✅ `CompanyLocalTrigger` updated with bucket fields
- ✅ Pre-save hooks for referential integrity
- ✅ Indexes for multi-tenant performance

**API Layer:**
- ✅ RESTful CRUD routes for bucket management
- ✅ Health check endpoint
- ✅ Usage tracking endpoint
- ✅ Mounted in agent console router

**Classification Service:**
- ✅ `TriggerBucketClassifier` with word-based scoring
- ✅ Bucket caching (60s TTL)
- ✅ Confidence thresholding
- ✅ Graceful degradation

**Runtime Integration:**
- ✅ Agent2DiscoveryRunner bucket classification
- ✅ Pool filtering logic
- ✅ Zero-match retry safety net
- ✅ Diagnostic events

---

## 🚧 IN PROGRESS: Frontend (Phase 5)

### UI Components to Build

#### 1. **Bucket Builder Modal** (Top of Page)

**Location:** `public/agent-console/triggers.html` + `triggers.js`

**Trigger Button:**
```html
<!-- Add to top toolbar -->
<button id="btn-manage-buckets" class="btn btn-primary">
  🗂️ Manage Buckets
</button>
```

**Modal Structure:**
```html
<div id="bucket-modal" class="modal">
  <div class="modal-content large">
    <div class="modal-header">
      <h2>🗂️ Trigger Bucket Manager</h2>
      <button class="btn-close">&times;</button>
    </div>
    
    <!-- Health Summary Bar -->
    <div id="bucket-health-bar" class="health-bar">
      📊 35/43 bucketed (81%) 🟢 | 5 unbucketed (12%) 🔴 | 3 emergency (7%) 🟡
    </div>
    
    <div class="modal-body">
      <!-- Bucket List -->
      <div id="bucket-list"></div>
      
      <!-- Create New Bucket Button -->
      <button id="btn-create-bucket" class="btn btn-success">
        + Create New Bucket
      </button>
    </div>
  </div>
</div>
```

**Bucket Card Template:**
```javascript
function renderBucketCard(bucket) {
  return `
    <div class="bucket-card" data-bucket-id="${bucket.bucketId}">
      <div class="bucket-header">
        <span class="bucket-icon">${bucket.icon}</span>
        <h3>${bucket.name}</h3>
        <span class="bucket-count">${bucket.triggerCount} triggers</span>
      </div>
      
      <div class="bucket-keywords">
        <strong>Classification Keywords:</strong>
        ${bucket.classificationKeywords.map(kw => 
          `<span class="keyword-chip">${kw}</span>`
        ).join(' ')}
      </div>
      
      <div class="bucket-stats">
        <span>Priority: ${bucket.priority}</span>
        <span>Threshold: ${Math.round(bucket.confidenceThreshold * 100)}%</span>
        <span>Used: ${bucket.usageCount} times</span>
      </div>
      
      <div class="bucket-actions">
        <button onclick="editBucket('${bucket.bucketId}')">Edit</button>
        <button onclick="viewBucketTriggers('${bucket.bucketId}')">
          View Triggers (${bucket.triggerCount})
        </button>
        <button onclick="deleteBucket('${bucket.bucketId}')" class="btn-danger">
          Delete
        </button>
      </div>
    </div>
  `;
}
```

#### 2. **Bucket Edit/Create Form**

```html
<div id="bucket-form-modal" class="modal">
  <div class="modal-content medium">
    <div class="modal-header">
      <h2 id="bucket-form-title">Create Trigger Bucket</h2>
    </div>
    
    <div class="modal-body">
      <form id="bucket-form">
        <!-- Name -->
        <div class="form-group">
          <label>Bucket Name *</label>
          <input type="text" id="bucket-name" required maxlength="100"
                 placeholder="e.g., Cooling Issues">
        </div>
        
        <!-- Description -->
        <div class="form-group">
          <label>Description (optional)</label>
          <textarea id="bucket-description" maxlength="500"
                    placeholder="What types of calls does this bucket handle?"></textarea>
        </div>
        
        <!-- Icon -->
        <div class="form-group">
          <label>Icon</label>
          <div class="icon-picker">
            <button type="button" class="icon-option" data-icon="🧊">🧊</button>
            <button type="button" class="icon-option" data-icon="🔥">🔥</button>
            <button type="button" class="icon-option" data-icon="💰">💰</button>
            <button type="button" class="icon-option" data-icon="📅">📅</button>
            <button type="button" class="icon-option" data-icon="🚨">🚨</button>
            <button type="button" class="icon-option" data-icon="🔧">🔧</button>
            <button type="button" class="icon-option" data-icon="📞">📞</button>
            <button type="button" class="icon-option" data-icon="📦">📦</button>
          </div>
          <input type="hidden" id="bucket-icon" value="📦">
        </div>
        
        <!-- Classification Keywords -->
        <div class="form-group">
          <label>Classification Keywords * 
            <span class="help-text">
              ScrabEngine uses these to detect when this bucket applies
            </span>
          </label>
          <div id="bucket-keywords-input">
            <input type="text" id="keyword-input" 
                   placeholder="Type keyword and press Enter">
            <div id="keywords-list" class="chips-container"></div>
          </div>
          <small class="form-hint">
            Add 5-10 keywords that identify this type of call
            <br>Example for Cooling: "cooling", "not cooling", "warm air", "ac not cold"
          </small>
        </div>
        
        <!-- Priority -->
        <div class="form-group">
          <label>Priority (1-999, lower = higher)</label>
          <input type="number" id="bucket-priority" min="1" max="999" value="50">
        </div>
        
        <!-- Confidence Threshold -->
        <div class="form-group">
          <label>Confidence Threshold</label>
          <input type="range" id="bucket-threshold" min="0" max="100" value="70"
                 oninput="document.getElementById('threshold-value').textContent = this.value + '%'">
          <span id="threshold-value">70%</span>
          <small class="form-hint">
            Lower = more aggressive filtering (faster but riskier)
          </small>
        </div>
        
        <!-- Always Evaluate (Emergency) -->
        <div class="form-group">
          <label>
            <input type="checkbox" id="bucket-always-evaluate">
            Emergency Bucket (Always Active)
          </label>
          <small class="form-hint">
            Emergency buckets are always evaluated regardless of classification
          </small>
        </div>
        
        <!-- Submit -->
        <div class="form-actions">
          <button type="button" onclick="closeBucketForm()">Cancel</button>
          <button type="submit" class="btn-primary">Save Bucket</button>
        </div>
      </form>
    </div>
  </div>
</div>
```

#### 3. **Trigger List Updates**

**Add Bucket Column:**
```html
<!-- Table header -->
<thead>
  <tr>
    <th width="30">☐</th>
    <th width="40">🗂️</th>  <!-- NEW: Bucket status -->
    <th width="40">📄</th>  <!-- Existing: Publish status -->
    <th width="50">PRI</th>
    <th>LABEL</th>
    <th>KEYWORDS</th>
    <th>ANSWER</th>
    <th>ACTIONS</th>
  </tr>
</thead>
```

**Bucket Status Cell:**
```javascript
function renderBucketStatusCell(trigger, buckets) {
  // alwaysEvaluate = yellow shield
  if (trigger.alwaysEvaluate) {
    return `
      <td class="text-center" title="Emergency - Always Active">
        <span class="status-icon status-emergency">🚨</span>
      </td>
    `;
  }
  
  // Has valid bucket = green check
  if (trigger.bucket) {
    const bucket = buckets.find(b => b.bucketId === trigger.bucket);
    if (bucket) {
      return `
        <td class="text-center" title="Bucket: ${bucket.name}">
          <span class="status-icon status-bucketed">✓</span>
        </td>
      `;
    } else {
      // Invalid bucket reference = red X
      return `
        <td class="text-center" title="Bucket '${trigger.bucket}' not found">
          <span class="status-icon status-invalid">✗</span>
        </td>
      `;
    }
  }
  
  // No bucket = red X
  return `
    <td class="text-center" title="Not assigned to bucket - Click to assign">
      <span class="status-icon status-unbucketed clickable" 
            onclick="quickAssignBucket('${trigger.ruleId}')">✗</span>
    </td>
  `;
}
```

**CSS for Status Icons:**
```css
.status-icon {
  font-size: 18px;
  display: inline-block;
  cursor: default;
}

.status-icon.clickable {
  cursor: pointer;
  opacity: 0.7;
  transition: opacity 0.2s;
}

.status-icon.clickable:hover {
  opacity: 1;
}

.status-bucketed {
  color: #10b981; /* Green */
}

.status-unbucketed,
.status-invalid {
  color: #ef4444; /* Red */
}

.status-emergency {
  color: #f59e0b; /* Yellow/Orange */
}
```

#### 4. **Trigger Edit Form - Bucket Dropdown**

**Add to Edit Modal:**
```html
<!-- In trigger edit form, after priority field -->
<div class="form-group">
  <label>Trigger Bucket</label>
  <select id="trigger-bucket-select" class="form-control">
    <option value="">-- No Bucket (Always Evaluated) --</option>
    <!-- Populated dynamically from state.buckets -->
  </select>
  <small class="form-hint">
    Assign to bucket for faster classification.
    Leave blank if trigger should always be evaluated.
  </small>
</div>

<!-- Emergency Override -->
<div class="form-group">
  <label>
    <input type="checkbox" id="trigger-always-evaluate">
    Emergency Trigger (Always Evaluate)
  </label>
  <small class="form-hint">
    Bypasses bucket filtering - trigger is checked on every call
  </small>
</div>
```

**Populate Dropdown:**
```javascript
function populateBucketDropdown(buckets, selectedBucket = null) {
  const select = document.getElementById('trigger-bucket-select');
  
  // Clear existing options except first (No Bucket)
  while (select.options.length > 1) {
    select.remove(1);
  }
  
  // Add bucket options
  buckets.forEach(bucket => {
    const option = new Option(
      `${bucket.icon} ${bucket.name} (${bucket.triggerCount} triggers)`,
      bucket.bucketId
    );
    select.add(option);
  });
  
  // Set selected value
  if (selectedBucket) {
    select.value = selectedBucket;
  }
}
```

---

## 📊 Health Summary Bar (Top of Page)

**HTML:**
```html
<!-- Add right after page header, before trigger list -->
<div id="bucket-health-summary" class="health-summary-bar"></div>
```

**Render Function:**
```javascript
async function renderBucketHealthSummary() {
  try {
    const response = await fetch(
      `/api/agent-console/trigger-buckets/${state.companyId}/health`
    );
    const { data } = await response.json();
    
    const healthBar = document.getElementById('bucket-health-summary');
    
    if (!healthBar) return;
    
    // Calculate percentages
    const bucketedPercent = data.bucketedPercent || 0;
    const unbucketedPercent = Math.round((data.unbucketed / data.totalTriggers) * 100);
    const emergencyPercent = Math.round((data.emergency / data.totalTriggers) * 100);
    
    let html = '';
    let cssClass = 'health-bar-healthy';
    
    if (data.invalidBucket > 0) {
      cssClass = 'health-bar-critical';
      html = `
        ❌ CRITICAL: ${data.invalidBucket} triggers have invalid bucket assignments
        <button onclick="fixInvalidBuckets()" class="btn-sm btn-danger">Fix Now</button>
      `;
    } else if (bucketedPercent < 50) {
      cssClass = 'health-bar-warning';
      html = `
        ⚠️ Only ${bucketedPercent}% bucketed — ${data.unbucketed} triggers need assignment
        <button onclick="showUnbucketedTriggers()" class="btn-sm">Review</button>
      `;
    } else if (data.unbucketed > 0) {
      cssClass = 'health-bar-info';
      html = `
        📊 ${data.bucketed}/${data.totalTriggers} bucketed (${bucketedPercent}%) 🟢 | 
        ${data.unbucketed} unbucketed (${unbucketedPercent}%) 🔴 | 
        ${data.emergency} emergency (${emergencyPercent}%) 🟡
        <button onclick="showUnbucketedTriggers()" class="btn-sm">Assign Remaining</button>
      `;
    } else {
      cssClass = 'health-bar-healthy';
      html = `
        ✅ ${data.bucketed}/${data.totalTriggers} bucketed (${bucketedPercent}%) 🟢 | 
        ${data.emergency} emergency (${emergencyPercent}%) 🟡 | 
        All triggers healthy!
      `;
    }
    
    healthBar.className = `health-summary-bar ${cssClass}`;
    healthBar.innerHTML = html;
    
  } catch (error) {
    console.error('Failed to load bucket health:', error);
  }
}
```

**CSS:**
```css
.health-summary-bar {
  padding: 12px 20px;
  margin-bottom: 20px;
  border-radius: 8px;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.health-bar-healthy {
  background: #f0fdf4;
  border: 1px solid #86efac;
  color: #166534;
}

.health-bar-info {
  background: #eff6ff;
  border: 1px solid #93c5fd;
  color: #1e40af;
}

.health-bar-warning {
  background: #fffbeb;
  border: 1px solid #fde047;
  color: #92400e;
}

.health-bar-critical {
  background: #fef2f2;
  border: 2px solid #dc2626;
  color: #991b1b;
}
```

---

## 🎯 Trigger List Modifications

### Add Bucket Column to Table

**Current columns:**
```
☐ | ✓ Published | PRI | LABEL | KEYWORDS | ANSWER | ACTIONS
```

**New columns:**
```
☐ | ✓ Bucket | ✓ Published | PRI | LABEL | KEYWORDS | ANSWER | ACTIONS
```

**Update `renderTriggerRow()` function in triggers.js:**
```javascript
function renderTriggerRow(trigger, buckets) {
  const bucketStatus = renderBucketStatus(trigger, buckets);
  const publishedStatus = trigger.state === 'published' 
    ? '<span class="status-icon status-published">✓</span>'
    : '<span class="status-icon status-unpublished">○</span>';
  
  return `
    <tr data-rule-id="${trigger.ruleId}" class="trigger-row">
      <!-- Select checkbox -->
      <td class="text-center">
        <input type="checkbox" class="trigger-select" 
               data-rule-id="${trigger.ruleId}">
      </td>
      
      <!-- BUCKET STATUS (NEW) -->
      ${bucketStatus}
      
      <!-- PUBLISHED STATUS -->
      <td class="text-center" title="${trigger.state === 'published' ? 'Published' : 'Draft'}">
        ${publishedStatus}
      </td>
      
      <!-- Priority -->
      <td class="text-center priority-badge" 
          style="background: ${getPriorityColor(trigger.priority)}">
        P${trigger.priority}
      </td>
      
      <!-- Label -->
      <td>${escapeHtml(trigger.label)}</td>
      
      <!-- Keywords -->
      <td class="keywords-cell">
        ${renderKeywordsPreview(trigger.match?.keywords || [])}
      </td>
      
      <!-- Answer -->
      <td class="answer-cell">
        ${renderAnswerPreview(trigger)}
      </td>
      
      <!-- Actions -->
      <td class="actions-cell">
        <button onclick="editTrigger('${trigger.ruleId}')">Edit</button>
        <button onclick="deleteTrigger('${trigger.ruleId}')">Delete</button>
      </td>
    </tr>
  `;
}

function renderBucketStatus(trigger, buckets) {
  // Emergency - always evaluate
  if (trigger.alwaysEvaluate) {
    return `
      <td class="text-center" title="Emergency - Always Active (bypasses buckets)">
        <span class="status-icon status-emergency">🚨</span>
      </td>
    `;
  }
  
  // Has bucket assignment
  if (trigger.bucket) {
    const bucket = buckets.find(b => b.bucketId === trigger.bucket);
    
    if (bucket) {
      return `
        <td class="text-center" title="Bucket: ${bucket.icon} ${bucket.name}">
          <span class="status-icon status-bucketed">✓</span>
        </td>
      `;
    } else {
      // Invalid bucket
      return `
        <td class="text-center" title="Invalid bucket: ${trigger.bucket}">
          <span class="status-icon status-invalid clickable" 
                onclick="quickAssignBucket('${trigger.ruleId}')">✗</span>
        </td>
      `;
    }
  }
  
  // No bucket - unbucketed
  return `
    <td class="text-center" title="Not bucketed - Click to assign">
      <span class="status-icon status-unbucketed clickable" 
            onclick="quickAssignBucket('${trigger.ruleId}')">✗</span>
    </td>
  `;
}
```

---

## 🔄 Load Buckets on Page Init

**Update initialization:**
```javascript
async function initializePage() {
  // Extract companyId from URL
  const params = new URLSearchParams(window.location.search);
  state.companyId = params.get('companyId');
  
  if (!state.companyId) {
    alert('No companyId provided');
    return;
  }
  
  try {
    // Load company data
    await loadCompanyData();
    
    // Load buckets (NEW)
    await loadBuckets();
    
    // Load triggers
    await loadTriggers();
    
    // Render health summary
    await renderBucketHealthSummary();
    
    // Render UI
    renderTriggerList();
    
  } catch (error) {
    console.error('Initialization failed:', error);
    showToast('Failed to load page data', 'error');
  }
}

async function loadBuckets() {
  try {
    const response = await fetch(
      `/api/agent-console/trigger-buckets/${state.companyId}`
    );
    const { data } = await response.json();
    
    state.buckets = data;
    
    console.log(`Loaded ${data.length} buckets for company`);
    
  } catch (error) {
    console.error('Failed to load buckets:', error);
    state.buckets = [];
  }
}
```

---

## 🚨 Quick Assign Bucket Function

**Click red X to quickly assign bucket:**
```javascript
function quickAssignBucket(ruleId) {
  const trigger = state.triggers.find(t => t.ruleId === ruleId);
  if (!trigger) return;
  
  // Show dropdown modal
  const modal = document.createElement('div');
  modal.className = 'modal active';
  modal.innerHTML = `
    <div class="modal-content small">
      <div class="modal-header">
        <h3>Assign Bucket: ${trigger.label}</h3>
      </div>
      <div class="modal-body">
        <p>Choose a bucket for this trigger:</p>
        <select id="quick-bucket-select" class="form-control">
          <option value="">-- No Bucket --</option>
          ${state.buckets.map(b => 
            `<option value="${b.bucketId}">${b.icon} ${b.name}</option>`
          ).join('')}
        </select>
        
        <div style="margin-top: 12px;">
          <label>
            <input type="checkbox" id="quick-always-evaluate">
            Emergency (Always Evaluate)
          </label>
        </div>
      </div>
      <div class="modal-footer">
        <button onclick="this.closest('.modal').remove()">Cancel</button>
        <button onclick="saveQuickBucketAssignment('${ruleId}')" 
                class="btn-primary">Save</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  document.getElementById('quick-bucket-select').focus();
}

async function saveQuickBucketAssignment(ruleId) {
  const bucketSelect = document.getElementById('quick-bucket-select');
  const alwaysEval = document.getElementById('quick-always-evaluate');
  
  const bucket = bucketSelect.value || null;
  const alwaysEvaluate = alwaysEval.checked;
  
  try {
    // Update trigger
    const response = await fetch(
      `/api/admin/agent2/company/${state.companyId}/triggers/local/${ruleId}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucket, alwaysEvaluate })
      }
    );
    
    if (!response.ok) throw new Error('Update failed');
    
    // Close modal
    document.querySelector('.modal.active').remove();
    
    // Reload triggers
    await loadTriggers();
    renderTriggerList();
    await renderBucketHealthSummary();
    
    showToast('Bucket assigned successfully', 'success');
    
  } catch (error) {
    console.error('Failed to assign bucket:', error);
    showToast('Failed to assign bucket', 'error');
  }
}
```

---

## 📝 Implementation Checklist

### Backend ✅ DONE
- [x] TriggerBucket model
- [x] CompanyLocalTrigger bucket fields
- [x] TriggerBucketClassifier service
- [x] API routes (CRUD)
- [x] Agent2DiscoveryRunner integration
- [x] Zero-match retry safety net
- [x] Health check endpoints

### Frontend 🚧 TODO
- [ ] Bucket Builder Modal UI
- [ ] Bucket list rendering
- [ ] Bucket create/edit forms
- [ ] Bucket delete confirmation
- [ ] Trigger list bucket column
- [ ] Bucket status icons (✓/✗/🚨)
- [ ] Health summary bar
- [ ] Quick assign dropdown
- [ ] Trigger edit form bucket selector
- [ ] Bulk bucket assignment

### Testing & Migration 🚧 TODO
- [ ] Migration script for existing companies
- [ ] Health check script
- [ ] Test bucket classification
- [ ] Test pool filtering
- [ ] Test zero-match retry
- [ ] Validate UI updates

---

## Next Steps

1. **Frontend Implementation** - Build bucket modal and UI updates
2. **Testing Scripts** - Create health checks and migration tools
3. **Documentation** - User guide for bucket management
4. **Deploy** - Test in staging, then production

---

**Backend is solid and pushed to main.** Ready to build the frontend when you are!
