# 🎯 VOICE SETTINGS SOURCE OF TRUTH - COMPLETE CONNECTION MAP

**Last Updated:** November 9, 2025  
**Status:** PRODUCTION CRITICAL ⚡  
**Purpose:** Never lose sight of the voice settings data flow

---

## 📊 THE SOURCE OF TRUTH HIERARCHY

```
┌─────────────────────────────────────────────────────────────┐
│  SINGLE SOURCE OF TRUTH: MongoDB company.aiAgentLogic      │
│  Database: MongoDB (via Mongoose)                           │
│  Model: /models/v2Company.js (lines 188-733)               │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  CRITICAL PATH: company.aiAgentLogic.voiceSettings          │
│  Schema Definition: lines 214-289 in v2Company.js           │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔗 COMPLETE CONNECTION CHAIN

### **1️⃣ DATABASE LAYER - THE SOURCE OF TRUTH**

**File:** `/models/v2Company.js`  
**Lines:** 214-289

```javascript
// THIS IS THE SINGLE SOURCE OF TRUTH
voiceSettings: {
    // API Configuration
    apiSource: { type: String, enum: ['clientsvia', 'own'], default: 'clientsvia' },
    apiKey: { type: String, trim: true, default: null },
    voiceId: { type: String, trim: true, default: null },
    
    // Voice Quality Controls
    stability: { type: Number, min: 0, max: 1, default: 0.5 },
    similarityBoost: { type: Number, min: 0, max: 1, default: 0.7 },
    styleExaggeration: { type: Number, min: 0, max: 1, default: 0.0 },
    
    // Performance & Output
    speakerBoost: { type: Boolean, default: true },
    aiModel: { type: String, enum: [...], default: 'eleven_turbo_v2_5' },
    outputFormat: { type: String, enum: [...], default: 'mp3_44100_128' },
    streamingLatency: { type: Number, min: 0, max: 4, default: 0 },
    
    // Metadata
    enabled: { type: Boolean, default: true },
    lastUpdated: { type: Date, default: Date.now },
    version: { type: String, default: '2.0' }
}
```

**Location in Document:**
```javascript
company.aiAgentLogic.voiceSettings
```

---

### **2️⃣ API LAYER - READ/WRITE ENDPOINTS**

#### **READ ENDPOINT**
**File:** `/routes/company/v2profile-voice.js`  
**Route:** `GET /api/company/:companyId/v2-voice-settings`  
**Lines:** 314-385

```javascript
// READS from company.aiAgentLogic.voiceSettings
const voiceSettings = company.aiAgentLogic?.voiceSettings || defaults;
return res.json({ success: true, settings: voiceSettings });
```

#### **WRITE ENDPOINT** 
**File:** `/routes/company/v2profile-voice.js`  
**Route:** `POST /api/company/:companyId/v2-voice-settings`  
**Lines:** 394-586

```javascript
// WRITES to company.aiAgentLogic.voiceSettings using atomic update
await Company.findByIdAndUpdate(
    companyId,
    { $set: { 'aiAgentLogic.voiceSettings': newSettings } },
    { new: true, runValidators: false }
);
```

**Why atomic update?**
- Avoids Mongoose full-document validation
- Updates ONLY voiceSettings field
- Prevents unrelated schema errors from blocking save

---

### **3️⃣ FRONTEND LAYER - USER INTERFACE**

**File:** `/public/js/ai-voice-settings/VoiceSettingsManager.js`

```javascript
class VoiceSettingsManager {
    constructor(companyId) {
        this.companyId = companyId;
        this.API_BASE = `/api/company/${companyId}`;
    }
    
    // LOADS from API (which loads from DB)
    async loadVoiceSettings() {
        const response = await fetch(`${this.API_BASE}/v2-voice-settings`);
        const data = await response.json();
        return data.settings;
    }
    
    // SAVES to API (which saves to DB)
    async saveVoiceSettings(settings) {
        const response = await fetch(`${this.API_BASE}/v2-voice-settings`, {
            method: 'POST',
            body: JSON.stringify(settings)
        });
        return response.json();
    }
}
```

---

### **4️⃣ RUNTIME LAYER - LIVE CALL EXECUTION**

#### **A. FIRST LEG: Greeting Generation**

**File:** `/routes/v2twilio.js`  
**Endpoint:** `POST /api/twilio/voice`  
**Lines:** 858-956

```javascript
// 1. Initialize call with V2 Runtime
const { initializeCall } = require('../services/v2AIAgentRuntime');
const initResult = await initializeCall(companyID, callSid, from, to);

