# Call Console Diagnostics Guide

## NO MORE 12-Hour Debugging Sessions

Every call report now shows **EXACTLY** what's happening at each step. Just download the call report JSON and you'll see everything.

---

## New Diagnostic Events (In Order They Appear)

### 1. **DATABASE_CONNECTION_INFO** 🔍

**What it shows:** Exactly what database the server is connected to

**Location:** Top of call trace

**Example:**
```json
{
  "kind": "DATABASE_CONNECTION_INFO",
  "payload": {
    "mongoDbName": "clientsvia",       // ← CRITICAL: Should be "clientsvia", NOT "test"
    "mongoHost": "cluster0-shard-00-02.mongodb.net:27017",
    "mongoReadyState": 1,
    "readyStateText": "connected",
    "companyId": "68e3f77a9d623b8058c700c4",
    "turn": 1
  }
}
```

**What to check:**
- ✅ `mongoDbName: "clientsvia"` = GOOD
- ❌ `mongoDbName: "test"` = BAD (server using wrong database)
- ❌ `readyStateText: "disconnected"` = BAD (connection problem)

---

### 2. **SCRABENGINE_ENTRY** → **SCRABENGINE_DELIVERY** 📝

**What it shows:** All 5 stages of input processing

**Stages:**

#### Stage 1: SCRABENGINE_ENTRY
Raw input from caller (speech-to-text)
```json
{
  "stage": "SCRABENGINE_ENTRY",
  "text": "I was having a problem um smelling gas in my home.",
  "wordCount": 10,
  "status": "received"
}
```

#### Stage 2: SCRABENGINE_STAGE1 (Filler Removal)
Removes "um", "uh", etc.
```json
{
  "stage": "SCRABENGINE_STAGE1",
  "text": "i was having a problem smelling gas in my home.",
  "status": "modified",
  "changes": [
    { "type": "filler", "value": "um", "count": 1 }
  ],
  "summary": "Removed 1 filler(s): \"um\""
}
```

#### Stage 3: SCRABENGINE_STAGE2 (Vocabulary Normalization)
Fixes common speech-to-text errors
```json
{
  "stage": "SCRABENGINE_STAGE2",
  "text": "i was having a problem smelling gas in my home.",
  "status": "unchanged",
  "summary": "No normalizations applied"
}
```

#### Stage 4: SCRABENGINE_STAGE3 (Token Expansion)
**MOST IMPORTANT** - Adds semantic synonyms for better matching
```json
{
  "stage": "SCRABENGINE_STAGE3",
  "text": "Original: [i, was, having, a, problem, smelling, gas, in, my, home]\nExpanded: [i, was, having, a, problem, smelling, gas, in, my, home, smell, emergency, gas smell, safety, shut off, evacuate]",
  "status": "expanded",
  "changes": [
    {
      "type": "expansion",
      "source": "smell+gas",
      "addedTokens": ["gas", "smell", "emergency", "gas smell", "safety", "shut off", "evacuate"],
      "count": 8
    }
  ],
  "summary": "Expanded 10 tokens → 16 tokens (+6 synonyms)"
}
```

**What to check:**
- ✅ Shows semantic expansion (e.g., "gas smell" → adds "emergency", "safety")
- ✅ Token count increased (10 → 16)
- ❌ No expansion when it should = ScrabEngine config issue

#### Stage 5: SCRABENGINE_STAGE4 (Entity Extraction)
Extracts names, phone numbers, addresses
```json
{
  "stage": "SCRABENGINE_STAGE4",
  "entities": {
    "firstName": null,
    "lastName": null,
    "phone": null,
    "address": null
  },
  "summary": "No entities found"
}
```

#### Stage 6: SCRABENGINE_STAGE5 (Quality Assessment)
Checks if input is good enough to process
```json
{
  "stage": "SCRABENGINE_STAGE5",
  "status": "passed",
  "reason": "QUALITY_OK",
  "confidence": 0.95,
  "summary": "Quality OK (95% confidence)"
}
```

**What to check:**
- ✅ `status: "passed"` = Input is clear enough
- ❌ `status: "failed"` = Input too garbled/short

#### Stage 7: SCRABENGINE_DELIVERY
Final output ready for trigger matching
```json
{
  "stage": "SCRABENGINE_DELIVERY",
  "text": "i was having a problem smelling gas in my home.",
  "metadata": {
    "totalTransformations": 2,
    "totalProcessingTimeMs": 62,
    "tokensDelivered": 16
  },
  "summary": "Processed in 62ms. 2 transformation(s) applied. Ready for trigger matching."
}
```

---

### 3. **SCRABENGINE_HANDOFF_TO_TRIGGERS** 🤝

**What it shows:** EXACTLY what ScrabEngine delivers to trigger matching

