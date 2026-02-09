# V111: Implementation Roadmap

> **Status:** Phase 0-4 COMPLETE  
> **Linked Spec:** V111-ConversationMemory-Spec.md  
> **Date:** 2026-02-08  
> **Last Updated:** 2026-02-09 - Phase 4 governance enforcement complete

---

## Implementation Phases

This document maps the V111 specification to concrete code changes, organized in a safe, incremental order.

---

## Phase 0: Foundation (Visibility Only)

**Goal:** Build the runtime truth infrastructure without changing any existing behavior.

### 0.1 Create ConversationMemory Service

**New File:** `services/engine/ConversationMemory.js`

```javascript
// Core responsibilities:
// - Initialize memory object for new calls
// - Load existing memory from Redis for ongoing calls  
// - Provide governed write methods
// - Commit turns (finalize TurnRecord)
// - Save state to Redis
// - Generate final snapshot at call end

class ConversationMemory {
  constructor(callId, companyId, config) {}
  
  // Factory methods
  static async load(callId) {}
  static async create(callId, companyId, templateId) {}
  
  // Governed write methods
  addSTTResult(raw, cleaned, sttOps) {}
  commitFact(factId, value, source, confidence) {}  // Returns success/failure
  addTriageResult(candidates, topScenario, urgency) {}
  addRoutingDecision(handler, why, rejected) {}
  addResponse(handler, text, latencyMs, actions) {}
  
  // Turn management
  startTurn(turnNumber) {}
  commitTurn() {}  // Finalizes current TurnRecord
  
  // Phase management
  transitionPhase(newPhase, reason) {}
  
  // Booking integration
  setBookingConsent(turn) {}
  setBookingStep(step) {}
  
  // Context generation (for LLM)
  getContextForHandler(handler) {}
  
  // Persistence
  async save() {}  // To Redis
  async archive() {}  // To MongoDB (call end)
  
  // Serialization
  toJSON() {}
  getCurrentTurnRecord() {}
}
```

### 0.2 Create TurnRecordBuilder Helper

**New File:** `services/engine/TurnRecordBuilder.js`

```javascript
// Builds TurnRecord objects incrementally during a turn
class TurnRecordBuilder {
  constructor(turnNumber) {}
  
  setCallerInput(raw, cleaned, confidence, sttOps) {}
  setExtraction(slots, intent, entities) {}
  setTriage(candidates, topScenario, urgency) {}
  setRouting(handler, why, rejected, phase) {}
  setResponse(handler, text, latencyMs, tokens, actions) {}
  setDelta(factsAdded, factsUpdated, phaseChanged) {}
  setMemorySnapshot(facts, phase, bookingMode, captureProgress) {}
  
  build() {}  // Returns complete TurnRecord
}
```

### 0.3 Update v2twilio.js Entry Point

**File:** `routes/v2twilio.js`

```javascript
// In /v2-agent-respond/:companyID handler

// NEW: Load or create conversation memory
const memory = await ConversationMemory.loadOrCreate(callSid, companyId);
memory.startTurn(turnCount);

// EXISTING: STT processing (add instrumentation)
const sttResult = await STTPreprocessor.process(cleanSpeech, companyConfig);
memory.addSTTResult(originalSpeech, sttResult.cleaned, sttResult.ops);  // NEW

// EXISTING: Rest of pipeline continues unchanged
// ... slot extraction, triage, routing, response ...

// NEW: After response generated
memory.commitTurn();
await memory.save();
```

### 0.4 Create BlackBox TurnRecord Logger

**File:** `services/BlackBoxLogger.js` (extend)

```javascript
// Add new method for TurnRecord logging
async logTurnRecord(companyId, callId, turnRecord) {
  await this.logEvent({
    companyId,
    callId,
    eventType: 'TURN_RECORDED',
    turnNumber: turnRecord.turn,
    timestamp: turnRecord.timestamp,
    payload: turnRecord,
    version: 'v111'
  });
}
```

