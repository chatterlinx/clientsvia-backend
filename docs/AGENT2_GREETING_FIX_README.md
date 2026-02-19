# Agent 2.0 Greeting Fix - Complete Guide

## Problem Statement

**Symptom:** Agent 2.0 is reading out "connection greeting code" or similar internal identifiers instead of the actual greeting text.

**Root Cause:** Data corruption in the `callStart.text` field, where internal constants like `"CONNECTION_GREETING"` or file IDs like `"fd_CONNECTION_GREETING_1234567890"` are being saved instead of human-readable greeting text.

**Affected Company:** `68e3f77a9d623b8058c700c4` (and potentially others)

---

## Quick Fix (TL;DR)

```bash
# Step 1: Diagnose the issue
node scripts/agent2-greeting-doctor.js 68e3f77a9d623b8058c700c4

# Step 2: Fix it automatically
node scripts/agent2-greeting-doctor.js 68e3f77a9d623b8058c700c4 --fix

# Step 3: Test by calling the number
# Should hear: "Thank you for calling. How can I help you today?"
```

---

## What Was Fixed

### 1. Enhanced Runtime Validation
**File:** `services/v2AIAgentRuntime.js`

Added detection for internal business identifiers that were leaking into TTS:

- `CONNECTION_GREETING` (business constant)
- `fd_CONNECTION_GREETING` (file prefix)
- `fd_SOME_CONSTANT_123` (generic file ID pattern)

**Behavior:** If detected, falls back to safe default greeting.

### 2. Enhanced TwiML Validation
**File:** `routes/v2twilio.js`

Added the same business ID detection as a final safety check before TwiML is sent to Twilio.

**Behavior:** Last line of defense - prevents corrupted text from ever reaching caller.

### 3. Diagnostic & Repair Tools
Created 3 new scripts for investigating and fixing corruption:

1. **`diagnose-agent2-greeting.js`** - Deep inspection of greeting config
2. **`fix-agent2-greeting-corruption.js`** - Automated repair of corrupted data
3. **`agent2-greeting-doctor.js`** - All-in-one tool (diagnose + fix)

---

## Tools Guide

### Tool 1: Greeting Doctor (Recommended)
**Best for:** Quick diagnosis and fix

```bash
# Diagnose only (safe, read-only)
node scripts/agent2-greeting-doctor.js <companyId>

# Diagnose and fix automatically
node scripts/agent2-greeting-doctor.js <companyId> --fix
```

**Example:**
```bash
node scripts/agent2-greeting-doctor.js 68e3f77a9d623b8058c700c4 --fix
```

**Output:**
- Full diagnostic report
- Automatic fix if corruption detected
- Before/after comparison
- Next steps for verification

---

### Tool 2: Detailed Diagnostic
**Best for:** Investigation and troubleshooting

```bash
node scripts/diagnose-agent2-greeting.js <companyId>
```

**What it shows:**
- Raw database values
- Field-by-field analysis
- Validation checks with detailed reasons
- Predicted runtime behavior
- Issues summary with recommendations

**Example output:**
```
📞 CALL START GREETING:

Field Analysis:

  text: "CONNECTION_GREETING"
    ├─ Type: string
    ├─ Length: 19
    ├─ Validation: ❌ ISSUES DETECTED
    └─ 🔴 CONTAINS "CONNECTION_GREETING" (THIS IS THE BUG!)

🎯 PREDICTED RUNTIME BEHAVIOR

🛡️  FALLBACK MODE (Validation failed)
   → Detected issues with text field
   → Will use safe default: "Thank you for calling. How can I help you today?"

RECOMMENDED ACTION:
  Run: node scripts/fix-agent2-greeting-corruption.js 68e3f77a9d623b8058c700c4
```

---

### Tool 3: Fix Corruption
**Best for:** Automated repair after confirming corruption

```bash
node scripts/fix-agent2-greeting-corruption.js <companyId>
```

**What it does:**
1. Validates `callStart.text` field
2. Validates `callStart.audioUrl` field
3. Replaces corrupted values with safe defaults
4. Saves fixes to database
5. Shows before/after comparison

