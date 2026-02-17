# 📝 S4A CODE DIFF PREVIEW

**File:** `services/engine/FrontDeskCoreRuntime.js`  
**Changes:** 2 locations (imports + S4A layer insertion)  
**Lines Added:** ~160 lines  
**Lines Removed:** 0 lines (purely additive)  
**Complexity:** LOW (just wiring existing engines)

---

## 🔧 CHANGE 1: Add Imports (Top of File)

### Location: Line ~38-42 (after existing requires, before BlackBoxLogger)

```diff
  const { selectOpener, prependOpener } = require('./OpenerEngine');
  
  // Interceptors - modular pattern matchers
  const GreetingInterceptor = require('./interceptors/GreetingInterceptor');
  const EscalationDetector = require('./interceptors/EscalationDetector');
  const ConnectionQualityGate = require('./interceptors/ConnectionQualityGate');
  const CallReasonExtractor = require('./interceptors/CallReasonExtractor');
+ 
+ // S4A Triage/Scenario Layer - V116 fix
+ const ScenarioEngine = require('../ScenarioEngine');
  
  let BlackBoxLogger = null;
```

**Lines added:** 2  
**Impact:** Imports existing ScenarioEngine (already in your codebase)

---

## 🔧 CHANGE 2: Insert S4A Layer (see full implementation guide)

**Location:** Line ~645-650 (after S3, before existing discovery/booking if/else)

**Refer to:** `S4A_IMPLEMENTATION_USING_EXISTING_ENGINES.md` for complete code block

---

**END OF CODE DIFF PREVIEW**

*Full implementation details in: `S4A_IMPLEMENTATION_USING_EXISTING_ENGINES.md`*
