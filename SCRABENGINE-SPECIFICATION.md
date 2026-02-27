# ScrabEngine - Text Normalization & Expansion System

## 🎯 **Mission Statement**

**ScrabEngine is a pure text processor that normalizes raw STT transcripts and expands tokens for better trigger matching - WITHOUT changing the meaning or replacing the customer's words.**

---

## 🏗️ **Architecture Principles**

### **1. ALWAYS Preserve Raw Text**
```javascript
// ✅ CORRECT
{
  rawText: "um my acee isn't pulling you know",
  normalizedText: "my ac isn't cooling",
  // Both kept forever
}

// ❌ WRONG
{
  text: "my ac isn't cooling"  // Lost the original!
}
```

### **2. Normalization ≠ Rewriting**
- **Normalize:** Safe transforms (lowercase, remove stutters, fix obvious mishears)
- **Don't Rewrite:** Don't change what customer meant
- **Expand as Metadata:** Add synonyms as additional tokens, keep originals

### **3. Single Responsibility**
- ScrabEngine ONLY processes text
- Doesn't care where text came from (Deepgram, Twilio, SMS, chat)
- Doesn't make decisions (that's TriggerMatcher's job)
- Pure function: Text In → Enhanced Text Out

### **4. Traceable & Debuggable**
- Every transformation logged
- Audit trail of what changed
- Reversible (can reconstruct what happened)

---

## 📊 **ScrabEngine Output Structure**

```javascript
{
  // ALWAYS preserved - the ground truth
  rawText: "um my acee isn't pulling you know",
  
  // Safe normalization applied
  normalized: {
    text: "my ac isn't cooling",
    transformations: [
      { stage: 'fillers', type: 'removed', value: 'um', position: 0 },
      { stage: 'fillers', type: 'removed', value: 'you know', position: -1 },
      { stage: 'vocabulary', type: 'normalized', from: 'acee', to: 'ac' },
      { stage: 'vocabulary', type: 'normalized', from: 'pulling', to: 'cooling' }
    ]
  },
  
  // Token expansion for flexible matching (metadata only)
  expanded: {
    originalTokens: ['my', 'ac', 'isn't', 'cooling'],
    expandedTokens: [
      'my', 'ac', 'air', 'conditioner', 'unit',  // Synonyms for 'ac'
      'isn't', 'not',                             // Synonyms for "isn't"
      'cooling', 'working', 'running'             // Synonyms for 'cooling'
    ],
    expansionMap: {
      'ac': ['air', 'conditioner', 'unit'],
      'isn't': ['not'],
      'cooling': ['working', 'running']
    }
  },
  
  // Quality metrics
  quality: {
    confidence: 0.92,  // Overall quality score
    wordCount: 4,
    hasFillers: true,
    hasMishears: true,
    isClean: false,
    noiseLevel: 'medium'
  },
  
  // Processing metadata
  meta: {
    processingTimeMs: 12,
    scrabEngineVersion: '1.0.0',
    timestamp: '2026-02-26T18:00:00.000Z'
  }
}
```

---

## 🔧 **Three Processing Stages**

### **Stage 1: Filler Removal (Safe Normalization)**

**Purpose:** Remove conversational noise that adds no meaning

**Operations:**
1. Remove filler words: "um", "uh", "like", "you know"
2. Remove greeting prefixes: "hi", "hello" (only at start)
3. Remove company name mentions (often misheard)
4. Collapse repeated words: "I I I need" → "I need"
5. Trim whitespace, lowercase

**Config Location:** `company.aiAgentSettings.scrabEngine.fillers`

**Example:**
```javascript
Input:  "um Hi there I I need my acee fixed you know"
Output: "i need my acee fixed"
Removed: ["um", "hi there", "I" (duplicate), "you know"]
```

**Time:** ~1-3ms

---

### **Stage 2: Vocabulary Normalization (Mishear Corrections)**

**Purpose:** Fix known STT mishears and industry slang

**Operations:**
1. Apply EXACT word replacements from UI-configured vocabulary
2. Match modes: EXACT (word boundary) or CONTAINS (substring)
3. Priority-based (highest priority first)

**Config Location:** `company.aiAgentSettings.scrabEngine.vocabulary`

**Example:**
```javascript
Vocabulary Rules:
  { from: "acee", to: "ac", mode: "EXACT" }
  { from: "tstat", to: "thermostat", mode: "EXACT" }
  { from: "pulling", to: "cooling", mode: "EXACT" }

Input:  "i need my acee fixed"
Output: "i need my ac fixed"
Applied: [{ from: "acee", to: "ac" }]
```

**Time:** ~2-8ms (for 50 rules)

---

### **Stage 3: Token Expansion (Synonym Metadata)**

