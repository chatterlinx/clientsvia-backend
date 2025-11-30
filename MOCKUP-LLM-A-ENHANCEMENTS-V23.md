# LLM-A TRIAGE BUILDER - V23 ENHANCEMENTS
**Date**: November 30, 2025  
**Purpose**: Show EXACTLY what changes to your existing UI

---

## 🎯 CURRENT STATE (WHAT YOU HAVE NOW)

Your existing LLM-A interface:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ✨ AI Triage Builder                                V22 ENTERPRISE      │
│ LLM-A factory for generating complete TriageCards — drafts only         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ 🧠 V22 Triage Card Factory                                              │
│ Generate a complete TriageCard draft with one click:                   │
│ • Quick Rule Config — Keywords, intent, action, priority               │
│ • Frontline Playbook — Goal + opening lines + objection handling       │
│ • 3-Tier Package Draft — Category, scenario, objective                 │
│                                                                         │
│ ⚠️ Output is DRAFT only — Click "Create Triage Card" to add to brain   │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ 📊 Trade / Industry              📖 Quick Preset (HVAC)                │
│ [HVAC ▼]                         [-- Start from scratch -- ▼]          │
│                                                                         │
│ 📄 Triage Situation / Scenario                                         │
│ ┌─────────────────────────────────────────────────────────────────┐   │
│ │ Describe what the caller says and what you want the AI to      │   │
│ │ understand...                                                   │   │
│ │                                                                 │   │
│ └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│ 🎯 Preferred Action              📁 Triage Category                    │
│ ○ 🔵 3-TIER — Route to scenario  [Cooling / No Cool ▼]                │
│ ○ 🟣 PUSH — Explain then route                                         │
│ ○ 🔴 HUMAN — Transfer immediately  Service Types                       │
│ ○ 🟠 MSG — Take a message         ☑ REPAIR  ☐ MAINTENANCE             │
│                                   ☐ EMERGENCY  ☐ OTHER                │
│                                                                         │
│                              [🎨 Generate TriageCard Draft]             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🆕 ENHANCED STATE (V23 SMART MERGE)

**What we're ADDING to your existing UI:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ✨ AI Triage Builder                                V23 ENTERPRISE      │
│ LLM-A factory for generating complete TriageCards — drafts only         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ ⚠️  PRE-FLIGHT CHECK (NEW) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                         │
│ Brain 2 Status: ✅ 47 Active Scenarios Loaded                          │
│ Company: Penguin Cooling & Heating                                     │
│ Trade: HVAC                                                            │
│                                                                         │
│ You can proceed to create triage cards.                               │
│ [View Active Scenarios →]                                              │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                         │
│ 🧠 V23 Triage Card Factory (ENHANCED)                                  │
│ Generate a complete TriageCard draft with one click:                   │
│ • Quick Rule Config — Keywords, intent, action, priority               │
│ • Frontline Playbook — Goal + opening lines + objection handling       │
│ • 3-Tier Package Draft — Category, scenario, objective                 │
│ • 🆕 Smart Conflict Detection — Prevents duplicate cards                │
│ • 🆕 Scenario Validation — Only links to active Brain 2 scenarios      │
│                                                                         │
│ ⚠️ Output is DRAFT only — Click "Create Triage Card" to add to brain   │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ 📊 Trade / Industry              📖 Quick Preset (HVAC)                │
│ [HVAC ▼]                         [-- Start from scratch -- ▼]          │
│                                                                         │
│ 📄 Triage Situation / Scenario                                         │
│ ┌─────────────────────────────────────────────────────────────────┐   │
│ │ Customer says their AC is not cooling and blowing warm air      │   │
│ │                                                                 │   │
│ └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│ 🎯 Preferred Action              📁 Triage Category                    │
│ ● 🔵 3-TIER — Route to scenario  [Cooling / No Cool ▼]                │
│ ○ 🟣 PUSH — Explain then route                                         │
│ ○ 🔴 HUMAN — Transfer immediately  Service Types                       │
│ ○ 🟠 MSG — Take a message         ☑ REPAIR  ☐ MAINTENANCE             │
│                                   ☐ EMERGENCY  ☐ OTHER                │
│                                                                         │
│ 🔗 Link to Brain 2 Scenario (NEW) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                         │
│ 💡 Smart Suggestions (based on your description):                      │
│                                                                         │
│ ┌─────────────────────────────────────────────────────────────────┐   │
│ │ ✓ ac_not_cooling_repair                                  (95%)  │   │
│ │   "AC Not Cooling - Emergency Repair"                           │   │
│ │   Category: AC Repair | Service: REPAIR                         │   │
│ │   [Select This Scenario]                                        │   │
│ └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│ ┌─────────────────────────────────────────────────────────────────┐   │
│ │   ac_warm_air_diagnosis                                  (78%)  │   │
│ │   "Warm Air Diagnosis & Repair"                                 │   │
│ │   Category: AC Repair | Service: REPAIR                         │   │
│ │   [Select This Scenario]                                        │   │
│ └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│ [🔍 Browse All 47 Scenarios] or [Skip - Let LLM-A Choose]              │
│                                                                         │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                         │
│                              [🎨 Generate TriageCard Draft]             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🔄 AFTER CLICKING "GENERATE" (NEW BEHAVIOR)

