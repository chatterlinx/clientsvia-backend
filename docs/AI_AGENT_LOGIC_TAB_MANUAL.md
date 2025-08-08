# AI Agent Logic Tab - Complete Technical Manual
## 🎯 CHEAT SHEET FOR TROUBLESHOOTING & DEVELOPMENT

**Last Updated**: August 1, 2025  
**Version**: 2.0 (Production Ready)  
**Location**: `/public/company-profile.html` (AI Agent Logic Tab)

---

## 🗂️ FILE STRUCTURE

### Primary Files
- **Frontend UI**: `/public/company-profile.html` (Lines 1080-2400 approx)
- **JavaScript Logic**: Embedded in same file (Lines 4000-6200 approx)  
- **Backend Routes**: Multiple route files (see API section)
- **Configuration**: `/config/messageTemplates.json`, `/config/personnelConfig.json`

### Key Route Files
```
routes/
├── admin.js                           # Admin management endpoints
├── company/agentSettings.js            # Agent settings API
├── company/agentTesting.js             # Agent testing endpoints  
├── company/enhancedAgentSettings.js    # Enhanced settings
├── company/personality.js              # Personality configuration
├── company/agentPriorityConfig.js      # Priority flow settings
└── aiAgentHandler.js                   # Main agent runtime
```

---

## 🚀 API ENDPOINTS REFERENCE

### Core Configuration Endpoints

#### 1. **Save Complete AI Settings** (PRIMARY ENDPOINT)
```http
PUT /api/admin/{companyId}/ai-settings
Content-Type: application/json

{
  "answerPriority": ["companyKB", "tradeQA", "vector", "llmFallback"],
  "thresholds": {
    "companyKB": 0.7,
    "tradeQA": 0.6, 
    "vector": 0.5,
    "llmFallback": 0.4
  },
  "memory": {
    "mode": "conversational",
    "retentionMinutes": 30
  },
  "escalation": {
    "onNoMatch": true,
    "strategy": "ask-confirm"
  },
  "agentSettings": {
    "useLLM": true,
    "llmModel": "gemini-pro",
    "memoryMode": "short",
    "fallbackThreshold": 0.5,
    "escalationMode": "ask",
    "rePromptAfterTurns": 3,
    "maxPromptsPerCall": 2,
    "semanticSearchEnabled": true,
    "confidenceScoring": true,
    "autoLearningQueue": true
  },
  "modelConfig": {
    "primary": "gemini-pro",
    "fallback": "gpt-4o-mini",
    "allowed": ["gemini-pro", "gpt-4o-mini", "claude-3-haiku"]
  },
  "tradeCategories": ["HVAC Residential", "Plumbing Residential"],
  "rePromptAfterTurns": 3,
  "maxPromptsPerCall": 2,
  "lastUpdated": "2025-08-01T12:00:00.000Z"
}
```

#### 2. **Load AI Settings**
```http
GET /api/admin/{companyId}/ai-settings
```

#### 3. **Agent Testing** (PRODUCTION ENDPOINT)
```http
POST /api/agent/{companyId}/test
Content-Type: application/json

{
  "text": "What are your business hours?",
  "context": {
    "testMode": true,
    "source": "admin-panel"
  }
}
```

#### 4. **Legacy Agent Settings** (DEPRECATED - DO NOT USE)
```http
POST /api/agent/companies/{companyId}/agent-settings  # OLD ENDPOINT
GET /api/agent/companies/{companyId}/agent-settings   # OLD ENDPOINT
```

#### 5. **Personality Settings** (SEPARATE SYSTEM)
```http
POST /api/company/{companyId}/personality
Content-Type: application/json

{
  "personalitySettings": {
    "voiceTone": "professional",
    "speechPace": "normal", 
    "bargeIn": true,
    "acknowledgeEmotion": true,
    "useEmojis": false
  }
}
```

---

## 🧩 JAVASCRIPT FUNCTIONS REFERENCE

### Core Save/Load Functions

#### **saveClientsViaConfiguration()** - PRIMARY SAVE FUNCTION
- **Location**: Line ~5801
- **Purpose**: Saves complete AI Agent Logic configuration
- **Endpoint**: `PUT /api/admin/{companyId}/ai-settings`
- **Called By**: Main green "Save AI Settings" button
- **Collects**:
  - Priority flow order and settings
  - Knowledge source thresholds
  - Memory configuration
  - Agent settings (LLM, thresholds, etc.)
  - Trade categories from checkboxes
  - Escalation settings

#### **loadClientsViaConfiguration()** - PRIMARY LOAD FUNCTION  
- **Location**: Line ~6064
- **Purpose**: Loads existing configuration from backend
- **Endpoint**: `GET /api/admin/{companyId}/ai-settings`
- **Called By**: Page initialization
- **Applies**: Configuration to all UI elements

