# 🔒 ARCHITECTURE CONTRACTS V2.0 - LOCKED SPECIFICATION

**Date**: November 25, 2025  
**Status**: LOCKED - Do not drift from these specs  
**Purpose**: Define exact data contracts between all system components

---

## 🎯 SYSTEM OVERVIEW

```
CALLER UTTERANCE
      ↓
[1] FRONTLINE-INTEL (Cheap Classifier)
      ↓
[2] LLM-0 ORCHESTRATOR (Master Brain)
      ↓
   ┌──┴──┐
   │     │
[3a] 3-TIER KB     [3b] BOOKING HANDLER
   │     │
   └──┬──┘
      ↓
[4] RESPONSE TO CALLER
```

**Flow Control**: LLM-0 is the ONLY decision maker  
**Knowledge Source**: 3-Tier provides facts + hints  
**Booking Execution**: BookingHandler performs deterministic ops  

---

## 📋 CONTRACT 1: FRONTLINE-INTEL OUTPUT

**File**: `src/services/frontlineIntelService.js`  
**Function**: `classifyFrontlineIntent()`

### Input
```typescript
{
  text: string,           // Caller's utterance
  config: CompanyConfig,  // Company runtime config
  context: CallContext    // Current call state
}
```

### Output (EXACT SPEC)
```typescript
interface FrontlineIntelResult {
  // Primary classification
  intent: 'booking' | 'troubleshooting' | 'info' | 'billing' | 
          'emergency' | 'update_appointment' | 'wrong_number' | 
          'spam' | 'other';
  
  // Confidence score
  confidence: number;  // 0.0 - 1.0
  
  // Boolean signals (used by LLM-0)
  signals: {
    urgent: boolean;                  // Detected urgency keywords
    bookingIntent: 'high' | 'low' | 'none';  // Booking likelihood
    hasQuestions: boolean;            // Contains question words
    maybeWrongNumber: boolean;        // Wrong number detection
    maybeSpam: boolean;               // Spam detection
    mentionsCompetitor: boolean;      // Competitor name detected
    mentionsPricing: boolean;         // Asking about costs
    mentionsEmergency: boolean;       // Emergency keywords
  };
  
  // Detected entities (optional)
  entities: {
    phoneNumbers: string[];           // Extracted phone numbers
    addresses: string[];              // Extracted addresses
    dates: string[];                  // Extracted dates/times
    names: string[];                  // Extracted names
  };
  
  // Processing metadata
  metadata: {
    matchedRules: string[];           // Which rules fired
    processingTimeMs: number;         // How long it took
    fillerWordsRemoved: string[];     // What was filtered out
  };
}
```

### Examples

**Example 1: Booking Intent**
```json
{
  "intent": "booking",
  "confidence": 0.87,
  "signals": {
    "urgent": false,
    "bookingIntent": "high",
    "hasQuestions": false,
    "maybeWrongNumber": false,
    "maybeSpam": false,
    "mentionsCompetitor": false,
    "mentionsPricing": false,
    "mentionsEmergency": false
  },
  "entities": {
    "phoneNumbers": [],
    "addresses": ["123 Main St"],
    "dates": ["tomorrow"],
    "names": ["John"]
  },
  "metadata": {
    "matchedRules": ["booking_keywords", "address_detected"],
    "processingTimeMs": 3,
    "fillerWordsRemoved": ["um", "like"]
  }
}
```

**Example 2: Emergency**
```json
{
  "intent": "emergency",
  "confidence": 0.95,
  "signals": {
    "urgent": true,
    "bookingIntent": "high",
    "hasQuestions": false,
    "maybeWrongNumber": false,
    "maybeSpam": false,
    "mentionsCompetitor": false,
    "mentionsPricing": false,
    "mentionsEmergency": true
  },
  "entities": {
    "phoneNumbers": [],
    "addresses": [],
    "dates": ["now", "asap"],
    "names": []
  },
  "metadata": {
    "matchedRules": ["emergency_keywords", "urgent_tone"],
    "processingTimeMs": 2,
    "fillerWordsRemoved": []
  }
}
```