### SCENARIO A: No Conflicts (Same as before)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ✅ DRAFT GENERATED                                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ 🔷 AC Not Cooling - Emergency Repair                                    │
│                                                                         │
│ 🔑 Quick Rule Config                                                   │
│ • Keywords: ac, not cooling, warm air                                  │
│ • Intent: AC_REPAIR_EMERGENCY                                          │
│ • Action: DIRECT_TO_3TIER                                              │
│ • Priority: 110                                                        │
│                                                                         │
│ 📖 Frontline Playbook                                                  │
│ Goal: Route to emergency AC repair                                     │
│ Opening: "I understand your AC isn't cooling. Let me help..."          │
│                                                                         │
│ 📦 3-Tier Package Draft                                                │
│ Category: AC Repair                                                    │
│ Scenario: ac_not_cooling_repair ✓                                      │
│                                                                         │
│ ✅ Validation: PASSED (95% test coverage)                              │
│ ⚠️ Conflicts: None found                                                │
│                                                                         │
│ [← Back] [Edit Draft] [Create Triage Card →]                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### SCENARIO B: Conflict Detected (NEW!)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ⚠️  SMART MERGE SUGGESTION                                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ We found an existing card that handles similar requests:               │
│                                                                         │
│ ┌─ EXISTING CARD ──────────────┐   ┌─ YOUR NEW DRAFT ─────────────┐  │
│ │                               │   │                               │  │
│ │ 🔷 AC Not Cooling             │   │ 🆕 AC Blowing Warm Air        │  │
│ │ Status: 🟢 Active             │   │ Status: Draft                 │  │
│ │                               │   │                               │  │
│ │ Keywords (4):                 │   │ Keywords (3):                 │  │
│ │ • ac                          │   │ • ac ✓                        │  │
│ │ • not cooling                 │   │ • blowing warm                │  │
│ │ • warm air ✓                  │   │ • not working                 │  │
│ │ • no cold air                 │   │                               │  │
│ │                               │   │                               │  │
│ │ Scenario:                     │   │ Scenario:                     │  │
│ │ ac_not_cooling_repair ✓       │   │ ac_not_cooling_repair ✓       │  │
│ │                               │   │                               │  │
│ │ Performance:                  │   │ Performance:                  │  │
│ │ 92% success                   │   │ Not active yet                │  │
│ │ 147 matches                   │   │ 0 matches                     │  │
│ │                               │   │                               │  │
│ └───────────────────────────────┘   └───────────────────────────────┘  │
│                                                                         │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                         │
│ 📊 Analysis:                                                           │
│ • Keyword Overlap: 67% (2 shared: "ac", "warm")                       │
│ • Scenario Match: ✅ Both target ac_not_cooling_repair                 │
│ • Recommendation: MERGE (prevents duplicate routing)                   │
│                                                                         │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                         │
│ 💡 If you merge, the existing card will have 6 keywords:               │
│ ac • not cooling • warm air • no cold air • blowing warm • not working │
│                                                                         │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                         │
│ What would you like to do?                                             │
│                                                                         │
│ ┌─────────────────────────────────────────────────────────────────┐   │
│ │ [✨ Merge into Existing Card] (Recommended)                      │   │
│ │ Adds 2 new keywords: "blowing warm", "not working"              │   │
│ │ Existing card's coverage will improve to 6 keywords total       │   │
│ └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│ ┌─────────────────────────────────────────────────────────────────┐   │
│ │ [📝 Create New Card Anyway]                                      │   │
│ │ You'll have 2 separate cards handling similar situations        │   │
│ │ Warning: May cause routing conflicts                             │   │
│ └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│ ┌─────────────────────────────────────────────────────────────────┐   │
│ │ [🔧 Edit Draft First]                                            │   │
│ │ Modify keywords or scenario before deciding                      │   │
│ └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│ [❌ Cancel]                                                             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🚫 SCENARIO C: Pre-Flight Failure (NEW!)

