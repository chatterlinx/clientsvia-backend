# 🏗️ RESPONSE ENGINE - DESIGN DECISIONS
**Date:** November 10, 2025  
**Status:** Architected, Pre-Implementation  
**Owner:** Engineering Discussion (Not Code Yet)  
**Purpose:** Document exact design decisions before coding

---

## 1. `scenarioType` - Required Logically, Optional Technically

### Decision
- **New scenarios**: `scenarioType` is **required** in UI dropdown
- **Existing scenarios**: Auto-infer via migration, then manual cleanup over time
- **Location**: Lives on scenario in template (GlobalInstantResponseTemplate), NOT per-company
- **Rationale**: "Hours of Operation" is always the same TYPE regardless of which company uses it

### Implementation Pattern
```javascript
// NEW scenarios
scenarioType: "INFO_FAQ"  // REQUIRED when creating

// EXISTING scenarios (migration)
if (scenario.fullReplies.length > 0) {
  // Likely INFO_FAQ - has real answer content
  inferredType = "INFO_FAQ";
} else if (scenario.quickReplies.length > 0 && !scenario.fullReplies.length) {
  // Likely SYSTEM_ACK or SMALL_TALK - just acknowledgment
  inferredType = "SYSTEM_ACK";
}
```

### UI Implementation
- Simple **dropdown** in scenario editor:
  - INFO_FAQ
  - ACTION_FLOW
  - SYSTEM_ACK
  - SMALL_TALK
- No AI magic; admin just says "What role does this play?"

### Why This Works
- ✅ Existing scenarios don't break
- ✅ New scenarios follow discipline
- ✅ Admins understand the choice
- ✅ Engine can always assume type exists

---

## 2. Global Rules + Per-Scenario Overrides

### Decision
- **Global rules are ironclad defaults** for enterprise predictability
- **Per-scenario override is explicit and auditable** via `replyStrategy` field
- **No hidden company-level weirdness** (keeps multi-tenant clean)

### Rule Matrix (Global Defaults)

| scenarioType | Voice Strategy | SMS Strategy | Chat Strategy |
|--------------|---|---|---|
| INFO_FAQ | full-with-optional-quickening | full-concise | full-formatted |
| ACTION_FLOW | quick-then-flow | quick-plus-cta | quick-then-flow |
| SYSTEM_ACK | quick-only | quick-only | quick-only |
| SMALL_TALK | quick-only | quick-only | quick-only |

### Per-Scenario Override: `replyStrategy` Field

Allowed values:
```javascript
replyStrategy: {
  type: String,
  enum: [
    'AUTO',           // Follow global rules (default)
    'FULL_ONLY',      // Never use quick replies
    'QUICK_ONLY',     // Never use full replies
    'QUICK_THEN_FULL', // Quick first, then full
    'LLM_WRAP',       // Use LLM to enhance response
    'LLM_CONTEXT'     // Use LLM with conversation context
  ],
  default: 'AUTO'
}
```

### Engine Logic
```javascript
ResponseEngine.selectReply({ scenario, channel, context }) {
  const scenarioType = scenario.scenarioType;
  const replyStrategy = scenario.replyStrategy || 'AUTO';
  
  if (replyStrategy === 'AUTO') {
    // Apply global rule matrix
    const rule = GLOBAL_RULES[scenarioType][channel];
    return applyRule(scenario, rule, context);
  } else {
    // Apply explicit override
    return applyOverride(scenario, replyStrategy, context);
  }
}
```

### Why This Works
- ✅ 99% of scenarios work with global rules (predictable)
- ✅ 1% of edge cases have escape hatch (powerful)
- ✅ Admins can see exactly what rule is being applied
- ✅ No hidden behavior or magic

---

## 3. Response Engine - Separate Layer After 3-Tier Router

### Decision
- **Response Engine is NOT inside tiers**
- **Tiers answer ONLY**: "Which scenario? With what confidence?"
- **Response Engine answers ONLY**: "How to present this scenario on this channel?"
- **Clean separation of concerns**

### Architecture Flow
```
User Input
    ↓
IntelligentRouter (3-tier cascade)
├─ Tier 1: Rule-based match
├─ Tier 2: Semantic match
└─ Tier 3: LLM fallback
    ↓
OUTPUT: { scenarioId, scenario, confidence, tierUsed }
    ↓
ResponseEngine.selectReply()
├─ Check scenario.scenarioType
├─ Check scenario.replyStrategy
├─ Look up global rule OR override
├─ Build reply (quick/full/LLM-wrapped)
└─ Replace placeholders
    ↓
OUTPUT: { selectedReply, strategy, metadata }
    ↓
Twilio / ElevenLabs / User
```

