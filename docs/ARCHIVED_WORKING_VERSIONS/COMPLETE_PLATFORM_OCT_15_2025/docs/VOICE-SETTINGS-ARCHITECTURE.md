# 🎤 Voice Settings Architecture Documentation

## 🏗️ System Overview

The Voice Settings system enables **per-company ElevenLabs voice configuration** for AI-powered phone calls. This is a **multi-tenant system** where each company can configure their own voice independently.

---

## 📊 Database Schema Architecture

### **CRITICAL: aiAgentLogic Schema Structure**

The `aiAgentLogic` field is defined as a **proper Mongoose Schema** (NOT a plain object). This is essential for Mongoose to track nested changes.

```javascript
// Location: models/v2Company.js (Lines 98-207)

const aiAgentLogicSchema = new mongoose.Schema({
    enabled: { type: Boolean, default: true },
    version: { type: Number, default: 1 },
    lastUpdated: { type: Date, default: Date.now },
    
    // Initial Greeting
    initialGreeting: { 
        type: String, 
        default: 'Thank you for calling [Company Name]. How can I help you today?',
        trim: true,
        maxlength: 500
    },
    
    // Knowledge Source Thresholds
    thresholds: {
        companyQnA: { type: Number, min: 0, max: 1, default: 0.8 },
        tradeQnA: { type: Number, min: 0, max: 1, default: 0.75 },
        templates: { type: Number, min: 0, max: 1, default: 0.7 },
        inHouseFallback: { type: Number, min: 0, max: 1, default: 0.5 }
    },
    
    // Performance Metrics
    metrics: {
        totalCalls: { type: Number, default: 0 },
        avgResponseTime: { type: Number, default: 0 },
        successRate: { type: Number, default: 0 }
    },
    
    // 🎤 VOICE SETTINGS (THE CRITICAL PART)
    voiceSettings: {
        // API Configuration
        apiSource: { 
            type: String, 
            enum: ['clientsvia', 'own'], 
            default: 'clientsvia' 
        },
        apiKey: { 
            type: String, 
            trim: true, 
            default: null // Only used when apiSource = 'own'
        },
        voiceId: { 
            type: String, 
            trim: true, 
            default: null 
        },
        
        // Voice Quality Controls
        stability: { 
            type: Number, 
            min: 0, 
            max: 1, 
            default: 0.5 
        },
        similarityBoost: { 
            type: Number, 
            min: 0, 
            max: 1, 
            default: 0.7 
        },
        styleExaggeration: { 
            type: Number, 
            min: 0, 
            max: 1, 
            default: 0.0 
        },
        
        // Performance & Output
        speakerBoost: { 
            type: Boolean, 
            default: true 
        },
        aiModel: { 
            type: String, 
            enum: ['eleven_turbo_v2_5', 'eleven_multilingual_v2', 'eleven_monolingual_v1'], 
            default: 'eleven_turbo_v2_5' 
        },
        outputFormat: { 
            type: String, 
            enum: ['mp3_44100_128', 'mp3_22050_32', 'pcm_16000', 'pcm_22050', 'pcm_24000'], 
            default: 'mp3_44100_128' 
        },
        streamingLatency: { 
            type: Number, 
            min: 0, 
            max: 4, 
            default: 0 // 0 = best quality, higher = lower latency
        },
        
        // V2 Features
        enabled: { 
            type: Boolean, 
            default: true 
        },
        lastUpdated: { 
            type: Date, 
            default: Date.now 
        },
        version: { 
            type: String, 
            default: '2.0' 
        }
    }
}, { _id: false });
```

### **Company Schema Reference**

```javascript
// Location: models/v2Company.js (Lines 350-353)

const companySchema = new mongoose.Schema({
    // ... other fields ...
    
    aiAgentLogic: {
        type: aiAgentLogicSchema,  // ← CRITICAL: Reference to the schema, NOT inline object
        default: () => ({})
    },
    
    // ... other fields ...
});
```

---

## 🔴 **THE BUG WE FIXED**

### **Before (BROKEN):**
```javascript
// ❌ WRONG: Plain object (Mixed type)
aiAgentLogic: {
    enabled: { type: Boolean, default: true },
    voiceSettings: {
        voiceId: { type: String, default: null }
    }
}
```

**Problem:** Mongoose treats this as a **Mixed type** and doesn't track nested changes. When you save `company.aiAgentLogic.voiceSettings.voiceId`, Mongoose silently ignores it because it doesn't recognize it as a change.

