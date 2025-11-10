# 🎯 PHASE 1 - EXACT REPLY SELECTION LOCATIONS

**Purpose:** Before implementing Phase 1 voice hotfix, identify and show EXACT locations for user review.

---

## 📍 LOCATION 1: IntelligentRouter.js - Tier 3 LLM Path

**File:** `services/IntelligentRouter.js`  
**Lines:** 363-405  
**Context:** Tier 3 (LLM) has matched a scenario, now selecting which reply to use

### Current Code Block:
```javascript
// Line 363-405
if (fullScenario) {
    result.scenario = fullScenario;  // Full scenario with replies!
    result.confidence = result.tier3Result.confidence;
    
    // 🧠 INTELLIGENT REPLY SELECTION
    // Information-heavy scenarios MUST use full replies
    const informationScenarios = ['hours', 'operation', 'pricing', 'price', 'cost', 'service', 'location', 'address', 'phone', 'contact', 'policy', 'faq', 'question'];
    const scenarioNameLower = fullScenario.name.toLowerCase();
    const requiresFullReply = informationScenarios.some(keyword => scenarioNameLower.includes(keyword));
    
    // For information scenarios: ALWAYS use full replies
    // For action scenarios (appointment, booking): 30% quick, 70% full
    let useQuickReply;
    if (requiresFullReply) {
        useQuickReply = false;  // 🔥 ALWAYS full reply for info scenarios
        logger.info(`📋 [REPLY SELECTION] Information scenario detected - using FULL replies`, {
            scenarioId: fullScenario.scenarioId,
            scenarioName: fullScenario.name,
            reason: 'Information-heavy scenarios must have detailed responses'
        });
    } else {
        useQuickReply = Math.random() < 0.3;  // 30% quick for action scenarios
    }
    
    let replyVariants = useQuickReply ? fullScenario.quickReplies : fullScenario.fullReplies;
    
    if (!replyVariants || replyVariants.length === 0) {
        replyVariants = fullScenario.fullReplies || fullScenario.quickReplies || [];
    }
    
    // 🔥 CRITICAL: NO FALLBACK TEXT! Scenario MUST have replies!
    if (!replyVariants || replyVariants.length === 0) {
        logger.error('🚨 [TIER 3] Scenario has NO replies! Template is broken!', {
            scenarioId: fullScenario.scenarioId,
            scenarioName: fullScenario.name,
            templateId: template._id
        });
        result.success = false;
        result.response = null;
    } else {
        result.response = replyVariants[Math.floor(Math.random() * replyVariants.length)];
        result.success = true;
    }
}
```

### Key Observations:
- ✅ Already has **keyword-based logic** checking for info scenarios (hours, pricing, etc.)
- ✅ Already tries to always use full replies for info scenarios
- ⚠️ BUT: Falls back to `Math.random() < 0.3` for non-info scenarios (30% quick, 70% full)
- ⚠️ **PROBLEM**: This logic uses scenario NAME keywords, not channel awareness
- ⚠️ **This path applies to ALL channels** (voice, SMS, chat)

---

## 📍 LOCATION 2: AIBrain3tierllm.js - Fallback Path

**File:** `services/AIBrain3tierllm.js`  
**Lines:** 382-428  
**Context:** When Tier 1/2/3 result doesn't have response pre-selected, extract from scenario

### Current Code Block:
```javascript
// Line 382-428
if (result.response) {
    // Router already selected the response (Tier 1/2/3)
    selectedReply = result.response;
    // Infer reply type from response length (just for metadata)
    replyType = result.response.length < 100 ? 'quick' : 'full';
} else {
    // Fallback: Extract from scenario (legacy path, should rarely happen)
    // 🧠 INTELLIGENT REPLY SELECTION
    // Information-heavy scenarios MUST use full replies
    const informationScenarios = ['hours', 'operation', 'pricing', 'price', 'cost', 'service', 'location', 'address', 'phone', 'contact', 'policy', 'faq', 'question'];
    const scenarioNameLower = result.scenario.name.toLowerCase();
    const requiresFullReply = informationScenarios.some(keyword => scenarioNameLower.includes(keyword));
    
    // For information scenarios: ALWAYS use full replies
    // For action scenarios (appointment, booking): 30% quick, 70% full
    let useQuickReply;
    if (requiresFullReply) {
        useQuickReply = false;  // 🔥 ALWAYS full reply for info scenarios
        logger.info(`📋 [REPLY SELECTION] Information scenario detected - using FULL replies`, {
            routingId: context.routingId,
            scenarioId: result.scenario.scenarioId,
            scenarioName: result.scenario.name,
            reason: 'Information-heavy scenarios must have detailed responses'
        });
    } else {
        useQuickReply = Math.random() < 0.3;  // 30% quick for action scenarios
    }
    
    replyType = useQuickReply ? 'quick' : 'full';
    let replyVariants = useQuickReply ? result.scenario.quickReplies : result.scenario.fullReplies;
    
    if (!replyVariants || replyVariants.length === 0) {
        replyVariants = result.scenario.fullReplies || result.scenario.quickReplies || [];
    }

    // 🔥 NO FALLBACK TEXT! If scenario has no replies, template is broken!
    if (!replyVariants || replyVariants.length === 0) {
        logger.error('🚨 [AI BRAIN] Scenario has NO replies! Template broken!', {
            routingId: context.routingId,
            scenarioId: result.scenario.scenarioId,
            scenarioName: result.scenario.name
        });
        selectedReply = null;  // ❌ NO GENERIC TEXT!
    } else {
        selectedReply = replyVariants[Math.floor(Math.random() * replyVariants.length)];
    }
}
```

