# 📊 Monitoring Dashboard Spec (v1)

**Purpose:** Real-time platform health at a glance. Answer: "Is the system working? Where is it breaking?"

---

## 🗂️ Data Model – `models/CompanyMetricsDaily.js`

```javascript
const mongoose = require('mongoose');

const dailyMetricsSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'v2Company',
    index: true
  },
  
  date: {
    type: String,  // YYYY-MM-DD format
    index: true
  },
  
  // Traffic volume
  totalCalls: Number,
  aiResolvedCalls: Number,
  escalatedCalls: Number,
  errorCalls: Number,
  nullResponseCalls: Number,
  
  // Tier breakdown
  tier1Hits: Number,
  tier2Hits: Number,
  tier3Hits: Number,
  
  // Cost
  tier3CostUsd: Number,
  
  // Response Engine
  infoFaqCalls: Number,
  actionFlowCalls: Number,
  systemAckCalls: Number,
  smallTalkCalls: Number,
  
  // Strategy distribution
  fullOnlyDecisions: Number,
  quickOnlyDecisions: Number,
  quickThenFullDecisions: Number,
  
  // Quality issues
  infoFaqQuickOnlyDecisions: Number,  // ⚠️ dangerous config
  incompleteScenarios: Number,        // scenarios with no fullReplies
  
  // Derived metrics
  escalationRate: Number,             // 0-1
  nullResponseRate: Number,           // 0-1
  tier3Percentage: Number,            // 0-1
  
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('CompanyMetricsDaily', dailyMetricsSchema);
```

---

## ⚙️ Aggregation Job

Run daily (or hourly) to roll up CallTrace into metrics:

```javascript
// scripts/aggregate-metrics.js
const CallTrace = require('../models/CallTrace');
const CompanyMetricsDaily = require('../models/CompanyMetricsDaily');

async function aggregateMetrics(dateStr) {
  // dateStr format: "2025-11-10"
  
  const startOfDay = new Date(`${dateStr}T00:00:00Z`);
  const endOfDay = new Date(`${dateStr}T23:59:59Z`);
  
  // Get all unique companies
  const companies = await CallTrace.distinct('companyId', {
    startedAt: { $gte: startOfDay, $lt: endOfDay }
  });
  
  for (const companyId of companies) {
    // Get all traces for this company on this day
    const traces = await CallTrace.find({
      companyId,
      startedAt: { $gte: startOfDay, $lt: endOfDay }
    });
    
    // Aggregate
    const metrics = {
      companyId,
      date: dateStr,
      totalCalls: traces.length,
      aiResolvedCalls: traces.filter(t => t.finalOutcome === 'ai_resolved').length,
      escalatedCalls: traces.filter(t => t.finalOutcome === 'escalated_to_human').length,
      errorCalls: traces.filter(t => t.finalOutcome === 'error').length,
      nullResponseCalls: traces.reduce((sum, t) => sum + t.stats.nullResponses, 0),
      
      tier1Hits: traces.reduce((sum, t) => sum + t.stats.tier1Hits, 0),
      tier2Hits: traces.reduce((sum, t) => sum + t.stats.tier2Hits, 0),
      tier3Hits: traces.reduce((sum, t) => sum + t.stats.tier3Hits, 0),
      tier3CostUsd: traces.reduce((sum, t) => sum + t.stats.totalLLMCostUsd, 0),
      
      infoFaqCalls: 0,     // TODO: count from turns
      actionFlowCalls: 0,
      systemAckCalls: 0,
      smallTalkCalls: 0,
      
      fullOnlyDecisions: 0,
      quickOnlyDecisions: 0,
      quickThenFullDecisions: 0,
      
      infoFaqQuickOnlyDecisions: 0,
      incompleteScenarios: 0
    };
    
    // Compute derived metrics
    metrics.escalationRate = metrics.totalCalls ? 
      metrics.escalatedCalls / metrics.totalCalls : 0;
    metrics.nullResponseRate = metrics.totalCalls ? 
      metrics.nullResponseCalls / metrics.totalCalls : 0;
    metrics.tier3Percentage = metrics.totalCalls ? 
      metrics.tier3Hits / metrics.totalCalls : 0;
    
    // Count scenario types and strategies from traces
    let infoFaq = 0, actionFlow = 0, systemAck = 0, smallTalk = 0;
    let fullOnly = 0, quickOnly = 0, quickThenFull = 0;
    let infoFaqQuick = 0;
    
    traces.forEach(trace => {
      trace.turns?.forEach(turn => {
        // Count types
        if (turn.aiBrain?.scenarioTypeResolved === 'INFO_FAQ') infoFaq++;
        if (turn.aiBrain?.scenarioTypeResolved === 'ACTION_FLOW') actionFlow++;
        if (turn.aiBrain?.scenarioTypeResolved === 'SYSTEM_ACK') systemAck++;
        if (turn.aiBrain?.scenarioTypeResolved === 'SMALL_TALK') smallTalk++;
        
        // Count strategies
        if (turn.aiBrain?.responseStrategyUsed === 'FULL_ONLY') fullOnly++;
        if (turn.aiBrain?.responseStrategyUsed === 'QUICK_ONLY') quickOnly++;
        if (turn.aiBrain?.responseStrategyUsed === 'QUICK_THEN_FULL') quickThenFull++;
        
        // Count dangerous config
        if (turn.flags?.configError) infoFaqQuick++;
      });
    });
    
    metrics.infoFaqCalls = infoFaq;
    metrics.actionFlowCalls = actionFlow;
    metrics.systemAckCalls = systemAck;
    metrics.smallTalkCalls = smallTalk;
    metrics.fullOnlyDecisions = fullOnly;
    metrics.quickOnlyDecisions = quickOnly;
    metrics.quickThenFullDecisions = quickThenFull;
    metrics.infoFaqQuickOnlyDecisions = infoFaqQuick;
    
    // Save or update
    await CompanyMetricsDaily.findOneAndUpdate(
      { companyId, date: dateStr },
      metrics,
      { upsert: true, new: true }
    );
  }
  
  console.log(`✅ Aggregated metrics for ${dateStr}`);
}

// Run: node scripts/aggregate-metrics.js 2025-11-10
const dateStr = process.argv[2] || new Date().toISOString().split('T')[0];
aggregateMetrics(dateStr);
```

