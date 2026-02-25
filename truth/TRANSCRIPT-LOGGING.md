# Transcript Logging — Complete Audit & Specification

> **Last updated:** 2026-02-25
> **Canonical store:** `CallTranscriptV2` (MongoDB)
> **Schema:** `models/CallTranscriptV2.js`
> **Primary writer:** `routes/v2twilio.js`
> **Primary reader:** `routes/agentConsole/agentConsole.js` → `GET /:companyId/calls/:callSid`

---

## Architecture

Every call produces a single `CallTranscriptV2` document keyed by `(companyId, callSid)`.
Turns are appended via `CallTranscriptV2.appendTurns()` which uses:

- `$push` to add turns to the `turns` array
- `$addToSet` on `turnKeys` / `humanTurnKeys` / `systemTurnKeys` for dedup tracking
- Read-side dedup via `Map` keyed on `turnNumber:speaker:kind:sourceKey:textPrefix(24)`

### Turn Schema

```
{
  turnNumber:  Number     — 0 = greeting, 1+ = conversation turns
  speaker:     String     — 'caller' | 'agent' | 'system'
  kind:        String     — classifies the turn (see Turn Kinds below)
  text:        String     — what was said / played / the action description
  ts:          Date       — when the turn was created
  sourceKey:   String     — which subsystem produced this turn
  trace:       Mixed      — provenance, diagnostics, timing data
}
```

### Turn Kinds (3-Stream Model)

| Kind | Speaker | Stream | Description |
|------|---------|--------|-------------|
| `CONVERSATION_AGENT` | agent | conversation | Real agent response to caller |
| `CONVERSATION_CALLER` | caller | conversation | Caller's transcribed speech |
| `TWIML_PLAY` | system | telephony | Audio file played to caller via `<Play>` |
| `TWIML_SAY` | system | telephony | Text spoken via Twilio `<Say>` |
| `TWIML_PAUSE` | system | telephony | Silence played via `<Pause>` |
| `STT_EMPTY` | system | diagnostics | Gather fired with no speech captured |

---

## Call Lifecycle — Every Logging Point

### Phase 1: Call Initiation (`POST /api/twilio/voice`)

#### L1 — Greeting (agent, turn 0)
| Field | Value |
|-------|-------|
| **File** | `v2twilio.js:2037` |
| **Trigger** | Greeting TwiML generated from `initializeCall()` |
| **Speaker** | `agent` |
| **Kind** | `CONVERSATION_AGENT` |
| **sourceKey** | `agent2.greetings.callStart` or `legacy.greeting` |
| **Trace** | provenance (UI_OWNED), greeting mode/source, voice provider, audio URL |
| **Blocking?** | Awaited before TwiML response |
| **Failure mode** | MongoDB error → caught, warning logged, call continues |

#### L2 — Greeting telephony action (system, turn 0)
| Field | Value |
|-------|-------|
| **File** | `v2twilio.js:2068` |
| **Trigger** | Same as L1, immediately after |
| **Speaker** | `system` |
| **Kind** | `TWIML_PLAY` (if ElevenLabs audio) or `TWIML_SAY` (if Twilio voice) |
| **sourceKey** | `twiml` |
| **Trace** | action type, audioUrl, voiceProviderUsed, gather URLs |
| **Blocking?** | Awaited |

---

### Phase 2: Caller Speech Arrives (`POST /api/twilio/v2-agent-respond/:companyID`)

#### L3 — Caller speech (caller)
| Field | Value |
|-------|-------|
| **File** | `v2twilio.js:3656` |
| **Trigger** | `SpeechResult` is non-empty in request body |
| **Speaker** | `caller` |
| **Kind** | `CONVERSATION_CALLER` |
| **sourceKey** | `stt` |
| **Trace** | `{ inputTextSource }` — speechResult / partialCache / partialCachePreferred |
| **Blocking?** | Awaited |
| **Condition** | Only logged if `speechResult && speechResult.trim()` |

#### L4 — STT empty diagnostic (system)
| Field | Value |
|-------|-------|
| **File** | `v2twilio.js:3692` |
| **Trigger** | `SpeechResult` is empty (actionOnEmptyResult fired) |
| **Speaker** | `system` |
| **Kind** | `STT_EMPTY` |
| **sourceKey** | `stt` |
| **Trace** | inputTextSource, speechResultLen, callSid, actionOnEmptyResult |
| **Blocking?** | Awaited |
| **Condition** | Only when speechResult is falsy AND callSid exists |

---

