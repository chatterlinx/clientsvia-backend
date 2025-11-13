# 🔄 CALL FLOW TAB - COMPLETE SPECIFICATION
## Enterprise Call Processing Sequence Manager

**Last Updated:** 2025-11-13  
**Priority:** CRITICAL - Core Platform Feature  
**Location:** AiCore Control Center → "Call Flow" Tab (right of Cheat Sheet)

---

## 🎯 **WHY THIS TAB EXISTS**

### **Problem Statement:**
Different companies need COMPLETELY different call flows:

1. **Full AI Company** (HVAC, Dental, etc.)
   - Needs: Full 3-tier AI, scenarios, LLM fallback
   - Cost: $0.001-0.50 per call
   - Time: 50-900ms avg

2. **Simple Call Forwarder** (Law firm, small business)
   - Needs: Spam filter + immediate human transfer
   - Cost: $0.00 per call
   - Time: 5-20ms avg

3. **Hybrid Company** (Medical office)
   - Needs: Edge cases + basic routing + human escalation
   - Cost: $0.00-0.05 per call
   - Time: 20-100ms avg

### **Solution:**
Per-company customizable call flow with **real-time cost/time impact analysis**.

---

## 📐 **PAGE LAYOUT (Full Design)**

```
┌───────────────────────────────────────────────────────────────────────────┐
│ 🔄 CALL FLOW DESIGNER                                                     │
│ Control how your AI agent processes incoming calls                       │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ 📊 CURRENT PERFORMANCE (Last 30 Days)                               │ │
│ ├─────────────────────────────────────────────────────────────────────┤ │
│ │                                                                     │ │
│ │  📞 Total Calls: 1,247                                              │ │
│ │  ⚡ Avg Response Time: 68ms                                         │ │
│ │  💰 Avg Cost Per Call: $0.003                                       │ │
│ │  📈 Monthly Total: $3.74                                            │ │
│ │                                                                     │ │
│ │  ┌─────────────────────────────────────────────────────────────┐   │ │
│ │  │ Response Time Distribution                                  │   │ │
│ │  │ ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇░░░░  0-100ms:   892 (71.5%) ✅         │   │ │
│ │  │ ▇▇▇▇▇▇▇░░░░░░░░░░░░░░  100-300ms:  267 (21.4%) ✅         │   │ │
│ │  │ ▇▇░░░░░░░░░░░░░░░░░░░  300-500ms:   51 ( 4.1%) ⚠️         │   │ │
│ │  │ ▇░░░░░░░░░░░░░░░░░░░░  500ms+:      37 ( 3.0%) 🔴         │   │ │
│ │  └─────────────────────────────────────────────────────────────┘   │ │
│ │                                                                     │ │
│ │  [📈 View Detailed Analytics]  [📊 Export Report]                  │ │
│ │                                                                     │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ 🎯 QUICK PRESETS (Click to apply)                                   │ │
│ ├─────────────────────────────────────────────────────────────────────┤ │
│ │                                                                     │ │
│ │  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐   │ │
│ │  │ 🤖 Full AI        │ │ 📞 Call Forward  │ │ 🔀 Hybrid Mode   │   │ │
│ │  │                  │ │                  │ │                  │   │ │
│ │  │ Time: ~68ms      │ │ Time: ~12ms      │ │ Time: ~45ms      │   │ │
│ │  │ Cost: $0.003     │ │ Cost: $0.00      │ │ Cost: $0.001     │   │ │
│ │  │                  │ │                  │ │                  │   │ │
│ │  │ Best for:        │ │ Best for:        │ │ Best for:        │   │ │
│ │  │ • HVAC           │ │ • Law firms      │ │ • Medical        │   │ │
│ │  │ • Dental         │ │ • Real estate    │ │ • Multi-location │   │ │
│ │  │ • Plumbing       │ │ • Small biz      │ │ • Restaurants    │   │ │
│ │  │                  │ │                  │ │                  │   │ │
│ │  │ [Apply Preset]   │ │ [Apply Preset]   │ │ [Apply Preset]   │   │ │
│ │  └──────────────────┘ └──────────────────┘ └──────────────────┘   │ │
│ │                                                                     │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ 🔄 PROCESSING SEQUENCE                                               │ │
│ │ Drag steps or use arrows to reorder                                 │ │
│ ├─────────────────────────────────────────────────────────────────────┤ │
│ │                                                                     │ │
│ │  ⚡ LAYER 0 (Always First)                                          │ │
│ │  ┌─────────────────────────────────────────────────────────────┐   │ │
│ │  │ 🚫 Spam Filter                                    MANDATORY  │   │ │
│ │  │ Phone number blacklist/whitelist check                      │   │ │
│ │  │ Time: ~2ms  |  Cost: $0.00  |  Blocks: 12 calls/month       │   │ │
│ │  │ [⚙️ Configure Blacklist]                                     │   │ │
│ │  └─────────────────────────────────────────────────────────────┘   │ │
│ │                           ↓                                         │ │
│ │                                                                     │ │
│ │  📋 CUSTOM SEQUENCE (Reorderable)                                   │ │
│ │  ──────────────────────────────────────────────────────────────    │ │
│ │                                                                     │ │
│ │  Step  Name              Status    Time      Impact    Actions    │ │
│ │  ────  ───────────────── ───────── ───────── ────────  ────────   │ │
│ │                                                                     │ │
│ │  1.    🚨 Edge Cases      ☑️ Enabled  ~10ms    ⚡ Fast   [⚙️] [↓]   │ │
│ │        AI spam, robocalls                    🚀 Saves $          │ │
│ │        │                                                          │ │
│ │        └─ Current: 125 short-circuits/month (10% of calls)       │ │
│ │           Saves: ~$62.50/month by skipping AI                    │ │
│ │                                                                     │ │
│ │  2.    📞 Transfer Rules  ☑️ Enabled  ~15ms    ⚡ Fast   [⚙️] [↑↓]  │ │
│ │        Emergency, billing routing            🚀 Saves $          │ │
│ │        │                                                          │ │
│ │        └─ Current: 78 transfers/month (6% of calls)              │ │
│ │           Saves: ~$39.00/month by bypassing scenarios            │ │
│ │                                                                     │ │
│ │  3.    🎯 AI Response     ☑️ Enabled  ~12-800ms ⚠️ Variable [⚙️] [↑↓] │ │
│ │        3-Tier Intelligence                   💰 Costs $          │ │
│ │        │                                                          │ │
│ │        ├─ Tier 1: Keywords    ~12ms  (70% hit) ✅ FREE           │ │
│ │        ├─ Tier 2: Semantic    ~45ms  (25% hit) ✅ FREE           │ │
│ │        └─ Tier 3: LLM        ~800ms  ( 5% hit) 💰 $0.003         │ │
│ │                                                                     │ │
│ │           Current: 37 LLM calls/month (3% of calls)               │ │
│ │           Cost: ~$0.11/month                                      │ │
│ │                                                                     │ │
│ │  4.    🛡️ Guardrails     ☑️ Enabled  ~8ms     ⚡ Fast   [⚙️] [↑↓]  │ │
│ │        Content filtering (prices, phone #s)                       │ │
│ │        │                                                          │ │
│ │        └─ Current: 23 violations blocked/month                    │ │
│ │                                                                     │ │
│ │  5.    🎨 Behavior Polish ☑️ Enabled  ~3ms     ⚡ Fast   [⚙️] [↑]   │ │
│ │        Text transformation (ACK_OK, etc.)                         │ │
│ │        │                                                          │ │
│ │        └─ Current: Applied to 100% of responses                   │ │
│ │                                                                     │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ 📊 IMPACT ANALYSIS (If you save changes)                            │ │
│ ├─────────────────────────────────────────────────────────────────────┤ │
│ │                                                                     │ │
│ │  Current Configuration:                                             │ │
│ │  ────────────────────────────────────────────────────────────────  │ │
│ │  Avg Response Time:  68ms         ✅ EXCELLENT                      │ │
│ │  P95 Response Time:  215ms        ✅ GOOD                           │ │
│ │  P99 Response Time:  1024ms       ⚠️ ACCEPTABLE                     │ │
│ │  Avg Cost Per Call:  $0.003       ✅ EXCELLENT                      │ │
│ │  Monthly Cost:       $3.74        ✅ LOW                            │ │
│ │                                                                     │ │
│ │  📈 Efficiency Score: 92/100 (Excellent)                            │ │
│ │                                                                     │ │
│ │  ┌─────────────────────────────────────────────────────────────┐   │ │
│ │  │ 💡 OPTIMIZATION SUGGESTIONS                                  │   │ │
│ │  │                                                              │   │ │
│ │  │ ✅ Your flow is optimized! Current setup:                    │   │ │
│ │  │    • Edge Cases block spam early (saves money)              │   │ │
│ │  │    • Transfer Rules bypass scenarios (saves time)           │   │ │
│ │  │    • Tier 1 catches 70% of calls (fast & free)              │   │ │
│ │  │    • LLM usage is minimal (3% fallback rate)                │   │ │
│ │  │                                                              │   │ │
│ │  │ 🔍 Potential Improvements:                                   │   │ │
│ │  │    • Add 3 more keywords to "AC Repair" scenario            │   │ │
│ │  │      (Could reduce Tier 3 usage by 15%)                     │   │ │
│ │  │    • Train Q&A pairs for common questions                   │   │ │
│ │  │      (Could improve Tier 2 hit rate to 30%)                 │   │ │
│ │  │                                                              │   │ │
│ │  │ [View Detailed Recommendations]                              │   │ │
│ │  └─────────────────────────────────────────────────────────────┘   │ │
│ │                                                                     │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ ⚠️ WARNINGS & ALERTS                                                 │ │
│ ├─────────────────────────────────────────────────────────────────────┤ │
│ │                                                                     │ │
│ │  (No warnings - your configuration looks good!)                     │ │
│ │                                                                     │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  [💾 Save Flow Configuration]  [🔄 Reset to Default]  [🧪 Test Flow]     │
│  [📖 View Documentation]  [📊 Export Performance Report]                 │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## ⚠️ **WARNING SYSTEM (Real-Time Validation)**

### **Example 1: Moving Edge Cases AFTER AI**

```
┌─────────────────────────────────────────────────────────────┐
│ ⚠️ PERFORMANCE WARNING                                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  You moved "Edge Cases" AFTER "AI Response"                │
│                                                             │
│  Impact:                                                    │
│  ────────────────────────────────────────────────────────  │
│  📈 Avg Response Time: +45ms (68ms → 113ms)                │
│  💰 Monthly Cost: +$62.50 ($3.74 → $66.24)                 │
│                                                             │
│  Why?                                                       │
│  Spam calls will now hit expensive AI first before being   │
│  detected as spam. Edge Cases currently block 125          │
│  calls/month (10%) early, saving $0.50 each.               │
│                                                             │
│  Recommended: Keep Edge Cases BEFORE AI Response           │
│                                                             │
│  [Revert Change] [Continue Anyway] [Learn More]            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### **Example 2: Disabling Spam Filter**