#### **runAgentTest()** - AGENT TESTING FUNCTION
- **Location**: Line ~5905  
- **Purpose**: Tests AI agent with actual runtime call
- **Endpoint**: `POST /api/agent/{companyId}/test`
- **Features**: Shows response and trace in testing console

### Supporting Functions

#### **saveClientsviaAgentPersonalitySettings()** 
- **Location**: Line ~5615
- **Purpose**: Saves personality-specific settings (separate system)
- **Endpoint**: `POST /api/company/{companyId}/personality`

#### **initClientsViaTabs()**
- **Location**: Line ~5681  
- **Purpose**: Initializes tab navigation for AI Agent Logic

#### **initClientsViaPriorityFlow()**
- **Location**: Line ~5706
- **Purpose**: Sets up drag-and-drop priority flow interface

#### **initClientsViaKnowledgeSources()**  
- **Location**: Line ~5773
- **Purpose**: Initializes threshold sliders and knowledge source UI

---

## 🎛️ UI COMPONENT MAPPING

### Tab Structure
```html
<!-- Main Container -->
<div class="clientsvia-intelligence-panel">
  
  <!-- Header with Timestamp -->
  <div class="bg-gradient-to-r from-indigo-900 to-purple-900">
    <!-- NO SAVE BUTTON HERE ANYMORE -->
  </div>
  
  <!-- Tab Navigation -->
  <div class="flex border-b border-gray-200">
    <button id="clientsvia-tab-priority">Answer Priority Flow</button>
    <button id="clientsvia-tab-knowledge">Knowledge Sources</button>  
    <button id="clientsvia-tab-testing">Agent Testing</button>
  </div>
  
  <!-- Tab Content Areas -->
  <div id="clientsvia-content-priority">
    <!-- Drag-and-drop priority items -->
  </div>
  
  <div id="clientsvia-content-knowledge">  
    <!-- Threshold sliders -->
    <input id="clientsvia-threshold-companyQnA">
    <input id="clientsvia-threshold-tradeQnA">
    <input id="clientsvia-threshold-vectorSearch"> 
    <input id="clientsvia-threshold-llmFallback">
  </div>
  
  <div id="clientsvia-content-testing">
    <!-- Agent testing console -->
    <input id="testMessage">
    <button id="testAgentBtn" onclick="runAgentTest()">
    <div id="agentResponse"></div>
    <div id="responseTrace"></div>
  </div>
</div>

<!-- SINGLE SAVE BUTTON (Bottom of page) -->
<button onclick="saveClientsViaConfiguration()">Save AI Settings</button>
```

### Key Form Elements

#### Priority Flow Elements
```javascript
// Priority items (draggable)
document.querySelectorAll('.clientsvia-priority-item')
// Each has: data-priority-type, .clientsvia-priority-toggle checkbox

// Maps to backend types:
'company-knowledge' → 'companyKB'
'trade-categories' → 'tradeQA'  
'template-intelligence' → 'templates'
'vector-search' → 'vector'
'llm-fallback' → 'llmFallback'
```

#### Knowledge Source Thresholds
```javascript
'clientsvia-threshold-companyQnA' → thresholds.companyKB
'clientsvia-threshold-tradeQnA' → thresholds.tradeQA
'clientsvia-threshold-vectorSearch' → thresholds.vector
'clientsvia-threshold-llmFallback' → thresholds.llmFallback
```

#### Agent Settings Elements  
```javascript
'agent-useLLM' → agentSettings.useLLM
'agent-llmModel' → agentSettings.llmModel
'agent-memoryMode' → agentSettings.memoryMode
'agent-fallbackThreshold' → agentSettings.fallbackThreshold
'agent-escalationMode' → agentSettings.escalationMode
'agent-rePromptAfterTurns' → agentSettings.rePromptAfterTurns
'agent-maxPromptsPerCall' → agentSettings.maxPromptsPerCall
'agent-semanticSearchEnabled' → agentSettings.semanticSearchEnabled
'agent-confidenceScoring' → agentSettings.confidenceScoring  
'agent-autoLearningQueue' → agentSettings.autoLearningQueue
```

#### Trade Categories
```javascript
// Trade category checkboxes
'#trade-categories-checkboxes input[type="checkbox"]:checked'
// Maps to: tradeCategories array
```

---

## 🐛 TROUBLESHOOTING GUIDE

### Common Issues & Solutions

#### 1. **Save Button Not Working**
**Symptoms**: Button click does nothing, no API call
**Check**:
- Verify button calls `saveClientsViaConfiguration()` not `saveAgentSettings()`
- Check browser console for JavaScript errors
- Verify `getCurrentCompanyId()` returns valid ID

