# v2AIAgentRuntime.js Refactor Plan

## Current State
- **File:** `services/v2AIAgentRuntime.js`
- **Size:** ~1,100 lines
- **Problem:** Single file doing too many things (init, greeting, input processing, response, caching)

## Target Architecture

Split into 5 focused services with clear responsibilities:

```
services/
├── v2AIAgentRuntime.js          # FACADE - thin entry point only
├── agent/
│   ├── CallInitService.js       # Call initialization & greeting
│   ├── InputProcessingService.js # Input validation & preprocessing
│   ├── ResponseOrchestrator.js  # Response generation & AI Brain routing
│   ├── FallbackService.js       # Error handling & fallbacks
│   └── CacheManager.js          # Redis caching for agent config
```

---

## Service Breakdown

### 1. CallInitService.js (~200 lines)
**Responsibility:** Initialize calls and generate greetings

```javascript
// Exports:
- initializeCall(companyID, callId, from, to, callSource, isTest)
- generateV2Greeting(company)
- validateCompanyConfig(company)

// Consumes:
- Company model
- CheatSheetRuntimeService
- PolicyCompiler
```

### 2. InputProcessingService.js (~150 lines)
**Responsibility:** Validate and preprocess user input

```javascript
// Exports:
- processInput(userInput, callState, companyID)
- validateInput(userInput)
- truncateInput(userInput, maxLength)
- normalizeInput(userInput)

// Consumes:
- Nothing (pure utility)
```

### 3. ResponseOrchestrator.js (~400 lines)
**Responsibility:** Generate responses via AI Brain

```javascript
// Exports:
- generateResponse(userInput, company, callState)
- applyAIAgentRole(baseResponse, aiAgentRole, company)
- buildPureResponse(text, company)

// Consumes:
- AIBrain3tierllm
- placeholderReplacer
- CallFlowExecutor (delegates to)
```

### 4. FallbackService.js (~150 lines)
**Responsibility:** Handle errors and fallback scenarios

```javascript
// Exports:
- triggerFallback(company, reason)
- executeFallbackActions(company, reason, fallbackConfig)
- buildFallbackResponse(error, callState)
- ERROR_MESSAGES (constants)

// Consumes:
- intelligentFallbackHandler
- AdminNotificationService
```

### 5. CacheManager.js (~100 lines)
**Responsibility:** Manage Redis caching for agent config

```javascript
// Exports:
- clearV2Cache(companyID)
- getCachedConfig(companyID)
- setCachedConfig(companyID, config)

// Consumes:
- redisClient
```

---

## v2AIAgentRuntime.js (After Refactor) - ~100 lines

```javascript
/**
 * V2 AI Agent Runtime - FACADE
 * Thin entry point that delegates to focused services
 */

const CallInitService = require('./agent/CallInitService');
const InputProcessingService = require('./agent/InputProcessingService');
const ResponseOrchestrator = require('./agent/ResponseOrchestrator');
const FallbackService = require('./agent/FallbackService');
const CacheManager = require('./agent/CacheManager');

class V2AIAgentRuntime {
    static async initializeCall(companyID, callId, from, to, callSource, isTest) {
        return CallInitService.initializeCall(companyID, callId, from, to, callSource, isTest);
    }
    
    static async processUserInput(companyID, callId, userInput, callState) {
        // Validate input
        userInput = InputProcessingService.processInput(userInput, callState, companyID);
        
        try {
            // Generate response
            return await ResponseOrchestrator.generateResponse(userInput, companyID, callState);
        } catch (error) {
            // Handle fallback
            return FallbackService.buildFallbackResponse(error, callState);
        }
    }
    
    static async clearV2Cache(companyID) {
        return CacheManager.clearV2Cache(companyID);
    }
}

module.exports = {
    initializeCall: V2AIAgentRuntime.initializeCall.bind(V2AIAgentRuntime),
    processUserInput: V2AIAgentRuntime.processUserInput.bind(V2AIAgentRuntime),
    clearV2Cache: V2AIAgentRuntime.clearV2Cache.bind(V2AIAgentRuntime)
};
```

---

## Migration Strategy

### Phase 1: Extract FallbackService (Low Risk)
- Create `services/agent/FallbackService.js`
- Move `triggerFallback()`, `executeFallbackActions()`, `ERROR_MESSAGES`
- Update imports in v2AIAgentRuntime.js
- **Test:** Verify fallback scenarios still work

### Phase 2: Extract CacheManager (Low Risk)
- Create `services/agent/CacheManager.js`
- Move `clearV2Cache()` and related cache logic
- **Test:** Verify cache clearing works

### Phase 3: Extract InputProcessingService (Medium Risk)
- Create `services/agent/InputProcessingService.js`
- Move input validation and preprocessing logic
- **Test:** Verify input validation works for edge cases

### Phase 4: Extract CallInitService (Medium Risk)
- Create `services/agent/CallInitService.js`
- Move `initializeCall()`, `generateV2Greeting()`
- **Test:** Verify call initialization and greeting generation

### Phase 5: Extract ResponseOrchestrator (High Risk)
- Create `services/agent/ResponseOrchestrator.js`
- Move `generateV2Response()`, AI Brain integration, trace logging
- This is the most complex extraction
- **Test:** Full call flow testing required

### Phase 6: Final Cleanup
- Reduce v2AIAgentRuntime.js to thin facade
- Update all imports across codebase
- Run full integration tests

---

## Timeline Estimate

| Phase | Effort | Risk |
|-------|--------|------|
| Phase 1: FallbackService | 2 hours | Low |
| Phase 2: CacheManager | 1 hour | Low |
| Phase 3: InputProcessingService | 2 hours | Medium |
| Phase 4: CallInitService | 3 hours | Medium |
| Phase 5: ResponseOrchestrator | 4 hours | High |
| Phase 6: Final Cleanup | 2 hours | Low |

**Total:** ~14 hours of focused work

---

## Benefits After Refactor

1. **Testability:** Each service can be unit tested in isolation
2. **Readability:** Smaller files with single responsibility
3. **Maintainability:** Changes to greeting don't risk breaking response logic
4. **Team Scale:** Different developers can work on different services
5. **Debugging:** Easier to trace issues to specific component

---

## Rollback Plan

If refactor causes issues:
1. Keep old v2AIAgentRuntime.js as `v2AIAgentRuntime.legacy.js`
2. New services can import from legacy if needed
3. Feature flag to switch between old and new implementation