---

## 📡 API Endpoints

```javascript
// routes/admin/metrics.js

// GET /admin/metrics/daily?companyId=...&dateFrom=...&dateTo=...
router.get('/metrics/daily', requireAuth, requireAdmin, async (req, res) => {
  const { companyId, dateFrom, dateTo } = req.query;
  
  const filter = {};
  if (companyId) filter.companyId = companyId;
  if (dateFrom || dateTo) {
    filter.date = {};
    if (dateFrom) filter.date.$gte = dateFrom;
    if (dateTo) filter.date.$lte = dateTo;
  }
  
  const metrics = await CompanyMetricsDaily.find(filter).sort({ date: -1 });
  res.json(metrics);
});

// GET /admin/metrics/summary?companyId=...
router.get('/metrics/summary', requireAuth, requireAdmin, async (req, res) => {
  const { companyId } = req.query;
  
  // Last 7 days summary
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  
  const metrics = await CompanyMetricsDaily.find({
    companyId: companyId ? mongoose.Types.ObjectId(companyId) : { $exists: true },
    createdAt: { $gte: sevenDaysAgo }
  });
  
  const summary = {
    totalCalls: metrics.reduce((s, m) => s + m.totalCalls, 0),
    aiResolved: metrics.reduce((s, m) => s + m.aiResolvedCalls, 0),
    escalated: metrics.reduce((s, m) => s + m.escalatedCalls, 0),
    tier3Cost: metrics.reduce((s, m) => s + m.tier3CostUsd, 0),
    avgEscalation: (metrics.reduce((s, m) => s + m.escalationRate, 0) / metrics.length) || 0
  };
  
  res.json(summary);
});
```

---

## 🎨 Dashboard Views

### View 1: Platform Overview (All Companies)