### Key Observations:
- ✅ Has same keyword-based logic as Location 1
- ✅ Already tries to always use full replies for info scenarios
- ⚠️ **PROBLEM**: Same issue - uses scenario NAME keywords, not channel awareness
- ⚠️ **This path applies to ALL channels** (voice, SMS, chat)

---

## 📍 LOCATION 3: IntelligentRouter.js - Tier 1 Path (MINOR)

**File:** `services/IntelligentRouter.js`  
**Line:** 615  
**Context:** Tier 1 return value includes a quick response

### Current Code:
```javascript
// Line 615
response: match.scenario?.quickReplies?.[0] || null,
```

### Key Observations:
- ✅ This is just metadata for logging, not the actual final response
- ✅ Not directly related to what's sent to Twilio
- ⚠️ Minor issue, but shows that reply selection is happening at multiple layers

---

## 🔍 PROBLEM ANALYSIS

### Current Behavior (ALL channels):
1. **Tier 1/2/3 matches a scenario**
2. **Reply selection logic checks scenario NAME keywords**
   - If name includes: hours, pricing, location, etc. → Use fullReplies
   - Else → 30% random chance of quickReplies
3. **Problem:** This applies to ALL channels (voice, SMS, chat)
4. **Result:** SMS gets verbose full replies when concise is better; voice gets randomized

### Why This Causes "We're here to help!" Bug:
- INFO_FAQ scenarios (like "Hours") are detected by keyword matching
- But if the scenario has ONLY quickReplies (no fullReplies), it still uses them
- OR if the keyword detection misses the scenario, random 30% quick reply gets chosen
- On voice, user hears just the greeting, not the actual hours

---

## ✅ PHASE 1 FIX PROPOSAL

**For VOICE channel only** - modify both locations to:

```javascript
// PHASE 1: Voice-only rule
if (channel === 'voice' && scenario.fullReplies && scenario.fullReplies.length > 0) {
    // VOICE: Always include fullReply when it exists
    // Option A: fullReply only
    // Option B: optional quickReply + fullReply
    replyVariants = scenario.fullReplies;
} else if (scenario.quickReplies && scenario.quickReplies.length > 0) {
    // Fallback: if no fullReplies, use quickReplies
    replyVariants = scenario.quickReplies;
} else if (scenario.fullReplies && scenario.fullReplies.length > 0) {
    // Fallback: if no quickReplies, use fullReplies
    replyVariants = scenario.fullReplies;
}

// Keep SMS/chat behavior unchanged (no channel check)
```

---

## 🛡️ SAFETY CHECK

### Won't Break:
- ✅ SMS/chat behavior (no channel check in Phase 1)
- ✅ Tier 1/2/3 routing logic (only reply selection changed)
- ✅ Scenario matching (3-tier system unchanged)
- ✅ Logging (existing logs still work)

### Will Change:
- ⚠️ Voice responses for INFO_FAQ scenarios will always show full information
- ⚠️ Voice will no longer randomly show "We're here to help!" when hours exist

### Rollback:
- ✅ Single git revert if issues found
- ✅ No schema changes
- ✅ No database migration needed

---

## 📋 READY FOR REVIEW

**Two locations identified:**
1. `IntelligentRouter.js:363-405` (Tier 3 path)
2. `AIBrain3tierllm.js:382-428` (Fallback path)

**Both locations have same logic pattern:**
- Keyword-based detection
- Random 30% quick reply for non-info scenarios
- No channel awareness

**Phase 1 action:**
- Add channel check for VOICE
- If voice + fullReplies exist → use fullReplies
- SMS/chat unchanged

---

**Status: Ready for user review and approval before implementation**

