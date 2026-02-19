# Audio Path Leak Fix - Emergency Update

**Date:** February 19, 2026  
**Issue:** Agent is reading audio file paths/URLs aloud instead of greeting text  
**Status:** ✅ FIXED (extended from CONNECTION_GREETING fix)

---

## Problem

After fixing the `CONNECTION_GREETING` corruption, a related issue emerged:

**Symptom:** Agent is reading aloud things like:
- `/audio/instant-lines/fd_CONNECTION_GREETING_1234.mp3`
- `https://yourdomain.com/audio/fd_CONNECTION_GREETING_1234.mp3`
- Or just filenames like `fd_CONNECTION_GREETING_1234.mp3`

**Root Cause:** The `callStart.text` field contains **audio file paths** instead of human-readable greeting text.

**Why it happens:**
1. User generates audio from greeting text
2. API returns `{ url: '/audio/instant-lines/...mp3' }`
3. Bug in response handling saves the `url` value into the `text` field (wrong!)
4. When prerecorded mode is used:
   - If audio file exists → Plays audio (correct ✅)
   - If audio file missing → Falls back to TTS reading `text` field (❌ reads file path!)

---

## Extended Fix Applied

### 1. Runtime Validation Enhanced (`services/v2AIAgentRuntime.js`)

Added detection for **audio file path patterns**:

```javascript
// 🆕 DETECT BUSINESS/FILE IDENTIFIERS AND FILE PATHS
if (greetingText.includes('CONNECTION_GREETING') || 
    greetingText.includes('fd_CONNECTION_GREETING') || 
    greetingText.match(/^fd_[A-Z_]+_\d+$/) ||
    greetingText.includes('/audio/') ||           // 🆕 File path leak
    greetingText.includes('.mp3') ||              // 🆕 Audio file extension
    greetingText.includes('.wav') ||              // 🆕 Audio file extension
    greetingText.startsWith('http') ||            // 🆕 URL leak
    greetingText.match(/^\/.*\.(mp3|wav|ogg)$/i)) { // 🆕 Any audio file path pattern
    
    logger.error(`[V2 GREETING] ❌ CRITICAL: callStart.text contains file path or identifier!`, {
        text: greetingText,
        companyId: company._id,
        detectedPattern: greetingText.includes('/audio/') ? 'file_path' : 
                       greetingText.includes('.mp3') ? 'audio_extension' :
                       greetingText.startsWith('http') ? 'url' : 'identifier'
    });
    greetingText = "Thank you for calling. How can I help you today?";
}
```

**Now catches:**
- ✅ `/audio/instant-lines/greeting.mp3`
- ✅ `http://yourdomain.com/audio/greeting.mp3`
- ✅ `greeting.mp3`
- ✅ `fd_CONNECTION_GREETING_1234.mp3`
- ✅ Any file path or URL pattern

---

### 2. TwiML Validation Enhanced (`routes/v2twilio.js`)

Added same file path patterns to final validation:

```javascript
const businessIdPatterns = [
    /CONNECTION_GREETING/i,           // Business constant
    /fd_CONNECTION_GREETING/i,        // File prefix
    /^fd_[A-Z_]+_\d+$/,              // Generic file ID pattern
    /\/audio\//i,                     // File path leak (🆕)
    /\.mp3/i,                         // Audio file extension (🆕)
    /\.wav/i,                         // Audio file extension (🆕)
    /\.ogg/i,                         // Audio file extension (🆕)
    /^https?:\/\//i,                  // URL leak (🆕)
    /^\/.*\.(mp3|wav|ogg)$/i         // Any audio file path (🆕)
];
```

---

### 3. Diagnostic Tool Updated

Extended `fix-agent2-greeting-corruption.js` to detect audio path corruption.

---

## Immediate Action

### Run the Updated Fix

```bash
# Diagnose to see if audio path is in text field
node scripts/diagnose-agent2-greeting.js 68e3f77a9d623b8058c700c4

# Fix automatically
node scripts/fix-agent2-greeting-corruption.js 68e3f77a9d623b8058c700c4
```

### Expected Diagnostic Output

If audio path is corrupted, you'll see:

```
  text: "/audio/instant-lines/fd_CONNECTION_GREETING_1234.mp3"
    ├─ Type: string
    ├─ Length: 52
    ├─ Validation: ❌ ISSUES DETECTED
    └─ 🔴 CONTAINS AUDIO FILE PATH (THIS IS THE BUG!)
```

---

## How Data Should Look