```html
<div class="dashboard-platform-overview">
  <h2>Platform Overview</h2>
  
  <!-- Key metrics cards -->
  <div class="metrics-grid">
    <div class="metric-card">
      <p class="label">Total Calls (24h)</p>
      <p class="value">{{ totalCalls }}</p>
      <p class="trend">↑ 12% vs yesterday</p>
    </div>
    
    <div class="metric-card">
      <p class="label">AI Resolved</p>
      <p class="value">{{ aiResolvedPercent }}%</p>
      <p class="trend" :class="{ good: aiResolvedPercent > 85 }">
        {{ aiResolvedPercent > 85 ? '✓ Good' : '⚠ Watch' }}
      </p>
    </div>
    
    <div class="metric-card">
      <p class="label">Escalation Rate</p>
      <p class="value">{{ escalationRate }}%</p>
      <p class="trend" :class="{ good: escalationRate < 15 }">
        {{ escalationRate < 15 ? '✓ Target' : '⚠ High' }}
      </p>
    </div>
    
    <div class="metric-card">
      <p class="label">Tier 3 Cost (24h)</p>
      <p class="value">${{ tier3Cost.toFixed(2) }}</p>
      <p class="trend">{{ tier3Percentage }}% of calls</p>
    </div>
  </div>
  
  <!-- Tier usage pie chart -->
  <div class="chart-section">
    <h4>Tier Usage Distribution</h4>
    <canvas ref="tierChart"></canvas>
    <!-- Show: Tier 1 (80%), Tier 2 (14%), Tier 3 (6%) -->
  </div>
  
  <!-- Alerts section -->
  <div class="alerts-section">
    <h4>⚠️ Active Alerts</h4>
    <div v-for="alert in alerts" :key="alert.id" class="alert" :class="alert.severity">
      <p><strong>{{ alert.company }}</strong>: {{ alert.message }}</p>
      <p class="time">{{ alert.timestamp }}</p>
    </div>
  </div>
  
  <!-- Top companies table -->
  <div class="table-section">
    <h4>Top Companies by Volume</h4>
    <table>
      <thead>
        <tr>
          <th>Company</th>
          <th>Calls (24h)</th>
          <th>Escalation %</th>
          <th>Tier 3 Cost</th>
          <th>Null %</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="company in topCompanies" :key="company.id">
          <td><router-link :to="`/dashboard/company/${company.id}`">{{ company.name }}</router-link></td>
          <td>{{ company.totalCalls }}</td>
          <td :class="{ 'red': company.escalationRate > 0.15 }">
            {{ (company.escalationRate * 100).toFixed(1) }}%
          </td>
          <td>${{ company.tier3Cost.toFixed(2) }}</td>
          <td :class="{ 'red': company.nullResponseRate > 0.02 }">
            {{ (company.nullResponseRate * 100).toFixed(1) }}%
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
```

---

### View 2: Company Deep-Dive

```html
<div class="dashboard-company-detail">
  <h2>{{ companyName }}</h2>
  
  <!-- Date range selector -->
  <div class="controls">
    <button @click="dateRange = 'today'">Today</button>
    <button @click="dateRange = '7day'">7 Days</button>
    <button @click="dateRange = '30day'">30 Days</button>
    <input type="date" v-model="customDate">
  </div>
  
  <!-- Summary cards for this company -->
  <div class="metrics-grid">
    <div class="metric-card">
      <p class="label">Total Calls</p>
      <p class="value">{{ companyMetrics.totalCalls }}</p>
    </div>
    
    <div class="metric-card">
      <p class="label">AI Resolved</p>
      <p class="value">{{ aiResolvedPercent }}%</p>
    </div>
    
    <div class="metric-card">
      <p class="label">Escalations</p>
      <p class="value">{{ companyMetrics.escalatedCalls }}</p>
    </div>
    
    <div class="metric-card">
      <p class="label">Tier 3 Cost</p>
      <p class="value">${{ companyMetrics.tier3CostUsd }}</p>
    </div>
  </div>
  
  <!-- Calls per day line chart -->
  <div class="chart-section">
    <h4>Calls per Day</h4>
    <canvas ref="callsChart"></canvas>
  </div>
  
  <!-- Tier distribution bar chart -->
  <div class="chart-section">
    <h4>Tier Usage Over Time</h4>
    <canvas ref="tierStackedChart"></canvas>
  </div>
  
  <!-- Response strategies pie -->
  <div class="chart-section">
    <h4>Response Strategy Distribution</h4>
    <canvas ref="strategyChart"></canvas>
    <!-- FULL_ONLY vs QUICK_ONLY vs QUICK_THEN_FULL -->
  </div>
  
  <!-- Scenario breakdown table -->
  <div class="table-section">
    <h4>Top Scenarios</h4>
    <table>
      <thead>
        <tr>
          <th>Scenario Name</th>
          <th>Type</th>
          <th>Calls</th>
          <th>Escalations</th>
          <th>Null %</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="scenario in topScenarios" :key="scenario.id">
          <td>{{ scenario.name }}</td>
          <td>{{ scenario.type }}</td>
          <td>{{ scenario.calls }}</td>
          <td>{{ scenario.escalations }}</td>
          <td :class="{ 'red': scenario.nullRate > 0.02 }">
            {{ (scenario.nullRate * 100).toFixed(1) }}%
          </td>
          <td>
            <router-link :to="`/scenarios/${scenario.id}`">Edit</router-link>
            <router-link :to="`/dashboard/traces?scenario=${scenario.id}`">Traces</router-link>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
```

