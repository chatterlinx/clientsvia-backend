# Company Profile Architecture Map
> **Generated:** 2026-01-20 | **Status:** Production Audit

## Overview

The **Company Profile** (`company-profile.html`) is the **onboarding and configuration hub** for each company in the ClientsVia platform. It feeds data into the AI Agent runtime through the `v2Company` Mongoose model.

---

## Tab-to-Schema Mapping

### 1️⃣ Overview Tab
**Purpose:** Basic company information and contacts

| UI Field | Schema Path | Used By Runtime |
|----------|-------------|-----------------|
| Company Name | `companyName` | ✅ Placeholders, TTS |
| Business Phone | `businessPhone` | ✅ Placeholders |
| Business Email | `businessEmail` | ✅ Placeholders |
| Business Website | `businessWebsite` | ✅ Placeholders |
| Business Address | `businessAddress` → `address{}` | ✅ Placeholders |
| Service Area | `serviceArea` | ✅ Placeholders |
| Business Hours | `businessHours` (string) | ⚠️ Legacy - prefer `aiAgentSettings.businessHours` |
| Company Contacts | `contacts[]` | ✅ Transfer targets |

**JS Manager:** `company-profile-modern.js` → `populateOverviewTab()`

---

### 2️⃣ Configuration Tab
**Purpose:** Twilio credentials and account status

| UI Field | Schema Path | Used By Runtime |
|----------|-------------|-----------------|
| Twilio Account SID | `twilioConfig.accountSid` | ✅ Call routing |
| Twilio Auth Token | `twilioConfig.authToken` | ✅ Call routing |
| Twilio API Key | `twilioConfig.apiKey` | ✅ Optional |
| Twilio API Secret | `twilioConfig.apiSecret` | ✅ Optional |
| Phone Numbers | `twilioConfig.phoneNumbers[]` | ✅ Inbound routing |
| Account Status | `accountStatus.status` | ✅ **CRITICAL** - Controls call routing |
| Call Forward Number | `accountStatus.callForwardNumber` | ✅ When status=call_forward |
| Call Forward Message | `accountStatus.callForwardMessage` | ✅ TTS before forwarding |
| Suspended Message | `accountStatus.suspendedMessage` | ✅ TTS when suspended |

**JS Manager:** `company-profile-modern.js` → `populateConfigTab()`

**Runtime Wiring:**
- `routes/v2twilio.js` checks `accountStatus.status` first thing
- If `suspended` → plays `suspendedMessage` and hangs up
- If `call_forward` → plays `callForwardMessage` and forwards to `callForwardNumber`
- If `active` → proceeds to AI agent

---

### 3️⃣ Notes Tab
**Purpose:** Internal developer/admin notes

| UI Field | Schema Path | Used By Runtime |
|----------|-------------|-----------------|
| Notes List | `notes[]` | ❌ Internal only |

**JS Manager:** `company-profile-modern.js` → `populateNotesTab()`

---

### 4️⃣ AI Voice Settings Tab
**Purpose:** ElevenLabs TTS configuration

| UI Field | Schema Path | Used By Runtime |
|----------|-------------|-----------------|
| Use Own API Toggle | `aiAgentSettings.voiceSettings.apiSource` | ✅ TTS provider |
| ElevenLabs API Key | `aiAgentSettings.voiceSettings.apiKey` | ✅ When apiSource='own' |
| Voice ID | `aiAgentSettings.voiceSettings.voiceId` | ✅ **CRITICAL** - Which voice |
| Stability | `aiAgentSettings.voiceSettings.stability` | ✅ Voice quality |
| Similarity Boost | `aiAgentSettings.voiceSettings.similarityBoost` | ✅ Voice quality |
| Style | `aiAgentSettings.voiceSettings.styleExaggeration` | ✅ Voice quality |
| Speaker Boost | `aiAgentSettings.voiceSettings.speakerBoost` | ✅ Voice quality |
| AI Model | `aiAgentSettings.voiceSettings.aiModel` | ✅ eleven_turbo_v2_5 etc. |
| Output Format | `aiAgentSettings.voiceSettings.outputFormat` | ✅ mp3_44100_128 etc. |
| Streaming Latency | `aiAgentSettings.voiceSettings.streamingLatency` | ✅ Performance |