---

## 📋 CONTRACT 2: LLM-0 ORCHESTRATOR DECISION

**File**: `src/services/orchestrationEngine.js`  
**Function**: `processCallerTurn()`

### Input
```typescript
{
  companyId: string,
  callId: string,
  speaker: 'caller' | 'agent',
  text: string,
  rawSttMetadata: object  // Optional STT metadata
}
```

### Output (EXACT SPEC)
```typescript
interface OrchestratorDecision {
  // Primary action to take
  action: 'ask_question' | 'confirm_info' | 'answer_with_knowledge' | 
          'initiate_booking' | 'update_booking' | 'escalate_to_human' | 
          'small_talk' | 'close_call' | 'clarify_intent' | 'no_op';
  
  // What to say to caller (TTS-ready)
  nextPrompt: string;
  
  // Updated intent (if changed)
  updatedIntent: 'booking' | 'troubleshooting' | 'info' | 'billing' | 
                 'emergency' | 'update_appointment' | 'wrong_number' | 
                 'spam' | 'other' | null;
  
  // Context updates
  updates: {
    // Extracted structured data
    extracted: {
      contact?: {
        name?: string;
        phone?: string;
        email?: string;
      };
      location?: {
        addressLine1?: string;
        addressLine2?: string;
        city?: string;
        state?: string;
        zip?: string;
      };
      problem?: {
        summary?: string;
        category?: string;
        urgency?: 'normal' | 'high' | 'emergency';
      };
      scheduling?: {
        preferredDate?: string;
        preferredWindow?: string;
        flexibilityLevel?: 'flexible' | 'specific' | 'asap';
      };
      access?: {
        gateCode?: string;
        parkingInstructions?: string;
        notes?: string;
      };
    };
    
    // Boolean flags
    flags: {
      readyToBook: boolean;           // All requirements met
      needsKnowledgeSearch: boolean;  // Requires 3-Tier lookup
      wantsHuman: boolean;            // Requested human agent
      needsCallBack: boolean;         // Asked for callback
      needsConfirmation: boolean;     // Info needs verification
    };
  };
  
  // Knowledge query (if needs 3-Tier lookup)
  knowledgeQuery: {
    category: string;      // Which knowledge category to search
    queryText: string;     // Actual query text
    context?: object;      // Additional context for 3-Tier
  } | null;
  
  // Internal reasoning (for debugging)
  debugNotes: string;
}
```

### Action Definitions

| Action | When to Use | Next Step |
|--------|-------------|-----------|
| `ask_question` | Missing required info | Wait for caller response |
| `confirm_info` | Have info, need verification | Wait for yes/no |
| `answer_with_knowledge` | Needs factual answer | Call 3-Tier KB |
| `initiate_booking` | Ready to book | Call BookingHandler |
| `update_booking` | Modify existing appointment | Call BookingHandler |
| `escalate_to_human` | Beyond AI capability | Transfer call |
| `small_talk` | Greeting/pleasantry | Acknowledge, continue |
| `close_call` | Call complete | End call |
| `clarify_intent` | Unclear what caller wants | Ask clarifying question |
| `no_op` | Nothing to do | Continue listening |

### Examples

**Example 1: Need More Info**
```json
{
  "action": "ask_question",
  "nextPrompt": "I'd be happy to help with your AC repair. What's your address so I can check our service area?",
  "updatedIntent": "booking",
  "updates": {
    "extracted": {
      "problem": {
        "summary": "AC not working",
        "category": "hvac_repair",
        "urgency": "normal"
      }
    },
    "flags": {
      "readyToBook": false,
      "needsKnowledgeSearch": false,
      "wantsHuman": false,
      "needsCallBack": false,
      "needsConfirmation": false
    }
  },
  "knowledgeQuery": null,
  "debugNotes": "Missing address - required for booking"
}
```