```
┌─────────────────────────────────────────────────────────────┐
│ 🚫 CRITICAL ERROR                                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  You cannot disable "Spam Filter"                          │
│                                                             │
│  Reason:                                                    │
│  The spam filter is a mandatory security layer that        │
│  protects your account from malicious callers and          │
│  prevents abuse.                                            │
│                                                             │
│  If you need to allow a blocked number, add it to the      │
│  whitelist in Spam Filter settings.                        │
│                                                             │
│  [OK] [Configure Whitelist]                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### **Example 3: Slow Configuration Detected**

```
┌─────────────────────────────────────────────────────────────┐
│ ⚠️ SLOW CONFIGURATION WARNING                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Your current flow has a P99 response time of 1024ms       │
│                                                             │
│  This means 1% of callers wait over 1 second for a        │
│  response, which may feel sluggish.                        │
│                                                             │
│  Causes:                                                    │
│  • 37 LLM calls/month (Tier 3 fallback rate: 3%)          │
│  • Avg LLM response time: 800ms                            │
│                                                             │
│  Suggestions:                                               │
│  ✅ Add more keywords to popular scenarios                  │
│  ✅ Train Q&A pairs for common questions                    │
│  ✅ Review failed Tier 1/2 matches in logs                  │
│                                                             │
│  [View Optimization Guide] [Dismiss]                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 🎯 **PRESET CONFIGURATIONS**