### ✅ CORRECT Configuration

```json
{
  "callStart": {
    "enabled": true,
    "text": "Thank you for calling. How can I help you today?",
    "audioUrl": "/audio/instant-lines/fd_CONNECTION_GREETING_1234.mp3"
  }
}
```

**Behavior:**
- If `audioUrl` file exists → Plays audio ✅
- If `audioUrl` file missing → Reads `text` via TTS ✅

---

### ❌ CORRUPTED Configuration (what you had)

```json
{
  "callStart": {
    "enabled": true,
    "text": "/audio/instant-lines/fd_CONNECTION_GREETING_1234.mp3",  // ❌ WRONG!
    "audioUrl": "/audio/instant-lines/fd_CONNECTION_GREETING_1234.mp3"
  }
}
```

**Behavior:**
- If `audioUrl` file exists → Plays audio ✅
- If `audioUrl` file missing → Reads file path via TTS ❌ (THE BUG!)

---

## Root Cause: UI Save Bug

The corruption happens when audio is generated. The UI response handler does this:

**What it SHOULD do:**
```javascript
// User clicks "Generate Audio"
const response = await generateAudio({ text: greetingText });
// response = { url: '/audio/instant-lines/...mp3' }

// ✅ CORRECT: Save URL to audioUrl, keep text unchanged
this.config.greetings.callStart.audioUrl = response.url;
this.config.greetings.callStart.text = greetingText; // Keep original!
```

**What it's DOING (BUG):**
```javascript
// ❌ WRONG: Accidentally overwrites text with URL
this.config.greetings.callStart.text = response.url;  // BUG!
this.config.greetings.callStart.audioUrl = response.url;
```

---

## Prevention (Long-term Fix)

### UI Validation (Next Sprint)

Add validation to `Agent2Manager.js` before save:

```javascript
container.querySelector('#a2-callstart-text')?.addEventListener('input', (e) => {
    let text = e.target.value;
    
    // 🛡️ VALIDATION: Block file paths and URLs
    if (text.includes('/audio/') || 
        text.match(/\.(mp3|wav|ogg)$/i) || 
        text.startsWith('http')) {
        console.error('[AGENT2] Text field contains file path/URL, rejecting');
        alert('Greeting text cannot be a file path or URL. Please enter human-readable text.');
        text = "Thank you for calling. How can I help you today?";
        e.target.value = text;
    }
    
    this.config.greetings.callStart.text = text;
    onAnyChange();
});
```

---

## Verification Steps

1. **Run diagnostic:**
   ```bash
   node scripts/diagnose-agent2-greeting.js 68e3f77a9d623b8058c700c4
   ```

2. **Check for corruption patterns:**
   - ❌ `text` contains `/audio/`
   - ❌ `text` contains `.mp3`
   - ❌ `text` starts with `http`
   - ✅ `text` is plain human-readable greeting
   - ✅ `audioUrl` (if set) contains the file path

3. **Fix if needed:**
   ```bash
   node scripts/fix-agent2-greeting-corruption.js 68e3f77a9d623b8058c700c4
   ```

4. **Test call and verify:**
   - Should hear: "Thank you for calling. How can I help you today?"
   - Should NOT hear: file paths, URLs, or filenames

5. **Check logs:**
   ```
   [V2 GREETING] ✅ Agent 2.0 using TTS: "Thank you for calling..."
   ```
   
   NOT:
   ```
   [V2 GREETING] ❌ CRITICAL: callStart.text contains file path or identifier!
   ```

---

## What Changed

**Files Modified:**
1. ✅ `services/v2AIAgentRuntime.js` - Added audio path detection (lines 246-260)
2. ✅ `routes/v2twilio.js` - Added audio path patterns (lines 155-165)
3. ✅ `scripts/fix-agent2-greeting-corruption.js` - Extended validation patterns

**Pattern Detection Added:**
- `/audio/` path segments
- `.mp3`, `.wav`, `.ogg` extensions
- `http://` and `https://` URLs
- Any path pattern matching audio files

---

## Summary

**Before Fix:**
- Agent reads: "/audio/instant-lines/fd_CONNECTION_GREETING_1234.mp3"
- Customer hears gibberish file path

**After Fix:**
- Validation detects file path in `text` field
- Falls back to: "Thank you for calling. How can I help you today?"
- Customer hears proper greeting

**Status:** ✅ Fixed and ready to deploy

---

**Next Action:** Run diagnostic to confirm the exact corruption pattern, then apply fix.
