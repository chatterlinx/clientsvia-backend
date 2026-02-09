# V111: Conversation Memory Architecture Specification

> **Status:** DRAFT - For Review  
> **Author:** AI Architecture Team  
> **Date:** 2026-02-08  
> **Version:** 0.1.0

---

## Executive Summary

This specification defines the **Conversation Memory** system - a unified truth object that governs all AI agent behavior during calls. It establishes two core principles:

1. **Config Truth (UI)** - What the agent is ALLOWED to do (governed by V110+ config)
2. **Runtime Truth (Call)** - What actually HAPPENED during a call

**The Golden Rule:** If it's not declared in the UI config, it cannot exist at runtime.

---

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [Config Truth Schema (V111)](#2-config-truth-schema-v111)
3. [Runtime Truth Schema (ConversationMemory)](#3-runtime-truth-schema-conversationmemory)
4. [TurnRecord Schema](#4-turnrecord-schema)
5. [Component Responsibilities](#5-component-responsibilities)
6. [Governance Rules](#6-governance-rules)
7. [Transcript Output Formats](#7-transcript-output-formats)
8. [Integration Points](#8-integration-points)
9. [Migration Path](#9-migration-path)
10. [Open Questions](#10-open-questions)

---

## 1. Design Principles

### 1.1 Single Source of Truth
- One `ConversationMemory` object per call
- All components read from and write to this object
- No hidden state, no scattered Redis keys, no in-memory variables

### 1.2 UI Governance
- All allowed behaviors must be declared in UI config
- Runtime cannot invent fields, handlers, or rules not in config
- Audit trail: every decision traceable to a config rule

### 1.3 Separation of Concerns
- **Extractors** write facts (slots, intent)
- **Router** writes decisions (which handler, why)
- **Handlers** write responses (text, actions)
- **LLM is read-only** - it can suggest, not commit

### 1.4 Deterministic Behavior
- Same input + same config = same routing decision
- No "rogue" behavior from hidden heuristics
- Clear "why" trace for every decision

---

## 2. Config Truth Schema (V111)

This is what lives in MongoDB under `aiAgentSettings.frontDeskBehavior` and is edited via the Discovery tab UI.

```javascript
{
  // ═══════════════════════════════════════════════════════════════════
  // V111: CONVERSATION MEMORY CONFIG
  // ═══════════════════════════════════════════════════════════════════
  "conversationMemory": {
    "version": "v111",
    "enabled": true,
    
    // ─────────────────────────────────────────────────────────────────
    // 2.1 MEMORY SCHEMA - What fields can exist
    // ─────────────────────────────────────────────────────────────────
    "schema": {
      "facts": {
        // Each fact field that can be captured
        "name": {
          "type": "string",
          "sources": ["self_identified", "extracted", "confirmed"],
          "confidenceThreshold": 0.7,
          "allowOverwrite": true
        },
        "phone": {
          "type": "phone",
          "sources": ["extracted", "confirmed"],
          "confidenceThreshold": 0.8,
          "allowOverwrite": false  // Once confirmed, locked
        },
        "address": {
          "type": "address",
          "sources": ["extracted", "confirmed"],
          "confidenceThreshold": 0.7,
          "allowOverwrite": true
        },
        "issue": {
          "type": "text",
          "sources": ["extracted", "scenario_match"],
          "confidenceThreshold": 0.6,
          "allowOverwrite": true
        },
        "urgency": {
          "type": "enum",
          "values": ["low", "normal", "high", "emergency"],
          "sources": ["extracted", "triage"],
          "default": "normal"
        },
        "intent": {
          "type": "enum",
          "values": ["inquiry", "booking", "complaint", "followup", "unknown"],
          "sources": ["extracted", "triage"],
          "default": "unknown"
        }
      }
    },
    
    // ─────────────────────────────────────────────────────────────────
    // 2.2 CAPTURE GOALS - What MUST/SHOULD/NICE be captured
    // ─────────────────────────────────────────────────────────────────
    "captureGoals": {
      "must": {
        // Required before booking can proceed
        "fields": ["name", "issue"],
        "deadline": "before_booking_confirmation",
        "onMissing": "router_prompts"  // Router injects capture prompt
      },
      "should": {
        // Strongly desired but not blocking
        "fields": ["phone", "address"],
        "deadline": "end_of_discovery",
        "onMissing": "log_warning"
      },
      "nice": {
        // Optional enrichment
        "fields": ["email", "preferred_time"],
        "deadline": "none",
        "onMissing": "ignore"
      }
    },
    
    // ─────────────────────────────────────────────────────────────────
    // 2.3 CONTEXT WINDOW POLICY - What LLM sees
    // ─────────────────────────────────────────────────────────────────
    "contextWindow": {
      "maxTurns": 6,                    // Last N turns sent to LLM
      "summarizeOlderTurns": true,      // Compress older turns into summary
      "alwaysIncludeFacts": true,       // Always include known facts
      "maxTokenBudget": 600,            // Token limit for context
      "includeRoutingTrace": false      // Include "why" in LLM context (debug only)
    },
    
    // ─────────────────────────────────────────────────────────────────
    // 2.4 HANDLER GOVERNANCE - Who can respond when
    // ─────────────────────────────────────────────────────────────────
    "handlerGovernance": {
      "scenarioHandler": {
        "enabled": true,
        "minConfidence": 0.75,          // Below this, don't use scenario
        "allowInBookingMode": false     // Scenarios blocked during booking
      },
      "bookingHandler": {
        "enabled": true,
        "requiresConsent": true,        // Must detect booking intent first
        "consentConfidence": 0.8,       // Confidence threshold for consent
        "lockAfterConsent": true        // No other handler can take over
      },
      "llmHandler": {
        "enabled": true,
        "isDefaultFallback": true,      // Used when nothing else matches
        "canWriteFacts": false,         // LLM cannot commit facts
        "canSuggestFacts": true         // LLM can suggest (extractor validates)
      },
      "escalationHandler": {
        "enabled": true,
        "triggers": ["explicit_request", "frustration_detected", "loop_detected"]
      }
    },
    
    // ─────────────────────────────────────────────────────────────────
    // 2.5 ROUTER RULES - Decision logic
    // ─────────────────────────────────────────────────────────────────
    "routerRules": {
      "priority": [
        // Order matters - first match wins
        "escalation",       // Safety first
        "booking_locked",   // If in booking mode, stay there
        "scenario_match",   // High-confidence scenario
        "llm_default"       // Fallback
      ],
      "captureInjection": {
        "enabled": true,
        "maxTurnsWithoutProgress": 2,   // If 2 turns with no MUST progress
        "injectPromptFor": "must"       // Inject prompt for MUST fields
      },
      "loopDetection": {
        "enabled": true,
        "maxRepeatedResponses": 2,      // Same response twice = loop
        "onLoop": "escalate"
      }
    },
    
    // ─────────────────────────────────────────────────────────────────
    // 2.6 TRANSCRIPT CONFIG - Output format
    // ─────────────────────────────────────────────────────────────────
    "transcript": {
      "generateOnCallEnd": true,
      "formats": {
        "customer": {
          // Clean version for CRM/booking
          "includeCallerLines": true,
          "includeAgentLines": true,
          "includeSlotSummary": true,
          "includeTimestamps": false,
          "includeDebugInfo": false
        },
        "engineering": {
          // Debug version for troubleshooting
          "includeCallerLines": true,
          "includeAgentLines": true,
          "includeSlotSummary": true,
          "includeTimestamps": true,
          "includeDebugInfo": true,
          "includeRoutingTrace": true,
          "includeSTTOps": true
        }
      }
    },
    
    // ─────────────────────────────────────────────────────────────────
    // 2.7 BLACKBOX CONFIG - What gets logged
    // ─────────────────────────────────────────────────────────────────
    "blackbox": {
      "logTurnRecords": true,           // One event per turn
      "logMilestones": true,            // BOOKING_CREATED, TRANSFER, etc.
      "logLegacyEvents": false,         // Disable old 50+ events per turn
      "verbosity": "standard"           // "minimal" | "standard" | "debug"
    }
  }
}
```

---

## 3. Runtime Truth Schema (ConversationMemory)

This is the live object that exists during a call, stored in Redis.

```javascript
{
  // ═══════════════════════════════════════════════════════════════════
  // CONVERSATION MEMORY - Runtime Truth
  // ═══════════════════════════════════════════════════════════════════
  
  // ─────────────────────────────────────────────────────────────────
  // 3.1 CALL IDENTITY
  // ─────────────────────────────────────────────────────────────────
  "callId": "CA_abc123def456",
  "companyId": "68e3f77a9d623b8058c700c4",
  "templateId": "68fb535130d19aec696d8123",
  "startTime": "2026-02-08T12:00:00.000Z",
  "callerPhone": "+15551234567",
  "companyPhone": "+15559876543",
  
  // ─────────────────────────────────────────────────────────────────
  // 3.2 FACTS - Accumulated knowledge (extractor-written ONLY)
  // ─────────────────────────────────────────────────────────────────
  "facts": {
    "name": {
      "value": "Mark",
      "confidence": 0.95,
      "source": "self_identified",
      "capturedTurn": 1,
      "capturedAt": "2026-02-08T12:00:05.000Z",
      "confirmed": false
    },
    "phone": {
      "value": "+15551234567",
      "confidence": 1.0,
      "source": "caller_id",
      "capturedTurn": 0,
      "capturedAt": "2026-02-08T12:00:00.000Z",
      "confirmed": false
    },
    "issue": {
      "value": "AC not working",
      "confidence": 0.88,
      "source": "extracted",
      "capturedTurn": 2,
      "capturedAt": "2026-02-08T12:00:15.000Z",
      "category": "cooling",
      "confirmed": false
    },
    "intent": {
      "value": "booking",
      "confidence": 0.92,
      "source": "triage",
      "capturedTurn": 3,
      "capturedAt": "2026-02-08T12:00:25.000Z"
    }
  },
  
  // ─────────────────────────────────────────────────────────────────
  // 3.3 PHASE STATE - Where are we in the call?
  // ─────────────────────────────────────────────────────────────────
  "phase": {
    "current": "BOOKING",          // GREETING | DISCOVERY | BOOKING | COMPLETE
    "previous": "DISCOVERY",
    "transitionedAt": "2026-02-08T12:00:25.000Z",
    "transitionReason": "booking_consent_detected"
  },
  
  // ─────────────────────────────────────────────────────────────────
  // 3.4 BOOKING STATE - If in booking mode
  // ─────────────────────────────────────────────────────────────────
  "booking": {
    "consentDetected": true,
    "consentTurn": 3,
    "modeLocked": true,
    "currentStep": "collect_phone",
    "completedSteps": ["confirm_name"],
    "remainingSteps": ["collect_phone", "collect_address", "confirm_time"]
  },
  
  // ─────────────────────────────────────────────────────────────────
  // 3.5 CAPTURE PROGRESS - Goal tracking
  // ─────────────────────────────────────────────────────────────────
  "captureProgress": {
    "must": {
      "name": { "captured": true, "turn": 1 },
      "issue": { "captured": true, "turn": 2 }
    },
    "should": {
      "phone": { "captured": true, "turn": 0, "source": "caller_id" },
      "address": { "captured": false, "turn": null }
    },
    "nice": {
      "email": { "captured": false, "turn": null },
      "preferred_time": { "captured": false, "turn": null }
    },
    "turnsWithoutProgress": 0
  },
  
  // ─────────────────────────────────────────────────────────────────
  // 3.6 TURNS - The conversation log
  // ─────────────────────────────────────────────────────────────────
  "turns": [
    // See TurnRecord schema (Section 4)
  ],
  
  // ─────────────────────────────────────────────────────────────────
  // 3.7 METRICS - Performance tracking
  // ─────────────────────────────────────────────────────────────────
  "metrics": {
    "totalTurns": 3,
    "avgResponseLatencyMs": 780,
    "llmCallCount": 2,
    "scenarioMatchCount": 1,
    "escalationTriggered": false
  },
  
  // ─────────────────────────────────────────────────────────────────
  // 3.8 OUTCOME - How did it end? (written at call end)
  // ─────────────────────────────────────────────────────────────────
  "outcome": null  // Populated at call end
}
```

---

## 4. TurnRecord Schema

Each turn in the conversation gets one TurnRecord.

```javascript
{
  // ═══════════════════════════════════════════════════════════════════
  // TURN RECORD - One per conversation turn
  // ═══════════════════════════════════════════════════════════════════
  
  "turn": 1,
  "timestamp": "2026-02-08T12:00:05.000Z",
  
  // ─────────────────────────────────────────────────────────────────
  // 4.1 CALLER INPUT
  // ─────────────────────────────────────────────────────────────────
  "caller": {
    "raw": "um hi my name is mark",
    "cleaned": "hi my name is mark",
    "confidence": 0.92,
    "sttOps": {
      "fillersRemoved": ["um"],
      "correctionsApplied": [],
      "synonymsApplied": []
    }
  },
  
  // ─────────────────────────────────────────────────────────────────
  // 4.2 EXTRACTION - What we learned
  // ─────────────────────────────────────────────────────────────────
  "extraction": {
    "slots": {
      "name_first": {
        "value": "Mark",
        "confidence": 0.95,
        "source": "self_identified"
      }
    },
    "intent": {
      "detected": "greeting",
      "confidence": 0.88
    },
    "entities": [
      { "type": "PERSON", "value": "Mark", "position": [5, 9] }
    ]
  },
  
  // ─────────────────────────────────────────────────────────────────
  // 4.3 TRIAGE - Scenario matching
  // ─────────────────────────────────────────────────────────────────
  "triage": {
    "scenarioCandidates": [
      { "id": "greeting_with_name", "score": 0.72, "category": "greetings" }
    ],
    "topScenario": null,  // Below confidence threshold
    "urgencyDetected": "normal",
    "triageSignals": []
  },
  
  // ─────────────────────────────────────────────────────────────────
  // 4.4 ROUTING - Decision made
  // ─────────────────────────────────────────────────────────────────
  "routing": {
    "selectedHandler": "LLM_DEFAULT",
    "why": [
      { "rule": "scenario_below_threshold", "score": 0.72, "required": 0.75 },
      { "rule": "not_in_booking_mode" },
      { "rule": "fallback_to_llm" }
    ],
    "rejected": [
      { "handler": "SCENARIO", "reason": "confidence_0.72_below_0.75" },
      { "handler": "BOOKING", "reason": "no_consent_detected" }
    ],
    "phase": "DISCOVERY",
    "captureInjected": false
  },
  
  // ─────────────────────────────────────────────────────────────────
  // 4.5 RESPONSE - What agent said
  // ─────────────────────────────────────────────────────────────────
  "response": {
    "handler": "LLM_DEFAULT",
    "text": "Hi Mark! How can I help you today?",
    "latencyMs": 850,
    "tokensUsed": 42,
    "actions": []  // e.g., "transfer", "create_booking"
  },
  
  // ─────────────────────────────────────────────────────────────────
  // 4.6 MEMORY DELTA - What changed
  // ─────────────────────────────────────────────────────────────────
  "delta": {
    "factsAdded": ["name"],
    "factsUpdated": [],
    "phaseChanged": false,
    "captureProgressUpdated": true
  },
  
  // ─────────────────────────────────────────────────────────────────
  // 4.7 MEMORY SNAPSHOT - State after this turn
  // ─────────────────────────────────────────────────────────────────
  "memorySnapshot": {
    "knownFacts": { "name": "Mark" },
    "phase": "DISCOVERY",
    "bookingMode": false,
    "captureProgress": {
      "must": { "name": true, "issue": false },
      "turnsWithoutProgress": 0
    }
  }
}
```

---

## 5. Component Responsibilities

### 5.1 Write Permissions Matrix

| Component | facts.* | phase | routing | response | turns |
|-----------|---------|-------|---------|----------|-------|
| STT Preprocessor | ❌ | ❌ | ❌ | ❌ | ✅ (caller.* only) |
| Slot Extractor | ✅ | ❌ | ❌ | ❌ | ✅ (extraction.*) |
| Triage/Scenario | ❌ | ❌ | ❌ | ❌ | ✅ (triage.*) |
| Router | ❌ | ✅ | ✅ | ❌ | ✅ (routing.*) |
| Booking Runner | ✅ (confirmed only) | ✅ | ❌ | ✅ | ✅ |
| LLM Handler | ❌ (suggest only) | ❌ | ❌ | ✅ | ✅ (response.*) |
| Escalation Handler | ❌ | ✅ | ❌ | ✅ | ✅ |

### 5.2 The Golden Rules

1. **Only Extractors write facts** - LLM can suggest, Router validates
2. **Only Router changes phase** - Based on explicit rules
3. **Handlers can only write their response** - No side effects
4. **Every write must be traceable** - Logged in TurnRecord

---

## 6. Governance Rules

### 6.1 Allowlist Enforcement

```javascript
// Before writing ANY fact
function commitFact(factId, value, source) {
  const config = getV111Config(companyId);
  
  // Rule 1: Field must be declared in schema
  if (!config.conversationMemory.schema.facts[factId]) {
    logger.warn('[GOVERNANCE] Rejected undeclared fact', { factId });
    return { success: false, reason: 'field_not_in_schema' };
  }
  
  // Rule 2: Source must be allowed
  const allowedSources = config.conversationMemory.schema.facts[factId].sources;
  if (!allowedSources.includes(source)) {
    logger.warn('[GOVERNANCE] Rejected invalid source', { factId, source });
    return { success: false, reason: 'source_not_allowed' };
  }
  
  // Rule 3: Check confidence threshold
  const threshold = config.conversationMemory.schema.facts[factId].confidenceThreshold;
  if (value.confidence < threshold) {
    logger.debug('[GOVERNANCE] Below confidence threshold', { factId, confidence: value.confidence });
    return { success: false, reason: 'below_confidence' };
  }
  
  // Commit
  memory.facts[factId] = value;
  return { success: true };
}
```

### 6.2 Handler Selection Rules

```javascript
function selectHandler(memory, config) {
  const rules = config.conversationMemory.routerRules;
  const governance = config.conversationMemory.handlerGovernance;
  
  // Priority order from config
  for (const handlerType of rules.priority) {
    switch (handlerType) {
      case 'escalation':
        if (shouldEscalate(memory, governance.escalationHandler)) {
          return { handler: 'ESCALATION', why: ['escalation_triggered'] };
        }
        break;
        
      case 'booking_locked':
        if (memory.booking?.modeLocked && governance.bookingHandler.lockAfterConsent) {
          return { handler: 'BOOKING', why: ['booking_mode_locked'] };
        }
        break;
        
      case 'scenario_match':
        const topScenario = getTopScenario(memory);
        if (topScenario && topScenario.score >= governance.scenarioHandler.minConfidence) {
          if (!memory.booking?.modeLocked || governance.scenarioHandler.allowInBookingMode) {
            return { handler: 'SCENARIO', why: ['scenario_confidence_met'], scenario: topScenario };
          }
        }
        break;
        
      case 'llm_default':
        if (governance.llmHandler.enabled) {
          return { handler: 'LLM', why: ['default_fallback'] };
        }
        break;
    }
  }
  
  // Should never reach here
  return { handler: 'ESCALATION', why: ['no_handler_matched'] };
}
```

---

## 7. Transcript Output Formats

### 7.1 Customer Transcript

```
═══════════════════════════════════════════════════════════════
CALL TRANSCRIPT
Company: ABC HVAC Services
Date: February 8, 2026 12:00 PM
Duration: 3 minutes 15 seconds
═══════════════════════════════════════════════════════════════

CALLER INFORMATION
  Name: Mark Johnson
  Phone: (555) 123-4567
  Address: 123 Main Street, Apt 4B

SERVICE REQUEST
  Issue: AC not working - cooling system
  Urgency: Normal

═══════════════════════════════════════════════════════════════
CONVERSATION
═══════════════════════════════════════════════════════════════

CALLER: Hi, my name is Mark
AGENT: Hi Mark! How can I help you today?

CALLER: My AC isn't working
AGENT: I'm sorry to hear that. Would you like to schedule a service visit?

CALLER: Yes please
AGENT: Great! Let me get some information...

[... remaining conversation ...]

═══════════════════════════════════════════════════════════════
BOOKING CONFIRMATION
═══════════════════════════════════════════════════════════════
Booking ID: BK_xyz789
Service: AC Repair
Scheduled: February 9, 2026 2:00 PM - 4:00 PM
Technician: Will be assigned

═══════════════════════════════════════════════════════════════
```

### 7.2 Engineering Transcript

```
═══════════════════════════════════════════════════════════════
ENGINEERING TRANSCRIPT (DEBUG)
Call ID: CA_abc123def456
═══════════════════════════════════════════════════════════════

[Turn 1 @ 12:00:05.000Z]
┌─ CALLER ─────────────────────────────────────────────────────
│ Raw: "um hi my name is mark"
│ Cleaned: "hi my name is mark"
│ STT: fillers=["um"], corrections=[], confidence=0.92
├─ EXTRACTION ─────────────────────────────────────────────────
│ Slots: name_first="Mark" (confidence=0.95, source=self_identified)
│ Intent: greeting (0.88)
├─ TRIAGE ─────────────────────────────────────────────────────
│ Top Scenario: greeting_with_name (0.72) - BELOW THRESHOLD
│ Urgency: normal
├─ ROUTING ────────────────────────────────────────────────────
│ Selected: LLM_DEFAULT
│ Why: [scenario_below_threshold(0.72<0.75), fallback_to_llm]
│ Rejected: SCENARIO(confidence), BOOKING(no_consent)
├─ RESPONSE ───────────────────────────────────────────────────
│ Handler: LLM_DEFAULT
│ Text: "Hi Mark! How can I help you today?"
│ Latency: 850ms, Tokens: 42
├─ DELTA ──────────────────────────────────────────────────────
│ Facts Added: [name]
│ Phase: DISCOVERY (unchanged)
│ Capture Progress: must.name=✓, must.issue=✗
└──────────────────────────────────────────────────────────────

[Turn 2 @ 12:00:15.000Z]
... (same format)

═══════════════════════════════════════════════════════════════
FINAL STATE
═══════════════════════════════════════════════════════════════
Facts: { name: "Mark Johnson", phone: "+15551234567", address: "123 Main St", issue: "AC not working" }
Phase: COMPLETE
Outcome: booking_created
Booking ID: BK_xyz789
Total Turns: 8
Avg Latency: 780ms
Escalations: 0
═══════════════════════════════════════════════════════════════
```

---

## 8. Integration Points

### 8.1 Where ConversationMemory Plugs In

```
v2twilio.js (entry point)
    │
    ├─► ConversationMemory.load(callId)     // Load or create
    │
    ├─► STTPreprocessor.process()
    │       └─► memory.addSTTResult()
    │
    ├─► SlotExtractor.extract()
    │       └─► memory.commitFact()          // Governed
    │
    ├─► Triage.analyze()
    │       └─► memory.addTriageResult()
    │
    ├─► Router.selectHandler()
    │       └─► memory.addRoutingDecision()  // Governed
    │
    ├─► Handler.respond()
    │       └─► memory.addResponse()
    │
    ├─► memory.commitTurn()                  // Finalize turn
    │
    ├─► ConversationMemory.save()            // Persist to Redis
    │
    └─► (on call end)
            ├─► memory.setOutcome()
            ├─► TranscriptGenerator.generate()
            └─► BlackBox.logFinalState()
```

### 8.2 Redis Key Structure

```
conversation-memory:{callId}     → Full ConversationMemory object (JSON)
conversation-memory:{callId}:ttl → 300 seconds (5 min after last activity)
```

### 8.3 MongoDB Persistence

At call end, the full ConversationMemory is written to:
- `callTranscripts` collection (new)
- `blackBoxEvents` collection (TurnRecords as events)

---

## 9. Migration Path

### Phase 0: Visibility Only (No Behavior Change)
- [ ] Create ConversationMemory service
- [ ] Instrument existing code to WRITE to memory (alongside current behavior)
- [ ] Add TurnRecord logging to BlackBox
- [ ] No routing changes, no prompt changes

### Phase 1: Discovery Tab Viewer
- [ ] Add "Conversation Memory" section to Discovery tab
- [ ] Display turn-by-turn table (read from BlackBox)
- [ ] Show facts timeline
- [ ] Show routing trace

### Phase 2: Config + Compare
- [ ] Add V111 config schema to UI
- [ ] Define MUST/SHOULD/NICE goals
- [ ] Compare actual calls against goals
- [ ] Highlight gaps in viewer

### Phase 3: Governance Enforced
- [ ] Router reads from V111 config
- [ ] Enforce handler selection rules
- [ ] Enforce capture injection
- [ ] Block unauthorized fact writes

### Phase 4: Transcripts
- [ ] Generate customer transcript at call end
- [ ] Generate engineering transcript
- [ ] Store in MongoDB
- [ ] Display in UI

---

## 10. Open Questions

1. **Redis vs MongoDB for runtime?**
   - Redis for speed during call
   - MongoDB for persistence after
   - Need TTL strategy for Redis cleanup

2. **How to handle mid-call crashes?**
   - Redis persistence vs memory loss
   - Recovery strategy

3. **Backwards compatibility?**
   - What happens to calls that started before V111?
   - Migration of existing blackbox data?

4. **Performance impact?**
   - Additional Redis reads/writes per turn
   - Need to benchmark

5. **UI complexity?**
   - V111 config is extensive - how to make it usable?
   - Progressive disclosure? Presets?

---

## Appendix A: Example V111 Config (Minimal)

For companies that want simple defaults:

```javascript
{
  "conversationMemory": {
    "version": "v111",
    "enabled": true,
    "useDefaults": true,  // Use platform defaults for everything
    "overrides": {
      // Only specify what differs from default
      "captureGoals": {
        "must": {
          "fields": ["name", "phone", "issue"]
        }
      }
    }
  }
}
```

---

## Appendix B: Glossary

| Term | Definition |
|------|------------|
| **Config Truth** | UI-governed configuration that defines allowed behaviors |
| **Runtime Truth** | Live state during a call (ConversationMemory object) |
| **Fact** | A piece of information about the caller/call (name, phone, issue) |
| **Turn** | One caller input + one agent response |
| **TurnRecord** | Complete log of everything that happened in one turn |
| **Handler** | Component that generates the agent's response (LLM, Scenario, Booking) |
| **Router** | Decision engine that selects which handler responds |
| **Governance** | Rules that restrict what components can do |
| **Capture Goal** | Target for information collection (MUST/SHOULD/NICE) |

---

*End of Specification*