**Example:**
```json
{
  "kind": "SCRABENGINE_HANDOFF_TO_TRIGGERS",
  "payload": {
    "handoffStep": "ScrabEngine → Trigger Matching",
    
    "normalizedInput": "i was having a problem smelling gas in my home.",
    "expandedTokens": ["i", "was", "having", "a", "problem", "smelling", "gas", "in", "my", "home", "smell", "emergency", "gas smell", "safety", "shut off", "evacuate"],
    "originalTokenCount": 10,
    "expandedTokenCount": 16,
    "tokensAdded": 6,
    
    "qualityPassed": true,
    "qualityConfidence": 0.95,
    
    "transformationCount": 2,
    "transformationSummary": [
      { "stage": "fillers", "type": "filler_removed", "detail": "um" },
      { "stage": "synonyms", "type": "context_pattern_matched", "detail": "gas, smell, emergency" }
    ],
    
    "sampleExpandedTokens": ["i", "was", "having", "a", "problem", "smelling", "gas", "in", "my", "home", "smell", "emergency", "gas smell", "safety", "shut off"],
    
    "note": "This normalized text + expanded tokens will now be matched against trigger keywords/phrases"
  }
}
```

**What to check:**
- ✅ `expandedTokens` includes relevant keywords (e.g., "emergency", "gas smell")
- ✅ `qualityPassed: true`
- ✅ `tokensAdded > 0` (semantic expansion happened)

---

### 4. **TRIGGER_LOADING_REPORT** 📊

**What it shows:** How many triggers were loaded from database

**Example (GOOD):**
```json
{
  "kind": "TRIGGER_LOADING_REPORT",
  "payload": {
    "totalTriggersLoaded": 42,
    "loadSource": "OFFICIAL_LIBRARY",
    "strictMode": true,
    "activeGroupId": "hvac",
    "isGroupPublished": true,
    "globalSkippedReason": null,
    "sampleTriggers": [
      {
        "ruleId": "gas-smell",
        "label": "Gas smell or leak",
        "scope": "LOCAL",
        "keywords": ["gas", "smell", "leak", "odor", "natural gas"]
      },
      {
        "ruleId": "carbon-monoxide",
        "label": "Carbon monoxide alarm or detector",
        "scope": "LOCAL",
        "keywords": ["carbon monoxide", "co detector", "alarm", "beeping"]
      }
    ]
  }
}
```

**Example (BAD - Empty Pool):**
```json
{
  "kind": "TRIGGER_LOADING_REPORT",
  "payload": {
    "totalTriggersLoaded": 0,           // ← PROBLEM!
    "loadSource": "LOCAL_ONLY",
    "activeGroupId": null,
    "globalSkippedReason": "NO_ACTIVE_GROUP_ID",
    "sampleTriggers": []
  }
}
```

**What to check:**
- ✅ `totalTriggersLoaded > 0` = GOOD (triggers available)
- ❌ `totalTriggersLoaded: 0` = BAD (no triggers to match against)
- Check `globalSkippedReason` if global triggers missing
- Check `sampleTriggers` to see what keywords are available

---

### 5. **TRIGGER_MATCHING_ANALYSIS** 🎯

**What it shows:** Input vs Available Triggers vs Result

**Example:**
```json
{
  "kind": "TRIGGER_MATCHING_ANALYSIS",
  "payload": {
    "inputProvided": {
      "normalizedText": "i was having a problem smelling gas in my home.",
      "expandedTokenCount": 16,
      "sampleTokens": ["i", "was", "having", "a", "problem", "smelling", "gas", "in", "my", "home"]
    },
    
    "triggersAvailable": {
      "totalCount": 42,
      "enabledCount": 42,
      "disabledCount": 0,
      "scopes": {
        "global": 0,
        "local": 42
      },
      "sampleTriggerKeywords": [
        {
          "label": "Gas smell or leak",
          "keywords": ["gas", "smell", "leak", "odor", "natural gas"],
          "phrases": ["smell gas", "gas leak"]
        }
      ]
    },
    
    "matchingResult": {
      "matched": true,
      "matchType": "keyword",
      "matchedOn": "gas smell",
      "cardLabel": "Gas smell or leak",
      "candidatesEvaluated": 42,
      "blockedByNegatives": 0
    },
    
    "diagnosis": "✅ MATCH SUCCESSFUL"
  }
}
```

