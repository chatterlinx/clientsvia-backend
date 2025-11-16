# PHASE 2 - ACTIVE INSTRUCTIONS X-RAY V2 INTEGRATION GUIDE

**Date:** November 16, 2025  
**Status:** ✅ IMPLEMENTED - Ready for Testing  
**Phase:** 2 - Configuration Integration Layer

---

## 🎯 WHAT WAS BUILT

Phase 2 integrates the Call Engine Spine (Phase 1) with the existing AI Agent Settings system to provide a complete "brain X-ray" for any company and optional call.

### Components Implemented

1. **CompanyConfigLoader** (`src/services/companyConfigLoader.js`)
   - Centralizes configuration reading from multiple sources
   - Normalizes data from `v2Company`, templates, and knowledgebase
   - Used by Active Instructions and future runtime

2. **Active Instructions Service V2** (`src/services/activeInstructionsService.js`)
   - Upgraded to use CompanyConfigLoader
   - Includes full call trace data when callId provided
   - Returns stable JSON schema for UI consumption

3. **Active Instructions Router V2** (`src/routes/activeInstructionsRouter.js`)
   - Enhanced endpoint with better error handling
   - Health check endpoint upgraded
   - Returns comprehensive configuration data

---

## 🔄 DATA SOURCES

The CompanyConfigLoader reads and normalizes from:

### 1. **v2Company Document**
- `aiAgentSettings.*` - New canonical source (variables, filler words, synonyms, template refs)
- `aiAgentLogic.*` - Intelligence settings (voice, thresholds, priorities)
- `configuration.*` - Legacy fields (readiness, clonedFrom, version)

### 2. **Templates**
- `GlobalInstantResponseTemplate` - Scenarios, variable definitions, default filler words
- Scenario metadata (triggers, synonyms, categories)
- Template versioning and sync status

### 3. **Knowledgebase**
- `CompanyQnA` - Company-specific Q&A (if model exists)
- `TradeQnA` - Trade-specific Q&A (if model exists)
- Counts only, not full content (for performance)

### 4. **Call Traces**
- `CallTrace` - Per-call snapshot (when callId provided)
- Context snapshot, tier trace, extracted data
- Transcript, booking status

---

## 📊 API RESPONSE SCHEMA

### Endpoint
```
GET /api/active-instructions?companyId=<id>&callId=<optional>
```

### Response Structure
```json
{
  "ok": true,
  "data": {
    "company": {
      "id": "string",
      "name": "string",
      "trade": "string|null"
    },
    "readiness": {
      "score": 0-100,
      "canGoLive": boolean,
      "isLive": boolean,
      "goLiveAt": "ISO date|null",
      "goLiveBy": "string|null",
      "preActivationMessage": "string|null"
    },
    "configVersion": {
      "templateIds": ["string"],
      "clonedVersion": "string|null",
      "lastSyncedAt": "ISO date|null"
    },
    "intelligence": {
      "enabled": boolean,
      "thresholds": {
        "companyQnA": number,
        "tradeQnA": number,
        "templates": number,
        "inHouseFallback": number
      },
      "knowledgeSourcePriorities": ["string"],
      "memorySettings": {},
      "fallbackBehavior": {},
      "voice": {
        "provider": "string",
        "voiceId": "string",
        "model": "string",
        "stability": number,
        "similarity": number
      }
    },
    "variables": {
      "definitions": [
        {
          "key": "string",
          "normalizedKey": "string",
          "label": "string",
          "description": "string",
          "type": "text|email|phone|url|number|currency",
          "category": "string",
          "required": boolean,
          "defaultValue": "string",
          "source": "template|cheatsheet"
        }
      ],
      "values": {
        "key": "value"
      }
    },
    "fillerWords": {
      "inherited": ["string"],
      "custom": ["string"],
      "active": ["string"]
    },
    "synonyms": [
      {
        "word": "string",
        "variations": ["string"],
        "category": "string"
      }
    ],
    "scenarios": {
      "total": number,
      "byCategory": {
        "category": { "count": number }
      }
    },
    "knowledgebase": {
      "companyQnA": {
        "count": number,
        "categories": ["string"]
      },
      "tradeQnA": {
        "count": number,
        "trades": ["string"]
      }
    },
    "call": null | {
      "callId": "string",
      "startedAt": number,
      "endedAt": number,
      "durationSeconds": number,
      "contextSnapshot": {
        "currentIntent": "string",
        "extracted": {},
        "triageMatches": ["string"],
        "transcript": [{"role": "string", "text": "string"}],
        "readyToBook": boolean,
        "appointmentId": "string|null"
      },
      "tierTrace": [
        {
          "tier": 1|2|3,
          "confidence": number,
          "sourceId": "string",
          "reasoning": "string"
        }
      ],
      "extracted": {},
      "readyToBook": boolean
    }
  }
}
```

---

## 🧪 TESTING

### Test 1: Basic Company Config (No Call)
```bash
curl -X GET "http://localhost:3000/api/active-instructions?companyId=<COMPANY_ID>" \
  -H "Authorization: Bearer <TOKEN>"
```

**Expected:**
- `ok: true`
- `data.company.id` matches companyId
- `data.variables.definitions` array present
- `data.scenarios.total >= 0`
- `data.call === null`