### 0.5 Redis Key Management

**File:** `services/engine/ConversationMemory.js` (part of)

```javascript
// Redis operations
const REDIS_KEY_PREFIX = 'conversation-memory:';
const REDIS_TTL_SECONDS = 300;  // 5 min after last activity

async save() {
  const key = `${REDIS_KEY_PREFIX}${this.callId}`;
  await redis.setex(key, REDIS_TTL_SECONDS, JSON.stringify(this.toJSON()));
}

static async load(callId) {
  const key = `${REDIS_KEY_PREFIX}${callId}`;
  const data = await redis.get(key);
  if (!data) return null;
  return ConversationMemory.fromJSON(JSON.parse(data));
}
```

### Phase 0 Deliverables
- [x] `ConversationMemory.js` service created
- [x] `TurnRecordBuilder.js` helper created
- [x] v2twilio.js instrumented (parallel to existing flow)
- [x] TurnRecords logging to BlackBox
- [x] No behavior changes - existing tests pass

---

## Phase 1: Discovery Tab Viewer

**Goal:** UI to visualize conversation memory from completed calls.

### 1.1 Add API Endpoint for Call Memory

**New File:** `routes/admin/conversationMemory.js`

```javascript
// GET /api/admin/conversation-memory/:callId
// Returns full ConversationMemory for a completed call

// GET /api/admin/conversation-memory/recent/:companyId
// Returns list of recent calls with summary

// GET /api/admin/conversation-memory/:callId/turns
// Returns turn-by-turn breakdown
```

### 1.2 Update FrontDeskBehaviorManager.js

**File:** `public/js/ai-agent-settings/FrontDeskBehaviorManager.js`

Add new section to Discovery tab:

```javascript
renderConversationMemoryViewer() {
  return `
    <div class="fdb-section" id="fdb-memory-viewer">
      <h4>📊 Conversation Memory Viewer</h4>
      
      <!-- Call selector -->
      <div class="fdb-memory-selector">
        <select id="fdb-memory-call-select">
          <option value="">Select a recent call...</option>
        </select>
        <button id="fdb-memory-load">Load</button>
      </div>
      
      <!-- Facts timeline -->
      <div id="fdb-memory-facts"></div>
      
      <!-- Turn-by-turn viewer -->
      <div id="fdb-memory-turns"></div>
      
      <!-- Routing trace -->
      <div id="fdb-memory-routing"></div>
    </div>
  `;
}
```

### 1.3 Turn Visualization Component

```javascript
renderTurnCard(turn) {
  return `
    <div class="fdb-turn-card" data-turn="${turn.turn}">
      <div class="turn-header">Turn ${turn.turn} @ ${formatTime(turn.timestamp)}</div>
      
      <div class="turn-caller">
        <strong>Caller:</strong> "${turn.caller.cleaned}"
        ${turn.caller.sttOps.fillersRemoved.length ? 
          `<span class="stt-note">STT: removed ${turn.caller.sttOps.fillersRemoved.join(', ')}</span>` : ''}
      </div>
      
      <div class="turn-extraction">
        <strong>Extracted:</strong> 
        ${Object.entries(turn.extraction.slots).map(([k,v]) => `${k}="${v.value}"`).join(', ') || 'none'}
      </div>
      
      <div class="turn-routing">
        <strong>Handler:</strong> ${turn.routing.selectedHandler}
        <span class="why">(${turn.routing.why.map(w => w.rule || w).join(' → ')})</span>
      </div>
      
      <div class="turn-response">
        <strong>Agent:</strong> "${turn.response.text}"
        <span class="latency">${turn.response.latencyMs}ms</span>
      </div>
      
      <div class="turn-delta">
        ${turn.delta.factsAdded.length ? `<span class="delta-added">+${turn.delta.factsAdded.join(', ')}</span>` : ''}
        ${turn.delta.phaseChanged ? `<span class="delta-phase">Phase → ${turn.routing.phase}</span>` : ''}
      </div>
    </div>
  `;
}
```

