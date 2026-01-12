# 📊 VARIABLES TAB - COMPLETE ARCHITECTURE & TROUBLESHOOTING GUIDE
**Date:** October 19, 2025  
**Status:** ✅ Production-Ready  
**Version:** 6.1

---

## 🎯 OVERVIEW

The **Variables Tab** is an enterprise-grade, auto-scanning system that detects `{placeholders}` from Global AI Brain templates and manages company-specific variable values. It features real-time background scanning with comprehensive health monitoring.

### **Purpose**
- Automatically detect all `{variables}` from active templates
- Provide clean UI for admins to fill in company-specific values
- Track usage (how many times each variable appears in scenarios)
- Run scans in background - works even when admin closes the page
- Display real-time progress during scans

### **Key Features**
- ✅ **Auto-Background Scanning** - Triggers automatically when template activated
- ✅ **Real-Time Progress** - Live progress bar with polling (every 2 seconds)
- ✅ **Smart Deduplication** - `{companyName}` appears 147 times → added once with usage count
- ✅ **Health Dashboard** - Shows last scan time, completion %, system status
- ✅ **Comprehensive Checkpoints** - 23+ checkpoints for debugging
- ✅ **Event-Driven Architecture** - Industry best practice (Stripe, AWS pattern)

---

## 🏗️ ARCHITECTURE

### **Tab Structure**

```
┌─────────────────────────────────────────────────────────────────┐
│ VARIABLES TAB                                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ TAB 1: Scan & Status                                            │
│  ├── Health Check Card (🟢 HEALTHY / 🟡 NEEDS ATTENTION)       │
│  ├── Force Scan Button                                          │
│  ├── Real-Time Progress Bar (if scanning)                       │
│  ├── Last Scan Result (what was found)                          │
│  ├── Category Breakdown (Company Info: 8/10 filled)             │
│  └── Alerts (missing required variables)                        │
│                                                                  │
│ TAB 2: Variables                                                │
│  ├── Clean Table (one row per unique variable)                  │
│  ├── Columns: Variable | Category | Value | Matches | Status   │
│  ├── Inline Editing (click to edit, auto-save)                  │
│  └── Save All Button                                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔄 DATA FLOW

### **1. Template Activation (Automatic Trigger)**

```
User clicks "Activate" on AiCore Templates tab
     ↓
POST /api/company/:companyId/configuration/templates
     ↓
Template saves to company.aiAgentSettings.templateReferences
     ↓
setImmediate(() => BackgroundVariableScanService.scanTemplateForCompany())
     ↓
🔍 Background Scan Starts (non-blocking, continues even if user closes page)
```

### **2. Background Scan Process**

```
1. Mark company as scanning (isScanning: true)
2. Load template from Global AI Brain (MongoDB)
3. Loop through all scenarios (47 total)
   ├── Extract {variables} from triggers and replies
   ├── Track occurrences: {companyName} => 147
   ├── Update progress every 10 scenarios
4. Deduplicate: 147 occurrences → 1 variable definition
5. Merge with existing variables (preserve user values!)
6. Save to MongoDB:
   ├── variableDefinitions (metadata)
   ├── variables (user values)
   ├── scanStatus (progress, history)
7. Clear Redis cache
8. Mark scanning complete (isScanning: false)
```

### **3. Real-Time Progress (Frontend)**

```
User opens Variables tab
     ↓
VariablesManager.load()
     ↓
Check if scanStatus.isScanning === true
     ↓
If YES: Start polling (every 2 seconds)
     ↓
Poll: GET /api/company/:companyId/configuration/variables/scan-status
     ↓
Update UI: Progress bar, text ("Scanning... 25/47 scenarios")
     ↓
When scan complete: Stop polling, reload data
     ↓
