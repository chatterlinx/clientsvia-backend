# 🧠 THE BRAIN: Triage Engine Architecture

## CRITICAL CONCEPT: ONE BRAIN, NOT TWO

**THE BRAIN = The Triage Engine inside Frontline-Intel**

This is the ONLY decision-making brain for call routing. Everything before the 3-Tier system is handled by THE BRAIN.

---

## 📍 WHAT THE BRAIN DECIDES

The Triage Engine determines:

1. ✅ **What is the caller actually asking for?**
2. ✅ **What service type is it?** (REPAIR, MAINTENANCE, EMERGENCY, etc.)
3. ✅ **Should we send it to 3-Tier?**
4. ✅ **Should we explain something first?**
5. ✅ **Should we transfer the call?**
6. ✅ **Should we schedule directly?**
7. ✅ **Should we escalate to human?**
8. ✅ **Should we block spam?**

**Everything before 3-Tier is handled by THE BRAIN.**

---

## 🏗️ ARCHITECTURE: ONE BRAIN, MULTIPLE AUTHORING TOOLS

```
┌──────────────────────────────────────────────────────────┐
│  AUTHORING LAYER (Admin Tools)                          │
│  Multiple UIs = GOOD (different admin workflows)        │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  🛠️ Tool 1: Manual Triage Table                         │
│    • Quick add/edit rules                               │
│    • Direct table editing                               │
│    • Storage: cheatSheet.manualTriageRules[]            │
│                                                          │
│  🤖 Tool 2: AI Triage Builder                           │
│    • LLM-powered content generation                     │
│    • Full 4-part triage packages                        │
│    • Storage: TriageCards collection                    │
│                                                          │
│  📥 Tool 3: CSV Import (future)                         │
│    • Bulk rule import                                   │
│    • Storage: TriageCards collection                    │
│                                                          │
└──────────────────────────────────────────────────────────┘
                     ↓ COMPILE ↓
┌──────────────────────────────────────────────────────────┐
│  🧠 THE BRAIN (compiledTriageConfig)                    │
│  ONE unified decision table                             │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  triageRules[] = [                                      │
│    { keywords, action, priority, source: "MANUAL" },    │
│    { keywords, action, priority, source: "AI_CARD" },   │
│    { keywords, action, priority, source: "MANUAL" },    │
│    { keywords, action, priority, source: "SYSTEM" },    │
│    ... merged & sorted by priority ...                  │
│  ]                                                       │
│                                                          │
│  ⚙️ Sorting Logic:                                       │
│    1. Priority (1000 → 1, highest first)                │
│    2. Tie-breaker: MANUAL > AI_CARD > SYSTEM            │
│    3. Tie-breaker: Most recent updatedAt wins           │
│                                                          │
│  🛡️ Fallback Rule (priority: 0):                        │
│    serviceType: UNKNOWN                                 │
│    action: ESCALATE_TO_HUMAN                            │
│    source: SYSTEM                                       │
│                                                          │
└──────────────────────────────────────────────────────────┘
                     ↓ RUNTIME ↓
┌──────────────────────────────────────────────────────────┐
│  📞 FRONTLINE-INTEL (Step 4 in Call Flow)               │
│  Contains THE BRAIN                                     │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  1. Load compiledTriageConfig (from Redis/memory)       │
│  2. Loop through triageRules[] in order                 │
│  3. First match wins (keyword matching)                 │
│  4. Set: serviceType, action, categorySlug              │
│  5. Execute action:                                     │
│     • DIRECT_TO_3TIER → invoke 3-Tier immediately       │
│     • EXPLAIN_AND_PUSH → talk, then 3-Tier if agreed    │
│     • ESCALATE_TO_HUMAN → transfer to human             │
│     • TAKE_MESSAGE → no 3-Tier, just take message       │
│     • END_CALL_POLITE → no 3-Tier, end call            │
│                                                          │
│  📝 Logs for every call:                                │
│    - Which rule fired (source, priority)                │
│    - Keywords that matched                              │
│    - Resulting serviceType, action, categorySlug        │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

## 🔄 CALL FLOW SEQUENCE

**The triage logic is NOT a separate step - it's built INTO Frontline-Intel.**

```
┌─────────────────────────────────────────────────────────┐
│  1. Spam Filter                                         │
│     → Block known spam patterns                         │
└─────────────────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│  2. Edge Case Detection                                 │
│     → Handle special cases (emergencies, VIPs, etc.)    │
└─────────────────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│  3. Transfer Rules                                      │
│     → Check if immediate transfer needed                │
└─────────────────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│  4. 🧠 FRONTLINE-INTEL (THE BRAIN)                      │
│     ├─ Listen to caller                                 │
│     ├─ Extract intent                                   │
│     ├─ Load compiledTriageConfig                        │
│     ├─ Match keywords → first match wins                │
│     ├─ Set serviceType, action, categorySlug            │
│     └─ Execute action:                                  │
│        • DIRECT_TO_3TIER → continue to step 5           │
│        • EXPLAIN_AND_PUSH → talk, then step 5 if agreed │
│        • ESCALATE/TAKE_MESSAGE/END_CALL → stop here     │
└─────────────────────────────────────────────────────────┘
                     ↓ (only if action says so)
