# 🎯 AI Call Trace UI Spec – "Why Did It Say That?"

**Purpose:** Visual, human-readable explanation of every decision made during a call. This is your defense against client confusion and your sales weapon for enterprise deals.

---

## 📐 UI Architecture

Three-panel layout (responsive, desktop-first):

```
┌─────────────────────────────────────────────────────┐
│  HEADER: Company | Caller | Duration | Outcome     │
├──────────────────────┬──────────────────────────────┤
│   CONVERSATION       │     DECISION DETAILS         │
│   TIMELINE (left)    │     PANEL (right)            │
│                      │                              │
│  • Turn 1            │  [Click turn to populate]    │
│    User: What...     │                              │
│    AI: We are...     │  Routing:                    │
│    [Tier1 INFO_FAQ]  │  • Tier: 1                   │
│                      │  • Scenario: Hours Op.       │
│  • Turn 2            │  • Type: INFO_FAQ            │
│    User: Thanks      │  • Strategy: FULL_ONLY       │
│    AI: You're...     │                              │
│    [SYSTEM_ACK]      │  Timing:                     │
│                      │  • AI: 215ms                 │
│                      │  • Total: 900ms              │
│                      │                              │
│                      │  Warnings: none              │
└──────────────────────┴──────────────────────────────┘
```

---

## 🎨 Detailed Layout

### 1. HEADER (Top bar)

```html
<div class="trace-header">
  <div class="header-left">
    <h2>Call Trace</h2>
    <p class="text-gray-600">
      <strong>Company:</strong> {{ company.companyName }} |
      <strong>Caller:</strong> {{ callerNumber }} |
      <strong>Duration:</strong> {{ totalDurationMs }}ms
    </p>
  </div>
  
  <div class="header-right">
    <span class="outcome-badge" :class="outcomeClass">
      {{ outcomeLabel }}
    </span>
    <!-- Outcome badges -->
    <!-- ai_resolved → ✓ Green "AI Resolved" -->
    <!-- escalated_to_human → ⚠ Yellow "Escalated" -->
    <!-- error → ✗ Red "Error" -->
  </div>
</div>
```

**Outcome badge styles:**
- `ai_resolved` → Green, checkmark icon, "AI Resolved"
- `escalated_to_human` → Yellow/orange, arrow icon, "Escalated to Human"
- `caller_hung_up` → Gray, X icon, "Caller Hung Up"
- `error` → Red, alert icon, "Error"

---

### 2. CONVERSATION TIMELINE (Left panel, ~40% width)

**Purpose:** Quick scan of what was said + AI decisions at a glance.

```html
<div class="timeline-panel">
  <div class="timeline-header">
    <h3>Conversation Timeline</h3>
    <p class="text-xs text-gray-500">{{ turns.length }} turns</p>
  </div>
  
  <div class="timeline-list">
    <!-- Repeat for each turn -->
    <div 
      class="timeline-turn" 
      :class="{ 'is-selected': selectedTurn === turnIndex }"
      @click="selectTurn(turnIndex)"
    >
      <!-- Turn number and timestamp -->
      <div class="turn-header">
        <span class="turn-number">Turn {{ turn.turnIndex }}</span>
        <span class="turn-time">{{ formatTime(turn.timestamp) }}</span>
      </div>
      
      <!-- User input (what they said) -->
      <div class="turn-user">
        <strong>👤 Caller:</strong> "{{ truncate(turn.userInput.text, 60) }}"
      </div>
      
      <!-- AI response -->
      <div class="turn-ai">
        <strong>🤖 AI:</strong> "{{ truncate(turn.aiBrain.responseText, 60) }}"
      </div>
      
      <!-- Decision tags (inline) -->
      <div class="turn-tags">
        <span class="tag tier" :class="'tier-' + turn.aiBrain.tierUsed">
          Tier {{ turn.aiBrain.tierUsed }}
        </span>
        <span class="tag type">{{ turn.aiBrain.scenarioTypeResolved }}</span>
        <span class="tag strategy">{{ turn.aiBrain.responseStrategyUsed }}</span>
        
        <!-- Warning tags if applicable -->
        <span v-if="turn.flags.escalatedThisTurn" class="tag warning">
          ⚠ Escalated
        </span>
        <span v-if="turn.flags.nullResponse" class="tag error">
          ✗ Null
        </span>
        <span v-if="turn.flags.configError" class="tag error">
          ⚠ Config Issue
        </span>
      </div>
    </div>
  </div>
</div>

<style>
.timeline-turn {
  padding: 12px;
  margin: 8px 0;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.timeline-turn:hover {
  background: #f5f5f5;
  border-color: #667eea;
}

.timeline-turn.is-selected {
  background: #f0f4ff;
  border-color: #667eea;
  border-width: 2px;
}

.turn-tags {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag {
  display: inline-block;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 3px;
  font-weight: 500;
}

.tag.tier-1 { background: #d4edda; color: #155724; }
.tag.tier-2 { background: #fff3cd; color: #856404; }
.tag.tier-3 { background: #d1ecf1; color: #0c5460; }
.tag.type { background: #e7e7ff; color: #4a148c; }
.tag.strategy { background: #f3e5f5; color: #4a148c; }
.tag.warning { background: #fff3cd; color: #ff6b6b; }
.tag.error { background: #f8d7da; color: #721c24; }
</style>
```