### **Preset 1: Full AI (HVAC, Dental, Plumbing)**

```javascript
{
  name: "Full AI - Complete Automation",
  description: "Maximum AI intelligence for handling all calls automatically",
  flowSequence: [
    { step: 'spam_filter', priority: 0, enabled: true },
    { step: 'edge_cases', priority: 1, enabled: true },
    { step: 'transfer_rules', priority: 2, enabled: true },
    { step: 'ai_routing', priority: 3, enabled: true },
    { step: 'guardrails', priority: 4, enabled: true },
    { step: 'behavior_rules', priority: 5, enabled: true }
  ],
  estimatedResponseTime: "68ms avg",
  estimatedCostPerCall: "$0.003",
  idealFor: ["HVAC", "Dental", "Plumbing", "Electrical", "General Contractors"]
}
```

### **Preset 2: Call Forward (Law Firms, Small Business)**

```javascript
{
  name: "Call Forward - Human Touch",
  description: "Spam filter + immediate human transfer (no AI)",
  flowSequence: [
    { step: 'spam_filter', priority: 0, enabled: true },
    { step: 'edge_cases', priority: 1, enabled: false },     // DISABLED
    { step: 'transfer_rules', priority: 2, enabled: true },  // IMMEDIATE TRANSFER
    { step: 'ai_routing', priority: 3, enabled: false },     // DISABLED
    { step: 'guardrails', priority: 4, enabled: false },     // DISABLED
    { step: 'behavior_rules', priority: 5, enabled: false }  // DISABLED
  ],
  estimatedResponseTime: "12ms avg",
  estimatedCostPerCall: "$0.00",
  idealFor: ["Law Firms", "Real Estate", "Financial Advisors", "Consultants"]
}
```

