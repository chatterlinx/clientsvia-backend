# 🎨 CHEATSHEET FRONTEND INTEGRATION PLAN

**Date**: November 20, 2025  
**Status**: Phase 3 - Frontend Integration  
**Approach**: Gradual migration (keep old system working during transition)

---

## 🎯 INTEGRATION STRATEGY

### Option A: **Complete Rewrite** (Risky)
- Replace all load/save logic
- All-or-nothing deployment
- High risk of breaking existing functionality

### Option B: **Gradual Migration** (RECOMMENDED) ⭐
- Add new Draft/Live UI alongside existing system
- Keep old save working (fallback)
- Feature flag to enable new system per company
- Low risk, can test incrementally

**We're going with Option B** for safety and flexibility.

---

## 📋 IMPLEMENTATION PLAN

### Phase 3A: Add Version Status Display (Non-Breaking)
**Goal**: Show Draft/Live status without changing save behavior

**Changes to CheatSheetManager.js**:
1. Add `loadVersionStatus()` method
2. Add Draft/Live status panel to UI
3. Display which version is currently live
4. No changes to existing save logic yet

**UI Mockup**:
```
┌─────────────────────────────────────────────────────────┐
│ Cheat Sheet – The Config Place                          │
│ Configure THE BRAIN (Triage Engine), Frontline-Intel... │
├─────────────────────────────────────────────────────────┤
│                                                          │
│ 📊 CONFIGURATION STATUS                                  │
│ ┌───────────────────────────────────────────────────┐   │
│ │ 🟢 LIVE: "Holiday Hours Config"                   │   │
│ │    Activated: Nov 20, 2024 at 10:30 AM            │   │
│ │    [👁️ View]                                       │   │
│ │                                                     │   │
│ │ 🟡 DRAFT: "Testing New Booking Rules"             │   │
│ │    Last saved: 5 minutes ago                       │   │
│ │    Unsaved changes: YES ⚠️                         │   │
│ │    [💾 Save Draft] [🚀 Push Live] [🗑️ Discard]    │   │
│ └───────────────────────────────────────────────────┘   │
│                                                          │
│ [Existing tabs: Triage | Transfer | Edge Cases...]      │
└─────────────────────────────────────────────────────────┘
```

### Phase 3B: Add Draft Management (New Features)
**Goal**: Enable draft creation and management

**New Methods**:
- `createDraft(name, notes)` - Create draft from live
- `saveDraft()` - Save changes to draft (not live)
- `discardDraft()` - Delete draft
- `pushDraftLive()` - Promote draft to live

**New UI Elements**:
- "Create Draft" button
- "Push Live" button with confirmation modal
- "Discard Draft" button with confirmation

### Phase 3C: Add Version History Tab (New Feature)
**Goal**: Browse and restore past versions

**New Tab**: "Version History"

**Features**:
- List of past versions (most recent first)
- Each version shows: name, date, who created it
- "View" button (opens modal with full config)
- "Restore" button (creates draft from archived version)

### Phase 3D: Migration Path (Controlled Rollout)
**Goal**: Safely migrate companies to new system

**Feature Flag**:
```javascript
useVersioningSystem: Boolean (default: false)
```

**Logic**:
```javascript
async save() {
  if (this.company.useVersioningSystem) {
    // NEW: Save to draft via API
    return this.saveDraft();
  } else {
    // OLD: Save directly to company.aiAgentSettings.cheatSheet
    return this.saveLegacy();
  }
}
```

---

## 🔧 TECHNICAL IMPLEMENTATION

### 1. Add Version API Client