**Example 2: Ready to Book**
```json
{
  "action": "initiate_booking",
  "nextPrompt": "Perfect! I have your information. Let me book a technician for tomorrow afternoon at 123 Main St. You'll receive a confirmation text shortly.",
  "updatedIntent": "booking",
  "updates": {
    "extracted": {
      "contact": {
        "name": "John Smith",
        "phone": "+1234567890"
      },
      "location": {
        "addressLine1": "123 Main St",
        "city": "Tampa",
        "state": "FL",
        "zip": "33602"
      },
      "problem": {
        "summary": "AC not cooling",
        "category": "hvac_repair",
        "urgency": "normal"
      },
      "scheduling": {
        "preferredDate": "tomorrow",
        "preferredWindow": "afternoon"
      }
    },
    "flags": {
      "readyToBook": true,
      "needsKnowledgeSearch": false,
      "wantsHuman": false,
      "needsCallBack": false,
      "needsConfirmation": false
    }
  },
  "knowledgeQuery": null,
  "debugNotes": "All booking requirements met - proceeding"
}
```

**Example 3: Need Knowledge**
```json
{
  "action": "answer_with_knowledge",
  "nextPrompt": "[Will be replaced with 3-Tier answer]",
  "updatedIntent": "info",
  "updates": {
    "extracted": {},
    "flags": {
      "readyToBook": false,
      "needsKnowledgeSearch": true,
      "wantsHuman": false,
      "needsCallBack": false,
      "needsConfirmation": false
    }
  },
  "knowledgeQuery": {
    "category": "pricing_and_services",
    "queryText": "How much does an AC tune-up cost?",
    "context": {
      "intent": "info",
      "urgency": "normal"
    }
  },
  "debugNotes": "Pricing question - needs 3-Tier lookup"
}
```

---

## 📋 CONTRACT 3: 3-TIER KNOWLEDGE RESULT

**File**: `services/IntelligentRouter.js`  
**Function**: `route()`

### Input
```typescript
{
  callerInput: string,              // Query text
  template: object,                 // GlobalInstantResponseTemplate
  company: object,                  // Company document
  callId: string,                   // Call identifier
  context: {
    intent: string,                 // From Frontline-Intel
    frontlineIntel: object,         // Full Frontline result
    extractedContext: object,       // Current extracted data
    conversationHistory: array      // Last N turns
  }
}
```

### Output (EXACT SPEC - THIS IS THE KEY CONTRACT)
```typescript
interface KnowledgeResult {
  // Core response
  text: string;                     // Actual answer text (TTS-ready)
  confidence: number;               // 0.0 - 1.0
  matched: boolean;                 // Whether a match was found
  success: boolean;                 // Whether response is usable
  
  // Tier information
  tierUsed: 1 | 2 | 3;              // Which tier answered
  cost: {
    total: number;                  // Total cost in USD
    tier1: number;                  // Tier 1 cost
    tier2: number;                  // Tier 2 cost
    tier3: number;                  // Tier 3 cost
  };
  
  // Matched scenario (if any)
  scenario: {
    scenarioId: string;             // Scenario ID
    name: string;                   // Scenario name
    category: string;               // Scenario category
    scenarioType?: string;          // Type (if defined)
  } | null;
  
  // 🎯 METADATA HINTS (New - guides LLM-0 without controlling it)
  metadata: {
    // What kind of scenario is this?
    scenarioType?: string;          // e.g., "emergency_service_info", "pricing_question"
    
    // Intent suggestions (LLM-0 can override)
    suggestedIntent?: string;       // e.g., "emergency", "booking"
    
    // Action hints (NOT commands - LLM-0 decides)
    relatedActions?: string[];      // e.g., ["ask_urgency", "offer_booking"]
    
    // Follow-up guidance
    requiresFollowUp?: boolean;     // Does this need a follow-up question?
    followUpSuggestion?: string;    // Suggested follow-up question
    
    // Booking eligibility
    bookingEligible?: boolean;      // Can this lead to booking?
    bookingType?: string;           // e.g., "repair", "maintenance", "emergency"
    
    // Confidence signals
    needsHumanReview?: boolean;     // Complex/sensitive topic
    partialMatch?: boolean;         // Weak match, might need clarification
    
    // Business logic hints
    requiresPricing?: boolean;      // Answer involves pricing
    requiresAvailability?: boolean; // Answer involves scheduling
    requiresVerification?: boolean; // Info needs to be verified
    
    // Content metadata
    containsWarning?: boolean;      // Contains important warning
    containsLegalInfo?: boolean;    // Contains legal/compliance info
    containsEmergencyInfo?: boolean;// Contains emergency instructions
  };
  
  // Performance tracking
  performance: {
    tier1Time?: number;             // Tier 1 duration (ms)
    tier2Time?: number;             // Tier 2 duration (ms)  
    tier3Time?: number;             // Tier 3 duration (ms)
    totalTime: number;              // Total duration (ms)
  };
  
  // Detailed tier results (for debugging)
  tier1Result?: {
    matched: boolean;
    confidence: number;
    matchedRules?: string[];
  };
  tier2Result?: {
    matched: boolean;
    confidence: number;
    topMatches?: Array<{
      scenarioId: string;
      score: number;
    }>;
  };
  tier3Result?: {
    matched: boolean;
    confidence: number;
    llmReasoning?: string;
  };
}
```