### **After (FIXED):**
```javascript
// ✅ CORRECT: Proper schema reference
const aiAgentLogicSchema = new mongoose.Schema({ /* ... */ }, { _id: false });

aiAgentLogic: {
    type: aiAgentLogicSchema,
    default: () => ({})
}
```

**Solution:** By defining `aiAgentLogicSchema` separately and referencing it with `type: aiAgentLogicSchema`, Mongoose properly tracks ALL nested changes including `voiceSettings`.

---

## 🔄 Data Flow

### **1. Save Voice Settings (Frontend → Backend → Database)**

```
┌─────────────────────────────────────────────────────────────┐
│ Frontend: company-profile.html                               │
│ User clicks "Save Voice Settings"                           │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ POST /api/company/:companyId/v2-voice-settings             │
│ Route: routes/company/v2profile-voice.js                   │
│                                                             │
│ [SAVE-1 → SAVE-25] Comprehensive checkpoints               │
│                                                             │
│ 1. Validate company ID                                     │
│ 2. Fetch company from MongoDB                              │
│ 3. Update company.aiAgentLogic.voiceSettings               │
│ 4. Call company.save()                                     │
│ 5. Verify save by reloading from DB                        │
│ 6. Clear Redis cache                                       │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ MongoDB: companies collection                               │
│                                                             │
│ {                                                           │
│   _id: "68813026dd95f599c74e49c7",                         │
│   companyName: "atlas air",                                │
│   aiAgentLogic: {                                          │
│     voiceSettings: {                                       │
│       apiSource: "clientsvia",                             │
│       voiceId: "UgBBYS2sOqTuMpoF3BR0",                    │
│       stability: 0.5,                                      │
│       similarityBoost: 0.7,                                │
│       aiModel: "eleven_turbo_v2_5",                        │
│       // ... other settings ...                            │
│     }                                                       │
│   }                                                         │
│ }                                                           │
└─────────────────────────────────────────────────────────────┘
```

---

### **2. Use Voice Settings (Incoming Call → TTS → Twilio)**

```
┌─────────────────────────────────────────────────────────────┐
│ Incoming Call to Twilio Number                             │
│ +12392322030                                               │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ POST /api/twilio/voice                                      │
│ Route: routes/v2twilio.js                                   │
│                                                             │
│ 1. Look up company by phone number (from cache or DB)      │
│ 2. Call v2AIAgentRuntime.initializeCall()                 │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ v2AIAgentRuntime.initializeCall()                          │
│ Service: services/v2AIAgentRuntime.js                      │
│                                                             │
│ [CALL-1 → CALL-9] Comprehensive checkpoints                │
│                                                             │
│ 1. Load company from database                              │
│ 2. Extract voiceSettings from aiAgentLogic                 │
│ 3. Generate initial greeting                               │
│ 4. Return { greeting, voiceSettings }                      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Check if voiceId exists                                     │
│                                                             │
│ IF voiceId is set:                                         │
│   → Call synthesizeSpeech() with ElevenLabs               │
│   → Generate MP3 audio file                                │
│   → Return <Play> TwiML                                    │
│                                                             │
│ ELSE:                                                       │
│   → Return <Say> TwiML (Twilio default voice)             │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ ElevenLabs TTS                                              │
│ Service: services/v2elevenLabsService.js                   │
│                                                             │
│ 1. Get API key (company-specific or global)                │
│ 2. Create ElevenLabs client                                │
│ 3. Call textToSpeech.convert() with:                       │
│    - voiceId                                               │
│    - stability                                             │
│    - similarityBoost                                       │
│    - aiModel                                               │
│ 4. Return audio buffer                                     │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Twilio plays audio to caller                               │
│ Caller hears "Mark - Natural Conversations" voice          │
└─────────────────────────────────────────────────────────────┘
```

---

## 🏥 Status Check System

### **Status Check Endpoint**
```
GET /api/company/:companyId/v2-voice-settings/status
```

**Location:** `routes/company/v2profile-voice.js` (Lines 36-228)

### **4 Critical Checks:**

#### **CHECK 1: Database Storage**
```javascript
const voiceSettings = company.aiAgentLogic?.voiceSettings;
status.checks.database.passed = !!(voiceSettings && voiceSettings.voiceId);
```
**Tests:** Is `voiceId` saved in MongoDB?

---

#### **CHECK 2: ElevenLabs API Connection**
```javascript
const voices = await getAvailableVoices({ company });
if (voices && voices.length > 0) {
    status.checks.elevenLabsApi.passed = true;
}
```
**Tests:** Can we connect to ElevenLabs and retrieve voices?
**Important:** Uses `getAvailableVoices()` NOT `getUserInfo()` because:
- Voices endpoint is what TTS actually uses
- Doesn't require `user_read` permission
- More accurate test of TTS functionality

