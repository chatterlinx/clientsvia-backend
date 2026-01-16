# Wiring JSON Report Investigation

## Problem
The "Copy PATCH JSON" and "Download .json" buttons in the AI Test Console are returning empty or minimal JSON, when they used to contain a comprehensive wiring report.

## Root Cause Analysis

### How it Works
1. **Test Run**: When you run a test in AI Test Console, the response includes a `debugSnapshot` object
2. **Diagnostics**: The console calls `/api/admin/wiring-status/:companyId/diagnose` with the `debugSnapshot`
3. **Diagnosis**: Backend runs `diagnoseFromSnapshot()` which:
   - Extracts evidence from the snapshot
   - Runs diagnostic rules against the evidence
   - Generates a `patchJson` containing all issues found
4. **Export**: The `patchJson` is what gets copied/downloaded

### Potential Causes for Empty JSON

#### 1. **No Critical Issues Detected** (MOST LIKELY)
If your wiring is now healthy, the diagnostic rules won't fire, resulting in an empty `issues` array:

```javascript
patchJson = {
  criticalIssues: [],  // No CRITICAL issues
  highIssues: [],      // No HIGH issues  
  mediumIssues: [],    // No MEDIUM issues
  summary: { totalIssues: 0, critical: 0, high: 0, medium: 0 }
}
```

**Recent Changes (since 9f7d3d3):**
- Some diagnostic rules now skip BOOKING mode (lines 73, 87 in WiringDiagnosticService.js)
- This means if you're testing in BOOKING mode, fewer issues will be detected

#### 2. **No Test Run Yet**
If you haven't run a test after opening the console:
- `debugSnapshot` is null
- Backend uses `getQuickDiagnostics()` instead
- Quick diagnostics may have less complete evidence

#### 3. **Frontend Not Loading Diagnostics**
Check browser console for:
- Failed API calls to `/api/admin/wiring-status/:companyId/diagnose`
- `this.lastDiagnostics` is null/undefined

## Debugging Steps

### Step 1: Check if Test Was Run
Open browser console and type:
```javascript
window.aiTestConsole.debugLog
```
If this is empty, you haven't run a test yet.

### Step 2: Check Last Diagnostics
```javascript
window.aiTestConsole.lastDiagnostics
```
If this is null/undefined, diagnostics weren't loaded.

### Step 3: Check if Diagnostics Have Issues
```javascript
window.aiTestConsole.lastDiagnostics?.issues
window.aiTestConsole.lastDiagnostics?.patchJson
```
If `issues` is an empty array, your wiring is healthy!

### Step 4: Force Diagnostics Reload
Click on the "Wiring" tab in the test console to trigger a diagnostic run, then check the JSON again.

### Step 5: Check Backend Response
In browser Network tab:
1. Run a test
2. Look for call to `/api/admin/wiring-status/:companyId/diagnose`
3. Check the response body - does it have issues?

## Expected Behavior

### Healthy Wiring (Empty JSON is CORRECT)
If your wiring is properly configured:
- No critical issues = empty `criticalIssues` array
- This is actually GOOD NEWS - it means your agent is wired correctly!

### Unhealthy Wiring (Should Have Content)
If there are wiring problems, you should see:
```json
{
  "_format": "WIRING_DIAGNOSTIC_PATCH_V1",
  "companyId": "...",
  "effectiveConfigVersion": "...",
  "generatedAt": "2026-01-16T...",
  "criticalIssues": [
    {
      "code": "NO_TEMPLATE_REFERENCES",
      "nodeId": "aiAgentSettings.templateReferences",
      "dbPath": "aiAgentSettings.templateReferences",
      "evidence": { "templateReferences": 0 },
      "currentValue": 0,
      "recommendedValue": null,
      "fix": "Link at least one template..."
    }
  ],
  "highIssues": [...],
  "mediumIssues": [...],
  "summary": {
    "totalIssues": 3,
    "critical": 1,
    "high": 1,
    "medium": 1
  }
}
```

## Comparison: 9f7d3d3 vs Current

### What Changed
Between commit `9f7d3d3` and now, these diagnostic rules were modified:

1. **ZERO_SCENARIOS_LOADED** - Now skips if `mode === 'BOOKING'`
2. **LLM_FALLBACK_NO_SCENARIOS** - Now skips if `mode === 'BOOKING'`

**Why?** Because in BOOKING mode, scenarios aren't needed - the booking script engine handles everything. This prevents false positives during booking tests.

### Impact
- If you're testing **Basic Call**, **Emergency**, **Frustrated**, **Joking**, **Question** scenarios → Full diagnostics
- If you're testing **Full Booking** → Scenario-related rules won't fire (by design)

## Solution Options

### Option 1: Test in Discovery Mode (Recommended)
Run a test using "Basic Call" or "Frustrated" scenario instead of "Full Booking". This will trigger all diagnostic rules and give you a full report.

### Option 2: Check Wiring Tab Directly
The Wiring tab in Control Plane has a comprehensive report that doesn't depend on test mode.

### Option 3: Add Debug Logging
I can add console logging to show you exactly what evidence was extracted and which rules were evaluated.

## Quick Fix: Enhanced Diagnostics

Would you like me to:
1. Add more detailed logging to show what's happening?
2. Add a "force full diagnostics" mode that checks everything regardless of mode?
3. Create a separate "Full Wiring Export" that includes ALL company config (not just issues)?

The key question is: **Is your wiring now healthy (good!) or is the diagnostic not detecting problems it should (bad)?**

To answer this, check the "Wiring" tab in your test console - does it show green "Wiring Healthy" or red issues?
