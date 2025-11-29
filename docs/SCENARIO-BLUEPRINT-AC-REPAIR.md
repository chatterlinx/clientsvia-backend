# 3-TIER SCENARIO BLUEPRINT: AC_REPAIR

> **Purpose:** This is a template for what a "human-level understanding" scenario looks like.
> **Use this as the blueprint** when building scenarios for other lanes.

---

## 1. Scenario Metadata

```yaml
scenarioKey: AC_REPAIR_NOT_COOLING
categoryKey: HVAC_REPAIR
trade: HVAC
serviceType: REPAIR
priority: 100

goal: "Confirm AC is not working, gather necessary details, book a diagnostic/repair visit"
successCriteria: "Appointment booked with address, contact, and problem summary"
```

---

## 2. Required Slots (What a Human CSR Always Asks)

| Slot | Required | Type | Prompt | Validation |
|------|----------|------|--------|------------|
| `problem_description` | ✅ | TEXT | "Can you tell me what's going on with your AC?" | At least 3 words |
| `system_type` | ⚪ Optional | ENUM | "Is this a central AC, window unit, or mini split?" | central/window/mini-split/unknown |
| `system_age` | ⚪ Optional | TEXT | "Do you know roughly how old the system is?" | Accept "not sure" |
| `address` | ✅ | ADDRESS | "What's the service address?" | Must have street + city |
| `contact_name` | ✅ | TEXT | "And who should we have the tech ask for?" | Non-empty |
| `contact_phone` | ✅ | PHONE | "Best number to reach you?" | Valid phone format |
| `availability` | ✅ | DATETIME | "When works best for you? We have [slots]." | Within business hours |
| `urgency` | ⚪ Auto-detected | ENUM | (Inferred from keywords) | normal/high/emergency |

---

## 3. Conversation Flow (Slot-Filling Logic)

### 3.1 Opening (After Triage Routes Here)

```text
IF caller already described problem in triage input:
  → "Okay, sounds like your AC isn't cooling. Let me get some info to send a tech out."
  → SKIP problem_description slot

ELSE:
  → "I can help with that. Can you tell me a bit more about what's happening with your AC?"
  → WAIT for problem_description
```

### 3.2 Progressive Slot Collection

**Order matters.** Human CSRs follow this flow:

```text
1. PROBLEM → Understand what's wrong
2. URGENCY → Detect if emergency (smoke, burning, flood)
3. ADDRESS → Where is the service location?
4. CONTACT → Who should the tech call/ask for?
5. AVAILABILITY → When can we come?
6. CONFIRM → Recap and confirm
```

### 3.3 Slot Prompts (Human-Like)

```javascript
const SLOT_PROMPTS = {
  problem_description: [
    "Can you tell me what's going on with your AC?",
    "What seems to be the issue?",
    "What's happening with your air conditioning?"
  ],
  
  address: [
    "What's the address where we'll be working?",
    "Where should we send the technician?",
    "And the service address?"
  ],
  
  contact_name: [
    "Who should we have the tech ask for when they arrive?",
    "And the name on the account or who will be there?",
    "Who should we call when the tech is on the way?"
  ],
  
  contact_phone: [
    "Best phone number to reach you?",
    "What's a good callback number?",
    "And your phone number?"
  ],
  
  availability: [
    "When works best for you? We have [morning/afternoon] available.",
    "What day and time works for your schedule?",
    "I have a few openings — when's good for you?"
  ]
};
```

### 3.4 What To Do When Slot is Already Filled

```text
IF caller already gave address in previous turn:
  → DO NOT ask again
  → Move to next unfilled slot

IF caller gave multiple pieces of info at once:
  "Thanks for that. Just to confirm — [recap what we got]. Now I just need [next slot]."
```

---

## 4. Handling Ambiguity / Confused Flows

### 4.1 Unclear Problem

```text
CALLER: "It's just not right, you know?"

AGENT:
  → "I understand. Just to help me get the right tech out there —
     is it not cooling at all, making a noise, or something else?"
  
OPTIONS: [not cooling, making noise, water leak, won't turn on, other]
```

### 4.2 Caller Goes Off-Topic

```text
CALLER: "Also, do you guys do duct cleaning?"

AGENT:
  → "Yes, we do offer duct cleaning! I can get you info on that after we get this repair scheduled.
     Now, about the address for the AC service..."
  
RULE: Acknowledge → Defer → Return to slot
```

### 4.3 Caller Provides Partial Info

```text
CALLER: "I'm at 123 Main Street."

AGENT:
  → "Got it, 123 Main Street. And what city is that in?"
  
RULE: Accept partial → Ask for missing piece → Don't restart
```

