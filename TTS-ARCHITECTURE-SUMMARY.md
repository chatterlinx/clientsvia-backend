# Text-to-Speech (TTS) Architecture Summary

## Executive Summary

**Primary TTS Provider:** ElevenLabs  
**Backup/Alternative:** None configured (ElevenLabs only)  
**Deepgram Role:** Speech-to-Text (STT) ONLY - NOT used for TTS  

---

## What You're Using

### 🎙️ ElevenLabs - Text-to-Speech (Voice Generation)

**Purpose:** Converts AI agent text responses into natural-sounding speech  
**When It's Called:** Every time the AI agent speaks to a customer during a call  
**API:** `https://api.elevenlabs.io/v1`

### 🎧 Deepgram - Speech-to-Text (Transcription)

**Purpose:** Converts customer voice → text for AI to understand  
**Role:** STT/ASR (Speech-to-Text / Automatic Speech Recognition)  
**NOT USED FOR:** Text-to-Speech

---

## ElevenLabs Usage Flow

### Where ElevenLabs is Called

```
Customer Call → AI Generates Response → synthesizeSpeech() → ElevenLabs API → Audio → Customer Hears It
```

### Key Call Points (routes/v2twilio.js)

1. **Greeting** (Line ~1772)
   - When call first connects
   - Greeting audio generated via ElevenLabs

2. **AI Responses** (Lines 2804, 4133)
   - Every AI agent response during conversation
   - Text from LLM → ElevenLabs TTS → Audio

3. **Retry Messages** (Line ~2561)
   - When customer input unclear
   - Retry prompts via ElevenLabs

4. **Cached Answers** (Line ~2689)
   - Pre-generated responses from cache
   - Still use ElevenLabs for TTS

### Service Location

**File:** `services/v2elevenLabsService.js`

**Main Function:**
```javascript
async function synthesizeSpeech({
  text,
  voiceId,
  stability,
  similarity_boost,
  style,
  use_speaker_boost,
  model_id = 'eleven_turbo_v2_5',
  optimize_streaming_latency,
  output_format = 'mp3_44100_128',
  apiKey,
  company
})
```

---

## API Key Configuration

### Two Options

#### Option 1: ClientsVia Global API (Default)
```javascript
aiAgentSettings.voiceSettings.apiSource = 'clientsvia'
// Uses: process.env.ELEVENLABS_API_KEY
```

#### Option 2: Company's Own API
```javascript
aiAgentSettings.voiceSettings.apiSource = 'own'
aiAgentSettings.voiceSettings.apiKey = 'sk_xxx...'
```

### Key Detection Logic

1. Check `company.aiAgentSettings.voiceSettings.apiSource`
2. If `'own'` → Use `company.aiAgentSettings.voiceSettings.apiKey`
3. If `'clientsvia'` → Use `process.env.ELEVENLABS_API_KEY`
4. Fallback → Global key from environment

**File:** `services/v2elevenLabsService.js` (lines 10-52)

---

## Voice Settings Storage

### Database Schema (models/v2Company.js)

```javascript
aiAgentSettings: {
  voiceSettings: {
    // API Configuration
    apiSource: { 
      type: String, 
      enum: ['clientsvia', 'own'], 
      default: 'clientsvia' 
    },
    apiKey: { type: String },  // Company-specific key
    
    // Voice Selection
    voiceId: { type: String },  // e.g., "pNInz6obpgDQGcFmaJgB"
    voiceName: { type: String },
    
    // Voice Parameters
    stability: { type: Number, default: 0.5 },
    similarityBoost: { type: Number, default: 0.75 },
    style: { type: Number, default: 0.0 },
    useSpeakerBoost: { type: Boolean, default: true },
    
    // Model Configuration
    modelId: { 
      type: String, 
      default: 'eleven_turbo_v2_5' 
    },
    outputFormat: { 
      type: String, 
      default: 'mp3_44100_128' 
    }
  }
}
```

---

## Features & Enhancements

### Text Formatting for Natural Speech

**File:** `utils/textUtils.js`  
**Function:** `formatForTTS(text)`