```javascript
class CheatSheetVersionAPI {
  constructor(companyId) {
    this.companyId = companyId;
    this.baseUrl = '/api/cheatsheet';
    this.token = localStorage.getItem('adminToken');
  }
  
  async getStatus() {
    const response = await fetch(`${this.baseUrl}/status/${this.companyId}`, {
      headers: { 'Authorization': `Bearer ${this.token}` }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  }
  
  async createDraft(name, baseVersionId = null, notes = '') {
    const response = await fetch(`${this.baseUrl}/draft/${this.companyId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name, baseVersionId, notes })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  }
  
  async saveDraft(versionId, config, expectedVersion = null) {
    const response = await fetch(
      `${this.baseUrl}/draft/${this.companyId}/${versionId}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ config, expectedVersion })
      }
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  }
  
  async pushDraftLive(versionId) {
    const response = await fetch(
      `${this.baseUrl}/draft/${this.companyId}/${versionId}/push-live`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.token}` }
      }
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  }
  
  async discardDraft(versionId) {
    const response = await fetch(
      `${this.baseUrl}/draft/${this.companyId}/${versionId}`,
      {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${this.token}` }
      }
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  }
  
  async getVersionHistory(limit = 50) {
    const response = await fetch(
      `${this.baseUrl}/versions/${this.companyId}?limit=${limit}`,
      {
        headers: { 'Authorization': `Bearer ${this.token}` }
      }
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  }
  
  async restoreVersion(versionId, name, notes = '') {
    const response = await fetch(
      `${this.baseUrl}/versions/${this.companyId}/${versionId}/restore`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name, notes })
      }
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  }
}
```

### 2. Update CheatSheetManager Constructor

```javascript
constructor(options = {}) {
  // ... existing code ...
  
  // NEW: Version API client
  this.versionAPI = null; // Initialized in load()
  this.versionStatus = null; // { live, draft }
  this.currentDraftId = null;
  this.useVersioning = false; // Feature flag
}
```

### 3. Update load() Method

```javascript
async load(companyId) {
  this.companyId = companyId;
  this.isReady = false;
  
  console.log('[CHEAT SHEET] Loading for company:', companyId);
  
  try {
    const token = localStorage.getItem('adminToken');
    
    // Fetch company data
    const response = await fetch(`/api/company/${companyId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    const company = data.company || data;
    
    // Check if company uses versioning system
    this.useVersioning = company.useVersioningSystem === true;
    
    if (this.useVersioning) {
      // NEW PATH: Load from versioning API
      this.versionAPI = new CheatSheetVersionAPI(companyId);
      await this.loadFromVersionAPI();
    } else {
      // OLD PATH: Load from company document (legacy)
      this.cheatSheet = company.aiAgentSettings?.cheatSheet || this.getDefaultCheatSheet();
      this.initializeV2Arrays();
    }
    
    this.isReady = true;
    this.isDirty = false;
    
    console.log('[CHEAT SHEET] ✅ Load complete');
    
  } catch (err) {
    console.error('[CHEAT SHEET] ❌ Load failed:', err);
    this.showNotification('Failed to load cheat sheet', 'error');
  }
}

async loadFromVersionAPI() {
  console.log('[CHEAT SHEET] 📡 Loading from Version API...');
  
  // Get version status
  const statusData = await this.versionAPI.getStatus();
  this.versionStatus = statusData.data;
  
  if (this.versionStatus.draft) {
    // Load draft config
    this.currentDraftId = this.versionStatus.draft.versionId;
    const draftData = await this.versionAPI.getVersion(
      this.currentDraftId,
      true // includeConfig
    );
    this.cheatSheet = draftData.data.config;
    console.log('[CHEAT SHEET] 📝 Loaded DRAFT config');
  } else if (this.versionStatus.live) {
    // No draft - load live config for viewing
    const liveData = await this.versionAPI.getVersion(
      this.versionStatus.live.versionId,
      true // includeConfig
    );
    this.cheatSheet = liveData.data.config;
    console.log('[CHEAT SHEET] 🟢 Loaded LIVE config (read-only mode)');
  } else {
    // No live or draft - use defaults
    this.cheatSheet = this.getDefaultCheatSheet();
    console.log('[CHEAT SHEET] 🆕 No config found - using defaults');
  }
  
  // Render version status panel
  this.renderVersionStatus();
}
```

### 4. Add Version Status Renderer

```javascript
renderVersionStatus() {
  if (!this.useVersioning) return;
  
  const container = document.getElementById('cheatsheet-version-status');
  if (!container) return;
  
  const { live, draft } = this.versionStatus || {};
  
  container.innerHTML = `
    <div class="bg-slate-800 rounded-xl p-4 mb-4">
      <h3 class="text-lg font-semibold text-slate-100 mb-3">Configuration Status</h3>
      
      ${live ? `
        <div class="mb-3 p-3 bg-green-900/20 border border-green-600/30 rounded-lg">
          <div class="flex items-center justify-between">
            <div>
              <div class="text-green-400 font-medium">🟢 LIVE</div>
              <div class="text-sm text-slate-300">${live.name}</div>
              <div class="text-xs text-slate-400">
                Activated: ${new Date(live.activatedAt).toLocaleString()}
              </div>
            </div>
            <button 
              onclick="window.cheatSheetManager.viewVersion('${live.versionId}')"
              class="px-3 py-1 text-sm rounded border border-green-600 text-green-300 hover:bg-green-900/40"
            >
              👁️ View
            </button>
          </div>
        </div>
      ` : ''}
      
      ${draft ? `
        <div class="mb-3 p-3 bg-yellow-900/20 border border-yellow-600/30 rounded-lg">
          <div class="flex items-center justify-between">
            <div>
              <div class="text-yellow-400 font-medium">🟡 DRAFT (Editing)</div>
              <div class="text-sm text-slate-300">${draft.name}</div>
              <div class="text-xs text-slate-400">
                Last saved: ${new Date(draft.updatedAt).toLocaleString()}
                ${this.isDirty ? ' <span class="text-red-400">⚠️ Unsaved changes</span>' : ''}
              </div>
            </div>
            <div class="flex gap-2">
              <button 
                onclick="window.cheatSheetManager.pushDraftLive()"
                class="px-3 py-1 text-sm rounded bg-blue-600 text-white hover:bg-blue-500"
              >
                🚀 Push Live
              </button>
              <button 
                onclick="window.cheatSheetManager.discardDraft()"
                class="px-3 py-1 text-sm rounded border border-red-500 text-red-300 hover:bg-red-900/40"
              >
                🗑️ Discard
              </button>
            </div>
          </div>
        </div>
      ` : `
        <div class="p-3 bg-slate-700/30 border border-slate-600 rounded-lg">
          <div class="text-slate-400 text-sm mb-2">No draft in progress</div>
          <button 
            onclick="window.cheatSheetManager.createDraft()"
            class="px-4 py-2 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-500"
          >
            📝 Create Draft
          </button>
        </div>
      `}
    </div>
  `;
}
```

### 5. Update save() Method

```javascript
async save() {
  if (this.useVersioning) {
    return this.saveDraft();
  } else {
    return this.saveLegacy();
  }
}

// NEW: Save to draft via API
async saveDraft() {
  if (!this.currentDraftId) {
    this.showNotification('No draft to save. Create a draft first.', 'error');
    return;
  }
  
  try {
    await this.versionAPI.saveDraft(
      this.currentDraftId,
      this.cheatSheet,
      this.versionStatus.draft.version // Optimistic concurrency
    );
    
    this.isDirty = false;
    this.showSuccessPopup('Draft saved successfully');
    
    // Reload status
    await this.loadFromVersionAPI();
    
  } catch (err) {
    console.error('[CHEAT SHEET] Save failed:', err);
    
    if (err.message.includes('409')) {
      this.showNotification('Draft was modified by another user. Please reload.', 'error');
    } else {
      this.showNotification('Failed to save draft', 'error');
    }
  }
}

// OLD: Save directly to company (legacy)
async saveLegacy() {
  // ... existing save logic ...
}
```

---

## 🎯 ROLLOUT PLAN

### Week 1: Deploy Phase 3A (Display Only)
- Add version status display
- No functional changes to save
- Test with all companies
- Collect feedback

### Week 2: Deploy Phase 3B (Draft Management)
- Enable draft creation/save for **test companies only**
- Feature flag: `useVersioningSystem: false` (default)
- Monitor for issues

### Week 3: Enable for Selected Companies
- Turn on versioning for 5-10 companies
- Monitor performance, cache hit ratio
- Collect user feedback
- Fix any issues

### Week 4: Full Rollout
- Run migration script for all companies
- Enable versioning system-wide
- Monitor Redis cache performance
- Deprecate legacy save path

---

## ✅ SUCCESS CRITERIA

1. ✅ Version status displays correctly
2. ✅ Draft creation works
3. ✅ Draft save works (with optimistic concurrency)
4. ✅ Push live works (atomic transaction)
5. ✅ Redis cache hit ratio >95%
6. ✅ No data loss during migration
7. ✅ User feedback positive
8. ✅ All 21 companies migrated successfully

---

## 🚨 ROLLBACK PLAN

If issues occur:
1. Set `useVersioningSystem: false` for affected companies
2. System falls back to legacy save
3. Diagnose issue in test environment
4. Fix and redeploy
5. Re-enable versioning system

---

**Status**: Ready to implement  
**Risk Level**: Low (gradual migration with fallback)  
**Timeline**: 4 weeks for full rollout