### Phase 1 Deliverables
- [x] API endpoint for conversation memory retrieval (`routes/admin/conversationMemory.js`)
- [x] Discovery tab "Conversation Memory Viewer" section
- [x] Turn-by-turn visualization with collapsible cards
- [x] Facts timeline view
- [x] Routing trace view

---

## Phase 2: Config UI + Comparison

**Goal:** Allow configuring capture goals and compare against actual calls.

### 2.1 Update Mongoose Schema

**File:** `models/v2Company.js`

```javascript
// Add to aiAgentSettings.frontDeskBehavior
conversationMemory: {
  version: { type: String, default: 'v111' },
  enabled: { type: Boolean, default: false },
  
  schema: {
    facts: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  
  captureGoals: {
    must: {
      fields: [{ type: String }],
      deadline: { type: String, default: 'before_booking_confirmation' },
      onMissing: { type: String, default: 'router_prompts' }
    },
    should: {
      fields: [{ type: String }],
      deadline: { type: String, default: 'end_of_discovery' },
      onMissing: { type: String, default: 'log_warning' }
    },
    nice: {
      fields: [{ type: String }],
      deadline: { type: String, default: 'none' },
      onMissing: { type: String, default: 'ignore' }
    }
  },
  
  contextWindow: {
    maxTurns: { type: Number, default: 6 },
    summarizeOlderTurns: { type: Boolean, default: true },
    alwaysIncludeFacts: { type: Boolean, default: true },
    maxTokenBudget: { type: Number, default: 600 }
  },
  
  handlerGovernance: {
    scenarioHandler: {
      enabled: { type: Boolean, default: true },
      minConfidence: { type: Number, default: 0.75 },
      allowInBookingMode: { type: Boolean, default: false }
    },
    bookingHandler: {
      enabled: { type: Boolean, default: true },
      requiresConsent: { type: Boolean, default: true },
      consentConfidence: { type: Number, default: 0.8 },
      lockAfterConsent: { type: Boolean, default: true }
    },
    llmHandler: {
      enabled: { type: Boolean, default: true },
      isDefaultFallback: { type: Boolean, default: true },
      canWriteFacts: { type: Boolean, default: false }
    }
  },
  
  routerRules: {
    priority: [{ type: String }],
    captureInjection: {
      enabled: { type: Boolean, default: true },
      maxTurnsWithoutProgress: { type: Number, default: 2 }
    }
  },
  
  blackbox: {
    logTurnRecords: { type: Boolean, default: true },
    logMilestones: { type: Boolean, default: true },
    verbosity: { type: String, default: 'standard' }
  }
}
```

### 2.2 Add Config Editor to Discovery Tab

**File:** `public/js/ai-agent-settings/FrontDeskBehaviorManager.js`

