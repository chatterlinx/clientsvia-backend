# Consent Gate — Trigger Card Follow-up → 5-Bucket Classification

> **Last updated:** 2026-02-25
> **Status:** Production-ready

---

## What It Does

When a trigger card has a Follow-up Question with text, the engine enters a **consent gate** — it asks the question, waits for the caller's response, and classifies it into one of 5 buckets. Each bucket has configurable keywords, a response, and a direction.

```
Caller: "I need a maintenance tune-up"
Agent:  "Absolutely. I would love to schedule — Just to confirm,
         this is a routine tune-up, not an active problem, right?"

         [Waits for caller response]

Caller: "Yes"      → ✅ YES      → Booking Logic handoff
Caller: "No"       → ❌ NO       → "No problem. How can I help?"
Caller: "Huh?"     → 🔄 REPROMPT → Re-asks the question
Caller: "Maybe"    → 🤔 HESITANT → Gentle clarification + re-ask
Caller: "My AC..." → 💬 COMPLEX  → Back to normal agent
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

5 cards below the Trigger Cards list, each with:

| Card | Keywords | Response | Direction |
|------|----------|----------|-----------|
| **YES** | yes, yeah, sure, absolutely, go ahead... | "Great — let me get that scheduled." | Hand off to Booking Logic |
| **NO** | no, nope, not yet, maybe later... | "No problem. How can I help?" | Continue Conversation |
| **REPROMPT** | huh, what, sorry, come again... | (re-asks original question) | Re-ask |
| **HESITANT** | I don't know, maybe, I'm not sure... | "No worries — I just need to know..." | Gentle Clarification |
| **COMPLEX** | (catch-all, no keywords) | (none — agent handles naturally) | Back to Agent |

Keywords are configurable per company via tag input (comma-separated bulk add).

---

## 5-Bucket Classification

Priority: YES > NO > HESITANT > REPROMPT > COMPLEX

| Bucket | Matching Logic |
|--------|---------------|
| YES | Any configured YES phrase found, no NO phrase found |
| NO | Any configured NO phrase found, no YES phrase found |
| HESITANT | Any configured HESITANT phrase found |
| REPROMPT | Any configured REPROMPT phrase found, OR input ≤ 8 chars and not YES/NO/HESITANT |
| COMPLEX | None of the above matched (catch-all) |

Single-word phrases match on word boundaries. Multi-word phrases match as substrings.

---

## Direction Actions

| Direction | What Happens |
|-----------|-------------|
| `HANDOFF_BOOKING` | Sets `sessionMode = BOOKING`. BookingLogicEngine takes over next turn via AC1 handoff. |
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
```

### Turn N+1 — Caller responds YES
```
state.agent2.discovery.pendingFollowUpQuestion = null  (cleared)
state.agent2.discovery.lastPath = "FOLLOWUP_YES_HANDOFF_BOOKING"
state.sessionMode = "BOOKING"
state.consent = { pending: false, given: true, turn: N+1, source: "followup_consent_gate" }
```

### Turn N+1 — Caller responds HESITANT
```
state.agent2.discovery.pendingFollowUpQuestion = (kept active)
state.agent2.discovery.lastPath = "FOLLOWUP_HESITANT"
→ Gentle clarification spoken, question re-asked, waits again
```

---

## Files

| File | What |
|------|------|
| `services/engine/agent2/Agent2DiscoveryRunner.js` | 5-bucket handler (before pendingQuestion), trigger card routing to pendingFollowUpQuestion |
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
| `A2_FOLLOWUP_COMPLEX_FALLTHROUGH` | COMPLEX bucket, falling through to normal agent |
| `A2_RESPONSE_READY` | Response built for any bucket |