**If admin tries to create a card but Brain 2 has no scenarios:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ✨ AI Triage Builder                                V23 ENTERPRISE      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ ❌ PRE-FLIGHT CHECK FAILED                                             │
│                                                                         │
│ ┌─────────────────────────────────────────────────────────────────┐   │
│ │ ⚠️  NO SCENARIOS LOADED                                          │   │
│ │                                                                  │   │
│ │ Brain 2 Status: ❌ 0 Active Scenarios                           │   │
│ │ Company: Penguin Cooling & Heating                              │   │
│ │ Trade: HVAC                                                     │   │
│ │                                                                  │   │
│ │ You cannot create triage cards without active scenarios.       │   │
│ │                                                                  │   │
│ │ 🎯 THE GOLDEN RULE:                                             │   │
│ │ Build Brain 2 (Scenarios) FIRST, then Brain 1 (Triage)         │   │
│ │                                                                  │   │
│ │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │   │
│ │                                                                  │   │
│ │ What to do:                                                     │   │
│ │ 1. Go to "AI Core → Live Scenarios"                            │   │
│ │ 2. Activate at least 1 template (e.g., HVAC Repair templates) │   │
│ │ 3. Return here to create triage cards                          │   │
│ │                                                                  │   │
│ │ [🚀 Go to AiCore Scenarios →]                                   │   │
│ │                                                                  │   │
│ └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│ 🧠 V23 Triage Card Factory                                              │
│ (DISABLED - Activate scenarios first)                                  │
│                                                                         │
│ ┌─────────────────────────────────────────────────────────────────┐   │
│ │ All fields are disabled until scenarios are loaded              │   │
│ └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 📋 EXACT CHANGES TO YOUR CURRENT UI

### Change #1: Add Pre-Flight Check Box (TOP OF PAGE)

**Location**: Above "V22 Triage Card Factory"  
**What it does**: Shows Brain 2 status before allowing card creation

**HTML Addition**:
```html
<!-- ADD THIS SECTION AT THE TOP -->
<div class="preflight-check">
  <h3>⚠️ PRE-FLIGHT CHECK</h3>
  
  <div id="preflight-status">
    <!-- Populated by JavaScript -->
  </div>
  
  <!-- If failed: -->
  <div class="preflight-failed" style="display: none;">
    <div class="alert alert-danger">
      <h4>❌ NO SCENARIOS LOADED</h4>
      <p>Brain 2 has 0 active scenarios. You must activate templates first.</p>
      <button onclick="location.href='/control-plane-v2.html?tab=scenarios'">
        🚀 Go to AiCore Scenarios
      </button>
    </div>
  </div>
  
  <!-- If passed: -->
  <div class="preflight-passed" style="display: none;">
    <div class="alert alert-success">
      ✅ <strong>47 Active Scenarios Loaded</strong><br>
      Company: <span id="company-name"></span><br>
      Trade: <span id="company-trade"></span><br>
      <a href="/control-plane-v2.html?tab=scenarios">View Active Scenarios →</a>
    </div>
  </div>
</div>
```

**JavaScript Addition**:
```javascript
// ADD THIS FUNCTION
async function checkPreFlight() {
  const companyId = getCompanyId();
  
  const response = await fetch(
    `/api/admin/triage-builder/preflight/${companyId}`,
    { headers: { 'Authorization': `Bearer ${getToken()}` } }
  );
  
  const result = await response.json();
  
  if (!result.canProceed) {
    // Show failure state
    document.querySelector('.preflight-failed').style.display = 'block';
    document.querySelector('.preflight-passed').style.display = 'none';
    
    // Disable all form fields
    disableTriageBuilder();
  } else {
    // Show success state
    document.querySelector('.preflight-failed').style.display = 'none';
    document.querySelector('.preflight-passed').style.display = 'block';
    document.getElementById('company-name').textContent = result.companyName;
    document.getElementById('company-trade').textContent = result.trade;
    
    // Enable form
    enableTriageBuilder();
  }
}

// Call on page load
document.addEventListener('DOMContentLoaded', checkPreFlight);
```