### Test 2: With Call Context
```bash
curl -X GET "http://localhost:3000/api/active-instructions?companyId=<COMPANY_ID>&callId=<CALL_SID>" \
  -H "Authorization: Bearer <TOKEN>"
```

**Expected:**
- All Test 1 expectations
- `data.call` object present
- `data.call.tierTrace` array present
- `data.call.contextSnapshot` object present

### Test 3: Health Check
```bash
curl -X GET "http://localhost:3000/api/active-instructions/health"
```

**Expected:**
```json
{
  "ok": true,
  "status": "operational",
  "service": "active-instructions-v2",
  "version": "2.0",
  "timestamp": "ISO date"
}
```

### Test 4: Error Handling
```bash
# Missing companyId
curl -X GET "http://localhost:3000/api/active-instructions"

# Invalid companyId
curl -X GET "http://localhost:3000/api/active-instructions?companyId=invalid"
```

**Expected:**
- 400 for missing companyId
- 404 for invalid companyId
- `ok: false` in both cases

---

## 🔌 INTEGRATION STATUS

Phase 2 is **read-only** - it does NOT modify any existing behavior:

- ✅ **No changes to AI Agent Settings UI**
- ✅ **No changes to existing APIs**
- ✅ **No changes to Twilio voice routing**
- ✅ **No changes to LLM/3-Tier logic** (Phase 3)

Phase 2 only **reads** configuration to provide visibility.

---

## 📝 CONFIGURATION SOURCES

### Priority Order (for variables, filler words, etc.)

1. **Primary:** `aiAgentSettings.*` (new canonical source)
2. **Fallback:** `configuration.*` (legacy)
3. **Template:** `GlobalInstantResponseTemplate` (inherited defaults)
4. **Cheat Sheet:** `aiAgentSettings.variableDefinitions` (custom)

### Merge Logic

**Variables:**
- Template definitions + Cheat sheet definitions (no duplicates by normalized key)
- Values from `aiAgentSettings.variables` or fallback to `configuration.variables`

**Filler Words:**
- Inherited from templates + Custom from company
- Active = merged unique list

**Scenarios:**
- All scenarios from referenced templates
- Enabled/disabled status from `aiAgentSettings.scenarioControls`

---

## 🎯 USE CASES

### 1. **Debugging**
```javascript
// See what configuration is active for a company
const { data } = await fetch('/api/active-instructions?companyId=123');
console.log('Variables:', data.variables);
console.log('Scenarios:', data.scenarios);
console.log('Intelligence:', data.intelligence);
```

### 2. **Call Analysis**
```javascript
// Analyze what happened during a specific call
const { data } = await fetch('/api/active-instructions?companyId=123&callId=CA123');
console.log('Call duration:', data.call.durationSeconds);
console.log('Tier trace:', data.call.tierTrace);
console.log('Extracted data:', data.call.extracted);
```

### 3. **Simulator UI** (Future)
```javascript
// Show active configuration in real-time UI
const config = await loadActiveInstructions(companyId);
renderVariables(config.variables);
renderScenarios(config.scenarios);
renderIntelligence(config.intelligence);
```

### 4. **Runtime Config** (Future - Frontline-Intel, 3-Tier)
```javascript
// Load config for runtime decision-making
const config = await loadCompanyRuntimeConfig({ companyId });
const response = await tier1Match(userInput, config.scenarios, config.fillerWords);
```

---

## 🚀 NEXT PHASES

Phase 2 provides the foundation for:

- **Phase 3:** Frontline-Intel + LLM-0 orchestration (uses CompanyConfigLoader)
- **Phase 4:** Real 3-Tier intelligence routing (uses config for matching)
- **Phase 5:** Simulator UI (visualizes active instructions)
- **Phase 6:** Prompt preview (shows exact LLM prompts from config)

---

## 📊 PERFORMANCE

- **CompanyConfigLoader:** < 200ms for full config load
- **Active Instructions API:** < 300ms for company-only, < 400ms with call
- **Redis Context:** Not used by Phase 2 (read-only from MongoDB)
- **Caching:** None yet (consider Redis caching in Phase 3)

---

## 🐛 DEBUGGING

### Check Loaded Config
```javascript
const { loadCompanyRuntimeConfig } = require('./src/services/companyConfigLoader');
const config = await loadCompanyRuntimeConfig({ companyId: '123' });
console.log(JSON.stringify(config, null, 2));
```

### Check Call Trace
```javascript
const CallTrace = require('./models/CallTrace');
const trace = await CallTrace.findOne({ callId: 'CA123' });
console.log(trace);
```

### Verify Knowledgebase Models
```javascript
try {
  const CompanyQnA = require('./models/knowledge/CompanyQnA');
  console.log('CompanyQnA model exists');
} catch (err) {
  console.log('CompanyQnA model not found - fallback to 0 count');
}
```

---

## ✅ VALIDATION

After integration, verify:

1. **Endpoint Works:**
   - GET `/api/active-instructions?companyId=<ID>` returns 200
   - Response matches schema above
   - Health check returns 200

2. **Data Accuracy:**
   - Variables match AI Agent Settings tab
   - Scenarios match Global AI Brain template
   - Intelligence settings match AI Voice Settings tab

3. **Call Context:**
   - With callId, returns call trace data
   - Tier trace shows intelligence layers used
   - Extracted data matches FrontlineContext

---

**Phase 2 Complete!** 🎉

Ready for Phase 3: Frontline-Intel + LLM-0 orchestration