### Why This Matters
- ✅ Each layer has ONE job, not two
- ✅ If reply selection breaks, it's not a tier problem
- ✅ Can change reply rules without touching router logic
- ✅ Tier outputs are pure (just scenario data), not pre-rendered text
- ✅ Debuggable: "Which tier was used?" vs "What rule was applied?"

### What Tiers DON'T Do
```javascript
// ❌ WRONG - Don't put this in tiers
tier1Result = {
  scenario: { name: "Hours", quickReplies: [...], fullReplies: [...] },
  selectedText: "We're here to help!"  // ❌ Tier shouldn't pick this
}

// ✅ RIGHT - Tiers only return scenario data
tier1Result = {
  scenario: { name: "Hours", scenarioType: "INFO_FAQ", quickReplies: [...], fullReplies: [...] },
  confidence: 0.82,
  // Tiers don't pick text; that's Response Engine's job
}
```

---

## 4. LLM in Two Separate Roles

### Decision
- **Tier 3 LLM**: Scenario selection + pattern learning (already exists)
- **Response Engine LLM** (optional): Style wrapping + context awareness (new, optional, gated)
- **Keep them separate so cost and behavior are controllable**

### Tier 3 LLM (Existing - Stays as-is)

**Purpose**: "Which scenario should we use?"

**When it runs**: Tier 1 + Tier 2 fail (low confidence)

**Input**:
- User's exact words
- List of available scenarios (names, triggers, summaries)

**Output**:
- Recommended scenario ID + confidence
- Extracted patterns (new synonyms, triggers) for Tier 1 learning

**Cost**: ~$0.0015/call (Tier 3 fallback, rare)

**Control**: Already has thresholds & cache

---

### Response Engine LLM (Optional - New)

**Purpose**: Polish and adapt a STRUCTURED answer without inventing facts

**When it runs**: Only if `replyStrategy` = 'LLM_WRAP' or 'LLM_CONTEXT'

**Input**:
- Selected scenario's full reply (or structured data like hours, address)
- Brief instruction: "Rephrase naturally, keep all facts, sound like a friendly receptionist"
- Optional: conversation context, user sentiment

**Output**:
- Final text to speak/send
- Same facts, better phrasing

**Example**:
```
Input structured data:
  hours: "Monday-Friday 8am-6pm, Saturday 9am-3pm, Closed Sunday"
  context: "User sounds impatient"

LLM instruction:
  "Rephrase these hours clearly and concisely for an impatient caller.
   Keep all facts. Sound helpful and efficient."

Output:
  "Quick rundown: We're open weekdays 8 to 6, Saturday 9 to 3, and closed Sundays."
```

**Cost**: Per-call fee, so must be:
- Opt-in per scenario
- Gated behind admin toggle per company
- With daily/monthly budget limits

**Control**: 
- Flag per company: `enableResponseLLMWrapping`
- Max cost per call + daily budget shown in Global Brain UI
- Can be disabled instantly if cost spirals

---

### Critical Principle
```
LLM must ENHANCE content, NEVER CREATE IT.

✅ RIGHT: "Make this readable for SMS (under 160 chars)"
❌ WRONG: "Generate hours for this business"

✅ RIGHT: "Rephrase this policy professionally"
❌ WRONG: "What's a good return policy?"

✅ RIGHT: "Add empathy because user is frustrated"
❌ WRONG: "Suggest a discount offer"
```

---

## 5. Phased Rollout to Production

### Phase 1 - Immediate (This Week)
**Scope**: Quick global fix for VOICE channel only  
**Risk**: Low (no schema changes, backward compatible)  
**Goal**: Kill "We're here to help!" stupidity NOW

**Implementation**:
```javascript
// For voice channel, if scenario has fullReplies, always include them
if (channel === 'voice' && scenario.fullReplies.length > 0) {
  reply = buildFullWithQuickening(scenario);  // quick + full
} else {
  reply = buildQuickOnly(scenario);
}
```

**No `scenarioType` needed yet** - just a hardcoded channel behavior

**Benefits**:
- ✅ Hours, pricing, services all work better immediately
- ✅ Existing templates not touched
- ✅ Can revert in seconds if something breaks
- ✅ Gives you breathing room to test Response Engine

