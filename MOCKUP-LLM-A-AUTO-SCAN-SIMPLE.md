# LLM-A AUTO-SCAN - SIMPLE VERSION
**Date**: November 30, 2025  
**Purpose**: One-click card generation from Brain 2 scenarios

---

## 🎯 THE IDEA (SUPER SIMPLE)

**Problem**: Manually creating triage cards is slow and error-prone.

**Solution**: LLM-A reads your Brain 2 scenarios and auto-generates matching cards.

---

## 🖼️ THE UI (2 BUTTONS, THAT'S IT)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ✨ AI Triage Builder                                V23 AUTO-SCAN       │
│ Automatically generate triage cards from your Brain 2 scenarios         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ 🧠 SMART CARD GENERATION                                                │
│                                                                         │
│ LLM-A will scan your active scenarios and automatically create         │
│ triage cards with keywords, negative keywords, and synonyms.           │
│                                                                         │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                         │
│ 📊 Current Status:                                                      │
│                                                                         │
│ • Brain 2 (Scenarios):  47 active scenarios                            │
│ • Brain 1 (Triage):     12 cards created                               │
│ • Coverage:             35 scenarios without cards (74% gap)           │
│                                                                         │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                         │
│ 🔹 FULL SCAN (First Time)                                               │
│                                                                         │
│ Scans ALL active scenarios and generates cards for each one.           │
│ Organizes by category automatically.                                   │
│                                                                         │
│ ┌─────────────────────────────────────────────────────────────────┐   │
│ │                                                                 │   │
│ │         [🔍 Scan AiCore & Generate Cards]                       │   │
│ │                                                                 │   │
│ │         Estimated time: ~2-3 minutes for 47 scenarios          │   │
│ │                                                                 │   │
│ └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                         │
│ 🔹 RESCAN (Check for New)                                               │
│                                                                         │
│ Checks for new scenarios added since last scan.                        │
│ Only generates cards for NEW scenarios.                                │
│                                                                         │
│ ┌─────────────────────────────────────────────────────────────────┐   │
│ │                                                                 │   │
│ │         [🔄 Rescan for New Scenarios]                           │   │
│ │                                                                 │   │
│ │         Last scan: 3 days ago                                  │   │
│ │                                                                 │   │
│ └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                         │
│ 💡 How it works:                                                       │
│ 1. LLM-A reads each scenario from Brain 2                             │
│ 2. Generates keywords (what customers say)                            │
│ 3. Generates negative keywords (what to exclude)                      │
│ 4. Generates synonyms (variations of same intent)                     │
│ 5. Creates organized cards by category                                │
│ 6. Links each card to its scenario                                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🔄 AFTER CLICKING "SCAN AICORE"

