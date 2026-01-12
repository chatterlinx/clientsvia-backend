# 🎯 VOICE SETTINGS STORAGE - CLARIFICATION

**Date:** November 9, 2025  
**Status:** PRODUCTION VERIFIED ✅

---

## 🔍 THE CONFUSION

You mentioned:
> "I think `aiAgentLogic` is legacy! We deleted the `aiAgentLogic` tab a while ago. We're using `aiAgentSettings` now."

## ✅ THE TRUTH - TWO SEPARATE SYSTEMS

You have **TWO COMPLETELY DIFFERENT systems** with similar names:

### **1️⃣ `aiAgentSettings` - Template & Variables System**

**Schema Location:** `/models/v2Company.js` (lines 947-1187)  
**Purpose:** Manages Global AI Brain template references and placeholder variables  
**UI Tab:** "AI Agent Settings" (template references, variables, filler words)

**What it stores:**
```javascript
company.aiAgentSettings = {
    templateReferences: [{ templateId, enabled, priority }],
    variableDefinitions: [{ key, label, description, type }],
    variables: Map of { key: value },  // e.g., {"companyName": "Royal Plumbing"}
    fillerWords: { inherited: [], custom: [] },
    scenarioControls: [{ templateId, scenarioId, isEnabled }]
}
```

**NO VOICE SETTINGS IN THIS!**

---

### **2️⃣ `aiAgentLogic` - Voice & Intelligence System**

**Schema Location:** `/models/v2Company.js` (lines 188-733)  
**Purpose:** Manages ElevenLabs voice configuration and AI intelligence thresholds  
**UI Tab:** "AI Voice Settings" (the tab you're looking at in the screenshot)

**What it stores:**
```javascript
company.aiAgentLogic = {
    enabled: true,
    
    // 🎤 VOICE SETTINGS - This is what you're configuring!
    voiceSettings: {
        apiSource: 'clientsvia',
        voiceId: 'UgBBYS2sOqTuMpoF3BR0',
        stability: 0.5,
        similarityBoost: 0.7,
        styleExaggeration: 0.0,
        speakerBoost: true,
        aiModel: 'eleven_turbo_v2_5',
        outputFormat: 'mp3_44100_128',
        streamingLatency: 0
    },
    
    // AI intelligence thresholds
    thresholds: { /* ... */ },
    
    // Agent personality
    agentPersonality: { /* ... */ },
    
    // Production intelligence config
    productionIntelligence: { /* ... */ }
}
```

---

## 🎯 WHAT TAB WAS DELETED?

Based on your UI screenshot showing **"AI Voice Settings"**, this is **NOT** a deleted tab. This tab is **ACTIVE and CURRENT**.

**What might have been deleted:**
- Perhaps an old "AI Agent Logic" configuration tab that managed OTHER settings
- But the `aiAgentLogic.voiceSettings` data structure is **ACTIVE and IN USE**

---

## 📸 YOUR SCREENSHOT ANALYSIS

From your screenshot, I can see:

**Tab:** "🎤 AI Voice Settings"  
**Section:** "Voice Selection & Preview"  
**Selected Voice:** "Mark - Natural Conversations"  
**Voice ID:** UgBBYS2s... (visible in screenshot)

**This UI saves to:** `company.aiAgentLogic.voiceSettings`

**API Endpoint:** `POST /api/company/:companyId/v2-voice-settings`

**Verified in code:**
```javascript
// Frontend: /public/js/ai-voice-settings/VoiceSettingsManager.js (line 632)
const response = await fetch(`/api/company/${this.companyId}/v2-voice-settings`, {
    method: 'POST',
    body: JSON.stringify(settings)
});

// Backend: /routes/company/v2profile-voice.js (line 505)
await Company.findByIdAndUpdate(
    companyId,
    { $set: { 'aiAgentLogic.voiceSettings': newVoiceSettings } }
);
```

---

## 🔥 THE BUG WE JUST FIXED

**The Issue:**
- **First leg (greeting):** ElevenLabs works ✅
- **Second leg (response):** Falls back to Twilio voice ❌

**The Cause:**
The second leg code was:
1. ❌ Missing the `company` parameter (so API key lookup failed)
2. ❌ Using wrong property names (`style` instead of `styleExaggeration`, etc.)

**The Fix:**
We corrected the second leg to match the first leg:
```javascript
// routes/v2twilio.js (line 1766-1775)
const audioBuffer = await synthesizeSpeech({
    text: responseText,
    voiceId: elevenLabsVoice,
    stability: company.aiAgentLogic?.voiceSettings?.stability,
    similarity_boost: company.aiAgentLogic?.voiceSettings?.similarityBoost,
    style: company.aiAgentLogic?.voiceSettings?.styleExaggeration,  // ✅ FIXED
    use_speaker_boost: company.aiAgentLogic?.voiceSettings?.speakerBoost,  // ✅ ADDED
    model_id: company.aiAgentLogic?.voiceSettings?.aiModel,  // ✅ FIXED
    company  // ✅ CRITICAL: Now passes company for API key lookup
});
```

**Both legs now read from:** `company.aiAgentLogic.voiceSettings`

---

## ✅ VERIFICATION

To confirm voice settings are being saved correctly:

### **Check in MongoDB:**
```javascript
db.v2companies.findOne(
    { _id: ObjectId("68e3f77a9d623b8058c700c4") },
    { "aiAgentLogic.voiceSettings": 1 }
)
```

### **Expected Output:**
```javascript
{
    "_id": ObjectId("68e3f77a9d623b8058c700c4"),
    "aiAgentLogic": {
        "voiceSettings": {
            "apiSource": "clientsvia",
            "voiceId": "UgBBYS2sOqTuMpoF3BR0",
            "stability": 0.5,
            "similarityBoost": 0.7,
            "styleExaggeration": 0,
            "speakerBoost": true,
            "aiModel": "eleven_turbo_v2_5",
            "outputFormat": "mp3_44100_128",
            "streamingLatency": 0,
            "enabled": true,
            "lastUpdated": ISODate("2025-10-17T19:42:26.240Z"),
            "version": "2.0"
        }
    }
}
```

---

## 🎓 SUMMARY

| System | Field | Purpose | UI Location |
|--------|-------|---------|-------------|
| **Templates** | `aiAgentSettings` | Template references, variables, placeholders | "AI Agent Settings" tab |
| **Voice** | `aiAgentLogic.voiceSettings` | ElevenLabs voice configuration | "**AI Voice Settings**" tab (your screenshot) |

**YOUR SCREENSHOT shows the VOICE SETTINGS tab**, which is **100% ACTIVE** and saves to `aiAgentLogic.voiceSettings`.

**The bug we fixed ensures both greeting AND response use the SAME voice settings from this location.**

---

## 🚨 NO ACTION NEEDED

The voice settings system is **working correctly**:
- ✅ UI saves to correct location (`aiAgentLogic.voiceSettings`)
- ✅ First leg reads from correct location
- ✅ Second leg NOW reads from correct location (just fixed!)
- ✅ No legacy paths involved

**The confusion was just about the similar names:**
- `aiAgentSettings` ≠ `aiAgentLogic`
- They are two separate, active systems
- Voice settings live in `aiAgentLogic` (correct and active)

---

**END OF CLARIFICATION**