### **Preset 3: Hybrid (Medical, Multi-Location)**

```javascript
{
  name: "Hybrid - Smart Routing",
  description: "Basic AI + human escalation for complex cases",
  flowSequence: [
    { step: 'spam_filter', priority: 0, enabled: true },
    { step: 'edge_cases', priority: 1, enabled: true },
    { step: 'transfer_rules', priority: 2, enabled: true },
    { step: 'ai_routing', priority: 3, enabled: true },      // Tier 1 & 2 only
    { step: 'guardrails', priority: 4, enabled: true },
    { step: 'behavior_rules', priority: 5, enabled: false }  // DISABLED (human touch)
  ],
  advancedSettings: {
    disableLLMFallback: true,  // Force transfer if Tier 1/2 miss
    maxResponseTime: 100       // ms
  },
  estimatedResponseTime: "45ms avg",
  estimatedCostPerCall: "$0.001",
  idealFor: ["Medical Offices", "Multi-Location Businesses", "Restaurants"]
}
```

---

## 📊 **BACKEND CALCULATION LOGIC**

### **Performance Calculator Service**

```javascript
// services/CallFlowAnalyzer.js

class CallFlowAnalyzer {
    
    /**
     * Calculate estimated performance for a given flow configuration
     */
    async calculatePerformanceEstimate(companyId, flowSequence) {
        const company = await Company.findById(companyId);
        const callLogs = await CallLog.find({ companyId })
            .sort({ timestamp: -1 })
            .limit(1000); // Last 1000 calls
        
        const estimates = {
            avgResponseTime: 0,
            p95ResponseTime: 0,
            p99ResponseTime: 0,
            avgCostPerCall: 0,
            monthlyCost: 0,
            breakdown: {
                spamFilterTime: 2,
                edgeCaseTime: 10,
                transferRuleTime: 15,
                aiRoutingTime: 0, // calculated
                guardrailTime: 8,
                behaviorTime: 3
            },
            hitRates: {
                edgeCaseShortCircuits: 0,
                transferRuleMatches: 0,
                tier1Hits: 0,
                tier2Hits: 0,
                tier3Fallbacks: 0
            },
            warnings: [],
            suggestions: []
        };
        
        // Calculate AI Routing time based on historical hit rates
        const tier1HitRate = this.calculateTier1HitRate(callLogs);
        const tier2HitRate = this.calculateTier2HitRate(callLogs);
        const tier3HitRate = this.calculateTier3HitRate(callLogs);
        
        estimates.breakdown.aiRoutingTime = 
            (tier1HitRate * 12) +    // 12ms for Tier 1
            (tier2HitRate * 45) +    // 45ms for Tier 2
            (tier3HitRate * 800);    // 800ms for Tier 3
        
        // Calculate total response time based on sequence
        estimates.avgResponseTime = this.calculateTotalTime(flowSequence, estimates.breakdown);
        
        // Calculate cost
        estimates.avgCostPerCall = tier3HitRate * 0.003; // $0.003 per LLM call
        estimates.monthlyCost = estimates.avgCostPerCall * company.avgCallsPerMonth;
        
        // Generate warnings
        estimates.warnings = this.generateWarnings(flowSequence, estimates);
        
        // Generate optimization suggestions
        estimates.suggestions = this.generateSuggestions(callLogs, estimates);
        
        return estimates;
    }
    
    /**
     * Compare two flow configurations and show impact
     */
    async compareFlows(currentFlow, proposedFlow, companyId) {
        const current = await this.calculatePerformanceEstimate(companyId, currentFlow);
        const proposed = await this.calculatePerformanceEstimate(companyId, proposedFlow);
        
        return {
            current,
            proposed,
            delta: {
                responseTime: proposed.avgResponseTime - current.avgResponseTime,
                cost: proposed.monthlyCost - current.monthlyCost,
                percentChange: {
                    responseTime: ((proposed.avgResponseTime - current.avgResponseTime) / current.avgResponseTime) * 100,
                    cost: ((proposed.monthlyCost - current.monthlyCost) / current.monthlyCost) * 100
                }
            },
            impact: this.assessImpact(current, proposed)
        };
    }
    
    /**
     * Generate warnings based on flow configuration
     */
    generateWarnings(flowSequence, estimates) {
        const warnings = [];
        
        // Warning 1: Edge Cases after AI
        const edgeCaseStep = flowSequence.find(s => s.step === 'edge_cases');
        const aiRoutingStep = flowSequence.find(s => s.step === 'ai_routing');
        
        if (edgeCaseStep && aiRoutingStep && 
            edgeCaseStep.priority > aiRoutingStep.priority) {
            warnings.push({
                level: 'warning',
                title: 'Edge Cases After AI',
                message: 'Moving Edge Cases after AI Response will increase costs. Spam calls will hit expensive AI first.',
                estimatedImpact: {
                    costIncrease: estimates.hitRates.edgeCaseShortCircuits * 0.003 * 30, // monthly
                    timeIncrease: 45 // ms avg
                }
            });
        }
        
        // Warning 2: Slow response time
        if (estimates.p99ResponseTime > 1000) {
            warnings.push({
                level: 'warning',
                title: 'Slow P99 Response Time',
                message: '1% of callers wait over 1 second for a response. Consider optimizing scenarios.',
                recommendations: [
                    'Add more keywords to popular scenarios',
                    'Train Q&A pairs for common questions',
                    'Review failed Tier 1/2 matches in logs'
                ]
            });
        }
        
        // Warning 3: High LLM usage
        if (estimates.hitRates.tier3Fallbacks > 0.10) {
            warnings.push({
                level: 'info',
                title: 'High LLM Fallback Rate',
                message: `${(estimates.hitRates.tier3Fallbacks * 100).toFixed(1)}% of calls use expensive Tier 3 LLM.`,
                recommendations: [
                    'Review LLM call logs to identify patterns',
                    'Add missing keywords or Q&A pairs',
                    'Consider adding edge cases for common misses'
                ]
            });
        }
        
        return warnings;
    }
    
    /**
     * Generate optimization suggestions
     */
    generateSuggestions(callLogs, estimates) {
        const suggestions = [];
        
        // Analyze recent Tier 3 calls to find patterns
        const tier3Calls = callLogs.filter(log => log.routingSource === 'tier3-llm');
        
        if (tier3Calls.length > 0) {
            // Cluster similar inputs
            const clusters = this.clusterSimilarInputs(tier3Calls);
            
            clusters.forEach(cluster => {
                if (cluster.count > 5) {
                    suggestions.push({
                        type: 'add_keywords',
                        title: `Add keywords for "${cluster.commonPhrase}"`,
                        message: `${cluster.count} calls matched this pattern via LLM. Adding keywords could reduce costs.`,
                        estimatedSavings: cluster.count * 0.003 * 4 // monthly savings
                    });
                }
            });
        }
        
        return suggestions;
    }
}

module.exports = new CallFlowAnalyzer();
```