Variables table auto-populates with new variables
```

---

## 📂 FILE STRUCTURE

### **Frontend**

```
public/js/ai-agent-settings/VariablesManager.js (v6.1)
├── constructor()                 - Initialize, set up polling
├── load()                        - Load variables from API, start polling if scanning
├── startPolling()                - Start 2-second interval for scan status
├── stopPolling()                 - Clear interval
├── checkScanStatus()             - Poll scan-status endpoint
├── updateScanProgress()          - Update progress bar UI
├── render()                      - Main render (tabs)
├── renderScanStatus()            - TAB 1: Health dashboard
├── renderVariablesTable()        - TAB 2: Variables table
├── forceScan()                   - Manual scan trigger
├── saveAll()                     - Save all variable values
└── clearCache()                  - Clear Redis cache
```

### **Backend**

```
services/BackgroundVariableScanService.js
├── scanTemplateForCompany()      - Scan single template for company
├── scanAllTemplatesForCompany()  - Scan all active templates
├── categorizeVariable()          - Assign category (Company Info, Pricing, etc.)
├── isRequired()                  - Check if variable is required
├── inferType()                   - Infer type (email, phone, text, etc.)
└── getExample()                  - Generate example value

routes/company/v2companyConfiguration.js
├── POST   /configuration/templates              - Activate template (triggers auto-scan)
├── POST   /configuration/variables/scan         - Force scan all templates
├── GET    /configuration/variables/scan-status  - Get scan progress
├── GET    /configuration/variables              - Load variables
└── PATCH  /configuration/variables              - Save variables
```

### **Data Models**

```javascript
// MongoDB Schema (in Company model)
aiAgentSettings: {
  templateReferences: [
    { templateId, enabled, priority, clonedAt }
  ],
  
  variableDefinitions: [
    {
      key: "companyName",              // Variable name (without {})
      label: "Company Name",           // Human-readable
      category: "Company Info",        // Auto-categorized
      usageCount: 147,                 // How many times it appears
      required: true,                  // Is it required?
      type: "text",                    // email, phone, text, etc.
      example: "e.g., Atlas AC",       // Placeholder example
      source: "HVAC Master Template"   // Which template it came from
    }
  ],
  
  variables: {
    companyName: "Atlas Air Conditioning",  // User-filled values
    phoneNumber: "(239) 555-0100",
    // ...
  },
  
  variableScanStatus: {
    isScanning: false,
    lastScan: Date,
    scanProgress: {
      current: 25,                     // Current scenario
      total: 47,                       // Total scenarios
      currentTemplate: "HVAC Master"   // Template being scanned
    },
    scanHistory: [
      {
        timestamp: Date,
        templateId: "...",
        templateName: "HVAC Master Template",
        scenariosScanned: 47,
        totalScenarios: 47,
        variablesFound: 15,
        newVariables: 3,
        details: [
          { variable: "companyName", occurrences: 147, addedToTable: true }
        ]
      }
    ]
  }
}
```

---

## 🔍 CHECKPOINTS & DEBUGGING

### **Backend Checkpoints (17 Total)**

```
🔍 [BG SCAN] Checkpoint 1:  Starting scan for company/template
✅ [BG SCAN] Checkpoint 2:  Marking company as scanning
✅ [BG SCAN] Checkpoint 3:  Company marked as scanning
🔍 [BG SCAN] Checkpoint 4:  Loading template from Global AI Brain
✅ [BG SCAN] Checkpoint 5:  Template loaded: [name]
📊 [BG SCAN] Checkpoint 6:  Template has [X] scenarios
🔍 [BG SCAN] Checkpoint 7:  Starting scenario scan
✅ [BG SCAN] Progress:      10/47, 20/47, 30/47... (every 10 scenarios)
✅ [BG SCAN] Checkpoint 8:  Scenario scan complete - Found [X] unique variables
🔍 [BG SCAN] Checkpoint 9:  Building variable definitions
✅ [BG SCAN] Checkpoint 10: Variable definitions built
🔍 [BG SCAN] Checkpoint 11: Merging with existing variables
✅ [BG SCAN] Checkpoint 12: Merge complete - [X] new variables added
🔍 [BG SCAN] Checkpoint 13: Saving to MongoDB
✅ [BG SCAN] Checkpoint 14: Saved to MongoDB
🔍 [BG SCAN] Checkpoint 15: Clearing Redis cache
✅ [BG SCAN] Checkpoint 16: Cache cleared
✅ [BG SCAN] Checkpoint 17: SCAN COMPLETE!
```

### **Frontend Checkpoints (6+ Total)**

```
💼 [VARIABLES] Checkpoint 1:  Constructor called
✅ [VARIABLES] Checkpoint 2:  Initialized for company
💼 [VARIABLES] Checkpoint 3:  Loading variables
✅ [VARIABLES] Checkpoint 10: Load complete
📡 [VARIABLES] Checkpoint 11: Scan in progress detected - starting poll