### Step 1: Scanning Progress

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 🔍 SCANNING BRAIN 2...                                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ Progress: 12 / 47 scenarios processed                                  │
│                                                                         │
│ ████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 26%                │
│                                                                         │
│ Current:                                                                │
│ ✓ AC Not Cooling Repair → Card generated                               │
│ ✓ Furnace No Heat → Card generated                                     │
│ ✓ AC Tune-Up Maintenance → Card generated                              │
│ ⏳ Thermostat Replacement → Generating...                              │
│                                                                         │
│ Categories found:                                                       │
│ • AC Repair (5 scenarios)                                              │
│ • Heating Repair (4 scenarios)                                         │
│ • Maintenance (3 scenarios)                                            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### Step 2: Review Generated Cards

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ✅ SCAN COMPLETE - 47 CARDS GENERATED                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ 📊 Summary:                                                             │
│ • Scenarios scanned: 47                                                │
│ • Cards generated: 47                                                  │
│ • Categories: 8 (organized automatically)                              │
│ • Average confidence: 94%                                              │
│                                                                         │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                         │
│ 📁 AC Repair (12 cards)                                                 │
│                                                                         │
│   🔷 AC Not Cooling                                                     │
│   Keywords: ac, not cooling, warm air, no cold air                     │
│   Negative Keywords: maintenance, tune-up, checkup                     │
│   Synonyms: air conditioner, a/c, cooling system                       │
│   → Linked to: ac_not_cooling_repair                                   │
│   [✓ Accept] [✏️ Edit] [❌ Skip]                                        │
│                                                                         │
│   🔷 AC Making Noise                                                    │
│   Keywords: ac, noise, rattling, grinding, loud                        │
│   Negative Keywords: quiet, normal, slight                             │
│   Synonyms: air conditioner, a/c, hvac unit                            │
│   → Linked to: ac_noise_diagnosis                                      │
│   [✓ Accept] [✏️ Edit] [❌ Skip]                                        │
│                                                                         │
│   [Show all 12 cards →]                                                │
│                                                                         │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                         │
│ 📁 Heating Repair (8 cards)                                             │
│   [Show cards →]                                                        │
│                                                                         │
│ 📁 Maintenance (6 cards)                                                │
│   [Show cards →]                                                        │
│                                                                         │
│ 📁 Emergency (5 cards)                                                  │
│   [Show cards →]                                                        │
│                                                                         │
│ ... [+ 4 more categories]                                              │
│                                                                         │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                         │
│ [✓ Accept All 47] [Review Each One] [Cancel]                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🔄 RESCAN (CHECKING FOR NEW SCENARIOS)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 🔄 RESCAN COMPLETE                                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ 📊 Results:                                                             │
│                                                                         │
│ • Total scenarios in Brain 2: 52 (was 47)                             │
│ • New scenarios found: 5                                               │
│ • Cards generated: 5                                                   │
│                                                                         │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                         │
│ 🆕 NEW CARDS GENERATED:                                                 │
│                                                                         │
│ 📁 AC Repair                                                            │
│   🔷 AC Freon Recharge (NEW)                                            │
│   Keywords: freon, recharge, low refrigerant, r22, r410a               │
│   → Linked to: ac_refrigerant_recharge                                 │
│   [✓ Accept] [✏️ Edit] [❌ Skip]                                        │
│                                                                         │
│ 📁 Smart Home                                                           │
│   🔷 Smart Thermostat Installation (NEW)                                │
│   Keywords: smart thermostat, nest, ecobee, wifi thermostat            │
│   → Linked to: smart_thermostat_install                                │
│   [✓ Accept] [✏️ Edit] [❌ Skip]                                        │
│                                                                         │
│   ... [+ 3 more new cards]                                             │
│                                                                         │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                         │
│ [✓ Accept All 5] [Review Each One] [Cancel]                            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 💻 BACKEND LOGIC (SIMPLE)

### Endpoint 1: Full Scan

```javascript
POST /api/admin/triage-builder/auto-scan/:companyId

// What it does:
1. Load all active scenarios from Brain 2 (AiCore)
2. For each scenario, call LLM-A:
   - Generate keywords (what customers say)
   - Generate negative keywords (what to exclude)
   - Generate synonyms (variations)
3. Create TriageCard for each scenario
4. Organize by category
5. Return for admin review

Response:
{
  ok: true,
  scannedScenarios: 47,
  cardsGenerated: 47,
  categories: [
    {
      name: "AC Repair",
      cards: [
        {
          displayName: "AC Not Cooling",
          keywords: ["ac", "not cooling", "warm air"],
          negativeKeywords: ["maintenance", "tune-up"],
          synonyms: ["air conditioner", "a/c"],
          linkedScenarioKey: "ac_not_cooling_repair"
        }
      ]
    }
  ]
}
```

---

### Endpoint 2: Rescan

```javascript
POST /api/admin/triage-builder/rescan/:companyId

// What it does:
1. Load all active scenarios from Brain 2
2. Check which scenarios already have cards
3. Find NEW scenarios (no card exists)
4. Generate cards ONLY for new scenarios
5. Return for admin review

Response:
{
  ok: true,
  totalScenarios: 52,
  existingCards: 47,
  newScenariosFound: 5,
  cardsGenerated: 5,
  newCards: [...]
}
```