**Example output:**
```
📊 CURRENT STATE:
{
  "enabled": true,
  "text": "CONNECTION_GREETING",
  "audioUrl": ""
}

❌ CORRUPTION DETECTED IN TEXT FIELD:
   Reason: Text contains internal identifier: CONNECTION_GREETING constant
   Current value: "CONNECTION_GREETING"
   Fixed value: Thank you for calling. How can I help you today?

💾 SAVING FIXES...

✅ FIXES SAVED SUCCESSFULLY!

📊 NEW STATE:
{
  "enabled": true,
  "text": "Thank you for calling. How can I help you today?",
  "audioUrl": ""
}
```

---

## Verification Workflow

### Step 1: Check Current State
```bash
node scripts/diagnose-agent2-greeting.js 68e3f77a9d623b8058c700c4
```

Look for corruption indicators:
- ❌ `CONTAINS "CONNECTION_GREETING"`
- ❌ `CONTAINS "fd_CONNECTION_GREETING"`
- ❌ `LOOKS LIKE FILE ID`
- ❌ `Type: object` (should be string)

### Step 2: Fix if Needed
```bash
node scripts/fix-agent2-greeting-corruption.js 68e3f77a9d623b8058c700c4
```

### Step 3: Test the Call
1. **Call the company's number**
2. **Listen to the greeting**
3. **Expected:** "Thank you for calling. How can I help you today?"
4. **Not expected:** "CONNECTION_GREETING" or any code/IDs

### Step 4: Verify TwiML (Optional)
1. Go to **Twilio Console** → **Monitor** → **Logs** → **Request Inspector**
2. Find your test call
3. Click the `/voice` webhook request
4. Check **Response Body**

**Good TwiML:**
```xml
<Response>
    <Gather input="speech" action="...">
        <Say>Thank you for calling. How can I help you today?</Say>
    </Gather>
</Response>
```

**Bad TwiML:**
```xml
<Response>
    <Gather input="speech" action="...">
        <Say>CONNECTION_GREETING</Say>
    </Gather>
</Response>
```

---

## Understanding the Fix

### 3-Tier Defense System

The fix implements **defense in depth** at 3 levels:

```
┌─────────────────────────────────────────────────────────────┐
│ LAYER 1: Runtime Load (v2AIAgentRuntime.js)                 │
│ ─────────────────────────────────────────────────────────── │
│ When: Greeting is generated from database                   │
│ What: Validates text, detects corruption patterns           │
│ If corrupted: Falls back to safe default + logs error       │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ LAYER 2: TwiML Generation (v2twilio.js)                     │
│ ─────────────────────────────────────────────────────────── │
│ When: TwiML is being built for Twilio                       │
│ What: Final validation before sending to Twilio             │
│ If corrupted: Falls back to safe default + logs error       │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ LAYER 3: Logging & Monitoring                               │
│ ─────────────────────────────────────────────────────────── │
│ When: Corruption is detected at any layer                   │
│ What: Detailed error logs with company ID and text preview  │
│ Result: Ops team can investigate root cause                 │
└─────────────────────────────────────────────────────────────┘
```

### Corruption Patterns Detected

The validation catches these patterns:

1. **Type Errors**
   - Not a string (object, array, number, null, undefined)

2. **Empty Strings**
   - Empty or whitespace-only

3. **JSON/Code**
   - Starts with `{` or `[`
   - Contains `function`, `const`, `let`, `var`, etc.

4. **Business Identifiers** ⭐ (THE SMOKING GUN)
   - `CONNECTION_GREETING`
   - `fd_CONNECTION_GREETING`
   - `fd_SOME_CONSTANT_123`

5. **Length Limits**
   - Over 500 characters (truncated)

---

## Monitoring for Recurrence

### What to Watch For

After the fix is deployed, monitor logs for these patterns:

**Good (no issues):**
```
[V2 GREETING] ✅ Agent 2.0 using TTS: "Thank you for calling. How can I help you today?"
```

**Bad (corruption detected but sanitized):**
```
[V2 GREETING] ❌ CRITICAL: callStart.text contains internal identifier!
  text: "CONNECTION_GREETING"
  companyId: "68e3f77a9d623b8058c700c4"
```