### Phase 3a: Agent Response — Non-Bridge Path

When `mayBridge` is false OR the response finishes before the threshold:

#### L5 — Agent response (agent)
| Field | Value |
|-------|-------|
| **File** | `v2twilio.js:4172` |
| **Trigger** | Agent response computed, TTS completed |
| **Speaker** | `agent` |
| **Kind** | `CONVERSATION_AGENT` |
| **sourceKey** | `runtimeResult.matchSource` — e.g. `AGENT2_DISCOVERY`, `LLM_FALLBACK` |
| **Trace** | Full provenance (type, uiPath, triggerId, tracePack), matchSource, triggerCard, lane, awHash |
| **Blocking?** | Awaited |
| **Condition** | Only if `responseText && responseText.trim()` |

#### L6 — Agent telephony action (system)
| Field | Value |
|-------|-------|
| **File** | `v2twilio.js:4198` |
| **Trigger** | Same as L5, immediately after |
| **Speaker** | `system` |
| **Kind** | `TWIML_PLAY` (ElevenLabs audio) or `TWIML_SAY` (Twilio voice) |
| **sourceKey** | `twiml` |
| **Trace** | action, audioUrl, voiceProviderUsed, gather URLs |
| **Blocking?** | Awaited |

---

### Phase 3b: Agent Response — Bridge Path

When the bridge threshold is exceeded:

#### L7 — Bridge filler (system)
| Field | Value |
|-------|-------|
| **File** | `v2twilio.js:4502` |
| **Trigger** | Bridge threshold crossed, bridge line selected |
| **Speaker** | `system` |
| **Kind** | `TWIML_PLAY` (cached ElevenLabs audio) or `TWIML_PAUSE` (no cached audio) |
| **sourceKey** | `AGENT2_BRIDGE` |
| **Trace** | provenance (UI_OWNED, bridge config), tracePack with resolver=bridge, tts provider, latency |
| **Blocking?** | Awaited |
| **Note** | The real agent response continues computing in background |

#### L5-inside-IIFE — Agent response (agent) — background
| Field | Value |
|-------|-------|
| **File** | `v2twilio.js:4192` (inside computeTurnPromise IIFE) |
| **Trigger** | Background compute completes successfully |
| **Speaker** | `agent` |
| **Kind** | `CONVERSATION_AGENT` |
| **sourceKey** | Same as L5 |
| **Blocking?** | Runs in detached promise — does NOT block the bridge TwiML response |
| **Risk** | If the IIFE throws before reaching this line, the agent turn is lost |

#### L8 — Bridge continuation safety net (agent)
| Field | Value |
|-------|-------|
| **File** | `v2twilio.js:3126` |
| **Trigger** | Continuation endpoint serves cached response with `agentTurn` data |
| **Speaker** | `agent` |
| **Kind** | `CONVERSATION_AGENT` |
| **sourceKey** | from cached data, or `AGENT2_BRIDGE_CONTINUE` |
| **Trace** | provenance from cache, `deliveredVia: 'bridge_continuation'`, timings |
| **Blocking?** | Awaited |
| **Purpose** | Backup — ensures agent turn appears even if L5-inside-IIFE failed |

#### L9 — Bridge timeout transfer (agent)
| Field | Value |
|-------|-------|
| **File** | `v2twilio.js:3227` |
| **Trigger** | Bridge timeout or compute failure → transfer fallback |
| **Speaker** | `agent` |
| **Kind** | `CONVERSATION_AGENT` |
| **sourceKey** | `AGENT2_BRIDGE_TIMEOUT` |
| **Trace** | provenance (UI_OWNED), reason, attempt, elapsedMs, error |
| **Blocking?** | Awaited |

---

### Phase 4: Error/Crash Handlers

#### L10 — v2-agent-respond crash (agent)
| Field | Value |
|-------|-------|
| **File** | `v2twilio.js:4780` |
| **Trigger** | Unhandled exception in the main respond route |
| **Speaker** | `agent` |
| **Kind** | `CONVERSATION_AGENT` |
| **sourceKey** | `ROUTE_CRASH` |
| **Text** | `"I'm connecting you to our team."` |
| **Trace** | provenance (HARDCODED, reason=route_crash), error message |

#### L11 — bridge-continue crash (agent)
| Field | Value |
|-------|-------|
| **File** | `v2twilio.js:3307` |
| **Trigger** | Unhandled exception in bridge continuation route |
| **Speaker** | `agent` |
| **Kind** | `CONVERSATION_AGENT` |
| **sourceKey** | `BRIDGE_CONTINUE_CRASH` |
| **Text** | `"I'm connecting you to our team."` |
| **Trace** | provenance (HARDCODED, reason=route_crash), error message |