#### 2. **401 Unauthorized Error on Save**
**Symptoms**: Save fails with 401 error
**Solutions**:
- Check user authentication status
- Verify admin permissions
- Check JWT token validity
- Ensure company ID belongs to authenticated user

#### 3. **Configuration Not Loading**
**Symptoms**: UI shows default values, not saved config
**Check**:
- Verify `loadClientsViaConfiguration()` is called on page load
- Check API endpoint returns 200 status
- Verify `applyConfigurationToUI()` function works
- Check browser console for load errors

#### 4. **Agent Testing Not Working**  
**Symptoms**: Test button shows "endpoint not available"
**Solutions**:
- Verify backend route `/api/agent/{companyId}/test` exists
- Check agent runtime system is operational
- Verify company has valid AI configuration
- Test with simple message first

#### 5. **Priority Flow Not Saving Order**
**Symptoms**: Drag-and-drop order resets after save/reload
**Check**:
- Verify drag handlers are properly bound
- Check `updateClientsViaPriorityNumbers()` updates order
- Ensure priority order is included in save payload
- Verify backend stores answerPriority array correctly

#### 6. **Threshold Values Reset**
**Symptoms**: Sliders reset to defaults after page reload
**Check**:
- Verify threshold IDs match between save/load functions
- Check `parseFloat()` conversion in save function
- Ensure backend stores threshold values as numbers
- Verify `applyConfigurationToUI()` sets slider values

---

## 🔍 DEBUGGING COMMANDS

### Browser Console Debug Commands
```javascript
// Get current company ID
getCurrentCompanyId()

// Test configuration save
saveClientsViaConfiguration()

// Test configuration load  
loadClientsViaConfiguration()

// Test agent
runAgentTest()

// Check form values
document.getElementById('clientsvia-threshold-companyQnA').value

// Check priority flow order
Array.from(document.querySelectorAll('.clientsvia-priority-item')).map(item => ({
  type: item.getAttribute('data-priority-type'),
  active: item.querySelector('.clientsvia-priority-toggle').checked
}))

// Check trade categories
Array.from(document.querySelectorAll('#trade-categories-checkboxes input[type="checkbox"]:checked')).map(cb => cb.value)
```

### Backend Debug Commands
```bash
# Check agent settings in database
db.companies.findOne({_id: ObjectId("companyId")}, {agentSettings: 1, agentIntelligenceSettings: 1})

# Test API endpoint
curl -X GET "http://localhost:3000/api/admin/COMPANY_ID/ai-settings" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Test agent runtime
curl -X POST "http://localhost:3000/api/agent/COMPANY_ID/test" \
  -H "Content-Type: application/json" \
  -d '{"text": "test message", "context": {"testMode": true}}'
```

---

## 📋 CONFIGURATION DATA STRUCTURE

### Frontend to Backend Mapping
```javascript
// Frontend collects this structure:
const clientsViaConfig = {
  // Priority flow (from drag-and-drop UI)
  answerPriority: ["companyKB", "tradeQA", "vector", "llmFallback"],
  
  // Thresholds (from sliders)  
  thresholds: {
    companyKB: 0.7,      // clientsvia-threshold-companyQnA
    tradeQA: 0.6,        // clientsvia-threshold-tradeQnA  
    vector: 0.5,         // clientsvia-threshold-vectorSearch
    llmFallback: 0.4     // clientsvia-threshold-llmFallback
  },
  
  // Memory settings
  memory: {
    mode: "conversational",          // clientsvia-memoryModeSelect
    retentionMinutes: 30             // clientsvia-contextRetentionSlider  
  },
  
  // Escalation (blueprint required)
  escalation: {
    onNoMatch: true,                 // clientsvia-escalateNoMatchToggle
    strategy: "ask-confirm"
  },
  
  // Model configuration (blueprint required)
  modelConfig: {
    primary: "gemini-pro",
    fallback: "gpt-4o-mini",
    allowed: ["gemini-pro", "gpt-4o-mini", "claude-3-haiku"]
  },
  
  // Trade categories (from checkboxes)
  tradeCategories: ["HVAC Residential", "Plumbing Residential"],
  
  // Agent settings (from form inputs)
  agentSettings: {
    useLLM: true,                    // agent-useLLM
    llmModel: "gemini-pro",          // agent-llmModel
    memoryMode: "short",             // agent-memoryMode
    fallbackThreshold: 0.5,          // agent-fallbackThreshold
    escalationMode: "ask",           // agent-escalationMode  
    rePromptAfterTurns: 3,           // agent-rePromptAfterTurns
    maxPromptsPerCall: 2,            // agent-maxPromptsPerCall
    semanticSearchEnabled: true,     // agent-semanticSearchEnabled
    confidenceScoring: true,         // agent-confidenceScoring
    autoLearningQueue: true          // agent-autoLearningQueue
  },
  
  // Override with agent settings
  rePromptAfterTurns: 3,             // agentSettings.rePromptAfterTurns
  maxPromptsPerCall: 2,              // agentSettings.maxPromptsPerCall
  
  // Metadata
  lastUpdated: "2025-08-01T12:00:00.000Z"
};
```

