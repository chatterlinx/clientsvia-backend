# ClientsVia Runtime Map – CompanyID Scoped

> **Created:** December 10, 2025
> **Purpose:** Single source of truth for what code runs during live calls
> **Rule:** Before adding ANY new feature, check this map first!

---

## 1. LLM Brains (ONLY TWO EXIST)

| Brain ID | Purpose | Entry Function | Registry Method | Used By | Status |
|----------|---------|----------------|-----------------|---------|--------|
| **LLM0** | Primary frontline AI - handles ALL conversation | `LLM0TurnHandler.handle()` | `llmRegistry.callLLM0()` | HybridReceptionistLLM, BookingConversationLLM | ✅ LIVE |
| **TIER3** | Fallback brain - only when Tier1/Tier2 fail | `Tier3LLMFallback.analyze()` | `llmRegistry.callTier3Fallback()` | IntelligentRouter (3-Tier system) | ✅ LIVE |

### ⚠️ DEAD/DEPRECATED Brains (DO NOT USE)

| Brain | File | Status | Notes |
|-------|------|--------|-------|
| LLM0OrchestratorService | `services/orchestration/LLM0OrchestratorService.js` | ❌ NEUTERED | Throws error if called |
| FrontlineIntel | `services/FrontlineIntel.js` | ⚠️ DEPRECATED | Legacy, marked as deprecated |

### Files That Import OpenAI (Audit: Dec 10, 2025)

| File | Called During Live Calls? | Status | Notes |
|------|--------------------------|--------|-------|
| `llmRegistry.js` | ✅ YES - via callLLM0/callTier3Fallback | ✅ CORRECT | The only allowed gateway |
| `HybridReceptionistLLM.js` | ✅ YES | ✅ FIXED | Uses llmRegistry.callLLM0() |
| `Tier3LLMFallback.js` | ✅ YES | ✅ FIXED | Uses llmRegistry.callTier3Fallback() |
| `LLM0BehaviorAnalyzer.js` | ❌ NO | 🟡 ADMIN ONLY | Not called in live path |
| `FrontlineScriptBuilder.js` | ❌ NO | 🟡 ADMIN ONLY | Template building |
| `MissingScenarioDetector.js` | ❌ NO | 🟡 ADMIN ONLY | Admin tool |
| `LLMA_TriageCardGenerator.js` | ❌ NO | 🟡 ADMIN ONLY | Triage card generation |
| `AutoScanService.js` | ❌ NO | 🟡 ADMIN ONLY | Background scanning |
| `EnterpriseAISuggestionEngine.js` | ❌ NO | 🟡 ADMIN ONLY | Suggestions |
| `LLMLearningWorker.js` | ❌ NO | 🟡 ADMIN ONLY | Learning worker |
| `CallJudgementService.js` | ❌ NO | 🟡 ADMIN ONLY | Post-call analysis |
| `TriageBuilderService.js` | ❌ NO | 🟡 ADMIN ONLY | Triage building |
| `FrontlineIntel.js` | ❌ NO | ⚠️ DEPRECATED | Not used in live path |
| `OrchestrationHealthCheck.js` | ❌ NO | 🟡 HEALTH CHECK | API health check only |
| `DependencyHealthMonitor.js` | ❌ NO | 🟡 MONITORING | Health monitoring |
| `SmartWarmupService.js` | ❌ NO | 🟡 WARMUP | Connection warmup |

---

## 2. UI Panels → Mongo Collections → Services → Runtime Usage