📡 [POLL] Checkpoint 1:       Starting real-time polling
✅ [POLL] Checkpoint 2:       Polling started (every 2 seconds)
📡 [POLL] Checkpoint 4:       Checking scan status
📡 [POLL] Checkpoint 5:       Status received - [progress data]
✅ [POLL] Checkpoint 6:       Scan complete - stopping poll

🔘 [SCAN] Checkpoint 22:      Force Scan button clicked
🔘 [SCAN] Checkpoint 24:      Calling API POST /variables/scan
✅ [SCAN] Checkpoint 28:      Scan complete
```

---

## 🐛 TROUBLESHOOTING

### **Problem: Variables not showing after template activation**

**Symptoms:**
- Template activated successfully
- Variables tab shows "No Variables Yet"
- No scan progress visible

**Diagnosis:**
1. Check backend logs for `[BG SCAN]` checkpoints
2. Look for error messages between Checkpoint 1-17
3. Check MongoDB: `db.companiesCollection.findOne({_id: ObjectId("...")}).aiAgentSettings.variableScanStatus`

**Common Causes:**
- ❌ Template has no `instantResponses` array
- ❌ Scenarios have no `{variables}` in triggers/replies
- ❌ MongoDB connection lost during scan
- ❌ Redis unavailable (cache clear fails, but scan completes)

**Solution:**
```javascript
// Force manual scan
POST /api/company/:companyId/configuration/variables/scan

// Check logs for which checkpoint failed
// Fix root cause (template data, DB connection, etc.)
```

---

### **Problem: Progress bar not updating**

**Symptoms:**
- Scan starts but progress bar stays at 0%
- No real-time updates visible

**Diagnosis:**
1. Open browser console
2. Look for `[POLL]` checkpoints
3. Check if polling started: `[POLL] Checkpoint 1: Starting...`
4. Check network tab for `/scan-status` API calls (every 2 seconds)

**Common Causes:**
- ❌ Frontend polling not started (check `scanStatus.isScanning`)
- ❌ API endpoint `/scan-status` returning 404/500
- ❌ MongoDB not updating `scanProgress.current` during scan

**Solution:**
```javascript
// In browser console:
variablesManager.startPolling();  // Manually start polling

// Check if scan is actually running:
fetch('/api/company/YOUR_ID/configuration/variables/scan-status', {
  headers: { 'Authorization': 'Bearer ' + localStorage.getItem('adminToken') }
}).then(r => r.json()).then(console.log);
```

---

### **Problem: Duplicate variables in table**

**Symptoms:**
- `{companyName}` appears multiple times in table
- Each row shows different usage counts

**Diagnosis:**
- This should NEVER happen due to deduplication logic
- If it does, it's a critical bug in `BackgroundVariableScanService.js`

**Solution:**
```javascript
// Check merge logic in BackgroundVariableScanService.js
// Line ~220: existingDefs.findIndex(d => d.key === newDef.key)