---

## 🧠 LLM-A PROMPT (FOR EACH SCENARIO)

```javascript
const AUTO_SCAN_PROMPT = `
You are generating a triage card for routing callers to a scenario.

Scenario:
- Key: ${scenarioKey}
- Name: ${scenarioName}
- Description: ${scenarioDescription}
- Category: ${categoryName}
- Service Type: ${serviceType}

Generate:
1. Keywords (3-6 words/phrases customers might say)
   - Must be SHORT tokens (1-3 words max)
   - Focus on what callers naturally say
   - Examples: "ac not cooling", "warm air", "no cold"

2. Negative Keywords (2-4 words/phrases that disqualify)
   - Words that mean this is NOT the right card
   - Examples: "maintenance", "tune-up", "schedule"

3. Synonyms (2-5 variations of same intent)
   - Different ways to say the same thing
   - Examples: "air conditioner", "a/c", "cooling system"

Output JSON:
{
  keywords: ["ac", "not cooling", "warm air"],
  negativeKeywords: ["maintenance", "tune-up"],
  synonyms: ["air conditioner", "a/c", "cooling system"]
}
`;
```

---

## 📋 EXAMPLE OUTPUT (WHAT GETS CREATED)

### Scenario from Brain 2:
```javascript
{
  scenarioKey: "ac_not_cooling_repair",
  name: "AC Not Cooling - Emergency Repair",
  description: "Customer reports air conditioner running but not cooling. Requires emergency repair dispatch.",
  category: "AC Repair",
  serviceType: "REPAIR"
}
```

### Auto-Generated Triage Card:
```javascript
{
  displayName: "AC Not Cooling",
  triageLabel: "AC_NOT_COOLING",
  
  quickRuleConfig: {
    keywordsMustHave: ["ac", "not cooling", "warm air", "no cold air"],
    keywordsExclude: ["maintenance", "tune-up", "checkup", "schedule"],
    action: "DIRECT_TO_3TIER",
    intent: "AC_REPAIR",
    serviceType: "REPAIR"
  },
  
  linkedScenario: {
    scenarioKey: "ac_not_cooling_repair",
    scenarioName: "AC Not Cooling - Emergency Repair"
  },
  
  // Generated by LLM-A
  synonyms: ["air conditioner", "a/c", "ac unit", "cooling system"],
  
  isActive: false, // Admin must activate
  priority: 100,
  
  // Auto-organized
  category: "AC Repair"
}
```

---

## 🎯 ORGANIZATION (AUTO-CATEGORIZED)

**LLM-A automatically organizes cards by category:**

```
Triage Cards (47 total)

📁 AC Repair (12 cards)
   🔷 AC Not Cooling
   🔷 AC Making Noise
   🔷 AC Leaking Water
   🔷 AC Won't Turn On
   ... [+ 8 more]

📁 Heating Repair (8 cards)
   🔷 Furnace Not Heating
   🔷 Pilot Light Out
   🔷 Heater Making Noise
   ... [+ 5 more]

📁 Maintenance (6 cards)
   🔷 AC Tune-Up
   🔷 Furnace Tune-Up
   🔷 Filter Change
   ... [+ 3 more]

📁 Emergency (5 cards)
   🔷 No AC in Heatwave
   🔷 Gas Smell
   🔷 Carbon Monoxide
   ... [+ 2 more]

... [+ 4 more categories]
```

---

## 🚀 IMPLEMENTATION PLAN

### Phase 1: Full Scan (4 hours)