---

## What's NOT Logged (Known Gaps)

These are spoken to the caller but intentionally not logged to CallTranscriptV2:

| Location | Message | Reason |
|----------|---------|--------|
| `handleTransfer()` L763 | Company transfer message | Only called from bridge timeout (already logged at L9) |
| `/voice` L1064 | "Configuration error..." | Pre-call error, no callSid context available |
| `/voice` L1098 | "This call has been blocked." | Spam filter, intentionally not recorded |
| `/voice` L1334 | Suspended account message | Account-level block |
| `/voice` L2170 | "Service temporarily unavailable" | General voice endpoint error |
| Test endpoints | Various test messages | Not production calls |

---

## Provenance Summary (Call Report)

Built by `buildProvenanceSummary()` in `callconsole.js`:

| Counter | Description |
|---------|-------------|
| `totalAgentTurns` | All turns with `speaker: 'agent'` (includes bridge-delivered) |
| `agentTurnsReal` | Agent turns excluding bridge fillers |
| `bridgeTurns` | Turns with `provenance.isBridge === true` or `source === 'AGENT2_BRIDGE'` |
| `agentTurnsTraced` | Real agent turns that are `UI_OWNED` |
| `uiOwned` | UI_OWNED turns excluding bridge fillers |
| `fallbacks` | Turns with `provenance.type === 'FALLBACK'` |
| `violations` | Turns with `provenance.type === 'HARDCODED'` |

---

## sourceKey Reference

| sourceKey | Meaning |
|-----------|---------|
| `agent2.greetings.callStart` | Greeting from Agent 2.0 config |
| `legacy.greeting` | Greeting from legacy config |
| `stt` | Speech-to-text (caller speech or STT_EMPTY) |
| `twiml` | Telephony action (what Twilio actually played) |
| `AGENT2_DISCOVERY` | Agent 2.0 trigger card match |
| `AGENT2_BRIDGE` | Bridge filler line |
| `AGENT2_BRIDGE_CONTINUE` | Agent response delivered via bridge continuation |
| `AGENT2_BRIDGE_TIMEOUT` | Transfer fallback after bridge timeout |
| `LLM_FALLBACK` | LLM-generated response (no trigger matched) |
| `ROUTE_CRASH` | Emergency fallback after unhandled exception |
| `BRIDGE_CONTINUE_CRASH` | Emergency fallback after bridge continuation crash |

---

## Bridge Audio System

Bridge filler lines use pre-cached ElevenLabs MP3 files to maintain voice consistency:

| Component | Location |
|-----------|----------|
| Service | `services/bridgeAudio/BridgeAudioService.js` |
| Storage | `public/audio/bridge-lines/*.mp3` |
| URL pattern | `https://{host}/audio/bridge-lines/bridge_{companyId}_{hash}.mp3` |
| Pre-generation | Admin PATCH `agent2/:companyId` (async, non-blocking) |
| Explicit regen | `POST agent2/:companyId/regenerate-bridge-audio` |
| Boot warmup | `index.js` — 10s after server start, generates missing files |
| Fallback | If no cached MP3: `<Pause length="1">` (silence > wrong voice) |
| Cache key | SHA-256 of `(companyId + normalizedText + voiceFingerprint)` |

### Voice consistency rule

Bridge filler lines must NEVER use Twilio `<Say>`. Options:
1. **Cached ElevenLabs MP3 exists** → `<Play>` (same voice as agent)
2. **No cached MP3** → `<Pause>` (silence is better than a different voice)

---

## Debugging Checklist

When a transcript is missing turns:

1. **Check CallTranscriptV2 directly** — query by `companyId` + `callSid`
2. **Check turn count** — are there turns with `turnNumber: 0` (greeting)?
3. **Check for STT_EMPTY** — caller may not have spoken
4. **Check bridge path** — look for `sourceKey: 'AGENT2_BRIDGE'` system turns
5. **Check for crashes** — look for `sourceKey: 'ROUTE_CRASH'` or `'BRIDGE_CONTINUE_CRASH'`
6. **Check callSid consistency** — greeting and respond endpoints must use the same callSid
7. **Check Redis state** — `callState.turnCount` controls turnNumber; if Redis is down, turnNumber may be 0
8. **Check timing** — bridge continuation agent turns are logged asynchronously (background promise); if the call ends quickly, the write may not have completed before the report was exported