---

#### **CHECK 3: Voice ID Validation**
```javascript
const voices = await getAvailableVoices({ company });
const voice = voices.find(v => v.voice_id === voiceSettings.voiceId);
if (voice) {
    status.checks.voiceValidation.passed = true;
}
```
**Tests:** Is the saved `voiceId` actually available in the ElevenLabs account?

---

#### **CHECK 4: Twilio Call Integration**
```javascript
const allChecksPassed = status.checks.database.passed && 
                       status.checks.elevenLabsApi.passed && 
                       status.checks.voiceValidation.passed;
```
**Tests:** If all previous checks pass, calls will use ElevenLabs voice.

---

## 🔑 API Key Priority System

**Location:** `services/v2elevenLabsService.js` (Lines 7-49)

```javascript
function getElevenLabsApiKey(company) {
    const v2VoiceSettings = company?.aiAgentLogic?.voiceSettings;
    
    // Priority 1: Company's own API key (if configured)
    if (v2VoiceSettings?.apiSource === 'own' && v2VoiceSettings?.apiKey) {
        return v2VoiceSettings.apiKey;
    }
    
    // Priority 2: ClientsVia global API key
    if (v2VoiceSettings?.apiSource === 'clientsvia' || !v2VoiceSettings) {
        return process.env.ELEVENLABS_API_KEY;
    }
    
    // Fallback: Global API key
    return process.env.ELEVENLABS_API_KEY;
}
```

**API Key Hierarchy:**
1. **Company-specific key** (`company.aiAgentLogic.voiceSettings.apiKey`) when `apiSource = 'own'`
2. **ClientsVia global key** (`process.env.ELEVENLABS_API_KEY`) when `apiSource = 'clientsvia'`
3. **Fallback to global key** if no voice settings configured

---

## 🗂️ File Map

### **Core Files:**

| File | Purpose | Key Functions |
|------|---------|---------------|
| `models/v2Company.js` | **Database Schema** | Defines `aiAgentLogicSchema` and `voiceSettings` structure |
| `routes/company/v2profile-voice.js` | **API Endpoints** | GET/POST voice settings, status checks |
| `services/v2elevenLabsService.js` | **ElevenLabs Integration** | `synthesizeSpeech()`, `getAvailableVoices()`, API key management |
| `services/v2AIAgentRuntime.js` | **Call Initialization** | `initializeCall()`, greeting generation, voice settings loading |
| `routes/v2twilio.js` | **Twilio Webhooks** | Incoming call handler, TwiML generation |
| `public/company-profile.html` | **Frontend UI** | Voice settings form, status card, save functionality |

---

## 🔍 Debugging Checkpoints

### **Save Operation Checkpoints:**
```
[SAVE-1] POST request received
[SAVE-2] Request body parsed
[SAVE-3] Parsed values validated
[SAVE-4] Company ID validated
[SAVE-5] Voice ID present check
[SAVE-6] API key check (if using own API)
[SAVE-7] Fetching company from database
[SAVE-8] Company found check
[SAVE-9] Company details logged
[SAVE-10] Existing aiAgentLogic check
[SAVE-11] Existing voiceSettings logged
[SAVE-12] Initializing aiAgentLogic if needed
[SAVE-13] New voice settings constructed
[SAVE-14] Voice settings assigned
[SAVE-15] Confirmation of assignment
[SAVE-16] Calling company.save()
[SAVE-17] Save completed
[SAVE-18] Saved document ID
[SAVE-19] Verification reload from DB
[SAVE-20] Verification results
[SAVE-21] Clearing Redis cache
[SAVE-22] Cache cleared confirmation
[SAVE-23] Redis unavailable warning (if applicable)
[SAVE-24] Success summary
[SAVE-25] Sending response to client
```

### **Call Operation Checkpoints:**
```
[CALL-1] Call initialized successfully
[CALL-2] Greeting from initializeCall
[CALL-3] Voice settings from initializeCall
[CALL-4] Double-checking from database
[CALL-5] Fresh company.aiAgentLogic exists
[CALL-6] Fresh voiceSettings from DB
[CALL-7] Extracted voice ID
[CALL-8] Has greeting check
[CALL-9] Will use ElevenLabs decision
```

---

## 🚨 Common Issues & Solutions