---

### Change #2: Add Scenario Suggestions Section

**Location**: After "Service Types" checkboxes, before "Generate" button  
**What it does**: Shows AI-powered scenario suggestions based on description

**HTML Addition**:
```html
<!-- ADD THIS SECTION -->
<div class="scenario-suggestions">
  <h4>🔗 Link to Brain 2 Scenario</h4>
  <p>💡 Smart Suggestions (based on your description):</p>
  
  <div id="scenario-suggestions-list">
    <!-- Populated by JavaScript after user types description -->
  </div>
  
  <button onclick="browseAllScenarios()">
    🔍 Browse All 47 Scenarios
  </button>
  
  <p class="text-muted">
    Or skip this step and let LLM-A choose the best match automatically.
  </p>
</div>
```

**JavaScript Addition**:
```javascript
// ADD THIS FUNCTION
async function loadScenarioSuggestions() {
  const description = document.getElementById('triage-description').value;
  
  if (description.length < 20) return; // Wait for meaningful input
  
  const response = await fetch(`/api/admin/triage-builder/suggest-scenarios`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken()}`
    },
    body: JSON.stringify({
      companyId: getCompanyId(),
      description: description
    })
  });
  
  const suggestions = await response.json();
  
  // Render suggestions
  const listEl = document.getElementById('scenario-suggestions-list');
  listEl.innerHTML = suggestions.scenarios.map(s => `
    <div class="scenario-suggestion ${s.selected ? 'selected' : ''}">
      <div class="scenario-header">
        <strong>${s.scenarioKey}</strong>
        <span class="confidence">(${Math.round(s.confidence * 100)}%)</span>
      </div>
      <div class="scenario-name">"${s.name}"</div>
      <div class="scenario-meta">
        Category: ${s.categoryKey} | Service: ${s.serviceType}
      </div>
      <button onclick="selectScenario('${s.scenarioKey}')">
        ${s.selected ? '✓ Selected' : 'Select This Scenario'}
      </button>
    </div>
  `).join('');
}

// Debounced trigger on description change
let descriptionTimeout;
document.getElementById('triage-description').addEventListener('input', () => {
  clearTimeout(descriptionTimeout);
  descriptionTimeout = setTimeout(loadScenarioSuggestions, 1000);
});
```

---

### Change #3: Modify Generate Button Behavior

**Location**: Replace current "Generate TriageCard Draft" button  
**What it does**: Add conflict detection after generation

**JavaScript Modification**:
```javascript
// REPLACE THIS FUNCTION
async function generateTriageCard() {
  // ... existing generation logic ...
  
  const draft = await generateDraftFromLLM();
  
  // 🆕 NEW: Check for conflicts
  const conflictCheck = await fetch('/api/admin/triage-builder/check-conflicts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken()}`
    },
    body: JSON.stringify({
      companyId: getCompanyId(),
      draft: draft
    })
  });
  
  const conflicts = await conflictCheck.json();
  
  if (conflicts.hasConflict) {
    // 🆕 NEW: Show merge modal
    showSmartMergeModal(conflicts.existingCard, draft, conflicts.suggestion);
  } else {
    // Original behavior: Show draft review
    showDraftReview(draft);
  }
}
```

---

### Change #4: Add Smart Merge Modal (NEW COMPONENT)

**Location**: New modal overlay  
**What it does**: Visual comparison and merge options

**HTML Addition**:
```html
<!-- ADD THIS MODAL -->
<div id="smart-merge-modal" class="modal" style="display: none;">
  <div class="modal-content large">
    <h2>⚠️ SMART MERGE SUGGESTION</h2>
    
    <p>We found an existing card that handles similar requests:</p>
    
    <div class="comparison-grid">
      <div class="existing-card">
        <h3>🔷 EXISTING CARD</h3>
        <div id="existing-card-details"></div>
      </div>
      
      <div class="new-draft">
        <h3>🆕 YOUR NEW DRAFT</h3>
        <div id="new-draft-details"></div>
      </div>
    </div>
    
    <div class="analysis">
      <h4>📊 Analysis:</h4>
      <ul id="conflict-analysis"></ul>
    </div>
    
    <div class="merge-preview">
      <h4>💡 If you merge, the existing card will have:</h4>
      <div id="merged-keywords"></div>
    </div>
    
    <div class="actions">
      <button class="btn btn-primary" onclick="mergeCards()">
        ✨ Merge into Existing Card (Recommended)
      </button>
      <button class="btn btn-secondary" onclick="createNewAnyway()">
        📝 Create New Card Anyway
      </button>
      <button class="btn btn-secondary" onclick="editDraftFirst()">
        🔧 Edit Draft First
      </button>
      <button class="btn btn-link" onclick="closeMergeModal()">
        ❌ Cancel
      </button>
    </div>
  </div>