### Metadata Usage Guidelines

**LLM-0 MUST NOT blindly follow metadata** - it's guidance, not commands.

**Example decision logic:**
```javascript
// ✅ CORRECT - LLM-0 uses hints but stays in control
if (knowledge.metadata.bookingEligible && 
    context.intent === 'booking' && 
    !context.flags.wantsHuman &&
    hasRequiredBookingInfo(context)) {
  decision.action = 'initiate_booking';
}

// ❌ WRONG - blindly following metadata
if (knowledge.metadata.relatedActions.includes('offer_booking')) {
  decision.action = 'initiate_booking';  // NO! Ignores context
}
```

### Examples

**Example 1: Tier 1 Rule Match (FREE)**
```json
{
  "text": "We're open Monday through Friday, 8 AM to 6 PM, and Saturdays 9 AM to 2 PM.",
  "confidence": 1.0,
  "matched": true,
  "success": true,
  "tierUsed": 1,
  "cost": {
    "total": 0.00,
    "tier1": 0.00,
    "tier2": 0.00,
    "tier3": 0.00
  },
  "scenario": {
    "scenarioId": "hours_of_operation",
    "name": "Business Hours",
    "category": "company_info",
    "scenarioType": "informational"
  },
  "metadata": {
    "scenarioType": "business_hours_info",
    "suggestedIntent": "info",
    "relatedActions": ["ask_if_wants_booking"],
    "requiresFollowUp": false,
    "bookingEligible": true,
    "bookingType": null,
    "needsHumanReview": false,
    "partialMatch": false,
    "requiresPricing": false,
    "requiresAvailability": false,
    "requiresVerification": false,
    "containsWarning": false,
    "containsLegalInfo": false,
    "containsEmergencyInfo": false
  },
  "performance": {
    "tier1Time": 2,
    "totalTime": 2
  },
  "tier1Result": {
    "matched": true,
    "confidence": 1.0,
    "matchedRules": ["hours_exact_match"]
  }
}
```

