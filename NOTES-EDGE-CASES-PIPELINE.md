# 🔴 EDGE CASES ENTERPRISE AUDIT & UPGRADE PLAN

**Date**: November 27, 2025  
**Status**: Phase 1 Complete - Current State Documented  
**Next**: Phase 2 - Enterprise Schema Upgrade

---

## 📋 PHASE 1: CURRENT STATE AUDIT

### ✅ DATA PIPELINE (END-TO-END CONFIRMED)

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. UI TAB                                                            │
│    File: public/control-plane-v2.html                              │
│    Tab: data-cheat-target="edge-cases"                             │
│    Manager: CheatSheetManager.js                                    │
│    Method: renderEdgeCases() (line 1672)                           │
└──────────────────────┬──────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 2. UI UPDATES (In-Memory)                                           │
│    Methods:                                                          │
│    - addEdgeCase() (line 6820)                                     │
│    - updateEdgeCase(index, field, value) (line 6853)               │
│    - removeEdgeCase(index) (line 6860)                             │
│    Updates: this.cheatSheet.edgeCases[]                            │
│    Triggers: this.markDirty()                                       │
└──────────────────────┬──────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 3. SAVE TO MONGODB (Version System)                                │
│    Collection: CheatSheetVersion                                    │
│    Field: config.edgeCases[]                                        │
│    Status: One version marked status='live'                         │
│    Pointer: Company.aiAgentSettings.cheatSheetMeta.liveVersionId   │
└──────────────────────┬──────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 4. REDIS CACHE (Runtime Optimization)                              │
│    Service: CheatSheetRuntimeService                                │
│    Method: getRuntimeConfig(companyId)                              │
│    Cache Key: cheatsheet:live:${companyId}                         │
│    TTL: 1 hour (invalidated on push-live)                          │
│    Loads: CheatSheetVersion where status='live'                    │
│    Returns: Full config object (including edgeCases[])             │
└──────────────────────┬──────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 5. RUNTIME APPLICATION (Live Calls)                                │
│    Service: CheatSheetEngine                                        │
│    Method: apply(baseResponse, userInput, context, policy)         │
│    File: services/CheatSheetEngine.js                              │
│    Lines: 40-760                                                    │
└──────────────────────┬──────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 6. EDGE CASE DETECTION                                             │
│    Method: detectEdgeCase(input, edgeCases) (line 326)            │
│    Logic:                                                           │
│    - Loops through edgeCases[] (already sorted by priority)        │
│    - Tests each pattern (RegExp) against lowercase input           │
│    - Returns FIRST match (highest priority wins)                   │
│    - Returns null if no match                                       │
└──────────────────────┬──────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 7. SHORT-CIRCUIT (If Edge Case Matches)                            │
│    Line: 64 in CheatSheetEngine.apply()                            │
│    Behavior:                                                        │
│    - Uses edge case response (not base response)                   │
│    - Applies variable replacement                                  │
│    - Logs edge case ID/name                                        │
│    - Triggers auto-blacklist check (async, non-blocking)           │
│    - RETURNS IMMEDIATELY (skips transfer/behavior/guardrails)      │
└──────────────────────┬──────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 8. LOGS & OBSERVABILITY                                            │
│    [CHEAT SHEET ENGINE] Edge case triggered (short-circuit)        │
│    Fields: companyId, callId, edgeCaseId, edgeCaseName, timeMs    │
│    Line: 80 in CheatSheetEngine.js                                 │
│    Also: appliedBlocks[] includes { type: 'EDGE_CASE', id, name } │
└─────────────────────────────────────────────────────────────────────┘
```

---

## ✅ PRECEDENCE VERIFICATION (CONFIRMED)

**File**: `services/CheatSheetEngine.js`  
**Comment Added**: Line 37 (already in code)

```javascript
// PRECEDENCE: EdgeCase → Transfer → Guardrails → Behavior (STRICT ORDER)
```

**Code Structure** (lines 57-62):
```javascript
// ────────────────────────────────────────────────────────────────
// PRECEDENCE STEP 1: EDGE CASES (Highest Priority)
// ────────────────────────────────────────────────────────────────
// Check for unusual caller inputs (machine detection, system delays)
// If matched → RETURN IMMEDIATELY (short-circuit all other rules)

