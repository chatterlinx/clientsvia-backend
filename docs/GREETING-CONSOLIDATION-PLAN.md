# Greeting System Consolidation Plan

## Problem Statement

Currently have **TWO separate greeting systems**:

1. **Name Greeting** (Triggers page) - Handles `{name}` personalization
   - One-time opening line
   - `Hello {name}, thank you for calling.`
   - Fires once at start of call

2. **Greeting Rules** (Flow Builder) - Handles time-based greetings
   - `good morning` → "Good morning! How can I help you today?"
   - `good evening` → "Good evening! How can I help you today?"
   - `hi, hello, hey` → "Hi! How can I help you today?"
   - NO `{name}` support currently

**These should be ONE unified system!**

---

## Proposed Solution

### Consolidate into Greeting Rules with `{name}` Support

**Location:** Keep in Triggers page (top section)

**Rename Section:** "Name Greeting" → **"Greetings & Name Recognition"**

---

## New Unified Greeting System

### Schema (greeting.interceptor.rules[]):

```javascript
{
  ruleId: "greeting_good_morning",
  enabled: true,
  priority: 13,
  matchType: "FUZZY",
  triggers: ["good morning"],
  response: "Good morning{name}! How can I help you today?", // ⬅️ {name} support!
  audioUrl: "",
  supportNamePlaceholder: true  // ⬅️ NEW: indicates {name} should be replaced
}
```

### Runtime Behavior:

**Caller says:** "Good morning, this is John"

**Processing:**
1. ScrabEngine extracts: `firstName: "John"`
2. Greeting Interceptor matches: `good morning` trigger
3. Response template: `Good morning{name}! How can I help you today?`
4. **{name} replacement:**
   - If name: `Good morning, John! How can I help you today?`
   - If no name: `Good morning! How can I help you today?`

---

## Priority Order (Most Specific → Generic)

```
Priority  Triggers           Response Template
  13      good evening       Good evening{name}! How can I help you today?
  12      good afternoon     Good afternoon{name}! How can I help you today?
  11      good morning       Good morning{name}! How can I help you today?
  10      hi, hello, hey     Hi{name}! How can I help you today?
```

**{name} Resolution:**
- With name: `Good morning, John!`
- Without name: `Good morning!`
- Comma auto-handled: `{name}` becomes `, John` or ``

---

## UI Changes

### ✅ Update Triggers Page (Top Section)

**Before:**
```
┌──────────────────────────┐
│ Name Greeting            │
│ [Hello {name}...]        │
└──────────────────────────┘
```

**After:**
```
┌─────────────────────────────────────────────────────────────┐
│ 🎭 Greetings & Name Recognition                             │
├─────────────────────────────────────────────────────────────┤
│ ☑ Enable Greeting Interceptor                              │
│ ☑ Always Greet (ON = greet even without name)             │
│                                                             │
│ Greeting Rules (Priority Order):                           │
│ ┌───────────────────────────────────────────────────────┐  │
│ │ ON  PRI  MATCH   TRIGGERS          RESPONSE     AUDIO │  │
│ │ ☑   13   FUZZY   good evening      Good evening{name}│  │
│ │ ☑   12   FUZZY   good afternoon    Good afternoon... │  │
│ │ ☑   11   FUZZY   good morning      Good morning...   │  │
│ │ ☑   10   FUZZY   hi, hello, hey    Hi{name}...       │  │
│ └───────────────────────────────────────────────────────┘  │
│                                                             │
│ {name} Placeholder:                                         │
│ • Automatically replaced with caller's first name          │
│ • If no name: {name} is removed cleanly                    │
│ • Example: "Good morning{name}!" → "Good morning, John!"   │
│                                                             │
│ + Add Greeting Rule                                        │
└─────────────────────────────────────────────────────────────┘
```

### ✅ Update Flow Builder

**Show {name} support in greeting rule editor:**
- Response field shows: `Good morning{name}! How can I help you today?`
- Help text: "Use {name} to insert caller's first name. It's removed if name not captured."
- Preview shows both versions:
  - With name: "Good morning, John! How can I help you today?"
  - Without name: "Good morning! How can I help you today?"

### ❌ Remove Separate Name Greeting Modal

No longer needed - all functionality merged into Greeting Rules table.

---

## Backend Changes