```javascript
renderConversationMemoryConfig() {
  return `
    <div class="fdb-section" id="fdb-memory-config">
      <h4>⚙️ Conversation Memory Config (V111)</h4>
      
      <div class="fdb-toggle-row">
        <label>Enable V111 Memory</label>
        <input type="checkbox" id="fdb-memory-enabled" />
      </div>
      
      <!-- Capture Goals -->
      <div class="fdb-subsection">
        <h5>Capture Goals</h5>
        
        <div class="goal-row">
          <label>MUST Capture (Required for booking)</label>
          <select id="fdb-must-fields" multiple>
            <option value="name">Name</option>
            <option value="phone">Phone</option>
            <option value="address">Address</option>
            <option value="issue">Issue</option>
          </select>
        </div>
        
        <div class="goal-row">
          <label>SHOULD Capture (Strongly desired)</label>
          <select id="fdb-should-fields" multiple>
            <!-- ... -->
          </select>
        </div>
        
        <div class="goal-row">
          <label>NICE to Capture (Optional)</label>
          <select id="fdb-nice-fields" multiple>
            <!-- ... -->
          </select>
        </div>
      </div>
      
      <!-- Handler Governance -->
      <div class="fdb-subsection">
        <h5>Handler Governance</h5>
        
        <div class="fdb-toggle-row">
          <label>Scenario Min Confidence</label>
          <input type="number" id="fdb-scenario-confidence" min="0" max="1" step="0.05" value="0.75" />
        </div>
        
        <div class="fdb-toggle-row">
          <label>Lock booking after consent</label>
          <input type="checkbox" id="fdb-booking-lock" checked />
        </div>
        
        <div class="fdb-toggle-row">
          <label>Inject capture prompts when stuck</label>
          <input type="checkbox" id="fdb-capture-injection" checked />
        </div>
      </div>
      
      <button id="fdb-memory-save" class="fdb-btn-primary">Save Config</button>
    </div>
  `;
}
```

### 2.3 Call Analysis View

```javascript
renderCallAnalysis(memory, config) {
  const analysis = analyzeAgainstGoals(memory, config);
  
  return `
    <div class="fdb-call-analysis">
      <h5>Goal Achievement</h5>
      
      <div class="goal-checklist">
        <div class="must-goals ${analysis.must.complete ? 'complete' : 'incomplete'}">
          <strong>MUST</strong>
          ${analysis.must.fields.map(f => `
            <span class="${f.captured ? 'captured' : 'missing'}">${f.name}</span>
          `).join('')}
        </div>
        
        <div class="should-goals">
          <strong>SHOULD</strong>
          ${analysis.should.fields.map(f => `
            <span class="${f.captured ? 'captured' : 'missed'}">${f.name}</span>
          `).join('')}
        </div>
      </div>
      
      ${!analysis.must.complete ? `
        <div class="warning-box">
          ⚠️ MUST goals not met: ${analysis.must.missing.join(', ')}
          <br>Cause: ${analysis.must.reason}
        </div>
      ` : ''}
    </div>
  `;
}
```

### Phase 2 Deliverables
- [x] Mongoose schema for V111 config (`models/v2Company.js`)
- [x] API endpoint for saving V111 config (`routes/admin/frontDeskBehavior.js`)
- [x] Config editor in Discovery tab ("Conversation Memory Config")
- [x] Call analysis comparison view ("Capture Goals vs Actual")
- [x] Gap highlighting (green checkmarks for captured, red X for missing)

---

## Phase 3: Governance Enforcement

**Goal:** Router reads from V111 config and enforces rules.

### 3.1 Create GovernanceEngine

**New File:** `services/engine/GovernanceEngine.js`

```javascript
class GovernanceEngine {
  constructor(v111Config) {
    this.config = v111Config;
  }
  
  // Validate fact write
  canCommitFact(factId, source, confidence) {
    const schema = this.config.conversationMemory.schema.facts[factId];
    if (!schema) return { allowed: false, reason: 'field_not_in_schema' };
    if (!schema.sources.includes(source)) return { allowed: false, reason: 'source_not_allowed' };
    if (confidence < schema.confidenceThreshold) return { allowed: false, reason: 'below_threshold' };
    return { allowed: true };
  }
  
  // Select handler
  selectHandler(memory) {
    const governance = this.config.conversationMemory.handlerGovernance;
    const rules = this.config.conversationMemory.routerRules;
    // ... implementation from spec
  }
  
  // Check if capture injection needed
  shouldInjectCapture(memory) {
    const injection = this.config.conversationMemory.routerRules.captureInjection;
    if (!injection.enabled) return false;
    
    const progress = memory.captureProgress;
    if (progress.turnsWithoutProgress >= injection.maxTurnsWithoutProgress) {
      const missingMust = this.getMissingMustFields(progress);
      if (missingMust.length > 0) {
        return { inject: true, field: missingMust[0] };
      }
    }
    return { inject: false };
  }
  
  getMissingMustFields(progress) {
    return this.config.conversationMemory.captureGoals.must.fields
      .filter(f => !progress.must[f]?.captured);
  }
}
```