**Example 2: Tier 3 LLM Match (EXPENSIVE)**
```json
{
  "text": "Yes, we can definitely help with a ductless mini-split system that's making unusual noises. This often indicates a problem with the fan motor or compressor. We'd recommend scheduling a diagnostic visit.",
  "confidence": 0.92,
  "matched": true,
  "success": true,
  "tierUsed": 3,
  "cost": {
    "total": 0.0045,
    "tier1": 0.0000,
    "tier2": 0.0002,
    "tier3": 0.0043
  },
  "scenario": {
    "scenarioId": "hvac_troubleshooting_general",
    "name": "HVAC System Issues",
    "category": "troubleshooting",
    "scenarioType": "diagnostic"
  },
  "metadata": {
    "scenarioType": "equipment_diagnostic",
    "suggestedIntent": "troubleshooting",
    "relatedActions": ["ask_urgency", "offer_diagnostic_visit"],
    "requiresFollowUp": true,
    "followUpSuggestion": "Is this an urgent issue, or can it wait a few days?",
    "bookingEligible": true,
    "bookingType": "diagnostic_visit",
    "needsHumanReview": false,
    "partialMatch": false,
    "requiresPricing": false,
    "requiresAvailability": true,
    "requiresVerification": false,
    "containsWarning": false,
    "containsLegalInfo": false,
    "containsEmergencyInfo": false
  },
  "performance": {
    "tier1Time": 3,
    "tier2Time": 45,
    "tier3Time": 892,
    "totalTime": 940
  },
  "tier1Result": {
    "matched": false,
    "confidence": 0.34
  },
  "tier2Result": {
    "matched": false,
    "confidence": 0.58,
    "topMatches": [
      { "scenarioId": "hvac_troubleshooting_general", "score": 0.58 },
      { "scenarioId": "equipment_noises", "score": 0.52 }
    ]
  },
  "tier3Result": {
    "matched": true,
    "confidence": 0.92,
    "llmReasoning": "Query involves specific equipment (ductless mini-split) and symptom (unusual noises). Matched to general troubleshooting scenario and provided diagnostic guidance."
  }
}
```

**Example 3: Emergency Detection**
```json
{
  "text": "A gas leak is a serious emergency. Please evacuate the building immediately and call 911. Once you're safe, call our emergency line at 555-EMERGENCY for 24/7 assistance.",
  "confidence": 1.0,
  "matched": true,
  "success": true,
  "tierUsed": 1,
  "cost": {
    "total": 0.00,
    "tier1": 0.00,
    "tier2": 0.00,
    "tier3": 0.00
  },
  "scenario": {
    "scenarioId": "gas_leak_emergency",
    "name": "Gas Leak Emergency Protocol",
    "category": "emergency",
    "scenarioType": "emergency_safety"
  },
  "metadata": {
    "scenarioType": "emergency_gas_leak",
    "suggestedIntent": "emergency",
    "relatedActions": ["end_call_immediately", "confirm_safety"],
    "requiresFollowUp": false,
    "bookingEligible": false,
    "bookingType": null,
    "needsHumanReview": false,
    "partialMatch": false,
    "requiresPricing": false,
    "requiresAvailability": false,
    "requiresVerification": false,
    "containsWarning": true,
    "containsLegalInfo": false,
    "containsEmergencyInfo": true
  },
  "performance": {
    "tier1Time": 1,
    "totalTime": 1
  },
  "tier1Result": {
    "matched": true,
    "confidence": 1.0,
    "matchedRules": ["emergency_gas_leak"]
  }
}
```

---

## 📋 CONTRACT 4: RESPONSE TRACE LOG

**Purpose**: Full transparency into what the AI looked at and why it made each decision

### Structure (NEW - TO BE IMPLEMENTED)
```typescript
interface ResponseTraceLog {
  // Identifiers
  traceId: string;                  // Unique trace ID
  callId: string;                   // Call SID
  companyId: string;                // Company ID
  turnNumber: number;               // Which turn in conversation
  timestamp: Date;                  // When this turn happened
  
  // Input
  input: {
    speaker: 'caller' | 'agent';
    text: string;                   // Raw utterance
    textCleaned: string;            // After filler removal
    sttMetadata?: object;           // STT confidence, etc.
  };
  
  // Step 1: Frontline-Intel
  frontlineIntel: FrontlineIntelResult;  // Full result from Contract 1
  
  // Step 2: LLM-0 Decision
  orchestratorDecision: OrchestratorDecision;  // Full result from Contract 2
  
  // Step 3: Knowledge Lookup (if performed)
  knowledgeLookup?: {
    triggered: boolean;
    result: KnowledgeResult | null;  // Full result from Contract 3
    reason: string;                   // Why we looked up knowledge
  };
  
  // Step 4: Booking Action (if performed)
  bookingAction?: {
    triggered: boolean;
    contactId?: string;
    locationId?: string;
    appointmentId?: string;
    result: 'success' | 'failed' | 'partial';
    error?: string;
  };
  
  // Output
  output: {
    agentResponse: string;          // What we said to caller
    action: string;                 // Final action taken
    nextState: string;              // Where conversation is now
  };
  
  // Performance
  performance: {
    frontlineIntelMs: number;
    orchestratorMs: number;
    knowledgeLookupMs?: number;
    bookingMs?: number;
    totalMs: number;
  };
  
  // Cost Breakdown
  cost: {
    frontlineIntel: number;         // Always $0.00
    orchestrator: number;           // GPT-4 Turbo cost
    knowledgeLookup: number;        // 3-Tier cost
    booking: number;                // Always $0.00
    total: number;
  };
  
  // Context Snapshot (at end of turn)
  contextSnapshot: {
    currentIntent: string;
    extractedData: object;
    conversationLength: number;
    bookingReadiness: boolean;
  };
}
```