---

### 3. DECISION DETAILS PANEL (Right panel, ~60% width)

**Purpose:** When you click a turn, show complete decision breakdown.

```html
<div class="details-panel">
  <div v-if="!selectedTurn" class="empty-state">
    <p class="text-gray-500 text-center">Click a turn to see decision details</p>
  </div>
  
  <div v-else class="detail-content">
    <!-- TURN HEADER -->
    <div class="section">
      <h4>Turn {{ selectedTurn.turnIndex }}</h4>
      <p class="text-sm text-gray-600">
        {{ formatDateTime(selectedTurn.timestamp) }}
      </p>
    </div>
    
    <!-- USER INPUT DETAIL -->
    <div class="section">
      <h5>User Input</h5>
      <div class="detail-box">
        <p><strong>Text:</strong> "{{ selectedTurn.userInput.text }}"</p>
        <p><strong>ASR Provider:</strong> {{ selectedTurn.userInput.asrProvider }}</p>
        <p v-if="selectedTurn.userInput.asrConfidence">
          <strong>ASR Confidence:</strong> 
          {{ (selectedTurn.userInput.asrConfidence * 100).toFixed(1) }}%
        </p>
      </div>
    </div>
    
    <!-- ROUTING DECISION -->
    <div class="section">
      <h5>Routing Decision</h5>
      <div class="detail-box">
        <div class="routing-row">
          <span class="label">Tier Used:</span>
          <span class="value">
            <strong>Tier {{ selectedTurn.aiBrain.tierUsed }}</strong>
            <span class="text-xs text-gray-500">
              ({{ tierLabel(selectedTurn.aiBrain.tierUsed) }})
            </span>
          </span>
        </div>
        
        <div class="routing-row" v-if="selectedTurn.aiBrain.tier1Score">
          <span class="label">Tier 1 Score:</span>
          <span class="value">{{ selectedTurn.aiBrain.tier1Score.toFixed(3) }}</span>
        </div>
        
        <div class="routing-row" v-if="selectedTurn.aiBrain.tier2Score">
          <span class="label">Tier 2 Score:</span>
          <span class="value">{{ selectedTurn.aiBrain.tier2Score.toFixed(3) }}</span>
        </div>
        
        <div class="routing-row" v-if="selectedTurn.aiBrain.tier3Confidence">
          <span class="label">Tier 3 Confidence:</span>
          <span class="value">{{ selectedTurn.aiBrain.tier3Confidence.toFixed(3) }}</span>
        </div>
      </div>
    </div>
    
    <!-- SCENARIO MATCHED -->
    <div class="section">
      <h5>Scenario Matched</h5>
      <div class="detail-box">
        <div class="routing-row">
          <span class="label">Scenario Name:</span>
          <span class="value">{{ selectedTurn.aiBrain.scenarioName }}</span>
        </div>
        
        <div class="routing-row">
          <span class="label">Type (Resolved):</span>
          <span class="value">
            <strong>{{ selectedTurn.aiBrain.scenarioTypeResolved }}</strong>
          </span>
        </div>
        
        <div class="routing-row">
          <span class="label">Reply Strategy (Config):</span>
          <span class="value">{{ selectedTurn.aiBrain.replyStrategyResolved }}</span>
        </div>
      </div>
    </div>
    
    <!-- RESPONSE ENGINE DECISION -->
    <div class="section">
      <h5>Response Engine Decision</h5>
      <div class="detail-box">
        <div class="routing-row">
          <span class="label">Strategy Used:</span>
          <span class="value">
            <strong>{{ selectedTurn.aiBrain.responseStrategyUsed }}</strong>
          </span>
        </div>
        <p class="text-sm text-gray-600 mt-2">
          <strong>Final Response:</strong>
        </p>
        <p class="response-text">
          "{{ selectedTurn.aiBrain.responseText }}"
        </p>
      </div>
    </div>
    
    <!-- TIMING & PERFORMANCE -->
    <div class="section">
      <h5>Timing & Performance</h5>
      <div class="detail-box">
        <div class="routing-row">
          <span class="label">AI Brain Time:</span>
          <span class="value">{{ selectedTurn.timing.aiBrainTimeMs }}ms</span>
        </div>
        <div class="routing-row">
          <span class="label">Total Turn Time:</span>
          <span class="value">{{ selectedTurn.timing.totalTurnTimeMs }}ms</span>
        </div>
      </div>
    </div>
    
    <!-- FLAGS & WARNINGS -->
    <div v-if="hasWarnings(selectedTurn)" class="section">
      <h5>⚠️ Warnings & Issues</h5>
      <div class="detail-box">
        <div v-if="selectedTurn.flags.escalatedThisTurn" class="warning-item">
          <span class="icon">📞</span>
          <span>This turn triggered escalation to human</span>
        </div>
        
        <div v-if="selectedTurn.flags.nullResponse" class="warning-item error">
          <span class="icon">✗</span>
          <span>Response was NULL (no reply provided)</span>
        </div>
        
        <div v-if="selectedTurn.flags.lowConfidence" class="warning-item">
          <span class="icon">⚠</span>
          <span>Low confidence match (&lt; 0.5)</span>
        </div>
        
        <div v-if="selectedTurn.flags.configError" class="warning-item error">
          <span class="icon">⚠</span>
          <span>
            Config Issue: INFO_FAQ scenario using QUICK_ONLY strategy
            (may hide critical information)
          </span>
        </div>
      </div>
    </div>
  </div>
</div>

<style>
.details-panel {
  background: #fafafa;
  border-left: 1px solid #e0e0e0;
  padding: 16px;
  overflow-y: auto;
}

.section {
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid #e0e0e0;
}

.section:last-child {
  border-bottom: none;
}

.section h5 {
  margin: 0 0 12px 0;
  font-size: 14px;
  font-weight: 600;
  color: #2c3e50;
}

.detail-box {
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  padding: 12px;
}

.routing-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid #f0f0f0;
}

.routing-row:last-child {
  border-bottom: none;
}

.routing-row .label {
  font-weight: 600;
  color: #666;
  font-size: 13px;
}

.routing-row .value {
  text-align: right;
  font-size: 13px;
  color: #333;
}

.response-text {
  background: #f9f9f9;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  padding: 8px 12px;
  margin: 8px 0 0 0;
  font-style: italic;
  color: #555;
  font-size: 13px;
  line-height: 1.4;
}

.warning-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  color: #ff6b6b;
}

.warning-item.error {
  color: #d63031;
}

.warning-item .icon {
  font-size: 16px;
  flex-shrink: 0;
}
</style>
```