// 2. Extract voice settings from init result
const elevenLabsVoice = initResult.voiceSettings?.voiceId;

// 3. Generate greeting audio with ElevenLabs
if (elevenLabsVoice && initResult.greeting) {
    const buffer = await synthesizeSpeech({
        text: initResult.greeting,
        voiceId: elevenLabsVoice,
        stability: company.aiAgentLogic?.voiceSettings?.stability,
        similarity_boost: company.aiAgentLogic?.voiceSettings?.similarityBoost,
        style: company.aiAgentLogic?.voiceSettings?.styleExaggeration,
        model_id: company.aiAgentLogic?.voiceSettings?.aiModel,
        company  // ✅ CRITICAL: Passes company for API key lookup
    });
}
```

**Where voice settings come from:**
```javascript
// services/v2AIAgentRuntime.js - lines 29-84
static async initializeCall(companyID, callId, from, to) {
    const company = await Company.findById(companyID);
    
    return {
        greeting: greetingText,
        voiceSettings: company.aiAgentLogic.voiceSettings, // ✅ SOURCE OF TRUTH
        callState: { /* ... */ }
    };
}
```

#### **B. SECOND LEG: Response Generation** ✅ **JUST FIXED!**

**File:** `/routes/v2twilio.js`  
**Endpoint:** `POST /api/twilio/v2-agent-respond/:companyID`  
**Lines:** 1760-1775

```javascript
// 1. Load company (fresh from DB)
const company = await Company.findById(companyID)
    .select('+aiAgentLogic.voiceSettings')
    .lean();

// 2. Extract voice settings
const elevenLabsVoice = company?.aiAgentLogic?.voiceSettings?.voiceId;