### Storage
```javascript
// Store in MongoDB for analysis
await ResponseTraceLog.create(traceLog);

// Also append to Redis call context for runtime access
await redisClient.rpush(`trace:${callId}`, JSON.stringify(traceLog));
```

### Example Trace
```json
{
  "traceId": "trace_1732572890123_abc123",
  "callId": "CA1234567890abcdef",
  "companyId": "673abc123",
  "turnNumber": 3,
  "timestamp": "2025-11-25T19:45:00.000Z",
  
  "input": {
    "speaker": "caller",
    "text": "Um, yeah, I think my AC stopped working yesterday",
    "textCleaned": "I think my AC stopped working yesterday",
    "sttMetadata": {
      "confidence": 0.94,
      "duration": 2.3
    }
  },
  
  "frontlineIntel": {
    "intent": "troubleshooting",
    "confidence": 0.82,
    "signals": {
      "urgent": false,
      "bookingIntent": "low",
      "hasQuestions": false,
      "maybeWrongNumber": false,
      "maybeSpam": false,
      "mentionsCompetitor": false,
      "mentionsPricing": false,
      "mentionsEmergency": false
    },
    "entities": {
      "phoneNumbers": [],
      "addresses": [],
      "dates": ["yesterday"],
      "names": []
    },
    "metadata": {
      "matchedRules": ["hvac_keywords", "problem_statement"],
      "processingTimeMs": 3,
      "fillerWordsRemoved": ["um", "yeah"]
    }
  },
  
  "orchestratorDecision": {
    "action": "answer_with_knowledge",
    "nextPrompt": "[Will be replaced]",
    "updatedIntent": "troubleshooting",
    "updates": {
      "extracted": {
        "problem": {
          "summary": "AC stopped working",
          "category": "hvac_repair",
          "urgency": "normal"
        }
      },
      "flags": {
        "readyToBook": false,
        "needsKnowledgeSearch": true,
        "wantsHuman": false,
        "needsCallBack": false,
        "needsConfirmation": false
      }
    },
    "knowledgeQuery": {
      "category": "troubleshooting",
      "queryText": "AC stopped working yesterday",
      "context": {
        "intent": "troubleshooting",
        "urgency": "normal"
      }
    },
    "debugNotes": "Needs diagnostic info before booking"
  },
  
  "knowledgeLookup": {
    "triggered": true,
    "result": {
      "text": "I can help diagnose your AC issue. Common causes include a tripped breaker, thermostat issues, or a refrigerant leak. We can send a technician to inspect it.",
      "confidence": 0.89,
      "matched": true,
      "success": true,
      "tierUsed": 2,
      "cost": {
        "total": 0.0003,
        "tier1": 0.0000,
        "tier2": 0.0003,
        "tier3": 0.0000
      },
      "scenario": {
        "scenarioId": "ac_not_cooling",
        "name": "AC Not Cooling / Not Working",
        "category": "troubleshooting",
        "scenarioType": "diagnostic"
      },
      "metadata": {
        "scenarioType": "equipment_diagnostic",
        "suggestedIntent": "troubleshooting",
        "relatedActions": ["ask_urgency", "offer_diagnostic_visit"],
        "requiresFollowUp": true,
        "followUpSuggestion": "Would you like me to schedule a technician?",
        "bookingEligible": true,
        "bookingType": "diagnostic_visit",
        "needsHumanReview": false,
        "partialMatch": false
      },
      "performance": {
        "tier1Time": 2,
        "tier2Time": 43,
        "totalTime": 45
      }
    },
    "reason": "Orchestrator set needsKnowledgeSearch flag"
  },
  
  "output": {
    "agentResponse": "I can help diagnose your AC issue. Common causes include a tripped breaker, thermostat issues, or a refrigerant leak. Would you like me to schedule a technician to inspect it?",
    "action": "answer_with_knowledge",
    "nextState": "waiting_for_booking_decision"
  },
  
  "performance": {
    "frontlineIntelMs": 3,
    "orchestratorMs": 234,
    "knowledgeLookupMs": 45,
    "totalMs": 282
  },
  
  "cost": {
    "frontlineIntel": 0.0000,
    "orchestrator": 0.0002,
    "knowledgeLookup": 0.0003,
    "booking": 0.0000,
    "total": 0.0005
  },
  
  "contextSnapshot": {
    "currentIntent": "troubleshooting",
    "extractedData": {
      "problem": {
        "summary": "AC stopped working",
        "category": "hvac_repair",
        "urgency": "normal"
      }
    },
    "conversationLength": 3,
    "bookingReadiness": false
  }
}
```