| UI Panel | Mongo Path | Loader Function | Used During Live Calls By | Status |
|----------|------------|-----------------|---------------------------|--------|
| **Front Desk Behavior** | `company.aiAgentSettings.frontDeskBehavior` | `getFrontDeskConfig(company)` in LLM0TurnHandler | HybridReceptionistLLM.buildSystemPrompt() | ✅ LIVE |
| **LLM-0 Controls** | `company.aiAgentSettings.llm0Controls` | `LLM0ControlsLoader.load(companyId)` | v2twilio.js → callState.llm0Controls | ✅ LIVE |
| **STT Settings** | `sttProfiles` collection | `STTProfileService.load(templateId)` | v2twilio.js → STTPreprocessor, STTHintsBuilder | ✅ LIVE |
| **Mission Control** | `company.aiAgentSettings.callFlowEngine` | Direct from company doc | IntelligentRouter.route() → FlowEngine | ✅ LIVE |
| **Cheat Sheet** | `cheatSheetVersions` collection | `CheatSheetRuntimeService.getLiveConfig(companyId)` | HybridReceptionistLLM, Tier3 fallback | ✅ LIVE |
| **Triage Cards** | `company.aiAgentSettings.callFlowEngine.triageCards` | From company doc via IntelligentRouter | IntelligentRouter.route() | ✅ LIVE |
| **Quick Answers** | `company.aiAgentSettings.callFlowEngine.quickAnswers` | Direct from company doc | HybridReceptionistLLM (quick match) | ✅ LIVE |
| **Voice Settings** | `company.aiAgentSettings.voiceSettings` | Direct from company doc | v2twilio.js, v2elevenLabsService | ✅ LIVE |
| **Booking Rules** | `company.aiAgentSettings.callFlowEngine.bookingFields` | Direct from company doc | BookingConversationLLM | ✅ LIVE |
| **Transfer Rules** | `company.aiAgentSettings.callFlowEngine.transferRules` | Direct from company doc | LLM0TurnHandler.handleTransfer() | ✅ LIVE |
| **Edge Cases** | Part of LLM-0 Controls + EdgeCaseHandler | `EdgeCaseHandler` service | LLM0TurnHandler, CallFlowExecutor | ✅ LIVE |
| **Guardrails** | Part of LLM-0 Controls | `BehaviorEngine` service | HybridReceptionistLLM prompts | ⚠️ VERIFY |

---

## 3. Live Call Flow (The Actual Path)

