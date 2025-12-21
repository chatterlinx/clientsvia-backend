# 🧠 WIRING MAP: SCENARIO BRAIN (December 2025)

> **Purpose**: Single-document truth of how the Scenario Brain is wired into ClientsVia.
> **Rule**: If it's not in this map, it's not wired.

---

## 📦 MODELS (Data Storage)

### GlobalInstantResponseTemplate
- **File**: `models/GlobalInstantResponseTemplate.js`
- **Collection**: `globalinstantresponsetemplates`
- **Scope**: GLOBAL (shared by trade/industry)
- **Key Fields**:
  - `categories[]` - Array of categories
  - `categories[].scenarios[]` - Array of scenarios
  - `scenarios[].triggers[]` - Trigger phrases
  - `scenarios[].quickReplies[]` - Short responses
  - `scenarios[].fullReplies[]` - Detailed responses
  - `scenarios[].priority` - Tie-breaker (-10 to 100)
  - `scenarios[].minConfidence` - Per-scenario threshold
  - `learningSettings.tier1Threshold` - Tier 1 confidence threshold (default: 0.80)
  - `learningSettings.tier2Threshold` - Tier 2 confidence threshold (default: 0.60)
  - `aiGatewaySettings.enableTier3` - LLM fallback enabled

### InstantResponseCategory
- **File**: `models/InstantResponseCategory.js`
- **Collection**: `instantresponsecategories`
- **Scope**: PER-COMPANY (multi-tenant via `companyId`)
- **Key Fields**:
  - `companyId` - ObjectId reference
  - `qnas[]` - Q&A scenarios
  - `qnas[].triggers[]` - Trigger phrases
  - `qnas[].quickReply` - Short response
  - `qnas[].fullReply` - Detailed response

---

## 🔌 SERVICES (Brain Logic)

### IntelligentRouter (THE ORCHESTRATOR)
- **File**: `services/IntelligentRouter.js`
- **Purpose**: 3-Tier cascade orchestration
- **Main Method**: `route({ callerInput, template, company, callId, context })`
- **Returns**: 
  ```javascript
  {
    tierUsed: 1|2|3,
    matched: boolean,
    scenario: { scenarioId, name, quickReplies, fullReplies, ... },
    confidence: 0.0-1.0,
    response: string,
    cost: { tier1: 0, tier2: 0, tier3: number }
  }
  ```
- **Tier Flow**:
  1. **Tier 1** → `HybridScenarioSelector.selectScenario()` (FREE, ~50ms)
  2. **Tier 2** → Semantic boost on Tier 1 result (FREE, ~100ms)
  3. **Tier 3** → `Tier3LLMFallback.analyze()` ($0.50, ~1500ms)

### HybridScenarioSelector (TIER 1)
- **File**: `services/HybridScenarioSelector.js`
- **Purpose**: Rule-based matching
- **Algorithm**: BM25 (40%) + Semantic (30%) + Regex (20%) + Context (10%)
- **Features**:
  - Filler word stripping
  - Synonym expansion
  - Urgency keyword boosting
  - Negative trigger blocking
  - Priority tie-breaking

### Tier3LLMFallback (TIER 3)
- **File**: `services/Tier3LLMFallback.js`
- **Purpose**: LLM fallback when Tier 1/2 fail
- **Model**: GPT-4o-mini (configurable)
- **Cost**: ~$0.50/call

---

## 🎯 RUNTIME ENTRY POINTS

### Twilio Voice Webhook
- **File**: `routes/v2twilio.js`
- **Line**: ~3870
- **Call Chain**:
  ```
  POST /api/twilio/...
  → v2twilio.js
  → IntelligentRouter.route({ callerInput, template, company, callId, context })
  → HybridScenarioSelector (Tier 1)
  → [if fail] Tier 2 boost
  → [if fail] Tier3LLMFallback (Tier 3)
  → Response returned to TTS
  ```

### Test Console (Template Testing)
- **File**: `routes/v2twilio.js` (same file, test endpoint)
- **Uses**: Same `IntelligentRouter.route()` with `testMode: true`

---

## 🖥️ ADMIN UI

### Global AI Brain Page
- **File**: `public/admin-global-instant-responses.html`
- **Purpose**: Manage templates, categories, scenarios
- **Features**:
  - Add/edit/delete scenarios
  - Configure triggers, replies, priority
  - Set tier thresholds
  - Test phrase matching

### API Routes
- **File**: `routes/admin/globalInstantResponses.js`
- **Endpoints**:
  - `GET /api/admin/global-instant-responses` - List templates
  - `POST /api/admin/global-instant-responses` - Create template
  - `PUT /api/admin/global-instant-responses/:id` - Update template
  - `DELETE /api/admin/global-instant-responses/:id` - Delete template

---

## 🔄 REDIS CACHE

- **Current**: No Redis caching for scenarios (scenarios loaded from MongoDB on each call)
- **Recommendation**: Add caching for `getEffectiveScenarios(companyId, tradeKey)`

---

## ⚠️ MISSING PIECES (Per December 2025 Directive)

### 1. Company ↔ Global Mapping Layer
- **Status**: NOT IMPLEMENTED
- **Need**: `companyScenarioToggles` collection to enable/disable global scenarios per company
- **Schema**:
  ```javascript
  {
    companyId: ObjectId,
    scenarioId: String,
    enabled: Boolean,
    customPriority: Number (optional)
  }
  ```

### 2. Trade Selection Filter
- **Status**: NOT ENFORCED
- **Need**: Filter scenarios by `company.tradeKey` at runtime
- **Current**: All scenarios from template are available regardless of trade

### 3. Flow Tree Snapshot Integration
- **Status**: PARTIAL
- **Need**: Snapshot must include:
  - `scenarioEngine.enabled`
  - `scenarioEngine.tiers.tier1/2/3` config
  - `dataConfig.scenarios.count`
  - `dataConfig.scenarios.enabledCount`

### 4. ScenarioEngine Adapter
- **Status**: NOT CREATED
- **Need**: Clean entry point `ScenarioEngine.selectResponse()` per contract

---

## 📋 NEXT STEPS (Per Directive Order)

1. ✅ Discovery complete (this document)
2. Create `ScenarioEngine.selectResponse()` adapter
3. Add `companyScenarioToggles` collection
4. Update Flow Tree snapshot to include scenario config
5. Add trade selection filter to runtime

---

*Last Updated: December 2025*
*Author: AI-Coder Discovery Phase*