// Manual fix: Remove duplicates in MongoDB
db.companiesCollection.updateOne(
  { _id: ObjectId("...") },
  {
    $set: {
      "aiAgentSettings.variableDefinitions": [
        // Manually deduplicated array
      ]
    }
  }
);
```

---

### **Problem: Scan stuck at X/Y scenarios**

**Symptoms:**
- Progress shows "Scanning... 25/47 scenarios (53%)"
- Progress doesn't increase for 5+ minutes
- `isScanning` stays `true` forever

**Diagnosis:**
1. Check backend logs for errors between Checkpoint 7-8
2. Look for unhandled exceptions in scenario loop
3. Check if MongoDB write failed

**Common Causes:**
- ❌ Infinite loop in scenario processing
- ❌ Memory leak (too many scenarios)
- ❌ MongoDB connection timeout
- ❌ Unhandled exception in variable extraction regex

**Solution:**
```javascript
// Force reset scan status
db.companiesCollection.updateOne(
  { _id: ObjectId("...") },
  {
    $set: {
      "aiAgentSettings.variableScanStatus.isScanning": false,
      "aiAgentSettings.variableScanStatus.scanProgress.current": 0
    }
  }
);

// Retry scan
POST /api/company/:companyId/configuration/variables/scan
```

---

### **Problem: Variables lost after new scan**

**Symptoms:**
- User fills in variables
- New template activated → Scan runs
- User values disappear

**Diagnosis:**
- This should NEVER happen due to merge logic
- Check Checkpoint 11-12 logs: "Merging with existing variables"

**Common Causes:**
- ❌ Merge logic not preserving `variables` map
- ❌ `variables` field overwritten instead of merged

**Solution:**
```javascript
// Check BackgroundVariableScanService.js line ~240
// Merge logic should ONLY update variableDefinitions, NOT variables

// Recovery: Restore from scan history
const lastScan = company.aiAgentSettings.variableScanStatus.scanHistory[0];
// Check lastScan.details for what was detected
// Manually restore user values from backup
```

---

### **Problem: Polling won't stop**

**Symptoms:**
- Scan complete but polling continues forever
- Network tab shows `/scan-status` calls every 2 seconds indefinitely

**Diagnosis:**
1. Check if `stopPolling()` was called
2. Check if `this.pollInterval` was cleared
3. Look for `[POLL] Checkpoint 3: Stopping poll` in console

**Common Causes:**
- ❌ `scanStatus.isScanning` never set to `false`
- ❌ `pollInterval` reference lost (multiple instances of VariablesManager)
- ❌ Error in `checkScanStatus()` prevents stopping

**Solution:**
```javascript
// In browser console:
variablesManager.stopPolling();

// Or force clear:
if (variablesManager.pollInterval) {
  clearInterval(variablesManager.pollInterval);
  variablesManager.pollInterval = null;
}
```

---

## 🧪 TESTING CHECKLIST

### **Smoke Test (5 minutes)**

1. ✅ **Activate Template**
   - Go to AiCore Templates tab
   - Click "Activate" on any template
   - Backend logs show: `[TEMPLATE ACTIVATED] Triggering background scan`

2. ✅ **Watch Real-Time Progress**
   - Switch to Variables tab immediately
   - See progress bar: "Scanning... 10/47 scenarios"
   - Progress updates every 2 seconds

3. ✅ **Verify Completion**
   - Wait for scan to complete (~10-30 seconds depending on template size)
   - Variables table auto-populates
   - Usage counts visible (e.g., "147 matches")

4. ✅ **Edit & Save**
   - Click on any variable value field
   - Type new value
   - Click "Save All Changes"
   - Success message appears

5. ✅ **Verify Persistence**
   - Refresh page
   - Variables tab still shows saved values
   - Usage counts still correct

### **Full Test Suite (30 minutes)**

```bash
# Backend Tests
npm test -- BackgroundVariableScanService.test.js