```
CALLER SPEAKS
     │
     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  v2twilio.js /v2-agent-respond/:companyID                                  │
│  ├── Load company document                                                  │
│  ├── Load LLM-0 Controls: LLM0ControlsLoader.load(companyId)               │
│  ├── STT Preprocessing: STTPreprocessor.process(speechResult, companyId)   │
│  └── Call LLM0TurnHandler.handle()                                          │
└─────────────────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  LLM0TurnHandler.handle() → handleWithHybridLLM()                          │
│  ├── Load conversation state: ConversationStateManager.load(callId)        │
│  ├── Load Front Desk config: getFrontDeskConfig(company)                   │
│  └── Call HybridReceptionistLLM.processConversation()                       │
└─────────────────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  HybridReceptionistLLM.processConversation()                               │
│  ├── Check Quick Answers (from callFlowEngine.quickAnswers)                │
│  ├── Check Service Area (from company.serviceAreas)                        │
│  ├── Get Triage Context: TriageContextProvider.getTriageContext()          │
│  ├── Build System Prompt (uses Front Desk config, triage context, slots)   │
│  └── Call LLM: llmRegistry.callLLM0() ← THE BRAIN SPEAKS                   │
└─────────────────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Response Processing                                                        │
│  ├── Parse JSON response (phase, problemSummary, wantsBooking, etc.)       │
│  ├── Apply 3-PHASE BOOKING GATE (turn >= 2, has summary, wants booking)    │
│  ├── Update conversation state: ConversationStateManager.save()            │
│  └── Return response to Twilio                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Config Loading Locations (PROBLEM: Scattered!)

### Current State (Fragmented)
| Config | Loaded In | How |
|--------|-----------|-----|
| Company doc | v2twilio.js, LLM0TurnHandler | `Company.findById(companyId)` |
| LLM-0 Controls | v2twilio.js | `LLM0ControlsLoader.load(companyId, company)` |
| Front Desk | LLM0TurnHandler | `getFrontDeskConfig(company)` |
| Cheat Sheet | FrontlineIntel (deprecated) | `CheatSheetRuntimeService.getLiveConfig()` |
| STT Profile | v2twilio.js | `STTProfileService.load(templateId)` |

### Desired State (Unified)
```js
// Single call at start of each turn:
const runtimeConfig = await RuntimeConfigLoader.load(companyId);
// runtimeConfig contains ALL configs needed for the call
```

---

## 5. Key Files Reference

### Entry Points (Twilio Webhooks)
| File | Purpose |
|------|---------|
| `routes/v2twilio.js` | Main call handler - /voice, /v2-agent-respond |

### LLM Brain Layer
| File | Purpose |
|------|---------|
| `services/llmRegistry.js` | **GATEWAY** - Only file allowed to call OpenAI |
| `services/LLM0TurnHandler.js` | Turn orchestration, phase gating |
| `services/HybridReceptionistLLM.js` | Prompt building, LLM calling |
| `services/BookingConversationLLM.js` | Booking slot collection |
| `services/Tier3LLMFallback.js` | 3-Tier fallback brain |

### Config Loaders
| File | Purpose |
|------|---------|
| `services/LLM0ControlsLoader.js` | Loads LLM-0 Controls settings |
| `services/cheatsheet/CheatSheetRuntimeService.js` | Loads live cheat sheet |
| `config/frontDeskPrompt.js` | Default Front Desk config |

### Intelligence/Routing
| File | Purpose |
|------|---------|
| `services/IntelligentRouter.js` | 3-Tier routing (rules → semantic → LLM) |
| `services/HybridScenarioSelector.js` | Triage card matching |
| `services/QuickAnswersMatcher.js` | Quick Answers matching |

### State Management
| File | Purpose |
|------|---------|
| `services/ConversationStateManager.js` | Redis-backed conversation state |
| `services/CallSummaryService.js` | Call records to MongoDB |

---

## 6. The 3-Phase System (DISCOVERY → DECISION → BOOKING)

### Phase Definitions (in HybridReceptionistLLM)
| Phase | Goal | Allowed Actions | Blocked Actions |
|-------|------|-----------------|-----------------|
| **DISCOVERY** | Understand the problem | Ask clarifying questions | Ask for name/phone/address |
| **DECISION** | Confirm what they want | Summarize, ask if they want booking | Collect booking slots |
| **BOOKING** | Collect details | Ask for name → phone → address → time | Skip slots |

### Phase Gate (in LLM0TurnHandler)
```js
// Lines 2058-2080 in LLM0TurnHandler.js
const canEnterBooking = 
    phase === 'BOOKING' &&
    wantsBooking &&
    hasProblemSummary &&
    hasEnoughTurns (>= 2) &&
    highConfidence (>= 0.75);
```

---

## 7. Known Issues / Tech Debt

| Issue | Location | Impact | Priority |
|-------|----------|--------|----------|
| Config loaded in multiple places | v2twilio, LLM0TurnHandler | Potential inconsistency | HIGH |
| Guardrails not clearly wired | BehaviorEngine | May not fire | MEDIUM |
| Front Desk config inline in LLM0TurnHandler | Line 41-59 | Hard to trace | LOW |
| CheatSheet loaded in deprecated FrontlineIntel | FrontlineIntel.js | Confusion | LOW |

---

## 8. Rules for New Features

1. **Check this map FIRST** - Does the feature already exist?
2. **Use RuntimeConfigLoader** - Don't add new config loading paths
3. **Use llmRegistry** - All LLM calls go through callLLM0() or callTier3Fallback()
4. **Update this doc** - Add any new UI panel → Mongo → Runtime mappings
5. **Test with Black Box** - Verify `brain: "LLM0"` or `brain: "TIER3"` appears

---

## 9. Verification Commands

### Check for rogue OpenAI calls
```bash
grep -r "openai\." services/ --include="*.js" | grep -v "llmRegistry\|config/openai"
```

### Check Black Box for brain identification
After a test call, look for:
```json
{
  "type": "LLM_RESPONSE",
  "data": {
    "brain": "LLM0"  // or "TIER3"
  }
}
```

### Verify phase gating
Look for `PHASE_CHECK` events in Black Box.

---

*Last Updated: December 10, 2025*

