# Consent Gate — Trigger Card Follow-up → 7-Bucket Classification

> **Last updated:** 2026-03-09
> **Status:** Production-ready

---

## What It Does

When a trigger card has a Follow-up Question with text, the engine enters a **consent gate** — it asks the question, waits for the caller's response, and classifies it into one of 7 buckets. Each bucket has configurable keywords, a response, and a direction.

```
Caller: "I need a maintenance tune-up"
Agent:  "Absolutely. I would love to schedule — Just to confirm,
         this is a routine tune-up, not an active problem, right?"

         [Waits for caller response]

Caller: "Maintenance"  → 🧰 MAINTENANCE  → Booking handoff (bookingMode=maintenance)
Caller: "Service call" → 🛠 SERVICE_CALL → Booking handoff (bookingMode=service_call)
Caller: "Yes"          → ✅ YES         → Booking Logic handoff
Caller: "No"           → ❌ NO          → "No problem. How can I help?"
Caller: "Huh?"         → 🔄 REPROMPT    → LLM Agent or re-ask (state preserved)
Caller: "Maybe"        → 🤔 HESITANT    → LLM Agent or clarification (state preserved)
Caller: "My AC..."     → 💬 COMPLEX     → LLM Agent handles contextually (state preserved)
```

---

## Architecture: Two Separate Systems

| System | Namespace | Used By |
|--------|-----------|---------|
| `pendingQuestion` | `state.agent2.discovery.pendingQuestion` | LLM follow-ups, discovery consent, generic Q&A |
| `pendingFollowUpQuestion` | `state.agent2.discovery.pendingFollowUpQuestion` | Trigger card follow-ups ONLY |

These are completely independent. Modifying one does not affect the other.

### Activation Rule

```
Trigger card has followUpQuestion text  →  pendingFollowUpQuestion system
Trigger card has NO followUpQuestion    →  nothing (normal flow)
Default afterAnswerQuestion (no card-specific text)  →  pendingQuestion system
```

The Follow-up Question text IS the toggle. No checkbox, no extra state.

---

## Configuration

### Trigger Card (per-trigger)

| Field | Purpose |
|-------|---------|
| **Answer Text** | What to say when the trigger matches |
| **Follow-up Question** | The confirmation question (activates consent gate) |

### Follow-up Consent Cards (company-level, triggers.html)

7 cards below the Trigger Cards list, each with:

| Card | Keywords | Response | Direction |
|------|----------|----------|-----------|
| **YES** | yes, yeah, sure, absolutely, go ahead... | "Great — let me get that scheduled." | Hand off to Booking Logic |
| **NO** | no, nope, not yet, maybe later... | "No problem. How can I help?" | Continue Conversation |
| **MAINTENANCE** | maintenance, tune-up, checkup... | "Perfect — I'll get a maintenance appointment scheduled." | Hand off to Booking Logic (bookingMode=maintenance) |
| **SERVICE_CALL** | service call, repair, diagnostic... | "Got it — I'll get you scheduled for a service call..." | Hand off to Booking Logic (bookingMode=service_call) |
| **REPROMPT** | huh, what, sorry, come again... | (re-asks original question) | Re-ask |
| **HESITANT** | I don't know, maybe, I'm not sure... | "No worries — I just need to know..." | Gentle Clarification |
| **COMPLEX** | (catch-all, no keywords) | (none — agent handles naturally) | LLM Agent with context |

Keywords are configurable per company via tag input (comma-separated bulk add).

---

## 7-Bucket Classification

Priority: SERVICE_CALL > MAINTENANCE > YES > NO > HESITANT > REPROMPT > COMPLEX

| Bucket | Matching Logic |
|--------|---------------|
| SERVICE_CALL | Any configured service call phrase found |
| MAINTENANCE | Any configured maintenance phrase found |
| YES | Any configured YES phrase found, no NO phrase found |
| NO | Any configured NO phrase found, no YES phrase found |
| HESITANT | Any configured HESITANT phrase found |
| REPROMPT | Any configured REPROMPT phrase found, OR input ≤ 8 chars and not YES/NO/HESITANT/service choice |
| COMPLEX | None of the above matched (catch-all) |

---

## Terminal vs Non-Terminal Buckets