---

### View 3: Alerts & Issues

```html
<div class="dashboard-alerts">
  <h2>Active Alerts</h2>
  
  <!-- Alert severity levels -->
  <div class="alert-filters">
    <button v-for="severity in ['critical', 'warning', 'info']" 
            :key="severity"
            @click="filterSeverity = severity"
            :class="{ active: filterSeverity === severity }">
      {{ severity.toUpperCase() }}
    </button>
  </div>
  
  <!-- Alerts list -->
  <div class="alerts-list">
    <div v-for="alert in filteredAlerts" :key="alert.id" 
         class="alert-item" :class="alert.severity">
      
      <div class="alert-header">
        <h4>{{ alert.title }}</h4>
        <span class="time">{{ formatTime(alert.timestamp) }}</span>
      </div>
      
      <p class="alert-description">{{ alert.description }}</p>
      
      <div class="alert-details">
        <p><strong>Company:</strong> {{ alert.companyName }}</p>
        <p><strong>Metric:</strong> {{ alert.metric }}</p>
        <p><strong>Value:</strong> {{ alert.value }}</p>
        <p><strong>Threshold:</strong> {{ alert.threshold }}</p>
      </div>
      
      <div class="alert-actions">
        <router-link :to="`/dashboard/company/${alert.companyId}`">View Company</router-link>
        <button @click="dismissAlert(alert.id)">Dismiss</button>
      </div>
    </div>
  </div>
</div>
```

---

## 🚨 Alert Rules (Triggers)

```javascript
const alertRules = [
  {
    name: 'High Escalation Rate',
    check: (metrics) => metrics.escalationRate > 0.15,
    severity: 'warning',
    message: (m) => `Escalation rate ${(m.escalationRate * 100).toFixed(1)}% (target < 15%)`
  },
  {
    name: 'High Null Response Rate',
    check: (metrics) => metrics.nullResponseRate > 0.02,
    severity: 'critical',
    message: (m) => `${(m.nullResponseRate * 100).toFixed(1)}% null responses`
  },
  {
    name: 'Tier 3 Cost Spike',
    check: (metrics) => metrics.tier3CostUsd > 50,
    severity: 'warning',
    message: (m) => `Tier 3 cost ${m.tier3CostUsd.toFixed(2)} USD (daily threshold: $50)`
  },
  {
    name: 'Dangerous Config Detected',
    check: (metrics) => metrics.infoFaqQuickOnlyDecisions > 0,
    severity: 'critical',
    message: (m) => `${m.infoFaqQuickOnlyDecisions} INFO_FAQ calls using QUICK_ONLY strategy`
  }
];
```

---

## ✅ What You Get

- ✅ Real-time platform health visibility
- ✅ Per-company performance tracking
- ✅ Automatic alert triggers
- ✅ Cost accountability (Tier 3 LLM)
- ✅ Quality metrics (escalation, null rates)
- ✅ Data for business decisions (which companies, scenarios to improve)

---

**Status:** Copy-paste ready spec. Implement after CallTrace is stable (1-2 weeks).