┌─────────────────────────────────────────────────────────┐
│  5. Scenario Matching (3-Tier Intelligence)             │
│     → Rule-based → Semantic → LLM                       │
└─────────────────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│  6. Guardrails                                          │
│     → Ensure compliant, on-brand responses              │
└─────────────────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│  7. Behavior Polish                                     │
│     → Human-like tone, empathy, professionalism         │
└─────────────────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│  8. Context Injection                                   │
│     → Insert variables, customer data, final formatting │
└─────────────────────────────────────────────────────────┘
```

---

## ⚙️ COMPILATION LOGIC

### When does THE BRAIN rebuild?

The `compiledTriageConfig` is rebuilt when:

1. ✅ Admin saves/updates a **TriageCard** (AI-generated)
2. ✅ Admin saves/updates **Manual Triage Rules**
3. ✅ Admin activates/deactivates a card
4. ✅ Admin deletes a card
5. ✅ Cache expires (TTL: 1 hour)

### Cache Invalidation

When any triage rule changes (manual or AI card), the system:

1. Saves changes to MongoDB (source of truth)
2. Invalidates Redis cache: `triage:compiled:{companyId}`
3. On next call, THE BRAIN recompiles from scratch

### Compilation Steps

```javascript
// services/TriageCardService.js → compileActiveCards()

1. Fetch all ACTIVE TriageCards (AI-generated)
2. Fetch all manualTriageRules[] from company settings
3. Extract all rules into ONE flat array
4. Add SYSTEM fallback rule (priority: 0)
5. Sort by:
   - Priority (highest first)
   - Tie-breaker: MANUAL > AI_CARD > SYSTEM
   - Tie-breaker: Most recent updatedAt
6. Cache in Redis (TTL: 1 hour)
7. Return compiled config
```

---

## 🎯 RUNTIME MATCHING LOGIC

### Keyword Matching

```javascript
// Simplified matching logic (actual implementation in Frontline-Intel)

function matchRule(callerInput, rule) {
  const input = callerInput.toLowerCase();
  
  // 1. Must contain ALL keywords
  const hasAllKeywords = rule.keywords.every(kw => 
    input.includes(kw.toLowerCase())
  );
  
  if (!hasAllKeywords) return false;
  
  // 2. Must NOT contain any excludeKeywords
  const hasExcluded = rule.excludeKeywords.some(kw => 
    input.includes(kw.toLowerCase())
  );
  
  if (hasExcluded) return false;
  
  // Match!
  return true;
}

// Loop through compiledConfig.triageRules[]
for (const rule of compiledConfig.triageRules) {
  if (matchRule(callerInput, rule)) {
    // FIRST MATCH WINS
    callContext.serviceType = rule.serviceType;
    callContext.action = rule.action;
    callContext.categorySlug = rule.categorySlug;
    
    // LOG THE DECISION
    logger.info('[THE BRAIN] Rule matched', {
      source: rule.source,
      priority: rule.priority,
      keywords: rule.keywords,
      serviceType: rule.serviceType,
      action: rule.action,
      categorySlug: rule.categorySlug
    });
    
    break; // Stop at first match
  }
}

// If no match, fallback rule catches it
```

### Action Execution

```javascript
switch (callContext.action) {
  case 'DIRECT_TO_3TIER':
    // Immediately invoke 3-Tier Scenario Matching
    return invoke3TierScenarioMatching(callContext);
  
  case 'EXPLAIN_AND_PUSH':
    // Talk to caller first, explain the situation
    await explainToCallerAndAskConfirmation(callContext);
    if (callerAgreed) {
      return invoke3TierScenarioMatching(callContext);
    }
    break;
  
  case 'ESCALATE_TO_HUMAN':
    // Transfer to human agent, no 3-Tier
    return transferToHuman(callContext);
  
  case 'TAKE_MESSAGE':
    // Take a message, no 3-Tier
    return takeMessage(callContext);
  
  case 'END_CALL_POLITE':
    // Politely end call, no 3-Tier
    return endCallPolitely(callContext);
}
```

---

## 🛠️ ADMIN WORKFLOW EXAMPLES

### Example 1: Quick Manual Rule

**Scenario:** Admin wants to prevent "AC not cooling" + "maintenance" downgrade.

```
1. Open company profile → Cheat Sheet tab
2. Scroll to "Manual Triage Table"
3. Click "Add Rule"
4. Fill in:
   - Keywords: "not cooling"
   - Exclude Keywords: "maintenance", "$89", "tune-up"
   - Service Type: REPAIR
   - Action: EXPLAIN_AND_PUSH
   - Explanation: "Prevent downgrade when AC broken"
   - QnA Card: "ac-not-cooling-repair"
   - Priority: 500
5. Click "Save Rules"
6. Cache invalidated automatically
7. Next call: THE BRAIN uses new rule
```

### Example 2: AI-Generated Triage Package

**Scenario:** Admin wants full HVAC repair triage content.

```
1. Open company profile → Cheat Sheet tab
2. Scroll to "AI Triage Builder"
3. Fill in:
   - Trade: HVAC
   - Situation: "Customer reports AC not cooling"
   - Service Types: REPAIR, EMERGENCY