---

## 🎨 **FRONTEND IMPLEMENTATION**

### **Tab Navigation Update**

```javascript
// public/js/ai-agent-settings/AIAgentSettingsManager.js

// Add to sub-tab navigation
const subTabs = [
    'aicore-overview',
    'aicore-live-scenarios',
    'aicore-cheat-sheet',
    'aicore-call-flow'  // ← NEW TAB
];

async loadSubTab(tabName) {
    switch (tabName) {
        case 'aicore-call-flow':
            await this.loadCallFlowTab();
            break;
        // ... other cases
    }
}

async loadCallFlowTab() {
    console.log('🔄 [CALL FLOW] Loading tab...');
    
    if (!window.callFlowManager) {
        window.callFlowManager = new CallFlowManager();
    }
    
    await window.callFlowManager.load(this.companyId);
}
```

### **Call Flow Manager**

```javascript
// public/js/ai-agent-settings/CallFlowManager.js

class CallFlowManager {
    constructor() {
        this.companyId = null;
        this.flowSequence = [];
        this.performanceData = null;
        this.isDirty = false;
    }
    
    async load(companyId) {
        this.companyId = companyId;
        
        try {
            // Load current flow configuration
            const response = await fetch(`/api/admin/call-flow/${companyId}`, {
                headers: {
                    'Authorization': `Bearer ${getAuthToken()}`
                }
            });
            
            const data = await response.json();
            
            this.flowSequence = data.flowSequence;
            this.performanceData = data.performanceData;
            
            this.render();
            
        } catch (error) {
            console.error('❌ [CALL FLOW] Load failed:', error);
            showNotification('Failed to load call flow configuration', 'error');
        }
    }
    
    render() {
        // Render performance dashboard
        this.renderPerformanceDashboard();
        
        // Render presets
        this.renderPresets();
        
        // Render flow sequence
        this.renderFlowSequence();
        
        // Render impact analysis
        this.renderImpactAnalysis();
        
        // Render warnings
        this.renderWarnings();
    }
    
    async applyPreset(presetName) {
        const presets = {
            'full_ai': {
                name: "Full AI - Complete Automation",
                flowSequence: [
                    { step: 'edge_cases', priority: 1, enabled: true },
                    { step: 'transfer_rules', priority: 2, enabled: true },
                    { step: 'ai_routing', priority: 3, enabled: true },
                    { step: 'guardrails', priority: 4, enabled: true },
                    { step: 'behavior_rules', priority: 5, enabled: true }
                ]
            },
            'call_forward': {
                name: "Call Forward - Human Touch",
                flowSequence: [
                    { step: 'edge_cases', priority: 1, enabled: false },
                    { step: 'transfer_rules', priority: 2, enabled: true },
                    { step: 'ai_routing', priority: 3, enabled: false },
                    { step: 'guardrails', priority: 4, enabled: false },
                    { step: 'behavior_rules', priority: 5, enabled: false }
                ]
            },
            'hybrid': {
                name: "Hybrid - Smart Routing",
                flowSequence: [
                    { step: 'edge_cases', priority: 1, enabled: true },
                    { step: 'transfer_rules', priority: 2, enabled: true },
                    { step: 'ai_routing', priority: 3, enabled: true },
                    { step: 'guardrails', priority: 4, enabled: true },
                    { step: 'behavior_rules', priority: 5, enabled: false }
                ]
            }
        };
        
        const preset = presets[presetName];
        
        if (!preset) {
            console.error('❌ [CALL FLOW] Unknown preset:', presetName);
            return;
        }
        
        // Show confirmation
        const confirmed = confirm(`Apply "${preset.name}" preset?\n\nThis will replace your current call flow configuration.`);
        
        if (!confirmed) return;
        
        this.flowSequence = preset.flowSequence;
        this.isDirty = true;
        
        // Re-calculate performance
        await this.recalculatePerformance();
        
        // Re-render
        this.render();
        
        showNotification(`Preset "${preset.name}" applied. Click Save to confirm.`, 'success');
    }
    
    async save() {
        if (!this.isDirty) {
            showNotification('No changes to save', 'info');
            return;
        }
        
        try {
            const response = await fetch(`/api/admin/call-flow/${this.companyId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${getAuthToken()}`
                },
                body: JSON.stringify({
                    flowSequence: this.flowSequence
                })
            });
            
            if (!response.ok) throw new Error('Save failed');
            
            this.isDirty = false;
            showNotification('✅ Call flow configuration saved', 'success');
            
            // Reload to get fresh performance data
            await this.load(this.companyId);
            
        } catch (error) {
            console.error('❌ [CALL FLOW] Save failed:', error);
            showNotification('Failed to save call flow configuration', 'error');
        }
    }
}
```

---

## 🚀 **IMPLEMENTATION CHECKLIST**

### **Phase 1: Core Infrastructure (Now)**
- [ ] Add `flowSequence` to `v2Company.js` schema ✅ (already done)
- [ ] Create `CallFlowAnalyzer.js` service
- [ ] Create backend routes (`/api/admin/call-flow/:companyId`)
- [ ] Add tab to AiCore UI
- [ ] Basic flow sequence editor (up/down arrows, enable/disable)

### **Phase 2: Performance Analysis (Next)**
- [ ] Implement real-time performance calculation
- [ ] Build performance dashboard
- [ ] Add preset configurations
- [ ] Warning system for bad configurations

### **Phase 3: Advanced Features (Future)**
- [ ] "What If" simulator
- [ ] Auto-optimization suggestions
- [ ] Export performance reports
- [ ] Visual flowchart diagram

---

## 🎯 **SUMMARY**

This tab will be **GAME-CHANGING** for ClientsVia:

✅ **Different companies, different needs** (Full AI vs Simple Forward)  
✅ **Real-time cost/time impact** (admins see consequences)  
✅ **Prevents mistakes** (warnings for slow/expensive configs)  
✅ **Data-driven optimization** (suggestions based on actual call logs)  
✅ **Enterprise-grade** (performance dashboards, presets, analytics)

**This is what makes ClientsVia WORLD-CLASS! 🚀**