### 3.2 Update FrontDeskRuntime

**File:** `services/engine/FrontDeskRuntime.js`

```javascript
// In determineLane() or equivalent

async determineLane(input, context, memory) {
  // Load V111 config
  const v111Config = await this.loadV111Config(context.companyId);
  
  if (v111Config?.conversationMemory?.enabled) {
    // Use GovernanceEngine
    const governance = new GovernanceEngine(v111Config);
    
    // Check capture injection
    const captureCheck = governance.shouldInjectCapture(memory);
    if (captureCheck.inject) {
      return {
        lane: 'CAPTURE_INJECTION',
        field: captureCheck.field,
        why: ['must_field_missing', `turns_without_progress=${memory.captureProgress.turnsWithoutProgress}`]
      };
    }
    
    // Select handler
    return governance.selectHandler(memory);
  }
  
  // Fall back to existing behavior
  return this.legacyDetermineLane(input, context);
}
```

### 3.3 Update Slot Extractor

**File:** (wherever slot extraction happens)

```javascript
// Before writing facts
async extractAndCommitSlots(input, memory, governance) {
  const extracted = await this.extractSlots(input);
  
  for (const [factId, value] of Object.entries(extracted)) {
    const check = governance.canCommitFact(factId, value.source, value.confidence);
    
    if (check.allowed) {
      memory.commitFact(factId, value.value, value.source, value.confidence);
    } else {
      // Log rejected write
      logger.debug('[GOVERNANCE] Fact write rejected', { factId, reason: check.reason });
    }
  }
}
```

### Phase 3 Deliverables
- [x] Governance logic added to `ConversationMemory.js` (handler checks, capture tracking)
- [x] `V111Router.js` service created for config-driven routing decisions
- [x] FrontDeskRuntime integrates V111Router when V111 enabled
- [x] Capture injection working (hard at threshold, soft below)
- [x] Handler selection governed by config (scenario/booking/LLM/escalation)
- [x] Loop detection implemented
- [x] All writes logged with governance trail
- [x] UI viewer shows V111 governance decisions per turn

---

## Phase 4: Transcripts

**Goal:** Generate clean transcripts at call end.

### 4.1 Create TranscriptGenerator

**New File:** `services/TranscriptGenerator.js`

```javascript
class TranscriptGenerator {
  constructor(memory, config) {
    this.memory = memory;
    this.config = config;
  }
  
  generateCustomer() {
    // Clean customer-facing transcript
    return this.formatCustomerTranscript();
  }
  
  generateEngineering() {
    // Debug transcript with full details
    return this.formatEngineeringTranscript();
  }
  
  formatCustomerTranscript() {
    const lines = [
      '═══════════════════════════════════════════════════════════════',
      'CALL TRANSCRIPT',
      // ... header
    ];
    
    // Add conversation
    for (const turn of this.memory.turns) {
      lines.push(`CALLER: ${turn.caller.cleaned}`);
      lines.push(`AGENT: ${turn.response.text}`);
      lines.push('');
    }
    
    // Add booking details if any
    if (this.memory.booking?.created) {
      lines.push('BOOKING CONFIRMATION');
      // ...
    }
    
    return lines.join('\n');
  }
  
  formatEngineeringTranscript() {
    // Full debug format as shown in spec
  }
}
```

### 4.2 Update Call End Handling

**File:** `routes/v2twilio.js` (or wherever call end is handled)