**Purpose:** Add synonyms as ADDITIONAL tokens for matching (don't replace originals)

**Operations:**
1. Tokenize normalized text
2. For each token, check synonym map
3. Add synonyms to expandedTokens array
4. Preserve original tokens

**Config Location:** `company.aiAgentSettings.scrabEngine.synonyms`

**Two Types of Synonyms:**

#### **Type A: Simple Word Synonyms**
```javascript
{
  word: "schedule",
  synonyms: ["book", "set up", "arrange", "reserve"]
}
```

#### **Type B: Context-Aware Synonyms** (Multi-Word Patterns)
```javascript
{
  pattern: ["thing", "garage"],
  component: "air handler",
  contextTokens: ["air", "handler", "ahu", "indoor", "unit"]
}
```

**Example:**
```javascript
Input tokens: ["my", "ac", "isn't", "cooling"]

Synonym map:
  "ac" → ["air", "conditioner", "unit", "hvac"]
  "cooling" → ["working", "running", "functioning", "blowing cold"]

Output:
  originalTokens: ["my", "ac", "isn't", "cooling"]
  expandedTokens: ["my", "ac", "air", "conditioner", "unit", "hvac", 
                   "isn't", "not", "cooling", "working", "running", 
                   "functioning", "blowing", "cold"]
```

**Time:** ~5-15ms (for 100 synonym rules)

---

## 🚨 **Critical Safety Rules**

### **Rule 1: Never Mutate Raw Text**
```javascript
// ✅ CORRECT
const result = {
  rawText: input,  // Original preserved
  normalizedText: normalized  // Processed version
};

// ❌ WRONG
input = normalized;  // Original lost!
```

### **Rule 2: All Transforms Are Logged**
```javascript
transformations: [
  { stage: 'fillers', type: 'removed', value: 'um', position: 0 },
  { stage: 'vocabulary', from: 'acee', to: 'ac', confidence: 1.0 }
]
```

### **Rule 3: Expansion Never Replaces**
```javascript
// ✅ CORRECT - Metadata expansion
{
  originalTokens: ["schedule"],
  expandedTokens: ["schedule", "book", "arrange"]  // Added, not replaced
}

// ❌ WRONG - Replacement
{
  tokens: ["book"]  // Original "schedule" lost!
}
```

### **Rule 4: Idempotency**
```javascript
// Same input + same config = same output
// Cache key: hash(rawText + companyId + scrabEngineVersion)
```

---

## 📋 **Database Schema**

```javascript
// company.aiAgentSettings.scrabEngine
scrabEngine: {
  enabled: { type: Boolean, default: true },
  version: { type: String, default: '1.0.0' },
  
  // Stage 1: Fillers
  fillers: {
    enabled: { type: Boolean, default: true },
    customFillers: [{ 
      phrase: String,        // "basically"
      enabled: Boolean,
      priority: Number
    }],
    stripGreetings: { type: Boolean, default: true },
    stripCompanyName: { type: Boolean, default: true }
  },
  
  // Stage 2: Vocabulary Normalization
  vocabulary: {
    enabled: { type: Boolean, default: true },
    entries: [{
      id: String,
      enabled: Boolean,
      priority: Number,
      from: String,          // "acee"
      to: String,            // "ac"
      matchMode: {           // "EXACT" | "CONTAINS"
        type: String,
        enum: ['EXACT', 'CONTAINS'],
        default: 'EXACT'
      }
    }]
  },
  
  // Stage 3: Synonym Expansion (Metadata)
  synonyms: {
    enabled: { type: Boolean, default: true },
    
    // Simple word-to-words
    wordSynonyms: [{
      id: String,
      enabled: Boolean,
      word: String,          // "schedule"
      synonyms: [String],    // ["book", "arrange", "set up"]
      priority: Number
    }],
    
    // Context-aware patterns
    contextPatterns: [{
      id: String,
      enabled: Boolean,
      pattern: [String],     // ["thing", "garage"]
      component: String,     // "air handler"
      contextTokens: [String], // ["air", "handler", "ahu"]
      confidence: Number,    // 0.0-1.0
      priority: Number
    }]
  },
  
  // Quality gates
  qualityGates: {
    minWordCount: { type: Number, default: 2 },
    minConfidence: { type: Number, default: 0.5 },
    repromptOnLowQuality: { type: Boolean, default: true }
  }
}
```

---

## 🔌 **Integration Points**

### **Called From:**
`services/engine/agent2/Agent2DiscoveryRunner.js`

### **Current Code (Line ~550):**
```javascript
// BEFORE (scattered):
const preprocessResult = Agent2SpeechPreprocessor.preprocess(...);
const vocabularyResult = Agent2VocabularyEngine.process(...);

// AFTER (unified):
const scrabResult = await ScrabEngine.process({
  rawText: input,
  company: company,
  callContext: {
    companyName: company.businessName,
    turn: turn,
    callSid: callSid
  }
});

// Use cleaned text for triggers
const normalizedInput = scrabResult.normalized.text;
const expandedTokens = scrabResult.expanded.expandedTokens;

// Pass to TriggerMatcher
const triggerResult = TriggerCardMatcher.match(normalizedInput, triggerCards, {
  expandedTokens: expandedTokens,  // NEW: flexible synonym matching
  hints: activeHints,
  locks: activeLocks
});
```

---

## 🎨 **UI Page: scrabengine.html**

### **Layout:**

```
┌─────────────────────────────────────────────────────────────┐
│  ScrabEngine - Text Processing Pipeline                     │
│                                                              │
│  [Overview Tab] [Fillers] [Vocabulary] [Synonyms] [Testing] │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  📊 OVERVIEW TAB                                             │
│  ──────────────────────────────────────────────────────────│
│  Processing Stats (Last 24h):                                │
│    ✓ 1,234 calls processed                                  │
│    ✓ 456 fillers removed                                    │
│    ✓ 89 vocabulary normalizations applied                   │
│    ✓ 234 tokens expanded                                    │
│    ⚡ Avg processing time: 12ms                              │
│                                                              │
│  Pipeline Status:                                            │
│    [✓] Stage 1: Fillers (23 rules active)                   │
│    [✓] Stage 2: Vocabulary (45 rules active)                │
│    [✓] Stage 3: Synonyms (67 expansions active)             │
│                                                              │
│  [View Recent Transformations]                               │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### **Three Modals:**

#### **Modal 1: Manage Fillers**
```
┌─────────────────────────────────────────┐
│  Filler Words Configuration              │
├─────────────────────────────────────────┤
│  Built-in Fillers (always active):       │
│    [x] um, uh, er, ah                    │
│    [x] you know, i mean                  │
│    [x] like, basically, actually         │
│                                          │
│  Custom Fillers:                         │
│  ┌─────────────────────────────────────┐│
│  │ Phrase: [so anyway________] [x] [🗑]││
│  │ Phrase: [right so_________] [x] [🗑]││
│  └─────────────────────────────────────┘│
│  [+ Add Custom Filler]                   │
│                                          │
│  Options:                                │
│  [x] Strip greetings at start            │
│  [x] Strip company name mentions         │
│  [x] Remove duplicate words              │
│                                          │
│  [Cancel] [Save Changes]                 │
└─────────────────────────────────────────┘
```

#### **Modal 2: Manage Vocabulary**
```
┌─────────────────────────────────────────┐
│  Vocabulary Normalizations               │
├─────────────────────────────────────────┤
│  Mishear Corrections:                    │
│  ┌─────────────────────────────────────┐│
│  │ From: [acee_____] → To: [ac_____]   ││
│  │ Mode: [EXACT ▼] Priority: [10___]   ││
│  │ [x] Enabled                     [🗑] ││
│  ├─────────────────────────────────────┤│
│  │ From: [tstat____] → To: [thermostat]││
│  │ Mode: [EXACT ▼] Priority: [10___]   ││
│  │ [x] Enabled                     [🗑] ││
│  └─────────────────────────────────────┘│
│                                          │
│  Industry Slang:                         │
│  ┌─────────────────────────────────────┐│
│  │ From: [pulling__] → To: [cooling_]  ││
│  │ From: [not blowing] → [not working] ││
│  └─────────────────────────────────────┘│
│                                          │
│  [+ Add Normalization]                   │
│  [Cancel] [Save Changes]                 │
└─────────────────────────────────────────┘
```

#### **Modal 3: Manage Synonyms** ⭐ NEW
```
┌─────────────────────────────────────────┐
│  Smart Synonyms (Token Expansion)       │
├─────────────────────────────────────────┤
│  📌 Simple Word Synonyms                 │
│  ┌─────────────────────────────────────┐│
│  │ Word: [schedule_____________]        ││
│  │ Synonyms: [book, arrange, set up]   ││
│  │ [x] Enabled            Priority: [50]││
│  │                                 [🗑] ││
│  ├─────────────────────────────────────┤│
│  │ Word: [broken_______________]        ││
│  │ Synonyms: [not working, down, failed]││
│  └─────────────────────────────────────┘│
│                                          │
│  🎯 Context-Aware Patterns               │
│  ┌─────────────────────────────────────┐│
│  │ Pattern Words: [thing, garage____]   ││
│  │ Component: [air handler__________]   ││
│  │ Add Tokens: [ahu, indoor unit____]   ││
│  │ Confidence: [90%] Priority: [100]    ││
│  │ [x] Enabled                     [🗑] ││
│  ├─────────────────────────────────────┤│
│  │ Pattern Words: [thing, outside,      ││
│  │                 spinning________]    ││
│  │ Component: [condenser___________]    ││
│  │ Add Tokens: [fan, outdoor unit__]    ││
│  └─────────────────────────────────────┘│
│                                          │
│  [+ Add Word Synonym]                    │
│  [+ Add Context Pattern]                 │
│  [Cancel] [Save Changes]                 │
└─────────────────────────────────────────┘
```

---

## 🧪 **Built-in Testing Panel**

```
┌─────────────────────────────────────────┐
│  Live Testing                            │
├─────────────────────────────────────────┤
│  Test Input:                             │
│  ┌─────────────────────────────────────┐│
│  │ um the thing in the garage isn't    ││
│  │ pulling you know                    ││
│  └─────────────────────────────────────┘│
│  [Process Text]                          │
│                                          │
│  Results:                                │
│  ──────────────────────────────────────│
│  Raw Text:                               │
│    "um the thing in the garage isn't    │
│     pulling you know"                   │
│                                          │
│  Stage 1 - Fillers Removed:              │
│    "the thing in the garage isn't       │
│     pulling"                             │
│    Removed: [um, you know]               │
│                                          │
│  Stage 2 - Vocabulary Applied:           │
│    "the thing in the garage isn't       │
│     cooling"                             │
│    Normalized: [pulling → cooling]       │
│                                          │
│  Stage 3 - Tokens Expanded:              │
│    Original: [thing, garage, isn't,     │
│               cooling]                   │
│    Expanded: [thing, garage, air,       │
│               handler, ahu, isn't, not, │
│               cooling, working, running] │
│    Patterns: [thing+garage → air handler]│
│                                          │
│  Processing Time: 14ms                   │
│                                          │
│  What Triggers Will See:                 │
│    Text: "the air handler isn't cooling"│
│    Tokens: [all expanded tokens...]      │
└─────────────────────────────────────────┘
```

---

## 📁 **File Structure**

```
services/
  ScrabEngine.js                    ← Main service (unified processor)
  
public/agent-console/
  scrabengine.html                  ← UI page
  scrabengine.js                    ← Frontend logic
  
routes/agentConsole/
  scrabEngine.js                    ← API routes (GET/POST config)
  
models/
  v2Company.js                      ← Schema updated (scrabEngine field)
```

---

## 🔄 **Migration Plan**

### **Phase 1: Create ScrabEngine Service**
1. Create `services/ScrabEngine.js`
2. Consolidate logic from:
   - Agent2SpeechPreprocessor (fillers)
   - Agent2VocabularyEngine (normalizations)
3. Add new: Token expansion system
4. Write comprehensive tests

### **Phase 2: Update Agent2DiscoveryRunner**
1. Replace scattered calls with single `ScrabEngine.process()`
2. Pass expanded tokens to TriggerCardMatcher
3. Update TriggerCardMatcher to use expanded tokens

### **Phase 3: Update TriggerCardMatcher**
1. Add `expandedTokens` parameter
2. Match against both original + expanded tokens
3. Log which tokens matched (original vs expanded)

### **Phase 4: Build UI**
1. Create `scrabengine.html` page
2. Three modals for configuration
3. Live testing panel
4. API routes for CRUD operations

### **Phase 5: Add to Agent Console Navigation**
1. Add link in Agent Console sidebar
2. Add to company-specific Agent 2.0 section
3. Breadcrumb: Agent Console → Agent 2.0 → ScrabEngine

---

## 🎯 **Success Metrics**

### **Performance Targets:**
- ✅ Total processing time: < 30ms
- ✅ 99.9% uptime (no crashes)
- ✅ Idempotent (same input = same output)

### **Quality Targets:**
- ✅ Trigger match rate improves by 10-15%
- ✅ LLM fallback reduced by 10-15%
- ✅ Zero meaning changes in audit

### **Usability Targets:**
- ✅ 3 clear modals (easy to configure)
- ✅ Live testing (instant feedback)
- ✅ Transformation audit trail (full transparency)

---

## 🚀 **Ready to Build?**

**Next Steps:**
1. ✅ Review this spec
2. Create `services/ScrabEngine.js` (backend)
3. Update Agent2DiscoveryRunner integration
4. Build `scrabengine.html` (UI)
5. Test with real call data

**Estimated Build Time:**
- Backend service: 2-3 hours
- UI page: 3-4 hours
- Testing & integration: 2 hours
- **Total: ~7-9 hours of focused work**

**Ready to start coding?** Say the word and I'll begin implementation! 🚀