4. Click "Generate"
5. Review 4-part output:
   - Frontline-Intel block
   - Triage Map (structured rules)
   - Response Library (10+ variations)
   - Category + Scenario Seeds
6. Click "Save as Triage Card"
7. Cache invalidated automatically
8. Next call: THE BRAIN uses new card rules
```

### Example 3: Viewing THE BRAIN

**Scenario:** Admin wants to see the final compiled triage table.

```
1. Open developer console
2. Call API:
   GET /api/company/{companyId}/triage-cards/compiled/config
3. Response shows:
   - All rules merged (manual + AI cards)
   - Sorted by priority
   - Fallback rule at bottom
   - Response pools, category map, etc.
```

---

## 📊 DATA FLOW

```
┌───────────────────────────────────────────────────────────┐
│  MONGODB (Source of Truth)                               │
├───────────────────────────────────────────────────────────┤
│  • companies.aiAgentSettings.cheatSheet.manualTriageRules │
│  • triageCards (collection)                               │
└───────────────────────────────────────────────────────────┘
                     ↓ COMPILE ↓
┌───────────────────────────────────────────────────────────┐
│  REDIS (High-Speed Cache)                                 │
├───────────────────────────────────────────────────────────┤
│  Key: triage:compiled:{companyId}                         │
│  TTL: 1 hour                                              │
│  Value: { triageRules[], responsePools, categoryMap }     │
└───────────────────────────────────────────────────────────┘
                     ↓ RUNTIME ↓
┌───────────────────────────────────────────────────────────┐
│  FRONTLINE-INTEL (Live Call Processing)                   │
├───────────────────────────────────────────────────────────┤
│  • Load from Redis (fast)                                 │
│  • Fallback to MongoDB if cache miss                      │
│  • Match keywords → execute action                        │
│  • Log decision                                           │
└───────────────────────────────────────────────────────────┘
```

---

## 🔒 CRITICAL RULES

### ✅ DO THIS

1. **Always compile manual + AI cards into ONE list**
2. **First match wins (by priority + tie-breakers)**
3. **Always have a fallback rule (priority: 0)**
4. **Invalidate cache when ANY rule changes**
5. **Log which rule fired on every call**
6. **3-Tier is only invoked if action says so**

### ❌ NEVER DO THIS

1. ❌ Check manual rules separately from AI cards at runtime
2. ❌ Have TWO separate "brains" or decision loops
3. ❌ Let calls fall through with undefined behavior
4. ❌ Skip cache invalidation when rules change
5. ❌ Send every call to 3-Tier (respect action field)
6. ❌ Add "Triage Table" as a separate call flow step

---

## 📝 LOGGING EXAMPLE

```javascript
// Every call logs the triage decision
{
  timestamp: "2025-11-15T10:30:45Z",
  companyId: "68e3f77a9d623b8058c700c4",
  callId: "call-12345",
  triageDecision: {
    ruleMatched: {
      source: "MANUAL",
      priority: 500,
      keywords: ["not cooling"],
      excludeKeywords: ["maintenance", "$89"],
      serviceType: "REPAIR",
      action: "EXPLAIN_AND_PUSH",
      categorySlug: "ac-not-cooling-repair",
      explanation: "Prevent downgrade when AC broken"
    },
    callerInput: "my ac is not cooling at all",
    matchedAt: "2025-11-15T10:30:45.123Z"
  }
}
```

---

## 🚀 DEPLOYMENT CHECKLIST

- [x] Merge manual rules + AI cards in `compileActiveCards()`
- [x] Implement tie-breaker logic (priority → source → updatedAt)
- [x] Add SYSTEM fallback rule (priority: 0)
- [x] Add cache invalidation endpoint
- [x] Update frontend to invalidate cache on save
- [x] Log triage decisions in production
- [x] Document THE BRAIN architecture
- [ ] Wire Frontline-Intel to use compiled config at runtime
- [ ] Add tracing/monitoring dashboard for triage decisions
- [ ] Train support team on manual triage table

---

## 📚 RELATED FILES

- **Service:** `/services/TriageCardService.js` (compilation logic)
- **Model:** `/models/TriageCard.js` (schema)
- **Routes:** `/routes/company/triageCards.js` (API endpoints)
- **Frontend:** `/public/js/ai-agent-settings/CheatSheetManager.js` (UI)
- **Schema:** `/models/v2Company.js` (manualTriageRules storage)

---

## 🎓 KEY TAKEAWAY

> **THE BRAIN = Triage Engine inside Frontline-Intel**
> 
> - ONE unified decision table (manual + AI cards + fallback)
> - First match wins (by priority + tie-breakers)
> - Frontline controls ALL routing before 3-Tier
> - 3-Tier is only invoked when action says so
> - No separate "triage step" in call flow
> - Cache invalidates on every rule change

**Everything before 3-Tier is handled by THE BRAIN.**

---

*Last Updated: 2025-11-15*
*Version: 1.0 (ONE BRAIN Architecture)*

