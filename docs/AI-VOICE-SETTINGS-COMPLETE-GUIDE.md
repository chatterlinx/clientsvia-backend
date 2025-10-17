# 🎤 AI Voice Settings - Complete Technical Guide

**Last Updated:** October 16, 2025  
**Status:** Production-Ready ✅  
**Purpose:** Complete reference for AI Voice Settings save mechanism, data structure, and integration patterns

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Critical Discovery: The Save Issue](#critical-discovery-the-save-issue)
3. [Data Structure](#data-structure)
4. [Save Flow Architecture](#save-flow-architecture)
5. [How to Retrieve Voice Settings](#how-to-retrieve-voice-settings)
6. [Integration with AI Agent Settings & Twilio](#integration-with-ai-agent-settings--twilio)
7. [Common Pitfalls & Solutions](#common-pitfalls--solutions)
8. [Best Practices](#best-practices)
9. [Troubleshooting Guide](#troubleshooting-guide)

---

## 🎯 Overview

The AI Voice Settings system manages ElevenLabs voice configuration for each company (tenant) in the multi-tenant platform.

**Key Files:**
- **Frontend:** `/public/js/ai-voice-settings/VoiceSettingsManager.js`
- **Backend Route:** `/routes/company/v2profile-voice.js`
- **ElevenLabs Service:** `/services/v2elevenLabsService.js`
- **Database Model:** `/models/v2Company.js` (embedded in `aiAgentLogic.voiceSettings`)

**Database Location:**
```javascript
company.aiAgentLogic.voiceSettings = { /* voice config */ }
```

---

## 🔍 Critical Discovery: The Save Issue

### The Problem We Encountered

**Symptom:** Voice settings would not save, returning 400/500 errors.

**Root Cause:** The company document had **corrupt data in an unrelated field** (a string `"default"` where an object was expected). When we tried to save voice settings using the standard Mongoose approach:

```javascript
// ❌ THIS FAILED
const company = await Company.findById(companyId);
company.aiAgentLogic.voiceSettings = newSettings;
await company.save(); // <-- Mongoose validates ENTIRE document, crashes on corrupt field
```

Mongoose's `.save()` validates the **ENTIRE company document** (all 1000+ lines of schema), not just the field you're updating. If ANY field in the document has corrupt data, the entire save fails.

### The Solution

**Use targeted MongoDB updates** that only touch the specific field you're modifying:

```javascript
// ✅ THIS WORKS
await Company.findByIdAndUpdate(
    companyId,
    { 
        $set: { 'aiAgentLogic.voiceSettings': newSettings } 
    },
    { 
        new: true,           // Return updated document
        runValidators: false  // Skip full document validation
    }
);
```

**Why This Works:**
- Only updates the specific field path
- Doesn't load/validate the entire document
- Bypasses corrupt data in other fields
- Faster and more efficient

**Important:** This is now the **production implementation** in `routes/company/v2profile-voice.js` (commit: `051a1d2b`).

---

## 📊 Data Structure

### Complete Schema

Located in MongoDB at: `v2companies.aiAgentLogic.voiceSettings`

```javascript
{
    // API Configuration
    apiSource: 'clientsvia', // or 'own' (company's own ElevenLabs account)
    apiKey: null,            // Encrypted string when apiSource === 'own', else null
    
    // Voice Selection
    voiceId: 'pNInz6obpgDQGcFmaJgB', // ElevenLabs voice ID (REQUIRED)
    
    // Voice Quality Controls
    stability: 0.5,          // 0.0-1.0 (Higher = more consistent, less variable)
    similarityBoost: 0.7,    // 0.0-1.0 (Higher = closer to original voice)
    styleExaggeration: 0.0,  // 0.0-1.0 (Higher = more dramatic expression)
    
    // Performance Settings
    speakerBoost: true,      // Boolean - enhances voice clarity
    aiModel: 'eleven_turbo_v2_5',        // ElevenLabs model ID
    outputFormat: 'mp3_44100_128',       // Audio format
    streamingLatency: 0,     // 0-4 (0=best quality, 4=lowest latency)
    
    // Metadata
    enabled: true,           // Boolean - is voice synthesis enabled?
    lastUpdated: Date,       // ISO timestamp
    version: '2.0'           // Schema version
}
```

### Field Validation Rules

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `apiSource` | String | Yes | `'clientsvia'` | Only `'clientsvia'` or `'own'` |
| `apiKey` | String/null | Conditional | `null` | Required when `apiSource === 'own'` |
| `voiceId` | String | **YES** | `null` | **Must be valid ElevenLabs voice ID** |
| `stability` | Number | No | `0.5` | Range: 0.0 - 1.0 |
| `similarityBoost` | Number | No | `0.7` | Range: 0.0 - 1.0 |
| `styleExaggeration` | Number | No | `0.0` | Range: 0.0 - 1.0 |
| `speakerBoost` | Boolean | No | `true` | - |
| `aiModel` | String | No | `'eleven_turbo_v2_5'` | ElevenLabs model name |
| `outputFormat` | String | No | `'mp3_44100_128'` | Audio format string |
| `streamingLatency` | Integer | No | `0` | Range: 0 - 4 |
| `enabled` | Boolean | No | `true` | - |

---

## 🔄 Save Flow Architecture

### Frontend → Backend Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. FRONTEND (VoiceSettingsManager.js)                          │
│    - User selects voice from dropdown                           │
│    - Adjusts sliders (stability, similarityBoost, etc.)         │
│    - Clicks "Save Voice Settings" button                        │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. API REQUEST                                                  │
│    POST /api/company/:companyId/v2-voice-settings              │
│    Authorization: Bearer {JWT}                                  │
│    Body: {                                                      │
│        voiceId: "UgBBYS2sOqTuMpoF3BR0",                        │
│        stability: 0.5,                                          │
│        similarityBoost: 0.7,                                    │
│        styleExaggeration: 0.0,                                  │
│        speakerBoost: true,                                      │
│        aiModel: "eleven_turbo_v2_5",                           │
│        outputFormat: "mp3_44100_128",                          │
│        streamingLatency: 0,                                     │
│        apiSource: "clientsvia"                                  │
│    }                                                            │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. BACKEND VALIDATION (v2profile-voice.js)                     │
│    ✓ Validate companyId format (ObjectId)                      │
│    ✓ Validate voiceId is present                               │
│    ✓ If apiSource='own', validate apiKey is present            │
│    ✓ Normalize all values with fallbacks                       │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. DATABASE UPDATE (Targeted Update)                           │
│    Company.findByIdAndUpdate(companyId, {                      │
│        $set: {                                                  │
│            'aiAgentLogic.voiceSettings': newVoiceSettings       │
│        }                                                        │
│    }, { new: true, runValidators: false })                     │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. CACHE INVALIDATION                                           │
│    Clear Redis keys:                                            │
│    - company:{companyId}                                        │
│    - voice:company:{companyId}                                  │
│    - ai-agent:{companyId}                                       │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. RESPONSE                                                     │
│    200 OK: { success: true, settings: {...}, version: '2.0' }  │
│    400 Bad Request: Validation error                            │
│    404 Not Found: Company not found                             │
│    500 Server Error: Database error                             │
└─────────────────────────────────────────────────────────────────┘
```

### Code Implementation (Backend)

**File:** `/routes/company/v2profile-voice.js`

```javascript
router.post('/:companyId/v2-voice-settings', async (req, res) => {
    try {
        const { companyId } = req.params;
        const b = req.body || {};
        
        // 1. Validate companyId
        if (!ObjectId.isValid(companyId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid company ID format'
            });
        }

        // 2. Normalize and extract values (with fallbacks)
        const pick = (...vals) => vals.find(v => v !== undefined && v !== null);
        
        const apiSource = pick(b.apiSource, 'clientsvia');
        const apiKey = pick(b.apiKey, null);
        const voiceId = pick(b.voiceId, null);
        const stability = Number(pick(b.stability, 0.5));
        const similarityBoost = Number(pick(b.similarityBoost, 0.7));
        const styleExaggeration = Number(pick(b.styleExaggeration, 0.0));
        const speakerBoost = Boolean(pick(b.speakerBoost, true));
        const aiModel = pick(b.aiModel, 'eleven_turbo_v2_5');
        const outputFormat = pick(b.outputFormat, 'mp3_44100_128');
        const streamingLatency = Number(pick(b.streamingLatency, 0));

        // 3. Validate required fields
        if (!voiceId) {
            return res.status(400).json({
                success: false,
                message: 'Voice ID is required'
            });
        }
        
        if (apiSource === 'own' && !apiKey) {
            return res.status(400).json({
                success: false,
                message: 'API key is required when using own ElevenLabs account'
            });
        }

        // 4. Build voice settings object
        const newVoiceSettings = {
            apiSource,
            apiKey: apiSource === 'own' ? apiKey : null,
            voiceId,
            stability,
            similarityBoost,
            styleExaggeration,
            speakerBoost,
            aiModel,
            outputFormat,
            streamingLatency,
            enabled: true,
            lastUpdated: new Date(),
            version: '2.0'
        };

        // 5. CRITICAL: Use targeted update (not company.save())
        // This bypasses full document validation and avoids issues with corrupt data in other fields
        const updatedCompany = await Company.findByIdAndUpdate(
            companyId,
            { $set: { 'aiAgentLogic.voiceSettings': newVoiceSettings } },
            { new: true, runValidators: false }
        );
        
        if (!updatedCompany) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        // 6. Clear Redis cache
        if (redisClient) {
            await Promise.all([
                redisClient.del(`company:${companyId}`),
                redisClient.del(`voice:company:${companyId}`),
                redisClient.del(`ai-agent:${companyId}`)
            ].map(p => p.catch(() => null)));
        }

        // 7. Return sanitized response (hide API key)
        const safeSettings = { ...newVoiceSettings };
        if (safeSettings.apiKey) {
            safeSettings.apiKey = '*****';
        }

        res.json({
            success: true,
            message: 'Voice settings saved successfully',
            settings: safeSettings,
            version: '2.0'
        });

    } catch (error) {
        console.error('❌ Voice settings save error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to save voice settings',
            error: error.message
        });
    }
});
```

---

## 📖 How to Retrieve Voice Settings

### Method 1: Direct Database Query (Recommended for Services)

```javascript
const Company = require('../models/v2Company');

// Get voice settings for a company
async function getVoiceSettings(companyId) {
    const company = await Company.findById(companyId)
        .select('aiAgentLogic.voiceSettings companyName')
        .lean(); // Use .lean() for plain JS object (faster)
    
    if (!company || !company.aiAgentLogic?.voiceSettings) {
        return null;
    }
    
    return company.aiAgentLogic.voiceSettings;
}

// Example usage:
const settings = await getVoiceSettings('68e3f77a9d623b8058c700c4');
console.log(settings.voiceId); // 'UgBBYS2sOqTuMpoF3BR0'
console.log(settings.stability); // 0.5
```

### Method 2: Via API Endpoint

**Endpoint:** `GET /api/company/:companyId/v2-voice-settings`

```javascript
// Frontend example
async function loadVoiceSettings(companyId) {
    const response = await fetch(`/api/company/${companyId}/v2-voice-settings`, {
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json'
        }
    });
    
    const data = await response.json();
    return data.settings;
}
```

**Response:**
```json
{
    "success": true,
    "settings": {
        "apiSource": "clientsvia",
        "apiKey": null,
        "voiceId": "UgBBYS2sOqTuMpoF3BR0",
        "stability": 0.5,
        "similarityBoost": 0.7,
        "styleExaggeration": 0.0,
        "speakerBoost": true,
        "aiModel": "eleven_turbo_v2_5",
        "outputFormat": "mp3_44100_128",
        "streamingLatency": 0,
        "enabled": true,
        "lastUpdated": "2025-10-16T23:29:40.201Z",
        "version": "2.0"
    }
}
```

### Method 3: From Cached Company Document

```javascript
const { redisClient } = require('../clients');

async function getVoiceSettingsWithCache(companyId) {
    // Try Redis cache first
    const cacheKey = `voice:company:${companyId}`;
    const cached = await redisClient.get(cacheKey).catch(() => null);
    
    if (cached) {
        return JSON.parse(cached);
    }
    
    // Fallback to database
    const company = await Company.findById(companyId)
        .select('aiAgentLogic.voiceSettings')
        .lean();
    
    if (!company?.aiAgentLogic?.voiceSettings) {
        return null;
    }
    
    const settings = company.aiAgentLogic.voiceSettings;
    
    // Cache for 1 hour
    await redisClient.setex(cacheKey, 3600, JSON.stringify(settings))
        .catch(err => console.error('Redis cache error:', err));
    
    return settings;
}
```

---

## 🔗 Integration with AI Agent Settings & Twilio

### Use Case: Twilio Voice Settings Integration

When the AI Agent makes outbound calls via Twilio, it needs to know which ElevenLabs voice to use for TTS (text-to-speech).

### Integration Pattern

**File:** `/services/v2AIAgentRuntime.js` (or your AI Agent service)

```javascript
const Company = require('../models/v2Company');
const { getAvailableVoices, generateSpeech } = require('./v2elevenLabsService');

class AIAgentRuntime {
    constructor(companyId) {
        this.companyId = companyId;
        this.voiceSettings = null;
    }
    
    /**
     * Initialize AI Agent with company-specific voice settings
     */
    async initialize() {
        // Load company data with voice settings
        const company = await Company.findById(this.companyId)
            .select('companyName aiAgentLogic twilioConfig')
            .lean();
        
        if (!company) {
            throw new Error(`Company ${this.companyId} not found`);
        }
        
        // Extract voice settings
        this.voiceSettings = company.aiAgentLogic?.voiceSettings || null;
        
        if (!this.voiceSettings || !this.voiceSettings.voiceId) {
            console.warn(`⚠️  No voice settings configured for ${company.companyName}`);
            // Use default voice
            this.voiceSettings = {
                voiceId: 'pNInz6obpgDQGcFmaJgB', // Rachel (default)
                stability: 0.5,
                similarityBoost: 0.7,
                aiModel: 'eleven_turbo_v2_5',
                outputFormat: 'mp3_44100_128'
            };
        }
        
        console.log(`✅ AI Agent initialized for ${company.companyName}`);
        console.log(`   Voice: ${this.voiceSettings.voiceId}`);
        console.log(`   Stability: ${this.voiceSettings.stability}`);
        
        return this;
    }
    
    /**
     * Generate speech using configured voice settings
     */
    async speak(text) {
        if (!this.voiceSettings) {
            throw new Error('AI Agent not initialized. Call .initialize() first.');
        }
        
        // Generate speech with ElevenLabs using company's voice settings
        const audioBuffer = await generateSpeech({
            text,
            voiceId: this.voiceSettings.voiceId,
            modelId: this.voiceSettings.aiModel,
            stability: this.voiceSettings.stability,
            similarityBoost: this.voiceSettings.similarityBoost,
            styleExaggeration: this.voiceSettings.styleExaggeration,
            speakerBoost: this.voiceSettings.speakerBoost,
            outputFormat: this.voiceSettings.outputFormat
        });
        
        return audioBuffer;
    }
    
    /**
     * Handle incoming Twilio call
     */
    async handleIncomingCall(callSid, from, to) {
        await this.initialize();
        
        // Generate greeting with configured voice
        const greeting = "Hello, thank you for calling. How can I help you today?";
        const audio = await this.speak(greeting);
        
        // Stream audio back to Twilio
        return audio;
    }
}

module.exports = AIAgentRuntime;
```

### Example: Twilio Webhook Handler

**File:** `/routes/v2twilio.js`

```javascript
const AIAgentRuntime = require('../services/v2AIAgentRuntime');
const VoiceResponse = require('twilio').twiml.VoiceResponse;

router.post('/webhook/voice/:companyId', async (req, res) => {
    const { companyId } = req.params;
    const { CallSid, From, To } = req.body;
    
    try {
        // Initialize AI Agent with company's voice settings
        const agent = new AIAgentRuntime(companyId);
        await agent.initialize();
        
        // Generate TwiML response
        const twiml = new VoiceResponse();
        
        // Use the configured voice for the greeting
        const greeting = await agent.speak("Hello, thank you for calling. How can I assist you?");
        
        twiml.play({ loop: 1 }, `https://your-cdn.com/audio/${CallSid}.mp3`);
        twiml.gather({
            input: ['speech'],
            action: `/webhook/voice/${companyId}/gather`,
            speechTimeout: 'auto',
            language: 'en-US'
        });
        
        res.type('text/xml');
        res.send(twiml.toString());
        
    } catch (error) {
        console.error('❌ Twilio webhook error:', error);
        
        // Fallback TwiML
        const twiml = new VoiceResponse();
        twiml.say('Sorry, there was an error processing your call. Please try again later.');
        twiml.hangup();
        
        res.type('text/xml');
        res.send(twiml.toString());
    }
});
```

### AI Agent Settings Tab Integration

If you're building an **AI Agent Settings** tab that needs to display/edit both Twilio settings AND voice settings:

**File:** `/routes/company/v2aiAgentDiagnostics.js` (or similar)

```javascript
// GET endpoint - Load all AI Agent settings (including voice)
router.get('/:companyId/ai-agent-settings', async (req, res) => {
    const { companyId } = req.params;
    
    const company = await Company.findById(companyId)
        .select('companyName twilioConfig aiAgentLogic')
        .lean();
    
    if (!company) {
        return res.status(404).json({ success: false, message: 'Company not found' });
    }
    
    // Build comprehensive AI Agent settings response
    res.json({
        success: true,
        settings: {
            // Twilio Configuration
            twilio: {
                accountSid: company.twilioConfig?.accountSid || null,
                phoneNumbers: company.twilioConfig?.phoneNumbers || [],
                webhookUrl: company.twilioConfig?.webhookUrl || null
            },
            
            // Voice Settings (from AI Voice Settings tab)
            voice: company.aiAgentLogic?.voiceSettings || null,
            
            // Other AI Agent Logic
            thresholds: company.aiAgentLogic?.thresholds || {},
            memorySettings: company.aiAgentLogic?.memorySettings || {},
            fallbackBehavior: company.aiAgentLogic?.fallbackBehavior || {}
        }
    });
});
```

**Frontend Example:**

```javascript
// Load AI Agent Settings (includes voice settings)
async function loadAIAgentSettings(companyId) {
    const response = await fetch(`/api/company/${companyId}/ai-agent-settings`, {
        headers: {
            'Authorization': `Bearer ${getAuthToken()}`,
            'Content-Type': 'application/json'
        }
    });
    
    const data = await response.json();
    
    // Access voice settings
    const voiceSettings = data.settings.voice;
    console.log('Current voice:', voiceSettings.voiceId);
    console.log('Stability:', voiceSettings.stability);
    
    // Access Twilio settings
    const twilioConfig = data.settings.twilio;
    console.log('Twilio SID:', twilioConfig.accountSid);
    
    return data.settings;
}
```

---

## ⚠️ Common Pitfalls & Solutions

### Pitfall 1: Using `company.save()` Instead of Targeted Update

**❌ Wrong:**
```javascript
const company = await Company.findById(companyId);
company.aiAgentLogic.voiceSettings = newSettings;
await company.save(); // Validates ENTIRE document
```

**✅ Correct:**
```javascript
await Company.findByIdAndUpdate(
    companyId,
    { $set: { 'aiAgentLogic.voiceSettings': newSettings } },
    { new: true, runValidators: false }
);
```

**Why:** Mongoose `.save()` triggers full document validation, which can fail if ANY field in the document has corrupt data.

---

### Pitfall 2: Forgetting to Clear Redis Cache

**❌ Wrong:**
```javascript
// Update database but forget cache
await Company.findByIdAndUpdate(...);
res.json({ success: true });
```

**✅ Correct:**
```javascript
await Company.findByIdAndUpdate(...);

// Clear cache so changes take effect immediately
await Promise.all([
    redisClient.del(`company:${companyId}`),
    redisClient.del(`voice:company:${companyId}`),
    redisClient.del(`ai-agent:${companyId}`)
]);

res.json({ success: true });
```

**Why:** Redis caches company data. If you don't clear the cache, old voice settings will be served until cache expires (could be hours).

---

### Pitfall 3: Not Validating `voiceId`

**❌ Wrong:**
```javascript
const voiceId = req.body.voiceId; // Could be undefined or null
await Company.findByIdAndUpdate(..., { $set: { 'aiAgentLogic.voiceSettings': { voiceId, ... } } });
```

**✅ Correct:**
```javascript
const voiceId = req.body.voiceId;

if (!voiceId) {
    return res.status(400).json({
        success: false,
        message: 'Voice ID is required'
    });
}

await Company.findByIdAndUpdate(...);
```

**Why:** `voiceId` is REQUIRED for ElevenLabs API calls. Saving null/undefined will break TTS generation.

---

### Pitfall 4: Exposing API Keys in Responses

**❌ Wrong:**
```javascript
res.json({
    success: true,
    settings: newVoiceSettings // Contains raw apiKey
});
```

**✅ Correct:**
```javascript
const safeSettings = { ...newVoiceSettings };
if (safeSettings.apiKey) {
    safeSettings.apiKey = '*****'; // Mask it
}

res.json({
    success: true,
    settings: safeSettings
});
```

**Why:** Security. Never expose encrypted API keys in responses, even to authenticated users.

---

### Pitfall 5: Not Handling Missing `aiAgentLogic`

**❌ Wrong:**
```javascript
const voiceSettings = company.aiAgentLogic.voiceSettings; // Could crash if aiAgentLogic is undefined
```

**✅ Correct:**
```javascript
const voiceSettings = company.aiAgentLogic?.voiceSettings || null;

if (!voiceSettings) {
    // Use default voice or return error
    return defaultVoiceSettings;
}
```

**Why:** Legacy companies or new companies might not have `aiAgentLogic` initialized yet. Always use optional chaining (`?.`) and provide fallbacks.

---

## ✅ Best Practices

### 1. Always Use Targeted Updates for Nested Fields

When updating nested fields in large documents, use MongoDB's `$set` operator:

```javascript
// Good: Only touches the specific field
await Company.findByIdAndUpdate(
    companyId,
    { $set: { 'aiAgentLogic.voiceSettings': newSettings } },
    { new: true, runValidators: false }
);
```

### 2. Clear All Related Cache Keys

When updating voice settings, clear all related caches:

```javascript
const cacheKeys = [
    `company:${companyId}`,           // Full company cache
    `voice:company:${companyId}`,     // Voice-specific cache
    `ai-agent:${companyId}`            // AI agent runtime cache
];

await Promise.all(cacheKeys.map(key => 
    redisClient.del(key).catch(() => null)
));
```

### 3. Validate on Both Frontend and Backend

**Frontend validation** (fast feedback):
```javascript
if (!voiceId) {
    alert('Please select a voice');
    return;
}
```

**Backend validation** (security):
```javascript
if (!voiceId) {
    return res.status(400).json({ message: 'Voice ID required' });
}
```

### 4. Use Normalization Functions for Input

Handle multiple input formats gracefully:

```javascript
const pick = (...vals) => vals.find(v => v !== undefined && v !== null);

const voiceId = pick(
    req.body.voiceId,
    req.body.provider?.voiceId,
    req.body.voice?.id
);
```

### 5. Always Include Metadata

Add tracking metadata to every save:

```javascript
const newVoiceSettings = {
    ...settings,
    lastUpdated: new Date(),
    version: '2.0',
    enabled: true
};
```

### 6. Log Critical Checkpoints

For debugging, log key steps:

```javascript
console.log(`🔍 [SAVE-1] POST request for company: ${companyId}`);
console.log(`🔍 [SAVE-2] Raw body:`, JSON.stringify(req.body, null, 2));
console.log(`✅ [SAVE-16] Voice settings updated successfully`);
```

**Use numbered checkpoints** ([SAVE-1], [SAVE-2], etc.) to easily trace flow in production logs.

---

## 🔧 Troubleshooting Guide

### Issue 1: "Voice settings not saving" (400/500 errors)

**Symptoms:**
- POST returns 400 or 500
- No error details in response

**Diagnosis:**
```bash
# Check Render logs for [SAVE-*] checkpoints
# Look for which checkpoint fails:
# - [SAVE-4-FAIL] = voiceId missing
# - [SAVE-5-FAIL] = apiKey validation failed
# - [SAVE-16-ERROR] = Database error
```

**Solutions:**
1. Check if `voiceId` is present in request body
2. Check if company exists in database
3. Check for corrupt data in company document (use `scripts/fix-corrupt-company-data.js`)

---

### Issue 2: "Changes don't take effect immediately"

**Symptoms:**
- Settings save successfully
- But old voice is still used in calls

**Diagnosis:**
```bash
# Check if Redis cache was cleared
grep "Redis cache cleared" logs
```

**Solutions:**
1. Ensure cache invalidation is in save handler
2. Manually clear Redis: `redisClient.del('company:COMPANY_ID')`
3. Check cache TTL settings

---

### Issue 3: "ElevenLabs API errors during TTS"

**Symptoms:**
- Voice settings saved OK
- But TTS generation fails

**Diagnosis:**
```javascript
// Check if voiceId is valid
const voices = await getAvailableVoices(companyId);
const voiceExists = voices.find(v => v.voiceId === savedVoiceId);

if (!voiceExists) {
    console.error('Voice ID not found in available voices');
}
```

**Solutions:**
1. Verify `voiceId` is a valid ElevenLabs voice ID
2. Check if API key is valid (if using `apiSource: 'own'`)
3. Ensure company has access to the voice (some are premium)

---

### Issue 4: "Cannot read property 'voiceSettings' of undefined"

**Symptoms:**
- Runtime error when accessing voice settings
- `TypeError: Cannot read property 'voiceSettings' of undefined`

**Diagnosis:**
```javascript
console.log('aiAgentLogic exists?', !!company.aiAgentLogic);
console.log('voiceSettings exists?', !!company.aiAgentLogic?.voiceSettings);
```

**Solutions:**
```javascript
// Always use optional chaining and fallbacks
const voiceSettings = company.aiAgentLogic?.voiceSettings || {
    voiceId: 'pNInz6obpgDQGcFmaJgB', // Default voice
    stability: 0.5,
    similarityBoost: 0.7
};
```

---

## 📚 Related Documentation

- **Architecture Overview:** `/docs/AI-VOICE-SETTINGS-TAB-ARCHITECTURE.md`
- **ElevenLabs Service:** `/services/v2elevenLabsService.js`
- **Company Model:** `/models/v2Company.js`
- **Multi-Tenant Architecture:** `/docs/MULTI-TENANT-ARCHITECTURE.md`

---

## 🎓 Summary

### Key Takeaways

1. **Use targeted MongoDB updates** (`findByIdAndUpdate` with `$set`) instead of `company.save()` to avoid full document validation
2. **Always clear Redis cache** after updates for immediate effect
3. **Validate `voiceId` on backend** - it's required for ElevenLabs API
4. **Use optional chaining** (`?.`) when accessing nested `aiAgentLogic` properties
5. **Log numbered checkpoints** for easier production debugging
6. **Never expose API keys** in responses - always mask them

### Integration Checklist for AI Agent Settings

- [ ] Load voice settings via `company.aiAgentLogic.voiceSettings`
- [ ] Use `.lean()` for faster read-only queries
- [ ] Implement Redis caching with proper TTL
- [ ] Clear cache on any voice settings update
- [ ] Provide fallback default voice if settings missing
- [ ] Pass voice settings to ElevenLabs service for TTS
- [ ] Handle both `apiSource: 'clientsvia'` and `apiSource: 'own'`
- [ ] Log voice selection in AI Agent call logs

---

**Document Version:** 1.0  
**Last Reviewed:** October 16, 2025  
**Next Review:** When integrating with new AI Agent features

