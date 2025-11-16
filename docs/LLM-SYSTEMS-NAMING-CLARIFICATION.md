# LLM SYSTEMS - NAMING CLARIFICATION
**Date:** November 16, 2025  
**Status:** OFFICIAL NAMING STANDARD  
**Purpose:** Prevent confusion between two different LLM intelligence systems

---

## ⚠️ **CRITICAL: TWO SEPARATE SYSTEMS**

ClientsVia has **TWO completely different LLM intelligence systems** with similar-sounding names.  
**They serve different purposes and must never be confused.**

---

## 🧠 **SYSTEM 1: LLM Learning Console (3-Tier)**

### **What it does:**
- Analyzes **Tier 3 LLM calls** from the 3-Tier knowledge engine
- Suggests promoting successful Tier 3 responses → Tier 1 rules or KB entries
- **Goal:** Reduce expensive Tier 3 usage by improving Tier 1/2

### **Location:**
- **UI:** `public/admin-llm-learning-console-v2.html` (standalone page)
- **Routes:** `routes/admin/llmLearningV2.js`
  - `/api/admin/llm-learning/v2/overview`
  - `/api/admin/llm-learning/v2/suggestions`
  - `/api/admin/llm-learning/v2/tasks`
- **Models:** `ProductionLLMSuggestion`, `AIGatewaySuggestion`
- **Services:** `services/LlmLearningLogger.js`

### **Key Features:**
- Suggestion cards from Tier 3 calls
- Approve/Reject/Snooze workflow
- ROI savings tracking
- Tier 3 reduction percentage
- Cost analysis

### **Data Flow:**
```
Tier 3 LLM Call
    ↓
IntelligentRouter logs suggestion
    ↓
LlmLearningLogger.logSuggestion()
    ↓
ProductionLLMSuggestion (MongoDB)
    ↓
LLM Learning Console UI
    ↓
Admin approves → Upgrades to Tier 1 rule
```

### **Purpose:**
**Self-improvement:** Learn from expensive calls to make the system cheaper over time.

---

## 🎛️ **SYSTEM 2: LLM-0 Cortex-Intel (Orchestrator Analytics)**

### **What it does:**
- Analyzes **LLM-0 Orchestrator** decision patterns
- Shows guardrail triggers, booking funnels, conversation quality
- Provides optimization recommendations for LLM-0 performance
- **Goal:** Optimize orchestrator behavior and improve customer experience

### **Location:**
- **UI:** `public/control-plane-v2.html` (AiCore tab #11)
- **Routes:** TBD - `/api/company/:id/llm0-cortex/*`
- **Data Sources:**
  - `CallTrace` (orchestrator decisions)
  - `UsageRecord` (LLM-0 costs)
  - `orchestrationEngine.js` logs

### **Key Features:**
- Decision distribution charts (ask_question, answer_with_knowledge, etc.)
- Guardrail event timeline
- Booking conversion funnel
- Conversation quality metrics
- Optimization suggestions

### **Data Flow:**
```
LLM-0 Orchestrator makes decision
    ↓
Logs decision in FrontlineContext
    ↓
finalizeCallTrace() → CallTrace (MongoDB)
    ↓
LLM-0 Cortex-Intel aggregates data
    ↓
Shows patterns, trends, optimization suggestions
```

### **Purpose:**
**Performance optimization:** Help admin/developer tune LLM-0 for better conversations and higher booking rates.

---

## 📊 **SIDE-BY-SIDE COMPARISON**

| Feature | LLM Learning Console (3-Tier) | LLM-0 Cortex-Intel |
|---------|-------------------------------|-------------------|
| **Analyzes** | Tier 3 LLM responses | LLM-0 orchestrator decisions |
| **Goal** | Reduce Tier 3 usage → Save cost | Optimize LLM-0 behavior → Better CX |
| **Input** | IntelligentRouter Tier 3 calls | orchestrationEngine decisions |
| **Output** | Suggestions to upgrade Tier 1 | Decision patterns + optimization tips |
| **Workflow** | Approve/Reject suggestions | Read-only analytics |
| **UI Location** | Standalone admin page | Control Plane AiCore tab #11 |
| **Routes** | `/api/admin/llm-learning/v2/*` | `/api/company/:id/llm0-cortex/*` |
| **Existing?** | ✅ YES - fully built | ❌ NO - to be built |

---

## 🎯 **NAMING RULES (OFFICIAL)**

### **ALWAYS use these exact names:**

1. **"LLM Learning Console"** → 3-Tier suggestions system
2. **"LLM-0 Cortex-Intel"** → Orchestrator analytics

### **NEVER:**
- ❌ Use "LLM Learning Console" for orchestrator analytics
- ❌ Use "Cortex-Intel" for 3-Tier suggestions
- ❌ Shorten to "LLM Console" (ambiguous)

### **When in doubt:**
- **Learning = 3-Tier** (learning from Tier 3 to improve Tier 1)
- **Cortex = LLM-0** (analyzing orchestrator "brain" decisions)

---

## 📁 **FILE REFERENCES**

### **LLM Learning Console (3-Tier):**
```
routes/admin/llmLearningV2.js
routes/admin/llmLearningConsoleV2UI.js
public/admin-llm-learning-console-v2.html
services/LlmLearningLogger.js
services/IntelligentRouter.js (logs suggestions)
models/ProductionLLMSuggestion.js
models/aiGateway/Suggestion.js
PHASE-C0-LLM-LEARNING-CONSOLE-V2-TIER3-INTEGRATION.md
LLM-LEARNING-V2-TESTING-GUIDE.md
```

### **LLM-0 Cortex-Intel:**
```
public/control-plane-v2.html (tab definition)
CONTROL-PLANE-COMPLETE-SPEC.md (section 14)
src/services/orchestrationEngine.js (data source)
models/CallTrace.js (stores decisions)
models/UsageRecord.js (stores costs)
[Routes to be built: /api/company/:id/llm0-cortex/*]
```

---

## 🚨 **DEVELOPER CHECKLIST**

Before adding ANY new feature related to LLM intelligence:

- [ ] Which system does this belong to?
  - [ ] 3-Tier suggestions → "LLM Learning Console"
  - [ ] LLM-0 orchestrator → "LLM-0 Cortex-Intel"
- [ ] Am I using the correct name?
- [ ] Am I adding code to the correct file/route?
- [ ] Will this naming confuse anyone?

---

## 📝 **COMMIT HISTORY**

**2025-11-16:** `d15ad999` - Renamed duplicate "LLM Learning Console" → "LLM-0 Cortex-Intel" in Control Plane to prevent confusion.

---

**BOTTOM LINE:**

- **LLM Learning Console** = Learn from Tier 3 calls → Upgrade Tier 1 (cost savings)
- **LLM-0 Cortex-Intel** = Analyze LLM-0 orchestrator → Optimize behavior (better CX)

**THEY ARE COMPLETELY DIFFERENT. ALWAYS USE CORRECT NAMES.**