Buckets are classified as **terminal** or **non-terminal** based on whether the caller's response resolves the follow-up question.

### Terminal (clears `pendingFollowUpQuestion` immediately)

| Bucket | Reason |
|--------|--------|
| **YES** | Caller confirmed — question answered |
| **NO** | Caller declined — question answered |
| **MAINTENANCE** | Caller chose a service type — question answered |
| **SERVICE_CALL** | Caller chose a service type — question answered |

### Non-Terminal (preserves `pendingFollowUpQuestion` for next turn)

| Bucket | Reason |
|--------|--------|
| **REPROMPT** | Ambiguous/short response — question still unresolved |
| **HESITANT** | Caller expressing doubt — question still unresolved |
| **COMPLEX** | Substantive non-yes/no response — question still unresolved |

Non-terminal buckets route to the LLM Agent (Tier 2) with full follow-up context, then **preserve** the pending follow-up state. This keeps the next turn in the protected consent gate lane:
- ScrabEngine bypass (raw STT → consent classifier)
- Bridge suppression (no filler audio while caller is responding)
- Lenient speechTimeout (2s fixed instead of 'auto', prevents premature cutoff)
- LLM receives follow-up context (original question + conversation thread)

### Continuation Cap

`MAX_FOLLOWUP_CONTINUATIONS = 3` — after 3 non-terminal T2 responses, the state is cleared and normal discovery resumes. This prevents infinite consent gate loops.

State field: `state.agent2.discovery.followUpContinuationCount` (initialized to 0 when PFUQ is set, incremented on each non-terminal T2 response, cleared by `clearPendingFollowUp`).

---

## Missing Config Behavior (UI-Only Enforcement)

If a required bucket response is blank (e.g., `followUpConsent.yes.response`):

- **Spoken text:** re-ask the follow-up question (UI-owned), or fall through to agent
- **Fallback action:** `REASK_FOLLOWUP` or `BACK_TO_AGENT` (global toggle)
- **Trace event:** `A2_FOLLOWUP_CONSENT_CONFIG_MISSING` with `missingFields` + `fallbackAction`

No runtime fallback phrases are allowed.

### Global Toggle

`followUpConsent.missingResponseAction` controls the fallback:

- `REASK_FOLLOWUP` → re-ask the trigger's follow-up question
- `BACK_TO_AGENT` → clear pending follow-up and resume discovery (ScrabEngine start)

Single-word phrases match on word boundaries. Multi-word phrases match as substrings.

---

## Direction Actions

| Direction | What Happens |
|-----------|-------------|
| `HANDOFF_BOOKING` | Sets `sessionMode = BOOKING`. BookingLogicEngine takes over next turn via AC1 handoff (passes `bookingMode` when configured). Response uses `discovery.holdMessage` (default: "Got it — one moment."). |
| `CONTINUE` | Clears pending state, continues in discovery mode. |
| `REASK` | Keeps `pendingFollowUpQuestion` active, re-asks the original question. |
| `CLARIFY` | Keeps `pendingFollowUpQuestion` active, gives gentle clarification + re-asks. |
| `AGENT` | Clears pending state, falls through to normal trigger matching / LLM. |
| `TRANSFER` | Transfers to human (future). |

---

## State Machine

### Turn N — Trigger fires
```
state.agent2.discovery.pendingFollowUpQuestion = "this is routine, right?"
state.agent2.discovery.pendingFollowUpQuestionTurn = N
state.agent2.discovery.pendingFollowUpQuestionSource = "card:maintenance_routine"
state.agent2.discovery.pendingFollowUpQuestionNextAction = "HANDOFF_BOOKING"
state.agent2.discovery.followUpContinuationCount = 0
```

### Turn N+1 — Caller responds YES (terminal)
```
state.agent2.discovery.pendingFollowUpQuestion = null  (cleared)
state.agent2.discovery.followUpContinuationCount = 0   (cleared)
state.agent2.discovery.lastPath = "FOLLOWUP_YES_HANDOFF_BOOKING"
state.sessionMode = "BOOKING"
state.consent = { pending: false, given: true, turn: N+1, source: "followup_consent_gate" }
```