// 3. Generate response audio with ElevenLabs
if (elevenLabsVoice && responseText) {
    const audioBuffer = await synthesizeSpeech({
        text: responseText,
        voiceId: elevenLabsVoice,
        stability: company.aiAgentLogic?.voiceSettings?.stability,
        similarity_boost: company.aiAgentLogic?.voiceSettings?.similarityBoost,
        style: company.aiAgentLogic?.voiceSettings?.styleExaggeration,      // ✅ FIXED
        use_speaker_boost: company.aiAgentLogic?.voiceSettings?.speakerBoost, // ✅ FIXED
        model_id: company.aiAgentLogic?.voiceSettings?.aiModel,              // ✅ FIXED
        company  // ✅ CRITICAL FIX: Now passes company for API key lookup
    });
}
```

**🔥 THE BUG WE JUST FIXED:**
- Second leg was missing `company` parameter
- Used wrong property names (`style` instead of `styleExaggeration`, `modelId` instead of `aiModel`)
- Now perfectly mirrors the first leg implementation

---

### **5️⃣ SERVICE LAYER - ELEVENLABS INTEGRATION**

**File:** `/services/v2elevenLabsService.js`  
**Function:** `synthesizeSpeech()`  
**Lines:** 197-351

```javascript
async function synthesizeSpeech({ 
    text, 
    voiceId, 
    stability,
    similarity_boost,
    style,
    use_speaker_boost,
    model_id,
    company  // ✅ CRITICAL: Needed for API key lookup
}) {
    // 1. Get API key from company settings
    const client = createClient({ company });
    
    // 2. Call ElevenLabs API
    const audioStream = await client.textToSpeech.convert(voiceId, {
        text,
        model_id,
        voice_settings: {
            stability,
            similarity_boost,
            style,
            use_speaker_boost
        }
    });
    
    // 3. Return audio buffer
    return Buffer.concat(chunks);
}
```

**API Key Lookup Logic:**
```javascript
// lines 10-52
function getElevenLabsApiKey(company) {
    const v2VoiceSettings = company?.aiAgentLogic?.voiceSettings;
    
    // 1. Company using their own API key?
    if (v2VoiceSettings?.apiSource === 'own' && v2VoiceSettings?.apiKey) {
        return v2VoiceSettings.apiKey;
    }
    
    // 2. Fall back to ClientsVia global key
    if (process.env.ELEVENLABS_API_KEY) {
        return process.env.ELEVENLABS_API_KEY;
    }
    
    // 3. Error: No key available
    throw new Error('No ElevenLabs API key configured');
}
```

---

## 🎯 DATA FLOW VISUALIZATION

```
┌──────────────────────────────────────────────────────────────┐
│                     USER INTERFACE                           │
│  /public/js/ai-voice-settings/VoiceSettingsManager.js       │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ↓ POST /api/company/:id/v2-voice-settings
┌──────────────────────────────────────────────────────────────┐
│                     API ENDPOINTS                            │
│  /routes/company/v2profile-voice.js                          │
│  • GET  /:companyId/v2-voice-settings (READ)                │
│  • POST /:companyId/v2-voice-settings (WRITE)               │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ↓ findByIdAndUpdate()
┌──────────────────────────────────────────────────────────────┐
│              DATABASE - SINGLE SOURCE OF TRUTH               │
│  MongoDB: companies collection                               │
│  Document: company.aiAgentLogic.voiceSettings                │
│  Schema: /models/v2Company.js (lines 214-289)               │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ↓ findById() during live call
┌──────────────────────────────────────────────────────────────┐
│                     LIVE CALL RUNTIME                        │
│  FIRST LEG:  /routes/v2twilio.js (lines 858-956)            │
│              → initializeCall()                              │
│              → synthesizeSpeech() with company               │
│                                                              │
│  SECOND LEG: /routes/v2twilio.js (lines 1760-1775) ✅ FIXED│
│              → Load company from DB                          │
│              → Extract voiceSettings                         │
│              → synthesizeSpeech() with company               │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ↓ API call with settings
┌──────────────────────────────────────────────────────────────┐
│                     ELEVENLABS SERVICE                       │
│  /services/v2elevenLabsService.js                            │
│  • getElevenLabsApiKey(company) → API key from voiceSettings│
│  • synthesizeSpeech() → Generate audio                       │
└──────────────────────────────────────────────────────────────┘
```

---

## 🔒 CRITICAL PROPERTY NAMES - NEVER MIX THESE UP

| ❌ WRONG NAME | ✅ CORRECT NAME | WHERE USED |
|--------------|----------------|------------|
| `style` | `styleExaggeration` | voiceSettings schema |
| `modelId` | `aiModel` | voiceSettings schema |
| `similarity` | `similarityBoost` | voiceSettings schema |
| `speaker_boost` | `speakerBoost` | voiceSettings schema (camelCase in DB) |
| - | `use_speaker_boost` | ElevenLabs API param (snake_case for API) |

---

## 🎯 KEY INTEGRATION POINTS

### **Point 1: Database Schema**
```
Location: /models/v2Company.js (lines 214-289)
Role: Single source of truth for all voice settings
Never modify: Schema structure without updating all dependent code
```

### **Point 2: API Endpoints**
```
Location: /routes/company/v2profile-voice.js
Role: CRUD operations for voice settings
Critical: Uses atomic updates to avoid schema validation issues
```

### **Point 3: First Leg (Greeting)**
```
Location: /routes/v2twilio.js (lines 858-956)
Role: Generate and play greeting audio
Critical: Passes 'company' object to synthesizeSpeech()
```

### **Point 4: Second Leg (Response)** ✅ **JUST FIXED**
```
Location: /routes/v2twilio.js (lines 1760-1775)
Role: Generate and play response audio
Critical: Now passes 'company' object + correct property names
```

### **Point 5: ElevenLabs Service**
```
Location: /services/v2elevenLabsService.js
Role: Interface with ElevenLabs API
Critical: Requires 'company' param for API key lookup
```

---

## 🚨 PRODUCTION RULES - NEVER VIOLATE

### **Rule 1: ALWAYS Pass Company Object**
```javascript
// ✅ CORRECT
await synthesizeSpeech({
    text,
    voiceId,
    company  // CRITICAL: Needed for API key lookup
});