#### What It Does
- Formats phone numbers: "239-565-2202" → "2 3 9, 5 6 5, 2 2 zero 2"
- Formats addresses: "12155 Metro Pkwy" → "1 2 1 5 5 Metro Parkway"
- Ensures "zero" pronunciation instead of "oh"

**Applied at:** Line 224 in `services/v2elevenLabsService.js`

```javascript
const { formatForTTS } = require('../utils/textUtils');
const formattedText = formatForTTS(text);
```

### Available Models

Default: `eleven_turbo_v2_5` (fast, low latency)

Options:
- `eleven_monolingual_v1`
- `eleven_multilingual_v1`
- `eleven_multilingual_v2`
- `eleven_turbo_v2`
- `eleven_turbo_v2_5` ← Current default

---

## Routes & Endpoints

### GET/POST `/api/v2/tts/voices`
**File:** `routes/v2tts.js`  
**Purpose:** Fetch available voices from ElevenLabs  
**Auth:** JWT required

**Response:**
```json
[
  {
    "id": "pNInz6obpgDQGcFmaJgB",
    "displayName": "Adam (Male)"
  },
  {
    "id": "EXAVITQu4vr4xnSDxMaL",
    "displayName": "Sarah (Female)"
  }
]
```

### POST `/api/v2/elevenlabs/synthesize`
**File:** `routes/v2elevenLabs.js`  
**Purpose:** Generate speech audio from text  
**Auth:** JWT required

---

## Error Handling

### Mock Voices for Testing

If API key invalid or missing:
```javascript
// Returns mock voice data for UI testing
const mockVoices = getMockVoices();
```

**File:** `services/v2elevenLabsService.js` (lines 150-158)

### Company-Level Error Tracking

```javascript
logger.companyError({
  companyId: company._id,
  code: 'ELEVENLABS_VOICE_FETCH_FAILURE',
  severity: 'WARNING' | 'CRITICAL',
  error,
  meta: {
    apiSource: company.aiAgentSettings.voiceSettings.apiSource,
    hasApiKey: Boolean(apiKey)
  }
});
```

---

## Performance & Optimization

### Caching
- Voice list cached to reduce API calls
- Audio files cached for repeated phrases

### Latency Optimization
- `optimize_streaming_latency` parameter
- `eleven_turbo_v2_5` model for fastest response
- Audio format: `mp3_44100_128` (optimized quality/size)

### Streaming
- Audio streams directly to Twilio
- No local file storage required
- Reduced memory footprint

---

## Cost Management

### Tracking
- Character count logged per request
- Token cost factor from model metadata
- Usage tracked per company

### Tiers
```javascript
{
  max_characters_request_free_tier: 5000,
  max_characters_request_subscribed_tier: 50000,
  token_cost_factor: 1.0
}
```

---

## Summary: When ElevenLabs is Contacted

✅ **Every time the AI agent speaks:**
- Initial greeting
- Conversation responses  
- Follow-up questions
- Confirmations
- Retry/clarification prompts
- Cached responses

❌ **Never contacted for:**
- Speech-to-text (that's Deepgram)
- Call routing
- Number validation
- SMS

---

## Quick Reference

| What | Provider | File |
|------|----------|------|
| **Speech → Text** | Deepgram | `services/stt/DeepgramService.js` |
| **Text → Speech** | ElevenLabs | `services/v2elevenLabsService.js` |
| **Call Runtime** | Twilio | `routes/v2twilio.js` |
| **Voice Config** | MongoDB | `models/v2Company.js` |

---

## Recommendations

### Current Setup: ✅ Solid
- ElevenLabs is industry-leading for TTS quality
- Turbo v2.5 model optimized for low latency
- Text formatting ensures natural pronunciation

### Consider:
1. **Fallback TTS Provider** - Add Deepgram TTS as backup
2. **Voice Caching** - Pre-generate common phrases
3. **Usage Monitoring** - Track costs per company
4. **A/B Testing** - Compare voice models for quality/cost

---

**Generated:** 2026-02-26  
**For:** ClientsVia Platform - TTS Architecture Review