const edgeCase = this.detectEdgeCase(userInput, deserializedPolicy.edgeCases);

if (edgeCase) {
  // ... apply edge case ...
  return {  // ← RETURNS IMMEDIATELY (short-circuit confirmed)
    response: response,
    appliedBlocks: appliedBlocks,
    action: 'RESPOND',
    timeMs: elapsed,
    shortCircuit: true  // ← Explicit flag
  };
}

// Only reached if NO edge case matched
// Step 2: Transfer Rules (line 157+)
// Step 3: Guardrails (line 230+)
// Step 4: Behavior Polish (line 330+)
```

**✅ CONFIRMED**: Edge Cases have highest precedence and short-circuit all other rules.

---

## 📊 CURRENT SCHEMA (AS-IS)

**Location**: `CheatSheetVersion.config.edgeCases[]`  
**Type**: Array of Objects

**Current Fields** (from UI, line 1676-1748):
```javascript
{
  name: String,              // "Machine Detection"
  priority: Number,          // 10 (1-100, lower = higher priority)
  enabled: Boolean,          // true/false
  triggerPatterns: [String], // ["machine", "robot", "ai"]
  responseText: String       // "I'm a real person here to help!"
}
```

**Limitations of Current Schema**:
1. ❌ No stable `id` field (array index used instead - breaks on reorder)
2. ❌ No `description` field (what is this protecting?)
3. ❌ Only keyword matching (no regex patterns, no caller type, no time windows)
4. ❌ No action types (only response override, no transfer/hangup/flag-only)
5. ❌ No side effects (auto-blacklist exists but not configurable per edge case)
6. ❌ No audit metadata (createdBy, createdAt, updatedBy, updatedAt)
7. ❌ triggerPatterns stored as strings, converted to RegExp in PolicyCompiler

---

## 🎯 ENTERPRISE TARGET SCHEMA

**Proposed Schema** (backward-compatible upgrade):
```javascript
{
  // ═══════════════════════════════════════════════════════════════
  // IDENTITY
  // ═══════════════════════════════════════════════════════════════
  id: String,              // "ec-abuse-detection-001" (stable ID for logs)
  name: String,            // "Abuse Detection" (human-readable)
  description: String,     // "Detects profanity and abusive language, hangs up politely"
  
  // ═══════════════════════════════════════════════════════════════
  // CONTROL FLAGS
  // ═══════════════════════════════════════════════════════════════
  enabled: Boolean,        // true/false (master switch)
  priority: Number,        // 1-100 (1 = highest, already sorted before matching)
  
  // ═══════════════════════════════════════════════════════════════
  // MATCHING CONDITIONS (ALL must be true to trigger)
  // ═══════════════════════════════════════════════════════════════
  match: {
    // Keywords (legacy, keep for backward compat)
    keywordsAny: [String],   // ["machine", "robot"] - ANY keyword triggers
    keywordsAll: [String],   // ["urgent", "emergency"] - ALL required
    
    // Advanced patterns (new)
    regexPatterns: [String], // ["/\\b(attorney|lawyer)\\b/i"] - stored as strings, compiled to RegExp
    
    // Caller filtering (new)
    callerType: [String],    // ["new", "existing", "vendor", "unknown"] - empty = any
    
    // Time constraints (new)
    timeWindows: [
      {
        daysOfWeek: [Number],  // [0-6] where 0=Sunday, empty = any day
        start: String,         // "08:00" (HH:mm format)
        end: String            // "17:00"
      }
    ],
    
    // Spam integration (new)
    spamFlagsRequired: [String], // ["suspected_spam", "high_frequency"] - empty = ignore spam flags
    
    // Trade filtering (new, optional)
    tradeRequired: [String]      // ["HVAC", "Plumbing"] - empty = any trade
  },
  
  // ═══════════════════════════════════════════════════════════════
  // ACTION (What to do when matched)
  // ═══════════════════════════════════════════════════════════════
  action: {
    type: String,          // "override_response" | "force_transfer" | "polite_hangup" | "flag_only"
    
    // For override_response
    responseTemplateId: String, // "template-polite-decline-legal" (future: template library)
    inlineResponse: String,     // "I'm a real person here to help!" (backward compat)
    
    // For force_transfer
    transferTarget: String,     // "manager" | "billing" | contactId | phone number
    transferMessage: String,    // "Let me connect you to our manager"
    
    // For polite_hangup
    hangupMessage: String       // "Thank you for calling. Goodbye."
  },
  
  // ═══════════════════════════════════════════════════════════════
  // SIDE EFFECTS (What else happens when matched)
  // ═══════════════════════════════════════════════════════════════
  sideEffects: {
    autoBlacklist: Boolean,     // Add caller to blacklist? (already implemented!)
    autoTag: [String],          // ["abuse", "spam"] - tags for call log
    notifyContacts: [String],   // [contactId1, contactId2] - SMS/email alerts
    logSeverity: String         // "info" | "warning" | "critical"
  },
  
  // ═══════════════════════════════════════════════════════════════
  // AUDIT TRAIL
  // ═══════════════════════════════════════════════════════════════
  auditMeta: {
    createdBy: String,       // "admin@clientsvia.com"
    createdAt: Date,         // ISO 8601
    updatedBy: String,       // "admin@clientsvia.com"
    updatedAt: Date          // ISO 8601
  }
}
```

---

## 🔄 MIGRATION PLAN (Backward-Compatible)

### Step 1: Extend Schema (Add New Fields)
**File**: `models/cheatsheet/CheatSheetConfigSchema.js`

Add optional new fields to existing edge cases:
- Keep `triggerPatterns` (legacy) → maps to `match.keywordsAny`
- Keep `responseText` (legacy) → maps to `action.inlineResponse`
- Add all new fields as optional with defaults

### Step 2: Support Hybrid Mode in CheatSheetEngine
**File**: `services/CheatSheetEngine.js`

Update `detectEdgeCase()` to handle both:
1. **Legacy edge cases**: Only `triggerPatterns` + `responseText`
2. **Enterprise edge cases**: Full `match` + `action` objects

Pseudocode:
```javascript
detectEdgeCase(input, edgeCases) {
  for (const ec of edgeCases) {
    // Legacy mode (backward compat)
    if (ec.triggerPatterns && !ec.match) {
      if (this.matchLegacyPatterns(input, ec.triggerPatterns)) {
        return { ...ec, action: { type: 'override_response', inlineResponse: ec.responseText } };
      }
    }
    
    // Enterprise mode (new)
    if (ec.match) {
      if (this.matchEnterprise(input, context, ec.match)) {
        return ec;
      }
    }
  }
  return null;
}
```

### Step 3: Update PolicyCompiler
**File**: `services/PolicyCompiler.js`

Ensure PolicyCompiler handles:
- Legacy `triggerPatterns[]` → compile to RegExp
- Enterprise `match.regexPatterns[]` → compile to RegExp
- All other fields pass through unchanged

### Step 4: Update UI (Gradual)
**File**: `public/js/ai-agent-settings/CheatSheetManager.js`

**Phase A**: Keep current UI working (no breaking changes)  
**Phase B**: Add "Advanced Mode" toggle → show enterprise fields  
**Phase C**: Auto-migrate on save (add `id`, `auditMeta`, default `action.type`)

### Step 5: Data Migration Script
**File**: `scripts/migrate-edge-cases-to-enterprise.js`

For each company with edge cases:
1. Load live CheatSheetVersion
2. For each `config.edgeCases[]`:
   - Add stable `id` if missing
   - Move `triggerPatterns` → `match.keywordsAny`
   - Move `responseText` → `action.inlineResponse`
   - Set `action.type = 'override_response'`
   - Add `auditMeta` with current timestamp
3. Save updated version
4. Invalidate Redis cache

---

## 🎭 BEHAVIOR RULES (What Edge Cases Must Support)

### 1. Override Response Completely ✅ (Already Works)

**Current State**: ✅ WORKING  
**Code**: Lines 64-156 in CheatSheetEngine.js  
**Behavior**:
- Replaces base response with edge case response
- Applies variable replacement
- Short-circuits (skips all other rules)
- Returns with `action: 'RESPOND'`

**Needs**:
- ✅ Already works for `override_response`
- ⚠️ No explicit `action.type` field yet (assumes override)

---

### 2. Force Transfer Flow ❌ (NOT IMPLEMENTED)

**Current State**: ❌ NOT SUPPORTED  
**What's Missing**:
- Edge cases always return `action: 'RESPOND'` (line 156)
- No way to return `action: 'TRANSFER'` from edge case
- No `transferTarget` field in edge case response

**Implementation Needed**:
```javascript
if (edgeCase.action.type === 'force_transfer') {
  return {
    response: edgeCase.action.transferMessage || "Let me transfer you",
    appliedBlocks: [{ type: 'EDGE_CASE', id: edgeCase.id, name: edgeCase.name }],
    action: 'TRANSFER',  // ← New: trigger transfer flow
    transferTarget: edgeCase.action.transferTarget,  // ← New: who to transfer to
    timeMs: elapsed,
    shortCircuit: true
  };
}
```

---

### 3. Polite Hangup ❌ (NOT IMPLEMENTED)

**Current State**: ❌ NOT SUPPORTED  
**What's Missing**:
- No way to trigger hangup from edge case
- Edge cases can't return `action: 'HANGUP'`

**Implementation Needed**:
```javascript
if (edgeCase.action.type === 'polite_hangup') {
  return {
    response: edgeCase.action.hangupMessage || "Thank you for calling. Goodbye.",
    appliedBlocks: [{ type: 'EDGE_CASE', id: edgeCase.id, name: edgeCase.name }],
    action: 'HANGUP',  // ← New: trigger hangup flow
    timeMs: elapsed,
    shortCircuit: true
  };
}
```

Then in CallFlowExecutor or v2twilio route, map `action: 'HANGUP'` → `shouldHangup: true`.

---

### 4. Flag Only (No Behavior Change) ❌ (NOT IMPLEMENTED)

**Current State**: ❌ NOT SUPPORTED  
**What's Missing**:
- Edge cases always short-circuit (return immediately)
- No way to "log and continue" without changing response

**Implementation Needed**:
```javascript
if (edgeCase.action.type === 'flag_only') {
  // Don't short-circuit, just log and add tags
  appliedBlocks.push({ 
    type: 'EDGE_CASE_FLAG', 
    id: edgeCase.id, 
    name: edgeCase.name,
    tags: edgeCase.sideEffects?.autoTag || []
  });
  
  // Trigger side effects (blacklist, notify, log)
  this.applySideEffects(edgeCase, context);
  
  // Continue with transfer/behavior/guardrails (no short-circuit)
  // Fall through to next precedence layer
}
```

---

## 📊 CURRENT LOGGING (What We Have)

### Layer 1: CheatSheetEngine (Edge Case Detection)
**File**: `services/CheatSheetEngine.js`  
**Location**: Line 80-86

**Current Log**:
```javascript
logger.info('[CHEAT SHEET ENGINE] Edge case triggered (short-circuit)', {
  companyId: context.companyId,
  callId: context.callId,
  edgeCaseId: edgeCase.id,
  edgeCaseName: edgeCase.name,
  timeMs: elapsed
});
```

**Also**: `appliedBlocks[]` includes:
```javascript
{ 
  type: 'EDGE_CASE', 
  id: edgeCase.id,
  name: edgeCase.name
}
```

### Layer 2: CallFlowExecutor (CheatSheet Application)
**File**: `services/CallFlowExecutor.js`  
**Location**: Line 347-357

**Current Log**:
```javascript
logger.info('[CHEATSHEET]', {
  companyId: context.company._id.toString(),
  callSid: context.callState.callSid || context.callId,
  appliedBlocks: cheatSheetResult.appliedBlocks.map(b => ({
    type: b.type,        // 'EDGE_CASE' for edge cases
    id: b.id || null
  })),
  finalAction: cheatSheetResult.action === 'TRANSFER' ? 'transfer' : finalAction,
  shortCircuit: cheatSheetResult.shortCircuit,  // true for edge cases
  timestamp: new Date().toISOString()
});
```

### ✅ What's Already Logged:
1. ✅ Edge case ID and name (both CheatSheetEngine and CallFlowExecutor)
2. ✅ Short-circuit flag (both layers)
3. ✅ Final action (CallFlowExecutor)
4. ✅ Applied blocks array with types (CallFlowExecutor)
5. ✅ Execution time (CheatSheetEngine)
6. ✅ Company and call identifiers (both layers)

### ❌ What's Missing:
1. ❌ No `action.type` in log (override/transfer/hangup/flag) - currently assumes override
2. ❌ No matched pattern/keyword logged
3. ❌ No side effects logged (blacklist, tags, notifications)
4. ❌ No priority logged

### 🎯 Enterprise Log (Target - After Phase 3):
```javascript
logger.info('[CHEAT SHEET ENGINE] Edge case triggered', {
  companyId: context.companyId,
  callId: context.callId,
  edgeCase: {
    id: edgeCase.id,
    name: edgeCase.name,
    actionType: edgeCase.action?.type || 'override_response',  // ← New
    matchedPattern: matchResult.pattern,  // ← New
    priority: edgeCase.priority  // ← New
  },
  sideEffects: {  // ← New
    autoBlacklist: edgeCase.sideEffects?.autoBlacklist || false,
    tags: edgeCase.sideEffects?.autoTag || [],
    notifyContacts: edgeCase.sideEffects?.notifyContacts || []
  },
  shortCircuit: edgeCase.action?.type !== 'flag_only',  // ← New
  timeMs: elapsed
});
```

---

## 🧪 TEST PLAN (Phase 5)

### Test 1: Override Response (Already Works)
**Edge Case**:
```json
{
  "id": "test-override",
  "name": "Test Override",
  "priority": 1,
  "enabled": true,
  "triggerPatterns": ["edge case test"],
  "responseText": "EDGE CASE TEST OVERRIDE"
}
```

**Test**:
1. Create edge case in UI
2. Call agent: "edge case test"
3. Verify logs:
   - `[AGENT-INPUT]` shows "edge case test"
   - `[CHEAT SHEET ENGINE]` shows `edgeCaseId: "test-override"`
   - `[CHEATSHEET]` log shows `appliedBlocks: [{ type: 'EDGE_CASE', id: 'test-override' }]`
   - `[AGENT-OUTPUT]` shows `shortResponsePreview: "EDGE CASE TEST OVERRIDE"`
4. Verify TwiML uses override text

**Expected**: ✅ Should already work (override response confirmed)

---

### Test 2: Force Transfer (Not Yet Implemented)
**Edge Case** (after Phase 3):
```json
{
  "id": "test-transfer",
  "name": "Test Transfer",
  "priority": 1,
  "enabled": true,
  "match": {
    "keywordsAny": ["transfer test"]
  },
  "action": {
    "type": "force_transfer",
    "transferTarget": "manager",
    "transferMessage": "Let me connect you to our manager"
  }
}
```

**Test**:
1. Create edge case in UI
2. Call agent: "transfer test"
3. Verify logs:
   - `[CHEAT SHEET ENGINE]` shows `actionType: "force_transfer"`
   - `[CHEATSHEET]` shows `finalAction: "transfer"`
   - `[AGENT-OUTPUT]` shows `willTransfer: true`
4. Verify call transfers with ElevenLabs message

**Expected**: ⏳ Needs Phase 3 implementation

---

### Test 3: Polite Hangup (Not Yet Implemented)
**Edge Case** (after Phase 3):
```json
{
  "id": "test-hangup",
  "name": "Test Abuse Hangup",
  "priority": 1,
  "enabled": true,
  "match": {
    "keywordsAny": ["hangup test"]
  },
  "action": {
    "type": "polite_hangup",
    "hangupMessage": "Thank you for calling. Goodbye."
  },
  "sideEffects": {
    "autoBlacklist": true,
    "autoTag": ["test", "abuse"],
    "logSeverity": "critical"
  }
}
```

**Test**:
1. Create edge case in UI
2. Call agent: "hangup test"
3. Verify logs:
   - `[CHEAT SHEET ENGINE]` shows `actionType: "polite_hangup"`, `autoBlacklist: true`
   - `[AGENT-OUTPUT]` shows `willHangup: true`
4. Verify call hangs up after message
5. Verify caller added to blacklist

**Expected**: ⏳ Needs Phase 3 implementation

---

## 🎯 ENTERPRISE EDGE CASE PACK (Phase 4 - Future)

### Default Pack Categories:

1. **Abuse/Profanity Detection**
   - Patterns: profanity keywords, abusive phrases
   - Action: Polite hangup
   - Side Effects: Auto-blacklist, critical log, notify admin

2. **Legal Threats**
   - Patterns: "lawyer", "attorney", "sue", "lawsuit"
   - Action: Force transfer to manager
   - Side Effects: Critical log, notify manager immediately

3. **Out-of-Scope Services**
   - Patterns: profession mismatches (e.g. "lawyer" calling HVAC)
   - Action: Override response with polite redirect
   - Side Effects: Log info, tag as "out_of_scope"

4. **Pricing Negotiation**
   - Patterns: "discount", "cheaper", "lower price"
   - Action: Override response with pricing policy
   - Side Effects: Log info, tag as "pricing_inquiry"

5. **High-Risk Data**
   - Patterns: "card number", "SSN", "social security", "password"
   - Action: Override response with security warning
   - Side Effects: Critical log, notify security team

---

## 📊 STATUS SUMMARY

### ✅ What Works Today:
1. ✅ Edge Cases UI → Mongo → Redis → Runtime (pipeline confirmed)
2. ✅ Highest precedence (short-circuit all other rules)
3. ✅ Pattern matching (keywords → RegExp)
4. ✅ Response override with variable replacement
5. ✅ Auto-blacklist integration (async, non-blocking)
6. ✅ Structured logging with edge case ID/name

### ❌ What's Missing:
1. ❌ No stable `id` field (array index used)
2. ❌ Limited matching (only keywords, no caller type/time/spam flags)
3. ❌ Only 1 action type (override response)
4. ❌ No force transfer from edge cases
5. ❌ No polite hangup from edge cases
6. ❌ No "flag only" mode (log without changing behavior)
7. ❌ Side effects not configurable per edge case
8. ❌ No audit metadata (createdBy, updatedBy, timestamps)

### ⏳ Next Steps:
1. Phase 2: Compare schemas, propose migration
2. Phase 3: Implement 4 action types (override/transfer/hangup/flag)
3. Phase 4: Document enterprise pack
4. Phase 5: Test all 3 scenarios end-to-end

---

**Audit Complete**: Edge Cases are WIRED and WORKING for override responses. Need enterprise upgrade for transfer/hangup/flag actions.

---

_Audited: November 27, 2025_  
_By: AI Coder (World-Class)_  
_Status: Phase 1 Complete, Ready for Phase 2_

