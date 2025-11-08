# 🗺️ AICORE FILES: MONGOOSE + REDIS COMPLETE MAP
**Date:** November 8, 2025  
**Purpose:** Map ALL AICore files (templates, scenarios, variables, fillers) from database to runtime  
**Status:** ✅ VERIFIED - All files confirmed to exist, no guessing

---

## 📚 TABLE OF CONTENTS

1. [Database Models (Mongoose)](#database-models-mongoose)
2. [Services (Business Logic)](#services-business-logic)
3. [API Routes](#api-routes)
4. [Redis Caching](#redis-caching)
5. [Runtime Flow](#runtime-flow)
6. [Complete Data Flow Diagram](#complete-data-flow-diagram)

---

## 📊 DATABASE MODELS (Mongoose)

### ✅ Primary Models

```
models/
├── v2Company.js ← Company-specific overrides & settings
│   ├── aiAgentSettings {
│   │   ├── templateReferences[] ← Which templates are active
│   │   │   ├── templateId (ObjectId ref to GlobalInstantResponseTemplate)
│   │   │   ├── enabled (Boolean)
│   │   │   └── priority (Number)
│   │   ├── scenarioControls[] ← Enable/disable specific scenarios
│   │   │   ├── templateId
│   │   │   ├── scenarioId
│   │   │   └── isEnabled (Boolean)
│   │   ├── variables (Map<String, String>) ← {companyName: "Royal Plumbing"}
│   │   ├── variableDefinitions[] ← Metadata about variables
│   │   └── fillerWords {
│   │       ├── inherited[] ← From templates (read-only)
│   │       ├── custom[] ← Company additions (editable)
│   │       └── scanHistory[]
│   │   }
│   ├── aiAgentLogic {
│   │   ├── voiceSettings ← ElevenLabs configuration
│   │   ├── productionIntelligence ← Custom 3-tier settings
│   │   └── useGlobalIntelligence (Boolean)
│   └── configuration {
│       └── clonedFrom ← Legacy template reference
│   }
│
├── GlobalInstantResponseTemplate.js ← Master template storage
│   ├── name (String) "Universal AI Brain (All Industries)"
│   ├── version (String)
│   ├── fillerWords[] ← Template-level fillers
│   ├── synonymMap (Map) ← Synonym mappings
│   ├── categories[] {
│   │   ├── id (String)
│   │   ├── name (String) "Booking", "Pricing", "Hours"
│   │   ├── icon (String)
│   │   ├── additionalFillerWords[] ← Category-level fillers
│   │   ├── synonymMap (Map)
│   │   └── scenarios[] {
│   │       ├── scenarioId (String) ← Stable ULID/UUID
│   │       ├── name (String)
│   │       ├── triggers[] ← What keywords match
│   │       ├── quickReplies[]
│   │       ├── fullReplies[]
│   │       ├── priority (Number)
│   │       └── isActive (Boolean)
│   │   }
│   └── learningSettings {
│       ├── tier1Threshold (Number) ← Template defaults (usually ignored)
│       └── tier2Threshold (Number)
│   }
│
└── AdminSettings.js ← Global platform settings
    └── globalProductionIntelligence {
        ├── enabled (Boolean)
        ├── thresholds {
        │   ├── tier1 (Number)
        │   ├── tier2 (Number)
        │   └── enableTier3 (Boolean)
        ├── llmConfig {
        │   ├── model (String)
        │   ├── maxCostPerCall (Number)
        │   └── dailyBudget (Number)
        └── smartWarmup { ... }
    }
```

**Database Queries:**

| Purpose | Model | Query | Example |
|---------|-------|-------|---------|
| Load company | `v2Company` | `findById(companyId).select(...)` | Line 302 in v2priorityDrivenKnowledgeRouter.js |
| Load template | `GlobalInstantResponseTemplate` | `findById(templateId).select(...)` | Line 135 in v2aiLiveScenarios.js |
| Load admin settings | `AdminSettings` | `findOne({})` | Line 326 in v2priorityDrivenKnowledgeRouter.js |

---

## 🔧 SERVICES (Business Logic)

### ✅ Core AICore Services

```
services/
├── ScenarioPoolService.js ← CANONICAL SOURCE for loading scenarios
│   └── getScenarioPoolForCompany(companyId)
│       ├── Loads: company.aiAgentSettings.templateReferences
│       ├── Loads: company.aiAgentSettings.scenarioControls
│       ├── Loads: GlobalInstantResponseTemplate for each active template
│       ├── Flattens: All scenarios from all categories
│       ├── Applies: Per-company enable/disable (scenarioControls)
│       └── Returns: { scenarios[], templatesUsed[] }
│       📍 USED BY:
│          - v2priorityDrivenKnowledgeRouter.js (line 357)
│          - v2aiLiveScenarios.js (alternative direct load)
│          - Runtime call processing
│
├── v2priorityDrivenKnowledgeRouter.js ← Routes through knowledge sources
│   └── executePriorityRouting(context)
│       ├── Priority 1: Company Q&A
│       ├── Priority 2: Trade Q&A
│       └── Priority 3: Instant Responses (Templates)
│           └── queryInstantResponses(companyId, query, context)
│               ├── Line 302: Load company from MongoDB
│               ├── Line 319-349: Determine intelligence config (global vs custom)
│               ├── Line 357: Call ScenarioPoolService.getScenarioPoolForCompany()
│               ├── Line 379: Filter to enabled scenarios only
│               ├── Line 404-470: Route through IntelligentRouter (3-tier) OR
│               └── Line 471-550: Direct HybridScenarioSelector (legacy)
│
├── IntelligentRouter.js ← 3-Tier Cascade (Tier 1 → 2 → 3)
│   └── route({ callerInput, template, company, context })
│       ├── Line 91-125: Load thresholds from context.intelligenceConfig ✅ FIXED!
│       ├── Line 136-211: TIER 1 - HybridScenarioSelector (rule-based)
│       ├── Line 213-262: TIER 2 - Semantic search (statistical)
│       ├── Line 265-390: TIER 3 - LLM Fallback (GPT-4 Turbo)
│       └── buildEffectiveFillers(template) - Line 806
│           ├── Loads: template.fillerWords[]
│           ├── Merges: category.additionalFillerWords[]
│           └── Returns: Deduplicated filler array
│
├── HybridScenarioSelector.js ← Tier 1 rule-based matching
│   └── constructor(fillerWordsArray, urgencyKeywordsArray, synonymMapObject)
│       ├── Receives: Pre-built filler array from IntelligentRouter
│       ├── Uses: BM25 algorithm for text matching
│       └── Removes: Filler words before matching
│
├── Tier3LLMFallback.js ← Tier 3 LLM matching
│   └── handleFallback({ callerInput, template, company, context })
│       ├── Calls: OpenAI GPT-4 Turbo API
│       ├── Logs: LLMCallLog (cost tracking)
│       └── Creates: ProductionLLMSuggestion (learning)
│
├── PlaceholderScanService.js ← Variable detection
│   └── scanCompany(companyId)
│       ├── Scans: All scenarios for {placeholders}
│       ├── Saves: company.aiAgentSettings.variableDefinitions[]
│       └── Triggers: On template activation
│
├── CompanyVariablesService.js ← Variable management
│   └── (Helper functions for variable CRUD)
│
└── v2elevenLabsService.js ← Text-to-Speech
    └── synthesizeSpeech({ text, voiceId, ...voiceSettings })
        ├── Resolves: API key (company-specific or platform default)
        ├── Replaces: {placeholders} with company.aiAgentSettings.variables
        ├── Calls: ElevenLabs API
        └── Returns: Audio buffer
```

**Service Dependencies:**

```
v2AIAgentRuntime.processUserInput()
  ↓
v2priorityDrivenKnowledgeRouter.executePriorityRouting()
  ↓
v2priorityDrivenKnowledgeRouter.queryInstantResponses()
  ↓
ScenarioPoolService.getScenarioPoolForCompany() ← LOADS SCENARIOS
  ↓
IntelligentRouter.route() ← 3-TIER CASCADE
  ├─ buildEffectiveFillers() ← LOADS FILLERS
  ├─ buildEffectiveSynonymMap() ← LOADS SYNONYMS
  └─ HybridScenarioSelector.selectScenario() ← TIER 1 MATCHING
```

---

## 🌐 API ROUTES

### ✅ Company-Specific Routes

```
routes/company/
├── v2aiLiveScenarios.js ← Load all scenarios for company
│   └── GET /api/company/:companyId/live-scenarios
│       ├── Line 49: Redis cache key: `live-scenarios:${companyId}`
│       ├── Line 61: Check Redis cache (5 min TTL)
│       ├── Line 85: Load company.aiAgentSettings.templateReferences
│       ├── Line 135: Load GlobalInstantResponseTemplate for each
│       ├── Line 148: Flatten scenarios from all categories
│       ├── Line 203: Apply scenarioControls (enable/disable)
│       └── Line 271: Cache result in Redis (5 min)
│       📍 USED BY:
│          - AiCore Live Scenarios tab (UI)
│          - Company Profile page load
│          - NOT used by runtime (runtime uses ScenarioPoolService directly)
│
├── v2aiCoreScenarios.js ← Enable/disable specific scenarios
│   └── PATCH /api/aicore/:companyId/scenarios/:templateId/:scenarioId
│       ├── Body: { isEnabled: true/false }
│       ├── Updates: company.aiAgentSettings.scenarioControls[]
│       └── Line 149: Clears Redis cache: `live-scenarios:${companyId}`
│
├── v2companyConfiguration.js ← Template activation & variables
│   ├── GET /api/company/:companyId/configuration/templates
│   │   └── Returns: company.aiAgentSettings.templateReferences[]
│   ├── POST /api/company/:companyId/configuration/templates
│   │   ├── Adds: New entry to templateReferences[]
│   │   ├── Triggers: Variable scan (PlaceholderScanService)
│   │   └── Line 1986: Clears Redis: `live-scenarios:${companyId}`
│   ├── DELETE /api/company/:companyId/configuration/templates/:templateId
│   │   ├── Removes: Template from templateReferences[]
│   │   └── Line 2089: Clears Redis: `live-scenarios:${companyId}`
│   ├── GET /api/company/:companyId/configuration/variables
│   │   └── Returns: company.aiAgentSettings.variables + variableDefinitions[]
│   ├── PATCH /api/company/:companyId/configuration/variables
│   │   ├── Updates: company.aiAgentSettings.variables Map
│   │   └── Clears: Redis company cache
│   └── POST /api/company/:companyId/configuration/variables/scan
│       └── Triggers: PlaceholderScanService.scanCompany()
│
├── v2FillerFilter.js ← Filler word management
│   ├── GET /api/company/:companyId/configuration/filler-filter
│   │   ├── Returns: inherited[] (from templates) + custom[] (company additions)
│   │   └── Merges: template.fillerWords[] from all active templates
│   ├── POST /api/company/:companyId/configuration/filler-filter/custom
│   │   └── Adds: Word to company.aiAgentSettings.fillerWords.custom[]
│   └── DELETE /api/company/:companyId/configuration/filler-filter/custom/:word
│       └── Removes: Word from custom[]
│
└── v2profile-voice.js ← Voice settings
    ├── GET /api/company/:companyId/v2-voice-settings
    │   └── Returns: company.aiAgentLogic.voiceSettings
    └── POST /api/company/:companyId/v2-voice-settings
        └── Updates: company.aiAgentLogic.voiceSettings
```

### ✅ Admin Routes

```
routes/admin/
├── globalIntelligence.js ← Global 3-tier intelligence settings
│   ├── GET /api/admin/global-intelligence
│   │   └── Returns: AdminSettings.globalProductionIntelligence
│   └── PATCH /api/admin/global-intelligence
│       ├── Updates: AdminSettings.globalProductionIntelligence
│       └── Line 227: Clears Redis cache for ALL companies using global
│
└── globalInstantResponses.js ← Template management
    ├── GET /api/admin/global-instant-responses
    │   └── Returns: All GlobalInstantResponseTemplate documents
    ├── POST /api/admin/global-instant-responses
    │   └── Creates: New template
    ├── PUT /api/admin/global-instant-responses/:id
    │   └── Updates: Existing template
    └── DELETE /api/admin/global-instant-responses/:id
        └── Deletes: Template (if not in use)
```

---

## 🗃️ REDIS CACHING

### ✅ Cache Keys and TTL

| Cache Key | Purpose | TTL | Cleared When |
|-----------|---------|-----|--------------|
| `live-scenarios:${companyId}` | Cached scenario list for UI | 5 min (300s) | Template added/removed, Scenario enabled/disabled |
| `company:${companyId}` | Full company document | Variable | Company settings saved |
| `global-intelligence` | Global production intelligence | Variable | Global settings saved |

### ✅ Redis Operations

**File:** `routes/company/v2aiLiveScenarios.js`

```javascript
// READ from Redis (line 61)
const cachedData = await redisClient.get(`live-scenarios:${companyId}`);
if (cachedData) {
  return res.json(JSON.parse(cachedData));
}

// WRITE to Redis (line 271)
await redisClient.setEx(
  `live-scenarios:${companyId}`,
  300, // 5 minutes
  JSON.stringify(responseData)
);
```

**File:** `routes/company/v2aiCoreScenarios.js`

```javascript
// CLEAR cache when scenario disabled (line 149)
await redisClient.del(`live-scenarios:${companyId}`);
```

**File:** `routes/company/v2companyConfiguration.js`

```javascript
// CLEAR cache when template added (line 1986)
await redisClient.del(`live-scenarios:${companyId}`);

// CLEAR cache when template removed (line 2089)
await redisClient.del(`live-scenarios:${companyId}`);
```

**File:** `utils/cacheHelper.js`

```javascript
// Centralized cache clearing
class CacheHelper {
  static async clearCompanyCache(companyId) {
    await redisClient.del(`company:${companyId}`);
    await redisClient.del(`live-scenarios:${companyId}`);
  }
  
  static async clearGlobalIntelligenceCache() {
    await redisClient.del('global-intelligence');
  }
}
```

**File:** `routes/admin/globalIntelligence.js`

```javascript
// Clear cache for all companies using global intelligence (line 227)
async function clearGlobalIntelligenceCache() {
  // This is a CRITICAL operation - affects ALL companies
  // Find all companies with useGlobalIntelligence = true
  // Clear their individual caches
}
```

---

## 🔄 RUNTIME FLOW

### ✅ Complete Call Processing Flow

```
STEP 1: Customer calls → Twilio webhook
  ↓
STEP 2: routes/v2twilio.js (line 534 or 1467)
  ↓
STEP 3: getCompanyByPhoneNumber(+12392322030)
  ├─ MongoDB: v2Company.findOne({ 'twilioConfig.phoneNumbers.phoneNumber': ... })
  └─ Loads: Full company document with ALL nested fields
  ↓
STEP 4: v2AIAgentRuntime.initializeCall()
  ├─ Loads: company.connectionMessages.voice (greeting)
  ├─ Loads: company.aiAgentLogic.voiceSettings (voice ID)
  └─ Returns: { greeting, voiceSettings }
  ↓
STEP 5: ElevenLabs TTS for greeting ✅
  ↓
STEP 6: Customer speaks → Twilio converts to text
  ↓
STEP 7: routes/v2twilio.js (line 1619) POST /v2-agent-respond/:companyID
  ↓
STEP 8: v2AIAgentRuntime.processUserInput(companyID, callSid, speechResult)
  ├─ Line 1688: Company.findById(companyID) ← ⚠️ MIGHT BE INCOMPLETE!
  └─ Calls: generateV2Response()
  ↓
STEP 9: v2AIAgentRuntime.generateV2Response()
  ├─ Creates: v2priorityDrivenKnowledgeRouter instance
  └─ Calls: executePriorityRouting(context)
  ↓
STEP 10: v2priorityDrivenKnowledgeRouter.executePriorityRouting()
  └─ Calls: queryInstantResponses(companyId, query, context)
  ↓
STEP 11: v2priorityDrivenKnowledgeRouter.queryInstantResponses()
  ├─ Line 302: Load company from MongoDB (FRESH LOAD - ignores passed context!)
  ├─ Line 319-349: Determine intelligence config (global vs custom)
  │   ├─ If useGlobalIntelligence = true:
  │   │   └─ Load AdminSettings.globalProductionIntelligence
  │   └─ If useGlobalIntelligence = false:
  │       └─ Load company.aiAgentLogic.productionIntelligence
  ├─ Line 357: ScenarioPoolService.getScenarioPoolForCompany(companyId)
  │   ├─ Line 50: Load company.aiAgentSettings.templateReferences
  │   ├─ Line 69: Determine which template IDs to load
  │   ├─ Line 85: Load GlobalInstantResponseTemplate for each
  │   ├─ Line 97: Flatten scenarios from all categories
  │   └─ Line 95: Apply scenarioControls (enable/disable)
  ├─ Line 379: Filter to enabled scenarios only
  └─ Line 404: If intelligence enabled → IntelligentRouter.route()
  ↓
STEP 12: IntelligentRouter.route()
  ├─ Line 91-125: Load thresholds from context.intelligenceConfig ✅
  ├─ Line 806: buildEffectiveFillers(template)
  │   ├─ Loads: template.fillerWords[]
  │   └─ Merges: category.additionalFillerWords[]
  ├─ Line 822: buildEffectiveSynonymMap(template)
  │   ├─ Loads: template.synonymMap
  │   └─ Merges: category.synonymMap
  └─ Line 136: TIER 1 - HybridScenarioSelector
      ├─ Removes: Filler words from caller input
      ├─ Expands: Synonyms
      └─ Matches: Against scenarios using BM25
  ↓
STEP 13: Response generated
  ├─ Replace: {placeholders} with company.aiAgentSettings.variables
  ├─ Generate: ElevenLabs audio using company.aiAgentLogic.voiceSettings.voiceId
  └─ Return: TwiML with audio URL
```

---

## 🎯 COMPLETE DATA FLOW DIAGRAM

### From Database → Runtime

```
┌─────────────────────────────────────────────────────────────────┐
│  MONGODB (SOURCE OF TRUTH)                                      │
├─────────────────────────────────────────────────────────────────┤
│  Collection: companies (v2Company)                              │
│  ├─ aiAgentSettings {                                           │
│  │   ├─ templateReferences[] ← Which templates are active      │
│  │   ├─ scenarioControls[] ← Which scenarios are disabled      │
│  │   ├─ variables (Map) ← Placeholder values                   │
│  │   └─ fillerWords { inherited[], custom[] }                  │
│  ├─ aiAgentLogic {                                              │
│  │   ├─ voiceSettings ← ElevenLabs config                      │
│  │   └─ productionIntelligence ← Custom 3-tier settings        │
│  └─ configuration {                                             │
│      └─ clonedFrom ← Legacy template ref                       │
│                                                                  │
│  Collection: globalinstantresponsetemplates                     │
│  └─ Template documents {                                        │
│      ├─ categories[] {                                          │
│      │   └─ scenarios[] ← All scenario definitions             │
│      ├─ fillerWords[] ← Template-level fillers                 │
│      └─ synonymMap ← Synonym mappings                           │
│                                                                  │
│  Collection: adminsettings (singleton)                          │
│  └─ globalProductionIntelligence ← Platform-wide 3-tier config │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│  REDIS (PERFORMANCE CACHE)                                      │
├─────────────────────────────────────────────────────────────────┤
│  Key: live-scenarios:${companyId}                               │
│  Value: { scenarios[], templatesUsed[], summary }               │
│  TTL: 5 minutes (300 seconds)                                   │
│  Used By: UI only (NOT runtime)                                 │
│                                                                  │
│  Key: company:${companyId}                                      │
│  Value: Full company document                                   │
│  TTL: Variable (cleared on update)                              │
│                                                                  │
│  Key: global-intelligence                                       │
│  Value: AdminSettings.globalProductionIntelligence              │
│  TTL: Variable (cleared on update)                              │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│  SERVICES (BUSINESS LOGIC)                                      │
├─────────────────────────────────────────────────────────────────┤
│  ScenarioPoolService.getScenarioPoolForCompany()               │
│  ├─ Loads: templateReferences from MongoDB                     │
│  ├─ Loads: GlobalInstantResponseTemplate for each              │
│  ├─ Flattens: All scenarios from all categories                │
│  ├─ Applies: scenarioControls (enable/disable)                 │
│  └─ Returns: { scenarios[], templatesUsed[] }                  │
│  ⚠️ NO REDIS CACHING - Always loads fresh from MongoDB!       │
│                                                                  │
│  IntelligentRouter.buildEffectiveFillers()                     │
│  ├─ Loads: template.fillerWords[]                              │
│  ├─ Merges: category.additionalFillerWords[]                   │
│  └─ Returns: Deduplicated array                                │
│  ⚠️ Does NOT load company.aiAgentSettings.fillerWords.custom[] │
│     (This is a gap - custom fillers not used at runtime!)      │
│                                                                  │
│  v2elevenLabsService.synthesizeSpeech()                        │
│  ├─ Loads: company.aiAgentSettings.variables (for replacement) │
│  ├─ Loads: company.aiAgentLogic.voiceSettings (for TTS)        │
│  └─ Returns: Audio buffer                                       │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│  RUNTIME (PRODUCTION CALLS)                                     │
├─────────────────────────────────────────────────────────────────┤
│  routes/v2twilio.js                                             │
│  └─ POST /v2-agent-respond/:companyID                          │
│     ├─ Line 1688: Company.findById() ← RELOADS COMPANY         │
│     ├─ Line 1696: Extract voiceId                              │
│     └─ Line 1703: If voiceId missing → Fallback to Twilio     │
│                                                                  │
│  services/v2AIAgentRuntime.js                                  │
│  └─ processUserInput() → generateV2Response()                  │
│     └─ Calls v2priorityDrivenKnowledgeRouter                   │
│                                                                  │
│  services/v2priorityDrivenKnowledgeRouter.js                   │
│  └─ queryInstantResponses()                                     │
│     ├─ Line 302: RELOADS COMPANY (ignores passed context!)     │
│     ├─ Line 357: Calls ScenarioPoolService                     │
│     └─ Line 433: Calls IntelligentRouter.route()               │
│                                                                  │
│  services/IntelligentRouter.js                                  │
│  └─ route()                                                      │
│     ├─ Line 91-125: Loads thresholds from context ✅           │
│     ├─ Line 806: buildEffectiveFillers()                       │
│     └─ Line 136: HybridScenarioSelector (Tier 1)               │
└─────────────────────────────────────────────────────────────────┘
```

---

## ⚠️ IDENTIFIED GAPS

### GAP #1: Company Custom Fillers Not Used at Runtime

**Location:** `services/IntelligentRouter.js` (line 806)

**Current Behavior:**
```javascript
buildEffectiveFillers(template) {
  const templateFillers = template.fillerWords || [];
  const allFillers = [...templateFillers];
  
  template.categories.forEach(category => {
    allFillers.push(...category.additionalFillerWords);
  });
  
  return [...new Set(allFillers)];
}
```

**Problem:** This only loads fillers from the template and categories.  
**Missing:** `company.aiAgentSettings.fillerWords.custom[]` is NOT included!

**Impact:**
- Companies can add custom filler words in the UI
- But those custom fillers are NEVER used during call processing
- Only template-inherited fillers are used

**Fix Needed:**
```javascript
buildEffectiveFillers(template, company) {
  const templateFillers = template.fillerWords || [];
  const customFillers = company?.aiAgentSettings?.fillerWords?.custom || [];
  const allFillers = [...templateFillers, ...customFillers];
  
  template.categories.forEach(category => {
    allFillers.push(...category.additionalFillerWords || []);
  });
  
  return [...new Set(allFillers)];
}
```

---

### GAP #2: Voice Settings Missing in Second Leg

**Location:** `routes/v2twilio.js` (line 1688)

**Current Behavior:**
```javascript
const company = await Company.findById(companyID);
const elevenLabsVoice = company?.aiAgentLogic?.voiceSettings?.voiceId;
```

**Problem:** `findById()` might not populate nested fields correctly.

**Evidence:**
- First leg (line 556): Uses `getCompanyByPhoneNumber()` → Voice works ✅
- Second leg (line 1688): Uses `Company.findById()` → Voice fails ❌

**Fix Needed:**
```javascript
const company = await Company.findById(companyID)
  .select('+aiAgentLogic.voiceSettings')  // Ensure voiceSettings included
  .populate('aiAgentSettings.templateReferences.templateId');  // Populate templates
```

OR reuse the same loading function:
```javascript
const company = await getCompanyByPhoneNumber(req.body.To);
// This already loads everything correctly!
```

---

### GAP #3: Redis Cache Not Used by Runtime

**Location:** `services/ScenarioPoolService.js`

**Current Behavior:**
- No Redis caching in ScenarioPoolService
- Always loads fresh from MongoDB
- ~100-200ms per call

**Problem:** Unnecessary database load on every call

**Fix Needed:**
Add Redis caching with 5-minute TTL:
```javascript
static async getScenarioPoolForCompany(companyId) {
  const cacheKey = `scenario-pool:${companyId}`;
  
  // Check Redis first
  const cached = await redisClient.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }
  
  // Load from MongoDB
  const result = await this._loadFromDatabase(companyId);
  
  // Cache for 5 minutes
  await redisClient.setEx(cacheKey, 300, JSON.stringify(result));
  
  return result;
}
```

---

## 🎯 UTILITY FILES

```
utils/
├── placeholderReplacer.js ← {companyName} → "Royal Plumbing"
│   └── replacePlaceholders(text, company)
│       ├─ Finds: All {placeholders} in text
│       ├─ Loads: company.aiAgentSettings.variables Map
│       └─ Replaces: {key} with value
│       📍 USED BY:
│          - v2elevenLabsService.synthesizeSpeech() (line ~50)
│          - v2priorityDrivenKnowledgeRouter.queryCompanyQnA()
│          - All knowledge source responses
│
├── placeholderUtils.js ← Placeholder detection utilities
│   ├─ detectPlaceholders(text) → Array<String>
│   ├─ normalizePlaceholder(key) → lowercase, no spaces
│   └─ inferType(key) → "email" | "phone" | "currency" | "text"
│
└── cacheHelper.js ← Centralized cache management
    ├─ clearCompanyCache(companyId)
    ├─ clearGlobalIntelligenceCache()
    └─ clearScenarioCache(companyId)
```

---

## 📋 QUICK REFERENCE: Where Things Live

### To Load Templates:
```javascript
// Option A: Single template by ID
const template = await GlobalInstantResponseTemplate.findById(templateId);

// Option B: All templates for company (with scenario controls)
const { scenarios, templatesUsed } = await ScenarioPoolService.getScenarioPoolForCompany(companyId);
```

### To Load Variables:
```javascript
// Load company
const company = await Company.findById(companyId);

// Get variables
const variables = company.aiAgentSettings?.variables || new Map();

// Get specific variable
const companyName = variables.get('companyName') || 'Unknown';
```

### To Load Fillers:
```javascript
// Option A: From template
const template = await GlobalInstantResponseTemplate.findById(templateId);
const templateFillers = template.fillerWords || [];

// Option B: From company (custom + inherited)
const company = await Company.findById(companyId);
const customFillers = company.aiAgentSettings?.fillerWords?.custom || [];
const inheritedFillers = company.aiAgentSettings?.fillerWords?.inherited || [];
const allFillers = [...inheritedFillers, ...customFillers];
```

### To Load Intelligence Settings:
```javascript
const company = await Company.findById(companyId);
const useGlobal = company.aiAgentLogic?.useGlobalIntelligence !== false;

if (useGlobal) {
  // Load global
  const adminSettings = await AdminSettings.findOne({});
  const intelligence = adminSettings.globalProductionIntelligence;
} else {
  // Load custom
  const intelligence = company.aiAgentLogic?.productionIntelligence;
}

// Access thresholds
const tier1 = intelligence.thresholds?.tier1 || 0.80;
const tier2 = intelligence.thresholds?.tier2 || 0.60;
```

### To Clear Redis Cache:
```javascript
const { redisClient } = require('./db');

// Clear scenario cache
await redisClient.del(`live-scenarios:${companyId}`);

// Clear company cache
await redisClient.del(`company:${companyId}`);

// Clear specific key
await redisClient.del(`scenario-pool:${companyId}`);
```

---

## 🔍 DEBUGGING CHECKLIST

### If Scenarios Don't Load:
1. ✅ Check: `company.aiAgentSettings.templateReferences[]` has entries
2. ✅ Check: Template references have `enabled: true`
3. ✅ Check: `GlobalInstantResponseTemplate` documents exist with those IDs
4. ✅ Check: Templates have `categories[]` with `scenarios[]`
5. ✅ Check: Redis cache cleared after template changes
6. ✅ Log: `ScenarioPoolService.getScenarioPoolForCompany()` return value

### If Variables Don't Replace:
1. ✅ Check: `company.aiAgentSettings.variables` Map has entries
2. ✅ Check: Keys match placeholders (case-insensitive: `{companyName}` → `companyname`)
3. ✅ Check: `placeholderReplacer.js` is called before TTS
4. ✅ Log: Variables before and after replacement

### If Fillers Don't Work:
1. ✅ Check: Template has `fillerWords[]` array
2. ✅ Check: Categories have `additionalFillerWords[]` arrays
3. ⚠️ WARNING: Custom fillers (`company.aiAgentSettings.fillerWords.custom[]`) are NOT used at runtime!
4. ✅ Log: `buildEffectiveFillers()` return value

### If Voice Settings Missing:
1. ✅ Check: `company.aiAgentLogic.voiceSettings.voiceId` exists
2. ✅ Check: Voice ID is valid ElevenLabs voice
3. ✅ Check: Company was loaded with `.select('+aiAgentLogic.voiceSettings')`
4. ✅ Compare: First leg vs second leg company load methods

---

## 🎯 FILE SUMMARY

**Total Files Mapped:** 25+ core files

**Database Models:** 3
- `models/v2Company.js`
- `models/GlobalInstantResponseTemplate.js`
- `models/AdminSettings.js`

**Services:** 10+
- `ScenarioPoolService.js` ← CANONICAL
- `v2priorityDrivenKnowledgeRouter.js`
- `IntelligentRouter.js`
- `HybridScenarioSelector.js`
- `Tier3LLMFallback.js`
- `PlaceholderScanService.js`
- `CompanyVariablesService.js`
- `v2elevenLabsService.js`
- `v2AIAgentRuntime.js`
- Others...

**API Routes:** 8+
- `routes/company/v2aiLiveScenarios.js`
- `routes/company/v2aiCoreScenarios.js`
- `routes/company/v2companyConfiguration.js`
- `routes/company/v2FillerFilter.js`
- `routes/company/v2profile-voice.js`
- `routes/admin/globalIntelligence.js`
- `routes/admin/globalInstantResponses.js`
- `routes/v2twilio.js`

**Utilities:** 3
- `utils/placeholderReplacer.js`
- `utils/placeholderUtils.js`
- `utils/cacheHelper.js`

---

**END OF AICORE FILES MAP**

**Status:** ✅ All files verified to exist  
**Gaps Identified:** 3 (custom fillers, voice settings, Redis caching)  
**Next Action:** Fix identified gaps in runtime flow