</div>
```

**JavaScript Addition**:
```javascript
// ADD THESE FUNCTIONS
function showSmartMergeModal(existingCard, newDraft, suggestion) {
  const modal = document.getElementById('smart-merge-modal');
  
  // Populate existing card
  document.getElementById('existing-card-details').innerHTML = `
    <strong>${existingCard.displayName}</strong>
    <div class="status">Status: 🟢 Active</div>
    <div class="keywords">
      <strong>Keywords (${existingCard.keywords.length}):</strong>
      ${existingCard.keywords.map(k => `<span class="keyword">${k}</span>`).join(' ')}
    </div>
    <div class="scenario">Scenario: ${existingCard.linkedScenarioKey}</div>
    <div class="performance">
      Performance: ${existingCard.successRate}% success, ${existingCard.totalMatches} matches
    </div>
  `;
  
  // Populate new draft
  document.getElementById('new-draft-details').innerHTML = `
    <strong>${newDraft.displayName}</strong>
    <div class="status">Status: Draft</div>
    <div class="keywords">
      <strong>Keywords (${newDraft.keywords.length}):</strong>
      ${newDraft.keywords.map(k => `<span class="keyword">${k}</span>`).join(' ')}
    </div>
    <div class="scenario">Scenario: ${newDraft.linkedScenarioKey}</div>
    <div class="performance">Performance: Not active yet</div>
  `;
  
  // Populate analysis
  document.getElementById('conflict-analysis').innerHTML = `
    <li>Keyword Overlap: <strong>${Math.round(suggestion.overlapPercent)}%</strong></li>
    <li>Scenario Match: ${suggestion.sameScenario ? '✅ Both target same scenario' : '❌ Different scenarios'}</li>
    <li>Recommendation: <strong>${suggestion.action}</strong></li>
  `;
  
  // Populate merge preview
  document.getElementById('merged-keywords').innerHTML = 
    suggestion.newKeywords.map(k => `<span class="keyword new">${k}</span>`).join(' ');
  
  modal.style.display = 'block';
}