---

## 🔧 IMPLEMENTATION CHECKLIST

### Phase 1: Contracts (1-2 hours)
- [ ] Add TypeScript/JSDoc definitions to each service
- [ ] Validate current outputs match specs
- [ ] Add schema validation (Joi/Zod)

### Phase 2: Metadata Enhancement (2-3 hours)
- [ ] Update IntelligentRouter to return metadata
- [ ] Add metadata population logic to Tier 1, 2, 3
- [ ] Test metadata hints with sample scenarios

### Phase 3: Orchestrator Integration (2-3 hours)
- [ ] Update orchestrationEngine to use metadata hints
- [ ] Add decision logic examples
- [ ] Test with various conversation flows

### Phase 4: Trace Logging (3-4 hours)
- [ ] Create ResponseTraceLog model
- [ ] Integrate logging into orchestrationEngine
- [ ] Build admin UI to view traces
- [ ] Add trace search/filter

### Total Effort: 8-12 hours

---

## 🚫 FORBIDDEN PATTERNS

These patterns MUST NOT be implemented:

### ❌ Scenario Controls Flow
```javascript
// WRONG - Scenario dictating action
if (knowledgeResult.nextAction === 'OFFER_BOOKING') {
  decision.action = 'initiate_booking';
}
```

### ❌ Bypassing LLM-0
```javascript
// WRONG - Direct scenario to booking
if (scenario.bookingEligible) {
  return bookingHandler.book(...);  // Skips orchestrator
}
```

### ❌ Hard-Coded Routing
```javascript
// WRONG - Fixed routing table
const actionMap = {
  'pricing': 'escalate_to_human',
  'emergency': 'initiate_booking'
};
```

### ✅ Correct Pattern
```javascript
// CORRECT - LLM-0 stays in control
const knowledgeResult = await router.route(...);

// Orchestrator uses hints + full context
if (knowledgeResult.metadata?.bookingEligible &&
    decision.updates.flags.readyToBook &&
    !decision.updates.flags.wantsHuman) {
  decision.action = 'initiate_booking';
} else if (knowledgeResult.metadata?.requiresFollowUp) {
  decision.action = 'ask_question';
  decision.nextPrompt = knowledgeResult.metadata.followUpSuggestion || 
                       "Can you tell me more?";
}
```

---

## 📝 SPEC VERSIONING

**Current Version**: 2.0  
**Last Updated**: November 25, 2025  
**Breaking Changes**: None (new system)

### Future Changes
All changes to these contracts MUST be:
1. Documented in this file
2. Versioned (2.1, 2.2, etc.)
3. Backwards compatible for 90 days
4. Announced to dev team

---

**END OF SPECIFICATION**

These contracts are now **LOCKED**.  
Any deviation requires explicit approval and documentation.