### **Issue 1: Voice settings not persisting**
**Symptom:** Settings save successfully but don't appear after reload  
**Cause:** `aiAgentLogic` defined as plain object (Mixed type)  
**Solution:** Ensure `aiAgentLogic` uses proper schema reference (see Line 350-353 in v2Company.js)

---

### **Issue 2: Status check fails on "ElevenLabs API Connection"**
**Symptom:** Red X on API connection despite valid key  
**Cause:** Using `getUserInfo()` which requires `user_read` permission  
**Solution:** Status check now uses `getAvailableVoices()` (CHECK 2) - the actual endpoint TTS uses

---

### **Issue 3: Calls still use Twilio default voice**
**Symptom:** All checks pass but calls don't use ElevenLabs  
**Diagnostic Steps:**
1. Check Render logs for `[CALL-6]` - is `voiceSettings` undefined?
2. Check `[CALL-7]` - is voice ID extracted correctly?
3. Check `[CALL-9]` - does it decide to use ElevenLabs?
4. Verify Render has restarted after schema changes

---

### **Issue 4: Redis cache issues**
**Symptom:** Changes not reflecting immediately  
**Solution:** Voice settings save automatically clears Redis cache:
```javascript
const cacheKeys = [
    `company:${companyId}`,
    `voice:company:${companyId}`,
    `ai-agent:${companyId}`
];
await Promise.all(cacheKeys.map(key => redisClient.del(key)));
```

---

## 📊 Data Structure in MongoDB

```javascript
{
  "_id": ObjectId("68813026dd95f599c74e49c7"),
  "companyName": "atlas air",
  "companyPhone": "+12395652202",
  "twilioConfig": {
    "phoneNumber": "+12392322030",
    // ... other Twilio config ...
  },
  "aiAgentLogic": {
    "enabled": true,
    "version": 1,
    "lastUpdated": ISODate("2025-10-04T10:47:58.238Z"),
    "initialGreeting": "Thank you for calling Atlas Air. How can I help you today?",
    "thresholds": {
      "companyQnA": 0.8,
      "tradeQnA": 0.75,
      "templates": 0.7,
      "inHouseFallback": 0.5
    },
    "metrics": {
      "totalCalls": 0,
      "avgResponseTime": 0,
      "successRate": 0
    },
    "voiceSettings": {
      "apiSource": "clientsvia",
      "apiKey": null,
      "voiceId": "UgBBYS2sOqTuMpoF3BR0",
      "stability": 0.5,
      "similarityBoost": 0.7,
      "styleExaggeration": 0,
      "speakerBoost": true,
      "aiModel": "eleven_turbo_v2_5",
      "outputFormat": "mp3_44100_128",
      "streamingLatency": 0,
      "enabled": true,
      "lastUpdated": ISODate("2025-10-04T10:47:58.240Z"),
      "version": "2.0"
    }
  }
}
```

---

## 🧪 Testing & Verification

### **Manual Test Script:**
Use `check-voice-schema.js` to verify schema and test saves:

```javascript
node check-voice-schema.js
```

**Expected Output:**
```
✅ SUCCESS: Voice settings saved and persisted correctly!
```

### **Production Verification:**
1. Save voice settings in UI
2. Check status card for all green checkmarks
3. Make test call to verify voice
4. Check Render logs for `[CALL-6]` to confirm voiceSettings loaded from DB

---

## 🎯 Key Takeaways

1. **ALWAYS use proper Mongoose Schema for nested objects**  
   Never use plain `{}` objects for deeply nested data you need to track

2. **Test the right endpoints**  
   Status checks should test what the system actually uses (voices, not user info)

3. **Comprehensive logging is critical**  
   Numbered checkpoints (`[SAVE-1]`, `[CALL-1]`) make debugging exponentially easier

4. **Multi-tenant design**  
   Every company has independent voice settings, stored in their own document

5. **Cache management**  
   Always clear Redis cache when critical settings change

---

## 📞 Support Reference

**If voice settings stop working, check in this order:**

1. **Database:** `[CALL-6]` checkpoint - are `voiceSettings` loaded?
2. **API Key:** `process.env.ELEVENLABS_API_KEY` set on Render?
3. **Voice ID:** Is the voice still available in ElevenLabs account?
4. **Schema:** Is `aiAgentLogicSchema` properly referenced (not inline)?
5. **Cache:** Has Redis cache been cleared after changes?

---

**Document Version:** 1.0  
**Last Updated:** October 4, 2025  
**Author:** AI Engineering Team  
**Status:** Production Ready ✅

