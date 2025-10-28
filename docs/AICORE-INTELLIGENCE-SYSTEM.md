# 🧠 CLIENTSVIA AICORE INTELLIGENCE SYSTEM
## Complete Architecture & Scenario Creation Guide

> **Document Purpose:** Master reference for understanding, building, and maintaining the world-class in-house AI system that powers ClientsVia's multi-tenant AI receptionist platform. This document serves as the single source of truth for developers, admins, and future onboarding.

---

## 📋 TABLE OF CONTENTS

1. [Executive Overview](#1-executive-overview)
2. [System Architecture](#2-system-architecture)
3. [Global AI Brain (Template Design)](#3-global-ai-brain-template-design)
4. [Company AiCore Configuration](#4-company-aicore-configuration)
5. [Runtime Intelligence Engine](#5-runtime-intelligence-engine)
6. [Scenario Creation Guide](#6-scenario-creation-guide)
7. [Variable System Deep Dive](#7-variable-system-deep-dive)
8. [Best Practices & Patterns](#8-best-practices--patterns)
9. [Code Reference](#9-code-reference)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. EXECUTIVE OVERVIEW

### 1.1 What is ClientsVia AiCore?

**ClientsVia AiCore** is a 100% in-house, non-LLM AI intelligence system that powers human-like AI receptionists for businesses across multiple industries. It combines intelligent scenario matching, entity extraction, and dynamic variable replacement to deliver sub-50ms responses that sound impossibly human.

### 1.2 Why No LLM?

**Performance:** LLMs add 500-2000ms latency. Our in-house system responds in <50ms.  
**Cost:** No per-request API fees. Scales to millions of calls without increasing costs.  
**Control:** 100% predictable responses. No hallucinations, no off-brand replies.  
**Privacy:** All data stays in-house. No external AI services see customer conversations.  
**Reliability:** No dependency on OpenAI, Anthropic, or any third-party AI service.

### 1.3 Multi-Tenant Architecture

Every company using ClientsVia is completely isolated:
- **CompanyId scoping:** All data is scoped by companyId
- **Template references:** Companies select templates, not clone them
- **Variables:** Each company fills their own variable values
- **Q&A:** Company-specific knowledge is private
- **Redis caching:** Per-company cache keys for <50ms data retrieval

### 1.4 The Three-Layer System

```
┌─────────────────────────────────────────────────────────┐
│                  LAYER 1: DESIGN                         │
│              GLOBAL AI BRAIN (Admin Only)                │
│                                                           │
│  • Create templates (HVAC, Dental, Plumbing, etc.)      │
│  • Design categories (Greetings, Booking, Emergency)    │
│  • Build scenarios (trigger phrases + responses)         │
│  • Define variables ({{companyName}}, {{phone}}, etc.)  │
│  • Test templates with dedicated Twilio numbers          │
│                                                           │
│  Location: admin-global-instant-responses.html           │
│  Model: GlobalInstantResponseTemplate                    │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│               LAYER 2: CONFIGURATION                     │
│          COMPANY AICORE TABS (Admin Only)                │
│                                                           │
│  • Select templates for this company (stack multiple)    │
│  • Fill variable values (company-specific data)          │
│  • View live scenarios (what's currently active)         │
│  • Manage company Q&A (custom knowledge)                 │
│  • Configure filler words (noise filtering)              │
│                                                           │
│  Location: company-profile.html → AI Agent Settings      │
│  Tabs: Variables, Templates, Live Scenarios, Knowledge   │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│                LAYER 3: RUNTIME                          │
│            AI INTELLIGENCE ENGINE                        │
│                                                           │
│  1. Call comes in → Twilio webhook                       │
│  2. Extract phone number → MongoDB lookup                │
│  3. Load company's templates (Redis cache)               │
│  4. Load company's variables (Redis cache)               │
│  5. Match caller speech to scenario (Hybrid Selector)    │
│  6. Replace {{variables}} with company values            │
│  7. Return response (<50ms target)                       │
│                                                           │
│  Service: HybridScenarioSelector.js                      │
│  Router: v2priorityDrivenKnowledgeRouter.js              │
└─────────────────────────────────────────────────────────┘
```

---

## 2. SYSTEM ARCHITECTURE

### 2.1 Data Flow: Call → Response

```
INCOMING CALL
    ↓
[1] Twilio receives call
    → POST to /api/v2/twilio/incoming-call
    ↓
[2] Extract phone number (+1-555-1234)
    ↓
[3] MongoDB query: Find company by phone
    → db.companies.findOne({ 'twilioConfig.phoneNumber': '+1-555-1234' })
    ↓
[4] Load company configuration (Redis cache)
    → Key: company:${companyId}
    → Contains: templateReferences[], variables Map
    ↓
[5] Load selected templates (Redis cache)
    → Key: template:${templateId}
    → Contains: categories[] with scenarios[]
    ↓
[6] Caller speaks: "I need an appointment"
    ↓
[7] HybridScenarioSelector.match()
    → Normalize: Remove filler words
    → Match: BM25 keyword + regex + semantic
    → Score: Calculate confidence (0-1)
    → Filter: Negative triggers, preconditions
    → Rank: Priority tie-breaking
    → Return: Best matching scenario
    ↓
[8] Variable Replacement
    → quickReply: "I'd be happy to help you schedule, {{customerName}}!"
    → Replace: {{customerName}} = "John"
    → Result: "I'd be happy to help you schedule, John!"
    ↓
[9] TTS Generation (ElevenLabs)
    → Voice settings from company config
    → Generate audio stream
    ↓
[10] Twilio plays response to caller
    ↓
RESPONSE DELIVERED (<50ms total)
```

### 2.2 Database Schema Overview

#### 2.2.1 GlobalInstantResponseTemplate (MongoDB)
**Purpose:** Master template library (Shared across all companies)

```javascript
{
  _id: ObjectId("..."),
  version: "v1.0.0",
  name: "Universal Service Business Template",
  templateType: "universal",
  industryLabel: "All Industries",
  isActive: true,
  isPublished: true,
  
  // THE INTELLIGENCE
  categories: [{
    id: "cat_greetings_001",
    name: "Greetings",
    icon: "👋",
    description: "Initial caller greetings and acknowledgments",
    behavior: "friendly_warm", // References GlobalAIBehaviorTemplate
    isActive: true,
    
    scenarios: [{
      scenarioId: "scn_greeting_hello_001",
      name: "Basic Hello",
      status: "live", // draft | live | archived
      priority: 0, // -10 to 100 (tie-breaker)
      
      // MATCHING (How AI finds this scenario)
      triggers: ["hello", "hi there", "good morning", "hey"],
      regexTriggers: [],
      negativeTriggers: ["don't say hello", "not hello"],
      embeddingVector: [0.234, 0.567, ...], // Future: semantic matching
      
      // RESPONSES (What AI says)
      quickReplies: [
        "Hi! Thanks for calling {{companyName}}. How can I help you today?",
        "Hello! You've reached {{companyName}}. What can I do for you?",
        "Hey there! This is {{companyName}}. How may I assist you?"
      ],
      fullReplies: [...],
      replySelection: "bandit", // sequential | random | bandit
      
      // ENTITY CAPTURE (What AI extracts)
      entityCapture: ["name", "phone_number"],
      entityValidation: { phone_number: { regex: "^\\d{10}$" } },
      
      // HOOKS & INTEGRATIONS
      actionHooks: ["log_greeting"],
      
      // METADATA
      isActive: true,
      createdAt: ISODate("..."),
      updatedAt: ISODate("...")
    }]
  }],
  
  // VARIABLE DEFINITIONS (Type system for variables)
  variableDefinitions: [{
    key: "companyName",
    label: "Company Name",
    description: "Your business name as you want callers to hear it",
    type: "text", // text | email | phone | url | currency | enum | multiline
    required: true,
    example: "ABC Plumbing",
    category: "Company Info",
    usageCount: 47 // Auto-calculated
  }],
  
  // FILLER WORDS (Noise filter)
  fillerWords: ["um", "uh", "like", "you know", ...],
  
  // URGENCY KEYWORDS (Emergency detection)
  urgencyKeywords: [{
    word: "emergency",
    weight: 0.5, // Score boost
    category: "Safety"
  }]
}
```


#### 2.2.2 v2Company (MongoDB)
**Purpose:** Company configuration & selected templates

```javascript
{
  _id: ObjectId("68e3f77a9d623b8058c700c4"),
  companyName: "Royal Plumbing",
  businessPhone: "+1 (111) 111-1115",
  
  // TEMPLATE SELECTION (References, not clones)
  aiAgentSettings: {
    templateReferences: [{
      templateId: "template_plumbing_v1",
      enabled: true,
      priority: 1, // Lower = checked first
      clonedAt: ISODate("2025-10-23T00:00:00Z")
    }, {
      templateId: "template_small_talk_v1",
      enabled: true,
      priority: 2,
      clonedAt: ISODate("2025-10-23T00:00:00Z")
    }],
    
    // VARIABLE VALUES (Company-specific)
    variables: Map {
      "companyName" => "Royal Plumbing",
      "phone" => "+1 (111) 111-1115",
      "email" => "info@royalplumbing.com",
      "businessHours" => "Monday-Friday 8am-6pm",
      "emergencyPhone" => "+1 (111) 111-9999",
      "website" => "www.royalplumbing.com"
    },
    
    // VARIABLE DEFINITIONS (Scanned from templates)
    variableDefinitions: [{
      key: "companyName",
      label: "Company Name",
      type: "text",
      required: true,
      category: "Company Info",
      usageCount: 47
    }],
    
    // FILLER WORDS (Inherited + Custom)
    fillerWords: {
      inherited: ["um", "uh", "like", ...], // From templates
      custom: ["y'all", "reckon"] // Company-specific additions
    }
  }
}
```

### 2.3 The Hierarchy Explained

```
TEMPLATE (Plumbing Company v1.0)
    ├── Category: Greetings (👋)
    │   ├── Scenario: Basic Hello
    │   ├── Scenario: Good Morning
    │   └── Scenario: After Hours Greeting
    │
    ├── Category: Appointment Booking (📅)
    │   ├── Scenario: Request Appointment
    │   ├── Scenario: Reschedule Appointment
    │   └── Scenario: Cancel Appointment
    │
    ├── Category: Emergency Services (🚨)
    │   ├── Scenario: Water Emergency
    │   ├── Scenario: Gas Leak
    │   └── Scenario: No Heat/AC
    │
    └── Category: Pricing Questions (💰)
        ├── Scenario: Service Call Cost
        ├── Scenario: Quote Request
        └── Scenario: Payment Methods
```

**Key Concepts:**
- **Template** = Industry-specific intelligence package (HVAC, Dental, Legal, etc.)
- **Category** = Logical grouping of related scenarios (Greetings, Booking, Emergency)
- **Scenario** = Single conversation unit (trigger phrases → response)
- **Variable** = Dynamic placeholder ({{companyName}}, {{phone}}, etc.)

---

## 3. GLOBAL AI BRAIN (TEMPLATE DESIGN)

**Location:** `admin-global-instant-responses.html`  
**Access:** Admin/Developer only  
**Purpose:** Design and test templates that companies will use

### 3.1 Template Overview Tab

This tab shows the dashboard and template selector.

**What You See:**
- Currently Editing Template dropdown
- Template stats (Categories: 12, Scenarios: 73, Version: v1.0.0)
- Sub-tabs: Dashboard, Templates, Maintenance

**Key Actions:**
- Switch between templates
- Create new templates
- Clone existing templates
- Publish templates

### 3.2 Templates Tab → All Templates

**Purpose:** Manage the template library

**Template Card Shows:**
```
┌────────────────────────────────────────┐
│ 🔧 Plumbing Company (v1.0.0)           │
│ All Industries                          │
│                                         │
│ 📊 12 Categories | 73 Scenarios        │
│ ✅ Published | 🟢 Active               │
│                                         │
│ [Edit] [Clone] [Test] [Analytics]      │
└────────────────────────────────────────┘
```

**Template Actions:**
- **Edit:** Modify categories and scenarios
- **Clone:** Create a new template from this one (for new industries)
- **Test:** Dedicated Twilio phone number for testing
- **Analytics:** Usage stats across all companies

### 3.3 Creating a Template

**Best Practices:**

1. **Start from Universal Template**
   - Clone `Universal AI Brain (All Industries) (v1.0.0)`
   - Rename to your industry: "Dental Practice (v1.0.0)"

2. **Customize Categories**
   - Keep common ones: Greetings, Hold, Callback
   - Add industry-specific: "Insurance Verification", "Appointment Types"

3. **Build Scenarios**
   - Start with 3-5 trigger variations per scenario
   - Write 2-3 reply variations (anti-robotic)
   - Test each scenario thoroughly

4. **Define Variables**
   - Required: `{{companyName}}`, `{{phone}}`, `{{email}}`
   - Industry-specific: `{{doctorName}}`, `{{practiceType}}`
   - Use clear labels and examples

---

## 4. COMPANY AICORE CONFIGURATION

**Location:** `company-profile.html → AI Agent Settings → AiCore Control Center`  
**Access:** Admin only  
**Purpose:** Configure templates and variables for this specific company

### 4.1 Variables Tab

**Purpose:** Manage company-specific variable values  
**Manager:** `VariablesManager.js`

#### 4.1.1 What It Does

When a company selects templates, the system automatically scans all scenarios and finds every `{{variable}}` placeholder. The admin then fills in the company-specific values.

**Example:**
```
Template Scenario:
"Hello! Thanks for calling {{companyName}}. We're open {{businessHours}}."

Variable Values (Royal Plumbing):
{{companyName}} = "Royal Plumbing"
{{businessHours}} = "Monday-Friday 8am-6pm"

Runtime Result:
"Hello! Thanks for calling Royal Plumbing. We're open Monday-Friday 8am-6pm."
```

#### 4.1.2 Variable Discovery Flow

```
1. Admin activates template "Plumbing Company v1.0"
2. VariablesManager.scanPlaceholders() runs automatically
3. System scans all scenarios in template
4. Finds: {{companyName}}, {{phone}}, {{email}}, {{emergencyPhone}}
5. Creates variableDefinitions[] with metadata
6. Shows in Variables tab with empty values
7. Admin fills values
8. Saves to company.aiAgentSettings.variables Map
9. Redis cache invalidated
10. New values available instantly for calls
```

#### 4.1.3 Variable Categories

Variables are auto-categorized:

- **Company Info:** companyName, businessPhone, email, website
- **Contact:** phone, emergencyPhone, textNumber, fax
- **Hours:** businessHours, afterHoursMessage, holidayHours
- **Pricing:** serviceCallFee, emergencyRate, paymentMethods
- **Personnel:** ownerName, managerName, technicianName
- **Custom:** Industry-specific variables

#### 4.1.4 Scan & Status UI

```
┌──────────────────────────────────────────────────┐
│ 🔍 SYSTEM NO DATA                                 │
│ Variables Management Control Center               │
│                                                    │
│ Last Scan: Never                                  │
│ Variables Found: 0 unique                          │
│ Completion: 0/0 (0%)                              │
│                                                    │
│ [Force Scan Now]                                  │
└──────────────────────────────────────────────────┘
```

**After Scan:**
```
┌──────────────────────────────────────────────────┐
│ ✅ SCAN COMPLETE                                  │
│ Variables Management Control Center               │
│                                                    │
│ Last Scan: 2025-10-23 11:30 AM                   │
│ Variables Found: 12 unique                        │
│ Completion: 8/12 (67%)                            │
│                                                    │
│ [Scan Again]                                      │
└──────────────────────────────────────────────────┘

📋 COMPANY INFO (3 variables)
┌──────────────────────────────────────────────────┐
│ Company Name * (required)                         │
│ [Royal Plumbing_____________]                    │
│ Used in 47 scenarios                              │
└──────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────┐
│ Business Phone *                                  │
│ [+1 (111) 111-1115_________]                     │
│ Used in 23 scenarios                              │
└──────────────────────────────────────────────────┘
```


### 4.2 AiCore Templates Tab

**Purpose:** Select which Global AI Brain templates this company uses  
**Manager:** `AiCoreTemplatesManager.js`

#### 4.2.1 Template Stacking

Companies can activate multiple templates (stacking):

```
Royal Plumbing Company Uses:
1. Plumbing Company Template (Priority: 1)
2. Small Talk Template (Priority: 2)
3. Professional Office Template (Priority: 3)
```

**Priority Matters:** Lower number = checked first during scenario matching.

#### 4.2.2 Template Card

```
┌─────────────────────────────────────────────────┐
│ 🔧 Plumbing Company (v1.0.0)      Priority: 1   │
│                                                  │
│ 📊 12 Categories | 73 Scenarios | 156 Triggers │
│                                                  │
│ ✅ Active                                        │
│                                                  │
│ [Remove Template]                                │
└─────────────────────────────────────────────────┘
```

### 4.3 AiCore Live Scenarios Tab

**Purpose:** View all active scenarios from selected templates  
**Manager:** `AiCoreLiveScenariosManager.js`

Shows a consolidated view of all scenarios currently active for this company, organized by template and category.

### 4.4 AiCore Knowledgebase Tab

**Purpose:** Manage company-specific Q&A pairs  
**Manager:** `AiCoreKnowledgebaseManager.js`

This is where companies add custom knowledge that isn't in templates:
- "What's your emergency rate?" → "$200 after hours"
- "Do you service commercial buildings?" → "Yes, we handle all commercial HVAC"

### 4.5 AiCore Filler Filter Tab

**Purpose:** Customize noise word filtering  
**Manager:** `AiCoreFillerFilterManager.js`

Shows inherited filler words from templates + allows custom additions.

---

## 5. SCENARIO CREATION GUIDE
### The 5-Tab Scenario Form Breakdown

**Location:** Global AI Brain → Template → Category → "Add Scenario" button  
**Purpose:** Create a single conversation scenario with intelligence

This is the **HEART** of the AI system. Every scenario you create teaches the AI how to respond to a specific type of caller request.

---

### 5.1 TAB 1: BASIC INFO

**Purpose:** Define identity, status, matching priority, and trigger phrases

#### 5.1.1 Fields Explained

##### Scenario Name *
```
Example: "Request Appointment"
Purpose: Descriptive name for admin reference
Best Practice: Use action verbs (Request, Reschedule, Confirm, Ask)
Max Length: 100 characters
```

**Why It Matters:** Clear naming helps you find scenarios quickly when managing hundreds of them.

---

##### Status
```
Options:
  • 📝 Draft (editing, not live)
  • ✅ Live (active matching)
  • 📦 Archived (historical, inactive)

Default: Draft
```

**Why It Matters:** Only "Live" scenarios match caller speech. Use Draft while testing, then publish to Live.

**Best Practice:** Always test in Draft mode with dedicated test number before going Live.

---

##### Priority Level (-10 to +10)
```
Range: -10 (lowest) to +10 (highest)
Default: 0 (normal)
Purpose: Tie-breaker when multiple scenarios score equally

Examples:
  +10: EMERGENCY (water flooding, gas leak, fire)
  +5:  URGENT (no heat in winter, AC out in summer)
  0:   NORMAL (general questions, booking)
  -5:  SMALL TALK (weather, sports, chitchat)
  -10: FALLBACK (catch-all responses)
```

**How It Works:**
```
Caller says: "My basement is flooding and I need someone right now"

Matching Scenarios:
1. "Water Emergency" (confidence: 0.87, priority: +10)
2. "Request Appointment" (confidence: 0.87, priority: 0)
3. "Emergency Service" (confidence: 0.87, priority: +5)

Winner: "Water Emergency" (same confidence, highest priority)
```

**Why It Matters:** Prevents wrong scenario selection when trigger phrases overlap.

**Best Practice:**
- Emergency scenarios: +8 to +10
- Booking scenarios: 0 to +2
- Chitchat scenarios: -5 to -8
- Fallback scenarios: -10

---

##### Trigger Phrases *
```
Format: One phrase per line
Required: At least 1, recommended: 3-5 variations
Max: 20 trigger variations

Example (Request Appointment):
i need an appointment
can i schedule a visit
i'd like to book a time
schedule me in
when can you come out
can you send someone
i need service
book an appointment
make an appointment
```

**Why It Matters:** More trigger variations = better matching accuracy.

**Best Practices:**

1. **Natural Language:** Write how real people talk, not formal English
   - ✅ "i need someone out here"
   - ❌ "I would like to schedule a service appointment"

2. **Include Contractions:** People use them in speech
   - ✅ "can't", "won't", "i'd", "i'm"
   - ❌ "cannot", "will not", "I would", "I am"

3. **Vary Length:** Short and long phrases
   - ✅ "book me in" (short)
   - ✅ "can i schedule an appointment for next week" (long)

4. **Regional Variations:**
   - ✅ "y'all got availability?"
   - ✅ "you guys open tomorrow?"

5. **Common Typos/Mishears (STT errors):**
   - ✅ "schedul" (missing e)
   - ✅ "bookong" (o instead of i)

6. **Avoid Overly Specific Triggers:**
   - ❌ "i need an appointment for next tuesday at 2pm for a water heater repair"
   - ✅ "i need an appointment"

---

#### 5.1.2 Advanced: Regex Triggers (Optional)

For power users who need pattern matching:

```
Example: Match any hold/wait request
Pattern: \b(hold|wait)\s*(on|up|please)?\b

Matches:
  • "hold on"
  • "wait up"
  • "hold please"
  • "wait"
  • "hold"
```

**When to Use Regex:**
- Capturing phone numbers: `\d{3}-\d{3}-\d{4}`
- Date patterns: `(tomorrow|next\s+\w+day)`
- Time patterns: `\d{1,2}(am|pm)`

**Warning:** Regex is powerful but fragile. Test thoroughly.

---

#### 5.1.3 Advanced: Negative Triggers (Optional)

Prevent false positives by blocking certain phrases:

```
Scenario: "Hold Please" (customer asks to hold)

Trigger Phrases:
  • hold on
  • wait a moment
  • give me a second

Negative Triggers:
  • don't hold
  • no hold
  • don't wait
  • not waiting

Result: If caller says "don't hold", this scenario won't match
```

**Why It Matters:** Improves precision. Avoids embarrassing mismatches.

---

### 5.2 TAB 2: REPLIES & FLOW

**Purpose:** Define how the AI responds (the actual conversation)

#### 5.2.1 Fields Explained

##### Quick Reply *
```
Purpose: Short, immediate acknowledgment (1-2 sentences)
Use Case: SMS, initial response, quick acknowledgment
Max Length: 200 characters
Variations: 2-3 recommended

Example (Request Appointment):
Variation 1: "I'd be happy to help you schedule!"
Variation 2: "Let's get you booked!"
Variation 3: "Absolutely, I can schedule that!"
```

**Why Multiple Variations?**
- Sounds human (not robotic repetition)
- 1 variation = "robot"
- 3 variations = "human-like"

---

##### Full Reply *
```
Purpose: Complete, detailed response (2-4 sentences)
Use Case: Voice calls, detailed explanations
Max Length: 1000 characters
Variations: 2-3 recommended

Example (Request Appointment):
Variation 1:
"I'd be happy to help you schedule an appointment. What day works best for you? We have availability tomorrow afternoon, or we can look at later this week if that's better."

Variation 2:
"Let's get you booked! We have openings this week. What's your schedule like? I can check our calendar and find a time that works for you."

Variation 3:
"Absolutely, I can schedule that for you. Are you looking for something soon, or did you have a specific day in mind? We're pretty flexible this week."
```

**Best Practices:**

1. **Use Variables:**
   ```
   "Thanks for calling {{companyName}}!"
   "Our emergency line is {{emergencyPhone}}."
   "We're open {{businessHours}}."
   ```

2. **Ask Questions:** Keep conversation flowing
   - ✅ "What day works best for you?"
   - ✅ "Is this an emergency?"
   - ❌ "I'll schedule you." (dead end)

3. **Provide Options:**
   - ✅ "We have tomorrow afternoon, or next week if you prefer."
   - ❌ "We're available." (too vague)

4. **Match Caller's Energy:**
   - Urgent caller → Quick, direct response
   - Casual caller → Friendly, relaxed response

5. **Avoid Jargon:**
   - ✅ "service call"
   - ❌ "technician dispatch request ticket"

---

##### Behavior (AI Personality)
```
Dropdown: Select from GlobalAIBehaviorTemplate

Options:
  • Friendly Warm
  • Professional Calm
  • Empathetic Caring
  • Urgent Firm
  • Apologetic Humble

Purpose: Controls tone, pace, volume, emotional intensity
```

**How It Works:**
```
Behavior: Friendly Warm
  → Tone: warm
  → Pace: normal
  → Volume: normal
  → Emotion Intensity: 3/5

Result: "Hey there! I'd love to help you out!"

vs.

Behavior: Professional Calm
  → Tone: calm
  → Pace: slow
  → Volume: slightly_soft
  → Emotion Intensity: 2/5

Result: "Good afternoon. I'll be happy to assist you."
```

**Best Practice:** Match behavior to scenario:
- Greetings → Friendly Warm
- Emergency → Urgent Firm
- Complaints → Empathetic Caring
- After Hours → Apologetic Humble

---

##### Reply Selection Mode
```
Options:
  • Sequential: Rotate through variations in order (V1, V2, V3, V1, V2...)
  • Random: Pick randomly each time
  • Bandit: AI learns which variations perform best

Default: Bandit (recommended)
```

**Why Bandit?** The AI tracks which reply variations get better outcomes (callback rate, booking rate, satisfaction) and favors the winners over time.

---


### 5.3 TAB 3: ENTITIES & VARIABLES

**Purpose:** Extract information from speech and use dynamic data

#### 5.3.1 Entity Capture

**What are Entities?**
Specific pieces of information the AI extracts from caller speech.

```
Caller says: "My name is John Smith and my number is 555-1234"

Entity Capture:
  • name → "John Smith"
  • phone_number → "555-1234"

Usage: Store in database, pass to CRM, use in follow-up
```

**Common Entities:**
- `name`: Customer's name
- `phone_number`: Callback number
- `email`: Email address
- `address`: Street address
- `date`: Appointment date
- `time`: Appointment time
- `service_type`: What they need (repair, install, inspection)
- `urgency`: Emergency level

**How to Use:**
```
Scenario: "Collect Customer Info"

Entity Capture: ["name", "phone_number"]

Quick Reply:
"Perfect, {{name}}! I've got your number as {{phone_number}}. Is that correct?"

Result:
"Perfect, John! I've got your number as 555-1234. Is that correct?"
```

---

#### 5.3.2 Entity Validation (Advanced)

Ensure extracted data is valid:

```javascript
{
  phone_number: {
    regex: "^\\d{10}$", // Must be 10 digits
    normalize: "E.164", // Convert to +1-XXX-XXX-XXXX
    errorMessage: "I need a 10-digit phone number"
  },
  email: {
    regex: "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$",
    errorMessage: "That doesn't look like a valid email"
  },
  date: {
    format: "YYYY-MM-DD",
    futureOnly: true,
    errorMessage: "Please provide a future date"
  }
}
```

---

#### 5.3.3 Dynamic Variables

Fallback values when entity is missing:

```javascript
{
  name: "the caller", // If name not captured
  phone: "{{businessPhone}}", // Use company phone
  date: "{{today}}" // Use current date
}
```

**Example:**
```
Captured: name = undefined, phone = "555-1234"

Reply Template:
"Thanks {{name}}, I'll call you back at {{phone}}."

Result:
"Thanks the caller, I'll call you back at 555-1234."
```

---

#### 5.3.4 Company Q&A Integration

Link this scenario to company-specific knowledge:

```
Scenario: "Ask About Pricing"

Company Q&A Pairs:
  Q: "What's your service call fee?"
  A: "Our standard service call is $89, waived if you proceed with repair."
  
  Q: "Do you charge for estimates?"
  A: "Estimates are always free!"

Result: AI can pull from company Q&A if trigger matches
```

---

### 5.4 TAB 4: ADVANCED SETTINGS

**Purpose:** Enhance matching, generate training data, trigger actions

#### 5.4.1 Keywords Enhancement (Auto-Generate)

**What It Does:** AI generates relevant keywords for better matching

```
Scenario: "Request Appointment"

Trigger Phrases:
  • i need an appointment
  • schedule me in

Click "Enhance" →

Generated Keywords:
  • appointment
  • schedule
  • book
  • visit
  • calendar
  • availability
  • time slot
  • reservation
  • booking
  • service call
```

**Why It Matters:** Improves matching accuracy without manually writing every variation.

---

#### 5.4.2 Q&A Pairs Enhancement (Auto-Generate)

**What It Does:** AI generates training data pairs

```
Scenario: "Request Appointment"

Click "Enhance" →

Generated Q&A Pairs:
  Q: "Can I schedule an appointment?"
  A: (uses Quick Reply)
  Confidence: 0.85
  
  Q: "I need to book a time"
  A: (uses Quick Reply)
  Confidence: 0.85
  
  Q: "When can you come out?"
  A: (uses Quick Reply)
  Confidence: 0.85
```

**Why It Matters:** Helps AI understand question variations automatically.

---

#### 5.4.3 Action Hooks (Integrations)

**What are Action Hooks?**
Functions that run after this scenario matches.

```
Example Hooks:
  • log_booking_request → Track in analytics
  • send_sms_confirmation → Text customer
  • create_ticket → Open CRM ticket
  • notify_admin → Alert manager
  • escalate_to_human → Transfer call
```

**How to Use:**
```
Scenario: "Emergency Water Leak"

Action Hooks: ["escalate_to_human", "notify_admin", "log_emergency"]

Result: When scenario matches, AI:
  1. Says emergency response
  2. Transfers to human immediately
  3. Texts admin about emergency
  4. Logs in database
```

**Available Hooks:** Managed in Global AI Brain → Action Hooks tab

---

#### 5.4.4 Follow-Up Logic (Multi-Turn)

**What It Does:** Defines next steps in conversation

```
Scenario: "Request Appointment"

Follow-Up Funnel:
"Alright — where were we? Let's get you booked! What day works for you?"

Use Case: After hold, interruption, or silence → re-engage caller
```

---

### 5.5 TAB 5: TEST & PREVIEW

**Purpose:** Test scenario before going live

#### 5.5.1 Test Input

```
┌────────────────────────────────────────────────┐
│ Test Caller Input:                             │
│ [i need an appointment for tomorrow_________]  │
│                                                 │
│ [Test Match]                                   │
└────────────────────────────────────────────────┘
```

**What It Shows:**
- ✅ Match Success (confidence score)
- 📝 Matched Triggers
- 💬 AI Response (with variables replaced)
- 🎯 Priority & Behavior
- ⏱️ Match Time (milliseconds)

---

#### 5.5.2 Validation Checklist

Before publishing to Live, verify:

- [ ] At least 3 trigger variations
- [ ] 2-3 reply variations (anti-robotic)
- [ ] Variables properly formatted ({{variable}})
- [ ] Priority set appropriately
- [ ] Behavior matches scenario tone
- [ ] Tested with 5+ sample phrases
- [ ] No overlap with higher-priority scenarios
- [ ] Negative triggers added (if needed)

---

## 6. RUNTIME INTELLIGENCE ENGINE

### 6.1 How Scenarios Are Matched

**Service:** `HybridScenarioSelector.js`  
**Algorithm:** Weighted Fusion (BM25 + Semantic + Regex + Context)  
**Performance Target:** <10ms per query

#### 6.1.1 The Matching Process

```
Step 1: NORMALIZATION
  Input: "Um, like, I need an appointment, you know?"
  Filler Removal: "need appointment"
  Lowercase: "need appointment"
  
Step 2: NEGATIVE TRIGGER CHECK
  Check all scenarios' negativeTriggers[]
  If match found → DISQUALIFY scenario immediately
  
Step 3: BM25 KEYWORD SCORING (40% weight)
  Term Frequency: How often trigger words appear
  Document Frequency: How rare are these words
  Score: 0.72
  
Step 4: REGEX PATTERN MATCHING (20% weight)
  Check regexTriggers[]
  If match → Score: 1.0
  If no match → Score: 0.0
  
Step 5: SEMANTIC SIMILARITY (30% weight)
  Compare sentence embeddings
  Cosine similarity: 0.68
  (Future: In-house model)
  
Step 6: CONTEXT WEIGHTING (10% weight)
  Conversation state: new_caller
  History: no_previous_interaction
  Caller profile: unknown
  Score: 0.5
  
Step 7: URGENCY BOOST
  Check urgencyKeywords[]
  If "emergency" detected → +0.3 boost
  
Step 8: FINAL SCORE CALCULATION
  Score = (BM25 * 0.4) + (Semantic * 0.3) + (Regex * 0.2) + (Context * 0.1)
  Score = (0.72 * 0.4) + (0.68 * 0.3) + (0.0 * 0.2) + (0.5 * 0.1)
  Score = 0.288 + 0.204 + 0.0 + 0.05
  Final Score: 0.542 (54.2% confidence)
  
Step 9: THRESHOLD GATING
  Company threshold: 0.45
  Scenario score: 0.542
  PASS → Scenario is candidate
  
Step 10: PRIORITY TIE-BREAKING
  Multiple scenarios scored 0.542:
    • "Request Appointment" (priority: 0)
    • "Emergency Service" (priority: +5)
  Winner: "Emergency Service" (higher priority)
  
Step 11: PRECONDITION VALIDATION
  Check scenario.preconditions
  Example: { hasEntity: ['name'] }
  If not met → Skip scenario
  
Step 12: COOLDOWN CHECK
  Last used: 10 seconds ago
  Cooldown: 30 seconds
  FAIL → Skip scenario (prevent spam)
```

#### 6.1.2 Matching Example (Real World)

```
COMPANY: Royal Plumbing
TEMPLATES ACTIVE:
  1. Plumbing Company (Priority 1)
  2. Small Talk (Priority 2)

CALLER SAYS: "basement flooding need help now"

MATCHING RESULTS:
┌────────────────────────────────────────────────────┐
│ Scenario: Water Emergency                           │
│ Confidence: 0.92                                   │
│ Priority: +10                                      │
│ Template: Plumbing Company                         │
│ Status: SELECTED ✅                                │
└────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────┐
│ Scenario: Request Appointment                       │
│ Confidence: 0.68                                   │
│ Priority: 0                                        │
│ Template: Plumbing Company                         │
│ Status: NOT SELECTED (lower confidence)            │
└────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────┐
│ Scenario: Greeting                                  │
│ Confidence: 0.12                                   │
│ Priority: 0                                        │
│ Template: Small Talk                               │
│ Status: BELOW THRESHOLD (0.45 minimum)             │
└────────────────────────────────────────────────────┘

WINNER: Water Emergency (0.92 confidence, +10 priority)

RESPONSE:
"I understand you have a water emergency. This is urgent — I'm connecting you with our emergency team right now. Stay on the line."

ACTIONS TRIGGERED:
  • escalate_to_human → Transfer immediately
  • log_emergency → Database entry
  • notify_admin → SMS to manager
```


### 6.2 Variable Replacement System

**When:** After scenario is matched, before TTS generation  
**How:** String replacement with validation

```javascript
// Pseudo-code
function replaceVariables(text, companyVariables) {
  let result = text;
  
  // Find all {{variable}} placeholders
  const placeholders = text.match(/\{\{([a-zA-Z0-9_]+)\}\}/g);
  
  for (const placeholder of placeholders) {
    const key = placeholder.replace(/[\{\}]/g, ''); // Extract key
    const value = companyVariables.get(key); // Lookup company value
    
    if (value) {
      result = result.replace(placeholder, value);
    } else {
      logger.warn(`Missing variable: ${key}`);
      // Fallback: Keep placeholder or use default
    }
  }
  
  return result;
}

// Example
replaceVariables(
  "Hello! You've reached {{companyName}}. We're open {{businessHours}}.",
  Map {
    "companyName" => "Royal Plumbing",
    "businessHours" => "Mon-Fri 8am-6pm"
  }
);

// Result:
"Hello! You've reached Royal Plumbing. We're open Mon-Fri 8am-6pm."
```

---

### 6.3 Redis Caching Strategy

**Goal:** Sub-50ms data retrieval  
**Keys:** Scoped by companyId and phone number

```javascript
Cache Keys:
  company:${companyId} → Full company document
  company-phone:${phoneNumber} → CompanyId lookup
  template:${templateId} → Template with all scenarios
  
TTL (Time To Live):
  company:* → 300 seconds (5 minutes)
  template:* → 600 seconds (10 minutes)
  
Cache Invalidation:
  • Variable save → Clear company:${companyId}
  • Template activation → Clear company:${companyId}
  • Template edit → Clear template:${templateId}
```

---

## 7. VARIABLE SYSTEM DEEP DIVE

### 7.1 Variable Discovery Algorithm

**File:** `routes/company/v2companyConfiguration.js`  
**Endpoint:** `POST /api/company/:companyId/configuration/variables/scan`

```javascript
async function scanPlaceholders(companyId) {
  // 1. Load company
  const company = await Company.findById(companyId);
  
  // 2. Get active template IDs
  const templateIds = company.aiAgentSettings.templateReferences
    .filter(ref => ref.enabled)
    .map(ref => ref.templateId);
  
  // 3. Load all templates
  const templates = await GlobalInstantResponseTemplate.find({
    _id: { $in: templateIds }
  });
  
  // 4. Scan all scenarios for {{variables}}
  const variablesFound = new Set();
  const variableUsage = new Map();
  
  for (const template of templates) {
    for (const category of template.categories) {
      for (const scenario of category.scenarios) {
        // Scan quickReplies[]
        scenario.quickReplies.forEach(reply => {
          const matches = reply.match(/\{\{([a-zA-Z0-9_]+)\}\}/g);
          matches?.forEach(match => {
            const key = match.replace(/[\{\}]/g, '');
            variablesFound.add(key);
            variableUsage.set(key, (variableUsage.get(key) || 0) + 1);
          });
        });
        
        // Scan fullReplies[]
        scenario.fullReplies.forEach(reply => {
          // Same logic as above
        });
      }
    }
  }
  
  // 5. Create variableDefinitions from template definitions
  const definitions = [];
  for (const key of variablesFound) {
    const templateDef = findVariableDefinition(templates, key);
    definitions.push({
      key,
      label: templateDef?.label || toLabel(key),
      type: templateDef?.type || 'text',
      required: templateDef?.required || false,
      category: templateDef?.category || 'General',
      usageCount: variableUsage.get(key) || 0,
      example: templateDef?.example || ''
    });
  }
  
  // 6. Save to company
  company.aiAgentSettings.variableDefinitions = definitions;
  await company.save();
  
  // 7. Clear cache
  await redisClient.del(`company:${companyId}`);
  
  return {
    totalFound: variablesFound.size,
    variables: Array.from(variablesFound),
    usage: Object.fromEntries(variableUsage)
  };
}
```

### 7.2 Standard Variables Library

**Required Variables (Every Company):**
- `{{companyName}}`: Business name
- `{{phone}}` or `{{businessPhone}}`: Main phone number
- `{{email}}` or `{{businessEmail}}`: Main email address

**Common Variables:**
- `{{website}}`: Company website
- `{{businessHours}}`: Operating hours
- `{{address}}`: Physical address
- `{{emergencyPhone}}`: After-hours number
- `{{ownerName}}`: Owner/manager name
- `{{serviceArea}}`: Geographic coverage

**Industry-Specific Examples:**

**Plumbing/HVAC:**
- `{{emergencyRate}}`: After-hours service fee
- `{{serviceCallFee}}`: Standard visit charge
- `{{warrantyPeriod}}`: Parts/labor warranty
- `{{licenseNumber}}`: Contractor license

**Dental:**
- `{{doctorName}}`: Dentist name
- `{{practiceType}}`: General, Orthodontics, etc.
- `{{insuranceAccepted}}`: Insurance providers
- `{{newPatientFee}}`: Initial visit cost

**Legal:**
- `{{attorneyName}}`: Lawyer name
- `{{practiceAreas}}`: Specialties
- `{{consultationFee}}`: Initial meeting cost
- `{{barNumber}}`: Bar association number

---

## 8. BEST PRACTICES & PATTERNS

### 8.1 Scenario Design Principles

#### 8.1.1 The 3-5-2 Rule
- **3+ trigger variations:** Minimum for good matching
- **5 trigger variations:** Recommended sweet spot
- **2-3 reply variations:** Sounds human, not robotic

#### 8.1.2 Specific > Generic
```
❌ BAD:
Trigger: "i need help"
(Too broad, matches everything)

✅ GOOD:
Trigger: "i need help with my water heater"
(Specific, clear intent)
```

#### 8.1.3 Use Negative Triggers Liberally
```
Scenario: "Hold Please"
Triggers: "hold on", "wait a moment"

Negative Triggers:
  • "don't hold" → Prevents false match
  • "no hold" → Prevents false match
  • "can't hold" → Prevents false match
```

#### 8.1.4 Test With Typos & Mishears
Speech-to-text makes mistakes. Account for them:
```
✅ "schedul" (missing 'e')
✅ "apointment" (missing 'p')
✅ "bookong" (o instead of i)
✅ "emergancy" (common misspelling)
```

#### 8.1.5 Variables Everywhere
Never hard-code company data:
```
❌ BAD:
"Call us at 555-1234"

✅ GOOD:
"Call us at {{phone}}"
```

---

### 8.2 Priority Assignment Strategy

```
EMERGENCY (+8 to +10)
├── Life/Safety: flooding, fire, gas leak
├── Property Damage: roof leak, burst pipe
└── No Service: no heat in winter, no AC in summer

URGENT (+3 to +7)
├── Time-Sensitive: same-day service, deadline
├── High Inconvenience: toilet not flushing, no hot water
└── Business Impact: office HVAC down, server room overheating

NORMAL (0 to +2)
├── Standard Requests: book appointment, get quote
├── General Questions: hours, pricing, services
└── Routine Service: annual maintenance, inspection

LOW PRIORITY (-3 to -1)
├── Small Talk: weather, sports, compliments
├── Non-Urgent Info: history, about us, team
└── Optional Features: newsletter, blog, social media

FALLBACK (-8 to -10)
├── Catch-All: "I'm here to help"
├── Confused: "I didn't quite catch that"
└── Transfer: "Let me connect you with someone"
```

---

### 8.3 Writing Human-Like Responses

#### 8.3.1 Contractions Are Your Friend
```
❌ ROBOTIC:
"I would be happy to assist you with that request."

✅ HUMAN:
"I'd be happy to help with that!"
```

#### 8.3.2 Show Enthusiasm (When Appropriate)
```
❌ FLAT:
"I can schedule that."

✅ ENTHUSIASTIC:
"Absolutely! Let's get you scheduled!"
```

#### 8.3.3 Ask Open-Ended Questions
```
❌ CLOSED:
"Do you want an appointment?"

✅ OPEN:
"What day works best for you?"
```

#### 8.3.4 Mirror Caller's Energy
```
CALLER (urgent): "My basement's flooding!"
❌ RESPONSE: "I can help with that. What's your address?"
✅ RESPONSE: "Oh no! That's urgent — I'm getting emergency dispatch on the line right now. Stay with me."

CALLER (casual): "Hey, I need an oil change sometime."
❌ RESPONSE: "I WILL IMMEDIATELY DISPATCH A TECHNICIAN."
✅ RESPONSE: "Sure thing! When were you thinking?"
```

---

### 8.4 Multi-Template Strategy

#### 8.4.1 Template Stacking Examples

**Service Business (Plumbing Company):**
```
1. Plumbing Company Template (Priority 1) - Industry-specific
2. Professional Office Template (Priority 2) - Business etiquette
3. Small Talk Template (Priority 3) - Casual conversation
4. Emergency Template (Priority 4) - Safety protocols
```

**Medical Practice (Dental Office):**
```
1. Dental Practice Template (Priority 1) - Dental-specific
2. Medical Office Template (Priority 2) - Healthcare protocols
3. Insurance Verification Template (Priority 3) - Billing/insurance
4. Small Talk Template (Priority 4) - Patient comfort
```

#### 8.4.2 Priority Hierarchy
Lower priority templates act as fallbacks:
```
Caller: "I need an appointment" → Plumbing Template matches
Caller: "What's the weather like?" → Small Talk Template matches
Caller: "Hello" → Professional Office Template matches
```

---

## 9. CODE REFERENCE

### 9.1 Key Files

#### Backend
```
models/
  ├── GlobalInstantResponseTemplate.js (Template schema)
  ├── GlobalAIBehaviorTemplate.js (Behavior templates)
  ├── v2Company.js (Company config & selected templates)
  └── InstantResponseCategory.js (Legacy per-company categories)

services/
  ├── HybridScenarioSelector.js (Matching algorithm)
  ├── v2priorityDrivenKnowledgeRouter.js (Knowledge routing)
  └── globalAIBrainSyncService.js (Template sync)

routes/
  ├── admin/globalInstantResponses.js (Template CRUD)
  ├── company/v2companyConfiguration.js (Variables & templates)
  └── v2twilio.js (Call handling)

utils/
  ├── aiAgent.js (Legacy Q&A matching)
  └── placeholderUtils.js (Variable replacement)
```

#### Frontend
```
public/
  ├── admin-global-instant-responses.html (Template design UI)
  ├── company-profile.html (Company config UI)
  └── js/
      └── ai-agent-settings/
          ├── VariablesManager.js (Variables tab)
          ├── AiCoreTemplatesManager.js (Template selection)
          ├── AiCoreLiveScenariosManager.js (Live scenarios view)
          └── AiCoreKnowledgebaseManager.js (Company Q&A)
```

### 9.2 API Endpoints

#### Global AI Brain (Admin)
```
GET    /api/admin/global-instant-responses/published
GET    /api/admin/global-instant-responses/:templateId
POST   /api/admin/global-instant-responses
PUT    /api/admin/global-instant-responses/:templateId
DELETE /api/admin/global-instant-responses/:templateId
POST   /api/admin/global-instant-responses/:templateId/clone
```

#### Company Configuration
```
GET    /api/company/:companyId/configuration/templates
POST   /api/company/:companyId/configuration/templates (Activate)
DELETE /api/company/:companyId/configuration/templates/:templateId

GET    /api/company/:companyId/configuration/variables
POST   /api/company/:companyId/configuration/variables/scan
PATCH  /api/company/:companyId/configuration/variables
```

---

## 10. TROUBLESHOOTING

### 10.1 Scenario Not Matching

**Problem:** Caller says trigger phrase, but scenario doesn't fire

**Diagnosis:**
1. **Check Status:** Is scenario "Live"? (Not Draft or Archived)
2. **Check Template:** Is template activated for this company?
3. **Check Priority:** Is a higher-priority scenario matching instead?
4. **Check Threshold:** Is confidence score below company threshold?
5. **Check Filler Words:** Are key words being filtered out?
6. **Check Negative Triggers:** Is a negative trigger blocking the match?

**Debug Steps:**
```bash
# 1. Check company's active templates
curl -H "Authorization: Bearer TOKEN" \
  https://clientsvia-backend.onrender.com/api/company/COMPANY_ID/configuration/templates

# 2. Check scenario status in template
curl -H "Authorization: Bearer TOKEN" \
  https://clientsvia-backend.onrender.com/api/admin/global-instant-responses/TEMPLATE_ID

# 3. Test matching algorithm directly
# (Use Test & Preview tab in scenario form)
```

---

### 10.2 Variable Not Replacing

**Problem:** Response shows `{{variable}}` instead of actual value

**Diagnosis:**
1. **Check Variable Name:** Exact spelling/casing matters
2. **Check Variable Value:** Is it filled in Variables tab?
3. **Check Template Scan:** Has variable scan been run?
4. **Check Cache:** Clear Redis cache for this company

**Fix:**
```bash
# 1. Verify variable exists
curl -H "Authorization: Bearer TOKEN" \
  https://clientsvia-backend.onrender.com/api/company/COMPANY_ID/configuration/variables

# 2. Trigger variable scan
curl -X POST -H "Authorization: Bearer TOKEN" \
  https://clientsvia-backend.onrender.com/api/company/COMPANY_ID/configuration/variables/scan

# 3. Clear Redis cache
redis-cli DEL "company:COMPANY_ID"
```

---

### 10.3 Wrong Scenario Matching

**Problem:** Scenario A matches when Scenario B should match

**Diagnosis:**
1. **Check Confidence Scores:** Which scored higher?
2. **Check Priorities:** Same score? Higher priority wins
3. **Check Trigger Overlap:** Are trigger phrases too similar?
4. **Check Template Priority:** Template 1 is checked before Template 2

**Fix:**
```
Option 1: Increase priority of Scenario B (+2 or +5)
Option 2: Add negative triggers to Scenario A
Option 3: Make Scenario B trigger phrases more specific
Option 4: Move Scenario B to higher-priority template
```

---

### 10.4 Performance Issues (>50ms)

**Problem:** Responses taking too long

**Diagnosis:**
1. **Check Redis:** Is caching working?
2. **Check Scenario Count:** >500 scenarios slows matching
3. **Check MongoDB:** Query performance issues?
4. **Check Network:** Render server cold start?

**Fix:**
```bash
# 1. Verify Redis connection
redis-cli PING

# 2. Check cache hit rate
redis-cli INFO stats | grep keyspace_hits

# 3. Monitor MongoDB performance
# (Check Render logs for query times)

# 4. Optimize scenario count
# (Archive unused scenarios, consolidate similar ones)
```

---

## 10.5 SYNONYM & FILLER SYSTEM (NEW!)

### What's New?

As of January 2025, ClientsVia AI Core now includes a **world-class Synonym & Filler System** that dramatically improves match rates for non-technical customers.

### The Problem It Solves

**Before:**
```
Customer: "The thingy on the wall isn't working"
AI: ❌ No match (doesn't understand "thingy")
```

**After (with synonyms):**
```
Customer: "The thingy on the wall isn't working"
AI Translation: "thingy" → "thermostat"
AI: ✅ Matches "Thermostat Not Working" scenario
```

### Key Features

1. **🔤 Synonym Mapping:** Translate colloquial → technical terms
2. **🔇 Filler Removal:** Strip noise words (um, uh, like) from input
3. **🏗️ 3-Tier Inheritance:** Template → Category → Scenario
4. **⚡ Quick Add Workflow:** Add fillers/synonyms without leaving scenario form
5. **🍞 Toast Notifications:** Beautiful success/error feedback
6. **📊 Real-time Updates:** Instant display refresh

### How It Works

#### Step 1: Define Synonyms

**Template Level (Applies to ALL categories):**
```javascript
synonymMap: {
  "air conditioner": ["ac", "a/c", "air", "cooling", "cold air"],
  "furnace": ["heater", "heat", "heating", "hot air"],
  "unit": ["system", "equipment", "machine"]
}
```

**Category Level (Domain-specific):**
```javascript
// Category: "Thermostat Issues"
synonymMap: {
  "thermostat": ["thingy", "box on wall", "temperature thing", "dial"]
}
```

#### Step 2: Runtime Processing

```
Caller Input:
"Um, the thingy on the wall, like, isn't working"
    ↓
1. Synonym Translation:
   "thingy" → "thermostat"
   "Um, the thermostat on the wall, like, isn't working"
    ↓
2. Normalization:
   Lowercase, remove punctuation
   "um the thermostat on the wall like isnt working"
    ↓
3. Filler Removal:
   Remove: um, like
   "thermostat wall isnt working"
    ↓
4. Scenario Matching:
   ✅ Matched "Thermostat Not Working" (score: 0.89)
```

### Where to Manage Synonyms & Fillers

#### 1. Template Settings Tab

**Location:** Global AI Brain → Settings Tab

**Features:**
- Add/remove template-level fillers
- Add/remove template-level synonyms
- Search fillers
- Export/import synonyms (JSON)
- Real-time counts

**When to Use:**
- Universal fillers ("um", "uh", "like")
- Industry-standard abbreviations ("ac" → "air conditioner")
- Terms used across ALL categories

#### 2. Category Modal

**Location:** Dashboard → Edit Category

**Features:**
- Additional category-specific fillers
- Domain-specific synonyms
- Inheritance visualization
- Extends template settings

**When to Use:**
- Domain-specific slang ("thingy" → "thermostat")
- Category-specific noise words
- Technical terms unique to one domain

#### 3. Scenario Form - Inherited Configuration

**Location:** Add/Edit Scenario → Inherited Configuration Section

**Features:**
- Read-only display of effective fillers/synonyms
- See merged template + category settings
- Quick Add buttons (NEW!)
- Instant refresh after changes

**Workflow:**
1. Open scenario form
2. See inherited config
3. Notice missing synonym
4. Click "Quick Add" button
5. Enter synonym → Save
6. See instant update!

### Quick Add Workflow (NEW!)

The **Quick Add** feature lets you add fillers/synonyms **without leaving the scenario form**!

**Example:**
```
1. Editing scenario
2. See inherited config:
   - Fillers: um, uh, like [Quick Add]
   - Synonyms: ac→air conditioner [Quick Add]
3. Click [Quick Add] (purple button)
4. Quick Add Synonym Modal opens
5. Select scope:
   - 🌐 Template (All Categories)
   - 📁 Category (This Category Only)
6. Enter:
   - Technical: "thermostat"
   - Colloquial: "thingy, box on wall, dial"
7. Click [Add Synonym]
8. Toast notification: "Added synonym!"
9. Inherited config auto-refreshes
10. Continue editing (no page reload!)
```

### Best Practices

#### Synonyms

**✅ GOOD:**
```javascript
{
  "thermostat": ["thingy", "box on wall", "temperature thing", "dial"],
  "air conditioner": ["ac", "a/c", "air", "cooling system"]
}
```

**❌ BAD:**
```javascript
{
  "thermostat": ["thing"],  // Too vague
  "air conditioner": ["it"]  // Ambiguous
}
```

#### Fillers

**✅ GOOD:**
- Vocal fillers: um, uh, er, ah
- Discourse markers: like, you know, so, well
- Hedges: basically, literally, actually

**❌ BAD:**
- Content words: broken, working, hot
- Negations: not, no, never (changes meaning!)

### Integration with HybridScenarioSelector

The synonym/filler system is **deeply integrated** into the AI matching pipeline:

```javascript
// services/HybridScenarioSelector.js
class HybridScenarioSelector {
    constructor(fillerWordsArray, urgencyKeywordsArray, synonymMapObject) {
        this.fillerWords = new Set(fillerWordsArray);
        this.synonymMap = new Map(synonymMapObject);
    }
    
    normalizePhrase(phrase) {
        // Stage 1: Synonym translation
        let processed = this.applySynonymTranslation(phrase);
        
        // Stage 2: Standard normalization
        processed = processed.toLowerCase().trim();
        
        // Stage 3: Filler removal
        processed = this.removeFillerWords(processed);
        
        return processed;
    }
}
```

### Complete Documentation

For **complete architecture documentation**, see:

📄 **`/docs/SYNONYM-FILLER-SYSTEM-ARCHITECTURE.md`**

This includes:
- Full API reference
- UI component details
- Troubleshooting guide
- Code examples
- Data flow diagrams

---

## 11. FUTURE ENHANCEMENTS

### 11.1 Planned Features

- **In-House Embeddings:** Replace placeholder semantic matching with custom model
- **A/B Testing:** Test scenario variations automatically
- **Scenario Analytics:** Track performance metrics per scenario
- **Visual Flow Designer:** Drag-and-drop scenario creation
- **Multi-Language Support:** Spanish, French, etc.
- **Voice Cloning:** Per-company custom voices

---

## 12. AI LEARNING NOTIFICATION SYSTEM

### 12.1 Overview

The **AI Learning Notification System** provides real-time visibility into every change made to your AI templates, categories, and scenarios. Every time a synonym, filler word, or keyword is added—whether manually by a developer or automatically by the LLM intelligence system—a notification is sent to the **Notification Center**.

**Purpose:**
- Track how the AI is evolving and learning from real call data
- Audit all manual changes made by developers
- Monitor LLM-detected patterns and suggestions
- Maintain complete transparency in AI intelligence growth
- Debug issues by seeing exactly when/how the AI configuration changed

### 12.2 Notification Types

#### 12.2.1 Manual Additions (Developer-Initiated)

**Code:** `AI_LEARNING_SYNONYM_ADDED`, `AI_LEARNING_FILLER_ADDED`  
**Severity:** `WARNING` (informational, not critical)  
**Triggered When:**
- Developer adds synonym mapping via Template Settings or Category Settings
- Developer adds filler words via Quick Add or Template/Category forms

**Example Notification:**
```
🧠 AI Learning: Synonym Added (Manual)

New synonym mapping added to template.

Template: "HVAC Front Desk Receptionist"
Technical Term: "thermostat"
Colloquial Terms: "thingy, box on wall, temperature thing"
Added By: admin@clientsvia.com

This improves the AI's ability to understand non-technical language.
```

#### 12.2.2 LLM-Generated Suggestions (AI-Initiated)

**Code:** `AI_LEARNING_SYNONYM_ADDED`, `AI_LEARNING_FILLER_ADDED`, `AI_LEARNING_KEYWORD_ADDED`, `AI_LEARNING_NEGATIVE_KEYWORD_ADDED`  
**Severity:** `WARNING`  
**Triggered When:**
- LLM analyzes test calls and detects patterns
- Developer applies a suggestion from Intelligence Dashboard
- System automatically adds learned pattern to template

**Example Notification:**
```
🤖 AI Learning: Synonym Mapping Added by LLM (Category)

The AI detected and added a new synonym mapping.

Template: "HVAC Front Desk Receptionist"
Category: "Thermostats"
Technical Term: "thermostat"
Colloquial Term: "thingy"
Confidence: 78%
Estimated Impact: 23%
Detection Method: frequency_analysis

This was automatically detected from 12 test calls.
```

### 12.3 Notification Details

Every AI learning notification includes:

**Core Context:**
- **Template Name:** Which template was modified
- **Category Name:** (if applicable) Which category was affected
- **Scenario Name:** (if applicable) Which scenario received the keyword

**Learning Data:**
- **Technical Term / Filler Word / Keyword:** The actual data added
- **Colloquial Terms / Aliases:** All variations added
- **Total Count:** How many total synonyms/fillers now exist

**For LLM Suggestions:**
- **Confidence:** How confident the AI is (0-100%)
- **Estimated Impact:** Expected improvement in match rate (%)
- **Detection Method:** `frequency_analysis`, `context_analysis`, `semantic_analysis`
- **Frequency:** How many test calls triggered this pattern
- **Suggestion ID:** Reference to the Intelligence Dashboard suggestion

**For Manual Additions:**
- **Added By:** Username/email of the developer who made the change
- **Source:** Always "Manual Addition"

### 12.4 Where Notifications Are Sent

All AI learning notifications appear in:

**1. Notification Center Alert Log**
- Location: `admin-notification-center.html`
- Tab: "Alert Log"
- Severity: WARNING (yellow badge)
- Filterable by: Type, Template, Source

**2. Dashboard Stats**
- "Warning" count increases
- Interactive stats bar shows totals
- Clickable to filter by severity

### 12.5 Notification Actions

**From Notification Center:**
1. **View Details:** Click alert to see full JSON payload
2. **Acknowledge:** Mark as read (doesn't delete, just updates status)
3. **Resolve:** Mark as resolved (grays out, moves to bottom)
4. **Bulk Actions:** Delete, purge old, clear all

**From Intelligence Dashboard:**
1. **Apply Suggestion:** Triggers notification immediately
2. **Ignore Suggestion:** No notification sent
3. **Dismiss Suggestion:** No notification sent

### 12.6 Notification Workflow

```
┌─────────────────────────────────────────────────────────────┐
│            DEVELOPER ADDS SYNONYM (Manual)                   │
└─────────────────────────┬───────────────────────────────────┘
                          ↓
                  POST /api/admin/global-instant-responses/:id/synonyms
                          ↓
              AdminNotificationService.sendAlert()
                          ↓
              NotificationLog created in MongoDB
                          ↓
          Notification appears in Notification Center
                          ↓
          Developer sees: "🧠 AI Learning: Synonym Added (Manual)"


┌─────────────────────────────────────────────────────────────┐
│         LLM ANALYZES TEST CALLS (AI-Initiated)              │
└─────────────────────────┬───────────────────────────────────┘
                          ↓
        IntelligentPatternDetector.analyzeTestCalls()
                          ↓
          Suggestions saved to SuggestionKnowledgeBase
                          ↓
      Developer views Intelligence Dashboard
                          ↓
      Developer clicks "Apply" on a suggestion
                          ↓
       POST /api/admin/global-instant-responses/:id/suggestions/:suggestionId/apply
                          ↓
        SuggestionKnowledgeBase.applySynonymSuggestion()
                          ↓
              AdminNotificationService.sendAlert()
                          ↓
          Notification appears in Notification Center
                          ↓
          Developer sees: "🤖 AI Learning: Synonym Added by LLM (Category)"
```

### 12.7 Smart Alert Grouping

The notification system includes **deduplication logic** to prevent alert spam:

**Grouping Rules:**
- Same `code` (e.g., `AI_LEARNING_SYNONYM_ADDED`)
- Same `companyId` (null for global templates)
- Same `severity` (WARNING)
- Within **15-minute window**
- Unacknowledged and unresolved

**Result:**
- Instead of 10 separate "Synonym Added" alerts, you get 1 alert with `occurrenceCount: 10`
- Notification shows first/last occurrence timestamps
- Expands to show all individual occurrences
- "HOT ALERT" indicator if rapidly firing (>5 in 5 minutes)

### 12.8 Best Practices

**For Developers:**

1. **Monitor Daily:** Check Notification Center once per day for AI learning activity
2. **Review LLM Suggestions:** Verify LLM-detected patterns make sense before applying
3. **Audit Manual Changes:** Use notifications as an audit trail for your own changes
4. **Investigate Rapid Alerts:** If same synonym added 10 times, something's wrong
5. **Use Filters:** Filter by "AI_LEARNING_SYNONYM_ADDED" to see only synonym changes

**For Testing:**

1. **Test → Check Notifications:** After testing, check if AI learned anything new
2. **Validate Confidence:** Don't auto-apply suggestions with <60% confidence
3. **Review Impact:** Focus on suggestions with >20% estimated impact
4. **Compare Before/After:** Track if applied suggestions actually improved match rates

**For Production:**

1. **Production Monitoring:** Set up alerts for >10 AI learning events per day
2. **Weekly Reviews:** Review all AI learning notifications from past week
3. **Document Patterns:** Note which colloquial terms are most common
4. **Feedback Loop:** Use notifications to improve template design

### 12.9 Troubleshooting

**Notification Not Appearing:**
- Check code: Must be `AI_LEARNING_SYNONYM_ADDED`, `AI_LEARNING_FILLER_ADDED`, etc.
- Verify severity: Must be `WARNING` (uppercase) - Mongoose enum values are case-sensitive
- Check MongoDB: `notificationlogs` collection should have new entry
- Redis cache: Clear with `redis-cli FLUSHDB` if stale

**Too Many Notifications:**
- Check if deduplication is working (should group similar alerts)
- Review confidence threshold: Lower threshold = more suggestions applied
- Disable auto-apply if implemented in future

**Notification Missing Details:**
- Check `details` object in MongoDB document
- Ensure template/category/scenario names are populated
- Verify user authentication is working (for "Added By" field)

### 12.10 Code Reference

**Backend Services:**
- `services/AdminNotificationService.js` - Sends notifications
- `models/NotificationLog.js` - Stores notifications in MongoDB
- `models/SuggestionKnowledgeBase.js` - Applies LLM suggestions and sends notifications

**API Routes:**
- `routes/admin/globalInstantResponses.js` - Synonym/filler POST routes
- `routes/admin/adminNotifications.js` - Notification CRUD operations

**Frontend:**
- `admin-notification-center.html` - Notification UI
- `js/notification-center/LogManager.js` - Alert log rendering

**Key Functions:**
```javascript
// Send notification
await AdminNotificationService.sendAlert({
    code: 'AI_LEARNING_SYNONYM_ADDED',
    severity: 'warning',
    title: '🧠 AI Learning: Synonym Added',
    message: 'Detailed message...',
    details: { /* rich context */ }
});

// Apply LLM suggestion (auto-sends notification)
await suggestion.apply(userId);
```

### 12.11 Future Enhancements

**Planned Features:**
- Email/SMS notifications for high-priority AI learning events
- Slack/Discord webhook integration
- AI learning analytics dashboard (trends, top learned terms)
- Undo/revert capability for applied suggestions
- Auto-apply suggestions above confidence threshold
- Machine learning to predict which suggestions to auto-apply

---

## 13. APPENDIX

### 13.1 Glossary

**AiCore:** The intelligence system (templates, scenarios, variables, knowledge)  
**Behavior:** AI personality settings (tone, pace, volume, emotion)  
**Category:** Logical grouping of related scenarios (Greetings, Booking, Emergency)  
**Colloquial Term:** Slang or non-technical term customers use (e.g., "thingy", "box on wall")  
**Company Q&A:** Per-company custom knowledge base  
**Entity:** Data extracted from speech (name, phone, date, etc.)  
**Filler Words:** Noise words removed before matching (um, uh, like, etc.)  
**Global AI Brain:** Platform-wide template library (admin-managed)  
**Hybrid Selector:** Matching algorithm (BM25 + Semantic + Regex + Context)  
**Inherited Configuration:** Merged fillers/synonyms from template + category displayed in scenario form  
**Negative Trigger:** Phrase that prevents scenario from matching  
**Priority:** Tie-breaker value (-10 to +100) when multiple scenarios score equally  
**Quick Add:** Feature to add fillers/synonyms without leaving scenario form  
**Scenario:** Single conversation unit (triggers → response)  
**Synonym Map:** Technical term → colloquial aliases mapping (e.g., "thermostat" → ["thingy", "box on wall"])  
**Technical Term:** Formal/correct term used in scenarios (e.g., "thermostat", "air conditioner")  
**Template:** Industry-specific intelligence package (collection of categories/scenarios)  
**Template Reference:** Company's link to Global AI Brain template (not a clone)  
**3-Tier Inheritance:** System where scenarios inherit fillers/synonyms from template and category  
**Trigger Phrase:** Phrase that activates a scenario  
**Urgency Keyword:** Word that boosts emergency detection (emergency, urgent, leak)  
**Variable:** Dynamic placeholder replaced with company-specific data ({{companyName}})  
**Variable Definition:** Type system for variables (text, phone, email, etc.)  

---

## 13. QUICK REFERENCE

### 13.1 Scenario Creation Checklist

- [ ] Descriptive scenario name (action verb + noun)
- [ ] Status set to "Draft" (for testing)
- [ ] Priority assigned (-10 to +10)
- [ ] 3-5 trigger variations (natural language)
- [ ] Negative triggers added (if needed)
- [ ] 2-3 quick reply variations
- [ ] 2-3 full reply variations
- [ ] Variables used ({{companyName}}, etc.)
- [ ] Behavior selected (matches tone)
- [ ] Tested with 5+ sample phrases
- [ ] Published to "Live"
- [ ] Monitored for 24 hours

### 13.2 Variable Naming Conventions

```
Format: camelCase, no spaces, descriptive

✅ GOOD:
  {{companyName}}
  {{businessHours}}
  {{emergencyPhone}}
  {{serviceCallFee}}

❌ BAD:
  {{company}} (too vague)
  {{phone1}} (not descriptive)
  {{HOURS}} (all caps)
  {{business_hours}} (snake_case)
```

### 13.3 Common Mistakes

1. **Too Few Trigger Variations:** 1-2 triggers = poor matching
2. **Hard-Coded Company Data:** Never use specific phone numbers/addresses in scenarios
3. **Overly Generic Triggers:** "i need help" matches everything
4. **Robotic Responses:** Single variation, formal language
5. **Wrong Priority:** Emergency scenarios at priority 0
6. **Missing Negative Triggers:** "don't hold" matches "hold" scenario
7. **Untested Scenarios:** Publishing without testing
8. **Cache Not Cleared:** Variables don't update
9. **Too Many Templates:** >5 templates slow matching
10. **Overlapping Scenarios:** Same triggers in multiple scenarios

---

**Document Version:** 1.0  
**Last Updated:** 2025-10-23  
**Maintained By:** Platform Admin  
**Questions?** Refer to this document before asking!

---

*This document is the single source of truth for ClientsVia AiCore Intelligence System. Treat it as your bible for building world-class AI scenarios.*