# Test Cases:
- ✅ Scan single template (47 scenarios)
- ✅ Scan multiple templates (merge correctly)
- ✅ Deduplicate variables (147 occurrences → 1 row)
- ✅ Preserve existing values (don't overwrite)
- ✅ Categorize correctly (Company Info, Pricing, etc.)
- ✅ Handle empty templates (no scenarios)
- ✅ Handle templates with no variables
- ✅ Clear Redis cache after scan
- ✅ Update scan history (keep last 10)

# Frontend Tests (Manual)
- ✅ Real-time polling starts when scan detected
- ✅ Progress bar updates smoothly
- ✅ Polling stops when scan complete
- ✅ Table renders correctly (one row per variable)
- ✅ Inline editing works
- ✅ Save All saves all changes
- ✅ Force Scan button triggers scan
- ✅ Health card shows correct status
```

---

## 📊 MONITORING & METRICS

### **Key Metrics to Track**

```javascript
// Scan Performance
- Average scan time per template: < 30 seconds (for 50 scenarios)
- Scan success rate: > 99%
- Background scan completion: 100% (even if page closed)

// User Experience
- Variables auto-populate: < 5 seconds after template activation
- Progress bar update latency: < 2 seconds
- Table render time: < 1 second (for 50 variables)

// System Health
- Redis cache clear rate: 100%
- MongoDB write success: > 99.9%
- Polling overhead: < 5% CPU
```

### **Log Monitoring**

```bash
# Watch for scan activity
tail -f logs/app.log | grep "BG SCAN"

# Check for errors
tail -f logs/app.log | grep "❌"

# Monitor polling
tail -f logs/app.log | grep "POLL"
```

---

## 🔧 MAINTENANCE

### **Regular Tasks**

**Weekly:**
- Check scan history for failed scans
- Review error logs for patterns
- Monitor scan times (should be < 30 seconds)

**Monthly:**
- Clean up old scan history (keep last 10 per company)
- Review variable usage counts (identify unused variables)
- Audit variable categories (recategorize if needed)

**Quarterly:**
- Review deduplication logic (ensure no duplicates slipping through)
- Performance audit (scan times, polling overhead)
- User feedback review (UX improvements)

### **Database Maintenance**

```javascript
// Clean up orphaned variable definitions (no template source)
db.companiesCollection.updateMany(
  { "aiAgentSettings.variableDefinitions.source": { $exists: false } },
  { $pull: { "aiAgentSettings.variableDefinitions": { source: { $exists: false } } } }
);

// Rebuild usage counts (if suspected incorrect)
// Trigger full rescan for company:
POST /api/company/:companyId/configuration/variables/scan
```

---

## 🚀 FUTURE ENHANCEMENTS

### **Planned Features**

1. **Variable Templates** (Phase 2)
   - Pre-filled value sets for common businesses
   - "HVAC Standard" template: companyName, serviceCall, etc.

2. **Bulk Import/Export** (Phase 3)
   - CSV import for 50+ variables at once
   - Export for backup/migration

3. **Variable Suggestions** (Phase 4)
   - AI-powered value suggestions based on company profile
   - "Looks like you're an HVAC company - suggest values?"

4. **Advanced Analytics** (Phase 4)
   - Variable usage heatmap
   - Impact analysis: "Changing {companyName} affects 523 scenarios"
   - Template comparison: "HVAC vs Plumbing variable differences"

---

## 📞 EMERGENCY CONTACTS

**If Variables Tab is completely broken:**

1. Check this doc first (troubleshooting section)
2. Review backend logs: `tail -f logs/app.log | grep "BG SCAN"`
3. Check frontend console for `[VARIABLES]` checkpoints
4. If still stuck: File issue with:
   - Company ID
   - Template ID (if known)
   - Full console logs
   - Backend checkpoint logs
   - Expected vs actual behavior

---

## 📚 RELATED DOCUMENTATION

- `AICORE-TEMPLATES-ARCHITECTURE.md` - Template activation flow
- `MULTI-TENANT-ARCHITECTURE.md` - Company isolation & caching
- `AI-AGENT-SETTINGS-ARCHITECTURE.md` - Overall tab structure

---

**END OF DOCUMENTATION**

**Last Updated:** October 19, 2025  
**Maintainer:** AI Agent  
**Version:** 6.1 (Production-Ready)