### Turn N+1 — Caller chooses maintenance (terminal)
```
state.agent2.discovery.pendingFollowUpQuestion = null  (cleared)
state.agent2.discovery.followUpContinuationCount = 0   (cleared)
state.agent2.discovery.bookingMode = "maintenance"
state.agent2.discovery.lastPath = "FOLLOWUP_MAINTENANCE_HANDOFF_BOOKING"
state.sessionMode = "BOOKING"
state.consent = { pending: false, given: true, turn: N+1, source: "followup_consent_gate", bookingMode: "maintenance" }
```

### Turn N+1 — Caller responds COMPLEX (non-terminal, T2 LLM)
```
state.agent2.discovery.pendingFollowUpQuestion = (preserved)
state.agent2.discovery.pendingFollowUpQuestionTurn = N+1  (bumped)
state.agent2.discovery.followUpContinuationCount = 1
state.agent2.discovery.lastPath = "FOLLOWUP_LLM_AGENT_CONTINUED"
→ LLM Agent responds with follow-up context, state preserved for Turn N+2
```

### Turn N+2 — Caller continues (non-terminal, T2 LLM)
```
state.agent2.discovery.pendingFollowUpQuestion = (preserved)
state.agent2.discovery.pendingFollowUpQuestionTurn = N+2  (bumped)
state.agent2.discovery.followUpContinuationCount = 2
state.agent2.discovery.lastPath = "FOLLOWUP_LLM_AGENT_CONTINUED"
→ Still in protected lane, LLM handles with full context
```

### Turn N+1 — Caller responds HESITANT (non-terminal, T3 canned)
```
state.agent2.discovery.pendingFollowUpQuestion = (preserved — T3 does not clear)
state.agent2.discovery.lastPath = "FOLLOWUP_HESITANT"
→ Gentle clarification spoken, question re-asked, waits again
```

---

## Speech Timeout in Follow-Up Mode

When `pendingFollowUpQuestion` is active, the Gather uses `speechTimeout: '2'` (2 seconds fixed) instead of `'auto'`. This prevents Twilio's auto-detect from firing prematurely on mid-sentence pauses like "I tried to... [thinking]".

Applies to:
- Response gather (wraps the agent's response, captures next caller input)
- Ghost turn gather (re-opens listener after empty bridge timeout)

Does NOT apply to the listen endpoint (`/v2-agent-listen`) because bridge is suppressed during PFUQ turns.

---

## Handoff Payload Trace Fields

When consent handoff occurs (YES / MAINTENANCE / SERVICE_CALL), the booking payload includes:

```
discoveryContext.consent.bucket = "yes" | "maintenance" | "service_call"
discoveryContext.consent.matchedPhrases = ["..."]
```

This makes mode decisions auditable in Call Review.

---

## Files

| File | What |
|------|------|
| `services/engine/agent2/Agent2DiscoveryRunner.js` | 7-bucket handler (before pendingQuestion), trigger card routing to pendingFollowUpQuestion |
| `routes/v2twilio.js` | Bridge suppression, ghost turn guard, speechTimeout follow-up mode |
| `routes/admin/agent2.js` | Default followUpConsent config with keywords + directions |
| `public/agent-console/triggers.html` | Follow-up Consent Cards UI section |
| `public/agent-console/triggers.js` | Tag management, save/load consent cards |
| `models/CompanyLocalTrigger.js` | `followUpNextAction` field (already exists) |

---

## Transcript Events

| Event | When |
|-------|------|
| `A2_FOLLOWUP_CONSENT_CLASSIFIED` | Caller response classified into a bucket |
| `A2_CONSENT_GATE_BOOKING` | YES bucket triggered booking handoff |
| `A2_FOLLOWUP_COMPLEX_FALLTHROUGH` | COMPLEX bucket, LLM Agent unavailable, falling through to normal discovery |
| `PFUQ_STATE_CONTINUED` | Non-terminal T2 bucket — follow-up state preserved for next turn |
| `PFUQ_CONTINUATION_EXHAUSTED` | Non-terminal T2 hit max continuations — state cleared |
| `PFUQ_GHOST_TURN_SKIPPED` | Empty input during PFUQ — turn bumped, state preserved |
| `A2_RESPONSE_READY` | Response built for any bucket |