---

## 📱 Mobile Responsive

On mobile (<768px), stack vertically:

```html
<!-- Mobile: single column, full-width panels -->
<div class="trace-container mobile">
  <div class="header">...</div>
  <div class="timeline-panel">...</div>
  <div class="details-panel">...</div>
</div>

<style media="(max-width: 768px)">
  .trace-container {
    display: flex;
    flex-direction: column;
  }
  
  .timeline-panel {
    width: 100%;
    border-right: none;
    border-bottom: 2px solid #667eea;
    padding-bottom: 16px;
  }
  
  .details-panel {
    width: 100%;
    border-left: none;
  }
</style>
```

---

## 🔌 Frontend Integration (Vue.js example)

```vue
<template>
  <div class="call-trace-viewer">
    <!-- Header -->
    <div class="trace-header">
      <h2>Call Trace</h2>
      <div class="header-info">
        <span><strong>Company:</strong> {{ trace.companyName }}</span>
        <span><strong>Call ID:</strong> {{ trace.callId }}</span>
        <span><strong>Duration:</strong> {{ trace.totalDurationMs }}ms</span>
        <span :class="['badge', trace.finalOutcome]">
          {{ outcomeLabel(trace.finalOutcome) }}
        </span>
      </div>
    </div>
    
    <!-- Main layout -->
    <div class="trace-main">
      <!-- Timeline -->
      <div class="timeline-panel">
        <h3>Conversation ({{ trace.turns.length }} turns)</h3>
        <div class="timeline-list">
          <div 
            v-for="(turn, idx) in trace.turns"
            :key="idx"
            class="timeline-turn"
            :class="{ selected: selectedIdx === idx }"
            @click="selectedIdx = idx"
          >
            <div class="turn-text">
              <p><strong>👤</strong> {{ truncate(turn.userInput.text, 50) }}</p>
              <p><strong>🤖</strong> {{ truncate(turn.aiBrain.responseText, 50) }}</p>
            </div>
            <div class="turn-tags">
              <span class="tag" :class="'tier-' + turn.aiBrain.tierUsed">
                Tier {{ turn.aiBrain.tierUsed }}
              </span>
              <span class="tag">{{ turn.aiBrain.scenarioTypeResolved }}</span>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Details -->
      <div class="details-panel">
        <template v-if="selectedIdx !== null">
          <h3>Turn {{ selectedTurn.turnIndex }} Details</h3>
          
          <!-- Routing -->
          <div class="detail-section">
            <h5>Routing</h5>
            <p><strong>Tier:</strong> {{ selectedTurn.aiBrain.tierUsed }}</p>
            <p><strong>Scenario:</strong> {{ selectedTurn.aiBrain.scenarioName }}</p>
            <p><strong>Type:</strong> {{ selectedTurn.aiBrain.scenarioTypeResolved }}</p>
            <p><strong>Strategy Used:</strong> {{ selectedTurn.aiBrain.responseStrategyUsed }}</p>
          </div>
          
          <!-- Timing -->
          <div class="detail-section">
            <h5>Timing</h5>
            <p><strong>AI Brain:</strong> {{ selectedTurn.timing.aiBrainTimeMs }}ms</p>
            <p><strong>Total:</strong> {{ selectedTurn.timing.totalTurnTimeMs }}ms</p>
          </div>
          
          <!-- Warnings -->
          <div v-if="selectedTurn.flags.configError" class="warning">
            ⚠️ Config Warning: INFO_FAQ with QUICK_ONLY strategy
          </div>
        </template>
        <div v-else class="empty-state">
          Click a turn to see details
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  data() {
    return {
      selectedIdx: null,
      trace: null
    };
  },
  computed: {
    selectedTurn() {
      return this.selectedIdx !== null ? this.trace.turns[this.selectedIdx] : null;
    }
  },
  methods: {
    truncate(text, length) {
      return text && text.length > length ? text.substring(0, length) + '...' : text;
    },
    outcomeLabel(outcome) {
      const labels = {
        ai_resolved: '✓ AI Resolved',
        escalated_to_human: '⚠ Escalated',
        caller_hung_up: '✗ Hung Up',
        error: '✗ Error'
      };
      return labels[outcome] || outcome;
    }
  },
  mounted() {
    // Fetch trace from API
    const callId = this.$route.params.callId;
    fetch(`/admin/call-traces/${callId}`)
      .then(r => r.json())
      .then(data => { this.trace = data; });
  }
};
</script>

<style scoped>
.call-trace-viewer {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: white;
}

.trace-header {
  padding: 16px;
  border-bottom: 2px solid #667eea;
  background: #f9f9f9;
}

.trace-main {
  display: grid;
  grid-template-columns: 1fr 1.5fr;
  gap: 0;
  flex: 1;
  overflow: hidden;
}

.timeline-panel {
  border-right: 1px solid #e0e0e0;
  padding: 16px;
  overflow-y: auto;
}

.details-panel {
  padding: 16px;
  overflow-y: auto;
  background: #fafafa;
}

.timeline-turn {
  padding: 12px;
  margin: 8px 0;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.timeline-turn:hover {
  background: #f5f5f5;
  border-color: #667eea;
}

.timeline-turn.selected {
  background: #f0f4ff;
  border-color: #667eea;
  border-width: 2px;
}

@media (max-width: 768px) {
  .trace-main {
    grid-template-columns: 1fr;
  }
  
  .timeline-panel {
    border-right: none;
    border-bottom: 1px solid #e0e0e0;
  }
}
</style>
```

---

## ✅ What This Gives You

- ✅ **Transparency:** Clients/support can see exactly why AI said what it said
- ✅ **Defensibility:** "Here's the decision matrix we used, here's your scenario config"
- ✅ **Debugging:** Fast root cause analysis (config error, low confidence, null response)
- ✅ **Sales Tool:** Enterprise prospects see professional, auditable AI
- ✅ **Data Source:** Every detail needed for monitoring dashboard

---

**Status:** Copy-paste ready UI spec. Implement after CallTrace model is live.