---

## ⚡ PERFORMANCE OPTIMIZATION

### Load Time Optimization
1. **Lazy Load Configuration**: Only load when AI Agent Logic tab is active
2. **Cache Configuration**: Store in sessionStorage to avoid repeated API calls
3. **Debounce Auto-Save**: Implement auto-save with debouncing for threshold sliders

### Memory Management  
1. **Cleanup Event Listeners**: Remove drag-and-drop listeners when tab inactive
2. **Limit Testing Console History**: Keep only last 10 test results
3. **Compress Configuration**: Minimize payload size for large configurations

---

## 🚀 DEPLOYMENT CHECKLIST

### Pre-Production Verification
- [ ] All API endpoints return proper status codes
- [ ] Save functionality works with all form combinations  
- [ ] Load functionality properly populates all UI elements
- [ ] Agent testing returns proper responses and traces
- [ ] Drag-and-drop priority flow functions correctly
- [ ] All threshold sliders save and load properly
- [ ] Trade category checkboxes save and load correctly
- [ ] Error handling shows proper user feedback
- [ ] No JavaScript console errors
- [ ] Mobile responsiveness works

### Backend Verification
- [ ] `/api/admin/{companyId}/ai-settings` endpoint operational (PUT/GET)
- [ ] `/api/agent/{companyId}/test` endpoint operational (POST)
- [ ] Database schema supports all configuration fields
- [ ] Authentication and authorization working properly
- [ ] Error logging captures configuration save/load issues

---

## 🔄 VERSION HISTORY

### Version 2.0 (August 1, 2025) - CURRENT
- ✅ Removed redundant save button from header
- ✅ Consolidated save functionality to single green button
- ✅ Enhanced `saveClientsViaConfiguration()` with comprehensive data collection
- ✅ Fixed API endpoint compliance (`/api/admin/{companyId}/ai-settings`)
- ✅ Added agent testing console with backend integration
- ✅ Implemented blueprint-compliant configuration structure
- ✅ Added AI-friendly landmarks and semantic structure

### Version 1.0 (Previous)  
- ❌ Had duplicate save buttons causing confusion
- ❌ Used deprecated `/api/agent/companies/{companyId}/agent-settings` endpoint
- ❌ Limited agent testing capabilities
- ❌ Non-compliant configuration structure

---

## 🎯 QUICK REFERENCE COMMANDS

### Essential Browser Console Commands
```javascript
// Quick config save test
saveClientsViaConfiguration().then(r => console.log('Save result:', r))

// Quick config load test  
loadClientsViaConfiguration().then(r => console.log('Load result:', r))

// Quick agent test
runAgentTest()

// Get all form values
const formData = {
  companyId: getCurrentCompanyId(),
  thresholds: {
    companyKB: parseFloat(document.getElementById('clientsvia-threshold-companyQnA').value),
    tradeQA: parseFloat(document.getElementById('clientsvia-threshold-tradeQnA').value),
    vector: parseFloat(document.getElementById('clientsvia-threshold-vectorSearch').value),
    llmFallback: parseFloat(document.getElementById('clientsvia-threshold-llmFallback').value)
  }
}
console.log('Current form data:', formData)
```

---

## 🆘 EMERGENCY FIXES

### If Save Button Completely Broken
1. Check if function exists: `typeof saveClientsViaConfiguration`
2. Check button onclick: `document.querySelector('[onclick*="saveClientsViaConfiguration"]')`
3. Manual save: Call function directly from console
4. Check for JavaScript errors in console
5. Verify company ID is available: `getCurrentCompanyId()`

### If Configuration Won't Load
1. Check API endpoint: Network tab in DevTools
2. Manual load: `loadClientsViaConfiguration()` in console  
3. Check authentication: Look for 401/403 errors
4. Verify company exists in database
5. Check for malformed configuration data

### If Agent Testing Fails
1. Check backend agent runtime status
2. Verify test endpoint exists: `/api/agent/{companyId}/test`
3. Test with minimal message: "hello"
4. Check company has valid AI configuration
5. Verify agent runtime dependencies (LLM APIs, etc.)

---

*END OF MANUAL - Keep this document updated with any changes to the AI Agent Logic tab*
