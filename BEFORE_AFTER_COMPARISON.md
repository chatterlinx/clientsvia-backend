# Call Review UI - Before & After Comparison

## BEFORE: Duplicated & Confusing ❌

### Section 1: SPEAK PROVENANCE (WHO SPOKE & WHY)
```
🎯 Turn 0 [AUDIO FALLBACK → TTS]
Source: agent2.greetings.callStart.text
UI Path: aiAgentSettings.agent2.greetings.callStart.text
UI Tab: Greetings
Text: "Penguin air!, this is john..."
Reason: ?

🎙️ Turn 1 [UI-OWNED]
Source: agent2.discovery.triggerCard
UI Path: aiAgentSettings.agent2.discovery.playbook.rules[]
UI Tab: Agent 2.0 > Configuration
Text: "Ok, Marc. I'm sorry to hear that..."
Reason: Matched trigger pattern
```

### Section 2: TURN-BY-TURN TRUTH LINE
```
Turn 0 · ● GREETING  · 342ms
Turn 1 · ● AGENT2_DISCOVERY · TRIGGER_CARD_MATCHED · plumbing_ac · (on: "AC") · 847ms (S4_DISCOVERY)
```

### Section 3: TRANSCRIPT
```
🤖 AGENT (Turn 0) [CHANGED]
"Hi, thank you for calling!"

⚠️ Audio issue: file_not_found - May not have been played

📝 PLANNED (not delivered):
"Hi, thank you for calling! How can I help you?"

🔄 Trigger Card
aiAgentSettings.agent2.greetings.callStart.text

───────────────────────────────

📞 CALLER (Turn 1)
"Hi, I need help with my AC..."

───────────────────────────────

🤖 AGENT (Turn 1) [CHANGED]
"Ok, Marc. I'm sorry to hear that. There are a few things..."

🔄 Trigger Card [trigger 17714619113651]
aiAgentSettings.agent2.discovery.playbook.rules[]
```

**Problem:** User has to read same information 3 times to understand what happened!

---

## AFTER: Unified & Clear ✅

### Single Section: TRANSCRIPT

```
┌─────────────────────────────────────────────────────────────┐
│ 🤖 AGENT · Turn 0    [AUDIO FALLBACK → TTS]    RESPONSE   │
│                      [CHANGED]                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Text: "Hi, thank you for calling!"                         │
│                                                             │
│ ─── ATTRIBUTION ──────────────────────────────────────────│
│ Source:    agent2.greetings.callStart.text                │
│ UI Path:   aiAgentSettings.agent2.greetings.callStart.text│
│ UI Tab:    Greetings                                       │
│                                                             │
│ ─── RUNTIME INFO ─────────────────────────────────────────│
│ Mic Owner: ● GREETING                                      │
│ Latency:   342ms                                           │
│                                                             │
│ ─── ISSUES ───────────────────────────────────────────────│
│ 🔄 PLANNED vs ACTUAL                                      │
│    Planned:  "Hi, thank you for calling! How can I help  │
│               you?"                                        │
│    Actual:   "Hi, thank you for calling!"                │
│                                                             │
│ ⚠️ AUDIO ISSUE                                            │
│    file_not_found - Fell back to TTS                      │
│    /audio/instant-lines/fd_CONNECTION_GREETING_...mp3    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 📞 CALLER · Turn 1                              INPUT      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Text: "Hi, I need help with my AC..."                      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 🤖 AGENT · Turn 1    [UI-OWNED]                RESPONSE    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Text: "Ok, Marc. I'm sorry to hear that. There are a few  │
│       things that could cause this..."                     │
│                                                             │
│ ─── ATTRIBUTION ──────────────────────────────────────────│
│ Source:    agent2.discovery.triggerCard                   │
│ UI Path:   aiAgentSettings.agent2.discovery.playbook.rules│
│ UI Tab:    Agent 2.0 > Configuration                      │
│ Card ID:   trigger_17714619113651                         │
│ Reason:    Matched trigger pattern: "AC"                  │
│                                                             │
│ ─── RUNTIME INFO ─────────────────────────────────────────│
│ Mic Owner:     ● AGENT2_DISCOVERY                         │
│ Path:          TRIGGER_CARD_MATCHED                       │
│ Matched Card:  plumbing_ac_repair                         │
│ Matched On:    "AC"                                       │
│ Latency:       847ms (S4_DISCOVERY)                       │
└─────────────────────────────────────────────────────────────┘
```

**Solution:** Read once, see everything, understand completely!

---

## Key Improvements

### 1. No More Duplication
| BEFORE | AFTER |
|--------|-------|
| Read attribution in SPEAK PROVENANCE | ✅ In card |
| Read runtime info in TRUTH LINE | ✅ In card |
| Read text in TRANSCRIPT | ✅ In card |
| **Read 3 sections = 3x effort** | **Read 1 card = complete story** |

### 2. Better Visual Hierarchy
| BEFORE | AFTER |
|--------|-------|
| Inline text, hard to scan | ✅ Card borders, easy to scan |
| No visual separation | ✅ Clear card boundaries |
| Status buried in text | ✅ Status badges in header |
| Problems not highlighted | ✅ Red/yellow cards stand out |