### 4.4 Caller Seems Unsure Which Service They Need

```text
CALLER: "I don't know if it needs repair or just a tune-up."

AGENT:
  → "No problem. Is your AC running right now, or is it completely not working?"
  
  IF running but not well → "Since it's still running, a tune-up might be a good start. Or if you'd rather, we can send someone to diagnose it."
  IF completely dead → "Sounds like we should treat this as a repair visit. Let me get you on the schedule."
```

---

## 5. Tier-3 LLM Boundaries

### 5.1 What LLM IS Allowed To Do

| Allowed | Example |
|---------|---------|
| Paraphrase a canned reply | "Got it, sounds frustrating" instead of "I understand" |
| Smooth transitions | "Great, now I just need..." instead of "Next question:" |
| Handle minor off-script | "Oh yeah, Florida heat is no joke. Let's get this fixed." |
| Confirm understanding | "So if I'm hearing you right, the AC runs but doesn't cool — is that right?" |

### 5.2 What LLM is NOT Allowed To Do

| NOT Allowed | Why |
|-------------|-----|
| Diagnose the problem | "Sounds like low refrigerant" — NO. Let the tech decide. |
| Quote prices | "That'll probably be around $150" — NO. Never quote without authorization. |
| Promise timing | "We'll have someone there within the hour" — NO. Only offer confirmed slots. |
| Skip required slots | "I'll just send someone over" — NO. Address + contact are required. |
| Override booking rules | "Sure, 11pm works" — NO. Must respect business hours. |

### 5.3 LLM Guardrail Prompts

Include these in Tier-3 system prompt:

```text
You are assisting with an HVAC repair call. Your role:
- Keep the conversation natural and friendly.
- DO NOT diagnose technical problems.
- DO NOT quote prices or promise timing.
- DO NOT skip collecting: address, contact name, contact phone, availability.
- If the caller asks something you can't answer, say:
  "That's a great question — the technician can go over that with you when they arrive."
```

---

## 6. Confirmation & Recap

### 6.1 Before Booking

```text
AGENT:
  "Okay, let me just confirm everything:
   - We're coming to [ADDRESS]
   - The problem is [PROBLEM SUMMARY]
   - We'll call [CONTACT_NAME] at [CONTACT_PHONE] when the tech is on the way
   - Appointment is [DATE/TIME]
   
   Does that all sound right?"

CALLER: "Yes" / "Actually, change the phone number..."
```

### 6.2 After Confirmation

```text
AGENT:
  "Perfect. You're all set. A technician will be out on [DATE] between [TIME WINDOW].
   If anything changes, just give us a call back at this number.
   Is there anything else I can help you with?"
```

---

## 7. Edge Cases

### 7.1 Caller Gets Frustrated

```text
CALLER: "Why do you need all this info? Just send someone!"

AGENT:
  "I totally get it — you want this fixed. I just need a couple more things so the tech knows where to go and can reach you if needed. What's the best number?"
  
RULE: Acknowledge frustration → Explain why → Stay on track
```

### 7.2 Caller Describes Emergency

```text
IF caller mentions: "smoke", "burning", "fire", "sparks", "flooding"

AGENT:
  → "That sounds urgent. Let me transfer you to our emergency line right away."
  → ACTION: ESCALATE_TO_HUMAN
  → DO NOT continue booking
```

### 7.3 Caller Wants to Cancel/Reschedule

```text
IF caller says: "Actually I need to cancel" or "Can I change the time?"

AGENT:
  → "No problem. Let me pull up your appointment..."
  → SWITCH to RESCHEDULE_FLOW or CANCEL_FLOW
```

---

## 8. Success Metrics

| Metric | Target |
|--------|--------|
| Slot completion rate | 95%+ of calls collect all required slots |
| Booking conversion | 80%+ of repair calls result in booked appointment |
| Escalation rate | <5% (only true emergencies/complex issues) |
| Repeat question rate | <2% (should never ask same slot twice) |
| Customer satisfaction | "Agent understood my problem" score >4.5/5 |

---

## 9. Implementation Checklist

- [ ] Create scenario in 3-Tier with key `AC_REPAIR_NOT_COOLING`
- [ ] Add all slot definitions with prompts
- [ ] Add flow logic for progressive slot collection
- [ ] Add confused/clarify handlers
- [ ] Add LLM guardrail prompt
- [ ] Add confirmation template
- [ ] Add edge case handlers
- [ ] Test with 20+ utterances from stress test pack
- [ ] Verify no repeated questions in multi-turn calls

---

*This is the blueprint. Replicate this structure for AC_MAINTENANCE, NEW_SYSTEM, EMERGENCY, BILLING, and CONFUSED_CUSTOMER.*

