# Consent Gate — Trigger Card YES/NO → Booking Handoff

> **Last updated:** 2026-02-25
> **Status:** Production-ready

---

## What It Does

A consent gate is a trigger card that asks a confirmation question and waits for the caller's response before deciding what to do next.

```
Caller: "I need a maintenance tune-up"
Agent:  "Absolutely. I would love to schedule your next maintenance,
         Just to confirm — this is a routine tune-up, not an active
         problem like no cooling, a leak, or a strange noise, right?"
         ↓
         [Waits for caller response]
         ↓
Caller: "Yes"  →  Booking Logic takes over (AC1 handoff)
Caller: "Well actually my AC isn't cooling"  →  Back to normal agent
Caller: (unclear)  →  Re-asks the question
```

---

## How to Configure

### Trigger Card Setup

| Field | Value |
|-------|-------|
| **Keywords** | `maintenance, tune-up, tune up, routine` |
| **Answer Text** | `Absolutely. I would love to schedule your next maintenance, Just to confirm —` |
| **Follow-up Question** | `this is a routine tune-up, not an active problem like no cooling, a leak, or a strange noise, right?` |
| **On Caller Confirmation (Yes)** | `Hand off to Booking Logic` |

The Answer Text and Follow-up Question are spoken together in one turn:
> "Ok. Absolutely. I would love to schedule your next maintenance, Just to confirm — this is a routine tune-up, not an active problem like no cooling, a leak, or a strange noise, right?"

The Follow-up Question becomes the `pendingQuestion`. The engine waits for the caller's next response.

---

## Caller Response Classification

| Classification | Examples | Result |
|---|---|---|
| **YES** | "yes", "yeah", "sure", "that's right", "absolutely", "go ahead" | Executes the configured action (e.g., Booking handoff) |
| **NO** | "no", "nope", "not yet", "maybe later" | Acknowledges and continues conversation |
| **REPROMPT** | Mumble, "huh", unclear | Re-asks the confirmation question |
| **COMPLEX** | "Well actually my AC isn't cooling" | Clears the question, routes through normal discovery |

---

## Booking Handoff Flow

When the trigger has `On Confirmation = Hand off to Booking Logic`:

1. **Turn N**: Trigger matches → Agent speaks answer + follow-up question
2. **Turn N+1**: Caller says "yes" → YES classified → `sessionMode = BOOKING`
3. **Turn N+1 response**: "Great — let me get that scheduled for you."
4. **Turn N+2**: BookingLogicEngine takes over, checks AC1 handoff payload:
   - Has firstName? Skip. Missing? Ask.
   - Has lastName? Skip. Missing? Ask.
   - Has address? Skip. Missing? Ask.
   - Checks Google Calendar availability
   - Confirms booking

---

## Transcript Logging

Every step is logged to CallTranscriptV2:

| Turn | Speaker | Kind | What's Logged |
|------|---------|------|---------------|
| N | agent | CONVERSATION_AGENT | Answer text + follow-up question |
| N | system | TWIML_PLAY | Spoken text (ElevenLabs audio) |
| N+1 | caller | CONVERSATION_CALLER | Caller's "yes" / "no" / response |
| N+1 | agent | CONVERSATION_AGENT | YES response ("Great — let me get that scheduled") |
| N+1 | system | CONSENT_GATE_BOOKING | Diagnostic: "Consent gate: caller confirmed YES → handing off to Booking Logic" |
| N+1 | system | TWIML_PLAY | Spoken text |
| N+2+ | agent | CONVERSATION_AGENT | Booking Logic prompts (name, address, date, etc.) |

---

## State Machine

```
state.agent2.discovery.pendingQuestion     = "...confirm question text..."
state.agent2.discovery.pendingQuestionTurn = N
state.agent2.discovery.pendingQuestionSource = "card:{cardId}"
state.agent2.discovery.lastNextAction      = "HANDOFF_BOOKING"

→ Caller responds YES on turn N+1:

state.agent2.discovery.pendingQuestion     = null  (cleared)
state.agent2.discovery.pendingQuestionResolved = true
state.agent2.discovery.lastPath            = "PENDING_YES_HANDOFF_BOOKING"
state.sessionMode                          = "BOOKING"
state.consent                              = { pending: false, given: true, turn: N+1, source: "consent_gate" }
```

---

## Files Modified

| File | What Changed |
|------|-------------|
| `services/engine/agent2/Agent2DiscoveryRunner.js` | YES path checks `lastNextAction`; if `HANDOFF_BOOKING`, sets `sessionMode = BOOKING` |
| `routes/v2twilio.js` | Logs `CONSENT_GATE_BOOKING` diagnostic turn to transcript |
| `public/agent-console/triggers.html` | Added "On Caller Confirmation (Yes)" dropdown in Follow-up section |
| `public/agent-console/triggers.js` | Saves/loads `followUpNextAction`, toggles dropdown visibility |
| `models/CompanyLocalTrigger.js` | `followUpNextAction` field already exists in schema |

---

## Available Follow-up Actions

| Value | Behavior |
|-------|----------|
| `CONTINUE` | Default. YES gives generic acknowledgment, stays in discovery. |
| `HANDOFF_BOOKING` | YES triggers AC1 handoff to Booking Logic. Next turn = BookingLogicEngine. |