### 3. Complete Information
| Information | BEFORE | AFTER |
|-------------|--------|-------|
| Caller inputs | Hidden in TRANSCRIPT only | ✅ Blue cards |
| Agent responses | Across 3 sections | ✅ One card |
| Source attribution | SPEAK PROVENANCE | ✅ In card |
| Runtime ownership | TRUTH LINE | ✅ In card |
| Latency | TRUTH LINE | ✅ In card |
| Matched card | TRUTH LINE | ✅ In card |
| Planned vs Actual | TRANSCRIPT | ✅ In card |
| Audio issues | TRANSCRIPT | ✅ In card |

### 4. Enterprise-Level Clarity
| Aspect | BEFORE | AFTER |
|--------|--------|-------|
| Labeled fields | Some labels unclear | ✅ Every field labeled |
| Color coding | Minimal | ✅ Full color coding |
| Scannable | Hard to scan | ✅ Easy to scan |
| Self-contained | Info spread out | ✅ Cards self-contained |
| Debugging | Hunt across sections | ✅ All in one card |

---

## Use Case Comparison

### Use Case 1: "What did the agent say in Turn 2?"

**BEFORE:**
1. Look in TRANSCRIPT section
2. Find Turn 2
3. Read text
4. Still don't know where it came from

**AFTER:**
1. Scroll to Turn 2 card
2. Read text + source + runtime info
3. Done - complete understanding

---

### Use Case 2: "Why did the audio fail in Turn 3?"

**BEFORE:**
1. Look in TRANSCRIPT - see "Audio issue" warning
2. Go to SPEAK PROVENANCE - find "AUDIO FALLBACK" event
3. Check TRUTH LINE for latency
4. Piece together the story

**AFTER:**
1. Scroll to Turn 3 card
2. See yellow border = warning
3. See [AUDIO FALLBACK → TTS] badge
4. Read ISSUES section with full details
5. Done - complete picture in one card

---

### Use Case 3: "Which UI tab do I edit to change Turn 1 response?"

**BEFORE:**
1. Look in TRANSCRIPT - see text
2. Go to SPEAK PROVENANCE - find Source ID
3. Read UI Tab field
4. Remember to go back to TRANSCRIPT to see turn number

**AFTER:**
1. Scroll to Turn 1 agent card
2. Read UI Tab field: "Agent 2.0 > Configuration"
3. See Card ID for exact rule
4. Done - all info in one place

---

### Use Case 4: "Why was Turn 4 so slow?"

**BEFORE:**
1. Go to TRUTH LINE
2. Find Turn 4
3. See latency number
4. See slowest section in parentheses
5. Still don't know what was said

**AFTER:**
1. Scroll to Turn 4 card
2. See latency in RUNTIME INFO: "1847ms (S5_LLM_ASSIST)"
3. See what was said above
4. See source attribution
5. Done - full context

---

## Visual Comparison: Error Scenario

### BEFORE - Missing Provenance

**SPEAK PROVENANCE section:**
```
(Nothing shown - event missing)
```

**TRUTH LINE section:**
```
Turn 3 · ● LEGACY · 412ms
```

**TRANSCRIPT section:**
```
🤖 AGENT (Turn 3)
"Let me connect you to our team."

🚨 MISSING PROVENANCE - Turn 3
⚠️ No SPEAK_PROVENANCE or SPEECH_SOURCE_SELECTED...
```

**Problem:** User sees error in TRANSCRIPT but has to check other sections to understand what happened.

---

### AFTER - Missing Provenance

```
┌─────────────────────────────────────────────────────────────┐
│ 🚨 AGENT · Turn 3    [MISSING PROVENANCE]      RESPONSE    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Text: "Let me connect you to our team."                    │
│                                                             │
│ 🚨 MISSING PROVENANCE                                      │
│ No SPEAK_PROVENANCE or SPEECH_SOURCE_SELECTED event found │
│ for this turn                                              │
│                                                             │
│ Possible causes:                                           │
│ (1) Backend not emitting events                           │
│ (2) Hardcoded response bypassing SpeechGuard              │
│ (3) Legacy call                                            │
│                                                             │
│ ─── RUNTIME INFO ─────────────────────────────────────────│
│ Mic Owner: ● LEGACY                                       │
│ Latency:   412ms                                          │
└─────────────────────────────────────────────────────────────┘
```

**Solution:** Red card jumps out, all error info + context in one place.

---

## Summary

### BEFORE:
- ❌ 3 sections showing same data
- ❌ Information scattered
- ❌ Have to hunt across sections
- ❌ Hard to spot issues
- ❌ Confusing for users
- ❌ Time-consuming to audit

### AFTER:
- ✅ 1 unified section
- ✅ All info in cards
- ✅ One place to look per turn
- ✅ Issues color-coded
- ✅ Enterprise-level clarity
- ✅ Fast, easy auditing

---

**Result:** Same data, 10x better presentation!