async function mergeCards() {
  const response = await fetch('/api/admin/triage-builder/merge-cards', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken()}`
    },
    body: JSON.stringify({
      companyId: getCompanyId(),
      targetCardId: currentConflict.existingCard._id,
      newKeywords: currentConflict.suggestion.newKeywords,
      updatedBy: getCurrentUserId()
    })
  });
  
  const result = await response.json();
  
  if (result.ok) {
    showSuccessMessage(`Card updated! Added ${result.addedKeywords} new keywords.`);
    closeMergeModal();
    refreshCardList();
  }
}
```

---

## 📊 CSS STYLES TO ADD

```css
/* Pre-Flight Check Styles */
.preflight-check {
  margin: 20px 0;
  padding: 15px;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  background: #f9f9f9;
}

.preflight-check .alert-success {
  background: #d4edda;
  border-color: #c3e6cb;
  color: #155724;
  padding: 15px;
  border-radius: 4px;
}

.preflight-check .alert-danger {
  background: #f8d7da;
  border-color: #f5c6cb;
  color: #721c24;
  padding: 15px;
  border-radius: 4px;
}

/* Scenario Suggestions Styles */
.scenario-suggestions {
  margin: 20px 0;
  padding: 15px;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  background: #ffffff;
}

.scenario-suggestion {
  padding: 12px;
  margin: 10px 0;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  transition: all 0.2s;
}

.scenario-suggestion:hover {
  border-color: #3B82F6;
  background: #F0F9FF;
}

.scenario-suggestion.selected {
  border-color: #22C55E;
  background: #F0FDF4;
}

.scenario-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 5px;
}

.confidence {
  color: #6B7280;
  font-size: 0.9em;
}

.scenario-meta {
  font-size: 0.85em;
  color: #6B7280;
  margin: 5px 0;
}

/* Smart Merge Modal Styles */
#smart-merge-modal {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.7);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
}

#smart-merge-modal .modal-content {
  background: white;
  padding: 30px;
  border-radius: 12px;
  max-width: 900px;
  max-height: 90vh;
  overflow-y: auto;
}

.comparison-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin: 20px 0;
}

.existing-card, .new-draft {
  padding: 15px;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
}

.existing-card {
  background: #F0F9FF;
  border-color: #3B82F6;
}

.new-draft {
  background: #FFF7ED;
  border-color: #F59E0B;
}

.keyword {
  display: inline-block;
  padding: 4px 8px;
  margin: 2px;
  background: #3B82F6;
  color: white;
  border-radius: 4px;
  font-size: 0.85em;
}

.keyword.new {
  background: #22C55E;
}

.analysis {
  background: #F9FAFB;
  padding: 15px;
  border-radius: 8px;
  margin: 20px 0;
}

.merge-preview {
  background: #FFF7ED;
  padding: 15px;
  border-radius: 8px;
  margin: 20px 0;
}

.actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin-top: 20px;
}

.actions button {
  padding: 10px 20px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 16px;
}

.btn-primary {
  background: #22C55E;
  color: white;
  border: none;
}

.btn-primary:hover {
  background: #16A34A;
}

.btn-secondary {
  background: #6B7280;
  color: white;
  border: none;
}

.btn-secondary:hover {
  background: #4B5563;
}
```

---

## 📝 SUMMARY OF CHANGES

### Your Existing UI (Unchanged):
- ✅ Trade / Industry dropdown
- ✅ Quick Preset dropdown
- ✅ Triage Situation textarea
- ✅ Preferred Action radio buttons
- ✅ Triage Category dropdown
- ✅ Service Types checkboxes
- ✅ Generate button

### New Additions (V23):
1. **Pre-Flight Check Box** (top of page)
   - Shows Brain 2 status
   - Blocks creation if no scenarios

2. **Scenario Suggestions Section** (after Service Types)
   - AI-powered scenario matching
   - Select from top suggestions or browse all

3. **Smart Merge Modal** (popup after generation)
   - Side-by-side comparison
   - Merge options with preview

4. **Enhanced Generate Logic** (backend)
   - Conflict detection
   - Referential integrity validation

---

## 🎯 BACKEND API CHANGES

### New Endpoints to Build:

```javascript
// 1. Pre-flight check (already built in previous work)
GET /api/admin/triage-builder/preflight/:companyId

// 2. Scenario suggestions (NEW)
POST /api/admin/triage-builder/suggest-scenarios
Body: { companyId, description }
Response: { scenarios: [{ scenarioKey, name, confidence }] }

// 3. Conflict detection (NEW)
POST /api/admin/triage-builder/check-conflicts
Body: { companyId, draft }
Response: { hasConflict, existingCard, suggestion }

// 4. Merge cards (NEW)
POST /api/admin/triage-builder/merge-cards
Body: { companyId, targetCardId, newKeywords, updatedBy }
Response: { ok, card, addedKeywords }
```

---

## 🚀 IMPLEMENTATION PRIORITY

**Phase 1: Pre-Flight Check** (1 hour)
- Add check box to UI
- Wire to existing `/preflight` endpoint
- Disable form if check fails

**Phase 2: Conflict Detection** (3 hours)
- Build conflict detection service
- Add `/check-conflicts` endpoint
- Add smart merge modal UI

**Phase 3: Scenario Suggestions** (2 hours)
- Build suggestion service
- Add `/suggest-scenarios` endpoint
- Add suggestions UI section

**Total: 6 hours for complete V23 LLM-A enhancement**

---

**Marc, this shows EXACTLY what changes to your existing LLM-A UI. Should I start building?** 🎯