```javascript
async function handleCallEnd(callId, companyId) {
  const memory = await ConversationMemory.load(callId);
  if (!memory) return;
  
  // Set outcome
  memory.setOutcome({
    endReason: 'caller_hangup',
    duration: Date.now() - memory.startTime,
    finalPhase: memory.phase.current
  });
  
  // Generate transcripts
  const generator = new TranscriptGenerator(memory, await loadV111Config(companyId));
  
  const customerTranscript = generator.generateCustomer();
  const engineeringTranscript = generator.generateEngineering();
  
  // Store transcripts
  await CallTranscript.create({
    callId,
    companyId,
    customerTranscript,
    engineeringTranscript,
    memory: memory.toJSON(),
    createdAt: new Date()
  });
  
  // Archive memory
  await memory.archive();
}
```

### 4.3 Transcript Viewer in UI

**File:** `public/js/ai-agent-settings/FrontDeskBehaviorManager.js`

```javascript
renderTranscriptViewer(callId) {
  return `
    <div class="fdb-transcript-viewer">
      <div class="transcript-tabs">
        <button class="active" data-tab="customer">Customer</button>
        <button data-tab="engineering">Engineering</button>
      </div>
      
      <div class="transcript-content">
        <pre id="fdb-transcript-display"></pre>
      </div>
      
      <div class="transcript-actions">
        <button id="fdb-transcript-copy">📋 Copy</button>
        <button id="fdb-transcript-download">⬇️ Download</button>
      </div>
    </div>
  `;
}
```

### Phase 4 Deliverables
- [ ] TranscriptGenerator service created
- [ ] Customer transcript format implemented
- [ ] Engineering transcript format implemented
- [ ] Call end hooks transcript generation
- [ ] MongoDB storage for transcripts
- [ ] Transcript viewer in Discovery tab
- [ ] Copy/download functionality

---

## File Change Summary

### New Files
| File | Phase | Purpose |
|------|-------|---------|
| `services/engine/ConversationMemory.js` | 0 | Core runtime truth object |
| `services/engine/TurnRecordBuilder.js` | 0 | Build TurnRecords |
| `services/engine/GovernanceEngine.js` | 3 | Config-based rule enforcement |
| `services/TranscriptGenerator.js` | 4 | Generate transcript outputs |
| `routes/admin/conversationMemory.js` | 1 | API for memory retrieval |
| `models/CallTranscript.js` | 4 | MongoDB model for transcripts |

### Modified Files
| File | Phase | Changes |
|------|-------|---------|
| `routes/v2twilio.js` | 0, 4 | Instrument with memory, call end hooks |
| `models/v2Company.js` | 2 | Add V111 config schema |
| `services/BlackBoxLogger.js` | 0 | Add TurnRecord logging |
| `services/engine/FrontDeskRuntime.js` | 3 | Integrate GovernanceEngine |
| `public/js/ai-agent-settings/FrontDeskBehaviorManager.js` | 1, 2, 4 | Add viewer, config, transcripts |
| `routes/admin/frontDeskBehavior.js` | 2 | Save/load V111 config |

---

## Testing Strategy

### Phase 0 Tests
- Memory object creates correctly
- TurnRecords log to BlackBox
- No behavior change - existing tests pass

### Phase 1 Tests
- API returns correct memory for call
- UI renders turns correctly

### Phase 2 Tests
- Config saves to MongoDB
- Config loads in UI
- Analysis correctly identifies gaps

### Phase 3 Tests
- GovernanceEngine blocks unauthorized writes
- Capture injection triggers at right time
- Handler selection follows priority rules

### Phase 4 Tests
- Customer transcript is clean
- Engineering transcript has all details
- Transcripts persist to MongoDB

---

## Risk Mitigation

1. **Feature flag V111** - Can disable without rollback
2. **Parallel logging** - Phase 0 logs alongside existing, doesn't replace
3. **Gradual rollout** - Enable per company, not globally
4. **Existing tests** - Must pass at every phase
5. **Backwards compatible** - Calls without V111 use legacy flow

---

*End of Roadmap*