---

### Phase 2 - Add Response Engine Infrastructure (Weeks 2-3)
**Scope**: Schema changes, Response Engine service, feature flag  
**Risk**: Medium (schema changes, but behind flag)  
**Goal**: Clean foundation for reply selection

**Implementation**:
1. Add `scenarioType` + `replyStrategy` to GlobalInstantResponseTemplate schema
2. Create ResponseEngine service with global rule matrix
3. Run migration script to infer types on existing scenarios
4. Add feature flag: `useNewResponseEngine` (default: OFF)
5. Wire into AIBrain3tierllm (behind flag)

**Rollout**:
- Turn ON for Penguin Air first (your test company)
- Verify logs, behavior, no regressions
- Turn ON for 2-3 friendly beta clients
- If all good, turn ON for everyone (flag default: ON)
- If issues, easy rollback (flag: OFF)

**Admin UI changes**:
- Scenario editor gets `scenarioType` dropdown
- Scenario editor gets `replyStrategy` dropdown (advanced)
- Show: "This scenario uses [voice: full-with-optional-quickening]" hint

---

### Phase 3 - Optional LLM Wrapping (Weeks 4+)
**Scope**: LLM response enhancement layer  
**Risk**: High (cost impact if not controlled)  
**Goal**: Polished, contextual responses for premium clients

**Implementation**:
1. Add `responseSource` enum to scenario (LLM_WRAP, LLM_CONTEXT, etc.)
2. Add global admin toggle: `enableResponseLLMWrapping` (default: OFF)
3. Implement Response Engine LLM-wrap path
4. Add cost tracking: daily budget, per-call max, alerts

**Rollout**:
- Start with OFF for everyone
- Document cost implications clearly
- Roll out to ONE company that specifically requests it
- Monitor: cost/call, quality improvement, user feedback
- Scale if costs are acceptable

**Safety Limits** (per company):
```javascript
llmConfig: {
  enabled: false,           // OFF by default
  maxPerCall: 0.01,        // $0.01 max per wrapped response
  dailyBudget: 10.00,      // $10/day max spend
  alertThreshold: 0.80,    // Alert admin at 80% of budget
  scenarios: [],           // Which scenarios can use LLM
}
```

---

## 6. Summary Table - Design Decisions

| Decision | Approach | Why |
|----------|----------|-----|
| scenarioType | Required new, auto-inferred old | Backward compat + forward discipline |
| Location | Template (not company) | Multi-tenant consistency |
| UI | Dropdown | Simple, understandable |
| Global rules | Ironclad defaults | Predictable behavior |
| Overrides | Per-scenario `replyStrategy` | Enterprise control |
| Response Engine | Separate layer after tiers | Clean architecture |
| Tier changes | None | Tiers stay pure |
| LLM roles | Tier 3 (select) + optional wrap (style) | Separate concerns, cost control |
| LLM input | Never invent, only polish | Data integrity |
| Rollout | Phase 1 (quick fix) → 2 (engine) → 3 (optional LLM) | Risk-managed, observable |

---

## 7. What This Achieves

### Immediate (Phase 1)
- ✅ Hours, pricing, services respond correctly on voice
- ✅ "We're here to help!" loop eliminated
- ✅ No schema or code changes to tiers

### Short Term (Phase 2)
- ✅ Clean architectural separation (tiers vs. response)
- ✅ Admins can see and control reply strategy
- ✅ New scenarios follow correct behavior automatically
- ✅ Foundation for future enhancements

### Medium Term (Phase 3)
- ✅ Optional LLM polish for premium experience
- ✅ Cost fully controlled and visible
- ✅ Sentiment detection, context awareness, multi-intent (all optional layers on top)

### Long Term
- ✅ Truly intelligent agent that:
  - Selects right scenario (3-tier system)
  - Presents it right (Response Engine)
  - Polishes tone (optional LLM wrap)
  - Remembers context (optional history layer)
  - Detects sentiment (optional sentiment layer)
- ✅ All configurable, all cost-controlled, all optional

---

## Next Steps (When Ready)

1. ✅ **Design approved** (this document)
2. ⏳ **Code Phase 1** (quick voice fix)
3. ⏳ **Code Phase 2** (Response Engine + feature flag)
4. ⏳ **Code Phase 3** (optional LLM wrap)
5. ⏳ **Test & observe with Penguin Air**
6. ⏳ **Roll out in phases**

---

**Status: Design locked. Ready for implementation when you give the signal.**