**JS Manager:** `public/js/ai-voice-settings/VoiceSettingsManager.js`

**Runtime Wiring:**
- `services/ElevenLabsService.js` reads these settings
- `routes/v2twilio.js` calls ElevenLabs for TTS

---

### 5️⃣ AI Agent Settings Tab
**Purpose:** AI behavior configuration - MOST COMPLEX TAB

#### Sub-tabs:

##### 5a. Dashboard (System Diagnostics)
| Component | Schema Path | Purpose |
|-----------|-------------|---------|
| Twilio Status | `twilioConfig.*` | Connection health |
| Voice Status | `aiAgentSettings.voiceSettings.*` | ElevenLabs health |
| Template Status | `aiAgentSettings.templateReferences[]` | Brain templates |
| Variables Status | `aiAgentSettings.variables` | Placeholder values |

**JS Manager:** `SystemDiagnostics.js`, `TwilioControlCenter.js`

##### 5b. Messages & Greetings
| UI Field | Schema Path | Used By Runtime |
|----------|-------------|-----------------|
| Voice Mode | `connectionMessages.voice.mode` | ✅ prerecorded/realtime |
| Greeting Text | `connectionMessages.voice.text` | ✅ **CRITICAL** - Initial greeting |
| Pre-recorded URL | `connectionMessages.voice.prerecorded.activeFileUrl` | ✅ When mode=prerecorded |
| Realtime TTS Text | `connectionMessages.voice.realtime.text` | ✅ When mode=realtime |
| SMS Auto-Reply | `connectionMessages.sms.*` | ✅ SMS responses |

**JS Manager:** `ConnectionMessagesManager.js`

**Runtime Wiring:**
- `routes/v2twilio.js` → `getGreeting()` reads `connectionMessages.voice`
- Initial greeting is THE FIRST THING caller hears

##### 5c. Call Logs (Coming Soon)
Not yet implemented.

---

### 6️⃣ Spam Filter Tab
**Purpose:** Blacklist/whitelist management

| UI Field | Schema Path | Used By Runtime |
|----------|-------------|-----------------|
| Spam Filter Enabled | `aiAgentSettings.llm0Controls.spamFilter.enabled` | ✅ Layer 3 protection |
| Telemarketer Phrases | `aiAgentSettings.llm0Controls.spamFilter.telemarketerPhrases[]` | ✅ Pattern matching |
| On Spam Action | `aiAgentSettings.llm0Controls.spamFilter.onSpamDetected` | ✅ What to do |
| Dismiss Message | `aiAgentSettings.llm0Controls.spamFilter.dismissMessage` | ✅ Polite hangup |
| Blacklist | (separate collection or inline) | ✅ Number blocking |
| Whitelist | (separate collection or inline) | ✅ VIP numbers |

**JS Manager:** `SpamFilterManager.js`

---

## Deep Schema: aiAgentSettings

This is the **megastructure** that powers AI behavior:

```
aiAgentSettings: {
    // TEMPLATE SYSTEM
    templateReferences: [{templateId, enabled, priority}]
    
    // BUSINESS HOURS
    businessHours: {timezone, weekly: {}, holidays: []}
    
    // PLACEHOLDERS
    variableDefinitions: [{key, label, type, required, usageCount}]
    variables: Map<string, string>  // ← The actual values
    
    // CHEAT SHEET (Edge Cases, Guardrails, etc.)
    cheatSheet: {
        version, status, behaviorRules: [],
        edgeCases: [{triggerPatterns, responseText, priority}],
        transferRules: [{intentTag, phoneNumber, script}],
        guardrails: ['NO_PRICES', 'NO_DIAGNOSES', ...],
        bookingRules: [],
        companyContacts: [],
        manualTriageRules: []
    }
    
    // FILLER WORDS
    fillerWords: {inherited: [], custom: []}
    nameStopWords: {enabled, custom: []}
    
    // SCENARIO CONTROLS
    scenarioControls: [{templateId, scenarioId, isEnabled}]
    
    // VOICE SETTINGS
    voiceSettings: {apiSource, apiKey, voiceId, stability, ...}
    
    // TRANSFER TARGETS
    transferTargets: [{id, label, destination, priority, enabled}]
    
    // LLM-0 CONTROLS
    llm0Controls: {
        silenceHandling: {...},
        loopDetection: {...},
        spamFilter: {...},
        customerPatience: {...},
        bailoutRules: {...},
        confidenceThresholds: {...},
        lowConfidenceHandling: {...},
        recoveryMessages: {...},
        frustrationDetection: {...},
        responseTiming: {...},
        smartConfirmation: {...}
    }
    
    // CALL FLOW ENGINE
    callFlowEngine: {
        enabled, missionTriggers: {},
        bookingFields: [],
        style: {preset, customNotes, greeting},
        quickAnswers: [],
        synonymMap: {},
        trades: []
    }
    
    // FRONT DESK BEHAVIOR
    frontDeskBehavior: {
        enabled,
        personality: {agentName, tone, verbosity, useCallerName},
        conversationStyle: 'balanced',
        discoveryConsent: {...},
        bookingSettings: {...},
        bookingPrompts: [...],
        bookingPromptsMap: Map<string, string>
    }
}
```

---

## Runtime Data Flow

```
Caller dials → Twilio webhook
       ↓
routes/v2twilio.js
       ↓
Check accountStatus (suspended/forward/active)
       ↓
Load company from MongoDB (v2Company)
       ↓
Play initial greeting (connectionMessages.voice)
       ↓
ConversationEngine.processTurn()
       ↓
├── Check spam filter (llm0Controls.spamFilter)
├── Check edge cases (cheatSheet.edgeCases)
├── Check scenarios (templateReferences → GlobalInstantResponseTemplate)
├── Check dynamic flows (callFlowEngine)
├── Fallback to LLM (HybridReceptionistLLM)
       ↓
Generate response → ElevenLabs TTS (voiceSettings)
       ↓
Stream audio to Twilio → Caller hears response
```

---

## JS Managers Reference

| Manager | Tab | Schema Path |
|---------|-----|-------------|
| `company-profile-modern.js` | All basic tabs | Root company fields |
| `AIAgentSettingsManager.js` | AI Agent Settings | `aiAgentSettings.*` |
| `SystemDiagnostics.js` | Dashboard | Read-only health checks |
| `TwilioControlCenter.js` | Dashboard | `twilioConfig.*` |
| `ConnectionMessagesManager.js` | Messages & Greetings | `connectionMessages.*` |
| `VoiceSettingsManager.js` | AI Voice | `aiAgentSettings.voiceSettings.*` |
| `FrontDeskBehaviorManager.js` | Control Plane | `aiAgentSettings.frontDeskBehavior.*` |
| `SpamFilterManager.js` | Spam Filter | `aiAgentSettings.llm0Controls.spamFilter.*` |
| `TransferDirectoryManager.js` | Control Plane | `aiAgentSettings.transferTargets[]` |
| `CallProtectionManager.js` | Control Plane | `aiAgentSettings.cheatSheet.edgeCases[]` |

---

## Critical Wiring Points

### 1. Greeting (MOST IMPORTANT)
```
connectionMessages.voice.text → v2twilio.js getGreeting() → TTS → Caller hears
```

### 2. Account Status
```
accountStatus.status → v2twilio.js first check → Determines if call proceeds
```

### 3. Voice ID
```
aiAgentSettings.voiceSettings.voiceId → ElevenLabsService → All TTS output
```

### 4. Scenarios
```
aiAgentSettings.templateReferences[].templateId → GlobalInstantResponseTemplate → HybridScenarioSelector
```

### 5. Booking Prompts
```
aiAgentSettings.frontDeskBehavior.bookingPrompts[] → ConversationEngine → Slot collection
```

---

## TODO: Audit Findings

### ✅ Working
- [ ] To be filled during audit

### ⚠️ Partially Working
- [ ] To be filled during audit

### ❌ Not Wired / Dead Code
- [ ] To be filled during audit

---

*This document is the source of truth for Company Profile architecture.*