**What to check:**
- ✅ `triggersAvailable.totalCount > 0` = Have triggers
- ✅ `matchingResult.matched: true` = Match found
- ❌ `triggersAvailable.totalCount: 0` = No triggers loaded (see DATABASE_CONNECTION_INFO)
- ❌ `matchingResult.matched: false` = Triggers loaded but no match (keywords don't overlap)

**Possible diagnoses:**
- `"❌ NO TRIGGERS AVAILABLE - Cannot match with empty pool"` = Database issue
- `"⚠️ TRIGGERS AVAILABLE BUT NO MATCH - Input tokens did not match any trigger keywords"` = Keyword coverage issue
- `"✅ MATCH SUCCESSFUL"` = Working correctly

---

### 6. **TRIGGER_POOL_EMPTY** (Only if pool is empty) ⚠️

**What it shows:** Detailed diagnosis of why no triggers loaded

**Example:**
```json
{
  "kind": "TRIGGER_POOL_EMPTY",
  "payload": {
    "severity": "CRITICAL",
    "message": "No trigger cards loaded — all turns will fall through to LLM fallback",
    
    "mongoDbName": "test",              // ← SMOKING GUN!
    "mongoHost": "cluster0...",
    
    "activeGroupId": null,
    "isGroupPublished": false,
    "globalSkippedReason": "NO_ACTIVE_GROUP_ID",
    
    "possibleCauses": [
      "❌ No global trigger group assigned to company",
      "❌ CRITICAL: Connected to 'test' database instead of production",
      "Check local triggers: enabled=true, isDeleted=false, state=published",
      "Verify companyId matches between call routing and database query"
    ],
    
    "action": "Go to Admin → Triggers → Verify group is assigned and published, then click Refresh Cache"
  }
}
```

**What to check:**
- ❌ `mongoDbName: "test"` = Server connected to wrong database
- ❌ `possibleCauses` lists specific issues
- Follow the `action` steps to fix

---

## How to Use This for Debugging

### Step 1: Make a Test Call
Call the number and say: "I smell gas in my home"

### Step 2: Download Call Report
Agent Console → Recent Calls → Download JSON

### Step 3: Check Events in Order

1. **DATABASE_CONNECTION_INFO**
   - Is `mongoDbName: "clientsvia"`?
   - If not, fix MONGODB_URI in Render

2. **SCRABENGINE stages**
   - Did Stage 3 expand tokens? (10 → 16+)
   - Did Stage 5 pass quality? (`status: "passed"`)

3. **SCRABENGINE_HANDOFF_TO_TRIGGERS**
   - Does `expandedTokens` include relevant keywords?
   - Is `qualityPassed: true`?

4. **TRIGGER_LOADING_REPORT**
   - Is `totalTriggersLoaded > 0`?
   - If 0, check `globalSkippedReason`

5. **TRIGGER_MATCHING_ANALYSIS**
   - Check `diagnosis` field
   - Compare input tokens vs trigger keywords

6. **TRIGGER_POOL_EMPTY** (if present)
   - Read `possibleCauses`
   - Follow `action` steps

---

## Common Issues & Solutions

### Issue: `mongoDbName: "test"`
**Fix:** Update MONGODB_URI in Render to include `/clientsvia`
```
mongodb+srv://...@cluster.../clientsvia?retryWrites=...
```

### Issue: `totalTriggersLoaded: 0`
**Causes:**
- Wrong database (see above)
- Triggers have `enabled: false` or `isDeleted: true`
- Triggers missing `state: "published"`
- Wrong companyId

**Fix:** Run diagnostic tool:
```
https://your-domain.com/trigger-diagnostics.html
```

### Issue: `matched: false` but triggers exist
**Cause:** Input tokens don't overlap with trigger keywords

**Fix:** 
- Check `sampleTriggerKeywords` in TRIGGER_MATCHING_ANALYSIS
- Add missing keywords to triggers
- Or add synonym expansion rules to ScrabEngine

---

## Quick Reference: Event Order

```
1. DATABASE_CONNECTION_INFO           ← Check DB name
2. SCRABENGINE_ENTRY                  ← Raw input
3. SCRABENGINE_STAGE1                 ← Remove fillers
4. SCRABENGINE_STAGE2                 ← Normalize vocabulary
5. SCRABENGINE_STAGE3                 ← Expand tokens ⭐
6. SCRABENGINE_STAGE4                 ← Extract entities
7. SCRABENGINE_STAGE5                 ← Quality check
8. SCRABENGINE_DELIVERY               ← Ready for matching
9. SCRABENGINE_HANDOFF_TO_TRIGGERS    ← What triggers receive ⭐
10. TRIGGER_LOADING_REPORT            ← How many triggers loaded ⭐
11. TRIGGER_MATCHING_ANALYSIS         ← Match attempt result ⭐
12. A2_TRIGGER_EVAL                   ← Detailed match info
13. TRIGGER_POOL_EMPTY (if empty)     ← Why no triggers ⭐
```

⭐ = Most important events for debugging

---

## Result

**Before:** 12 hours digging through server logs, MongoDB queries, code

**After:** Download call report JSON, check 5 events, see exactly what's wrong

No guessing. No assumptions. Just facts.