// ❌ WRONG - Will fail silently
await synthesizeSpeech({
    text,
    voiceId
    // Missing company = No API key = Silent failure
});
```

### **Rule 2: ALWAYS Use Correct Property Names**
```javascript
// ✅ CORRECT
const settings = company.aiAgentLogic.voiceSettings;
await synthesizeSpeech({
    stability: settings.stability,
    similarity_boost: settings.similarityBoost,  // ← DB uses camelCase
    style: settings.styleExaggeration,           // ← Note: styleExaggeration
    use_speaker_boost: settings.speakerBoost,    // ← API uses snake_case
    model_id: settings.aiModel                   // ← Note: aiModel
});
```

### **Rule 3: ALWAYS Load Fresh Company Data**
```javascript
// Second leg must reload company from DB
const company = await Company.findById(companyID)
    .select('+aiAgentLogic.voiceSettings')
    .lean();
```

### **Rule 4: NEVER Modify voiceSettings Without Schema Update**
```javascript
// If you add a field to voiceSettings schema, you MUST update:
// 1. /models/v2Company.js (schema definition)
// 2. /routes/company/v2profile-voice.js (GET/POST endpoints)
// 3. /routes/v2twilio.js (both greeting + response handlers)
// 4. /services/v2elevenLabsService.js (if new field affects API call)
// 5. /public/js/ai-voice-settings/VoiceSettingsManager.js (frontend)
```

---

## 🧪 TESTING CHECKLIST

Before deploying voice settings changes:

- [ ] **Schema Test**: Add field to v2Company.js schema
- [ ] **API Test**: GET endpoint returns new field
- [ ] **API Test**: POST endpoint saves new field
- [ ] **Runtime Test**: First leg greeting uses new field
- [ ] **Runtime Test**: Second leg response uses new field
- [ ] **Service Test**: ElevenLabs receives new parameter correctly
- [ ] **Integration Test**: Make live test call, verify both legs work

---

## 📝 MAINTENANCE LOG

| Date | Change | File(s) | Reason |
|------|--------|---------|--------|
| 2025-11-09 | Added `company` param to second leg | v2twilio.js:1774 | API key lookup was failing |
| 2025-11-09 | Fixed `style` → `styleExaggeration` | v2twilio.js:1771 | Wrong property name |
| 2025-11-09 | Fixed `modelId` → `aiModel` | v2twilio.js:1773 | Wrong property name |
| 2025-11-09 | Added `use_speaker_boost` param | v2twilio.js:1772 | Missing from API call |

---

## 🆘 TROUBLESHOOTING

### **Symptom: ElevenLabs fails on greeting**
**Check:** First leg passes `company` param? (line 934 in v2twilio.js)

### **Symptom: ElevenLabs fails on response**
**Check:** Second leg passes `company` param? (line 1774 in v2twilio.js)

### **Symptom: Wrong voice quality**
**Check:** Property names match schema? (`styleExaggeration` not `style`)

### **Symptom: Settings not saving**
**Check:** Using atomic update? (v2profile-voice.js uses `findByIdAndUpdate`)

### **Symptom: API key not found**
**Check:** 
1. `company.aiAgentLogic.voiceSettings.apiSource` is set
2. If 'own': `company.aiAgentLogic.voiceSettings.apiKey` exists
3. If 'clientsvia': `process.env.ELEVENLABS_API_KEY` exists

---

## 🎓 SUMMARY

**THE RULE:**
```
MongoDB company.aiAgentLogic.voiceSettings
    ↓
is the SINGLE SOURCE OF TRUTH
    ↓
loaded by BOTH greeting AND response handlers
    ↓
passed to synthesizeSpeech() WITH company object
    ↓
used by ElevenLabs service for API key + voice params
```

**NEVER:**
- ❌ Store voice settings anywhere else
- ❌ Hardcode defaults in runtime code
- ❌ Call synthesizeSpeech() without `company` param
- ❌ Mix up property names (style/styleExaggeration, modelId/aiModel)

**ALWAYS:**
- ✅ Load from `company.aiAgentLogic.voiceSettings`
- ✅ Pass complete `company` object to services
- ✅ Use exact property names from schema
- ✅ Test both first AND second leg after changes

---

**END OF SOURCE OF TRUTH MAP**