### ✅ Update Agent2GreetingInterceptor

**File:** `services/engine/agent2/Agent2GreetingInterceptor.js`

**Add name replacement logic:**

```javascript
// When greeting rule fires:
let responseText = matchedRule.response;

// Replace {name} placeholder
if (responseText.includes('{name}') && callerName) {
  // With name: "Good morning{name}!" → "Good morning, John!"
  responseText = responseText.replace(/\{name\}/g, `, ${callerName}`);
} else {
  // Without name: "Good morning{name}!" → "Good morning!"
  responseText = responseText.replace(/\{name\}/g, '');
}

// Clean up extra spaces
responseText = responseText.replace(/\s+/g, ' ').trim();
```

### ✅ Update Greeting Rules API

**File:** `routes/admin/greetings.js`

No changes needed - already supports arbitrary response text. Just add `{name}` to responses via UI.

---

## Migration Steps

### Step 1: Update Backend (Name Replacement Logic)
- Modify `Agent2GreetingInterceptor.evaluate()` to accept `callerName` parameter
- Add `{name}` replacement logic before returning response
- Test: "Good morning{name}!" with name="John" → "Good morning, John!"

### Step 2: Update Triggers Page UI
- Rename section: "Name Greeting" → "Greetings & Name Recognition"
- Replace single greeting field with Greeting Rules table (same as Flow Builder)
- Add `{name}` help text and examples
- Remove separate Name Greeting modal (redundant)

### Step 3: Update Flow Builder UI
- Add `{name}` placeholder documentation to response field
- Show preview with/without name

### Step 4: Update Default Greeting Rules
- Add `{name}` to all default greeting responses:
  - `Good morning{name}! How can I help you today?`
  - `Good afternoon{name}! How can I help you today?`
  - `Good evening{name}! How can I help you today?`
  - `Hi{name}! How can I help you today?`

### Step 5: Remove Legacy Name Greeting
- Remove "Name Greeting" modal from Triggers page
- Update documentation to refer to unified Greeting Rules
- Clean up redundant code

---

## Testing Scenarios

### Test 1: Time-Based Greeting with Name
**Input:** "Good morning, this is Sarah"
**Expected:** "Good morning, Sarah! How can I help you today?"
**Verify:** {name} replaced correctly with comma

### Test 2: Time-Based Greeting without Name
**Input:** "Good morning"
**Expected:** "Good morning! How can I help you today?"
**Verify:** {name} removed cleanly, no extra spaces

### Test 3: Generic Greeting with Name
**Input:** "Hi, I'm Mark"
**Expected:** "Hi, Mark! How can I help you today?"
**Verify:** Generic greeting uses {name}

### Test 4: Generic Greeting without Name
**Input:** "Hello"
**Expected:** "Hi! How can I help you today?"
**Verify:** Works without name

### Test 5: Greeting + Intent (Should Skip Greeting)
**Input:** "Good morning, my AC is not cooling"
**Expected:** Triggers evaluate, not greeting response
**Verify:** Intent words block greeting, go straight to trigger matching

---

## Benefits

✅ **Single source of truth** - One place to configure all greetings  
✅ **Name-aware** - All greetings support {name} personalization  
✅ **Time-aware** - Good morning/afternoon/evening auto-handled  
✅ **Priority-based** - Most specific greeting wins  
✅ **No duplication** - Not managing two separate systems  
✅ **Simpler UI** - One table, clear and organized  
✅ **Easier to understand** - "If you want to customize greetings, go here"  

---

## Implementation Checklist

- [ ] Update `Agent2GreetingInterceptor.evaluate()` to accept callerName
- [ ] Add `{name}` replacement logic in interceptor
- [ ] Pass callerName from Agent2DiscoveryRunner to interceptor
- [ ] Update default greeting rules to include `{name}`
- [ ] Redesign Triggers page greeting section
- [ ] Remove Name Greeting modal
- [ ] Update Flow Builder greeting rule editor
- [ ] Add {name} help text and examples
- [ ] Test all scenarios
- [ ] Update documentation

---

## Next Steps

**Ready to proceed?**

1. Start with backend (name replacement logic)
2. Update Triggers page UI
3. Test with real calls
4. Remove legacy Name Greeting modal

**Estimated effort:** 2-3 hours of focused work

---

**Status:** Plan approved, ready to implement ✅