If you see the bad pattern:
- ✅ **Good news:** Validation is working (customer didn't hear corrupted text)
- ❌ **Bad news:** There's a source of corruption that needs investigation

### Investigation Steps

If corruption keeps occurring:

1. **Check the UI save flow**
   - File: `public/js/ai-agent-settings/Agent2Manager.js`
   - Look for audio generation workflow
   - Verify text field isn't being overwritten

2. **Check the API save endpoint**
   - File: `routes/admin/agent2.js`
   - Add validation middleware (see audit report)

3. **Run diagnostic on affected company**
   ```bash
   node scripts/diagnose-agent2-greeting.js <companyId>
   ```

---

## Custom Greeting Setup

After fixing corruption, to set a custom greeting:

### Option 1: Via UI (Recommended)
1. Go to **AI Agent Settings** → **Agent 2.0** tab
2. Click **Greetings** sub-tab
3. In **Call Start Greeting** section:
   - ✅ Keep "Enabled" checked
   - **Text:** Enter your custom greeting
   - **Audio URL:** Leave blank (unless you have pre-recorded audio)
4. Click **Save**

### Option 2: Via Database (Advanced)
```javascript
db.companies.updateOne(
  { _id: ObjectId("68e3f77a9d623b8058c700c4") },
  { 
    $set: { 
      "aiAgentSettings.agent2.greetings.callStart.text": "Your custom greeting here",
      "aiAgentSettings.agent2.greetings.callStart.audioUrl": ""
    }
  }
)
```

---

## Testing

### Unit Tests
Run the greeting validation tests:

```bash
npm test tests/agent2-greeting-validation.test.js
```

**Coverage:**
- Valid greeting text
- Type validation
- Empty string detection
- JSON/code detection
- Business ID detection ⭐
- Length validation
- Real-world corruption examples

### Integration Test
End-to-end test of the fix:

```bash
# 1. Create test corruption
node -e "
const mongoose = require('mongoose');
const Company = require('./models/v2Company');
mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const company = await Company.findById('TEST_COMPANY_ID');
  company.aiAgentSettings.agent2.greetings.callStart.text = 'CONNECTION_GREETING';
  await company.save();
  console.log('Test corruption created');
  process.exit(0);
});
"

# 2. Verify corruption detected
node scripts/diagnose-agent2-greeting.js TEST_COMPANY_ID

# 3. Fix it
node scripts/fix-agent2-greeting-corruption.js TEST_COMPANY_ID

# 4. Verify fix
node scripts/diagnose-agent2-greeting.js TEST_COMPANY_ID
```

---

## Documentation

- **[TWILIO_AGENT2_GREETING_AUDIT_REPORT.md](../TWILIO_AGENT2_GREETING_AUDIT_REPORT.md)** - Complete technical audit
- **[AGENT2_GREETING_FIX_SUMMARY.md](../AGENT2_GREETING_FIX_SUMMARY.md)** - Executive summary of changes
- **This file** - Usage guide and reference

---

## FAQ

### Q: Will this fix prevent future corruption?
**A:** The runtime validation will **catch and sanitize** corruption, but doesn't prevent it at the source. For full prevention, add validation to the UI and API save flows (see audit report for details).

### Q: What if I want to use pre-recorded audio instead of TTS?
**A:** Set `callStart.audioUrl` to your audio file URL and leave `callStart.text` as the fallback text (in case audio fails to load).

### Q: Can I set greeting text to empty to skip the greeting?
**A:** Yes, set `callStart.enabled: false` instead. Don't use empty text, as it will trigger the fallback.

### Q: What's the safe default greeting?
**A:** `"Thank you for calling. How can I help you today?"`

### Q: How do I check multiple companies at once?
**A:** Create a script that loops through company IDs:
```bash
for id in 68e3f77a9d623b8058c700c4 ANOTHER_ID ANOTHER_ID; do
  node scripts/agent2-greeting-doctor.js $id
done
```

---

## Support

If you need help or the issue persists:

1. Run diagnostic and paste output
2. Check Twilio Request Inspector and paste TwiML
3. Check application logs for `[V2 GREETING]` errors
4. Review the audit report for deep dive analysis

With these 3 pieces of data, the root cause can be pinpointed exactly.

---

**Status:** ✅ Fix deployed and tested  
**Last Updated:** February 19, 2026