**Backend:**
```javascript
// services/AutoScanService.js

class AutoScanService {
  async scanAndGenerateCards(companyId) {
    // 1. Load scenarios from Brain 2
    const scenarios = await getActiveScenariosForCompany(companyId);
    
    // 2. For each scenario, generate card
    const cards = [];
    for (const scenario of scenarios) {
      const card = await this.generateCardForScenario(scenario);
      cards.push(card);
    }
    
    // 3. Organize by category
    const organized = this.organizeByCategory(cards);
    
    return organized;
  }
  
  async generateCardForScenario(scenario) {
    // Call LLM-A with scenario details
    const prompt = buildAutoScanPrompt(scenario);
    const result = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Fast and cheap
      messages: [
        { role: 'system', content: AUTO_SCAN_PROMPT },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' }
    });
    
    const generated = JSON.parse(result.choices[0].message.content);
    
    return {
      displayName: scenario.name,
      triageLabel: toSnakeCase(scenario.name),
      quickRuleConfig: {
        keywordsMustHave: generated.keywords,
        keywordsExclude: generated.negativeKeywords,
        action: 'DIRECT_TO_3TIER',
        intent: scenario.intent,
        serviceType: scenario.serviceType
      },
      linkedScenario: {
        scenarioKey: scenario.scenarioKey,
        scenarioName: scenario.name
      },
      synonyms: generated.synonyms,
      category: scenario.category,
      isActive: false,
      priority: 100
    };
  }
}
```

**API Route:**
```javascript
// routes/admin/triageBuilder.js

router.post('/auto-scan/:companyId', async (req, res) => {
  const { companyId } = req.params;
  
  logger.info('[AUTO-SCAN] Starting full scan', { companyId });
  
  const result = await AutoScanService.scanAndGenerateCards(companyId);
  
  res.json({
    ok: true,
    scannedScenarios: result.totalScenarios,
    cardsGenerated: result.cards.length,
    categories: result.categories
  });
});
```

---

### Phase 2: Rescan (2 hours)

**Backend:**
```javascript
async rescan(companyId) {
  // 1. Load all scenarios
  const scenarios = await getActiveScenariosForCompany(companyId);
  
  // 2. Load existing cards
  const existingCards = await TriageCard.find({ companyId });
  const existingScenarioKeys = existingCards.map(c => c.linkedScenario.scenarioKey);
  
  // 3. Find NEW scenarios (not in existing cards)
  const newScenarios = scenarios.filter(s => 
    !existingScenarioKeys.includes(s.scenarioKey)
  );
  
  // 4. Generate cards only for new scenarios
  const newCards = [];
  for (const scenario of newScenarios) {
    const card = await this.generateCardForScenario(scenario);
    newCards.push(card);
  }
  
  return {
    totalScenarios: scenarios.length,
    existingCards: existingCards.length,
    newScenariosFound: newScenarios.length,
    newCards
  };
}
```

---

## ✅ FINAL SIMPLE UI (2 BUTTONS)

```
┌───────────────────────────────────────────────────┐
│ ✨ AI Triage Builder                              │
│                                                   │
│ Current Status:                                   │
│ • Brain 2: 47 scenarios                          │
│ • Brain 1: 12 cards                              │
│ • Gap: 35 scenarios without cards                │
│                                                   │
│ ┌───────────────────────────────────────────┐   │
│ │  [🔍 Scan AiCore & Generate Cards]        │   │
│ │  Generate cards for ALL scenarios          │   │
│ └───────────────────────────────────────────┘   │
│                                                   │
│ ┌───────────────────────────────────────────┐   │
│ │  [🔄 Rescan for New Scenarios]            │   │
│ │  Check for new scenarios since last scan   │   │
│ │  Last scan: 3 days ago                     │   │
│ └───────────────────────────────────────────┘   │
│                                                   │
└───────────────────────────────────────────────────┘
```

---

**Marc, THIS is what you want, right?**
- ✅ One button: Scan AiCore → Generate ALL cards
- ✅ One button: Rescan → Find NEW scenarios only
- ✅ Auto-generates keywords, negative keywords, synonyms
- ✅ Auto-organizes by category
- ✅ Links to Brain 2 scenarios

**Simple, clean, no bloat. Should I build this?** 🚀

